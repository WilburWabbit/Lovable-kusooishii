import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  CheckCircle2,
  ClipboardCheck,
  Loader2,
  PackageMinus,
  Play,
  PlugZap,
  RefreshCw,
  Search,
  ShieldCheck,
  Tags,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { AdminDetailTabs, AdminPageHeader } from "@/components/admin-v2/admin-patterns";
import { Badge, Mono, SummaryCard, SurfaceCard } from "@/components/admin-v2/ui-primitives";
import {
  type OperationsIssue,
  useOperationsIssues,
  useRefreshReconciliationCases,
  useResolveOperationsIssue,
  useRunSubledgerScheduledJobs,
} from "@/hooks/admin/use-operations";
import {
  getIssueActionGroupLabel,
  getIssueActionLabel,
  getIssueSeverityColor,
  groupIssuesByAction,
  humanizeToken,
  isIssueNavigationAction,
  issueDomainColors,
  issueDomainTabs,
  requiresIssueNote,
  summarizeIssueEvidence,
  type OperationsIssueDomain,
} from "@/lib/operations-issues";
import { cn } from "@/lib/utils";

const currencyFormatter = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
});

const domainIcons = {
  transactions: ClipboardCheck,
  customers: Users,
  inventory: Boxes,
  products: Tags,
  integrations: PlugZap,
} satisfies Record<OperationsIssue["domain"], typeof ClipboardCheck>;

function formatDateTime(value: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatAmount(value: number | null) {
  return value == null ? null : currencyFormatter.format(value);
}

function issueMatchesSearch(issue: OperationsIssue, query: string) {
  if (!query.trim()) return true;
  const needle = query.trim().toLowerCase();
  return [
    issue.title,
    issue.issueType,
    issue.primaryAction,
    issue.primaryReference,
    issue.secondaryReference,
    issue.recommendedAction,
    issue.whyItMatters,
    issue.sourceSystem,
  ]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(needle));
}

function EmptyIssueState({ hasSearch }: { hasSearch: boolean }) {
  return (
    <SurfaceCard className="flex min-h-[220px] flex-col items-center justify-center text-center">
      <CheckCircle2 className="mb-3 h-8 w-8 text-green-600" />
      <h2 className="text-sm font-semibold text-zinc-900">{hasSearch ? "No matching issues" : "No actionable issues"}</h2>
      <p className="mt-1 max-w-md text-xs text-zinc-500">
        {hasSearch
          ? "Try a different reference, customer, SKU, channel, or action."
          : "The active issue inbox is clear for the selected domain."}
      </p>
    </SurfaceCard>
  );
}

function EvidenceSummary({ issue }: { issue: OperationsIssue }) {
  const chips = summarizeIssueEvidence(issue);

  if (chips.length === 0) {
    return <span className="text-xs text-zinc-400">No structured evidence attached</span>;
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map((chip) => (
        <Mono key={chip} color="dim" className="rounded bg-zinc-100 px-1.5 py-0.5">
          {chip}
        </Mono>
      ))}
    </div>
  );
}

