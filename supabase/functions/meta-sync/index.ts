import { createAdminClient, corsHeaders, errorResponse, fetchWithTimeout } from "../_shared/qbo-helpers.ts";
import {
  getMetaConnection,
  isRecord,
  jsonResponse,
  metaPostForm,
  parseJsonResponse,
  requireAdmin,
  stringifyMetaError,
} from "../_shared/meta-client.ts";
import { buildMetaCatalogItem } from "../_shared/meta-product-input.ts";

const DEFAULT_PUBLIC_SITE_URL = "https://www.kusooishii.com";
const META_BATCH_SIZE = 50;

type WebListing = {
  sku_id?: string;
  offer_status?: string | null;
  v2_status?: string | null;
  listed_price?: number | string | null;
  availability_override?: string | null;
  availability_override_at?: string | null;
  availability_override_by?: string | null;
};

type CatalogRequest = {
  method: "CREATE" | "UPDATE";
  retailer_id: string;
  data: Record<string, unknown>;
};

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeSiteUrl(value: unknown): string {
  const raw = asString(value);
  if (!raw) return DEFAULT_PUBLIC_SITE_URL;
  try {
    const parsed = new URL(raw);
    if (parsed.hostname.endsWith(".supabase.co") || !parsed.hostname.includes(".")) {
      return DEFAULT_PUBLIC_SITE_URL;
    }
    return `${parsed.protocol}//${parsed.host}`.replace(/\/$/, "");
  } catch {
    return DEFAULT_PUBLIC_SITE_URL;
  }
}

async function getWebsitePrimaryImageUrl(
  admin: ReturnType<typeof createAdminClient>,
  productId: unknown,
): Promise<string | null> {
  const id = asString(productId);
  if (!id) return null;

  const { data, error } = await admin
    .from("product_media")
    .select("sort_order, is_primary, media_asset:media_asset_id(original_url)")
    .eq("product_id" as never, id)
    .order("is_primary" as never, { ascending: false })
    .order("sort_order" as never, { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw error;

  const row = data as Record<string, unknown> | null;
  const asset = row?.media_asset as Record<string, unknown> | null;
  const url = asString(asset?.original_url);
  return url;
}

function isLiveWebListing(listing: WebListing): boolean {
  const offerStatus = String(listing.offer_status ?? "").toUpperCase();
  const isEndQueued = ["END_QUEUED", "ENDED", "DELISTED"].includes(offerStatus);
  const isPublished = listing.v2_status === "live" || ["LIVE", "PUBLISHED"].includes(offerStatus);
  return !isEndQueued && isPublished;
}

async function landMetaResponse(
  admin: ReturnType<typeof createAdminClient>,
  input: {
    sync_run_id?: string | null;
    operation: string;
    external_id?: string | null;
    status: "received" | "sent" | "committed" | "error";
    request_payload?: Record<string, unknown>;
    response_payload?: Record<string, unknown>;
    error?: string | null;
    correlation_id?: string | null;
  },
) {
  const { error } = await admin.from("landing_raw_meta").insert({
    sync_run_id: input.sync_run_id ?? null,
    operation: input.operation,
    external_id: input.external_id ?? null,
    status: input.status,
    request_payload: input.request_payload ?? {},
    response_payload: input.response_payload ?? {},
    error: input.error ?? null,
    correlation_id: input.correlation_id ?? null,
    processed_at: input.status === "committed" || input.status === "error" ? new Date().toISOString() : null,
  });
  if (error) console.warn("Failed to land Meta response", error);
}

async function sendCatalogBatch(
  catalogId: string,
  accessToken: string,
  requests: CatalogRequest[],
) {
  const response = await fetchWithTimeout(`https://graph.facebook.com/${Deno.env.get("META_GRAPH_VERSION") || "v25.0"}/${catalogId}/batch`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ requests: JSON.stringify(requests) }),
  });
  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(stringifyMetaError(payload, `Meta catalog batch failed [${response.status}]`));
  }
  return payload;
}

