// Redeployed: 2026-03-23
// ============================================================
// eBay Push Listing
// Creates or updates an eBay listing from channel_listing data.
// Uses eBay Inventory API (sell_inventory_v1):
//   1. PUT inventory_item/{sku}  — create/update inventory item
//   2. POST/PUT offer            — create/update offer
//   3. POST offer/{id}/publish   — publish the offer
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

const EBAY_API = "https://api.ebay.com";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const admin = createAdminClient();
    await authenticateRequest(req, admin);

    // Validate required eBay marketplace policy env vars up front so the
    // user gets a clear message rather than an opaque 400 from eBay later.
    const fulfillmentPolicyId = Deno.env.get("EBAY_FULFILLMENT_POLICY_ID");
    const paymentPolicyId = Deno.env.get("EBAY_PAYMENT_POLICY_ID");
    const returnPolicyId = Deno.env.get("EBAY_RETURN_POLICY_ID");
    const merchantLocationKey = Deno.env.get("EBAY_LOCATION_KEY");
    const missingEnv = [
      ["EBAY_FULFILLMENT_POLICY_ID", fulfillmentPolicyId],
      ["EBAY_PAYMENT_POLICY_ID", paymentPolicyId],
      ["EBAY_RETURN_POLICY_ID", returnPolicyId],
      ["EBAY_LOCATION_KEY", merchantLocationKey],
    ].filter(([, v]) => !v).map(([k]) => k);
    if (missingEnv.length > 0) {
      throw new Error(
        `eBay listing policies are not configured. Missing secrets: ${missingEnv.join(", ")}. ` +
          `Add them in Settings before publishing.`,
      );
    }

    const { listingId, skuCode } = await req.json();
    if (!listingId) throw new Error("listingId is required");

    // Fetch listing + SKU + product data
    const { data: listing, error: listErr } = await admin
      .from("channel_listing")
      .select("*")
      .eq("id", listingId)
      .single();

    if (listErr || !listing) throw new Error(`Listing not found: ${listingId}`);

    const l = listing as Record<string, unknown>;

    // Fetch SKU + product for pricing/aspects.
    // NOTE: product table has columns mpn / name / description / ean / product_hook only.
    // There is no `upc` column, and the hook column is `product_hook` (not `hook`).
    const { data: sku, error: skuErr } = await admin
      .from("sku")
      .select("*, product:product_id(mpn, name, description, ean, product_hook)")
      .eq("id", l.sku_id)
      .single();
    if (skuErr) throw new Error(`SKU lookup failed: ${skuErr.message}`);

    const skuRow = sku as Record<string, unknown> | null;
    const product = skuRow?.product as Record<string, unknown> | null;
    const effectiveSku = skuCode ?? (skuRow?.sku_code as string);

    if (!effectiveSku) throw new Error("Could not determine SKU code");

    // Count on-hand stock for this SKU
    const { count: onHandCount } = await admin
      .from("stock_unit")
      .select("id", { count: "exact", head: true })
      .eq("sku_id", skuRow?.id as string)
      .in("v2_status", ["graded", "listed"]);

    // ─── Look up product images (required by eBay) ─────────
    // eBay rejects publish with errorId 25002 ("Add at least 1 photo")
    // when no imageUrls are present on the inventory item.
    const productId = (skuRow?.product_id ?? null) as string | null;
    const imageUrls: string[] = [];
    if (productId) {
      const { data: mediaRows } = await admin
        .from("product_media")
        .select("sort_order, is_primary, media_asset:media_asset_id(original_url)")
        .eq("product_id", productId)
        .order("is_primary", { ascending: false })
        .order("sort_order", { ascending: true });
      for (const row of (mediaRows ?? []) as Array<Record<string, unknown>>) {
        const asset = row.media_asset as { original_url?: string } | null;
        const url = asset?.original_url;
        if (typeof url === "string" && url.startsWith("https://")) {
          imageUrls.push(url);
        }
      }
    }
    if (imageUrls.length === 0) {
      throw new Error(
        `Cannot publish ${effectiveSku} to eBay: no product images uploaded. ` +
          `Add at least one image in the Copy & Media tab before listing.`,
      );
    }
    // eBay caps imageUrls at 24 per inventory item.
    const cappedImages = imageUrls.slice(0, 24);

    // ─── Get eBay access token ─────────────────────────────
    const accessToken = await getEbayAccessToken(admin);

    // ─── Resolve eBay category + aspects from DB ───────────
    // Read product's selected category. Without one, fall back to the legacy
    // hardcoded LEGO Building Toys category so existing flows don't break,
    // but warn so we know to migrate older products.
    const { data: productRow } = await admin
      .from("product")
      .select("id, ebay_category_id, ebay_marketplace")
      .eq("id", productId as string)
      .maybeSingle();

    const ebayCategoryId =
      (productRow?.ebay_category_id as string | null) ?? "19006";
    const marketplace =
      (productRow?.ebay_marketplace as string | null) ?? "EBAY_GB";

    // Build aspects: start with sensible defaults from intrinsic columns,
    // then layer DB-stored namespace='ebay' attributes on top, then
    // mapped 'core' namespace attributes (Brand, MPN, EAN, etc.).
    const aspects: Record<string, string[]> = {};
    const setAspect = (key: string, value: unknown) => {
      if (value == null) return;
      if (Array.isArray(value)) {
        const arr = value.map((v) => String(v)).filter((v) => v.trim() !== "");
        if (arr.length > 0) aspects[key] = arr;
      } else {
        const v = String(value).trim();
        if (v) aspects[key] = [v];
      }
    };

    // Defaults pulled from product columns
    setAspect("Brand", "LEGO");
    setAspect("MPN", product?.mpn);

    // Pull stored attributes for this product
    if (productId) {
      const { data: attrRows } = await admin
        .from("product_attribute")
        .select("namespace, key, value, value_json")
        .eq("product_id", productId)
        .in("namespace", ["core", "ebay"]);

      // Apply 'core' first (lower priority)
      for (const row of (attrRows ?? []) as Array<Record<string, unknown>>) {
        if (row.namespace !== "core") continue;
        const key = mapCoreToEbayAspect(row.key as string);
        if (!key) continue;
        setAspect(key, row.value_json ?? row.value);
      }
      // Then 'ebay' (highest priority — overrides core mapping)
      for (const row of (attrRows ?? []) as Array<Record<string, unknown>>) {
        if (row.namespace !== "ebay") continue;
        setAspect(row.key as string, row.value_json ?? row.value);
      }
    }

    // Validate required aspects against cached schema if we have one
    const { data: schemaRow } = await admin
      .from("channel_category_schema")
      .select("id")
      .eq("channel", "ebay")
      .eq("marketplace", marketplace)
      .eq("category_id", ebayCategoryId)
      .maybeSingle();
    if (schemaRow?.id) {
      const { data: requiredAttrs } = await admin
        .from("channel_category_attribute")
        .select("key, label")
        .eq("schema_id", schemaRow.id)
        .eq("required", true);
      const missing = (requiredAttrs ?? [])
        .filter((a: any) => !aspects[a.key as string]?.length)
        .map((a: any) => a.label ?? a.key);
      if (missing.length > 0) {
        throw new Error(
          `Cannot publish ${effectiveSku} to eBay: missing required aspects — ${missing.join(", ")}. ` +
            `Set them in the Specifications tab.`,
        );
      }
    }

    // ─── Step 1: Create/Update Inventory Item ──────────────
    const inventoryItemPayload = {
      product: {
        title: (l.listing_title as string) ?? (product?.name as string) ?? effectiveSku,
        description: (l.listing_description as string) ?? (product?.description as string) ?? "",
        aspects,
        imageUrls: cappedImages,
        ...(product?.ean ? { ean: [product.ean] } : {}),
      },
      condition: mapGradeToEbayCondition(skuRow?.condition_grade as string),
      availability: {
        shipToLocationAvailability: {
          quantity: onHandCount ?? 1,
        },
      },
    };

    const inventoryRes = await ebayFetch(
      accessToken,
      `/sell/inventory/v1/inventory_item/${encodeURIComponent(effectiveSku)}`,
      {
        method: "PUT",
        body: JSON.stringify(inventoryItemPayload),
      },
    );

    console.log(`eBay inventory item PUT for ${effectiveSku}: ${inventoryRes ? "updated" : "created"}`);

    // ─── Step 2: Create or Update Offer ────────────────────
    // The offer ID lives in `external_listing_id` on channel_listing.
    // (There is no `external_id` column — older code referenced a
    // non-existent column and silently no-op'd both reads and writes.)
    const existingExternalId = l.external_listing_id as string | null;
    let offerId: string;

    const offerPayload = {
      sku: effectiveSku,
      marketplaceId: marketplace,
      format: "FIXED_PRICE",
      availableQuantity: onHandCount ?? 1,
      categoryId: ebayCategoryId,
      listingDescription: (l.listing_description as string) ?? (product?.description as string) ?? "",
      pricingSummary: {
        price: {
          value: String((l.listed_price as number) ?? 0),
          currency: "GBP",
        },
      },
      listingPolicies: {
        fulfillmentPolicyId,
        paymentPolicyId,
        returnPolicyId,
      },
      merchantLocationKey,
    };

    if (existingExternalId) {
      // Update existing offer
      await ebayFetch(
        accessToken,
        `/sell/inventory/v1/offer/${existingExternalId}`,
        {
          method: "PUT",
          body: JSON.stringify(offerPayload),
        },
      );
      offerId = existingExternalId;
      console.log(`eBay offer updated: ${offerId}`);
    } else {
      // Create new offer
      try {
        const offerRes = await ebayFetch(
          accessToken,
          `/sell/inventory/v1/offer`,
          {
            method: "POST",
            body: JSON.stringify(offerPayload),
          },
        );
        offerId = offerRes?.offerId;
        if (!offerId) throw new Error("eBay offer creation did not return offerId");
        console.log(`eBay offer created: ${offerId}`);
      } catch (createErr) {
        // Recovery: eBay already has an offer for this SKU but our local
        // channel_listing.external_listing_id was cleared (or never saved
        // because a previous publish failed before step 4). eBay returns
        // errorId 25002 with message "Offer entity already exists" and
        // includes the existing offerId in the parameters array. Adopt
        // that offerId and PUT to update the existing offer instead.
        const errMsg = createErr instanceof Error ? createErr.message : String(createErr);
        const recoveredOfferId = extractExistingOfferId(errMsg);
        if (!recoveredOfferId) throw createErr;
        console.log(
          `eBay offer already exists for ${effectiveSku} — adopting existing offerId ${recoveredOfferId} and updating`,
        );
        await ebayFetch(
          accessToken,
          `/sell/inventory/v1/offer/${recoveredOfferId}`,
          {
            method: "PUT",
            body: JSON.stringify(offerPayload),
          },
        );
        offerId = recoveredOfferId;
      }
    }

    // ─── Step 3: Publish the offer ─────────────────────────
    let listingItemId: string | null = null;
    try {
      const publishRes = await ebayFetch(
        accessToken,
        `/sell/inventory/v1/offer/${offerId}/publish`,
        { method: "POST" },
      );
      listingItemId = publishRes?.listingId ?? null;
      console.log(`eBay offer published: listing ${listingItemId}`);
    } catch (pubErr) {
      // Only swallow the actual "already published" condition. eBay's
      // errorId 25002 is a generic user-input bucket that ALSO covers
      // missing photos, missing aspects, invalid price, etc — matching
      // the bare code previously caused real validation failures to be
      // reported as success.
      const errMsg = pubErr instanceof Error ? pubErr.message : String(pubErr);
      const isAlreadyPublished =
        errMsg.includes("[409]") ||
        /already\s+published/i.test(errMsg) ||
        /offer.*already.*active/i.test(errMsg);
      if (isAlreadyPublished) {
        console.log(`eBay offer ${offerId} already published — continuing`);
      } else {
        throw pubErr;
      }
    }

    // ─── Step 4: Update local records ──────────────────────
    const now = new Date().toISOString();

    // Persist the eBay offer ID + item URL on channel_listing.
    // Use the actual `external_listing_id` column (matches the rest of the
    // codebase: ebay-sync, ebay-import-payouts, qbo-sync-payout, etc.)
    await admin
      .from("channel_listing")
      .update({
        external_listing_id: offerId,
        external_url: listingItemId
          ? `https://www.ebay.co.uk/itm/${listingItemId}`
          : (l.external_url as string) ?? null,
        v2_status: "live",
        listed_at: now,
      } as never)
      .eq("id", listingId);

    // Promote graded stock units to 'listed' for this SKU
    if (skuRow?.id) {
      await admin
        .from("stock_unit")
        .update({
          v2_status: "listed",
          listed_at: now,
        } as never)
        .eq("sku_id", skuRow.id as string)
        .eq("v2_status" as never, "graded");
    }

    return jsonResponse({
      success: true,
      listingId,
      skuCode: effectiveSku,
      offerId,
      listingItemId,
    });
  } catch (err) {
    console.error("ebay-push-listing failed:", err);
    return errorResponse(err);
  }
});

