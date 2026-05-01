import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Trash2, RefreshCw, Pencil } from "lucide-react";
import { usePurchaseBatch, useDeletePurchaseBatch, usePushPurchaseToQbo } from "@/hooks/admin/use-purchase-batches";
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
import { EditPurchaseDialog } from "./EditPurchaseDialog";
import { EditLineItemDialog } from "./EditLineItemDialog";
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
  const pushQbo = usePushPurchaseToQbo();
  const [gradingUnit, setGradingUnit] = useState<(StockUnit & { productName?: string }) | null>(null);
  const [bulkGradingUnits, setBulkGradingUnits] = useState<StockUnit[]>([]);
  const [selectedUnitIds, setSelectedUnitIds] = useState<Set<string>>(new Set());
  const [showBulkGrade, setShowBulkGrade] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editingLineId, setEditingLineId] = useState<string | null>(null);

  const allUnits = useMemo(() => {
    if (!batch) return [];
    return batch.lineItems.flatMap((li) =>
      li.units.map((u) => ({ ...u, mpn: li.mpn, unitCost: li.unitCost }))
    );
  }, [batch]);

  const ungradedCount = allUnits.filter((u) => u.grade === null || String(u.status) === "purchased").length;
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

  const handlePushQbo = async () => {
    if (ungradedCount > 0) {
      toast({
        title: "Grade before QBO",
        description: `${ungradedCount} unit(s) still need final grading. Purchases are only sent to QBO after grading is complete.`,
        variant: "destructive",
        duration: 9000,
      });
      return;
    }

    try {
      const result = await pushQbo.mutateAsync(batchId);
      toast({
        title: "Pushed to QuickBooks",
        description: result.qbo_purchase_id
          ? `Cash Purchase #${result.qbo_purchase_id} created.`
          : "QBO sync queued.",
      });
    } catch (e) {
      toast({
        title: "QBO push failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
        duration: 12000,
      });
    }
  };

  const handleRepairItems = async () => {
    if (!confirm(
      `Repair QBO items for ${batchId}?\n\n` +
      `This will:\n` +
      `  • Deactivate the existing QBO items linked to this batch's SKUs\n` +
      `  • Clear the local QBO item references\n` +
      `  • Reset the batch sync status so you can re-push it\n\n` +
      `After this, click "Push to QBO" to recreate the items as proper Inventory items. Continue?`,
    )) return;

    try {
      const { data, error } = await import("@/integrations/supabase/client").then((m) =>
        m.supabase.functions.invoke("v2-repair-purchase-batch-items", { body: { batch_id: batchId } }),
      );
      if (error) throw error;
      if (data && typeof data === "object" && "error" in data) {
        throw new Error(String((data as { error: unknown }).error));
      }
      const skus = (data as { skus?: { sku_code: string; deactivated: boolean }[] })?.skus ?? [];
      const ok = skus.filter((s) => s.deactivated).length;
      toast({
        title: "QBO items repaired",
        description: `${ok}/${skus.length} item(s) deactivated. Now click "Push to QBO" to recreate them.`,
        duration: 8000,
      });
    } catch (e) {
      toast({
        title: "Repair failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
        duration: 12000,
      });
    }
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
            <h1 className="text-[22px] font-bold text-zinc-900">
              {batch.id}
            </h1>
            {ungradedCount > 0 ? (
              <Badge label={`${ungradedCount} ungraded`} color="#F59E0B" />
            ) : (
              <Badge label="All graded" color="#22C55E" />
            )}
            {batch.qboSyncStatus === "synced" && batch.qboPurchaseId && (
              <Badge label={`QBO #${batch.qboPurchaseId}`} color="#22C55E" />
            )}
            {batch.qboSyncStatus === "pending" && (
              <Badge label="QBO: pending" color="#A1A1AA" />
            )}
            {batch.qboSyncStatus === "error" && (
              <Badge label="QBO: error" color="#EF4444" />
            )}
            {batch.qboSyncStatus === "skipped" && (
              <Badge label="QBO: skipped" color="#71717A" />
            )}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-zinc-500 text-[13px]">
            <span>{batch.supplierName}</span>
            <span>{formattedDate}</span>
            <span className="font-mono text-[11px] text-zinc-400">App: {batch.id}</span>
            <span className="font-mono text-[11px] text-zinc-400">Supplier Ref: {batch.reference ?? "—"}</span>
            <span className="font-mono text-[11px] text-zinc-400">QBO ID: {batch.qboPurchaseId ?? "—"}</span>
            <span>
              Total: <Mono color="teal">£{totalCost.toFixed(2)}</Mono>
            </span>
          </div>
          {batch.qboSyncStatus === "error" && batch.qboSyncError && (
            <div className="mt-2 max-w-2xl rounded border border-red-200 bg-red-50 p-2 text-[11px] text-red-800 font-mono break-words">
              {batch.qboSyncError}
            </div>
          )}
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
          {(batch.qboSyncStatus === "error" || batch.qboPurchaseId) && (
            <button
              onClick={handleRepairItems}
              title="Deactivate the existing QBO items for this batch and clear local refs so they can be recreated as proper Inventory items"
              className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] font-semibold text-amber-800 transition-colors hover:bg-amber-100 hover:border-amber-400"
            >
              Repair QBO items
            </button>
          )}
          {(batch.qboSyncStatus === "pending" || batch.qboSyncStatus === "error") && (
            <button
              onClick={handlePushQbo}
              disabled={pushQbo.isPending || ungradedCount > 0}
              title={ungradedCount > 0 ? "Grade every unit before pushing this purchase to QuickBooks" : "Push this batch to QuickBooks as a Cash Purchase"}
              className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-3 py-2 text-[13px] font-semibold text-zinc-800 transition-colors hover:bg-zinc-50 hover:border-zinc-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw size={14} className={pushQbo.isPending ? "animate-spin" : ""} />
              {pushQbo.isPending
                ? "Pushing…"
                : batch.qboSyncStatus === "error"
                ? "Retry QBO sync"
                : "Push to QBO"}
            </button>
          )}
          <button
            onClick={() => setShowEditDialog(true)}
            title="Edit purchase details (supplier, date, reference, VAT, shared costs) and push the changes to QuickBooks"
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-3 py-2 text-[13px] font-semibold text-zinc-800 transition-colors hover:bg-zinc-50 hover:border-zinc-400"
          >
            <Pencil size={14} />
            Edit
          </button>
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
          onEditLine={() => setEditingLineId(line.id)}
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

      {/* Edit purchase dialog */}
      <EditPurchaseDialog
        open={showEditDialog}
        onClose={() => setShowEditDialog(false)}
        batch={batch}
      />

      {/* Edit line item dialog */}
      <EditLineItemDialog
        open={editingLineId !== null}
        onClose={() => setEditingLineId(null)}
        batch={batch}
        line={batch.lineItems.find((l) => l.id === editingLineId) ?? null}
      />
    </div>
  );
}

// ─── Line Item Card ─────────────────────────────────────────

interface LineItemCardProps {
  line: PurchaseLineItem & { units: StockUnit[]; productName?: string | null };
  selectedUnitIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onEditMpn: () => void;
  onEditLine: () => void;
  onGradeUnit: (unit: StockUnit) => void;
}

function LineItemCard({ line, selectedUnitIds, onToggleSelect, onEditMpn, onEditLine, onGradeUnit }: LineItemCardProps) {
  return (
    <SurfaceCard noPadding className="mb-3 overflow-hidden">
      {/* Line header */}
      <div className="px-4 py-3 border-b border-zinc-200 flex justify-between items-center">
        <div className="flex items-center gap-2.5">
          <Mono color="amber">{line.mpn}</Mono>
          {line.productName && (
            <span className="text-zinc-600 text-sm truncate max-w-[280px]">{line.productName}</span>
          )}
          <button
            onClick={onEditLine}
            title="Edit name and unit cost for this line"
            className="ml-1 inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-semibold cursor-pointer transition-colors bg-transparent text-zinc-500 border border-zinc-300 hover:text-zinc-900 hover:border-zinc-400"
          >
            <Pencil size={11} />
            Edit
          </button>
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
