import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const FETCH_TIMEOUT_MS = 30_000;

/** Fetch with timeout to prevent indefinite hangs on external APIs */
function fetchWithTimeout(url: string | URL, options: RequestInit = {}, timeoutMs = FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

async function ensureValidToken(supabaseAdmin: any, realmId: string, clientId: string, clientSecret: string) {
  const { data: conn, error } = await supabaseAdmin
    .from("qbo_connection")
    .select("*")
    .eq("realm_id", realmId)
    .single();

  if (error || !conn) throw new Error("No QBO connection found. Please connect to QBO first.");

  if (new Date(conn.token_expires_at).getTime() - Date.now() < 5 * 60 * 1000) {
    const tokenRes = await fetchWithTimeout("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
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
    });

    if (!tokenRes.ok) {
      const errBody = await tokenRes.text();
      throw new Error(`Token refresh failed [${tokenRes.status}]: ${errBody}`);
    }

    const tokens = await tokenRes.json();
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

    await supabaseAdmin.from("qbo_connection").update({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_expires_at: expiresAt,
    }).eq("realm_id", realmId);

    return tokens.access_token;
  }

  return conn.access_token;
}

async function fetchQboItem(
  itemId: string,
  cache: Map<string, any>,
  baseUrl: string,
  accessToken: string
): Promise<any | null> {
  if (cache.has(itemId)) return cache.get(itemId);

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetchWithTimeout(`${baseUrl}/item/${itemId}`, {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      });
      if (res.status === 429) {
        console.warn(`Rate limited fetching QBO item ${itemId}, attempt ${attempt + 1}`);
        if (attempt === 0) {
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }
        return null;
      }
      if (!res.ok) {
        console.error(`Failed to fetch QBO item ${itemId}: ${res.status}`);
        cache.set(itemId, null);
        return null;
      }
      const data = await res.json();
      const item = data?.Item ?? null;
      cache.set(itemId, item);
      return item;
    } catch (err) {
      console.error(`Error fetching QBO item ${itemId}:`, err);
      if (attempt === 1) {
        cache.set(itemId, null);
      }
      return null;
    }
  }
  return null;
}

// Status constants to avoid stringly-typed repetition
const STOCK_MATCHABLE = ["available", "received", "graded"];

async function queryQbo(baseUrl: string, accessToken: string, entity: string, dateFilter?: string): Promise<any[]> {
  const PAGE_SIZE = 1000;
  let startPosition = 1;
  const allResults: any[] = [];

  while (true) {
    const where = dateFilter ? ` WHERE ${dateFilter}` : "";
    const query = encodeURIComponent(
      `SELECT * FROM ${entity}${where} STARTPOSITION ${startPosition} MAXRESULTS ${PAGE_SIZE}`
    );
    const res = await fetchWithTimeout(`${baseUrl}/query?query=${query}`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    });
    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`QBO ${entity} query failed [${res.status}]: ${errBody}`);
    }
    const data = await res.json();
    const page = data?.QueryResponse?.[entity] ?? [];
    allResults.push(...page);

    if (page.length < PAGE_SIZE) break; // last page
    startPosition += PAGE_SIZE;

    if (allResults.length >= 10_000) {
      console.warn(`QBO ${entity} query capped at ${allResults.length} records`);
      break;
    }
  }
  return allResults;
}

async function resolveVatRateId(
  supabaseAdmin: any,
  txnTaxDetail: any
): Promise<string | null> {
  const taxLines = txnTaxDetail?.TaxLine ?? [];
  if (taxLines.length === 0) return null;

  if (taxLines.length > 1) {
    console.warn(`Multiple TaxLine entries (${taxLines.length}) — only first TaxRateRef used`);
  }

  const taxRateRef = taxLines[0]?.TaxLineDetail?.TaxRateRef?.value;
  if (!taxRateRef) return null;

  const { data: vatRate } = await supabaseAdmin
    .from("vat_rate")
    .select("id")
    .eq("qbo_tax_rate_id", String(taxRateRef))
    .maybeSingle();

  if (!vatRate) {
    console.warn(`VAT rate not found for qbo_tax_rate_id=${taxRateRef} — tax linkage incomplete`);
  }

  return vatRate?.id ?? null;
}

