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
    expect(migration).not.toContain("existingSkuPrice");
    expect(migration).not.toContain("GREATEST(v_floor, COALESCE(v_market_consensus, v_floor), v_sku_price");
    expect(migration).toContain("v_target := v_floor;");
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
    expect(pricingRepairMigration).toContain("sk.condition_grade::integer");
    expect(pricingRepairMigration).toContain("sk.condition_grade::int");
    expect(pricingRepairMigration).toContain("regexp_replace(sk.condition_grade::text");
    expect(pricingRepairMigration).not.toContain("$$");
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