// ─── eBay API Fetch Helper ───────────────────────────────────

async function ebayFetch(token: string, path: string, options: RequestInit = {}) {
  const url = path.startsWith("http") ? path : `${EBAY_API}${path}`;
  const res = await fetchWithTimeout(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Content-Language": "en-GB",
      "Accept-Language": "en-GB",
      "X-EBAY-C-MARKETPLACE-ID": "EBAY_GB",
      ...(options.headers || {}),
    },
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`eBay API error ${path}: [${res.status}] ${text}`);
    throw new Error(`eBay API [${res.status}]: ${text}`);
  }

  if (res.status === 204) return null;
  const text = await res.text();
  if (!text?.trim()) return null;
  return JSON.parse(text);
}

// ─── Grade → eBay Condition Mapping ──────────────────────────

function mapGradeToEbayCondition(grade: string | null): string {
  switch (grade) {
    case "1": return "NEW";
    case "2": return "NEW_OTHER";
    case "3": return "USED_EXCELLENT";
    case "4": return "USED_GOOD";
    default: return "NEW_OTHER";
  }
}

// ─── Cross-channel attribute mapping ─────────────────────────
// Maps a 'core' namespace attribute key to its eBay aspect equivalent.
// Returning null means the core key is not relevant to eBay.
function mapCoreToEbayAspect(coreKey: string): string | null {
  const map: Record<string, string> = {
    brand: "Brand",
    mpn: "MPN",
    ean: "EAN",
    upc: "UPC",
    gtin: "GTIN",
    isbn: "ISBN",
    color: "Colour",
    colour: "Colour",
    material: "Material",
    theme: "Theme",
    character_family: "Character Family",
    character: "Character",
    age_level: "Age Level",
    piece_count: "Number of Pieces",
    year_manufactured: "Year Manufactured",
    type: "Type",
  };
  return map[coreKey.toLowerCase()] ?? null;
}

// ─── Recover existing offerId from eBay 25002 error ──────────
// eBay returns an error body like:
//   {"errors":[{"errorId":25002,"message":"...Offer entity already exists.",
//     "parameters":[{"name":"offerId","value":"155956152011"}]}]}
// Pull the existing offerId out so we can switch to PUT.
function extractExistingOfferId(errMsg: string): string | null {
  if (!/25002/.test(errMsg) || !/already exists/i.test(errMsg)) return null;
  // Find the JSON body in the error message and parse it
  const jsonStart = errMsg.indexOf("{");
  if (jsonStart < 0) return null;
  try {
    const body = JSON.parse(errMsg.slice(jsonStart));
    const errors = body?.errors;
    if (!Array.isArray(errors)) return null;
    for (const e of errors) {
      const params = e?.parameters;
      if (!Array.isArray(params)) continue;
      for (const p of params) {
        if (p?.name === "offerId" && typeof p?.value === "string") {
          return p.value;
        }
      }
    }
  } catch {
    // Fall through to regex fallback
  }
  // Regex fallback in case the JSON shape changes
  const m = errMsg.match(/"name"\s*:\s*"offerId"\s*,\s*"value"\s*:\s*"(\d+)"/);
  return m ? m[1] : null;
}
