/**
 * Shared eBay authentication helper.
 * Retrieves a valid eBay access token, refreshing if expired.
 */

const EBAY_TOKEN_URL = "https://api.ebay.com/identity/v1/oauth2/token";

// Some Supabase edge runtime workers occasionally return transient
// DNS lookup failures ("Name or service not known") when contacting
// api.ebay.com. Retry a couple of times with a small backoff before
// giving up so an intermittent blip doesn't kill the whole request.
async function fetchWithDnsRetry(
  url: string,
  init: RequestInit,
  attempts = 3,
): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetch(url, init);
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const transient =
        msg.includes("dns error") ||
        msg.includes("Name or service not known") ||
        msg.includes("error sending request") ||
        msg.includes("client error (Connect)");
      if (!transient || i === attempts - 1) throw err;
      await new Promise((r) => setTimeout(r, 250 * (i + 1)));
    }
  }
  throw lastErr;
}

export async function getEbayAccessToken(admin: any): Promise<string> {
  const { data: conn, error } = await admin
    .from("ebay_connection")
    .select("*")
    .limit(1)
    .maybeSingle();

  if (error || !conn) throw new Error("No eBay connection found");

  // If token is still valid (5 min buffer), return it
  if (new Date(conn.token_expires_at).getTime() - Date.now() > 5 * 60 * 1000) {
    return conn.access_token;
  }

  // Refresh the token
  const clientId = Deno.env.get("EBAY_CLIENT_ID");
  const clientSecret = Deno.env.get("EBAY_CLIENT_SECRET");
  if (!clientId || !clientSecret) throw new Error("EBAY_CLIENT_ID or EBAY_CLIENT_SECRET not configured");

  const basicAuth = btoa(`${clientId}:${clientSecret}`);
  const tokenRes = await fetchWithDnsRetry(EBAY_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: conn.refresh_token,
    }),
  });

  if (!tokenRes.ok) {
    const errBody = await tokenRes.text();
    throw new Error(`eBay token refresh failed [${tokenRes.status}]: ${errBody}`);
  }

  const tokens = await tokenRes.json();
  const expiresAt = new Date(Date.now() + (tokens.expires_in ?? 7200) * 1000).toISOString();

  const { data: updated } = await admin
    .from("ebay_connection")
    .update({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || conn.refresh_token,
      token_expires_at: expiresAt,
    })
    .eq("id", conn.id)
    .eq("updated_at", conn.updated_at)
    .select("id");

  if (!updated?.length) {
    throw new Error("Token refresh conflict — another refresh may have occurred simultaneously");
  }

  return tokens.access_token;
}
