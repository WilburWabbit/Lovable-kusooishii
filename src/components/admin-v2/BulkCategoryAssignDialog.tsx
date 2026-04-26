// ============================================================
// BulkCategoryAssignDialog
// Lets staff pick an eBay category (from in-use list or full
// taxonomy search) and apply it to many products at once.
// ============================================================

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  useBulkSetProductChannelCategory,
  useEbayCategorySuggestions,
  useProductChannelCategories,
} from "@/hooks/admin/use-channel-taxonomy";

interface Props {
  open: boolean;
  onClose: () => void;
  productIds: string[];
  marketplace?: string;
}

export function BulkCategoryAssignDialog({
  open,
  onClose,
  productIds,
  marketplace = "EBAY_GB",
}: Props) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(null);

  const { data: inUseCats } = useProductChannelCategories("ebay", marketplace);
  const { data: suggestions, isFetching } = useEbayCategorySuggestions(
    debounced,
    marketplace,
  );
  const bulkSet = useBulkSetProductChannelCategory();

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  // Reset state on close
  useEffect(() => {
    if (!open) {
      setQuery("");
      setDebounced("");
      setPicked(null);
    }
  }, [open]);

  if (!open) return null;

  const handleApply = async () => {
    if (!picked) return;
    try {
      const res = await bulkSet.mutateAsync({
        productIds,
        channel: "ebay",
        categoryId: picked.id,
        marketplace,
      });
      toast.success(
        `Updated ${res.updated} product${res.updated === 1 ? "" : "s"} → ${picked.name}`,
      );
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Bulk assign failed");
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-zinc-200 flex items-center justify-between">
          <div>
            <h2 className="text-[14px] font-bold text-zinc-900">
              Assign eBay category
            </h2>
            <p className="text-[11px] text-zinc-500 mt-0.5">
              {productIds.length} product{productIds.length === 1 ? "" : "s"} selected
              · {marketplace}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-700 text-[20px] leading-none"
          >
            ×
          </button>
        </div>

        <div className="p-5 space-y-4 text-[12px] overflow-y-auto">
          {picked && (
            <div className="border border-amber-300 bg-amber-50 rounded p-2 flex items-center justify-between">
              <div>
                <div className="text-[11px] uppercase tracking-wider text-amber-700 font-semibold">
                  Selected
                </div>
                <div className="text-zinc-900 font-medium">{picked.name}</div>
                <div className="text-[10px] text-zinc-500 font-mono">ID {picked.id}</div>
              </div>
              <button
                onClick={() => setPicked(null)}
                className="text-[11px] text-amber-700 hover:underline"
              >
                Change
              </button>
            </div>
          )}

          {!picked && (
            <>
              {(inUseCats ?? []).length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mb-1">
                    Categories already in use
                  </div>
                  <ul className="border border-zinc-200 rounded max-h-40 overflow-y-auto divide-y divide-zinc-100">
                    {(inUseCats ?? []).map((c) => (
                      <li key={c.categoryId}>
                        <button
                          onClick={() =>
                            setPicked({
                              id: c.categoryId,
                              name: c.categoryName ?? `Category ${c.categoryId}`,
                            })
                          }
                          className="w-full text-left px-2 py-1.5 hover:bg-zinc-50 flex items-center justify-between"
                        >
                          <span>
                            <span className="text-zinc-900">
                              {c.categoryName ?? `Category ${c.categoryId}`}
                            </span>
                            <span className="text-[10px] text-zinc-500 ml-1 font-mono">
                              {c.categoryId}
                            </span>
                          </span>
                          <span className="text-[10px] text-zinc-500">
                            {c.productCount} product{c.productCount === 1 ? "" : "s"}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div>
                <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mb-1">
                  Or search the full eBay taxonomy
                </div>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Type at least 2 characters…"
                  className="w-full px-2 py-1.5 text-[12px] border border-zinc-200 rounded mb-1"
                  autoFocus
                />
                <div className="border border-zinc-200 rounded max-h-48 overflow-y-auto">
                  {debounced.length < 2 ? (
                    <div className="text-[11px] text-zinc-400 p-2">Type to search.</div>
                  ) : isFetching ? (
                    <div className="text-[11px] text-zinc-500 p-2">Searching…</div>
                  ) : suggestions && suggestions.length > 0 ? (
                    <ul className="divide-y divide-zinc-100">
                      {suggestions.map((s) => {
                        const path = [
                          ...s.ancestors.map((a) => a.name),
                          s.categoryName,
                        ].join(" › ");
                        return (
                          <li key={s.categoryId}>
                            <button
                              onClick={() =>
                                setPicked({ id: s.categoryId, name: s.categoryName })
                              }
                              className="w-full text-left px-2 py-1.5 hover:bg-amber-50"
                            >
                              <div className="text-zinc-900">{s.categoryName}</div>
                              <div className="text-[10px] text-zinc-500">
                                {path} · ID {s.categoryId}
                              </div>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <div className="text-[11px] text-zinc-500 p-2">No suggestions.</div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-zinc-200 flex justify-between items-center gap-2">
          <button
            onClick={async () => {
              if (
                !confirm(
                  `Clear eBay category on ${productIds.length} product${productIds.length === 1 ? "" : "s"}? They'll fall back to auto-resolve.`,
                )
              )
                return;
              try {
                const res = await bulkSet.mutateAsync({
                  productIds,
                  channel: "ebay",
                  categoryId: null,
                  marketplace,
                });
                toast.success(
                  `Cleared category on ${res.updated} product${res.updated === 1 ? "" : "s"}`,
                );
                onClose();
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Clear failed");
              }
            }}
            disabled={bulkSet.isPending}
            className="px-3 py-1.5 text-[11px] text-zinc-500 hover:text-zinc-700 underline disabled:opacity-50"
          >
            Clear category instead
          </button>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-[12px] border border-zinc-200 rounded hover:bg-zinc-50"
            >
              Cancel
            </button>
            <button
              onClick={handleApply}
              disabled={!picked || bulkSet.isPending}
              className="px-4 py-1.5 text-[12px] font-bold bg-amber-500 text-zinc-900 rounded hover:bg-amber-400 disabled:opacity-50"
            >
              {bulkSet.isPending ? "Applying…" : `Apply to ${productIds.length}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
