// Redeployed: 2026-04-06 — CloudEvents v1.0 + legacy dual-format support
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, intuit-signature, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const FETCH_TIMEOUT_MS = 30_000;

function fetchWithTimeout(url: string | URL, options: RequestInit = {}, timeoutMs = FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

function makeLogger(correlationId: string) {
  return {
    info: (msg: string, data?: Record<string, unknown>) =>
      console.log(JSON.stringify({ correlation_id: correlationId, level: "info", msg, ...data, ts: new Date().toISOString() })),
    warn: (msg: string, data?: Record<string, unknown>) =>
      console.warn(JSON.stringify({ correlation_id: correlationId, level: "warn", msg, ...data, ts: new Date().toISOString() })),
    error: (msg: string, data?: Record<string, unknown>) =>
      console.error(JSON.stringify({ correlation_id: correlationId, level: "error", msg, ...data, ts: new Date().toISOString() })),
  };
}

// ────────────────────────────────────────────────────────────
// Signature verification
// ────────────────────────────────────────────────────────────

async function verifySignature(body: string, signature: string, verifierToken: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(verifierToken), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  const computed = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return computed === signature;
}

// ────────────────────────────────────────────────────────────
// Token management
// ────────────────────────────────────────────────────────────

async function ensureValidToken(admin: any, realmId: string, clientId: string, clientSecret: string) {
  const { data: conn, error } = await admin
    .from("qbo_connection").select("*").eq("realm_id", realmId).single();
  if (error || !conn) throw new Error("No QBO connection found.");

  if (new Date(conn.token_expires_at).getTime() - Date.now() < 5 * 60 * 1000) {
    const tokenRes = await fetchWithTimeout("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
        Accept: "application/json",
      },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: conn.refresh_token }),
    });
    if (!tokenRes.ok) throw new Error(`Token refresh failed [${tokenRes.status}]`);
    const tokens = await tokenRes.json();
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
    await admin.from("qbo_connection").update({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_expires_at: expiresAt,
    }).eq("realm_id", realmId);
    return tokens.access_token;
  }
  return conn.access_token;
}

// ────────────────────────────────────────────────────────────
// Entity fetch + land helpers
// ────────────────────────────────────────────────────────────

type LandingTable = "landing_raw_qbo_purchase" | "landing_raw_qbo_sales_receipt" | "landing_raw_qbo_refund_receipt" | "landing_raw_qbo_customer" | "landing_raw_qbo_item" | "landing_raw_qbo_vendor";

interface LandMetadata {
  cloudEventId?: string;
  eventTime?: string;
}

async function landEntity(admin: any, table: LandingTable, externalId: string, rawPayload: any, correlationId: string, operation: string, meta?: LandMetadata): Promise<string> {
  const effectivePayload = operation === "Delete" ? { _deleted: true, _entity_id: externalId } : rawPayload;

  // Skip upsert when existing record is already committed and payload hasn't changed
  const { data: existing } = await admin.from(table)
    .select("id, status, raw_payload")
    .eq("external_id", externalId)
    .maybeSingle();

  if (existing?.status === "committed" && operation !== "Delete") {
    // Compare payload hash to avoid resetting committed records
    const existingHash = JSON.stringify(existing.raw_payload);
    const newHash = JSON.stringify(effectivePayload);
    if (existingHash === newHash) {
      return "skipped — payload unchanged";
    }
  }

  const row: Record<string, any> = {
    external_id: externalId,
    raw_payload: effectivePayload,
    status: "pending",
    processed_at: null,
    error_message: null,
    correlation_id: correlationId,
    received_at: new Date().toISOString(),
  };

  // Add CloudEvents metadata if the table supports it
  if (meta?.cloudEventId) row.cloud_event_id = meta.cloudEventId;
  if (meta?.eventTime) row.event_time = meta.eventTime;

  const { error } = await admin.from(table).upsert(row, { onConflict: "external_id" });
  return error ? `land error: ${error.message}` : (operation === "Delete" ? "landed delete tombstone" : "landed");
}

