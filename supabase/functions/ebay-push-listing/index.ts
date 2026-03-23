// ============================================================
// eBay Push Listing (Stub)
// Creates or updates an eBay listing from channel_listing data.
// Uses eBay Inventory API (sell_inventory_v1).
//
// TODO: Wire to actual eBay OAuth + Inventory API once credentials
// are configured. Currently logs payload and returns success.
// ============================================================

import {
  corsHeaders,
  createAdminClient,
  authenticateRequest,
  jsonResponse,
  errorResponse,
} from "../_shared/qbo-helpers.ts";

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
      .select("*, product:product_id(mpn, name, description, ean, upc)")
      .eq("id", l.sku_id)
      .single();

    const skuRow = sku as Record<string, unknown> | null;
    const product = skuRow?.product as Record<string, unknown> | null;

    // Build eBay Inventory API payload (Inventory Item + Offer)
    const ebayPayload = {
      inventoryItem: {
        sku: skuCode ?? skuRow?.sku_code,
        product: {
          title: l.listing_title ?? product?.name ?? skuCode,
          description: l.listing_description ?? product?.description ?? "",
          aspects: {
            "Brand": ["LEGO"],
            "MPN": [product?.mpn ?? ""],
          },
          ean: product?.ean ? [product.ean] : undefined,
          upc: product?.upc ? [product.upc] : undefined,
        },
        condition: mapGradeToEbayCondition(skuRow?.condition_grade as string),
        availability: {
          shipToLocationAvailability: {
            quantity: 1, // Unit-level listing
          },
        },
      },
      offer: {
        sku: skuCode ?? skuRow?.sku_code,
        marketplaceId: "EBAY_GB",
        format: "FIXED_PRICE",
        pricingSummary: {
          price: {
            value: String(l.listed_price ?? 0),
            currency: "GBP",
          },
        },
        listingDescription: l.listing_description ?? product?.description ?? "",
      },
    };

    // TODO: Actually call eBay API
    // const accessToken = await getEbayAccessToken(admin);
    // const inventoryRes = await fetch(`https://api.ebay.com/sell/inventory/v1/inventory_item/${skuCode}`, { ... });
    // const offerRes = await fetch(`https://api.ebay.com/sell/inventory/v1/offer`, { ... });

    console.log("eBay push listing payload (stub):", JSON.stringify(ebayPayload, null, 2));

    return jsonResponse({
      success: true,
      stub: true,
      message: "eBay push listing is a stub — payload logged but not sent to eBay API",
      listingId,
      skuCode,
    });
  } catch (err) {
    return errorResponse(err);
  }
});

function mapGradeToEbayCondition(grade: string | null): string {
  switch (grade) {
    case "1": return "NEW";
    case "2": return "NEW_OTHER";
    case "3": return "USED_EXCELLENT";
    case "4": return "USED_GOOD";
    default: return "NEW_OTHER";
  }
}
