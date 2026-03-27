/**
 * generate-welcome-code
 *
 * Creates a welcome code + Stripe promotion code for an eBay buyer's first order.
 * Called from ebay-process-order after successful order creation (non-fatal).
 *
 * The welcome code is printed as a QR on a parcel insert linking to /welcome/:code.
 * The Stripe promo code gives 5% off the buyer's first direct order on kusooishii.com.
 * Single use, no expiry, cannot be combined with other discounts.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Alphabet excluding ambiguous characters: 0/O, 1/I/L
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const CODE_LENGTH = 4;
const MAX_RETRIES = 5;

function generateShortCode(): string {
  const chars: string[] = [];
  const arr = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(arr);
  for (let i = 0; i < CODE_LENGTH; i++) {
    chars.push(CODE_ALPHABET[arr[i] % CODE_ALPHABET.length]);
  }
  return `KSO-${chars.join("")}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);

  try {
    const body = await req.json();
    const {
      ebay_order_id,
      sales_order_id,
      customer_id,
      buyer_name,
      buyer_email,
      order_items,       // [{mpn, name, img_url, quantity, sku_code}]
      order_postcode,
    } = body;

    if (!ebay_order_id || !buyer_name) {
      return new Response(
        JSON.stringify({ error: "ebay_order_id and buyer_name are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Idempotency: skip if welcome code already exists for this eBay order ──
    const { data: existing } = await admin
      .from("welcome_code")
      .select("id, code, promo_code")
      .eq("ebay_order_id", ebay_order_id)
      .maybeSingle();

    if (existing) {
      console.log(`Welcome code already exists for eBay order ${ebay_order_id}: ${existing.code}`);
      return new Response(
        JSON.stringify({
          success: true,
          already_exists: true,
          code: existing.code,
          promo_code: existing.promo_code,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Check if this customer already has a welcome code ──
    // First order: generate a new code.
    // Repeat order + unredeemed code: return the existing code (so it can be re-sent in the parcel).
    // Repeat order + redeemed code: skip (they've already converted).
    if (customer_id) {
      const { data: existingForCustomer } = await admin
        .from("welcome_code")
        .select("id, code, promo_code, redeemed_at")
        .eq("customer_id", customer_id)
        .maybeSingle();

      if (existingForCustomer) {
        if (!existingForCustomer.redeemed_at) {
          // Unredeemed — return the existing code so it can be included in the next parcel
          console.log(`Customer ${customer_id} has unredeemed welcome code ${existingForCustomer.code} — returning for re-send`);
          return new Response(
            JSON.stringify({
              success: true,
              resend: true,
              code: existingForCustomer.code,
              promo_code: existingForCustomer.promo_code,
              qr_url: `https://kusooishii.com/welcome/${existingForCustomer.code}`,
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        } else {
          // Already redeemed — they've converted, no need for another code
          console.log(`Customer ${customer_id} already redeemed welcome code ${existingForCustomer.code} — skipping`);
          return new Response(
            JSON.stringify({ success: true, skipped: true, reason: "already_redeemed" }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }
    }

    // ── Generate unique short code with collision retry ──
    let code = "";
    let inserted = false;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      code = generateShortCode();
      const promoCodeStr = `WELCOME-${code.replace("KSO-", "")}`;

      // Extract primary SKU for label printing
      const primarySku = order_items?.[0]?.sku_code || order_items?.[0]?.mpn || null;

      // ── Get the Stripe coupon ID from app_settings ──
      const { data: couponSetting } = await admin
        .from("app_settings")
        .select("value")
        .eq("key", "ebay_welcome_coupon_id")
        .single();

      const stripeCouponId = couponSetting?.value
        ? JSON.parse(couponSetting.value)
        : null;

      if (!stripeCouponId) {
        throw new Error("ebay_welcome_coupon_id not configured in app_settings");
      }

      // ── Check if Stripe is in test mode ──
      const { data: testModeSetting } = await admin
        .from("app_settings")
        .select("value")
        .eq("key", "stripe_test_mode")
        .maybeSingle();

      const isTestMode = testModeSetting?.value === "true" || testModeSetting?.value === true;
      const activeStripeKey = isTestMode
        ? (Deno.env.get("STRIPE_TEST_SECRET_KEY") || stripeKey)
        : stripeKey;

      // ── Create unique Stripe promotion code ──
      let stripePromoCodeId: string | null = null;
      let stripePromoCode: string | null = null;

      try {
        const promoRes = await fetch("https://api.stripe.com/v1/promotion_codes", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${activeStripeKey}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            coupon: stripeCouponId,
            code: promoCodeStr,
            "max_redemptions": "1",
            "metadata[ebay_order_id]": ebay_order_id,
            "metadata[welcome_code]": code,
            "metadata[buyer_name]": buyer_name,
            // Restriction: cannot combine with other discounts
            // (Stripe checkout only allows one discount, so this is naturally enforced)
          }),
        });

        if (!promoRes.ok) {
          const errText = await promoRes.text();
          console.error(`Stripe promo code creation failed: ${errText}`);
          // If promo code already exists in Stripe (e.g. from a retry), try to find it
          if (errText.includes("already exists")) {
            // Code collision in Stripe — retry with new code
            continue;
          }
          throw new Error(`Stripe API error: ${promoRes.status} - ${errText}`);
        }

        const promoData = await promoRes.json();
        stripePromoCodeId = promoData.id;
        stripePromoCode = promoData.code;
      } catch (stripeErr: any) {
        console.error(`Stripe promo creation error: ${stripeErr.message}`);
        // Still create the welcome_code row without Stripe promo
        // Can be retried or manually linked later
      }

      // ── Insert welcome_code row ──
      const { data: row, error: insertErr } = await admin
        .from("welcome_code")
        .insert({
          code,
          ebay_order_id,
          sales_order_id: sales_order_id || null,
          customer_id: customer_id || null,
          buyer_name,
          buyer_email: buyer_email || null,
          order_items: order_items || [],
          order_postcode: order_postcode || null,
          primary_sku: primarySku,
          stripe_coupon_id: stripeCouponId,
          stripe_promo_code_id: stripePromoCodeId,
          promo_code: stripePromoCode || promoCodeStr,
          discount_pct: 5,
        })
        .select("id, code, promo_code")
        .single();

      if (insertErr) {
        if (insertErr.message?.includes("unique") || insertErr.message?.includes("duplicate")) {
          console.warn(`Code collision on ${code}, retrying...`);
          continue;
        }
        throw new Error(`Failed to insert welcome_code: ${insertErr.message}`);
      }

      inserted = true;
      console.log(`Welcome code created: ${code} → promo ${stripePromoCode || "pending"} for eBay order ${ebay_order_id}`);

      // ── Audit event ──
      try {
        await admin.from("audit_event").insert({
          entity_type: "welcome_code",
          entity_id: row.id,
          trigger_type: "ebay_order",
          actor_type: "system",
          source_system: "generate-welcome-code",
          after_json: {
            code,
            ebay_order_id,
            customer_id,
            promo_code: stripePromoCode,
            stripe_promo_code_id: stripePromoCodeId,
          },
        });
      } catch { /* audit is best-effort */ }

      return new Response(
        JSON.stringify({
          success: true,
          code,
          promo_code: stripePromoCode || promoCodeStr,
          qr_url: `https://kusooishii.com/welcome/${code}`,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!inserted) {
      throw new Error(`Failed to generate unique code after ${MAX_RETRIES} attempts`);
    }

    // Fallback (should not reach here)
    return new Response(
      JSON.stringify({ error: "Unexpected state" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    console.error("generate-welcome-code error:", e);
    return new Response(
      JSON.stringify({ error: e.message || "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
