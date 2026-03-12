import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Shared helpers (inlined — edge functions can't share files) ──

async function ensureValidToken(admin: any, realmId: string, clientId: string, clientSecret: string) {
  const { data: conn, error } = await admin
    .from("qbo_connection").select("*").eq("realm_id", realmId).single();
  if (error || !conn) throw new Error("No QBO connection found.");

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

    // Pre-fetch all products for MPN lookup
    const { data: allProducts } = await admin.from("product").select("id, mpn");
    const productByMpn = new Map<string, string>();
    for (const p of allProducts ?? []) {
      productByMpn.set(p.mpn, p.id);
    }

    let upserted = 0;
    let linked = 0;
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
      let mpn: string | null = null;
      let conditionGrade = "3";
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
      const productId = productByMpn.get(mpn) ?? null;

      // Pre-check: if a SKU with this sku_code exists but has a different/null qbo_item_id,
      // link it to this QBO item before upserting (avoids sku_code unique violation)
      const { data: existingByCode } = await admin
        .from("sku")
        .select("id, qbo_item_id, product_id, price")
        .eq("sku_code", skuCode)
        .maybeSingle();

      if (existingByCode && existingByCode.qbo_item_id !== qboItemId) {
        const { error } = await admin.from("sku").update({
          qbo_item_id: qboItemId,
          name: cleanQboName(item.Name ?? mpn),
          product_id: productId ?? existingByCode.product_id,
          active_flag: item.Active !== false,
          price: item.UnitPrice != null ? Number(item.UnitPrice) : existingByCode.price,
        }).eq("id", existingByCode.id);

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
