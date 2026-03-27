// ============================================================
// QBO Update Sales Receipt — Shipping Details
// Sparse-updates an existing QBO SalesReceipt with carrier,
// tracking number, and ship date after an order is shipped.
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const admin = createAdminClient();
    await authenticateRequest(req, admin);
    const { clientId, clientSecret, realmId } = getQBOConfig();

    const { orderId } = await req.json();
    if (!orderId) throw new Error("orderId is required");

    // ─── 1. Fetch order shipping details ─────────────────────
    const { data: order, error: orderErr } = await admin
      .from("sales_order")
      .select("qbo_sales_receipt_id, shipped_via, tracking_number, shipped_date")
      .eq("id", orderId)
      .single();

    if (orderErr || !order) throw new Error(`Order not found: ${orderId}`);

    const receiptId = order.qbo_sales_receipt_id as string | null;
    if (!receiptId) {
      return jsonResponse({ success: false, reason: "no_qbo_receipt" });
    }

    // ─── 2. GET existing SalesReceipt for SyncToken ──────────
    const accessToken = await ensureValidToken(admin, realmId, clientId, clientSecret);
    const baseUrl = qboBaseUrl(realmId);

    const getRes = await fetchWithTimeout(`${baseUrl}/salesreceipt/${receiptId}?minorversion=65`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });

    if (!getRes.ok) {
      const errorText = await getRes.text();
      console.error(`QBO SalesReceipt GET failed [${getRes.status}]:`, errorText);
      return jsonResponse({
        success: false,
        qbo_error: `QBO GET error [${getRes.status}]`,
        orderId,
      });
    }

    const existing = await getRes.json();
    const syncToken = existing.SalesReceipt.SyncToken;

    // ─── 3. Build sparse update payload ──────────────────────
    const updatePayload: Record<string, unknown> = {
      Id: receiptId,
      SyncToken: syncToken,
      sparse: true,
    };

    if (order.shipped_date) {
      updatePayload.ShipDate = order.shipped_date;
    }
    if (order.shipped_via) {
      updatePayload.ShipMethodRef = { value: order.shipped_via };
    }
    if (order.tracking_number) {
      updatePayload.TrackingNum = order.tracking_number;
    }

    // ─── 4. POST sparse update to QBO ────────────────────────
    const qboRes = await fetchWithTimeout(`${baseUrl}/salesreceipt?minorversion=65`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(updatePayload),
    });

    if (!qboRes.ok) {
      const errorText = await qboRes.text();
      console.error(`QBO SalesReceipt update failed [${qboRes.status}]:`, errorText);
      return jsonResponse({
        success: false,
        qbo_error: `QBO API error [${qboRes.status}]`,
        orderId,
      });
    }

    const qboResult = await qboRes.json();

    // ─── 5. Land raw response for audit ──────────────────────
    await admin.from("landing_raw_qbo_sales_receipt" as never).upsert(
      {
        external_id: receiptId,
        raw_payload: qboResult.SalesReceipt,
        status: "committed",
        correlation_id: crypto.randomUUID(),
        received_at: new Date().toISOString(),
      } as never,
      { onConflict: "external_id" as never },
    );

    return jsonResponse({
      success: true,
      qbo_sales_receipt_id: receiptId,
      orderId,
    });
  } catch (err) {
    return errorResponse(err);
  }
});
