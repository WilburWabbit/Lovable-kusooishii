// ============================================================
// QBO-Stable Line Distribution
// ------------------------------------------------------------
// QBO recomputes VAT per-line on Purchase/SalesReceipt documents
// using `round(Amount × rate)` and *ignores* the document-level
// `TxnTaxDetail.TotalTax`. That means the only reliable way to land
// a payload at an exact target gross is to pre-solve for QBO's own
// arithmetic and, if necessary, append a zero-tax balancing line.
//
// This helper provides:
//   - simulateQBOTotal      — mirrors QBO's per-line tax recompute
//   - buildQBOStableLines   — distributes target gross into per-line
//                             nets such that QBO's recompute totals
//                             match. Inserts a ±1p zero-tax balancing
//                             line when no per-line solution exists.
//   - assertQBOPayloadBalances — pre-flight check before POST.
//
// All math uses integer pence to avoid floating-point drift.
// ============================================================

import { toPence, fromPence } from "./vat.ts";

const VAT_RATE_DEFAULT = 0.2;

// QBO tax code IDs in this UK realm (verified against `tax_code` table).
// Used as defaults; callers may override per line.
export const QBO_TAX_CODE_STANDARD_20 = "6"; // "20.0% S"
export const QBO_TAX_CODE_NO_VAT = "10"; // "No VAT" — zero tax, no VAT line item

export type QBOStableLineKind = "standard" | "rounding";

export interface QBOStableLine {
  /** Net amount in pence (Amount field in QBO payload, ex-VAT). */
  netPence: number;
  /** Expected per-line VAT in pence under QBO's own recompute. */
  vatPence: number;
  /** "standard" = derived from a source gross line. "rounding" = injected balancer. */
  kind: QBOStableLineKind;
  /** Index into the original input array (for lines of kind "standard"). */
  sourceIndex: number | null;
  /** TaxCodeRef value for this line (defaults to 20% S for standard, No VAT for rounding). */
  taxCodeRef: string;
}

/**
 * Simulate exactly what QBO will compute for a set of (netPence, taxCodeRef) lines.
 * QBO performs `round(Amount × rate)` per line and sums them.
 *
 * For TaxCodeRef = "10" (No VAT) the per-line tax contribution is 0.
 * For TaxCodeRef = "6"  (20% S) the per-line tax is round(net × 0.20).
 */
export function simulateQBOTotal(
  lines: { netPence: number; taxCodeRef: string }[],
  rate: number = VAT_RATE_DEFAULT,
): { totalNetPence: number; totalTaxPence: number; totalGrossPence: number } {
  let totalNetPence = 0;
  let totalTaxPence = 0;
  for (const l of lines) {
    totalNetPence += l.netPence;
    if (l.taxCodeRef === QBO_TAX_CODE_NO_VAT) {
      // Zero-rated / no VAT — no tax computed by QBO.
      continue;
    }
    // QBO converts pence → pounds, multiplies, rounds to 2dp, converts back.
    const lineTaxPence = Math.round(l.netPence * rate);
    totalTaxPence += lineTaxPence;
  }
  return {
    totalNetPence,
    totalTaxPence,
    totalGrossPence: totalNetPence + totalTaxPence,
  };
}

/**
 * Build per-line net amounts such that QBO's own per-line tax recompute
 * sums exactly to the source gross.
 *
 * Algorithm:
 *  1. For each input line, start with naive `lineNet = round(lineGross / 1.20)`.
 *  2. Simulate QBO's total. If it matches expected gross → done.
 *  3. Otherwise, nudge the largest-magnitude line's net by ±1p in the direction
 *     that pushes the simulated total toward the target. Re-simulate. Repeat
 *     for up to a small bounded number of iterations.
 *  4. If no per-line nudge converges, append a zero-tax (TaxCodeRef = "No VAT")
 *     balancing line of ±1p to absorb the residual.
 *
 * Guarantees: the returned `simulateQBOTotal(result).totalGrossPence === sum(grossPenceLines)`.
 */
