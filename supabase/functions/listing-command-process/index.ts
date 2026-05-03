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
import { getEbayAccessToken } from "../_shared/ebay-auth.ts";
import { buildGmcProductInput } from "../_shared/gmc-product-input.ts";

const DEFAULT_BATCH_SIZE = 10;
const MAX_BATCH_SIZE = 50;
const MAX_RETRY_COUNT = 5;
const EBAY_API = "https://api.ebay.com";
const GMC_API_BASE = "https://merchantapi.googleapis.com/products/v1beta";

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

type GmcConnection = {
  id: string;
  access_token: string;
  refresh_token: string;
  token_expires_at: string;
  updated_at: string;
  merchant_id: string;
  data_source: string | null;
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

function getSiteUrl(): string {
  const configured = Deno.env.get("SITE_URL");
  if (configured) return configured.replace(/\/$/, "");
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  return supabaseUrl.replace(".supabase.co", "").replace(/\/$/, "");
}

function isRetryableError(message: string): boolean {
  if (/not implemented yet/i.test(message)) return false;
  if (/Unsupported .* listing command/i.test(message)) return false;
  if (/must target a channel_listing/i.test(message)) return false;
  return true;
}

function severityForCommand(command: ListingCommand): string {
  return ["publish", "end"].includes(command.command_type) ? "high" : "medium";
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

async function recordListingCommandFailure(
  admin: ReturnType<typeof createAdminClient>,
  command: ListingCommand,
  message: string,
  retryCount: number,
  nextAttempt: string | null,
) {
  try {
    const evidence = {
      target_system: command.target_system,
      command_type: command.command_type,
      entity_type: command.entity_type,
      entity_id: command.entity_id,
      retry_count: retryCount,
      last_error: message.slice(0, 1000),
      idempotency_key: command.idempotency_key,
      next_attempt_at: nextAttempt,
      payload: command.payload ?? {},
    };

    const { data: existing } = await admin
      .from("reconciliation_case")
      .select("id")
      .eq("case_type" as never, "listing_command_failed")
      .eq("related_entity_type" as never, "outbound_command")
      .eq("related_entity_id" as never, command.id)
      .in("status" as never, ["open", "in_progress"] as never)
      .maybeSingle();

    if (existing) {
      await admin
        .from("reconciliation_case")
        .update({
          severity: severityForCommand(command),
          suspected_root_cause: "Listing outbound command failed.",
          recommended_action: "Review the listing command error, correct listing/channel data, then rerun the listing outbox processor.",
          due_at: nextAttempt,
          evidence,
          updated_at: new Date().toISOString(),
        } as never)
        .eq("id" as never, (existing as Record<string, unknown>).id);
      return;
    }

    await admin.from("reconciliation_case").insert({
      case_type: "listing_command_failed",
      severity: severityForCommand(command),
      related_entity_type: "outbound_command",
      related_entity_id: command.id,
      suspected_root_cause: "Listing outbound command failed.",
      recommended_action: "Review the listing command error, correct listing/channel data, then rerun the listing outbox processor.",
      due_at: nextAttempt,
      evidence,
    } as never);
  } catch (err) {
    console.warn("Failed to record listing command reconciliation case", err);
  }
}

async function resolveListingCommandFailure(
  admin: ReturnType<typeof createAdminClient>,
  commandId: string,
) {
  try {
    await admin
      .from("reconciliation_case")
      .update({
        status: "resolved",
        close_code: "listing_command_acknowledged",
        closed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as never)
      .eq("case_type" as never, "listing_command_failed")
      .eq("related_entity_type" as never, "outbound_command")
      .eq("related_entity_id" as never, commandId)
      .in("status" as never, ["open", "in_progress"] as never);
  } catch (err) {
    console.warn("Failed to resolve listing command reconciliation case", err);
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
  } else if (command.command_type === "sync_quantity") {
    const listedQuantity = Number(command.payload?.listed_quantity ?? 0);
    if (!Number.isFinite(listedQuantity) || listedQuantity < 0) {
      throw new Error("Website quantity sync command has invalid listed_quantity");
    }
    statusPatch.listed_quantity = Math.floor(listedQuantity);
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

async function ebayApiFetch(token: string, path: string, options: RequestInit = {}): Promise<Record<string, unknown> | null> {
  const res = await fetchWithTimeout(`${EBAY_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Content-Language": "en-GB",
      "Accept-Language": "en-GB",
      "X-EBAY-C-MARKETPLACE-ID": "EBAY_GB",
      ...(options.headers || {}),
    },
  }, 60_000);

  const payload = await parseJsonResponse(res);
  if (!res.ok) {
    throw new Error(String(payload.error ?? payload.message ?? payload.raw_response ?? `eBay API failed [${res.status}] ${path}`));
  }
  return payload;
}

async function processEbayEndCommand(
  admin: ReturnType<typeof createAdminClient>,
  command: ListingCommand,
): Promise<Record<string, unknown>> {
  if (!command.entity_id) {
    throw new Error("eBay end command must target a channel_listing");
  }

  const { data: listing, error } = await admin
    .from("channel_listing")
    .select("id, external_listing_id, external_sku")
    .eq("id" as never, command.entity_id)
    .maybeSingle();

  if (error) throw error;
  if (!listing) throw new Error(`channel_listing ${command.entity_id} not found`);

  const offerId = (listing as Record<string, unknown>).external_listing_id as string | null;
  if (offerId) {
    const token = await getEbayAccessToken(admin);
    try {
      await ebayApiFetch(token, `/sell/inventory/v1/offer/${encodeURIComponent(offerId)}/withdraw`, {
        method: "POST",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const alreadyEnded =
        /\[404\]|not\s+found|already\s+(ended|withdrawn)|not\s+published|not\s+active/i.test(message);
      if (!alreadyEnded) throw err;
    }
  }

  const now = new Date().toISOString();
  const { error: updateErr } = await admin
    .from("channel_listing")
    .update({
      offer_status: "ENDED",
      v2_status: "ended",
      listed_quantity: 0,
      synced_at: now,
    } as never)
    .eq("id" as never, command.entity_id);

  if (updateErr) throw updateErr;

  return {
    channel_listing_id: command.entity_id,
    offer_id: offerId,
    ended_on_ebay: Boolean(offerId),
  };
}

async function processEbayQuantityCommand(
  admin: ReturnType<typeof createAdminClient>,
  command: ListingCommand,
): Promise<Record<string, unknown>> {
  if (!command.entity_id) {
    throw new Error("eBay quantity command must target a channel_listing");
  }

  const { data: listing, error } = await admin
    .from("channel_listing")
    .select("id, sku_id, external_listing_id, external_sku")
    .eq("id" as never, command.entity_id)
    .maybeSingle();

  if (error) throw error;
  if (!listing) throw new Error(`channel_listing ${command.entity_id} not found`);

  const listingRow = listing as Record<string, unknown>;
  const sku = listingRow.external_sku as string | null;
  const offerId = listingRow.external_listing_id as string | null;
  const payloadQuantity = Number(command.payload?.listed_quantity);
  let quantity = Number.isFinite(payloadQuantity) && payloadQuantity >= 0 ? Math.floor(payloadQuantity) : null;

  if (!sku) throw new Error("eBay quantity command listing has no external_sku");

  if (quantity == null) {
    const skuId = listingRow.sku_id as string | null;
    if (!skuId) throw new Error("eBay quantity command listing has no sku_id");

    const { count } = await admin
      .from("stock_unit")
      .select("id", { count: "exact", head: true })
      .eq("sku_id" as never, skuId)
      .in("v2_status" as never, ["graded", "listed", "restocked"] as never);
    quantity = count ?? 0;
  }

  const token = await getEbayAccessToken(admin);
  let withdrew = false;

  if (quantity === 0) {
    if (offerId) {
      let withdrawError: string | null = null;
      try {
        await ebayApiFetch(token, `/sell/inventory/v1/offer/${encodeURIComponent(offerId)}/withdraw`, {
          method: "POST",
        });
      } catch (err) {
        withdrawError = err instanceof Error ? err.message : String(err);
      }

      let confirmedEnded = false;
      try {
        const offer = await ebayApiFetch(token, `/sell/inventory/v1/offer/${encodeURIComponent(offerId)}`);
        const offerStatus = String(offer?.status ?? "").toUpperCase();
        const listingStatus = String((offer?.listing as Record<string, unknown> | undefined)?.listingStatus ?? "").toUpperCase();
        confirmedEnded = offerStatus !== "PUBLISHED" || (listingStatus !== "" && listingStatus !== "ACTIVE");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (/\[404\]|not\s+found|25710/i.test(message)) confirmedEnded = true;
      }

      if (!confirmedEnded) {
        throw new Error(
          `Withdraw did not end offer ${offerId} for ${sku}. ` +
            (withdrawError ? `Withdraw response: ${withdrawError}. ` : "") +
            "Offer is still published on eBay.",
        );
      }
      withdrew = true;
    }
  } else {
    const existing = await ebayApiFetch(token, `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`);
    if (!existing) throw new Error(`Inventory item ${sku} not found on eBay`);

    await ebayApiFetch(token, `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`, {
      method: "PUT",
      body: JSON.stringify({
        ...existing,
        availability: {
          ...((existing.availability as Record<string, unknown> | undefined) ?? {}),
          shipToLocationAvailability: {
            ...(((existing.availability as Record<string, unknown> | undefined)?.shipToLocationAvailability as Record<string, unknown> | undefined) ?? {}),
            quantity,
          },
        },
      }),
    });
  }

  const patch: Record<string, unknown> = {
    listed_quantity: quantity,
    synced_at: new Date().toISOString(),
  };
  if (withdrew) {
    patch.offer_status = "ENDED";
    patch.v2_status = "ended";
  }

  const { error: updateErr } = await admin
    .from("channel_listing")
    .update(patch as never)
    .eq("id" as never, command.entity_id);
  if (updateErr) throw updateErr;

  return {
    channel_listing_id: command.entity_id,
    external_sku: sku,
    listed_quantity: quantity,
    withdrew,
  };
}

async function processEbayCommand(
  admin: ReturnType<typeof createAdminClient>,
  command: ListingCommand,
): Promise<Record<string, unknown>> {
  if (command.entity_type !== "channel_listing" || !command.entity_id) {
    throw new Error("eBay listing command must target a channel_listing");
  }

  if (!["publish", "reprice", "update_price", "end", "sync_quantity"].includes(command.command_type)) {
    throw new Error(`Unsupported eBay listing command ${command.command_type}`);
  }

  if (command.command_type === "end") {
    return processEbayEndCommand(admin, command);
  }
  if (command.command_type === "sync_quantity") {
    return processEbayQuantityCommand(admin, command);
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

async function getGmcConnection(admin: ReturnType<typeof createAdminClient>): Promise<GmcConnection> {
  const { data, error } = await admin
    .from("google_merchant_connection")
    .select("*")
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("No Google Merchant Centre connection found");

  const row = data as Record<string, unknown>;
  return {
    id: String(row.id),
    access_token: String(row.access_token),
    refresh_token: String(row.refresh_token),
    token_expires_at: String(row.token_expires_at),
    updated_at: String(row.updated_at),
    merchant_id: String(row.merchant_id),
    data_source: row.data_source ? String(row.data_source) : null,
  };
}

async function ensureGmcToken(
  admin: ReturnType<typeof createAdminClient>,
  conn: GmcConnection,
): Promise<string> {
  if (new Date(conn.token_expires_at) > new Date(Date.now() + 60_000)) {
    return conn.access_token;
  }

  const clientId = Deno.env.get("GMC_CLIENT_ID") ?? "";
  const clientSecret = Deno.env.get("GMC_CLIENT_SECRET") ?? "";
  if (!clientId || !clientSecret) throw new Error("GMC_CLIENT_ID and GMC_CLIENT_SECRET are required");

  const res = await fetchWithTimeout("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: conn.refresh_token,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  }, 30_000);

  const payload = await parseJsonResponse(res);
  if (!res.ok) {
    throw new Error(String(payload.error ?? payload.raw_response ?? `GMC token refresh failed [${res.status}]`));
  }

  const accessToken = String(payload.access_token ?? "");
  if (!accessToken) throw new Error("GMC token refresh returned no access token");

  await admin
    .from("google_merchant_connection")
    .update({
      access_token: accessToken,
      refresh_token: typeof payload.refresh_token === "string" ? payload.refresh_token : conn.refresh_token,
      token_expires_at: new Date(Date.now() + Number(payload.expires_in ?? 3600) * 1000).toISOString(),
    } as never)
    .eq("id" as never, conn.id)
    .eq("updated_at" as never, conn.updated_at);

  return accessToken;
}

async function processGoogleShoppingCommand(
  admin: ReturnType<typeof createAdminClient>,
  command: ListingCommand,
): Promise<Record<string, unknown>> {
  if (command.entity_type !== "channel_listing" || !command.entity_id) {
    throw new Error("Google Shopping listing command must target a channel_listing");
  }

  if (!["publish", "reprice", "update_price", "end", "sync_quantity"].includes(command.command_type)) {
    throw new Error(`Unsupported Google Shopping listing command ${command.command_type}`);
  }

  const conn = await getGmcConnection(admin);
  if (!conn.data_source && command.command_type !== "end") {
    throw new Error("No GMC data source configured on google_merchant_connection");
  }
  const accessToken = await ensureGmcToken(admin, conn);

  const { data: listing, error: listingErr } = await admin
    .from("channel_listing")
    .select("id, sku_id, external_sku, external_listing_id, listed_price, listed_quantity, listing_title, listing_description")
    .eq("id" as never, command.entity_id)
    .maybeSingle();
  if (listingErr) throw listingErr;
  if (!listing) throw new Error(`channel_listing ${command.entity_id} not found`);

  const listingRow = listing as Record<string, unknown>;

  if (command.command_type === "end") {
    const externalListingId = listingRow.external_listing_id as string | null;
    if (externalListingId) {
      const deleteRes = await fetchWithTimeout(
        `${GMC_API_BASE}/accounts/${conn.merchant_id}/productInputs/${encodeURIComponent(externalListingId)}`,
        { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } },
        60_000,
      );
      if (!deleteRes.ok && deleteRes.status !== 404) {
        const payload = await parseJsonResponse(deleteRes);
        throw new Error(String(payload.error ?? payload.raw_response ?? `GMC delete failed [${deleteRes.status}]`));
      }
    }

    await admin
      .from("channel_listing")
      .update({
        offer_status: "ended",
        v2_status: "ended",
        listed_quantity: 0,
        synced_at: new Date().toISOString(),
      } as never)
      .eq("id" as never, command.entity_id);

    return {
      channel_listing_id: command.entity_id,
      external_listing_id: externalListingId,
      deleted_from_gmc: Boolean(externalListingId),
    };
  }

  const skuId = listingRow.sku_id as string | null;
  if (!skuId) throw new Error("Google Shopping listing has no sku_id");

  const { data: sku, error: skuErr } = await admin
    .from("sku")
    .select("id, sku_code, condition_grade, product:product_id(id, mpn, name, seo_title, seo_description, description, img_url, subtheme_name, weight_kg, ean, upc, isbn, gmc_product_category)")
    .eq("id" as never, skuId)
    .single();
  if (skuErr) throw skuErr;

  const skuRow = sku as Record<string, unknown>;
  const productRelation = skuRow.product as Record<string, unknown> | Record<string, unknown>[] | null;
  const product = Array.isArray(productRelation) ? productRelation[0] ?? null : productRelation;
  if (!product) throw new Error("Google Shopping listing SKU has no product");

  const { count } = await admin
    .from("stock_unit")
    .select("id", { count: "exact", head: true })
    .eq("sku_id" as never, skuId)
    .in("v2_status" as never, ["graded", "listed", "restocked"] as never);
  const stockCount = count ?? Number(listingRow.listed_quantity ?? 0);
  const { input: productInput, warnings } = buildGmcProductInput(listingRow, skuRow, product, stockCount, getSiteUrl());

  const insertRes = await fetchWithTimeout(
    `${GMC_API_BASE}/accounts/${conn.merchant_id}/productInputs:insert?dataSource=${encodeURIComponent(conn.data_source ?? "")}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(productInput),
    },
    90_000,
  );
  const payload = await parseJsonResponse(insertRes);
  if (!insertRes.ok) {
    throw new Error(String(payload.error ?? payload.raw_response ?? `GMC insert failed [${insertRes.status}]`));
  }

  const externalListingId = typeof payload.name === "string" ? payload.name : listingRow.external_listing_id ?? null;
  await admin
    .from("channel_listing")
    .update({
      external_listing_id: externalListingId,
      offer_status: "published",
      v2_status: "live",
      listed_quantity: stockCount,
      synced_at: new Date().toISOString(),
      raw_data: {
        gmc_response: payload,
        gmc_warnings: warnings,
      },
    } as never)
    .eq("id" as never, command.entity_id);

  return {
    channel_listing_id: command.entity_id,
    external_listing_id: externalListingId,
    gmc_response: payload,
    warnings,
  };
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
  if (target === "ebay") return processEbayCommand(admin, command);
  if (target === "google_shopping" || target === "gmc") return processGoogleShoppingCommand(admin, command);

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

        await resolveListingCommandFailure(admin, command.id);

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

        await recordListingCommandFailure(admin, command, message, retryCount, nextAttempt);

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
