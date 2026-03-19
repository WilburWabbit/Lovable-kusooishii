import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Shared helpers (inlined — edge functions can't share files) ──
// Canonical version: keep in sync with qbo-auth/index.ts

const FETCH_TIMEOUT_MS = 30_000;
function fetchWithTimeout(url: string | URL, options: RequestInit = {}, timeoutMs = FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

async function ensureValidToken(admin: any, realmId: string, clientId: string, clientSecret: string) {
  const { data: conn, error } = await admin
    .from("qbo_connection").select("*").eq("realm_id", realmId).single();
  if (error || !conn) throw new Error("No QBO connection found.");

  if (new Date(conn.token_expires_at).getTime() - Date.now() < 5 * 60 * 1000) {
    const tokenRes = await fetchWithTimeout("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
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
    return tokens.access_token;
  }
  return conn.access_token;
}

function parseSku(sku: string): { mpn: string; conditionGrade: string } {
  const trimmed = sku.trim();
  const dotIndex = trimmed.indexOf(".");
  let mpn: string, conditionGrade: string;
  if (dotIndex > 0) {
    mpn = trimmed.substring(0, dotIndex);
    conditionGrade = trimmed.substring(dotIndex + 1) || "1";
  } else {
    mpn = trimmed;
    conditionGrade = "1";
  }
  if (!["1", "2", "3", "4", "5"].includes(conditionGrade)) conditionGrade = "1";
  return { mpn, conditionGrade };
}

function cleanQboName(raw: string): string {
  return raw.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

async function fetchQboEntity(baseUrl: string, accessToken: string, entityPath: string): Promise<any | null> {
  const res = await fetch(`${baseUrl}/${entityPath}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (!res.ok) {
    console.error(`QBO fetch ${entityPath} failed [${res.status}]: ${await res.text()}`);
    return null;
  }
  return await res.json();
}

function parseParentCategory(parentName: string): { brand: string | null; itemType: string | null } {
  const trimmed = parentName.trim();
  const colonIdx = trimmed.indexOf(":");
  if (colonIdx <= 0) return { brand: null, itemType: null };
  const prefix = trimmed.substring(0, colonIdx).trim();
  const suffix = trimmed.substring(colonIdx + 1).trim();
  if (!suffix) return { brand: null, itemType: null };
  if (prefix.toUpperCase() === "LEGO") {
    return { brand: "LEGO", itemType: suffix };
  }
  return { brand: suffix, itemType: null };
}

async function resolveParentCategory(
  baseUrl: string, accessToken: string, item: any
): Promise<{ parentItemId: string | null; brand: string | null; itemType: string | null }> {
  if (!item.ParentRef?.value) return { parentItemId: null, brand: null, itemType: null };
  const parentItemId = String(item.ParentRef.value);
  const parentData = await fetchQboEntity(baseUrl, accessToken, `item/${parentItemId}`);
  const parentName = parentData?.Item?.Name;
  if (!parentName) return { parentItemId, brand: null, itemType: null };
  const { brand, itemType } = parseParentCategory(parentName);
  return { parentItemId, brand, itemType };
}

/**
 * Compare QBO Item.QtyOnHand with the app's available stock_unit count for
 * the corresponding SKU. If QBO qty is lower, mark excess app units as written_off.
 * If QBO qty is higher, log a warning (new stock should come through purchase flow).
 */
async function reconcileQtyOnHand(
  admin: any, qboItemId: string, skuCode: string, qboItem: any, mpn: string,
): Promise<string | null> {
  if (qboItem.Type !== "Inventory") return null;
  const qboQty = Math.floor(Number(qboItem.QtyOnHand ?? 0));

  const { data: sku } = await admin
    .from("sku").select("id").eq("qbo_item_id", qboItemId).maybeSingle();
  if (!sku) return null;

  // Count all allocatable stock units (available + received + graded)
  // Units in 'received' or 'graded' status are real stock that hasn't transitioned yet
  const { count: appAvailable } = await admin
    .from("stock_unit").select("id", { count: "exact", head: true })
    .eq("sku_id", sku.id).in("status", ["available", "received", "graded"]);

  const available = appAvailable ?? 0;
  if (available === qboQty) return null;

  const reconcileCorrelationId = crypto.randomUUID();

  if (qboQty < available) {
    const excess = available - qboQty;
    const { data: unitsToWriteOff } = await admin
      .from("stock_unit")
      .select("id, status, carrying_value, landed_cost")
      .eq("sku_id", sku.id).in("status", ["available", "received", "graded"])
      .order("created_at", { ascending: true }).limit(excess);

    let writtenOff = 0;
    for (const unit of (unitsToWriteOff ?? [])) {
      const { error: updateErr } = await admin
        .from("stock_unit")
        .update({ status: "written_off", carrying_value: 0, accumulated_impairment: unit.landed_cost ?? 0, updated_at: new Date().toISOString() })
        .eq("id", unit.id);
      if (updateErr) { console.error(`Failed to write off stock unit ${unit.id}:`, updateErr.message); continue; }

      await admin.from("audit_event").insert({
        entity_type: "stock_unit", entity_id: unit.id,
        trigger_type: "qbo_inventory_adjustment", actor_type: "system",
        source_system: "qbo-sync-items", correlation_id: reconcileCorrelationId,
        before_json: { status: unit.status, carrying_value: unit.carrying_value },
        after_json: { status: "written_off", carrying_value: 0 },
        input_json: { qbo_item_id: qboItemId, sku_code: skuCode, qbo_qty_on_hand: qboQty, app_available_before: available },
      });
      writtenOff++;
    }
    return `wrote off ${writtenOff}/${excess} units (QBO=${qboQty}, app was ${available})`;
  }

  // QBO has more — log warning
  console.warn(`[reconcileQtyOnHand] SKU ${skuCode}: QBO QtyOnHand (${qboQty}) > app available (${available}). Difference of ${qboQty - available} units.`);
  await admin.from("audit_event").insert({
    entity_type: "sku", entity_id: sku.id,
    trigger_type: "qbo_qty_discrepancy", actor_type: "system",
    source_system: "qbo-sync-items", correlation_id: reconcileCorrelationId,
    input_json: { qbo_item_id: qboItemId, sku_code: skuCode, qbo_qty_on_hand: qboQty, app_available: available, discrepancy: qboQty - available, direction: "qbo_higher" },
  });
  return `discrepancy: QBO=${qboQty} vs app=${available} (logged, no auto-create)`;
}

async function queryQboAll(baseUrl: string, accessToken: string, query: string, entityKey: string): Promise<any[]> {
  const all: any[] = [];
  let startPos = 1;
  const pageSize = 1000;
  while (true) {
    const pagedQuery = encodeURIComponent(`${query} STARTPOSITION ${startPos} MAXRESULTS ${pageSize}`);
    const res = await fetch(`${baseUrl}/query?query=${pagedQuery}`, {
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
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const clientId = Deno.env.get("QBO_CLIENT_ID")!;
    const clientSecret = Deno.env.get("QBO_CLIENT_SECRET")!;
    const realmId = Deno.env.get("QBO_REALM_ID");
    if (!clientId || !clientSecret || !realmId) throw new Error("QBO credentials not configured");

    // Auth check
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) throw new Error("Unauthorized");
    const admin = createClient(supabaseUrl, serviceRoleKey);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await admin.auth.getUser(token);
    if (userError || !user) throw new Error("Unauthorized");
    const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", user.id);
    const hasAccess = (roles ?? []).some((r: any) => r.role === "admin" || r.role === "staff");
    if (!hasAccess) throw new Error("Forbidden");

    const accessToken = await ensureValidToken(admin, realmId, clientId, clientSecret);
    const baseUrl = `https://quickbooks.api.intuit.com/v3/company/${realmId}`;
    const correlationId = crypto.randomUUID();

    // Fetch all Inventory + NonInventory items from QBO
    const qboItems = await queryQboAll(
      baseUrl, accessToken,
      "SELECT * FROM Item WHERE Type IN ('Inventory', 'NonInventory')",
      "Item",
    );
    console.log(`Fetched ${qboItems.length} QBO items (correlation: ${correlationId})`);
    if (qboItems.length >= 10000) {
      console.warn(`QBO items query hit 10k cap — product cache may be incomplete. Consider narrowing the query.`);
    }

    // Pre-fetch all products with pagination (avoids 1000-row default limit)
    const productByMpn = new Map<string, string>();
    {
      let from = 0;
      const pageSize = 1000;
      while (true) {
        const { data } = await admin.from("product").select("id, mpn").range(from, from + pageSize - 1);
        if (!data || data.length === 0) break;
        for (const p of data) productByMpn.set(p.mpn, p.id);
        if (data.length < pageSize) break;
        from += pageSize;
      }
    }
    console.log(`Loaded ${productByMpn.size} products into lookup map`);

    let upserted = 0;
    let linked = 0;
    let productsCreated = 0;
    let skippedNoMpn = 0;
    let errors = 0;

    for (const item of qboItems) {
      const qboItemId = String(item.Id);

      // Land raw payload
      try {
        await admin.from("landing_raw_qbo_item").upsert({
          external_id: qboItemId,
          raw_payload: item,
          status: "pending",
          correlation_id: correlationId,
          received_at: new Date().toISOString(),
        }, { onConflict: "external_id" });
      } catch (err) {
        console.error(`Failed to land item ${qboItemId}:`, err);
      }

      // Parse SKU field
      // Default grade "1" matches parseSku() convention; "3" was misleading
      let mpn: string | null = null;
      let conditionGrade = "1";
      const skuField = item.Sku;
      if (skuField && String(skuField).trim()) {
        const parsed = parseSku(String(skuField));
        mpn = parsed.mpn;
        conditionGrade = parsed.conditionGrade;
      } else if (item.Name) {
        const parsed = parseSku(String(item.Name));
        mpn = parsed.mpn;
        conditionGrade = parsed.conditionGrade;
      }

      if (!mpn) {
        skippedNoMpn++;
        await admin.from("landing_raw_qbo_item").update({
          status: "skipped", error_message: "No MPN", processed_at: new Date().toISOString(),
        }).eq("external_id", qboItemId);
        continue;
      }

      // Use the raw QBO SKU verbatim as sku_code (canonical identifier)
      const rawSku = (skuField && String(skuField).trim()) ? String(skuField).trim() : String(item.Name).trim();
      const skuCode = rawSku;

      // Resolve parent item category (brand / item type)
      const { parentItemId, brand, itemType } = await resolveParentCategory(baseUrl, accessToken, item);

      let productId = productByMpn.get(mpn) ?? null;

      // Update existing product with brand/type from parent if available
      if (productId && (brand || itemType)) {
        const updates: Record<string, any> = {};
        if (brand) updates.brand = brand;
        if (itemType) updates.product_type = itemType;
        if (Object.keys(updates).length > 0) {
          await admin.from("product").update(updates).eq("id", productId);
        }
      }

      // Auto-create product from catalog if no product exists (on-demand lookup)
      if (!productId && mpn) {
        const { data: catalog } = await admin
          .from("lego_catalog")
          .select("id, mpn, name, theme_id, piece_count, release_year, retired_flag, img_url, subtheme_name, product_type")
          .eq("mpn", mpn)
          .eq("status", "active")
          .maybeSingle();
        if (catalog) {
          const { data: newProduct, error: prodErr } = await admin.from("product").insert({
            mpn,
            name: catalog.name,
            theme_id: catalog.theme_id,
            piece_count: catalog.piece_count,
            release_year: catalog.release_year,
            retired_flag: catalog.retired_flag ?? false,
            img_url: catalog.img_url,
            subtheme_name: catalog.subtheme_name,
            product_type: itemType ?? catalog.product_type ?? "set",
            lego_catalog_id: catalog.id,
            status: "active",
            brand: brand,
          }).select("id").single();
          if (prodErr) {
            console.error(`Auto-create product for ${mpn}:`, prodErr.message);
          } else if (newProduct) {
            productId = newProduct.id;
            productByMpn.set(mpn, newProduct.id);
            productsCreated++;
            console.log(`Auto-created product for MPN ${mpn} (id: ${newProduct.id})`);
          }
      } else {
          // No catalog match — create minimal product (covers minifigures, misc items)
          const inferredType = itemType ?? "minifigure";
          const { data: newProduct, error: prodErr } = await admin.from("product").insert({
            mpn, name: cleanQboName(item.Name ?? mpn),
            product_type: inferredType, brand: brand ?? null, status: "active",
          }).select("id").single();
          if (prodErr) {
            console.error(`Create product for ${mpn}:`, prodErr.message);
          } else if (newProduct) {
            productId = newProduct.id;
            productByMpn.set(mpn, newProduct.id);
            productsCreated++;
          }
        }
      }

      // Pre-check: if a SKU with this sku_code exists but has a different/null qbo_item_id,
      // link it to this QBO item before upserting (avoids sku_code unique violation)
      const { data: existingByCode } = await admin
        .from("sku")
        .select("id, qbo_item_id, product_id, price")
        .eq("sku_code", skuCode)
        .maybeSingle();

      if (existingByCode && existingByCode.qbo_item_id !== qboItemId) {
        const updatePayload: Record<string, any> = {
          qbo_item_id: qboItemId,
          qbo_parent_item_id: parentItemId,
          name: cleanQboName(item.Name ?? mpn),
          product_id: productId ?? existingByCode.product_id,
          active_flag: item.Active !== false,
          price: item.UnitPrice != null ? Number(item.UnitPrice) : existingByCode.price,
        };
        let { error } = await admin.from("sku").update(updatePayload).eq("id", existingByCode.id);

        // Fallback: retry without qbo_parent_item_id if schema cache is stale
        if (error && /qbo_parent_item_id|PGRST204/.test(error.message ?? "")) {
          delete updatePayload.qbo_parent_item_id;
          ({ error } = await admin.from("sku").update(updatePayload).eq("id", existingByCode.id));
        }

        if (error) {
          console.error(`Link error for ${skuCode}:`, error.message);
          errors++;
        } else {
          linked++;
        }
        await admin.from("landing_raw_qbo_item").update({
          status: error ? "error" : "committed",
          error_message: error?.message ?? null,
          processed_at: new Date().toISOString(),
        }).eq("external_id", qboItemId);
        continue;
      }

      // Upsert SKU
      const { error } = await admin.from("sku").upsert({
        qbo_item_id: qboItemId,
        qbo_parent_item_id: parentItemId,
        sku_code: skuCode,
        name: cleanQboName(item.Name ?? mpn),
        product_id: productId,
        condition_grade: conditionGrade,
        active_flag: item.Active !== false,
        saleable_flag: !!productId,
        price: item.UnitPrice != null ? Number(item.UnitPrice) : null,
      }, { onConflict: "qbo_item_id" });

      if (error) {
        console.error(`Upsert error for ${skuCode}:`, error.message);
        errors++;
      } else {
        upserted++;

        // QtyOnHand reconciliation — sync inventory qty from QBO to app stock_units
        try {
          const reconcileResult = await reconcileQtyOnHand(admin, qboItemId, skuCode, item, mpn);
          if (reconcileResult) {
            console.log(`[sync-items] QtyOnHand reconciliation for ${skuCode}: ${reconcileResult}`);
          }
        } catch (reconcileErr: any) {
          console.error(`QtyOnHand reconciliation error for ${skuCode}:`, reconcileErr.message);
        }
      }

      await admin.from("landing_raw_qbo_item").update({
        status: error ? "error" : "committed",
        error_message: error?.message ?? null,
        processed_at: new Date().toISOString(),
      }).eq("external_id", qboItemId);
    }

    return new Response(
      JSON.stringify({
        success: true,
        total: qboItems.length,
        upserted,
        linked,
        products_created: productsCreated,
        skipped_no_mpn: skippedNoMpn,
        errors,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("qbo-sync-items error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
