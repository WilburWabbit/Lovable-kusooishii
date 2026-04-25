// ============================================================
// ChannelMappingCard
// Shows how the canonical product attributes map to each sales
// channel (eBay first; GMC/Meta placeholder). Auto-resolves the
// eBay category, then asks the backend which schema aspects can
// be derived automatically and which still need human input.
// ============================================================

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  useAutoResolveEbayCategory,
  useResolveEbayAspects,
  useSetProductChannelCategory,
  useEbayCategorySuggestions,
} from "@/hooks/admin/use-channel-taxonomy";
import { SurfaceCard, SectionHead } from "./ui-primitives";
import type { ProductDetail } from "@/lib/types/admin";

interface Props {
  product: ProductDetail;
}

function ConfidenceBadge({ confidence }: { confidence: "high" | "medium" | "low" }) {
  const cls =
    confidence === "high"
      ? "text-emerald-700 bg-emerald-50 border-emerald-200"
      : confidence === "medium"
        ? "text-amber-700 bg-amber-50 border-amber-200"
        : "text-zinc-600 bg-zinc-100 border-zinc-200";
  return (
    <span className={`text-[9px] font-medium uppercase tracking-wider px-1.5 py-px border rounded ${cls}`}>
      auto · {confidence}
    </span>
  );
}

