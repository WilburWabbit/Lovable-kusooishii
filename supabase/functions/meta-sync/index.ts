import { createAdminClient, corsHeaders, errorResponse, fetchWithTimeout } from "../_shared/qbo-helpers.ts";
import {
  getMetaConnection,
  isRecord,
  jsonResponse,
  metaGet,
  metaPostForm,
  parseJsonResponse,
  requireAdmin,
  stringifyMetaError,
} from "../_shared/meta-client.ts";
import { buildMetaCatalogItem } from "../_shared/meta-product-input.ts";

const DEFAULT_PUBLIC_SITE_URL = "https://www.kusooishii.com";
const META_BATCH_SIZE = 50;
const SALEABLE_STOCK_V2_STATUSES = ["graded", "listed", "restocked"];
const SALEABLE_STOCK_STATUSES = ["available", "received", "graded", "listed", "restocked"];

type CatalogReadinessStatus = "ready" | "warning" | "blocked";

type WebListing = {
  id?: string;
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

type MetaListing = {
  id?: string;
  sku_id?: string | null;
  external_sku?: string | null;
  external_listing_id?: string | null;
  offer_status?: string | null;
  v2_status?: string | null;
  listed_quantity?: number | string | null;
  synced_at?: string | null;
};

type CatalogReadinessRow = {
  sku_id: string;
  sku_code: string;
  product_id: string | null;
  mpn: string | null;
  product_name: string | null;
  condition_grade: number | string | null;
  price: number | null;
  stock_count: number;
  status: CatalogReadinessStatus;
  blocking: string[];
  warnings: string[];
  image_url: string | null;
  web_listing_id: string | null;
  meta_listing_id: string | null;
  meta_offer_status: string | null;
  meta_synced_at: string | null;
  request?: CatalogRequest;
};

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function toStringSet(value: unknown): Set<string> | null {
  if (!Array.isArray(value)) return null;
  const values = value.map((item) => String(item).trim()).filter(Boolean);
  return values.length > 0 ? new Set(values) : null;
}

function boundedLimit(value: unknown): number | null {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return Math.max(1, Math.min(500, Math.floor(number)));
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

async function getWebsitePrimaryImageUrls(
  admin: ReturnType<typeof createAdminClient>,
  productIds: string[],
): Promise<Map<string, string>> {
  const uniqueProductIds = [...new Set(productIds.filter(Boolean))];
  const byProduct = new Map<string, string>();
  if (uniqueProductIds.length === 0) return byProduct;

  const { data, error } = await admin
    .from("product_media")
    .select("product_id, sort_order, is_primary, media_asset:media_asset_id(original_url)")
    .in("product_id" as never, uniqueProductIds as never)
    .order("is_primary" as never, { ascending: false })
    .order("sort_order" as never, { ascending: true });

  if (error) throw error;

  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const productId = asString(row.product_id);
    if (!productId || byProduct.has(productId)) continue;
    const asset = row.media_asset as Record<string, unknown> | null;
    const url = asString(asset?.original_url);
    if (url) byProduct.set(productId, url);
  }

  return byProduct;
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
  const response = await fetchWithTimeout(`https://graph.facebook.com/${Deno.env.get("META_GRAPH_VERSION") || "v25.0"}/${catalogId}/items_batch`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      item_type: "PRODUCT_ITEM",
      allow_upsert: "true",
      requests: JSON.stringify(requests),
    }),
  });
  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(stringifyMetaError(payload, `Meta catalog batch failed [${response.status}]`));
  }
  return payload;
}

function extractBatchHandles(payload: Record<string, unknown>): string[] {
  const handles = new Set<string>();
  const add = (value: unknown) => {
    const text = asString(value);
    if (text) handles.add(text);
  };

  add(payload.handle);
  for (const handle of stringArray(payload.handles)) add(handle);
  const data = isRecord(payload.data) ? payload.data : null;
  add(data?.handle);
  for (const handle of stringArray(data?.handles)) add(handle);

  return [...handles];
}

function isTerminalBatchStatus(value: unknown): boolean {
  const status = String(value ?? "").toLowerCase();
  return ["complete", "completed", "done", "finished", "success", "succeeded"].some((term) => status.includes(term));
}

function readinessStatus(blocking: string[], warnings: string[]): CatalogReadinessStatus {
  if (blocking.length > 0) return "blocked";
  if (warnings.length > 0) return "warning";
  return "ready";
}