async function fetchQboEntity(baseUrl: string, accessToken: string, entityPath: string): Promise<any | null> {
  const res = await fetch(`${baseUrl}/${entityPath}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (!res.ok) {
    console.error(`QBO fetch ${entityPath} failed [${res.status}]: ${await res.text()}`);
    return null;
  }
  return await res.json();
}

async function landReferencedItems(admin: any, baseUrl: string, accessToken: string, lines: any[], correlationId: string, meta?: LandMetadata): Promise<void> {
  const uniqueItemIds = new Set<string>();
  for (const line of (lines ?? [])) {
    if (line.DetailType === "SalesItemLineDetail" && line.SalesItemLineDetail?.ItemRef?.value)
      uniqueItemIds.add(String(line.SalesItemLineDetail.ItemRef.value));
    if (line.DetailType === "ItemBasedExpenseLineDetail" && line.ItemBasedExpenseLineDetail?.ItemRef?.value)
      uniqueItemIds.add(String(line.ItemBasedExpenseLineDetail.ItemRef.value));
  }
  for (const itemId of uniqueItemIds) {
    const data = await fetchQboEntity(baseUrl, accessToken, `item/${itemId}`);
    const item = data?.Item ?? null;
    if (!item) continue;
    await landEntity(admin, "landing_raw_qbo_item", String(item.Id), item, correlationId, "Create", meta);
  }
}

// ────────────────────────────────────────────────────────────
// Entity handlers
// ────────────────────────────────────────────────────────────

type EntityHandler = (admin: any, baseUrl: string, accessToken: string, entityId: string, operation: string, correlationId: string, meta?: LandMetadata) => Promise<string>;

async function handlePurchase(admin: any, baseUrl: string, accessToken: string, entityId: string, operation: string, correlationId: string, meta?: LandMetadata): Promise<string> {
  if (operation === "Delete") return await landEntity(admin, "landing_raw_qbo_purchase", entityId, null, correlationId, operation, meta);
  const data = await fetchQboEntity(baseUrl, accessToken, `purchase/${entityId}`);
  const purchase = data?.Purchase;
  if (!purchase) return "could not fetch purchase from QBO";
  await landReferencedItems(admin, baseUrl, accessToken, purchase.Line ?? [], correlationId, meta);
  return await landEntity(admin, "landing_raw_qbo_purchase", entityId, purchase, correlationId, operation, meta);
}

async function handleSalesReceipt(admin: any, baseUrl: string, accessToken: string, entityId: string, operation: string, correlationId: string, meta?: LandMetadata): Promise<string> {
  if (operation === "Delete") return await landEntity(admin, "landing_raw_qbo_sales_receipt", entityId, null, correlationId, operation, meta);
  const data = await fetchQboEntity(baseUrl, accessToken, `salesreceipt/${entityId}`);
  const receipt = data?.SalesReceipt;
  if (!receipt) return "could not fetch SalesReceipt from QBO";
  await landReferencedItems(admin, baseUrl, accessToken, receipt.Line ?? [], correlationId, meta);
  return await landEntity(admin, "landing_raw_qbo_sales_receipt", String(receipt.Id), receipt, correlationId, operation, meta);
}

async function handleRefundReceipt(admin: any, baseUrl: string, accessToken: string, entityId: string, operation: string, correlationId: string, meta?: LandMetadata): Promise<string> {
  if (operation === "Delete") return await landEntity(admin, "landing_raw_qbo_refund_receipt", entityId, null, correlationId, operation, meta);
  const data = await fetchQboEntity(baseUrl, accessToken, `refundreceipt/${entityId}`);
  const receipt = data?.RefundReceipt;
  if (!receipt) return "could not fetch RefundReceipt from QBO";
  await landReferencedItems(admin, baseUrl, accessToken, receipt.Line ?? [], correlationId, meta);
  return await landEntity(admin, "landing_raw_qbo_refund_receipt", String(receipt.Id), receipt, correlationId, operation, meta);
}

async function handleCustomer(admin: any, baseUrl: string, accessToken: string, entityId: string, operation: string, correlationId: string, meta?: LandMetadata): Promise<string> {
  if (operation === "Delete") return await landEntity(admin, "landing_raw_qbo_customer", entityId, null, correlationId, operation, meta);
  const data = await fetchQboEntity(baseUrl, accessToken, `customer/${entityId}`);
  const customer = data?.Customer;
  if (!customer) return "could not fetch customer from QBO";
  return await landEntity(admin, "landing_raw_qbo_customer", String(customer.Id), customer, correlationId, operation, meta);
}

async function handleItem(admin: any, baseUrl: string, accessToken: string, entityId: string, operation: string, correlationId: string, meta?: LandMetadata): Promise<string> {
  if (operation === "Delete") return await landEntity(admin, "landing_raw_qbo_item", entityId, null, correlationId, operation, meta);
  const res = await fetch(`${baseUrl}/item/${entityId}?minorversion=65`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (!res.ok) return `QBO Item fetch failed [${res.status}]`;
  const data = await res.json();
  const item = data?.Item;
  if (!item) return `item ${entityId} — not found`;
  return await landEntity(admin, "landing_raw_qbo_item", String(item.Id), item, correlationId, operation, meta);
}

async function handleVendor(admin: any, baseUrl: string, accessToken: string, entityId: string, operation: string, correlationId: string, meta?: LandMetadata): Promise<string> {
  if (operation === "Delete") return await landEntity(admin, "landing_raw_qbo_vendor", entityId, null, correlationId, operation, meta);
  const data = await fetchQboEntity(baseUrl, accessToken, `vendor/${entityId}`);
  const vendor = data?.Vendor;
  if (!vendor) return "could not fetch vendor from QBO";
  return await landEntity(admin, "landing_raw_qbo_vendor", String(vendor.Id), vendor, correlationId, operation, meta);
}

const ENTITY_HANDLERS: Record<string, EntityHandler> = {
  Purchase: handlePurchase,
  SalesReceipt: handleSalesReceipt,
  RefundReceipt: handleRefundReceipt,
  Customer: handleCustomer,
  Item: handleItem,
  Vendor: handleVendor,
};

// ────────────────────────────────────────────────────────────
// CloudEvents v1.0 parsing
// ────────────────────────────────────────────────────────────

// Maps CloudEvents type strings like "qbo.customer.created.v1" to entity + operation
const CE_TYPE_MAP: Record<string, { entity: string; operation: string }> = {};

// Build map dynamically for all entity/operation combos
for (const entity of ["customer", "purchase", "salesreceipt", "refundreceipt", "item", "vendor"]) {
  const entityName = {
    customer: "Customer",
    purchase: "Purchase",
    salesreceipt: "SalesReceipt",
    refundreceipt: "RefundReceipt",
    item: "Item",
    vendor: "Vendor",
  }[entity]!;

  for (const [ceOp, appOp] of [["created", "Create"], ["updated", "Update"], ["deleted", "Delete"], ["merged", "Merge"]]) {
    CE_TYPE_MAP[`qbo.${entity}.${ceOp}.v1`] = { entity: entityName, operation: appOp };
  }
}

interface NormalizedEvent {
  realmId: string;
  entityName: string;
  entityId: string;
  operation: string;
  cloudEventId?: string;
  eventTime?: string;
}

function parseCloudEvents(payload: any[]): NormalizedEvent[] {
  const events: NormalizedEvent[] = [];
  for (const ce of payload) {
    const ceType = ce.type ?? ce.eventtype ?? "";
    const mapped = CE_TYPE_MAP[ceType.toLowerCase()];
    if (!mapped) continue;

    const realmId = ce.data?.intuitaccountid ?? ce.intuitaccountid ?? "";
    const entityId = ce.data?.intuitentityid ?? ce.intuitentityid ?? "";
    if (!realmId || !entityId) continue;

    events.push({
      realmId: String(realmId),
      entityName: mapped.entity,
      entityId: String(entityId),
      operation: mapped.operation,
      cloudEventId: ce.id,
      eventTime: ce.time,
    });
  }
  return events;
}

function parseLegacyPayload(payload: any): NormalizedEvent[] {
  const events: NormalizedEvent[] = [];
  const notifications = payload?.eventNotifications ?? [];
  for (const notification of notifications) {
    const realmId = notification.realmId;
    if (!realmId) continue;
    for (const entity of (notification.dataChangeEvent?.entities ?? [])) {
      events.push({
        realmId: String(realmId),
        entityName: entity.name,
        entityId: String(entity.id),
        operation: entity.operation ?? "Create",
      });
    }
  }
  return events;
}

// ────────────────────────────────────────────────────────────
// Background processing — runs after 200 is returned
// ────────────────────────────────────────────────────────────

async function processWebhookInBackground(body: string, correlationId: string) {
  const log = makeLogger(correlationId);

  let payload: any;
  try {
    payload = JSON.parse(body);
  } catch {
    log.error("Failed to parse webhook body");
    return;
  }

  // Detect format: CloudEvents (array) vs legacy (object with eventNotifications)
  let events: NormalizedEvent[];
  if (Array.isArray(payload)) {
    events = parseCloudEvents(payload);
    log.info("Parsed CloudEvents format", { event_count: events.length });
  } else {
    events = parseLegacyPayload(payload);
    log.info("Parsed legacy format", { event_count: events.length });
  }

  if (events.length === 0) {
    log.warn("No actionable events found in payload");
    return;
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const clientId = Deno.env.get("QBO_CLIENT_ID")!;
  const clientSecret = Deno.env.get("QBO_CLIENT_SECRET")!;
  const admin = createClient(supabaseUrl, serviceRoleKey);

  // Group events by realmId to share token
  const byRealm = new Map<string, NormalizedEvent[]>();
  for (const ev of events) {
    const list = byRealm.get(ev.realmId) ?? [];
    list.push(ev);
    byRealm.set(ev.realmId, list);
  }

  for (const [realmId, realmEvents] of byRealm) {
    let accessToken: string;
    try {
      accessToken = await ensureValidToken(admin, realmId, clientId, clientSecret);
    } catch (err: any) {
      log.error("Token refresh failed", { realm_id: realmId, error: err.message });
      continue;
    }

    const baseUrl = `https://quickbooks.api.intuit.com/v3/company/${realmId}`;

    for (const ev of realmEvents) {
      const handler = ENTITY_HANDLERS[ev.entityName];
      if (!handler) {
        log.info("Ignoring unhandled entity type", { entity_name: ev.entityName, entity_id: ev.entityId });
        continue;
      }

      const meta: LandMetadata = {
        cloudEventId: ev.cloudEventId,
        eventTime: ev.eventTime,
      };

      try {
        const result = await handler(admin, baseUrl, accessToken, ev.entityId, ev.operation, correlationId, meta);
        log.info("Entity landed", { entity_name: ev.entityName, entity_id: ev.entityId, operation: ev.operation, result });
      } catch (err: any) {
        log.error("Entity landing failed", { entity_name: ev.entityName, entity_id: ev.entityId, operation: ev.operation, error: err.message });
      }
    }
  }

  // Auto-trigger processor with retry loop to drain all pending records.
  // Use a fresh AbortController scoped to the background task with a generous
  // timeout — the request-scoped fetchWithTimeout helper races with isolate
  // teardown after the response is returned and gets aborted prematurely.
  const maxAttempts = 3;
  const PROCESSOR_TIMEOUT_MS = 120_000;
  await new Promise(r => setTimeout(r, 3000)); // let concurrent webhooks finish landing

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROCESSOR_TIMEOUT_MS);
    try {
      const processUrl = `${supabaseUrl}/functions/v1/qbo-process-pending`;
      const processRes = await fetch(processUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceRoleKey}`,
          "x-webhook-trigger": "true",
        },
        body: JSON.stringify({ batch_size: 50 }),
        signal: controller.signal,
      });
      const result = await processRes.json();
      log.info("Processor attempt completed", {
        attempt,
        status: processRes.status,
        total_remaining: result.total_remaining ?? 0,
      });

      if (!result.has_more || (result.total_remaining ?? 0) === 0) break;

      // More records pending — wait and retry
      await new Promise(r => setTimeout(r, 2000));
    } catch (err: any) {
      log.warn("Processor attempt failed (non-fatal)", { attempt, error: err.message });
      break;
    } finally {
      clearTimeout(timer);
    }
  }

  log.info("Background processing complete");
}

// ────────────────────────────────────────────────────────────
// Main handler
// ────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method === "GET") {
    return new Response("OK", { status: 200, headers: { ...corsHeaders, "Content-Type": "text/plain" } });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  const verifierToken = Deno.env.get("QBO_WEBHOOK_VERIFIER");
  if (!verifierToken) {
    console.error("QBO_WEBHOOK_VERIFIER secret not configured");
    return new Response("Server misconfigured", { status: 500, headers: corsHeaders });
  }

  const body = await req.text();
  const signature = req.headers.get("intuit-signature") ?? "";

  const valid = await verifySignature(body, signature, verifierToken);
  if (!valid) {
    console.warn("Invalid webhook signature");
    return new Response("Invalid signature", { status: 401, headers: corsHeaders });
  }

  const correlationId = crypto.randomUUID();

  const bgPromise = processWebhookInBackground(body, correlationId);

  if (typeof (globalThis as any).EdgeRuntime !== "undefined" && (globalThis as any).EdgeRuntime.waitUntil) {
    (globalThis as any).EdgeRuntime.waitUntil(bgPromise);
  } else {
    bgPromise.catch((err) => console.error("Background processing error:", err));
  }

  return new Response("OK", { status: 200, headers: corsHeaders });
});
