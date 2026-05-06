import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const operationsKeys = {
  all: ["v2", "operations"] as const,
  issues: ["v2", "operations", "issues"] as const,
  reconciliation: ["v2", "operations", "reconciliation"] as const,
  reconciliationNotes: (caseId: string) => ["v2", "operations", "reconciliation", caseId, "notes"] as const,
  health: ["v2", "operations", "rolling-health"] as const,
  jobRuns: ["v2", "operations", "job-runs"] as const,
  postingIntents: ["v2", "operations", "posting-intents"] as const,
  listingCommands: ["v2", "operations", "listing-commands"] as const,
  rollingSettlement: ["v2", "operations", "rolling-settlement"] as const,
  blueBellAccruals: ["v2", "operations", "blue-bell-accruals"] as const,
};

export interface ReconciliationInboxCase {
  id: string;
  caseType: string;
  severity: string;
  status: string;
  salesOrderId: string | null;
  orderNumber: string | null;
  salesOrderLineId: string | null;
  payoutId: string | null;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  suspectedRootCause: string | null;
  recommendedAction: string | null;
  diagnosis: string | null;
  nextStep: string | null;
  evidence: Record<string, unknown>;
  requiresEvidence: boolean;
  noteCount: number;
  latestNoteAt: string | null;
  latestNote: string | null;
  amountExpected: number | null;
  amountActual: number | null;
  varianceAmount: number | null;
  targetRoute: string | null;
  targetLabel: string | null;
  appReference: string | null;
  qboEntityId: string | null;
  qboDocNumber: string | null;
  externalReference: string | null;
  stripeReference: string | null;
  ebayReference: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OperationsIssue {
  id: string;
  issueKey: string;
  domain: "transactions" | "customers" | "inventory" | "products" | "integrations";
  issueType: string;
  severity: string;
  status: string;
  confidence: number;
  sourceSystem: string;
  sourceTable: string;
  sourceId: string | null;
  primaryEntityType: string | null;
  primaryEntityId: string | null;
  primaryReference: string | null;
  secondaryReference: string | null;
  title: string;
  whyItMatters: string;
  evidence: Record<string, unknown>;
  recommendedAction: string;
  primaryAction: string;
  secondaryActions: string[];
  targetRoute: string | null;
  targetLabel: string | null;
  amountExpected: number | null;
  amountActual: number | null;
  varianceAmount: number | null;
  createdAt: string;
  updatedAt: string;
  sortRank: number;
}

export interface PostingIntentRow {
  id: string;
  targetSystem: string;
  action: string;
  entityType: string;
  entityId: string | null;
  status: string;
  retryCount: number;
  lastError: string | null;
  nextAttemptAt: string | null;
  qboReferenceId: string | null;
  qboEntityId: string | null;
  qboDocNumber: string | null;
  appReference: string | null;
  externalReference: string | null;
  createdAt: string;
  updatedAt: string;
  postedAt: string | null;
}

export interface ListingCommandRow {
  id: string;
  targetSystem: string;
  commandType: string;
  entityType: string;
  entityId: string | null;
  status: string;
  retryCount: number;
  lastError: string | null;
  nextAttemptAt: string | null;
  sentAt: string | null;
  appReference: string | null;
  externalListingId: string | null;
  channel: string | null;
  skuCode: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BlueBellAccrualRow {
  id: string;
  salesOrderId: string;
  orderNumber: string | null;
  orderCreatedAt: string | null;
  originChannel: string | null;
  status: string;
  basisAmount: number;
  discountAmount: number;
  commissionAmount: number;
  reversedAmount: number;
  commissionOutstanding: number;
  settlementId: string | null;
  qboExpenseId: string | null;
  qboPaymentReference: string | null;
  qboDocNumber: string | null;
  externalReference: string | null;
  createdAt: string;
}

export interface RollingSettlementRow {
  salesOrderId: string;
  orderNumber: string | null;
  originChannel: string | null;
  paymentMethod: string | null;
  settlementStatus: string;
  expectedTotal: number;
  actualTotal: number;
  varianceAmount: number;
  openCaseCount: number;
  missingPayoutCaseCount: number;
  amountMismatchCaseCount: number;
  appReference: string | null;
  qboEntityId: string | null;
  qboDocNumber: string | null;
  externalReference: string | null;
  stripeReference: string | null;
  ebayReference: string | null;
  latestActualAt: string | null;
  orderCreatedAt: string;
}

export interface ReconciliationCaseNote {
  id: string;
  reconciliationCaseId: string;
  actorId: string | null;
  actorName: string | null;
  noteType: string;
  note: string | null;
  evidence: Record<string, unknown>;
  createdAt: string;
}

export interface OperationsHealthRow {
  area: string;
  healthStatus: string;
  severity: string;
  openCount: number;
  failedCount: number;
  pendingCount: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  oldestPendingAt: string | null;
  recommendation: string;
}

export interface SubledgerJobRunRow {
  id: string;
  occurredAt: string;
  actorType: string;
  actorId: string | null;
  requestedJob: string | null;
  runSuccess: boolean | null;
  job: string | null;
  jobSuccess: boolean | null;
  rowsProcessed: number | null;
  error: string | null;
  response: Record<string, unknown> | null;
}

type ScheduledSubledgerJob = "all" | "market_intelligence" | "settlement_reconciliation" | "listing_outbox" | "qbo_posting_outbox";

export type OperationsExportKind =
  | "rolling-settlement"
  | "blue-bell-statement"
  | "reconciliation-cases"
  | "margin-profit";

const exportConfig: Record<OperationsExportKind, { view: string; filename: string; orderBy: string }> = {
  "rolling-settlement": {
    view: "v_rolling_settlement_export",
    filename: "rolling-settlement-export",
    orderBy: "order_created_at",
  },
  "blue-bell-statement": {
    view: "v_blue_bell_statement_export",
    filename: "blue-bell-accrual-statement",
    orderBy: "order_created_at",
  },
  "reconciliation-cases": {
    view: "v_reconciliation_case_export",
    filename: "reconciliation-case-export",
    orderBy: "created_at",
  },
  "margin-profit": {
    view: "v_margin_profit_report",
    filename: "margin-profit-report",
    orderBy: "order_date",
  },
};

function csvValue(value: unknown): string {
  if (value == null) return "";
  const raw = typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\n\r]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const body = rows.map((row) => headers.map((header) => csvValue(row[header])).join(","));
  return [headers.join(","), ...body].join("\n");
}

function downloadCsv(filename: string, rows: Record<string, unknown>[]) {
  const csv = toCsv(rows);
  const blob = new Blob([csv ? `\uFEFF${csv}` : ""], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${filename}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

const mapCase = (row: Record<string, unknown>): ReconciliationInboxCase => ({
  id: row.id as string,
  caseType: row.case_type as string,
  severity: row.severity as string,
  status: row.status as string,
  salesOrderId: (row.sales_order_id as string | null) ?? null,
  orderNumber: (row.order_number as string | null) ?? null,
  salesOrderLineId: (row.sales_order_line_id as string | null) ?? null,
  payoutId: (row.payout_id as string | null) ?? null,
  relatedEntityType: (row.related_entity_type as string | null) ?? null,
  relatedEntityId: (row.related_entity_id as string | null) ?? null,
  suspectedRootCause: (row.suspected_root_cause as string | null) ?? null,
  recommendedAction: (row.recommended_action as string | null) ?? null,
  diagnosis: (row.diagnosis as string | null) ?? null,
  nextStep: (row.next_step as string | null) ?? null,
  evidence: ((row.evidence as Record<string, unknown> | null) ?? {}),
  requiresEvidence: Boolean(row.requires_evidence ?? false),
  noteCount: Number(row.note_count ?? 0),
  latestNoteAt: (row.latest_note_at as string | null) ?? null,
  latestNote: (row.latest_note as string | null) ?? null,
  amountExpected: row.amount_expected == null ? null : Number(row.amount_expected),
  amountActual: row.amount_actual == null ? null : Number(row.amount_actual),
  varianceAmount: row.variance_amount == null ? null : Number(row.variance_amount),
  targetRoute: (row.target_route as string | null) ?? null,
  targetLabel: (row.target_label as string | null) ?? null,
  appReference: (row.app_reference as string | null) ?? null,
  qboEntityId: (row.qbo_entity_id as string | null) ?? null,
  qboDocNumber: (row.qbo_doc_number as string | null) ?? null,
  externalReference: (row.external_reference as string | null) ?? null,
  stripeReference: (row.stripe_reference as string | null) ?? null,
  ebayReference: (row.ebay_reference as string | null) ?? null,
  createdAt: row.created_at as string,
  updatedAt: row.updated_at as string,
});

const mapIssue = (row: Record<string, unknown>): OperationsIssue => ({
  id: row.id as string,
  issueKey: row.issue_key as string,
  domain: row.domain as OperationsIssue["domain"],
  issueType: row.issue_type as string,
  severity: row.severity as string,
  status: row.status as string,
  confidence: Number(row.confidence ?? 0),
  sourceSystem: row.source_system as string,
  sourceTable: row.source_table as string,
  sourceId: (row.source_id as string | null) ?? null,
  primaryEntityType: (row.primary_entity_type as string | null) ?? null,
  primaryEntityId: (row.primary_entity_id as string | null) ?? null,
  primaryReference: (row.primary_reference as string | null) ?? null,
  secondaryReference: (row.secondary_reference as string | null) ?? null,
  title: row.title as string,
  whyItMatters: row.why_it_matters as string,
  evidence: ((row.evidence as Record<string, unknown> | null) ?? {}),
  recommendedAction: row.recommended_action as string,
  primaryAction: row.primary_action as string,
  secondaryActions: Array.isArray(row.secondary_actions) ? (row.secondary_actions as string[]) : [],
  targetRoute: (row.target_route as string | null) ?? null,
  targetLabel: (row.target_label as string | null) ?? null,
  amountExpected: row.amount_expected == null ? null : Number(row.amount_expected),
  amountActual: row.amount_actual == null ? null : Number(row.amount_actual),
  varianceAmount: row.variance_amount == null ? null : Number(row.variance_amount),
  createdAt: row.created_at as string,
  updatedAt: row.updated_at as string,
  sortRank: Number(row.sort_rank ?? 999),
});

const mapCaseNote = (row: Record<string, unknown>): ReconciliationCaseNote => ({
  id: row.id as string,
  reconciliationCaseId: row.reconciliation_case_id as string,
  actorId: (row.actor_id as string | null) ?? null,
  actorName: (row.actor_name as string | null) ?? null,
  noteType: row.note_type as string,
  note: (row.note as string | null) ?? null,
  evidence: ((row.evidence as Record<string, unknown> | null) ?? {}),
  createdAt: row.created_at as string,
});

const mapHealth = (row: Record<string, unknown>): OperationsHealthRow => {
  const area = row.area as string;
  const recommendation = (row.recommendation as string | null) ?? "Review this area.";

  return {
    area,
    healthStatus: row.health_status as string,
    severity: row.severity as string,
    openCount: Number(row.open_count ?? 0),
    failedCount: Number(row.failed_count ?? 0),
    pendingCount: Number(row.pending_count ?? 0),
    lastSuccessAt: (row.last_success_at as string | null) ?? null,
    lastFailureAt: (row.last_failure_at as string | null) ?? null,
    oldestPendingAt: (row.oldest_pending_at as string | null) ?? null,
    recommendation: area === "blue_bell_accruals" && /period/i.test(recommendation)
      ? "Settle unpaid Blue Bell commissions from the rolling accrual ledger."
      : recommendation,
  };
};

const mapJobRun = (row: Record<string, unknown>): SubledgerJobRunRow => ({
  id: row.id as string,
  occurredAt: row.occurred_at as string,
  actorType: row.actor_type as string,
  actorId: (row.actor_id as string | null) ?? null,
  requestedJob: (row.requested_job as string | null) ?? null,
  runSuccess: row.run_success == null ? null : Boolean(row.run_success),
  job: (row.job as string | null) ?? null,
  jobSuccess: row.job_success == null ? null : Boolean(row.job_success),
  rowsProcessed: row.rows_processed == null ? null : Number(row.rows_processed),
  error: (row.error as string | null) ?? null,
  response: (row.response as Record<string, unknown> | null) ?? null,
});

const mapPostingIntent = (row: Record<string, unknown>): PostingIntentRow => ({
  id: row.id as string,
  targetSystem: row.target_system as string,
  action: row.action as string,
  entityType: row.entity_type as string,
  entityId: (row.entity_id as string | null) ?? null,
  status: row.status as string,
  retryCount: Number(row.retry_count ?? 0),
  lastError: (row.last_error as string | null) ?? null,
  nextAttemptAt: (row.next_attempt_at as string | null) ?? null,
  qboReferenceId: (row.qbo_reference_id as string | null) ?? null,
  qboEntityId: (row.qbo_entity_id as string | null) ?? null,
  qboDocNumber: (row.qbo_doc_number as string | null) ?? null,
  appReference: (row.app_reference as string | null) ?? null,
  externalReference: (row.external_reference as string | null) ?? null,
  createdAt: row.created_at as string,
  updatedAt: row.updated_at as string,
  postedAt: (row.posted_at as string | null) ?? null,
});

const mapListingCommand = (row: Record<string, unknown>): ListingCommandRow => ({
  id: row.id as string,
  targetSystem: row.target_system as string,
  commandType: row.command_type as string,
  entityType: row.entity_type as string,
  entityId: (row.entity_id as string | null) ?? null,
  status: row.status as string,
  retryCount: Number(row.retry_count ?? 0),
  lastError: (row.last_error as string | null) ?? null,
  nextAttemptAt: (row.next_attempt_at as string | null) ?? null,
  sentAt: (row.sent_at as string | null) ?? null,
  appReference: (row.app_reference as string | null) ?? null,
  externalListingId: (row.external_listing_id as string | null) ?? null,
  channel: (row.channel as string | null) ?? null,
  skuCode: (row.sku_code as string | null) ?? null,
  createdAt: row.created_at as string,
  updatedAt: row.updated_at as string,
});

const mapBlueBellAccrual = (row: Record<string, unknown>): BlueBellAccrualRow => ({
  id: row.accrual_id as string,
  salesOrderId: row.sales_order_id as string,
  orderNumber: (row.order_number as string | null) ?? null,
  orderCreatedAt: (row.order_created_at as string | null) ?? null,
  originChannel: (row.origin_channel as string | null) ?? null,
  status: row.status as string,
  basisAmount: Number(row.basis_amount ?? 0),
  discountAmount: Number(row.discount_amount ?? 0),
  commissionAmount: Number(row.commission_amount ?? 0),
  reversedAmount: Number(row.reversed_amount ?? 0),
  commissionOutstanding: Number(row.commission_outstanding ?? 0),
  settlementId: (row.settlement_id as string | null) ?? null,
  qboExpenseId: (row.qbo_expense_id as string | null) ?? null,
  qboPaymentReference: (row.qbo_payment_reference as string | null) ?? null,
  qboDocNumber: (row.qbo_doc_number as string | null) ?? null,
  externalReference: (row.external_reference as string | null) ?? null,
  createdAt: row.created_at as string,
});

const mapRollingSettlement = (row: Record<string, unknown>): RollingSettlementRow => ({
  salesOrderId: row.sales_order_id as string,
  orderNumber: (row.order_number as string | null) ?? null,
  originChannel: (row.origin_channel as string | null) ?? null,
  paymentMethod: (row.payment_method as string | null) ?? null,
  settlementStatus: row.settlement_status as string,
  expectedTotal: Number(row.expected_total ?? 0),
  actualTotal: Number(row.actual_total ?? 0),
  varianceAmount: Number(row.variance_amount ?? 0),
  openCaseCount: Number(row.open_case_count ?? 0),
  missingPayoutCaseCount: Number(row.missing_payout_case_count ?? 0),
  amountMismatchCaseCount: Number(row.amount_mismatch_case_count ?? 0),
  appReference: (row.app_reference as string | null) ?? null,
  qboEntityId: (row.qbo_entity_id as string | null) ?? null,
  qboDocNumber: (row.qbo_doc_number as string | null) ?? null,
  externalReference: (row.external_reference as string | null) ?? null,
  stripeReference: (row.stripe_reference as string | null) ?? null,
  ebayReference: (row.ebay_reference as string | null) ?? null,
  latestActualAt: (row.latest_actual_at as string | null) ?? null,
  orderCreatedAt: row.order_created_at as string,
});

export function useReconciliationInbox() {
  return useQuery({
    queryKey: operationsKeys.reconciliation,
    queryFn: async (): Promise<ReconciliationInboxCase[]> => {
      const { data, error } = await supabase
        .from("v_reconciliation_inbox" as never)
        .select("*")
        .neq("case_type" as never, "unpaid_program_accrual")
        .limit(250);

      if (error) throw error;
      return ((data ?? []) as unknown as Record<string, unknown>[]).map(mapCase);
    },
  });
}

export function useOperationsIssues() {
  return useQuery({
    queryKey: operationsKeys.issues,
    queryFn: async (): Promise<OperationsIssue[]> => {
      const { data, error } = await supabase
        .from("v_operations_issue_inbox" as never)
        .select("*")
        .order("sort_rank" as never, { ascending: true })
        .order("created_at" as never, { ascending: true })
        .limit(500);

      if (error) throw error;
      return ((data ?? []) as unknown as Record<string, unknown>[]).map(mapIssue);
    },
  });
}

export function useReconciliationCaseNotes(caseId: string | null) {
  return useQuery({
    queryKey: operationsKeys.reconciliationNotes(caseId ?? ""),
    enabled: !!caseId,
    queryFn: async (): Promise<ReconciliationCaseNote[]> => {
      const { data, error } = await supabase
        .from("v_reconciliation_case_note" as never)
        .select("*")
        .eq("reconciliation_case_id" as never, caseId!)
        .order("created_at" as never, { ascending: false })
        .limit(50);

      if (error) throw error;
      return ((data ?? []) as unknown as Record<string, unknown>[]).map(mapCaseNote);
    },
  });
}

export function useOperationsHealth() {
  return useQuery({
    queryKey: operationsKeys.health,
    queryFn: async (): Promise<OperationsHealthRow[]> => {
      const { data, error } = await supabase
        .from("v_subledger_operations_health" as never)
        .select("*");

      if (error) throw error;
      return ((data ?? []) as unknown as Record<string, unknown>[])
        .filter((row) => row.area !== "settlement_close")
        .map(mapHealth);
    },
  });
}

export function useSubledgerJobRuns() {
  return useQuery({
    queryKey: operationsKeys.jobRuns,
    queryFn: async (): Promise<SubledgerJobRunRow[]> => {
      const { data, error } = await supabase
        .from("v_subledger_job_run" as never)
        .select("*")
        .order("occurred_at" as never, { ascending: false })
        .limit(20);

      if (error) throw error;
      return ((data ?? []) as unknown as Record<string, unknown>[]).map(mapJobRun);
    },
  });
}

export function usePostingIntents() {
  return useQuery({
    queryKey: operationsKeys.postingIntents,
    queryFn: async (): Promise<PostingIntentRow[]> => {
      const { data, error } = await supabase
        .from("v_posting_intent_with_references" as never)
        .select("*")
        .eq("target_system" as never, "qbo")
        .order("created_at" as never, { ascending: false })
        .limit(100);

      if (error) throw error;
      return ((data ?? []) as unknown as Record<string, unknown>[]).map(mapPostingIntent);
    },
  });
}

export function useListingCommands() {
  return useQuery({
    queryKey: operationsKeys.listingCommands,
    queryFn: async (): Promise<ListingCommandRow[]> => {
      const { data, error } = await supabase
        .from("v_outbound_command_with_references" as never)
        .select("*")
        .eq("entity_type" as never, "channel_listing")
        .order("created_at" as never, { ascending: false })
        .limit(100);

      if (error) throw error;
      return ((data ?? []) as unknown as Record<string, unknown>[]).map(mapListingCommand);
    },
  });
}

export function useRollingSettlementMonitor() {
  return useQuery({
    queryKey: operationsKeys.rollingSettlement,
    queryFn: async (): Promise<RollingSettlementRow[]> => {
      const { data, error } = await supabase
        .from("v_rolling_settlement_monitor" as never)
        .select("*")
        .order("order_created_at" as never, { ascending: false })
        .limit(200);

      if (error) throw error;
      const cutoff = new Date("2026-04-27T00:00:00Z");
      return ((data ?? []) as unknown as Record<string, unknown>[])
        .map(mapRollingSettlement)
        .filter((row) => {
          const createdAt = new Date(row.orderCreatedAt);
          const channel = (row.originChannel ?? "").toLowerCase();
          const paidBeforeCutoff = (channel === "ebay" || channel === "stripe") && createdAt < cutoff;
          return !paidBeforeCutoff;
        });
    },
  });
}

export function useBlueBellOpenAccruals() {
  return useQuery({
    queryKey: operationsKeys.blueBellAccruals,
    queryFn: async (): Promise<BlueBellAccrualRow[]> => {
      const { data, error } = await supabase
        .from("v_blue_bell_accrual_ledger" as never)
        .select("*")
        .gt("commission_outstanding" as never, 0)
        .order("order_created_at" as never, { ascending: false })
        .limit(200);

      if (error) throw error;
      return ((data ?? []) as unknown as Record<string, unknown>[]).map(mapBlueBellAccrual);
    },
  });
}

export function useUpdateReconciliationCaseStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      status,
      note,
      evidence,
    }: {
      id: string;
      status: "open" | "resolved" | "ignored" | "in_progress";
      note?: string | null;
      evidence?: Record<string, unknown>;
    }) => {
      const { data, error } = await supabase.rpc("update_reconciliation_case_workflow" as never, {
        p_case_id: id,
        p_status: status,
        p_note: note ?? null,
        p_evidence: evidence ?? {},
      } as never);
      if (error) throw error;
      return data as unknown as { success?: boolean };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: operationsKeys.issues });
      queryClient.invalidateQueries({ queryKey: operationsKeys.health });
      queryClient.invalidateQueries({ queryKey: operationsKeys.reconciliation });
    },
  });
}

