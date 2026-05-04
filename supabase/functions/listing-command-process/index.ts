// ============================================================
// Listing Command Processor
// Processes outbound_command rows created by queue_listing_command.
// External channels are driven from the app-side outbox; external systems
// never write directly into canonical listing state.
// ============================================================

import {
  authenticateRequest,
  corsHeaders,
  createAdminClient,
  errorResponse,
  fetchWithTimeout,
  jsonResponse,
} from "../_shared/qbo-helpers.ts";
import { getEbayAccessToken } from "../_shared/ebay-auth.ts";
import { buildGmcProductInput, type GmcMappingRule } from "../_shared/gmc-product-input.ts";

const DEFAULT_BATCH_SIZE = 10;
const MAX_BATCH_SIZE = 50;
const MAX_RETRY_COUNT = 5;
const EBAY_API = "https://api.ebay.com";
const GMC_API_BASE = "https://merchantapi.googleapis.com/products/v1";

type ListingCommand = {
  id: string;
  target_system: string;
  command_type: string;
  entity_type: string;
  entity_id: string | null;
  idempotency_key: string;
  retry_count: number | null;
  payload: Record<string, unknown> | null;
};

type ProcessResult = {
  command_id: string;
  target_system: string;
  command_type: string;
  status: string;
  error?: string;
  response?: Record<string, unknown>;
  next_attempt_at?: string | null;
};

type GmcConnection = {
  id: string;
  access_token: string;
  refresh_token: string;
  token_expires_at: string;
  updated_at: string;
  merchant_id: string;
  data_source: string | null;
};

function clampBatchSize(value: unknown): number {
  const parsed = Number(value ?? DEFAULT_BATCH_SIZE);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_BATCH_SIZE;
  return Math.min(Math.floor(parsed), MAX_BATCH_SIZE);
}

function retryDelayMinutes(retryCount: number): number {
  return Math.min(60, Math.max(1, 2 ** Math.max(0, retryCount - 1)));
}

function normalizeTarget(value: string | null | undefined): string {
  const normalized = String(value ?? "web").toLowerCase();
  if (normalized === "website") return "web";
  return normalized;
}

function getSiteUrl(): string {
  const configured = Deno.env.get("SITE_URL");
  if (configured) return configured.replace(/\/$/, "");
  return "https://www.kusooishii.com";
}

function isRetryableError(message: string): boolean {
  if (/not implemented yet/i.test(message)) return false;
  if (/Unsupported .* listing command/i.test(message)) return false;
  if (/must target a channel_listing/i.test(message)) return false;
  return true;
}

function severityForCommand(command: ListingCommand): string {
  return ["publish", "end"].includes(command.command_type) ? "high" : "medium";
}

