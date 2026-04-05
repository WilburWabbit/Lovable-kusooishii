import { useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useGradeStockUnit } from "@/hooks/admin/use-stock-units";
import { GRADE_COLORS } from "@/lib/constants/unit-statuses";
import { GRADE_LABELS_NUMERIC } from "@/lib/grades";
import type { StockUnit, ConditionGrade } from "@/lib/types/admin";
import { Mono, SectionHead, UnitLifecycle } from "./ui-primitives";
import { toast } from "sonner";

interface UnitDetailSlideOutProps {
  unit: StockUnit | null;
  open: boolean;
  onClose: () => void;
}

export function UnitDetailSlideOut({ unit, open, onClose }: UnitDetailSlideOutProps) {
  const [selectedGrade, setSelectedGrade] = useState<ConditionGrade | null>(null);
  const gradeUnit = useGradeStockUnit();

  // Reset grade selection when unit changes
  const unitId = unit?.id;
  const [lastUnitId, setLastUnitId] = useState<string | undefined>();
  if (unitId !== lastUnitId) {
    setLastUnitId(unitId);
    setSelectedGrade((unit?.grade as ConditionGrade) ?? null);
  }

  const handleSave = async () => {
    if (!unit || !selectedGrade) return;

    try {
      await gradeUnit.mutateAsync({
        stockUnitId: unit.id,
        grade: selectedGrade,
      });
      toast.success(`Unit ${unit.uid} updated to G${selectedGrade}`);
      onClose();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Update failed";
      toast.error(message);
    }
  };

  const dataFields = unit
    ? [
        { label: "SKU", value: unit.sku ?? "—", color: "amber" as const },
        { label: "Grade", value: unit.grade ? `G${unit.grade}` : "Ungraded", color: "default" as const },
        { label: "Batch", value: unit.batchId ?? "—", color: "dim" as const },
        { label: "Landed Cost", value: unit.landedCost ? `£${unit.landedCost.toFixed(2)}` : "—", color: "teal" as const },
        { label: "Order", value: unit.orderId ?? "—", color: "amber" as const },
        { label: "Payout", value: unit.payoutId ?? (unit.orderId ? "Pending" : "—"), color: unit.payoutId ? "green" as const : "amber" as const },
      ]
    : [];

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-[480px] bg-white border-zinc-200 p-0 flex flex-col">
        <SheetHeader className="px-5 py-4 border-b border-zinc-200">
          <SheetTitle className="text-zinc-900 text-base font-bold">
            Unit {unit?.uid ?? ""}
          </SheetTitle>
        </SheetHeader>

        {unit && (
          <div className="flex-1 overflow-auto p-5 grid gap-4">
            {/* Key data grid */}
            <div className="grid grid-cols-2 gap-3">
              {dataFields.map((f) => (
                <div key={f.label}>
                  <div className="text-[10px] text-zinc-500 uppercase tracking-wider">
                    {f.label}
                  </div>
                  <Mono color={f.color} className="text-sm">
                    {f.value}
                  </Mono>
                </div>
              ))}
            </div>

            {/* Lifecycle stepper */}
            <div>
              <SectionHead>Lifecycle</SectionHead>
              <UnitLifecycle status={unit.status} />
            </div>

            {/* Edit grade (only if already graded) */}
            {unit.grade !== null && (
              <div>
                <SectionHead>Edit Grade</SectionHead>
                <div className="grid grid-cols-4 gap-1.5">
                  {([1, 2, 3, 4] as ConditionGrade[]).map((g) => {
                    const color = GRADE_COLORS[g];
                    const selected = selectedGrade === g;
                    return (
                      <button
                        key={g}
                        onClick={() => setSelectedGrade(g)}
                        className="p-2 rounded-md cursor-pointer text-center font-mono text-sm font-extrabold border-2 transition-colors"
                        style={{
                          background: selected ? `${color}20` : "#F4F4F5",
                          borderColor: selected ? color : "#E4E4E7",
                          color,
                        }}
                      >
                        G{g}
                      </button>
                    );
                  })}
                </div>
                <div className="text-[11px] text-zinc-500 mt-1">
                  {selectedGrade && GRADE_LABELS_NUMERIC[selectedGrade]}
                </div>
              </div>
            )}

            {/* Save */}
            <div className="flex gap-2 pt-2 border-t border-zinc-200">
              <button
                onClick={handleSave}
                disabled={!selectedGrade || gradeUnit.isPending}
                className="flex-1 bg-amber-500 text-zinc-900 border-none rounded-md py-2.5 font-bold text-[13px] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed hover:bg-amber-400 transition-colors"
              >
                {gradeUnit.isPending ? "Saving…" : "Save Changes"}
              </button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
