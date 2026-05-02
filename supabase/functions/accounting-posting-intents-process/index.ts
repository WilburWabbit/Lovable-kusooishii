// ============================================================
// Accounting Posting Intent Processor
// Processes app-side posting_intent outbox rows and delegates the
// concrete QBO payload build/post to the existing QBO sync functions.
// ============================================================

import {
  authenticateRequest,
  corsHeaders,
  createAdminClient,
  errorResponse,
  fetchWithTimeout,
  jsonResponse,
} from "../_shared/qbo-helpers.ts";

const DEFAULT_BATCH_SIZE = 10;
const MAX_BATCH_SIZE = 50;
const MAX_RETRY_COUNT = 5;

type PostingIntent = {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  idempotency_key: string;
  retry_count: number | null;
  payload: Record<string, unknown> | null;
};

type SupabaseQueryResult = {
  data: unknown;
  error: Error | null;
};

type SupabaseQueryBuilder = PromiseLike<unknown> & {
  select(columns: string): SupabaseQueryBuilder;
  eq(column: string, value: unknown): SupabaseQueryBuilder;
  is(column: string, value: unknown): SupabaseQueryBuilder;
  maybeSingle(): Promise<SupabaseQueryResult>;
  update(values: Record<string, unknown>): SupabaseQueryBuilder;
  upsert(values: Record<string, unknown>, options?: Record<string, unknown>): SupabaseQueryBuilder;
};

type SupabaseAdminClient = {
  from(table: string): SupabaseQueryBuilder;
};

function actionPriority(action: string): number {
  if (action === "upsert_customer" || action === "upsert_item") return 10;
  if (action === "create_purchase" || action === "update_purchase" || action === "delete_purchase") return 20;
  if (action === "create_sales_receipt" || action === "create_refund_receipt") return 30;
  if (action === "create_payout_deposit") return 40;
  return 100;
}

function clampBatchSize(value: unknown): number {
  const parsed = Number(value ?? DEFAULT_BATCH_SIZE);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_BATCH_SIZE;
  return Math.min(Math.floor(parsed), MAX_BATCH_SIZE);
}

function retryDelayMinutes(retryCount: number): number {
  return Math.min(60, Math.max(1, 2 ** Math.max(0, retryCount - 1)));
}

function getSalesOrderId(intent: PostingIntent): string | null {
  if (intent.entity_type === "sales_order" && intent.entity_id) return intent.entity_id;
  const fromPayload = intent.payload?.sales_order_id;
  return typeof fromPayload === "string" && fromPayload.length > 0 ? fromPayload : null;
}

function getPayoutId(intent: PostingIntent): string | null {
  if (intent.entity_type === "payout" && intent.entity_id) return intent.entity_id;
  const fromPayload = intent.payload?.payout_id;
  return typeof fromPayload === "string" && fromPayload.length > 0 ? fromPayload : null;
}

function getSkuId(intent: PostingIntent): string | null {
  if (intent.entity_type === "sku" && intent.entity_id) return intent.entity_id;
  const fromPayload = intent.payload?.sku_id;
  return typeof fromPayload === "string" && fromPayload.length > 0 ? fromPayload : null;
}

function getCustomerId(intent: PostingIntent): string | null {
  if (intent.entity_type === "customer" && intent.entity_id) return intent.entity_id;
  const fromPayload = intent.payload?.customer_id;
  return typeof fromPayload === "string" && fromPayload.length > 0 ? fromPayload : null;
}

function getPurchaseBatchId(intent: PostingIntent): string | null {
  const fromPayload = intent.payload?.batch_id ?? intent.payload?.purchase_batch_id;
  return typeof fromPayload === "string" && fromPayload.length > 0 ? fromPayload : null;
}

