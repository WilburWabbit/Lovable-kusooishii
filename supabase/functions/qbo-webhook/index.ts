import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * QBO Webhook Receiver
 *
 * Intuit sends POST notifications when entities change.
 * We validate the HMAC-SHA256 signature, log to audit_event,
 * then trigger the appropriate sync functions.
 *
 * Watched entities: Purchase, SalesReceipt, RefundReceipt, Customer, Item
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, intuit-signature, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Map QBO entity types to the edge function that handles them
const ENTITY_TO_FUNCTION: Record<string, string> = {
  Purchase: "qbo-sync-purchases",
  SalesReceipt: "qbo-sync-sales",
  RefundReceipt: "qbo-sync-sales",
  Customer: "qbo-sync-customers",
  Item: "qbo-sync-tax-rates", // Item changes may affect SKU mappings; tax-rates is lightweight
};

async function verifySignature(
  body: string,
  signature: string,
  verifierToken: string
): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(verifierToken),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  const computed = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return computed === signature;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // QBO sends GET for validation during webhook registration
  if (req.method === "GET") {
    return new Response("OK", {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "text/plain" },
    });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  const verifierToken = Deno.env.get("QBO_WEBHOOK_VERIFIER");
  if (!verifierToken) {
    console.error("QBO_WEBHOOK_VERIFIER secret not configured");
    return new Response("Server misconfigured", { status: 500, headers: corsHeaders });
  }

  const rawBody = await req.text();

  // ─── Signature verification ───
  const intuitSignature = req.headers.get("intuit-signature");
  if (!intuitSignature) {
    console.warn("Missing intuit-signature header");
    return new Response("Missing signature", { status: 401, headers: corsHeaders });
  }

  const valid = await verifySignature(rawBody, intuitSignature, verifierToken);
  if (!valid) {
    console.warn("Invalid webhook signature");
    return new Response("Invalid signature", { status: 401, headers: corsHeaders });
  }

  // ─── Parse payload ───
  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("Invalid JSON", { status: 400, headers: corsHeaders });
  }

  console.log("QBO webhook received:", JSON.stringify(payload).slice(0, 500));

  const notifications = payload.eventNotifications || [];

  // ─── Respond immediately (QBO requires fast 200) then process async ───
  const processAsync = async () => {
    if (!notifications.length) {
      console.log("No notifications to process");
      return;
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    // Collect unique sync functions to call
    const functionsToCall = new Set<string>();
    const entityChanges: Array<{ name: string; id: string; operation: string }> = [];

    for (const notification of notifications) {
      const entities = notification.dataChangeEvent?.entities || [];
      for (const entity of entities) {
        const fn = ENTITY_TO_FUNCTION[entity.name];
        if (fn) {
          functionsToCall.add(fn);
          entityChanges.push({
            name: entity.name,
            id: String(entity.id),
            operation: entity.operation,
          });
          console.log(
            `Entity changed: ${entity.name} id=${entity.id} operation=${entity.operation} → ${fn}`
          );
        } else {
          console.log(`Ignoring entity type: ${entity.name}`);
        }
      }
    }

    // ─── Log to audit_event ───
    try {
      await supabaseAdmin.from("audit_event").insert({
        entity_type: "qbo_webhook",
        entity_id: "00000000-0000-0000-0000-000000000000",
        trigger_type: "webhook",
        actor_type: "system",
        source_system: "qbo",
        input_json: { notifications_count: notifications.length, entities: entityChanges },
        output_json: { functions_triggered: Array.from(functionsToCall) },
      });
    } catch (auditErr: any) {
      console.error("Failed to log audit event:", auditErr.message);
    }

    // ─── Trigger each sync function ───
    for (const fnName of functionsToCall) {
      console.log(`Triggering ${fnName} via webhook`);
      try {
        const syncUrl = `${supabaseUrl}/functions/v1/${fnName}`;
        const res = await fetch(syncUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${serviceRoleKey}`,
            "Content-Type": "application/json",
            "x-webhook-trigger": "true",
          },
          body: JSON.stringify({}),
        });
        const result = await res.json();
        console.log(`${fnName} result:`, JSON.stringify(result).slice(0, 300));
      } catch (err: any) {
        console.error(`${fnName} failed:`, err.message);
      }
    }
  };

  // Fire-and-forget
  processAsync().catch((err) => console.error("Async webhook processing failed:", err));

  return new Response(
    JSON.stringify({ ok: true, received: notifications.length }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
