import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { breadcrumbJsonLd, combineJsonLd } from "@/lib/seo-jsonld";
import { usePageSeo, type PageSeoOptions } from "@/hooks/use-page-seo";

type JsonRecord = Record<string, unknown>;

interface BreadcrumbRecord {
  name: string;
  path: string;
}

interface SeoRevisionRecord {
  id: string;
  canonical_path: string;
  canonical_url: string;
  title_tag: string;
  meta_description: string;
  indexation_policy: "index" | "noindex";
  robots_directive: string;
  open_graph: unknown;
  twitter_card: unknown;
  breadcrumbs: unknown;
  structured_data: unknown;
  image_metadata: unknown;
  sitemap: unknown;
  geo: unknown;
  keywords: string[] | null;
}

interface SeoDocumentRecord {
  id: string;
  published_revision_id: string | null;
}

const SEO_DOCUMENT_STALE_MS = 5 * 60 * 1000;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonRecord(value: unknown): JsonRecord | undefined {
  return isRecord(value) ? value : undefined;
}

function jsonRecordArray(value: unknown): JsonRecord[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (isRecord(value)) return [value];
  return [];
}

function normalizeJsonLd(value: PageSeoOptions["jsonLd"]): JsonRecord[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function schemaTypes(schema: JsonRecord): string[] {
  const value = schema["@type"];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  return [];
}

function breadcrumbRecords(value: unknown): BreadcrumbRecord[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is BreadcrumbRecord => {
    if (!isRecord(item)) return false;
    return typeof item.name === "string" && typeof item.path === "string";
  });
}

function mergeJsonLd(revision: SeoRevisionRecord, fallbackJsonLd: PageSeoOptions["jsonLd"]) {
  const revisionSchemas = jsonRecordArray(revision.structured_data);
  const breadcrumbs = breadcrumbRecords(revision.breadcrumbs);
  const breadcrumbSchema = breadcrumbs.length ? breadcrumbJsonLd(breadcrumbs) : undefined;
  const reservedTypes = new Set<string>();

  for (const schema of revisionSchemas) {
    for (const type of schemaTypes(schema)) reservedTypes.add(type);
  }
  if (breadcrumbSchema) reservedTypes.add("BreadcrumbList");

  const fallbackSchemas = normalizeJsonLd(fallbackJsonLd).filter((schema) => (
    schemaTypes(schema).every((type) => !reservedTypes.has(type))
  ));

  const schemas = combineJsonLd(...revisionSchemas, breadcrumbSchema, ...fallbackSchemas);
  if (schemas.length === 0) return undefined;
  return schemas.length === 1 ? schemas[0] : schemas;
}

function mergeGeo(revisionGeo: unknown, fallbackGeo: PageSeoOptions["geo"]): PageSeoOptions["geo"] {
  const geo = jsonRecord(revisionGeo);
  if (!geo) return fallbackGeo;
  const mapped = {
    region: typeof geo.region === "string" ? geo.region : fallbackGeo?.region,
    placename: typeof geo.placename === "string" ? geo.placename : fallbackGeo?.placename,
    position: typeof geo.position === "string" ? geo.position : fallbackGeo?.position,
  };
  return mapped.region || mapped.placename || mapped.position ? mapped : fallbackGeo;
}

function seoOptionsFromRevision(revision: SeoRevisionRecord, fallback: PageSeoOptions): PageSeoOptions {
  const image = jsonRecord(revision.image_metadata);
  const openGraph = jsonRecord(revision.open_graph);
  const twitter = jsonRecord(revision.twitter_card);
  const robotsDirective = revision.robots_directive.toLowerCase();

  const imageUrl =
    (typeof image?.url === "string" && image.url) ||
    (typeof openGraph?.image === "string" && openGraph.image) ||
    (typeof twitter?.image === "string" && twitter.image) ||
    fallback.imageUrl;

  const imageAlt =
    (typeof image?.alt === "string" && image.alt) ||
    (typeof openGraph?.image_alt === "string" && openGraph.image_alt) ||
    (typeof twitter?.image_alt === "string" && twitter.image_alt) ||
    fallback.imageAlt;

  return {
    ...fallback,
    title: revision.title_tag || fallback.title,
    description: revision.meta_description || fallback.description,
    path: revision.canonical_path || fallback.path,
    noIndex: fallback.noIndex || revision.indexation_policy === "noindex" || robotsDirective.includes("noindex"),
    keywords: revision.keywords?.length ? revision.keywords : fallback.keywords,
    imageUrl,
    imageAlt,
    locale: typeof openGraph?.locale === "string" ? openGraph.locale : fallback.locale,
    geo: mergeGeo(revision.geo, fallback.geo),
    jsonLd: mergeJsonLd(revision, fallback.jsonLd),
  };
}

export function usePublishedSeoDocument(documentKey: string | undefined) {
  return useQuery({
    queryKey: ["seo_document", documentKey],
    enabled: Boolean(documentKey),
    staleTime: SEO_DOCUMENT_STALE_MS,
    retry: false,
    queryFn: async () => {
      const { data: document, error: documentError } = await (supabase as any)
        .from("seo_document")
        .select("id, published_revision_id")
        .eq("document_key", documentKey)
        .eq("status", "published")
        .maybeSingle();

      if (documentError) {
        console.warn("Published SEO document lookup failed", documentError);
        return null;
      }

      const seoDocument = document as SeoDocumentRecord | null;
      if (!seoDocument?.published_revision_id) return null;

      const { data: revision, error: revisionError } = await (supabase as any)
        .from("seo_revision")
        .select("id, canonical_path, canonical_url, title_tag, meta_description, indexation_policy, robots_directive, open_graph, twitter_card, breadcrumbs, structured_data, image_metadata, sitemap, geo, keywords")
        .eq("id", seoDocument.published_revision_id)
        .eq("status", "published")
        .maybeSingle();

      if (revisionError) {
        console.warn("Published SEO revision lookup failed", revisionError);
        return null;
      }

      return (revision ?? null) as SeoRevisionRecord | null;
    },
  });
}

export function useSeoDocumentPageSeo(documentKey: string | undefined, fallback: PageSeoOptions) {
  const { data: revision, isFetching } = usePublishedSeoDocument(documentKey);
  const pageSeo = useMemo(
    () => (revision ? seoOptionsFromRevision(revision, fallback) : fallback),
    [revision, fallback],
  );

  usePageSeo(pageSeo);

  return {
    isFetching,
    pageSeo,
    revision,
  };
}
