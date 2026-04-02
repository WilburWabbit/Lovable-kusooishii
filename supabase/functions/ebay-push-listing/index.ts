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

const EBAY_API = "https://api.ebay.com";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const admin = createAdminClient();
    await authenticateRequest(req, admin);

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

    // Fetch SKU for pricing
    const { data: sku } = await admin
      .from("sku")
      .select("*, product:product_id(mpn, name, description, ean, upc, hook)")
      .eq("id", l.sku_id)
      .single();

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

    // ─── Get eBay access token ─────────────────────────────
    const accessToken = await getEbayAccessToken(admin);

    // ─── Step 1: Create/Update Inventory Item ──────────────
    const inventoryItemPayload = {
      product: {
        title: (l.listing_title as string) ?? (product?.name as string) ?? effectiveSku,
        description: (l.listing_description as string) ?? (product?.description as string) ?? "",
        aspects: {
          "Brand": ["LEGO"],
          "MPN": [product?.mpn ?? ""],
        },
        ...(product?.ean ? { ean: [product.ean] } : {}),
        ...(product?.upc ? { upc: [product.upc] } : {}),
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
    const existingExternalId = l.external_listing_id as string | null;
    let offerId: string;

    const offerPayload = {
      sku: effectiveSku,
      marketplaceId: "EBAY_GB",
      format: "FIXED_PRICE",
      availableQuantity: onHandCount ?? 1,
      categoryId: "19006", // LEGO Building Toys category
      listingDescription: (l.listing_description as string) ?? (product?.description as string) ?? "",
      pricingSummary: {
        price: {
          value: String((l.listed_price as number) ?? 0),
          currency: "GBP",
        },
      },
      listingPolicies: {
        fulfillmentPolicyId: Deno.env.get("EBAY_FULFILLMENT_POLICY_ID") ?? "",
        paymentPolicyId: Deno.env.get("EBAY_PAYMENT_POLICY_ID") ?? "",
        returnPolicyId: Deno.env.get("EBAY_RETURN_POLICY_ID") ?? "",
      },
      merchantLocationKey: Deno.env.get("EBAY_LOCATION_KEY") ?? "default",
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
      // Offer may already be published — 409 Conflict is acceptable
      const errMsg = pubErr instanceof Error ? pubErr.message : String(pubErr);
      if (errMsg.includes("409") || errMsg.includes("already published") || errMsg.includes("25002")) {
        console.log(`eBay offer ${offerId} already published — continuing`);
      } else {
        throw pubErr;
      }
    }

    // ─── Step 4: Update local records ──────────────────────
    const now = new Date().toISOString();

    // Update channel_listing with eBay IDs and status
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
    return errorResponse(err);
  }
});

// ─── eBay OAuth Token Management ─────────────────────────────

async function getEbayAccessToken(admin: ReturnType<typeof createAdminClient>): Promise<string> {
  const { data: conn, error } = await admin
    .from("ebay_connection")
    .select("*")
    .limit(1)
    .maybeSingle();

  if (error || !conn) throw new Error("eBay not connected. Connect eBay in Settings first.");

  const c = conn as Record<string, unknown>;

  // Return current token if still valid (with 60s buffer)
  if (new Date(c.token_expires_at as string).getTime() > Date.now() + 60_000) {
    return c.access_token as string;
  }

  // Refresh the token
  const clientId = Deno.env.get("EBAY_CLIENT_ID")!;
  const clientSecret = Deno.env.get("EBAY_CLIENT_SECRET")!;

  const res = await fetchWithTimeout(`${EBAY_API}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: c.refresh_token as string,
      scope: [
        "https://api.ebay.com/oauth/api_scope",
        "https://api.ebay.com/oauth/api_scope/sell.inventory",
        "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
        "https://api.ebay.com/oauth/api_scope/sell.account",
      ].join(" "),
    }),
  });

  if (!res.ok) throw new Error(`eBay token refresh failed [${res.status}]`);
  const data = await res.json();
  const newExpiresAt = new Date(Date.now() + (data.expires_in || 7200) * 1000).toISOString();

  await admin
    .from("ebay_connection")
    .update({
      access_token: data.access_token,
      ...(data.refresh_token ? { refresh_token: data.refresh_token } : {}),
      token_expires_at: newExpiresAt,
    } as never)
    .eq("id", c.id as string);

  return data.access_token;
}

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
