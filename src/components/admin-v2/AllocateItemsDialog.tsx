import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAllocateOrderItems } from "@/hooks/admin/use-orders";
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
  const allocate = useAllocateOrderItems();
  const unallocated = lineItems.filter((li) => !li.stockUnitId);

  const [skuCodes, setSkuCodes] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const li of unallocated) {
      initial[li.id] = li.sku ?? "";
    }
    return initial;
  });

  const handleAllocate = async () => {
    const allocations = unallocated
      .filter((li) => skuCodes[li.id]?.trim())
      .map((li) => ({
        lineItemId: li.id,
        skuCode: skuCodes[li.id].trim(),
      }));

    if (allocations.length === 0) {
      toast.error("Enter at least one SKU code to allocate");
      return;
    }

    try {
      await allocate.mutateAsync({ orderId, allocations });
      toast.success(`${allocations.length} item(s) allocated`);
      onClose();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Allocation failed";
      toast.error(message);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-[#1C1C1E] border-zinc-700/80 text-zinc-50 max-w-lg">
        <DialogHeader>
          <DialogTitle>Allocate Items</DialogTitle>
        </DialogHeader>

        <div className="grid gap-3 mt-2">
          <SectionHead>Unallocated Line Items</SectionHead>

          {unallocated.length === 0 ? (
            <p className="text-zinc-500 text-sm">All items are already allocated.</p>
          ) : (
            <div className="grid gap-2">
              {unallocated.map((li) => (
                <div
                  key={li.id}
                  className="flex items-center gap-3 p-2.5 bg-[#35353A] rounded border border-zinc-700/80"
                >
                  <div className="flex-1">
                    <div className="text-xs text-zinc-500">
                      Unit price: <Mono color="teal">£{li.unitPrice.toFixed(2)}</Mono>
                    </div>
                  </div>
                  <input
                    value={skuCodes[li.id] ?? ""}
                    onChange={(e) =>
                      setSkuCodes((prev) => ({ ...prev, [li.id]: e.target.value }))
                    }
                    placeholder="e.g. 75367-1.1"
                    className="w-36 px-2 py-1.5 bg-[#2A2A2E] border border-zinc-700/80 rounded text-zinc-50 text-xs font-mono"
                  />
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-2 pt-2 border-t border-zinc-700/80">
            <button
              onClick={handleAllocate}
              disabled={allocate.isPending || unallocated.length === 0}
              className="flex-1 bg-amber-500 text-zinc-900 border-none rounded-md py-2.5 font-bold text-[13px] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed hover:bg-amber-400 transition-colors"
            >
              {allocate.isPending ? "Allocating…" : "Allocate Items"}
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2.5 bg-[#3F3F46] text-zinc-400 border border-zinc-700/80 rounded-md text-[13px] cursor-pointer hover:text-zinc-200 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
