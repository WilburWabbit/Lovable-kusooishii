import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { verifyServiceRoleJWT } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-internal-shared-secret",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const internal = Deno.env.get("INTERNAL_CRON_SECRET") ?? "";
  const subledger =
    Deno.env.get("SUBLEDGER_SCHEDULED_JOBS_SECRET") || internal;

  if (!supabaseUrl || !serviceRoleKey || !internal || !subledger) {
    return new Response(
      JSON.stringify({
        error: "Missing env",
        has_supabase_url: Boolean(supabaseUrl),
        has_service_role_key: Boolean(serviceRoleKey),
        has_internal: Boolean(internal),
        has_subledger: Boolean(subledger),
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // Authn: either internal shared secret header, OR a valid service-role JWT.
  const provided = req.headers.get("x-internal-shared-secret") ?? "";
  const authHeader = req.headers.get("authorization") ?? "";
  const bearer = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : "";
  const isServiceRole = bearer ? verifyServiceRoleJWT(bearer, supabaseUrl) : false;

  if (provided !== internal && !isServiceRole) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);

  const results: Record<string, unknown> = {};
  for (
    const [name, value] of [
      ["internal_cron_secret", internal],
      ["subledger_scheduled_jobs_secret", subledger],
      ["service_role_key", serviceRoleKey],
    ] as const
  ) {
    const { data, error } = await admin.rpc("admin_set_cron_vault_secret", {
      p_name: name,
      p_value: value,
    });
    results[name] = error
      ? { error: error.message }
      : { ok: true, data, length: value.length };
  }

  return new Response(JSON.stringify({ ok: true, results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
