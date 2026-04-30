// Redeployed: 2026-03-23
// ============================================================
// V2 Process Order — Compatibility Post-Order Hook
// Retained for older/manual callers. New order flows perform these
// steps directly in their domain handlers.
//   1. Domain allocation via allocate_stock_for_order_line()
//   2. COGS/cost-event recording on order line items
//   3. v2_status lifecycle tracking
//   4. Compatibility SKU cost rollup refresh
//   5. QBO posting-intent queueing
//
// Idempotent: skips lines that already have stock_unit_id.
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";
import { pushEbayQuantityForSkus } from "../_shared/ebay-inventory-sync.ts";

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

    // Auth: require service-role or admin/staff user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const token = authHeader.replace("Bearer ", "");
    if (token !== serviceRoleKey) {
      const { data: { user }, error: authErr } = await admin.auth.getUser(token);
      if (authErr || !user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", user.id);
      const hasAccess = (roles ?? []).some((r: { role: string }) => r.role === "admin" || r.role === "staff");
      if (!hasAccess) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

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
    const affectedSkuIds = new Set<string>();
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

      const { data: allocation, error: allocationErr } = await admin
        .rpc("allocate_stock_for_order_line", { p_sales_order_line_id: line.id });

      if (allocationErr) {
        console.warn(`Allocation failed for ${skuCode}: ${allocationErr.message}`);
        continue;
      }

      const allocationResult = allocation as Record<string, unknown> | null;
      if (!allocationResult || allocationResult.status !== "allocated") {
        console.warn(`No listed units available for ${skuCode}`);
        continue;
      }

      affectedSkus.add(skuCode);
      affectedSkuIds.add(skuId);
      processedLines += 1;
      cogsTotal += (allocationResult.cogs_amount as number) ?? 0;
    }

    const { error: economicsErr } = await admin
      .rpc("refresh_order_line_economics", { p_sales_order_id: orderId });

    if (economicsErr) {
      console.warn(`Failed to refresh order economics for ${orderId}: ${economicsErr.message}`);
    }

    // ─── 2b. Queue updated stock counts to eBay (non-blocking) ──
    // We just consumed units; eBay's available quantity needs to drop
    // through the listing outbox so the same unit cannot sell twice.
    if (affectedSkuIds.size > 0) {
      pushEbayQuantityForSkus(admin, affectedSkuIds, {
        source: "v2-process-order",
        orderId,
      }).catch((err) =>
        console.warn(`eBay quantity sync queue failed (non-blocking): ${err}`),
      );
    }

    // ─── 3. Refresh compatibility SKU cost rollups ──────────
    for (const skuId of affectedSkuIds) {
      const { error: rollupErr } = await admin
        .rpc("refresh_sku_cost_rollups", { p_sku_id: skuId });

      if (rollupErr) {
        console.warn(`Failed to refresh SKU cost rollup for ${skuId}: ${rollupErr.message}`);
      }
    }

    // ─── 4. Queue QBO posting intent ────────────────────────
    if (processedLines > 0) {
      const { error: postingIntentErr } = await admin
        .rpc("queue_qbo_posting_intents_for_order", { p_sales_order_id: orderId });

      if (postingIntentErr) {
        console.warn(`Failed to queue QBO posting intent for ${orderId}: ${postingIntentErr.message}`);
      } else {
        fetch(`${supabaseUrl}/functions/v1/accounting-posting-intents-process`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${serviceRoleKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ batchSize: 10 }),
        }).catch((err) => {
          console.warn(`posting intent processor trigger failed (non-blocking): ${err}`);
        });
      }
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
