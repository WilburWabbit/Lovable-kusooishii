// ============================================================
// Shared QBO Edge Function Helpers
// DRYs up boilerplate across all QBO push/sync functions.
// ============================================================

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";

// ─── CORS ───────────────────────────────────────────────────

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ─── Fetch with Timeout ─────────────────────────────────────

const FETCH_TIMEOUT_MS = 30_000;

export function fetchWithTimeout(
  url: string | URL,
  options: RequestInit = {},
  timeoutMs = FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() =>
    clearTimeout(timer)
  );
}

// ─── Supabase Admin Client ──────────────────────────────────

export function createAdminClient(): SupabaseClient {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(supabaseUrl, serviceRoleKey);
}

// ─── Request Authentication ─────────────────────────────────

export async function authenticateRequest(
  req: Request,
  admin: SupabaseClient,
): Promise<{ userId: string; email: string | undefined }> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new Error("Unauthorized — missing Bearer token");
  }
  const token = authHeader.replace("Bearer ", "");

  // Allow internal service-to-service calls (e.g. qbo-sync-payout invoking
  // qbo-sync-sales-receipt) to authenticate using the service role key.
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (serviceRoleKey && token === serviceRoleKey) {
    return { userId: "service-role", email: undefined };
  }

  const { data: { user }, error } = await admin.auth.getUser(token);
  if (error || !user) throw new Error("Unauthorized — invalid token");
  return { userId: user.id, email: user.email };
}

// ─── QBO Token Management ───────────────────────────────────

export function getQBOConfig() {
  const clientId = Deno.env.get("QBO_CLIENT_ID")!;
  const clientSecret = Deno.env.get("QBO_CLIENT_SECRET")!;
  const realmId = Deno.env.get("QBO_REALM_ID");
  if (!clientId || !clientSecret || !realmId) {
    throw new Error("QBO credentials not configured");
  }
  return { clientId, clientSecret, realmId };
}

export function qboBaseUrl(realmId: string): string {
  return `https://quickbooks.api.intuit.com/v3/company/${realmId}`;
}

export async function ensureValidToken(
  admin: SupabaseClient,
  realmId: string,
  clientId: string,
  clientSecret: string,
): Promise<string> {
  const { data: conn, error } = await admin
    .from("qbo_connection")
    .select("*")
    .eq("realm_id", realmId)
    .single();

  if (error || !conn) throw new Error("No QBO connection found.");

  // Refresh if token expires within 5 minutes
  if (new Date(conn.token_expires_at).getTime() - Date.now() < 5 * 60 * 1000) {
    const tokenRes = await fetchWithTimeout(
      "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
          Accept: "application/json",
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: conn.refresh_token,
        }),
      },
    );

    if (!tokenRes.ok) {
      throw new Error(`Token refresh failed [${tokenRes.status}]`);
    }

    const tokens = await tokenRes.json();
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

    await admin
      .from("qbo_connection")
      .update({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        token_expires_at: expiresAt,
      })
      .eq("realm_id", realmId);

    return tokens.access_token;
  }

  return conn.access_token;
}

// ─── JSON Response Helpers ──────────────────────────────────

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function errorResponse(err: unknown, status = 400): Response {
  console.error("Edge function error:", err);
  return new Response(
    JSON.stringify({
      error: err instanceof Error ? err.message : "Unknown error",
    }),
    {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
}
