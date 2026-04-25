// ============================================================
// CanonicalSpecsCard
// Renders the single canonical attribute list for a product.
// Source = product columns + BrickEconomy fallback.
// Edits write directly to the product table via admin-data;
// BrickEconomy overrides are tracked in product.field_overrides.
// To add a new attribute: append to CANONICAL_ATTRIBUTES — that's it.
// ============================================================

import { useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { invokeWithAuth } from "@/lib/invokeWithAuth";
import { productKeys } from "@/hooks/admin/use-products";
import { SurfaceCard, SectionHead } from "./ui-primitives";
import {
  CANONICAL_ATTRIBUTES,
  type CanonicalAttribute,
} from "@/lib/utils/canonical-attributes";
import type { ProductDetail, FieldOverride } from "@/lib/types/admin";

interface Props {
  product: ProductDetail;
}

function resolveValue(attr: CanonicalAttribute, product: ProductDetail): string {
  const direct = attr.read(product);
  if (direct) return direct;
  const be = attr.readBE?.(product.brickeconomyData);
  return be ?? "";
}

function SourceBadge({ label }: { label: "Product" | "BrickEconomy" | "Override" }) {
  const colour =
    label === "Override"
      ? "text-amber-600 bg-amber-50 border-amber-200"
      : label === "BrickEconomy"
        ? "text-sky-600 bg-sky-50 border-sky-200"
        : "text-zinc-500 bg-zinc-50 border-zinc-200";
  return (
    <span className={`inline-block text-[9px] font-medium uppercase tracking-wider px-1.5 py-px border rounded ${colour}`}>
      {label}
    </span>
  );
}

export function CanonicalSpecsCard({ product }: Props) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const a of CANONICAL_ATTRIBUTES) initial[a.key] = resolveValue(a, product);
    return initial;
  });
  const [saving, setSaving] = useState(false);
  const [lastProductId, setLastProductId] = useState(product.id);

  if (product.id !== lastProductId) {
    setLastProductId(product.id);
    const fresh: Record<string, string> = {};
    for (const a of CANONICAL_ATTRIBUTES) fresh[a.key] = resolveValue(a, product);
    setForm(fresh);
  }

  const isDirty = CANONICAL_ATTRIBUTES.some(
    (a) => a.editor !== "readOnly" && form[a.key] !== resolveValue(a, product),
  );

  const handleChange = (key: string, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const handleSave = async () => {
    setSaving(true);
    try {
      const updates: Record<string, unknown> = {};
      const overrides: Record<string, FieldOverride> = { ...product.fieldOverrides };
      let overridesChanged = false;

      for (const a of CANONICAL_ATTRIBUTES) {
        if (a.editor === "readOnly" || !a.dbColumn) continue;
        const newVal = form[a.key];
        const oldVal = a.read(product);
        if (newVal === oldVal) continue;
        updates[a.dbColumn] = a.toDb ? a.toDb(newVal) : (newVal.trim() || null);

        const beVal = a.readBE?.(product.brickeconomyData) ?? null;
        if (beVal != null && newVal !== beVal) {
          overrides[a.dbColumn] = {
            overridden_at: new Date().toISOString(),
            source_value: beVal,
          };
          overridesChanged = true;
        } else if (beVal != null && newVal === beVal && overrides[a.dbColumn]) {
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
      toast.success("Specifications saved — channel mappings will refresh automatically");
      queryClient.invalidateQueries({ queryKey: productKeys.detail(product.mpn) });
      // Invalidate any resolved-aspects queries for this product so the
      // Channel Mapping card recomputes immediately.
      queryClient.invalidateQueries({ queryKey: ["taxonomy"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SurfaceCard>
      <div className="flex items-center justify-between mb-3">
        <SectionHead>Product Specifications</SectionHead>
        <button
          onClick={handleSave}
          disabled={!isDirty || saving}
          className="bg-amber-500 text-zinc-900 border-none rounded-md px-4 py-1.5 font-bold text-[12px] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed hover:bg-amber-400 transition-colors"
        >
          {saving ? "Saving…" : "Save Specs"}
        </button>
      </div>
      <p className="text-[11px] text-zinc-500 mb-3">
        Canonical product attributes. eBay, Google Merchant and Meta listings are
        derived from these values automatically — never re-entered per channel.
      </p>

      <div className="grid grid-cols-2 gap-x-6 gap-y-1">
        {CANONICAL_ATTRIBUTES.map((a) => {
          const productHasValue = !!a.read(product);
          const beVal = a.readBE?.(product.brickeconomyData) ?? null;
          const isFromBE = !productHasValue && !!beVal && form[a.key] === beVal;
          const isOverridden = a.dbColumn ? !!product.fieldOverrides[a.dbColumn] : false;
          const sourceLabel = isOverridden
            ? "Override"
            : isFromBE
              ? "BrickEconomy"
              : "Product";

          return (
            <div key={a.key} className="py-2 border-b border-zinc-100">
              <div className="flex items-center gap-1.5 mb-1">
                <label className="text-[11px] text-zinc-500 font-medium uppercase tracking-wider">
                  {a.label}
                </label>
                <SourceBadge label={sourceLabel as "Product" | "BrickEconomy" | "Override"} />
              </div>

              {a.editor === "readOnly" ? (
                <div className="text-[13px] text-zinc-900 py-1 font-mono">
                  {form[a.key] || <span className="text-amber-500/50">—</span>}
                </div>
              ) : a.editor === "textarea" ? (
                <textarea
                  value={form[a.key]}
                  onChange={(e) => handleChange(a.key, e.target.value)}
                  rows={3}
                  className="w-full px-2 py-1.5 bg-zinc-50 border border-zinc-200 rounded text-zinc-900 text-[13px] placeholder:text-zinc-400"
                  placeholder={beVal ? `${beVal} (BrickEconomy)` : "—"}
                />
              ) : (
                <input
                  type={a.editor === "date" ? "date" : a.editor === "number" ? "number" : "text"}
                  value={form[a.key]}
                  onChange={(e) => handleChange(a.key, e.target.value)}
                  placeholder={beVal ? `${beVal} (BrickEconomy)` : "—"}
                  className="w-full px-2 py-1.5 bg-zinc-50 border border-zinc-200 rounded text-zinc-900 text-[13px] font-mono placeholder:text-zinc-400 placeholder:font-sans"
                />
              )}

              {isOverridden && beVal != null && (
                <button
                  type="button"
                  onClick={() => handleChange(a.key, beVal)}
                  className="text-[10px] text-amber-600 hover:text-amber-700 underline mt-0.5 bg-transparent border-none p-0 cursor-pointer"
                >
                  Revert to BrickEconomy ({beVal})
                </button>
              )}
            </div>
          );
        })}
      </div>
    </SurfaceCard>
  );
}
