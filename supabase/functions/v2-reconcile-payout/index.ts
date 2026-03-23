// ============================================================
// V2 Reconcile Payout
// Matches a payout to orders, transitions stock units to
// payout_received, and triggers QBO Deposit + Expense sync.
// Called by Stripe webhook, eBay import, or admin UI.
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
