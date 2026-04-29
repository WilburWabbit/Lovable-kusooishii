// ============================================================
// SourceValuesPanel
// Renders the per-source snapshot stored on product_attribute.source_values_jsonb,
// surfaces conflicts, and lets staff pick which provider value (or a custom
// value) to treat as canonical for each non-value attribute.
// Strictly excludes the BrickEconomy-locked "value" attribute group — pricing
// data is shown elsewhere and never participates in conflict resolution.
// ============================================================

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { invokeWithAuth } from "@/lib/invokeWithAuth";
import { SurfaceCard, SectionHead } from "./ui-primitives";

type SourceKey = "bricklink" | "brickowl" | "brickset" | "brickeconomy";
const SOURCES: SourceKey[] = ["bricklink", "brickowl", "brickset", "brickeconomy"];

type ChosenKey = SourceKey | "custom" | "none";

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

// Sources fanned out by "Refresh from sources". BrickEconomy intentionally
// excluded — pricing/value data is on its own protected pipeline.
type SyncSource = "bricklink" | "brickowl" | "brickset";
const SYNC_SOURCES: SyncSource[] = ["bricklink", "brickowl", "brickset"];

type SyncStatus = "pending" | "running" | "ok" | "skipped" | "failed";
interface SyncProgressRow {
  status: SyncStatus;
  fetched?: number;
  upserted?: number;
  attribute_writes?: number;
  configured?: boolean;
  error?: string;
  durationMs?: number;
}

