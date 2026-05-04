import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { operationsKeys } from "./use-operations";

export const ebayStorefrontKeys = {
  all: ["v2", "ebay-storefront"] as const,
  listings: ["v2", "ebay-storefront", "listings"] as const,
  landing: ["v2", "ebay-storefront", "landing"] as const,
  notifications: ["v2", "ebay-storefront", "notifications"] as const,
};

export interface EbayStorefrontListing {
  id: string;
  skuId: string | null;
  skuCode: string | null;
  mpn: string | null;
  grade: number | null;
  productName: string | null;
  ebayCategoryId: string | null;
  status: string;
  externalListingId: string | null;
  externalUrl: string | null;
  listingTitle: string | null;
  listedPrice: number | null;
  listedQuantity: number | null;
  listedAt: string | null;
  updatedAt: string;
  readiness: "ready" | "missing_policy" | "compliance_risk" | "revision_cap_risk";
  readinessReasons: string[];
}

export interface EbayLandingSummary {
  source: "orders" | "listings" | "payouts";
  pending: number;
  committed: number;
  error: number;
  latestReceivedAt: string | null;
}

export interface EbayNotificationRow {
  id: string;
  topic: string;
  notificationId: string | null;
  receivedAt: string;
  read: boolean;
}

export type EbayListingCommandType = "publish" | "reprice" | "pause" | "end" | "update_price" | "sync_quantity";

function asNumber(value: unknown): number | null {
  return value == null ? null : Number(value);
}

function buildReadiness(row: Record<string, unknown>, sku: Record<string, unknown> | undefined) {
  const reasons: string[] = [];
  const status = ((row.v2_status as string | null) ?? "draft").toLowerCase();
  const title = (row.listing_title as string | null)?.trim();
  const price = asNumber(row.listed_price);
  const grade = asNumber(sku?.condition_grade);
  const ebayCategoryId = (sku?.ebay_category_id as string | null) ?? null;

  if (!title) reasons.push("Missing mastered eBay title");
  if (!price || price <= 0) reasons.push("Missing publishable price");
  if (!ebayCategoryId) reasons.push("Missing eBay category/policy mapping");
  if (grade === 5 && !/red card|damage|defect|incomplete|condition/i.test(title ?? "")) {
    reasons.push("Grade 5 disclosure wording needs review");
  }
  if (status === "live" && !row.external_listing_id) {
    reasons.push("Live app listing has no eBay listing ID");
  }

  if (reasons.some((reason) => /Grade 5|Live app/.test(reason))) {
    return { readiness: "compliance_risk" as const, reasons };
  }
  if (reasons.length > 0) {
    return { readiness: "missing_policy" as const, reasons };
  }
  return { readiness: "ready" as const, reasons: ["Ready for staged eBay command"] };
}

export function useEbayStorefrontListings() {
  return useQuery({
    queryKey: ebayStorefrontKeys.listings,
    queryFn: async (): Promise<EbayStorefrontListing[]> => {
      const { data: listingRows, error: listingError } = await supabase
        .from("channel_listing")
        .select(
          "id, sku_id, v2_status, external_listing_id, external_url, listing_title, listed_price, listed_quantity, listed_at, updated_at",
        )
        .or("v2_channel.eq.ebay,channel.eq.ebay")
        .order("updated_at", { ascending: false })
        .limit(200);

      if (listingError) throw listingError;

      const rows = (listingRows ?? []) as Record<string, unknown>[];
      const skuIds = [...new Set(rows.map((row) => row.sku_id).filter((id): id is string => typeof id === "string"))];
      const skusById = new Map<string, Record<string, unknown>>();

      if (skuIds.length > 0) {
        const { data: skuRows, error: skuError } = await supabase
          .from("sku")
          .select("id, sku_code, mpn, condition_grade, product_id")
          .in("id", skuIds);

        if (skuError) throw skuError;

        const productIds = [
          ...new Set(
            ((skuRows ?? []) as Record<string, unknown>[])
              .map((row) => row.product_id)
              .filter((id): id is string => typeof id === "string"),
          ),
        ];
        const productsById = new Map<string, Record<string, unknown>>();

        if (productIds.length > 0) {
          const { data: productRows, error: productError } = await supabase
            .from("product")
            .select("id, name, ebay_category_id")
            .in("id", productIds);

          if (productError) throw productError;
          for (const product of ((productRows ?? []) as Record<string, unknown>[])) {
            productsById.set(product.id as string, product);
          }
        }

        for (const sku of ((skuRows ?? []) as Record<string, unknown>[])) {
          const product = productsById.get(sku.product_id as string);
          skusById.set(sku.id as string, {
            ...sku,
            product_name: product?.name ?? null,
            ebay_category_id: product?.ebay_category_id ?? null,
          });
        }
      }

      return rows.map((row) => {
        const sku = row.sku_id ? skusById.get(row.sku_id as string) : undefined;
        const readiness = buildReadiness(row, sku);
        return {
          id: row.id as string,
          skuId: (row.sku_id as string | null) ?? null,
          skuCode: (sku?.sku_code as string | null) ?? null,
          mpn: (sku?.mpn as string | null) ?? null,
          grade: asNumber(sku?.condition_grade),
          productName: (sku?.product_name as string | null) ?? null,
          ebayCategoryId: (sku?.ebay_category_id as string | null) ?? null,
          status: (row.v2_status as string | null) ?? "draft",
          externalListingId: (row.external_listing_id as string | null) ?? null,
          externalUrl: (row.external_url as string | null) ?? null,
          listingTitle: (row.listing_title as string | null) ?? null,
          listedPrice: asNumber(row.listed_price),
          listedQuantity: asNumber(row.listed_quantity),
          listedAt: (row.listed_at as string | null) ?? null,
          updatedAt: row.updated_at as string,
          readiness: readiness.readiness,
          readinessReasons: readiness.reasons,
        };
      });
    },
  });
}

