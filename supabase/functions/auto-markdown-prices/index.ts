// Redeployed: 2026-03-23
// ============================================================
// Auto-Markdown Prices
// Cron job: Applies automated price reductions to stale listings.
// Day 30: First markdown (default 10%)
// Day 45: Clearance markdown (default 20%)
// Never breaches floor price (highestLandedCost * 1.25).
// Called by pg_cron daily — no user auth required.
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";

// Defaults — overridden by pricing_settings table if rows exist
const DEFAULTS = {
  first_markdown_days: 30,
  first_markdown_pct: 0.10,
  clearance_markdown_days: 45,
  clearance_markdown_pct: 0.20,
  minimum_margin_target: 0.25,
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRoleKey);

    // Verify service role or admin auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.includes(serviceRoleKey) && authHeader !== `Bearer ${serviceRoleKey}`) {
      if (authHeader?.startsWith("Bearer ")) {
        const token = authHeader.replace("Bearer ", "");
        const { data: { user }, error } = await admin.auth.getUser(token);
        if (error || !user) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
        }
        // Enforce admin/staff role
        const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", user.id);
        const hasAccess = (roles ?? []).some((r: { role: string }) => r.role === "admin" || r.role === "staff");
        if (!hasAccess) {
          return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
        }
      } else {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
      }
    }

    const now = new Date();

    // Load configurable thresholds from pricing_settings table
    const { data: settingsRows } = await admin
      .from("pricing_settings")
      .select("key, value");

    const cfg = { ...DEFAULTS };
    for (const row of ((settingsRows ?? []) as { key: string; value: number }[])) {
      if (row.key in cfg) {
        (cfg as Record<string, number>)[row.key] = row.value;
      }
    }

    const FIRST_MARKDOWN_DAYS = cfg.first_markdown_days;
    const FIRST_MARKDOWN_PCT = cfg.first_markdown_pct;
    const CLEARANCE_MARKDOWN_DAYS = cfg.clearance_markdown_days;
    const CLEARANCE_MARKDOWN_PCT = cfg.clearance_markdown_pct;
    const MARGIN_TARGET = cfg.minimum_margin_target;

    console.log(`auto-markdown config: first=${FIRST_MARKDOWN_PCT*100}% at ${FIRST_MARKDOWN_DAYS}d, clearance=${CLEARANCE_MARKDOWN_PCT*100}% at ${CLEARANCE_MARKDOWN_DAYS}d, margin=${MARGIN_TARGET*100}%`);

    // Find listed stock units with their SKU and landed cost
    const { data: listedUnits, error: queryErr } = await admin
      .from("stock_unit")
      .select("id, sku_id, mpn, listed_at, landed_cost")
      .eq("v2_status" as never, "listed")
      .not("listed_at", "is", null);

    if (queryErr) throw new Error(`Query failed: ${queryErr.message}`);
    if (!listedUnits || listedUnits.length === 0) {
      console.log("No listed units to check for markdown");
      return new Response(
        JSON.stringify({ success: true, markdownCount: 0 }),
        { headers: { "Content-Type": "application/json" } },
      );
    }

    // Group units by SKU to determine highest landed cost per variant
    const unitsBySku = new Map<string, { units: typeof listedUnits; highestCost: number }>();
    for (const unit of listedUnits) {
      const skuId = unit.sku_id as string;
      if (!skuId) continue;

      const group = unitsBySku.get(skuId) ?? { units: [], highestCost: 0 };
      group.units.push(unit);
      const cost = (unit.landed_cost as number) ?? 0;
      if (cost > group.highestCost) group.highestCost = cost;
      unitsBySku.set(skuId, group);
    }

    // Track markdowns applied
    const markdowns: { skuId: string; type: string; oldPrice: number; newPrice: number; floorPrice: number }[] = [];

    for (const [skuId, group] of unitsBySku) {
      // Check if any unit in this SKU has been listed long enough
      let oldestListedDays = 0;
      for (const unit of group.units) {
        const listedAt = new Date(unit.listed_at as string);
        const daysSinceListed = Math.floor((now.getTime() - listedAt.getTime()) / (1000 * 60 * 60 * 24));
        if (daysSinceListed > oldestListedDays) oldestListedDays = daysSinceListed;
      }

      if (oldestListedDays < FIRST_MARKDOWN_DAYS) continue;

      // Determine markdown percentage
      let markdownPct: number;
      let markdownType: string;
      if (oldestListedDays >= CLEARANCE_MARKDOWN_DAYS) {
        markdownPct = CLEARANCE_MARKDOWN_PCT;
        markdownType = "clearance";
      } else {
        markdownPct = FIRST_MARKDOWN_PCT;
        markdownType = "first";
      }

      // Fetch current SKU price
      const { data: sku } = await admin
        .from("sku")
        .select("price, v2_markdown_applied")
        .eq("id", skuId)
        .single();

      if (!sku) continue;

      const currentPrice = (sku as Record<string, unknown>).price as number | null;
      const alreadyApplied = (sku as Record<string, unknown>).v2_markdown_applied as string | null;

      // Skip if this markdown level already applied
      if (alreadyApplied === markdownType) continue;
      if (alreadyApplied === "clearance") continue; // Already at deepest markdown

      if (!currentPrice || currentPrice <= 0) continue;

      // Calculate floor price
      const floorPrice = Math.round(group.highestCost * (1 + MARGIN_TARGET) * 100) / 100;

      // Calculate new price
      const reduction = Math.round(currentPrice * markdownPct * 100) / 100;
      let newPrice = Math.round((currentPrice - reduction) * 100) / 100;

      // Floor price guardrail
      if (newPrice < floorPrice) {
        newPrice = floorPrice;
      }

      // Skip if price wouldn't actually change
      if (newPrice >= currentPrice) continue;

      // Apply markdown to SKU price
      const { error: updateErr } = await admin
        .from("sku")
        .update({
          price: newPrice,
          v2_markdown_applied: markdownType,
        } as never)
        .eq("id", skuId);

      if (updateErr) {
        console.error(`Failed to markdown SKU ${skuId}:`, updateErr);
        continue;
      }

      // Cascade: update all live channel listings for this SKU
      const { data: liveListings } = await admin
        .from("channel_listing")
        .update({
          listed_price: newPrice,
          fee_adjusted_price: newPrice,
        } as never)
        .eq("sku_id", skuId)
        .eq("v2_status" as never, "live")
        .select("id, channel");

      // Queue price updates through the listing orchestrator outbox.
      if (liveListings) {
        for (const listing of liveListings as { id: string; channel: string }[]) {
          const { error: snapshotErr } = await admin.rpc("create_price_decision_snapshot", {
            p_sku_id: skuId,
            p_channel: listing.channel,
            p_channel_listing_id: listing.id,
            p_candidate_price: newPrice,
          });

          if (snapshotErr) {
            console.warn(`Failed to snapshot markdown price for listing ${listing.id}: ${snapshotErr.message}`);
            continue;
          }

          const { error: commandErr } = await admin.rpc("queue_listing_command", {
            p_channel_listing_id: listing.id,
            p_command_type: "reprice",
          });

          if (commandErr) {
            console.warn(`Failed to queue markdown reprice for listing ${listing.id}: ${commandErr.message}`);
          }
        }
      }

      markdowns.push({
        skuId,
        type: markdownType,
        oldPrice: currentPrice,
        newPrice,
        floorPrice,
      });

      console.log(
        `Markdown ${markdownType}: SKU ${skuId} £${currentPrice.toFixed(2)} → £${newPrice.toFixed(2)} ` +
        `(floor: £${floorPrice.toFixed(2)}, ${oldestListedDays} days listed, ` +
        `${(liveListings ?? []).length} channel listings updated)`,
      );
    }

    console.log(`Applied ${markdowns.length} markdowns`);

    return new Response(
      JSON.stringify({
        success: true,
        markdownCount: markdowns.length,
        markdowns,
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("auto-markdown-prices error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
