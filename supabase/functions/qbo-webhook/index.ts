import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";

/**
 * QBO Webhook Receiver — Targeted Entity Processing
 *
 * Receives POST notifications from Intuit when entities change.
 * Validates HMAC-SHA256 signature, then fetches the SINGLE changed entity
 * by ID and processes it inline (no full re-sync).
 *
 * Watched entities: Purchase, SalesReceipt, RefundReceipt, Customer, Item
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, intuit-signature, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ────────────────────────────────────────────────────────────
// Shared helpers (inlined — edge functions can't share files)
// ────────────────────────────────────────────────────────────

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

async function fetchQboEntity(baseUrl: string, accessToken: string, entityPath: string): Promise<any | null> {
  const res = await fetch(`${baseUrl}/${entityPath}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (!res.ok) {
    console.error(`QBO fetch ${entityPath} failed [${res.status}]: ${await res.text()}`);
    return null;
  }
  return await res.json();
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

/**
 * Parse QBO parent item name to extract brand and item type.
 * Convention: "LEGO:<ItemType>" → { brand: "LEGO", itemType: "<ItemType>" }
 *             "Other:<Brand>"   → { brand: "<Brand>", itemType: null }
 */
function parseParentCategory(parentName: string): { brand: string | null; itemType: string | null } {
  const trimmed = parentName.trim();
  const colonIdx = trimmed.indexOf(":");
  if (colonIdx <= 0) return { brand: null, itemType: null };
  const prefix = trimmed.substring(0, colonIdx).trim();
  const suffix = trimmed.substring(colonIdx + 1).trim();
  if (!suffix) return { brand: null, itemType: null };
  if (prefix.toUpperCase() === "LEGO") {
    return { brand: "LEGO", itemType: suffix };
  }
  // "Other:<Brand>" pattern
  return { brand: suffix, itemType: null };
}

/**
 * Fetch QBO parent item and extract brand/itemType from its name.
 * Returns { parentItemId, brand, itemType }.
 */
async function resolveParentCategory(
  baseUrl: string, accessToken: string, item: any
): Promise<{ parentItemId: string | null; brand: string | null; itemType: string | null }> {
  if (!item.ParentRef?.value) return { parentItemId: null, brand: null, itemType: null };
  const parentItemId = String(item.ParentRef.value);
  // Fetch the parent item to get its Name
  const parentData = await fetchQboEntity(baseUrl, accessToken, `item/${parentItemId}`);
  const parentName = parentData?.Item?.Name;
  if (!parentName) return { parentItemId, brand: null, itemType: null };
  const { brand, itemType } = parseParentCategory(parentName);
  return { parentItemId, brand, itemType };
}

// ────────────────────────────────────────────────────────────
// Post-creation enrichment: BrickEconomy + AI Copy
// ────────────────────────────────────────────────────────────

const BE_BASE = "https://www.brickeconomy.com/api/v1";

/**
 * Fetch a single set or minifig from BrickEconomy API, store in
 * brickeconomy_collection, and enrich the product record.
 */
async function enrichFromBrickEconomy(
  admin: any, mpn: string, itemType: string, productId: string
): Promise<boolean> {
  const apiKey = Deno.env.get("BRICKECONOMY_API_KEY");
  if (!apiKey) { console.warn("BRICKECONOMY_API_KEY not configured — skipping enrichment"); return false; }

  const isMinifig = itemType.toLowerCase().includes("minifig");
  const endpoint = isMinifig ? `${BE_BASE}/minifig/${encodeURIComponent(mpn)}` : `${BE_BASE}/set/${encodeURIComponent(mpn)}`;

  const res = await fetch(`${endpoint}?currency=GBP`, {
    headers: { "x-apikey": apiKey, "User-Agent": "BrickKeeperSync/1.0", Accept: "application/json" },
  });

  if (!res.ok) {
    // Try without the "-1" suffix for sets (e.g. "75367-1" → "75367")
    if (!isMinifig && mpn.endsWith("-1")) {
      const baseMpn = mpn.replace(/-1$/, "");
      const retryRes = await fetch(`${BE_BASE}/set/${encodeURIComponent(baseMpn)}?currency=GBP`, {
        headers: { "x-apikey": apiKey, "User-Agent": "BrickKeeperSync/1.0", Accept: "application/json" },
      });
      if (!retryRes.ok) {
        console.warn(`BrickEconomy lookup failed for ${mpn} and ${baseMpn}: ${retryRes.status}`);
        return false;
      }
      const retryData = await retryRes.json();
      return await processBrickEconomyResponse(admin, retryData, isMinifig, mpn, productId);
    }
    console.warn(`BrickEconomy lookup failed for ${mpn}: ${res.status}`);
    return false;
  }

  const data = await res.json();
  return await processBrickEconomyResponse(admin, data, isMinifig, mpn, productId);
}

async function processBrickEconomyResponse(
  admin: any, data: any, isMinifig: boolean, mpn: string, productId: string
): Promise<boolean> {
  // Unwrap response envelope
  const itemData = data.data ?? data;
  const item = isMinifig ? itemData : itemData;

  const now = new Date().toISOString();

  // Store in brickeconomy_collection
  const itemNumber = isMinifig
    ? String(item.minifig_number ?? item.set_number ?? mpn)
    : String(item.set_number ?? mpn);

  await admin.from("brickeconomy_collection").upsert({
    item_type: isMinifig ? "minifig" : "set",
    item_number: itemNumber,
    name: item.name ?? null,
    theme: item.theme ?? null,
    subtheme: item.subtheme ?? null,
    year: item.year ?? null,
    pieces_count: item.pieces_count ?? null,
    minifigs_count: item.minifigs_count ?? null,
    current_value: item.current_value ?? null,
    growth: item.growth ?? null,
    retail_price: item.retail_price ?? null,
    released_date: item.released_date ?? null,
    retired_date: item.retired_date ?? null,
    currency: "GBP",
    synced_at: now,
  }, { onConflict: "item_type,item_number,paid_price,acquired_date" }).then(({ error }: any) => {
    if (error) console.error(`brickeconomy_collection upsert error:`, error.message);
  });

  // Enrich the product record with BrickEconomy data
  const updates: Record<string, any> = {};
  if (item.name && !isMinifig) updates.name = item.name;
  if (item.pieces_count) updates.piece_count = item.pieces_count;
  if (item.year) updates.release_year = item.year;
  if (item.retired_date) updates.retired_flag = true;

  // Link to lego_catalog if match exists
  const mpnVariants = [mpn];
  if (!mpn.includes("-")) mpnVariants.push(`${mpn}-1`);
  const { data: catalogMatch } = await admin
    .from("lego_catalog").select("id, brickeconomy_id")
    .in("mpn", mpnVariants).is("brickeconomy_id", null).limit(1);
  if (catalogMatch && catalogMatch.length > 0) {
    await admin.from("lego_catalog").update({ brickeconomy_id: itemNumber }).eq("id", catalogMatch[0].id);
  }

  if (Object.keys(updates).length > 0) {
    await admin.from("product").update(updates).eq("id", productId);
  }

  console.log(`BrickEconomy enriched product ${productId} (${mpn}): value=${item.current_value}`);
  return true;
}