function isUuid(value: string | null): value is string {
  return !!value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function getRefundedLineIds(intent: PostingIntent): string[] {
  const value = intent.payload?.refunded_line_ids;
  if (!Array.isArray(value)) return [];
  return value.filter((id): id is string => typeof id === "string" && id.length > 0);
}

function getEntityIdForIntent(intent: PostingIntent): string | null {
  if (intent.action === "create_payout_deposit") return getPayoutId(intent);
  if (intent.action === "upsert_item") return getSkuId(intent);
  if (intent.action === "upsert_customer") return getCustomerId(intent) ?? intent.id;
  if (["create_purchase", "update_purchase", "delete_purchase"].includes(intent.action)) {
    return getPurchaseBatchId(intent);
  }
  return getSalesOrderId(intent);
}

async function ensureSalesReceiptCustomerReady(
  admin: SupabaseAdminClient,
  orderId: string,
  supabaseUrl: string,
  serviceRoleKey: string,
): Promise<string | null> {
  const { data: order, error: orderErr } = await admin
    .from("sales_order")
    .select("id, customer_id, qbo_customer_id")
    .eq("id", orderId)
    .maybeSingle();

  if (orderErr) throw orderErr;
  if (!order) throw new Error(`Order not found: ${orderId}`);

  const orderRow = order as Record<string, unknown>;
  const orderQboCustomerId = orderRow.qbo_customer_id;
  if (typeof orderQboCustomerId === "string" && orderQboCustomerId.length > 0) {
    return orderQboCustomerId;
  }

  const customerId = orderRow.customer_id;
  if (typeof customerId !== "string" || customerId.length === 0) {
    return null;
  }

  const { data: customer, error: customerErr } = await admin
    .from("customer")
    .select("id, qbo_customer_id")
    .eq("id", customerId)
    .maybeSingle();

  if (customerErr) throw customerErr;
  if (!customer) {
    throw new Error(`Order ${orderId} references missing customer ${customerId}`);
  }

  const customerRow = customer as Record<string, unknown>;
  const customerQboId = customerRow.qbo_customer_id;
  if (typeof customerQboId === "string" && customerQboId.length > 0) {
    await admin
      .from("sales_order")
      .update({ qbo_customer_id: customerQboId } as never)
      .eq("id", orderId)
      .is("qbo_customer_id", null);
    return customerQboId;
  }

  const customerRes = await fetchWithTimeout(`${supabaseUrl}/functions/v1/qbo-upsert-customer`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      customer_id: customerId,
      dependency_for: "create_sales_receipt",
      sales_order_id: orderId,
    }),
  }, 60_000);

  const responseText = await customerRes.text();
  let responsePayload: Record<string, unknown> = {};
  try {
    responsePayload = responseText ? JSON.parse(responseText) : {};
  } catch {
    responsePayload = { raw_response: responseText };
  }

  if (!customerRes.ok || responsePayload.success === false) {
    const message = String(
      responsePayload.qbo_error
        ?? responsePayload.error
        ?? `qbo-upsert-customer failed [${customerRes.status}]`,
    ).slice(0, 1000);
    throw new Error(`QBO customer dependency failed for order ${orderId}: ${message}`);
  }

  const qboCustomerId = String(responsePayload.qbo_customer_id ?? "");
  if (!qboCustomerId) {
    throw new Error(`QBO customer dependency for order ${orderId} did not return qbo_customer_id`);
  }

  await admin
    .from("sales_order")
    .update({ qbo_customer_id: qboCustomerId } as never)
    .eq("id", orderId)
    .is("qbo_customer_id", null);

  await admin
    .from("qbo_posting_reference")
    .upsert({
      local_entity_type: "customer",
      local_entity_id: customerId,
      qbo_entity_type: "Customer",
      qbo_entity_id: qboCustomerId,
      qbo_doc_number: null,
      source_column: "customer.qbo_customer_id",
      synced_at: new Date().toISOString(),
      metadata: {
        processor: "accounting-posting-intents-process",
        dependency_for: "create_sales_receipt",
        sales_order_id: orderId,
      },
    } as never, { onConflict: "local_entity_type,local_entity_id,qbo_entity_type,qbo_entity_id" as never });

  return qboCustomerId;
}