async function landSalesReceipt(
  supabaseAdmin: any,
  receipt: any,
  correlationId: string
): Promise<{ landingId: string; alreadyCommitted: boolean }> {
  const externalId = String(receipt.Id);

  const { data: existing } = await supabaseAdmin
    .from("landing_raw_qbo_sales_receipt")
    .select("id, status")
    .eq("external_id", externalId)
    .maybeSingle();

  if (existing) {
    await supabaseAdmin
      .from("landing_raw_qbo_sales_receipt")
      .update({ raw_payload: receipt, received_at: new Date().toISOString() })
      .eq("id", existing.id);
    return { landingId: existing.id, alreadyCommitted: existing.status === "committed" };
  }

  const { data: landing, error } = await supabaseAdmin
    .from("landing_raw_qbo_sales_receipt")
    .insert({
      external_id: externalId,
      raw_payload: receipt,
      status: "pending",
      correlation_id: correlationId,
    })
    .select("id")
    .single();

  if (error) throw error;
  return { landingId: landing.id, alreadyCommitted: false };
}

async function landRefundReceipt(
  supabaseAdmin: any,
  receipt: any,
  correlationId: string
): Promise<{ landingId: string; alreadyCommitted: boolean }> {
  const externalId = String(receipt.Id);

  const { data: existing } = await supabaseAdmin
    .from("landing_raw_qbo_refund_receipt")
    .select("id, status")
    .eq("external_id", externalId)
    .maybeSingle();

  if (existing) {
    await supabaseAdmin
      .from("landing_raw_qbo_refund_receipt")
      .update({ raw_payload: receipt, received_at: new Date().toISOString() })
      .eq("id", existing.id);
    return { landingId: existing.id, alreadyCommitted: existing.status === "committed" };
  }

  const { data: landing, error } = await supabaseAdmin
    .from("landing_raw_qbo_refund_receipt")
    .insert({
      external_id: externalId,
      raw_payload: receipt,
      status: "pending",
      correlation_id: correlationId,
    })
    .select("id")
    .single();

  if (error) throw error;
  return { landingId: landing.id, alreadyCommitted: false };
}

async function landQboItem(supabaseAdmin: any, item: any, correlationId: string): Promise<void> {
  if (!item?.Id) return;
  await supabaseAdmin
    .from("landing_raw_qbo_item")
    .upsert(
      {
        external_id: String(item.Id),
        raw_payload: item,
        status: "committed",
        correlation_id: correlationId,
        received_at: new Date().toISOString(),
        processed_at: new Date().toISOString(),
      },
      { onConflict: "external_id" }
    );
}

async function markLandingStatus(
  supabaseAdmin: any,
  table: string,
  landingId: string,
  status: string,
  errorMessage?: string
): Promise<void> {
  const update: any = { status, processed_at: new Date().toISOString() };
  if (errorMessage) update.error_message = errorMessage;
  await supabaseAdmin.from(table).update(update).eq("id", landingId);
}

/** Close any unclosed stock for an existing order's lines (reconciliation) */
async function reconcileStockForOrder(
  supabaseAdmin: any,
  orderId: string,
  affectedSkuIds: Set<string>
): Promise<{ closed: number }> {
  // Find order lines that have no stock_unit_id linked
  const { data: unlinkedLines } = await supabaseAdmin
    .from("sales_order_line")
    .select("id, sku_id, quantity")
    .eq("sales_order_id", orderId)
    .is("stock_unit_id", null);

  let closed = 0;
  for (const line of (unlinkedLines ?? [])) {
    for (let i = 0; i < (line.quantity ?? 1); i++) {
      const { data: stockUnit } = await supabaseAdmin
        .from("stock_unit")
        .select("id")
        .eq("sku_id", line.sku_id)
        .in("status", STOCK_MATCHABLE)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (stockUnit) {
        const { error: closeErr } = await supabaseAdmin
          .from("stock_unit")
          .update({ status: "closed" })
          .eq("id", stockUnit.id);
        if (!closeErr) {
          // Link the stock unit to the order line
          await supabaseAdmin
            .from("sales_order_line")
            .update({ stock_unit_id: stockUnit.id })
            .eq("id", line.id);
          closed++;
          affectedSkuIds.add(line.sku_id);
        }
      }
    }
  }
  return { closed };
}

