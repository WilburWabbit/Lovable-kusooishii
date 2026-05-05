import { useEffect, useMemo, useState, type ReactNode } from "react";
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
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { SortableTableHead } from "@/components/admin/SortableTableHead";
import { AdminV2Layout } from "@/components/admin-v2/AdminV2Layout";
import { GmcSettingsCard } from "@/components/admin-v2/GmcSettingsCard";
import { MultiSelectFilter } from "@/components/admin-v2/MultiSelectFilter";
import { TableFilterInput } from "@/components/admin-v2/TableFilterInput";
import { Badge, Mono, SectionHead, SummaryCard, SurfaceCard } from "@/components/admin-v2/ui-primitives";
import {
  type ChannelMappingRecord,
  type GmcAiMappingSuggestion,
  type GmcCompiledTransformResult,
  useCanonicalAttributes,
  useChannelMappings,
  useCompileGmcTransform,
  useDeleteChannelMapping,
  useSuggestGmcMappings,
  useUpsertChannelMapping,
} from "@/hooks/admin/use-channel-taxonomy";
import { type GmcPublishEvent, type GmcReadinessRow, useGmcMutations, useGmcPublishEvents, useGmcReadiness } from "@/hooks/admin/use-gmc";
import { useSimpleTableFilters } from "@/hooks/useSimpleTableFilters";
import type { SortDir } from "@/lib/table-utils";

type Tab = "readiness" | "queue" | "mapping";

const BULK_ACTION_CHUNK_SIZE = 10;

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

const READINESS_STATUS_OPTIONS = [
  { value: "ready", label: "Ready" },
  { value: "warning", label: "Warning" },
  { value: "blocked", label: "Blocked" },
];

const COMMAND_STATUS_OPTIONS = [
  { value: "pending", label: "Pending" },
  { value: "processing", label: "Processing" },
  { value: "acknowledged", label: "Acknowledged" },
  { value: "sent", label: "Sent" },
  { value: "failed", label: "Failed" },
  { value: "cancelled", label: "Cancelled" },
];

const COMMAND_TYPE_OPTIONS = [
  { value: "publish", label: "Publish" },
  { value: "reprice", label: "Reprice" },
  { value: "update_price", label: "Update price" },
  { value: "sync_quantity", label: "Sync quantity" },
  { value: "end", label: "End" },
];

const MAPPING_STATUS_OPTIONS = [
  { value: "saved", label: "Saved" },
  { value: "starter", label: "Starter" },
  { value: "empty", label: "Empty" },
];

interface GmcMappingField {
  aspectKey: string;
  label: string;
  required?: boolean;
  defaultCanonical?: string;
  defaultConstant?: string;
  defaultTransform?: string;
}

const CONDITION_RULES = JSON.stringify({
  rules: [
    { when: { field: "condition_grade", op: "lte", value: 2 }, value: "NEW" },
    { when: { field: "condition_grade", op: "gt", value: 2 }, value: "USED" },
  ],
  default: "USED",
});

const GMC_MAPPING_FIELDS: GmcMappingField[] = [
  { aspectKey: "title", label: "Title", required: true, defaultCanonical: "title" },
  { aspectKey: "description", label: "Description", required: true, defaultCanonical: "description" },
  { aspectKey: "link", label: "Product URL", required: true, defaultCanonical: "link" },
  { aspectKey: "imageLink", label: "Primary image", required: true, defaultCanonical: "image_link" },
  { aspectKey: "price.amountMicros", label: "Price amount micros", required: true, defaultCanonical: "price_amount_micros" },
  { aspectKey: "price.currencyCode", label: "Currency", required: true, defaultConstant: "GBP" },
  { aspectKey: "availability", label: "Availability", required: true, defaultCanonical: "availability_from_stock" },
  { aspectKey: "condition", label: "Condition", required: true, defaultCanonical: "condition_from_grade", defaultTransform: CONDITION_RULES },
  { aspectKey: "brand", label: "Brand", required: true, defaultConstant: "LEGO" },
  { aspectKey: "mpn", label: "MPN", required: true, defaultCanonical: "mpn" },
  { aspectKey: "gtin", label: "GTIN", defaultCanonical: "gtin" },
  { aspectKey: "identifierExists", label: "Identifier exists", defaultCanonical: "identifier_exists" },
  { aspectKey: "googleProductCategory", label: "Google product category", defaultCanonical: "gmc_product_category" },
  { aspectKey: "productTypes", label: "Product type path", defaultCanonical: "product_type_path" },
  { aspectKey: "itemGroupId", label: "Item group ID", defaultCanonical: "mpn" },
  { aspectKey: "shippingWeight.value", label: "Shipping weight", defaultCanonical: "weight_g" },
  { aspectKey: "shippingWeight.unit", label: "Shipping weight unit", defaultConstant: "g" },
];

