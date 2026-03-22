// ============================================================
// VAT Calculation Utilities (Deno-compatible)
// Mirrors src/lib/utils/vat.ts exactly.
// ============================================================

const VAT_RATE = 0.2;
const VAT_DIVISOR = 1 + VAT_RATE; // 1.2

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Compute net and VAT from a gross (VAT-inclusive) amount at 20%. */
export function calculateVAT(gross: number): { net: number; vat: number } {
  const net = round2(gross / VAT_DIVISOR);
  const vat = round2(gross - net);
  return { net, vat };
}

/** Calculate ex-VAT amount. */
export function exVAT(amount: number): number {
  return round2(amount / VAT_DIVISOR);
}

/**
 * For multi-line orders: adjust last line's VAT so sum matches order gross exactly.
 * Handles ±1p rounding discrepancy.
 */
export function adjustLineVATRounding(
  lines: { gross: number }[],
): { net: number; vat: number }[] {
  if (lines.length === 0) return [];

  const result = lines.map((line) => calculateVAT(line.gross));

  const totalGross = round2(lines.reduce((sum, l) => sum + l.gross, 0));
  const orderVAT = calculateVAT(totalGross);
  const lineVATSum = round2(result.reduce((sum, r) => sum + r.vat, 0));

  const discrepancy = round2(orderVAT.vat - lineVATSum);
  if (discrepancy !== 0) {
    const last = result[result.length - 1];
    last.vat = round2(last.vat + discrepancy);
    last.net = round2(lines[lines.length - 1].gross - last.vat);
  }

  return result;
}
