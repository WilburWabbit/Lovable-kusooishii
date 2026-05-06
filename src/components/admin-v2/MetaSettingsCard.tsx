import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Facebook, Instagram, Loader2, Megaphone, RefreshCcw, Send, Unplug, XCircle } from "lucide-react";
import { toast } from "sonner";
import {
  useMetaCatalogReadiness,
  useMetaMutations,
  useMetaStatus,
  type MetaAsset,
  type MetaCatalogReadinessRow,
  type MetaCatalogSyncRun,
  type MetaSyncResult,
} from "@/hooks/admin/use-meta";
import { Badge, Mono, SectionHead, SurfaceCard } from "./ui-primitives";

function formatDateTime(value?: string | null): string {
  if (!value) return "-";
  return new Date(value).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function assetLabel(asset: MetaAsset): string {
  const base = asset.name || asset.username || asset.external_id;
  return `${base} (${asset.external_id})`;
}

function formatMoney(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return "-";
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(value);
}

function issueList(values: string[]): string {
  return values.length > 0 ? values.join(" · ").replaceAll("_", " ") : "-";
}

function runBatchHandles(run: MetaCatalogSyncRun): string[] {
  const summary = run.summary ?? {};
  const handles = summary.batch_handles;
  return Array.isArray(handles) ? handles.map(String).filter(Boolean) : [];
}

function readinessBadge(row: MetaCatalogReadinessRow) {
  if (row.status === "ready") return <Badge label="Ready" color="#16A34A" small />;
  if (row.status === "warning") return <Badge label="Warning" color="#D97706" small />;
  return <Badge label="Blocked" color="#DC2626" small />;
}

function AssetSelect({
  label,
  value,
  assets,
  onChange,
}: {
  label: string;
  value: string;
  assets: MetaAsset[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1 text-[11px] font-medium text-zinc-500">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 rounded-md border border-zinc-200 bg-white px-2 text-xs text-zinc-900"
      >
        <option value="">None selected</option>
        {assets.map((asset) => (
          <option key={`${asset.asset_type}:${asset.external_id}`} value={asset.external_id}>
            {assetLabel(asset)}
          </option>
        ))}
      </select>
    </label>
  );
}

function MetaCatalogPanel({
  connected,
  catalogId,
  busy,
  rows,
  runs,
  summary,
  selectedSkuIds,
  onSelectedSkuIds,
  onPreview,
  onSync,
  onCheckBatchStatus,
  lastResult,
  isLoading,
}: {
  connected: boolean;
  catalogId: string;
  busy: boolean;
  rows: MetaCatalogReadinessRow[];
  runs: MetaCatalogSyncRun[];
  summary?: {
    total: number;
    ready: number;
    warning: number;
    blocked: number;
    syncable: number;
    out_of_stock: number;
  };
  selectedSkuIds: string[];
  onSelectedSkuIds: (ids: string[]) => void;
  onPreview: (skuIds?: string[]) => void;
  onSync: (skuIds?: string[]) => void;
  onCheckBatchStatus: (run: MetaCatalogSyncRun, handle: string) => void;
  lastResult: MetaSyncResult | null;
  isLoading: boolean;
}) {
  const [filter, setFilter] = useState<"syncable" | "all" | "blocked">("syncable");
  const visibleRows = useMemo(() => {
    const filtered = rows.filter((row) => {
      if (filter === "blocked") return row.status === "blocked";
      if (filter === "syncable") return row.status !== "blocked";
      return true;
    });
    return filtered.slice(0, 24);
  }, [filter, rows]);

  const syncableVisibleIds = visibleRows.filter((row) => row.status !== "blocked").map((row) => row.sku_id);
  const selectedSet = new Set(selectedSkuIds);
  const allVisibleSelected = syncableVisibleIds.length > 0 && syncableVisibleIds.every((id) => selectedSet.has(id));

  const toggleVisible = () => {
    if (allVisibleSelected) {
      onSelectedSkuIds(selectedSkuIds.filter((id) => !syncableVisibleIds.includes(id)));
      return;
    }
    onSelectedSkuIds([...new Set([...selectedSkuIds, ...syncableVisibleIds])]);
  };

  const toggleRow = (row: MetaCatalogReadinessRow) => {
    if (row.status === "blocked") return;
    onSelectedSkuIds(selectedSet.has(row.sku_id)
      ? selectedSkuIds.filter((id) => id !== row.sku_id)
      : [...selectedSkuIds, row.sku_id]);
  };

  return (
    <div className="mt-4 border-t border-zinc-200 pt-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Catalog sync</p>
          <p className="mt-1 text-xs text-zinc-500">
            Catalog <Mono>{catalogId || "-"}</Mono>
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => onPreview(selectedSkuIds.length > 0 ? selectedSkuIds : undefined)}
            disabled={!connected || !catalogId || busy}
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-zinc-200 px-2.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
          >
            <Instagram className="h-3.5 w-3.5" />
            Preview
          </button>
          <button
            type="button"
            onClick={() => onSync(selectedSkuIds.length > 0 ? selectedSkuIds : undefined)}
            disabled={!connected || !catalogId || busy}
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-zinc-900 bg-zinc-900 px-2.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
          >
            <Send className="h-3.5 w-3.5" />
            Sync
          </button>
        </div>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {[
          ["Ready", summary?.ready ?? 0, "#16A34A"],
          ["Warnings", summary?.warning ?? 0, "#D97706"],
          ["Blocked", summary?.blocked ?? 0, "#DC2626"],
          ["Out of stock", summary?.out_of_stock ?? 0, "#71717A"],
          ["Syncable", summary?.syncable ?? 0, "#2563EB"],
        ].map(([label, value, color]) => (
          <div key={String(label)} className="rounded-md border border-zinc-200 p-2">
            <p className="text-[10px] uppercase tracking-wide text-zinc-400">{label}</p>
            <p className="font-mono text-lg font-bold" style={{ color: String(color) }}>{value}</p>
          </div>
        ))}
      </div>

      {lastResult ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
          {lastResult.errors > 0 ? <AlertTriangle className="h-3.5 w-3.5 text-amber-600" /> : <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />}
          <span>{lastResult.dry_run ? "Previewed" : "Sent"} <Mono>{lastResult.dry_run ? lastResult.prepared : lastResult.sent}</Mono></span>
          <span>Skipped <Mono>{lastResult.skipped}</Mono></span>
          <span>Errors <Mono>{lastResult.errors}</Mono></span>
          {lastResult.batch_handles?.length ? <span>Handles <Mono>{lastResult.batch_handles.length}</Mono></span> : null}
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={toggleVisible}
          disabled={syncableVisibleIds.length === 0}
          className="inline-flex h-7 items-center justify-center rounded-md border border-zinc-200 px-2 text-[11px] font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
        >
          {allVisibleSelected ? "Clear visible" : "Select visible"}
        </button>
        <select
          value={filter}
          onChange={(event) => setFilter(event.target.value as typeof filter)}
          className="h-7 rounded-md border border-zinc-200 bg-white px-2 text-[11px] text-zinc-700"
        >
          <option value="syncable">Syncable</option>
          <option value="blocked">Blocked</option>
          <option value="all">All</option>
        </select>
        <span className="text-[11px] text-zinc-500">
          Selected <Mono>{selectedSkuIds.length}</Mono>
        </span>
      </div>

      <div className="mt-2 overflow-x-auto rounded-md border border-zinc-200">
        <div className="grid min-w-[720px] grid-cols-[32px_1.1fr_1fr_80px_80px_1fr] bg-zinc-50 px-2 py-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
          <span />
          <span>SKU</span>
          <span>Status</span>
          <span>Stock</span>
          <span>Price</span>
          <span>Notes</span>
        </div>
        {isLoading ? (
          <div className="flex items-center gap-2 px-3 py-4 text-xs text-zinc-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading catalog rows...
          </div>
        ) : visibleRows.length === 0 ? (
          <div className="px-3 py-4 text-xs text-zinc-500">No catalog rows.</div>
        ) : (
          visibleRows.map((row) => (
            <button
              key={row.sku_id}
              type="button"
              onClick={() => toggleRow(row)}
              className="grid min-w-[720px] w-full grid-cols-[32px_1.1fr_1fr_80px_80px_1fr] items-center border-t border-zinc-100 px-2 py-2 text-left text-xs hover:bg-zinc-50"
            >
              <span>
                <input
                  type="checkbox"
                  checked={selectedSet.has(row.sku_id)}
                  disabled={row.status === "blocked"}
                  onChange={() => toggleRow(row)}
                  onClick={(event) => event.stopPropagation()}
                  className="h-3.5 w-3.5"
                />
              </span>
              <span className="min-w-0">
                <span className="block truncate font-mono text-zinc-900">{row.sku_code}</span>
                <span className="block truncate text-[11px] text-zinc-500">{row.product_name ?? row.mpn ?? "-"}</span>
              </span>
              <span>{readinessBadge(row)}</span>
              <span className="font-mono text-zinc-700">{row.stock_count}</span>
              <span className="font-mono text-zinc-700">{formatMoney(row.price)}</span>
              <span className="truncate text-[11px] text-zinc-500">{issueList([...row.blocking, ...row.warnings])}</span>
            </button>
          ))
        )}
      </div>

      <div className="mt-4">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Recent runs</p>
        <div className="overflow-hidden rounded-md border border-zinc-200">
          {runs.length === 0 ? (
            <div className="px-3 py-4 text-xs text-zinc-500">No Meta sync runs.</div>
          ) : (
            runs.map((run) => {
              const handles = runBatchHandles(run);
              return (
                <div key={run.id} className="grid gap-2 border-t border-zinc-100 px-3 py-2 text-xs first:border-t-0 sm:grid-cols-[1fr_80px_80px_80px_120px] sm:items-center">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      {run.status === "failed" ? <XCircle className="h-3.5 w-3.5 text-red-600" /> : <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />}
                      <span className="font-medium text-zinc-900">{run.status}</span>
                      {run.dry_run ? <Badge label="Preview" color="#71717A" small /> : null}
                    </div>
                    <p className="mt-1 text-[11px] text-zinc-500">{formatDateTime(run.started_at)} · {handles.length} handle(s)</p>
                  </div>
                  <span>Sent <Mono>{run.sent_items}</Mono></span>
                  <span>Skip <Mono>{run.skipped_items}</Mono></span>
                  <span>Err <Mono>{run.error_items}</Mono></span>
                  <button
                    type="button"
                    onClick={() => handles[0] && onCheckBatchStatus(run, handles[0])}
                    disabled={busy || handles.length === 0}
                    className="inline-flex h-7 items-center justify-center gap-1.5 rounded-md border border-zinc-200 px-2 text-[11px] font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
                  >
                    <RefreshCcw className="h-3.5 w-3.5" />
                    Check
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

export function MetaSettingsCard() {
  const { data: status, isLoading } = useMetaStatus();
  const mutations = useMetaMutations();
  const [businessId, setBusinessId] = useState("");
  const [catalogId, setCatalogId] = useState("");
  const [pageId, setPageId] = useState("");
  const [instagramAccountId, setInstagramAccountId] = useState("");
  const [adAccountId, setAdAccountId] = useState("");
  const [campaignName, setCampaignName] = useState("");
  const [selectedSkuIds, setSelectedSkuIds] = useState<string[]>([]);
  const [lastSyncResult, setLastSyncResult] = useState<MetaSyncResult | null>(null);
  const readiness = useMetaCatalogReadiness(catalogId, Boolean(status?.connected && catalogId));

  useEffect(() => {
    setBusinessId(status?.selected_business_id ?? "");
    setCatalogId(status?.selected_catalog_id ?? "");
    setPageId(status?.selected_page_id ?? "");
    setInstagramAccountId(status?.selected_instagram_account_id ?? "");
    setAdAccountId(status?.selected_ad_account_id ?? "");
  }, [
    status?.selected_business_id,
    status?.selected_catalog_id,
    status?.selected_page_id,
    status?.selected_instagram_account_id,
    status?.selected_ad_account_id,
  ]);

  useEffect(() => {
    if (!campaignName) {
      setCampaignName(`Kuso Oishii catalog sales ${new Date().toISOString().slice(0, 10)}`);
    }
  }, [campaignName]);

  const busy = Object.values(mutations).some((mutation) => mutation.isPending);
  const assets = status?.assets;
  const counts = useMemo(() => ({
    businesses: assets?.businesses.length ?? 0,
    catalogs: assets?.catalogs.length ?? 0,
    pages: assets?.pages.length ?? 0,
    instagram: assets?.instagram_accounts.length ?? 0,
    adAccounts: assets?.ad_accounts.length ?? 0,
  }), [assets]);

  const connect = async () => {
    try {
      await mutations.connect.mutateAsync();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Meta connect failed");
    }
  };

  const refreshAssets = async () => {
    try {
      await mutations.refreshAssets.mutateAsync();
      toast.success("Meta assets refreshed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Refresh failed");
    }
  };

  const saveDefaults = async () => {
    try {
      await mutations.saveDefaults.mutateAsync({
        businessId: businessId || null,
        catalogId: catalogId || null,
        pageId: pageId || null,
        instagramAccountId: instagramAccountId || null,
        adAccountId: adAccountId || null,
      });
      toast.success("Meta defaults saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    }
  };

  const syncCatalog = async (dryRun: boolean, skuIds?: string[]) => {
    try {
      const result = await mutations.syncCatalog.mutateAsync({ catalogId: catalogId || null, dryRun, skuIds });
      setLastSyncResult(result);
      if (result.errors > 0) {
        toast.error(`${result.sent} synced, ${result.errors} batch error(s), ${result.skipped} skipped`, { duration: 10000 });
      } else {
        toast.success(dryRun ? `${result.prepared} Meta items previewed` : `${result.sent} Meta catalog items sent`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Catalog sync failed");
    }
  };

  const checkBatchStatus = async (run: MetaCatalogSyncRun, handle: string) => {
    try {
      const result = await mutations.checkBatchStatus.mutateAsync({ catalogId: catalogId || null, handle, runId: run.id });
      toast.success(`Meta batch ${result.status ?? "checked"}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Batch status check failed");
    }
  };

  const createPausedCampaign = async () => {
    if (!campaignName.trim()) {
      toast.error("Campaign name is required");
      return;
    }

    try {
      const result = await mutations.createPausedCampaign.mutateAsync({
        adAccountId: adAccountId || null,
        name: campaignName.trim(),
      });
      toast.success(`Paused campaign created: ${result.campaign_id ?? "Meta draft"}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Campaign creation failed");
    }
  };

  const disconnect = async () => {
    try {
      await mutations.disconnect.mutateAsync();
      toast.success("Disconnected from Meta");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Disconnect failed");
    }
  };

  if (isLoading) {
    return (
      <SurfaceCard>
        <SectionHead>Meta</SectionHead>
        <p className="py-4 text-xs text-zinc-500">Checking connection...</p>
      </SurfaceCard>
    );
  }

  return (
    <SurfaceCard>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <SectionHead>Meta</SectionHead>
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              label={status?.connected ? (status.expired ? "Expired" : "Connected") : "Disconnected"}
              color={status?.connected ? (status.expired ? "#D97706" : "#16A34A") : "#DC2626"}
              small
            />
            <span className="text-xs text-zinc-500">
              Graph <Mono>{status?.graph_version ?? "v25.0"}</Mono>
            </span>
            <span className="text-xs text-zinc-500">
              Token <Mono>{formatDateTime(status?.token_expires_at)}</Mono>
            </span>
          </div>
          {status?.meta_user_name ? (
            <p className="mt-2 text-xs text-zinc-500">
              Connected as <Mono>{status.meta_user_name}</Mono>
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={connect}
            disabled={busy}
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-zinc-200 px-2.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
          >
            {mutations.connect.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Facebook className="h-3.5 w-3.5" />}
            {status?.connected ? "Reconnect" : "Connect"}
          </button>
          <button
            type="button"
            onClick={refreshAssets}
            disabled={!status?.connected || busy}
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-zinc-200 px-2.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
          >
            <RefreshCcw className="h-3.5 w-3.5" />
            Refresh
          </button>
          <button
            type="button"
            onClick={disconnect}
            disabled={!status?.connected || busy}
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-red-200 px-2.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            <Unplug className="h-3.5 w-3.5" />
            Disconnect
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-md border border-zinc-200 p-2">
          <p className="text-[10px] uppercase tracking-wide text-zinc-400">Businesses</p>
          <p className="font-mono text-lg font-bold text-zinc-900">{counts.businesses}</p>
        </div>
        <div className="rounded-md border border-zinc-200 p-2">
          <p className="text-[10px] uppercase tracking-wide text-zinc-400">Catalogs</p>
          <p className="font-mono text-lg font-bold text-zinc-900">{counts.catalogs}</p>
        </div>
        <div className="rounded-md border border-zinc-200 p-2">
          <p className="text-[10px] uppercase tracking-wide text-zinc-400">Pages</p>
          <p className="font-mono text-lg font-bold text-zinc-900">{counts.pages}</p>
        </div>
        <div className="rounded-md border border-zinc-200 p-2">
          <p className="text-[10px] uppercase tracking-wide text-zinc-400">Instagram</p>
          <p className="font-mono text-lg font-bold text-zinc-900">{counts.instagram}</p>
        </div>
        <div className="rounded-md border border-zinc-200 p-2">
          <p className="text-[10px] uppercase tracking-wide text-zinc-400">Ad Accounts</p>
          <p className="font-mono text-lg font-bold text-zinc-900">{counts.adAccounts}</p>
        </div>
      </div>

      <div className="mt-4 grid gap-2 md:grid-cols-2">
        <AssetSelect label="Business" value={businessId} assets={assets?.businesses ?? []} onChange={setBusinessId} />
        <AssetSelect label="Product catalog" value={catalogId} assets={assets?.catalogs ?? []} onChange={setCatalogId} />
        <AssetSelect label="Facebook page" value={pageId} assets={assets?.pages ?? []} onChange={setPageId} />
        <AssetSelect label="Instagram account" value={instagramAccountId} assets={assets?.instagram_accounts ?? []} onChange={setInstagramAccountId} />
        <AssetSelect label="Ad account" value={adAccountId} assets={assets?.ad_accounts ?? []} onChange={setAdAccountId} />
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={saveDefaults}
          disabled={!status?.connected || busy}
          className="inline-flex h-8 items-center justify-center rounded-md border border-zinc-200 px-2.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
        >
          {mutations.saveDefaults.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          Save defaults
        </button>
      </div>

      <MetaCatalogPanel
        connected={Boolean(status?.connected)}
        catalogId={catalogId}
        busy={busy}
        rows={readiness.data?.rows ?? []}
        runs={readiness.data?.recent_runs ?? []}
        summary={readiness.data?.summary}
        selectedSkuIds={selectedSkuIds}
        onSelectedSkuIds={setSelectedSkuIds}
        onPreview={(skuIds) => syncCatalog(true, skuIds)}
        onSync={(skuIds) => syncCatalog(false, skuIds)}
        onCheckBatchStatus={checkBatchStatus}
        lastResult={lastSyncResult}
        isLoading={readiness.isLoading}
      />

      <div className="mt-4 border-t border-zinc-200 pt-3">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Ads</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={campaignName}
            onChange={(event) => setCampaignName(event.target.value)}
            className="h-9 min-w-0 flex-1 rounded-md border border-zinc-200 px-2 text-xs text-zinc-900"
          />
          <button
            type="button"
            onClick={createPausedCampaign}
            disabled={!status?.connected || !adAccountId || busy}
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-zinc-200 px-2.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
          >
            {mutations.createPausedCampaign.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Megaphone className="h-3.5 w-3.5" />}
            Create paused campaign
          </button>
        </div>
      </div>
    </SurfaceCard>
  );
}
