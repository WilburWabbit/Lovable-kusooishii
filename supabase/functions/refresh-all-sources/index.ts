// Fan-out helper: refresh all non-value spec sources for one or many MPNs.
// Calls bricklink-sync, brickowl-sync, brickset-sync in parallel. Does NOT
// touch BrickEconomy value/pricing data — the existing brickeconomy-sync
// remains the only path for that, and is invoked only for spec snapshots.
import { createClient } from "npm:@supabase/supabase-js@2.47.10";
import { corsHeaders, requireStaff, jsonResponse } from "../_shared/multi-source-sync.ts";

const SOURCES = ["bricklink", "brickowl", "brickset"] as const;
type Source = typeof SOURCES[number];

async function callSync(source: Source, mpns: string[], authHeader: string) {
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/${source}-sync`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader,
    },
    body: JSON.stringify({ mpns }),
  });
  const body = await res.json().catch(() => ({}));
  return { source, ok: res.ok, status: res.status, body };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const authHeader = req.headers.get("Authorization");
    const auth = await requireStaff(admin, authHeader);
    if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status);

    const body = await req.json().catch(() => ({}));
    const mpns: string[] = body.mpn ? [String(body.mpn)] : Array.isArray(body.mpns) ? body.mpns.map(String) : [];
    if (mpns.length === 0) return jsonResponse({ error: "mpn or mpns required" }, 400);

    const results = await Promise.all(SOURCES.map((s) => callSync(s, mpns, authHeader!)));

    return jsonResponse({
      requested: mpns.length,
      sources: results.reduce((acc, r) => {
        acc[r.source] = { ok: r.ok, status: r.status, ...r.body };
        return acc;
      }, {} as Record<string, unknown>),
    });
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});
