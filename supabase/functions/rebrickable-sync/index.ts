import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const RB_BASE = "https://rebrickable.com/api/v3/lego";
const FETCH_TIMEOUT_MS = 30_000;
const RATE_LIMIT_DELAY_MS = 1_100; // 1 req/s rate limit

function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() =>
    clearTimeout(timer)
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceRoleKey);

  try {
    // --- Auth guard: require admin or staff role ---
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
      error: userErr,
    } = await admin.auth.getUser(token);
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: roles } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id);
    const hasAccess = (roles ?? []).some(
      (r: { role: string }) => r.role === "admin" || r.role === "staff",
    );
    if (!hasAccess) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // --- End auth guard ---

    // --- Rebrickable API key ---
    const apiKey = Deno.env.get("REBRICKABLE_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "REBRICKABLE_API_KEY not configured" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const rbHeaders = {
      Authorization: `key ${apiKey}`,
      Accept: "application/json",
    };

    const body = await req.json().catch(() => ({}));
    const mode: string = body.mode || "sets";

    if (mode === "themes") {
      return await syncThemes(admin, rbHeaders);
    } else if (mode === "sets") {
      return await syncSets(admin, rbHeaders, body);
    }

    return new Response(
      JSON.stringify({ error: `Unknown mode: ${mode}` }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    // Mark any pending landing rows as error
    try {
      await admin
        .from("landing_raw_rebrickable")
        .update({
          status: "error",
          error_message: ((err as Error).message || "Unknown error").substring(
            0,
            500,
          ),
          processed_at: new Date().toISOString(),
        })
        .eq("status", "pending");
    } catch {
      /* best effort */
    }
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ─── Theme Sync ───────────────────────────────────────────────
async function syncThemes(
  admin: ReturnType<typeof createClient>,
  rbHeaders: Record<string, string>,
): Promise<Response> {
  const correlationId = crypto.randomUUID();
  const now = new Date().toISOString();

  // Fetch all themes (paginated, typically 1-2 pages)
  const allThemes: Array<{
    id: number;
    name: string;
    parent_id: number | null;
  }> = [];
  let page = 1;

  while (true) {
    const url = `${RB_BASE}/themes/?page_size=1000&page=${page}`;
    const res = await fetchWithTimeout(url, { headers: rbHeaders });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Rebrickable themes API returned ${res.status}: ${txt}`);
    }
    const data = await res.json();

    // Land raw response
    await admin.from("landing_raw_rebrickable").upsert(
      {
        external_id: `themes_page_${page}`,
        entity_type: "themes",
        raw_payload: data,
        status: "pending",
        correlation_id: correlationId,
        received_at: now,
      },
      { onConflict: "entity_type,external_id" },
    );

    const results = data.results || [];
    allThemes.push(...results);

    if (!data.next) break;
    page++;
    await sleep(RATE_LIMIT_DELAY_MS);
  }

  // Pass 1: Upsert all themes (without parent linkage)
  const BATCH = 200;
  let themesUpserted = 0;
  for (let i = 0; i < allThemes.length; i += BATCH) {
    const batch = allThemes.slice(i, i + BATCH).map((t) => ({
      name: t.name,
      slug: slugify(t.name),
      rebrickable_theme_id: t.id,
    }));
    const { error } = await admin.from("theme").upsert(batch, {
      onConflict: "slug",
      ignoreDuplicates: false,
    });
    if (error) {
      console.error(`Theme upsert batch ${i} error:`, error.message);
    } else {
      themesUpserted += batch.length;
    }
  }

  // Pass 2: Update parent_theme_id linkages
  // Build a map of rebrickable_theme_id -> app UUID
  const { data: appThemes } = await admin
    .from("theme")
    .select("id, rebrickable_theme_id")
    .not("rebrickable_theme_id", "is", null);
  const rbIdToUuid = new Map<number, string>();
  for (const t of appThemes || []) {
    if (t.rebrickable_theme_id != null) {
      rbIdToUuid.set(t.rebrickable_theme_id, t.id);
    }
  }

  let parentLinks = 0;
  for (const t of allThemes) {
    if (t.parent_id == null) continue;
    const childUuid = rbIdToUuid.get(t.id);
    const parentUuid = rbIdToUuid.get(t.parent_id);
    if (childUuid && parentUuid) {
      await admin
        .from("theme")
        .update({ parent_theme_id: parentUuid })
        .eq("id", childUuid);
      parentLinks++;
    }
  }

  // Mark landing committed
  await admin
    .from("landing_raw_rebrickable")
    .update({
      status: "committed",
      processed_at: new Date().toISOString(),
    })
    .eq("correlation_id", correlationId)
    .eq("status", "pending");

  // Update sync state
  await admin.from("rebrickable_sync_state").upsert(
    {
      sync_type: "themes",
      last_synced_at: now,
      sets_processed: themesUpserted,
      updated_at: now,
    },
    { onConflict: "sync_type" },
  );

  // Audit event
  await admin.from("audit_event").insert({
    entity_type: "rebrickable_sync",
    entity_id: correlationId,
    trigger_type: "rebrickable_sync",
    actor_type: "system",
    source_system: "rebrickable-sync",
    correlation_id: correlationId,
    after_json: {
      mode: "themes",
      themes_synced: themesUpserted,
      parent_links: parentLinks,
      pages_fetched: page,
    },
  });

  return new Response(
    JSON.stringify({
      mode: "themes",
      themes_synced: themesUpserted,
      parent_links: parentLinks,
      pages_fetched: page,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}

// ─── Sets Sync ────────────────────────────────────────────────
async function syncSets(
  admin: ReturnType<typeof createClient>,
  rbHeaders: Record<string, string>,
  body: Record<string, unknown>,
): Promise<Response> {
  const correlationId = crypto.randomUUID();
  const now = new Date().toISOString();
  const fullSync = body.full_sync === true;
  const sinceParam = body.since as string | undefined;
  const startPage = (body.page as number) || 1;
  const pagesPerRun = (body.pages_per_run as number) || 10;

  // Determine cutoff for incremental sync
  let cutoff: Date | null = null;
  if (sinceParam) {
    // User-provided date cutoff
    cutoff = new Date(sinceParam);
    if (isNaN(cutoff.getTime())) {
      return new Response(
        JSON.stringify({ error: `Invalid since date: ${sinceParam}` }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
  } else if (!fullSync) {
    // Incremental: use stored cutoff
    const { data: state } = await admin
      .from("rebrickable_sync_state")
      .select("last_modified_cutoff")
      .eq("sync_type", "sets")
      .single();
    if (state?.last_modified_cutoff) {
      cutoff = new Date(state.last_modified_cutoff);
    }
    // If no cutoff exists (first run), this becomes a full sync
  }

  // Build theme mapping: rebrickable_theme_id -> app UUID
  const { data: appThemes } = await admin
    .from("theme")
    .select("id, rebrickable_theme_id")
    .not("rebrickable_theme_id", "is", null);
  const themeMap = new Map<number, string>();
  for (const t of appThemes || []) {
    if (t.rebrickable_theme_id != null) {
      themeMap.set(t.rebrickable_theme_id, t.id);
    }
  }

  // Determine ordering: incremental uses -last_modified_dt, full uses set_num
  const ordering = fullSync ? "set_num" : "-last_modified_dt";

  let pagesProcessed = 0;
  let setsUpserted = 0;
  let hasMore = false;
  let nextPage = startPage;
  let totalCount = 0;
  let newestModifiedDt: string | null = null;
  let reachedCutoff = false;

  for (let p = startPage; p < startPage + pagesPerRun; p++) {
    const url =
      `${RB_BASE}/sets/?page_size=1000&page=${p}&ordering=${ordering}`;
    const res = await fetchWithTimeout(url, { headers: rbHeaders });

    if (!res.ok) {
      // 404 means we've gone past the last page
      if (res.status === 404) {
        hasMore = false;
        break;
      }
      const txt = await res.text();
      throw new Error(`Rebrickable sets API returned ${res.status}: ${txt}`);
    }

    const data = await res.json();
    totalCount = data.count || totalCount;

    // Land raw response
    const landingKey = fullSync
      ? `sets_full_page_${p}`
      : sinceParam
        ? `sets_since_${sinceParam}_page_${p}`
        : `sets_incremental_page_${p}`;
    await admin.from("landing_raw_rebrickable").upsert(
      {
        external_id: landingKey,
        entity_type: "sets",
        raw_payload: data,
        status: "pending",
        correlation_id: correlationId,
        received_at: now,
      },
      { onConflict: "entity_type,external_id" },
    );

    const results: Array<Record<string, unknown>> = data.results || [];

    // Track the newest last_modified_dt in this run
    if (results.length > 0 && !newestModifiedDt) {
      const first = results[0];
      if (first.last_modified_dt) {
        newestModifiedDt = first.last_modified_dt as string;
      }
    }

    // Process sets → upsert into lego_catalog
    const catalogRows = [];
    for (const set of results) {
      const setNum = String(set.set_num || "");
      if (!setNum) continue;

      // Check if we've reached the cutoff (incremental/since modes)
      if (cutoff && set.last_modified_dt) {
        const modDt = new Date(set.last_modified_dt as string);
        if (modDt < cutoff) {
          reachedCutoff = true;
          break;
        }
      }

      catalogRows.push({
        mpn: setNum,
        name: (set.name as string) || setNum,
        release_year: set.year ? Number(set.year) : null,
        piece_count: set.num_parts ? Number(set.num_parts) : null,
        img_url: (set.set_img_url as string) || null,
        rebrickable_id: setNum,
        theme_id: set.theme_id ? themeMap.get(Number(set.theme_id)) || null : null,
        product_type: "set",
        status: "active",
      });
    }

    // Batch upsert into lego_catalog
    const BATCH = 500;
    for (let i = 0; i < catalogRows.length; i += BATCH) {
      const batch = catalogRows.slice(i, i + BATCH);
      const { error } = await admin.from("lego_catalog").upsert(batch, {
        onConflict: "mpn",
        ignoreDuplicates: false,
      });
      if (error) {
        console.error(`Catalog upsert batch error:`, error.message);
      } else {
        setsUpserted += batch.length;
      }
    }

    pagesProcessed++;
    hasMore = !!data.next;
    nextPage = p + 1;

    // Stop if we reached the cutoff
    if (reachedCutoff) {
      hasMore = false;
      break;
    }

    // Rate limit delay before next page
    if (data.next && p < startPage + pagesPerRun - 1) {
      await sleep(RATE_LIMIT_DELAY_MS);
    }
  }

  // Mark landing committed
  await admin
    .from("landing_raw_rebrickable")
    .update({
      status: "committed",
      processed_at: new Date().toISOString(),
    })
    .eq("correlation_id", correlationId)
    .eq("status", "pending");

  // Update sync state with the newest modified date from this run
  const stateUpdate: Record<string, unknown> = {
    sync_type: "sets",
    last_synced_at: now,
    sets_processed: setsUpserted,
    updated_at: now,
  };
  if (newestModifiedDt) {
    stateUpdate.last_modified_cutoff = newestModifiedDt;
  }
  await admin.from("rebrickable_sync_state").upsert(stateUpdate, {
    onConflict: "sync_type",
  });

  // Audit event
  await admin.from("audit_event").insert({
    entity_type: "rebrickable_sync",
    entity_id: correlationId,
    trigger_type: "rebrickable_sync",
    actor_type: "system",
    source_system: "rebrickable-sync",
    correlation_id: correlationId,
    after_json: {
      mode: "sets",
      full_sync: fullSync,
      since: sinceParam || null,
      pages_processed: pagesProcessed,
      sets_upserted: setsUpserted,
      total_count: totalCount,
      has_more: hasMore,
    },
  });

  return new Response(
    JSON.stringify({
      mode: "sets",
      full_sync: fullSync,
      since: sinceParam || null,
      incremental: !fullSync && !sinceParam,
      pages_processed: pagesProcessed,
      sets_upserted: setsUpserted,
      total_count: totalCount,
      has_more: hasMore,
      next_page: hasMore ? nextPage : null,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}