const COPY_SYSTEM_PROMPT = `You are writing for Kuso Oishii, an e-commerce shop voice defined by:

"Banter up top, brutal clarity underneath."

Tone: distinctly adult, sharp, irreverent, collector-intelligent.
Energy: late-night confidence, dry wit, restrained menace. Not laddish. Not juvenile. Not corporate.
You are speaking to grown collectors with disposable income and strong opinions.

Voice rules:
- Default tone: bold, witty, strong language, energetic, slightly dangerous.
- You may use moderate profanity in the Hook, Description, or call to action (CTA).
- Absolute limit: no graphic sexual language, no explicit sexual references, no fetish phrasing, no hate speech, no slurs, no politics.
- No profanity in Specifications, Condition, Disclosures, policies or customer service content.
- Suggestion and innuendo must remain subtle enough to pass mainstream advertising review.
- If in doubt, prioritise wit over explicitness.

Structure discipline:
Hook (1–2 lines) → Description → 1-line CTA → Highlights → Specifications → Condition (always).

Point of view:
- Use second person ("you").
- Use imperatives.
- Use "we" only for trust or process statements.

Collector fluency:
- Use set numbers, minifig IDs or codes, theme and subtheme terminology.
- Never invent missing facts.

Description discipline:
- The Description must be narrative-driven and persuasive.
- Do not restate specifications such as piece count, release dates, retirement dates, price or inventory status unless essential for storytelling impact.
- Do not repeat information that appears in Specifications.
- Focus on atmosphere, display presence, collector psychology and ownership experience.
- Sell the feeling of owning it, not the list of what it contains.
- Avoid listing minifigure codes or technical data unless used naturally inside narrative context.
- No bullet-style phrasing inside Description.
- No recital of facts.
- If the Description reads like a summary of Specifications, internally revise before output.

Hyperbole:
- Allowed in Hook and Description.
- Never distort factual information.

Language:
- British English spelling and date formats such as "1 March 2025".
- Avoid corporate filler language.

Formatting discipline:
- All content fields must contain Markdown-formatted text.
- Do not use Markdown code fences.
- Do not insert blank lines between paragraphs.
- Use single line breaks only.
- No double newline characters anywhere in the output.
- No trailing spaces.
- The Description must render as one continuous paragraph.
- The Hook may contain a single line break at most.

Data discipline:
- Use only provided facts.
- Do not invent availability, policies, or pricing logic.
- Clean output. No duplicated sentences. Closed quotes. No stray characters.

If required facts are missing, note them but continue with what you can.

Constraints:
- Hook: maximum 2 lines.
- Description: 80–140 words.
- CTA: single imperative sentence, 50 characters max.
- Highlights: 3–6 bullets.
- SEO title: 60 characters max.
- SEO body: 400 characters max, no line breaks.

Structure rigid. Narrative persuasive. Tone adult but platform-safe.`;

/**
 * Generate AI marketing copy for a product and auto-save to the product table.
 */
async function generateAndSaveCopy(admin: any, productId: string): Promise<boolean> {
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openaiKey) { console.warn("OPENAI_API_KEY not configured — skipping copy generation"); return false; }

  // Fetch the product with theme join to build facts
  const { data: product, error: pErr } = await admin
    .from("product")
    .select("mpn, name, piece_count, release_year, retired_flag, subtheme_name, product_type, brand, age_range, weight_kg, length_cm, width_cm, height_cm, theme:theme_id(name)")
    .eq("id", productId)
    .single();

  if (pErr || !product) { console.error("Failed to fetch product for copy generation:", pErr?.message); return false; }

  const themeName = product.theme?.name ?? null;
  const facts: string[] = [];
  facts.push(`Product name: ${product.name ?? product.mpn}`);
  facts.push(`Set number / MPN: ${product.mpn}`);
  if (themeName) facts.push(`Theme: ${themeName}`);
  if (product.subtheme_name) facts.push(`Subtheme: ${product.subtheme_name}`);
  if (product.piece_count) facts.push(`Piece count: ${product.piece_count}`);
  if (product.release_year) facts.push(`Year released: ${product.release_year}`);
  if (product.retired_flag) facts.push(`Retirement status: retired`);
  if (product.age_range) facts.push(`Age mark: ${product.age_range}`);
  if (product.weight_kg) facts.push(`Weight: ${product.weight_kg} kg`);
  if (product.length_cm && product.width_cm && product.height_cm) {
    facts.push(`Dimensions: ${product.length_cm} × ${product.width_cm} × ${product.height_cm} cm`);
  }

  const userPrompt = `Generate product copy and SEO content for the following product. Use ONLY the facts provided below.\n\n${facts.join("\n")}`;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [
        { role: "system", content: COPY_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      tools: [{
        type: "function",
        function: {
          name: "generate_copy",
          description: "Return the generated product copy and SEO content.",
          parameters: {
            type: "object",
            properties: {
              seo_title: { type: "string", description: "SEO title, max 60 characters" },
              seo_body: { type: "string", description: "SEO meta description, max 400 characters, no line breaks" },
              hook: { type: "string", description: "Product hook, 1-2 lines max" },
              description: { type: "string", description: "Narrative description, 80-140 words, single paragraph" },
              cta: { type: "string", description: "Call to action, single imperative sentence, 50 characters max" },
              highlights: { type: "array", items: { type: "string" }, description: "3-6 highlight bullet points" },
            },
            required: ["seo_title", "seo_body", "hook", "description", "cta", "highlights"],
            additionalProperties: false,
          },
        },
      }],
      tool_choice: { type: "function", function: { name: "generate_copy" } },
    }),
  });

  if (!response.ok) {
    console.error(`OpenAI copy generation failed [${response.status}]:`, await response.text());
    return false;
  }

  const data = await response.json();
  const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
  let copy: any;
  if (toolCall?.function?.arguments) {
    copy = typeof toolCall.function.arguments === "string"
      ? JSON.parse(toolCall.function.arguments)
      : toolCall.function.arguments;
  } else {
    const content = data.choices?.[0]?.message?.content ?? "";
    copy = JSON.parse(content);
  }

  // Save to product table
  const highlightsBullets = Array.isArray(copy.highlights)
    ? copy.highlights.map((h: string) => `• ${h}`).join("\n")
    : copy.highlights ?? "";

  const { error: saveErr } = await admin.from("product").update({
    product_hook: copy.hook ?? null,
    description: copy.description ?? null,
    call_to_action: copy.cta ?? null,
    highlights: highlightsBullets || null,
    seo_title: copy.seo_title ?? null,
    seo_description: copy.seo_body ?? null,
  }).eq("id", productId);

  if (saveErr) { console.error("Failed to save AI copy:", saveErr.message); return false; }
  console.log(`AI copy generated and saved for product ${productId}`);
  return true;
}

