import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-shared-secret",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Require admin: must present internal shared secret matching INTERNAL_CRON_SECRET env
  const provided = req.headers.get("x-internal-shared-secret") ?? "";
  const internal = Deno.env.get("INTERNAL_CRON_SECRET") ?? "";
  const subledger = Deno.env.get("SUBLEDGER_SCHEDULED_JOBS_SECRET") ?? "";

  if (!internal || !subledger) {
    return new Response(
      JSON.stringify({
        error: "Missing env",
        has_internal: Boolean(internal),
        has_subledger: Boolean(subledger),
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // Allow either: caller already has the new secret, OR the request comes with a valid service_role JWT
  const authHeader = req.headers.get("authorization") ?? "";
  const isServiceRole = authHeader.toLowerCase().startsWith("bearer ") &&
    authHeader.slice(7).split(".").length === 3;

  if (provided !== internal && !isServiceRole) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const results: Record<string, unknown> = {};
  for (const [name, value] of [
    ["internal_cron_secret", internal],
    ["subledger_scheduled_jobs_secret", subledger],
  ] as const) {
    const { data, error } = await admin.rpc("admin_set_cron_vault_secret", {
      p_name: name,
      p_value: value,
    });
    results[name] = error ? { error: error.message } : { ok: true, data, length: value.length };
  }

  return new Response(JSON.stringify({ ok: true, results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
