import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabaseUser.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = claimsData.claims.sub;

    // Check admin/staff role
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);

    const userRoles = (roles ?? []).map((r: any) => r.role);
    if (!userRoles.includes("admin") && !userRoles.includes("staff")) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { receipt_id, condition_grade = "3" } = await req.json();
    if (!receipt_id) {
      return new Response(JSON.stringify({ error: "receipt_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validate condition grade
    const validGrades = ["1", "2", "3", "4", "5"];
    if (!validGrades.includes(condition_grade)) {
      return new Response(JSON.stringify({ error: "Invalid condition_grade" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch receipt
    const { data: receipt, error: receiptErr } = await supabaseAdmin
      .from("inbound_receipt")
      .select("*")
      .eq("id", receipt_id)
      .single();

    if (receiptErr || !receipt) {
      return new Response(JSON.stringify({ error: "Receipt not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (receipt.status !== "pending") {
      return new Response(JSON.stringify({ error: "Receipt already processed" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch lines with MPN
    const { data: lines, error: linesErr } = await supabaseAdmin
      .from("inbound_receipt_line")
      .select("*")
      .eq("inbound_receipt_id", receipt_id)
      .not("mpn", "is", null);

    if (linesErr) throw linesErr;
    if (!lines || lines.length === 0) {
      return new Response(JSON.stringify({ error: "No mapped lines to process" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let unitsCreated = 0;
    const skipped: string[] = [];

    for (const line of lines) {
      // Look up catalog_product by MPN
      const { data: product } = await supabaseAdmin
        .from("catalog_product")
        .select("id, mpn")
        .eq("mpn", line.mpn)
        .single();

      if (!product) {
        skipped.push(`MPN ${line.mpn}: not found in catalog`);
        continue;
      }

      // Find or create SKU for this product + condition grade
      const skuCode = `${product.mpn}-G${condition_grade}`;
      let { data: sku } = await supabaseAdmin
        .from("sku")
        .select("id")
        .eq("catalog_product_id", product.id)
        .eq("condition_grade", condition_grade)
        .single();

      if (!sku) {
        const { data: newSku, error: skuErr } = await supabaseAdmin
          .from("sku")
          .insert({
            catalog_product_id: product.id,
            condition_grade,
            sku_code: skuCode,
            price: line.unit_cost,
            active_flag: true,
            saleable_flag: true,
          })
          .select("id")
          .single();

        if (skuErr) throw skuErr;
        sku = newSku;
      }

      // Create stock_unit records (one per quantity)
      const stockUnits = [];
      for (let i = 0; i < line.quantity; i++) {
        stockUnits.push({
          sku_id: sku!.id,
          mpn: product.mpn,
          condition_grade,
          status: "received",
          landed_cost: line.unit_cost,
          carrying_value: line.unit_cost,
          supplier_id: receipt.vendor_name ?? null,
        });
      }

      const { error: suErr } = await supabaseAdmin
        .from("stock_unit")
        .insert(stockUnits);

      if (suErr) throw suErr;
      unitsCreated += stockUnits.length;
    }

    // Mark receipt as processed
    const { error: updateErr } = await supabaseAdmin
      .from("inbound_receipt")
      .update({ status: "processed", processed_at: new Date().toISOString() })
      .eq("id", receipt_id);

    if (updateErr) throw updateErr;

    return new Response(
      JSON.stringify({
        success: true,
        units_created: unitsCreated,
        skipped,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("process-receipt error:", err);
    return new Response(
      JSON.stringify({ error: err.message ?? "Internal error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