async function resolveVatRateId(admin: any, txnTaxDetail: any): Promise<string | null> {
  const taxLines = txnTaxDetail?.TaxLine ?? [];
  if (taxLines.length === 0) return null;
  const taxRateRef = taxLines[0]?.TaxLineDetail?.TaxRateRef?.value;
  if (!taxRateRef) return null;
  const { data: vr } = await admin.from("vat_rate").select("id").eq("qbo_tax_rate_id", String(taxRateRef)).maybeSingle();
  return vr?.id ?? null;
}

async function resolveSkuFromQboItem(admin: any, baseUrl: string, accessToken: string, itemRefValue: string, itemRefName: string | null): Promise<{ skuId: string | null; skuCode: string | null }> {
  const itemData = await fetchQboEntity(baseUrl, accessToken, `item/${itemRefValue}`);
  const qboItem = itemData?.Item ?? null;
  const skuField = qboItem?.Sku;
  // Use the raw QBO SKU verbatim as sku_code
  let skuCode: string | null = null;
  if (skuField && String(skuField).trim()) {
    skuCode = String(skuField).trim();
  } else if (itemRefName) {
    skuCode = String(itemRefName).trim();
  }
  if (!skuCode) return { skuId: null, skuCode: null };
  const { data: sku } = await admin.from("sku").select("id").eq("sku_code", skuCode).maybeSingle();
  return { skuId: sku?.id ?? null, skuCode };
}

// ────────────────────────────────────────────────────────────
// Signature verification
// ────────────────────────────────────────────────────────────

async function verifySignature(body: string, signature: string, verifierToken: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(verifierToken), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  const computed = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return computed === signature;
}

// ────────────────────────────────────────────────────────────
// Entity handlers
// ────────────────────────────────────────────────────────────

