// BrickLink spec-only sync. Writes to bricklink_catalog_item +
// product_attribute.source_values_jsonb. Never writes price/value data.
import { createClient } from "npm:@supabase/supabase-js@2.47.10";
import {
  corsHeaders, requireStaff, jsonResponse, landRaw, commitLanding,
  upsertSpec, snapshotProductAttributes, fetchWithTimeout, stripValueFields,
  type SpecCatalogRow,
} from "../_shared/multi-source-sync.ts";

const BL_BASE = "https://api.bricklink.com/api/store/v1";

interface BLItem {
  no?: string; name?: string; category_name?: string;
  year_released?: number; weight?: string | number;
  dim_x?: string | number; dim_y?: string | number; dim_z?: string | number;
  image_url?: string;
}

function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "string" ? parseFloat(v) : (v as number);
  return Number.isFinite(n) ? n : null;
}

async function fetchItem(mpn: string, _creds: { ck: string; cs: string; tk: string; ts: string }): Promise<BLItem | null> {
  // BrickLink uses OAuth1; for the initial implementation we surface a clear
  // error if creds are missing — staff can wire OAuth1 signing later.
  // Treat the network call as best-effort: a 4xx returns null (no data).
  const url = `${BL_BASE}/items/SET/${encodeURIComponent(mpn)}`;
  const res = await fetchWithTimeout(url, { headers: { Accept: "application/json" } });
  if (!res.ok) return null;
  const body = await res.json();
  return (body?.data ?? null) as BLItem | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const auth = await requireStaff(admin, req.headers.get("Authorization"));
    if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status);

    const ck = Deno.env.get("BRICKLINK_CONSUMER_KEY") ?? "";
    const cs = Deno.env.get("BRICKLINK_CONSUMER_SECRET") ?? "";
    const tk = Deno.env.get("BRICKLINK_TOKEN_VALUE") ?? "";
    const ts = Deno.env.get("BRICKLINK_TOKEN_SECRET") ?? "";
    const credsConfigured = ck && cs && tk && ts;

    const body = await req.json().catch(() => ({}));
    const mpns: string[] = body.mpn ? [String(body.mpn)] : Array.isArray(body.mpns) ? body.mpns.map(String) : [];
    if (mpns.length === 0) return jsonResponse({ error: "mpn or mpns required" }, 400);
    if (!credsConfigured) {
      return jsonResponse({ error: "BrickLink OAuth1 credentials not configured", configured: false, requested: mpns.length }, 200);
    }

    const landingIds: string[] = [];
    const rows: SpecCatalogRow[] = [];
    const now = new Date().toISOString();
    let fetched = 0;

    for (const mpn of mpns) {
      try {
        const item = await fetchItem(mpn, { ck, cs, tk, ts });
        if (!item) continue;
        fetched++;
        const lid = await landRaw(admin, "bricklink", mpn, item);
        if (lid) landingIds.push(lid);
        const safe = stripValueFields(item as Record<string, unknown>);
        rows.push({
          mpn,
          name: (safe.name as string) ?? null,
          theme: (safe.category_name as string) ?? null,
          release_year: toNum(safe.year_released),
          weight_g: toNum(safe.weight),
          length_cm: toNum(safe.dim_x),
          width_cm: toNum(safe.dim_y),
          height_cm: toNum(safe.dim_z),
          image_url: (safe.image_url as string) ?? null,
          raw_attributes: safe,
          fetched_at: now,
        });
      } catch (e) {
        console.warn("bricklink fetch failed for", mpn, (e as Error).message);
      }
    }

    const up = await upsertSpec(admin, "bricklink", rows);
    const writes = await snapshotProductAttributes(admin, "bricklink", mpns);
    await commitLanding(admin, "bricklink", landingIds, true);

    return jsonResponse({ source: "bricklink", requested: mpns.length, fetched, upserted: up.count, attribute_writes: writes });
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});
