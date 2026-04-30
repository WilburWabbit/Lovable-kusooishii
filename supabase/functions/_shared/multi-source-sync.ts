// Shared helpers for the multi-source product enrichment edge functions
// (bricklink-sync, brickowl-sync, brickset-sync, refresh-all-sources).
//
// HARD CONSTRAINT: these functions write ONLY to *_catalog_item spec tables
// and to product_attribute.source_values_jsonb. They MUST NOT touch
// brickeconomy_collection, brickeconomy_price_history, or any pricing field.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.47.10";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

export type SourceName = "bricklink" | "brickowl" | "brickset" | "brickeconomy";

export interface SpecCatalogRow {
  mpn: string;
  name?: string | null;
  theme?: string | null;
  subtheme?: string | null;
  release_year?: number | null;
  piece_count?: number | null;
  minifig_count?: number | null;
  weight_g?: number | null;
  length_cm?: number | null;
  width_cm?: number | null;
  height_cm?: number | null;
  age_mark?: string | null;
  image_url?: string | null;
  raw_attributes: Record<string, unknown>;
  fetched_at: string;
}

const SPEC_TABLE: Record<SourceName, string> = {
  bricklink: "bricklink_catalog_item",
  brickowl: "brickowl_catalog_item",
  brickset: "brickset_catalog_item",
  brickeconomy: "brickeconomy_catalog_item",
};

const LANDING_TABLE: Record<SourceName, string> = {
  bricklink: "landing_raw_bricklink",
  brickowl: "landing_raw_brickowl",
  brickset: "landing_raw_brickset",
  brickeconomy: "landing_raw_brickeconomy",
};

/** Strip price/value fields from any source payload. Defence-in-depth so even
 *  if a source returns pricing data we never propagate it. */
const VALUE_FIELD_BLOCKLIST = new Set([
  "price", "current_value", "currentvalue", "retail_price", "retailprice",
  "value", "growth", "paid_price", "paidprice", "msrp", "rrp",
  "market_price", "marketprice", "sell_price", "sellprice",
]);

export function stripValueFields<T extends Record<string, unknown>>(payload: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (VALUE_FIELD_BLOCKLIST.has(k.toLowerCase())) continue;
    out[k] = v;
  }
  return out as T;
}

export async function requireStaff(
  admin: SupabaseClient,
  authHeader: string | null,
): Promise<{ ok: true; userId: string } | { ok: false; status: number; error: string }> {
  if (!authHeader?.startsWith("Bearer ")) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }
  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error } = await admin.auth.getUser(token);
  if (error || !user) return { ok: false, status: 401, error: "Unauthorized" };
  const { data: roles } = await admin
    .from("user_roles").select("role").eq("user_id", user.id);
  const ok = (roles ?? []).some((r: { role: string }) =>
    r.role === "admin" || r.role === "staff");
  if (!ok) return { ok: false, status: 403, error: "Forbidden" };
  return { ok: true, userId: user.id };
}

export async function landRaw(
  admin: SupabaseClient,
  source: SourceName,
  externalId: string,
  payload: unknown,
): Promise<string | null> {
  const { data, error } = await admin
    .from(LANDING_TABLE[source])
    .upsert(
      {
        external_id: externalId,
        entity_type: "item",
        raw_payload: payload,
        status: "pending",
        received_at: new Date().toISOString(),
      },
      { onConflict: "external_id" },
    )
    .select("id")
    .single();
  if (error) {
    console.warn(`landRaw ${source} ${externalId}:`, error.message);
    return null;
  }
  return data?.id ?? null;
}

export async function commitLanding(
  admin: SupabaseClient,
  source: SourceName,
  ids: string[],
  ok: boolean,
  errMsg?: string,
) {
  if (ids.length === 0) return;
  await admin.from(LANDING_TABLE[source]).update({
    status: ok ? "committed" : "error",
    error_message: errMsg ? errMsg.substring(0, 500) : null,
    processed_at: new Date().toISOString(),
  }).in("id", ids);
}

