// Redeployed: 2026-03-23
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const VALID_SHIPPING_METHODS = ["standard", "express", "collection"] as const;
type ShippingMethod = (typeof VALID_SHIPPING_METHODS)[number];

// Hardcoded shipping prices (must match storefront display)
const SHIPPING_PRICES: Record<ShippingMethod, number> = {
  standard: 0,
  express: 5.99,
  collection: 0,
};

const COLLECTION_DISCOUNT_RATE = 0.05;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { items, shippingMethod } = await req.json();

    // --- Input validation ---
    if (!items || !Array.isArray(items) || items.length === 0) {
      throw new Error("Cart is empty");
    }

    if (!VALID_SHIPPING_METHODS.includes(shippingMethod)) {
      throw new Error(`Invalid shipping method: ${shippingMethod}`);
    }

    const validatedItems: { skuId: string; quantity: number }[] = items.map(
      (item: { skuId: string; quantity: number }, i: number) => {
        if (!item.skuId || typeof item.skuId !== "string") {
          throw new Error(`Item ${i}: missing skuId`);
        }
        const qty = Number(item.quantity);
        if (!Number.isInteger(qty) || qty < 1) {
          throw new Error(`Item ${i}: invalid quantity`);
        }
        return { skuId: item.skuId, quantity: qty };
      }
    );

    // Use service role to look up canonical prices and app settings
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Check if Stripe test/sandbox mode is enabled
    const { data: appSettings } = await adminClient
      .from("app_settings")
      .select("stripe_test_mode")
      .single();
    const isTestMode = appSettings?.stripe_test_mode ?? false;

    const stripeSecretKey = isTestMode
      ? Deno.env.get("STRIPE_SANDBOX_SECRET_KEY") || ""
      : Deno.env.get("STRIPE_SECRET_KEY") || "";

    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: "2023-10-16",
      httpClient: Stripe.createFetchHttpClient(),
    });

    // Anon client for auth check
    const anonClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? ""
    );

    // --- Authenticate user (optional — supports guest checkout) ---
    let userId: string | undefined;
    let userEmail: string | undefined;
    let customerId: string | undefined;
    const authHeader = req.headers.get("Authorization");
    if (authHeader) {
      const token = authHeader.replace("Bearer ", "");
      const { data } = await anonClient.auth.getUser(token);
      if (data.user) {
        userId = data.user.id;
        userEmail = data.user.email ?? undefined;
        if (userEmail) {
          const customers = await stripe.customers.list({
            email: userEmail,
            limit: 1,
          });
          if (customers.data.length > 0) {
            customerId = customers.data[0].id;
          } else {
            // Create a Stripe customer for registered users so they aren't treated as guests
            const newCustomer = await stripe.customers.create({
              email: userEmail,
              metadata: { supabase_user_id: userId ?? "" },
            });
            customerId = newCustomer.id;
          }
        }
      }
    }

    // --- Look up canonical SKU prices from database ---
    const skuIds = validatedItems.map((i) => i.skuId);
    const { data: skuRows, error: skuError } = await adminClient
      .from("sku")
      .select(
        "id, sku_code, price, name, condition_grade, product:product_id(mpn, name, img_url)"
      )
      .in("id", skuIds)
      .eq("active_flag", true)
      .eq("saleable_flag", true);

    if (skuError) {
      throw new Error("Failed to look up products");
    }

    // Build a map for quick lookup
    const skuMap = new Map<string, (typeof skuRows)[0]>();
    for (const row of skuRows ?? []) {
      skuMap.set(row.id, row);
    }

    // Validate every requested item exists and has a price
    for (const item of validatedItems) {
      const sku = skuMap.get(item.skuId);
      if (!sku) {
        throw new Error(`Product not found or unavailable: ${item.skuId}`);
      }
      if (sku.price == null || sku.price <= 0) {
        throw new Error(`Product has no valid price: ${item.skuId}`);
      }
    }

    // --- Collection discount eligibility ---
    const isCollection = shippingMethod === "collection";
    let collectionDiscount = 0;

    // Collection shipping/discount is intentionally available without
    // sign-in or membership approval checks.

    // --- Build line items with server-side prices ---
    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [];
    let merchandiseSubtotal = 0;

    for (const item of validatedItems) {
      const sku = skuMap.get(item.skuId)!;
      const product = sku.product as any;
      const unitPrice = Number(sku.price);
      merchandiseSubtotal += unitPrice * item.quantity;

      const primaryImage = product?.img_url;

      lineItems.push({
        price_data: {
          currency: "gbp",
          tax_behavior: "inclusive",
          product_data: {
            name: product?.name ?? sku.name ?? "LEGO Set",
            description: `#${product?.mpn ?? sku.sku_code} · Grade ${sku.condition_grade}`,
            ...(primaryImage ? { images: [primaryImage] } : {}),
          },
          unit_amount: Math.round(unitPrice * 100),
        },
        quantity: item.quantity,
      });
    }

    // --- Shipping (server-derived) ---
    // Express shipping is VAT-liable at 20% (inclusive). Standard/collection are free.
    const shippingPrice = SHIPPING_PRICES[shippingMethod as ShippingMethod];
    if (shippingPrice > 0) {
      lineItems.push({
        price_data: {
          currency: "gbp",
          tax_behavior: "inclusive",
          product_data: {
            name:
              shippingMethod === "express"
                ? "Express Shipping (Royal Mail Tracked 24)"
                : "Shipping",
          },
          unit_amount: Math.round(shippingPrice * 100),
        },
        quantity: 1,
      });
    }

    const origin =
      req.headers.get("origin") ||
      "https://workspace-charm-market.lovable.app";

    // --- Build session params ---
    // Encode SKU items into metadata so the webhook can create order lines.
    // Stripe metadata values are limited to 500 chars, so we use a compact format.
    // Format: "skuId:qty,skuId:qty,..."
    const skuItemsStr = validatedItems
      .map((i) => `${i.skuId}:${i.quantity}`)
      .join(",");

    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      mode: "payment",
      line_items: lineItems,
      automatic_tax: { enabled: true },
      success_url: `${origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/cart`,
      metadata: {
        shipping_method: shippingMethod,
        origin_channel: "web",
        sku_items: skuItemsStr,
        ...(isTestMode ? { is_test: "true" } : {}),
      },
      ...(customerId
        ? { customer: customerId }
        : userEmail
          ? { customer_email: userEmail }
          : {}),
    };

    // Allow promo codes for non-collection orders
    if (!isCollection) {
      sessionParams.allow_promotion_codes = true;
      sessionParams.shipping_address_collection = {
        allowed_countries: ["GB"],
      };
    }

    // Apply collection discount using the existing Blue Bell LEGO Club coupon.
    // Discounts apply to merchandise only (Stripe default for percentage coupons).
    if (isCollection) {
      collectionDiscount = merchandiseSubtotal * COLLECTION_DISCOUNT_RATE;
      if (collectionDiscount > 0) {
        sessionParams.discounts = [{ coupon: "EcehICVy" }];
      }
    }

    const session = await stripe.checkout.sessions.create(sessionParams);

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("Checkout error:", error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
