// Brickset spec-only sync. Writes to brickset_catalog_item +
// product_attribute.source_values_jsonb. Never writes price/value data.
import { createClient } from "npm:@supabase/supabase-js@2.47.10";
import {
  corsHeaders, requireStaff, jsonResponse, landRaw, commitLanding,
  upsertSpec, snapshotProductAttributes, fetchWithTimeout, stripValueFields,
  type SpecCatalogRow,
} from "../_shared/multi-source-sync.ts";

const BS_BASE = "https://brickset.com/api/v3.asmx";

interface BSItem {
  setID?: number;
  number?: string;
  numberVariant?: number;
  name?: string;
  year?: number;
  theme?: string;
  subtheme?: string;
  pieces?: number;
  minifigs?: number;
  ageRange?: { min?: number; max?: number };
  dimensions?: { width?: number; height?: number; depth?: number; weight?: number };
  image?: { imageURL?: string; thumbnailURL?: string };
}

async function loginGetUserHash(apiKey: string, user: string, pass: string): Promise<string | null> {
  if (!user || !pass) return ""; // login is optional; some endpoints work with just apiKey
  const url = `${BS_BASE}/login?apiKey=${encodeURIComponent(apiKey)}&username=${encodeURIComponent(user)}&password=${encodeURIComponent(pass)}`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) return null;
  const body = await res.json().catch(() => null);
  return body?.hash ?? "";
}

async function fetchItem(mpn: string, apiKey: string, userHash: string): Promise<BSItem | null> {
  // Brickset wants set numbers like "75418-1"
  const params = JSON.stringify({ setNumber: mpn });
  const url = `${BS_BASE}/getSets?apiKey=${encodeURIComponent(apiKey)}&userHash=${encodeURIComponent(userHash)}&params=${encodeURIComponent(params)}`;
  const res = await fetchWithTimeout(url, { headers: { Accept: "application/json" } });
  if (!res.ok) return null;
  const body = await res.json().catch(() => null);
  const sets = body?.sets ?? [];
  return sets[0] ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const auth = await requireStaff(admin, req.headers.get("Authorization"));
    if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status);

    const apiKey = Deno.env.get("BRICKSET_API_KEY") ?? "";
    const user = Deno.env.get("BRICKSET_USERNAME") ?? "";
    const pass = Deno.env.get("BRICKSET_PASSWORD") ?? "";
    const body = await req.json().catch(() => ({}));
    const mpns: string[] = body.mpn ? [String(body.mpn)] : Array.isArray(body.mpns) ? body.mpns.map(String) : [];
    if (mpns.length === 0) return jsonResponse({ error: "mpn or mpns required" }, 400);
    if (!apiKey) {
      return jsonResponse({ error: "BRICKSET_API_KEY not configured", configured: false, requested: mpns.length }, 200);
    }

    const userHash = await loginGetUserHash(apiKey, user, pass);
    if (userHash === null) return jsonResponse({ error: "Brickset login failed" }, 502);

    const landingIds: string[] = [];
    const rows: SpecCatalogRow[] = [];
    const now = new Date().toISOString();
    let fetched = 0;

    for (const mpn of mpns) {
      try {
        const item = await fetchItem(mpn, apiKey, userHash);
        if (!item) continue;
        fetched++;
        const lid = await landRaw(admin, "brickset", mpn, item);
        if (lid) landingIds.push(lid);
        const safe = stripValueFields(item as unknown as Record<string, unknown>);
        const dims = (item.dimensions ?? {}) as BSItem["dimensions"];
        const ageMark =
          item.ageRange?.min != null
            ? `${item.ageRange.min}+`
            : null;
        rows.push({
          mpn,
          name: item.name ?? null,
          theme: item.theme ?? null,
          subtheme: item.subtheme ?? null,
          release_year: item.year ?? null,
          piece_count: item.pieces ?? null,
          minifig_count: item.minifigs ?? null,
          weight_g: dims?.weight ?? null,
          length_cm: dims?.width ?? null,
          width_cm: dims?.depth ?? null,
          height_cm: dims?.height ?? null,
          age_mark: ageMark,
          image_url: item.image?.imageURL ?? item.image?.thumbnailURL ?? null,
          raw_attributes: safe,
          fetched_at: now,
        });
      } catch (e) {
        console.warn("brickset fetch failed for", mpn, (e as Error).message);
      }
    }

    const up = await upsertSpec(admin, "brickset", rows);
    const writes = await snapshotProductAttributes(admin, "brickset", mpns);
    await commitLanding(admin, "brickset", landingIds, true);

    return jsonResponse({ source: "brickset", requested: mpns.length, fetched, upserted: up.count, attribute_writes: writes });
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});