function summarizeReadiness(rows: CatalogReadinessRow[]) {
  return {
    total: rows.length,
    ready: rows.filter((row) => row.status === "ready").length,
    warning: rows.filter((row) => row.status === "warning").length,
    blocked: rows.filter((row) => row.status === "blocked").length,
    syncable: rows.filter((row) => row.request).length,
    out_of_stock: rows.filter((row) => row.stock_count <= 0).length,
  };
}

async function prepareCatalogRows(
  admin: ReturnType<typeof createAdminClient>,
  body: Record<string, unknown>,
) {
  const requestedSkuIds = toStringSet(body.sku_ids);
  const requestedSkuCodes = toStringSet(body.sku_codes);
  const limit = boundedLimit(body.limit);
  const siteUrl = normalizeSiteUrl(Deno.env.get("SITE_URL") || Deno.env.get("PUBLIC_SITE_URL"));

  let skuQuery = admin
    .from("sku")
    .select("id, sku_code, condition_grade, product_id, product:product_id(id, mpn, name, seo_title, seo_description, description, img_url, product_type, lego_theme, lego_subtheme, subtheme_name, piece_count, release_year, retired_flag, ean, upc, isbn, gmc_product_category)")
    .eq("active_flag" as never, true)
    .order("sku_code" as never, { ascending: true });

  if (requestedSkuIds) skuQuery = skuQuery.in("id" as never, [...requestedSkuIds] as never);
  if (requestedSkuCodes) skuQuery = skuQuery.in("sku_code" as never, [...requestedSkuCodes] as never);
  if (limit) skuQuery = skuQuery.limit(limit);

  const { data: skuRows, error: skuError } = await skuQuery;
  if (skuError) throw new Error(`Failed to fetch SKUs: ${skuError.message}`);

  const skus = (skuRows ?? []) as Record<string, unknown>[];
  const skuIds = skus.map((sku) => asString(sku.id)).filter((value): value is string => Boolean(value));
  const productIds = skus.map((sku) => asString(sku.product_id)).filter((value): value is string => Boolean(value));

  const [
    { data: webListings, error: webListingError },
    { data: metaListings, error: metaListingError },
    { data: stockUnits, error: stockUnitError },
    imageUrlsByProduct,
  ] = await Promise.all([
    skuIds.length > 0
      ? admin
          .from("channel_listing")
          .select("id, sku_id, offer_status, v2_status, listed_price, availability_override, availability_override_at, availability_override_by")
          .eq("channel" as never, "web")
          .in("sku_id" as never, skuIds as never)
      : Promise.resolve({ data: [], error: null }),
    skuIds.length > 0
      ? admin
          .from("channel_listing")
          .select("id, sku_id, external_sku, external_listing_id, offer_status, v2_status, listed_quantity, synced_at")
          .eq("channel" as never, "meta")
          .in("sku_id" as never, skuIds as never)
      : Promise.resolve({ data: [], error: null }),
    skuIds.length > 0
      ? admin
          .from("stock_unit")
          .select("sku_id, status, v2_status")
          .in("sku_id" as never, skuIds as never)
      : Promise.resolve({ data: [], error: null }),
    getWebsitePrimaryImageUrls(admin, productIds),
  ]);
  if (webListingError) throw new Error(`Failed to fetch web listings: ${webListingError.message}`);
  if (metaListingError) throw new Error(`Failed to fetch Meta listings: ${metaListingError.message}`);
  if (stockUnitError) throw new Error(`Failed to fetch stock units: ${stockUnitError.message}`);

  const webListingBySku = new Map<string, WebListing>();
  for (const listing of (webListings ?? []) as WebListing[]) {
    if (!listing.sku_id || !isLiveWebListing(listing)) continue;
    webListingBySku.set(String(listing.sku_id), listing);
  }

  const metaListingBySku = new Map<string, MetaListing>();
  for (const listing of (metaListings ?? []) as MetaListing[]) {
    if (listing.sku_id) metaListingBySku.set(String(listing.sku_id), listing);
  }

  const stockMap = new Map<string, number>();
  for (const stockUnit of (stockUnits ?? []) as Record<string, unknown>[]) {
    const status = String(stockUnit.status ?? "").toLowerCase();
    const v2Status = String(stockUnit.v2_status ?? "").toLowerCase();
    const isSaleable = SALEABLE_STOCK_V2_STATUSES.includes(v2Status) || SALEABLE_STOCK_STATUSES.includes(status);
    if (!isSaleable || !stockUnit.sku_id) continue;
    const skuId = String(stockUnit.sku_id);
    stockMap.set(skuId, (stockMap.get(skuId) ?? 0) + 1);
  }

  const rows: CatalogReadinessRow[] = [];
  const skippedDetails: Array<Record<string, unknown>> = [];

  for (const sku of skus) {
    const skuId = asString(sku.id) ?? "";
    const skuCode = asString(sku.sku_code) ?? "";
    const productRelation = sku.product as Record<string, unknown> | Record<string, unknown>[] | null;
    const product = Array.isArray(productRelation) ? productRelation[0] ?? null : productRelation;
    const productId = asString(product?.id) ?? asString(sku.product_id);
    const webListing = webListingBySku.get(skuId);
    const metaListing = metaListingBySku.get(skuId);
    const blocking: string[] = [];
    const warnings: string[] = [];

    if (!webListing) blocking.push("missing_live_web_page");
    if (!isRecord(product)) blocking.push("missing_product");

    const primaryImageUrl = productId ? imageUrlsByProduct.get(productId) ?? null : null;
    if (!primaryImageUrl) blocking.push("missing_website_primary_image");

    const manualOutOfStock = webListing?.availability_override === "manual_out_of_stock";
    if (manualOutOfStock) warnings.push("manual_out_of_stock");
    const stockCount = manualOutOfStock ? 0 : stockMap.get(skuId) ?? 0;
    if (stockCount <= 0) warnings.push("out_of_stock");

    const listedPrice = asNumber(webListing?.listed_price);
    if (!listedPrice || listedPrice <= 0) blocking.push("missing_listed_price");

    let request: CatalogRequest | undefined;
    if (blocking.length === 0 && isRecord(product) && listedPrice) {
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
        warnings.push(...item.warnings);
        request = {
          method: metaListing ? "UPDATE" : "CREATE",
          retailer_id: item.retailerId,
          data: item.data,
        };
      } catch (err) {
        blocking.push("payload_error");
        warnings.push(err instanceof Error ? err.message : "unknown_payload_error");
      }
    }

    const status = readinessStatus(blocking, warnings);
    const row: CatalogReadinessRow = {
      sku_id: skuId,
      sku_code: skuCode,
      product_id: productId,
      mpn: isRecord(product) ? asString(product.mpn) : null,
      product_name: isRecord(product) ? asString(product.name) : null,
      condition_grade: sku.condition_grade as number | string | null,
      price: listedPrice,
      stock_count: stockCount,
      status,
      blocking,
      warnings,
      image_url: primaryImageUrl,
      web_listing_id: asString(webListing?.id),
      meta_listing_id: asString(metaListing?.id),
      meta_offer_status: asString(metaListing?.offer_status),
      meta_synced_at: asString(metaListing?.synced_at),
      request,
    };
    rows.push(row);

    if (status === "blocked") {
      skippedDetails.push({ sku_id: skuId, sku_code: skuCode, reason: blocking.join(","), warnings });
    }
  }

  return {
    rows,
    syncable: rows.filter((row) => row.request),
    skippedDetails,
    summary: summarizeReadiness(rows),
  };
}

