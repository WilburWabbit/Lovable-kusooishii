import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, CheckSquare, ExternalLink, FileSearch, Loader2, Save, Search, Sparkles, XCircle } from "lucide-react";
import { toast } from "sonner";
import { AdminV2Layout } from "@/components/admin-v2/AdminV2Layout";
import { Badge, SectionHead, SurfaceCard } from "@/components/admin-v2/ui-primitives";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { invokeWithAuth } from "@/lib/invokeWithAuth";
import { absoluteUrl } from "@/lib/seo-jsonld";

type SeoDocumentType = "route" | "product" | "theme" | "collection" | "system";
type SeoIndexationPolicy = "index" | "noindex";
type SeoStatusFilter = "all" | "draft" | "missing" | "indexable" | "noindex" | "sitemap" | "hidden";
type BulkStatusFilter = Exclude<SeoStatusFilter, "all">;
type BulkDraftStage = "generating" | "ready" | "saving" | "saved" | "publishing" | "published" | "error";

interface SeoDocumentRow {
  id: string;
  document_key: string;
  document_type: SeoDocumentType;
  route_path: string | null;
  entity_type: string | null;
  entity_id: string | null;
  entity_reference: string | null;
  status: string;
  published_revision_id: string | null;
  metadata: Record<string, unknown>;
  updated_at: string;
}

interface SeoRevisionRow {
  id: string;
  seo_document_id: string;
  revision_number: number;
  status: "draft" | "published" | "archived";
  canonical_path: string;
  canonical_url: string;
  title_tag: string;
  meta_description: string;
  indexation_policy: SeoIndexationPolicy;
  robots_directive: string;
  open_graph: Record<string, unknown>;
  twitter_card: Record<string, unknown>;
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
  change_summary: string | null;
  published_at: string | null;
  created_at: string;
}

interface SeoProductContext {
  id: string;
  mpn: string;
  name: string | null;
  product_type: string | null;
  lego_theme: string | null;
  lego_subtheme: string | null;
  theme_id: string | null;
  subtheme_name: string | null;
  piece_count: number | null;
  release_year: number | null;
  retired_flag: boolean | null;
  img_url: string | null;
  seo_title: string | null;
  seo_description: string | null;
  description: string | null;
  status: string | null;
}

interface SeoDocumentWithRevision extends SeoDocumentRow {
  revision: SeoRevisionRow | null;
  draft_revision: SeoRevisionRow | null;
  published_revision: SeoRevisionRow | null;
  product: SeoProductContext | null;
}

interface SeoEditorState {
  title_tag: string;
  meta_description: string;
  canonical_path: string;
  indexation_policy: SeoIndexationPolicy;
  robots_directive: string;
  sitemap_include: boolean;
  sitemap_family: string;
  sitemap_changefreq: string;
  sitemap_priority: string;
  keywords: string;
  breadcrumbs: string;
  structured_data: string;
  image_metadata: string;
  geo: string;
  change_summary: string;
}

