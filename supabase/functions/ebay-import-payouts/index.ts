// Redeployed: 2026-04-05
// ============================================================
// eBay Import Payouts — Phase 1: Per-Sale Fee Attribution
//
// Changes from previous version:
//   - Transaction loop now builds a per-order fee map instead
//     of only aggregating into a single feeBreakdown blob.
//   - Inserts payout_fee (one row per order+category) and
//     payout_fee_line (raw eBay fee lines for audit).
//   - Populates payout_orders.order_fees and .order_net.
//   - payouts.fee_breakdown is kept for backward compatibility
//     but is now a derived aggregate; payout_fee is authoritative.
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const EBAY_API = "https://api.ebay.com";

// ─── Fee Type Mappings ──────────────────────────────────────────────────────
//
// Legacy: coarse 4-bucket aggregate kept for payouts.fee_breakdown (QBO sync reads this)
// New:    granular category for payout_fee (per-sale attribution)
//
// Both maps are keyed on the raw eBay feeType string.

/** Maps eBay feeType → legacy payouts.fee_breakdown key */
const LEGACY_FEE_MAP: Record<string, keyof typeof DEFAULT_FEE_BREAKDOWN> = {
  FINAL_VALUE_FEE:               "fvf",
  FINAL_VALUE_FEE_FIXED_PER_ORDER: "fvf",
  FINAL_VALUE_FEE_SHIPPING:      "fvf",
  AD_FEE:                        "promoted_listings",
  PROMOTED_LISTING_FEE:          "promoted_listings",
  INTERNATIONAL_FEE:             "international",
  // All else → "processing" (includes shipping labels, disputes, etc.)
};

/** Maps eBay feeType → payout_fee.fee_category */
const FEE_CATEGORY_MAP: Record<string, string> = {
  FINAL_VALUE_FEE:               "selling_fee",
  FINAL_VALUE_FEE_FIXED_PER_ORDER: "selling_fee",
  FINAL_VALUE_FEE_SHIPPING:      "selling_fee",
  INTERNATIONAL_FEE:             "selling_fee",  // international component of FVF
  AD_FEE:                        "advertising",
  PROMOTED_LISTING_FEE:          "advertising",
  SHIPPING_LABEL:                "shipping_label",
  PAYMENT_DISPUTE_FEE:           "other",
  PAYMENT_DISPUTE_REVERSAL:      "other",
  NON_SALE_CHARGE:               "other",
  // All else → "other"
};

const DEFAULT_FEE_BREAKDOWN = {
  fvf: 0,
  promoted_listings: 0,
  international: 0,
  processing: 0,
};

// ─── Types ──────────────────────────────────────────────────────────────────

interface FeeLine {
  transactionId: string;
  feeType: string;
  feeCategory: string;
  amount: number; // always positive
}

/** Per-order fee accumulator built during transaction processing */
interface OrderFeeAccumulator {
  lines: FeeLine[];
  // category → total (derived from lines on write)
}

