// ============================================================
// eBay Digital Signatures (RFC 9421)
// Required for UK sellers calling eBay Finances API.
// Uses Ed25519 signing via Deno's crypto.subtle.
// ============================================================

/**
 * Generate the four required digital signature headers for eBay API calls.
 * @param method HTTP method (GET, POST, etc.)
 * @param path   Request path (e.g., /sell/finances/v1/payout)
 * @param body   Request body string (omit for GET)
 */
export async function generateDigitalSignatureHeaders(
  method: string,
  path: string,
  body?: string,
): Promise<Record<string, string>> {
  const privateKeyPem = Deno.env.get("EBAY_SIGNING_PRIVATE_KEY");
  const jwe = Deno.env.get("EBAY_SIGNING_KEY_JWE");

  // If signing keys aren't configured, return empty — allows non-UK sellers to skip
  if (!privateKeyPem || !jwe) {
    return {};
  }

  const created = Math.floor(Date.now() / 1000);
  const headers: Record<string, string> = {};

  // x-ebay-signature-key — the JWE from Key Management API
  headers["x-ebay-signature-key"] = jwe;

  // Content-Digest — SHA-256 of request body (POST/PUT only)
  if (body && (method === "POST" || method === "PUT")) {
    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(body));
    const hashBase64 = btoa(String.fromCharCode(...new Uint8Array(hashBuffer)));
    headers["Content-Digest"] = `sha-256=:${hashBase64}:`;
  }

  // Signature-Input — describes signed components
  const hasBody = !!headers["Content-Digest"];
  const components = hasBody
    ? '("content-digest" "x-ebay-signature-key" "@method" "@path" "@authority")'
    : '("x-ebay-signature-key" "@method" "@path" "@authority")';
  headers["Signature-Input"] = `sig1=${components};created=${created}`;

  // Build signature base per RFC 9421
  const signatureBase = buildSignatureBase(method, path, headers, created, hasBody);

  // Sign with Ed25519
  const signature = await signEd25519(privateKeyPem, signatureBase);
  headers["Signature"] = `sig1=:${signature}:`;

  return headers;
}

function buildSignatureBase(
  method: string,
  path: string,
  headers: Record<string, string>,
  created: number,
  hasContentDigest: boolean,
): string {
  const lines: string[] = [];

  if (hasContentDigest) {
    lines.push(`"content-digest": ${headers["Content-Digest"]}`);
  }
  lines.push(`"x-ebay-signature-key": ${headers["x-ebay-signature-key"]}`);
  lines.push(`"@method": ${method}`);
  lines.push(`"@path": ${path}`);
  lines.push(`"@authority": apiz.ebay.com`);

  const components = hasContentDigest
    ? '("content-digest" "x-ebay-signature-key" "@method" "@path" "@authority")'
    : '("x-ebay-signature-key" "@method" "@path" "@authority")';
  lines.push(`"@signature-params": ${components};created=${created}`);

  return lines.join("\n");
}

/**
 * Sign data with an Ed25519 private key.
 * Expects PEM-encoded PKCS#8 private key.
 */
async function signEd25519(pemKey: string, data: string): Promise<string> {
  // Strip PEM headers and decode base64
  const pemBody = pemKey
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s/g, "");
  const keyBytes = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));

  const key = await crypto.subtle.importKey(
    "pkcs8",
    keyBytes,
    { name: "Ed25519" },
    false,
    ["sign"],
  );

  const encoder = new TextEncoder();
  const signatureBuffer = await crypto.subtle.sign("Ed25519", key, encoder.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)));
}