export function useUpdateReconciliationCaseWorkflow() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, note, evidence }: { id: string; note?: string | null; evidence?: Record<string, unknown> }) => {
      const { data, error } = await supabase.rpc("update_reconciliation_case_workflow" as never, {
        p_case_id: id,
        p_note: note ?? null,
        p_evidence: evidence ?? {},
      } as never);

      if (error) throw error;
      return data as unknown as { success?: boolean };
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: operationsKeys.issues });
      queryClient.invalidateQueries({ queryKey: operationsKeys.health });
      queryClient.invalidateQueries({ queryKey: operationsKeys.reconciliation });
      queryClient.invalidateQueries({ queryKey: operationsKeys.reconciliationNotes(variables.id) });
    },
  });
}

export function useBulkUpdateReconciliationCases() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      ids,
      status,
      note,
      evidence,
    }: {
      ids: string[];
      status?: "open" | "resolved" | "ignored" | "in_progress" | null;
      note?: string | null;
      evidence?: Record<string, unknown>;
    }) => {
      const { data, error } = await supabase.rpc("bulk_update_reconciliation_case_workflow" as never, {
        p_case_ids: ids,
        p_status: status ?? null,
        p_note: note ?? null,
        p_evidence: evidence ?? {},
      } as never);

      if (error) throw error;
      return data as unknown as { updated?: number; errors?: Array<Record<string, unknown>> };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: operationsKeys.issues });
      queryClient.invalidateQueries({ queryKey: operationsKeys.health });
      queryClient.invalidateQueries({ queryKey: operationsKeys.reconciliation });
    },
  });
}

