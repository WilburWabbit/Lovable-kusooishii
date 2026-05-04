// Redeployed: 2026-04-05
// ============================================================
// eBay Import Payouts — Phase 1: Per-Sale Fee Attribution
//
// Base: main's refactored version (EbayFinancesClient, shared
//       utilities, digital signatures, pagination, ebay_payout_transactions)
//
// Added: per-order payout_fee + payout_fee_line writes that
//        power unit_profit_view for net margin calculations.
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";
import { verifyServiceRoleJWT } from "../_shared/auth.ts";
import { getEbayAccessToken } from "../_shared/ebay-auth.ts";
import {
  EbayFinancesClient,
  EbayTransaction,
  aggregateFees,
  buildLegacyFeeBreakdown,
  extractFeeDetails,
  type EbayReference,
} from "../_shared/ebay-finances.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// payout_fee uses business categories that are slightly different from
// main's QBO account-purpose mapping, so we map raw eBay fee types here.
const RAW_FEE_CATEGORY_MAP: Record<string, string> = {
  FINAL_VALUE_FEE: "selling_fee",
  FINAL_VALUE_FEE_FIXED_PER_ORDER: "selling_fee",
  FINAL_VALUE_FEE_SHIPPING: "selling_fee",
  INTERNATIONAL_FEE: "selling_fee",
  BELOW_STANDARD_FEE: "selling_fee",
  AD_FEE: "advertising",
  PROMOTED_LISTING_FEE: "advertising",
  SHIPPING_LABEL: "shipping_label",
  PAYMENT_DISPUTE_FEE: "other",
  PAYMENT_DISPUTE_REVERSAL: "other",
  NON_SALE_CHARGE: "other",
  REGULATORY_OPERATING_FEE: "other",
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

    if (!verifyServiceRoleJWT(token, supabaseUrl)) {
      const { data: { user }, error: userError } = await admin.auth.getUser(token);
      if (userError || !user) throw new Error("Unauthorized");
    }

    const body = await req.json().catch(() => ({}));
    const dateFrom = (body as Record<string, unknown>).dateFrom as string | undefined;
    const dateTo   = (body as Record<string, unknown>).dateTo   as string | undefined;

    // Get eBay access token and signing credentials
    const accessToken = await getEbayAccessToken(admin);
    const jwe = Deno.env.get("EBAY_SIGNING_KEY_JWE");
    const privateKey = Deno.env.get("EBAY_SIGNING_PRIVATE_KEY");
    if (!jwe || !privateKey) throw new Error("eBay signing credentials not configured (EBAY_SIGNING_KEY_JWE, EBAY_SIGNING_PRIVATE_KEY)");
    const client = new EbayFinancesClient(accessToken, jwe, privateKey);

    // Determine date range
    const now = new Date();
    const startDate = dateFrom ?? new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const endDate   = dateTo   ?? now.toISOString();

    // Fetch payouts from eBay
    const payoutsResponse = await client.getPayouts({
      startDate,
      endDate,
      status: "SUCCEEDED",
      limit: 200,
    });

    const ebayPayouts = payoutsResponse.payouts ?? [];
    let imported = 0;
    let skipped  = 0;

    for (const ep of ebayPayouts) {
      const externalId = ep.payoutId;
      if (!externalId) continue;

      // Skip duplicates
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

      // Aggregate fees by QBO account purpose (for legacy fee_breakdown)
      const feesByPurpose  = aggregateFees(transactions);
      const legacyFees     = buildLegacyFeeBreakdown(feesByPurpose);
      const totalFees      = Object.values(feesByPurpose).reduce((s, v) => s + v, 0);
      const totalFeesRounded = Math.round(totalFees * 100) / 100;

      // Calculate gross from transactions
      const netAmount  = parseFloat(ep.amount.value);
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
          external_id:    externalId,
          raw_payload:    ep,
          status:         "pending",
          correlation_id: crypto.randomUUID(),
          received_at:    new Date().toISOString(),
        } as never, { onConflict: "external_id" as never });

      // Create payout record
      const { data: payoutRecord, error: insertErr } = await admin
        .from("payouts")
        .insert({
          channel:             "ebay",
          payout_date:         ep.payoutDate?.slice(0, 10) ?? now.toISOString().slice(0, 10),
          gross_amount:        grossAmount,
          total_fees:          totalFeesRounded,
          net_amount:          Math.round(netAmount * 100) / 100,
          fee_breakdown:       legacyFees,
          order_count:         orderRefs.length,
          unit_count:          0,
          qbo_sync_status:     "pending",
          external_payout_id:  externalId,
          bank_reference:      ep.bankReference ?? null,
          transaction_count:   transactions.length,
        })
        .select()
        .single();

      if (insertErr) {
        console.error(`Failed to insert eBay payout ${externalId}:`, insertErr);
        continue;
      }

      const localPayoutId = (payoutRecord as Record<string, unknown>)?.id as string;
      if (!localPayoutId) continue;

      // ─── Match local orders ─────────────────────────────────────
      // Bulk-fetch matching orders once; reused by both transaction
      // records and payout_fee attribution below.
      type LocalOrder = { id: string; origin_reference: string; qbo_sales_receipt_id: string | null; gross_total: number | null };
      const orderMap = new Map<string, LocalOrder>();

      if (orderRefs.length > 0) {
        const { data: matchedOrders } = await admin
          .from("sales_order")
          .select("id, origin_reference, qbo_sales_receipt_id, gross_total")
          .in("origin_reference", orderRefs);

        for (const o of (matchedOrders ?? []) as LocalOrder[]) {
          orderMap.set(o.origin_reference, o);
        }
      }

      // ─── Store individual transactions ──────────────────────────
      let matchedCount   = 0;
      let unmatchedCount = 0;

      // ─── Resolve eBay item IDs for NON_SALE_CHARGE txns ────
      // Collect unique item_id references from NON_SALE_CHARGE transactions
      const itemIdRefs = new Map<string, string>(); // transactionId -> ebay item_id
      for (const txn of transactions) {
        if (txn.references && txn.references.length > 0) {
          const itemRef = txn.references.find(
            (r: EbayReference) => r.referenceType === "ITEM_ID" || r.referenceType === "item_id"
          );
          if (itemRef?.referenceId) {
            itemIdRefs.set(txn.transactionId, itemRef.referenceId);
          }
        }
      }

      // Bulk-resolve item IDs to channel_listing for insertion fee attribution
      const uniqueItemIds = [...new Set(itemIdRefs.values())];
      const listingByItemId = new Map<string, { sku_id: string | null; external_listing_id: string }>();
      if (uniqueItemIds.length > 0) {
        const { data: listings } = await admin
          .from("channel_listing")
          .select("external_listing_id, sku_id")
          .in("external_listing_id", uniqueItemIds);

        for (const cl of (listings ?? []) as { external_listing_id: string; sku_id: string | null }[]) {
          listingByItemId.set(cl.external_listing_id, cl);
        }
      }

      const txnRecords = transactions.map((txn: EbayTransaction) => {
        const matchedOrder = txn.orderId ? orderMap.get(txn.orderId) : undefined;
        const isMatched    = !!matchedOrder;
        if (isMatched) matchedCount++;
        else if (txn.transactionType === "SALE") unmatchedCount++;

        // Resolve ebay_item_id from references
        const ebayItemId = itemIdRefs.get(txn.transactionId) ?? null;

        return {
          payout_id:            externalId,
          transaction_id:       txn.transactionId,
          transaction_type:     txn.transactionType,
          transaction_status:   txn.transactionStatus,
          transaction_date:     txn.transactionDate,
          order_id:             txn.orderId ?? null,
          buyer_username:       txn.buyer?.username ?? null,
          gross_amount:         parseFloat(txn.totalFeeBasisAmount?.value ?? txn.amount?.value ?? "0"),
          total_fees:           Math.abs(parseFloat(txn.totalFeeAmount?.value ?? "0")),
          net_amount:           parseFloat(txn.netAmount?.value ?? txn.amount?.value ?? "0"),
          currency:             txn.amount?.currency ?? "GBP",
          fee_details:          extractFeeDetails(txn),
          memo:                 txn.transactionMemo ?? null,
          matched_order_id:     matchedOrder?.id ?? null,
          matched:              isMatched,
          match_method:         isMatched ? "auto_ebay_order_id" : null,
          qbo_sales_receipt_id: matchedOrder?.qbo_sales_receipt_id ?? null,
          ebay_item_id:         ebayItemId,
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
          matched_order_count:         matchedCount,
          unmatched_transaction_count: unmatchedCount,
        } as never)
        .eq("id", localPayoutId);

      // Link matched orders via payout_orders (gross/fees populated below)
      if (orderMap.size > 0) {
        const links = Array.from(orderMap.values()).map((o) => ({
          payout_id:      localPayoutId,
          sales_order_id: o.id,
          order_gross:    o.gross_total ?? 0,
        }));

        await admin
          .from("payout_orders")
          .upsert(links as never, { onConflict: "payout_id,sales_order_id" as never });
      }

      // ─── Phase 1: Per-order fee attribution ─────────────────────
      // Build per-order fee lines from transaction data, then write
      // payout_fee (one row per order+category) and payout_fee_line
      // (raw fee entries). This powers unit_profit_view.

      type FeeLine = { transactionId: string; feeType: string; feeCategory: string; amount: number };
      const orderFeeMap = new Map<string, FeeLine[]>();

      for (const txn of transactions) {
        // Fees embedded in SALE/REFUND orderLineItems
        if (txn.orderId) {
          const details = extractFeeDetails(txn);
          for (const fd of details) {
            if (fd.amount <= 0) continue;
            const category = RAW_FEE_CATEGORY_MAP[fd.feeType] ?? "other";
            if (!orderFeeMap.has(txn.orderId)) orderFeeMap.set(txn.orderId, []);
            orderFeeMap.get(txn.orderId)!.push({
              transactionId: txn.transactionId,
              feeType:       fd.feeType,
              feeCategory:   category,
              amount:        fd.amount,
            });
          }
        }

        // SHIPPING_LABEL transactions — the transaction amount is the cost.
        // Link to the order if orderId is present; otherwise unlinked.
        if (txn.transactionType === "SHIPPING_LABEL") {
          const amt = Math.abs(parseFloat(txn.amount?.value ?? "0"));
          if (amt > 0) {
            const key = txn.orderId ?? "__unlinked__";
            if (!orderFeeMap.has(key)) orderFeeMap.set(key, []);
            orderFeeMap.get(key)!.push({
              transactionId: txn.transactionId,
              feeType:       "SHIPPING_LABEL",
              feeCategory:   "shipping_label",
              amount:        amt,
            });
          }
        }
      }

      // Write payout_fee + payout_fee_line for each order
      for (const [externalOrderId, lines] of orderFeeMap.entries()) {
        const isUnlinked   = externalOrderId === "__unlinked__";
        const localOrder   = isUnlinked ? null : (orderMap.get(externalOrderId) ?? null);
        const salesOrderId = localOrder?.id ?? null;

        // Group lines by category for the payout_fee rows
        const categoryTotals = new Map<string, number>();
        for (const line of lines) {
          categoryTotals.set(
            line.feeCategory,
            (categoryTotals.get(line.feeCategory) ?? 0) + line.amount,
          );
        }

        let orderTotalFees = 0;

        for (const [category, categoryTotal] of categoryTotals.entries()) {
          if (categoryTotal <= 0) continue;

          const roundedAmount = Math.round(categoryTotal * 10000) / 10000;
          orderTotalFees += roundedAmount;

          const { data: pfRow, error: pfErr } = await admin
            .from("payout_fee" as never)
            .insert({
              payout_id:         localPayoutId,
              sales_order_id:    salesOrderId,
              external_order_id: isUnlinked ? null : externalOrderId,
              fee_category:      category,
              amount:            roundedAmount,
              channel:           "ebay",
            } as never)
            .select("id")
            .single();

          if (pfErr) {
            console.warn(
              `payout_fee insert failed for order ${externalOrderId} category ${category}:`,
              pfErr,
            );
            continue;
          }

          const pfId = (pfRow as Record<string, unknown>)?.id as string;
          if (!pfId) continue;

          // Insert raw fee lines for audit trail
          const categoryLines = lines
            .filter((l) => l.feeCategory === category)
            .map((l) => ({
              payout_fee_id:       pfId,
              ebay_transaction_id: l.transactionId || null,
              fee_type:            l.feeType,
              fee_category:        l.feeCategory,
              amount:              Math.round(l.amount * 10000) / 10000,
            }));

          if (categoryLines.length > 0) {
            await admin
              .from("payout_fee_line" as never)
              .insert(categoryLines as never);
          }
        }

        // Update payout_orders with fee totals for matched orders
        if (salesOrderId) {
          const roundedFees = Math.round(orderTotalFees * 100) / 100;
          const orderGross  = Math.round((localOrder?.gross_total ?? 0) * 100) / 100;
          const orderNet    = Math.round((orderGross - roundedFees) * 100) / 100;

          await admin
            .from("payout_orders")
            .upsert({
              payout_id:      localPayoutId,
              sales_order_id: salesOrderId,
              order_gross:    orderGross,
              order_fees:     roundedFees,
              order_net:      orderNet,
            } as never, { onConflict: "payout_id,sales_order_id" as never });

          const { error: economicsErr } = await admin
            .rpc("refresh_order_line_economics", { p_sales_order_id: salesOrderId });

          if (economicsErr) {
            console.warn(`Failed to refresh order economics for ${salesOrderId}: ${economicsErr.message}`);
          }

          const { error: accountingErr } = await admin
            .rpc("record_order_accounting_events", {
              p_sales_order_id: salesOrderId,
              p_source: "ebay_import_payouts",
            });

          if (accountingErr) {
            console.warn(`Failed to refresh accounting events for ${salesOrderId}: ${accountingErr.message}`);
          }

          const { error: settlementErr } = await admin
            .rpc("refresh_order_settlement_lines", {
              p_sales_order_id: salesOrderId,
              p_rebuild_cases: true,
            });

          if (settlementErr) {
            console.warn(`Failed to refresh settlement lines for ${salesOrderId}: ${settlementErr.message}`);
          }
        }
      }

      for (const order of orderMap.values()) {
        const salesOrderId = order.id as string;
        const { error: settlementErr } = await admin
          .rpc("refresh_order_settlement_lines", {
            p_sales_order_id: salesOrderId,
            p_rebuild_cases: true,
          });

        if (settlementErr) {
          console.warn(`Failed to refresh settlement lines for ${salesOrderId}: ${settlementErr.message}`);
        }
      }

      // ─── Trigger reconciliation (fire-and-forget) ───────────────
      fetch(`${supabaseUrl}/functions/v1/v2-reconcile-payout`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${serviceRoleKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ payoutId: localPayoutId }),
      }).catch(() => {});

      // Mark landing record as committed
      await admin
        .from("landing_raw_ebay_payout")
        .update({ status: "committed", processed_at: new Date().toISOString() } as never)
        .eq("external_id", externalId);

      imported++;
    }

    console.log(`eBay payout import: ${imported} imported, ${skipped} skipped`);

    return new Response(
      JSON.stringify({
        success:  true,
        imported,
        skipped,
        total:    ebayPayouts.length,
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
