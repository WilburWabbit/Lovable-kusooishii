import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = process.cwd();
const migration = readFileSync(
  join(repoRoot, "supabase/migrations/20260503173000_unify_pricing_quote_and_web_publish.sql"),
  "utf8",
);
const adminData = readFileSync(
  join(repoRoot, "supabase/functions/admin-data/index.ts"),
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
});
