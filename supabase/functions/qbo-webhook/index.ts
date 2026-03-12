import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * QBO Webhook Receiver — Targeted Entity Processing
 *
 * Receives POST notifications from Intuit when entities change.
 * Validates HMAC-SHA256 signature, then fetches the SINGLE changed entity
 * by ID and processes it inline (no full re-sync).
 *
 * Watched entities: Purchase, SalesReceipt, RefundReceipt, Customer, Item
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, intuit-signature, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ────────────────────────────────────────────────────────────
// Shared helpers (inlined — edge functions can't share files)
// ────────────────────────────────────────────────────────────

async function ensureValidToken(admin: any, realmId: string, clientId: string, clientSecret: string) {
  const { data: conn, error } = await admin
    .from("qbo_connection").select("*").eq("realm_id", realmId).single();
  if (error || !conn) throw new Error("No QBO connection found.");

  if (new Date(conn.token_expires_at).getTime() - Date.now() < 5 * 60 * 1000) {
    const tokenRes = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
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
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_expires_at: expiresAt,
    }).eq("realm_id", realmId);
    return tokens.access_token;
  }
  return conn.access_token;
}

async function fetchQboEntity(baseUrl: string, accessToken: string, entityPath: string): Promise<any | null> {
  const res = await fetch(`${baseUrl}/${entityPath}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (!res.ok) {
    console.error(`QBO fetch ${entityPath} failed [${res.status}]: ${await res.text()}`);
    return null;
  }
  return await res.json();
}

function parseSku(sku: string): { mpn: string; conditionGrade: string } {
  const trimmed = sku.trim();
  const dotIndex = trimmed.indexOf(".");
  let mpn: string, conditionGrade: string;
  if (dotIndex > 0) {
    mpn = trimmed.substring(0, dotIndex);
    conditionGrade = trimmed.substring(dotIndex + 1) || "1";
  } else {
    mpn = trimmed;
    conditionGrade = "1";
  }
  if (!["1", "2", "3", "4", "5"].includes(conditionGrade)) conditionGrade = "1";
  return { mpn, conditionGrade };
}

function cleanQboName(raw: string): string {
  return raw.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

async function resolveVatRateId(admin: any, txnTaxDetail: any): Promise<string | null> {
  const taxLines = txnTaxDetail?.TaxLine ?? [];
  if (taxLines.length === 0) return null;
  const taxRateRef = taxLines[0]?.TaxLineDetail?.TaxRateRef?.value;
  if (!taxRateRef) return null;
  const { data: vr } = await admin.from("vat_rate").select("id").eq("qbo_tax_rate_id", String(taxRateRef)).maybeSingle();
  return vr?.id ?? null;
}

async function resolveSkuFromQboItem(admin: any, baseUrl: string, accessToken: string, itemRefValue: string, itemRefName: string | null): Promise<{ skuId: string | null; skuCode: string | null }> {
  const itemData = await fetchQboEntity(baseUrl, accessToken, `item/${itemRefValue}`);
  const qboItem = itemData?.Item ?? null;
  const skuField = qboItem?.Sku;
  // Use the raw QBO SKU verbatim as sku_code
  let skuCode: string | null = null;
  if (skuField && String(skuField).trim()) {
    skuCode = String(skuField).trim();
  } else if (itemRefName) {
    skuCode = String(itemRefName).trim();
  }
  if (!skuCode) return { skuId: null, skuCode: null };
  const { data: sku } = await admin.from("sku").select("id").eq("sku_code", skuCode).maybeSingle();
  return { skuId: sku?.id ?? null, skuCode };
}

// ────────────────────────────────────────────────────────────
// Signature verification
// ────────────────────────────────────────────────────────────

async function verifySignature(body: string, signature: string, verifierToken: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(verifierToken), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  const computed = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return computed === signature;
}

// ────────────────────────────────────────────────────────────
// Entity handlers
// ────────────────────────────────────────────────────────────

async function handlePurchase(admin: any, baseUrl: string, accessToken: string, entityId: string, operation: string): Promise<string> {
  if (operation === "Delete") {
    const { data: receipt } = await admin.from("inbound_receipt").select("id").eq("qbo_purchase_id", entityId).maybeSingle();
    if (!receipt) return "no matching receipt found";
    // Delete stock units linked to this receipt's lines
    const { data: lines } = await admin.from("inbound_receipt_line").select("id").eq("inbound_receipt_id", receipt.id);
    const lineIds = (lines ?? []).map((l: any) => l.id);
    if (lineIds.length > 0) {
      await admin.from("stock_unit").delete().in("inbound_receipt_line_id", lineIds);
    }
    await admin.from("inbound_receipt_line").delete().eq("inbound_receipt_id", receipt.id);
    await admin.from("inbound_receipt").delete().eq("id", receipt.id);
    return `deleted receipt + ${lineIds.length} lines + stock units`;
  }

  // Create / Update — fetch single purchase from QBO
  const data = await fetchQboEntity(baseUrl, accessToken, `purchase/${entityId}`);
  const purchase = data?.Purchase;
  if (!purchase) return "could not fetch purchase from QBO";

  const hasItemLines = (purchase.Line ?? []).some((l: any) => l.DetailType === "ItemBasedExpenseLineDetail");
  if (!hasItemLines) return "skipped — no item lines";

  const vendorName = purchase.EntityRef?.name ?? null;
  const txnDate = purchase.TxnDate ?? null;
  const totalAmount = purchase.TotalAmt ?? 0;
  const currency = purchase.CurrencyRef?.value ?? "GBP";
  const globalTaxCalc = purchase.GlobalTaxCalculation ?? null;
  const taxTotal = purchase.TxnTaxDetail?.TotalTax ?? 0;

  const { data: receipt, error: receiptErr } = await admin
    .from("inbound_receipt")
    .upsert({
      qbo_purchase_id: entityId,
      vendor_name: vendorName,
      txn_date: txnDate,
      total_amount: totalAmount,
      currency,
      raw_payload: purchase,
      tax_total: taxTotal,
      global_tax_calculation: globalTaxCalc,
    }, { onConflict: "qbo_purchase_id" })
    .select("id, status")
    .single();

  if (receiptErr) return `upsert error: ${receiptErr.message}`;

  // If already processed, skip (manual re-process needed)
  if (receipt.status === "processed") return "already processed — skipped";

  // Delete old lines and re-create
  await admin.from("inbound_receipt_line").delete().eq("inbound_receipt_id", receipt.id);

  const lines = (purchase.Line ?? []).filter((l: any) =>
    l.DetailType === "ItemBasedExpenseLineDetail" || l.DetailType === "AccountBasedExpenseLineDetail"
  );

  const lineRows: any[] = [];
  for (const line of lines) {
    const detail = line.ItemBasedExpenseLineDetail ?? line.AccountBasedExpenseLineDetail ?? {};
    const isStockLine = line.DetailType === "ItemBasedExpenseLineDetail";
    let mpn: string | null = null;
    let conditionGrade: string | null = null;

    let rawSkuCode: string | null = null;
    if (isStockLine && detail.ItemRef?.value) {
      const itemData = await fetchQboEntity(baseUrl, accessToken, `item/${detail.ItemRef.value}`);
      const qboItem = itemData?.Item ?? null;
      const skuField = qboItem?.Sku;
      if (skuField && String(skuField).trim()) {
        rawSkuCode = String(skuField).trim();
        const parsed = parseSku(String(skuField));
        mpn = parsed.mpn;
        conditionGrade = parsed.conditionGrade;
      } else if (detail.ItemRef?.name) {
        rawSkuCode = String(detail.ItemRef.name).trim();
        const parsed = parseSku(String(detail.ItemRef.name));
        mpn = parsed.mpn;
        conditionGrade = parsed.conditionGrade;
      }
    }

    const taxCodeRef = detail.TaxCodeRef?.value ?? null;
    lineRows.push({
      inbound_receipt_id: receipt.id,
      description: line.Description ?? detail.ItemRef?.name ?? "No description",
      quantity: detail.Qty ?? 1,
      unit_cost: detail.UnitPrice ?? line.Amount ?? 0,
      line_total: line.Amount ?? 0,
      qbo_item_id: detail.ItemRef?.value ?? null,
      is_stock_line: isStockLine,
      mpn,
      condition_grade: conditionGrade,
      qbo_tax_code_ref: taxCodeRef,
      sku_code: rawSkuCode,
    });
  }

  if (lineRows.length === 0) return "no lines to process";

  const { data: insertedLines, error: insertErr } = await admin
    .from("inbound_receipt_line").insert(lineRows).select("id, mpn, condition_grade, is_stock_line, qbo_tax_code_ref");
  if (insertErr) return `line insert error: ${insertErr.message}`;

  // Resolve tax codes
  for (const il of (insertedLines ?? [])) {
    if (il.qbo_tax_code_ref) {
      const { data: tc } = await admin.from("tax_code").select("id").eq("qbo_tax_code_id", il.qbo_tax_code_ref).maybeSingle();
      if (tc) await admin.from("inbound_receipt_line").update({ tax_code_id: tc.id }).eq("id", il.id);
    }
  }

  // Auto-process: create SKUs + stock units
  const stockLines = lineRows.filter(l => l.is_stock_line && l.mpn && l.condition_grade);
  const overheadLines = lineRows.filter(l => !l.is_stock_line);

  if (stockLines.length === 0) return "upserted receipt — no stock lines to auto-process";
  const unmapped = lineRows.filter(l => l.is_stock_line && (!l.mpn || !l.condition_grade));
  if (unmapped.length > 0) return `upserted receipt — ${unmapped.length} unmapped stock lines, left pending`;

  const totalOverhead = overheadLines.reduce((s, l) => s + Number(l.line_total), 0);
  const totalStockCost = stockLines.reduce((s, l) => s + Number(l.line_total), 0);
  const validGrades = ["1", "2", "3", "4", "5"];
  let unitsCreated = 0;

  for (let i = 0; i < stockLines.length; i++) {
    const line = stockLines[i];
    const cg = validGrades.includes(line.condition_grade!) ? line.condition_grade! : "1";
    // Use raw sku_code from line if available, otherwise reconstruct from mpn + grade
    const skuCode = line.sku_code || (cg !== "1" ? `${line.mpn}.${cg}` : line.mpn!);
    const { data: product } = await admin.from("product").select("id").eq("mpn", line.mpn).maybeSingle();
    const lineTotal = Number(line.line_total);
    const lineOverhead = totalStockCost > 0 ? totalOverhead * (lineTotal / totalStockCost) : 0;
    const overheadPerUnit = line.quantity > 0 ? lineOverhead / line.quantity : 0;
    const landedCost = Math.round((Number(line.unit_cost) + overheadPerUnit) * 100) / 100;

    let { data: sku } = await admin.from("sku").select("id").eq("sku_code", skuCode).maybeSingle();
    if (!sku) {
      const { data: newSku, error: skuErr } = await admin.from("sku").insert({
        product_id: product?.id ?? null,
        condition_grade: cg,
        sku_code: skuCode,
        name: cleanQboName(line.description ?? line.mpn),
        price: landedCost,
        active_flag: true,
        saleable_flag: !!product,
      }).select("id").single();
      if (skuErr) { console.error("SKU create error:", skuErr); continue; }
      sku = newSku;
    }

    const receiptLineId = insertedLines?.[lineRows.indexOf(line)]?.id ?? null;

    // Shortfall guard: only insert units not already created for this receipt line
    let shortfall = line.quantity;
    if (receiptLineId) {
      const { count } = await admin.from("stock_unit").select("id", { count: "exact", head: true }).eq("inbound_receipt_line_id", receiptLineId);
      shortfall = line.quantity - (count ?? 0);
    }
    if (shortfall <= 0) { continue; }

    const stockUnits = [];
    for (let j = 0; j < shortfall; j++) {
      stockUnits.push({
        sku_id: sku!.id,
        mpn: line.mpn,
        condition_grade: cg,
        status: "available",
        landed_cost: landedCost,
        supplier_id: vendorName,
        inbound_receipt_line_id: receiptLineId,
      });
    }
    const { error: suErr } = await admin.from("stock_unit").insert(stockUnits);
    if (suErr) { console.error("Stock unit insert error:", suErr); continue; }
    unitsCreated += stockUnits.length;
  }

  await admin.from("inbound_receipt").update({ status: "processed", processed_at: new Date().toISOString() }).eq("id", receipt.id);
  return `processed — ${unitsCreated} stock units created`;
}

async function handleSalesReceipt(admin: any, baseUrl: string, accessToken: string, entityId: string, operation: string): Promise<string> {
  const originChannel = "qbo";

  if (operation === "Delete") {
    const { data: order } = await admin.from("sales_order").select("id").eq("origin_channel", originChannel).eq("origin_reference", entityId).maybeSingle();
    if (!order) return "no matching order found";
    // Reopen stock units linked to this order's lines
    const { data: orderLines } = await admin.from("sales_order_line").select("stock_unit_id").eq("sales_order_id", order.id);
    for (const ol of (orderLines ?? [])) {
      if (ol.stock_unit_id) {
        await admin.from("stock_unit").update({ status: "available" }).eq("id", ol.stock_unit_id);
      }
    }
    await admin.from("sales_order_line").delete().eq("sales_order_id", order.id);
    await admin.from("sales_order").delete().eq("id", order.id);
    return `deleted order + reopened stock`;
  }

  // Create / Update
  const data = await fetchQboEntity(baseUrl, accessToken, `salesreceipt/${entityId}`);
  const receipt = data?.SalesReceipt;
  if (!receipt) return "could not fetch SalesReceipt from QBO";

  // Check idempotency
  const { data: existing } = await admin.from("sales_order").select("id").eq("origin_channel", originChannel).eq("origin_reference", String(receipt.Id)).maybeSingle();
  if (existing) {
    // Update: delete old and re-create
    const { data: oldLines } = await admin.from("sales_order_line").select("stock_unit_id").eq("sales_order_id", existing.id);
    for (const ol of (oldLines ?? [])) {
      if (ol.stock_unit_id) await admin.from("stock_unit").update({ status: "available" }).eq("id", ol.stock_unit_id);
    }
    await admin.from("sales_order_line").delete().eq("sales_order_id", existing.id);
    await admin.from("sales_order").delete().eq("id", existing.id);
  }

  const customerName = receipt.CustomerRef?.name ?? "QBO Customer";
  const customerRefValue = receipt.CustomerRef?.value ? String(receipt.CustomerRef.value) : null;
  const txnDate = receipt.TxnDate ?? null;
  const totalAmount = receipt.TotalAmt ?? 0;
  const currency = receipt.CurrencyRef?.value ?? "GBP";
  const globalTaxCalc = receipt.GlobalTaxCalculation ?? null;
  const taxTotal = receipt.TxnTaxDetail?.TotalTax ?? 0;

  let merchandiseSubtotal: number, grossTotal: number;
  if (globalTaxCalc === "TaxInclusive") {
    merchandiseSubtotal = totalAmount - taxTotal;
    grossTotal = totalAmount;
  } else {
    merchandiseSubtotal = totalAmount;
    grossTotal = totalAmount + taxTotal;
  }

  const itemLines = (receipt.Line ?? []).filter((l: any) => l.DetailType === "SalesItemLineDetail" && l.SalesItemLineDetail?.ItemRef?.value);
  if (itemLines.length === 0) return "skipped — no item lines";

  let customerId: string | null = null;
  if (customerRefValue) {
    const { data: cust } = await admin.from("customer").select("id").eq("qbo_customer_id", customerRefValue).maybeSingle();
    customerId = cust?.id ?? null;
  }

  const vatRateId = await resolveVatRateId(admin, receipt.TxnTaxDetail);

  const { data: order, error: orderErr } = await admin.from("sales_order").insert({
    origin_channel: originChannel,
    origin_reference: String(receipt.Id),
    status: "complete",
    guest_name: customerName,
    guest_email: `qbo-sale-${receipt.Id}@imported.local`,
    shipping_name: customerName,
    merchandise_subtotal: merchandiseSubtotal,
    tax_total: taxTotal,
    gross_total: grossTotal,
    global_tax_calculation: globalTaxCalc,
    currency,
    customer_id: customerId,
    txn_date: txnDate,
    doc_number: receipt.DocNumber ?? null,
    notes: `Imported from QBO SalesReceipt #${receipt.DocNumber ?? receipt.Id}`,
  }).select("id").single();

  if (orderErr) return `order insert error: ${orderErr.message}`;

  let linesCreated = 0, stockMatched = 0;

  for (const line of itemLines) {
    const detail = line.SalesItemLineDetail;
    const qty = detail.Qty ?? 1;
    const unitPrice = detail.UnitPrice ?? 0;
    const taxCodeRef = detail.TaxCodeRef?.value ?? null;

    const { skuId } = await resolveSkuFromQboItem(admin, baseUrl, accessToken, detail.ItemRef.value, detail.ItemRef?.name ?? null);
    if (!skuId) { console.warn(`No SKU for QBO item ${detail.ItemRef.value}`); continue; }

    let lineTaxCodeId: string | null = null;
    if (taxCodeRef) {
      const { data: tc } = await admin.from("tax_code").select("id").eq("qbo_tax_code_id", String(taxCodeRef)).maybeSingle();
      lineTaxCodeId = tc?.id ?? null;
    }

    for (let i = 0; i < qty; i++) {
      const { data: stockUnit } = await admin.from("stock_unit").select("id").eq("sku_id", skuId).eq("status", "available").order("created_at", { ascending: true }).limit(1).maybeSingle();

      await admin.from("sales_order_line").insert({
        sales_order_id: order.id,
        sku_id: skuId,
        quantity: 1,
        unit_price: unitPrice,
        line_total: unitPrice,
        stock_unit_id: stockUnit?.id ?? null,
        qbo_tax_code_ref: taxCodeRef,
        vat_rate_id: vatRateId,
        tax_code_id: lineTaxCodeId,
      });
      linesCreated++;

      if (stockUnit) {
        await admin.from("stock_unit").update({ status: "closed" }).eq("id", stockUnit.id);
        stockMatched++;
      }
    }
  }

  return `created order — ${linesCreated} lines, ${stockMatched} stock matched`;
}

