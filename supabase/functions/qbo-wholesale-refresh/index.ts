import {
  authenticateRequest,
  corsHeaders,
  createAdminClient,
  errorResponse,
  fetchWithTimeout,
  jsonResponse,
} from "../_shared/qbo-helpers.ts";

type SupabaseAdminClient = ReturnType<typeof createAdminClient>;
type RefreshAction = "start" | "step" | "status";
type RefreshMode = "dry_run" | "approved_apply";
type RefreshScope =
  | "customers"
  | "items"
  | "vendors"
  | "purchases"
  | "sales"
  | "deposits";

interface RefreshRequest {
  action?: RefreshAction;
  mode?: RefreshMode;
  run_id?: string;
  runId?: string;
  monthsBack?: number;
  months_back?: number;
  scope?: string[];
}

interface RefreshStep {
  key: string;
  label: string;
  kind: "function" | "drift";
  functionName?: string;
  body?: Record<string, unknown>;
}

interface StepResult {
  key: string;
  label: string;
  kind: RefreshStep["kind"];
  functionName?: string;
  status: "completed" | "failed";
  response?: unknown;
  error?: string;
  started_at: string;
  completed_at: string;
}

interface RefreshRun {
  id: string;
  status: "pending" | "running" | "completed" | "failed";
  requested_scope: Record<string, unknown> | null;
  result_summary: Record<string, unknown> | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
}

const DEFAULT_SCOPE: RefreshScope[] = [
  "customers",
  "items",
  "vendors",
  "purchases",
  "sales",
  "deposits",
];
const FUNCTION_STEP_TIMEOUT_MS = 115_000;

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

function normalizeScope(scope: unknown): RefreshScope[] {
  const requested = Array.isArray(scope)
    ? scope.map((value) => String(value))
    : DEFAULT_SCOPE;
  const allowed = new Set(DEFAULT_SCOPE);
  return DEFAULT_SCOPE.filter((key) => requested.includes(key) && allowed.has(key));
}

function buildSteps(scope: RefreshScope[], monthsBack: number): RefreshStep[] {
  const steps: RefreshStep[] = [];
  const months = monthList(monthsBack);

  if (scope.includes("customers")) {
    steps.push({
      key: "customers",
      label: "Land QBO customers",
      kind: "function",
      functionName: "qbo-sync-customers",
      body: { trigger: "qbo_wholesale_refresh" },
    });
  }

  if (scope.includes("items")) {
    steps.push({
      key: "items",
      label: "Land QBO items",
      kind: "function",
      functionName: "qbo-sync-items",
      body: { trigger: "qbo_wholesale_refresh" },
    });
  }

  if (scope.includes("vendors")) {
    steps.push({
      key: "vendors",
      label: "Land QBO vendors",
      kind: "function",
      functionName: "qbo-sync-vendors",
      body: { trigger: "qbo_wholesale_refresh" },
    });
  }

  if (scope.includes("purchases")) {
    for (const month of months) {
      steps.push({
        key: `purchases:${month}`,
        label: `Land QBO purchases ${month}`,
        kind: "function",
        functionName: "qbo-sync-purchases",
        body: { month, trigger: "qbo_wholesale_refresh" },
      });
    }
  }

  if (scope.includes("sales")) {
    for (const month of months) {
      steps.push({
        key: `sales:${month}`,
        label: `Land QBO sales ${month}`,
        kind: "function",
        functionName: "qbo-sync-sales",
        body: { month, trigger: "qbo_wholesale_refresh" },
      });
    }
  }

  if (scope.includes("deposits")) {
    steps.push({
      key: "deposits",
      label: "Land QBO deposits",
      kind: "function",
      functionName: "qbo-sync-deposits",
      body: { trigger: "qbo_wholesale_refresh" },
    });
  }

  steps.push({
    key: "drift",
    label: "Build QBO drift review cases",
    kind: "drift",
  });

  return steps;
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
  }, FUNCTION_STEP_TIMEOUT_MS);

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload && typeof payload === "object" && "error" in payload
      ? String((payload as { error: unknown }).error)
      : `${name} returned HTTP ${response.status}`;
    throw new Error(message);
  }

  return payload;
}

function stepResults(summary: Record<string, unknown> | null): StepResult[] {
  const rows = summary?.step_results;
  return Array.isArray(rows) ? rows as StepResult[] : [];
}

