// ============================================================
// eBay Finances API Client
// Wraps getPayouts, getTransactions, getPayout with digital
// signatures and pagination support.
// ============================================================

import { generateDigitalSignatureHeaders } from "./ebay-digital-signatures.ts";

const EBAY_FINANCES_BASE = "https://apiz.ebay.com/sell/finances/v1";

// ─── Types ──────────────────────────────────────────────────

export interface EbayAmount {
  value: string;
  currency: string;
}

export interface EbayFee {
  feeType: string;
  amount: EbayAmount;
}

export interface EbayOrderLineItem {
  lineItemId: string;
  feeBasisAmount?: EbayAmount;
  fees?: EbayFee[];
  marketplaceFees?: EbayFee[];
}

export interface EbayTransaction {
  transactionId: string;
  transactionType: string;
  transactionStatus: string;
  amount: EbayAmount;
  totalFeeBasisAmount?: EbayAmount;
  totalFeeAmount?: EbayAmount;
  netAmount?: EbayAmount;
  payoutId?: string;
  orderId?: string;
  orderLineItems?: EbayOrderLineItem[];
  buyer?: { username: string };
  transactionDate: string;
  transactionMemo?: string;
}

export interface EbayPayout {
  payoutId: string;
  payoutStatus: string;
  payoutStatusDescription?: string;
  amount: EbayAmount;
  payoutDate: string;
  payoutInstrument?: {
    instrumentType: string;
    nickname?: string;
  };
  transactionCount: number;
  bankReference?: string;
}

interface PayoutsResponse {
  payouts: EbayPayout[];
  total: number;
  limit: number;
  offset: number;
}

interface TransactionsResponse {
  transactions: EbayTransaction[];
  total: number;
  limit: number;
  offset: number;
}

// ─── Fee Account Mapping ────────────────────────────────────

/** Maps eBay fee types to QBO account mapping purpose keys */
export const FEE_ACCOUNT_MAP: Record<string, string> = {
  FINAL_VALUE_FEE: "ebay_selling_fees",
  FINAL_VALUE_FEE_FIXED_PER_ORDER: "ebay_selling_fees",
  AD_FEE: "ebay_advertising",
  PROMOTED_LISTING_FEE: "ebay_advertising",
  INTERNATIONAL_FEE: "ebay_international_fees",
  REGULATORY_OPERATING_FEE: "ebay_regulatory_fees",
  BELOW_STANDARD_FEE: "ebay_selling_fees",
};

// ─── Client ─────────────────────────────────────────────────

export class EbayFinancesClient {
  private accessToken: string;

  constructor(accessToken: string) {
    this.accessToken = accessToken;
  }

  /** Fetch payouts with optional date range and status filter. */
  async getPayouts(filters: {
    startDate?: string;
    endDate?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }): Promise<PayoutsResponse> {
    const filterParts: string[] = [];
    if (filters.startDate && filters.endDate) {
      filterParts.push(`payoutDate:[${filters.startDate}..${filters.endDate}]`);
    }
    if (filters.status) {
      filterParts.push(`payoutStatus:{${filters.status}}`);
    }

    const params = new URLSearchParams();
    if (filterParts.length > 0) params.set("filter", filterParts.join("&filter="));
    if (filters.limit) params.set("limit", String(filters.limit));
    if (filters.offset) params.set("offset", String(filters.offset));
    params.set("sort", "payoutDate");

    const path = `/sell/finances/v1/payout?${params.toString()}`;
    return this.get<PayoutsResponse>(path);
  }

  /** Fetch a single payout by ID. */
  async getPayout(payoutId: string): Promise<EbayPayout> {
    const path = `/sell/finances/v1/payout/${payoutId}`;
    return this.get<EbayPayout>(path);
  }

