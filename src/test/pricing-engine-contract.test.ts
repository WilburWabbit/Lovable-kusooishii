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
const priceTransparencyMigration = readFileSync(
  join(repoRoot, "supabase/migrations/20260505103000_price_transparency_pool_wac.sql"),
  "utf8",
);
const vatPriceTransparencyMigration = readFileSync(
  join(repoRoot, "supabase/migrations/20260505124500_price_transparency_vat_position.sql"),
  "utf8",
);
const riskReservePercentFixMigration = readFileSync(
  join(repoRoot, "supabase/migrations/20260505133000_fix_vat_risk_reserve_percent_regression.sql"),
  "utf8",
);
const correctedVatPricingMigration = readFileSync(
  join(repoRoot, "supabase/migrations/20260505143000_correct_pricing_floor_target_vat.sql"),
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
const channelListingsHook = readFileSync(
  join(repoRoot, "src/hooks/admin/use-channel-listings.ts"),
  "utf8",
);
const productDetail = readFileSync(
  join(repoRoot, "src/components/admin-v2/ProductDetail.tsx"),
  "utf8",
);
const sourceValuesPanel = readFileSync(
  join(repoRoot, "src/components/admin-v2/SourceValuesPanel.tsx"),
  "utf8",
);
const channelValueMatrix = readFileSync(
  join(repoRoot, "src/components/admin-v2/ChannelValueMatrix.tsx"),
  "utf8",
);
const canonicalResolver = readFileSync(
  join(repoRoot, "supabase/functions/_shared/canonical-resolver.ts"),
  "utf8",
);
const multiSourceSync = readFileSync(
  join(repoRoot, "supabase/functions/_shared/multi-source-sync.ts"),
  "utf8",
);
const pricingTransparencyTab = readFileSync(
  join(repoRoot, "src/components/admin-v2/PricingTransparencyTab.tsx"),
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

  it("switches the authoritative floor basis to pooled WAC while exposing highest-unit risk", () => {
    expect(priceTransparencyMigration).toContain("basis_strategy'', ''pool_wac");
    expect(priceTransparencyMigration).toContain("AVG(NULLIF(COALESCE(su.carrying_value, su.landed_cost, 0), 0))");
    expect(priceTransparencyMigration).toContain("MAX(COALESCE(su.carrying_value, su.landed_cost, 0))");
    expect(priceTransparencyMigration).toContain("highest_unit_carrying_value");
    expect(priceTransparencyMigration).toContain("v_non_fee_costs := ROUND(v_pooled_carrying_value + v_packaging_cost + v_delivery_cost, 2)");
  });

  it("stores full explanation data with durable price snapshots", () => {
    expect(priceTransparencyMigration).toContain("floor_contributors");
    expect(priceTransparencyMigration).toContain("target_contributors");
    expect(priceTransparencyMigration).toContain("cost_basis");
    expect(priceTransparencyMigration).toContain("''pool_wac_transparency_v1''");
    expect(priceTransparencyMigration).toContain("CREATE OR REPLACE VIEW public.v_price_transparency_current");
    expect(priceTransparencyMigration).not.toContain("$$");
  });

  it("makes price transparency VAT-aware on gross listing prices", () => {
    expect(vatPriceTransparencyMigration).toContain("commerce_quote_price_pool_wac_no_vat");
    expect(vatPriceTransparencyMigration).toContain("v_floor_net_receipts := ROUND(v_floor / v_vat_multiplier, 2)");
    expect(vatPriceTransparencyMigration).toContain("v_floor_output_vat := ROUND(v_floor - v_floor_net_receipts, 2)");
    expect(vatPriceTransparencyMigration).toContain("''output_vat_payable''");
    expect(vatPriceTransparencyMigration).toContain("''channel_fee_input_vat_reclaim''");
    expect(vatPriceTransparencyMigration).toContain("''vat_position''");
    expect(vatPriceTransparencyMigration).toContain("''net_position_after_vat''");
    expect(vatPriceTransparencyMigration).toContain("''pool_wac_vat_transparency_v1''");
    expect(vatPriceTransparencyMigration).toContain("estimated_net_after_vat");
    expect(vatPriceTransparencyMigration).not.toContain("$$");
    expect(adminData).toContain("vat_position: quote.vat_position ?? null");
  });

  it("keeps VAT-aware risk reserve rates as operator-entered percentages", () => {
    expect(riskReservePercentFixMigration).toContain("0.5 means 0.5%");
    expect(riskReservePercentFixMigration).toContain("v_raw_risk_rate := NULLIF(v_breakdown->>''risk_reserve_rate'', '''')::numeric");
    expect(riskReservePercentFixMigration).toContain("v_risk_rate := GREATEST(COALESCE(v_raw_risk_rate, 0), 0) / 100");
    expect(riskReservePercentFixMigration).toContain("''calculation_basis'', ''pool_wac_vat_risk_percent_fix_v1''");
    expect(riskReservePercentFixMigration).toContain("calculation_version = ''pool_wac_vat_risk_percent_fix_v1''");
    expect(riskReservePercentFixMigration).not.toContain("WHEN v_raw_risk_rate > 1 THEN v_raw_risk_rate / 100");
    expect(riskReservePercentFixMigration).not.toContain("ELSE v_raw_risk_rate");
    expect(riskReservePercentFixMigration).not.toContain("$$");
  });

  it("corrects floor to VAT-aware break-even only", () => {
    expect(correctedVatPricingMigration).toContain("Floor is break-even only");
    expect(correctedVatPricingMigration).toContain("v_stock_cost_gross := COALESCE(NULLIF(v_quote->>''carrying_value''");
    expect(correctedVatPricingMigration).toContain("v_stock_cost_net := ROUND(v_stock_cost_gross / v_vat_multiplier, 2)");
    expect(correctedVatPricingMigration).toContain("v_packaging_net := ROUND(v_packaging_gross / v_vat_multiplier, 2)");
    expect(correctedVatPricingMigration).toContain("v_delivery_net := ROUND(v_delivery_gross / v_vat_multiplier, 2)");
    expect(correctedVatPricingMigration).toContain("v_floor := ROUND(GREATEST((v_break_even_base_net + v_floor_fees_net + v_program_commission) * v_vat_multiplier, 0), 2)");
    expect(correctedVatPricingMigration).toContain("''floor_break_even_net_position''");
    expect(correctedVatPricingMigration).not.toContain("''key'', ''risk_reserve'', ''label'', ''Risk reserve'', ''amount'', v_floor");
    expect(correctedVatPricingMigration).not.toContain("''key'', ''minimum_profit'', ''label'', ''Minimum profit''");
    expect(correctedVatPricingMigration).not.toContain("''key'', ''margin_uplift'', ''label'', ''Margin uplift''");
    expect(correctedVatPricingMigration).not.toContain("$$");
  });

  it("corrects target to anchor on the higher gross RRP or market consensus with safeguards", () => {
    expect(correctedVatPricingMigration).toContain("v_raw_rrp_gross := CASE");
    expect(correctedVatPricingMigration).toContain("v_raw_market_consensus_gross := CASE");
    expect(correctedVatPricingMigration).toContain("v_target_anchor_gross := GREATEST(v_raw_rrp_gross, v_raw_market_consensus_gross)");
    expect(correctedVatPricingMigration).toContain("v_condition_adjusted_anchor := ROUND(GREATEST(v_target_anchor_gross * v_condition_multiplier, 0), 2)");
    expect(correctedVatPricingMigration).toContain("v_market_weighted_undercut := ROUND(v_market_gap * v_market_weight, 2)");
    expect(correctedVatPricingMigration).toContain("v_target_profit_safeguard_price");
    expect(correctedVatPricingMigration).toContain("v_target_margin_safeguard_price");
    expect(correctedVatPricingMigration).toContain("v_target := ROUND(GREATEST(");
    expect(correctedVatPricingMigration).toContain("''target_anchor_gross''");
    expect(correctedVatPricingMigration).toContain("''raw_market_consensus_gross''");
    expect(correctedVatPricingMigration).toContain("''calculation_basis'', ''pool_wac_vat_break_even_floor_v1''");
    expect(correctedVatPricingMigration).toContain("calculation_version = ''pool_wac_vat_break_even_floor_v1''");
  });

  it("models VAT reclaim and target safeguards numerically", () => {
    const vatMultiplier = 1.2;
    const stockGross = 12;
    const packagingGross = 1.2;
    const deliveryGross = 2.4;
    const feeRate = 0.12;
    const fixedFeeGross = 0.3;
    const minProfit = 1;
    const minMargin = 0.1;
    const riskRate = 0.005;

    const stockNet = stockGross / vatMultiplier;
    const packagingNet = packagingGross / vatMultiplier;
    const deliveryNet = deliveryGross / vatMultiplier;
    const breakEvenBaseNet = stockNet + packagingNet + deliveryNet;
    expect(breakEvenBaseNet).toBeLessThan(stockGross + packagingGross + deliveryGross);

    let floorGross = breakEvenBaseNet * vatMultiplier;
    for (let i = 0; i < 10; i += 1) {
      const feesGross = floorGross * feeRate + fixedFeeGross;
      const feesNet = feesGross / vatMultiplier;
      floorGross = (breakEvenBaseNet + feesNet) * vatMultiplier;
    }
    const floorFeesGross = floorGross * feeRate + fixedFeeGross;
    const floorNetPosition = floorGross / vatMultiplier - floorFeesGross / vatMultiplier - breakEvenBaseNet;
    expect(Math.abs(floorNetPosition)).toBeLessThan(0.01);

    let marginSafeguard = floorGross;
    for (let i = 0; i < 10; i += 1) {
      const feesNet = (marginSafeguard * feeRate + fixedFeeGross) / vatMultiplier;
      marginSafeguard = ((breakEvenBaseNet + feesNet) / (1 - minMargin)) * vatMultiplier;
    }
    let profitSafeguard = floorGross;
    for (let i = 0; i < 10; i += 1) {
      const feesNet = (profitSafeguard * feeRate + fixedFeeGross) / vatMultiplier;
      profitSafeguard = (breakEvenBaseNet + feesNet + minProfit) * vatMultiplier;
    }

    const rawRrpGross = 25;
    const rawMarketGross = 30;
    const conditionMultiplier = 0.8;
    const anchor = Math.max(rawRrpGross, rawMarketGross);
    const adjustedAnchor = anchor * conditionMultiplier;
    const marketGap = Math.max(adjustedAnchor - rawMarketGross, 0);
    const undercut = marketGap * 0.5;
    const marketTarget = adjustedAnchor - undercut;
    const target = Math.max(marketTarget, floorGross, profitSafeguard, marginSafeguard);
    const targetRisk = (target / vatMultiplier) * riskRate;

    expect(anchor).toBe(rawMarketGross);
    expect(target).toBeGreaterThanOrEqual(floorGross);
    expect(target).toBeGreaterThanOrEqual(profitSafeguard);
    expect(target).toBeGreaterThanOrEqual(marginSafeguard);
    expect(targetRisk).toBeGreaterThan(0);
  });

  it("bases target price on BrickEconomy RRP and never returns a target below floor", () => {
    expect(vatPriceTransparencyMigration).toContain("FROM public.brickeconomy_collection bec");
    expect(vatPriceTransparencyMigration).toContain("v_condition_adjusted_rrp := ROUND(GREATEST(v_brickeconomy_rrp * v_condition_multiplier, 0), 2)");
    expect(vatPriceTransparencyMigration).toContain("v_market_gap := ROUND(GREATEST(v_condition_adjusted_rrp - v_market_consensus, 0), 2)");
    expect(vatPriceTransparencyMigration).toContain("WHEN v_market_confidence > 1 THEN v_market_confidence / 100");
    expect(vatPriceTransparencyMigration).toContain("v_market_weighted_undercut := ROUND(v_market_gap * v_market_weight, 2)");
    expect(vatPriceTransparencyMigration).toContain("v_target := ROUND(GREATEST(v_target, v_floor), 2)");
    expect(vatPriceTransparencyMigration).toContain("''brickeconomy_rrp''");
    expect(vatPriceTransparencyMigration).toContain("''condition_adjusted_rrp''");
    expect(vatPriceTransparencyMigration).toContain("''market_weighted_rrp_undercut''");
    expect(vatPriceTransparencyMigration).toContain("''market_target_below_floor'', 0");
    expect(adminData).toContain("brickeconomy_rrp: quote.brickeconomy_rrp == null ? null : Number(quote.brickeconomy_rrp)");
    expect(adminData).toContain("condition_adjusted_rrp: quote.condition_adjusted_rrp == null ? null : Number(quote.condition_adjusted_rrp)");
  });

  it("still requires final-price override evidence for manual prices below floor", () => {
    expect(channelsTab).toContain("Below-floor price override");
    expect(channelsTab).toContain("Publishing will require an override reason");
    expect(channelsTab).toContain("allowBelowFloor");
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

    const marketBasedTarget = Math.floor(29.18) - 0.01;
    const target = Math.max(marketBasedTarget, floor);

    expect(floor).toBeGreaterThan(35);
    expect(floor).toBeLessThan(45);
    expect(target).toBeGreaterThanOrEqual(floor);
  });

  it("routes admin pricing through the canonical quote RPC", () => {
    expect(adminData).toContain('action === "calculate-pricing"');
    expect(adminData).toContain('admin.rpc("commerce_quote_price"');
    expect(adminData).toContain("normalizeQuote(rawQuote, sku_id, channel)");
  });

  it("exposes Product 360 price transparency and override actions through admin-data", () => {
    expect(adminData).toContain('action === "get-price-transparency"');
    expect(adminData).toContain("buildPriceTransparency(admin, params)");
    expect(adminData).toContain('action === "record-price-override"');
    expect(adminData).toContain('from("price_override")');
    expect(adminData).toContain('p_allow_below_floor: overrideType === "below_floor"');
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

  it("suppresses pending BrickLink and BrickOwl sales channels from pricing and channel tabs", () => {
    expect(adminData).toContain('const PRICE_TRANSPARENCY_CHANNELS = ["web", "ebay"];');
    expect(adminData).not.toContain('const PRICE_TRANSPARENCY_CHANNELS = ["web", "ebay", "bricklink", "brickowl"];');
    expect(channelsTab).not.toContain('{ key: "bricklink", label: "BrickLink"');
    expect(channelsTab).not.toContain('{ key: "brickowl", label: "BrickOwl"');
    expect(productDetail).not.toContain('{ key: "bricklink", priceChannel: "bricklink"');
    expect(productDetail).not.toContain('{ key: "brickowl", priceChannel: "brickowl"');
    expect(channelListingsHook).not.toContain("pricingChannel: 'bricklink'");
    expect(channelListingsHook).not.toContain("pricingChannel: 'brickowl'");
  });

  it("suppresses BrickOwl as a specifications source while cache-hydrating BrickEconomy", () => {
    expect(sourceValuesPanel).toContain('type SourceKey = "brickeconomy" | "bricklink" | "brickset"');
    expect(sourceValuesPanel).not.toContain('"brickowl"');
    expect(channelValueMatrix).not.toContain('"brickowl"');
    expect(sourceValuesPanel).toContain('"brickeconomy-source-cache"');
    expect(sourceValuesPanel).toContain('"hydrate-brickeconomy-source-values"');
    expect(adminData).toContain('action === "hydrate-brickeconomy-source-values"');
    expect(adminData).toContain('BRICKECONOMY_API_BASE');
    expect(adminData).toContain('.from("brickeconomy_collection")');
    expect(adminData).toContain('.from("landing_raw_brickeconomy")');
    expect(adminData).toContain('source_values_jsonb: merged');
  });

  it("auto-selects specification source values by priority without changing image source snapshots", () => {
    expect(sourceValuesPanel).toContain('const SOURCES: SourceKey[] = ["brickeconomy", "bricklink", "brickset"];');
    expect(sourceValuesPanel).toContain("function firstAvailableSource");
    expect(sourceValuesPanel).toContain("effectiveChosen = edit.chosen || r.autoChosen");
    expect(sourceValuesPanel).toContain('const IMAGE_URL_KEY = "image_url"');
    expect(canonicalResolver).toContain('const SOURCE_VALUE_PRIORITY = ["brickeconomy", "bricklink", "brickset"] as const');
    expect(canonicalResolver).toContain("sourceAttributeSelection");
    expect(canonicalResolver).toContain('if (attr.key === IMAGE_URL_KEY) return null');
    expect(canonicalResolver).toContain('if (chosen === "none") return { raw: null, source: "none", sourceField: null, suppressFallback: true }');
    expect(multiSourceSync).not.toContain("ATTRIBUTE_KEYS_EXCLUDED_FROM_SOURCE_SELECTION");
    expect(adminData).not.toContain('String(mapping.canonical_key) !== "image_url"');
  });

  it("adds the product pricing tab and explanation surface", () => {
    expect(productDetail).toContain('{ key: "pricing", label: "Pricing" }');
    expect(productDetail).toContain("<PricingTransparencyTab");
    expect(pricingTransparencyTab).toContain("PriceContributionBar");
    expect(pricingTransparencyTab).toContain("brickeconomy_rrp");
    expect(pricingTransparencyTab).toContain("market_weighted_rrp_undercut");
    expect(pricingTransparencyTab).toContain("Floor Contributors");
    expect(pricingTransparencyTab).toContain("Target Rules");
    expect(pricingTransparencyTab).toContain("VAT Position");
    expect(pricingTransparencyTab).toContain("Source Evidence");
    expect(pricingTransparencyTab).toContain("Manual Override");
    expect(pricingTransparencyTab).toContain("useRecordPriceOverride");
  });

  it("coalesces market signal source metadata in both function copies", () => {
    for (const source of [marketRefresh, marketRefreshCopy]) {
      expect(source).toContain('metadata: {}');
      expect(source).toContain("metadata: row.metadata ?? {}");
    }
  });
});
