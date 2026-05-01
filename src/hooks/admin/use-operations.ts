import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const operationsKeys = {
  all: ["v2", "operations"] as const,
  reconciliation: ["v2", "operations", "reconciliation"] as const,
  reconciliationNotes: (caseId: string) => ["v2", "operations", "reconciliation", caseId, "notes"] as const,
  owners: ["v2", "operations", "owners"] as const,
  closeoutHealth: ["v2", "operations", "closeout-health"] as const,
  jobRuns: ["v2", "operations", "job-runs"] as const,
  postingIntents: ["v2", "operations", "posting-intents"] as const,
  listingCommands: ["v2", "operations", "listing-commands"] as const,
  settlementPeriodClose: ["v2", "operations", "settlement-period-close"] as const,
  blueBellStatement: ["v2", "operations", "blue-bell-statement"] as const,
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
  ownerId: string | null;
  ownerName: string | null;
  suspectedRootCause: string | null;
  recommendedAction: string | null;
  diagnosis: string | null;
  nextStep: string | null;
  evidence: Record<string, unknown>;
  requiresEvidence: boolean;
  noteCount: number;
  latestNoteAt: string | null;
  latestNote: string | null;
  slaStatus: string;
  amountExpected: number | null;
  amountActual: number | null;
  varianceAmount: number | null;
  dueAt: string | null;
  createdAt: string;
  updatedAt: string;
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
  createdAt: string;
  updatedAt: string;
}

export interface BlueBellStatementRow {
  periodStart: string;
  periodEnd: string;
  qualifyingOrderCount: number;
  basisAmount: number;
  discountAmount: number;
  commissionAccrued: number;
  commissionReversed: number;
  commissionSettled: number;
  commissionOutstanding: number;
}

export interface BlueBellAccrualRow {
  id: string;
  salesOrderId: string;
  orderNumber: string | null;
  status: string;
  basisAmount: number;
  discountAmount: number;
  commissionAmount: number;
  reversedAmount: number;
  settlementId: string | null;
  createdAt: string;
}

