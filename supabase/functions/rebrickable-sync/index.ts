// Rebrickable sync — modes: set | enrich | full
// Redeployed: 2026-04-27
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";
import {
  fetchSetMinifigs,
  getBlCreds,
  normalizeMinifigName,
  type BlCreds,
  type BlMinifig,
} from "../_shared/bricklink-client.ts";

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
  fig_num?: string;
  set_num?: string; // /lego/minifigs/{n}/ sometimes returns set_num instead
  name: string;
  num_parts: number;
  img_url: string;
  external_ids?: { BrickLink?: string[]; BrickOwl?: string[] };
}

// /lego/sets/{set_num}/minifigs/ returns inventory rows that describe a
// minifig contained within a set. Rebrickable models minifigs as a special
// kind of set, so the row's identifier comes back as `set_num` (the minifig's
// fig number, e.g. "fig-001234"). Some integrations also surface it as
// `fig_num`. We accept either and normalise downstream.
interface RbSetFig {
  fig_num?: string;
  set_num?: string;
  set_name?: string;
  set_img_url?: string;
  quantity: number;
}

function readFigNum(row: RbSetFig): string | null {
  const v = (row.fig_num ?? row.set_num ?? "").trim();
  return v.length > 0 ? v : null;
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
// Mode: set — refresh a single set in lego_catalog, refresh its included
// minifigs (rebrickable_minifigs), and persist the set ↔ minifig relationship
// in rebrickable_inventories + rebrickable_inventory_minifigs so the rest of
// the app (product descriptions, eBay item specifics) can ask "which minifigs
// are in set 75367-1?".
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
  inventory_id: number | null;
  inventory_links_written: number;
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
      return {
        set_num: setNum,
        figs_processed: 0,
        bricklink_ids_added: 0,
        catalog_updated: catalogUpdated,
        inventory_id: null,
        inventory_links_written: 0,
      };
    }
    throw err;
  }

  if (setFigs.length === 0) {
    // Set has no minifigs on Rebrickable — clear any stale link rows so the
    // app doesn't show minifigs that aren't actually included.
    const { data: invRow } = await db
      .from("rebrickable_inventories")
      .select("id")
      .eq("set_num", setNum)
      .eq("version", 1)
      .maybeSingle();
    if (invRow?.id) {
      await db
        .from("rebrickable_inventory_minifigs")
        .delete()
        .eq("inventory_id", invRow.id);
    }
    return {
      set_num: setNum,
      figs_processed: 0,
      bricklink_ids_added: 0,
      catalog_updated: catalogUpdated,
      inventory_id: invRow?.id ?? null,
      inventory_links_written: 0,
    };
  }

  // Normalise: pair each row with its fig identifier and drop rows we can't
  // identify (defensive — Rebrickable occasionally returns nulls).
  const setFigPairs: { fig_num: string; row: RbSetFig }[] = [];
  for (const row of setFigs) {
    const fig = readFigNum(row);
    if (fig) setFigPairs.push({ fig_num: fig, row });
  }
  const figNums = Array.from(new Set(setFigPairs.map((p) => p.fig_num)));

  if (figNums.length === 0) {
    return {
      set_num: setNum,
      figs_processed: 0,
      bricklink_ids_added: 0,
      catalog_updated: catalogUpdated,
      inventory_id: null,
      inventory_links_written: 0,
    };
  }

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
          fig_num: fig.fig_num ?? fig.set_num ?? figNum,
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

  // 4. Make sure every fig in this set exists in rebrickable_minifigs before
  //    we write inventory_minifigs (FK constraint). For figs we already know
  //    about we keep their bricklink_id; for unknown figs we insert a minimal
  //    placeholder row using the data the /sets/{n}/minifigs/ endpoint gives us.
  const { data: knownAfter } = await db
    .from("rebrickable_minifigs")
    .select("fig_num")
    .in("fig_num", figNums);
  const knownSet = new Set<string>(
    (knownAfter ?? []).map((r: { fig_num: string }) => r.fig_num),
  );
  const missingPairs = setFigPairs.filter((p) => !knownSet.has(p.fig_num));
  if (missingPairs.length > 0) {
    // Dedupe by fig_num so the upsert isn't fed duplicate keys.
    const seen = new Set<string>();
    const placeholderRows: Record<string, unknown>[] = [];
    for (const { fig_num, row } of missingPairs) {
      if (seen.has(fig_num)) continue;
      seen.add(fig_num);
      placeholderRows.push({
        fig_num,
        name: row.set_name ?? fig_num,
        num_parts: 0,
        img_url: row.set_img_url ?? null,
      });
    }
    await upsertBatched(db, "rebrickable_minifigs", placeholderRows, "fig_num");
  }

  // 5. Resolve / allocate the inventory_id for this set (version 1) and
  //    replace its link rows so the relationship reflects the latest data
  //    from Rebrickable.
  let inventoryId: number | null = null;
  let linksWritten = 0;
  try {
    const { data: invIdData, error: invErr } = await db.rpc(
      "get_or_create_rebrickable_inventory",
      { p_set_num: setNum, p_version: 1 },
    );
    if (invErr) throw invErr;
    inventoryId = (invIdData as number | null) ?? null;

    if (inventoryId !== null) {
      // Wipe existing links for this inventory then insert fresh ones — the
      // truth of "what's in this set" comes from the API call we just made.
      const { error: delErr } = await db
        .from("rebrickable_inventory_minifigs")
        .delete()
        .eq("inventory_id", inventoryId);
      if (delErr) throw delErr;

      // Collapse duplicates (Rebrickable can list the same fig twice with
      // different inventory rows) by summing quantity per fig.
      const qtyByFig = new Map<string, number>();
      for (const { fig_num, row } of setFigPairs) {
        qtyByFig.set(
          fig_num,
          (qtyByFig.get(fig_num) ?? 0) + (row.quantity ?? 1),
        );
      }
      const linkRows = Array.from(qtyByFig.entries()).map(
        ([fig_num, quantity]) => ({
          inventory_id: inventoryId,
          fig_num,
          quantity,
        }),
      );
      if (linkRows.length > 0) {
        const { error: insErr } = await db
          .from("rebrickable_inventory_minifigs")
          .insert(linkRows);
        if (insErr) throw insErr;
        linksWritten = linkRows.length;
      }
    }
  } catch (err) {
    // Don't fail the whole sync over a link-write problem — log and continue.
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`syncSet(${setNum}): link write failed: ${msg}`);
  }

  return {
    set_num: setNum,
    figs_processed: figNums.length,
    bricklink_ids_added: bricklinkAdded,
    figs_skipped: skipped,
    catalog_updated: catalogUpdated,
    inventory_id: inventoryId,
    inventory_links_written: linksWritten,
  };
}

