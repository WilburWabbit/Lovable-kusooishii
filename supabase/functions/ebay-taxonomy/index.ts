// ============================================================
// eBay Taxonomy
// Wraps eBay Commerce Taxonomy API (v1) for:
//   - category suggestions (autocomplete on title/keywords)
//   - category subtree browsing (drilldown)
//   - item aspects for category (cached into channel_category_schema /
//     channel_category_attribute, then served from DB on subsequent reads)
//
// Routed by `action` field on the JSON body:
//   { action: "suggest", q: "lego star wars" }
//   { action: "subtree", categoryId: "220" }   // top-level if omitted
//   { action: "aspects", categoryId: "19006" }
//
// All actions scope to a single eBay marketplace via the request's
// `marketplace` field (default EBAY_GB → tree id 3).
// ============================================================

import {
  corsHeaders,
  createAdminClient,
  authenticateRequest,
  fetchWithTimeout,
  jsonResponse,
  errorResponse,
} from "../_shared/qbo-helpers.ts";
import { getEbayAccessToken } from "../_shared/ebay-auth.ts";
import {
  buildEbayAspects,
  reconcileWithSchema,
  LEGO_ANCESTOR_IDS,
  type ProductRow,
  type BrickEconomyRow,
} from "../_shared/channel-aspect-map.ts";

const EBAY_API = "https://api.ebay.com";
const ASPECT_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// Marketplace → taxonomy tree id (per eBay docs)
const TREE_IDS: Record<string, string> = {
  EBAY_GB: "3",
  EBAY_US: "0",
  EBAY_DE: "77",
  EBAY_AU: "15",
};

function treeIdFor(marketplace: string): string {
  return TREE_IDS[marketplace] ?? "3";
}