async function handleRefundReceipt(admin: any, baseUrl: string, accessToken: string, entityId: string, operation: string): Promise<string> {
  const originChannel = "qbo_refund";

  if (operation === "Delete") {
    const { data: order } = await admin.from("sales_order").select("id").eq("origin_channel", originChannel).eq("origin_reference", entityId).maybeSingle();
    if (!order) return "no matching refund order found";
    await admin.from("sales_order_line").delete().eq("sales_order_id", order.id);
    await admin.from("sales_order").delete().eq("id", order.id);
    return "deleted refund order";
  }

  const data = await fetchQboEntity(baseUrl, accessToken, `refundreceipt/${entityId}`);
  const receipt = data?.RefundReceipt;
  if (!receipt) return "could not fetch RefundReceipt from QBO";

  // Idempotency: if exists, delete and re-create
  const { data: existing } = await admin.from("sales_order").select("id").eq("origin_channel", originChannel).eq("origin_reference", String(receipt.Id)).maybeSingle();
  if (existing) {
    await admin.from("sales_order_line").delete().eq("sales_order_id", existing.id);
    await admin.from("sales_order").delete().eq("id", existing.id);
  }

  const customerName = receipt.CustomerRef?.name ?? "QBO Customer";
  const customerRefValue = receipt.CustomerRef?.value ? String(receipt.CustomerRef.value) : null;
  const txnDate = receipt.TxnDate ?? null;
  const totalAmount = receipt.TotalAmt ?? 0;
  const currency = receipt.CurrencyRef?.value ?? "GBP";
  const globalTaxCalc = receipt.GlobalTaxCalculation ?? null;
  const taxTotal = receipt.TxnTaxDetail?.TotalTax ?? 0;

  let merchandiseSubtotal: number, grossTotal: number;
  if (globalTaxCalc === "TaxInclusive") {
    merchandiseSubtotal = -(totalAmount - taxTotal);
    grossTotal = -totalAmount;
  } else {
    merchandiseSubtotal = -totalAmount;
    grossTotal = -(totalAmount + taxTotal);
  }

  const itemLines = (receipt.Line ?? []).filter((l: any) => l.DetailType === "SalesItemLineDetail" && l.SalesItemLineDetail?.ItemRef?.value);
  if (itemLines.length === 0) return "skipped — no item lines";

  let customerId: string | null = null;
  if (customerRefValue) {
    const { data: cust } = await admin.from("customer").select("id").eq("qbo_customer_id", customerRefValue).maybeSingle();
    customerId = cust?.id ?? null;
  }

  const vatRateId = await resolveVatRateId(admin, receipt.TxnTaxDetail);

  const { data: order, error: orderErr } = await admin.from("sales_order").insert({
    origin_channel: originChannel,
    origin_reference: String(receipt.Id),
    status: "refunded",
    guest_name: customerName,
    guest_email: `qbo-refund-${receipt.Id}@imported.local`,
    shipping_name: customerName,
    merchandise_subtotal: merchandiseSubtotal,
    tax_total: -taxTotal,
    gross_total: grossTotal,
    global_tax_calculation: globalTaxCalc,
    currency,
    customer_id: customerId,
    txn_date: txnDate,
    doc_number: receipt.DocNumber ?? null,
    notes: `Imported from QBO RefundReceipt #${receipt.DocNumber ?? receipt.Id}`,
  }).select("id").single();

  if (orderErr) return `refund order insert error: ${orderErr.message}`;

  let linesCreated = 0;
  for (const line of itemLines) {
    const detail = line.SalesItemLineDetail;
    const qty = detail.Qty ?? 1;
    const unitPrice = detail.UnitPrice ?? 0;
    const taxCodeRef = detail.TaxCodeRef?.value ?? null;

    const { skuId } = await resolveSkuFromQboItem(admin, baseUrl, accessToken, detail.ItemRef.value, detail.ItemRef?.name ?? null);
    if (!skuId) continue;

    let lineTaxCodeId: string | null = null;
    if (taxCodeRef) {
      const { data: tc } = await admin.from("tax_code").select("id").eq("qbo_tax_code_id", String(taxCodeRef)).maybeSingle();
      lineTaxCodeId = tc?.id ?? null;
    }

    await admin.from("sales_order_line").insert({
      sales_order_id: order.id,
      sku_id: skuId,
      quantity: qty,
      unit_price: -unitPrice,
      line_total: -(line.Amount ?? 0),
      qbo_tax_code_ref: taxCodeRef,
      vat_rate_id: vatRateId,
      tax_code_id: lineTaxCodeId,
    });
    linesCreated++;
  }

  return `created refund order — ${linesCreated} lines`;
}

