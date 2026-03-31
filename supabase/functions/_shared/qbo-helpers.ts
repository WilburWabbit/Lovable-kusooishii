// ============================================================
// Shared QBO Edge Function Helpers
// DRYs up boilerplate across all QBO push/sync functions.
// ============================================================

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";

// ─── CORS ───────────────────────────────────────────────────

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ─── Fetch with Timeout ─────────────────────────────────────

const FETCH_TIMEOUT_MS = 30_000;

export function fetchWithTimeout(
  url: string | URL,
  options: RequestInit = {},
  timeoutMs = FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() =>
    clearTimeout(timer)
  );
}

// ─── Supabase Admin Client ──────────────────────────────────

export function createAdminClient(): SupabaseClient {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(supabaseUrl, serviceRoleKey);
}

// ─── Request Authentication ─────────────────────────────────

export async function authenticateRequest(
  req: Request,
  admin: SupabaseClient,
): Promise<{ userId: string; email: string | undefined }> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new Error("Unauthorized — missing Bearer token");
  }
  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error } = await admin.auth.getUser(token);
  if (error || !user) throw new Error("Unauthorized — invalid token");
  return { userId: user.id, email: user.email };
}

// ─── QBO Token Management ───────────────────────────────────

export function getQBOConfig() {
  const clientId = Deno.env.get("QBO_CLIENT_ID")!;
  const clientSecret = Deno.env.get("QBO_CLIENT_SECRET")!;
  const realmId = Deno.env.get("QBO_REALM_ID");
  if (!clientId || !clientSecret || !realmId) {
    throw new Error("QBO credentials not configured");
  }
  return { clientId, clientSecret, realmId };
}

export function qboBaseUrl(realmId: string): string {
  return `https://quickbooks.api.intuit.com/v3/company/${realmId}`;
}

export async function ensureValidToken(
  admin: SupabaseClient,
  realmId: string,
  clientId: string,
  clientSecret: string,
): Promise<string> {
  const { data: conn, error } = await admin
    .from("qbo_connection")
    .select("*")
    .eq("realm_id", realmId)
    .single();

  if (error || !conn) throw new Error("No QBO connection found.");

  // Refresh if token expires within 5 minutes
  if (new Date(conn.token_expires_at).getTime() - Date.now() < 5 * 60 * 1000) {
    const tokenRes = await fetchWithTimeout(
      "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
      {
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
      },
    );

    if (!tokenRes.ok) {
      throw new Error(`Token refresh failed [${tokenRes.status}]`);
    }

    const tokens = await tokenRes.json();
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

    await admin
      .from("qbo_connection")
      .update({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        token_expires_at: expiresAt,
      })
      .eq("realm_id", realmId);

    return tokens.access_token;
  }

  return conn.access_token;
}

// ─── QBO Account Mapping ───────────────────────────────────

/** Default account definitions for eBay financial sync */
export const DEFAULT_ACCOUNT_MAPPING: Record<string, {
  purpose: string;
  defaultName: string;
  accountType: string;
  accountSubType: string;
}> = {
  bank_account: {
    purpose: "bank_account",
    defaultName: "Business Current Account",
    accountType: "Bank",
    accountSubType: "Checking",
  },
  undeposited_funds: {
    purpose: "undeposited_funds",
    defaultName: "Undeposited Funds",
    accountType: "Other Current Asset",
    accountSubType: "UndepositedFunds",
  },
  ebay_selling_fees: {
    purpose: "ebay_selling_fees",
    defaultName: "eBay Selling Fees",
    accountType: "Expense",
    accountSubType: "OtherMiscellaneousServiceCost",
  },
  ebay_advertising: {
    purpose: "ebay_advertising",
    defaultName: "eBay Advertising",
    accountType: "Expense",
    accountSubType: "AdvertisingPromotional",
  },
  ebay_international_fees: {
    purpose: "ebay_international_fees",
    defaultName: "eBay International Fees",
    accountType: "Expense",
    accountSubType: "OtherMiscellaneousServiceCost",
  },
  ebay_regulatory_fees: {
    purpose: "ebay_regulatory_fees",
    defaultName: "eBay Regulatory Fees",
    accountType: "Expense",
    accountSubType: "OtherMiscellaneousServiceCost",
  },
  ebay_shipping_labels: {
    purpose: "ebay_shipping_labels",
    defaultName: "eBay Shipping Labels",
    accountType: "Expense",
    accountSubType: "ShippingFreightDelivery",
  },
  ebay_other_costs: {
    purpose: "ebay_other_costs",
    defaultName: "eBay Other Costs",
    accountType: "Expense",
    accountSubType: "OtherMiscellaneousServiceCost",
  },
};

/**
 * Get the QBO account ID for a given purpose from qbo_account_mapping.
 * Returns null if not mapped yet.
 */
export async function getAccountMapping(
  admin: SupabaseClient,
  purpose: string,
): Promise<string | null> {
  const { data } = await admin
    .from("qbo_account_mapping" as never)
    .select("qbo_account_id")
    .eq("purpose", purpose)
    .maybeSingle();

  return (data as Record<string, unknown> | null)?.qbo_account_id as string | null;
}

