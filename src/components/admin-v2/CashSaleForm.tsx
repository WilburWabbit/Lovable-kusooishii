import { useState } from "react";
import {
  Check,
  ChevronsUpDown,
  Loader2,
  Plus,
  Search,
  X,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
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

interface CashSaleFormProps {
  open: boolean;
  onClose: () => void;
}

type DiscountType = "percent" | "amount";

type CustomerOption = {
  id: string;
  name: string;
  email: string | null;
  searchText: string;
};

type ProductOption = {
  id: string;
  skuCode: string;
  name: string;
  mpn: string | null;
  price: number;
  qtyOnHand: number;
  searchText: string;
};

type CashSaleLine = {
  key: number;
  productOpen: boolean;
  productSearch: string;
  skuId: string | null;
  skuCode: string;
  productName: string;
  unitPrice: string;
  quantity: number;
  discountType: DiscountType;
  discountValue: string;
};

type SearchPickerOption = {
  id: string;
  primary: string;
  secondary?: string;
  hint?: string;
  searchText: string;
};

const PAYMENT_METHODS = [
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "split", label: "Split (Cash + Card)" },
] as const;

const DEFAULT_CUSTOMER_EMAIL_PREFIX = "manual-sale";

let nextLineKey = 1;

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

function buildCustomerSearchText(name: string, email: string | null): string {
  return normalizeSearch(`${name} ${email ?? ""}`);
}

function buildProductSearchText(option: {
  skuCode: string;
  name: string;
  mpn: string | null;
}): string {
  return normalizeSearch(`${option.skuCode} ${option.name} ${option.mpn ?? ""}`);
}

function createEmptyLine(): CashSaleLine {
  return {
    key: nextLineKey++,
    productOpen: false,
    productSearch: "",
    skuId: null,
    skuCode: "",
    productName: "",
    unitPrice: "",
    quantity: 1,
    discountType: "percent",
    discountValue: "",
  };
}

function filterSearchOptions(
  options: SearchPickerOption[],
  query: string,
  limit = 12,
): SearchPickerOption[] {
  const normalized = normalizeSearch(query);
  if (!normalized) return options.slice(0, limit);
  return options
    .filter((option) => option.searchText.includes(normalized))
    .slice(0, limit);
}

function calculateLineTotals(line: CashSaleLine) {
  const unitPrice = parseCurrency(line.unitPrice);
  const quantity = Number.isFinite(line.quantity) ? Math.max(1, Math.floor(line.quantity)) : 1;
  const grossSubtotal = roundCurrency(unitPrice * quantity);
  const rawDiscount = line.discountType === "percent"
    ? roundCurrency(grossSubtotal * (parseCurrency(line.discountValue) / 100))
    : parseCurrency(line.discountValue);
  const discountTotal = Math.min(grossSubtotal, Math.max(0, rawDiscount));
  const grossTotal = roundCurrency(grossSubtotal - discountTotal);

  return {
    quantity,
    unitPrice,
    grossSubtotal,
    discountTotal,
    grossTotal,
  };
}

function distributeDiscountAcrossUnits(discountTotal: number, quantity: number): number[] {
  if (quantity <= 0 || discountTotal <= 0) return Array.from({ length: quantity }, () => 0);

  const totalPence = Math.round(discountTotal * 100);
  const basePence = Math.floor(totalPence / quantity);
  const remainder = totalPence % quantity;

  return Array.from({ length: quantity }, (_, index) => {
    const pence = basePence + (index < remainder ? 1 : 0);
    return pence / 100;
  });
}

function buildCustomerOptions(customers: CustomerOption[]): SearchPickerOption[] {
  return customers.map((customer) => ({
    id: customer.id,
    primary: customer.name,
    secondary: customer.email ?? "No email saved",
    searchText: customer.searchText,
  }));
}