async function handlePurchase(admin: any, baseUrl: string, accessToken: string, entityId: string, operation: string): Promise<string> {
  if (operation === "Delete") {
    const { data: receipt } = await admin.from("inbound_receipt").select("id").eq("qbo_purchase_id", entityId).maybeSingle();
    if (!receipt) return "no matching receipt found";
    // Delete stock units linked to this receipt's lines
    const { data: lines } = await admin.from("inbound_receipt_line").select("id").eq("inbound_receipt_id", receipt.id);
    const lineIds = (lines ?? []).map((l: any) => l.id);
    if (lineIds.length > 0) {
      await admin.from("stock_unit").delete().in("inbound_receipt_line_id", lineIds);
    }
    await admin.from("inbound_receipt_line").delete().eq("inbound_receipt_id", receipt.id);
    await admin.from("inbound_receipt").delete().eq("id", receipt.id);
    return `deleted receipt + ${lineIds.length} lines + stock units`;
  }

  // Create / Update — fetch single purchase from QBO
  const data = await fetchQboEntity(baseUrl, accessToken, `purchase/${entityId}`);
  const purchase = data?.Purchase;
  if (!purchase) return "could not fetch purchase from QBO";

  const hasItemLines = (purchase.Line ?? []).some((l: any) => l.DetailType === "ItemBasedExpenseLineDetail");
  if (!hasItemLines) return "skipped — no item lines";

  const vendorName = purchase.EntityRef?.name ?? null;
  const txnDate = purchase.TxnDate ?? null;
  const totalAmount = purchase.TotalAmt ?? 0;
  const currency = purchase.CurrencyRef?.value ?? "GBP";
  const globalTaxCalc = purchase.GlobalTaxCalculation ?? null;
  const taxTotal = purchase.TxnTaxDetail?.TotalTax ?? 0;

  const { data: receipt, error: receiptErr } = await admin
    .from("inbound_receipt")
    .upsert({
      qbo_purchase_id: entityId,
      vendor_name: vendorName,
      txn_date: txnDate,
      total_amount: totalAmount,
      currency,
      raw_payload: purchase,
      tax_total: taxTotal,
      global_tax_calculation: globalTaxCalc,
    }, { onConflict: "qbo_purchase_id" })
    .select("id, status")
    .single();

  if (receiptErr) return `upsert error: ${receiptErr.message}`;

  // If already processed, skip (manual re-process needed)
  if (receipt.status === "processed") return "already processed — skipped";

  // Delete old lines and re-create
  await admin.from("inbound_receipt_line").delete().eq("inbound_receipt_id", receipt.id);

  const lines = (purchase.Line ?? []).filter((l: any) =>
    l.DetailType === "ItemBasedExpenseLineDetail" || l.DetailType === "AccountBasedExpenseLineDetail"
  );

  const lineRows: any[] = [];
  for (const line of lines) {
    const detail = line.ItemBasedExpenseLineDetail ?? line.AccountBasedExpenseLineDetail ?? {};
    const isStockLine = line.DetailType === "ItemBasedExpenseLineDetail";
    let mpn: string | null = null;
    let conditionGrade: string | null = null;

    let rawSkuCode: string | null = null;
    let parentItemId: string | null = null;
    let brand: string | null = null;
    let itemType: string | null = null;
    if (isStockLine && detail.ItemRef?.value) {
      const itemData = await fetchQboEntity(baseUrl, accessToken, `item/${detail.ItemRef.value}`);
      const qboItem = itemData?.Item ?? null;
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
      // Resolve parent category from QBO item
      if (qboItem) {
        const parentInfo = await resolveParentCategory(baseUrl, accessToken, qboItem);
        parentItemId = parentInfo.parentItemId;
        brand = parentInfo.brand;
        itemType = parentInfo.itemType;
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
      _parentItemId: parentItemId,
      _brand: brand,
      _itemType: itemType,
    });
  }

  if (lineRows.length === 0) return "no lines to process";

  const { data: insertedLines, error: insertErr } = await admin
    .from("inbound_receipt_line").insert(lineRows).select("id, mpn, condition_grade, is_stock_line, qbo_tax_code_ref");
  if (insertErr) return `line insert error: ${insertErr.message}`;

  // Resolve tax codes
  for (const il of (insertedLines ?? [])) {
    if (il.qbo_tax_code_ref) {
      const { data: tc } = await admin.from("tax_code").select("id").eq("qbo_tax_code_id", il.qbo_tax_code_ref).maybeSingle();
      if (tc) await admin.from("inbound_receipt_line").update({ tax_code_id: tc.id }).eq("id", il.id);
    }
  }

  // Auto-process: create SKUs + stock units
  const stockLines = lineRows.filter(l => l.is_stock_line && l.mpn && l.condition_grade);
  const overheadLines = lineRows.filter(l => !l.is_stock_line);

  if (stockLines.length === 0) return "upserted receipt — no stock lines to auto-process";
  const unmapped = lineRows.filter(l => l.is_stock_line && (!l.mpn || !l.condition_grade));
  if (unmapped.length > 0) return `upserted receipt — ${unmapped.length} unmapped stock lines, left pending`;

  const totalOverhead = overheadLines.reduce((s, l) => s + Number(l.line_total), 0);
  const totalStockCost = stockLines.reduce((s, l) => s + Number(l.line_total), 0);
  const validGrades = ["1", "2", "3", "4", "5"];
  let unitsCreated = 0;

  for (let i = 0; i < stockLines.length; i++) {
    const line = stockLines[i];
    const cg = validGrades.includes(line.condition_grade!) ? line.condition_grade! : "1";
    // Use raw sku_code from line if available, otherwise reconstruct from mpn + grade
    const skuCode = line.sku_code || (cg !== "1" ? `${line.mpn}.${cg}` : line.mpn!);
    // Look up product, auto-create from lego_catalog if missing
    const lineBrand = line._brand as string | null;
    const lineItemType = line._itemType as string | null;
    const lineParentItemId = line._parentItemId as string | null;
    let productId: string | null = null;
    const { data: product } = await admin.from("product").select("id").eq("mpn", line.mpn).maybeSingle();
    if (product) {
      productId = product.id;
      // Update brand/product_type from parent category if available
      const updates: Record<string, any> = {};
      if (lineBrand) updates.brand = lineBrand;
      if (lineItemType) updates.product_type = lineItemType;
      if (Object.keys(updates).length > 0) {
        await admin.from("product").update(updates).eq("id", product.id);
      }
    } else if (line.mpn) {
      const { data: catalog } = await admin
        .from("lego_catalog")
        .select("id, mpn, name, theme_id, piece_count, release_year, retired_flag, img_url, subtheme_name, product_type")
        .eq("mpn", line.mpn).eq("status", "active").maybeSingle();
      if (catalog) {
        const { data: newProduct, error: prodErr } = await admin.from("product").insert({
          mpn: line.mpn, name: catalog.name, theme_id: catalog.theme_id,
          piece_count: catalog.piece_count, release_year: catalog.release_year,
          retired_flag: catalog.retired_flag ?? false, img_url: catalog.img_url,
          subtheme_name: catalog.subtheme_name,
          product_type: lineItemType ?? catalog.product_type ?? "set",
          lego_catalog_id: catalog.id, status: "active",
          brand: lineBrand,
        }).select("id").single();
        if (!prodErr && newProduct) { productId = newProduct.id; }
        else if (prodErr) { console.error(`Auto-create product for ${line.mpn}:`, prodErr.message); }
      } else if (lineBrand || lineItemType) {
        const { data: newProduct, error: prodErr } = await admin.from("product").insert({
          mpn: line.mpn, name: cleanQboName(line.description ?? line.mpn),
          product_type: lineItemType ?? "set", brand: lineBrand, status: "active",
        }).select("id").single();
        if (!prodErr && newProduct) { productId = newProduct.id; }
        else if (prodErr) { console.error(`Create product for ${line.mpn}:`, prodErr.message); }
      }
    }

    const lineTotal = Number(line.line_total);
    const lineOverhead = totalStockCost > 0 ? totalOverhead * (lineTotal / totalStockCost) : 0;
    const overheadPerUnit = line.quantity > 0 ? lineOverhead / line.quantity : 0;
    const landedCost = Math.round((Number(line.unit_cost) + overheadPerUnit) * 100) / 100;

    let { data: sku } = await admin.from("sku").select("id").eq("sku_code", skuCode).maybeSingle();
    if (!sku) {
      const { data: newSku, error: skuErr } = await admin.from("sku").insert({
        product_id: productId,
        condition_grade: cg,
        sku_code: skuCode,
        name: cleanQboName(line.description ?? line.mpn),
        price: landedCost,
        active_flag: true,
        saleable_flag: !!productId,
        qbo_parent_item_id: lineParentItemId,
      }).select("id").single();
      if (skuErr) { console.error("SKU create error:", skuErr); continue; }
      sku = newSku;
    }

    const receiptLineId = insertedLines?.[lineRows.indexOf(line)]?.id ?? null;

    // Shortfall guard: only insert units not already created for this receipt line
    let shortfall = line.quantity;
    if (receiptLineId) {
      const { count } = await admin.from("stock_unit").select("id", { count: "exact", head: true }).eq("inbound_receipt_line_id", receiptLineId);
      shortfall = line.quantity - (count ?? 0);
    }
    if (shortfall <= 0) { continue; }

    const stockUnits = [];
    for (let j = 0; j < shortfall; j++) {
      stockUnits.push({
        sku_id: sku!.id,
        mpn: line.mpn,
        condition_grade: cg,
        status: "available",
        landed_cost: landedCost,
        supplier_id: vendorName,
        inbound_receipt_line_id: receiptLineId,
      });
    }
    const { error: suErr } = await admin.from("stock_unit").insert(stockUnits);
    if (suErr) { console.error("Stock unit insert error:", suErr); continue; }
    unitsCreated += stockUnits.length;
  }

  await admin.from("inbound_receipt").update({ status: "processed", processed_at: new Date().toISOString() }).eq("id", receipt.id);
  return `processed — ${unitsCreated} stock units created`;
}

