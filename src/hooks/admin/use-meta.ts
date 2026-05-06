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
  dry_run: boolean;
  prepared: number;
  sent: number;
  skipped: number;
  errors: number;
  skippedDetails?: Array<Record<string, unknown>>;
  errorDetails?: string[];
};

export type MetaCampaignResult = {
  success: boolean;
  campaign_id: string | null;
  status: "PAUSED";
};

export const metaKeys = {
  status: ["admin", "meta", "status"] as const,
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

export function useMetaMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: metaKeys.status });

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
    mutationFn: async (input?: { catalogId?: string | null; dryRun?: boolean }) =>
      invokeWithAuth<MetaSyncResult>("meta-sync", {
        action: "sync_catalog",
        catalog_id: input?.catalogId ?? null,
        dry_run: input?.dryRun ?? false,
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

  return { connect, refreshAssets, saveDefaults, syncCatalog, createPausedCampaign, disconnect };
}
