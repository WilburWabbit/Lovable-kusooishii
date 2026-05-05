import {
  authenticateRequest,
  corsHeaders,
  createAdminClient,
  errorResponse,
  fetchWithTimeout,
  jsonResponse,
} from "../_shared/qbo-helpers.ts";

type SupabaseAdminClient = ReturnType<typeof createAdminClient>;

const JOBS = [
  "market_intelligence",
  "settlement_reconciliation",
  "listing_outbox",
  "qbo_posting_outbox",
] as const;

type ScheduledJob = typeof JOBS[number];

interface ScheduledJobRequest {
  job?: ScheduledJob | "all";
  batchSize?: number;
  batch_size?: number;
  marketLimit?: number;
  market_limit?: number;
  marketSources?: string[];
  market_sources?: string[];
}

interface ScheduledJobResult {
  job: ScheduledJob;
  success: boolean;
  response?: unknown;
  rows?: number;
  error?: string;
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function normalizeJob(value: unknown): ScheduledJob | "all" {
  if (value === "all" || JOBS.includes(value as ScheduledJob)) return value as ScheduledJob | "all";
  return "all";
}

function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  if (aBytes.length !== bBytes.length) return false;

  let diff = 0;
  for (let i = 0; i < aBytes.length; i += 1) {
    diff |= aBytes[i] ^ bBytes[i];
  }
  return diff === 0;
}

function authenticateInternalSchedule(req: Request): string | null {
  const expected = Deno.env.get("SUBLEDGER_SCHEDULED_JOBS_SECRET")
    ?? Deno.env.get("SUBLEDGER_CRON_SECRET")
    ?? Deno.env.get("INTERNAL_CRON_SECRET")
    ?? "";
  const provided = req.headers.get("x-internal-shared-secret")
    ?? req.headers.get("x-internal-secret")
    ?? "";

  if (!provided) return null;
  if (!expected) throw new Error("Unauthorized — scheduled job secret is not configured");
  if (!timingSafeEqual(provided, expected)) {
    throw new Error("Unauthorized — invalid scheduled job secret");
  }
  return "scheduled-job";
}

async function requireAutomationActor(req: Request, admin: SupabaseAdminClient): Promise<string> {
  const internalActor = authenticateInternalSchedule(req);
  if (internalActor) return internalActor;

  const auth = await authenticateRequest(req, admin);
  if (auth.userId === "service-role") return auth.userId;

  const { data, error } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", auth.userId);
  if (error) throw error;

  const ok = (data ?? []).some((row: { role: string }) => row.role === "admin" || row.role === "staff");
  if (!ok) throw new Error("Forbidden");
  return auth.userId;
}

async function callFunction(name: string, body: Record<string, unknown>): Promise<unknown> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  }

  const response = await fetchWithTimeout(`${supabaseUrl}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceRoleKey}`,
    },
    body: JSON.stringify(body),
  }, 120_000);

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload && typeof payload === "object" && "error" in payload
      ? String((payload as { error: unknown }).error)
      : `${name} returned HTTP ${response.status}`;
    throw new Error(message);
  }

  return payload;
}

async function runMarketIntelligence(body: ScheduledJobRequest): Promise<unknown> {
  const limit = clampInt(body.marketLimit ?? body.market_limit, 60, 1, 150);
  const sources = Array.isArray(body.marketSources)
    ? body.marketSources
    : Array.isArray(body.market_sources)
      ? body.market_sources
      : undefined;

  return await callFunction("market-intelligence-refresh", {
    limit,
    sources,
    refresh_snapshots: true,
    trigger: "scheduled",
  });
}

