// Redeployed: 2026-XX-XX — CloudEvents v1.0 migration
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";

/**
 * QBO Webhook Receiver — CloudEvents v1.0
 *
 * Receives POST from Intuit in CloudEvents format (flat array of events),
 * verifies HMAC signature, responds 200 immediately, then fetches full
 * entity data from QBO and lands it into staging tables via
 * EdgeRuntime.waitUntil.
 *
 * Echo suppression: checks qbo_outbound_queue to skip webhook events
 * triggered by our own outbound pushes (prevents infinite sync loops).
 *
 * Intuit migration deadline: 15 May 2026.
 */

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
// Entity fetch + land helpers (used in background processing)
// ────────────────────────────────────────────────────────────

type LandingTable = "landing_raw_qbo_purchase" | "landing_raw_qbo_sales_receipt" | "landing_raw_qbo_refund_receipt" | "landing_raw_qbo_customer" | "landing_raw_qbo_item";

async function landEntity(
  admin: any, table: LandingTable, externalId: string,
  rawPayload: any, correlationId: string, operation: string,
  cloudEventId?: string, eventTime?: string,
): Promise<string> {
  const row: Record<string, any> = {
    external_id: externalId,
    raw_payload: operation === "Delete" ? { _deleted: true, _entity_id: externalId } : rawPayload,
    status: "pending",
    processed_at: null,
    correlation_id: correlationId,
    received_at: new Date().toISOString(),
  };
  if (cloudEventId) row.cloud_event_id = cloudEventId;
  if (eventTime) row.event_time = eventTime;
  const { error } = await admin.from(table).upsert(row, { onConflict: "external_id" });
  return error ? `land error: ${error.message}` : `landed`;
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

async function landReferencedItems(admin: any, baseUrl: string, accessToken: string, lines: any[], correlationId: string): Promise<void> {
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
    await landEntity(admin, "landing_raw_qbo_item", String(item.Id), item, correlationId, "Create");
  }
}

// ────────────────────────────────────────────────────────────
// CloudEvents v1.0 types and parser
// ────────────────────────────────────────────────────────────

interface CloudEvent {
  specversion: string;
  id: string;           // event UUID — dedup key
  source: string;
  type: string;         // e.g. "qbo.customer.created.v1"
  datacontenttype: string;
  time: string;         // ISO 8601 — echo detection timestamp
  intuitentityid: string;
  intuitaccountid: string;
  data: Record<string, unknown>;
}

function parseEventType(type: string): { entityName: string; operation: string } | null {
  // "qbo.customer.created.v1" → { entityName: "Customer", operation: "Create" }
  const match = type.match(/^qbo\.(\w+)\.(created|updated|deleted|merged|voided)\.v\d+$/);
  if (!match) return null;
  const entityMap: Record<string, string> = {
    customer: "Customer", item: "Item", purchase: "Purchase",
    salesreceipt: "SalesReceipt", refundreceipt: "RefundReceipt",
    vendor: "Vendor", deposit: "Deposit",
  };
  const operationMap: Record<string, string> = {
    created: "Create", updated: "Update", deleted: "Delete",
    merged: "Merge", voided: "Void",
  };
  return {
    entityName: entityMap[match[1]] ?? match[1],
    operation: operationMap[match[2]] ?? match[2],
  };
}

// ────────────────────────────────────────────────────────────
// Entity handlers
// ────────────────────────────────────────────────────────────

type EntityHandler = (
  admin: any, baseUrl: string, accessToken: string,
  entityId: string, operation: string, correlationId: string,
  cloudEventId?: string, eventTime?: string,
) => Promise<string>;

