// Redeployed: 2026-03-23
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMC_SCOPE = "https://www.googleapis.com/auth/content";
const GOOGLE_MERCHANT_ACCOUNTS_API_BASE = "https://merchantapi.googleapis.com/accounts/v1";

type GmcConnection = {
  id: string;
  merchant_id: string;
  data_source: string | null;
  access_token: string;
  refresh_token: string;
  token_expires_at: string;
  updated_at: string;
};

function jsonResponse(payload: Record<string, unknown>, status = 200) {
  return new Response(
    JSON.stringify(payload),
    { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
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

function getGoogleErrorReason(payload: Record<string, unknown>): string | null {
  const error = isRecord(payload.error) ? payload.error : null;
  const details = Array.isArray(error?.details) ? error.details : [];
  for (const detail of details) {
    if (!isRecord(detail)) continue;
    if (typeof detail.reason === "string") return detail.reason;
    const metadata = isRecord(detail.metadata) ? detail.metadata : null;
    if (typeof metadata?.REASON === "string") return metadata.REASON;
  }
  return null;
}

function getGoogleErrorMetadata(payload: Record<string, unknown>): Record<string, unknown> | null {
  const error = isRecord(payload.error) ? payload.error : null;
  const details = Array.isArray(error?.details) ? error.details : [];
  for (const detail of details) {
    if (!isRecord(detail)) continue;
    if (isRecord(detail.metadata)) return detail.metadata;
  }
  return null;
}

async function getGmcConnection(supabaseAdmin: SupabaseClient): Promise<GmcConnection> {
  const { data: conn, error } = await supabaseAdmin
    .from("google_merchant_connection")
    .select("*")
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`Failed to load Google Merchant connection: ${error.message}`);
  if (!conn) throw new Error("No Google Merchant connection found");

  return {
    id: String(conn.id),
    merchant_id: String(conn.merchant_id),
    data_source: conn.data_source ? String(conn.data_source) : null,
    access_token: String(conn.access_token ?? ""),
    refresh_token: String(conn.refresh_token ?? ""),
    token_expires_at: String(conn.token_expires_at),
    updated_at: String(conn.updated_at),
  };
}

async function refreshGmcToken(
  supabaseAdmin: SupabaseClient,
  conn: GmcConnection,
  clientId: string,
  clientSecret: string,
): Promise<string> {
  if (!conn.refresh_token) throw new Error("Google Merchant connection has no refresh token");

  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: conn.refresh_token,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  const tokens = await parseJsonResponse(tokenRes);
  if (!tokenRes.ok) {
    throw new Error(stringifyApiError(tokens, `Token refresh failed [${tokenRes.status}]`));
  }

  const accessToken = String(tokens.access_token ?? "");
  if (!accessToken) throw new Error("Token refresh returned no access token");

  const expiresAt = new Date(
    Date.now() + Number(tokens.expires_in ?? 3600) * 1000,
  ).toISOString();

  const { data: updated } = await supabaseAdmin
    .from("google_merchant_connection")
    .update({
      access_token: accessToken,
      refresh_token: typeof tokens.refresh_token === "string" ? tokens.refresh_token : conn.refresh_token,
      token_expires_at: expiresAt,
    })
    .eq("id", conn.id)
    .eq("updated_at", conn.updated_at)
    .select("id");

  if (!updated?.length) {
    throw new Error("Token refresh conflict — another refresh may have occurred simultaneously");
  }

  return accessToken;
}

async function ensureGmcAccessToken(
  supabaseAdmin: SupabaseClient,
  conn: GmcConnection,
  clientId: string,
  clientSecret: string,
): Promise<string> {
  if (conn.access_token && new Date(conn.token_expires_at) > new Date(Date.now() + 60_000)) {
    return conn.access_token;
  }
  return refreshGmcToken(supabaseAdmin, conn, clientId, clientSecret);
}

function developerRegistrationName(merchantId: string): string {
  return `accounts/${merchantId}/developerRegistration`;
}

async function fetchDeveloperRegistration(accessToken: string, merchantId: string) {
  const name = developerRegistrationName(merchantId);
  const res = await fetch(`${GOOGLE_MERCHANT_ACCOUNTS_API_BASE}/${name}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const payload = await parseJsonResponse(res);

  if (res.ok) {
    return {
      registered: true,
      needs_registration: false,
      merchant_id: merchantId,
      registration: payload,
      gcp_ids: Array.isArray(payload.gcpIds) ? payload.gcpIds.map(String) : [],
      error: null,
      error_metadata: null,
    };
  }

  const reason = getGoogleErrorReason(payload);
  if (res.status === 404 || reason === "GCP_NOT_REGISTERED") {
    return {
      registered: false,
      needs_registration: true,
      merchant_id: merchantId,
      registration: null,
      gcp_ids: [],
      error: stringifyApiError(payload, `Developer registration not found [${res.status}]`),
      error_metadata: getGoogleErrorMetadata(payload),
    };
  }

  throw new Error(stringifyApiError(payload, `Developer registration status failed [${res.status}]`));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const clientId = Deno.env.get("GMC_CLIENT_ID");
    const clientSecret = Deno.env.get("GMC_CLIENT_SECRET");
    const redirectUri = Deno.env.get("GMC_REDIRECT_URI");

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
    const body = await req.json();
    const { action } = body;

    if (!clientId || !clientSecret) {
      throw new Error("GMC_CLIENT_ID or GMC_CLIENT_SECRET not configured");
    }

    // --- All actions require admin auth ---
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) throw new Error("Unauthorized");

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !user) throw new Error("Unauthorized");

    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id);
    const isAdmin = (roles ?? []).some((r: { role: string }) => r.role === "admin");
    if (!isAdmin) throw new Error("Forbidden: admin only");

    // --- Status check ---
    if (action === "status") {
      const { data: conn } = await supabaseAdmin
        .from("google_merchant_connection")
        .select("id, merchant_id, data_source, access_token, refresh_token, token_expires_at, updated_at")
        .limit(1)
        .maybeSingle();

      const now = new Date().toISOString();
      const hasTokens = Boolean(conn?.access_token && conn?.refresh_token);
      return jsonResponse({
        configured: !!conn,
        connected: hasTokens,
        expired: hasTokens ? conn.token_expires_at < now : null,
        merchant_id: conn?.merchant_id ?? null,
        data_source: conn?.data_source ?? null,
        token_expires_at: conn?.token_expires_at ?? null,
        last_updated: conn?.updated_at ?? null,
      });
    }


    // --- Save merchant config (without touching tokens) ---
    if (action === "set_config") {
      const { merchant_id, data_source } = body;
      if (!merchant_id) throw new Error("Missing merchant_id");

      const { data: existing } = await supabaseAdmin
        .from("google_merchant_connection")
        .select("id")
        .limit(1)
        .maybeSingle();

      if (!existing?.id) {
        const { error: insertError } = await supabaseAdmin
          .from("google_merchant_connection")
          .insert({
            merchant_id,
            data_source: data_source ?? null,
            access_token: "",
            refresh_token: "",
            token_expires_at: new Date(0).toISOString(),
          });
        if (insertError) throw new Error(`Failed to save config: ${insertError.message}`);

        return jsonResponse({ success: true });
      }

      const { error } = await supabaseAdmin
        .from("google_merchant_connection")
        .update({ merchant_id, data_source: data_source ?? null })
        .eq("id", existing.id);
      if (error) throw new Error(`Failed to update config: ${error.message}`);

      return jsonResponse({ success: true });
    }
    // --- Generate consent URL ---
    if (action === "authorize_url") {
      if (!redirectUri) throw new Error("GMC_REDIRECT_URI not configured");

      const state = crypto.randomUUID();
      const authUrl = new URL(GOOGLE_AUTH_URL);
      authUrl.searchParams.set("client_id", clientId);
      authUrl.searchParams.set("redirect_uri", redirectUri);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("scope", GMC_SCOPE);
      authUrl.searchParams.set("access_type", "offline");
      authUrl.searchParams.set("prompt", "consent");
      authUrl.searchParams.set("state", state);

      return jsonResponse({ url: authUrl.toString(), state });
    }

    // --- Exchange code for tokens ---
    if (action === "exchange") {
      const { code, merchant_id } = body;
      if (!code) throw new Error("Missing authorization code");
      if (!merchant_id) throw new Error("Missing merchant_id");
      if (!redirectUri) throw new Error("GMC_REDIRECT_URI not configured");

      const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
          client_id: clientId,
          client_secret: clientSecret,
        }),
      });

      const tokenData = await tokenRes.json();
      if (!tokenRes.ok) {
        console.error("Google token exchange failed:", JSON.stringify(tokenData));
        throw new Error(`Token exchange failed [${tokenRes.status}]`);
      }
      if (!tokenData.access_token) {
        throw new Error("Google token response missing access_token");
      }

      const expiresAt = new Date(
        Date.now() + (tokenData.expires_in ?? 3600) * 1000,
      ).toISOString();

      // Delete existing connections (singleton) then insert
      await supabaseAdmin
        .from("google_merchant_connection")
        .delete()
        .gte("id", "00000000-0000-0000-0000-000000000000");

      const { error: dbError } = await supabaseAdmin
        .from("google_merchant_connection")
        .insert({
          merchant_id,
          data_source: body.data_source ?? null,
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token ?? "",
          token_expires_at: expiresAt,
        });

      if (dbError) throw new Error(`DB insert failed: ${dbError.message}`);

      return jsonResponse({ success: true });
    }

    // --- Developer registration status ---
    if (action === "developer_registration_status") {
      const conn = await getGmcConnection(supabaseAdmin);
      const accessToken = await ensureGmcAccessToken(supabaseAdmin, conn, clientId, clientSecret);
      const registration = await fetchDeveloperRegistration(accessToken, conn.merchant_id);

      return jsonResponse({
        success: true,
        checked_at: new Date().toISOString(),
        ...registration,
      });
    }

    // --- Register the current GCP project as a Merchant API developer project ---
    if (action === "register_developer") {
      const developerEmail = String(body.developer_email ?? "").trim();
      if (!developerEmail) throw new Error("Developer email is required");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(developerEmail)) {
        throw new Error("Developer email must be a valid email address");
      }

      const conn = await getGmcConnection(supabaseAdmin);
      const accessToken = await ensureGmcAccessToken(supabaseAdmin, conn, clientId, clientSecret);
      const name = developerRegistrationName(conn.merchant_id);
      const registerRes = await fetch(`${GOOGLE_MERCHANT_ACCOUNTS_API_BASE}/${name}:registerGcp`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ developerEmail }),
      });

      const payload = await parseJsonResponse(registerRes);
      if (!registerRes.ok) {
        throw new Error(stringifyApiError(payload, `Developer registration failed [${registerRes.status}]`));
      }

      return jsonResponse({
        success: true,
        registered: true,
        needs_registration: false,
        merchant_id: conn.merchant_id,
        developer_email: developerEmail,
        registration: payload,
        gcp_ids: Array.isArray(payload.gcpIds) ? payload.gcpIds.map(String) : [],
        checked_at: new Date().toISOString(),
      });
    }

    // --- Disconnect ---
    if (action === "disconnect") {
      await supabaseAdmin
        .from("google_merchant_connection")
        .delete()
        .gte("id", "00000000-0000-0000-0000-000000000000");

      return jsonResponse({ success: true });
    }

    // --- Refresh token ---
    if (action === "refresh") {
      const conn = await getGmcConnection(supabaseAdmin);
      await refreshGmcToken(supabaseAdmin, conn, clientId, clientSecret);
      return jsonResponse({ success: true });
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (err) {
    console.error("gmc-auth error:", err);
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : "Unknown error",
      }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
