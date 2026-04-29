import { useState, useRef } from "react";
import {
  useUpdateProductCopy,
  useUpdateConditionNotes,
  useUploadProductImage,
  productKeys,
} from "@/hooks/admin/use-products";
import { useStockUnitsByVariant } from "@/hooks/admin/use-stock-units";
import type { ProductDetail, ProductVariant, ProductImage } from "@/lib/types/admin";
import { SurfaceCard, SectionHead, Mono, GradeBadge } from "./ui-primitives";
import { MinifigsCard } from "./MinifigsCard";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { invokeWithAuth } from "@/lib/invokeWithAuth";
import { Sparkles, Loader2 } from "lucide-react";
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
  rectSortingStrategy,
  arrayMove,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Star, Trash2 } from "lucide-react";

interface CopyMediaTabProps {
  product: ProductDetail;
}

export function CopyMediaTab({ product }: CopyMediaTabProps) {
  return (
    <div className="grid gap-4">
      <PhotosSection product={product} />
      <MinifigsCard product={product} />
      <CopySection product={product} />
      {product.variants.map((v) => (
        <ConditionNotesSection key={v.sku} variant={v} />
      ))}
    </div>
  );
}

// ─── Photos ─────────────────────────────────────────────────

export function PhotosSection({ product }: { product: ProductDetail }) {
  const uploadImage = useUploadProductImage();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [images, setImages] = useState(product.images);
  const [busy, setBusy] = useState<string | null>(null);

  // Sync local state when product images change from server
  const [lastImageIds, setLastImageIds] = useState(() => product.images.map((i) => i.id).join(","));
  const currentImageIds = product.images.map((i) => i.id).join(",");
  if (currentImageIds !== lastImageIds) {
    setLastImageIds(currentImageIds);
    setImages(product.images);
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  );

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: productKeys.detail(product.mpn) });
  };

  const handleFiles = async (files: FileList) => {
    for (const file of Array.from(files)) {
      try {
        await uploadImage.mutateAsync({ mpn: product.mpn, file });
        toast.success(`Uploaded ${file.name}`);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Upload failed";
        toast.error(message);
      }
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = images.findIndex((i) => i.id === active.id);
    const newIndex = images.findIndex((i) => i.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(images, oldIndex, newIndex);
    setImages(reordered);

    try {
      await invokeWithAuth("admin-data", {
        action: "reorder-product-media",
        items: reordered.map((img, idx) => ({ id: img.id, sort_order: idx })),
      });
      invalidate();
    } catch (err: unknown) {
      setImages(product.images);
      toast.error(err instanceof Error ? err.message : "Reorder failed");
    }
  };

  const handleSetPrimary = async (img: ProductImage) => {
    if (img.isPrimary || busy) return;
    setBusy(img.id);

    // Optimistic update
    setImages((prev) => prev.map((i) => ({ ...i, isPrimary: i.id === img.id })));

    try {
      await invokeWithAuth("admin-data", {
        action: "set-primary-media",
        product_id: product.id,
        product_media_id: img.id,
      });
      invalidate();
      toast.success("Primary image updated");
    } catch (err: unknown) {
      setImages(product.images);
      toast.error(err instanceof Error ? err.message : "Failed to set primary");
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = async (img: ProductImage) => {
    if (busy) return;
    setBusy(img.id);

    // Optimistic update
    setImages((prev) => prev.filter((i) => i.id !== img.id));

    try {
      await invokeWithAuth("admin-data", {
        action: "delete-product-media",
        product_media_id: img.id,
        media_asset_id: img.mediaAssetId,
      });
      invalidate();
      toast.success("Image deleted");
    } catch (err: unknown) {
      setImages(product.images);
      toast.error(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <SurfaceCard>
      <SectionHead>Photos</SectionHead>

      {/* Sortable image grid */}
      {images.length > 0 && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={images.map((i) => i.id)} strategy={rectSortingStrategy}>
            <div className="grid grid-cols-4 gap-2 mb-3">
              {images.map((img) => (
                <SortableImageThumb
                  key={img.id}
                  image={img}
                  productName={product.name}
                  onSetPrimary={handleSetPrimary}
                  onDelete={handleDelete}
                  isBusy={busy === img.id}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {/* Catalog image (non-sortable reference) */}
      {product.catalogImageUrl && product.includeCatalogImg && (
        <div className="mb-3">
          <div className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold mb-1.5">Catalog Image</div>
          <div className="inline-block relative aspect-square w-[calc(25%-6px)] bg-zinc-50 rounded-lg overflow-hidden border-2 border-dashed border-zinc-300">
            <img
              src={product.catalogImageUrl}
              alt={`${product.name} catalog`}
              className="w-full h-full object-contain"
              draggable={false}
            />
            <span className="absolute top-1.5 right-1.5 bg-zinc-500 text-white text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded">
              Catalog
            </span>
          </div>
        </div>
      )}

      {/* Upload zone */}
      <div
        className="border-2 border-dashed border-zinc-200 rounded-lg p-10 text-center text-zinc-500 text-[13px] cursor-pointer hover:border-amber-500/40 transition-colors"
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (e.dataTransfer.files.length > 0) {
            handleFiles(e.dataTransfer.files);
          }
        }}
      >
        {uploadImage.isPending ? "Uploading…" : "Drop images here or click to upload"}
        <div className="text-[11px] mt-1">Alt text generated automatically</div>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            handleFiles(e.target.files);
          }
        }}
      />
    </SurfaceCard>
  );
}

// ─── Sortable Image Thumbnail ──────────────────────────────

interface SortableImageThumbProps {
  image: ProductImage;
  productName: string;
  onSetPrimary: (img: ProductImage) => void;
  onDelete: (img: ProductImage) => void;
  isBusy: boolean;
}

function SortableImageThumb({ image, productName, onSetPrimary, onDelete, isBusy }: SortableImageThumbProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: image.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group relative aspect-square bg-zinc-50 rounded-lg overflow-hidden border border-zinc-200"
    >
      <img
        src={image.storagePath}
        alt={image.altText ?? productName}
        className="w-full h-full object-cover"
        draggable={false}
      />

      {/* Primary badge */}
      {image.isPrimary && (
        <span className="absolute top-1.5 right-1.5 bg-amber-500 text-zinc-900 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded">
          Primary
        </span>
      )}

      {/* Drag handle */}
      <div
        className="absolute top-1.5 left-1.5 p-1 rounded bg-black/40 text-white opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="w-3.5 h-3.5" />
      </div>

      {/* Hover action overlay */}
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1.5 py-1.5 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
        {!image.isPrimary && (
          <button
            onClick={() => onSetPrimary(image)}
            disabled={isBusy}
            className="p-1.5 rounded bg-white/20 hover:bg-amber-500 text-white transition-colors disabled:opacity-50"
            title="Set as primary"
          >
            <Star className="w-3.5 h-3.5" />
          </button>
        )}
        <button
          onClick={() => onDelete(image)}
          disabled={isBusy}
          className="p-1.5 rounded bg-white/20 hover:bg-red-500 text-white transition-colors disabled:opacity-50"
          title="Delete image"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

// ─── Copy ───────────────────────────────────────────────────

export function CopySection({ product }: { product: ProductDetail }) {
  const updateCopy = useUpdateProductCopy();
  const [hook, setHook] = useState(product.hook ?? "");
  const [description, setDescription] = useState(product.description ?? "");
  const [highlights, setHighlights] = useState(product.highlights ?? "");
  const [cta, setCta] = useState(product.cta ?? "");
  const [seoTitle, setSeoTitle] = useState(product.seoTitle ?? "");
  const [seoDescription, setSeoDescription] = useState(product.seoDescription ?? "");

  const handleSave = async () => {
    try {
      await updateCopy.mutateAsync({
        mpn: product.mpn,
        hook,
        description,
        highlights,
        cta,
        seoTitle,
        seoDescription,
      });
      toast.success("Product copy saved");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Save failed";
      toast.error(message);
    }
  };

  return (
    <SurfaceCard>
      <SectionHead>Product Copy (MPN level)</SectionHead>
      <div className="grid gap-3">
        {[
          { label: "Hook", rows: 2, value: hook, onChange: setHook },
          { label: "Description", rows: 4, value: description, onChange: setDescription },
          { label: "Highlights", rows: 3, value: highlights, onChange: setHighlights },
          { label: "CTA", rows: 1, value: cta, onChange: setCta },
        ].map((f) => (
          <div key={f.label}>
            <label className="text-[10px] text-zinc-500 font-semibold uppercase tracking-wider block mb-1">
              {f.label}
            </label>
            <textarea
              rows={f.rows}
              value={f.value}
              onChange={(e) => f.onChange(e.target.value)}
              className="w-full bg-zinc-50 border border-zinc-200 rounded text-zinc-900 text-[13px] p-2.5 resize-y font-sans box-border"
            />
          </div>
        ))}
        <SectionHead>SEO</SectionHead>
        <div>
          <label className="text-[10px] text-zinc-500 font-semibold uppercase tracking-wider block mb-1">
            SEO Title <span className="text-zinc-600 font-normal">({seoTitle.length}/60)</span>
          </label>
          <input
            value={seoTitle}
            onChange={(e) => setSeoTitle(e.target.value)}
            maxLength={60}
            className="w-full bg-zinc-50 border border-zinc-200 rounded text-zinc-900 text-[13px] p-2.5 font-sans box-border"
          />
        </div>
        <div>
          <label className="text-[10px] text-zinc-500 font-semibold uppercase tracking-wider block mb-1">
            SEO Description <span className="text-zinc-600 font-normal">({seoDescription.length}/160)</span>
          </label>
          <textarea
            rows={2}
            value={seoDescription}
            onChange={(e) => setSeoDescription(e.target.value)}
            maxLength={160}
            className="w-full bg-zinc-50 border border-zinc-200 rounded text-zinc-900 text-[13px] p-2.5 resize-y font-sans box-border"
          />
        </div>
        <button
          onClick={handleSave}
          disabled={updateCopy.isPending}
          className="bg-amber-500 text-zinc-900 border-none rounded-md px-4 py-2 font-bold text-[13px] cursor-pointer disabled:opacity-50 hover:bg-amber-400 transition-colors w-fit"
        >
          {updateCopy.isPending ? "Saving…" : "Save Copy"}
        </button>
      </div>
    </SurfaceCard>
  );
}

// ─── Condition Notes ────────────────────────────────────────

export function ConditionNotesSection({ variant }: { variant: ProductVariant }) {
  const updateNotes = useUpdateConditionNotes();
  const [notes, setNotes] = useState(variant.conditionNotes ?? "");

  const handleSave = async () => {
    try {
      await updateNotes.mutateAsync({
        skuCode: variant.sku,
        conditionNotes: notes,
      });
      toast.success(`Condition notes saved for ${variant.sku}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Save failed";
      toast.error(message);
    }
  };

  return (
    <SurfaceCard>
      <div className="flex items-center gap-2 mb-2.5">
        <SectionHead>Condition Notes</SectionHead>
        <Mono color="amber" className="text-[11px]">{variant.sku}</Mono>
        <GradeBadge grade={variant.grade} />
      </div>
      <textarea
        rows={3}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="AI-drafted from grade + flags + photos"
        className="w-full bg-zinc-50 border border-zinc-200 rounded text-zinc-900 text-[13px] p-2.5 resize-y font-sans box-border mb-2"
      />
      <button
        onClick={handleSave}
        disabled={updateNotes.isPending}
        className="bg-amber-500 text-zinc-900 border-none rounded-md px-3 py-1.5 font-bold text-[12px] cursor-pointer disabled:opacity-50 hover:bg-amber-400 transition-colors"
      >
        {updateNotes.isPending ? "Saving…" : "Save Notes"}
      </button>
    </SurfaceCard>
  );
}
