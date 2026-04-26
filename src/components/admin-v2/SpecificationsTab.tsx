// ============================================================
// SpecificationsTab
// Single unified card for product specifications.
//
// Top: eBay category selector (auto-resolved with override). The
// chosen category drives which channel-specific aspects are shown
// as missing in the panel below.
//
// Middle: server-resolved canonical attributes — sourced from the
// DB-driven canonical_attribute registry walked through its
// provider chain (product → BrickEconomy → catalog → derived →
// constant). Editable fields write back to the product table.
//
// Bottom: channel-only aspects (those that cannot be derived from
// canonical data). For now this lists the eBay-only aspects; GMC
// and Meta will plug in here later.
//
// All channel mapping is configured once in the Settings page at
// /admin/settings/channel-mappings — never duplicated per product.
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
  type ResolvedCanonicalValue,
  type CanonicalProvider,
} from "@/hooks/admin/use-channel-taxonomy";
import { invokeWithAuth } from "@/lib/invokeWithAuth";
import { productKeys } from "@/hooks/admin/use-products";
import { supabase } from "@/integrations/supabase/client";
import { SurfaceCard, SectionHead } from "./ui-primitives";
import type { ProductDetail, FieldOverride } from "@/lib/types/admin";

interface SpecificationsTabProps {
  product: ProductDetail;
}

