// Rebrickable sync — modes: set | enrich | full
// Redeployed: 2026-04-27
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const RB_BASE = "https://rebrickable.com/api/v3/lego";
const RATE_MS = 1100; // 1.1s between API calls — under 1 req/s limit
const PAGE_SIZE = 1000; // Rebrickable max
const BATCH = 500; // rows per Supabase upsert
const TIMEOUT_MS = 50_000; // bail before edge-function 60s limit
const FETCH_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface RbFig {
  fig_num: string;
  name: string;
  num_parts: number;
  img_url: string;
  external_ids?: { BrickLink?: string[]; BrickOwl?: string[] };
}

interface RbSetFig {
  fig_num: string;
  quantity: number;
}

interface RbSet {
  set_num: string;
  name: string;
  year: number | null;
  theme_id: number | null;
  num_parts: number | null;
  set_img_url: string | null;
  set_url?: string | null;
  last_modified_dt?: string | null;
}

interface RbPage<T> {
  count: number;
  next: string | null;
  results: T[];
}

// deno-lint-ignore no-explicit-any
type Supabase = any;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const sleep = (ms = RATE_MS) => new Promise((r) => setTimeout(r, ms));

class RbHttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "RbHttpError";
  }
}

async function rbFetch<T>(url: string, apiKey: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { Authorization: `key ${apiKey}` },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new RbHttpError(
        res.status,
        `Rebrickable ${res.status}: ${await res.text()}`,
      );
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

async function upsertBatched(
  db: Supabase,
  table: string,
  rows: Record<string, unknown>[],
  onConflict: string,
): Promise<void> {
  for (let i = 0; i < rows.length; i += BATCH) {
    const { error } = await db
      .from(table)
      .upsert(rows.slice(i, i + BATCH), { onConflict });
    if (error) throw new Error(`${table} upsert failed: ${error.message}`);
  }
}

// Map a Rebrickable set payload onto a lego_catalog row.
// theme_id is intentionally omitted — Rebrickable's integer theme_id can't be
// resolved to our public.theme.id (uuid) without a separate themes import.
function rbSetToCatalogRow(s: RbSet): Record<string, unknown> {
  return {
    mpn: s.set_num,
    name: s.name,
    product_type: "set",
    rebrickable_id: s.set_num,
    release_year: s.year ?? null,
    piece_count: s.num_parts ?? null,
    img_url: s.set_img_url ?? null,
    status: "active",
    updated_at: new Date().toISOString(),
  };
}

async function upsertCatalogSets(db: Supabase, sets: RbSet[]): Promise<void> {
  if (sets.length === 0) return;
  const rows = sets.map(rbSetToCatalogRow);
  await upsertBatched(db, "lego_catalog", rows, "mpn");
}

async function fetchAndUpsertSet(
  db: Supabase,
  apiKey: string,
  setNum: string,
): Promise<boolean> {
  try {
    const set = await rbFetch<RbSet>(`${RB_BASE}/sets/${setNum}/`, apiKey);
    await upsertCatalogSets(db, [set]);
    return true;
  } catch (err) {
    if (err instanceof RbHttpError && err.status === 404) {
      console.warn(`fetchAndUpsertSet: ${setNum} not found on Rebrickable`);
      return false;
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Mode: set — refresh a single set in lego_catalog and enrich its minifigs
// ---------------------------------------------------------------------------
async function syncSet(
  db: Supabase,
  apiKey: string,
  setNum: string,
): Promise<{
  set_num: string;
  figs_processed: number;
  bricklink_ids_added: number;
  figs_skipped?: number;
  catalog_updated: boolean;
}> {
  // 0. Refresh the set's lego_catalog row from /sets/{set_num}/.
  //    Tolerated 404 — we still try to sync minifigs below.
  const catalogUpdated = await fetchAndUpsertSet(db, apiKey, setNum);
  await sleep();

  // 1. Fetch all minifigs for this set (paginated). Tolerate 404 (set not on Rebrickable).
  let url: string | null =
    `${RB_BASE}/sets/${setNum}/minifigs/?page_size=${PAGE_SIZE}`;
  const setFigs: RbSetFig[] = [];

  try {
    while (url) {
      const page: RbPage<RbSetFig> = await rbFetch<RbPage<RbSetFig>>(
        url,
        apiKey,
      );
      setFigs.push(...page.results);
      url = page.next;
      if (url) await sleep();
    }
  } catch (err) {
    if (err instanceof RbHttpError && err.status === 404) {
      return { set_num: setNum, figs_processed: 0, bricklink_ids_added: 0 };
    }
    throw err;
  }

  if (setFigs.length === 0) {
    return { set_num: setNum, figs_processed: 0, bricklink_ids_added: 0 };
  }

  const figNums = setFigs.map((f) => f.fig_num);

  // 2. Find which figs are missing bricklink_id (or not in DB at all)
  const { data: existing, error } = await db
    .from("rebrickable_minifigs")
    .select("fig_num, bricklink_id")
    .in("fig_num", figNums);
  if (error) {
    throw new Error(`rebrickable_minifigs select: ${error.message}`);
  }

  const knownWithId = new Set<string>(
    (existing ?? [])
      .filter((r: { bricklink_id: string | null }) => !!r.bricklink_id)
      .map((r: { fig_num: string }) => r.fig_num),
  );
  const toEnrich = figNums.filter((f) => !knownWithId.has(f));

  // 3. Fetch detail for each fig that needs enriching. Skip individual 404s.
  let bricklinkAdded = 0;
  let skipped = 0;

  for (const figNum of toEnrich) {
    await sleep();
    let fig: RbFig;
    try {
      fig = await rbFetch<RbFig>(`${RB_BASE}/minifigs/${figNum}/`, apiKey);
    } catch (err) {
      if (err instanceof RbHttpError && err.status === 404) {
        console.warn(`syncSet: minifig ${figNum} not found on Rebrickable`);
        skipped++;
        continue;
      }
      throw err;
    }
    const bricklinkId = fig.external_ids?.BrickLink?.[0] ?? null;

    const { error: upsertErr } = await db
      .from("rebrickable_minifigs")
      .upsert(
        {
          fig_num: fig.fig_num,
          name: fig.name,
          num_parts: fig.num_parts,
          img_url: fig.img_url,
          bricklink_id: bricklinkId,
        },
        { onConflict: "fig_num" },
      );
    if (upsertErr) throw new Error(`minifig upsert: ${upsertErr.message}`);
    if (bricklinkId) bricklinkAdded++;
  }

  return {
    set_num: setNum,
    figs_processed: figNums.length,
    bricklink_ids_added: bricklinkAdded,
    figs_skipped: skipped,
  };
}

// ---------------------------------------------------------------------------
// Mode: enrich — run syncSet for every stocked set in the catalogue
// ---------------------------------------------------------------------------
async function enrichMode(
  db: Supabase,
  apiKey: string,
  startMs: number,
): Promise<Record<string, unknown>> {
  // Distinct MPNs that we actually hold stock for (any non-sold/non-closed unit)
  const { data: rows, error } = await db
    .from("product")
    .select("mpn, sku!inner(stock_unit!inner(id))")
    .not("mpn", "is", null);

  if (error) throw new Error(`stocked product select: ${error.message}`);

  const setNums = Array.from(
    new Set((rows ?? []).map((r: { mpn: string }) => r.mpn).filter(Boolean)),
  );

  let setsProcessed = 0;
  let figsProcessed = 0;
  let bricklinkAdded = 0;

  for (const setNum of setNums) {
    if (Date.now() - startMs > TIMEOUT_MS) break;
    try {
      const result = await syncSet(db, apiKey, setNum as string);
      figsProcessed += result.figs_processed;
      bricklinkAdded += result.bricklink_ids_added;
    } catch (err) {
      // Skip sets that 404 on Rebrickable; keep going
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`enrich: skipping ${setNum}: ${msg}`);
    }
    setsProcessed++;
    await sleep();
  }

  return {
    sets_processed: setsProcessed,
    sets_total: setNums.length,
    figs_processed: figsProcessed,
    bricklink_ids_added: bricklinkAdded,
    has_more: setsProcessed < setNums.length,
  };
}

// ---------------------------------------------------------------------------
// Mode: full — paginated refresh of all Rebrickable minifig metadata
// Cursor-based: saves progress to sync_state so we resume on re-trigger.
// bricklink_id is intentionally preserved (list endpoint omits external_ids).
// ---------------------------------------------------------------------------
async function fullMode(
  db: Supabase,
  apiKey: string,
  startMs: number,
): Promise<Record<string, unknown>> {
  const { data: stateRow } = await db
    .from("sync_state")
    .select("value")
    .eq("key", "rebrickable_full_sync")
    .maybeSingle();

  const savedCursor =
    (stateRow?.value as { next_url?: string } | null)?.next_url;
  let nextUrl: string | null =
    savedCursor ??
    `${RB_BASE}/minifigs/?page_size=${PAGE_SIZE}&ordering=fig_num`;

  let pagesProcessed = 0;
  let figsUpserted = 0;
  const resuming = !!savedCursor;

  while (nextUrl) {
    if (Date.now() - startMs > TIMEOUT_MS) {
      await db.from("sync_state").upsert(
        {
          key: "rebrickable_full_sync",
          value: { next_url: nextUrl },
          updated_at: new Date().toISOString(),
        },
        { onConflict: "key" },
      );
      return {
        status: "partial — re-trigger to resume",
        resuming,
        pages_processed: pagesProcessed,
        figs_upserted: figsUpserted,
        cursor_saved: nextUrl,
        has_more: true,
      };
    }

    const page: RbPage<RbFig> = await rbFetch<RbPage<RbFig>>(nextUrl, apiKey);

    const rows = page.results.map((f) => ({
      fig_num: f.fig_num,
      name: f.name,
      num_parts: f.num_parts,
      img_url: f.img_url,
    }));

    await upsertBatched(db, "rebrickable_minifigs", rows, "fig_num");
    figsUpserted += rows.length;
    pagesProcessed++;
    nextUrl = page.next;

    if (nextUrl) await sleep();
  }

  // Sync complete — clear cursor
  await db.from("sync_state").delete().eq("key", "rebrickable_full_sync");

  return {
    status: "complete",
    resuming,
    pages_processed: pagesProcessed,
    figs_upserted: figsUpserted,
    has_more: false,
  };
}

// ---------------------------------------------------------------------------
// Mode: incremental — fetch only minifigs modified on Rebrickable since the
// cursor stored in sync_state.key = 'rebrickable_incremental_sync'.
//
// Rebrickable has no server-side "modified-since" filter, so we order by
// -last_modified_dt (newest first) and stop pagination as soon as we hit a
// record older than the cursor. On success we advance the cursor to the
// newest last_modified_dt seen this run; on failure the cursor is left
// unchanged so the next run picks up where this one left off.
//
// Initial baseline: today at 00:00 UTC (the seed CSV snapshot date).
// ---------------------------------------------------------------------------
const INCREMENTAL_KEY = "rebrickable_incremental_sync";

function todayMidnightUtcIso(): string {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  ).toISOString();
}

async function incrementalMode(
  db: Supabase,
  apiKey: string,
  startMs: number,
): Promise<Record<string, unknown>> {
  // 1. Load the cursor (or seed it to today 00:00 UTC on first run).
  const { data: stateRow } = await db
    .from("sync_state")
    .select("value")
    .eq("key", INCREMENTAL_KEY)
    .maybeSingle();

  const baseline = todayMidnightUtcIso();
  const cursorIso =
    (stateRow?.value as { last_modified_dt?: string } | null)
      ?.last_modified_dt ?? baseline;
  const cursorMs = Date.parse(cursorIso);

  // 2. Page through minifigs newest-first; stop on first record <= cursor.
  let nextUrl: string | null =
    `${RB_BASE}/minifigs/?page_size=${PAGE_SIZE}&ordering=-last_modified_dt`;

  let pagesProcessed = 0;
  let figsUpserted = 0;
  let newestSeenIso: string | null = null;
  let stopped: "cursor" | "exhausted" | "timeout" = "exhausted";

  while (nextUrl) {
    if (Date.now() - startMs > TIMEOUT_MS) {
      stopped = "timeout";
      break;
    }

    const page: RbPage<RbFig & { last_modified_dt?: string }> =
      await rbFetch<RbPage<RbFig & { last_modified_dt?: string }>>(
        nextUrl,
        apiKey,
      );

    const fresh: RbFig[] = [];
    let hitCursor = false;

    for (const f of page.results) {
      const ts = f.last_modified_dt
        ? Date.parse(f.last_modified_dt)
        : Number.NaN;
      if (Number.isFinite(ts) && ts <= cursorMs) {
        hitCursor = true;
        break;
      }
      if (!newestSeenIso && f.last_modified_dt) {
        newestSeenIso = f.last_modified_dt;
      }
      fresh.push(f);
    }

    if (fresh.length > 0) {
      await upsertBatched(
        db,
        "rebrickable_minifigs",
        fresh.map((f) => ({
          fig_num: f.fig_num,
          name: f.name,
          num_parts: f.num_parts,
          img_url: f.img_url,
        })),
        "fig_num",
      );
      figsUpserted += fresh.length;
    }

    pagesProcessed++;

    if (hitCursor) {
      stopped = "cursor";
      break;
    }

    nextUrl = page.next;
    if (nextUrl) await sleep();
  }

  // 3. Advance the cursor only if we saw new data AND didn't time out
  //    mid-run (timeout means we may have missed older-but-still-newer rows).
  let cursorAdvancedTo: string | null = null;
  if (stopped !== "timeout" && newestSeenIso) {
    cursorAdvancedTo = newestSeenIso;
    await db.from("sync_state").upsert(
      {
        key: INCREMENTAL_KEY,
        value: {
          last_modified_dt: newestSeenIso,
          last_run_at: new Date().toISOString(),
        },
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" },
    );
  } else if (!stateRow) {
    // First run with no fresh data — persist baseline so future runs have a cursor.
    await db.from("sync_state").upsert(
      {
        key: INCREMENTAL_KEY,
        value: {
          last_modified_dt: baseline,
          last_run_at: new Date().toISOString(),
        },
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" },
    );
  }

  return {
    cursor_from: cursorIso,
    cursor_advanced_to: cursorAdvancedTo,
    pages_processed: pagesProcessed,
    figs_upserted: figsUpserted,
    stopped_reason: stopped,
    has_more: stopped === "timeout",
  };
}

// ---------------------------------------------------------------------------
// Auth: allow either (a) admin/staff JWT, or (b) service-role bearer (cron)
// ---------------------------------------------------------------------------
async function ensureAuthorized(
  // deno-lint-ignore no-explicit-any
  admin: any,
  authHeader: string | null,
  serviceRoleKey: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (!authHeader?.startsWith("Bearer ")) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }
  const token = authHeader.replace("Bearer ", "");

  // Service-role bypass (used by pg_cron)
  if (token === serviceRoleKey) return { ok: true };

  const {
    data: { user },
    error: userErr,
  } = await admin.auth.getUser(token);
  if (userErr || !user) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }
  const { data: roles } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id);
  const hasAccess = (roles ?? []).some(
    (r: { role: string }) => r.role === "admin" || r.role === "staff",
  );
  if (!hasAccess) return { ok: false, status: 403, error: "Forbidden" };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startMs = Date.now();

  try {
    const apiKey = Deno.env.get("REBRICKABLE_API_KEY");
    if (!apiKey) {
      return jsonResponse({ error: "REBRICKABLE_API_KEY not configured" }, 500);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(supabaseUrl, serviceRoleKey);

    // Auth guard
    const auth = await ensureAuthorized(
      db,
      req.headers.get("Authorization"),
      serviceRoleKey,
    );
    if (!auth.ok) {
      return jsonResponse({ error: auth.error }, auth.status);
    }

    const body = await req.json().catch(() => ({}));
    const { mode, set_num } = body as { mode?: string; set_num?: string };

    let result: Record<string, unknown>;

    switch (mode) {
      case "set":
        if (!set_num || typeof set_num !== "string") {
          return jsonResponse(
            { error: "set_num is required for mode: set" },
            400,
          );
        }
        result = await syncSet(db, apiKey, set_num.trim());
        break;
      case "enrich":
        result = await enrichMode(db, apiKey, startMs);
        break;
      case "full":
        result = await fullMode(db, apiKey, startMs);
        break;
      case "incremental":
        result = await incrementalMode(db, apiKey, startMs);
        break;
      default:
        return jsonResponse(
          {
            error:
              `Unknown mode: ${mode}. Expected one of: set | enrich | full | incremental`,
          },
          400,
        );
    }

    return jsonResponse({ ok: true, mode, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("rebrickable-sync error:", message);
    return jsonResponse({ ok: false, error: message }, 500);
  }
});
