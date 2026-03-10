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

function cleanQboName(raw: string): string {
  return raw.replace(/\s*\([^)]*\)\s*$/, '').trim();
}

// ── Backfill: resolve tax codes and link stock units for already-processed receipts ──

async function backfillProcessedReceipt(
  supabaseAdmin: any,
  receiptId: string,
  rawPayload: any
): Promise<{ taxCodesUpdated: number; stockUnitsLinked: number }> {
  let taxCodesUpdated = 0;
  let stockUnitsLinked = 0;

  const rawLines: any[] = rawPayload?.Line ?? [];

  // 1) Backfill qbo_tax_code_ref and tax_code_id on receipt lines
  for (const rawLine of rawLines) {
    if (rawLine.DetailType !== "ItemBasedExpenseLineDetail") continue;
    const detail = rawLine.ItemBasedExpenseLineDetail;
    const qboItemId = detail?.ItemRef?.value;
    const taxCodeRef = detail?.TaxCodeRef?.value;
    if (!qboItemId || !taxCodeRef) continue;

    // Find the matching receipt line
    const { data: existingLine } = await supabaseAdmin
      .from("inbound_receipt_line")
      .select("id, qbo_tax_code_ref, tax_code_id")
      .eq("inbound_receipt_id", receiptId)
      .eq("qbo_item_id", qboItemId)
      .limit(1)
      .single();

    if (!existingLine) continue;

    // Update qbo_tax_code_ref if missing
    if (!existingLine.qbo_tax_code_ref) {
      await supabaseAdmin
        .from("inbound_receipt_line")
        .update({ qbo_tax_code_ref: taxCodeRef })
        .eq("id", existingLine.id);
    }

    // Resolve tax_code_id if missing
    if (!existingLine.tax_code_id) {
      const { data: tc } = await supabaseAdmin
        .from("tax_code")
        .select("id")
        .eq("qbo_tax_code_id", taxCodeRef)
        .maybeSingle();
      if (tc) {
        await supabaseAdmin
          .from("inbound_receipt_line")
          .update({ tax_code_id: tc.id })
          .eq("id", existingLine.id);
        taxCodesUpdated++;
      }
    }
  }

  // 2) Backfill stock_unit.inbound_receipt_line_id
  // Get all stock lines for this receipt
  const { data: receiptLines } = await supabaseAdmin
    .from("inbound_receipt_line")
    .select("id, mpn, condition_grade, quantity")
    .eq("inbound_receipt_id", receiptId)
    .eq("is_stock_line", true);

  for (const rl of (receiptLines ?? [])) {
    if (!rl.mpn || !rl.condition_grade) continue;

    // Find unlinked stock units matching this line's mpn + grade
    const { data: unlinkedUnits } = await supabaseAdmin
      .from("stock_unit")
      .select("id")
      .eq("mpn", rl.mpn)
      .eq("condition_grade", rl.condition_grade)
      .is("inbound_receipt_line_id", null)
      .limit(rl.quantity);

    for (const unit of (unlinkedUnits ?? [])) {
      await supabaseAdmin
        .from("stock_unit")
        .update({ inbound_receipt_line_id: rl.id })
        .eq("id", unit.id);
      stockUnitsLinked++;
    }
  }

  return { taxCodesUpdated, stockUnitsLinked };
}

// ── Auto-process a pending receipt: create SKUs + stock_units, mark processed ──