export function buildQBOStableLines(
  grossPenceLines: number[],
  rate: number = VAT_RATE_DEFAULT,
): QBOStableLine[] {
  if (grossPenceLines.length === 0) return [];

  const targetGrossPence = grossPenceLines.reduce((s, g) => s + g, 0);
  const taxDivisor = 1 + rate;

  // Step 1: naive per-line net from gross.
  const lines: QBOStableLine[] = grossPenceLines.map((g, i) => {
    const netPence = Math.round(g / taxDivisor);
    return {
      netPence,
      vatPence: Math.round(netPence * rate),
      kind: "standard",
      sourceIndex: i,
      taxCodeRef: QBO_TAX_CODE_STANDARD_20,
    };
  });

  // Step 2: iteratively nudge lines until simulated total matches.
  // Worst case is 1–2 nudges; cap iterations to avoid pathological loops.
  const MAX_ITERATIONS = 8;
  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const sim = simulateQBOTotal(lines, rate);
    const drift = sim.totalGrossPence - targetGrossPence;
    if (drift === 0) {
      // Refresh per-line vat snapshot for caller diagnostics.
      for (const l of lines) {
        l.vatPence = l.taxCodeRef === QBO_TAX_CODE_NO_VAT ? 0 : Math.round(l.netPence * rate);
      }
      return lines;
    }

    // Find the candidate line whose ±1p net adjustment shifts the simulated
    // gross by exactly `Math.sign(-drift)` pence (i.e. whose tax bucket flips
    // the right way). For 20% VAT, decrementing net by 1p reduces gross by
    // either 1p (if tax doesn't flip) or 2p (if tax flips down by 1p), and
    // similarly +1p increases gross by 1 or 2. We prefer the simplest 1p shift.
    const direction = drift > 0 ? -1 : 1; // we need to move sim down or up
    let chosenIdx = -1;
    let chosenShift = 0;

    // Pass 1: prefer a 1p net shift that yields exactly 1p gross shift.
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (l.kind !== "standard" || l.taxCodeRef === QBO_TAX_CODE_NO_VAT) continue;
      const currentTax = Math.round(l.netPence * rate);
      const candidateNet = l.netPence + direction;
      if (candidateNet < 0) continue;
      const candidateTax = Math.round(candidateNet * rate);
      const grossShift = direction + (candidateTax - currentTax);
      if (grossShift === direction) {
        // Exactly the 1p shift we want.
        chosenIdx = i;
        chosenShift = direction;
        break;
      }
    }

    // Pass 2: accept any shift in the right direction (largest line first).
    if (chosenIdx === -1) {
      const order = lines
        .map((l, i) => ({ i, mag: Math.abs(l.netPence) }))
        .filter((x) => lines[x.i].kind === "standard" && lines[x.i].taxCodeRef !== QBO_TAX_CODE_NO_VAT)
        .sort((a, b) => b.mag - a.mag);
      for (const { i } of order) {
        const l = lines[i];
        const currentTax = Math.round(l.netPence * rate);
        const candidateNet = l.netPence + direction;
        if (candidateNet < 0) continue;
        const candidateTax = Math.round(candidateNet * rate);
        const grossShift = direction + (candidateTax - currentTax);
        if (Math.sign(grossShift) === direction) {
          chosenIdx = i;
          chosenShift = direction;
          break;
        }
      }
    }

    if (chosenIdx === -1) break; // no per-line solution — fall through to balancer.
    lines[chosenIdx].netPence += chosenShift;
  }

  // Step 3: residual still nonzero → append a zero-tax balancing line.
  const finalSim = simulateQBOTotal(lines, rate);
  const residual = targetGrossPence - finalSim.totalGrossPence;
  if (residual !== 0) {
    lines.push({
      netPence: residual,
      vatPence: 0,
      kind: "rounding",
      sourceIndex: null,
      taxCodeRef: QBO_TAX_CODE_NO_VAT,
    });
  }

  // Refresh vatPence snapshot for diagnostics.
  for (const l of lines) {
    l.vatPence = l.taxCodeRef === QBO_TAX_CODE_NO_VAT ? 0 : Math.round(l.netPence * rate);
  }
  return lines;
}

/**
 * Pre-flight: confirm the simulated QBO total of a set of stable lines
 * exactly equals the expected gross. Throws with full diagnostic on drift.
 *
 * Use BEFORE POSTing any QBO Purchase/SalesReceipt document.
 */
export class QBOPayloadImbalanceError extends Error {
  constructor(
    public expectedGrossPence: number,
    public simulatedGrossPence: number,
    public diagnostic: string,
  ) {
    super(
      `QBO payload would not balance under per-line VAT recompute: ` +
        `expected gross ${(expectedGrossPence / 100).toFixed(2)}, ` +
        `simulated ${(simulatedGrossPence / 100).toFixed(2)}. ${diagnostic}`,
    );
    this.name = "QBOPayloadImbalanceError";
  }
}

export function assertQBOPayloadBalances(
  lines: QBOStableLine[],
  expectedGrossPence: number,
  rate: number = VAT_RATE_DEFAULT,
): void {
  const sim = simulateQBOTotal(
    lines.map((l) => ({ netPence: l.netPence, taxCodeRef: l.taxCodeRef })),
    rate,
  );
  if (sim.totalGrossPence !== expectedGrossPence) {
    const dump = lines
      .map((l, i) =>
        `[${i}] kind=${l.kind} net=${(l.netPence / 100).toFixed(2)} tax=${(l.vatPence / 100).toFixed(2)} code=${l.taxCodeRef}`,
      )
      .join(" | ");
    throw new QBOPayloadImbalanceError(expectedGrossPence, sim.totalGrossPence, dump);
  }
}

/**
 * Convenience wrapper: build stable lines for an expected gross and
 * immediately verify they balance. Throws if the balancer itself fails.
 */
export function buildBalancedQBOLines(
  grossPenceLines: number[],
  rate: number = VAT_RATE_DEFAULT,
): QBOStableLine[] {
  const lines = buildQBOStableLines(grossPenceLines, rate);
  const expectedGross = grossPenceLines.reduce((s, g) => s + g, 0);
  assertQBOPayloadBalances(lines, expectedGross, rate);
  return lines;
}

/** Re-export pence helpers for convenience at call sites. */
export { toPence, fromPence };
