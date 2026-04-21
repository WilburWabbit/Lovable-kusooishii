// ============================================================
// eBay PayoutAdapter
// ============================================================
// Loads transactions from `ebay_payout_transactions`, applies
// eBay-specific TRANSFER ↔ NON_SALE_CHARGE settlement detection,
// resolves QBO ItemRef for insertion-fee NON_SALE_CHARGEs.
// ============================================================

import type {
  PayoutAdapter,
  NeutralPayoutTx,
  NeutralFeeDetail,
  AdapterDeps,
  SettlementClassification,
} from "../../_shared/payout-adapter.ts";

const EBAY_VENDOR_REF = { value: "4", name: "eBay" };

/** Map eBay fee category → qbo_account_mapping.purpose. */
function mapFeeAccount(feeCategory: string): string {
  // Today the eBay path lumps everything to either selling_fees or
  // subscription_fees. NON_SALE_CHARGE handling is special-cased in
  // describeExpense / explicit branch — keep parity with current logic.
  // Granular per-feeType QBO accounts can be added later without
  // touching the core.
  return "selling_fees";
}

export const ebayAdapter: PayoutAdapter = {
  channel: "ebay",
  qboVendorRef: EBAY_VENDOR_REF,

  feeAccountPurpose: mapFeeAccount,

  async loadTransactions(deps: AdapterDeps): Promise<NeutralPayoutTx[]> {
    const { admin, externalPayoutId } = deps;
    if (!externalPayoutId) {
      throw new Error("Payout has no external_payout_id — cannot look up eBay transactions");
    }

    const { data, error } = await admin
      .from("ebay_payout_transactions")
      .select("id, transaction_id, transaction_type, order_id, gross_amount, total_fees, net_amount, fee_details, matched_order_id, qbo_purchase_id, memo, buyer_username, ebay_item_id")
      .eq("payout_id", externalPayoutId);

    if (error) throw new Error(`Failed to fetch eBay transactions: ${error.message}`);

    return ((data ?? []) as Record<string, unknown>[]).map((row): NeutralPayoutTx => {
      const rawFees = (row.fee_details ?? []) as Array<Record<string, unknown>>;
      const feeDetails: NeutralFeeDetail[] = rawFees.map((f) => {
        const amt = typeof f.amount === "number"
          ? f.amount
          : parseFloat(((f.amount as Record<string, unknown> | undefined)?.value as string) ?? "0");
        return {
          feeType: String(f.feeType ?? "unknown"),
          amount: amt,
          currency: typeof f.currency === "string" ? f.currency : "GBP",
        };
      });
      // eBay native types are kept verbatim — the core branches on them.
      const txType = String(row.transaction_type) as NeutralPayoutTx["transactionType"];
      return {
        id: String(row.id),
        transactionId: String(row.transaction_id),
        transactionType: txType,
        grossAmount: Number(row.gross_amount ?? 0),
        totalFees: Number(row.total_fees ?? 0),
        netAmount: Number(row.net_amount ?? 0),
        externalOrderId: (row.order_id as string | null) ?? null,
        matchedOrderId: (row.matched_order_id as string | null) ?? null,
        feeDetails,
        memo: (row.memo as string | null) ?? null,
        externalItemId: (row.ebay_item_id as string | null) ?? null,
        qboPurchaseId: (row.qbo_purchase_id as string | null) ?? null,
      };
    });
  },

  classifyTransactions(allTxs: NeutralPayoutTx[]): SettlementClassification {
    // TRANSFER transactions on eBay tell us that a same-amount
    // NON_SALE_CHARGE was settled out-of-band (paid directly from the
    // bank, never debited from Undeposited Funds). Pair them up by
    // |amount| so repeating values aren't double-matched.
    const transferAmountCounts = new Map<string, number>();
    for (const t of allTxs) {
      // The TRANSFER rows are filtered OUT before this is called by the
      // core (they aren't expensable), but we receive the full set here
      // via the adapter — see core.ts.
      if (t.transactionType as string === "TRANSFER") {
        const key = Math.abs(t.grossAmount).toFixed(2);
        transferAmountCounts.set(key, (transferAmountCounts.get(key) ?? 0) + 1);
      }
    }
    const settledTxIds = new Set<string>();
    for (const t of allTxs) {
      if ((t.transactionType as string) !== "NON_SALE_CHARGE") continue;
      const key = Math.abs(t.grossAmount).toFixed(2);
      const remaining = transferAmountCounts.get(key) ?? 0;
      if (remaining > 0) {
        settledTxIds.add(t.id);
        transferAmountCounts.set(key, remaining - 1);
      }
    }
    return { settledTxIds };
  },

  async resolveItemRef(tx: NeutralPayoutTx, deps: AdapterDeps) {
    // Insertion-fee NON_SALE_CHARGEs book against the QBO Item for the
    // listing so they are queryable by listing reference in QBO.
    const isInsertion = (tx.transactionType as string) === "NON_SALE_CHARGE" &&
      tx.externalItemId &&
      (tx.memo ?? "").toLowerCase().includes("insertion fee");
    if (!isInsertion || !tx.externalItemId) return undefined;

    const { admin } = deps;
    const { data: listingRows } = await admin
      .from("channel_listing")
      .select("external_listing_id, sku_id")
      .eq("external_listing_id", tx.externalItemId)
      .limit(1);

    const listing = (listingRows ?? [])[0] as { external_listing_id: string; sku_id: string | null } | undefined;
    if (!listing?.sku_id) return undefined;

    const { data: skus } = await admin
      .from("sku")
      .select("qbo_item_id")
      .eq("id", listing.sku_id)
      .maybeSingle();
    const qboId = (skus as { qbo_item_id?: string | null } | null)?.qbo_item_id;
    return qboId ? { value: qboId } : undefined;
  },

  expenseDocNumber(tx: NeutralPayoutTx, orderNumber: string | null): string | undefined {
    if ((tx.transactionType as string) === "SALE") return orderNumber ?? undefined;
    if ((tx.transactionType as string) === "NON_SALE_CHARGE" &&
        tx.externalItemId &&
        (tx.memo ?? "").toLowerCase().includes("insertion fee")) {
      return tx.externalItemId;
    }
    return undefined;
  },
};
