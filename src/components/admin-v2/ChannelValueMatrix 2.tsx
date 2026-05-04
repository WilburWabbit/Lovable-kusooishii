// ============================================================
// ChannelValueMatrix
//
// Per-channel value mapping matrix for non-pricing canonical attributes.
//
// For each canonical attribute (excluding the BrickEconomy-locked "value"
// group), shows the chosen canonical value alongside columns per sales
// channel (web, eBay, BrickLink, BrickOwl). Each channel cell:
//   • Indicates whether the canonical value is natively accepted by the
//     channel for the resolved category (eBay-only constraint today).
//   • Lets staff pick an alternative from the channel's allowed-values
//     list (when one exists) or type a custom value (when allowed).
//   • Persists the override into product_attribute scoped to that
//     channel's namespace.
//
// Pricing data (BrickEconomy "value" group) is intentionally excluded —
// it is sourced solely from BrickEconomy and projected separately.
// ============================================================

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { SurfaceCard, SectionHead } from "./ui-primitives";

type ChannelKey = "web" | "ebay" | "bricklink" | "brickowl";

interface ChannelDef {
  key: ChannelKey;
  label: string;
  /** Channels with a category-driven aspect schema (allowed values + custom flag). */
  hasSchema: boolean;
}

const CHANNELS: ChannelDef[] = [
  { key: "web", label: "Web", hasSchema: false },
  { key: "ebay", label: "eBay", hasSchema: true },
  { key: "bricklink", label: "BrickLink", hasSchema: false },
  { key: "brickowl", label: "BrickOwl", hasSchema: false },
];

interface CanonicalRow {
  key: string;
  label: string;
  attribute_group: string;
}

interface CoreAttrRow {
  key: string;
  source_values_jsonb: Record<string, { value: string | null }> | null;
  chosen_source: string | null;
  custom_value: string | null;
  /** providerChain is what the resolver uses; we mirror its priority order. */
}

interface ChannelOverrideRow {
  key: string;
  namespace: string;
  channel: string | null;
  marketplace: string | null;
  category_id: string | null;
  value: string | null;
}

interface SchemaAttr {
  key: string;
  allowed_values: string[] | null;
  allows_custom: boolean;
}

const PROVIDER_PRIORITY = ["bricklink", "brickowl", "brickset", "brickeconomy"] as const;

