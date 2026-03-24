// Reusable CSV export button for embedding in list view toolbars.

import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCsvExport } from '@/hooks/admin/use-csv-sync';
import { rowsToCsv, downloadCsv, makeExportFilename } from '@/lib/csv-sync';
import { toast } from 'sonner';

interface ExportButtonProps {
  tableName: string;
  filters?: Record<string, unknown>;
  label?: string;
  variant?: 'outline' | 'ghost' | 'default';
  size?: 'sm' | 'default' | 'icon';
}

export function ExportButton({
  tableName,
  filters,
  label = 'Export CSV',
  variant = 'outline',
  size = 'sm',
}: ExportButtonProps) {
  const exportMutation = useCsvExport();

  const handleExport = async () => {
    try {
      const result = await exportMutation.mutateAsync({ tableName, filters });
      const rows = result.rows ?? [];
      const csv = rowsToCsv(tableName, rows);
      downloadCsv(csv, makeExportFilename(tableName));
      toast.success(rows.length > 0 ? `Exported ${rows.length} rows` : 'Exported template (headers only)');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Export failed');
    }
  };

  return (
    <Button
      variant={variant}
      size={size}
      onClick={handleExport}
      disabled={exportMutation.isPending}
      className="gap-1.5"
    >
      <Download className="h-3.5 w-3.5" />
      {exportMutation.isPending ? 'Exporting...' : label}
    </Button>
  );
}