async function recentRuns(admin: ReturnType<typeof createAdminClient>, catalogId: string) {
  const { data, error } = await admin
    .from("meta_catalog_sync_run")
    .select("id, catalog_id, status, total_items, sent_items, skipped_items, error_items, dry_run, summary, started_at, finished_at")
    .eq("catalog_id" as never, catalogId)
    .order("started_at" as never, { ascending: false })
    .limit(8);
  if (error) throw new Error(`Failed to load Meta sync runs: ${error.message}`);
  return data ?? [];
}

async function catalogReadiness(req: Request, body: Record<string, unknown>) {
  const admin = createAdminClient();
  await requireAdmin(req, admin);

  const connection = await getMetaConnection(admin);
  const catalogId = asString(body.catalog_id) ?? connection.selected_catalog_id;
  if (!catalogId) throw new Error("Select a Meta product catalog before syncing");

  const prepared = await prepareCatalogRows(admin, body);

  return jsonResponse({
    catalog_id: catalogId,
    graph_version: Deno.env.get("META_GRAPH_VERSION") || "v25.0",
    summary: prepared.summary,
    rows: prepared.rows,
    recent_runs: await recentRuns(admin, catalogId),
  });
}

async function syncCatalog(req: Request, body: Record<string, unknown>) {
  const admin = createAdminClient();
  await requireAdmin(req, admin);

  const connection = await getMetaConnection(admin);
  const catalogId = asString(body.catalog_id) ?? connection.selected_catalog_id;
  if (!catalogId) throw new Error("Select a Meta product catalog before syncing");

  const dryRun = body.dry_run === true;
  const prepared = await prepareCatalogRows(admin, body);

  const { data: run, error: runError } = await admin.from("meta_catalog_sync_run").insert({
    catalog_id: catalogId,
    status: "pending",
    dry_run: dryRun,
    total_items: prepared.summary.total,
    skipped_items: prepared.skippedDetails.length,
    summary: { readiness: prepared.summary, skippedDetails: prepared.skippedDetails },
  }).select("id").single();
  if (runError) throw new Error(`Failed to create Meta sync run: ${runError.message}`);
  const runId = String((run as Record<string, unknown>).id);

  const errorDetails: string[] = [];
  const batchHandles: string[] = [];
  const sentSkuCodes: string[] = [];
  let sentItems = 0;

  try {
    for (const row of prepared.syncable) {
      if (!row.request) continue;
      const { error: listingError } = await admin.from("channel_listing").upsert({
        channel: "meta",
        external_sku: row.sku_code,
        external_listing_id: row.request.retailer_id,
        sku_id: row.sku_id,
        listed_price: row.price,
        listed_quantity: row.stock_count,
        offer_status: dryRun ? "sync_previewed" : "sync_queued",
        raw_data: {
          catalog_id: catalogId,
          meta_payload: row.request.data,
          meta_warnings: row.warnings,
          readiness_status: row.status,
        },
        synced_at: new Date().toISOString(),
      }, { onConflict: "channel,external_sku" });
      if (listingError) throw listingError;

      await landMetaResponse(admin, {
        sync_run_id: runId,
        operation: "catalog_item_payload",
        external_id: row.request.retailer_id,
        status: "received",
        request_payload: row.request,
      });
    }

    if (!dryRun) {
      const requests = prepared.syncable
        .map((row) => row.request)
        .filter((request): request is CatalogRequest => Boolean(request));

      for (let index = 0; index < requests.length; index += META_BATCH_SIZE) {
        const batch = requests.slice(index, index + META_BATCH_SIZE);
        const batchSkuCodes = batch.map((item) => item.retailer_id);
        try {
          const response = await sendCatalogBatch(catalogId, connection.access_token, batch);
          const handles = extractBatchHandles(response);
          batchHandles.push(...handles);
          sentItems += batch.length;
          sentSkuCodes.push(...batchSkuCodes);
          await landMetaResponse(admin, {
            sync_run_id: runId,
            operation: "catalog_items_batch",
            external_id: catalogId,
            status: handles.length > 0 ? "sent" : "committed",
            request_payload: { item_type: "PRODUCT_ITEM", allow_upsert: true, requests: batch },
            response_payload: response,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : "unknown";
          errorDetails.push(message);
          await admin
            .from("channel_listing")
            .update({ offer_status: "sync_error", synced_at: new Date().toISOString() } as never)
            .eq("channel" as never, "meta")
            .in("external_sku" as never, batchSkuCodes as never);
          await landMetaResponse(admin, {
            sync_run_id: runId,
            operation: "catalog_items_batch",
            external_id: catalogId,
            status: "error",
            request_payload: { item_type: "PRODUCT_ITEM", allow_upsert: true, requests: batch },
            error: message,
          });
        }
      }

      if (sentSkuCodes.length > 0) {
        await admin
          .from("channel_listing")
          .update({ offer_status: batchHandles.length > 0 ? "sync_sent" : "synced", synced_at: new Date().toISOString() } as never)
          .eq("channel" as never, "meta")
          .in("external_sku" as never, sentSkuCodes as never);
      }
    }

    const status = errorDetails.length > 0
      ? sentItems > 0 ? "partial" : "failed"
      : "success";

    await admin.from("meta_catalog_sync_run").update({
      status,
      sent_items: dryRun ? 0 : sentItems,
      skipped_items: prepared.skippedDetails.length,
      error_items: errorDetails.length,
      summary: {
        readiness: prepared.summary,
        skippedDetails: prepared.skippedDetails,
        errorDetails,
        preview_count: prepared.syncable.length,
        batch_handles: batchHandles,
        sent_sku_codes: sentSkuCodes,
      },
      finished_at: new Date().toISOString(),
    }).eq("id", runId);

    return jsonResponse({
      success: status !== "failed",
      status,
      catalog_id: catalogId,
      run_id: runId,
      dry_run: dryRun,
      prepared: prepared.syncable.length,
      sent: dryRun ? 0 : sentItems,
      skipped: prepared.skippedDetails.length,
      errors: errorDetails.length,
      batch_handles: batchHandles,
      skippedDetails: prepared.skippedDetails,
      errorDetails,
      preview: dryRun ? prepared.syncable.slice(0, 10).map((row) => row.request) : undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown Meta catalog sync error";
    await admin.from("meta_catalog_sync_run").update({
      status: "failed",
      error_items: 1,
      summary: { error: message, readiness: prepared.summary, skippedDetails: prepared.skippedDetails, errorDetails },
      finished_at: new Date().toISOString(),
    }).eq("id", runId);
    throw err;
  }
}

async function checkBatchStatus(req: Request, body: Record<string, unknown>) {
  const admin = createAdminClient();
  await requireAdmin(req, admin);

  const connection = await getMetaConnection(admin);
  const catalogId = asString(body.catalog_id) ?? connection.selected_catalog_id;
  const handle = asString(body.handle);
  if (!catalogId) throw new Error("Select a Meta product catalog before checking batch status");
  if (!handle) throw new Error("Missing Meta batch handle");

  const payload = await metaGet<Record<string, unknown>>(`${catalogId}/check_batch_request_status`, connection.access_token, {
    handle,
    load_ids_of_invalid_requests: true,
  });

  const syncRunId = asString(body.sync_run_id);
  await landMetaResponse(admin, {
    sync_run_id: syncRunId,
    operation: "catalog_items_batch_status",
    external_id: handle,
    status: "committed",
    request_payload: { catalog_id: catalogId, handle },
    response_payload: payload,
  });

  if (syncRunId) {
    const { data: run } = await admin
      .from("meta_catalog_sync_run")
      .select("summary")
      .eq("id" as never, syncRunId)
      .maybeSingle();

    const summary = isRecord((run as Record<string, unknown> | null)?.summary)
      ? ((run as Record<string, unknown>).summary as Record<string, unknown>)
      : {};
    const sentSkuCodes = stringArray(summary.sent_sku_codes);
    const invalidIds = stringArray(payload.ids_of_invalid_requests);
    const errorCount = Number(payload.errors_total_count ?? 0);
    const terminal = isTerminalBatchStatus(payload.status);

    if (terminal && sentSkuCodes.length > 0) {
      const invalidSet = new Set(invalidIds);
      const successfulSkuCodes = sentSkuCodes.filter((skuCode) => !invalidSet.has(skuCode));
      if (successfulSkuCodes.length > 0) {
        await admin
          .from("channel_listing")
          .update({ offer_status: "synced", synced_at: new Date().toISOString() } as never)
          .eq("channel" as never, "meta")
          .in("external_sku" as never, successfulSkuCodes as never);
      }
      if (invalidIds.length > 0) {
        await admin
          .from("channel_listing")
          .update({ offer_status: "sync_error", synced_at: new Date().toISOString() } as never)
          .eq("channel" as never, "meta")
          .in("external_sku" as never, invalidIds as never);
      }
    }

    await admin.from("meta_catalog_sync_run").update({
      status: terminal ? (errorCount > 0 || invalidIds.length > 0 ? "partial" : "success") : "success",
      error_items: errorCount,
      summary: {
        ...summary,
        last_batch_status: payload,
        last_batch_status_checked_at: new Date().toISOString(),
      },
    }).eq("id", syncRunId);
  }

  return jsonResponse({ success: true, catalog_id: catalogId, handle, status: payload.status ?? null, payload });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = asString(body.action) ?? "sync_catalog";

    if (action === "catalog_readiness") return await catalogReadiness(req, body);
    if (action === "sync_catalog") return await syncCatalog(req, body);
    if (action === "check_batch_status") return await checkBatchStatus(req, body);

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
