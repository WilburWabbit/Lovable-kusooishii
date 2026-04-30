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

function getRefundedLineIds(intent: PostingIntent): string[] {
  const value = intent.payload?.refunded_line_ids;
  if (!Array.isArray(value)) return [];
  return value.filter((id): id is string => typeof id === "string" && id.length > 0);
}

function qboActionConfig(intent: PostingIntent, orderId: string) {
  if (intent.action === "create_sales_receipt") {
    return {
      functionName: "qbo-sync-sales-receipt",
      requestBody: { orderId },
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
      requestBody: { orderId, refundedLineIds },
      qboEntityType: "RefundReceipt",
      responseIdField: "qbo_refund_receipt_id",
      resultIdField: "qbo_refund_receipt_id",
      sourceColumn: "posting_intent.payload.refunded_line_ids",
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
      .in("action", ["create_sales_receipt", "create_refund_receipt"] as never)
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

    for (const intent of (intents ?? []) as PostingIntent[]) {
      const orderId = getSalesOrderId(intent);
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

      if (!orderId) {
        const message = "Posting intent has no sales_order id";
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
        const actionConfig = qboActionConfig(intent, orderId);
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
            sales_order_id: orderId,
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
          const { data: order } = await admin
            .from("sales_order")
            .select("order_number, doc_number")
            .eq("id", orderId)
            .maybeSingle();

          await admin
            .from("qbo_posting_reference")
            .upsert({
              local_entity_type: "sales_order",
              local_entity_id: orderId,
              qbo_entity_type: actionConfig.qboEntityType,
              qbo_entity_id: qboEntityId,
              qbo_doc_number: order?.doc_number ?? order?.order_number ?? null,
              source_column: actionConfig.sourceColumn,
              posting_intent_id: intent.id,
              synced_at: new Date().toISOString(),
              metadata: {
                processor: "accounting-posting-intents-process",
                idempotency_key: intent.idempotency_key,
                action: intent.action,
                refunded_line_ids: getRefundedLineIds(intent),
              },
            } as never, { onConflict: "local_entity_type,local_entity_id,qbo_entity_type,qbo_entity_id" as never });
        }

        results.push({
          intent_id: intent.id,
          sales_order_id: orderId,
          status: "posted",
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
          sales_order_id: orderId,
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
