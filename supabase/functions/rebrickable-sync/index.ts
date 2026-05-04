// Rebrickable sync — modes: set | enrich | full
// Redeployed: 2026-04-27
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";
import { verifyServiceRoleJWT } from "../_shared/auth.ts";
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
  blCreds: BlCreds | null,
): Promise<{
  set_num: string;
  figs_processed: number;
  bricklink_ids_added: number;
  figs_skipped?: number;
  catalog_updated: boolean;
  inventory_id: number | null;
  inventory_links_written: number;
  bricklink_error?: string | null;
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

  // 2. Look up what we already know in rebrickable_minifigs (names + existing
  //    bricklink_ids). We use the names from Rebrickable (or from the set-fig
  //    rows when not yet stored) to match BrickLink subset entries by name.
  const { data: existing, error } = await db
    .from("rebrickable_minifigs")
    .select("fig_num, name, bricklink_id")
    .in("fig_num", figNums);
  if (error) {
    throw new Error(`rebrickable_minifigs select: ${error.message}`);
  }

  const existingByFig = new Map<
    string,
    { name: string | null; bricklink_id: string | null }
  >();
  for (const r of (existing ?? []) as Array<{
    fig_num: string;
    name: string | null;
    bricklink_id: string | null;
  }>) {
    existingByFig.set(r.fig_num, {
      name: r.name,
      bricklink_id: r.bricklink_id,
    });
  }

  // 3. Fetch this set's minifig list from BrickLink (the source of truth for
  //    the BrickLink MPN, e.g. "sw0001"). One signed call per set.
  let bricklinkAdded = 0;
  let skipped = 0;
  let blMinifigs: BlMinifig[] | null = null;
  let bricklinkError: string | null = null;

  if (blCreds) {
    try {
      blMinifigs = await fetchSetMinifigs(setNum, blCreds);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`syncSet(${setNum}): BrickLink fetch failed: ${msg}`);
      bricklinkError = msg;
      blMinifigs = null;
    }
  } else {
    bricklinkError = "BrickLink credentials missing";
    console.warn(
      `syncSet(${setNum}): BrickLink credentials missing — bricklink_id won't be populated`,
    );
  }

  // Build a name → BrickLink minifig index from the BrickLink response. Each
  // BrickLink entry can be claimed once (handles sets that include duplicates
  // of the same fig). We keep the original name + derive a deterministic
  // catalog image URL so we can mirror BrickLink's data over the Rebrickable
  // placeholders.
  const blByName = new Map<string, BlMinifig[]>();
  if (blMinifigs) {
    for (const m of blMinifigs) {
      const key = normalizeMinifigName(m.name);
      const arr = blByName.get(key) ?? [];
      arr.push(m);
      blByName.set(key, arr);
    }
  }

  // BrickLink hosts catalog images at a deterministic path. Using the
  // canonical CDN means we don't need an extra signed API call per minifig.
  const brickLinkImageUrl = (no: string): string =>
    `https://img.bricklink.com/ItemImage/MN/0/${encodeURIComponent(no)}.png`;

  // Always upsert every fig — even ones that already had a bricklink_id —
  // so a re-run of "Sync Single Set" can refresh the name and image from
  // BrickLink (the source of truth for what the listing should show).
  for (const fig of figNums) {
    const known = existingByFig.get(fig);
    const setRow = setFigPairs.find((p) => p.fig_num === fig)?.row;
    const rebrickableName = known?.name ?? setRow?.set_name ?? fig;
    const rebrickableImg = setRow?.set_img_url ?? null;

    // Try to match on normalised name against the BrickLink list. If the
    // fig already has a bricklink_id, prefer re-using it so we don't
    // accidentally re-claim a different BrickLink entry.
    let blMatch: BlMinifig | null = null;
    if (known?.bricklink_id && blMinifigs) {
      blMatch =
        blMinifigs.find((m) => m.no === known.bricklink_id) ?? null;
    }
    if (!blMatch && blByName.size > 0) {
      const candidates = blByName.get(normalizeMinifigName(rebrickableName));
      if (candidates && candidates.length > 0) {
        blMatch = candidates.shift() ?? null;
      }
    }

    // When BrickLink has the fig, prefer its name + image. Otherwise fall
    // back to whatever Rebrickable gave us so the row is still usable.
    const finalName = blMatch?.name ?? rebrickableName;
    const finalImg = blMatch ? brickLinkImageUrl(blMatch.no) : rebrickableImg;
    const finalBricklinkId = blMatch?.no ?? known?.bricklink_id ?? null;

    const { error: upsertErr } = await db
      .from("rebrickable_minifigs")
      .upsert(
        {
          fig_num: fig,
          name: finalName,
          img_url: finalImg,
          bricklink_id: finalBricklinkId,
        },
        { onConflict: "fig_num" },
      );
    if (upsertErr) throw new Error(`minifig upsert: ${upsertErr.message}`);
    if (blMatch && !known?.bricklink_id) bricklinkAdded++;
    else if (!blMatch) skipped++;
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
    bricklink_error: bricklinkError,
  };
}