async function autoProcessReceipt(
  supabaseAdmin: any,
  receiptId: string,
  vendorName: string | null,
  lineRows: Array<{
    id?: string; // receipt line ID (after insert)
    is_stock_line: boolean;
    mpn: string | null;
    condition_grade: string | null;
    line_total: number;
    quantity: number;
    unit_cost: number;
    description?: string | null;
  }>
): Promise<{ processed: boolean; skipped: string[] }> {
  const stockLines = lineRows.filter(l => l.is_stock_line && l.mpn && l.condition_grade);
  const overheadLines = lineRows.filter(l => !l.is_stock_line);

  if (stockLines.length === 0) {
    return { processed: false, skipped: ["No mapped stock lines"] };
  }

  const unmappedStockLines = lineRows.filter(l => l.is_stock_line && (!l.mpn || !l.condition_grade));
  if (unmappedStockLines.length > 0) {
    return { processed: false, skipped: [`${unmappedStockLines.length} stock line(s) missing MPN/grade`] };
  }

  const totalOverhead = overheadLines.reduce((sum, l) => sum + Number(l.line_total), 0);
  const totalStockCost = stockLines.reduce((sum, l) => sum + Number(l.line_total), 0);

  let unitsCreated = 0;
  const validGrades = ["1", "2", "3", "4", "5"];

  for (const line of stockLines) {
    const conditionGrade = validGrades.includes(line.condition_grade!) ? line.condition_grade! : "1";
    const mpn = line.mpn!;
    const skuCode = `${mpn}-G${conditionGrade}`;

    const { data: product } = await supabaseAdmin
      .from("catalog_product")
      .select("id, mpn")
      .eq("mpn", mpn)
      .single();

    const lineTotal = Number(line.line_total);
    const lineOverhead = totalStockCost > 0 ? totalOverhead * (lineTotal / totalStockCost) : 0;
    const overheadPerUnit = line.quantity > 0 ? lineOverhead / line.quantity : 0;
    const landedCost = Math.round((Number(line.unit_cost) + overheadPerUnit) * 100) / 100;

    let { data: sku } = await supabaseAdmin
      .from("sku")
      .select("id")
      .eq("sku_code", skuCode)
      .single();

    if (!sku) {
      const { data: newSku, error: skuErr } = await supabaseAdmin
        .from("sku")
        .insert({
          catalog_product_id: product?.id ?? null,
          condition_grade: conditionGrade,
          sku_code: skuCode,
          name: cleanQboName(line.description ?? mpn),
          price: landedCost,
          active_flag: true,
          saleable_flag: !!product,
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
        mpn,
        condition_grade: conditionGrade,
        status: "available",
        landed_cost: landedCost,
        supplier_id: vendorName ?? null,
        inbound_receipt_line_id: line.id ?? null, // forward-fix: link to receipt line
      });
    }

    const { error: suErr } = await supabaseAdmin.from("stock_unit").insert(stockUnits);
    if (suErr) throw suErr;
    unitsCreated += stockUnits.length;
  }

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
    const BATCH_SIZE = 5;
    for (let i = 0; i < itemIdArray.length; i += BATCH_SIZE) {
      const batch = itemIdArray.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(id => fetchQboItem(id, itemCache, baseUrl, accessToken)));
      if (i + BATCH_SIZE < itemIdArray.length) {
        await new Promise(r => setTimeout(r, 250));
      }
    }
    console.log(`Pre-fetched ${itemCache.size} QBO items`);

    let autoProcessed = 0;
    let leftPending = 0;
    let skippedExisting = 0;
    let skippedNoItems = 0;
    let backfilledTaxCodes = 0;
    let backfilledStockLinks = 0;
    const pendingReasons: string[] = [];

    for (const purchase of purchases) {
      const qboPurchaseId = purchase.Id;

      const hasItemLines = (purchase.Line ?? []).some(
        (l: any) => l.DetailType === "ItemBasedExpenseLineDetail"
      );
      if (!hasItemLines) {
        skippedNoItems++;
        continue;
      }

      const vendorName = purchase.EntityRef?.name ?? null;
      const txnDate = purchase.TxnDate ?? null;
      const totalAmount = purchase.TotalAmt ?? 0;
      const currency = purchase.CurrencyRef?.value ?? "GBP";
      const globalTaxCalc = purchase.GlobalTaxCalculation ?? null;
      const taxTotal = purchase.TxnTaxDetail?.TotalTax ?? 0;

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
            tax_total: taxTotal,
            global_tax_calculation: globalTaxCalc,
          },
          { onConflict: "qbo_purchase_id" }
        )
        .select("id, status")
        .single();

      if (receiptErr) {
        console.error(`Failed to upsert purchase ${qboPurchaseId}:`, receiptErr);
        continue;
      }

      // Already processed — run backfill for tax codes & stock unit links, then skip
      if (receipt.status === "processed") {
        try {
          const bf = await backfillProcessedReceipt(supabaseAdmin, receipt.id, purchase);
          backfilledTaxCodes += bf.taxCodesUpdated;
          backfilledStockLinks += bf.stockUnitsLinked;
        } catch (bfErr) {
          console.error(`Backfill failed for receipt ${receipt.id}:`, bfErr);
        }
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

        const taxCodeRef = detail.TaxCodeRef?.value ?? null;

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
          qbo_tax_code_ref: taxCodeRef,
        });
      }

      if (lineRows.length > 0) {
        // Insert lines and get back IDs
        const { data: insertedLines, error: insertErr } = await supabaseAdmin
          .from("inbound_receipt_line")
          .insert(lineRows)
          .select("id, mpn, condition_grade, is_stock_line, qbo_tax_code_ref");

        if (insertErr) {
          console.error(`Failed to insert lines for receipt ${receipt.id}:`, insertErr);
        }

        // Resolve qbo_tax_code_ref → tax_code_id for each line
        for (const il of (insertedLines ?? [])) {
          if (il.qbo_tax_code_ref) {
            const { data: tc } = await supabaseAdmin
              .from("tax_code")
              .select("id")
              .eq("qbo_tax_code_id", il.qbo_tax_code_ref)
              .maybeSingle();
            if (tc) {
              await supabaseAdmin
                .from("inbound_receipt_line")
                .update({ tax_code_id: tc.id })
                .eq("id", il.id);
            }
          }
        }

        // Build line rows with IDs for autoProcessReceipt
        const lineRowsWithIds = lineRows.map((lr, idx) => ({
          ...lr,
          id: insertedLines?.[idx]?.id ?? undefined,
        }));

        // Auto-process the receipt
        try {
          const result = await autoProcessReceipt(supabaseAdmin, receipt.id, vendorName, lineRowsWithIds);
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
    }

    // Clean up existing pending receipts that have zero stock lines
    const { data: pendingReceipts } = await supabaseAdmin
      .from("inbound_receipt")
      .select("id")
      .eq("status", "pending");

    let cleanedUp = 0;
    for (const pr of (pendingReceipts ?? [])) {
      const { count } = await supabaseAdmin
        .from("inbound_receipt_line")
        .select("id", { count: "exact", head: true })
        .eq("inbound_receipt_id", pr.id)
        .eq("is_stock_line", true);
      if (count === 0) {
        await supabaseAdmin.from("inbound_receipt_line").delete().eq("inbound_receipt_id", pr.id);
        await supabaseAdmin.from("inbound_receipt").delete().eq("id", pr.id);
        cleanedUp++;
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        total: purchases.length,
        auto_processed: autoProcessed,
        left_pending: leftPending,
        skipped_existing: skippedExisting,
        skipped_no_items: skippedNoItems,
        cleaned_up: cleanedUp,
        backfilled_tax_codes: backfilledTaxCodes,
        backfilled_stock_links: backfilledStockLinks,
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
