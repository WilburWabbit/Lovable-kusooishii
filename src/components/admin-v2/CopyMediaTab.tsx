import { useEffect, useState, useRef } from "react";
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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invokeWithAuth } from "@/lib/invokeWithAuth";
import { Sparkles, Loader2, ExternalLink, Save } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { absoluteUrl } from "@/lib/seo-jsonld";
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
        <ConditionNotesSection key={v.sku} variant={v} product={product} />
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

type SeoIndexationPolicy = "index" | "noindex";

interface ProductSeoDocument {
  id: string;
  document_key: string;
  document_type: "product";
  entity_reference: string;
  published_revision_id: string | null;
  status: string;
}

interface ProductSeoRevision {
  id: string;
  seo_document_id: string;
  revision_number: number;
  status: "draft" | "published" | "archived";
  canonical_path: string;
  title_tag: string;
  meta_description: string;
  indexation_policy: SeoIndexationPolicy;
  robots_directive: string;
  breadcrumbs: unknown;
  structured_data: unknown;
  image_metadata: unknown;
  sitemap: {
    include?: boolean;
    family?: string;
    changefreq?: string;
    priority?: number;
  };
  geo: unknown;
  keywords: string[] | null;
  source: string;
}

interface ProductSeoRecord {
  document: ProductSeoDocument | null;
  revision: ProductSeoRevision | null;
}

interface ProductSeoEditor {
  titleTag: string;
  metaDescription: string;
  canonicalPath: string;
  indexationPolicy: SeoIndexationPolicy;
  robotsDirective: string;
  sitemapInclude: boolean;
  sitemapChangefreq: string;
  sitemapPriority: string;
  keywords: string;
  breadcrumbs: string;
  structuredData: string;
  imageMetadata: string;
  geo: string;
  changeSummary: string;
}

interface GeneratedSeoDraft {
  title_tag: string;
  meta_description: string;
  canonical_path?: string;
  indexation_policy?: SeoIndexationPolicy;
  robots_directive?: string;
  sitemap?: {
    include?: boolean;
    changefreq?: string;
    priority?: number;
  };
  keywords?: string[];
  breadcrumbs?: unknown;
  structured_data?: unknown;
  image_metadata?: unknown;
  geo?: unknown;
  change_summary?: string;
}

interface DbResponse<T = unknown> {
  data: T | null;
  error: { message?: string } | null;
}

interface QueryBuilder extends PromiseLike<DbResponse> {
  select(columns: string): QueryBuilder;
  order(column: string, options?: { ascending?: boolean }): QueryBuilder;
  eq(column: string, value: unknown): QueryBuilder;
  insert(value: Record<string, unknown>): QueryBuilder;
  update(value: Record<string, unknown>): QueryBuilder;
  single(): Promise<DbResponse>;
  maybeSingle(): Promise<DbResponse>;
}

const db = supabase as unknown as {
  from(table: string): QueryBuilder;
  rpc(functionName: string, args: Record<string, unknown>): QueryBuilder;
};

function formatJson(value: unknown, fallback: string) {
  if (value == null) return fallback;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return fallback;
  }
}

function parseJsonField(label: string, value: string) {
  const trimmed = value.trim();
  if (!trimmed) return label === "breadcrumbs" || label === "structured data" ? [] : {};
  try {
    return JSON.parse(trimmed);
  } catch {
    throw new Error(`${label} must be valid JSON`);
  }
}

function seoEditorFromRecord(product: ProductDetail, record: ProductSeoRecord | undefined): ProductSeoEditor {
  const revision = record?.revision;
  return {
    titleTag: revision?.title_tag ?? product.seoTitle ?? `${product.name} (${product.mpn})`,
    metaDescription: revision?.meta_description ?? product.seoDescription ?? "",
    canonicalPath: revision?.canonical_path ?? `/sets/${product.mpn}`,
    indexationPolicy: revision?.indexation_policy ?? "index",
    robotsDirective: revision?.robots_directive ?? "index, follow",
    sitemapInclude: revision?.sitemap?.include ?? true,
    sitemapChangefreq: revision?.sitemap?.changefreq ?? "weekly",
    sitemapPriority: String(revision?.sitemap?.priority ?? 0.8),
    keywords: revision?.keywords?.join(", ") ?? [product.mpn, product.name, product.theme, "LEGO resale", "graded LEGO sets"].filter(Boolean).join(", "),
    breadcrumbs: formatJson(revision?.breadcrumbs, "[]"),
    structuredData: formatJson(revision?.structured_data, "[]"),
    imageMetadata: formatJson(revision?.image_metadata, product.images[0]?.storagePath ? JSON.stringify({ url: product.images[0].storagePath, alt: `${product.name} product image` }, null, 2) : "{}"),
    geo: formatJson(revision?.geo, JSON.stringify({ region: "GB", audience: "LEGO collectors and resale buyers" }, null, 2)),
    changeSummary: "",
  };
}

