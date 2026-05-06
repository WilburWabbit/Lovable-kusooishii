import { createAdminClient, corsHeaders, errorResponse } from "../_shared/qbo-helpers.ts";
import {
  discoverMetaAssets,
  getMetaConnection,
  jsonResponse,
  META_GRAPH_BASE,
  META_GRAPH_VERSION,
  META_SCOPES,
  metaGet,
  parseJsonResponse,
  replaceMetaAssets,
  requireAdmin,
  stringifyMetaError,
} from "../_shared/meta-client.ts";

type MetaTokenResponse = {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  error?: unknown;
};

type DefaultsInput = {
  business_id?: unknown;
  catalog_id?: unknown;
  page_id?: unknown;
  instagram_account_id?: unknown;
  ad_account_id?: unknown;
};

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} not configured`);
  return value;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getRedirectUri(): string {
  return requiredEnv("META_REDIRECT_URI");
}

function normalizeScopes(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === "string") return value.split(/[,\s]+/).map((item) => item.trim()).filter(Boolean);
  return [];
}

async function exchangeCodeForShortToken(code: string): Promise<MetaTokenResponse> {
  const url = new URL(`${META_GRAPH_BASE}/oauth/access_token`);
  url.searchParams.set("client_id", requiredEnv("META_APP_ID"));
  url.searchParams.set("client_secret", requiredEnv("META_APP_SECRET"));
  url.searchParams.set("redirect_uri", getRedirectUri());
  url.searchParams.set("code", code);

  const response = await fetch(url);
  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(stringifyMetaError(payload, `Meta token exchange failed [${response.status}]`));
  }
  return payload as MetaTokenResponse;
}

async function exchangeForLongLivedToken(shortToken: string): Promise<MetaTokenResponse> {
  const url = new URL(`${META_GRAPH_BASE}/oauth/access_token`);
  url.searchParams.set("grant_type", "fb_exchange_token");
  url.searchParams.set("client_id", requiredEnv("META_APP_ID"));
  url.searchParams.set("client_secret", requiredEnv("META_APP_SECRET"));
  url.searchParams.set("fb_exchange_token", shortToken);

  const response = await fetch(url);
  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(stringifyMetaError(payload, `Meta long-lived token exchange failed [${response.status}]`));
  }
  return payload as MetaTokenResponse;
}

function expiresAt(tokens: MetaTokenResponse): string | null {
  const seconds = Number(tokens.expires_in ?? 0);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(Date.now() + seconds * 1000).toISOString();
}

async function refreshAssets(admin: ReturnType<typeof createAdminClient>, accessToken: string) {
  const assets = await discoverMetaAssets(accessToken);
  await replaceMetaAssets(admin, assets);

  const businesses = assets.filter((asset) => asset.asset_type === "business");
  const catalogs = assets.filter((asset) => asset.asset_type === "product_catalog");
  const pages = assets.filter((asset) => asset.asset_type === "page");
  const instagramAccounts = assets.filter((asset) => asset.asset_type === "instagram_account");
  const adAccounts = assets.filter((asset) => asset.asset_type === "ad_account");

  return {
    assets,
    defaults: {
      selected_business_id: businesses[0]?.external_id ?? null,
      selected_catalog_id: catalogs[0]?.external_id ?? null,
      selected_page_id: pages[0]?.external_id ?? null,
      selected_instagram_account_id: instagramAccounts[0]?.external_id ?? null,
      selected_ad_account_id: adAccounts[0]?.external_id ?? null,
    },
    counts: {
      businesses: businesses.length,
      catalogs: catalogs.length,
      pages: pages.length,
      instagram_accounts: instagramAccounts.length,
      ad_accounts: adAccounts.length,
    },
  };
}

async function status(admin: ReturnType<typeof createAdminClient>) {
  const [{ data: connection }, { data: assets }] = await Promise.all([
    admin
      .from("meta_connection")
      .select("id, meta_user_id, meta_user_name, token_expires_at, scopes, selected_business_id, selected_catalog_id, selected_page_id, selected_instagram_account_id, selected_ad_account_id, connected_at, updated_at")
      .limit(1)
      .maybeSingle(),
    admin
      .from("meta_business_asset")
      .select("asset_type, external_id, business_id, name, username, last_synced_at")
      .order("asset_type")
      .order("name"),
  ]);

  const byType = (assets ?? []).reduce<Record<string, unknown[]>>((acc, asset) => {
    const type = String((asset as Record<string, unknown>).asset_type);
    acc[type] = acc[type] ?? [];
    acc[type].push(asset);
    return acc;
  }, {});

  const now = new Date();
  const tokenExpiresAt = asString(connection?.token_expires_at);

  return {
    connected: Boolean(connection),
    graph_version: META_GRAPH_VERSION,
    meta_user_id: connection?.meta_user_id ?? null,
    meta_user_name: connection?.meta_user_name ?? null,
    token_expires_at: tokenExpiresAt,
    expired: tokenExpiresAt ? new Date(tokenExpiresAt) <= now : null,
    scopes: normalizeScopes(connection?.scopes),
    selected_business_id: connection?.selected_business_id ?? null,
    selected_catalog_id: connection?.selected_catalog_id ?? null,
    selected_page_id: connection?.selected_page_id ?? null,
    selected_instagram_account_id: connection?.selected_instagram_account_id ?? null,
    selected_ad_account_id: connection?.selected_ad_account_id ?? null,
    connected_at: connection?.connected_at ?? null,
    last_updated: connection?.updated_at ?? null,
    assets: {
      businesses: byType.business ?? [],
      catalogs: byType.product_catalog ?? [],
      pages: byType.page ?? [],
      instagram_accounts: byType.instagram_account ?? [],
      ad_accounts: byType.ad_account ?? [],
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const admin = createAdminClient();
    await requireAdmin(req, admin);

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = asString(body.action) ?? "status";

    if (action === "status") {
      return jsonResponse(await status(admin));
    }

    if (action === "authorize_url") {
      const state = crypto.randomUUID();
      const url = new URL(`https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth`);
      url.searchParams.set("client_id", requiredEnv("META_APP_ID"));
      url.searchParams.set("redirect_uri", getRedirectUri());
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", META_SCOPES);
      url.searchParams.set("state", state);
      url.searchParams.set("auth_type", "rerequest");
      return jsonResponse({ url: url.toString(), state, scopes: META_SCOPES.split(",") });
    }

    if (action === "exchange") {
      const code = asString(body.code);
      if (!code) throw new Error("Missing authorization code");

      const shortToken = await exchangeCodeForShortToken(code);
      if (!shortToken.access_token) throw new Error("Meta token exchange returned no access token");
      const longToken = await exchangeForLongLivedToken(shortToken.access_token);
      const accessToken = longToken.access_token ?? shortToken.access_token;
      const profile = await metaGet<Record<string, unknown>>("me", accessToken, { fields: "id,name,email" });
      const permissions = await metaGet<Record<string, unknown>>("me/permissions", accessToken);
      const scopes = Array.isArray(permissions.data)
        ? permissions.data
            .filter((item): item is Record<string, unknown> => item != null && typeof item === "object" && !Array.isArray(item))
            .filter((item) => item.status === "granted")
            .map((item) => String(item.permission))
        : META_SCOPES.split(",");
      const assetResult = await refreshAssets(admin, accessToken);
      const now = new Date().toISOString();

      await admin
        .from("meta_connection")
        .delete()
        .gte("id", "00000000-0000-0000-0000-000000000000");

      const { error } = await admin.from("meta_connection").insert({
        meta_user_id: asString(profile.id),
        meta_user_name: asString(profile.name),
        access_token: accessToken,
        token_expires_at: expiresAt(longToken) ?? expiresAt(shortToken),
        scopes,
        raw_data: { profile, permissions },
        connected_at: now,
        updated_at: now,
        ...assetResult.defaults,
      });
      if (error) throw new Error(`Failed to store Meta connection: ${error.message}`);

      return jsonResponse({ success: true, ...assetResult.counts });
    }

    if (action === "refresh_assets") {
      const connection = await getMetaConnection(admin);
      const assetResult = await refreshAssets(admin, connection.access_token);
      const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (!connection.selected_business_id && assetResult.defaults.selected_business_id) {
        update.selected_business_id = assetResult.defaults.selected_business_id;
      }
      if (!connection.selected_catalog_id && assetResult.defaults.selected_catalog_id) {
        update.selected_catalog_id = assetResult.defaults.selected_catalog_id;
      }
      if (!connection.selected_page_id && assetResult.defaults.selected_page_id) {
        update.selected_page_id = assetResult.defaults.selected_page_id;
      }
      if (!connection.selected_instagram_account_id && assetResult.defaults.selected_instagram_account_id) {
        update.selected_instagram_account_id = assetResult.defaults.selected_instagram_account_id;
      }
      if (!connection.selected_ad_account_id && assetResult.defaults.selected_ad_account_id) {
        update.selected_ad_account_id = assetResult.defaults.selected_ad_account_id;
      }
      await admin.from("meta_connection").update(update).eq("id", connection.id);
      return jsonResponse({ success: true, ...assetResult.counts });
    }

    if (action === "set_defaults") {
      const input = body as DefaultsInput;
      const connection = await getMetaConnection(admin);
      const { error } = await admin.from("meta_connection").update({
        selected_business_id: asString(input.business_id),
        selected_catalog_id: asString(input.catalog_id),
        selected_page_id: asString(input.page_id),
        selected_instagram_account_id: asString(input.instagram_account_id),
        selected_ad_account_id: asString(input.ad_account_id),
        updated_at: new Date().toISOString(),
      }).eq("id", connection.id);
      if (error) throw new Error(`Failed to save Meta defaults: ${error.message}`);
      return jsonResponse({ success: true });
    }

    if (action === "disconnect") {
      await admin.from("meta_business_asset").delete().gte("id", "00000000-0000-0000-0000-000000000000");
      await admin.from("meta_connection").delete().gte("id", "00000000-0000-0000-0000-000000000000");
      return jsonResponse({ success: true });
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (err) {
    console.error("meta-auth error:", err);
    return errorResponse(err);
  }
});