function OverridePicker({
  productId,
  mpn,
  marketplace,
  onClose,
}: {
  productId: string;
  mpn: string;
  marketplace: string;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  const { data: suggestions, isFetching } = useEbayCategorySuggestions(debounced, marketplace);
  const setCategory = useSetProductChannelCategory();

  const handleSelect = async (categoryId: string, label: string) => {
    try {
      await setCategory.mutateAsync({
        productId,
        mpn,
        channel: "ebay",
        categoryId,
        marketplace,
      });
      toast.success(`Override applied: ${label}`);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to set category");
    }
  };

  return (
    <div className="border border-zinc-200 rounded-md p-3 bg-zinc-50">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search eBay categories…"
        className="w-full px-3 py-2 bg-white border border-zinc-200 rounded text-[13px]"
        autoFocus
      />
      <div className="mt-2 max-h-64 overflow-y-auto">
        {debounced.length < 2 ? (
          <div className="text-[12px] text-zinc-500 p-2">Type at least 2 characters.</div>
        ) : isFetching ? (
          <div className="text-[12px] text-zinc-500 p-2">Searching…</div>
        ) : suggestions && suggestions.length > 0 ? (
          <ul className="divide-y divide-zinc-100">
            {suggestions.map((s) => {
              const path = [...s.ancestors.map((a) => a.name), s.categoryName].join(" › ");
              return (
                <li key={s.categoryId}>
                  <button
                    type="button"
                    onClick={() => handleSelect(s.categoryId, s.categoryName)}
                    className="w-full text-left px-2 py-2 hover:bg-amber-50 rounded text-[12px]"
                  >
                    <div className="font-medium text-zinc-900">{s.categoryName}</div>
                    <div className="text-[11px] text-zinc-500">{path} · ID {s.categoryId}</div>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="text-[12px] text-zinc-500 p-2">No suggestions.</div>
        )}
      </div>
    </div>
  );
}

export function ChannelMappingCard({ product }: Props) {
  const marketplace = product.ebayMarketplace || "EBAY_GB";

  // Only auto-resolve when the user hasn't already chosen a category.
  const auto = useAutoResolveEbayCategory(product.id, marketplace, !product.ebayCategoryId);
  const setCategory = useSetProductChannelCategory();
  const [overrideOpen, setOverrideOpen] = useState(false);

  // Persist the auto-resolved category once, so the rest of the system
  // (push-listing, etc.) sees a stable value.
  useEffect(() => {
    if (
      !product.ebayCategoryId &&
      auto.data?.categoryId &&
      auto.data.confidence !== "low"
    ) {
      setCategory.mutate({
        productId: product.id,
        mpn: product.mpn,
        channel: "ebay",
        categoryId: auto.data.categoryId,
        marketplace,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto.data?.categoryId, product.ebayCategoryId, product.id, product.mpn, marketplace]);

  const effectiveCategoryId = product.ebayCategoryId ?? auto.data?.categoryId ?? null;
  const aspects = useResolveEbayAspects(product.id, effectiveCategoryId, marketplace);

  const summary = useMemo(() => {
    if (!aspects.data) return null;
    const total = aspects.data.totalSchemaCount;
    const resolved = aspects.data.resolvedCount;
    const reqMissing = aspects.data.missingRequiredCount;
    return { total, resolved, reqMissing };
  }, [aspects.data]);

  const handleClearOverride = async () => {
    try {
      await setCategory.mutateAsync({
        productId: product.id,
        mpn: product.mpn,
        channel: "ebay",
        categoryId: null,
        marketplace,
      });
      toast.success("Override cleared — auto-resolve will be used");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to clear");
    }
  };

  return (
    <SurfaceCard>
      <SectionHead>Channel Mapping</SectionHead>
      <p className="text-[11px] text-zinc-500 mb-3 mt-1">
        Categories and item specifics for each sales channel are derived from the
        canonical attributes above. Only attributes unique to a channel are shown
        for editing here.
      </p>

      {/* eBay row */}
      <div className="border border-zinc-200 rounded-md p-3">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[12px] font-bold text-zinc-900">eBay</span>
              <span className="text-[10px] text-zinc-500">{marketplace}</span>
              {!product.ebayCategoryId && auto.data?.confidence && (
                <ConfidenceBadge confidence={auto.data.confidence} />
              )}
              {product.ebayCategoryId && (
                <span className="text-[9px] font-medium uppercase tracking-wider px-1.5 py-px border rounded text-amber-700 bg-amber-50 border-amber-200">
                  manual override
                </span>
              )}
            </div>
            <div className="mt-1 text-[13px] text-zinc-900 font-mono">
              {auto.isLoading && !product.ebayCategoryId
                ? "Resolving…"
                : effectiveCategoryId
                  ? `${aspects.data?.categoryName ?? auto.data?.categoryName ?? "—"} · ID ${effectiveCategoryId}`
                  : "No category resolved"}
            </div>
            {!product.ebayCategoryId && auto.data?.basis && (
              <div className="text-[10px] text-zinc-400 mt-0.5 truncate" title={auto.data.basis}>
                {auto.data.basis}
              </div>
            )}
          </div>
          <div className="flex gap-2 flex-shrink-0">
            {product.ebayCategoryId && (
              <button
                type="button"
                onClick={handleClearOverride}
                className="px-2 py-1 text-[11px] rounded border border-zinc-200 text-zinc-600 hover:bg-zinc-50"
              >
                Use auto
              </button>
            )}
            <button
              type="button"
              onClick={() => setOverrideOpen((v) => !v)}
              className="px-3 py-1 text-[11px] rounded border border-amber-300 text-amber-700 hover:bg-amber-50"
            >
              {overrideOpen ? "Close" : "Override"}
            </button>
          </div>
        </div>

        {overrideOpen && (
          <div className="mt-2">
            <OverridePicker
              productId={product.id}
              mpn={product.mpn}
              marketplace={marketplace}
              onClose={() => setOverrideOpen(false)}
            />
          </div>
        )}

        {/* Aspect summary + missing list */}
        <div className="mt-3 pt-3 border-t border-zinc-100">
          {aspects.isLoading ? (
            <div className="text-[12px] text-zinc-500">Loading aspect mapping…</div>
          ) : !aspects.data ? (
            <div className="text-[12px] text-zinc-500">
              {effectiveCategoryId
                ? "Schema not yet cached. Open the eBay aspects panel once to load."
                : "Resolve a category to see the aspect mapping."}
            </div>
          ) : !aspects.data.schemaLoaded ? (
            <div className="text-[12px] text-zinc-500">
              Aspect schema for this category not loaded yet.
            </div>
          ) : (
            <>
              <div className="text-[11px] text-zinc-600">
                <strong className="text-zinc-900">{summary?.resolved}</strong> of{" "}
                <strong className="text-zinc-900">{summary?.total}</strong> aspects
                resolved automatically
                {summary && summary.reqMissing > 0 && (
                  <span className="text-amber-700"> · {summary.reqMissing} required missing</span>
                )}
              </div>
              {aspects.data.missing.length > 0 && (
                <details className="mt-2">
                  <summary className="text-[11px] text-amber-700 cursor-pointer hover:text-amber-800">
                    {aspects.data.missing.length} aspects unique to eBay (manual entry)
                  </summary>
                  <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-zinc-600">
                    {aspects.data.missing.map((m) => (
                      <li key={m.key} className="flex items-center gap-1">
                        {m.required && <span className="text-red-500">*</span>}
                        <span>{m.key}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="text-[10px] text-zinc-400 mt-2">
                    Fill these via the Channels tab when creating an eBay listing.
                    They are channel-specific and cannot be derived from the
                    canonical product data.
                  </p>
                </details>
              )}
            </>
          )}
        </div>
      </div>

      {/* GMC / Meta placeholders */}
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div className="border border-zinc-200 rounded-md p-3 opacity-60">
          <div className="text-[12px] font-bold text-zinc-900 mb-1">Google Merchant Center</div>
          <div className="text-[11px] text-zinc-500">
            Auto-mapping from canonical attributes — coming soon.
          </div>
        </div>
        <div className="border border-zinc-200 rounded-md p-3 opacity-60">
          <div className="text-[12px] font-bold text-zinc-900 mb-1">Meta Catalog</div>
          <div className="text-[11px] text-zinc-500">
            Auto-mapping from canonical attributes — coming soon.
          </div>
        </div>
      </div>
    </SurfaceCard>
  );
}
