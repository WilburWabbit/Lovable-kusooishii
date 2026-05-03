// ============================================================
// v2-push-purchase-to-qbo
// Pushes a locally-created purchase batch to QuickBooks as a
// Cash Purchase after grading. The QBO lines are built from the final
// graded SKU assignments, so placeholder intake SKUs never reach QBO.
// The returned QBO Id is stored on purchase_batches.qbo_purchase_id.
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

/** Resolve / create the QBO VendorRef for a vendor row. */
async function ensureQboVendor(
  admin: ReturnType<typeof createAdminClient>,
  baseUrl: string,
  accessToken: string,
  vendorId: string,
): Promise<string> {
  const { data: vendor, error: vendorErr } = await admin
    .from("vendor")
    .select("id, display_name, qbo_vendor_id")
    .eq("id", vendorId)
    .single();
  if (vendorErr || !vendor) throw new Error(`Vendor ${vendorId} not found`);

  const v = vendor as Record<string, unknown>;
  if (v.qbo_vendor_id) return v.qbo_vendor_id as string;

  // Create vendor in QBO
  const displayName = v.display_name as string;
  const createRes = await fetchWithTimeout(
    `${baseUrl}/vendor?minorversion=65`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ DisplayName: displayName }),
    },
  );
  if (!createRes.ok) {
    const txt = await createRes.text();
    throw new Error(`QBO vendor create failed [${createRes.status}]: ${txt.substring(0, 300)}`);
  }
  const createJson = await createRes.json();
  const qboId = String(createJson.Vendor.Id);

  await admin
    .from("vendor")
    .update({ qbo_vendor_id: qboId } as never)
    .eq("id", vendorId);

  return qboId;
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