export function useResolveReconciliationCase() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, resolution, note }: { id: string; resolution: string; note?: string }) => {
      const { data, error } = await supabase.rpc("resolve_reconciliation_case" as never, {
        p_case_id: id,
        p_resolution: resolution,
        p_note: note ?? null,
      } as never);

      if (error) throw error;
      return data as unknown as { success?: boolean; action?: string };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: operationsKeys.issues });
      queryClient.invalidateQueries({ queryKey: operationsKeys.health });
      queryClient.invalidateQueries({ queryKey: operationsKeys.reconciliation });
      queryClient.invalidateQueries({ queryKey: operationsKeys.rollingSettlement });
      queryClient.invalidateQueries({ queryKey: operationsKeys.postingIntents });
    },
  });
}

export function useResolveOperationsIssue() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      action,
      note,
      evidence,
    }: {
      id: string;
      action?: string | null;
      note?: string | null;
      evidence?: Record<string, unknown>;
    }) => {
      const { data, error } = await supabase.rpc("resolve_operations_issue" as never, {
        p_issue_id: id,
        p_action: action ?? null,
        p_note: note ?? null,
        p_evidence: evidence ?? {},
      } as never);

      if (error) throw error;
      return data as unknown as {
        success?: boolean;
        issue_id?: string;
        issue_key?: string;
        action?: string;
        source_table?: string;
        source_id?: string | null;
      };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: operationsKeys.issues });
      queryClient.invalidateQueries({ queryKey: operationsKeys.health });
      queryClient.invalidateQueries({ queryKey: operationsKeys.reconciliation });
      queryClient.invalidateQueries({ queryKey: operationsKeys.rollingSettlement });
      queryClient.invalidateQueries({ queryKey: operationsKeys.postingIntents });
      queryClient.invalidateQueries({ queryKey: operationsKeys.listingCommands });
      queryClient.invalidateQueries({ queryKey: operationsKeys.blueBellAccruals });
    },
  });
}

