// Redeployed: 2026-03-23
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function cleanQboName(raw: string): string {
  return raw.replace(/\s*\([^)]*\)\s*$/, '').trim();
}

const ALLOCABLE_FEE_PATTERN = /\b(buy(?:ing)?\s+fee|purchase\s+fee|fees?|shipping|delivery|courier|postage|freight|carriage|inbound|warehouse)\b/i;

function isAllocableFeeLine(description?: string | null): boolean {
  return ALLOCABLE_FEE_PATTERN.test(description ?? "");
}

async function ensureProductExists(
  supabaseAdmin: any,
  mpn: string,
  fallbackName: string,
): Promise<string> {
  const productName = cleanQboName(fallbackName || mpn);

  const { data: ensuredProductId, error: ensureErr } = await supabaseAdmin.rpc("ensure_product_exists", {
    p_mpn: mpn,
    p_item_type: "set",
    p_name: productName,
  });

  if (!ensureErr && ensuredProductId) {
    return ensuredProductId;
  }

  if (ensureErr) {
    console.warn(`ensure_product_exists failed for ${mpn}, falling back to direct lookup: ${ensureErr.message}`);
  }

  const { data: existingProduct } = await supabaseAdmin
    .from("product")
    .select("id")
    .eq("mpn", mpn)
    .maybeSingle();

  if (existingProduct?.id) {
    return existingProduct.id;
  }

  const { data: catalog } = await supabaseAdmin
    .from("lego_catalog")
    .select("id, name, theme_id, piece_count, release_year, retired_flag, img_url, subtheme_name, product_type")
    .eq("mpn", mpn)
    .eq("status", "active")
    .maybeSingle();

  const productPayload = catalog
    ? {
        mpn,
        name: catalog.name,
        theme_id: catalog.theme_id,
        piece_count: catalog.piece_count,
        release_year: catalog.release_year,
        retired_flag: catalog.retired_flag ?? false,
        img_url: catalog.img_url,
        subtheme_name: catalog.subtheme_name,
        product_type: catalog.product_type ?? "set",
        lego_catalog_id: catalog.id,
        status: "active",
      }
    : {
        mpn,
        name: productName,
        product_type: "set",
        status: "active",
      };

  const { data: createdProduct, error: createErr } = await supabaseAdmin
    .from("product")
    .upsert(productPayload, { onConflict: "mpn" })
    .select("id")
    .single();

  if (createErr || !createdProduct?.id) {
    throw createErr ?? new Error(`Failed to ensure product for ${mpn}`);
  }

  return createdProduct.id;
}

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
    const overheadLines = (allLines ?? []).filter((l: any) => !l.is_stock_line && isAllocableFeeLine(l.description));

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
      // Use the sku_code from the receipt line if available, otherwise reconstruct from mpn + grade
      const skuCode = line.sku_code || (conditionGrade !== "1" ? `${mpn}.${conditionGrade}` : mpn);
      const productId = await ensureProductExists(
        supabaseAdmin,
        mpn,
        line.description ?? line.sku_code ?? mpn,
      );

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
            product_id: productId,
            condition_grade: conditionGrade,
            sku_code: skuCode,
            name: cleanQboName(line.description ?? mpn),
            price: landedCost,
            active_flag: true,
            saleable_flag: true,
          })
          .select("id")
          .single();

        if (skuErr) throw skuErr;
        sku = newSku;
      } else {
        await supabaseAdmin
          .from("sku")
          .update({ product_id: productId, saleable_flag: true })
          .eq("id", sku.id);
      }

      // Shortfall guard: only insert units not already created for this receipt line
      const { count: existingCount } = await supabaseAdmin
        .from("stock_unit")
        .select("id", { count: "exact", head: true })
        .eq("inbound_receipt_line_id", line.id);

      const shortfall = line.quantity - (existingCount ?? 0);
      if (shortfall <= 0) { continue; }

      const stockUnits = [];
      for (let i = 0; i < shortfall; i++) {
        stockUnits.push({
          sku_id: sku!.id,
          mpn,
          condition_grade: conditionGrade,
          status: "available",
          landed_cost: landedCost,
          supplier_id: receipt.vendor_name ?? null,
          inbound_receipt_line_id: line.id,
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
      JSON.stringify({ error: (err as Error).message ?? "Internal error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
