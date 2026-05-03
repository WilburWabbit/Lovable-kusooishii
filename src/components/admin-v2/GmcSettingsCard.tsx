import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ExternalLink, Loader2, RefreshCcw, Unplug } from "lucide-react";
import { toast } from "sonner";
import { invokeWithAuth } from "@/lib/invokeWithAuth";
import { useGmcMutations, useGmcStatus } from "@/hooks/admin/use-gmc";
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

export function GmcSettingsCard({ showOpenLink = true }: { showOpenLink?: boolean }) {
  const { data: status, isLoading } = useGmcStatus();
  const mutations = useGmcMutations();
  const [merchantId, setMerchantId] = useState("");
  const [dataSource, setDataSource] = useState("");

  useEffect(() => {
    setMerchantId(status?.merchant_id ?? "");
    setDataSource(status?.data_source ?? "");
  }, [status?.merchant_id, status?.data_source]);

  const busy =
    mutations.saveConfig.isPending ||
    mutations.disconnect.isPending ||
    mutations.refreshToken.isPending;

  const saveConfig = async () => {
    if (!merchantId.trim()) {
      toast.error("Merchant ID is required");
      return;
    }
    try {
      await mutations.saveConfig.mutateAsync({
        merchantId: merchantId.trim(),
        dataSource: dataSource.trim() || null,
      });
      toast.success("Google Merchant config saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    }
  };

  const connect = async () => {
    if (!merchantId.trim()) {
      toast.error("Enter Merchant ID first");
      return;
    }
    localStorage.setItem("gmc_merchant_id", merchantId.trim());
    localStorage.setItem("gmc_data_source", dataSource.trim());
    try {
      const data = await invokeWithAuth<{ url: string }>("gmc-auth", { action: "authorize_url" });
      window.location.href = data.url;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Connect failed");
    }
  };

  const disconnect = async () => {
    try {
      await mutations.disconnect.mutateAsync();
      toast.success("Disconnected from Google Merchant Centre");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Disconnect failed");
    }
  };

  const refresh = async () => {
    try {
      await mutations.refreshToken.mutateAsync();
      toast.success("Token refreshed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Refresh failed");
    }
  };

  if (isLoading) {
    return (
      <SurfaceCard>
        <SectionHead>Google Merchant Centre</SectionHead>
        <p className="py-4 text-xs text-zinc-500">Checking connection...</p>
      </SurfaceCard>
    );
  }

  return (
    <SurfaceCard>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <SectionHead>Google Merchant Centre</SectionHead>
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              label={status?.connected ? (status.expired ? "Expired" : "Connected") : "Disconnected"}
              color={status?.connected ? (status.expired ? "#D97706" : "#16A34A") : "#DC2626"}
              small
            />
            <span className="text-xs text-zinc-500">
              Token <Mono>{formatDateTime(status?.token_expires_at)}</Mono>
            </span>
          </div>
        </div>
        {showOpenLink && (
          <Link
            to="/admin/gmc"
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-zinc-200 px-2.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
          >
            Open Cockpit
            <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        )}
      </div>

      <div className="mt-4 grid gap-2 md:grid-cols-2">
        <label className="grid gap-1 text-[11px] font-medium text-zinc-500">
          Merchant ID
          <input
            value={merchantId}
            onChange={(event) => setMerchantId(event.target.value)}
            className="h-9 rounded-md border border-zinc-200 px-2 text-xs text-zinc-900"
          />
        </label>
        <label className="grid gap-1 text-[11px] font-medium text-zinc-500">
          Data Source
          <input
            value={dataSource}
            onChange={(event) => setDataSource(event.target.value)}
            className="h-9 rounded-md border border-zinc-200 px-2 text-xs text-zinc-900"
          />
        </label>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={saveConfig}
          disabled={busy}
          className="inline-flex h-8 items-center justify-center rounded-md border border-zinc-200 px-2.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
        >
          {mutations.saveConfig.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          Save
        </button>
        <button
          type="button"
          onClick={connect}
          disabled={busy}
          className="inline-flex h-8 items-center justify-center rounded-md border border-zinc-200 px-2.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
        >
          Connect
        </button>
        <button
          type="button"
          onClick={refresh}
          disabled={!status?.connected || busy}
          className="inline-flex h-8 items-center justify-center rounded-md border border-zinc-200 px-2.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
        >
          <RefreshCcw className="mr-1.5 h-3.5 w-3.5" />
          Refresh
        </button>
        <button
          type="button"
          onClick={disconnect}
          disabled={!status?.connected || busy}
          className="inline-flex h-8 items-center justify-center rounded-md border border-red-200 px-2.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
        >
          <Unplug className="mr-1.5 h-3.5 w-3.5" />
          Disconnect
        </button>
      </div>
    </SurfaceCard>
  );
}
