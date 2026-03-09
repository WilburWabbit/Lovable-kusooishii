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

async function fetchQboItem(
  itemId: string,
  cache: Map<string, any>,
  baseUrl: string,
  accessToken: string
): Promise<any | null> {
  if (cache.has(itemId)) return cache.get(itemId);
  try {
    const res = await fetch(`${baseUrl}/item/${itemId}`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    });
    if (!res.ok) {
      console.error(`Failed to fetch QBO item ${itemId}: ${res.status}`);
      cache.set(itemId, null);
      return null;
    }
    const data = await res.json();
    const item = data?.Item ?? null;
    cache.set(itemId, item);
    return item;
  } catch (err) {
    console.error(`Error fetching QBO item ${itemId}:`, err);
    cache.set(itemId, null);
    return null;
  }
}

function parseSku(sku: string): { mpn: string; conditionGrade: string } {
  const trimmed = sku.trim();
  const dotIndex = trimmed.indexOf(".");
  let mpn: string;
  let conditionGrade: string;

  if (dotIndex > 0) {
    mpn = trimmed.substring(0, dotIndex);
    conditionGrade = trimmed.substring(dotIndex + 1) || "1";
  } else {
    mpn = trimmed;
    conditionGrade = "1";
  }

  if (!["1", "2", "3", "4", "5"].includes(conditionGrade)) {
    conditionGrade = "1";
  }

  return { mpn, conditionGrade };
}