/** Resolve / create QBO item for a final graded SKU. */
async function ensureQboItemForLine(
  admin: ReturnType<typeof createAdminClient>,
  authHeader: string,
  line: LineItemRow,
  supplierVatRegistered: boolean,
): Promise<string> {
  if (line.qbo_item_id) return line.qbo_item_id;

  // Queue the QBO item upsert through the posting outbox, then process it
  // synchronously because the Purchase payload needs the ItemRef immediately.
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const purchaseCost = line.landed_cost_per_unit ?? line.unit_cost;
  const { data: intentId, error: intentErr } = await admin.rpc("queue_qbo_item_posting_intent" as never, {
    p_sku_id: line.sku_id,
    p_purchase_cost: purchaseCost,
    p_supplier_vat_registered: supplierVatRegistered,
  } as never);
  if (intentErr) {
    throw new Error(`QBO item intent failed for ${line.sku_code}: ${intentErr.message}`);
  }

  const res = await fetchWithTimeout(`${supabaseUrl}/functions/v1/accounting-posting-intents-process`, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(intentId ? { intentId } : { batch_size: 5 }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`QBO item posting processor failed for ${line.sku_code} [${res.status}]: ${txt.substring(0, 300)}`);
  }
  const payload = await res.json();
  const results = Array.isArray(payload?.results) ? payload.results as Record<string, unknown>[] : [];
  const itemResult = results.find((row) => row.intent_id === intentId) ?? results[0];
  if (!payload.success || !itemResult || itemResult.status !== "posted") {
    throw new Error(`QBO item posting refused ${line.sku_code}: ${itemResult?.error ?? payload.error ?? "unknown"}`);
  }

  const qboItemId = itemResult.qbo_item_id ? String(itemResult.qbo_item_id) : null;
  if (qboItemId) return qboItemId;

  const { data: refreshedSku } = await admin
    .from("sku")
    .select("qbo_item_id")
    .eq("id", line.sku_id)
    .maybeSingle();
  const refreshedId = (refreshedSku as Record<string, unknown> | null)?.qbo_item_id as string | null;
  if (!refreshedId) throw new Error(`QBO item posting completed for ${line.sku_code} but no qbo_item_id was returned`);
  return refreshedId;
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

    // ─── 1. Load batch + lines + vendor ────────────────────
    const { data: batchRow, error: batchErr } = await admin
      .from("purchase_batches" as never)
      .select("*")
      .eq("id", batchId)
      .single();
    if (batchErr || !batchRow) {
      return jsonResponse({ error: `Batch ${batchId} not found` }, 404);
    }
    const batch = batchRow as Record<string, unknown>;

    if (batch.qbo_purchase_id) {
      return jsonResponse({
        success: true,
        already_synced: true,
        qbo_purchase_id: batch.qbo_purchase_id,
        batch_id: batchId,
      });
    }

    const supplierId = batch.supplier_id as string | null;
    if (!supplierId) {
      await setStatus(admin, batchId, "error", { qbo_sync_error: "Batch has no supplier_id" });
      return jsonResponse({ error: "Batch has no supplier_id" }, 400);
    }

    const lines = await loadGradedPurchaseLines(admin, batchId);
    if (lines.length === 0) {
      await setStatus(admin, batchId, "error", { qbo_sync_error: "Batch has no line items" });
      return jsonResponse({ error: "Batch has no line items" }, 400);
    }

    // ─── 2. Load configured QBO accounts ───────────────────
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
      const msg = "QBO cash/bank account is not configured. Open Settings → QuickBooks → Accounts and choose a Cash/Bank account.";
      await setStatus(admin, batchId, "error", { qbo_sync_error: msg });
      return jsonResponse({ error: msg }, 400);
    }

    const purchaseTaxCode = accounts.get("qbo_purchase_tax_code_id");
    if (!purchaseTaxCode) {
      const msg = "QBO purchase tax code is not configured. Open Settings → QuickBooks → Accounts and choose a Purchase Tax Code.";
      await setStatus(admin, batchId, "error", { qbo_sync_error: msg });
      return jsonResponse({ error: msg }, 400);
    }

    // ─── 3. QBO connection ─────────────────────────────────
    const { clientId, clientSecret, realmId } = getQBOConfig();
    const accessToken = await ensureValidToken(admin, realmId, clientId, clientSecret);
    const baseUrl = qboBaseUrl(realmId);
    const authHeader = req.headers.get("Authorization")!;

    // ─── 4. Ensure vendor exists in QBO ────────────────────
    const vendorRef = await ensureQboVendor(admin, baseUrl, accessToken, supplierId);

    // ─── 5. Ensure each line item has a QBO Item ──────────
    const supplierVatRegistered = Boolean(batch.supplier_vat_registered);
    const itemRefs = new Map<string, string>();
    for (const line of lines) {
      const itemRef = await ensureQboItemForLine(admin, authHeader, line, supplierVatRegistered);
      itemRefs.set(line.id, itemRef);
    }

    // ─── 6. Build QBO Purchase payload (always ex-VAT / TaxExcluded) ──
    // Per business rule: every Purchase posted to QBO must be ex-VAT,
    // mirroring the SalesReceipt flow. Use the QBO-stable line distributor
    // so document totals balance to the penny under QBO's doc-level VAT
    // recompute. `purchaseTaxCode` from settings is honoured for the
    // standard (recoverable) lines; non-VAT-registered suppliers post
    // as No-VAT so QBO records ex-VAT with zero input VAT.
    const lineTaxCode = supplierVatRegistered
      ? (purchaseTaxCode || QBO_TAX_CODE_STANDARD_20)
      : QBO_TAX_CODE_NO_VAT;
    const vatRate = supplierVatRegistered ? 0.2 : 0;

    // Item lines (gross, indexed 0..N-1)
    const itemGrossPence = lines.map((line) =>
      toPence(line.unit_cost * line.quantity),
    );

    // Shared cost lines (gross, indexed N..N+K-1) — appended so a single
    // distributor pass balances item + shared cost VAT against the doc total.
    type SharedCostEntry = {
      label: string;
      accountKey: string;
      defaultLabel: string;
    };
    const sharedCostsRaw = (batch.shared_costs ?? {}) as Record<string, unknown>;
    const sharedCostEntries: { entry: SharedCostEntry; gross: number }[] = [];
    const sharedAccountFor = (key: string): string | undefined => {
      const acc = accounts.get(key);
      return acc;
    };
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
      const accountId = sharedAccountFor(entry.accountKey);
      if (!accountId) {
        const msg = `Batch has shared cost "${entry.label}" (£${amt.toFixed(2)}) but no QBO expense account is mapped for "${entry.defaultLabel}". Open Settings → QuickBooks → Account Mapping and choose an account.`;
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
    // Override the per-line tax code (distributor defaults to STANDARD_20).
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
      // Item line
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
      // Shared cost line → AccountBasedExpenseLineDetail
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

    // DocNumber: prefer the supplier's external receipt/invoice reference
    // (e.g. "510963248") over the internal batch id ("PO-669"). QBO caps
    // DocNumber at 21 chars.
    const docNumber = (
      (batch.reference as string | null)?.trim() || batchId
    ).slice(0, 21);

    const purchasePayload: Record<string, unknown> = {
      PaymentType: "Cash",
      AccountRef: { value: cashAccount },
      EntityRef: { value: vendorRef, type: "Vendor" },
      TxnDate: batch.purchase_date as string,
      DocNumber: docNumber,
      Line: qboLines,
      GlobalTaxCalculation: "TaxExcluded",
    };
    purchasePayload.PrivateNote = batch.reference
      ? `Internal batch: ${batchId} | Supplier ref: ${batch.reference}`
      : `Internal batch: ${batchId}`;

    // ─── 7. POST to QBO ───────────────────────────────────
    const purchaseRes = await fetchWithTimeout(
      `${baseUrl}/purchase?minorversion=65`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(purchasePayload),
      },
    );

    if (!purchaseRes.ok) {
      const txt = await purchaseRes.text();
      const errMsg = `QBO Purchase create failed [${purchaseRes.status}]: ${txt.substring(0, 500)}`;
      console.error(errMsg);
      await setStatus(admin, batchId, "error", { qbo_sync_error: errMsg });
      await audit(admin, actorId, "purchase_batch_qbo_push_failed", { batch_id: batchId, payload: purchasePayload }, { error: errMsg });
      return jsonResponse({ success: false, error: errMsg }, 502);
    }

    const purchaseJson = await purchaseRes.json();
    const qboId = String(purchaseJson.Purchase.Id);

    // ─── 8. Persist + audit ───────────────────────────────
    await setStatus(admin, batchId, "synced", {
      qbo_purchase_id: qboId,
      qbo_sync_error: null,
      status: "recorded",
    });

    await audit(admin, actorId, "purchase_batch_qbo_pushed", { batch_id: batchId }, {
      batch_id: batchId,
      qbo_purchase_id: qboId,
      qbo_doc_number: docNumber,
      vendor_ref: vendorRef,
      line_count: lines.length,
    });

    return jsonResponse({
      success: true,
      batch_id: batchId,
      qbo_purchase_id: qboId,
      vendor_ref: vendorRef,
      line_count: lines.length,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("v2-push-purchase-to-qbo error:", msg);
    if (admin && batchId) {
      try {
        await setStatus(admin, batchId, "error", { qbo_sync_error: msg });
        await audit(admin, actorId, "purchase_batch_qbo_push_failed", { batch_id: batchId }, { error: msg });
      } catch (_) { /* swallow audit errors */ }
    }
    return errorResponse(err, 500);
  }
});