export function useRefreshActualSettlements() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("refresh_actual_settlement_lines" as never, {
        p_sales_order_id: null,
        p_payout_id: null,
        p_rebuild_cases: true,
      } as never);

      if (error) throw error;
      return Number(data ?? 0);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: operationsKeys.issues });
      queryClient.invalidateQueries({ queryKey: operationsKeys.reconciliation });
      queryClient.invalidateQueries({ queryKey: operationsKeys.rollingSettlement });
      queryClient.invalidateQueries({ queryKey: operationsKeys.health });
    },
  });
}

export function useRunSubledgerScheduledJobs() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (job: ScheduledSubledgerJob = "all") => {
      const { data, error } = await supabase.functions.invoke("subledger-scheduled-jobs", {
        body: {
          job,
          batchSize: 25,
          marketLimit: 60,
        },
      });

      if (error) throw error;
      return data as {
        success?: boolean;
        requested_job?: ScheduledSubledgerJob;
        results?: Array<{ job?: string; success?: boolean; rows?: number; error?: string }>;
      };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: operationsKeys.issues });
      queryClient.invalidateQueries({ queryKey: operationsKeys.health });
      queryClient.invalidateQueries({ queryKey: operationsKeys.jobRuns });
      queryClient.invalidateQueries({ queryKey: operationsKeys.reconciliation });
      queryClient.invalidateQueries({ queryKey: operationsKeys.postingIntents });
      queryClient.invalidateQueries({ queryKey: operationsKeys.listingCommands });
      queryClient.invalidateQueries({ queryKey: operationsKeys.rollingSettlement });
      queryClient.invalidateQueries({ queryKey: operationsKeys.blueBellAccruals });
    },
  });
}

