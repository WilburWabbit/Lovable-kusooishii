// ============================================================
// Rebrickable Reference Data Import Card
// Export, edit, delete, re-import the three Rebrickable lookup tables
// (minifigs, inventories, inventory_minifigs) via CSV with batched upserts.
// ============================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import Papa from "papaparse";
import {
  Download,
  Upload,
  AlertTriangle,
  Loader2,
  Trash2,
  Sparkles,
  RefreshCw,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { SurfaceCard, SectionHead } from "@/components/admin-v2/ui-primitives";
import { supabase } from "@/integrations/supabase/client";
import { rowsToCsv, downloadCsv } from "@/lib/csv-sync/csv-utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type RebrickableTable =
  | "rebrickable_minifigs"
  | "rebrickable_inventories"
  | "rebrickable_inventory_minifigs";

interface TableSpec {
  table: RebrickableTable;
  label: string;
  description: string;
  conflictTarget: string;
  numericColumns: string[];
  exportColumns: string[];
}

const TABLES: TableSpec[] = [
  {
    table: "rebrickable_minifigs",
    label: "Minifigs",
    description:
      "Minifig reference catalogue (fig_num, name, num_parts, img_url)",
    conflictTarget: "fig_num",
    numericColumns: ["num_parts"],
    exportColumns: ["fig_num", "name", "num_parts", "img_url", "bricklink_id"],
  },
  {
    table: "rebrickable_inventories",
    label: "Inventories",
    description: "Maps Rebrickable inventory IDs to set numbers",
    conflictTarget: "id",
    numericColumns: ["id", "version"],
    exportColumns: ["id", "version", "set_num"],
  },
  {
    table: "rebrickable_inventory_minifigs",
    label: "Inventory Minifigs",
    description:
      "Junction table: which minifigs are in which inventory and quantity",
    conflictTarget: "inventory_id,fig_num",
    numericColumns: ["inventory_id", "quantity"],
    exportColumns: ["inventory_id", "fig_num", "quantity"],
  },
];

const BATCH_SIZE = 500;

interface ImportProgress {
  done: number;
  total: number;
  batchIndex: number;
  totalBatches: number;
}

export function RebrickableImportCard() {
  const [counts, setCounts] = useState<Record<RebrickableTable, number | null>>({
    rebrickable_minifigs: null,
    rebrickable_inventories: null,
    rebrickable_inventory_minifigs: null,
  });
  const [busyTable, setBusyTable] = useState<RebrickableTable | null>(null);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<TableSpec | null>(null);

  // Load row-count badges
  const refreshCount = useCallback(async (table: RebrickableTable) => {
    const { count, error } = await supabase
      .from(table)
      .select("*", { count: "exact", head: true });
    if (!error) {
      setCounts((c) => ({ ...c, [table]: count ?? 0 }));
    }
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all(TABLES.map((t) => refreshCount(t.table)));
  }, [refreshCount]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  // ─── Export ───────────────────────────────────────────────
  const handleExport = async (spec: TableSpec) => {
    setBusyTable(spec.table);
    try {
      const all: Record<string, unknown>[] = [];
      const pageSize = 1000;
      let from = 0;
      // Paginate to bypass the 1000-row default
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { data, error } = await supabase
          .from(spec.table)
          .select(spec.exportColumns.join(","))
          .range(from, from + pageSize - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        all.push(...(data as unknown as Record<string, unknown>[]));
        if (data.length < pageSize) break;
        from += pageSize;
      }

      // Build CSV manually using the spec column order to guarantee headers
      const header = spec.exportColumns.join(",");
      const lines = [header];
      for (const row of all) {
        lines.push(
          spec.exportColumns
            .map((col) => csvCell(row[col]))
            .join(","),
        );
      }
      const csv = lines.join("\n");
      const date = new Date().toISOString().slice(0, 10);
      downloadCsv(csv, `${spec.table}_export_${date}.csv`);
      toast.success(
        all.length > 0
          ? `Exported ${all.length.toLocaleString()} rows from ${spec.label}`
          : `Exported template for ${spec.label} (headers only)`,
      );
    } catch (err) {
      toast.error(
        `Export failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setBusyTable(null);
    }
  };

  // ─── Delete all ───────────────────────────────────────────
  const handleDeleteConfirmed = async () => {
    if (!confirmDelete) return;
    const spec = confirmDelete;
    setConfirmDelete(null);
    setBusyTable(spec.table);
    try {
      // Delete with a true filter (a not-null condition) to satisfy supabase-js
      let query = supabase.from(spec.table).delete();
      // Use first conflict column as the not-null filter
      const filterCol = spec.conflictTarget.split(",")[0];
      query = query.not(filterCol, "is", null);
      const { error } = await query;
      if (error) throw error;
      toast.success(`Cleared all rows from ${spec.label}`);
      await refreshCount(spec.table);
    } catch (err) {
      toast.error(
        `Delete failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setBusyTable(null);
    }
  };

  // ─── Import ───────────────────────────────────────────────
  const handleFile = async (spec: TableSpec, file: File) => {
    setBusyTable(spec.table);
    setProgress(null);
    try {
      const parsed = await new Promise<Record<string, string>[]>(
        (resolve, reject) => {
          Papa.parse<Record<string, string>>(file, {
            header: true,
            skipEmptyLines: true,
            complete: (result) => resolve(result.data),
            error: (err: Error) => reject(err),
          });
        },
      );

      if (parsed.length === 0) {
        toast.error("CSV contained no data rows");
        return;
      }

      // Coerce numeric columns from strings
      const coerced = parsed.map((row) => {
        const next: Record<string, unknown> = { ...row };
        for (const col of spec.numericColumns) {
          if (next[col] === "" || next[col] === null || next[col] === undefined) {
            next[col] = null;
          } else {
            const n = Number(next[col]);
            if (!Number.isFinite(n)) {
              throw new Error(
                `Invalid numeric value "${next[col]}" in column "${col}"`,
              );
            }
            next[col] = n;
          }
        }
        // Empty strings → null for nullable text columns
        for (const k of Object.keys(next)) {
          if (next[k] === "") next[k] = null;
        }
        return next;
      });

      const totalBatches = Math.ceil(coerced.length / BATCH_SIZE);
      setProgress({
        done: 0,
        total: coerced.length,
        batchIndex: 0,
        totalBatches,
      });

      for (let i = 0; i < totalBatches; i++) {
        const batch = coerced.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
        const { error } = await supabase
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .from(spec.table as any)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .upsert(batch as any, { onConflict: spec.conflictTarget });
        if (error) {
          toast.error(
            `Batch ${i + 1} of ${totalBatches} failed: ${error.message}`,
          );
          setProgress(null);
          setBusyTable(null);
          return;
        }
        setProgress({
          done: Math.min((i + 1) * BATCH_SIZE, coerced.length),
          total: coerced.length,
          batchIndex: i + 1,
          totalBatches,
        });
      }

      toast.success(
        `Imported ${coerced.length.toLocaleString()} rows into ${spec.label}`,
      );
      await refreshCount(spec.table);
    } catch (err) {
      toast.error(
        `Import failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setBusyTable(null);
      setProgress(null);
    }
  };

  return (
    <>
      <SurfaceCard>
        <RebrickableApiSyncSection />

        <div className="my-6 border-t border-zinc-200" />

        <SectionHead>Rebrickable Reference Data</SectionHead>
        <p className="text-xs text-zinc-500 mb-4">
          Export, edit, delete, and re-import the Rebrickable lookup tables.
          CSV uploads are upserted in batches of {BATCH_SIZE} using the table
          primary key for conflict resolution.
        </p>

        <div className="space-y-2">
          {TABLES.map((spec) => {
            const isBusy = busyTable === spec.table;
            const showProgress = isBusy && progress;
            const count = counts[spec.table];
            return (
              <div
                key={spec.table}
                className="flex flex-col md:flex-row md:items-center gap-3 px-3 py-3 rounded border border-zinc-200 bg-white"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-zinc-900">
                      {spec.label}
                    </span>
                    <span className="font-mono text-[10px] text-zinc-500">
                      {spec.table}
                    </span>
                    <CountBadge count={count} />
                  </div>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    {spec.description}
                  </p>
                  {showProgress && (
                    <div className="mt-2">
                      <div className="flex items-center justify-between text-[11px] text-teal-700 font-mono mb-1">
                        <span>
                          {progress.done.toLocaleString()} of{" "}
                          {progress.total.toLocaleString()} rows imported
                        </span>
                        <span>
                          batch {progress.batchIndex}/{progress.totalBatches}
                        </span>
                      </div>
                      <div className="h-1.5 bg-zinc-100 rounded overflow-hidden">
                        <div
                          className="h-full bg-teal-500 transition-all"
                          style={{
                            width: `${
                              progress.total > 0
                                ? (progress.done / progress.total) * 100
                                : 0
                            }%`,
                          }}
                        />
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleExport(spec)}
                    disabled={isBusy}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-zinc-300 bg-white text-xs text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 transition-colors"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Export
                  </button>

                  <button
                    type="button"
                    onClick={() => setConfirmDelete(spec)}
                    disabled={isBusy}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-red-200 bg-white text-xs text-red-600 hover:bg-red-50 disabled:opacity-50 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete all
                  </button>

                  <ImportButton
                    spec={spec}
                    onFile={handleFile}
                    disabled={isBusy}
                    busy={isBusy && !progress}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* Amber dependency warning */}
        <div className="mt-4 flex items-start gap-2 px-3 py-2.5 rounded border border-amber-300 bg-amber-50">
          <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-800">
            <strong className="font-semibold">Import in order:</strong> Minifigs
            and Inventories before Inventory Minifigs. The junction table has
            foreign key constraints on both.
          </p>
        </div>
      </SurfaceCard>

      <AlertDialog
        open={!!confirmDelete}
        onOpenChange={(open) => !open && setConfirmDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete all rows from {confirmDelete?.label}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes every row in{" "}
              <span className="font-mono text-xs">{confirmDelete?.table}</span>.
              You will need to re-import the CSV to restore the data. This
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirmed}
              className="bg-red-600 hover:bg-red-700"
            >
              Delete all
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ─── Helpers ────────────────────────────────────────────────

function csvCell(val: unknown): string {
  if (val === null || val === undefined) return "";
  const str = String(val);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function CountBadge({ count }: { count: number | null }) {
  if (count === null) {
    return (
      <span className="inline-block px-1.5 py-px rounded bg-zinc-100 text-zinc-500 text-[10px] font-mono">
        …
      </span>
    );
  }
  return (
    <span className="inline-block px-1.5 py-px rounded bg-teal-50 text-teal-700 border border-teal-200 text-[10px] font-mono">
      {count.toLocaleString()} rows
    </span>
  );
}

function ImportButton({
  spec,
  onFile,
  disabled,
  busy,
}: {
  spec: TableSpec;
  onFile: (spec: TableSpec, file: File) => void;
  disabled: boolean;
  busy: boolean;
}) {
  const inputId = useMemo(() => `rebrickable-import-${spec.table}`, [spec.table]);

  return (
    <>
      <input
        id={inputId}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(spec, file);
          e.target.value = "";
        }}
        disabled={disabled}
      />
      <label
        htmlFor={inputId}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors cursor-pointer ${
          disabled
            ? "bg-teal-300 text-white cursor-not-allowed opacity-60"
            : "bg-teal-600 text-white hover:bg-teal-700"
        }`}
      >
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Upload className="h-3.5 w-3.5" />
        )}
        Import CSV
      </label>
    </>
  );
}

// ============================================================
// Rebrickable API Sync Section
// Live enrichment & metadata refresh via the Rebrickable API
// (rebrickable-sync edge function). Modes: enrich | set | full.
// ============================================================

type SyncMode = "enrich" | "set" | "full";

function RebrickableApiSyncSection() {
  const [busyMode, setBusyMode] = useState<SyncMode | null>(null);
  const [setNumOpen, setSetNumOpen] = useState(false);
  const [setNumValue, setSetNumValue] = useState("");
  const [cursorState, setCursorState] = useState<"loading" | "active" | "none">(
    "loading",
  );

  const refreshCursor = useCallback(async () => {
    try {
      // Best-effort lookup; if the table doesn't exist yet we treat it as "no cursor"
      const { data, error } = await supabase
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .from("sync_state" as any)
        .select("key")
        .eq("key", "rebrickable_full_sync")
        .maybeSingle();
      if (error) {
        setCursorState("none");
        return;
      }
      setCursorState(data ? "active" : "none");
    } catch {
      setCursorState("none");
    }
  }, []);

  useEffect(() => {
    refreshCursor();
  }, [refreshCursor]);

  const invokeSync = useCallback(
    async (mode: SyncMode, body: Record<string, unknown>) => {
      setBusyMode(mode);
      try {
        const { data, error } = await supabase.functions.invoke(
          "rebrickable-sync",
          { body },
        );
        if (error) {
          // Try to surface a useful message from the response
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const msg = (error as any)?.message ?? String(error);
          toast.error(`Rebrickable sync failed: ${msg}`);
          return;
        }
        const { summary, errorSummary } = formatSyncResult(mode, data);
        toast.success(summary);
        if (errorSummary) {
          toast.error(errorSummary, { duration: 10000 });
        }
        await refreshCursor();
      } catch (err) {
        toast.error(
          `Rebrickable sync failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      } finally {
        setBusyMode(null);
      }
    },
    [refreshCursor],
  );

  const handleSetSubmit = () => {
    const trimmed = setNumValue.trim();
    if (!trimmed) {
      toast.error("Enter a set number first (e.g. 75367-1)");
      return;
    }
    invokeSync("set", { mode: "set", set_num: trimmed }).then(() => {
      setSetNumOpen(false);
      setSetNumValue("");
    });
  };

  return (
    <div>
      <SectionHead>Rebrickable API Sync</SectionHead>
      <p className="text-xs text-zinc-500 mb-4">
        Live enrichment and metadata refresh via the Rebrickable API.
      </p>

      <div className="space-y-2">
        {/* Enrich Catalogue */}
        <SyncRow
          icon={<Sparkles className="h-3.5 w-3.5" />}
          label="Enrich Catalogue"
          description="Fetches BrickLink IDs for every minifig in your stocked sets. Safe to re-run — skips figs already enriched."
          buttonLabel="Run Enrich"
          busy={busyMode === "enrich"}
          disabled={busyMode !== null}
          onClick={() => invokeSync("enrich", { mode: "enrich" })}
        />

        {/* Sync Single Set */}
        <div className="flex flex-col gap-2 px-3 py-3 rounded border border-zinc-200 bg-white">
          <div className="flex flex-col md:flex-row md:items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <Search className="h-3.5 w-3.5 text-zinc-500" />
                <span className="text-sm font-medium text-zinc-900">
                  Sync Single Set
                </span>
              </div>
              <p className="text-xs text-zinc-500 mt-0.5">
                Enriches one set by set number. Runs automatically when a new
                product is added to the catalogue.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setSetNumOpen((o) => !o)}
                disabled={busyMode !== null}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50 transition-colors"
              >
                {busyMode === "set" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Search className="h-3.5 w-3.5" />
                )}
                {busyMode === "set" ? "Running…" : "Sync Set"}
              </button>
            </div>
          </div>
          {setNumOpen && (
            <div className="flex items-center gap-2 pt-1">
              <input
                type="text"
                value={setNumValue}
                onChange={(e) => setSetNumValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSetSubmit();
                  if (e.key === "Escape") setSetNumOpen(false);
                }}
                placeholder="e.g. 75367-1"
                disabled={busyMode !== null}
                className="flex-1 px-2.5 py-1.5 rounded border border-zinc-300 text-xs font-mono text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-teal-500 focus:border-teal-500 disabled:opacity-50"
                autoFocus
              />
              <button
                type="button"
                onClick={handleSetSubmit}
                disabled={busyMode !== null}
                className="px-3 py-1.5 rounded text-xs font-medium bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50 transition-colors"
              >
                Confirm
              </button>
              <button
                type="button"
                onClick={() => {
                  setSetNumOpen(false);
                  setSetNumValue("");
                }}
                disabled={busyMode !== null}
                className="px-3 py-1.5 rounded border border-zinc-300 bg-white text-xs text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          )}
        </div>

        {/* Full Refresh */}
        <SyncRow
          icon={<RefreshCw className="h-3.5 w-3.5" />}
          label="Full Refresh"
          description="Paginates the entire Rebrickable minifig catalogue to refresh names and images. Scheduled weekly — only run manually if data looks stale. May time out and resume on re-trigger."
          buttonLabel="Run Full Refresh"
          busy={busyMode === "full"}
          disabled={busyMode !== null}
          onClick={() => invokeSync("full", { mode: "full" })}
          badge={
            <span className="inline-block px-1.5 py-px rounded bg-teal-50 text-teal-700 border border-teal-200 text-[10px] font-mono">
              Resume-safe
            </span>
          }
        />
      </div>

      {/* Last sync row */}
      <div className="mt-3 px-3 py-2 rounded border border-zinc-200 bg-zinc-50">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] uppercase tracking-wide text-zinc-500 font-medium">
            Last sync
          </span>
          {cursorState === "loading" && (
            <span className="text-xs text-zinc-400">Checking…</span>
          )}
          {cursorState === "active" && (
            <span className="text-xs text-amber-700 font-medium">
              Full refresh in progress — cursor saved
            </span>
          )}
          {cursorState === "none" && (
            <span className="text-xs text-zinc-500">No active cursor</span>
          )}
        </div>
      </div>
    </div>
  );
}

function SyncRow({
  icon,
  label,
  description,
  buttonLabel,
  busy,
  disabled,
  onClick,
  badge,
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
  buttonLabel: string;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
  badge?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col md:flex-row md:items-center gap-3 px-3 py-3 rounded border border-zinc-200 bg-white">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-zinc-900">
            <span className="text-zinc-500">{icon}</span>
            {label}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-wrap mt-0.5">
          <p className="text-xs text-zinc-500">{description}</p>
          {badge}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={onClick}
          disabled={disabled}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50 transition-colors"
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            icon
          )}
          {busy ? "Running…" : buttonLabel}
        </button>
      </div>
    </div>
  );
}

function formatSyncResult(mode: SyncMode, data: unknown): string {
  if (!data || typeof data !== "object") {
    return `${labelForMode(mode)} complete`;
  }
  const d = data as Record<string, unknown>;
  const parts: string[] = [];
  const pushIfNum = (key: string, suffix: string) => {
    const v = d[key];
    if (typeof v === "number") parts.push(`${v.toLocaleString()} ${suffix}`);
  };

  if (mode === "enrich") {
    pushIfNum("sets_processed", "sets");
    pushIfNum("sets_upserted", "sets");
    pushIfNum("figs_processed", "figs");
    pushIfNum("bricklink_ids_added", "BrickLink IDs added");
  } else if (mode === "set") {
    if (typeof d.set_num === "string") parts.push(`set ${d.set_num}`);
    pushIfNum("figs_processed", "figs");
    pushIfNum("bricklink_ids_added", "BrickLink IDs added");
  } else if (mode === "full") {
    pushIfNum("pages_processed", "pages");
    pushIfNum("figs_upserted", "figs upserted");
    if (d.has_more === true) parts.push("more pages remain — re-run to resume");
  }

  const head = `${labelForMode(mode)} complete`;
  return parts.length > 0 ? `${head}: ${parts.join(", ")}` : head;
}

function labelForMode(mode: SyncMode): string {
  switch (mode) {
    case "enrich":
      return "Enrich";
    case "set":
      return "Set sync";
    case "full":
      return "Full refresh";
  }
}