export interface SettlementPeriodCloseRow {
  periodStart: string;
  periodEnd: string;
  channelCount: number;
  orderCount: number;
  expectedTotal: number;
  actualTotal: number;
  varianceAmount: number;
  payoutCount: number;
  unreconciledPayoutCount: number;
  openCaseCount: number;
  missingPayoutCaseCount: number;
  amountMismatchCaseCount: number;
  closeStatus: string;
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

export interface ReconciliationCaseOwner {
  userId: string;
  displayName: string;
  roles: string[];
}

export interface SubledgerCloseoutHealthRow {
  area: string;
  healthStatus: string;
  severity: string;
  openCount: number;
  failedCount: number;
  pendingCount: number;
  overdueCount: number;
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
  ownerId: (row.owner_id as string | null) ?? null,
  ownerName: (row.owner_name as string | null) ?? null,
  suspectedRootCause: (row.suspected_root_cause as string | null) ?? null,
  recommendedAction: (row.recommended_action as string | null) ?? null,
  diagnosis: (row.diagnosis as string | null) ?? null,
  nextStep: (row.next_step as string | null) ?? null,
  evidence: ((row.evidence as Record<string, unknown> | null) ?? {}),
  requiresEvidence: Boolean(row.requires_evidence ?? false),
  noteCount: Number(row.note_count ?? 0),
  latestNoteAt: (row.latest_note_at as string | null) ?? null,
  latestNote: (row.latest_note as string | null) ?? null,
  slaStatus: (row.sla_status as string | null) ?? "no_due_date",
  amountExpected: row.amount_expected == null ? null : Number(row.amount_expected),
  amountActual: row.amount_actual == null ? null : Number(row.amount_actual),
  varianceAmount: row.variance_amount == null ? null : Number(row.variance_amount),
  dueAt: (row.due_at as string | null) ?? null,
  createdAt: row.created_at as string,
  updatedAt: row.updated_at as string,
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

const mapCaseOwner = (row: Record<string, unknown>): ReconciliationCaseOwner => ({
  userId: row.user_id as string,
  displayName: (row.display_name as string) ?? "Unnamed user",
  roles: Array.isArray(row.roles) ? (row.roles as string[]) : [],
});

const mapCloseoutHealth = (row: Record<string, unknown>): SubledgerCloseoutHealthRow => ({
  area: row.area as string,
  healthStatus: row.health_status as string,
  severity: row.severity as string,
  openCount: Number(row.open_count ?? 0),
  failedCount: Number(row.failed_count ?? 0),
  pendingCount: Number(row.pending_count ?? 0),
  overdueCount: Number(row.overdue_count ?? 0),
  lastSuccessAt: (row.last_success_at as string | null) ?? null,
  lastFailureAt: (row.last_failure_at as string | null) ?? null,
  oldestPendingAt: (row.oldest_pending_at as string | null) ?? null,
  recommendation: (row.recommendation as string | null) ?? "Review this area.",
});

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

type OperationsExportKind =
  | "settlement-close"
  | "blue-bell-statement"
  | "reconciliation-cases"
  | "margin-profit";

const exportConfig: Record<OperationsExportKind, { view: string; filename: string; orderBy: string }> = {
  "settlement-close": {
    view: "v_settlement_close_export",
    filename: "settlement-close-export",
    orderBy: "period_start",
  },
  "blue-bell-statement": {
    view: "v_blue_bell_monthly_statement_export",
    filename: "blue-bell-monthly-statement",
    orderBy: "period_start",
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
  createdAt: row.created_at as string,
  updatedAt: row.updated_at as string,
});

const mapBlueBellStatement = (row: Record<string, unknown>): BlueBellStatementRow => ({
  periodStart: row.period_start as string,
  periodEnd: row.period_end as string,
  qualifyingOrderCount: Number(row.qualifying_order_count ?? 0),
  basisAmount: Number(row.basis_amount ?? 0),
  discountAmount: Number(row.discount_amount ?? 0),
  commissionAccrued: Number(row.commission_accrued ?? 0),
  commissionReversed: Number(row.commission_reversed ?? 0),
  commissionSettled: Number(row.commission_settled ?? 0),
  commissionOutstanding: Number(row.commission_outstanding ?? 0),
});

const mapBlueBellAccrual = (row: Record<string, unknown>): BlueBellAccrualRow => {
  const order = row.sales_order as Record<string, unknown> | null;

  return {
    id: row.id as string,
    salesOrderId: row.sales_order_id as string,
    orderNumber: (order?.order_number as string | null) ?? null,
    status: row.status as string,
    basisAmount: Number(row.basis_amount ?? 0),
    discountAmount: Number(row.discount_amount ?? 0),
    commissionAmount: Number(row.commission_amount ?? 0),
    reversedAmount: Number(row.reversed_amount ?? 0),
    settlementId: (row.settlement_id as string | null) ?? null,
    createdAt: row.created_at as string,
  };
};

const mapSettlementPeriodClose = (row: Record<string, unknown>): SettlementPeriodCloseRow => ({
  periodStart: row.period_start as string,
  periodEnd: row.period_end as string,
  channelCount: Number(row.channel_count ?? 0),
  orderCount: Number(row.order_count ?? 0),
  expectedTotal: Number(row.expected_total ?? 0),
  actualTotal: Number(row.actual_total ?? 0),
  varianceAmount: Number(row.variance_amount ?? 0),
  payoutCount: Number(row.payout_count ?? 0),
  unreconciledPayoutCount: Number(row.unreconciled_payout_count ?? 0),
  openCaseCount: Number(row.open_case_count ?? 0),
  missingPayoutCaseCount: Number(row.missing_payout_case_count ?? 0),
  amountMismatchCaseCount: Number(row.amount_mismatch_case_count ?? 0),
  closeStatus: row.close_status as string,
});

export function useReconciliationInbox() {
  return useQuery({
    queryKey: operationsKeys.reconciliation,
    queryFn: async (): Promise<ReconciliationInboxCase[]> => {
      const { data, error } = await supabase
        .from("v_reconciliation_inbox" as never)
        .select("*")
        .limit(250);

      if (error) throw error;
      return ((data ?? []) as unknown as Record<string, unknown>[]).map(mapCase);
    },
  });
}

export function useReconciliationCaseOwners() {
  return useQuery({
    queryKey: operationsKeys.owners,
    queryFn: async (): Promise<ReconciliationCaseOwner[]> => {
      const { data, error } = await supabase
        .from("v_reconciliation_case_owner" as never)
        .select("*")
        .order("display_name" as never, { ascending: true });

      if (error) throw error;
      return ((data ?? []) as unknown as Record<string, unknown>[]).map(mapCaseOwner);
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

export function useSubledgerCloseoutHealth() {
  return useQuery({
    queryKey: operationsKeys.closeoutHealth,
    queryFn: async (): Promise<SubledgerCloseoutHealthRow[]> => {
      const { data, error } = await supabase
        .from("v_subledger_operations_health" as never)
        .select("*");

      if (error) throw error;
      return ((data ?? []) as unknown as Record<string, unknown>[]).map(mapCloseoutHealth);
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
        .from("posting_intent" as never)
        .select("id,target_system,action,entity_type,entity_id,status,retry_count,last_error,next_attempt_at,qbo_reference_id,created_at,updated_at,posted_at")
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
        .from("outbound_command" as never)
        .select("id,target_system,command_type,entity_type,entity_id,status,retry_count,last_error,next_attempt_at,sent_at,created_at,updated_at")
        .eq("entity_type" as never, "channel_listing")
        .order("created_at" as never, { ascending: false })
        .limit(100);

      if (error) throw error;
      return ((data ?? []) as unknown as Record<string, unknown>[]).map(mapListingCommand);
    },
  });
}

export function useBlueBellStatement() {
  return useQuery({
    queryKey: operationsKeys.blueBellStatement,
    queryFn: async (): Promise<BlueBellStatementRow[]> => {
      const { data, error } = await supabase
        .from("v_blue_bell_statement" as never)
        .select("*")
        .order("period_start" as never, { ascending: false })
        .limit(24);

      if (error) throw error;
      return ((data ?? []) as unknown as Record<string, unknown>[]).map(mapBlueBellStatement);
    },
  });
}

export function useBlueBellOpenAccruals() {
  return useQuery({
    queryKey: operationsKeys.blueBellAccruals,
    queryFn: async (): Promise<BlueBellAccrualRow[]> => {
      const { data: program, error: programError } = await supabase
        .from("sales_program" as never)
        .select("id")
        .eq("program_code" as never, "blue_bell")
        .maybeSingle();

      if (programError) throw programError;
      const programId = (program as unknown as Record<string, unknown> | null)?.id as string | undefined;
      if (!programId) return [];

      const { data, error } = await supabase
        .from("sales_program_accrual" as never)
        .select(`
          id,
          sales_order_id,
          status,
          basis_amount,
          discount_amount,
          commission_amount,
          reversed_amount,
          settlement_id,
          created_at,
          sales_order:sales_order_id(order_number)
        `)
        .eq("sales_program_id" as never, programId)
        .in("status" as never, ["open", "partially_settled"])
        .order("created_at" as never, { ascending: false })
        .limit(100);

      if (error) throw error;
      return ((data ?? []) as unknown as Record<string, unknown>[]).map(mapBlueBellAccrual);
    },
  });
}

export function useSettlementPeriodClose() {
  return useQuery({
    queryKey: operationsKeys.settlementPeriodClose,
    queryFn: async (): Promise<SettlementPeriodCloseRow[]> => {
      const { data, error } = await supabase
        .from("v_settlement_period_close" as never)
        .select("*")
        .order("period_start" as never, { ascending: false })
        .limit(18);

      if (error) throw error;
      return ((data ?? []) as unknown as Record<string, unknown>[]).map(mapSettlementPeriodClose);
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
      queryClient.invalidateQueries({ queryKey: operationsKeys.closeoutHealth });
      queryClient.invalidateQueries({ queryKey: operationsKeys.reconciliation });
    },
  });
}

export function useUpdateReconciliationCaseWorkflow() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      status,
      ownerId,
      dueAt,
      note,
      evidence,
      clearOwner,
      clearDueAt,
    }: {
      id: string;
      status?: "open" | "resolved" | "ignored" | "in_progress" | null;
      ownerId?: string | null;
      dueAt?: string | null;
      note?: string | null;
      evidence?: Record<string, unknown>;
      clearOwner?: boolean;
      clearDueAt?: boolean;
    }) => {
      const { data, error } = await supabase.rpc("update_reconciliation_case_workflow" as never, {
        p_case_id: id,
        p_status: status ?? null,
        p_owner_id: ownerId ?? null,
        p_due_at: dueAt ?? null,
        p_note: note ?? null,
        p_evidence: evidence ?? {},
        p_clear_owner: !!clearOwner,
        p_clear_due_at: !!clearDueAt,
      } as never);

      if (error) throw error;
      return data as unknown as { success?: boolean };
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: operationsKeys.closeoutHealth });
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
      ownerId,
      dueAt,
      note,
      evidence,
      clearOwner,
      clearDueAt,
    }: {
      ids: string[];
      status?: "open" | "resolved" | "ignored" | "in_progress" | null;
      ownerId?: string | null;
      dueAt?: string | null;
      note?: string | null;
      evidence?: Record<string, unknown>;
      clearOwner?: boolean;
      clearDueAt?: boolean;
    }) => {
      const { data, error } = await supabase.rpc("bulk_update_reconciliation_case_workflow" as never, {
        p_case_ids: ids,
        p_status: status ?? null,
        p_owner_id: ownerId ?? null,
        p_due_at: dueAt ?? null,
        p_note: note ?? null,
        p_evidence: evidence ?? {},
        p_clear_owner: !!clearOwner,
        p_clear_due_at: !!clearDueAt,
      } as never);

      if (error) throw error;
      return data as unknown as { updated?: number; errors?: Array<Record<string, unknown>> };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: operationsKeys.closeoutHealth });
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
      queryClient.invalidateQueries({ queryKey: operationsKeys.closeoutHealth });
      queryClient.invalidateQueries({ queryKey: operationsKeys.reconciliation });
      queryClient.invalidateQueries({ queryKey: operationsKeys.settlementPeriodClose });
      queryClient.invalidateQueries({ queryKey: operationsKeys.postingIntents });
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
      queryClient.invalidateQueries({ queryKey: operationsKeys.reconciliation });
      queryClient.invalidateQueries({ queryKey: operationsKeys.settlementPeriodClose });
    },
  });
}

