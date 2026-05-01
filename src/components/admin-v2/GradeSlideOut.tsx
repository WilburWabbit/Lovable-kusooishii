import { useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useGradeStockUnit, useBulkGradeStockUnits } from "@/hooks/admin/use-stock-units";
import { supabase } from "@/integrations/supabase/client";
import { CONDITION_FLAGS, GRADE_COLORS } from "@/lib/constants/unit-statuses";
import { GRADE_LABELS_NUMERIC } from "@/lib/grades";
import type { StockUnit, ConditionGrade, ConditionFlag, ProductVariant, Product } from "@/lib/types/admin";
import { Mono, SectionHead } from "./ui-primitives";
import { toast } from "sonner";

interface PhysicalData {
  ean: string;
  upc: string;
  isbn: string;
  ageMark: string;
  lengthCm: string;
  widthCm: string;
  heightCm: string;
  weightG: string;
}

interface GradeSlideOutProps {
  unit: (StockUnit & { productName?: string }) | null;
  /** When provided, applies grade/flags/physical to all units (bulk MPN mode) */
  bulkUnits?: StockUnit[];
  open: boolean;
  onClose: () => void;
  variants?: ProductVariant[];
  product?: Product | null;
  /** Raw product row from DB — used for pre-populating physical fields */
  rawProductData?: Record<string, unknown> | null;
}

const GRADE_DESCRIPTIONS: Record<number, string> = {
  1: "Factory sealed, untouched",
  2: "Opened but complete",
  3: "Built/used, still complete",
  4: "Incomplete, all issues disclosed",
  5: "Heavy issues, saleable if disclosed",
};