async function handleCustomer(admin: any, baseUrl: string, accessToken: string, entityId: string, operation: string): Promise<string> {
  if (operation === "Delete") {
    const { error } = await admin.from("customer").update({ active: false }).eq("qbo_customer_id", entityId);
    return error ? `deactivate error: ${error.message}` : "marked inactive";
  }

  const data = await fetchQboEntity(baseUrl, accessToken, `customer/${entityId}`);
  const c = data?.Customer;
  if (!c) return "could not fetch customer from QBO";

  const billAddr = c.BillAddr ?? {};
  const { error } = await admin.from("customer").upsert({
    qbo_customer_id: String(c.Id),
    display_name: c.DisplayName ?? c.FullyQualifiedName ?? "Unknown",
    email: c.PrimaryEmailAddr?.Address ?? null,
    phone: c.PrimaryPhone?.FreeFormNumber ?? null,
    mobile: c.Mobile?.FreeFormNumber ?? null,
    billing_line_1: billAddr.Line1 ?? null,
    billing_line_2: billAddr.Line2 ?? null,
    billing_city: billAddr.City ?? null,
    billing_county: billAddr.CountrySubDivisionCode ?? null,
    billing_postcode: billAddr.PostalCode ?? null,
    billing_country: billAddr.Country ?? "GB",
    notes: c.Notes ?? null,
    active: c.Active !== false,
    synced_at: new Date().toISOString(),
  }, { onConflict: "qbo_customer_id" });

  return error ? `upsert error: ${error.message}` : "upserted";
}

