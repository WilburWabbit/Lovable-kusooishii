import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
  apiVersion: "2023-10-16",
  httpClient: Stripe.createFetchHttpClient(),
});

const endpointSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET") || "";

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

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, endpointSecret);
  } catch (err) {
    console.error("Webhook signature verification failed:", (err as Error).message);
    return new Response(`Webhook Error: ${(err as Error).message}`, { status: 400 });
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
        },
        { onConflict: "external_id" }
      );
  } catch (landErr) {
    console.error("Failed to land Stripe event:", landErr);
  }

  // ── Process event ──
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
      await handleCheckoutCompleted(session);
    }
  }

  // Mark landing as committed
  try {
    await supabase
      .from("landing_raw_stripe_event")
      .update({ status: "committed", processed_at: new Date().toISOString() })
      .eq("external_id", event.id);
  } catch (updateErr) {
    console.error("Failed to update landing status:", updateErr);
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });
});

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
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
        qbo_sync_status: "pending",
        ...(isCollection
          ? {
              club_discount_amount: discountTotal,
            }
          : {}),
      })
      .select("id, order_number")
      .single();

    if (orderError) {
      console.error("Failed to create sales_order:", orderError);
      return;
    }

    console.log(`Created order ${order.order_number} (${order.id})`);

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

    // ── Create order lines with FIFO stock allocation ──
    for (const pl of preparedLines) {
      // FIFO: pick the oldest available stock unit for this SKU
      const { data: stockUnit } = await supabase
        .from("stock_unit")
        .select("id")
        .eq("sku_id", pl.skuId)
        .eq("status", "available")
        .order("created_at", { ascending: true })
        .limit(1)
        .single();

      const { error: lineError } = await supabase
        .from("sales_order_line")
        .insert({
          sales_order_id: order.id,
          sku_id: pl.skuId,
          quantity: 1,
          unit_price: pl.netUnitPrice,
          line_total: pl.netLineTotal,
          stock_unit_id: stockUnit?.id ?? null,
          tax_code_id: vatResolution.taxCodeId,
          vat_rate_id: vatResolution.vatRateId,
          qbo_tax_code_ref: vatResolution.qboTaxCodeId,
        });

      if (lineError) {
        console.error(`Failed to create order line for SKU ${pl.skuCode}:`, lineError);
        continue;
      }

      // Mark stock unit as closed (sold)
      if (stockUnit) {
        const { error: stockError } = await supabase
          .from("stock_unit")
          .update({ status: "closed" })
          .eq("id", stockUnit.id);

        if (stockError) {
          console.error(`Failed to close stock unit ${stockUnit.id}:`, stockError);
        } else {
          // Audit the inventory change
          await supabase.from("audit_event").insert({
            entity_type: "stock_unit",
            entity_id: stockUnit.id,
            trigger_type: "stripe_webhook",
            actor_type: "system",
            source_system: "stripe",
            after_json: {
              status: "closed",
              reason: "sold",
              order_id: order.id,
              order_number: order.order_number,
            },
          });
        }
      } else {
        console.warn(`No available stock unit for SKU ${pl.skuCode}, order line created without stock`);
      }
    }

    if (preparedLines.length > 0) {
      console.log(`Created ${preparedLines.length} order line(s) for ${new Set(preparedLines.map(l => l.skuId)).size} SKU(s)`);
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
      },
    });

    // ── Set DocNumber on the order for QBO cross-channel dedup ──
    if (order.order_number) {
      await supabase.from("sales_order").update({
        doc_number: order.order_number,
      }).eq("id", order.id);
    }

    // ── Trigger QBO retry-sync (best-effort, non-blocking) ──
    // The order has qbo_sync_status='pending'. The retry function will
    // create the QBO Customer + SalesReceipt and store confirmation IDs.
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    try {
      if (supabaseUrl && serviceRoleKey) {
        fetch(`${supabaseUrl}/functions/v1/qbo-retry-sync`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${serviceRoleKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({}),
        }).catch((err) => {
          console.warn("qbo-retry-sync trigger failed (non-blocking):", err);
        });
        console.log("Triggered qbo-retry-sync for new web order");
      }
    } catch (qboErr) {
      console.warn("Failed to trigger qbo-retry-sync (non-blocking):", qboErr);
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
  }
}

async function findUserByEmail(email: string): Promise<string | null> {
  // Use service role to look up user by email in auth.users via admin API
  const { data, error } = await supabase.auth.admin.listUsers();
  if (error || !data?.users) return null;
  const user = data.users.find((u) => u.email === email);
  return user?.id || null;
}
