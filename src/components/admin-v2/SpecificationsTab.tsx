import { useState } from "react";
import type { ProductDetail, BrickEconomyData, FieldOverride } from "@/lib/types/admin";
import { SurfaceCard, SectionHead } from "./ui-primitives";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { productKeys } from "@/hooks/admin/use-products";
import { invokeWithAuth } from "@/lib/invokeWithAuth";
import { supabase } from "@/integrations/supabase/client";
import { EbayCategoryPicker } from "./EbayCategoryPicker";
import { EbayAspectsForm } from "./EbayAspectsForm";

interface SpecificationsTabProps {
  product: ProductDetail;
}

// Maps UI field key → product DB column name
const FIELD_TO_DB: Record<string, string> = {
  setNumber: "set_number",
  subtheme: "subtheme_name",
  pieceCount: "piece_count",
  ageMark: "age_mark",
  ean: "ean",
  releaseDate: "released_date",
  retiredDate: "retired_date",
  dimensionsCm: "dimensions_cm",
  weightG: "weight_g",
};

// Maps UI field key → BrickEconomy data field
const FIELD_TO_BE: Record<string, keyof BrickEconomyData> = {
  subtheme: "subtheme",
  pieceCount: "piecesCount",
  releaseDate: "releasedDate",
  retiredDate: "retiredDate",
};

interface SpecField {
  key: string;
  label: string;
  type: "text" | "number" | "date";
  readOnly?: boolean;
}

const SPEC_FIELDS: SpecField[] = [
  { key: "setNumber", label: "Set Number", type: "text" },
  { key: "theme", label: "Theme", type: "text", readOnly: true },
  { key: "subtheme", label: "Subtheme", type: "text" },
  { key: "pieceCount", label: "Pieces", type: "number" },
  { key: "ageMark", label: "Age Mark", type: "text" },
  { key: "ean", label: "EAN", type: "text" },
  { key: "releaseDate", label: "Released", type: "date" },
  { key: "retiredDate", label: "Retired", type: "date" },
  { key: "dimensionsCm", label: "Dimensions", type: "text" },
  { key: "weightG", label: "Weight (g)", type: "number" },
];

function getProductValue(product: ProductDetail, key: string): string {
  const val = (product as unknown as Record<string, unknown>)[key];
  if (val == null) return "";
  return String(val);
}

function getBEValue(be: BrickEconomyData | null, key: string): string | null {
  const beKey = FIELD_TO_BE[key];
  if (!be || !beKey) return null;
  const val = be[beKey];
  if (val == null) return null;
  return String(val);
}

export function SpecificationsTab({ product }: SpecificationsTabProps) {
  const queryClient = useQueryClient();

  // Resolve initial values: product field → BrickEconomy fallback
  const resolveValue = (key: string): string => {
    const productVal = getProductValue(product, key);
    if (productVal) return productVal;
    return getBEValue(product.brickeconomyData, key) ?? "";
  };

  const [form, setForm] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const f of SPEC_FIELDS) {
      initial[f.key] = resolveValue(f.key);
    }
    return initial;
  });

  const [saving, setSaving] = useState(false);

  // Sync form when product changes (e.g. after save)
  const [lastProductId, setLastProductId] = useState(product.id);
  if (product.id !== lastProductId) {
    setLastProductId(product.id);
    const fresh: Record<string, string> = {};
    for (const f of SPEC_FIELDS) {
      fresh[f.key] = resolveValue(f.key);
    }
    setForm(fresh);
  }

  const isDirty = SPEC_FIELDS.some(
    (f) => !f.readOnly && form[f.key] !== resolveValue(f.key),
  );

  const handleChange = (key: string, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const updates: Record<string, unknown> = {};
      const overrides: Record<string, FieldOverride> = { ...product.fieldOverrides };
      let overridesChanged = false;

      for (const f of SPEC_FIELDS) {
        if (f.readOnly) continue;
        const dbCol = FIELD_TO_DB[f.key];
        if (!dbCol) continue;

        const newVal = form[f.key].trim();
        const oldVal = getProductValue(product, f.key);

        if (newVal === oldVal) continue;

        // Convert to appropriate DB type
        if (f.type === "number") {
          updates[dbCol] = newVal ? parseInt(newVal, 10) || null : null;
        } else {
          updates[dbCol] = newVal || null;
        }

        // Track override if this field has a BE source
        const beVal = getBEValue(product.brickeconomyData, f.key);
        if (beVal != null && newVal !== beVal) {
          overrides[dbCol] = {
            overridden_at: new Date().toISOString(),
            source_value: beVal,
          };
          overridesChanged = true;
        } else if (beVal != null && newVal === beVal && overrides[dbCol]) {
          delete overrides[dbCol];
          overridesChanged = true;
        }
      }

      if (Object.keys(updates).length === 0) {
        setSaving(false);
        return;
      }

      if (overridesChanged) {
        updates.field_overrides = overrides;
      }

      await invokeWithAuth("admin-data", {
        action: "update-product",
        product_id: product.id,
        ...updates,
      });
      toast.success("Specifications saved");
      queryClient.invalidateQueries({ queryKey: productKeys.detail(product.mpn) });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
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

  return (
    <div className="grid gap-4">
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

        <div className="grid grid-cols-2 gap-x-6 gap-y-1">
          {SPEC_FIELDS.map((f) => {
            const productHasValue = !!getProductValue(product, f.key);
            const beVal = getBEValue(product.brickeconomyData, f.key);
            const isFromBE = !productHasValue && !!beVal && form[f.key] === beVal;
            const dbCol = FIELD_TO_DB[f.key];
            const isOverridden = dbCol ? !!product.fieldOverrides[dbCol] : false;

            return (
              <div key={f.key} className="py-2 border-b border-zinc-100">
                <label className="text-[11px] text-zinc-500 font-medium uppercase tracking-wider block mb-1">
                  {f.label}
                </label>
                {f.readOnly ? (
                  <div className="text-[13px] text-zinc-900 py-1">
                    {form[f.key] || <span className="text-amber-500/50">—</span>}
                  </div>
                ) : (
                  <>
                    <input
                      type={f.type === "date" ? "date" : "text"}
                      value={form[f.key]}
                      onChange={(e) => handleChange(f.key, e.target.value)}
                      placeholder={beVal ? `${beVal} (BrickEconomy)` : "—"}
                      className="w-full px-2 py-1.5 bg-zinc-50 border border-zinc-200 rounded text-zinc-900 text-[13px] font-mono placeholder:text-zinc-400 placeholder:font-sans"
                    />
                    {isFromBE && (
                      <span className="text-[10px] text-zinc-400 mt-0.5 block">
                        From BrickEconomy
                      </span>
                    )}
                    {isOverridden && (
                      <span className="text-[10px] text-amber-500 mt-0.5 block">
                        Overridden
                        <button
                          onClick={() => {
                            if (beVal != null) handleChange(f.key, beVal);
                          }}
                          className="ml-1 underline text-amber-500 hover:text-amber-400 bg-transparent border-none cursor-pointer text-[10px] p-0"
                        >
                          revert
                        </button>
                      </span>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </SurfaceCard>

      {/* Catalog Image */}
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
                When enabled, this image from the LEGO catalog will be included alongside your uploaded product photos.
              </p>
            </div>
          </div>
        </SurfaceCard>
      )}
    </div>
  );
}
