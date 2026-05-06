import { type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";
import { authenticateRequest } from "./qbo-helpers.ts";

export const META_GRAPH_VERSION = Deno.env.get("META_GRAPH_VERSION") || "v25.0";
export const META_GRAPH_BASE = `https://graph.facebook.com/${META_GRAPH_VERSION}`;

export const META_SCOPES = [
  "business_management",
  "catalog_management",
  "ads_management",
  "ads_read",
  "pages_show_list",
  "pages_read_engagement",
  "instagram_basic",
].join(",");

export type MetaAssetType = "business" | "page" | "instagram_account" | "ad_account" | "product_catalog";

export type MetaConnection = {
  id: string;
  access_token: string;
  token_expires_at: string | null;
  selected_business_id: string | null;
  selected_catalog_id: string | null;
  selected_page_id: string | null;
  selected_instagram_account_id: string | null;
  selected_ad_account_id: string | null;
  scopes: string[];
  updated_at: string;
};

export type MetaAsset = {
  asset_type: MetaAssetType;
  external_id: string;
  business_id?: string | null;
  name?: string | null;
  username?: string | null;
  access_token?: string | null;
  raw_data?: Record<string, unknown>;
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

export function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers":
        "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
      "Content-Type": "application/json",
    },
  });
}

export async function parseJsonResponse(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { raw_response: text };
  }
}

export function stringifyMetaError(payload: Record<string, unknown>, fallback: string): string {
  if (typeof payload.error === "string" && payload.error.trim()) return payload.error;
  if (typeof payload.message === "string" && payload.message.trim()) return payload.message;

  const error = isRecord(payload.error) ? payload.error : null;
  if (!error) return fallback;

  const parts = [
    typeof error.message === "string" && error.message.trim() ? error.message : null,
    error.type ? `type=${String(error.type)}` : null,
    error.code ? `code=${String(error.code)}` : null,
    error.error_subcode ? `subcode=${String(error.error_subcode)}` : null,
    error.fbtrace_id ? `fbtrace=${String(error.fbtrace_id)}` : null,
  ].filter((part): part is string => Boolean(part));

  return parts.length > 0 ? parts.join(" ") : fallback;
}

export async function requireAdmin(req: Request, admin: SupabaseClient): Promise<{ userId: string; email?: string }> {
  const user = await authenticateRequest(req, admin);
  if (user.userId === "service-role") return user;

  const { data, error } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", user.userId);
  if (error) throw new Error(`Failed to verify admin role: ${error.message}`);

  const isAdmin = (data ?? []).some((row: { role: string }) => row.role === "admin");
  if (!isAdmin) throw new Error("Forbidden: admin only");
  return user;
}

export async function metaGet<T extends Record<string, unknown>>(
  path: string,
  accessToken: string,
  params: Record<string, string | number | boolean | null | undefined> = {},
): Promise<T> {
  const url = new URL(`${META_GRAPH_BASE}/${path.replace(/^\//, "")}`);
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== "") url.searchParams.set(key, String(value));
  }

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(stringifyMetaError(payload, `Meta Graph API request failed [${response.status}]`));
  }
  return payload as T;
}

