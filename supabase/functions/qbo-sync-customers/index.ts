import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function ensureValidToken(admin: any, realmId: string, clientId: string, clientSecret: string) {
  const { data: conn, error } = await admin
    .from("qbo_connection")
    .select("*")
    .eq("realm_id", realmId)
    .single();
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

async function queryQboAll(baseUrl: string, accessToken: string, entity: string): Promise<any[]> {
  const all: any[] = [];
  let startPos = 1;
  const pageSize = 1000;
  while (true) {
    const query = encodeURIComponent(`SELECT * FROM ${entity} STARTPOSITION ${startPos} MAXRESULTS ${pageSize}`);
    const res = await fetch(`${baseUrl}/query?query=${query}`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`QBO ${entity} query failed [${res.status}]: ${await res.text()}`);
    const data = await res.json();
    const page = data?.QueryResponse?.[entity] ?? [];
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
    const isWebhook = req.headers.get("x-webhook-trigger") === "true" && token === serviceRoleKey;

    if (!isWebhook) {
      const { data: { user }, error: userError } = await admin.auth.getUser(token);
      if (userError || !user) throw new Error("Unauthorized");
      const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", user.id);
      const hasAccess = (roles ?? []).some((r: any) => r.role === "admin" || r.role === "staff");
      if (!hasAccess) throw new Error("Forbidden");
    } else {
      console.log("Webhook-triggered sync (service role auth)");
    }

    const accessToken = await ensureValidToken(admin, realmId, clientId, clientSecret);
    const baseUrl = `https://quickbooks.api.intuit.com/v3/company/${realmId}`;
    const correlationId = crypto.randomUUID();

    // --- Step 1: Fetch and land all QBO Customers ---
    const qboCustomers = await queryQboAll(baseUrl, accessToken, "Customer");
    console.log(`Landing ${qboCustomers.length} QBO customers (correlation: ${correlationId})`);

    // Land raw payloads
    for (const c of qboCustomers) {
      try {
        await admin
          .from("landing_raw_qbo_customer")
          .upsert(
            {
              external_id: String(c.Id),
              raw_payload: c,
              status: "pending",
              correlation_id: correlationId,
              received_at: new Date().toISOString(),
            },
            { onConflict: "external_id" }
          );
      } catch (err) {
        console.error(`Failed to land customer ${c.Id}:`, err);
      }
    }

    // --- Step 2: Process into canonical tables ---
    let upserted = 0;
    let skipped = 0;

    for (const c of qboCustomers) {
      const qboId = String(c.Id);
      const billAddr = c.BillAddr ?? {};

      const row = {
        qbo_customer_id: qboId,
        display_name: c.DisplayName ?? c.FullyQualifiedName ?? "Unknown",
        email: c.PrimaryEmailAddr?.Address ?? null,
        phone: c.PrimaryPhone?.FreeFormNumber ?? null,
        mobile: c.Mobile?.FreeFormNumber ?? null,
        billing_line_1: billAddr.Line1 ?? null,
        billing_line_2: billAddr.Line2 ?? null,
        billing_city: billAddr.City ?? null,
        billing_county: billAddr.CountrySubDivisionCode ?? null,
        billing_postcode: billAddr.PostalCode ?? null,
        billing_country: billAddr.Country ?? "GB",
        notes: c.Notes ?? null,
        active: c.Active !== false,
        synced_at: new Date().toISOString(),
      };

      const { error } = await admin
        .from("customer")
        .upsert(row, { onConflict: "qbo_customer_id" });

      if (error) {
        console.error(`Failed to upsert customer ${qboId}:`, error.message);
        skipped++;
      } else {
        upserted++;
      }
    }

    // --- Step 2: Backfill orders from QBO SalesReceipts/RefundReceipts ---
    // Find orders with origin_channel qbo/qbo_refund and no customer_id
    const { data: unlinkedOrders } = await admin
      .from("sales_order")
      .select("id, origin_channel, origin_reference")
      .in("origin_channel", ["qbo", "qbo_refund"])
      .is("customer_id", null);

    let ordersLinked = 0;

    if (unlinkedOrders && unlinkedOrders.length > 0) {
      // Fetch SalesReceipts and RefundReceipts from QBO to get CustomerRef
      const [salesReceipts, refundReceipts] = await Promise.all([
        queryQboAll(baseUrl, accessToken, "SalesReceipt"),
        queryQboAll(baseUrl, accessToken, "RefundReceipt"),
      ]);

      // Build map: QBO transaction ID → CustomerRef.value
      const txnToCustomer = new Map<string, string>();
      for (const sr of salesReceipts) {
        if (sr.CustomerRef?.value) txnToCustomer.set(String(sr.Id), String(sr.CustomerRef.value));
      }
      for (const rr of refundReceipts) {
        if (rr.CustomerRef?.value) txnToCustomer.set(String(rr.Id), String(rr.CustomerRef.value));
      }

      // Build map: qbo_customer_id → customer.id
      const { data: allCustomers } = await admin
        .from("customer")
        .select("id, qbo_customer_id");
      const qboToCustomerId = new Map<string, string>();
      for (const c of allCustomers ?? []) {
        qboToCustomerId.set(c.qbo_customer_id, c.id);
      }

      for (const order of unlinkedOrders) {
        if (!order.origin_reference) continue;
        const qboCustId = txnToCustomer.get(order.origin_reference);
        if (!qboCustId) continue;
        const customerId = qboToCustomerId.get(qboCustId);
        if (!customerId) continue;

        const { error } = await admin
          .from("sales_order")
          .update({ customer_id: customerId })
          .eq("id", order.id);

        if (!error) ordersLinked++;
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        qbo_customers: qboCustomers.length,
        upserted,
        skipped,
        orders_linked: ordersLinked,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("qbo-sync-customers error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
