import { useState, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Upload, Trash2, Star, Sparkles, Loader2, GripVertical, ImageIcon,
} from "lucide-react";
import { invokeWithAuth } from "@/lib/invokeWithAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";

interface MediaItem {
  id: string; // product_media id
  media_asset_id: string;
  original_url: string;
  alt_text: string | null;
  sort_order: number;
  is_primary: boolean;
  mime_type: string | null;
  width: number | null;
  height: number | null;
}

interface ProductMediaCardProps {
  productId: string;
  productName: string | null;
  mpn: string;
}

export function ProductMediaCard({ productId, productName, mpn }: ProductMediaCardProps) {
  const queryClient = useQueryClient();
  const queryKey = ["product-media", productId];

  const { data: items = [], isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      const data = await invokeWithAuth<MediaItem[]>("admin-data", {
        action: "list-product-media",
        product_id: productId,
      });
      return data;
    },
  });

  const [uploading, setUploading] = useState(false);
  const [altTexts, setAltTexts] = useState<Record<string, string>>({});
  const [savingAlt, setSavingAlt] = useState<string | null>(null);
  const [generatingAlt, setGeneratingAlt] = useState<string | null>(null);
  const [generatingAll, setGeneratingAll] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [settingPrimary, setSettingPrimary] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Drag state
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey });
    queryClient.invalidateQueries({ queryKey: ["admin-product"] });
  };

  const getAltText = (item: MediaItem) => altTexts[item.media_asset_id] ?? item.alt_text ?? "";

  /* ── Upload ── */
  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const currentMax = items.length > 0 ? Math.max(...items.map((i) => i.sort_order)) : -1;
      let sortOrder = currentMax + 1;

      for (const file of Array.from(files)) {
        const ext = file.name.split(".").pop() ?? "jpg";
        const storagePath = `products/${productId}/${crypto.randomUUID()}.${ext}`;

        // Upload to storage
        const { error: uploadErr } = await supabase.storage
          .from("media")
          .upload(storagePath, file, { contentType: file.type, upsert: false });
        if (uploadErr) throw uploadErr;

        // Get public URL
        const { data: urlData } = supabase.storage.from("media").getPublicUrl(storagePath);
        const publicUrl = urlData.publicUrl;

        // Create media_asset via service role (through admin-data won't work for insert, so use supabase directly with RLS — staff policy covers it)
        const { data: asset, error: assetErr } = await supabase
          .from("media_asset")
          .insert({
            original_url: publicUrl,
            mime_type: file.type,
            file_size_bytes: file.size,
            provenance: "upload",
          })
          .select("id")
          .single();
        if (assetErr) throw assetErr;

        // Create product_media link
        const { error: linkErr } = await (supabase as any)
          .from("product_media")
          .insert({
            product_id: productId,
            media_asset_id: asset.id,
            sort_order: sortOrder,
            is_primary: items.length === 0 && sortOrder === 0,
          });
        if (linkErr) throw linkErr;

        // If this is the first image, set it as product img_url
        if (items.length === 0 && sortOrder === 0) {
          await invokeWithAuth("admin-data", {
            action: "set-primary-media",
            product_id: productId,
            product_media_id: asset.id, // we'll need the product_media id — refetch after
          });
        }

        sortOrder++;
      }

      toast.success(`${files.length} image${files.length > 1 ? "s" : ""} uploaded`);
      invalidate();
    } catch (err: any) {
      toast.error(err.message ?? "Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  /* ── Delete ── */
  const handleDelete = async (item: MediaItem) => {
    setDeleting(item.id);
    try {
      await invokeWithAuth("admin-data", {
        action: "delete-product-media",
        product_media_id: item.id,
        media_asset_id: item.media_asset_id,
      });
      toast.success("Image deleted");
      invalidate();
    } catch (err: any) {
      toast.error(err.message ?? "Delete failed");
    } finally {
      setDeleting(null);
    }
  };

  /* ── Set Primary ── */
  const handleSetPrimary = async (item: MediaItem) => {
    setSettingPrimary(item.id);
    try {
      await invokeWithAuth("admin-data", {
        action: "set-primary-media",
        product_id: productId,
        product_media_id: item.id,
      });
      toast.success("Primary image set");
      invalidate();
    } catch (err: any) {
      toast.error(err.message ?? "Failed");
    } finally {
      setSettingPrimary(null);
    }
  };

  /* ── Alt Text Save ── */
  const handleSaveAlt = async (item: MediaItem) => {
    const text = getAltText(item);
    setSavingAlt(item.media_asset_id);
    try {
      await invokeWithAuth("admin-data", {
        action: "update-media-alt-text",
        media_asset_id: item.media_asset_id,
        alt_text: text.trim() || null,
      });
      toast.success("Alt text saved");
      invalidate();
    } catch (err: any) {
      toast.error(err.message ?? "Save failed");
    } finally {
      setSavingAlt(null);
    }
  };

  /* ── AI Generate Alt Text ── */
  const handleGenerateAlt = async (item: MediaItem) => {
    setGeneratingAlt(item.media_asset_id);
    try {
      const result = await invokeWithAuth<{ alt_text: string }>("chatgpt", {
        action: "generate-alt-text",
        image_url: item.original_url,
        product_name: productName,
        mpn,
      });
      setAltTexts((prev) => ({ ...prev, [item.media_asset_id]: result.alt_text }));
      // Auto-save
      await invokeWithAuth("admin-data", {
        action: "update-media-alt-text",
        media_asset_id: item.media_asset_id,
        alt_text: result.alt_text,
      });
      toast.success("Alt text generated & saved");
      invalidate();
    } catch (err: any) {
      toast.error(err.message ?? "Generation failed");
    } finally {
      setGeneratingAlt(null);
    }
  };

  /* ── Generate All Missing Alt Text ── */
  const handleGenerateAllAlt = async () => {
    const missing = items.filter((i) => !i.alt_text && !getAltText(i));
    if (missing.length === 0) {
      toast.info("All images already have alt text");
      return;
    }
    setGeneratingAll(true);
    let count = 0;
    for (const item of missing) {
      try {
        const result = await invokeWithAuth<{ alt_text: string }>("chatgpt", {
          action: "generate-alt-text",
          image_url: item.original_url,
          product_name: productName,
          mpn,
        });
        await invokeWithAuth("admin-data", {
          action: "update-media-alt-text",
          media_asset_id: item.media_asset_id,
          alt_text: result.alt_text,
        });
        setAltTexts((prev) => ({ ...prev, [item.media_asset_id]: result.alt_text }));
        count++;
      } catch {
        // continue with next
      }
    }
    toast.success(`Generated alt text for ${count} image${count !== 1 ? "s" : ""}`);
    setGeneratingAll(false);
    invalidate();
  };

  /* ── Drag & Drop Reorder ── */
  const handleDragStart = (idx: number) => {
    setDragIdx(idx);
  };

  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    setDragOverIdx(idx);
  };

  const handleDrop = async (dropIdx: number) => {
    if (dragIdx === null || dragIdx === dropIdx) {
      setDragIdx(null);
      setDragOverIdx(null);
      return;
    }

    const reordered = [...items];
    const [moved] = reordered.splice(dragIdx, 1);
    reordered.splice(dropIdx, 0, moved);

    setDragIdx(null);
    setDragOverIdx(null);

    // Save new order
    try {
      const reorderItems = reordered.map((item, idx) => ({ id: item.id, sort_order: idx }));
      await invokeWithAuth("admin-data", {
        action: "reorder-product-media",
        items: reorderItems,
      });
      invalidate();
    } catch (err: any) {
      toast.error(err.message ?? "Reorder failed");
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-medium">Media</CardTitle>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={generatingAll || items.length === 0}
            onClick={handleGenerateAllAlt}
          >
            {generatingAll ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1.5" />}
            {generatingAll ? "Generating…" : "Generate All Alt Text"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploading ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Upload className="h-3.5 w-3.5 mr-1.5" />}
            {uploading ? "Uploading…" : "Upload"}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleUpload}
          />
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center h-20 text-sm text-muted-foreground">Loading…</div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 border-2 border-dashed border-border rounded-lg text-muted-foreground">
            <ImageIcon className="h-8 w-8 mb-2 opacity-40" />
            <p className="text-sm">No images yet. Upload to get started.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {items.map((item, idx) => (
              <div
                key={item.id}
                draggable
                onDragStart={() => handleDragStart(idx)}
                onDragOver={(e) => handleDragOver(e, idx)}
                onDrop={() => handleDrop(idx)}
                onDragEnd={() => { setDragIdx(null); setDragOverIdx(null); }}
                className={`flex gap-3 border rounded-lg p-3 transition-colors ${
                  dragOverIdx === idx ? "border-primary bg-primary/5" : "border-border"
                } ${dragIdx === idx ? "opacity-50" : ""}`}
              >
                {/* Drag handle */}
                <div className="flex items-center cursor-grab active:cursor-grabbing">
                  <GripVertical className="h-4 w-4 text-muted-foreground" />
                </div>

                {/* Thumbnail */}
                <div className="relative h-20 w-20 shrink-0 rounded overflow-hidden bg-muted">
                  <img
                    src={item.original_url}
                    alt={getAltText(item) || "Product image"}
                    className="h-full w-full object-cover"
                  />
                  {item.is_primary && (
                    <Badge className="absolute top-1 left-1 text-[8px] px-1 py-0">Primary</Badge>
                  )}
                </div>

                {/* Alt text + actions */}
                <div className="flex-1 min-w-0 space-y-2">
                  <div className="flex items-center gap-2">
                    <Input
                      value={getAltText(item)}
                      onChange={(e) => setAltTexts((prev) => ({ ...prev, [item.media_asset_id]: e.target.value }))}
                      placeholder="Alt text…"
                      className="text-xs h-7 flex-1"
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2"
                      disabled={savingAlt === item.media_asset_id}
                      onClick={() => handleSaveAlt(item)}
                    >
                      {savingAlt === item.media_asset_id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
                    </Button>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 text-[10px] px-2"
                      disabled={generatingAlt === item.media_asset_id}
                      onClick={() => handleGenerateAlt(item)}
                    >
                      {generatingAlt === item.media_asset_id ? (
                        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                      ) : (
                        <Sparkles className="h-3 w-3 mr-1" />
                      )}
                      AI Alt Text
                    </Button>
                    <Button
                      size="sm"
                      variant={item.is_primary ? "default" : "outline"}
                      className="h-6 text-[10px] px-2"
                      disabled={item.is_primary || settingPrimary === item.id}
                      onClick={() => handleSetPrimary(item)}
                    >
                      {settingPrimary === item.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Star className={`h-3 w-3 mr-0.5 ${item.is_primary ? "fill-current" : ""}`} />
                      )}
                      Primary
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 text-[10px] px-2 text-destructive hover:text-destructive"
                      disabled={deleting === item.id}
                      onClick={() => handleDelete(item)}
                    >
                      {deleting === item.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