export async function metaPostForm<T extends Record<string, unknown>>(
  path: string,
  accessToken: string,
  body: Record<string, string>,
): Promise<T> {
  const response = await fetch(`${META_GRAPH_BASE}/${path.replace(/^\//, "")}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body),
  });
  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(stringifyMetaError(payload, `Meta Graph API request failed [${response.status}]`));
  }
  return payload as T;
}

export async function paginateMetaEdge<T extends Record<string, unknown>>(
  path: string,
  accessToken: string,
  params: Record<string, string | number | boolean | null | undefined> = {},
  maxPages = 5,
): Promise<T[]> {
  const first = new URL(`${META_GRAPH_BASE}/${path.replace(/^\//, "")}`);
  for (const [key, value] of Object.entries({ limit: 100, ...params })) {
    if (value != null && value !== "") first.searchParams.set(key, String(value));
  }

  const rows: T[] = [];
  let nextUrl: string | null = first.toString();
  let page = 0;

  while (nextUrl && page < maxPages) {
    const response = await fetch(nextUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const payload = await parseJsonResponse(response);
    if (!response.ok) {
      throw new Error(stringifyMetaError(payload, `Meta Graph API pagination failed [${response.status}]`));
    }

    const data = Array.isArray(payload.data) ? payload.data : [];
    rows.push(...data.filter(isRecord) as T[]);
    const paging = isRecord(payload.paging) ? payload.paging : null;
    nextUrl = typeof paging?.next === "string" ? paging.next : null;
    page++;
  }

  return rows;
}

function firstString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function toAsset(type: MetaAssetType, raw: Record<string, unknown>, extra: Partial<MetaAsset> = {}): MetaAsset | null {
  const externalId = firstString(raw.id);
  if (!externalId) return null;
  return {
    asset_type: type,
    external_id: externalId,
    business_id: extra.business_id ?? null,
    name: extra.name ?? firstString(raw.name),
    username: extra.username ?? firstString(raw.username),
    access_token: extra.access_token ?? firstString(raw.access_token),
    raw_data: raw,
  };
}

async function fetchCatalogsForBusiness(accessToken: string, businessId: string): Promise<MetaAsset[]> {
  const fields = "id,name,vertical,product_count,business{id,name}";
  const edges = ["owned_product_catalogs", "client_product_catalogs"];
  const assets: MetaAsset[] = [];

  for (const edge of edges) {
    try {
      const catalogs = await paginateMetaEdge<Record<string, unknown>>(`${businessId}/${edge}`, accessToken, { fields }, 3);
      for (const catalog of catalogs) {
        const asset = toAsset("product_catalog", catalog, { business_id: businessId });
        if (asset) assets.push(asset);
      }
    } catch (err) {
      console.warn(`Meta catalog edge ${edge} failed for business ${businessId}`, err);
    }
  }

  return assets;
}

export async function discoverMetaAssets(accessToken: string): Promise<MetaAsset[]> {
  const assetsByKey = new Map<string, MetaAsset>();
  const put = (asset: MetaAsset | null) => {
    if (!asset) return;
    assetsByKey.set(`${asset.asset_type}:${asset.external_id}`, asset);
  };

  const businesses = await paginateMetaEdge<Record<string, unknown>>("me/businesses", accessToken, {
    fields: "id,name,verification_status",
  }, 3);

  for (const business of businesses) {
    const businessId = firstString(business.id);
    put(toAsset("business", business));
    if (!businessId) continue;

    const catalogs = await fetchCatalogsForBusiness(accessToken, businessId);
    for (const catalog of catalogs) put(catalog);
  }

  const pages = await paginateMetaEdge<Record<string, unknown>>("me/accounts", accessToken, {
    fields: "id,name,category,access_token,tasks,perms,instagram_business_account{id,username,name,profile_picture_url}",
  }, 3);

  for (const page of pages) {
    const pageAsset = toAsset("page", page);
    put(pageAsset);

    const igAccount = isRecord(page.instagram_business_account) ? page.instagram_business_account : null;
    const igAsset = igAccount
      ? toAsset("instagram_account", igAccount, {
          business_id: pageAsset?.business_id ?? null,
          name: firstString(igAccount.name) ?? firstString(igAccount.username),
          username: firstString(igAccount.username),
        })
      : null;
    put(igAsset);
  }

  const adAccounts = await paginateMetaEdge<Record<string, unknown>>("me/adaccounts", accessToken, {
    fields: "id,account_id,name,account_status,currency,timezone_name,business{id,name}",
  }, 3);

  for (const adAccount of adAccounts) {
    const business = isRecord(adAccount.business) ? adAccount.business : null;
    put(toAsset("ad_account", adAccount, { business_id: firstString(business?.id) }));
  }

  return [...assetsByKey.values()];
}

export async function replaceMetaAssets(admin: SupabaseClient, assets: MetaAsset[]) {
  const now = new Date().toISOString();
  await admin
    .from("meta_business_asset")
    .delete()
    .gte("id", "00000000-0000-0000-0000-000000000000");

  if (assets.length === 0) return;

  const { error } = await admin.from("meta_business_asset").upsert(
    assets.map((asset) => ({
      asset_type: asset.asset_type,
      external_id: asset.external_id,
      business_id: asset.business_id ?? null,
      name: asset.name ?? null,
      username: asset.username ?? null,
      access_token: asset.access_token ?? null,
      raw_data: asset.raw_data ?? {},
      last_synced_at: now,
      updated_at: now,
    })),
    { onConflict: "asset_type,external_id" },
  );
  if (error) throw new Error(`Failed to store Meta assets: ${error.message}`);
}

export async function getMetaConnection(admin: SupabaseClient): Promise<MetaConnection> {
  const { data, error } = await admin
    .from("meta_connection")
    .select("id, access_token, token_expires_at, selected_business_id, selected_catalog_id, selected_page_id, selected_instagram_account_id, selected_ad_account_id, scopes, updated_at")
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`Failed to load Meta connection: ${error.message}`);
  if (!data) throw new Error("No Meta connection found");

  return {
    id: String(data.id),
    access_token: String(data.access_token ?? ""),
    token_expires_at: data.token_expires_at ? String(data.token_expires_at) : null,
    selected_business_id: data.selected_business_id ? String(data.selected_business_id) : null,
    selected_catalog_id: data.selected_catalog_id ? String(data.selected_catalog_id) : null,
    selected_page_id: data.selected_page_id ? String(data.selected_page_id) : null,
    selected_instagram_account_id: data.selected_instagram_account_id ? String(data.selected_instagram_account_id) : null,
    selected_ad_account_id: data.selected_ad_account_id ? String(data.selected_ad_account_id) : null,
    scopes: Array.isArray(data.scopes) ? data.scopes.map(String) : [],
    updated_at: String(data.updated_at),
  };
}
