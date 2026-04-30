/**
 * eBay listing title generator.
 *
 * Formula: LEGO [Theme*] [Set Name] [Set*] [(MPN)] [Descriptors]
 * Hard limit: 80 characters (eBay Cassini-optimised).
 *
 * Mandatory tokens: "LEGO", Set Name, MPN (bare, no variant suffix).
 * MPN is always present in the core title. Priority 9 upgrades bare MPN
 * to parenthesised form "(75290)"; priority 10 inserts "Set" before it.
 * Descriptors are appended in priority order until the budget is exhausted.
 *
 * @see project_ebay_title_rules.md for the full agreed spec.
 */

import type { ConditionGrade, ConditionGradeAll } from "@/lib/types/admin";

// ─── Public types ─────────────────────────────────────────

export interface EbayTitleInput {
  /** Product name, e.g. "Mos Eisley Cantina" */
  name: string;
  /** MPN with variant, e.g. "75290-1". The variant suffix is stripped for display. */
  mpn: string;
  /** Theme name, e.g. "Star Wars". null/undefined = omit theme. */
  theme?: string | null;
  /** Kuso Grade (1–5). */
  grade: ConditionGrade | ConditionGradeAll;
  /** Whether the set is retired. */
  retired?: boolean;
  /** Year the set retired, e.g. 2023. */
  retiredYear?: number | null;
  /** Whether the set is a Gift With Purchase (GWP). */
  gwp?: boolean;
  /** Whether the set is a retailer/event exclusive. */
  exclusive?: boolean;
  /** Total piece count. */
  pieceCount?: number | null;
  /** Optional high-value minifig callout, e.g. "Mace Windu". */
  minifigName?: string | null;
  /** Minifig MPN for callout, e.g. "sw0220". */
  minifigMpn?: string | null;
}

export interface EbayTitleResult {
  /** The generated title (≤80 chars). */
  title: string;
  /** Character count. */
  length: number;
  /** Descriptors that were included (in order). */
  includedDescriptors: string[];
  /** Descriptors that were dropped due to space. */
  droppedDescriptors: string[];
}

// ─── Constants ────────────────────────────────────────────

const MAX_LENGTH = 80;

/** Words/patterns that must never appear in an eBay title. */
const BANNED_PATTERNS = [
  /l@@k/i,
  /free\s+p&p/i,
  /fast\s+dispatch/i,
  /bargain/i,
  /\bwow\b/i,
  /\brare\b/i,
  /\bnew\b/i,
  /\bused\b/i,
  /limited\s+time/i,
];

// ─── Helpers ──────────────────────────────────────────────

/** Strip the variant suffix from an MPN: "75290-1" → "75290". */
function stripVariant(mpn: string): string {
  return mpn.replace(/-\d+$/, "");
}

/** Format piece count with comma separators, e.g. 3292 → "3,292". */
function formatPieceCount(count: number): string {
  return count.toLocaleString("en-GB");
}

/**
 * Check whether theme is already substantially present in the set name.
 * E.g. theme "Star Wars" and name "Star Wars Mos Eisley Cantina" → true.
 */
function themeAlreadyInName(theme: string, name: string): boolean {
  const normTheme = theme.toLowerCase().trim();
  const normName = name.toLowerCase().trim();
  return normName.includes(normTheme);
}

/** Validate that a generated title contains no banned terms. */
export function validateTitle(title: string): { valid: boolean; violations: string[] } {
  const violations: string[] = [];
  for (const pattern of BANNED_PATTERNS) {
    if (pattern.test(title)) {
      violations.push(pattern.source);
    }
  }
  return { valid: violations.length === 0, violations };
}

// ─── Internal title builder (mirrors the original design) ──

interface TitleParts {
  theme: string;       // empty = omitted
  name: string;
  includeSet: boolean; // "Set" keyword between name and MPN
  mpn: string;         // bare set number, always present
  useParens: boolean;  // wrap MPN in parentheses
  suffixes: string[];  // descriptors appended after MPN
}

function buildTitle(p: TitleParts): string {
  const segments: string[] = ["LEGO"];
  if (p.theme) segments.push(p.theme);
  segments.push(p.name);
  if (p.includeSet) segments.push("Set");
  segments.push(p.useParens ? `(${p.mpn})` : p.mpn);
  for (const s of p.suffixes) segments.push(s);
  return segments.join(" ");
}

function titleLength(p: TitleParts): number {
  return buildTitle(p).length;
}

/** Try a mutation — accept only if the result fits within 80 chars. */
function tryMutate(
  parts: TitleParts,
  mutate: (p: TitleParts) => TitleParts,
): { parts: TitleParts; accepted: boolean } {
  const candidate = mutate(parts);
  if (titleLength(candidate) <= MAX_LENGTH) {
    return { parts: candidate, accepted: true };
  }
  return { parts, accepted: false };
}

// ─── Generator ────────────────────────────────────────────

