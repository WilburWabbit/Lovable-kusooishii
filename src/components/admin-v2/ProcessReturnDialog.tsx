import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { orderKeys } from "@/hooks/admin/use-orders";
import { stockUnitKeys } from "@/hooks/admin/use-stock-units";
import type { OrderLineItem } from "@/lib/types/admin";
import { Mono, SectionHead } from "./ui-primitives";
import { toast } from "sonner";

interface ProcessReturnDialogProps {
  open: boolean;
  onClose: () => void;
  orderId: string;
  lineItems: OrderLineItem[];
}

type ReturnAction = "refund" | "restock";

export function ProcessReturnDialog({ open, onClose, orderId, lineItems }: ProcessReturnDialogProps) {
  const queryClient = useQueryClient();

  // Only show lines with stock units in return_pending
  const returnableLines = lineItems.filter((li) => li.stockUnitId);

  const [actions, setActions] = useState<Record<string, ReturnAction>>(() => {
    const initial: Record<string, ReturnAction> = {};
    for (const li of returnableLines) {
      initial[li.id] = "refund";
    }
    return initial;
  });

  const processReturn = useMutation({
    mutationFn: async () => {
      const affectedSkus = new Set<string>();
      for (const li of returnableLines) {
        if (li.sku) affectedSkus.add(li.sku);
      }

      const lineActions = returnableLines
        .map((li) => ({ line_item_id: li.id, action: actions[li.id] }))
        .filter((entry) => entry.action === "refund" || entry.action === "restock");
      const refundedLineIds = lineActions
        .filter((entry) => entry.action === "refund")
        .map((entry) => entry.line_item_id);

      const { error } = await supabase.rpc("process_order_return" as never, {
        p_sales_order_id: orderId,
        p_line_actions: lineActions,
        p_reason: "Admin return processing",
      } as never);
      if (error) throw error;

      if (refundedLineIds.length > 0) {
        const { error: postingErr } = await supabase.rpc("queue_qbo_refund_posting_intent_for_order" as never, {
          p_sales_order_id: orderId,
          p_refunded_line_ids: refundedLineIds,
        } as never);
        if (postingErr) throw postingErr;
      }

      // Push updated stock counts to eBay (non-blocking). Restocked
      // units re-enter availability; pushing for every affected SKU is
      // safe and idempotent.
      if (affectedSkus.size > 0) {
        supabase.functions
          .invoke("sync-ebay-quantity", { body: { skuCodes: Array.from(affectedSkus) } })
          .catch((err) => console.warn("eBay quantity sync failed (non-blocking):", err));
      }

      if (affectedSkus.size > 0) {
        const { data: skuRows, error: skuErr } = await supabase
          .from("sku")
          .select("id")
          .in("sku_code", Array.from(affectedSkus));

        if (skuErr) throw skuErr;

        for (const sku of (skuRows ?? []) as Array<{ id: string }>) {
          await supabase.rpc("refresh_sku_cost_rollups" as never, { p_sku_id: sku.id } as never);
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orderKeys.all });
      queryClient.invalidateQueries({ queryKey: orderKeys.detail(orderId) });
      queryClient.invalidateQueries({ queryKey: stockUnitKeys.all });
      toast.success("Return processed");
      onClose();
    },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-white border-zinc-200 text-zinc-900 max-w-lg">
        <DialogHeader>
          <DialogTitle>Process Return</DialogTitle>
        </DialogHeader>

        <div className="grid gap-3 mt-2">
          <SectionHead>Per-Item Action</SectionHead>

          <div className="grid gap-2">
            {returnableLines.map((li) => (
              <div
                key={li.id}
                className="flex items-center justify-between p-2.5 bg-zinc-50 rounded border border-zinc-200"
              >
                <div className="flex items-center gap-2 text-xs">
                  <Mono color="amber">{li.sku ?? "—"}</Mono>
                  <Mono color="teal">£{li.unitPrice.toFixed(2)}</Mono>
                </div>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => setActions((prev) => ({ ...prev, [li.id]: "refund" }))}
                    className={`px-2.5 py-1 rounded text-[11px] font-semibold border transition-colors ${
                      actions[li.id] === "refund"
                        ? "bg-red-500/20 border-red-500 text-red-400"
                        : "bg-transparent border-zinc-200 text-zinc-500"
                    }`}
                  >
                    Refund
                  </button>
                  <button
                    onClick={() => setActions((prev) => ({ ...prev, [li.id]: "restock" }))}
                    className={`px-2.5 py-1 rounded text-[11px] font-semibold border transition-colors ${
                      actions[li.id] === "restock"
                        ? "bg-green-500/20 border-green-500 text-green-400"
                        : "bg-transparent border-zinc-200 text-zinc-500"
                    }`}
                  >
                    Restock
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="flex gap-2 pt-2 border-t border-zinc-200">
            <button
              onClick={() => processReturn.mutate()}
              disabled={processReturn.isPending}
              className="flex-1 bg-amber-500 text-zinc-900 border-none rounded-md py-2.5 font-bold text-[13px] cursor-pointer disabled:opacity-50 hover:bg-amber-400 transition-colors"
            >
              {processReturn.isPending ? "Processing…" : "Process Return"}
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2.5 bg-zinc-100 text-zinc-500 border border-zinc-200 rounded-md text-[13px] cursor-pointer hover:text-zinc-700 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
