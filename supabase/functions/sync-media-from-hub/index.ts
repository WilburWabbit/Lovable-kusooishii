import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // --- Auth: require admin or staff ---
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await admin.auth.getUser(token);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: roles } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id);

    const hasAccess = (roles ?? []).some(
      (r: { role: string }) => r.role === "admin" || r.role === "staff"
    );
    if (!hasAccess) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Connect to Kuso Hub
    const hubUrl = Deno.env.get("KUSO_HUB_SUPABASE_URL")!;
    const hubKey = Deno.env.get("KUSO_HUB_SERVICE_ROLE_KEY")!;
    const hub = createClient(hubUrl, hubKey);

    // Fetch primary media from Kuso Hub with product MPN
    const { data: hubMedia, error: hubErr } = await hub
      .from("product_media")
      .select("file_url, product:product_id(mpn)")
      .eq("is_primary", true)
      .order("sort_order", { ascending: true });

    if (hubErr) throw new Error(`Hub query error: ${hubErr.message}`);

    // Build MPN → file_url map
    const mpnMap = new Map<string, string>();
    for (const m of hubMedia ?? []) {
      const mpn = (m as any).product?.mpn;
      if (mpn && m.file_url && !mpnMap.has(mpn)) {
        mpnMap.set(mpn, m.file_url);
      }
    }

    // Batch update product.img_url by MPN
    let updated = 0;
    let errors = 0;
    const entries = Array.from(mpnMap.entries());

    for (let i = 0; i < entries.length; i += 50) {
      const batch = entries.slice(i, i + 50);
      const promises = batch.map(([mpn, fileUrl]) =>
        admin
          .from("product")
          .update({ img_url: fileUrl })
          .eq("mpn", mpn)
          .select("id")
      );
      const results = await Promise.all(promises);
      for (const r of results) {
        if (r.error) {
          errors++;
        } else if (r.data && r.data.length > 0) {
          updated++;
        }
      }
    }

    return new Response(
      JSON.stringify({
        hub_media_found: mpnMap.size,
        products_updated: updated,
        errors,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
