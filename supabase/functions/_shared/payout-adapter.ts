// ============================================================
// PayoutAdapter — channel-agnostic contract for payout → QBO sync
// ============================================================
//
// Each sales channel (eBay, Stripe, BrickLink, Etsy, …) implements
// this interface. The QBO sync core (`qbo-sync-payout/core.ts`) reads
// only from neutral payout tables (`payouts`, `payout_orders`,
// `payout_fee`) and from the adapter — it has no per-channel
// knowledge.
//
// To add a new channel:
//   1. Land payout + per-order linkage + per-order fee rows in the
//      neutral tables (channel-specific webhook/import function).
//   2. Implement `PayoutAdapter` in
//      `qbo-sync-payout/adapters/<channel>.ts` and register it in
//      `adapters/registry.ts`.
//   3. Done. No other code changes.
//
// See `docs/v2/PAYOUT_ADAPTER_CONTRACT.md` for full guidance.

// ─── Neutral types the QBO core operates on ──────────────────

/**
 * One transaction in a payout that the QBO core may need to act on.
 *
 * For SALE rows the core links a deposit line to the existing QBO
 * SalesReceipt. For everything else the core creates a QBO Purchase
 * (expense) using `feeAccountPurpose`.
 */
export type NeutralPayoutTx = {
  /** Stable per-channel id; used as idempotency key. */
  id: string;
  /** Channel-native transaction id (memo / display). */
  transactionId: string;
  transactionType:
    | "SALE"
    | "SHIPPING_LABEL"
    | "REFUND"
    | "DISPUTE"
    | "ACCOUNT_CHARGE"
    | "PROCESSING_FEE";
  /** GROSS amount in major units (e.g. £). Negative for outflows. */
  grossAmount: number;
  /** Total fees on this transaction (positive). */
  totalFees: number;
  /** Net = gross - fees, in major units. */
  netAmount: number;
  /** External order id (channel-native, e.g. eBay orderId / Stripe pi_…). */
  externalOrderId: string | null;
  /** App `sales_order.id` if matched. */
  matchedOrderId: string | null;
  /** Fee detail breakdown attached to this transaction. */
  feeDetails: NeutralFeeDetail[];
  /** Free-text memo from the channel. */
  memo: string | null;
  /** Channel-native item id (e.g. eBay item) if applicable. */
  externalItemId: string | null;
  /** Existing QBO Purchase id if previously synced. */
  qboPurchaseId: string | null;
};

export type NeutralFeeDetail = {
  /** Channel-native fee category (FINAL_VALUE_FEE, stripe_processing, …). */
  feeType: string;
  /** Positive amount in major units. */
  amount: number;
  currency?: string;
};

/** Neutral matched-order shape used by the deposit builder. */
export type NeutralMatchedOrder = {
  salesOrderId: string;
  orderNumber: string | null;
  /** Origin reference on `sales_order` (e.g. eBay orderId / Stripe pi_…). */
  originReference: string | null;
  /** customer.id on the sales_order (resolved to QBO ref by the core). */
  customerId: string | null;
  qboSalesReceiptId: string | null;
  /** Channel-recorded gross — canonical for this historical sale. */
  channelGross: number;
  /** Tx id from `NeutralPayoutTx.id` used for cross-references. */
  txId: string;
  /** Channel-native transaction id (e.g. eBay tx id, Stripe pi_…). */
  transactionId: string;
};

/** Result of `classifyTransactions` — defaults to no settlement detection. */
export type SettlementClassification = {
  /** Tx ids that were settled out-of-band (e.g. eBay TRANSFER) and must
   *  book to bank rather than Undeposited Funds and be excluded from the
   *  deposit. */
  settledTxIds: Set<string>;
};

/**
 * The contract every channel implements.
 */
export interface PayoutAdapter {
  /** Stable channel name. */
  channel: "ebay" | "stripe" | "bricklink" | "brickowl" | "etsy" | string;

  /** QBO Vendor reference for expenses booked against this channel. */
  qboVendorRef: { value: string; name: string };

  /**
   * Map a fee category to a `qbo_account_mapping.purpose`.
   * Return a fallback purpose (e.g. `selling_fees`) if you have no
   * channel-specific account configured — the core will still sync.
   */
  feeAccountPurpose(feeCategory: string): string;

  /**
   * Load all transactions for this payout. Channels with their own
   * tx tables (eBay → `ebay_payout_transactions`) read from there.
   * Channels without a tx table (Stripe) synthesise rows from
   * `payout_orders` + `payout_fee`.
   */
  loadTransactions(deps: AdapterDeps): Promise<NeutralPayoutTx[]>;

  /**
   * Optional. Classify special channel-specific settlement patterns
   * (e.g. eBay TRANSFER ↔ NON_SALE_CHARGE pairing). Default: no
   * settlements detected.
   */
  classifyTransactions?(txs: NeutralPayoutTx[]): SettlementClassification;

  /** Optional. Customise the QBO Purchase description for a fee row. */
  describeExpense?(tx: NeutralPayoutTx, feeIndex: number): string;

  /** Optional. Customise the QBO Purchase DocNumber. */
  expenseDocNumber?(tx: NeutralPayoutTx, orderNumber: string | null): string | undefined;

  /** Optional. Resolve a QBO ItemRef for fee lines that should book to an
   *  Item rather than an Account (e.g. eBay insertion fees). */
  resolveItemRef?(tx: NeutralPayoutTx, deps: AdapterDeps): Promise<{ value: string; name?: string } | undefined>;

  /**
   * Persist the QBO Purchase id back to the channel's own storage so it is
   * idempotent on retry. eBay updates `ebay_payout_transactions`; Stripe
   * updates `payout_fee`. Called once per successfully synced transaction.
   * Pass `qboPurchaseId = "N/A"` for tx that need no expense line.
   */
  persistPurchaseId(deps: AdapterDeps, tx: NeutralPayoutTx, qboPurchaseId: string): Promise<void>;

  /**
   * Build the QBO Purchase line description for a given fee inside a
   * transaction. Defaults to a generic `${channel} ${feeType} — ${transactionId}`.
   */
  describeFeeLine?(tx: NeutralPayoutTx, fee: NeutralFeeDetail, channel: string): string;

  /**
   * Build the per-transaction QBO Purchase PrivateNote. Defaults to a
   * generic format.
   */
  buildPrivateNote?(tx: NeutralPayoutTx, channel: string, externalPayoutId: string | null, settledViaTransfer: boolean): string;
}

/** Dependencies passed to adapter methods. */
export type AdapterDeps = {
  admin: any; // Supabase service-role client
  payoutId: string;
  externalPayoutId: string | null;
  payoutDate: string;
  payoutNet: number;
  payoutGross: number;
  payoutFees: number;
};