async function summarizeLandingTable(
  table: "landing_raw_ebay_order" | "landing_raw_ebay_listing" | "landing_raw_ebay_payout",
  source: EbayLandingSummary["source"],
): Promise<EbayLandingSummary> {
  const { data, error } = await supabase
    .from(table)
    .select("status, received_at")
    .order("received_at", { ascending: false })
    .limit(500);

  if (error) throw error;

  const summary: EbayLandingSummary = {
    source,
    pending: 0,
    committed: 0,
    error: 0,
    latestReceivedAt: null,
  };

  for (const row of ((data ?? []) as Record<string, unknown>[])) {
    const status = String(row.status ?? "").toLowerCase();
    if (!summary.latestReceivedAt && row.received_at) summary.latestReceivedAt = row.received_at as string;
    if (status === "pending" || status === "retrying") summary.pending += 1;
    else if (status === "committed" || status === "processed") summary.committed += 1;
    else if (status === "error" || status === "failed") summary.error += 1;
  }

  return summary;
}

export function useEbayLandingSummary() {
  return useQuery({
    queryKey: ebayStorefrontKeys.landing,
    queryFn: async (): Promise<EbayLandingSummary[]> => Promise.all([
      summarizeLandingTable("landing_raw_ebay_order", "orders"),
      summarizeLandingTable("landing_raw_ebay_listing", "listings"),
      summarizeLandingTable("landing_raw_ebay_payout", "payouts"),
    ]),
  });
}

export function useEbayNotifications() {
  return useQuery({
    queryKey: ebayStorefrontKeys.notifications,
    queryFn: async (): Promise<EbayNotificationRow[]> => {
      const { data, error } = await supabase
        .from("ebay_notification")
        .select("id, topic, notification_id, received_at, read")
        .order("received_at", { ascending: false })
        .limit(25);

      if (error) throw error;

      return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
        id: row.id as string,
        topic: row.topic as string,
        notificationId: (row.notification_id as string | null) ?? null,
        receivedAt: row.received_at as string,
        read: Boolean(row.read),
      }));
    },
  });
}

export function useQueueEbayListingCommand() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      listingId,
      commandType,
      allowBelowFloor = false,
    }: {
      listingId: string;
      commandType: EbayListingCommandType;
      allowBelowFloor?: boolean;
    }) => {
      const { data, error } = await supabase.rpc("queue_listing_command" as never, {
        p_channel_listing_id: listingId,
        p_command_type: commandType,
        p_actor_id: null,
        p_allow_below_floor: allowBelowFloor,
      } as never);

      if (error) throw error;
      return data as unknown as string;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ebayStorefrontKeys.listings });
      queryClient.invalidateQueries({ queryKey: operationsKeys.listingCommands });
      queryClient.invalidateQueries({ queryKey: operationsKeys.health });
    },
  });
}