function IssueRow({
  issue,
  onPrimaryAction,
  onDismiss,
  isResolving,
}: {
  issue: OperationsIssue;
  onPrimaryAction: (issue: OperationsIssue) => void;
  onDismiss: (issue: OperationsIssue) => void;
  isResolving: boolean;
}) {
  const Icon = domainIcons[issue.domain];
  const variance = formatAmount(issue.varianceAmount);
  const primaryAmount = formatAmount(issue.amountExpected);
  const actualAmount = formatAmount(issue.amountActual);

  return (
    <div className="grid gap-3 px-4 py-4 hover:bg-zinc-50 lg:grid-cols-[minmax(0,1fr)_auto]">
      <div className="min-w-0">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span
            className="inline-flex h-7 w-7 items-center justify-center rounded-md"
            style={{
              background: `${issueDomainColors[issue.domain]}14`,
              color: issueDomainColors[issue.domain],
            }}
          >
            <Icon className="h-3.5 w-3.5" />
          </span>
          <Badge label={humanizeToken(issue.domain)} color={issueDomainColors[issue.domain]} small />
          <Badge label={issue.severity} color={getIssueSeverityColor(issue.severity)} small />
          <Badge label={`${Math.round(issue.confidence * 100)}% confidence`} color="#52525B" small />
          <Mono color="dim">{issue.sourceSystem}</Mono>
        </div>

        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h3 className="text-sm font-semibold text-zinc-900">{issue.title}</h3>
          <Mono color="default">{issue.primaryReference ?? issue.targetLabel ?? issue.id.slice(0, 12)}</Mono>
          {issue.secondaryReference ? <Mono color="dim">{issue.secondaryReference}</Mono> : null}
        </div>

        <p className="mt-1 max-w-4xl text-xs leading-5 text-zinc-600">{issue.whyItMatters}</p>
        <p className="mt-1 max-w-4xl text-xs font-medium leading-5 text-zinc-800">{issue.recommendedAction}</p>

        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-zinc-500">
          <EvidenceSummary issue={issue} />
          {primaryAmount || actualAmount || variance ? (
            <div className="flex flex-wrap gap-2">
              {primaryAmount ? <span>Expected {primaryAmount}</span> : null}
              {actualAmount ? <span>Actual {actualAmount}</span> : null}
              {variance ? <span>Variance {variance}</span> : null}
            </div>
          ) : null}
          <span>Updated {formatDateTime(issue.updatedAt)}</span>
        </div>

        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-medium text-zinc-500 hover:text-zinc-700">Evidence and diagnostics</summary>
          <pre className="mt-2 max-h-72 overflow-auto rounded-md border border-zinc-200 bg-zinc-950 p-3 text-[11px] leading-5 text-zinc-100">
            {JSON.stringify(
              {
                issue_type: issue.issueType,
                source_table: issue.sourceTable,
                source_id: issue.sourceId,
                primary_entity_type: issue.primaryEntityType,
                primary_entity_id: issue.primaryEntityId,
                evidence: issue.evidence,
              },
              null,
              2,
            )}
          </pre>
        </details>
      </div>

      <div className="flex flex-row items-start gap-2 lg:flex-col lg:items-stretch">
        <button
          type="button"
          onClick={() => onPrimaryAction(issue)}
          disabled={isResolving}
          className="inline-flex items-center justify-center gap-1.5 rounded-md bg-zinc-900 px-3 py-2 text-xs font-semibold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isResolving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />}
          {getIssueActionLabel(issue.primaryAction)}
        </button>
        <button
          type="button"
          onClick={() => onDismiss(issue)}
          disabled={isResolving}
          className="inline-flex items-center justify-center rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-600 hover:border-zinc-300 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

function ActionGroup({
  action,
  issues,
  onPrimaryAction,
  onDismiss,
  resolvingId,
}: {
  action: string;
  issues: OperationsIssue[];
  onPrimaryAction: (issue: OperationsIssue) => void;
  onDismiss: (issue: OperationsIssue) => void;
  resolvingId: string | null;
}) {
  return (
    <SurfaceCard noPadding>
      <div className="flex items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900">{getIssueActionGroupLabel(action)}</h2>
          <p className="mt-1 text-xs text-zinc-500">{issues.length} active {issues.length === 1 ? "issue" : "issues"}</p>
        </div>
        <Badge label={getIssueActionLabel(action)} color="#18181B" small />
      </div>
      <div className="divide-y divide-zinc-100">
        {issues.map((issue) => (
          <IssueRow
            key={issue.id}
            issue={issue}
            onPrimaryAction={onPrimaryAction}
            onDismiss={onDismiss}
            isResolving={resolvingId === issue.id}
          />
        ))}
      </div>
    </SurfaceCard>
  );
}

export function OperationsView() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<OperationsIssueDomain>("all");
  const [search, setSearch] = useState("");
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const { data: issues = [], isLoading, isError, error, refetch, isFetching } = useOperationsIssues();
  const resolveIssue = useResolveOperationsIssue();
  const runJobs = useRunSubledgerScheduledJobs();
  const refreshCases = useRefreshReconciliationCases();

  const domainCounts = useMemo(() => {
    return issueDomainTabs.reduce<Record<OperationsIssueDomain, number>>((counts, tab) => {
      counts[tab.key] = tab.key === "all" ? issues.length : issues.filter((issue) => issue.domain === tab.key).length;
      return counts;
    }, {} as Record<OperationsIssueDomain, number>);
  }, [issues]);

  const filteredIssues = useMemo(() => {
    return issues.filter((issue) => {
      const tabMatches = activeTab === "all" || issue.domain === activeTab;
      return tabMatches && issueMatchesSearch(issue, search);
    });
  }, [activeTab, issues, search]);

  const groupedIssues = useMemo(() => groupIssuesByAction(filteredIssues), [filteredIssues]);
  const highSeverityCount = issues.filter((issue) => issue.severity === "critical" || issue.severity === "high").length;
  const directActionCount = issues.filter((issue) => !isIssueNavigationAction(issue.primaryAction)).length;

  const tabs = issueDomainTabs.map((tab) => ({
    key: tab.key,
    label: tab.label,
    count: domainCounts[tab.key] ?? 0,
  }));

  const runAutomation = async () => {
    try {
      await runJobs.mutateAsync("all");
      await refetch();
      toast.success("Issue inputs refreshed");
    } catch (runError) {
      toast.error(runError instanceof Error ? runError.message : "Could not refresh issue inputs");
    }
  };

  const refreshIssues = async () => {
    try {
      await refreshCases.mutateAsync();
      await refetch();
      toast.success("Issue inbox refreshed");
    } catch (refreshError) {
      toast.error(refreshError instanceof Error ? refreshError.message : "Could not refresh issue inbox");
    }
  };

  const resolveWithAction = async (issue: OperationsIssue, action: string, note?: string | null) => {
    setResolvingId(issue.id);
    try {
      await resolveIssue.mutateAsync({
        id: issue.id,
        action,
        note,
        evidence: {
          ui: "operations_issue_inbox",
          primary_reference: issue.primaryReference,
          secondary_reference: issue.secondaryReference,
        },
      });
      toast.success(`${getIssueActionLabel(action)} requested`);
    } catch (actionError) {
      toast.error(actionError instanceof Error ? actionError.message : "Could not update issue");
    } finally {
      setResolvingId(null);
    }
  };

  const handlePrimaryAction = (issue: OperationsIssue) => {
    if (isIssueNavigationAction(issue.primaryAction) && issue.targetRoute) {
      navigate(issue.targetRoute);
      return;
    }

    if (requiresIssueNote(issue.primaryAction)) {
      const note = window.prompt(`Reason for ${getIssueActionLabel(issue.primaryAction).toLowerCase()}`);
      if (!note?.trim()) return;
      void resolveWithAction(issue, issue.primaryAction, note.trim());
      return;
    }

    void resolveWithAction(issue, issue.primaryAction);
  };

  const handleDismiss = (issue: OperationsIssue) => {
    const note = window.prompt("Why should this issue stop appearing?");
    if (!note?.trim()) return;
    void resolveWithAction(issue, "dismiss", note.trim());
  };

  return (
    <div>
      <AdminPageHeader
        title="Issue Inbox"
        description="Actionable transaction, customer, inventory, product, and integration issues from active records and recent history."
        actions={
          <>
            <button
              type="button"
              onClick={refreshIssues}
              disabled={refreshCases.isPending || isFetching}
              className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-700 hover:border-zinc-300 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {refreshCases.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Refresh Issues
            </button>
            <button
              type="button"
              onClick={runAutomation}
              disabled={runJobs.isPending}
              className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-3 py-2 text-xs font-semibold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {runJobs.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              Run Automation
            </button>
          </>
        }
        meta={
          <>
            <Badge label="18 month default lookback" color="#71717A" small />
            <Badge label="suppressed false positives hidden" color="#16A34A" small />
          </>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <SummaryCard label="Active Issues" value={issues.length} color="#18181B" />
        <SummaryCard label="High Severity" value={highSeverityCount} color={highSeverityCount > 0 ? "#DC2626" : "#16A34A"} />
        <SummaryCard label="Transactions" value={domainCounts.transactions ?? 0} color={issueDomainColors.transactions} />
        <SummaryCard label="Inventory" value={domainCounts.inventory ?? 0} color={issueDomainColors.inventory} />
        <SummaryCard label="Direct Actions" value={directActionCount} color="#7C3AED" />
      </div>

      <SurfaceCard className="mb-4 p-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative max-w-xl flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by action, reference, source, customer, SKU, or issue type"
              className="h-9 w-full rounded-md border border-zinc-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-amber-500"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
            <span className="inline-flex items-center gap-1">
              <ShieldCheck className="h-3.5 w-3.5 text-green-600" />
              Evidence required
            </span>
            <span className="inline-flex items-center gap-1">
              <PackageMinus className="h-3.5 w-3.5 text-amber-600" />
              Domain-specific actions
            </span>
          </div>
        </div>
      </SurfaceCard>

      <AdminDetailTabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />

      {isLoading ? (
        <SurfaceCard className="flex min-h-[260px] items-center justify-center">
          <div className="flex items-center gap-2 text-sm text-zinc-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading issue inbox
          </div>
        </SurfaceCard>
      ) : isError ? (
        <SurfaceCard className="border-red-200 bg-red-50">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 text-red-600" />
            <div>
              <h2 className="text-sm font-semibold text-red-900">Issue inbox could not load</h2>
              <p className="mt-1 text-xs text-red-700">{error instanceof Error ? error.message : "Unknown issue inbox error"}</p>
            </div>
          </div>
        </SurfaceCard>
      ) : groupedIssues.length === 0 ? (
        <EmptyIssueState hasSearch={Boolean(search.trim())} />
      ) : (
        <div className="space-y-4">
          {groupedIssues.map((group) => (
            <ActionGroup
              key={group.action}
              action={group.action}
              issues={group.issues}
              onPrimaryAction={handlePrimaryAction}
              onDismiss={handleDismiss}
              resolvingId={resolvingId}
            />
          ))}
        </div>
      )}

      <SurfaceCard className={cn("mt-5", issues.length === 0 && "hidden")}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-zinc-900">Diagnostics</h2>
            <p className="mt-1 text-xs text-zinc-500">
              Low-level reconciliation, outbox, and landing details stay inside each issue row. Historical accepted mismatches remain suppressed.
            </p>
          </div>
          <Link to="/admin/settings/app-health" className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 hover:text-amber-600">
            App health
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </SurfaceCard>
    </div>
  );
}