export function useRunPostingIntentProcessor() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("accounting-posting-intents-process", {
        body: { batchSize: 25 },
      });

      if (error) throw error;
      return data as { processed?: number; results?: unknown[] };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: operationsKeys.closeoutHealth });
      queryClient.invalidateQueries({ queryKey: operationsKeys.postingIntents });
      queryClient.invalidateQueries({ queryKey: operationsKeys.reconciliation });
      queryClient.invalidateQueries({ queryKey: operationsKeys.settlementPeriodClose });
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
      queryClient.invalidateQueries({ queryKey: operationsKeys.closeoutHealth });
      queryClient.invalidateQueries({ queryKey: operationsKeys.jobRuns });
      queryClient.invalidateQueries({ queryKey: operationsKeys.reconciliation });
      queryClient.invalidateQueries({ queryKey: operationsKeys.postingIntents });
      queryClient.invalidateQueries({ queryKey: operationsKeys.listingCommands });
      queryClient.invalidateQueries({ queryKey: operationsKeys.settlementPeriodClose });
      queryClient.invalidateQueries({ queryKey: operationsKeys.blueBellStatement });
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
      queryClient.invalidateQueries({ queryKey: operationsKeys.closeoutHealth });
      queryClient.invalidateQueries({ queryKey: operationsKeys.postingIntents });
      queryClient.invalidateQueries({ queryKey: operationsKeys.reconciliation });
    },
  });
}

