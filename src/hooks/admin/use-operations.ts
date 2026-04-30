import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const operationsKeys = {
  all: ["v2", "operations"] as const,
  reconciliation: ["v2", "operations", "reconciliation"] as const,
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
  suspectedRootCause: string | null;
  recommendedAction: string | null;
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
  amountExpected: row.amount_expected == null ? null : Number(row.amount_expected),
  amountActual: row.amount_actual == null ? null : Number(row.amount_actual),
  varianceAmount: row.variance_amount == null ? null : Number(row.variance_amount),
  dueAt: (row.due_at as string | null) ?? null,
  createdAt: row.created_at as string,
  updatedAt: row.updated_at as string,
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
    mutationFn: async ({ id, status }: { id: string; status: "resolved" | "ignored" | "in_progress" }) => {
      const { error } = await supabase
        .from("reconciliation_case" as never)
        .update({
          status,
          close_code: status === "resolved" ? "resolved_from_operations_inbox" : status === "ignored" ? "ignored_from_operations_inbox" : null,
          closed_at: status === "resolved" || status === "ignored" ? new Date().toISOString() : null,
        } as never)
        .eq("id" as never, id);

      if (error) throw error;
    },
    onSuccess: () => {
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
      queryClient.invalidateQueries({ queryKey: operationsKeys.postingIntents });
      queryClient.invalidateQueries({ queryKey: operationsKeys.reconciliation });
      queryClient.invalidateQueries({ queryKey: operationsKeys.settlementPeriodClose });
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
      queryClient.invalidateQueries({ queryKey: operationsKeys.blueBellStatement });
      queryClient.invalidateQueries({ queryKey: operationsKeys.blueBellAccruals });
      queryClient.invalidateQueries({ queryKey: operationsKeys.reconciliation });
    },
  });
}