function seoEditorFromDraft(current: ProductSeoEditor, draft: GeneratedSeoDraft): ProductSeoEditor {
  return {
    ...current,
    titleTag: draft.title_tag ?? current.titleTag,
    metaDescription: draft.meta_description ?? current.metaDescription,
    canonicalPath: draft.canonical_path ?? current.canonicalPath,
    indexationPolicy: draft.indexation_policy ?? current.indexationPolicy,
    robotsDirective: draft.robots_directive ?? current.robotsDirective,
    sitemapInclude: draft.sitemap?.include ?? current.sitemapInclude,
    sitemapChangefreq: draft.sitemap?.changefreq ?? current.sitemapChangefreq,
    sitemapPriority: draft.sitemap?.priority != null ? String(draft.sitemap.priority) : current.sitemapPriority,
    keywords: draft.keywords?.join(", ") ?? current.keywords,
    breadcrumbs: formatJson(draft.breadcrumbs, current.breadcrumbs),
    structuredData: formatJson(draft.structured_data, current.structuredData),
    imageMetadata: formatJson(draft.image_metadata, current.imageMetadata),
    geo: formatJson(draft.geo, current.geo),
    changeSummary: draft.change_summary ?? "AI generated SEO/GEO draft reviewed in product admin.",
  };
}

function priorityFromInput(value: string) {
  const priority = Number.parseFloat(value);
  if (!Number.isFinite(priority) || priority < 0 || priority > 1) {
    throw new Error("Sitemap priority must be a number between 0 and 1");
  }
  return Number(priority.toFixed(1));
}

async function fetchProductSeoRecord(mpn: string): Promise<ProductSeoRecord> {
  const { data: document, error: documentError } = await db
    .from("seo_document")
    .select("id, document_key, document_type, entity_reference, published_revision_id, status")
    .eq("document_key", `product:${mpn}`)
    .maybeSingle();

  if (documentError) throw documentError;
  const seoDocument = document as ProductSeoDocument | null;

  if (!seoDocument?.id) {
    return { document: seoDocument, revision: null };
  }

  const { data: revisions, error: revisionError } = await db
    .from("seo_revision")
    .select("id, seo_document_id, revision_number, status, canonical_path, title_tag, meta_description, indexation_policy, robots_directive, breadcrumbs, structured_data, image_metadata, sitemap, geo, keywords, source")
    .eq("seo_document_id", seoDocument.id)
    .order("revision_number", { ascending: false });

  if (revisionError) throw revisionError;
  const revisionRows = (revisions ?? []) as ProductSeoRevision[];
  const draft = revisionRows.find((revision) => revision.status === "draft") ?? null;
  const published = revisionRows.find((revision) => revision.id === seoDocument.published_revision_id) ?? null;
  return {
    document: seoDocument,
    revision: draft ?? published,
  };
}

async function ensureProductSeoDocument(product: ProductDetail, existing: ProductSeoDocument | null): Promise<ProductSeoDocument> {
  if (existing) return existing;

  const { data, error } = await db
    .from("seo_document")
    .insert({
      document_key: `product:${product.mpn}`,
      document_type: "product",
      entity_type: "product",
      entity_id: product.id,
      entity_reference: product.mpn,
      status: "draft",
      metadata: { created_from: "product_copy_seo_tab" },
    })
    .select("id, document_key, document_type, entity_reference, published_revision_id, status")
    .single();

  if (error) throw error;
  const document = data as ProductSeoDocument | null;
  if (!document?.id) throw new Error("SEO document was not created");
  return document;
}

