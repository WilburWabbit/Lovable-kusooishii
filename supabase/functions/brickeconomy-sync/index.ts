import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const BE_BASE = "https://www.brickeconomy.com/api/v1";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // --- Auth ---
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await admin.auth.getUser(token);
    if (userError || !user) {
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
      (r: { role: string }) => r.role === "admin" || r.role === "staff"
    );
    if (!hasAccess) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- BrickEconomy API ---
    const apiKey = Deno.env.get("BRICKECONOMY_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "BRICKECONOMY_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const headers = {
      "x-apikey": apiKey,
      "User-Agent": "BrickKeeperSync/1.0",
      Accept: "application/json",
    };

    // Fetch sets and minifigs in parallel
    const [setsRes, minifigsRes] = await Promise.all([
      fetch(`${BE_BASE}/collection/sets?currency=GBP`, { headers }),
      fetch(`${BE_BASE}/collection/minifigs?currency=GBP`, { headers }),
    ]);

    if (!setsRes.ok) {
      const txt = await setsRes.text();
      throw new Error(`BrickEconomy sets endpoint returned ${setsRes.status}: ${txt}`);
    }
    if (!minifigsRes.ok) {
      const txt = await minifigsRes.text();
      throw new Error(`BrickEconomy minifigs endpoint returned ${minifigsRes.status}: ${txt}`);
    }

    const setsRaw = await setsRes.json();
    const minifigsRaw = await minifigsRes.json();

    // --- Step 1: Land raw payloads ---
    const correlationId = crypto.randomUUID();
    const now = new Date().toISOString();

    const { data: setsLanding } = await admin
      .from("landing_raw_brickeconomy")
      .upsert(
        {
          external_id: "collection_sets",
          entity_type: "collection_sets",
          raw_payload: setsRaw,
          status: "pending",
          correlation_id: correlationId,
          received_at: now,
        },
        { onConflict: "external_id" }
      )
      .select("id")
      .single();

    const { data: minifigsLanding } = await admin
      .from("landing_raw_brickeconomy")
      .upsert(
        {
          external_id: "collection_minifigs",
          entity_type: "collection_minifigs",
          raw_payload: minifigsRaw,
          status: "pending",
          correlation_id: correlationId,
          received_at: now,
        },
        { onConflict: "external_id" }
      )
      .select("id")
      .single();

    console.log(`Landed BrickEconomy payloads: sets=${setsLanding?.id}, minifigs=${minifigsLanding?.id}`);

    // --- Step 2: Process to canonical tables ---
    // Unwrap the data envelope
    const setsData = setsRaw.data ?? setsRaw;
    const minifigsData = minifigsRaw.data ?? minifigsRaw;

    // --- Process sets ---
    const setItems = (setsData.sets ?? []).map((item: Record<string, unknown>) => ({
      item_type: "set",
      item_number: String(item.set_number ?? ""),
      name: item.name ?? null,
      theme: item.theme ?? null,
      subtheme: item.subtheme ?? null,
      year: item.year ?? null,
      pieces_count: item.pieces_count ?? null,
      minifigs_count: item.minifigs_count ?? null,
      condition: item.condition ?? null,
      collection_name: item.collection_name ?? null,
      acquired_date: item.aquired_date ?? null, // API typo
      paid_price: item.paid_price ?? null,
      current_value: item.current_value ?? null,
      growth: item.growth ?? null,
      retail_price: item.retail_price ?? null,
      released_date: item.released_date ?? null,
      retired_date: item.retired_date ?? null,
      currency: "GBP",
      synced_at: now,
    }));

    // --- Process minifigs ---
    const minifigItems = (minifigsData.minifigs ?? []).map((item: Record<string, unknown>) => ({
      item_type: "minifig",
      item_number: String(item.minifig_number ?? ""),
      name: item.name ?? null,
      theme: item.theme ?? null,
      subtheme: item.subtheme ?? null,
      year: item.year ?? null,
      pieces_count: item.pieces_count ?? null,
      minifigs_count: null,
      condition: item.condition ?? null,
      collection_name: item.collection_name ?? null,
      acquired_date: item.aquired_date ?? null, // API typo
      paid_price: item.paid_price ?? null,
      current_value: item.current_value ?? null,
      growth: item.growth ?? null,
      retail_price: item.retail_price ?? null,
      released_date: item.released_date ?? null,
      retired_date: item.retired_date ?? null,
      currency: "GBP",
      synced_at: now,
    }));

    // --- Full replace: delete then insert ---
    await admin.from("brickeconomy_collection").delete().neq("id", "00000000-0000-0000-0000-000000000000");

    const allItems = [...setItems, ...minifigItems];
    let insertErrors = 0;
    // Insert in batches of 100
    for (let i = 0; i < allItems.length; i += 100) {
      const batch = allItems.slice(i, i + 100);
      const { error } = await admin.from("brickeconomy_collection").insert(batch);
      if (error) {
        console.error("Insert batch error:", error.message);
        insertErrors++;
      }
    }

    // --- Portfolio snapshots (upsert by snapshot_type) ---
    await admin.from("brickeconomy_portfolio_snapshot").delete().neq("id", "00000000-0000-0000-0000-000000000000");

    const snapshots = [];
    if (setsData.sets_count !== undefined || setsData.sets_unique_count !== undefined) {
      snapshots.push({
        snapshot_type: "sets",
        total_count: setsData.sets_count ?? setItems.length,
        unique_count: setsData.sets_unique_count ?? null,
        current_value: setsData.current_value ?? null,
        currency: "GBP",
        period_data: setsData.periods ?? null,
        synced_at: now,
      });
    }
    if (minifigsData.minifigs_count !== undefined || minifigsData.minifigs_unique_count !== undefined) {
      snapshots.push({
        snapshot_type: "minifigs",
        total_count: minifigsData.minifigs_count ?? minifigItems.length,
        unique_count: minifigsData.minifigs_unique_count ?? null,
        current_value: minifigsData.current_value ?? null,
        currency: "GBP",
        period_data: minifigsData.periods ?? null,
        synced_at: now,
      });
    }
    if (snapshots.length > 0) {
      await admin.from("brickeconomy_portfolio_snapshot").insert(snapshots);
    }

    // --- Enrich lego_catalog.brickeconomy_id where set_number matches mpn ---
    let catalogMatches = 0;
    for (const item of setItems) {
      if (!item.item_number) continue;
      const mpnVariants = [item.item_number];
      if (!item.item_number.includes("-")) {
        mpnVariants.push(`${item.item_number}-1`);
      }
      
      const { data: matched, error: matchErr } = await admin
        .from("lego_catalog")
        .select("id, brickeconomy_id")
        .in("mpn", mpnVariants)
        .is("brickeconomy_id", null)
        .limit(1);

      if (!matchErr && matched && matched.length > 0) {
        await admin
          .from("lego_catalog")
          .update({ brickeconomy_id: item.item_number })
          .eq("id", matched[0].id);
        catalogMatches++;
      }
    }

    // --- Step 3: Mark landing rows as committed ---
    const landingIds = [setsLanding?.id, minifigsLanding?.id].filter(Boolean);
    if (landingIds.length > 0) {
      await admin.from("landing_raw_brickeconomy").update({
        status: "committed",
        processed_at: new Date().toISOString(),
      }).in("id", landingIds);
    }

    return new Response(
      JSON.stringify({
        sets_synced: setItems.length,
        minifigs_synced: minifigItems.length,
        catalog_matches: catalogMatches,
        insert_errors: insertErrors,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    // Try to mark landing rows as error
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const errAdmin = createClient(supabaseUrl, serviceRoleKey);
      await errAdmin.from("landing_raw_brickeconomy").update({
        status: "error",
        error_message: ((err as Error).message || "Unknown error").substring(0, 500),
        processed_at: new Date().toISOString(),
      }).eq("status", "pending");
    } catch { /* best effort */ }
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
