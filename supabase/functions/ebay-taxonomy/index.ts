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
import { LEGO_ANCESTOR_IDS } from "../_shared/channel-aspect-map.ts";
import { resolveSpecsForProduct } from "../_shared/specs-resolver.ts";

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

// (Bootstrap routine removed — categories no longer auto-create canonical
//  attributes or mappings on first read. All mapping is explicit via the
//  Channel Mappings settings page.)


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

        // Idempotent bootstrap on cached schema reads too — ensures any
        // categories whose schema was loaded before bootstrap was wired up
        // (or whose mappings were wiped) get repaired automatically.
        try {
          await bootstrapCanonicalForCategory(admin, {
            marketplace,
            categoryId,
            aspects: (attrs ?? []) as any[],
          });
        } catch (bootErr) {
          console.error("bootstrap canonical (cached) failed:", bootErr);
        }

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

      // Bootstrap canonical attributes + mappings for every aspect of this
      // category that doesn't already have one. This ensures newly added
      // categories produce editable Specifications fields with no manual setup.
      try {
        await bootstrapCanonicalForCategory(admin, {
          marketplace,
          categoryId,
          aspects: attrRows,
        });
      } catch (bootErr) {
        console.error("bootstrap canonical failed (non-fatal):", bootErr);
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

      // Find the cached schema for the chosen category (if any) FIRST so we
      // can run an idempotent bootstrap for any aspects that don't yet have
      // a canonical attribute / mapping. This is what makes the bottom-of-
      // tab eBay aspects appear as editable canonical fields the next time
      // around.
      const { data: schemaRow } = await admin
        .from("channel_category_schema")
        .select("id, category_name")
        .eq("channel", "ebay")
        .eq("marketplace", marketplace)
        .eq("category_id", categoryId)
        .maybeSingle();

      if (schemaRow?.id) {
        const { data: schemaAttrs } = await admin
          .from("channel_category_attribute")
          .select("key, label, data_type, required")
          .eq("schema_id", schemaRow.id);
        try {
          await bootstrapCanonicalForCategory(admin, {
            marketplace,
            categoryId,
            aspects: (schemaAttrs ?? []) as any[],
          });
        } catch (bootErr) {
          console.error("bootstrap canonical (resolve) failed:", bootErr);
        }
      }

      // Now resolve every canonical attribute for this product, scoped by
      // its product_type and the chosen eBay category. The bootstrap above
      // means newly-created scoped canonicals appear in this resolution.
      const { resolved, byKey } = await resolveAllForProduct(admin, productId, {
        ebayCategoryId: categoryId,
      });

      // Project canonical → channel aspects via the mapping table.
      const projection = await projectToChannel(admin, {
        channel: "ebay",
        marketplace,
        categoryId,
        schemaId: schemaRow?.id ?? null,
        canonicalByKey: byKey,
      });

      return jsonResponse({
        categoryId,
        categoryName: schemaRow?.category_name ?? null,
        schemaLoaded: projection.totalSchemaCount > 0,
        resolvedCount: projection.resolvedCount,
        totalSchemaCount: projection.totalSchemaCount,
        missingRequiredCount: projection.missingRequiredCount,
        canonical: resolved,
        aspects: projection.mapped,
      });
    }

    if (action === "list-canonical-attributes") {
      const { data, error } = await admin
        .from("canonical_attribute")
        .select("*")
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return jsonResponse({ attributes: data ?? [] });
    }

    if (action === "upsert-canonical-attribute") {
      const row = body.attribute;
      if (!row?.key || !row?.label) throw new Error("key and label are required");

      // Auto-create product column for editable attributes that need a write target.
      // If db_column is omitted but the attribute is editable, default it to the key.
      let columnInfo: { created: boolean; column: string; sql_type: string } | null = null;
      if (row.editable && !row.db_column) {
        row.db_column = row.key;
      }
      if (row.db_column) {
        const { data: ensured, error: ensureErr } = await (admin as any).rpc(
          "ensure_product_column",
          { p_column_name: row.db_column, p_data_type: row.data_type ?? "string" },
        );
        if (ensureErr) throw new Error(`Failed to ensure column: ${ensureErr.message}`);
        columnInfo = ensured as typeof columnInfo;
      }

      const { error } = await admin
        .from("canonical_attribute")
        .upsert(row, { onConflict: "key" });
      if (error) throw error;
      return jsonResponse({ success: true, column: columnInfo });
    }

    if (action === "delete-canonical-attribute") {
      const key: string = body.key;
      if (!key) throw new Error("key is required");
      const { error } = await admin
        .from("canonical_attribute")
        .delete()
        .eq("key", key);
      if (error) throw error;
      return jsonResponse({ success: true });
    }

    if (action === "list-channel-mappings") {
      // params: { channel, marketplace?, categoryId? }
      const ch: string = body.channel ?? "ebay";
      let q = admin
        .from("channel_attribute_mapping")
        .select("*")
        .eq("channel", ch)
        .order("aspect_key", { ascending: true });
      if (body.marketplace) {
        q = q.or(`marketplace.eq.${body.marketplace},marketplace.is.null`);
      }
      if (body.categoryId !== undefined) {
        if (body.categoryId === null) {
          q = q.is("category_id", null);
        } else {
          q = q.or(`category_id.eq.${body.categoryId},category_id.is.null`);
        }
      }
      const { data, error } = await q;
      if (error) throw error;
      return jsonResponse({ mappings: data ?? [] });
    }

    if (action === "upsert-channel-mapping") {
      const row = body.mapping;
      if (!row?.channel || !row?.aspect_key) {
        throw new Error("channel and aspect_key are required");
      }
      if (!row.canonical_key && !row.constant_value) {
        throw new Error("Either canonical_key or constant_value must be set");
      }
      // Use a delete-then-insert to honour the partial unique index that
      // includes COALESCE(...) — Postgres ON CONFLICT can't target it.
      await admin
        .from("channel_attribute_mapping")
        .delete()
        .eq("channel", row.channel)
        .eq("aspect_key", row.aspect_key)
        .eq("marketplace", row.marketplace ?? null)
        .eq("category_id", row.category_id ?? null);
      const { error } = await admin.from("channel_attribute_mapping").insert(row);
      if (error) throw error;
      return jsonResponse({ success: true });
    }

    if (action === "delete-channel-mapping") {
      const id: string = body.id;
      if (!id) throw new Error("id is required");
      const { error } = await admin
        .from("channel_attribute_mapping")
        .delete()
        .eq("id", id);
      if (error) throw error;
      return jsonResponse({ success: true });
    }

    if (action === "list-product-categories") {
      // Returns the distinct channel category IDs already assigned to one
      // or more products, with usage counts and a friendly name pulled
      // from channel_category_schema (if cached).
      const channel = (body.channel as string) ?? "ebay";
      const marketplace = (body.marketplace as string) ?? "EBAY_GB";
      const column =
        channel === "ebay"
          ? "ebay_category_id"
          : channel === "gmc"
            ? "gmc_product_category"
            : "meta_category";

      const { data: rows, error } = await admin
        .from("product")
        .select(`${column}`)
        .not(column, "is", null);
      if (error) throw error;

      const counts = new Map<string, number>();
      for (const r of (rows ?? []) as Record<string, unknown>[]) {
        const id = r[column] as string | null;
        if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
      }

      const ids = [...counts.keys()];
      const names = new Map<string, string>();
      if (ids.length > 0 && channel === "ebay") {
        const { data: schemaRows } = await admin
          .from("channel_category_schema")
          .select("category_id, category_name")
          .eq("channel", "ebay")
          .eq("marketplace", marketplace)
          .in("category_id", ids);
        for (const r of (schemaRows ?? []) as Record<string, unknown>[]) {
          names.set(r.category_id as string, r.category_name as string);
        }
      }

      const categories = ids
        .map((id) => ({
          categoryId: id,
          categoryName: names.get(id) ?? null,
          productCount: counts.get(id) ?? 0,
        }))
        .sort((a, b) => b.productCount - a.productCount);

      return jsonResponse({ categories });
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (err) {
    console.error("ebay-taxonomy failed:", err);
    return errorResponse(err);
  }
});
