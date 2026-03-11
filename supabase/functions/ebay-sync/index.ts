import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const EBAY_API = "https://api.ebay.com";

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

  const res = await fetch(`${EBAY_API}/identity/v1/oauth2/token`, {
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
  const res = await fetch(url, {
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
  } catch {
    console.warn("Bulk offer fetch failed, trying per-SKU fallback");
    if (skus?.length) {
      for (const sku of skus) {
        try {
          const data = await ebayFetch(token, `/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}&limit=25`);
          offers.push(...(data?.offers || []));
        } catch { /* skip */ }
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

/* ── SKU code helper: eBay SKU → local sku_code convention ── */
function normaliseSkuCode(ebaySku: string): string {
  // eBay SKUs use dot notation e.g. "10311.1", local sku_code uses "10311-G1"
  const trimmed = ebaySku.trim();
  const dotIdx = trimmed.indexOf(".");
  if (dotIdx > 0) {
    const mpn = trimmed.substring(0, dotIdx);
    const grade = trimmed.substring(dotIdx + 1) || "1";
    return `${mpn}-G${["1","2","3","4","5"].includes(grade) ? grade : "1"}`;
  }
  return trimmed;
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

      // Pre-fetch SKU lookup
      const { data: allSkus } = await admin.from("sku").select("id, sku_code").eq("active_flag", true);
      const skuMap = new Map<string, string>();
      for (const s of allSkus || []) {
        skuMap.set(s.sku_code.toLowerCase(), s.id);
      }

      for (const order of ebayOrders) {
        const ebayOrderId = order.orderId;

        // Already synced as an eBay order?
        if (ordersByOriginRef.has(`ebay:${ebayOrderId}`)) {
          results.orders_synced++;
          continue;
        }

        // Extract buyer details from fulfillment data
        const shipTo = order.fulfillmentStartInstructions?.[0]?.shippingStep?.shipTo;
        const buyerName = shipTo?.fullName || order.buyer?.username || "eBay Buyer";
        const buyerEmail = order.buyer?.buyerRegistrationAddress?.email || null;
        const totalAmount = parseFloat(order.pricingSummary?.total?.value || "0");
        const taxAmount = parseFloat(order.pricingSummary?.tax?.value || "0");
        const currency = order.pricingSummary?.total?.currency || "GBP";
        const creationDate = order.creationDate?.split("T")[0] || null;

        // Check if a QBO-synced order already exists with this doc_number
        const existingOrder = ordersByDocNumber.get(ebayOrderId);

        if (existingOrder) {
          // ENRICH existing QBO record — don't overwrite financial data (QBO is master)
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
          // No matching QBO sale — insert new eBay order
          // Determine net/gross from eBay totals (eBay UK prices are VAT-inclusive)
          const merchandiseSubtotal = totalAmount - taxAmount;
          const grossTotal = totalAmount;

          const lineItems = order.lineItems || [];

          const { data: newOrder, error: orderErr } = await admin
            .from("sales_order")
            .insert({
              origin_channel: "ebay",
              origin_reference: ebayOrderId,
              doc_number: ebayOrderId,
              status: "complete",
              guest_name: buyerName,
              guest_email: buyerEmail || `ebay-${ebayOrderId}@imported.local`,
              shipping_name: shipTo?.fullName || buyerName,
              shipping_line_1: shipTo?.contactAddress?.addressLine1 || "",
              shipping_line_2: shipTo?.contactAddress?.addressLine2 || null,
              shipping_city: shipTo?.contactAddress?.city || "",
              shipping_postcode: shipTo?.contactAddress?.postalCode || "",
              shipping_country: shipTo?.contactAddress?.countryCode || "GB",
              shipping_county: shipTo?.contactAddress?.stateOrProvince || null,
              merchandise_subtotal: merchandiseSubtotal,
              tax_total: taxAmount,
              gross_total: grossTotal,
              global_tax_calculation: "TaxInclusive",
              currency,
              txn_date: creationDate,
              notes: `eBay order ${ebayOrderId} | Buyer: ${order.buyer?.username || "unknown"}`,
            })
            .select("id")
            .single();

          if (orderErr) {
            console.error(`Failed to insert eBay order ${ebayOrderId}:`, orderErr.message);
            continue;
          }

          // Create order lines
          for (const li of lineItems) {
            const ebaySku = li.sku;
            let skuId: string | null = null;

            if (ebaySku) {
              const localCode = normaliseSkuCode(ebaySku);
              skuId = skuMap.get(localCode.toLowerCase()) || null;
              // Fallback: try exact match
              if (!skuId) skuId = skuMap.get(ebaySku.toLowerCase()) || null;
            }

            if (!skuId) {
              console.warn(`No SKU match for eBay line item sku="${ebaySku}" in order ${ebayOrderId}`);
              continue;
            }

            const unitPrice = parseFloat(li.lineItemCost?.value || "0");
            const qty = li.quantity || 1;

            await admin.from("sales_order_line").insert({
              sales_order_id: newOrder.id,
              sku_id: skuId,
              quantity: qty,
              unit_price: unitPrice,
              line_total: unitPrice * qty,
            });
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
      const skuMap = new Map<string, string>();
      for (const s of allSkus || []) {
        skuMap.set(s.sku_code.toLowerCase(), s.id);
      }

      for (const item of items) {
        if (!item.sku) continue;
        const offer = offerMap.get(item.sku);
        const listingId = offer?.listing?.listingId ?? null;
        const price = offer?.pricingSummary?.price?.value ? parseFloat(offer.pricingSummary.price.value) : null;
        const qty = item.availability?.shipToLocationAvailability?.quantity ?? null;

        // Auto-link to local SKU
        const localCode = normaliseSkuCode(item.sku);
        const matchedSkuId = skuMap.get(localCode.toLowerCase()) || skuMap.get(item.sku.toLowerCase()) || null;

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
    }

    /* ═══════════════════════════════════════════════
       PUSH STOCK — count available stock_units → eBay
       ═══════════════════════════════════════════════ */
    if (action === "push_stock") {
      console.log("Pushing stock levels to eBay...");

      const { data: listings } = await admin
        .from("channel_listing")
        .select("id, external_sku, sku_id")
        .eq("channel", "ebay")
        .not("sku_id", "is", null);

      if (listings?.length) {
        // Count available stock per sku_id
        const skuIds = [...new Set(listings.map((l: any) => l.sku_id))];
        const stockCounts = new Map<string, number>();

        for (const skuId of skuIds) {
          const { count } = await admin
            .from("stock_unit")
            .select("id", { count: "exact", head: true })
            .eq("sku_id", skuId)
            .eq("status", "available");
          stockCounts.set(skuId, count || 0);
        }

        for (const listing of listings) {
          const qty = stockCounts.get(listing.sku_id) || 0;
          try {
            await updateInventoryQuantity(accessToken, listing.external_sku, qty);
            results.stock_pushed++;
          } catch (e: any) {
            console.error(`Failed to push stock for ${listing.external_sku}:`, e.message);
          }
        }
      }
    }

    /* ═══════════════════════════════════════════════
       SETUP NOTIFICATIONS — create destination + subscriptions
       ═══════════════════════════════════════════════ */
    if (action === "setup_notifications") {
      console.log("Setting up eBay notification subscriptions...");
      const NOTIF_API = `${EBAY_API}/commerce/notification/v1`;
      const VERIFICATION_TOKEN = Deno.env.get("EBAY_VERIFICATION_TOKEN") || "";
      const ENDPOINT = `${Deno.env.get("SUPABASE_URL")}/functions/v1/ebay-notifications`;

      const topics = ["FEEDBACK_LEFT", "FEEDBACK_RECEIVED", "ITEM_MARKED_SHIPPED", "ORDER_CONFIRMATION", "MARKETPLACE_ACCOUNT_DELETION"];

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
            if (existingSub.status !== "ENABLED") {
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

      // Step 1: PUT inventory item
      const inventoryBody: any = {
        product: {
          title: title.substring(0, 80),
          description: desc,
          aspects: { Brand: ["LEGO"], MPN: [prod?.mpn || "N/A"] },
          imageUrls: prod?.img_url ? [prod.img_url] : [],
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

      // Step 1.5: Ensure merchant location exists
      try {
        await ebayFetch(accessToken, `/sell/inventory/v1/location/default`);
      } catch {
        console.log("Default location not found — creating it...");
        await ebayFetch(accessToken, `/sell/inventory/v1/location/default`, {
          method: "PUT",
          body: JSON.stringify({
            location: {
              address: { city: "London", country: "GB", postalCode: "SW1A 1AA" },
            },
            locationTypes: ["WAREHOUSE"],
            name: "Default Location",
            merchantLocationStatus: "ENABLED",
          }),
        });
        console.log("Default location created.");
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
        merchantLocationKey: "default",
        categoryId: "19006", // LEGO sets category
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
        try {
          const publishRes = await ebayFetch(accessToken, `/sell/inventory/v1/offer/${offerId}/publish`, {
            method: "POST",
          });
          listingId = publishRes?.listingId ?? null;
          console.log(`Offer published, listing: ${listingId}`);
        } catch (e: any) {
          console.warn(`Publish failed (offer may need review): ${e.message}`);
        }
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
       GET SUBSCRIPTIONS — list current notification subscriptions
       ═══════════════════════════════════════════════ */
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
      const requiredTopics = ["ORDER_CONFIRMATION", "ITEM_MARKED_SHIPPED", "MARKETPLACE_ACCOUNT_DELETION"];
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
      const REQUIRED_TOPICS = ["ORDER_CONFIRMATION", "ITEM_MARKED_SHIPPED", "MARKETPLACE_ACCOUNT_DELETION"];
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
          const sub = topicMap.get(topic);
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
