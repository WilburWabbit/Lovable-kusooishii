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

export interface ChannelAspectsResolution {
  categoryId: string;
  categoryName: string | null;
  schemaLoaded: boolean;
  resolvedCount: number;
  totalSchemaCount: number;
  missingRequiredCount: number;
  resolved: Record<string, ResolvedAspect>;
  missing: { key: string; required: boolean }[];
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
  attributes: (productId: string, namespace?: string) =>
    ["product-attributes", productId, namespace ?? "all"] as const,
};

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
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: ["v2", "products", vars.mpn] });
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
    }) => {
      return await invokeWithAuth("admin-data", {
        action: "save-product-attributes",
        product_id: input.productId,
        namespace: input.namespace,
        attributes: input.attributes,
        source: input.source,
      });
    },
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({
        queryKey: taxonomyKeys.attributes(vars.productId, vars.namespace),
      });
      queryClient.invalidateQueries({
        queryKey: taxonomyKeys.attributes(vars.productId, "all"),
      });
    },
  });
}
