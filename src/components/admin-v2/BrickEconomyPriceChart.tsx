// ============================================================
// Admin V2 — BrickEconomy Price Chart
// Line chart + data table for per-product price history.
// Also renders a "Refresh from BrickEconomy" button that calls
// fetch-product-data for individual set lookups.
// ============================================================

import { useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { SurfaceCard, SectionHead, Mono } from "./ui-primitives";
import { useBrickEconomyPriceHistory } from "@/hooks/admin/use-brickeconomy";
import { invokeWithAuth } from "@/lib/invokeWithAuth";
import { toast } from "sonner";
import { Loader2, RefreshCw } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

interface BrickEconomyPriceChartProps {
  /** MPN e.g. "75367-1" — used to derive the set number for the API call */
  mpn: string;
  /** If known, pass "set" or "minifig" to query the right history rows */
  itemType?: "set" | "minifig";
}

function fmt(val: number | null | undefined, currency = "GBP"): string {
  if (val == null) return "—";
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(val);
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function fmtShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
  });
}

export function BrickEconomyPriceChart({
  mpn,
  itemType = "set",
}: BrickEconomyPriceChartProps) {
  const queryClient = useQueryClient();
  const { data: history = [], isLoading } = useBrickEconomyPriceHistory(
    itemType,
    mpn,
  );
  const [refreshing, setRefreshing] = useState(false);

  const refreshIndividual = async () => {
    setRefreshing(true);
    try {
      await invokeWithAuth("fetch-product-data", { mpn });
      toast.success(`Refreshed market data for ${mpn}`);
      // Invalidate price history and product queries
      queryClient.invalidateQueries({ queryKey: ["brickeconomy", "price-history"] });
      queryClient.invalidateQueries({ queryKey: ["products", mpn] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  };

  // Deduplicate to one data point per day (latest value wins)
  const chartData = Object.values(
    history.reduce<Record<string, { date: string; current_value: number | null; retail_price: number | null; source: string }>>(
      (acc, row) => {
        const day = row.recorded_at.slice(0, 10);
        if (!acc[day] || row.recorded_at > acc[day].date) {
          acc[day] = {
            date: day,
            current_value: row.current_value,
            retail_price: row.retail_price,
            source: row.source,
          };
        }
        return acc;
      },
      {},
    ),
  ).sort((a, b) => a.date.localeCompare(b.date));

  const latestRow = history.length > 0 ? history[history.length - 1] : null;

  return (
    <SurfaceCard>
      <div className="flex items-center justify-between mb-3">
        <SectionHead>BrickEconomy Market Data</SectionHead>
        <button
          onClick={refreshIndividual}
          disabled={refreshing}
          className="px-3 py-1.5 rounded text-xs font-medium border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
        >
          {refreshing ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="h-3 w-3" />
          )}
          {refreshing ? "Refreshing..." : "Refresh from BrickEconomy"}
        </button>
      </div>

      {/* Summary row */}
      {latestRow && (
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="bg-zinc-50 rounded p-2.5">
            <div className="text-[10px] text-zinc-500 mb-0.5">Current Value</div>
            <Mono color="teal" className="text-sm">
              {fmt(latestRow.current_value, latestRow.currency)}
            </Mono>
          </div>
          <div className="bg-zinc-50 rounded p-2.5">
            <div className="text-[10px] text-zinc-500 mb-0.5">Retail Price</div>
            <Mono className="text-sm">
              {fmt(latestRow.retail_price, latestRow.currency)}
            </Mono>
          </div>
          <div className="bg-zinc-50 rounded p-2.5">
            <div className="text-[10px] text-zinc-500 mb-0.5">Growth</div>
            <Mono
              color={
                (latestRow.growth ?? 0) >= 0 ? "green" : "red"
              }
              className="text-sm"
            >
              {latestRow.growth != null
                ? `${latestRow.growth >= 0 ? "+" : ""}${latestRow.growth.toFixed(1)}%`
                : "—"}
            </Mono>
          </div>
        </div>
      )}

      {/* Chart */}
      {isLoading ? (
        <div className="h-40 flex items-center justify-center text-zinc-400 text-sm">
          Loading price history...
        </div>
      ) : chartData.length === 0 ? (
        <div className="h-40 flex items-center justify-center text-zinc-400 text-sm">
          No price history yet. Click "Refresh from BrickEconomy" to fetch data.
        </div>
      ) : (
        <div className="h-52 mb-4">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={chartData}
              margin={{ top: 4, right: 8, left: 0, bottom: 4 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fill: "#A1A1AA" }}
                tickFormatter={fmtShortDate}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tick={{ fontSize: 10, fill: "#A1A1AA" }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => `£${v}`}
                width={48}
              />
              <Tooltip
                contentStyle={{
                  fontSize: 11,
                  border: "1px solid #E4E4E7",
                  borderRadius: 6,
                  boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
                }}
                formatter={(value: number, name: string) => [
                  fmt(value),
                  name === "current_value" ? "Current Value" : "Retail Price",
                ]}
                labelFormatter={(label) => fmtDate(label)}
              />
              <Legend
                iconType="line"
                iconSize={10}
                wrapperStyle={{ fontSize: 10, color: "#71717A" }}
                formatter={(value) =>
                  value === "current_value" ? "Current Value" : "Retail Price"
                }
              />
              <Line
                type="monotone"
                dataKey="current_value"
                stroke="#F59E0B"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, fill: "#F59E0B" }}
              />
              <Line
                type="monotone"
                dataKey="retail_price"
                stroke="#A1A1AA"
                strokeWidth={1.5}
                strokeDasharray="4 2"
                dot={false}
                activeDot={{ r: 3, fill: "#A1A1AA" }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Data table */}
      {history.length > 0 && (
        <div>
          <p className="text-[9px] uppercase tracking-wider text-zinc-400 mb-1.5">
            History ({history.length} snapshots)
          </p>
          <div className="overflow-x-auto rounded border border-zinc-200">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="bg-zinc-50">
                  <th className="text-left px-2 py-1.5 font-medium text-zinc-500">
                    Date
                  </th>
                  <th className="text-right px-2 py-1.5 font-medium text-zinc-500">
                    Current Value
                  </th>
                  <th className="text-right px-2 py-1.5 font-medium text-zinc-500">
                    Retail Price
                  </th>
                  <th className="text-right px-2 py-1.5 font-medium text-zinc-500">
                    Growth
                  </th>
                  <th className="text-left px-2 py-1.5 font-medium text-zinc-500">
                    Source
                  </th>
                </tr>
              </thead>
              <tbody>
                {[...history]
                  .sort(
                    (a, b) =>
                      new Date(b.recorded_at).getTime() -
                      new Date(a.recorded_at).getTime(),
                  )
                  .slice(0, 50)
                  .map((row) => (
                    <tr key={row.id} className="border-t border-zinc-100 hover:bg-zinc-50">
                      <td className="px-2 py-1.5">
                        <Mono className="text-[10px]">
                          {fmtDate(row.recorded_at)}
                        </Mono>
                      </td>
                      <td className="text-right px-2 py-1.5 font-mono">
                        {fmt(row.current_value, row.currency)}
                      </td>
                      <td className="text-right px-2 py-1.5 font-mono text-zinc-500">
                        {fmt(row.retail_price, row.currency)}
                      </td>
                      <td
                        className="text-right px-2 py-1.5 font-mono"
                        style={{
                          color:
                            row.growth == null
                              ? "#A1A1AA"
                              : row.growth >= 0
                              ? "#22C55E"
                              : "#EF4444",
                        }}
                      >
                        {row.growth != null
                          ? `${row.growth >= 0 ? "+" : ""}${row.growth.toFixed(1)}%`
                          : "—"}
                      </td>
                      <td className="px-2 py-1.5 text-zinc-400">
                        {row.source === "bulk_sync" ? "Bulk sync" : "Individual"}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </SurfaceCard>
  );
}