/** Resolve canonical value the same way the SourceValuesPanel saves it. */
function resolveCanonical(row: CoreAttrRow | undefined): string | null {
  if (!row) return null;
  const chosen = row.chosen_source;
  if (chosen === "none") return null;
  if (chosen === "custom") return (row.custom_value ?? "").trim() || null;
  const sv = row.source_values_jsonb ?? {};
  if (chosen && sv[chosen]?.value) return String(sv[chosen].value).trim() || null;
  // auto / unset → first non-empty by priority
  for (const p of PROVIDER_PRIORITY) {
    const v = sv[p]?.value;
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return null;
}

export function ChannelValueMatrix({
  productId,
  ebayMarketplace,
  ebayCategoryId,
}: {
  productId: string;
  ebayMarketplace: string | null;
  ebayCategoryId: string | null;
}) {
  const qc = useQueryClient();
  const [savingCell, setSavingCell] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({}); // `${attrKey}|${channel}` => value

  // Canonical (non-value) attributes
  const canonicalQ = useQuery({
    queryKey: ["canonical-attributes-non-value-matrix"],
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

  // Core (canonical-scope) values for the product
  const coreAttrsQ = useQuery({
    queryKey: ["product-core-attrs", productId],
    queryFn: async (): Promise<CoreAttrRow[]> => {
      const { data, error } = await supabase
        .from("product_attribute")
        .select("key,source_values_jsonb,chosen_source,custom_value")
        .eq("product_id", productId)
        .eq("namespace", "core")
        .is("channel", null)
        .is("marketplace", null)
        .is("category_id", null);
      if (error) throw error;
      return (data ?? []) as unknown as CoreAttrRow[];
    },
    enabled: !!productId,
  });

  // Per-channel overrides (any namespace except "core")
  const channelOverridesQ = useQuery({
    queryKey: ["product-channel-overrides", productId, ebayCategoryId, ebayMarketplace],
    queryFn: async (): Promise<ChannelOverrideRow[]> => {
      const { data, error } = await supabase
        .from("product_attribute")
        .select("key,namespace,channel,marketplace,category_id,value")
        .eq("product_id", productId)
        .neq("namespace", "core");
      if (error) throw error;
      return (data ?? []) as unknown as ChannelOverrideRow[];
    },
    enabled: !!productId,
  });

  // eBay category schema (allowed_values + allows_custom per attribute)
  const ebaySchemaQ = useQuery({
    queryKey: ["ebay-category-schema-attrs", ebayCategoryId, ebayMarketplace],
    queryFn: async (): Promise<Record<string, SchemaAttr>> => {
      if (!ebayCategoryId) return {};
      const { data: schemaRow, error: schemaErr } = await supabase
        .from("channel_category_schema")
        .select("id")
        .eq("channel", "ebay")
        .eq("marketplace", ebayMarketplace ?? "EBAY_GB")
        .eq("category_id", ebayCategoryId)
        .maybeSingle();
      if (schemaErr) throw schemaErr;
      if (!schemaRow?.id) return {};
      const { data: attrs, error: attrsErr } = await supabase
        .from("channel_category_attribute")
        .select("key,allowed_values,allows_custom")
        .eq("schema_id", schemaRow.id);
      if (attrsErr) throw attrsErr;
      const map: Record<string, SchemaAttr> = {};
      for (const a of attrs ?? []) {
        const allowed = Array.isArray(a.allowed_values)
          ? (a.allowed_values as unknown[]).map((v) => String(v))
          : null;
        map[a.key] = {
          key: a.key,
          allowed_values: allowed && allowed.length ? allowed : null,
          allows_custom: a.allows_custom !== false,
        };
      }
      // Also need to map by canonical_key via channel_attribute_mapping
      const { data: mappings } = await supabase
        .from("channel_attribute_mapping")
        .select("aspect_key,canonical_key")
        .eq("channel", "ebay")
        .eq("marketplace", ebayMarketplace ?? "EBAY_GB")
        .eq("category_id", ebayCategoryId);
      const byCanonical: Record<string, SchemaAttr> = {};
      for (const m of mappings ?? []) {
        if (!m.canonical_key) continue;
        const aspect = map[m.aspect_key];
        if (aspect) byCanonical[m.canonical_key] = aspect;
      }
      return byCanonical;
    },
    enabled: !!productId,
  });

  // Build the per-row canonical value lookup
  const coreByKey = useMemo(() => {
    const m = new Map<string, CoreAttrRow>();
    for (const r of coreAttrsQ.data ?? []) m.set(r.key, r);
    return m;
  }, [coreAttrsQ.data]);

  // Build per-channel override lookup keyed by `${attrKey}|${channel}`
  const overrideByKey = useMemo(() => {
    const m = new Map<string, ChannelOverrideRow>();
    for (const r of channelOverridesQ.data ?? []) {
      // Only consider rows scoped to a channel (skip ebay category-specific aspect rows)
      if (!r.channel) continue;
      // For eBay we want category-level overrides for the *current* category, but
      // for the matrix we use the channel-scoped row (no category_id) as the
      // "default" channel value. eBay category-aspect rows are managed elsewhere.
      if (r.category_id) continue;
      m.set(`${r.key}|${r.channel}`, r);
    }
    return m;
  }, [channelOverridesQ.data]);

  // Visible rows: any non-value canonical attribute that has source data or an override
  const rows = useMemo(() => {
    const canonical = canonicalQ.data ?? [];
    return canonical
      .map((c) => {
        const core = coreByKey.get(c.key);
        const canonicalValue = resolveCanonical(core);
        const channels: Record<ChannelKey, { override: string | null; effective: string | null }> = {
          web: { override: null, effective: null },
          ebay: { override: null, effective: null },
          bricklink: { override: null, effective: null },
          brickowl: { override: null, effective: null },
        };
        for (const ch of CHANNELS) {
          const o = overrideByKey.get(`${c.key}|${ch.key}`);
          channels[ch.key].override = o?.value ?? null;
          channels[ch.key].effective = o?.value ?? canonicalValue;
        }
        return { key: c.key, label: c.label, canonicalValue, channels };
      })
      .filter(
        (r) =>
          r.canonicalValue != null ||
          Object.values(r.channels).some((c) => c.override != null),
      );
  }, [canonicalQ.data, coreByKey, overrideByKey]);

  // Hydrate edit buffer
  useEffect(() => {
    if (rows.length === 0) return;
    const next: Record<string, string> = {};
    for (const r of rows) {
      for (const ch of CHANNELS) {
        next[`${r.key}|${ch.key}`] = r.channels[ch.key].override ?? "";
      }
    }
    setEdits((prev) => ({ ...next, ...prev })); // keep unsaved edits
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.length, productId]);

  const isLoading =
    canonicalQ.isLoading ||
    coreAttrsQ.isLoading ||
    channelOverridesQ.isLoading ||
    ebaySchemaQ.isLoading;

  const handleSave = async (attrKey: string, channel: ChannelKey) => {
    const editKey = `${attrKey}|${channel}`;
    const raw = (edits[editKey] ?? "").trim();
    setSavingCell(editKey);
    try {
      // Find existing channel-scoped row
      const { data: existing, error: selErr } = await supabase
        .from("product_attribute")
        .select("id")
        .eq("product_id", productId)
        .eq("namespace", channel)
        .eq("channel", channel)
        .is("marketplace", null)
        .is("category_id", null)
        .eq("key", attrKey)
        .maybeSingle();
      if (selErr) throw selErr;

      if (raw === "") {
        // Empty -> clear override (delete row if it exists)
        if (existing?.id) {
          const { error } = await supabase
            .from("product_attribute")
            .delete()
            .eq("id", existing.id);
          if (error) throw error;
        }
        toast.success(`${channel}: cleared (using canonical)`);
      } else if (existing?.id) {
        const { error } = await supabase
          .from("product_attribute")
          .update({ value: raw, source: "manual", is_override: true } as never)
          .eq("id", existing.id);
        if (error) throw error;
        toast.success(`${channel}: override saved`);
      } else {
        const { error } = await supabase
          .from("product_attribute")
          .insert({
            product_id: productId,
            namespace: channel,
            channel,
            key: attrKey,
            value: raw,
            source: "manual",
            is_override: true,
          } as never);
        if (error) throw error;
        toast.success(`${channel}: override saved`);
      }
      await qc.invalidateQueries({ queryKey: ["product-channel-overrides", productId] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSavingCell(null);
    }
  };

  const ebaySchema = ebaySchemaQ.data ?? {};

  return (
    <SurfaceCard>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <SectionHead>Per-channel value mapping</SectionHead>
          <p className="text-[11px] text-zinc-500 mt-1">
            The canonical value for each attribute is projected to every sales
            channel by default. Pick an alternative per channel — eBay enforces
            its category's allowed-values list (custom values may or may not be
            permitted); other channels accept any value.
          </p>
        </div>
      </div>

      {!ebayCategoryId && (
        <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mb-2">
          No eBay category resolved — eBay allowed-value enforcement is unavailable.
        </div>
      )}

      {isLoading ? (
        <div className="text-[12px] text-zinc-500 py-4">Loading channel mapping…</div>
      ) : rows.length === 0 ? (
        <div className="text-[12px] text-zinc-500 py-4">
          No canonical values resolved yet. Capture source data in the panel above first.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[12px] border-collapse">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500 border-b border-zinc-200">
                <th className="py-1.5 pr-2 font-medium">Attribute</th>
                <th className="py-1.5 px-2 font-medium">Canonical</th>
                {CHANNELS.map((c) => (
                  <th key={c.key} className="py-1.5 px-2 font-medium">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const schema = ebaySchema[r.key];
                return (
                  <tr key={r.key} className="border-b border-zinc-100 align-top">
                    <td className="py-1.5 pr-2 font-medium text-zinc-800">{r.label}</td>
                    <td className="py-1.5 px-2 font-mono text-[11px] text-zinc-700">
                      {r.canonicalValue ?? <span className="text-zinc-300">—</span>}
                    </td>
                    {CHANNELS.map((ch) => {
                      const cell = r.channels[ch.key];
                      const editKey = `${r.key}|${ch.key}`;
                      const editVal = edits[editKey] ?? "";
                      const dirty = editVal !== (cell.override ?? "");
                      const isEbay = ch.key === "ebay";
                      const allowed = isEbay ? schema?.allowed_values ?? null : null;
                      const allowsCustom = isEbay ? schema?.allows_custom !== false : true;
                      const hasOverride = cell.override != null;
                      // For eBay: flag if canonical value isn't in allowed list and custom isn't allowed
                      const canonicalNotAllowed =
                        isEbay &&
                        allowed &&
                        r.canonicalValue &&
                        !allowed.includes(r.canonicalValue);
                      const showCustomWarning = canonicalNotAllowed && !allowsCustom && !hasOverride;

                      return (
                        <td
                          key={ch.key}
                          className={`py-1.5 px-2 align-top ${
                            hasOverride ? "bg-amber-50/50" : ""
                          }`}
                        >
                          <div className="flex flex-col gap-1">
                            {allowed ? (
                              <select
                                value={editVal}
                                onChange={(e) =>
                                  setEdits((p) => ({ ...p, [editKey]: e.target.value }))
                                }
                                className="px-1.5 py-1 bg-white border border-zinc-200 rounded text-[11px] max-w-[160px]"
                              >
                                <option value="">
                                  — use canonical{r.canonicalValue ? ` (${r.canonicalValue})` : ""} —
                                </option>
                                {allowed.map((v) => (
                                  <option key={v} value={v}>
                                    {v}
                                  </option>
                                ))}
                                {allowsCustom && editVal && !allowed.includes(editVal) && (
                                  <option value={editVal}>{editVal} (custom)</option>
                                )}
                              </select>
                            ) : (
                              <input
                                value={editVal}
                                onChange={(e) =>
                                  setEdits((p) => ({ ...p, [editKey]: e.target.value }))
                                }
                                placeholder={
                                  r.canonicalValue
                                    ? `canonical: ${r.canonicalValue}`
                                    : "no value"
                                }
                                className="px-1.5 py-1 bg-white border border-zinc-200 rounded text-[11px] font-mono max-w-[160px]"
                              />
                            )}
                            {allowed && allowsCustom && (
                              <input
                                value={
                                  editVal && !allowed.includes(editVal) ? editVal : ""
                                }
                                onChange={(e) =>
                                  setEdits((p) => ({ ...p, [editKey]: e.target.value }))
                                }
                                placeholder="or custom…"
                                className="px-1.5 py-1 bg-white border border-zinc-200 rounded text-[10px] font-mono max-w-[160px]"
                              />
                            )}
                            {showCustomWarning && (
                              <span
                                className="text-[9px] uppercase tracking-wider px-1 py-px border rounded text-red-700 bg-red-50 border-red-200"
                                title="Canonical value is not in this channel's allowed list and custom values are not permitted — pick an allowed value."
                              >
                                ⚠ not allowed
                              </span>
                            )}
                            {dirty && (
                              <button
                                type="button"
                                onClick={() => handleSave(r.key, ch.key)}
                                disabled={savingCell === editKey}
                                className="bg-amber-500 text-zinc-900 border-none rounded px-2 py-0.5 font-bold text-[10px] cursor-pointer disabled:opacity-40 hover:bg-amber-400 transition-colors self-start"
                              >
                                {savingCell === editKey
                                  ? "…"
                                  : editVal === ""
                                    ? "Clear"
                                    : "Save"}
                              </button>
                            )}
                          </div>
                        </td>
                      );
                    })}
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
