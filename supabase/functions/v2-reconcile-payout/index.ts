// Redeployed: 2026-04-05
// ============================================================
// V2 Reconcile Payout
// Matches a payout to orders, transitions stock units to
// payout_received, and triggers QBO Deposit + Expense sync.
// Called by Stripe webhook, eBay import, or admin UI.
//
// Phase 1 additions:
//   2b. Late-match payout_fee rows to orders that were imported
//       after the payout (fees arrived first, order came later).
//   2c. Populate payout_orders.order_fees / order_net from
//       payout_fee aggregate once linkage is established.
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

    const { payoutId } = await req.json();
    if (!payoutId) throw new Error("payoutId is required");

    console.log(`v2-reconcile-payout: Reconciling payout ${payoutId}`);

    // ─── 1. Fetch payout ────────────────────────────────────
    const { data: payout, error: payoutErr } = await admin
      .from("payouts")
      .select("*")
      .eq("id", payoutId)
      .single();

    if (payoutErr || !payout) throw new Error(`Payout not found: ${payoutId}`);
    const p = payout as Record<string, unknown>;
    const channel = p.channel as string;

    // ─── 2. Find linked orders ──────────────────────────────
    const { data: payoutOrderLinks } = await admin
      .from("payout_orders")
      .select("sales_order_id")
      .eq("payout_id", payoutId);

    const linkedOrderIds = ((payoutOrderLinks ?? []) as Record<string, unknown>[])
      .map((po) => po.sales_order_id as string);

    // If no orders linked yet, try to match by channel + recent date range
    let orderIds = linkedOrderIds;
    if (orderIds.length === 0) {
      const payoutDate = p.payout_date as string;
      // Look for delivered orders on this channel in the last 14 days
      const lookbackDate = new Date(new Date(payoutDate).getTime() - 14 * 24 * 60 * 60 * 1000)
        .toISOString().slice(0, 10);

      const channelFilter = channel === "stripe" ? "web" : channel;
      const { data: matchedOrders } = await admin
        .from("sales_order")
        .select("id, gross_total")
        .eq("origin_channel", channelFilter)
        .gte("created_at", lookbackDate)
        .lte("created_at", payoutDate + "T23:59:59Z");

      if (matchedOrders) {
        // Link matched orders
        const links = ((matchedOrders) as Record<string, unknown>[]).map((o) => ({
          payout_id: payoutId,
          sales_order_id: o.id as string,
          order_gross: (o.gross_total as number) ?? 0,
        }));

        if (links.length > 0) {
          await admin
            .from("payout_orders")
            .upsert(links as never, { onConflict: "payout_id,sales_order_id" as never });
        }

        orderIds = links.map((l) => l.sales_order_id);
      }
    }

    // ─── 2b. Late-match payout_fee rows ────────────────────────
    // Fees may have arrived before the order record existed.
    // Now that we have orderIds, link any unmatched payout_fee rows
    // for this payout by matching external_order_id → local sales_order.id.
    if (orderIds.length > 0) {
      const { data: externalIdRows } = await admin
        .from("sales_order")
        .select("id, external_order_id")
        .in("id", orderIds);

      type ExternalIdRow = { id: string; external_order_id: string | null };
      for (const row of ((externalIdRows ?? []) as ExternalIdRow[])) {
        if (!row.external_order_id) continue;

        await admin
          .from("payout_fee" as never)
          .update({ sales_order_id: row.id, updated_at: new Date().toISOString() } as never)
          .eq("payout_id" as never, payoutId)
          .eq("external_order_id" as never, row.external_order_id)
          .is("sales_order_id" as never, null);
      }
    }

    // ─── 2c. Populate payout_orders fee totals ──────────────
    // Aggregate payout_fee by order and write order_fees / order_net
    // back to payout_orders. Safe to run on every reconciliation —
    // upsert is idempotent.
    if (orderIds.length > 0) {
      const { data: feeRows } = await admin
        .from("payout_fee" as never)
        .select("sales_order_id, amount")
        .eq("payout_id" as never, payoutId)
        .in("sales_order_id" as never, orderIds);

      type FeeRow = { sales_order_id: string; amount: number };
      const orderFeeTotals = new Map<string, number>();
      for (const r of ((feeRows ?? []) as FeeRow[])) {
        orderFeeTotals.set(
          r.sales_order_id,
          (orderFeeTotals.get(r.sales_order_id) ?? 0) + r.amount,
        );
      }

      if (orderFeeTotals.size > 0) {
        // Fetch gross totals for update
        const { data: grossRows } = await admin
          .from("payout_orders")
          .select("sales_order_id, order_gross")
          .eq("payout_id", payoutId)
          .in("sales_order_id", [...orderFeeTotals.keys()]);

        type GrossRow = { sales_order_id: string; order_gross: number | null };
        const grossMap = new Map<string, number>();
        for (const g of ((grossRows ?? []) as GrossRow[])) {
          grossMap.set(g.sales_order_id, g.order_gross ?? 0);
        }

        for (const [soId, feeTotal] of orderFeeTotals.entries()) {
          const roundedFees = Math.round(feeTotal * 100) / 100;
          const orderGross  = grossMap.get(soId) ?? 0;
          const orderNet    = Math.round((orderGross - roundedFees) * 100) / 100;

          await admin
            .from("payout_orders")
            .update({
              order_fees: roundedFees,
              order_net:  orderNet,
            } as never)
            .eq("payout_id", payoutId)
            .eq("sales_order_id", soId);
        }
      }
    }

    // ─── 3. Transition stock units to payout_received ───────
    let unitCount = 0;
    if (orderIds.length > 0) {
      const { data: units, error: unitErr } = await admin
        .from("stock_unit")
        .update({
          v2_status: "payout_received",
          payout_id: payoutId,
        } as never)
        .in("order_id" as never, orderIds)
        .eq("v2_status" as never, "delivered")
        .select("id");

      if (!unitErr && units) {
        unitCount = (units as unknown[]).length;
      }
    }

    // ─── 4. Update payout record ────────────────────────────
    await admin
      .from("payouts")
      .update({
        order_count: orderIds.length,
        unit_count: unitCount,
        reconciliation_status: "reconciled",
        updated_at: new Date().toISOString(),
      } as never)
      .eq("id", payoutId);

    // ─── 5. Trigger QBO sync ────────────────────────────────
    if ((p.qbo_sync_status as string) !== "synced") {
      fetch(`${supabaseUrl}/functions/v1/qbo-sync-payout`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${serviceRoleKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ payoutId }),
      }).catch((err) => {
        console.warn("QBO payout sync trigger failed (non-blocking):", err);
      });
    }

    console.log(
      `v2-reconcile-payout: ${orderIds.length} orders, ${unitCount} units → payout_received`
    );

    return new Response(
      JSON.stringify({
        success: true,
        payoutId,
        ordersLinked: orderIds.length,
        unitsTransitioned: unitCount,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("v2-reconcile-payout error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
