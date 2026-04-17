// Redeployed: 2026-04-17
// ============================================================
// QBO Sync Sales Receipt
// Creates a SalesReceipt in QBO when an order is placed.
// Uses the QBO-stable line distributor in _shared/qbo-tax.ts to
// guarantee the resulting QBO TotalAmt matches the source gross
// to the penny under QBO's own per-line VAT recompute.
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
import {
  toPence,
  fromPence,
  assertQBOTotalMatches,
  QBOTotalMismatchError,
} from "../_shared/vat.ts";
import {
  buildBalancedQBOLines,
  growRoundingLine,
  assertQBOPayloadBalances,
  QBOPayloadImbalanceError,
  QBO_TAX_CODE_STANDARD_20,
  QBO_TAX_CODE_NO_VAT,
  type QBOStableLine,
} from "../_shared/qbo-tax.ts";

const MAX_SR_ATTEMPTS = 3;

async function deleteQBOSalesReceipt(baseUrl: string, accessToken: string, srId: string): Promise<void> {
  try {
    const getRes = await fetchWithTimeout(
      `${baseUrl}/salesreceipt/${encodeURIComponent(srId)}?minorversion=65`,
      { method: "GET", headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } },
    );
    if (!getRes.ok) return;
    const j = await getRes.json();
    const syncToken = j?.SalesReceipt?.SyncToken;
    if (syncToken === undefined) return;
    await fetchWithTimeout(`${baseUrl}/salesreceipt?operation=delete&minorversion=65`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ Id: srId, SyncToken: String(syncToken) }),
    });
    console.log(`Deleted bad QBO SalesReceipt ${srId}`);
  } catch (e) {
    console.warn(`Exception deleting QBO SalesReceipt ${srId}:`, e);
  }
}

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

    // ─── 3. Build QBO-stable line distribution ──────────────
    // Each sales_order_line is VAT-inclusive (gross). Convert per-line gross
    // to integer pence and let the distributor pre-solve for QBO's per-line
    // VAT recompute. Any unavoidable ±1p residual is absorbed by an injected
    // "Rounding adjustment" zero-tax line.
    const sourceLines = (lineItems ?? []).map((li: Record<string, unknown>) => ({
      gross: ((li.unit_price as number) ?? 0) * ((li.quantity as number) ?? 1),
      qty: (li.quantity as number) ?? 1,
      sku: li.sku as Record<string, unknown> | null,
    }));
    const grossPenceLines = sourceLines.map((l) => toPence(l.gross));
    const totalGrossPence = grossPenceLines.reduce((s, g) => s + g, 0);
    const expectedGross = fromPence(totalGrossPence);
    const stableLines = buildBalancedQBOLines(grossPenceLines);

    try {
      assertQBOPayloadBalances(stableLines, totalGrossPence);
    } catch (e) {
      if (e instanceof QBOPayloadImbalanceError) {
        await admin
          .from("sales_order")
          .update({ qbo_sync_status: "error" } as never)
          .eq("id", orderId);
        return jsonResponse({ success: false, qbo_error: e.message, orderId });
      }
      throw e;
    }

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

    const qboLines = stableLines.map((s) => {
      const lineNet = fromPence(s.netPence);

      // Rounding balancer line — non-itemised, zero VAT.
      if (s.kind === "rounding") {
        return {
          DetailType: "SalesItemLineDetail",
          Amount: lineNet,
          SalesItemLineDetail: {
            Qty: 1,
            UnitPrice: lineNet,
            TaxCodeRef: { value: QBO_TAX_CODE_NO_VAT },
            ...(classId ? { ClassRef: { value: classId } } : {}),
          },
          Description: "Rounding adjustment (per-line VAT recompute)",
        } as Record<string, unknown>;
      }

      const src = sourceLines[s.sourceIndex!];
      const qty = src.qty;
      const unitNet = qty > 0 ? Math.round((lineNet / qty) * 100) / 100 : lineNet;

      const detail: Record<string, unknown> = {
        Qty: qty,
        UnitPrice: unitNet,
        TaxCodeRef: { value: s.taxCodeRef ?? QBO_TAX_CODE_STANDARD_20 },
      };

      if (src.sku?.qbo_item_id) {
        detail.ItemRef = { value: String(src.sku.qbo_item_id) };
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

    const salesReceiptPayload: Record<string, unknown> = {
      DocNumber: orderNumber,
      TxnDate: order.created_at ? new Date(order.created_at as string).toISOString().slice(0, 10) : undefined,
      Line: qboLines,
      GlobalTaxCalculation: "TaxExcluded",
      // NB: TxnTaxDetail.TotalTax intentionally omitted — QBO ignores it on
      // SalesReceipts and recomputes per-line. The QBO-stable distributor
      // above ensures sum(round(net × 0.20)) = expected tax exactly.
      CustomerRef: { value: qboCustomerRef },
    };

    if (paymentMethodId) {
      salesReceiptPayload.PaymentMethodRef = { value: paymentMethodId };
    }
    if (classId) {
      salesReceiptPayload.ClassRef = { value: classId };
    }


    // ─── 5. POST to QBO ─────────────────────────────────────

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
    const qboTotalAmt = Number(qboResult.SalesReceipt.TotalAmt ?? 0);

    // ─── Post-create defence-in-depth ────────────────────────
    // Pre-flight already verified the math under QBO's recompute. This
    // catches any unexpected QBO behaviour (e.g. future API changes).
    try {
      assertQBOTotalMatches({
        expectedGross,
        qboTotalAmt,
        docKind: "SalesReceipt",
        qboDocId: receiptId,
      });
    } catch (e) {
      if (e instanceof QBOTotalMismatchError) {
        console.error(e.message);
        await admin
          .from("sales_order")
          .update({ qbo_sync_status: "error" } as never)
          .eq("id", orderId);
        return jsonResponse({
          success: false,
          qbo_error: e.message,
          orderId,
          qbo_sales_receipt_id: receiptId,
          qbo_total_amt: qboTotalAmt,
          expected_gross: expectedGross,
        });
      }
      throw e;
    }

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
      total_gross: expectedGross,
    });
  } catch (err) {
    return errorResponse(err);
  }
});