export function useRunPostingIntentNow() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (intentId: string) => {
      const { data, error } = await supabase.functions.invoke("accounting-posting-intents-process", {
        body: { intentId },
      });

      if (error) throw error;
      return data as { processed?: number; results?: unknown[] };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: operationsKeys.issues });
      queryClient.invalidateQueries({ queryKey: operationsKeys.health });
      queryClient.invalidateQueries({ queryKey: operationsKeys.postingIntents });
      queryClient.invalidateQueries({ queryKey: operationsKeys.reconciliation });
    },
  });
}

export function useRunListingCommandNow() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (commandId: string) => {
      const { data, error } = await supabase.functions.invoke("listing-command-process", {
        body: { commandId },
      });

      if (error) throw error;
      return data as { processed?: number; results?: unknown[] };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: operationsKeys.issues });
      queryClient.invalidateQueries({ queryKey: operationsKeys.health });
      queryClient.invalidateQueries({ queryKey: operationsKeys.listingCommands });
      queryClient.invalidateQueries({ queryKey: operationsKeys.reconciliation });
    },
  });
}

export function useRetryListingCommand() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.rpc("retry_listing_outbound_command" as never, {
        p_outbound_command_id: id,
      } as never);

      if (error) throw error;
      return data as unknown as string;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: operationsKeys.issues });
      queryClient.invalidateQueries({ queryKey: operationsKeys.health });
      queryClient.invalidateQueries({ queryKey: operationsKeys.listingCommands });
      queryClient.invalidateQueries({ queryKey: operationsKeys.reconciliation });
    },
  });
}

