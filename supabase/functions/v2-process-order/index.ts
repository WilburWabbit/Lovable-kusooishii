// ============================================================
// V2 Process Order — Post-Order Hook
// Called after ANY order is created (Stripe, eBay, admin) to
// perform v2 lifecycle steps:
//   1. FIFO stock consumption via v2_consume_fifo_unit()
//   2. COGS recording on order line items
//   3. v2_status lifecycle tracking
//   4. Variant stats recalculation
//   5. QBO SalesReceipt sync trigger
//
// Idempotent: skips lines that already have stock_unit_id.
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { orderId } = await req.json();
    if (!orderId) throw new Error("orderId is required");

    console.log(`v2-process-order: Processing order ${orderId}`);

    // ─── 1. Fetch order + line items ────────────────────────
    const { data: order, error: orderErr } = await admin
      .from("sales_order")
      .select("id, order_number")
      .eq("id", orderId)
      .single();

    if (orderErr || !order) throw new Error(`Order not found: ${orderId}`);

    const { data: lineItems, error: lineErr } = await admin
      .from("sales_order_line")
      .select("id, sku_id, stock_unit_id, cogs")
      .eq("sales_order_id", orderId);

    if (lineErr) throw new Error(`Failed to fetch lines: ${lineErr.message}`);

    // ─── 2. Process each unallocated line item ──────────────
    const affectedSkus = new Set<string>();
    let processedLines = 0;
    let cogsTotal = 0;

    for (const line of ((lineItems ?? []) as Record<string, unknown>[])) {
      // Skip lines already allocated
      if (line.stock_unit_id) continue;

      const skuId = line.sku_id as string | null;
      if (!skuId) continue;

      // Get the SKU code for FIFO consumption
      const { data: skuRow } = await admin
        .from("sku")
        .select("sku_code")
        .eq("id", skuId)
        .single();

      if (!skuRow) {
        console.warn(`SKU not found for id ${skuId}, skipping line ${line.id}`);
        continue;
      }

      const skuCode = (skuRow as Record<string, unknown>).sku_code as string;

      // Call v2_consume_fifo_unit to get the oldest listed unit
      const { data: consumedUnit, error: fifoErr } = await admin
        .rpc("v2_consume_fifo_unit", { p_sku_code: skuCode });

      if (fifoErr) {
        console.warn(`FIFO consumption failed for ${skuCode}: ${fifoErr.message}`);
        continue;
      }

      if (!consumedUnit) {
        console.warn(`No listed units available for ${skuCode}`);
        continue;
      }

      const unit = consumedUnit as Record<string, unknown>;
      const unitId = unit.id as string;
      const landedCost = (unit.landed_cost as number) ?? 0;

      // Update order line with stock unit and COGS
      const { error: lineUpdateErr } = await admin
        .from("sales_order_line")
        .update({
          stock_unit_id: unitId,
          cogs: landedCost,
        })
        .eq("id", line.id);

      if (lineUpdateErr) {
        console.error(`Failed to update line ${line.id}: ${lineUpdateErr.message}`);
        continue;
      }

      // Link stock unit back to order
      const { error: unitUpdateErr } = await admin
        .from("stock_unit")
        .update({
          order_id: orderId,
        } as never)
        .eq("id", unitId);

      if (unitUpdateErr) {
        console.warn(`Failed to link unit ${unitId} to order: ${unitUpdateErr.message}`);
      }

      affectedSkus.add(skuCode);
      processedLines += 1;
      cogsTotal += landedCost;
    }

    // ─── 3. Recalculate variant stats for affected SKUs ─────
    for (const skuCode of affectedSkus) {
      const { error: statsErr } = await admin
        .rpc("v2_recalculate_variant_stats", { p_sku_code: skuCode });

      if (statsErr) {
        console.warn(`Failed to recalculate stats for ${skuCode}: ${statsErr.message}`);
      }
    }

    // ─── 4. Trigger QBO SalesReceipt sync ───────────────────
    if (processedLines > 0) {
      const supabaseFunctionsUrl = `${supabaseUrl}/functions/v1/qbo-sync-sales-receipt`;
      fetch(supabaseFunctionsUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify({ orderId }),
      }).catch((err) => {
        console.warn(`QBO sales receipt sync trigger failed (non-blocking): ${err}`);
      });
    }

    console.log(
      `v2-process-order: Processed ${processedLines} lines, ` +
      `${affectedSkus.size} SKUs affected, COGS total: £${cogsTotal.toFixed(2)}`
    );

    return new Response(
      JSON.stringify({
        success: true,
        orderId,
        processedLines,
        affectedSkus: Array.from(affectedSkus),
        cogsTotal: Math.round(cogsTotal * 100) / 100,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("v2-process-order error:", err);
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : "Unknown error",
      }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
