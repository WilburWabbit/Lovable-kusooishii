import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { usePurchaseBatches, useBatchUnitSummaries } from "@/hooks/admin/use-purchase-batches";
import type { BatchUnitSummary } from "@/hooks/admin/use-purchase-batches";
import { UNIT_STATUSES } from "@/lib/constants/unit-statuses";
import type { PurchaseBatch, StockUnitStatus } from "@/lib/types/admin";
import { SurfaceCard, Mono, Badge } from "./ui-primitives";
import { supabase } from "@/integrations/supabase/client";
import { Download } from "lucide-react";
import { toast } from "sonner";

export function PurchaseList() {
  const navigate = useNavigate();
  const { data: batches = [], isLoading } = usePurchaseBatches();
  const { data: summaryMap } = useBatchUnitSummaries();
  const [exporting, setExporting] = useState(false);

  const totalUngraded = summaryMap
    ? Array.from(summaryMap.values()).reduce((s, b) => s + b.ungradedCount, 0)
    : 0;

  if (isLoading) {
    return <p className="text-zinc-500 text-sm">Loading batches…</p>;
  }

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-1">
        <h1 className="text-[22px] font-bold text-zinc-900">Purchases</h1>
        <div className="flex gap-2">
          <button
            onClick={() => handleExportCsv(batches, setExporting)}
            disabled={exporting || batches.length === 0}
            className="h-9 px-3 gap-1.5 inline-flex items-center text-[13px] border border-zinc-300 rounded-md bg-white text-zinc-700 hover:bg-zinc-50 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download className="h-3.5 w-3.5" />
            {exporting ? "Exporting…" : "CSV"}
          </button>
          <button
            onClick={() => navigate("/admin/purchases/new")}
            className="bg-amber-500 text-zinc-900 border-none rounded-md px-4 py-2 font-bold text-[13px] cursor-pointer hover:bg-amber-400 transition-colors"
          >
            + New Purchase
          </button>
        </div>
      </div>
      <p className="text-zinc-500 text-[13px] mb-5">
        Purchase batches and goods-in grading.
        {totalUngraded > 0 && (
          <span className="text-amber-500"> {totalUngraded} units awaiting grading.</span>
        )}
      </p>

      <div className="grid gap-3">
        {batches.map((b) => (
          <BatchCard
            key={b.id}
            batch={b}
            summary={summaryMap?.get(b.id)}
            onClick={() => navigate(`/admin/purchases/${b.id}`)}
          />
        ))}
        {batches.length === 0 && (
          <p className="text-zinc-500 text-sm">No purchase batches yet.</p>
        )}
      </div>
    </div>
  );
}

// ─── Batch Card ─────────────────────────────────────────────

function BatchCard({
  batch,
  summary,
  onClick,
}: {
  batch: PurchaseBatch;
  summary?: BatchUnitSummary;
  onClick: () => void;
}) {
  const totalShared = batch.totalSharedCosts;
  const totalCost = batch.sharedCosts.shipping + batch.sharedCosts.broker_fee + batch.sharedCosts.other;

  const formattedDate = new Date(batch.purchaseDate).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  const ungradedCount = summary?.ungradedCount ?? 0;
  const totalUnits = summary?.totalUnits ?? 0;
  const mpnCount = summary?.mpnCount ?? 0;

  return (
    <SurfaceCard onClick={onClick} noPadding className="overflow-hidden">
      <div className="px-4 py-3.5 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <Mono color="amber" className="text-sm">{batch.id}</Mono>
          <span className="text-zinc-900 font-medium text-sm">{batch.supplierName}</span>
          <span className="text-zinc-500 text-xs">{formattedDate}</span>
        </div>
        <div className="flex items-center gap-3">
          {ungradedCount > 0 ? (
            <Badge label={`${ungradedCount} ungraded`} color="#F59E0B" />
          ) : totalUnits > 0 ? (
            <Badge label="All graded" color="#22C55E" small />
          ) : null}
          <Mono color="teal">
            £{totalShared.toFixed(2)}
          </Mono>
        </div>
      </div>
      <div className="px-4 pb-3 flex gap-4 text-xs text-zinc-500">
        {totalUnits > 0 && <span>{totalUnits} units</span>}
        {mpnCount > 0 && <span>{mpnCount} MPNs</span>}
        <span>Shared: £{totalCost.toFixed(2)}</span>
        {batch.supplierVatRegistered && (
          <span className="text-teal-500">VAT reg. supplier</span>
        )}
      </div>
      {/* Status bar */}
      {summary && totalUnits > 0 && (
        <div className="flex h-[3px]">
          {Object.entries(summary.statusCounts).map(([status, count]) => {
            const s = UNIT_STATUSES[status as StockUnitStatus];
            return (
              <div
                key={status}
                style={{
                  flex: count,
                  background: s?.color ?? "#71717A",
                  opacity: 0.6,
                }}
              />
            );
          })}
        </div>
      )}
    </SurfaceCard>
  );
}

