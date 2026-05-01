import { useMemo, useState } from "react";
import { Download, RefreshCw, MessageSquare, Search } from "lucide-react";
import { AdminV2Layout } from "@/components/admin-v2/AdminV2Layout";
import { SurfaceCard, SectionHead, Mono } from "@/components/admin-v2/ui-primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  fetchAllTranscripts,
  useTranscripts,
  type TranscriptFilters,
  type TranscriptRow,
} from "@/hooks/admin/use-transcripts";
import { downloadCsv } from "@/lib/csv-sync/csv-utils";
import { toast } from "sonner";

const PAGE_SIZE = 50;

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

export default function TranscriptsPage() {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [role, setRole] = useState<TranscriptFilters["role"]>("all");
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);

  const filters: TranscriptFilters = useMemo(
    () => ({ role, search, page, pageSize: PAGE_SIZE }),
    [role, search, page],
  );

  const { data, isLoading, error, refetch } = useTranscripts(filters);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  const onSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(0);
    setSearch(searchInput.trim());
  };

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const exportPage = () => {
    if (!data?.rows.length) {
      toast.message("Nothing to export on this page");
      return;
    }
    const csv = rowsToCsv(data.rows);
    const date = new Date().toISOString().slice(0, 10);
    downloadCsv(csv, `lovable_agent_transcripts_page${page + 1}_${date}.csv`);
    toast.success(`Exported ${data.rows.length} rows`);
  };

  const exportAll = async () => {
    setExporting(true);
    try {
      const all = await fetchAllTranscripts({ role, search });
      if (!all.length) {
        toast.message("No matching rows to export");
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
              Verbatim Lovable chat history, parsed from <code>docs/transcript/</code>. Reverse chronological. Token counts use
              OpenAI <code>cl100k_base</code> (tiktoken) for exact accuracy.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5">
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={exportPage} className="gap-1.5">
              <Download className="h-3.5 w-3.5" /> Export page
            </Button>
            <Button variant="default" size="sm" onClick={exportAll} disabled={exporting} className="gap-1.5">
              <Download className="h-3.5 w-3.5" />
              {exporting ? "Exporting…" : "Export full CSV"}
            </Button>
          </div>
        </div>

        <SurfaceCard>
          <div className="flex flex-wrap items-center gap-3">
            <form onSubmit={onSearch} className="flex flex-1 min-w-[260px] items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Search title or body…"
                  className="pl-8 h-9"
                />
              </div>
              <Button type="submit" size="sm" variant="secondary">Search</Button>
              {search ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setSearchInput("");
                    setSearch("");
                    setPage(0);
                  }}
                >
                  Clear
                </Button>
              ) : null}
            </form>

            <Select
              value={role ?? "all"}
              onValueChange={(v) => {
                setRole(v as TranscriptFilters["role"]);
                setPage(0);
              }}
            >
              <SelectTrigger className="w-[160px] h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All roles</SelectItem>
                <SelectItem value="user">User</SelectItem>
                <SelectItem value="assistant">Assistant</SelectItem>
                <SelectItem value="range">Range summary</SelectItem>
                <SelectItem value="system">System</SelectItem>
              </SelectContent>
            </Select>

            <div className="text-xs text-muted-foreground ml-auto">
              {data ? <>{data.total.toLocaleString()} messages</> : null}
            </div>
          </div>
        </SurfaceCard>

        <SurfaceCard noPadding>
          {isLoading ? (
            <div className="p-6 text-sm text-muted-foreground">Loading…</div>
          ) : error ? (
            <div className="p-6 text-sm text-destructive">
              Failed to load transcripts: {(error as Error).message}
            </div>
          ) : !data || data.rows.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">No messages match.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[160px]">When</TableHead>
                  <TableHead className="w-[60px]">Part</TableHead>
                  <TableHead className="w-[80px]">#</TableHead>
                  <TableHead className="w-[110px]">Role</TableHead>
                  <TableHead>Title / Preview</TableHead>
                  <TableHead className="w-[80px] text-right">Tokens</TableHead>
                  <TableHead className="w-[80px] text-right">Chars</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.rows.map((r) => {
                  const isOpen = expanded.has(r.id);
                  const idxLabel = r.message_index_end
                    ? `${r.message_index}–${r.message_index_end}`
                    : `${r.message_index}`;
                  return (
                    <>
                      <TableRow
                        key={r.id}
                        className="cursor-pointer"
                        onClick={() => toggleExpanded(r.id)}
                      >
                        <TableCell>
                          <Mono color="dim">{formatWhen(r)}</Mono>
                        </TableCell>
                        <TableCell><Mono>P{r.part_number}</Mono></TableCell>
                        <TableCell><Mono>{idxLabel}</Mono></TableCell>
                        <TableCell>
                          <Badge variant="outline" className={ROLE_COLORS[r.role]}>
                            {r.role}
                          </Badge>
                        </TableCell>
                        <TableCell className="max-w-[600px]">
                          {r.title ? (
                            <span className="font-medium text-sm">{r.title}</span>
                          ) : (
                            <span className="text-sm text-muted-foreground">{preview(r.body)}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <Mono>{r.token_count.toLocaleString()}</Mono>
                        </TableCell>
                        <TableCell className="text-right">
                          <Mono color="dim">{r.char_count.toLocaleString()}</Mono>
                        </TableCell>
                      </TableRow>
                      {isOpen ? (
                        <TableRow key={r.id + ":body"} className="hover:bg-transparent">
                          <TableCell colSpan={7} className="bg-zinc-50">
                            <div className="text-[11px] text-muted-foreground mb-2">
                              {r.source_file}
                            </div>
                            <pre className="whitespace-pre-wrap font-mono text-xs text-zinc-700 max-h-[480px] overflow-auto">
                              {r.body || "(empty)"}
                            </pre>
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </SurfaceCard>

        {data && data.total > PAGE_SIZE ? (
          <div className="flex items-center justify-between text-sm">
            <div className="text-muted-foreground">
              Page {page + 1} of {totalPages}
            </div>
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
          </div>
        ) : null}
      </div>
    </AdminV2Layout>
  );
}
