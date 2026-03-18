import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";

/**
 * QBO Retry Sync — Picks up sales_orders with qbo_sync_status IN ('pending', 'retrying')
 * and attempts to create the QBO Customer + SalesReceipt.
 *
 * Backoff schedule (minutes since last attempt):
 *   Attempt 1: immediate
 *   Attempt 2: 2 min
 *   Attempt 3: 10 min
 *   Attempt 4: 30 min
 *   Attempt 5: 60 min
 *   After 5 failures: mark 'failed' + create admin_alert
 *
 * Can be triggered:
 *   - By cron (e.g. every 5 minutes)
 *   - By stripe-webhook or ebay-process-order after a failed inline sync
 *   - Manually from admin UI
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const QBO_API_BASE = "https://quickbooks.api.intuit.com/v3/company";

// Backoff thresholds in milliseconds — minimum wait before next attempt
const BACKOFF_MS = [
  0,           // attempt 1: immediate
  2 * 60_000,  // attempt 2: 2 min
  10 * 60_000, // attempt 3: 10 min
  30 * 60_000, // attempt 4: 30 min
  60 * 60_000, // attempt 5: 60 min
];
const MAX_RETRIES = 5;

// ─── QBO helpers ────────────────────────────────────────────

async function ensureValidToken(admin: any, realmId: string, clientId: string, clientSecret: string): Promise<string> {
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
    if (!tokenRes.ok) throw new Error(`QBO token refresh failed [${tokenRes.status}]`);
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

async function qboRequest(accessToken: string, realmId: string, path: string, options: RequestInit = {}) {
  const url = `${QBO_API_BASE}/${realmId}${path}${path.includes("?") ? "&" : "?"}minorversion=65`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`QBO API [${res.status}]: ${JSON.stringify(data)}`);
  return data;
}

async function findOrCreateCustomer(
  accessToken: string, realmId: string, customerName: string,
  details?: { email?: string | null; shippingAddress?: { line1?: string; line2?: string; city?: string; stateOrProvince?: string; postalCode?: string; country?: string } | null }
): Promise<{ id: string; name: string }> {
  const escaped = customerName.replace(/'/g, "\\'");
  const queryResult = await qboRequest(accessToken, realmId,
    `/query?query=${encodeURIComponent(`SELECT * FROM Customer WHERE DisplayName = '${escaped}'`)}`);
  const existing = queryResult?.QueryResponse?.Customer;
  if (existing?.length) {
    const cust = existing[0];
    const updates: any = { Id: cust.Id, SyncToken: cust.SyncToken, sparse: true };
    let needsUpdate = false;
    if (details?.email && !cust.PrimaryEmailAddr?.Address) {
      updates.PrimaryEmailAddr = { Address: details.email };
      needsUpdate = true;
    }
    if (details?.shippingAddress && !cust.ShipAddr?.Line1) {
      const a = details.shippingAddress;
      const addr = { Line1: a.line1 || "", Line2: a.line2 || "", City: a.city || "", CountrySubDivisionCode: a.stateOrProvince || "", PostalCode: a.postalCode || "", Country: a.country || "" };
      updates.ShipAddr = addr;
      updates.BillAddr = addr;
      needsUpdate = true;
    }
    if (needsUpdate) {
      try { await qboRequest(accessToken, realmId, "/customer", { method: "POST", body: JSON.stringify(updates) }); }
      catch (e: any) { console.warn(`Failed to update QBO Customer ${cust.Id}:`, e.message); }
    }
    return { id: cust.Id, name: cust.DisplayName };
  }

  const body: any = { DisplayName: customerName };
  if (details?.email) body.PrimaryEmailAddr = { Address: details.email };
  if (details?.shippingAddress) {
    const a = details.shippingAddress;
    const addr = { Line1: a.line1 || "", Line2: a.line2 || "", City: a.city || "", CountrySubDivisionCode: a.stateOrProvince || "", PostalCode: a.postalCode || "", Country: a.country || "" };
    body.ShipAddr = addr;
    body.BillAddr = addr;
  }
  const createResult = await qboRequest(accessToken, realmId, "/customer", { method: "POST", body: JSON.stringify(body) });
  const created = createResult?.Customer;
  if (!created?.Id) throw new Error(`Failed to create QBO customer: ${customerName}`);
  return { id: created.Id, name: created.DisplayName };
}

async function findQboItemBySku(accessToken: string, realmId: string, sku: string): Promise<{ id: string; name: string } | null> {
  try {
    const escaped = sku.replace(/'/g, "\\'");
    const result = await qboRequest(accessToken, realmId,
      `/query?query=${encodeURIComponent(`SELECT * FROM Item WHERE Sku = '${escaped}'`)}`);
    const items = result?.QueryResponse?.Item;
    if (items?.length) return { id: items[0].Id, name: items[0].Name };
  } catch { /* not found */ }
  return null;
}