/**
 * Get all account mappings as a purpose→accountId map.
 */
export async function getAllAccountMappings(
  admin: SupabaseClient,
): Promise<Record<string, string>> {
  const { data } = await admin
    .from("qbo_account_mapping" as never)
    .select("purpose, qbo_account_id");

  const map: Record<string, string> = {};
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    map[row.purpose as string] = row.qbo_account_id as string;
  }
  return map;
}

/**
 * Query QBO for an account by name. Returns the QBO Account object or null.
 */
export async function queryQboAccountByName(
  accessToken: string,
  realmId: string,
  accountName: string,
): Promise<Record<string, unknown> | null> {
  const baseUrl = qboBaseUrl(realmId);
  const query = encodeURIComponent(`SELECT * FROM Account WHERE Name = '${accountName}'`);
  const res = await fetchWithTimeout(`${baseUrl}/query?query=${query}&minorversion=65`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  if (!res.ok) return null;
  const data = await res.json();
  const accounts = data?.QueryResponse?.Account;
  return accounts?.[0] ?? null;
}

/**
 * Create a QBO account and return it.
 */
export async function createQboAccount(
  accessToken: string,
  realmId: string,
  account: { Name: string; AccountType: string; AccountSubType?: string },
): Promise<Record<string, unknown>> {
  const baseUrl = qboBaseUrl(realmId);
  const res = await fetchWithTimeout(`${baseUrl}/account?minorversion=65`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(account),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`QBO Account creation failed [${res.status}]: ${errorText}`);
  }

  const data = await res.json();
  return data.Account;
}

/**
 * Ensure all required QBO accounts exist and are mapped.
 * Creates missing accounts in QBO and saves mapping to qbo_account_mapping table.
 * Returns the full purpose→accountId map.
 */
export async function ensureAccountMapping(
  admin: SupabaseClient,
  accessToken: string,
  realmId: string,
): Promise<Record<string, string>> {
  const existing = await getAllAccountMappings(admin);
  const result = { ...existing };

  for (const [purpose, def] of Object.entries(DEFAULT_ACCOUNT_MAPPING)) {
    if (result[purpose]) continue;

    // Check if QBO already has this account
    let qboAccount = await queryQboAccountByName(accessToken, realmId, def.defaultName);

    // Create if missing
    if (!qboAccount) {
      qboAccount = await createQboAccount(accessToken, realmId, {
        Name: def.defaultName,
        AccountType: def.accountType,
        AccountSubType: def.accountSubType,
      });
    }

    const accountId = String(qboAccount.Id);

    // Save mapping
    await admin
      .from("qbo_account_mapping" as never)
      .upsert({
        purpose,
        qbo_account_id: accountId,
        qbo_account_name: def.defaultName,
        account_type: def.accountType,
        updated_at: new Date().toISOString(),
      } as never, { onConflict: "purpose" as never });

    result[purpose] = accountId;
  }

  return result;
}

/**
 * Query or create an "eBay" vendor in QBO. Returns the vendor Id.
 */
export async function ensureEbayVendor(
  admin: SupabaseClient,
  accessToken: string,
  realmId: string,
): Promise<string> {
  // Check mapping first
  const vendorMapping = await getAccountMapping(admin, "ebay_vendor");
  if (vendorMapping) return vendorMapping;

  const baseUrl = qboBaseUrl(realmId);
  const query = encodeURIComponent("SELECT * FROM Vendor WHERE DisplayName = 'eBay'");
  const res = await fetchWithTimeout(`${baseUrl}/query?query=${query}&minorversion=65`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  let vendorId: string;
  if (res.ok) {
    const data = await res.json();
    const vendor = data?.QueryResponse?.Vendor?.[0];
    if (vendor) {
      vendorId = String(vendor.Id);
    } else {
      // Create vendor
      const createRes = await fetchWithTimeout(`${baseUrl}/vendor?minorversion=65`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ DisplayName: "eBay" }),
      });
      if (!createRes.ok) throw new Error("Failed to create eBay vendor in QBO");
      const createData = await createRes.json();
      vendorId = String(createData.Vendor.Id);
    }
  } else {
    throw new Error("Failed to query QBO vendors");
  }

  // Save mapping
  await admin
    .from("qbo_account_mapping" as never)
    .upsert({
      purpose: "ebay_vendor",
      qbo_account_id: vendorId,
      qbo_account_name: "eBay",
      account_type: "Vendor",
      updated_at: new Date().toISOString(),
    } as never, { onConflict: "purpose" as never });

  return vendorId;
}

// ─── JSON Response Helpers ──────────────────────────────────

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function errorResponse(err: unknown, status = 400): Response {
  console.error("Edge function error:", err);
  return new Response(
    JSON.stringify({
      error: err instanceof Error ? err.message : "Unknown error",
    }),
    {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
}
