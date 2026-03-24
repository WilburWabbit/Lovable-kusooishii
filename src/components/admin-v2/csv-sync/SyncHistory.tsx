// Sync history table showing past CSV sync sessions.

import { Badge } from '@/components/admin-v2/ui-primitives';
import { Mono } from '@/components/admin-v2/ui-primitives';
import { useSyncHistory } from '@/hooks/admin/use-csv-sync';
import type { CsvSyncSession } from '@/lib/csv-sync/types';

interface SyncHistoryProps {
  tableName?: string;
  onRollback?: (sessionId: string) => void;
}

const STATUS_COLORS: Record<string, string> = {
  staged: '#71717a',
  previewed: '#f59e0b',
  applied: '#22c55e',
  rolled_back: '#a855f7',
  error: '#ef4444',
};

export function SyncHistory({ tableName, onRollback }: SyncHistoryProps) {
  const { data: sessions, isLoading } = useSyncHistory(tableName);

  if (isLoading) {
    return <p className="text-xs text-zinc-500 py-4">Loading history...</p>;
  }

  if (!sessions || sessions.length === 0) {
    return <p className="text-xs text-zinc-500 py-4">No sync history yet</p>;
  }

  return (
    <div className="overflow-x-auto rounded border border-zinc-200">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-zinc-50">
            <th className="px-3 py-2 text-left text-zinc-500 font-medium">Date</th>
            <th className="px-3 py-2 text-left text-zinc-500 font-medium">Table</th>
            <th className="px-3 py-2 text-left text-zinc-500 font-medium">File</th>
            <th className="px-3 py-2 text-left text-zinc-500 font-medium">Status</th>
            <th className="px-3 py-2 text-right text-zinc-500 font-medium">Ins</th>
            <th className="px-3 py-2 text-right text-zinc-500 font-medium">Upd</th>
            <th className="px-3 py-2 text-right text-zinc-500 font-medium">Del</th>
            {onRollback && (
              <th className="px-3 py-2 text-right text-zinc-500 font-medium">Actions</th>
            )}
          </tr>
        </thead>
        <tbody>
          {sessions.map((s: CsvSyncSession) => (
            <tr key={s.id} className="border-t border-zinc-100">
              <td className="px-3 py-2 text-zinc-600">
                <Mono>{new Date(s.createdAt).toLocaleString()}</Mono>
              </td>
              <td className="px-3 py-2">
                <Mono color="amber">{s.tableName}</Mono>
              </td>
              <td className="px-3 py-2 text-zinc-600 max-w-[200px] truncate">
                {s.filename}
              </td>
              <td className="px-3 py-2">
                <Badge
                  label={s.status.replace('_', ' ')}
                  color={STATUS_COLORS[s.status] ?? '#71717a'}
                  small
                />
              </td>
              <td className="px-3 py-2 text-right">
                <Mono color="green">{s.insertCount || '-'}</Mono>
              </td>
              <td className="px-3 py-2 text-right">
                <Mono color="amber">{s.updateCount || '-'}</Mono>
              </td>
              <td className="px-3 py-2 text-right">
                <Mono color="red">{s.deleteCount || '-'}</Mono>
              </td>
              {onRollback && (
                <td className="px-3 py-2 text-right">
                  {s.status === 'applied' && (
                    <button
                      onClick={() => onRollback(s.id)}
                      className="text-xs text-red-500 hover:text-red-700 transition-colors"
                    >
                      Rollback
                    </button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
