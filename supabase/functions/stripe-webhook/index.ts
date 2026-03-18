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

  // ── Land raw Stripe event ──
  const landingCorrelation = crypto.randomUUID();
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
    await handleCheckoutCompleted(session);
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

    // Separate product lines from shipping lines
    const productLines = lineItems.data.filter(
      (li: any) => !li.description?.toLowerCase().includes("shipping")
    );

    const merchandiseSubtotal = productLines.reduce(
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

    // Create the sales_order
    const { data: order, error: orderError } = await supabase
      .from("sales_order")
      .insert({
        origin_channel: "web",
        origin_reference: session.id,
        payment_reference: session.payment_intent as string,
        status: "paid",
        txn_date: new Date().toISOString().split("T")[0],
        merchandise_subtotal: merchandiseSubtotal,
        shipping_total: shippingTotal,
        discount_total: discountTotal,
        tax_total: taxTotal,
        gross_total: grossTotal,
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
        shipping_country: address?.country || "GB",
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

    // ── Create order lines and update FIFO inventory ──
    const skuItemsStr = session.metadata?.sku_items || "";
    if (skuItemsStr) {
      const skuItems = skuItemsStr.split(",").map((entry) => {
        const [skuId, qtyStr] = entry.split(":");
        return { skuId, quantity: parseInt(qtyStr, 10) || 1 };
      });

      // Look up SKU prices from the database
      const skuIds = skuItems.map((i) => i.skuId);
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

        // Create one order line per unit (FIFO stock allocation)
        for (let i = 0; i < item.quantity; i++) {
          // FIFO: pick the oldest available stock unit for this SKU
          const { data: stockUnit } = await supabase
            .from("stock_unit")
            .select("id")
            .eq("sku_id", sku.id)
            .eq("status", "available")
            .order("created_at", { ascending: true })
            .limit(1)
            .single();

          const unitPrice = Number(sku.price) || 0;

          const { error: lineError } = await supabase
            .from("sales_order_line")
            .insert({
              sales_order_id: order.id,
              sku_id: sku.id,
              quantity: 1,
              unit_price: unitPrice,
              line_total: unitPrice,
              stock_unit_id: stockUnit?.id ?? null,
            });

          if (lineError) {
            console.error(`Failed to create order line for SKU ${sku.sku_code}:`, lineError);
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
            console.warn(`No available stock unit for SKU ${sku.sku_code}, order line created without stock`);
          }
        }
      }

      console.log(`Created order lines for ${skuItems.length} SKU(s)`);
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
        status: "paid",
      },
    });

    // ── Trigger QBO sync (fire-and-forget) ──
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
      if (supabaseUrl && serviceRoleKey) {
        fetch(`${supabaseUrl}/functions/v1/qbo-sync-sales`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${serviceRoleKey}`,
            "Content-Type": "application/json",
            "x-webhook-trigger": "true",
          },
          body: JSON.stringify({}),
        }).catch((err) => {
          console.warn("QBO sync trigger failed (non-blocking):", err);
        });
        console.log("Triggered QBO sync for new web order");
      }
    } catch (qboErr) {
      console.warn("Failed to trigger QBO sync (non-blocking):", qboErr);
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