async function handleItem(admin: any, baseUrl: string, accessToken: string, entityId: string, operation: string): Promise<string> {
  // QBO Items cannot be deleted, so we only handle Create/Update
  if (operation === "Delete") {
    return `item ${entityId} delete — ignored (items cannot be deleted in QBO)`;
  }

  // Fetch the single Item from QBO
  const res = await fetch(`${baseUrl}/item/${entityId}?minorversion=65`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`QBO Item fetch failed [${res.status}]: ${errText}`);
  }
  const data = await res.json();
  const item = data?.Item;
  if (!item) return `item ${entityId} — not found in QBO response`;

  const qboItemId = String(item.Id);

  // Parse SKU field (MPN.Grade convention), fall back to Name
  let mpn: string | null = null;
  let conditionGrade = "3";
  const skuField = item.Sku;
  if (skuField && String(skuField).trim()) {
    const parsed = parseSku(String(skuField));
    mpn = parsed.mpn;
    conditionGrade = parsed.conditionGrade;
  } else if (item.Name) {
    const parsed = parseSku(String(item.Name));
    mpn = parsed.mpn;
    conditionGrade = parsed.conditionGrade;
  }

  if (!mpn) return `item ${entityId} — could not extract MPN`;

  // Use the raw QBO SKU verbatim as sku_code
  const rawSku = (skuField && String(skuField).trim()) ? String(skuField).trim() : String(item.Name).trim();
  const skuCode = rawSku;

  // Look up product by MPN
  const { data: productRecord } = await admin
    .from("product")
    .select("id")
    .eq("mpn", mpn)
    .maybeSingle();

  const productId = productRecord?.id ?? null;

  // Pre-check: if a SKU with this sku_code exists but has a different/null qbo_item_id,
  // update it to link to this QBO item before upserting (avoids sku_code unique violation)
  const { data: existingByCode } = await admin
    .from("sku")
    .select("id, qbo_item_id")
    .eq("sku_code", skuCode)
    .maybeSingle();

  if (existingByCode && existingByCode.qbo_item_id !== qboItemId) {
    // Link the existing SKU to this QBO item ID
    await admin.from("sku").update({
      qbo_item_id: qboItemId,
      name: cleanQboName(item.Name ?? mpn),
      product_id: productId ?? existingByCode.product_id,
      active_flag: item.Active !== false,
      price: item.UnitPrice != null ? Number(item.UnitPrice) : existingByCode.price,
    }).eq("id", existingByCode.id);
    return `item ${entityId} linked to existing SKU ${skuCode}`;
  }

  // Upsert SKU (now safe — unique index on qbo_item_id exists)
  const { error } = await admin.from("sku").upsert({
    qbo_item_id: qboItemId,
    sku_code: skuCode,
    name: cleanQboName(item.Name ?? mpn),
    product_id: productId,
    condition_grade: conditionGrade,
    active_flag: item.Active !== false,
    saleable_flag: !!productId,
    price: item.UnitPrice != null ? Number(item.UnitPrice) : null,
  }, { onConflict: "qbo_item_id" });

  if (error) return `item ${entityId} upsert error: ${error.message}`;
  return `item ${entityId} upserted as SKU ${skuCode}`;
}

