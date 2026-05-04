// Redeployed: 2026-04-07
// ============================================================
// Auto-Markdown Prices
// Cron job: Applies automated price reductions to stale listings.
// Day 30: First markdown (default 10%)
// Day 45: Clearance markdown (default 20%)
// Never breaches VAT-aware floor price (accounts for fees,
// shipping, packaging, and output VAT).
// Called by pg_cron daily — no user auth required.
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";
import { verifyInternalSharedSecret, verifyServiceRoleJWT } from "../_shared/auth.ts";
import { calculateFloorPrice, decomposeFees } from "../_shared/pricing.ts";
import type { FeeScheduleRow } from "../_shared/pricing.ts";

// Defaults — overridden by pricing_settings table if rows exist
const DEFAULTS = {
  first_markdown_days: 30,
  first_markdown_pct: 0.10,
  clearance_markdown_days: 45,
  clearance_markdown_pct: 0.20,
  minimum_margin_target: 0.25,
  min_profit: 0.75,
  risk_reserve_rate: 1.5,
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
    const token = authHeader?.replace("Bearer ", "") ?? "";
    if (!verifyInternalSharedSecret(req) && !verifyServiceRoleJWT(token, supabaseUrl)) {
      if (authHeader?.startsWith("Bearer ")) {
        const { data: { user }, error } = await admin.auth.getUser(token);
        if (error || !user) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
        }
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
    const MIN_MARGIN = cfg.minimum_margin_target;
    const MIN_PROFIT = cfg.min_profit;
    const RISK_RATE = cfg.risk_reserve_rate / 100;

    console.log(`auto-markdown config: first=${FIRST_MARKDOWN_PCT*100}% at ${FIRST_MARKDOWN_DAYS}d, clearance=${CLEARANCE_MARKDOWN_PCT*100}% at ${CLEARANCE_MARKDOWN_DAYS}d, margin=${MIN_MARGIN*100}%`);

    // Load channel fee schedules (keyed by channel)
    const { data: feeScheduleRows } = await admin
      .from("channel_fee_schedule")
      .select("channel, fee_name, rate_percent, fixed_amount, applies_to, min_amount, max_amount")
      .eq("active", true);

    const feesByChannel = new Map<string, FeeScheduleRow[]>();
    for (const row of ((feeScheduleRows ?? []) as unknown as Array<FeeScheduleRow & { channel: string }>)) {
      const ch = row.channel?.toLowerCase() ?? "ebay";
      if (!feesByChannel.has(ch)) feesByChannel.set(ch, []);
      feesByChannel.get(ch)!.push(row);
    }

    // Load selling cost defaults (packaging + shipping settings)
    const { data: sellingDefaults } = await admin
      .from("selling_cost_defaults")
      .select("key, value")
      .limit(20);

    const settingsMap: Record<string, number> = {};
    for (const d of (sellingDefaults ?? []) as { key: string; value: number }[]) {
      settingsMap[d.key] = d.value;
    }
    const packagingCost = settingsMap["packaging_cost"] ?? 0.50;
    const activeTierNum = settingsMap["evri_active_tier"] ?? 1;
    const activeTier = `tier_${activeTierNum}`;
    const preferEvriThreshold = settingsMap["shipping_prefer_evri_threshold"] ?? 1.0;

    // Load Evri direct rates for active tier (default channel)
    const { data: evriDirectRates } = await admin
      .from("shipping_rate_table")
      .select("cost, max_weight_kg, max_length_cm, max_width_cm, max_depth_cm, carrier, size_band")
      .eq("channel", "default")
      .eq("tier", activeTier)
      .eq("destination", "domestic")
      .eq("active", true)
      .order("cost", { ascending: true });

    // Load eBay carrier rates
    const { data: ebayCarrierRates } = await admin
      .from("shipping_rate_table")
      .select("cost, max_weight_kg, max_length_cm, max_width_cm, max_depth_cm, carrier, size_band")
      .eq("channel", "ebay")
      .eq("destination", "domestic")
      .eq("active", true)
      .order("cost", { ascending: true });

    // Default shipping cost: cheapest Evri direct rate
    const defaultShippingCost = (evriDirectRates?.[0] as { cost: number } | undefined)?.cost ?? 2.59;

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

    // Determine channel for each SKU (from live listings)
    const skuIds = [...unitsBySku.keys()];
    const { data: liveListingsForChannel } = await admin
      .from("channel_listing")
      .select("sku_id, channel")
      .in("sku_id", skuIds)
      .eq("v2_status" as never, "live");

    const skuChannel = new Map<string, string>();
    for (const listing of (liveListingsForChannel ?? []) as { sku_id: string; channel: string }[]) {
      if (!skuChannel.has(listing.sku_id)) {
        skuChannel.set(listing.sku_id, listing.channel?.toLowerCase() ?? "ebay");
      }
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
      if (alreadyApplied === "clearance") continue;

      if (!currentPrice || currentPrice <= 0) continue;

      // Calculate VAT-aware floor price using Evri-first shipping strategy
      const channel = skuChannel.get(skuId) ?? "ebay";
      const fees = feesByChannel.get(channel) ?? [];

      // Find best shipping cost using Evri-first logic
      // (simplified: use default Evri rate, check eBay saving)
      let shippingCost = defaultShippingCost;
      if (channel === "ebay" && ebayCarrierRates && ebayCarrierRates.length > 0) {
        const cheapestEbay = Number((ebayCarrierRates[0] as { cost: number }).cost);
        const saving = shippingCost - cheapestEbay;
        if (saving > preferEvriThreshold) {
          shippingCost = cheapestEbay;
        }
      }
      const costBase = group.highestCost + packagingCost + shippingCost;

      const { effectiveFeeRate, fixedFeeCosts } = decomposeFees(fees, shippingCost);

      const floorPrice = calculateFloorPrice({
        costBase,
        minProfit: MIN_PROFIT,
        effectiveFeeRate,
        fixedFeeCosts,
        riskRate: RISK_RATE,
        minMargin: MIN_MARGIN,
        fees,
        shippingCost,
      });

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
