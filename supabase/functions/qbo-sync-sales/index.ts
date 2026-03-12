import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function ensureValidToken(supabaseAdmin: any, realmId: string, clientId: string, clientSecret: string) {
  const { data: conn, error } = await supabaseAdmin
    .from("qbo_connection")
    .select("*")
    .eq("realm_id", realmId)
    .single();

  if (error || !conn) throw new Error("No QBO connection found. Please connect to QBO first.");

  if (new Date(conn.token_expires_at).getTime() - Date.now() < 5 * 60 * 1000) {
    const tokenRes = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
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
      const res = await fetch(`${baseUrl}/item/${itemId}`, {
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

function parseSku(sku: string): { mpn: string; conditionGrade: string } {
  const trimmed = sku.trim();
  const dotIndex = trimmed.indexOf(".");
  let mpn: string;
  let conditionGrade: string;

  if (dotIndex > 0) {
    mpn = trimmed.substring(0, dotIndex);
    conditionGrade = trimmed.substring(dotIndex + 1) || "1";
  } else {
    mpn = trimmed;
    conditionGrade = "1";
  }

  if (!["1", "2", "3", "4", "5"].includes(conditionGrade)) {
    conditionGrade = "1";
  }

  return { mpn, conditionGrade };
}

async function queryQbo(baseUrl: string, accessToken: string, entity: string): Promise<any[]> {
  const query = encodeURIComponent(`SELECT * FROM ${entity} MAXRESULTS 1000`);
  const res = await fetch(`${baseUrl}/query?query=${query}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`QBO ${entity} query failed [${res.status}]: ${errBody}`);
  }
  const data = await res.json();
  return data?.QueryResponse?.[entity] ?? [];
}

async function resolveVatRateId(
  supabaseAdmin: any,
  txnTaxDetail: any
): Promise<string | null> {
  const taxLines = txnTaxDetail?.TaxLine ?? [];
  if (taxLines.length === 0) return null;

  const taxRateRef = taxLines[0]?.TaxLineDetail?.TaxRateRef?.value;
  if (!taxRateRef) return null;

  const { data: vatRate } = await supabaseAdmin
    .from("vat_rate")
    .select("id")
    .eq("qbo_tax_rate_id", String(taxRateRef))
    .maybeSingle();

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

async function processSalesReceipt(
  supabaseAdmin: any,
  receipt: any,
  itemCache: Map<string, any>,
  baseUrl: string,
  accessToken: string
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

  // ── Cross-channel dedup: already imported via eBay with same DocNumber? ──
  const docNumber = receipt.DocNumber ?? null;
  if (docNumber) {
    const { data: ebayOrder } = await supabaseAdmin
      .from("sales_order")
      .select("id")
      .eq("origin_channel", "ebay")
      .eq("origin_reference", docNumber)
      .maybeSingle();

    if (ebayOrder) {
      // Enrich the existing eBay order with QBO metadata instead of creating a duplicate
      const enrichFields: Record<string, any> = {
        doc_number: docNumber,
        global_tax_calculation: globalTaxCalc,
      };
      if (customerId) enrichFields.customer_id = customerId;
      if (taxTotal) enrichFields.tax_total = taxTotal;

      await supabaseAdmin
        .from("sales_order")
        .update(enrichFields)
        .eq("id", ebayOrder.id);

      // Also backfill VAT on the eBay order's lines if we have it
      if (vatRateId) {
        await supabaseAdmin
          .from("sales_order_line")
          .update({ vat_rate_id: vatRateId })
          .eq("sales_order_id", ebayOrder.id)
          .is("vat_rate_id", null);
      }

      console.log(`Cross-channel dedup: enriched eBay order ${ebayOrder.id} with QBO data (DocNumber ${docNumber})`);
      return { created: false, linesCreated: 0, stockMatched: 0, stockMissing: 0 };
    }
  }

  const { data: order, error: orderErr } = await supabaseAdmin
    .from("sales_order")
    .insert({
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
    })
    .select("id")
    .single();

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

    // Use raw QBO SKU verbatim as sku_code
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
        .single();
      skuId = sku?.id ?? null;
    }

    if (!skuId) {
      console.warn(`No SKU found for QBO item ${itemRefValue} (sku_code: ${skuCode}), skipping line`);
      continue;
    }

    for (let i = 0; i < qty; i++) {
      const { data: stockUnit } = await supabaseAdmin
        .from("stock_unit")
        .select("id")
        .eq("sku_id", skuId)
        .eq("status", "available")
        .order("created_at", { ascending: true })
        .limit(1)
        .single();

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
          quantity: 1,
          unit_price: unitPrice,
          line_total: unitPrice,
          stock_unit_id: stockUnit?.id ?? null,
          qbo_tax_code_ref: taxCodeRef,
          vat_rate_id: vatRateId,
          tax_code_id: lineTaxCodeId,
        });

      if (lineErr) {
        console.error(`Failed to create order line:`, lineErr);
        continue;
      }

      linesCreated++;

      if (stockUnit) {
        await supabaseAdmin
          .from("stock_unit")
          .update({ status: "closed" })
          .eq("id", stockUnit.id);
        stockMatched++;
      } else {
        console.warn(`No available stock for SKU ${skuCode}, order line created without stock unit`);
        stockMissing++;
      }
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

  const { data: order, error: orderErr } = await supabaseAdmin
    .from("sales_order")
    .insert({
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
    })
    .select("id")
    .single();

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

    // Use raw QBO SKU verbatim as sku_code
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
        .single();
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
    const clientId = Deno.env.get("QBO_CLIENT_ID")!;
    const clientSecret = Deno.env.get("QBO_CLIENT_SECRET")!;
    const realmId = Deno.env.get("QBO_REALM_ID");

    if (!clientId || !clientSecret || !realmId) {
      throw new Error("QBO credentials not configured");
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) throw new Error("Unauthorized");

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
    const token = authHeader.replace("Bearer ", "");
    const isWebhook = req.headers.get("x-webhook-trigger") === "true" && token === serviceRoleKey;

    if (!isWebhook) {
      const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
      if (userError || !user) throw new Error("Unauthorized");

      const { data: roles } = await supabaseAdmin
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id);
      const hasAccess = (roles ?? []).some(
        (r: { role: string }) => r.role === "admin" || r.role === "staff"
      );
      if (!hasAccess) throw new Error("Forbidden");
    } else {
      console.log("Webhook-triggered sync (service role auth)");
    }

    const accessToken = await ensureValidToken(supabaseAdmin, realmId, clientId, clientSecret);
    const baseUrl = `https://quickbooks.api.intuit.com/v3/company/${realmId}`;
    const correlationId = crypto.randomUUID();

    // Fetch both entity types from QBO
    const [salesReceipts, refundReceipts] = await Promise.all([
      queryQbo(baseUrl, accessToken, "SalesReceipt"),
      queryQbo(baseUrl, accessToken, "RefundReceipt"),
    ]);

    // ── Phase 1: Land all raw payloads ──
    console.log(`Landing ${salesReceipts.length} sales receipts + ${refundReceipts.length} refund receipts (correlation: ${correlationId})`);

    type LandingEntry = { receipt: any; landingId: string; alreadyCommitted: boolean; table: string };
    const salesLanded: LandingEntry[] = [];
    const refundsLanded: LandingEntry[] = [];

    for (const sr of salesReceipts) {
      try {
        const result = await landSalesReceipt(supabaseAdmin, sr, correlationId);
        salesLanded.push({ receipt: sr, ...result, table: "landing_raw_qbo_sales_receipt" });
      } catch (err) {
        console.error(`Failed to land SalesReceipt ${sr.Id}:`, err);
      }
    }

    for (const rr of refundReceipts) {
      try {
        const result = await landRefundReceipt(supabaseAdmin, rr, correlationId);
        refundsLanded.push({ receipt: rr, ...result, table: "landing_raw_qbo_refund_receipt" });
      } catch (err) {
        console.error(`Failed to land RefundReceipt ${rr.Id}:`, err);
      }
    }

    // ── Phase 2: Pre-fetch QBO items and land them ──
    const uniqueItemIds = new Set<string>();
    for (const receipt of [...salesReceipts, ...refundReceipts]) {
      for (const line of (receipt.Line ?? [])) {
        if (line.DetailType === "SalesItemLineDetail" && line.SalesItemLineDetail?.ItemRef?.value) {
          uniqueItemIds.add(line.SalesItemLineDetail.ItemRef.value);
        }
      }
    }

    const itemCache = new Map<string, any>();
    const itemIdArray = Array.from(uniqueItemIds);
    const BATCH_SIZE = 2;
    for (let i = 0; i < itemIdArray.length; i += BATCH_SIZE) {
      const batch = itemIdArray.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(id => fetchQboItem(id, itemCache, baseUrl, accessToken)));
      if (i + BATCH_SIZE < itemIdArray.length) {
        await new Promise(r => setTimeout(r, 500));
      }
    }
    console.log(`Pre-fetched ${itemCache.size} QBO items for sales sync`);

    // Land all fetched QBO items
    for (const [, item] of itemCache) {
      if (item) {
        try { await landQboItem(supabaseAdmin, item, correlationId); } catch (err) {
          console.error(`Failed to land QBO item ${item?.Id}:`, err);
        }
      }
    }

    // ── Phase 3: Process from landing into canonical tables ──
    let salesCreated = 0;
    let salesSkipped = 0;
    let salesNoItems = 0;
    let totalStockMatched = 0;
    let totalStockMissing = 0;
    let totalSalesLines = 0;

    for (const { receipt: sr, landingId, alreadyCommitted, table } of salesLanded) {
      if (alreadyCommitted) {
        salesSkipped++;
        continue;
      }
      try {
        const result = await processSalesReceipt(supabaseAdmin, sr, itemCache, baseUrl, accessToken);
        if (result.created) {
          salesCreated++;
          totalSalesLines += result.linesCreated;
          totalStockMatched += result.stockMatched;
          totalStockMissing += result.stockMissing;
          await markLandingStatus(supabaseAdmin, table, landingId, "committed");
        } else if (result.linesCreated === 0 && !result.created) {
          const hasItems = (sr.Line ?? []).some((l: any) => l.DetailType === "SalesItemLineDetail");
          if (hasItems) {
            salesSkipped++;
            await markLandingStatus(supabaseAdmin, table, landingId, "committed"); // Already exists in canonical
          } else {
            salesNoItems++;
            await markLandingStatus(supabaseAdmin, table, landingId, "skipped");
          }
        }
      } catch (err) {
        console.error(`Failed to process SalesReceipt ${sr.Id}:`, err);
        await markLandingStatus(supabaseAdmin, table, landingId, "error", err instanceof Error ? err.message : "Unknown");
      }
    }

    let refundsCreated = 0;
    let refundsSkipped = 0;
    let totalRefundLines = 0;

    for (const { receipt: rr, landingId, alreadyCommitted, table } of refundsLanded) {
      if (alreadyCommitted) {
        refundsSkipped++;
        continue;
      }
      try {
        const result = await processRefundReceipt(supabaseAdmin, rr, itemCache, baseUrl, accessToken);
        if (result.created) {
          refundsCreated++;
          totalRefundLines += result.linesCreated;
          await markLandingStatus(supabaseAdmin, table, landingId, "committed");
        } else {
          refundsSkipped++;
          await markLandingStatus(supabaseAdmin, table, landingId, "committed");
        }
      } catch (err) {
        console.error(`Failed to process RefundReceipt ${rr.Id}:`, err);
        await markLandingStatus(supabaseAdmin, table, landingId, "error", err instanceof Error ? err.message : "Unknown");
      }
    }

    // ── Phase 4: Backfill VAT codes on existing order lines ──
    let vatBackfilled = 0;
    const backfillStart = Date.now();
    const BACKFILL_TIME_BUDGET_MS = 45_000;
    try {
      const { data: ordersToFix } = await supabaseAdmin
        .from("sales_order")
        .select("id, origin_channel, origin_reference")
        .in("origin_channel", ["qbo", "qbo_refund"])
        .not("origin_reference", "is", null);

      if (ordersToFix && ordersToFix.length > 0) {
        for (const order of ordersToFix) {
          if (Date.now() - backfillStart > BACKFILL_TIME_BUDGET_MS) {
            console.warn("Backfill time budget exceeded, stopping");
            break;
          }

          const { data: nullLines } = await supabaseAdmin
            .from("sales_order_line")
            .select("id")
            .eq("sales_order_id", order.id)
            .is("tax_code_id", null)
            .limit(1);

          if (!nullLines || nullLines.length === 0) continue;

          await new Promise(r => setTimeout(r, 500));

          const entity = order.origin_channel === "qbo_refund" ? "RefundReceipt" : "SalesReceipt";
          try {
            const res = await fetch(`${baseUrl}/${entity.toLowerCase()}/${order.origin_reference}`, {
              headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
            });
            if (res.status === 429) {
              console.warn(`Backfill: rate limited on ${entity} ${order.origin_reference}, stopping backfill`);
              break;
            }
            if (!res.ok) {
              console.warn(`Backfill: failed to fetch ${entity} ${order.origin_reference}: ${res.status}`);
              continue;
            }
            const data = await res.json();
            const receipt = data?.[entity] ?? null;
            if (!receipt) continue;

            const itemLines = (receipt.Line ?? []).filter(
              (l: any) => l.DetailType === "SalesItemLineDetail" && l.SalesItemLineDetail?.ItemRef?.value
            );

            for (const line of itemLines) {
              const detail = line.SalesItemLineDetail;
              const taxCodeRef = detail.TaxCodeRef?.value ?? null;
              if (!taxCodeRef) continue;

              const itemRefValue = detail.ItemRef.value;
              const qboItem = await fetchQboItem(itemRefValue, itemCache, baseUrl, accessToken);
              const skuField = qboItem?.Sku;
              let skuCode: string | null = null;

              // Use raw QBO SKU verbatim as sku_code
              if (skuField && String(skuField).trim()) {
                skuCode = String(skuField).trim();
              } else if (detail.ItemRef?.name) {
                skuCode = String(detail.ItemRef.name).trim();
              }

              if (!skuCode) continue;

              const { data: sku } = await supabaseAdmin
                .from("sku")
                .select("id")
                .eq("sku_code", skuCode)
                .maybeSingle();
              if (!sku) continue;

              const { data: tc } = await supabaseAdmin
                .from("tax_code")
                .select("id")
                .eq("qbo_tax_code_id", String(taxCodeRef))
                .maybeSingle();
              if (!tc) continue;

              const { data: updated } = await supabaseAdmin
                .from("sales_order_line")
                .update({ tax_code_id: tc.id, qbo_tax_code_ref: String(taxCodeRef) })
                .eq("sales_order_id", order.id)
                .eq("sku_id", sku.id)
                .is("tax_code_id", null)
                .select("id");

              vatBackfilled += (updated?.length ?? 0);
            }
          } catch (fetchErr) {
            console.error(`Backfill: error processing ${entity} ${order.origin_reference}:`, fetchErr);
          }
        }
      }
    } catch (backfillErr) {
      console.error("VAT backfill error:", backfillErr);
    }

    return new Response(
      JSON.stringify({
        success: true,
        correlation_id: correlationId,
        sales_receipts: salesReceipts.length,
        sales_landed: salesLanded.length,
        sales_created: salesCreated,
        sales_skipped: salesSkipped,
        sales_no_items: salesNoItems,
        sales_lines: totalSalesLines,
        stock_matched: totalStockMatched,
        stock_missing: totalStockMissing,
        refund_receipts: refundReceipts.length,
        refunds_landed: refundsLanded.length,
        refunds_created: refundsCreated,
        refunds_skipped: refundsSkipped,
        refund_lines: totalRefundLines,
        items_cached: itemCache.size,
        vat_backfilled: vatBackfilled,
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
