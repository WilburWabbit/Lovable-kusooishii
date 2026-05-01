// ============================================================
// EbayConditionsPanel
//
// Per-category view of:
//   • the eBay item-condition policy (which conditionIds the category
//     accepts, whether free-text condition descriptions are allowed),
//   • how each internal grade (1-5) resolves to one of those allowed
//     conditions using the same fallback rules the publisher uses.
//
// The policy is cached on channel_category_schema.condition_policy and
// refreshed on demand. Categories that haven't been synced yet show a
// "Fetch" affordance.
// ============================================================

import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  useEbayConditionPolicy,
  useRefreshEbayConditionPolicy,
  useProductChannelCategories,
  resolveGradeForPolicy,
  EBAY_CONDITION_ENUM_LABEL,
} from "@/hooks/admin/use-channel-taxonomy";
import { SurfaceCard, SectionHead } from "@/components/admin-v2/ui-primitives";

const MARKETPLACES = ["EBAY_GB", "EBAY_US", "EBAY_DE", "EBAY_AU"] as const;

const GRADE_LABELS: Record<string, string> = {
  "1": "1 · New / sealed",
  "2": "2 · Excellent / open-box",
  "3": "3 · Good / used complete",
  "4": "4 · Acceptable / used worn",
  "5": "5 · Red Card",
};

export function EbayConditionsPanel() {
  const [marketplace, setMarketplace] = useState<string>("EBAY_GB");
  const [categoryId, setCategoryId] = useState<string | null>(null);

  const { data: productCategories } = useProductChannelCategories(
    "ebay",
    marketplace,
  );
  const { data: policyResult, isLoading } = useEbayConditionPolicy(
    categoryId,
    marketplace,
  );
  const refresh = useRefreshEbayConditionPolicy();

  const policy = policyResult?.policy ?? null;

  const resolvedGrades = useMemo(
    () => ["1", "2", "3", "4", "5"].map((g) => resolveGradeForPolicy(g, policy)),
    [policy],
  );

  const handleRefresh = async () => {
    if (!categoryId) return;
    try {
      await refresh.mutateAsync({ categoryId, marketplace });
      toast.success("Condition policy refreshed from eBay");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Refresh failed");
    }
  };

  return (
    <SurfaceCard>
      <div className="flex items-start justify-between mb-4 gap-3 flex-wrap">
        <div>
          <SectionHead>eBay Conditions · per category</SectionHead>
          <p className="text-[11px] text-zinc-500 mt-1 max-w-2xl">
            Each eBay category accepts a different set of item conditions.
            Pick a category to see what eBay allows there and how each
            internal grade will be projected when a listing is published.
            Refreshing pulls the latest policy from eBay's Taxonomy API.
          </p>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <select
            value={marketplace}
            onChange={(e) => {
              setMarketplace(e.target.value);
              setCategoryId(null);
            }}
            className="px-2 py-1.5 text-[12px] border border-zinc-200 rounded"
          >
            {MARKETPLACES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <select
            value={categoryId ?? ""}
            onChange={(e) => setCategoryId(e.target.value || null)}
            className="px-2 py-1.5 text-[12px] border border-zinc-200 rounded min-w-[260px]"
          >
            <option value="">— Select category —</option>
            {(productCategories ?? []).map((c) => (
              <option key={c.categoryId} value={c.categoryId}>
                {c.categoryName ?? c.categoryId} ({c.categoryId}) ·{" "}
                {c.productCount} product
                {c.productCount === 1 ? "" : "s"}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={!categoryId || refresh.isPending}
            className="px-2.5 py-1.5 text-[11px] font-medium rounded border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {refresh.isPending ? "Refreshing…" : "↻ Refresh from eBay"}
          </button>
        </div>
      </div>

      {!categoryId ? (
        <div className="py-10 text-center text-[12px] text-zinc-500">
          Pick a category above to inspect its eBay condition policy.
        </div>
      ) : isLoading ? (
        <div className="py-10 text-center text-[12px] text-zinc-500">
          Loading…
        </div>
      ) : !policy || policy.itemConditions.length === 0 ? (
        <div className="py-10 text-center text-[12px] text-zinc-500">
          No condition policy cached for this category yet. Click{" "}
          <span className="font-semibold">Refresh from eBay</span> to fetch it.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Left: grade → eBay condition resolution */}
          <div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-2">
              Grade → eBay condition (this category)
            </div>
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500 border-b border-zinc-200">
                  <th className="py-2 px-2">Grade</th>
                  <th className="py-2 px-2">Resolves to</th>
                  <th className="py-2 px-2">conditionId</th>
                  <th className="py-2 px-2"></th>
                </tr>
              </thead>
              <tbody>
                {resolvedGrades.map((r) => (
                  <tr
                    key={r.grade}
                    className="border-b border-zinc-100 hover:bg-zinc-50"
                  >
                    <td className="py-2 px-2 font-mono">
                      {GRADE_LABELS[r.grade]}
                    </td>
                    <td className="py-2 px-2 text-zinc-900">
                      {r.conditionLabel}
                    </td>
                    <td className="py-2 px-2 font-mono text-zinc-500">
                      {r.conditionId ?? "—"}
                    </td>
                    <td className="py-2 px-2 text-right">
                      {r.fallbackUsed && (
                        <span
                          className="inline-block px-1.5 py-0.5 rounded text-[9px] font-medium uppercase tracking-wider border bg-amber-50 border-amber-200 text-amber-700"
                          title="Preferred condition not allowed by this category — used a fallback"
                        >
                          Fallback
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-[11px] text-zinc-500 mt-2">
              When a listing is published, the unit's grade is mapped using the
              first allowed condition in our preference list. Free-text condition
              notes from the stock unit (or SKU) are sent as{" "}
              <span className="font-mono">conditionDescription</span>{" "}
              {policy.itemConditionDescriptionEnabled ? (
                <span className="text-emerald-700">(enabled here)</span>
              ) : (
                <span className="text-red-600">
                  (NOT enabled — eBay will reject notes for this category)
                </span>
              )}
              .
            </p>
          </div>

          {/* Right: raw policy from eBay */}
          <div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-2">
              Conditions allowed by eBay
            </div>
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500 border-b border-zinc-200">
                  <th className="py-2 px-2">conditionId</th>
                  <th className="py-2 px-2">Condition</th>
                  <th className="py-2 px-2">eBay description</th>
                </tr>
              </thead>
              <tbody>
                {policy.itemConditions.map((c) => (
                  <tr
                    key={c.conditionId}
                    className="border-b border-zinc-100 hover:bg-zinc-50"
                  >
                    <td className="py-2 px-2 font-mono text-zinc-500">
                      {c.conditionId}
                    </td>
                    <td className="py-2 px-2 text-zinc-900">
                      {EBAY_CONDITION_ENUM_LABEL[c.conditionId] ??
                        c.conditionId}
                    </td>
                    <td className="py-2 px-2 text-zinc-500">
                      {c.conditionDescription || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-3 flex gap-3 text-[11px] text-zinc-500">
              <div>
                <span className="font-semibold">Required:</span>{" "}
                {policy.itemConditionRequired ? "yes" : "no"}
              </div>
              <div>
                <span className="font-semibold">Notes allowed:</span>{" "}
                {policy.itemConditionDescriptionEnabled ? "yes" : "no"}
              </div>
              <div className="ml-auto">
                {policyResult?.fromCache ? "Cached" : "Fresh from eBay"}
              </div>
            </div>
          </div>
        </div>
      )}
    </SurfaceCard>
  );
}
