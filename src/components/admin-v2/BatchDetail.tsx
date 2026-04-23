import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Trash2 } from "lucide-react";
import { usePurchaseBatch, useDeletePurchaseBatch } from "@/hooks/admin/use-purchase-batches";
import { useBulkGradeStockUnits } from "@/hooks/admin/use-stock-units";
import type { StockUnit, ConditionGrade, PurchaseLineItem } from "@/lib/types/admin";
import {
  SurfaceCard,
  SummaryCard,
  Mono,
  Badge,
  StatusBadge,
  GradeBadge,
  BackButton,
} from "./ui-primitives";
import { GradeSlideOut } from "./GradeSlideOut";
import { BulkGradeDialog } from "./BulkGradeDialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";

interface BatchDetailProps {
  batchId: string;
}

export function BatchDetail({ batchId }: BatchDetailProps) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { data: batch, isLoading } = usePurchaseBatch(batchId);
  const deleteBatch = useDeletePurchaseBatch();
  const [gradingUnit, setGradingUnit] = useState<(StockUnit & { productName?: string }) | null>(null);
  const [bulkGradingUnits, setBulkGradingUnits] = useState<StockUnit[]>([]);
  const [selectedUnitIds, setSelectedUnitIds] = useState<Set<string>>(new Set());
  const [showBulkGrade, setShowBulkGrade] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const allUnits = useMemo(() => {
    if (!batch) return [];
    return batch.lineItems.flatMap((li) =>
      li.units.map((u) => ({ ...u, mpn: li.mpn, unitCost: li.unitCost }))
    );
  }, [batch]);

  const ungradedCount = allUnits.filter((u) => u.grade === null).length;
  const totalUnits = allUnits.length;
  const totalCost = batch
    ? batch.lineItems.reduce((sum, li) => sum + li.unitCost * li.quantity, 0) + batch.totalSharedCosts
    : 0;

  // A batch is safe to delete only if no unit has progressed past the
  // pre-listing stages. Anything sold/shipped/listed/reserved blocks deletion;
  // the edge function enforces this server-side as well.
  const hasLockedUnits = allUnits.some((u) =>
    ["sold", "shipped", "delivered", "listed", "reserved"].includes(String(u.status))
    || Boolean(u.orderId)
  );

  const toggleSelect = (id: string) => {
    setSelectedUnitIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleConfirmDelete = async () => {
    try {
      const result = await deleteBatch.mutateAsync({ batchId });
      const qboMsg = result.qbo_purchase_id
        ? ("deleted" in result.qbo_result && result.qbo_result.deleted
            ? " and removed from QuickBooks"
            : ` (QuickBooks delete failed: ${("reason" in result.qbo_result && result.qbo_result.reason) || "unknown"})`)
        : "";
      toast({
        title: `Batch ${batchId} deleted`,
        description: `${result.units_deleted} unit(s) removed${qboMsg}.`,
      });
      setShowDeleteDialog(false);
      navigate("/admin/purchases");
    } catch (e) {
      toast({
        title: "Delete failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
        duration: 10000,
      });
    }
  };

  if (isLoading) {
    return <p className="text-zinc-500 text-sm">Loading batch…</p>;
  }

  if (!batch) {
    return <p className="text-zinc-500 text-sm">Batch not found.</p>;
  }

  const formattedDate = new Date(batch.purchaseDate).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  return (
    <div>
      <BackButton onClick={() => navigate("/admin/purchases")} label="Back to purchases" />

      {/* Header */}
      <div className="flex items-start justify-between mb-5">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-[22px] font-bold text-zinc-900">{batch.id}</h1>
            {ungradedCount > 0 ? (
              <Badge label={`${ungradedCount} ungraded`} color="#F59E0B" />
            ) : (
              <Badge label="All graded" color="#22C55E" />
            )}
          </div>
          <div className="flex gap-4 text-zinc-500 text-[13px]">
            <span>{batch.supplierName}</span>
            <span>{formattedDate}</span>
            <span>
              Total: <Mono color="teal">£{totalCost.toFixed(2)}</Mono>
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {selectedUnitIds.size > 0 && (
            <button
              onClick={() => setShowBulkGrade(true)}
              className="bg-amber-500 text-zinc-900 border-none rounded-md px-4 py-2 font-bold text-[13px] cursor-pointer hover:bg-amber-400 transition-colors"
            >
              Bulk Grade {selectedUnitIds.size} Units
            </button>
          )}
          <button
            onClick={() => setShowDeleteDialog(true)}
            disabled={hasLockedUnits}
            title={hasLockedUnits ? "Cannot delete: some units are listed, sold or shipped" : "Delete this purchase batch"}
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-3 py-2 text-[13px] font-semibold text-red-600 transition-colors hover:bg-red-50 hover:border-red-300 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-white disabled:hover:border-zinc-300"
          >
            <Trash2 size={14} />
            Delete
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        <SummaryCard label="Total Units" value={totalUnits} />
        <SummaryCard label="Shared Costs" value={`£${batch.totalSharedCosts.toFixed(2)}`} color="#A1A1AA" />
        <SummaryCard label="Batch Cost" value={`£${totalCost.toFixed(2)}`} color="#14B8A6" />
        <SummaryCard
          label="Ungraded"
          value={ungradedCount}
          color={ungradedCount > 0 ? "#F59E0B" : "#22C55E"}
        />
      </div>

      {/* Line items */}
      {batch.lineItems.map((line) => (
        <LineItemCard
          key={line.id}
          line={line}
          selectedUnitIds={selectedUnitIds}
          onToggleSelect={toggleSelect}
          onEditMpn={() => {
            const firstUnit = line.units[0];
            if (!firstUnit) return;
            setGradingUnit({ ...firstUnit, productName: (line as { productName?: string }).productName ?? undefined });
            setBulkGradingUnits(line.units);
          }}
          onGradeUnit={(unit) => {
            setGradingUnit({ ...unit, productName: (line as { productName?: string }).productName ?? undefined });
            setBulkGradingUnits([]);
          }}
        />
      ))}

      {/* Grade slide-out */}
      <GradeSlideOut
        unit={gradingUnit}
        bulkUnits={bulkGradingUnits.length > 1 ? bulkGradingUnits : undefined}
        open={!!gradingUnit}
        onClose={() => {
          setGradingUnit(null);
          setBulkGradingUnits([]);
        }}
        rawProductData={gradingUnit ? batch.productDataMap?.get(gradingUnit.mpn) ?? null : null}
      />

      {/* Bulk grade dialog */}
      <BulkGradeDialog
        open={showBulkGrade}
        onClose={() => {
          setShowBulkGrade(false);
          setSelectedUnitIds(new Set());
        }}
        stockUnitIds={Array.from(selectedUnitIds)}
      />

      {/* Delete confirmation */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete purchase batch {batch.id}?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <span className="block">
                This will permanently delete the batch, its {totalUnits} stock unit(s) and {batch.lineItems.length} line item(s).
              </span>
              {batch.reference && (
                <span className="block">
                  If this batch is linked to QuickBooks (reference{" "}
                  <span className="font-mono text-xs">{batch.reference}</span>), the matching Purchase will also be deleted in QuickBooks.
                </span>
              )}
              <span className="block font-semibold text-red-600">
                This action cannot be undone.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteBatch.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleConfirmDelete();
              }}
              disabled={deleteBatch.isPending}
              className="bg-red-600 text-white hover:bg-red-700 focus:ring-red-600"
            >
              {deleteBatch.isPending ? "Deleting…" : "Delete batch"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Line Item Card ─────────────────────────────────────────

interface LineItemCardProps {
  line: PurchaseLineItem & { units: StockUnit[]; productName?: string | null };
  selectedUnitIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onEditMpn: () => void;
  onGradeUnit: (unit: StockUnit) => void;
}

function LineItemCard({ line, selectedUnitIds, onToggleSelect, onEditMpn, onGradeUnit }: LineItemCardProps) {
  return (
    <SurfaceCard noPadding className="mb-3 overflow-hidden">
      {/* Line header */}
      <div className="px-4 py-3 border-b border-zinc-200 flex justify-between items-center">
        <div className="flex items-center gap-2.5">
          <Mono color="amber">{line.mpn}</Mono>
          {line.productName && (
            <span className="text-zinc-600 text-sm truncate max-w-[280px]">{line.productName}</span>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-zinc-500">
          <span>Qty: {line.quantity}</span>
          <span>
            Unit cost: <Mono>£{line.unitCost.toFixed(2)}</Mono>
          </span>
          {line.units.length > 1 && (
            <button
              onClick={onEditMpn}
              className="ml-1 rounded px-2.5 py-1 text-[11px] font-semibold cursor-pointer transition-colors bg-transparent text-zinc-500 border border-zinc-300 hover:text-zinc-900 hover:border-zinc-400"
            >
              Edit all {line.units.length}
            </button>
          )}
        </div>
      </div>

      {/* Units table */}
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="border-b border-zinc-200">
            <th className="w-8 px-3 py-2" />
            {["Unit ID", "Grade", "Status", "Landed Cost", ""].map((h) => (
              <th
                key={h}
                className="px-3 py-2 text-left text-zinc-500 font-medium text-[10px] uppercase tracking-wider"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {line.units.map((u) => (
            <tr
              key={u.id}
              className="border-b border-zinc-200"
              style={{
                background: u.grade === null ? "rgba(245,158,11,0.03)" : "transparent",
              }}
            >
              <td className="px-3 py-2 text-center">
                {u.grade === null && (
                  <input
                    type="checkbox"
                    checked={selectedUnitIds.has(u.id)}
                    onChange={() => onToggleSelect(u.id)}
                    className="accent-amber-500 cursor-pointer"
                  />
                )}
              </td>
              <td className="px-3 py-2">
                <Mono>{u.uid ?? "—"}</Mono>
              </td>
              <td className="px-3 py-2">
                {u.grade ? (
                  <GradeBadge grade={u.grade} />
                ) : (
                  <span className="text-amber-500 italic text-xs">Awaiting grading</span>
                )}
              </td>
              <td className="px-3 py-2">
                <StatusBadge status={u.status} />
              </td>
              <td className="px-3 py-2">
                <Mono color={u.landedCost ? "teal" : "dim"}>
                  {u.landedCost ? `£${u.landedCost.toFixed(2)}` : "—"}
                </Mono>
              </td>
              <td className="px-3 py-2">
                <button
                  onClick={() => onGradeUnit(u)}
                  className="rounded px-2.5 py-1 text-[11px] cursor-pointer transition-colors"
                  style={
                    u.grade === null
                      ? {
                          background: "#F59E0B",
                          color: "#18181B",
                          border: "none",
                          fontWeight: 700,
                        }
                      : {
                          background: "transparent",
                          color: "#71717A",
                          border: "1px solid #D4D4D8",
                        }
                  }
                >
                  {u.grade === null ? "Grade" : "Edit"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </SurfaceCard>
  );
}
