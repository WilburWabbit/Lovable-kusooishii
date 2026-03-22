// ============================================================
// Admin V2 — VAT Calculation Utilities
// Spec Section 3.7: All prices VAT-inclusive at 20%.
// QBO requires ex-VAT amounts + explicit VAT.
// ============================================================

const VAT_RATE = 0.2;
const VAT_DIVISOR = 1 + VAT_RATE; // 1.2

/** Round to 2 decimal places (pennies). */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Compute net and VAT from a gross (VAT-inclusive) amount.
 * net = gross / 1.2, vat = gross - net (avoids floating-point drift).
 */
export function calculateVAT(gross: number): { net: number; vat: number } {
  const net = round2(gross / VAT_DIVISOR);
  const vat = round2(gross - net);
  return { net, vat };
}

/**
 * Calculate ex-VAT amount. Used for landed cost when supplier is VAT-registered.
 */
export function exVAT(amount: number): number {
  return round2(amount / VAT_DIVISOR);
}

/**
 * For multi-line orders sent to QBO: calculate per-line VAT, then adjust
 * the last line so the sum of all line (net + VAT) exactly matches the
 * order gross total. Handles the ±1p rounding discrepancy.
 *
 * Spec Section 3.7, rule 3: "If there's a penny discrepancy, adjust
 * the last line item's VAT to force an exact match."
 */
export function adjustLineVATRounding(
  lines: { gross: number }[],
): { net: number; vat: number }[] {
  if (lines.length === 0) return [];

  const result = lines.map((line) => calculateVAT(line.gross));

  // Total gross across all lines
  const totalGross = round2(lines.reduce((sum, l) => sum + l.gross, 0));

  // What the order-level VAT should be
  const orderVAT = calculateVAT(totalGross);

  // Sum of per-line VATs
  const lineVATSum = round2(result.reduce((sum, r) => sum + r.vat, 0));

  // Adjust last line if there's a discrepancy
  const discrepancy = round2(orderVAT.vat - lineVATSum);
  if (discrepancy !== 0) {
    const last = result[result.length - 1];
    last.vat = round2(last.vat + discrepancy);
    last.net = round2(lines[lines.length - 1].gross - last.vat);
  }

  return result;
}
