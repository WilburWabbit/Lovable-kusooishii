import { useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useGradeStockUnit } from "@/hooks/admin/use-stock-units";
import { CONDITION_FLAGS, GRADE_COLORS } from "@/lib/constants/unit-statuses";
import { GRADE_LABELS_NUMERIC } from "@/lib/grades";
import type { StockUnit, ConditionGrade, ConditionFlag, ProductVariant } from "@/lib/types/admin";
import { Mono, SectionHead } from "./ui-primitives";
import { toast } from "sonner";

interface GradeSlideOutProps {
  unit: (StockUnit & { productName?: string }) | null;
  open: boolean;
  onClose: () => void;
  variants?: ProductVariant[];
}

const GRADE_DESCRIPTIONS: Record<number, string> = {
  1: "Factory sealed, untouched",
  2: "Opened but complete",
  3: "Built/used, still complete",
  4: "Incomplete, all issues disclosed",
};

export function GradeSlideOut({ unit, open, onClose, variants = [] }: GradeSlideOutProps) {
  // Build market price lookup from variants
  const marketPriceByGrade = new Map<number, number>();
  for (const v of variants) {
    const price = v.marketPrice ?? v.salePrice;
    if (price) marketPriceByGrade.set(v.grade, price);
  }
  const [selectedGrade, setSelectedGrade] = useState<ConditionGrade | null>(
    (unit?.grade as ConditionGrade) ?? null
  );
  const [selectedFlags, setSelectedFlags] = useState<Set<ConditionFlag>>(
    new Set(unit?.conditionFlags ?? [])
  );

  const gradeUnit = useGradeStockUnit();

  // Reset state when unit changes
  const unitId = unit?.id;
  const [lastUnitId, setLastUnitId] = useState<string | undefined>();
  if (unitId !== lastUnitId) {
    setLastUnitId(unitId);
    setSelectedGrade((unit?.grade as ConditionGrade) ?? null);
    setSelectedFlags(new Set(unit?.conditionFlags ?? []));
  }

  const toggleFlag = (flag: ConditionFlag) => {
    setSelectedFlags((prev) => {
      const next = new Set(prev);
      if (next.has(flag)) next.delete(flag);
      else next.add(flag);
      return next;
    });
  };

  const handleSave = async () => {
    if (!unit || !selectedGrade) return;

    try {
      await gradeUnit.mutateAsync({
        stockUnitId: unit.id,
        grade: selectedGrade,
        conditionFlags: Array.from(selectedFlags),
      });
      toast.success(`Unit ${unit.uid} graded as G${selectedGrade}`);
      onClose();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Grading failed";
      toast.error(message);
    }
  };

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-[480px] bg-[#1C1C1E] border-zinc-700/80 p-0 flex flex-col">
        <SheetHeader className="px-5 py-4 border-b border-zinc-700/80">
          <SheetTitle className="text-zinc-50 text-base font-bold">
            Grade Unit {unit?.uid ?? ""}
          </SheetTitle>
        </SheetHeader>

        {unit && (
          <div className="flex-1 overflow-auto p-5 grid gap-4">
            {/* Unit info */}
            <div className="flex gap-3 text-[13px] text-zinc-500">
              <span>MPN: <Mono color="amber">{unit.mpn}</Mono></span>
              {unit.productName && <span>{unit.productName}</span>}
            </div>

            {/* Grade selection */}
            <div>
              <SectionHead>Assign Grade</SectionHead>
              <div className="grid grid-cols-2 gap-2">
                {([1, 2, 3, 4] as ConditionGrade[]).map((g) => {
                  const color = GRADE_COLORS[g];
                  const selected = selectedGrade === g;
                  return (
                    <button
                      key={g}
                      onClick={() => setSelectedGrade(g)}
                      className="p-3.5 rounded-lg text-left cursor-pointer border-2 transition-colors"
                      style={{
                        background: selected ? `${color}15` : "#35353A",
                        borderColor: selected ? color : "#3F3F46",
                      }}
                    >
                      <div
                        className="text-lg font-extrabold font-mono"
                        style={{ color }}
                      >
                        G{g}
                      </div>
                      <div className="text-xs text-zinc-50 font-semibold mt-0.5">
                        {GRADE_LABELS_NUMERIC[g]}
                      </div>
                      <div className="text-[11px] text-zinc-500 mt-0.5">
                        {GRADE_DESCRIPTIONS[g]}
                      </div>
                      {marketPriceByGrade.has(g) && (
                        <div className="text-[11px] text-teal-500 font-mono mt-0.5">
                          £{marketPriceByGrade.get(g)!.toFixed(2)}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Condition flags */}
            <div>
              <SectionHead>Condition Flags</SectionHead>
              <div className="grid grid-cols-2 gap-1.5">
                {CONDITION_FLAGS.map((f) => (
                  <label
                    key={f.value}
                    className="flex items-center gap-1.5 text-xs text-zinc-400 cursor-pointer py-1"
                  >
                    <input
                      type="checkbox"
                      checked={selectedFlags.has(f.value)}
                      onChange={() => toggleFlag(f.value)}
                      className="accent-amber-500"
                    />
                    {f.label}
                  </label>
                ))}
              </div>
            </div>

            {/* Physical confirmation fields */}
            <div>
              <SectionHead>Physical Confirmation</SectionHead>
              <div className="grid grid-cols-2 gap-2.5">
                {[
                  { label: "EAN", placeholder: "5702017421384" },
                  { label: "Age Mark", placeholder: "14+" },
                  { label: "Dimensions (cm)", placeholder: "38 × 26 × 7" },
                  { label: "Weight (g)", placeholder: "1250" },
                ].map((f) => (
                  <div key={f.label}>
                    <label className="text-[10px] text-zinc-500 font-semibold uppercase tracking-wider block mb-0.5">
                      {f.label}
                    </label>
                    <input
                      placeholder={f.placeholder}
                      className="w-full px-2 py-1.5 bg-[#35353A] border border-zinc-700/80 rounded text-zinc-50 text-[13px]"
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-2 pt-2 border-t border-zinc-700/80">
              <button
                onClick={handleSave}
                disabled={!selectedGrade || gradeUnit.isPending}
                className="flex-1 bg-amber-500 text-zinc-900 border-none rounded-md py-2.5 font-bold text-[13px] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed hover:bg-amber-400 transition-colors"
              >
                {gradeUnit.isPending ? "Saving…" : "Save Grade"}
              </button>
              <button
                onClick={onClose}
                className="px-4 py-2.5 bg-[#3F3F46] text-zinc-400 border border-zinc-700/80 rounded-md text-[13px] cursor-pointer hover:text-zinc-200 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
