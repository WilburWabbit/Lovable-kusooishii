// ============================================================
// Admin V2 — Channel Taxonomy & Item Specifics
// Hooks for eBay (and future GMC/Meta) category selection,
// auto-resolution, aspect schema fetching, and per-product
// attribute storage. All channel-specific mapping happens on the
// backend (see supabase/functions/_shared/channel-aspect-map.ts).
// ============================================================

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { invokeWithAuth } from "@/lib/invokeWithAuth";
import type {
  ChannelCategorySuggestion,
  ChannelCategoryAttribute,
  ProductAttribute,
} from "@/lib/types/admin";

export type AspectSource = "core" | "brickeconomy" | "constant" | "custom";

export interface ResolvedAspect {
  key: string;
  value: string;
  source: AspectSource;
  basis: string;
}

// ─── DB-driven canonical resolution ─────────────────────────

export type CanonicalProvider =
  | "product"
  | "brickeconomy"
  | "catalog"
  | "rebrickable"
  | "theme"
  | "constant"
  | "derived"
  | "override"
  | "none";

export interface ResolvedCanonicalValue {
  key: string;
  label: string;
  value: string | null;
  source: CanonicalProvider;
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

export interface MappedAspect {
  aspectKey: string;
  required: boolean;
  value: string | null;
  source: "canonical" | "constant" | "unmapped" | "none";
  canonicalKey: string | null;
  canonicalSource: CanonicalProvider | null;
  constantValue: string | null;
}

export interface SpecRow {
  key: string;
  label: string;
  required: boolean;
  cardinality: "single" | "multi";
  dataType: string;
  allowedValues: string[] | null;
  allowsCustom: boolean;
  sortOrder: number;
  mappingId: string | null;
  mappingScope: "category" | "marketplace" | "default" | "none";
  canonicalKey: string | null;
  constantValue: string | null;
  autoValue: string | string[] | null;
  autoSource: CanonicalProvider | null;
  savedValue: string | string[] | null;
  isOverride: boolean;
  sourceValue: string | null;
  effectiveValue: string | string[] | null;
  effectiveSource: "saved" | "constant" | "canonical" | "none";
}

export interface ChannelAspectsResolution {
  categoryId: string;
  categoryName: string | null;
  schemaLoaded: boolean;
  resolvedCount: number;
  totalSchemaCount: number;
  missingRequiredCount: number;
  canonical: ResolvedCanonicalValue[];
  aspects: MappedAspect[];
  rows: SpecRow[];
}

export interface AutoCategoryResult {
  categoryId: string | null;
  categoryName: string | null;
  confidence: "high" | "medium" | "low";
  basis: string;
  ancestors?: { id: string; name: string }[];
}

export const taxonomyKeys = {
  suggest: (channel: string, marketplace: string, q: string) =>
    ["taxonomy", channel, marketplace, "suggest", q] as const,
  subtree: (channel: string, marketplace: string, parentId: string | null) =>
    ["taxonomy", channel, marketplace, "subtree", parentId ?? "root"] as const,
  aspects: (channel: string, marketplace: string, categoryId: string) =>
    ["taxonomy", channel, marketplace, "aspects", categoryId] as const,
  resolved: (channel: string, marketplace: string, productId: string, categoryId: string) =>
    ["taxonomy", channel, marketplace, "resolved", productId, categoryId] as const,
  autoCategory: (productId: string, marketplace: string) =>
    ["taxonomy", "ebay", marketplace, "auto-category", productId] as const,
  attributes: (productId: string, namespace?: string) =>
    ["product-attributes", productId, namespace ?? "all"] as const,
  productCategories: (channel: string, marketplace: string) =>
    ["taxonomy", channel, marketplace, "product-categories"] as const,
};

// ─── Categories already in use by products ─────────────────

export interface ProductCategoryUsage {
  categoryId: string;
  categoryName: string | null;
  productCount: number;
}

/**
 * Fetch the distinct eBay categories already assigned to at least one
 * product, with usage counts. Used by the Settings → Mappings page so
 * staff can pick a category that exists in the catalog without typing.
 */
export function useProductChannelCategories(
  channel: "ebay" | "gmc" | "meta" = "ebay",
  marketplace: string = "EBAY_GB",
) {
  return useQuery({
    queryKey: taxonomyKeys.productCategories(channel, marketplace),
    staleTime: 1000 * 60 * 5,
    queryFn: async (): Promise<ProductCategoryUsage[]> => {
      const res = await invokeWithAuth<{ categories: ProductCategoryUsage[] }>(
        "ebay-taxonomy",
        { action: "list-product-categories", channel, marketplace },
      );
      return res.categories ?? [];
    },
  });
}

// ─── Auto category resolution (eBay) ───────────────────────

export function useAutoResolveEbayCategory(
  productId: string | undefined,
  marketplace: string = "EBAY_GB",
  enabled = true,
) {
  return useQuery({
    queryKey: taxonomyKeys.autoCategory(productId ?? "", marketplace),
    enabled: enabled && !!productId,
    staleTime: 1000 * 60 * 30,
    queryFn: async (): Promise<AutoCategoryResult> => {
      return await invokeWithAuth<AutoCategoryResult>("ebay-taxonomy", {
        action: "auto-resolve-category",
        product_id: productId,
        marketplace,
      });
    },
  });
}

// ─── Channel aspects resolution (server-side mapping) ──────

export function useResolveEbayAspects(
  productId: string | undefined,
  categoryId: string | null | undefined,
  marketplace: string = "EBAY_GB",
) {
  return useQuery({
    queryKey: taxonomyKeys.resolved("ebay", marketplace, productId ?? "", categoryId ?? ""),
    enabled: !!productId && !!categoryId,
    queryFn: async (): Promise<ChannelAspectsResolution> => {
      return await invokeWithAuth<ChannelAspectsResolution>("ebay-taxonomy", {
        action: "resolve-aspects",
        product_id: productId,
        categoryId,
        marketplace,
      });
    },
  });
}

// ─── eBay category suggestions ──────────────────────────────

export function useEbayCategorySuggestions(
  q: string,
  marketplace: string = "EBAY_GB",
  enabled = true,
) {
  return useQuery({
    queryKey: taxonomyKeys.suggest("ebay", marketplace, q),
    enabled: enabled && q.trim().length >= 2,
    queryFn: async (): Promise<ChannelCategorySuggestion[]> => {
      const res = await invokeWithAuth<{ suggestions: ChannelCategorySuggestion[] }>(
        "ebay-taxonomy",
        { action: "suggest", q, marketplace },
      );
      return res.suggestions ?? [];
    },
  });
}

// ─── eBay aspects (item specifics schema) ───────────────────

export interface AspectsResult {
  schemaId: string;
  categoryId: string;
  categoryName: string;
  fromCache: boolean;
  attributes: ChannelCategoryAttribute[];
}

export function useEbayCategoryAspects(
  categoryId: string | null | undefined,
  marketplace: string = "EBAY_GB",
) {
  return useQuery({
    queryKey: taxonomyKeys.aspects("ebay", marketplace, categoryId ?? ""),
    enabled: !!categoryId,
    staleTime: 1000 * 60 * 60, // 1h client cache
    queryFn: async (): Promise<AspectsResult> => {
      return await invokeWithAuth<AspectsResult>("ebay-taxonomy", {
        action: "aspects",
        categoryId,
        marketplace,
      });
    },
  });
}

export function useRefreshEbayAspects() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { categoryId: string; marketplace?: string }) => {
      const marketplace = input.marketplace ?? "EBAY_GB";
      return await invokeWithAuth<AspectsResult>("ebay-taxonomy", {
        action: "aspects",
        categoryId: input.categoryId,
        marketplace,
        force: true,
      });
    },
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({
        queryKey: taxonomyKeys.aspects("ebay", vars.marketplace ?? "EBAY_GB", vars.categoryId),
      });
    },
  });
}

