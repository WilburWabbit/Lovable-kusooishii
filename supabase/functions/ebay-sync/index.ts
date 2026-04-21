// Redeployed: 2026-03-23
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";
import { pushEbayQuantityForSkus } from "../_shared/ebay-inventory-sync.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const EBAY_API = "https://api.ebay.com";
const FETCH_TIMEOUT_MS = 30_000;

/** Fetch with timeout to prevent indefinite hangs on external APIs */
function fetchWithTimeout(url: string | URL, options: RequestInit = {}, timeoutMs = FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

/**
 * Normalise an eBay SKU to the canonical MPN.
 *  - Strip dot-grade suffix:  75418-1.1  → 75418-1
 *  - Strip legacy -G suffix:  31172-1-G1 → 31172-1
 *  - Leave bare MPNs alone:   76273-1    → 76273-1
 */
function deriveMpn(sku: string): string {
  return sku.replace(/-G\d+$/i, "").replace(/\.\d+$/, "");
}

/* ── OAuth token management (singleton) ── */
async function getAccessToken(admin: any): Promise<string> {
  const { data: conn, error } = await admin
    .from("ebay_connection")
    .select("*")
    .limit(1)
    .maybeSingle();

  if (error || !conn) throw new Error("eBay not connected.");

  if (new Date(conn.token_expires_at).getTime() > Date.now() + 60_000) {
    return conn.access_token;
  }

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
      refresh_token: conn.refresh_token,
      scope: [
        "https://api.ebay.com/oauth/api_scope",
        "https://api.ebay.com/oauth/api_scope/sell.inventory",
        "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
        "https://api.ebay.com/oauth/api_scope/sell.account",
        "https://api.ebay.com/oauth/api_scope/commerce.notification.subscription",
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
    })
    .eq("id", conn.id);

  return data.access_token;
}

