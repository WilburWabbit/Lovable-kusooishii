// ============================================================
// QBO Sync Item
// Creates or updates a QBO Inventory Item for a SKU. Used both
// by the new-purchase push flow (Inventory items, configured
// account refs, ex-VAT PurchaseCost, fixed InvStartDate) and
// by the re-grade transfer flow.
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
  "5": "Non-saleable",
};

const INVENTORY_START_DATE = "2023-04-14";

async function loadAccountRefs(
  admin: ReturnType<typeof createAdminClient>,
): Promise<{ asset: string; income: string; cogs: string }> {
  const { data: rows } = await admin
    .from("qbo_account_settings" as never)
    .select("key, account_id");

  const map = new Map<string, string>();
  for (const r of (rows ?? []) as Record<string, unknown>[]) {
    const k = r.key as string;
    const v = r.account_id as string;
    if (k && v) map.set(k, v);
  }
  const asset = map.get("qbo_inventory_asset_account_id");
  const income = map.get("qbo_income_account_id");
  const cogs = map.get("qbo_cogs_account_id");
  if (!asset || !income || !cogs) {
    const missing = [
      !asset && "Inventory Asset",
      !income && "Sales Income",
      !cogs && "COGS",
    ].filter(Boolean).join(", ");
    throw new Error(
      `QBO account mapping incomplete (missing: ${missing}). ` +
      `Open Settings → QuickBooks → Accounts and pick the right accounts.`,
    );
  }
  return { asset, income, cogs };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const admin = createAdminClient();
    await authenticateRequest(req, admin);
    const { clientId, clientSecret, realmId } = getQBOConfig();

    const { skuCode, oldSkuCode, purchaseCost, supplierVatRegistered } = await req.json();
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
    const description = `${productName} (${skuCode})`;
    const itemName = `${productName} (${skuCode})`;

    const itemPayload: Record<string, unknown> = {
      Name: itemName.slice(0, 100), // QBO Name max 100 chars
      Description: description,
      PurchaseDesc: description,
      Taxable: true,
    };

    if (salePrice) {
      itemPayload.UnitPrice = exVAT(salePrice);
    }

    if (typeof purchaseCost === "number" && purchaseCost > 0) {
      itemPayload.PurchaseCost = supplierVatRegistered ? purchaseCost : exVAT(purchaseCost);
    } else if (skuRow.avg_cost && (skuRow.avg_cost as number) > 0) {
      itemPayload.PurchaseCost = exVAT(skuRow.avg_cost as number);
    }

    if (existingQboItemId && syncToken) {
      // UPDATE — sparse, preserve existing Type / account refs
      itemPayload.Id = existingQboItemId;
      itemPayload.SyncToken = syncToken;
      itemPayload.sparse = true;
      if (existingType) itemPayload.Type = existingType;
    } else {
      // CREATE — Inventory item with configured account refs
      const accounts = await loadAccountRefs(admin);
      itemPayload.Type = "Inventory";
      itemPayload.TrackQtyOnHand = true;
      itemPayload.QtyOnHand = 0;
      itemPayload.InvStartDate = INVENTORY_START_DATE;
      itemPayload.AssetAccountRef = { value: accounts.asset };
      itemPayload.IncomeAccountRef = { value: accounts.income };
      itemPayload.ExpenseAccountRef = { value: accounts.cogs };
      itemPayload.SalesTaxCodeRef = { value: "TAX" };
      if (supplierVatRegistered) {
        itemPayload.PurchaseTaxCodeRef = { value: "TAX" };
      }
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
        qbo_error: `QBO API error [${qboRes.status}]: ${errorText.substring(0, 400)}`,
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
