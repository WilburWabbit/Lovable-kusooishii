import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const clientId = Deno.env.get("QBO_CLIENT_ID");
    const clientSecret = Deno.env.get("QBO_CLIENT_SECRET");

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
    const body = await req.json();
    const { action, code, redirect_uri, realm_id } = body;

    // All actions require admin auth
    if (!clientId || !clientSecret) {
      throw new Error("QBO_CLIENT_ID or QBO_CLIENT_SECRET not configured");
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

    // Status check (now behind auth)
    if (action === "status") {
      const realmId = Deno.env.get("QBO_REALM_ID");
      if (!realmId) {
        return new Response(JSON.stringify({ connected: false }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: conn } = await supabaseAdmin
        .from("qbo_connection")
        .select("realm_id, token_expires_at, updated_at")
        .eq("realm_id", realmId)
        .single();

      return new Response(
        JSON.stringify({
          connected: !!conn,
          realm_id: conn?.realm_id ?? null,
          token_expires_at: conn?.token_expires_at ?? null,
          last_updated: conn?.updated_at ?? null,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }


    if (action === "authorize_url") {
      const configuredRedirect = Deno.env.get("QBO_REDIRECT_URI");
      const actualRedirect = redirect_uri || configuredRedirect;
      if (!actualRedirect) {
        throw new Error("Missing redirect_uri in request and QBO_REDIRECT_URI env var not configured");
      }
      const state = crypto.randomUUID();
      const url = `https://appcenter.intuit.com/connect/oauth2?client_id=${clientId}&redirect_uri=${encodeURIComponent(actualRedirect)}&response_type=code&scope=com.intuit.quickbooks.accounting&state=${state}`;
      return new Response(JSON.stringify({ url }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "exchange") {
      if (!code || !redirect_uri || !realm_id) {
        throw new Error("Missing code, redirect_uri, or realm_id");
      }

      const tokenRes = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
          Accept: "application/json",
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri,
        }),
      });

      if (!tokenRes.ok) {
        const errBody = await tokenRes.text();
        throw new Error(`Token exchange failed [${tokenRes.status}]: ${errBody}`);
      }

      const tokens = await tokenRes.json();
      const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

      const { error: upsertErr } = await supabaseAdmin
        .from("qbo_connection")
        .upsert(
          {
            realm_id,
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            token_expires_at: expiresAt,
          },
          { onConflict: "realm_id" }
        );

      if (upsertErr) throw new Error(`DB upsert failed: ${upsertErr.message}`);

      return new Response(JSON.stringify({ success: true, realm_id }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "disconnect") {
      if (!realm_id) throw new Error("Missing realm_id");

      const { error: delErr } = await supabaseAdmin
        .from("qbo_connection")
        .delete()
        .eq("realm_id", realm_id);

      if (delErr) throw new Error(`Disconnect failed: ${delErr.message}`);

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "refresh") {
      if (!realm_id) throw new Error("Missing realm_id");

      const { data: conn, error: connErr } = await supabaseAdmin
        .from("qbo_connection")
        .select("*")
        .eq("realm_id", realm_id)
        .single();

      if (connErr || !conn) throw new Error("No QBO connection found");

      const tokenRes = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
          Accept: "application/json",
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: conn.refresh_token,
        }),
      });

      if (!tokenRes.ok) {
        const errBody = await tokenRes.text();
        throw new Error(`Token refresh failed [${tokenRes.status}]: ${errBody}`);
      }

      const tokens = await tokenRes.json();
      const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

      await supabaseAdmin
        .from("qbo_connection")
        .update({
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          token_expires_at: expiresAt,
        })
        .eq("realm_id", realm_id);

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (err) {
    console.error("qbo-auth error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
