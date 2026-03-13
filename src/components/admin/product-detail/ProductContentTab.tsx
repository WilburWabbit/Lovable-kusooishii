import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Save, Sparkles, Loader2 } from "lucide-react";
import { invokeWithAuth } from "@/lib/invokeWithAuth";
import { toast } from "sonner";
import { CharLimitField } from "./CharLimitField";
import { CONTENT_FIELDS } from "./types";
import type { ProductDetail } from "./types";

interface ProductContentTabProps {
  product: ProductDetail;
  onInvalidate: () => void;
}

export function ProductContentTab({ product, onInvalidate }: ProductContentTabProps) {
  const [form, setForm] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    const initial: Record<string, string> = {};
    for (const f of CONTENT_FIELDS) {
      initial[f.key] = (product as any)[f.key] ?? "";
    }
    setForm(initial);
    setDirty(false);
  }, [product]);

  const handleChange = useCallback((key: string, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  }, []);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const result = await invokeWithAuth<{ copy: any }>("generate-product-copy", {
        product: {
          name: product.name,
          mpn: product.mpn,
          theme_name: product.theme_name,
          subtheme_name: product.subtheme_name,
          piece_count: product.piece_count,
          release_year: product.release_year,
          retired_flag: product.retired_flag,
          age_range: product.age_range,
          weight_kg: product.weight_kg,
          length_cm: product.length_cm,
          width_cm: product.width_cm,
          height_cm: product.height_cm,
        },
        product_id: product.id,
        auto_save: true,
      });

      const copy = result.copy;
      const highlightsBullets = Array.isArray(copy.highlights)
        ? copy.highlights.map((h: string) => `• ${h}`).join("\n")
        : copy.highlights ?? "";

      setForm({
        product_hook: copy.hook ?? "",
        description: copy.description ?? "",
        call_to_action: copy.cta ?? "",
        highlights: highlightsBullets,
        seo_title: copy.seo_title ?? "",
        seo_description: copy.seo_body ?? "",
      });
      setDirty(false);
      toast.success("Copy generated and saved");
      onInvalidate();
    } catch (err: any) {
      toast.error(err.message ?? "Generation failed");
    } finally {
      setGenerating(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const fields: Record<string, string | null> = {};
      for (const f of CONTENT_FIELDS) {
        fields[f.key] = form[f.key]?.trim() || null;
      }
      await invokeWithAuth("admin-data", {
        action: "update-product",
        product_id: product.id,
        ...fields,
      });
      toast.success("Content saved");
      setDirty(false);
      onInvalidate();
    } catch (err: any) {
      toast.error(err.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-medium">Product Content</CardTitle>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" disabled={generating} onClick={handleGenerate}>
            {generating ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5 mr-1.5" />
            )}
            {generating ? "Generating…" : "Generate Copy"}
          </Button>
          <Button size="sm" disabled={!dirty || saving} onClick={handleSave}>
            <Save className="h-3.5 w-3.5 mr-1.5" />
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        {CONTENT_FIELDS.map((f) => (
          <div
            key={f.key}
            className={f.type === "textarea" && f.key === "description" ? "md:col-span-2" : ""}
          >
            <CharLimitField
              id={f.key}
              label={f.label}
              value={form[f.key] ?? ""}
              onChange={(v) => handleChange(f.key, v)}
              type={f.type}
              maxLen={f.maxLen}
              hint={f.hint}
            />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