async function handleSalesReceipt(admin: any, baseUrl: string, accessToken: string, entityId: string, operation: string): Promise<string> {
  const originChannel = "qbo";

  if (operation === "Delete") {
    const { data: order } = await admin.from("sales_order").select("id").eq("origin_channel", originChannel).eq("origin_reference", entityId).maybeSingle();
    if (!order) return "no matching order found";
    // Reopen stock units linked to this order's lines
    const { data: orderLines } = await admin.from("sales_order_line").select("stock_unit_id").eq("sales_order_id", order.id);
    for (const ol of (orderLines ?? [])) {
      if (ol.stock_unit_id) {
        await admin.from("stock_unit").update({ status: "available" }).eq("id", ol.stock_unit_id);
      }
    }
    await admin.from("sales_order_line").delete().eq("sales_order_id", order.id);
    await admin.from("sales_order").delete().eq("id", order.id);
    return `deleted order + reopened stock`;
  }

  // Create / Update
  const data = await fetchQboEntity(baseUrl, accessToken, `salesreceipt/${entityId}`);
  const receipt = data?.SalesReceipt;
  if (!receipt) return "could not fetch SalesReceipt from QBO";

  // Check idempotency
  const { data: existing } = await admin.from("sales_order").select("id").eq("origin_channel", originChannel).eq("origin_reference", String(receipt.Id)).maybeSingle();
  if (existing) {
    // Update: delete old and re-create
    const { data: oldLines } = await admin.from("sales_order_line").select("stock_unit_id").eq("sales_order_id", existing.id);
    for (const ol of (oldLines ?? [])) {
      if (ol.stock_unit_id) await admin.from("stock_unit").update({ status: "available" }).eq("id", ol.stock_unit_id);
    }
    await admin.from("sales_order_line").delete().eq("sales_order_id", existing.id);
    await admin.from("sales_order").delete().eq("id", existing.id);
  }

  const customerName = receipt.CustomerRef?.name ?? "QBO Customer";
  const customerRefValue = receipt.CustomerRef?.value ? String(receipt.CustomerRef.value) : null;
  const txnDate = receipt.TxnDate ?? null;
  const totalAmount = receipt.TotalAmt ?? 0;
  const currency = receipt.CurrencyRef?.value ?? "GBP";
  const globalTaxCalc = receipt.GlobalTaxCalculation ?? null;
  const taxTotal = receipt.TxnTaxDetail?.TotalTax ?? 0;

  let merchandiseSubtotal: number, grossTotal: number;
  if (globalTaxCalc === "TaxInclusive") {
    merchandiseSubtotal = totalAmount - taxTotal;
    grossTotal = totalAmount;
  } else {
    merchandiseSubtotal = totalAmount;
    grossTotal = totalAmount + taxTotal;
  }

  const itemLines = (receipt.Line ?? []).filter((l: any) => l.DetailType === "SalesItemLineDetail" && l.SalesItemLineDetail?.ItemRef?.value);
  if (itemLines.length === 0) return "skipped — no item lines";

  let customerId: string | null = null;
  if (customerRefValue) {
    const { data: cust } = await admin.from("customer").select("id").eq("qbo_customer_id", customerRefValue).maybeSingle();
    customerId = cust?.id ?? null;
  }

  const vatRateId = await resolveVatRateId(admin, receipt.TxnTaxDetail);

  const { data: order, error: orderErr } = await admin.from("sales_order").insert({
    origin_channel: originChannel,
    origin_reference: String(receipt.Id),
    status: "complete",
    guest_name: customerName,
    guest_email: `qbo-sale-${receipt.Id}@imported.local`,
    shipping_name: customerName,
    merchandise_subtotal: merchandiseSubtotal,
    tax_total: taxTotal,
    gross_total: grossTotal,
    global_tax_calculation: globalTaxCalc,
    currency,
    customer_id: customerId,
    txn_date: txnDate,
    doc_number: receipt.DocNumber ?? null,
    notes: `Imported from QBO SalesReceipt #${receipt.DocNumber ?? receipt.Id}`,
  }).select("id").single();

  if (orderErr) return `order insert error: ${orderErr.message}`;

  let linesCreated = 0, stockMatched = 0;

  for (const line of itemLines) {
    const detail = line.SalesItemLineDetail;
    const qty = detail.Qty ?? 1;
    const unitPrice = detail.UnitPrice ?? 0;
    const taxCodeRef = detail.TaxCodeRef?.value ?? null;

    const { skuId } = await resolveSkuFromQboItem(admin, baseUrl, accessToken, detail.ItemRef.value, detail.ItemRef?.name ?? null);
    if (!skuId) { console.warn(`No SKU for QBO item ${detail.ItemRef.value}`); continue; }

    let lineTaxCodeId: string | null = null;
    if (taxCodeRef) {
      const { data: tc } = await admin.from("tax_code").select("id").eq("qbo_tax_code_id", String(taxCodeRef)).maybeSingle();
      lineTaxCodeId = tc?.id ?? null;
    }

    for (let i = 0; i < qty; i++) {
      const { data: stockUnit } = await admin.from("stock_unit").select("id").eq("sku_id", skuId).eq("status", "available").order("created_at", { ascending: true }).limit(1).maybeSingle();

      await admin.from("sales_order_line").insert({
        sales_order_id: order.id,
        sku_id: skuId,
        quantity: 1,
        unit_price: unitPrice,
        line_total: unitPrice,
        stock_unit_id: stockUnit?.id ?? null,
        qbo_tax_code_ref: taxCodeRef,
        vat_rate_id: vatRateId,
        tax_code_id: lineTaxCodeId,
      });
      linesCreated++;

      if (stockUnit) {
        await admin.from("stock_unit").update({ status: "closed" }).eq("id", stockUnit.id);
        stockMatched++;
      }
    }
  }

  return `created order — ${linesCreated} lines, ${stockMatched} stock matched`;
}

