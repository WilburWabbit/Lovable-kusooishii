// Redeployed: 2026-03-23
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";

/**
 * qbo-sync-purchases — LAND ONLY
 *
 * Fetches purchases from QBO for a given month and lands raw payloads
 * into landing_raw_qbo_purchase. Also lands referenced QBO items into
 * landing_raw_qbo_item. No canonical table writes.
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

async function fetchQboItem(itemId: string, cache: Map<string, any>, baseUrl: string, accessToken: string): Promise<any | null> {
  if (cache.has(itemId)) return cache.get(itemId);
  try {
    const res = await fetchWithTimeout(`${baseUrl}/item/${itemId}`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    });
    if (!res.ok) { cache.set(itemId, null); return null; }
    const data = await res.json();
    const item = data?.Item ?? null;
    cache.set(itemId, item);
    return item;
  } catch { cache.set(itemId, null); return null; }
}

async function landPurchase(admin: any, purchase: any, correlationId: string): Promise<{ alreadyLanded: boolean }> {
  const externalId = String(purchase.Id);
  const { data: existing } = await admin.from("landing_raw_qbo_purchase")
    .select("id, status, raw_payload").eq("external_id", externalId).maybeSingle();

  if (existing) {
    const oldPayload = JSON.stringify(existing.raw_payload ?? {});
    const newPayload = JSON.stringify(purchase);
    const payloadChanged = oldPayload !== newPayload;

    const updateFields: Record<string, any> = { raw_payload: purchase, received_at: new Date().toISOString() };
    if (payloadChanged && existing.status === "committed") {
      updateFields.status = "pending";
      updateFields.processed_at = null;
    }
    await admin.from("landing_raw_qbo_purchase").update(updateFields).eq("id", existing.id);

    const effectiveStatus = (payloadChanged && existing.status === "committed") ? "pending" : existing.status;
    return { alreadyLanded: effectiveStatus === "committed" };
  }

  await admin.from("landing_raw_qbo_purchase").insert({
    external_id: externalId, raw_payload: purchase, status: "pending", correlation_id: correlationId,
  });
  return { alreadyLanded: false };
}

async function landQboItem(admin: any, item: any, correlationId: string): Promise<void> {
  if (!item?.Id) return;
  await admin.from("landing_raw_qbo_item").upsert({
    external_id: String(item.Id), raw_payload: item, status: "pending",
    correlation_id: correlationId, received_at: new Date().toISOString(),
  }, { onConflict: "external_id" });
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
    const isWebhook = req.headers.get("x-webhook-trigger") === "true" && token === serviceRoleKey;

    let targetMonth: string | null = null;
    try {
      const body = await req.json();
      if (body?.month && typeof body.month === "string") targetMonth = body.month;
    } catch { /* no body */ }

    if (!targetMonth) {
      const now = new Date();
      targetMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    }

    if (!isWebhook) {
      const { data: { user }, error: userError } = await admin.auth.getUser(token);
      if (userError || !user) throw new Error("Unauthorized");
      const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", user.id);
      const hasAccess = (roles ?? []).some((r: any) => r.role === "admin" || r.role === "staff");
      if (!hasAccess) throw new Error("Forbidden");
    }

    const accessToken = await ensureValidToken(admin, realmId, clientId, clientSecret);
    const baseUrl = `https://quickbooks.api.intuit.com/v3/company/${realmId}`;
    const correlationId = crypto.randomUUID();

    // Build month range
    const [y, m] = targetMonth.split("-").map(Number);
    const monthStart = `${y}-${String(m).padStart(2, "0")}-01`;
    const lastDay = new Date(y, m, 0).getDate();
    const monthEnd = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

    // Query QBO
    const query = encodeURIComponent(
      `SELECT * FROM Purchase WHERE TxnDate >= '${monthStart}' AND TxnDate <= '${monthEnd}' MAXRESULTS 1000`
    );
    const purchaseRes = await fetchWithTimeout(`${baseUrl}/query?query=${query}`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    });
    if (!purchaseRes.ok) throw new Error(`QBO API failed [${purchaseRes.status}]`);

    const purchaseData = await purchaseRes.json();
    const purchases = purchaseData?.QueryResponse?.Purchase ?? [];

    let landed = 0, skippedExisting = 0;

    // Land purchases
    for (const purchase of purchases) {
      try {
        const result = await landPurchase(admin, purchase, correlationId);
        if (result.alreadyLanded) skippedExisting++;
        else landed++;
      } catch (err) {
        console.error(`Failed to land purchase ${purchase.Id}:`, err);
      }
    }

    // Pre-fetch and land QBO items referenced in new purchases
    const uniqueItemIds = new Set<string>();
    for (const purchase of purchases) {
      for (const line of (purchase.Line ?? [])) {
        if (line.DetailType === "ItemBasedExpenseLineDetail" && line.ItemBasedExpenseLineDetail?.ItemRef?.value) {
          uniqueItemIds.add(line.ItemBasedExpenseLineDetail.ItemRef.value);
        }
      }
    }

    const itemCache = new Map<string, any>();
    const itemIdArray = Array.from(uniqueItemIds);
    const BATCH_SIZE = 5;
    for (let i = 0; i < itemIdArray.length; i += BATCH_SIZE) {
      const batch = itemIdArray.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(id => fetchQboItem(id, itemCache, baseUrl, accessToken)));
      if (i + BATCH_SIZE < itemIdArray.length) await new Promise(r => setTimeout(r, 250));
    }

    for (const [, item] of itemCache) {
      if (item) {
        try { await landQboItem(admin, item, correlationId); } catch { /* ignore */ }
      }
    }

    return new Response(
      JSON.stringify({
        success: true, month: targetMonth,
        total: purchases.length, landed, skipped_existing: skippedExisting,
        items_landed: itemCache.size,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("qbo-sync-purchases error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
