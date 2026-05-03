// ============================================================
// v2-update-purchase-in-qbo
// Updates an already-pushed purchase batch in QuickBooks.
// Mirrors the payload built by v2-push-purchase-to-qbo, but
// performs a full sparse update (PUT) against the existing
// QBO Purchase identified by purchase_batches.qbo_purchase_id,
// using the latest SyncToken fetched from QBO. Lines are derived
// from final graded SKUs, never from placeholder intake SKUs.
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
import { toPence, fromPence } from "../_shared/vat.ts";
import {
  buildBalancedQBOLines,
  assertQBOPayloadBalances,
  QBOPayloadImbalanceError,
  QBO_TAX_CODE_STANDARD_20,
  QBO_TAX_CODE_NO_VAT,
} from "../_shared/qbo-tax.ts";

interface LineItemRow {
  id: string;
  mpn: string;
  sku_id: string;
  sku_code: string;
  qbo_item_id: string | null;
  quantity: number;
  unit_cost: number;
  landed_cost_per_unit: number | null;
}

async function setStatus(
  admin: ReturnType<typeof createAdminClient>,
  batchId: string,
  status: "pending" | "synced" | "error" | "skipped",
  fields: Record<string, unknown> = {},
) {
  await admin
    .from("purchase_batches" as never)
    .update({
      qbo_sync_status: status,
      qbo_sync_attempted_at: new Date().toISOString(),
      ...fields,
    } as never)
    .eq("id", batchId);
}

async function audit(
  admin: ReturnType<typeof createAdminClient>,
  actorId: string,
  triggerType: string,
  input: unknown,
  output: unknown,
) {
  await admin.from("audit_event").insert({
    entity_type: "purchase_batch",
    entity_id: crypto.randomUUID(),
    trigger_type: triggerType,
    actor_type: actorId === "service-role" ? "system" : "user",
    actor_id: actorId === "service-role" ? null : actorId,
    source_system: "admin_v2",
    input_json: input as never,
    output_json: output as never,
  } as never);
}

