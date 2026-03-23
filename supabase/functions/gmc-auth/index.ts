// Redeployed: 2026-03-23
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMC_SCOPE = "https://www.googleapis.com/auth/content";

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
        .select("id, merchant_id, token_expires_at, updated_at")
        .limit(1)
        .maybeSingle();

      const now = new Date().toISOString();
      return new Response(
        JSON.stringify({
          connected: !!conn,
          expired: conn ? conn.token_expires_at < now : null,
          merchant_id: conn?.merchant_id ?? null,
          token_expires_at: conn?.token_expires_at ?? null,
          last_updated: conn?.updated_at ?? null,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
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

      return new Response(
        JSON.stringify({ url: authUrl.toString(), state }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
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
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token ?? "",
          token_expires_at: expiresAt,
        });

      if (dbError) throw new Error(`DB insert failed: ${dbError.message}`);

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // --- Disconnect ---
    if (action === "disconnect") {
      await supabaseAdmin
        .from("google_merchant_connection")
        .delete()
        .gte("id", "00000000-0000-0000-0000-000000000000");

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // --- Refresh token ---
    if (action === "refresh") {
      const { data: conn, error: connErr } = await supabaseAdmin
        .from("google_merchant_connection")
        .select("*")
        .limit(1)
        .maybeSingle();

      if (connErr || !conn) throw new Error("No Google Merchant connection found");

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

      if (!tokenRes.ok) {
        const errBody = await tokenRes.text();
        throw new Error(`Token refresh failed [${tokenRes.status}]: ${errBody}`);
      }

      const tokens = await tokenRes.json();
      const expiresAt = new Date(
        Date.now() + (tokens.expires_in ?? 3600) * 1000,
      ).toISOString();

      const { data: updated } = await supabaseAdmin
        .from("google_merchant_connection")
        .update({
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token || conn.refresh_token,
          token_expires_at: expiresAt,
        })
        .eq("id", conn.id)
        .eq("updated_at", conn.updated_at)
        .select("id");

      if (!updated?.length) {
        throw new Error(
          "Token refresh conflict — another refresh may have occurred simultaneously",
        );
      }

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
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