/* ── Generic eBay API fetch ── */
async function ebayFetch(token: string, path: string, options: RequestInit = {}) {
  const url = path.startsWith("http") ? path : `${EBAY_API}${path}`;
  const res = await fetchWithTimeout(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Accept-Language": "en-GB",
      "Content-Language": "en-GB",
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

/* ── Fetch orders (Fulfillment API) ── */
async function fetchOrders(token: string, daysBack = 90): Promise<any[]> {
  const orders: any[] = [];
  const from = new Date(Date.now() - daysBack * 86400000).toISOString();
  let offset = 0;
  const limit = 50;
  while (true) {
    const data = await ebayFetch(token, `/sell/fulfillment/v1/order?filter=creationdate:[${from}..]&limit=${limit}&offset=${offset}`);
    const batch = data?.orders || [];
    orders.push(...batch);
    if (batch.length < limit || orders.length >= (data?.total || 0)) break;
    offset += limit;
  }
  return orders;
}

/* ── Fetch inventory items ── */
async function fetchInventoryItems(token: string): Promise<any[]> {
  const items: any[] = [];
  let offset = 0;
  const limit = 100;
  while (true) {
    const data = await ebayFetch(token, `/sell/inventory/v1/inventory_item?limit=${limit}&offset=${offset}`);
    const batch = data?.inventoryItems || [];
    items.push(...batch);
    if (batch.length < limit || items.length >= (data?.total || 0)) break;
    offset += limit;
  }
  return items;
}

/* ── Fetch offers ── */
async function fetchOffers(token: string, skus?: string[]): Promise<any[]> {
  const offers: any[] = [];
  try {
    let offset = 0;
    const limit = 100;
    while (true) {
      const data = await ebayFetch(token, `/sell/inventory/v1/offer?limit=${limit}&offset=${offset}`);
      const batch = data?.offers || [];
      offers.push(...batch);
      if (batch.length < limit || offers.length >= (data?.total || 0)) break;
      offset += limit;
    }
  } catch (bulkErr) {
    console.warn("Bulk offer fetch failed, trying per-SKU fallback with backoff:", bulkErr);
    if (skus?.length) {
      let backoffMs = 1000;
      for (const sku of skus) {
        try {
          const data = await ebayFetch(token, `/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}&limit=25`);
          offers.push(...(data?.offers || []));
          backoffMs = 1000; // Reset on success
        } catch (perSkuErr: any) {
          console.warn(`Per-SKU offer fetch failed for ${sku}: ${perSkuErr.message}`);
          // Exponential backoff between failures (1s, 2s, 4s, max 8s)
          await new Promise(r => setTimeout(r, backoffMs));
          backoffMs = Math.min(backoffMs * 2, 8000);
        }
      }
    }
  }
  return offers;
}

/* ── Update inventory quantity on eBay ── */
async function updateInventoryQuantity(token: string, sku: string, quantity: number) {
  const existing = await ebayFetch(token, `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`);
  if (!existing) throw new Error(`Inventory item ${sku} not found on eBay`);
  const updated = {
    ...existing,
    availability: {
      ...(existing.availability || {}),
      shipToLocationAvailability: {
        ...(existing.availability?.shipToLocationAvailability || {}),
        quantity,
      },
    },
  };
  await ebayFetch(token, `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`, {
    method: "PUT",
    body: JSON.stringify(updated),
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRoleKey);

    // Allow internal service-role invocation (from ebay-notifications webhook)
    const token = authHeader.replace("Bearer ", "");
    const body = await req.json().catch(() => ({}));

    if (token === serviceRoleKey && body._triggered_by === "notification") {
      // Trusted internal call — skip user auth
      console.log("Service-role invocation from notification webhook");
    } else {
      // Verify caller is admin/staff
      const { data: { user }, error: userError } = await admin.auth.getUser(token);
      if (userError || !user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", user.id);
      const hasAccess = (roles ?? []).some((r: { role: string }) => r.role === "admin" || r.role === "staff");
      if (!hasAccess) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const action = body.action || "sync_orders";

    const accessToken = await getAccessToken(admin);
    const results: Record<string, number> = { orders_synced: 0, orders_enriched: 0, inventory_synced: 0, stock_pushed: 0 };

    /* ═══════════════════════════════════════════════
       SYNC ORDERS — match eBay orders to QBO doc_number
       ═══════════════════════════════════════════════ */
    if (action === "sync_orders") {
      console.log("Fetching eBay orders...");
      const ebayOrders = await fetchOrders(accessToken, body.days_back || 90);
      console.log(`Fetched ${ebayOrders.length} orders from eBay`);

      // Pre-fetch existing sales_order for doc_number matching
      const { data: existingOrders } = await admin
        .from("sales_order")
        .select("id, doc_number, origin_channel, origin_reference, guest_name, guest_email, notes")
        .order("created_at", { ascending: false })
        .limit(1000);

      const ordersByDocNumber = new Map<string, any>();
      const ordersByOriginRef = new Map<string, any>();
      for (const o of existingOrders || []) {
        if (o.doc_number) ordersByDocNumber.set(o.doc_number, o);
        if (o.origin_reference) ordersByOriginRef.set(`${o.origin_channel}:${o.origin_reference}`, o);
      }

      for (const order of ebayOrders) {
        const ebayOrderId = order.orderId;

        // Already synced as an eBay order?
        if (ordersByOriginRef.has(`ebay:${ebayOrderId}`)) {
          results.orders_synced++;
          continue;
        }

        // Check if a QBO-synced order already exists with this doc_number
        const existingOrder = ordersByDocNumber.get(ebayOrderId);

        if (existingOrder) {
          // ENRICH existing QBO record — don't overwrite financial data (QBO is master)
          const shipTo = order.fulfillmentStartInstructions?.[0]?.shippingStep?.shipTo;
          const buyerName = shipTo?.fullName || order.buyer?.username || "eBay Buyer";
          const buyerEmail = order.buyer?.buyerRegistrationAddress?.email || null;

          console.log(`Matched eBay order ${ebayOrderId} to existing order ${existingOrder.id}`);
          const updatePayload: Record<string, any> = {
            origin_channel: "ebay",
            origin_reference: ebayOrderId,
            shipping_name: shipTo?.fullName || existingOrder.guest_name || "",
            shipping_line_1: shipTo?.contactAddress?.addressLine1 || "",
            shipping_line_2: shipTo?.contactAddress?.addressLine2 || null,
            shipping_city: shipTo?.contactAddress?.city || "",
            shipping_postcode: shipTo?.contactAddress?.postalCode || "",
            shipping_country: shipTo?.contactAddress?.countryCode || "GB",
            shipping_county: shipTo?.contactAddress?.stateOrProvince || null,
          };

          // Only backfill guest details if missing
          if (!existingOrder.guest_name) updatePayload.guest_name = buyerName;
          if (!existingOrder.guest_email && buyerEmail) updatePayload.guest_email = buyerEmail;

          // Append eBay info to notes
          const ebayNote = `eBay buyer: ${order.buyer?.username || "unknown"} | Order: ${ebayOrderId}`;
          const existingNotes = existingOrder.notes || "";
          if (!existingNotes.includes(ebayOrderId)) {
            updatePayload.notes = existingNotes ? `${existingNotes}\n${ebayNote}` : ebayNote;
          }

          await admin.from("sales_order").update(updatePayload).eq("id", existingOrder.id);
          results.orders_enriched++;
        } else {
          // Delegate to ebay-process-order for the full pipeline:
          // local customer, VAT resolution, FIFO stock depletion, eBay stock push,
          // QBO Customer upsert, QBO SalesReceipt creation, audit trail.
          try {
            const processRes = await fetchWithTimeout(
              `${supabaseUrl}/functions/v1/ebay-process-order`,
              {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${serviceRoleKey}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  order_id: ebayOrderId,
                  action: "process_order",
                }),
              },
              60_000, // 60s timeout per order
            );
            if (!processRes.ok) {
              const errText = await processRes.text();
              console.error(`ebay-process-order failed for ${ebayOrderId}: ${errText}`);
            } else {
              const processResult = await processRes.json();
              if (processResult.skipped) {
                console.log(`Order ${ebayOrderId} already processed, skipping`);
              } else {
                console.log(`Order ${ebayOrderId} processed: qbo_sync_status=${processResult.qbo_sync_status}`);
              }
            }
          } catch (e: any) {
            console.error(`Failed to process eBay order ${ebayOrderId}: ${e.message}`);
          }
        }
        results.orders_synced++;
      }
    }

    /* ═══════════════════════════════════════════════
       SYNC INVENTORY — pull eBay items + offers → channel_listing
       ═══════════════════════════════════════════════ */
    if (action === "sync_inventory") {
      console.log("Fetching eBay inventory...");
      const items = await fetchInventoryItems(accessToken);
      const validSkus = items.map((i: any) => i.sku).filter(Boolean);
      const offers = await fetchOffers(accessToken, validSkus);
      console.log(`Fetched ${items.length} items, ${offers.length} offers`);

      const offerMap = new Map<string, any>();
      for (const o of offers) {
        if (o.sku) offerMap.set(o.sku, o);
      }

      // Pre-fetch local SKUs for auto-linking
      const { data: allSkus } = await admin.from("sku").select("id, sku_code").eq("active_flag", true);
      const skuMap = new Map<string, string>();       // exact sku_code → id
      const mpnSkuMap = new Map<string, string>();    // derived MPN → first matching sku id
      for (const s of allSkus || []) {
        skuMap.set(s.sku_code, s.id);
        const mpn = deriveMpn(s.sku_code);
        if (!mpnSkuMap.has(mpn)) mpnSkuMap.set(mpn, s.id);
      }

      let unmatchedSkus: string[] = [];

      for (const item of items) {
        if (!item.sku) continue;
        const offer = offerMap.get(item.sku);
        const listingId = offer?.listing?.listingId ?? null;
        const price = offer?.pricingSummary?.price?.value ? parseFloat(offer.pricingSummary.price.value) : null;
        const qty = item.availability?.shipToLocationAvailability?.quantity ?? null;

        // 1. Exact sku_code match
        let matchedSkuId = skuMap.get(item.sku) || null;

        // 2. Derive MPN from eBay SKU and find local SKU with that MPN prefix
        if (!matchedSkuId) {
          const mpn = deriveMpn(item.sku);
          matchedSkuId = mpnSkuMap.get(mpn) || null;
        }

        if (!matchedSkuId) {
          unmatchedSkus.push(item.sku);
        }

        const { error: upsertErr } = await admin
          .from("channel_listing")
          .upsert(
            {
              channel: "ebay",
              external_sku: item.sku,
              external_listing_id: listingId,
              sku_id: matchedSkuId,
              listed_price: price,
              listed_quantity: qty,
              offer_status: offer?.status || null,
              raw_data: { product: item.product, availability: item.availability },
              synced_at: new Date().toISOString(),
            },
            { onConflict: "channel,external_sku", ignoreDuplicates: false }
          );
        if (upsertErr) console.error(`Upsert listing ${item.sku}:`, upsertErr.message);
        results.inventory_synced++;
      }

      if (unmatchedSkus.length > 0) {
        console.warn(`sync_inventory: ${unmatchedSkus.length} unmatched eBay SKUs: ${unmatchedSkus.slice(0, 20).join(", ")}${unmatchedSkus.length > 20 ? "..." : ""}`);
      }
    }

    /* ═══════════════════════════════════════════════
       SYNC LISTINGS — backfill product attributes & images from eBay
       ═══════════════════════════════════════════════ */
    if (action === "sync_listings") {
      console.log("Syncing eBay listings → product attributes & images...");
      const items = await fetchInventoryItems(accessToken);
      console.log(`Fetched ${items.length} eBay inventory items`);

      // Pre-fetch lookup maps for matching
      const { data: allSkus } = await admin.from("sku").select("id, sku_code, product_id").eq("active_flag", true);
      const skuToProduct = new Map<string, string>();
      const skuIdToProduct = new Map<string, string>();
      for (const s of allSkus || []) {
        if (s.product_id) {
          skuToProduct.set(s.sku_code, s.product_id);
          skuIdToProduct.set(s.id, s.product_id);
        }
      }

      // MPN → product_id map (eBay SKU is often the MPN/set number itself)
      const { data: allProducts } = await admin.from("product").select("id, mpn");
      const mpnToProduct = new Map<string, string>();
      for (const p of allProducts || []) {
        if (p.mpn) mpnToProduct.set(p.mpn, p.id);
      }

      // channel_listing → sku_id map (populated by sync_inventory)
      const { data: allListings } = await admin
        .from("channel_listing")
        .select("external_sku, sku_id")
        .eq("channel", "ebay")
        .not("sku_id", "is", null);
      const listingSkuMap = new Map<string, string>();
      for (const l of allListings || []) {
        if (l.sku_id) listingSkuMap.set(l.external_sku, l.sku_id);
      }

      console.log(`Lookup maps: ${skuToProduct.size} sku→product, ${mpnToProduct.size} mpn→product, ${listingSkuMap.size} channel_listing→sku`);

      let productsMatched = 0;
      let productsUpdated = 0;
      let attributesFilled = 0;
      let imagesDownloaded = 0;
      let errors = 0;
      const processedProducts = new Set<string>();

      const unmatchedListings: string[] = [];

      for (const item of items) {
        try {
          if (!item.sku) continue;

          const normalizedMpn = deriveMpn(item.sku);

          // Match to local product via multiple strategies
          let productId: string | null = null;
          let matchStrategy = "";

          // 1. Exact SKU code → product_id
          productId = skuToProduct.get(item.sku) || null;
          if (productId) matchStrategy = "exact_sku";

          // 2. Derived MPN → product (strip grade/legacy suffixes)
          if (!productId) {
            productId = mpnToProduct.get(normalizedMpn) || null;
            if (productId) matchStrategy = "derived_mpn";
          }

          // 3. Raw eBay SKU as MPN (already worked for bare MPNs)
          if (!productId && normalizedMpn !== item.sku) {
            productId = mpnToProduct.get(item.sku) || null;
            if (productId) matchStrategy = "raw_sku_as_mpn";
          }

          // 4. MPN from eBay item aspects
          if (!productId) {
            const mpn = item.product?.aspects?.MPN?.[0];
            if (mpn) {
              productId = mpnToProduct.get(mpn) || null;
              if (productId) matchStrategy = "ebay_aspect_mpn";
            }
          }

          // 5. channel_listing (from sync_inventory) → sku_id → product_id
          if (!productId) {
            const skuId = listingSkuMap.get(item.sku);
            if (skuId) {
              productId = skuIdToProduct.get(skuId) || null;
              if (productId) matchStrategy = "channel_listing_sku";
            }
          }

          if (!productId) {
            unmatchedListings.push(item.sku);
            continue;
          }
          if (processedProducts.has(productId)) continue;
          processedProducts.add(productId);
          productsMatched++;

          // Fetch current product to check which fields are null
          const { data: product } = await admin
            .from("product")
            .select("id, name, description, weight_kg, length_cm, width_cm, height_cm, piece_count")
            .eq("id", productId)
            .single();
          if (!product) continue;

          // Build update for null fields only
          const updates: Record<string, any> = {};
          const ebayProduct = item.product || {};
          const dims = item.packageWeightAndSize;

          if (product.name === null && ebayProduct.title) {
            updates.name = ebayProduct.title;
          }
          if (product.description === null && ebayProduct.description) {
            updates.description = ebayProduct.description;
          }
          if (product.piece_count === null) {
            const pcs = ebayProduct.aspects?.["Number of Pieces"]?.[0];
            if (pcs) {
              const parsed = parseInt(pcs, 10);
              if (!isNaN(parsed)) updates.piece_count = parsed;
            }
          }

          if (dims?.weight) {
            if (product.weight_kg === null && dims.weight.value) {
              let w = dims.weight.value;
              if (dims.weight.unit === "POUND") w = w * 0.453592;
              else if (dims.weight.unit === "GRAM") w = w / 1000;
              else if (dims.weight.unit === "OUNCE") w = w * 0.0283495;
              updates.weight_kg = Math.round(w * 1000) / 1000;
            }
          }

          if (dims?.dimensions) {
            const d = dims.dimensions;
            const convert = (v: any) => {
              if (!v?.value) return null;
              let cm = v.value;
              if (v.unit === "INCH") cm = cm * 2.54;
              else if (v.unit === "METER") cm = cm * 100;
              else if (v.unit === "FEET") cm = cm * 30.48;
              return Math.round(cm * 10) / 10;
            };
            if (product.length_cm === null && d.length) {
              const val = convert(d.length);
              if (val !== null) updates.length_cm = val;
            }
            if (product.width_cm === null && d.width) {
              const val = convert(d.width);
              if (val !== null) updates.width_cm = val;
            }
            if (product.height_cm === null && d.height) {
              const val = convert(d.height);
              if (val !== null) updates.height_cm = val;
            }
          }

          const fieldCount = Object.keys(updates).length;
          if (fieldCount > 0) {
            const { error: updateErr } = await admin.from("product").update(updates).eq("id", productId);
            if (updateErr) {
              console.error(`Update product ${productId}:`, updateErr.message);
            } else {
              productsUpdated++;
              attributesFilled += fieldCount;
            }
          }

          // Download images if product has none
          const ebayImages: string[] = ebayProduct.imageUrls || [];
          if (ebayImages.length > 0) {
            const { count: mediaCount } = await admin
              .from("product_media")
              .select("id", { count: "exact", head: true })
              .eq("product_id", productId);

            if ((mediaCount ?? 0) === 0) {
              for (let idx = 0; idx < ebayImages.length; idx++) {
                try {
                  const imgRes = await fetch(ebayImages[idx]);
                  if (!imgRes.ok) continue;
                  const imgBytes = new Uint8Array(await imgRes.arrayBuffer());
                  const contentType = imgRes.headers.get("Content-Type") || "image/jpeg";
                  const extMap: Record<string, string> = {
                    "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
                  };
                  const ext = extMap[contentType] || "jpg";
                  const storagePath = `products/${productId}/${crypto.randomUUID()}.${ext}`;

                  const { error: uploadErr } = await admin.storage
                    .from("media")
                    .upload(storagePath, imgBytes, { contentType, upsert: false });
                  if (uploadErr) {
                    console.error(`Upload image ${idx} for ${productId}:`, uploadErr.message);
                    continue;
                  }

                  const { data: urlData } = admin.storage.from("media").getPublicUrl(storagePath);

                  const { data: asset, error: assetErr } = await admin
                    .from("media_asset")
                    .insert({
                      original_url: urlData.publicUrl,
                      mime_type: contentType,
                      file_size_bytes: imgBytes.byteLength,
                      provenance: "ebay-sync",
                    })
                    .select("id")
                    .single();
                  if (assetErr) {
                    console.error(`Insert media_asset for ${productId}:`, assetErr.message);
                    continue;
                  }

                  const { error: linkErr } = await admin
                    .from("product_media")
                    .insert({
                      product_id: productId,
                      media_asset_id: asset.id,
                      sort_order: idx,
                      is_primary: idx === 0,
                    });
                  if (linkErr) {
                    console.error(`Insert product_media for ${productId}:`, linkErr.message);
                    continue;
                  }

                  imagesDownloaded++;
                } catch (imgErr: any) {
                  console.error(`Image download ${idx} for ${productId}:`, imgErr.message);
                }
              }
            }
          }
        } catch (itemErr: any) {
          console.error(`sync_listings item ${item.sku}:`, itemErr.message);
          errors++;
        }
      }

      if (unmatchedListings.length > 0) {
        console.warn(`sync_listings: ${unmatchedListings.length} unmatched eBay SKUs: ${unmatchedListings.slice(0, 20).join(", ")}${unmatchedListings.length > 20 ? "..." : ""}`);
      }
      console.log(`sync_listings complete: matched=${productsMatched}, updated=${productsUpdated}, attrs=${attributesFilled}, images=${imagesDownloaded}, errors=${errors}`);

      return new Response(
        JSON.stringify({
          products_matched: productsMatched,
          products_updated: productsUpdated,
          attributes_filled: attributesFilled,
          images_downloaded: imagesDownloaded,
          errors,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    /* ═══════════════════════════════════════════════
       PUSH STOCK — uses the shared helper so logic
       matches all per-order paths. v2_status is the
       source of truth — legacy `status` column drifts.
       ═══════════════════════════════════════════════ */
    if (action === "push_stock") {
      console.log("Pushing stock levels to eBay...");

      const { data: listings } = await admin
        .from("channel_listing")
        .select("sku_id")
        .eq("channel", "ebay")
        .eq("v2_status", "live")
        .not("external_listing_id", "is", null)
        .not("sku_id", "is", null);

      const uniqueSkuIds = new Set<string>(
        ((listings ?? []) as { sku_id: string }[]).map((l) => l.sku_id),
      );

      if (uniqueSkuIds.size > 0) {
        const r = await pushEbayQuantityForSkus(admin, uniqueSkuIds, {
          source: "ebay-sync:push_stock",
        });
        results.stock_pushed = r.pushed + r.withdrawn;
        (results as Record<string, unknown>).stock_withdrawn = r.withdrawn;
        (results as Record<string, unknown>).stock_failed = r.failed;
      }

      // Re-evaluate after push: count any listings still drifted, so the
      // UI can flag them as errors instead of silently saying "1 mismatch
      // remaining" alongside a success toast.
      const { data: liveAfter } = await admin
        .from("channel_listing")
        .select("id, sku_id, listed_quantity, external_sku")
        .eq("channel", "ebay")
        .eq("v2_status", "live")
        .not("external_listing_id", "is", null)
        .not("sku_id", "is", null);

      const skuIdsForCount = Array.from(
        new Set(((liveAfter ?? []) as { sku_id: string }[]).map((l) => l.sku_id)),
      );
      const mismatches: Array<{ external_sku: string; listed_quantity: number; local_available: number }> = [];
      if (skuIdsForCount.length > 0) {
        const { data: counts } = await admin
          .from("stock_unit")
          .select("sku_id")
          .in("sku_id", skuIdsForCount)
          .in("v2_status", ["graded", "listed"]);
        const tally = new Map<string, number>();
        for (const row of (counts ?? []) as { sku_id: string }[]) {
          tally.set(row.sku_id, (tally.get(row.sku_id) ?? 0) + 1);
        }
        for (const l of (liveAfter ?? []) as { sku_id: string; listed_quantity: number; external_sku: string }[]) {
          const local = tally.get(l.sku_id) ?? 0;
          if (local !== (l.listed_quantity ?? 0)) {
            mismatches.push({
              external_sku: l.external_sku,
              listed_quantity: l.listed_quantity ?? 0,
              local_available: local,
            });
          }
        }
      }
      (results as Record<string, unknown>).mismatches_remaining = mismatches.length;
      (results as Record<string, unknown>).mismatches = mismatches.slice(0, 20);
    }

    /* ═══════════════════════════════════════════════
       SETUP NOTIFICATIONS — create destination + subscriptions
       ═══════════════════════════════════════════════ */
    if (action === "setup_notifications") {
      console.log("Setting up eBay notification subscriptions...");
      const NOTIF_API = `${EBAY_API}/commerce/notification/v1`;
      const VERIFICATION_TOKEN = Deno.env.get("EBAY_VERIFICATION_TOKEN") || "";
      const ENDPOINT = `${Deno.env.get("SUPABASE_URL")}/functions/v1/ebay-notifications`;

      const topics = [
        "FEEDBACK_LEFT",
        "FEEDBACK_RECEIVED",
        "ITEM_MARKED_SHIPPED",
        "ORDER_CONFIRMATION",
        "ORDER_CHANGE",
        "MARKETPLACE_ACCOUNT_DELETION",
      ];

      // Step 1: Create/update config
      try {
        await ebayFetch(accessToken, `${NOTIF_API}/config`, {
          method: "PUT",
          body: JSON.stringify({ alertEmail: "notifications@kusoonline.co.uk" }),
        });
        console.log("Notification config updated");
      } catch (e: any) {
        console.warn("Config update failed (may already exist):", e.message);
      }

      // Step 2: Create or reuse destination
      let destinationId: string | null = null;
      try {
        const existingDests = await ebayFetch(accessToken, `${NOTIF_API}/destination`);
        const existing = (existingDests?.destinations || []).find(
          (d: any) => d.deliveryConfig?.endpoint === ENDPOINT
        );
        if (existing) {
          destinationId = existing.destinationId;
          console.log("Reusing existing destination:", destinationId);
        }
      } catch {
        console.log("No existing destinations found");
      }

      if (!destinationId) {
        try {
          const destRes = await ebayFetch(accessToken, `${NOTIF_API}/destination`, {
            method: "POST",
            body: JSON.stringify({
              name: "Kuso Online Webhook",
              status: "ENABLED",
              deliveryConfig: {
                endpoint: ENDPOINT,
                verificationToken: VERIFICATION_TOKEN,
              },
            }),
          });
          destinationId = destRes?.destinationId;
          if (!destinationId) {
            const dests = await ebayFetch(accessToken, `${NOTIF_API}/destination`);
            const match = (dests?.destinations || []).find(
              (d: any) => d.deliveryConfig?.endpoint === ENDPOINT
            );
            destinationId = match?.destinationId || null;
          }
          console.log("Created destination:", destinationId);
        } catch (e: any) {
          console.error("Failed to create destination:", e.message);
          throw new Error(`Failed to create notification destination: ${e.message}`);
        }
      }

      if (!destinationId) {
        throw new Error("Could not determine destination ID");
      }

      // Step 3: Create subscriptions for each topic
      const subResults: any[] = [];
      for (const topicId of topics) {
        try {
          const existingSubs = await ebayFetch(accessToken, `${NOTIF_API}/subscription`);
          const existingSub = (existingSubs?.subscriptions || []).find(
            (s: any) => s.topicId === topicId
          );

          if (existingSub) {
            if (existingSub.destinationId !== destinationId) {
              // Subscription bound to stale destination — delete and recreate
              await ebayFetch(accessToken, `${NOTIF_API}/subscription/${existingSub.subscriptionId}`, {
                method: "DELETE",
              });
              await ebayFetch(accessToken, `${NOTIF_API}/subscription`, {
                method: "POST",
                body: JSON.stringify({
                  topicId,
                  status: "ENABLED",
                  destinationId,
                  payload: { format: "JSON", schemaVersion: "1.0", deliveryProtocol: "HTTPS" },
                }),
              });
              subResults.push({ topic: topicId, status: "rebound" });
            } else if (existingSub.status !== "ENABLED") {
              await ebayFetch(accessToken, `${NOTIF_API}/subscription/${existingSub.subscriptionId}/enable`, {
                method: "POST",
              });
              subResults.push({ topic: topicId, status: "enabled", subscriptionId: existingSub.subscriptionId });
            } else {
              subResults.push({ topic: topicId, status: "already_active", subscriptionId: existingSub.subscriptionId });
            }
          } else {
            await ebayFetch(accessToken, `${NOTIF_API}/subscription`, {
              method: "POST",
              body: JSON.stringify({
                topicId,
                status: "ENABLED",
                destinationId,
                payload: {
                  format: "JSON",
                  schemaVersion: "1.0",
                  deliveryProtocol: "HTTPS",
                },
              }),
            });
            subResults.push({ topic: topicId, status: "created" });
          }
        } catch (e: any) {
          console.error(`Failed to subscribe to ${topicId}:`, e.message);
          subResults.push({ topic: topicId, status: "error", error: e.message });
        }
      }

      return new Response(
        JSON.stringify({ success: true, subscriptions: subResults, destinationId }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    /* ═══════════════════════════════════════════════
       CREATE LISTING — inventory item → offer → publish
       ═══════════════════════════════════════════════ */
    if (action === "create_listing") {
      const { sku_id, listing_title, listing_description } = body;
      if (!sku_id) throw new Error("sku_id is required");

      // Fetch SKU + product data
      const { data: sku, error: skuErr } = await admin
        .from("sku")
        .select("id, sku_code, condition_grade, price, name, product:product_id(id, mpn, name, description, img_url, weight_kg, length_cm, width_cm, height_cm)")
        .eq("id", sku_id)
        .single();
      if (skuErr || !sku) throw new Error("SKU not found");
      const prod = (sku as any).product;

      // Count available stock
      const { count: stockCount } = await admin
        .from("stock_unit")
        .select("id", { count: "exact", head: true })
        .eq("sku_id", sku_id)
        .eq("status", "available");

      const conditionMap: Record<string, string> = {
        "1": "NEW", "2": "LIKE_NEW", "3": "VERY_GOOD", "4": "GOOD", "5": "ACCEPTABLE",
      };
      const ebayCondition = conditionMap[sku.condition_grade] || "LIKE_NEW";

      const title = listing_title || prod?.name || sku.name || `LEGO ${prod?.mpn}`;
      const desc = listing_description || prod?.description || title;

      // Resolve image URLs from product_media only
      let imageUrls: string[] = [];
      if (prod?.id) {
        const { data: mediaRows } = await admin
          .from("product_media")
          .select("media_asset:media_asset_id(original_url)")
          .eq("product_id", prod.id)
          .order("sort_order")
          .limit(12);
        imageUrls = (mediaRows || [])
          .map((r: any) => r.media_asset?.original_url)
          .filter(Boolean);
      }

      if (imageUrls.length === 0) {
        throw new Error(`Cannot publish ${sku.sku_code}: no images found in product_media. Add at least one image first.`);
      }

      // Step 1: PUT inventory item
      const inventoryBody: any = {
        product: {
          title: title.substring(0, 80),
          description: desc,
          aspects: { Brand: ["LEGO"], MPN: [prod?.mpn || "N/A"] },
          imageUrls,
        },
        condition: ebayCondition,
        availability: {
          shipToLocationAvailability: { quantity: stockCount || 0 },
        },
      };
      if (prod?.weight_kg) {
        inventoryBody.packageWeightAndSize = {
          weight: { value: prod.weight_kg, unit: "KILOGRAM" },
          dimensions: prod.length_cm ? {
            length: { value: prod.length_cm, unit: "CENTIMETER" },
            width: { value: prod.width_cm || 0, unit: "CENTIMETER" },
            height: { value: prod.height_cm || 0, unit: "CENTIMETER" },
          } : undefined,
        };
      }

      await ebayFetch(accessToken, `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku.sku_code)}`, {
        method: "PUT",
        body: JSON.stringify(inventoryBody),
      });
      console.log(`Inventory item created/updated: ${sku.sku_code}`);

      // Step 1.5: Fetch business policies for listing
      const [fulfillmentRes, paymentRes, returnRes] = await Promise.all([
        ebayFetch(accessToken, `/sell/account/v1/fulfillment_policy?marketplace_id=EBAY_GB`),
        ebayFetch(accessToken, `/sell/account/v1/payment_policy?marketplace_id=EBAY_GB`),
        ebayFetch(accessToken, `/sell/account/v1/return_policy?marketplace_id=EBAY_GB`),
      ]);

      const fulfillmentPolicyId = fulfillmentRes?.fulfillmentPolicies?.[0]?.fulfillmentPolicyId;
      const paymentPolicyId = paymentRes?.paymentPolicies?.[0]?.paymentPolicyId;
      const returnPolicyId = returnRes?.returnPolicies?.[0]?.returnPolicyId;

      if (!fulfillmentPolicyId || !paymentPolicyId || !returnPolicyId) {
        throw new Error(
          `eBay business policies missing. Found: fulfillment=${!!fulfillmentPolicyId}, payment=${!!paymentPolicyId}, return=${!!returnPolicyId}. Configure policies in eBay Seller Hub first.`
        );
      }

      // Step 2: POST offer
      const offerBody = {
        sku: sku.sku_code,
        marketplaceId: "EBAY_GB",
        format: "FIXED_PRICE",
        listingDescription: desc,
        availableQuantity: stockCount || 0,
        pricingSummary: {
          price: { value: String(sku.price ?? 0), currency: "GBP" },
        },
        merchantLocationKey: "brookville",
        categoryId: "19006", // LEGO sets category
        listingPolicies: {
          fulfillmentPolicyId,
          paymentPolicyId,
          returnPolicyId,
        },
      };

      let offerId: string | null = null;
      let listingId: string | null = null;

      // Check if an offer already exists for this SKU
      try {
        const existingOffers = await ebayFetch(accessToken, `/sell/inventory/v1/offer?sku=${encodeURIComponent(sku.sku_code)}&limit=10`);
        const existing = (existingOffers?.offers || [])[0];
        if (existing) {
          offerId = existing.offerId;
          listingId = existing.listing?.listingId ?? null;
          console.log(`Existing offer found: ${offerId}`);
        }
      } catch { /* no existing offer */ }

      if (!offerId) {
        const offerRes = await ebayFetch(accessToken, `/sell/inventory/v1/offer`, {
          method: "POST",
          body: JSON.stringify(offerBody),
        });
        offerId = offerRes?.offerId;
        console.log(`Offer created: ${offerId}`);
      }

      // Step 3: Publish offer
      if (offerId && !listingId) {
        const publishRes = await ebayFetch(accessToken, `/sell/inventory/v1/offer/${offerId}/publish`, {
          method: "POST",
        });
        listingId = publishRes?.listingId ?? null;
        console.log(`Offer published, listing: ${listingId}`);
      }

      // Upsert channel_listing
      await admin.from("channel_listing").upsert(
        {
          channel: "ebay",
          external_sku: sku.sku_code,
          sku_id: sku.id,
          external_listing_id: listingId,
          listed_price: sku.price,
          listed_quantity: stockCount || 0,
          listing_title: title,
          listing_description: desc,
          offer_status: listingId ? "PUBLISHED" : "PENDING",
          synced_at: new Date().toISOString(),
        },
        { onConflict: "channel,external_sku", ignoreDuplicates: false }
      );

      return new Response(
        JSON.stringify({ success: true, offerId, listingId }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    /* ═══════════════════════════════════════════════
       REMOVE LISTING — withdraw offer and delete channel_listing
       ═══════════════════════════════════════════════ */
    if (action === "remove_listing") {
      const skuId = body.sku_id;
      if (!skuId) throw new Error("sku_id is required");

      // Find the eBay channel_listing for this SKU
      const { data: listing, error: listErr } = await admin
        .from("channel_listing")
        .select("id, external_sku, external_listing_id, offer_status")
        .eq("channel", "ebay")
        .eq("sku_id", skuId)
        .maybeSingle();

      if (listErr) throw new Error(`Failed to look up listing: ${listErr.message}`);
      if (!listing) throw new Error("No eBay listing found for this SKU");

      // Try to withdraw the offer on eBay
      if (listing.external_sku) {
        try {
          const existingOffers = await ebayFetch(accessToken, `/sell/inventory/v1/offer?sku=${encodeURIComponent(listing.external_sku)}&limit=10`);
          const offer = (existingOffers?.offers || [])[0];
          if (offer?.offerId) {
            // Withdraw the offer (ends the listing)
            await ebayFetch(accessToken, `/sell/inventory/v1/offer/${offer.offerId}/withdraw`, {
              method: "POST",
            });
            console.log(`Offer ${offer.offerId} withdrawn`);
          }
        } catch (e: any) {
          console.warn(`Could not withdraw eBay offer: ${e.message}`);
        }
      }

      // Delete the channel_listing row
      await admin.from("channel_listing").delete().eq("id", listing.id);

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }


    /* ═══════════════════════════════════════════════
       CHECK OFFER — diagnostic: report eBay's current view of an offer/listing
       ═══════════════════════════════════════════════ */
    if (action === "check_offer") {
      const offerIds: string[] = Array.isArray(body.offerIds) ? body.offerIds : [];
      const skus: string[] = Array.isArray(body.skus) ? body.skus : [];
      const results: any[] = [];
      for (const offerId of offerIds) {
        try {
          const offer = await ebayFetch(accessToken, `/sell/inventory/v1/offer/${encodeURIComponent(offerId)}`);
          results.push({
            offerId,
            status: offer?.status,
            listingId: offer?.listing?.listingId,
            listingStatus: offer?.listing?.listingStatus,
            sku: offer?.sku,
            availableQuantity: offer?.availableQuantity,
            format: offer?.format,
          });
        } catch (e: any) {
          results.push({ offerId, error: e.message });
        }
      }
      for (const sku of skus) {
        try {
          const offersResp = await ebayFetch(accessToken, `/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}`);
          results.push({ sku, offers: offersResp?.offers || [] });
        } catch (e: any) {
          results.push({ sku, error: e.message });
        }
      }
      return new Response(
        JSON.stringify({ success: true, results }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "get_subscriptions") {
      const NOTIF_API = `${EBAY_API}/commerce/notification/v1`;
      try {
        const data = await ebayFetch(accessToken, `${NOTIF_API}/subscription`);

        // Also fetch destination URL for diagnostics
        let destinationUrl: string | null = null;
        try {
          const destData = await ebayFetch(accessToken, `${NOTIF_API}/destination`);
          const dest = (destData?.destinations || [])[0];
          destinationUrl = dest?.deliveryConfig?.endpoint || null;
        } catch { /* ignore */ }

        return new Response(
          JSON.stringify({ success: true, subscriptions: data?.subscriptions || [], destinationUrl }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } catch (e: any) {
        return new Response(
          JSON.stringify({ success: true, subscriptions: [], error: e.message }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    /* ═══════════════════════════════════════════════
       DIAGNOSE NOTIFICATIONS — structured report
       ═══════════════════════════════════════════════ */
    if (action === "diagnose_notifications") {
      const NOTIF_API = `${EBAY_API}/commerce/notification/v1`;
      const expectedEndpoint = `${Deno.env.get("SUPABASE_URL")}/functions/v1/ebay-notifications`;
      const report: any = { expectedEndpoint, destinations: [], subscriptions: [], issues: [] };

      try {
        const destData = await ebayFetch(accessToken, `${NOTIF_API}/destination`);
        report.destinations = (destData?.destinations || []).map((d: any) => ({
          destinationId: d.destinationId,
          name: d.name,
          status: d.status,
          endpoint: d.deliveryConfig?.endpoint,
        }));
      } catch (e: any) {
        report.issues.push(`Failed to fetch destinations: ${e.message}`);
      }

      try {
        const subData = await ebayFetch(accessToken, `${NOTIF_API}/subscription`);
        report.subscriptions = (subData?.subscriptions || []).map((s: any) => ({
          subscriptionId: s.subscriptionId,
          topicId: s.topicId,
          status: s.status,
          destinationId: s.destinationId,
        }));
      } catch (e: any) {
        report.issues.push(`Failed to fetch subscriptions: ${e.message}`);
      }

      // Check for common issues
      const registeredEndpoint = report.destinations[0]?.endpoint;
      if (registeredEndpoint && registeredEndpoint !== expectedEndpoint) {
        report.issues.push(`Endpoint mismatch: registered="${registeredEndpoint}" vs expected="${expectedEndpoint}"`);
      }
      if (!report.destinations.length) {
        report.issues.push("No notification destinations registered with eBay");
      }
      const disabledSubs = report.subscriptions.filter((s: any) => s.status !== "ENABLED");
      if (disabledSubs.length) {
        report.issues.push(`${disabledSubs.length} subscription(s) not ENABLED: ${disabledSubs.map((s: any) => s.topicId).join(", ")}`);
      }
      const requiredTopics = ["ORDER_CONFIRMATION", "ORDER_CHANGE", "ITEM_MARKED_SHIPPED", "MARKETPLACE_ACCOUNT_DELETION"];
      const subscribedTopics = report.subscriptions.map((s: any) => s.topicId);
      const missingTopics = requiredTopics.filter(t => !subscribedTopics.includes(t));
      if (missingTopics.length) {
        report.issues.push(`Missing required topics: ${missingTopics.join(", ")}`);
      }

      // Check recent notifications in DB
      const { count: notifCount } = await admin
        .from("ebay_notification")
        .select("id", { count: "exact", head: true });
      report.notificationCount = notifCount || 0;
      if (notifCount === 0) {
        report.issues.push("Zero notifications ever received — eBay may not be delivering to the endpoint");
      }

      return new Response(
        JSON.stringify(report),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    /* ═══════════════════════════════════════════════
       TEST SUBSCRIPTIONS — send test notification for each enabled subscription
       ═══════════════════════════════════════════════ */
    if (action === "test_subscriptions") {
      const NOTIF_API = `${EBAY_API}/commerce/notification/v1`;
      const REQUIRED_TOPICS = ["ORDER_CONFIRMATION", "ORDER_CHANGE", "ITEM_MARKED_SHIPPED", "MARKETPLACE_ACCOUNT_DELETION"];
      const expectedEndpoint = `${Deno.env.get("SUPABASE_URL")}/functions/v1/ebay-notifications`;
      const configIssues: string[] = [];
      let registeredEndpoint: string | null = null;
      let activeDestinationId: string | null = null;

      try {
        // Step 1: GET destination — verify registered webhook URL
        try {
          const destData = await ebayFetch(accessToken, `${NOTIF_API}/destination`);
          const destinations = destData?.destinations || [];
          if (destinations.length === 0) {
            configIssues.push("No destinations registered with eBay");
          } else {
            const match = destinations.find((d: any) => d.deliveryConfig?.endpoint === expectedEndpoint);
            if (match) {
              registeredEndpoint = match.deliveryConfig.endpoint;
              activeDestinationId = match.destinationId;
              if (match.status !== "ENABLED") {
                configIssues.push(`Destination exists but status is ${match.status} (expected ENABLED)`);
              }
            } else {
              // No exact match — report what IS registered
              registeredEndpoint = destinations[0]?.deliveryConfig?.endpoint || "unknown";
              activeDestinationId = destinations[0]?.destinationId || null;
              configIssues.push(`Endpoint mismatch — registered: ${registeredEndpoint}, expected: ${expectedEndpoint}`);
            }
          }
        } catch (e: any) {
          configIssues.push(`Failed to fetch destinations: ${e.message}`);
        }

        // Step 2: GET subscription — verify all required topics exist and are ENABLED
        const subData = await ebayFetch(accessToken, `${NOTIF_API}/subscription`);
        const subs = subData?.subscriptions || [];

        const topicMap = new Map(subs.map((s: any) => [s.topicId, s]));
        for (const topic of REQUIRED_TOPICS) {
          const sub = topicMap.get(topic) as { status?: string; destinationId?: string } | undefined;
          if (!sub) {
            configIssues.push(`Missing subscription for required topic: ${topic}`);
          } else if (sub.status !== "ENABLED") {
            configIssues.push(`Subscription for ${topic} is ${sub.status} (expected ENABLED)`);
          } else if (activeDestinationId && sub.destinationId !== activeDestinationId) {
            configIssues.push(`Subscription ${topic} points to destination ${sub.destinationId}, expected ${activeDestinationId}`);
          }
        }

        // Step 3: POST test — fire test notification for each enabled subscription
        const testResults: any[] = [];
        for (const sub of subs) {
          if (sub.status !== "ENABLED") {
            testResults.push({
              subscriptionId: sub.subscriptionId,
              topicId: sub.topicId,
              status: "skipped",
              reason: `Subscription status is ${sub.status}`,
            });
            continue;
          }
          try {
            await ebayFetch(accessToken, `${NOTIF_API}/subscription/${sub.subscriptionId}/test`, {
              method: "POST",
            });
            testResults.push({
              subscriptionId: sub.subscriptionId,
              topicId: sub.topicId,
              status: "passed",
            });
          } catch (e: any) {
            testResults.push({
              subscriptionId: sub.subscriptionId,
              topicId: sub.topicId,
              status: "failed",
              error: e.message,
            });
          }
        }

        return new Response(
          JSON.stringify({
            success: true,
            results: testResults,
            configIssues,
            destination: { url: registeredEndpoint, expectedUrl: expectedEndpoint, destinationId: activeDestinationId },
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } catch (e: any) {
        return new Response(
          JSON.stringify({ error: e.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    console.log("eBay sync completed:", JSON.stringify(results));
    return new Response(
      JSON.stringify({ success: true, ...results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    console.error("ebay-sync error:", e);
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
