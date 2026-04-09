/**
 * Cassini-optimised eBay title generator for LEGO sets.
 * Hard limit: 80 characters. Pure function, no React dependencies.
 */

export interface EbayTitleInput {
  name: string;
  mpn: string;
  theme?: string | null;
  grade?: number | null;
  retired?: boolean;
  retiredYear?: number | null;
  pieceCount?: number | null;
}

export interface EbayTitleResult {
  title: string;
  length: number;
  warnings: string[];
}

const MAX_LENGTH = 80;

const BANNED_TERMS = [
  "rare",
  "must have",
  "l@@k",
  "look",
  "wow",
  "amazing",
  "bargain",
  "cheap",
  "best price",
  "hurry",
  "limited",
  "don't miss",
  "exclusive deal",
];

function gradeDescriptor(grade: number | null | undefined): string | null {
  if (grade === 1) return "SEALED";
  if (grade === 2) return "COMPLETE";
  return null;
}

/**
 * Build a Cassini-optimised eBay title with descriptor priority:
 *  1. Grade marker (SEALED / COMPLETE)
 *  2. RETIRED flag
 *  3. Piece count
 *  4. Theme name
 *  5. Retired year
 *
 * The product name is truncated (never descriptors) if needed.
 */
export function generateEbayTitle(input: EbayTitleInput): EbayTitleResult {
  const { name, mpn, theme, grade, retired, retiredYear, pieceCount } = input;
  const warnings: string[] = [];

  // Strip version suffix for display (75367-1 → 75367)
  const setNum = mpn.replace(/-\d+$/, "");

  // Build ordered descriptor list
  const descriptors: string[] = [];

  const gd = gradeDescriptor(grade);
  if (gd) descriptors.push(gd);

  if (retired) descriptors.push("RETIRED");

  if (pieceCount && pieceCount > 0) descriptors.push(`${pieceCount} Pieces`);

  if (theme) descriptors.push(theme);

  if (retired && retiredYear) descriptors.push(`Retired ${retiredYear}`);

  // Fixed prefix
  const prefix = `LEGO ${setNum}`;

  // Calculate space budget: "PREFIX NAME DESC1 DESC2 ..."
  // We always include prefix. We greedily add descriptors, then fill remaining with name.
  const suffixParts: string[] = [];
  let suffixLen = 0;

  for (const d of descriptors) {
    const added = suffixLen === 0 ? d.length : d.length + 1; // space separator
    if (prefix.length + 1 + 1 + suffixLen + added <= MAX_LENGTH) {
      // +1 for space after prefix, +1 minimum for at least 1 char of name
      suffixParts.push(d);
      suffixLen += added;
    }
  }

  const suffix = suffixParts.length > 0 ? " " + suffixParts.join(" ") : "";
  const availableForName = MAX_LENGTH - prefix.length - 1 - suffix.length; // -1 for space before name

  let truncatedName = name;
  if (availableForName < name.length) {
    if (availableForName < 4) {
      // Not enough room for a meaningful name — skip it
      truncatedName = "";
      warnings.push("Product name omitted — too many descriptors");
    } else {
      truncatedName = name.slice(0, availableForName).trimEnd();
      warnings.push(`Product name truncated to ${availableForName} characters`);
    }
  }

  const parts = [prefix];
  if (truncatedName) parts.push(truncatedName);
  const title = parts.join(" ") + suffix;

  // Validate for banned terms
  const titleLower = title.toLowerCase();
  for (const term of BANNED_TERMS) {
    if (titleLower.includes(term)) {
      warnings.push(`Contains banned term: "${term}"`);
    }
  }

  return { title: title.trimEnd(), length: title.trimEnd().length, warnings };
}

/**
 * Validate a manually-entered title against eBay rules.
 */
export function validateTitle(title: string): string[] {
  const warnings: string[] = [];

  if (title.length > MAX_LENGTH) {
    warnings.push(`Title exceeds ${MAX_LENGTH} characters (${title.length})`);
  }

  const lower = title.toLowerCase();
  for (const term of BANNED_TERMS) {
    if (lower.includes(term)) {
      warnings.push(`Contains banned term: "${term}"`);
    }
  }

  if (!title.toUpperCase().startsWith("LEGO")) {
    warnings.push('Title should start with "LEGO" for Cassini optimisation');
  }

  return warnings;
}
