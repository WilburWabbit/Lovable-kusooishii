import type { ElementType, ReactNode } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight, ClipboardList, PackageCheck, Receipt, Truck } from "lucide-react";
import { AdminV2Layout } from "@/components/admin-v2/AdminV2Layout";
import { AdminPageHeader } from "@/components/admin-v2/admin-patterns";
import { Badge, Mono, SurfaceCard } from "@/components/admin-v2/ui-primitives";
import { useBatchUnitSummaries, usePurchaseBatches } from "@/hooks/admin/use-purchase-batches";
import { useOrders } from "@/hooks/admin/use-orders";
import { useListingCommands, useReconciliationInbox } from "@/hooks/admin/use-operations";

function formatDate(value: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function QueueSection({
  title,
  description,
  href,
  icon: Icon,
  count,
  children,
}: {
  title: string;
  description: string;
  href: string;
  icon: ElementType;
  count: number;
  children: ReactNode;
}) {
  return (
    <SurfaceCard noPadding>
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-zinc-100 text-zinc-700">
            <Icon className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-zinc-900">{title}</h2>
              {count > 0 ? <Badge label={String(count)} color="#D97706" small /> : <Badge label="Clear" color="#16A34A" small />}
            </div>
            <p className="mt-1 text-xs text-zinc-500">{description}</p>
          </div>
        </div>
        <Link to={href} className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 hover:text-amber-600">
          Open
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
      <div className="divide-y divide-zinc-100">{children}</div>
    </SurfaceCard>
  );
}

function EmptyQueue() {
  return <div className="px-4 py-6 text-sm text-zinc-500">No work currently requires action.</div>;
}

export default function WorkQueuePage() {
  const { data: batches = [] } = usePurchaseBatches();
  const { data: summaryMap } = useBatchUnitSummaries();
  const { data: orders = [] } = useOrders();
  const { data: cases = [] } = useReconciliationInbox();
  const { data: commands = [] } = useListingCommands();

  const ungradedBatches = batches
    .map((batch) => ({ batch, summary: summaryMap?.get(batch.id) }))
    .filter((row) => (row.summary?.ungradedCount ?? 0) > 0)
    .sort((a, b) => (b.summary?.ungradedCount ?? 0) - (a.summary?.ungradedCount ?? 0));

  const fulfilmentOrders = orders.filter((order) =>
    ["needs_allocation", "awaiting_shipment", "return_pending"].includes(order.status),
  );

  const openCases = cases.filter((item) => ["open", "in_progress", "blocked"].includes(item.status));
  const failedCommands = commands.filter((command) => ["failed", "pending"].includes(command.status));
  const visibleCases = openCases.slice(0, 6);
  const visibleCommands = failedCommands.slice(0, 6);

  return (
    <AdminV2Layout>
      <AdminPageHeader
        title="Work Queue"
        description="Only records with obvious next actions appear here. Use the full ledgers for history and lookup."
      />

      <div className="grid gap-4 xl:grid-cols-2">
        <QueueSection
          title="Grading"
          description="Purchase batches with units still awaiting condition grading."
          href="/admin/purchases"
          icon={PackageCheck}
          count={ungradedBatches.length}
        >
          {ungradedBatches.length === 0 ? (
            <EmptyQueue />
          ) : (
            ungradedBatches.slice(0, 6).map(({ batch, summary }) => (
              <Link key={batch.id} to={`/admin/purchases/${batch.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-zinc-50">
                <div>
                  <div className="text-sm font-medium text-zinc-900">{batch.reference || batch.id.slice(0, 8)}</div>
                  <div className="text-xs text-zinc-500">{batch.supplierName} · {formatDate(batch.purchaseDate)}</div>
                </div>
                <Mono color="amber">{summary?.ungradedCount ?? 0} ungraded</Mono>
              </Link>
            ))
          )}
        </QueueSection>

        <QueueSection
          title="Orders"
          description="Orders needing allocation, dispatch, or return handling."
          href="/admin/orders"
          icon={Truck}
          count={fulfilmentOrders.length}
        >
          {fulfilmentOrders.length === 0 ? (
            <EmptyQueue />
          ) : (
            fulfilmentOrders.slice(0, 6).map((order) => (
              <Link key={order.id} to={`/admin/orders/${order.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-zinc-50">
                <div>
                  <div className="text-sm font-medium text-zinc-900">{order.orderNumber}</div>
                  <div className="text-xs text-zinc-500">{order.customer?.name ?? "Cash Sales"} · {order.lineItems.length} item(s)</div>
                </div>
                <Badge label={order.status.replace(/_/g, " ")} color="#D97706" small />
              </Link>
            ))
          )}
        </QueueSection>

        <QueueSection
          title="Exceptions"
          description="Open reconciliation cases requiring evidence, retry, or operator resolution."
          href="/admin/operations"
          icon={AlertTriangle}
          count={openCases.length}
        >
          {visibleCases.length === 0 ? (
            <EmptyQueue />
          ) : (
            visibleCases.map((item) => (
              <Link key={item.id} to={item.targetRoute ?? "/admin/operations"} className="flex items-center justify-between px-4 py-3 hover:bg-zinc-50">
                <div>
                  <div className="text-sm font-medium text-zinc-900">{item.targetLabel ?? item.caseType.replace(/_/g, " ")}</div>
                  <div className="max-w-lg truncate text-xs text-zinc-500">{item.nextStep ?? item.recommendedAction ?? "Review and resolve"}</div>
                </div>
                <Badge label={item.severity} color={item.severity === "critical" || item.severity === "high" ? "#DC2626" : "#D97706"} small />
              </Link>
            ))
          )}
        </QueueSection>

        <QueueSection
          title="Channel Outbox"
          description="Listing commands waiting to run or needing retry."
          href="/admin/operations"
          icon={ClipboardList}
          count={failedCommands.length}
        >
          {visibleCommands.length === 0 ? (
            <EmptyQueue />
          ) : (
            visibleCommands.map((command) => (
              <Link key={command.id} to="/admin/operations" className="flex items-center justify-between px-4 py-3 hover:bg-zinc-50">
                <div>
                  <div className="text-sm font-medium text-zinc-900">{command.skuCode ?? command.appReference ?? command.id.slice(0, 8)}</div>
                  <div className="text-xs text-zinc-500">{command.targetSystem} · {command.commandType.replace(/_/g, " ")}</div>
                </div>
                <Badge label={command.status} color={command.status === "failed" ? "#DC2626" : "#D97706"} small />
              </Link>
            ))
          )}
        </QueueSection>

        <SurfaceCard className="xl:col-span-2">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold text-zinc-900">Full Records</h2>
              <p className="mt-1 text-xs text-zinc-500">
                Purchases, products, payouts, and customers remain available as full ledgers from their own workspaces.
              </p>
            </div>
            <Link to="/admin/purchases" className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 hover:text-amber-600">
              Purchase ledger
              <Receipt className="h-3.5 w-3.5" />
            </Link>
          </div>
        </SurfaceCard>
      </div>
    </AdminV2Layout>
  );
}