export async function upsertSpec(
  admin: SupabaseClient,
  source: SourceName,
  rows: SpecCatalogRow[],
): Promise<{ count: number; error?: string }> {
  if (rows.length === 0) return { count: 0 };
  const sanitised = rows.map((r) => ({ ...r, raw_attributes: stripValueFields(r.raw_attributes) }));
  let inserted = 0;
  let firstErr: string | undefined;
  for (let i = 0; i < sanitised.length; i += 100) {
    const batch = sanitised.slice(i, i + 100);
    const { error, count } = await admin
      .from(SPEC_TABLE[source])
      .upsert(batch, { onConflict: "mpn", count: "exact" });
    if (error) {
      firstErr = firstErr ?? error.message;
      console.warn(`upsertSpec ${source}:`, error.message);
    } else {
      inserted += count ?? batch.length;
    }
  }
  return { count: inserted, error: firstErr };
}

/** Refresh the source_values_jsonb snapshot on product_attribute for every
 *  canonical attribute mapped from this source. Pure non-value path. */
export async function snapshotProductAttributes(
  admin: SupabaseClient,
  source: SourceName,
  mpns: string[],
): Promise<number> {
  if (mpns.length === 0) return 0;

  // Map source field -> canonical key for this source
  const { data: mappings } = await admin
    .from("source_field_mapping")
    .select("source_field, canonical_key, canonical_attribute:canonical_key(attribute_group)")
    .eq("source", source);
  if (!mappings || mappings.length === 0) return 0;

  // Filter out value-group canonical keys (defence-in-depth alongside the DB trigger)
  const mappingsSafe = mappings.filter((m) => {
    const grp = (m as { canonical_attribute?: { attribute_group?: string } }).canonical_attribute?.attribute_group;
    return grp !== "value";
  });
  if (mappingsSafe.length === 0) return 0;

  // Pull the spec rows for the requested MPNs
  const { data: specs } = await admin
    .from(SPEC_TABLE[source])
    .select("*")
    .in("mpn", mpns);
  if (!specs || specs.length === 0) return 0;

  // Pull the matching products to get their UUIDs
  const { data: products } = await admin
    .from("product")
    .select("id, mpn")
    .in("mpn", mpns);
  if (!products || products.length === 0) return 0;
  const productByMpn = new Map(products.map((p) => [p.mpn as string, p.id as string]));

  let writes = 0;
  for (const spec of specs as Record<string, unknown>[]) {
    const productId = productByMpn.get(spec.mpn as string);
    if (!productId) continue;

    for (const m of mappingsSafe) {
      const sourceField = m.source_field as string;
      const canonicalKey = m.canonical_key as string;
      // Look up the value in the spec row first; fall back to raw_attributes
      const raw = spec[sourceField] ?? (spec.raw_attributes as Record<string, unknown> | undefined)?.[sourceField];
      const stringValue = raw == null ? null : String(raw);

      // Read existing snapshot to merge
      const { data: existing } = await admin
        .from("product_attribute")
        .select("id, source_values_jsonb")
        .eq("product_id", productId)
        .eq("namespace", "core")
        .eq("key", canonicalKey)
        .is("channel", null)
        .is("marketplace", null)
        .is("category_id", null)
        .maybeSingle();

      const merged = {
        ...(((existing?.source_values_jsonb as Record<string, unknown>) ?? {})),
        [source]: { value: stringValue, fetched_at: spec.fetched_at },
      };

      if (existing?.id) {
        await admin.from("product_attribute").update({
          source_values_jsonb: merged,
        }).eq("id", existing.id);
      } else {
        await admin.from("product_attribute").insert({
          product_id: productId,
          namespace: "core",
          key: canonicalKey,
          source: source === "brickeconomy" ? "brickeconomy" : "manual",
          source_values_jsonb: merged,
        });
      }
      writes++;
    }
  }
  return writes;
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Standard timeout-aware fetch shared across syncs. */
export function fetchWithTimeout(
  url: string | URL,
  options: RequestInit = {},
  timeoutMs = 30_000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}
