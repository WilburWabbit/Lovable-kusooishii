// ============================================================
// Shared Pricing Utilities (Deno-compatible)
// VAT-aware floor price calculation used by both the pricing
// engine (admin-data) and auto-markdown.
// ============================================================

const VAT_RATE = 0.2;
const VAT_MULTIPLIER = 1 + VAT_RATE; // 1.2

export interface FeeScheduleRow {
  rate_percent: number | null;
  fixed_amount: number | null;
  applies_to: string;
  min_amount: number | null;
  max_amount: number | null;
}

export interface FloorPriceParams {
  /** Ex-VAT cost base: carrying_value + packaging + shipping */
  costBase: number;
  /** Minimum absolute profit required */
  minProfit: number;
  /** Aggregated percentage fee rate (decimal, e.g. 0.15 for 15%) */
  effectiveFeeRate: number;
  /** Aggregated fixed fee costs (gross) */
  fixedFeeCosts: number;
  /** Risk reserve rate (decimal) */
  riskRate: number;
  /** Minimum margin target (decimal, e.g. 0.15 for 15%) */
  minMargin: number;
  /** Raw fee schedule rows for iterative post-check */
  fees: FeeScheduleRow[];
  /** Estimated shipping cost (ex-VAT) */
  shippingCost: number;
}

/**
 * Calculate a VAT-aware floor price.
 *
 * The key insight: when selling at gross price P, the business only
 * keeps P/1.2 as revenue (output VAT goes to HMRC). Similarly,
 * fees charged on that price have reclaimable input VAT, so the
 * real fee cost is also /1.2.
 *
 * Equation:
 *   P/1.2 - margin×(P/1.2) - feeRate×(P/1.2) - risk×(P/1.2) >= costBase + minProfit + fixedFees/1.2
 *   P/1.2 × (1 - margin - feeRate - risk) >= costBase + minProfit + fixedFees/1.2
 *   P >= 1.2 × (costBase + minProfit + fixedFees/1.2) / (1 - margin - feeRate - risk)
 */
export function calculateFloorPrice(params: FloorPriceParams): number {
  const {
    costBase,
    minProfit,
    effectiveFeeRate,
    fixedFeeCosts,
    riskRate,
    minMargin,
    fees,
    shippingCost,
  } = params;

  const effectiveMargin = Math.max(minMargin, 0.01);
  const netFixedFees = fixedFeeCosts / VAT_MULTIPLIER;
  const denominator = Math.max(1 - effectiveMargin - effectiveFeeRate - riskRate, 0.05);

  // Initial floor: solve the equation for P
  let floorPrice = Math.round(
    (VAT_MULTIPLIER * (costBase + minProfit + netFixedFees) / denominator) * 100
  ) / 100;

  // Post-check: verify floor covers all fees with min/max clamps applied
  // Uses ex-VAT comparison throughout
  for (let i = 0; i < 5; i++) {
    let totalFeesGross = 0;
    for (const fee of fees) {
      let base = floorPrice;
      if (fee.applies_to === "sale_plus_shipping") base = floorPrice + shippingCost;
      else if (fee.applies_to === "sale_price_inc_vat") base = floorPrice * VAT_MULTIPLIER;
      let amount = (base * ((fee.rate_percent ?? 0) / 100)) + (fee.fixed_amount ?? 0);
      if (fee.min_amount != null && amount < fee.min_amount) amount = fee.min_amount;
      if (fee.max_amount != null && amount > fee.max_amount) amount = fee.max_amount;
      totalFeesGross += amount;
    }

    // All comparisons on ex-VAT basis
    const netFees = totalFeesGross / VAT_MULTIPLIER;
    const riskReserve = (floorPrice / VAT_MULTIPLIER) * riskRate;
    const requiredExVat = costBase + minProfit + netFees + riskReserve;
    const neededPrice = VAT_MULTIPLIER * requiredExVat / (1 - effectiveMargin);

    if (neededPrice <= floorPrice + 0.01) break;
    floorPrice = Math.round(neededPrice * 100) / 100;
  }

  return floorPrice;
}

/**
 * Decompose fee schedule rows into an aggregated rate and fixed cost.
 * Handles different applies_to bases.
 */
export function decomposeFees(
  fees: FeeScheduleRow[],
  shippingCost: number,
): { effectiveFeeRate: number; fixedFeeCosts: number } {
  let effectiveFeeRate = 0;
  let fixedFeeCosts = 0;

  for (const fee of fees) {
    const rate = (fee.rate_percent ?? 0) / 100;
    const fixed = fee.fixed_amount ?? 0;
    if (fee.applies_to === "sale_plus_shipping") {
      effectiveFeeRate += rate;
      fixedFeeCosts += fixed + (shippingCost * rate);
    } else if (fee.applies_to === "sale_price_inc_vat") {
      effectiveFeeRate += rate * 1.2;
      fixedFeeCosts += fixed;
    } else {
      effectiveFeeRate += rate;
      fixedFeeCosts += fixed;
    }
  }

  return { effectiveFeeRate, fixedFeeCosts };
}
