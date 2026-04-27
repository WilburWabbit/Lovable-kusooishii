// ============================================================
// MinifigsCard
//
// Shows the minifigs included in a LEGO set (sourced from the
// rebrickable inventory data) with checkboxes to control which
// minifig images get appended to marketplace listings.
//
// Rendered in both the Specifications tab and the Copy & Media
// tab — selection is mirrored because it's persisted on the
// product row (`selected_minifig_fig_nums`).
// ============================================================

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { SurfaceCard, SectionHead } from "./ui-primitives";
import {
  useSetMinifigs,
  useUpdateMinifigSelection,
} from "@/hooks/admin/use-set-minifigs";
import type { ProductDetail } from "@/lib/types/admin";

interface MinifigsCardProps {
  product: ProductDetail;
}

export function MinifigsCard({ product }: MinifigsCardProps) {
  const { data: minifigs, isLoading } = useSetMinifigs(product.mpn);
  const update = useUpdateMinifigSelection();

  // Local optimistic selection state, hydrated from the product row.
  const initial = useMemo(
    () => new Set(product.selectedMinifigFigNums),
    [product.selectedMinifigFigNums],
  );
  const [selected, setSelected] = useState<Set<string>>(initial);
  const [hydratedFor, setHydratedFor] = useState<string>("");

  useEffect(() => {
    const sig = `${product.id}|${product.selectedMinifigFigNums.join(",")}`;
    if (sig !== hydratedFor) {
      setSelected(new Set(product.selectedMinifigFigNums));
      setHydratedFor(sig);
    }
  }, [product.id, product.selectedMinifigFigNums, hydratedFor]);

  const persist = async (next: Set<string>) => {
    setSelected(next);
    try {
      await update.mutateAsync({
        productId: product.id,
        mpn: product.mpn,
        figNums: Array.from(next),
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save selection");
      setSelected(initial); // revert
    }
  };

  // Don't render the card at all for non-set products or when there
  // are no minifigs linked yet.
  if (product.productType !== "set") return null;
  if (!isLoading && (!minifigs || minifigs.length === 0)) return null;

  const allFigNums = (minifigs ?? []).map((m) => m.figNum);
  const allSelected =
    allFigNums.length > 0 && allFigNums.every((f) => selected.has(f));
  const noneSelected = allFigNums.every((f) => !selected.has(f));

  const toggleAll = () => {
    if (allSelected) {
      persist(new Set());
    } else {
      persist(new Set(allFigNums));
    }
  };

  const toggleOne = (figNum: string) => {
    const next = new Set(selected);
    if (next.has(figNum)) next.delete(figNum);
    else next.add(figNum);
    persist(next);
  };

  return (
    <SurfaceCard>
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0">
          <SectionHead>Included Minifigures</SectionHead>
          <p className="text-[11px] text-zinc-500 mt-1">
            Tick the minifigures whose images should be added to listings
            (in addition to your uploaded photos and catalog image). They
            will also appear in the eBay <span className="font-mono">LEGO Character</span> aspect.
          </p>
        </div>
        {allFigNums.length > 0 && (
          <button
            type="button"
            onClick={toggleAll}
            className="text-[11px] px-2 py-1 rounded border border-amber-300 text-amber-700 hover:bg-amber-50 whitespace-nowrap flex-shrink-0"
          >
            {allSelected ? "Deselect all" : "Select all"}
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="text-[12px] text-zinc-500 py-4">Loading minifigures…</div>
      ) : (
        <>
          <div className="text-[11px] text-zinc-600 mb-2">
            <strong className="text-zinc-900">{selected.size}</strong> of{" "}
            <strong className="text-zinc-900">{allFigNums.length}</strong> included in listings
            {noneSelected && allFigNums.length > 0 && (
              <span className="text-zinc-400"> · no minifig images will be sent</span>
            )}
          </div>

          <div className="grid grid-cols-4 gap-2">
            {(minifigs ?? []).map((m) => {
              const isOn = selected.has(m.figNum);
              return (
                <button
                  type="button"
                  key={m.figNum}
                  onClick={() => toggleOne(m.figNum)}
                  className={`relative aspect-square bg-zinc-50 rounded-lg overflow-hidden border-2 text-left transition-all ${
                    isOn
                      ? "border-amber-500 ring-1 ring-amber-300"
                      : "border-zinc-200 hover:border-zinc-300 opacity-60 hover:opacity-100"
                  }`}
                  title={`${m.name ?? m.figNum} (${m.figNum})`}
                >
                  {m.imgUrl ? (
                    <img
                      src={m.imgUrl}
                      alt={m.name ?? m.figNum}
                      className="w-full h-full object-contain p-1"
                      draggable={false}
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-[10px] text-zinc-400">
                      No image
                    </div>
                  )}

                  <div className="absolute top-1 left-1">
                    <span
                      className={`flex items-center justify-center w-4 h-4 rounded border text-[10px] ${
                        isOn
                          ? "bg-amber-500 border-amber-500 text-zinc-900"
                          : "bg-white/80 border-zinc-300 text-transparent"
                      }`}
                    >
                      ✓
                    </span>
                  </div>

                  {m.quantity > 1 && (
                    <span className="absolute top-1 right-1 bg-zinc-900/80 text-white text-[9px] font-bold px-1.5 py-0.5 rounded">
                      ×{m.quantity}
                    </span>
                  )}

                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent text-white text-[10px] px-1.5 py-1 truncate">
                    <div className="truncate font-medium">{m.name ?? "—"}</div>
                    <div className="truncate font-mono text-[9px] opacity-80">{m.figNum}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}
    </SurfaceCard>
  );
}
