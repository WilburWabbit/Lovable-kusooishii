// Redeployed: 2026-03-23
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";
import { pushEbayQuantityForSkus } from "../_shared/ebay-inventory-sync.ts";

const stripeLive = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
  apiVersion: "2023-10-16",
  httpClient: Stripe.createFetchHttpClient(),
});
const stripeSandbox = new Stripe(Deno.env.get("STRIPE_SANDBOX_SECRET_KEY") || "", {
  apiVersion: "2023-10-16",
  httpClient: Stripe.createFetchHttpClient(),
});

const liveWebhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET") || "";
const sandboxWebhookSecret = Deno.env.get("STRIPE_SANDBOX_WEBHOOK_SECRET") || "";

if (!liveWebhookSecret) console.warn("STRIPE_WEBHOOK_SECRET is not set — live webhook verification will fail");
if (!sandboxWebhookSecret) console.warn("STRIPE_SANDBOX_WEBHOOK_SECRET is not set — sandbox webhook verification will fail");

const supabase = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
);

// ─── VAT destination classification ──────────────────────────

const EU_COUNTRY_CODES = new Set([
  "AT","BE","BG","HR","CY","CZ","DK","EE","FI","FR","DE","GR","HU",
  "IE","IT","LV","LT","LU","MT","NL","PL","PT","RO","SK","SI","ES","SE",
]);
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
  ratePercent: number;
}

/**
 * Resolve VAT tax code from shipping country using local tax_code + vat_rate tables.
 * Same three-way classification as ebay-process-order:
 *   UK (GB, IM)     → 20.0% S
 *   EU (27 members) → ECG 0%
 *   Rest of World   → 0.0% Z
 */
async function resolveVatForShippingCountry(
  admin: any, shippingCountry: string,
): Promise<VatResolution> {
  const destination = classifyShippingCountry(shippingCountry);

  const { data: taxCodes, error: tcErr } = await admin
    .from("tax_code")
    .select("id, qbo_tax_code_id, name, sales_tax_rate_id, vat_rate:sales_tax_rate_id(id, qbo_tax_rate_id, rate_percent)")
    .eq("active", true)
    .not("sales_tax_rate_id", "is", null);

  if (tcErr) throw new Error(`Failed to query tax_code table: ${tcErr.message}`);
  if (!taxCodes?.length) {
    throw new Error("No active tax codes with linked VAT rates found. Run qbo-sync-tax-rates first.");
  }

  let match: any = null;
  switch (destination) {
    case "uk":
      match = taxCodes.find((tc: any) => Number(tc.vat_rate?.rate_percent) === 20);
      break;
    case "eu":
      match = taxCodes.find((tc: any) => /^ECG/i.test(tc.name || ""));
      break;
    case "row":
      match = taxCodes.find((tc: any) => Number(tc.vat_rate?.rate_percent) === 0 && !/^ECG/i.test(tc.name || ""));
      break;
  }

  if (!match?.vat_rate) {
    const available = taxCodes.map((tc: any) => `"${tc.name}" (${tc.vat_rate?.rate_percent ?? "?"}%)`).join(", ");
    throw new Error(
      `No matching tax code for ${destination.toUpperCase()} (${shippingCountry}). Available: [${available}]`
    );
  }

  return {
    destination,
    taxCodeId: match.id,
    vatRateId: match.vat_rate.id,
    qboTaxCodeId: match.qbo_tax_code_id,
    ratePercent: Number(match.vat_rate.rate_percent),
  };
}

// ─── Main handler ────────────────────────────────────────────

