// Redeployed: 2026-03-23
// ============================================================
// QBO Sync Refund Receipt
// Creates a RefundReceipt in QBO when items are refunded.
// References the original SalesReceipt for the order.
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const admin = createAdminClient();
    await authenticateRequest(req, admin);
    const { clientId, clientSecret, realmId } = getQBOConfig();

    const { orderId, refundedLineIds } = await req.json();
    if (!orderId) throw new Error("orderId is required");

    // Fetch order
    const { data: order, error: orderErr } = await admin
      .from("sales_order")
      .select("*, customer:customer_id(qbo_customer_id)")
      .eq("id", orderId)
      .single();

    if (orderErr || !order) throw new Error(`Order not found: ${orderId}`);

    const o = order as Record<string, unknown>;
    const customer = o.customer as Record<string, unknown> | null;
    const qboCustomerRef = customer?.qbo_customer_id as string | null;

    // Fetch refunded line items
    const lineFilter = refundedLineIds?.length > 0
      ? refundedLineIds
      : null;

    const lineQuery = admin
      .from("sales_order_line")
      .select("*, sku:sku_id(sku_code, qbo_item_id)")
      .eq("sales_order_id", orderId);

    if (lineFilter) {
      lineQuery.in("id", lineFilter);
    }

    const { data: lineItems, error: lineErr } = await lineQuery;
    if (lineErr) throw new Error(`Failed to fetch lines: ${lineErr.message}`);

    // Build QBO RefundReceipt payload
    const qboLines = ((lineItems ?? []) as Record<string, unknown>[]).map((li) => {
      const sku = li.sku as Record<string, unknown> | null;
      const unitPrice = exVAT((li.unit_price as number) ?? 0);

      const line: Record<string, unknown> = {
        DetailType: "SalesItemLineDetail",
        Amount: unitPrice,
        SalesItemLineDetail: {
          Qty: 1,
          UnitPrice: unitPrice,
          TaxCodeRef: { value: "20.0 S" },
        },
      };

      if (sku?.qbo_item_id) {
        (line.SalesItemLineDetail as Record<string, unknown>).ItemRef = {
          value: String(sku.qbo_item_id),
        };
      }

      return line;
    });

    const refundPayload: Record<string, unknown> = {
      Line: qboLines,
      TxnTaxDetail: {
        TotalTax: qboLines.reduce((sum, l) => {
          const amount = (l.Amount as number) ?? 0;
          return sum + Math.round(amount * 0.2 * 100) / 100;
        }, 0),
      },
    };

    if (qboCustomerRef) {
      refundPayload.CustomerRef = { value: qboCustomerRef };
    }

    // Reference original SalesReceipt if available
    const qboSalesReceiptId = o.qbo_sales_receipt_id as string | null;
    if (qboSalesReceiptId) {
      refundPayload.PrivateNote = `Refund for SalesReceipt ${qboSalesReceiptId} (Order ${o.order_number ?? orderId})`;
    }

    // POST to QBO
    const accessToken = await ensureValidToken(admin, realmId, clientId, clientSecret);
    const baseUrl = qboBaseUrl(realmId);

    const qboRes = await fetchWithTimeout(`${baseUrl}/refundreceipt?minorversion=65`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(refundPayload),
    });

    if (!qboRes.ok) {
      const errorText = await qboRes.text();
      console.error(`QBO RefundReceipt creation failed [${qboRes.status}]:`, errorText);
      return jsonResponse({
        success: false,
        qbo_error: `QBO API error [${qboRes.status}]`,
        orderId,
      });
    }

    const qboResult = await qboRes.json();
    const refundReceiptId = String(qboResult.RefundReceipt.Id);

    console.log(`QBO RefundReceipt created: ${refundReceiptId} for order ${orderId}`);

    return jsonResponse({
      success: true,
      qbo_refund_receipt_id: refundReceiptId,
      orderId,
    });
  } catch (err) {
    return errorResponse(err);
  }
});
