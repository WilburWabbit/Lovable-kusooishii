// Redeployed: 2026-04-13
// ============================================================
// V2 Reconcile Payout
// Matches a payout to orders, links stock units via payout_id,
// transitions eligible units to payout_received, and triggers
// QBO Deposit + Expense sync.
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

    // ─── Auth ────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.replace("Bearer ", "") || "";

    if (token !== serviceRoleKey) {
      const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      const { data: claims, error: claimsErr } = await userClient.auth.getUser(token);
      if (claimsErr || !claims?.user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const adminClient = createClient(supabaseUrl, serviceRoleKey);
      const { data: roles } = await adminClient
        .from("user_roles")
        .select("role")
        .eq("user_id", claims.user.id)
        .in("role", ["admin", "staff"]);
      if (!roles || roles.length === 0) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

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

    let orderIds = linkedOrderIds;

    // ─── Strict canonical matching ──────────────────────────
    // Only link a sales_order to a payout when its origin_reference
    // exactly matches a channel transaction's order_id for THIS payout.
    // No date-range fallbacks — they over-link unrelated orders.
    if (orderIds.length === 0) {
      const externalPayoutId = p.external_payout_id as string | null;
      const externalOrderIds: string[] = [];

      if (channel === "ebay" && externalPayoutId) {
        const { data: ebayTxns } = await admin
          .from("ebay_payout_transactions")
          .select("order_id")
          .eq("payout_id", externalPayoutId)
          .eq("transaction_type", "SALE")
          .not("order_id", "is", null);

        for (const t of ((ebayTxns ?? []) as { order_id: string | null }[])) {
          if (t.order_id) externalOrderIds.push(t.order_id);
        }
      }
      // Stripe: payout_orders are already linked by the Stripe webhook flow,
      // so the empty-orderIds case here means "nothing to do" rather than
      // "go searching by date" — same canonical rule applies.

      if (externalOrderIds.length > 0) {
        const channelFilter = channel === "stripe" ? "web" : channel;
        const { data: matchedOrders } = await admin
          .from("sales_order")
          .select("id, gross_total, origin_reference")
          .eq("origin_channel", channelFilter)
          .in("origin_reference", externalOrderIds);

        const links = ((matchedOrders ?? []) as Record<string, unknown>[]).map((o) => ({
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

    // ─── 2b. Late-match payout_fee rows ─────────────────────
    if (orderIds.length > 0) {
      const { data: externalIdRows } = await admin
        .from("sales_order")
        .select("id, origin_reference")
        .in("id", orderIds);

      type ExternalIdRow = { id: string; origin_reference: string | null };
      for (const row of ((externalIdRows ?? []) as ExternalIdRow[])) {
        if (!row.origin_reference) continue;
        await admin
          .from("payout_fee" as never)
          .update({ sales_order_id: row.id, updated_at: new Date().toISOString() } as never)
          .eq("payout_id" as never, payoutId)
          .eq("external_order_id" as never, row.origin_reference)
          .is("sales_order_id" as never, null);
      }
    }

    // ─── 2c. Populate payout_orders fee totals ──────────────
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

          const { error: economicsErr } = await admin
            .rpc("refresh_order_line_economics", { p_sales_order_id: soId });

          if (economicsErr) {
            console.warn(`Failed to refresh order economics for ${soId}: ${economicsErr.message}`);
          }
        }
      }
    }

    // ─── 3. Link & transition stock units ───────────────────
    // Set payout_id on ALL units for linked orders (regardless of status)
    // Then transition eligible ones (sold/shipped/delivered) to payout_received
    let totalUnitCount = 0;
    let unitsTransitioned = 0;

    if (orderIds.length > 0) {
      // 3a. Count all units for these orders
      const { count: allUnitsCount } = await admin
        .from("stock_unit")
        .select("id", { count: "exact", head: true })
        .in("order_id" as never, orderIds);

      totalUnitCount = allUnitsCount ?? 0;

      // 3b. Set payout_id on all units for these orders (idempotent)
      await admin
        .from("stock_unit")
        .update({ payout_id: payoutId } as never)
        .in("order_id" as never, orderIds)
        .is("payout_id" as never, null);

      // 3c. Transition eligible units to payout_received
      // Accept sold, shipped, delivered — these are all post-sale statuses
      const { data: transitioned, error: transErr } = await admin
        .from("stock_unit")
        .update({
          v2_status: "payout_received",
          payout_id: payoutId,
        } as never)
        .in("order_id" as never, orderIds)
        .in("v2_status" as never, ["sold", "shipped", "delivered"])
        .select("id");

      if (!transErr && transitioned) {
        unitsTransitioned = (transitioned as unknown[]).length;
      }
    }

    // ─── 4. Update payout record ────────────────────────────
    await admin
      .from("payouts")
      .update({
        order_count: orderIds.length,
        unit_count: totalUnitCount,
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
      `v2-reconcile-payout: ${orderIds.length} orders, ${totalUnitCount} units linked, ${unitsTransitioned} transitioned`
    );

    return new Response(
      JSON.stringify({
        success: true,
        payoutId,
        ordersLinked: orderIds.length,
        unitsLinked: totalUnitCount,
        unitsTransitioned,
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
