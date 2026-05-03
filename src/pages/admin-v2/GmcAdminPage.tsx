import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  Check,
  ExternalLink,
  Play,
  RefreshCcw,
  Save,
  Send,
  Settings,
  ShieldAlert,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { AdminV2Layout } from "@/components/admin-v2/AdminV2Layout";
import { GmcSettingsCard } from "@/components/admin-v2/GmcSettingsCard";
import { Badge, Mono, SectionHead, SummaryCard, SurfaceCard } from "@/components/admin-v2/ui-primitives";
import {
  type GmcPublishEvent,
  type GmcReadinessRow,
  useGmcMutations,
  useGmcPublishEvents,
  useGmcReadiness,
} from "@/hooks/admin/use-gmc";

type Tab = "queue" | "readiness" | "mapping";

const statusColors: Record<string, string> = {
  ready: "#16A34A",
  warning: "#D97706",
  blocked: "#DC2626",
  pending: "#D97706",
  processing: "#2563EB",
  sent: "#2563EB",
  acknowledged: "#16A34A",
  failed: "#DC2626",
  cancelled: "#71717A",
  live: "#16A34A",
  published: "#16A34A",
  publish_queued: "#D97706",
  suppressed: "#DC2626",
};

function formatDateTime(value?: string | null): string {
  if (!value) return "-";
  return new Date(value).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function issueText(row: GmcReadinessRow): string {
  const issues = [...row.blocking, ...row.warnings];
  if (issues.length === 0) return "Ready";
  return issues.slice(0, 3).join(" | ");
}

function sourceCandidateLabel(value: unknown): string {
  if (!value || typeof value !== "object") return "-";
  const sourceValues = (value as { source_values_jsonb?: Record<string, { value?: string | null }> }).source_values_jsonb ?? {};
  const candidates = Object.entries(sourceValues)
    .map(([source, entry]) => entry?.value ? `${source}: ${entry.value}` : null)
    .filter(Boolean);
  return candidates.length > 0 ? candidates.join(" | ") : "-";
}

function TabButton({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`border-b-2 px-4 py-2 text-[13px] transition-colors ${
        active
          ? "border-amber-500 font-semibold text-zinc-900"
          : "border-transparent text-zinc-500 hover:text-zinc-700"
      }`}
    >
      {children}
    </button>
  );
}

