// Redeployed: 2026-03-23
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";
import { buildGmcProductInput, type GmcMappingRule } from "../_shared/gmc-product-input.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const GMC_API_BASE = "https://merchantapi.googleapis.com/products/v1beta";

interface GmcConnection {
  id: string;
  access_token: string;
  refresh_token: string;
  token_expires_at: string;
  updated_at: string;
  merchant_id: string;
  data_source: string | null;
}

/** Refresh GMC access token if expired */
async function ensureToken(
  supabaseAdmin: SupabaseClient,
  conn: GmcConnection,
): Promise<string> {
  const expiresAt = new Date(conn.token_expires_at);
  if (expiresAt > new Date(Date.now() + 60_000)) {
    return conn.access_token;
  }

  const clientId = Deno.env.get("GMC_CLIENT_ID")!;
  const clientSecret = Deno.env.get("GMC_CLIENT_SECRET")!;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: conn.refresh_token,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!tokenRes.ok) {
    throw new Error(`Token refresh failed [${tokenRes.status}]`);
  }

  const tokens = await tokenRes.json();
  const newExpiry = new Date(
    Date.now() + (tokens.expires_in ?? 3600) * 1000,
  ).toISOString();

  await supabaseAdmin
    .from("google_merchant_connection")
    .update({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || conn.refresh_token,
      token_expires_at: newExpiry,
    })
    .eq("id", conn.id)
    .eq("updated_at", conn.updated_at);

  return tokens.access_token as string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const siteUrl = Deno.env.get("SITE_URL") || supabaseUrl.replace(".supabase.co", "");

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
    const body = await req.json();
    const { action } = body;

    // --- Admin auth ---
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) throw new Error("Unauthorized");

    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
      error: userError,
    } = await supabaseAdmin.auth.getUser(token);
    if (userError || !user) throw new Error("Unauthorized");

    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id);
    const isAdmin = (roles ?? []).some(
      (r: { role: string }) => r.role === "admin",
    );
    if (!isAdmin) throw new Error("Forbidden: admin only");

    // --- Get GMC connection ---
    const { data: connRaw, error: connErr } = await supabaseAdmin
      .from("google_merchant_connection")
      .select("*")
      .limit(1)
      .maybeSingle();

    if (connErr || !connRaw) {
      throw new Error("No Google Merchant Centre connection found");
    }

    const conn: GmcConnection = {
      id: String(connRaw.id),
      access_token: String(connRaw.access_token),
      refresh_token: String(connRaw.refresh_token),
      token_expires_at: String(connRaw.token_expires_at),
      updated_at: String(connRaw.updated_at),
      merchant_id: String(connRaw.merchant_id),
      data_source: connRaw.data_source ? String(connRaw.data_source) : null,
    };

    const accessToken = await ensureToken(supabaseAdmin, conn);
    const merchantId = conn.merchant_id;
    const dataSource = conn.data_source;

    // --- Publish all eligible SKUs ---
    if (action === "publish_all") {
      const skuIds = Array.isArray(body.sku_ids)
        ? new Set(body.sku_ids.map((value: unknown) => String(value)))
        : null;
      if (!dataSource) {
        throw new Error(
          "No data source configured. Set data_source on the GMC connection.",
        );
      }

      // Get SKUs with active web listings
      const { data: skus, error: skuErr } = await supabaseAdmin
        .from("sku")
        .select(
          "id, sku_code, condition_grade, product_id, product:product_id(id, mpn, name, seo_title, seo_description, description, img_url, product_type, lego_theme, lego_subtheme, subtheme_name, piece_count, release_year, retired_flag, weight_kg, ean, upc, isbn, gmc_product_category)",
        )
        .eq("active_flag", true);

      if (skuErr) throw new Error(`Failed to fetch SKUs: ${skuErr.message}`);

      // Get web channel listings to know which SKUs are listed on web.
      // Offer status casing is historical; v2_status is preferred where present.
      const { data: webListings } = await supabaseAdmin
        .from("channel_listing")
        .select("sku_id, offer_status, v2_status, listed_price")
        .eq("channel", "web");

      const webListingBySku = new Map<string, Record<string, unknown>>();
      for (const listing of (webListings ?? []) as Record<string, unknown>[]) {
        if (
          listing.v2_status === "live" ||
          ["live", "published", "PUBLISHED"].includes(String(listing.offer_status ?? ""))
        ) {
          webListingBySku.set(listing.sku_id as string, listing);
        }
      }

      const webSkuIds = new Set(
        (webListings ?? [])
          .filter((l: Record<string, unknown>) =>
            l.v2_status === "live" ||
            ["live", "published", "PUBLISHED"].includes(String(l.offer_status ?? "")),
          )
          .map((l: Record<string, unknown>) => l.sku_id),
      );

      // Get stock counts
      const { data: stockCounts } = await supabaseAdmin
        .from("stock_unit")
        .select("sku_id")
        .eq("status", "available");

      const stockMap = new Map<string, number>();
      for (const su of stockCounts ?? []) {
        const skuId = su.sku_id as string;
        stockMap.set(skuId, (stockMap.get(skuId) || 0) + 1);
      }

      const { data: mappingRows, error: mappingErr } = await supabaseAdmin
        .from("channel_attribute_mapping")
        .select("aspect_key, canonical_key, constant_value, transform")
        .eq("channel", "gmc")
        .or("marketplace.eq.GB,marketplace.is.null")
        .is("category_id", null);
      if (mappingErr) throw new Error(`Failed to fetch GMC mappings: ${mappingErr.message}`);
      const gmcMappings = (mappingRows ?? []) as GmcMappingRule[];

      let queued = 0;
      let errors = 0;
      let skipped = 0;
      const errorDetails: string[] = [];
      const skippedDetails: Array<Record<string, unknown>> = [];

      for (const sku of skus ?? []) {
        if (skuIds && !skuIds.has(String(sku.id))) continue;
        // GMC requires a published product page. Excluded SKUs are auto-queued
        // when their website listing publish command is acknowledged live.
        if (!webSkuIds.has(sku.id)) {
          skipped++;
          skippedDetails.push({ sku_id: sku.id, sku_code: sku.sku_code, reason: "missing_live_web_page" });
          continue;
        }

        const productRelation = sku.product as
          | Record<string, unknown>
          | Record<string, unknown>[]
          | null;
        const product = Array.isArray(productRelation)
          ? productRelation[0] ?? null
          : productRelation;
        if (!product) {
          skipped++;
          skippedDetails.push({ sku_id: sku.id, sku_code: sku.sku_code, reason: "missing_mpn" });
          continue;
        }

        const stockCount = stockMap.get(sku.id) || 0;
        const webListing = webListingBySku.get(sku.id);
        const listedPrice = Number(webListing?.listed_price ?? 0);
        if (listedPrice <= 0) {
          skipped++;
          skippedDetails.push({ sku_id: sku.id, sku_code: sku.sku_code, reason: "not_listable_grade" });
          continue;
        }

        try {
          const { warnings } = buildGmcProductInput(
            {
              external_sku: sku.sku_code as string,
              listed_price: listedPrice,
            },
            sku as Record<string, unknown>,
            product,
            stockCount,
            siteUrl,
            gmcMappings,
          );
          const { data: listing, error: listingErr } = await supabaseAdmin.from("channel_listing").upsert(
            {
              channel: "google_shopping",
              external_sku: sku.sku_code,
              sku_id: sku.id,
              offer_status: "publish_queued",
              listed_price: listedPrice,
              listed_quantity: stockCount,
              raw_data: { gmc_warnings: warnings },
              synced_at: new Date().toISOString(),
            },
            { onConflict: "channel,external_sku" },
          ).select("id").single();
          if (listingErr) throw listingErr;

          const { error: snapshotErr } = await supabaseAdmin.rpc("create_price_decision_snapshot", {
            p_sku_id: sku.id,
            p_channel: "google_shopping",
            p_channel_listing_id: listing.id,
            p_candidate_price: listedPrice,
          });
          if (snapshotErr) throw snapshotErr;

          const { error: commandErr } = await supabaseAdmin.rpc("queue_listing_command", {
            p_channel_listing_id: listing.id,
            p_command_type: "publish",
          });
          if (commandErr) throw commandErr;

          queued++;
        } catch (e) {
          console.error(`GMC queue publish error for ${sku.sku_code}:`, e);
          errors++;
          errorDetails.push(
            `${sku.sku_code}: ${e instanceof Error ? e.message : "unknown"}`,
          );
        }
      }

      return new Response(
        JSON.stringify({ queued, published: queued, errors, skipped, errorDetails, skippedDetails }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // --- Unpublish a product ---
    if (action === "unpublish") {
      const { sku_code } = body;
      if (!sku_code) throw new Error("Missing sku_code");

      // Find the channel listing to get the GMC product name
      const { data: listing } = await supabaseAdmin
        .from("channel_listing")
        .select("id, external_listing_id")
        .eq("channel", "google_shopping")
        .eq("external_sku", sku_code)
        .maybeSingle();

      if (!listing) {
        throw new Error(`No GMC listing found for ${sku_code}`);
      }

      await supabaseAdmin
        .from("channel_listing")
        .update({ offer_status: "end_queued", listed_quantity: 0, synced_at: new Date().toISOString() })
        .eq("id", listing.id);

      const { data: commandId, error: commandErr } = await supabaseAdmin.rpc("queue_listing_command", {
        p_channel_listing_id: listing.id,
        p_command_type: "end",
      });
      if (commandErr) throw commandErr;

      return new Response(
        JSON.stringify({ success: true, queued: true, listingId: listing.id, commandId }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // --- Sync status from GMC ---
    if (action === "sync_status") {
      const listUrl = `${GMC_API_BASE}/accounts/${merchantId}/products`;
      const res = await fetch(listUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`GMC list products failed [${res.status}]: ${errBody}`);
      }

      const data = await res.json();
      const products = data.products || [];

      // Get existing google_shopping channel listings
      const { data: existingListings } = await supabaseAdmin
        .from("channel_listing")
        .select("id, external_sku, external_listing_id, offer_status")
        .eq("channel", "google_shopping");

      const listingMap = new Map(
        (existingListings ?? []).map((l: Record<string, unknown>) => [
          l.external_sku,
          l,
        ]),
      );

      let updated = 0;
      for (const product of products) {
        const offerId = product.offerId;
        if (!offerId) continue;

        const existing = listingMap.get(offerId) as
          | Record<string, unknown>
          | undefined;
        if (!existing) continue;

        // Map GMC product status to our offer_status
        const gmcStatus =
          product.productStatus?.destinationStatuses?.[0]?.status ||
          "unknown";
        const offerStatus =
          gmcStatus === "APPROVED"
            ? "published"
            : gmcStatus === "DISAPPROVED"
              ? "suppressed"
              : gmcStatus === "PENDING"
                ? "pending"
                : "unknown";

        await supabaseAdmin
          .from("channel_listing")
          .update({
            offer_status: offerStatus,
            synced_at: new Date().toISOString(),
          })
          .eq("id", existing.id);

        updated++;
      }

      return new Response(
        JSON.stringify({
          gmc_products: products.length,
          updated,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (err) {
    console.error("gmc-sync error:", err);
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : "Unknown error",
      }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