export function useCancelListingCommand() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.rpc("cancel_listing_outbound_command" as never, {
        p_outbound_command_id: id,
      } as never);

      if (error) throw error;
      return data as unknown as string;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: operationsKeys.issues });
      queryClient.invalidateQueries({ queryKey: operationsKeys.health });
      queryClient.invalidateQueries({ queryKey: operationsKeys.listingCommands });
      queryClient.invalidateQueries({ queryKey: operationsKeys.reconciliation });
    },
  });
}

export function useRetryPostingIntent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.rpc("retry_qbo_posting_intent" as never, {
        p_posting_intent_id: id,
      } as never);

      if (error) throw error;
      return data as unknown as string;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: operationsKeys.issues });
      queryClient.invalidateQueries({ queryKey: operationsKeys.health });
      queryClient.invalidateQueries({ queryKey: operationsKeys.postingIntents });
      queryClient.invalidateQueries({ queryKey: operationsKeys.reconciliation });
    },
  });
}

export function useCancelPostingIntent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.rpc("cancel_qbo_posting_intent" as never, {
        p_posting_intent_id: id,
      } as never);

      if (error) throw error;
      return data as unknown as string;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: operationsKeys.issues });
      queryClient.invalidateQueries({ queryKey: operationsKeys.health });
      queryClient.invalidateQueries({ queryKey: operationsKeys.postingIntents });
      queryClient.invalidateQueries({ queryKey: operationsKeys.reconciliation });
    },
  });
}

