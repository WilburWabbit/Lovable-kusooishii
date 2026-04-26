// ============================================================
// Specifications resolver (channel-agnostic)
//
// For one product + one channel category, returns a list of
// SpecRow items. Each row combines:
//
//   • the channel aspect schema (key, label, required, cardinality,
//     allowed_values, allows_custom, data_type)
//   • the active mapping for that category (canonical key OR constant
//     OR unmapped)
//   • the automatically resolved value (read from the canonical
//     provider chain)
//   • the saved per-product value (from product_attribute scoped to
//     this exact channel/marketplace/category/aspect)
//   • the `effectiveValue` to publish (saved value > auto value)
//
// The Specifications tab and the eBay publisher both consume this
// shape, so there is exactly one source of truth.
// ============================================================

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";
import {
  loadProviderBundle,
  resolveAttribute,
  type CanonicalAttributeRow,
  type ProviderBundle,
} from "./canonical-resolver.ts";

export interface AspectRow {
  key: string;
  label: string;
  required: boolean;
  cardinality: "single" | "multi";
  dataType: string;
  allowedValues: string[] | null;
  allowsCustom: boolean;
  sortOrder: number;
}

export interface SpecRow extends AspectRow {
  // Mapping
  mappingId: string | null;
  mappingScope: "category" | "marketplace" | "default" | "none";
  canonicalKey: string | null;
  constantValue: string | null;

  // Auto-resolved value (from canonical / constant)
  autoValue: string | null;
  autoSource:
    | "product"
    | "brickeconomy"
    | "catalog"
    | "rebrickable"
    | "theme"
    | "constant"
    | "derived"
    | "override"
    | "none"
    | null;

  // Manually saved value (always wins)
  savedValue: string | string[] | null;
  isOverride: boolean;
  sourceValue: string | null;

  // Final value the channel will publish
  effectiveValue: string | string[] | null;
  effectiveSource: "saved" | "constant" | "canonical" | "none";
}

export interface ResolvedSpecs {
  channel: "ebay" | "gmc" | "meta";
  marketplace: string;
  categoryId: string | null;
  categoryName: string | null;
  schemaLoaded: boolean;
  rows: SpecRow[];
  resolvedCount: number;
  totalCount: number;
  missingRequiredCount: number;
}

interface MappingRow {
  id: string;
  channel: string;
  marketplace: string | null;
  category_id: string | null;
  aspect_key: string;
  canonical_key: string | null;
  constant_value: string | null;
}

interface SavedValueRow {
  id: string;
  channel: string | null;
  marketplace: string | null;
  category_id: string | null;
  aspect_key: string | null;
  key: string;
  value: string | null;
  value_json: unknown;
  is_override: boolean;
  source_value: string | null;
  source: string;
}

function mappingScore(m: MappingRow): number {
  return (m.marketplace ? 2 : 0) + (m.category_id ? 1 : 0);
}

