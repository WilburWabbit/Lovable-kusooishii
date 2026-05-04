const SERVICE_ROLE = "service_role";
const INTERNAL_SHARED_SECRET_HEADER = "x-internal-shared-secret";

function base64UrlDecode(value: string): string {
  const base64 = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(value.length + (4 - value.length % 4) % 4, "=");

  return new TextDecoder().decode(
    Uint8Array.from(atob(base64), (char) => char.charCodeAt(0)),
  );
}

function projectRefFromSupabaseUrl(supabaseUrl: string): string | null {
  try {
    return new URL(supabaseUrl).hostname.split(".")[0] || null;
  } catch {
    return supabaseUrl.match(/https:\/\/([^.]+)\./)?.[1] ?? null;
  }
}

function constantTimeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const maxLength = Math.max(leftBytes.length, rightBytes.length);
  let diff = leftBytes.length ^ rightBytes.length;

  for (let index = 0; index < maxLength; index++) {
    diff |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }

  return diff === 0;
}

export function verifyServiceRoleJWT(token: string, supabaseUrl: string): boolean {
  if (!token || !supabaseUrl) return false;

  const parts = token.trim().split(".");
  if (parts.length !== 3) return false;

  try {
    const payload = JSON.parse(base64UrlDecode(parts[1]));
    if (payload?.role !== SERVICE_ROLE) return false;

    const expectedRef = projectRefFromSupabaseUrl(supabaseUrl);
    if (!expectedRef) return false;

    // Legacy HS256 service-role JWT: { ref: "<project-ref>", role: "service_role" }
    if (payload?.ref === expectedRef) return true;

    // New asymmetric (rotated) service-role JWT: ref claim may be absent;
    // identify the project via iss = "https://<ref>.supabase.co/auth/v1"
    // (or similar host-based issuer). Accept any iss whose hostname starts
    // with the expected project ref.
    const iss = typeof payload?.iss === "string" ? payload.iss : "";
    if (iss) {
      try {
        const issHost = new URL(iss).hostname;
        if (issHost.split(".")[0] === expectedRef) return true;
      } catch {
        // iss is not a URL — fall through
      }
    }

    return false;
  } catch {
    return false;
  }
}

export function verifyInternalSharedSecret(
  req: Request,
  secretName = "INTERNAL_CRON_SECRET",
): boolean {
  const expectedSecret = Deno.env.get(secretName) ?? "";
  const providedSecret = req.headers.get(INTERNAL_SHARED_SECRET_HEADER) ?? "";
  if (!expectedSecret || !providedSecret) return false;
  return constantTimeEqual(providedSecret, expectedSecret);
}
