/**
 * eBay Listing Title Generator
 *
 * Constructs optimised eBay listing titles following the Kuso Oishii title rules.
 *
 * Formula:  LEGO [Theme*] [Set Name] [Set*] [MPN] [Descriptors]
 * Max:      80 characters
 *
 * Mandatory:  "LEGO", Set Name, MPN (no variant suffix)
 *
 * Descriptor priority (fill remaining characters in this order):
 *   1. Retired
 *   2. Theme  (between "LEGO" and set name — only if not already in the name)
 *   3. Sealed Box (grade 1) / BNIB (grade 2)
 *   4. GWP
 *   5. Exclusive
 *   6. High-value minifig callout with minifig MPN, e.g. "Mace Windu Minifig (sw0220)"
 *   7. Piece count (comma-formatted)
 *   8. Retired year (from retiredDate)
 *   9. MPN in parentheses — upgrades bare "75309" to "(75309)"
 *  10. "Set" keyword filler — inserted between name and MPN
 *
 * Banned:  L@@K, emoji, special chars, "FREE P&P", "FAST DISPATCH",
 *          "BARGAIN", "WOW", "Rare", New/Used, fake scarcity/urgency
 *
 * Rules:
 *  - Never repeat the theme if it already appears in the set name
 *  - "Sealed Box" for Grade 1 only; "BNIB" for Grade 2 only; neither for 3–5 *  - Always "Minifig" not "Minifigure"
 *  - Minifig callouts include the minifig MPN in parentheses
 *  - Piece counts use comma separators (e.g. "3,292 Pieces")
 *
 * @module generate-ebay-title
 * @path   src/lib/utils/generate-ebay-title.ts
 */

const MAX_TITLE_LENGTH = 80;

/* ------------------------------------------------------------------ */
/*  Public types                                                       */
/* ------------------------------------------------------------------ */

export interface EbayTitleInput {
  /** Official LEGO set name, e.g. "Republic Gunship" */
  name: string;

  /** Manufacturer Part Number with optional variant suffix, e.g. "75309-1" */
  mpn: string;

  /** Theme, e.g. "Star Wars", "City", "Technic". Null if unknown. */
  theme?: string | null;

  /** Total piece count. Null if unknown. */
  pieceCount?: number | null;
  /** ISO date string when the set was retired. Null if still current. */
  retiredDate?: string | null;

  /** Kuso Grade: 1 (mint/sealed), 2 (opened/complete), 3–5 (used) */
  grade?: number | null;

  /** Whether this set is a Gift With Purchase */
  isGwp?: boolean;

  /** Whether this is an exclusive / limited release */
  isExclusive?: boolean;

  /**
   * High-value minifigure callout including the minifig MPN.
   * Example: "Mace Windu Minifig (sw0220)"
   * Only include when the minifig value is a large proportion of the set value.
   */
  minifigCallout?: string | null;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Strip the BrickLink-style variant suffix: "60215-1" → "60215" */
function stripVariantSuffix(mpn: string): string {
  return mpn.replace(/-\d+$/, "");
}
/** Format a number with comma thousands separators */
function formatWithCommas(n: number): string {
  return n.toLocaleString("en-GB");
}

/** Check whether `haystack` already contains `needle` (case-insensitive) */
function containsIgnoreCase(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

/* ------------------------------------------------------------------ */
/*  Internal title builder                                             */
/* ------------------------------------------------------------------ */

interface TitleParts {
  theme: string; // empty string = omitted
  name: string;
  includeSet: boolean; // "Set" keyword between name and MPN
  mpn: string;
  useParens: boolean; // wrap MPN in parentheses
  suffixes: string[]; // appended after MPN in order
}

function buildTitle(p: TitleParts): string {
  const segments: string[] = ["LEGO"];

  if (p.theme) segments.push(p.theme);
  segments.push(p.name);  if (p.includeSet) segments.push("Set");
  segments.push(p.useParens ? `(${p.mpn})` : p.mpn);

  for (const s of p.suffixes) {
    segments.push(s);
  }

  return segments.join(" ");
}

function titleLength(p: TitleParts): number {
  return buildTitle(p).length;
}

/** Try mutating `parts` — accept only if the result fits within 80 chars */
function tryAdd(
  parts: TitleParts,
  mutate: (p: TitleParts) => TitleParts
): TitleParts {
  const candidate = mutate(parts);
  return titleLength(candidate) <= MAX_TITLE_LENGTH ? candidate : parts;
}

/* ------------------------------------------------------------------ */
/*  Main generator                                                     */
/* ------------------------------------------------------------------ */

export function generateEbayTitle(input: EbayTitleInput): string {
  const mpn = stripVariantSuffix(input.mpn);
  const isRetired = !!input.retiredDate;  const themeAlreadyInName =
    !!input.theme && containsIgnoreCase(input.name, input.theme);

  let parts: TitleParts = {
    theme: "",
    name: input.name,
    includeSet: false,
    mpn,
    useParens: false,
    suffixes: [],
  };

  // --- Priority 1: Retired ---
  if (isRetired) {
    parts = tryAdd(parts, (p) => ({
      ...p,
      suffixes: [...p.suffixes, "Retired"],
    }));
  }

  // --- Priority 2: Theme (inserted before name, not as a suffix) ---
  if (input.theme && !themeAlreadyInName) {
    parts = tryAdd(parts, (p) => ({ ...p, theme: input.theme! }));
  }

  // --- Priority 3: Sealed Box (grade 1) / BNIB (grade 2) ---
  if (input.grade === 1) {
    parts = tryAdd(parts, (p) => ({
      ...p,
      suffixes: [...p.suffixes, "Sealed Box"],
    }));  } else if (input.grade === 2) {
    parts = tryAdd(parts, (p) => ({
      ...p,
      suffixes: [...p.suffixes, "BNIB"],
    }));
  }

  // --- Priority 4: GWP ---
  if (input.isGwp) {
    parts = tryAdd(parts, (p) => ({
      ...p,
      suffixes: [...p.suffixes, "GWP"],
    }));
  }

  // --- Priority 5: Exclusive ---
  if (input.isExclusive) {
    parts = tryAdd(parts, (p) => ({
      ...p,
      suffixes: [...p.suffixes, "Exclusive"],
    }));
  }

  // --- Priority 6: High-value minifig callout ---
  if (input.minifigCallout) {
    parts = tryAdd(parts, (p) => ({
      ...p,
      suffixes: [...p.suffixes, input.minifigCallout!],
    }));
  }
  // --- Priority 7: Piece count (comma-formatted) ---
  if (input.pieceCount) {
    const piecesStr = `${formatWithCommas(input.pieceCount)} Pieces`;
    parts = tryAdd(parts, (p) => ({
      ...p,
      suffixes: [...p.suffixes, piecesStr],
    }));
  }

  // --- Priority 8: Retired year ---
  if (isRetired && input.retiredDate) {
    const year = new Date(input.retiredDate).getFullYear().toString();
    parts = tryAdd(parts, (p) => ({
      ...p,
      suffixes: [...p.suffixes, year],
    }));
  }

  // --- Priority 9: Parenthesise MPN (costs 2 chars) ---
  parts = tryAdd(parts, (p) => ({ ...p, useParens: true }));

  // --- Priority 10: "Set" keyword filler ---
  parts = tryAdd(parts, (p) => ({ ...p, includeSet: true }));

  return buildTitle(parts);
}