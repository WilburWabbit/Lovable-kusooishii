// Redeployed: 2026-03-23
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";

/**
 * qbo-sync-customers — LAND ONLY
 *
 * Fetches all customers from QBO and lands raw payloads into
 * landing_raw_qbo_customer. No canonical table writes.
 * Processing happens in qbo-process-pending.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const FETCH_TIMEOUT_MS = 30_000;

function fetchWithTimeout(url: string | URL, options: RequestInit = {}, timeoutMs = FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}


async function ensureValidToken(admin: any, realmId: string, clientId: string, clientSecret: string) {
  const { data: conn, error } = await admin.from("qbo_connection").select("*").eq("realm_id", realmId).single();
  if (error || !conn) throw new Error("No QBO connection found.");
  if (new Date(conn.token_expires_at).getTime() - Date.now() < 5 * 60 * 1000) {
    const tokenRes = await fetchWithTimeout("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
        Accept: "application/json",
      },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: conn.refresh_token }),
    });
    if (!tokenRes.ok) throw new Error(`Token refresh failed [${tokenRes.status}]`);
    const tokens = await tokenRes.json();
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
    await admin.from("qbo_connection").update({
      access_token: tokens.access_token, refresh_token: tokens.refresh_token, token_expires_at: expiresAt,
    }).eq("realm_id", realmId);
    return tokens.access_token;
  }
  return conn.access_token;
}

async function queryQboAll(baseUrl: string, accessToken: string, entity: string): Promise<any[]> {
  const all: any[] = [];
  let startPos = 1;
  const pageSize = 1000;
  while (true) {
    const query = encodeURIComponent(`SELECT * FROM ${entity} STARTPOSITION ${startPos} MAXRESULTS ${pageSize}`);
    const res = await fetch(`${baseUrl}/query?query=${query}`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`QBO ${entity} query failed [${res.status}]`);
    const data = await res.json();
    const page = data?.QueryResponse?.[entity] ?? [];
    all.push(...page);
    if (page.length < pageSize) break;
    startPos += pageSize;
  }
  return all;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const clientId = Deno.env.get("QBO_CLIENT_ID")!;
    const clientSecret = Deno.env.get("QBO_CLIENT_SECRET")!;
    const realmId = Deno.env.get("QBO_REALM_ID");
    if (!clientId || !clientSecret || !realmId) throw new Error("QBO credentials not configured");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) throw new Error("Unauthorized");
    const admin = createClient(supabaseUrl, serviceRoleKey);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await admin.auth.getUser(token);
    if (userError || !user) throw new Error("Unauthorized");
    const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", user.id);
    const hasAccess = (roles ?? []).some((r: any) => r.role === "admin" || r.role === "staff");
    if (!hasAccess) throw new Error("Forbidden");

    const accessToken = await ensureValidToken(admin, realmId, clientId, clientSecret);
    const baseUrl = `https://quickbooks.api.intuit.com/v3/company/${realmId}`;
    const correlationId = crypto.randomUUID();

    const qboCustomers = await queryQboAll(baseUrl, accessToken, "Customer");
    console.log(`Landing ${qboCustomers.length} QBO customers (correlation: ${correlationId})`);

    let landed = 0, skipped = 0;

    for (const c of qboCustomers) {
      try {
        const externalId = String(c.Id);
        const { data: existing } = await admin.from("landing_raw_qbo_customer")
          .select("id, status, raw_payload").eq("external_id", externalId).maybeSingle();

        if (existing) {
          const payloadChanged = JSON.stringify(existing.raw_payload) !== JSON.stringify(c);
          if (payloadChanged) {
            const newStatus = existing.status === "committed" ? "pending" : existing.status;
            await admin.from("landing_raw_qbo_customer").update({
              raw_payload: c, received_at: new Date().toISOString(), status: newStatus,
            }).eq("id", existing.id);
            if (newStatus === "pending") landed++; else skipped++;
          } else {
            skipped++;
          }
        } else {
          await admin.from("landing_raw_qbo_customer").insert({
            external_id: externalId, raw_payload: c, status: "pending",
            correlation_id: correlationId, received_at: new Date().toISOString(),
          });
          landed++;
        }
      } catch (err) {
        console.error(`Failed to land customer ${c.Id}:`, err);
      }
    }

    return new Response(
      JSON.stringify({
        success: true, total: qboCustomers.length, landed, skipped,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("qbo-sync-customers error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