function runSteps(run: RefreshRun): RefreshStep[] {
  const requestedScope = run.requested_scope ?? {};
  const storedSteps = requestedScope.steps;
  if (Array.isArray(storedSteps) && storedSteps.length > 0) {
    return storedSteps as RefreshStep[];
  }

  const scope = normalizeScope(requestedScope.scope);
  const monthsBack = clampMonthsBack(requestedScope.months_back);
  return buildSteps(scope, monthsBack);
}

function progressPayload(run: RefreshRun, steps: RefreshStep[], summary: Record<string, unknown> | null) {
  const results = stepResults(summary);
  const completedSteps = results.filter((result) => result.status === "completed").length;
  const failedStep = results.find((result) => result.status === "failed");
  const nextStep = steps.find((step) => !results.some((result) => result.key === step.key && result.status === "completed"));
  const totalSteps = steps.length;
  const progressPct = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 100;

  return {
    success: !failedStep,
    run_id: run.id,
    status: run.status,
    total_steps: totalSteps,
    completed_steps: completedSteps,
    progress_pct: progressPct,
    next_step_key: run.status === "running" || run.status === "pending" ? nextStep?.key ?? null : null,
    next_step_label: run.status === "running" || run.status === "pending" ? nextStep?.label ?? null : null,
    last_step_label: results.at(-1)?.label ?? null,
    error: run.error_message ?? failedStep?.error ?? null,
    drift_rows_and_cases: Number(summary?.drift_rows_and_cases ?? summary?.drift_rows ?? 0),
    preservation_policy: "Dry-run only: landing and drift cases are updated; website/eBay listings, prices, listing IDs, and outbound commands are not changed.",
  };
}

async function loadRun(admin: SupabaseAdminClient, runId: string): Promise<RefreshRun> {
  const { data, error } = await admin
    .from("qbo_refresh_run")
    .select("id, status, requested_scope, result_summary, error_message, started_at, completed_at")
    .eq("id", runId)
    .single();

  if (error || !data) throw new Error(`QBO refresh run ${runId} not found`);
  return data as unknown as RefreshRun;
}

async function createRun(
  admin: SupabaseAdminClient,
  actorId: string,
  body: RefreshRequest,
  monthsBack: number,
  scope: RefreshScope[],
): Promise<RefreshRun> {
  const steps = buildSteps(scope, monthsBack);
  const { data, error } = await admin
    .from("qbo_refresh_run")
    .insert({
      mode: "dry_run",
      status: "running",
      requested_by: actorId === "service-role" ? null : actorId,
      requested_scope: {
        requested_mode: body.mode ?? "dry_run",
        scope,
        months_back: monthsBack,
        steps,
      },
      result_summary: {
        total_steps: steps.length,
        completed_steps: 0,
        step_results: [],
        preservation_policy: "Dry-run only: landing and drift cases are updated; website/eBay listings, prices, listing IDs, and outbound commands are not changed.",
      },
      started_at: new Date().toISOString(),
    } as never)
    .select("id, status, requested_scope, result_summary, error_message, started_at, completed_at")
    .single();

  if (error || !data) throw error ?? new Error("Failed to create QBO refresh run");
  return data as unknown as RefreshRun;
}

async function executeStep(
  admin: SupabaseAdminClient,
  run: RefreshRun,
  step: RefreshStep,
  authHeader: string,
): Promise<StepResult> {
  const startedAt = new Date().toISOString();
  try {
    let response: unknown;
    if (step.kind === "function") {
      if (!step.functionName) throw new Error(`Refresh step ${step.key} is missing functionName`);
      response = await callFunction(step.functionName, {
        ...(step.body ?? {}),
        run_id: run.id,
      }, authHeader);
    } else {
      const { data, error } = await admin.rpc("rebuild_qbo_refresh_drift" as never, {
        p_run_id: run.id,
      } as never);
      if (error) throw error;
      response = { drift_rows_and_cases: Number(data ?? 0) };
    }

    return {
      key: step.key,
      label: step.label,
      kind: step.kind,
      functionName: step.functionName,
      status: "completed",
      response,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
    };
  } catch (err) {
    return {
      key: step.key,
      label: step.label,
      kind: step.kind,
      functionName: step.functionName,
      status: "failed",
      error: err instanceof Error ? err.message : "Unknown QBO refresh step error",
      started_at: startedAt,
      completed_at: new Date().toISOString(),
    };
  }
}

