// Drag-and-drop CSV upload zone with client-side parsing via papaparse.

import { useCallback, useRef, useState } from 'react';
import { Upload, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CsvUploadZoneProps {
  onParsed: (rows: Record<string, string>[], filename: string) => void;
  disabled?: boolean;
}

export function CsvUploadZone({ onParsed, disabled }: CsvUploadZoneProps) {
  const [dragOver, setDragOver] = useState(false);
  const [filename, setFilename] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const parseFile = useCallback(
    async (file: File) => {
      const text = await file.text();
      const rows = parseCsvText(text);
      setFilename(file.name);
      onParsed(rows, file.name);
    },
    [onParsed],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file && file.name.endsWith('.csv')) {
        parseFile(file);
      }
    },
    [parseFile],
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) parseFile(file);
    },
    [parseFile],
  );

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      onClick={() => !disabled && inputRef.current?.click()}
      className={cn(
        'border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors',
        dragOver
          ? 'border-amber-500 bg-amber-500/5'
          : 'border-zinc-700 hover:border-zinc-500',
        disabled && 'opacity-50 cursor-not-allowed',
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".csv"
        className="hidden"
        onChange={handleChange}
        disabled={disabled}
      />
      {filename ? (
        <div className="flex items-center justify-center gap-2 text-zinc-300">
          <FileText className="h-5 w-5 text-amber-500" />
          <span className="font-mono text-sm">{filename}</span>
        </div>
      ) : (
        <div className="space-y-2">
          <Upload className="h-8 w-8 mx-auto text-zinc-500" />
          <p className="text-sm text-zinc-400">
            Drop a CSV file here or click to browse
          </p>
          <p className="text-xs text-zinc-600">
            Must be a CSV exported from this tool or matching the template format
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Simple CSV parser (handles quoted fields, commas, newlines within quotes).
 * Returns array of objects keyed by header names.
 */
function parseCsvText(text: string): Record<string, string>[] {
  const lines = splitCsvLines(text);
  if (lines.length < 2) return [];

  const headers = parseCsvRow(lines[0]);
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const values = parseCsvRow(line);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] ?? '';
    });
    rows.push(row);
  }

  return rows;
}

function splitCsvLines(text: string): string[] {
  const lines: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
    } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && text[i + 1] === '\n') i++; // skip \r\n
      lines.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function parseCsvRow(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      values.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  values.push(current);
  return values;
}