function formatDateTime(value?: string | null): string {
  if (!value) return "-";
  return new Date(value).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatCurrency(value: number): string {
  return value > 0 ? `£${value.toFixed(2)}` : "-";
}

function issueText(row: GmcReadinessRow): string {
  const issues = [...row.blocking, ...row.warnings];
  if (issues.length === 0) return "Ready";
  return issues.slice(0, 3).join(" | ");
}

function sortState(sort: { key: string; dir: SortDir } | null) {
  return { sortKey: sort?.key ?? "", sortDir: sort?.dir ?? "asc" };
}

function productHref(mpn?: string | null) {
  return mpn ? `/admin/products/${encodeURIComponent(mpn)}` : null;
}

function TabButton({ active, children, onClick }: { active: boolean; children: ReactNode; onClick: () => void }) {
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
  children: ReactNode;
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

function readinessAccessor(row: GmcReadinessRow, key: string): unknown {
  switch (key) {
    case "product":
      return `${row.product_name ?? ""} ${row.mpn ?? ""}`;
    case "identity":
      return `${row.ean ?? ""} ${row.upc ?? ""} ${row.isbn ?? ""} ${row.gmc_product_category ?? ""}`;
    case "issues":
      return issueText(row);
    case "checkout":
      return row.checkout_link_template ?? "";
    case "price":
      return row.price;
    case "stock":
      return row.stock_count;
    default:
      return (row as unknown as Record<string, unknown>)[key];
  }
}

function ReadinessTable({
  rows,
  selected,
  onToggle,
  onToggleMany,
}: {
  rows: GmcReadinessRow[];
  selected: Set<string>;
  onToggle: (skuId: string) => void;
  onToggleMany: (skuIds: string[], shouldSelect: boolean) => void;
}) {
  const { filters, setFilter, sort, toggleSort, clearFilters, processedRows } = useSimpleTableFilters(rows, {
    accessor: readinessAccessor,
    initialSort: { key: "status", dir: "asc" },
  });
  const { sortKey, sortDir } = sortState(sort);
  const selectableRows = processedRows.filter((row) => row.status !== "blocked");
  const allVisibleSelected = selectableRows.length > 0 && selectableRows.every((row) => selected.has(row.sku_id));

  return (
    <SurfaceCard noPadding>
      <div className="flex items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3">
        <div>
          <SectionHead>Readiness</SectionHead>
          <p className="text-xs text-zinc-500">Rows with warnings can publish; blocked rows need fixes first.</p>
        </div>
        <button type="button" onClick={clearFilters} className="text-xs font-medium text-zinc-500 hover:text-zinc-900">
          Clear filters
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1320px] text-left text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 text-[11px] uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-4 py-2 font-semibold">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  disabled={selectableRows.length === 0}
                  onChange={() => onToggleMany(selectableRows.map((row) => row.sku_id), !allVisibleSelected)}
                  className="h-4 w-4 rounded border-zinc-300"
                  aria-label="Select visible publishable rows"
                />
              </th>
              <SortableTableHead columnKey="status" label="Status" sortKey={sortKey} sortDir={sortDir} onToggleSort={toggleSort} />
              <SortableTableHead columnKey="sku_code" label="SKU" sortKey={sortKey} sortDir={sortDir} onToggleSort={toggleSort} />
              <SortableTableHead columnKey="product" label="Product" sortKey={sortKey} sortDir={sortDir} onToggleSort={toggleSort} />
              <SortableTableHead columnKey="price" label="Price" sortKey={sortKey} sortDir={sortDir} onToggleSort={toggleSort} align="right" />
              <SortableTableHead columnKey="stock" label="Stock" sortKey={sortKey} sortDir={sortDir} onToggleSort={toggleSort} align="right" />
              <SortableTableHead columnKey="identity" label="Identity" sortKey={sortKey} sortDir={sortDir} onToggleSort={toggleSort} />
              <SortableTableHead columnKey="issues" label="Issues" sortKey={sortKey} sortDir={sortDir} onToggleSort={toggleSort} />
              <SortableTableHead columnKey="checkout" label="Checkout" sortKey={sortKey} sortDir={sortDir} onToggleSort={toggleSort} />
              <th className="px-4 py-2 font-semibold">Actions</th>
            </tr>
            <tr className="border-t border-zinc-200 normal-case tracking-normal">
              <th className="px-4 py-2" />
              <th className="px-3 py-2"><MultiSelectFilter value={filters.status ?? ""} onChange={(value) => setFilter("status", value)} options={READINESS_STATUS_OPTIONS} placeholder="All statuses" /></th>
              <th className="px-3 py-2"><TableFilterInput value={filters.sku_code ?? ""} onChange={(value) => setFilter("sku_code", value)} placeholder="SKU" /></th>
              <th className="px-3 py-2"><TableFilterInput value={filters.product ?? ""} onChange={(value) => setFilter("product", value)} placeholder="Product" /></th>
              <th className="px-3 py-2"><TableFilterInput value={filters.price ?? ""} onChange={(value) => setFilter("price", value)} placeholder="Price" /></th>
              <th className="px-3 py-2"><TableFilterInput value={filters.stock ?? ""} onChange={(value) => setFilter("stock", value)} placeholder="Stock" /></th>
              <th className="px-3 py-2"><TableFilterInput value={filters.identity ?? ""} onChange={(value) => setFilter("identity", value)} placeholder="EAN/UPC/GMC" /></th>
              <th className="px-4 py-2"><TableFilterInput value={filters.issues ?? ""} onChange={(value) => setFilter("issues", value)} placeholder="Issue" /></th>
              <th className="px-4 py-2"><TableFilterInput value={filters.checkout ?? ""} onChange={(value) => setFilter("checkout", value)} placeholder="Cart URL" /></th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {processedRows.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-4 py-8 text-center text-zinc-500">No active SKUs match the current view.</td>
              </tr>
            ) : processedRows.map((row) => {
              const canPick = row.status !== "blocked";
              const href = productHref(row.mpn);
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
                  <td className="max-w-[280px] px-3 py-3 text-xs text-zinc-700">
                    {href ? (
                      <Link to={href} className="font-medium text-zinc-900 hover:text-amber-700">
                        {row.product_name ?? row.mpn}
                      </Link>
                    ) : (
                      <div className="font-medium text-zinc-900">{row.product_name ?? "-"}</div>
                    )}
                    <div><Mono>{row.mpn ?? "-"}</Mono></div>
                  </td>
                  <td className="px-3 py-3 text-right"><Mono>{formatCurrency(row.price)}</Mono></td>
                  <td className="px-3 py-3 text-right"><Mono color={row.stock_count > 0 ? "green" : "amber"}>{row.stock_count}</Mono></td>
                  <td className="px-3 py-3 text-xs text-zinc-600">
                    <div>EAN <Mono>{row.ean ?? "-"}</Mono></div>
                    <div>UPC <Mono>{row.upc ?? "-"}</Mono></div>
                    <div>ISBN <Mono>{row.isbn ?? "-"}</Mono></div>
                    <div>GMC <Mono>{row.gmc_product_category ?? "-"}</Mono></div>
                  </td>
                  <td className="max-w-[360px] px-4 py-3 text-xs text-zinc-600">{issueText(row)}</td>
                  <td className="px-4 py-3">
                    {row.checkout_link_template ? (
                      <a
                        href={row.checkout_link_template}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex h-7 items-center justify-center gap-1 rounded-md border border-zinc-200 px-2 text-[11px] font-medium text-zinc-700 hover:bg-zinc-50"
                      >
                        Cart
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : "-"}
                  </td>
                  <td className="px-4 py-3">
                    {href ? (
                      <Link
                        to={href}
                        className="inline-flex h-7 items-center justify-center gap-1 rounded-md border border-zinc-200 px-2 text-[11px] font-medium text-zinc-700 hover:bg-zinc-50"
                      >
                        Product
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

function queueAccessor(event: GmcPublishEvent, key: string, productBySku: Map<string, GmcReadinessRow>): unknown {
  const sku = event.sku_code ?? event.app_reference ?? "";
  const product = productBySku.get(sku);
  switch (key) {
    case "sku":
      return sku;
    case "product":
      return `${product?.product_name ?? ""} ${product?.mpn ?? ""}`;
    case "command":
      return event.command_type;
    case "retries":
      return event.retry_count;
    case "next":
      return event.next_attempt_at;
    case "external":
      return event.external_listing_id;
    case "lastError":
      return event.last_error;
    default:
      return (event as unknown as Record<string, unknown>)[key];
  }
}

function PublishQueue({ events, readinessRows }: { events: GmcPublishEvent[]; readinessRows: GmcReadinessRow[] }) {
  const mutations = useGmcMutations();
  const [selectedCommandIds, setSelectedCommandIds] = useState<Set<string>>(new Set());
  const productBySku = useMemo(() => {
    const map = new Map<string, GmcReadinessRow>();
    for (const row of readinessRows) map.set(row.sku_code, row);
    return map;
  }, [readinessRows]);

  const { filters, setFilter, sort, toggleSort, clearFilters, processedRows } = useSimpleTableFilters(events, {
    accessor: (event, key) => queueAccessor(event, key, productBySku),
    initialSort: { key: "status", dir: "asc" },
  });
  const { sortKey, sortDir } = sortState(sort);
  const allVisibleSelected = processedRows.length > 0 && processedRows.every((event) => selectedCommandIds.has(event.id));
  const selectedEvents = processedRows.filter((event) => selectedCommandIds.has(event.id));

  const toggleVisible = () => {
    setSelectedCommandIds((prev) => {
      const next = new Set(prev);
      for (const event of processedRows) {
        if (allVisibleSelected) next.delete(event.id);
        else next.add(event.id);
      }
      return next;
    });
  };

  const toggleSelected = (id: string) => {
    setSelectedCommandIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

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

  const runChunk = async (
    label: string,
    candidates: GmcPublishEvent[],
    fn: (id: string) => Promise<unknown>,
    confirmMessage?: string,
  ) => {
    const chunk = candidates.slice(0, BULK_ACTION_CHUNK_SIZE);
    if (chunk.length === 0) {
      toast.error("Select at least one actionable queue record");
      return;
    }
    if (confirmMessage && !confirm(confirmMessage)) return;
    try {
      for (const event of chunk) {
        await fn(event.id);
      }
      setSelectedCommandIds((prev) => {
        const next = new Set(prev);
        for (const event of chunk) next.delete(event.id);
        return next;
      });
      toast.success(`${label}: ${chunk.length} record(s) processed`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `${label} failed`);
    }
  };

  const runnable = selectedEvents.filter((event) => event.status === "pending");
  const retryable = selectedEvents.filter((event) => !["processing", "acknowledged", "sent"].includes(event.status));
  const cancellable = selectedEvents.filter((event) => !["processing", "acknowledged", "sent"].includes(event.status));
  const busy = mutations.runCommand.isPending || mutations.retryCommand.isPending || mutations.cancelCommand.isPending;

  return (
    <SurfaceCard noPadding>
      <div className="flex flex-col gap-3 border-b border-zinc-200 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <SectionHead>Publish Queue</SectionHead>
          <p className="text-xs text-zinc-500">Outbound commands. Process bulk selections in chunks of {BULK_ACTION_CHUNK_SIZE}.</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button type="button" onClick={clearFilters} className="h-8 rounded-md border border-zinc-200 px-2.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50">
            Clear filters
          </button>
          <button
            type="button"
            onClick={() => runChunk("Run chunk", runnable, (id) => mutations.runCommand.mutateAsync(id))}
            disabled={busy || runnable.length === 0}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-zinc-200 px-2.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
          >
            <Play className="h-3.5 w-3.5" />
            Run {Math.min(runnable.length, BULK_ACTION_CHUNK_SIZE)}
          </button>
          <button
            type="button"
            onClick={() => runChunk("Retry chunk", retryable, (id) => mutations.retryCommand.mutateAsync(id))}
            disabled={busy || retryable.length === 0}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-zinc-200 px-2.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
          >
            <RefreshCcw className="h-3.5 w-3.5" />
            Retry {Math.min(retryable.length, BULK_ACTION_CHUNK_SIZE)}
          </button>
          <button
            type="button"
            onClick={() => runChunk("Cancel chunk", cancellable, (id) => mutations.cancelCommand.mutateAsync(id), `Cancel ${Math.min(cancellable.length, BULK_ACTION_CHUNK_SIZE)} selected GMC command(s)?`)}
            disabled={busy || cancellable.length === 0}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-red-200 px-2.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            <X className="h-3.5 w-3.5" />
            Cancel {Math.min(cancellable.length, BULK_ACTION_CHUNK_SIZE)}
          </button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1240px] text-left text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 text-[11px] uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-4 py-2 font-semibold">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  disabled={processedRows.length === 0}
                  onChange={toggleVisible}
                  className="h-4 w-4 rounded border-zinc-300"
                  aria-label="Select visible queue rows"
                />
              </th>
              <SortableTableHead columnKey="status" label="Status" sortKey={sortKey} sortDir={sortDir} onToggleSort={toggleSort} />
              <SortableTableHead columnKey="product" label="Product" sortKey={sortKey} sortDir={sortDir} onToggleSort={toggleSort} />
              <SortableTableHead columnKey="sku" label="SKU" sortKey={sortKey} sortDir={sortDir} onToggleSort={toggleSort} />
              <SortableTableHead columnKey="command" label="Command" sortKey={sortKey} sortDir={sortDir} onToggleSort={toggleSort} />
              <SortableTableHead columnKey="retries" label="Retries" sortKey={sortKey} sortDir={sortDir} onToggleSort={toggleSort} align="right" />
              <SortableTableHead columnKey="next" label="Next" sortKey={sortKey} sortDir={sortDir} onToggleSort={toggleSort} />
              <SortableTableHead columnKey="external" label="External" sortKey={sortKey} sortDir={sortDir} onToggleSort={toggleSort} />
              <SortableTableHead columnKey="lastError" label="Last Error" sortKey={sortKey} sortDir={sortDir} onToggleSort={toggleSort} />
              <th className="px-4 py-2 font-semibold">Actions</th>
            </tr>
            <tr className="border-t border-zinc-200 normal-case tracking-normal">
              <th className="px-4 py-2" />
              <th className="px-3 py-2"><MultiSelectFilter value={filters.status ?? ""} onChange={(value) => setFilter("status", value)} options={COMMAND_STATUS_OPTIONS} placeholder="All statuses" /></th>
              <th className="px-3 py-2"><TableFilterInput value={filters.product ?? ""} onChange={(value) => setFilter("product", value)} placeholder="Product" /></th>
              <th className="px-3 py-2"><TableFilterInput value={filters.sku ?? ""} onChange={(value) => setFilter("sku", value)} placeholder="SKU" /></th>
              <th className="px-3 py-2"><MultiSelectFilter value={filters.command ?? ""} onChange={(value) => setFilter("command", value)} options={COMMAND_TYPE_OPTIONS} placeholder="All commands" /></th>
              <th className="px-3 py-2"><TableFilterInput value={filters.retries ?? ""} onChange={(value) => setFilter("retries", value)} placeholder="Retries" /></th>
              <th className="px-3 py-2"><TableFilterInput value={filters.next ?? ""} onChange={(value) => setFilter("next", value)} placeholder="Next" /></th>
              <th className="px-3 py-2"><TableFilterInput value={filters.external ?? ""} onChange={(value) => setFilter("external", value)} placeholder="External" /></th>
              <th className="px-4 py-2"><TableFilterInput value={filters.lastError ?? ""} onChange={(value) => setFilter("lastError", value)} placeholder="Error" /></th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {processedRows.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-4 py-8 text-center text-zinc-500">No GMC publish events match the current view.</td>
              </tr>
            ) : processedRows.map((event) => {
              const sku = event.sku_code ?? event.app_reference ?? "";
              const product = productBySku.get(sku);
              const href = productHref(product?.mpn);
              return (
                <tr key={event.id} className="align-top hover:bg-zinc-50/70">
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selectedCommandIds.has(event.id)}
                      onChange={() => toggleSelected(event.id)}
                      className="h-4 w-4 rounded border-zinc-300"
                    />
                  </td>
                  <td className="px-3 py-3">
                    <Badge label={event.status} color={statusColors[event.status] ?? "#71717A"} small />
                  </td>
                  <td className="max-w-[260px] px-3 py-3 text-xs">
                    {href ? (
                      <Link to={href} className="font-medium text-zinc-900 hover:text-amber-700">
                        {product?.product_name ?? product?.mpn}
                      </Link>
                    ) : (
                      <span className="font-medium text-zinc-500">No readiness row</span>
                    )}
                    <div><Mono>{product?.mpn ?? "-"}</Mono></div>
                  </td>
                  <td className="px-3 py-3">
                    <Mono color="amber">{sku || "-"}</Mono>
                    <div className="text-[11px] text-zinc-500">{event.channel ?? event.target_system}</div>
                  </td>
                  <td className="px-3 py-3 text-xs text-zinc-700">{event.command_type.replace(/_/g, " ")}</td>
                  <td className="px-3 py-3 text-right"><Mono color={event.retry_count > 0 ? "amber" : "dim"}>{event.retry_count}</Mono></td>
                  <td className="px-3 py-3 text-xs text-zinc-500">{formatDateTime(event.next_attempt_at)}</td>
                  <td className="px-3 py-3 text-xs"><Mono>{event.external_listing_id ?? "-"}</Mono></td>
                  <td className="max-w-[320px] px-4 py-3 text-xs text-red-600">{event.last_error ?? "-"}</td>
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
              );
            })}
          </tbody>
        </table>
      </div>
    </SurfaceCard>
  );
}

interface MappingRowData {
  field: GmcMappingField;
  mapping: ChannelMappingRecord | null;
}

function mappingStatus(row: MappingRowData) {
  if (row.mapping) return "saved";
  if (row.field.defaultCanonical || row.field.defaultConstant || row.field.defaultTransform) return "starter";
  return "empty";
}

function mappingAccessor(row: MappingRowData, key: string): unknown {
  switch (key) {
    case "field":
      return `${row.field.label} ${row.field.aspectKey}`;
    case "source":
      return row.mapping?.canonical_key ?? row.mapping?.constant_value ?? row.field.defaultCanonical ?? row.field.defaultConstant ?? "";
    case "rules":
      return row.mapping?.transform ?? row.field.defaultTransform ?? "";
    case "status":
      return mappingStatus(row);
    default:
      return "";
  }
}

function starterMapping(field: GmcMappingField, existing?: ChannelMappingRecord | null): ChannelMappingRecord {
  return {
    id: existing?.id,
    channel: "gmc",
    marketplace: existing?.marketplace ?? "GB",
    category_id: null,
    aspect_key: field.aspectKey,
    canonical_key: existing?.canonical_key ?? field.defaultCanonical ?? null,
    constant_value: existing?.constant_value ?? field.defaultConstant ?? null,
    transform: existing?.transform ?? field.defaultTransform ?? null,
    notes: existing?.notes ?? null,
  };
}

function prettyJson(value: string) {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

function appendNotes(current: string | null, additions: string[]) {
  return [...(current?.trim() ? [current.trim()] : []), ...additions.filter(Boolean)].join("\n");
}

function sampleSourceLabel(source: Record<string, unknown>) {
  return [
    source.product_type ? `type ${String(source.product_type)}` : null,
    source.lego_theme ? `theme ${String(source.lego_theme)}` : null,
  ].filter(Boolean).join(" · ");
}

function gmcRulePromptPlaceholder(aspectKey: string) {
  if (aspectKey === "googleProductCategory") {
    return "If the product type is Minifigure, use Action & Toy Figures, else use Interlocking Blocks";
  }
  if (aspectKey === "availability") {
    return "If stock_count is greater than 0, use IN_STOCK, else use OUT_OF_STOCK";
  }
  if (aspectKey === "condition") {
    return "If condition_grade is 1 or 2, use NEW, else use USED";
  }
  if (aspectKey === "identifierExists") {
    return "If gtin exists, use true, else use false";
  }
  if (aspectKey === "shippingWeight.unit") {
    return "If weight_g exists, use g, else use kg";
  }
  return "Describe the deterministic rule for this GMC field, including the fallback value";
}

function GmcMappingRuleRow({
  field,
  mapping,
  canonicalKeys,
  suggestion,
  canonicalKeySet,
  canonicalAttrsLoading,
}: {
  field: GmcMappingField;
  mapping: ChannelMappingRecord | null;
  canonicalKeys: string[];
  suggestion?: GmcAiMappingSuggestion | null;
  canonicalKeySet: Set<string>;
  canonicalAttrsLoading: boolean;
}) {
  const upsert = useUpsertChannelMapping();
  const remove = useDeleteChannelMapping();
  const compileTransform = useCompileGmcTransform();
  const [draft, setDraft] = useState<ChannelMappingRecord>(() => starterMapping(field, mapping));
  const [rulePromptOpen, setRulePromptOpen] = useState(false);
  const [rulePrompt, setRulePrompt] = useState("");
  const [compiledRule, setCompiledRule] = useState<GmcCompiledTransformResult | null>(null);

  useEffect(() => {
    setDraft(starterMapping(field, mapping));
  }, [field, mapping]);

  const save = async () => {
    if (!draft.canonical_key && !draft.constant_value && !draft.transform) {
      toast.error("Set a source, constant, or rule before saving");
      return;
    }
    const canonicalKey = draft.canonical_key?.trim() || null;
    if (canonicalKey) {
      if (canonicalAttrsLoading) {
        toast.error("Canonical attributes are still loading");
        return;
      }
      if (!canonicalKeySet.has(canonicalKey)) {
        toast.error(`Unknown canonical attribute: ${canonicalKey}`);
        return;
      }
    }
    try {
      await upsert.mutateAsync({
        ...draft,
        marketplace: draft.marketplace || "GB",
        category_id: null,
        canonical_key: canonicalKey,
        constant_value: draft.constant_value?.trim() || null,
        transform: draft.transform?.trim() || null,
        notes: draft.notes?.trim() || null,
      });
      toast.success(`${field.label} mapping saved`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    }
  };

  const useSuggestion = () => {
    if (!suggestion) return;
    setDraft((prev) => ({
      ...prev,
      canonical_key: suggestion.canonical_key,
      constant_value: suggestion.constant_value,
      transform: suggestion.transform,
      notes: suggestion.notes ?? `AI suggested (${suggestion.confidence}): ${suggestion.reason}`,
    }));
  };

  const deleteMapping = async () => {
    if (!mapping?.id || !confirm(`Delete the ${field.label} GMC mapping?`)) return;
    try {
      await remove.mutateAsync(mapping.id);
      toast.success(`${field.label} mapping deleted`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    }
  };

  const generateRule = async () => {
    const prompt = rulePrompt.trim();
    if (!prompt) {
      toast.error("Describe the rule first");
      return;
    }
    try {
      const result = await compileTransform.mutateAsync({
        aspectKey: field.aspectKey,
        prompt,
        sampleLimit: 8,
      });
      setCompiledRule(result);
      toast.success("GMC rule generated for review");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Rule generation failed");
    }
  };

  const applyCompiledRule = () => {
    if (!compiledRule) return;
    const prompt = rulePrompt.trim();
    setDraft((prev) => ({
      ...prev,
      transform: compiledRule.transform,
      notes: appendNotes(prev.notes, [
        prompt ? `AI rule prompt: ${prompt}` : "",
        `AI rule explanation: ${compiledRule.explanation}`,
      ]),
    }));
    setRulePromptOpen(false);
    setCompiledRule(null);
    toast.success("Generated rule added to the draft");
  };

  const datalistId = `gmc-canonical-${field.aspectKey.replace(/[^a-z0-9]/gi, "-")}`;

  return (
    <tr className="align-top hover:bg-zinc-50/70">
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="font-medium text-zinc-900">{field.label}</span>
          {field.required ? <Badge label="Required" color="#DC2626" small /> : null}
        </div>
        <Mono>{field.aspectKey}</Mono>
      </td>
      <td className="px-3 py-3">
        <input
          list={datalistId}
          value={draft.canonical_key ?? ""}
          onChange={(event) => setDraft((prev) => ({ ...prev, canonical_key: event.target.value || null }))}
          placeholder="Canonical or derived key"
          className="h-8 w-full min-w-[220px] rounded-md border border-zinc-200 px-2 text-xs"
        />
        <datalist id={datalistId}>
          {canonicalKeys.map((key) => <option key={key} value={key} />)}
        </datalist>
      </td>
      <td className="px-3 py-3">
        <input
          value={draft.constant_value ?? ""}
          onChange={(event) => setDraft((prev) => ({ ...prev, constant_value: event.target.value || null }))}
          placeholder="Constant/fallback"
          className="h-8 w-full min-w-[160px] rounded-md border border-zinc-200 px-2 text-xs"
        />
      </td>
      <td className="px-3 py-3">
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Rule JSON</span>
          <button
            type="button"
            onClick={() => setRulePromptOpen((open) => !open)}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-sky-200 bg-sky-50 px-2 text-[11px] font-semibold text-sky-800 hover:bg-sky-100"
          >
            <Sparkles className="h-3 w-3" />
            Generate rule
          </button>
        </div>
        <textarea
          value={draft.transform ?? ""}
          onChange={(event) => setDraft((prev) => ({ ...prev, transform: event.target.value || null }))}
          placeholder='{"rules":[{"when":{"field":"stock_count","op":"gt","value":0},"value":"IN_STOCK"}],"default":"OUT_OF_STOCK"}'
          className="min-h-[72px] w-full min-w-[360px] rounded-md border border-zinc-200 px-2 py-1.5 font-mono text-[11px]"
        />
        {rulePromptOpen ? (
          <div className="mt-2 rounded-md border border-sky-200 bg-sky-50 p-2">
            <textarea
              value={rulePrompt}
              onChange={(event) => {
                setRulePrompt(event.target.value);
                setCompiledRule(null);
              }}
              placeholder={gmcRulePromptPlaceholder(field.aspectKey)}
              className="min-h-[70px] w-full rounded-md border border-sky-200 bg-white px-2 py-1.5 text-xs text-zinc-900"
            />
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={generateRule}
                disabled={compileTransform.isPending}
                className="inline-flex h-7 items-center gap-1 rounded-md bg-sky-700 px-2.5 text-[11px] font-semibold text-white hover:bg-sky-800 disabled:opacity-50"
              >
                <Sparkles className="h-3 w-3" />
                {compileTransform.isPending ? "Generating..." : "Generate"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setRulePromptOpen(false);
                  setCompiledRule(null);
                }}
                className="h-7 rounded-md border border-sky-200 bg-white px-2.5 text-[11px] font-medium text-sky-800 hover:bg-sky-100"
              >
                Cancel
              </button>
            </div>
            {compiledRule ? (
              <div className="mt-2 rounded-md border border-sky-200 bg-white p-2 text-[11px] text-zinc-700">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold text-zinc-900">Generated rule</div>
                    <div className="mt-0.5 text-sky-800">{compiledRule.explanation}</div>
                  </div>
                  <button
                    type="button"
                    onClick={applyCompiledRule}
                    className="h-7 shrink-0 rounded-md bg-zinc-900 px-2.5 text-[11px] font-semibold text-white hover:bg-zinc-800"
                  >
                    Apply
                  </button>
                </div>
                <pre className="mt-2 max-h-36 overflow-auto rounded bg-zinc-950 p-2 font-mono text-[10px] leading-relaxed text-zinc-50">
                  {prettyJson(compiledRule.transform)}
                </pre>
                {compiledRule.warnings.length > 0 ? (
                  <div className="mt-2 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-amber-800">
                    {compiledRule.warnings.join(" ")}
                  </div>
                ) : null}
                {compiledRule.sample_evaluations.length > 0 ? (
                  <div className="mt-2 space-y-1">
                    {compiledRule.sample_evaluations.slice(0, 4).map((sample) => (
                      <div key={sample.mpn} className="flex items-center justify-between gap-2 rounded border border-zinc-100 px-2 py-1">
                        <span>
                          <Mono>{sample.mpn}</Mono>
                          {sampleSourceLabel(sample.source) ? (
                            <span className="ml-2 text-zinc-500">{sampleSourceLabel(sample.source)}</span>
                          ) : null}
                        </span>
                        <span className="max-w-[210px] truncate font-medium text-zinc-900">
                          {sample.value ?? "-"}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </td>
      <td className="px-3 py-3">
        <Badge label={mappingStatus({ field, mapping })} color={mapping ? "#16A34A" : "#D97706"} small />
        <div className="mt-1 text-[11px] text-zinc-500">GB default</div>
        {suggestion ? (
          <div className="mt-2 rounded-md border border-sky-200 bg-sky-50 px-2 py-1.5 text-[11px] normal-case tracking-normal text-sky-800">
            <div className="font-semibold">AI {suggestion.confidence}</div>
            <div className="mt-0.5">
              <Mono>{suggestion.canonical_key ?? suggestion.constant_value ?? (suggestion.transform ? "rule" : "-")}</Mono>
            </div>
            <div className="mt-0.5 line-clamp-3">{suggestion.reason}</div>
            <button
              type="button"
              onClick={useSuggestion}
              className="mt-1 font-semibold text-sky-900 hover:underline"
            >
              Use suggestion
            </button>
          </div>
        ) : null}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1.5">
          <IconButton title="Save mapping" disabled={upsert.isPending} onClick={save}>
            <Save className="h-3.5 w-3.5" />
          </IconButton>
          <IconButton title="Delete mapping" disabled={!mapping?.id || remove.isPending} onClick={deleteMapping}>
            <Trash2 className="h-3.5 w-3.5" />
          </IconButton>
        </div>
      </td>
    </tr>
  );
}

function GmcMappingRulesPanel() {
  const { data: mappings = [], isLoading } = useChannelMappings("gmc", "GB", null, "all");
  const { data: canonicalAttrs = [], isLoading: canonicalAttrsLoading } = useCanonicalAttributes();
  const upsert = useUpsertChannelMapping();
  const suggestMappings = useSuggestGmcMappings();
  const [aiSuggestions, setAiSuggestions] = useState<GmcAiMappingSuggestion[]>([]);
  const [lastAiRun, setLastAiRun] = useState<{ provider: string; fellBack: boolean; sampleCount: number } | null>(null);
  const canonicalKeys = useMemo(() => {
    return Array.from(new Set(canonicalAttrs.map((attr) => attr.key))).sort();
  }, [canonicalAttrs]);
  const canonicalKeySet = useMemo(() => new Set(canonicalKeys), [canonicalKeys]);

  const mappingByAspect = useMemo(() => {
    const map = new Map<string, ChannelMappingRecord>();
    for (const mapping of mappings) {
      const current = map.get(mapping.aspect_key);
      const score = Number(Boolean(mapping.marketplace)) + Number(Boolean(mapping.category_id));
      const currentScore = current ? Number(Boolean(current.marketplace)) + Number(Boolean(current.category_id)) : -1;
      if (!current || score >= currentScore) map.set(mapping.aspect_key, mapping);
    }
    return map;
  }, [mappings]);

  const rows = useMemo<MappingRowData[]>(
    () => GMC_MAPPING_FIELDS.map((field) => ({ field, mapping: mappingByAspect.get(field.aspectKey) ?? null })),
    [mappingByAspect],
  );
  const suggestionByAspect = useMemo(() => {
    const map = new Map<string, GmcAiMappingSuggestion>();
    for (const suggestion of aiSuggestions) map.set(suggestion.aspect_key, suggestion);
    return map;
  }, [aiSuggestions]);
  const { filters, setFilter, sort, toggleSort, clearFilters, processedRows } = useSimpleTableFilters(rows, {
    accessor: mappingAccessor,
    initialSort: { key: "field", dir: "asc" },
  });
  const { sortKey, sortDir } = sortState(sort);
  const missingStarterRows = rows.filter((row) => !row.mapping && mappingStatus(row) === "starter");

  const applyStarterMappings = async () => {
    if (missingStarterRows.length === 0) return;
    if (canonicalAttrsLoading) {
      toast.error("Canonical attributes are still loading");
      return;
    }
    const unknownCanonical = missingStarterRows
      .map((row) => starterMapping(row.field, row.mapping).canonical_key)
      .filter((key): key is string => Boolean(key && !canonicalKeySet.has(key)));
    if (unknownCanonical.length > 0) {
      toast.error(`Unknown canonical attribute: ${unknownCanonical[0]}`);
      return;
    }
    if (!confirm(`Create ${missingStarterRows.length} starter GMC field mapping(s)?`)) return;
    try {
      for (const row of missingStarterRows) {
        await upsert.mutateAsync(starterMapping(row.field, row.mapping));
      }
      toast.success("Starter GMC mappings saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Starter mapping save failed");
    }
  };

  const generateAiSuggestions = async () => {
    try {
      const result = await suggestMappings.mutateAsync({
        fields: GMC_MAPPING_FIELDS,
        canonicalKeys,
      });
      setAiSuggestions(result.suggestions ?? []);
      setLastAiRun({
        provider: result.provider_used,
        fellBack: result.fell_back,
        sampleCount: result.sample_count,
      });
      toast.success(
        `${result.suggestions?.length ?? 0} GMC mapping suggestion(s) generated` +
          (result.fell_back ? " with OpenAI fallback" : ""),
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "AI suggestion failed");
    }
  };

  const applyAiSuggestions = async () => {
    if (aiSuggestions.length === 0) return;
    if (canonicalAttrsLoading) {
      toast.error("Canonical attributes are still loading");
      return;
    }
    const unknownCanonical = aiSuggestions
      .map((suggestion) => suggestion.canonical_key?.trim() || null)
      .filter((key): key is string => Boolean(key && !canonicalKeySet.has(key)));
    if (unknownCanonical.length > 0) {
      toast.error(`Unknown canonical attribute: ${unknownCanonical[0]}`);
      return;
    }
    if (!confirm(`Save ${aiSuggestions.length} AI-suggested GMC mapping(s)? Existing mappings for those fields will be replaced.`)) return;
    try {
      for (const suggestion of aiSuggestions) {
        const existing = mappingByAspect.get(suggestion.aspect_key) ?? null;
        await upsert.mutateAsync({
          id: existing?.id,
          channel: "gmc",
          marketplace: "GB",
          category_id: null,
          aspect_key: suggestion.aspect_key,
          canonical_key: suggestion.canonical_key?.trim() || null,
          constant_value: suggestion.constant_value?.trim() || null,
          transform: suggestion.transform?.trim() || null,
          notes: [
            suggestion.notes?.trim(),
            `AI suggested (${suggestion.confidence}): ${suggestion.reason}`,
          ].filter(Boolean).join("\n"),
        });
      }
      toast.success("AI-suggested GMC mappings saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "AI mapping save failed");
    }
  };

  return (
    <SurfaceCard noPadding>
      <div className="flex flex-col gap-3 border-b border-zinc-200 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <SectionHead>GMC Mapping Rules</SectionHead>
          <p className="text-xs text-zinc-500">Map app data to GMC fields. Rule JSON is evaluated top-down by the publisher.</p>
          {lastAiRun ? (
            <p className="mt-1 text-[11px] text-sky-700">
              AI suggestions from {lastAiRun.provider === "lovable" ? "Lovable AI" : "OpenAI"}
              {lastAiRun.fellBack ? " fallback" : ""}, using {lastAiRun.sampleCount} product sample(s).
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button type="button" onClick={clearFilters} className="h-8 rounded-md border border-zinc-200 px-2.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50">
            Clear filters
          </button>
          <button
            type="button"
            onClick={generateAiSuggestions}
            disabled={suggestMappings.isPending || canonicalKeys.length === 0}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-sky-200 bg-sky-50 px-2.5 text-xs font-semibold text-sky-800 hover:bg-sky-100 disabled:opacity-50"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Suggest with AI
          </button>
          <button
            type="button"
            onClick={applyAiSuggestions}
            disabled={upsert.isPending || aiSuggestions.length === 0}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-zinc-200 px-2.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
          >
            <Save className="h-3.5 w-3.5" />
            Save AI Suggestions
          </button>
          <button
            type="button"
            onClick={applyStarterMappings}
            disabled={upsert.isPending || missingStarterRows.length === 0}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 text-xs font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-50"
          >
            <Save className="h-3.5 w-3.5" />
            Save Starters
          </button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1240px] text-left text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 text-[11px] uppercase tracking-wide text-zinc-500">
            <tr>
              <SortableTableHead columnKey="field" label="GMC Field" sortKey={sortKey} sortDir={sortDir} onToggleSort={toggleSort} />
              <SortableTableHead columnKey="source" label="App Source" sortKey={sortKey} sortDir={sortDir} onToggleSort={toggleSort} />
              <th className="px-3 py-2 font-semibold">Constant</th>
              <SortableTableHead columnKey="rules" label="Rules" sortKey={sortKey} sortDir={sortDir} onToggleSort={toggleSort} />
              <SortableTableHead columnKey="status" label="Status" sortKey={sortKey} sortDir={sortDir} onToggleSort={toggleSort} />
              <th className="px-4 py-2 font-semibold">Actions</th>
            </tr>
            <tr className="border-t border-zinc-200 normal-case tracking-normal">
              <th className="px-4 py-2"><TableFilterInput value={filters.field ?? ""} onChange={(value) => setFilter("field", value)} placeholder="Field" /></th>
              <th className="px-3 py-2"><TableFilterInput value={filters.source ?? ""} onChange={(value) => setFilter("source", value)} placeholder="Source" /></th>
              <th className="px-3 py-2" />
              <th className="px-3 py-2"><TableFilterInput value={filters.rules ?? ""} onChange={(value) => setFilter("rules", value)} placeholder="Rule" /></th>
              <th className="px-3 py-2"><MultiSelectFilter value={filters.status ?? ""} onChange={(value) => setFilter("status", value)} options={MAPPING_STATUS_OPTIONS} placeholder="All states" /></th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {isLoading ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-zinc-500">Loading mappings...</td>
              </tr>
            ) : processedRows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-zinc-500">No GMC mappings match the current view.</td>
              </tr>
            ) : processedRows.map((row) => (
              <GmcMappingRuleRow
                key={row.field.aspectKey}
                field={row.field}
                mapping={row.mapping}
                canonicalKeys={canonicalKeys}
                suggestion={suggestionByAspect.get(row.field.aspectKey) ?? null}
                canonicalKeySet={canonicalKeySet}
                canonicalAttrsLoading={canonicalAttrsLoading}
              />
            ))}
          </tbody>
        </table>
      </div>
    </SurfaceCard>
  );
}

export default function GmcAdminPage() {
  const [tab, setTab] = useState<Tab>("readiness");
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

  const toggleMany = (skuIds: string[], shouldSelect: boolean) => {
    setSelectedSkuIds((prev) => {
      const next = new Set(prev);
      for (const skuId of skuIds) {
        if (shouldSelect) next.add(skuId);
        else next.delete(skuId);
      }
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
      toast.success(`Queued ${result.queued ?? 0}; processed ${result.processed ?? 0} (${result.skipped ?? 0} skipped, ${result.errors ?? 0} errors)`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Publish failed");
    }
  };

  const publishAll = async () => {
    try {
      const result = await mutations.publishAll.mutateAsync(publishableRows.map((row) => row.sku_id));
      toast.success(`Queued ${result.queued ?? 0}; processed ${result.processed ?? 0} (${result.skipped ?? 0} skipped, ${result.errors ?? 0} errors)`);
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
              Product readiness, publish control, GMC field mapping, and command recovery.
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

        <div className="grid gap-3 md:grid-cols-5">
          <SummaryCard label="Ready" value={readiness.data?.summary.ready ?? 0} color="#16A34A" />
          <SummaryCard label="Warnings" value={readiness.data?.summary.warning ?? 0} color="#D97706" />
          <SummaryCard label="Blocked" value={readiness.data?.summary.blocked ?? 0} color="#DC2626" />
          <SummaryCard label="Excluded no page" value={readiness.data?.summary.excluded_no_web_page ?? 0} color="#71717A" />
          <SummaryCard label="Queue" value={events.data?.length ?? 0} color="#18181B" />
        </div>

        <GmcSettingsCard showOpenLink={false} />

        <div className="flex gap-1 border-b border-zinc-200">
          <TabButton active={tab === "readiness"} onClick={() => setTab("readiness")}>Readiness</TabButton>
          <TabButton active={tab === "queue"} onClick={() => setTab("queue")}>Publish Queue</TabButton>
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
            {(readiness.data?.summary.excluded_no_web_page ?? 0) > 0 && (
              <div className="flex items-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
                <ExternalLink className="h-4 w-4" />
                {readiness.data?.summary.excluded_no_web_page ?? 0} SKU(s) excluded until a published web page exists; GMC publish will queue after the website listing goes live.
              </div>
            )}

            {tab === "readiness" && (
              <ReadinessTable rows={rows} selected={selectedSkuIds} onToggle={toggleSelected} onToggleMany={toggleMany} />
            )}
            {tab === "queue" && <PublishQueue events={events.data ?? []} readinessRows={rows} />}
            {tab === "mapping" && <GmcMappingRulesPanel />}
          </>
        )}
      </div>
    </AdminV2Layout>
  );
}