export async function resolveSpecsForProduct(
  admin: SupabaseClient,
  input: {
    productId: string;
    channel: "ebay" | "gmc" | "meta";
    marketplace: string;
    categoryId: string | null;
  },
): Promise<ResolvedSpecs> {
  const { productId, channel, marketplace } = input;
  const categoryId = input.categoryId ?? null;

  // 1. Load eBay schema for this category
  let categoryName: string | null = null;
  let aspects: AspectRow[] = [];

  if (categoryId) {
    const { data: schemaRow } = await admin
      .from("channel_category_schema")
      .select("id, category_name")
      .eq("channel", channel)
      .eq("marketplace", marketplace)
      .eq("category_id", categoryId)
      .maybeSingle();

    if (schemaRow?.id) {
      categoryName = (schemaRow as Record<string, unknown>).category_name as
        | string
        | null;
      const { data: attrRows } = await admin
        .from("channel_category_attribute")
        .select(
          "key, label, required, cardinality, data_type, allowed_values, allows_custom, sort_order",
        )
        .eq("schema_id", (schemaRow as Record<string, unknown>).id as string)
        .order("sort_order", { ascending: true });

      aspects = ((attrRows ?? []) as Array<Record<string, unknown>>).map(
        (r) => ({
          key: r.key as string,
          label: (r.label as string | null) ?? (r.key as string),
          required: (r.required as boolean) ?? false,
          cardinality: ((r.cardinality as string) ?? "single") as
            | "single"
            | "multi",
          dataType: (r.data_type as string) ?? "string",
          allowedValues: (r.allowed_values as string[] | null) ?? null,
          allowsCustom: (r.allows_custom as boolean) ?? true,
          sortOrder: (r.sort_order as number) ?? 0,
        }),
      );
    }
  }

  // 2. Load mappings for this channel — most-specific wins per aspect_key.
  const { data: rawMappings } = await admin
    .from("channel_attribute_mapping")
    .select(
      "id, channel, marketplace, category_id, aspect_key, canonical_key, constant_value",
    )
    .eq("channel", channel);

  const mapByAspect = new Map<string, MappingRow>();
  for (const raw of (rawMappings ?? []) as MappingRow[]) {
    const matchesMkt = !raw.marketplace || raw.marketplace === marketplace;
    const matchesCat = !raw.category_id || raw.category_id === categoryId;
    if (!matchesMkt || !matchesCat) continue;
    const cur = mapByAspect.get(raw.aspect_key);
    if (!cur || mappingScore(raw) > mappingScore(cur)) {
      mapByAspect.set(raw.aspect_key, raw);
    }
  }

  // 3. Load canonical attribute registry (for auto-resolving canonical_key
  //    references). We only need the ones referenced by mappings.
  const referencedCanonicalKeys = Array.from(
    new Set(
      Array.from(mapByAspect.values())
        .map((m) => m.canonical_key)
        .filter((k): k is string => !!k),
    ),
  );

  let canonicalRows: CanonicalAttributeRow[] = [];
  if (referencedCanonicalKeys.length > 0) {
    const { data } = await admin
      .from("canonical_attribute")
      .select(
        "key, label, attribute_group, editor, data_type, unit, db_column, provider_chain, editable, sort_order, active, applies_to_product_types, applies_to_ebay_categories",
      )
      .in("key", referencedCanonicalKeys);
    canonicalRows = (data ?? []) as CanonicalAttributeRow[];
  }

  const bundle: ProviderBundle = await loadProviderBundle(admin, productId);

  const canonicalByKey = new Map<string, CanonicalAttributeRow>();
  for (const r of canonicalRows) canonicalByKey.set(r.key, r);

  // 4. Load saved per-product values for this exact scope.
  const { data: savedRows } = await admin
    .from("product_attribute")
    .select(
      "id, channel, marketplace, category_id, aspect_key, key, value, value_json, is_override, source_value, source",
    )
    .eq("product_id", productId)
    .eq("namespace", channel)
    .eq("channel", channel)
    .eq("marketplace", marketplace)
    .eq("category_id", categoryId ?? "")
    .not("aspect_key", "is", null);

  const savedByAspect = new Map<string, SavedValueRow>();
  for (const row of (savedRows ?? []) as SavedValueRow[]) {
    if (row.aspect_key) savedByAspect.set(row.aspect_key, row);
  }

  // 5. Build the rows
  const rows: SpecRow[] = aspects.map((a) => {
    const mapping = mapByAspect.get(a.key) ?? null;
    const saved = savedByAspect.get(a.key) ?? null;

    let autoValue: string | null = null;
    let autoSource: SpecRow["autoSource"] = null;

    if (mapping?.constant_value != null && !mapping.canonical_key) {
      autoValue = mapping.constant_value;
      autoSource = "constant";
    } else if (mapping?.canonical_key) {
      const canon = canonicalByKey.get(mapping.canonical_key);
      if (canon) {
        const resolved = resolveAttribute(canon, bundle);
        autoValue = resolved.value ?? null;
        autoSource = resolved.source;
      }
    }

    const savedValue: string | string[] | null = saved
      ? Array.isArray(saved.value_json)
        ? (saved.value_json as string[])
        : (saved.value ?? null)
      : null;

    const hasSaved =
      savedValue != null &&
      (Array.isArray(savedValue) ? savedValue.length > 0 : savedValue !== "");

    let effectiveValue: string | string[] | null = null;
    let effectiveSource: SpecRow["effectiveSource"] = "none";
    if (hasSaved) {
      effectiveValue = savedValue;
      effectiveSource = "saved";
    } else if (autoValue != null && autoValue !== "") {
      effectiveValue = autoValue;
      effectiveSource = autoSource === "constant" ? "constant" : "canonical";
    }

    const scope: SpecRow["mappingScope"] = !mapping
      ? "none"
      : mapping.category_id
        ? "category"
        : mapping.marketplace
          ? "marketplace"
          : "default";

    return {
      ...a,
      mappingId: mapping?.id ?? null,
      mappingScope: scope,
      canonicalKey: mapping?.canonical_key ?? null,
      constantValue: mapping?.constant_value ?? null,
      autoValue,
      autoSource,
      savedValue,
      isOverride: saved?.is_override ?? false,
      sourceValue: saved?.source_value ?? null,
      effectiveValue,
      effectiveSource,
    };
  });

  const resolvedCount = rows.filter(
    (r) => r.effectiveValue != null && r.effectiveValue !== "",
  ).length;
  const missingRequiredCount = rows.filter(
    (r) =>
      r.required &&
      (r.effectiveValue == null ||
        r.effectiveValue === "" ||
        (Array.isArray(r.effectiveValue) && r.effectiveValue.length === 0)),
  ).length;

  return {
    channel,
    marketplace,
    categoryId,
    categoryName,
    schemaLoaded: aspects.length > 0,
    rows,
    resolvedCount,
    totalCount: rows.length,
    missingRequiredCount,
  };
}