function SourceBadge({ source }: { source: CanonicalProvider }) {
  const label =
    source === "override"
      ? "Override"
      : source === "product"
        ? "Product"
        : source === "brickeconomy"
          ? "BrickEconomy"
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

// ─── Single attribute row ──────────────────────────────────

function AttributeRow({
  attr,
  value,
  onChange,
  onRevert,
}: {
  attr: ResolvedCanonicalValue;
  value: string;
  onChange: (v: string) => void;
  onRevert?: () => void;
}) {
  const editor = attr.editor || (attr.editable ? "text" : "readOnly");
  const isReadOnly = !attr.editable || editor === "readOnly";

  return (
    <div className="py-2 border-b border-zinc-100">
      <div className="flex items-center gap-1.5 mb-1">
        <label className="text-[11px] text-zinc-500 font-medium uppercase tracking-wider">
          {attr.label}
          {attr.unit && <span className="ml-1 text-zinc-400 normal-case">({attr.unit})</span>}
        </label>
        <SourceBadge source={attr.source} />
      </div>

      {isReadOnly ? (
        <div className="text-[13px] text-zinc-900 py-1 font-mono">
          {value || <span className="text-amber-500/50">—</span>}
        </div>
      ) : editor === "textarea" ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          className="w-full px-2 py-1.5 bg-zinc-50 border border-zinc-200 rounded text-zinc-900 text-[13px]"
        />
      ) : (
        <input
          type={editor === "date" ? "date" : editor === "number" ? "number" : "text"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-2 py-1.5 bg-zinc-50 border border-zinc-200 rounded text-zinc-900 text-[13px] font-mono"
        />
      )}

      {attr.isOverride && onRevert && (
        <button
          type="button"
          onClick={onRevert}
          className="text-[10px] text-amber-600 hover:text-amber-700 underline mt-0.5 bg-transparent border-none p-0 cursor-pointer"
        >
          Revert to source value
        </button>
      )}
    </div>
  );
}

// ─── Main tab ──────────────────────────────────────────────

export function SpecificationsTab({ product }: SpecificationsTabProps) {
  const queryClient = useQueryClient();
  const marketplace = product.ebayMarketplace || "EBAY_GB";

  // Auto-resolve eBay category when no manual override.
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

  // Resolve all canonical attributes + the channel projection in one call.
  const aspects = useResolveEbayAspects(product.id, effectiveCategoryId, marketplace);

  // Editable form state, hydrated from resolved canonical values.
  const [form, setForm] = useState<Record<string, string>>({});
  const [hydratedFor, setHydratedFor] = useState<string | null>(null);
  useEffect(() => {
    if (!aspects.data?.canonical) return;
    const sig = `${product.id}|${effectiveCategoryId ?? "none"}|${aspects.data.canonical.length}`;
    if (sig === hydratedFor) return;
    const next: Record<string, string> = {};
    for (const a of aspects.data.canonical) next[a.key] = a.value ?? "";
    setForm(next);
    setHydratedFor(sig);
  }, [aspects.data, product.id, effectiveCategoryId, hydratedFor]);

  const editableAttrs = useMemo(
    () => (aspects.data?.canonical ?? []).filter((a) => a.editable && a.dbColumn),
    [aspects.data],
  );
  const isDirty = useMemo(
    () =>
      editableAttrs.some((a) => (form[a.key] ?? "") !== (a.value ?? "")),
    [editableAttrs, form],
  );

  const [saving, setSaving] = useState(false);

  const handleChange = (key: string, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const handleRevert = (a: ResolvedCanonicalValue) => {
    // Revert by clearing the override field in field_overrides; the value
    // will fall through to the next provider on re-resolve.
    setForm((prev) => ({ ...prev, [a.key]: "" }));
  };

  const handleSave = async () => {
    if (!aspects.data) return;
    setSaving(true);
    try {
      const updates: Record<string, unknown> = {};
      const overrides: Record<string, FieldOverride> = { ...product.fieldOverrides };
      let overridesChanged = false;

      for (const a of editableAttrs) {
        if (!a.dbColumn) continue;
        const newRaw = form[a.key] ?? "";
        const newVal = newRaw.trim() === "" ? null : newRaw;
        const oldVal = a.value;
        if (newVal === oldVal) continue;

        // Coerce per data_type for DB write.
        let coerced: unknown = newVal;
        if (newVal != null) {
          if (a.dataType === "number" || a.editor === "number") {
            const n = Number(newVal);
            coerced = Number.isFinite(n) ? n : null;
          }
        } else {
          coerced = null;
        }
        updates[a.dbColumn] = coerced;

        // Track override vs source. If a non-product source had a value and
        // the user changed it, mark as override; if they cleared it, remove
        // any existing override.
        const cameFromExternalSource =
          a.source === "brickeconomy" ||
          a.source === "catalog" ||
          a.source === "rebrickable" ||
          a.source === "derived";

        if (cameFromExternalSource && newVal != null) {
          overrides[a.dbColumn] = {
            overridden_at: new Date().toISOString(),
            source_value: a.value ?? "",
          };
          overridesChanged = true;
        } else if (newVal == null && overrides[a.dbColumn]) {
          delete overrides[a.dbColumn];
          overridesChanged = true;
        }
      }

      if (Object.keys(updates).length === 0) {
        setSaving(false);
        return;
      }
      if (overridesChanged) updates.field_overrides = overrides;

      await invokeWithAuth("admin-data", {
        action: "update-product",
        product_id: product.id,
        ...updates,
      });
      toast.success("Specifications saved");
      queryClient.invalidateQueries({ queryKey: productKeys.detail(product.mpn) });
      queryClient.invalidateQueries({ queryKey: ["taxonomy"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
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

  // Channel-only aspects = aspects in the schema with no canonical mapping.
  const channelOnlyAspects = useMemo(
    () =>
      (aspects.data?.aspects ?? []).filter(
        (a) => a.source === "unmapped" || a.source === "none",
      ),
    [aspects.data],
  );
  const requiredMissing = channelOnlyAspects.filter((a) => a.required);

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

      {/* Canonical specifications */}
      <SurfaceCard>
        <div className="flex items-center justify-between mb-3">
          <SectionHead>Product Specifications</SectionHead>
          <div className="flex items-center gap-3">
            <Link
              to="/admin/settings/channel-mappings"
              className="text-[11px] text-zinc-500 hover:text-zinc-700 underline"
            >
              Manage attributes & mappings
            </Link>
            <button
              onClick={handleSave}
              disabled={!isDirty || saving}
              className="bg-amber-500 text-zinc-900 border-none rounded-md px-4 py-1.5 font-bold text-[12px] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed hover:bg-amber-400 transition-colors"
            >
              {saving ? "Saving…" : "Save Specs"}
            </button>
          </div>
        </div>
        <p className="text-[11px] text-zinc-500 mb-3">
          Single canonical record. Values are resolved per attribute through its
          provider chain (product → BrickEconomy → catalog → derived). Edits save
          to the product table; channel listings (eBay, GMC, Meta) project from
          here automatically.
        </p>

        {aspects.isLoading || !aspects.data ? (
          <div className="text-[12px] text-zinc-500 py-4">Loading specifications…</div>
        ) : aspects.data.canonical.length === 0 ? (
          <div className="text-[12px] text-zinc-500 py-4">
            No canonical attributes configured.{" "}
            <Link
              to="/admin/settings/channel-mappings"
              className="text-amber-600 hover:underline"
            >
              Add some in Settings
            </Link>
            .
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-x-6 gap-y-1">
            {aspects.data.canonical.map((a) => (
              <AttributeRow
                key={a.key}
                attr={a}
                value={form[a.key] ?? ""}
                onChange={(v) => handleChange(a.key, v)}
                onRevert={a.isOverride ? () => handleRevert(a) : undefined}
              />
            ))}
          </div>
        )}
      </SurfaceCard>

      {/* Channel-only aspects (eBay) */}
      {effectiveCategoryId && aspects.data && (
        <SurfaceCard>
          <SectionHead>Channel-only Aspects · eBay</SectionHead>
          <p className="text-[11px] text-zinc-500 mb-3 mt-1">
            These eBay item specifics for the chosen category are not derived from
            canonical data. Map them once in{" "}
            <Link
              to="/admin/settings/channel-mappings"
              className="text-amber-600 hover:underline"
            >
              Settings
            </Link>{" "}
            (e.g. constant value, or a new canonical attribute).
          </p>

          <div className="text-[11px] text-zinc-600 mb-2">
            <strong className="text-zinc-900">{aspects.data.resolvedCount}</strong> of{" "}
            <strong className="text-zinc-900">{aspects.data.totalSchemaCount}</strong> aspects
            resolved automatically
            {requiredMissing.length > 0 && (
              <span className="text-amber-700"> · {requiredMissing.length} required missing</span>
            )}
          </div>

          {!aspects.data.schemaLoaded ? (
            <div className="text-[12px] text-zinc-500">
              Aspect schema not loaded for this category yet.
            </div>
          ) : channelOnlyAspects.length === 0 ? (
            <div className="text-[12px] text-emerald-600">
              All aspects mapped from canonical data ✓
            </div>
          ) : (
            <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-zinc-600">
              {channelOnlyAspects.map((m) => (
                <li key={m.aspectKey} className="flex items-center gap-1">
                  {m.required && <span className="text-red-500">*</span>}
                  <span>{m.aspectKey}</span>
                </li>
              ))}
            </ul>
          )}
        </SurfaceCard>
      )}

      {/* Catalog image — kept here as it's a per-product spec choice */}
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
    </div>
  );
}
