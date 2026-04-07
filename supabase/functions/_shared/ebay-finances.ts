/**
 * Shared eBay Finances API client and fee utilities.
 */

import { signEbayRequest } from "./ebay-digital-signature.ts";

export interface EbayAmount {
  value: string;
  currency?: string;
}

export interface EbayFee {
  feeType: string;
  amount: EbayAmount;
}

export interface EbayBuyer {
  username?: string;
}

export interface EbayTransaction {
  transactionId: string;
  transactionType: string;
  transactionStatus: string;
  transactionDate: string;
  orderId?: string;
  buyer?: EbayBuyer;
  amount?: EbayAmount;
  totalFeeBasisAmount?: EbayAmount;
  totalFeeAmount?: EbayAmount;
  netAmount?: EbayAmount;
  orderLineItems?: Array<{
    feeBasisAmount?: EbayAmount;
    totalFeeBasisAmount?: EbayAmount;
    marketplaceFees?: EbayFee[];
  }>;
  transactionMemo?: string;
}

// QBO account-purpose mapping for fee aggregation
const FEE_PURPOSE_MAP: Record<string, string> = {
  FINAL_VALUE_FEE: "ebay_selling_fees",
  FINAL_VALUE_FEE_FIXED_PER_ORDER: "ebay_selling_fees",
  FINAL_VALUE_FEE_SHIPPING: "ebay_selling_fees",
  INTERNATIONAL_FEE: "ebay_selling_fees",
  BELOW_STANDARD_FEE: "ebay_selling_fees",
  AD_FEE: "ebay_ad_fees",
  PROMOTED_LISTING_FEE: "ebay_ad_fees",
  SHIPPING_LABEL: "ebay_shipping",
  PAYMENT_DISPUTE_FEE: "ebay_other_fees",
  PAYMENT_DISPUTE_REVERSAL: "ebay_other_fees",
  NON_SALE_CHARGE: "ebay_other_fees",
  REGULATORY_OPERATING_FEE: "ebay_other_fees",
};

// ── Fee Extraction ───────────────────────────────────────────

export interface FeeDetail {
  feeType: string;
  amount: number;
  currency: string;
}

export function extractFeeDetails(txn: EbayTransaction): FeeDetail[] {
  const details: FeeDetail[] = [];
  for (const line of txn.orderLineItems ?? []) {
    for (const fee of line.marketplaceFees ?? []) {
      const amount = Math.abs(parseFloat(fee.amount?.value ?? "0"));
      if (amount > 0) {
        details.push({
          feeType: fee.feeType,
          amount,
          currency: fee.amount?.currency ?? "GBP",
        });
      }
    }
  }
  return details;
}

// ── Fee Aggregation ──────────────────────────────────────────

export function aggregateFees(transactions: EbayTransaction[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const txn of transactions) {
    const fees = extractFeeDetails(txn);
    for (const fee of fees) {
      const purpose = FEE_PURPOSE_MAP[fee.feeType] ?? "ebay_other_fees";
      totals[purpose] = (totals[purpose] ?? 0) + fee.amount;
    }
    // Include SHIPPING_LABEL transaction amounts as fees
    if (txn.transactionType === "SHIPPING_LABEL") {
      const amt = Math.abs(parseFloat(txn.amount?.value ?? "0"));
      if (amt > 0) {
        totals["ebay_shipping"] = (totals["ebay_shipping"] ?? 0) + amt;
      }
    }
  }
  return totals;
}

export function buildLegacyFeeBreakdown(feesByPurpose: Record<string, number>): Record<string, number> {
  const breakdown: Record<string, number> = {};
  for (const [purpose, total] of Object.entries(feesByPurpose)) {
    breakdown[purpose] = Math.round(total * 100) / 100;
  }
  return breakdown;
}

// ── Finances API Client ──────────────────────────────────────

export class EbayFinancesClient {
  private accessToken: string;
  private baseUrl = "https://apiz.ebay.com/sell/finances/v1";

  constructor(accessToken: string) {
    this.accessToken = accessToken;
  }

  private async get(path: string, params: Record<string, string> = {}): Promise<any> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`eBay Finances API ${path} failed [${res.status}]: ${body}`);
    }
    return res.json();
  }

  async getPayouts(opts: {
    startDate: string;
    endDate: string;
    status?: string;
    limit?: number;
  }): Promise<{ payouts: any[] }> {
    const filters: string[] = [];
    filters.push(`payoutDate:[${opts.startDate}..${opts.endDate}]`);
    if (opts.status) filters.push(`payoutStatus:{${opts.status}}`);

    const data = await this.get("/payout", {
      filter: filters.join(","),
      limit: String(opts.limit ?? 200),
      sort: "payoutDate",
    });
    return { payouts: data.payouts ?? [] };
  }

  async getAllPayoutTransactions(payoutId: string): Promise<EbayTransaction[]> {
    const allTransactions: EbayTransaction[] = [];
    let offset = 0;
    const limit = 200;

    while (true) {
      const data = await this.get("/transaction", {
        filter: `payoutId:{${payoutId}}`,
        limit: String(limit),
        offset: String(offset),
      });

      const transactions = data.transactions ?? [];
      allTransactions.push(...transactions);

      if (transactions.length < limit || allTransactions.length >= (data.total ?? 0)) {
        break;
      }
      offset += limit;
    }

    return allTransactions;
  }
}
