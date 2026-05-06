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
  getIssueDisplayInfo,
  getIssueNavigationRoute,
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
  const display = getIssueDisplayInfo(issue);
  return [
    issue.title,
    issue.issueType,
    issue.primaryAction,
    issue.primaryReference,
    issue.secondaryReference,
    issue.recommendedAction,
    issue.whyItMatters,
    issue.sourceSystem,
    ...display.searchableValues,
  ]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(needle));
}

function filterOptionLabel(value: string) {
  if (value === "all") return "All";
  if (value === "85") return "85%+";
  if (value === "95") return "95%+";
  return humanizeToken(value);
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
  formatOption = filterOptionLabel,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
  formatOption?: (value: string) => string;
}) {
  return (
    <label className="flex min-w-[150px] flex-1 flex-col gap-1 text-[11px] font-medium uppercase tracking-wide text-zinc-500 sm:flex-none">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 rounded-md border border-zinc-200 bg-white px-2.5 text-xs font-normal normal-case tracking-normal text-zinc-700 outline-none focus:border-amber-500"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {formatOption(option)}
          </option>
        ))}
      </select>
    </label>
  );
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

function TraceChips({ issue }: { issue: OperationsIssue }) {
  const display = getIssueDisplayInfo(issue);
  const traceItems = display.traceItems.slice(0, 7);

  if (traceItems.length === 0) return null;

  const copyTrace = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied`);
    } catch {
      toast.error("Could not copy identifier");
    }
  };

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Trace</span>
      {traceItems.map((item) => (
        <button
          key={`${item.label}:${item.value}`}
          type="button"
          title={`${item.label}: ${item.value}`}
          onClick={() => void copyTrace(item.label, item.value)}
          className="inline-flex max-w-full items-center gap-1 rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-600 hover:bg-zinc-200 hover:text-zinc-900"
        >
          <span className="font-medium text-zinc-500">{item.label}</span>
          <Mono color="dim" className="text-[11px]">{item.displayValue}</Mono>
        </button>
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
  const display = getIssueDisplayInfo(issue);

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

        <div className="max-w-4xl">
          <h3 className="text-sm font-semibold text-zinc-900">{display.primaryLabel}</h3>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500">
            <span>{issue.title}</span>
            {display.secondaryLabel ? <span>{display.secondaryLabel}</span> : null}
          </div>
        </div>

        <p className="mt-1 max-w-4xl text-xs leading-5 text-zinc-600">{issue.whyItMatters}</p>
        <p className="mt-1 max-w-4xl text-xs font-medium leading-5 text-zinc-800">{issue.recommendedAction}</p>
        <TraceChips issue={issue} />

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
  const [severityFilter, setSeverityFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [actionFilter, setActionFilter] = useState("all");
  const [confidenceFilter, setConfidenceFilter] = useState("all");
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

  const domainIssues = useMemo(() => {
    return issues.filter((issue) => activeTab === "all" || issue.domain === activeTab);
  }, [activeTab, issues]);

  const filterOptions = useMemo(() => {
    const severityOrder = ["critical", "high", "medium", "low"];
    const severities = [...new Set(domainIssues.map((issue) => issue.severity).filter(Boolean))]
      .sort((a, b) => severityOrder.indexOf(a) - severityOrder.indexOf(b));
    const sources = [...new Set(domainIssues.map((issue) => issue.sourceSystem).filter(Boolean))]
      .sort((a, b) => humanizeToken(a).localeCompare(humanizeToken(b)));
    const actions = [...new Set(domainIssues.map((issue) => issue.primaryAction).filter(Boolean))]
      .sort((a, b) => getIssueActionLabel(a).localeCompare(getIssueActionLabel(b)));

    return {
      severities: ["all", ...severities],
      sources: ["all", ...sources],
      actions: ["all", ...actions],
      confidence: ["all", "85", "95"],
    };
  }, [domainIssues]);

  const filteredIssues = useMemo(() => {
    return domainIssues.filter((issue) => {
      const confidencePercent = Math.round(issue.confidence * 100);
      const severityMatches = severityFilter === "all" || issue.severity === severityFilter;
      const sourceMatches = sourceFilter === "all" || issue.sourceSystem === sourceFilter;
      const actionMatches = actionFilter === "all" || issue.primaryAction === actionFilter;
      const confidenceMatches = confidenceFilter === "all" || confidencePercent >= Number(confidenceFilter);
      return severityMatches
        && sourceMatches
        && actionMatches
        && confidenceMatches
        && issueMatchesSearch(issue, search);
    });
  }, [actionFilter, confidenceFilter, domainIssues, search, severityFilter, sourceFilter]);

  const groupedIssues = useMemo(() => groupIssuesByAction(filteredIssues), [filteredIssues]);
  const highSeverityCount = issues.filter((issue) => issue.severity === "critical" || issue.severity === "high").length;
  const directActionCount = issues.filter((issue) => !isIssueNavigationAction(issue.primaryAction)).length;
  const hasActiveFilters = Boolean(search.trim())
    || severityFilter !== "all"
    || sourceFilter !== "all"
    || actionFilter !== "all"
    || confidenceFilter !== "all";

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
    const display = getIssueDisplayInfo(issue);
    setResolvingId(issue.id);
    try {
      await resolveIssue.mutateAsync({
        id: issue.id,
        action,
        note,
        evidence: {
          ui: "operations_issue_inbox",
          primary_label: display.primaryLabel,
          secondary_label: display.secondaryLabel,
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
    const navigationRoute = getIssueNavigationRoute(issue);
    if (isIssueNavigationAction(issue.primaryAction) && navigationRoute) {
      navigate(navigationRoute);
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

  const clearFilters = () => {
    setSearch("");
    setSeverityFilter("all");
    setSourceFilter("all");
    setActionFilter("all");
    setConfidenceFilter("all");
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
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative max-w-xl flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search order, customer, SKU, QBO doc, external listing, command ID, or issue type"
                className="h-9 w-full rounded-md border border-zinc-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-amber-500"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
              <span>{filteredIssues.length} of {domainIssues.length} visible</span>
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

          <div className="flex flex-col gap-2 border-t border-zinc-100 pt-3 sm:flex-row sm:flex-wrap sm:items-end">
            <FilterSelect label="Severity" value={severityFilter} options={filterOptions.severities} onChange={setSeverityFilter} />
            <FilterSelect label="Source" value={sourceFilter} options={filterOptions.sources} onChange={setSourceFilter} />
            <FilterSelect label="Action" value={actionFilter} options={filterOptions.actions} onChange={setActionFilter} formatOption={(value) => value === "all" ? "All" : getIssueActionLabel(value)} />
            <FilterSelect label="Confidence" value={confidenceFilter} options={filterOptions.confidence} onChange={setConfidenceFilter} />
            <button
              type="button"
              onClick={clearFilters}
              disabled={!hasActiveFilters}
              className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-600 hover:border-zinc-300 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Clear filters
            </button>
          </div>
        </div>
      </SurfaceCard>

      <AdminDetailTabs tabs={tabs} activeTab={activeTab} onChange={(key) => setActiveTab(key as typeof activeTab)} />

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
        <EmptyIssueState hasSearch={hasActiveFilters} />
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