async function runNextStep(admin: SupabaseAdminClient, runId: string, authHeader: string) {
  const run = await loadRun(admin, runId);
  const steps = runSteps(run);
  const existingResults = stepResults(run.result_summary);

  if (run.status === "completed" || run.status === "failed") {
    return progressPayload(run, steps, run.result_summary);
  }

  const completedKeys = new Set(existingResults.filter((result) => result.status === "completed").map((result) => result.key));
  const nextStep = steps.find((step) => !completedKeys.has(step.key));

  if (!nextStep) {
    const completedSummary = {
      ...(run.result_summary ?? {}),
      total_steps: steps.length,
      completed_steps: steps.length,
      step_results: existingResults,
      preservation_policy: "Dry-run only: landing and drift cases are updated; website/eBay listings, prices, listing IDs, and outbound commands are not changed.",
    };
    await admin
      .from("qbo_refresh_run")
      .update({
        status: "completed",
        result_summary: completedSummary,
        completed_at: new Date().toISOString(),
        error_message: null,
      } as never)
      .eq("id", run.id);
    return progressPayload({ ...run, status: "completed", completed_at: new Date().toISOString(), result_summary: completedSummary }, steps, completedSummary);
  }

  const stepResult = await executeStep(admin, run, nextStep, authHeader);
  const updatedResults = [
    ...existingResults.filter((result) => result.key !== stepResult.key),
    stepResult,
  ];
  const completedSteps = updatedResults.filter((result) => result.status === "completed").length;
  const driftRowsAndCases = stepResult.kind === "drift" && stepResult.response && typeof stepResult.response === "object"
    ? Number((stepResult.response as Record<string, unknown>).drift_rows_and_cases ?? 0)
    : Number(run.result_summary?.drift_rows_and_cases ?? run.result_summary?.drift_rows ?? 0);
  const nextStatus = stepResult.status === "failed"
    ? "failed"
    : completedSteps >= steps.length
      ? "completed"
      : "running";
  const nextSummary = {
    ...(run.result_summary ?? {}),
    total_steps: steps.length,
    completed_steps: completedSteps,
    current_step_index: completedSteps,
    step_results: updatedResults,
    last_step: {
      key: stepResult.key,
      label: stepResult.label,
      status: stepResult.status,
    },
    drift_rows_and_cases: driftRowsAndCases,
    preservation_policy: "Dry-run only: landing and drift cases are updated; website/eBay listings, prices, listing IDs, and outbound commands are not changed.",
  };
  const completedAt = nextStatus === "completed" || nextStatus === "failed"
    ? new Date().toISOString()
    : null;

  await admin
    .from("qbo_refresh_run")
    .update({
      status: nextStatus,
      result_summary: nextSummary,
      error_message: stepResult.status === "failed" ? stepResult.error : null,
      completed_at: completedAt,
    } as never)
    .eq("id", run.id);

  const updatedRun: RefreshRun = {
    ...run,
    status: nextStatus,
    result_summary: nextSummary,
    error_message: stepResult.status === "failed" ? stepResult.error ?? "QBO refresh step failed" : null,
    completed_at: completedAt,
  };
  return progressPayload(updatedRun, steps, nextSummary);
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
      throw new Error("Only dry_run QBO wholesale refresh is enabled. Approved apply must use the explicit review/apply RPC flow.");
    }

    const action = body.action ?? "start";

    if (action === "start") {
      const monthsBack = clampMonthsBack(body.monthsBack ?? body.months_back);
      const scope = normalizeScope(body.scope);
      const run = await createRun(admin, actorId, body, monthsBack, scope);
      const steps = runSteps(run);
      return jsonResponse(progressPayload(run, steps, run.result_summary), 202);
    }

    const runId = body.run_id ?? body.runId;
    if (!runId) throw new Error("run_id is required for QBO refresh status/step actions");

    if (action === "status") {
      const run = await loadRun(admin, runId);
      const steps = runSteps(run);
      return jsonResponse(progressPayload(run, steps, run.result_summary));
    }

    if (action === "step") {
      return jsonResponse(await runNextStep(admin, runId, authHeader));
    }

    throw new Error(`Unsupported QBO refresh action: ${action}`);
  } catch (err) {
    const status = err instanceof Error && err.message.startsWith("Unauthorized")
      ? 401
      : err instanceof Error && err.message === "Forbidden"
        ? 403
        : 400;
    return errorResponse(err, status);
  }
});
