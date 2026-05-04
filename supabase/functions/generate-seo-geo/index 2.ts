import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";
import { AiProviderError, callChatCompletion } from "../_shared/ai-provider.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SITE_URL = "https://www.kusooishii.com";

const SYSTEM_PROMPT = `You generate app-mastered SEO and GEO metadata for Kuso Oishii, a UK LEGO resale commerce platform.

Business context:
- Kuso Oishii sells graded LEGO sets and minifigures.
- MPNs include version suffixes such as 75367-1. Preserve them exactly.
- The app is the master for content, media, SEO, GEO, pricing, and channel projection.
- Search content should be useful to collectors, honest about resale/graded condition, and written in British English.

Output discipline:
- Return only the requested structured object.
- Do not invent unsupported LEGO facts, minifigures, stock condition, prices, rarity, or availability.
- Public product/content pages should normally be indexable and sitemap-included.
- Private, auth, account, checkout, unsubscribe, order-tracking, and utility pages should remain noindex and excluded from the sitemap.
- Title tag target: 45-60 characters.
- Meta description target: 120-160 characters.
- Keywords: 5-10 concise terms.
- GEO metadata should help answer engines understand the entity, audience, region, search intent, and supported facts.
- Structured data must be JSON-LD-compatible objects or arrays, not Markdown.
- Breadcrumbs must be an array of { name, path } objects.`;

interface SeoDocument {
  id: string;
  document_key: string;
  document_type: string;
  route_path: string | null;
  entity_reference: string | null;
  entity_id: string | null;
  status: string;
  published_revision_id: string | null;
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed.length > 0 ? trimmed : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

async function authenticateAdmin(req: Request, admin: ReturnType<typeof createClient>) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { error: jsonResponse({ error: "Unauthorized" }, 401), userId: null };
  }

  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error: userError } = await admin.auth.getUser(token);
  if (userError || !user) {
    return { error: jsonResponse({ error: "Unauthorized" }, 401), userId: null };
  }

  const { data: roles } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id);

  const hasAccess = (roles ?? []).some(
    (role: { role: string }) => role.role === "admin" || role.role === "staff",
  );

  if (!hasAccess) {
    return { error: jsonResponse({ error: "Forbidden" }, 403), userId: null };
  }

  return { error: null, userId: user.id };
}

