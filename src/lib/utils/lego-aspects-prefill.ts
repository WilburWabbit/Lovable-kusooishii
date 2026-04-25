// ============================================================
// LEGO → eBay aspects prefill
// Builds suggested eBay aspect values from product + BrickEconomy
// data. Only suggests; never overwrites existing manual values.
// ============================================================

import type { ProductDetail } from "@/lib/types/admin";

export interface AspectSuggestion {
  /** eBay aspect key (e.g., "Brand", "Number of Pieces") */
  key: string;
  /** Suggested value */
  value: string;
  /** Where the suggestion came from */
  source: "core" | "brickeconomy" | "catalog" | "constant";
}

/**
 * Build a suggested-value map keyed by eBay aspect name from
 * intrinsic product facts and BrickEconomy enrichment.
 *
 * Use the returned map to prefill empty aspects in the UI.
 */
export function buildLegoAspectSuggestions(
  product: ProductDetail,
): Record<string, AspectSuggestion> {
  const out: Record<string, AspectSuggestion> = {};

  // Always-LEGO constants
  out["Brand"] = { key: "Brand", value: "LEGO", source: "constant" };

  // Theme (subtheme more specific if present)
  if (product.subtheme) {
    out["LEGO Subtheme"] = {
      key: "LEGO Subtheme",
      value: product.subtheme,
      source: "core",
    };
  }
  if (product.theme) {
    out["LEGO Theme"] = {
      key: "LEGO Theme",
      value: product.theme,
      source: "core",
    };
    out["Theme"] = { key: "Theme", value: product.theme, source: "core" };
  }

  // Set / model
  const setNumber = product.setNumber ?? product.mpn?.split(".")[0]?.split("-")[0];
  if (setNumber) {
    out["LEGO Set Number"] = {
      key: "LEGO Set Number",
      value: setNumber,
      source: "core",
    };
    out["Model"] = { key: "Model", value: setNumber, source: "core" };
  }

  // MPN
  if (product.mpn) {
    out["MPN"] = { key: "MPN", value: product.mpn, source: "core" };
  }

  // Set name
  if (product.name) {
    out["Set Name"] = { key: "Set Name", value: product.name, source: "core" };
  }

  // Pieces
  const pieces = product.pieceCount ?? product.brickeconomyData?.piecesCount ?? null;
  if (pieces != null) {
    out["Number of Pieces"] = {
      key: "Number of Pieces",
      value: String(pieces),
      source: product.pieceCount ? "core" : "brickeconomy",
    };
  }

  // Year
  const year = product.brickeconomyData?.year ?? null;
  if (year != null) {
    out["Year Manufactured"] = {
      key: "Year Manufactured",
      value: String(year),
      source: "brickeconomy",
    };
  }

  // Age
  if (product.ageMark) {
    out["Recommended Age Range"] = {
      key: "Recommended Age Range",
      value: product.ageMark,
      source: "core",
    };
  }

  // EAN
  if (product.ean) {
    out["EAN"] = { key: "EAN", value: product.ean, source: "core" };
  }

  // Type defaults
  out["Type"] = { key: "Type", value: "Complete Set", source: "constant" };
  out["Packaging"] = { key: "Packaging", value: "Box", source: "constant" };

  return out;
}

/**
 * Pick only those suggestions whose key matches an aspect in the
 * eBay schema (case-insensitive match on attribute.key/label).
 */
export function matchSuggestionsToSchema(
  suggestions: Record<string, AspectSuggestion>,
  schemaKeys: string[],
): Record<string, AspectSuggestion> {
  const lowerSchema = new Map(schemaKeys.map((k) => [k.toLowerCase(), k]));
  const out: Record<string, AspectSuggestion> = {};
  for (const [k, sug] of Object.entries(suggestions)) {
    const match = lowerSchema.get(k.toLowerCase());
    if (match) out[match] = { ...sug, key: match };
  }
  return out;
}