function IconButton({
  title,
  disabled,
  onClick,
  children,
}: {
  title: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-zinc-200 text-zinc-600 hover:bg-zinc-50 disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function PublishQueue({ events }: { events: GmcPublishEvent[] }) {
  const mutations = useGmcMutations();

  const run = async (label: string, fn: () => Promise<unknown>) => {
    try {
      const result = await fn();
      const processed = typeof result === "object" && result && "processed" in result
        ? Number((result as { processed?: number }).processed ?? 0)
        : null;
      toast.success(processed == null ? label : `${label}: ${processed} processed`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `${label} failed`);
    }
  };

  return (
    <SurfaceCard noPadding>
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
        <div>
          <SectionHead>Publish Queue</SectionHead>
          <p className="text-xs text-zinc-500">Recent Google Shopping outbound commands.</p>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-left text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 text-[11px] uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-4 py-2 font-semibold">Status</th>
              <th className="px-3 py-2 font-semibold">SKU</th>
              <th className="px-3 py-2 font-semibold">Command</th>
              <th className="px-3 py-2 font-semibold">Retries</th>
              <th className="px-3 py-2 font-semibold">Next</th>
              <th className="px-3 py-2 font-semibold">External</th>
              <th className="px-4 py-2 font-semibold">Last Error</th>
              <th className="px-4 py-2 font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {events.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-zinc-500">No GMC publish events yet.</td>
              </tr>
            ) : events.map((event) => (
              <tr key={event.id} className="align-top hover:bg-zinc-50/70">
                <td className="px-4 py-3">
                  <Badge label={event.status} color={statusColors[event.status] ?? "#71717A"} small />
                </td>
                <td className="px-3 py-3">
                  <Mono color="amber">{event.sku_code ?? event.app_reference ?? "-"}</Mono>
                  <div className="text-[11px] text-zinc-500">{event.channel ?? event.target_system}</div>
                </td>
                <td className="px-3 py-3 text-xs text-zinc-700">{event.command_type.replace(/_/g, " ")}</td>
                <td className="px-3 py-3"><Mono color={event.retry_count > 0 ? "amber" : "dim"}>{event.retry_count}</Mono></td>
                <td className="px-3 py-3 text-xs text-zinc-500">{formatDateTime(event.next_attempt_at)}</td>
                <td className="px-3 py-3 text-xs"><Mono>{event.external_listing_id ?? "-"}</Mono></td>
                <td className="max-w-[340px] px-4 py-3 text-xs text-red-600">{event.last_error ?? "-"}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    <IconButton
                      title="Run now"
                      disabled={mutations.runCommand.isPending || event.status !== "pending"}
                      onClick={() => run("Command run", () => mutations.runCommand.mutateAsync(event.id))}
                    >
                      <Play className="h-3.5 w-3.5" />
                    </IconButton>
                    <IconButton
                      title="Retry"
                      disabled={mutations.retryCommand.isPending || ["processing", "acknowledged", "sent"].includes(event.status)}
                      onClick={() => run("Command queued for retry", () => mutations.retryCommand.mutateAsync(event.id))}
                    >
                      <RefreshCcw className="h-3.5 w-3.5" />
                    </IconButton>
                    <IconButton
                      title="Cancel"
                      disabled={mutations.cancelCommand.isPending || ["processing", "acknowledged", "sent"].includes(event.status)}
                      onClick={() => run("Command cancelled", () => mutations.cancelCommand.mutateAsync(event.id))}
                    >
                      <X className="h-3.5 w-3.5" />
                    </IconButton>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SurfaceCard>
  );
}

function EditMappingRow({ row }: { row: GmcReadinessRow }) {
  const mutations = useGmcMutations();
  const [ean, setEan] = useState(row.ean ?? "");
  const [upc, setUpc] = useState(row.upc ?? "");
  const [isbn, setIsbn] = useState(row.isbn ?? "");
  const [category, setCategory] = useState(row.gmc_product_category ?? "");

  useEffect(() => {
    setEan(row.ean ?? "");
    setUpc(row.upc ?? "");
    setIsbn(row.isbn ?? "");
    setCategory(row.gmc_product_category ?? "");
  }, [row.ean, row.upc, row.isbn, row.gmc_product_category]);

  const save = async () => {
    try {
      await mutations.saveEnrichment.mutateAsync({
        productId: row.product_id,
        ean: ean.trim() || null,
        upc: upc.trim() || null,
        isbn: isbn.trim() || null,
        gmcProductCategory: category.trim() || null,
      });
      toast.success(`${row.sku_code} enrichment saved`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    }
  };

  return (
    <tr className="align-top hover:bg-zinc-50/70">
      <td className="px-4 py-3">
        <Mono color="amber">{row.sku_code}</Mono>
        <div className="text-[11px] text-zinc-500">{row.mpn ?? "-"}</div>
      </td>
      <td className="px-3 py-3 text-xs text-zinc-600">
        <div>EAN <Mono>{sourceCandidateLabel(row.barcode_source_candidates?.ean)}</Mono></div>
        <div>UPC <Mono>{sourceCandidateLabel(row.barcode_source_candidates?.upc)}</Mono></div>
        <div>ISBN <Mono>{sourceCandidateLabel(row.barcode_source_candidates?.isbn)}</Mono></div>
      </td>
      <td className="px-3 py-3">
        <div className="grid min-w-[360px] grid-cols-2 gap-1.5">
          <input value={ean} onChange={(event) => setEan(event.target.value)} placeholder="EAN" className="h-8 rounded-md border border-zinc-200 px-2 text-xs" />
          <input value={upc} onChange={(event) => setUpc(event.target.value)} placeholder="UPC" className="h-8 rounded-md border border-zinc-200 px-2 text-xs" />
          <input value={isbn} onChange={(event) => setIsbn(event.target.value)} placeholder="ISBN" className="h-8 rounded-md border border-zinc-200 px-2 text-xs" />
          <input value={category} onChange={(event) => setCategory(event.target.value)} placeholder="GMC category" className="h-8 rounded-md border border-zinc-200 px-2 text-xs" />
        </div>
      </td>
      <td className="px-3 py-3 text-xs text-zinc-600">{issueText(row)}</td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1.5">
          <IconButton title="Save enrichment" disabled={mutations.saveEnrichment.isPending} onClick={save}>
            <Save className="h-3.5 w-3.5" />
          </IconButton>
          {row.mpn && (
            <Link
              to={`/admin/products/${encodeURIComponent(row.mpn)}`}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-zinc-200 text-zinc-600 hover:bg-zinc-50"
              title="Open product"
              aria-label="Open product"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>
      </td>
    </tr>
  );
}

function ReadinessTable({
  rows,
  selected,
  onToggle,
}: {
  rows: GmcReadinessRow[];
  selected: Set<string>;
  onToggle: (skuId: string) => void;
}) {
  return (
    <SurfaceCard noPadding>
      <div className="border-b border-zinc-200 px-4 py-3">
        <SectionHead>Readiness & Enrichment</SectionHead>
        <p className="text-xs text-zinc-500">Rows with warnings can still publish; blocked rows need fixes first.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1100px] text-left text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 text-[11px] uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-4 py-2 font-semibold">Pick</th>
              <th className="px-3 py-2 font-semibold">Status</th>
              <th className="px-3 py-2 font-semibold">SKU</th>
              <th className="px-3 py-2 font-semibold">Product</th>
              <th className="px-3 py-2 font-semibold">Price</th>
              <th className="px-3 py-2 font-semibold">Stock</th>
              <th className="px-3 py-2 font-semibold">Identity</th>
              <th className="px-4 py-2 font-semibold">Issues</th>
              <th className="px-4 py-2 font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-zinc-500">No active SKUs found.</td>
              </tr>
            ) : rows.map((row) => {
              const canPick = row.status !== "blocked";
              return (
                <tr key={row.sku_id} className="align-top hover:bg-zinc-50/70">
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selected.has(row.sku_id)}
                      disabled={!canPick}
                      onChange={() => onToggle(row.sku_id)}
                      className="h-4 w-4 rounded border-zinc-300"
                    />
                  </td>
                  <td className="px-3 py-3">
                    <Badge label={row.status} color={statusColors[row.status] ?? "#71717A"} small />
                  </td>
                  <td className="px-3 py-3">
                    <Mono color="amber">{row.sku_code}</Mono>
                    <div className="text-[11px] text-zinc-500">{row.gmc_offer_status ?? "draft"}</div>
                  </td>
                  <td className="max-w-[260px] px-3 py-3 text-xs text-zinc-700">
                    <div className="font-medium text-zinc-900">{row.product_name ?? "-"}</div>
                    <Mono>{row.mpn ?? "-"}</Mono>
                  </td>
                  <td className="px-3 py-3"><Mono>{row.price > 0 ? `£${row.price.toFixed(2)}` : "-"}</Mono></td>
                  <td className="px-3 py-3"><Mono color={row.stock_count > 0 ? "green" : "amber"}>{row.stock_count}</Mono></td>
                  <td className="px-3 py-3 text-xs text-zinc-600">
                    <div>EAN <Mono>{row.ean ?? "-"}</Mono></div>
                    <div>UPC <Mono>{row.upc ?? "-"}</Mono></div>
                    <div>ISBN <Mono>{row.isbn ?? "-"}</Mono></div>
                    <div>GMC <Mono>{row.gmc_product_category ?? "-"}</Mono></div>
                  </td>
                  <td className="max-w-[360px] px-4 py-3 text-xs text-zinc-600">{issueText(row)}</td>
                  <td className="px-4 py-3">
                    {row.mpn ? (
                      <Link
                        to={`/admin/products/${encodeURIComponent(row.mpn)}`}
                        className="inline-flex h-7 items-center justify-center gap-1 rounded-md border border-zinc-200 px-2 text-[11px] font-medium text-zinc-700 hover:bg-zinc-50"
                      >
                        Edit
                        <ExternalLink className="h-3 w-3" />
                      </Link>
                    ) : "-"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </SurfaceCard>
  );
}

function MappingTable({ rows }: { rows: GmcReadinessRow[] }) {
  const priorityRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      const aNeeds = Number(!a.ean && !a.upc && !a.isbn) + Number(!a.gmc_product_category);
      const bNeeds = Number(!b.ean && !b.upc && !b.isbn) + Number(!b.gmc_product_category);
      return bNeeds - aNeeds || a.sku_code.localeCompare(b.sku_code);
    });
  }, [rows]);

  return (
    <SurfaceCard noPadding>
      <div className="border-b border-zinc-200 px-4 py-3">
        <SectionHead>GMC Mapping & Identity</SectionHead>
        <p className="text-xs text-zinc-500">Canonical barcode and Google category values used by the publish payload.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1040px] text-left text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 text-[11px] uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-4 py-2 font-semibold">SKU</th>
              <th className="px-3 py-2 font-semibold">Source Candidates</th>
              <th className="px-3 py-2 font-semibold">Canonical Values</th>
              <th className="px-3 py-2 font-semibold">Issue</th>
              <th className="px-4 py-2 font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {priorityRows.map((row) => <EditMappingRow key={row.sku_id} row={row} />)}
          </tbody>
        </table>
      </div>
    </SurfaceCard>
  );
}

export default function GmcAdminPage() {
  const [tab, setTab] = useState<Tab>("queue");
  const [selectedSkuIds, setSelectedSkuIds] = useState<Set<string>>(new Set());
  const readiness = useGmcReadiness();
  const events = useGmcPublishEvents();
  const mutations = useGmcMutations();

  const rows = readiness.data?.rows ?? [];
  const publishableRows = rows.filter((row) => row.status !== "blocked");

  const toggleSelected = (skuId: string) => {
    setSelectedSkuIds((prev) => {
      const next = new Set(prev);
      if (next.has(skuId)) next.delete(skuId);
      else next.add(skuId);
      return next;
    });
  };

  const publishSelected = async () => {
    const ids = [...selectedSkuIds];
    if (ids.length === 0) {
      toast.error("Select at least one ready or warning row");
      return;
    }
    try {
      const result = await mutations.publishAll.mutateAsync(ids);
      toast.success(`Queued ${result.queued ?? 0} products (${result.skipped ?? 0} skipped, ${result.errors ?? 0} errors)`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Publish failed");
    }
  };

  const publishAll = async () => {
    try {
      const result = await mutations.publishAll.mutateAsync(publishableRows.map((row) => row.sku_id));
      toast.success(`Queued ${result.queued ?? 0} products (${result.skipped ?? 0} skipped, ${result.errors ?? 0} errors)`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Publish failed");
    }
  };

  const syncStatus = async () => {
    try {
      const result = await mutations.syncStatus.mutateAsync();
      toast.success(`Synced ${result.updated ?? 0} of ${result.gmc_products ?? 0} GMC products`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sync failed");
    }
  };

  return (
    <AdminV2Layout>
      <div className="space-y-5 p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-[20px] font-bold text-zinc-900">Google Merchant Centre</h1>
            <p className="mt-1 max-w-3xl text-[12px] text-zinc-500">
              Publish control, product readiness, GMC identity mapping, and command recovery.
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={publishSelected}
              disabled={mutations.publishAll.isPending || selectedSkuIds.size === 0}
              className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-zinc-200 px-2.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
            >
              <Send className="h-3.5 w-3.5" />
              Publish Selected
            </button>
            <button
              type="button"
              onClick={publishAll}
              disabled={mutations.publishAll.isPending || publishableRows.length === 0}
              className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 text-xs font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-50"
            >
              <Check className="h-3.5 w-3.5" />
              Publish Ready
            </button>
            <button
              type="button"
              onClick={syncStatus}
              disabled={mutations.syncStatus.isPending}
              className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-zinc-200 px-2.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
            >
              <RefreshCcw className="h-3.5 w-3.5" />
              Sync Status
            </button>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          <SummaryCard label="Ready" value={readiness.data?.summary.ready ?? 0} color="#16A34A" />
          <SummaryCard label="Warnings" value={readiness.data?.summary.warning ?? 0} color="#D97706" />
          <SummaryCard label="Blocked" value={readiness.data?.summary.blocked ?? 0} color="#DC2626" />
          <SummaryCard label="Events" value={events.data?.length ?? 0} color="#18181B" />
        </div>

        <GmcSettingsCard showOpenLink={false} />

        <div className="flex gap-1 border-b border-zinc-200">
          <TabButton active={tab === "queue"} onClick={() => setTab("queue")}>Publish Queue</TabButton>
          <TabButton active={tab === "readiness"} onClick={() => setTab("readiness")}>Readiness</TabButton>
          <TabButton active={tab === "mapping"} onClick={() => setTab("mapping")}>GMC Mapping</TabButton>
        </div>

        {readiness.isLoading || events.isLoading ? (
          <SurfaceCard>
            <div className="flex items-center gap-2 text-sm text-zinc-500">
              <RefreshCcw className="h-4 w-4 animate-spin" />
              Loading GMC cockpit...
            </div>
          </SurfaceCard>
        ) : readiness.isError || events.isError ? (
          <SurfaceCard>
            <div className="flex items-start gap-2 text-sm text-red-600">
              <ShieldAlert className="mt-0.5 h-4 w-4" />
              <div>
                <div className="font-semibold">Unable to load GMC cockpit</div>
                <div className="text-xs">{readiness.error?.message ?? events.error?.message}</div>
              </div>
            </div>
          </SurfaceCard>
        ) : (
          <>
            {rows.some((row) => row.status === "blocked") && (
              <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                <AlertTriangle className="h-4 w-4" />
                {readiness.data?.summary.blocked ?? 0} row(s) blocked from publish.
              </div>
            )}
            {rows.some((row) => row.status === "warning") && (
              <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <Settings className="h-4 w-4" />
                {readiness.data?.summary.warning ?? 0} row(s) will publish with operator-visible warnings.
              </div>
            )}

            {tab === "queue" && <PublishQueue events={events.data ?? []} />}
            {tab === "readiness" && (
              <ReadinessTable rows={rows} selected={selectedSkuIds} onToggle={toggleSelected} />
            )}
            {tab === "mapping" && <MappingTable rows={rows} />}
          </>
        )}
      </div>
    </AdminV2Layout>
  );
}