async function handlePurchase(admin: any, baseUrl: string, accessToken: string, entityId: string, operation: string, correlationId: string, cloudEventId?: string, eventTime?: string): Promise<string> {
  if (operation === "Delete") return await landEntity(admin, "landing_raw_qbo_purchase", entityId, null, correlationId, operation, cloudEventId, eventTime);
  const data = await fetchQboEntity(baseUrl, accessToken, `purchase/${entityId}`);
  const purchase = data?.Purchase;
  if (!purchase) return "could not fetch purchase from QBO";
  await landReferencedItems(admin, baseUrl, accessToken, purchase.Line ?? [], correlationId);
  return await landEntity(admin, "landing_raw_qbo_purchase", entityId, purchase, correlationId, operation, cloudEventId, eventTime);
}

async function handleSalesReceipt(admin: any, baseUrl: string, accessToken: string, entityId: string, operation: string, correlationId: string, cloudEventId?: string, eventTime?: string): Promise<string> {
  if (operation === "Delete") return await landEntity(admin, "landing_raw_qbo_sales_receipt", entityId, null, correlationId, operation, cloudEventId, eventTime);
  const data = await fetchQboEntity(baseUrl, accessToken, `salesreceipt/${entityId}`);
  const receipt = data?.SalesReceipt;
  if (!receipt) return "could not fetch SalesReceipt from QBO";
  await landReferencedItems(admin, baseUrl, accessToken, receipt.Line ?? [], correlationId);
  return await landEntity(admin, "landing_raw_qbo_sales_receipt", String(receipt.Id), receipt, correlationId, operation, cloudEventId, eventTime);
}

async function handleRefundReceipt(admin: any, baseUrl: string, accessToken: string, entityId: string, operation: string, correlationId: string, cloudEventId?: string, eventTime?: string): Promise<string> {
  if (operation === "Delete") return await landEntity(admin, "landing_raw_qbo_refund_receipt", entityId, null, correlationId, operation, cloudEventId, eventTime);
  const data = await fetchQboEntity(baseUrl, accessToken, `refundreceipt/${entityId}`);
  const receipt = data?.RefundReceipt;
  if (!receipt) return "could not fetch RefundReceipt from QBO";
  await landReferencedItems(admin, baseUrl, accessToken, receipt.Line ?? [], correlationId);
  return await landEntity(admin, "landing_raw_qbo_refund_receipt", String(receipt.Id), receipt, correlationId, operation, cloudEventId, eventTime);
}

async function handleCustomer(admin: any, baseUrl: string, accessToken: string, entityId: string, operation: string, correlationId: string, cloudEventId?: string, eventTime?: string): Promise<string> {
  if (operation === "Delete") return await landEntity(admin, "landing_raw_qbo_customer", entityId, null, correlationId, operation, cloudEventId, eventTime);
  const data = await fetchQboEntity(baseUrl, accessToken, `customer/${entityId}`);
  const customer = data?.Customer;
  if (!customer) return "could not fetch customer from QBO";
  return await landEntity(admin, "landing_raw_qbo_customer", String(customer.Id), customer, correlationId, operation, cloudEventId, eventTime);
}

