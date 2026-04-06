// ============================================================
// BrickEconomy hooks
// - useBrickEconomyPriceHistory: price history for a single item
// - useBrickEconomyQuota: daily quota usage (calls today / 100)
// - useBrickEconomyLastSync: most recent successful bulk sync
// ============================================================

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface PriceHistoryRow {
  id: string;
  item_type: string;
  item_number: string;
  current_value: number | null;
  growth: number | null;
  retail_price: number | null;
  currency: string;
  source: "bulk_sync" | "individual";
  recorded_at: string;
}

export interface BrickEconomyQuota {
  calls_today: number;
  quota: number;
  remaining: number;
  last_sync_at: string | null;
}

// Price history for a single item (set or minifig)
export function useBrickEconomyPriceHistory(
  itemType: "set" | "minifig",
  itemNumber: string,
) {
  return useQuery({
    queryKey: ["brickeconomy", "price-history", itemType, itemNumber],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("brickeconomy_price_history")
        .select("*")
        .eq("item_type", itemType)
        .eq("item_number", itemNumber)
        .order("recorded_at", { ascending: true });

      if (error) throw new Error(error.message);
      return (data ?? []) as PriceHistoryRow[];
    },
    enabled: !!itemNumber,
  });
}

// Daily quota usage — count audit_events for today's BE syncs
export function useBrickEconomyQuota() {
  return useQuery({
    queryKey: ["brickeconomy", "quota"],
    queryFn: async () => {
      const todayStart = new Date();
      todayStart.setUTCHours(0, 0, 0, 0);

      const { count, error } = await supabase
        .from("audit_event")
        .select("id", { count: "exact", head: true })
        .eq("entity_type", "brickeconomy_sync")
        .gte("created_at", todayStart.toISOString());

      if (error) throw new Error(error.message);

      // Each bulk sync = 2 calls; each individual lookup = 1 call
      // The audit_event rows for bulk syncs contain api_calls in after_json;
      // individual lookups write one event per call. Sum them properly:
      const { data: events } = await supabase
        .from("audit_event")
        .select("after_json, source_system")
        .eq("entity_type", "brickeconomy_sync")
        .gte("created_at", todayStart.toISOString())
        .order("created_at", { ascending: false });

      let callsToday = 0;
      for (const ev of events ?? []) {
        const aj = ev.after_json as Record<string, unknown> | null;
        const apiCalls = aj?.api_calls as number | null;
        callsToday += apiCalls ?? 1;
      }

      // Last bulk sync timestamp
      const lastBulk = (events ?? []).find(
        (e) => (e.after_json as Record<string, unknown> | null)?.api_calls === 2,
      );
      const lastSyncAt = lastBulk
        ? null // we only have after_json; get the real timestamp separately
        : null;

      const { data: lastEvent } = await supabase
        .from("audit_event")
        .select("created_at")
        .eq("entity_type", "brickeconomy_sync")
        .eq("trigger_type", "brickeconomy_sync")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const QUOTA = 100;
      return {
        calls_today: callsToday,
        quota: QUOTA,
        remaining: Math.max(0, QUOTA - callsToday),
        last_sync_at: lastEvent?.created_at ?? null,
      } as BrickEconomyQuota;
    },
    // Refresh every 60 seconds so quota stays current
    refetchInterval: 60_000,
  });
}