// ---------------------------------------------------------------------------
// Mode: enrich — run syncSet for stocked sets that don't yet have minifig
// inventory links. Sets already linked are skipped so resumed runs make
// continuous progress instead of re-processing the same head of the list.
// ---------------------------------------------------------------------------
async function enrichMode(
  db: Supabase,
  apiKey: string,
  startMs: number,
): Promise<Record<string, unknown>> {
  // 1. Distinct MPNs we hold stock for
  const { data: rows, error } = await db
    .from("product")
    .select("mpn, sku!inner(stock_unit!inner(id))")
    .not("mpn", "is", null);

  if (error) throw new Error(`stocked product select: ${error.message}`);

  const stockedMpns = Array.from(
    new Set((rows ?? []).map((r: { mpn: string }) => r.mpn).filter(Boolean)),
  ) as string[];

  // 2. Find which of those already have an inventory row in our DB.
  const { data: invRows, error: invErr } = await db
    .from("rebrickable_inventories")
    .select("set_num")
    .in("set_num", stockedMpns)
    .eq("version", 1);
  if (invErr) throw new Error(`inventory lookup: ${invErr.message}`);
  const alreadyLinked = new Set<string>(
    (invRows ?? []).map((r: { set_num: string }) => r.set_num),
  );

  // 2b. Of the linked sets, find which still have at least one minifig
  //     missing a bricklink_id (LEGO MPN). Those need re-syncing so the
  //     per-fig /minifigs/{n}/ fetch can populate external_ids.BrickLink.
  const linkedSets = stockedMpns.filter((m) => alreadyLinked.has(m));
  const setsNeedingBricklink = new Set<string>();
  if (linkedSets.length > 0) {
    const { data: needRows } = await db
      .from("lego_set_minifigs" as never)
      .select("set_num")
      .in("set_num", linkedSets)
      .is("bricklink_id", null);
    for (const r of (needRows ?? []) as Array<{ set_num: string }>) {
      setsNeedingBricklink.add(r.set_num);
    }
  }

  // Priority: missing inventory → linked-but-needs-bricklink → fully done.
  const missing = stockedMpns.filter((m) => !alreadyLinked.has(m));
  const needsBl = linkedSets.filter((m) => setsNeedingBricklink.has(m));
  const done = linkedSets.filter((m) => !setsNeedingBricklink.has(m));
  const setNums = [...missing, ...needsBl, ...done];

  let setsProcessed = 0;
  let catalogUpdated = 0;
  let figsProcessed = 0;
  let bricklinkAdded = 0;
  let inventoryLinksWritten = 0;

  for (const setNum of setNums) {
    if (Date.now() - startMs > TIMEOUT_MS) break;
    try {
      const result = await syncSet(db, apiKey, setNum as string);
      figsProcessed += result.figs_processed;
      bricklinkAdded += result.bricklink_ids_added;
      inventoryLinksWritten += result.inventory_links_written;
      if (result.catalog_updated) catalogUpdated++;
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
    sets_missing_links_before: missing.length,
    sets_missing_links_remaining: Math.max(missing.length - setsProcessed, 0),
    sets_needing_bricklink_ids_before: needsBl.length,
    catalog_rows_updated: catalogUpdated,
    figs_processed: figsProcessed,
    bricklink_ids_added: bricklinkAdded,
    inventory_links_written: inventoryLinksWritten,
    has_more: setsProcessed < setNums.length,
  };
}

// ---------------------------------------------------------------------------
// Mode: full — paginated refresh of every Rebrickable set (lego_catalog) AND
// minifig (rebrickable_minifigs). Two-phase, cursor-based:
//   phase = 'sets'     — paginate /lego/sets/ → upsert lego_catalog
//   phase = 'minifigs' — paginate /lego/minifigs/ → upsert rebrickable_minifigs
// On timeout the cursor (phase + next_url) is saved so the next trigger
// resumes from the same page. bricklink_id is preserved (list endpoints
// omit external_ids).
// ---------------------------------------------------------------------------
async function fullMode(
  db: Supabase,
  apiKey: string,
  startMs: number,
): Promise<Record<string, unknown>> {
  const FULL_KEY = "rebrickable_full_sync";

  const { data: stateRow } = await db
    .from("sync_state")
    .select("value")
    .eq("key", FULL_KEY)
    .maybeSingle();

  const savedState = (stateRow?.value ?? null) as
    | { phase?: "sets" | "minifigs"; next_url?: string }
    | null;
  const resuming = !!savedState?.next_url;

  let phase: "sets" | "minifigs" = savedState?.phase ?? "sets";
  let nextUrl: string | null = savedState?.next_url ??
    `${RB_BASE}/sets/?page_size=${PAGE_SIZE}&ordering=set_num`;

  let pagesProcessed = 0;
  let setsUpserted = 0;
  let figsUpserted = 0;

  const saveCursorAndExit = async (): Promise<Record<string, unknown>> => {
    await db.from("sync_state").upsert(
      {
        key: FULL_KEY,
        value: { phase, next_url: nextUrl },
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" },
    );
    return {
      status: "partial — re-trigger to resume",
      resuming,
      phase,
      pages_processed: pagesProcessed,
      sets_upserted: setsUpserted,
      figs_upserted: figsUpserted,
      cursor_saved: nextUrl,
      has_more: true,
    };
  };

  // Phase 1: SETS → lego_catalog
  while (phase === "sets" && nextUrl) {
    if (Date.now() - startMs > TIMEOUT_MS) return await saveCursorAndExit();

    const page: RbPage<RbSet> = await rbFetch<RbPage<RbSet>>(nextUrl, apiKey);
    await upsertCatalogSets(db, page.results);
    setsUpserted += page.results.length;
    pagesProcessed++;
    nextUrl = page.next;

    if (!nextUrl) {
      // Sets exhausted — advance to minifigs phase
      phase = "minifigs";
      nextUrl =
        `${RB_BASE}/minifigs/?page_size=${PAGE_SIZE}&ordering=fig_num`;
    }
    await sleep();
  }

  // Phase 2: MINIFIGS → rebrickable_minifigs
  while (phase === "minifigs" && nextUrl) {
    if (Date.now() - startMs > TIMEOUT_MS) return await saveCursorAndExit();

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

  // Both phases complete — clear cursor
  await db.from("sync_state").delete().eq("key", FULL_KEY);

  return {
    status: "complete",
    resuming,
    pages_processed: pagesProcessed,
    sets_upserted: setsUpserted,
    figs_upserted: figsUpserted,
    has_more: false,
  };
}

// ---------------------------------------------------------------------------
// Mode: incremental — fetch only sets and minifigs modified on Rebrickable
// since the per-entity cursors stored in
// sync_state.key = 'rebrickable_incremental_sync'.
//
// Cursor shape:
//   { sets: { last_modified_dt }, minifigs: { last_modified_dt }, last_run_at }
//
// Rebrickable has no server-side "modified-since" filter, so we order each
// list by -last_modified_dt (newest first) and stop pagination as soon as we
// hit a record older than the cursor for that entity. On success we advance
// each cursor independently to the newest last_modified_dt seen this run; on
// failure / timeout the cursor is left unchanged so the next run picks up
// where this one left off.
//
// Initial baseline: today at 00:00 UTC (the seed CSV snapshot date).
// ---------------------------------------------------------------------------
const INCREMENTAL_KEY = "rebrickable_incremental_sync";

interface IncrementalCursor {
  sets?: { last_modified_dt?: string };
  minifigs?: { last_modified_dt?: string };
  last_modified_dt?: string; // legacy: pre-sets cursor (minifigs only)
  last_run_at?: string | null;
}

function todayMidnightUtcIso(): string {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  ).toISOString();
}

interface IncrementalEntityResult {
  cursor_from: string;
  cursor_advanced_to: string | null;
  pages_processed: number;
  rows_upserted: number;
  stopped_reason: "cursor" | "exhausted" | "timeout";
}

// Generic "fetch newest-first until <= cursor" helper.
async function syncIncrementalEntity<T extends { last_modified_dt?: string }>(
  apiKey: string,
  startMs: number,
  listUrl: string,
  cursorIso: string,
  upsert: (rows: T[]) => Promise<void>,
): Promise<IncrementalEntityResult> {
  const cursorMs = Date.parse(cursorIso);
  let nextUrl: string | null = listUrl;
  let pagesProcessed = 0;
  let rowsUpserted = 0;
  let newestSeenIso: string | null = null;
  let stopped: "cursor" | "exhausted" | "timeout" = "exhausted";

  while (nextUrl) {
    if (Date.now() - startMs > TIMEOUT_MS) {
      stopped = "timeout";
      break;
    }

    const page: RbPage<T> = await rbFetch<RbPage<T>>(nextUrl, apiKey);

    const fresh: T[] = [];
    let hitCursor = false;

    for (const r of page.results) {
      const ts = r.last_modified_dt
        ? Date.parse(r.last_modified_dt)
        : Number.NaN;
      if (Number.isFinite(ts) && ts <= cursorMs) {
        hitCursor = true;
        break;
      }
      if (!newestSeenIso && r.last_modified_dt) {
        newestSeenIso = r.last_modified_dt;
      }
      fresh.push(r);
    }

    if (fresh.length > 0) {
      await upsert(fresh);
      rowsUpserted += fresh.length;
    }

    pagesProcessed++;

    if (hitCursor) {
      stopped = "cursor";
      break;
    }

    nextUrl = page.next;
    if (nextUrl) await sleep();
  }

  return {
    cursor_from: cursorIso,
    cursor_advanced_to:
      stopped !== "timeout" && newestSeenIso ? newestSeenIso : null,
    pages_processed: pagesProcessed,
    rows_upserted: rowsUpserted,
    stopped_reason: stopped,
  };
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
  const saved = (stateRow?.value ?? null) as IncrementalCursor | null;

  // Migrate legacy cursor (minifigs-only) to the new shape.
  const setsCursor = saved?.sets?.last_modified_dt ?? baseline;
  const minifigsCursor = saved?.minifigs?.last_modified_dt ??
    saved?.last_modified_dt ?? baseline;

  // 2. Phase A — sets → lego_catalog
  const setsResult = await syncIncrementalEntity<RbSet>(
    apiKey,
    startMs,
    `${RB_BASE}/sets/?page_size=${PAGE_SIZE}&ordering=-last_modified_dt`,
    setsCursor,
    (rows) => upsertCatalogSets(db, rows),
  );

  // Brief pacing between phases to stay under 1 req/s
  if (setsResult.stopped_reason !== "timeout") await sleep();

  // 3. Phase B — minifigs → rebrickable_minifigs (only if we still have time)
  let figsResult: IncrementalEntityResult = {
    cursor_from: minifigsCursor,
    cursor_advanced_to: null,
    pages_processed: 0,
    rows_upserted: 0,
    stopped_reason: "timeout",
  };

  if (Date.now() - startMs <= TIMEOUT_MS) {
    figsResult = await syncIncrementalEntity<RbFig>(
      apiKey,
      startMs,
      `${RB_BASE}/minifigs/?page_size=${PAGE_SIZE}&ordering=-last_modified_dt`,
      minifigsCursor,
      (figs) =>
        upsertBatched(
          db,
          "rebrickable_minifigs",
          figs.map((f) => ({
            fig_num: f.fig_num,
            name: f.name,
            num_parts: f.num_parts,
            img_url: f.img_url,
          })),
          "fig_num",
        ),
    );
  }

  // 4. Persist cursors. Each entity advances independently. If an entity
  //    timed out, its cursor stays put so the next run resumes there.
  const newCursor: IncrementalCursor = {
    sets: {
      last_modified_dt: setsResult.cursor_advanced_to ?? setsCursor,
    },
    minifigs: {
      last_modified_dt: figsResult.cursor_advanced_to ?? minifigsCursor,
    },
    last_run_at: new Date().toISOString(),
  };

  await db.from("sync_state").upsert(
    {
      key: INCREMENTAL_KEY,
      value: newCursor,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key" },
  );

  const hasMore = setsResult.stopped_reason === "timeout" ||
    figsResult.stopped_reason === "timeout";

  return {
    sets: {
      cursor_from: setsResult.cursor_from,
      cursor_advanced_to: setsResult.cursor_advanced_to,
      pages_processed: setsResult.pages_processed,
      catalog_rows_upserted: setsResult.rows_upserted,
      stopped_reason: setsResult.stopped_reason,
    },
    minifigs: {
      cursor_from: figsResult.cursor_from,
      cursor_advanced_to: figsResult.cursor_advanced_to,
      pages_processed: figsResult.pages_processed,
      figs_upserted: figsResult.rows_upserted,
      stopped_reason: figsResult.stopped_reason,
    },
    has_more: hasMore,
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
