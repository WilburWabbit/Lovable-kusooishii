import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { stockUnitKeys } from "@/hooks/admin/use-stock-units";
import { productKeys } from "@/hooks/admin/use-products";
import { SectionHead } from "./ui-primitives";
import { toast } from "sonner";

interface WriteOffDialogProps {
  open: boolean;
  onClose: () => void;
  stockUnitIds: string[];
}

const WRITEOFF_REASONS = ["Damaged", "Lost", "Missing", "Quality issue", "Other"];

export function WriteOffDialog({ open, onClose, stockUnitIds }: WriteOffDialogProps) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState(WRITEOFF_REASONS[0]);
  const [notes, setNotes] = useState("");

  const writeOff = useMutation({
    mutationFn: async () => {
      if (stockUnitIds.length === 0) throw new Error("No units selected");

      // Collect affected SKU codes for stats recalc
      const { data: units } = await supabase
        .from("stock_unit")
        .select("id, sku_id")
        .in("id", stockUnitIds);

      const skuIds = new Set<string>();
      for (const u of ((units ?? []) as Record<string, unknown>[])) {
        if (u.sku_id) skuIds.add(u.sku_id as string);
      }

      // Mark units as written off (terminal state)
      const { error } = await supabase
        .from("stock_unit")
        .update({
          v2_status: "refunded", // Reusing terminal status for writeoffs
          order_id: null,
        } as never)
        .in("id", stockUnitIds);

      if (error) throw error;

      // Recalculate variant stats for affected SKUs
      for (const skuId of skuIds) {
        const { data: skuRow } = await supabase
          .from("sku")
          .select("sku_code")
          .eq("id", skuId)
          .single();

        if (skuRow) {
          await supabase.rpc("v2_recalculate_variant_stats" as never, {
            p_sku_code: (skuRow as unknown as Record<string, unknown>).sku_code,
          } as never);
        }
      }

      // Audit event
      await supabase.from("audit_event").insert({
        entity_type: "stock_unit",
        entity_id: stockUnitIds[0],
        trigger_type: "admin_action",
        actor_type: "user",
        source_system: "admin_v2",
        after_json: {
          action: "write_off",
          reason,
          notes: notes.trim() || null,
          unit_ids: stockUnitIds,
          count: stockUnitIds.length,
        },
      });

      // Push updated stock counts to eBay (non-blocking). Writing off
      // units reduces availability — listings must drop quantity (or be
      // withdrawn if zero) so they can't be sold on eBay.
      if (skuIds.size > 0) {
        supabase.functions
          .invoke("sync-ebay-quantity", { body: { skuIds: Array.from(skuIds) } })
          .catch((err) => console.warn("eBay quantity sync failed (non-blocking):", err));
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: stockUnitKeys.all });
      queryClient.invalidateQueries({ queryKey: productKeys.all });
      toast.success(`${stockUnitIds.length} unit(s) written off`);
      setReason(WRITEOFF_REASONS[0]);
      setNotes("");
      onClose();
    },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-white border-zinc-200 text-zinc-900 max-w-md">
        <DialogHeader>
          <DialogTitle>Write Off {stockUnitIds.length} Unit{stockUnitIds.length !== 1 ? "s" : ""}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-3 mt-2">
          <div>
            <SectionHead>Reason</SectionHead>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full px-2.5 py-2 bg-zinc-50 border border-zinc-200 rounded text-zinc-900 text-[13px]"
            >
              {WRITEOFF_REASONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>

          <div>
            <SectionHead>Notes</SectionHead>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Additional details…"
              className="w-full px-2.5 py-2 bg-zinc-50 border border-zinc-200 rounded text-zinc-900 text-[13px] resize-y font-sans"
            />
          </div>

          <div className="flex gap-2 pt-2 border-t border-zinc-200">
            <button
              onClick={() => writeOff.mutate()}
              disabled={writeOff.isPending}
              className="flex-1 bg-red-500 text-white border-none rounded-md py-2.5 font-bold text-[13px] cursor-pointer disabled:opacity-50 hover:bg-red-400 transition-colors"
            >
              {writeOff.isPending ? "Writing off…" : "Confirm Write Off"}
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
