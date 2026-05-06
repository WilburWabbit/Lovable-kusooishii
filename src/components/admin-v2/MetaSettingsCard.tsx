import { useEffect, useMemo, useState } from "react";
import { Facebook, Instagram, Loader2, Megaphone, RefreshCcw, Send, Unplug } from "lucide-react";
import { toast } from "sonner";
import { useMetaMutations, useMetaStatus, type MetaAsset } from "@/hooks/admin/use-meta";
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

export function MetaSettingsCard() {
  const { data: status, isLoading } = useMetaStatus();
  const mutations = useMetaMutations();
  const [businessId, setBusinessId] = useState("");
  const [catalogId, setCatalogId] = useState("");
  const [pageId, setPageId] = useState("");
  const [instagramAccountId, setInstagramAccountId] = useState("");
  const [adAccountId, setAdAccountId] = useState("");
  const [campaignName, setCampaignName] = useState("");

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

  const syncCatalog = async (dryRun: boolean) => {
    try {
      const result = await mutations.syncCatalog.mutateAsync({ catalogId: catalogId || null, dryRun });
      if (result.errors > 0) {
        toast.error(`${result.sent} synced, ${result.errors} batch error(s), ${result.skipped} skipped`, { duration: 10000 });
      } else {
        toast.success(dryRun ? `${result.prepared} Meta items previewed` : `${result.sent} Meta catalog items sent`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Catalog sync failed");
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
        <button
          type="button"
          onClick={() => syncCatalog(true)}
          disabled={!status?.connected || !catalogId || busy}
          className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-zinc-200 px-2.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
        >
          <Instagram className="h-3.5 w-3.5" />
          Preview catalog
        </button>
        <button
          type="button"
          onClick={() => syncCatalog(false)}
          disabled={!status?.connected || !catalogId || busy}
          className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-zinc-200 px-2.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
        >
          {mutations.syncCatalog.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          Sync catalog
        </button>
      </div>

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