serve(async (req) => {
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return new Response("No signature", { status: 400 });
  }

  const body = await req.text();

  // Try verifying with live secret first, then sandbox secret.
  // This determines whether the event came from Stripe live or test mode.
  let event: Stripe.Event;
  let isTestEvent = false;
  let stripe: Stripe;

  try {
    event = await stripeLive.webhooks.constructEventAsync(body, signature, liveWebhookSecret);
    stripe = stripeLive;
  } catch {
    // Live verification failed — try sandbox secret
    if (!sandboxWebhookSecret) {
      console.error("Webhook signature verification failed and no sandbox secret configured");
      return new Response("Webhook signature verification failed", { status: 400 });
    }
    try {
      event = await stripeSandbox.webhooks.constructEventAsync(body, signature, sandboxWebhookSecret);
      stripe = stripeSandbox;
      isTestEvent = true;
      console.log("Stripe event verified with sandbox secret (test mode)");
    } catch (err) {
      console.error("Webhook signature verification failed for both live and sandbox:", (err as Error).message);
      return new Response(`Webhook Error: ${(err as Error).message}`, { status: 400 });
    }
  }

  // ── Idempotency: check landing status BEFORE upserting ──
  const landingCorrelation = crypto.randomUUID();
  {
    const { data: existingLanding } = await supabase
      .from("landing_raw_stripe_event")
      .select("status")
      .eq("external_id", event.id)
      .maybeSingle();

    if (existingLanding?.status === "committed") {
      console.log(`Stripe event ${event.id} already committed, skipping`);
      return new Response(JSON.stringify({ received: true, skipped: true }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    }
  }

  // ── Land raw Stripe event (only if not already committed) ──
  try {
    await supabase
      .from("landing_raw_stripe_event")
      .upsert(
        {
          external_id: event.id,
          event_type: event.type,
          raw_payload: event as unknown as Record<string, unknown>,
          status: "pending",
          correlation_id: landingCorrelation,
          received_at: new Date().toISOString(),
          is_test: isTestEvent,
        },
        { onConflict: "external_id" }
      );
  } catch (landErr) {
    console.error("Failed to land Stripe event:", landErr);
  }

  // ── Process event ──
  let processingError: Error | null = null;

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;

    // Guard against duplicate order creation: check if origin_reference already exists
    const { data: existingOrder } = await supabase
      .from("sales_order")
      .select("id")
      .eq("origin_channel", "web")
      .eq("origin_reference", session.id)
      .maybeSingle();

    if (existingOrder) {
      console.log(`Order for Stripe session ${session.id} already exists (${existingOrder.id}), skipping`);
    } else {
      try {
        await handleCheckoutCompleted(session, stripe, isTestEvent);
      } catch (err) {
        processingError = err as Error;
      }
    }
  } else if (event.type === "payment_intent.succeeded") {
    const paymentIntent = event.data.object as Stripe.PaymentIntent;

    const { data: existingOrder } = await supabase
      .from("sales_order")
      .select("id")
      .eq("payment_reference", paymentIntent.id)
      .maybeSingle();

    if (existingOrder) {
      console.log(`Order for Stripe payment intent ${paymentIntent.id} already exists (${existingOrder.id}), skipping`);
    } else {
      try {
        await handleInPersonPaymentIntent(paymentIntent, stripe, isTestEvent);
      } catch (err) {
        processingError = err as Error;
      }
    }
  } else if (event.type === "payout.paid") {
    try {
      await handlePayoutPaid(event.data.object as Record<string, unknown>, isTestEvent);
    } catch (err) {
      processingError = err as Error;
    }
  }

  // ── Update landing status based on processing outcome ──
  try {
    if (processingError) {
      console.error("Order creation failed, marking landing as error:", processingError.message);
      await supabase
        .from("landing_raw_stripe_event")
        .update({
          status: "error",
          error_message: (processingError.message || "Unknown error").substring(0, 1000),
          processed_at: new Date().toISOString(),
        })
        .eq("external_id", event.id);

      // Return 500 so Stripe will retry this webhook delivery
      return new Response(
        JSON.stringify({ error: processingError.message }),
        { headers: { "Content-Type": "application/json" }, status: 500 }
      );
    } else {
      await supabase
        .from("landing_raw_stripe_event")
        .update({ status: "committed", processed_at: new Date().toISOString() })
        .eq("external_id", event.id);
    }
  } catch (updateErr) {
    console.error("Failed to update landing status:", updateErr);
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });
});

async function paymentIntentBelongsToCheckout(
  paymentIntentId: string,
  stripe: Stripe,
): Promise<boolean> {
  try {
    const sessions = await stripe.checkout.sessions.list({
      limit: 1,
      payment_intent: paymentIntentId,
    } as never);
    return sessions.data.length > 0;
  } catch (err) {
    console.warn(`Failed to look up Checkout Session for payment_intent ${paymentIntentId}:`, err);
    return false;
  }
}

