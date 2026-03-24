// Main CSV Sync page — orchestrates the full export/upload/preview/apply workflow.

import { useState, useCallback } from 'react';
import { Download, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { SurfaceCard, SectionHead } from '@/components/admin-v2/ui-primitives';
import { getSyncableTableNames, getTableConfig, rowsToCsv, downloadCsv, makeExportFilename } from '@/lib/csv-sync';
import type { ChangesetRow, DiffResult } from '@/lib/csv-sync/types';
import {
  useCsvExport,
  useCsvStage,
  useCsvDiff,
  useCsvApply,
  useCsvRollback,
} from '@/hooks/admin/use-csv-sync';
import { CsvUploadZone } from './CsvUploadZone';
import { ChangesetPreview } from './ChangesetPreview';
import { SyncHistory } from './SyncHistory';

type Step = 'select' | 'upload' | 'preview' | 'done';

export function CsvSyncPage() {
  const [selectedTable, setSelectedTable] = useState('');
  const [step, setStep] = useState<Step>('select');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [changeset, setChangeset] = useState<ChangesetRow[]>([]);
  const [diffSummary, setDiffSummary] = useState<DiffResult | null>(null);

  const exportMutation = useCsvExport();
  const stageMutation = useCsvStage();
  const diffMutation = useCsvDiff();
  const applyMutation = useCsvApply();
  const rollbackMutation = useCsvRollback();

  const tables = getSyncableTableNames();

  // Reset to start
  const reset = useCallback(() => {
    setStep('select');
    setSessionId(null);
    setChangeset([]);
    setDiffSummary(null);
  }, []);

  // Handle table selection
  const handleSelectTable = (table: string) => {
    setSelectedTable(table);
    setStep('upload');
  };

  // Handle export
  const handleExport = async () => {
    if (!selectedTable) return;
    try {
      const result = await exportMutation.mutateAsync({ tableName: selectedTable });
      const rows = result.rows ?? [];
      const csv = rowsToCsv(selectedTable, rows);
      downloadCsv(csv, makeExportFilename(selectedTable));
      toast.success(rows.length > 0 ? `Exported ${rows.length} rows` : 'Exported template (headers only)');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Export failed');
    }
  };

  // Handle CSV upload → stage → diff
  const handleParsed = async (rows: Record<string, string>[], filename: string) => {
    try {
      // Stage
      const stageResult = await stageMutation.mutateAsync({
        tableName: selectedTable,
        filename,
        rows,
      });
      setSessionId(stageResult.sessionId);
      toast.success(`Staged ${stageResult.rowCount} rows`);

      // Diff
      const diffResult = await diffMutation.mutateAsync({
        sessionId: stageResult.sessionId,
      });
      setDiffSummary(diffResult);
      setChangeset(diffResult.changeset);
      setStep('preview');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    }
  };

  // Apply changeset
  const handleApply = async () => {
    if (!sessionId) return;
    try {
      const result = await applyMutation.mutateAsync({ sessionId });
      toast.success(
        `Applied: ${result.insertCount} inserts, ${result.updateCount} updates, ${result.deleteCount} deletes`,
      );
      setStep('done');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Apply failed');
    }
  };

  // Rollback
  const handleRollback = async (sid: string) => {
    try {
      const result = await rollbackMutation.mutateAsync({ sessionId: sid });
      toast.success(`Rolled back ${result.rowsReverted} changes`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Rollback failed');
    }
  };

  const isProcessing =
    stageMutation.isPending || diffMutation.isPending || exportMutation.isPending;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-zinc-100">Data Sync</h1>
          <p className="text-xs text-zinc-500 mt-1">
            Export, edit, and re-import CSV data across all tables
          </p>
        </div>
        {step !== 'select' && (
          <button
            onClick={reset}
            className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Start over
          </button>
        )}
      </div>

      {/* Step 1: Select table */}
      {step === 'select' && (
        <SurfaceCard>
          <SectionHead>Select a table to sync</SectionHead>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 mt-3">
            {tables.map((t) => {
              const config = getTableConfig(t);
              return (
                <button
                  key={t}
                  onClick={() => handleSelectTable(t)}
                  className="px-3 py-3 rounded border border-zinc-700/80 hover:border-amber-500/50 hover:bg-amber-500/5 text-left transition-colors group"
                >
                  <div className="text-sm text-zinc-200 font-medium group-hover:text-amber-500 transition-colors">
                    {config.displayName}
                  </div>
                  <div className="text-[10px] text-zinc-500 font-mono mt-0.5">{t}</div>
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {config.allowDelete ? (
                      <span className="inline-block px-1.5 py-px text-[9px] font-medium rounded bg-red-500/10 text-red-400 border border-red-500/20">
                        DELETE
                      </span>
                    ) : (
                      <span className="inline-block px-1.5 py-px text-[9px] font-medium rounded bg-zinc-700/50 text-zinc-500 border border-zinc-600/30">
                        NO DELETE
                      </span>
                    )}
                    {config.fkResolvers.length > 0 && (
                      <span className="inline-block px-1.5 py-px text-[9px] font-medium rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
                        {config.fkResolvers.length} FK{config.fkResolvers.length > 1 ? 's' : ''}
                      </span>
                    )}
                    {config.parentTable && (
                      <span className="inline-block px-1.5 py-px text-[9px] font-medium rounded bg-purple-500/10 text-purple-400 border border-purple-500/20">
                        child
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </SurfaceCard>
      )}

      {/* Step 2: Export or Upload */}
      {step === 'upload' && (
        <SurfaceCard>
          <SectionHead>{getTableConfig(selectedTable).displayName}</SectionHead>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
            {/* Export */}
            <div className="space-y-3">
              <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                Export current data
              </h3>
              <p className="text-xs text-zinc-500">
                Download the current table data as CSV for editing.
              </p>
              <button
                onClick={handleExport}
                disabled={exportMutation.isPending}
                className="flex items-center gap-2 px-4 py-2 rounded bg-zinc-800 border border-zinc-700 text-sm text-zinc-200 hover:bg-zinc-700 transition-colors"
              >
                <Download className="h-4 w-4" />
                {exportMutation.isPending ? 'Exporting...' : 'Export CSV'}
              </button>
            </div>

            {/* Upload */}
            <div className="space-y-3">
              <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                Upload edited CSV
              </h3>
              <p className="text-xs text-zinc-500">
                Upload a CSV to compare against the current data and preview changes.
              </p>
              <CsvUploadZone onParsed={handleParsed} disabled={isProcessing} />
              {isProcessing && (
                <p className="text-xs text-amber-500 animate-pulse">
                  Processing...
                </p>
              )}
            </div>
          </div>
        </SurfaceCard>
      )}

      {/* Step 3: Preview changeset */}
      {step === 'preview' && changeset.length > 0 && (
        <SurfaceCard>
          <SectionHead>
            Review changes — {getTableConfig(selectedTable).displayName}
          </SectionHead>
          <div className="mt-3">
            <ChangesetPreview
              changeset={changeset}
              onApply={handleApply}
              onCancel={reset}
              applying={applyMutation.isPending}
            />
          </div>
        </SurfaceCard>
      )}

      {step === 'preview' && changeset.length === 0 && (
        <SurfaceCard>
          <div className="py-8 text-center">
            <p className="text-sm text-zinc-400">No changes detected</p>
            <p className="text-xs text-zinc-600 mt-1">
              The uploaded CSV matches the current data exactly.
            </p>
          </div>
        </SurfaceCard>
      )}

      {/* Step 4: Done */}
      {step === 'done' && (
        <SurfaceCard>
          <div className="py-8 text-center space-y-3">
            <div className="text-2xl">&#10003;</div>
            <p className="text-sm text-green-400 font-medium">Changes applied successfully</p>
            {diffSummary && (
              <p className="text-xs text-zinc-500 font-mono">
                {diffSummary.inserts} inserts, {diffSummary.updates} updates, {diffSummary.deletes} deletes
              </p>
            )}
            <button
              onClick={reset}
              className="text-xs text-amber-500 hover:text-amber-400 transition-colors"
            >
              Start another sync
            </button>
          </div>
        </SurfaceCard>
      )}

      {/* History */}
      <SurfaceCard>
        <SectionHead>Sync History</SectionHead>
        <div className="mt-3">
          <SyncHistory
            tableName={selectedTable || undefined}
            onRollback={handleRollback}
          />
        </div>
      </SurfaceCard>
    </div>
  );
}