// ─── Product channel category assignment ────────────────────

export function useSetProductChannelCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      productId: string;
      mpn: string;
      channel: "ebay" | "gmc" | "meta";
      categoryId: string | null;
      marketplace?: string;
    }) => {
      return await invokeWithAuth("admin-data", {
        action: "set-product-channel-category",
        product_id: input.productId,
        channel: input.channel,
        category_id: input.categoryId,
        marketplace: input.marketplace,
      });
    },
    onSuccess: async (_d, vars) => {
      // Invalidate the product detail (so ebayCategoryId re-reads from DB)
      // AND the auto-resolve cache (which becomes stale once an override
      // is set or cleared) AND the resolved-aspects cache for the product.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["v2", "products", vars.mpn] }),
        queryClient.invalidateQueries({ queryKey: ["v2", "products"] }),
        queryClient.invalidateQueries({
          queryKey: taxonomyKeys.autoCategory(vars.productId, vars.marketplace ?? "EBAY_GB"),
        }),
        queryClient.invalidateQueries({
          queryKey: ["taxonomy", "ebay", vars.marketplace ?? "EBAY_GB", "resolved", vars.productId],
        }),
      ]);
      // Force a refetch immediately so the UI shows the new value without
      // waiting for the next render-driven fetch.
      await queryClient.refetchQueries({
        queryKey: ["v2", "products", vars.mpn],
      });
    },
  });
}

