// ============================================================
// eBay OAuth Token Management
// Reads access token from ebay_auth_tokens table, auto-refreshes
// if expired. Shared across all eBay edge functions.
// ============================================================

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";

/**
 * Get a valid eBay access token. Refreshes automatically if expired or
 * expiring within 60 seconds.
 */
export async function getEbayAccessToken(admin: SupabaseClient): Promise<string> {
  const { data: row } = await admin
    .from("ebay_auth_tokens" as never)
    .select("access_token, refresh_token, expires_at")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!row) {
    throw new Error("No eBay auth token found. Connect eBay first.");
  }

  const token = row as Record<string, unknown>;
  const expiresAt = new Date(token.expires_at as string).getTime();
  const now = Date.now();

  // If token is still valid (more than 60s remaining), return it
  if (expiresAt - now > 60_000) {
    return token.access_token as string;
  }

  // Refresh the token
  const clientId = Deno.env.get("EBAY_CLIENT_ID");
  const clientSecret = Deno.env.get("EBAY_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    throw new Error("EBAY_CLIENT_ID or EBAY_CLIENT_SECRET not configured");
  }

  const refreshToken = token.refresh_token as string;
  if (!refreshToken) {
    throw new Error("No eBay refresh token available. Re-connect eBay.");
  }

  const res = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`eBay token refresh failed [${res.status}]: ${errorText}`);
  }

  const tokens = await res.json();
  const newExpiresAt = new Date(now + tokens.expires_in * 1000).toISOString();

  // Update stored token
  await admin
    .from("ebay_auth_tokens" as never)
    .update({
      access_token: tokens.access_token,
      expires_at: newExpiresAt,
    } as never)
    .order("created_at" as never, { ascending: false })
    .limit(1);

  return tokens.access_token;
}
