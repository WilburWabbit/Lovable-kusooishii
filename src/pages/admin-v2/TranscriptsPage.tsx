import { useMemo, useState } from "react";
import { Download, RefreshCw, MessageSquare } from "lucide-react";
import { AdminV2Layout } from "@/components/admin-v2/AdminV2Layout";
import { SurfaceCard, SectionHead, Mono } from "@/components/admin-v2/ui-primitives";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TableFilterInput } from "@/components/admin-v2/TableFilterInput";
import { SortableTableHead } from "@/components/admin/SortableTableHead";
import { useSimpleTableFilters } from "@/hooks/useSimpleTableFilters";
import {
  fetchAllTranscripts,
  type TranscriptRow,
} from "@/hooks/admin/use-transcripts";
import { useQuery } from "@tanstack/react-query";
import { downloadCsv } from "@/lib/csv-sync/csv-utils";
import { toast } from "sonner";

const ROLE_COLORS: Record<TranscriptRow["role"], string> = {
  user: "bg-blue-500/10 text-blue-600 border-blue-500/30",
  assistant: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  system: "bg-zinc-500/10 text-zinc-600 border-zinc-500/30",
  range: "bg-amber-500/10 text-amber-600 border-amber-500/30",
};

function escapeCsv(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

const CSV_COLUMNS: Array<{ key: keyof TranscriptRow; header: string }> = [
  { key: "message_index", header: "message_index" },
  { key: "message_index_end", header: "message_index_end" },
  { key: "role", header: "role" },
  { key: "occurred_at", header: "occurred_at" },
  { key: "source_file", header: "source_file" },
  { key: "part_number", header: "part_number" },
  { key: "title", header: "title" },
  { key: "token_count", header: "token_count" },
  { key: "char_count", header: "char_count" },
  { key: "body", header: "body" },
];

function rowsToCsv(rows: TranscriptRow[]): string {
  const head = CSV_COLUMNS.map((c) => c.header).join(",");
  const body = rows.map((r) => CSV_COLUMNS.map((c) => escapeCsv(r[c.key])).join(",")).join("\n");
  return head + "\n" + body;
}

function formatWhen(row: TranscriptRow): string {
  if (row.occurred_at) {
    try {
      return new Date(row.occurred_at).toLocaleString();
    } catch {
      return row.occurred_at;
    }
  }
  return "—";
}

function preview(body: string, n = 160): string {
  const trimmed = body.replace(/\s+/g, " ").trim();
  return trimmed.length > n ? trimmed.slice(0, n) + "…" : trimmed;
}

const PAGE_SIZE = 100;

// Accessor that exposes a unified "index" value (start of range) for sorting/filtering.
function accessor(row: TranscriptRow, key: string): unknown {
  switch (key) {
    case "when":
      return row.occurred_at ?? "";
    case "index_label":
      return row.message_index_end ?? row.message_index;
    case "title_preview":
      return row.title ?? row.body;
    default:
      return (row as unknown as Record<string, unknown>)[key];
  }
}

const COLUMNS: Array<{
  key: string;
  label: string;
  align?: "left" | "right" | "center";
  sortable?: boolean;
  width?: string;
}> = [
  { key: "when", label: "When", width: "w-[170px]" },
  { key: "part_number", label: "Part", width: "w-[60px]" },
  { key: "index_label", label: "#", width: "w-[90px]" },
  { key: "role", label: "Role", width: "w-[110px]" },
  { key: "title_preview", label: "Title / Preview" },
  { key: "source_file", label: "Source", width: "w-[200px]" },
  { key: "token_count", label: "Tokens", align: "right", width: "w-[90px]" },
  { key: "char_count", label: "Chars", align: "right", width: "w-[90px]" },
];

export default function TranscriptsPage() {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [page, setPage] = useState(0);

  const { data: allRows = [], isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["lovable-transcripts-all"],
    queryFn: () => fetchAllTranscripts(),
  });

  const { filters, setFilter, sort, toggleSort, clearFilters, processedRows } =
    useSimpleTableFilters<TranscriptRow>(allRows, {
      accessor,
      initialSort: { key: "index_label", dir: "desc" },
    });

  // Reset to page 0 when filters/sort change
  const filtersKey = JSON.stringify(filters) + (sort ? `${sort.key}:${sort.dir}` : "");
  useMemo(() => {
    setPage(0);
  }, [filtersKey]);

  const totalPages = Math.max(1, Math.ceil(processedRows.length / PAGE_SIZE));
  const pageRows = useMemo(
    () => processedRows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE),
    [processedRows, page],
  );

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const exportFiltered = () => {
    if (!processedRows.length) {
      toast.message("No matching rows to export");
      return;
    }
    const csv = rowsToCsv(processedRows);
    const date = new Date().toISOString().slice(0, 10);
    downloadCsv(csv, `lovable_agent_transcripts_filtered_${date}.csv`);
    toast.success(`Exported ${processedRows.length} rows`);
  };

  const exportAll = async () => {
    setExporting(true);
    try {
      const all = await fetchAllTranscripts();
      if (!all.length) {
        toast.message("Nothing to export");
        return;
      }
      const csv = rowsToCsv(all);
      const date = new Date().toISOString().slice(0, 10);
      downloadCsv(csv, `lovable_agent_transcripts_full_${date}.csv`);
      toast.success(`Exported ${all.length} rows`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  const hasActiveFilters = Object.values(filters).some((v) => v.length > 0);

  return (
    <AdminV2Layout>
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <SectionHead>
              <span className="inline-flex items-center gap-2">
                <MessageSquare className="h-3.5 w-3.5" /> Lovable Agent Transcripts
              </span>
            </SectionHead>
            <p className="text-sm text-muted-foreground">
              Verbatim Lovable chat history, parsed from <code>docs/transcript/</code>. Per-column
              filters; click headers to sort. Tokens use OpenAI <code>cl100k_base</code> (tiktoken).
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              className="gap-1.5"
              disabled={isFetching}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} /> Refresh
            </Button>
            {hasActiveFilters ? (
              <Button variant="outline" size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            ) : null}
            <Button variant="outline" size="sm" onClick={exportFiltered} className="gap-1.5">
              <Download className="h-3.5 w-3.5" /> Export filtered
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={exportAll}
              disabled={exporting}
              className="gap-1.5"
            >
              <Download className="h-3.5 w-3.5" />
              {exporting ? "Exporting…" : "Export full CSV"}
            </Button>
          </div>
        </div>

        <SurfaceCard noPadding>
          {isLoading ? (
            <div className="p-6 text-sm text-muted-foreground">Loading…</div>
          ) : error ? (
            <div className="p-6 text-sm text-destructive">
              Failed to load transcripts: {(error as Error).message}
            </div>
          ) : !allRows.length ? (
            <div className="p-6 text-sm text-muted-foreground">No transcripts found.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-zinc-200">
                    {COLUMNS.map((col) => (
                      <SortableTableHead
                        key={col.key}
                        columnKey={col.key}
                        label={col.label}
                        sortKey={sort?.key ?? ""}
                        sortDir={sort?.dir ?? "asc"}
                        onToggleSort={toggleSort}
                        sortable={col.sortable !== false}
                        align={col.align}
                        className={`px-3 py-2.5 text-[10px] uppercase tracking-wider font-medium ${col.width ?? ""}`}
                      />
                    ))}
                  </tr>
                  <tr className="border-b border-zinc-200 bg-zinc-50">
                    {COLUMNS.map((col) => (
                      <th key={col.key} className="px-3 py-1">
                        <TableFilterInput
                          value={filters[col.key] ?? ""}
                          onChange={(v) => setFilter(col.key, v)}
                        />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((r) => {
                    const isOpen = expanded.has(r.id);
                    const idxLabel = r.message_index_end
                      ? `${r.message_index}–${r.message_index_end}`
                      : `${r.message_index}`;
                    return (
                      <>
                        <tr
                          key={r.id}
                          className="border-b border-zinc-200 cursor-pointer hover:bg-zinc-50 transition-colors"
                          onClick={() => toggleExpanded(r.id)}
                        >
                          <td className="px-3 py-2.5">
                            <Mono color="dim">{formatWhen(r)}</Mono>
                          </td>
                          <td className="px-3 py-2.5">
                            <Mono>P{r.part_number}</Mono>
                          </td>
                          <td className="px-3 py-2.5">
                            <Mono>{idxLabel}</Mono>
                          </td>
                          <td className="px-3 py-2.5">
                            <Badge variant="outline" className={ROLE_COLORS[r.role]}>
                              {r.role}
                            </Badge>
                          </td>
                          <td className="px-3 py-2.5 max-w-[600px]">
                            {r.title ? (
                              <span className="font-medium text-sm">{r.title}</span>
                            ) : (
                              <span className="text-sm text-muted-foreground">{preview(r.body)}</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5">
                            <Mono color="dim">{r.source_file}</Mono>
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            <Mono>{r.token_count.toLocaleString()}</Mono>
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            <Mono color="dim">{r.char_count.toLocaleString()}</Mono>
                          </td>
                        </tr>
                        {isOpen ? (
                          <tr key={r.id + ":body"} className="bg-zinc-50">
                            <td colSpan={COLUMNS.length} className="px-4 py-3">
                              <div className="text-[11px] text-muted-foreground mb-2">
                                {r.source_file}
                              </div>
                              <pre className="whitespace-pre-wrap font-mono text-xs text-zinc-700 max-h-[480px] overflow-auto">
                                {r.body || "(empty)"}
                              </pre>
                            </td>
                          </tr>
                        ) : null}
                      </>
                    );
                  })}
                  {pageRows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={COLUMNS.length}
                        className="px-3 py-8 text-center text-zinc-500 text-sm"
                      >
                        No messages match your filters.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          )}
        </SurfaceCard>

        <div className="flex items-center justify-between text-sm">
          <div className="text-muted-foreground">
            {processedRows.length.toLocaleString()} of {allRows.length.toLocaleString()} messages
            {totalPages > 1 ? <> · Page {page + 1} of {totalPages}</> : null}
          </div>
          {totalPages > 1 ? (
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page + 1 >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </AdminV2Layout>
  );
}