async function publishProductSeoRevision(product: ProductDetail, record: ProductSeoRecord | undefined, editor: ProductSeoEditor) {
  const document = await ensureProductSeoDocument(product, record?.document ?? null);
  const canonicalPath = editor.canonicalPath.trim();
  if (!canonicalPath.startsWith("/")) throw new Error("Canonical path must start with /");
  if (!editor.titleTag.trim()) throw new Error("SEO title is required");
  if (!editor.metaDescription.trim()) throw new Error("SEO description is required");

  const { data: revision, error: revisionError } = await db
    .rpc("publish_seo_revision", {
      ...productSeoRevisionRpcArgs(document.id, product, editor),
      p_change_summary: editor.changeSummary.trim() || "Published from product Copy & SEO tab.",
    })
    .single();

  if (revisionError) throw revisionError;
  const revisionRow = revision as { id: string } | null;
  if (!revisionRow?.id) throw new Error("Published SEO revision was not returned");

  // Keep legacy product columns aligned for screens/imports that still read them.
  await supabase
    .from("product")
    .update({
      seo_title: editor.titleTag.trim(),
      seo_description: editor.metaDescription.trim(),
    } as never)
    .eq("mpn", product.mpn);
}

async function saveProductSeoRevisionDraft(product: ProductDetail, record: ProductSeoRecord | undefined, editor: ProductSeoEditor) {
  const document = await ensureProductSeoDocument(product, record?.document ?? null);
  const canonicalPath = editor.canonicalPath.trim();
  if (!canonicalPath.startsWith("/")) throw new Error("Canonical path must start with /");

  const { data: revision, error: revisionError } = await db
    .rpc("save_seo_revision_draft", {
      ...productSeoRevisionRpcArgs(document.id, product, editor),
      p_change_summary: editor.changeSummary.trim() || "Saved from product Copy & SEO tab.",
    })
    .single();

  if (revisionError) throw revisionError;
  const revisionRow = revision as { id: string } | null;
  if (!revisionRow?.id) throw new Error("Saved SEO draft was not returned");
}

function productSeoRevisionRpcArgs(documentId: string, product: ProductDetail, editor: ProductSeoEditor) {
  const canonicalPath = editor.canonicalPath.trim();

  const sitemap = {
    include: editor.indexationPolicy === "noindex" ? false : editor.sitemapInclude,
    family: "product",
    changefreq: editor.sitemapChangefreq,
    priority: priorityFromInput(editor.sitemapPriority),
  };
  const keywords = editor.keywords.split(",").map((keyword) => keyword.trim()).filter(Boolean);
  const canonicalUrl = absoluteUrl(canonicalPath);

  return {
    p_seo_document_id: documentId,
    p_canonical_path: canonicalPath,
    p_canonical_url: canonicalUrl,
    p_title_tag: editor.titleTag.trim(),
    p_meta_description: editor.metaDescription.trim(),
    p_indexation_policy: editor.indexationPolicy,
    p_robots_directive: editor.robotsDirective.trim() || (editor.indexationPolicy === "noindex" ? "noindex, nofollow" : "index, follow"),
    p_open_graph: {
      title: editor.titleTag.trim(),
      description: editor.metaDescription.trim(),
      url: canonicalUrl,
      type: "product",
      image: product.images[0]?.storagePath ?? product.catalogImageUrl ?? undefined,
    },
    p_twitter_card: {
      card: product.images[0]?.storagePath || product.catalogImageUrl ? "summary_large_image" : "summary",
      title: editor.titleTag.trim(),
      description: editor.metaDescription.trim(),
    },
    p_breadcrumbs: parseJsonField("breadcrumbs", editor.breadcrumbs),
    p_structured_data: parseJsonField("structured data", editor.structuredData),
    p_image_metadata: parseJsonField("image metadata", editor.imageMetadata),
    p_sitemap: sitemap,
    p_geo: parseJsonField("GEO metadata", editor.geo),
    p_keywords: keywords,
    p_source: "product_admin",
  };
}