async function resolveSalesTaxInfo(
  admin: any, qboAccessToken: string, realmId: string
): Promise<{ taxCodeId: string; taxRateId: string; ratePercent: number }> {
  const { data: taxCodes } = await admin
    .from("tax_code")
    .select("qbo_tax_code_id, sales_tax_rate_id, vat_rate:sales_tax_rate_id(qbo_tax_rate_id, rate_percent)")
    .eq("active", true)
    .not("sales_tax_rate_id", "is", null);

  if (taxCodes?.length) {
    const standard = taxCodes.find((tc: any) => tc.vat_rate?.rate_percent === 20);
    const pick = standard || taxCodes[0];
    if (pick?.vat_rate) {
      return { taxCodeId: pick.qbo_tax_code_id, taxRateId: pick.vat_rate.qbo_tax_rate_id, ratePercent: Number(pick.vat_rate.rate_percent) };
    }
  }

  console.log("No local tax info — querying QBO...");
  const result = await qboRequest(qboAccessToken, realmId,
    `/query?query=${encodeURIComponent("SELECT * FROM TaxCode WHERE Active = true MAXRESULTS 50")}`);
  const qboTaxCodes = result?.QueryResponse?.TaxCode;
  if (!qboTaxCodes?.length) throw new Error("No active TaxCodes found in QBO");
  const std = qboTaxCodes.find((tc: any) => tc.Name?.includes("20") && tc.Name?.match(/S/i) && !tc.Name?.match(/Purchase|P\b/i));
  const pick = std || qboTaxCodes[0];
  const salesRateId = pick.SalesTaxRateList?.TaxRateDetail?.[0]?.TaxRateRef?.value || "0";
  return { taxCodeId: pick.Id, taxRateId: String(salesRateId), ratePercent: 20 };
}

// ─── Sync one order to QBO ──────────────────────────────────

