import { useNavigate } from "react-router-dom";
import { usePurchaseBatches } from "@/hooks/admin/use-purchase-batches";
import { UNIT_STATUSES } from "@/lib/constants/unit-statuses";
import type { PurchaseBatch, StockUnitStatus } from "@/lib/types/admin";
import { SurfaceCard, Mono, Badge } from "./ui-primitives";

export function PurchaseList() {
  const navigate = useNavigate();
  const { data: batches = [], isLoading } = usePurchaseBatches();

  if (isLoading) {
    return <p className="text-zinc-500 text-sm">Loading batches…</p>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-[22px] font-bold text-zinc-50">Purchases</h1>
        <button
          onClick={() => navigate("/admin/v2/purchases/new")}
          className="bg-amber-500 text-zinc-900 border-none rounded-md px-4 py-2 font-bold text-[13px] cursor-pointer hover:bg-amber-400 transition-colors"
        >
          + New Purchase
        </button>
      </div>
      <p className="text-zinc-500 text-[13px] mb-5">
        Purchase batches and goods-in grading.
      </p>

      <div className="grid gap-3">
        {batches.map((b) => (
          <BatchCard key={b.id} batch={b} onClick={() => navigate(`/admin/v2/purchases/${b.id}`)} />
        ))}
        {batches.length === 0 && (
          <p className="text-zinc-500 text-sm">No purchase batches yet.</p>
        )}
      </div>
    </div>
  );
}

// ─── Batch Card ─────────────────────────────────────────────

function BatchCard({ batch, onClick }: { batch: PurchaseBatch; onClick: () => void }) {
  const totalShared = batch.totalSharedCosts;
  const totalCost = batch.sharedCosts.shipping + batch.sharedCosts.broker_fee + batch.sharedCosts.other;

  // We don't have unit-level data in the list query — we show what we have
  const formattedDate = new Date(batch.purchaseDate).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  return (
    <SurfaceCard onClick={onClick} noPadding className="overflow-hidden">
      <div className="px-4 py-3.5 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <Mono color="amber" className="text-sm">{batch.id}</Mono>
          <span className="text-zinc-50 font-medium text-sm">{batch.supplierName}</span>
          <span className="text-zinc-500 text-xs">{formattedDate}</span>
        </div>
        <div className="flex items-center gap-3">
          {batch.status === "draft" && (
            <Badge label="Draft" color="#F59E0B" small />
          )}
          {batch.status === "recorded" && (
            <Badge label="Recorded" color="#22C55E" small />
          )}
          <Mono color="teal">
            £{totalShared.toFixed(2)}
          </Mono>
        </div>
      </div>
      <div className="px-4 pb-3 flex gap-4 text-xs text-zinc-500">
        <span>Shared: £{totalCost.toFixed(2)}</span>
        {batch.supplierVatRegistered && (
          <span className="text-teal-500">VAT reg. supplier</span>
        )}
      </div>
    </SurfaceCard>
  );
}