// ---------------------------------------------------------------------------
// Mode: enrich — pure BrickLink path. For every stocked LEGO set
// (product.ebay_category_id = '19006'), call BrickLink's subset endpoint to
// fetch the minifig list and persist:
//   • rebrickable_minifigs row per minifig (fig_num = bricklink_id, e.g.
//     "sw0001"), with a constructed BrickLink thumbnail URL
//   • rebrickable_inventories row (version 1) for the set
//   • rebrickable_inventory_minifigs link rows (replaces existing links)
// Rebrickable is NOT consulted in this mode. Sets whose minifig links were
// last written more recently are deprioritised so resumed runs progress.
// ---------------------------------------------------------------------------
const BL_MINIFIG_IMG = (no: string) =>
  `https://img.bricklink.com/ItemImage/MN/0/${no}.png`;
const BL_RATE_MS = 250; // BrickLink allows ~5 req/sec; one call per set

async function enrichMode(
  db: Supabase,
  _apiKey: string, // unused — kept for signature parity
  startMs: number,
  blCreds: BlCreds | null,
): Promise<Record<string, unknown>> {
  if (!blCreds) {
    return {
      sets_processed: 0,
      sets_total: 0,
      figs_processed: 0,
      bricklink_minifigs_upserted: 0,
      inventory_links_written: 0,
      has_more: false,
      errors: [
        {
          set_num: "",
          error: "BrickLink credentials missing — cannot enrich",
          source: "bricklink",
        },
      ],
      error_count: 1,
    };
  }

  // 1. Stocked MPNs whose product is in eBay category 19006 (LEGO sets).
  const { data: rows, error } = await db
    .from("product")
    .select("mpn, ebay_category_id, sku!inner(stock_unit!inner(id))")
    .eq("ebay_category_id", "19006")
    .not("mpn", "is", null);
  if (error) throw new Error(`stocked product select: ${error.message}`);

  const stockedMpns = Array.from(
    new Set(
      (rows ?? [])
        .map((r: { mpn: string }) => r.mpn)
        .filter((m: string | null): m is string => Boolean(m)),
    ),
  );

  // 2. Order: sets without a v1 inventory row yet first, then oldest-touched.
  const { data: invRows } = await db
    .from("rebrickable_inventories")
    .select("set_num")
    .in("set_num", stockedMpns)
    .eq("version", 1);
  const alreadyLinked = new Set<string>(
    (invRows ?? []).map((r: { set_num: string }) => r.set_num),
  );
  const missing = stockedMpns.filter((m) => !alreadyLinked.has(m));
  const linked = stockedMpns.filter((m) => alreadyLinked.has(m));
  const setNums = [...missing, ...linked];

  let setsProcessed = 0;
  let figsProcessed = 0;
  let minifigsUpserted = 0;
  let inventoryLinksWritten = 0;
  const errors: Array<{ set_num: string; error: string; source: string }> = [];

  for (const setNum of setNums) {
    if (Date.now() - startMs > TIMEOUT_MS) break;
    try {
      const figs = await fetchSetMinifigs(setNum, blCreds);
      if (figs === null) {
        // BrickLink 404 — no subset data available for this set
        errors.push({
          set_num: setNum,
          error: "Set not found on BrickLink",
          source: "bricklink",
        });
        setsProcessed++;
        await sleep(BL_RATE_MS);
        continue;
      }

      // Upsert rebrickable_minifigs (one row per BrickLink minifig). Use the
      // BrickLink MPN as fig_num so links + view stay consistent.
      if (figs.length > 0) {
        const figRows = figs.map((f) => ({
          fig_num: f.no,
          name: f.name,
          num_parts: 0,
          img_url: BL_MINIFIG_IMG(f.no),
          bricklink_id: f.no,
        }));
        const { error: figErr } = await db
          .from("rebrickable_minifigs")
          .upsert(figRows, { onConflict: "fig_num" });
        if (figErr) throw new Error(`minifig upsert: ${figErr.message}`);
        minifigsUpserted += figRows.length;
      }

      // Resolve / create the inventory row for this set, then replace links.
      const { data: invIdData, error: invErr } = await db.rpc(
        "get_or_create_rebrickable_inventory",
        { p_set_num: setNum, p_version: 1 },
      );
      if (invErr) throw invErr;
      const inventoryId = (invIdData as number | null) ?? null;

      if (inventoryId !== null) {
        const { error: delErr } = await db
          .from("rebrickable_inventory_minifigs")
          .delete()
          .eq("inventory_id", inventoryId);
        if (delErr) throw delErr;

        if (figs.length > 0) {
          // Sum quantities per BrickLink no (collapse duplicates)
          const qtyByNo = new Map<string, number>();
          for (const f of figs) {
            qtyByNo.set(f.no, (qtyByNo.get(f.no) ?? 0) + (f.quantity ?? 1));
          }
          const linkRows = Array.from(qtyByNo.entries()).map(([no, qty]) => ({
            inventory_id: inventoryId,
            fig_num: no,
            quantity: qty,
          }));
          const { error: insErr } = await db
            .from("rebrickable_inventory_minifigs")
            .insert(linkRows);
          if (insErr) throw insErr;
          inventoryLinksWritten += linkRows.length;
        }
      }

      figsProcessed += figs.length;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`enrich: ${setNum}: ${msg}`);
      errors.push({ set_num: setNum, error: msg, source: "bricklink" });
    }
    setsProcessed++;
    await sleep(BL_RATE_MS);
  }

  return {
    sets_processed: setsProcessed,
    sets_total: setNums.length,
    sets_missing_links_before: missing.length,
    figs_processed: figsProcessed,
    bricklink_minifigs_upserted: minifigsUpserted,
    inventory_links_written: inventoryLinksWritten,
    has_more: setsProcessed < setNums.length,
    errors,
    error_count: errors.length,
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
  supabaseUrl: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (!authHeader?.startsWith("Bearer ")) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }
  const token = authHeader.replace("Bearer ", "");

  // Service-role bypass (used by pg_cron)
  if (verifyServiceRoleJWT(token, supabaseUrl)) return { ok: true };

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
      supabaseUrl,
    );
    if (!auth.ok) {
      return jsonResponse({ error: auth.error }, auth.status);
    }

    const body = await req.json().catch(() => ({}));
    const { mode, set_num } = body as { mode?: string; set_num?: string };

    const blCreds = getBlCreds();

    let result: Record<string, unknown>;

    switch (mode) {
      case "set":
        if (!set_num || typeof set_num !== "string") {
          return jsonResponse(
            { error: "set_num is required for mode: set" },
            400,
          );
        }
        result = await syncSet(db, apiKey, set_num.trim(), blCreds);
        break;
      case "enrich":
        result = await enrichMode(db, apiKey, startMs, blCreds);
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
