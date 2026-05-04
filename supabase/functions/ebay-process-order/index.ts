// Redeployed: 2026-03-23
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";
import { verifyServiceRoleJWT } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const EBAY_API = "https://api.ebay.com";
const FETCH_TIMEOUT_MS = 30_000;

/** Fetch with timeout to prevent indefinite hangs on external APIs */
function fetchWithTimeout(url: string | URL, options: RequestInit = {}, timeoutMs = FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

// ─── eBay helpers ───────────────────────────────────────────

async function getEbayAccessToken(admin: any): Promise<string> {
  const { data: conn, error } = await admin
    .from("ebay_connection")
    .select("*")
    .limit(1)
    .maybeSingle();
  if (error || !conn) throw new Error("eBay not connected.");

  if (new Date(conn.token_expires_at).getTime() > Date.now() + 60_000) {
    return conn.access_token;
  }

  const clientId = Deno.env.get("EBAY_CLIENT_ID")!;
  const clientSecret = Deno.env.get("EBAY_CLIENT_SECRET")!;
  const res = await fetchWithTimeout(`${EBAY_API}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: conn.refresh_token,
      scope: [
        "https://api.ebay.com/oauth/api_scope",
        "https://api.ebay.com/oauth/api_scope/sell.inventory",
        "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
        "https://api.ebay.com/oauth/api_scope/sell.account",
        "https://api.ebay.com/oauth/api_scope/commerce.notification.subscription",
      ].join(" "),
    }),
  });
  if (!res.ok) throw new Error(`eBay token refresh failed [${res.status}]`);
  const data = await res.json();
  const newExpiresAt = new Date(Date.now() + (data.expires_in || 7200) * 1000).toISOString();
  await admin.from("ebay_connection").update({
    access_token: data.access_token,
    ...(data.refresh_token ? { refresh_token: data.refresh_token } : {}),
    token_expires_at: newExpiresAt,
  }).eq("id", conn.id);
  return data.access_token;
}

async function ebayFetch(token: string, path: string, options: RequestInit = {}) {
  const url = path.startsWith("http") ? path : `${EBAY_API}${path}`;
  const res = await fetchWithTimeout(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Accept-Language": "en-GB",
      "Content-Language": "en-GB",
      "X-EBAY-C-MARKETPLACE-ID": "EBAY_GB",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`eBay API [${res.status}]: ${text}`);
  }
  if (res.status === 204) return null;
  const text = await res.text();
  if (!text?.trim()) return null;
  return JSON.parse(text);
}

// ─── Tax resolution ─────────────────────────────────────────

// EU 27 member states — zero-rated EC dispatch (QBO code "ECG 0%")
const EU_COUNTRY_CODES = new Set([
  "AT","BE","BG","HR","CY","CZ","DK","EE","FI","FR","DE","GR","HU",
  "IE","IT","LV","LT","LU","MT","NL","PL","PT","RO","SK","SI","ES","SE",
]);

// UK VAT area: GB (England, Scotland, Wales, NI) + IM (Isle of Man).
// Crown Dependencies GG (Guernsey) and JE (Jersey) are NOT in the UK VAT area.
const UK_VAT_CODES = new Set(["GB", "IM"]);

type VatDestination = "uk" | "eu" | "row";

function classifyShippingCountry(countryCode: string): VatDestination {
  const code = countryCode.toUpperCase();
  if (UK_VAT_CODES.has(code)) return "uk";
  if (EU_COUNTRY_CODES.has(code)) return "eu";
  return "row";
}

interface VatResolution {
  destination: VatDestination;
  taxCodeId: string;
  vatRateId: string;
  qboTaxCodeId: string;
  qboTaxRateId: string;
  ratePercent: number;
}

/**
 * Resolve the correct QBO VAT tax code based on shipping destination.
 *
 * Three treatments (UK-based seller, post-Brexit, standard-rated goods only):
 *   UK (GB, IM)         → 20.0% S   — Standard-rated domestic sale
 *   EU (27 members)     → ECG 0%    — Zero-rated EC goods dispatch
 *   Rest of World       → 0.0% Z    — Zero-rated export
 *
 * Matches against the local tax_code + vat_rate tables (synced from QBO)
 * by name pattern, NOT by hardcoded IDs.
 *
 * Throws if the required tax code is missing from the local table.
 */
async function resolveVatForShippingCountry(
  admin: any,
  shippingCountry: string,
): Promise<VatResolution> {
  const destination = classifyShippingCountry(shippingCountry);

  // Fetch all active tax codes with their linked sales vat_rate
  const { data: taxCodes, error: tcErr } = await admin
    .from("tax_code")
    .select("id, qbo_tax_code_id, name, sales_tax_rate_id, vat_rate:sales_tax_rate_id(id, qbo_tax_rate_id, rate_percent)")
    .eq("active", true)
    .not("sales_tax_rate_id", "is", null);

  if (tcErr) throw new Error(`Failed to query tax_code table: ${tcErr.message}`);
  if (!taxCodes?.length) {
    throw new Error("No active tax codes with linked VAT rates found in the local database. Run a QBO tax rate sync first.");
  }

  // Match strategy by name pattern:
  //   UK  → rate_percent = 20 (the standard rate, name like "20.0% S")
  //   EU  → name starts with "ECG" (e.g. "ECG 0%")
  //   RoW → rate_percent = 0 AND name does NOT start with "ECG" (e.g. "0.0% Z")
  let match: any = null;
  let expectedDesc = "";

  switch (destination) {
    case "uk": {
      match = taxCodes.find((tc: any) => Number(tc.vat_rate?.rate_percent) === 20);
      expectedDesc = 'a standard-rate tax code (rate_percent = 20, e.g. "20.0% S")';
      break;
    }
    case "eu": {
      match = taxCodes.find((tc: any) => /^ECG/i.test(tc.name || ""));
      expectedDesc = 'an EC goods tax code (name starting with "ECG", e.g. "ECG 0%")';
      break;
    }
    case "row": {
      match = taxCodes.find(
        (tc: any) => Number(tc.vat_rate?.rate_percent) === 0 && !/^ECG/i.test(tc.name || "")
      );
      expectedDesc = 'a zero-rate export tax code (rate_percent = 0, name like "0.0% Z")';
      break;
    }
  }

  if (!match?.vat_rate) {
    const available = taxCodes.map((tc: any) => `"${tc.name}" (${tc.vat_rate?.rate_percent ?? "?"}%)`).join(", ");
    throw new Error(
      `No matching tax code for ${destination.toUpperCase()} destination (${shippingCountry}). ` +
      `Expected ${expectedDesc}. ` +
      `Available tax codes: [${available}]. ` +
      `Ensure the required QBO tax codes are synced via qbo-sync-tax-rates.`
    );
  }

  return {
    destination,
    taxCodeId: match.id,
    vatRateId: match.vat_rate.id,
    qboTaxCodeId: match.qbo_tax_code_id,
    qboTaxRateId: match.vat_rate.qbo_tax_rate_id,
    ratePercent: Number(match.vat_rate.rate_percent),
  };
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
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Only accept service-role calls (from ebay-notifications)
    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.replace("Bearer ", "") || "";
    if (!verifyServiceRoleJWT(token, supabaseUrl)) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, serviceKey);
    const body = await req.json().catch(() => ({}));
    const orderId = body.order_id;
    const action = body.action || "process_order";

    if (!orderId) {
      return new Response(JSON.stringify({ error: "Missing order_id" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ═══════════════════════════════════════════════════════════
    // ACTION: process_shipment
    // ═══════════════════════════════════════════════════════════
    if (action === "process_shipment") {
      console.log(`Processing shipment for eBay order: ${orderId}`);

      // ── Find local sales_order ──
      const { data: localOrder, error: findErr } = await admin
        .from("sales_order")
        .select("id, doc_number, status")
        .eq("origin_channel", "ebay")
        .eq("origin_reference", orderId)
        .maybeSingle();

      if (findErr || !localOrder) {
        console.warn(`No local order found for eBay order ${orderId}, skipping shipment update`);
        return new Response(
          JSON.stringify({ success: false, error: "No matching local order found" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // ── Fetch order from eBay to get fulfillment data ──
      const ebayToken = await getEbayAccessToken(admin);
      const order = await ebayFetch(ebayToken, `/sell/fulfillment/v1/order/${orderId}`);
      if (!order) throw new Error(`eBay order ${orderId} not found`);

      // ── Extract fulfillment details ──
      let shippingCarrier: string | null = null;
      let trackingNumber: string | null = null;
      let shippedDate: string | null = null;

      const fulfillmentHrefs = order.fulfillmentHrefs || [];
      if (fulfillmentHrefs.length > 0) {
        // Fetch the first (primary) fulfillment
        try {
          const fulfillment = await ebayFetch(ebayToken, fulfillmentHrefs[0]);
          if (fulfillment) {
            const shipmentTrackings = fulfillment.shipmentTrackingNumber
              ? [{ shippingCarrierCode: fulfillment.shippingCarrierCode, shipmentTrackingNumber: fulfillment.shipmentTrackingNumber }]
              : fulfillment.lineItems?.[0]?.lineItemFulfillmentInstructions
                ? []
                : [];

            // Try structured tracking from fulfillment
            shippingCarrier = fulfillment.shippingCarrierCode || null;
            trackingNumber = fulfillment.shipmentTrackingNumber || null;
            shippedDate = fulfillment.shippedDate?.split("T")[0] || null;
          }
        } catch (e: any) {
          console.warn(`Failed to fetch fulfillment detail: ${e.message}`);
        }
      }

      // Fallback: extract from order-level fulfillmentStartInstructions or lineItems
      if (!shippingCarrier && !trackingNumber) {
        for (const li of order.lineItems || []) {
          const deliveries = li.deliveryAddress ? [li] : [];
          for (const d of deliveries) {
            if (d.lineItemFulfillmentStatus === "FULFILLED") {
              shippedDate = shippedDate || order.lastModifiedDate?.split("T")[0] || new Date().toISOString().split("T")[0];
            }
          }
        }
      }

      // If still no shipped date, use the order's last modified date
      if (!shippedDate) {
        shippedDate = order.lastModifiedDate?.split("T")[0] || new Date().toISOString().split("T")[0];
      }

      console.log(`Fulfillment data: carrier=${shippingCarrier}, tracking=${trackingNumber}, date=${shippedDate}`);

      // ── Update local sales_order ──
      const { error: updateErr } = await admin
        .from("sales_order")
        .update({
          shipped_via: shippingCarrier,
          tracking_number: trackingNumber,
          shipped_date: shippedDate,
          status: "shipped",
          v2_status: "shipped",
          updated_at: new Date().toISOString(),
        })
        .eq("id", localOrder.id);

      if (updateErr) {
        console.error(`Failed to update local order: ${updateErr.message}`);
        throw new Error(`Failed to update sales_order: ${updateErr.message}`);
      }
      console.log(`Local order ${localOrder.id} updated to shipped`);

      // ── Update linked stock units to shipped ──
      const { error: unitShipErr } = await admin
        .from("stock_unit")
        .update({
          v2_status: "shipped",
          shipped_at: shippedDate || new Date().toISOString(),
        } as never)
        .eq("order_id", localOrder.id)
        .in("v2_status" as never, ["sold", "listed", "graded"]);

      if (unitShipErr) {
        console.warn(`Failed to update stock units to shipped: ${unitShipErr.message}`);
      } else {
        console.log(`Stock units for order ${localOrder.id} marked as shipped`);
      }

      // ── Audit event ──
      await admin.from("audit_event").insert({
        entity_type: "sales_order",
        entity_id: localOrder.id,
        trigger_type: "ebay_notification",
        actor_type: "system",
        source_system: "ebay-process-order",
        before_json: { status: localOrder.status },
        after_json: {
          status: "shipped",
          shipped_via: shippingCarrier,
          tracking_number: trackingNumber,
          shipped_date: shippedDate,
          qbo_updated: false,
          qbo_update_reason: "QBO SalesReceipt updates are handled by posting/reconciliation workers, not eBay notification processing.",
        },
      });

      console.log(`Shipment pipeline complete for ${orderId}`);

      return new Response(
        JSON.stringify({
          success: true,
          action: "process_shipment",
          order_id: orderId,
          sales_order_id: localOrder.id,
          shipped_via: shippingCarrier,
          tracking_number: trackingNumber,
          shipped_date: shippedDate,
          qbo_updated: qboUpdated,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ═══════════════════════════════════════════════════════════
    // ACTION: process_order (default)
    //
    // The sale is a legal fact — local order MUST be created
    // regardless of QBO availability. QBO sync is attempted
    // after, but failure is non-fatal; the retry function
    // will pick up any orders with qbo_sync_status != 'synced'.
    // ═══════════════════════════════════════════════════════════
    console.log(`Processing eBay order: ${orderId}`);

    // ── Step 1: Land raw order payload ──
    const ebayToken = await getEbayAccessToken(admin);
    const order = await ebayFetch(ebayToken, `/sell/fulfillment/v1/order/${orderId}`);
    if (!order) throw new Error(`eBay order ${orderId} not found`);

    const correlationId = crypto.randomUUID();
    const { data: landingRow } = await admin
      .from("landing_raw_ebay_order")
      .upsert(
        {
          external_id: orderId,
          raw_payload: order,
          status: "pending",
          correlation_id: correlationId,
          received_at: new Date().toISOString(),
        },
        { onConflict: "external_id" }
      )
      .select("id")
      .single();
    const landingId = landingRow?.id;
    console.log(`Landed eBay order ${orderId} → landing_raw_ebay_order ${landingId}`);

    // ── Step 2: Idempotency check ──
    const { data: existing } = await admin
      .from("sales_order")
      .select("id")
      .eq("origin_channel", "ebay")
      .eq("origin_reference", orderId)
      .maybeSingle();

    if (existing) {
      console.log(`Order ${orderId} already processed (sales_order ${existing.id}), skipping`);
      if (landingId) {
        await admin.from("landing_raw_ebay_order").update({
          status: "skipped",
          processed_at: new Date().toISOString(),
          error_message: `Already committed as sales_order ${existing.id}`,
        }).eq("id", landingId);
      }
      return new Response(
        JSON.stringify({ success: true, skipped: true, sales_order_id: existing.id }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Step 3: Extract order data from landed payload ──
    const shipTo = order.fulfillmentStartInstructions?.[0]?.shippingStep?.shipTo;
    const buyerName = shipTo?.fullName || order.buyer?.username || "eBay Buyer";
    const buyerEmail = order.buyer?.buyerRegistrationAddress?.email || null;
    const ebayGrossTotal = parseFloat(order.pricingSummary?.total?.value || "0");
    const currency = order.pricingSummary?.total?.currency || "GBP";
    const creationDate = order.creationDate?.split("T")[0] || new Date().toISOString().split("T")[0];
    const lineItems = order.lineItems || [];
    const shippingAddr = shipTo?.contactAddress;
    const docNumber = orderId.length <= 21 ? orderId : orderId.substring(0, 21);
    const shippingCountry = (shippingAddr?.countryCode || "GB").toUpperCase();

    console.log(`eBay order ${orderId}: buyer=${buyerName}, gross=${ebayGrossTotal}, country=${shippingCountry}, lines=${lineItems.length}`);

    // ── Step 3b: Resolve correct VAT rate from shipping country ──
    // eBay does NOT reliably send the VAT rate — we determine it from the
    // buyer's shipping country using our local tax_code / vat_rate tables
    // (synced from QBO).
    //
    // If the required tax code is missing (e.g. ECG not synced yet), fall back
    // to UK standard rate (20%) and alert admin. The order must still be created;
    // the tax code can be corrected in QBO and synced back via webhook.
    let vatResolution: VatResolution;
    let vatResolutionFallback = false;
    try {
      vatResolution = await resolveVatForShippingCountry(admin, shippingCountry);
    } catch (vatErr: any) {
      console.warn(`VAT resolution failed for ${shippingCountry}, falling back to UK 20%: ${vatErr.message}`);
      vatResolutionFallback = true;
      // Build a fallback using the UK standard rate tax code
      const { data: fallbackCodes } = await admin
        .from("tax_code")
        .select("id, qbo_tax_code_id, name, sales_tax_rate_id, vat_rate:sales_tax_rate_id(id, qbo_tax_rate_id, rate_percent)")
        .eq("active", true)
        .not("sales_tax_rate_id", "is", null);
      const ukStandard = fallbackCodes?.find((tc: any) => Number(tc.vat_rate?.rate_percent) === 20);
      if (!ukStandard?.vat_rate) {
        // No tax codes at all — cannot process. This is a hard prerequisite.
        throw new Error(`VAT resolution failed and no fallback tax code available. Original error: ${vatErr.message}`);
      }
      const vatRate = ukStandard.vat_rate as any;
      vatResolution = {
        destination: "uk",
        taxCodeId: ukStandard.id,
        vatRateId: vatRate.id,
        qboTaxCodeId: ukStandard.qbo_tax_code_id,
        qboTaxRateId: vatRate.qbo_tax_rate_id,
        ratePercent: Number(vatRate.rate_percent),
      };
    }
    const vatMultiplier = 1 + vatResolution.ratePercent / 100; // e.g. 1.20 for 20%
    console.log(`VAT resolution: country=${shippingCountry}, destination=${vatResolution.destination}, rate=${vatResolution.ratePercent}%, fallback=${vatResolutionFallback}`);

    // ── Step 4: Resolve SKUs from local data (no QBO needed) ──
    const { data: allSkus } = await admin.from("sku").select("id, sku_code, qbo_item_id").eq("active_flag", true);
    const skuMap = new Map<string, { id: string; sku_code: string; qbo_item_id: string | null }>();
    for (const s of allSkus || []) {
      skuMap.set(s.sku_code, s);
    }

    interface ProcessedLine {
      skuId: string;
      skuCode: string;
      qty: number;
      unitPrice: number;  // NET per unit
      lineTotal: number;  // NET line total
      lineTax: number;    // VAT amount for this line
      ebaySku: string;
      title: string;
    }
    const processedLines: ProcessedLine[] = [];

    const skippedLines: Array<{ ebaySku: string; title: string; reason: string }> = [];

    for (const li of lineItems) {
      const ebaySku = li.sku || "";
      const matchedSku = skuMap.get(ebaySku);
      if (!matchedSku) {
        console.warn(`No SKU match for eBay SKU "${ebaySku}" in order ${orderId}`);
        skippedLines.push({ ebaySku, title: li.title || "unknown", reason: "no_local_sku_match" });
        continue;
      }
      const qty = li.quantity || 1;
      // eBay sends GROSS (VAT-inclusive) amounts — convert to NET
      const grossLineTotal = parseFloat(li.lineItemCost?.value || "0");
      const netLineTotal = Math.round((grossLineTotal / vatMultiplier) * 100) / 100;
      const lineTax = Math.round((grossLineTotal - netLineTotal) * 100) / 100;
      const netUnitPrice = Math.round((netLineTotal / qty) * 100) / 100;
      processedLines.push({
        skuId: matchedSku.id,
        skuCode: matchedSku.sku_code,
        qty,
        unitPrice: netUnitPrice,
        lineTotal: netLineTotal,
        lineTax,
        ebaySku,
        title: li.title || matchedSku.sku_code,
      });
    }

    // ── Step 5: Create local customer from eBay buyer data (no QBO dependency) ──
    let localCustomerId: string | null = null;
    try {
      // Try to find existing customer by display_name
      const { data: existingCust } = await admin
        .from("customer")
        .select("id")
        .eq("display_name", buyerName)
        .maybeSingle();

      if (existingCust) {
        localCustomerId = existingCust.id;
      } else {
        const { data: newCust, error: custInsertErr } = await admin
          .from("customer")
          .insert({
            display_name: buyerName,
            email: buyerEmail,
            billing_line_1: shippingAddr?.addressLine1 || null,
            billing_city: shippingAddr?.city || null,
            billing_postcode: shippingAddr?.postalCode || null,
            billing_country: shippingAddr?.countryCode || "GB",
            channel_ids: { ebay: order.buyer?.username || buyerName },
          })
          .select("id")
          .single();
        if (custInsertErr) {
          console.error(`Customer insert FAILED for "${buyerName}": ${custInsertErr.message} (code: ${custInsertErr.code}, details: ${custInsertErr.details})`);
        } else {
          localCustomerId = newCust?.id ?? null;
        }
      }
    } catch (custErr: any) {
      console.error(`Customer creation exception for "${buyerName}": ${custErr.message}`);
    }
    if (localCustomerId) {
      console.log(`Customer linked: ${localCustomerId} (${buyerName})`);
    } else {
      console.warn(`Order ${orderId} will have no customer link (buyer: ${buyerName})`);
    }

    // ── Step 6: Insert local sales_order (qbo_sync_status = 'pending') ──
    // gross_total = the exact amount eBay charged the buyer. This is the
    // accounting-authoritative figure and what QBO must reflect.
    // merchandise_subtotal and tax_total are computed from matched lines only
    // (if lines were skipped due to SKU mismatch, they won't sum to gross_total;
    // the discrepancy is already flagged by the admin alert in step 7b).
    const merchandiseSubtotal = processedLines.reduce((s, pl) => s + pl.lineTotal, 0);
    const taxTotal = processedLines.reduce((s, pl) => s + pl.lineTax, 0);
    const grossTotal = ebayGrossTotal;

    const { data: newOrder, error: orderErr } = await admin
      .from("sales_order")
      .insert({
        origin_channel: "ebay",
        origin_reference: orderId,
        doc_number: docNumber,
        status: "paid",
        customer_id: localCustomerId,
        guest_name: buyerName,
        guest_email: buyerEmail || `ebay-${orderId}@imported.local`,
        shipping_name: shipTo?.fullName || buyerName,
        shipping_line_1: shippingAddr?.addressLine1 || "",
        shipping_line_2: shippingAddr?.addressLine2 || null,
        shipping_city: shippingAddr?.city || "",
        shipping_postcode: shippingAddr?.postalCode || "",
        shipping_country: shippingCountry,
        shipping_county: shippingAddr?.stateOrProvince || null,
        merchandise_subtotal: Math.round(merchandiseSubtotal * 100) / 100,
        tax_total: Math.round(taxTotal * 100) / 100,
        gross_total: grossTotal,
        global_tax_calculation: "TaxExcluded",
        currency,
        txn_date: creationDate,
        notes: `eBay order ${orderId} | Buyer: ${order.buyer?.username || "unknown"} | VAT ${vatResolution.ratePercent}%`,
        qbo_sync_status: "pending",
      })
      .select("id, order_number")
      .single();

    if (orderErr) throw new Error(`Failed to insert sales_order: ${orderErr.message}`);
    console.log(`Local sales_order created: ${newOrder.id} (${newOrder.order_number})`);

    // ── Step 7: Use resolved tax code from country-based VAT resolution ──
    const taxCodeId = vatResolution.taxCodeId;
    const vatRateId = vatResolution.vatRateId;
    const qboTaxCodeRef = vatResolution.qboTaxCodeId;

    // ── Step 7b: Audit skipped line items (SKU mismatches) ──
    // Wrapped in try/catch so a failed audit/alert insert doesn't cause the
    // function to return 500 when the sales_order was already created.
    if (skippedLines.length > 0) {
      try {
        await admin.from("audit_event").insert({
          entity_type: "sales_order",
          entity_id: newOrder.id,
          trigger_type: "ebay_notification",
          actor_type: "system",
          source_system: "ebay-process-order",
          correlation_id: correlationId,
          after_json: {
            warning: "sku_mismatch",
            skipped_lines: skippedLines,
            order_id: orderId,
            total_line_items: lineItems.length,
            matched_line_items: processedLines.length,
          },
        });

        await admin.from("admin_alert").insert({
          severity: "warning",
          category: "ebay_sku_mismatch",
          title: `eBay order ${orderId}: ${skippedLines.length} line(s) skipped — SKU not found`,
          detail: `SKUs not matched: ${skippedLines.map(s => s.ebaySku || "(empty)").join(", ")}. Order created with ${processedLines.length}/${lineItems.length} lines.`,
          entity_type: "sales_order",
          entity_id: newOrder.id,
        });
      } catch (auditErr: any) {
        console.error(`Failed to create SKU mismatch audit/alert for order ${orderId}:`, auditErr.message);
      }

      console.warn(`Order ${orderId}: ${skippedLines.length} line(s) skipped due to SKU mismatch`);
    }

    // ── Step 7c: Alert admin if VAT resolution fell back to default ──
    if (vatResolutionFallback) {
      try {
        await admin.from("audit_event").insert({
          entity_type: "sales_order",
          entity_id: newOrder.id,
          trigger_type: "vat_resolution_fallback",
          actor_type: "system",
          source_system: "ebay-process-order",
          correlation_id: correlationId,
          after_json: {
            shipping_country: shippingCountry,
            expected_destination: classifyShippingCountry(shippingCountry),
            applied_destination: vatResolution.destination,
            applied_rate_percent: vatResolution.ratePercent,
            fallback: true,
          },
        });
        await admin.from("admin_alert").insert({
          severity: "critical",
          category: "vat_resolution_fallback",
          title: `VAT fallback: eBay order ${orderId} (${shippingCountry}) used UK 20% default`,
          detail: `No matching tax code for ${classifyShippingCountry(shippingCountry).toUpperCase()} destination (${shippingCountry}). ` +
            `Order created with UK standard rate (20%) as fallback. ` +
            `Correct the tax code in QBO and ensure qbo-sync-tax-rates has been run. ` +
            `The app will pick up corrections via QBO webhook.`,
          entity_type: "sales_order",
          entity_id: newOrder.id,
        });
      } catch (alertErr: any) {
        console.error(`Failed to create VAT fallback alert for order ${orderId}:`, alertErr.message);
      }
    }

    // ── Step 8: Insert sales_order_lines and allocate stock through the costing subledger ──
    const affectedSkuIds = new Set<string>();
    let unitsDepletedTotal = 0;

    for (const pl of processedLines) {
      affectedSkuIds.add(pl.skuId);

      for (let i = 0; i < pl.qty; i += 1) {
        const { data: insertedLine, error: lineErr } = await admin
          .from("sales_order_line")
          .insert({
            sales_order_id: newOrder.id,
            sku_id: pl.skuId,
            quantity: 1,
            unit_price: pl.unitPrice,   // NET per unit
            line_total: pl.unitPrice,   // NET line total
            tax_code_id: taxCodeId,
            vat_rate_id: vatRateId,
            qbo_tax_code_ref: qboTaxCodeRef,
          })
          .select("id")
          .single();

        if (lineErr) {
          throw new Error(`Failed to create eBay order line for ${pl.skuCode}: ${lineErr.message}`);
        }

        const lineId = (insertedLine as Record<string, unknown>).id as string;
        const { data: allocation, error: allocationErr } = await admin
          .rpc("allocate_stock_for_order_line", { p_sales_order_line_id: lineId });

        const allocationResult = allocation as Record<string, unknown> | null;
        if (allocationErr || allocationResult?.status !== "allocated") {
          console.warn(`No available stock for ${pl.skuCode} on line ${lineId}`, allocationErr);
        } else {
          unitsDepletedTotal += 1;
        }
      }
    }

    await admin
      .rpc("refresh_order_line_economics", { p_sales_order_id: newOrder.id });

    // ── Step 10: Queue updated stock counts to channels ──
    let stockSyncQueued = 0;

    if (affectedSkuIds.size > 0) {
      const skuIdArray = [...affectedSkuIds];

      const stockCounts = new Map<string, number>();
      for (const skuId of skuIdArray) {
        const { count } = await admin
          .from("stock_unit")
          .select("id", { count: "exact", head: true })
          .eq("sku_id", skuId)
          .in("v2_status", ["graded", "listed", "restocked"]);
        stockCounts.set(skuId, count || 0);
      }

      const { data: listings } = await admin
        .from("channel_listing")
        .select("id, external_sku, sku_id, channel")
        .in("sku_id", skuIdArray)
        .not("sku_id", "is", null);

      for (const listing of listings || []) {
        const qty = stockCounts.get(listing.sku_id) || 0;
        if (listing.channel === "ebay") {
          try {
            const { error: commandErr } = await admin.rpc("queue_listing_command", {
              p_channel_listing_id: listing.id,
              p_command_type: "sync_quantity",
            });
            if (commandErr) throw commandErr;

            stockSyncQueued++;
            console.log(`Queued stock sync ${listing.external_sku} → ${qty} on eBay`);
          } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            console.error(`Failed to queue stock sync for ${listing.external_sku}:`, message);
            // Audit the stock sync failure — local stock is closed but eBay
            // still needs an outbox command to converge.
            // Wrapped in try/catch so a failed audit insert doesn't break the loop
            // and prevent remaining listings from being updated.
            try {
              await admin.from("audit_event").insert({
                entity_type: "channel_listing",
                entity_id: listing.id,
                trigger_type: "ebay_stock_sync_queue_failed",
                actor_type: "system",
                source_system: "ebay-process-order",
                correlation_id: correlationId,
                after_json: {
                  error: message,
                  external_sku: listing.external_sku,
                  intended_quantity: qty,
                  order_id: orderId,
                  sales_order_id: newOrder.id,
                },
              });
              await admin.from("admin_alert").insert({
                severity: "critical",
                category: "ebay_stock_desync",
                title: `eBay stock sync not queued: ${listing.external_sku}`,
                detail: `Failed to queue eBay quantity sync to ${qty} after order ${orderId}. Local stock is depleted but eBay listing may still show available inventory until this is corrected. Error: ${message}`,
                entity_type: "channel_listing",
                entity_id: listing.id,
              });
            } catch (alertErr) {
              const alertMessage = alertErr instanceof Error ? alertErr.message : String(alertErr);
              console.error(`Failed to create stock desync audit/alert for ${listing.external_sku}:`, alertMessage);
            }
          }
        }
      }
    }

    // ── Step 11: Mark landing row committed + audit event ──
    if (landingId) {
      await admin.from("landing_raw_ebay_order").update({
        status: "committed",
        processed_at: new Date().toISOString(),
        correlation_id: correlationId,
      }).eq("id", landingId);
    }

    await admin.from("audit_event").insert({
      entity_type: "sales_order",
      entity_id: newOrder.id,
      trigger_type: "ebay_notification",
      actor_type: "system",
      source_system: "ebay-process-order",
      correlation_id: correlationId,
      after_json: {
        order_id: orderId,
        lines: processedLines.length,
        units_depleted: unitsDepletedTotal,
        stock_sync_queued: stockSyncQueued,
        landing_id: landingId,
        qbo_sync_status: "pending",
      },
    });

    console.log(`Local pipeline complete for ${orderId}: ${processedLines.length} lines, ${unitsDepletedTotal} units depleted, ${stockSyncQueued} stock sync commands queued`);

    // ═══════════════════════════════════════════════════════════
    // Step 12: Queue QBO posting intent (NON-FATAL)
    //
    // The local order is committed. QBO posting is handled by the
    // posting_intent outbox so external financial writes are async,
    // idempotent, and observable.
    // ═══════════════════════════════════════════════════════════
    let qboSyncStatus = "pending";
    const qboCustomerId: string | null = null;
    const qboSalesReceiptId: string | null = null;
    let qboSyncError: string | null = null;

    const { error: postingIntentErr } = await admin
      .rpc("queue_qbo_posting_intents_for_order", { p_sales_order_id: newOrder.id });

    if (postingIntentErr) {
      qboSyncStatus = "needs_manual_review";
      qboSyncError = postingIntentErr.message;
      console.error(`Failed to queue QBO posting intent for eBay order ${orderId}: ${qboSyncError}`);
    } else {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      fetch(`${supabaseUrl}/functions/v1/accounting-posting-intents-process`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ batchSize: 10 }),
      }).catch(() => console.warn("posting intent processor trigger failed (non-blocking)"));
    }

    // ── Step 13: Update sales_order with QBO posting state ──
    await admin.from("sales_order").update({
      qbo_sync_status: qboSyncStatus,
      qbo_sales_receipt_id: qboSalesReceiptId,
      qbo_customer_id: qboCustomerId,
      qbo_last_error: qboSyncError,
      qbo_retry_count: 0,
    }).eq("id", newOrder.id);

    // ── Step 16: Generate welcome code for eBay buyer (non-fatal) ──
    // Creates a QR welcome code + Stripe promo on the customer's first eBay order.
    // Repeat buyers with unredeemed codes get the existing code returned.
    // Fire-and-forget — failure here does not affect the order.
    let welcomeCodeTriggered = false;
    try {
      const welcomeItems = processedLines.map(pl => ({
        mpn: pl.skuCode?.split(".")[0] || "",
        name: pl.title || "",
        img_url: "",
        quantity: pl.qty,
        sku_code: pl.skuCode || "",
      }));

      fetch(`${Deno.env.get("SUPABASE_URL")!}/functions/v1/generate-welcome-code`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ebay_order_id: orderId,
          sales_order_id: newOrder.id,
          customer_id: localCustomerId || null,
          buyer_name: buyerName,
          buyer_email: buyerEmail || null,
          order_items: welcomeItems,
          order_postcode: shippingAddr?.postalCode || null,
        }),
      }).catch(() => console.warn("generate-welcome-code trigger failed (non-blocking)"));
      welcomeCodeTriggered = true;
      console.log(`generate-welcome-code triggered for eBay order ${orderId}`);
    } catch { /* best effort */ }

    console.log(`Pipeline complete for ${orderId}: qbo_sync_status=${qboSyncStatus}`);

    return new Response(
      JSON.stringify({
        success: true,
        order_id: orderId,
        sales_order_id: newOrder.id,
        qbo_sync_status: qboSyncStatus,
        qbo_sales_receipt_id: qboSalesReceiptId,
        qbo_customer_id: qboCustomerId,
        lines_processed: processedLines.length,
        units_depleted: unitsDepletedTotal,
        stock_sync_queued: stockSyncQueued,
        welcome_code_triggered: welcomeCodeTriggered,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    console.error("ebay-process-order error:", e);
    // Try to mark landing row as error
    try {
      const body2 = await req.clone().json().catch(() => ({}));
      if (body2?.order_id) {
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        const errAdmin = createClient(supabaseUrl, serviceKey);
        await errAdmin.from("landing_raw_ebay_order").update({
          status: "error",
          error_message: (e.message || "Unknown error").substring(0, 500),
          processed_at: new Date().toISOString(),
        }).eq("external_id", body2.order_id).in("status", ["pending", "retrying"]);
      }
    } catch { /* best effort */ }
    return new Response(
      JSON.stringify({ error: e.message || "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
