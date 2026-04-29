import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  useAllocateOrderItems,
  useAllocateOrderLineByUnit,
  useCandidateUnitsForLine,
  type CandidateUnit,
} from "@/hooks/admin/use-orders";
import type { OrderLineItem } from "@/lib/types/admin";
import { Mono, SectionHead } from "./ui-primitives";
import { toast } from "sonner";

interface AllocateItemsDialogProps {
  open: boolean;
  onClose: () => void;
  orderId: string;
  lineItems: OrderLineItem[];
}

export function AllocateItemsDialog({
  open,
  onClose,
  orderId,
  lineItems,
}: AllocateItemsDialogProps) {
  const allocateBySku = useAllocateOrderItems();
  const unallocated = lineItems.filter((li) => !li.stockUnitId);

  const handleAllocateBySku = async (lineItemId: string, skuCode: string) => {
    try {
      await allocateBySku.mutateAsync({
        orderId,
        allocations: [{ lineItemId, skuCode: skuCode.trim() }],
      });
      toast.success(`Allocated ${skuCode}`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Allocation failed");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-white border-zinc-200 text-zinc-900 max-w-2xl">
        <DialogHeader>
          <DialogTitle>Allocate Items</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 mt-2 max-h-[70vh] overflow-y-auto">
          <SectionHead>Unallocated Line Items</SectionHead>

          {unallocated.length === 0 ? (
            <p className="text-zinc-500 text-sm">All items are already allocated.</p>
          ) : (
            unallocated.map((li) => (
              <LineAllocator
                key={li.id}
                orderId={orderId}
                line={li}
                onAllocateBySku={(sku) => handleAllocateBySku(li.id, sku)}
                pending={allocateBySku.isPending}
              />
            ))
          )}

          <div className="flex pt-2 border-t border-zinc-200">
            <button
              onClick={onClose}
              className="ml-auto px-4 py-2.5 bg-zinc-100 text-zinc-500 border border-zinc-200 rounded-md text-[13px] cursor-pointer hover:text-zinc-700 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Per-line allocator ─────────────────────────────────────

function LineAllocator({
  orderId,
  line,
  onAllocateBySku,
  pending,
}: {
  orderId: string;
  line: OrderLineItem;
  onAllocateBySku: (sku: string) => void;
  pending: boolean;
}) {
  const [skuInput, setSkuInput] = useState(line.sku ?? "");

  // Look up sku_id for this line via its existing sku code
  // (use-orders maps sku from sku.sku_code → we need the sku_id; we
  // fetch units by mpn instead, derived from the sku code lookup inside the hook)
  // We pass the sku string; the hook resolves sku_id by matching sku_code.
  const skuLookup = useSkuIdByCode(line.sku);
  const { data: candidates = [], isLoading } = useCandidateUnitsForLine(skuLookup);

  const allocateByUid = useAllocateOrderLineByUnit();

  const handleAllocateUnit = async (unit: CandidateUnit) => {
    if (!unit.uid) {
      toast.error("Unit has no UID — cannot allocate");
      return;
    }
    try {
      await allocateByUid.mutateAsync({
        orderId,
        lineItemId: line.id,
        unitUid: unit.uid,
      });
      toast.success(
        unit.exactSkuMatch
          ? `Allocated ${unit.uid}`
          : `Allocated ${unit.uid} (line re-pointed to ${unit.skuCode})`,
      );
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Allocation failed");
    }
  };

  return (
    <div className="bg-zinc-50 rounded border border-zinc-200 p-3 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm text-zinc-900 font-medium truncate">
            {line.name ?? "Unnamed line"}
          </div>
          <div className="text-xs text-zinc-500 mt-0.5">
            Line SKU: <Mono color="amber">{line.sku ?? "—"}</Mono> · qty 1 ·
            unit price <Mono color="teal">£{line.unitPrice.toFixed(2)}</Mono>
          </div>
        </div>
      </div>

      {/* By exact SKU code */}
      <div className="flex items-center gap-2">
        <label className="text-[11px] text-zinc-500 uppercase tracking-wider">
          Allocate by SKU
        </label>
        <input
          value={skuInput}
          onChange={(e) => setSkuInput(e.target.value)}
          placeholder="e.g. 75367-1.1"
          className="flex-1 px-2 py-1.5 bg-white border border-zinc-200 rounded text-zinc-900 text-xs font-mono"
        />
        <button
          onClick={() => skuInput.trim() && onAllocateBySku(skuInput.trim())}
          disabled={pending || !skuInput.trim()}
          className="px-3 py-1.5 bg-amber-500 text-zinc-900 rounded text-xs font-bold disabled:opacity-50 hover:bg-amber-400 transition-colors"
        >
          Allocate
        </button>
      </div>

      {/* Candidate stock units */}
      <div>
        <div className="text-[11px] text-zinc-500 uppercase tracking-wider mb-1.5">
          Available stock units (same MPN)
        </div>
        {isLoading ? (
          <p className="text-xs text-zinc-500">Loading candidates…</p>
        ) : candidates.length === 0 ? (
          <p className="text-xs text-zinc-500">
            No available units found for this MPN. Use the SKU input above or add stock first.
          </p>
        ) : (
          <div className="grid gap-1.5">
            {candidates.map((u) => (
              <button
                key={u.id}
                type="button"
                onClick={() => handleAllocateUnit(u)}
                disabled={allocateByUid.isPending}
                className="flex items-center gap-3 px-2.5 py-1.5 bg-white border border-zinc-200 rounded text-left hover:border-amber-400 hover:bg-amber-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Mono color="amber" className="text-xs">
                  {u.uid ?? u.id.slice(0, 8)}
                </Mono>
                <Mono color="dim" className="text-[11px]">
                  {u.skuCode ?? "—"}
                </Mono>
                <span className="text-[11px] text-zinc-500">
                  G{u.conditionGrade ?? "?"} · {u.v2Status ?? "—"}
                </span>
                {!u.exactSkuMatch && (
                  <span className="ml-auto text-[10px] text-amber-600 font-medium">
                    grade differs — line will be re-pointed
                  </span>
                )}
                {u.exactSkuMatch && (
                  <span className="ml-auto text-[10px] text-emerald-600 font-medium">
                    exact match
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Helper: resolve sku_id from sku_code ───────────────────

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

function useSkuIdByCode(skuCode: string | null) {
  const { data } = useQuery({
    queryKey: ["v2", "sku-id-by-code", skuCode],
    enabled: !!skuCode,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sku")
        .select("id")
        .eq("sku_code", skuCode!)
        .maybeSingle();
      if (error) throw error;
      return (data as { id: string } | null)?.id ?? null;
    },
  });
  return data ?? null;
}
