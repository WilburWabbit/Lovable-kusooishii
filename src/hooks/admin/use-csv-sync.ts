// ============================================================
// Admin V2 — CSV Sync Hooks
// React Query hooks for CSV export, stage, diff, apply, rollback, history.
// ============================================================

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { invokeWithAuth } from '@/lib/invokeWithAuth';
import type {
  CsvSyncSession,
  ChangesetRow,
  DiffResult,
  ApplyResult,
  RollbackResult,
  StageResult,
} from '@/lib/csv-sync/types';

// ─── Query Keys ─────────────────────────────────────────────

export const csvSyncKeys = {
  all: ['v2', 'csv-sync'] as const,
  sessions: (tableName?: string) =>
    ['v2', 'csv-sync', 'sessions', tableName] as const,
  session: (sessionId: string) =>
    ['v2', 'csv-sync', 'session', sessionId] as const,
};

// ─── Row Mapper ─────────────────────────────────────────────

function mapSession(row: Record<string, unknown>): CsvSyncSession {
  return {
    id: row.id as string,
    tableName: row.table_name as string,
    filename: row.filename as string,
    rowCount: row.row_count as number,
    insertCount: row.insert_count as number,
    updateCount: row.update_count as number,
    deleteCount: row.delete_count as number,
    warningCount: row.warning_count as number,
    errorCount: row.error_count as number,
    status: row.status as CsvSyncSession['status'],
    errorMessage: (row.error_message as string) ?? null,
    changesetSummary: row.changeset_summary ?? null,
    performedBy: row.performed_by as string,
    createdAt: row.created_at as string,
    appliedAt: (row.applied_at as string) ?? null,
    rolledBackAt: (row.rolled_back_at as string) ?? null,
  };
}

// ─── Export ─────────────────────────────────────────────────

export function useCsvExport() {
  return useMutation({
    mutationFn: async ({
      tableName,
      filters,
    }: {
      tableName: string;
      filters?: Record<string, unknown>;
    }) => {
      const result = await invokeWithAuth<{
        rows: Record<string, unknown>[];
        tableName: string;
      }>('csv-sync', { action: 'export', tableName, filters });
      return result;
    },
  });
}

// ─── Stage ──────────────────────────────────────────────────

export function useCsvStage() {
  return useMutation({
    mutationFn: async ({
      tableName,
      filename,
      rows,
    }: {
      tableName: string;
      filename: string;
      rows: Record<string, string>[];
    }) => {
      return invokeWithAuth<StageResult>('csv-sync', {
        action: 'stage',
        tableName,
        filename,
        rows,
      });
    },
  });
}

// ─── Diff ───────────────────────────────────────────────────

export function useCsvDiff() {
  return useMutation({
    mutationFn: async ({ sessionId }: { sessionId: string }) => {
      return invokeWithAuth<DiffResult>('csv-sync', {
        action: 'diff',
        sessionId,
      });
    },
  });
}

// ─── Apply ──────────────────────────────────────────────────

export function useCsvApply() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ sessionId }: { sessionId: string }) => {
      return invokeWithAuth<ApplyResult>('csv-sync', {
        action: 'apply',
        sessionId,
      });
    },
    onSuccess: () => {
      // Invalidate sync history + all entity caches
      qc.invalidateQueries({ queryKey: csvSyncKeys.all });
      // Broad invalidation of v2 entity queries so lists refresh
      qc.invalidateQueries({ queryKey: ['v2'] });
    },
  });
}

// ─── Rollback ───────────────────────────────────────────────

export function useCsvRollback() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ sessionId }: { sessionId: string }) => {
      return invokeWithAuth<RollbackResult>('csv-sync', {
        action: 'rollback',
        sessionId,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: csvSyncKeys.all });
      qc.invalidateQueries({ queryKey: ['v2'] });
    },
  });
}

// ─── History ────────────────────────────────────────────────

export function useSyncHistory(tableName?: string) {
  return useQuery({
    queryKey: csvSyncKeys.sessions(tableName),
    queryFn: async () => {
      const result = await invokeWithAuth<{
        sessions: Record<string, unknown>[];
      }>('csv-sync', { action: 'history', tableName });
      return (result.sessions ?? []).map(mapSession);
    },
  });
}

// ─── Session Detail (changeset) ─────────────────────────────

export function useSessionChangeset(sessionId: string | null) {
  return useQuery({
    queryKey: csvSyncKeys.session(sessionId ?? ''),
    enabled: !!sessionId,
    queryFn: async () => {
      const result = await invokeWithAuth<{
        session: Record<string, unknown>;
        changeset: ChangesetRow[];
      }>('csv-sync', { action: 'get-changeset', sessionId });
      return {
        session: mapSession(result.session),
        changeset: result.changeset,
      };
    },
  });
}
