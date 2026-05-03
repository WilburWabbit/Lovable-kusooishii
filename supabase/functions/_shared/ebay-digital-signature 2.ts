/**
 * eBay Digital Signature — RFC 9421 HTTP Message Signatures
 *
 * Generates Content-Digest, Signature-Input, Signature, and
 * x-ebay-signature-key headers required by the eBay Finances API
 * for EU/UK domiciled sellers.
 *
 * Supports Ed25519 (recommended) and RSA-SHA256 keys.
 */

// ── helpers ──────────────────────────────────────────────────

function base64Encode(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

/** SHA-256 Content-Digest per RFC 9530 */
async function contentDigest(body: string): Promise<string> {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(body),
  );
  return `sha-256=:${base64Encode(hash)}:`;
}

/** Detect key type from PEM header */
function detectKeyType(pem: string): "ed25519" | "rsa" {
  if (pem.includes("BEGIN PRIVATE KEY")) {
    // Could be either — check OID inside the DER
    // Ed25519 OID = 1.3.101.112 → hex 06 03 2b 65 70
    const b64 = pem.replace(/-----[^-]+-----/g, "").replace(/\s/g, "");
    const der = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    // Search for Ed25519 OID bytes
    for (let i = 0; i < der.length - 4; i++) {
      if (der[i] === 0x06 && der[i + 1] === 0x03 &&
          der[i + 2] === 0x2b && der[i + 3] === 0x65 && der[i + 4] === 0x70) {
        return "ed25519";
      }
    }
    return "rsa";
  }
  if (pem.includes("RSA PRIVATE KEY")) return "rsa";
  // Default to ed25519 for raw 32-byte keys
  return "ed25519";
}

/** Import the private key from PEM */
async function importPrivateKey(pem: string): Promise<{ key: CryptoKey; algo: "ed25519" | "rsa" }> {
  const algo = detectKeyType(pem);

  const b64 = pem
    .replace(/-----[^-]+-----/g, "")
    .replace(/\s/g, "");
  const der = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

  if (algo === "ed25519") {
    const key = await crypto.subtle.importKey(
      "pkcs8",
      der.buffer,
      { name: "Ed25519" },
      false,
      ["sign"],
    );
    return { key, algo };
  }

  // RSA
  const key = await crypto.subtle.importKey(
    "pkcs8",
    der.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return { key, algo };
}

// ── public API ───────────────────────────────────────────────

export interface SignedHeaders {
  "Content-Digest"?: string;
  "x-ebay-signature-key": string;
  "Signature-Input": string;
  Signature: string;
}

/**
 * Generate all required eBay digital signature headers.
 *
 * @param method  HTTP method (GET, POST, etc.)
 * @param url     Full request URL
 * @param body    Request body string (empty string for GET)
 * @param jwe     The JWE from eBay Key Management API
 * @param privateKeyPem  Private key in PEM (PKCS#8) format
 */
export async function signEbayRequest(
  method: string,
  url: string,
  body: string | null,
  jwe: string,
  privateKeyPem: string,
): Promise<SignedHeaders> {
  const parsedUrl = new URL(url);
  const hasBody = body !== null && body.length > 0;
  const created = Math.floor(Date.now() / 1000);

  // 1. Content-Digest (only for requests with a body)
  let digest: string | undefined;
  if (hasBody) {
    digest = await contentDigest(body!);
  }

  // 2. Build Signature-Input
  const components = hasBody
    ? `("content-digest" "x-ebay-signature-key" "@method" "@path" "@authority")`
    : `("x-ebay-signature-key" "@method" "@path" "@authority")`;
  const signatureInput = `sig1=${components};created=${created}`;

  // 3. Build Signature Base (per RFC 9421 §2.5)
  const lines: string[] = [];
  if (hasBody) {
    lines.push(`"content-digest": ${digest}`);
  }
  lines.push(`"x-ebay-signature-key": ${jwe}`);
  lines.push(`"@method": ${method.toUpperCase()}`);
  lines.push(`"@path": ${parsedUrl.pathname}`);
  lines.push(`"@authority": ${parsedUrl.host}`);
  lines.push(`"@signature-params": ${components};created=${created}`);
  const signatureBase = lines.join("\n");

  // 4. Sign
  const { key, algo } = await importPrivateKey(privateKeyPem);
  const signatureBytes = await crypto.subtle.sign(
    algo === "ed25519" ? "Ed25519" : { name: "RSASSA-PKCS1-v1_5" },
    key,
    new TextEncoder().encode(signatureBase),
  );
  const signatureB64 = base64Encode(signatureBytes);

  const headers: SignedHeaders = {
    "x-ebay-signature-key": jwe,
    "Signature-Input": signatureInput,
    Signature: `sig1=:${signatureB64}:`,
  };
  if (digest) {
    headers["Content-Digest"] = digest;
  }
  return headers;
}
