import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { OrderLineItem, StockUnitStatus } from "@/lib/types/admin";
import { Mono, SectionHead, UnitLifecycle } from "./ui-primitives";

interface OrderUnitSlideOutProps {
  lineItem: (OrderLineItem & {
    unitUid?: string;
    unitStatus?: StockUnitStatus;
    landedCost?: number | null;
    carrier?: string | null;
    trackingNumber?: string | null;
    payoutStatus?: string;
  }) | null;
  open: boolean;
  onClose: () => void;
}

export function OrderUnitSlideOut({ lineItem, open, onClose }: OrderUnitSlideOutProps) {
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
      <SheetContent side="right" className="w-[480px] bg-[#1C1C1E] border-zinc-700/80 p-0 flex flex-col">
        <SheetHeader className="px-5 py-4 border-b border-zinc-700/80">
          <SheetTitle className="text-zinc-50 text-base font-bold">
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
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
