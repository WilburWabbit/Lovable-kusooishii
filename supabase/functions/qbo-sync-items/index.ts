// Redeployed: 2026-03-23
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";

/**
 * qbo-sync-items — LAND ONLY
 *
 * Fetches all Inventory + NonInventory items from QBO and lands raw payloads
 * into landing_raw_qbo_item. No SKU upserts, no stock reconciliation.
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

async function drainPendingQbo(
  supabaseUrl: string,
  serviceRoleKey: string,
): Promise<{ iterations: number; totalCommitted: number; totalRemaining: number }> {
  let iterations = 0;
  let totalCommitted = 0;
  let totalRemaining = 0;

  for (let i = 0; i < 25; i++) {
    const res = await fetchWithTimeout(`${supabaseUrl}/functions/v1/qbo-process-pending`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
        "Content-Type": "application/json",
        "x-webhook-trigger": "true",
      },
      body: JSON.stringify({ batch_size: 50 }),
    }, 60_000);

    if (!res.ok) {
      throw new Error(`qbo-process-pending failed [${res.status}]`);
    }

    const data = await res.json();
    const r = data?.results ?? {};
    totalCommitted += (r.items?.processed ?? 0) + (r.purchases?.processed ?? 0) +
      (r.sales?.processed ?? 0) + (r.refunds?.processed ?? 0) + (r.customers?.processed ?? 0);
    totalRemaining = data?.total_remaining ?? 0;
    iterations++;

    if (!data?.has_more) break;
  }

  return { iterations, totalCommitted, totalRemaining };
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

async function queryQboAll(baseUrl: string, accessToken: string, query: string, entityKey: string): Promise<any[]> {
  const all: any[] = [];
  let startPos = 1;
  const pageSize = 1000;
  while (true) {
    const pagedQuery = encodeURIComponent(`${query} STARTPOSITION ${startPos} MAXRESULTS ${pageSize}`);
    const res = await fetch(`${baseUrl}/query?query=${pagedQuery}`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`QBO query failed [${res.status}]`);
    const data = await res.json();
    const page = data?.QueryResponse?.[entityKey] ?? [];
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

    // Fetch all Inventory + NonInventory items
    const qboItems = await queryQboAll(
      baseUrl, accessToken,
      "SELECT * FROM Item WHERE Type IN ('Inventory', 'NonInventory')",
      "Item",
    );
    console.log(`Fetched ${qboItems.length} QBO items (correlation: ${correlationId})`);

    let landed = 0, skipped = 0;

    for (const item of qboItems) {
      const externalId = String(item.Id);
      try {
        const { data: existing } = await admin.from("landing_raw_qbo_item")
          .select("id, status, raw_payload").eq("external_id", externalId).maybeSingle();

        if (existing) {
          const payloadChanged = JSON.stringify(existing.raw_payload) !== JSON.stringify(item);
          if (payloadChanged) {
            const newStatus = existing.status === "committed" ? "pending" : existing.status;
            await admin.from("landing_raw_qbo_item").update({
              raw_payload: item, received_at: new Date().toISOString(), status: newStatus,
            }).eq("id", existing.id);
            if (newStatus === "pending") landed++; else skipped++;
          } else {
            skipped++;
          }
        } else {
          await admin.from("landing_raw_qbo_item").insert({
            external_id: externalId, raw_payload: item, status: "pending",
            correlation_id: correlationId, received_at: new Date().toISOString(),
          });
          landed++;
        }
      } catch (err) {
        console.error(`Failed to land item ${externalId}:`, err);
      }
    }

    // Deactivate SKUs for items no longer in QBO (stale cleanup)
    // This is a landing-layer concern: mark items not seen as needing attention
    const seenIds = new Set(qboItems.map(i => String(i.Id)));
    let deactivated = 0;

    // Paginate through all active SKUs with qbo_item_id
    let from = 0;
    const pageSize = 1000;
    while (true) {
      const { data } = await admin.from("sku")
        .select("id, qbo_item_id").not("qbo_item_id", "is", null)
        .eq("active_flag", true).range(from, from + pageSize - 1);
      if (!data || data.length === 0) break;
      for (const sku of data) {
        if (!seenIds.has(sku.qbo_item_id)) {
          await admin.from("sku").update({ active_flag: false }).eq("id", sku.id);
          deactivated++;
        }
      }
      if (data.length < pageSize) break;
      from += pageSize;
    }

    let autoProcess: { iterations: number; totalCommitted: number; totalRemaining: number } | null = null;
    if (landed > 0) {
      autoProcess = await drainPendingQbo(supabaseUrl, serviceRoleKey);
    }

    return new Response(
      JSON.stringify({
        success: true, total: qboItems.length,
        landed, skipped, deactivated,
        auto_processed: autoProcess,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("qbo-sync-items error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
