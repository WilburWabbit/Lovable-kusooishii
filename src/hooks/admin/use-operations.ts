import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const operationsKeys = {
  all: ["v2", "operations"] as const,
  reconciliation: ["v2", "operations", "reconciliation"] as const,
  postingIntents: ["v2", "operations", "posting-intents"] as const,
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
    },
  });
}
