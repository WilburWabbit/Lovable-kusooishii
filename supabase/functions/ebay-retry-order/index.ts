// Redeployed: 2026-03-23
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";
import { verifyServiceRoleJWT } from "../_shared/auth.ts";

/**
 * eBay Retry Order — Picks up landing_raw_ebay_order rows with status
 * IN ('pending', 'error', 'retrying') after a short receive grace period
 * and re-calls ebay-process-order for each.
 *
 * Backoff schedule (minutes since last attempt):
 *   Attempt 1: immediate
 *   Attempt 2: 2 min
 *   Attempt 3: 10 min
 *   Attempt 4: 30 min
 *   Attempt 5: 60 min
 *   After 5 failures: keep status 'error' + create admin_alert
 *
 * Can be triggered:
 *   - By cron (e.g. every 5 minutes)
 *   - By ebay-notifications after a failed inline call to ebay-process-order
 *   - Manually from admin UI
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Backoff thresholds in milliseconds — minimum wait before next attempt
const BACKOFF_MS = [
  0,           // attempt 1: immediate
  2 * 60_000,  // attempt 2: 2 min
  10 * 60_000, // attempt 3: 10 min
  30 * 60_000, // attempt 4: 30 min
  60 * 60_000, // attempt 5: 60 min
];
const MAX_RETRIES = 5;
const PENDING_GRACE_MS = 2 * 60_000;
const STUCK_ALERT_AGE_MS = 30 * 60_000;
const STUCK_ORDER_ALERT_CATEGORY = "ebay_order_stuck_in_landing";

type SupabaseAdmin = ReturnType<typeof createClient>;
type StuckOrderRow = {
  id: string;
  external_id: string;
  status: string;
  received_at: string;
  retry_count: number | null;
  last_retry_at: string | null;
  error_message: string | null;
};
type ExistingAlertRow = { entity_id: string | null };
type StuckAlertSummary = {
  stuck_count: number;
  alerts_created: number;
  error?: string;
};
type RetryResult = Record<string, unknown>;

async function raiseStuckOrderAlerts(admin: SupabaseAdmin, nowMs: number): Promise<StuckAlertSummary> {
  const stuckCutoff = new Date(nowMs - STUCK_ALERT_AGE_MS).toISOString();
  const { data: stuckRowsData, error: stuckErr } = await admin
    .from("landing_raw_ebay_order")
    .select("id, external_id, status, received_at, retry_count, last_retry_at, error_message")
    .lt("received_at", stuckCutoff)
    .not("status", "in", "(committed,skipped)")
    .limit(50);

  if (stuckErr) {
    throw new Error(`Failed to query stuck eBay landing rows: ${stuckErr.message}`);
  }

  const stuckRows = (stuckRowsData || []) as StuckOrderRow[];
  if (!stuckRows.length) {
    return { stuck_count: 0, alerts_created: 0 };
  }

  const stuckIds = stuckRows.map((row) => row.id);
  const { data: existingAlertsData, error: existingAlertErr } = await admin
    .from("admin_alert")
    .select("entity_id")
    .eq("category", STUCK_ORDER_ALERT_CATEGORY)
    .eq("entity_type", "landing_raw_ebay_order")
    .eq("acknowledged", false)
    .in("entity_id", stuckIds);

  if (existingAlertErr) {
    throw new Error(`Failed to query existing stuck-order alerts: ${existingAlertErr.message}`);
  }

  const existingAlerts = (existingAlertsData || []) as ExistingAlertRow[];
  const alreadyAlerted = new Set(existingAlerts.map((alert) => alert.entity_id));
  const alertsToCreate = stuckRows
    .filter((row) => !alreadyAlerted.has(row.id))
    .map((row) => ({
      severity: "warning",
      category: STUCK_ORDER_ALERT_CATEGORY,
      title: `eBay order stuck in landing: ${row.external_id}`,
      detail:
        `eBay order ${row.external_id} (landing ${row.id}) has been in status '${row.status}' ` +
        `since ${row.received_at}. Retry count: ${row.retry_count || 0}. ` +
        `Last retry: ${row.last_retry_at || "never"}. ` +
        `Last error: ${row.error_message || "none"}.`,
      entity_type: "landing_raw_ebay_order",
      entity_id: row.id,
    }));

  if (alertsToCreate.length > 0) {
    const { error: alertErr } = await admin.from("admin_alert").insert(alertsToCreate);
    if (alertErr) {
      throw new Error(`Failed to create stuck-order alerts: ${alertErr.message}`);
    }
  }

  return { stuck_count: stuckRows.length, alerts_created: alertsToCreate.length };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Auth: service-role only
    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.replace("Bearer ", "") || "";
    if (!verifyServiceRoleJWT(token, supabaseUrl)) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const now = Date.now();
    const retryGraceCutoff = new Date(now - PENDING_GRACE_MS).toISOString();

    // Find landing rows needing retry, respecting backoff
    const { data: pendingRowsData, error: queryErr } = await admin
      .from("landing_raw_ebay_order")
      .select("id, external_id, status, retry_count, last_retry_at, received_at, error_message")
      .in("status", ["pending", "error", "retrying"])
      .lt("received_at", retryGraceCutoff)
      .order("last_retry_at", { ascending: true, nullsFirst: true })
      .limit(10);

    if (queryErr) throw new Error(`Failed to query pending landing rows: ${queryErr.message}`);
    const pendingRows = pendingRowsData || [];

    let processed = 0;
    let retrying = 0;
    let failed = 0;
    let skippedBackoff = 0;
    const results: RetryResult[] = [];

    for (const row of pendingRows) {
      // Check backoff — has enough time elapsed since last attempt?
      const retryCount = row.retry_count || 0;
      if (row.last_retry_at && retryCount > 0) {
        const backoffIdx = Math.min(retryCount - 1, BACKOFF_MS.length - 1);
        const minWait = BACKOFF_MS[backoffIdx];
        const elapsed = now - new Date(row.last_retry_at).getTime();
        if (elapsed < minWait) {
          skippedBackoff++;
          continue;
        }
      }

      // Mark as retrying before the attempt
      await admin.from("landing_raw_ebay_order").update({
        status: "retrying",
        last_retry_at: new Date().toISOString(),
      }).eq("id", row.id);

      try {
        // Call ebay-process-order — it handles idempotency, landing upsert, and QBO sync
        const processRes = await fetch(
          `${supabaseUrl}/functions/v1/ebay-process-order`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${serviceRoleKey}`,
            },
            body: JSON.stringify({ order_id: row.external_id }),
            signal: AbortSignal.timeout(55000),
          }
        );
        const processData = await processRes.json().catch(() => ({}));

        if (processRes.ok && !processData.error) {
          // Success — ebay-process-order will have marked landing as 'committed'
          // or 'skipped' (if order already existed)
          processed++;
          results.push({
            landing_id: row.id,
            external_id: row.external_id,
            status: "processed",
            sales_order_id: processData.sales_order_id,
            skipped: processData.skipped || false,
          });
          console.log(`Retry succeeded for eBay order ${row.external_id} (landing ${row.id})`);

          // Audit the successful retry
          await admin.from("audit_event").insert({
            entity_type: "landing_raw_ebay_order",
            entity_id: row.id,
            trigger_type: "ebay_order_retry",
            actor_type: "system",
            source_system: "ebay-retry-order",
            after_json: {
              status: "processed",
              sales_order_id: processData.sales_order_id,
              retry_count: retryCount,
              skipped: processData.skipped || false,
            },
          });

        } else {
          // ebay-process-order returned an error response
          throw new Error(processData.error || `HTTP ${processRes.status}`);
        }

      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const errorMsg = (message || "Unknown error").substring(0, 500);
        const newRetryCount = retryCount + 1;

        if (newRetryCount >= MAX_RETRIES) {
          // Exhausted retries — mark as permanent error and alert admin
          await admin.from("landing_raw_ebay_order").update({
            status: "error",
            retry_count: newRetryCount,
            last_retry_at: new Date().toISOString(),
            error_message: `Permanently failed after ${MAX_RETRIES} attempts. Last error: ${errorMsg}`,
          }).eq("id", row.id);

          // Create admin alert
          await admin.from("admin_alert").insert({
            severity: "critical",
            category: "ebay_order_processing_failure",
            title: `eBay order processing failed after ${MAX_RETRIES} attempts`,
            detail: `eBay order ${row.external_id} (landing ${row.id}) could not be processed. Last error: ${errorMsg}`,
            entity_type: "landing_raw_ebay_order",
            entity_id: row.id,
          });

          // Audit the permanent failure
          await admin.from("audit_event").insert({
            entity_type: "landing_raw_ebay_order",
            entity_id: row.id,
            trigger_type: "ebay_order_retry_failed",
            actor_type: "system",
            source_system: "ebay-retry-order",
            after_json: {
              status: "error",
              retry_count: newRetryCount,
              last_error: errorMsg,
            },
          });

          failed++;
          results.push({ landing_id: row.id, external_id: row.external_id, status: "failed", error: errorMsg });
          console.error(`eBay order processing FAILED permanently for ${row.external_id} after ${MAX_RETRIES} attempts: ${errorMsg}`);

        } else {
          // Still retrying — update retry state
          await admin.from("landing_raw_ebay_order").update({
            status: "retrying",
            retry_count: newRetryCount,
            last_retry_at: new Date().toISOString(),
            error_message: errorMsg,
          }).eq("id", row.id);

          retrying++;
          results.push({ landing_id: row.id, external_id: row.external_id, status: "retrying", attempt: newRetryCount, error: errorMsg });
          console.warn(`eBay order retry attempt ${newRetryCount}/${MAX_RETRIES} failed for ${row.external_id}: ${errorMsg}`);
        }
      }
    }

    let stuckAlertSummary: StuckAlertSummary = { stuck_count: 0, alerts_created: 0 };
    try {
      stuckAlertSummary = await raiseStuckOrderAlerts(admin, now);
    } catch (alertErr) {
      console.error("Failed to raise stuck eBay order alerts:", alertErr);
      const message = alertErr instanceof Error ? alertErr.message : String(alertErr);
      stuckAlertSummary = {
        stuck_count: 0,
        alerts_created: 0,
        error: message || "Unknown stuck-order alert error",
      };
    }

    return new Response(
      JSON.stringify({
        success: true,
        total_pending: pendingRows.length,
        message: pendingRows.length ? undefined : "No eBay orders pending retry",
        skipped_backoff: skippedBackoff,
        processed,
        retrying,
        failed,
        stuck_alerts: stuckAlertSummary,
        results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("ebay-retry-order error:", err);
    const message = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ error: message || "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
