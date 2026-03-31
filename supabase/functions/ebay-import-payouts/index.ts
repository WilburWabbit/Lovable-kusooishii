// Redeployed: 2026-04-01
// ============================================================
// eBay Import Payouts
// Fetches payouts from eBay Finances API, stores individual
// transactions, matches to orders, and triggers reconciliation.
// Now with digital signatures, full transaction storage, and
// proper fee breakdown by category.
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";
import { getEbayAccessToken } from "../_shared/ebay-auth.ts";
import {
  EbayFinancesClient,
  EbayTransaction,
  aggregateFees,
  buildLegacyFeeBreakdown,
  extractFeeDetails,
} from "../_shared/ebay-finances.ts";

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

    // Auth check
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) throw new Error("Unauthorized");
    const token = authHeader.replace("Bearer ", "");

    if (token !== serviceRoleKey) {
      const { data: { user }, error: userError } = await admin.auth.getUser(token);
      if (userError || !user) throw new Error("Unauthorized");
    }

    const body = await req.json().catch(() => ({}));
    const dateFrom = (body as Record<string, unknown>).dateFrom as string | undefined;
    const dateTo = (body as Record<string, unknown>).dateTo as string | undefined;

    // Get eBay access token
    const accessToken = await getEbayAccessToken(admin);
    const client = new EbayFinancesClient(accessToken);

    // Determine date range
    const now = new Date();
    const startDate = dateFrom ?? new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const endDate = dateTo ?? now.toISOString();

    // Fetch payouts from eBay
    const payoutsResponse = await client.getPayouts({
      startDate,
      endDate,
      status: "SUCCEEDED",
      limit: 200,
    });

    const ebayPayouts = payoutsResponse.payouts ?? [];
    let imported = 0;
    let skipped = 0;

    for (const ep of ebayPayouts) {
      const externalId = ep.payoutId;
      if (!externalId) continue;

      // Check for duplicate
      const { data: existing } = await admin
        .from("payouts")
        .select("id")
        .eq("external_payout_id", externalId)
        .maybeSingle();

      if (existing) {
        skipped++;
        continue;
      }

      // Fetch ALL transactions for this payout (with pagination)
      const transactions = await client.getAllPayoutTransactions(externalId);

      // Aggregate fees by QBO account purpose
      const feesByPurpose = aggregateFees(transactions);
      const legacyFees = buildLegacyFeeBreakdown(feesByPurpose);
      const totalFees = Object.values(feesByPurpose).reduce((s, v) => s + v, 0);
      const totalFeesRounded = Math.round(totalFees * 100) / 100;

      // Calculate gross from transactions
      const netAmount = parseFloat(ep.amount.value);
      const grossAmount = Math.round((netAmount + totalFeesRounded) * 100) / 100;

      // Collect order references for matching
      const orderRefs: string[] = [];
      for (const txn of transactions) {
        if (txn.orderId && !orderRefs.includes(txn.orderId)) {
          orderRefs.push(txn.orderId);
        }
      }

      // Land raw payload for audit
      await admin
        .from("landing_raw_ebay_payout")
        .upsert({
          external_id: externalId,
          raw_payload: ep,
          status: "pending",
          correlation_id: crypto.randomUUID(),
          received_at: new Date().toISOString(),
        } as never, { onConflict: "external_id" as never });

      // Create payout record
      const { data: payoutRecord, error: insertErr } = await admin
        .from("payouts")
        .insert({
          channel: "ebay",
          payout_date: ep.payoutDate?.slice(0, 10) ?? now.toISOString().slice(0, 10),
          gross_amount: grossAmount,
          total_fees: totalFeesRounded,
          net_amount: Math.round(netAmount * 100) / 100,
          fee_breakdown: legacyFees,
          order_count: orderRefs.length,
          unit_count: 0,
          qbo_sync_status: "pending",
          external_payout_id: externalId,
          bank_reference: ep.bankReference ?? null,
          transaction_count: transactions.length,
        })
        .select()
        .single();

      if (insertErr) {
        console.error(`Failed to insert eBay payout ${externalId}:`, insertErr);
        continue;
      }

      const localPayoutId = (payoutRecord as Record<string, unknown>)?.id as string;

      // Match orders and store transactions
      let matchedCount = 0;
      let unmatchedCount = 0;

      // Bulk-fetch matching orders
      const orderMap = new Map<string, { id: string; qbo_sales_receipt_id: string | null }>();
      if (orderRefs.length > 0) {
        const { data: matchedOrders } = await admin
          .from("sales_order")
          .select("id, external_order_id, qbo_sales_receipt_id")
          .in("external_order_id", orderRefs);

        for (const o of (matchedOrders ?? []) as Record<string, unknown>[]) {
          orderMap.set(o.external_order_id as string, {
            id: o.id as string,
            qbo_sales_receipt_id: (o.qbo_sales_receipt_id as string) ?? null,
          });
        }
      }

      // Insert individual transactions
      const txnRecords = transactions.map((txn: EbayTransaction) => {
        const matchedOrder = txn.orderId ? orderMap.get(txn.orderId) : undefined;
        const isMatched = !!matchedOrder;
        if (isMatched) matchedCount++;
        else if (txn.transactionType === "SALE") unmatchedCount++;

        return {
          payout_id: externalId,
          transaction_id: txn.transactionId,
          transaction_type: txn.transactionType,
          transaction_status: txn.transactionStatus,
          transaction_date: txn.transactionDate,
          order_id: txn.orderId ?? null,
          buyer_username: txn.buyer?.username ?? null,
          gross_amount: parseFloat(txn.totalFeeBasisAmount?.value ?? txn.amount?.value ?? "0"),
          total_fees: Math.abs(parseFloat(txn.totalFeeAmount?.value ?? "0")),
          net_amount: parseFloat(txn.netAmount?.value ?? txn.amount?.value ?? "0"),
          currency: txn.amount?.currency ?? "GBP",
          fee_details: extractFeeDetails(txn),
          memo: txn.transactionMemo ?? null,
          matched_order_id: matchedOrder?.id ?? null,
          matched: isMatched,
          match_method: isMatched ? "auto_ebay_order_id" : null,
          qbo_sales_receipt_id: matchedOrder?.qbo_sales_receipt_id ?? null,
        };
      });

      if (txnRecords.length > 0) {
        const { error: txnErr } = await admin
          .from("ebay_payout_transactions" as never)
          .upsert(txnRecords as never, {
            onConflict: "transaction_id,transaction_type" as never,
          });

        if (txnErr) {
          console.error(`Failed to insert transactions for payout ${externalId}:`, txnErr);
        }
      }

      // Update payout with match counts
      await admin
        .from("payouts")
        .update({
          matched_order_count: matchedCount,
          unmatched_transaction_count: unmatchedCount,
        } as never)
        .eq("id", localPayoutId);

      // Link matched orders via payout_orders
      if (localPayoutId && orderMap.size > 0) {
        const links = Array.from(orderMap.values()).map((o) => ({
          payout_id: localPayoutId,
          sales_order_id: o.id,
        }));

        await admin
          .from("payout_orders")
          .upsert(links as never, { onConflict: "payout_id,sales_order_id" as never });
      }

      // Trigger reconciliation (fire-and-forget)
      if (localPayoutId) {
        fetch(`${supabaseUrl}/functions/v1/v2-reconcile-payout`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${serviceRoleKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ payoutId: localPayoutId }),
        }).catch(() => {});
      }

      // Update landing status
      await admin
        .from("landing_raw_ebay_payout")
        .update({ status: "committed", processed_at: new Date().toISOString() } as never)
        .eq("external_id", externalId);

      imported++;
    }

    console.log(`eBay payout import: ${imported} imported, ${skipped} skipped`);

    return new Response(
      JSON.stringify({
        success: true,
        imported,
        skipped,
        total: ebayPayouts.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("ebay-import-payouts error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
