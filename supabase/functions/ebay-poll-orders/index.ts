// Redeployed: 2026-03-23
// ============================================================
// eBay Poll Orders
// Polls eBay Fulfillment API for new orders since last poll.
// For each new order:
//   1. Lands raw payload in staging (landing_raw_ebay_order)
//   2. Creates local sales_order + sales_order_line records
//   3. Maps eBay SKUs to local SKUs and allocates stock via the costing subledger
//   4. Queues QBO posting intents (fire-and-forget)
// Also detects tracking info on existing orders.
//
// Can be called manually or registered as pg_cron (every 15 min).
// ============================================================

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const EBAY_API = "https://api.ebay.com";
const FETCH_TIMEOUT_MS = 30_000;

function fetchWithTimeout(url: string | URL, options: RequestInit = {}, timeoutMs = FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed.length > 0 ? trimmed : null;
}

function isEbayRelayEmail(value: unknown): boolean {
  return typeof value === "string" && /@members\.ebay\./i.test(value);
}

/**
 * Normalise an eBay SKU to the canonical MPN.
 * - Strip dot-grade suffix:  75418-1.1  → 75418-1
 * - Strip legacy -G suffix:  31172-1-G1 → 31172-1
 * - Leave bare MPNs alone:   76273-1    → 76273-1
 */
function deriveMpn(sku: string): string {
  return sku.replace(/-G\d+$/i, "").replace(/\.\d+$/, "");
}

/**
 * Extract grade from eBay SKU if present.
 * - 75418-1.2 → 2
 * - 31172-1-G1 → 1
 * - 76273-1 → null
 */
function extractGrade(sku: string): number | null {
  const dotMatch = sku.match(/\.(\d)$/);
  if (dotMatch) return parseInt(dotMatch[1], 10);
  const gMatch = sku.match(/-G(\d)$/i);
  if (gMatch) return parseInt(gMatch[1], 10);
  return null;
}

// ─── eBay OAuth Token Management ─────────────────────────────

async function getEbayAccessToken(admin: any): Promise<string> {
  const { data: conn, error } = await admin
    .from("ebay_connection")
    .select("*")
    .limit(1)
    .maybeSingle();

  if (error || !conn) throw new Error("eBay not connected.");

  const c = conn as Record<string, unknown>;
  if (new Date(c.token_expires_at as string).getTime() > Date.now() + 60_000) {
    return c.access_token as string;
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
      refresh_token: c.refresh_token as string,
      scope: [
        "https://api.ebay.com/oauth/api_scope",
        "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
        "https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly",
      ].join(" "),
    }),
  });

  if (!res.ok) throw new Error(`eBay token refresh failed [${res.status}]`);
  const data = await res.json();
  const newExpiresAt = new Date(Date.now() + (data.expires_in || 7200) * 1000).toISOString();

  await admin
    .from("ebay_connection")
    .update({
      access_token: data.access_token,
      ...(data.refresh_token ? { refresh_token: data.refresh_token } : {}),
      token_expires_at: newExpiresAt,
    } as never)
    .eq("id", c.id as string);

  return data.access_token;
}

// ─── eBay API Helper ─────────────────────────────────────────

