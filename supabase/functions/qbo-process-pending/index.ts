// Redeployed: 2026-04-06
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";

/**
 * qbo-process-pending — THE single source of truth for all QBO → canonical processing.
 *
 * Reads pending landing records and processes them in dependency order:
 *   1. Vendors + Customers + Items → reference data
 *   2. Purchases → Receipts → Receipt Lines → Stock Units
 *   3. Sales Receipts → Sales Orders → Order Lines → Stock Allocation
 *   4. Refund Receipts → ignored (with legacy refund cleanup)
 *
 * Accepts optional body: { entity_type?, batch_size?, external_id? }
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-webhook-trigger, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};


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

function normalizeVendorName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const normalized = raw.trim().replace(/\s+/g, " ").toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function getVendorDisplayName(vendor: any, fallbackExternalId: string): string {
  const firstName = typeof vendor?.GivenName === "string" ? vendor.GivenName.trim() : "";
  const lastName = typeof vendor?.FamilyName === "string" ? vendor.FamilyName.trim() : "";
  const personalName = [firstName, lastName].filter(Boolean).join(" ").trim();

  const candidates = [
    vendor?.DisplayName,
    vendor?.CompanyName,
    vendor?.PrintOnCheckName,
    vendor?.FullyQualifiedName,
    personalName,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim().replace(/\s+/g, " ");
    }
  }

  return `QBO Vendor ${fallbackExternalId}`;
}

const ALLOCABLE_FEE_PATTERN = /\b(buy(?:ing)?\s+fee|purchase\s+fee|fees?|shipping|delivery|courier|postage|freight|carriage|inbound|warehouse)\b/i;

function isAllocableFeeLine(description?: string | null): boolean {
  return ALLOCABLE_FEE_PATTERN.test(description ?? "");
}

function parseParentCategory(parentName: string): { brand: string | null; itemType: string | null } {
  const trimmed = parentName.trim();
  const colonIdx = trimmed.indexOf(":");
  if (colonIdx <= 0) return { brand: null, itemType: null };
  const prefix = trimmed.substring(0, colonIdx).trim();
  const suffix = trimmed.substring(colonIdx + 1).trim();
  if (!suffix) return { brand: null, itemType: null };
  if (prefix.toUpperCase() === "LEGO") return { brand: "LEGO", itemType: suffix };
  return { brand: suffix, itemType: null };
}

async function markLanding(admin: any, table: string, id: string, status: string, errorMessage?: string) {
  const update: any = { status, processed_at: new Date().toISOString() };
  if (errorMessage) update.error_message = errorMessage;
  await admin.from(table).update(update).eq("id", id);
}

async function ensureProductExists(
  admin: any,
  mpn: string,
  fallbackName: string,
  options: { brand?: string | null; itemType?: string | null } = {},
): Promise<string> {
  const productName = cleanQboName(fallbackName || mpn);
  const brand = options.brand ?? null;
  const itemType = options.itemType ?? "set";

  const { data: ensuredProductId, error: ensureErr } = await admin.rpc("ensure_product_exists", {
    p_mpn: mpn,
    p_name: productName,
    p_brand: brand,
    p_item_type: itemType,
    p_theme_id: null,
    p_subtheme: null,
    p_piece_count: null,
    p_release_year: null,
    p_retired: null,
    p_img_url: null,
  });

  if (!ensureErr && ensuredProductId) {
    return ensuredProductId;
  }

  if (ensureErr) {
    console.warn(`ensure_product_exists failed for ${mpn}, falling back to direct lookup: ${ensureErr.message}`);
  }

  const { data: existingProduct } = await admin
    .from("product")
    .select("id")
    .eq("mpn", mpn)
    .maybeSingle();

  if (existingProduct?.id) {
    const updates: Record<string, any> = {};
    if (brand) updates.brand = brand;
    if (itemType) updates.product_type = itemType;
    if (Object.keys(updates).length > 0) {
      await admin.from("product").update(updates).eq("id", existingProduct.id);
    }
    return existingProduct.id;
  }

  const { data: catalog } = await admin
    .from("lego_catalog")
    .select("id, name, theme_id, piece_count, release_year, retired_flag, img_url, subtheme_name, product_type")
    .eq("mpn", mpn)
    .eq("status", "active")
    .maybeSingle();

  const productPayload = catalog
    ? {
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
        brand,
      }
    : {
        mpn,
        name: productName,
        product_type: itemType,
        brand,
        status: "active",
      };

  const { data: createdProduct, error: createErr } = await admin
    .from("product")
    .upsert(productPayload, { onConflict: "mpn" })
    .select("id")
    .single();

  if (createErr || !createdProduct?.id) {
    throw createErr ?? new Error(`Failed to ensure product for ${mpn}`);
  }

  return createdProduct.id;
}

async function deleteImportedRefundOrder(admin: any, refundId: string): Promise<boolean> {
  const { data: existing } = await admin
    .from("sales_order")
    .select("id")
    .eq("origin_channel", "qbo_refund")
    .eq("origin_reference", refundId)
    .maybeSingle();

  if (!existing) return false;

  await admin.from("sales_order_line").delete().eq("sales_order_id", existing.id);
  await admin.from("sales_order").delete().eq("id", existing.id);
  return true;
}

async function cleanupSalesOrder(admin: any, orderId: string): Promise<void> {
  const { data: createdLines } = await admin
    .from("sales_order_line")
    .select("stock_unit_id")
    .eq("sales_order_id", orderId);

  for (const createdLine of (createdLines ?? [])) {
    if (createdLine.stock_unit_id) {
      await admin
        .from("stock_unit")
        .update({ status: "available", v2_status: "graded", order_id: null, sold_at: null })
        .eq("id", createdLine.stock_unit_id)
        .in("status", ["closed", "sold"]);
    }
  }

  await admin.from("sales_order_line").delete().eq("sales_order_id", orderId);
  await admin.from("sales_order").delete().eq("id", orderId);
}

// ════════════════════════════════════════════════════════════
// CHANNEL DETECTION — detect origin channel from QBO SalesReceipt
// ════════════════════════════════════════════════════════════

function detectOriginChannel(receipt: any): string {
  const doc = receipt.DocNumber ?? "";
  // eBay order IDs: XX-XXXXX-XXXXX pattern
  if (/^\d{2}-\d{5}-\d{5}$/.test(doc)) return "ebay";
  // Stripe/website orders: KO- prefix
  if (doc.startsWith("KO-")) return "web";
  // Square orders → in_person
  if (doc.startsWith("SQR-")) return "in_person";
  // Etsy orders
  if (doc.startsWith("ETSY-")) return "etsy";
  // Refund patterns
  if (doc.startsWith("R-SQR-") || doc.startsWith("R-ETSY-") || doc.startsWith("R-KO-")) return "qbo_refund";

  // Fallback: check PaymentMethodRef
  const pmtName = receipt.PaymentMethodRef?.name ?? "";
  if (/stripe/i.test(pmtName)) return "web";
  if (/ebay/i.test(pmtName)) return "ebay";
  if (/square/i.test(pmtName) || /cash/i.test(pmtName)) return "in_person";
  if (/etsy/i.test(pmtName)) return "etsy";

  return "in_person";
}

// Derive the external reference for an order — prefer the channel-native ID
function deriveOriginReference(receipt: any, originChannel: string): string {
  const doc = receipt.DocNumber ?? "";
  const qboId = String(receipt.Id);

  // For eBay, the DocNumber IS the eBay order ID
  if (originChannel === "ebay" && doc) return doc;
  // For web, the DocNumber IS the KO- order number
  if (originChannel === "web" && doc.startsWith("KO-")) return doc;
  // For in_person with SQR- prefix, use that
  if (originChannel === "in_person" && doc.startsWith("SQR-")) return doc;
  // For etsy with ETSY- prefix
  if (originChannel === "etsy" && doc.startsWith("ETSY-")) return doc;
  // Fallback: use QBO receipt ID
  return qboId;
}

// ════════════════════════════════════════════════════════════
// 1. PROCESS ITEMS → SKUs
// ════════════════════════════════════════════════════════════

async function processItems(admin: any, batchSize: number): Promise<{ processed: number; errors: number }> {
  const { data: pending } = await admin
    .from("landing_raw_qbo_item")
    .select("id, external_id, raw_payload")
    .eq("status", "pending")
    .order("received_at", { ascending: true })
    .limit(batchSize);

  let processed = 0, errors = 0;

  for (const entry of (pending ?? [])) {
    try {
      const item = entry.raw_payload;
      const qboItemId = String(item.Id);

      // Parse SKU
      let mpn: string | null = null;
      let conditionGrade = "1";
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

      if (!mpn) {
        await markLanding(admin, "landing_raw_qbo_item", entry.id, "skipped", "No MPN");
        processed++;
        continue;
      }

      const rawSku = (skuField && String(skuField).trim()) ? String(skuField).trim() : String(item.Name).trim();
      const skuCode = rawSku;

      // Resolve parent category
      let parentItemId: string | null = null;
      let brand: string | null = null;
      let itemType: string | null = null;
      if (item.ParentRef?.value) {
        parentItemId = String(item.ParentRef.value);
        const { data: parentLanding } = await admin
          .from("landing_raw_qbo_item")
          .select("raw_payload")
          .eq("external_id", parentItemId)
          .maybeSingle();
        if (parentLanding?.raw_payload?.Name) {
          const parsed = parseParentCategory(parentLanding.raw_payload.Name);
          brand = parsed.brand;
          itemType = parsed.itemType;
        }
      }

      // Resolve/create product
      let productId: string | null = null;
      const { data: productRecord } = await admin.from("product").select("id").eq("mpn", mpn).maybeSingle();

      if (productRecord) {
        productId = productRecord.id;
        const updates: Record<string, any> = {};
        if (brand) updates.brand = brand;
        if (itemType) updates.product_type = itemType;
        if (Object.keys(updates).length > 0) {
          await admin.from("product").update(updates).eq("id", productId);
        }
      } else {
        const { data: catalog } = await admin
          .from("lego_catalog")
          .select("id, mpn, name, theme_id, piece_count, release_year, retired_flag, img_url, subtheme_name, product_type")
          .eq("mpn", mpn).eq("status", "active").maybeSingle();
        if (catalog) {
          const { data: np, error: pe } = await admin.from("product").insert({
            mpn, name: catalog.name, theme_id: catalog.theme_id,
            piece_count: catalog.piece_count, release_year: catalog.release_year,
            retired_flag: catalog.retired_flag ?? false, img_url: catalog.img_url,
            subtheme_name: catalog.subtheme_name,
            product_type: itemType ?? catalog.product_type ?? "set",
            lego_catalog_id: catalog.id, status: "active", brand,
          }).select("id").single();
          if (!pe && np) productId = np.id;
        } else {
          const inferredType = itemType ?? "minifigure";
          const { data: np, error: pe } = await admin.from("product").insert({
            mpn, name: cleanQboName(item.Name ?? mpn),
            product_type: inferredType, brand: brand ?? null, status: "active",
          }).select("id").single();
          if (!pe && np) productId = np.id;
        }
      }

      // Pre-check existing SKU by sku_code
      const { data: existingByCode } = await admin
        .from("sku").select("id, qbo_item_id, product_id, price")
        .eq("sku_code", skuCode).maybeSingle();

      if (existingByCode && existingByCode.qbo_item_id !== qboItemId) {
        const updatePayload: Record<string, any> = {
          qbo_item_id: qboItemId, qbo_parent_item_id: parentItemId,
          name: cleanQboName(item.Name ?? mpn),
          product_id: productId ?? existingByCode.product_id,
          active_flag: item.Active !== false,
          price: item.UnitPrice != null ? Number(item.UnitPrice) : existingByCode.price,
        };
        let { error } = await admin.from("sku").update(updatePayload).eq("id", existingByCode.id);
        if (error && /qbo_parent_item_id|PGRST204/.test(error.message ?? "")) {
          delete updatePayload.qbo_parent_item_id;
          ({ error } = await admin.from("sku").update(updatePayload).eq("id", existingByCode.id));
        }
        if (error) { errors++; await markLanding(admin, "landing_raw_qbo_item", entry.id, "error", error.message); continue; }
      } else {
        const upsertPayload: Record<string, any> = {
          qbo_item_id: qboItemId, qbo_parent_item_id: parentItemId,
          sku_code: skuCode, name: cleanQboName(item.Name ?? mpn),
          product_id: productId, condition_grade: conditionGrade,
          active_flag: item.Active !== false, saleable_flag: !!productId,
          price: item.UnitPrice != null ? Number(item.UnitPrice) : null,
        };
        let { error } = await admin.from("sku").upsert(upsertPayload, { onConflict: "qbo_item_id" });
        if (error && /qbo_parent_item_id|PGRST204/.test(error.message ?? "")) {
          delete upsertPayload.qbo_parent_item_id;
          ({ error } = await admin.from("sku").upsert(upsertPayload, { onConflict: "qbo_item_id" }));
        }
        if (error) { errors++; await markLanding(admin, "landing_raw_qbo_item", entry.id, "error", error.message); continue; }
      }

      await markLanding(admin, "landing_raw_qbo_item", entry.id, "committed");
      processed++;
    } catch (err: any) {
      errors++;
      console.error(`Process item ${entry.external_id}:`, err.message);
      await markLanding(admin, "landing_raw_qbo_item", entry.id, "error", err.message);
    }
  }

  return { processed, errors };
}

// ════════════════════════════════════════════════════════════
// 2. PROCESS PURCHASES → Receipts → Stock Units
// ════════════════════════════════════════════════════════════

async function processPurchases(admin: any, batchSize: number): Promise<{ processed: number; errors: number; stock_created: number }> {
  const { data: pending } = await admin
    .from("landing_raw_qbo_purchase")
    .select("id, external_id, raw_payload")
    .eq("status", "pending")
    .order("raw_payload->>'TxnDate'", { ascending: true })
    .limit(batchSize);

  let processed = 0, errors = 0, stockCreated = 0;

  for (const entry of (pending ?? [])) {
    // Track IDs created in this iteration for rollback
    const createdStockUnitIds: string[] = [];
    let receiptId: string | null = null;
    let insertedLineIds: string[] = [];

    try {
      const purchase = entry.raw_payload;
      const qboPurchaseId = String(purchase.Id);

      const hasItemLines = (purchase.Line ?? []).some((l: any) => l.DetailType === "ItemBasedExpenseLineDetail");
      if (!hasItemLines) {
        await markLanding(admin, "landing_raw_qbo_purchase", entry.id, "skipped", "No item lines");
        processed++;
        continue;
      }

      const vendorName = purchase.EntityRef?.name ?? null;
      const txnDate = purchase.TxnDate ?? null;
      const totalAmount = purchase.TotalAmt ?? 0;
      const currency = purchase.CurrencyRef?.value ?? "GBP";
      const globalTaxCalc = purchase.GlobalTaxCalculation ?? null;
      const taxTotal = purchase.TxnTaxDetail?.TotalTax ?? 0;

      // Upsert receipt
      const { data: receipt, error: receiptErr } = await admin
        .from("inbound_receipt")
        .upsert({
          qbo_purchase_id: qboPurchaseId,
          vendor_name: vendorName, txn_date: txnDate,
          total_amount: totalAmount, currency,
          raw_payload: purchase, tax_total: taxTotal,
          global_tax_calculation: globalTaxCalc,
        }, { onConflict: "qbo_purchase_id" })
        .select("id, status").single();

      if (receiptErr) { errors++; await markLanding(admin, "landing_raw_qbo_purchase", entry.id, "error", receiptErr.message); continue; }
      receiptId = receipt.id;

      // ── IDEMPOTENCY GUARD ──
      // Count expected QBO lines vs existing receipt lines.
      // If the receipt is already processed and line counts match, skip entirely.
      const expectedLines = (purchase.Line ?? []).filter(
        (l: any) => l.DetailType === "ItemBasedExpenseLineDetail" || l.DetailType === "AccountBasedExpenseLineDetail"
      );
      const expectedLineCount = expectedLines.length;

      const { count: existingLineCount } = await admin.from("inbound_receipt_line")
        .select("id", { count: "exact", head: true })
        .eq("inbound_receipt_id", receipt.id);

      if (receipt.status === "processed" && (existingLineCount ?? 0) === expectedLineCount) {
        // Already fully processed with correct line count — skip
        await markLanding(admin, "landing_raw_qbo_purchase", entry.id, "committed");
        processed++;
        continue;
      }

      // If receipt has existing lines (reprocessing), clean them up properly
      if ((existingLineCount ?? 0) > 0) {
        const { data: oldLines } = await admin.from("inbound_receipt_line").select("id").eq("inbound_receipt_id", receipt.id);
        const oldLineIds = (oldLines ?? []).map((l: any) => l.id);

        if (oldLineIds.length > 0) {
          // Delete non-sold stock units linked to these lines
          const { data: linkedUnits } = await admin.from("stock_unit")
            .select("id, status, v2_status")
            .in("inbound_receipt_line_id", oldLineIds);

          for (const unit of (linkedUnits ?? [])) {
            if (unit.status === "closed" || unit.v2_status === "sold") {
              // Sold unit — nullify the link but preserve the unit
              await admin.from("stock_unit").update({ inbound_receipt_line_id: null }).eq("id", unit.id);
            } else {
              // Available/graded/purchased — delete entirely to prevent duplication
              await admin.from("stock_unit").delete().eq("id", unit.id);
            }
          }

          // Delete old receipt lines
          await admin.from("inbound_receipt_line").delete().eq("inbound_receipt_id", receipt.id);
        }
      }

      // Reset receipt status
      await admin.from("inbound_receipt").update({ status: "pending" }).eq("id", receipt.id);

      // Create new lines from raw payload
      const lines = expectedLines;

      const lineRows: any[] = [];
      for (const line of lines) {
        const detail = line.ItemBasedExpenseLineDetail ?? line.AccountBasedExpenseLineDetail ?? {};
        const isStockLine = line.DetailType === "ItemBasedExpenseLineDetail";
        let mpn: string | null = null;
        let conditionGrade: string | null = null;
        let rawSkuCode: string | null = null;

        if (isStockLine && detail.ItemRef?.value) {
          const { data: itemLanding } = await admin.from("landing_raw_qbo_item")
            .select("raw_payload").eq("external_id", detail.ItemRef.value).maybeSingle();
          const qboItem = itemLanding?.raw_payload;

          // Skip non-stock QBO items (Service, NonInventory, shipping lines)
          const qboItemType = qboItem?.Type ?? "";
          if (["Service", "NonInventory"].includes(qboItemType)) {
            const taxCodeRef = detail.TaxCodeRef?.value ?? null;
            const lineDescription = [
              line.Description,
              detail.ItemRef?.name,
            ].filter((value): value is string => typeof value === "string" && value.trim().length > 0).join(" - ") || "No description";
            lineRows.push({
              inbound_receipt_id: receipt.id,
              description: lineDescription,
              quantity: detail.Qty ?? 1,
              unit_cost: detail.UnitPrice ?? line.Amount ?? 0,
              line_total: line.Amount ?? 0,
              qbo_item_id: detail.ItemRef?.value ?? null,
              is_stock_line: false,
              mpn: null, condition_grade: null,
              qbo_tax_code_ref: taxCodeRef,
              sku_code: null,
            });
            continue;
          }

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
        const lineDescription = [
          line.Description,
          isStockLine ? detail.ItemRef?.name : detail.AccountRef?.name,
        ].filter((value): value is string => typeof value === "string" && value.trim().length > 0).join(" - ") || "No description";

        lineRows.push({
          inbound_receipt_id: receipt.id,
          description: lineDescription,
          quantity: detail.Qty ?? 1,
          unit_cost: detail.UnitPrice ?? line.Amount ?? 0,
          line_total: line.Amount ?? 0,
          qbo_item_id: detail.ItemRef?.value ?? null,
          is_stock_line: isStockLine,
          mpn, condition_grade: conditionGrade,
          qbo_tax_code_ref: taxCodeRef,
          sku_code: rawSkuCode,
        });
      }

      if (lineRows.length === 0) {
        await markLanding(admin, "landing_raw_qbo_purchase", entry.id, "skipped", "No lines");
        processed++;
        continue;
      }

      const { data: insertedLines, error: insertErr } = await admin
        .from("inbound_receipt_line").insert(lineRows).select("id, mpn, condition_grade, is_stock_line, qbo_tax_code_ref");
      if (insertErr) { errors++; await markLanding(admin, "landing_raw_qbo_purchase", entry.id, "error", insertErr.message); continue; }
      insertedLineIds = (insertedLines ?? []).map((l: any) => l.id);

      // Resolve tax codes
      for (const il of (insertedLines ?? [])) {
        if (il.qbo_tax_code_ref) {
          const { data: tc } = await admin.from("tax_code").select("id").eq("qbo_tax_code_id", il.qbo_tax_code_ref).maybeSingle();
          if (tc) await admin.from("inbound_receipt_line").update({ tax_code_id: tc.id }).eq("id", il.id);
        }
      }

      // Auto-process: create SKUs + stock units
      const stockLines = lineRows.filter(l => l.is_stock_line && l.mpn && l.condition_grade);
      const overheadLines = lineRows.filter(l => !l.is_stock_line && isAllocableFeeLine(l.description));

      if (stockLines.length === 0) {
        await markLanding(admin, "landing_raw_qbo_purchase", entry.id, "committed");
        processed++;
        continue;
      }

      const unmapped = lineRows.filter(l => l.is_stock_line && (!l.mpn || !l.condition_grade));
      if (unmapped.length > 0) {
        await markLanding(admin, "landing_raw_qbo_purchase", entry.id, "error", `${unmapped.length} unmapped stock lines`);
        errors++;
        continue;
      }

      const totalOverhead = overheadLines.reduce((s, l) => s + Number(l.line_total), 0);
      const totalStockCost = stockLines.reduce((s, l) => s + Number(l.line_total), 0);
      const validGrades = ["1", "2", "3", "4", "5"];

      for (let i = 0; i < stockLines.length; i++) {
        const line = stockLines[i];
        const cg = validGrades.includes(line.condition_grade!) ? line.condition_grade! : "1";
        const skuCode = line.sku_code || (cg !== "1" ? `${line.mpn}.${cg}` : line.mpn!);
        const productId = await ensureProductExists(
          admin,
          line.mpn!,
          line.description ?? line.sku_code ?? line.mpn!,
        );

        const lineTotal = Number(line.line_total);
        const lineOverhead = totalStockCost > 0 ? totalOverhead * (lineTotal / totalStockCost) : 0;
        const overheadPerUnit = line.quantity > 0 ? lineOverhead / line.quantity : 0;
        const landedCost = Math.round((Number(line.unit_cost) + overheadPerUnit) * 100) / 100;

        let { data: sku } = await admin.from("sku").select("id").eq("sku_code", skuCode).maybeSingle();
        const qboItemId = line.qbo_item_id ?? null;

        if (!sku) {
          const { data: newSku, error: skuErr } = await admin.from("sku").insert({
            product_id: productId, condition_grade: cg, sku_code: skuCode,
            name: cleanQboName(line.description ?? line.mpn),
            price: landedCost, active_flag: true, saleable_flag: true,
            qbo_item_id: qboItemId,
          }).select("id").single();
          if (skuErr) { console.error("SKU create error:", skuErr); throw new Error(`SKU create failed: ${skuErr.message}`); }
          sku = newSku;
        } else {
          const skuUpdate: Record<string, any> = { product_id: productId, saleable_flag: true };
          if (qboItemId) skuUpdate.qbo_item_id = qboItemId;
          await admin.from("sku").update(skuUpdate).eq("id", sku.id);
        }

        const receiptLineId = insertedLines?.[lineRows.indexOf(line)]?.id ?? null;

        // Shortfall guard — count stock for THIS receipt line
        let shortfall = line.quantity;
        if (receiptLineId) {
          const { count } = await admin.from("stock_unit").select("id", { count: "exact", head: true }).eq("inbound_receipt_line_id", receiptLineId);
          shortfall = line.quantity - (count ?? 0);
        }
        if (shortfall <= 0) continue;

        const now = new Date().toISOString();
        const stockUnits = [];
        for (let j = 0; j < shortfall; j++) {
          stockUnits.push({
            sku_id: sku!.id, mpn: line.mpn, condition_grade: cg,
            status: "available",
            v2_status: "graded",
            graded_at: now,
            landed_cost: landedCost,
            supplier_id: vendorName, inbound_receipt_line_id: receiptLineId,
          });
        }
        const { data: createdUnits, error: suErr } = await admin.from("stock_unit").insert(stockUnits).select("id");
        if (suErr) { console.error("Stock unit insert error:", suErr); throw new Error(`Stock unit insert failed: ${suErr.message}`); }
        for (const cu of (createdUnits ?? [])) createdStockUnitIds.push(cu.id);
        stockCreated += (createdUnits ?? []).length;
      }

      await admin.from("inbound_receipt").update({ status: "processed", processed_at: new Date().toISOString() }).eq("id", receipt.id);
      await markLanding(admin, "landing_raw_qbo_purchase", entry.id, "committed");
      processed++;
    } catch (err: any) {
      errors++;
      console.error(`Process purchase ${entry.external_id}:`, err.message);

      // ROLLBACK: Delete any stock units created in this iteration
      if (createdStockUnitIds.length > 0) {
        console.warn(`Rolling back ${createdStockUnitIds.length} stock units for purchase ${entry.external_id}`);
        for (let i = 0; i < createdStockUnitIds.length; i += 100) {
          const batch = createdStockUnitIds.slice(i, i + 100);
          await admin.from("stock_unit").delete().in("id", batch);
        }
        stockCreated -= createdStockUnitIds.length;
      }

      // ROLLBACK: Delete inserted receipt lines
      if (insertedLineIds.length > 0) {
        await admin.from("inbound_receipt_line").delete().in("id", insertedLineIds);
      }

      // Reset receipt status to pending so it can be retried
      if (receiptId) {
        await admin.from("inbound_receipt").update({ status: "pending" }).eq("id", receiptId);
      }

      await markLanding(admin, "landing_raw_qbo_purchase", entry.id, "error", err.message);
    }
  }

  return { processed, errors, stock_created: stockCreated };
}

// ════════════════════════════════════════════════════════════
// 3. PROCESS SALES RECEIPTS → Sales Orders
// ════════════════════════════════════════════════════════════

async function resolveVatRateId(admin: any, txnTaxDetail: any): Promise<string | null> {
  const taxLines = txnTaxDetail?.TaxLine ?? [];
  if (taxLines.length === 0) return null;
  const taxRateRef = taxLines[0]?.TaxLineDetail?.TaxRateRef?.value;
  if (!taxRateRef) return null;
  const { data: vr } = await admin.from("vat_rate").select("id").eq("qbo_tax_rate_id", String(taxRateRef)).maybeSingle();
  return vr?.id ?? null;
}

async function resolveSkuFromItem(
  admin: any,
  itemRefValue: string,
  itemRefName: string | null,
): Promise<{ skuId: string | null; skuCode: string | null }> {
  const { data: skuByItemId } = await admin
    .from("sku")
    .select("id, sku_code")
    .eq("qbo_item_id", itemRefValue)
    .maybeSingle();

  if (skuByItemId?.id) {
    return { skuId: skuByItemId.id, skuCode: skuByItemId.sku_code ?? null };
  }

  const { data: itemLanding } = await admin
    .from("landing_raw_qbo_item")
    .select("raw_payload")
    .eq("external_id", itemRefValue)
    .maybeSingle();

  const qboItem = itemLanding?.raw_payload;
  const skuField = qboItem?.Sku;
  let skuCode: string | null = null;
  if (skuField && String(skuField).trim()) {
    skuCode = String(skuField).trim();
  } else if (itemRefName) {
    skuCode = String(itemRefName).trim();
  }

  if (!skuCode) {
    return { skuId: null, skuCode: null };
  }

  const { data: skuByCode } = await admin
    .from("sku")
    .select("id")
    .eq("sku_code", skuCode)
    .maybeSingle();

  return { skuId: skuByCode?.id ?? null, skuCode };
}

async function processSalesReceipts(admin: any, batchSize: number): Promise<{ processed: number; errors: number; stock_matched: number; stock_missing: number }> {
  const { data: pending } = await admin
    .from("landing_raw_qbo_sales_receipt")
    .select("id, external_id, raw_payload")
    .eq("status", "pending")
    .order("raw_payload->>'TxnDate'", { ascending: true })
    .limit(batchSize);

  let processed = 0, errors = 0, stockMatched = 0, stockMissing = 0;

  for (const entry of (pending ?? [])) {
    try {
      const receipt = entry.raw_payload;
      const qboId = String(receipt.Id ?? receipt._entity_id ?? entry.external_id);
      const originChannel = detectOriginChannel(receipt);
      const originRef = deriveOriginReference(receipt, originChannel);

      // Handle deletion tombstones — reset stock and remove order
      if (receipt?._deleted === true) {
        // Search by qbo_sales_receipt_id OR origin_reference
        const { data: existingOrder } = await admin.from("sales_order")
          .select("id")
          .or(`qbo_sales_receipt_id.eq.${qboId},and(origin_reference.eq.${originRef},origin_channel.eq.${originChannel})`)
          .maybeSingle();
        if (existingOrder) {
          await cleanupSalesOrder(admin, existingOrder.id);
          console.log(`Deleted sales order for QBO SalesReceipt ${qboId} — stock reset`);
        }
        await markLanding(admin, "landing_raw_qbo_sales_receipt", entry.id, "committed", "Deleted in QBO — stock reset");
        processed++;
        continue;
      }

      const itemLines = (receipt.Line ?? []).filter(
        (l: any) => l.DetailType === "SalesItemLineDetail" && l.SalesItemLineDetail?.ItemRef?.value
      );
      if (itemLines.length === 0) {
        await markLanding(admin, "landing_raw_qbo_sales_receipt", entry.id, "skipped", "No item lines");
        processed++;
        continue;
      }

      // ── Match-first: try to find an existing order to enrich ──
      const docNumber = receipt.DocNumber ?? null;
      if (docNumber) {
        // Check by origin_reference (eBay order ID, KO- number, etc)
        const { data: byRef } = await admin.from("sales_order")
          .select("id").eq("origin_reference", docNumber).maybeSingle();
        if (byRef) {
          const enrichFields: Record<string, any> = {
            doc_number: docNumber, qbo_sales_receipt_id: qboId,
            qbo_sync_status: "synced",
          };
          await admin.from("sales_order").update(enrichFields).eq("id", byRef.id);
          await markLanding(admin, "landing_raw_qbo_sales_receipt", entry.id, "committed");
          processed++;
          continue;
        }

        // Check by doc_number
        const { data: byDocNumber } = await admin.from("sales_order")
          .select("id").eq("doc_number", docNumber).maybeSingle();
        if (byDocNumber) {
          await admin.from("sales_order").update({
            qbo_sales_receipt_id: qboId, qbo_sync_status: "synced",
          }).eq("id", byDocNumber.id);
          await markLanding(admin, "landing_raw_qbo_sales_receipt", entry.id, "committed");
          processed++;
          continue;
        }

        // Check by order_number
        const { data: byOrderNumber } = await admin.from("sales_order")
          .select("id").eq("order_number", docNumber).maybeSingle();
        if (byOrderNumber) {
          await admin.from("sales_order").update({
            qbo_sales_receipt_id: qboId, qbo_sync_status: "synced",
          }).eq("id", byOrderNumber.id);
          await markLanding(admin, "landing_raw_qbo_sales_receipt", entry.id, "committed");
          processed++;
          continue;
        }
      }

      // Same-channel dedup: delete existing order for re-creation using unified cleanup
      const { data: existing } = await admin.from("sales_order")
        .select("id").eq("origin_channel", originChannel).eq("origin_reference", originRef).maybeSingle();
      if (existing) {
        await cleanupSalesOrder(admin, existing.id);
      }
      // Also check by qbo_sales_receipt_id for legacy data
      const { data: existingByQboId } = await admin.from("sales_order")
        .select("id").eq("qbo_sales_receipt_id", qboId).maybeSingle();
      if (existingByQboId) {
        await cleanupSalesOrder(admin, existingByQboId.id);
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

      let customerId: string | null = null;
      if (customerRefValue) {
        const { data: cust } = await admin.from("customer").select("id").eq("qbo_customer_id", customerRefValue).maybeSingle();
        customerId = cust?.id ?? null;
      }

      const vatRateId = await resolveVatRateId(admin, receipt.TxnTaxDetail);

      // Use TxnDate for created_at so orders sort by actual transaction date
      const orderCreatedAt = txnDate ? new Date(txnDate).toISOString() : new Date().toISOString();

      const orderPayload: Record<string, any> = {
        origin_channel: originChannel, origin_reference: originRef,
        status: "complete", guest_name: customerName,
        guest_email: `qbo-sale-${qboId}@imported.local`,
        shipping_name: customerName,
        merchandise_subtotal: merchandiseSubtotal, tax_total: taxTotal,
        gross_total: grossTotal, global_tax_calculation: globalTaxCalc,
        currency, customer_id: customerId, txn_date: txnDate,
        doc_number: docNumber,
        created_at: orderCreatedAt,
        notes: `Imported from QBO SalesReceipt #${docNumber ?? qboId}`,
        qbo_sync_status: "synced", qbo_sales_receipt_id: qboId,
        qbo_customer_id: customerRefValue,
      };

      let { data: order, error: orderErr } = await admin.from("sales_order").insert(orderPayload).select("id").single();
      if (orderErr && /qbo_sync_status|qbo_sales_receipt_id|qbo_customer_id|PGRST204/.test(orderErr.message ?? "")) {
        delete orderPayload.qbo_sync_status;
        delete orderPayload.qbo_sales_receipt_id;
        delete orderPayload.qbo_customer_id;
        ({ data: order, error: orderErr } = await admin.from("sales_order").insert(orderPayload).select("id").single());
      }
      if (orderErr) { errors++; await markLanding(admin, "landing_raw_qbo_sales_receipt", entry.id, "error", orderErr.message); continue; }

      let orderStockMatched = 0;
      let orderStockMissing = 0;
      const unresolvedLines: string[] = [];

      try {
        for (const line of itemLines) {
          const detail = line.SalesItemLineDetail;
          const qty = detail.Qty ?? 1;
          const unitPrice = detail.UnitPrice ?? 0;
          const taxCodeRef = detail.TaxCodeRef?.value ?? null;

          // Check if this is a non-stock item (Service/NonInventory/shipping/literal IDs)
          const { data: itemLanding } = await admin.from("landing_raw_qbo_item")
            .select("raw_payload").eq("external_id", detail.ItemRef.value).maybeSingle();
          const qboItemPayload = itemLanding?.raw_payload;
          const qboItemType = qboItemPayload?.Type ?? "";
          if (!itemLanding || isNaN(Number(detail.ItemRef.value)) || ["Service", "NonInventory"].includes(qboItemType)) {
            console.log(`Skipping non-stock line: ${detail.ItemRef?.name ?? detail.ItemRef.value} (Type: ${qboItemType}, landing: ${!!itemLanding})`);
            continue;
          }

          const { skuId, skuCode } = await resolveSkuFromItem(admin, detail.ItemRef.value, detail.ItemRef?.name ?? null);
          if (!skuId) {
            unresolvedLines.push(`${detail.ItemRef.value}:${skuCode ?? detail.ItemRef?.name ?? "unknown"}`);
            continue;
          }

          let lineTaxCodeId: string | null = null;
          if (taxCodeRef) {
            const { data: tc } = await admin.from("tax_code").select("id").eq("qbo_tax_code_id", String(taxCodeRef)).maybeSingle();
            lineTaxCodeId = tc?.id ?? null;
          }

          // Atomic stock allocation — now also sets v2_status, sold_at, and order_id
          const { data: allocatedIds, error: allocErr } = await admin.rpc("allocate_stock_units", {
            p_sku_id: skuId,
            p_quantity: qty,
            p_order_id: order.id,
          });
          if (allocErr) throw allocErr;
          const unitIds: string[] = allocatedIds ?? [];

          for (let i = 0; i < qty; i++) {
            const stockUnitId = unitIds[i] ?? null;
            const { error: lineErr } = await admin.from("sales_order_line").insert({
              sales_order_id: order.id, sku_id: skuId, quantity: 1,
              unit_price: unitPrice, line_total: unitPrice,
              stock_unit_id: stockUnitId, qbo_tax_code_ref: taxCodeRef,
              vat_rate_id: vatRateId, tax_code_id: lineTaxCodeId,
            });
            if (lineErr) {
              throw lineErr;
            }
            if (stockUnitId) orderStockMatched++;
            else orderStockMissing++;
          }
        }

        if (unresolvedLines.length > 0) {
          await cleanupSalesOrder(admin, order.id);

          errors++;
          await markLanding(
            admin,
            "landing_raw_qbo_sales_receipt",
            entry.id,
            "error",
            `Unresolved sales line SKUs: ${unresolvedLines.slice(0, 5).join(", ")}`,
          );
          continue;
        }
      } catch (lineErr: any) {
        await cleanupSalesOrder(admin, order.id);
        throw lineErr;
      }

      stockMatched += orderStockMatched;
      stockMissing += orderStockMissing;

      await markLanding(admin, "landing_raw_qbo_sales_receipt", entry.id, "committed");
      processed++;
    } catch (err: any) {
      errors++;
      console.error(`Process sales receipt ${entry.external_id}:`, err.message);
      await markLanding(admin, "landing_raw_qbo_sales_receipt", entry.id, "error", err.message);
    }
  }

  return { processed, errors, stock_matched: stockMatched, stock_missing: stockMissing };
}

// ════════════════════════════════════════════════════════════
// 4. PROCESS REFUND RECEIPTS → Ignore + cleanup legacy refund orders
// ════════════════════════════════════════════════════════════

async function processRefundReceipts(
  admin: any,
  batchSize: number,
): Promise<{ processed: number; ignored: number; errors: number; refund_orders_removed: number }> {
  const { data: pending } = await admin
    .from("landing_raw_qbo_refund_receipt")
    .select("id, external_id, raw_payload")
    .eq("status", "pending")
    .order("raw_payload->>'TxnDate'", { ascending: true })
    .limit(batchSize);

  let processed = 0, errors = 0, refundOrdersRemoved = 0;

  for (const entry of (pending ?? [])) {
    try {
      const receipt = entry.raw_payload ?? {};
      const qboId = String(receipt.Id ?? entry.external_id);

      const removedExisting = await deleteImportedRefundOrder(admin, qboId);
      if (removedExisting) {
        refundOrdersRemoved++;
      }

      await markLanding(admin, "landing_raw_qbo_refund_receipt", entry.id, "committed");
      processed++;
    } catch (err: any) {
      errors++;
      console.error(`Process refund ${entry.external_id}:`, err.message);
      await markLanding(admin, "landing_raw_qbo_refund_receipt", entry.id, "error", err.message);
    }
  }

  return { processed, ignored: processed, errors, refund_orders_removed: refundOrdersRemoved };
}

// ════════════════════════════════════════════════════════════
// 5. PROCESS VENDORS
// ════════════════════════════════════════════════════════════

async function processVendors(admin: any, batchSize: number): Promise<{ processed: number; errors: number }> {
  const { data: pending } = await admin
    .from("landing_raw_qbo_vendor")
    .select("id, external_id, raw_payload")
    .eq("status", "pending")
    .order("received_at", { ascending: true })
    .limit(batchSize);

  let processed = 0, errors = 0;

  for (const entry of (pending ?? [])) {
    try {
      const vendor = entry.raw_payload ?? {};
      const qboVendorId = String(vendor.Id ?? entry.external_id);

      if (vendor?._deleted === true) {
        const { error } = await admin
          .from("vendor")
          .update({ is_active: false, updated_at: new Date().toISOString() })
          .eq("qbo_vendor_id", qboVendorId);

        if (error) {
          errors++;
          await markLanding(admin, "landing_raw_qbo_vendor", entry.id, "error", error.message);
          continue;
        }

        await markLanding(admin, "landing_raw_qbo_vendor", entry.id, "committed");
        processed++;
        continue;
      }

      const displayName = getVendorDisplayName(vendor, qboVendorId);
      const normalizedName = normalizeVendorName(displayName);
      if (!normalizedName) {
        await markLanding(admin, "landing_raw_qbo_vendor", entry.id, "skipped", "No vendor name");
        processed++;
        continue;
      }

      const companyName =
        typeof vendor.CompanyName === "string" && vendor.CompanyName.trim().length > 0
          ? vendor.CompanyName.trim().replace(/\s+/g, " ")
          : null;
      const isActive = vendor.Active !== false;

      const { data: existingByQboId, error: existingQboError } = await admin
        .from("vendor")
        .select("id, vendor_type")
        .eq("qbo_vendor_id", qboVendorId)
        .maybeSingle();

      if (existingQboError) {
        errors++;
        await markLanding(admin, "landing_raw_qbo_vendor", entry.id, "error", existingQboError.message);
        continue;
      }

      let existing = existingByQboId;
      if (!existing && normalizedName) {
        const { data: existingByName, error: existingNameError } = await admin
          .from("vendor")
          .select("id, vendor_type")
          .eq("normalized_name", normalizedName)
          .maybeSingle();

        if (existingNameError) {
          errors++;
          await markLanding(admin, "landing_raw_qbo_vendor", entry.id, "error", existingNameError.message);
          continue;
        }

        existing = existingByName;
      }

      const payload = {
        qbo_vendor_id: qboVendorId,
        display_name: displayName,
        company_name: companyName,
        is_active: isActive,
        vendor_type: existing?.vendor_type && existing.vendor_type !== "other"
          ? existing.vendor_type
          : "supplier",
        updated_at: new Date().toISOString(),
      };

      const { error } = existing?.id
        ? await admin.from("vendor").update(payload).eq("id", existing.id)
        : await admin.from("vendor").insert(payload);

      if (error) {
        errors++;
        await markLanding(admin, "landing_raw_qbo_vendor", entry.id, "error", error.message);
        continue;
      }

      await markLanding(admin, "landing_raw_qbo_vendor", entry.id, "committed");
      processed++;
    } catch (err: any) {
      errors++;
      console.error(`Process vendor ${entry.external_id}:`, err.message);
      await markLanding(admin, "landing_raw_qbo_vendor", entry.id, "error", err.message);
    }
  }

  return { processed, errors };
}

// ════════════════════════════════════════════════════════════
// 6. PROCESS CUSTOMERS
// ════════════════════════════════════════════════════════════

async function processCustomers(admin: any, batchSize: number): Promise<{ processed: number; errors: number; orders_linked: number }> {
  const { data: pending } = await admin
    .from("landing_raw_qbo_customer")
    .select("id, external_id, raw_payload")
    .eq("status", "pending")
    .order("received_at", { ascending: true })
    .limit(batchSize);

  let processed = 0, errors = 0, ordersLinked = 0;

  for (const entry of (pending ?? [])) {
    try {
      const c = entry.raw_payload;
      const qboId = String(c.Id);
      const billAddr = c.BillAddr ?? {};

      const { error } = await admin.from("customer").upsert({
        qbo_customer_id: qboId,
        display_name: c.DisplayName ?? c.FullyQualifiedName ?? "Unknown",
        first_name: c.GivenName ?? null,
        last_name: c.FamilyName ?? null,
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

      if (error) {
        errors++;
        await markLanding(admin, "landing_raw_qbo_customer", entry.id, "error", error.message);
        continue;
      }

      await markLanding(admin, "landing_raw_qbo_customer", entry.id, "committed");
      processed++;
    } catch (err: any) {
      errors++;
      console.error(`Process customer ${entry.external_id}:`, err.message);
      await markLanding(admin, "landing_raw_qbo_customer", entry.id, "error", err.message);
    }
  }


  // ── Customer orphan cleanup: delete canonical customers with no matching landing record ──
  const { data: qboCustomers } = await admin
    .from("customer")
    .select("id, qbo_customer_id")
    .not("qbo_customer_id", "is", null);

  let customersOrphaned = 0;
  for (const cust of (qboCustomers ?? [])) {
    const { data: landingMatch } = await admin
      .from("landing_raw_qbo_customer")
      .select("id")
      .eq("external_id", cust.qbo_customer_id)
      .limit(1)
      .maybeSingle();

    if (!landingMatch) {
      // No landing record means this customer was deleted/deactivated in QBO
      await admin.from("customer").delete().eq("id", cust.id);
      customersOrphaned++;
    }
  }
  if (customersOrphaned > 0) {
    console.log(`Customer orphan cleanup: deleted ${customersOrphaned} customers with no landing record`);
  }

  return { processed, errors, orders_linked: ordersLinked, orphans_deleted: customersOrphaned };
}

// ════════════════════════════════════════════════════════════
// 7. PROCESS DEPOSITS → Payouts
// ════════════════════════════════════════════════════════════

async function processDeposits(admin: any, batchSize: number): Promise<{ processed: number; errors: number; payouts_created: number }> {
  const { data: pending } = await admin
    .from("landing_raw_qbo_deposit")
    .select("id, external_id, raw_payload")
    .eq("status", "pending")
    .order("raw_payload->>'TxnDate'", { ascending: true })
    .limit(batchSize);

  let processed = 0, errors = 0, payoutsCreated = 0;

  for (const entry of (pending ?? [])) {
    try {
      const deposit = entry.raw_payload;
      const qboDepositId = String(deposit.Id);
      const txnDate = deposit.TxnDate ?? null;
      const totalAmt = deposit.TotalAmt ?? 0;
      const currency = deposit.CurrencyRef?.value ?? "GBP";
      const memo = deposit.PrivateNote ?? null;

      // Detect channel from memo or deposit lines
      let channel = "unknown";
      const memoLower = (memo ?? "").toLowerCase();
      if (/ebay/i.test(memoLower)) channel = "ebay";
      else if (/stripe/i.test(memoLower) || /web/i.test(memoLower) || /ko-/i.test(memoLower)) channel = "web";
      else if (/square/i.test(memoLower) || /cash/i.test(memoLower)) channel = "in_person";

      // Check for existing payout by qbo_deposit_id
      const { data: existingPayout } = await admin.from("payouts")
        .select("id").eq("qbo_deposit_id", qboDepositId).maybeSingle();

      let payoutId: string;
      if (existingPayout) {
        payoutId = existingPayout.id;
        // Update existing
        await admin.from("payouts").update({
          payout_date: txnDate, net_amount: totalAmt, currency, channel,
          notes: memo, updated_at: new Date().toISOString(),
        }).eq("id", payoutId);
      } else {
        const { data: newPayout, error: payoutErr } = await admin.from("payouts").insert({
          qbo_deposit_id: qboDepositId, payout_date: txnDate,
          net_amount: totalAmt, currency, channel, notes: memo,
          status: "reconciled",
        }).select("id").single();
        if (payoutErr) throw payoutErr;
        payoutId = newPayout.id;
        payoutsCreated++;
      }

      // Link deposit lines to sales orders via QBO SalesReceipt IDs
      const lines = deposit.Line ?? [];
      for (const line of lines) {
        const linkedTxnId = line.LinkedTxn?.[0]?.TxnId;
        const linkedTxnType = line.LinkedTxn?.[0]?.TxnType;
        if (!linkedTxnId || linkedTxnType !== "SalesReceipt") continue;

        // Find the sales order linked to this QBO SalesReceipt
        const { data: linkedOrder } = await admin.from("sales_order")
          .select("id").eq("qbo_sales_receipt_id", String(linkedTxnId)).maybeSingle();
        if (!linkedOrder) continue;

        // Check if payout_orders link already exists
        const { data: existingLink } = await admin.from("payout_orders")
          .select("id").eq("payout_id", payoutId).eq("sales_order_id", linkedOrder.id).maybeSingle();
        if (existingLink) continue;

        const lineAmt = line.Amount ?? 0;
        await admin.from("payout_orders").insert({
          payout_id: payoutId, sales_order_id: linkedOrder.id,
          order_gross: lineAmt,
        });
      }

      await markLanding(admin, "landing_raw_qbo_deposit", entry.id, "committed");
      processed++;
    } catch (err: any) {
      errors++;
      console.error(`Process deposit ${entry.external_id}:`, err.message);
      await markLanding(admin, "landing_raw_qbo_deposit", entry.id, "error", err.message);
    }
  }

  return { processed, errors, payouts_created: payoutsCreated };
}

// ════════════════════════════════════════════════════════════
// MAIN HANDLER
// ════════════════════════════════════════════════════════════

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) throw new Error("Unauthorized");

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const token = authHeader.replace("Bearer ", "");
    const isInternal = req.headers.get("x-webhook-trigger") === "true" && token === serviceRoleKey;

    if (!isInternal) {
      const { data: { user }, error: userError } = await admin.auth.getUser(token);
      if (userError || !user) throw new Error("Unauthorized");

      const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", user.id);
      const hasAccess = (roles ?? []).some((r: any) => r.role === "admin" || r.role === "staff");
      if (!hasAccess) throw new Error("Forbidden");
    }

    // Parse optional params
    let entityType: string | null = null;
    let batchSize = 15;
    try {
      const body = await req.json();
      if (body?.entity_type) entityType = body.entity_type;
      if (body?.batch_size && typeof body.batch_size === "number") {
        batchSize = Math.min(Math.max(body.batch_size, 1), 200);
      }
    } catch { /* no body */ }

    const results: Record<string, any> = {};

    if (entityType) {
      if (entityType === "vendors") results.vendors = await processVendors(admin, batchSize);
      else if (entityType === "customers") results.customers = await processCustomers(admin, batchSize);
      else if (entityType === "items") results.items = await processItems(admin, batchSize);
      else if (entityType === "purchases") results.purchases = await processPurchases(admin, batchSize);
      else if (entityType === "sales") results.sales = await processSalesReceipts(admin, batchSize);
      else if (entityType === "refunds") results.refunds = await processRefundReceipts(admin, batchSize);
    } else {
      // Tiered processing: respect dependency order
      const [pendingVendors, pendingCust, pendingItems] = await Promise.all([
        admin.from("landing_raw_qbo_vendor").select("id", { count: "exact", head: true }).eq("status", "pending"),
        admin.from("landing_raw_qbo_customer").select("id", { count: "exact", head: true }).eq("status", "pending"),
        admin.from("landing_raw_qbo_item").select("id", { count: "exact", head: true }).eq("status", "pending"),
      ]);
      const tier1Remaining = (pendingVendors.count ?? 0) + (pendingCust.count ?? 0) + (pendingItems.count ?? 0);

      if (tier1Remaining > 0) {
        results.vendors = await processVendors(admin, batchSize);
        results.customers = await processCustomers(admin, batchSize);
        results.items = await processItems(admin, batchSize);
      } else {
        const { count: pendingPurch } = await admin.from("landing_raw_qbo_purchase")
          .select("id", { count: "exact", head: true }).eq("status", "pending");

        if ((pendingPurch ?? 0) > 0) {
          results.purchases = await processPurchases(admin, batchSize);
        } else {
          results.sales = await processSalesReceipts(admin, batchSize);
          results.refunds = await processRefundReceipts(admin, batchSize);
        }
      }
    }

    // Check remaining pending counts
    const [
      { count: pendingItems },
      { count: pendingPurchases },
      { count: pendingSales },
      { count: pendingRefunds },
      { count: pendingCustomers },
      { count: pendingVendors },
    ] = await Promise.all([
      admin.from("landing_raw_qbo_item").select("id", { count: "exact", head: true }).eq("status", "pending"),
      admin.from("landing_raw_qbo_purchase").select("id", { count: "exact", head: true }).eq("status", "pending"),
      admin.from("landing_raw_qbo_sales_receipt").select("id", { count: "exact", head: true }).eq("status", "pending"),
      admin.from("landing_raw_qbo_refund_receipt").select("id", { count: "exact", head: true }).eq("status", "pending"),
      admin.from("landing_raw_qbo_customer").select("id", { count: "exact", head: true }).eq("status", "pending"),
      admin.from("landing_raw_qbo_vendor").select("id", { count: "exact", head: true }).eq("status", "pending"),
    ]);

    const remaining = {
      items: pendingItems ?? 0,
      purchases: pendingPurchases ?? 0,
      sales: pendingSales ?? 0,
      refunds: pendingRefunds ?? 0,
      customers: pendingCustomers ?? 0,
      vendors: pendingVendors ?? 0,
    };
    const totalRemaining = Object.values(remaining).reduce((a, b) => a + b, 0);

    return new Response(
      JSON.stringify({
        success: true,
        results,
        remaining,
        has_more: totalRemaining > 0,
        total_remaining: totalRemaining,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("qbo-process-pending error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
