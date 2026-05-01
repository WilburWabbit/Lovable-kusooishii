// ============================================================
// Admin V2 — Cost Apportionment and Pricing Utilities
// Spec Sections 3.1–3.5: shared cost allocation, relative
// sales value reallocation, weighted average, FIFO, floor price.
// ============================================================

import type { ConditionGrade } from '../types/admin';

/** Default grade-to-value ratios when market prices are unavailable. */
const DEFAULT_GRADE_RATIOS: Record<ConditionGrade, number> = {
  1: 1.0,
  2: 0.8,
  3: 0.6,
  4: 0.4,
  5: 0.2,
};

/** Round to 2 decimal places. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ─── Step 1: Cost Apportionment (on purchase) ───────────────

/**
 * Apportion shared batch costs proportionally to unit cost.
 * Spec Section 3.1:
 *   apportioned = (unitCost / totalUnitCosts) * totalSharedCosts
 *   landed = unitCost + apportioned
 */
export function apportionSharedCosts(
  lines: { unitCost: number; quantity: number }[],
  totalSharedCosts: number,
): { apportionedCost: number; landedCostPerUnit: number }[] {
  const totalUnitCosts = lines.reduce(
    (sum, line) => sum + line.unitCost * line.quantity,
    0,
  );

  if (totalUnitCosts === 0) {
    return lines.map((line) => ({
      apportionedCost: 0,
      landedCostPerUnit: line.unitCost,
    }));
  }

  return lines.map((line) => {
    const proportion = line.unitCost / totalUnitCosts;
    const apportionedCost = round2(proportion * totalSharedCosts);
    return {
      apportionedCost,
      landedCostPerUnit: round2(line.unitCost + apportionedCost),
    };
  });
}

// ─── Step 2: Relative Sales Value Allocation (on grading) ───

/**
 * Redistribute total line cost across grades proportionally to
 * expected market value. Used when a line item's units are graded
 * into different condition grades.
 *
 * Spec Section 3.2:
 *   ratio[grade] = (marketPrice[grade] * count) / totalExpectedRevenue
 *   landedCost[grade] = totalLineCost * ratio[grade] / count
 */
export function allocateCostByGrade(
  totalLineCost: number,
  gradeAllocations: {
    grade: ConditionGrade;
    count: number;
    marketPrice: number | null;
  }[],
  defaultRatios: Record<ConditionGrade, number> = DEFAULT_GRADE_RATIOS,
): { grade: ConditionGrade; landedCostPerUnit: number }[] {
  // Use market price if available, else fall back to default ratio * base
  // (base = G1 market price or the per-unit cost, whichever is available)
  const g1Market = gradeAllocations.find((a) => a.grade === 1)?.marketPrice;

  const withExpectedValue = gradeAllocations.map((a) => {
    let expectedPerUnit: number;
    if (a.marketPrice !== null && a.marketPrice > 0) {
      expectedPerUnit = a.marketPrice;
    } else if (g1Market !== null && g1Market !== undefined && g1Market > 0) {
      expectedPerUnit = g1Market * defaultRatios[a.grade];
    } else {
      expectedPerUnit = defaultRatios[a.grade];
    }
    return { ...a, expectedPerUnit, expectedTotal: expectedPerUnit * a.count };
  });

  const totalExpectedRevenue = withExpectedValue.reduce(
    (sum, a) => sum + a.expectedTotal,
    0,
  );

  if (totalExpectedRevenue === 0) {
    // All zero — distribute evenly
    const totalUnits = gradeAllocations.reduce((s, a) => s + a.count, 0);
    return gradeAllocations.map((a) => ({
      grade: a.grade,
      landedCostPerUnit: totalUnits > 0 ? round2(totalLineCost / totalUnits) : 0,
    }));
  }

  return withExpectedValue.map((a) => ({
    grade: a.grade,
    landedCostPerUnit:
      a.count > 0
        ? round2((totalLineCost * (a.expectedTotal / totalExpectedRevenue)) / a.count)
        : 0,
  }));
}

// ─── Step 3: Weighted Average Cost ──────────────────────────

/**
 * Recalculate weighted average cost when new units are added.
 * Spec Section 3.3.
 */
export function weightedAverage(
  existingQty: number,
  existingAvg: number,
  newQty: number,
  newCost: number,
): number {
  const totalQty = existingQty + newQty;
  if (totalQty === 0) return 0;
  return round2(
    (existingQty * existingAvg + newQty * newCost) / totalQty,
  );
}

// ─── Step 4: FIFO Selection ────────────────────────────────

/**
 * Client-side FIFO helper: select the oldest listed unit by createdAt.
 * Actual sale allocation uses allocate_stock_for_order_line(), which records
 * the stock allocation and COGS event in one database transaction.
 */
export function selectFIFOUnit<
  T extends { createdAt: string; status: string },
>(units: T[]): T | null {
  const listed = units
    .filter((u) => u.status === 'listed')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return listed[0] ?? null;
}

// ─── Step 5: Floor Price Guardrail ─────────────────────────

/**
 * Calculate floor price from the highest landed cost on hand.
 * Spec Section 3.5: floor = highest * (1 + marginTarget).
 * Default margin target: 25%.
 */
export function floorPrice(
  highestLandedCost: number,
  marginTarget: number = 0.25,
): number {
  return round2(highestLandedCost * (1 + marginTarget));
}
