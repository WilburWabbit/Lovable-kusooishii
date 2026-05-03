import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { invokeWithAuth } from "@/lib/invokeWithAuth";

export type GmcReadinessStatus = "ready" | "warning" | "blocked";

export interface GmcConnectionSummary {
  connected: boolean;
  merchant_id: string | null;
  data_source: string | null;
  token_expires_at: string | null;
  token_expired: boolean | null;
  last_updated: string | null;
}

export interface GmcReadinessRow {
  sku_id: string;
  sku_code: string;
  condition_grade: number | string | null;
  product_id: string;
  mpn: string | null;
  product_name: string | null;
  title: string | null;
  description: string | null;
  image_url: string | null;
  ean: string | null;
  upc: string | null;
  isbn: string | null;
  gmc_product_category: string | null;
  price: number;
  stock_count: number;
  status: GmcReadinessStatus;
  blocking: string[];
  warnings: string[];
  barcode_source_candidates: Record<string, unknown>;
  web_listing_id: string | null;
  gmc_listing_id: string | null;
  gmc_offer_status: string | null;
  gmc_v2_status: string | null;
  gmc_external_listing_id: string | null;
  latest_command: {
    id: string;
    status: string;
    command_type: string;
    retry_count: number;
    last_error: string | null;
    next_attempt_at: string | null;
    created_at: string;
  } | null;
}

export interface GmcReadinessResponse {
  connection: GmcConnectionSummary;
  summary: {
    total: number;
    ready: number;
    warning: number;
    blocked: number;
  };
  rows: GmcReadinessRow[];
}

export interface GmcPublishEvent {
  id: string;
  target_system: string;
  command_type: string;
  status: string;
  retry_count: number;
  last_error: string | null;
  next_attempt_at: string | null;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
  entity_id: string | null;
  sku_code: string | null;
  app_reference: string | null;
  external_listing_id: string | null;
  channel: string | null;
  response_payload: Record<string, unknown> | null;
}

export type GmcStatus = {
  connected: boolean;
  expired?: boolean | null;
  merchant_id?: string | null;
  data_source?: string | null;
  token_expires_at?: string | null;
  last_updated?: string | null;
};

export const gmcKeys = {
  status: ["admin", "gmc", "status"] as const,
  readiness: ["admin", "gmc", "readiness"] as const,
  events: ["admin", "gmc", "events"] as const,
};

export function useGmcStatus() {
  return useQuery({
    queryKey: gmcKeys.status,
    queryFn: async (): Promise<GmcStatus> => {
      const data = await invokeWithAuth<GmcStatus>("gmc-auth", { action: "status" });
      return data && !("error" in data) ? data : { connected: false };
    },
  });
}

export function useGmcReadiness() {
  return useQuery({
    queryKey: gmcKeys.readiness,
    queryFn: async (): Promise<GmcReadinessResponse> => {
      return invokeWithAuth<GmcReadinessResponse>("admin-data", { action: "gmc-readiness" });
    },
    refetchInterval: 30_000,
  });
}

export function useGmcPublishEvents() {
  return useQuery({
    queryKey: gmcKeys.events,
    queryFn: async (): Promise<GmcPublishEvent[]> => {
      return invokeWithAuth<GmcPublishEvent[]>("admin-data", { action: "gmc-publish-events" });
    },
    refetchInterval: 20_000,
  });
}

export function useGmcMutations() {
  const queryClient = useQueryClient();
  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: gmcKeys.status }),
      queryClient.invalidateQueries({ queryKey: gmcKeys.readiness }),
      queryClient.invalidateQueries({ queryKey: gmcKeys.events }),
    ]);
  };

  const saveConfig = useMutation({
    mutationFn: async (input: { merchantId: string; dataSource: string | null }) =>
      invokeWithAuth("gmc-auth", {
        action: "set_config",
        merchant_id: input.merchantId,
        data_source: input.dataSource,
      }),
    onSuccess: invalidate,
  });

  const disconnect = useMutation({
    mutationFn: async () => invokeWithAuth("gmc-auth", { action: "disconnect" }),
    onSuccess: invalidate,
  });

  const refreshToken = useMutation({
    mutationFn: async () => invokeWithAuth("gmc-auth", { action: "refresh" }),
    onSuccess: invalidate,
  });

  const publishAll = useMutation({
    mutationFn: async (skuIds?: string[]) =>
      invokeWithAuth<{ queued?: number; errors?: number; skipped?: number }>("gmc-sync", {
        action: "publish_all",
        sku_ids: skuIds,
      }),
    onSuccess: invalidate,
  });

  const syncStatus = useMutation({
    mutationFn: async () => invokeWithAuth<{ updated?: number; gmc_products?: number }>("gmc-sync", { action: "sync_status" }),
    onSuccess: invalidate,
  });

  const runCommand = useMutation({
    mutationFn: async (commandId: string) => {
      const { data, error } = await supabase.functions.invoke("listing-command-process", {
        body: { commandId },
      });
      if (error) throw error;
      return data as { processed?: number; results?: unknown[] };
    },
    onSuccess: invalidate,
  });

  const retryCommand = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.rpc("retry_listing_outbound_command" as never, {
        p_outbound_command_id: id,
      } as never);
      if (error) throw error;
      return data;
    },
    onSuccess: invalidate,
  });

  const cancelCommand = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.rpc("cancel_listing_outbound_command" as never, {
        p_outbound_command_id: id,
      } as never);
      if (error) throw error;
      return data;
    },
    onSuccess: invalidate,
  });

  const saveEnrichment = useMutation({
    mutationFn: async (input: {
      productId: string;
      ean?: string | null;
      upc?: string | null;
      isbn?: string | null;
      gmcProductCategory?: string | null;
    }) =>
      invokeWithAuth("admin-data", {
        action: "gmc-save-enrichment",
        product_id: input.productId,
        ean: input.ean,
        upc: input.upc,
        isbn: input.isbn,
        gmc_product_category: input.gmcProductCategory,
      }),
    onSuccess: invalidate,
  });

  return {
    saveConfig,
    disconnect,
    refreshToken,
    publishAll,
    syncStatus,
    runCommand,
    retryCommand,
    cancelCommand,
    saveEnrichment,
  };
}
