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

interface ReturnDialogProps {
  open: boolean;
  onClose: () => void;
  orderId: string;
  lineItems: OrderLineItem[];
}

const RETURN_REASONS = [
  "Buyer changed mind",
  "Item not as described",
  "Damaged in transit",
  "Wrong item sent",
  "Other",
];

export function ReturnDialog({ open, onClose, orderId, lineItems }: ReturnDialogProps) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState(RETURN_REASONS[0]);
  const [selectedLineIds, setSelectedLineIds] = useState<Set<string>>(new Set());

  const allocatedLines = lineItems.filter((li) => li.stockUnitId);

  const toggleLine = (id: string) => {
    setSelectedLineIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const initiateReturn = useMutation({
    mutationFn: async () => {
      if (selectedLineIds.size === 0) throw new Error("Select at least one item");

      // Update order status
      const { error: orderErr } = await supabase
        .from("sales_order")
        .update({ status: "return_pending" } as never)
        .eq("id", orderId);

      if (orderErr) throw orderErr;

      // Update selected stock units
      const unitIds = allocatedLines
        .filter((li) => selectedLineIds.has(li.id))
        .map((li) => li.stockUnitId)
        .filter((id): id is string => !!id);

      if (unitIds.length > 0) {
        const { error: unitErr } = await supabase
          .from("stock_unit")
          .update({ v2_status: "return_pending" } as never)
          .in("id", unitIds);

        if (unitErr) throw unitErr;
      }

      // Create audit event
      await supabase.from("audit_event").insert({
        entity_type: "sales_order",
        entity_id: orderId,
        trigger_type: "admin_action",
        actor_type: "user",
        source_system: "admin_v2",
        after_json: {
          action: "return_initiated",
          reason,
          unit_ids: unitIds,
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orderKeys.all });
      queryClient.invalidateQueries({ queryKey: orderKeys.detail(orderId) });
      queryClient.invalidateQueries({ queryKey: stockUnitKeys.all });
      toast.success("Return initiated");
      setSelectedLineIds(new Set());
      onClose();
    },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-white border-zinc-200 text-zinc-900 max-w-lg">
        <DialogHeader>
          <DialogTitle>Initiate Return</DialogTitle>
        </DialogHeader>

        <div className="grid gap-3 mt-2">
          <div>
            <SectionHead>Return Reason</SectionHead>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full px-2.5 py-2 bg-zinc-50 border border-zinc-200 rounded text-zinc-900 text-[13px]"
            >
              {RETURN_REASONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>

          <div>
            <SectionHead>Select Items to Return</SectionHead>
            <div className="grid gap-1.5">
              {allocatedLines.map((li) => (
                <label
                  key={li.id}
                  className="flex items-center gap-2.5 p-2 bg-zinc-50 rounded border border-zinc-200 cursor-pointer text-xs"
                >
                  <input
                    type="checkbox"
                    checked={selectedLineIds.has(li.id)}
                    onChange={() => toggleLine(li.id)}
                    className="accent-amber-500"
                  />
                  <Mono color="amber">{li.sku ?? "—"}</Mono>
                  <Mono color="teal">£{li.unitPrice.toFixed(2)}</Mono>
                </label>
              ))}
              {allocatedLines.length === 0 && (
                <p className="text-zinc-500 text-xs">No allocated items to return.</p>
              )}
            </div>
          </div>

          <div className="flex gap-2 pt-2 border-t border-zinc-200">
            <button
              onClick={() => initiateReturn.mutate()}
              disabled={initiateReturn.isPending || selectedLineIds.size === 0}
              className="flex-1 bg-red-500 text-white border-none rounded-md py-2.5 font-bold text-[13px] cursor-pointer disabled:opacity-50 hover:bg-red-400 transition-colors"
            >
              {initiateReturn.isPending ? "Processing…" : `Initiate Return (${selectedLineIds.size} items)`}
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
