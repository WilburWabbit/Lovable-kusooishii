// ============================================================
// SourceValuesPanel
// Renders the per-source snapshot stored on product_attribute.source_values_jsonb
// and surfaces conflicts. Read-only matrix + refresh button.
// Strictly excludes the BrickEconomy-locked "value" attribute group — pricing
// data is shown elsewhere and never participates in conflict resolution.
// ============================================================

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { invokeWithAuth } from "@/lib/invokeWithAuth";
import { SurfaceCard, SectionHead } from "./ui-primitives";

type SourceKey = "bricklink" | "brickowl" | "brickset" | "brickeconomy";
const SOURCES: SourceKey[] = ["bricklink", "brickowl", "brickset", "brickeconomy"];

interface RawAttrRow {
  key: string;
  source_values_jsonb: Record<string, { value: string | null; fetched_at?: string }> | null;
  chosen_source: string | null;
  custom_value: string | null;
}
interface CanonicalRow {
  key: string;
  label: string;
  attribute_group: string;
}

const SOURCE_LABEL: Record<SourceKey, string> = {
  bricklink: "BrickLink",
  brickowl: "BrickOwl",
  brickset: "Brickset",
  brickeconomy: "BrickEconomy",
};

function valuesDiffer(values: Array<string | null | undefined>): boolean {
  const present = values.filter((v) => v != null && String(v).trim() !== "").map((v) => String(v).trim().toLowerCase());
  return new Set(present).size > 1;
}

export function SourceValuesPanel({ productId, mpn }: { productId: string; mpn: string }) {
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  const canonicalQ = useQuery({
    queryKey: ["canonical-attributes-non-value"],
    queryFn: async (): Promise<CanonicalRow[]> => {
      const { data, error } = await supabase
        .from("canonical_attribute")
        .select("key,label,attribute_group")
        .neq("attribute_group", "value")
        .eq("active", true)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as CanonicalRow[];
    },
  });

  const attrsQ = useQuery({
    queryKey: ["product-source-values", productId],
    queryFn: async (): Promise<RawAttrRow[]> => {
      const { data, error } = await supabase
        .from("product_attribute")
        .select("key,source_values_jsonb,chosen_source,custom_value")
        .eq("product_id", productId)
        .eq("namespace", "core")
        .is("channel", null)
        .is("marketplace", null)
        .is("category_id", null);
      if (error) throw error;
      return (data ?? []) as unknown as RawAttrRow[];
    },
    enabled: !!productId,
  });

  const rows = useMemo(() => {
    const canonical = canonicalQ.data ?? [];
    const byKey = new Map<string, RawAttrRow>();
    for (const a of attrsQ.data ?? []) byKey.set(a.key, a);
    return canonical.map((c) => {
      const a = byKey.get(c.key);
      const sv = a?.source_values_jsonb ?? {};
      const perSource: Record<SourceKey, string | null> = {
        bricklink: sv.bricklink?.value ?? null,
        brickowl: sv.brickowl?.value ?? null,
        brickset: sv.brickset?.value ?? null,
        brickeconomy: sv.brickeconomy?.value ?? null,
      };
      const conflict = valuesDiffer(Object.values(perSource));
      const anyValue = Object.values(perSource).some((v) => v != null && String(v).trim() !== "");
      return {
        key: c.key,
        label: c.label,
        perSource,
        conflict,
        anyValue,
        chosen: a?.chosen_source ?? null,
        custom: a?.custom_value ?? null,
      };
    }).filter((r) => r.anyValue);
  }, [canonicalQ.data, attrsQ.data]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const result = await invokeWithAuth<{ sources: Record<string, { ok: boolean; error?: string; configured?: boolean }> }>(
        "refresh-all-sources",
        { mpn },
      );
      const summary = Object.entries(result.sources ?? {})
        .map(([s, r]) => `${s}: ${r.ok ? (r.configured === false ? "skip" : "ok") : "fail"}`)
        .join(" · ");
      toast.success(`Sources refreshed — ${summary}`);
      await qc.invalidateQueries({ queryKey: ["product-source-values", productId] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <SurfaceCard>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <SectionHead>Source values</SectionHead>
          <p className="text-[11px] text-zinc-500 mt-1">
            Snapshot from each external source. Pricing data is sourced solely from
            BrickEconomy and shown elsewhere — it does not appear here.
          </p>
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing}
          className="bg-zinc-900 text-white border-none rounded-md px-3 py-1.5 font-bold text-[12px] cursor-pointer disabled:opacity-50 hover:bg-zinc-800 transition-colors whitespace-nowrap"
        >
          {refreshing ? "Refreshing…" : "Refresh from sources"}
        </button>
      </div>

      {canonicalQ.isLoading || attrsQ.isLoading ? (
        <div className="text-[12px] text-zinc-500 py-4">Loading source snapshot…</div>
      ) : rows.length === 0 ? (
        <div className="text-[12px] text-zinc-500 py-4">
          No source data captured yet. Click <strong>Refresh from sources</strong> to fetch.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[12px] border-collapse">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500 border-b border-zinc-200">
                <th className="py-1.5 pr-2 font-medium">Attribute</th>
                {SOURCES.map((s) => (
                  <th key={s} className="py-1.5 px-2 font-medium">{SOURCE_LABEL[s]}</th>
                ))}
                <th className="py-1.5 pl-2 font-medium">Custom</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-b border-zinc-100 align-top">
                  <td className="py-1.5 pr-2 font-medium text-zinc-800">
                    <div className="flex items-center gap-1.5">
                      {r.conflict && (
                        <span
                          className="text-[9px] font-medium uppercase tracking-wider px-1.5 py-px border rounded text-amber-700 bg-amber-50 border-amber-200"
                          title="Sources disagree"
                        >
                          ⚠ conflict
                        </span>
                      )}
                      {r.label}
                    </div>
                  </td>
                  {SOURCES.map((s) => {
                    const v = r.perSource[s];
                    const isChosen = r.chosen === s;
                    return (
                      <td
                        key={s}
                        className={`py-1.5 px-2 font-mono text-[11px] ${isChosen ? "bg-emerald-50 text-emerald-900" : "text-zinc-700"}`}
                      >
                        {v == null || v === "" ? <span className="text-zinc-300">—</span> : v}
                      </td>
                    );
                  })}
                  <td className="py-1.5 pl-2 font-mono text-[11px] text-zinc-700">
                    {r.custom ? r.custom : <span className="text-zinc-300">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SurfaceCard>
  );
}
