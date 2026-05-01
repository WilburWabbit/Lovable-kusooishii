import {
  authenticateRequest,
  corsHeaders,
  createAdminClient,
  errorResponse,
  fetchWithTimeout,
  jsonResponse,
} from "../_shared/qbo-helpers.ts";

type SupabaseAdminClient = ReturnType<typeof createAdminClient>;

interface RefreshRequest {
  mode?: "dry_run" | "approved_apply";
  monthsBack?: number;
  months_back?: number;
  scope?: string[];
}

interface FunctionResult {
  functionName: string;
  success: boolean;
  response?: unknown;
  error?: string;
}

function clampMonthsBack(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return 36;
  return Math.max(1, Math.min(120, Math.floor(parsed)));
}

function monthList(monthsBack: number): string[] {
  const months: string[] = [];
  const cursor = new Date();
  cursor.setUTCDate(1);

  for (let i = 0; i < monthsBack; i += 1) {
    const year = cursor.getUTCFullYear();
    const month = String(cursor.getUTCMonth() + 1).padStart(2, "0");
    months.push(`${year}-${month}`);
    cursor.setUTCMonth(cursor.getUTCMonth() - 1);
  }

  return months;
}

async function requireStaff(req: Request, admin: SupabaseAdminClient): Promise<string> {
  const auth = await authenticateRequest(req, admin);
  if (auth.userId === "service-role") return auth.userId;

  const { data, error } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", auth.userId);
  if (error) throw error;

  const hasAccess = (data ?? []).some((row: { role: string }) => row.role === "admin" || row.role === "staff");
  if (!hasAccess) throw new Error("Forbidden");
  return auth.userId;
}

async function callFunction(name: string, body: Record<string, unknown>, authHeader: string): Promise<unknown> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  if (!supabaseUrl) throw new Error("SUPABASE_URL is required");

  const response = await fetchWithTimeout(`${supabaseUrl}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader,
    },
    body: JSON.stringify(body),
  }, 180_000);

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload && typeof payload === "object" && "error" in payload
      ? String((payload as { error: unknown }).error)
      : `${name} returned HTTP ${response.status}`;
    throw new Error(message);
  }

  return payload;
}

async function runStep(
  results: FunctionResult[],
  functionName: string,
  body: Record<string, unknown>,
  authHeader: string,
): Promise<void> {
  try {
    const response = await callFunction(functionName, body, authHeader);
    results.push({ functionName, success: true, response });
  } catch (err) {
    results.push({
      functionName,
      success: false,
      error: err instanceof Error ? err.message : "Unknown QBO refresh error",
    });
  }
}

async function createRun(
  admin: SupabaseAdminClient,
  actorId: string,
  body: RefreshRequest,
  monthsBack: number,
): Promise<string> {
  const { data, error } = await admin
    .from("qbo_refresh_run")
    .insert({
      mode: "dry_run",
      status: "running",
      requested_by: actorId === "service-role" ? null : actorId,
      requested_scope: {
        requested_mode: body.mode ?? "dry_run",
        scope: body.scope ?? ["customers", "items", "vendors", "purchases", "sales", "deposits"],
        months_back: monthsBack,
      },
      started_at: new Date().toISOString(),
    } as never)
    .select("id")
    .single();

  if (error) throw error;
  return (data as unknown as { id: string }).id;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const admin = createAdminClient();
    const actorId = await requireStaff(req, admin);
    const authHeader = req.headers.get("Authorization") ?? "";
    const body = req.method === "POST" ? await req.json().catch(() => ({})) as RefreshRequest : {};
    const requestedMode = body.mode ?? "dry_run";

    if (requestedMode !== "dry_run") {
      throw new Error("Only dry_run QBO wholesale refresh is enabled. Approved apply must be implemented as a separate, explicit review flow.");
    }

    const monthsBack = clampMonthsBack(body.monthsBack ?? body.months_back);
    const months = monthList(monthsBack);
    const scope = new Set(body.scope ?? ["customers", "items", "vendors", "purchases", "sales", "deposits"]);
    const runId = await createRun(admin, actorId, body, monthsBack);
    const results: FunctionResult[] = [];

    try {
      if (scope.has("customers")) await runStep(results, "qbo-sync-customers", { trigger: "qbo_wholesale_refresh", run_id: runId }, authHeader);
      if (scope.has("items")) await runStep(results, "qbo-sync-items", { trigger: "qbo_wholesale_refresh", run_id: runId }, authHeader);
      if (scope.has("vendors")) await runStep(results, "qbo-sync-vendors", { trigger: "qbo_wholesale_refresh", run_id: runId }, authHeader);

      if (scope.has("purchases")) {
        for (const month of months) {
          await runStep(results, "qbo-sync-purchases", { month, trigger: "qbo_wholesale_refresh", run_id: runId }, authHeader);
        }
      }

      if (scope.has("sales")) {
        for (const month of months) {
          await runStep(results, "qbo-sync-sales", { month, trigger: "qbo_wholesale_refresh", run_id: runId }, authHeader);
        }
      }

      if (scope.has("deposits")) await runStep(results, "qbo-sync-deposits", { trigger: "qbo_wholesale_refresh", run_id: runId }, authHeader);

      const { data: driftRows, error: driftError } = await admin.rpc("rebuild_qbo_refresh_drift" as never, {
        p_run_id: runId,
      } as never);
      if (driftError) throw driftError;

      const success = results.every((result) => result.success);
      const summary = {
        refresh_results: results,
        drift_rows_and_cases: Number(driftRows ?? 0),
        preservation_policy: "Dry-run only: landing and drift cases are updated; website/eBay listings, prices, listing IDs, and outbound commands are not changed.",
      };

      await admin
        .from("qbo_refresh_run")
        .update({
          status: success ? "completed" : "failed",
          result_summary: summary,
          error_message: success ? null : "One or more QBO landing refresh steps failed",
          completed_at: new Date().toISOString(),
        } as never)
        .eq("id", runId);

      return jsonResponse({
        success,
        run_id: runId,
        drift_rows_and_cases: Number(driftRows ?? 0),
        results,
      }, success ? 200 : 207);
    } catch (err) {
      await admin
        .from("qbo_refresh_run")
        .update({
          status: "failed",
          error_message: err instanceof Error ? err.message : "Unknown QBO wholesale refresh error",
          result_summary: { refresh_results: results },
          completed_at: new Date().toISOString(),
        } as never)
        .eq("id", runId);
      throw err;
    }
  } catch (err) {
    const status = err instanceof Error && err.message.startsWith("Unauthorized")
      ? 401
      : err instanceof Error && err.message === "Forbidden"
        ? 403
        : 400;
    return errorResponse(err, status);
  }
});