  /** Fetch transactions with filters. */
  async getTransactions(filters: {
    payoutId?: string;
    transactionType?: string;
    startDate?: string;
    endDate?: string;
    limit?: number;
    offset?: number;
  }): Promise<TransactionsResponse> {
    const filterParts: string[] = [];
    if (filters.payoutId) {
      filterParts.push(`payoutId:{${filters.payoutId}}`);
    }
    if (filters.transactionType) {
      filterParts.push(`transactionType:{${filters.transactionType}}`);
    }
    if (filters.startDate && filters.endDate) {
      filterParts.push(`transactionDate:[${filters.startDate}..${filters.endDate}]`);
    }

    const params = new URLSearchParams();
    if (filterParts.length > 0) params.set("filter", filterParts.join("&filter="));
    params.set("limit", String(filters.limit ?? 1000));
    if (filters.offset) params.set("offset", String(filters.offset));

    const path = `/sell/finances/v1/transaction?${params.toString()}`;
    return this.get<TransactionsResponse>(path);
  }

  /** Paginate through ALL transactions for a payout. */
  async getAllPayoutTransactions(payoutId: string): Promise<EbayTransaction[]> {
    const all: EbayTransaction[] = [];
    let offset = 0;
    const limit = 1000;

    while (true) {
      const res = await this.getTransactions({ payoutId, limit, offset });
      all.push(...(res.transactions ?? []));
      if (all.length >= res.total || (res.transactions ?? []).length === 0) break;
      offset += limit;
    }

    return all;
  }

  private async get<T>(path: string): Promise<T> {
    const url = `${EBAY_FINANCES_BASE}${path.replace("/sell/finances/v1", "")}`;
    const sigHeaders = await generateDigitalSignatureHeaders("GET", path.split("?")[0]);

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        Accept: "application/json",
        ...sigHeaders,
      },
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`eBay Finances API error [${res.status}]: ${errorText}`);
    }

    return res.json();
  }
}

// ─── Fee Aggregation ────────────────────────────────────────

/**
 * Aggregate fees from a list of transactions, grouped by QBO account purpose.
 * Returns { "ebay_selling_fees": 31.20, "ebay_advertising": 8.50, ... }
 */
export function aggregateFees(
  transactions: EbayTransaction[],
): Record<string, number> {
  const totals: Record<string, number> = {};

  for (const txn of transactions) {
    // Fees from SALE/REFUND transactions (embedded in orderLineItems)
    if (txn.orderLineItems) {
      for (const lineItem of txn.orderLineItems) {
        for (const fee of lineItem.fees ?? []) {
          const amount = Math.abs(parseFloat(fee.amount.value));
          if (amount === 0) continue;
          const key = FEE_ACCOUNT_MAP[fee.feeType] ?? "ebay_other_costs";
          totals[key] = (totals[key] ?? 0) + amount;
        }
      }
    }

    // SHIPPING_LABEL transactions — the transaction amount itself is the cost
    if (txn.transactionType === "SHIPPING_LABEL") {
      const amount = Math.abs(parseFloat(txn.amount.value));
      if (amount > 0) {
        totals["ebay_shipping_labels"] = (totals["ebay_shipping_labels"] ?? 0) + amount;
      }
    }
  }

  // Round all to 2dp
  for (const key of Object.keys(totals)) {
    totals[key] = Math.round(totals[key] * 100) / 100;
  }

  return totals;
}

/**
 * Build the legacy 4-field fee breakdown for backward compat with existing payouts table.
 */
export function buildLegacyFeeBreakdown(
  feesByPurpose: Record<string, number>,
): { fvf: number; promoted_listings: number; international: number; processing: number } {
  return {
    fvf: (feesByPurpose["ebay_selling_fees"] ?? 0),
    promoted_listings: (feesByPurpose["ebay_advertising"] ?? 0),
    international: (feesByPurpose["ebay_international_fees"] ?? 0),
    processing:
      (feesByPurpose["ebay_regulatory_fees"] ?? 0) +
      (feesByPurpose["ebay_shipping_labels"] ?? 0) +
      (feesByPurpose["ebay_other_costs"] ?? 0),
  };
}

/**
 * Extract fee details array from a single transaction's orderLineItems.
 */
export function extractFeeDetails(txn: EbayTransaction): Array<{ feeType: string; amount: number }> {
  const fees: Array<{ feeType: string; amount: number }> = [];
  for (const lineItem of txn.orderLineItems ?? []) {
    for (const fee of lineItem.fees ?? []) {
      fees.push({
        feeType: fee.feeType,
        amount: Math.abs(parseFloat(fee.amount.value)),
      });
    }
  }
  return fees;
}
