// ============================================================
// Canonical Attribute Resolver (DB-driven)
// Loads every provider available for a product and walks each
// canonical_attribute.provider_chain to produce a final value
// + source label per canonical key. Then loads the per-channel
// mapping table to project canonical values onto channel aspects.
// ============================================================

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";

export type ProviderName =
  | "product"
  | "brickeconomy"
  | "catalog"
  | "rebrickable"
  | "theme"
  | "constant"
  | "derived";

export interface ProviderStep {
  provider: ProviderName;
  field: string;
}

export interface CanonicalAttributeRow {
  key: string;
  label: string;
  attribute_group: string;
  editor: string;
  data_type: string;
  unit: string | null;
  db_column: string | null;
  provider_chain: ProviderStep[];
  editable: boolean;
  sort_order: number;
  active: boolean;
  applies_to_product_types: string[] | null;
  applies_to_ebay_categories: string[] | null;
}

export interface ResolvedCanonicalValue {
  key: string;
  label: string;
  value: string | string[] | null;
  raw: unknown;
  source: ProviderName | "override" | "none";
  sourceField: string | null;
  editor: string;
  dataType: string;
  unit: string | null;
  dbColumn: string | null;
  editable: boolean;
  sortOrder: number;
  group: string;
  isOverride: boolean;
}

export interface ChannelAspectMappingRow {
  channel: string;
  marketplace: string | null;
  category_id: string | null;
  aspect_key: string;
  canonical_key: string | null;
  constant_value: string | null;
  transform: string | null;
}

export interface SetMinifigRow {
  fig_num: string;
  minifig_name: string | null;
  bricklink_id: string | null;
  minifig_img_url: string | null;
  quantity: number | null;
}

export interface ProviderBundle {
  product: Record<string, unknown> | null;
  theme: Record<string, unknown> | null;
  brickeconomy: Record<string, unknown> | null;
  catalog: Record<string, unknown> | null;
  rebrickable: Record<string, unknown> | null;
  minifigs: SetMinifigRow[];
  fieldOverrides: Record<string, unknown>;
}

// ─── Load every provider for a product ──────────────────────

