// ============================================================
// v2-delete-purchase-batch
// Deletes a purchase batch end-to-end:
//   1. Guards: refuses if any stock unit has been sold/listed/shipped.
//   2. Deletes the linked QBO Purchase (if `reference` looks like a QBO ID
//      AND we can find a matching Purchase in QBO).
//   3. Deletes local stock_unit rows, purchase_line_items, then the batch.
//   4. If the batch was QBO-originated, also clears the inbound_receipt
//      and resets the landing record so it can be re-ingested cleanly.
//   5. Writes a `purchase_batch_deleted` audit_event.
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";

type SupabaseAdminClient = ReturnType<typeof createClient>;
type QboDeleteResult = { deleted: boolean; reason?: string };
type QboResult = QboDeleteResult | { skipped: true };
type RoleRow = { role?: string | null };
type PurchaseBatchRow = {
  id: string;
  reference: string | null;
  supplier_name: string | null;
  status: string | null;
  qbo_purchase_id: string | null;
};
type StockUnitGuardRow = {
  id: string;
  status: string | null;
  v2_status: string | null;
  order_id: string | null;
};
type IdRow = { id: string };

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const FETCH_TIMEOUT_MS = 30_000;
function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

async function ensureValidToken(admin: SupabaseAdminClient, realmId: string, clientId: string, clientSecret: string): Promise<string> {
  const { data: conn, error } = await admin.from("qbo_connection").select("*").eq("realm_id", realmId).single();
  if (error || !conn) throw new Error("No QBO connection found.");
  if (new Date(conn.token_expires_at).getTime() - Date.now() < 5 * 60 * 1000) {
    const tokenRes = await fetchWithTimeout("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(conn.refresh_token)}`,
    });
    if (!tokenRes.ok) throw new Error(`QBO token refresh failed: ${await tokenRes.text()}`);
    const tokens = await tokenRes.json();
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
    await admin.from("qbo_connection").update({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_expires_at: expiresAt,
    }).eq("realm_id", realmId);
    return tokens.access_token;
  }
  return conn.access_token;
}