async function parseJsonResponse(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { raw_response: text };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function stringifyApiError(payload: Record<string, unknown>, fallback: string): string {
  if (typeof payload.message === "string" && payload.message.trim()) return payload.message;
  if (typeof payload.error === "string" && payload.error.trim()) return payload.error;
  if (isRecord(payload.error)) {
    const error = payload.error;
    const parts = [
      typeof error.message === "string" && error.message.trim() ? error.message : null,
      error.status ? `status=${String(error.status)}` : null,
      error.code ? `code=${String(error.code)}` : null,
      error.details ? `details=${JSON.stringify(error.details)}` : null,
    ].filter((part): part is string => Boolean(part));
    return parts.length > 0 ? parts.join(" ") : JSON.stringify(error);
  }
  if (typeof payload.raw_response === "string" && payload.raw_response.trim()) return payload.raw_response;
  return fallback;
}

async function getWebsitePrimaryImageUrl(
  admin: ReturnType<typeof createAdminClient>,
  productId: unknown,
): Promise<string | null> {
  const id = typeof productId === "string" ? productId.trim() : "";
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
  const url = typeof asset?.original_url === "string" ? asset.original_url.trim() : "";
  return url || null;
}

function withWebsitePrimaryImage(
  product: Record<string, unknown>,
  imageUrl: string | null,
): Record<string, unknown> {
  return {
    ...product,
    primary_image_url: imageUrl,
    img_url: imageUrl,
  };
}

function toBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function getGmcDataSourceName(conn: GmcConnection): string | null {
  const dataSource = conn.data_source?.trim();
  if (!dataSource) return null;
  if (dataSource.startsWith("accounts/")) return dataSource;
  return `accounts/${conn.merchant_id}/dataSources/${dataSource}`;
}

function getGmcProductInputName(merchantId: string, externalListingId: string | null, offerId: string): string {
  const storedName = externalListingId?.trim() ?? "";
  const resourceMatch = storedName.match(/^accounts\/[^/]+\/productInputs\/(.+)$/);
  if (resourceMatch) {
    const rawSegment = resourceMatch[1] ?? "";
    let decodedSegment = rawSegment;
    try {
      decodedSegment = decodeURIComponent(rawSegment);
    } catch {
      decodedSegment = rawSegment;
    }
    if (decodedSegment.startsWith("online~")) {
      return `accounts/${merchantId}/productInputs/${toBase64Url(decodedSegment.replace(/^online~/, ""))}`;
    }
    if (decodedSegment.includes("~")) {
      return `accounts/${merchantId}/productInputs/${toBase64Url(decodedSegment)}`;
    }
    return storedName;
  }

  const rawId = (storedName || offerId).replace(/^online~/, "");
  const productInputId = rawId.includes("~") ? rawId : `en~GB~${rawId}`;
  return `accounts/${merchantId}/productInputs/${toBase64Url(productInputId)}`;
}

async function recordListingCommandFailure(
  admin: ReturnType<typeof createAdminClient>,
  command: ListingCommand,
  message: string,
  retryCount: number,
  nextAttempt: string | null,
) {
  try {
    const evidence = {
      target_system: command.target_system,
      command_type: command.command_type,
      entity_type: command.entity_type,
      entity_id: command.entity_id,
      retry_count: retryCount,
      last_error: message.slice(0, 1000),
      idempotency_key: command.idempotency_key,
      next_attempt_at: nextAttempt,
      payload: command.payload ?? {},
    };

    const { data: existing } = await admin
      .from("reconciliation_case")
      .select("id")
      .eq("case_type" as never, "listing_command_failed")
      .eq("related_entity_type" as never, "outbound_command")
      .eq("related_entity_id" as never, command.id)
      .in("status" as never, ["open", "in_progress"] as never)
      .maybeSingle();

    if (existing) {
      await admin
        .from("reconciliation_case")
        .update({
          severity: severityForCommand(command),
          suspected_root_cause: "Listing outbound command failed.",
          recommended_action: "Review the listing command error, correct listing/channel data, then rerun the listing outbox processor.",
          due_at: nextAttempt,
          evidence,
          updated_at: new Date().toISOString(),
        } as never)
        .eq("id" as never, (existing as Record<string, unknown>).id);
      return;
    }

    await admin.from("reconciliation_case").insert({
      case_type: "listing_command_failed",
      severity: severityForCommand(command),
      related_entity_type: "outbound_command",
      related_entity_id: command.id,
      suspected_root_cause: "Listing outbound command failed.",
      recommended_action: "Review the listing command error, correct listing/channel data, then rerun the listing outbox processor.",
      due_at: nextAttempt,
      evidence,
    } as never);
  } catch (err) {
    console.warn("Failed to record listing command reconciliation case", err);
  }
}

async function resolveListingCommandFailure(
  admin: ReturnType<typeof createAdminClient>,
  commandId: string,
) {
  try {
    await admin
      .from("reconciliation_case")
      .update({
        status: "resolved",
        close_code: "listing_command_acknowledged",
        closed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as never)
      .eq("case_type" as never, "listing_command_failed")
      .eq("related_entity_type" as never, "outbound_command")
      .eq("related_entity_id" as never, commandId)
      .in("status" as never, ["open", "in_progress"] as never);
  } catch (err) {
    console.warn("Failed to resolve listing command reconciliation case", err);
  }
}

function isPublishedListing(row: Record<string, unknown>): boolean {
  return row.v2_status === "live" || ["live", "published", "PUBLISHED"].includes(String(row.offer_status ?? ""));
}

function publicSiteUrl(): string {
  return (Deno.env.get("SITE_URL") ?? "https://www.kusooishii.com").replace(/\/$/, "");
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function objectOrEmpty(value: unknown): Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function arrayOrEmpty(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function isSaleableStockStatus(unit: Record<string, unknown>): boolean {
  const status = String(unit.v2_status ?? unit.status ?? "");
  return ["available", "graded", "listed", "restocked"].includes(status);
}

async function fetchSeoDocument(
  admin: ReturnType<typeof createAdminClient>,
  documentKey: string,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await admin
    .from("seo_document")
    .select("id, document_key, document_type, route_path, entity_type, entity_id, entity_reference, status, published_revision_id, metadata")
    .eq("document_key" as never, documentKey)
    .maybeSingle();
  if (error) throw error;
  return (data as Record<string, unknown> | null) ?? null;
}

async function ensureSeoDocument(
  admin: ReturnType<typeof createAdminClient>,
  input: {
    documentKey: string;
    documentType: string;
    routePath?: string | null;
    entityType?: string | null;
    entityId?: string | null;
    entityReference?: string | null;
    metadata: Record<string, unknown>;
  },
): Promise<Record<string, unknown>> {
  const existing = await fetchSeoDocument(admin, input.documentKey);
  const patch = {
    document_type: input.documentType,
    route_path: input.routePath ?? null,
    entity_type: input.entityType ?? null,
    entity_id: input.entityId ?? null,
    entity_reference: input.entityReference ?? null,
    status: "published",
    metadata: {
      ...objectOrEmpty(existing?.metadata),
      ...input.metadata,
    },
    updated_at: new Date().toISOString(),
  };

  if (existing?.id) {
    const { data, error } = await admin
      .from("seo_document")
      .update(patch as never)
      .eq("id" as never, existing.id)
      .select("id, document_key, document_type, route_path, entity_type, entity_id, entity_reference, status, published_revision_id, metadata")
      .single();
    if (error) throw error;
    return data as Record<string, unknown>;
  }

  const { data, error } = await admin
    .from("seo_document")
    .insert({
      document_key: input.documentKey,
      ...patch,
    } as never)
    .select("id, document_key, document_type, route_path, entity_type, entity_id, entity_reference, status, published_revision_id, metadata")
    .single();
  if (error) throw error;
  return data as Record<string, unknown>;
}

async function fetchPublishedRevision(
  admin: ReturnType<typeof createAdminClient>,
  document: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const publishedRevisionId = typeof document.published_revision_id === "string"
    ? document.published_revision_id
    : null;
  if (!publishedRevisionId) return null;

  const { data, error } = await admin
    .from("seo_revision")
    .select("id, revision_number, canonical_path, canonical_url, title_tag, meta_description, indexation_policy, robots_directive, open_graph, twitter_card, breadcrumbs, structured_data, image_metadata, sitemap, geo, keywords, metadata")
    .eq("id" as never, publishedRevisionId)
    .maybeSingle();
  if (error) throw error;
  return (data as Record<string, unknown> | null) ?? null;
}

async function nextSeoRevisionNumber(
  admin: ReturnType<typeof createAdminClient>,
  seoDocumentId: string,
): Promise<number> {
  const { data, error } = await admin
    .from("seo_revision")
    .select("revision_number")
    .eq("seo_document_id" as never, seoDocumentId)
    .order("revision_number" as never, { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return Number((data as Record<string, unknown> | null)?.revision_number ?? 0) + 1;
}

async function ensurePublishedSeoRevision(
  admin: ReturnType<typeof createAdminClient>,
  document: Record<string, unknown>,
  defaults: {
    canonicalPath: string;
    titleTag: string;
    metaDescription: string;
    openGraph?: Record<string, unknown>;
    twitterCard?: Record<string, unknown>;
    breadcrumbs?: Array<Record<string, unknown>>;
    structuredData?: Array<Record<string, unknown>>;
    imageMetadata?: Record<string, unknown>;
    sitemap: Record<string, unknown>;
    keywords?: string[];
    source: string;
    changeSummary: string;
    metadata: Record<string, unknown>;
  },
): Promise<{ id: string; action: "created" | "updated" }> {
  const documentId = String(document.id);
  const existing = await fetchPublishedRevision(admin, document);
  const baseUrl = publicSiteUrl();
  const existingSitemap = objectOrEmpty(existing?.sitemap);
  const sitemap = {
    ...defaults.sitemap,
    ...existingSitemap,
    include: true,
  };
  const metadata = {
    ...objectOrEmpty(existing?.metadata),
    ...defaults.metadata,
  };

  if (existing?.id) {
    const patch = {
      canonical_path: textOrNull(existing.canonical_path) ?? defaults.canonicalPath,
      canonical_url: textOrNull(existing.canonical_url) ?? `${baseUrl}${defaults.canonicalPath}`,
      title_tag: textOrNull(existing.title_tag) ?? defaults.titleTag,
      meta_description: textOrNull(existing.meta_description) ?? defaults.metaDescription,
      indexation_policy: "index",
      robots_directive: "index, follow",
      open_graph: Object.keys(objectOrEmpty(existing.open_graph)).length ? existing.open_graph : (defaults.openGraph ?? {}),
      twitter_card: Object.keys(objectOrEmpty(existing.twitter_card)).length ? existing.twitter_card : (defaults.twitterCard ?? {}),
      breadcrumbs: arrayOrEmpty(existing.breadcrumbs).length ? existing.breadcrumbs : (defaults.breadcrumbs ?? []),
      structured_data: defaults.structuredData ?? arrayOrEmpty(existing.structured_data),
      image_metadata: Object.keys(objectOrEmpty(existing.image_metadata)).length ? existing.image_metadata : (defaults.imageMetadata ?? {}),
      sitemap,
      geo: Object.keys(objectOrEmpty(existing.geo)).length ? existing.geo : { region: "GB", placename: "United Kingdom" },
      keywords: Array.isArray(existing.keywords) && existing.keywords.length ? existing.keywords : (defaults.keywords ?? []),
      metadata,
    };

    const { error } = await admin
      .from("seo_revision")
      .update(patch as never)
      .eq("id" as never, existing.id);
    if (error) throw error;
    return { id: String(existing.id), action: "updated" };
  }

  const revisionNumber = await nextSeoRevisionNumber(admin, documentId);
  const insert = {
    seo_document_id: documentId,
    revision_number: revisionNumber,
    status: "published",
    canonical_path: defaults.canonicalPath,
    canonical_url: `${baseUrl}${defaults.canonicalPath}`,
    title_tag: defaults.titleTag,
    meta_description: defaults.metaDescription,
    indexation_policy: "index",
    robots_directive: "index, follow",
    open_graph: defaults.openGraph ?? {},
    twitter_card: defaults.twitterCard ?? {},
    breadcrumbs: defaults.breadcrumbs ?? [],
    structured_data: defaults.structuredData ?? [],
    image_metadata: defaults.imageMetadata ?? {},
    sitemap,
    geo: { region: "GB", placename: "United Kingdom" },
    keywords: defaults.keywords ?? [],
    source: defaults.source,
    change_summary: defaults.changeSummary,
    published_at: new Date().toISOString(),
    metadata,
  };

  const { data, error } = await admin
    .from("seo_revision")
    .insert(insert as never)
    .select("id")
    .single();
  if (error) throw error;

  const revisionId = String((data as Record<string, unknown>).id);
  const { error: docErr } = await admin
    .from("seo_document")
    .update({
      published_revision_id: revisionId,
      status: "published",
      updated_at: new Date().toISOString(),
    } as never)
    .eq("id" as never, documentId);
  if (docErr) throw docErr;

  return { id: revisionId, action: "created" };
}

async function touchDiscoveryDocument(
  admin: ReturnType<typeof createAdminClient>,
  input: {
    documentKey: string;
    documentType: string;
    routePath: string;
    titleTag: string;
    metaDescription: string;
    sitemapFamily: string;
    sitemapChangefreq: string;
    sitemapPriority: number;
    entityType?: string | null;
    entityId?: string | null;
    entityReference?: string | null;
    metadata: Record<string, unknown>;
  },
): Promise<Record<string, unknown>> {
  const document = await ensureSeoDocument(admin, {
    documentKey: input.documentKey,
    documentType: input.documentType,
    routePath: input.routePath,
    entityType: input.entityType ?? null,
    entityId: input.entityId ?? null,
    entityReference: input.entityReference ?? null,
    metadata: input.metadata,
  });

  const revision = await ensurePublishedSeoRevision(admin, document, {
    canonicalPath: input.routePath,
    titleTag: input.titleTag,
    metaDescription: input.metaDescription,
    breadcrumbs: [
      { name: "Home", path: "/" },
      { name: input.titleTag, path: input.routePath },
    ],
    sitemap: {
      include: true,
      family: input.sitemapFamily,
      changefreq: input.sitemapChangefreq,
      priority: input.sitemapPriority,
    },
    keywords: [input.titleTag, "LEGO resale", "graded LEGO sets"],
    source: "storefront_publish",
    changeSummary: "Refreshed after website listing publication.",
    metadata: input.metadata,
  });

  return {
    document_key: input.documentKey,
    revision_id: revision.id,
    revision_action: revision.action,
  };
}

async function refreshStorefrontDiscovery(
  admin: ReturnType<typeof createAdminClient>,
  listingId: string,
  commandType: string,
): Promise<Record<string, unknown>> {
  try {
    const { data: listing, error: listingErr } = await admin
      .from("channel_listing")
      .select("id, channel, v2_channel, sku_id, external_sku, listed_price, listed_quantity, listing_title, listing_description, offer_status, v2_status, listed_at, updated_at")
      .eq("id" as never, listingId)
      .maybeSingle();
    if (listingErr) throw listingErr;
    if (!listing) return { refreshed: false, reason: "listing_not_found" };

    const listingRow = listing as Record<string, unknown>;
    const channel = normalizeTarget(textOrNull(listingRow.channel) ?? textOrNull(listingRow.v2_channel) ?? "web");
    if (channel !== "web") return { refreshed: false, reason: "not_website_listing" };

    const skuId = textOrNull(listingRow.sku_id);
    if (!skuId) return { refreshed: false, reason: "missing_sku" };

    const { data: sku, error: skuErr } = await admin
      .from("sku")
      .select("id, sku_code, condition_grade, product_id")
      .eq("id" as never, skuId)
      .maybeSingle();
    if (skuErr) throw skuErr;
    if (!sku) return { refreshed: false, reason: "sku_not_found" };

    const skuRow = sku as Record<string, unknown>;
    const productId = textOrNull(skuRow.product_id);
    if (!productId) return { refreshed: false, reason: "missing_product" };

    const { data: product, error: productErr } = await admin
      .from("product")
      .select("id, mpn, name, seo_title, seo_description, description, img_url, product_type, theme_id, subtheme_name, release_year, retired_flag")
      .eq("id" as never, productId)
      .maybeSingle();
    if (productErr) throw productErr;
    if (!product) return { refreshed: false, reason: "product_not_found" };

    const productRow = product as Record<string, unknown>;
    const mpn = textOrNull(productRow.mpn);
    const productName = textOrNull(productRow.name) ?? mpn;
    if (!mpn || !productName) return { refreshed: false, reason: "missing_product_mpn_or_name" };

    const themeId = textOrNull(productRow.theme_id);
    let theme: Record<string, unknown> | null = null;
    if (themeId) {
      const { data: themeData, error: themeErr } = await admin
        .from("theme")
        .select("id, name, slug")
        .eq("id" as never, themeId)
        .maybeSingle();
      if (themeErr) throw themeErr;
      theme = (themeData as Record<string, unknown> | null) ?? null;
    }

    const { data: stockUnits, error: stockErr } = await admin
      .from("stock_unit")
      .select("id, status, v2_status")
      .eq("sku_id" as never, skuId);
    if (stockErr) throw stockErr;
    const stockCount = ((stockUnits ?? []) as Record<string, unknown>[]).filter(isSaleableStockStatus).length;

    const baseUrl = publicSiteUrl();
    const productPath = `/sets/${encodeURIComponent(mpn)}`;
    const listedAt = textOrNull(listingRow.listed_at) ?? textOrNull(listingRow.updated_at) ?? new Date().toISOString();
    const listedPrice = Number(listingRow.listed_price ?? 0);
    const description = textOrNull(productRow.seo_description)
      ?? textOrNull(productRow.description)
      ?? `Shop ${productName} with graded condition options and fast UK shipping from Kuso Oishii.`;
    const title = textOrNull(productRow.seo_title) ?? `${productName} (${mpn})`;
    const imageUrl = textOrNull(productRow.img_url);
    const themeName = textOrNull(theme?.name);
    const metadata = {
      refreshed_from: "listing-command-process",
      refreshed_reason: `website_${commandType}`,
      last_storefront_listing_id: listingId,
      last_storefront_sku_id: skuId,
      last_storefront_listed_at: listedAt,
    };

    const productDocument = await ensureSeoDocument(admin, {
      documentKey: `product:${mpn}`,
      documentType: "product",
      routePath: null,
      entityType: "product",
      entityId: productId,
      entityReference: mpn,
      metadata,
    });
    const productRevision = await ensurePublishedSeoRevision(admin, productDocument, {
      canonicalPath: productPath,
      titleTag: title,
      metaDescription: description,
      openGraph: {
        type: "product",
        site_name: "Kuso Oishii",
        title,
        description,
        url: `${baseUrl}${productPath}`,
        image: imageUrl,
      },
      twitterCard: {
        card: imageUrl ? "summary_large_image" : "summary",
        title,
        description,
        image: imageUrl,
      },
      breadcrumbs: [
        { name: "Home", path: "/" },
        { name: "Browse LEGO Sets", path: "/browse" },
        { name: productName, path: productPath },
      ],
      structuredData: [{
        "@context": "https://schema.org",
        "@type": "Product",
        name: productName,
        sku: mpn,
        mpn,
        description,
        image: imageUrl ? [imageUrl] : undefined,
        brand: { "@type": "Brand", name: "LEGO" },
        offers: listedPrice > 0 ? [{
          "@type": "Offer",
          priceCurrency: "GBP",
          price: listedPrice,
          availability: stockCount > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
          url: `${baseUrl}${productPath}`,
        }] : [],
      }],
      imageMetadata: imageUrl ? { url: imageUrl, alt: `${productName} product image` } : {},
      sitemap: { include: true, family: "product", changefreq: "weekly", priority: 0.8 },
      keywords: [mpn, productName, themeName, "LEGO resale", "graded LEGO sets", "UK LEGO store"].filter((value): value is string => Boolean(value)),
      source: "storefront_publish",
      changeSummary: "Created or refreshed after website listing publication.",
      metadata,
    });

    const touched: Record<string, unknown>[] = [];
    for (const route of [
      {
        documentKey: "route:/browse",
        documentType: "route",
        routePath: "/browse",
        titleTag: "Browse LEGO Sets",
        metaDescription: "Browse graded LEGO sets and minifigures with clear condition data at Kuso Oishii.",
        sitemapFamily: "browse",
        sitemapChangefreq: "weekly",
        sitemapPriority: 0.7,
      },
      {
        documentKey: "route:/themes",
        documentType: "route",
        routePath: "/themes",
        titleTag: "Browse Themes",
        metaDescription: "Browse LEGO sets by theme at Kuso Oishii.",
        sitemapFamily: "browse",
        sitemapChangefreq: "weekly",
        sitemapPriority: 0.7,
      },
      {
        documentKey: "route:/new-arrivals",
        documentType: "route",
        routePath: "/new-arrivals",
        titleTag: "New Arrivals",
        metaDescription: "See the latest graded LEGO stock newly added to Kuso Oishii.",
        sitemapFamily: "browse",
        sitemapChangefreq: "weekly",
        sitemapPriority: 0.7,
      },
      {
        documentKey: "route:/deals",
        documentType: "route",
        routePath: "/deals",
        titleTag: "Deals",
        metaDescription: "Explore graded LEGO deals with clear condition details and fair UK pricing.",
        sitemapFamily: "browse",
        sitemapChangefreq: "weekly",
        sitemapPriority: 0.7,
      },
      {
        documentKey: "collection:new-arrivals",
        documentType: "collection",
        routePath: "/new-arrivals",
        titleTag: "New Arrivals",
        metaDescription: "See the latest graded LEGO stock newly added to Kuso Oishii.",
        sitemapFamily: "collection",
        sitemapChangefreq: "weekly",
        sitemapPriority: 0.7,
        entityReference: "new-arrivals",
      },
      {
        documentKey: "collection:deals",
        documentType: "collection",
        routePath: "/deals",
        titleTag: "Deals",
        metaDescription: "Explore graded LEGO deals with clear condition details and fair UK pricing.",
        sitemapFamily: "collection",
        sitemapChangefreq: "weekly",
        sitemapPriority: 0.7,
        entityReference: "deals",
      },
    ]) {
      touched.push(await touchDiscoveryDocument(admin, {
        ...route,
        metadata,
      }));
    }

    if (themeId && themeName) {
      touched.push(await touchDiscoveryDocument(admin, {
        documentKey: `theme:${themeId}`,
        documentType: "theme",
        routePath: `/browse?theme=${encodeURIComponent(themeId)}`,
        titleTag: `${themeName} LEGO Sets`,
        metaDescription: `Browse graded ${themeName} LEGO sets and minifigures with clear condition data at Kuso Oishii.`,
        sitemapFamily: "theme",
        sitemapChangefreq: "weekly",
        sitemapPriority: 0.7,
        entityType: "theme",
        entityId: themeId,
        entityReference: themeName,
        metadata,
      }));
    }

    return {
      refreshed: true,
      product_document_key: `product:${mpn}`,
      product_revision_id: productRevision.id,
      product_revision_action: productRevision.action,
      touched_documents: touched,
      stock_count: stockCount,
    };
  } catch (err) {
    console.warn("Failed to refresh storefront discovery after website listing command", err);
    return {
      refreshed: false,
      reason: err instanceof Error ? err.message : "unknown_error",
    };
  }
}

async function resetStaleProcessingCommands(admin: ReturnType<typeof createAdminClient>): Promise<number> {
  const cutoff = new Date(Date.now() - 15 * 60_000).toISOString();
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("outbound_command")
    .update({
      status: "pending",
      next_attempt_at: now,
      last_error: "Recovered stale listing outbox processing claim.",
      updated_at: now,
    } as never)
    .eq("entity_type" as never, "channel_listing")
    .eq("status" as never, "processing")
    .is("sent_at" as never, null)
    .lt("updated_at" as never, cutoff)
    .select("id");

  if (error) {
    console.warn("Failed to reset stale listing commands", error);
    return 0;
  }

  return (data ?? []).length;
}

async function queueGmcPublishAfterWebPublish(
  admin: ReturnType<typeof createAdminClient>,
  webListingId: string,
): Promise<Record<string, unknown>> {
  try {
    const { data: webListing, error: webErr } = await admin
      .from("channel_listing")
      .select("id, sku_id, external_sku, listed_price, listed_quantity, listing_title, listing_description, offer_status, v2_status")
      .eq("id" as never, webListingId)
      .maybeSingle();
    if (webErr) throw webErr;
    if (!webListing) return { queued: false, reason: "web_listing_not_found" };

    const webRow = webListing as Record<string, unknown>;
    if (!isPublishedListing(webRow)) return { queued: false, reason: "web_listing_not_live" };

    const skuId = typeof webRow.sku_id === "string" ? webRow.sku_id : null;
    if (!skuId) return { queued: false, reason: "missing_sku" };

    const listedPrice = Number(webRow.listed_price ?? 0);
    if (!Number.isFinite(listedPrice) || listedPrice <= 0) {
      return { queued: false, reason: "missing_listed_price" };
    }

    const conn = await getGmcConnection(admin);
    if (!conn.data_source) return { queued: false, reason: "missing_gmc_data_source" };

    const { data: sku, error: skuErr } = await admin
      .from("sku")
      .select("id, sku_code, condition_grade, product:product_id(id, mpn, name, seo_title, seo_description, description, img_url, product_type, lego_theme, lego_subtheme, subtheme_name, piece_count, release_year, retired_flag, weight_kg, ean, upc, isbn, gmc_product_category)")
      .eq("id" as never, skuId)
      .single();
    if (skuErr) throw skuErr;

    const skuRow = sku as Record<string, unknown>;
    const skuCode = String(skuRow.sku_code ?? webRow.external_sku ?? "").trim();
    if (!skuCode) return { queued: false, reason: "missing_sku_code" };

    const productRelation = skuRow.product as Record<string, unknown> | Record<string, unknown>[] | null;
    const product = Array.isArray(productRelation) ? productRelation[0] ?? null : productRelation;
    if (!product) return { queued: false, reason: "missing_product" };
    const websitePrimaryImageUrl = await getWebsitePrimaryImageUrl(admin, product.id);
    if (!websitePrimaryImageUrl) return { queued: false, reason: "missing_website_primary_image" };
    const productForGmc = withWebsitePrimaryImage(product, websitePrimaryImageUrl);

    const { count } = await admin
      .from("stock_unit")
      .select("id", { count: "exact", head: true })
      .eq("sku_id" as never, skuId)
      .in("v2_status" as never, ["graded", "listed", "restocked"] as never);
    const stockCount = count ?? Number(webRow.listed_quantity ?? 0);

    const gmcMappings = await getGmcMappings(admin);
    const { warnings } = buildGmcProductInput(
      {
        external_sku: skuCode,
        listing_title: typeof webRow.listing_title === "string" ? webRow.listing_title : null,
        listing_description: typeof webRow.listing_description === "string" ? webRow.listing_description : null,
        listed_price: listedPrice,
      },
      skuRow,
      productForGmc,
      stockCount,
      getSiteUrl(),
      gmcMappings,
    );

    const { data: existingListing, error: existingListingErr } = await admin
      .from("channel_listing")
      .select("id, channel, offer_status, v2_status")
      .in("channel" as never, ["google_shopping", "gmc"] as never)
      .eq("external_sku" as never, skuCode)
      .order("updated_at" as never, { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existingListingErr) throw existingListingErr;

    const existingListingRow = existingListing as Record<string, unknown> | null;
    const gmcTarget = typeof existingListingRow?.channel === "string" ? existingListingRow.channel : "google_shopping";

    if (existingListingRow && isPublishedListing(existingListingRow)) {
      return {
        queued: false,
        reason: "already_live",
        listing_id: existingListingRow.id,
      };
    }

    const listingPatch = {
      channel: gmcTarget,
      external_sku: skuCode,
      sku_id: skuId,
      offer_status: "publish_queued",
      listed_price: listedPrice,
      listed_quantity: stockCount,
      raw_data: {
        gmc_warnings: warnings,
        auto_queued_from_web_listing_id: webListingId,
      },
      synced_at: new Date().toISOString(),
    };

    const listingMutation = existingListing
      ? admin
        .from("channel_listing")
        .update(listingPatch as never)
        .eq("id" as never, existingListingRow?.id)
      : admin
        .from("channel_listing")
        .insert(listingPatch as never);

    const { data: gmcListing, error: listingErr } = await listingMutation
      .select("id")
      .single();
    if (listingErr) throw listingErr;

    const gmcListingId = String((gmcListing as Record<string, unknown>).id);
    const { data: existingCommand, error: existingCommandErr } = await admin
      .from("outbound_command")
      .select("id, status")
      .eq("target_system" as never, gmcTarget)
      .eq("command_type" as never, "publish")
      .eq("entity_type" as never, "channel_listing")
      .eq("entity_id" as never, gmcListingId)
      .in("status" as never, ["pending", "processing"] as never)
      .order("created_at" as never, { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existingCommandErr) throw existingCommandErr;
    if (existingCommand) {
      return {
        queued: true,
        already_pending: true,
        listing_id: gmcListingId,
        command_id: (existingCommand as Record<string, unknown>).id,
        warnings,
      };
    }

    const { error: snapshotErr } = await admin.rpc("create_price_decision_snapshot", {
      p_sku_id: skuId,
      p_channel: "google_shopping",
      p_channel_listing_id: gmcListingId,
      p_candidate_price: listedPrice,
    });
    if (snapshotErr) throw snapshotErr;

    const { data: commandId, error: commandErr } = await admin.rpc("queue_listing_command", {
      p_channel_listing_id: gmcListingId,
      p_command_type: "publish",
    });
    if (commandErr) throw commandErr;

    return {
      queued: true,
      listing_id: gmcListingId,
      command_id: commandId,
      warnings,
    };
  } catch (err) {
    console.warn("Failed to auto-queue GMC publish after website publish", err);
    return {
      queued: false,
      reason: err instanceof Error ? err.message : "unknown_error",
    };
  }
}

async function acknowledgeWebCommand(admin: ReturnType<typeof createAdminClient>, command: ListingCommand) {
  if (command.entity_type !== "channel_listing" || !command.entity_id) {
    throw new Error("Website listing command must target a channel_listing");
  }

  const now = new Date().toISOString();
  const statusPatch: Record<string, unknown> = {
    synced_at: now,
  };

  if (command.command_type === "publish") {
    statusPatch.offer_status = "PUBLISHED";
    statusPatch.v2_status = "live";
    statusPatch.listed_at = now;
  } else if (command.command_type === "pause") {
    statusPatch.offer_status = "PAUSED";
    statusPatch.v2_status = "paused";
  } else if (command.command_type === "end") {
    statusPatch.offer_status = "ENDED";
    statusPatch.v2_status = "ended";
  } else if (command.command_type === "reprice" || command.command_type === "update_price") {
    const listedPrice = command.payload?.listed_price;
    if (typeof listedPrice === "number" && listedPrice > 0) {
      statusPatch.listed_price = listedPrice;
      statusPatch.fee_adjusted_price = listedPrice;
    }
  } else if (command.command_type === "sync_quantity") {
    const listedQuantity = Number(command.payload?.listed_quantity ?? 0);
    if (!Number.isFinite(listedQuantity) || listedQuantity < 0) {
      throw new Error("Website quantity sync command has invalid listed_quantity");
    }
    statusPatch.listed_quantity = Math.floor(listedQuantity);
  } else {
    throw new Error(`Unsupported website listing command ${command.command_type}`);
  }

  const { error } = await admin
    .from("channel_listing")
    .update(statusPatch as never)
    .eq("id" as never, command.entity_id);

  if (error) throw error;

  const storefrontDiscovery = await refreshStorefrontDiscovery(admin, command.entity_id, command.command_type);
  const gmcAutoPublish = command.command_type === "publish"
    ? await queueGmcPublishAfterWebPublish(admin, command.entity_id)
    : null;

  return {
    channel_listing_id: command.entity_id,
    applied_locally: true,
    patch: statusPatch,
    storefront_discovery: storefrontDiscovery,
    gmc_auto_publish: gmcAutoPublish,
  };
}

async function ebayApiFetch(token: string, path: string, options: RequestInit = {}): Promise<Record<string, unknown> | null> {
  const res = await fetchWithTimeout(`${EBAY_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Content-Language": "en-GB",
      "Accept-Language": "en-GB",
      "X-EBAY-C-MARKETPLACE-ID": "EBAY_GB",
      ...(options.headers || {}),
    },
  }, 60_000);

  const payload = await parseJsonResponse(res);
  if (!res.ok) {
    throw new Error(String(payload.error ?? payload.message ?? payload.raw_response ?? `eBay API failed [${res.status}] ${path}`));
  }
  return payload;
}

async function processEbayEndCommand(
  admin: ReturnType<typeof createAdminClient>,
  command: ListingCommand,
): Promise<Record<string, unknown>> {
  if (!command.entity_id) {
    throw new Error("eBay end command must target a channel_listing");
  }

  const { data: listing, error } = await admin
    .from("channel_listing")
    .select("id, external_listing_id, external_sku")
    .eq("id" as never, command.entity_id)
    .maybeSingle();

  if (error) throw error;
  if (!listing) throw new Error(`channel_listing ${command.entity_id} not found`);

  const offerId = (listing as Record<string, unknown>).external_listing_id as string | null;
  if (offerId) {
    const token = await getEbayAccessToken(admin);
    try {
      await ebayApiFetch(token, `/sell/inventory/v1/offer/${encodeURIComponent(offerId)}/withdraw`, {
        method: "POST",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const alreadyEnded =
        /\[404\]|not\s+found|already\s+(ended|withdrawn)|not\s+published|not\s+active/i.test(message);
      if (!alreadyEnded) throw err;
    }
  }

  const now = new Date().toISOString();
  const { error: updateErr } = await admin
    .from("channel_listing")
    .update({
      offer_status: "ENDED",
      v2_status: "ended",
      listed_quantity: 0,
      synced_at: now,
    } as never)
    .eq("id" as never, command.entity_id);

  if (updateErr) throw updateErr;

  return {
    channel_listing_id: command.entity_id,
    offer_id: offerId,
    ended_on_ebay: Boolean(offerId),
  };
}

async function processEbayQuantityCommand(
  admin: ReturnType<typeof createAdminClient>,
  command: ListingCommand,
): Promise<Record<string, unknown>> {
  if (!command.entity_id) {
    throw new Error("eBay quantity command must target a channel_listing");
  }

  const { data: listing, error } = await admin
    .from("channel_listing")
    .select("id, sku_id, external_listing_id, external_sku")
    .eq("id" as never, command.entity_id)
    .maybeSingle();

  if (error) throw error;
  if (!listing) throw new Error(`channel_listing ${command.entity_id} not found`);

  const listingRow = listing as Record<string, unknown>;
  const sku = listingRow.external_sku as string | null;
  const offerId = listingRow.external_listing_id as string | null;
  const payloadQuantity = Number(command.payload?.listed_quantity);
  let quantity = Number.isFinite(payloadQuantity) && payloadQuantity >= 0 ? Math.floor(payloadQuantity) : null;

  if (!sku) throw new Error("eBay quantity command listing has no external_sku");

  if (quantity == null) {
    const skuId = listingRow.sku_id as string | null;
    if (!skuId) throw new Error("eBay quantity command listing has no sku_id");

    const { count } = await admin
      .from("stock_unit")
      .select("id", { count: "exact", head: true })
      .eq("sku_id" as never, skuId)
      .in("v2_status" as never, ["graded", "listed", "restocked"] as never);
    quantity = count ?? 0;
  }

  const token = await getEbayAccessToken(admin);
  let withdrew = false;

  if (quantity === 0) {
    if (offerId) {
      let withdrawError: string | null = null;
      try {
        await ebayApiFetch(token, `/sell/inventory/v1/offer/${encodeURIComponent(offerId)}/withdraw`, {
          method: "POST",
        });
      } catch (err) {
        withdrawError = err instanceof Error ? err.message : String(err);
      }

      let confirmedEnded = false;
      try {
        const offer = await ebayApiFetch(token, `/sell/inventory/v1/offer/${encodeURIComponent(offerId)}`);
        const offerStatus = String(offer?.status ?? "").toUpperCase();
        const listingStatus = String((offer?.listing as Record<string, unknown> | undefined)?.listingStatus ?? "").toUpperCase();
        confirmedEnded = offerStatus !== "PUBLISHED" || (listingStatus !== "" && listingStatus !== "ACTIVE");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (/\[404\]|not\s+found|25710/i.test(message)) confirmedEnded = true;
      }

      if (!confirmedEnded) {
        throw new Error(
          `Withdraw did not end offer ${offerId} for ${sku}. ` +
            (withdrawError ? `Withdraw response: ${withdrawError}. ` : "") +
            "Offer is still published on eBay.",
        );
      }
      withdrew = true;
    }
  } else {
    const existing = await ebayApiFetch(token, `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`);
    if (!existing) throw new Error(`Inventory item ${sku} not found on eBay`);

    await ebayApiFetch(token, `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`, {
      method: "PUT",
      body: JSON.stringify({
        ...existing,
        availability: {
          ...((existing.availability as Record<string, unknown> | undefined) ?? {}),
          shipToLocationAvailability: {
            ...(((existing.availability as Record<string, unknown> | undefined)?.shipToLocationAvailability as Record<string, unknown> | undefined) ?? {}),
            quantity,
          },
        },
      }),
    });
  }

  const patch: Record<string, unknown> = {
    listed_quantity: quantity,
    synced_at: new Date().toISOString(),
  };
  if (withdrew) {
    patch.offer_status = "ENDED";
    patch.v2_status = "ended";
  }

  const { error: updateErr } = await admin
    .from("channel_listing")
    .update(patch as never)
    .eq("id" as never, command.entity_id);
  if (updateErr) throw updateErr;

  return {
    channel_listing_id: command.entity_id,
    external_sku: sku,
    listed_quantity: quantity,
    withdrew,
  };
}

async function processEbayCommand(
  admin: ReturnType<typeof createAdminClient>,
  command: ListingCommand,
): Promise<Record<string, unknown>> {
  if (command.entity_type !== "channel_listing" || !command.entity_id) {
    throw new Error("eBay listing command must target a channel_listing");
  }

  if (!["publish", "reprice", "update_price", "end", "sync_quantity"].includes(command.command_type)) {
    throw new Error(`Unsupported eBay listing command ${command.command_type}`);
  }

  if (command.command_type === "end") {
    return processEbayEndCommand(admin, command);
  }
  if (command.command_type === "sync_quantity") {
    return processEbayQuantityCommand(admin, command);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  }

  const res = await fetchWithTimeout(`${supabaseUrl}/functions/v1/ebay-push-listing`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ listingId: command.entity_id }),
  }, 90_000);

  const payload = await parseJsonResponse(res);
  if (!res.ok || payload.success === false) {
    throw new Error(String(payload.error ?? payload.message ?? `ebay-push-listing failed [${res.status}]`));
  }
  return payload;
}

async function getGmcConnection(admin: ReturnType<typeof createAdminClient>): Promise<GmcConnection> {
  const { data, error } = await admin
    .from("google_merchant_connection")
    .select("*")
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("No Google Merchant Centre connection found");

  const row = data as Record<string, unknown>;
  return {
    id: String(row.id),
    access_token: String(row.access_token),
    refresh_token: String(row.refresh_token),
    token_expires_at: String(row.token_expires_at),
    updated_at: String(row.updated_at),
    merchant_id: String(row.merchant_id),
    data_source: row.data_source ? String(row.data_source) : null,
  };
}

async function getGmcMappings(admin: ReturnType<typeof createAdminClient>): Promise<GmcMappingRule[]> {
  const { data, error } = await admin
    .from("channel_attribute_mapping")
    .select("aspect_key, canonical_key, constant_value, transform")
    .eq("channel" as never, "gmc")
    .or("marketplace.eq.GB,marketplace.is.null")
    .is("category_id" as never, null);

  if (error) throw error;
  return (data ?? []) as unknown as GmcMappingRule[];
}

async function ensureGmcToken(
  admin: ReturnType<typeof createAdminClient>,
  conn: GmcConnection,
): Promise<string> {
  if (new Date(conn.token_expires_at) > new Date(Date.now() + 60_000)) {
    return conn.access_token;
  }

  const clientId = Deno.env.get("GMC_CLIENT_ID") ?? "";
  const clientSecret = Deno.env.get("GMC_CLIENT_SECRET") ?? "";
  if (!clientId || !clientSecret) throw new Error("GMC_CLIENT_ID and GMC_CLIENT_SECRET are required");

  const res = await fetchWithTimeout("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: conn.refresh_token,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  }, 30_000);

  const payload = await parseJsonResponse(res);
  if (!res.ok) {
    throw new Error(stringifyApiError(payload, `GMC token refresh failed [${res.status}]`));
  }

  const accessToken = String(payload.access_token ?? "");
  if (!accessToken) throw new Error("GMC token refresh returned no access token");

  await admin
    .from("google_merchant_connection")
    .update({
      access_token: accessToken,
      refresh_token: typeof payload.refresh_token === "string" ? payload.refresh_token : conn.refresh_token,
      token_expires_at: new Date(Date.now() + Number(payload.expires_in ?? 3600) * 1000).toISOString(),
    } as never)
    .eq("id" as never, conn.id)
    .eq("updated_at" as never, conn.updated_at);

  return accessToken;
}

async function processGoogleShoppingCommand(
  admin: ReturnType<typeof createAdminClient>,
  command: ListingCommand,
): Promise<Record<string, unknown>> {
  if (command.entity_type !== "channel_listing" || !command.entity_id) {
    throw new Error("Google Shopping listing command must target a channel_listing");
  }

  if (!["publish", "reprice", "update_price", "end", "sync_quantity"].includes(command.command_type)) {
    throw new Error(`Unsupported Google Shopping listing command ${command.command_type}`);
  }

  const conn = await getGmcConnection(admin);
  if (!conn.data_source && command.command_type !== "end") {
    throw new Error("No GMC data source configured on google_merchant_connection");
  }
  const accessToken = await ensureGmcToken(admin, conn);

  const { data: listing, error: listingErr } = await admin
    .from("channel_listing")
    .select("id, sku_id, external_sku, external_listing_id, listed_price, listed_quantity, listing_title, listing_description")
    .eq("id" as never, command.entity_id)
    .maybeSingle();
  if (listingErr) throw listingErr;
  if (!listing) throw new Error(`channel_listing ${command.entity_id} not found`);

  const listingRow = listing as Record<string, unknown>;
  const dataSourceName = getGmcDataSourceName(conn);

  if (command.command_type === "end") {
    const externalListingId = listingRow.external_listing_id as string | null;
    if (externalListingId) {
      if (!dataSourceName) {
        throw new Error("No GMC data source configured on google_merchant_connection");
      }
      const productInputName = getGmcProductInputName(
        conn.merchant_id,
        externalListingId,
        String(listingRow.external_sku ?? ""),
      );
      const deleteRes = await fetchWithTimeout(
        `${GMC_API_BASE}/${productInputName}?dataSource=${encodeURIComponent(dataSourceName)}`,
        { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } },
        60_000,
      );
      if (!deleteRes.ok && deleteRes.status !== 404) {
        const payload = await parseJsonResponse(deleteRes);
        throw new Error(stringifyApiError(payload, `GMC delete failed [${deleteRes.status}]`));
      }
    }

    await admin
      .from("channel_listing")
      .update({
        offer_status: "ended",
        v2_status: "ended",
        listed_quantity: 0,
        synced_at: new Date().toISOString(),
      } as never)
      .eq("id" as never, command.entity_id);

    return {
      channel_listing_id: command.entity_id,
      external_listing_id: externalListingId,
      deleted_from_gmc: Boolean(externalListingId),
    };
  }

  const skuId = listingRow.sku_id as string | null;
  if (!skuId) throw new Error("Google Shopping listing has no sku_id");

  const { data: sku, error: skuErr } = await admin
    .from("sku")
    .select("id, sku_code, condition_grade, product:product_id(id, mpn, name, seo_title, seo_description, description, img_url, product_type, lego_theme, lego_subtheme, subtheme_name, piece_count, release_year, retired_flag, weight_kg, ean, upc, isbn, gmc_product_category)")
    .eq("id" as never, skuId)
    .single();
  if (skuErr) throw skuErr;

  const skuRow = sku as Record<string, unknown>;
  const productRelation = skuRow.product as Record<string, unknown> | Record<string, unknown>[] | null;
  const product = Array.isArray(productRelation) ? productRelation[0] ?? null : productRelation;
  if (!product) throw new Error("Google Shopping listing SKU has no product");
  const websitePrimaryImageUrl = await getWebsitePrimaryImageUrl(admin, product.id);
  const productForGmc = withWebsitePrimaryImage(product, websitePrimaryImageUrl);

  const { count } = await admin
    .from("stock_unit")
    .select("id", { count: "exact", head: true })
    .eq("sku_id" as never, skuId)
    .in("v2_status" as never, ["graded", "listed", "restocked"] as never);
  const stockCount = count ?? Number(listingRow.listed_quantity ?? 0);
  const gmcMappings = await getGmcMappings(admin);
  const { input: productInput, warnings } = buildGmcProductInput(listingRow, skuRow, productForGmc, stockCount, getSiteUrl(), gmcMappings);
  if (!dataSourceName) {
    throw new Error("No GMC data source configured on google_merchant_connection");
  }

  const insertRes = await fetchWithTimeout(
    `${GMC_API_BASE}/accounts/${conn.merchant_id}/productInputs:insert?dataSource=${encodeURIComponent(dataSourceName)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(productInput),
    },
    90_000,
  );
  const payload = await parseJsonResponse(insertRes);
  if (!insertRes.ok) {
    throw new Error(stringifyApiError(payload, `GMC insert failed [${insertRes.status}]`));
  }

  const externalListingId = typeof payload.base64EncodedName === "string"
    ? payload.base64EncodedName
    : typeof payload.name === "string"
      ? payload.name
      : listingRow.external_listing_id ?? null;
  await admin
    .from("channel_listing")
    .update({
      external_listing_id: externalListingId,
      offer_status: "published",
      v2_status: "live",
      listed_quantity: stockCount,
      synced_at: new Date().toISOString(),
      raw_data: {
        gmc_response: payload,
        gmc_warnings: warnings,
      },
    } as never)
    .eq("id" as never, command.entity_id);

  return {
    channel_listing_id: command.entity_id,
    external_listing_id: externalListingId,
    gmc_response: payload,
    warnings,
  };
}

async function processCommand(
  admin: ReturnType<typeof createAdminClient>,
  command: ListingCommand,
): Promise<Record<string, unknown>> {
  if (command.entity_type !== "channel_listing") {
    throw new Error(`Unsupported command entity type ${command.entity_type}`);
  }

  const target = normalizeTarget(command.target_system);
  if (target === "web") return acknowledgeWebCommand(admin, command);
  if (target === "ebay") return processEbayCommand(admin, command);
  if (target === "google_shopping" || target === "gmc") return processGoogleShoppingCommand(admin, command);

  throw new Error(
    `Listing command target '${command.target_system}' is not implemented yet. ` +
      "Add a channel adapter before queueing publish/reprice commands for this channel.",
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const admin = createAdminClient();
    await authenticateRequest(req, admin);

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const batchSize = clampBatchSize(body.batchSize ?? body.batch_size);
    const commandId = typeof body.commandId === "string" ? body.commandId : null;
    const recoveredStaleCommands = await resetStaleProcessingCommands(admin);

    let query = admin
      .from("outbound_command")
      .select("id,target_system,command_type,entity_type,entity_id,idempotency_key,retry_count,payload")
      .eq("entity_type" as never, "channel_listing")
      .order("created_at" as never, { ascending: true })
      .limit(batchSize);

    if (commandId) {
      query = query.eq("id" as never, commandId);
    } else {
      query = query
        .eq("status" as never, "pending")
        .or(`next_attempt_at.is.null,next_attempt_at.lte.${new Date().toISOString()}`);
    }

    const { data: commands, error: commandErr } = await query;
    if (commandErr) throw commandErr;

    const results: ProcessResult[] = [];

    for (const command of (commands ?? []) as unknown as ListingCommand[]) {
      const retryCount = (command.retry_count ?? 0) + 1;

      const { data: claimed, error: claimErr } = await admin
        .from("outbound_command")
        .update({
          status: "processing",
          retry_count: retryCount,
          last_error: null,
          updated_at: new Date().toISOString(),
        } as never)
        .eq("id" as never, command.id)
        .eq("status" as never, "pending")
        .select("id")
        .maybeSingle();

      if (claimErr) {
        results.push({
          command_id: command.id,
          target_system: command.target_system,
          command_type: command.command_type,
          status: "claim_error",
          error: claimErr.message,
        });
        continue;
      }

      if (!claimed) {
        results.push({
          command_id: command.id,
          target_system: command.target_system,
          command_type: command.command_type,
          status: "skipped",
          error: "Command was not claimable",
        });
        continue;
      }

      try {
        const responsePayload = await processCommand(admin, command);

        await admin
          .from("outbound_command")
          .update({
            status: "acknowledged",
            response_payload: responsePayload,
            last_error: null,
            next_attempt_at: null,
            sent_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          } as never)
          .eq("id" as never, command.id);

        await resolveListingCommandFailure(admin, command.id);

        results.push({
          command_id: command.id,
          target_system: command.target_system,
          command_type: command.command_type,
          status: "acknowledged",
          response: responsePayload,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown listing command processor error";
        const retryable = isRetryableError(message);
        const exhausted = !retryable || retryCount >= MAX_RETRY_COUNT;
        const nextAttempt = exhausted
          ? null
          : new Date(Date.now() + retryDelayMinutes(retryCount) * 60_000).toISOString();

        await admin
          .from("outbound_command")
          .update({
            status: exhausted ? "failed" : "pending",
            last_error: message.slice(0, 1000),
            next_attempt_at: nextAttempt,
            updated_at: new Date().toISOString(),
          } as never)
          .eq("id" as never, command.id);

        await recordListingCommandFailure(admin, command, message, retryCount, nextAttempt);

        results.push({
          command_id: command.id,
          target_system: command.target_system,
          command_type: command.command_type,
          status: exhausted ? "failed" : "retry_scheduled",
          error: message,
          next_attempt_at: nextAttempt,
        });
      }
    }

    return jsonResponse({
      success: true,
      processed: results.length,
      recovered_stale_commands: recoveredStaleCommands,
      results,
    });
  } catch (err) {
    return errorResponse(err);
  }
});
