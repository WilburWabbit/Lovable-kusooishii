import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invokeWithAuth } from "@/lib/invokeWithAuth";

export type MetaAsset = {
  asset_type: string;
  external_id: string;
  business_id: string | null;
  name: string | null;
  username?: string | null;
  raw_data?: Record<string, unknown> | null;
  last_synced_at?: string | null;
};

export type MetaStatus = {
  connected: boolean;
  graph_version: string;
  meta_user_id: string | null;
  meta_user_name: string | null;
  token_expires_at: string | null;
  expired: boolean | null;
  scopes: string[];
  selected_business_id: string | null;
  selected_catalog_id: string | null;
  selected_page_id: string | null;
  selected_instagram_account_id: string | null;
  selected_ad_account_id: string | null;
  connected_at: string | null;
  last_updated: string | null;
  assets: {
    businesses: MetaAsset[];
    catalogs: MetaAsset[];
    pages: MetaAsset[];
    instagram_accounts: MetaAsset[];
    ad_accounts: MetaAsset[];
  };
};

export type MetaSyncResult = {
  success: boolean;
  status: string;
  catalog_id: string;
  run_id?: string;
  dry_run: boolean;
  prepared: number;
  sent: number;
  skipped: number;
  errors: number;
  batch_handles?: string[];
  skippedDetails?: Array<Record<string, unknown>>;
  errorDetails?: string[];
};

export type MetaCatalogReadinessStatus = "ready" | "warning" | "blocked";

export type MetaCatalogReadinessRow = {
  sku_id: string;
  sku_code: string;
  product_id: string | null;
  mpn: string | null;
  product_name: string | null;
  condition_grade: number | string | null;
  price: number | null;
  stock_count: number;
  status: MetaCatalogReadinessStatus;
  blocking: string[];
  warnings: string[];
  image_url: string | null;
  web_listing_id: string | null;
  meta_listing_id: string | null;
  meta_offer_status: string | null;
  meta_synced_at: string | null;
};

export type MetaCatalogSyncRun = {
  id: string;
  catalog_id: string;
  status: string;
  total_items: number;
  sent_items: number;
  skipped_items: number;
  error_items: number;
  dry_run: boolean;
  summary: Record<string, unknown> | null;
  started_at: string;
  finished_at: string | null;
};

export type MetaCatalogReadinessResponse = {
  catalog_id: string;
  graph_version: string;
  summary: {
    total: number;
    ready: number;
    warning: number;
    blocked: number;
    syncable: number;
    out_of_stock: number;
  };
  rows: MetaCatalogReadinessRow[];
  recent_runs: MetaCatalogSyncRun[];
};

export type MetaBatchStatusResult = {
  success: boolean;
  catalog_id: string;
  handle: string;
  status: string | null;
  payload: Record<string, unknown>;
};

export type MetaCampaignResult = {
  success: boolean;
  campaign_id: string | null;
  status: "PAUSED";
};

export const metaKeys = {
  status: ["admin", "meta", "status"] as const,
  readiness: (catalogId?: string | null) => ["admin", "meta", "readiness", catalogId ?? "default"] as const,
};

export function useMetaStatus() {
  return useQuery({
    queryKey: metaKeys.status,
    queryFn: async (): Promise<MetaStatus> => {
      const data = await invokeWithAuth<MetaStatus>("meta-auth", { action: "status" });
      return data?.connected != null
        ? data
        : {
            connected: false,
            graph_version: "v25.0",
            meta_user_id: null,
            meta_user_name: null,
            token_expires_at: null,
            expired: null,
            scopes: [],
            selected_business_id: null,
            selected_catalog_id: null,
            selected_page_id: null,
            selected_instagram_account_id: null,
            selected_ad_account_id: null,
            connected_at: null,
            last_updated: null,
            assets: { businesses: [], catalogs: [], pages: [], instagram_accounts: [], ad_accounts: [] },
          };
    },
  });
}

export function useMetaCatalogReadiness(catalogId?: string | null, enabled = true) {
  return useQuery({
    queryKey: metaKeys.readiness(catalogId),
    enabled: enabled && Boolean(catalogId),
    queryFn: async (): Promise<MetaCatalogReadinessResponse> =>
      invokeWithAuth<MetaCatalogReadinessResponse>("meta-sync", {
        action: "catalog_readiness",
        catalog_id: catalogId ?? null,
      }),
    refetchInterval: 30_000,
  });
}

export function useMetaMutations() {
  const queryClient = useQueryClient();
  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: metaKeys.status }),
      queryClient.invalidateQueries({ queryKey: ["admin", "meta", "readiness"] }),
    ]);
  };

  const connect = useMutation({
    mutationFn: async () => {
      const data = await invokeWithAuth<{ url: string }>("meta-auth", { action: "authorize_url" });
      window.location.href = data.url;
    },
  });

  const refreshAssets = useMutation({
    mutationFn: async () => invokeWithAuth("meta-auth", { action: "refresh_assets" }),
    onSuccess: invalidate,
  });

  const saveDefaults = useMutation({
    mutationFn: async (input: {
      businessId: string | null;
      catalogId: string | null;
      pageId: string | null;
      instagramAccountId: string | null;
      adAccountId: string | null;
    }) =>
      invokeWithAuth("meta-auth", {
        action: "set_defaults",
        business_id: input.businessId,
        catalog_id: input.catalogId,
        page_id: input.pageId,
        instagram_account_id: input.instagramAccountId,
        ad_account_id: input.adAccountId,
      }),
    onSuccess: invalidate,
  });

  const syncCatalog = useMutation({
    mutationFn: async (input?: { catalogId?: string | null; dryRun?: boolean; skuIds?: string[] }) =>
      invokeWithAuth<MetaSyncResult>("meta-sync", {
        action: "sync_catalog",
        catalog_id: input?.catalogId ?? null,
        dry_run: input?.dryRun ?? false,
        sku_ids: input?.skuIds,
      }),
    onSuccess: invalidate,
  });

  const checkBatchStatus = useMutation({
    mutationFn: async (input: { catalogId?: string | null; handle: string; runId?: string | null }) =>
      invokeWithAuth<MetaBatchStatusResult>("meta-sync", {
        action: "check_batch_status",
        catalog_id: input.catalogId ?? null,
        handle: input.handle,
        sync_run_id: input.runId ?? null,
      }),
    onSuccess: invalidate,
  });

  const createPausedCampaign = useMutation({
    mutationFn: async (input: { adAccountId?: string | null; name: string }) =>
      invokeWithAuth<MetaCampaignResult>("meta-sync", {
        action: "create_paused_sales_campaign",
        ad_account_id: input.adAccountId ?? null,
        name: input.name,
      }),
    onSuccess: invalidate,
  });

  const disconnect = useMutation({
    mutationFn: async () => invokeWithAuth("meta-auth", { action: "disconnect" }),
    onSuccess: invalidate,
  });

  return { connect, refreshAssets, saveDefaults, syncCatalog, checkBatchStatus, createPausedCampaign, disconnect };
}
