// ============================================================
// v2-repair-purchase-batch-items
// One-shot repair tool for batches whose QBO Items were created
// incorrectly (e.g. PO-669 — items created as NonInventory with
// MPN-as-name). For each placeholder grade-5 SKU on the batch:
//   1. Best-effort delete the existing QBO Item.
//   2. Clear sku.qbo_item_id locally so subsequent qbo-sync-item
//      calls recreate it as Inventory with the right fields.
//   3. Reset purchase_batches.qbo_sync_status to 'pending' and
//      clear qbo_purchase_id so the batch can be re-pushed.
// Returns a per-SKU report.
// ============================================================

import {
  corsHeaders,
  createAdminClient,
  authenticateRequest,
  getQBOConfig,
  qboBaseUrl,
  ensureValidToken,
  fetchWithTimeout,
  jsonResponse,
  errorResponse,
} from "../_shared/qbo-helpers.ts";

interface SkuRow {
  id: string;
  sku_code: string;
  qbo_item_id: string | null;
}

async function fetchItem(baseUrl: string, accessToken: string, itemId: string) {
  const res = await fetchWithTimeout(
    `${baseUrl}/item/${encodeURIComponent(itemId)}?minorversion=65`,
    { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } },
  );
  if (!res.ok) return null;
  const json = await res.json();
  return json?.Item ?? null;
}

/**
 * QBO doesn't allow hard-deleting Items that have been used on
 * transactions. The closest equivalent is to flag the Item as
 * inactive (Active: false) via a sparse update. We try that and
 * report whether it succeeded.
 */
async function deactivateQboItem(baseUrl: string, accessToken: string, itemId: string): Promise<{ ok: boolean; reason?: string }> {
  const item = await fetchItem(baseUrl, accessToken, itemId);
  if (!item) return { ok: false, reason: "item not found in QBO" };

  const payload = {
    Id: item.Id,
    SyncToken: item.SyncToken,
    sparse: true,
    Active: false,
  };

  const res = await fetchWithTimeout(
    `${baseUrl}/item?minorversion=65`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    },
  );
  if (!res.ok) {
    const txt = await res.text();
    return { ok: false, reason: `[${res.status}] ${txt.substring(0, 200)}` };
  }
  return { ok: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const admin = createAdminClient();
    await authenticateRequest(req, admin);

    const body = await req.json().catch(() => ({}));
    const batchId = String(body?.batch_id ?? "").trim();
    if (!batchId) return jsonResponse({ error: "batch_id is required" }, 400);

    // Collect distinct SKU ids tied to this batch
    const { data: units, error: unitsErr } = await admin
      .from("stock_unit")
      .select("sku_id")
      .eq("batch_id" as never, batchId);
    if (unitsErr) throw new Error(`Load units failed: ${unitsErr.message}`);

    const skuIds = Array.from(
      new Set(((units ?? []) as Record<string, unknown>[])
        .map((u) => u.sku_id as string | null)
        .filter((id): id is string => Boolean(id))),
    );

    if (skuIds.length === 0) {
      return jsonResponse({ batch_id: batchId, skus: [], message: "No stock units found for this batch" });
    }

    const { data: skuRows, error: skuErr } = await admin
      .from("sku")
      .select("id, sku_code, qbo_item_id")
      .in("id", skuIds);
    if (skuErr) throw new Error(`Load SKUs failed: ${skuErr.message}`);

    const skus = (skuRows ?? []) as SkuRow[];
    const itemsToDeactivate = skus.filter((s) => s.qbo_item_id);

    let accessToken = "";
    let baseUrl = "";
    if (itemsToDeactivate.length > 0) {
      const { clientId, clientSecret, realmId } = getQBOConfig();
      accessToken = await ensureValidToken(admin, realmId, clientId, clientSecret);
      baseUrl = qboBaseUrl(realmId);
    }

    const report: Array<{ sku_code: string; qbo_item_id: string | null; deactivated: boolean; reason?: string }> = [];
    for (const sku of skus) {
      let deactivated = false;
      let reason: string | undefined;
      if (sku.qbo_item_id) {
        const r = await deactivateQboItem(baseUrl, accessToken, sku.qbo_item_id);
        deactivated = r.ok;
        reason = r.reason;
      } else {
        reason = "no qbo_item_id stored locally";
      }
      report.push({ sku_code: sku.sku_code, qbo_item_id: sku.qbo_item_id, deactivated, reason });
    }

    // Clear all qbo_item_id on those SKUs so re-sync recreates them
    const { error: clearErr } = await admin
      .from("sku")
      .update({ qbo_item_id: null } as never)
      .in("id", skuIds);
    if (clearErr) throw new Error(`Clear qbo_item_id failed: ${clearErr.message}`);

    // Reset the batch so it can be re-pushed
    await admin
      .from("purchase_batches" as never)
      .update({
        qbo_sync_status: "pending",
        qbo_sync_error: null,
        qbo_purchase_id: null,
      } as never)
      .eq("id", batchId);

    // Audit
    await admin.from("audit_event").insert({
      entity_type: "purchase_batch",
      entity_id: crypto.randomUUID(),
      trigger_type: "purchase_batch_qbo_items_repaired",
      actor_type: "user",
      source_system: "admin_v2",
      input_json: { batch_id: batchId } as never,
      output_json: { batch_id: batchId, skus: report } as never,
    } as never);

    return jsonResponse({
      success: true,
      batch_id: batchId,
      skus: report,
      message: "Old QBO items deactivated and local item refs cleared. Now click 'Push to QBO' to recreate them as Inventory items.",
    });
  } catch (err) {
    console.error("v2-repair-purchase-batch-items error:", err);
    return errorResponse(err, 500);
  }
});
