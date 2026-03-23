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
import { SectionHead } from "./ui-primitives";
import { toast } from "sonner";

interface ShipOrderDialogProps {
  open: boolean;
  onClose: () => void;
  orderId: string;
}

const CARRIERS = ["Royal Mail", "Evri", "DPD", "Yodel", "UPS", "FedEx", "Other"];

export function ShipOrderDialog({ open, onClose, orderId }: ShipOrderDialogProps) {
  const queryClient = useQueryClient();
  const [carrier, setCarrier] = useState("Royal Mail");
  const [trackingNumber, setTrackingNumber] = useState("");

  const shipOrder = useMutation({
    mutationFn: async () => {
      const now = new Date().toISOString();

      // Update order
      const { error: orderErr } = await supabase
        .from("sales_order")
        .update({
          status: "shipped",
          carrier,
          tracking_number: trackingNumber.trim() || null,
          shipped_at: now,
        } as never)
        .eq("id", orderId);

      if (orderErr) throw orderErr;

      // Update all linked stock units
      const { error: unitErr } = await supabase
        .from("stock_unit")
        .update({
          v2_status: "shipped",
          shipped_at: now,
        } as never)
        .eq("order_id" as never, orderId)
        .in("v2_status" as never, ["sold"]);

      if (unitErr) throw unitErr;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orderKeys.all });
      queryClient.invalidateQueries({ queryKey: orderKeys.detail(orderId) });
      queryClient.invalidateQueries({ queryKey: stockUnitKeys.all });
      toast.success("Order shipped");
      setCarrier("Royal Mail");
      setTrackingNumber("");
      onClose();
    },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-white border-zinc-200 text-zinc-900 max-w-md">
        <DialogHeader>
          <DialogTitle>Ship Order</DialogTitle>
        </DialogHeader>

        <div className="grid gap-3 mt-2">
          <div>
            <SectionHead>Carrier</SectionHead>
            <select
              value={carrier}
              onChange={(e) => setCarrier(e.target.value)}
              className="w-full px-2.5 py-2 bg-zinc-50 border border-zinc-200 rounded text-zinc-900 text-[13px]"
            >
              {CARRIERS.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          <div>
            <SectionHead>Tracking Number</SectionHead>
            <input
              value={trackingNumber}
              onChange={(e) => setTrackingNumber(e.target.value)}
              placeholder="e.g. JD001234567GB"
              className="w-full px-2.5 py-2 bg-zinc-50 border border-zinc-200 rounded text-zinc-900 text-[13px]"
            />
          </div>

          <div className="flex gap-2 pt-2 border-t border-zinc-200">
            <button
              onClick={() => shipOrder.mutate()}
              disabled={shipOrder.isPending}
              className="flex-1 bg-amber-500 text-zinc-900 border-none rounded-md py-2.5 font-bold text-[13px] cursor-pointer disabled:opacity-50 hover:bg-amber-400 transition-colors"
            >
              {shipOrder.isPending ? "Shipping…" : "Confirm Shipment"}
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
