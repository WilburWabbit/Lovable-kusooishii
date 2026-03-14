import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

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
        .order("created_at", { ascending: false })
        .limit(1000);
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
          "id, order_number, doc_number, origin_channel, origin_reference, status, merchandise_subtotal, tax_total, gross_total, currency, guest_name, guest_email, created_at, txn_date, notes, customer:customer_id(id, display_name, email), sales_order_line(id, quantity, unit_price, line_total, tax_code:tax_code_id(sales_tax_rate:sales_tax_rate_id(rate_percent)), sku:sku_id(sku_code, name, product:product_id(name)))"
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
        .select("*, theme:theme_id(name)")
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

      result = {
        ...product,
        theme_name: product.theme?.name ?? null,
        theme: undefined,
        stock_available: stockAvailable,
        carrying_value: carryingValue,
        units_sold: unitsSold,
        revenue,
        skus: enrichedSkus,
        channel_listings: allChannelListings,
      };
    } else if (action === "update-product") {
      const { product_id, ...fields } = params;
      const allowed = ["product_hook", "description", "highlights", "call_to_action", "seo_title", "seo_description", "age_range", "length_cm", "width_cm", "height_cm", "weight_kg"];
      const updates: Record<string, any> = {};
      for (const k of allowed) {
        if (k in fields) updates[k] = fields[k];
      }
      if (Object.keys(updates).length === 0) throw new Error("No valid fields to update");
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
      if (Object.keys(updates).length === 0) throw new Error("No valid fields to update");
      const { error } = await admin.from("channel_listing").update(updates).eq("id", listing_id);
      if (error) throw error;
      result = { success: true };
    } else if (action === "create-web-listing") {
      const { sku_id } = params;
      if (!sku_id) throw new Error("sku_id is required");

      // Fetch SKU details
      const { data: sku, error: skuErr } = await admin
        .from("sku")
        .select("id, sku_code, price")
        .eq("id", sku_id)
        .single();
      if (skuErr || !sku) throw new Error("SKU not found");

      // Upsert channel_listing for web
      const { error: uErr } = await admin.from("channel_listing").upsert(
        {
          channel: "web",
          external_sku: sku.sku_code,
          sku_id: sku.id,
          listed_price: sku.price,
          listed_quantity: 0,
          offer_status: "PUBLISHED",
          synced_at: new Date().toISOString(),
        },
        { onConflict: "channel,external_sku", ignoreDuplicates: false }
      );
      if (uErr) throw uErr;
      result = { success: true };
    } else if (action === "remove-web-listing") {
      const { sku_id } = params;
      if (!sku_id) throw new Error("sku_id is required");

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
      if (!pid) throw new Error("product_id is required");
      const { data, error } = await admin
        .from("product_media")
        .select("id, sort_order, is_primary, media_asset:media_asset_id(id, original_url, alt_text, mime_type, width, height, file_size_bytes)")
        .eq("product_id", pid)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      result = (data ?? []).map((pm: any) => ({
        id: pm.id,
        sort_order: pm.sort_order,
        is_primary: pm.is_primary,
        ...pm.media_asset,
        media_asset_id: pm.media_asset?.id,
      }));

    } else if (action === "delete-product-media") {
      const { product_media_id, media_asset_id: maId } = params;
      if (!product_media_id) throw new Error("product_media_id is required");

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
      if (!Array.isArray(items)) throw new Error("items array is required");
      for (const item of items) {
        await admin.from("product_media").update({ sort_order: item.sort_order }).eq("id", item.id);
      }
      result = { success: true };

    } else if (action === "update-media-alt-text") {
      const { media_asset_id: maId, alt_text } = params;
      if (!maId) throw new Error("media_asset_id is required");
      const { error } = await admin.from("media_asset").update({ alt_text }).eq("id", maId);
      if (error) throw error;
      result = { success: true };

    } else if (action === "set-primary-media") {
      const { product_id: pid, product_media_id } = params;
      if (!pid || !product_media_id) throw new Error("product_id and product_media_id required");

      // Clear all primary flags for this product
      await admin.from("product_media").update({ is_primary: false }).eq("product_id", pid);
      // Set the chosen one
      await admin.from("product_media").update({ is_primary: true }).eq("id", product_media_id);

      // Update product.img_url from the media asset
      const { data: pm } = await admin
        .from("product_media")
        .select("media_asset:media_asset_id(original_url)")
        .eq("id", product_media_id)
        .single();
      if (pm?.media_asset) {
        await admin.from("product").update({ img_url: (pm.media_asset as any).original_url }).eq("id", pid);
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
      if (!feeId) throw new Error("id is required");
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
      if (!rateId) throw new Error("id is required");
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
      if (!dKey) throw new Error("key is required");
      const { error } = await admin.from("selling_cost_defaults").upsert(
        { key: dKey, value: dValue ?? 0, updated_at: new Date().toISOString() },
        { onConflict: "key" }
      );
      if (error) throw error;
      result = { success: true };

    /* ── Calculate Selling Costs ── */

    } else if (action === "calculate-selling-costs") {
      const { sku_id, channel, sale_price, shipping_charged } = params;
      if (!sku_id || !channel || sale_price === undefined) throw new Error("sku_id, channel, and sale_price are required");

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
      if (!sku_id || !channel) throw new Error("sku_id and channel are required");

      // 1. Get SKU + product info
      const { data: skuData } = await admin
        .from("sku")
        .select("id, sku_code, price, condition_grade, product:product_id(id, mpn, weight_kg, length_cm, width_cm, height_cm)")
        .eq("id", sku_id)
        .single();
      if (!skuData) throw new Error("SKU not found");
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

      // 4. Get shipping cost (cheapest rate that fits)
      const weightKg = product.weight_kg ?? 0;
      const { data: allRates } = await admin
        .from("shipping_rate_table")
        .select("*")
        .or(`channel.eq.${channel},channel.eq.default`)
        .eq("active", true)
        .gte("max_weight_kg", weightKg)
        .order("cost", { ascending: true });
      
      const lengthCm = product.length_cm;
      const widthCm = product.width_cm;
      const heightCm = product.height_cm;
      const hasDimensions = lengthCm != null && widthCm != null && heightCm != null;
      let matchedRate: any = null;
      if (hasDimensions && allRates && allRates.length > 0) {
        matchedRate = allRates.find((r: any) =>
          (r.max_length_cm == null || r.max_length_cm >= lengthCm) &&
          (r.max_width_cm == null || r.max_width_cm >= widthCm) &&
          (r.max_depth_cm == null || r.max_depth_cm >= heightCm)
        );
      }
      if (!matchedRate) {
        const evriSmall = (allRates ?? []).filter((r: any) => r.carrier === "Evri" && r.size_band === "Small Parcel");
        matchedRate = evriSmall.length > 0 ? evriSmall[0] : (allRates && allRates.length > 0 ? allRates[0] : null);
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

      // 7. Compute prices
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
      const denominator = Math.max(1 - effectiveMargin - effectiveFeeRate - riskRate, 0.05);
      let floorPrice = Math.round(((costBase + minProfit + fixedFeeCosts) / denominator) * 100) / 100;

      // Post-check: verify floor covers all fees with min/max clamps applied
      for (let i = 0; i < 5; i++) {
        let totalFees = 0;
        for (const fee of fees ?? []) {
          let base = floorPrice;
          if (fee.applies_to === "sale_plus_shipping") base = floorPrice + shippingCost;
          else if (fee.applies_to === "sale_price_inc_vat") base = floorPrice * 1.2;
          let amount = (base * ((fee.rate_percent ?? 0) / 100)) + (fee.fixed_amount ?? 0);
          if (fee.min_amount != null && amount < fee.min_amount) amount = fee.min_amount;
          if (fee.max_amount != null && amount > fee.max_amount) amount = fee.max_amount;
          totalFees += amount;
        }
        const riskReserve = floorPrice * riskRate;
        const requiredRevenue = costBase + minProfit + totalFees + riskReserve;
        const neededPrice = requiredRevenue / (1 - effectiveMargin);
        if (neededPrice <= floorPrice + 0.01) break;
        floorPrice = Math.round(neededPrice * 100) / 100;
      }

      let targetPrice: number | null = null;
      if (marketConsensus != null) {
        targetPrice = Math.round(marketConsensus * condMultiplier * 100) / 100;
        // Ensure target is at least the floor
        if (targetPrice < floorPrice) targetPrice = floorPrice;
      }

      const ceilingPrice = Math.round(Math.max(floorPrice, marketConsensus ?? floorPrice) * 100) / 100;

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
      if (!listing_id) throw new Error("listing_id is required");
      const updates: Record<string, any> = { priced_at: new Date().toISOString() };
      if (price_floor !== undefined) updates.price_floor = price_floor;
      if (price_target !== undefined) updates.price_target = price_target;
      if (price_ceiling !== undefined) updates.price_ceiling = price_ceiling;
      if (cs !== undefined) updates.confidence_score = cs;
      if (pn !== undefined) updates.pricing_notes = pn;

      let auto_price_applied = false;
      let auto_price_reason = "";

      if (auto_price && price_target != null) {
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
      }

      const { error } = await admin.from("channel_listing").update(updates).eq("id", listing_id);
      if (error) throw error;
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
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
