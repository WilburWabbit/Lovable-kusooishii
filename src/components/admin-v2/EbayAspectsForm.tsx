// ============================================================
// EbayAspectsForm
// Renders the cached aspect schema for a category as an editable
// form. Values persist into product_attribute (namespace="ebay").
// Suggestions from LEGO data prefill empty required fields.
// ============================================================

import { useEffect, useMemo, useState } from "react";
import {
  useEbayCategoryAspects,
  useProductAttributes,
  useRefreshEbayAspects,
  useSaveProductAttributes,
} from "@/hooks/admin/use-channel-taxonomy";
import { buildLegoAspectSuggestions, matchSuggestionsToSchema } from "@/lib/utils/lego-aspects-prefill";
import type { ProductDetail, ChannelCategoryAttribute } from "@/lib/types/admin";
import { toast } from "sonner";

interface Props {
  product: ProductDetail;
  categoryId: string;
  marketplace: string;
}

type FormValue = string | string[];

function parseStored(attr: { value: string | null; value_json: unknown }): FormValue {
  if (Array.isArray(attr.value_json)) return (attr.value_json as unknown[]).map(String);
  return attr.value ?? "";
}

function asString(v: FormValue): string {
  return Array.isArray(v) ? v.join(", ") : v;
}

export function EbayAspectsForm({ product, categoryId, marketplace }: Props) {
  const aspectsQuery = useEbayCategoryAspects(categoryId, marketplace);
  const attrsQuery = useProductAttributes(product.id, "ebay");
  const refreshAspects = useRefreshEbayAspects();
  const saveAttrs = useSaveProductAttributes();

  const schema: ChannelCategoryAttribute[] = aspectsQuery.data?.attributes ?? [];

  // Build initial form values from stored attributes; suggestions fill the gaps.
  const storedMap = useMemo(() => {
    const m = new Map<string, FormValue>();
    for (const a of attrsQuery.data ?? []) m.set(a.key, parseStored(a));
    return m;
  }, [attrsQuery.data]);

  const suggestions = useMemo(() => {
    if (product.productType !== "set" && product.productType !== "minifig") return {};
    const all = buildLegoAspectSuggestions(product);
    return matchSuggestionsToSchema(all, schema.map((a) => a.label || a.key));
  }, [product, schema]);

  const [form, setForm] = useState<Record<string, FormValue>>({});
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (!aspectsQuery.data || !attrsQuery.data) return;
    const next: Record<string, FormValue> = {};
    for (const a of schema) {
      const key = a.label || a.key;
      const stored = storedMap.get(key);
      if (stored != null && stored !== "") {
        next[key] = stored;
      } else {
        next[key] = a.cardinality === "multi" ? [] : "";
      }
    }
    setForm(next);
    setInitialized(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aspectsQuery.data, attrsQuery.data, categoryId]);

  const isDirty = useMemo(() => {
    if (!initialized) return false;
    for (const a of schema) {
      const key = a.label || a.key;
      const stored = storedMap.get(key) ?? (a.cardinality === "multi" ? [] : "");
      const cur = form[key] ?? (a.cardinality === "multi" ? [] : "");
      if (JSON.stringify(stored) !== JSON.stringify(cur)) return true;
    }
    return false;
  }, [form, schema, storedMap, initialized]);

  const handleChange = (key: string, value: FormValue) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const applySuggestion = (key: string) => {
    const sug = suggestions[key];
    if (!sug) return;
    const attr = schema.find((a) => (a.label || a.key) === key);
    if (!attr) return;
    if (attr.cardinality === "multi") {
      handleChange(key, [sug.value]);
    } else {
      handleChange(key, sug.value);
    }
  };

  const applyAllSuggestions = () => {
    setForm((prev) => {
      const next = { ...prev };
      for (const a of schema) {
        const key = a.label || a.key;
        const cur = next[key];
        const isEmpty = cur == null || cur === "" || (Array.isArray(cur) && cur.length === 0);
        if (isEmpty && suggestions[key]) {
          next[key] = a.cardinality === "multi" ? [suggestions[key].value] : suggestions[key].value;
        }
      }
      return next;
    });
  };

  const handleSave = async () => {
    try {
      const payload: Record<string, string | string[]> = {};
      for (const a of schema) {
        const key = a.label || a.key;
        const v = form[key];
        if (v == null) continue;
        if (Array.isArray(v)) payload[key] = v;
        else payload[key] = v;
      }
      await saveAttrs.mutateAsync({
        productId: product.id,
        namespace: "ebay",
        attributes: payload,
        source: "manual",
      });
      toast.success("eBay aspects saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    }
  };

  const handleRefresh = async () => {
    try {
      await refreshAspects.mutateAsync({ categoryId, marketplace });
      toast.success("Aspect schema refreshed from eBay");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Refresh failed");
    }
  };

  if (aspectsQuery.isLoading) {
    return <div className="text-[12px] text-zinc-500 py-2">Loading aspects…</div>;
  }
  if (aspectsQuery.error) {
    return (
      <div className="text-[12px] text-red-600 py-2">
        Failed to load aspects: {(aspectsQuery.error as Error).message}
      </div>
    );
  }
  if (schema.length === 0) {
    return (
      <div className="text-[12px] text-zinc-500 py-2">
        No aspects defined for this category.
        <button
          type="button"
          onClick={handleRefresh}
          className="ml-2 underline text-amber-600"
        >
          Refresh from eBay
        </button>
      </div>
    );
  }

  const hasUnusedSuggestions = Object.keys(suggestions).some((k) => {
    const cur = form[k];
    return cur == null || cur === "" || (Array.isArray(cur) && cur.length === 0);
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[11px] text-zinc-500">
          {schema.length} aspects · {schema.filter((a) => a.required).length} required
          {aspectsQuery.data?.fromCache ? " · cached" : " · fresh"}
        </div>
        <div className="flex gap-2">
          {hasUnusedSuggestions && (
            <button
              type="button"
              onClick={applyAllSuggestions}
              className="px-2 py-1 text-[11px] rounded border border-amber-300 text-amber-700 hover:bg-amber-50"
            >
              Prefill from LEGO data
            </button>
          )}
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshAspects.isPending}
            className="px-2 py-1 text-[11px] rounded border border-zinc-200 text-zinc-600 hover:bg-zinc-50 disabled:opacity-50"
          >
            {refreshAspects.isPending ? "Refreshing…" : "Refresh schema"}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!isDirty || saveAttrs.isPending}
            className="bg-amber-500 text-zinc-900 rounded-md px-3 py-1 font-bold text-[12px] hover:bg-amber-400 disabled:opacity-50"
          >
            {saveAttrs.isPending ? "Saving…" : "Save Aspects"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-1">
        {schema.map((a) => {
          const key = a.label || a.key;
          const value = form[key] ?? (a.cardinality === "multi" ? [] : "");
          const allowed = a.allowed_values ?? null;
          const sug = suggestions[key];
          const cur = form[key];
          const isEmpty = cur == null || cur === "" || (Array.isArray(cur) && cur.length === 0);

          return (
            <div key={a.id} className="py-2 border-b border-zinc-100">
              <label className="text-[11px] text-zinc-500 font-medium uppercase tracking-wider block mb-1 flex items-center gap-1">
                {key}
                {a.required && <span className="text-red-500">*</span>}
                {a.cardinality === "multi" && (
                  <span className="text-[9px] text-zinc-400 normal-case">(multi)</span>
                )}
              </label>

              {allowed && allowed.length > 0 && a.cardinality === "single" && !a.allows_custom ? (
                <select
                  value={asString(value)}
                  onChange={(e) => handleChange(key, e.target.value)}
                  className="w-full px-2 py-1.5 bg-zinc-50 border border-zinc-200 rounded text-zinc-900 text-[13px]"
                >
                  <option value="">—</option>
                  {allowed.map((v) => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
              ) : a.cardinality === "multi" ? (
                <input
                  type="text"
                  value={Array.isArray(value) ? value.join(", ") : value}
                  onChange={(e) =>
                    handleChange(
                      key,
                      e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                    )
                  }
                  placeholder={sug ? `e.g. ${sug.value}` : "comma-separated"}
                  className="w-full px-2 py-1.5 bg-zinc-50 border border-zinc-200 rounded text-zinc-900 text-[13px] font-mono placeholder:text-zinc-400 placeholder:font-sans"
                />
              ) : (
                <input
                  type={a.data_type === "number" ? "number" : "text"}
                  value={asString(value)}
                  onChange={(e) => handleChange(key, e.target.value)}
                  list={allowed ? `aspect-list-${a.id}` : undefined}
                  placeholder={sug ? `${sug.value} (${sug.source})` : "—"}
                  className="w-full px-2 py-1.5 bg-zinc-50 border border-zinc-200 rounded text-zinc-900 text-[13px] font-mono placeholder:text-zinc-400 placeholder:font-sans"
                />
              )}
              {allowed && a.allows_custom && a.cardinality === "single" && (
                <datalist id={`aspect-list-${a.id}`}>
                  {allowed.map((v) => <option key={v} value={v} />)}
                </datalist>
              )}

              {sug && isEmpty && (
                <button
                  type="button"
                  onClick={() => applySuggestion(key)}
                  className="text-[10px] text-amber-600 hover:text-amber-700 underline mt-0.5 bg-transparent border-none p-0 cursor-pointer"
                >
                  Use suggestion: {sug.value} ({sug.source})
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