export function generateEbayTitle(input: EbayTitleInput): EbayTitleResult {
  const {
    name,
    mpn,
    theme,
    grade,
    retired = false,
    retiredYear,
    gwp = false,
    exclusive = false,
    pieceCount,
    minifigName,
    minifigMpn,
  } = input;

  const setNumber = stripVariant(mpn);
  const themeAlreadyPresent = theme ? themeAlreadyInName(theme, name) : true;

  // ── Mandatory core: LEGO [Name] [MPN] ────────────────────
  // MPN is always included (bare) per spec. Theme and descriptors are optional.
  let parts: TitleParts = {
    theme: "",
    name,
    includeSet: false,
    mpn: setNumber,
    useParens: false,
    suffixes: [],
  };

  // If the mandatory core alone exceeds 80 chars, truncate the name.
  if (titleLength(parts) > MAX_LENGTH) {
    const overhead = "LEGO ".length + " ".length + setNumber.length;
    parts = { ...parts, name: name.substring(0, MAX_LENGTH - overhead) };
  }

  const included: string[] = [];
  const dropped: string[] = [];

  // ── Priority 1: Retired ──────────────────────────────────
  if (retired) {
    const r = tryMutate(parts, (p) => ({
      ...p,
      suffixes: [...p.suffixes, "Retired"],
    }));
    parts = r.parts;
    r.accepted ? included.push("Retired") : dropped.push("Retired");
  }

  // ── Priority 2: Theme (between LEGO and name) ───────────
  if (theme && !themeAlreadyPresent) {
    const r = tryMutate(parts, (p) => ({ ...p, theme: theme }));
    parts = r.parts;
    r.accepted ? included.push("Theme") : dropped.push("Theme");
  }

  // ── Priority 3: Sealed Box (grade 1) / BNIB (grade 2) ──
  if (grade === 1) {
    const r = tryMutate(parts, (p) => ({
      ...p,
      suffixes: [...p.suffixes, "Sealed Box"],
    }));
    parts = r.parts;
    r.accepted ? included.push("Sealed Box") : dropped.push("Sealed Box");
  } else if (grade === 2) {
    const r = tryMutate(parts, (p) => ({
      ...p,
      suffixes: [...p.suffixes, "BNIB"],
    }));
    parts = r.parts;
    r.accepted ? included.push("BNIB") : dropped.push("BNIB");
  }

  // ── Priority 4: GWP ─────────────────────────────────────
  if (gwp) {
    const r = tryMutate(parts, (p) => ({
      ...p,
      suffixes: [...p.suffixes, "GWP"],
    }));
    parts = r.parts;
    r.accepted ? included.push("GWP") : dropped.push("GWP");
  }

  // ── Priority 5: Exclusive ───────────────────────────────
  if (exclusive) {
    const r = tryMutate(parts, (p) => ({
      ...p,
      suffixes: [...p.suffixes, "Exclusive"],
    }));
    parts = r.parts;
    r.accepted ? included.push("Exclusive") : dropped.push("Exclusive");
  }

  // ── Priority 6: Minifig callout with MPN ────────────────
  if (minifigName && minifigMpn) {
    const callout = `${minifigName} Minifig (${minifigMpn})`;
    const r = tryMutate(parts, (p) => ({
      ...p,
      suffixes: [...p.suffixes, callout],
    }));
    parts = r.parts;
    r.accepted ? included.push("Minifig callout") : dropped.push("Minifig callout");
  }

  // ── Priority 7: Piece count ─────────────────────────────
  if (pieceCount && pieceCount > 0) {
    const piecesStr = `${formatPieceCount(pieceCount)} Pieces`;
    const r = tryMutate(parts, (p) => ({
      ...p,
      suffixes: [...p.suffixes, piecesStr],
    }));
    parts = r.parts;
    r.accepted ? included.push("Piece count") : dropped.push("Piece count");
  }

  // ── Priority 8: Retired year (bare year, not "Retired YYYY") ──
  // Only the year is appended here — "Retired" was already added at priority 1.
  if (retiredYear) {
    const r = tryMutate(parts, (p) => ({
      ...p,
      suffixes: [...p.suffixes, String(retiredYear)],
    }));
    parts = r.parts;
    r.accepted ? included.push("Retired year") : dropped.push("Retired year");
  }

  // ── Priority 9: Parenthesise MPN (costs 2 chars) ───────
  {
    const r = tryMutate(parts, (p) => ({ ...p, useParens: true }));
    parts = r.parts;
    r.accepted ? included.push("MPN parens") : dropped.push("MPN parens");
  }

  // ── Priority 10: "Set" keyword filler ───────────────────
  {
    const r = tryMutate(parts, (p) => ({ ...p, includeSet: true }));
    parts = r.parts;
    r.accepted ? included.push("Set keyword") : dropped.push("Set keyword");
  }

  const title = buildTitle(parts);

  return {
    title,
    length: title.length,
    includedDescriptors: included,
    droppedDescriptors: dropped,
  };
}