// ─── CSV Export ─────────────────────────────────────────────

function csvEscape(value: unknown): string {
  const s = value == null ? "" : String(value);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

const CSV_COLUMNS = [
  "Batch ID",
  "Supplier",
  "Purchase Date",
  "Supplier VAT Reg",
  "Shared Shipping",
  "Shared Broker Fee",
  "Shared Other",
  "MPN",
  "Product Name",
  "Line Qty",
  "Unit Cost",
  "Apportioned Cost",
  "Landed Cost/Unit",
  "Unit ID",
  "Unit UID",
  "Grade",
  "SKU",
  "Status",
  "Condition Flags",
  "Landed Cost",
  "Graded At",
  "Listed At",
  "Sold At",
  "Order ID",
];

async function handleExportCsv(
  batches: PurchaseBatch[],
  setExporting: (v: boolean) => void,
) {
  setExporting(true);
  try {
    const batchIds = batches.map((b) => b.id);

    // Fetch all line items across all batches
    const { data: lineRows, error: lineErr } = await supabase
      .from("purchase_line_items" as never)
      .select("*")
      .in("batch_id", batchIds)
      .order("created_at", { ascending: true });

    if (lineErr) throw lineErr;

    // Fetch all stock units across all batches
    const { data: unitRows, error: unitErr } = await supabase
      .from("stock_unit")
      .select("*")
      .in("batch_id" as never, batchIds);

    if (unitErr) throw unitErr;

    // Fetch product names for all MPNs
    const mpns = [...new Set((lineRows as Record<string, unknown>[]).map((r) => r.mpn as string))];
    const nameMap = new Map<string, string>();
    if (mpns.length > 0) {
      const { data: products } = await supabase
        .from("product")
        .select("mpn, name")
        .in("mpn", mpns);
      for (const p of (products ?? []) as Record<string, unknown>[]) {
        nameMap.set(p.mpn as string, (p.name as string) ?? "");
      }
    }

    // Index batches and line items
    const batchMap = new Map(batches.map((b) => [b.id, b]));
    const lineMap = new Map<string, Record<string, unknown>>();
    for (const r of (lineRows ?? []) as Record<string, unknown>[]) {
      lineMap.set(r.id as string, r);
    }

    // Group units by line_item_id
    const unitsByLine = new Map<string, Record<string, unknown>[]>();
    for (const u of (unitRows ?? []) as Record<string, unknown>[]) {
      const lineId = u.line_item_id as string;
      if (!lineId) continue;
      const list = unitsByLine.get(lineId) ?? [];
      list.push(u);
      unitsByLine.set(lineId, list);
    }

    // Build CSV rows — one per stock unit
    const rows: string[] = [];
    for (const lineRow of (lineRows ?? []) as Record<string, unknown>[]) {
      const batch = batchMap.get(lineRow.batch_id as string);
      if (!batch) continue;

      const mpn = lineRow.mpn as string;
      const units = unitsByLine.get(lineRow.id as string) ?? [];

      // If no stock units exist for this line, still emit one row
      if (units.length === 0) {
        rows.push(buildCsvRow(batch, lineRow, mpn, nameMap.get(mpn) ?? "", null));
      } else {
        for (const unit of units) {
          rows.push(buildCsvRow(batch, lineRow, mpn, nameMap.get(mpn) ?? "", unit));
        }
      }
    }

    const csv = [CSV_COLUMNS.map(csvEscape).join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `purchases-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);

    toast.success(`Exported ${rows.length} records`);
  } catch (err: unknown) {
    toast.error(err instanceof Error ? err.message : "Export failed");
  } finally {
    setExporting(false);
  }
}

function buildCsvRow(
  batch: PurchaseBatch,
  line: Record<string, unknown>,
  mpn: string,
  productName: string,
  unit: Record<string, unknown> | null,
): string {
  const vals = [
    batch.id,
    batch.supplierName,
    batch.purchaseDate,
    batch.supplierVatRegistered ? "Yes" : "No",
    batch.sharedCosts.shipping,
    batch.sharedCosts.broker_fee,
    batch.sharedCosts.other,
    mpn,
    productName,
    line.quantity,
    line.unit_cost,
    line.apportioned_cost,
    line.landed_cost_per_unit,
    unit?.id ?? "",
    unit?.uid ?? "",
    unit?.condition_grade ?? "",
    unit?.condition_grade ? `${mpn}.${unit.condition_grade}` : "",
    unit?.v2_status ?? "",
    unit?.condition_flags ? (unit.condition_flags as string[]).join("; ") : "",
    unit?.landed_cost ?? "",
    unit?.graded_at ?? "",
    unit?.listed_at ?? "",
    unit?.sold_at ?? "",
    unit?.order_id ?? "",
  ];
  return vals.map(csvEscape).join(",");
}