async function runSettlementReconciliation(admin: SupabaseAdminClient): Promise<ScheduledJobResult> {
  const { data: actualRows, error: actualErr } = await admin.rpc("refresh_actual_settlement_lines", {
    p_sales_order_id: null,
    p_payout_id: null,
    p_rebuild_cases: true,
  } as never);
  if (actualErr) throw actualErr;

  const { data: orderCases, error: orderErr } = await admin.rpc("rebuild_reconciliation_cases" as never, {
    p_sales_order_id: null,
  } as never);
  if (orderErr) throw orderErr;

  const { data: listingCases, error: listingErr } = await admin.rpc(
    "rebuild_listing_command_reconciliation_cases" as never,
  );
  if (listingErr) throw listingErr;

  return {
    job: "settlement_reconciliation",
    success: true,
    rows: Number(actualRows ?? 0),
    response: {
      actual_settlement_rows: Number(actualRows ?? 0),
      reconciliation_cases: Number(orderCases ?? 0),
      listing_command_cases: Number(listingCases ?? 0),
    },
  };
}

async function runListingOutbox(body: ScheduledJobRequest): Promise<unknown> {
  const batchSize = clampInt(body.batchSize ?? body.batch_size, 25, 1, 50);
  return await callFunction("listing-command-process", { batchSize, trigger: "scheduled" });
}

async function runQboPostingOutbox(body: ScheduledJobRequest): Promise<unknown> {
  const batchSize = clampInt(body.batchSize ?? body.batch_size, 25, 1, 50);
  return await callFunction("accounting-posting-intents-process", { batchSize, trigger: "scheduled" });
}

async function runJob(
  admin: SupabaseAdminClient,
  job: ScheduledJob,
  body: ScheduledJobRequest,
): Promise<ScheduledJobResult> {
  try {
    if (job === "market_intelligence") {
      return { job, success: true, response: await runMarketIntelligence(body) };
    }
    if (job === "settlement_reconciliation") {
      return await runSettlementReconciliation(admin);
    }
    if (job === "listing_outbox") {
      return { job, success: true, response: await runListingOutbox(body) };
    }
    return { job, success: true, response: await runQboPostingOutbox(body) };
  } catch (err) {
    return {
      job,
      success: false,
      error: err instanceof Error ? err.message : "Unknown scheduled job error",
    };
  }
}

async function recordAudit(
  admin: SupabaseAdminClient,
  actorId: string,
  requestedJob: ScheduledJob | "all",
  results: ScheduledJobResult[],
): Promise<void> {
  const correlationId = crypto.randomUUID();
  const systemActor = actorId === "service-role" || actorId === "scheduled-job";
  const { error } = await admin.from("audit_event").insert({
    id: crypto.randomUUID(),
    actor_id: systemActor ? null : actorId,
    actor_type: systemActor ? "system" : "user",
    entity_type: "scheduled_job",
    entity_id: correlationId,
    trigger_type: "subledger_scheduled_jobs",
    source_system: "subledger-scheduled-jobs",
    correlation_id: correlationId,
    after_json: {
      requested_job: requestedJob,
      success: results.every((result) => result.success),
      results,
    },
  }).select("id").maybeSingle();

  if (error) console.warn("Failed to record scheduled job audit event", error);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const admin = createAdminClient();
    const actorId = await requireAutomationActor(req, admin);
    const body = req.method === "POST" ? await req.json().catch(() => ({})) as ScheduledJobRequest : {};
    const requestedJob = normalizeJob(body.job);
    const jobs = requestedJob === "all" ? [...JOBS] : [requestedJob];
    const results: ScheduledJobResult[] = [];

    for (const job of jobs) {
      results.push(await runJob(admin, job, body));
    }

    await recordAudit(admin, actorId, requestedJob, results);

    return jsonResponse({
      success: results.every((result) => result.success),
      requested_job: requestedJob,
      results,
    }, results.every((result) => result.success) ? 200 : 207);
  } catch (err) {
    const status = err instanceof Error && err.message.startsWith("Unauthorized")
      ? 401
      : err instanceof Error && err.message === "Forbidden"
        ? 403
        : 400;
    return errorResponse(err, status);
  }
});