export function useBulkSetProductChannelCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      productIds: string[];
      channel: "ebay" | "gmc" | "meta";
      categoryId: string | null;
      marketplace?: string;
    }) => {
      return await invokeWithAuth<{ success: boolean; updated: number }>(
        "admin-data",
        {
          action: "bulk-set-product-channel-category",
          product_ids: input.productIds,
          channel: input.channel,
          category_id: input.categoryId,
          marketplace: input.marketplace,
        },
      );
    },
    onSuccess: async (_d, vars) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["v2", "products"] }),
        queryClient.invalidateQueries({
          queryKey: taxonomyKeys.productCategories(
            vars.channel,
            vars.marketplace ?? "EBAY_GB",
          ),
        }),
      ]);
    },
  });
}

// ─── Product attributes (per-namespace) ─────────────────────

export function useProductAttributes(
  productId: string | undefined,
  namespace?: "core" | "ebay" | "gmc" | "meta",
) {
  return useQuery({
    queryKey: taxonomyKeys.attributes(productId ?? "", namespace),
    enabled: !!productId,
    queryFn: async (): Promise<ProductAttribute[]> => {
      const res = await invokeWithAuth<ProductAttribute[]>("admin-data", {
        action: "get-product-attributes",
        product_id: productId,
        namespace,
      });
      return res ?? [];
    },
  });
}

export function useSaveProductAttributes() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      productId: string;
      namespace: "core" | "ebay" | "gmc" | "meta";
      attributes: Record<string, string | string[]>;
      source?: string;
      channel?: string | null;
      marketplace?: string | null;
      categoryId?: string | null;
    }) => {
      return await invokeWithAuth("admin-data", {
        action: "save-product-attributes",
        product_id: input.productId,
        namespace: input.namespace,
        attributes: input.attributes,
        source: input.source,
        channel: input.channel ?? input.namespace,
        marketplace: input.marketplace ?? null,
        category_id: input.categoryId ?? null,
      });
    },
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({
        queryKey: taxonomyKeys.attributes(vars.productId, vars.namespace),
      });
      queryClient.invalidateQueries({
        queryKey: taxonomyKeys.attributes(vars.productId, "all"),
      });
      queryClient.invalidateQueries({ queryKey: ["taxonomy"] });
    },
  });
}

// ─── Canonical attribute registry CRUD ──────────────────────

