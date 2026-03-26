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
import { Mono, SectionHead } from "./ui-primitives";
import { toast } from "sonner";

interface CashSaleFormProps {
  open: boolean;
  onClose: () => void;
}

interface LineItem {
  skuCode: string;
  unitPrice: string;
}

const PAYMENT_METHODS = [
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "split", label: "Split (Cash + Card)" },
] as const;

export function CashSaleForm({ open, onClose }: CashSaleFormProps) {
  const queryClient = useQueryClient();

  const [lineItems, setLineItems] = useState<LineItem[]>([{ skuCode: "", unitPrice: "" }]);
  const [paymentMethod, setPaymentMethod] = useState<string>("cash");
  const [customerName, setCustomerName] = useState("");

  const createCashSale = useMutation({
    mutationFn: async () => {
      const validLines = lineItems.filter((li) => li.skuCode.trim() && li.unitPrice.trim());
      if (validLines.length === 0) throw new Error("Add at least one line item");

      const grossTotal = validLines.reduce((sum, li) => sum + parseFloat(li.unitPrice), 0);
      const vatAmount = Math.round((grossTotal - grossTotal / 1.2) * 100) / 100;
      const netAmount = Math.round((grossTotal / 1.2) * 100) / 100;

      // Find or create customer
      let customerId: string | null = null;
      const displayName = customerName.trim() || "Cash Sales";

      const { data: existingCustomer } = await supabase
        .from("customer")
        .select("id")
        .eq("display_name", displayName)
        .maybeSingle();

      if (existingCustomer) {
        customerId = (existingCustomer as Record<string, unknown>).id as string;
      } else if (displayName !== "Cash Sales") {
        const { data: newCustomer } = await supabase
          .from("customer")
          .insert({ display_name: displayName } as never)
          .select("id")
          .single();
        if (newCustomer) {
          customerId = (newCustomer as Record<string, unknown>).id as string;
        }
      } else {
        // Use standing Cash Sales customer
        const { data: cashCustomer } = await supabase
          .from("customer")
          .select("id")
          .eq("display_name", "Cash Sales")
          .maybeSingle();
        customerId = cashCustomer
          ? (cashCustomer as Record<string, unknown>).id as string
          : null;
      }

      // Generate order number
      const { data: lastOrder } = await supabase
        .from("sales_order")
        .select("order_number")
        .like("order_number", "KO-%")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const lastNum = lastOrder
        ? parseInt(((lastOrder as Record<string, unknown>).order_number as string)
            .replace("KO-", ""), 10) || 0
        : 0;
      const orderNumber = `KO-${String(lastNum + 1).padStart(4, "0")}`;

      // Create order
      const { data: newOrder, error: orderErr } = await supabase
        .from("sales_order")
        .insert({
          order_number: orderNumber,
          customer_id: customerId,
          origin_channel: "in_person",
          guest_email: `cash-sale-${orderNumber}@internal.local`,
          v2_status: "new",
          gross_total: grossTotal,
          tax_total: vatAmount,
          net_amount: netAmount,
          payment_method: paymentMethod,
          blue_bell_club: false,
          qbo_sync_status: "pending",
        } as never)
        .select("id")
        .single();

      if (orderErr) throw new Error(`Failed to create order: ${orderErr.message}`);
      const orderId = (newOrder as Record<string, unknown>).id as string;

      // Create line items + FIFO consumption
      let allAllocated = true;
      for (const li of validLines) {
        const skuCode = li.skuCode.trim();
        const unitPrice = parseFloat(li.unitPrice);

        // Find local SKU
        const { data: skuRow } = await supabase
          .from("sku")
          .select("id")
          .eq("sku_code", skuCode)
          .maybeSingle();

        const skuId = skuRow ? (skuRow as Record<string, unknown>).id as string : null;
        let stockUnitId: string | null = null;
        let cogs: number | null = null;

        // FIFO consumption
        if (skuCode) {
          try {
            const { data: consumed, error: fifoErr } = await supabase
              .rpc("v2_consume_fifo_unit" as never, { p_sku_code: skuCode } as never);

            if (!fifoErr && consumed) {
              const unit = consumed as unknown as Record<string, unknown>;
              stockUnitId = unit.id as string;
              cogs = unit.landed_cost as number;

              await supabase
                .from("stock_unit")
                .update({
                  order_id: orderId,
                  sold_at: new Date().toISOString(),
                } as never)
                .eq("id", stockUnitId);
            } else {
              allAllocated = false;
            }
          } catch {
            allAllocated = false;
          }
        } else {
          allAllocated = false;
        }

        await supabase
          .from("sales_order_line")
          .insert({
            sales_order_id: orderId,
            sku_id: skuId,
            stock_unit_id: stockUnitId,
            unit_price: unitPrice,
            quantity: 1,
            cogs,
          } as never);
      }

      // If not all allocated, mark as needs_allocation
      if (!allAllocated) {
        await supabase
          .from("sales_order")
          .update({ v2_status: "needs_allocation" } as never)
          .eq("id", orderId);
      }

      // Fire-and-forget: QBO sync
      supabase.functions
        .invoke("qbo-sync-sales-receipt", { body: { orderId } })
        .catch(() => {});

      return { orderId, orderNumber, allAllocated };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: orderKeys.all });
      queryClient.invalidateQueries({ queryKey: stockUnitKeys.all });
      toast.success(
        result.allAllocated
          ? `Cash sale ${result.orderNumber} created`
          : `Cash sale ${result.orderNumber} created — some items need allocation`,
      );
      resetForm();
      onClose();
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  function resetForm() {
    setLineItems([{ skuCode: "", unitPrice: "" }]);
    setPaymentMethod("cash");
    setCustomerName("");
  }

  function addLine() {
    setLineItems((prev) => [...prev, { skuCode: "", unitPrice: "" }]);
  }

  function removeLine(index: number) {
    if (lineItems.length <= 1) return;
    setLineItems((prev) => prev.filter((_, i) => i !== index));
  }

  function updateLine(index: number, field: keyof LineItem, value: string) {
    setLineItems((prev) =>
      prev.map((li, i) => (i === index ? { ...li, [field]: value } : li)),
    );
  }

  const total = lineItems.reduce((sum, li) => {
    const val = parseFloat(li.unitPrice);
    return sum + (isNaN(val) ? 0 : val);
  }, 0);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-white border-zinc-200 text-zinc-900 max-w-lg">
        <DialogHeader>
          <DialogTitle>New Cash Sale</DialogTitle>
        </DialogHeader>

        <div className="grid gap-3 mt-2">
          {/* Customer */}
          <div>
            <SectionHead>Customer (optional)</SectionHead>
            <input
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Leave blank for Cash Sales"
              className="w-full mt-1 px-2.5 py-2 bg-white border border-zinc-200 rounded text-zinc-900 text-[13px]"
            />
          </div>

          {/* Payment method */}
          <div>
            <SectionHead>Payment method</SectionHead>
            <div className="flex gap-2 mt-1">
              {PAYMENT_METHODS.map((pm) => (
                <button
                  key={pm.value}
                  onClick={() => setPaymentMethod(pm.value)}
                  className={`flex-1 px-3 py-2 rounded text-[13px] font-medium border transition-colors ${
                    paymentMethod === pm.value
                      ? "bg-amber-500 text-zinc-900 border-amber-500"
                      : "bg-zinc-50 text-zinc-500 border-zinc-200 hover:text-zinc-700"
                  }`}
                >
                  {pm.label}
                </button>
              ))}
            </div>
          </div>

          {/* Line items */}
          <div>
            <SectionHead>Line items</SectionHead>
            <div className="grid gap-2 mt-1">
              {lineItems.map((li, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-2 p-2.5 bg-zinc-50 rounded border border-zinc-200"
                >
                  <input
                    value={li.skuCode}
                    onChange={(e) => updateLine(idx, "skuCode", e.target.value)}
                    placeholder="SKU e.g. 75367-1.1"
                    className="flex-1 px-2 py-1.5 bg-white border border-zinc-200 rounded text-zinc-900 text-xs font-mono"
                  />
                  <div className="flex items-center gap-1">
                    <span className="text-zinc-500 text-xs">£</span>
                    <input
                      value={li.unitPrice}
                      onChange={(e) => updateLine(idx, "unitPrice", e.target.value)}
                      placeholder="0.00"
                      type="number"
                      step="0.01"
                      min="0"
                      className="w-20 px-2 py-1.5 bg-white border border-zinc-200 rounded text-zinc-900 text-xs font-mono text-right"
                    />
                  </div>
                  {lineItems.length > 1 && (
                    <button
                      onClick={() => removeLine(idx)}
                      className="text-zinc-500 hover:text-red-400 text-xs px-1 transition-colors"
                      title="Remove line"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button
              onClick={addLine}
              className="mt-2 text-amber-500 text-xs hover:text-amber-400 transition-colors"
            >
              + Add line
            </button>
          </div>

          {/* Total */}
          <div className="flex items-center justify-between pt-2 border-t border-zinc-200">
            <span className="text-zinc-500 text-[13px]">Total</span>
            <Mono color="teal">£{total.toFixed(2)}</Mono>
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-2">
            <button
              onClick={() => createCashSale.mutate()}
              disabled={createCashSale.isPending || total <= 0}
              className="flex-1 bg-amber-500 text-zinc-900 border-none rounded-md py-2.5 font-bold text-[13px] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed hover:bg-amber-400 transition-colors"
            >
              {createCashSale.isPending ? "Creating…" : "Create Sale"}
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
