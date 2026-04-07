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

            {/* Unit P&L */}
            {profit && (
              <div>
                <SectionHead>Unit P&amp;L</SectionHead>
                <div className="grid gap-1.5 bg-zinc-50 rounded-lg p-3">
                  <div className="flex justify-between py-1 border-b border-zinc-100">
                    <span className="text-zinc-600 text-xs">Revenue</span>
                    <Mono color="teal" className="text-xs">£{profit.grossRevenue.toFixed(2)}</Mono>
                  </div>
                  <div className="flex justify-between py-1 border-b border-zinc-100">
                    <span className="text-zinc-600 text-xs">Landed Cost</span>
                    <Mono className="text-xs">£{profit.landedCost.toFixed(2)}</Mono>
                  </div>
                  {profit.sellingFee > 0 && (
                    <div className="flex justify-between py-1 border-b border-zinc-100">
                      <span className="text-zinc-600 text-xs">Selling Fee</span>
                      <Mono color="red" className="text-xs">£{profit.sellingFee.toFixed(2)}</Mono>
                    </div>
                  )}
                  {profit.shippingFee > 0 && (
                    <div className="flex justify-between py-1 border-b border-zinc-100">
                      <span className="text-zinc-600 text-xs">Shipping Fee</span>
                      <Mono color="red" className="text-xs">£{profit.shippingFee.toFixed(2)}</Mono>
                    </div>
                  )}
                  {profit.advertisingFee > 0 && (
                    <div className="flex justify-between py-1 border-b border-zinc-100">
                      <span className="text-zinc-600 text-xs">Advertising</span>
                      <Mono color="red" className="text-xs">£{profit.advertisingFee.toFixed(2)}</Mono>
                    </div>
                  )}
                  {profit.processingFee > 0 && (
                    <div className="flex justify-between py-1 border-b border-zinc-100">
                      <span className="text-zinc-600 text-xs">Processing</span>
                      <Mono color="red" className="text-xs">£{profit.processingFee.toFixed(2)}</Mono>
                    </div>
                  )}
                  <div className="flex justify-between py-1 border-b border-zinc-200 font-semibold">
                    <span className="text-zinc-700 text-xs">Total Fees</span>
                    <Mono color="red" className="text-xs">£{profit.totalFeesPerUnit.toFixed(2)}</Mono>
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
