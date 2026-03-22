import { usePayouts, usePayoutSummary } from "@/hooks/admin/use-payouts";
import type { Payout } from "@/lib/types/admin";
import { SurfaceCard, Mono, Badge, SectionHead } from "./ui-primitives";

export function PayoutView() {
  const { data: summary, isLoading: summaryLoading } = usePayoutSummary();
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
                <PayoutRow key={p.id} payout={p} />
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
    </div>
  );
}

function PayoutRow({ payout }: { payout: Payout }) {
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
    <tr className="border-b border-zinc-700/80">
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
