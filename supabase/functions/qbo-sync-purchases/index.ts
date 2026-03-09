import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function ensureValidToken(supabaseAdmin: any, realmId: string, clientId: string, clientSecret: string) {
  const { data: conn, error } = await supabaseAdmin
    .from("qbo_connection")
    .select("*")
    .eq("realm_id", realmId)
    .single();

  if (error || !conn) throw new Error("No QBO connection found. Please connect to QBO first.");

  // If token expires within 5 minutes, refresh
  if (new Date(conn.token_expires_at).getTime() - Date.now() < 5 * 60 * 1000) {
    const tokenRes = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
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
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const clientId = Deno.env.get("QBO_CLIENT_ID")!;
    const clientSecret = Deno.env.get("QBO_CLIENT_SECRET")!;
    const realmId = Deno.env.get("QBO_REALM_ID");

    if (!clientId || !clientSecret || !realmId) {
      throw new Error("QBO credentials not configured");
    }

    // Verify caller is admin/staff
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) throw new Error("Unauthorized");

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !user) throw new Error("Unauthorized");

    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id);
    const hasAccess = (roles ?? []).some(
      (r: { role: string }) => r.role === "admin" || r.role === "staff"
    );
    if (!hasAccess) throw new Error("Forbidden");

    const accessToken = await ensureValidToken(supabaseAdmin, realmId, clientId, clientSecret);

    // Use sandbox or production base URL
    const baseUrl = `https://quickbooks.api.intuit.com/v3/company/${realmId}`;

    // Query purchases
    const query = encodeURIComponent("SELECT * FROM Purchase MAXRESULTS 1000");
    const purchaseRes = await fetch(`${baseUrl}/query?query=${query}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });

    if (!purchaseRes.ok) {
      const errBody = await purchaseRes.text();
      throw new Error(`QBO API failed [${purchaseRes.status}]: ${errBody}`);
    }

    const purchaseData = await purchaseRes.json();
    const purchases = purchaseData?.QueryResponse?.Purchase ?? [];

    let created = 0;
    let updated = 0;

    for (const purchase of purchases) {
      // Skip purchases without item-based lines (non-stock expenses)
      const itemLines = purchase.Line?.filter(
        (l: any) => l.DetailType === "ItemBasedExpenseLineDetail"
      ) ?? [];
      if (itemLines.length === 0) continue;

      const qboPurchaseId = purchase.Id;
      const vendorName = purchase.EntityRef?.name ?? null;
      const txnDate = purchase.TxnDate ?? null;
      const totalAmount = purchase.TotalAmt ?? 0;
      const currency = purchase.CurrencyRef?.value ?? "GBP";

      // Upsert receipt header
      const { data: receipt, error: receiptErr } = await supabaseAdmin
        .from("inbound_receipt")
        .upsert(
          {
            qbo_purchase_id: qboPurchaseId,
            vendor_name: vendorName,
            txn_date: txnDate,
            total_amount: totalAmount,
            currency,
            raw_payload: purchase,
          },
          { onConflict: "qbo_purchase_id" }
        )
        .select("id")
        .single();

      if (receiptErr) {
        console.error(`Failed to upsert purchase ${qboPurchaseId}:`, receiptErr);
        continue;
      }

      // Delete existing lines then re-insert (idempotent)
      await supabaseAdmin
        .from("inbound_receipt_line")
        .delete()
        .eq("inbound_receipt_id", receipt.id);

      const lines = purchase.Line?.filter((l: any) => l.DetailType === "ItemBasedExpenseLineDetail" || l.DetailType === "AccountBasedExpenseLineDetail") ?? [];

      const lineRows = lines.map((line: any) => {
        const detail = line.ItemBasedExpenseLineDetail ?? line.AccountBasedExpenseLineDetail ?? {};
        const isStockLine = line.DetailType === "ItemBasedExpenseLineDetail";

        // Parse MPN and condition_grade from ItemRef.name using '.' delimiter
        let mpn: string | null = null;
        let conditionGrade: string | null = null;
        if (isStockLine && detail.ItemRef?.name) {
          const rawName = String(detail.ItemRef.name).trim();
          const dotIndex = rawName.indexOf(".");
          if (dotIndex > 0) {
            mpn = rawName.substring(0, dotIndex);
            conditionGrade = rawName.substring(dotIndex + 1) || "1";
          } else {
            mpn = rawName;
            conditionGrade = "1";
          }
          // Validate grade is 1-5, default to 1
          if (!["1", "2", "3", "4", "5"].includes(conditionGrade)) {
            conditionGrade = "1";
          }
        }

        return {
          inbound_receipt_id: receipt.id,
          description: line.Description ?? detail.ItemRef?.name ?? "No description",
          quantity: detail.Qty ?? 1,
          unit_cost: detail.UnitPrice ?? line.Amount ?? 0,
          line_total: line.Amount ?? 0,
          qbo_item_id: detail.ItemRef?.value ?? null,
          is_stock_line: isStockLine,
          mpn,
          condition_grade: conditionGrade,
        };
      });

      if (lineRows.length > 0) {
        await supabaseAdmin.from("inbound_receipt_line").insert(lineRows);
      }

      created++;
    }

    return new Response(
      JSON.stringify({ success: true, total: purchases.length, created, updated }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("qbo-sync-purchases error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
