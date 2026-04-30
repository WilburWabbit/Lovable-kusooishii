import { Link } from "react-router-dom";
import { AlertTriangle, Check, Clock, Download, FileText, Play, RefreshCcw, X } from "lucide-react";
import { toast } from "sonner";
import {
  useBlueBellOpenAccruals,
  useBlueBellStatement,
  useCancelPostingIntent,
  useCreateBlueBellSettlement,
  useCancelListingCommand,
  useListingCommands,
  useOperationsExport,
  usePostingIntents,
  useRefreshActualSettlements,
  useRefreshReconciliationCases,
  useReconciliationInbox,
  useResolveReconciliationCase,
  useRunListingCommandNow,
  useRetryPostingIntent,
  useRetryListingCommand,
  useRunPostingIntentNow,
  useRunListingCommandProcessor,
  useRunPostingIntentProcessor,
  useSettlementPeriodClose,
  useUpdateReconciliationCaseStatus,
  type BlueBellStatementRow,
  type ListingCommandRow,
  type PostingIntentRow,
  type ReconciliationInboxCase,
  type SettlementPeriodCloseRow,
} from "@/hooks/admin/use-operations";
import { Badge, Mono, SectionHead, SummaryCard, SurfaceCard } from "./ui-primitives";

const severityColors: Record<string, string> = {
  critical: "#DC2626",
  high: "#EA580C",
  medium: "#D97706",
  low: "#71717A",
};

const statusColors: Record<string, string> = {
  pending: "#D97706",
  processing: "#2563EB",
  sent: "#2563EB",
  acknowledged: "#16A34A",
  posted: "#16A34A",
  failed: "#DC2626",
  skipped: "#71717A",
  cancelled: "#71717A",
  open: "#D97706",
  in_progress: "#2563EB",
  resolved: "#16A34A",
  ignored: "#71717A",
  blocked: "#DC2626",
  review: "#D97706",
  ready: "#16A34A",
};

function formatMoney(value: number | null): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(value);
}

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function shortId(value: string | null): string {
  return value ? value.slice(0, 8) : "—";
}

function humanizeToken(value: string): string {
  return value.replace(/_/g, " ");
}

function evidenceSummary(evidence: Record<string, unknown>): string {
  const entries = Object.entries(evidence).filter(([, value]) => value != null && value !== "");
  if (entries.length === 0) return "No structured evidence was recorded for this case.";
  return entries
    .slice(0, 4)
    .map(([key, value]) => `${humanizeToken(key)}: ${typeof value === "object" ? JSON.stringify(value) : String(value)}`)
    .join(" · ");
}

function reconciliationTarget(caseRow: ReconciliationInboxCase) {
  if (caseRow.orderNumber) {
    return <Link to={`/admin/orders/${caseRow.salesOrderId}`} className="text-amber-600 hover:text-amber-500">{caseRow.orderNumber}</Link>;
  }
  if (caseRow.payoutId) {
    return <Link to={`/admin/payouts/${caseRow.payoutId}`} className="text-amber-600 hover:text-amber-500">Payout {shortId(caseRow.payoutId)}</Link>;
  }
  return <Mono color="dim">{shortId(caseRow.relatedEntityId)}</Mono>;
}

function PostingIntentTarget({ intent }: { intent: PostingIntentRow }) {
  if (intent.entityType === "sales_order" && intent.entityId) {
    return <Link to={`/admin/orders/${intent.entityId}`} className="text-amber-600 hover:text-amber-500">{shortId(intent.entityId)}</Link>;
  }
  return <Mono color="dim">{shortId(intent.entityId)}</Mono>;
}

function ListingCommandTarget({ command }: { command: ListingCommandRow }) {
  if (command.entityType === "channel_listing" && command.entityId) {
    return <Mono color="dim">{shortId(command.entityId)}</Mono>;
  }
  return <Mono color="dim">{shortId(command.entityId)}</Mono>;
}