function normalizeDraft(raw: Record<string, unknown>, document: SeoDocument, current: Record<string, unknown>) {
  const rawSitemap = asRecord(raw.sitemap);
  const currentSitemap = asRecord(current.sitemap);
  const currentIndexation = current.indexation_policy === "noindex" ? "noindex" : "index";
  const generatedIndexation = raw.indexation_policy === "noindex" ? "noindex" : raw.indexation_policy === "index" ? "index" : currentIndexation;
  const canonicalPath =
    cleanText(raw.canonical_path)
    ?? cleanText(current.canonical_path)
    ?? document.route_path
    ?? (document.entity_reference ? `/sets/${document.entity_reference}` : "/");

  return {
    title_tag: cleanText(raw.title_tag) ?? cleanText(current.title_tag) ?? document.document_key,
    meta_description: cleanText(raw.meta_description) ?? cleanText(current.meta_description) ?? "",
    canonical_path: canonicalPath.startsWith("/") ? canonicalPath : `/${canonicalPath}`,
    indexation_policy: generatedIndexation,
    robots_directive: cleanText(raw.robots_directive)
      ?? (generatedIndexation === "noindex" ? "noindex, nofollow" : "index, follow"),
    sitemap: {
      include: generatedIndexation === "noindex" ? false : Boolean(rawSitemap.include ?? currentSitemap.include ?? true),
      family: cleanText(rawSitemap.family) ?? cleanText(currentSitemap.family) ?? document.document_type,
      changefreq: cleanText(rawSitemap.changefreq) ?? cleanText(currentSitemap.changefreq) ?? (document.document_type === "product" ? "weekly" : "monthly"),
      priority: typeof rawSitemap.priority === "number"
        ? Math.max(0, Math.min(1, Number(rawSitemap.priority.toFixed(1))))
        : typeof currentSitemap.priority === "number"
          ? currentSitemap.priority
          : document.document_type === "product" ? 0.8 : 0.7,
    },
    keywords: Array.isArray(raw.keywords)
      ? raw.keywords.map(cleanText).filter(Boolean).slice(0, 10)
      : [],
    breadcrumbs: Array.isArray(raw.breadcrumbs) ? raw.breadcrumbs : [],
    structured_data: raw.structured_data ?? [],
    image_metadata: asRecord(raw.image_metadata),
    geo: asRecord(raw.geo),
    change_summary: cleanText(raw.change_summary) ?? "Generated SEO/GEO draft using configured AI provider.",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const auth = await authenticateAdmin(req, admin);
    if (auth.error) return auth.error;

    const { seo_document_id, current = {} } = await req.json();
    if (!seo_document_id) throw new Error("seo_document_id is required");

    const { data: document, error: documentError } = await admin
      .from("seo_document")
      .select("id, document_key, document_type, route_path, entity_reference, entity_id, status, published_revision_id")
      .eq("id", seo_document_id)
      .single();
    if (documentError) throw documentError;
    const seoDocument = document as SeoDocument;

    let product: Record<string, unknown> | null = null;
    if (seoDocument.document_type === "product" && seoDocument.entity_reference) {
      const { data: productRow } = await admin
        .from("product")
        .select("id, mpn, name, product_type, lego_theme, lego_subtheme, theme_id, subtheme_name, piece_count, release_year, retired_flag, img_url, seo_title, seo_description, description, product_hook, highlights, call_to_action, status")
        .eq("mpn", seoDocument.entity_reference)
        .maybeSingle();
      product = productRow as Record<string, unknown> | null;
    }

    const canonicalPath =
      cleanText((current as Record<string, unknown>).canonical_path)
      ?? seoDocument.route_path
      ?? (seoDocument.entity_reference ? `/sets/${seoDocument.entity_reference}` : "/");

    const facts = {
      seo_document: seoDocument,
      current,
      canonical_url: `${SITE_URL}${canonicalPath}`,
      product,
    };

    const userPrompt = `Generate a reviewable SEO/GEO draft for this app-mastered SEO document.

Facts JSON:
${JSON.stringify(facts, null, 2)}

For product documents, prioritise the product name, MPN, theme/subtheme, release year, piece count, existing product description, and existing SEO fields when present.
For route/system documents, preserve the route's operational purpose and do not make private utility pages indexable.
Return structured metadata that can be reviewed before publication.`;

    let aiResult;
    try {
      aiResult = await callChatCompletion({
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "generate_seo_geo",
              description: "Return generated SEO/GEO metadata for one app-mastered document.",
              parameters: {
                type: "object",
                properties: {
                  title_tag: { type: "string" },
                  meta_description: { type: "string" },
                  canonical_path: { type: "string" },
                  indexation_policy: { type: "string", enum: ["index", "noindex"] },
                  robots_directive: { type: "string" },
                  sitemap: {
                    type: "object",
                    properties: {
                      include: { type: "boolean" },
                      family: { type: "string" },
                      changefreq: { type: "string", enum: ["daily", "weekly", "monthly", "yearly"] },
                      priority: { type: "number" },
                    },
                    required: ["include", "family", "changefreq", "priority"],
                    additionalProperties: false,
                  },
                  keywords: { type: "array", items: { type: "string" } },
                  breadcrumbs: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        name: { type: "string" },
                        path: { type: "string" },
                      },
                      required: ["name", "path"],
                      additionalProperties: false,
                    },
                  },
                  structured_data: {},
                  image_metadata: {},
                  geo: {},
                  change_summary: { type: "string" },
                },
                required: [
                  "title_tag",
                  "meta_description",
                  "canonical_path",
                  "indexation_policy",
                  "robots_directive",
                  "sitemap",
                  "keywords",
                  "breadcrumbs",
                  "structured_data",
                  "image_metadata",
                  "geo",
                  "change_summary",
                ],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "generate_seo_geo" } },
      }, { admin });
    } catch (e) {
      if (e instanceof AiProviderError) {
        return jsonResponse({ error: e.userMessage }, e.status);
      }
      throw e;
    }

    const data = aiResult.data as {
      choices?: Array<{
        message?: {
          content?: string;
          tool_calls?: Array<{
            function?: {
              arguments?: string | Record<string, unknown>;
            };
          }>;
        };
      }>;
    };
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    let rawDraft: unknown;
    const toolArguments = toolCall?.function?.arguments;
    if (toolArguments) {
      rawDraft = typeof toolArguments === "string"
        ? JSON.parse(toolArguments)
        : toolArguments;
    } else {
      rawDraft = JSON.parse(data.choices?.[0]?.message?.content ?? "{}");
    }

    const draft = normalizeDraft(asRecord(rawDraft), seoDocument, current as Record<string, unknown>);

    return jsonResponse({
      draft,
      provider_used: aiResult.providerUsed,
      model_used: aiResult.modelUsed,
      fell_back: aiResult.fellBack,
    });
  } catch (err) {
    console.error("generate-seo-geo error:", err);
    return jsonResponse({ error: err instanceof Error ? err.message : "Generation failed" }, 500);
  }
});
