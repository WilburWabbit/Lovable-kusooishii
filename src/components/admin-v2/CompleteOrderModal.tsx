import { useState } from "react";
import {
  Check,
  ChevronsUpDown,
  Loader2,
  Plus,
  X,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { orderKeys } from "@/hooks/admin/use-orders";
import { stockUnitKeys } from "@/hooks/admin/use-stock-units";
import { Mono, SectionHead } from "./ui-primitives";
import { toast } from "sonner";

// ─── Types ──────────────────────────────────────────────────

interface CompleteOrderModalProps {
  open: boolean;
  onClose: () => void;
  orderId: string;
  orderNumber: string;
  grossTotal: number;
  notes: string | null;
  customerName: string;
  paymentMethod: string | null;
  orderDate: string;
}

type ProductOption = {
  id: string;
  skuCode: string;
  name: string;
  mpn: string | null;
  price: number;
  qtyOnHand: number;
  searchText: string;
};

type LineItem = {
  key: number;
  pickerOpen: boolean;
  pickerSearch: string;
  skuId: string | null;
  skuCode: string;
  productName: string;
  unitPrice: string;
  quantity: number;
};

type SearchPickerOption = {
  id: string;
  primary: string;
  secondary?: string;
  hint?: string;
  searchText: string;
};

// ─── Helpers ────────────────────────────────────────────────

let nextKey = 1;

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function parseCurrency(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? roundCurrency(parsed) : 0;
}

function normalizeSearch(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function createEmptyLine(): LineItem {
  return {
    key: nextKey++,
    pickerOpen: false,
    pickerSearch: "",
    skuId: null,
    skuCode: "",
    productName: "",
    unitPrice: "",
    quantity: 1,
  };
}

function extractMemo(notes: string | null): string | null {
  if (!notes) return null;
  const match = notes.match(/description=([^.]*?)(?:\s+\w+=|\.\s|$)/);
  if (!match) return null;
  const memo = match[1].trim();
  return memo || null;
}

function filterOptions(
  options: SearchPickerOption[],
  query: string,
  limit = 12,
): SearchPickerOption[] {
  const normalized = normalizeSearch(query);
  if (!normalized) return options.slice(0, limit);
  return options
    .filter((o) => o.searchText.includes(normalized))
    .slice(0, limit);
}

function buildProductOptions(products: ProductOption[]): SearchPickerOption[] {
  return products.map((p) => ({
    id: p.id,
    primary: p.skuCode,
    secondary: p.name,
    hint: `£${p.price.toFixed(2)} · ${p.qtyOnHand} listed`,
    searchText: p.searchText,
  }));
}

// ─── Search Picker (reused pattern from CashSaleForm) ───────

function SearchPicker({
  open,
  onOpenChange,
  searchValue,
  onSearchValueChange,
  triggerLabel,
  placeholder,
  options,
  selectedId,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  searchValue: string;
  onSearchValueChange: (value: string) => void;
  triggerLabel: string;
  placeholder: string;
  options: SearchPickerOption[];
  selectedId: string | null;
  onSelect: (option: SearchPickerOption) => void;
}) {
  const filtered = filterOptions(options, searchValue);

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "w-full flex items-center justify-between rounded-md border border-zinc-200 bg-white px-3 py-2 text-left text-[13px] text-zinc-900 transition-colors",
            "hover:border-zinc-300",
          )}
        >
          <span className={cn("truncate", !triggerLabel && "text-zinc-400")}>
            {triggerLabel || placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 text-zinc-400" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[420px] p-0">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search SKU or product name…"
            value={searchValue}
            onValueChange={onSearchValueChange}
          />
          <CommandList>
            <CommandEmpty>No products found</CommandEmpty>
            <CommandGroup>
              {filtered.map((option) => (
                <CommandItem
                  key={option.id}
                  value={option.searchText}
                  onSelect={() => {
                    onSelect(option);
                    onOpenChange(false);
                  }}
                  className="flex items-start gap-2 py-2"
                >
                  <Check
                    className={cn(
                      "mt-0.5 h-4 w-4 text-amber-500",
                      selectedId === option.id ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-zinc-900">
                      {option.primary}
                    </div>
                    {option.secondary && (
                      <div className="truncate text-xs text-zinc-500">
                        {option.secondary}
                      </div>
                    )}
                  </div>
                  {option.hint && (
                    <div className="shrink-0 text-[11px] text-zinc-400">
                      {option.hint}
                    </div>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ─── Component ──────────────────────────────────────────────

export function CompleteOrderModal({
  open,
  onClose,
  orderId,
  orderNumber,
  grossTotal,
  notes,
  customerName,
  paymentMethod,
  orderDate,
}: CompleteOrderModalProps) {
  const queryClient = useQueryClient();
  const [lineItems, setLineItems] = useState<LineItem[]>([createEmptyLine()]);

  const lookupQuery = useQuery({
    queryKey: ["complete-order", "lookups"],
    enabled: open,
    queryFn: async () => {
      const [skuResponse, stockResponse] = await Promise.all([
        supabase
          .from("sku")
          .select("id, sku_code, price, condition_grade, name, product:product_id(name, mpn)")
          .eq("active_flag", true)
          .eq("saleable_flag", true)
          .order("sku_code", { ascending: true }),
        supabase
          .from("v2_variant_stock_summary" as never)
          .select("sku_code, qty_on_hand"),
      ]);

      if (skuResponse.error) throw skuResponse.error;
      if (stockResponse.error) throw stockResponse.error;

      const stockMap = new Map<string, number>();
      for (const row of (stockResponse.data ?? []) as Record<string, unknown>[]) {
        stockMap.set(row.sku_code as string, Number(row.qty_on_hand ?? 0));
      }

      const products: ProductOption[] = ((skuResponse.data ?? []) as Record<string, unknown>[]).map((row) => {
        const product = (row.product as Record<string, unknown> | null) ?? null;
        const fallbackName = (row.name as string) ?? (row.sku_code as string);
        const productName = (product?.name as string) ?? fallbackName;
        const mpn = (product?.mpn as string) ?? (row.sku_code as string).split(".")[0] ?? null;

        return {
          id: row.id as string,
          skuCode: row.sku_code as string,
          name: productName,
          mpn,
          price: Number(row.price ?? 0),
          qtyOnHand: stockMap.get(row.sku_code as string) ?? 0,
          searchText: normalizeSearch(`${row.sku_code} ${productName} ${mpn ?? ""}`),
        };
      });

      return { products };
    },
  });

  const productOptions = buildProductOptions(lookupQuery.data?.products ?? []);

  // ─── Line item helpers ────────────────────────────────────

  function addLine() {
    setLineItems((prev) => [...prev, createEmptyLine()]);
  }

  function removeLine(key: number) {
    setLineItems((prev) => {
      if (prev.length === 1) return prev;
      return prev.filter((l) => l.key !== key);
    });
  }

  function updateLine(key: number, updater: (line: LineItem) => LineItem) {
    setLineItems((prev) => prev.map((l) => (l.key === key ? updater(l) : l)));
  }

  function selectProduct(lineKey: number, optionId: string) {
    const product = (lookupQuery.data?.products ?? []).find((p) => p.id === optionId);
    if (!product) return;

    updateLine(lineKey, (line) => ({
      ...line,
      skuId: product.id,
      skuCode: product.skuCode,
      productName: product.name,
      pickerSearch: `${product.skuCode} · ${product.name}`,
      pickerOpen: false,
      unitPrice: product.price > 0 ? product.price.toFixed(2) : line.unitPrice,
    }));
  }

  // ─── Totals ───────────────────────────────────────────────

  const lineTotal = roundCurrency(
    lineItems.reduce((sum, line) => {
      const price = parseCurrency(line.unitPrice);
      const qty = Math.max(1, Math.floor(line.quantity));
      return sum + roundCurrency(price * qty);
    }, 0),
  );

  const difference = roundCurrency(lineTotal - grossTotal);
  const isMatched = Math.abs(difference) <= 0.01;

  // ─── Validation ───────────────────────────────────────────

  const hasLines = lineItems.some((l) => l.skuId !== null);
  const allLinesValid = lineItems.every(
    (l) => l.skuId !== null || (l.skuId === null && l.unitPrice === "" && l.productName === ""),
  );
  const validLines = lineItems.filter((l) => l.skuId !== null);
  const canSubmit = validLines.length > 0 && lineItems.every((l) => l.skuId !== null);

  // ─── Mutation ─────────────────────────────────────────────

  const completeOrder = useMutation({
    mutationFn: async () => {
      const prepared = lineItems.filter((l) => l.skuId !== null);
      if (prepared.length === 0) throw new Error("Add at least one line item");

      let allAllocated = true;

      for (const line of prepared) {
        const unitPrice = parseCurrency(line.unitPrice);
        const qty = Math.max(1, Math.floor(line.quantity));

        for (let i = 0; i < qty; i++) {
          const { data: insertedLine, error: lineErr } = await supabase
            .from("sales_order_line")
            .insert({
              sales_order_id: orderId,
              sku_id: line.skuId!,
              quantity: 1,
              unit_price: unitPrice,
              line_discount: 0,
              line_total: unitPrice,
            } as never)
            .select("id")
            .single();

          if (lineErr) throw new Error(`Failed to create line item: ${lineErr.message}`);

          const lineId = (insertedLine as Record<string, unknown>).id as string;

          try {
            const { data: consumedUnit, error: fifoErr } = await supabase
              .rpc("v2_consume_fifo_unit" as never, { p_sku_code: line.skuCode } as never);

            if (fifoErr || !consumedUnit) {
              allAllocated = false;
              continue;
            }

            const unit = consumedUnit as Record<string, unknown>;
            const stockUnitId = unit.id as string;
            const cogs = Number(unit.landed_cost ?? 0);

            const { error: lineUpdateErr } = await supabase
              .from("sales_order_line")
              .update({ stock_unit_id: stockUnitId, cogs } as never)
              .eq("id", lineId);

            if (lineUpdateErr) throw lineUpdateErr;

            const { error: stockErr } = await supabase
              .from("stock_unit")
              .update({ order_id: orderId } as never)
              .eq("id", stockUnitId);

            if (stockErr) throw stockErr;
          } catch {
            allAllocated = false;
          }
        }
      }

      // Recalculate order totals — Stripe grossTotal is authoritative
      const merchandiseSubtotal = roundCurrency(grossTotal / 1.2);
      const taxTotal = roundCurrency(grossTotal - merchandiseSubtotal);

      const { error: orderUpdateErr } = await supabase
        .from("sales_order")
        .update({
          merchandise_subtotal: merchandiseSubtotal,
          tax_total: taxTotal,
          net_amount: merchandiseSubtotal,
          v2_status: allAllocated ? "new" : "needs_allocation",
          qbo_sync_status: allAllocated ? "pending" : "needs_manual_review",
        } as never)
        .eq("id", orderId);

      if (orderUpdateErr) throw new Error(`Failed to update order: ${orderUpdateErr.message}`);

      // Trigger QBO sync if fully allocated
      if (allAllocated) {
        supabase.functions.invoke("qbo-trigger-sync").catch(() => {});
      }

      // Dismiss admin alert for this order
      await supabase
        .from("admin_alert" as never)
        .update({ dismissed_at: new Date().toISOString() } as never)
        .eq("entity_id" as never, orderId)
        .eq("category" as never, "stripe_pos_sale_needs_allocation");

      return { allAllocated };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: orderKeys.all });
      queryClient.invalidateQueries({ queryKey: stockUnitKeys.all });
      toast.success(
        result.allAllocated
          ? `Order ${orderNumber} completed — QBO sync will follow shortly`
          : `Order ${orderNumber} completed. Some units still need allocation before QBO sync.`,
      );
      setLineItems([createEmptyLine()]);
      onClose();
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  // ─── Memo extraction ──────────────────────────────────────

  const memo = extractMemo(notes);

  // ─── Render ───────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-zinc-900 text-base font-semibold">
            Complete Order {orderNumber}
          </DialogTitle>
        </DialogHeader>

        {/* ─── Section 1: Payment Summary ────────────────── */}
        <div className="space-y-3 pt-2">
          <SectionHead>Payment Summary</SectionHead>
          <div className="flex items-baseline gap-3">
            <Mono color="teal" className="text-2xl font-bold">
              £{grossTotal.toFixed(2)}
            </Mono>
            <span className="text-[13px] text-zinc-500">
              Stripe in-person payment
            </span>
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-[13px]">
            <div className="text-zinc-500">Customer</div>
            <div className="text-zinc-900 font-medium">{customerName}</div>
            <div className="text-zinc-500">Payment method</div>
            <div className="text-zinc-900">{paymentMethod ?? "Card"}</div>
            <div className="text-zinc-500">Date</div>
            <div className="text-zinc-900">{orderDate}</div>
          </div>
          <div className="mt-2">
            <div className="text-[11px] text-zinc-500 uppercase tracking-wide mb-1">
              Memo
            </div>
            {memo ? (
              <p className="text-[13px] text-zinc-700 italic">{memo}</p>
            ) : (
              <p className="text-[13px] text-zinc-500">No memo</p>
            )}
          </div>
        </div>

        {/* ─── Section 2: Line Items ─────────────────────── */}
        <div className="space-y-3 pt-4 border-t border-zinc-100 mt-4">
          <SectionHead>Line Items</SectionHead>

          <div className="space-y-2">
            {lineItems.map((line, idx) => (
              <div
                key={line.key}
                className="flex items-start gap-2"
              >
                <div className="flex-1 min-w-0">
                  <SearchPicker
                    open={line.pickerOpen}
                    onOpenChange={(isOpen) =>
                      updateLine(line.key, (l) => ({ ...l, pickerOpen: isOpen }))
                    }
                    searchValue={line.pickerSearch}
                    onSearchValueChange={(val) =>
                      updateLine(line.key, (l) => ({ ...l, pickerSearch: val }))
                    }
                    triggerLabel={
                      line.skuId
                        ? `${line.skuCode} · ${line.productName}`
                        : ""
                    }
                    placeholder="Select product…"
                    options={productOptions}
                    selectedId={line.skuId}
                    onSelect={(opt) => selectProduct(line.key, opt.id)}
                  />
                </div>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={line.unitPrice}
                  onChange={(e) =>
                    updateLine(line.key, (l) => ({
                      ...l,
                      unitPrice: e.target.value,
                    }))
                  }
                  placeholder="Price"
                  className="w-24 rounded-md border border-zinc-200 bg-white px-3 py-2 text-[13px] text-zinc-900 text-right font-mono"
                />
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={line.quantity}
                  onChange={(e) =>
                    updateLine(line.key, (l) => ({
                      ...l,
                      quantity: Math.max(1, Number.parseInt(e.target.value) || 1),
                    }))
                  }
                  className="w-16 rounded-md border border-zinc-200 bg-white px-2 py-2 text-[13px] text-zinc-900 text-center font-mono"
                />
                <button
                  type="button"
                  onClick={() => removeLine(line.key)}
                  className="p-2 text-zinc-400 hover:text-red-500 transition-colors"
                  disabled={lineItems.length === 1}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={addLine}
            className="flex items-center gap-1.5 text-[13px] text-zinc-500 hover:text-zinc-700 transition-colors mt-1"
          >
            <Plus className="h-3.5 w-3.5" />
            Add line
          </button>

          {/* ─── Running totals comparison ─────────────── */}
          <div className="mt-3 pt-3 border-t border-zinc-100 space-y-1">
            <div className="flex items-center justify-between text-[13px]">
              <span className="text-zinc-500">Line total</span>
              <Mono className={isMatched ? "text-green-600" : "text-amber-500"}>
                £{lineTotal.toFixed(2)}
              </Mono>
            </div>
            <div className="flex items-center justify-between text-[13px]">
              <span className="text-zinc-500">Payment</span>
              <Mono color="teal">£{grossTotal.toFixed(2)}</Mono>
            </div>
            {!isMatched && lineTotal > 0 && (
              <div className="flex items-center justify-between text-[13px]">
                <span className="text-amber-600 font-medium">
                  {difference > 0 ? "Overage" : "Shortfall"}
                </span>
                <Mono color="amber">
                  £{Math.abs(difference).toFixed(2)}
                </Mono>
              </div>
            )}
          </div>
        </div>

        {/* ─── Section 3: Footer ─────────────────────────── */}
        <div className="flex items-center justify-end gap-3 pt-4 border-t border-zinc-100 mt-4">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-md text-[13px] font-medium text-zinc-600 bg-zinc-100 hover:bg-zinc-200 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canSubmit || completeOrder.isPending}
            onClick={() => completeOrder.mutate()}
            className={cn(
              "px-4 py-2 rounded-md text-[13px] font-bold transition-colors",
              "bg-teal-500 text-zinc-900 hover:bg-teal-400",
              "disabled:opacity-50 disabled:cursor-not-allowed",
            )}
          >
            {completeOrder.isPending ? (
              <span className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Processing…
              </span>
            ) : (
              "Complete Order"
            )}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