export function GradeSlideOut({ unit, bulkUnits, open, onClose, variants = [], product, rawProductData }: GradeSlideOutProps) {
  const isBulk = bulkUnits && bulkUnits.length > 1;
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
  const [notesText, setNotesText] = useState<string>(unit?.notes ?? "");

  const [physical, setPhysical] = useState<PhysicalData>({
    ean: "", upc: "", isbn: "", ageMark: "", lengthCm: "", widthCm: "", heightCm: "", weightG: "",
  });

  const gradeUnit = useGradeStockUnit();
  const bulkGrade = useBulkGradeStockUnits();
  const isSaving = gradeUnit.isPending || bulkGrade.isPending;

  // Reset state when unit changes
  const unitId = unit?.id;
  const [lastUnitId, setLastUnitId] = useState<string | undefined>();
  if (unitId !== lastUnitId) {
    setLastUnitId(unitId);
    setSelectedGrade((unit?.grade as ConditionGrade) ?? null);
    setSelectedFlags(new Set(unit?.conditionFlags ?? []));
    setNotesText(unit?.notes ?? "");
    // Pre-populate physical fields from product data (raw DB row or typed product)
    const raw = rawProductData;
    const dims = (raw?.dimensions_cm as string) ?? product?.dimensionsCm ?? "";
    const dimParts = dims.split("×").map((s: string) => s.trim());
    setPhysical({
      ean: (raw?.ean as string) ?? product?.ean ?? "",
      upc: (raw?.upc as string) ?? "",
      isbn: (raw?.isbn as string) ?? "",
      ageMark: (raw?.age_mark as string) ?? (raw?.age_range as string) ?? product?.ageMark ?? "",
      lengthCm: (raw?.length_cm != null ? String(raw.length_cm) : "") || dimParts[0] || "",
      widthCm: (raw?.width_cm != null ? String(raw.width_cm) : "") || dimParts[1] || "",
      heightCm: (raw?.height_cm != null ? String(raw.height_cm) : "") || dimParts[2] || "",
      weightG: (raw?.weight_g != null ? String(raw.weight_g) : "") || (product?.weightG != null ? String(product.weightG) : ""),
    });
  }

  const updatePhysical = (field: keyof PhysicalData, value: string) => {
    setPhysical((prev) => ({ ...prev, [field]: value }));
  };

  const girthCm = (() => {
    const l = parseFloat(physical.lengthCm) || 0;
    const w = parseFloat(physical.widthCm) || 0;
    const h = parseFloat(physical.heightCm) || 0;
    return l + w + h;
  })();

  const toggleFlag = (flag: ConditionFlag) => {
    setSelectedFlags((prev) => {
      const next = new Set(prev);
      if (next.has(flag)) next.delete(flag);
      else next.add(flag);
      return next;
    });
  };

  const persistPhysical = async (mpn: string) => {
    const productUpdate: Record<string, unknown> = {};
    if (physical.ean) productUpdate.ean = physical.ean;
    if (physical.upc) productUpdate.upc = physical.upc;
    if (physical.isbn) productUpdate.isbn = physical.isbn;
    if (physical.ageMark) {
      productUpdate.age_mark = physical.ageMark;
      productUpdate.age_range = physical.ageMark;
    }
    const l = parseFloat(physical.lengthCm) || 0;
    const w = parseFloat(physical.widthCm) || 0;
    const h = parseFloat(physical.heightCm) || 0;
    const wt = parseFloat(physical.weightG) || 0;
    if (l) productUpdate.length_cm = l;
    if (w) productUpdate.width_cm = w;
    if (h) productUpdate.height_cm = h;
    if (l || w || h) productUpdate.dimensions_cm = `${l || 0} × ${w || 0} × ${h || 0}`;
    if (wt) {
      productUpdate.weight_g = Math.round(wt);
      productUpdate.weight_kg = wt / 1000;
    }

    if (Object.keys(productUpdate).length > 0) {
      await supabase
        .from('product')
        .update(productUpdate as never)
        .eq('mpn', mpn);
    }
  };

  const handleSave = async () => {
    if (!unit || !selectedGrade) return;

    try {
      if (isBulk && bulkUnits) {
        await bulkGrade.mutateAsync({
          stockUnitIds: bulkUnits.map((u) => u.id),
          grade: selectedGrade,
          conditionFlags: Array.from(selectedFlags),
        });
        await persistPhysical(unit.mpn);
        toast.success(`${bulkUnits.length} units graded as G${selectedGrade}`);
      } else {
        await gradeUnit.mutateAsync({
          stockUnitId: unit.id,
          grade: selectedGrade,
          conditionFlags: Array.from(selectedFlags),
          notes: notesText,
        });
        await persistPhysical(unit.mpn);
        toast.success(`Unit ${unit.uid} graded as G${selectedGrade}`);
      }
      onClose();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Grading failed";
      toast.error(message);
    }
  };

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-[480px] bg-white border-zinc-200 p-0 flex flex-col">
        <SheetHeader className="px-5 py-4 border-b border-zinc-200">
          <SheetTitle className="text-zinc-900 text-base font-bold">
            {isBulk ? `Edit ${bulkUnits!.length} Units — ${unit?.mpn}` : `Grade Unit ${unit?.uid ?? ""}`}
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
                {([1, 2, 3, 4, 5] as ConditionGrade[]).map((g) => {
                  const color = GRADE_COLORS[g];
                  const selected = selectedGrade === g;
                  return (
                    <button
                      key={g}
                      onClick={() => setSelectedGrade(g)}
                      className="p-3.5 rounded-lg text-left cursor-pointer border-2 transition-colors"
                      style={{
                        background: selected ? `${color}15` : "#F4F4F5",
                        borderColor: selected ? color : "#E4E4E7",
                      }}
                    >
                      <div
                        className="text-lg font-extrabold font-mono"
                        style={{ color }}
                      >
                        G{g}
                      </div>
                      <div className="text-xs text-zinc-900 font-semibold mt-0.5">
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

            {/* Notes */}
            <div>
              <SectionHead>Notes</SectionHead>
              <textarea
                value={notesText}
                onChange={(e) => setNotesText(e.target.value)}
                placeholder="Add condition notes, observations…"
                className="w-full px-2.5 py-2 bg-zinc-50 border border-zinc-200 rounded text-zinc-900 text-[13px] min-h-[64px] resize-y"
              />
            </div>

            {/* Physical confirmation fields */}
            <div>
              <SectionHead>Physical Confirmation</SectionHead>
              <div className="grid grid-cols-2 gap-2.5">
                {([
                  { label: "EAN", field: "ean" as const },
                  { label: "UPC", field: "upc" as const },
                  { label: "ISBN", field: "isbn" as const },
                  { label: "Age Mark", field: "ageMark" as const },
                  { label: "Length (cm)", field: "lengthCm" as const },
                  { label: "Width (cm)", field: "widthCm" as const },
                  { label: "Height (cm)", field: "heightCm" as const },
                  { label: "Weight (g)", field: "weightG" as const },
                ] as const).map((f) => (
                  <div key={f.field}>
                    <label className="text-[10px] text-zinc-500 font-semibold uppercase tracking-wider block mb-0.5">
                      {f.label}
                    </label>
                    <input
                      value={physical[f.field]}
                      onChange={(e) => updatePhysical(f.field, e.target.value)}
                      className="w-full px-2 py-1.5 bg-zinc-50 border border-zinc-200 rounded text-zinc-900 text-[13px]"
                    />
                  </div>
                ))}
              </div>
              {girthCm > 0 && (
                <div className="mt-2 text-[11px] text-zinc-500">
                  Girth: <Mono color="default">{girthCm.toFixed(1)} cm</Mono>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-2 pt-2 border-t border-zinc-200">
              <button
                onClick={handleSave}
                disabled={!selectedGrade || isSaving}
                className="flex-1 bg-amber-500 text-zinc-900 border-none rounded-md py-2.5 font-bold text-[13px] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed hover:bg-amber-400 transition-colors"
              >
                {isSaving
                  ? "Saving…"
                  : isBulk
                    ? `Save ${bulkUnits!.length} Units`
                    : "Save Grade"}
              </button>
              <button
                onClick={onClose}
                className="px-4 py-2.5 bg-zinc-100 text-zinc-500 border border-zinc-200 rounded-md text-[13px] cursor-pointer hover:text-zinc-700 transition-colors"
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