async function handleRefundReceipt(admin: any, baseUrl: string, accessToken: string, entityId: string, operation: string): Promise<string> {
  const originChannel = "qbo_refund";

  if (operation === "Delete") {
    const { data: order } = await admin.from("sales_order").select("id").eq("origin_channel", originChannel).eq("origin_reference", entityId).maybeSingle();
    if (!order) return "no matching refund order found";
    await admin.from("sales_order_line").delete().eq("sales_order_id", order.id);
    await admin.from("sales_order").delete().eq("id", order.id);
    return "deleted refund order";
  }

  const data = await fetchQboEntity(baseUrl, accessToken, `refundreceipt/${entityId}`);
  const receipt = data?.RefundReceipt;
  if (!receipt) return "could not fetch RefundReceipt from QBO";

  // Idempotency: if exists, delete and re-create
  const { data: existing } = await admin.from("sales_order").select("id").eq("origin_channel", originChannel).eq("origin_reference", String(receipt.Id)).maybeSingle();
  if (existing) {
    await admin.from("sales_order_line").delete().eq("sales_order_id", existing.id);
    await admin.from("sales_order").delete().eq("id", existing.id);
  }

  const customerName = receipt.CustomerRef?.name ?? "QBO Customer";
  const customerRefValue = receipt.CustomerRef?.value ? String(receipt.CustomerRef.value) : null;
  const txnDate = receipt.TxnDate ?? null;
  const totalAmount = receipt.TotalAmt ?? 0;
  const currency = receipt.CurrencyRef?.value ?? "GBP";
  const globalTaxCalc = receipt.GlobalTaxCalculation ?? null;
  const taxTotal = receipt.TxnTaxDetail?.TotalTax ?? 0;

  let merchandiseSubtotal: number, grossTotal: number;
  if (globalTaxCalc === "TaxInclusive") {
    merchandiseSubtotal = -(totalAmount - taxTotal);
    grossTotal = -totalAmount;
  } else {
    merchandiseSubtotal = -totalAmount;
    grossTotal = -(totalAmount + taxTotal);
  }

  const itemLines = (receipt.Line ?? []).filter((l: any) => l.DetailType === "SalesItemLineDetail" && l.SalesItemLineDetail?.ItemRef?.value);
  if (itemLines.length === 0) return "skipped — no item lines";

  let customerId: string | null = null;
  if (customerRefValue) {
    const { data: cust } = await admin.from("customer").select("id").eq("qbo_customer_id", customerRefValue).maybeSingle();
    customerId = cust?.id ?? null;
  }

  const vatRateId = await resolveVatRateId(admin, receipt.TxnTaxDetail);

  const { data: order, error: orderErr } = await admin.from("sales_order").insert({
    origin_channel: originChannel,
    origin_reference: String(receipt.Id),
    status: "refunded",
    guest_name: customerName,
    guest_email: `qbo-refund-${receipt.Id}@imported.local`,
    shipping_name: customerName,
    merchandise_subtotal: merchandiseSubtotal,
    tax_total: -taxTotal,
    gross_total: grossTotal,
    global_tax_calculation: globalTaxCalc,
    currency,
    customer_id: customerId,
    txn_date: txnDate,
    doc_number: receipt.DocNumber ?? null,
    notes: `Imported from QBO RefundReceipt #${receipt.DocNumber ?? receipt.Id}`,
  }).select("id").single();

  if (orderErr) return `refund order insert error: ${orderErr.message}`;

  let linesCreated = 0;
  for (const line of itemLines) {
    const detail = line.SalesItemLineDetail;
    const qty = detail.Qty ?? 1;
    const unitPrice = detail.UnitPrice ?? 0;
    const taxCodeRef = detail.TaxCodeRef?.value ?? null;

    const { skuId } = await resolveSkuFromQboItem(admin, baseUrl, accessToken, detail.ItemRef.value, detail.ItemRef?.name ?? null);
    if (!skuId) continue;

    let lineTaxCodeId: string | null = null;
    if (taxCodeRef) {
      const { data: tc } = await admin.from("tax_code").select("id").eq("qbo_tax_code_id", String(taxCodeRef)).maybeSingle();
      lineTaxCodeId = tc?.id ?? null;
    }

    await admin.from("sales_order_line").insert({
      sales_order_id: order.id,
      sku_id: skuId,
      quantity: qty,
      unit_price: -unitPrice,
      line_total: -(line.Amount ?? 0),
      qbo_tax_code_ref: taxCodeRef,
      vat_rate_id: vatRateId,
      tax_code_id: lineTaxCodeId,
    });
    linesCreated++;
  }

  return `created refund order — ${linesCreated} lines`;
}

async function handleCustomer(admin: any, baseUrl: string, accessToken: string, entityId: string, operation: string): Promise<string> {
  if (operation === "Delete") {
    const { error } = await admin.from("customer").update({ active: false }).eq("qbo_customer_id", entityId);
    return error ? `deactivate error: ${error.message}` : "marked inactive";
  }

  const data = await fetchQboEntity(baseUrl, accessToken, `customer/${entityId}`);
  const c = data?.Customer;
  if (!c) return "could not fetch customer from QBO";

  const billAddr = c.BillAddr ?? {};
  const { error } = await admin.from("customer").upsert({
    qbo_customer_id: String(c.Id),
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
  }, { onConflict: "qbo_customer_id" });

  return error ? `upsert error: ${error.message}` : "upserted";
}

// ────────────────────────────────────────────────────────────
// QtyOnHand reconciliation — sync QBO inventory qty to app stock_units
// ────────────────────────────────────────────────────────────

/**
 * Compare QBO Item.QtyOnHand with the app's available stock_unit count for
 * the corresponding SKU. If QBO qty is lower (write-off / shrinkage made in
 * QBO), mark excess app units as written_off (FIFO — oldest first).
 * If QBO qty is higher (e.g. stock received outside the app), log a warning
 * but don't auto-create units (that should go through the receipt flow).
 *
 * Returns a human-readable summary, or null if no reconciliation was needed.
 */
