import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const FETCH_TIMEOUT_MS = 30_000;

/** Fetch with timeout to prevent indefinite hangs on external APIs */
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

async function fetchQboItem(
  itemId: string,
  cache: Map<string, any>,
  baseUrl: string,
  accessToken: string
): Promise<any | null> {
  if (cache.has(itemId)) return cache.get(itemId);
  try {
    const res = await fetchWithTimeout(`${baseUrl}/item/${itemId}`, {
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

  for (const rawLine of rawLines) {
    if (rawLine.DetailType !== "ItemBasedExpenseLineDetail") continue;
    const detail = rawLine.ItemBasedExpenseLineDetail;
    const qboItemId = detail?.ItemRef?.value;
    const taxCodeRef = detail?.TaxCodeRef?.value;
    const unitPrice = detail?.UnitPrice ?? null;
    if (!qboItemId || !taxCodeRef) continue;

    // Match by qbo_item_id + unit_cost to disambiguate duplicate items on the same receipt
    let query = supabaseAdmin
      .from("inbound_receipt_line")
      .select("id, qbo_tax_code_ref, tax_code_id")
      .eq("inbound_receipt_id", receiptId)
      .eq("qbo_item_id", qboItemId);

    if (unitPrice !== null) {
      query = query.eq("unit_cost", unitPrice);
    }

    const { data: matchedLines } = await query;
    const existingLine = (matchedLines ?? []).find(
      (l: any) => !l.qbo_tax_code_ref || !l.tax_code_id
    ) ?? matchedLines?.[0] ?? null;

    if (!existingLine) continue;

    if (!existingLine.qbo_tax_code_ref) {
      await supabaseAdmin
        .from("inbound_receipt_line")
        .update({ qbo_tax_code_ref: taxCodeRef })
        .eq("id", existingLine.id);
    }

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

  // Backfill stock_unit → inbound_receipt_line links using sku_id for accuracy
  // (matching by mpn+grade alone is fragile when multiple SKUs share the same MPN)
  const { data: receiptLines } = await supabaseAdmin
    .from("inbound_receipt_line")
    .select("id, mpn, condition_grade, quantity, sku_code")
    .eq("inbound_receipt_id", receiptId)
    .eq("is_stock_line", true);

  for (const rl of (receiptLines ?? [])) {
    if (!rl.mpn || !rl.condition_grade) continue;

    // Prefer matching by sku_id (via sku_code) for accuracy
    let unlinkedQuery = supabaseAdmin
      .from("stock_unit")
      .select("id")
      .is("inbound_receipt_line_id", null)
      .eq("status", "available")
      .limit(rl.quantity);

    if (rl.sku_code) {
      // Resolve sku_code → sku_id first
      const { data: sku } = await supabaseAdmin
        .from("sku").select("id").eq("sku_code", rl.sku_code).maybeSingle();
      if (sku) {
        unlinkedQuery = unlinkedQuery.eq("sku_id", sku.id);
      } else {
        // Fallback to mpn + grade if SKU not found
        unlinkedQuery = unlinkedQuery.eq("mpn", rl.mpn).eq("condition_grade", rl.condition_grade);
      }
    } else {
      unlinkedQuery = unlinkedQuery.eq("mpn", rl.mpn).eq("condition_grade", rl.condition_grade);
    }

    const { data: unlinkedUnits } = await unlinkedQuery;

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
    id?: string;
    is_stock_line: boolean;
    mpn: string | null;
    condition_grade: string | null;
    line_total: number;
    quantity: number;
    unit_cost: number;
    description?: string | null;
    sku_code?: string | null;
    qbo_item_id?: string | null;
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
    // Use raw sku_code from line if available, otherwise reconstruct from mpn + grade
    const skuCode = line.sku_code || (conditionGrade !== "1" ? `${mpn}.${conditionGrade}` : mpn);

    const { data: product } = await supabaseAdmin
      .from("product")
      .select("id, mpn")
      .eq("mpn", mpn)
      .single();

    const lineTotal = Number(line.line_total);
    const lineOverhead = totalStockCost > 0 ? totalOverhead * (lineTotal / totalStockCost) : 0;
    const overheadPerUnit = line.quantity > 0 ? lineOverhead / line.quantity : 0;
    // Round at the end only — avoid accumulating rounding error across lines
    const landedCostRaw = Number(line.unit_cost) + overheadPerUnit;
    const landedCost = Math.round(landedCostRaw * 100) / 100;

    let { data: sku } = await supabaseAdmin
      .from("sku")
      .select("id")
      .eq("sku_code", skuCode)
      .single();

    const qboItemId = line.qbo_item_id ?? null;

    if (!sku) {
      const { data: newSku, error: skuErr } = await supabaseAdmin
        .from("sku")
        .insert({
          product_id: product?.id ?? null,
          condition_grade: conditionGrade,
          sku_code: skuCode,
          name: cleanQboName(line.description ?? mpn),
          price: landedCost,
          active_flag: true,
          saleable_flag: !!product,
          qbo_item_id: qboItemId,
        })
        .select("id")
        .single();
      if (skuErr) throw skuErr;
      sku = newSku;
    } else if (qboItemId) {
      // Backfill qbo_item_id on existing SKUs that don't have it yet
      await supabaseAdmin
        .from("sku")
        .update({ qbo_item_id: qboItemId })
        .eq("id", sku.id)
        .is("qbo_item_id", null);
    }

    let existingCount = 0;
    if (line.id) {
      const { count } = await supabaseAdmin
        .from("stock_unit")
        .select("id", { count: "exact", head: true })
        .eq("inbound_receipt_line_id", line.id);
      existingCount = count ?? 0;
    }

    const shortfall = line.quantity - existingCount;
    if (shortfall > 0) {
      const stockUnits = [];
      for (let i = 0; i < shortfall; i++) {
        stockUnits.push({
          sku_id: sku!.id,
          mpn,
          condition_grade: conditionGrade,
          status: "available",
          landed_cost: landedCost,
          supplier_id: vendorName ?? null,
          inbound_receipt_line_id: line.id ?? null,
        });
      }

      const { error: suErr } = await supabaseAdmin.from("stock_unit").insert(stockUnits);
      if (suErr) throw suErr;
      unitsCreated += stockUnits.length;
    }
  }

  const { error: statusErr } = await supabaseAdmin
    .from("inbound_receipt")
    .update({ status: "processed", processed_at: new Date().toISOString() })
    .eq("id", receiptId);

  if (statusErr) {
    throw new Error(`Failed to mark receipt processed: ${statusErr.message}`);
  }

  return { processed: true, skipped: [] };
}

// ── Landing layer: capture raw QBO payloads before canonical processing ──

async function landPurchase(
  supabaseAdmin: any,
  purchase: any,
  correlationId: string
): Promise<{ landingId: string; alreadyLanded: boolean }> {
  const externalId = String(purchase.Id);

  // Check if already landed
  const { data: existing } = await supabaseAdmin
    .from("landing_raw_qbo_purchase")
    .select("id, status, raw_payload")
    .eq("external_id", externalId)
    .maybeSingle();

  if (existing) {
    // Compare payload — if changed and committed, reset to pending for reprocessing
    const oldPayload = JSON.stringify(existing.raw_payload ?? {});
    const newPayload = JSON.stringify(purchase);
    const payloadChanged = oldPayload !== newPayload;

    const updateFields: Record<string, any> = {
      raw_payload: purchase,
      received_at: new Date().toISOString(),
    };

    if (payloadChanged && existing.status === "committed") {
      // Payload changed — reset to pending so Phase 3 reprocesses it
      updateFields.status = "pending";
      updateFields.processed_at = null;
      console.log(`[landPurchase] Purchase ${externalId} payload changed — resetting committed → pending`);
    }

    await supabaseAdmin
      .from("landing_raw_qbo_purchase")
      .update(updateFields)
      .eq("id", existing.id);

    // Only skip if still committed (i.e. payload unchanged)
    const effectiveStatus = (payloadChanged && existing.status === "committed") ? "pending" : existing.status;
    return { landingId: existing.id, alreadyLanded: effectiveStatus === "committed" };
  }

  const { data: landing, error } = await supabaseAdmin
    .from("landing_raw_qbo_purchase")
    .insert({
      external_id: externalId,
      raw_payload: purchase,
      status: "pending",
      correlation_id: correlationId,
    })
    .select("id")
    .single();

  if (error) throw error;
  return { landingId: landing.id, alreadyLanded: false };
}

async function landQboItem(
  supabaseAdmin: any,
  item: any,
  correlationId: string
): Promise<void> {
  if (!item?.Id) return;
  const externalId = String(item.Id);

  await supabaseAdmin
    .from("landing_raw_qbo_item")
    .upsert(
      {
        external_id: externalId,
        raw_payload: item,
        status: "committed", // Items are reference data, committed immediately
        correlation_id: correlationId,
        received_at: new Date().toISOString(),
        processed_at: new Date().toISOString(),
      },
      { onConflict: "external_id" }
    );
}

async function markLandingCommitted(supabaseAdmin: any, landingId: string): Promise<void> {
  await supabaseAdmin
    .from("landing_raw_qbo_purchase")
    .update({ status: "committed", processed_at: new Date().toISOString() })
    .eq("id", landingId);
}

async function markLandingError(supabaseAdmin: any, landingId: string, errorMessage: string): Promise<void> {
  await supabaseAdmin
    .from("landing_raw_qbo_purchase")
    .update({ status: "error", error_message: errorMessage, processed_at: new Date().toISOString() })
    .eq("id", landingId);
}

// ── Main handler ──

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
    const isWebhook = req.headers.get("x-webhook-trigger") === "true" && token === serviceRoleKey;

    // Parse request body for required month parameter
    let targetMonth: string | null = null;
    try {
      const body = await req.json();
      if (body?.month && typeof body.month === "string") {
        targetMonth = body.month; // e.g. "2025-06"
      }
    } catch {
      // No body or invalid JSON — default to current month
    }

    // Default to current month if none provided
    if (!targetMonth) {
      const now = new Date();
      targetMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    }

    if (!isWebhook) {
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
    } else {
      console.log("Webhook-triggered sync (service role auth)");
    }

    const accessToken = await ensureValidToken(supabaseAdmin, realmId, clientId, clientSecret);
    const baseUrl = `https://quickbooks.api.intuit.com/v3/company/${realmId}`;

    // Generate a correlation ID for this sync run
    const correlationId = crypto.randomUUID();

    // ── Build single month range ──
    const [y, m] = targetMonth.split("-").map(Number);
    const monthStart = `${y}-${String(m).padStart(2, "0")}-01`;
    const lastDay = new Date(y, m, 0).getDate();
    const monthEnd = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    const monthLabel = targetMonth;
    console.log(`Processing single month: ${monthLabel} (${monthStart} → ${monthEnd})`);

    // Totals for this single month
    let totalPurchases = 0;
    let totalLanded = 0;
    let autoProcessed = 0;
    let leftPending = 0;
    let skippedExisting = 0;
    let skippedNoItems = 0;
    let backfilledTaxCodes = 0;
    let backfilledStockLinks = 0;
    let totalItemsCached = 0;
    const pendingReasons: string[] = [];

    // Query purchases for this month
    const query = encodeURIComponent(
      `SELECT * FROM Purchase WHERE TxnDate >= '${monthStart}' AND TxnDate <= '${monthEnd}' MAXRESULTS 1000`
    );
    console.log(`[${monthLabel}] Querying QBO purchases...`);
    const purchaseRes = await fetchWithTimeout(`${baseUrl}/query?query=${query}`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    });

    if (!purchaseRes.ok) {
      const errBody = await purchaseRes.text();
      throw new Error(`[${monthLabel}] QBO API failed [${purchaseRes.status}]: ${errBody}`);
    }

    const purchaseData = await purchaseRes.json();
    const purchases = purchaseData?.QueryResponse?.Purchase ?? [];
    totalPurchases = purchases.length;

    if (purchases.length > 0) {
      // ── Phase 1: Land all raw purchases ──
      console.log(`[${monthLabel}] Landing ${purchases.length} purchases...`);
      const landingResults: Array<{ purchase: any; landingId: string; alreadyLanded: boolean }> = [];

      for (const purchase of purchases) {
        try {
          const result = await landPurchase(supabaseAdmin, purchase, correlationId);
          landingResults.push({ purchase, ...result });
        } catch (err) {
          console.error(`[${monthLabel}] Failed to land purchase ${purchase.Id}:`, err);
        }
      }
      totalLanded = landingResults.length;

      // Fast-path: if ALL purchases in this month are already landed, skip heavy processing
      const newLandings = landingResults.filter(r => !r.alreadyLanded);
      if (newLandings.length === 0) {
        console.log(`[${monthLabel}] All ${landingResults.length} purchases already committed, skipping.`);
        skippedExisting = landingResults.length;
      } else {
        console.log(`[${monthLabel}] ${newLandings.length} new/pending, ${landingResults.length - newLandings.length} already committed.`);
        skippedExisting = landingResults.length - newLandings.length;

        // ── Phase 2: Pre-fetch QBO items for NEW purchases only and land them ──
        const uniqueItemIds = new Set<string>();
        for (const { purchase } of newLandings) {
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
        totalItemsCached = itemCache.size;

        // Land all fetched QBO items
        for (const [, item] of itemCache) {
          if (item) {
            try {
              await landQboItem(supabaseAdmin, item, correlationId);
            } catch (err) {
              console.error(`[${monthLabel}] Failed to land QBO item ${item?.Id}:`, err);
            }
          }
        }

        // ── Phase 3: Process NEW landings into canonical tables ──
        for (const { purchase, landingId } of newLandings) {
          const qboPurchaseId = purchase.Id;

          const hasItemLines = (purchase.Line ?? []).some(
            (l: any) => l.DetailType === "ItemBasedExpenseLineDetail"
          );
          if (!hasItemLines) {
            skippedNoItems++;
            await supabaseAdmin
              .from("landing_raw_qbo_purchase")
              .update({ status: "skipped", processed_at: new Date().toISOString() })
              .eq("id", landingId);
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
            console.error(`[${monthLabel}] Failed to upsert purchase ${qboPurchaseId}:`, receiptErr);
            await markLandingError(supabaseAdmin, landingId, `Upsert failed: ${receiptErr.message}`);
            continue;
          }

          // Already processed — delete-and-recreate to handle changed data
          if (receipt.status === "processed") {
            console.log(`[${monthLabel}] Reprocessing already-processed receipt ${receipt.id} (purchase ${qboPurchaseId})`);

            // Query old lines and their stock units
            const { data: oldProcLines } = await supabaseAdmin
              .from("inbound_receipt_line")
              .select("id, mpn, condition_grade, sku_code")
              .eq("inbound_receipt_id", receipt.id);

            const oldProcLineIds = (oldProcLines ?? []).map((l: any) => l.id);

            if (oldProcLineIds.length > 0) {
              const { data: linkedUnits } = await supabaseAdmin
                .from("stock_unit")
                .select("id, status, sku_id, landed_cost, carrying_value, mpn, condition_grade, inbound_receipt_line_id")
                .in("inbound_receipt_line_id", oldProcLineIds);

              for (const unit of (linkedUnits ?? [])) {
                if (unit.status === "closed") {
                  // Sold unit — attempt SKU reallocation by MPN from new purchase lines
                  const newLines = (purchase.Line ?? []).filter((l: any) => l.DetailType === "ItemBasedExpenseLineDetail");
                  let reallocated = false;

                  for (const nl of newLines) {
                    const itemRef = nl.ItemBasedExpenseLineDetail?.ItemRef;
                    if (!itemRef?.value) continue;
                    const qboItem = await fetchQboItem(itemRef.value, itemCache, baseUrl, accessToken);
                    const skuField = qboItem?.Sku;
                    const rawSku = (skuField && String(skuField).trim()) ? String(skuField).trim() : (itemRef.name ?? "").trim();
                    if (!rawSku) continue;
                    const parsed = parseSku(rawSku);

                    if (parsed.mpn === unit.mpn) {
                      // Same MPN — update landed cost
                      const newUnitCost = nl.ItemBasedExpenseLineDetail?.UnitPrice ?? 0;
                      const updates: Record<string, any> = {
                        landed_cost: newUnitCost,
                        carrying_value: newUnitCost,
                      };

                      // Check if SKU changed (grade changed)
                      if (parsed.conditionGrade !== unit.condition_grade) {
                        const newSkuCode = parsed.conditionGrade !== "1" ? `${parsed.mpn}.${parsed.conditionGrade}` : parsed.mpn;
                        const { data: newSku } = await supabaseAdmin.from("sku").select("id").eq("sku_code", newSkuCode).maybeSingle();
                        if (newSku) {
                          updates.sku_id = newSku.id;
                          updates.condition_grade = parsed.conditionGrade;
                        }
                      }

                      await supabaseAdmin.from("stock_unit").update(updates).eq("id", unit.id);
                      await supabaseAdmin.from("audit_event").insert({
                        entity_type: "stock_unit", entity_id: unit.id,
                        trigger_type: "purchase_reprocessing", actor_type: "system",
                        source_system: "qbo-sync-purchases",
                        before_json: { landed_cost: unit.landed_cost, carrying_value: unit.carrying_value, sku_id: unit.sku_id },
                        after_json: updates,
                        input_json: { qbo_purchase_id: qboPurchaseId, reason: "purchase_updated_sold_unit_reallocated" },
                      });
                      reallocated = true;
                      break;
                    }
                  }

                  if (!reallocated) {
                    // Unlink from receipt line but preserve the unit
                    await supabaseAdmin.from("stock_unit").update({ inbound_receipt_line_id: null }).eq("id", unit.id);
                    await supabaseAdmin.from("audit_event").insert({
                      entity_type: "stock_unit", entity_id: unit.id,
                      trigger_type: "purchase_reprocessing", actor_type: "system",
                      source_system: "qbo-sync-purchases",
                      input_json: { qbo_purchase_id: qboPurchaseId, reason: "sold_unit_orphaned_no_matching_mpn" },
                    });
                  }
                } else {
                  // Available/received/graded — delete and recreate
                  await supabaseAdmin.from("stock_unit").delete().eq("id", unit.id);
                }
              }
            }

            // Delete old lines
            await supabaseAdmin.from("inbound_receipt_line").delete().eq("inbound_receipt_id", receipt.id);

            // Reset receipt to pending so the code below recreates lines and auto-processes
            await supabaseAdmin.from("inbound_receipt").update({ status: "pending" }).eq("id", receipt.id);

            // Fall through to the line-creation + auto-process code below
          }

          // Nullify FK on stock_units referencing old lines before deleting them
          const { data: oldLines } = await supabaseAdmin
            .from("inbound_receipt_line")
            .select("id")
            .eq("inbound_receipt_id", receipt.id);

          if (oldLines && oldLines.length > 0) {
            const oldLineIds = oldLines.map((l: { id: string }) => l.id);
            const { error: unlinkErr } = await supabaseAdmin
              .from("stock_unit")
              .update({ inbound_receipt_line_id: null })
              .in("inbound_receipt_line_id", oldLineIds);
            if (unlinkErr) {
              console.error(`[${monthLabel}] Failed to unlink stock_units for receipt ${receipt.id}:`, unlinkErr);
            }
          }

          const { error: deleteErr } = await supabaseAdmin
            .from("inbound_receipt_line")
            .delete()
            .eq("inbound_receipt_id", receipt.id);
          if (deleteErr) {
            console.error(`[${monthLabel}] Failed to delete old lines for receipt ${receipt.id}:`, deleteErr);
            await markLandingError(supabaseAdmin, landingId, `Line delete failed: ${deleteErr.message}`);
            continue;
          }

          const lines = purchase.Line?.filter((l: any) =>
            l.DetailType === "ItemBasedExpenseLineDetail" || l.DetailType === "AccountBasedExpenseLineDetail"
          ) ?? [];

          const lineRows = [];
          for (const line of lines) {
            const detail = line.ItemBasedExpenseLineDetail ?? line.AccountBasedExpenseLineDetail ?? {};
            const isStockLine = line.DetailType === "ItemBasedExpenseLineDetail";

            let mpn: string | null = null;
            let conditionGrade: string | null = null;

            let rawSkuCode: string | null = null;
            if (isStockLine && detail.ItemRef?.value) {
              const qboItem = await fetchQboItem(detail.ItemRef.value, itemCache, baseUrl, accessToken);
              const skuField = qboItem?.Sku;
              if (skuField && String(skuField).trim()) {
                rawSkuCode = String(skuField).trim();
                const parsed = parseSku(String(skuField));
                mpn = parsed.mpn;
                conditionGrade = parsed.conditionGrade;
              } else if (detail.ItemRef?.name) {
                rawSkuCode = String(detail.ItemRef.name).trim();
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
              sku_code: rawSkuCode,
            });
          }

          if (lineRows.length > 0) {
            const { data: insertedLines, error: insertErr } = await supabaseAdmin
              .from("inbound_receipt_line")
              .insert(lineRows)
              .select("id, mpn, condition_grade, is_stock_line, qbo_tax_code_ref");

            if (insertErr) {
              console.error(`[${monthLabel}] Failed to insert lines for receipt ${receipt.id}:`, insertErr);
              await markLandingError(supabaseAdmin, landingId, `Line insert failed: ${insertErr.message}`);
              continue;
            }

            // Resolve qbo_tax_code_ref → tax_code_id
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

            const lineRowsWithIds = lineRows.map((lr, idx) => ({
              ...lr,
              id: insertedLines?.[idx]?.id ?? undefined,
            }));

            // Auto-process the receipt
            try {
              const result = await autoProcessReceipt(supabaseAdmin, receipt.id, vendorName, lineRowsWithIds);
              if (result.processed) {
                autoProcessed++;
                await markLandingCommitted(supabaseAdmin, landingId);
              } else {
                leftPending++;
                if (result.skipped.length > 0) {
                  pendingReasons.push(`Purchase ${qboPurchaseId}: ${result.skipped.join(", ")}`);
                }
              }
            } catch (procErr) {
              console.error(`[${monthLabel}] Auto-process failed for purchase ${qboPurchaseId}:`, procErr);
              leftPending++;
              await markLandingError(supabaseAdmin, landingId, `Auto-process error: ${procErr instanceof Error ? procErr.message : "Unknown"}`);
              pendingReasons.push(`Purchase ${qboPurchaseId}: processing error`);
            }
          }
        }
      }
    }

    console.log(`[${monthLabel}] Done.`);

    // Clean up existing pending receipts that have zero stock lines
    const { data: pendingReceipts } = await supabaseAdmin
      .from("inbound_receipt")
      .select("id")
      .eq("status", "pending");

    let cleanedUp = 0;
    for (const pr of (pendingReceipts ?? [])) {
      const { count: stockLineCount } = await supabaseAdmin
        .from("inbound_receipt_line")
        .select("id", { count: "exact", head: true })
        .eq("inbound_receipt_id", pr.id)
        .eq("is_stock_line", true);
      if (stockLineCount === 0) {
        // Check no stock_units reference any lines on this receipt before deleting
        const { data: receiptLines } = await supabaseAdmin
          .from("inbound_receipt_line")
          .select("id")
          .eq("inbound_receipt_id", pr.id);
        const lineIds = (receiptLines ?? []).map((l: { id: string }) => l.id);
        if (lineIds.length > 0) {
          const { count: linkedUnits } = await supabaseAdmin
            .from("stock_unit")
            .select("id", { count: "exact", head: true })
            .in("inbound_receipt_line_id", lineIds);
          if ((linkedUnits ?? 0) > 0) continue; // Skip: stock_units still reference these lines
        }
        await supabaseAdmin.from("inbound_receipt_line").delete().eq("inbound_receipt_id", pr.id);
        await supabaseAdmin.from("inbound_receipt").delete().eq("id", pr.id);
        cleanedUp++;
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        correlation_id: correlationId,
        month: monthLabel,
        total: totalPurchases,
        landed: totalLanded,
        auto_processed: autoProcessed,
        left_pending: leftPending,
        skipped_existing: skippedExisting,
        skipped_no_items: skippedNoItems,
        cleaned_up: cleanedUp,
        backfilled_tax_codes: backfilledTaxCodes,
        backfilled_stock_links: backfilledStockLinks,
        pending_reasons: pendingReasons,
        items_cached: totalItemsCached,
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