// ─── Entry Point ────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRoleKey);

    // Auth check — allow service role or authenticated user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) throw new Error("Unauthorized");
    const token = authHeader.replace("Bearer ", "");

    if (token !== serviceRoleKey) {
      const { data: { user }, error: userError } = await admin.auth.getUser(token);
      if (userError || !user) throw new Error("Unauthorized");
    }

    const body = await req.json().catch(() => ({}));
    const dateFrom = (body as Record<string, unknown>).dateFrom as string | undefined;
    const dateTo   = (body as Record<string, unknown>).dateTo   as string | undefined;

    // Get eBay access token
    const { data: ebayAuth } = await admin
      .from("ebay_auth_tokens" as never)
      .select("access_token, expires_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!ebayAuth) throw new Error("No eBay auth token found. Connect eBay first.");

    const accessToken = (ebayAuth as Record<string, unknown>).access_token as string;

    // Build date filter
    const now = new Date();
    const fromDate = dateFrom ?? new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const toDate   = dateTo   ?? now.toISOString();

    // Fetch payouts from eBay Finances API
    const payoutsUrl =
      `${EBAY_API}/sell/finances/v1/payout?filter=payoutDate:[${fromDate}..${toDate}]&limit=50&sort=payoutDate`;

    const payoutsRes = await fetch(payoutsUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });

    if (!payoutsRes.ok) {
      const errorText = await payoutsRes.text();
      throw new Error(`eBay Finances API error [${payoutsRes.status}]: ${errorText}`);
    }

    const payoutsData  = await payoutsRes.json();
    const ebayPayouts  = (payoutsData.payouts ?? []) as Record<string, unknown>[];

    let imported = 0;
    let skipped  = 0;

    for (const ep of ebayPayouts) {
      const externalId = ep.payoutId as string;
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

      // Extract net amount (eBay returns amounts as { value, currency })
      const payoutAmount = ep.amount as Record<string, unknown> | null;
      const netAmount    = parseFloat((payoutAmount?.value as string) ?? "0");
      const payoutDate   = (ep.payoutDate as string)?.slice(0, 10) ?? now.toISOString().slice(0, 10);

      // ─── Fetch and process transactions ────────────────────────────────────
      // We need per-transaction fee detail to attribute fees to individual orders.
      // The eBay Finances API returns: transaction.orderId + transaction.orderLineItems[].fees[]
      //
      // We build two parallel structures:
      //   feeBreakdown    — legacy aggregate for payouts.fee_breakdown (QBO sync)
      //   orderFeeMap     — per-order fee lines for payout_fee / payout_fee_line

      const feeBreakdown = { ...DEFAULT_FEE_BREAKDOWN };
      let grossAmount    = netAmount;
      let totalFees      = 0;

      // externalOrderId → accumulator
      const orderFeeMap = new Map<string, OrderFeeAccumulator>();

      try {
        // Paginate if needed — limit=100 covers most payouts (eBay max is 200)
        const txnUrl =
          `${EBAY_API}/sell/finances/v1/transaction?filter=payoutId:{${externalId}}&limit=100`;
        const txnRes = await fetch(txnUrl, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json",
          },
        });

        if (txnRes.ok) {
          const txnData      = await txnRes.json();
          const transactions = (txnData.transactions ?? []) as Record<string, unknown>[];

          for (const txn of transactions) {
            const orderId        = txn.orderId        as string | undefined;
            const transactionId  = txn.transactionId  as string ?? "";

            const orderLineItems = (txn.orderLineItems ?? []) as Record<string, unknown>[];

            for (const oli of orderLineItems) {
              // eBay API inconsistency: fees may be at oli.fees OR oli.feeBasisAmount
              const rawFees = (Array.isArray(oli.fees) ? oli.fees : []) as Record<string, unknown>[];

              for (const fee of rawFees) {
                const feeType   = fee.feeType as string;
                const feeAmount = Math.abs(
                  parseFloat(((fee.amount as Record<string, unknown>)?.value as string) ?? "0"),
                );

                if (!feeType || feeAmount <= 0) continue;

                // ── Legacy aggregate (kept for payouts.fee_breakdown) ──
                const legacyKey = LEGACY_FEE_MAP[feeType] ?? "processing";
                feeBreakdown[legacyKey] += feeAmount;
                totalFees += feeAmount;

                // ── Per-order fee line (new) ──
                if (orderId) {
                  if (!orderFeeMap.has(orderId)) {
                    orderFeeMap.set(orderId, { lines: [] });
                  }
                  orderFeeMap.get(orderId)!.lines.push({
                    transactionId,
                    feeType,
                    feeCategory: FEE_CATEGORY_MAP[feeType] ?? "other",
                    amount: feeAmount,
                  });
                }
              }
            }
          }

          grossAmount = netAmount + totalFees;
        }
      } catch (txnErr) {
        console.warn(`Failed to fetch transactions for payout ${externalId}:`, txnErr);
      }

      // Round legacy aggregate
      feeBreakdown.fvf               = Math.round(feeBreakdown.fvf               * 100) / 100;
      feeBreakdown.promoted_listings = Math.round(feeBreakdown.promoted_listings * 100) / 100;
      feeBreakdown.international     = Math.round(feeBreakdown.international     * 100) / 100;
      feeBreakdown.processing        = Math.round(feeBreakdown.processing        * 100) / 100;
      totalFees                      = Math.round(totalFees                      * 100) / 100;
      grossAmount                    = Math.round(grossAmount                    * 100) / 100;

      // ─── Land raw payload ──────────────────────────────────────────────────
      await admin
        .from("landing_raw_ebay_payout")
        .upsert(
          {
            external_id:    externalId,
            raw_payload:    ep,
            status:         "pending",
            correlation_id: crypto.randomUUID(),
            received_at:    new Date().toISOString(),
          } as never,
          { onConflict: "external_id" as never },
        );

      // ─── Create payout record ──────────────────────────────────────────────
      const { data: payoutRecord, error: insertErr } = await admin
        .from("payouts")
        .insert({
          channel:             "ebay",
          payout_date:         payoutDate,
          gross_amount:        grossAmount,
          total_fees:          totalFees,
          net_amount:          Math.round(netAmount * 100) / 100,
          fee_breakdown:       feeBreakdown,       // legacy aggregate — kept for QBO sync
          order_count:         orderFeeMap.size,
          unit_count:          0,                  // populated by v2-reconcile-payout
          qbo_sync_status:     "pending",
          external_payout_id:  externalId,
        })
        .select()
        .single();

      if (insertErr) {
        console.error(`Failed to insert eBay payout ${externalId}:`, insertErr);
        continue;
      }

      const localPayoutId = (payoutRecord as Record<string, unknown>)?.id as string;
      if (!localPayoutId) continue;

      // ─── Per-order fee attribution ─────────────────────────────────────────
      // Match external eBay order IDs to local sales_order records, then write
      // payout_fee + payout_fee_line rows and populate payout_orders with fee totals.

      if (orderFeeMap.size > 0) {
        const externalOrderIds = [...orderFeeMap.keys()];

        // Fetch local orders by eBay order ID
        const { data: matchedOrders } = await admin
          .from("sales_order")
          .select("id, external_order_id, gross_total")
          .in("external_order_id", externalOrderIds);

        // Build lookup: externalOrderId → { localId, grossTotal }
        type LocalOrder = { id: string; external_order_id: string; gross_total: number };
        const localOrderMap = new Map<string, LocalOrder>();
        for (const o of ((matchedOrders ?? []) as LocalOrder[])) {
          localOrderMap.set(o.external_order_id, o);
        }

        for (const [externalOrderId, acc] of orderFeeMap.entries()) {
          const localOrder   = localOrderMap.get(externalOrderId) ?? null;
          const salesOrderId = localOrder?.id ?? null;

          // ── Group lines by category ──────────────────────────────────────
          const categoryTotals = new Map<string, number>();
          for (const line of acc.lines) {
            categoryTotals.set(
              line.feeCategory,
              (categoryTotals.get(line.feeCategory) ?? 0) + line.amount,
            );
          }

          let orderTotalFees = 0;

          // ── Insert one payout_fee row per category ──────────────────────
          for (const [category, categoryTotal] of categoryTotals.entries()) {
            if (categoryTotal <= 0) continue;

            const roundedAmount = Math.round(categoryTotal * 10000) / 10000;
            orderTotalFees += roundedAmount;

            const { data: pfRow, error: pfErr } = await admin
              .from("payout_fee" as never)
              .insert({
                payout_id:         localPayoutId,
                sales_order_id:    salesOrderId,
                external_order_id: externalOrderId,
                fee_category:      category,
                amount:            roundedAmount,
                channel:           "ebay",
              } as never)
              .select("id")
              .single();

            if (pfErr) {
              console.error(
                `Failed to insert payout_fee for order ${externalOrderId} category ${category}:`,
                pfErr,
              );
              continue;
            }

            const pfId = (pfRow as Record<string, unknown>)?.id as string;
            if (!pfId) continue;

            // ── Insert raw fee lines for audit ──────────────────────────
            const linesForCategory = acc.lines
              .filter((l) => l.feeCategory === category)
              .map((l) => ({
                payout_fee_id:       pfId,
                ebay_transaction_id: l.transactionId || null,
                fee_type:            l.feeType,
                fee_category:        l.feeCategory,
                amount:              Math.round(l.amount * 10000) / 10000,
              }));

            if (linesForCategory.length > 0) {
              const { error: lineErr } = await admin
                .from("payout_fee_line" as never)
                .insert(linesForCategory as never);

              if (lineErr) {
                console.warn(
                  `Failed to insert payout_fee_lines for payout_fee ${pfId}:`,
                  lineErr,
                );
              }
            }
          }

          // ── Upsert payout_orders with fee totals ─────────────────────
          // Only upsert if we have a local order to link to.
          // Unmatched orders (no local record yet) will be linked by
          // v2_link_unmatched_payout_fees() after order import.
          if (salesOrderId) {
            const orderGross   = Math.round((localOrder?.gross_total ?? 0) * 100) / 100;
            const roundedFees  = Math.round(orderTotalFees * 100) / 100;
            const orderNet     = Math.round((orderGross - roundedFees) * 100) / 100;

            const { error: poErr } = await admin
              .from("payout_orders")
              .upsert(
                {
                  payout_id:      localPayoutId,
                  sales_order_id: salesOrderId,
                  order_gross:    orderGross,
                  order_fees:     roundedFees,
                  order_net:      orderNet,
                } as never,
                { onConflict: "payout_id,sales_order_id" as never },
              );

            if (poErr) {
              console.warn(
                `Failed to upsert payout_orders for order ${salesOrderId}:`,
                poErr,
              );
            }
          }
        }
      }

      // ─── Trigger reconciliation (non-blocking) ─────────────────────────────
      fetch(`${supabaseUrl}/functions/v1/v2-reconcile-payout`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${serviceRoleKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ payoutId: localPayoutId }),
      }).catch(() => {});

      // ─── Mark landing record as committed ─────────────────────────────────
      await admin
        .from("landing_raw_ebay_payout")
        .update({ status: "committed", processed_at: new Date().toISOString() } as never)
        .eq("external_id", externalId);

      imported++;
    }

    console.log(`eBay payout import: ${imported} imported, ${skipped} skipped (duplicates)`);

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
