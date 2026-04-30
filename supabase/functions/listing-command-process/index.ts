// ============================================================
// Listing Command Processor
// Processes outbound_command rows created by queue_listing_command.
// External channels are driven from the app-side outbox; external systems
// never write directly into canonical listing state.
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

type ListingCommand = {
  id: string;
  target_system: string;
  command_type: string;
  entity_type: string;
  entity_id: string | null;
  idempotency_key: string;
  retry_count: number | null;
  payload: Record<string, unknown> | null;
};

type ProcessResult = {
  command_id: string;
  target_system: string;
  command_type: string;
  status: string;
  error?: string;
  response?: Record<string, unknown>;
  next_attempt_at?: string | null;
};

function clampBatchSize(value: unknown): number {
  const parsed = Number(value ?? DEFAULT_BATCH_SIZE);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_BATCH_SIZE;
  return Math.min(Math.floor(parsed), MAX_BATCH_SIZE);
}

function retryDelayMinutes(retryCount: number): number {
  return Math.min(60, Math.max(1, 2 ** Math.max(0, retryCount - 1)));
}

function normalizeTarget(value: string | null | undefined): string {
  if (value === "website") return "web";
  return value ?? "web";
}

function isRetryableError(message: string): boolean {
  if (/not implemented yet/i.test(message)) return false;
  if (/Unsupported .* listing command/i.test(message)) return false;
  if (/must target a channel_listing/i.test(message)) return false;
  return true;
}

async function parseJsonResponse(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { raw_response: text };
  }
}

async function acknowledgeWebCommand(admin: ReturnType<typeof createAdminClient>, command: ListingCommand) {
  if (command.entity_type !== "channel_listing" || !command.entity_id) {
    throw new Error("Website listing command must target a channel_listing");
  }

  const now = new Date().toISOString();
  const statusPatch: Record<string, unknown> = {
    synced_at: now,
  };

  if (command.command_type === "publish") {
    statusPatch.offer_status = "PUBLISHED";
    statusPatch.v2_status = "live";
    statusPatch.listed_at = now;
  } else if (command.command_type === "pause") {
    statusPatch.offer_status = "PAUSED";
    statusPatch.v2_status = "paused";
  } else if (command.command_type === "end") {
    statusPatch.offer_status = "ENDED";
    statusPatch.v2_status = "ended";
  } else if (command.command_type === "reprice" || command.command_type === "update_price") {
    const listedPrice = command.payload?.listed_price;
    if (typeof listedPrice === "number" && listedPrice > 0) {
      statusPatch.listed_price = listedPrice;
      statusPatch.fee_adjusted_price = listedPrice;
    }
  } else {
    throw new Error(`Unsupported website listing command ${command.command_type}`);
  }

  const { error } = await admin
    .from("channel_listing")
    .update(statusPatch as never)
    .eq("id" as never, command.entity_id);

  if (error) throw error;

  return {
    channel_listing_id: command.entity_id,
    applied_locally: true,
    patch: statusPatch,
  };
}

async function processEbayCommand(command: ListingCommand): Promise<Record<string, unknown>> {
  if (command.entity_type !== "channel_listing" || !command.entity_id) {
    throw new Error("eBay listing command must target a channel_listing");
  }

  if (!["publish", "reprice", "update_price"].includes(command.command_type)) {
    throw new Error(`Unsupported eBay listing command ${command.command_type}`);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  }

  const res = await fetchWithTimeout(`${supabaseUrl}/functions/v1/ebay-push-listing`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ listingId: command.entity_id }),
  }, 90_000);

  const payload = await parseJsonResponse(res);
  if (!res.ok || payload.success === false) {
    throw new Error(String(payload.error ?? payload.message ?? `ebay-push-listing failed [${res.status}]`));
  }
  return payload;
}

async function processCommand(
  admin: ReturnType<typeof createAdminClient>,
  command: ListingCommand,
): Promise<Record<string, unknown>> {
  if (command.entity_type !== "channel_listing") {
    throw new Error(`Unsupported command entity type ${command.entity_type}`);
  }

  const target = normalizeTarget(command.target_system);
  if (target === "web") return acknowledgeWebCommand(admin, command);
  if (target === "ebay") return processEbayCommand(command);

  throw new Error(
    `Listing command target '${command.target_system}' is not implemented yet. ` +
      "Add a channel adapter before queueing publish/reprice commands for this channel.",
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const admin = createAdminClient();
    await authenticateRequest(req, admin);

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const batchSize = clampBatchSize(body.batchSize ?? body.batch_size);
    const commandId = typeof body.commandId === "string" ? body.commandId : null;

    let query = admin
      .from("outbound_command")
      .select("id,target_system,command_type,entity_type,entity_id,idempotency_key,retry_count,payload")
      .eq("entity_type" as never, "channel_listing")
      .order("created_at" as never, { ascending: true })
      .limit(batchSize);

    if (commandId) {
      query = query.eq("id" as never, commandId);
    } else {
      query = query
        .eq("status" as never, "pending")
        .or(`next_attempt_at.is.null,next_attempt_at.lte.${new Date().toISOString()}`);
    }

    const { data: commands, error: commandErr } = await query;
    if (commandErr) throw commandErr;

    const results: ProcessResult[] = [];

    for (const command of (commands ?? []) as unknown as ListingCommand[]) {
      const retryCount = (command.retry_count ?? 0) + 1;

      const { data: claimed, error: claimErr } = await admin
        .from("outbound_command")
        .update({
          status: "processing",
          retry_count: retryCount,
          last_error: null,
          updated_at: new Date().toISOString(),
        } as never)
        .eq("id" as never, command.id)
        .eq("status" as never, "pending")
        .select("id")
        .maybeSingle();

      if (claimErr) {
        results.push({
          command_id: command.id,
          target_system: command.target_system,
          command_type: command.command_type,
          status: "claim_error",
          error: claimErr.message,
        });
        continue;
      }

      if (!claimed) {
        results.push({
          command_id: command.id,
          target_system: command.target_system,
          command_type: command.command_type,
          status: "skipped",
          error: "Command was not claimable",
        });
        continue;
      }

      try {
        const responsePayload = await processCommand(admin, command);

        await admin
          .from("outbound_command")
          .update({
            status: "acknowledged",
            response_payload: responsePayload,
            last_error: null,
            next_attempt_at: null,
            sent_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          } as never)
          .eq("id" as never, command.id);

        results.push({
          command_id: command.id,
          target_system: command.target_system,
          command_type: command.command_type,
          status: "acknowledged",
          response: responsePayload,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown listing command processor error";
        const retryable = isRetryableError(message);
        const exhausted = !retryable || retryCount >= MAX_RETRY_COUNT;
        const nextAttempt = exhausted
          ? null
          : new Date(Date.now() + retryDelayMinutes(retryCount) * 60_000).toISOString();

        await admin
          .from("outbound_command")
          .update({
            status: exhausted ? "failed" : "pending",
            last_error: message.slice(0, 1000),
            next_attempt_at: nextAttempt,
            updated_at: new Date().toISOString(),
          } as never)
          .eq("id" as never, command.id);

        results.push({
          command_id: command.id,
          target_system: command.target_system,
          command_type: command.command_type,
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