async function ebayFetch(token: string, path: string) {
  const url = path.startsWith("http") ? path : `${EBAY_API}${path}`;
  const res = await fetchWithTimeout(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Accept-Language": "en-GB",
      "X-EBAY-C-MARKETPLACE-ID": "EBAY_GB",
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

// ─── Order Number Generator ──────────────────────────────────

async function nextOrderNumber(admin: any): Promise<string> {
  const { data } = await admin
    .from("sales_order")
    .select("order_number")
    .like("order_number", "KO-%")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const last = data ? parseInt((data as Record<string, unknown>).order_number as string).toString().replace("KO-", "") : "0";
  const num = parseInt(last.replace("KO-", ""), 10) || 0;
  return `KO-${String(num + 1).padStart(4, "0")}`;
}

// ═════════════════════════════════════════════════════════════
// MAIN HANDLER
// ═════════════════════════════════════════════════════════════

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRoleKey);

    // Auth: accept service role (cron) or authenticated admin
    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.replace("Bearer ", "") || "";
    if (token !== serviceRoleKey) {
      const { data: { user }, error: userError } = await admin.auth.getUser(token);
      if (userError || !user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const body = await req.json().catch(() => ({}));
    const daysBack = (body as Record<string, unknown>).daysBack as number ?? 7;

    const accessToken = await getEbayAccessToken(admin);

    // ─── Fetch orders from eBay Fulfillment API ────────────
    const fromDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();
    const allOrders: Record<string, unknown>[] = [];
    let offset = 0;
    const limit = 50;

    while (true) {
      const data = await ebayFetch(
        accessToken,
        `/sell/fulfillment/v1/order?filter=creationdate:[${fromDate}..${new Date().toISOString()}]&limit=${limit}&offset=${offset}`,
      );
      const batch = (data?.orders ?? []) as Record<string, unknown>[];
      allOrders.push(...batch);
      if (batch.length < limit || allOrders.length >= (data?.total ?? 0)) break;
      offset += limit;
    }

    console.log(`eBay poll: fetched ${allOrders.length} orders from last ${daysBack} days`);

    let imported = 0;
    let skipped = 0;
    let trackingUpdated = 0;

    for (const ebayOrder of allOrders) {
      const ebayOrderId = ebayOrder.orderId as string;
      if (!ebayOrderId) continue;

      // ─── Check for existing order ──────────────────────
      const { data: existing } = await admin
        .from("sales_order")
        .select("id, v2_status, tracking_number")
        .eq("origin_reference" as never, ebayOrderId)
        .maybeSingle();

      if (existing) {
        const existingRow = existing as Record<string, unknown>;

        // Check for tracking updates on existing orders without tracking
        if (!existingRow.tracking_number) {
          const tracking = extractTracking(ebayOrder);
          if (tracking) {
            await admin
              .from("sales_order")
              .update({
                tracking_number: tracking.trackingNumber,
                shipped_via: tracking.carrier,
                v2_status: "shipped",
                shipped_date: new Date().toISOString().slice(0, 10),
              } as never)
              .eq("id", existingRow.id as string);

            await admin
              .from("stock_unit")
              .update({
                v2_status: "shipped",
                shipped_at: new Date().toISOString(),
              } as never)
              .eq("order_id" as never, existingRow.id as string)
              .eq("v2_status" as never, "sold");

            trackingUpdated++;
          }
        }

        // Check eBay order status for delivery confirmation
        const ebayStatus = (ebayOrder.orderFulfillmentStatus as string) ?? "";
        const currentV2Status = existingRow.v2_status as string;

        if (ebayStatus === "FULFILLED" && currentV2Status === "shipped") {
          await admin
            .from("sales_order")
            .update({
              v2_status: "delivered",
              delivered_at: new Date().toISOString(),
            } as never)
            .eq("id", existingRow.id as string);

          await admin
            .from("stock_unit")
            .update({
              v2_status: "delivered",
              delivered_at: new Date().toISOString(),
            } as never)
            .eq("order_id" as never, existingRow.id as string)
            .eq("v2_status" as never, "shipped");

          trackingUpdated++;
        }

        skipped++;
        continue;
      }

      // ─── Land raw payload ──────────────────────────────
      const correlationId = crypto.randomUUID();
      await admin
        .from("landing_raw_ebay_order")
        .upsert({
          external_id: ebayOrderId,
          raw_payload: ebayOrder,
          status: "pending",
          correlation_id: correlationId,
          received_at: new Date().toISOString(),
        } as never, { onConflict: "external_id" as never })
        .select("id")
        .single();

      // ─── Extract order data ────────────────────────────
      const lineItems = (ebayOrder.lineItems ?? []) as Record<string, unknown>[];
      const buyer = (ebayOrder.buyer ?? {}) as Record<string, unknown>;
      const priceSummary = (ebayOrder.pricingSummary ?? {}) as Record<string, unknown>;
      const totalAmount = priceSummary.total as Record<string, unknown> | undefined;
      const grossTotal = parseFloat((totalAmount?.value as string) ?? "0");

      // Extract shipping address for customer
      const fulfillment = ((ebayOrder.fulfillmentStartInstructions ?? []) as Record<string, unknown>[])[0];
      const shippingStep = (fulfillment?.shippingStep ?? {}) as Record<string, unknown>;
      const shipTo = (shippingStep?.shipTo ?? {}) as Record<string, unknown>;
      const contactAddress = (shipTo?.contactAddress ?? {}) as Record<string, unknown>;

      // Buyer info
      const buyerUsername = cleanText(buyer.username) ?? "eBay Buyer";
      const buyerEmail = cleanText(shipTo?.email) ?? null;
      const shippingName = cleanText(shipTo?.fullName) ?? buyerUsername;
      const customerDisplayName = shippingName !== "eBay Buyer" ? shippingName : buyerUsername;
      const addressLine1 = cleanText(contactAddress.addressLine1);
      const addressLine2 = cleanText(contactAddress.addressLine2);
      const addressCity = cleanText(contactAddress.city);
      const addressCounty = cleanText(contactAddress.stateOrProvince);
      const addressPostcode = cleanText(contactAddress.postalCode);
      const addressCountry = cleanText(contactAddress.countryCode) ?? "GB";

      // ─── Upsert customer ───────────────────────────────
      let customerId: string | null = null;
      let { data: existingCustomer } = await admin
        .from("customer")
        .select("id, display_name, email, channel_ids, billing_line_1, billing_line_2, billing_city, billing_county, billing_postcode, billing_country")
        .eq("channel_ids->>ebay", buyerUsername)
        .maybeSingle();

      if (!existingCustomer) {
        const { data: byDisplayName } = await admin
          .from("customer")
          .select("id, display_name, email, channel_ids, billing_line_1, billing_line_2, billing_city, billing_county, billing_postcode, billing_country")
          .eq("display_name", buyerUsername)
          .maybeSingle();
        existingCustomer = byDisplayName;
      }

      if (existingCustomer) {
        customerId = (existingCustomer as Record<string, unknown>).id as string;
        const existing = existingCustomer as Record<string, unknown>;
        const existingChannels = (existing.channel_ids ?? {}) as Record<string, unknown>;
        await admin
          .from("customer")
          .update({
            display_name: isEbayRelayEmail(existing.display_name) ? customerDisplayName : (cleanText(existing.display_name) ?? customerDisplayName),
            email: cleanText(existing.email) ?? buyerEmail,
            channel_ids: { ...existingChannels, ebay: buyerUsername },
            billing_line_1: addressLine1 ?? existing.billing_line_1 ?? null,
            billing_line_2: addressLine2 ?? existing.billing_line_2 ?? null,
            billing_city: addressCity ?? existing.billing_city ?? null,
            billing_county: addressCounty ?? existing.billing_county ?? null,
            billing_postcode: addressPostcode ?? existing.billing_postcode ?? null,
            billing_country: addressCountry ?? existing.billing_country ?? "GB",
            active: true,
          } as never)
          .eq("id", customerId);
      } else {
        const { data: newCustomer, error: custErr } = await admin
          .from("customer")
          .insert({
            display_name: customerDisplayName,
            email: buyerEmail,
            channel_ids: { ebay: buyerUsername },
            billing_line_1: addressLine1,
            billing_line_2: addressLine2,
            billing_city: addressCity,
            billing_county: addressCounty,
            billing_postcode: addressPostcode,
            billing_country: addressCountry,
          } as never)
          .select("id")
          .single();

        if (custErr) {
          console.error(`Customer insert FAILED for "${buyerUsername}": ${custErr.message} (code: ${custErr.code})`);
        } else if (newCustomer) {
          customerId = (newCustomer as Record<string, unknown>).id as string;
        }
      }
      if (!customerId) {
        console.warn(`eBay order ${ebayOrderId} will have no customer link (buyer: ${buyerUsername})`);
      }

      // ─── Create sales order ────────────────────────────
      const orderNumber = await nextOrderNumber(admin);
      const tracking = extractTracking(ebayOrder);

      // VAT: eBay doesn't provide breakdown — calculate per spec
      const vatAmount = Math.round((grossTotal - grossTotal / 1.2) * 100) / 100;
      const netAmount = Math.round((grossTotal / 1.2) * 100) / 100;

      const { data: newOrder, error: orderErr } = await admin
        .from("sales_order")
        .insert({
          order_number: orderNumber,
          customer_id: customerId,
          origin_channel: "ebay",
          origin_reference: ebayOrderId,
          guest_name: shippingName,
          guest_email: buyerEmail,
          shipping_name: shippingName,
          shipping_line_1: addressLine1 ?? "",
          shipping_line_2: addressLine2,
          shipping_city: addressCity ?? "",
          shipping_county: addressCounty,
          shipping_postcode: addressPostcode ?? "",
          shipping_country: addressCountry,
          notes: `eBay buyer: ${buyerUsername} | Order: ${ebayOrderId}`,
          v2_status: "new",
          gross_total: grossTotal,
          tax_total: vatAmount,
          net_amount: netAmount,
          payment_method: "ebay_managed",
          qbo_sync_status: "pending",
          ...(tracking ? {
            tracking_number: tracking.trackingNumber,
            shipped_via: tracking.carrier,
          } : {}),
        } as never)
        .select("id")
        .single();

      if (orderErr) {
        console.error(`Failed to create order for eBay ${ebayOrderId}:`, orderErr);
        await admin
          .from("landing_raw_ebay_order")
          .update({ status: "error", error_message: orderErr.message } as never)
          .eq("external_id", ebayOrderId);
        continue;
      }

      const localOrderId = (newOrder as Record<string, unknown>).id as string;

      // ─── Create line items + allocate stock through the costing subledger ────────
      for (const li of lineItems) {
        const ebaySku = (li.sku as string) ?? "";
        const quantity = (li.quantity as number) ?? 1;
        const lineItemTotal = ((li.total as Record<string, unknown>)?.value as string) ?? "0";
        const unitPrice = Math.round(parseFloat(lineItemTotal) / quantity * 100) / 100;

        const mpn = ebaySku ? deriveMpn(ebaySku) : null;
        const grade = ebaySku ? extractGrade(ebaySku) : null;
        const localSkuCode = mpn && grade ? `${mpn}.${grade}` : null;

        // Find local SKU
        let localSkuId: string | null = null;
        if (localSkuCode) {
          const { data: skuRow } = await admin
            .from("sku")
            .select("id")
            .eq("sku_code", localSkuCode)
            .maybeSingle();
          localSkuId = skuRow ? (skuRow as Record<string, unknown>).id as string : null;
        }

        for (let i = 0; i < quantity; i++) {
          const { data: insertedLine, error: lineErr } = await admin
            .from("sales_order_line")
            .insert({
              sales_order_id: localOrderId,
              sku_id: localSkuId,
              unit_price: unitPrice,
              quantity: 1,
            } as never)
            .select("id")
            .single();

          if (lineErr) {
            console.warn(`Failed to create eBay order line for ${localSkuCode ?? ebaySku}: ${lineErr.message}`);
            continue;
          }

          if (localSkuId && insertedLine) {
            const lineId = (insertedLine as Record<string, unknown>).id as string;
            const { error: allocationErr } = await admin
              .rpc("allocate_stock_for_order_line", { p_sales_order_line_id: lineId });

            if (allocationErr) {
              console.warn(`Allocation failed for eBay line ${lineId} (${localSkuCode}): ${allocationErr.message}`);
            }
          }
        }
      }

      await admin
        .rpc("refresh_order_line_economics", { p_sales_order_id: localOrderId });

      // ─── Update landing status ─────────────────────────
      await admin
        .from("landing_raw_ebay_order")
        .update({ status: "committed", processed_at: new Date().toISOString() } as never)
        .eq("external_id", ebayOrderId);

      const { error: postingIntentErr } = await admin
        .rpc("queue_qbo_posting_intents_for_order", { p_sales_order_id: localOrderId });

      if (postingIntentErr) {
        console.warn(`Failed to queue QBO posting intent for eBay order ${localOrderId}: ${postingIntentErr.message}`);
      } else {
        fetch(`${supabaseUrl}/functions/v1/accounting-posting-intents-process`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${serviceRoleKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ batchSize: 10 }),
        }).catch(() => {});
      }

      imported++;
    }

    console.log(`eBay poll complete: ${imported} imported, ${skipped} skipped, ${trackingUpdated} tracking updates`);

    return new Response(
      JSON.stringify({
        success: true,
        imported,
        skipped,
        trackingUpdated,
        totalFetched: allOrders.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("ebay-poll-orders error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

// ─── Extract tracking from eBay order ────────────────────────

function extractTracking(order: Record<string, unknown>): { trackingNumber: string; carrier: string } | null {
  const fulfillments = (order.fulfillmentStartInstructions ?? []) as Record<string, unknown>[];
  for (const f of fulfillments) {
    const shippingStep = (f.shippingStep ?? {}) as Record<string, unknown>;
    const shipmentTracking = (shippingStep.shipmentTracking ?? {}) as Record<string, unknown>;
    const trackingDetails = (shipmentTracking.trackingDetails ?? []) as Record<string, unknown>[];

    for (const td of trackingDetails) {
      const trackingNumber = td.trackingNumber as string;
      const carrier = (td.shippingCarrierCode as string) ?? "Unknown";
      if (trackingNumber) {
        return { trackingNumber, carrier };
      }
    }
  }

  // Also check fulfillmentHrefs for already-fulfilled orders
  const fulfillmentHrefs = (order.fulfillmentHrefs ?? []) as string[];
  if (fulfillmentHrefs.length > 0) {
    // Tracking was already submitted — but we can't extract it from the href alone
    // The caller should check the Fulfillment API for details
    return null;
  }

  return null;
}
