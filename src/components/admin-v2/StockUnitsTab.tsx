import { useEffect, useState } from "react";
import { useStockUnitsByMPN } from "@/hooks/admin/use-stock-units";
import { useSimpleTableFilters } from "@/hooks/useSimpleTableFilters";
import { supabase } from "@/integrations/supabase/client";
import type { StockUnit } from "@/lib/types/admin";
import { SurfaceCard, Mono, StatusBadge, GradeBadge } from "./ui-primitives";
import { TableFilterInput } from "./TableFilterInput";
import { GradeSlideOut } from "./GradeSlideOut";
import { WriteOffDialog } from "./WriteOffDialog";

const UNIT_COLUMNS = [
  { key: "uid", label: "Unit ID" },
  { key: "grade", label: "Grade" },
  { key: "batchId", label: "Batch" },
  { key: "landedCost", label: "Landed Cost" },
  { key: "status", label: "Status" },
  { key: "orderId", label: "Order" },
  { key: "payoutId", label: "Payout" },
];

function unitAccessor(u: StockUnit, key: string): unknown {
  return (u as unknown as Record<string, unknown>)[key];
}

interface StockUnitsTabProps {
  mpn: string;
}

export function StockUnitsTab({ mpn }: StockUnitsTabProps) {
  const { data: units = [], isLoading } = useStockUnitsByMPN(mpn);
  const [slideUnit, setSlideUnit] = useState<StockUnit | null>(null);
  const [selectedUnitIds, setSelectedUnitIds] = useState<Set<string>>(new Set());
  const [showWriteOff, setShowWriteOff] = useState(false);
  const [rawProductData, setRawProductData] = useState<Record<string, unknown> | null>(null);
  const { filters, setFilter, processedRows } = useSimpleTableFilters(units, { accessor: unitAccessor });

  // Load raw product row so the grade slide-out can pre-populate physical fields
  useEffect(() => {
    let cancelled = false;
    if (!mpn) {
      setRawProductData(null);
      return;
    }
    (async () => {
      const { data } = await supabase
        .from('product')
        .select('*')
        .eq('mpn', mpn)
        .maybeSingle();
      if (!cancelled) setRawProductData((data as Record<string, unknown>) ?? null);
    })();
    return () => { cancelled = true; };
  }, [mpn]);

  const toggleSelect = (id: string) => {
    setSelectedUnitIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (isLoading) {
    return <p className="text-zinc-500 text-sm">Loading stock units…</p>;
  }

  return (
    <>
      {selectedUnitIds.size > 0 && (
        <div className="flex gap-2 mb-3">
          <button
            onClick={() => setShowWriteOff(true)}
            className="bg-red-500/20 text-red-400 border border-red-500/30 rounded-md px-3 py-1.5 text-xs font-semibold cursor-pointer hover:bg-red-500/30 transition-colors"
          >
            Write Off {selectedUnitIds.size} Unit{selectedUnitIds.size !== 1 ? "s" : ""}
          </button>
        </div>
      )}

      <SurfaceCard noPadding className="overflow-hidden">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-zinc-200">
              <th className="w-8 px-2.5 py-2" />
              {UNIT_COLUMNS.map((c) => (
                <th
                  key={c.key}
                  className="px-2.5 py-2 text-left text-zinc-500 font-medium text-[10px] uppercase tracking-wider"
                >
                  {c.label}
                </th>
              ))}
              <th />
            </tr>
            <tr className="border-b border-zinc-200 bg-zinc-50">
              <th />
              {UNIT_COLUMNS.map((c) => (
                <th key={c.key} className="px-2 py-1">
                  <TableFilterInput
                    value={filters[c.key] ?? ""}
                    onChange={(v) => setFilter(c.key, v)}
                  />
                </th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {processedRows.map((u) => (
              <tr
                key={u.id}
                className="border-b border-zinc-200"
                style={{
                  background:
                    u.status === "return_pending"
                      ? "rgba(239,68,68,0.03)"
                      : "transparent",
                }}
              >
                <td className="px-2.5 py-2 text-center">
                  <input
                    type="checkbox"
                    checked={selectedUnitIds.has(u.id)}
                    onChange={() => toggleSelect(u.id)}
                    className="accent-amber-500 cursor-pointer"
                  />
                </td>
                <td className="px-2.5 py-2">
                  <Mono>{u.uid ?? "—"}</Mono>
                </td>
                <td className="px-2.5 py-2">
                  {u.grade ? (
                    <GradeBadge grade={u.grade} />
                  ) : (
                    <span className="text-zinc-500 text-xs">—</span>
                  )}
                </td>
                <td className="px-2.5 py-2">
                  <Mono color="dim">{u.batchId ?? "—"}</Mono>
                </td>
                <td className="px-2.5 py-2">
                  <Mono color={u.landedCost ? "teal" : "dim"}>
                    {u.landedCost ? `£${u.landedCost.toFixed(2)}` : "—"}
                  </Mono>
                </td>
                <td className="px-2.5 py-2">
                  <StatusBadge status={u.status} />
                </td>
                <td className="px-2.5 py-2">
                  {u.orderId ? (
                    <Mono color="amber">{u.orderId}</Mono>
                  ) : (
                    <span className="text-zinc-500">—</span>
                  )}
                </td>
                <td className="px-2.5 py-2">
                  {u.payoutId ? (
                    <Mono color="green">{u.payoutId}</Mono>
                  ) : u.orderId ? (
                    <span className="text-amber-500 text-[11px]">Pending</span>
                  ) : (
                    <span className="text-zinc-500">—</span>
                  )}
                </td>
                <td className="px-2.5 py-2">
                  <button
                    onClick={() => setSlideUnit(u)}
                    className="bg-transparent text-zinc-500 border border-zinc-200 rounded px-2 py-0.5 text-[10px] cursor-pointer hover:text-zinc-700 transition-colors"
                  >
                    Edit
                  </button>
                </td>
              </tr>
            ))}
            {processedRows.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-zinc-500 text-sm">
                  {units.length === 0 ? "No stock units for this product." : "No units match your filters."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </SurfaceCard>

      <GradeSlideOut
        unit={slideUnit}
        open={!!slideUnit}
        onClose={() => setSlideUnit(null)}
        rawProductData={rawProductData}
      />

      <WriteOffDialog
        open={showWriteOff}
        onClose={() => {
          setShowWriteOff(false);
          setSelectedUnitIds(new Set());
        }}
        stockUnitIds={Array.from(selectedUnitIds)}
      />
    </>
  );
}