function qboActionConfig(intent: PostingIntent, entityId: string) {
  if (intent.action === "create_sales_receipt") {
    return {
      functionName: "qbo-sync-sales-receipt",
      requestBody: { orderId: entityId },
      qboEntityType: "SalesReceipt",
      responseIdField: "qbo_sales_receipt_id",
      resultIdField: "qbo_sales_receipt_id",
      sourceColumn: "sales_order.qbo_sales_receipt_id",
    };
  }

  if (intent.action === "create_refund_receipt") {
    const refundedLineIds = getRefundedLineIds(intent);
    return {
      functionName: "qbo-sync-refund-receipt",
      requestBody: { orderId: entityId, refundedLineIds },
      qboEntityType: "RefundReceipt",
      responseIdField: "qbo_refund_receipt_id",
      resultIdField: "qbo_refund_receipt_id",
      sourceColumn: "posting_intent.payload.refunded_line_ids",
    };
  }

  if (intent.action === "create_payout_deposit") {
    return {
      functionName: "qbo-sync-payout",
      requestBody: { payoutId: entityId },
      qboEntityType: "Deposit",
      responseIdField: "qbo_deposit_id",
      resultIdField: "qbo_deposit_id",
      sourceColumn: "payouts.qbo_deposit_id",
    };
  }

  if (intent.action === "upsert_item") {
    const purchaseCost = intent.payload?.purchase_cost;
    const supplierVatRegistered = intent.payload?.supplier_vat_registered;
    return {
      functionName: "qbo-sync-item",
      requestBody: {
        skuCode: intent.payload?.sku_code,
        oldSkuCode: intent.payload?.old_sku_code ?? undefined,
        purchaseCost: typeof purchaseCost === "number" ? purchaseCost : undefined,
        supplierVatRegistered: typeof supplierVatRegistered === "boolean" ? supplierVatRegistered : undefined,
      },
      qboEntityType: "Item",
      responseIdField: "qbo_item_id",
      resultIdField: "qbo_item_id",
      sourceColumn: "sku.qbo_item_id",
    };
  }

  if (intent.action === "upsert_customer") {
    const requestBody = { ...intent.payload };
    return {
      functionName: "qbo-upsert-customer",
      requestBody,
      qboEntityType: "Customer",
      responseIdField: "qbo_customer_id",
      resultIdField: "qbo_customer_id",
      sourceColumn: "customer.qbo_customer_id",
    };
  }

  if (intent.action === "create_purchase") {
    return {
      functionName: "v2-push-purchase-to-qbo",
      requestBody: { batch_id: entityId },
      qboEntityType: "Purchase",
      responseIdField: "qbo_purchase_id",
      resultIdField: "qbo_purchase_id",
      sourceColumn: "purchase_batches.qbo_purchase_id",
    };
  }

  if (intent.action === "update_purchase") {
    return {
      functionName: "v2-update-purchase-in-qbo",
      requestBody: { batch_id: entityId },
      qboEntityType: "Purchase",
      responseIdField: "qbo_purchase_id",
      resultIdField: "qbo_purchase_id",
      sourceColumn: "purchase_batches.qbo_purchase_id",
    };
  }

  if (intent.action === "delete_purchase") {
    return {
      functionName: "v2-delete-purchase-batch",
      requestBody: { batch_id: entityId, skip_qbo: false },
      qboEntityType: "Purchase",
      responseIdField: "qbo_purchase_id",
      resultIdField: "qbo_purchase_id",
      sourceColumn: "purchase_batches.qbo_purchase_id",
    };
  }

  throw new Error(`Unsupported QBO posting intent action ${intent.action}`);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const admin = createAdminClient();
    await authenticateRequest(req, admin);

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const batchSize = clampBatchSize(body.batchSize ?? body.batch_size);
    const intentId = typeof body.intentId === "string" ? body.intentId : null;

    let query = admin
      .from("posting_intent")
      .select("id, action, entity_type, entity_id, idempotency_key, retry_count, payload")
      .eq("target_system", "qbo")
      .in("action", [
        "create_sales_receipt",
        "create_refund_receipt",
        "create_payout_deposit",
        "upsert_item",
        "upsert_customer",
        "create_purchase",
        "update_purchase",
        "delete_purchase",
      ] as never)
      .order("created_at", { ascending: true })
      .limit(batchSize);

    if (intentId) {
      query = query.eq("id", intentId);
    } else {
      query = query
        .eq("status", "pending")
        .or(`next_attempt_at.is.null,next_attempt_at.lte.${new Date().toISOString()}`);
    }

    const { data: intents, error: intentErr } = await query;
    if (intentErr) throw intentErr;

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
    }

    const results: Array<Record<string, unknown>> = [];

    const sortedIntents = [...((intents ?? []) as PostingIntent[])]
      .sort((a, b) => actionPriority(a.action) - actionPriority(b.action));

    for (const intent of sortedIntents) {
      const entityId = getEntityIdForIntent(intent);
      const retryCount = (intent.retry_count ?? 0) + 1;

      const { data: claimed, error: claimErr } = await admin
        .from("posting_intent")
        .update({
          status: "processing",
          retry_count: retryCount,
          last_error: null,
          updated_at: new Date().toISOString(),
        } as never)
        .eq("id", intent.id)
        .in("status", ["pending", "failed"] as never)
        .select("id")
        .maybeSingle();

      if (claimErr) {
        results.push({ intent_id: intent.id, status: "claim_error", error: claimErr.message });
        continue;
      }

      if (!claimed) {
        results.push({ intent_id: intent.id, status: "skipped", reason: "not claimable" });
        continue;
      }

      if (!entityId) {
        const message = `Posting intent has no ${intent.entity_type} id`;
        await admin
          .from("posting_intent")
          .update({
            status: "failed",
            last_error: message,
            next_attempt_at: null,
            updated_at: new Date().toISOString(),
          } as never)
          .eq("id", intent.id);
        results.push({ intent_id: intent.id, status: "failed", error: message });
        continue;
      }

      try {
        if (intent.action === "create_sales_receipt") {
          await ensureSalesReceiptCustomerReady(admin, entityId, supabaseUrl, serviceRoleKey);
        }

        const actionConfig = qboActionConfig(intent, entityId);
        const syncRes = await fetchWithTimeout(`${supabaseUrl}/functions/v1/${actionConfig.functionName}`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${serviceRoleKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(actionConfig.requestBody),
        }, 60_000);

        const responseText = await syncRes.text();
        let responsePayload: Record<string, unknown> = {};
        try {
          responsePayload = responseText ? JSON.parse(responseText) : {};
        } catch {
          responsePayload = { raw_response: responseText };
        }

        if (!syncRes.ok || responsePayload.success === false) {
          const message = String(
            responsePayload.qbo_error
              ?? responsePayload.error
              ?? `${actionConfig.functionName} failed [${syncRes.status}]`,
          ).slice(0, 1000);
          const exhausted = retryCount >= MAX_RETRY_COUNT;
          const nextAttempt = exhausted
            ? null
            : new Date(Date.now() + retryDelayMinutes(retryCount) * 60_000).toISOString();

          await admin
            .from("posting_intent")
            .update({
              status: exhausted ? "failed" : "pending",
              response_payload: responsePayload,
              last_error: message,
              next_attempt_at: nextAttempt,
              updated_at: new Date().toISOString(),
            } as never)
            .eq("id", intent.id);

          results.push({
            intent_id: intent.id,
            entity_type: intent.entity_type,
            entity_id: entityId,
            status: exhausted ? "failed" : "retry_scheduled",
            error: message,
            next_attempt_at: nextAttempt,
          });
          continue;
        }

        const qboEntityId = String(responsePayload[actionConfig.responseIdField] ?? "");

        await admin
          .from("posting_intent")
          .update({
            status: "posted",
            response_payload: responsePayload,
            qbo_reference_id: qboEntityId || null,
            last_error: null,
            next_attempt_at: null,
            posted_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          } as never)
          .eq("id", intent.id);

        if (qboEntityId) {
          let docNumber: string | null = null;
          let localEntityId = entityId;

          if (intent.entity_type === "sales_order") {
            const { data: order } = await admin
              .from("sales_order")
              .select("order_number, doc_number")
              .eq("id", entityId)
              .maybeSingle();
            docNumber = order?.doc_number ?? order?.order_number ?? null;
          } else if (intent.entity_type === "payout") {
            const { data: payout } = await admin
              .from("payouts" as never)
              .select("external_payout_id")
              .eq("id", entityId)
              .maybeSingle();
            docNumber = ((payout as Record<string, unknown> | null)?.external_payout_id as string | null) ?? null;
          } else if (intent.entity_type === "sku") {
            const { data: sku } = await admin
              .from("sku")
              .select("sku_code")
              .eq("id", entityId)
              .maybeSingle();
            docNumber = ((sku as Record<string, unknown> | null)?.sku_code as string | null) ?? null;
          } else if (intent.entity_type === "customer") {
            const { data: customer } = await admin
              .from("customer")
              .select("display_name, email")
              .eq("id", entityId)
              .maybeSingle();
            const customerRow = customer as Record<string, unknown> | null;
            docNumber = (customerRow?.display_name as string | null) ?? (customerRow?.email as string | null) ?? null;
          } else if (intent.entity_type === "purchase_batch") {
            const { data: batch } = await admin
              .from("purchase_batches" as never)
              .select("reference")
              .eq("id", entityId)
              .maybeSingle();
            docNumber = ((batch as Record<string, unknown> | null)?.reference as string | null) ?? entityId;
          }

          const localEntityUuid = isUuid(localEntityId) ? localEntityId : null;

          if (intent.entity_type === "customer") {
            const { data: customerByQboId } = await admin
              .from("customer")
              .select("id, display_name, email")
              .eq("qbo_customer_id", qboEntityId)
              .maybeSingle();
            const customerRow = customerByQboId as Record<string, unknown> | null;
            if (customerRow?.id) localEntityId = customerRow.id as string;
            docNumber = docNumber
              ?? (customerRow?.display_name as string | null)
              ?? (customerRow?.email as string | null)
              ?? null;
          }

          await admin
            .from("qbo_posting_reference")
            .upsert({
              local_entity_type: intent.entity_type,
              local_entity_id: localEntityUuid,
              qbo_entity_type: actionConfig.qboEntityType,
              qbo_entity_id: qboEntityId,
              qbo_doc_number: (responsePayload.qbo_doc_number as string | undefined) ?? docNumber,
              source_column: actionConfig.sourceColumn,
              posting_intent_id: intent.id,
              synced_at: new Date().toISOString(),
              metadata: {
                processor: "accounting-posting-intents-process",
                idempotency_key: intent.idempotency_key,
                local_entity_reference: localEntityUuid ? null : localEntityId,
                action: intent.action,
                refunded_line_ids: getRefundedLineIds(intent),
              },
            } as never, { onConflict: "local_entity_type,local_entity_id,qbo_entity_type,qbo_entity_id" as never });
        }

        results.push({
          intent_id: intent.id,
          entity_type: intent.entity_type,
          entity_id: entityId,
          status: "posted",
          response_payload: responsePayload,
          [actionConfig.resultIdField]: qboEntityId || null,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown posting processor error";
        const exhausted = retryCount >= MAX_RETRY_COUNT;
        const nextAttempt = exhausted
          ? null
          : new Date(Date.now() + retryDelayMinutes(retryCount) * 60_000).toISOString();

        await admin
          .from("posting_intent")
          .update({
            status: exhausted ? "failed" : "pending",
            last_error: message.slice(0, 1000),
            next_attempt_at: nextAttempt,
            updated_at: new Date().toISOString(),
          } as never)
          .eq("id", intent.id);

        results.push({
          intent_id: intent.id,
          entity_type: intent.entity_type,
          entity_id: entityId,
          status: exhausted ? "failed" : "retry_scheduled",
          error: message,
          next_attempt_at: nextAttempt,
        });
      }
    }

    return jsonResponse({
      success: true,
      processed: results.length,
      results,
    });
  } catch (err) {
    return errorResponse(err);
  }
});
