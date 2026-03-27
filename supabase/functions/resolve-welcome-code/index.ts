/**
 * resolve-welcome-code
 *
 * Public endpoint called when a buyer visits /welcome/:code.
 * Returns the welcome code data (buyer name, order items, promo code)
 * and tracks scan analytics.
 *
 * Auth: Anonymous (anon key)
 * Rate limiting: Recommended to add at the edge/CDN level
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);

  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code")?.trim().toUpperCase();

    if (!code) {
      return new Response(
        JSON.stringify({ error: "code parameter is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Look up the welcome code ──
    const { data: welcome, error } = await admin
      .from("welcome_code")
      .select("*")
      .eq("code", code)
      .maybeSingle();

    if (error) throw error;

    if (!welcome) {
      return new Response(
        JSON.stringify({ error: "Code not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Track scan (non-blocking) ──
    const isFirstScan = !welcome.scanned_at;
    admin
      .from("welcome_code")
      .update({
        scan_count: (welcome.scan_count || 0) + 1,
        ...(isFirstScan ? { scanned_at: new Date().toISOString() } : {}),
      })
      .eq("id", welcome.id)
      .then(() => {})
      .catch((err: any) => console.error("Failed to track scan:", err.message));

    // ── Return public-safe data ──
    return new Response(
      JSON.stringify({
        buyer_name: welcome.buyer_name,
        order_items: welcome.order_items || [],
        promo_code: welcome.promo_code,
        discount_pct: welcome.discount_pct,
        redeemed: !!welcome.redeemed_at,
        has_account: !!welcome.user_id,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    console.error("resolve-welcome-code error:", e);
    return new Response(
      JSON.stringify({ error: e.message || "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
