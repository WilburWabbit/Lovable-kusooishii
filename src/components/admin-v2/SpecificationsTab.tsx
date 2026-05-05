// ============================================================
// SpecificationsTab
//
// Top:    eBay category selector (auto-resolved with override).
// Middle: Universal product facts (canonical DB-backed values like
//         Brand, MPN, dimensions, weight). Editable; writes go to
//         the product table.
// Bottom: eBay category-specific item specifics. Each row shows the
//         auto-resolved value (from the canonical mapping) plus an
//         editable per-category override that persists into
//         product_attribute scoped to channel/marketplace/category.
// ============================================================

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import {
  useAutoResolveEbayCategory,
  useResolveEbayAspects,
  useSetProductChannelCategory,
  useEbayCategorySuggestions,
  useSaveProductAttributes,
  type CanonicalProvider,
  type SpecRow,
} from "@/hooks/admin/use-channel-taxonomy";
import { productKeys } from "@/hooks/admin/use-products";
import { supabase } from "@/integrations/supabase/client";
import { SurfaceCard, SectionHead } from "./ui-primitives";
import { MinifigsCard } from "./MinifigsCard";
import { SourceValuesPanel } from "./SourceValuesPanel";
import { ChannelValueMatrix } from "./ChannelValueMatrix";
import type { ProductDetail } from "@/lib/types/admin";

interface SpecificationsTabProps {
  product: ProductDetail;
}

function SourceBadge({ source }: { source: CanonicalProvider | null }) {
  if (!source) return null;
  const label =
    source === "override"
      ? "Override"
      : source === "product"
        ? "Product"
        : source === "brickeconomy"
          ? "BrickEconomy"
          : source === "bricklink"
            ? "BrickLink"
            : source === "brickset"
              ? "BrickSet"
          : source === "catalog"
            ? "Catalog"
            : source === "rebrickable"
              ? "Rebrickable"
              : source === "theme"
                ? "Theme"
                : source === "constant"
                  ? "Constant"
                  : source === "derived"
                    ? "Derived"
                    : "—";
  const cls =
    source === "override"
      ? "text-amber-600 bg-amber-50 border-amber-200"
      : source === "brickeconomy"
        ? "text-sky-600 bg-sky-50 border-sky-200"
        : source === "bricklink" || source === "brickset"
          ? "text-emerald-700 bg-emerald-50 border-emerald-200"
        : source === "catalog" || source === "rebrickable"
          ? "text-violet-600 bg-violet-50 border-violet-200"
          : source === "constant" || source === "derived"
            ? "text-zinc-500 bg-zinc-50 border-zinc-200"
            : source === "none"
              ? "text-red-500 bg-red-50 border-red-200"
              : "text-zinc-600 bg-zinc-100 border-zinc-200";
  return (
    <span
      className={`inline-block text-[9px] font-medium uppercase tracking-wider px-1.5 py-px border rounded ${cls}`}
    >
      {label}
    </span>
  );
}

function ConfidenceBadge({ confidence }: { confidence: "high" | "medium" | "low" }) {
  const cls =
    confidence === "high"
      ? "text-emerald-700 bg-emerald-50 border-emerald-200"
      : confidence === "medium"
        ? "text-amber-700 bg-amber-50 border-amber-200"
        : "text-zinc-600 bg-zinc-100 border-zinc-200";
  return (
    <span
      className={`text-[9px] font-medium uppercase tracking-wider px-1.5 py-px border rounded ${cls}`}
    >
      auto · {confidence}
    </span>
  );
}

// ─── eBay category override picker ─────────────────────────

