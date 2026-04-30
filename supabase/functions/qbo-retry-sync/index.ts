// Compatibility wrapper for the former direct QBO retry worker.
// QBO writes now flow through posting_intent and the posting-intent processor.

import {
  authenticateRequest,
  corsHeaders,
  createAdminClient,
  errorResponse,
  fetchWithTimeout,
  jsonResponse,
} from "../_shared/qbo-helpers.ts";

const DEFAULT_BATCH_SIZE = 25;
const MAX_BATCH_SIZE = 50;

function clampBatchSize(value: unknown): number {
  const parsed = Number(value ?? DEFAULT_BATCH_SIZE);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_BATCH_SIZE;
  return Math.min(Math.floor(parsed), MAX_BATCH_SIZE);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const admin = createAdminClient();
    await authenticateRequest(req, admin);

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const batchSize = clampBatchSize(body.batchSize ?? body.batch_size);

    const { data: orders, error: orderErr } = await admin
      .from("sales_order")
      .select("id, order_number")
      .in("qbo_sync_status", ["pending", "retrying"] as never)
      .is("qbo_sales_receipt_id", null)
      .order("created_at", { ascending: true })
      .limit(batchSize);

    if (orderErr) throw orderErr;

    let queued = 0;
    const queueErrors: Array<{ order_id: string; order_number: string | null; error: string }> = [];

    for (const order of (orders ?? []) as Array<{ id: string; order_number: string | null }>) {
      const { error: queueErr } = await admin.rpc("queue_qbo_posting_intents_for_order" as never, {
        p_sales_order_id: order.id,
      } as never);

      if (queueErr) {
        queueErrors.push({
          order_id: order.id,
          order_number: order.order_number ?? null,
          error: queueErr.message,
        });
      } else {
        queued++;
      }
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
    }

    const processorRes = await fetchWithTimeout(
      `${supabaseUrl}/functions/v1/accounting-posting-intents-process`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${serviceRoleKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ batchSize }),
      },
      60_000,
    );

    const processorText = await processorRes.text();
    let processorResult: Record<string, unknown> = {};
    try {
      processorResult = processorText ? JSON.parse(processorText) : {};
    } catch {
      processorResult = { raw_response: processorText };
    }

    if (!processorRes.ok) {
      return jsonResponse({
        success: false,
        queued,
        queue_errors: queueErrors,
        processor_status: processorRes.status,
        processor_result: processorResult,
      }, processorRes.status);
    }

    return jsonResponse({
      success: true,
      compatibility_endpoint: "qbo-retry-sync",
      queued,
      queue_errors: queueErrors,
      processor_result: processorResult,
    });
  } catch (err) {
    console.error("qbo-retry-sync compatibility wrapper error:", err);
    return errorResponse(err);
  }
});
