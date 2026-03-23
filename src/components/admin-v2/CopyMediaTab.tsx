import { useState, useRef } from "react";
import {
  useUpdateProductCopy,
  useUpdateConditionNotes,
  useUploadProductImage,
} from "@/hooks/admin/use-products";
import type { ProductDetail, ProductVariant } from "@/lib/types/admin";
import { SurfaceCard, SectionHead, Mono, GradeBadge } from "./ui-primitives";
import { toast } from "sonner";

interface CopyMediaTabProps {
  product: ProductDetail;
}

export function CopyMediaTab({ product }: CopyMediaTabProps) {
  return (
    <div className="grid gap-4">
      <PhotosSection product={product} />
      <CopySection product={product} />
      {product.variants.map((v) => (
        <ConditionNotesSection key={v.sku} variant={v} />
      ))}
    </div>
  );
}

// ─── Photos ─────────────────────────────────────────────────

function PhotosSection({ product }: { product: ProductDetail }) {
  const uploadImage = useUploadProductImage();
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  return (
    <SurfaceCard>
      <SectionHead>Photos</SectionHead>

      {/* Existing images */}
      {product.images.length > 0 && (
        <div className="grid grid-cols-4 gap-2 mb-3">
          {product.images.map((img) => (
            <div
              key={img.id}
              className="aspect-square bg-zinc-50 rounded overflow-hidden border border-zinc-200"
            >
              <img
                src={img.storagePath}
                alt={img.altText ?? product.name}
                className="w-full h-full object-cover"
              />
            </div>
          ))}
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

// ─── Copy ───────────────────────────────────────────────────

function CopySection({ product }: { product: ProductDetail }) {
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

function ConditionNotesSection({ variant }: { variant: ProductVariant }) {
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
