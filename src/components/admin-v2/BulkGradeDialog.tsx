import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useBulkGradeStockUnits } from "@/hooks/admin/use-stock-units";
import { CONDITION_FLAGS, GRADE_COLORS } from "@/lib/constants/unit-statuses";
import { GRADE_LABELS_NUMERIC } from "@/lib/grades";
import type { ConditionGrade, ConditionFlag } from "@/lib/types/admin";
import { SectionHead } from "./ui-primitives";
import { toast } from "sonner";

interface BulkGradeDialogProps {
  open: boolean;
  onClose: () => void;
  stockUnitIds: string[];
}

export function BulkGradeDialog({ open, onClose, stockUnitIds }: BulkGradeDialogProps) {
  const [selectedGrade, setSelectedGrade] = useState<ConditionGrade | null>(null);
  const [selectedFlags, setSelectedFlags] = useState<Set<ConditionFlag>>(new Set());
  const bulkGrade = useBulkGradeStockUnits();

  const toggleFlag = (flag: ConditionFlag) => {
    setSelectedFlags((prev) => {
      const next = new Set(prev);
      if (next.has(flag)) next.delete(flag);
      else next.add(flag);
      return next;
    });
  };

  const handleSave = async () => {
    if (!selectedGrade) return;

    try {
      await bulkGrade.mutateAsync({
        stockUnitIds,
        grade: selectedGrade,
        conditionFlags: Array.from(selectedFlags),
      });
      toast.success(`${stockUnitIds.length} units graded as G${selectedGrade}`);
      setSelectedGrade(null);
      setSelectedFlags(new Set());
      onClose();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Bulk grading failed";
      toast.error(message);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-white border-zinc-200 text-zinc-900 max-w-md">
        <DialogHeader>
          <DialogTitle>Bulk Grade {stockUnitIds.length} Units</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 mt-2">
          {/* Grade selection */}
          <div>
            <SectionHead>Assign Grade</SectionHead>
            <div className="grid grid-cols-2 gap-2">
              {([1, 2, 3, 4, 5] as ConditionGrade[]).map((g) => {
                const color = GRADE_COLORS[g];
                const selected = selectedGrade === g;
                return (
                  <button
                    key={g}
                    onClick={() => setSelectedGrade(g)}
                    className="p-3 rounded-lg text-left cursor-pointer border-2 transition-colors"
                    style={{
                      background: selected ? `${color}15` : "#F4F4F5",
                      borderColor: selected ? color : "#E4E4E7",
                    }}
                  >
                    <div className="text-lg font-extrabold font-mono" style={{ color }}>
                      G{g}
                    </div>
                    <div className="text-xs text-zinc-900 font-semibold mt-0.5">
                      {GRADE_LABELS_NUMERIC[g]}
                    </div>
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
                  className="flex items-center gap-1.5 text-xs text-zinc-600 cursor-pointer py-1"
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

          {/* Actions */}
          <div className="flex gap-2 pt-2 border-t border-zinc-200">
            <button
              onClick={handleSave}
              disabled={!selectedGrade || bulkGrade.isPending}
              className="flex-1 bg-amber-500 text-zinc-900 border-none rounded-md py-2.5 font-bold text-[13px] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed hover:bg-amber-400 transition-colors"
            >
              {bulkGrade.isPending
                ? "Grading…"
                : `Grade ${stockUnitIds.length} Units as G${selectedGrade ?? "?"}`}
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2.5 bg-zinc-100 text-zinc-400 border border-zinc-200 rounded-md text-[13px] cursor-pointer hover:text-zinc-700 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
