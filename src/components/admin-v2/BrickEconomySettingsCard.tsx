// ============================================================
// Admin V2 — BrickEconomy Settings Card
// Sync trigger (bulk sets + minifigs), quota gauge, last sync.
// Weekly schedule runs via Supabase pg_cron (configured in DB).
// ============================================================

import { useState } from "react";
import { SurfaceCard, SectionHead, Badge, Mono } from "./ui-primitives";
import { invokeWithAuth } from "@/lib/invokeWithAuth";
import { toast } from "sonner";
import { Loader2, RefreshCw } from "lucide-react";
import { useBrickEconomyQuota } from "@/hooks/admin/use-brickeconomy";
import { useQueryClient } from "@tanstack/react-query";

interface SyncResult {
  sets_synced?: number;
  minifigs_synced?: number;
  catalog_matches?: number;
  insert_errors?: number;
  error?: string;
  syncs_today?: number;
  calls_today?: number;
  quota?: number;
}

function QuotaBar({ used, total }: { used: number; total: number }) {
  const pct = Math.min(100, (used / total) * 100);
  const color =
    pct >= 90 ? "#EF4444" : pct >= 70 ? "#F59E0B" : "#22C55E";

  return (
    <div>
      <div className="flex justify-between text-[10px] text-zinc-500 mb-1">
        <span>API quota today</span>
        <span style={{ color }}>
          {used} / {total} calls
        </span>
      </div>
      <div className="h-1.5 bg-zinc-200 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <p className="text-[10px] text-zinc-400 mt-0.5">
        {total - used} calls remaining today · resets at UTC midnight
      </p>
    </div>
  );
}

export function BrickEconomySettingsCard() {
  const queryClient = useQueryClient();
  const { data: quota, isLoading: quotaLoading } = useBrickEconomyQuota();
  const [syncing, setSyncing] = useState(false);

  const syncNow = async () => {
    setSyncing(true);
    try {
      const data = await invokeWithAuth<SyncResult>("brickeconomy-sync");
      if (data?.error) {
        if (data.syncs_today !== undefined) {
          // Quota exhausted response
          toast.error(
            `Daily quota reached — ${data.calls_today ?? "?"}/${data.quota ?? 100} calls used today`,
          );
        } else {
          throw new Error(data.error);
        }
        return;
      }
      const parts: string[] = [];
      if (data.sets_synced) parts.push(`${data.sets_synced} sets`);
      if (data.minifigs_synced) parts.push(`${data.minifigs_synced} minifigs`);
      if (data.catalog_matches) parts.push(`${data.catalog_matches} catalog matches`);
      toast.success(
        parts.length
          ? `Synced: ${parts.join(", ")}`
          : "Sync complete (no items returned)",
      );
      // Invalidate quota and price history queries
      queryClient.invalidateQueries({ queryKey: ["brickeconomy"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const Btn = ({
    onClick,
    disabled,
    busy,
    children,
  }: {
    onClick: () => void;
    disabled?: boolean;
    busy?: boolean;
    children: React.ReactNode;
  }) => (
    <button
      onClick={onClick}
      disabled={disabled || syncing}
      className="px-3 py-1.5 rounded text-xs font-medium border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
    >
      {busy ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <RefreshCw className="h-3 w-3" />
      )}
      {children}
    </button>
  );

  const lastSync = quota?.last_sync_at
    ? new Date(quota.last_sync_at).toLocaleString()
    : "Never";

  return (
    <SurfaceCard>
      <div className="flex items-center justify-between">
        <SectionHead>BrickEconomy</SectionHead>
        <Badge label="API" color="#F59E0B" small />
      </div>

      <div className="mt-3 space-y-4">
        {/* Quota gauge */}
        {quotaLoading ? (
          <p className="text-[11px] text-zinc-400">Checking quota...</p>
        ) : quota ? (
          <QuotaBar used={quota.calls_today} total={quota.quota} />
        ) : null}

        {/* Last sync */}
        <div>
          <p className="text-[10px] text-zinc-500">
            Last bulk sync:{" "}
            <Mono className="text-[10px]">{lastSync}</Mono>
          </p>
          <p className="text-[10px] text-zinc-400 mt-0.5">
            Scheduled: weekly (Sunday 02:00 UTC) · each bulk sync uses 2 API calls
          </p>
        </div>

        {/* Actions */}
        <div>
          <p className="text-[9px] uppercase tracking-wider text-zinc-400 mb-1.5">
            Sync
          </p>
          <div className="flex flex-wrap gap-1.5">
            <Btn onClick={syncNow} busy={syncing}>
              {syncing ? "Syncing..." : "Sync All Sets & Minifigs"}
            </Btn>
          </div>
          <p className="text-[10px] text-zinc-400 mt-1.5">
            Fetches{" "}
            <Mono className="text-[10px]">GET /collection/sets</Mono> and{" "}
            <Mono className="text-[10px]">GET /collection/minifigs</Mono> in
            parallel. Replaces canonical collection data and appends price
            history snapshots.
          </p>
        </div>

        {/* Channel overrides note */}
        <div className="border-t border-zinc-100 pt-3">
          <p className="text-[10px] text-zinc-400">
            Channel-specific price overrides are stored in{" "}
            <Mono className="text-[10px]">brickeconomy_channel_overrides</Mono>{" "}
            and persist across BrickEconomy refreshes. Per-product overrides can
            be set on each product's Channels tab.
          </p>
        </div>
      </div>
    </SurfaceCard>
  );
}