async function processSalesReceipt(
  supabaseAdmin: any,
  receipt: any,
  itemCache: Map<string, any>,
  baseUrl: string,
  accessToken: string,
  affectedSkuIds: Set<string>
): Promise<{ created: boolean; linesCreated: number; stockMatched: number; stockMissing: number }> {
  const qboId = String(receipt.Id);
  const originChannel = "qbo";

  // ── Same-channel dedup: already imported as QBO? ──
  const { data: existing } = await supabaseAdmin
    .from("sales_order")
    .select("id")
    .eq("origin_channel", originChannel)
    .eq("origin_reference", qboId)
    .maybeSingle();

  if (existing) return { created: false, linesCreated: 0, stockMatched: 0, stockMissing: 0 };

  const customerName = receipt.CustomerRef?.name ?? "QBO Customer";
  const customerRefValue = receipt.CustomerRef?.value ? String(receipt.CustomerRef.value) : null;
  const txnDate = receipt.TxnDate ?? null;
  const totalAmount = receipt.TotalAmt ?? 0;
  const currency = receipt.CurrencyRef?.value ?? "GBP";
  const globalTaxCalc = receipt.GlobalTaxCalculation ?? null;
  const taxTotal = receipt.TxnTaxDetail?.TotalTax ?? 0;

  let merchandiseSubtotal: number;
  let grossTotal: number;
  if (globalTaxCalc === "TaxInclusive") {
    merchandiseSubtotal = totalAmount - taxTotal;
    grossTotal = totalAmount;
  } else {
    merchandiseSubtotal = totalAmount;
    grossTotal = totalAmount + taxTotal;
  }

  const itemLines = (receipt.Line ?? []).filter(
    (l: any) => l.DetailType === "SalesItemLineDetail" && l.SalesItemLineDetail?.ItemRef?.value
  );

  if (itemLines.length === 0) {
    return { created: false, linesCreated: 0, stockMatched: 0, stockMissing: 0 };
  }

  let customerId: string | null = null;
  if (customerRefValue) {
    const { data: cust } = await supabaseAdmin
      .from("customer")
      .select("id")
      .eq("qbo_customer_id", customerRefValue)
      .maybeSingle();
    customerId = cust?.id ?? null;
  }

  const vatRateId = await resolveVatRateId(supabaseAdmin, receipt.TxnTaxDetail);

  // ── Cross-channel dedup: check if this SalesReceipt was created by
  // our app for an eBay or web sale. If so, enrich the existing order
  // with QBO IDs instead of duplicating it.
  const docNumber = receipt.DocNumber ?? null;
  if (docNumber) {
    // Check by origin_reference (DocNumber = eBay order ID) or doc_number
    // (DocNumber = app order_number like KO-0000123) across all channels
    let matchedOrder: { id: string; qbo_sync_status?: string } | null = null;
    let matchChannel = "";

    // 1. Check eBay by origin_reference (works when DocNumber = eBay order ID)
    const { data: ebayByRef } = await supabaseAdmin
      .from("sales_order")
      .select("id")
      .eq("origin_channel", "ebay")
      .eq("origin_reference", docNumber)
      .maybeSingle();

    if (ebayByRef) {
      matchedOrder = ebayByRef;
      matchChannel = "ebay";
    }

    // 2. Check any channel by doc_number (works when DocNumber = KO-number)
    if (!matchedOrder) {
      const { data: byDocNumber } = await supabaseAdmin
        .from("sales_order")
        .select("id")
        .eq("doc_number", docNumber)
        .neq("origin_channel", "qbo")
        .maybeSingle();

      if (byDocNumber) {
        matchedOrder = byDocNumber;
        matchChannel = "doc_number";
      }
    }

    // 3. Check any channel by order_number (DocNumber might be the KO-number)
    if (!matchedOrder) {
      const { data: byOrderNumber } = await supabaseAdmin
        .from("sales_order")
        .select("id")
        .eq("order_number", docNumber)
        .neq("origin_channel", "qbo")
        .maybeSingle();

      if (byOrderNumber) {
        matchedOrder = byOrderNumber;
        matchChannel = "order_number";
      }
    }

    if (matchedOrder) {
      const enrichFields: Record<string, any> = {
        doc_number: docNumber,
        global_tax_calculation: globalTaxCalc,
        qbo_sales_receipt_id: qboId,
        qbo_customer_id: customerRefValue,
      };
      enrichFields.qbo_sync_status = "synced";
      if (customerId) enrichFields.customer_id = customerId;
      if (taxTotal) enrichFields.tax_total = taxTotal;

      const { error: enrichErr } = await supabaseAdmin.from("sales_order").update(enrichFields).eq("id", matchedOrder.id);
      // If QBO tracking columns don't exist yet, retry with only core fields
      if (enrichErr && /qbo_sync_status|qbo_sales_receipt_id|qbo_customer_id|PGRST204/.test(enrichErr.message ?? "")) {
        delete enrichFields.qbo_sales_receipt_id;
        delete enrichFields.qbo_customer_id;
        delete enrichFields.qbo_sync_status;
        await supabaseAdmin.from("sales_order").update(enrichFields).eq("id", matchedOrder.id);
      }

      if (vatRateId) {
        await supabaseAdmin.from("sales_order_line")
          .update({ vat_rate_id: vatRateId })
          .eq("sales_order_id", matchedOrder.id)
          .is("vat_rate_id", null);
      }

      // Reconcile stock — close any unclosed stock for this order's lines
      const reconciled = await reconcileStockForOrder(supabaseAdmin, matchedOrder.id, affectedSkuIds);
      const stockNote = reconciled.closed > 0 ? `, reconciled ${reconciled.closed} stock units` : "";

      console.log(`Cross-channel dedup (${matchChannel}): enriched order ${matchedOrder.id} with QBO data (DocNumber ${docNumber})${stockNote}`);
      return { created: false, linesCreated: 0, stockMatched: reconciled.closed, stockMissing: 0 };
    }
  }

  // QBO-originated order — already in QBO, mark synced with IDs
  const orderPayload: Record<string, any> = {
    origin_channel: originChannel,
    origin_reference: qboId,
    status: "complete",
    guest_name: customerName,
    guest_email: `qbo-sale-${qboId}@imported.local`,
    shipping_name: customerName,
    merchandise_subtotal: merchandiseSubtotal,
    tax_total: taxTotal,
    gross_total: grossTotal,
    global_tax_calculation: globalTaxCalc,
    currency,
    customer_id: customerId,
    txn_date: txnDate ?? null,
    doc_number: docNumber,
    notes: `Imported from QBO SalesReceipt #${docNumber ?? qboId} on ${txnDate ?? "unknown date"}`,
    qbo_sync_status: "synced",
    qbo_sales_receipt_id: qboId,
    qbo_customer_id: customerRefValue,
  };

  let { data: order, error: orderErr } = await supabaseAdmin
    .from("sales_order")
    .insert(orderPayload)
    .select("id")
    .single();

  // If insert fails due to missing QBO tracking columns, retry without them
  if (orderErr && /qbo_sync_status|qbo_sales_receipt_id|qbo_customer_id|PGRST204/.test(orderErr.message ?? "")) {
    delete orderPayload.qbo_sync_status;
    delete orderPayload.qbo_sales_receipt_id;
    delete orderPayload.qbo_customer_id;
    ({ data: order, error: orderErr } = await supabaseAdmin
      .from("sales_order")
      .insert(orderPayload)
      .select("id")
      .single());
  }

  if (orderErr) throw orderErr;

  let linesCreated = 0;
  let stockMatched = 0;
  let stockMissing = 0;

  for (const line of itemLines) {
    const detail = line.SalesItemLineDetail;
    const qty = detail.Qty ?? 1;
    const unitPrice = detail.UnitPrice ?? 0;
    const itemRefValue = detail.ItemRef.value;
    const taxCodeRef = detail.TaxCodeRef?.value ?? null;

    const qboItem = await fetchQboItem(itemRefValue, itemCache, baseUrl, accessToken);
    const skuField = qboItem?.Sku;
    let skuCode: string | null = null;

    // Use raw QBO SKU as sku_code (trimmed to match purchase sync storage)
    if (skuField && String(skuField).trim()) {
      skuCode = String(skuField).trim();
    } else if (detail.ItemRef?.name) {
      skuCode = String(detail.ItemRef.name).trim();
    }

    let skuId: string | null = null;
    if (skuCode) {
      const { data: sku } = await supabaseAdmin
        .from("sku")
        .select("id")
        .eq("sku_code", skuCode)
        .maybeSingle();
      skuId = sku?.id ?? null;
    }

    if (!skuId) {
      console.warn(`No SKU found for QBO item ${itemRefValue} (sku_code: ${skuCode}), skipping line`);
      continue;
    }

    // Resolve tax code once per item line (not per unit)
    let lineTaxCodeId: string | null = null;
    if (taxCodeRef) {
      const { data: tc } = await supabaseAdmin
        .from("tax_code")
        .select("id")
        .eq("qbo_tax_code_id", String(taxCodeRef))
        .maybeSingle();
      lineTaxCodeId = tc?.id ?? null;
    }

    // Use atomic stock allocation to prevent race conditions with concurrent webhooks
    const { data: allocatedIds } = await supabaseAdmin.rpc("allocate_stock_units", {
      p_sku_id: skuId,
      p_quantity: qty,
    });
    const unitIds: string[] = allocatedIds ?? [];

    for (let i = 0; i < qty; i++) {
      const stockUnitId = unitIds[i] ?? null;

      const { error: lineErr } = await supabaseAdmin
        .from("sales_order_line")
        .insert({
          sales_order_id: order.id,
          sku_id: skuId,
          quantity: 1,
          unit_price: unitPrice,
          line_total: unitPrice,
          stock_unit_id: stockUnitId,
          qbo_tax_code_ref: taxCodeRef,
          vat_rate_id: vatRateId,
          tax_code_id: lineTaxCodeId,
        });

      if (lineErr) {
        console.error(`Failed to create order line:`, lineErr);
        continue;
      }

      linesCreated++;

      if (stockUnitId) {
        stockMatched++;
        affectedSkuIds.add(skuId);
      } else {
        console.warn(`No available stock for SKU ${skuCode}, order line created without stock unit`);
        stockMissing++;
      }
    }

    // Warn if partial allocation occurred
    if (unitIds.length > 0 && unitIds.length < qty) {
      console.warn(`Partial stock allocation for SKU ${skuCode}: requested ${qty}, allocated ${unitIds.length}`);
    }
  }

  return { created: true, linesCreated, stockMatched, stockMissing };
}

