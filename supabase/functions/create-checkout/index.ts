import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const {
      items,
      shippingMethod,
      shippingPrice,
      collectionDiscount,
    } = await req.json();

    if (!items || !Array.isArray(items) || items.length === 0) {
      throw new Error("Cart is empty");
    }

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
      apiVersion: "2025-08-27.basil",
    });

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? ""
    );

    // Check for authenticated user (optional — supports guest checkout)
    let userEmail: string | undefined;
    let customerId: string | undefined;
    const authHeader = req.headers.get("Authorization");
    if (authHeader) {
      const token = authHeader.replace("Bearer ", "");
      const { data } = await supabaseClient.auth.getUser(token);
      if (data.user?.email) {
        userEmail = data.user.email;
        const customers = await stripe.customers.list({
          email: userEmail,
          limit: 1,
        });
        if (customers.data.length > 0) {
          customerId = customers.data[0].id;
        }
      }
    }

    const isCollection = shippingMethod === "collection";
    const origin = req.headers.get("origin") || "https://workspace-charm-market.lovable.app";

    // Build line items from cart
    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = items.map(
      (item: {
        name: string;
        setNumber: string;
        price: number;
        quantity: number;
        conditionGrade: number;
        image?: string;
      }) => ({
        price_data: {
          currency: "gbp",
          product_data: {
            name: item.name,
            description: `#${item.setNumber} · Grade ${item.conditionGrade}`,
            ...(item.image ? { images: [item.image] } : {}),
          },
          unit_amount: Math.round(item.price * 100),
        },
        quantity: item.quantity,
      })
    );

    // Add shipping as a line item if not free
    if (shippingPrice && shippingPrice > 0) {
      lineItems.push({
        price_data: {
          currency: "gbp",
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

    // Build session params
    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      mode: "payment",
      line_items: lineItems,
      success_url: `${origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/cart`,
      metadata: {
        shipping_method: shippingMethod,
        origin_channel: "web",
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
      // Collect shipping address for delivered orders
      sessionParams.shipping_address_collection = {
        allowed_countries: ["GB"],
      };
    }

    // Apply collection discount as a coupon
    if (isCollection && collectionDiscount && collectionDiscount > 0) {
      // Create an ad-hoc coupon for the collection discount
      const coupon = await stripe.coupons.create({
        percent_off: 5,
        duration: "once",
        name: "LEGO Club Collection Discount (5%)",
      });
      sessionParams.discounts = [{ coupon: coupon.id }];
    }

    const session = await stripe.checkout.sessions.create(sessionParams);

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("Checkout error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