async function handleInPersonPaymentIntent(
  paymentIntent: Stripe.PaymentIntent,
  stripe: Stripe,
  isTestEvent: boolean,
) {
  try {
    if ((paymentIntent.amount_received ?? 0) <= 0) {
      console.log(`Skipping Stripe payment_intent ${paymentIntent.id} with no captured amount`);
      return;
    }

    if (paymentIntent.invoice) {
      console.log(`Skipping Stripe payment_intent ${paymentIntent.id} linked to invoice ${paymentIntent.invoice}`);
      return;
    }

    if (paymentIntent.metadata?.origin_channel === "web") {
      console.log(`Skipping Stripe payment_intent ${paymentIntent.id} tagged as web checkout`);
      return;
    }

    const isCheckoutIntent = await paymentIntentBelongsToCheckout(paymentIntent.id, stripe);
    if (isCheckoutIntent) {
      console.log(`Skipping Stripe payment_intent ${paymentIntent.id} because it belongs to Checkout`);
      return;
    }

    const latestChargeId = typeof paymentIntent.latest_charge === "string"
      ? paymentIntent.latest_charge
      : paymentIntent.latest_charge?.id ?? null;
    const charge = latestChargeId
      ? await stripe.charges.retrieve(latestChargeId)
      : null;

    const fallbackAddress = paymentIntent.shipping?.address ?? null;
    const billingAddress = charge?.billing_details?.address ?? fallbackAddress;
    const billingName = charge?.billing_details?.name?.trim()
      || paymentIntent.shipping?.name?.trim()
      || "Market Sale";
    const billingEmail = charge?.billing_details?.email?.trim() || null;
    const shippingCountry = (billingAddress?.country || "GB").toUpperCase();
    const grossTotal = (paymentIntent.amount_received ?? paymentIntent.amount ?? 0) / 100;
    const taxTotal = Math.round((grossTotal - grossTotal / 1.2) * 100) / 100;
    const netAmount = Math.round((grossTotal - taxTotal) * 100) / 100;
    const txnDate = paymentIntent.created
      ? new Date(paymentIntent.created * 1000).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10);
    const guestEmail = billingEmail || `stripe-pos-${paymentIntent.id}@internal.local`;
    const chargeId = charge?.id ?? null;
    const rawPaymentMethod = charge?.payment_method_details?.type ?? paymentIntent.payment_method_types?.[0] ?? "card";
    const paymentMethod = rawPaymentMethod === "card_present" || rawPaymentMethod === "card"
      ? "card"
      : rawPaymentMethod;

    let customerId: string | null = null;
    const stripeCustomerId = typeof paymentIntent.customer === "string" ? paymentIntent.customer : paymentIntent.customer?.id ?? null;
    let stripeCustomer: Stripe.Customer | null = null;

    // Default fallback for in-person POS sales: use the canonical "Cash Sales" customer
    // (mapped to QBO customer id 55) instead of creating a generic "Market Sale" record.
    const CASH_SALES_CUSTOMER_ID = "e10ef315-c726-43ac-ad8d-ea4a54f067c6";
    if (stripeCustomerId) {
      const { data: existingByStripeId } = await supabase
        .from("customer")
        .select("id")
        .eq("stripe_customer_id", stripeCustomerId)
        .maybeSingle();
      if (existingByStripeId) {
        customerId = existingByStripeId.id;
      } else {
        const retrievedCustomer = await stripe.customers.retrieve(stripeCustomerId);
        if (!("deleted" in retrievedCustomer) || retrievedCustomer.deleted !== true) {
          stripeCustomer = retrievedCustomer as Stripe.Customer;
        }
      }
    }

    if (!customerId && billingEmail) {
      const { data: existingCustomer } = await supabase
        .from("customer")
        .select("id")
        .eq("email", billingEmail)
        .maybeSingle();
      if (existingCustomer) {
        customerId = existingCustomer.id;
        if (stripeCustomerId) {
          await supabase
            .from("customer")
            .update({ stripe_customer_id: stripeCustomerId, synced_at: new Date().toISOString() })
            .eq("id", customerId);
        }
      } else {
        const { data: newCustomer } = await supabase
          .from("customer")
          .insert({
            display_name: billingName,
            email: billingEmail,
            stripe_customer_id: stripeCustomerId,
          })
          .select("id")
          .single();
        customerId = newCustomer?.id ?? null;
      }
    }

    if (!customerId && stripeCustomer) {
      const { data: newCustomer } = await supabase
        .from("customer")
        .insert({
          display_name: stripeCustomer.name ?? billingName,
          email: stripeCustomer.email ?? null,
          phone: stripeCustomer.phone ?? null,
          stripe_customer_id: stripeCustomer.id,
        })
        .select("id")
        .single();
      customerId = newCustomer?.id ?? null;
    }

    // Fall back to "Cash Sales" generic customer for true POS/walk-in sales (no email, no Stripe customer)
    if (!customerId) {
      customerId = CASH_SALES_CUSTOMER_ID;
    }

    const notes = [
      "Auto-imported from Stripe in-person/POS payment.",
      `payment_intent=${paymentIntent.id}`,
      chargeId ? `charge=${chargeId}` : null,
      paymentIntent.description ? `description=${paymentIntent.description}` : null,
      "Manual SKU allocation required.",
    ].filter(Boolean).join(" ");

    const { data: order, error: orderError } = await supabase
      .from("sales_order")
      .insert({
        origin_channel: "in_person",
        origin_reference: paymentIntent.id,
        payment_reference: paymentIntent.id,
        status: "paid",
        txn_date: txnDate,
        customer_id: customerId,
        guest_email: guestEmail,
        guest_name: billingName,
        shipping_name: billingName,
        shipping_line_1: billingAddress?.line1 || "",
        shipping_line_2: billingAddress?.line2 || null,
        shipping_city: billingAddress?.city || "",
        shipping_county: billingAddress?.state || null,
        shipping_postcode: billingAddress?.postal_code || "",
        shipping_country: shippingCountry,
        merchandise_subtotal: netAmount,
        shipping_total: 0,
        discount_total: 0,
        tax_total: taxTotal,
        gross_total: grossTotal,
        net_amount: netAmount,
        payment_method: paymentMethod,
        global_tax_calculation: "TaxExcluded",
        qbo_sync_status: isTestEvent ? "skipped" : "needs_manual_review",
        v2_status: "needs_allocation",
        blue_bell_club: false,
        notes,
        is_test: isTestEvent,
      })
      .select("id, order_number")
      .single();

    if (orderError) {
      throw orderError;
    }

    console.log(`Created in-person order ${order.order_number} (${order.id}) from payment_intent ${paymentIntent.id}`);

    await supabase.from("audit_event").insert({
      entity_type: "sales_order",
      entity_id: order.id,
      trigger_type: "stripe_pos_webhook",
      actor_type: "system",
      source_system: "stripe",
      after_json: {
        order_number: order.order_number,
        payment_intent: paymentIntent.id,
        charge_id: chargeId,
        gross_total: grossTotal,
        payment_method: paymentMethod,
        origin_channel: "in_person",
        requires_manual_allocation: true,
        is_test: isTestEvent,
      },
    });

    if (order.order_number) {
      await supabase.from("sales_order").update({
        doc_number: order.order_number,
      }).eq("id", order.id);
    }

    if (!isTestEvent) {
      await supabase.from("admin_alert").insert({
        severity: "warning",
        category: "stripe_pos_sale_needs_allocation",
        title: `Stripe in-person sale ${order.order_number} needs allocation`,
        detail: `Card payment ${paymentIntent.id} was imported automatically from Stripe. Add line items / stock allocation before QBO sync.`,
        entity_type: "sales_order",
        entity_id: order.id,
      });
    }
  } catch (err) {
    console.error("Error handling payment_intent.succeeded:", err);
    throw err;
  }
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session, stripe: Stripe, isTestEvent: boolean) {
  try {
    const shippingMethod = session.metadata?.shipping_method || "standard";
    const isCollection = shippingMethod === "collection";

    // Retrieve line items from Stripe
    const lineItems = await stripe.checkout.sessions.listLineItems(session.id, {
      limit: 100,
    });

    // Separate product lines from shipping lines.
    // Match only exact shipping-like descriptions to avoid misclassifying
    // products with "shipping" in their name (e.g. "LEGO Shipping Container").
    const productLines = lineItems.data.filter(
      (li: any) => {
        const desc = li.description?.trim() || "";
        const shippingPattern = /^(standard |express |next[- ]day )?shipping$/i;
        return !shippingPattern.test(desc);
      }
    );

    const stripeMerchandiseGross = productLines.reduce(
      (sum: number, li: any) => sum + (li.amount_total || 0),
      0
    ) / 100;

    const shippingTotal = (session.shipping_cost?.amount_total || 0) / 100;
    const discountTotal = (session.total_details?.amount_discount || 0) / 100;
    const grossTotal = (session.amount_total || 0) / 100;
    const taxTotal = (session.total_details?.amount_tax || 0) / 100;

    // Extract shipping address
    const shippingDetails = session.shipping_details || session.customer_details;
    const address = shippingDetails?.address;
    const shippingCountry = (address?.country || "GB").toUpperCase();

    // Find user by email if authenticated
    let userId: string | null = null;
    const customerEmail = session.customer_email || session.customer_details?.email;

    if (customerEmail) {
      const { data: profiles } = await supabase
        .from("profile")
        .select("user_id")
        .eq("user_id", (await findUserByEmail(customerEmail)) || "")
        .limit(1);
      if (profiles && profiles.length > 0) {
        userId = profiles[0].user_id;
      }
    }

    // ── Resolve VAT from shipping country ──
    // Storefront prices (sku.price) are GROSS (VAT-inclusive per UK consumer law).
    // Convert to NET for consistent storage across all channels.
    // Falls back to UK 20% if the required tax code isn't synced yet.
    let vatResolution: VatResolution;
    let vatResolutionFallback = false;
    try {
      vatResolution = await resolveVatForShippingCountry(supabase, shippingCountry);
    } catch (vatErr: any) {
      console.warn(`VAT resolution failed for ${shippingCountry}, falling back to UK 20%: ${(vatErr as Error).message}`);
      vatResolutionFallback = true;
      const { data: fallbackCodes } = await supabase
        .from("tax_code")
        .select("id, qbo_tax_code_id, name, sales_tax_rate_id, vat_rate:sales_tax_rate_id(id, qbo_tax_rate_id, rate_percent)")
        .eq("active", true)
        .not("sales_tax_rate_id", "is", null);
      const ukStandard = fallbackCodes?.find((tc: any) => Number(tc.vat_rate?.rate_percent) === 20);
      if (!ukStandard?.vat_rate) {
        throw new Error(`VAT resolution failed and no fallback tax code available. Original error: ${(vatErr as Error).message}`);
      }
      const vatRate = ukStandard.vat_rate as any;
      vatResolution = {
        destination: "uk",
        taxCodeId: ukStandard.id,
        vatRateId: vatRate.id,
        qboTaxCodeId: ukStandard.qbo_tax_code_id,
        ratePercent: Number(vatRate.rate_percent),
      };
    }
    const vatMultiplier = 1 + vatResolution.ratePercent / 100;
    console.log(`VAT resolution: country=${shippingCountry}, destination=${vatResolution.destination}, rate=${vatResolution.ratePercent}%, fallback=${vatResolutionFallback}`);

    // ── Pre-compute NET line data from SKU prices ──
    // This must happen before the order insert so merchandise_subtotal is NET.
    interface PreparedLine {
      skuId: string;
      skuCode: string;
      grossPrice: number;
      netUnitPrice: number;
      netLineTotal: number;
      lineTax: number;
    }
    const preparedLines: PreparedLine[] = [];

    const skuItemsStr = session.metadata?.sku_items || "";
    if (skuItemsStr) {
      const skuItems = skuItemsStr.split(",").map((entry: string) => {
        const [skuId, qtyStr] = entry.split(":");
        return { skuId, quantity: parseInt(qtyStr, 10) || 1 };
      });

      const skuIds = skuItems.map((i: { skuId: string; quantity: number }) => i.skuId);
      const { data: skuRows } = await supabase
        .from("sku")
        .select("id, sku_code, price")
        .in("id", skuIds);

      const skuMap = new Map<string, { id: string; sku_code: string; price: number }>();
      for (const row of skuRows ?? []) {
        skuMap.set(row.id, row);
      }

      for (const item of skuItems) {
        const sku = skuMap.get(item.skuId);
        if (!sku) {
          console.warn(`SKU ${item.skuId} not found, skipping order line`);
          continue;
        }
        const grossPrice = Number(sku.price) || 0;
        const netUnitPrice = Math.round((grossPrice / vatMultiplier) * 100) / 100;
        const lineTax = Math.round((grossPrice - netUnitPrice) * 100) / 100;

        // One prepared line per unit (FIFO allocation happens later)
        for (let i = 0; i < item.quantity; i++) {
          preparedLines.push({
            skuId: sku.id,
            skuCode: sku.sku_code,
            grossPrice,
            netUnitPrice,
            netLineTotal: netUnitPrice,
            lineTax,
          });
        }
      }
    }

    // Compute NET merchandise subtotal from prepared lines
    const merchandiseSubtotal = preparedLines.reduce((s, pl) => s + pl.netLineTotal, 0);

    // Create the sales_order
    // gross_total = Stripe's authoritative charged amount (same pattern as eBay)
    // merchandise_subtotal = sum of NET line totals
    // tax_total = Stripe's authoritative tax amount
    const orderNumber_txnDate = new Date().toISOString().split("T")[0];
    const { data: order, error: orderError } = await supabase
      .from("sales_order")
      .insert({
        origin_channel: "web",
        origin_reference: session.id,
        payment_reference: session.payment_intent as string,
        status: "paid",
        txn_date: orderNumber_txnDate,
        merchandise_subtotal: Math.round(merchandiseSubtotal * 100) / 100,
        shipping_total: shippingTotal,
        discount_total: discountTotal,
        tax_total: taxTotal,
        gross_total: grossTotal,
        global_tax_calculation: "TaxExcluded",
        currency: (session.currency || "gbp").toUpperCase(),
        user_id: userId,
        guest_email: userId ? null : customerEmail,
        guest_name: userId ? null : shippingDetails?.name,
        shipping_name: shippingDetails?.name || "",
        shipping_line_1: address?.line1 || (isCollection ? "Collection" : ""),
        shipping_line_2: address?.line2 || null,
        shipping_city: address?.city || (isCollection ? "Collection" : ""),
        shipping_county: address?.state || null,
        shipping_postcode: address?.postal_code || (isCollection ? "N/A" : ""),
        shipping_country: shippingCountry,
        qbo_sync_status: isTestEvent ? "skipped" : "pending",
        is_test: isTestEvent,
      })
      .select("id, order_number")
      .single();

    if (orderError) {
      console.error("Failed to create sales_order:", orderError);
      return;
    }

    console.log(`Created order ${order.order_number} (${order.id})`);

    if (isCollection) {
      const { error: programError } = await supabase
        .rpc("record_sales_program_accrual", {
          p_sales_order_id: order.id,
          p_program_code: "blue_bell",
          p_attribution_source: "checkout_shipping_method",
          p_basis_amount: Math.round((grossTotal - shippingTotal) * 100) / 100,
          p_discount_amount: discountTotal,
          p_commission_amount: Math.round((grossTotal - shippingTotal) * 5) / 100,
        });

      if (programError) {
        console.error(`Failed to record Blue Bell accrual for order ${order.id}:`, programError);
      }
    }

    // ── Alert admin if VAT resolution fell back to default ──
    if (vatResolutionFallback) {
      try {
        await supabase.from("audit_event").insert({
          entity_type: "sales_order",
          entity_id: order.id,
          trigger_type: "vat_resolution_fallback",
          actor_type: "system",
          source_system: "stripe-webhook",
          after_json: {
            shipping_country: shippingCountry,
            expected_destination: classifyShippingCountry(shippingCountry),
            applied_destination: vatResolution.destination,
            applied_rate_percent: vatResolution.ratePercent,
            fallback: true,
          },
        });
        await supabase.from("admin_alert").insert({
          severity: "critical",
          category: "vat_resolution_fallback",
          title: `VAT fallback: web order ${order.order_number} (${shippingCountry}) used UK 20% default`,
          detail: `No matching tax code for ${classifyShippingCountry(shippingCountry).toUpperCase()} destination (${shippingCountry}). ` +
            `Order created with UK standard rate (20%) as fallback. ` +
            `Correct the tax code in QBO and ensure qbo-sync-tax-rates has been run.`,
          entity_type: "sales_order",
          entity_id: order.id,
        });
      } catch (alertErr: any) {
        console.error(`Failed to create VAT fallback alert:`, (alertErr as Error).message);
      }
    }

    // ── Create order lines with domain stock allocation ──
    let allAllocated = true;
    for (const pl of preparedLines) {
      const { data: insertedLine, error: lineError } = await supabase
        .from("sales_order_line")
        .insert({
          sales_order_id: order.id,
          sku_id: pl.skuId,
          quantity: 1,
          unit_price: pl.netUnitPrice,
          line_total: pl.netLineTotal,
          tax_code_id: vatResolution.taxCodeId,
          vat_rate_id: vatResolution.vatRateId,
          qbo_tax_code_ref: vatResolution.qboTaxCodeId,
        })
        .select("id")
        .single();

      if (lineError) {
        console.error(`Failed to create order line for SKU ${pl.skuCode}:`, lineError);
        allAllocated = false;
        continue;
      }

      const lineId = (insertedLine as Record<string, unknown>).id as string;
      const { data: allocation, error: allocationError } = await supabase
        .rpc("allocate_stock_for_order_line", { p_sales_order_line_id: lineId });

      const allocationResult = allocation as Record<string, unknown> | null;
      if (allocationError || allocationResult?.status !== "allocated") {
        console.warn(`No available stock unit for SKU ${pl.skuCode}, order line created without stock`, allocationError);
        allAllocated = false;
      }
    }

    await supabase
      .rpc("refresh_order_line_economics", { p_sales_order_id: order.id });

    if (!allAllocated) {
      await supabase
        .from("sales_order")
        .update({ qbo_sync_status: "needs_manual_review", v2_status: "needs_allocation" } as never)
        .eq("id", order.id);
    }

    if (preparedLines.length > 0) {
      console.log(`Created ${preparedLines.length} order line(s) for ${new Set(preparedLines.map(l => l.skuId)).size} SKU(s)`);

      // ── Queue updated stock counts to eBay (non-blocking) ──
      // Stock just decreased on the website; eBay needs to know through
      // the listing outbox so the same units cannot also sell there.
      const affectedSkuIds = new Set(preparedLines.map(l => l.skuId).filter(Boolean));
      if (affectedSkuIds.size > 0) {
        pushEbayQuantityForSkus(supabase, affectedSkuIds, {
          source: "stripe-webhook",
          orderId: order.id,
        }).catch((err) =>
          console.warn(`eBay quantity sync queue failed (non-blocking): ${err}`),
        );
      }
    } else if (skuItemsStr) {
      console.warn(`sku_items parsed but no lines created for session ${session.id}`);
    } else {
      console.warn(`No sku_items metadata on session ${session.id}, order lines not created`);
    }

    // Audit event for order creation
    await supabase.from("audit_event").insert({
      entity_type: "sales_order",
      entity_id: order.id,
      trigger_type: "stripe_webhook",
      actor_type: "system",
      source_system: "stripe",
      after_json: {
        order_number: order.order_number,
        stripe_session: session.id,
        gross_total: grossTotal,
        merchandise_subtotal_net: Math.round(merchandiseSubtotal * 100) / 100,
        vat_destination: vatResolution.destination,
        vat_rate_percent: vatResolution.ratePercent,
        vat_fallback: vatResolutionFallback,
        status: "paid",
        is_test: isTestEvent,
      },
    });

    // ── Set DocNumber on the order for QBO cross-channel dedup ──
    if (order.order_number) {
      await supabase.from("sales_order").update({
        doc_number: order.order_number,
      }).eq("id", order.id);
    }

    // ── Find or create customer record and link to order ──
    let customerId: string | null = null;
    try {
      if (userId) {
        const { data: existingCustomer } = await supabase
          .from("customer")
          .select("id")
          .eq("user_id", userId)
          .maybeSingle();

        if (existingCustomer) {
          customerId = existingCustomer.id;
        } else {
          const { data: newCustomer } = await supabase
            .from("customer")
            .insert({
              user_id: userId,
              display_name: shippingDetails?.name || customerEmail || "Customer",
              email: customerEmail,
            })
            .select("id")
            .single();
          customerId = newCustomer?.id ?? null;
        }
      } else if (customerEmail) {
        const { data: existingCustomer } = await supabase
          .from("customer")
          .select("id")
          .eq("email", customerEmail)
          .is("user_id", null)
          .maybeSingle();

        if (existingCustomer) {
          customerId = existingCustomer.id;
        } else {
          const { data: newCustomer } = await supabase
            .from("customer")
            .insert({
              display_name: shippingDetails?.name || customerEmail || "Guest",
              email: customerEmail,
            })
            .select("id")
            .single();
          customerId = newCustomer?.id ?? null;
        }
      }

      if (customerId) {
        await supabase.from("sales_order").update({ customer_id: customerId }).eq("id", order.id);
        console.log(`Linked customer ${customerId} to order ${order.order_number}`);
      }
    } catch (custErr: any) {
      console.warn(`Failed to create/link customer record (non-fatal):`, custErr.message);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    // ── Queue QBO posting intent (best-effort, non-blocking) ──
    // The posting worker creates the QBO Customer + SalesReceipt asynchronously.
    // Skip for test/sandbox events — they should not sync to QBO.
    if (isTestEvent) {
      console.log("Test event — skipping QBO posting intent");
    } else if (!allAllocated) {
      console.log("Order needs allocation — skipping QBO posting intent until allocation is complete");
    } else {
      const { error: postingIntentError } = await supabase
        .rpc("queue_qbo_posting_intents_for_order", { p_sales_order_id: order.id });

      if (postingIntentError) {
        console.warn("Failed to queue QBO posting intent:", postingIntentError.message);
      } else if (supabaseUrl && serviceRoleKey) {
        fetch(`${supabaseUrl}/functions/v1/accounting-posting-intents-process`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${serviceRoleKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ batchSize: 10 }),
        }).catch((err) => {
          console.warn("posting intent processor trigger failed (non-blocking):", err);
        });
      }
    }

    // ── Trigger v2 order processing (FIFO, COGS, variant stats) ──
    try {
      if (supabaseUrl && serviceRoleKey) {
        fetch(`${supabaseUrl}/functions/v1/v2-process-order`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${serviceRoleKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ orderId: order.id }),
        }).catch((err) => {
          console.warn("v2-process-order trigger failed (non-blocking):", err);
        });
        console.log(`v2-process-order triggered for order ${order.id}`);
      }
    } catch (v2Err) {
      console.warn("v2-process-order trigger failed (non-blocking):", v2Err);
    }

    // ── Send order confirmation email (best-effort, non-blocking) ──
    try {
      if (supabaseUrl && serviceRoleKey && customerEmail) {
        const emailItems = preparedLines.map((pl) => ({
          name: pl.skuCode,
          sku: pl.skuCode,
          quantity: 1,
          unitPrice: pl.grossPrice.toFixed(2),
        }));
        fetch(`${supabaseUrl}/functions/v1/send-transactional-email`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${serviceRoleKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            templateName: "order-confirmation",
            recipientEmail: customerEmail,
            idempotencyKey: `order-confirm-${order.id}`,
            templateData: {
              orderNumber: order.order_number,
              items: emailItems,
              shippingName: shippingDetails?.name || "",
              grossTotal: grossTotal.toFixed(2),
              currency: (session.currency || "gbp").toUpperCase(),
            },
          }),
        }).catch((err) => {
          console.warn("Order confirmation email trigger failed (non-blocking):", err);
        });
        console.log("Triggered order confirmation email for", customerEmail);
      }
    } catch (emailErr) {
      console.warn("Failed to trigger order confirmation email (non-blocking):", emailErr);
    }
  } catch (err) {
    console.error("Error handling checkout.session.completed:", err);
    throw err; // Propagate to caller so landing status reflects failure and Stripe retries
  }
}