function CategoryOverridePicker({
  productId,
  mpn,
  marketplace,
  onClose,
}: {
  productId: string;
  mpn: string;
  marketplace: string;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  const { data: suggestions, isFetching } = useEbayCategorySuggestions(debounced, marketplace);
  const setCategory = useSetProductChannelCategory();

  const handleSelect = async (categoryId: string, label: string) => {
    try {
      await setCategory.mutateAsync({
        productId,
        mpn,
        channel: "ebay",
        categoryId,
        marketplace,
      });
      toast.success(`Category set: ${label}`);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to set category");
    }
  };

  return (
    <div className="border border-zinc-200 rounded-md p-3 bg-zinc-50">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search eBay categories…"
        className="w-full px-3 py-2 bg-white border border-zinc-200 rounded text-[13px]"
        autoFocus
      />
      <div className="mt-2 max-h-64 overflow-y-auto">
        {debounced.length < 2 ? (
          <div className="text-[12px] text-zinc-500 p-2">Type at least 2 characters.</div>
        ) : isFetching ? (
          <div className="text-[12px] text-zinc-500 p-2">Searching…</div>
        ) : suggestions && suggestions.length > 0 ? (
          <ul className="divide-y divide-zinc-100">
            {suggestions.map((s) => {
              const path = [...s.ancestors.map((a) => a.name), s.categoryName].join(" › ");
              return (
                <li key={s.categoryId}>
                  <button
                    type="button"
                    onClick={() => handleSelect(s.categoryId, s.categoryName)}
                    className="w-full text-left px-2 py-2 hover:bg-amber-50 rounded text-[12px]"
                  >
                    <div className="font-medium text-zinc-900">{s.categoryName}</div>
                    <div className="text-[11px] text-zinc-500">
                      {path} · ID {s.categoryId}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="text-[12px] text-zinc-500 p-2">No suggestions.</div>
        )}
      </div>
    </div>
  );
}

// ─── Aspect override row (per category) ────────────────────

function AspectOverrideRow({
  row,
  override,
  onChange,
  onClear,
}: {
  row: SpecRow;
  override: string | string[] | null;
  onChange: (v: string | string[] | null) => void;
  onClear: () => void;
}) {
  const isMulti = row.cardinality === "multi";
  const allowed = row.allowedValues ?? [];
  const hasAllowed = allowed.length > 0;
  const customAllowed = row.allowsCustom !== false;

  const autoDisplay = Array.isArray(row.autoValue)
    ? row.autoValue.length > 0
      ? row.autoValue.join(", ")
      : "—"
    : typeof row.autoValue === "string" && row.autoValue.length > 0
      ? row.autoValue
      : "—";
  const overrideStr = Array.isArray(override)
    ? override.join(", ")
    : (override ?? "");
  const hasOverride = overrideStr.trim().length > 0;
  const effective = hasOverride
    ? overrideStr
    : Array.isArray(row.autoValue)
      ? row.autoValue.join(", ")
      : typeof row.autoValue === "string"
        ? row.autoValue
        : "";

  return (
    <div className="py-2 border-b border-zinc-100">
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-1.5 min-w-0">
          {row.required && (
            <span className="text-red-500 leading-none" title="Required">
              *
            </span>
          )}
          <label className="text-[11px] text-zinc-700 font-medium truncate" title={row.label}>
            {row.label}
          </label>
          <SourceBadge source={hasOverride ? "override" : row.autoSource} />
          {row.mappingScope === "none" && (
            <span className="text-[9px] uppercase tracking-wider px-1.5 py-px border rounded text-zinc-500 bg-zinc-50 border-zinc-200">
              unmapped
            </span>
          )}
        </div>
        {hasOverride && (
          <button
            type="button"
            onClick={onClear}
            className="text-[10px] text-amber-600 hover:underline whitespace-nowrap"
          >
            Revert
          </button>
        )}
      </div>

      {hasAllowed && !customAllowed ? (
        isMulti ? (
          <select
            multiple
            value={Array.isArray(override) ? override : override ? [override] : []}
            onChange={(e) => {
              const vals = Array.from(e.target.selectedOptions, (o) => o.value);
              onChange(vals.length ? vals : null);
            }}
            className="w-full px-2 py-1.5 bg-zinc-50 border border-zinc-200 rounded text-[13px] min-h-[80px]"
          >
            {allowed.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        ) : (
          <select
            value={overrideStr}
            onChange={(e) => onChange(e.target.value || null)}
            className="w-full px-2 py-1.5 bg-zinc-50 border border-zinc-200 rounded text-[13px]"
          >
            <option value="">— use auto ({autoDisplay}) —</option>
            {allowed.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        )
      ) : hasAllowed ? (
        <input
          list={`allowed-${row.key}`}
          value={overrideStr}
          onChange={(e) => onChange(e.target.value || null)}
          placeholder={hasOverride ? "" : `auto: ${autoDisplay}`}
          className="w-full px-2 py-1.5 bg-zinc-50 border border-zinc-200 rounded text-[13px] font-mono"
        />
      ) : (
        <input
          value={overrideStr}
          onChange={(e) => onChange(e.target.value || null)}
          placeholder={hasOverride ? "" : `auto: ${autoDisplay}`}
          className="w-full px-2 py-1.5 bg-zinc-50 border border-zinc-200 rounded text-[13px] font-mono"
        />
      )}

      {hasAllowed && customAllowed && (
        <datalist id={`allowed-${row.key}`}>
          {allowed.map((v) => (
            <option key={v} value={v} />
          ))}
        </datalist>
      )}

      {!hasOverride && row.mappingScope !== "none" && effective !== "" && (
        <div className="text-[10px] text-zinc-400 mt-0.5 font-mono truncate">
          → {effective}
        </div>
      )}
    </div>
  );
}

// ─── Main tab ──────────────────────────────────────────────

export function SpecificationsTab({ product }: SpecificationsTabProps) {
  const queryClient = useQueryClient();
  const marketplace = product.ebayMarketplace || "EBAY_GB";

  const auto = useAutoResolveEbayCategory(product.id, marketplace, !product.ebayCategoryId);
  const setCategory = useSetProductChannelCategory();
  const [overrideOpen, setOverrideOpen] = useState(false);

  useEffect(() => {
    if (
      !product.ebayCategoryId &&
      auto.data?.categoryId &&
      auto.data.confidence !== "low"
    ) {
      setCategory.mutate({
        productId: product.id,
        mpn: product.mpn,
        channel: "ebay",
        categoryId: auto.data.categoryId,
        marketplace,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto.data?.categoryId, product.ebayCategoryId, product.id, product.mpn, marketplace]);

  const effectiveCategoryId = product.ebayCategoryId ?? auto.data?.categoryId ?? null;

  const aspects = useResolveEbayAspects(product.id, effectiveCategoryId, marketplace);
  const saveAspects = useSaveProductAttributes();


  const rows: SpecRow[] = useMemo(
    () => (aspects.data?.rows ?? []) as SpecRow[],
    [aspects.data],
  );

  const [overrides, setOverrides] = useState<Record<string, string | string[] | null>>({});
  const [overridesHydratedFor, setOverridesHydratedFor] = useState<string | null>(null);
  useEffect(() => {
    if (rows.length === 0) return;
    const sig = `${product.id}|${effectiveCategoryId ?? "none"}|${rows.map((r) => r.key).join(",")}`;
    if (sig === overridesHydratedFor) return;
    const next: Record<string, string | string[] | null> = {};
    for (const r of rows) {
      next[r.key] = r.savedValue;
    }
    setOverrides(next);
    setOverridesHydratedFor(sig);
  }, [rows, product.id, effectiveCategoryId, overridesHydratedFor]);

  const aspectsDirty = useMemo(() => {
    return rows.some((r) => {
      const cur = r.savedValue;
      const next = overrides[r.key];
      const a = Array.isArray(cur) ? cur.join("\n") : (cur ?? "");
      const b = Array.isArray(next) ? next.join("\n") : (next ?? "");
      return a !== b;
    });
  }, [rows, overrides]);

  const [savingAspects, setSavingAspects] = useState(false);
  const handleSaveAspects = async () => {
    if (!effectiveCategoryId) return;
    setSavingAspects(true);
    try {
      const payload: Record<string, string | string[]> = {};
      for (const r of rows) {
        const v = overrides[r.key];
        if (v == null || (typeof v === "string" && v.trim() === "")) {
          // empty -> instruct backend to delete
          payload[r.key] = "";
        } else {
          payload[r.key] = v;
        }
      }
      await saveAspects.mutateAsync({
        productId: product.id,
        namespace: "ebay",
        attributes: payload,
        source: "manual",
        channel: "ebay",
        marketplace,
        categoryId: effectiveCategoryId,
      });
      toast.success("Item specifics saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSavingAspects(false);
    }
  };

  const handleClearCategoryOverride = async () => {
    try {
      await setCategory.mutateAsync({
        productId: product.id,
        mpn: product.mpn,
        channel: "ebay",
        categoryId: null,
        marketplace,
      });
      toast.success("Override cleared — auto-resolve will be used");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to clear");
    }
  };

  const handleCatalogToggle = async (checked: boolean) => {
    try {
      const { error } = await supabase
        .from("product")
        .update({ include_catalog_img: checked } as never)
        .eq("id", product.id);
      if (error) throw error;
      toast.success(checked ? "Catalog image included" : "Catalog image excluded");
      queryClient.invalidateQueries({ queryKey: productKeys.detail(product.mpn) });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    }
  };

  const requiredMissing = rows.filter(
    (r) => r.required && (r.effectiveValue == null || r.effectiveValue === ""),
  );

  return (
    <div className="grid gap-4">
      {/* eBay Category selector */}
      <SurfaceCard>
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="min-w-0 flex-1">
            <SectionHead>eBay Category</SectionHead>
            <p className="text-[11px] text-zinc-500 mt-1">
              Drives which item-specific aspects appear below. Auto-resolved from
              the canonical attributes; override if needed.
            </p>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            {product.ebayCategoryId && (
              <button
                type="button"
                onClick={handleClearCategoryOverride}
                className="px-2 py-1 text-[11px] rounded border border-zinc-200 text-zinc-600 hover:bg-zinc-50"
              >
                Use auto
              </button>
            )}
            <button
              type="button"
              onClick={() => setOverrideOpen((v) => !v)}
              className="px-3 py-1 text-[11px] rounded border border-amber-300 text-amber-700 hover:bg-amber-50"
            >
              {overrideOpen ? "Close" : "Override"}
            </button>
          </div>
        </div>

        <div className="border border-zinc-200 rounded-md p-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[12px] font-bold text-zinc-900">{marketplace}</span>
            {!product.ebayCategoryId && auto.data?.confidence && (
              <ConfidenceBadge confidence={auto.data.confidence} />
            )}
            {product.ebayCategoryId && (
              <span className="text-[9px] font-medium uppercase tracking-wider px-1.5 py-px border rounded text-amber-700 bg-amber-50 border-amber-200">
                manual override
              </span>
            )}
          </div>
          <div className="mt-1 text-[13px] text-zinc-900 font-mono">
            {auto.isLoading && !product.ebayCategoryId
              ? "Resolving…"
              : effectiveCategoryId
                ? `${aspects.data?.categoryName ?? auto.data?.categoryName ?? "—"} · ID ${effectiveCategoryId}`
                : "No category resolved"}
          </div>
          {!product.ebayCategoryId && auto.data?.basis && (
            <div className="text-[10px] text-zinc-400 mt-0.5 truncate" title={auto.data.basis}>
              {auto.data.basis}
            </div>
          )}
        </div>

        {overrideOpen && (
          <div className="mt-2">
            <CategoryOverridePicker
              productId={product.id}
              mpn={product.mpn}
              marketplace={marketplace}
              onClose={() => setOverrideOpen(false)}
            />
          </div>
        )}
      </SurfaceCard>

      {/* Specifications — single card driven by the canonical mapping
          for the resolved eBay category. */}
      {effectiveCategoryId && (
        <SurfaceCard>
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="min-w-0">
              <SectionHead>
                Specifications · {aspects.data?.categoryName ?? effectiveCategoryId}
              </SectionHead>
              <p className="text-[11px] text-zinc-500 mt-1">
                Canonical attribute fields for this category, per the channel
                mapping. Each row shows the auto-resolved value; type a value
                to publish a per-category override.
              </p>
            </div>
            <div className="flex items-center gap-3 flex-shrink-0">
              <Link
                to="/admin/settings/channel-mappings"
                className="text-[11px] text-zinc-500 hover:text-zinc-700 underline whitespace-nowrap"
              >
                Manage mappings
              </Link>
              <button
                onClick={handleSaveAspects}
                disabled={!aspectsDirty || savingAspects}
                className="bg-amber-500 text-zinc-900 border-none rounded-md px-4 py-1.5 font-bold text-[12px] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed hover:bg-amber-400 transition-colors"
              >
                {savingAspects ? "Saving…" : "Save"}
              </button>
            </div>
          </div>

          {aspects.isLoading ? (
            <div className="text-[12px] text-zinc-500 py-4">Loading specifications…</div>
          ) : !aspects.data?.schemaLoaded ? (
            <div className="text-[12px] text-zinc-500 py-4">
              Aspect schema not loaded for this category yet.
            </div>
          ) : rows.length === 0 ? (
            <div className="text-[12px] text-zinc-500 py-4">
              No aspects defined for this category.
            </div>
          ) : (
            <>
              <div className="text-[11px] text-zinc-600 mb-2">
                <strong className="text-zinc-900">{aspects.data.resolvedCount}</strong> of{" "}
                <strong className="text-zinc-900">{aspects.data.totalSchemaCount}</strong> attributes
                resolved
                {requiredMissing.length > 0 && (
                  <span className="text-amber-700"> · {requiredMissing.length} required missing</span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                {rows.map((r) => (
                  <AspectOverrideRow
                    key={r.key}
                    row={r}
                    override={overrides[r.key] ?? null}
                    onChange={(v) =>
                      setOverrides((prev) => ({ ...prev, [r.key]: v }))
                    }
                    onClear={() =>
                      setOverrides((prev) => ({ ...prev, [r.key]: null }))
                    }
                  />
                ))}
              </div>
            </>
          )}
        </SurfaceCard>
      )}

      {/* Catalog image */}
      {product.catalogImageUrl && (
        <SurfaceCard>
          <SectionHead>Catalog Image</SectionHead>
          <div className="flex items-start gap-4">
            <div className="w-24 h-24 rounded border border-dashed border-zinc-300 overflow-hidden bg-zinc-50 flex-shrink-0">
              <img
                src={product.catalogImageUrl}
                alt={`${product.name} catalog`}
                className="w-full h-full object-contain"
              />
            </div>
            <div>
              <label className="flex items-center gap-2 text-[13px] text-zinc-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={product.includeCatalogImg}
                  onChange={(e) => handleCatalogToggle(e.target.checked)}
                  className="accent-amber-500"
                />
                Include in listings
              </label>
              <p className="text-[11px] text-zinc-500 mt-1">
                When enabled, this image from the LEGO catalog will be included
                alongside your uploaded product photos.
              </p>
            </div>
          </div>
        </SurfaceCard>
      )}

      {/* Multi-source value snapshot (non-pricing). BrickEconomy value data
          is intentionally excluded — it lives in the Market value panel. */}
      <SourceValuesPanel productId={product.id} mpn={product.mpn} />

      {/* Per-channel value mapping matrix — project canonical values to each
          channel and override per-channel where the channel demands a
          different value or its allowed-values list constrains the choice. */}
      <ChannelValueMatrix
        productId={product.id}
        ebayMarketplace={marketplace}
        ebayCategoryId={effectiveCategoryId}
      />

      {/* Included minifigures (selectable images for listings) */}
      <MinifigsCard product={product} />
    </div>
  );
}