/** Auto-process a pending receipt: create SKUs + stock_units, mark processed */
async function autoProcessReceipt(
  supabaseAdmin: any,
  receiptId: string,
  vendorName: string | null,
  lineRows: Array<{
    is_stock_line: boolean;
    mpn: string | null;
    condition_grade: string | null;
    line_total: number;
    quantity: number;
    unit_cost: number;
  }>
): Promise<{ processed: boolean; skipped: string[] }> {
  const stockLines = lineRows.filter(l => l.is_stock_line && l.mpn && l.condition_grade);
  const overheadLines = lineRows.filter(l => !l.is_stock_line);

  if (stockLines.length === 0) {
    return { processed: false, skipped: ["No mapped stock lines"] };
  }

  // Check if all stock lines have MPNs (lines marked as stock but missing MPN = exception)
  const unmappedStockLines = lineRows.filter(l => l.is_stock_line && (!l.mpn || !l.condition_grade));
  if (unmappedStockLines.length > 0) {
    return { processed: false, skipped: [`${unmappedStockLines.length} stock line(s) missing MPN/grade`] };
  }

  const totalOverhead = overheadLines.reduce((sum, l) => sum + Number(l.line_total), 0);
  const totalStockCost = stockLines.reduce((sum, l) => sum + Number(l.line_total), 0);

  const skipped: string[] = [];
  let unitsCreated = 0;
  const validGrades = ["1", "2", "3", "4", "5"];

  for (const line of stockLines) {
    const conditionGrade = validGrades.includes(line.condition_grade!) ? line.condition_grade! : "1";

    const { data: product } = await supabaseAdmin
      .from("catalog_product")
      .select("id, mpn")
      .eq("mpn", line.mpn)
      .single();

    if (!product) {
      skipped.push(`MPN ${line.mpn}: not found in catalog`);
      continue;
    }

    const lineTotal = Number(line.line_total);
    const lineOverhead = totalStockCost > 0 ? totalOverhead * (lineTotal / totalStockCost) : 0;
    const overheadPerUnit = line.quantity > 0 ? lineOverhead / line.quantity : 0;
    const landedCost = Math.round((Number(line.unit_cost) + overheadPerUnit) * 100) / 100;

    const skuCode = `${product.mpn}-G${conditionGrade}`;
    let { data: sku } = await supabaseAdmin
      .from("sku")
      .select("id")
      .eq("catalog_product_id", product.id)
      .eq("condition_grade", conditionGrade)
      .single();

    if (!sku) {
      const { data: newSku, error: skuErr } = await supabaseAdmin
        .from("sku")
        .insert({
          catalog_product_id: product.id,
          condition_grade: conditionGrade,
          sku_code: skuCode,
          price: landedCost,
          active_flag: true,
          saleable_flag: true,
        })
        .select("id")
        .single();
      if (skuErr) throw skuErr;
      sku = newSku;
    }

    const stockUnits = [];
    for (let i = 0; i < line.quantity; i++) {
      stockUnits.push({
        sku_id: sku!.id,
        mpn: product.mpn,
        condition_grade: conditionGrade,
        status: "received",
        landed_cost: landedCost,
        supplier_id: vendorName ?? null,
      });
    }

    const { error: suErr } = await supabaseAdmin.from("stock_unit").insert(stockUnits);
    if (suErr) throw suErr;
    unitsCreated += stockUnits.length;
  }

  // If any MPN was missing from catalog, leave pending
  if (skipped.length > 0) {
    return { processed: false, skipped };
  }

  // Mark as processed
  await supabaseAdmin
    .from("inbound_receipt")
    .update({ status: "processed", processed_at: new Date().toISOString() })
    .eq("id", receiptId);

  return { processed: true, skipped: [] };
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
    const baseUrl = `https://quickbooks.api.intuit.com/v3/company/${realmId}`;

    // Query purchases
    const query = encodeURIComponent("SELECT * FROM Purchase MAXRESULTS 1000");
    const purchaseRes = await fetch(`${baseUrl}/query?query=${query}`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    });

    if (!purchaseRes.ok) {
      const errBody = await purchaseRes.text();
      throw new Error(`QBO API failed [${purchaseRes.status}]: ${errBody}`);
    }

    const purchaseData = await purchaseRes.json();
    const purchases = purchaseData?.QueryResponse?.Purchase ?? [];

    // --- Pre-fetch all unique QBO item IDs in parallel ---
    const uniqueItemIds = new Set<string>();
    for (const purchase of purchases) {
      for (const line of (purchase.Line ?? [])) {
        if (line.DetailType === "ItemBasedExpenseLineDetail" && line.ItemBasedExpenseLineDetail?.ItemRef?.value) {
          uniqueItemIds.add(line.ItemBasedExpenseLineDetail.ItemRef.value);
        }
      }
    }

    const itemCache = new Map<string, any>();
    const itemIdArray = Array.from(uniqueItemIds);
    const BATCH_SIZE = 10;
    for (let i = 0; i < itemIdArray.length; i += BATCH_SIZE) {
      const batch = itemIdArray.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(id => fetchQboItem(id, itemCache, baseUrl, accessToken)));
    }
    console.log(`Pre-fetched ${itemCache.size} QBO items`);

    let autoProcessed = 0;
    let leftPending = 0;
    let skippedExisting = 0;
    let skippedNoItems = 0;
    const pendingReasons: string[] = [];

    for (const purchase of purchases) {
      const qboPurchaseId = purchase.Id;
      const vendorName = purchase.EntityRef?.name ?? null;
      const txnDate = purchase.TxnDate ?? null;
      const totalAmount = purchase.TotalAmt ?? 0;
      const currency = purchase.CurrencyRef?.value ?? "GBP";

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
        .select("id, status")
        .single();

      if (receiptErr) {
        console.error(`Failed to upsert purchase ${qboPurchaseId}:`, receiptErr);
        continue;
      }

      // Already processed — skip line rebuild and auto-processing
      if (receipt.status === "processed") {
        skippedExisting++;
        continue;
      }

      await supabaseAdmin
        .from("inbound_receipt_line")
        .delete()
        .eq("inbound_receipt_id", receipt.id);

      const lines = purchase.Line?.filter((l: any) =>
        l.DetailType === "ItemBasedExpenseLineDetail" || l.DetailType === "AccountBasedExpenseLineDetail"
      ) ?? [];

      const lineRows = [];
      for (const line of lines) {
        const detail = line.ItemBasedExpenseLineDetail ?? line.AccountBasedExpenseLineDetail ?? {};
        const isStockLine = line.DetailType === "ItemBasedExpenseLineDetail";

        let mpn: string | null = null;
        let conditionGrade: string | null = null;

        if (isStockLine && detail.ItemRef?.value) {
          const qboItem = await fetchQboItem(detail.ItemRef.value, itemCache, baseUrl, accessToken);
          const skuField = qboItem?.Sku;
          if (skuField && String(skuField).trim()) {
            const parsed = parseSku(String(skuField));
            mpn = parsed.mpn;
            conditionGrade = parsed.conditionGrade;
          } else if (detail.ItemRef?.name) {
            const parsed = parseSku(String(detail.ItemRef.name));
            mpn = parsed.mpn;
            conditionGrade = parsed.conditionGrade;
          }
        }

        lineRows.push({
          inbound_receipt_id: receipt.id,
          description: line.Description ?? detail.ItemRef?.name ?? "No description",
          quantity: detail.Qty ?? 1,
          unit_cost: detail.UnitPrice ?? line.Amount ?? 0,
          line_total: line.Amount ?? 0,
          qbo_item_id: detail.ItemRef?.value ?? null,
          is_stock_line: isStockLine,
          mpn,
          condition_grade: conditionGrade,
        });
      }

      if (lineRows.length > 0) {
        await supabaseAdmin.from("inbound_receipt_line").insert(lineRows);
      }

      // Auto-process the receipt
      try {
        const result = await autoProcessReceipt(supabaseAdmin, receipt.id, vendorName, lineRows);
        if (result.processed) {
          autoProcessed++;
        } else {
          leftPending++;
          if (result.skipped.length > 0) {
            pendingReasons.push(`Purchase ${qboPurchaseId}: ${result.skipped.join(", ")}`);
          }
        }
      } catch (procErr) {
        console.error(`Auto-process failed for purchase ${qboPurchaseId}:`, procErr);
        leftPending++;
        pendingReasons.push(`Purchase ${qboPurchaseId}: processing error`);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        total: purchases.length,
        auto_processed: autoProcessed,
        left_pending: leftPending,
        skipped_existing: skippedExisting,
        pending_reasons: pendingReasons,
        items_cached: itemCache.size,
      }),
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