function buildProductOptions(products: ProductOption[]): SearchPickerOption[] {
  return products.map((product) => ({
    id: product.id,
    primary: product.skuCode,
    secondary: product.name,
    hint: `£${product.price.toFixed(2)} · ${product.qtyOnHand} listed`,
    searchText: product.searchText,
  }));
}

function SearchPicker({
  open,
  onOpenChange,
  searchValue,
  onSearchValueChange,
  triggerLabel,
  placeholder,
  searchPlaceholder,
  emptyLabel,
  options,
  selectedId,
  onSelect,
  disabled = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  searchValue: string;
  onSearchValueChange: (value: string) => void;
  triggerLabel: string;
  placeholder: string;
  searchPlaceholder: string;
  emptyLabel: string;
  options: SearchPickerOption[];
  selectedId: string | null;
  onSelect: (option: SearchPickerOption) => void;
  disabled?: boolean;
}) {
  const filteredOptions = filterSearchOptions(options, searchValue);

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            "w-full flex items-center justify-between rounded-md border border-zinc-200 bg-white px-3 py-2 text-left text-[13px] text-zinc-900 transition-colors",
            "hover:border-zinc-300 disabled:cursor-not-allowed disabled:opacity-50",
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
            placeholder={searchPlaceholder}
            value={searchValue}
            onValueChange={onSearchValueChange}
          />
          <CommandList>
            <CommandEmpty>{emptyLabel}</CommandEmpty>
            <CommandGroup>
              {filteredOptions.map((option) => (
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

export function CashSaleForm({ open, onClose }: CashSaleFormProps) {
  const queryClient = useQueryClient();
  const [lineItems, setLineItems] = useState<CashSaleLine[]>([createEmptyLine()]);
  const [paymentMethod, setPaymentMethod] = useState<string>("cash");
  const [isBlueBellSale, setIsBlueBellSale] = useState(false);
  const [customerPickerOpen, setCustomerPickerOpen] = useState(false);
  const [customerSearch, setCustomerSearch] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [manualCustomerName, setManualCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");

  const lookupQuery = useQuery({
    queryKey: ["cash-sale", "lookups"],
    enabled: open,
    queryFn: async () => {
      const [customerResponse, skuResponse, stockResponse] = await Promise.all([
        supabase
          .from("customer")
          .select("id, display_name, email, active")
          .eq("active", true)
          .order("display_name", { ascending: true }),
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

      if (customerResponse.error) throw customerResponse.error;
      if (skuResponse.error) throw skuResponse.error;
      if (stockResponse.error) throw stockResponse.error;

      const stockMap = new Map<string, number>();
      for (const row of ((stockResponse.data ?? []) as Record<string, unknown>[])) {
        stockMap.set(row.sku_code as string, Number(row.qty_on_hand ?? 0));
      }

      const customers: CustomerOption[] = ((customerResponse.data ?? []) as Record<string, unknown>[]).map((row) => {
        const name = (row.display_name as string) ?? "Unnamed customer";
        const email = (row.email as string) ?? null;
        return {
          id: row.id as string,
          name,
          email,
          searchText: buildCustomerSearchText(name, email),
        };
      });

      const products: ProductOption[] = ((skuResponse.data ?? []) as Record<string, unknown>[]).map((row) => {
        const product = (row.product as Record<string, unknown> | null) ?? null;
        const fallbackName = (row.name as string) ?? row.sku_code as string;
        const productName = (product?.name as string) ?? fallbackName;
        const mpn = (product?.mpn as string) ?? (row.sku_code as string).split(".")[0] ?? null;

        return {
          id: row.id as string,
          skuCode: row.sku_code as string,
          name: productName,
          mpn,
          price: Number(row.price ?? 0),
          qtyOnHand: stockMap.get(row.sku_code as string) ?? 0,
          searchText: buildProductSearchText({
            skuCode: row.sku_code as string,
            name: productName,
            mpn,
          }),
        };
      });

      return { customers, products };
    },
  });

  const customerOptions = buildCustomerOptions(lookupQuery.data?.customers ?? []);
  const productOptions = buildProductOptions(lookupQuery.data?.products ?? []);
  const selectedCustomer = (lookupQuery.data?.customers ?? []).find((customer) => customer.id === selectedCustomerId) ?? null;

  const createCashSale = useMutation({
    mutationFn: async () => {
      const preparedLines = lineItems
        .map((line) => ({
          ...line,
          totals: calculateLineTotals(line),
        }))
        .filter((line) => line.skuId && line.totals.unitPrice > 0 && line.totals.quantity > 0);

      if (preparedLines.length === 0) {
        throw new Error("Add at least one product line");
      }

      const customerName = selectedCustomer?.name ?? manualCustomerName.trim();
      const emailInput = customerEmail.trim().toLowerCase();

      let customerId: string | null = selectedCustomerId;
      if (selectedCustomerId) {
        if (emailInput && emailInput !== (selectedCustomer?.email ?? "").toLowerCase()) {
          const { error: customerUpdateError } = await supabase
            .from("customer")
            .update({ email: emailInput } as never)
            .eq("id", selectedCustomerId);

          if (customerUpdateError) {
            throw new Error(`Failed to update customer email: ${customerUpdateError.message}`);
          }
        }
      } else if (emailInput || customerName) {
        if (emailInput) {
          const { data: existingByEmail, error: emailLookupError } = await supabase
            .from("customer")
            .select("id")
            .eq("email", emailInput)
            .maybeSingle();

          if (emailLookupError) {
            throw new Error(`Failed to check customer email: ${emailLookupError.message}`);
          }

          if (existingByEmail) {
            customerId = (existingByEmail as Record<string, unknown>).id as string;
          }
        }

        if (!customerId && customerName) {
          const { data: existingByName, error: nameLookupError } = await supabase
            .from("customer")
            .select("id")
            .eq("display_name", customerName)
            .maybeSingle();

          if (nameLookupError) {
            throw new Error(`Failed to check customer name: ${nameLookupError.message}`);
          }

          if (existingByName) {
            customerId = (existingByName as Record<string, unknown>).id as string;
          }
        }

        if (!customerId) {
          const { data: newCustomer, error: customerInsertError } = await supabase
            .from("customer")
            .insert({
              display_name: customerName || emailInput || "Cash Sales",
              email: emailInput || null,
            } as never)
            .select("id")
            .single();

          if (customerInsertError) {
            throw new Error(`Failed to create customer: ${customerInsertError.message}`);
          }

          customerId = (newCustomer as Record<string, unknown>).id as string;
        }
      } else {
        const { data: cashCustomer, error: cashCustomerError } = await supabase
          .from("customer")
          .select("id")
          .eq("display_name", "Cash Sales")
          .maybeSingle();

        if (cashCustomerError) {
          throw new Error(`Failed to look up Cash Sales customer: ${cashCustomerError.message}`);
        }

        customerId = cashCustomer
          ? (cashCustomer as Record<string, unknown>).id as string
          : null;
      }

      const manualDiscountTotal = roundCurrency(
        preparedLines.reduce((sum, line) => sum + line.totals.discountTotal, 0),
      );
      const blueBellDiscountTotal = isBlueBellSale
        ? roundCurrency(preparedLines.reduce((sum, line) => sum + roundCurrency(line.totals.grossTotal * 0.05), 0))
        : 0;
      const grossTotal = roundCurrency(
        preparedLines.reduce((sum, line) => sum + line.totals.grossTotal, 0) - blueBellDiscountTotal,
      );
      const discountTotal = roundCurrency(manualDiscountTotal + blueBellDiscountTotal);
      const taxTotal = roundCurrency(grossTotal - grossTotal / 1.2);
      const netAmount = roundCurrency(grossTotal - taxTotal);
      const guestName = customerName || "Cash Sale";
      const guestEmail = emailInput || selectedCustomer?.email || `${DEFAULT_CUSTOMER_EMAIL_PREFIX}-${Date.now()}@internal.local`;
      const txnDate = new Date().toISOString().slice(0, 10);

      const { data: newOrder, error: orderError } = await supabase
        .from("sales_order")
        .insert({
          customer_id: customerId,
          origin_channel: "in_person",
          status: "paid",
          guest_email: guestEmail,
          guest_name: guestName,
          shipping_name: guestName,
          shipping_country: "GB",
          txn_date: txnDate,
          merchandise_subtotal: netAmount,
          discount_total: discountTotal,
          shipping_total: 0,
          tax_total: taxTotal,
          gross_total: grossTotal,
          net_amount: netAmount,
          payment_method: paymentMethod,
          qbo_sync_status: "pending",
          v2_status: "new",
          global_tax_calculation: "TaxInclusive",
          notes: isBlueBellSale
            ? "Recorded manually in Admin V2 cash sale modal. Blue Bell sale selected by staff."
            : "Recorded manually in Admin V2 cash sale modal.",
        } as never)
        .select("id, order_number")
        .single();

      if (orderError) {
        throw new Error(`Failed to create order: ${orderError.message}`);
      }

      const orderId = (newOrder as Record<string, unknown>).id as string;
      const orderNumber = (newOrder as Record<string, unknown>).order_number as string;

      let allAllocated = true;

      if (isBlueBellSale) {
        const { error: programError } = await supabase
          .rpc("record_sales_program_accrual" as never, {
            p_sales_order_id: orderId,
            p_program_code: "blue_bell",
            p_attribution_source: "staff_flag",
            p_basis_amount: grossTotal,
            p_discount_amount: blueBellDiscountTotal,
            p_commission_amount: roundCurrency(grossTotal * 0.05),
          } as never);

        if (programError) {
          throw new Error(`Failed to record Blue Bell programme accrual: ${programError.message}`);
        }
      }

      for (const line of preparedLines) {
        const blueBellLineDiscount = isBlueBellSale ? roundCurrency(line.totals.grossTotal * 0.05) : 0;
        const perUnitDiscounts = distributeDiscountAcrossUnits(
          roundCurrency(line.totals.discountTotal + blueBellLineDiscount),
          line.totals.quantity,
        );

        for (let index = 0; index < line.totals.quantity; index += 1) {
          const unitDiscount = perUnitDiscounts[index] ?? 0;
          const finalUnitPrice = roundCurrency(line.totals.unitPrice - unitDiscount);

          const { data: insertedLine, error: lineInsertError } = await supabase
            .from("sales_order_line")
            .insert({
              sales_order_id: orderId,
              sku_id: line.skuId!,
              quantity: 1,
              unit_price: finalUnitPrice,
              line_discount: unitDiscount,
              line_total: finalUnitPrice,
            } as never)
            .select("id")
            .single();

          if (lineInsertError) {
            throw new Error(`Failed to create line item: ${lineInsertError.message}`);
          }

          const lineId = (insertedLine as Record<string, unknown>).id as string;

          try {
            const { data: allocation, error: allocationError } = await supabase
              .rpc("allocate_stock_for_order_line" as never, {
                p_sales_order_line_id: lineId,
              } as never);

            if (allocationError || !allocation) {
              allAllocated = false;
              continue;
            }

            const allocationResult = allocation as Record<string, unknown>;
            if (allocationResult.status !== "allocated") {
              allAllocated = false;
            }
          } catch {
            allAllocated = false;
          }
        }
      }

      await supabase
        .rpc("refresh_order_line_economics" as never, { p_sales_order_id: orderId } as never);

      if (!allAllocated) {
        const { error: statusUpdateError } = await supabase
          .from("sales_order")
          .update({
            v2_status: "needs_allocation",
            qbo_sync_status: "needs_manual_review",
          } as never)
          .eq("id", orderId);

        if (statusUpdateError) {
          throw new Error(`Failed to mark order for allocation: ${statusUpdateError.message}`);
        }
      } else {
        // In-person sales are immediately complete (items handed over)
        const today = new Date().toISOString().slice(0, 10);
        await supabase
          .from("sales_order")
          .update({
            v2_status: "complete",
            shipped_via: "In Person",
            shipped_date: today,
            delivered_at: new Date().toISOString(),
          } as never)
          .eq("id", orderId);

        // Mark stock units as complete too
        await supabase
          .from("stock_unit")
          .update({
            v2_status: "complete",
            shipped_at: new Date().toISOString(),
            delivered_at: new Date().toISOString(),
          } as never)
          .eq("order_id" as never, orderId)
          .in("v2_status" as never, ["sold"]);

        // QBO sync handled by qbo-retry-sync cron — nudge it now
        supabase.functions.invoke("qbo-trigger-sync").catch(() => {});
      }

      return { orderId, orderNumber, allAllocated };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: orderKeys.all });
      queryClient.invalidateQueries({ queryKey: stockUnitKeys.all });
      queryClient.invalidateQueries({ queryKey: ["cash-sale", "lookups"] });
      toast.success(
        result.allAllocated
          ? `Sale ${result.orderNumber} created — QBO sync will follow shortly`
          : `Sale ${result.orderNumber} created. Some units still need allocation before QBO sync.`,
      );
      resetForm();
      onClose();
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  function resetForm() {
    setLineItems([createEmptyLine()]);
    setPaymentMethod("cash");
    setIsBlueBellSale(false);
    setCustomerPickerOpen(false);
    setCustomerSearch("");
    setSelectedCustomerId(null);
    setManualCustomerName("");
    setCustomerEmail("");
  }

  function handleClose() {
    resetForm();
    onClose();
  }

  function addLine() {
    setLineItems((previous) => [...previous, createEmptyLine()]);
  }

  function removeLine(lineKey: number) {
    setLineItems((previous) => {
      if (previous.length === 1) return previous;
      return previous.filter((line) => line.key !== lineKey);
    });
  }

  function updateLine(lineKey: number, updater: (line: CashSaleLine) => CashSaleLine) {
    setLineItems((previous) =>
      previous.map((line) => (line.key === lineKey ? updater(line) : line)),
    );
  }

  function selectProduct(lineKey: number, optionId: string) {
    const product = (lookupQuery.data?.products ?? []).find((item) => item.id === optionId);
    if (!product) return;

    updateLine(lineKey, (line) => ({
      ...line,
      skuId: product.id,
      skuCode: product.skuCode,
      productName: product.name,
      productSearch: `${product.skuCode} · ${product.name}`,
      productOpen: false,
      unitPrice: product.price > 0 ? product.price.toFixed(2) : line.unitPrice,
    }));
  }

  const orderSummary = lineItems.reduce(
    (summary, line) => {
      const totals = calculateLineTotals(line);
      const blueBellDiscount = isBlueBellSale ? roundCurrency(totals.grossTotal * 0.05) : 0;
      return {
        grossSubtotal: roundCurrency(summary.grossSubtotal + totals.grossSubtotal),
        manualDiscountTotal: roundCurrency(summary.manualDiscountTotal + totals.discountTotal),
        blueBellDiscountTotal: roundCurrency(summary.blueBellDiscountTotal + blueBellDiscount),
        discountTotal: roundCurrency(summary.discountTotal + totals.discountTotal + blueBellDiscount),
        grossTotal: roundCurrency(summary.grossTotal + totals.grossTotal - blueBellDiscount),
      };
    },
    { grossSubtotal: 0, manualDiscountTotal: 0, blueBellDiscountTotal: 0, discountTotal: 0, grossTotal: 0 },
  );

  const customerTriggerLabel = selectedCustomer
    ? `${selectedCustomer.name}${selectedCustomer.email ? ` · ${selectedCustomer.email}` : ""}`
    : customerSearch;

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && handleClose()}>
      <DialogContent className="max-w-4xl border-zinc-200 bg-white text-zinc-900">
        <DialogHeader>
          <DialogTitle>New Cash Sale</DialogTitle>
        </DialogHeader>

        <div className="mt-2 grid max-h-[78vh] gap-5 overflow-y-auto pr-1">
          <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
            <div className="grid gap-3">
              <div>
                <SectionHead>Customer (optional)</SectionHead>
                <div className="mt-1.5 grid gap-2">
                  <SearchPicker
                    open={customerPickerOpen}
                    onOpenChange={setCustomerPickerOpen}
                    searchValue={customerSearch}
                    onSearchValueChange={setCustomerSearch}
                    triggerLabel={customerTriggerLabel}
                    placeholder="Search existing customers"
                    searchPlaceholder="Search by customer name or email"
                    emptyLabel={lookupQuery.isLoading ? "Loading customers..." : "No matching customers"}
                    options={customerOptions}
                    selectedId={selectedCustomerId}
                    onSelect={(option) => {
                      const customer = (lookupQuery.data?.customers ?? []).find((item) => item.id === option.id);
                      if (!customer) return;
                      setSelectedCustomerId(customer.id);
                      setCustomerSearch(customer.name);
                      setManualCustomerName(customer.name);
                      setCustomerEmail(customer.email ?? "");
                    }}
                    disabled={lookupQuery.isLoading}
                  />

                  <div className="flex flex-wrap gap-2">
                    <div className="rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-[11px] text-zinc-500">
                      {selectedCustomer ? "Using saved customer record" : "Leave blank for Cash Sales"}
                    </div>
                    {selectedCustomer && (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedCustomerId(null);
                          setCustomerSearch("");
                          setManualCustomerName("");
                          setCustomerEmail("");
                        }}
                        className="rounded-full border border-zinc-200 px-2.5 py-1 text-[11px] text-zinc-500 transition-colors hover:border-zinc-300 hover:text-zinc-700"
                      >
                        Clear selection
                      </button>
                    )}
                  </div>

                  <div className="grid gap-2 md:grid-cols-2">
                    <input
                      value={selectedCustomer?.name ?? manualCustomerName}
                      onChange={(event) => setManualCustomerName(event.target.value)}
                      placeholder="Customer name"
                      disabled={!!selectedCustomer}
                      className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-[13px] text-zinc-900 disabled:bg-zinc-50 disabled:text-zinc-400"
                    />
                    <input
                      value={customerEmail}
                      onChange={(event) => setCustomerEmail(event.target.value)}
                      placeholder="Email address"
                      type="email"
                      className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-[13px] text-zinc-900"
                    />
                  </div>
                </div>
              </div>

              <div>
                <SectionHead>Payment method</SectionHead>
                <div className="mt-1.5 flex gap-2">
                  {PAYMENT_METHODS.map((method) => (
                    <button
                      key={method.value}
                      type="button"
                      onClick={() => setPaymentMethod(method.value)}
                      className={cn(
                        "flex-1 rounded-md border px-3 py-2 text-[13px] font-medium transition-colors",
                        paymentMethod === method.value
                          ? "border-amber-500 bg-amber-500 text-zinc-900"
                          : "border-zinc-200 bg-zinc-50 text-zinc-500 hover:text-zinc-700",
                      )}
                    >
                      {method.label}
                    </button>
                  ))}
                </div>
              </div>

              <label className="flex items-start gap-3 rounded-md border border-zinc-200 bg-white p-3 text-[13px] text-zinc-700">
                <Checkbox
                  checked={isBlueBellSale}
                  onCheckedChange={(checked) => setIsBlueBellSale(checked === true)}
                  className="mt-0.5"
                />
                <span>
                  <span className="block font-medium text-zinc-900">Blue Bell LEGO Club sale</span>
                  <span className="mt-0.5 block text-[11px] text-zinc-500">
                    Applies the default 5% customer discount and records the 5% venue commission accrual.
                  </span>
                </span>
              </label>
            </div>

            <div className="rounded-xl border border-zinc-200 bg-zinc-50/70 p-4">
              <div className="flex items-center justify-between">
                <SectionHead>Order Summary</SectionHead>
                {lookupQuery.isLoading && (
                  <div className="flex items-center gap-1 text-[11px] text-zinc-500">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Loading lookups
                  </div>
                )}
              </div>
              <div className="mt-3 grid gap-2 text-[13px]">
                <div className="flex items-center justify-between text-zinc-500">
                  <span>Subtotal</span>
                  <Mono color="dim">£{orderSummary.grossSubtotal.toFixed(2)}</Mono>
                </div>
                <div className="flex items-center justify-between text-zinc-500">
                  <span>{isBlueBellSale ? "Manual discounts" : "Discounts"}</span>
                  <Mono color="amber">-£{orderSummary.manualDiscountTotal.toFixed(2)}</Mono>
                </div>
                {isBlueBellSale && (
                  <div className="flex items-center justify-between text-zinc-500">
                    <span>Blue Bell</span>
                    <Mono color="amber">-£{orderSummary.blueBellDiscountTotal.toFixed(2)}</Mono>
                  </div>
                )}
                <div className="flex items-center justify-between border-t border-zinc-200 pt-2">
                  <span className="font-medium text-zinc-900">Total</span>
                  <Mono color="teal">£{orderSummary.grossTotal.toFixed(2)}</Mono>
                </div>
                <p className="pt-2 text-[11px] text-zinc-500">
                  Quantities are expanded into individual sale lines behind the scenes so FIFO allocation and QBO sync can stay accurate.
                </p>
              </div>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <SectionHead>Line items</SectionHead>
              <button
                type="button"
                onClick={addLine}
                className="inline-flex items-center gap-1 rounded-full border border-zinc-200 px-3 py-1.5 text-[11px] text-zinc-600 transition-colors hover:border-zinc-300 hover:text-zinc-800"
              >
                <Plus className="h-3.5 w-3.5" />
                Add line
              </button>
            </div>

            <div className="mt-2 grid gap-3">
              {lineItems.map((line) => {
                const totals = calculateLineTotals(line);
                const selectedProduct = (lookupQuery.data?.products ?? []).find((product) => product.id === line.skuId) ?? null;

                return (
                  <div
                    key={line.key}
                    className="grid gap-3 rounded-xl border border-zinc-200 bg-zinc-50/70 p-3"
                  >
                    <div className="grid gap-3 xl:grid-cols-[minmax(0,1.8fr)_120px_140px_160px_150px_auto]">
                      <div className="grid gap-1.5">
                        <label className="text-[10px] uppercase tracking-wider text-zinc-400">
                          Product / SKU
                        </label>
                        <SearchPicker
                          open={line.productOpen}
                          onOpenChange={(nextOpen) => {
                            updateLine(line.key, (currentLine) => ({
                              ...currentLine,
                              productOpen: nextOpen,
                            }));
                          }}
                          searchValue={line.productSearch}
                          onSearchValueChange={(value) => {
                            updateLine(line.key, (currentLine) => ({
                              ...currentLine,
                              productSearch: value,
                            }));
                          }}
                          triggerLabel={line.productSearch}
                          placeholder="Search by SKU or product name"
                          searchPlaceholder="Search by SKU, product name, or MPN"
                          emptyLabel={lookupQuery.isLoading ? "Loading products..." : "No matching products"}
                          options={productOptions}
                          selectedId={line.skuId}
                          onSelect={(option) => selectProduct(line.key, option.id)}
                          disabled={lookupQuery.isLoading}
                        />
                        {selectedProduct && (
                          <div className="flex items-center gap-2 text-[11px] text-zinc-500">
                            <Search className="h-3.5 w-3.5" />
                            <span className="truncate">
                              {selectedProduct.name} · {selectedProduct.qtyOnHand} listed
                            </span>
                          </div>
                        )}
                      </div>

                      <div className="grid gap-1.5">
                        <label className="text-[10px] uppercase tracking-wider text-zinc-400">
                          Qty
                        </label>
                        <input
                          value={line.quantity}
                          onChange={(event) => {
                            const nextQuantity = Math.max(1, Number.parseInt(event.target.value, 10) || 1);
                            updateLine(line.key, (currentLine) => ({
                              ...currentLine,
                              quantity: nextQuantity,
                            }));
                          }}
                          type="number"
                          min="1"
                          className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-[13px] text-zinc-900"
                        />
                      </div>

                      <div className="grid gap-1.5">
                        <label className="text-[10px] uppercase tracking-wider text-zinc-400">
                          Unit Price
                        </label>
                        <div className="flex items-center rounded-md border border-zinc-200 bg-white px-3">
                          <span className="text-[13px] text-zinc-400">£</span>
                          <input
                            value={line.unitPrice}
                            onChange={(event) => {
                              updateLine(line.key, (currentLine) => ({
                                ...currentLine,
                                unitPrice: event.target.value,
                              }));
                            }}
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder="0.00"
                            className="w-full bg-transparent px-1 py-2 text-right text-[13px] text-zinc-900 outline-none"
                          />
                        </div>
                      </div>

                      <div className="grid gap-1.5">
                        <label className="text-[10px] uppercase tracking-wider text-zinc-400">
                          Discount
                        </label>
                        <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-2">
                          <select
                            value={line.discountType}
                            onChange={(event) => {
                              updateLine(line.key, (currentLine) => ({
                                ...currentLine,
                                discountType: event.target.value as DiscountType,
                              }));
                            }}
                            className="rounded-md border border-zinc-200 bg-white px-2 py-2 text-[13px] text-zinc-900"
                          >
                            <option value="percent">%</option>
                            <option value="amount">£</option>
                          </select>
                          <input
                            value={line.discountValue}
                            onChange={(event) => {
                              updateLine(line.key, (currentLine) => ({
                                ...currentLine,
                                discountValue: event.target.value,
                              }));
                            }}
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder={line.discountType === "percent" ? "0" : "0.00"}
                            className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-[13px] text-zinc-900"
                          />
                        </div>
                      </div>

                      <div className="grid gap-1.5">
                        <label className="text-[10px] uppercase tracking-wider text-zinc-400">
                          Line Total
                        </label>
                        <div className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-right">
                          <Mono color="teal">£{totals.grossTotal.toFixed(2)}</Mono>
                        </div>
                      </div>

                      <div className="flex items-end justify-end">
                        <button
                          type="button"
                          onClick={() => removeLine(line.key)}
                          disabled={lineItems.length === 1}
                          className="inline-flex h-[42px] w-[42px] items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-500 transition-colors hover:border-zinc-300 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-40"
                          title="Remove line"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-3 text-[11px] text-zinc-500">
                      <span>SKU: {line.skuCode || "Not selected"}</span>
                      <span>Subtotal: £{totals.grossSubtotal.toFixed(2)}</span>
                      <span>Discount: £{totals.discountTotal.toFixed(2)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex gap-2 border-t border-zinc-200 pt-4">
            <button
              type="button"
              onClick={() => createCashSale.mutate()}
              disabled={createCashSale.isPending || orderSummary.grossTotal <= 0}
              className="flex-1 rounded-md bg-amber-500 py-2.5 text-[13px] font-bold text-zinc-900 transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {createCashSale.isPending ? "Creating…" : "Create Sale"}
            </button>
            <button
              type="button"
              onClick={handleClose}
              className="rounded-md border border-zinc-200 bg-zinc-100 px-4 py-2.5 text-[13px] text-zinc-500 transition-colors hover:text-zinc-700"
            >
              Cancel
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
