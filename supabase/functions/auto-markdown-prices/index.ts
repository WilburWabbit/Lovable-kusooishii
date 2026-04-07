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
    if (!authHeader?.includes(serviceRoleKey) && authHeader !== `Bearer ${serviceRoleKey}`) {
      if (authHeader?.startsWith("Bearer ")) {
        const token = authHeader.replace("Bearer ", "");
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
    for (const row of (feeScheduleRows ?? []) as FeeScheduleRow & { channel: string }[]) {
      const ch = row.channel?.toLowerCase() ?? "ebay";
      if (!feesByChannel.has(ch)) feesByChannel.set(ch, []);
      feesByChannel.get(ch)!.push(row);
    }

    // Load selling cost defaults (packaging)
    const { data: sellingDefaults } = await admin
      .from("selling_cost_defaults")
      .select("key, value")
      .limit(10);

    let packagingCost = 0.50; // default
    for (const d of (sellingDefaults ?? []) as { key: string; value: number }[]) {
      if (d.key === "packaging_cost") packagingCost = d.value;
    }

    // Load shipping rates for floor estimation (cheapest active rate)
    const { data: shippingRates } = await admin
      .from("shipping_rate_table")
      .select("price")
      .eq("active", true)
      .order("price", { ascending: true })
      .limit(1);

    const defaultShippingCost = (shippingRates?.[0] as { price: number } | undefined)?.price ?? 3.50;

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

      // Calculate VAT-aware floor price using real fees and shipping
      const channel = skuChannel.get(skuId) ?? "ebay";
      const fees = feesByChannel.get(channel) ?? [];
      const shippingCost = defaultShippingCost;
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

      // Push price update to external channels (fire-and-forget)
      if (liveListings) {
        for (const listing of liveListings as { id: string; channel: string }[]) {
          if (listing.channel === "ebay") {
            fetch(`${supabaseUrl}/functions/v1/ebay-push-listing`, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${serviceRoleKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                listingId: listing.id,
                action: "update_price",
                newPrice,
              }),
            }).catch((err) =>
              console.warn(`eBay price push for listing ${listing.id} failed (non-blocking):`, err),
            );
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
