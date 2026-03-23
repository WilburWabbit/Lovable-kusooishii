import { useState } from "react";
import { usePayouts, usePayoutSummary } from "@/hooks/admin/use-payouts";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { Payout } from "@/lib/types/admin";
import { SurfaceCard, Mono, Badge, SectionHead } from "./ui-primitives";
import { toast } from "sonner";

export function PayoutView() {
  const { data: summary, isLoading: summaryLoading } = usePayoutSummary();
  const [selectedPayout, setSelectedPayout] = useState<Payout | null>(null);
  const { data: payouts = [], isLoading: payoutsLoading } = usePayouts();

  return (
    <div>
      <h1 className="text-[22px] font-bold text-zinc-50 mb-1">Payouts</h1>
      <p className="text-zinc-500 text-[13px] mb-5">
        Channel payouts, fee breakdowns, QBO sync.
      </p>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        {summaryLoading ? (
          <p className="text-zinc-500 text-sm col-span-3">Loading summary…</p>
        ) : summary ? (
          <>
            <SurfaceCard>
              <div className="text-xs text-zinc-500 mb-2">eBay</div>
              <div className="font-mono text-[22px] text-teal-500 font-bold">
                £{summary.pendingByChannel.ebay.estimatedGross.toFixed(2)}
              </div>
              <div className="text-[11px] text-zinc-500 mt-2">
                {summary.pendingByChannel.ebay.orderCount} orders ·{" "}
                {summary.pendingByChannel.ebay.unitCount} units
              </div>
            </SurfaceCard>
            <SurfaceCard>
              <div className="text-xs text-zinc-500 mb-2">Stripe</div>
              <div className="font-mono text-[22px] text-teal-500 font-bold">
                £{summary.pendingByChannel.stripe.estimatedGross.toFixed(2)}
              </div>
              <div className="text-[11px] text-zinc-500 mt-2">
                {summary.pendingByChannel.stripe.orderCount} orders ·{" "}
                {summary.pendingByChannel.stripe.unitCount} units
              </div>
            </SurfaceCard>
            <SurfaceCard>
              <div className="text-xs text-zinc-500 mb-2">Blue Bell Owed</div>
              <div className="font-mono text-[22px] text-teal-500 font-bold">
                £{summary.blueBellCommission.owedSinceLastPayment.toFixed(2)}
              </div>
              <div className="text-[11px] text-zinc-500 mt-2">
                {summary.blueBellCommission.qualifyingOrderCount} qualifying
                orders · Manual
              </div>
              {summary.blueBellCommission.owedSinceLastPayment > 0 && (
                <button
                  onClick={() => toast.info("Record Payment — QBO expense integration coming soon")}
                  className="mt-2.5 w-full py-1.5 bg-[#3F3F46] text-zinc-400 border border-zinc-700/80 rounded text-[11px] cursor-pointer hover:text-zinc-200 transition-colors"
                >
                  Record Payment
                </button>
              )}
            </SurfaceCard>
          </>
        ) : null}
      </div>

      {/* Recent payouts table */}
      <SurfaceCard noPadding className="overflow-hidden">
        <div className="px-4 py-3 border-b border-zinc-700/80">
          <SectionHead>Recent Payouts</SectionHead>
        </div>
        {payoutsLoading ? (
          <p className="text-zinc-500 text-sm p-4">Loading payouts…</p>
        ) : (
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-zinc-700/80">
                {["Date", "Channel", "Gross", "Fees", "Net", "Orders", "Units", "QBO"].map(
                  (h) => (
                    <th
                      key={h}
                      className="px-3 py-2.5 text-left text-zinc-500 font-medium text-[10px] uppercase tracking-wider"
                    >
                      {h}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {payouts.map((p) => (
                <PayoutRow key={p.id} payout={p} onClick={() => setSelectedPayout(p)} />
              ))}
              {payouts.length === 0 && (
                <tr>
                  <td
                    colSpan={8}
                    className="px-3 py-6 text-center text-zinc-500 text-sm"
                  >
                    No payouts recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </SurfaceCard>

      {/* Payout detail slide-out */}
      <Sheet open={!!selectedPayout} onOpenChange={(o) => !o && setSelectedPayout(null)}>
        <SheetContent side="right" className="w-[480px] bg-[#1C1C1E] border-zinc-700/80 p-0 flex flex-col">
          <SheetHeader className="px-5 py-4 border-b border-zinc-700/80">
            <SheetTitle className="text-zinc-50 text-base font-bold">
              Payout Detail
            </SheetTitle>
          </SheetHeader>
          {selectedPayout && (
            <div className="flex-1 overflow-auto p-5 grid gap-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Channel</div>
                  <div className="text-zinc-50 text-sm font-medium">{selectedPayout.channel}</div>
                </div>
                <div>
                  <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Date</div>
                  <div className="text-zinc-50 text-sm">
                    {new Date(selectedPayout.payoutDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Gross</div>
                  <Mono className="text-sm">£{selectedPayout.grossAmount.toFixed(2)}</Mono>
                </div>
                <div>
                  <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Net</div>
                  <Mono color="teal" className="text-sm">£{selectedPayout.netAmount.toFixed(2)}</Mono>
                </div>
                <div>
                  <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Orders</div>
                  <div className="text-zinc-50 text-sm">{selectedPayout.orderCount}</div>
                </div>
                <div>
                  <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Units</div>
                  <div className="text-zinc-50 text-sm">{selectedPayout.unitCount}</div>
                </div>
              </div>

              <div>
                <SectionHead>Fee Breakdown</SectionHead>
                <div className="grid gap-1.5">
                  {[
                    { label: "Final Value Fee", amount: selectedPayout.feeBreakdown.fvf },
                    { label: "Promoted Listings", amount: selectedPayout.feeBreakdown.promoted_listings },
                    { label: "International", amount: selectedPayout.feeBreakdown.international },
                    { label: "Processing", amount: selectedPayout.feeBreakdown.processing },
                  ].map((fee) => (
                    <div key={fee.label} className="flex justify-between py-1 border-b border-zinc-700/80">
                      <span className="text-zinc-400 text-xs">{fee.label}</span>
                      <Mono color="red" className="text-xs">£{fee.amount.toFixed(2)}</Mono>
                    </div>
                  ))}
                  <div className="flex justify-between py-1 font-semibold">
                    <span className="text-zinc-300 text-xs">Total Fees</span>
                    <Mono color="red" className="text-xs">£{selectedPayout.totalFees.toFixed(2)}</Mono>
                  </div>
                </div>
              </div>

              {selectedPayout.externalPayoutId && (
                <div>
                  <div className="text-[10px] text-zinc-500 uppercase tracking-wider">External ID</div>
                  <Mono color="dim" className="text-xs">{selectedPayout.externalPayoutId}</Mono>
                </div>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function PayoutRow({ payout, onClick }: { payout: Payout; onClick: () => void }) {
  const formattedDate = new Date(payout.payoutDate).toLocaleDateString(
    "en-GB",
    { day: "numeric", month: "short" }
  );

  const qboColor =
    payout.qboSyncStatus === "synced"
      ? "#22C55E"
      : payout.qboSyncStatus === "error"
      ? "#EF4444"
      : "#F59E0B";
  const qboLabel =
    payout.qboSyncStatus === "synced"
      ? "Synced"
      : payout.qboSyncStatus === "error"
      ? "Error"
      : "Pending";

  return (
    <tr onClick={onClick} className="border-b border-zinc-700/80 cursor-pointer hover:bg-[#35353A] transition-colors">
      <td className="px-3 py-2.5 text-zinc-400">{formattedDate}</td>
      <td className="px-3 py-2.5 text-zinc-50">{payout.channel}</td>
      <td className="px-3 py-2.5">
        <Mono>£{payout.grossAmount.toFixed(2)}</Mono>
      </td>
      <td className="px-3 py-2.5">
        <Mono color="red">£{payout.totalFees.toFixed(2)}</Mono>
      </td>
      <td className="px-3 py-2.5">
        <Mono color="teal">£{payout.netAmount.toFixed(2)}</Mono>
      </td>
      <td className="px-3 py-2.5 text-zinc-400 text-center">
        {payout.orderCount}
      </td>
      <td className="px-3 py-2.5 text-zinc-400 text-center">
        {payout.unitCount}
      </td>
      <td className="px-3 py-2.5">
        <Badge label={qboLabel} color={qboColor} small />
      </td>
    </tr>
  );
}
