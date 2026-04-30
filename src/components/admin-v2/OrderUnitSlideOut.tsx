import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { OrderLineItem, StockUnitStatus } from "@/lib/types/admin";
import { useUnitProfit } from "@/hooks/admin/use-payouts";
import { Mono, SectionHead, UnitLifecycle } from "./ui-primitives";

interface OrderUnitSlideOutProps {
  lineItem: (OrderLineItem & {
    unitUid?: string;
    unitStatus?: StockUnitStatus;
    landedCost?: number | null;
    carrier?: string | null;
    trackingNumber?: string | null;
    payoutStatus?: string;
    stockUnitIdForProfit?: string;
  }) | null;
  open: boolean;
  onClose: () => void;
}

export function OrderUnitSlideOut({ lineItem, open, onClose }: OrderUnitSlideOutProps) {
  const unitId = lineItem?.stockUnitIdForProfit ?? lineItem?.stockUnitId ?? undefined;
  const { data: profitData = [] } = useUnitProfit(unitId);
  const profit = profitData[0] ?? null;

  const dataFields = lineItem
    ? [
        { label: "SKU", value: lineItem.sku ?? "—", color: "amber" as const },
        { label: "Unit ID", value: lineItem.unitUid ?? "Unallocated", color: lineItem.unitUid ? "default" as const : "amber" as const },
        { label: "Landed Cost", value: lineItem.cogs ? `£${lineItem.cogs.toFixed(2)}` : "—", color: "teal" as const },
        { label: "Carrier", value: lineItem.carrier ?? "—", color: "default" as const },
        { label: "Tracking", value: lineItem.trackingNumber ?? "—", color: "default" as const },
        { label: "Payout", value: lineItem.payoutStatus ?? "—", color: lineItem.payoutStatus === "Received" ? "green" as const : "amber" as const },
      ]
    : [];

  // Calculate input VAT reclaim for this unit
  // landed_cost is already ex-VAT; input VAT = cost × 20%
  const vatReclaimCost = profit ? profit.landedCost * 0.2 : 0;
  const vatReclaimFees = profit ? profit.totalFeesPerUnit - profit.netTotalFees : 0;
  const totalVatReclaim = vatReclaimCost + vatReclaimFees;

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-[480px] bg-white border-zinc-200 p-0 flex flex-col">
        <SheetHeader className="px-5 py-4 border-b border-zinc-200">
          <SheetTitle className="text-zinc-900 text-base font-bold">
            Unit {lineItem?.unitUid ?? "—"}
          </SheetTitle>
        </SheetHeader>

        {lineItem && (
          <div className="flex-1 overflow-auto p-5 grid gap-4">
            {/* Key data grid */}
            <div className="grid grid-cols-2 gap-3">
              {dataFields.map((f) => (
                <div key={f.label}>
                  <div className="text-[10px] text-zinc-500 uppercase tracking-wider">
                    {f.label}
                  </div>
                  <Mono color={f.color} className="text-[13px]">
                    {f.value}
                  </Mono>
                </div>
              ))}
            </div>

            {/* Lifecycle stepper */}
            {lineItem.unitStatus && (
              <div>
                <SectionHead>Unit Lifecycle</SectionHead>
                <UnitLifecycle status={lineItem.unitStatus} />
              </div>
            )}

            {/* Unit P&L — all ex-VAT */}
            {profit && (
              <div>
                <SectionHead>Unit P&amp;L (ex-VAT)</SectionHead>
                <div className="grid gap-1.5 bg-zinc-50 rounded-lg p-3">
                  <div className="flex justify-between py-1 border-b border-zinc-100">
                    <span className="text-zinc-600 text-xs">Revenue (ex-VAT)</span>
                    <Mono color="teal" className="text-xs">£{profit.netRevenue.toFixed(2)}</Mono>
                  </div>
                  <div className="flex justify-between py-1 border-b border-zinc-100">
                    <span className="text-zinc-600 text-xs">Landed Cost (ex-VAT)</span>
                    <Mono className="text-xs">£{profit.netLandedCost.toFixed(2)}</Mono>
                  </div>
                  {profit.sellingFee > 0 && (
                    <div className="flex justify-between py-1 border-b border-zinc-100">
                      <span className="text-zinc-600 text-xs">Selling Fee (ex-VAT)</span>
                      <Mono color="red" className="text-xs">£{(profit.sellingFee / 1.2).toFixed(2)}</Mono>
                    </div>
                  )}
                  {profit.shippingFee > 0 && (
                    <div className="flex justify-between py-1 border-b border-zinc-100">
                      <span className="text-zinc-600 text-xs">Shipping Fee (ex-VAT)</span>
                      <Mono color="red" className="text-xs">£{(profit.shippingFee / 1.2).toFixed(2)}</Mono>
                    </div>
                  )}
                  {profit.advertisingFee > 0 && (
                    <div className="flex justify-between py-1 border-b border-zinc-100">
                      <span className="text-zinc-600 text-xs">Advertising (ex-VAT)</span>
                      <Mono color="red" className="text-xs">£{(profit.advertisingFee / 1.2).toFixed(2)}</Mono>
                    </div>
                  )}
                  {profit.processingFee > 0 && (
                    <div className="flex justify-between py-1 border-b border-zinc-100">
                      <span className="text-zinc-600 text-xs">Processing (ex-VAT)</span>
                      <Mono color="red" className="text-xs">£{(profit.processingFee / 1.2).toFixed(2)}</Mono>
                    </div>
                  )}
                  <div className="flex justify-between py-1 border-b border-zinc-200 font-semibold">
                    <span className="text-zinc-700 text-xs">Total Fees (ex-VAT)</span>
                    <Mono color="red" className="text-xs">£{profit.netTotalFees.toFixed(2)}</Mono>
                  </div>
                  <div className="flex justify-between py-1 border-b border-zinc-100">
                    <span className="text-blue-600 text-xs">Input VAT Reclaim</span>
                    <Mono color="default" className="text-xs text-blue-600">£{totalVatReclaim.toFixed(2)}</Mono>
                  </div>
                  <div className="flex justify-between py-1 font-bold">
                    <span className="text-zinc-900 text-xs">Net Profit</span>
                    <Mono color={profit.netProfit >= 0 ? "teal" : "red"} className="text-xs">
                      £{profit.netProfit.toFixed(2)}
                    </Mono>
                  </div>
                  {profit.netMarginPct !== null && (
                    <div className="flex justify-between py-1">
                      <span className="text-zinc-500 text-[10px]">Margin</span>
                      <span className={`text-[10px] font-mono ${profit.netMarginPct >= 0 ? "text-teal-600" : "text-red-500"}`}>
                        {profit.netMarginPct.toFixed(1)}%
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