function BlueBellStatementActions({ row, canCreate }: { row: BlueBellStatementRow; canCreate: boolean }) {
  const createSettlement = useCreateBlueBellSettlement();

  const handleCreateSettlement = () => {
    createSettlement.mutate(
      { periodStart: row.periodStart, periodEnd: row.periodEnd },
      {
        onSuccess: (settlementId) => toast.success(`Blue Bell settlement created: ${shortId(settlementId)}`),
        onError: (err) => toast.error(err instanceof Error ? err.message : "Blue Bell settlement failed"),
      },
    );
  };

  return (
    <button
      type="button"
      onClick={handleCreateSettlement}
      disabled={createSettlement.isPending || !canCreate}
      className="inline-flex items-center justify-center gap-1.5 rounded-md border border-zinc-200 px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
    >
      <FileText className="h-3.5 w-3.5" />
      {createSettlement.isPending ? "Creating..." : "Create Settlement"}
    </button>
  );
}

function ExportButton({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center justify-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
    >
      <Download className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

function CaseDiagnosis({ caseRow }: { caseRow: ReconciliationInboxCase }) {
  return (
    <div className="max-w-[420px] space-y-2 text-xs">
      <div>
        <div className="font-semibold text-zinc-700">Likely cause</div>
        <div className="text-zinc-600">{caseRow.diagnosis ?? caseRow.suspectedRootCause ?? "No diagnosis recorded yet."}</div>
      </div>
      <div>
        <div className="font-semibold text-zinc-700">Fix next</div>
        <div className="text-zinc-600">{caseRow.nextStep ?? caseRow.recommendedAction ?? "Review the related records, then resolve with a note."}</div>
      </div>
      <div className="rounded-md bg-zinc-50 px-2 py-1.5 text-[11px] text-zinc-500">
        {evidenceSummary(caseRow.evidence)}
      </div>
    </div>
  );
}

function ReconciliationSmartActions({
  caseRow,
  onAction,
  disabled,
}: {
  caseRow: ReconciliationInboxCase;
  onAction: (id: string, resolution: string) => void;
  disabled: boolean;
}) {
  const actions: Array<{ label: string; resolution: string; title: string }> = [];

  if (caseRow.caseType === "unmatched_payout_fee") {
    actions.push({
      label: "Link",
      resolution: "link_payout_fee_by_external_order",
      title: "Match this fee to a sales order by external order ID",
    });
  }
  if (caseRow.caseType === "missing_payout" || caseRow.caseType === "amount_mismatch" || caseRow.caseType === "duplicate_candidate") {
    actions.push({
      label: "Refresh",
      resolution: "refresh_settlement",
      title: "Refresh expected and actual settlement evidence",
    });
  }
  if (caseRow.caseType === "qbo_posting_gap" && caseRow.salesOrderId) {
    actions.push({
      label: "Queue QBO",
      resolution: "queue_qbo_order_posting",
      title: "Queue QBO posting for this order",
    });
  }
  if (actions.length === 0) return null;

  return (
    <>
      {actions.map((action) => (
        <button
          key={action.resolution}
          type="button"
          onClick={() => onAction(caseRow.id, action.resolution)}
          disabled={disabled}
          className="inline-flex h-8 items-center justify-center rounded-md border border-amber-200 px-2 text-[11px] font-medium text-amber-700 hover:bg-amber-50 disabled:opacity-50"
          title={action.title}
        >
          {action.label}
        </button>
      ))}
    </>
  );
}

function SettlementPeriodStatus({ row }: { row: SettlementPeriodCloseRow }) {
  return <Badge label={row.closeStatus} color={statusColors[row.closeStatus] ?? "#71717A"} small />;
}

export function OperationsView() {
  const { data: cases = [], isLoading: casesLoading } = useReconciliationInbox();
  const { data: intents = [], isLoading: intentsLoading } = usePostingIntents();
  const { data: listingCommands = [], isLoading: listingCommandsLoading } = useListingCommands();
  const { data: settlementPeriods = [], isLoading: settlementPeriodsLoading } = useSettlementPeriodClose();
  const { data: blueBellStatement = [], isLoading: blueBellStatementLoading } = useBlueBellStatement();
  const { data: blueBellAccruals = [], isLoading: blueBellAccrualsLoading } = useBlueBellOpenAccruals();
  const updateCase = useUpdateReconciliationCaseStatus();
  const resolveCase = useResolveReconciliationCase();
  const refreshActualSettlements = useRefreshActualSettlements();
  const runProcessor = useRunPostingIntentProcessor();
  const runPostingIntentNow = useRunPostingIntentNow();
  const runListingProcessor = useRunListingCommandProcessor();
  const runListingCommandNow = useRunListingCommandNow();
  const refreshReconciliation = useRefreshReconciliationCases();
  const retryListingCommand = useRetryListingCommand();
  const cancelListingCommand = useCancelListingCommand();
  const retryPostingIntent = useRetryPostingIntent();
  const cancelPostingIntent = useCancelPostingIntent();
  const exportReport = useOperationsExport();

  const openCases = cases.length;
  const criticalCases = cases.filter((c) => c.severity === "critical" || c.severity === "high").length;
  const pendingIntents = intents.filter((i) => i.status === "pending").length;
  const failedIntents = intents.filter((i) => i.status === "failed").length;
  const pendingListingCommands = listingCommands.filter((c) => c.status === "pending").length;
  const failedListingCommands = listingCommands.filter((c) => c.status === "failed").length;
  const blueBellOutstanding = blueBellStatement.reduce((sum, row) => sum + row.commissionOutstanding, 0);
  const blockedPeriods = settlementPeriods.filter((row) => row.closeStatus === "blocked").length;
  const settlementVariance = settlementPeriods.slice(0, 3).reduce((sum, row) => sum + row.varianceAmount, 0);
  const unsettledBlueBellPeriods = new Set(
    blueBellAccruals
      .filter((accrual) => accrual.status === "open" && !accrual.settlementId)
      .map((accrual) => accrual.createdAt.slice(0, 7)),
  );

  const handleCaseStatus = (id: string, status: "resolved" | "ignored" | "in_progress") => {
    updateCase.mutate(
      { id, status },
      {
        onSuccess: () => toast.success(status === "in_progress" ? "Case marked in progress" : `Case ${status}`),
        onError: (err) => toast.error(err instanceof Error ? err.message : "Case update failed"),
      },
    );
  };

  const handleSmartCaseAction = (id: string, resolution: string) => {
    resolveCase.mutate(
      { id, resolution, note: "Run from Operations dashboard" },
      {
        onSuccess: () => toast.success("Reconciliation action completed"),
        onError: (err) => toast.error(err instanceof Error ? err.message : "Reconciliation action failed"),
      },
    );
  };

  const handleRunProcessor = () => {
    runProcessor.mutate(undefined, {
      onSuccess: (data) => toast.success(`Processed ${data?.processed ?? 0} posting intent(s)`),
      onError: (err) => toast.error(err instanceof Error ? err.message : "Posting processor failed"),
    });
  };

  const handleRunListingProcessor = () => {
    runListingProcessor.mutate(undefined, {
      onSuccess: (data) => toast.success(`Processed ${data?.processed ?? 0} listing command(s)`),
      onError: (err) => toast.error(err instanceof Error ? err.message : "Listing command processor failed"),
    });
  };

  const handleRunListingCommandNow = (id: string) => {
    runListingCommandNow.mutate(id, {
      onSuccess: (data) => toast.success(`Processed ${data?.processed ?? 0} listing command(s)`),
      onError: (err) => toast.error(err instanceof Error ? err.message : "Listing command processor failed"),
    });
  };

  const handleRunPostingIntentNow = (id: string) => {
    runPostingIntentNow.mutate(id, {
      onSuccess: (data) => toast.success(`Processed ${data?.processed ?? 0} posting intent(s)`),
      onError: (err) => toast.error(err instanceof Error ? err.message : "Posting processor failed"),
    });
  };

  const handleRetryListingCommand = (id: string) => {
    retryListingCommand.mutate(id, {
      onSuccess: () => toast.success("Listing command queued for retry"),
      onError: (err) => toast.error(err instanceof Error ? err.message : "Listing command retry failed"),
    });
  };

  const handleCancelListingCommand = (id: string) => {
    cancelListingCommand.mutate(id, {
      onSuccess: () => toast.success("Listing command cancelled"),
      onError: (err) => toast.error(err instanceof Error ? err.message : "Listing command cancel failed"),
    });
  };

  const handleRetryPostingIntent = (id: string) => {
    retryPostingIntent.mutate(id, {
      onSuccess: () => toast.success("QBO posting intent queued for retry"),
      onError: (err) => toast.error(err instanceof Error ? err.message : "QBO posting retry failed"),
    });
  };

  const handleCancelPostingIntent = (id: string) => {
    cancelPostingIntent.mutate(id, {
      onSuccess: () => toast.success("QBO posting intent cancelled"),
      onError: (err) => toast.error(err instanceof Error ? err.message : "QBO posting cancel failed"),
    });
  };

  const handleRefreshReconciliation = () => {
    refreshReconciliation.mutate(undefined, {
      onSuccess: (count) => toast.success(`Created ${count} reconciliation case(s)`),
      onError: (err) => toast.error(err instanceof Error ? err.message : "Reconciliation refresh failed"),
    });
  };

  const handleRefreshActualSettlements = () => {
    refreshActualSettlements.mutate(undefined, {
      onSuccess: (count) => toast.success(`Refreshed ${count} actual settlement line(s)`),
      onError: (err) => toast.error(err instanceof Error ? err.message : "Actual settlement refresh failed"),
    });
  };

  const handleExport = (
    kind: "settlement-close" | "blue-bell-statement" | "reconciliation-cases" | "margin-profit",
    label: string,
  ) => {
    exportReport.mutate(kind, {
      onSuccess: (count) => toast.success(`${label} exported (${count} row${count === 1 ? "" : "s"})`),
      onError: (err) => toast.error(err instanceof Error ? err.message : `${label} export failed`),
    });
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-[22px] font-bold text-zinc-900">Operations</h1>
          <p className="text-xs text-zinc-500">Listing commands, finance exceptions, settlement mismatches, and QBO posting outbox health.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ExportButton
            label="Profit CSV"
            onClick={() => handleExport("margin-profit", "Margin/profit report")}
            disabled={exportReport.isPending}
          />
          <ExportButton
            label="Cases CSV"
            onClick={() => handleExport("reconciliation-cases", "Reconciliation cases")}
            disabled={exportReport.isPending}
          />
          <button
            type="button"
            onClick={handleRefreshReconciliation}
            disabled={refreshReconciliation.isPending}
            className="inline-flex items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-3 py-2 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 disabled:opacity-50"
          >
            <RefreshCcw className="h-3.5 w-3.5" />
            {refreshReconciliation.isPending ? "Refreshing..." : "Refresh Cases"}
          </button>
          <button
            type="button"
            onClick={handleRefreshActualSettlements}
            disabled={refreshActualSettlements.isPending}
            className="inline-flex items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-3 py-2 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 disabled:opacity-50"
          >
            <RefreshCcw className="h-3.5 w-3.5" />
            {refreshActualSettlements.isPending ? "Refreshing..." : "Refresh Settlements"}
          </button>
          <button
            type="button"
            onClick={handleRunListingProcessor}
            disabled={runListingProcessor.isPending}
            className="inline-flex items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-3 py-2 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 disabled:opacity-50"
          >
            <Play className="h-3.5 w-3.5" />
            {runListingProcessor.isPending ? "Running..." : "Run Listing Outbox"}
          </button>
          <button
            type="button"
            onClick={handleRunProcessor}
            disabled={runProcessor.isPending}
            className="inline-flex items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-3 py-2 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 disabled:opacity-50"
          >
            <Play className="h-3.5 w-3.5" />
            {runProcessor.isPending ? "Running..." : "Run QBO Outbox"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-9">
        <SummaryCard label="Open Cases" value={openCases} color={openCases > 0 ? "#D97706" : "#16A34A"} />
        <SummaryCard label="High Severity" value={criticalCases} color={criticalCases > 0 ? "#DC2626" : "#16A34A"} />
        <SummaryCard label="Blocked Periods" value={blockedPeriods} color={blockedPeriods > 0 ? "#DC2626" : "#16A34A"} />
        <SummaryCard label="3mo Variance" value={formatMoney(settlementVariance)} color={Math.abs(settlementVariance) > 0.05 ? "#D97706" : "#16A34A"} />
        <SummaryCard label="Pending Listings" value={pendingListingCommands} color={pendingListingCommands > 0 ? "#D97706" : "#16A34A"} />
        <SummaryCard label="Failed Listings" value={failedListingCommands} color={failedListingCommands > 0 ? "#DC2626" : "#16A34A"} />
        <SummaryCard label="Pending QBO Posts" value={pendingIntents} color={pendingIntents > 0 ? "#D97706" : "#16A34A"} />
        <SummaryCard label="Failed QBO Posts" value={failedIntents} color={failedIntents > 0 ? "#DC2626" : "#16A34A"} />
        <SummaryCard label="Blue Bell Owed" value={formatMoney(blueBellOutstanding)} color={blueBellOutstanding > 0 ? "#D97706" : "#16A34A"} />
      </div>

      <SurfaceCard noPadding>
        <div className="flex flex-col gap-2 border-b border-zinc-200 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <SectionHead>Settlement Period Close</SectionHead>
            <p className="text-xs text-zinc-500">Monthly close readiness from expected settlement, actual payout evidence, variance, and open cases.</p>
          </div>
          <ExportButton
            label="Export Close"
            onClick={() => handleExport("settlement-close", "Settlement close")}
            disabled={exportReport.isPending}
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-[11px] uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 font-semibold">Period</th>
                <th className="px-3 py-2 text-right font-semibold">Orders</th>
                <th className="px-3 py-2 text-right font-semibold">Expected</th>
                <th className="px-3 py-2 text-right font-semibold">Actual</th>
                <th className="px-3 py-2 text-right font-semibold">Variance</th>
                <th className="px-3 py-2 text-right font-semibold">Payouts</th>
                <th className="px-3 py-2 text-right font-semibold">Open Cases</th>
                <th className="px-4 py-2 text-right font-semibold">Mismatch / Missing</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {settlementPeriodsLoading ? (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-zinc-500">Loading settlement close periods...</td></tr>
              ) : settlementPeriods.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-zinc-500">No settlement period data yet.</td></tr>
              ) : (
                settlementPeriods.map((row) => (
                  <tr key={row.periodStart} className="hover:bg-zinc-50/70">
                    <td className="px-4 py-3"><SettlementPeriodStatus row={row} /></td>
                    <td className="px-3 py-3 text-xs text-zinc-700">{formatDate(row.periodStart)} - {formatDate(row.periodEnd)}</td>
                    <td className="px-3 py-3 text-right"><Mono>{row.orderCount}</Mono></td>
                    <td className="px-3 py-3 text-right"><Mono>{formatMoney(row.expectedTotal)}</Mono></td>
                    <td className="px-3 py-3 text-right"><Mono>{formatMoney(row.actualTotal)}</Mono></td>
                    <td className="px-3 py-3 text-right"><Mono color={Math.abs(row.varianceAmount) > 0.05 ? "amber" : "green"}>{formatMoney(row.varianceAmount)}</Mono></td>
                    <td className="px-3 py-3 text-right">
                      <div><Mono>{row.payoutCount}</Mono></div>
                      {row.unreconciledPayoutCount > 0 && <div className="text-[11px] text-red-600">{row.unreconciledPayoutCount} unreconciled</div>}
                    </td>
                    <td className="px-3 py-3 text-right"><Mono color={row.openCaseCount > 0 ? "red" : "green"}>{row.openCaseCount}</Mono></td>
                    <td className="px-4 py-3 text-right text-[11px] text-zinc-500">
                      {row.amountMismatchCaseCount} mismatch / {row.missingPayoutCaseCount} missing
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </SurfaceCard>

      <SurfaceCard noPadding>
        <div className="border-b border-zinc-200 px-4 py-3">
          <SectionHead>Listing Command Outbox</SectionHead>
          <p className="text-xs text-zinc-500">Publish, reprice, pause, and end commands queued by listing workflows.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-[11px] uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 font-semibold">Target</th>
                <th className="px-3 py-2 font-semibold">Command</th>
                <th className="px-3 py-2 font-semibold">Listing</th>
                <th className="px-3 py-2 font-semibold">Retries</th>
                <th className="px-3 py-2 font-semibold">Next Attempt</th>
                <th className="px-4 py-2 font-semibold">Last Error</th>
                <th className="px-4 py-2 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {listingCommandsLoading ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-zinc-500">Loading listing commands...</td></tr>
              ) : listingCommands.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-zinc-500">No listing commands yet.</td></tr>
              ) : (
                listingCommands.map((command) => (
                  <tr key={command.id} className="align-top hover:bg-zinc-50/70">
                    <td className="px-4 py-3"><Badge label={command.status} color={statusColors[command.status] ?? "#71717A"} small /></td>
                    <td className="px-3 py-3 text-xs text-zinc-700">{command.targetSystem}</td>
                    <td className="px-3 py-3 text-xs text-zinc-700">{humanizeToken(command.commandType)}</td>
                    <td className="px-3 py-3 text-xs"><ListingCommandTarget command={command} /></td>
                    <td className="px-3 py-3"><Mono color={command.retryCount > 0 ? "amber" : "dim"}>{command.retryCount}</Mono></td>
                    <td className="px-3 py-3 text-xs text-zinc-500">{formatDateTime(command.nextAttemptAt)}</td>
                    <td className="max-w-[360px] px-4 py-3 text-xs text-red-600">{command.lastError ?? "—"}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleRunListingCommandNow(command.id)}
                          disabled={runListingCommandNow.isPending || command.status !== "pending"}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-zinc-200 text-zinc-600 hover:bg-zinc-50 disabled:opacity-50"
                          title="Run command now"
                          aria-label="Run command now"
                        >
                          <Play className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRetryListingCommand(command.id)}
                          disabled={retryListingCommand.isPending || command.status === "processing" || command.status === "acknowledged" || command.status === "sent"}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-zinc-200 text-zinc-600 hover:bg-zinc-50 disabled:opacity-50"
                          title="Retry command"
                          aria-label="Retry command"
                        >
                          <RefreshCcw className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleCancelListingCommand(command.id)}
                          disabled={cancelListingCommand.isPending || command.status === "processing" || command.status === "acknowledged" || command.status === "sent"}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-zinc-200 text-zinc-600 hover:bg-zinc-50 disabled:opacity-50"
                          title="Cancel command"
                          aria-label="Cancel command"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </SurfaceCard>

      <SurfaceCard noPadding>
        <div className="flex flex-col gap-2 border-b border-zinc-200 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <SectionHead>Blue Bell Statement</SectionHead>
            <p className="text-xs text-zinc-500">Monthly commission accruals from the sales-program ledger.</p>
          </div>
          <ExportButton
            label="Export Statement"
            onClick={() => handleExport("blue-bell-statement", "Blue Bell statement")}
            disabled={exportReport.isPending}
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] text-left text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-[11px] uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-2 font-semibold">Period</th>
                <th className="px-3 py-2 text-right font-semibold">Orders</th>
                <th className="px-3 py-2 text-right font-semibold">Basis</th>
                <th className="px-3 py-2 text-right font-semibold">Discount</th>
                <th className="px-3 py-2 text-right font-semibold">Accrued</th>
                <th className="px-3 py-2 text-right font-semibold">Settled</th>
                <th className="px-3 py-2 text-right font-semibold">Outstanding</th>
                <th className="px-4 py-2 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {blueBellStatementLoading ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-zinc-500">Loading Blue Bell statement...</td></tr>
              ) : blueBellStatement.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-zinc-500">No Blue Bell accruals yet.</td></tr>
              ) : (
                blueBellStatement.map((row) => (
                  <tr key={row.periodStart} className="hover:bg-zinc-50/70">
                    <td className="px-4 py-3 text-xs text-zinc-700">
                      {formatDate(row.periodStart)} - {formatDate(row.periodEnd)}
                    </td>
                    <td className="px-3 py-3 text-right"><Mono>{row.qualifyingOrderCount}</Mono></td>
                    <td className="px-3 py-3 text-right"><Mono>{formatMoney(row.basisAmount)}</Mono></td>
                    <td className="px-3 py-3 text-right"><Mono color="dim">{formatMoney(row.discountAmount)}</Mono></td>
                    <td className="px-3 py-3 text-right"><Mono color="amber">{formatMoney(row.commissionAccrued - row.commissionReversed)}</Mono></td>
                    <td className="px-3 py-3 text-right"><Mono color={row.commissionSettled > 0 ? "green" : "dim"}>{formatMoney(row.commissionSettled)}</Mono></td>
                    <td className="px-3 py-3 text-right"><Mono color={row.commissionOutstanding > 0 ? "red" : "green"}>{formatMoney(row.commissionOutstanding)}</Mono></td>
                    <td className="px-4 py-3 text-right">
                      <BlueBellStatementActions
                        row={row}
                        canCreate={unsettledBlueBellPeriods.has(row.periodStart.slice(0, 7))}
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </SurfaceCard>

      <SurfaceCard noPadding>
        <div className="border-b border-zinc-200 px-4 py-3">
          <SectionHead>Blue Bell Open Accruals</SectionHead>
          <p className="text-xs text-zinc-500">Recent sales-program accruals waiting for settlement or final payment.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-[11px] uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 font-semibold">Order</th>
                <th className="px-3 py-2 text-right font-semibold">Basis</th>
                <th className="px-3 py-2 text-right font-semibold">Discount</th>
                <th className="px-3 py-2 text-right font-semibold">Commission</th>
                <th className="px-3 py-2 font-semibold">Settlement</th>
                <th className="px-4 py-2 font-semibold">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {blueBellAccrualsLoading ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-zinc-500">Loading Blue Bell accruals...</td></tr>
              ) : blueBellAccruals.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-zinc-500">No open Blue Bell accruals.</td></tr>
              ) : (
                blueBellAccruals.map((accrual) => (
                  <tr key={accrual.id} className="hover:bg-zinc-50/70">
                    <td className="px-4 py-3"><Badge label={humanizeToken(accrual.status)} color={statusColors[accrual.status] ?? "#71717A"} small /></td>
                    <td className="px-3 py-3 text-xs">
                      <Link to={`/admin/orders/${accrual.salesOrderId}`} className="text-amber-600 hover:text-amber-500">
                        {accrual.orderNumber ?? shortId(accrual.salesOrderId)}
                      </Link>
                    </td>
                    <td className="px-3 py-3 text-right"><Mono>{formatMoney(accrual.basisAmount)}</Mono></td>
                    <td className="px-3 py-3 text-right"><Mono color="dim">{formatMoney(accrual.discountAmount)}</Mono></td>
                    <td className="px-3 py-3 text-right"><Mono color="amber">{formatMoney(accrual.commissionAmount - accrual.reversedAmount)}</Mono></td>
                    <td className="px-3 py-3"><Mono color={accrual.settlementId ? "green" : "dim"}>{shortId(accrual.settlementId)}</Mono></td>
                    <td className="px-4 py-3 text-xs text-zinc-500">{formatDateTime(accrual.createdAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </SurfaceCard>

      <SurfaceCard noPadding>
        <div className="flex flex-col gap-2 border-b border-zinc-200 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <SectionHead>Reconciliation Inbox</SectionHead>
            <p className="text-xs text-zinc-500">Open settlement, COGS, allocation, programme, and QBO posting exceptions with diagnosis and next action.</p>
          </div>
          <ExportButton
            label="Export Cases"
            onClick={() => handleExport("reconciliation-cases", "Reconciliation cases")}
            disabled={exportReport.isPending}
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-[11px] uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-2 font-semibold">Severity</th>
                <th className="px-3 py-2 font-semibold">Case</th>
                <th className="px-3 py-2 font-semibold">Target</th>
                <th className="px-3 py-2 font-semibold">Variance</th>
                <th className="px-3 py-2 font-semibold">Root Cause</th>
                <th className="px-3 py-2 font-semibold">Created</th>
                <th className="px-4 py-2 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {casesLoading ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-zinc-500">Loading cases...</td></tr>
              ) : cases.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-zinc-500">No open reconciliation cases.</td></tr>
              ) : (
                cases.map((caseRow) => (
                  <tr key={caseRow.id} className="align-top hover:bg-zinc-50/70">
                    <td className="px-4 py-3"><Badge label={caseRow.severity} color={severityColors[caseRow.severity] ?? "#71717A"} small /></td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                        <span className="font-medium text-zinc-900">{humanizeToken(caseRow.caseType)}</span>
                      </div>
                      <Mono color="dim">{shortId(caseRow.id)}</Mono>
                    </td>
                    <td className="px-3 py-3 text-xs">{reconciliationTarget(caseRow)}</td>
                    <td className="px-3 py-3">
                      <div className="text-zinc-900">{formatMoney(caseRow.varianceAmount)}</div>
                      <div className="text-[11px] text-zinc-500">{formatMoney(caseRow.amountExpected)} exp / {formatMoney(caseRow.amountActual)} act</div>
                    </td>
                    <td className="px-3 py-3">
                      <CaseDiagnosis caseRow={caseRow} />
                    </td>
                    <td className="px-3 py-3 text-xs text-zinc-500">{formatDateTime(caseRow.createdAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1.5">
                        <ReconciliationSmartActions
                          caseRow={caseRow}
                          onAction={handleSmartCaseAction}
                          disabled={resolveCase.isPending}
                        />
                        <button
                          type="button"
                          onClick={() => handleCaseStatus(caseRow.id, "in_progress")}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-zinc-200 text-zinc-600 hover:bg-zinc-50"
                          title="Mark in progress"
                        >
                          <Clock className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleCaseStatus(caseRow.id, "resolved")}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-green-200 text-green-700 hover:bg-green-50"
                          title="Resolve"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleCaseStatus(caseRow.id, "ignored")}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-zinc-200 text-zinc-500 hover:bg-zinc-50"
                          title="Ignore"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </SurfaceCard>

      <SurfaceCard noPadding>
        <div className="border-b border-zinc-200 px-4 py-3">
          <SectionHead>QBO Posting Outbox</SectionHead>
          <p className="text-xs text-zinc-500">Recent posting intents queued by order workflows.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-[11px] uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 font-semibold">Action</th>
                <th className="px-3 py-2 font-semibold">Target</th>
                <th className="px-3 py-2 font-semibold">Retries</th>
                <th className="px-3 py-2 font-semibold">Next Attempt</th>
                <th className="px-3 py-2 font-semibold">QBO Ref</th>
                <th className="px-4 py-2 font-semibold">Last Error</th>
                <th className="px-4 py-2 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {intentsLoading ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-zinc-500">Loading posting intents...</td></tr>
              ) : intents.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-zinc-500">No QBO posting intents yet.</td></tr>
              ) : (
                intents.map((intent) => (
                  <tr key={intent.id} className="align-top hover:bg-zinc-50/70">
                    <td className="px-4 py-3"><Badge label={intent.status} color={statusColors[intent.status] ?? "#71717A"} small /></td>
                    <td className="px-3 py-3 text-xs text-zinc-700">{humanizeToken(intent.action)}</td>
                    <td className="px-3 py-3 text-xs"><PostingIntentTarget intent={intent} /></td>
                    <td className="px-3 py-3"><Mono color={intent.retryCount > 0 ? "amber" : "dim"}>{intent.retryCount}</Mono></td>
                    <td className="px-3 py-3 text-xs text-zinc-500">{formatDateTime(intent.nextAttemptAt)}</td>
                    <td className="px-3 py-3"><Mono color={intent.qboReferenceId ? "green" : "dim"}>{intent.qboReferenceId ?? "—"}</Mono></td>
                    <td className="max-w-[360px] px-4 py-3 text-xs text-red-600">{intent.lastError ?? "—"}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleRunPostingIntentNow(intent.id)}
                          disabled={runPostingIntentNow.isPending || intent.status !== "pending"}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-zinc-200 text-zinc-600 hover:bg-zinc-50 disabled:opacity-50"
                          title="Run posting now"
                          aria-label="Run posting now"
                        >
                          <Play className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRetryPostingIntent(intent.id)}
                          disabled={retryPostingIntent.isPending || intent.status === "processing" || intent.status === "posted"}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-zinc-200 text-zinc-600 hover:bg-zinc-50 disabled:opacity-50"
                          title="Retry posting"
                          aria-label="Retry posting"
                        >
                          <RefreshCcw className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleCancelPostingIntent(intent.id)}
                          disabled={cancelPostingIntent.isPending || intent.status === "processing" || intent.status === "posted"}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-zinc-200 text-zinc-600 hover:bg-zinc-50 disabled:opacity-50"
                          title="Cancel posting"
                          aria-label="Cancel posting"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </SurfaceCard>
    </div>
  );
}
