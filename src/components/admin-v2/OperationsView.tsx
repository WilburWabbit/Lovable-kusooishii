import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Activity, AlertTriangle, Check, Download, ExternalLink, FileText, Play, RefreshCcw, X } from "lucide-react";
import { toast } from "sonner";
import {
  useBlueBellOpenAccruals,
  useBulkUpdateReconciliationCases,
  useCancelPostingIntent,
  useCreateBlueBellSettlement,
  useCancelListingCommand,
  useListingCommands,
  useOperationsExport,
  usePostingIntents,
  useRefreshActualSettlements,
  useRefreshReconciliationCases,
  useReconciliationCaseNotes,
  useReconciliationInbox,
  useResolveReconciliationCase,
  useRetryPostingIntent,
  useRetryListingCommand,
  useRunListingCommandNow,
  useRunPostingIntentNow,
  useRollingSettlementMonitor,
  useOperationsHealth,
  useSubledgerJobRuns,
  useRunSubledgerScheduledJobs,
  useUpdateReconciliationCaseWorkflow,
  useUpdateReconciliationCaseStatus,
  type ListingCommandRow,
  type OperationsExportKind,
  type OperationsHealthRow,
  type PostingIntentRow,
  type ReconciliationInboxCase,
  type RollingSettlementRow,
  type SubledgerJobRunRow,
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
  awaiting_payout: "#D97706",
  settled: "#16A34A",
  ready: "#16A34A",
  warning: "#D97706",
  partially_settled: "#2563EB",
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

function shortId(value: string | null): string {
  return value ? value.slice(0, 8) : "—";
}

function humanizeToken(value: string): string {
  return value.replace(/_/g, " ");
}

function evidenceSummary(evidence: Record<string, unknown>): string {
  const entries = Object.entries(evidence).filter(([, value]) => value != null && value !== "");
  if (entries.length === 0) return "No structured evidence recorded.";
  return entries
    .slice(0, 4)
    .map(([key, value]) => `${humanizeToken(key)}: ${typeof value === "object" ? JSON.stringify(value) : String(value)}`)
    .join(" · ");
}

function promptForEvidence(caseRow: ReconciliationInboxCase, actionLabel: string): string | null {
  const note = window.prompt(
    caseRow.requiresEvidence
      ? `${actionLabel} requires evidence. Add the evidence or resolution note:`
      : `${actionLabel}. Add an optional note:`,
    "",
  );
  if (note === null) return null;
  if (caseRow.requiresEvidence && !note.trim()) {
    toast.error("This finance-sensitive case requires evidence or a resolution note.");
    return null;
  }
  return note.trim();
}

function RecordLink({ route, label }: { route: string | null; label: string | null }) {
  if (!route) return <Mono color="dim">{label ?? "—"}</Mono>;
  return (
    <Link to={route} className="inline-flex items-center gap-1 text-amber-600 hover:text-amber-500">
      {label ?? "Open record"}
      <ExternalLink className="h-3 w-3" />
    </Link>
  );
}

function ReferenceStack({
  app,
  qboDoc,
  qboId,
  external,
}: {
  app?: string | null;
  qboDoc?: string | null;
  qboId?: string | null;
  external?: string | null;
}) {
  return (
    <div className="space-y-0.5 text-[11px] text-zinc-500">
      <div><span className="font-medium text-zinc-700">App</span> <Mono>{app ?? "—"}</Mono></div>
      <div><span className="font-medium text-zinc-700">QBO Doc</span> <Mono>{qboDoc ?? "—"}</Mono></div>
      <div><span className="font-medium text-zinc-700">QBO ID</span> <Mono>{qboId ?? "—"}</Mono></div>
      <div><span className="font-medium text-zinc-700">External</span> <Mono>{external ?? "—"}</Mono></div>
    </div>
  );
}

function ExportButton({
  label,
  kind,
  onExport,
  disabled,
}: {
  label: string;
  kind: OperationsExportKind;
  onExport: (kind: OperationsExportKind, label: string) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => onExport(kind, label)}
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
    <div className="max-w-[440px] space-y-2 text-xs">
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

function CaseNotesPanel({
  caseId,
  onAddNote,
  disabled,
}: {
  caseId: string | null;
  onAddNote: (caseId: string) => void;
  disabled: boolean;
}) {
  const { data: notes = [], isLoading } = useReconciliationCaseNotes(caseId);
  if (!caseId) return null;

  return (
    <SurfaceCard noPadding>
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
        <div>
          <SectionHead>Case Notes</SectionHead>
          <p className="text-xs text-zinc-500">Audit history and operator evidence for {shortId(caseId)}.</p>
        </div>
        <button
          type="button"
          onClick={() => onAddNote(caseId)}
          disabled={disabled}
          className="rounded-md border border-zinc-200 px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
        >
          Add Note
        </button>
      </div>
      <div className="max-h-72 overflow-y-auto divide-y divide-zinc-100">
        {isLoading ? (
          <div className="px-4 py-6 text-sm text-zinc-500">Loading notes...</div>
        ) : notes.length === 0 ? (
          <div className="px-4 py-6 text-sm text-zinc-500">No notes recorded yet.</div>
        ) : (
          notes.map((note) => (
            <div key={note.id} className="px-4 py-3">
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
                <Badge label={humanizeToken(note.noteType)} color={statusColors[note.noteType] ?? "#71717A"} small />
                <span>{note.actorName ?? "System"}</span>
                <span>{formatDateTime(note.createdAt)}</span>
              </div>
              <p className="mt-1 text-sm text-zinc-700">{note.note ?? "Workflow update"}</p>
              {Object.keys(note.evidence).length > 0 && (
                <p className="mt-1 rounded-md bg-zinc-50 px-2 py-1 text-[11px] text-zinc-500">
                  {evidenceSummary(note.evidence)}
                </p>
              )}
            </div>
          ))
        )}
      </div>
    </SurfaceCard>
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
    actions.push({ label: "Link", resolution: "link_payout_fee_by_external_order", title: "Match this fee to a sales order by external order ID" });
  }
  if (caseRow.caseType === "missing_payout" || caseRow.caseType === "amount_mismatch" || caseRow.caseType === "duplicate_candidate") {
    actions.push({ label: "Refresh", resolution: "refresh_settlement", title: "Refresh expected and actual settlement evidence" });
  }
  if (caseRow.caseType === "qbo_posting_gap" && caseRow.salesOrderId) {
    actions.push({ label: "Queue QBO", resolution: "queue_qbo_order_posting", title: "Queue QBO posting for this order" });
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

function HealthStatus({ row }: { row: OperationsHealthRow }) {
  return <Badge label={humanizeToken(row.healthStatus)} color={statusColors[row.healthStatus] ?? "#71717A"} small />;
}

function JobRunStatus({ row }: { row: SubledgerJobRunRow }) {
  const status = row.jobSuccess === false ? "failed" : row.jobSuccess === true ? "ready" : "skipped";
  return <Badge label={row.jobSuccess === false ? "failed" : row.jobSuccess === true ? "success" : "unknown"} color={statusColors[status] ?? "#71717A"} small />;
}

function SettlementStatus({ row }: { row: RollingSettlementRow }) {
  return <Badge label={humanizeToken(row.settlementStatus)} color={statusColors[row.settlementStatus] ?? "#71717A"} small />;
}

function PostingIntentTarget({ intent }: { intent: PostingIntentRow }) {
  if (intent.entityType === "sales_order" && intent.entityId) {
    return <Link to={`/admin/orders/${intent.entityId}`} className="text-amber-600 hover:text-amber-500">{intent.appReference ?? shortId(intent.entityId)}</Link>;
  }
  return <Mono color="dim">{intent.appReference ?? shortId(intent.entityId)}</Mono>;
}

function ListingCommandTarget({ command }: { command: ListingCommandRow }) {
  return <Mono color="dim">{command.appReference ?? shortId(command.entityId)}</Mono>;
}

export function OperationsView() {
  const { data: healthRows = [], isLoading: healthLoading } = useOperationsHealth();
  const { data: jobRuns = [], isLoading: jobRunsLoading } = useSubledgerJobRuns();
  const { data: cases = [], isLoading: casesLoading } = useReconciliationInbox();
  const { data: intents = [], isLoading: intentsLoading } = usePostingIntents();
  const { data: listingCommands = [], isLoading: listingCommandsLoading } = useListingCommands();
  const { data: settlements = [], isLoading: settlementsLoading } = useRollingSettlementMonitor();
  const { data: blueBellAccruals = [], isLoading: blueBellAccrualsLoading } = useBlueBellOpenAccruals();
  const updateCase = useUpdateReconciliationCaseStatus();
  const updateCaseWorkflow = useUpdateReconciliationCaseWorkflow();
  const bulkUpdateCases = useBulkUpdateReconciliationCases();
  const resolveCase = useResolveReconciliationCase();
  const refreshActualSettlements = useRefreshActualSettlements();
  const runScheduledJobs = useRunSubledgerScheduledJobs();
  const runPostingIntentNow = useRunPostingIntentNow();
  const runListingCommandNow = useRunListingCommandNow();
  const refreshReconciliation = useRefreshReconciliationCases();
  const retryListingCommand = useRetryListingCommand();
  const cancelListingCommand = useCancelListingCommand();
  const retryPostingIntent = useRetryPostingIntent();
  const cancelPostingIntent = useCancelPostingIntent();
  const createBlueBellSettlement = useCreateBlueBellSettlement();
  const exportReport = useOperationsExport();
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedCaseIds, setSelectedCaseIds] = useState<string[]>([]);
  const [selectedAccrualIds, setSelectedAccrualIds] = useState<string[]>([]);
  const [activeCaseId, setActiveCaseId] = useState<string | null>(null);

  const blockedHealthAreas = healthRows.filter((row) => row.healthStatus === "blocked").length;
  const warningHealthAreas = healthRows.filter((row) => row.healthStatus === "warning").length;
  const overallHealth = blockedHealthAreas > 0 ? "blocked" : warningHealthAreas > 0 ? "warning" : "ready";
  const openCases = cases.length;
  const criticalCases = cases.filter((c) => c.severity === "critical" || c.severity === "high").length;
  const pendingIntents = intents.filter((i) => i.status === "pending").length;
  const failedIntents = intents.filter((i) => i.status === "failed").length;
  const pendingListingCommands = listingCommands.filter((c) => c.status === "pending").length;
  const failedListingCommands = listingCommands.filter((c) => c.status === "failed").length;
  const withheldPayouts = settlements.filter((row) => row.settlementStatus === "awaiting_payout" || row.settlementStatus === "review").length;
  const rollingVariance = settlements.reduce((sum, row) => sum + row.varianceAmount, 0);
  const blueBellOutstanding = blueBellAccruals.reduce((sum, row) => sum + row.commissionOutstanding, 0);

  const visibleCases = useMemo(
    () => cases.filter((caseRow) => statusFilter === "all" || caseRow.status === statusFilter),
    [cases, statusFilter],
  );
  const selectedCases = visibleCases.filter((caseRow) => selectedCaseIds.includes(caseRow.id));
  const allVisibleSelected = visibleCases.length > 0 && visibleCases.every((caseRow) => selectedCaseIds.includes(caseRow.id));
  const allAccrualsSelected = blueBellAccruals.length > 0 && blueBellAccruals.every((row) => selectedAccrualIds.includes(row.id));

  const handleCaseStatus = (id: string, status: "resolved" | "ignored" | "in_progress") => {
    const caseRow = cases.find((row) => row.id === id);
    const note = caseRow && (status === "resolved" || status === "ignored")
      ? promptForEvidence(caseRow, status === "resolved" ? "Resolve case" : "Ignore case")
      : null;
    if ((status === "resolved" || status === "ignored") && note === null) return;

    updateCase.mutate(
      { id, status, note, evidence: note ? { resolution_note: note } : {} },
      {
        onSuccess: () => toast.success(status === "in_progress" ? "Case marked in progress" : `Case ${status}`),
        onError: (err) => toast.error(err instanceof Error ? err.message : "Case update failed"),
      },
    );
  };

  const handleAddCaseNote = (id: string) => {
    const note = window.prompt("Add a case note or evidence:");
    if (note === null) return;
    if (!note.trim()) {
      toast.error("Note cannot be blank");
      return;
    }

    updateCaseWorkflow.mutate(
      { id, note: note.trim(), evidence: { operator_note: note.trim() } },
      {
        onSuccess: () => toast.success("Case note added"),
        onError: (err) => toast.error(err instanceof Error ? err.message : "Note update failed"),
      },
    );
  };

  const handleToggleCase = (id: string, checked: boolean) => {
    setSelectedCaseIds((current) => checked ? [...new Set([...current, id])] : current.filter((caseId) => caseId !== id));
  };

  const handleToggleAllVisible = (checked: boolean) => {
    setSelectedCaseIds(checked ? visibleCases.map((caseRow) => caseRow.id) : []);
  };

  const handleBulkUpdate = (status: "in_progress" | "resolved" | "ignored", actionLabel: string) => {
    if (selectedCases.length === 0) {
      toast.error("Select at least one case first");
      return;
    }

    const needsEvidence = selectedCases.some((caseRow) => caseRow.requiresEvidence && (status === "resolved" || status === "ignored"));
    const note = window.prompt(`${actionLabel}. Add evidence/note for the selected case(s):`, "");
    if (note === null) return;
    if (needsEvidence && !note.trim()) {
      toast.error("Finance-sensitive cases require evidence or a resolution note.");
      return;
    }

    bulkUpdateCases.mutate(
      {
        ids: selectedCases.map((caseRow) => caseRow.id),
        status,
        note: note.trim() || `${actionLabel} from Operations dashboard`,
        evidence: note.trim() ? { bulk_note: note.trim(), bulk_action: actionLabel } : { bulk_action: actionLabel },
      },
      {
        onSuccess: (result) => {
          setSelectedCaseIds([]);
          toast.success(`Updated ${result.updated ?? selectedCases.length} case(s)`);
        },
        onError: (err) => toast.error(err instanceof Error ? err.message : "Bulk update failed"),
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

  const handleRunScheduledJob = (
    job: "all" | "listing_outbox" | "qbo_posting_outbox" | "settlement_reconciliation",
    successMessage: string,
  ) => {
    runScheduledJobs.mutate(job, {
      onSuccess: (data) => {
        const failed = (data.results ?? []).filter((result) => result.success === false).length;
        if (failed > 0) toast.warning(`Automation finished with ${failed} failed job(s)`);
        else toast.success(successMessage);
      },
      onError: (err) => toast.error(err instanceof Error ? err.message : "Subledger automation failed"),
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

  const handleExport = (kind: OperationsExportKind, label: string) => {
    exportReport.mutate(kind, {
      onSuccess: (count) => toast.success(`${label} exported (${count} row${count === 1 ? "" : "s"})`),
      onError: (err) => toast.error(err instanceof Error ? err.message : `${label} export failed`),
    });
  };

  const handleCreateBlueBellSettlement = () => {
    if (selectedAccrualIds.length === 0) {
      toast.error("Select at least one Blue Bell accrual first");
      return;
    }

    createBlueBellSettlement.mutate(
      { accrualIds: selectedAccrualIds },
      {
        onSuccess: (settlementId) => {
          setSelectedAccrualIds([]);
          toast.success(`Blue Bell settlement created: ${shortId(settlementId)}`);
        },
        onError: (err) => toast.error(err instanceof Error ? err.message : "Blue Bell settlement failed"),
      },
    );
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-[22px] font-bold text-zinc-900">Operations</h1>
          <p className="text-xs text-zinc-500">Rolling reconciliation, withheld payouts, Blue Bell accruals, listing commands, and QBO posting health.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => handleRunScheduledJob("all", "Subledger automation run completed")}
            disabled={runScheduledJobs.isPending}
            className="inline-flex items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-3 py-2 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 disabled:opacity-50"
          >
            <Activity className="h-3.5 w-3.5" />
            {runScheduledJobs.isPending ? "Running..." : "Run All Automation"}
          </button>
          <ExportButton label="Profit CSV" kind="margin-profit" onExport={handleExport} disabled={exportReport.isPending} />
          <ExportButton label="Cases CSV" kind="reconciliation-cases" onExport={handleExport} disabled={exportReport.isPending} />
          <ExportButton label="Settlement CSV" kind="rolling-settlement" onExport={handleExport} disabled={exportReport.isPending} />
          <ExportButton label="Blue Bell CSV" kind="blue-bell-statement" onExport={handleExport} disabled={exportReport.isPending} />
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
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-10">
        <SummaryCard label="Ops Health" value={humanizeToken(overallHealth)} color={statusColors[overallHealth] ?? "#71717A"} />
        <SummaryCard label="Open Cases" value={openCases} color={openCases > 0 ? "#D97706" : "#16A34A"} />
        <SummaryCard label="High Severity" value={criticalCases} color={criticalCases > 0 ? "#DC2626" : "#16A34A"} />
        <SummaryCard label="Withheld Payouts" value={withheldPayouts} color={withheldPayouts > 0 ? "#D97706" : "#16A34A"} />
        <SummaryCard label="Rolling Variance" value={formatMoney(rollingVariance)} color={Math.abs(rollingVariance) > 0.05 ? "#D97706" : "#16A34A"} />
        <SummaryCard label="Pending Listings" value={pendingListingCommands} color={pendingListingCommands > 0 ? "#D97706" : "#16A34A"} />
        <SummaryCard label="Failed Listings" value={failedListingCommands} color={failedListingCommands > 0 ? "#DC2626" : "#16A34A"} />
        <SummaryCard label="Pending QBO Posts" value={pendingIntents} color={pendingIntents > 0 ? "#D97706" : "#16A34A"} />
        <SummaryCard label="Failed QBO Posts" value={failedIntents} color={failedIntents > 0 ? "#DC2626" : "#16A34A"} />
        <SummaryCard label="Blue Bell Owed" value={formatMoney(blueBellOutstanding)} color={blueBellOutstanding > 0 ? "#D97706" : "#16A34A"} />
      </div>

      <SurfaceCard noPadding>
        <div className="flex flex-col gap-2 border-b border-zinc-200 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <SectionHead>Rolling Operations Health</SectionHead>
            <p className="text-xs text-zinc-500">Current blockers and warnings from rolling reconciliation, posting, listing, market, and Blue Bell evidence.</p>
          </div>
          <div className="text-xs text-zinc-500">
            {blockedHealthAreas} blocked / {warningHealthAreas} warning
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] text-left text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-[11px] uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 font-semibold">Area</th>
                <th className="px-3 py-2 text-right font-semibold">Open</th>
                <th className="px-3 py-2 text-right font-semibold">Pending</th>
                <th className="px-3 py-2 text-right font-semibold">Failed</th>
                <th className="px-3 py-2 font-semibold">Last Success</th>
                <th className="px-3 py-2 font-semibold">Oldest Item</th>
                <th className="px-4 py-2 font-semibold">Next Step</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {healthLoading ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-zinc-500">Loading operations health...</td></tr>
              ) : healthRows.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-zinc-500">No operations health data yet. Run the latest migration first.</td></tr>
              ) : (
                healthRows.map((row) => (
                  <tr key={row.area} className="align-top hover:bg-zinc-50/70">
                    <td className="px-4 py-3"><HealthStatus row={row} /></td>
                    <td className="px-3 py-3">
                      <div className="font-medium text-zinc-900">{humanizeToken(row.area)}</div>
                      <div className="text-[11px] text-zinc-500">Severity: {row.severity}</div>
                    </td>
                    <td className="px-3 py-3 text-right"><Mono color={row.openCount > 0 ? "amber" : "dim"}>{row.openCount}</Mono></td>
                    <td className="px-3 py-3 text-right"><Mono color={row.pendingCount > 0 ? "amber" : "dim"}>{row.pendingCount}</Mono></td>
                    <td className="px-3 py-3 text-right"><Mono color={row.failedCount > 0 ? "red" : "dim"}>{row.failedCount}</Mono></td>
                    <td className="px-3 py-3 text-xs text-zinc-500">{formatDateTime(row.lastSuccessAt)}</td>
                    <td className="px-3 py-3 text-xs text-zinc-500">{formatDateTime(row.oldestPendingAt)}</td>
                    <td className="max-w-[360px] px-4 py-3 text-xs text-zinc-600">{row.recommendation}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </SurfaceCard>

      <SurfaceCard noPadding>
        <div className="border-b border-zinc-200 px-4 py-3">
          <SectionHead>Automation Runs</SectionHead>
          <p className="text-xs text-zinc-500">Recent scheduled/admin-triggered subledger automation evidence from the audit log.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-[11px] uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 font-semibold">Job</th>
                <th className="px-3 py-2 font-semibold">Requested</th>
                <th className="px-3 py-2 text-right font-semibold">Rows</th>
                <th className="px-3 py-2 font-semibold">Ran At</th>
                <th className="px-4 py-2 font-semibold">Error</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {jobRunsLoading ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-zinc-500">Loading automation runs...</td></tr>
              ) : jobRuns.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-zinc-500">No scheduled job audit records yet.</td></tr>
              ) : (
                jobRuns.map((row) => (
                  <tr key={`${row.id}-${row.job ?? "run"}`} className="hover:bg-zinc-50/70">
                    <td className="px-4 py-3"><JobRunStatus row={row} /></td>
                    <td className="px-3 py-3 text-xs text-zinc-700">{humanizeToken(row.job ?? "unknown")}</td>
                    <td className="px-3 py-3 text-xs text-zinc-500">{humanizeToken(row.requestedJob ?? "unknown")}</td>
                    <td className="px-3 py-3 text-right"><Mono>{row.rowsProcessed ?? "—"}</Mono></td>
                    <td className="px-3 py-3 text-xs text-zinc-500">{formatDateTime(row.occurredAt)}</td>
                    <td className="max-w-[420px] px-4 py-3 text-xs text-red-600">{row.error ?? "—"}</td>
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
            <SectionHead>Rolling Settlement Monitor</SectionHead>
            <p className="text-xs text-zinc-500">Cash and in-person sales are treated as settled. Only marketplace/processor-held funds remain monitored for payout evidence.</p>
          </div>
          <button
            type="button"
            onClick={() => handleRunScheduledJob("settlement_reconciliation", "Settlement reconciliation completed")}
            disabled={runScheduledJobs.isPending}
            className="inline-flex items-center justify-center gap-1.5 rounded-md border border-zinc-200 px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
          >
            <RefreshCcw className="h-3.5 w-3.5" />
            Reconcile
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1120px] text-left text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-[11px] uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 font-semibold">Order</th>
                <th className="px-3 py-2 font-semibold">Channel</th>
                <th className="px-3 py-2 text-right font-semibold">Expected</th>
                <th className="px-3 py-2 text-right font-semibold">Actual</th>
                <th className="px-3 py-2 text-right font-semibold">Variance</th>
                <th className="px-3 py-2 text-right font-semibold">Cases</th>
                <th className="px-4 py-2 font-semibold">References</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {settlementsLoading ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-zinc-500">Loading rolling settlement monitor...</td></tr>
              ) : settlements.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-zinc-500">No settlement data yet.</td></tr>
              ) : (
                settlements.map((row) => (
                  <tr key={row.salesOrderId} className="align-top hover:bg-zinc-50/70">
                    <td className="px-4 py-3"><SettlementStatus row={row} /></td>
                    <td className="px-3 py-3 text-xs">
                      <Link to={`/admin/orders/${row.salesOrderId}`} className="text-amber-600 hover:text-amber-500">
                        {row.orderNumber ?? shortId(row.salesOrderId)}
                      </Link>
                      <div className="text-[11px] text-zinc-500">{formatDateTime(row.orderCreatedAt)}</div>
                    </td>
                    <td className="px-3 py-3 text-xs text-zinc-700">
                      {humanizeToken(row.originChannel ?? "unknown")}
                      <div className="text-[11px] text-zinc-500">{row.paymentMethod ?? "—"}</div>
                    </td>
                    <td className="px-3 py-3 text-right"><Mono>{formatMoney(row.expectedTotal)}</Mono></td>
                    <td className="px-3 py-3 text-right"><Mono>{formatMoney(row.actualTotal)}</Mono></td>
                    <td className="px-3 py-3 text-right"><Mono color={Math.abs(row.varianceAmount) > 0.05 ? "amber" : "green"}>{formatMoney(row.varianceAmount)}</Mono></td>
                    <td className="px-3 py-3 text-right">
                      <Mono color={row.openCaseCount > 0 ? "red" : "green"}>{row.openCaseCount}</Mono>
                      <div className="text-[11px] text-zinc-500">{row.amountMismatchCaseCount} mismatch / {row.missingPayoutCaseCount} missing</div>
                    </td>
                    <td className="px-4 py-3">
                      <ReferenceStack app={row.appReference ?? row.orderNumber} qboDoc={row.qboDocNumber} qboId={row.qboEntityId} external={row.externalReference ?? row.stripeReference ?? row.ebayReference} />
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
            <SectionHead>Blue Bell Accrual Ledger</SectionHead>
            <p className="text-xs text-zinc-500">Rolling commission accruals. Select accruals to create a settlement record when they are ready.</p>
          </div>
          <button
            type="button"
            onClick={handleCreateBlueBellSettlement}
            disabled={selectedAccrualIds.length === 0 || createBlueBellSettlement.isPending}
            className="inline-flex items-center justify-center gap-1.5 rounded-md border border-zinc-200 px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
          >
            <FileText className="h-3.5 w-3.5" />
            {createBlueBellSettlement.isPending ? "Creating..." : "Create Settlement"}
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1020px] text-left text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-[11px] uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-2 font-semibold">
                  <input
                    type="checkbox"
                    checked={allAccrualsSelected}
                    onChange={(event) => setSelectedAccrualIds(event.target.checked ? blueBellAccruals.map((row) => row.id) : [])}
                    aria-label="Select all Blue Bell accruals"
                  />
                </th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 font-semibold">Order</th>
                <th className="px-3 py-2 text-right font-semibold">Basis</th>
                <th className="px-3 py-2 text-right font-semibold">Discount</th>
                <th className="px-3 py-2 text-right font-semibold">Commission</th>
                <th className="px-3 py-2 font-semibold">Settlement</th>
                <th className="px-4 py-2 font-semibold">References</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {blueBellAccrualsLoading ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-zinc-500">Loading Blue Bell accruals...</td></tr>
              ) : blueBellAccruals.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-zinc-500">No open Blue Bell accruals.</td></tr>
              ) : (
                blueBellAccruals.map((accrual) => (
                  <tr key={accrual.id} className="align-top hover:bg-zinc-50/70">
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selectedAccrualIds.includes(accrual.id)}
                        onChange={(event) => setSelectedAccrualIds((current) => event.target.checked ? [...new Set([...current, accrual.id])] : current.filter((id) => id !== accrual.id))}
                        aria-label={`Select accrual ${shortId(accrual.id)}`}
                      />
                    </td>
                    <td className="px-3 py-3"><Badge label={humanizeToken(accrual.status)} color={statusColors[accrual.status] ?? "#71717A"} small /></td>
                    <td className="px-3 py-3 text-xs">
                      <Link to={`/admin/orders/${accrual.salesOrderId}`} className="text-amber-600 hover:text-amber-500">
                        {accrual.orderNumber ?? shortId(accrual.salesOrderId)}
                      </Link>
                      <div className="text-[11px] text-zinc-500">{formatDateTime(accrual.orderCreatedAt)}</div>
                    </td>
                    <td className="px-3 py-3 text-right"><Mono>{formatMoney(accrual.basisAmount)}</Mono></td>
                    <td className="px-3 py-3 text-right"><Mono color="dim">{formatMoney(accrual.discountAmount)}</Mono></td>
                    <td className="px-3 py-3 text-right"><Mono color="amber">{formatMoney(accrual.commissionOutstanding)}</Mono></td>
                    <td className="px-3 py-3"><Mono color={accrual.settlementId ? "green" : "dim"}>{shortId(accrual.settlementId)}</Mono></td>
                    <td className="px-4 py-3">
                      <ReferenceStack app={accrual.orderNumber} qboDoc={accrual.qboDocNumber} qboId={accrual.qboExpenseId} external={accrual.externalReference ?? accrual.qboPaymentReference} />
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
            <SectionHead>Reconciliation Inbox</SectionHead>
            <p className="text-xs text-zinc-500">Open settlement, COGS, allocation, listing, QBO posting, and QBO refresh exceptions.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="h-8 rounded-md border border-zinc-200 bg-white px-2 text-xs text-zinc-700"
              aria-label="Filter by status"
            >
              <option value="all">All open</option>
              <option value="open">Open</option>
              <option value="in_progress">In progress</option>
            </select>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-b border-zinc-100 bg-zinc-50 px-4 py-2">
          <span className="text-xs font-medium text-zinc-600">{selectedCases.length} selected</span>
          <button
            type="button"
            onClick={() => handleBulkUpdate("in_progress", "Mark selected cases in progress")}
            disabled={selectedCases.length === 0 || bulkUpdateCases.isPending}
            className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
          >
            Bulk In Progress
          </button>
          <button
            type="button"
            onClick={() => handleBulkUpdate("resolved", "Resolve selected cases")}
            disabled={selectedCases.length === 0 || bulkUpdateCases.isPending}
            className="rounded-md border border-green-200 bg-white px-2 py-1 text-xs text-green-700 hover:bg-green-50 disabled:opacity-50"
          >
            Resolve Selected
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1280px] text-left text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-[11px] uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-2 font-semibold">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={(event) => handleToggleAllVisible(event.target.checked)}
                    aria-label="Select all visible cases"
                  />
                </th>
                <th className="px-4 py-2 font-semibold">Severity</th>
                <th className="px-3 py-2 font-semibold">Case</th>
                <th className="px-3 py-2 font-semibold">Record</th>
                <th className="px-3 py-2 font-semibold">References</th>
                <th className="px-3 py-2 font-semibold">Variance</th>
                <th className="px-3 py-2 font-semibold">Root Cause</th>
                <th className="px-3 py-2 font-semibold">Created</th>
                <th className="px-4 py-2 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {casesLoading ? (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-zinc-500">Loading cases...</td></tr>
              ) : visibleCases.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-zinc-500">No reconciliation cases match the current filter.</td></tr>
              ) : (
                visibleCases.map((caseRow) => (
                  <tr key={caseRow.id} className="align-top hover:bg-zinc-50/70">
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selectedCaseIds.includes(caseRow.id)}
                        onChange={(event) => handleToggleCase(caseRow.id, event.target.checked)}
                        aria-label={`Select case ${shortId(caseRow.id)}`}
                      />
                    </td>
                    <td className="px-4 py-3"><Badge label={caseRow.severity} color={severityColors[caseRow.severity] ?? "#71717A"} small /></td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                        <span className="font-medium text-zinc-900">{humanizeToken(caseRow.caseType)}</span>
                      </div>
                      <Mono color="dim">{shortId(caseRow.id)}</Mono>
                    </td>
                    <td className="px-3 py-3 text-xs"><RecordLink route={caseRow.targetRoute} label={caseRow.targetLabel ?? caseRow.orderNumber} /></td>
                    <td className="px-3 py-3">
                      <ReferenceStack app={caseRow.appReference ?? caseRow.orderNumber} qboDoc={caseRow.qboDocNumber} qboId={caseRow.qboEntityId} external={caseRow.externalReference ?? caseRow.stripeReference ?? caseRow.ebayReference} />
                    </td>
                    <td className="px-3 py-3">
                      <div className="text-zinc-900">{formatMoney(caseRow.varianceAmount)}</div>
                      <div className="text-[11px] text-zinc-500">{formatMoney(caseRow.amountExpected)} exp / {formatMoney(caseRow.amountActual)} act</div>
                    </td>
                    <td className="px-3 py-3"><CaseDiagnosis caseRow={caseRow} /></td>
                    <td className="px-3 py-3 text-xs text-zinc-500">
                      {formatDateTime(caseRow.createdAt)}
                      {caseRow.latestNote && (
                        <div className="mt-1 max-w-[180px] truncate text-[11px] text-zinc-500" title={caseRow.latestNote}>
                          {caseRow.noteCount} note{caseRow.noteCount === 1 ? "" : "s"} · {caseRow.latestNote}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1.5">
                        <ReconciliationSmartActions caseRow={caseRow} onAction={handleSmartCaseAction} disabled={resolveCase.isPending} />
                        <button
                          type="button"
                          onClick={() => setActiveCaseId(activeCaseId === caseRow.id ? null : caseRow.id)}
                          className="inline-flex h-8 items-center justify-center rounded-md border border-zinc-200 px-2 text-[11px] font-medium text-zinc-600 hover:bg-zinc-50"
                          title="View notes"
                        >
                          Notes
                        </button>
                        <button
                          type="button"
                          onClick={() => handleCaseStatus(caseRow.id, "in_progress")}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-zinc-200 text-zinc-600 hover:bg-zinc-50"
                          title="Mark in progress"
                        >
                          <Activity className="h-3.5 w-3.5" />
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

      <CaseNotesPanel caseId={activeCaseId} onAddNote={handleAddCaseNote} disabled={updateCaseWorkflow.isPending} />

      <SurfaceCard noPadding>
        <div className="flex flex-col gap-2 border-b border-zinc-200 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <SectionHead>Listing Command Outbox</SectionHead>
            <p className="text-xs text-zinc-500">Publish, reprice, pause, and end commands queued by listing workflows.</p>
          </div>
          <button
            type="button"
            onClick={() => handleRunScheduledJob("listing_outbox", "Listing command outbox run completed")}
            disabled={runScheduledJobs.isPending}
            className="inline-flex items-center justify-center gap-1.5 rounded-md border border-zinc-200 px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
          >
            <Play className="h-3.5 w-3.5" />
            Run Outbox
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] text-left text-sm">
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
                    <td className="px-3 py-3 text-xs">
                      <ListingCommandTarget command={command} />
                      <div className="text-[11px] text-zinc-500">{command.channel ?? "—"} · {command.externalListingId ?? "—"}</div>
                    </td>
                    <td className="px-3 py-3"><Mono color={command.retryCount > 0 ? "amber" : "dim"}>{command.retryCount}</Mono></td>
                    <td className="px-3 py-3 text-xs text-zinc-500">{formatDateTime(command.nextAttemptAt)}</td>
                    <td className="max-w-[360px] px-4 py-3 text-xs text-red-600">{command.lastError ?? "—"}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => runListingCommandNow.mutate(command.id, {
                            onSuccess: (data) => toast.success(`Processed ${data?.processed ?? 0} listing command(s)`),
                            onError: (err) => toast.error(err instanceof Error ? err.message : "Listing command processor failed"),
                          })}
                          disabled={runListingCommandNow.isPending || command.status !== "pending"}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-zinc-200 text-zinc-600 hover:bg-zinc-50 disabled:opacity-50"
                          title="Run command now"
                          aria-label="Run command now"
                        >
                          <Play className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => retryListingCommand.mutate(command.id, {
                            onSuccess: () => toast.success("Listing command queued for retry"),
                            onError: (err) => toast.error(err instanceof Error ? err.message : "Listing command retry failed"),
                          })}
                          disabled={retryListingCommand.isPending || command.status === "processing" || command.status === "acknowledged" || command.status === "sent"}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-zinc-200 text-zinc-600 hover:bg-zinc-50 disabled:opacity-50"
                          title="Retry command"
                          aria-label="Retry command"
                        >
                          <RefreshCcw className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => cancelListingCommand.mutate(command.id, {
                            onSuccess: () => toast.success("Listing command cancelled"),
                            onError: (err) => toast.error(err instanceof Error ? err.message : "Listing command cancel failed"),
                          })}
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
            <SectionHead>QBO Posting Outbox</SectionHead>
            <p className="text-xs text-zinc-500">Recent posting intents queued by order, payout, item, customer, and purchase workflows.</p>
          </div>
          <button
            type="button"
            onClick={() => handleRunScheduledJob("qbo_posting_outbox", "QBO posting outbox run completed")}
            disabled={runScheduledJobs.isPending}
            className="inline-flex items-center justify-center gap-1.5 rounded-md border border-zinc-200 px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
          >
            <Play className="h-3.5 w-3.5" />
            Run Outbox
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1020px] text-left text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-[11px] uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 font-semibold">Action</th>
                <th className="px-3 py-2 font-semibold">Target</th>
                <th className="px-3 py-2 font-semibold">References</th>
                <th className="px-3 py-2 font-semibold">Retries</th>
                <th className="px-3 py-2 font-semibold">Next Attempt</th>
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
                    <td className="px-3 py-3">
                      <ReferenceStack app={intent.appReference} qboDoc={intent.qboDocNumber} qboId={intent.qboEntityId ?? intent.qboReferenceId} external={intent.externalReference} />
                    </td>
                    <td className="px-3 py-3"><Mono color={intent.retryCount > 0 ? "amber" : "dim"}>{intent.retryCount}</Mono></td>
                    <td className="px-3 py-3 text-xs text-zinc-500">{formatDateTime(intent.nextAttemptAt)}</td>
                    <td className="max-w-[360px] px-4 py-3 text-xs text-red-600">{intent.lastError ?? "—"}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => runPostingIntentNow.mutate(intent.id, {
                            onSuccess: (data) => toast.success(`Processed ${data?.processed ?? 0} posting intent(s)`),
                            onError: (err) => toast.error(err instanceof Error ? err.message : "Posting processor failed"),
                          })}
                          disabled={runPostingIntentNow.isPending || intent.status !== "pending"}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-zinc-200 text-zinc-600 hover:bg-zinc-50 disabled:opacity-50"
                          title="Run posting now"
                          aria-label="Run posting now"
                        >
                          <Play className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => retryPostingIntent.mutate(intent.id, {
                            onSuccess: () => toast.success("QBO posting intent queued for retry"),
                            onError: (err) => toast.error(err instanceof Error ? err.message : "QBO posting retry failed"),
                          })}
                          disabled={retryPostingIntent.isPending || intent.status === "processing" || intent.status === "posted"}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-zinc-200 text-zinc-600 hover:bg-zinc-50 disabled:opacity-50"
                          title="Retry posting"
                          aria-label="Retry posting"
                        >
                          <RefreshCcw className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => cancelPostingIntent.mutate(intent.id, {
                            onSuccess: () => toast.success("QBO posting intent cancelled"),
                            onError: (err) => toast.error(err instanceof Error ? err.message : "QBO posting cancel failed"),
                          })}
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
