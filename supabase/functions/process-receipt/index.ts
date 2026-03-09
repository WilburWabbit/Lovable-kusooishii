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

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id);

    const userRoles = (roles ?? []).map((r: any) => r.role);
    if (!userRoles.includes("admin") && !userRoles.includes("staff")) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { receipt_id } = await req.json();
    if (!receipt_id) {
      return new Response(JSON.stringify({ error: "receipt_id is required" }), {
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

    // Fetch ALL lines for this receipt
    const { data: allLines, error: linesErr } = await supabaseAdmin
      .from("inbound_receipt_line")
      .select("*")
      .eq("inbound_receipt_id", receipt_id);

    if (linesErr) throw linesErr;

    // Split into stock lines (with MPN and grade) and overhead lines
    const stockLines = (allLines ?? []).filter((l: any) => l.is_stock_line && l.mpn && l.condition_grade);
    const overheadLines = (allLines ?? []).filter((l: any) => !l.is_stock_line);

    if (stockLines.length === 0) {
      return new Response(JSON.stringify({ error: "No mapped stock lines to process" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Calculate overhead pool and stock base for pro-rata apportionment
    const totalOverhead = overheadLines.reduce((sum: number, l: any) => sum + Number(l.line_total), 0);
    const totalStockCost = stockLines.reduce((sum: number, l: any) => sum + Number(l.line_total), 0);

    let unitsCreated = 0;
    const skipped: string[] = [];
    const validGrades = ["1", "2", "3", "4", "5"];

    for (const line of stockLines) {
      const conditionGrade = validGrades.includes(line.condition_grade) ? line.condition_grade : "1";
      const mpn = line.mpn;
      const skuCode = `${mpn}-G${conditionGrade}`;

      // Optionally link to catalog_product if MPN matches
      const { data: product } = await supabaseAdmin
        .from("catalog_product")
        .select("id, mpn")
        .eq("mpn", mpn)
        .single();

      // Calculate apportioned overhead per unit for this line
      const lineTotal = Number(line.line_total);
      const lineOverhead = totalStockCost > 0
        ? totalOverhead * (lineTotal / totalStockCost)
        : 0;
      const overheadPerUnit = line.quantity > 0 ? lineOverhead / line.quantity : 0;
      const landedCost = Math.round((Number(line.unit_cost) + overheadPerUnit) * 100) / 100;

      // Find or create SKU by sku_code (unique constraint)
      let { data: sku } = await supabaseAdmin
        .from("sku")
        .select("id")
        .eq("sku_code", skuCode)
        .single();

      if (!sku) {
        const { data: newSku, error: skuErr } = await supabaseAdmin
          .from("sku")
          .insert({
            catalog_product_id: product?.id ?? null,
            condition_grade: conditionGrade,
            sku_code: skuCode,
            name: line.description ?? mpn,
            price: landedCost,
            active_flag: true,
            saleable_flag: !!product,
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
          mpn,
          condition_grade: conditionGrade,
          status: "received",
          landed_cost: landedCost,
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
        total_overhead_apportioned: Math.round(totalOverhead * 100) / 100,
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
