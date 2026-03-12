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
        .select("id, sku_code, name, condition_grade, price, active_flag, product:product_id(name, mpn)")
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
      const { id: rateId, channel, carrier, service_name, max_weight_kg, max_length_cm, cost, active } = params;
      const row: Record<string, any> = { channel: channel ?? "default", carrier, service_name, max_weight_kg, cost: cost ?? 0, active: active ?? true };
      if (max_length_cm !== undefined) row.max_length_cm = max_length_cm;
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

      // 1. Get SKU → product weight
      const { data: skuData } = await admin
        .from("sku")
        .select("id, price, product:product_id(weight_kg)")
        .eq("id", sku_id)
        .single();
      const weightKg = (skuData?.product as any)?.weight_kg ?? 0;

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
        else if (fee.applies_to === "sale_price_inc_vat") base = salePrice * 1.2; // UK VAT
        let amount = (base * (fee.rate_percent / 100)) + (fee.fixed_amount ?? 0);
        if (fee.min_amount != null && amount < fee.min_amount) amount = fee.min_amount;
        if (fee.max_amount != null && amount > fee.max_amount) amount = fee.max_amount;
        amount = Math.round(amount * 100) / 100;
        totalChannelFees += amount;
        feeBreakdown.push({ fee_name: fee.fee_name, amount });
      }

      // 5. Get shipping cost from rate table
      const { data: rates } = await admin
        .from("shipping_rate_table")
        .select("*")
        .or(`channel.eq.${channel},channel.eq.default`)
        .eq("active", true)
        .gte("max_weight_kg", weightKg)
        .order("max_weight_kg", { ascending: true })
        .limit(1);
      const shippingCost = rates && rates.length > 0 ? Number(rates[0].cost) : 0;

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
