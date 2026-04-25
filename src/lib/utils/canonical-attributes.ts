// ============================================================
// Canonical Attribute Registry
//
// The single source of truth for product attributes shown on the
// Specifications tab. Each entry knows:
//   • how to RESOLVE its current value from the product object
//     (with BrickEconomy fallback) — pure read
//   • how to PERSIST a user edit back to the product table
//   • the editor type (text / number / date / textarea / readOnly)
//   • whether the value originally comes from BrickEconomy (so the
//     UI can show a "From BrickEconomy" / "Overridden" badge and an
//     entry can be tracked in product.field_overrides)
//
// Adding a new entry to CANONICAL_ATTRIBUTES is the only change
// required to surface a new attribute on the tab. The backend
// channel-aspect-map.ts is responsible for projecting these values
// into channel-specific schemas (eBay, GMC, Meta) — never duplicate
// the rendering on those channels.
// ============================================================

import type { ProductDetail, BrickEconomyData } from "@/lib/types/admin";

export type AttributeEditor = "text" | "number" | "date" | "textarea" | "readOnly";

export interface CanonicalAttribute {
  /** UI key, must be unique. Mirrors the product field name where possible. */
  key: string;
  /** Display label */
  label: string;
  /** Editor type */
  editor: AttributeEditor;
  /** Read the current value from the resolved product object. */
  read: (product: ProductDetail) => string;
  /** Read the BrickEconomy-derived value, if any. */
  readBE?: (be: BrickEconomyData | null | undefined) => string | null;
  /**
   * Map UI key → product table column name(s). Used by the save flow.
   * Multiple columns may be written for one UI field (rare).
   */
  dbColumn?: string;
  /** Optional value transform when writing back to the DB. */
  toDb?: (formValue: string) => unknown;
  /** Group label (for future sectioning) */
  group?: "identity" | "physical" | "lifecycle" | "marketing";
}

const numberOrNull = (v: string): number | null => {
  if (!v.trim()) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const stringOrNull = (v: string): string | null => v.trim() || null;

export const CANONICAL_ATTRIBUTES: CanonicalAttribute[] = [
  // ── Identity ─────────────────────────────────────────────
  {
    key: "mpn",
    label: "MPN",
    editor: "readOnly",
    group: "identity",
    read: (p) => p.mpn ?? "",
  },
  {
    key: "name",
    label: "Set Name",
    editor: "text",
    group: "identity",
    dbColumn: "name",
    toDb: stringOrNull,
    read: (p) => p.name ?? "",
  },
  {
    key: "setNumber",
    label: "Set Number",
    editor: "text",
    group: "identity",
    dbColumn: "set_number",
    toDb: stringOrNull,
    read: (p) => p.setNumber ?? "",
  },
  {
    key: "theme",
    label: "Theme",
    editor: "readOnly",
    group: "identity",
    read: (p) => p.theme ?? "",
    readBE: (be) => be?.theme ?? null,
  },
  {
    key: "subtheme",
    label: "Subtheme",
    editor: "text",
    group: "identity",
    dbColumn: "subtheme_name",
    toDb: stringOrNull,
    read: (p) => p.subtheme ?? "",
    readBE: (be) => be?.subtheme ?? null,
  },

  // ── Physical ────────────────────────────────────────────
  {
    key: "pieceCount",
    label: "Pieces",
    editor: "number",
    group: "physical",
    dbColumn: "piece_count",
    toDb: numberOrNull,
    read: (p) => p.pieceCount != null ? String(p.pieceCount) : "",
    readBE: (be) => be?.piecesCount != null ? String(be.piecesCount) : null,
  },
  {
    key: "ageMark",
    label: "Age Mark",
    editor: "text",
    group: "physical",
    dbColumn: "age_mark",
    toDb: stringOrNull,
    read: (p) => p.ageMark ?? "",
  },
  {
    key: "dimensionsCm",
    label: "Dimensions (cm)",
    editor: "text",
    group: "physical",
    dbColumn: "dimensions_cm",
    toDb: stringOrNull,
    read: (p) => p.dimensionsCm ?? "",
  },
  {
    key: "weightG",
    label: "Weight (g)",
    editor: "number",
    group: "physical",
    dbColumn: "weight_g",
    toDb: numberOrNull,
    read: (p) => p.weightG != null ? String(p.weightG) : "",
  },

  // ── Identifiers ─────────────────────────────────────────
  {
    key: "ean",
    label: "EAN",
    editor: "text",
    group: "identity",
    dbColumn: "ean",
    toDb: stringOrNull,
    read: (p) => p.ean ?? "",
  },

  // ── Lifecycle ───────────────────────────────────────────
  {
    key: "releaseDate",
    label: "Released",
    editor: "date",
    group: "lifecycle",
    dbColumn: "released_date",
    toDb: stringOrNull,
    read: (p) => p.releaseDate ?? "",
    readBE: (be) => be?.releasedDate ?? null,
  },
  {
    key: "retiredDate",
    label: "Retired",
    editor: "date",
    group: "lifecycle",
    dbColumn: "retired_date",
    toDb: stringOrNull,
    read: (p) => p.retiredDate ?? "",
    readBE: (be) => be?.retiredDate ?? null,
  },
];

// Convenience map by key.
export const CANONICAL_BY_KEY: Record<string, CanonicalAttribute> =
  Object.fromEntries(CANONICAL_ATTRIBUTES.map((a) => [a.key, a]));
