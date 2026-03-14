import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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
    const tokenRes = await fetch(
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

    // Auth check - must be a logged-in user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) throw new Error("Unauthorized");
    const admin = createClient(supabaseUrl, serviceRoleKey);
    const token = authHeader.replace("Bearer ", "");

    const {
      data: { user },
      error: userError,
    } = await admin.auth.getUser(token);
    if (userError || !user) throw new Error("Unauthorized");

    const body = await req.json();
    const {
      first_name,
      last_name,
      company_name,
      display_name,
      phone,
      mobile,
      ebay_url,
      billing_address,
    } = body;

    // Get user email from auth
    const userEmail = user.email;

    // --- Step 1: Find or create local customer record ---
    // Look up by user_id first
    let { data: customer } = await admin
      .from("customer")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    // If not found by user_id, try matching by email
    if (!customer && userEmail) {
      const { data: byEmail } = await admin
        .from("customer")
        .select("*")
        .eq("email", userEmail)
        .maybeSingle();

      if (byEmail) {
        // Link this customer to the user
        await admin
          .from("customer")
          .update({ user_id: user.id })
          .eq("id", byEmail.id);
        customer = { ...byEmail, user_id: user.id };
      }
    }

    // Build the display name
    const effectiveDisplayName =
      display_name ||
      [first_name, last_name].filter(Boolean).join(" ") ||
      company_name ||
      userEmail ||
      "Unknown";

    // Prepare local customer data
    const customerData: Record<string, any> = {
      display_name: effectiveDisplayName,
      email: userEmail,
      phone: phone || null,
      mobile: mobile || null,
      company_name: company_name || null,
      web_addr: ebay_url || null,
      user_id: user.id,
      active: true,
      synced_at: new Date().toISOString(),
    };

    // Add billing address if provided
    if (billing_address) {
      customerData.billing_line_1 = billing_address.line_1 || null;
      customerData.billing_line_2 = billing_address.line_2 || null;
      customerData.billing_city = billing_address.city || null;
      customerData.billing_county = billing_address.county || null;
      customerData.billing_postcode = billing_address.postcode || null;
      customerData.billing_country = billing_address.country || "GB";
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
      GivenName: first_name || undefined,
      FamilyName: last_name || undefined,
      CompanyName: company_name || undefined,
      DisplayName: effectiveDisplayName,
    };

    if (userEmail) {
      qboPayload.PrimaryEmailAddr = { Address: userEmail };
    }
    if (phone) {
      qboPayload.PrimaryPhone = { FreeFormNumber: phone };
    }
    if (mobile) {
      qboPayload.Mobile = { FreeFormNumber: mobile };
    }
    if (ebay_url) {
      qboPayload.WebAddr = { URI: ebay_url };
    }

    // Add billing address to QBO payload
    if (billing_address) {
      qboPayload.BillAddr = {
        Line1: billing_address.line_1 || undefined,
        Line2: billing_address.line_2 || undefined,
        City: billing_address.city || undefined,
        CountrySubDivisionCode: billing_address.county || undefined,
        PostalCode: billing_address.postcode || undefined,
        Country: billing_address.country || "GB",
      };
    } else if (customer) {
      // Use existing billing address from customer record
      qboPayload.BillAddr = {
        Line1: customer.billing_line_1 || undefined,
        Line2: customer.billing_line_2 || undefined,
        City: customer.billing_city || undefined,
        CountrySubDivisionCode: customer.billing_county || undefined,
        PostalCode: customer.billing_postcode || undefined,
        Country: customer.billing_country || "GB",
      };
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
      } else {
        // Customer might have been deleted in QBO, create a new one
        console.warn(
          `QBO customer ${qboCustomerId} not found, creating new`
        );
        qboCustomerId = null;
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
