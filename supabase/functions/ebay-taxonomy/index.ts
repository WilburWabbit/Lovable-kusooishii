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

    throw new Error(`Unknown action: ${action}`);
  } catch (err) {
    console.error("ebay-taxonomy failed:", err);
    return errorResponse(err);
  }
});
