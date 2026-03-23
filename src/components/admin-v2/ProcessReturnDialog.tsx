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
import type { OrderLineItem, StockUnitStatus } from "@/lib/types/admin";
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
        const action = actions[li.id];
        if (!action || !li.stockUnitId) continue;

        if (action === "refund") {
          // Mark unit as refunded (terminal state)
          await supabase
            .from("stock_unit")
            .update({
              v2_status: "refunded" as StockUnitStatus,
            } as never)
            .eq("id", li.stockUnitId);
        } else if (action === "restock") {
          // Return unit to inventory — set to 'listed' so it's available again
          const now = new Date().toISOString();
          await supabase
            .from("stock_unit")
            .update({
              v2_status: "listed" as StockUnitStatus,
              order_id: null,
              listed_at: now,
            } as never)
            .eq("id", li.stockUnitId);
        }

        if (li.sku) affectedSkus.add(li.sku);
      }

      // Recalculate variant stats for affected SKUs
      for (const skuCode of affectedSkus) {
        await supabase.rpc("v2_recalculate_variant_stats" as never, { p_sku_code: skuCode } as never);
      }

      // Determine final order status based on all line actions
      const allRefunded = returnableLines.every((li) => actions[li.id] === "refund");

      // Update order status
      await supabase
        .from("sales_order")
        .update({
          status: allRefunded ? "complete" : "complete",
        } as never)
        .eq("id", orderId);

      // Trigger QBO RefundReceipt for refunded items (fire-and-forget)
      const refundedLines = returnableLines.filter((li) => actions[li.id] === "refund");
      if (refundedLines.length > 0) {
        supabase.functions
          .invoke("qbo-sync-refund-receipt", {
            body: { orderId, refundedLineIds: refundedLines.map((li) => li.id) },
          })
          .catch((err) => console.warn("QBO refund receipt sync failed (non-blocking):", err));
      }

      // Audit event
      await supabase.from("audit_event").insert({
        entity_type: "sales_order",
        entity_id: orderId,
        trigger_type: "admin_action",
        actor_type: "user",
        source_system: "admin_v2",
        after_json: {
          action: "return_processed",
          line_actions: actions,
          refunded_count: refundedLines.length,
          restocked_count: returnableLines.length - refundedLines.length,
        },
      });
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