// ─── Handle payout.paid ─────────────────────────────────────

async function handlePayoutPaid(payoutObj: Record<string, unknown>, isTestEvent: boolean) {
  const payoutId = payoutObj.id as string;
  const amount = (payoutObj.amount as number) ?? 0; // in pence
  const currency = (payoutObj.currency as string) ?? "gbp";

  // Stripe amounts are in smallest currency unit (pence for GBP)
  const netAmount = amount / 100; // Stripe payout amount IS the net (after fees)
  const payoutDate = payoutObj.arrival_date
    ? new Date((payoutObj.arrival_date as number) * 1000).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  // Check for duplicate
  const { data: existing } = await supabase
    .from("payouts")
    .select("id")
    .eq("external_payout_id", payoutId)
    .maybeSingle();

  if (existing) {
    console.log(`Stripe payout ${payoutId} already recorded, skipping`);
    return;
  }

  // Fetch balance transactions for this payout to get fee breakdown + order matching
  let totalFees = 0;
  let grossAmount = netAmount;
  let orderCount = 0;
  const matchedOrderIds: string[] = [];
  const piToOrderId = new Map<string, string>();
  // Per-charge fee records to write into payout_fee after we have the local payout id.
  // Each entry maps a Stripe payment_intent (pi_…) to its processing fee in pounds.
  const perChargeFees: Array<{
    paymentIntentId: string;
    chargeId: string;
    feeAmount: number; // in pounds
    description: string;
  }> = [];
  // Residual non-charge fees (e.g. account-level Stripe charges) lumped together.
  let residualFee = 0;

  try {
    // Use the correct Stripe instance (live vs sandbox determined by caller context)
    const stripeClient = isTestEvent ? stripeSandbox : stripeLive;
    const btList = await stripeClient.balanceTransactions.list({
      payout: payoutId,
      limit: 100,
    });

    let feeTotal = 0;
    const paymentIntentIds: string[] = [];

    for (const bt of btList.data) {
      feeTotal += bt.fee; // in pence
      if (bt.source && typeof bt.source === "string" && bt.source.startsWith("ch_")) {
        // This is a charge — look up the payment_intent
        try {
          const charge = await stripeClient.charges.retrieve(bt.source as string);
          const pi = charge.payment_intent as string | null;
          if (pi) {
            paymentIntentIds.push(pi);
            perChargeFees.push({
              paymentIntentId: pi,
              chargeId: bt.source as string,
              feeAmount: bt.fee / 100,
              description: `Stripe processing fee — charge ${bt.source}`,
            });
          } else {
            residualFee += bt.fee / 100;
          }
        } catch {
          residualFee += bt.fee / 100;
        }
      } else if (bt.fee > 0) {
        // Non-charge balance tx with a fee (rare): treat as residual.
        residualFee += bt.fee / 100;
      }
    }

    totalFees = feeTotal / 100;
    grossAmount = netAmount + totalFees;

    // Match payment intents to orders
    if (paymentIntentIds.length > 0) {
      const { data: orders } = await supabase
        .from("sales_order")
        .select("id, payment_reference")
        .in("payment_reference", paymentIntentIds);

      if (orders) {
        for (const o of orders as { id: string; payment_reference: string | null }[]) {
          matchedOrderIds.push(o.id);
          if (o.payment_reference) piToOrderId.set(o.payment_reference, o.id);
        }
        orderCount = matchedOrderIds.length;
      }
    }
  } catch (btErr) {
    console.warn("Failed to fetch balance transactions (proceeding with basic payout):", btErr);
    grossAmount = netAmount;
  }

  // Insert payout record
  const { data: payoutRecord, error: insertErr } = await supabase
    .from("payouts")
    .insert({
      channel: "stripe",
      payout_date: payoutDate,
      gross_amount: Math.round(grossAmount * 100) / 100,
      total_fees: Math.round(totalFees * 100) / 100,
      net_amount: Math.round(netAmount * 100) / 100,
      fee_breakdown: { fvf: 0, promoted_listings: 0, international: 0, processing: Math.round(totalFees * 100) / 100 },
      order_count: orderCount,
      unit_count: 0,
      qbo_sync_status: "pending",
      external_payout_id: payoutId,
    })
    .select()
    .single();

  if (insertErr) {
    console.error("Failed to insert Stripe payout:", insertErr);
    throw new Error(`Failed to record payout: ${insertErr.message}`);
  }

  // Link matched orders to payout via join table.
  // Include order_gross sourced from sales_order.gross_total so
  // reconcile can compute order_net = gross - fees correctly.
  const localPayoutId = (payoutRecord as Record<string, unknown>)?.id as string;
  if (localPayoutId && matchedOrderIds.length > 0) {
    const { data: grossRows } = await supabase
      .from("sales_order")
      .select("id, gross_total")
      .in("id", matchedOrderIds);
    const grossById = new Map<string, number>();
    for (const g of (grossRows ?? []) as Array<{ id: string; gross_total: number | null }>) {
      grossById.set(g.id, Number(g.gross_total ?? 0));
    }
    const orderLinks = matchedOrderIds.map((orderId) => ({
      payout_id: localPayoutId,
      sales_order_id: orderId,
      order_gross: grossById.get(orderId) ?? 0,
    }));

    try {
      await supabase
        .from("payout_orders")
        .upsert(orderLinks as never, { onConflict: "payout_id,sales_order_id" as never });
      console.log(`Linked ${matchedOrderIds.length} orders to payout ${payoutId}`);
    } catch (err: unknown) {
      console.warn("Failed to link orders to payout:", err);
    }
  }

  // Insert per-charge payout_fee rows so reconciliation can populate
  // order_fees / order_net per order, and so qbo-sync-payout's Stripe
  // adapter has fee rows to drive Purchase creation.
  if (localPayoutId && perChargeFees.length > 0) {
    const feeRows = perChargeFees.map((c) => ({
      payout_id: localPayoutId,
      sales_order_id: piToOrderId.get(c.paymentIntentId) ?? null,
      external_order_id: c.paymentIntentId,
      channel: "stripe",
      fee_category: "payment_processing",
      amount: Math.round(c.feeAmount * 100) / 100,
      description: c.description,
    }));
    const { error: feeErr } = await supabase
      .from("payout_fee")
      .insert(feeRows as never);
    if (feeErr) {
      console.warn(`Failed to insert ${feeRows.length} payout_fee rows for ${payoutId}:`, feeErr);
    } else {
      console.log(`Inserted ${feeRows.length} payout_fee rows for Stripe payout ${payoutId}`);
    }
  }

  // Lump any residual non-charge fees into a single ACCOUNT_CHARGE-style row.
  if (localPayoutId && residualFee > 0.005) {
    const { error: resErr } = await supabase
      .from("payout_fee")
      .insert({
        payout_id: localPayoutId,
        sales_order_id: null,
        external_order_id: null,
        channel: "stripe",
        fee_category: "payment_processing",
        amount: Math.round(residualFee * 100) / 100,
        description: `Stripe residual processing fees (non-charge balance txs)`,
      } as never);
    if (resErr) console.warn(`Failed to insert residual payout_fee for ${payoutId}:`, resErr);
  }

  // Trigger reconciliation (payout_received transition + QBO sync)
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (supabaseUrl && serviceRoleKey && localPayoutId) {
    fetch(`${supabaseUrl}/functions/v1/v2-reconcile-payout`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ payoutId: localPayoutId }),
    }).catch((err) => console.warn("v2-reconcile-payout trigger failed (non-blocking):", err));
  }

  console.log(
    `Stripe payout ${payoutId} recorded: gross £${grossAmount.toFixed(2)}, ` +
    `fees £${totalFees.toFixed(2)}, net £${netAmount.toFixed(2)}, ` +
    `${orderCount} orders${isTestEvent ? " (test)" : ""}`
  );
}

async function findUserByEmail(email: string): Promise<string | null> {
  // Use service role to look up user by email in auth.users via admin API
  const { data, error } = await supabase.auth.admin.listUsers();
  if (error || !data?.users) return null;
  const user = data.users.find((u) => u.email === email);
  return user?.id || null;
}