async function syncCatalog(req: Request, body: Record<string, unknown>) {
  const admin = createAdminClient();
  await requireAdmin(req, admin);

  const connection = await getMetaConnection(admin);
  const catalogId = asString(body.catalog_id) ?? connection.selected_catalog_id;
  if (!catalogId) throw new Error("Select a Meta product catalog before syncing");

  const dryRun = body.dry_run === true;
  const siteUrl = normalizeSiteUrl(Deno.env.get("SITE_URL") || Deno.env.get("PUBLIC_SITE_URL"));
  const requestedSkuIds = Array.isArray(body.sku_ids)
    ? new Set(body.sku_ids.map((value) => String(value)))
    : null;

  const { data: run, error: runError } = await admin.from("meta_catalog_sync_run").insert({
    catalog_id: catalogId,
    status: "pending",
    dry_run: dryRun,
  }).select("id").single();
  if (runError) throw new Error(`Failed to create Meta sync run: ${runError.message}`);
  const runId = String((run as Record<string, unknown>).id);

  const skippedDetails: Array<Record<string, unknown>> = [];
  const errorDetails: string[] = [];
  const requests: CatalogRequest[] = [];

  try {
    const [{ data: skus, error: skuError }, { data: webListings }, { data: stockUnits }] = await Promise.all([
      admin
        .from("sku")
        .select("id, sku_code, condition_grade, product_id, product:product_id(id, mpn, name, seo_title, seo_description, description, img_url, product_type, lego_theme, lego_subtheme, subtheme_name, piece_count, release_year, retired_flag, ean, upc, isbn, gmc_product_category)")
        .eq("active_flag" as never, true),
      admin
        .from("channel_listing")
        .select("sku_id, offer_status, v2_status, listed_price, availability_override, availability_override_at, availability_override_by")
        .eq("channel" as never, "web"),
      admin
        .from("stock_unit")
        .select("sku_id, status, v2_status"),
    ]);
    if (skuError) throw new Error(`Failed to fetch SKUs: ${skuError.message}`);

    const webListingBySku = new Map<string, WebListing>();
    for (const listing of (webListings ?? []) as WebListing[]) {
      if (!listing.sku_id || !isLiveWebListing(listing)) continue;
      webListingBySku.set(String(listing.sku_id), listing);
    }

    const stockMap = new Map<string, number>();
    for (const stockUnit of (stockUnits ?? []) as Record<string, unknown>[]) {
      const status = String(stockUnit.status ?? "");
      const v2Status = String(stockUnit.v2_status ?? "");
      const isSaleable = ["graded", "listed", "restocked"].includes(v2Status) || status === "available";
      if (!isSaleable || !stockUnit.sku_id) continue;
      const skuId = String(stockUnit.sku_id);
      stockMap.set(skuId, (stockMap.get(skuId) ?? 0) + 1);
    }

    for (const sku of (skus ?? []) as Record<string, unknown>[]) {
      const skuId = String(sku.id ?? "");
      const skuCode = String(sku.sku_code ?? "");
      if (requestedSkuIds && !requestedSkuIds.has(skuId)) continue;

      const webListing = webListingBySku.get(skuId);
      if (!webListing) {
        skippedDetails.push({ sku_id: skuId, sku_code: skuCode, reason: "missing_live_web_page" });
        continue;
      }

      const productRelation = sku.product as Record<string, unknown> | Record<string, unknown>[] | null;
      const product = Array.isArray(productRelation) ? productRelation[0] ?? null : productRelation;
      if (!isRecord(product)) {
        skippedDetails.push({ sku_id: skuId, sku_code: skuCode, reason: "missing_product" });
        continue;
      }

      const primaryImageUrl = await getWebsitePrimaryImageUrl(admin, product.id);
      if (!primaryImageUrl) {
        skippedDetails.push({ sku_id: skuId, sku_code: skuCode, reason: "missing_website_primary_image" });
        continue;
      }

      const manualOutOfStock = webListing.availability_override === "manual_out_of_stock";
      const stockCount = manualOutOfStock ? 0 : stockMap.get(skuId) ?? 0;
      const listedPrice = Number(webListing.listed_price ?? 0);

      try {
        const item = buildMetaCatalogItem(
          {
            external_sku: skuCode,
            listed_price: listedPrice,
          },
          sku,
          { ...product, primary_image_url: primaryImageUrl },
          stockCount,
          siteUrl,
        );

        const request: CatalogRequest = {
          method: "UPDATE",
          retailer_id: item.retailerId,
          data: item.data,
        };
        requests.push(request);

        const { error: listingError } = await admin.from("channel_listing").upsert({
          channel: "meta",
          external_sku: skuCode,
          external_listing_id: item.retailerId,
          sku_id: skuId,
          listed_price: listedPrice,
          listed_quantity: stockCount,
          offer_status: dryRun ? "sync_previewed" : "sync_queued",
          raw_data: {
            catalog_id: catalogId,
            meta_payload: item.data,
            meta_warnings: item.warnings,
            availability_override: webListing.availability_override ?? null,
          },
          synced_at: new Date().toISOString(),
        }, { onConflict: "channel,external_sku" });
        if (listingError) throw listingError;

        await landMetaResponse(admin, {
          sync_run_id: runId,
          operation: "catalog_item_payload",
          external_id: item.retailerId,
          status: "received",
          request_payload: request,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "unknown";
        skippedDetails.push({ sku_id: skuId, sku_code: skuCode, reason: "payload_error", message });
      }
    }

    let sentItems = 0;
    const sentSkuCodes: string[] = [];
    if (!dryRun) {
      for (let index = 0; index < requests.length; index += META_BATCH_SIZE) {
        const batch = requests.slice(index, index + META_BATCH_SIZE);
        try {
          const response = await sendCatalogBatch(catalogId, connection.access_token, batch);
          sentItems += batch.length;
          sentSkuCodes.push(...batch.map((item) => item.retailer_id));
          await landMetaResponse(admin, {
            sync_run_id: runId,
            operation: "catalog_batch_update",
            external_id: catalogId,
            status: "committed",
            request_payload: { requests: batch },
            response_payload: response,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : "unknown";
          errorDetails.push(message);
          await landMetaResponse(admin, {
            sync_run_id: runId,
            operation: "catalog_batch_update",
            external_id: catalogId,
            status: "error",
            request_payload: { requests: batch },
            error: message,
          });
        }
      }

      if (sentSkuCodes.length > 0) {
        await admin
          .from("channel_listing")
          .update({ offer_status: "synced", synced_at: new Date().toISOString() } as never)
          .eq("channel" as never, "meta")
          .in("external_sku" as never, sentSkuCodes as never);
      }
    }

    const status = errorDetails.length > 0
      ? sentItems > 0 ? "partial" : "failed"
      : "success";

    await admin.from("meta_catalog_sync_run").update({
      status,
      total_items: requestedSkuIds ? requestedSkuIds.size : (skus ?? []).length,
      sent_items: dryRun ? 0 : sentItems,
      skipped_items: skippedDetails.length,
      error_items: errorDetails.length,
      summary: { skippedDetails, errorDetails, preview_count: requests.length },
      finished_at: new Date().toISOString(),
    }).eq("id", runId);

    return jsonResponse({
      success: status !== "failed",
      status,
      catalog_id: catalogId,
      dry_run: dryRun,
      prepared: requests.length,
      sent: dryRun ? 0 : sentItems,
      skipped: skippedDetails.length,
      errors: errorDetails.length,
      skippedDetails,
      errorDetails,
      preview: dryRun ? requests.slice(0, 10) : undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown Meta catalog sync error";
    await admin.from("meta_catalog_sync_run").update({
      status: "failed",
      error_items: 1,
      summary: { error: message, skippedDetails, errorDetails },
      finished_at: new Date().toISOString(),
    }).eq("id", runId);
    throw err;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = asString(body.action) ?? "sync_catalog";

    if (action === "sync_catalog") return await syncCatalog(req, body);

    if (action === "create_paused_sales_campaign") {
      const admin = createAdminClient();
      await requireAdmin(req, admin);
      const connection = await getMetaConnection(admin);
      const adAccountId = asString(body.ad_account_id) ?? connection.selected_ad_account_id;
      if (!adAccountId) throw new Error("Select a Meta ad account before creating a campaign");

      const normalizedAdAccountId = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;
      const name = asString(body.name) ?? `Kuso Oishii catalog sales ${new Date().toISOString().slice(0, 10)}`;
      const payload = await metaPostForm<Record<string, unknown>>(`${normalizedAdAccountId}/campaigns`, connection.access_token, {
        name,
        objective: "OUTCOME_SALES",
        status: "PAUSED",
        buying_type: "AUCTION",
        special_ad_categories: JSON.stringify([]),
      });

      await landMetaResponse(admin, {
        operation: "ad_campaign_create",
        external_id: asString(payload.id),
        status: "committed",
        request_payload: { ad_account_id: normalizedAdAccountId, name, status: "PAUSED" },
        response_payload: payload,
      });

      return jsonResponse({ success: true, campaign_id: payload.id ?? null, status: "PAUSED" });
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (err) {
    console.error("meta-sync error:", err);
    return errorResponse(err);
  }
});