async function loadGradedPurchaseLines(
  admin: ReturnType<typeof createAdminClient>,
  batchId: string,
): Promise<LineItemRow[]> {
  const { data: units, error: unitErr } = await admin
    .from("stock_unit")
    .select("id, line_item_id, sku_id, condition_grade, v2_status")
    .eq("batch_id", batchId);
  if (unitErr) throw new Error(`Load stock units failed: ${unitErr.message}`);

  const unitRows = (units ?? []) as Record<string, unknown>[];
  if (unitRows.length === 0) throw new Error("Batch has no stock units");

  const ungraded = unitRows.filter((unit) => !unit.sku_id || String(unit.v2_status ?? "purchased") === "purchased");
  if (ungraded.length > 0) {
    throw new Error(`Batch has ${ungraded.length} ungraded stock unit(s). Push to QBO only after grading is complete.`);
  }

  const lineIds = [...new Set(unitRows.map((unit) => unit.line_item_id).filter((id): id is string => typeof id === "string" && id.length > 0))];
  const skuIds = [...new Set(unitRows.map((unit) => unit.sku_id).filter((id): id is string => typeof id === "string" && id.length > 0))];

  const { data: purchaseLines, error: lineErr } = await admin
    .from("purchase_line_items" as never)
    .select("id, mpn, unit_cost, landed_cost_per_unit")
    .in("id" as never, lineIds);
  if (lineErr) throw new Error(`Load purchase lines failed: ${lineErr.message}`);

  const { data: skus, error: skuErr } = await admin
    .from("sku")
    .select("id, sku_code, qbo_item_id")
    .in("id", skuIds);
  if (skuErr) throw new Error(`Load SKUs failed: ${skuErr.message}`);

  const lineById = new Map<string, Record<string, unknown>>();
  for (const line of (purchaseLines ?? []) as Record<string, unknown>[]) lineById.set(line.id as string, line);

  const skuById = new Map<string, Record<string, unknown>>();
  for (const sku of (skus ?? []) as Record<string, unknown>[]) skuById.set(sku.id as string, sku);

  const grouped = new Map<string, LineItemRow>();
  for (const unit of unitRows) {
    const lineId = unit.line_item_id as string;
    const skuId = unit.sku_id as string;
    const line = lineById.get(lineId);
    const sku = skuById.get(skuId);
    if (!line || !sku) throw new Error("Batch has graded units that no longer match their purchase line or SKU");
    const key = `${lineId}:${skuId}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.quantity += 1;
      continue;
    }
    grouped.set(key, {
      id: key,
      mpn: line.mpn as string,
      sku_id: skuId,
      sku_code: sku.sku_code as string,
      qbo_item_id: (sku.qbo_item_id as string | null) ?? null,
      quantity: 1,
      unit_cost: Number(line.unit_cost ?? 0),
      landed_cost_per_unit: line.landed_cost_per_unit == null ? null : Number(line.landed_cost_per_unit),
    });
  }

  return [...grouped.values()].sort((a, b) => a.sku_code.localeCompare(b.sku_code));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  let batchId = "";
  let admin: ReturnType<typeof createAdminClient> | null = null;
  let actorId = "system";

  try {
    admin = createAdminClient();
    const auth = await authenticateRequest(req, admin);
    actorId = auth.userId;

    const body = await req.json().catch(() => ({}));
    batchId = String(body?.batch_id ?? "").trim();
    if (!batchId) {
      return jsonResponse({ error: "batch_id is required" }, 400);
    }

    // ─── 1. Load batch + lines ────────────────────────────
    const { data: batchRow, error: batchErr } = await admin
      .from("purchase_batches" as never)
      .select("*")
      .eq("id", batchId)
      .single();
    if (batchErr || !batchRow) {
      return jsonResponse({ error: `Batch ${batchId} not found` }, 404);
    }
    const batch = batchRow as Record<string, unknown>;

    const qboPurchaseId = batch.qbo_purchase_id as string | null;
    if (!qboPurchaseId) {
      return jsonResponse(
        { error: "Batch has no qbo_purchase_id — push it to QBO first." },
        400,
      );
    }

    const supplierId = batch.supplier_id as string | null;
    if (!supplierId) {
      return jsonResponse({ error: "Batch has no supplier_id" }, 400);
    }

    const lines = await loadGradedPurchaseLines(admin, batchId);
    if (lines.length === 0) {
      return jsonResponse({ error: "Batch has no line items" }, 400);
    }

    // ─── 2. Load configured QBO accounts ──────────────────
    const { data: settingsRows } = await admin
      .from("qbo_account_settings" as never)
      .select("key, account_id");
    const accounts = new Map<string, string>();
    for (const row of (settingsRows ?? []) as Record<string, unknown>[]) {
      const k = row.key as string;
      const v = row.account_id as string;
      if (k && v) accounts.set(k, v);
    }
    const cashAccount = accounts.get("qbo_cash_account_id");
    if (!cashAccount) {
      const msg =
        "QBO cash/bank account is not configured. Open Settings → QuickBooks → Accounts and choose a Cash/Bank account.";
      return jsonResponse({ error: msg }, 400);
    }
    const purchaseTaxCode = accounts.get("qbo_purchase_tax_code_id");
    if (!purchaseTaxCode) {
      const msg =
        "QBO purchase tax code is not configured. Open Settings → QuickBooks → Accounts and choose a Purchase Tax Code.";
      return jsonResponse({ error: msg }, 400);
    }

    // ─── 3. QBO connection ────────────────────────────────
    const { clientId, clientSecret, realmId } = getQBOConfig();
    const accessToken = await ensureValidToken(admin, realmId, clientId, clientSecret);
    const baseUrl = qboBaseUrl(realmId);

    // ─── 4. Fetch existing Purchase to get vendor + SyncToken ──
    const fetchRes = await fetchWithTimeout(
      `${baseUrl}/purchase/${qboPurchaseId}?minorversion=65`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
      },
    );
    if (!fetchRes.ok) {
      const txt = await fetchRes.text();
      const msg = `Failed to load QBO Purchase ${qboPurchaseId} [${fetchRes.status}]: ${txt.substring(0, 300)}`;
      await setStatus(admin, batchId, "error", { qbo_sync_error: msg });
      return jsonResponse({ success: false, error: msg }, 502);
    }
    const fetchJson = await fetchRes.json();
    const existingPurchase = fetchJson.Purchase ?? {};
    const syncToken = String(existingPurchase.SyncToken ?? "0");
    const existingVendorRef = existingPurchase.EntityRef?.value as string | undefined;
    if (!existingVendorRef) {
      const msg = `QBO Purchase ${qboPurchaseId} has no EntityRef — cannot update.`;
      await setStatus(admin, batchId, "error", { qbo_sync_error: msg });
      return jsonResponse({ success: false, error: msg }, 502);
    }

    // ─── 5. Resolve item refs (must already exist; we don't recreate) ──
    const itemRefs = new Map<string, string>();
    for (const line of lines) {
      if (!line.qbo_item_id) {
        const msg = `QBO item missing for SKU ${line.sku_code} — push the graded SKU item to QBO, then retry this purchase update.`;
        await setStatus(admin, batchId, "error", { qbo_sync_error: msg });
        return jsonResponse({ error: msg }, 400);
      }
      itemRefs.set(line.id, line.qbo_item_id);
    }

    // ─── 6. Build payload (mirrors v2-push-purchase-to-qbo) ──
    const supplierVatRegistered = Boolean(batch.supplier_vat_registered);
    const lineTaxCode = supplierVatRegistered
      ? (purchaseTaxCode || QBO_TAX_CODE_STANDARD_20)
      : QBO_TAX_CODE_NO_VAT;
    const vatRate = supplierVatRegistered ? 0.2 : 0;

    const itemGrossPence = lines.map((line) =>
      toPence(line.unit_cost * line.quantity),
    );

    type SharedCostEntry = {
      label: string;
      accountKey: string;
      defaultLabel: string;
    };
    const sharedCostsRaw = (batch.shared_costs ?? {}) as Record<string, unknown>;
    const sharedCostEntries: { entry: SharedCostEntry; gross: number }[] = [];
    const sharedDefs: Array<{ field: string; entry: SharedCostEntry }> = [
      {
        field: "shipping",
        entry: {
          label: "Shipping / postage",
          accountKey: "qbo_shipping_expense_account_id",
          defaultLabel: "Shipping",
        },
      },
      {
        field: "broker_fee",
        entry: {
          label: "Broker / buying fee",
          accountKey: "qbo_broker_fee_expense_account_id",
          defaultLabel: "Broker fee",
        },
      },
      {
        field: "other",
        entry: {
          label: (sharedCostsRaw.other_label as string)?.trim() || "Other purchase cost",
          accountKey: "qbo_other_purchase_expense_account_id",
          defaultLabel: "Other",
        },
      },
    ];
    for (const { field, entry } of sharedDefs) {
      const raw = sharedCostsRaw[field];
      const amt = typeof raw === "number" ? raw : Number(raw ?? 0);
      if (!amt || amt <= 0) continue;
      const accountId = accounts.get(entry.accountKey);
      if (!accountId) {
        const msg = `Batch has shared cost "${entry.label}" (£${amt.toFixed(2)}) but no QBO expense account is mapped for "${entry.defaultLabel}". Open Settings → QuickBooks → Account Mapping.`;
        await setStatus(admin, batchId, "error", { qbo_sync_error: msg });
        return jsonResponse({ error: msg }, 400);
      }
      sharedCostEntries.push({ entry, gross: toPence(amt) });
    }

    const grossPenceLines = [
      ...itemGrossPence,
      ...sharedCostEntries.map((s) => s.gross),
    ];
    const totalGrossPence = grossPenceLines.reduce((s, g) => s + g, 0);

    let stableLines = buildBalancedQBOLines(grossPenceLines, vatRate);
    stableLines = stableLines.map((l) => ({
      ...l,
      taxCodeRef: l.kind === "rounding" ? QBO_TAX_CODE_NO_VAT : lineTaxCode,
    }));

    try {
      assertQBOPayloadBalances(stableLines, totalGrossPence, vatRate);
    } catch (e) {
      if (e instanceof QBOPayloadImbalanceError) {
        await setStatus(admin, batchId, "error", { qbo_sync_error: e.message });
        return jsonResponse({ success: false, error: e.message }, 500);
      }
      throw e;
    }

    const itemCount = lines.length;
    const qboLines = stableLines.map((s) => {
      const lineNet = fromPence(s.netPence);
      if (s.kind === "rounding") {
        return {
          DetailType: "ItemBasedExpenseLineDetail",
          Amount: lineNet,
          Description: "Rounding adjustment (per-line VAT recompute)",
          ItemBasedExpenseLineDetail: {
            ItemRef: { value: itemRefs.get(lines[0].id)! },
            Qty: 1,
            UnitPrice: lineNet,
            TaxCodeRef: { value: QBO_TAX_CODE_NO_VAT },
          },
        };
      }
      const idx = s.sourceIndex!;
      if (idx < itemCount) {
        const src = lines[idx];
        const qty = src.quantity;
        const unitNet = qty > 0 ? Math.round((lineNet / qty) * 100) / 100 : lineNet;
        return {
          DetailType: "ItemBasedExpenseLineDetail",
          Amount: lineNet,
          Description: src.sku_code,
          ItemBasedExpenseLineDetail: {
            ItemRef: { value: itemRefs.get(src.id)! },
            Qty: qty,
            UnitPrice: unitNet,
            TaxCodeRef: { value: s.taxCodeRef },
          },
        };
      }
      const shared = sharedCostEntries[idx - itemCount];
      const accountId = accounts.get(shared.entry.accountKey)!;
      return {
        DetailType: "AccountBasedExpenseLineDetail",
        Amount: lineNet,
        Description: shared.entry.label,
        AccountBasedExpenseLineDetail: {
          AccountRef: { value: accountId },
          TaxCodeRef: { value: s.taxCodeRef },
        },
      };
    });

    const docNumber = (
      (batch.reference as string | null)?.trim() || batchId
    ).slice(0, 21);

    const updatePayload: Record<string, unknown> = {
      Id: qboPurchaseId,
      SyncToken: syncToken,
      sparse: true,
      PaymentType: "Cash",
      AccountRef: { value: cashAccount },
      EntityRef: { value: existingVendorRef, type: "Vendor" },
      TxnDate: batch.purchase_date as string,
      DocNumber: docNumber,
      Line: qboLines,
      GlobalTaxCalculation: "TaxExcluded",
      PrivateNote: batch.reference
        ? `Internal batch: ${batchId} | Supplier ref: ${batch.reference}`
        : `Internal batch: ${batchId}`,
    };

    // ─── 7. PUT to QBO ────────────────────────────────────
    const updateRes = await fetchWithTimeout(
      `${baseUrl}/purchase?minorversion=65`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(updatePayload),
      },
    );

    if (!updateRes.ok) {
      const txt = await updateRes.text();
      const errMsg = `QBO Purchase update failed [${updateRes.status}]: ${txt.substring(0, 500)}`;
      console.error(errMsg);
      await setStatus(admin, batchId, "error", { qbo_sync_error: errMsg });
      await audit(
        admin,
        actorId,
        "purchase_batch_qbo_update_failed",
        { batch_id: batchId, payload: updatePayload },
        { error: errMsg },
      );
      return jsonResponse({ success: false, error: errMsg }, 502);
    }

    const updateJson = await updateRes.json();
    const newSyncToken = String(updateJson.Purchase?.SyncToken ?? syncToken);

    await setStatus(admin, batchId, "synced", { qbo_sync_error: null });

    await audit(
      admin,
      actorId,
      "purchase_batch_qbo_updated",
      { batch_id: batchId },
      {
        batch_id: batchId,
        qbo_purchase_id: qboPurchaseId,
        sync_token: newSyncToken,
        line_count: lines.length,
      },
    );

    return jsonResponse({
      success: true,
      batch_id: batchId,
      qbo_purchase_id: qboPurchaseId,
      sync_token: newSyncToken,
      line_count: lines.length,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("v2-update-purchase-in-qbo error:", msg);
    if (admin && batchId) {
      try {
        await setStatus(admin, batchId, "error", { qbo_sync_error: msg });
        await audit(admin, actorId, "purchase_batch_qbo_update_failed", { batch_id: batchId }, { error: msg });
      } catch (_) { /* swallow */ }
    }
    return errorResponse(err, 500);
  }
});
