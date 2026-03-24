// Changeset preview table: shows inserts, updates, deletes with colour coding.

import { useState } from 'react';
import { cn } from '@/lib/utils';
import type { ChangesetRow, ChangesetAction } from '@/lib/csv-sync/types';
import { Badge } from '@/components/admin-v2/ui-primitives';

type FilterTab = 'all' | 'insert' | 'update' | 'delete' | 'errors';

interface ChangesetPreviewProps {
  changeset: ChangesetRow[];
  onApply: () => void;
  onCancel: () => void;
  applying: boolean;
  readOnly?: boolean;
}

const ACTION_COLORS: Record<ChangesetAction, string> = {
  insert: '#22c55e',
  update: '#f59e0b',
  delete: '#ef4444',
};

const ACTION_LABELS: Record<ChangesetAction, string> = {
  insert: 'INSERT',
  update: 'UPDATE',
  delete: 'DELETE',
};

export function ChangesetPreview({
  changeset,
  onApply,
  onCancel,
  applying,
  readOnly,
}: ChangesetPreviewProps) {
  const [filter, setFilter] = useState<FilterTab>('all');

  const inserts = changeset.filter((c) => c.action === 'insert');
  const updates = changeset.filter((c) => c.action === 'update');
  const deletes = changeset.filter((c) => c.action === 'delete');
  const errors = changeset.filter((c) => c.errors.length > 0);

  const filtered =
    filter === 'all'
      ? changeset
      : filter === 'errors'
        ? errors
        : changeset.filter((c) => c.action === filter);

  const hasErrors = errors.length > 0;

  // Collect all unique field names for the table headers
  const allFields = new Set<string>();
  for (const row of changeset) {
    if (row.afterData) Object.keys(row.afterData).forEach((k) => allFields.add(k));
    if (row.beforeData) Object.keys(row.beforeData).forEach((k) => allFields.add(k));
  }
  // Show changed fields first, then the rest
  const changedFieldSet = new Set<string>();
  for (const row of changeset) {
    row.changedFields.forEach((f) => changedFieldSet.add(f));
  }
  const sortedFields = [
    ...Array.from(changedFieldSet),
    ...Array.from(allFields).filter((f) => !changedFieldSet.has(f)),
  ].slice(0, 12); // Limit columns shown

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="flex items-center gap-3 text-xs">
        <span className="text-green-600 font-mono">{inserts.length} inserts</span>
        <span className="text-amber-600 font-mono">{updates.length} updates</span>
        <span className="text-red-600 font-mono">{deletes.length} deletes</span>
        {errors.length > 0 && (
          <span className="text-red-500 font-mono">{errors.length} errors</span>
        )}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 border-b border-zinc-200">
        {(
          [
            ['all', `All (${changeset.length})`],
            ['insert', `Inserts (${inserts.length})`],
            ['update', `Updates (${updates.length})`],
            ['delete', `Deletes (${deletes.length})`],
            ['errors', `Errors (${errors.length})`],
          ] as [FilterTab, string][]
        ).map(([tab, label]) => (
          <button
            key={tab}
            onClick={() => setFilter(tab)}
            className={cn(
              'px-3 py-2 text-xs transition-colors border-b-2 -mb-px',
              filter === tab
                ? 'border-amber-500 text-zinc-900'
                : 'border-transparent text-zinc-500 hover:text-zinc-700',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded border border-zinc-200">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-zinc-50">
              <th className="px-3 py-2 text-left text-zinc-500 font-medium w-20">Action</th>
              <th className="px-3 py-2 text-left text-zinc-500 font-medium w-28">ID</th>
              {sortedFields.map((f) => (
                <th
                  key={f}
                  className={cn(
                    'px-3 py-2 text-left font-medium',
                    changedFieldSet.has(f) ? 'text-amber-600' : 'text-zinc-500',
                  )}
                >
                  {f}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((row, i) => (
              <tr
                key={row.id || i}
                className={cn(
                  'border-t border-zinc-100',
                  row.action === 'insert' && 'bg-green-50/60',
                  row.action === 'update' && 'bg-amber-50/60',
                  row.action === 'delete' && 'bg-red-50/60',
                  row.errors.length > 0 && 'ring-1 ring-inset ring-red-300',
                )}
              >
                <td className="px-3 py-2">
                  <Badge label={ACTION_LABELS[row.action]} color={ACTION_COLORS[row.action]} small />
                </td>
                <td className="px-3 py-2 font-mono text-zinc-500">
                  {row.rowId ? row.rowId.slice(0, 8) : 'new'}
                </td>
                {sortedFields.map((f) => {
                  const isChanged = row.changedFields.includes(f);
                  const before = row.beforeData?.[f];
                  const after = row.afterData?.[f];
                  const display = row.action === 'delete' ? before : after;
                  return (
                    <td key={f} className="px-3 py-2 max-w-[200px] truncate">
                      {isChanged && row.action === 'update' ? (
                        <span>
                          <span className="text-red-500 line-through mr-1">
                            {formatCell(before)}
                          </span>
                          <span className="text-green-600">{formatCell(after)}</span>
                        </span>
                      ) : (
                        <span className="text-zinc-600">{formatCell(display)}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td
                  colSpan={sortedFields.length + 2}
                  className="px-3 py-8 text-center text-zinc-500"
                >
                  No changes in this category
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Error details */}
      {errors.length > 0 && (
        <div className="rounded border border-red-200 bg-red-50 p-3 space-y-1">
          <p className="text-xs font-semibold text-red-700">
            Errors must be fixed before applying:
          </p>
          {errors.map((e, i) => (
            <p key={i} className="text-xs text-red-600 font-mono">
              Row {e.rowId ?? 'new'}: {e.errors.join(', ')}
            </p>
          ))}
        </div>
      )}

      {/* Actions */}
      {!readOnly && (
        <div className="flex gap-3 pt-2">
          <button
            onClick={onApply}
            disabled={hasErrors || applying}
            className={cn(
              'px-4 py-2 rounded text-sm font-medium transition-colors',
              hasErrors
                ? 'bg-zinc-200 text-zinc-400 cursor-not-allowed'
                : 'bg-amber-500 text-white hover:bg-amber-400',
            )}
          >
            {applying ? 'Applying...' : `Apply ${changeset.length} changes`}
          </button>
          <button
            onClick={onCancel}
            disabled={applying}
            className="px-4 py-2 rounded text-sm text-zinc-600 hover:text-zinc-900 border border-zinc-300 hover:border-zinc-400 transition-colors"
          >
            Cancel
          </button>
        </div>
      )}
      {readOnly && (
        <p className="text-xs text-zinc-500 pt-2">
          This session has already been {changeset.length > 0 ? 'applied' : 'processed'} — read only.
        </p>
      )}
    </div>
  );
}

function formatCell(val: unknown): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
}