export function CopySection({ product }: { product: ProductDetail }) {
  const updateCopy = useUpdateProductCopy();
  const queryClient = useQueryClient();
  const [hook, setHook] = useState(product.hook ?? "");
  const [description, setDescription] = useState(product.description ?? "");
  const [highlights, setHighlights] = useState(product.highlights ?? "");
  const [cta, setCta] = useState(product.cta ?? "");
  const [seoEditor, setSeoEditor] = useState<ProductSeoEditor>(() => seoEditorFromRecord(product, undefined));
  const [generating, setGenerating] = useState(false);

  const seoQuery = useQuery({
    queryKey: ["admin", "product-seo-document", product.mpn],
    queryFn: () => fetchProductSeoRecord(product.mpn),
  });

  const [lastSeoRevisionId, setLastSeoRevisionId] = useState<string | null>(null);
  const currentSeoRevisionId = seoQuery.data?.revision?.id ?? null;
  useEffect(() => {
    if (seoQuery.isLoading || currentSeoRevisionId === lastSeoRevisionId) return;
    setLastSeoRevisionId(currentSeoRevisionId);
    setSeoEditor(seoEditorFromRecord(product, seoQuery.data));
  }, [currentSeoRevisionId, lastSeoRevisionId, product, seoQuery.data, seoQuery.isLoading]);

  const publishSeo = useMutation({
    mutationFn: () => publishProductSeoRevision(product, seoQuery.data, seoEditor),
    onSuccess: async () => {
      toast.success("Canonical SEO/GEO revision published");
      await queryClient.invalidateQueries({ queryKey: ["admin", "product-seo-document", product.mpn] });
      await queryClient.invalidateQueries({ queryKey: ["admin", "seo-documents"] });
      await queryClient.invalidateQueries({ queryKey: ["seo_document"] });
      await queryClient.invalidateQueries({ queryKey: productKeys.detail(product.mpn) });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "SEO publish failed"),
  });

  const saveSeoDraft = useMutation({
    mutationFn: () => saveProductSeoRevisionDraft(product, seoQuery.data, seoEditor),
    onSuccess: async () => {
      toast.success("SEO/GEO draft saved");
      await queryClient.invalidateQueries({ queryKey: ["admin", "product-seo-document", product.mpn] });
      await queryClient.invalidateQueries({ queryKey: ["admin", "seo-documents"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "SEO draft save failed"),
  });

  const handleSave = async () => {
    try {
      await updateCopy.mutateAsync({
        mpn: product.mpn,
        hook,
        description,
        highlights,
        cta,
      });
      toast.success("Product copy saved");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Save failed";
      toast.error(message);
    }
  };

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      // Non-catalog images only (uploaded photos of the actual item)
      const imageUrls = product.images.map((i) => i.storagePath).filter(Boolean);
      const dims = product.dimensionsCm?.split(/[x×]/i).map((s) => parseFloat(s.trim())) ?? [];
      const payload = {
        product_id: product.id,
        auto_save: false,
        image_urls: imageUrls,
        product: {
          name: product.name,
          mpn: product.mpn,
          set_number: product.setNumber,
          theme_name: product.theme,
          subtheme_name: product.subtheme,
          piece_count: product.pieceCount,
          release_year: product.releaseDate ? new Date(product.releaseDate).getFullYear() : null,
          retired_flag: !!product.retiredDate,
          age_range: product.ageMark,
          weight_kg: product.weightG ? product.weightG / 1000 : null,
          length_cm: dims[0] ?? null,
          width_cm: dims[1] ?? null,
          height_cm: dims[2] ?? null,
        },
      };
      const res = await invokeWithAuth<{ copy: {
        hook: string; description: string; cta: string;
        highlights: string[] | string; seo_title: string; seo_body: string;
      } }>("generate-product-copy", payload);
      const c = res.copy;
      const highlightText = Array.isArray(c.highlights)
        ? c.highlights.map((h) => `• ${h}`).join("\n")
        : (c.highlights ?? "");
      setHook(c.hook ?? "");
      setDescription(c.description ?? "");
      setHighlights(highlightText);
      setCta(c.cta ?? "");
      setSeoEditor((current) => ({
        ...current,
        titleTag: c.seo_title ?? current.titleTag,
        metaDescription: c.seo_body ?? current.metaDescription,
        changeSummary: "Generated from product copy assistant and reviewed in product admin.",
      }));
      toast.success("Copy generated — review copy and publish SEO/GEO if used");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Generation failed";
      toast.error(message);
    } finally {
      setGenerating(false);
    }
  };

  const handleGenerateSeoGeo = async () => {
    setGenerating(true);
    try {
      const record = seoQuery.data;
      await ensureProductSeoDocument(product, record?.document ?? null);
      await queryClient.invalidateQueries({ queryKey: ["admin", "product-seo-document", product.mpn] });
      const refreshed = await fetchProductSeoRecord(product.mpn);
      if (!refreshed.document?.id) throw new Error("SEO document is not available");
      const res = await invokeWithAuth<{ draft: GeneratedSeoDraft; provider_used: string; fell_back: boolean }>("generate-seo-geo", {
        seo_document_id: refreshed.document.id,
        current: {
          title_tag: seoEditor.titleTag,
          meta_description: seoEditor.metaDescription,
          canonical_path: seoEditor.canonicalPath,
          indexation_policy: seoEditor.indexationPolicy,
          robots_directive: seoEditor.robotsDirective,
          sitemap: {
            include: seoEditor.sitemapInclude,
            family: "product",
            changefreq: seoEditor.sitemapChangefreq,
            priority: Number(seoEditor.sitemapPriority),
          },
          keywords: seoEditor.keywords,
          breadcrumbs: seoEditor.breadcrumbs,
          structured_data: seoEditor.structuredData,
          image_metadata: seoEditor.imageMetadata,
          geo: seoEditor.geo,
        },
      });
      setSeoEditor((current) => seoEditorFromDraft(current, res.draft));
      toast.success(res.fell_back ? "SEO/GEO draft generated with OpenAI fallback" : "SEO/GEO draft generated");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "SEO/GEO generation failed";
      toast.error(message);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <SurfaceCard>
      <div className="flex items-center justify-between mb-3">
        <SectionHead>Product Copy (MPN level)</SectionHead>
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="flex items-center gap-1.5 bg-zinc-900 text-white border-none rounded-md px-3 py-1.5 font-semibold text-[12px] cursor-pointer disabled:opacity-50 hover:bg-zinc-800 transition-colors"
          title="Regenerate copy & SEO from product attributes and uploaded photos"
        >
          {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
          {generating ? "Generating…" : "Generate Copy & SEO"}
        </button>
      </div>
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
        <div className="mt-1 flex items-center justify-between">
          <div>
            <SectionHead>Canonical SEO/GEO</SectionHead>
            <p className="mt-1 text-[11px] text-zinc-500">
              Same saved and published metadata used by Settings → SEO/GEO.
            </p>
            {seoQuery.data?.revision?.status === "draft" ? (
              <p className="mt-1 text-[11px] font-semibold text-amber-700">
                Draft revision {seoQuery.data.revision.revision_number} loaded
              </p>
            ) : null}
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleGenerateSeoGeo}
              disabled={generating || seoQuery.isLoading}
              className="flex items-center gap-1.5 bg-zinc-900 text-white border-none rounded-md px-3 py-1.5 font-semibold text-[12px] cursor-pointer disabled:opacity-50 hover:bg-zinc-800 transition-colors"
              title="Generate canonical SEO, GEO, sitemap, and JSON-LD draft"
            >
              {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              {generating ? "Generating..." : "Generate SEO/GEO"}
            </button>
            {seoEditor.canonicalPath ? (
              <a
                href={seoEditor.canonicalPath}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 bg-white text-zinc-700 border border-zinc-200 rounded-md px-3 py-1.5 font-semibold text-[12px] hover:bg-zinc-50 transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                View
              </a>
            ) : null}
          </div>
        </div>
        {seoQuery.error ? (
          <div className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700">
            {seoQuery.error instanceof Error ? seoQuery.error.message : "Unable to load canonical SEO document."}
          </div>
        ) : null}
        <div className="rounded-md border border-zinc-200 bg-white p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Search Preview</div>
          <div className="mt-2 font-mono text-[11px] text-green-700">www.kusooishii.com{seoEditor.canonicalPath}</div>
          <div className="mt-1 text-[16px] font-semibold leading-snug text-blue-700">{seoEditor.titleTag || product.name}</div>
          <p className="mt-1 text-[12px] leading-5 text-zinc-600">{seoEditor.metaDescription || "No SEO description published yet."}</p>
        </div>
        <div>
          <label className="text-[10px] text-zinc-500 font-semibold uppercase tracking-wider block mb-1">
            SEO Title <span className="text-zinc-600 font-normal">({seoEditor.titleTag.length}/60)</span>
          </label>
          <input
            value={seoEditor.titleTag}
            onChange={(e) => setSeoEditor({ ...seoEditor, titleTag: e.target.value })}
            maxLength={80}
            className="w-full bg-zinc-50 border border-zinc-200 rounded text-zinc-900 text-[13px] p-2.5 font-sans box-border"
          />
        </div>
        <div>
          <label className="text-[10px] text-zinc-500 font-semibold uppercase tracking-wider block mb-1">
            SEO Description <span className="text-zinc-600 font-normal">({seoEditor.metaDescription.length}/160)</span>
          </label>
          <textarea
            rows={2}
            value={seoEditor.metaDescription}
            onChange={(e) => setSeoEditor({ ...seoEditor, metaDescription: e.target.value })}
            maxLength={220}
            className="w-full bg-zinc-50 border border-zinc-200 rounded text-zinc-900 text-[13px] p-2.5 resize-y font-sans box-border"
          />
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="text-[10px] text-zinc-500 font-semibold uppercase tracking-wider block mb-1">Canonical Path</label>
            <input
              value={seoEditor.canonicalPath}
              onChange={(e) => setSeoEditor({ ...seoEditor, canonicalPath: e.target.value })}
              className="w-full bg-zinc-50 border border-zinc-200 rounded text-zinc-900 text-[13px] p-2.5 font-sans box-border"
            />
          </div>
          <div>
            <label className="text-[10px] text-zinc-500 font-semibold uppercase tracking-wider block mb-1">Keywords</label>
            <input
              value={seoEditor.keywords}
              onChange={(e) => setSeoEditor({ ...seoEditor, keywords: e.target.value })}
              className="w-full bg-zinc-50 border border-zinc-200 rounded text-zinc-900 text-[13px] p-2.5 font-sans box-border"
            />
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_1fr]">
          <div>
            <label className="text-[10px] text-zinc-500 font-semibold uppercase tracking-wider block mb-1">Indexation</label>
            <select
              value={seoEditor.indexationPolicy}
              onChange={(e) => {
                const next = e.target.value as SeoIndexationPolicy;
                setSeoEditor({
                  ...seoEditor,
                  indexationPolicy: next,
                  robotsDirective: next === "noindex" ? "noindex, nofollow" : "index, follow",
                  sitemapInclude: next === "index" ? seoEditor.sitemapInclude : false,
                });
              }}
              className="w-full bg-zinc-50 border border-zinc-200 rounded text-zinc-900 text-[13px] p-2.5 font-sans box-border"
            >
              <option value="index">Index</option>
              <option value="noindex">Noindex</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] text-zinc-500 font-semibold uppercase tracking-wider block mb-1">Sitemap</label>
            <button
              type="button"
              onClick={() => setSeoEditor({ ...seoEditor, sitemapInclude: !seoEditor.sitemapInclude })}
              disabled={seoEditor.indexationPolicy === "noindex"}
              className="w-full bg-zinc-50 border border-zinc-200 rounded text-zinc-900 text-[13px] p-2.5 font-sans box-border text-left disabled:opacity-50"
            >
              {seoEditor.sitemapInclude ? "Included" : "Excluded"}
            </button>
          </div>
          <div>
            <label className="text-[10px] text-zinc-500 font-semibold uppercase tracking-wider block mb-1">Priority</label>
            <input
              value={seoEditor.sitemapPriority}
              onChange={(e) => setSeoEditor({ ...seoEditor, sitemapPriority: e.target.value })}
              className="w-full bg-zinc-50 border border-zinc-200 rounded text-zinc-900 text-[13px] p-2.5 font-sans box-border"
            />
          </div>
        </div>
        <details className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
          <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wider text-zinc-600">
            Advanced JSON-LD / GEO payloads
          </summary>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <JsonTextarea label="Breadcrumbs JSON" value={seoEditor.breadcrumbs} onChange={(value) => setSeoEditor({ ...seoEditor, breadcrumbs: value })} />
            <JsonTextarea label="Structured Data JSON-LD" value={seoEditor.structuredData} onChange={(value) => setSeoEditor({ ...seoEditor, structuredData: value })} />
            <JsonTextarea label="Image Metadata JSON" value={seoEditor.imageMetadata} onChange={(value) => setSeoEditor({ ...seoEditor, imageMetadata: value })} />
            <JsonTextarea label="GEO Metadata JSON" value={seoEditor.geo} onChange={(value) => setSeoEditor({ ...seoEditor, geo: value })} />
          </div>
        </details>
        <div>
          <label className="text-[10px] text-zinc-500 font-semibold uppercase tracking-wider block mb-1">SEO Change Summary</label>
          <input
            value={seoEditor.changeSummary}
            onChange={(e) => setSeoEditor({ ...seoEditor, changeSummary: e.target.value })}
            placeholder="What changed and why?"
            className="w-full bg-zinc-50 border border-zinc-200 rounded text-zinc-900 text-[13px] p-2.5 font-sans box-border"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => saveSeoDraft.mutate()}
            disabled={saveSeoDraft.isPending || publishSeo.isPending || seoQuery.isLoading}
            className="inline-flex items-center gap-1.5 bg-white text-zinc-800 border border-zinc-200 rounded-md px-4 py-2 font-bold text-[13px] cursor-pointer disabled:opacity-50 hover:bg-zinc-50 transition-colors w-fit"
          >
            <Save className="w-3.5 h-3.5" />
            {saveSeoDraft.isPending ? "Saving..." : "Save SEO/GEO Draft"}
          </button>
          <button
            onClick={() => publishSeo.mutate()}
            disabled={publishSeo.isPending || saveSeoDraft.isPending || seoQuery.isLoading}
            className="bg-zinc-900 text-white border-none rounded-md px-4 py-2 font-bold text-[13px] cursor-pointer disabled:opacity-50 hover:bg-zinc-800 transition-colors w-fit"
          >
            {publishSeo.isPending ? "Publishing..." : "Publish SEO/GEO Revision"}
          </button>
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

function JsonTextarea({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div>
      <label className="text-[10px] text-zinc-500 font-semibold uppercase tracking-wider block mb-1">{label}</label>
      <textarea
        rows={8}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        spellCheck={false}
        className="w-full bg-white border border-zinc-200 rounded text-zinc-900 text-[12px] p-2.5 resize-y font-mono box-border"
      />
    </div>
  );
}

// ─── Condition Notes ────────────────────────────────────────

export function ConditionNotesSection({
  variant,
  product,
}: {
  variant: ProductVariant;
  product: ProductDetail;
}) {
  const updateNotes = useUpdateConditionNotes();
  const [notes, setNotes] = useState(variant.conditionNotes ?? "");
  const [generating, setGenerating] = useState(false);
  const { data: stockUnits } = useStockUnitsByVariant(variant.sku);

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

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const units = stockUnits ?? [];
      const flagSet = new Set<string>();
      const unitNotes: string[] = [];
      for (const u of units) {
        for (const f of u.conditionFlags ?? []) flagSet.add(f);
        if (u.notes) unitNotes.push(u.notes);
      }
      const imageUrls = product.images.map((i) => i.storagePath).filter(Boolean);
      const res = await invokeWithAuth<{ conditionNotes: string }>("generate-condition-notes", {
        mpn: product.mpn,
        productName: product.name,
        grade: variant.grade,
        conditionFlags: Array.from(flagSet),
        unitNotes,
        imageUrls,
      });
      setNotes(res.conditionNotes ?? "");
      toast.success("Condition notes generated — review and save");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Generation failed";
      toast.error(message);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <SurfaceCard>
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-2">
          <SectionHead>Condition Notes</SectionHead>
          <Mono color="amber" className="text-[11px]">{variant.sku}</Mono>
          <GradeBadge grade={variant.grade} />
        </div>
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="flex items-center gap-1.5 bg-zinc-900 text-white border-none rounded-md px-3 py-1.5 font-semibold text-[12px] cursor-pointer disabled:opacity-50 hover:bg-zinc-800 transition-colors"
          title="Regenerate from grade, stock unit notes & flags, and uploaded photos"
        >
          {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
          {generating ? "Generating…" : "Generate"}
        </button>
      </div>
      <textarea
        rows={3}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="AI-drafted from grade + flags + stock unit notes + photos"
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
