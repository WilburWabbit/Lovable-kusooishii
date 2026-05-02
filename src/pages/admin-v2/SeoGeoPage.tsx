import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, FileSearch, Save } from "lucide-react";
import { toast } from "sonner";
import { AdminV2Layout } from "@/components/admin-v2/AdminV2Layout";
import { Badge, SectionHead, SurfaceCard } from "@/components/admin-v2/ui-primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { absoluteUrl } from "@/lib/seo-jsonld";

type SeoDocumentType = "route" | "product" | "theme" | "collection" | "system";
type SeoIndexationPolicy = "index" | "noindex";

interface SeoDocumentRow {
  id: string;
  document_key: string;
  document_type: SeoDocumentType;
  route_path: string | null;
  entity_reference: string | null;
  status: string;
  published_revision_id: string | null;
  updated_at: string;
}

interface SeoRevisionRow {
  id: string;
  seo_document_id: string;
  revision_number: number;
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

interface SeoDocumentWithRevision extends SeoDocumentRow {
  revision: SeoRevisionRow | null;
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

const JSON_PLACEHOLDER = "[]";
const OBJECT_PLACEHOLDER = "{}";

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
    title_tag: revision?.title_tag ?? "",
    meta_description: revision?.meta_description ?? "",
    canonical_path: revision?.canonical_path ?? record.route_path ?? "",
    indexation_policy: revision?.indexation_policy ?? "index",
    robots_directive: revision?.robots_directive ?? "index, follow",
    sitemap_include: revision?.sitemap?.include ?? false,
    sitemap_family: revision?.sitemap?.family ?? record.document_type,
    sitemap_changefreq: revision?.sitemap?.changefreq ?? "monthly",
    sitemap_priority: String(revision?.sitemap?.priority ?? (record.document_type === "product" ? 0.8 : 0.7)),
    keywords: revision?.keywords?.join(", ") ?? "",
    breadcrumbs: formatJson(revision?.breadcrumbs, JSON_PLACEHOLDER),
    structured_data: formatJson(revision?.structured_data, JSON_PLACEHOLDER),
    image_metadata: formatJson(revision?.image_metadata, OBJECT_PLACEHOLDER),
    geo: formatJson(revision?.geo, OBJECT_PLACEHOLDER),
    change_summary: "",
  };
}

function priorityFromInput(value: string) {
  const priority = Number.parseFloat(value);
  if (!Number.isFinite(priority) || priority < 0 || priority > 1) {
    throw new Error("Sitemap priority must be a number between 0 and 1");
  }
  return Number(priority.toFixed(1));
}

function statusBadge(record: SeoDocumentWithRevision) {
  if (record.revision?.indexation_policy === "noindex") return <Badge label="Noindex" color="#DC2626" small />;
  if (record.revision?.sitemap?.include) return <Badge label="Indexable" color="#16A34A" small />;
  return <Badge label="Hidden" color="#71717A" small />;
}

async function fetchSeoDocuments(): Promise<SeoDocumentWithRevision[]> {
  const { data: documents, error: documentsError } = await (supabase as any)
    .from("seo_document")
    .select("id, document_key, document_type, route_path, entity_reference, status, published_revision_id, updated_at")
    .order("document_type", { ascending: true })
    .order("document_key", { ascending: true });

  if (documentsError) throw documentsError;

  const rows = (documents ?? []) as SeoDocumentRow[];
  const revisionIds = rows
    .map((row) => row.published_revision_id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);

  if (!revisionIds.length) {
    return rows.map((row) => ({ ...row, revision: null }));
  }

  const { data: revisions, error: revisionsError } = await (supabase as any)
    .from("seo_revision")
    .select("id, seo_document_id, revision_number, canonical_path, canonical_url, title_tag, meta_description, indexation_policy, robots_directive, open_graph, twitter_card, breadcrumbs, structured_data, image_metadata, sitemap, geo, keywords, source, change_summary, published_at, created_at")
    .in("id", revisionIds);

  if (revisionsError) throw revisionsError;

  const revisionsById = new Map<string, SeoRevisionRow>(
    ((revisions ?? []) as SeoRevisionRow[]).map((revision) => [revision.id, revision]),
  );
  return rows.map((row) => ({
    ...row,
    revision: row.published_revision_id ? revisionsById.get(row.published_revision_id) ?? null : null,
  })) as SeoDocumentWithRevision[];
}