export function SourceValuesPanel({ productId, mpn }: { productId: string; mpn: string }) {
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [progress, setProgress] = useState<Record<SyncSource, SyncProgressRow> | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  // Local edit buffer keyed by attribute key
  const [edits, setEdits] = useState<Record<string, { chosen: ChosenKey; custom: string }>>({});
  const [hydratedFor, setHydratedFor] = useState<string | null>(null);

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
        chosen: (a?.chosen_source ?? null) as string | null,
        custom: a?.custom_value ?? null,
      };
    }).filter((r) => r.anyValue);
  }, [canonicalQ.data, attrsQ.data]);

  // Hydrate edit buffer from server data once per dataset
  useEffect(() => {
    if (rows.length === 0) return;
    const sig = `${productId}|${rows.map((r) => `${r.key}:${r.chosen ?? ""}:${r.custom ?? ""}`).join(",")}`;
    if (sig === hydratedFor) return;
    const next: Record<string, { chosen: ChosenKey; custom: string }> = {};
    for (const r of rows) {
      const ch = (r.chosen ?? "") as string;
      const isValid = ch === "custom" || ch === "none" || (SOURCES as string[]).includes(ch);
      next[r.key] = {
        chosen: (isValid ? ch : "") as ChosenKey,
        custom: r.custom ?? "",
      };
    }
    setEdits(next);
    setHydratedFor(sig);
  }, [rows, productId, hydratedFor]);

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

  const handleSave = async (key: string) => {
    const edit = edits[key];
    if (!edit) return;
    const chosen = edit.chosen === ("" as ChosenKey) ? null : edit.chosen;
    const custom = edit.chosen === "custom" ? (edit.custom ?? "").trim() : null;
    if (edit.chosen === "custom" && !custom) {
      toast.error("Enter a custom value or choose a source");
      return;
    }
    setSavingKey(key);
    try {
      // Find existing row id (if any)
      const { data: existing, error: selErr } = await supabase
        .from("product_attribute")
        .select("id")
        .eq("product_id", productId)
        .eq("namespace", "core")
        .is("channel", null)
        .is("marketplace", null)
        .is("category_id", null)
        .eq("key", key)
        .maybeSingle();
      if (selErr) throw selErr;

      if (existing?.id) {
        const { error } = await supabase
          .from("product_attribute")
          .update({
            chosen_source: chosen,
            custom_value: custom,
          } as never)
          .eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("product_attribute")
          .insert({
            product_id: productId,
            namespace: "core",
            key,
            source: "manual",
            chosen_source: chosen,
            custom_value: custom,
          } as never);
        if (error) throw error;
      }

      toast.success("Source preference saved");
      setHydratedFor(null);
      await qc.invalidateQueries({ queryKey: ["product-source-values", productId] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <SurfaceCard>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <SectionHead>Source values</SectionHead>
          <p className="text-[11px] text-zinc-500 mt-1">
            Snapshot from each external source. Pick which source feeds the canonical
            value per attribute, or set a custom override. Pricing data is sourced
            solely from BrickEconomy and shown elsewhere.
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
                <th className="py-1.5 px-2 font-medium">Custom override</th>
                <th className="py-1.5 px-2 font-medium">Chosen</th>
                <th className="py-1.5 pl-2 font-medium w-[1%]"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const edit = edits[r.key] ?? { chosen: "" as ChosenKey, custom: "" };
                const dirty =
                  (edit.chosen || "") !== (r.chosen ?? "") ||
                  (edit.chosen === "custom" && (edit.custom ?? "") !== (r.custom ?? ""));
                const isCustomChosen = edit.chosen === "custom";
                return (
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
                      const isChosen = edit.chosen === s;
                      const empty = v == null || v === "";
                      return (
                        <td
                          key={s}
                          className={`py-1.5 px-2 font-mono text-[11px] cursor-pointer hover:bg-zinc-50 ${
                            isChosen ? "bg-emerald-50 text-emerald-900 ring-1 ring-emerald-300" : "text-zinc-700"
                          }`}
                          onClick={() => {
                            if (empty) return;
                            setEdits((prev) => ({
                              ...prev,
                              [r.key]: { chosen: s, custom: prev[r.key]?.custom ?? "" },
                            }));
                          }}
                          title={empty ? "No value from this source" : `Use ${SOURCE_LABEL[s]} value`}
                        >
                          {empty ? <span className="text-zinc-300">—</span> : v}
                        </td>
                      );
                    })}
                    <td
                      className={`py-1.5 px-2 ${
                        isCustomChosen ? "bg-emerald-50 ring-1 ring-emerald-300" : ""
                      }`}
                    >
                      <div className="flex items-center gap-1">
                        <input
                          value={edit.custom}
                          onChange={(e) =>
                            setEdits((prev) => ({
                              ...prev,
                              [r.key]: {
                                chosen: "custom",
                                custom: e.target.value,
                              },
                            }))
                          }
                          onFocus={() => {
                            if (edit.chosen !== "custom") {
                              setEdits((prev) => ({
                                ...prev,
                                [r.key]: { chosen: "custom", custom: prev[r.key]?.custom ?? "" },
                              }));
                            }
                          }}
                          placeholder="Type override…"
                          className={`flex-1 min-w-[120px] px-1.5 py-1 bg-white border rounded text-[11px] font-mono ${
                            isCustomChosen
                              ? "border-emerald-400 text-emerald-900"
                              : "border-zinc-200 text-zinc-700"
                          }`}
                        />
                        {(edit.custom || isCustomChosen) && (
                          <button
                            type="button"
                            onClick={() =>
                              setEdits((prev) => ({
                                ...prev,
                                [r.key]: { chosen: "" as ChosenKey, custom: "" },
                              }))
                            }
                            title="Clear custom override (revert to auto)"
                            className="text-[11px] text-zinc-400 hover:text-zinc-700 px-1"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                      {!isCustomChosen && r.custom && (
                        <div className="text-[10px] text-zinc-400 mt-0.5 italic">
                          saved: {r.custom}
                        </div>
                      )}
                    </td>
                    <td className="py-1.5 px-2">
                      <select
                        value={edit.chosen}
                        onChange={(e) =>
                          setEdits((prev) => ({
                            ...prev,
                            [r.key]: {
                              chosen: e.target.value as ChosenKey,
                              custom: prev[r.key]?.custom ?? "",
                            },
                          }))
                        }
                        className="px-1.5 py-1 bg-white border border-zinc-200 rounded text-[11px]"
                      >
                        <option value="">— auto (priority) —</option>
                        {SOURCES.map((s) => (
                          <option key={s} value={s} disabled={!r.perSource[s]}>
                            {SOURCE_LABEL[s]}
                            {r.perSource[s] ? "" : " (no value)"}
                          </option>
                        ))}
                        <option value="custom" disabled={!edit.custom.trim()}>
                          Custom{edit.custom.trim() ? "" : " (type a value first)"}
                        </option>
                        <option value="none">None (suppress)</option>
                      </select>
                    </td>
                    <td className="py-1.5 pl-2">
                      <button
                        type="button"
                        onClick={() => handleSave(r.key)}
                        disabled={!dirty || savingKey === r.key}
                        className="bg-amber-500 text-zinc-900 border-none rounded px-2 py-1 font-bold text-[11px] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed hover:bg-amber-400 transition-colors"
                      >
                        {savingKey === r.key ? "…" : "Save"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </SurfaceCard>
  );
}