async function reconcileQtyOnHand(
  admin: any,
  qboItemId: string,
  skuCode: string,
  qboItem: any,
  mpn: string,
): Promise<string | null> {
  // Only Inventory-type items have QtyOnHand
  if (qboItem.Type !== "Inventory") return null;
  const qboQty = Math.floor(Number(qboItem.QtyOnHand ?? 0));

  // Find the SKU in the app
  const { data: sku } = await admin
    .from("sku")
    .select("id")
    .eq("qbo_item_id", qboItemId)
    .maybeSingle();
  if (!sku) return null;

  // Count available stock units for this SKU
  const { count: appAvailable } = await admin
    .from("stock_unit")
    .select("id", { count: "exact", head: true })
    .eq("sku_id", sku.id)
    .eq("status", "available");

  const available = appAvailable ?? 0;
  if (available === qboQty) return null; // already in sync

  const correlationId = crypto.randomUUID();

  if (qboQty < available) {
    // QBO has fewer — write off excess units (oldest first)
    const excess = available - qboQty;
    const { data: unitsToWriteOff } = await admin
      .from("stock_unit")
      .select("id, status, carrying_value, landed_cost")
      .eq("sku_id", sku.id)
      .eq("status", "available")
      .order("created_at", { ascending: true })
      .limit(excess);

    let writtenOff = 0;
    for (const unit of (unitsToWriteOff ?? [])) {
      const { error: updateErr } = await admin
        .from("stock_unit")
        .update({
          status: "written_off",
          carrying_value: 0,
          accumulated_impairment: unit.landed_cost ?? 0,
          updated_at: new Date().toISOString(),
        })
        .eq("id", unit.id);

      if (updateErr) {
        console.error(`Failed to write off stock unit ${unit.id}:`, updateErr.message);
        continue;
      }

      // Audit event for each unit
      await admin.from("audit_event").insert({
        entity_type: "stock_unit",
        entity_id: unit.id,
        trigger_type: "qbo_inventory_adjustment",
        actor_type: "system",
        source_system: "qbo",
        correlation_id: correlationId,
        before_json: { status: unit.status, carrying_value: unit.carrying_value },
        after_json: { status: "written_off", carrying_value: 0 },
        input_json: {
          qbo_item_id: qboItemId,
          sku_code: skuCode,
          qbo_qty_on_hand: qboQty,
          app_available_before: available,
        },
      });

      writtenOff++;
    }

    return `wrote off ${writtenOff}/${excess} units (QBO=${qboQty}, app was ${available})`;
  }

  // QBO has more than app — log warning, don't auto-create
  // (new stock should come through the purchase/receipt flow)
  console.warn(
    `[reconcileQtyOnHand] SKU ${skuCode}: QBO QtyOnHand (${qboQty}) > app available (${available}). ` +
    `Difference of ${qboQty - available} units — check for missing receipts.`
  );

  // Record the discrepancy as an audit event for visibility
  await admin.from("audit_event").insert({
    entity_type: "sku",
    entity_id: sku.id,
    trigger_type: "qbo_qty_discrepancy",
    actor_type: "system",
    source_system: "qbo",
    correlation_id: correlationId,
    input_json: {
      qbo_item_id: qboItemId,
      sku_code: skuCode,
      qbo_qty_on_hand: qboQty,
      app_available: available,
      discrepancy: qboQty - available,
      direction: "qbo_higher",
    },
  });

  return `discrepancy: QBO=${qboQty} vs app=${available} (logged, no auto-create)`;
}

async function handleItem(admin: any, baseUrl: string, accessToken: string, entityId: string, operation: string): Promise<string> {
  // QBO Items cannot be deleted, so we only handle Create/Update
  if (operation === "Delete") {
    return `item ${entityId} delete — ignored (items cannot be deleted in QBO)`;
  }

  // Fetch the single Item from QBO
  const res = await fetch(`${baseUrl}/item/${entityId}?minorversion=65`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`QBO Item fetch failed [${res.status}]: ${errText}`);
  }
  const data = await res.json();
  const item = data?.Item;
  if (!item) return `item ${entityId} — not found in QBO response`;

  const qboItemId = String(item.Id);

  // Parse SKU field (MPN.Grade convention), fall back to Name
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

  if (!mpn) return `item ${entityId} — could not extract MPN`;

  // Use the raw QBO SKU verbatim as sku_code
  const rawSku = (skuField && String(skuField).trim()) ? String(skuField).trim() : String(item.Name).trim();
  const skuCode = rawSku;

  // Resolve parent item category (brand / item type)
  const { parentItemId, brand, itemType } = await resolveParentCategory(baseUrl, accessToken, item);

  // Look up product by MPN, auto-create from lego_catalog if missing
  let productId: string | null = null;
  const { data: productRecord } = await admin
    .from("product")
    .select("id")
    .eq("mpn", mpn)
    .maybeSingle();

  if (productRecord) {
    productId = productRecord.id;
    // Update brand and product_type from parent category if available
    const updates: Record<string, any> = {};
    if (brand) updates.brand = brand;
    if (itemType) updates.product_type = itemType;
    if (Object.keys(updates).length > 0) {
      await admin.from("product").update(updates).eq("id", productRecord.id);
    }
  } else {
    // Auto-create product from lego_catalog (same logic as qbo-sync-items)
    const { data: catalog } = await admin
      .from("lego_catalog")
      .select("id, mpn, name, theme_id, piece_count, release_year, retired_flag, img_url, subtheme_name, product_type")
      .eq("mpn", mpn)
      .eq("status", "active")
      .maybeSingle();
    if (catalog) {
      const { data: newProduct, error: prodErr } = await admin.from("product").insert({
        mpn,
        name: catalog.name,
        theme_id: catalog.theme_id,
        piece_count: catalog.piece_count,
        release_year: catalog.release_year,
        retired_flag: catalog.retired_flag ?? false,
        img_url: catalog.img_url,
        subtheme_name: catalog.subtheme_name,
        product_type: itemType ?? catalog.product_type ?? "set",
        lego_catalog_id: catalog.id,
        status: "active",
        brand: brand,
      }).select("id").single();
      if (!prodErr && newProduct) {
        productId = newProduct.id;
        console.log(`Auto-created product for MPN ${mpn} (id: ${newProduct.id})`);
      } else if (prodErr) {
        console.error(`Auto-create product for ${mpn}:`, prodErr.message);
      }
    } else if (brand || itemType) {
      // No catalog match — create a minimal product with parent category info
      const { data: newProduct, error: prodErr } = await admin.from("product").insert({
        mpn,
        name: cleanQboName(item.Name ?? mpn),
        product_type: itemType ?? "set",
        brand: brand,
        status: "active",
      }).select("id").single();
      if (!prodErr && newProduct) {
        productId = newProduct.id;
        console.log(`Created product for MPN ${mpn} with brand=${brand} type=${itemType}`);
      } else if (prodErr) {
        console.error(`Create product for ${mpn}:`, prodErr.message);
      }
    }
  }

  // Pre-check: if a SKU with this sku_code exists but has a different/null qbo_item_id,
  // update it to link to this QBO item before upserting (avoids sku_code unique violation)
  const { data: existingByCode } = await admin
    .from("sku")
    .select("id, qbo_item_id")
    .eq("sku_code", skuCode)
    .maybeSingle();

  if (existingByCode && existingByCode.qbo_item_id !== qboItemId) {
    // Link the existing SKU to this QBO item ID
    await admin.from("sku").update({
      qbo_item_id: qboItemId,
      qbo_parent_item_id: parentItemId,
      name: cleanQboName(item.Name ?? mpn),
      product_id: productId ?? existingByCode.product_id,
      active_flag: item.Active !== false,
      price: item.UnitPrice != null ? Number(item.UnitPrice) : existingByCode.price,
    }).eq("id", existingByCode.id);
    return `item ${entityId} linked to existing SKU ${skuCode}`;
  }

  // Upsert SKU (now safe — unique index on qbo_item_id exists)
  const { error } = await admin.from("sku").upsert({
    qbo_item_id: qboItemId,
    qbo_parent_item_id: parentItemId,
    sku_code: skuCode,
    name: cleanQboName(item.Name ?? mpn),
    product_id: productId,
    condition_grade: conditionGrade,
    active_flag: item.Active !== false,
    saleable_flag: !!productId,
    price: item.UnitPrice != null ? Number(item.UnitPrice) : null,
  }, { onConflict: "qbo_item_id" });

  if (error) return `item ${entityId} upsert error: ${error.message}`;

  // ── QtyOnHand reconciliation ──
  // When QBO's QtyOnHand changes (via InventoryAdjustment in QBO), reconcile
  // the app's stock_unit count to match. This is the primary inbound path for
  // write-offs, shrinkage, and other adjustments made in QBO.
  const reconcileResult = await reconcileQtyOnHand(admin, qboItemId, skuCode, item, mpn);
  if (reconcileResult) {
    console.log(`[handleItem] QtyOnHand reconciliation for ${skuCode}: ${reconcileResult}`);
  }

  // Post-creation enrichment: BrickEconomy lookup + AI copy generation
  // Only for new LEGO items (Set or Minifig) with a product record
  if (operation === "Create" && brand === "LEGO" && itemType && productId) {
    const isEligible = itemType.toLowerCase() === "set" || itemType.toLowerCase().includes("minifig");
    if (isEligible) {
      try {
        const enriched = await enrichFromBrickEconomy(admin, mpn, itemType, productId);
        console.log(`BrickEconomy enrichment for ${mpn}: ${enriched ? "success" : "skipped/failed"}`);
      } catch (err: any) {
        console.error(`BrickEconomy enrichment error for ${mpn}:`, err.message);
      }
      try {
        const copied = await generateAndSaveCopy(admin, productId);
        console.log(`AI copy generation for ${mpn}: ${copied ? "success" : "skipped/failed"}`);
      } catch (err: any) {
        console.error(`AI copy generation error for ${mpn}:`, err.message);
      }
    }
  }

  return `item ${entityId} upserted as SKU ${skuCode}${reconcileResult ? ` | stock: ${reconcileResult}` : ""}`;
}