export interface CanonicalAttributeRecord {
  id?: string;
  key: string;
  label: string;
  attribute_group: string;
  editor: string;
  data_type: string;
  unit: string | null;
  db_column: string | null;
  provider_chain: { provider: string; field: string }[];
  editable: boolean;
  sort_order: number;
  active: boolean;
}

export const canonicalAttrKeys = {
  list: () => ["canonical-attributes"] as const,
};

export function useCanonicalAttributes() {
  return useQuery({
    queryKey: canonicalAttrKeys.list(),
    queryFn: async (): Promise<CanonicalAttributeRecord[]> => {
      const res = await invokeWithAuth<{ attributes: CanonicalAttributeRecord[] }>(
        "ebay-taxonomy",
        { action: "list-canonical-attributes" },
      );
      return res.attributes ?? [];
    },
  });
}

export function useUpsertCanonicalAttribute() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (attribute: CanonicalAttributeRecord) =>
      invokeWithAuth("ebay-taxonomy", {
        action: "upsert-canonical-attribute",
        attribute,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: canonicalAttrKeys.list() }),
  });
}

export function useDeleteCanonicalAttribute() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (key: string) =>
      invokeWithAuth("ebay-taxonomy", { action: "delete-canonical-attribute", key }),
    onSuccess: () => qc.invalidateQueries({ queryKey: canonicalAttrKeys.list() }),
  });
}

// ─── Channel mapping CRUD ───────────────────────────────────

export interface ChannelMappingRecord {
  id?: string;
  channel: string;
  marketplace: string | null;
  category_id: string | null;
  aspect_key: string;
  canonical_key: string | null;
  constant_value: string | null;
  transform: string | null;
  notes: string | null;
}

export const channelMappingKeys = {
  list: (
    channel: string,
    marketplace?: string,
    categoryId?: string | null,
    scope?: "category" | "all",
  ) =>
    [
      "channel-mappings",
      channel,
      marketplace ?? "all",
      scope === "all" ? "__all__" : (categoryId ?? "default"),
    ] as const,
};

export function useChannelMappings(
  channel: string = "ebay",
  marketplace?: string,
  categoryId?: string | null,
  scope: "category" | "all" = "category",
) {
  return useQuery({
    queryKey: channelMappingKeys.list(channel, marketplace, categoryId, scope),
    queryFn: async (): Promise<ChannelMappingRecord[]> => {
      const res = await invokeWithAuth<{ mappings: ChannelMappingRecord[] }>(
        "ebay-taxonomy",
        {
          action: "list-channel-mappings",
          channel,
          marketplace,
          categoryId: scope === "all" ? undefined : categoryId,
          scope,
        },
      );
      return res.mappings ?? [];
    },
  });
}

export function useBulkCreateAndMapAspects() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      channel: string;
      marketplace: string | null;
      categoryId: string | null;
      aspects: { aspect_key: string; label?: string; attribute_group?: string }[];
    }) =>
      invokeWithAuth<{
        success: boolean;
        canonicalCreated: string[];
        aspectsMapped: string[];
      }>("ebay-taxonomy", {
        action: "bulk-create-and-map-aspects",
        channel: input.channel,
        marketplace: input.marketplace,
        category_id: input.categoryId,
        aspects: input.aspects,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["channel-mappings"] });
      qc.invalidateQueries({ queryKey: canonicalAttrKeys.list() });
      qc.invalidateQueries({ queryKey: ["taxonomy"] });
    },
  });
}

export function useUpsertChannelMapping() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (mapping: ChannelMappingRecord) =>
      invokeWithAuth("ebay-taxonomy", {
        action: "upsert-channel-mapping",
        mapping,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["channel-mappings"] }),
  });
}

export function useDeleteChannelMapping() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      invokeWithAuth("ebay-taxonomy", { action: "delete-channel-mapping", id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["channel-mappings"] }),
  });
}

