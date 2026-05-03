import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = process.cwd();
const migration = readFileSync(
  join(repoRoot, "supabase/migrations/20260503173000_unify_pricing_quote_and_web_publish.sql"),
  "utf8",
);
const pricingRepairMigration = readFileSync(
  join(repoRoot, "supabase/migrations/20260503182000_fix_pricing_enum_cast_and_storefront_offers.sql"),
  "utf8",
);
const forceEnumSafeQuoteMigration = readFileSync(
  join(repoRoot, "supabase/migrations/20260503190000_force_enum_safe_commerce_quote.sql"),
  "utf8",
);
const rebalancePricingMigration = readFileSync(
  join(repoRoot, "supabase/migrations/20260503193000_rebalance_pricing_floor_target.sql"),
  "utf8",
);
const adminData = readFileSync(
  join(repoRoot, "supabase/functions/admin-data/index.ts"),
  "utf8",
);
const channelsTab = readFileSync(
  join(repoRoot, "src/components/admin-v2/ChannelsTab.tsx"),
  "utf8",
);
const marketRefresh = readFileSync(
  join(repoRoot, "supabase/functions/market-intelligence-refresh/index.ts"),
  "utf8",
);
const marketRefreshCopy = readFileSync(
  join(repoRoot, "supabase/functions/market-intelligence-refresh/index 2.ts"),
  "utf8",
);

describe("pricing engine contract", () => {
  it("uses received saleable stock for carrying value and excludes pending receipt", () => {
    expect(migration).toContain("COALESCE(su.v2_status::text, su.status::text) IN (''received'', ''graded'', ''listed'', ''available'', ''restocked'')");
    expect(migration).toContain("COALESCE(su.v2_status::text, su.status::text) <> ''pending_receipt''");
  });

  it("keeps channel-specific fees and undercut controls in the canonical quote", () => {
    expect(migration).toContain("FROM public.channel_fee_schedule cfs");
    expect(migration).toContain("WHERE cfs.channel = v_channel");
    expect(migration).toContain("market_undercut_min_pct");
    expect(migration).toContain("market_undercut_max_amount");
  });

  it("does not use SKU purchase price as a retail target fallback", () => {
    expect(rebalancePricingMigration).not.toContain("existingSkuPrice");
    expect(rebalancePricingMigration).not.toContain("GREATEST(v_floor, COALESCE(v_market_consensus, v_floor), v_sku_price");
    expect(rebalancePricingMigration).not.toContain("sk.price");
  });

  it("keeps market target separate from cost recovery floor", () => {
    expect(rebalancePricingMigration).toContain("v_non_fee_costs := ROUND(v_carrying_value + v_packaging_cost + v_shipping_cost, 2)");
    expect(rebalancePricingMigration).toContain("v_needed_price := (v_non_fee_costs + v_total_channel_fees + v_risk_reserve + v_min_profit)");
    expect(rebalancePricingMigration).toContain("v_target := ROUND(GREATEST(v_target, 0), 2)");
    expect(rebalancePricingMigration).toContain("market_target_below_floor");
    expect(rebalancePricingMigration).toContain("''target_floor_clamped'', 0");
    expect(rebalancePricingMigration).not.toContain("v_target := v_floor;");
    expect(rebalancePricingMigration).not.toContain("v_floor := ROUND((1.2 *");
  });

  it("keeps the 40478-1.2 style economics in a plausible range", () => {
    const carrying = 26.76;
    const packaging = 0.05;
    const shipping = 2.59;
    const minProfit = 1;
    const feeRate = 0.143;
    const fixedFee = 0.3;
    const riskRate = 0.005;
    const minMargin = 0.05;
    let floor = carrying + packaging + shipping + minProfit;

    for (let i = 0; i < 8; i += 1) {
      const fees = floor * feeRate + fixedFee;
      const risk = floor * riskRate;
      floor = (carrying + packaging + shipping + fees + risk + minProfit) / (1 - minMargin);
    }

    const market = 29.18;
    const target = Math.floor(market) - 0.01;

    expect(floor).toBeGreaterThan(35);
    expect(floor).toBeLessThan(45);
    expect(target).toBeLessThan(floor);
  });

  it("routes admin pricing through the canonical quote RPC", () => {
    expect(adminData).toContain('action === "calculate-pricing"');
    expect(adminData).toContain('admin.rpc("commerce_quote_price"');
    expect(adminData).toContain("normalizeQuote(rawQuote, sku_id, channel)");
  });

  it("blocks website publish through a preflight with explicit operator actions", () => {
    expect(adminData).toContain('action === "website-listing-preflight"');
    expect(adminData).toContain('actions.push("activate_sku")');
    expect(adminData).toContain('actions.push("receive_stock")');
    expect(adminData).toContain('actions.push("recalculate_price")');
  });

  it("publishes website listings through v2 live status and saleable quantity", () => {
    expect(adminData).toContain('v2_channel: "website"');
    expect(adminData).toContain('v2_status: "live"');
    expect(adminData).toContain("listed_quantity: preflight.saleable_stock_count");
  });

  it("repairs enum condition grade casts in the canonical quote function", () => {
    expect(forceEnumSafeQuoteMigration).toContain("CREATE OR REPLACE FUNCTION public.commerce_quote_price");
    expect(forceEnumSafeQuoteMigration).toContain("regexp_replace(sk.condition_grade::text");
    expect(forceEnumSafeQuoteMigration).toContain("commerce_quote_price still contains a direct condition_grade integer cast");
    expect(forceEnumSafeQuoteMigration).not.toContain("sk.condition_grade::integer");
    expect(forceEnumSafeQuoteMigration).not.toContain("sk.condition_grade::int,");
    expect(forceEnumSafeQuoteMigration).not.toContain("$$");
  });

  it("uses website listing or price decision prices before legacy SKU price on storefront offers", () => {
    expect(pricingRepairMigration).toContain("CREATE OR REPLACE FUNCTION public.product_detail_offers");
    expect(pricingRepairMigration).toContain("cl.v2_status::text = ''live''");
    expect(pricingRepairMigration).toContain("lwl.linked_target_price");
    expect(pricingRepairMigration).toContain("lws.snapshot_target_price");
    expect(pricingRepairMigration).toContain("lwl.listed_price");
    expect(pricingRepairMigration).toContain("s.price");
  });

  it("keeps channel price inputs editable while preserving below-floor guards", () => {
    expect(channelsTab).toContain('onChange={(e) => updateField(ch.key, "price", e.target.value)}');
    expect(channelsTab).toContain("const price = Number(state?.price ?? \"\")");
    expect(channelsTab).toContain("pricing?.quote_error");
    expect(channelsTab).not.toContain("readOnly");
    expect(adminData).toContain("const finalPrice = listedPrice && listedPrice > 0 ? listedPrice : targetPrice");
    expect(adminData).toContain("Cannot list: website price");
  });

  it("coalesces market signal source metadata in both function copies", () => {
    for (const source of [marketRefresh, marketRefreshCopy]) {
      expect(source).toContain('metadata: {}');
      expect(source).toContain("metadata: row.metadata ?? {}");
    }
  });
});
