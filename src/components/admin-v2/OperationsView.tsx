import { Link } from "react-router-dom";
import { AlertTriangle, Check, Clock, Play, X } from "lucide-react";
import { toast } from "sonner";
import {
  usePostingIntents,
  useReconciliationInbox,
  useRunPostingIntentProcessor,
  useUpdateReconciliationCaseStatus,
  type PostingIntentRow,
  type ReconciliationInboxCase,
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
  posted: "#16A34A",
  failed: "#DC2626",
  skipped: "#71717A",
  cancelled: "#71717A",
  open: "#D97706",
  in_progress: "#2563EB",
  resolved: "#16A34A",
  ignored: "#71717A",
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

export function OperationsView() {
  const { data: cases = [], isLoading: casesLoading } = useReconciliationInbox();
  const { data: intents = [], isLoading: intentsLoading } = usePostingIntents();
  const updateCase = useUpdateReconciliationCaseStatus();
  const runProcessor = useRunPostingIntentProcessor();

  const openCases = cases.length;
  const criticalCases = cases.filter((c) => c.severity === "critical" || c.severity === "high").length;
  const pendingIntents = intents.filter((i) => i.status === "pending").length;
  const failedIntents = intents.filter((i) => i.status === "failed").length;

  const handleCaseStatus = (id: string, status: "resolved" | "ignored" | "in_progress") => {
    updateCase.mutate(
      { id, status },
      {
        onSuccess: () => toast.success(status === "in_progress" ? "Case marked in progress" : `Case ${status}`),
        onError: (err) => toast.error(err instanceof Error ? err.message : "Case update failed"),
      },
    );
  };

  const handleRunProcessor = () => {
    runProcessor.mutate(undefined, {
      onSuccess: (data) => toast.success(`Processed ${data?.processed ?? 0} posting intent(s)`),
      onError: (err) => toast.error(err instanceof Error ? err.message : "Posting processor failed"),
    });
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-[22px] font-bold text-zinc-900">Operations</h1>
          <p className="text-xs text-zinc-500">Finance exceptions, settlement mismatches, and QBO posting outbox health.</p>
        </div>
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

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard label="Open Cases" value={openCases} color={openCases > 0 ? "#D97706" : "#16A34A"} />
        <SummaryCard label="High Severity" value={criticalCases} color={criticalCases > 0 ? "#DC2626" : "#16A34A"} />
        <SummaryCard label="Pending QBO Posts" value={pendingIntents} color={pendingIntents > 0 ? "#D97706" : "#16A34A"} />
        <SummaryCard label="Failed QBO Posts" value={failedIntents} color={failedIntents > 0 ? "#DC2626" : "#16A34A"} />
      </div>

      <SurfaceCard noPadding>
        <div className="border-b border-zinc-200 px-4 py-3">
          <SectionHead>Reconciliation Inbox</SectionHead>
          <p className="text-xs text-zinc-500">Open settlement, COGS, allocation, programme, and QBO posting exceptions.</p>
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
                        <span className="font-medium text-zinc-900">{caseRow.caseType.replaceAll("_", " ")}</span>
                      </div>
                      <Mono color="dim">{shortId(caseRow.id)}</Mono>
                    </td>
                    <td className="px-3 py-3 text-xs">{reconciliationTarget(caseRow)}</td>
                    <td className="px-3 py-3">
                      <div className="text-zinc-900">{formatMoney(caseRow.varianceAmount)}</div>
                      <div className="text-[11px] text-zinc-500">{formatMoney(caseRow.amountExpected)} exp / {formatMoney(caseRow.amountActual)} act</div>
                    </td>
                    <td className="max-w-[300px] px-3 py-3 text-xs text-zinc-600">
                      <div>{caseRow.suspectedRootCause ?? "—"}</div>
                      {caseRow.recommendedAction && <div className="mt-1 text-zinc-400">{caseRow.recommendedAction}</div>}
                    </td>
                    <td className="px-3 py-3 text-xs text-zinc-500">{formatDateTime(caseRow.createdAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1.5">
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
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {intentsLoading ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-zinc-500">Loading posting intents...</td></tr>
              ) : intents.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-zinc-500">No QBO posting intents yet.</td></tr>
              ) : (
                intents.map((intent) => (
                  <tr key={intent.id} className="align-top hover:bg-zinc-50/70">
                    <td className="px-4 py-3"><Badge label={intent.status} color={statusColors[intent.status] ?? "#71717A"} small /></td>
                    <td className="px-3 py-3 text-xs text-zinc-700">{intent.action.replaceAll("_", " ")}</td>
                    <td className="px-3 py-3 text-xs"><PostingIntentTarget intent={intent} /></td>
                    <td className="px-3 py-3"><Mono color={intent.retryCount > 0 ? "amber" : "dim"}>{intent.retryCount}</Mono></td>
                    <td className="px-3 py-3 text-xs text-zinc-500">{formatDateTime(intent.nextAttemptAt)}</td>
                    <td className="px-3 py-3"><Mono color={intent.qboReferenceId ? "green" : "dim"}>{intent.qboReferenceId ?? "—"}</Mono></td>
                    <td className="max-w-[360px] px-4 py-3 text-xs text-red-600">{intent.lastError ?? "—"}</td>
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