async function syncOrderToQbo(
  admin: any, order: any, qboToken: string, realmId: string
): Promise<{ qboCustomerId: string; qboSalesReceiptId: string }> {
  // Gather customer details from the order
  const customerName = order.guest_name || order.shipping_name || "Customer";
  const customerEmail = order.guest_email || null;

  // Build shipping address from order fields
  const shippingAddress = order.shipping_line_1 ? {
    line1: order.shipping_line_1 || "",
    line2: order.shipping_line_2 || "",
    city: order.shipping_city || "",
    stateOrProvince: order.shipping_county || "",
    postalCode: order.shipping_postcode || "",
    country: order.shipping_country || "GB",
  } : null;

  // Upsert QBO Customer
  const qboCustomer = await findOrCreateCustomer(qboToken, realmId, customerName, {
    email: customerEmail,
    shippingAddress,
  });

  // Backfill qbo_customer_id on the local customer record if linked
  if (order.customer_id) {
    await admin.from("customer").update({
      qbo_customer_id: qboCustomer.id,
      synced_at: new Date().toISOString(),
    }).eq("id", order.customer_id).is("qbo_customer_id", null);
  }

  // Resolve tax info
  const taxInfo = await resolveSalesTaxInfo(admin, qboToken, realmId);
  const multiplier = 1 + taxInfo.ratePercent / 100;

  // Fetch order lines with SKU codes
  const { data: orderLines } = await admin
    .from("sales_order_line")
    .select("id, sku_id, quantity, unit_price, line_total, sku:sku_id(sku_code, qbo_item_id)")
    .eq("sales_order_id", order.id);

  // Build QBO SalesReceipt lines
  const qboLines: any[] = [];
  let totalNet = 0;
  let totalTax = 0;

  for (const ol of (orderLines || [])) {
    const skuCode = ol.sku?.sku_code;
    const grossLineTotal = Number(ol.line_total) || 0;
    const qty = ol.quantity || 1;
    const netLine = Math.round((grossLineTotal / multiplier) * 100) / 100;
    const lineTax = Math.round((grossLineTotal - netLine) * 100) / 100;
    const netUnit = Math.round((netLine / qty) * 100) / 100;
    totalNet += netLine;
    totalTax += lineTax;

    // Resolve QBO ItemRef
    let itemRef: any = null;
    if (ol.sku?.qbo_item_id) {
      itemRef = { value: ol.sku.qbo_item_id };
    } else if (skuCode) {
      const qboItem = await findQboItemBySku(qboToken, realmId, skuCode);
      if (qboItem) itemRef = { value: qboItem.id, name: qboItem.name };
    }

    qboLines.push({
      DetailType: "SalesItemLineDetail",
      Amount: netLine,
      Description: skuCode || `Order line`,
      SalesItemLineDetail: {
        Qty: qty,
        UnitPrice: netUnit,
        TaxCodeRef: { value: taxInfo.taxCodeId },
        ...(itemRef ? { ItemRef: itemRef } : {}),
      },
    });
  }

  // Rounding adjustment
  const grossTotal = Number(order.gross_total) || 0;
  const computedGross = totalNet + totalTax;
  const diff = Math.round((grossTotal - computedGross) * 100) / 100;
  if (diff !== 0 && qboLines.length > 0) {
    const lastLine = qboLines[qboLines.length - 1];
    lastLine.Amount = Math.round((lastLine.Amount + diff) * 100) / 100;
    lastLine.SalesItemLineDetail.UnitPrice = Math.round((lastLine.Amount / lastLine.SalesItemLineDetail.Qty) * 100) / 100;
    totalNet += diff;
  }
  totalNet = Math.round(totalNet * 100) / 100;
  totalTax = Math.round(totalTax * 100) / 100;

  if (!qboLines.length) {
    // Fallback line
    const fallbackNet = Math.round((grossTotal / multiplier) * 100) / 100;
    qboLines.push({
      DetailType: "SalesItemLineDetail",
      Amount: fallbackNet,
      Description: `Order ${order.order_number || order.id}`,
      SalesItemLineDetail: { Qty: 1, UnitPrice: fallbackNet, TaxCodeRef: { value: taxInfo.taxCodeId } },
    });
    totalNet = fallbackNet;
    totalTax = Math.round((grossTotal - fallbackNet) * 100) / 100;
  }

  // DocNumber for cross-channel dedup
  const docNumber = order.doc_number || order.order_number || null;

  // Check if SalesReceipt already exists in QBO (by DocNumber)
  let existingReceiptId: string | null = null;
  if (docNumber) {
    try {
      const escaped = docNumber.replace(/'/g, "\\'");
      const result = await qboRequest(qboToken, realmId,
        `/query?query=${encodeURIComponent(`SELECT Id FROM SalesReceipt WHERE DocNumber = '${escaped}'`)}`);
      existingReceiptId = result?.QueryResponse?.SalesReceipt?.[0]?.Id || null;
    } catch { /* not found */ }
  }

  if (existingReceiptId) {
    console.log(`SalesReceipt already exists in QBO (ID: ${existingReceiptId}) for order ${order.id}`);
    return { qboCustomerId: qboCustomer.id, qboSalesReceiptId: existingReceiptId };
  }

  // Create SalesReceipt
  const receiptBody: any = {
    CustomerRef: { value: qboCustomer.id },
    TxnDate: order.txn_date || new Date().toISOString().split("T")[0],
    CurrencyRef: { value: order.currency || "GBP" },
    GlobalTaxCalculation: "TaxExcluded",
    Line: qboLines,
    TxnTaxDetail: {
      TotalTax: totalTax,
      TaxLine: [{
        Amount: totalTax,
        DetailType: "TaxLineDetail",
        TaxLineDetail: {
          TaxRateRef: { value: taxInfo.taxRateId },
          PercentBased: true,
          TaxPercent: taxInfo.ratePercent,
          NetAmountTaxable: totalNet,
        },
      }],
    },
  };
  if (docNumber) receiptBody.DocNumber = docNumber;

  const result = await qboRequest(qboToken, realmId, "/salesreceipt", {
    method: "POST", body: JSON.stringify(receiptBody),
  });
  const receipt = result?.SalesReceipt;
  if (!receipt?.Id) throw new Error("QBO SalesReceipt creation returned no Id");

  // Backfill doc_number on the order if we didn't have one
  if (!order.doc_number && receipt.DocNumber) {
    await admin.from("sales_order").update({ doc_number: receipt.DocNumber }).eq("id", order.id);
  }

  console.log(`QBO SalesReceipt created: ID=${receipt.Id} for order ${order.id}`);
  return { qboCustomerId: qboCustomer.id, qboSalesReceiptId: receipt.Id };
}

// ═════════════════════════════════════════════════════════════
// MAIN HANDLER
// ═════════════════════════════════════════════════════════════

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

    // Auth: service-role only
    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.replace("Bearer ", "") || "";
    if (token !== serviceRoleKey) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const now = Date.now();

    // Find orders needing QBO sync, respecting backoff
    const { data: pendingOrders, error: queryErr } = await admin
      .from("sales_order")
      .select("id, order_number, origin_channel, origin_reference, doc_number, guest_name, guest_email, shipping_name, shipping_line_1, shipping_line_2, shipping_city, shipping_county, shipping_postcode, shipping_country, customer_id, gross_total, tax_total, currency, txn_date, qbo_sync_status, qbo_retry_count, qbo_last_attempt_at")
      .in("qbo_sync_status", ["pending", "retrying"])
      .order("qbo_last_attempt_at", { ascending: true, nullsFirst: true })
      .limit(10);

    if (queryErr) throw new Error(`Failed to query pending orders: ${queryErr.message}`);
    if (!pendingOrders?.length) {
      return new Response(
        JSON.stringify({ success: true, processed: 0, message: "No orders pending QBO sync" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get QBO token once for all orders
    const qboToken = await ensureValidToken(admin, realmId, clientId, clientSecret);

    let synced = 0;
    let retrying = 0;
    let failed = 0;
    let skippedBackoff = 0;
    const results: any[] = [];

    for (const order of pendingOrders) {
      // Check backoff — has enough time elapsed since last attempt?
      const retryCount = order.qbo_retry_count || 0;
      if (order.qbo_last_attempt_at && retryCount > 0) {
        const backoffIdx = Math.min(retryCount - 1, BACKOFF_MS.length - 1);
        const minWait = BACKOFF_MS[backoffIdx];
        const elapsed = now - new Date(order.qbo_last_attempt_at).getTime();
        if (elapsed < minWait) {
          skippedBackoff++;
          continue;
        }
      }

      try {
        const { qboCustomerId, qboSalesReceiptId } = await syncOrderToQbo(admin, order, qboToken, realmId);

        // Success — mark synced
        await admin.from("sales_order").update({
          qbo_sync_status: "synced",
          qbo_sales_receipt_id: qboSalesReceiptId,
          qbo_customer_id: qboCustomerId,
          qbo_last_attempt_at: new Date().toISOString(),
          qbo_last_error: null,
        }).eq("id", order.id);

        // Audit the successful sync
        await admin.from("audit_event").insert({
          entity_type: "sales_order",
          entity_id: order.id,
          trigger_type: "qbo_sync",
          actor_type: "system",
          source_system: "qbo-retry-sync",
          after_json: {
            qbo_sync_status: "synced",
            qbo_sales_receipt_id: qboSalesReceiptId,
            qbo_customer_id: qboCustomerId,
            retry_count: retryCount,
          },
        });

        synced++;
        results.push({ order_id: order.id, status: "synced", qbo_receipt_id: qboSalesReceiptId });
        console.log(`Synced order ${order.id} → QBO SalesReceipt ${qboSalesReceiptId}`);

      } catch (err: any) {
        const errorMsg = (err.message || "Unknown error").substring(0, 500);
        const newRetryCount = retryCount + 1;

        if (newRetryCount >= MAX_RETRIES) {
          // Exhausted retries — mark failed and alert admin
          await admin.from("sales_order").update({
            qbo_sync_status: "failed",
            qbo_retry_count: newRetryCount,
            qbo_last_error: errorMsg,
            qbo_last_attempt_at: new Date().toISOString(),
          }).eq("id", order.id);

          // Create admin alert
          await admin.from("admin_alert").insert({
            severity: "critical",
            category: "qbo_sync_failure",
            title: `QBO sync failed after ${MAX_RETRIES} attempts`,
            detail: `Order ${order.order_number || order.id} (${order.origin_channel}) could not be synced to QBO. Last error: ${errorMsg}`,
            entity_type: "sales_order",
            entity_id: order.id,
          });

          // Audit the failure
          await admin.from("audit_event").insert({
            entity_type: "sales_order",
            entity_id: order.id,
            trigger_type: "qbo_sync_failed",
            actor_type: "system",
            source_system: "qbo-retry-sync",
            after_json: {
              qbo_sync_status: "failed",
              retry_count: newRetryCount,
              last_error: errorMsg,
            },
          });

          failed++;
          results.push({ order_id: order.id, status: "failed", error: errorMsg });
          console.error(`QBO sync FAILED permanently for order ${order.id} after ${MAX_RETRIES} attempts: ${errorMsg}`);

        } else {
          // Still retrying
          await admin.from("sales_order").update({
            qbo_sync_status: "retrying",
            qbo_retry_count: newRetryCount,
            qbo_last_error: errorMsg,
            qbo_last_attempt_at: new Date().toISOString(),
          }).eq("id", order.id);

          retrying++;
          results.push({ order_id: order.id, status: "retrying", attempt: newRetryCount, error: errorMsg });
          console.warn(`QBO sync attempt ${newRetryCount}/${MAX_RETRIES} failed for order ${order.id}: ${errorMsg}`);
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        total_pending: pendingOrders.length,
        skipped_backoff: skippedBackoff,
        synced,
        retrying,
        failed,
        results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err: any) {
    console.error("qbo-retry-sync error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
