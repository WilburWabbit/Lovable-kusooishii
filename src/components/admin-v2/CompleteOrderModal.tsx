import { useState } from "react";
import {
  Check,
  ChevronsUpDown,
  Loader2,
  Plus,
  X,
  CreditCard,
  Banknote,
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
import { splitGrossToNetVat } from "@/lib/utils/vat";
import { Mono, SectionHead } from "./ui-primitives";
import { Switch } from "@/components/ui/switch";
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
  const [cardAmount, setCardAmount] = useState<string>(grossTotal.toFixed(2));
  const [cashAmount, setCashAmount] = useState<string>("0.00");
  const [discount, setDiscount] = useState<string>("0.00");
  const [blueBellDonation, setBlueBellDonation] = useState(false);

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

  const discountAmount = parseCurrency(discount);
  const netTotal = roundCurrency(lineTotal - discountAmount);
  const cardValue = parseCurrency(cardAmount);
  const cashValue = roundCurrency(Math.max(0, netTotal - cardValue));
  const totalPayment = roundCurrency(cardValue + cashValue);
  const isBalanced = Math.abs(totalPayment - netTotal) <= 0.01;
  const hasCashPortion = cashValue > 0.01;

  // ─── Validation ───────────────────────────────────────────

  const validLines = lineItems.filter((l) => l.skuId !== null);
  const canSubmit = validLines.length > 0 && lineItems.every((l) => l.skuId !== null) && netTotal > 0;

  // ─── Mutation ─────────────────────────────────────────────

  const completeOrder = useMutation({
    mutationFn: async () => {
      const prepared = lineItems.filter((l) => l.skuId !== null);
      if (prepared.length === 0) throw new Error("Add at least one line item");

      let allAllocated = true;

      for (const line of prepared) {
        const unitGrossPrice = parseCurrency(line.unitPrice);
        const unitNetPrice = splitGrossToNetVat(unitGrossPrice).net;
        const qty = Math.max(1, Math.floor(line.quantity));

        for (let i = 0; i < qty; i++) {
          const { data: insertedLine, error: lineErr } = await supabase
            .from("sales_order_line")
            .insert({
              sales_order_id: orderId,
              sku_id: line.skuId!,
              quantity: 1,
              unit_price: unitNetPrice,
              line_discount: 0,
              line_total: unitNetPrice,
            } as never)
            .select("id")
            .single();

          if (lineErr) throw new Error(`Failed to create line item: ${lineErr.message}`);

          const lineId = (insertedLine as Record<string, unknown>).id as string;

          try {
            const { data: allocation, error: allocationErr } = await supabase
              .rpc("allocate_stock_for_order_line" as never, {
                p_sales_order_line_id: lineId,
              } as never);

            if (allocationErr) throw allocationErr;

            const allocationResult = allocation as Record<string, unknown> | null;
            if (allocationResult?.status !== "allocated") {
              allAllocated = false;
            }
          } catch {
            allAllocated = false;
          }
        }
      }

      // Build updated notes
      const noteParts: string[] = [];
      if (notes) noteParts.push(notes);
      if (hasCashPortion) noteParts.push(`cash_amount=${cashValue.toFixed(2)}`);
      if (discountAmount > 0) noteParts.push(`discount_applied=${discountAmount.toFixed(2)}`);
      if (blueBellDonation) noteParts.push("blue_bell_donation=true");
      const updatedNotes = noteParts.join(". ");

      // Recalculate order totals — full sale value is authoritative
      const saleGross = netTotal;
      const merchandiseSubtotal = roundCurrency(saleGross / 1.2);
      const taxTotal = roundCurrency(saleGross - merchandiseSubtotal);

      const { error: orderUpdateErr } = await supabase
        .from("sales_order")
        .update({
          gross_total: saleGross,
          merchandise_subtotal: merchandiseSubtotal,
          tax_total: taxTotal,
	          net_amount: merchandiseSubtotal,
	          discount_total: discountAmount > 0 ? discountAmount : 0,
	          global_tax_calculation: "TaxExcluded",
	          payment_method: hasCashPortion ? "split" : (paymentMethod ?? "card"),
          notes: updatedNotes || null,
          v2_status: allAllocated ? "new" : "needs_allocation",
          qbo_sync_status: allAllocated ? "pending" : "needs_manual_review",
        } as never)
        .eq("id", orderId);

      if (orderUpdateErr) throw new Error(`Failed to update order: ${orderUpdateErr.message}`);

      if (blueBellDonation) {
        const { error: programError } = await supabase
          .rpc("record_sales_program_accrual" as never, {
            p_sales_order_id: orderId,
            p_program_code: "blue_bell",
            p_attribution_source: "staff_flag",
            p_basis_amount: saleGross,
            p_discount_amount: discountAmount,
            p_commission_amount: roundCurrency(saleGross * 0.05),
          } as never);

        if (programError) {
          throw new Error(`Failed to record Blue Bell programme accrual: ${programError.message}`);
        }
      }

      await supabase
        .rpc("refresh_order_line_economics" as never, { p_sales_order_id: orderId } as never);

      if (allAllocated) {
        const { error: postingIntentError } = await supabase
          .rpc("queue_qbo_posting_intents_for_order" as never, { p_sales_order_id: orderId } as never);

        if (postingIntentError) {
          throw new Error(`Failed to queue QBO posting intent: ${postingIntentError.message}`);
        }

        supabase.functions.invoke("accounting-posting-intents-process", { body: { batchSize: 10 } }).catch(() => {});
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
      queryClient.invalidateQueries({ queryKey: orderKeys.detail(orderId) });
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
          {memo && (
            <div className="mt-2 rounded-md bg-amber-50 border border-amber-200 px-3 py-2">
              <div className="text-[11px] text-amber-700 uppercase tracking-wide font-medium mb-0.5">
                Stripe Sale Note
              </div>
              <p className="text-[13px] text-amber-900 font-medium">{memo}</p>
            </div>
          )}
          {!memo && (
            <div className="mt-2">
              <div className="text-[11px] text-zinc-500 uppercase tracking-wide mb-1">
                Memo
              </div>
              <p className="text-[13px] text-zinc-500">No memo</p>
            </div>
          )}
        </div>

        {/* ─── Section 2: Line Items ─────────────────────── */}
        <div className="space-y-3 pt-4 border-t border-zinc-100 mt-4">
          <SectionHead>Line Items</SectionHead>

          <div className="space-y-2">
            {lineItems.map((line) => (
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
        </div>

        {/* ─── Section 3: Discount & Blue Bell ───────────── */}
        <div className="space-y-3 pt-4 border-t border-zinc-100 mt-4">
          <SectionHead>Adjustments</SectionHead>

          <div className="flex items-center gap-4">
            <label className="text-[13px] text-zinc-600 w-20">Discount</label>
            <div className="relative w-32">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-zinc-400 font-mono">£</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={discount}
                onChange={(e) => setDiscount(e.target.value)}
                className="w-full rounded-md border border-zinc-200 bg-white pl-7 pr-3 py-2 text-[13px] text-zinc-900 text-right font-mono"
              />
            </div>
          </div>

          <div className="flex items-center gap-4">
            <label htmlFor="bluebell-toggle" className="text-[13px] text-zinc-600 flex-1">
              Includes Blue Bell donation
            </label>
            <Switch
              id="bluebell-toggle"
              checked={blueBellDonation}
              onCheckedChange={setBlueBellDonation}
            />
          </div>
        </div>

        {/* ─── Section 4: Payment Split ──────────────────── */}
        <div className="space-y-3 pt-4 border-t border-zinc-100 mt-4">
          <SectionHead>Payment Split</SectionHead>

          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <CreditCard className="h-4 w-4 text-zinc-400" />
              <label className="text-[13px] text-zinc-600 w-24">Card (Stripe)</label>
              <div className="relative w-32">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-zinc-400 font-mono">£</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={cardAmount}
                  onChange={(e) => setCardAmount(e.target.value)}
                  className="w-full rounded-md border border-zinc-200 bg-white pl-7 pr-3 py-2 text-[13px] text-zinc-900 text-right font-mono"
                />
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Banknote className="h-4 w-4 text-zinc-400" />
              <label className="text-[13px] text-zinc-600 w-24">Cash</label>
              <div className="relative w-32">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-zinc-400 font-mono">£</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={cashValue.toFixed(2)}
                  readOnly
                  className="w-full rounded-md border border-zinc-100 bg-zinc-50 pl-7 pr-3 py-2 text-[13px] text-zinc-700 text-right font-mono cursor-default"
                />
              </div>
              {hasCashPortion && (
                <span className="text-[11px] text-amber-600 font-medium">Split payment</span>
              )}
            </div>
          </div>
        </div>

        {/* ─── Section 5: Totals ─────────────────────────── */}
        <div className="mt-4 pt-3 border-t border-zinc-100 space-y-1">
          <div className="flex items-center justify-between text-[13px]">
            <span className="text-zinc-500">Line total</span>
            <Mono>£{lineTotal.toFixed(2)}</Mono>
          </div>
          {discountAmount > 0 && (
            <div className="flex items-center justify-between text-[13px]">
              <span className="text-zinc-500">Discount</span>
              <Mono color="red">−£{discountAmount.toFixed(2)}</Mono>
            </div>
          )}
          <div className="flex items-center justify-between text-[13px] font-semibold pt-1 border-t border-zinc-50">
            <span className="text-zinc-700">Net total</span>
            <Mono color="teal">£{netTotal.toFixed(2)}</Mono>
          </div>
          <div className="flex items-center justify-between text-[12px] text-zinc-400">
            <span>Card</span>
            <Mono color="dim">£{cardValue.toFixed(2)}</Mono>
          </div>
          {hasCashPortion && (
            <div className="flex items-center justify-between text-[12px] text-zinc-400">
              <span>Cash</span>
              <Mono color="dim">£{cashValue.toFixed(2)}</Mono>
            </div>
          )}
          {!isBalanced && lineTotal > 0 && (
            <div className="flex items-center justify-between text-[13px]">
              <span className="text-amber-600 font-medium">
                {totalPayment > netTotal ? "Overpayment" : "Shortfall"}
              </span>
              <Mono color="amber">
                £{Math.abs(roundCurrency(totalPayment - netTotal)).toFixed(2)}
              </Mono>
            </div>
          )}
        </div>

        {/* ─── Section 6: Footer ─────────────────────────── */}
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
