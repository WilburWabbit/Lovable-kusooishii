// ============================================================
// Stripe PayoutAdapter
// ============================================================
// Stripe has no per-payout transaction table. Each row in
// `payout_orders` IS the SALE transaction, and each row in
// `payout_fee` IS the per-charge processing fee.
//
// We synthesise NeutralPayoutTx rows from those two tables so the
// channel-agnostic core in `core.ts` can drive the QBO sync exactly
// as it does for eBay.
// ============================================================

import type {
  PayoutAdapter,
  NeutralPayoutTx,
  NeutralFeeDetail,
  AdapterDeps,
} from "../../_shared/payout-adapter.ts";

// Stripe is vendor "Stripe" in QBO. Resolved at call-time via
// qbo_account_mapping fallback if not explicitly set; we hardcode a
// reasonable default and let the operator override.
// QBO Vendor for Stripe (resolved from public.vendor where display_name='Stripe').
// If you change the Stripe vendor in QBO, update this id.
const STRIPE_VENDOR_REF = { value: "431", name: "Stripe" };

export const stripeAdapter: PayoutAdapter = {
  channel: "stripe",
  qboVendorRef: STRIPE_VENDOR_REF,

  feeAccountPurpose(_feeCategory: string): string {
    // Try a Stripe-specific account first; the core falls back to
    // `selling_fees` if no mapping row exists with this purpose.
    return "stripe_processing_fees";
  },

  async loadTransactions(deps: AdapterDeps): Promise<NeutralPayoutTx[]> {
    const { admin, payoutId } = deps;

    // 1. Load matched orders (one SALE tx per linked order).
    const { data: poRows, error: poErr } = await admin
      .from("payout_orders")
      .select("sales_order_id, order_gross")
      .eq("payout_id", payoutId);
    if (poErr) throw new Error(`Failed to fetch payout_orders: ${poErr.message}`);

    const salesOrderIds = ((poRows ?? []) as Array<{ sales_order_id: string }>)
      .map((r) => r.sales_order_id);

    type SO = {
      id: string;
      gross_total: number | null;
      origin_reference: string | null;
      payment_reference: string | null;
    };
    let orders: SO[] = [];
    if (salesOrderIds.length > 0) {
      const { data, error } = await admin
        .from("sales_order")
        .select("id, gross_total, origin_reference, payment_reference")
        .in("id", salesOrderIds);
      if (error) throw new Error(`Failed to fetch sales_orders: ${error.message}`);
      orders = (data ?? []) as SO[];
    }

    const grossBySoId = new Map<string, number>();
    for (const r of (poRows ?? []) as Array<{ sales_order_id: string; order_gross: number | null }>) {
      grossBySoId.set(r.sales_order_id, Number(r.order_gross ?? 0));
    }

    // 2. Load per-order fees.
    const { data: feeRows, error: feeErr } = await admin
      .from("payout_fee")
      .select("id, sales_order_id, external_order_id, fee_category, amount, channel, description, qbo_purchase_id")
      .eq("payout_id", payoutId);
    if (feeErr) throw new Error(`Failed to fetch payout_fee: ${feeErr.message}`);

    type Fee = {
      id: string;
      sales_order_id: string | null;
      external_order_id: string | null;
      fee_category: string;
      amount: number;
      description: string | null;
      qbo_purchase_id: string | null;
    };
    const fees = ((feeRows ?? []) as Fee[]);

    // Bucket fees by sales_order_id (or by external_order_id if unmatched)
    const feesBySoId = new Map<string, Fee[]>();
    const feesByExtId = new Map<string, Fee[]>();
    for (const f of fees) {
      if (f.sales_order_id) {
        const list = feesBySoId.get(f.sales_order_id) ?? [];
        list.push(f);
        feesBySoId.set(f.sales_order_id, list);
      } else if (f.external_order_id) {
        const list = feesByExtId.get(f.external_order_id) ?? [];
        list.push(f);
        feesByExtId.set(f.external_order_id, list);
      }
    }

    // 3. Build SALE transactions from matched orders.
    const txs: NeutralPayoutTx[] = [];
    for (const so of orders) {
      const gross = grossBySoId.get(so.id) ?? Number(so.gross_total ?? 0);
      const matchedFees = (feesBySoId.get(so.id) ?? []) as Fee[];
      // Late-bind fees that were stored against external_order_id only
      // (e.g. Stripe pi_… stored on `external_order_id` but the
      // sales_order link was set later).
      if (matchedFees.length === 0 && so.payment_reference) {
        const orphan = feesByExtId.get(so.payment_reference) ?? [];
        matchedFees.push(...orphan);
      }
      const totalFees = matchedFees.reduce((s, f) => s + Number(f.amount ?? 0), 0);

      // Use the first fee row's qbo_purchase_id as the cache key (one
      // Stripe charge → one fee → one Purchase).
      const cachedPurchaseId = matchedFees.find((f) => f.qbo_purchase_id)?.qbo_purchase_id ?? null;

      txs.push({
        id: `so:${so.id}`,
        transactionId: so.payment_reference ?? so.origin_reference ?? so.id,
        transactionType: "SALE",
        grossAmount: gross,
        totalFees: Math.round(totalFees * 100) / 100,
        netAmount: Math.round((gross - totalFees) * 100) / 100,
        externalOrderId: so.payment_reference ?? so.origin_reference,
        matchedOrderId: so.id,
        feeDetails: matchedFees.map((f) => ({
          feeType: f.fee_category,
          amount: Number(f.amount ?? 0),
        })),
        memo: matchedFees[0]?.description ?? null,
        externalItemId: null,
        qboPurchaseId: cachedPurchaseId,
      });
    }

    // 4. Surface unmatched fees (rare: account-level Stripe charges that
    // aren't tied to an order). Book them as ACCOUNT_CHARGE expenses.
    const unmatchedFees = fees.filter((f) => !f.sales_order_id &&
      !(f.external_order_id && orders.some((o) => o.payment_reference === f.external_order_id)));
    for (const f of unmatchedFees) {
      txs.push({
        id: `fee:${f.id}`,
        transactionId: f.external_order_id ?? f.id,
        transactionType: "ACCOUNT_CHARGE",
        grossAmount: -Math.abs(Number(f.amount ?? 0)),
        totalFees: 0,
        netAmount: -Math.abs(Number(f.amount ?? 0)),
        externalOrderId: f.external_order_id,
        matchedOrderId: null,
        feeDetails: [{ feeType: f.fee_category, amount: Number(f.amount ?? 0) }],
        memo: f.description,
        externalItemId: null,
        qboPurchaseId: f.qbo_purchase_id,
      });
    }

    return txs;
  },

  // Stripe has no out-of-band TRANSFER concept — default classification
  // (no settlements) is correct, so we omit `classifyTransactions`.

  async persistPurchaseId(deps: AdapterDeps, tx: NeutralPayoutTx, qboPurchaseId: string | null) {
    // Stripe stores the QBO Purchase id on every payout_fee row tied to
    // this synthesised SALE/ACCOUNT_CHARGE transaction. For SALE rows the
    // tx.id is `so:<sales_order_id>`; for ACCOUNT_CHARGE it is `fee:<fee_id>`.
    const { admin, payoutId } = deps;

    if (tx.id.startsWith("fee:")) {
      const feeId = tx.id.slice(4);
      await admin
        .from("payout_fee")
        .update({ qbo_purchase_id: qboPurchaseId })
        .eq("id", feeId);
      return;
    }

    if (tx.id.startsWith("so:") && tx.matchedOrderId) {
      // Update every payout_fee row for this payout linked to this order
      // (by sales_order_id, or by external_order_id matching the payment_reference).
      const orFilter = tx.externalOrderId
        ? `sales_order_id.eq.${tx.matchedOrderId},external_order_id.eq.${tx.externalOrderId}`
        : `sales_order_id.eq.${tx.matchedOrderId}`;
      await admin
        .from("payout_fee")
        .update({ qbo_purchase_id: qboPurchaseId })
        .eq("payout_id", payoutId)
        .or(orFilter);
    }
  },

  describeFeeLine(tx: NeutralPayoutTx, fee: NeutralFeeDetail, channel: string): string {
    return `${channel} ${(fee.feeType ?? "fee").replace(/_/g, " ")} — order ${tx.externalOrderId ?? tx.transactionId}`;
  },

  buildPrivateNote(tx: NeutralPayoutTx, channel: string, externalPayoutId: string | null): string {
    return `${channel} payout ${externalPayoutId} — ${tx.transactionType} ${tx.externalOrderId ?? tx.transactionId}`;
  },
};
