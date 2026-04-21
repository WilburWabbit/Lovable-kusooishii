// Redeployed: 2026-03-23
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";

class ValidationError extends Error {
  constructor(message: string) { super(message); this.name = "ValidationError"; }
}

const STOCK_MATCHABLE = ["available", "received", "graded"];
const VALID_SALE_STATUSES = ["complete", "paid", "shipped", "packed", "picking", "awaiting_dispatch"];

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** Fully reset a QBO purchase: delete derived stock units, receipt lines, purchase batches/line items, then reset landing to pending */
async function resetQboPurchase(admin: any, qboPurchaseId: string, landingId: string) {
  // 1. Find the receipt
  const { data: receipt } = await admin
    .from("inbound_receipt")
    .select("id")
    .eq("qbo_purchase_id", qboPurchaseId)
    .maybeSingle();

  if (receipt) {
    // 2. Get real receipt line IDs
    const { data: lines } = await admin
      .from("inbound_receipt_line")
      .select("id")
      .eq("inbound_receipt_id", receipt.id);
    const lineIds = (lines ?? []).map((l: any) => l.id);

    // 3. Delete stock units linked to those lines (non-sold only; nullify sold)
    if (lineIds.length > 0) {
      const { data: linkedUnits } = await admin
        .from("stock_unit")
        .select("id, status, v2_status")
        .in("inbound_receipt_line_id", lineIds);
      for (const unit of (linkedUnits ?? [])) {
        if (unit.status === "closed" || unit.v2_status === "sold") {
          await admin.from("stock_unit").update({ inbound_receipt_line_id: null }).eq("id", unit.id);
        } else {
          await admin.from("stock_unit").delete().eq("id", unit.id);
        }
      }
    }

    // 4. Delete receipt lines
    await admin.from("inbound_receipt_line").delete().eq("inbound_receipt_id", receipt.id);

    // 5. Reset receipt status
    await admin.from("inbound_receipt").update({ status: "pending" }).eq("id", receipt.id);
  }

  // 6. Delete purchase_line_items and purchase_batches by reference
  const { data: batches } = await admin
    .from("purchase_batches")
    .select("id")
    .eq("reference", qboPurchaseId);
  for (const b of (batches ?? [])) {
    await admin.from("purchase_line_items").delete().eq("batch_id", b.id);
    await admin.from("purchase_batches").delete().eq("id", b.id);
  }

  // 7. Reset landing record to pending
  await admin
    .from("landing_raw_qbo_purchase")
    .update({ status: "pending", error_message: null, processed_at: null })
    .eq("id", landingId);
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // --- Auth: extract & verify JWT, then check admin/staff role ---
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Verify the caller's JWT using service role client (can validate any token)
    const admin = createClient(supabaseUrl, serviceRoleKey);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await admin.auth.getUser(token);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = user.id;

    // Check role using service role client (bypasses RLS)
    const { data: roles } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);

    const hasAccess = (roles ?? []).some(
      (r: { role: string }) => r.role === "admin" || r.role === "staff"
    );
    if (!hasAccess) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- Route by action ---
    const { action, ...params } = await req.json();

    let result: unknown;

    if (action === "list-receipts") {
      const { data, error } = await admin
        .from("inbound_receipt")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      result = data;
    } else if (action === "receipt-lines") {
      const { data, error } = await admin
        .from("inbound_receipt_line")
        .select("*, tax_code:tax_code_id(purchase_tax_rate:purchase_tax_rate_id(rate_percent))")
        .eq("inbound_receipt_id", params.receipt_id)
        .order("created_at");
      if (error) throw error;
      // Flatten vat_rate_percent onto each line
      result = (data ?? []).map((l: any) => ({
        ...l,
        vat_rate_percent: l.tax_code?.purchase_tax_rate?.rate_percent ?? null,
        tax_code: undefined,
      }));
    } else if (action === "list-stock-units") {
      const { data, error } = await admin
        .from("stock_unit")
        .select(
          "id, mpn, condition_grade, status, landed_cost, carrying_value, accumulated_impairment, created_at, sku:sku_id(sku_code, name, product:product_id(name)), receipt_line:inbound_receipt_line_id(tax_code:tax_code_id(purchase_tax_rate:purchase_tax_rate_id(rate_percent)), receipt:inbound_receipt_id(txn_date))"
        )
        .order("created_at", { ascending: false });
      if (error) throw error;
      // Flatten vat_rate_percent and purchase_date
      result = (data ?? []).map((u: any) => ({
        ...u,
        vat_rate_percent: u.receipt_line?.tax_code?.purchase_tax_rate?.rate_percent ?? null,
        purchase_date: u.receipt_line?.receipt?.txn_date ?? null,
        receipt_line: undefined,
      }));
    } else if (action === "list-customers") {
      const { data, error } = await admin
        .from("customer")
        .select("id, qbo_customer_id, display_name, email, phone, mobile, billing_city, billing_postcode, billing_country, active, synced_at, created_at")
        .order("display_name", { ascending: true });
      if (error) throw error;
      result = data;
    } else if (action === "list-orders") {
      const { data, error } = await admin
        .from("sales_order")
        .select(
          "id, order_number, doc_number, origin_channel, origin_reference, status, merchandise_subtotal, discount_total, club_discount_amount, tax_total, gross_total, currency, guest_name, guest_email, created_at, txn_date, notes, customer:customer_id(id, display_name, email), sales_order_line(id, quantity, unit_price, line_total, tax_code:tax_code_id(sales_tax_rate:sales_tax_rate_id(rate_percent)), sku:sku_id(sku_code, name, product:product_id(name, mpn)))"
        )
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      result = (data ?? []).map((o: any) => ({
        ...o,
        sales_order_line: (o.sales_order_line ?? []).map((l: any) => ({
          ...l,
          vat_rate_percent: l.tax_code?.sales_tax_rate?.rate_percent ?? null,
          tax_code: undefined,
        })),
      }));
    } else if (action === "list-listings") {
      // 1. Active SKUs with catalog product info
      const { data: skus, error: skuErr } = await admin
        .from("sku")
        .select("id, sku_code, name, condition_grade, price, active_flag, product_id, product:product_id(name, mpn)")
        .eq("active_flag", true)
        .order("sku_code", { ascending: true });
      if (skuErr) throw skuErr;

      // 2. Available stock counts per SKU
      const { data: stockCounts, error: scErr } = await admin
        .from("stock_unit")
        .select("sku_id")
        .eq("status", "available");
      if (scErr) throw scErr;
      const stockMap: Record<string, number> = {};
      for (const su of stockCounts ?? []) {
        stockMap[su.sku_id] = (stockMap[su.sku_id] ?? 0) + 1;
      }

      // 3. All channel listings
      const { data: listings, error: clErr } = await admin
        .from("channel_listing")
        .select("id, sku_id, channel, external_sku, external_listing_id, offer_status, listed_price, listed_quantity, synced_at")
        .order("channel");
      if (clErr) throw clErr;

      // Group listings by sku_id
      const listingMap: Record<string, any[]> = {};
      for (const cl of listings ?? []) {
        if (!cl.sku_id) continue;
        if (!listingMap[cl.sku_id]) listingMap[cl.sku_id] = [];
        listingMap[cl.sku_id].push(cl);
      }

      // Merge
      result = (skus ?? []).map((s: any) => ({
        ...s,
        stock_available: stockMap[s.id] ?? 0,
        channel_listings: listingMap[s.id] ?? [],
      }));
    } else if (action === "list-products") {
      // 1. Products with theme name
      const { data: products, error: pErr } = await admin
        .from("product")
        .select("*, theme:theme_id(name)")
        .order("mpn", { ascending: true });
      if (pErr) throw pErr;

      // 2. SKUs per product
      const { data: skus, error: skuErr } = await admin
        .from("sku")
        .select("id, sku_code, condition_grade, price, product_id, active_flag")
        .order("sku_code");
      if (skuErr) throw skuErr;

      // 3. Available stock counts per SKU
      const { data: stockUnits, error: suErr } = await admin
        .from("stock_unit")
        .select("sku_id, carrying_value, status");
      if (suErr) throw suErr;

      const skuStockMap: Record<string, { available: number; value: number }> = {};
      for (const su of stockUnits ?? []) {
        if (!skuStockMap[su.sku_id]) skuStockMap[su.sku_id] = { available: 0, value: 0 };
        if (su.status === "available") {
          skuStockMap[su.sku_id].available += 1;
          skuStockMap[su.sku_id].value += su.carrying_value ?? 0;
        }
      }

      // 4. Sales per SKU
      const { data: salesLines, error: slErr } = await admin
        .from("sales_order_line")
        .select("sku_id, quantity, line_total");
      if (slErr) throw slErr;

      const skuSalesMap: Record<string, { qty: number; revenue: number }> = {};
      for (const sl of salesLines ?? []) {
        if (!skuSalesMap[sl.sku_id]) skuSalesMap[sl.sku_id] = { qty: 0, revenue: 0 };
        skuSalesMap[sl.sku_id].qty += sl.quantity;
        skuSalesMap[sl.sku_id].revenue += sl.line_total;
      }

      // 5. Channel listings per SKU
      const { data: listings, error: clErr } = await admin
        .from("channel_listing")
        .select("id, sku_id, channel, external_sku, external_listing_id, offer_status, listed_price, listed_quantity, listing_title, listing_description, synced_at");
      if (clErr) throw clErr;

      const skuListingMap: Record<string, any[]> = {};
      for (const cl of listings ?? []) {
        if (!cl.sku_id) continue;
        if (!skuListingMap[cl.sku_id]) skuListingMap[cl.sku_id] = [];
        skuListingMap[cl.sku_id].push(cl);
      }

      // Group SKUs by product_id
      const productSkuMap: Record<string, any[]> = {};
      for (const s of skus ?? []) {
        if (!s.product_id) continue;
        if (!productSkuMap[s.product_id]) productSkuMap[s.product_id] = [];
        const stock = skuStockMap[s.id] ?? { available: 0, value: 0 };
        productSkuMap[s.product_id].push({
          ...s,
          stock_available: stock.available,
          carrying_value: stock.value,
          channel_listings: skuListingMap[s.id] ?? [],
        });
      }

      // Merge into products
      result = (products ?? []).map((p: any) => {
        const pSkus = productSkuMap[p.id] ?? [];
        let stockAvailable = 0, carryingValue = 0, unitsSold = 0, revenue = 0;
        const allChannelListings: any[] = [];
        for (const s of pSkus) {
          stockAvailable += s.stock_available;
          carryingValue += s.carrying_value;
          const sales = skuSalesMap[s.id];
          if (sales) { unitsSold += sales.qty; revenue += sales.revenue; }
          allChannelListings.push(...s.channel_listings);
        }
        return {
          ...p,
          theme_name: p.theme?.name ?? null,
          theme: undefined,
          stock_available: stockAvailable,
          carrying_value: carryingValue,
          units_sold: unitsSold,
          revenue,
          skus: pSkus,
          channel_listings: allChannelListings,
        };
      });
    } else if (action === "get-product") {
      const { data: product, error: pErr } = await admin
        .from("product")
        .select("*, theme:theme_id(name), lego_catalog:lego_catalog_id(img_url)")
        .eq("id", params.product_id)
        .single();
      if (pErr) throw pErr;

      // SKUs
      const { data: skus, error: skuErr } = await admin
        .from("sku")
        .select("id, sku_code, condition_grade, price, active_flag")
        .eq("product_id", params.product_id)
        .order("sku_code");
      if (skuErr) throw skuErr;

      const skuIds = (skus ?? []).map((s: any) => s.id);

      // Stock
      const { data: stockUnits } = await admin
        .from("stock_unit")
        .select("sku_id, carrying_value, status")
        .in("sku_id", skuIds.length > 0 ? skuIds : ["00000000-0000-0000-0000-000000000000"]);

      const skuStockMap: Record<string, { available: number; value: number }> = {};
      for (const su of stockUnits ?? []) {
        if (!skuStockMap[su.sku_id]) skuStockMap[su.sku_id] = { available: 0, value: 0 };
        if (su.status === "available") {
          skuStockMap[su.sku_id].available += 1;
          skuStockMap[su.sku_id].value += su.carrying_value ?? 0;
        }
      }

      // Sales
      const { data: salesLines } = await admin
        .from("sales_order_line")
        .select("sku_id, quantity, line_total")
        .in("sku_id", skuIds.length > 0 ? skuIds : ["00000000-0000-0000-0000-000000000000"]);

      // Channel listings
      const { data: listings } = await admin
        .from("channel_listing")
        .select("id, sku_id, channel, external_sku, external_listing_id, offer_status, listed_price, listed_quantity, listing_title, listing_description, synced_at")
        .in("sku_id", skuIds.length > 0 ? skuIds : ["00000000-0000-0000-0000-000000000000"]);

      const skuListingMap: Record<string, any[]> = {};
      for (const cl of listings ?? []) {
        if (!cl.sku_id) continue;
        if (!skuListingMap[cl.sku_id]) skuListingMap[cl.sku_id] = [];
        skuListingMap[cl.sku_id].push(cl);
      }

      let stockAvailable = 0, carryingValue = 0, unitsSold = 0, revenue = 0;
      const allChannelListings: any[] = [];
      const enrichedSkus = (skus ?? []).map((s: any) => {
        const stock = skuStockMap[s.id] ?? { available: 0, value: 0 };
        stockAvailable += stock.available;
        carryingValue += stock.value;
        const skuSales = (salesLines ?? []).filter((sl: any) => sl.sku_id === s.id);
        for (const sl of skuSales) { unitsSold += sl.quantity; revenue += sl.line_total; }
        const cls = skuListingMap[s.id] ?? [];
        allChannelListings.push(...cls);
        return { ...s, stock_available: stock.available, carrying_value: stock.value, channel_listings: cls };
      });

      // Fetch source data for override comparison
      const sourceData: Record<string, any> = {};
      if (product.lego_catalog_id) {
        const { data: lc } = await admin
          .from("lego_catalog")
          .select("version_descriptor, brickeconomy_id, bricklink_item_no, brickowl_boid, rebrickable_id")
          .eq("id", product.lego_catalog_id)
          .maybeSingle();
        if (lc) sourceData.lego_catalog = lc;
      }
      const baseMpn = product.mpn.replace(/-\d+$/, "");
      const { data: beRow } = await admin
        .from("brickeconomy_collection")
        .select("item_number, minifigs_count, retail_price, released_date, retired_date")
        .in("item_number", [product.mpn, baseMpn])
        .order("synced_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (beRow) sourceData.brickeconomy = beRow;

      result = {
        ...product,
        theme_name: product.theme?.name ?? null,
        catalog_img_url: product.lego_catalog?.img_url ?? null,
        theme: undefined,
        lego_catalog: undefined,
        stock_available: stockAvailable,
        carrying_value: carryingValue,
        units_sold: unitsSold,
        revenue,
        skus: enrichedSkus,
        channel_listings: allChannelListings,
        source_data: sourceData,
      };
    } else if (action === "update-product") {
      const { product_id, ...fields } = params;
      const allowed = [
        "product_hook", "description", "highlights", "call_to_action",
        "seo_title", "seo_description", "age_range", "age_mark",
        "length_cm", "width_cm", "height_cm", "weight_kg", "weight_g",
        "include_catalog_img", "ean", "set_number", "dimensions_cm",
        "name", "piece_count", "minifigs_count", "retail_price", "product_type",
        "retired_flag", "retired_date", "released_date", "release_year",
        "version_descriptor", "brand", "subtheme_name",
        "brickeconomy_id", "bricklink_item_no", "brickowl_boid", "rebrickable_id",
        "field_overrides",
      ];
      const updates: Record<string, any> = {};
      for (const k of allowed) {
        if (k in fields) updates[k] = fields[k];
      }

      // Handle theme_name: look up or create theme, then set theme_id
      if ("theme_name" in fields) {
        const themeName = fields.theme_name?.trim() || null;
        if (themeName) {
          // Try to find existing theme
          let { data: theme } = await admin
            .from("theme")
            .select("id")
            .eq("name", themeName)
            .maybeSingle();
          if (!theme) {
            // Create new theme
            const { data: newTheme, error: themeErr } = await admin
              .from("theme")
              .insert({ name: themeName, slug: slugify(themeName) })
              .select("id")
              .single();
            if (themeErr) throw themeErr;
            theme = newTheme;
          }
          updates.theme_id = theme.id;
        } else {
          updates.theme_id = null;
        }
      }

      if (Object.keys(updates).length === 0) throw new ValidationError("No valid fields to update");
      const { error } = await admin.from("product").update(updates).eq("id", product_id);
      if (error) throw error;
      result = { success: true };
    } else if (action === "update-channel-listing") {
      const { listing_id, ...fields } = params;
      const allowed = ["listing_title", "listing_description"];
      const updates: Record<string, any> = {};
      for (const k of allowed) {
        if (k in fields) updates[k] = fields[k];
      }
      if (Object.keys(updates).length === 0) throw new ValidationError("No valid fields to update");
      const { error } = await admin.from("channel_listing").update(updates).eq("id", listing_id);
      if (error) throw error;
      result = { success: true };
    } else if (action === "create-web-listing") {
      const { sku_id, listed_price } = params;
      if (!sku_id) throw new ValidationError("sku_id is required");

      // Fetch SKU details
      const { data: sku, error: skuErr } = await admin
        .from("sku")
        .select("id, sku_code, price")
        .eq("id", sku_id)
        .single();
      if (skuErr || !sku) throw new ValidationError("SKU not found");

      // Resolve price: caller-supplied > database
      let finalPrice = (typeof listed_price === "number" && listed_price > 0) ? listed_price : sku.price;
      if (!finalPrice || finalPrice <= 0) throw new ValidationError("Cannot list: SKU has no valid price. Calculate pricing first.");

      // Validate against floor price from existing listing
      const { data: existingListing } = await admin
        .from("channel_listing")
        .select("price_floor")
        .eq("sku_id", sku_id)
        .eq("channel", "web")
        .maybeSingle();
      if (existingListing?.price_floor != null && finalPrice < existingListing.price_floor) {
        // Bump to floor price to prevent listing below cost
        finalPrice = existingListing.price_floor;
      }

      // Sync resolved price back to SKU
      await admin.from("sku").update({ price: finalPrice }).eq("id", sku_id);

      // Upsert channel_listing for web
      const { error: uErr } = await admin.from("channel_listing").upsert(
        {
          channel: "web",
          external_sku: sku.sku_code,
          sku_id: sku.id,
          listed_price: finalPrice,
          listed_quantity: 0,
          offer_status: "PUBLISHED",
          listing_title: null,
          listing_description: null,
          price_floor: null,
          price_target: null,
          price_ceiling: null,
          confidence_score: null,
          pricing_notes: null,
          priced_at: null,
          synced_at: new Date().toISOString(),
        },
        { onConflict: "channel,external_sku", ignoreDuplicates: false }
      );
      if (uErr) throw uErr;
      result = { success: true };
    } else if (action === "remove-web-listing") {
      const { sku_id } = params;
      if (!sku_id) throw new ValidationError("sku_id is required");

      const { error: dErr } = await admin
        .from("channel_listing")
        .delete()
        .eq("sku_id", sku_id)
        .eq("channel", "web");
      if (dErr) throw dErr;
      result = { success: true };

    /* ── Media CRUD ── */

    } else if (action === "list-product-media") {
      const { product_id: pid } = params;
      if (!pid) throw new ValidationError("product_id is required");
      const { data, error } = await admin
        .from("product_media")
        .select("id, sort_order, is_primary, media_asset:media_asset_id(id, original_url, alt_text, mime_type, width, height, file_size_bytes)")
        .eq("product_id", pid)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      result = (data ?? []).map((pm: any) => ({
        ...pm.media_asset,
        id: pm.id,
        sort_order: pm.sort_order,
        is_primary: pm.is_primary,
        media_asset_id: pm.media_asset?.id,
      }));

    } else if (action === "delete-product-media") {
      const { product_media_id, media_asset_id: maId } = params;
      if (!product_media_id) throw new ValidationError("product_media_id is required");

      // Get the media asset to find storage path
      if (maId) {
        const { data: asset } = await admin.from("media_asset").select("original_url").eq("id", maId).maybeSingle();
        if (asset?.original_url) {
          // Extract storage path from URL
          const url = asset.original_url;
          const bucketSegment = "/storage/v1/object/public/media/";
          const idx = url.indexOf(bucketSegment);
          if (idx !== -1) {
            const storagePath = url.substring(idx + bucketSegment.length);
            await admin.storage.from("media").remove([storagePath]);
          }
        }
        await admin.from("media_asset").delete().eq("id", maId);
      }

      // product_media row cascades from media_asset delete, but delete explicitly too
      await admin.from("product_media").delete().eq("id", product_media_id);
      result = { success: true };

    } else if (action === "reorder-product-media") {
      const { items } = params;
      if (!Array.isArray(items)) throw new ValidationError("items array is required");
      for (const item of items) {
        const { error: reorderErr } = await admin.from("product_media").update({ sort_order: item.sort_order }).eq("id", item.id);
        if (reorderErr) throw reorderErr;
      }
      result = { success: true };

    } else if (action === "update-media-alt-text") {
      const { media_asset_id: maId, alt_text } = params;
      if (!maId) throw new ValidationError("media_asset_id is required");
      const { error } = await admin.from("media_asset").update({ alt_text }).eq("id", maId);
      if (error) throw error;
      result = { success: true };

    } else if (action === "set-primary-media") {
      const { product_id: pid, product_media_id } = params;
      if (!pid || !product_media_id) throw new ValidationError("product_id and product_media_id required");

      // Clear all primary flags for this product
      const { error: clearErr } = await admin.from("product_media").update({ is_primary: false }).eq("product_id", pid);
      if (clearErr) throw clearErr;
      // Set the chosen one
      const { error: setErr } = await admin.from("product_media").update({ is_primary: true }).eq("id", product_media_id);
      if (setErr) throw setErr;

      // Update product.img_url from the media asset
      const { data: pm, error: pmErr } = await admin
        .from("product_media")
        .select("media_asset:media_asset_id(original_url)")
        .eq("id", product_media_id)
        .maybeSingle();
      if (pmErr) throw pmErr;
      if (pm?.media_asset) {
        const { error: imgErr } = await admin.from("product").update({ img_url: (pm.media_asset as any).original_url }).eq("id", pid);
        if (imgErr) throw imgErr;
      }
      result = { success: true };

    /* ── Channel Fee Schedule CRUD ── */

    } else if (action === "list-channel-fees") {
      const { data, error } = await admin
        .from("channel_fee_schedule")
        .select("*")
        .order("channel")
        .order("fee_name");
      if (error) throw error;
      result = data;

    } else if (action === "upsert-channel-fee") {
      const { id: feeId, channel, fee_name, rate_percent, fixed_amount, min_amount, max_amount, applies_to, active, notes } = params;
      const row: Record<string, any> = { channel, fee_name, rate_percent: rate_percent ?? 0, fixed_amount: fixed_amount ?? 0, applies_to: applies_to ?? "sale_price", active: active ?? true };
      if (min_amount !== undefined) row.min_amount = min_amount;
      if (max_amount !== undefined) row.max_amount = max_amount;
      if (notes !== undefined) row.notes = notes;
      if (feeId) row.id = feeId;
      const { error } = await admin.from("channel_fee_schedule").upsert(row, { onConflict: "id" });
      if (error) throw error;
      result = { success: true };

    } else if (action === "delete-channel-fee") {
      const { id: feeId } = params;
      if (!feeId) throw new ValidationError("id is required");
      const { error } = await admin.from("channel_fee_schedule").delete().eq("id", feeId);
      if (error) throw error;
      result = { success: true };

    /* ── Shipping Rate Table CRUD ── */

    } else if (action === "list-shipping-rates") {
      const { data, error } = await admin
        .from("shipping_rate_table")
        .select("*")
        .order("carrier")
        .order("max_weight_kg");
      if (error) throw error;
      result = data;

    } else if (action === "upsert-shipping-rate") {
      const { id: rateId, channel, carrier, service_name, max_weight_kg, max_length_cm, max_width_cm, max_depth_cm, max_girth_cm, size_band, cost, price_ex_vat, price_inc_vat, vat_exempt, tracked, max_compensation, est_delivery, active } = params;
      const row: Record<string, any> = {
        channel: channel ?? "default", carrier, service_name, max_weight_kg,
        cost: cost ?? price_ex_vat ?? 0, active: active ?? true,
      };
      if (max_length_cm !== undefined) row.max_length_cm = max_length_cm;
      if (max_width_cm !== undefined) row.max_width_cm = max_width_cm;
      if (max_depth_cm !== undefined) row.max_depth_cm = max_depth_cm;
      if (max_girth_cm !== undefined) row.max_girth_cm = max_girth_cm;
      if (size_band !== undefined) row.size_band = size_band;
      if (price_ex_vat !== undefined) { row.price_ex_vat = price_ex_vat; row.cost = price_ex_vat; }
      if (price_inc_vat !== undefined) row.price_inc_vat = price_inc_vat;
      if (vat_exempt !== undefined) row.vat_exempt = vat_exempt;
      if (tracked !== undefined) row.tracked = tracked;
      if (max_compensation !== undefined) row.max_compensation = max_compensation;
      if (est_delivery !== undefined) row.est_delivery = est_delivery;
      if (rateId) row.id = rateId;
      const { error } = await admin.from("shipping_rate_table").upsert(row, { onConflict: "id" });
      if (error) throw error;
      result = { success: true };

    } else if (action === "delete-shipping-rate") {
      const { id: rateId } = params;
      if (!rateId) throw new ValidationError("id is required");
      const { error } = await admin.from("shipping_rate_table").delete().eq("id", rateId);
      if (error) throw error;
      result = { success: true };

    /* ── Selling Cost Defaults CRUD ── */

    } else if (action === "list-selling-cost-defaults") {
      const { data, error } = await admin
        .from("selling_cost_defaults")
        .select("*")
        .order("key");
      if (error) throw error;
      result = data;

    } else if (action === "upsert-selling-cost-default") {
      const { key: dKey, value: dValue } = params;
      if (!dKey) throw new ValidationError("key is required");
      const { error } = await admin.from("selling_cost_defaults").upsert(
        { key: dKey, value: dValue ?? 0, updated_at: new Date().toISOString() },
        { onConflict: "key" }
      );
      if (error) throw error;
      result = { success: true };

    /* ── Calculate Selling Costs ── */

    } else if (action === "calculate-selling-costs") {
      const { sku_id, channel, sale_price, shipping_charged } = params;
      if (!sku_id || !channel || sale_price === undefined) throw new ValidationError("sku_id, channel, and sale_price are required");

      // 1. Get SKU → product dimensions
      const { data: skuData } = await admin
        .from("sku")
        .select("id, price, product:product_id(weight_kg, length_cm, width_cm, height_cm)")
        .eq("id", sku_id)
        .single();
      const product = (skuData?.product as any) ?? {};
      const weightKg = product.weight_kg ?? 0;
      const lengthCm = product.length_cm;
      const widthCm = product.width_cm;
      const heightCm = product.height_cm;
      const hasDimensions = lengthCm != null && widthCm != null && heightCm != null;

      // 2. Get carrying value (avg of available stock)
      const { data: stockUnits } = await admin
        .from("stock_unit")
        .select("carrying_value")
        .eq("sku_id", sku_id)
        .eq("status", "available");
      const avgCarrying = stockUnits && stockUnits.length > 0
        ? stockUnits.reduce((sum: number, su: any) => sum + (su.carrying_value ?? 0), 0) / stockUnits.length
        : 0;

      // 3. Get active fees for channel
      const { data: fees } = await admin
        .from("channel_fee_schedule")
        .select("*")
        .eq("channel", channel)
        .eq("active", true);

      // 4. Calculate channel fees
      let totalChannelFees = 0;
      const feeBreakdown: { fee_name: string; amount: number }[] = [];
      const salePrice = Number(sale_price);
      const shippingCharged = Number(shipping_charged ?? 0);
      for (const fee of fees ?? []) {
        let base = salePrice;
        if (fee.applies_to === "sale_plus_shipping") base = salePrice + shippingCharged;
        else if (fee.applies_to === "sale_price_inc_vat") base = salePrice * 1.2;
        let amount = (base * (fee.rate_percent / 100)) + (fee.fixed_amount ?? 0);
        if (fee.min_amount != null && amount < fee.min_amount) amount = fee.min_amount;
        if (fee.max_amount != null && amount > fee.max_amount) amount = fee.max_amount;
        amount = Math.round(amount * 100) / 100;
        totalChannelFees += amount;
        feeBreakdown.push({ fee_name: fee.fee_name, amount });
      }

      // 5. Get shipping cost — dimension-aware matching
      let shippingCost = 0;
      let matchedRate: any = null;

      // Fetch all active rates for channel
      const { data: allRates } = await admin
        .from("shipping_rate_table")
        .select("*")
        .or(`channel.eq.${channel},channel.eq.default`)
        .eq("active", true)
        .gte("max_weight_kg", weightKg)
        .order("cost", { ascending: true });

      if (hasDimensions && allRates && allRates.length > 0) {
        // Filter by dimensions: length, width, depth (height)
        matchedRate = allRates.find((r: any) =>
          (r.max_length_cm == null || r.max_length_cm >= lengthCm) &&
          (r.max_width_cm == null || r.max_width_cm >= widthCm) &&
          (r.max_depth_cm == null || r.max_depth_cm >= heightCm)
        );
      }

      if (!matchedRate) {
        // Default to Evri Small Parcel (cheapest that fits weight)
        const evriSmall = (allRates ?? []).filter((r: any) =>
          r.carrier === "Evri" && r.size_band === "Small Parcel"
        );
        matchedRate = evriSmall.length > 0 ? evriSmall[0] : (allRates && allRates.length > 0 ? allRates[0] : null);
      }

      shippingCost = matchedRate ? Number(matchedRate.cost) : 0;

      // 6. Get defaults
      const { data: defaults } = await admin
        .from("selling_cost_defaults")
        .select("key, value");
      const defaultsMap: Record<string, number> = {};
      for (const d of defaults ?? []) defaultsMap[d.key] = Number(d.value);
      const packagingCost = defaultsMap["packaging_cost"] ?? 0;
      const riskReserveRate = defaultsMap["risk_reserve_rate"] ?? 0;
      const riskReserve = Math.round(salePrice * (riskReserveRate / 100) * 100) / 100;

      const totalCostToSell = Math.round((avgCarrying + packagingCost + shippingCost + totalChannelFees + riskReserve) * 100) / 100;

      result = {
        carrying_value: Math.round(avgCarrying * 100) / 100,
        packaging_cost: packagingCost,
        shipping_cost: shippingCost,
        channel_fees: Math.round(totalChannelFees * 100) / 100,
        fee_breakdown: feeBreakdown,
        risk_reserve: riskReserve,
        total_cost_to_sell: totalCostToSell,
        margin: Math.round((salePrice - totalCostToSell) * 100) / 100,
        margin_percent: salePrice > 0 ? Math.round(((salePrice - totalCostToSell) / salePrice) * 10000) / 100 : 0,
      };

    /* ── Pricing Engine ── */

    } else if (action === "calculate-pricing") {
      const { sku_id, channel } = params;
      if (!sku_id || !channel) throw new ValidationError("sku_id and channel are required");

      // 1. Get SKU + product info
      const { data: skuData } = await admin
        .from("sku")
        .select("id, sku_code, price, condition_grade, product:product_id(id, mpn, weight_kg, length_cm, width_cm, height_cm)")
        .eq("id", sku_id)
        .single();
      if (!skuData) throw new ValidationError("SKU not found");
      const product = (skuData.product as any) ?? {};
      const mpn = product.mpn;

      // 2. Get defaults
      const { data: defaults } = await admin
        .from("selling_cost_defaults")
        .select("key, value");
      const dm: Record<string, number> = {};
      for (const d of defaults ?? []) dm[d.key] = Number(d.value);
      const minProfit = dm["minimum_profit_amount"] ?? 1;
      const minMargin = dm["minimum_margin_rate"] ?? 0.15;
      const packagingCost = dm["packaging_cost"] ?? 0;
      const riskReserveRate = dm["risk_reserve_rate"] ?? 0;
      const condMultiplier = dm[`condition_multiplier_${skuData.condition_grade}`] ?? 1;

      // 3. Get carrying value (avg of available stock)
      const { data: stockUnits } = await admin
        .from("stock_unit")
        .select("carrying_value")
        .eq("sku_id", sku_id)
        .eq("status", "available");
      const avgCarrying = stockUnits && stockUnits.length > 0
        ? stockUnits.reduce((sum: number, su: any) => sum + (su.carrying_value ?? 0), 0) / stockUnits.length
        : 0;

      // 4. Get shipping cost — Evri-first strategy
      const weightKg = product.weight_kg ?? 0;
      const lengthCm = product.length_cm;
      const widthCm = product.width_cm;
      const heightCm = product.height_cm;
      const hasDimensions = lengthCm != null && widthCm != null && heightCm != null;

      // Read Evri tier setting
      const activeTierNum = dm["evri_active_tier"] ?? 1;
      const activeTier = `tier_${activeTierNum}`;
      const preferEvriThreshold = dm["shipping_prefer_evri_threshold"] ?? 1.0;

      // Helper to find best-fit rate from a list
      const findBestFit = (rates: any[]): any => {
        if (hasDimensions && rates.length > 0) {
          const dimMatch = rates.find((r: any) =>
            (r.max_length_cm == null || r.max_length_cm >= lengthCm) &&
            (r.max_width_cm == null || r.max_width_cm >= widthCm) &&
            (r.max_depth_cm == null || r.max_depth_cm >= heightCm)
          );
          if (dimMatch) return dimMatch;
        }
        // Fallback: Evri Small Parcel or cheapest
        const evriSmall = rates.filter((r: any) => r.carrier === "Evri" && r.size_band === "Small Parcel");
        return evriSmall.length > 0 ? evriSmall[0] : (rates.length > 0 ? rates[0] : null);
      };

      // Query Evri direct rates (default channel, active tier)
      const { data: evriRates } = await admin
        .from("shipping_rate_table")
        .select("*")
        .eq("channel", "default")
        .eq("tier", activeTier)
        .eq("destination", "domestic")
        .eq("active", true)
        .gte("max_weight_kg", weightKg)
        .order("cost", { ascending: true });

      let matchedRate = findBestFit(evriRates ?? []);

      // For eBay channel: check if eBay carrier rate offers substantial saving
      if (channel === "ebay" && matchedRate) {
        const { data: ebayRates } = await admin
          .from("shipping_rate_table")
          .select("*")
          .eq("channel", "ebay")
          .eq("destination", "domestic")
          .eq("active", true)
          .gte("max_weight_kg", weightKg)
          .order("cost", { ascending: true });

        const ebayBest = findBestFit(ebayRates ?? []);
        if (ebayBest) {
          const saving = Number(matchedRate.cost) - Number(ebayBest.cost);
          if (saving > preferEvriThreshold) {
            matchedRate = ebayBest;
          }
        }
      }

      const shippingCost = matchedRate ? Number(matchedRate.cost) : 0;

      // 5. Get channel fees
      const { data: fees } = await admin
        .from("channel_fee_schedule")
        .select("*")
        .eq("channel", channel)
        .eq("active", true);

      // For floor calculation, we need a cost_base that doesn't depend on sale_price
      // cost_base = carrying_value + packaging + shipping
      const costBase = avgCarrying + packagingCost + shippingCost;

      // 6. Get BrickEconomy valuation as market_consensus
      let marketConsensus: number | null = null;
      let beConfidence = 0;
      if (mpn) {
        // Match by both full MPN (e.g. "10281-1") and base MPN (e.g. "10281")
        const baseMpn = mpn.replace(/-\d+$/, "");
        const candidates = [mpn];
        if (baseMpn !== mpn) candidates.push(baseMpn);
        const { data: beData } = await admin
          .from("brickeconomy_collection")
          .select("current_value")
          .in("item_number", candidates)
          .limit(1)
          .maybeSingle();
        if (beData?.current_value != null) {
          marketConsensus = Number(beData.current_value);
          beConfidence = 1;
        }
      }

      // 7. Compute prices using shared VAT-aware floor calculator
      // Decompose fees into rate-based and fixed components, respecting applies_to
      let effectiveFeeRate = 0;
      let fixedFeeCosts = 0;
      for (const fee of fees ?? []) {
        const rate = (fee.rate_percent ?? 0) / 100;
        const fixed = fee.fixed_amount ?? 0;
        if (fee.applies_to === "sale_plus_shipping") {
          effectiveFeeRate += rate;
          fixedFeeCosts += fixed + (shippingCost * rate);
        } else if (fee.applies_to === "sale_price_inc_vat") {
          effectiveFeeRate += rate * 1.2;
          fixedFeeCosts += fixed;
        } else {
          effectiveFeeRate += rate;
          fixedFeeCosts += fixed;
        }
      }

      const riskRate = riskReserveRate / 100;
      const effectiveMargin = Math.max(minMargin, 0.01);

      // VAT-aware floor: revenue = P/1.2, net fees = gross_fees/1.2
      // P >= 1.2 × (costBase + minProfit + fixedFees/1.2) / (1 - margin - feeRate - risk)
      const netFixedFees = fixedFeeCosts / 1.2;
      const denominator = Math.max(1 - effectiveMargin - effectiveFeeRate - riskRate, 0.05);
      let floorPrice = Math.round((1.2 * (costBase + minProfit + netFixedFees) / denominator) * 100) / 100;

      // Post-check: verify floor covers all fees with min/max clamps (ex-VAT basis)
      for (let i = 0; i < 5; i++) {
        let totalFeesGross = 0;
        for (const fee of fees ?? []) {
          let base = floorPrice;
          if (fee.applies_to === "sale_plus_shipping") base = floorPrice + shippingCost;
          else if (fee.applies_to === "sale_price_inc_vat") base = floorPrice * 1.2;
          let amount = (base * ((fee.rate_percent ?? 0) / 100)) + (fee.fixed_amount ?? 0);
          if (fee.min_amount != null && amount < fee.min_amount) amount = fee.min_amount;
          if (fee.max_amount != null && amount > fee.max_amount) amount = fee.max_amount;
          totalFeesGross += amount;
        }
        const netFees = totalFeesGross / 1.2;
        const riskReserve = (floorPrice / 1.2) * riskRate;
        const requiredExVat = costBase + minProfit + netFees + riskReserve;
        const neededPrice = 1.2 * requiredExVat / (1 - effectiveMargin);
        if (neededPrice <= floorPrice + 0.01) break;
        floorPrice = Math.round(neededPrice * 100) / 100;
      }

      // Also consider existing SKU price as a reference when no market data
      const existingSkuPrice = skuData.price != null ? Number(skuData.price) : null;

      // Ceiling: highest of floor, market consensus, and existing SKU price
      const ceilingBasis = Math.max(floorPrice, marketConsensus ?? floorPrice, existingSkuPrice ?? floorPrice);
      const ceilingPrice = Math.floor(ceilingBasis) + 0.99;

      let targetPrice: number;
      if (marketConsensus != null) {
        targetPrice = Math.floor(marketConsensus * condMultiplier) + 0.99;
        // Ensure target is at least the floor
        if (targetPrice < floorPrice) targetPrice = floorPrice;
      } else {
        // No market data — default target to ceiling price
        targetPrice = ceilingPrice;
      }

      // 8. Confidence score (0-1): based on data availability
      let confidence = 0;
      if (avgCarrying > 0) confidence += 0.3; // have stock cost
      if (beConfidence > 0) confidence += 0.4; // have market data
      if (hasDimensions) confidence += 0.15; // have dimensions for shipping
      if ((fees ?? []).length > 0) confidence += 0.15; // have channel fees
      confidence = Math.round(confidence * 100) / 100;

      result = {
        sku_id,
        channel,
        floor_price: floorPrice,
        target_price: targetPrice,
        ceiling_price: ceilingPrice,
        cost_base: Math.round(costBase * 100) / 100,
        carrying_value: Math.round(avgCarrying * 100) / 100,
        market_consensus: marketConsensus,
        condition_multiplier: condMultiplier,
        confidence_score: confidence,
        breakdown: {
          carrying_value: Math.round(avgCarrying * 100) / 100,
          packaging_cost: packagingCost,
          shipping_cost: shippingCost,
          total_fee_rate: Math.round(effectiveFeeRate * 10000) / 100,
          fixed_fee_costs: Math.round(fixedFeeCosts * 100) / 100,
          risk_reserve_rate: riskReserveRate,
          min_profit: minProfit,
          min_margin: minMargin * 100,
        },
      };

    } else if (action === "batch-calculate-pricing") {
      const { channel: batchChannel } = params;
      // Default to "web" channel when not specified or "all"
      const targetChannel = (batchChannel && batchChannel !== "all") ? batchChannel : "web";

      // 1. Get all active SKUs with a product (orphan SKUs without product_id are excluded)
      const { data: activeSkus, error: skuErr } = await admin
        .from("sku")
        .select("id, sku_code")
        .eq("active_flag", true)
        .not("product_id", "is", null);
      if (skuErr) throw skuErr;

      // 2. Get existing channel_listing rows for target channel
      const { data: existingListings, error: elErr } = await admin
        .from("channel_listing")
        .select("id, sku_id, channel")
        .eq("channel", targetChannel)
        .not("sku_id", "is", null);
      if (elErr) throw elErr;

      const listedSkuIds = new Set((existingListings ?? []).map((l: any) => l.sku_id));

      // 3. Auto-create missing channel_listing rows for SKUs that don't have one
      const missing = (activeSkus ?? []).filter((s: any) => !listedSkuIds.has(s.id));
      if (missing.length > 0) {
        const newRows = missing.map((s: any) => ({
          channel: targetChannel,
          external_sku: s.sku_code,
          sku_id: s.id,
          listed_quantity: 0,
          offer_status: "DRAFT",
          synced_at: new Date().toISOString(),
        }));
        await admin.from("channel_listing").upsert(newRows, { onConflict: "channel,external_sku", ignoreDuplicates: true });
      }

      // 4. Re-fetch all listings for the target channel
      const { data: allListings, error: alErr } = await admin
        .from("channel_listing")
        .select("id, sku_id, channel")
        .eq("channel", targetChannel)
        .not("sku_id", "is", null);
      if (alErr) throw alErr;

      const results = (allListings ?? []).map((l: any) => ({
        listing_id: l.id, sku_id: l.sku_id, channel: l.channel,
      }));
      result = { listings: results, total: results.length };

    } else if (action === "update-listing-prices") {
      const { listing_id, price_floor, price_target, price_ceiling, confidence_score: cs, pricing_notes: pn, auto_price } = params;
      if (!listing_id) throw new ValidationError("listing_id is required");
      const updates: Record<string, any> = { priced_at: new Date().toISOString() };
      if (price_floor !== undefined) updates.price_floor = price_floor;
      if (price_target !== undefined) updates.price_target = price_target;
      if (price_ceiling !== undefined) updates.price_ceiling = price_ceiling;
      if (cs !== undefined) updates.confidence_score = cs;
      if (pn !== undefined) updates.pricing_notes = pn;

      let auto_price_applied = false;
      let auto_price_reason = "";

      if (auto_price && price_target != null) {
        // Guard: reject zero/negative target
        if (price_target <= 0) {
          auto_price_reason = "Target price is zero or negative. Skipped.";
        // Guard: reject target below floor
        } else if (price_floor != null && price_target < price_floor) {
          auto_price_reason = `Target £${price_target} is below floor £${price_floor}. Skipped.`;
        } else {
        // Look up listing to get channel and current listed_price
        const { data: listing } = await admin.from("channel_listing").select("channel, listed_price").eq("id", listing_id).single();
        if (listing) {
          const { data: config } = await admin.from("channel_pricing_config").select("*").eq("channel", listing.channel).single();
          if (config?.auto_price_enabled) {
            const currentPrice = listing.listed_price;
            if (currentPrice == null) {
              // No current price, just set it
              updates.listed_price = price_target;
              auto_price_applied = true;
              auto_price_reason = "Initial price set";
            } else {
              const delta = price_target - currentPrice;
              if (Math.abs(delta) < 0.005) {
                auto_price_reason = "No change needed";
              } else if (delta > 0) {
                // Price increase
                const pctOk = config.max_increase_pct == null || (delta / currentPrice) <= config.max_increase_pct;
                const amtOk = config.max_increase_amount == null || delta <= config.max_increase_amount;
                if (pctOk && amtOk) {
                  updates.listed_price = price_target;
                  auto_price_applied = true;
                  auto_price_reason = `Auto-increased from £${currentPrice} to £${price_target}`;
                } else {
                  auto_price_reason = `Increase £${delta.toFixed(2)} exceeds threshold (max ${config.max_increase_pct != null ? (config.max_increase_pct * 100).toFixed(0) + '%' : '∞'}/${config.max_increase_amount != null ? '£' + config.max_increase_amount : '∞'})`;
                }
              } else {
                // Price decrease
                const absDelta = Math.abs(delta);
                const pctOk = config.max_decrease_pct == null || (absDelta / currentPrice) <= config.max_decrease_pct;
                const amtOk = config.max_decrease_amount == null || absDelta <= config.max_decrease_amount;
                if (pctOk && amtOk) {
                  updates.listed_price = price_target;
                  auto_price_applied = true;
                  auto_price_reason = `Auto-decreased from £${currentPrice} to £${price_target}`;
                } else {
                  auto_price_reason = `Decrease £${absDelta.toFixed(2)} exceeds threshold (max ${config.max_decrease_pct != null ? (config.max_decrease_pct * 100).toFixed(0) + '%' : '∞'}/${config.max_decrease_amount != null ? '£' + config.max_decrease_amount : '∞'})`;
                }
              }
            }
            if (auto_price_reason) {
              updates.pricing_notes = [pn, auto_price_reason].filter(Boolean).join("; ");
            }
          } else {
            auto_price_reason = "Auto-pricing disabled for channel";
          }
        }
        } // end else (valid target)
        // If skipped due to guards, still record the reason
        if (!auto_price_applied && auto_price_reason) {
          updates.pricing_notes = [pn, auto_price_reason].filter(Boolean).join("; ");
        }
      }

      const { error } = await admin.from("channel_listing").update(updates).eq("id", listing_id);
      if (error) throw error;

      // Always sync floor_price and sale_price back to the SKU
      const { data: listingRow } = await admin.from("channel_listing").select("sku_id, channel").eq("id", listing_id).single();
      if (listingRow?.sku_id) {
        const skuUpdates: Record<string, any> = {};
        // Update SKU floor_price from the calculated floor
        if (price_floor != null) skuUpdates.floor_price = price_floor;
        // If auto-price was applied on the web channel, also update sku.price for storefront
        if (auto_price_applied && updates.listed_price != null && listingRow.channel === "web") {
          skuUpdates.price = updates.listed_price;
        }
        if (Object.keys(skuUpdates).length > 0) {
          await admin.from("sku").update(skuUpdates).eq("id", listingRow.sku_id);
        }
      }

      result = { success: true, auto_price_applied, auto_price_reason };

    } else if (action === "list-channel-pricing-config") {
      const { data, error } = await admin.from("channel_pricing_config").select("*").order("channel");
      if (error) throw error;
      result = data;

    } else if (action === "upsert-channel-pricing-config") {
      const { channel, auto_price_enabled, max_increase_pct, max_increase_amount, max_decrease_pct, max_decrease_amount } = params;
      if (!channel) throw new Error("channel is required");
      const { error } = await admin.from("channel_pricing_config").upsert({
        channel,
        auto_price_enabled: auto_price_enabled ?? false,
        max_increase_pct: max_increase_pct ?? null,
        max_increase_amount: max_increase_amount ?? null,
        max_decrease_pct: max_decrease_pct ?? null,
        max_decrease_amount: max_decrease_amount ?? null,
      }, { onConflict: "channel" });
      if (error) throw error;
      result = { success: true };

    } else if (action === "ensure-channel-listing") {
      const { sku_id, channel } = params;
      if (!sku_id || !channel) throw new Error("sku_id and channel are required");

      // Check for existing listing
      const { data: existing } = await admin
        .from("channel_listing")
        .select("id")
        .eq("sku_id", sku_id)
        .eq("channel", channel)
        .limit(1)
        .maybeSingle();

      if (existing) {
        result = { listing_id: existing.id, created: false };
      } else {
        // Get SKU code for external_sku
        const { data: sku } = await admin
          .from("sku")
          .select("sku_code")
          .eq("id", sku_id)
          .single();
        if (!sku) throw new Error("SKU not found");

        const { data: newListing, error: insertErr } = await admin
          .from("channel_listing")
          .upsert({
            channel,
            external_sku: sku.sku_code,
            sku_id,
            listed_quantity: 0,
            offer_status: "DRAFT",
            synced_at: new Date().toISOString(),
          }, { onConflict: "channel,external_sku", ignoreDuplicates: false })
          .select("id")
          .single();
        if (insertErr) throw insertErr;
        result = { listing_id: newListing!.id, created: true };
      }

    /* ── LEGO Catalog ── */

    } else if (action === "list-lego-catalog") {
      const page = params.page ?? 1;
      const pageSize = Math.min(params.pageSize ?? 25, 200);
      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;
      const sortKey = params.sortKey ?? "mpn";
      const sortDir = params.sortDir === "desc" ? false : true; // ascending by default

      let query = admin
        .from("lego_catalog")
        .select("*, theme:theme_id(name)", { count: "exact" });

      // Search
      if (params.search) {
        const term = `%${params.search}%`;
        query = query.or(`name.ilike.${term},mpn.ilike.${term}`);
      }

      // Filters
      if (params.theme_id) query = query.eq("theme_id", params.theme_id);
      if (params.subtheme_name) query = query.eq("subtheme_name", params.subtheme_name);
      if (params.year) query = query.eq("release_year", Number(params.year));
      if (params.retired === "yes") query = query.eq("retired_flag", true);
      else if (params.retired === "no") query = query.eq("retired_flag", false);
      if (params.product_type) query = query.eq("product_type", params.product_type);
      if (params.status) query = query.eq("status", params.status);

      // Sort & paginate
      const sortColumn = ["mpn", "name", "release_year", "piece_count", "retired_flag", "product_type", "status", "created_at", "updated_at"].includes(sortKey) ? sortKey : "mpn";
      query = query.order(sortColumn, { ascending: sortDir }).range(from, to);

      const { data, count, error } = await query;
      if (error) throw error;

      // Flatten theme name
      const rows = (data ?? []).map((r: any) => ({
        ...r,
        theme_name: r.theme?.name ?? null,
        theme: undefined,
      }));

      result = { rows, totalCount: count ?? 0 };

    } else if (action === "lego-catalog-filter-options") {
      // Fetch distinct values for filter dropdowns
      const { data: themes, error: tErr } = await admin
        .from("theme")
        .select("id, name")
        .order("name");
      if (tErr) throw tErr;

      const { data: subthemes, error: sErr } = await admin
        .from("lego_catalog")
        .select("subtheme_name")
        .not("subtheme_name", "is", null)
        .order("subtheme_name");
      if (sErr) throw sErr;
      const uniqueSubthemes = [...new Set((subthemes ?? []).map((r: any) => r.subtheme_name).filter(Boolean))].sort();

      const { data: years, error: yErr } = await admin
        .from("lego_catalog")
        .select("release_year")
        .not("release_year", "is", null)
        .order("release_year", { ascending: false });
      if (yErr) throw yErr;
      const uniqueYears = [...new Set((years ?? []).map((r: any) => r.release_year).filter(Boolean))];

      const { data: productTypes, error: ptErr } = await admin
        .from("lego_catalog")
        .select("product_type")
        .order("product_type");
      if (ptErr) throw ptErr;
      const uniqueProductTypes = [...new Set((productTypes ?? []).map((r: any) => r.product_type).filter(Boolean))].sort();

      result = {
        themes: themes ?? [],
        subthemes: uniqueSubthemes,
        years: uniqueYears,
        productTypes: uniqueProductTypes,
      };

    } else if (action === "update-lego-catalog") {
      const { id, updates: rawUpdates } = params;
      if (!id) throw new ValidationError("id is required");
      if (!rawUpdates || typeof rawUpdates !== "object") throw new ValidationError("updates object is required");

      const ALLOWED_FIELDS = new Set([
        "name", "mpn", "subtheme_name", "piece_count", "release_year", "retired_flag",
        "description", "img_url", "product_type", "status", "version_descriptor",
        "brickeconomy_id", "bricklink_item_no", "brickowl_boid", "rebrickable_id", "theme_id",
      ]);

      const cleanUpdates: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(rawUpdates)) {
        if (ALLOWED_FIELDS.has(k)) cleanUpdates[k] = v;
      }
      if (Object.keys(cleanUpdates).length === 0) throw new ValidationError("No valid fields to update");

      cleanUpdates.updated_at = new Date().toISOString();

      const { data, error } = await admin
        .from("lego_catalog")
        .update(cleanUpdates)
        .eq("id", id)
        .select("*, theme:theme_id(name)")
        .single();
      if (error) throw error;

      result = { ...data, theme_name: (data as any).theme?.name ?? null, theme: undefined };

    } else if (action === "reconcile-stock") {
      // ── Reconcile stock: first close sold stock, then compare counts with QBO ──
      // Step A: Find sales order lines without linked stock and match available stock (FIFO)
      // Step B: Compare remaining app counts against QBO QtyOnHand
      const clientId = Deno.env.get("QBO_CLIENT_ID");
      const clientSecret = Deno.env.get("QBO_CLIENT_SECRET");
      const realmId = Deno.env.get("QBO_REALM_ID");
      if (!clientId || !clientSecret || !realmId) throw new Error("QBO credentials not configured");

      // Refresh token if needed
      const { data: conn, error: connErr } = await admin
        .from("qbo_connection").select("*").eq("realm_id", realmId).single();
      if (connErr || !conn) throw new Error("No QBO connection found");

      let accessToken = conn.access_token;
      if (new Date(conn.token_expires_at).getTime() - Date.now() < 5 * 60 * 1000) {
        const tokenRes = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
            Accept: "application/json",
          },
          body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: conn.refresh_token }),
        });
        if (!tokenRes.ok) throw new Error(`Token refresh failed [${tokenRes.status}]`);
        const tokens = await tokenRes.json();
        const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
        await admin.from("qbo_connection").update({
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          token_expires_at: expiresAt,
        }).eq("realm_id", realmId);
        accessToken = tokens.access_token;
      }

      const baseUrl = `https://quickbooks.api.intuit.com/v3/company/${realmId}`;
      const correlationId = crypto.randomUUID();

      // ── Step A: Close stock for sold orders with unlinked lines ──
      // ── Step A: Close stock for CONFIRMED sales with unlinked lines ──
      // Only process lines from orders that are genuinely completed sales.
      // First, find valid completed order IDs, then find their unlinked lines.
      let stockClosed = 0;
      const closedSkuIds = new Set<string>();

      // Step A0: Reopen stock incorrectly closed by previous runs that
      // didn't filter by order status. Find stock_units closed by our
      // reconciliation audit trail and check if the linked order is valid.
      // (audit_event with trigger_type = 'stock_reconciliation_sale')
      // and check if the linked order is still valid
      const { data: reconciledAudits } = await admin
        .from("audit_event")
        .select("entity_id, input_json")
        .eq("trigger_type", "stock_reconciliation_sale")
        .eq("entity_type", "stock_unit")
        .gte("created_at", new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString())
        .limit(5000);

      let stockReopened = 0;
      for (const audit of (reconciledAudits ?? [])) {
        const lineId = audit.input_json?.sales_order_line_id;
        if (!lineId) continue;

        // Check if the order for this line is actually a valid completed sale
        const { data: lineOrder } = await admin
          .from("sales_order_line")
          .select("sales_order_id, sales_order:sales_order_id(status)")
          .eq("id", lineId)
          .maybeSingle();

        const orderStatus = (lineOrder as any)?.sales_order?.status;
        const validStatuses = VALID_SALE_STATUSES;
        if (orderStatus && !validStatuses.includes(orderStatus)) {
          // This stock was closed for an invalid order — reopen it
          const { error: reopenErr } = await admin
            .from("stock_unit")
            .update({ status: "available", updated_at: new Date().toISOString() })
            .eq("id", audit.entity_id)
            .eq("status", "closed");

          if (!reopenErr) {
            // Unlink from the order line
            await admin
              .from("sales_order_line")
              .update({ stock_unit_id: null })
              .eq("id", lineId)
              .eq("stock_unit_id", audit.entity_id);
            stockReopened++;
          }
        }
      }

      if (stockReopened > 0) {
        console.log(`Step A0: Reopened ${stockReopened} stock units incorrectly closed by prior reconciliation`);
      }

      // Now find unlinked lines ONLY from valid completed orders
      const { data: validOrders } = await admin
        .from("sales_order")
        .select("id")
        .in("status", VALID_SALE_STATUSES);

      const validOrderIds = (validOrders ?? []).map((o: any) => o.id);

      if (validOrderIds.length > 0) {
        // Process in batches (Supabase .in() has limits)
        const BATCH = 100;
        for (let b = 0; b < validOrderIds.length; b += BATCH) {
          const batchIds = validOrderIds.slice(b, b + BATCH);
          const { data: unlinkedLines } = await admin
            .from("sales_order_line")
            .select("id, sku_id, quantity")
            .in("sales_order_id", batchIds)
            .is("stock_unit_id", null);

          for (const line of (unlinkedLines ?? [])) {
            for (let i = 0; i < (line.quantity ?? 1); i++) {
              const { data: stockUnit } = await admin
                .from("stock_unit")
                .select("id")
                .eq("sku_id", line.sku_id)
                .in("status", STOCK_MATCHABLE)
                .order("created_at", { ascending: true })
                .limit(1)
                .maybeSingle();

              if (stockUnit) {
                const { error: closeErr } = await admin
                  .from("stock_unit")
                  .update({ status: "closed", updated_at: new Date().toISOString() })
                  .eq("id", stockUnit.id);

                if (!closeErr) {
                  if ((line.quantity ?? 1) === 1) {
                    await admin
                      .from("sales_order_line")
                      .update({ stock_unit_id: stockUnit.id })
                      .eq("id", line.id);
                  }
                  stockClosed++;
                  closedSkuIds.add(line.sku_id);

                  await admin.from("audit_event").insert({
                    entity_type: "stock_unit",
                    entity_id: stockUnit.id,
                    trigger_type: "stock_reconciliation_sale",
                    actor_type: "user",
                    actor_id: userId,
                    source_system: "admin-data",
                    correlation_id: correlationId,
                    before_json: { status: "available" },
                    after_json: { status: "closed" },
                    input_json: {
                      sales_order_line_id: line.id,
                      sku_id: line.sku_id,
                    },
                  });
                }
              }
            }
          }
        }
      }

      if (stockClosed > 0) {
        console.log(`Step A: Closed ${stockClosed} stock units for ${closedSkuIds.size} SKUs with unlinked sales`);
      }

      // ── Step A2: Update channel listings for closed SKUs ──
      for (const skuId of closedSkuIds) {
        const { count: availableCount } = await admin
          .from("stock_unit")
          .select("id", { count: "exact", head: true })
          .eq("sku_id", skuId)
          .eq("status", "available");

        await admin
          .from("channel_listing")
          .update({ listed_quantity: availableCount ?? 0, synced_at: new Date().toISOString() })
          .eq("sku_id", skuId);
      }

      // ── Step B: Fetch all Inventory items from QBO (paginated) ──
      const qboItems: any[] = [];
      let startPos = 1;
      const pageSize = 1000;
      while (true) {
        const q = encodeURIComponent(`SELECT * FROM Item WHERE Type = 'Inventory' STARTPOSITION ${startPos} MAXRESULTS ${pageSize}`);
        const res = await fetch(`${baseUrl}/query?query=${q}`, {
          headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
        });
        if (!res.ok) throw new Error(`QBO query failed [${res.status}]: ${await res.text()}`);
        const data = await res.json();
        const page = data?.QueryResponse?.Item ?? [];
        qboItems.push(...page);
        if (page.length < pageSize) break;
        startPos += pageSize;
      }

      // Load all SKUs with qbo_item_id
      const { data: allSkus } = await admin
        .from("sku")
        .select("id, qbo_item_id, sku_code");
      const skuByQboId = new Map<string, { id: string; sku_code: string }>();
      for (const s of (allSkus ?? [])) {
        if (s.qbo_item_id) skuByQboId.set(s.qbo_item_id, { id: s.id, sku_code: s.sku_code });
      }

      let totalChecked = 0;
      let inSync = 0;
      let writtenOff = 0;
      let backfilled = 0;
      let appHigher = 0;
      let qboHigher = 0;
      const details: any[] = [];

      for (const qboItem of qboItems) {
        const qboItemId = String(qboItem.Id);
        const sku = skuByQboId.get(qboItemId);
        if (!sku) continue;

        const qboQty = Math.floor(Number(qboItem.QtyOnHand ?? 0));

        // Count all non-closed/non-written-off stock (available + received + graded)
        const { count: appCount } = await admin
          .from("stock_unit")
          .select("id", { count: "exact", head: true })
          .eq("sku_id", sku.id)
          .in("status", STOCK_MATCHABLE);
        const available = appCount ?? 0;
        totalChecked++;

        if (available === qboQty) {
          inSync++;
          continue;
        }

        if (available > qboQty) {
          // App has more than QBO — auto write-off excess (FIFO, oldest first)
          const excess = available - qboQty;
          appHigher++;

          const { data: excessUnits } = await admin
            .from("stock_unit")
            .select("id, status, landed_cost, carrying_value")
            .eq("sku_id", sku.id)
            .in("status", STOCK_MATCHABLE)
            .order("created_at", { ascending: true })
            .limit(excess);

          let unitWrittenOff = 0;
          for (const unit of (excessUnits ?? [])) {
            await admin.from("stock_unit").update({
              status: "written_off",
              accumulated_impairment: unit.landed_cost ?? 0,
              updated_at: new Date().toISOString(),
            }).eq("id", unit.id);

            await admin.from("audit_event").insert({
              entity_type: "stock_unit", entity_id: unit.id,
              trigger_type: "stock_reconciliation_write_off", actor_type: "user",
              actor_id: userId, source_system: "admin-data",
              correlation_id: correlationId,
              before_json: { status: unit.status, carrying_value: unit.carrying_value },
              after_json: { status: "written_off", carrying_value: 0 },
              input_json: { sku_code: sku.sku_code, qbo_qty: qboQty, app_qty: available, reason: "app_higher_auto_write_off" },
            });
            unitWrittenOff++;
          }

          writtenOff += unitWrittenOff;
          details.push({
            sku_code: sku.sku_code,
            qbo_qty: qboQty,
            app_qty: available,
            diff: excess,
            direction: "app_higher",
            action: `wrote_off_${unitWrittenOff}`,
          });
        } else {
          // QBO has more than app — report only (do NOT auto-create ghost units)
          const shortfall = qboQty - available;
          qboHigher++;
          details.push({
            sku_code: sku.sku_code,
            qbo_qty: qboQty,
            app_qty: available,
            diff: shortfall,
            direction: "qbo_higher",
            action: "report_only",
          });
        }
      }

      // Sort details so biggest discrepancies appear first
      details.sort((a: any, b: any) => b.diff - a.diff);

      result = {
        success: true,
        correlation_id: correlationId,
        stock_reopened: stockReopened,
        stock_closed: stockClosed,
        stock_written_off: writtenOff,
        stock_backfilled: backfilled,
        total_qbo_items: qboItems.length,
        total_checked: totalChecked,
        in_sync: inSync,
        app_higher: appHigher,
        qbo_higher: qboHigher,
        details,
      };

    } else if (action === "cleanup-orphaned-stock") {
      // Delete ALL stock units with no receipt line link (ghost units from failed rebuilds)
      const { data: orphans } = await admin.from("stock_unit")
        .select("id")
        .is("inbound_receipt_line_id", null);

      const orphanIds = (orphans ?? []).map((o: any) => o.id);
      let deleted = 0;
      if (orphanIds.length > 0) {
        // Delete in batches of 100
        for (let i = 0; i < orphanIds.length; i += 100) {
          const batch = orphanIds.slice(i, i + 100);
          await admin.from("stock_unit").delete().in("id", batch);
          deleted += batch.length;
        }
      }

      await admin.from("audit_event").insert({
        entity_type: "system", entity_id: "00000000-0000-0000-0000-000000000000",
        trigger_type: "cleanup_orphaned_stock", actor_type: "user", actor_id: userId,
        source_system: "admin-data",
        output_json: { orphans_deleted: deleted },
      });

      result = { success: true, orphans_deleted: deleted };

    } else if (action === "rebuild-from-qbo") {
      // Full reset: QBO is the absolute source of truth.
      // Phase 1: Clear ALL QBO landing tables (stale data purge)
      // Phase 2: Delete all canonical transactional data
      // Phase 3: UI drives re-sync from QBO live, then processes
      const rebuildCorrelationId = crypto.randomUUID();
      let receiptsDeleted = 0, ordersDeleted = 0;
      let stockDeleted = 0;
      let payoutsDeleted = 0;

      // ═══ Phase 1: CLEAR all QBO landing tables (fresh start) ═══
      // This ensures deleted QBO records don't get re-created from stale landing data
      let landingPurchasesCleared = 0, landingSalesCleared = 0, landingRefundsCleared = 0;
      let landingItemsCleared = 0, landingCustomersCleared = 0, landingVendorsCleared = 0, landingTaxCleared = 0;

      const clearTable = async (table: string) => {
        const { data } = await admin.from(table).select("id");
        const ids = (data ?? []).map((r: any) => r.id);
        if (ids.length > 0) {
          for (let i = 0; i < ids.length; i += 100) {
            const batch = ids.slice(i, i + 100);
            await admin.from(table).delete().in("id", batch);
          }
        }
        return ids.length;
      };

      landingPurchasesCleared = await clearTable("landing_raw_qbo_purchase");
      landingSalesCleared = await clearTable("landing_raw_qbo_sales_receipt");
      landingRefundsCleared = await clearTable("landing_raw_qbo_refund_receipt");
      landingItemsCleared = await clearTable("landing_raw_qbo_item");
      landingCustomersCleared = await clearTable("landing_raw_qbo_customer");
      landingVendorsCleared = await clearTable("landing_raw_qbo_vendor");
      landingTaxCleared = await clearTable("landing_raw_qbo_tax_entity");
      await clearTable("landing_raw_qbo_deposit");

      console.log(`Phase 1 complete: cleared ${landingPurchasesCleared} purchases, ${landingSalesCleared} sales, ${landingRefundsCleared} refunds, ${landingItemsCleared} items, ${landingCustomersCleared} customers, ${landingVendorsCleared} vendors, ${landingTaxCleared} tax entities from landing tables`);

      // ═══ Phase 2: Delete ALL canonical transactional data ═══

      // Step 1: Delete ALL sales orders — NO stock reopening
      const { data: allOrders } = await admin.from("sales_order").select("id");
      for (const order of (allOrders ?? [])) {
        await admin.from("sales_order_line").delete().eq("sales_order_id", order.id);
        await admin.from("sales_order").delete().eq("id", order.id);
        ordersDeleted++;
      }

      // Step 2: Delete ALL payout data
      const { data: allPayouts } = await admin.from("payouts").select("id");
      for (const payout of (allPayouts ?? [])) {
        const { data: payoutFees } = await admin.from("payout_fee").select("id").eq("payout_id", payout.id);
        for (const fee of (payoutFees ?? [])) {
          await admin.from("payout_fee_line").delete().eq("payout_fee_id", fee.id);
        }
        await admin.from("payout_fee").delete().eq("payout_id", payout.id);
        await admin.from("payout_orders").delete().eq("payout_id", payout.id);
        await admin.from("payouts").delete().eq("id", payout.id);
        payoutsDeleted++;
      }

      // Step 3: Delete ALL stock units
      const { data: allStock } = await admin.from("stock_unit").select("id");
      const allStockIds = (allStock ?? []).map((u: any) => u.id);
      if (allStockIds.length > 0) {
        for (let i = 0; i < allStockIds.length; i += 100) {
          const batch = allStockIds.slice(i, i + 100);
          await admin.from("stock_unit").delete().in("id", batch);
        }
        stockDeleted = allStockIds.length;
      }

      // Step 3b: Delete ALL purchase_line_items then purchase_batches
      let purchaseBatchesDeleted = 0;
      await admin.from("purchase_line_items").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      const { data: allBatches } = await admin.from("purchase_batches").select("id");
      if ((allBatches ?? []).length > 0) {
        for (let i = 0; i < allBatches!.length; i += 100) {
          const batch = allBatches!.slice(i, i + 100);
          await admin.from("purchase_batches").delete().in("id", batch.map((b: any) => b.id));
        }
        purchaseBatchesDeleted = allBatches!.length;
      }

      // Step 4: Delete ALL inbound receipts and lines
      const { data: allReceipts } = await admin.from("inbound_receipt").select("id");
      for (const receipt of (allReceipts ?? [])) {
        await admin.from("inbound_receipt_line").delete().eq("inbound_receipt_id", receipt.id);
        await admin.from("inbound_receipt").delete().eq("id", receipt.id);
        receiptsDeleted++;
      }

      // Step 4b: Delete ALL SKUs
      let skusDeleted = 0;
      const { data: allSkus } = await admin.from("sku").select("id");
      const allSkuIds = (allSkus ?? []).map((s: any) => s.id);
      if (allSkuIds.length > 0) {
        for (let i = 0; i < allSkuIds.length; i += 100) {
          const batch = allSkuIds.slice(i, i + 100);
          await admin.from("price_audit_log").delete().in("sku_id", batch);
        }
        for (let i = 0; i < allSkuIds.length; i += 100) {
          const batch = allSkuIds.slice(i, i + 100);
          await admin.from("sku").delete().in("id", batch);
        }
        skusDeleted = allSkuIds.length;
      }

      // Step 4c: Delete ALL vendors
      let vendorsDeleted = 0;
      const { data: allVendors } = await admin.from("vendor").select("id");
      if ((allVendors ?? []).length > 0) {
        for (const v of allVendors!) {
          await admin.from("vendor").delete().eq("id", v.id);
        }
        vendorsDeleted = allVendors!.length;
      }

      // Step 5: Clean up audit events
      await admin.from("audit_event").delete()
        .in("trigger_type", [
          "qbo_inventory_adjustment", "qbo_qty_backfill",
          "stock_reconciliation_write_off", "stock_reconciliation_backfill",
          "stock_reconciliation_sale", "purchase_reprocessing",
          "cleanup_orphaned_stock",
        ]);

      // Step 6: Reset non-QBO landing tables for re-matching
      const { data: stripeData } = await admin.from("landing_raw_stripe_event")
        .update({ status: "pending", processed_at: null, error_message: null }).neq("status", "pending")
        .select("id");
      const stripeReset = stripeData?.length ?? 0;

      const { data: ebayOrderData } = await admin.from("landing_raw_ebay_order")
        .update({ status: "pending", processed_at: null, error_message: null }).neq("status", "pending")
        .select("id");
      const ebayOrdersReset = ebayOrderData?.length ?? 0;

      const { data: ebayPayoutData } = await admin.from("landing_raw_ebay_payout")
        .update({ status: "pending", processed_at: null, error_message: null }).neq("status", "pending")
        .select("id");
      const ebayPayoutsReset = ebayPayoutData?.length ?? 0;

      const { data: ebayListingData } = await admin.from("landing_raw_ebay_listing")
        .update({ status: "pending", processed_at: null, error_message: null }).neq("status", "pending")
        .select("id");
      const ebayListingsReset = ebayListingData?.length ?? 0;

      // Step 7: Delete ALL customers
      let customersDeleted = 0;
      const { data: allCustomers } = await admin.from("customer").select("id");
      const allCustomerIds = (allCustomers ?? []).map((c: any) => c.id);
      if (allCustomerIds.length > 0) {
        for (let i = 0; i < allCustomerIds.length; i += 100) {
          const batch = allCustomerIds.slice(i, i + 100);
          await admin.from("customer").delete().in("id", batch);
        }
        customersDeleted = allCustomerIds.length;
      }

      // Step 8: Delete ALL tax_code and vat_rate
      let taxCodesDeleted = 0, vatRatesDeleted = 0;
      const { data: allTaxCodes } = await admin.from("tax_code").select("id");
      if ((allTaxCodes ?? []).length > 0) {
        for (const tc of allTaxCodes!) {
          await admin.from("tax_code").delete().eq("id", tc.id);
        }
        taxCodesDeleted = allTaxCodes!.length;
      }
      const { data: allVatRates } = await admin.from("vat_rate").select("id");
      if ((allVatRates ?? []).length > 0) {
        for (const vr of allVatRates!) {
          await admin.from("vat_rate").delete().eq("id", vr.id);
        }
        vatRatesDeleted = allVatRates!.length;
      }

      // Delete eBay payout transactions
      await admin.from("ebay_payout_transactions").delete().neq("id", "00000000-0000-0000-0000-000000000000");

      await admin.from("audit_event").insert({
        entity_type: "system", entity_id: "00000000-0000-0000-0000-000000000000",
        trigger_type: "rebuild_from_qbo", actor_type: "user", actor_id: userId,
        source_system: "admin-data", correlation_id: rebuildCorrelationId,
        output_json: {
          landing_cleared: {
            purchases: landingPurchasesCleared, sales: landingSalesCleared,
            refunds: landingRefundsCleared, items: landingItemsCleared,
            customers: landingCustomersCleared, vendors: landingVendorsCleared,
            tax: landingTaxCleared,
          },
          canonical_deleted: {
            orders: ordersDeleted, receipts: receiptsDeleted, stock: stockDeleted,
            payouts: payoutsDeleted, skus: skusDeleted, vendors: vendorsDeleted,
            customers: customersDeleted, tax_codes: taxCodesDeleted, vat_rates: vatRatesDeleted,
          },
          non_qbo_reset: {
            stripe: stripeReset, ebay_orders: ebayOrdersReset,
            ebay_payouts: ebayPayoutsReset, ebay_listings: ebayListingsReset,
          },
        },
      });

      result = {
        success: true,
        correlation_id: rebuildCorrelationId,
        phase: "landing_cleared_and_canonical_wiped",
        landing_cleared: {
          purchases: landingPurchasesCleared, sales: landingSalesCleared,
          refunds: landingRefundsCleared, items: landingItemsCleared,
          customers: landingCustomersCleared, vendors: landingVendorsCleared,
          tax: landingTaxCleared,
        },
        receipts_deleted: receiptsDeleted,
        orders_deleted: ordersDeleted,
        stock_deleted: stockDeleted,
        payouts_deleted: payoutsDeleted,
        skus_deleted: skusDeleted,
        vendors_deleted: vendorsDeleted,
        stripe_reset: stripeReset,
        ebay_orders_reset: ebayOrdersReset,
        ebay_payouts_reset: ebayPayoutsReset,
        ebay_listings_reset: ebayListingsReset,
        customers_deleted: customersDeleted,
        tax_codes_deleted: taxCodesDeleted,
        vat_rates_deleted: vatRatesDeleted,
      };

    } else if (action === "proxy-function") {
      // Server-side proxy for Edge Functions that are unreachable from the browser
      // (e.g. CORS preflight failure due to cold-start or deployment issues).
      const fnName = params.function;
      if (!fnName || typeof fnName !== "string") throw new ValidationError("Missing 'function' parameter");

      const allowed = ["qbo-sync-sales", "qbo-sync-purchases", "qbo-sync-customers", "qbo-sync-items", "qbo-sync-vendors", "qbo-sync-tax-rates", "qbo-sync-deposits", "stripe-sync-customers", "stripe-sync-products"];
      if (!allowed.includes(fnName)) throw new ValidationError(`Function '${fnName}' not allowed for proxying`);

      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const fnUrl = `${supabaseUrl}/functions/v1/${fnName}`;
      const fnBody = params.body ?? {};

      const fnRes = await fetch(fnUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceRoleKey}`,
          apikey: serviceRoleKey,
          "x-webhook-trigger": "true",
        },
        body: JSON.stringify(fnBody),
      });

      if (!fnRes.ok) {
        let detail = `HTTP ${fnRes.status}`;
        try {
          const errPayload = await fnRes.json();
          detail = errPayload?.error ?? errPayload?.message ?? detail;
        } catch { /* not JSON */ }
        throw new Error(`${fnName} failed: ${detail}`);
      }

      result = await fnRes.json();

    } else if (action === "get-stripe-test-mode") {
      const { data } = await admin.from("app_settings")
        .select("stripe_test_mode").single();
      result = { stripe_test_mode: data?.stripe_test_mode ?? false };

    } else if (action === "get-test-order-count") {
      const { count } = await admin.from("sales_order")
        .select("id", { count: "exact", head: true })
        .eq("is_test", true);
      result = { count: count ?? 0 };

    } else if (action === "set-stripe-test-mode") {
      const { enabled } = params;
      if (typeof enabled !== "boolean") throw new ValidationError("'enabled' must be a boolean");

      await admin.from("app_settings")
        .update({
          stripe_test_mode: enabled,
          updated_at: new Date().toISOString(),
          updated_by: userId,
        })
        .eq("id", "00000000-0000-0000-0000-000000000001");

      // If disabling test mode, clean up all test data
      let ordersDeleted = 0, linesDeleted = 0, stockReopened = 0, eventsDeleted = 0;
      if (!enabled) {
        // 1. Find all test orders
        const { data: testOrders } = await admin.from("sales_order")
          .select("id").eq("is_test", true);

        for (const order of (testOrders ?? [])) {
          // Reopen stock units closed by test order lines
          const { data: lines } = await admin.from("sales_order_line")
            .select("stock_unit_id").eq("sales_order_id", order.id);
          for (const line of (lines ?? [])) {
            if (line.stock_unit_id) {
              const { data: updated } = await admin.from("stock_unit")
                .update({ status: "available" })
                .eq("id", line.stock_unit_id)
                .eq("status", "closed")
                .select("id");
              if (updated?.length) stockReopened++;
            }
          }
          // Delete order lines
          const { data: deletedLines } = await admin.from("sales_order_line")
            .delete().eq("sales_order_id", order.id).select("id");
          linesDeleted += deletedLines?.length ?? 0;

          // Delete audit events for this order
          await admin.from("audit_event").delete()
            .eq("entity_type", "sales_order").eq("entity_id", order.id);
        }

        // 2. Delete test orders
        if ((testOrders ?? []).length > 0) {
          await admin.from("sales_order").delete().eq("is_test", true);
          ordersDeleted = testOrders!.length;
        }

        // 3. Delete test landing events
        const { data: deletedEvents } = await admin.from("landing_raw_stripe_event")
          .delete().eq("is_test", true).select("id");
        eventsDeleted = deletedEvents?.length ?? 0;

        // 4. Audit the cleanup
        await admin.from("audit_event").insert({
          entity_type: "system",
          entity_id: "00000000-0000-0000-0000-000000000001",
          trigger_type: "stripe_test_mode_cleanup",
          actor_type: "user",
          actor_id: userId,
          source_system: "admin-data",
          after_json: {
            orders_deleted: ordersDeleted,
            lines_deleted: linesDeleted,
            stock_reopened: stockReopened,
            events_deleted: eventsDeleted,
          },
        });
      }

      result = {
        success: true,
        stripe_test_mode: enabled,
        cleanup: !enabled ? { orders_deleted: ordersDeleted, lines_deleted: linesDeleted, stock_reopened: stockReopened, events_deleted: eventsDeleted } : undefined,
      };

    } else if (action === "list-staging-errors") {
      // Query all landing tables for error records
      const LANDING_TABLES = [
        { table: "landing_raw_qbo_purchase", entity: "Purchase" },
        { table: "landing_raw_qbo_sales_receipt", entity: "Sales Receipt" },
        { table: "landing_raw_qbo_refund_receipt", entity: "Refund Receipt" },
        { table: "landing_raw_qbo_item", entity: "Item" },
        { table: "landing_raw_qbo_customer", entity: "Customer" },
        { table: "landing_raw_qbo_vendor", entity: "Vendor" },
        { table: "landing_raw_qbo_tax_entity", entity: "Tax Entity" },
        { table: "landing_raw_stripe_event", entity: "Stripe Event" },
        { table: "landing_raw_ebay_order", entity: "eBay Order" },
        { table: "landing_raw_ebay_payout", entity: "eBay Payout" },
        { table: "landing_raw_ebay_listing", entity: "eBay Listing" },
      ];

      const allErrors: any[] = [];
      for (const { table, entity } of LANDING_TABLES) {
        const { data } = await admin.from(table)
          .select("id, external_id, status, error_message, received_at, raw_payload")
          .eq("status", "error")
          .order("received_at", { ascending: false })
          .limit(50);
        for (const row of (data ?? [])) {
          allErrors.push({
            ...row,
            table_name: table,
            entity_type: entity,
          });
        }
      }

      // Sort by received_at desc
      allErrors.sort((a, b) => new Date(b.received_at).getTime() - new Date(a.received_at).getTime());
      result = allErrors;

    } else if (action === "retry-landing-record") {
      const { table, id: recordId } = params;
      if (!table || !recordId) throw new ValidationError("table and id are required");
      const ALLOWED_TABLES = [
        "landing_raw_qbo_purchase", "landing_raw_qbo_sales_receipt", "landing_raw_qbo_refund_receipt",
        "landing_raw_qbo_item", "landing_raw_qbo_customer", "landing_raw_qbo_vendor",
        "landing_raw_qbo_tax_entity", "landing_raw_stripe_event",
        "landing_raw_ebay_order", "landing_raw_ebay_payout", "landing_raw_ebay_listing",
      ];
      if (!ALLOWED_TABLES.includes(table)) throw new ValidationError(`Invalid table: ${table}`);
      const { error } = await admin.from(table)
        .update({ status: "pending", processed_at: null, error_message: null })
        .eq("id", recordId);
      if (error) throw error;
      result = { success: true };

    } else if (action === "skip-landing-record") {
      const { table, id: recordId } = params;
      if (!table || !recordId) throw new ValidationError("table and id are required");
      const ALLOWED_TABLES = [
        "landing_raw_qbo_purchase", "landing_raw_qbo_sales_receipt", "landing_raw_qbo_refund_receipt",
        "landing_raw_qbo_item", "landing_raw_qbo_customer", "landing_raw_qbo_vendor",
        "landing_raw_qbo_tax_entity", "landing_raw_stripe_event",
        "landing_raw_ebay_order", "landing_raw_ebay_payout", "landing_raw_ebay_listing",
      ];
      if (!ALLOWED_TABLES.includes(table)) throw new ValidationError(`Invalid table: ${table}`);
      const { error } = await admin.from(table)
        .update({ status: "skipped", processed_at: new Date().toISOString() })
        .eq("id", recordId);
      if (error) throw error;
      result = { success: true };

    } else if (action === "reconcile-purchases" || action === "reconcile-sales" ||
               action === "reconcile-customers" || action === "reconcile-items" ||
               action === "reconcile-vendors") {
      // ── Generic QBO reconciliation ──
      const clientId = Deno.env.get("QBO_CLIENT_ID");
      const clientSecret = Deno.env.get("QBO_CLIENT_SECRET");
      const realmId = Deno.env.get("QBO_REALM_ID");
      if (!clientId || !clientSecret || !realmId) throw new Error("QBO credentials not configured");

      const { data: conn, error: connErr } = await admin
        .from("qbo_connection").select("*").eq("realm_id", realmId).single();
      if (connErr || !conn) throw new Error("No QBO connection found");

      let accessToken = conn.access_token;
      if (new Date(conn.token_expires_at).getTime() - Date.now() < 5 * 60 * 1000) {
        const tokenRes = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
            Accept: "application/json",
          },
          body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: conn.refresh_token }),
        });
        if (!tokenRes.ok) throw new Error(`Token refresh failed [${tokenRes.status}]`);
        const tokens = await tokenRes.json();
        const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
        await admin.from("qbo_connection").update({
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          token_expires_at: expiresAt,
        }).eq("realm_id", realmId);
        accessToken = tokens.access_token;
      }

      const baseUrl = `https://quickbooks.api.intuit.com/v3/company/${realmId}`;
      const correlationId = crypto.randomUUID();

      // Helper: paginated QBO query
      const queryQbo = async (sql: string, entityKey: string) => {
        const all: any[] = [];
        let startPos = 1;
        const pageSize = 1000;
        while (true) {
          const q = encodeURIComponent(`${sql} STARTPOSITION ${startPos} MAXRESULTS ${pageSize}`);
          const res = await fetch(`${baseUrl}/query?query=${q}`, {
            headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
          });
          if (!res.ok) throw new Error(`QBO query failed [${res.status}]: ${await res.text()}`);
          const data = await res.json();
          const page = data?.QueryResponse?.[entityKey] ?? [];
          all.push(...page);
          if (page.length < pageSize) break;
          startPos += pageSize;
        }
        return all;
      };

      const details: any[] = [];
      let totalQbo = 0, totalApp = 0, inSync = 0, missingInApp = 0, missingInQbo = 0, mismatched = 0, autoFixed = 0;

      if (action === "reconcile-purchases") {
        const qboRecords = await queryQbo("SELECT * FROM Purchase", "Purchase");
        // Filter to inventory-only purchases (matching processor logic)
        const inventoryPurchases = qboRecords.filter((r: any) =>
          (r.Line ?? []).some((l: any) => l.DetailType === "ItemBasedExpenseLineDetail")
        );
        totalQbo = inventoryPurchases.length;
        const qboMap = new Map(inventoryPurchases.map((r: any) => [String(r.Id), r]));

        const { data: appRecords } = await admin.from("inbound_receipt").select("id, qbo_purchase_id, total_amount, vendor_name, txn_date");
        totalApp = (appRecords ?? []).length;
        const appMap = new Map((appRecords ?? []).filter((r: any) => r.qbo_purchase_id).map((r: any) => [r.qbo_purchase_id, r]));

        // QBO records missing in app
        for (const [qboId, qbo] of qboMap) {
          if (!appMap.has(qboId)) {
            missingInApp++;
            details.push({ entity: qbo.EntityRef?.name ?? qboId, qbo_id: qboId, issue: "In QBO but missing from app", action: "flag" });
          } else {
            const app = appMap.get(qboId)!;
            const qboTotal = Math.round(Number(qbo.TotalAmt ?? 0) * 100) / 100;
            const appTotal = Math.round(Number(app.total_amount ?? 0) * 100) / 100;
            if (Math.abs(qboTotal - appTotal) > 0.01) {
              mismatched++;
              details.push({ entity: app.vendor_name ?? qboId, qbo_id: qboId, issue: `Amount mismatch: QBO £${qboTotal} vs App £${appTotal}`, action: "flag" });
            } else {
              inSync++;
            }
          }
        }
        // App records missing in QBO
        for (const [qboId, app] of appMap) {
          if (!qboMap.has(qboId)) {
            missingInQbo++;
            details.push({ entity: app.vendor_name ?? qboId, qbo_id: qboId, issue: "In app but deleted from QBO", action: "flag" });
          }
        }

      } else if (action === "reconcile-sales") {
        const qboRecords = await queryQbo("SELECT * FROM SalesReceipt", "SalesReceipt");
        totalQbo = qboRecords.length;
        const qboMap = new Map(qboRecords.map((r: any) => [String(r.Id), r]));

        const { data: appRecords } = await admin.from("sales_order").select("id, qbo_sales_receipt_id, gross_total, origin_channel, order_number");
        totalApp = (appRecords ?? []).length;
        const appMap = new Map((appRecords ?? []).filter((r: any) => r.qbo_sales_receipt_id).map((r: any) => [r.qbo_sales_receipt_id, r]));

        for (const [qboId, qbo] of qboMap) {
          if (!appMap.has(qboId)) {
            missingInApp++;
            details.push({ entity: qbo.DocNumber ?? qboId, qbo_id: qboId, issue: "In QBO but missing from app", action: "flag" });
          } else {
            const app = appMap.get(qboId)!;
            const globalTaxCalc = qbo.GlobalTaxCalculation ?? null;
            const qboTotalAmt = Number(qbo.TotalAmt ?? 0);
            const qboTaxAmt = Number(qbo.TxnTaxDetail?.TotalTax ?? 0);
            const qboTotal = Math.round(
              (globalTaxCalc === "TaxInclusive" ? qboTotalAmt : qboTotalAmt + qboTaxAmt) * 100
            ) / 100;
            const appTotal = Math.round(Number(app.gross_total ?? 0) * 100) / 100;
            if (Math.abs(qboTotal - appTotal) > 0.01) {
              mismatched++;
              details.push({ entity: app.order_number ?? qboId, qbo_id: qboId, issue: `Amount mismatch: QBO £${qboTotal} vs App £${appTotal}`, action: "flag" });
            } else {
              inSync++;
            }
          }
        }
        for (const [qboId, app] of appMap) {
          if (!qboMap.has(qboId)) {
            missingInQbo++;
            details.push({ entity: app.order_number ?? qboId, qbo_id: qboId, issue: "In app but deleted from QBO", action: "flag" });
          }
        }

      } else if (action === "reconcile-customers") {
        const qboRecords = await queryQbo("SELECT * FROM Customer WHERE Active = true", "Customer");
        totalQbo = qboRecords.length;
        const qboMap = new Map(qboRecords.map((r: any) => [String(r.Id), r]));

        const { data: appRecords } = await admin.from("customer").select("id, qbo_customer_id, display_name, email");
        totalApp = (appRecords ?? []).length;
        const appWithQbo = (appRecords ?? []).filter((r: any) => r.qbo_customer_id);
        const appMap = new Map(appWithQbo.map((r: any) => [r.qbo_customer_id, r]));

        for (const [qboId, qbo] of qboMap) {
          if (!appMap.has(qboId)) {
            missingInApp++;
            details.push({ entity: qbo.DisplayName ?? qboId, qbo_id: qboId, issue: "In QBO but missing from app", action: "flag" });
          } else {
            const app = appMap.get(qboId)!;
            if (app.display_name !== qbo.DisplayName) {
              mismatched++;
              details.push({ entity: qbo.DisplayName, qbo_id: qboId, issue: `Name mismatch: QBO "${qbo.DisplayName}" vs App "${app.display_name}"`, action: "flag" });
            } else {
              inSync++;
            }
          }
        }
        // Delete stale app customers not in QBO
        for (const [qboId, app] of appMap) {
          if (!qboMap.has(qboId)) {
            missingInQbo++;
            await admin.from("customer").delete().eq("id", app.id);
            autoFixed++;
            details.push({ entity: app.display_name ?? qboId, qbo_id: qboId, issue: "In app but deleted from QBO", action: "auto_deleted" });
          }
        }

      } else if (action === "reconcile-items") {
        const qboRecords = await queryQbo("SELECT * FROM Item WHERE Type = 'Inventory'", "Item");
        totalQbo = qboRecords.length;
        const qboMap = new Map(qboRecords.map((r: any) => [String(r.Id), r]));

        const { data: appRecords } = await admin.from("sku").select("id, qbo_item_id, sku_code, name");
        totalApp = (appRecords ?? []).length;
        const appWithQbo = (appRecords ?? []).filter((r: any) => r.qbo_item_id);
        const appMap = new Map(appWithQbo.map((r: any) => [r.qbo_item_id, r]));

        for (const [qboId, qbo] of qboMap) {
          if (!appMap.has(qboId)) {
            missingInApp++;
            details.push({ entity: qbo.Name ?? qboId, qbo_id: qboId, issue: "In QBO but no matching SKU in app", action: "flag" });
          } else {
            inSync++;
          }
        }
        for (const [qboId, app] of appMap) {
          if (!qboMap.has(qboId)) {
            missingInQbo++;
            details.push({ entity: app.sku_code ?? qboId, qbo_id: qboId, issue: "SKU in app but item deleted from QBO", action: "flag" });
          }
        }

      } else if (action === "reconcile-vendors") {
        const qboRecords = await queryQbo("SELECT * FROM Vendor WHERE Active = true", "Vendor");
        totalQbo = qboRecords.length;
        const qboMap = new Map(qboRecords.map((r: any) => [String(r.Id), r]));

        const { data: appRecords } = await admin.from("vendor").select("id, qbo_vendor_id, display_name");
        totalApp = (appRecords ?? []).length;
        const appWithQbo = (appRecords ?? []).filter((r: any) => r.qbo_vendor_id);
        const appMap = new Map(appWithQbo.map((r: any) => [r.qbo_vendor_id, r]));

        for (const [qboId, qbo] of qboMap) {
          if (!appMap.has(qboId)) {
            missingInApp++;
            details.push({ entity: qbo.DisplayName ?? qboId, qbo_id: qboId, issue: "In QBO but missing from app", action: "flag" });
          } else {
            const app = appMap.get(qboId)!;
            if (app.display_name !== qbo.DisplayName) {
              mismatched++;
              details.push({ entity: qbo.DisplayName, qbo_id: qboId, issue: `Name mismatch: QBO "${qbo.DisplayName}" vs App "${app.display_name}"`, action: "flag" });
            } else {
              inSync++;
            }
          }
        }
        // Delete stale app vendors not in QBO
        for (const [qboId, app] of appMap) {
          if (!qboMap.has(qboId)) {
            missingInQbo++;
            await admin.from("vendor").delete().eq("id", app.id);
            autoFixed++;
            details.push({ entity: app.display_name ?? qboId, qbo_id: qboId, issue: "In app but deleted from QBO", action: "auto_deleted" });
          }
        }
      }

      details.sort((a: any, b: any) => {
        const order: Record<string, number> = { auto_deleted: 0, flag: 1 };
        return (order[a.action] ?? 2) - (order[b.action] ?? 2);
      });

      result = {
        success: true,
        correlation_id: correlationId,
        total_qbo: totalQbo,
        total_app: totalApp,
        in_sync: inSync,
        missing_in_app: missingInApp,
        missing_in_qbo: missingInQbo,
        mismatched,
        auto_fixed: autoFixed,
        details,
      };

    } else if (action === "cleanup-ghost-units") {
      // Delete stock units with no purchase provenance (ghosts)
      const { data: ghosts, error: ghostErr } = await admin
        .from("stock_unit")
        .select("id")
        .is("batch_id", null)
        .is("line_item_id", null);
      if (ghostErr) throw ghostErr;

      const ghostIds = (ghosts ?? []).map((g: any) => g.id);
      let deleted = 0;
      // Delete in batches of 100
      for (let i = 0; i < ghostIds.length; i += 100) {
        const batch = ghostIds.slice(i, i + 100);
        // Unlink from order lines first
        await admin
          .from("sales_order_line")
          .update({ stock_unit_id: null, cogs: null } as any)
          .in("stock_unit_id", batch);
        const { error: delErr } = await admin
          .from("stock_unit")
          .delete()
          .in("id", batch);
        if (delErr) throw delErr;
        deleted += batch.length;
      }

      // Reset errored purchases that failed due to UID conflicts
      const { data: erroredPurchases } = await admin
        .from("landing_raw_qbo_purchase")
        .select("id, external_id")
        .eq("status", "error")
        .ilike("error_message", "%duplicate key%");

      let resetCount = 0;
      for (const ep of (erroredPurchases ?? [])) {
        await resetQboPurchase(admin, ep.external_id, ep.id);
        resetCount++;
      }

      result = { success: true, deleted, resetCount, message: `Deleted ${deleted} ghost stock units, reset ${resetCount} errored purchases to pending` };

    } else if (action === "reset-qbo-purchase") {
      // Targeted reset for specific stuck QBO purchases
      const ids: string[] = params.ids ?? [];
      if (ids.length === 0) throw new ValidationError("ids array required");
      let resetCount = 0;
      for (const qboPurchaseId of ids) {
        const { data: landing } = await admin
          .from("landing_raw_qbo_purchase")
          .select("id")
          .eq("external_id", qboPurchaseId)
          .maybeSingle();
        if (!landing) continue;
        await resetQboPurchase(admin, qboPurchaseId, landing.id);
        resetCount++;
      }
      result = { success: true, resetCount, message: `Reset ${resetCount} purchases to pending` };

    } else if (action === "recalc-avg-cost") {
      // Recalculate avg_cost on all SKUs from their linked stock units
      const { data: skus, error: skuErr } = await admin
        .from("sku")
        .select("id, sku_code");
      if (skuErr) throw skuErr;

      let updated = 0;
      for (const sku of (skus ?? [])) {
        const { data: units } = await admin
          .from("stock_unit")
          .select("landed_cost")
          .not("landed_cost", "is", null)
          .gt("landed_cost", 0)
          .eq("sku_id" as any, sku.id);

        if (units && units.length > 0) {
          const total = units.reduce((sum: number, u: any) => sum + Number(u.landed_cost ?? 0), 0);
          const avg = Math.round((total / units.length) * 100) / 100;
          await admin.from("sku").update({ avg_cost: avg } as any).eq("id", sku.id);
          updated++;
        }
      }

      result = { success: true, updated, message: `Recalculated avg_cost on ${updated} SKUs` };

    } else if (action === "retry-failed-qbo-push") {
      const { data: resetRows, error: resetErr } = await admin
        .from("sales_order")
        .update({ qbo_sync_status: "pending", qbo_retry_count: 0 } as any)
        .in("qbo_sync_status", ["failed", "needs_manual_review"])
        .select("id");
      if (resetErr) throw resetErr;
      result = { reset: (resetRows ?? []).length };

    } else if (action === "reset_payout_sync") {
      const { payoutId: resetPayoutId, scope } = params as { payoutId: string; scope: "expenses" | "deposit" | "all" };
      if (!resetPayoutId) throw new ValidationError("payoutId is required");
      if (!["expenses", "deposit", "all"].includes(scope)) throw new ValidationError("scope must be expenses, deposit, or all");

      const results: Record<string, number> = {};

      if (scope === "expenses" || scope === "all") {
        const { data: updated } = await admin
          .from("ebay_payout_transactions")
          .update({ qbo_purchase_id: null } as never)
          .eq("payout_id" as never, resetPayoutId)
          .select("id");
        results.expensesReset = (updated ?? []).length;
      }

      if (scope === "deposit" || scope === "all") {
        // Find the payout by external_payout_id
        const { data: payoutRow } = await admin
          .from("payouts")
          .select("id")
          .eq("external_payout_id", resetPayoutId)
          .maybeSingle();
        if (payoutRow) {
          await admin
            .from("payouts")
            .update({ qbo_deposit_id: null, qbo_expense_id: null, qbo_sync_status: "pending", qbo_sync_error: null } as never)
            .eq("id" as never, payoutRow.id);
          results.depositReset = 1;

          // Also clear linked sales_order.qbo_sales_receipt_id so the app's view
          // matches QBO after the user has manually deleted SalesReceipts there.
          // Linkage is via payout_orders AND via ebay_payout_transactions (SALE rows).
          const orderIds = new Set<string>();

          const { data: linkedOrders } = await admin
            .from("payout_orders")
            .select("sales_order_id")
            .eq("payout_id", payoutRow.id);
          for (const r of (linkedOrders ?? []) as Array<{ sales_order_id: string | null }>) {
            if (r.sales_order_id) orderIds.add(r.sales_order_id);
          }

          const { data: txnRows } = await admin
            .from("ebay_payout_transactions")
            .select("matched_order_id, order_id, transaction_id, transaction_type")
            .eq("payout_id" as never, resetPayoutId);
          const txnRefs: string[] = [];
          for (const t of (txnRows ?? []) as Array<{ matched_order_id: string | null; order_id: string | null; transaction_id: string | null; transaction_type: string | null }>) {
            if (t.matched_order_id) orderIds.add(t.matched_order_id);
            if (t.order_id) txnRefs.push(t.order_id);
            if (t.transaction_id) txnRefs.push(t.transaction_id);
          }
          if (txnRefs.length > 0) {
            const { data: refOrders } = await admin
              .from("sales_order")
              .select("id")
              .in("origin_reference", txnRefs);
            for (const r of (refOrders ?? []) as Array<{ id: string }>) {
              orderIds.add(r.id);
            }
          }

          let salesReceiptsReset = 0;
          if (orderIds.size > 0) {
            const { data: clearedOrders } = await admin
              .from("sales_order")
              .update({ qbo_sales_receipt_id: null, qbo_sync_status: "pending", qbo_last_error: null } as never)
              .in("id", Array.from(orderIds))
              .select("id");
            salesReceiptsReset = (clearedOrders ?? []).length;
          }
          results.salesReceiptsReset = salesReceiptsReset;
        } else {
          results.depositReset = 0;
          results.salesReceiptsReset = 0;
        }
      }

      result = { success: true, ...results };

    } else if (action === "backfill-stripe-payout-fees") {
      // One-off / repeatable backfill for Stripe payouts whose payout_fee
      // rows were never written (e.g. payouts received before the webhook
      // started inserting per-charge fees). Idempotent: skips existing fees
      // by external_order_id (= Stripe payment_intent id).
      const { payoutId: targetPayoutId } = params as { payoutId?: string };
      if (!targetPayoutId) throw new ValidationError("payoutId is required");

      // Resolve to local payout row (accept either the local UUID or the Stripe po_… id)
      let payoutRow: { id: string; external_payout_id: string | null; channel: string | null; net_amount: number | null } | null = null;
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(targetPayoutId);
      if (isUuid) {
        const { data } = await admin.from("payouts").select("id, external_payout_id, channel, net_amount").eq("id", targetPayoutId).maybeSingle();
        payoutRow = data as typeof payoutRow;
      } else {
        const { data } = await admin.from("payouts").select("id, external_payout_id, channel, net_amount").eq("external_payout_id", targetPayoutId).maybeSingle();
        payoutRow = data as typeof payoutRow;
      }
      if (!payoutRow) throw new ValidationError(`Payout not found: ${targetPayoutId}`);
      if (payoutRow.channel !== "stripe") throw new ValidationError(`Payout ${payoutRow.id} is not a Stripe payout`);
      if (!payoutRow.external_payout_id) throw new ValidationError(`Payout ${payoutRow.id} has no external_payout_id`);

      // Pick the right Stripe key based on app_settings.stripe_test_mode
      const { data: settings } = await admin.from("app_settings").select("stripe_test_mode").maybeSingle();
      const isTestMode = !!(settings as { stripe_test_mode?: boolean } | null)?.stripe_test_mode;
      const stripeKey = isTestMode
        ? (Deno.env.get("STRIPE_SANDBOX_SECRET_KEY") || "")
        : (Deno.env.get("STRIPE_SECRET_KEY") || "");
      if (!stripeKey) throw new ValidationError(`Stripe ${isTestMode ? "sandbox " : ""}secret key is not configured`);

      const StripeMod = (await import("https://esm.sh/stripe@14.21.0?target=deno")).default;
      const stripe = new StripeMod(stripeKey, { apiVersion: "2024-06-20" });

      // Pull all balance transactions for this payout (paginate)
      type BT = { id: string; fee: number; source: string | null; type: string };
      const allBts: BT[] = [];
      let starting_after: string | undefined = undefined;
      // Defensive cap to avoid runaway loops
      for (let page = 0; page < 20; page++) {
        const resp = await stripe.balanceTransactions.list({
          payout: payoutRow.external_payout_id,
          limit: 100,
          starting_after,
        } as Record<string, unknown>);
        for (const bt of resp.data as BT[]) allBts.push(bt);
        if (!resp.has_more) break;
        starting_after = resp.data[resp.data.length - 1]?.id;
        if (!starting_after) break;
      }

      // Resolve payment intents for each charge bt
      const perCharge: Array<{ pi: string; chargeId: string; feeAmount: number }> = [];
      let residualFee = 0;
      for (const bt of allBts) {
        if (bt.source && bt.source.startsWith("ch_")) {
          try {
            const charge = await stripe.charges.retrieve(bt.source);
            const pi = (charge as { payment_intent: string | null }).payment_intent;
            if (pi) {
              perCharge.push({ pi, chargeId: bt.source, feeAmount: bt.fee / 100 });
            } else {
              residualFee += bt.fee / 100;
            }
          } catch {
            residualFee += bt.fee / 100;
          }
        } else if (bt.fee > 0) {
          residualFee += bt.fee / 100;
        }
      }

      // Idempotency: skip pi's already in payout_fee for this payout
      const { data: existingFees } = await admin
        .from("payout_fee")
        .select("external_order_id")
        .eq("payout_id", payoutRow.id);
      const haveSet = new Set(
        ((existingFees ?? []) as Array<{ external_order_id: string | null }>)
          .map((r) => r.external_order_id)
          .filter((v): v is string => !!v)
      );
      const toInsertCharges = perCharge.filter((c) => !haveSet.has(c.pi));

      // Map pi → sales_order_id
      const piList = toInsertCharges.map((c) => c.pi);
      const piToOrder = new Map<string, string>();
      if (piList.length > 0) {
        const { data: orders } = await admin
          .from("sales_order")
          .select("id, payment_reference")
          .in("payment_reference", piList);
        for (const o of (orders ?? []) as Array<{ id: string; payment_reference: string | null }>) {
          if (o.payment_reference) piToOrder.set(o.payment_reference, o.id);
        }
      }

      let inserted = 0;
      if (toInsertCharges.length > 0) {
        const rows = toInsertCharges.map((c) => ({
          payout_id: payoutRow!.id,
          sales_order_id: piToOrder.get(c.pi) ?? null,
          external_order_id: c.pi,
          channel: "stripe",
          fee_category: "payment_processing",
          amount: Math.round(c.feeAmount * 100) / 100,
          description: `Stripe processing fee — charge ${c.chargeId}`,
        }));
        const { error: insErr, data: insData } = await admin
          .from("payout_fee")
          .insert(rows as never)
          .select("id");
        if (insErr) throw new Error(`Failed to insert payout_fee rows: ${insErr.message}`);
        inserted = (insData ?? []).length;
      }

      // Backfill missing payout_orders join rows so reconcile sees them
      let linkedOrders = 0;
      if (piToOrder.size > 0) {
        const orderIds = Array.from(new Set(piToOrder.values()));
        const links = orderIds.map((oid) => ({ payout_id: payoutRow!.id, sales_order_id: oid }));
        const { error: linkErr } = await admin
          .from("payout_orders")
          .upsert(links as never, { onConflict: "payout_id,sales_order_id" as never });
        if (linkErr) console.warn("Failed to upsert payout_orders:", linkErr);
        else linkedOrders = links.length;
      }

      // Re-trigger reconciliation so per-order fee/net columns are recomputed
      let reconcileTriggered = false;
      try {
        const url = `${supabaseUrl}/functions/v1/v2-reconcile-payout`;
        const resp = await fetch(url, {
          method: "POST",
          headers: { Authorization: `Bearer ${serviceRoleKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ payoutId: payoutRow.id }),
        });
        reconcileTriggered = resp.ok;
      } catch (e) {
        console.warn("v2-reconcile-payout trigger failed:", e);
      }

      result = {
        success: true,
        payoutId: payoutRow.id,
        externalPayoutId: payoutRow.external_payout_id,
        balanceTransactions: allBts.length,
        chargesFound: perCharge.length,
        feesInserted: inserted,
        feesSkipped: perCharge.length - toInsertCharges.length,
        residualFeeUnbooked: Math.round(residualFee * 100) / 100,
        ordersLinked: linkedOrders,
        reconcileTriggered,
      };

    } else {
      return new Response(
        JSON.stringify({ error: `Unknown action: ${action}` }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const status = err instanceof ValidationError ? 400 : 500;
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