async function handleItem(admin: any, baseUrl: string, accessToken: string, entityId: string, operation: string, correlationId: string, cloudEventId?: string, eventTime?: string): Promise<string> {
  if (operation === "Delete") return await landEntity(admin, "landing_raw_qbo_item", entityId, null, correlationId, operation, cloudEventId, eventTime);
  const res = await fetch(`${baseUrl}/item/${entityId}?minorversion=65`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (!res.ok) return `QBO Item fetch failed [${res.status}]`;
  const data = await res.json();
  const item = data?.Item;
  if (!item) return `item ${entityId} — not found`;
  return await landEntity(admin, "landing_raw_qbo_item", String(item.Id), item, correlationId, operation, cloudEventId, eventTime);
}

const ENTITY_HANDLERS: Record<string, EntityHandler> = {
  Purchase: handlePurchase,
  SalesReceipt: handleSalesReceipt,
  RefundReceipt: handleRefundReceipt,
  Customer: handleCustomer,
  Item: handleItem,
};

// ────────────────────────────────────────────────────────────
// Background processing — runs after 200 is returned
// ────────────────────────────────────────────────────────────

async function processWebhookInBackground(body: string, correlationId: string) {
  const log = makeLogger(correlationId);

  let events: CloudEvent[];
  try {
    const parsed = JSON.parse(body);
    events = Array.isArray(parsed) ? parsed : [];
  } catch {
    log.error("Failed to parse webhook body");
    return;
  }

  if (events.length === 0) return;

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const clientId = Deno.env.get("QBO_CLIENT_ID")!;
  const clientSecret = Deno.env.get("QBO_CLIENT_SECRET")!;
  const admin = createClient(supabaseUrl, serviceRoleKey);

  // Group events by realm (intuitaccountid) for token efficiency
  const byRealm = new Map<string, CloudEvent[]>();
  for (const event of events) {
    const realm = event.intuitaccountid;
    if (!realm) continue;
    if (!byRealm.has(realm)) byRealm.set(realm, []);
    byRealm.get(realm)!.push(event);
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

    for (const event of realmEvents) {
      const parsed = parseEventType(event.type);
      if (!parsed) {
        log.info("Ignoring unknown event type", { type: event.type });
        continue;
      }

      const { entityName, operation } = parsed;
      const entityId = event.intuitentityid;

      // Echo suppression: skip events that match a recent outbound push
      const { data: recentPush } = await admin
        .from("qbo_outbound_queue")
        .select("pushed_at")
        .eq("entity_type", entityName.toLowerCase())
        .eq("entity_id_external", entityId)
        .eq("status", "pushed")
        .order("pushed_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (recentPush?.pushed_at) {
        const pushTime = new Date(recentPush.pushed_at).getTime();
        const eventTime = new Date(event.time).getTime();
        if (Math.abs(eventTime - pushTime) < 10_000) {
          log.info("Echo suppressed", {
            entity: entityName, id: entityId,
            event_time: event.time, pushed_at: recentPush.pushed_at,
          });
          continue;
        }
      }

      // Delegate to existing entity handlers
      const handler = ENTITY_HANDLERS[entityName];
      if (!handler) {
        log.info("Ignoring unhandled entity type", { entity_name: entityName });
        continue;
      }

      try {
        const result = await handler(
          admin, baseUrl, accessToken, entityId, operation, correlationId,
          event.id, event.time,
        );
        log.info("Entity landed", {
          entity_name: entityName, entity_id: entityId,
          operation, cloud_event_id: event.id, result,
        });
      } catch (err: any) {
        log.error("Entity landing failed", {
          entity_name: entityName, entity_id: entityId,
          operation, error: err.message,
        });
      }
    }
  }

  log.info("Background processing complete");
}

// ────────────────────────────────────────────────────────────
// Main handler — responds 200 IMMEDIATELY, processes in background
// ────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // QBO sends GET for validation during webhook registration
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

  // Signature verification — must happen before responding
  const valid = await verifySignature(body, signature, verifierToken);
  if (!valid) {
    console.warn("Invalid webhook signature");
    return new Response("Invalid signature", { status: 401, headers: corsHeaders });
  }

  // Generate correlation ID for tracing
  const correlationId = crypto.randomUUID();

  // Schedule background processing using EdgeRuntime.waitUntil
  // This allows us to respond 200 immediately while processing continues
  const bgPromise = processWebhookInBackground(body, correlationId);

  // Use EdgeRuntime.waitUntil if available (Deno Deploy / Supabase Edge Functions)
  // This keeps the function alive after the response is sent
  if (typeof (globalThis as any).EdgeRuntime !== "undefined" && (globalThis as any).EdgeRuntime.waitUntil) {
    (globalThis as any).EdgeRuntime.waitUntil(bgPromise);
  } else {
    // Fallback: fire-and-forget with catch to prevent unhandled rejection
    bgPromise.catch((err) => console.error("Background processing error:", err));
  }

  // Respond 200 IMMEDIATELY — Intuit requires fast acknowledgment
  return new Response("OK", { status: 200, headers: corsHeaders });
});