export function useRefreshReconciliationCases() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const { data: financeData, error: financeError } = await supabase.rpc("rebuild_reconciliation_cases" as never);
      if (financeError) throw financeError;

      const { data: listingData, error: listingError } = await supabase.rpc(
        "rebuild_listing_command_reconciliation_cases" as never,
      );
      if (listingError) throw listingError;

      return Number(financeData ?? 0) + Number(listingData ?? 0);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: operationsKeys.issues });
      queryClient.invalidateQueries({ queryKey: operationsKeys.health });
      queryClient.invalidateQueries({ queryKey: operationsKeys.reconciliation });
      queryClient.invalidateQueries({ queryKey: operationsKeys.rollingSettlement });
    },
  });
}

export function useCreateBlueBellSettlement() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ accrualIds }: { accrualIds: string[] }) => {
      const { data, error } = await supabase.rpc("settle_sales_program_accruals" as never, {
        p_program_code: "blue_bell",
        p_accrual_ids: accrualIds,
        p_notes: "Created from Operations rolling accrual ledger",
      } as never);

      if (error) throw error;
      return data as unknown as string;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: operationsKeys.issues });
      queryClient.invalidateQueries({ queryKey: operationsKeys.health });
      queryClient.invalidateQueries({ queryKey: operationsKeys.blueBellAccruals });
      queryClient.invalidateQueries({ queryKey: operationsKeys.reconciliation });
    },
  });
}

export function useOperationsExport() {
  return useMutation({
    mutationFn: async (kind: OperationsExportKind) => {
      const config = exportConfig[kind];
      const { data, error } = await supabase
        .from(config.view as never)
        .select("*")
        .order(config.orderBy as never, { ascending: false })
        .limit(5000);

      if (error) throw error;
      const rows = (data ?? []) as unknown as Record<string, unknown>[];
      downloadCsv(config.filename, rows);
      return rows.length;
    },
  });
}
