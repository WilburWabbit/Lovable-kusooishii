import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Save, ExternalLink, AlertTriangle } from "lucide-react";
import { invokeWithAuth } from "@/lib/invokeWithAuth";
import { toast } from "sonner";
import type { ProductDetail, FieldOverride } from "./types";
import { GRADE_LABELS, FIELD_LABELS, fmt, getSourceValue } from "./types";

interface ProductDetailsTabProps {
  product: ProductDetail;
  onInvalidate: () => void;
}

type FormValues = Record<string, string | boolean>;

function initForm(product: ProductDetail): FormValues {
  const src = product.source_data;
  return {
    name: String(product.name ?? ""),
    theme_name: String(product.theme_name ?? ""),
    subtheme_name: String(product.subtheme_name ?? ""),
    age_range: String(product.age_range ?? ""),
    piece_count: String(product.piece_count ?? ""),
    minifigs_count: String(product.minifigs_count ?? ""),
    retail_price: String(product.retail_price ?? ""),
    product_type: String(product.product_type ?? "set"),
    brand: String(product.brand ?? ""),
    version_descriptor: String(product.version_descriptor ?? ""),
    release_year: String(product.release_year ?? ""),
    released_date: String(product.released_date ?? ""),
    retired_flag: product.retired_flag,
    retired_date: String(product.retired_date ?? ""),
    length_cm: String(product.length_cm ?? ""),
    width_cm: String(product.width_cm ?? ""),
    height_cm: String(product.height_cm ?? ""),
    weight_kg: String(product.weight_kg ?? ""),
    brickeconomy_id: String(product.brickeconomy_id ?? src?.lego_catalog?.brickeconomy_id ?? ""),
    bricklink_item_no: String(product.bricklink_item_no ?? src?.lego_catalog?.bricklink_item_no ?? ""),
    brickowl_boid: String(product.brickowl_boid ?? src?.lego_catalog?.brickowl_boid ?? ""),
    rebrickable_id: String(product.rebrickable_id ?? src?.lego_catalog?.rebrickable_id ?? ""),
  };
}

const CATALOG_URLS: Record<string, (id: string) => string> = {
  brickeconomy_id: (id) => `https://www.brickeconomy.com/set/${id}`,
  bricklink_item_no: (id) => `https://www.bricklink.com/v2/catalog/catalogitem.page?S=${id}`,
  brickowl_boid: (id) => `https://www.brickowl.com/catalog/${id}`,
  rebrickable_id: (id) => `https://rebrickable.com/sets/${id}`,
};