export async function loadProviderBundle(
  admin: SupabaseClient,
  productId: string,
): Promise<ProviderBundle> {
  const { data: product } = await admin
    .from("product")
    .select("*")
    .eq("id", productId)
    .maybeSingle();

  if (!product) {
    return {
      product: null,
      theme: null,
      brickeconomy: null,
      catalog: null,
      rebrickable: null,
      minifigs: [],
      fieldOverrides: {},
    };
  }

  const productRow = product as Record<string, unknown>;
  const fieldOverrides = (productRow.field_overrides as Record<string, unknown>) ?? {};

  let themeRow: Record<string, unknown> | null = null;
  if (productRow.theme_id) {
    const { data } = await admin
      .from("theme")
      .select("name, slug")
      .eq("id", productRow.theme_id as string)
      .maybeSingle();
    themeRow = data as Record<string, unknown> | null;
  }

  // BrickEconomy lookup — match either suffixed or bare set number.
  const setNumber =
    (productRow.set_number as string | null) ??
    (productRow.mpn as string | null)?.split(".")[0]?.split("-")[0] ??
    null;

  let beRow: Record<string, unknown> | null = null;
  if (setNumber) {
    const variants = [setNumber, `${setNumber}-1`];
    const { data } = await admin
      .from("brickeconomy_collection")
      .select("*")
      .eq("item_type", "set")
      .in("item_number", variants)
      .order("synced_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    beRow = data as Record<string, unknown> | null;
  }

  let catalogRow: Record<string, unknown> | null = null;
  if (productRow.lego_catalog_id) {
    const { data } = await admin
      .from("lego_catalog")
      .select("*")
      .eq("id", productRow.lego_catalog_id as string)
      .maybeSingle();
    catalogRow = data as Record<string, unknown> | null;
  } else if (productRow.mpn) {
    const { data } = await admin
      .from("lego_catalog")
      .select("*")
      .eq("mpn", productRow.mpn as string)
      .maybeSingle();
    catalogRow = data as Record<string, unknown> | null;
  }

  // Rebrickable: stored on the product as `rebrickable_id`; we don't have a
  // dedicated cache table yet, so this is a placeholder that other features
  // can populate later.
  const rebrickableRow: Record<string, unknown> | null = null;

  // Set ↔ minifig relationship via the lego_set_minifigs view. We use the
  // bare set number (e.g. "75367-1") which the Rebrickable sync stores as
  // `set_num` on rebrickable_inventories. Fail-soft on errors so a missing
  // view or no inventory doesn't break attribute resolution.
  let minifigRows: SetMinifigRow[] = [];
  if (setNumber) {
    const candidates = [setNumber, `${setNumber}-1`];
    try {
      const { data } = await admin
        .from("lego_set_minifigs" as never)
        .select("fig_num, minifig_name, bricklink_id, minifig_img_url, quantity")
        .in("set_num" as never, candidates);
      minifigRows = ((data ?? []) as unknown) as SetMinifigRow[];
    } catch (_e) {
      minifigRows = [];
    }
  }

  return {
    product: productRow,
    theme: themeRow,
    brickeconomy: beRow,
    catalog: catalogRow,
    rebrickable: rebrickableRow,
    minifigs: minifigRows,
    fieldOverrides,
  };
}

// ─── Walk the provider chain to resolve one attribute ──────

function readFromProvider(
  step: ProviderStep,
  bundle: ProviderBundle,
  attr: CanonicalAttributeRow,
): unknown {
  switch (step.provider) {
    case "product":
      return bundle.product?.[step.field];
    case "brickeconomy":
      return bundle.brickeconomy?.[step.field];
    case "catalog":
      return bundle.catalog?.[step.field];
    case "rebrickable":
      return bundle.rebrickable?.[step.field];
    case "theme":
      return bundle.theme?.[step.field];
    case "constant":
      return step.field;
    case "derived":
      return derive(step.field, bundle, attr);
    default:
      return undefined;
  }
}

function derive(
  rule: string,
  bundle: ProviderBundle,
  _attr: CanonicalAttributeRow,
): unknown {
  switch (rule) {
    case "mpn_base": {
      const mpn = bundle.product?.mpn as string | undefined;
      return mpn?.split(".")[0]?.split("-")[0] ?? null;
    }
    case "year_from_released_date": {
      const d = (bundle.product?.released_date as string | null) ??
                (bundle.brickeconomy?.released_date as string | null);
      if (!d) return null;
      const y = Number(d.slice(0, 4));
      return Number.isFinite(y) ? y : null;
    }
    case "weight_kg_to_g": {
      const kg = bundle.product?.weight_kg as number | null;
      if (kg == null) return null;
      return Math.round(kg * 1000);
    }
    case "parse_dimensions_cm_length":
      return parseDimensionsCm(bundle, 0);
    case "parse_dimensions_cm_width":
      return parseDimensionsCm(bundle, 1);
    case "parse_dimensions_cm_height":
      return parseDimensionsCm(bundle, 2);
    case "compose_dimensions_cm": {
      const l = bundle.product?.length_cm as number | null;
      const w = bundle.product?.width_cm as number | null;
      const h = bundle.product?.height_cm as number | null;
      if (l == null && w == null && h == null) return null;
      return [l, w, h].map((n) => (n == null ? "?" : String(n))).join("x");
    }
    default:
      return null;
  }
}

// "38x26x7" / "38 x 26 x 7" / "38×26×7" → number at index, or null.
function parseDimensionsCm(bundle: ProviderBundle, index: 0 | 1 | 2): number | null {
  const raw = bundle.product?.dimensions_cm as string | null | undefined;
  if (!raw || typeof raw !== "string") return null;
  const parts = raw
    .split(/[x×*,]/i)
    .map((p) => Number(p.trim()))
    .filter((n) => Number.isFinite(n));
  if (parts.length <= index) return null;
  return parts[index];
}

function isEmpty(v: unknown): boolean {
  if (v == null) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

export function resolveAttribute(
  attr: CanonicalAttributeRow,
  bundle: ProviderBundle,
): ResolvedCanonicalValue {
  // 1. Manual override always wins (tracked in product.field_overrides).
  const dbCol = attr.db_column;
  const isOverride = !!(dbCol && bundle.fieldOverrides?.[dbCol] != null);

  // 2. Walk the chain.
  let raw: unknown = null;
  let source: ResolvedCanonicalValue["source"] = "none";
  let sourceField: string | null = null;

  for (const step of attr.provider_chain ?? []) {
    const v = readFromProvider(step, bundle, attr);
    if (!isEmpty(v)) {
      raw = v;
      source = step.provider;
      sourceField = step.field;
      break;
    }
  }

  if (isOverride) source = "override";

  return {
    key: attr.key,
    label: attr.label,
    value: raw == null ? null : String(raw),
    raw,
    source,
    sourceField,
    editor: attr.editor,
    dataType: attr.data_type,
    unit: attr.unit,
    dbColumn: attr.db_column,
    editable: attr.editable,
    sortOrder: attr.sort_order,
    group: attr.attribute_group,
    isOverride,
  };
}

// ─── Resolve every canonical attribute for a product ───────

export async function resolveAllForProduct(
  admin: SupabaseClient,
  productId: string,
  scope?: { productType?: string | null; ebayCategoryId?: string | null },
): Promise<{
  bundle: ProviderBundle;
  attributes: CanonicalAttributeRow[];
  resolved: ResolvedCanonicalValue[];
  byKey: Record<string, ResolvedCanonicalValue>;
}> {
  const bundle = await loadProviderBundle(admin, productId);

  // Pull product_type from the bundle if not explicitly provided.
  const productType =
    scope?.productType ??
    (bundle.product?.product_type as string | null | undefined) ??
    null;
  const ebayCategoryId =
    scope?.ebayCategoryId ??
    (bundle.product?.ebay_category_id as string | null | undefined) ??
    null;

  const { data: attrRows } = await admin
    .from("canonical_attribute")
    .select(
      "key, label, attribute_group, editor, data_type, unit, db_column, provider_chain, editable, sort_order, active, applies_to_product_types, applies_to_ebay_categories"
    )
    .eq("active", true)
    .order("sort_order", { ascending: true });

  const allRows = (attrRows ?? []) as CanonicalAttributeRow[];

  // Apply scope filters: if an attribute declares applies_to_*, the
  // corresponding value must match. NULL/empty arrays = applies to all.
  const attributes = allRows.filter((a) => {
    const types = a.applies_to_product_types;
    if (Array.isArray(types) && types.length > 0) {
      if (!productType || !types.includes(productType)) return false;
    }
    const cats = a.applies_to_ebay_categories;
    if (Array.isArray(cats) && cats.length > 0) {
      if (!ebayCategoryId || !cats.includes(ebayCategoryId)) return false;
    }
    return true;
  });

  const resolved = attributes.map((a) => resolveAttribute(a, bundle));
  const byKey: Record<string, ResolvedCanonicalValue> = {};
  for (const r of resolved) byKey[r.key] = r;

  return { bundle, attributes, resolved, byKey };
}

// ─── Project canonical values onto a channel category ──────

export interface ChannelAspect {
  aspectKey: string;
  required: boolean;
  cardinality: "single" | "multi";
  dataType: string;
  allowedValues: string[] | null;
  allowsCustom: boolean;
  sortOrder: number;
}

export interface MappedAspect {
  aspectKey: string;
  required: boolean;
  value: string | null;
  source: "canonical" | "constant" | "unmapped" | "none";
  canonicalKey: string | null;
  canonicalSource: ResolvedCanonicalValue["source"] | null;
  constantValue: string | null;
}

export async function projectToChannel(
  admin: SupabaseClient,
  input: {
    channel: string;
    marketplace: string;
    categoryId: string | null;
    schemaId: string | null;
    canonicalByKey: Record<string, ResolvedCanonicalValue>;
  },
): Promise<{
  aspects: ChannelAspect[];
  mapped: MappedAspect[];
  resolvedCount: number;
  totalSchemaCount: number;
  missingRequiredCount: number;
}> {
  const { channel, marketplace, categoryId, schemaId, canonicalByKey } = input;

  // Load schema aspects (required for the projection).
  let aspects: ChannelAspect[] = [];
  if (schemaId) {
    const { data: aspectRows } = await admin
      .from("channel_category_attribute")
      .select("key, required, cardinality, data_type, allowed_values, allows_custom, sort_order")
      .eq("schema_id", schemaId)
      .order("sort_order", { ascending: true });
    aspects = (aspectRows ?? []).map((r: any) => ({
      aspectKey: r.key,
      required: r.required,
      cardinality: r.cardinality,
      dataType: r.data_type,
      allowedValues: r.allowed_values,
      allowsCustom: r.allows_custom,
      sortOrder: r.sort_order,
    }));
  }

  // Load mapping rows: per-category overrides PLUS channel-wide defaults.
  // Per-category wins by aspect_key.
  const { data: mapRowsRaw } = await admin
    .from("channel_attribute_mapping")
    .select("channel, marketplace, category_id, aspect_key, canonical_key, constant_value, transform")
    .eq("channel", channel)
    .or(`marketplace.eq.${marketplace},marketplace.is.null`)
    .or(`category_id.eq.${categoryId ?? ""},category_id.is.null`);

  const mapRows = (mapRowsRaw ?? []) as ChannelAspectMappingRow[];

  // Build effective map: prefer most-specific (marketplace+category > marketplace > category > default).
  const score = (m: ChannelAspectMappingRow) =>
    (m.marketplace ? 2 : 0) + (m.category_id ? 1 : 0);

  const byAspect = new Map<string, ChannelAspectMappingRow>();
  for (const m of mapRows) {
    const cur = byAspect.get(m.aspect_key);
    if (!cur || score(m) > score(cur)) byAspect.set(m.aspect_key, m);
  }

  const mapped: MappedAspect[] = aspects.map((a) => {
    const m = byAspect.get(a.aspectKey);
    if (!m) {
      return {
        aspectKey: a.aspectKey,
        required: a.required,
        value: null,
        source: "unmapped",
        canonicalKey: null,
        canonicalSource: null,
        constantValue: null,
      };
    }
    if (m.constant_value != null && (m.canonical_key == null)) {
      return {
        aspectKey: a.aspectKey,
        required: a.required,
        value: m.constant_value,
        source: "constant",
        canonicalKey: null,
        canonicalSource: null,
        constantValue: m.constant_value,
      };
    }
    if (m.canonical_key) {
      const cv = canonicalByKey[m.canonical_key];
      return {
        aspectKey: a.aspectKey,
        required: a.required,
        value: cv?.value ?? null,
        source: cv?.value ? "canonical" : "none",
        canonicalKey: m.canonical_key,
        canonicalSource: cv?.source ?? null,
        constantValue: null,
      };
    }
    return {
      aspectKey: a.aspectKey,
      required: a.required,
      value: null,
      source: "unmapped",
      canonicalKey: null,
      canonicalSource: null,
      constantValue: null,
    };
  });

  const resolvedCount = mapped.filter((m) => m.value != null && m.value !== "").length;
  const missingRequiredCount = mapped.filter(
    (m) => m.required && (m.value == null || m.value === ""),
  ).length;

  return {
    aspects,
    mapped,
    resolvedCount,
    totalSchemaCount: aspects.length,
    missingRequiredCount,
  };
}
