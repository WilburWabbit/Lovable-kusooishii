// ============================================================
// Channel Aspect Map (server-side)
// Maps canonical product attributes (product columns + BrickEconomy
// + saved product_attribute namespace='core') to channel-specific
// aspect keys (eBay first; GMC/Meta to follow).
//
// This file is the single source of truth for the mapping. The UI
// must NEVER duplicate these mappings — instead, it calls the
// `resolve-aspects` edge function action and renders the result.
// ============================================================

export type AspectSource = "core" | "brickeconomy" | "constant" | "custom";

export interface ResolvedAspect {
  key: string;
  value: string;
  source: AspectSource;
  /** Human description of where the value came from */
  basis: string;
}

export interface ProductRow {
  id: string;
  mpn: string | null;
  name: string | null;
  set_number: string | null;
  subtheme_name: string | null;
  piece_count: number | null;
  age_range: string | null;
  age_mark: string | null;
  ean: string | null;
  released_date: string | null;
  retired_date: string | null;
  release_year: number | null;
  weight_kg: number | null;
  weight_g: number | null;
  length_cm: number | null;
  width_cm: number | null;
  height_cm: number | null;
  product_type: string | null;
  brand: string | null;
  theme_id: string | null;
}

export interface BrickEconomyRow {
  theme: string | null;
  subtheme: string | null;
  pieces_count: number | null;
  year: number | null;
  released_date: string | null;
  retired_date: string | null;
}

/**
 * Build a canonical-aspect map keyed by eBay aspect name. Only emits
 * an entry when a value is genuinely available — never blanks.
 */
export function buildEbayAspects(input: {
  product: ProductRow;
  themeName: string | null;
  be: BrickEconomyRow | null;
  customCore: Record<string, string>;
}): Record<string, ResolvedAspect> {
  const { product, themeName, be, customCore } = input;
  const out: Record<string, ResolvedAspect> = {};

  const set = (key: string, value: string | null | undefined, source: AspectSource, basis: string) => {
    if (value == null || String(value).trim() === "") return;
    out[key] = { key, value: String(value), source, basis };
  };

  // Brand — only emit when product.brand is explicitly set. Fallbacks like
  // "always LEGO" must come from a channel_attribute_mapping constant so the
  // operator can change brand per category/marketplace without a code edit.
  set("Brand", product.brand ?? null, "core", "product.brand");

  // Theme / subtheme
  set("LEGO Theme", themeName ?? be?.theme ?? null,
      themeName ? "core" : (be?.theme ? "brickeconomy" : "core"),
      themeName ? "product.theme" : "brickeconomy.theme");
  set("Theme", themeName ?? be?.theme ?? null,
      themeName ? "core" : "brickeconomy",
      themeName ? "product.theme" : "brickeconomy.theme");
  set("LEGO Subtheme", product.subtheme_name ?? be?.subtheme ?? null,
      product.subtheme_name ? "core" : "brickeconomy",
      product.subtheme_name ? "product.subtheme_name" : "brickeconomy.subtheme");

  // Set number / model
  const setNumber = product.set_number ?? product.mpn?.split(".")[0]?.split("-")[0] ?? null;
  set("LEGO Set Number", setNumber, "core", "product.set_number");
  set("Model", setNumber, "core", "product.set_number");
  set("MPN", product.mpn ?? null, "core", "product.mpn");
  set("Set Name", product.name ?? null, "core", "product.name");

  // Pieces
  const pieces = product.piece_count ?? be?.pieces_count ?? null;
  set("Number of Pieces", pieces != null ? String(pieces) : null,
      product.piece_count != null ? "core" : "brickeconomy",
      product.piece_count != null ? "product.piece_count" : "brickeconomy.pieces_count");

  // Year
  const year = product.release_year ??
               (product.released_date ? Number(product.released_date.slice(0, 4)) : null) ??
               be?.year ?? null;
  set("Year Manufactured", year != null ? String(year) : null,
      product.release_year != null ? "core" : "brickeconomy",
      product.release_year != null ? "product.release_year" : "brickeconomy.year");

  // Age — prefer age_mark over age_range; both are "8+" / "12+" style
  const age = product.age_mark ?? product.age_range ?? null;
  set("Recommended Age Range", age, "core", "product.age_mark");
  set("Age Level", age, "core", "product.age_mark");

  // EAN / UPC
  set("EAN", product.ean ?? null, "core", "product.ean");

  // Type / packaging defaults — derivable from product_type
  const isMinifig = product.product_type === "minifig" || product.product_type === "minifigure";
  set("Type", isMinifig ? "Minifigure" : "Complete Set", "constant", "product.product_type");
  if (!isMinifig) {
    set("Packaging", "Box", "constant", "default");
  }

  // Weight (eBay typically wants grams as a separate listing field, not aspect)
  // Dimensions likewise. Skipped here.

  // Custom core attributes added via the UI (registry-extension feature)
  // Use the same key as the user typed; this lets the registry surface new
  // canonical fields without a backend change.
  for (const [key, value] of Object.entries(customCore)) {
    set(key, value, "custom", "product_attribute(core)");
  }

  return out;
}

/**
 * Filter a resolved-aspect map to only the eBay schema's known aspect keys
 * (case-insensitive match), and report any required aspects that have no value.
 */
export function reconcileWithSchema(
  resolved: Record<string, ResolvedAspect>,
  schema: { key: string; required: boolean }[],
): {
  resolved: Record<string, ResolvedAspect>;
  missing: { key: string; required: boolean }[];
} {
  const lower = new Map(Object.keys(resolved).map((k) => [k.toLowerCase(), k]));
  const out: Record<string, ResolvedAspect> = {};
  const missing: { key: string; required: boolean }[] = [];

  for (const a of schema) {
    const match = lower.get(a.key.toLowerCase());
    if (match) {
      out[a.key] = { ...resolved[match], key: a.key };
    } else {
      missing.push({ key: a.key, required: a.required });
    }
  }
  return { resolved: out, missing };
}

// LEGO-relevant ancestor categories per marketplace, used when
// auto-detecting an eBay category. Anchored to top-level "LEGO" nodes.
export const LEGO_ANCESTOR_IDS: Record<string, Set<string>> = {
  // EBAY_GB: 19006 = LEGO Building Toys; 49019 = LEGO Minifigures
  EBAY_GB: new Set(["19006", "49019", "183446", "183448", "183452"]),
  EBAY_US: new Set(["19006", "49019", "183446", "183448", "183452"]),
  EBAY_DE: new Set(["19006", "49019"]),
  EBAY_AU: new Set(["19006", "49019"]),
};
