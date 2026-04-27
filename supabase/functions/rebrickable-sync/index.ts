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

async function rbFetch<T>(url: string, apiKey: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { Authorization: `key ${apiKey}` },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`Rebrickable ${res.status}: ${await res.text()}`);
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

// ---------------------------------------------------------------------------
// Mode: set — enrich a single set's minifigs
// ---------------------------------------------------------------------------
async function syncSet(
  db: Supabase,
  apiKey: string,
  setNum: string,
): Promise<{
  set_num: string;
  figs_processed: number;
  bricklink_ids_added: number;
}> {
  // 1. Fetch all minifigs for this set (paginated)
  let url: string | null =
    `${RB_BASE}/sets/${setNum}/minifigs/?page_size=${PAGE_SIZE}`;
  const setFigs: RbSetFig[] = [];

  while (url) {
    const page: RbPage<RbSetFig> = await rbFetch<RbPage<RbSetFig>>(url, apiKey);
    setFigs.push(...page.results);
    url = page.next;
    if (url) await sleep();
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

  // 3. Fetch detail for each fig that needs enriching
  let bricklinkAdded = 0;

  for (const figNum of toEnrich) {
    await sleep();
    const fig = await rbFetch<RbFig>(`${RB_BASE}/minifigs/${figNum}/`, apiKey);
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
      default:
        return jsonResponse(
          {
            error:
              `Unknown mode: ${mode}. Expected one of: set | enrich | full`,
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
