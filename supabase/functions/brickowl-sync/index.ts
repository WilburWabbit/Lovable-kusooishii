// BrickOwl spec-only sync. Writes to brickowl_catalog_item +
// product_attribute.source_values_jsonb. Never writes price/value data.
import { createClient } from "npm:@supabase/supabase-js@2.47.10";
import {
  corsHeaders, requireStaff, jsonResponse, landRaw, commitLanding,
  upsertSpec, snapshotProductAttributes, fetchWithTimeout, stripValueFields,
  type SpecCatalogRow,
} from "../_shared/multi-source-sync.ts";

const BO_BASE = "https://api.brickowl.com/v1";

interface BOItem {
  name?: string;
  category_name?: string;
  year?: number | string;
  weight?: number | string;
  dimensions?: { x?: number | string; y?: number | string; z?: number | string };
  image_small?: string;
  image_large?: string;
  piece_count?: number | string;
  minifig_count?: number | string;
  age?: string;
}

function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "string" ? parseFloat(v) : (v as number);
  return Number.isFinite(n) ? n : null;
}

async function fetchItem(mpn: string, key: string): Promise<BOItem | null> {
  // BrickOwl uses BOID, not LEGO MPN. As a first pass we try the lookup
  // endpoint by id. If it doesn't resolve, we return null and rely on a
  // future alias table to map MPN -> BOID.
  const url = `${BO_BASE}/catalog/lookup?key=${encodeURIComponent(key)}&id=${encodeURIComponent(mpn)}&id_type=design_id`;
  const res = await fetchWithTimeout(url, { headers: { Accept: "application/json" } });
  if (!res.ok) return null;
  const body = await res.json().catch(() => null);
  if (!body) return null;
  // Lookup returns an array of matches; take the first set match.
  const items = Array.isArray(body) ? body : (body.data ?? []);
  const set = items.find((i: { type?: string }) => i.type === "Set") ?? items[0];
  return (set ?? null) as BOItem | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const auth = await requireStaff(admin, req.headers.get("Authorization"));
    if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status);

    const key = Deno.env.get("BRICKOWL_API_KEY") ?? "";
    const body = await req.json().catch(() => ({}));
    const mpns: string[] = body.mpn ? [String(body.mpn)] : Array.isArray(body.mpns) ? body.mpns.map(String) : [];
    if (mpns.length === 0) return jsonResponse({ error: "mpn or mpns required" }, 400);
    if (!key) {
      return jsonResponse({ error: "BRICKOWL_API_KEY not configured", configured: false, requested: mpns.length }, 200);
    }

    const landingIds: string[] = [];
    const rows: SpecCatalogRow[] = [];
    const now = new Date().toISOString();
    let fetched = 0;

    for (const mpn of mpns) {
      try {
        const item = await fetchItem(mpn, key);
        if (!item) continue;
        fetched++;
        const lid = await landRaw(admin, "brickowl", mpn, item);
        if (lid) landingIds.push(lid);
        const safe = stripValueFields(item as Record<string, unknown>);
        const dims = (safe.dimensions ?? {}) as Record<string, unknown>;
        rows.push({
          mpn,
          name: (safe.name as string) ?? null,
          theme: (safe.category_name as string) ?? null,
          release_year: toNum(safe.year),
          piece_count: toNum(safe.piece_count),
          minifig_count: toNum(safe.minifig_count),
          weight_g: toNum(safe.weight),
          length_cm: toNum(dims.x),
          width_cm: toNum(dims.y),
          height_cm: toNum(dims.z),
          age_mark: (safe.age as string) ?? null,
          image_url: (safe.image_large as string) ?? (safe.image_small as string) ?? null,
          raw_attributes: safe,
          fetched_at: now,
        });
      } catch (e) {
        console.warn("brickowl fetch failed for", mpn, (e as Error).message);
      }
    }

    const up = await upsertSpec(admin, "brickowl", rows);
    const writes = await snapshotProductAttributes(admin, "brickowl", mpns);
    await commitLanding(admin, "brickowl", landingIds, true);

    return jsonResponse({ source: "brickowl", requested: mpns.length, fetched, upserted: up.count, attribute_writes: writes });
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});
