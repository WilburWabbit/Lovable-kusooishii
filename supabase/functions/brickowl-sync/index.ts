// BrickOwl spec-only sync. Writes to brickowl_catalog_item +
// product_attribute.source_values_jsonb. Never writes price/value data.
//
// Resolution strategy (most reliable first):
//   1. Look up MPN in `brickowl_mpn_alias` table — if a BOID is cached,
//      fetch the catalog row directly by BOID (the BrickOwl-native id).
//   2. Otherwise call the BrickOwl `catalog/lookup` endpoint with
//      `id_type=design_id` (the LEGO set number). On success, capture
//      the BOID from the response and upsert it into the alias table
//      so subsequent runs hit path #1.
//   3. If neither resolves, the MPN is reported as `unresolved` in the
//      response so staff can review.
//
// Alias rows discovered automatically are saved with confidence='auto'.
// Manual / verified entries (set via the admin UI) are never overwritten
// by the auto-discovery path.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.47.10";
import {
  corsHeaders, requireStaff, jsonResponse, landRaw, commitLanding,
  upsertSpec, snapshotProductAttributes, fetchWithTimeout, stripValueFields,
  type SpecCatalogRow,
} from "../_shared/multi-source-sync.ts";

const BO_BASE = "https://api.brickowl.com/v1";

interface BOItem {
  boid?: string;
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
  type?: string;
}

interface AliasRow {
  mpn: string;
  boid: string;
  confidence: "auto" | "verified" | "manual";
}

type ResolveMethod = "alias" | "lookup" | "unresolved";

function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "string" ? parseFloat(v) : (v as number);
  return Number.isFinite(n) ? n : null;
}

/** Fetch the catalog row directly by BOID. Returns null on miss. */
async function fetchByBoid(boid: string, key: string): Promise<BOItem | null> {
  const url = `${BO_BASE}/catalog/lookup?key=${encodeURIComponent(key)}&boid=${encodeURIComponent(boid)}`;
  const res = await fetchWithTimeout(url, { headers: { Accept: "application/json" } });
  if (!res.ok) return null;
  const body = await res.json().catch(() => null);
  if (!body) return null;
  // Direct BOID lookups can return either a single object or a 1-element array.
  const item = Array.isArray(body) ? body[0] : (body.data ?? body);
  return (item ?? null) as BOItem | null;
}

/** Discover a BOID for an MPN via the design_id lookup. Returns the
 *  matched item plus the BOID we resolved (if any). */
async function discoverByDesignId(
  mpn: string,
  key: string,
): Promise<{ item: BOItem; boid: string | null } | null> {
  const url = `${BO_BASE}/catalog/lookup?key=${encodeURIComponent(key)}&id=${encodeURIComponent(mpn)}&id_type=design_id`;
  const res = await fetchWithTimeout(url, { headers: { Accept: "application/json" } });
  if (!res.ok) return null;
  const body = await res.json().catch(() => null);
  if (!body) return null;
  const items = Array.isArray(body) ? body : (body.data ?? []);
  if (!Array.isArray(items) || items.length === 0) return null;
  // Prefer Set type, then fall back to first match.
  const set = items.find((i: BOItem) => i.type === "Set") ?? items[0];
  if (!set) return null;
  const boid = (set.boid as string | undefined) ?? null;
  return { item: set as BOItem, boid };
}

/** Upsert an auto-discovered alias. Never overwrite manual/verified entries. */
async function cacheAlias(admin: SupabaseClient, mpn: string, boid: string) {
  const { data: existing } = await admin
    .from("brickowl_mpn_alias")
    .select("id,confidence")
    .eq("mpn", mpn)
    .maybeSingle();
  if (existing) {
    if (existing.confidence === "manual" || existing.confidence === "verified") return;
    await admin
      .from("brickowl_mpn_alias")
      .update({ boid, source: "lookup", last_verified_at: new Date().toISOString() })
      .eq("id", existing.id);
  } else {
    await admin.from("brickowl_mpn_alias").insert({
      mpn,
      boid,
      confidence: "auto",
      source: "lookup",
      last_verified_at: new Date().toISOString(),
    });
  }
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

    // Bulk-load existing aliases for this batch in one query.
    const { data: aliasRows } = await admin
      .from("brickowl_mpn_alias")
      .select("mpn,boid,confidence")
      .in("mpn", mpns);
    const aliasByMpn = new Map<string, AliasRow>();
    for (const a of (aliasRows ?? []) as AliasRow[]) aliasByMpn.set(a.mpn, a);

    const landingIds: string[] = [];
    const rows: SpecCatalogRow[] = [];
    const now = new Date().toISOString();
    const resolution: Record<string, { method: ResolveMethod; boid?: string }> = {};
    let fetched = 0;
    let aliasHits = 0;
    let aliasDiscovered = 0;
    let unresolved = 0;

    for (const mpn of mpns) {
      try {
        let item: BOItem | null = null;
        let method: ResolveMethod = "unresolved";
        let resolvedBoid: string | null = null;

        // Path 1: cached alias lookup.
        const alias = aliasByMpn.get(mpn);
        if (alias?.boid) {
          item = await fetchByBoid(alias.boid, key);
          if (item) {
            method = "alias";
            resolvedBoid = alias.boid;
            aliasHits++;
          }
        }

        // Path 2: design_id discovery (also triggered if alias fetch returned null).
        if (!item) {
          const discovered = await discoverByDesignId(mpn, key);
          if (discovered) {
            item = discovered.item;
            method = "lookup";
            resolvedBoid = discovered.boid;
            if (discovered.boid) {
              await cacheAlias(admin, mpn, discovered.boid);
              aliasDiscovered++;
            }
          }
        }

        if (!item) {
          unresolved++;
          resolution[mpn] = { method: "unresolved" };
          continue;
        }

        fetched++;
        resolution[mpn] = { method, boid: resolvedBoid ?? undefined };

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
        unresolved++;
        resolution[mpn] = { method: "unresolved" };
      }
    }

    const up = await upsertSpec(admin, "brickowl", rows);
    const writes = await snapshotProductAttributes(admin, "brickowl", mpns);
    await commitLanding(admin, "brickowl", landingIds, true);

    return jsonResponse({
      source: "brickowl",
      requested: mpns.length,
      fetched,
      upserted: up.count,
      attribute_writes: writes,
      alias_hits: aliasHits,
      alias_discovered: aliasDiscovered,
      unresolved,
      resolution,
    });
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});