// ────────────────────────────────────────────────────────────
// Entity dispatcher
// ────────────────────────────────────────────────────────────

type EntityHandler = (admin: any, baseUrl: string, accessToken: string, entityId: string, operation: string) => Promise<string>;

const ENTITY_HANDLERS: Record<string, EntityHandler> = {
  Purchase: handlePurchase,
  SalesReceipt: handleSalesReceipt,
  RefundReceipt: handleRefundReceipt,
  Customer: handleCustomer,
  Item: handleItem,
};

// ────────────────────────────────────────────────────────────
// Main handler
// ────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // QBO sends GET for validation during webhook registration
  if (req.method === "GET") {
    return new Response("OK", { status: 200, headers: { ...corsHeaders, "Content-Type": "text/plain" } });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  const verifierToken = Deno.env.get("QBO_WEBHOOK_VERIFIER");
  if (!verifierToken) {
    console.error("QBO_WEBHOOK_VERIFIER secret not configured");
    return new Response("Server misconfigured", { status: 500, headers: corsHeaders });
  }

  const rawBody = await req.text();

  // Signature verification
  const intuitSignature = req.headers.get("intuit-signature");
  if (!intuitSignature) return new Response("Missing signature", { status: 401, headers: corsHeaders });

  const valid = await verifySignature(rawBody, intuitSignature, verifierToken);
  if (!valid) return new Response("Invalid signature", { status: 401, headers: corsHeaders });

  // Parse payload
  let payload: any;
  try { payload = JSON.parse(rawBody); } catch { return new Response("Invalid JSON", { status: 400, headers: corsHeaders }); }

  console.log("QBO webhook received:", JSON.stringify(payload).slice(0, 500));

  const notifications = payload.eventNotifications ?? [];

  // Respond immediately (QBO requires fast 200), process async
  const processAsync = async () => {
    if (!notifications.length) { console.log("No notifications"); return; }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const clientId = Deno.env.get("QBO_CLIENT_ID")!;
    const clientSecret = Deno.env.get("QBO_CLIENT_SECRET")!;
    const realmId = Deno.env.get("QBO_REALM_ID")!;
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const accessToken = await ensureValidToken(admin, realmId, clientId, clientSecret);
    const baseUrl = `https://quickbooks.api.intuit.com/v3/company/${realmId}`;

    const results: Array<{ entity: string; id: string; operation: string; result: string }> = [];

    for (const notification of notifications) {
      const entities = notification.dataChangeEvent?.entities ?? [];
      for (const entity of entities) {
        const handler = ENTITY_HANDLERS[entity.name];
        const entityId = String(entity.id);
        const operation = entity.operation ?? "Create";

        if (!handler) {
          console.log(`Ignoring entity type: ${entity.name}`);
          results.push({ entity: entity.name, id: entityId, operation, result: "ignored — unknown type" });
          continue;
        }

        console.log(`Processing: ${entity.name} ${operation} ${entityId}`);
        try {
          const result = await handler(admin, baseUrl, accessToken, entityId, operation);
          console.log(`  → ${result}`);
          results.push({ entity: entity.name, id: entityId, operation, result });
        } catch (err: any) {
          console.error(`  → FAILED: ${err.message}`);
          results.push({ entity: entity.name, id: entityId, operation, result: `error: ${err.message}` });
        }
      }
    }

    // Audit log
    try {
      await admin.from("audit_event").insert({
        entity_type: "qbo_webhook",
        entity_id: "00000000-0000-0000-0000-000000000000",
        trigger_type: "webhook",
        actor_type: "system",
        source_system: "qbo",
        input_json: { notifications_count: notifications.length },
        output_json: { results },
      });
    } catch (e: any) {
      console.error("Audit log failed:", e.message);
    }
  };

  processAsync().catch((err) => console.error("Async webhook processing failed:", err));

  return new Response(
    JSON.stringify({ ok: true, received: notifications.length }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