async function ebayFetch(token: string, path: string, marketplace: string) {
  const res = await fetchWithTimeout(`${EBAY_API}${path}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-EBAY-C-MARKETPLACE-ID": marketplace,
      "Accept-Language": "en-GB",
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`eBay Taxonomy [${res.status}]: ${text}`);
  }
  if (res.status === 204) return null;
  const text = await res.text();
  if (!text?.trim()) return null;
  return JSON.parse(text);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const admin = createAdminClient();
    await authenticateRequest(req, admin);

    const body = await req.json();
    const action: string = body.action;
    const marketplace: string = body.marketplace || "EBAY_GB";
    const treeId = treeIdFor(marketplace);

    if (action === "suggest") {
      const q: string = (body.q ?? "").trim();
      if (!q) return jsonResponse({ suggestions: [] });
      const token = await getEbayAccessToken(admin);
      const data = await ebayFetch(
        token,
        `/commerce/taxonomy/v1/category_tree/${treeId}/get_category_suggestions?q=${encodeURIComponent(q)}`,
        marketplace,
      );
      const suggestions = (data?.categorySuggestions ?? []).map((s: any) => ({
        categoryId: s.category?.categoryId,
        categoryName: s.category?.categoryName,
        ancestors: (s.categoryTreeNodeAncestors ?? []).map((a: any) => ({
          id: a.categoryId,
          name: a.categoryName,
        })),
      }));
      return jsonResponse({ suggestions });
    }

    if (action === "subtree") {
      const categoryId: string | undefined = body.categoryId;
      const token = await getEbayAccessToken(admin);
      // Without categoryId → return root children. With → return that node's children.
      const path = categoryId
        ? `/commerce/taxonomy/v1/category_tree/${treeId}/get_category_subtree?category_id=${encodeURIComponent(categoryId)}`
        : `/commerce/taxonomy/v1/category_tree/${treeId}`;
      const data = await ebayFetch(token, path, marketplace);

      // Normalise to a flat list of immediate children
      const root = categoryId
        ? data?.categorySubtreeNode
        : data?.rootCategoryNode;
      const children = (root?.childCategoryTreeNodes ?? []).map((n: any) => ({
        categoryId: n.category?.categoryId,
        categoryName: n.category?.categoryName,
        leaf: n.leafCategoryTreeNode === true || !n.childCategoryTreeNodes?.length,
      }));
      return jsonResponse({
        parent: root?.category
          ? {
              categoryId: root.category.categoryId,
              categoryName: root.category.categoryName,
            }
          : null,
        children,
      });
    }

    if (action === "aspects") {
      const categoryId: string = body.categoryId;
      const force: boolean = body.force === true;
      if (!categoryId) throw new Error("categoryId is required");

      // Check existing cached schema
      const { data: existing } = await admin
        .from("channel_category_schema")
        .select("id, category_name, schema_fetched_at, raw_payload")
        .eq("channel", "ebay")
        .eq("marketplace", marketplace)
        .eq("category_id", categoryId)
        .maybeSingle();

      const cacheFresh =
        !force &&
        existing?.schema_fetched_at &&
        Date.now() - new Date(existing.schema_fetched_at).getTime() < ASPECT_TTL_MS;

      if (cacheFresh && existing?.id) {
        const { data: attrs } = await admin
          .from("channel_category_attribute")
          .select("*")
          .eq("schema_id", existing.id)
          .order("sort_order", { ascending: true });
        return jsonResponse({
          schemaId: existing.id,
          categoryId,
          categoryName: existing.category_name,
          fromCache: true,
          attributes: attrs ?? [],
        });
      }

      // Fetch fresh from eBay
      const token = await getEbayAccessToken(admin);
      const data = await ebayFetch(
        token,
        `/commerce/taxonomy/v1/category_tree/${treeId}/get_item_aspects_for_category?category_id=${encodeURIComponent(categoryId)}`,
        marketplace,
      );

      const aspects: any[] = data?.aspects ?? [];

      // Resolve a category name (best-effort): try suggestions if missing
      let categoryName = existing?.category_name ?? null;
      if (!categoryName) {
        try {
          const sub = await ebayFetch(
            token,
            `/commerce/taxonomy/v1/category_tree/${treeId}/get_category_subtree?category_id=${encodeURIComponent(categoryId)}`,
            marketplace,
          );
          categoryName = sub?.categorySubtreeNode?.category?.categoryName ?? categoryId;
        } catch {
          categoryName = categoryId;
        }
      }

      // Upsert schema row
      const schemaRow = {
        channel: "ebay",
        marketplace,
        category_id: categoryId,
        category_name: categoryName,
        leaf: true,
        raw_payload: data,
        schema_fetched_at: new Date().toISOString(),
      };

      let schemaId: string;
      if (existing?.id) {
        await admin
          .from("channel_category_schema")
          .update(schemaRow)
          .eq("id", existing.id);
        schemaId = existing.id;
        // Wipe old attrs to reflect new schema
        await admin
          .from("channel_category_attribute")
          .delete()
          .eq("schema_id", schemaId);
      } else {
        const { data: inserted, error: insErr } = await admin
          .from("channel_category_schema")
          .insert(schemaRow)
          .select("id")
          .single();
        if (insErr) throw insErr;
        schemaId = inserted.id;
      }

      // Insert attribute rows
      const attrRows = aspects.map((a: any, idx: number) => {
        const constraint = a.aspectConstraint ?? {};
        const values = a.aspectValues ?? null;
        const allowedValues = Array.isArray(values) && values.length > 0
          ? values.map((v: any) => v.localizedValue ?? v.value).filter(Boolean)
          : null;
        const cardinality =
          constraint.itemToAspectCardinality === "MULTI" ? "multi" : "single";
        const dataType = (constraint.aspectDataType ?? "STRING").toLowerCase();
        return {
          schema_id: schemaId,
          key: a.localizedAspectName ?? a.aspectName,
          label: a.localizedAspectName ?? a.aspectName,
          required: constraint.aspectRequired === true,
          cardinality,
          data_type: dataType,
          allowed_values: allowedValues,
          allows_custom: constraint.aspectMode !== "SELECTION_ONLY",
          help_text: null,
          sort_order: idx,
        };
      });

      if (attrRows.length > 0) {
        const { error: attrErr } = await admin
          .from("channel_category_attribute")
          .insert(attrRows);
        if (attrErr) throw attrErr;
      }

      return jsonResponse({
        schemaId,
        categoryId,
        categoryName,
        fromCache: false,
        attributes: attrRows,
      });
    }

    if (action === "auto-resolve-category") {
      // params: { product_id, marketplace? }
      const productId: string = body.product_id;
      if (!productId) throw new Error("product_id is required");

      const { data: product, error: pErr } = await admin
        .from("product")
        .select("id, mpn, name, product_type, theme_id, subtheme_name, ebay_category_id")
        .eq("id", productId)
        .maybeSingle();
      if (pErr) throw pErr;
      if (!product) throw new Error("Product not found");

      let themeName: string | null = null;
      if (product.theme_id) {
        const { data: theme } = await admin
          .from("theme")
          .select("name")
          .eq("id", product.theme_id)
          .maybeSingle();
        themeName = (theme?.name as string | undefined) ?? null;
      }

      const isMinifig = product.product_type === "minifig" || product.product_type === "minifigure";
      const queryParts = [
        "lego",
        themeName,
        product.subtheme_name,
        product.name,
        isMinifig ? "minifigure" : "set",
      ].filter(Boolean) as string[];
      const q = queryParts.join(" ").slice(0, 350);

      const token = await getEbayAccessToken(admin);
      const data = await ebayFetch(
        token,
        `/commerce/taxonomy/v1/category_tree/${treeId}/get_category_suggestions?q=${encodeURIComponent(q)}`,
        marketplace,
      );

      const suggestions = (data?.categorySuggestions ?? []) as any[];
      const legoAncestors = LEGO_ANCESTOR_IDS[marketplace] ?? LEGO_ANCESTOR_IDS["EBAY_GB"];

      // Pick first suggestion under a LEGO ancestor — that's "high" confidence.
      // Fall back to first suggestion overall — "low" confidence.
      let chosen: any = null;
      let confidence: "high" | "medium" | "low" = "low";
      for (const s of suggestions) {
        const ancestors = (s.categoryTreeNodeAncestors ?? []) as any[];
        if (ancestors.some((a) => legoAncestors.has(String(a.categoryId)))) {
          chosen = s;
          confidence = "high";
          break;
        }
      }
      if (!chosen && suggestions.length > 0) {
        chosen = suggestions[0];
        confidence = "low";
      }

      if (!chosen?.category) {
        return jsonResponse({
          categoryId: null,
          categoryName: null,
          confidence: "low",
          basis: `no eBay suggestions for "${q}"`,
        });
      }

      const categoryId = chosen.category.categoryId;
      const categoryName = chosen.category.categoryName;
      const ancestorPath = (chosen.categoryTreeNodeAncestors ?? [])
        .map((a: any) => a.categoryName)
        .reverse()
        .join(" › ");
      const basis = `query="${q}" → ${ancestorPath ? ancestorPath + " › " : ""}${categoryName}`;

      return jsonResponse({
        categoryId,
        categoryName,
        confidence,
        basis,
        ancestors: (chosen.categoryTreeNodeAncestors ?? []).map((a: any) => ({
          id: a.categoryId,
          name: a.categoryName,
        })),
      });
    }

    if (action === "resolve-aspects") {
      // params: { product_id, categoryId, marketplace? }
      const productId: string = body.product_id;
      const categoryId: string = body.categoryId;
      if (!productId || !categoryId) {
        throw new Error("product_id and categoryId are required");
      }

      // 1. Load product, theme, BrickEconomy enrichment, custom-core attributes.
      const { data: product, error: pErr } = await admin
        .from("product")
        .select(
          "id, mpn, name, set_number, subtheme_name, piece_count, age_range, age_mark, ean, " +
          "released_date, retired_date, release_year, weight_kg, weight_g, length_cm, width_cm, " +
          "height_cm, product_type, brand, theme_id"
        )
        .eq("id", productId)
        .maybeSingle();
      if (pErr) throw pErr;
      if (!product) throw new Error("Product not found");

      let themeName: string | null = null;
      if (product.theme_id) {
        const { data: theme } = await admin
          .from("theme")
          .select("name")
          .eq("id", product.theme_id)
          .maybeSingle();
        themeName = (theme?.name as string | undefined) ?? null;
      }

      // BrickEconomy lookup — match either suffixed or bare set number.
      const setNumber = (product as ProductRow).set_number ?? product.mpn?.split(".")[0]?.split("-")[0] ?? null;
      let be: BrickEconomyRow | null = null;
      if (setNumber) {
        const variants = [setNumber, `${setNumber}-1`];
        const { data: beRow } = await admin
          .from("brickeconomy_collection")
          .select("theme, subtheme, pieces_count, year, released_date, retired_date")
          .eq("item_type", "set")
          .in("item_number", variants)
          .order("synced_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (beRow) be = beRow as BrickEconomyRow;
      }

      const { data: customRows } = await admin
        .from("product_attribute")
        .select("key, value, value_json")
        .eq("product_id", productId)
        .eq("namespace", "core");
      const customCore: Record<string, string> = {};
      for (const r of customRows ?? []) {
        if (r.value != null && r.value !== "") customCore[r.key] = r.value;
      }

      // 2. Load cached aspect schema for the category.
      const { data: schemaRow } = await admin
        .from("channel_category_schema")
        .select("id, category_name")
        .eq("channel", "ebay")
        .eq("marketplace", marketplace)
        .eq("category_id", categoryId)
        .maybeSingle();

      let schemaAttrs: { key: string; required: boolean }[] = [];
      if (schemaRow?.id) {
        const { data: attrs } = await admin
          .from("channel_category_attribute")
          .select("key, required")
          .eq("schema_id", schemaRow.id)
          .order("sort_order", { ascending: true });
        schemaAttrs = (attrs ?? []) as { key: string; required: boolean }[];
      }

      // 3. Map and reconcile.
      const allResolved = buildEbayAspects({
        product: product as ProductRow,
        themeName,
        be,
        customCore,
      });
      const { resolved, missing } = reconcileWithSchema(allResolved, schemaAttrs);

      return jsonResponse({
        categoryId,
        categoryName: schemaRow?.category_name ?? null,
        schemaLoaded: schemaAttrs.length > 0,
        resolvedCount: Object.keys(resolved).length,
        totalSchemaCount: schemaAttrs.length,
        missingRequiredCount: missing.filter((m) => m.required).length,
        resolved,
        missing,
      });
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (err) {
    console.error("ebay-taxonomy failed:", err);
    return errorResponse(err);
  }
});