async function processRefundReceipt(
  supabaseAdmin: any,
  receipt: any,
  itemCache: Map<string, any>,
  baseUrl: string,
  accessToken: string
): Promise<{ created: boolean; linesCreated: number }> {
  const qboId = String(receipt.Id);
  const originChannel = "qbo_refund";

  const { data: existing } = await supabaseAdmin
    .from("sales_order")
    .select("id")
    .eq("origin_channel", originChannel)
    .eq("origin_reference", qboId)
    .maybeSingle();

  if (existing) return { created: false, linesCreated: 0 };

  const customerName = receipt.CustomerRef?.name ?? "QBO Customer";
  const customerRefValue = receipt.CustomerRef?.value ? String(receipt.CustomerRef.value) : null;
  const txnDate = receipt.TxnDate ?? null;
  const totalAmount = receipt.TotalAmt ?? 0;
  const currency = receipt.CurrencyRef?.value ?? "GBP";
  const globalTaxCalc = receipt.GlobalTaxCalculation ?? null;
  const taxTotal = receipt.TxnTaxDetail?.TotalTax ?? 0;

  let merchandiseSubtotal: number;
  let grossTotal: number;
  if (globalTaxCalc === "TaxInclusive") {
    merchandiseSubtotal = -(totalAmount - taxTotal);
    grossTotal = -totalAmount;
  } else {
    merchandiseSubtotal = -totalAmount;
    grossTotal = -(totalAmount + taxTotal);
  }

  const itemLines = (receipt.Line ?? []).filter(
    (l: any) => l.DetailType === "SalesItemLineDetail" && l.SalesItemLineDetail?.ItemRef?.value
  );

  if (itemLines.length === 0) {
    return { created: false, linesCreated: 0 };
  }

  let customerId: string | null = null;
  if (customerRefValue) {
    const { data: cust } = await supabaseAdmin
      .from("customer")
      .select("id")
      .eq("qbo_customer_id", customerRefValue)
      .maybeSingle();
    customerId = cust?.id ?? null;
  }

  const vatRateId = await resolveVatRateId(supabaseAdmin, receipt.TxnTaxDetail);

  const refundPayload: Record<string, any> = {
    origin_channel: originChannel,
    origin_reference: qboId,
    status: "refunded",
    guest_name: customerName,
    guest_email: `qbo-refund-${qboId}@imported.local`,
    shipping_name: customerName,
    merchandise_subtotal: merchandiseSubtotal,
    tax_total: -taxTotal,
    gross_total: grossTotal,
    global_tax_calculation: globalTaxCalc,
    currency,
    customer_id: customerId,
    txn_date: txnDate ?? null,
    doc_number: receipt.DocNumber ?? null,
    notes: `Imported from QBO RefundReceipt #${receipt.DocNumber ?? qboId} on ${txnDate ?? "unknown date"}`,
    qbo_sync_status: "synced",
    qbo_sales_receipt_id: qboId,
    qbo_customer_id: customerRefValue,
  };

  let { data: order, error: orderErr } = await supabaseAdmin
    .from("sales_order")
    .insert(refundPayload)
    .select("id")
    .single();

  if (orderErr && /qbo_sync_status|qbo_sales_receipt_id|qbo_customer_id|PGRST204/.test(orderErr.message ?? "")) {
    delete refundPayload.qbo_sync_status;
    delete refundPayload.qbo_sales_receipt_id;
    delete refundPayload.qbo_customer_id;
    ({ data: order, error: orderErr } = await supabaseAdmin
      .from("sales_order")
      .insert(refundPayload)
      .select("id")
      .single());
  }

  if (orderErr) throw orderErr;

  let linesCreated = 0;

  for (const line of itemLines) {
    const detail = line.SalesItemLineDetail;
    const qty = detail.Qty ?? 1;
    const unitPrice = detail.UnitPrice ?? 0;
    const itemRefValue = detail.ItemRef.value;
    const taxCodeRef = detail.TaxCodeRef?.value ?? null;

    const qboItem = await fetchQboItem(itemRefValue, itemCache, baseUrl, accessToken);
    const skuField = qboItem?.Sku;
    let skuCode: string | null = null;

    // Use raw QBO SKU as sku_code (trimmed to match purchase sync storage)
    if (skuField && String(skuField).trim()) {
      skuCode = String(skuField).trim();
    } else if (detail.ItemRef?.name) {
      skuCode = String(detail.ItemRef.name).trim();
    }

    let skuId: string | null = null;
    if (skuCode) {
      const { data: sku } = await supabaseAdmin
        .from("sku")
        .select("id")
        .eq("sku_code", skuCode)
        .maybeSingle();
      skuId = sku?.id ?? null;
    }

    if (!skuId) {
      console.warn(`No SKU found for refund QBO item ${itemRefValue}, skipping line`);
      continue;
    }

    let lineTaxCodeId: string | null = null;
    if (taxCodeRef) {
      const { data: tc } = await supabaseAdmin
        .from("tax_code")
        .select("id")
        .eq("qbo_tax_code_id", String(taxCodeRef))
        .maybeSingle();
      lineTaxCodeId = tc?.id ?? null;
    }

    const { error: lineErr } = await supabaseAdmin
      .from("sales_order_line")
      .insert({
        sales_order_id: order.id,
        sku_id: skuId,
        quantity: qty,
        unit_price: -unitPrice,
        line_total: -(line.Amount ?? 0),
        qbo_tax_code_ref: taxCodeRef,
        vat_rate_id: vatRateId,
        tax_code_id: lineTaxCodeId,
      });

    if (lineErr) {
      console.error(`Failed to create refund order line:`, lineErr);
      continue;
    }
    linesCreated++;
  }

  return { created: true, linesCreated };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const clientId = Deno.env.get("QBO_CLIENT_ID");
    const clientSecret = Deno.env.get("QBO_CLIENT_SECRET");
    const realmId = Deno.env.get("QBO_REALM_ID");

    // Pre-flight validation with actionable error messages
    if (!clientId || !clientSecret) {
      return new Response(
        JSON.stringify({ error: "QBO_CLIENT_ID and QBO_CLIENT_SECRET must be set in Supabase Edge Function secrets." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (!realmId) {
      return new Response(
        JSON.stringify({ error: "QBO_REALM_ID not configured. Complete the OAuth connection first via Settings → QBO → Connect." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Unauthorized — missing Bearer token." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
    const token = authHeader.replace("Bearer ", "");
    const isWebhook = req.headers.get("x-webhook-trigger") === "true" && token === serviceRoleKey;

    // Parse request body for month parameter and chunk control
    let targetMonth: string | null = null;
    let chunkSize = 25; // Process at most N receipts per invocation
    let skipLanding = false; // If true, skip QBO fetch and only process pending landings
    try {
      const body = await req.json();
      if (body?.month && typeof body.month === "string") {
        targetMonth = body.month; // e.g. "2025-06"
      }
      if (body?.chunk_size && typeof body.chunk_size === "number") {
        chunkSize = Math.min(Math.max(body.chunk_size, 1), 100);
      }
      if (body?.skip_landing === true) {
        skipLanding = true;
      }
    } catch {
      // No body or invalid JSON — default to current month
    }

    if (!targetMonth) {
      const now = new Date();
      targetMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    }

    if (!isWebhook) {
      const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
      if (userError || !user) {
        return new Response(
          JSON.stringify({ error: "Unauthorized — invalid or expired session token." }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const { data: roles } = await supabaseAdmin
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id);
      const hasAccess = (roles ?? []).some(
        (r: { role: string }) => r.role === "admin" || r.role === "staff"
      );
      if (!hasAccess) {
        return new Response(
          JSON.stringify({ error: "Forbidden — admin or staff role required." }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    } else {
      console.log("Webhook-triggered sync (service role auth)");
    }

    let accessToken: string;
    try {
      accessToken = await ensureValidToken(supabaseAdmin, realmId, clientId, clientSecret);
    } catch (tokenErr) {
      const msg = tokenErr instanceof Error ? tokenErr.message : "Unknown token error";
      return new Response(
        JSON.stringify({ error: `QBO authentication failed: ${msg}. Try reconnecting via Settings → QBO → Connect.` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const baseUrl = `https://quickbooks.api.intuit.com/v3/company/${realmId}`;
    const correlationId = crypto.randomUUID();

    // Build date range for this month
    const [y, m] = targetMonth.split("-").map(Number);
    const monthStart = `${y}-${String(m).padStart(2, "0")}-01`;
    const lastDay = new Date(y, m, 0).getDate();
    const monthEnd = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    const dateFilter = `TxnDate >= '${monthStart}' AND TxnDate <= '${monthEnd}'`;
    console.log(`Processing sales for ${targetMonth} (${monthStart} → ${monthEnd})`);

    // ── Phase 1: Land all raw payloads (skip if resuming a chunk) ──
    if (!skipLanding) {
      // Fetch both entity types from QBO for this month
      const [salesReceipts, refundReceipts] = await Promise.all([
        queryQbo(baseUrl, accessToken, "SalesReceipt", dateFilter),
        queryQbo(baseUrl, accessToken, "RefundReceipt", dateFilter),
      ]);
      console.log(`Landing ${salesReceipts.length} sales receipts + ${refundReceipts.length} refund receipts (correlation: ${correlationId})`);

      for (const sr of salesReceipts) {
        try { await landSalesReceipt(supabaseAdmin, sr, correlationId); } catch (err) {
          console.error(`Failed to land SalesReceipt ${sr.Id}:`, err);
        }
      }
      for (const rr of refundReceipts) {
        try { await landRefundReceipt(supabaseAdmin, rr, correlationId); } catch (err) {
          console.error(`Failed to land RefundReceipt ${rr.Id}:`, err);
        }
      }
    }

    // ── Phase 2: Process pending landings in bounded chunks ──
    // Fetch pending sales receipts (limited to chunkSize)
    const { data: pendingSales } = await supabaseAdmin
      .from("landing_raw_qbo_sales_receipt")
      .select("id, external_id, raw_payload, status")
      .eq("status", "pending")
      .order("received_at", { ascending: true })
      .limit(chunkSize);

    const { data: pendingRefunds } = await supabaseAdmin
      .from("landing_raw_qbo_refund_receipt")
      .select("id, external_id, raw_payload, status")
      .eq("status", "pending")
      .order("received_at", { ascending: true })
      .limit(Math.max(chunkSize - (pendingSales?.length ?? 0), 5));

    // Pre-fetch QBO items for this chunk
    const uniqueItemIds = new Set<string>();
    for (const entry of [...(pendingSales ?? []), ...(pendingRefunds ?? [])]) {
      const receipt = entry.raw_payload as any;
      for (const line of (receipt?.Line ?? [])) {
        if (line.DetailType === "SalesItemLineDetail" && line.SalesItemLineDetail?.ItemRef?.value) {
          uniqueItemIds.add(line.SalesItemLineDetail.ItemRef.value);
        }
      }
    }

    const itemCache = new Map<string, any>();
    const itemIdArray = Array.from(uniqueItemIds);
    const BATCH_SIZE = 5;
    for (let i = 0; i < itemIdArray.length; i += BATCH_SIZE) {
      const batch = itemIdArray.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(id => fetchQboItem(id, itemCache, baseUrl, accessToken)));
      if (i + BATCH_SIZE < itemIdArray.length) {
        await new Promise(r => setTimeout(r, 300));
      }
    }

    // Land fetched QBO items
    for (const [, item] of itemCache) {
      if (item) {
        try { await landQboItem(supabaseAdmin, item, correlationId); } catch {}
      }
    }

    // ── Phase 3: Process sales from landing into canonical tables ──
    let salesCreated = 0;
    let salesSkipped = 0;
    let salesNoItems = 0;
    let totalStockMatched = 0;
    let totalStockMissing = 0;
    let totalSalesLines = 0;
    const affectedSkuIds = new Set<string>();

    for (const entry of (pendingSales ?? [])) {
      const sr = entry.raw_payload as any;
      try {
        const result = await processSalesReceipt(supabaseAdmin, sr, itemCache, baseUrl, accessToken, affectedSkuIds);
        if (result.created) {
          salesCreated++;
          totalSalesLines += result.linesCreated;
          totalStockMatched += result.stockMatched;
          totalStockMissing += result.stockMissing;
          await markLandingStatus(supabaseAdmin, "landing_raw_qbo_sales_receipt", entry.id, "committed");
        } else if (!result.created) {
          totalStockMatched += result.stockMatched;
          const hasItems = (sr.Line ?? []).some((l: any) => l.DetailType === "SalesItemLineDetail");
          if (hasItems) {
            salesSkipped++;
            await markLandingStatus(supabaseAdmin, "landing_raw_qbo_sales_receipt", entry.id, "committed");
          } else {
            salesNoItems++;
            await markLandingStatus(supabaseAdmin, "landing_raw_qbo_sales_receipt", entry.id, "skipped");
          }
        }
      } catch (err) {
        console.error(`Failed to process SalesReceipt ${entry.external_id}:`, err);
        await markLandingStatus(supabaseAdmin, "landing_raw_qbo_sales_receipt", entry.id, "error", err instanceof Error ? err.message : "Unknown");
      }
    }

    let refundsCreated = 0;
    let refundsSkipped = 0;
    let totalRefundLines = 0;

    for (const entry of (pendingRefunds ?? [])) {
      const rr = entry.raw_payload as any;
      try {
        const result = await processRefundReceipt(supabaseAdmin, rr, itemCache, baseUrl, accessToken);
        if (result.created) {
          refundsCreated++;
          totalRefundLines += result.linesCreated;
          await markLandingStatus(supabaseAdmin, "landing_raw_qbo_refund_receipt", entry.id, "committed");
        } else {
          refundsSkipped++;
          await markLandingStatus(supabaseAdmin, "landing_raw_qbo_refund_receipt", entry.id, "committed");
        }
      } catch (err) {
        console.error(`Failed to process RefundReceipt ${entry.external_id}:`, err);
        await markLandingStatus(supabaseAdmin, "landing_raw_qbo_refund_receipt", entry.id, "error", err instanceof Error ? err.message : "Unknown");
      }
    }

    // Check remaining pending count to signal has_more
    const [{ count: remainingSales }, { count: remainingRefunds }] = await Promise.all([
      supabaseAdmin.from("landing_raw_qbo_sales_receipt").select("id", { count: "exact", head: true }).eq("status", "pending"),
      supabaseAdmin.from("landing_raw_qbo_refund_receipt").select("id", { count: "exact", head: true }).eq("status", "pending"),
    ]);
    const remainingPending = (remainingSales ?? 0) + (remainingRefunds ?? 0);

    // ── Phase 4: Update channel listings for affected SKUs ──
    let channelListingsUpdated = 0;
    if (affectedSkuIds.size > 0) {
      try {
        for (const skuId of affectedSkuIds) {
          // Count remaining available stock for this SKU
          const { count: availableCount } = await supabaseAdmin
            .from("stock_unit")
            .select("id", { count: "exact", head: true })
            .eq("sku_id", skuId)
            .eq("status", "available");

          const newQty = availableCount ?? 0;

          // Update all channel listings for this SKU
          const { data: updatedListings } = await supabaseAdmin
            .from("channel_listing")
            .update({ listed_quantity: newQty, synced_at: new Date().toISOString() })
            .eq("sku_id", skuId)
            .select("id");

          channelListingsUpdated += (updatedListings?.length ?? 0);
        }
        if (channelListingsUpdated > 0) {
          console.log(`Updated ${channelListingsUpdated} channel listings for ${affectedSkuIds.size} affected SKUs`);
        }
      } catch (channelErr) {
        console.error("Channel listing update error:", channelErr);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        month: targetMonth,
        correlation_id: correlationId,
        sales_created: salesCreated,
        sales_skipped: salesSkipped,
        sales_no_items: salesNoItems,
        sales_lines: totalSalesLines,
        stock_matched: totalStockMatched,
        stock_missing: totalStockMissing,
        refunds_created: refundsCreated,
        refunds_skipped: refundsSkipped,
        refund_lines: totalRefundLines,
        items_cached: itemCache.size,
        channel_listings_updated: channelListingsUpdated,
        has_more: remainingPending > 0,
        remaining_pending: remainingPending,
        processed_count: (pendingSales?.length ?? 0) + (pendingRefunds?.length ?? 0),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("qbo-sync-sales error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
