// ============================================================
// QBO Sync Item
// Creates or updates a QBO Item when a new SKU variant is created.
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

    const { skuCode } = await req.json();
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

    // ─── 2. Check if QBO item already exists ────────────────
    const accessToken = await ensureValidToken(admin, realmId, clientId, clientSecret);
    const baseUrl = qboBaseUrl(realmId);

    const existingQboItemId = (sku as Record<string, unknown>).qbo_item_id as string | null;
    let syncToken: string | null = null;

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
      }
    }

    // ─── 3. Build QBO Item payload ──────────────────────────
    // Read price from either `price` (v1) or `sale_price` (v2) column
    const skuRow = sku as Record<string, unknown>;
    const salePrice = (skuRow.price as number | null) ?? (skuRow.sale_price as number | null);

    const itemPayload: Record<string, unknown> = {
      Name: skuCode,
      Description: `${productName} — ${gradeLabel}`,
      Type: "NonInventory",
      IncomeAccountRef: { value: "1" }, // Sales income — configure via env/settings
      ExpenseAccountRef: { value: "2" }, // COGS — configure via env/settings
      Taxable: true,
    };

    if (salePrice) {
      itemPayload.UnitPrice = exVAT(salePrice);
    }

    // If updating, include Id and SyncToken
    if (existingQboItemId && syncToken) {
      itemPayload.Id = existingQboItemId;
      itemPayload.SyncToken = syncToken;
      itemPayload.sparse = true;
    }

    // ─── 4. POST to QBO ─────────────────────────────────────
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

    // ─── 5. Update SKU with QBO item ID ─────────────────────
    await admin
      .from("sku")
      .update({ qbo_item_id: returnedId } as never)
      .eq("sku_code", skuCode);

    // ─── 6. Land raw response ───────────────────────────────
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
      action: existingQboItemId ? "updated" : "created",
      skuCode,
    });
  } catch (err) {
    return errorResponse(err);
  }
});