// ────────────────────────────────────────────────────────────
// Entity dispatcher
// ────────────────────────────────────────────────────────────

type EntityHandler = (admin: any, baseUrl: string, accessToken: string, entityId: string, operation: string) => Promise<string>;

const ENTITY_HANDLERS: Record<string, EntityHandler> = {
  Purchase: handlePurchase,
  SalesReceipt: handleSalesReceipt,
  RefundReceipt: handleRefundReceipt,
  Customer: handleCustomer,
  Item: handleItem,
};

// ────────────────────────────────────────────────────────────
// Main handler
// ────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // QBO sends GET for validation during webhook registration
  if (req.method === "GET") {
    return new Response("OK", { status: 200, headers: { ...corsHeaders, "Content-Type": "text/plain" } });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  const verifierToken = Deno.env.get("QBO_WEBHOOK_VERIFIER");
  if (!verifierToken) {
    console.error("QBO_WEBHOOK_VERIFIER secret not configured");
    return new Response("Server misconfigured", { status: 500, headers: corsHeaders });
  }

  const rawBody = await req.text();

  // Signature verification
  const intuitSignature = req.headers.get("intuit-signature");
  if (!intuitSignature) return new Response("Missing signature", { status: 401, headers: corsHeaders });

  const valid = await verifySignature(rawBody, intuitSignature, verifierToken);
  if (!valid) return new Response("Invalid signature", { status: 401, headers: corsHeaders });

  // Parse payload
  let payload: any;
  try { payload = JSON.parse(rawBody); } catch { return new Response("Invalid JSON", { status: 400, headers: corsHeaders }); }

  console.log("QBO webhook received:", JSON.stringify(payload).slice(0, 500));

  const notifications = payload.eventNotifications ?? [];

  // Respond immediately (QBO requires fast 200), process async
  const processAsync = async () => {
    if (!notifications.length) { console.log("No notifications"); return; }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const clientId = Deno.env.get("QBO_CLIENT_ID")!;
    const clientSecret = Deno.env.get("QBO_CLIENT_SECRET")!;
    const realmId = Deno.env.get("QBO_REALM_ID")!;
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const accessToken = await ensureValidToken(admin, realmId, clientId, clientSecret);
    const baseUrl = `https://quickbooks.api.intuit.com/v3/company/${realmId}`;

    const results: Array<{ entity: string; id: string; operation: string; result: string }> = [];

    for (const notification of notifications) {
      const entities = notification.dataChangeEvent?.entities ?? [];
      for (const entity of entities) {
        const handler = ENTITY_HANDLERS[entity.name];
        const entityId = String(entity.id);
        const operation = entity.operation ?? "Create";

        if (!handler) {
          console.log(`Ignoring entity type: ${entity.name}`);
          results.push({ entity: entity.name, id: entityId, operation, result: "ignored — unknown type" });
          continue;
        }

        console.log(`Processing: ${entity.name} ${operation} ${entityId}`);
        try {
          const result = await handler(admin, baseUrl, accessToken, entityId, operation);
          console.log(`  → ${result}`);
          results.push({ entity: entity.name, id: entityId, operation, result });
        } catch (err: any) {
          console.error(`  → FAILED: ${err.message}`);
          results.push({ entity: entity.name, id: entityId, operation, result: `error: ${err.message}` });
        }
      }
    }

    // Audit log
    try {
      await admin.from("audit_event").insert({
        entity_type: "qbo_webhook",
        entity_id: "00000000-0000-0000-0000-000000000000",
        trigger_type: "webhook",
        actor_type: "system",
        source_system: "qbo",
        input_json: { notifications_count: notifications.length },
        output_json: { results },
      });
    } catch (e: any) {
      console.error("Audit log failed:", e.message);
    }
  };

  processAsync().catch((err) => console.error("Async webhook processing failed:", err));

  return new Response(
    JSON.stringify({ ok: true, received: notifications.length }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
