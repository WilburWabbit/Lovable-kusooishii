// ============================================================
// QBO-Stable Line Distribution (corrected model)
// ------------------------------------------------------------
// Empirically verified QBO behaviour for Purchase + SalesReceipt
// documents with `GlobalTaxCalculation: "TaxExcluded"` in this UK realm:
//
//   doc_tax   = round( SUM(line.Amount where TaxCodeRef != "No VAT") × rate )
//   doc_total = SUM(all line.Amount) + doc_tax
//
// i.e. QBO sums nets first, then computes a single document-level VAT.
// Lines with TaxCodeRef = "10" (No VAT) are EXCLUDED from the tax base
// and contribute their net only to the document total. QBO ignores any
// `TxnTaxDetail.TotalTax` we send.
//
// Strategy to land an exact target gross G (in pence):
//   1. Distribute G into per-line nets such that
//        sum(taxable line nets) === round(G / 1.2)  (= N)
//      Naively each line gets round(lineGross / 1.2); fix the largest line
//      with the integer residual so the sum is exactly N.
//   2. Compute QBO's recomputed gross = N + round(N × 0.2). If that equals
//      G, we're done. Otherwise the residual (always ±1p; 1-in-6 of all
//      gross values) is appended as a zero-tax "Rounding adjustment" line
//      with TaxCodeRef = "10" (No VAT). That line shifts the total by
//      exactly ±1p without disturbing QBO's tax recompute.
//
// All math is integer pence.
// ============================================================

import { toPence, fromPence } from "./vat.ts";

const VAT_RATE_DEFAULT = 0.2;

// QBO tax code IDs in this UK realm (verified against `tax_code` table).
export const QBO_TAX_CODE_STANDARD_20 = "6"; // "20.0% S"
export const QBO_TAX_CODE_NO_VAT = "10"; // "No VAT" — excluded from tax base

export type QBOStableLineKind = "standard" | "rounding";

export interface QBOStableLine {
  /** Net amount in pence (Amount field in QBO payload, ex-VAT). */
  netPence: number;
  /** Per-line VAT contribution in pence under QBO's recompute (always 0 here — QBO computes at doc level). */
  vatPence: number;
  /** "standard" = derived from a source gross line. "rounding" = injected balancer. */
  kind: QBOStableLineKind;
  /** Index into the original input array (for lines of kind "standard"). */
  sourceIndex: number | null;
  /** TaxCodeRef value for this line. */
  taxCodeRef: string;
}

/**
 * Simulate exactly what QBO will compute for a set of (netPence, taxCodeRef) lines
 * under the doc-level recompute rule:
 *
 *   tax  = round( sum(net for lines where code != NO_VAT) × rate )
 *   gross = sum(all nets) + tax
 */
export function simulateQBOTotal(
  lines: { netPence: number; taxCodeRef: string }[],
  rate: number = VAT_RATE_DEFAULT,
): { totalNetPence: number; totalTaxPence: number; totalGrossPence: number } {
  let totalNetPence = 0;
  let taxableNetPence = 0;
  for (const l of lines) {
    totalNetPence += l.netPence;
    if (l.taxCodeRef !== QBO_TAX_CODE_NO_VAT) {
      taxableNetPence += l.netPence;
    }
  }
  const totalTaxPence = Math.round(taxableNetPence * rate);
  return {
    totalNetPence,
    totalTaxPence,
    totalGrossPence: totalNetPence + totalTaxPence,
  };
}

/**
 * Build per-line net amounts such that QBO's doc-level tax recompute lands
 * the document at the exact target gross.
 *
 * Algorithm:
 *  1. N = round(targetGross / 1.20)  — required taxable-net sum.
 *  2. For each input line, naive net = round(lineGross / 1.20). Fix the
 *     largest line by ±delta so sum(nets) === N exactly.
 *  3. Recompute under QBO's rule: doc_tax = round(N × 0.20),
 *     doc_gross = N + doc_tax. If doc_gross !== targetGross, append a
 *     zero-tax "Rounding adjustment" line of (targetGross − doc_gross) pence.
 *
 * Guarantees: simulateQBOTotal(result).totalGrossPence === sum(grossPenceLines).
 */
export function buildQBOStableLines(
  grossPenceLines: number[],
  rate: number = VAT_RATE_DEFAULT,
): QBOStableLine[] {
  if (grossPenceLines.length === 0) return [];

  const targetGrossPence = grossPenceLines.reduce((s, g) => s + g, 0);
  const taxDivisor = 1 + rate;
  const requiredNetSum = Math.round(targetGrossPence / taxDivisor);

  // Step 1: naive per-line net.
  const lines: QBOStableLine[] = grossPenceLines.map((g, i) => ({
    netPence: Math.round(g / taxDivisor),
    vatPence: 0,
    kind: "standard",
    sourceIndex: i,
    taxCodeRef: QBO_TAX_CODE_STANDARD_20,
  }));

  // Step 2: nudge to make sum(nets) === requiredNetSum.
  const sumNets = lines.reduce((s, l) => s + l.netPence, 0);
  const netDelta = requiredNetSum - sumNets;
  if (netDelta !== 0) {
    // Apply the entire delta to the largest-magnitude line. Delta is small
    // (typically ±1p, bounded by line count × 0.5p of rounding noise).
    let largestIdx = 0;
    for (let i = 1; i < lines.length; i++) {
      if (Math.abs(lines[i].netPence) > Math.abs(lines[largestIdx].netPence)) {
        largestIdx = i;
      }
    }
    const adjusted = lines[largestIdx].netPence + netDelta;
    if (adjusted < 0) {
      // Pathological: distribute across multiple lines instead.
      let remaining = netDelta;
      const order = lines
        .map((l, i) => ({ i, mag: Math.abs(l.netPence) }))
        .sort((a, b) => b.mag - a.mag);
      for (const { i } of order) {
        if (remaining === 0) break;
        const step = remaining > 0 ? 1 : -1;
        while (remaining !== 0 && lines[i].netPence + step >= 0) {
          lines[i].netPence += step;
          remaining -= step;
          if (Math.abs(remaining) > 100) break; // safety
        }
      }
    } else {
      lines[largestIdx].netPence = adjusted;
    }
  }

  // Step 3: check QBO's doc-level recompute and append balancer if needed.
  const sim = simulateQBOTotal(lines, rate);
  const residual = targetGrossPence - sim.totalGrossPence;
  if (residual !== 0) {
    lines.push({
      netPence: residual,
      vatPence: 0,
      kind: "rounding",
      sourceIndex: null,
      taxCodeRef: QBO_TAX_CODE_NO_VAT,
    });
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
      `QBO payload would not balance under doc-level VAT recompute: ` +
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
        `[${i}] kind=${l.kind} net=${(l.netPence / 100).toFixed(2)} code=${l.taxCodeRef}`,
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
