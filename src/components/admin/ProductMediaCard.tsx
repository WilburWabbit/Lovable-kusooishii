import { useState, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Upload, Sparkles, Loader2, ImageIcon } from "lucide-react";
import { invokeWithAuth } from "@/lib/invokeWithAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { SortableMediaItem, type MediaItem } from "./SortableMediaItem";

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
    staleTime: 30_000,
  });

  const [uploading, setUploading] = useState(false);
  const [altTexts, setAltTexts] = useState<Record<string, string>>({});
  const [savingAlt, setSavingAlt] = useState<string | null>(null);
  const [generatingAlt, setGeneratingAlt] = useState<string | null>(null);
  const [generatingAll, setGeneratingAll] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [settingPrimary, setSettingPrimary] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  );

  const invalidateProduct = () => {
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

        const { error: uploadErr } = await supabase.storage
          .from("media")
          .upload(storagePath, file, { contentType: file.type, upsert: false });
        if (uploadErr) throw uploadErr;

        const { data: urlData } = supabase.storage.from("media").getPublicUrl(storagePath);
        const publicUrl = urlData.publicUrl;

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

        const { data: pmRow, error: linkErr } = await (supabase as any)
          .from("product_media")
          .insert({
            product_id: productId,
            media_asset_id: asset.id,
            sort_order: sortOrder,
            is_primary: items.length === 0 && sortOrder === 0,
          })
          .select("id")
          .single();
        if (linkErr) throw linkErr;

        if (items.length === 0 && sortOrder === 0) {
          await invokeWithAuth("admin-data", {
            action: "set-primary-media",
            product_id: productId,
            product_media_id: pmRow.id,
          });
        }

        sortOrder++;
      }

      toast.success(`${files.length} image${files.length > 1 ? "s" : ""} uploaded`);
      queryClient.invalidateQueries({ queryKey });
      invalidateProduct();
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
      queryClient.invalidateQueries({ queryKey });
      invalidateProduct();
    } catch (err: any) {
      toast.error(err.message ?? "Delete failed");
    } finally {
      setDeleting(null);
    }
  };

  /* ── Set Primary ── */
  const handleSetPrimary = async (item: MediaItem) => {
    setSettingPrimary(item.id);

    // Cancel in-flight queries to prevent stale data overwriting optimistic update
    await queryClient.cancelQueries({ queryKey });

    const optimistic = items.map((i) => ({ ...i, is_primary: i.id === item.id }));
    const primaryIdx = optimistic.findIndex((i) => i.id === item.id);
    if (primaryIdx > 0) {
      const [primary] = optimistic.splice(primaryIdx, 1);
      optimistic.unshift(primary);
    }
    const withSortOrder = optimistic.map((i, idx) => ({ ...i, sort_order: idx }));
    queryClient.setQueryData(queryKey, withSortOrder);

    try {
      await invokeWithAuth("admin-data", {
        action: "set-primary-media",
        product_id: productId,
        product_media_id: item.id,
      });
      await invokeWithAuth("admin-data", {
        action: "reorder-product-media",
        items: withSortOrder.map((i) => ({ id: i.id, sort_order: i.sort_order })),
      });
      toast.success("Primary image set");
    } catch (err: any) {
      toast.error(err.message ?? "Failed");
    } finally {
      setSettingPrimary(null);
      invalidateProduct();
      queryClient.invalidateQueries({ queryKey });
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
      // Update cache in-place instead of invalidating
      queryClient.setQueryData<MediaItem[]>(queryKey, (old) =>
        old?.map((i) =>
          i.media_asset_id === item.media_asset_id ? { ...i, alt_text: text.trim() || null } : i
        )
      );
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
      await invokeWithAuth("admin-data", {
        action: "update-media-alt-text",
        media_asset_id: item.media_asset_id,
        alt_text: result.alt_text,
      });
      toast.success("Alt text generated & saved");
      queryClient.setQueryData<MediaItem[]>(queryKey, (old) =>
        old?.map((i) =>
          i.media_asset_id === item.media_asset_id ? { ...i, alt_text: result.alt_text } : i
        )
      );
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
    queryClient.invalidateQueries({ queryKey });
  };

  /* ── Drag & Drop Reorder (@dnd-kit) ── */
  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = items.findIndex((i) => i.id === active.id);
    const newIndex = items.findIndex((i) => i.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    // Cancel in-flight queries to prevent stale data overwriting optimistic update
    await queryClient.cancelQueries({ queryKey });

    const reordered = arrayMove(items, oldIndex, newIndex);
    const updatedItems = reordered.map((item, idx) => ({ ...item, sort_order: idx }));
    queryClient.setQueryData(queryKey, updatedItems);

    try {
      await invokeWithAuth("admin-data", {
        action: "reorder-product-media",
        items: updatedItems.map((item) => ({ id: item.id, sort_order: item.sort_order })),
      });
    } catch (err: any) {
      toast.error(err.message ?? "Reorder failed");
    } finally {
      queryClient.invalidateQueries({ queryKey });
    }
  };

  const handleAltTextChange = useCallback((mediaAssetId: string, value: string) => {
    setAltTexts((prev) => ({ ...prev, [mediaAssetId]: value }));
  }, []);

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
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-3">
                {items.map((item) => (
                  <SortableMediaItem
                    key={item.id}
                    item={item}
                    altText={getAltText(item)}
                    onAltTextChange={handleAltTextChange}
                    onSaveAlt={handleSaveAlt}
                    onGenerateAlt={handleGenerateAlt}
                    onSetPrimary={handleSetPrimary}
                    onDelete={handleDelete}
                    savingAlt={savingAlt}
                    generatingAlt={generatingAlt}
                    settingPrimary={settingPrimary}
                    deleting={deleting}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </CardContent>
    </Card>
  );
}
