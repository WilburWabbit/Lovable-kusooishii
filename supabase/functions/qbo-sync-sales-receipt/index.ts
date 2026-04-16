// Redeployed: 2026-03-23
// ============================================================
// QBO Sync Sales Receipt
// Creates a SalesReceipt in QBO when an order is placed.
// Handles VAT calculation (all prices VAT-inclusive → ex-VAT for QBO).
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
import { exVAT, adjustLineVATRounding } from "../_shared/vat.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const admin = createAdminClient();
    await authenticateRequest(req, admin);
    const { clientId, clientSecret, realmId } = getQBOConfig();

    const { orderId } = await req.json();
    if (!orderId) throw new Error("orderId is required");

    // ─── 1. Fetch order + line items ────────────────────────
    const { data: order, error: orderErr } = await admin
      .from("sales_order")
      .select("*")
      .eq("id", orderId)
      .single();

    if (orderErr || !order) throw new Error(`Order not found: ${orderId}`);

    const { data: lineItems, error: lineErr } = await admin
      .from("sales_order_line")
      .select("*, sku:sku_id(sku_code, qbo_item_id, product_id)")
      .eq("sales_order_id", orderId);

    if (lineErr) throw new Error(`Failed to fetch line items: ${lineErr.message}`);

    // ─── 2. Fetch customer ──────────────────────────────────
    // Default to QBO "Cash Sales" customer (id 55) for unmapped/in-person sales.
    const CASH_SALES_QBO_ID = "55";
    let qboCustomerRef: string | null = null;
    if (order.customer_id) {
      const { data: customer } = await admin
        .from("customer")
        .select("qbo_customer_id")
        .eq("id", order.customer_id)
        .single();

      qboCustomerRef = customer?.qbo_customer_id ?? null;
    }
    if (!qboCustomerRef) {
      qboCustomerRef = CASH_SALES_QBO_ID;
    }

    // ─── 3. Calculate VAT per line ──────────────────────────
    // QBO requires SalesReceipt amounts to be tax-EXCLUSIVE; QBO then adds VAT
    // on top via the TaxCodeRef. We send `net` (ex-VAT) line amounts and
    // `GlobalTaxCalculation: "TaxExcluded"` so the resulting QBO total matches
    // the app's gross-inclusive total exactly.
    const grossLines = (lineItems ?? []).map((li: Record<string, unknown>) => ({
      gross: ((li.unit_price as number) ?? 0) * ((li.quantity as number) ?? 1),
    }));
    const vatBreakdown = adjustLineVATRounding(grossLines);

    // ─── 4. Build QBO SalesReceipt payload ──────────────────
    const orderNumber = order.order_number ?? `KO-${String(order.id).slice(0, 7)}`;
    const channel = (order.origin_channel as string)?.toLowerCase() ?? "website";

    // Resolve QBO PaymentMethod and Class refs by name (cached lookup).
    const accessToken = await ensureValidToken(admin, realmId, clientId, clientSecret);
    const baseUrl = qboBaseUrl(realmId);

    async function lookupQboRef(entity: "PaymentMethod" | "Class", name: string): Promise<string | null> {
      const query = `select Id, Name from ${entity} where Name = '${name.replace(/'/g, "\\'")}'`;
      const url = `${baseUrl}/query?query=${encodeURIComponent(query)}&minorversion=65`;
      const res = await fetchWithTimeout(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
      });
      if (!res.ok) {
        console.warn(`QBO ${entity} lookup failed for "${name}" [${res.status}]`);
        return null;
      }
      const json = await res.json();
      const row = json?.QueryResponse?.[entity]?.[0];
      return row?.Id ? String(row.Id) : null;
    }

    // Map channel to QBO PaymentMethod NAME. Per business rule: in-person
    // (incl. part-cash + Stripe terminal) is recorded as "Stripe".
    const paymentMethodNameByChannel: Record<string, string> = {
      ebay: "eBay Managed Payments",
      website: "Stripe",
      web: "Stripe",
      bricklink: "BrickLink",
      brickowl: "BrickOwl",
      in_person: "Stripe",
    };
    const paymentMethodName = paymentMethodNameByChannel[channel] ?? "Stripe";
    const paymentMethodId = await lookupQboRef("PaymentMethod", paymentMethodName);

    // Class: in-person sales are tagged with the "In Person Sale" class.
    let classId: string | null = null;
    if (channel === "in_person") {
      classId = await lookupQboRef("Class", "In Person Sale");
    }

    const qboLines = (lineItems ?? []).map((li: Record<string, unknown>, idx: number) => {
      const sku = li.sku as Record<string, unknown> | null;
      const qty = (li.quantity as number) ?? 1;
      const lineNet = vatBreakdown[idx]?.net ?? exVAT(((li.unit_price as number) ?? 0) * qty);
      const unitNet = qty > 0 ? Math.round((lineNet / qty) * 100) / 100 : lineNet;

      const detail: Record<string, unknown> = {
        Qty: qty,
        UnitPrice: unitNet,
        TaxCodeRef: { value: "6" }, // UK 20% standard rate (QBO tax code ID)
      };

      if (sku?.qbo_item_id) {
        detail.ItemRef = { value: String(sku.qbo_item_id) };
      }
      if (classId) {
        detail.ClassRef = { value: classId };
      }

      return {
        DetailType: "SalesItemLineDetail",
        Amount: lineNet,
        SalesItemLineDetail: detail,
      } as Record<string, unknown>;
    });

    const totalVAT = vatBreakdown.reduce((sum, v) => sum + v.vat, 0);

    const salesReceiptPayload: Record<string, unknown> = {
      DocNumber: orderNumber,
      TxnDate: order.created_at ? new Date(order.created_at as string).toISOString().slice(0, 10) : undefined,
      Line: qboLines,
      GlobalTaxCalculation: "TaxExcluded",
      TxnTaxDetail: {
        TotalTax: Math.round(totalVAT * 100) / 100,
      },
      CustomerRef: { value: qboCustomerRef },
    };

    if (paymentMethodId) {
      salesReceiptPayload.PaymentMethodRef = { value: paymentMethodId };
    }
    if (classId) {
      salesReceiptPayload.ClassRef = { value: classId };
    }


    // ─── 5. POST to QBO ─────────────────────────────────────
    const accessToken = await ensureValidToken(admin, realmId, clientId, clientSecret);
    const baseUrl = qboBaseUrl(realmId);

    const qboRes = await fetchWithTimeout(`${baseUrl}/salesreceipt?minorversion=65`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(salesReceiptPayload),
    });

    if (!qboRes.ok) {
      const errorText = await qboRes.text();
      console.error(`QBO SalesReceipt creation failed [${qboRes.status}]:`, errorText);

      // Mark order as sync error
      await admin
        .from("sales_order")
        .update({ qbo_sync_status: "error" } as never)
        .eq("id", orderId);

      return jsonResponse({
        success: false,
        qbo_error: `QBO API error [${qboRes.status}]`,
        orderId,
      });
    }

    const qboResult = await qboRes.json();
    const receiptId = String(qboResult.SalesReceipt.Id);

    // ─── 6. Update order with QBO receipt ID ────────────────
    await admin
      .from("sales_order")
      .update({
        qbo_sales_receipt_id: receiptId,
        qbo_sync_status: "synced",
      } as never)
      .eq("id", orderId);

    // ─── 7. Land raw response for audit ─────────────────────
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
      totalVAT: Math.round(totalVAT * 100) / 100,
    });
  } catch (err) {
    return errorResponse(err);
  }
});
