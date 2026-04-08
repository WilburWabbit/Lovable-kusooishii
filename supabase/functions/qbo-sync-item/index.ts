// Redeployed: 2026-04-08
// ============================================================
// QBO Sync Item
// Creates or updates a QBO Item when a new SKU variant is created.
// Supports re-grade transfers via optional oldSkuCode parameter.
// ============================================================

import {
  corsHeaders,
  createAdminClient,
  authenticateRequest,
  getQBOConfig,
  qboBaseUrl,
  ensureValidToken,
  fetchWithTimeout,
  jsonResponse,
  errorResponse,
} from "../_shared/qbo-helpers.ts";
import { exVAT } from "../_shared/vat.ts";

const GRADE_LABELS: Record<string, string> = {
  "1": "Gold Standard",
  "2": "Silver Lining",
  "3": "Bronze Age",
  "4": "Black Sheep",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const admin = createAdminClient();
    await authenticateRequest(req, admin);
    const { clientId, clientSecret, realmId } = getQBOConfig();

    const { skuCode, oldSkuCode } = await req.json();
    if (!skuCode) throw new Error("skuCode is required");

    // ─── 1. Fetch SKU + product ─────────────────────────────
    const { data: sku, error: skuErr } = await admin
      .from("sku")
      .select("*, product:product_id(mpn, name)")
      .eq("sku_code", skuCode)
      .single();

    if (skuErr || !sku) throw new Error(`SKU not found: ${skuCode}`);

    const product = (sku as Record<string, unknown>).product as Record<string, unknown> | null;
    const productName = (product?.name as string) ?? skuCode;
    const grade = (sku as Record<string, unknown>).condition_grade as string;
    const gradeLabel = GRADE_LABELS[grade] ?? `Grade ${grade}`;

    // ─── 2. Determine QBO item ID ───────────────────────────
    const accessToken = await ensureValidToken(admin, realmId, clientId, clientSecret);
    const baseUrl = qboBaseUrl(realmId);

    let existingQboItemId = (sku as Record<string, unknown>).qbo_item_id as string | null;
    let transferFromOldSku = false;

    // If no QBO item on new SKU but oldSkuCode provided, transfer from old SKU
    if (!existingQboItemId && oldSkuCode) {
      const { data: oldSku } = await admin
        .from("sku")
        .select("qbo_item_id")
        .eq("sku_code", oldSkuCode)
        .maybeSingle();

      const oldQboId = (oldSku as Record<string, unknown> | null)?.qbo_item_id as string | null;
      if (oldQboId) {
        existingQboItemId = oldQboId;
        transferFromOldSku = true;
        console.log(`Transferring QBO item ${oldQboId} from ${oldSkuCode} → ${skuCode}`);
      }
    }

    // ─── 3. Fetch existing QBO item if updating ─────────────
    let syncToken: string | null = null;
    let existingType: string | null = null;

    if (existingQboItemId) {
      const getRes = await fetchWithTimeout(
        `${baseUrl}/item/${existingQboItemId}?minorversion=65`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json",
          },
        },
      );

      if (getRes.ok) {
        const getData = await getRes.json();
        syncToken = getData.Item?.SyncToken ?? null;
        existingType = getData.Item?.Type ?? null;
      }
    }

    // ─── 4. Build QBO Item payload ──────────────────────────
    const skuRow = sku as Record<string, unknown>;
    const salePrice = (skuRow.price as number | null) ?? (skuRow.sale_price as number | null);
    const description = `${productName} — ${gradeLabel}`;

    const itemPayload: Record<string, unknown> = {
      Name: skuCode,
      Description: description,
      PurchaseDesc: description,
      Taxable: true,
    };

    if (salePrice) {
      itemPayload.UnitPrice = exVAT(salePrice);
    }

    if (existingQboItemId && syncToken) {
      // UPDATE — sparse update, preserve existing Type, omit account refs
      itemPayload.Id = existingQboItemId;
      itemPayload.SyncToken = syncToken;
      itemPayload.sparse = true;
      // Preserve the existing Type from QBO (e.g. "Inventory"/"NonInventory")
      if (existingType) {
        itemPayload.Type = existingType;
      }
    } else {
      // CREATE — set Type and account refs
      itemPayload.Type = "NonInventory";
      itemPayload.IncomeAccountRef = { value: "1" };
      itemPayload.ExpenseAccountRef = { value: "2" };
    }

    // ─── 5. POST to QBO ─────────────────────────────────────
    const qboRes = await fetchWithTimeout(`${baseUrl}/item?minorversion=65`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(itemPayload),
    });

    if (!qboRes.ok) {
      const errorText = await qboRes.text();
      console.error(`QBO Item sync failed [${qboRes.status}]:`, errorText);
      return jsonResponse({
        success: false,
        qbo_error: `QBO API error [${qboRes.status}]`,
        skuCode,
      });
    }

    const qboResult = await qboRes.json();
    const returnedId = String(qboResult.Item.Id);

    // ─── 6. Update new SKU with QBO item ID ─────────────────
    await admin
      .from("sku")
      .update({ qbo_item_id: returnedId } as never)
      .eq("sku_code", skuCode);

    // ─── 7. Clear QBO item ID from old SKU if transferring ──
    if (transferFromOldSku && oldSkuCode) {
      await admin
        .from("sku")
        .update({ qbo_item_id: null } as never)
        .eq("sku_code", oldSkuCode);
      console.log(`Cleared qbo_item_id from old SKU ${oldSkuCode}`);
    }

    // ─── 8. Land raw response ───────────────────────────────
    await admin.from("landing_raw_qbo_item" as never).upsert(
      {
        external_id: returnedId,
        raw_payload: qboResult.Item,
        status: "committed",
        correlation_id: crypto.randomUUID(),
        received_at: new Date().toISOString(),
      } as never,
      { onConflict: "external_id" as never },
    );

    return jsonResponse({
      success: true,
      qbo_item_id: returnedId,
      action: (existingQboItemId && syncToken) ? "updated" : "created",
      transferred: transferFromOldSku,
      skuCode,
    });
  } catch (err) {
    return errorResponse(err);
  }
});
