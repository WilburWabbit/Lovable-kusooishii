import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const EBAY_AUTH_URL = "https://auth.ebay.com/oauth2/authorize";
const EBAY_TOKEN_URL = "https://api.ebay.com/identity/v1/oauth2/token";
const EBAY_SCOPES = [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.marketing.readonly",
  "https://api.ebay.com/oauth/api_scope/sell.marketing",
  "https://api.ebay.com/oauth/api_scope/sell.inventory.readonly",
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.account.readonly",
  "https://api.ebay.com/oauth/api_scope/sell.account",
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly",
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
  "https://api.ebay.com/oauth/api_scope/sell.analytics.readonly",
  "https://api.ebay.com/oauth/api_scope/sell.finances",
  "https://api.ebay.com/oauth/api_scope/sell.payment.dispute",
  "https://api.ebay.com/oauth/api_scope/commerce.identity.readonly",
  "https://api.ebay.com/oauth/api_scope/sell.reputation",
  "https://api.ebay.com/oauth/api_scope/sell.reputation.readonly",
  "https://api.ebay.com/oauth/api_scope/commerce.notification.subscription",
  "https://api.ebay.com/oauth/api_scope/commerce.notification.subscription.readonly",
  "https://api.ebay.com/oauth/api_scope/sell.stores",
  "https://api.ebay.com/oauth/api_scope/sell.stores.readonly",
  "https://api.ebay.com/oauth/scope/sell.edelivery",
  "https://api.ebay.com/oauth/api_scope/commerce.vero",
  "https://api.ebay.com/oauth/api_scope/sell.inventory.mapping",
  "https://api.ebay.com/oauth/api_scope/commerce.message",
  "https://api.ebay.com/oauth/api_scope/commerce.feedback",
  "https://api.ebay.com/oauth/api_scope/commerce.shipping",
].join(" ");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const clientId = Deno.env.get("EBAY_CLIENT_ID");
    const clientSecret = Deno.env.get("EBAY_CLIENT_SECRET");
    const ruName = Deno.env.get("EBAY_RUNAME");

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
    const body = await req.json();
    const { action } = body;

    // --- Status check (no auth required) ---
    if (action === "status") {
      const { data: conn } = await supabaseAdmin
        .from("ebay_connection")
        .select("id, token_expires_at, updated_at")
        .limit(1)
        .maybeSingle();

      return new Response(
        JSON.stringify({
          connected: !!conn,
          token_expires_at: conn?.token_expires_at ?? null,
          last_updated: conn?.updated_at ?? null,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // --- All other actions require admin auth ---
    if (!clientId || !clientSecret) {
      throw new Error("EBAY_CLIENT_ID or EBAY_CLIENT_SECRET not configured");
    }

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

    // --- Generate consent URL ---
    if (action === "authorize_url") {
      if (!ruName) throw new Error("EBAY_RUNAME not configured");

      const state = crypto.randomUUID();
      const authUrl = new URL(EBAY_AUTH_URL);
      authUrl.searchParams.set("client_id", clientId);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("redirect_uri", ruName);
      authUrl.searchParams.set("scope", EBAY_SCOPES);
      authUrl.searchParams.set("state", state);
      authUrl.searchParams.set("prompt", "login");

      return new Response(
        JSON.stringify({ url: authUrl.toString(), state }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // --- Exchange code for tokens ---
    if (action === "exchange") {
      const { code } = body;
      if (!code) throw new Error("Missing authorization code");
      if (!ruName) throw new Error("EBAY_RUNAME not configured");

      const basicAuth = btoa(`${clientId}:${clientSecret}`);
      const tokenRes = await fetch(EBAY_TOKEN_URL, {
        method: "POST",
        headers: {
          Authorization: `Basic ${basicAuth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: ruName,
        }),
      });

      const tokenData = await tokenRes.json();
      if (!tokenRes.ok) {
        console.error("eBay token exchange failed:", JSON.stringify(tokenData));
        throw new Error(`Token exchange failed [${tokenRes.status}]`);
      }

      const expiresAt = new Date(Date.now() + (tokenData.expires_in || 7200) * 1000).toISOString();

      // Delete any existing connections (singleton) then insert
      await supabaseAdmin.from("ebay_connection").delete().neq("id", "00000000-0000-0000-0000-000000000000");

      const { error: dbError } = await supabaseAdmin
        .from("ebay_connection")
        .insert({
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token,
          token_expires_at: expiresAt,
        });

      if (dbError) throw new Error(`DB insert failed: ${dbError.message}`);

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // --- Disconnect ---
    if (action === "disconnect") {
      await supabaseAdmin.from("ebay_connection").delete().neq("id", "00000000-0000-0000-0000-000000000000");

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // --- Refresh token ---
    if (action === "refresh") {
      const { data: conn, error: connErr } = await supabaseAdmin
        .from("ebay_connection")
        .select("*")
        .limit(1)
        .maybeSingle();

      if (connErr || !conn) throw new Error("No eBay connection found");

      const basicAuth = btoa(`${clientId}:${clientSecret}`);
      const tokenRes = await fetch(EBAY_TOKEN_URL, {
        method: "POST",
        headers: {
          Authorization: `Basic ${basicAuth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: conn.refresh_token,
          scope: EBAY_SCOPES,
        }),
      });

      if (!tokenRes.ok) {
        const errBody = await tokenRes.text();
        throw new Error(`Token refresh failed [${tokenRes.status}]: ${errBody}`);
      }

      const tokens = await tokenRes.json();
      const expiresAt = new Date(Date.now() + (tokens.expires_in || 7200) * 1000).toISOString();

      await supabaseAdmin
        .from("ebay_connection")
        .update({
          access_token: tokens.access_token,
          ...(tokens.refresh_token ? { refresh_token: tokens.refresh_token } : {}),
          token_expires_at: expiresAt,
        })
        .eq("id", conn.id);

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (err) {
    console.error("ebay-auth error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
