// ============================================================
// EbayCategoryPicker
// Type-ahead search backed by eBay Taxonomy API. Persists the
// selected leaf category on the product (ebay_category_id).
// ============================================================

import { useEffect, useMemo, useState } from "react";
import { useEbayCategorySuggestions, useSetProductChannelCategory } from "@/hooks/admin/use-channel-taxonomy";
import { toast } from "sonner";

interface Props {
  productId: string;
  mpn: string;
  marketplace: string;
  currentCategoryId: string | null;
  currentCategoryName?: string | null;
}

export function EbayCategoryPicker({
  productId,
  mpn,
  marketplace,
  currentCategoryId,
  currentCategoryName,
}: Props) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  const { data: suggestions, isFetching } = useEbayCategorySuggestions(
    debounced,
    marketplace,
    open,
  );
  const setCategory = useSetProductChannelCategory();

  const currentLabel = useMemo(() => {
    if (currentCategoryName) return `${currentCategoryName} · ${currentCategoryId}`;
    if (currentCategoryId) return currentCategoryId;
    return "No category selected";
  }, [currentCategoryId, currentCategoryName]);

  const handleSelect = async (categoryId: string, label: string) => {
    try {
      await setCategory.mutateAsync({
        productId,
        mpn,
        channel: "ebay",
        categoryId,
        marketplace,
      });
      toast.success(`Set eBay category: ${label}`);
      setOpen(false);
      setQuery("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to set category");
    }
  };

  const handleClear = async () => {
    try {
      await setCategory.mutateAsync({
        productId,
        mpn,
        channel: "ebay",
        categoryId: null,
        marketplace,
      });
      toast.success("eBay category cleared");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to clear");
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div>
          <label className="text-[11px] text-zinc-500 font-medium uppercase tracking-wider block">
            eBay Category ({marketplace})
          </label>
          <div className="text-[13px] text-zinc-900 font-mono mt-0.5">{currentLabel}</div>
        </div>
        <div className="flex gap-2">
          {currentCategoryId && (
            <button
              type="button"
              onClick={handleClear}
              className="px-2 py-1 text-[11px] rounded border border-zinc-200 text-zinc-600 hover:bg-zinc-50"
            >
              Clear
            </button>
          )}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="px-3 py-1 text-[11px] rounded bg-amber-500 text-zinc-900 font-bold hover:bg-amber-400"
          >
            {open ? "Close" : "Change"}
          </button>
        </div>
      </div>

      {open && (
        <div className="border border-zinc-200 rounded-md p-3 bg-zinc-50">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search eBay categories (e.g. lego star wars)…"
            className="w-full px-3 py-2 bg-white border border-zinc-200 rounded text-[13px]"
            autoFocus
          />
          <div className="mt-2 max-h-64 overflow-y-auto">
            {debounced.length < 2 ? (
              <div className="text-[12px] text-zinc-500 p-2">
                Type at least 2 characters.
              </div>
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
                        <div className="text-[11px] text-zinc-500">
                          {path} · ID {s.categoryId}
                        </div>
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
      )}
    </div>
  );
}
