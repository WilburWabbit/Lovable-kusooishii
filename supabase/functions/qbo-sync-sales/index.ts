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
  try {
    const res = await fetch(`${baseUrl}/item/${itemId}`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    });
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
    cache.set(itemId, null);
    return null;
  }
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

/** Resolve the primary QBO TaxRateRef from TxnTaxDetail and look up our vat_rate row */
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

async function processSalesReceipt(
  supabaseAdmin: any,
  receipt: any,
  itemCache: Map<string, any>,
  baseUrl: string,
  accessToken: string
): Promise<{ created: boolean; linesCreated: number; stockMatched: number; stockMissing: number }> {
  const qboId = String(receipt.Id);
  const originChannel = "qbo";

  // Check if already synced
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

  // Compute correct subtotals based on tax treatment
  let merchandiseSubtotal: number;
  let grossTotal: number;
  if (globalTaxCalc === "TaxInclusive") {
    merchandiseSubtotal = totalAmount - taxTotal;
    grossTotal = totalAmount;
  } else {
    merchandiseSubtotal = totalAmount;
    grossTotal = totalAmount + taxTotal;
  }

  // Extract item lines
  const itemLines = (receipt.Line ?? []).filter(
    (l: any) => l.DetailType === "SalesItemLineDetail" && l.SalesItemLineDetail?.ItemRef?.value
  );

  if (itemLines.length === 0) {
    return { created: false, linesCreated: 0, stockMatched: 0, stockMissing: 0 };
  }

  // Resolve customer_id from QBO CustomerRef
  let customerId: string | null = null;
  if (customerRefValue) {
    const { data: cust } = await supabaseAdmin
      .from("customer")
      .select("id")
      .eq("qbo_customer_id", customerRefValue)
      .maybeSingle();
    customerId = cust?.id ?? null;
  }

  // Resolve vat_rate_id from transaction-level TaxRateRef
  const vatRateId = await resolveVatRateId(supabaseAdmin, receipt.TxnTaxDetail);

  // Create sales_order
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
      notes: `Imported from QBO SalesReceipt #${receipt.DocNumber ?? qboId} on ${txnDate ?? "unknown date"}`,
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

    // Resolve SKU
    const qboItem = await fetchQboItem(itemRefValue, itemCache, baseUrl, accessToken);
    const skuField = qboItem?.Sku;
    let skuCode: string | null = null;

    if (skuField && String(skuField).trim()) {
      const parsed = parseSku(String(skuField));
      skuCode = `${parsed.mpn}-G${parsed.conditionGrade}`;
    } else if (detail.ItemRef?.name) {
      const parsed = parseSku(String(detail.ItemRef.name));
      skuCode = `${parsed.mpn}-G${parsed.conditionGrade}`;
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

    // FIFO: match oldest available stock units for this line's quantity
    for (let i = 0; i < qty; i++) {
      const { data: stockUnit } = await supabaseAdmin
        .from("stock_unit")
        .select("id")
        .eq("sku_id", skuId)
        .eq("status", "available")
        .order("created_at", { ascending: true })
        .limit(1)
        .single();

      // Resolve tax_code_id from qbo_tax_code_ref
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

  // Check if already synced
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

  // Compute correct subtotals (negated for refunds)
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

  // Resolve customer_id
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

    if (skuField && String(skuField).trim()) {
      const parsed = parseSku(String(skuField));
      skuCode = `${parsed.mpn}-G${parsed.conditionGrade}`;
    } else if (detail.ItemRef?.name) {
      const parsed = parseSku(String(detail.ItemRef.name));
      skuCode = `${parsed.mpn}-G${parsed.conditionGrade}`;
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

    // Resolve tax_code_id from qbo_tax_code_ref
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

    const accessToken = await ensureValidToken(supabaseAdmin, realmId, clientId, clientSecret);
    const baseUrl = `https://quickbooks.api.intuit.com/v3/company/${realmId}`;

    // Fetch both entity types
    const [salesReceipts, refundReceipts] = await Promise.all([
      queryQbo(baseUrl, accessToken, "SalesReceipt"),
      queryQbo(baseUrl, accessToken, "RefundReceipt"),
    ]);

    // Pre-fetch all unique QBO item IDs
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
    const BATCH_SIZE = 5;
    for (let i = 0; i < itemIdArray.length; i += BATCH_SIZE) {
      const batch = itemIdArray.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(id => fetchQboItem(id, itemCache, baseUrl, accessToken)));
      if (i + BATCH_SIZE < itemIdArray.length) {
        await new Promise(r => setTimeout(r, 250));
      }
    }
    console.log(`Pre-fetched ${itemCache.size} QBO items for sales sync`);

    let salesCreated = 0;
    let salesSkipped = 0;
    let salesNoItems = 0;
    let totalStockMatched = 0;
    let totalStockMissing = 0;
    let totalSalesLines = 0;

    for (const sr of salesReceipts) {
      try {
        const result = await processSalesReceipt(supabaseAdmin, sr, itemCache, baseUrl, accessToken);
        if (result.created) {
          salesCreated++;
          totalSalesLines += result.linesCreated;
          totalStockMatched += result.stockMatched;
          totalStockMissing += result.stockMissing;
        } else if (result.linesCreated === 0 && !result.created) {
          // Could be skipped (existing) or no item lines
          const hasItems = (sr.Line ?? []).some((l: any) => l.DetailType === "SalesItemLineDetail");
          if (hasItems) salesSkipped++;
          else salesNoItems++;
        }
      } catch (err) {
        console.error(`Failed to process SalesReceipt ${sr.Id}:`, err);
      }
    }

    let refundsCreated = 0;
    let refundsSkipped = 0;
    let totalRefundLines = 0;

    for (const rr of refundReceipts) {
      try {
        const result = await processRefundReceipt(supabaseAdmin, rr, itemCache, baseUrl, accessToken);
        if (result.created) {
          refundsCreated++;
          totalRefundLines += result.linesCreated;
        } else {
          refundsSkipped++;
        }
      } catch (err) {
        console.error(`Failed to process RefundReceipt ${rr.Id}:`, err);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        sales_receipts: salesReceipts.length,
        sales_created: salesCreated,
        sales_skipped: salesSkipped,
        sales_no_items: salesNoItems,
        sales_lines: totalSalesLines,
        stock_matched: totalStockMatched,
        stock_missing: totalStockMissing,
        refund_receipts: refundReceipts.length,
        refunds_created: refundsCreated,
        refunds_skipped: refundsSkipped,
        refund_lines: totalRefundLines,
        items_cached: itemCache.size,
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
