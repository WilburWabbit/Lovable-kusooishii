import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const EBAY_API = "https://api.ebay.com";
const QBO_API_BASE = "https://quickbooks.api.intuit.com/v3/company";

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
  const res = await fetch(`${EBAY_API}/identity/v1/oauth2/token`, {
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
  const res = await fetch(url, {
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

// ─── QBO helpers ────────────────────────────────────────────

async function getQboAccessToken(admin: any): Promise<{ accessToken: string; realmId: string }> {
  const realmId = Deno.env.get("QBO_REALM_ID");
  const clientId = Deno.env.get("QBO_CLIENT_ID")!;
  const clientSecret = Deno.env.get("QBO_CLIENT_SECRET")!;
  if (!realmId || !clientId || !clientSecret) throw new Error("QBO credentials not configured");

  const { data: conn, error } = await admin
    .from("qbo_connection")
    .select("*")
    .eq("realm_id", realmId)
    .single();
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
    return { accessToken: tokens.access_token, realmId };
  }
  return { accessToken: conn.access_token, realmId };
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

// ─── QBO Customer upsert (ported from Kuso Hub) ────────────

async function findOrCreateCustomer(
  accessToken: string,
  realmId: string,
  customerName: string,
  details?: {
    email?: string | null;
    shippingAddress?: {
      line1?: string; line2?: string; city?: string;
      stateOrProvince?: string; postalCode?: string; country?: string;
    } | null;
  }
): Promise<{ id: string; name: string }> {
  const escaped = customerName.replace(/'/g, "\\'");
  const queryResult = await qboRequest(
    accessToken, realmId,
    `/query?query=${encodeURIComponent(`SELECT * FROM Customer WHERE DisplayName = '${escaped}'`)}`
  );
  const existing = queryResult?.QueryResponse?.Customer;
  if (existing?.length) {
    const cust = existing[0];
    // Sparse-update with missing details
    const updates: any = { Id: cust.Id, SyncToken: cust.SyncToken, sparse: true };
    let needsUpdate = false;
    if (details?.email && !cust.PrimaryEmailAddr?.Address) {
      updates.PrimaryEmailAddr = { Address: details.email };
      needsUpdate = true;
    }
    if (details?.shippingAddress && !cust.ShipAddr?.Line1) {
      const a = details.shippingAddress;
      const addr = {
        Line1: a.line1 || "", Line2: a.line2 || "", City: a.city || "",
        CountrySubDivisionCode: a.stateOrProvince || "",
        PostalCode: a.postalCode || "", Country: a.country || "",
      };
      updates.ShipAddr = addr;
      updates.BillAddr = addr;
      needsUpdate = true;
    }
    if (needsUpdate) {
      try {
        await qboRequest(accessToken, realmId, "/customer", {
          method: "POST", body: JSON.stringify(updates),
        });
      } catch (e: any) {
        console.warn(`Failed to update QBO Customer ${cust.Id}:`, e.message);
      }
    }
    return { id: cust.Id, name: cust.DisplayName };
  }

  // Create new
  const body: any = { DisplayName: customerName };
  if (details?.email) body.PrimaryEmailAddr = { Address: details.email };
  if (details?.shippingAddress) {
    const a = details.shippingAddress;
    const addr = {
      Line1: a.line1 || "", Line2: a.line2 || "", City: a.city || "",
      CountrySubDivisionCode: a.stateOrProvince || "",
      PostalCode: a.postalCode || "", Country: a.country || "",
    };
    body.ShipAddr = addr;
    body.BillAddr = addr;
  }
  const createResult = await qboRequest(accessToken, realmId, "/customer", {
    method: "POST", body: JSON.stringify(body),
  });
  const created = createResult?.Customer;
  if (!created?.Id) throw new Error(`Failed to create QBO customer: ${customerName}`);
  return { id: created.Id, name: created.DisplayName };
}

// ─── QBO Item lookup ────────────────────────────────────────

async function findQboItemBySku(
  accessToken: string, realmId: string, sku: string
): Promise<{ id: string; name: string } | null> {
  try {
    const escaped = sku.replace(/'/g, "\\'");
    const result = await qboRequest(
      accessToken, realmId,
      `/query?query=${encodeURIComponent(`SELECT * FROM Item WHERE Sku = '${escaped}'`)}`
    );
    const items = result?.QueryResponse?.Item;
    if (items?.length) return { id: items[0].Id, name: items[0].Name };
  } catch { /* not found */ }
  return null;
}

// ─── Tax resolution ─────────────────────────────────────────

async function resolveSalesTaxInfo(
  admin: any, qboAccessToken: string, realmId: string
): Promise<{ taxCodeId: string; taxRateId: string; ratePercent: number }> {
  // Try local tax_code + vat_rate tables first
  const { data: taxCodes } = await admin
    .from("tax_code")
    .select("qbo_tax_code_id, sales_tax_rate_id, vat_rate:sales_tax_rate_id(qbo_tax_rate_id, rate_percent)")
    .eq("active", true)
    .not("sales_tax_rate_id", "is", null);

  if (taxCodes?.length) {
    // Find the 20% standard rate
    const standard = taxCodes.find((tc: any) => tc.vat_rate?.rate_percent === 20);
    const pick = standard || taxCodes[0];
    if (pick?.vat_rate) {
      return {
        taxCodeId: pick.qbo_tax_code_id,
        taxRateId: pick.vat_rate.qbo_tax_rate_id,
        ratePercent: Number(pick.vat_rate.rate_percent),
      };
    }
  }

  // Fallback: query QBO directly
  console.log("No local tax info — querying QBO...");
  const result = await qboRequest(
    qboAccessToken, realmId,
    `/query?query=${encodeURIComponent("SELECT * FROM TaxCode WHERE Active = true MAXRESULTS 50")}`
  );
  const qboTaxCodes = result?.QueryResponse?.TaxCode;
  if (!qboTaxCodes?.length) throw new Error("No active TaxCodes found in QBO");

  const std = qboTaxCodes.find((tc: any) =>
    tc.Name?.includes("20") && tc.Name?.match(/S/i) && !tc.Name?.match(/Purchase|P\b/i)
  );
  const pick = std || qboTaxCodes[0];
  const salesRateId = pick.SalesTaxRateList?.TaxRateDetail?.[0]?.TaxRateRef?.value || "0";
  return { taxCodeId: pick.Id, taxRateId: String(salesRateId), ratePercent: 20 };
}

// ─── SKU helpers ────────────────────────────────────────────

function normaliseSkuCode(ebaySku: string): string {
  const trimmed = ebaySku.trim();
  const dotIdx = trimmed.indexOf(".");
  if (dotIdx > 0) {
    const mpn = trimmed.substring(0, dotIdx);
    const grade = trimmed.substring(dotIdx + 1) || "1";
    return `${mpn}-G${["1","2","3","4","5"].includes(grade) ? grade : "1"}`;
  }
  return trimmed;
}

// ─── Inventory push ─────────────────────────────────────────

async function updateInventoryQuantity(ebayToken: string, sku: string, quantity: number) {
  const existing = await ebayFetch(ebayToken, `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`);
  if (!existing) throw new Error(`Inventory item ${sku} not found on eBay`);
  const updated = {
    ...existing,
    availability: {
      ...(existing.availability || {}),
      shipToLocationAvailability: {
        ...(existing.availability?.shipToLocationAvailability || {}),
        quantity,
      },
    },
  };
  await ebayFetch(ebayToken, `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`, {
    method: "PUT",
    body: JSON.stringify(updated),
  });
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
    if (token !== serviceKey) {
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
          updated_at: new Date().toISOString(),
        })
        .eq("id", localOrder.id);

      if (updateErr) {
        console.error(`Failed to update local order: ${updateErr.message}`);
        throw new Error(`Failed to update sales_order: ${updateErr.message}`);
      }
      console.log(`Local order ${localOrder.id} updated to shipped`);

      // ── Update QBO SalesReceipt with shipping metadata ──
      let qboUpdated = false;
      try {
        const { accessToken: qboToken, realmId } = await getQboAccessToken(admin);

        // Find the existing SalesReceipt by DocNumber
        const docNumber = localOrder.doc_number || (orderId.length <= 21 ? orderId : orderId.substring(0, 21));
        const escaped = docNumber.replace(/'/g, "\\'");
        const queryResult = await qboRequest(
          qboToken, realmId,
          `/query?query=${encodeURIComponent(`SELECT * FROM SalesReceipt WHERE DocNumber = '${escaped}'`)}`
        );
        const existingReceipt = queryResult?.QueryResponse?.SalesReceipt?.[0];

        if (existingReceipt) {
          // Sparse update with shipping fields
          const sparseUpdate: any = {
            Id: existingReceipt.Id,
            SyncToken: existingReceipt.SyncToken,
            sparse: true,
          };

          if (shippedDate) {
            sparseUpdate.ShipDate = shippedDate;
          }
          if (shippingCarrier) {
            sparseUpdate.ShipMethodRef = { value: shippingCarrier, name: shippingCarrier };
          }
          if (trackingNumber) {
            sparseUpdate.TrackingNum = trackingNumber;
          }

          await qboRequest(qboToken, realmId, "/salesreceipt", {
            method: "POST",
            body: JSON.stringify(sparseUpdate),
          });
          qboUpdated = true;
          console.log(`QBO SalesReceipt ${existingReceipt.Id} updated with shipping data`);
        } else {
          console.warn(`No QBO SalesReceipt found with DocNumber "${docNumber}"`);
        }
      } catch (e: any) {
        console.error(`Failed to update QBO SalesReceipt: ${e.message}`);
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
          qbo_updated: qboUpdated,
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
    // ACTION: process_order (default — existing pipeline)
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
    const totalAmount = parseFloat(order.pricingSummary?.total?.value || "0");
    const taxAmount = parseFloat(order.pricingSummary?.tax?.value || "0");
    const currency = order.pricingSummary?.total?.currency || "GBP";
    const creationDate = order.creationDate?.split("T")[0] || new Date().toISOString().split("T")[0];
    const lineItems = order.lineItems || [];

    console.log(`eBay order ${orderId}: buyer=${buyerName}, total=${totalAmount}, lines=${lineItems.length}`);

    // ── Step 4: Get QBO connection ──
    const { accessToken: qboToken, realmId } = await getQboAccessToken(admin);

    // ── Step 5: Upsert QBO Customer ──
    const shippingAddr = shipTo?.contactAddress;
    const qboCustomer = await findOrCreateCustomer(qboToken, realmId, buyerName, {
      email: buyerEmail,
      shippingAddress: shippingAddr ? {
        line1: shippingAddr.addressLine1 || "",
        line2: shippingAddr.addressLine2 || "",
        city: shippingAddr.city || "",
        stateOrProvince: shippingAddr.stateOrProvince || "",
        postalCode: shippingAddr.postalCode || "",
        country: shippingAddr.countryCode || "GB",
      } : null,
    });
    console.log(`QBO Customer: ${qboCustomer.name} (ID: ${qboCustomer.id})`);

    // ── Step 6: Upsert local customer record ──
    const { data: localCustomer } = await admin
      .from("customer")
      .upsert({
        qbo_customer_id: qboCustomer.id,
        display_name: qboCustomer.name,
        email: buyerEmail,
        billing_line_1: shippingAddr?.addressLine1 || null,
        billing_city: shippingAddr?.city || null,
        billing_postcode: shippingAddr?.postalCode || null,
        billing_country: shippingAddr?.countryCode || "GB",
        synced_at: new Date().toISOString(),
      }, { onConflict: "qbo_customer_id" })
      .select("id")
      .single();

    // ── Step 7: Resolve tax info ──
    const taxInfo = await resolveSalesTaxInfo(admin, qboToken, realmId);
    const multiplier = 1 + taxInfo.ratePercent / 100;
    console.log(`Tax: code=${taxInfo.taxCodeId}, rate=${taxInfo.ratePercent}%`);

    // ── Step 8: Resolve SKUs + build QBO lines ──
    const { data: allSkus } = await admin.from("sku").select("id, sku_code, qbo_item_id").eq("active_flag", true);
    const skuMap = new Map<string, { id: string; sku_code: string; qbo_item_id: string | null }>();
    for (const s of allSkus || []) {
      skuMap.set(s.sku_code.toLowerCase(), s);
    }

    const qboLines: any[] = [];
    let totalNet = 0;
    let totalTax = 0;

    interface ProcessedLine {
      skuId: string;
      skuCode: string;
      qty: number;
      unitPrice: number;
      lineTotal: number;
      ebaySku: string;
    }
    const processedLines: ProcessedLine[] = [];

    for (const li of lineItems) {
      const ebaySku = li.sku || "";
      const localCode = normaliseSkuCode(ebaySku);
      const matchedSku = skuMap.get(localCode.toLowerCase()) || skuMap.get(ebaySku.toLowerCase());

      if (!matchedSku) {
        console.warn(`No SKU match for eBay SKU "${ebaySku}" in order ${orderId}`);
        continue;
      }

      const qty = li.quantity || 1;
      const grossLineTotal = parseFloat(li.lineItemCost?.value || "0");

      // TaxExcluded pattern: compute net from gross, tax is remainder
      const netLine = Math.round((grossLineTotal / multiplier) * 100) / 100;
      const lineTax = Math.round((grossLineTotal - netLine) * 100) / 100;
      const netUnit = Math.round((netLine / qty) * 100) / 100;

      totalNet += netLine;
      totalTax += lineTax;

      // Resolve QBO ItemRef
      let itemRef: any = null;
      if (matchedSku.qbo_item_id) {
        itemRef = { value: matchedSku.qbo_item_id };
      } else {
        // Query QBO by SKU (dot notation: MPN.Grade)
        const dotSku = ebaySku || matchedSku.sku_code.replace("-G", ".");
        const qboItem = await findQboItemBySku(qboToken, realmId, dotSku);
        if (qboItem) itemRef = { value: qboItem.id, name: qboItem.name };
      }

      qboLines.push({
        DetailType: "SalesItemLineDetail",
        Amount: netLine,
        Description: li.title || matchedSku.sku_code,
        SalesItemLineDetail: {
          Qty: qty,
          UnitPrice: netUnit,
          TaxCodeRef: { value: taxInfo.taxCodeId },
          ...(itemRef ? { ItemRef: itemRef } : {}),
        },
      });

      processedLines.push({
        skuId: matchedSku.id,
        skuCode: matchedSku.sku_code,
        qty,
        unitPrice: grossLineTotal / qty,
        lineTotal: grossLineTotal,
        ebaySku,
      });
    }

    totalNet = Math.round(totalNet * 100) / 100;
    totalTax = Math.round(totalTax * 100) / 100;

    if (!qboLines.length) {
      // Fallback line so the SalesReceipt isn't empty
      qboLines.push({
        DetailType: "SalesItemLineDetail",
        Amount: Math.round((totalAmount / multiplier) * 100) / 100,
        Description: `eBay order ${orderId}`,
        SalesItemLineDetail: { Qty: 1, UnitPrice: Math.round((totalAmount / multiplier) * 100) / 100, TaxCodeRef: { value: taxInfo.taxCodeId } },
      });
      totalNet = Math.round((totalAmount / multiplier) * 100) / 100;
      totalTax = Math.round((totalAmount - totalNet) * 100) / 100;
    }

    // ── Step 9: Create QBO SalesReceipt (TaxExcluded) ──
    console.log(`Creating QBO SalesReceipt: net=${totalNet}, tax=${totalTax}, gross=${totalAmount}`);

    const receiptBody: any = {
      CustomerRef: { value: qboCustomer.id },
      TxnDate: creationDate,
      CurrencyRef: { value: currency },
      GlobalTaxCalculation: "TaxExcluded",
      DocNumber: orderId.length <= 21 ? orderId : orderId.substring(0, 21),
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

    // Check if SalesReceipt already exists in QBO (by DocNumber)
    let existingReceiptId: string | null = null;
    try {
      const docNum = receiptBody.DocNumber;
      const escaped = docNum.replace(/'/g, "\\'");
      const result = await qboRequest(
        qboToken, realmId,
        `/query?query=${encodeURIComponent(`SELECT Id FROM SalesReceipt WHERE DocNumber = '${escaped}'`)}`
      );
      existingReceiptId = result?.QueryResponse?.SalesReceipt?.[0]?.Id || null;
    } catch { /* not found */ }

    if (existingReceiptId) {
      console.log(`SalesReceipt already exists in QBO (ID: ${existingReceiptId}), skipping creation`);
    } else {
      const result = await qboRequest(qboToken, realmId, "/salesreceipt", {
        method: "POST", body: JSON.stringify(receiptBody),
      });
      const receipt = result?.SalesReceipt;
      if (!receipt?.Id) throw new Error("Failed to create QBO SalesReceipt");
      console.log(`QBO SalesReceipt created: ID=${receipt.Id}, Total=${receipt.TotalAmt}`);
    }

    // ── Step 9: Insert local sales_order ──
    const merchandiseSubtotal = totalAmount - taxAmount;
    const { data: newOrder, error: orderErr } = await admin
      .from("sales_order")
      .insert({
        origin_channel: "ebay",
        origin_reference: orderId,
        doc_number: orderId.length <= 21 ? orderId : orderId.substring(0, 21),
        status: "paid",
        customer_id: localCustomer?.id || null,
        guest_name: buyerName,
        guest_email: buyerEmail || `ebay-${orderId}@imported.local`,
        shipping_name: shipTo?.fullName || buyerName,
        shipping_line_1: shippingAddr?.addressLine1 || "",
        shipping_line_2: shippingAddr?.addressLine2 || null,
        shipping_city: shippingAddr?.city || "",
        shipping_postcode: shippingAddr?.postalCode || "",
        shipping_country: shippingAddr?.countryCode || "GB",
        shipping_county: shippingAddr?.stateOrProvince || null,
        merchandise_subtotal: merchandiseSubtotal,
        tax_total: taxAmount,
        gross_total: totalAmount,
        global_tax_calculation: "TaxExcluded",
        currency,
        txn_date: creationDate,
        notes: `eBay order ${orderId} | Buyer: ${order.buyer?.username || "unknown"}`,
      })
      .select("id")
      .single();

    if (orderErr) throw new Error(`Failed to insert sales_order: ${orderErr.message}`);
    console.log(`Local sales_order created: ${newOrder.id}`);

    // ── Step 10: Insert sales_order_lines ──
    const affectedSkuIds = new Set<string>();

    for (const pl of processedLines) {
      affectedSkuIds.add(pl.skuId);

      await admin.from("sales_order_line").insert({
        sales_order_id: newOrder.id,
        sku_id: pl.skuId,
        quantity: pl.qty,
        unit_price: pl.unitPrice,
        line_total: pl.lineTotal,
      });
    }

    // ── Step 11: FIFO stock depletion ──
    let unitsDepletedTotal = 0;
    for (const pl of processedLines) {
      const { data: availableUnits } = await admin
        .from("stock_unit")
        .select("id")
        .eq("sku_id", pl.skuId)
        .eq("status", "available")
        .order("created_at", { ascending: true })
        .limit(pl.qty);

      if (availableUnits?.length) {
        const unitIds = availableUnits.map((u: any) => u.id);
        const { error: depleteErr } = await admin
          .from("stock_unit")
          .update({ status: "closed", updated_at: new Date().toISOString() })
          .in("id", unitIds);

        if (depleteErr) {
          console.error(`Failed to deplete stock for SKU ${pl.skuCode}:`, depleteErr.message);
        } else {
          unitsDepletedTotal += unitIds.length;
          console.log(`FIFO depleted ${unitIds.length}/${pl.qty} units for ${pl.skuCode}`);
        }

        if (availableUnits.length < pl.qty) {
          console.warn(`Insufficient stock for ${pl.skuCode}: wanted ${pl.qty}, had ${availableUnits.length}`);
        }
      } else {
        console.warn(`No available stock for ${pl.skuCode}`);
      }
    }

    // ── Step 12: Push updated stock counts to channels ──
    let stockPushed = 0;

    if (affectedSkuIds.size > 0) {
      const skuIdArray = [...affectedSkuIds];

      // Get updated available counts
      const stockCounts = new Map<string, number>();
      for (const skuId of skuIdArray) {
        const { count } = await admin
          .from("stock_unit")
          .select("id", { count: "exact", head: true })
          .eq("sku_id", skuId)
          .eq("status", "available");
        stockCounts.set(skuId, count || 0);
      }

      // Find channel listings for affected SKUs
      const { data: listings } = await admin
        .from("channel_listing")
        .select("id, external_sku, sku_id, channel")
        .in("sku_id", skuIdArray)
        .not("sku_id", "is", null);

      for (const listing of listings || []) {
        const qty = stockCounts.get(listing.sku_id) || 0;

        if (listing.channel === "ebay") {
          try {
            await updateInventoryQuantity(ebayToken, listing.external_sku, qty);
            await admin.from("channel_listing").update({
              listed_quantity: qty,
              synced_at: new Date().toISOString(),
            }).eq("id", listing.id);
            stockPushed++;
            console.log(`Pushed stock ${listing.external_sku} → ${qty} on eBay`);
          } catch (e: any) {
            console.error(`Failed to push stock for ${listing.external_sku}:`, e.message);
          }
        }
        // Future: handle other channels here
      }
    }

    // ── Step 13: Audit event ──
    await admin.from("audit_event").insert({
      entity_type: "sales_order",
      entity_id: newOrder.id,
      trigger_type: "ebay_notification",
      actor_type: "system",
      source_system: "ebay-process-order",
      after_json: {
        order_id: orderId,
        qbo_customer_id: qboCustomer.id,
        lines: processedLines.length,
        units_depleted: unitsDepletedTotal,
        stock_pushed: stockPushed,
      },
    });

    console.log(`Pipeline complete for ${orderId}: ${processedLines.length} lines, ${unitsDepletedTotal} units depleted, ${stockPushed} stock pushes`);

    return new Response(
      JSON.stringify({
        success: true,
        order_id: orderId,
        sales_order_id: newOrder.id,
        qbo_customer_id: qboCustomer.id,
        lines_processed: processedLines.length,
        units_depleted: unitsDepletedTotal,
        stock_pushed: stockPushed,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    console.error("ebay-process-order error:", e);
    return new Response(
      JSON.stringify({ error: e.message || "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