export function ProductDetailsTab({ product, onInvalidate }: ProductDetailsTabProps) {
  const [form, setForm] = useState<FormValues>(initForm(product));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm(initForm(product));
    setDirty(false);
  }, [product]);

  const handleChange = useCallback((key: string, value: string | boolean) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const updates: Record<string, unknown> = {};
      const initial = initForm(product);

      const INT_FIELDS = ["piece_count", "minifigs_count", "release_year"];
      const FLOAT_FIELDS = ["retail_price", "length_cm", "width_cm", "height_cm", "weight_kg"];

      for (const [key, value] of Object.entries(form)) {
        if (value === initial[key]) continue;
        if (typeof value === "boolean") {
          updates[key] = value;
        } else if (value === "") {
          updates[key] = null;
        } else if (INT_FIELDS.includes(key)) {
          updates[key] = parseInt(String(value), 10) || null;
        } else if (FLOAT_FIELDS.includes(key)) {
          updates[key] = parseFloat(String(value)) || null;
        } else {
          updates[key] = String(value).trim() || null;
        }
      }

      if (Object.keys(updates).length === 0) {
        setDirty(false);
        return;
      }

      // Track overrides for fields with source data
      const overrides: Record<string, FieldOverride> = { ...(product.field_overrides ?? {}) };
      let overridesChanged = false;
      for (const key of Object.keys(updates)) {
        const sourceVal = getSourceValue(key, product.source_data);
        if (sourceVal !== undefined && updates[key] !== sourceVal) {
          overrides[key] = {
            overridden_at: new Date().toISOString(),
            source_value: sourceVal,
          };
          overridesChanged = true;
        } else if (sourceVal !== undefined && updates[key] === sourceVal && overrides[key]) {
          delete overrides[key];
          overridesChanged = true;
        }
      }
      if (overridesChanged) {
        updates.field_overrides = overrides;
      }

      await invokeWithAuth("admin-data", {
        action: "update-product",
        product_id: product.id,
        ...updates,
      });
      toast.success("Details saved");
      setDirty(false);
      onInvalidate();
    } catch (err: any) {
      toast.error(err.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const overrides = product.field_overrides ?? {};

  function hasStaleOverride(field: string): boolean {
    const override = overrides[field];
    if (!override) return false;
    const currentSource = getSourceValue(field, product.source_data);
    return currentSource !== undefined && currentSource !== override.source_value;
  }

  function revertToSource(field: string) {
    const sourceVal = getSourceValue(field, product.source_data);
    if (sourceVal !== undefined) {
      handleChange(field, String(sourceVal));
    }
  }

  const width = parseFloat(String(form.width_cm)) || 0;
  const height = parseFloat(String(form.height_cm)) || 0;
  const girth = width > 0 && height > 0 ? (2 * (width + height)).toFixed(1) : null;

  return (
    <TooltipProvider>
      <div className="space-y-4">
        {/* Product Details Card */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium">Product Details</CardTitle>
            <Button size="sm" disabled={!dirty || saving} onClick={handleSave}>
              <Save className="h-3.5 w-3.5 mr-1.5" />
              {saving ? "Saving…" : "Save"}
            </Button>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-3">
            {/* MPN - read only */}
            <div>
              <Label className="text-xs text-muted-foreground">MPN</Label>
              <Input value={product.mpn} disabled className="mt-1 font-mono" />
            </div>

            <FieldWithOverride field="name" form={form} onChange={handleChange} hasStale={hasStaleOverride("name")} onRevert={() => revertToSource("name")} />
            <FieldWithOverride field="theme_name" form={form} onChange={handleChange} hasStale={hasStaleOverride("theme_name")} onRevert={() => revertToSource("theme_name")} />
            <FieldWithOverride field="subtheme_name" form={form} onChange={handleChange} hasStale={hasStaleOverride("subtheme_name")} onRevert={() => revertToSource("subtheme_name")} />

            <FieldWithOverride field="release_year" form={form} onChange={handleChange} type="number" hasStale={hasStaleOverride("release_year")} onRevert={() => revertToSource("release_year")} />
            <FieldWithOverride field="piece_count" form={form} onChange={handleChange} type="number" hasStale={hasStaleOverride("piece_count")} onRevert={() => revertToSource("piece_count")} />
            <FieldWithOverride field="minifigs_count" form={form} onChange={handleChange} type="number" hasStale={hasStaleOverride("minifigs_count")} onRevert={() => revertToSource("minifigs_count")} />

            {/* Retail Price with £ prefix */}
            <div>
              <Label className="text-xs text-muted-foreground flex items-center gap-1">
                {FIELD_LABELS.retail_price}
                {hasStaleOverride("retail_price") && <StaleIndicator field="retail_price" product={product} onRevert={() => revertToSource("retail_price")} />}
              </Label>
              <div className="relative mt-1">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">£</span>
                <Input
                  type="number"
                  step="0.01"
                  value={String(form.retail_price ?? "")}
                  onChange={(e) => handleChange("retail_price", e.target.value)}
                  className="pl-7"
                />
              </div>
            </div>

            <FieldWithOverride field="product_type" form={form} onChange={handleChange} hasStale={hasStaleOverride("product_type")} onRevert={() => revertToSource("product_type")} />
            <FieldWithOverride field="brand" form={form} onChange={handleChange} hasStale={hasStaleOverride("brand")} onRevert={() => revertToSource("brand")} />
            <FieldWithOverride field="version_descriptor" form={form} onChange={handleChange} hasStale={hasStaleOverride("version_descriptor")} onRevert={() => revertToSource("version_descriptor")} />

            {/* Released Date */}
            <FieldWithOverride field="released_date" form={form} onChange={handleChange} type="date" hasStale={hasStaleOverride("released_date")} onRevert={() => revertToSource("released_date")} />

            {/* Retired toggle */}
            <div className="flex flex-col gap-2">
              <Label className="text-xs text-muted-foreground">{FIELD_LABELS.retired_flag}</Label>
              <Switch
                checked={!!form.retired_flag}
                onCheckedChange={(v) => handleChange("retired_flag", v)}
              />
            </div>

            {/* Retired Date - only shown when retired */}
            {form.retired_flag && (
              <FieldWithOverride field="retired_date" form={form} onChange={handleChange} type="date" hasStale={hasStaleOverride("retired_date")} onRevert={() => revertToSource("retired_date")} />
            )}

            <FieldWithOverride field="age_range" form={form} onChange={handleChange} hasStale={hasStaleOverride("age_range")} onRevert={() => revertToSource("age_range")} />
          </CardContent>
        </Card>

        {/* Physical Dimensions Card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Physical Dimensions</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-5">
            <FieldWithOverride field="length_cm" form={form} onChange={handleChange} type="number" step="0.1" hasStale={hasStaleOverride("length_cm")} onRevert={() => revertToSource("length_cm")} />
            <FieldWithOverride field="width_cm" form={form} onChange={handleChange} type="number" step="0.1" hasStale={hasStaleOverride("width_cm")} onRevert={() => revertToSource("width_cm")} />
            <FieldWithOverride field="height_cm" form={form} onChange={handleChange} type="number" step="0.1" hasStale={hasStaleOverride("height_cm")} onRevert={() => revertToSource("height_cm")} />
            <FieldWithOverride field="weight_kg" form={form} onChange={handleChange} type="number" step="0.01" hasStale={hasStaleOverride("weight_kg")} onRevert={() => revertToSource("weight_kg")} />
            <div>
              <Label className="text-xs text-muted-foreground">Girth (cm)</Label>
              <Input value={girth ?? "—"} disabled className="mt-1" />
            </div>
          </CardContent>
        </Card>

        {/* Cross-Catalog IDs Card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Cross-Catalog IDs</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            {(["brickeconomy_id", "bricklink_item_no", "brickowl_boid", "rebrickable_id"] as const).map((field) => (
              <div key={field}>
                <Label className="text-xs text-muted-foreground flex items-center gap-1">
                  {FIELD_LABELS[field]}
                  {hasStaleOverride(field) && <StaleIndicator field={field} product={product} onRevert={() => revertToSource(field)} />}
                </Label>
                <div className="flex items-center gap-1 mt-1">
                  <Input
                    value={String(form[field] ?? "")}
                    onChange={(e) => handleChange(field, e.target.value)}
                    className="flex-1"
                  />
                  {form[field] && CATALOG_URLS[field] && (
                    <a
                      href={CATALOG_URLS[field](String(form[field]))}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 text-muted-foreground hover:text-foreground"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Variants / SKU Table Card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Variants / SKUs</CardTitle>
          </CardHeader>
          <CardContent>
            {product.skus.length === 0 ? (
              <p className="text-sm text-muted-foreground">No SKUs found.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SKU Code</TableHead>
                    <TableHead>Condition</TableHead>
                    <TableHead>Price</TableHead>
                    <TableHead>Active</TableHead>
                    <TableHead className="text-right">Stock</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {product.skus.map((sku) => (
                    <TableRow key={sku.id}>
                      <TableCell className="font-mono text-xs">{sku.sku_code}</TableCell>
                      <TableCell>{GRADE_LABELS[sku.condition_grade] ?? sku.condition_grade}</TableCell>
                      <TableCell>{fmt(sku.price)}</TableCell>
                      <TableCell>
                        <Badge variant={sku.active_flag ? "default" : "secondary"} className="text-[10px]">
                          {sku.active_flag ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">{sku.stock_available}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </TooltipProvider>
  );
}

/** Generic editable field with override indicator */
function FieldWithOverride({
  field,
  form,
  onChange,
  type = "text",
  step,
  hasStale,
  onRevert,
}: {
  field: string;
  form: FormValues;
  onChange: (key: string, value: string) => void;
  type?: string;
  step?: string;
  hasStale: boolean;
  onRevert: () => void;
}) {
  return (
    <div>
      <Label className="text-xs text-muted-foreground flex items-center gap-1">
        {FIELD_LABELS[field] ?? field}
        {hasStale && <StaleOverrideIcon onRevert={onRevert} />}
      </Label>
      <Input
        type={type}
        step={step}
        value={String(form[field] ?? "")}
        onChange={(e) => onChange(field, e.target.value)}
        className="mt-1"
      />
    </div>
  );
}

/** Amber triangle icon for stale overrides, shown inline next to the label */
function StaleIndicator({
  field,
  product,
  onRevert,
}: {
  field: string;
  product: ProductDetail;
  onRevert: () => void;
}) {
  const override = product.field_overrides?.[field];
  const currentSource = getSourceValue(field, product.source_data);
  if (!override) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" onClick={onRevert} className="inline-flex">
          <AlertTriangle className="h-3 w-3 text-amber-500" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs text-xs">
        <p>
          Source updated to <strong>{String(currentSource)}</strong> since your
          override on {new Date(override.overridden_at).toLocaleDateString()}.
        </p>
        <p className="mt-1 text-muted-foreground">Click to revert to source value.</p>
      </TooltipContent>
    </Tooltip>
  );
}

/** Simplified stale icon for the FieldWithOverride helper */
function StaleOverrideIcon({ onRevert }: { onRevert: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" onClick={onRevert} className="inline-flex">
          <AlertTriangle className="h-3 w-3 text-amber-500" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        Source data changed since override. Click to revert.
      </TooltipContent>
    </Tooltip>
  );
}