export function useRunListingCommandProcessor() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("listing-command-process", {
        body: { batchSize: 25 },
      });

      if (error) throw error;
      return data as { processed?: number; results?: unknown[] };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: operationsKeys.closeoutHealth });
      queryClient.invalidateQueries({ queryKey: operationsKeys.listingCommands });
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
      queryClient.invalidateQueries({ queryKey: operationsKeys.closeoutHealth });
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
      queryClient.invalidateQueries({ queryKey: operationsKeys.closeoutHealth });
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
      queryClient.invalidateQueries({ queryKey: operationsKeys.closeoutHealth });
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
      queryClient.invalidateQueries({ queryKey: operationsKeys.closeoutHealth });
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
      queryClient.invalidateQueries({ queryKey: operationsKeys.closeoutHealth });
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
      queryClient.invalidateQueries({ queryKey: operationsKeys.closeoutHealth });
      queryClient.invalidateQueries({ queryKey: operationsKeys.reconciliation });
    },
  });
}

export function useCreateBlueBellSettlement() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ periodStart, periodEnd }: { periodStart: string; periodEnd: string }) => {
      const { data, error } = await supabase.rpc("create_sales_program_settlement" as never, {
        p_program_code: "blue_bell",
        p_period_start: periodStart,
        p_period_end: periodEnd,
        p_notes: "Created from Operations dashboard",
      } as never);

      if (error) throw error;
      return data as unknown as string;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: operationsKeys.closeoutHealth });
      queryClient.invalidateQueries({ queryKey: operationsKeys.blueBellStatement });
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
