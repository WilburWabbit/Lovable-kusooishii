// ============================================================
// CSV Sync — Utility Functions
// CSV generation from data rows, download trigger, parsing helpers.
// ============================================================

import { getTableConfig } from './table-registry';

/**
 * Convert an array of DB rows into a CSV string using the table's column config.
 * Includes all columns (editable, readonly, fk) in the defined order.
 */
export function rowsToCsv(
  tableName: string,
  rows: Record<string, unknown>[],
): string {
  const config = getTableConfig(tableName);
  const headers = config.columns.map(c => c.csvHeader);

  const lines: string[] = [headers.join(',')];

  for (const row of rows) {
    const values = config.columns.map(col => {
      const val = row[col.dbColumn];
      return formatCsvValue(val, col.type);
    });
    lines.push(values.join(','));
  }

  return lines.join('\n');
}

/**
 * Format a single value for CSV output.
 */
function formatCsvValue(val: unknown, type: string): string {
  if (val === null || val === undefined || val === '') return '';

  if (type === 'json') {
    const str = typeof val === 'string' ? val : JSON.stringify(val);
    return `"${str.replace(/"/g, '""')}"`;
  }

  const str = String(val);
  // Quote strings that contain commas, quotes, or newlines
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Trigger a browser download of a CSV string.
 */
export function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Coerce a CSV string value to the expected type for staging.
 * Returns the coerced value or throws on invalid input.
 */
export function coerceValue(
  value: string,
  type: string,
): unknown {
  if (value === '' || value === undefined || value === null) return null;

  switch (type) {
    case 'number': {
      const n = Number(value);
      if (isNaN(n)) throw new Error(`Invalid number: "${value}"`);
      return n;
    }
    case 'boolean': {
      const lower = value.toLowerCase().trim();
      if (lower === 'true' || lower === '1' || lower === 'yes') return true;
      if (lower === 'false' || lower === '0' || lower === 'no' || lower === '') return false;
      throw new Error(`Invalid boolean: "${value}"`);
    }
    case 'json': {
      try {
        return JSON.parse(value);
      } catch {
        throw new Error(`Invalid JSON: "${value}"`);
      }
    }
    case 'date':
      // Accept ISO strings as-is; basic validation
      if (value && isNaN(Date.parse(value))) {
        throw new Error(`Invalid date: "${value}"`);
      }
      return value;
    case 'enum':
    case 'string':
    default:
      return value;
  }
}

/**
 * Generate a filename for CSV export.
 */
export function makeExportFilename(tableName: string): string {
  const date = new Date().toISOString().slice(0, 10);
  return `${tableName}_export_${date}.csv`;
}
