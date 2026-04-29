// ============================================================
// MinifigsCard
//
// Shows the minifigs included in a LEGO set. BrickLink is the
// preferred source of truth (canonical MPNs like "sw0001");
// Rebrickable is used as a fallback only when no BrickLink
// data has been synced for the set yet.
//
// Selection persists on the product row
// (`selected_minifig_fig_nums`) and controls which minifig
// images are appended to marketplace listings.
//
// Rendered in both the Specifications tab and the Copy & Media
// tab.
// ============================================================

import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { SurfaceCard, SectionHead } from "./ui-primitives";
import {
  setMinifigsKeys,
  useSetMinifigs,
  useUpdateMinifigSelection,
} from "@/hooks/admin/use-set-minifigs";
import { invokeWithAuth } from "@/lib/invokeWithAuth";
import type { ProductDetail } from "@/lib/types/admin";

interface MinifigsCardProps {
  product: ProductDetail;
}

interface BlSyncResult {
  source?: string;
  resolved?: string | null;
  fetched?: number;
  upserted?: number;
  images_fetched?: number;
  message?: string;
  error?: string;
  configured?: boolean;
}

export function MinifigsCard({ product }: MinifigsCardProps) {
  const queryClient = useQueryClient();
  const { data: minifigs, isLoading } = useSetMinifigs(product.mpn);
  const update = useUpdateMinifigSelection();
  const [refreshing, setRefreshing] = useState(false);

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

  const handleRefreshFromBrickLink = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const { data, error } = await invokeWithAuth<BlSyncResult>(
        "bricklink-minifigs-sync",
        { body: { mpn: product.mpn } },
      );
      if (error) throw error;
      if (data?.error) {
        if (data.configured === false) {
          toast.error("BrickLink credentials not configured");
        } else {
          toast.error(data.error);
        }
        return;
      }
      if (!data?.resolved) {
        toast.warning(
          data?.message ?? "Set not found on BrickLink — keeping Rebrickable data",
        );
      } else {
        toast.success(
          `BrickLink: ${data.fetched ?? 0} minifigs · ${data.images_fetched ?? 0} images`,
        );
      }
      await queryClient.invalidateQueries({
        queryKey: setMinifigsKeys.list(product.mpn),
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  };

  // Only render for set products.
  if (product.productType !== "set") return null;

  const allFigNums = (minifigs ?? []).map((m) => m.figNum);
  const allSelected =
    allFigNums.length > 0 && allFigNums.every((f) => selected.has(f));
  const noneSelected = allFigNums.every((f) => !selected.has(f));

  // Detect overall source: if any row is bricklink, treat the card as BL-sourced.
  const sourceLabel =
    (minifigs ?? []).some((m) => m.source === "bricklink")
      ? "BrickLink"
      : (minifigs ?? []).length > 0
        ? "Rebrickable (fallback)"
        : null;

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
          <div className="flex items-center gap-2">
            <SectionHead>Included Minifigures</SectionHead>
            {sourceLabel && (
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                  sourceLabel === "BrickLink"
                    ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                    : "bg-zinc-100 text-zinc-600 border border-zinc-200"
                }`}
                title={
                  sourceLabel === "BrickLink"
                    ? "Sourced from BrickLink (canonical MPNs)"
                    : "BrickLink data not synced — falling back to Rebrickable"
                }
              >
                {sourceLabel}
              </span>
            )}
          </div>
          <p className="text-[11px] text-zinc-500 mt-1">
            Tick the minifigures whose images should be added to listings
            (in addition to your uploaded photos and catalog image). They
            will also appear in the eBay <span className="font-mono">LEGO Character</span> aspect.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            type="button"
            onClick={handleRefreshFromBrickLink}
            disabled={refreshing}
            className="text-[11px] px-2 py-1 rounded border border-zinc-300 text-zinc-700 hover:bg-zinc-50 whitespace-nowrap inline-flex items-center gap-1 disabled:opacity-60 disabled:cursor-not-allowed"
            title="Fetch / refresh minifigs from BrickLink (uses canonical MPNs)"
          >
            <RefreshCw className={`w-3 h-3 ${refreshing ? "animate-spin" : ""}`} />
            {refreshing ? "Refreshing…" : "Refresh from BrickLink"}
          </button>
          {allFigNums.length > 0 && (
            <button
              type="button"
              onClick={toggleAll}
              className="text-[11px] px-2 py-1 rounded border border-amber-300 text-amber-700 hover:bg-amber-50 whitespace-nowrap"
            >
              {allSelected ? "Deselect all" : "Select all"}
            </button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="text-[12px] text-zinc-500 py-4">Loading minifigures…</div>
      ) : allFigNums.length === 0 ? (
        <div className="text-[12px] text-zinc-500 py-4">
          No minifig data yet. Click <span className="font-medium">Refresh from BrickLink</span> to fetch.
        </div>
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
              const displayId = m.bricklinkId || m.figNum;
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
                  title={`${m.name ?? m.figNum} (${displayId}) — ${m.source}`}
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
                    <div className="truncate font-mono text-[9px] opacity-80">{displayId}</div>
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
