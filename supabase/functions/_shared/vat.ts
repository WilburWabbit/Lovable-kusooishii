// ============================================================
// VAT Calculation Utilities (Deno-compatible)
// Mirrors src/lib/utils/vat.ts plus integer-pence helpers used
// by all outbound QBO writers to guarantee penny-exact totals.
// ============================================================

const VAT_RATE = 0.2;
const VAT_DIVISOR = 1 + VAT_RATE; // 1.2

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ─── Integer-pence helpers ──────────────────────────────────
// Floating-point arithmetic on £-denominated amounts drifts by ±1p
// across multi-line documents (e.g. payout fees: 9.16 + 0.29 + 0.48 → 9.92
// when round-each-line, but should be 9.93). Convert everything to integer
// pence, do exact integer math, distribute remainder onto the last line,
// then convert back only at payload creation.

/** Convert a £ amount to integer pence (banker-safe rounding). */
export function toPence(pounds: number): number {
  return Math.round(pounds * 100);
}

/** Convert integer pence back to £ (2dp). */
export function fromPence(pence: number): number {
  return Math.round(pence) / 100;
}

/**
 * Split a single GROSS pence amount into { netPence, vatPence } at 20%.
 * netPence = round(gross / 1.2), vatPence = gross - netPence (exact integers).
 */
export function splitGrossPence(grossPence: number): { netPence: number; vatPence: number } {
  const netPence = Math.round(grossPence / VAT_DIVISOR);
  return { netPence, vatPence: grossPence - netPence };
}

/**
 * Distribute net+vat across multiple lines from per-line GROSS pence
 * such that the SUM exactly equals the per-line gross (no drift).
 * Any rounding remainder is pushed to the last line.
 *
 * Returns one entry per input line, in order. Each entry has integer pence.
 */
export function distributeLinesByGrossPence(
  grossPenceLines: number[],
): { netPence: number; vatPence: number; grossPence: number }[] {
  if (grossPenceLines.length === 0) return [];

  // Compute per-line net naively, then fix the last-line discrepancy so
  // the sum of (net+vat) equals the sum of input grosses, and the sum of
  // nets equals round(totalGross/1.2) exactly.
  const result = grossPenceLines.map((g) => {
    const { netPence, vatPence } = splitGrossPence(g);
    return { netPence, vatPence, grossPence: g };
  });

  const totalGross = grossPenceLines.reduce((s, g) => s + g, 0);
  const expectedNet = Math.round(totalGross / VAT_DIVISOR);
  const expectedVat = totalGross - expectedNet;

  const sumNet = result.reduce((s, r) => s + r.netPence, 0);
  const sumVat = result.reduce((s, r) => s + r.vatPence, 0);

  const netDelta = expectedNet - sumNet;
  const vatDelta = expectedVat - sumVat;

  if (netDelta !== 0 || vatDelta !== 0) {
    const last = result[result.length - 1];
    last.netPence += netDelta;
    last.vatPence += vatDelta;
    // grossPence already matches input — leave unchanged.
  }

  return result;
}

// ─── Legacy £ API (kept for backward compatibility) ─────────

/** Compute net and VAT from a gross (VAT-inclusive) amount at 20%. */
export function calculateVAT(gross: number): { net: number; vat: number } {
  const { netPence, vatPence } = splitGrossPence(toPence(gross));
  return { net: fromPence(netPence), vat: fromPence(vatPence) };
}

/** Calculate ex-VAT amount. */
export function exVAT(amount: number): number {
  return fromPence(splitGrossPence(toPence(amount)).netPence);
}

/**
 * For multi-line orders: adjust last line's VAT so sum matches order gross exactly.
 * Handles ±1p rounding discrepancy.
 *
 * Implemented on top of the integer-pence distributor for exactness.
 */
export function adjustLineVATRounding(
  lines: { gross: number }[],
): { net: number; vat: number }[] {
  if (lines.length === 0) return [];
  const distributed = distributeLinesByGrossPence(lines.map((l) => toPence(l.gross)));
  return distributed.map((d) => ({
    net: fromPence(d.netPence),
    vat: fromPence(d.vatPence),
  }));
}

// ─── Exact-balance verification ─────────────────────────────

export class QBOTotalMismatchError extends Error {
  constructor(
    public expectedGross: number,
    public qboTotalAmt: number,
    public qboTotalTax: number | null,
    public docKind: string,
    public qboDocId: string | null,
  ) {
    super(
      `QBO ${docKind}${qboDocId ? ` ${qboDocId}` : ""} total mismatch: ` +
        `expected gross £${expectedGross.toFixed(2)}, ` +
        `QBO returned TotalAmt £${qboTotalAmt.toFixed(2)}` +
        (qboTotalTax !== null ? ` (tax £${qboTotalTax.toFixed(2)})` : "") +
        `. Aborting to prevent reconciliation drift.`,
    );
    this.name = "QBOTotalMismatchError";
  }
}

/**
 * Verify that a QBO document's returned TotalAmt matches the expected gross
 * to the penny. Returns silently if matched; throws QBOTotalMismatchError if not.
 */
export function assertQBOTotalMatches(opts: {
  expectedGross: number;
  qboTotalAmt: number;
  qboTotalTax?: number | null;
  docKind: string;
  qboDocId?: string | null;
}): void {
  const expectedPence = toPence(opts.expectedGross);
  const qboPence = toPence(opts.qboTotalAmt);
  if (expectedPence !== qboPence) {
    throw new QBOTotalMismatchError(
      opts.expectedGross,
      opts.qboTotalAmt,
      opts.qboTotalTax ?? null,
      opts.docKind,
      opts.qboDocId ?? null,
    );
  }
}
