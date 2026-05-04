// Redeployed: 2026-03-23
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";
import { verifyServiceRoleJWT } from "../_shared/auth.ts";

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

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed.length > 0 ? trimmed : null;
}

function isEbayRelayEmail(value: unknown): boolean {
  return typeof value === "string" && /@members\.ebay\./i.test(value);
}

function isUsableDisplayName(value: unknown): value is string {
  const cleaned = cleanText(value);
  return !!cleaned && !isEbayRelayEmail(cleaned);
}

function splitPersonName(name: string | null): { firstName: string | null; lastName: string | null } {
  if (!name || name.includes("@")) return { firstName: null, lastName: null };
  const parts = name.split(" ").filter(Boolean);
  if (parts.length === 0) return { firstName: null, lastName: null };
  if (parts.length === 1) return { firstName: parts[0], lastName: null };
  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts[parts.length - 1],
  };
}

async function ensureValidToken(
  admin: any,
  realmId: string,
  clientId: string,
  clientSecret: string
) {
  const { data: conn, error } = await admin
    .from("qbo_connection")
    .select("*")
    .eq("realm_id", realmId)
    .single();
  if (error || !conn) throw new Error("No QBO connection found.");

  if (
    new Date(conn.token_expires_at).getTime() - Date.now() <
    5 * 60 * 1000
  ) {
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
      }
    );
    if (!tokenRes.ok)
      throw new Error(`Token refresh failed [${tokenRes.status}]`);
    const tokens = await tokenRes.json();
    const expiresAt = new Date(
      Date.now() + tokens.expires_in * 1000
    ).toISOString();
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const clientId = Deno.env.get("QBO_CLIENT_ID")!;
    const clientSecret = Deno.env.get("QBO_CLIENT_SECRET")!;
    const realmId = Deno.env.get("QBO_REALM_ID");
    if (!clientId || !clientSecret || !realmId)
      throw new Error("QBO credentials not configured");

    const body = await req.json();
    const {
      customer_id,     // admin mode: push an existing customer record
      first_name,
      last_name,
      company_name,
      display_name,
      phone,
      mobile,
      ebay_url,
      billing_address,
      queued_by,
      sales_order_id,
    } = body;

    // Auth check - accepts either a logged-in user or an internal posting
    // processor call using the service-role key.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) throw new Error("Unauthorized");
    const admin = createClient(supabaseUrl, serviceRoleKey);
    const token = authHeader.replace("Bearer ", "");

    let user: { id: string; email?: string | null } | null = null;
    if (verifyServiceRoleJWT(token, supabaseUrl)) {
      if (typeof queued_by === "string" && queued_by.length > 0) {
        const {
          data: { user: queuedUser },
        } = await admin.auth.admin.getUserById(queued_by);
        user = queuedUser ? { id: queuedUser.id, email: queuedUser.email } : null;
      }
      if (!user && customer_id) {
        user = { id: "service_role", email: undefined };
      }
      if (!user) throw new Error("Unauthorized service-role customer upsert");
    } else {
      const {
        data: { user: authUser },
        error: userError,
      } = await admin.auth.getUser(token);
      if (userError || !authUser) throw new Error("Unauthorized");
      user = { id: authUser.id, email: authUser.email };
    }

    let customer: any = null;
    let userEmail: string | undefined;
    let sourceOrder: Record<string, unknown> | null = null;

    // --- Step 1: Find or create local customer record ---
    if (customer_id) {
      // Admin mode — look up the specified customer
      const { data: existing } = await admin
        .from("customer")
        .select("*")
        .eq("id", customer_id)
        .maybeSingle();
      if (!existing) throw new Error("Customer not found");
      customer = existing;
      userEmail = customer.email ?? undefined;
    } else {
      // Self-service mode — look up by user_id
      userEmail = user.email;

      let { data: byUser } = await admin
        .from("customer")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();

      if (!byUser && userEmail) {
        const { data: byEmail } = await admin
          .from("customer")
          .select("*")
          .eq("email", userEmail)
          .maybeSingle();

        if (byEmail) {
          await admin
            .from("customer")
            .update({ user_id: user.id })
            .eq("id", byEmail.id);
          byUser = { ...byEmail, user_id: user.id };
        }
      }
      customer = byUser;
    }

    if (sales_order_id) {
      const { data: order } = await admin
        .from("sales_order")
        .select("id, origin_channel, origin_reference, guest_name, guest_email, shipping_name, shipping_line_1, shipping_line_2, shipping_city, shipping_county, shipping_postcode, shipping_country")
        .eq("id", sales_order_id)
        .maybeSingle();
      sourceOrder = order;
    }

    // Use provided fields, falling back to existing customer record
    const channelIds = (customer?.channel_ids ?? {}) as Record<string, unknown>;
    const ebayUsername = cleanText(channelIds.ebay) ?? null;
    const orderShippingName = cleanText(sourceOrder?.shipping_name);
    const orderGuestName = cleanText(sourceOrder?.guest_name);
    const preferredName =
      cleanText(display_name)
      ?? (isUsableDisplayName(orderShippingName) ? orderShippingName : null)
      ?? (isUsableDisplayName(customer?.display_name) ? cleanText(customer.display_name) : null)
      ?? ebayUsername
      ?? (isUsableDisplayName(orderGuestName) ? orderGuestName : null)
      ?? cleanText(company_name)
      ?? null;
    const splitName = splitPersonName(preferredName);
    const effectiveFirstName = cleanText(first_name) ?? cleanText(customer?.first_name) ?? splitName.firstName;
    const effectiveLastName = cleanText(last_name) ?? cleanText(customer?.last_name) ?? splitName.lastName;
    const effectiveEmail = (customer_id ? (cleanText(body.email) ?? cleanText(customer?.email)) : userEmail) ?? null;

    // Build the display name
    const effectiveDisplayName =
      cleanText(display_name) ||
      [effectiveFirstName, effectiveLastName].filter(Boolean).join(" ") ||
      cleanText(company_name) ||
      (isUsableDisplayName(customer?.display_name) ? cleanText(customer.display_name) : null) ||
      ebayUsername ||
      (isUsableDisplayName(orderGuestName) ? orderGuestName : null) ||
      effectiveEmail ||
      "Unknown";

    const effectiveBillingAddress = billing_address ?? (
      sourceOrder
        ? {
          line_1: sourceOrder.shipping_line_1,
          line_2: sourceOrder.shipping_line_2,
          city: sourceOrder.shipping_city,
          county: sourceOrder.shipping_county,
          postcode: sourceOrder.shipping_postcode,
          country: sourceOrder.shipping_country,
        }
        : null
    );

    // Prepare local customer data
    const customerData: Record<string, any> = {
      display_name: effectiveDisplayName,
      first_name: effectiveFirstName,
      last_name: effectiveLastName,
      email: effectiveEmail,
      phone: phone ?? customer?.phone ?? null,
      mobile: mobile ?? customer?.mobile ?? null,
      company_name: cleanText(company_name) ?? customer?.company_name ?? null,
      web_addr: ebay_url ?? customer?.web_addr ?? (ebayUsername ? `https://www.ebay.co.uk/usr/${encodeURIComponent(ebayUsername)}` : null),
      active: true,
      synced_at: new Date().toISOString(),
    };

    // Only set user_id in self-service mode
    if (!customer_id) {
      customerData.user_id = user.id;
    }

    // Add billing address if provided
    if (effectiveBillingAddress || customer) {
      customerData.billing_line_1 = cleanText(effectiveBillingAddress?.line_1) ?? customer?.billing_line_1 ?? null;
      customerData.billing_line_2 = cleanText(effectiveBillingAddress?.line_2) ?? customer?.billing_line_2 ?? null;
      customerData.billing_city = cleanText(effectiveBillingAddress?.city) ?? customer?.billing_city ?? null;
      customerData.billing_county = cleanText(effectiveBillingAddress?.county) ?? customer?.billing_county ?? null;
      customerData.billing_postcode = cleanText(effectiveBillingAddress?.postcode) ?? customer?.billing_postcode ?? null;
      customerData.billing_country = cleanText(effectiveBillingAddress?.country) ?? customer?.billing_country ?? "GB";
    }

    // --- Step 2: Get QBO access token ---
    const accessToken = await ensureValidToken(
      admin,
      realmId,
      clientId,
      clientSecret
    );
    const baseUrl = `https://quickbooks.api.intuit.com/v3/company/${realmId}`;

    // --- Step 3: Build QBO Customer payload ---
    const qboPayload: Record<string, any> = {
      GivenName: effectiveFirstName || undefined,
      FamilyName: effectiveLastName || undefined,
      CompanyName: cleanText(company_name) ?? customer?.company_name ?? undefined,
      DisplayName: effectiveDisplayName,
    };

    if (effectiveEmail) {
      qboPayload.PrimaryEmailAddr = { Address: effectiveEmail };
    }
    if (customerData.phone) {
      qboPayload.PrimaryPhone = { FreeFormNumber: customerData.phone };
    }
    if (customerData.mobile) {
      qboPayload.Mobile = { FreeFormNumber: customerData.mobile };
    }
    if (customerData.web_addr) {
      qboPayload.WebAddr = { URI: customerData.web_addr };
    }
    if (ebayUsername) {
      qboPayload.Notes = `eBay username: ${ebayUsername}`;
    }

    // Add billing/shipping address to QBO payload using the resolved local
    // customer data, so order-derived blanks cannot erase existing address lines.
    if (
      customerData.billing_line_1
      || customerData.billing_city
      || customerData.billing_postcode
      || customerData.billing_country
    ) {
      qboPayload.BillAddr = {
        Line1: customerData.billing_line_1 || undefined,
        Line2: customerData.billing_line_2 || undefined,
        City: customerData.billing_city || undefined,
        CountrySubDivisionCode: customerData.billing_county || undefined,
        PostalCode: customerData.billing_postcode || undefined,
        Country: customerData.billing_country || "GB",
      };
      qboPayload.ShipAddr = qboPayload.BillAddr;
    }

    // --- Step 4: Create or update in QBO ---
    let qboCustomerId = customer?.qbo_customer_id || null;
    let syncToken: string | null = null;

    if (qboCustomerId) {
      // Fetch current SyncToken from QBO (required for updates)
      const getRes = await fetch(
        `${baseUrl}/customer/${qboCustomerId}?minorversion=65`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json",
          },
        }
      );

      if (getRes.ok) {
        const getData = await getRes.json();
        syncToken = getData.Customer?.SyncToken;
        qboPayload.Id = qboCustomerId;
        qboPayload.SyncToken = syncToken;
        qboPayload.sparse = true;
      } else if (getRes.status === 404 || getRes.status === 400) {
        // Customer was deleted or doesn't exist in QBO — create a new one
        console.warn(
          `QBO customer ${qboCustomerId} not found (${getRes.status}), creating new`
        );
        qboCustomerId = null;
      } else {
        // Server error (5xx) or rate limit (429) — don't fall back to create
        // as it would produce a duplicate. Throw to let the caller handle retry.
        const errText = await getRes.text();
        throw new Error(`QBO customer fetch failed [${getRes.status}]: ${errText}. Will not create duplicate.`);
      }
    }

    // POST to create or update (QBO uses POST for both with sparse update)
    const qboRes = await fetch(`${baseUrl}/customer?minorversion=65`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(qboPayload),
    });

    if (!qboRes.ok) {
      const errorText = await qboRes.text();
      console.error(`QBO customer upsert failed [${qboRes.status}]:`, errorText);

      // Still save locally even if QBO fails
      if (customer) {
        await admin
          .from("customer")
          .update(customerData)
          .eq("id", customer.id);
      } else {
        await admin.from("customer").insert(customerData);
      }

      return new Response(
        JSON.stringify({
          success: false,
          local_saved: true,
          qbo_error: `QBO API error [${qboRes.status}]`,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const qboResult = await qboRes.json();
    const returnedId = String(qboResult.Customer.Id);

    // Update local customer with QBO ID
    customerData.qbo_customer_id = returnedId;

    if (customer) {
      await admin
        .from("customer")
        .update(customerData)
        .eq("id", customer.id);
    } else {
      await admin.from("customer").insert(customerData);
    }

    // Land raw payload for audit
    await admin.from("landing_raw_qbo_customer").upsert(
      {
        external_id: returnedId,
        raw_payload: qboResult.Customer,
        status: "committed",
        correlation_id: crypto.randomUUID(),
        received_at: new Date().toISOString(),
      },
      { onConflict: "external_id" }
    );

    return new Response(
      JSON.stringify({
        success: true,
        qbo_customer_id: returnedId,
        action: qboCustomerId ? "updated" : "created",
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("qbo-upsert-customer error:", err);
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : "Unknown error",
      }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