interface GeneratedSeoDraft {
  title_tag: string;
  meta_description: string;
  canonical_path?: string;
  indexation_policy?: SeoIndexationPolicy;
  robots_directive?: string;
  sitemap?: {
    include?: boolean;
    family?: string;
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

interface BatchGeneratedSeoDraft {
  seo_document_id: string;
  draft: GeneratedSeoDraft;
  provider_used: string;
  model_used?: string;
  fell_back: boolean;
}

interface BatchGenerateResponse {
  results: BatchGeneratedSeoDraft[];
  errors: Array<{
    seo_document_id: string | null;
    error: string;
  }>;
}

interface BulkDraftResult {
  recordId: string;
  editor: SeoEditorState;
  included: boolean;
  stage: BulkDraftStage;
  error: string | null;
  provider: string | null;
  model: string | null;
  fellBack: boolean;
}

interface DbError {
  message?: string;
}

interface DbResponse<T = unknown> {
  data: T | null;
  error: DbError | null;
}

interface QueryBuilder extends PromiseLike<DbResponse> {
  select(columns: string): QueryBuilder;
  order(column: string, options?: { ascending?: boolean }): QueryBuilder;
  in(column: string, values: string[]): QueryBuilder;
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

const JSON_PLACEHOLDER = "[]";
const OBJECT_PLACEHOLDER = "{}";
const BULK_GENERATION_CHUNK_SIZE = 5;

const DOCUMENT_TYPE_OPTIONS: Array<{ value: SeoDocumentType; label: string }> = [
  { value: "route", label: "Routes" },
  { value: "product", label: "Products" },
  { value: "theme", label: "Themes" },
  { value: "collection", label: "Collections" },
  { value: "system", label: "System" },
];

const BULK_STATUS_OPTIONS: Array<{ value: BulkStatusFilter; label: string }> = [
  { value: "draft", label: "Drafts" },
  { value: "missing", label: "Needs content" },
  { value: "indexable", label: "Indexable" },
  { value: "noindex", label: "Noindex" },
  { value: "sitemap", label: "In sitemap" },
  { value: "hidden", label: "Hidden" },
];

const ROUTE_LABELS: Record<string, string> = {
  "/": "Home",
  "/browse": "Browse LEGO Sets",
  "/themes": "Browse Themes",
  "/new-arrivals": "New Arrivals",
  "/deals": "Deals",
  "/about": "About Kuso Oishii",
  "/faq": "Frequently Asked Questions",
  "/grading": "LEGO Set Grading Guide",
  "/contact": "Contact",
  "/shipping-policy": "Shipping Policy",
  "/returns-exchanges": "Returns & Exchanges",
  "/terms": "Terms of Service",
  "/privacy": "Privacy Policy",
  "/bluebell": "Blue Bell LEGO Club",
  "/cart": "Cart",
  "/checkout/success": "Order Confirmed",
  "/order-tracking": "Track Your Order",
  "/login": "Sign In",
  "/signup": "Create Account",
  "/forgot-password": "Forgot Password",
  "/reset-password": "Reset Password",
  "/account": "Account",
  "/welcome": "Welcome",
  "/unsubscribe": "Unsubscribe",
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

function editorStateFromRecord(record: SeoDocumentWithRevision): SeoEditorState {
  const revision = record.revision;
  return {
    title_tag: revision?.title_tag ?? record.product?.seo_title ?? "",
    meta_description: revision?.meta_description ?? record.product?.seo_description ?? "",
    canonical_path: revision?.canonical_path ?? record.route_path ?? (record.entity_reference ? `/sets/${record.entity_reference}` : ""),
    indexation_policy: revision?.indexation_policy ?? "index",
    robots_directive: revision?.robots_directive ?? "index, follow",
    sitemap_include: revision?.sitemap?.include ?? false,
    sitemap_family: revision?.sitemap?.family ?? record.document_type,
    sitemap_changefreq: revision?.sitemap?.changefreq ?? (record.document_type === "product" ? "weekly" : "monthly"),
    sitemap_priority: String(revision?.sitemap?.priority ?? (record.document_type === "product" ? 0.8 : 0.7)),
    keywords: revision?.keywords?.join(", ") ?? "",
    breadcrumbs: formatJson(revision?.breadcrumbs, JSON_PLACEHOLDER),
    structured_data: formatJson(revision?.structured_data, JSON_PLACEHOLDER),
    image_metadata: formatJson(revision?.image_metadata, OBJECT_PLACEHOLDER),
    geo: formatJson(revision?.geo, OBJECT_PLACEHOLDER),
    change_summary: "",
  };
}

function editorStateFromDraft(current: SeoEditorState, draft: GeneratedSeoDraft): SeoEditorState {
  return {
    ...current,
    title_tag: draft.title_tag ?? current.title_tag,
    meta_description: draft.meta_description ?? current.meta_description,
    canonical_path: draft.canonical_path ?? current.canonical_path,
    indexation_policy: draft.indexation_policy ?? current.indexation_policy,
    robots_directive: draft.robots_directive ?? current.robots_directive,
    sitemap_include: draft.sitemap?.include ?? current.sitemap_include,
    sitemap_family: draft.sitemap?.family ?? current.sitemap_family,
    sitemap_changefreq: draft.sitemap?.changefreq ?? current.sitemap_changefreq,
    sitemap_priority: draft.sitemap?.priority != null ? String(draft.sitemap.priority) : current.sitemap_priority,
    keywords: draft.keywords?.join(", ") ?? current.keywords,
    breadcrumbs: formatJson(draft.breadcrumbs, current.breadcrumbs || JSON_PLACEHOLDER),
    structured_data: formatJson(draft.structured_data, current.structured_data || JSON_PLACEHOLDER),
    image_metadata: formatJson(draft.image_metadata, current.image_metadata || OBJECT_PLACEHOLDER),
    geo: formatJson(draft.geo, current.geo || OBJECT_PLACEHOLDER),
    change_summary: draft.change_summary ?? "AI generated SEO/GEO draft reviewed in admin.",
  };
}

function priorityFromInput(value: string) {
  const priority = Number.parseFloat(value);
  if (!Number.isFinite(priority) || priority < 0 || priority > 1) {
    throw new Error("Sitemap priority must be a number between 0 and 1");
  }
  return Number(priority.toFixed(1));
}

function seoCurrentPayloadFromEditor(state: SeoEditorState) {
  return {
    title_tag: state.title_tag,
    meta_description: state.meta_description,
    canonical_path: state.canonical_path,
    indexation_policy: state.indexation_policy,
    robots_directive: state.robots_directive,
    sitemap: {
      include: state.sitemap_include,
      family: state.sitemap_family,
      changefreq: state.sitemap_changefreq,
      priority: Number(state.sitemap_priority),
    },
    keywords: state.keywords,
    breadcrumbs: state.breadcrumbs,
    structured_data: state.structured_data,
    image_metadata: state.image_metadata,
    geo: state.geo,
  };
}

function productTheme(product: SeoProductContext | null) {
  if (!product) return null;
  return product.lego_theme ?? product.subtheme_name ?? product.lego_subtheme ?? product.theme_id;
}

function displayTitle(record: SeoDocumentWithRevision) {
  if (record.product?.name) return record.product.name;
  if (record.revision?.title_tag) return record.revision.title_tag;
  if (record.route_path && ROUTE_LABELS[record.route_path]) return ROUTE_LABELS[record.route_path];
  return record.document_key.replace(/^(route|product|theme|collection|system):/, "");
}

function displaySubtitle(record: SeoDocumentWithRevision) {
  if (record.product) {
    const bits = [
      record.product.mpn,
      productTheme(record.product),
      record.product.release_year ? String(record.product.release_year) : null,
      record.product.piece_count ? `${record.product.piece_count} pcs` : null,
    ].filter(Boolean);
    return bits.join(" · ");
  }
  return record.revision?.canonical_path ?? record.route_path ?? record.entity_reference ?? record.document_key;
}

function statusKind(record: SeoDocumentWithRevision): Exclude<SeoStatusFilter, "all"> {
  if (record.revision?.status === "draft") return "draft";
  if (!record.revision || !record.revision.title_tag || !record.revision.meta_description) return "missing";
  if (record.revision.indexation_policy === "noindex") return "noindex";
  if (record.revision.sitemap?.include) return "sitemap";
  if (record.revision.indexation_policy === "index") return "indexable";
  return "hidden";
}

function statusBadge(record: SeoDocumentWithRevision) {
  const status = statusKind(record);
  if (status === "draft") return <Badge label="Draft" color="#D97706" small />;
  if (status === "missing") return <Badge label="Needs content" color="#D97706" small />;
  if (status === "noindex") return <Badge label="Noindex" color="#DC2626" small />;
  if (status === "sitemap") return <Badge label="In sitemap" color="#16A34A" small />;
  if (status === "indexable") return <Badge label="Indexable" color="#2563EB" small />;
  return <Badge label="Hidden" color="#71717A" small />;
}

async function fetchSeoDocuments(): Promise<SeoDocumentWithRevision[]> {
  const { data: documents, error: documentsError } = await db
    .from("seo_document")
    .select("id, document_key, document_type, route_path, entity_type, entity_id, entity_reference, status, published_revision_id, metadata, updated_at")
    .order("document_type", { ascending: true })
    .order("document_key", { ascending: true });

  if (documentsError) throw documentsError;

  const rows = (documents ?? []) as SeoDocumentRow[];
  const documentIds = rows.map((row) => row.id);

  const draftRevisionsByDocument = new Map<string, SeoRevisionRow>();
  const publishedRevisionsByDocument = new Map<string, SeoRevisionRow>();
  if (documentIds.length) {
    const { data: revisions, error: revisionsError } = await db
      .from("seo_revision")
      .select("id, seo_document_id, revision_number, status, canonical_path, canonical_url, title_tag, meta_description, indexation_policy, robots_directive, open_graph, twitter_card, breadcrumbs, structured_data, image_metadata, sitemap, geo, keywords, source, change_summary, published_at, created_at")
      .in("seo_document_id", documentIds)
      .order("revision_number", { ascending: false });

    if (revisionsError) throw revisionsError;
    const publishedIds = new Set(rows.map((row) => row.published_revision_id).filter(Boolean));
    for (const revision of (revisions ?? []) as SeoRevisionRow[]) {
      if (revision.status === "draft" && !draftRevisionsByDocument.has(revision.seo_document_id)) {
        draftRevisionsByDocument.set(revision.seo_document_id, revision);
      }
      if (publishedIds.has(revision.id)) {
        publishedRevisionsByDocument.set(revision.seo_document_id, revision);
      }
    }
  }

  const productReferences = Array.from(new Set(
    rows
      .filter((row) => row.document_type === "product")
      .map((row) => row.entity_reference)
      .filter((ref): ref is string => typeof ref === "string" && ref.length > 0),
  ));

  let productsByMpn = new Map<string, SeoProductContext>();
  if (productReferences.length) {
    const { data: products, error: productsError } = await db
      .from("product")
      .select("id, mpn, name, product_type, lego_theme, lego_subtheme, theme_id, subtheme_name, piece_count, release_year, retired_flag, img_url, seo_title, seo_description, description, status")
      .in("mpn", productReferences);
    if (productsError) throw productsError;
    productsByMpn = new Map<string, SeoProductContext>(
      ((products ?? []) as SeoProductContext[]).map((product) => [product.mpn, product]),
    );
  }

  return rows.map((row) => ({
    ...row,
    revision: draftRevisionsByDocument.get(row.id) ?? publishedRevisionsByDocument.get(row.id) ?? null,
    draft_revision: draftRevisionsByDocument.get(row.id) ?? null,
    published_revision: publishedRevisionsByDocument.get(row.id) ?? null,
    product: row.entity_reference ? productsByMpn.get(row.entity_reference) ?? null : null,
  }));
}

function seoRevisionRpcArgs(record: SeoDocumentWithRevision, state: SeoEditorState, requireContent: boolean) {
  const currentRevision = record.revision;
  const canonicalPath = state.canonical_path.trim();
  if (!canonicalPath.startsWith("/")) throw new Error("Canonical path must start with /");
  if (requireContent && !state.title_tag.trim()) throw new Error("Title tag is required");
  if (requireContent && !state.meta_description.trim()) throw new Error("Meta description is required");

  const structuredData = parseJsonField("structured data", state.structured_data);
  const breadcrumbs = parseJsonField("breadcrumbs", state.breadcrumbs);
  const imageMetadata = parseJsonField("image metadata", state.image_metadata);
  const geo = parseJsonField("GEO metadata", state.geo);
  const keywords = state.keywords
    .split(",")
    .map((keyword) => keyword.trim())
    .filter(Boolean);

  const sitemap = {
    include: state.sitemap_include,
    family: state.sitemap_family.trim() || record.document_type,
    changefreq: state.sitemap_changefreq,
    priority: priorityFromInput(state.sitemap_priority),
  };

  const canonicalUrl = absoluteUrl(canonicalPath);
  return {
    p_seo_document_id: record.id,
    p_canonical_path: canonicalPath,
    p_canonical_url: canonicalUrl,
    p_title_tag: state.title_tag.trim(),
    p_meta_description: state.meta_description.trim(),
    p_indexation_policy: state.indexation_policy,
    p_robots_directive: state.robots_directive.trim() || (state.indexation_policy === "noindex" ? "noindex, nofollow" : "index, follow"),
    p_open_graph: {
      ...(currentRevision?.open_graph ?? {}),
      title: state.title_tag.trim(),
      description: state.meta_description.trim(),
      url: canonicalUrl,
    },
    p_twitter_card: {
      ...(currentRevision?.twitter_card ?? {}),
      title: state.title_tag.trim(),
      description: state.meta_description.trim(),
    },
    p_breadcrumbs: breadcrumbs,
    p_structured_data: structuredData,
    p_image_metadata: imageMetadata,
    p_sitemap: sitemap,
    p_geo: geo,
    p_keywords: keywords,
    p_source: "admin_ui",
  };
}

async function saveSeoRevisionDraft(record: SeoDocumentWithRevision, state: SeoEditorState) {
  const { data: revision, error: revisionError } = await db
    .rpc("save_seo_revision_draft", {
      ...seoRevisionRpcArgs(record, state, false),
      p_change_summary: state.change_summary.trim() || "Saved from SEO/GEO admin.",
    })
    .single();

  if (revisionError) throw revisionError;
  const revisionRow = revision as { id: string } | null;
  if (!revisionRow?.id) throw new Error("Saved draft was not returned");
}

async function publishSeoRevision(record: SeoDocumentWithRevision, state: SeoEditorState) {
  const { data: revision, error: revisionError } = await db
    .rpc("publish_seo_revision", {
      ...seoRevisionRpcArgs(record, state, true),
      p_change_summary: state.change_summary.trim() || "Published from SEO/GEO admin.",
    })
    .single();

  if (revisionError) throw revisionError;
  const revisionRow = revision as { id: string } | null;
  if (!revisionRow?.id) throw new Error("Published revision was not returned");
}

export default function SeoGeoPage() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [revisionView, setRevisionView] = useState<"draft" | "published">("draft");
  const [typeFilter, setTypeFilter] = useState<SeoDocumentType | "all">("all");
  const [statusFilter, setStatusFilter] = useState<SeoStatusFilter>("all");
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState<SeoEditorState | null>(null);
  const [lastGeneration, setLastGeneration] = useState<{ provider: string; fellBack: boolean } | null>(null);
  const [bulkTypes, setBulkTypes] = useState<SeoDocumentType[]>(["product"]);
  const [bulkStatuses, setBulkStatuses] = useState<BulkStatusFilter[]>(["missing", "draft"]);
  const [bulkQuery, setBulkQuery] = useState("");
  const [bulkSelection, setBulkSelection] = useState<Set<string>>(() => new Set());
  const [bulkResults, setBulkResults] = useState<Record<string, BulkDraftResult>>({});
  const [bulkGenerating, setBulkGenerating] = useState(false);
  const [bulkAction, setBulkAction] = useState<"save" | "publish" | null>(null);

  const { data = [], isLoading, error } = useQuery({
    queryKey: ["admin", "seo-documents"],
    queryFn: fetchSeoDocuments,
    retry: false,
  });

  const selected = data.find((record) => record.id === selectedId) ?? data[0] ?? null;
  const selectedDraftRevisionId = selected?.draft_revision?.id ?? null;
  const selectedRevision = useMemo(() => (
    selected
      ? revisionView === "published"
        ? selected.published_revision ?? selected.draft_revision
        : selected.draft_revision ?? selected.published_revision
      : null
  ), [revisionView, selected]);
  const selectedView = useMemo(() => (
    selected ? { ...selected, revision: selectedRevision } : null
  ), [selected, selectedRevision]);

  useEffect(() => {
    if (selected && selected.id !== selectedId) setSelectedId(selected.id);
  }, [selected, selectedId]);

  useEffect(() => {
    if (selectedId) {
      setRevisionView(selectedDraftRevisionId ? "draft" : "published");
      setLastGeneration(null);
    }
  }, [selectedId, selectedDraftRevisionId]);

  useEffect(() => {
    if (selectedView) setEditor(editorStateFromRecord(selectedView));
  }, [selectedView]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return data.filter((record) => {
      if (typeFilter !== "all" && record.document_type !== typeFilter) return false;
      if (statusFilter !== "all" && statusKind(record) !== statusFilter) return false;
      if (!needle) return true;
      return [
        record.document_key,
        record.route_path,
        record.entity_reference,
        record.product?.name,
        record.product?.lego_theme,
        record.product?.lego_subtheme,
        record.product?.subtheme_name,
        record.revision?.title_tag,
        record.revision?.canonical_path,
      ].some((value) => value?.toLowerCase().includes(needle));
    });
  }, [data, query, statusFilter, typeFilter]);

  const counts = useMemo(() => ({
    total: data.length,
    draft: data.filter((record) => record.revision?.status === "draft").length,
    missing: data.filter((record) => statusKind(record) === "missing").length,
    indexable: data.filter((record) => record.revision?.indexation_policy === "index").length,
    noindex: data.filter((record) => record.revision?.indexation_policy === "noindex").length,
    sitemap: data.filter((record) => record.revision?.sitemap?.include === true).length,
  }), [data]);

  const recordsById = useMemo(() => new Map(data.map((record) => [record.id, record])), [data]);

  useEffect(() => {
    if (!data.length) return;
    const validIds = new Set(data.map((record) => record.id));
    setBulkSelection((current) => new Set([...current].filter((id) => validIds.has(id))));
    setBulkResults((current) => {
      const entries = Object.entries(current).filter(([id]) => validIds.has(id));
      return entries.length === Object.keys(current).length ? current : Object.fromEntries(entries);
    });
  }, [data]);

  const bulkCandidates = useMemo(() => {
    const needle = bulkQuery.trim().toLowerCase();
    return data.filter((record) => {
      if (bulkTypes.length > 0 && !bulkTypes.includes(record.document_type)) return false;
      if (bulkStatuses.length > 0 && !bulkStatuses.includes(statusKind(record))) return false;
      if (!needle) return true;
      return [
        record.document_key,
        record.route_path,
        record.entity_reference,
        record.product?.name,
        record.product?.lego_theme,
        record.product?.lego_subtheme,
        record.product?.subtheme_name,
        record.revision?.title_tag,
        record.revision?.canonical_path,
      ].some((value) => value?.toLowerCase().includes(needle));
    });
  }, [bulkQuery, bulkStatuses, bulkTypes, data]);

  const bulkSelectedRecords = useMemo(
    () => data.filter((record) => bulkSelection.has(record.id)),
    [bulkSelection, data],
  );

  const bulkReviewItems = useMemo(() => {
    const order = new Map(data.map((record, index) => [record.id, index]));
    return Object.values(bulkResults)
      .map((result) => {
        const record = recordsById.get(result.recordId);
        return record ? { record, result } : null;
      })
      .filter((item): item is { record: SeoDocumentWithRevision; result: BulkDraftResult } => item !== null)
      .sort((a, b) => (order.get(a.record.id) ?? 0) - (order.get(b.record.id) ?? 0));
  }, [bulkResults, data, recordsById]);

  const bulkReadyCount = bulkReviewItems.filter(({ result }) => ["ready", "saved", "published"].includes(result.stage)).length;
  const bulkErrorCount = bulkReviewItems.filter(({ result }) => result.stage === "error").length;
  const bulkIncludedCount = bulkReviewItems.filter(({ result }) => result.included && result.stage !== "error" && result.stage !== "generating").length;
  const bulkProgressValue = bulkReviewItems.length
    ? Math.round(((bulkReadyCount + bulkErrorCount) / bulkReviewItems.length) * 100)
    : 0;

  const toggleBulkType = (type: SeoDocumentType, checked: boolean) => {
    setBulkTypes((current) => checked
      ? Array.from(new Set([...current, type]))
      : current.filter((value) => value !== type));
  };

  const toggleBulkStatus = (status: BulkStatusFilter, checked: boolean) => {
    setBulkStatuses((current) => checked
      ? Array.from(new Set([...current, status]))
      : current.filter((value) => value !== status));
  };

  const toggleBulkSelection = (recordId: string, checked: boolean) => {
    setBulkSelection((current) => {
      const next = new Set(current);
      if (checked) next.add(recordId);
      else next.delete(recordId);
      return next;
    });
  };

  const selectAllBulkCandidates = () => {
    setBulkSelection((current) => {
      const next = new Set(current);
      for (const record of bulkCandidates) next.add(record.id);
      return next;
    });
  };

  const clearBulkSelection = () => {
    setBulkSelection(new Set());
  };

  const updateBulkEditor = (recordId: string, update: Partial<SeoEditorState>) => {
    setBulkResults((current) => {
      const result = current[recordId];
      if (!result) return current;
      const resetStage = result.stage === "saved" || result.stage === "published";
      return {
        ...current,
        [recordId]: {
          ...result,
          editor: { ...result.editor, ...update },
          stage: resetStage ? "ready" : result.stage,
        },
      };
    });
  };

  const setBulkResultIncluded = (recordId: string, included: boolean) => {
    setBulkResults((current) => {
      const result = current[recordId];
      return result ? { ...current, [recordId]: { ...result, included } } : current;
    });
  };

  const markBulkResult = (recordId: string, update: Partial<BulkDraftResult>) => {
    setBulkResults((current) => {
      const result = current[recordId];
      return result ? { ...current, [recordId]: { ...result, ...update } } : current;
    });
  };

  const handleBulkGenerate = async () => {
    if (bulkSelectedRecords.length === 0) {
      toast.error("Select at least one SEO/GEO document to generate");
      return;
    }

    setBulkGenerating(true);
    const selectedRecords = bulkSelectedRecords;
    setBulkResults((current) => {
      const next = { ...current };
      for (const record of selectedRecords) {
        next[record.id] = {
          recordId: record.id,
          editor: editorStateFromRecord(record),
          included: true,
          stage: "generating",
          error: null,
          provider: null,
          model: null,
          fellBack: false,
        };
      }
      return next;
    });

    let generatedCount = 0;
    let failedCount = 0;
    let fellBack = false;
    try {
      for (let index = 0; index < selectedRecords.length; index += BULK_GENERATION_CHUNK_SIZE) {
        const chunk = selectedRecords.slice(index, index + BULK_GENERATION_CHUNK_SIZE);
        try {
          const response = await invokeWithAuth<BatchGenerateResponse>("generate-seo-geo", {
            items: chunk.map((record) => {
              const state = editorStateFromRecord(record);
              return {
                seo_document_id: record.id,
                current: seoCurrentPayloadFromEditor(state),
              };
            }),
          });

          const returnedIds = new Set<string>();
          for (const item of response.results ?? []) {
            const record = recordsById.get(item.seo_document_id);
            if (!record) continue;
            returnedIds.add(item.seo_document_id);
            fellBack = fellBack || item.fell_back;
            generatedCount += 1;
            const baseState = editorStateFromRecord(record);
            markBulkResult(item.seo_document_id, {
              editor: editorStateFromDraft(baseState, item.draft),
              stage: "ready",
              error: null,
              provider: item.provider_used,
              model: item.model_used ?? null,
              fellBack: item.fell_back,
            });
          }

          for (const item of response.errors ?? []) {
            if (!item.seo_document_id) continue;
            returnedIds.add(item.seo_document_id);
            failedCount += 1;
            markBulkResult(item.seo_document_id, {
              stage: "error",
              error: item.error,
              included: false,
            });
          }

          for (const record of chunk) {
            if (returnedIds.has(record.id)) continue;
            failedCount += 1;
            markBulkResult(record.id, {
              stage: "error",
              error: "No draft returned for this document.",
              included: false,
            });
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : "Batch generation failed";
          failedCount += chunk.length;
          for (const record of chunk) {
            markBulkResult(record.id, {
              stage: "error",
              error: message,
              included: false,
            });
          }
        }
      }

      if (generatedCount > 0) {
        toast.success(fellBack ? `Generated ${generatedCount} drafts with fallback` : `Generated ${generatedCount} drafts`);
      }
      if (failedCount > 0) toast.error(`${failedCount} draft${failedCount === 1 ? "" : "s"} failed`);
    } finally {
      setBulkGenerating(false);
    }
  };

  const applyBulkResult = async (recordId: string, action: "save" | "publish") => {
    const result = bulkResults[recordId];
    const record = recordsById.get(recordId);
    if (!result || !record) throw new Error("Bulk result is no longer available");

    markBulkResult(recordId, { stage: action === "save" ? "saving" : "publishing", error: null });
    try {
      if (action === "save") await saveSeoRevisionDraft(record, result.editor);
      else await publishSeoRevision(record, result.editor);
      markBulkResult(recordId, {
        stage: action === "save" ? "saved" : "published",
        included: action === "publish" ? false : result.included,
      });
    } catch (err) {
      markBulkResult(recordId, {
        stage: "error",
        error: err instanceof Error ? err.message : action === "save" ? "Draft save failed" : "Approval failed",
      });
      throw err;
    }
  };

  const handleBulkApply = async (action: "save" | "publish", recordIds?: string[]) => {
    const ids = recordIds ?? bulkReviewItems
      .filter(({ result }) => result.included && result.stage !== "error" && result.stage !== "generating")
      .map(({ record }) => record.id);

    if (ids.length === 0) {
      toast.error(action === "save" ? "Select drafts to save" : "Select drafts to approve");
      return;
    }

    setBulkAction(action);
    let appliedCount = 0;
    let failedCount = 0;
    try {
      for (const id of ids) {
        try {
          await applyBulkResult(id, action);
          appliedCount += 1;
        } catch {
          failedCount += 1;
        }
      }

      if (appliedCount > 0) {
        toast.success(action === "save" ? `Saved ${appliedCount} draft${appliedCount === 1 ? "" : "s"}` : `Approved ${appliedCount} revision${appliedCount === 1 ? "" : "s"}`);
        await queryClient.invalidateQueries({ queryKey: ["admin", "seo-documents"] });
        if (action === "publish") await queryClient.invalidateQueries({ queryKey: ["seo_document"] });
      }
      if (failedCount > 0) toast.error(`${failedCount} item${failedCount === 1 ? "" : "s"} failed`);
    } finally {
      setBulkAction(null);
    }
  };

  const publish = useMutation({
    mutationFn: async () => {
      if (!selectedView || !editor) throw new Error("Select an SEO document first");
      await publishSeoRevision(selectedView, editor);
    },
    onSuccess: async () => {
      toast.success("SEO/GEO revision published");
      await queryClient.invalidateQueries({ queryKey: ["admin", "seo-documents"] });
      await queryClient.invalidateQueries({ queryKey: ["seo_document"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Publish failed"),
  });

  const saveDraft = useMutation({
    mutationFn: async () => {
      if (!selectedView || !editor) throw new Error("Select an SEO document first");
      await saveSeoRevisionDraft(selectedView, editor);
    },
    onSuccess: async () => {
      toast.success("SEO/GEO draft saved");
      await queryClient.invalidateQueries({ queryKey: ["admin", "seo-documents"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Draft save failed"),
  });

  const generate = useMutation({
    mutationFn: async () => {
      if (!selected || !editor) throw new Error("Select an SEO document first");
      return invokeWithAuth<{ draft: GeneratedSeoDraft; provider_used: string; fell_back: boolean }>(
        "generate-seo-geo",
        {
          seo_document_id: selected.id,
          current: seoCurrentPayloadFromEditor(editor),
        },
      );
    },
    onSuccess: (result) => {
      setEditor((current) => current ? editorStateFromDraft(current, result.draft) : current);
      setLastGeneration({ provider: result.provider_used, fellBack: result.fell_back });
      toast.success(result.fell_back ? "Draft generated with OpenAI fallback" : "AI draft generated");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Generation failed"),
  });

  return (
    <AdminV2Layout>
      <div className="mx-auto grid max-w-[1560px] gap-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <FileSearch className="h-5 w-5 text-amber-600" />
              <h1 className="text-[20px] font-bold text-zinc-900">SEO/GEO Content</h1>
            </div>
            <p className="mt-1 max-w-3xl text-[12px] text-zinc-500">
              Review, generate, edit, and publish app-mastered metadata for search engines, AI answer engines, sitemap projection, and structured data.
            </p>
          </div>
          {lastGeneration ? (
            <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-800">
              Latest draft: {lastGeneration.provider === "lovable" ? "Lovable AI" : "OpenAI"}
              {lastGeneration.fellBack ? " fallback" : ""}
            </div>
          ) : null}
        </div>

        {error ? (
          <SurfaceCard>
            <p className="text-sm font-medium text-destructive">SEO/GEO records are not available.</p>
            <p className="mt-1 text-xs text-zinc-500">
              Apply the `seo_document` migration, then reload this page.
            </p>
          </SurfaceCard>
        ) : null}

        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Metric label="Documents" value={counts.total} tone="neutral" />
          <Metric label="Drafts" value={counts.draft} tone="amber" />
          <Metric label="Indexable" value={counts.indexable} tone="blue" />
          <Metric label="Noindex" value={counts.noindex} tone="red" />
          <Metric label="In Sitemap" value={counts.sitemap} tone="green" />
        </div>

        <SurfaceCard>
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-200 pb-4">
            <div>
              <div className="flex items-center gap-2">
                <CheckSquare className="h-4 w-4 text-amber-600" />
                <SectionHead>Bulk Create & Review</SectionHead>
              </div>
              <p className="mt-1 max-w-3xl text-xs text-zinc-500">
                Batch SEO/GEO drafts across selected document families, then review, edit, save, or approve each revision.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleBulkApply("save")}
                disabled={bulkAction !== null || bulkGenerating || bulkIncludedCount === 0}
              >
                {bulkAction === "save" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Save selected drafts
              </Button>
              <Button
                size="sm"
                onClick={() => handleBulkApply("publish")}
                disabled={bulkAction !== null || bulkGenerating || bulkIncludedCount === 0}
              >
                {bulkAction === "publish" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                Approve selected
              </Button>
            </div>
          </div>

          <div className="mt-4 grid gap-5 xl:grid-cols-[380px_1fr]">
            <div className="grid gap-4">
              <div>
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-zinc-500">Document Types</div>
                <div className="grid grid-cols-2 gap-2">
                  {DOCUMENT_TYPE_OPTIONS.map((option) => (
                    <BulkFilterToggle
                      key={option.value}
                      label={option.label}
                      checked={bulkTypes.includes(option.value)}
                      onCheckedChange={(checked) => toggleBulkType(option.value, checked)}
                    />
                  ))}
                </div>
              </div>

              <div>
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-zinc-500">Statuses</div>
                <div className="grid grid-cols-2 gap-2">
                  {BULK_STATUS_OPTIONS.map((option) => (
                    <BulkFilterToggle
                      key={option.value}
                      label={option.label}
                      checked={bulkStatuses.includes(option.value)}
                      onCheckedChange={(checked) => toggleBulkStatus(option.value, checked)}
                    />
                  ))}
                </div>
              </div>

              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                <Input
                  value={bulkQuery}
                  onChange={(event) => setBulkQuery(event.target.value)}
                  placeholder="Filter bulk candidates..."
                  className="pl-9"
                />
              </div>

              <div className="rounded-md border border-zinc-200">
                <div className="flex items-center justify-between border-b border-zinc-100 px-3 py-2">
                  <span className="text-xs font-semibold text-zinc-700">{bulkCandidates.length} candidates</span>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={selectAllBulkCandidates}>
                      Select shown
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={clearBulkSelection}>
                      Clear
                    </Button>
                  </div>
                </div>
                <div className="max-h-[320px] overflow-auto">
                  {bulkCandidates.map((record) => (
                    <label
                      key={record.id}
                      className="flex cursor-pointer gap-3 border-b border-zinc-100 px-3 py-2.5 last:border-b-0 hover:bg-zinc-50"
                    >
                      <Checkbox
                        checked={bulkSelection.has(record.id)}
                        onCheckedChange={(checked) => toggleBulkSelection(record.id, checked === true)}
                        className="mt-0.5"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="mb-1 flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[10px] uppercase text-zinc-500">{record.document_type}</span>
                          {statusBadge(record)}
                        </span>
                        <span className="block truncate text-[12px] font-semibold text-zinc-900">{displayTitle(record)}</span>
                        <span className="mt-0.5 block truncate text-[11px] text-zinc-500">{displaySubtitle(record)}</span>
                      </span>
                    </label>
                  ))}
                  {bulkCandidates.length === 0 ? (
                    <div className="p-3 text-sm text-zinc-500">No matching bulk candidates.</div>
                  ) : null}
                </div>
              </div>

              <Button onClick={handleBulkGenerate} disabled={bulkGenerating || bulkAction !== null || bulkSelectedRecords.length === 0}>
                {bulkGenerating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                {bulkGenerating ? "Generating..." : `Generate ${bulkSelectedRecords.length || ""} selected`}
              </Button>
            </div>

            <div className="min-w-0">
              <div className="mb-3 rounded-md border border-zinc-200 bg-zinc-50 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-zinc-800">
                    {bulkReviewItems.length > 0
                      ? `${bulkReadyCount} ready · ${bulkIncludedCount} selected for approval`
                      : "No generated drafts yet"}
                  </div>
                  {bulkErrorCount > 0 ? (
                    <div className="flex items-center gap-1 text-xs font-semibold text-red-600">
                      <XCircle className="h-3.5 w-3.5" />
                      {bulkErrorCount} failed
                    </div>
                  ) : null}
                </div>
                {bulkReviewItems.length > 0 ? (
                  <Progress value={bulkProgressValue} className="mt-3 h-2" />
                ) : null}
              </div>

              <div className="grid gap-3">
                {bulkReviewItems.map(({ record, result }) => (
                  <BulkResultCard
                    key={record.id}
                    record={record}
                    result={result}
                    disabled={bulkGenerating || bulkAction !== null}
                    onIncludedChange={(included) => setBulkResultIncluded(record.id, included)}
                    onEditorChange={(update) => updateBulkEditor(record.id, update)}
                    onSave={() => handleBulkApply("save", [record.id])}
                    onPublish={() => handleBulkApply("publish", [record.id])}
                  />
                ))}
                {bulkReviewItems.length === 0 ? (
                  <div className="rounded-md border border-dashed border-zinc-300 p-5 text-center text-sm text-zinc-500">
                    Generated drafts will appear here for review.
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </SurfaceCard>

        <div className="grid gap-5 xl:grid-cols-[480px_1fr]">
          <SurfaceCard className="min-h-[720px]" noPadding>
            <div className="border-b border-zinc-200 p-4">
              <div className="mb-3 flex items-center justify-between">
                <SectionHead>Documents</SectionHead>
                <span className="text-xs text-zinc-500">{filtered.length} shown</span>
              </div>
              <div className="grid gap-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                  <Input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search product name, MPN, theme, route..."
                    className="pl-9"
                  />
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Select value={typeFilter} onValueChange={(value) => setTypeFilter(value as SeoDocumentType | "all")}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All document types</SelectItem>
                      <SelectItem value="route">Routes</SelectItem>
                      <SelectItem value="product">Products</SelectItem>
                      <SelectItem value="theme">Themes</SelectItem>
                      <SelectItem value="collection">Collections</SelectItem>
                      <SelectItem value="system">System</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as SeoStatusFilter)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All statuses</SelectItem>
                      <SelectItem value="draft">Drafts</SelectItem>
                      <SelectItem value="missing">Needs content</SelectItem>
                      <SelectItem value="indexable">Indexable</SelectItem>
                      <SelectItem value="noindex">Noindex</SelectItem>
                      <SelectItem value="sitemap">In sitemap</SelectItem>
                      <SelectItem value="hidden">Hidden</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <div className="max-h-[620px] overflow-auto">
              {isLoading ? <div className="p-4 text-sm text-zinc-500">Loading SEO documents...</div> : null}
              {filtered.map((record) => (
                <button
                  key={record.id}
                  type="button"
                  onClick={() => setSelectedId(record.id)}
                  className={`block w-full border-b border-zinc-100 px-4 py-3 text-left transition-colors ${
                    selected?.id === record.id ? "bg-amber-50" : "hover:bg-zinc-50"
                  }`}
                >
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[11px] uppercase text-zinc-500">{record.document_type}</span>
                    {statusBadge(record)}
                    {record.document_type === "product" && record.product?.status ? (
                      <span className="rounded border border-zinc-200 px-1.5 py-0.5 text-[10px] uppercase text-zinc-500">
                        {record.product.status}
                      </span>
                    ) : null}
                  </div>
                  <div className="truncate text-[13px] font-semibold text-zinc-900">
                    {displayTitle(record)}
                  </div>
                  <div className="mt-1 truncate text-[11px] text-zinc-500">
                    {displaySubtitle(record)}
                  </div>
                  <div className="mt-1 truncate font-mono text-[10px] text-zinc-400">
                    {record.revision?.canonical_path ?? record.route_path ?? record.document_key}
                  </div>
                </button>
              ))}
              {!isLoading && filtered.length === 0 ? (
                <div className="p-4 text-sm text-zinc-500">No SEO documents match this filter.</div>
              ) : null}
            </div>
          </SurfaceCard>

          <SurfaceCard>
            {!selectedView || !editor ? (
              <div className="text-sm text-zinc-500">Select a document to edit.</div>
            ) : (
              <div className="grid gap-5">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-200 pb-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate text-base font-bold text-zinc-900">{displayTitle(selectedView)}</h2>
                      {statusBadge(selectedView)}
                    </div>
                    <p className="mt-1 text-xs text-zinc-500">
                      {displaySubtitle(selectedView)}
                    </p>
                    <p className="mt-1 text-[11px] text-zinc-400">
                      {selectedView.revision?.status === "draft" ? "Saved draft" : "Published revision"} {selectedView.revision?.revision_number ?? "none"} · {selectedView.revision?.source ?? "unpublished"}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {selected.draft_revision || selected.published_revision ? (
                      <div className="flex rounded-md border border-zinc-200 bg-white p-0.5">
                        <Button
                          variant={revisionView === "published" ? "default" : "ghost"}
                          size="sm"
                          className="h-8 px-2.5"
                          disabled={!selected.published_revision}
                          onClick={() => setRevisionView("published")}
                        >
                          Published
                        </Button>
                        <Button
                          variant={revisionView === "draft" ? "default" : "ghost"}
                          size="sm"
                          className="h-8 px-2.5"
                          disabled={!selected.draft_revision}
                          onClick={() => setRevisionView("draft")}
                        >
                          Draft
                        </Button>
                      </div>
                    ) : null}
                    {editor.canonical_path ? (
                      <Button variant="outline" size="sm" asChild>
                        <a href={editor.canonical_path} target="_blank" rel="noreferrer">
                          <ExternalLink className="mr-2 h-4 w-4" /> View Page
                        </a>
                      </Button>
                    ) : null}
                    <Button variant="outline" size="sm" onClick={() => generate.mutate()} disabled={generate.isPending}>
                      {generate.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                      {generate.isPending ? "Generating..." : "Generate Draft"}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => saveDraft.mutate()} disabled={saveDraft.isPending || publish.isPending}>
                      <Save className="mr-2 h-4 w-4" /> {saveDraft.isPending ? "Saving..." : "Save Draft"}
                    </Button>
                    <Button size="sm" onClick={() => publish.mutate()} disabled={publish.isPending || saveDraft.isPending}>
                      <Save className="mr-2 h-4 w-4" /> {publish.isPending ? "Publishing..." : "Publish Revision"}
                    </Button>
                  </div>
                </div>

                <PreviewPanel record={selectedView} editor={editor} />

                <Tabs defaultValue="content" className="space-y-4">
                  <TabsList className="bg-zinc-100">
                    <TabsTrigger value="content">Content</TabsTrigger>
                    <TabsTrigger value="discovery">Discovery</TabsTrigger>
                    <TabsTrigger value="json">JSON Payloads</TabsTrigger>
                  </TabsList>

                  <TabsContent value="content" className="space-y-4">
                    <div className="grid gap-4 lg:grid-cols-2">
                      <Field label="Title Tag">
                        <Input value={editor.title_tag} onChange={(event) => setEditor({ ...editor, title_tag: event.target.value })} maxLength={80} />
                        <p className="mt-1 text-[11px] text-zinc-500">{editor.title_tag.length}/60 target</p>
                      </Field>
                      <Field label="Canonical Path">
                        <Input value={editor.canonical_path} onChange={(event) => setEditor({ ...editor, canonical_path: event.target.value })} />
                      </Field>
                      <Field label="Meta Description" className="lg:col-span-2">
                        <Textarea value={editor.meta_description} onChange={(event) => setEditor({ ...editor, meta_description: event.target.value })} rows={4} />
                        <p className="mt-1 text-[11px] text-zinc-500">{editor.meta_description.length}/160 target</p>
                      </Field>
                      <Field label="Keywords" className="lg:col-span-2">
                        <Input value={editor.keywords} onChange={(event) => setEditor({ ...editor, keywords: event.target.value })} placeholder="comma, separated, terms" />
                      </Field>
                    </div>
                  </TabsContent>

                  <TabsContent value="discovery" className="space-y-4">
                    <div className="grid gap-4 lg:grid-cols-2">
                      <Field label="Indexation">
                        <Select value={editor.indexation_policy} onValueChange={(value) => {
                          const next = value as SeoIndexationPolicy;
                          setEditor({
                            ...editor,
                            indexation_policy: next,
                            robots_directive: next === "noindex" ? "noindex, nofollow" : "index, follow",
                            sitemap_include: next === "index" ? editor.sitemap_include : false,
                          });
                        }}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="index">Index</SelectItem>
                            <SelectItem value="noindex">Noindex</SelectItem>
                          </SelectContent>
                        </Select>
                      </Field>
                      <Field label="Robots Directive">
                        <Input value={editor.robots_directive} onChange={(event) => setEditor({ ...editor, robots_directive: event.target.value })} />
                      </Field>
                    </div>

                    <div className="grid gap-4 lg:grid-cols-[160px_1fr_1fr_120px]">
                      <Field label="Sitemap">
                        <div className="flex h-10 items-center gap-2">
                          <Switch
                            checked={editor.sitemap_include}
                            disabled={editor.indexation_policy === "noindex"}
                            onCheckedChange={(checked) => setEditor({ ...editor, sitemap_include: checked })}
                          />
                          <span className="text-sm text-zinc-600">{editor.sitemap_include ? "Included" : "Excluded"}</span>
                        </div>
                      </Field>
                      <Field label="Family">
                        <Input value={editor.sitemap_family} onChange={(event) => setEditor({ ...editor, sitemap_family: event.target.value })} />
                      </Field>
                      <Field label="Changefreq">
                        <Select value={editor.sitemap_changefreq} onValueChange={(value) => setEditor({ ...editor, sitemap_changefreq: value })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="daily">Daily</SelectItem>
                            <SelectItem value="weekly">Weekly</SelectItem>
                            <SelectItem value="monthly">Monthly</SelectItem>
                            <SelectItem value="yearly">Yearly</SelectItem>
                          </SelectContent>
                        </Select>
                      </Field>
                      <Field label="Priority">
                        <Input value={editor.sitemap_priority} onChange={(event) => setEditor({ ...editor, sitemap_priority: event.target.value })} />
                      </Field>
                    </div>

                    <Field label="Change Summary">
                      <Input value={editor.change_summary} onChange={(event) => setEditor({ ...editor, change_summary: event.target.value })} placeholder="What changed and why?" />
                    </Field>
                  </TabsContent>

                  <TabsContent value="json" className="space-y-4">
                    <div className="grid gap-4 lg:grid-cols-2">
                      <JsonField label="Breadcrumbs JSON" value={editor.breadcrumbs} onChange={(value) => setEditor({ ...editor, breadcrumbs: value })} />
                      <JsonField label="Structured Data JSON-LD" value={editor.structured_data} onChange={(value) => setEditor({ ...editor, structured_data: value })} />
                      <JsonField label="Image Metadata JSON" value={editor.image_metadata} onChange={(value) => setEditor({ ...editor, image_metadata: value })} />
                      <JsonField label="GEO Metadata JSON" value={editor.geo} onChange={(value) => setEditor({ ...editor, geo: value })} />
                    </div>
                  </TabsContent>
                </Tabs>
              </div>
            )}
          </SurfaceCard>
        </div>
      </div>
    </AdminV2Layout>
  );
}

function BulkFilterToggle({ label, checked, onCheckedChange }: { label: string; checked: boolean; onCheckedChange: (checked: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded-md border border-zinc-200 px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50">
      <Checkbox checked={checked} onCheckedChange={(value) => onCheckedChange(value === true)} />
      <span className="min-w-0 truncate">{label}</span>
    </label>
  );
}

function bulkStageBadge(stage: BulkDraftStage) {
  if (stage === "generating") return <Badge label="Generating" color="#2563EB" small />;
  if (stage === "ready") return <Badge label="Ready" color="#16A34A" small />;
  if (stage === "saving") return <Badge label="Saving" color="#2563EB" small />;
  if (stage === "saved") return <Badge label="Draft saved" color="#D97706" small />;
  if (stage === "publishing") return <Badge label="Approving" color="#2563EB" small />;
  if (stage === "published") return <Badge label="Approved" color="#16A34A" small />;
  return <Badge label="Error" color="#DC2626" small />;
}

function BulkResultCard({
  record,
  result,
  disabled,
  onIncludedChange,
  onEditorChange,
  onSave,
  onPublish,
}: {
  record: SeoDocumentWithRevision;
  result: BulkDraftResult;
  disabled: boolean;
  onIncludedChange: (included: boolean) => void;
  onEditorChange: (update: Partial<SeoEditorState>) => void;
  onSave: () => void;
  onPublish: () => void;
}) {
  const editor = result.editor;
  const isWorking = result.stage === "generating" || result.stage === "saving" || result.stage === "publishing";
  const canApply = !disabled && !isWorking && result.stage !== "error";

  return (
    <div className="rounded-md border border-zinc-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <label className="flex min-w-0 flex-1 cursor-pointer gap-3">
          <Checkbox
            checked={result.included}
            disabled={result.stage === "error" || result.stage === "generating"}
            onCheckedChange={(checked) => onIncludedChange(checked === true)}
            className="mt-1"
          />
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-2">
              <span className="truncate text-sm font-bold text-zinc-900">{displayTitle(record)}</span>
              {bulkStageBadge(result.stage)}
              {result.provider ? (
                <span className="rounded border border-zinc-200 px-1.5 py-0.5 text-[10px] uppercase text-zinc-500">
                  {result.provider === "lovable" ? "Lovable AI" : "OpenAI"}{result.fellBack ? " fallback" : ""}
                </span>
              ) : null}
            </span>
            <span className="mt-1 block truncate text-xs text-zinc-500">{displaySubtitle(record)}</span>
          </span>
        </label>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={onSave} disabled={!canApply}>
            {result.stage === "saving" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Save Draft
          </Button>
          <Button size="sm" onClick={onPublish} disabled={!canApply}>
            {result.stage === "publishing" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
            Approve
          </Button>
        </div>
      </div>

      {result.error ? (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {result.error}
        </div>
      ) : null}

      {result.stage !== "generating" && result.stage !== "error" ? (
        <div className="mt-4 grid gap-4">
          <PreviewPanel record={record} editor={editor} />

          <div className="grid gap-3 lg:grid-cols-2">
            <Field label="Title Tag">
              <Input value={editor.title_tag} onChange={(event) => onEditorChange({ title_tag: event.target.value })} maxLength={80} />
              <p className="mt-1 text-[11px] text-zinc-500">{editor.title_tag.length}/60 target</p>
            </Field>
            <Field label="Canonical Path">
              <Input value={editor.canonical_path} onChange={(event) => onEditorChange({ canonical_path: event.target.value })} />
            </Field>
            <Field label="Meta Description" className="lg:col-span-2">
              <Textarea value={editor.meta_description} onChange={(event) => onEditorChange({ meta_description: event.target.value })} rows={3} />
              <p className="mt-1 text-[11px] text-zinc-500">{editor.meta_description.length}/160 target</p>
            </Field>
            <Field label="Keywords" className="lg:col-span-2">
              <Input value={editor.keywords} onChange={(event) => onEditorChange({ keywords: event.target.value })} />
            </Field>
          </div>

          <details className="rounded-md border border-zinc-200">
            <summary className="cursor-pointer px-3 py-2 text-xs font-semibold uppercase tracking-[0.06em] text-zinc-500">
              Discovery, Sitemap, and JSON Payloads
            </summary>
            <div className="grid gap-4 border-t border-zinc-100 p-3">
              <div className="grid gap-3 lg:grid-cols-[160px_1fr_1fr_120px]">
                <Field label="Indexation">
                  <Select value={editor.indexation_policy} onValueChange={(value) => {
                    const next = value as SeoIndexationPolicy;
                    onEditorChange({
                      indexation_policy: next,
                      robots_directive: next === "noindex" ? "noindex, nofollow" : "index, follow",
                      sitemap_include: next === "index" ? editor.sitemap_include : false,
                    });
                  }}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="index">Index</SelectItem>
                      <SelectItem value="noindex">Noindex</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Robots Directive">
                  <Input value={editor.robots_directive} onChange={(event) => onEditorChange({ robots_directive: event.target.value })} />
                </Field>
                <Field label="Changefreq">
                  <Select value={editor.sitemap_changefreq} onValueChange={(value) => onEditorChange({ sitemap_changefreq: value })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="daily">Daily</SelectItem>
                      <SelectItem value="weekly">Weekly</SelectItem>
                      <SelectItem value="monthly">Monthly</SelectItem>
                      <SelectItem value="yearly">Yearly</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Priority">
                  <Input value={editor.sitemap_priority} onChange={(event) => onEditorChange({ sitemap_priority: event.target.value })} />
                </Field>
              </div>

              <div className="grid gap-3 lg:grid-cols-[160px_1fr]">
                <Field label="Sitemap">
                  <div className="flex h-10 items-center gap-2">
                    <Switch
                      checked={editor.sitemap_include}
                      disabled={editor.indexation_policy === "noindex"}
                      onCheckedChange={(checked) => onEditorChange({ sitemap_include: checked })}
                    />
                    <span className="text-sm text-zinc-600">{editor.sitemap_include ? "Included" : "Excluded"}</span>
                  </div>
                </Field>
                <Field label="Change Summary">
                  <Input value={editor.change_summary} onChange={(event) => onEditorChange({ change_summary: event.target.value })} />
                </Field>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <JsonField label="Breadcrumbs JSON" value={editor.breadcrumbs} onChange={(value) => onEditorChange({ breadcrumbs: value })} />
                <JsonField label="Structured Data JSON-LD" value={editor.structured_data} onChange={(value) => onEditorChange({ structured_data: value })} />
                <JsonField label="Image Metadata JSON" value={editor.image_metadata} onChange={(value) => onEditorChange({ image_metadata: value })} />
                <JsonField label="GEO Metadata JSON" value={editor.geo} onChange={(value) => onEditorChange({ geo: value })} />
              </div>
            </div>
          </details>
        </div>
      ) : null}
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone: "neutral" | "amber" | "blue" | "red" | "green" }) {
  const color = {
    neutral: "text-zinc-900",
    amber: "text-amber-600",
    blue: "text-blue-600",
    red: "text-red-600",
    green: "text-green-600",
  }[tone];

  return (
    <SurfaceCard className="p-3">
      <div className="text-[11px] text-zinc-500">{label}</div>
      <div className={`font-mono text-xl font-bold ${color}`}>{value}</div>
    </SurfaceCard>
  );
}

function PreviewPanel({ record, editor }: { record: SeoDocumentWithRevision; editor: SeoEditorState }) {
  const title = editor.title_tag || displayTitle(record);
  const description = editor.meta_description || "No meta description drafted yet.";
  const url = editor.canonical_path ? `www.kusooishii.com${editor.canonical_path}` : "www.kusooishii.com";
  const geo = useMemo(() => {
    try {
      const parsed = JSON.parse(editor.geo || "{}");
      return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }, [editor.geo]);

  return (
    <div className="grid gap-3 lg:grid-cols-[1.2fr_0.8fr]">
      <div className="rounded-md border border-zinc-200 bg-white p-4">
        <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-zinc-500">Search Preview</div>
        <div className="mt-3 font-mono text-[11px] text-green-700">{url}</div>
        <div className="mt-1 text-[18px] font-semibold leading-snug text-blue-700">{title}</div>
        <p className="mt-1 text-sm leading-5 text-zinc-600">{description}</p>
      </div>
      <div className="rounded-md border border-zinc-200 bg-zinc-50 p-4">
        <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-zinc-500">GEO / Answer Engine Hints</div>
        <div className="mt-3 grid gap-2 text-xs text-zinc-600">
          <PreviewFact label="Entity" value={String(geo.entity_name ?? displayTitle(record))} />
          <PreviewFact label="Audience" value={String(geo.audience ?? "LEGO collectors and resale buyers")} />
          <PreviewFact label="Region" value={String(geo.region ?? "GB")} />
          <PreviewFact label="Intent" value={String(geo.search_intent ?? "commercial investigation")} />
        </div>
      </div>
    </div>
  );
}

function PreviewFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <span className="w-16 shrink-0 font-semibold text-zinc-500">{label}</span>
      <span className="min-w-0 text-zinc-800">{value}</span>
    </div>
  );
}

function Field({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={className}>
      <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.06em] text-zinc-500">{label}</span>
      {children}
    </label>
  );
}

function JsonField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <Field label={label}>
      <Textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={9}
        className="font-mono text-xs"
        spellCheck={false}
      />
    </Field>
  );
}
