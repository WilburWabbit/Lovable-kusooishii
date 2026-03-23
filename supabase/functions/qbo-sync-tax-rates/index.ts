// Redeployed: 2026-03-23
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Canonical version: keep in sync with qbo-auth/index.ts
const FETCH_TIMEOUT_MS = 30_000;
function fetchWithTimeout(url: string | URL, options: RequestInit = {}, timeoutMs = FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

async function ensureValidToken(supabaseAdmin: any, realmId: string, clientId: string, clientSecret: string) {
  const { data: conn, error } = await supabaseAdmin
    .from("qbo_connection")
    .select("*")
    .eq("realm_id", realmId)
    .single();

  if (error || !conn) throw new Error("No QBO connection found. Please connect to QBO first.");

  if (new Date(conn.token_expires_at).getTime() - Date.now() < 5 * 60 * 1000) {
    const tokenRes = await fetchWithTimeout("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: conn.refresh_token,
      }),
    });

    if (!tokenRes.ok) {
      const errBody = await tokenRes.text();
      throw new Error(`Token refresh failed [${tokenRes.status}]: ${errBody}`);
    }

    const tokens = await tokenRes.json();
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

    await supabaseAdmin.from("qbo_connection").update({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_expires_at: expiresAt,
    }).eq("realm_id", realmId);

    return tokens.access_token;
  }

  return conn.access_token;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth check
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const token = authHeader.replace("Bearer ", "");
    const isWebhook = req.headers.get("x-webhook-trigger") === "true" && token === serviceRoleKey;

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    if (!isWebhook) {
      // Verify caller identity
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: userData, error: userErr } = await userClient.auth.getUser();
      if (userErr || !userData?.user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const userId = userData.user.id;

      // Check admin/staff role
      const { data: hasAdmin } = await supabaseAdmin.rpc("has_role", { _user_id: userId, _role: "admin" });
      const { data: hasStaff } = await supabaseAdmin.rpc("has_role", { _user_id: userId, _role: "staff" });
      if (!hasAdmin && !hasStaff) {
        return new Response(JSON.stringify({ error: "Forbidden – admin or staff role required" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } else {
      console.log("Webhook-triggered sync (service role auth)");
    }

    // QBO credentials
    const clientId = Deno.env.get("QBO_CLIENT_ID")!;
    const clientSecret = Deno.env.get("QBO_CLIENT_SECRET")!;
    const realmId = Deno.env.get("QBO_REALM_ID")!;

    const accessToken = await ensureValidToken(supabaseAdmin, realmId, clientId, clientSecret);
    const baseUrl = `https://quickbooks.api.intuit.com/v3/company/${realmId}`;
    const correlationId = crypto.randomUUID();

    // ── 1. Fetch and land TaxRate entities ──
    const rateQuery = encodeURIComponent("SELECT * FROM TaxRate");
    const rateRes = await fetch(`${baseUrl}/query?query=${rateQuery}`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    });

    if (!rateRes.ok) {
      const errText = await rateRes.text();
      throw new Error(`QBO TaxRate query failed [${rateRes.status}]: ${errText}`);
    }

    const rateJson = await rateRes.json();
    const taxRates = rateJson?.QueryResponse?.TaxRate ?? [];

    // Land raw tax rates
    for (const tr of taxRates) {
      try {
        await supabaseAdmin.from("landing_raw_qbo_tax_entity").upsert(
          { entity_type: "TaxRate", external_id: String(tr.Id), raw_payload: tr, status: "pending", correlation_id: correlationId, received_at: new Date().toISOString() },
          { onConflict: "entity_type,external_id" }
        );
      } catch (err) { console.error(`Failed to land TaxRate ${tr.Id}:`, err); }
    }
    const now = new Date().toISOString();
    let ratesSynced = 0;

    if (taxRates.length > 0) {
      const rows = taxRates.map((tr: any) => ({
        qbo_tax_rate_id: String(tr.Id),
        name: tr.Name ?? `Rate ${tr.Id}`,
        description: tr.Description ?? null,
        rate_percent: tr.RateValue ?? 0,
        agency_ref: tr.AgencyRef?.value ? String(tr.AgencyRef.value) : null,
        active: tr.Active !== false,
        synced_at: now,
      }));

      const { error: upsertErr } = await supabaseAdmin
        .from("vat_rate")
        .upsert(rows, { onConflict: "qbo_tax_rate_id" });

      if (upsertErr) throw new Error(`TaxRate upsert failed: ${upsertErr.message}`);
      ratesSynced = rows.length;

      // Mark landed tax rates as committed
      for (const tr of taxRates) {
        await supabaseAdmin.from("landing_raw_qbo_tax_entity").update({ status: "committed", processed_at: now }).eq("entity_type", "TaxRate").eq("external_id", String(tr.Id));
      }
    }

    // ── 2. Sync TaxCode entities ──
    const codeQuery = encodeURIComponent("SELECT * FROM TaxCode");
    const codeRes = await fetch(`${baseUrl}/query?query=${codeQuery}`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    });

    if (!codeRes.ok) {
      const errText = await codeRes.text();
      throw new Error(`QBO TaxCode query failed [${codeRes.status}]: ${errText}`);
    }

    const codeJson = await codeRes.json();
    const taxCodes = codeJson?.QueryResponse?.TaxCode ?? [];

    // Build a lookup: qbo_tax_rate_id → vat_rate.id
    const { data: allVatRates } = await supabaseAdmin
      .from("vat_rate")
      .select("id, qbo_tax_rate_id");
    const vatRateMap = new Map<string, string>();
    for (const vr of (allVatRates ?? [])) {
      vatRateMap.set(vr.qbo_tax_rate_id, vr.id);
    }

    let codesSynced = 0;

    for (const tc of taxCodes) {
      const qboTaxCodeId = String(tc.Id);

      // Extract the first TaxRateRef from each list
      const salesRateDetails = tc.SalesTaxRateList?.TaxRateDetail ?? [];
      const purchaseRateDetails = tc.PurchaseTaxRateList?.TaxRateDetail ?? [];

      const salesQboRateId = salesRateDetails[0]?.TaxRateRef?.value
        ? String(salesRateDetails[0].TaxRateRef.value)
        : null;
      const purchaseQboRateId = purchaseRateDetails[0]?.TaxRateRef?.value
        ? String(purchaseRateDetails[0].TaxRateRef.value)
        : null;

      const salesTaxRateId = salesQboRateId ? (vatRateMap.get(salesQboRateId) ?? null) : null;
      const purchaseTaxRateId = purchaseQboRateId ? (vatRateMap.get(purchaseQboRateId) ?? null) : null;

      // Warn if VAT rate references couldn't be resolved — downstream tax calculations will be incomplete
      if (salesQboRateId && !salesTaxRateId) {
        console.warn(`TaxCode ${qboTaxCodeId} (${tc.Name}): sales_tax_rate_id unresolved for qbo_tax_rate_id=${salesQboRateId}`);
      }
      if (purchaseQboRateId && !purchaseTaxRateId) {
        console.warn(`TaxCode ${qboTaxCodeId} (${tc.Name}): purchase_tax_rate_id unresolved for qbo_tax_rate_id=${purchaseQboRateId}`);
      }

      const { error: tcErr } = await supabaseAdmin
        .from("tax_code")
        .upsert(
          {
            qbo_tax_code_id: qboTaxCodeId,
            name: tc.Name ?? `TaxCode ${qboTaxCodeId}`,
            active: tc.Active !== false,
            sales_tax_rate_id: salesTaxRateId,
            purchase_tax_rate_id: purchaseTaxRateId,
            synced_at: now,
          },
          { onConflict: "qbo_tax_code_id" }
        );

      if (tcErr) {
        console.error(`Failed to upsert TaxCode ${qboTaxCodeId}:`, tcErr);
        continue;
      }
      codesSynced++;
    }

    return new Response(
      JSON.stringify({ synced: ratesSynced, tax_codes_synced: codesSynced }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("qbo-sync-tax-rates error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message ?? "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
