import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const GMC_API_BASE = "https://merchantapi.googleapis.com/products/v1beta";

interface ProductInput {
  offerId: string;
  contentLanguage: string;
  feedLabel: string;
  channel: string;
  product: {
    title: string;
    description: string;
    link: string;
    imageLink: string;
    price: { amountMicros: string; currencyCode: string };
    availability: string;
    condition: string;
    brand: string;
    mpn: string;
    productTypes: string[];
    shippingWeight?: { value: number; unit: string };
    itemGroupId: string;
  };
}

/** Refresh GMC access token if expired */
async function ensureToken(
  supabaseAdmin: ReturnType<typeof createClient>,
  conn: Record<string, unknown>,
): Promise<string> {
  const expiresAt = new Date(conn.token_expires_at as string);
  if (expiresAt > new Date(Date.now() + 60_000)) {
    return conn.access_token as string;
  }

  const clientId = Deno.env.get("GMC_CLIENT_ID")!;
  const clientSecret = Deno.env.get("GMC_CLIENT_SECRET")!;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: conn.refresh_token as string,
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

/** Map product/SKU data to Google ProductInput */
function mapToProductInput(
  product: Record<string, unknown>,
  sku: Record<string, unknown>,
  stockCount: number,
  siteUrl: string,
): ProductInput {
  const mpn = (product.mpn as string) || "";
  const price = (sku.price as number) || 0;
  const conditionGrade = Number(sku.condition_grade) || 3;

  return {
    offerId: sku.sku_code as string,
    contentLanguage: "en",
    feedLabel: "GB",
    channel: "ONLINE",
    product: {
      title:
        (product.seo_title as string) ||
        (product.name as string) ||
        `LEGO ${mpn}`,
      description:
        (product.seo_description as string) ||
        (product.description as string) ||
        "",
      link: `${siteUrl}/sets/${mpn}`,
      imageLink: (product.img_url as string) || "",
      price: {
        amountMicros: String(Math.round(price * 1_000_000)),
        currencyCode: "GBP",
      },
      availability: stockCount > 0 ? "in_stock" : "out_of_stock",
      condition: conditionGrade <= 2 ? "new" : "used",
      brand: "LEGO",
      mpn: mpn.replace(/-\d+$/, ""),
      productTypes: [
        product.subtheme_name
          ? `Toys > LEGO > ${product.subtheme_name}`
          : "Toys > LEGO",
      ],
      shippingWeight: product.weight_kg
        ? { value: product.weight_kg as number, unit: "kg" }
        : undefined,
      itemGroupId: mpn,
    },
  };
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
    const { data: conn, error: connErr } = await supabaseAdmin
      .from("google_merchant_connection")
      .select("*")
      .limit(1)
      .maybeSingle();

    if (connErr || !conn) {
      throw new Error("No Google Merchant Centre connection found");
    }

    const accessToken = await ensureToken(supabaseAdmin, conn);
    const merchantId = conn.merchant_id as string;
    const dataSource = conn.data_source as string | null;

    // --- Publish all eligible SKUs ---
    if (action === "publish_all") {
      if (!dataSource) {
        throw new Error(
          "No data source configured. Set data_source on the GMC connection.",
        );
      }

      // Get SKUs with active web listings
      const { data: skus, error: skuErr } = await supabaseAdmin
        .from("sku")
        .select(
          "id, sku_code, price, condition_grade, product_id, product:product_id(id, mpn, name, seo_title, seo_description, description, img_url, subtheme_name, weight_kg)",
        )
        .eq("active", true);

      if (skuErr) throw new Error(`Failed to fetch SKUs: ${skuErr.message}`);

      // Get web channel listings to know which SKUs are listed on web
      const { data: webListings } = await supabaseAdmin
        .from("channel_listing")
        .select("sku_id, offer_status")
        .eq("channel", "web")
        .eq("offer_status", "live");

      const webSkuIds = new Set(
        (webListings ?? []).map((l: Record<string, unknown>) => l.sku_id),
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

      let published = 0;
      let errors = 0;
      let skipped = 0;
      const errorDetails: string[] = [];

      for (const sku of skus ?? []) {
        // Only publish SKUs with active web listing
        if (!webSkuIds.has(sku.id)) {
          skipped++;
          continue;
        }

        const product = sku.product as Record<string, unknown> | null;
        if (!product) {
          skipped++;
          continue;
        }

        const stockCount = stockMap.get(sku.id) || 0;
        const productInput = mapToProductInput(product, sku, stockCount, siteUrl);

        try {
          const url = `${GMC_API_BASE}/accounts/${merchantId}/productInputs:insert?dataSource=${dataSource}`;
          const res = await fetch(url, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(productInput),
          });

          if (!res.ok) {
            const errBody = await res.text();
            console.error(
              `GMC publish failed for ${sku.sku_code}: ${res.status} ${errBody}`,
            );
            errors++;
            errorDetails.push(`${sku.sku_code}: ${res.status}`);
            continue;
          }

          const result = await res.json();

          // Upsert channel_listing for google_shopping
          await supabaseAdmin.from("channel_listing").upsert(
            {
              channel: "google_shopping",
              external_sku: sku.sku_code,
              sku_id: sku.id,
              external_listing_id: result.name || null,
              offer_status: "published",
              listed_price: sku.price,
              listed_quantity: stockCount,
              synced_at: new Date().toISOString(),
            },
            { onConflict: "channel,external_sku" },
          );

          published++;
        } catch (e) {
          console.error(`GMC publish error for ${sku.sku_code}:`, e);
          errors++;
          errorDetails.push(
            `${sku.sku_code}: ${e instanceof Error ? e.message : "unknown"}`,
          );
        }
      }

      return new Response(
        JSON.stringify({ published, errors, skipped, errorDetails }),
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

      if (!listing?.external_listing_id) {
        throw new Error(`No GMC listing found for ${sku_code}`);
      }

      const deleteUrl = `${GMC_API_BASE}/accounts/${merchantId}/productInputs/${listing.external_listing_id}`;
      const res = await fetch(deleteUrl, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!res.ok && res.status !== 404) {
        const errBody = await res.text();
        throw new Error(`GMC delete failed [${res.status}]: ${errBody}`);
      }

      await supabaseAdmin
        .from("channel_listing")
        .update({ offer_status: "ended", synced_at: new Date().toISOString() })
        .eq("id", listing.id);

      return new Response(
        JSON.stringify({ success: true }),
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