/** Best-effort: delete a Purchase in QBO. Returns whether it was deleted. */
async function deleteQboPurchase(baseUrl: string, accessToken: string, purchaseId: string): Promise<{ deleted: boolean; reason?: string }> {
  try {
    const getRes = await fetchWithTimeout(
      `${baseUrl}/purchase/${encodeURIComponent(purchaseId)}?minorversion=65`,
      { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } },
    );
    if (getRes.status === 404) return { deleted: false, reason: "not_found_in_qbo" };
    if (!getRes.ok) return { deleted: false, reason: `fetch_failed_${getRes.status}` };
    const getJson = await getRes.json();
    const syncToken = getJson?.Purchase?.SyncToken;
    if (syncToken === undefined) return { deleted: false, reason: "missing_sync_token" };

    const delRes = await fetchWithTimeout(
      `${baseUrl}/purchase?operation=delete&minorversion=65`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ Id: purchaseId, SyncToken: String(syncToken) }),
      },
    );
    if (!delRes.ok) {
      const body = await delRes.text();
      return { deleted: false, reason: `delete_failed_${delRes.status}: ${body.substring(0, 200)}` };
    }
    return { deleted: true };
  } catch (e) {
    return { deleted: false, reason: `exception: ${e instanceof Error ? e.message : String(e)}` };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRoleKey);
    const token = authHeader.replace("Bearer ", "");
    const isServiceRole = token === serviceRoleKey;
    let actorId: string | null = null;

    if (!isServiceRole) {
      const { data: { user }, error: userError } = await admin.auth.getUser(token);
      if (userError || !user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      actorId = user.id;

      // Role check: admin or staff
      const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", user.id);
      const allowed = ((roles ?? []) as RoleRow[]).some((r) => r.role === "admin" || r.role === "staff");
      if (!allowed) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const body = await req.json().catch(() => ({}));
    const batchId = String(body?.batch_id ?? "").trim();
    const skipQbo = Boolean(body?.skip_qbo);
    if (!batchId) {
      return new Response(JSON.stringify({ error: "batch_id is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── 1. Load batch ────────────────────────────────────────
    const { data: batch, error: batchErr } = await admin
      .from("purchase_batches")
      .select("id, reference, supplier_name, status, qbo_purchase_id")
      .eq("id", batchId)
      .maybeSingle();
    if (batchErr) throw new Error(`Load batch failed: ${batchErr.message}`);
    if (!batch) {
      return new Response(JSON.stringify({ error: `Batch ${batchId} not found` }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const batchRow = batch as PurchaseBatchRow;

    // ── 2. Safety: refuse if any unit is sold / listed / shipped ─────
    const { data: units, error: unitsErr } = await admin
      .from("stock_unit")
      .select("id, status, v2_status, order_id")
      .eq("batch_id", batchId);
    if (unitsErr) throw new Error(`Load units failed: ${unitsErr.message}`);

    const blockedStatuses = new Set(["sold", "shipped", "delivered", "listed", "reserved"]);
    const blockedDbStatuses = new Set(["closed", "shipped", "delivered", "reserved"]);
    const unitRows = (units ?? []) as StockUnitGuardRow[];
    const blocking = unitRows.filter((u) =>
      u.order_id ||
      blockedStatuses.has(String(u.v2_status ?? "")) ||
      blockedDbStatuses.has(String(u.status ?? ""))
    );
    if (blocking.length > 0) {
      return new Response(JSON.stringify({
        error: `Cannot delete: ${blocking.length} unit(s) have been listed, sold or shipped. Process returns or write-offs first.`,
        blocking_count: blocking.length,
      }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── 3. Decide if `reference` is a QBO Purchase id ────────
    // Heuristic: matches inbound_receipt.qbo_purchase_id == reference.
    let qboPurchaseId: string | null = batchRow.qbo_purchase_id ?? null;
    let inboundReceiptId: string | null = null;
    let landingId: string | null = null;
    if (!qboPurchaseId && batchRow.reference) {
      const { data: receipt } = await admin
        .from("inbound_receipt")
        .select("id, qbo_purchase_id")
        .eq("qbo_purchase_id", batchRow.reference)
        .maybeSingle();
      if (receipt) {
        const receiptRow = receipt as { id: string; qbo_purchase_id: string };
        qboPurchaseId = receiptRow.qbo_purchase_id;
        inboundReceiptId = receiptRow.id;
        const { data: landing } = await admin
          .from("landing_raw_qbo_purchase")
          .select("id")
          .eq("external_id", qboPurchaseId)
          .maybeSingle();
        if (landing) landingId = (landing as IdRow).id;
      }
    }

    // ── 4. Delete in QBO if linked ───────────────────────────
    let qboResult: QboResult = { skipped: true };
    if (qboPurchaseId && !skipQbo) {
      const realmId = Deno.env.get("QBO_REALM_ID");
      const clientId = Deno.env.get("QBO_CLIENT_ID");
      const clientSecret = Deno.env.get("QBO_CLIENT_SECRET");
      if (realmId && clientId && clientSecret) {
        try {
          const accessToken = await ensureValidToken(admin, realmId, clientId, clientSecret);
          const baseUrl = `https://quickbooks.api.intuit.com/v3/company/${realmId}`;
          qboResult = await deleteQboPurchase(baseUrl, accessToken, qboPurchaseId);
        } catch (e) {
          qboResult = { deleted: false, reason: `qbo_token_error: ${e instanceof Error ? e.message : String(e)}` };
        }
      } else {
        qboResult = { deleted: false, reason: "qbo_credentials_missing" };
      }
    }

    // ── 5. Local cleanup ─────────────────────────────────────
    // Stock units first (safe to hard-delete because we already guarded out sold/shipped).
    if (unitRows.length > 0) {
      const unitIds = unitRows.map((u) => u.id);
      const { error: unitsDelErr } = await admin.from("stock_unit").delete().in("id", unitIds);
      if (unitsDelErr) throw new Error(`Delete units failed: ${unitsDelErr.message}`);
    }
    // Purchase line items.
    const { error: liDelErr } = await admin.from("purchase_line_items").delete().eq("batch_id", batchId);
    if (liDelErr) throw new Error(`Delete line items failed: ${liDelErr.message}`);

    // Inbound receipt (if QBO-originated): clear lines and the receipt itself,
    // and reset the landing record so it can be re-ingested.
    if (inboundReceiptId) {
      // Detach any sold units from the receipt lines (none should exist since we blocked above, but be defensive).
      const { data: rLines } = await admin.from("inbound_receipt_line").select("id").eq("inbound_receipt_id", inboundReceiptId);
      const rLineIds = ((rLines ?? []) as IdRow[]).map((l) => l.id);
      if (rLineIds.length > 0) {
        await admin.from("stock_unit").update({ inbound_receipt_line_id: null }).in("inbound_receipt_line_id", rLineIds);
        await admin.from("inbound_receipt_line").delete().eq("inbound_receipt_id", inboundReceiptId);
      }
      await admin.from("inbound_receipt").delete().eq("id", inboundReceiptId);
    }
    if (landingId) {
      await admin
        .from("landing_raw_qbo_purchase")
        .update({ status: "pending", error_message: null, processed_at: null })
        .eq("id", landingId);
    }

    // The batch itself.
    const { error: batchDelErr } = await admin.from("purchase_batches").delete().eq("id", batchId);
    if (batchDelErr) throw new Error(`Delete batch failed: ${batchDelErr.message}`);

    // ── 6. Audit ─────────────────────────────────────────────
    await admin.from("audit_event").insert({
      entity_type: "purchase_batch",
      entity_id: crypto.randomUUID(),
      trigger_type: "purchase_batch_deleted",
      actor_type: isServiceRole ? "system" : "user",
      actor_id: actorId,
      source_system: "admin_v2",
      input_json: { batch_id: batchId, skip_qbo: skipQbo },
      output_json: {
        batch_id: batchId,
        supplier_name: batchRow.supplier_name,
        units_deleted: unitRows.length,
        qbo_purchase_id: qboPurchaseId,
        qbo_result: qboResult,
        inbound_receipt_id: inboundReceiptId,
        landing_reset: Boolean(landingId),
      },
    });

    return new Response(JSON.stringify({
      success: true,
      batch_id: batchId,
      units_deleted: unitRows.length,
      qbo_purchase_id: qboPurchaseId,
      qbo_result: qboResult,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("v2-delete-purchase-batch error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