async function publishSeoRevision(record: SeoDocumentWithRevision, state: SeoEditorState) {
  const currentRevision = record.revision;
  const revisionNumber = (currentRevision?.revision_number ?? 0) + 1;
  const canonicalPath = state.canonical_path.trim();
  if (!canonicalPath.startsWith("/")) throw new Error("Canonical path must start with /");
  if (!state.title_tag.trim()) throw new Error("Title tag is required");
  if (!state.meta_description.trim()) throw new Error("Meta description is required");

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
  const { data: revision, error: revisionError } = await (supabase as any)
    .from("seo_revision")
    .insert({
      seo_document_id: record.id,
      revision_number: revisionNumber,
      status: "published",
      canonical_path: canonicalPath,
      canonical_url: canonicalUrl,
      title_tag: state.title_tag.trim(),
      meta_description: state.meta_description.trim(),
      indexation_policy: state.indexation_policy,
      robots_directive: state.robots_directive.trim() || (state.indexation_policy === "noindex" ? "noindex, nofollow" : "index, follow"),
      open_graph: {
        ...(currentRevision?.open_graph ?? {}),
        title: state.title_tag.trim(),
        description: state.meta_description.trim(),
        url: canonicalUrl,
      },
      twitter_card: {
        ...(currentRevision?.twitter_card ?? {}),
        title: state.title_tag.trim(),
        description: state.meta_description.trim(),
      },
      breadcrumbs: breadcrumbs,
      structured_data: structuredData,
      image_metadata: imageMetadata,
      sitemap,
      geo,
      keywords,
      source: "admin_ui",
      change_summary: state.change_summary.trim() || "Published from SEO/GEO admin.",
      published_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (revisionError) throw revisionError;

  const { error: documentError } = await (supabase as any)
    .from("seo_document")
    .update({
      status: "published",
      published_revision_id: revision.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", record.id);

  if (documentError) throw documentError;
}

export default function SeoGeoPage() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<SeoDocumentType | "all">("all");
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState<SeoEditorState | null>(null);

  const { data = [], isLoading, error } = useQuery({
    queryKey: ["admin", "seo-documents"],
    queryFn: fetchSeoDocuments,
    retry: false,
  });

  const selected = data.find((record) => record.id === selectedId) ?? data[0] ?? null;

  useEffect(() => {
    if (selected && selected.id !== selectedId) setSelectedId(selected.id);
  }, [selected, selectedId]);

  useEffect(() => {
    if (selected) setEditor(editorStateFromRecord(selected));
  }, [selected?.id, selected?.published_revision_id]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return data.filter((record) => {
      if (typeFilter !== "all" && record.document_type !== typeFilter) return false;
      if (!needle) return true;
      return [
        record.document_key,
        record.route_path,
        record.entity_reference,
        record.revision?.title_tag,
        record.revision?.canonical_path,
      ].some((value) => value?.toLowerCase().includes(needle));
    });
  }, [data, query, typeFilter]);

  const publish = useMutation({
    mutationFn: async () => {
      if (!selected || !editor) throw new Error("Select an SEO document first");
      await publishSeoRevision(selected, editor);
    },
    onSuccess: async () => {
      toast.success("SEO/GEO revision published");
      await queryClient.invalidateQueries({ queryKey: ["admin", "seo-documents"] });
      await queryClient.invalidateQueries({ queryKey: ["seo_document"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Publish failed"),
  });

  const indexableCount = data.filter((record) => record.revision?.indexation_policy === "index").length;
  const noindexCount = data.filter((record) => record.revision?.indexation_policy === "noindex").length;
  const sitemapCount = data.filter((record) => record.revision?.sitemap?.include === true).length;

  return (
    <AdminV2Layout>
      <div className="mx-auto grid max-w-[1500px] gap-5">
        <div>
          <div className="flex items-center gap-2">
            <FileSearch className="h-5 w-5 text-amber-600" />
            <h1 className="text-[20px] font-bold text-zinc-900">SEO/GEO Content</h1>
          </div>
          <p className="mt-1 max-w-3xl text-[12px] text-zinc-500">
            Master canonical metadata, indexation, sitemap inclusion, breadcrumbs, and structured-data payloads as published SEO revisions.
          </p>
        </div>

        {error ? (
          <SurfaceCard>
            <p className="text-sm font-medium text-destructive">SEO/GEO records are not available.</p>
            <p className="mt-1 text-xs text-zinc-500">
              Apply the `seo_document` migration, then reload this page.
            </p>
          </SurfaceCard>
        ) : null}

        <div className="grid grid-cols-3 gap-3 lg:w-[520px]">
          <SurfaceCard className="p-3">
            <div className="text-[11px] text-zinc-500">Indexable</div>
            <div className="font-mono text-xl font-bold text-green-600">{indexableCount}</div>
          </SurfaceCard>
          <SurfaceCard className="p-3">
            <div className="text-[11px] text-zinc-500">Noindex</div>
            <div className="font-mono text-xl font-bold text-red-600">{noindexCount}</div>
          </SurfaceCard>
          <SurfaceCard className="p-3">
            <div className="text-[11px] text-zinc-500">In Sitemap</div>
            <div className="font-mono text-xl font-bold text-zinc-900">{sitemapCount}</div>
          </SurfaceCard>
        </div>

        <div className="grid gap-5 xl:grid-cols-[430px_1fr]">
          <SurfaceCard className="min-h-[640px]" noPadding>
            <div className="border-b border-zinc-200 p-4">
              <SectionHead>Documents</SectionHead>
              <div className="grid gap-2">
                <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search key, path, title…" />
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
              </div>
            </div>

            <div className="max-h-[560px] overflow-auto">
              {isLoading ? <div className="p-4 text-sm text-zinc-500">Loading SEO documents…</div> : null}
              {filtered.map((record) => (
                <button
                  key={record.id}
                  type="button"
                  onClick={() => setSelectedId(record.id)}
                  className={`block w-full border-b border-zinc-100 px-4 py-3 text-left transition-colors ${
                    selected?.id === record.id ? "bg-amber-50" : "hover:bg-zinc-50"
                  }`}
                >
                  <div className="mb-1 flex items-center gap-2">
                    <span className="font-mono text-[11px] uppercase text-zinc-500">{record.document_type}</span>
                    {statusBadge(record)}
                  </div>
                  <div className="truncate text-[13px] font-semibold text-zinc-900">
                    {record.revision?.title_tag || record.document_key}
                  </div>
                  <div className="mt-1 truncate font-mono text-[11px] text-zinc-500">
                    {record.revision?.canonical_path ?? record.route_path ?? record.entity_reference ?? record.document_key}
                  </div>
                </button>
              ))}
              {!isLoading && filtered.length === 0 ? (
                <div className="p-4 text-sm text-zinc-500">No SEO documents match this filter.</div>
              ) : null}
            </div>
          </SurfaceCard>

          <SurfaceCard>
            {!selected || !editor ? (
              <div className="text-sm text-zinc-500">Select a document to edit.</div>
            ) : (
              <div className="grid gap-5">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-200 pb-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-base font-bold text-zinc-900">{selected.document_key}</h2>
                      {statusBadge(selected)}
                    </div>
                    <p className="mt-1 text-xs text-zinc-500">
                      Published revision {selected.revision?.revision_number ?? "none"} · {selected.revision?.source ?? "unpublished"}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {editor.canonical_path ? (
                      <Button variant="outline" size="sm" asChild>
                        <a href={editor.canonical_path} target="_blank" rel="noreferrer">
                          <ExternalLink className="mr-2 h-4 w-4" /> View
                        </a>
                      </Button>
                    ) : null}
                    <Button size="sm" onClick={() => publish.mutate()} disabled={publish.isPending}>
                      <Save className="mr-2 h-4 w-4" /> {publish.isPending ? "Publishing…" : "Publish Revision"}
                    </Button>
                  </div>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <Field label="Title Tag">
                    <Input value={editor.title_tag} onChange={(event) => setEditor({ ...editor, title_tag: event.target.value })} maxLength={80} />
                    <p className="mt-1 text-[11px] text-zinc-500">{editor.title_tag.length}/60 target</p>
                  </Field>
                  <Field label="Canonical Path">
                    <Input value={editor.canonical_path} onChange={(event) => setEditor({ ...editor, canonical_path: event.target.value })} />
                  </Field>
                  <Field label="Meta Description" className="lg:col-span-2">
                    <Textarea value={editor.meta_description} onChange={(event) => setEditor({ ...editor, meta_description: event.target.value })} rows={3} />
                    <p className="mt-1 text-[11px] text-zinc-500">{editor.meta_description.length}/160 target</p>
                  </Field>
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

                <Field label="Keywords">
                  <Input value={editor.keywords} onChange={(event) => setEditor({ ...editor, keywords: event.target.value })} placeholder="comma, separated, terms" />
                </Field>

                <div className="grid gap-4 lg:grid-cols-2">
                  <JsonField label="Breadcrumbs JSON" value={editor.breadcrumbs} onChange={(value) => setEditor({ ...editor, breadcrumbs: value })} />
                  <JsonField label="Structured Data JSON-LD" value={editor.structured_data} onChange={(value) => setEditor({ ...editor, structured_data: value })} />
                  <JsonField label="Image Metadata JSON" value={editor.image_metadata} onChange={(value) => setEditor({ ...editor, image_metadata: value })} />
                  <JsonField label="GEO Metadata JSON" value={editor.geo} onChange={(value) => setEditor({ ...editor, geo: value })} />
                </div>

                <Field label="Change Summary">
                  <Input value={editor.change_summary} onChange={(event) => setEditor({ ...editor, change_summary: event.target.value })} placeholder="What changed and why?" />
                </Field>
              </div>
            )}
          </SurfaceCard>
        </div>
      </div>
    </AdminV2Layout>
  );
}

function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
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
