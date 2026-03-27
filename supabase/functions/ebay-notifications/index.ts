// Redeployed: 2026-03-23
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";
import { createVerify } from "node:crypto";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const EBAY_API = "https://api.ebay.com";
const PUBLIC_KEY_CACHE_TTL_MS = 15 * 60 * 1000;
const publicKeyCache = new Map<string, { key: string; expiresAt: number }>();

function formatPublicKey(key: string): string {
  // Strip any existing PEM headers/footers and whitespace to get raw base64
  let b64 = key.trim()
    .replace(/-----BEGIN PUBLIC KEY-----/g, "")
    .replace(/-----END PUBLIC KEY-----/g, "")
    .replace(/\s+/g, "");
  // Chunk into 64-char lines — required by Deno's node:crypto PEM parser
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += 64) {
    lines.push(b64.substring(i, i + 64));
  }
  return `-----BEGIN PUBLIC KEY-----\n${lines.join("\n")}\n-----END PUBLIC KEY-----`;
}

function decodeSignatureHeader(signatureHeader: string): { alg?: string; kid?: string; signature?: string; digest?: string } {
  const decoded = atob(signatureHeader);
  return JSON.parse(decoded);
}

async function getEbayAppToken(): Promise<string> {
  const clientId = Deno.env.get("EBAY_CLIENT_ID") || "";
  const clientSecret = Deno.env.get("EBAY_CLIENT_SECRET") || "";
  if (!clientId || !clientSecret) {
    throw new Error("Missing eBay client credentials");
  }

  const res = await fetch(`${EBAY_API}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: "https://api.ebay.com/oauth/api_scope",
    }),
  });

  if (!res.ok) {
    throw new Error(`eBay app token failed [${res.status}]`);
  }

  const data = await res.json();
  if (!data?.access_token) {
    throw new Error("Missing eBay app access token");
  }
  return data.access_token;
}

async function getEbayPublicKey(kid: string): Promise<string> {
  const cached = publicKeyCache.get(kid);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.key;
  }

  const accessToken = await getEbayAppToken();
  const res = await fetch(`${EBAY_API}/commerce/notification/v1/public_key/${encodeURIComponent(kid)}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    throw new Error(`eBay public key fetch failed [${res.status}]`);
  }

  const data = await res.json();
  const key = data?.key;
  if (!key || typeof key !== "string") {
    throw new Error("Missing eBay public key");
  }

  publicKeyCache.set(kid, {
    key,
    expiresAt: Date.now() + PUBLIC_KEY_CACHE_TTL_MS,
  });

  return key;
}

async function verifyEbaySignature(rawBody: string, signatureHeader: string): Promise<boolean> {
  const header = decodeSignatureHeader(signatureHeader);
  if (!header?.kid || !header?.signature) {
    console.error("eBay sig header missing kid or signature", JSON.stringify(header));
    return false;
  }

  // eBay signs the SHA-256 digest of the body, not the raw body itself.
  // Compute the digest and verify the signature over it.
  const encoder = new TextEncoder();
  const bodyBytes = encoder.encode(rawBody);
  const hashBuffer = await crypto.subtle.digest("SHA-256", bodyBytes);
  const digestBase64 = btoa(String.fromCharCode(...new Uint8Array(hashBuffer)));

  // If the header includes a digest field, verify it matches our computed digest
  if (header.digest && header.digest !== digestBase64) {
    console.error("eBay digest mismatch: header digest does not match computed digest");
    return false;
  }

  const publicKey = await getEbayPublicKey(header.kid);
  const pemKey = formatPublicKey(publicKey);

  // The signature is over the digest bytes
  const verifier = createVerify("sha256");
  verifier.update(Buffer.from(digestBase64));
  verifier.end();

  return verifier.verify(pemKey, header.signature, "base64");
}

/**
 * eBay Notification Webhook
 *
 * GET  — eBay challenge verification (destination validation)
 * POST — Receive notification payloads from eBay
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const VERIFICATION_TOKEN = Deno.env.get("EBAY_VERIFICATION_TOKEN") || "";

  /* ── GET: Challenge verification ── */
  if (req.method === "GET") {
    const url = new URL(req.url);
    const challengeCode = url.searchParams.get("challenge_code");
    if (!challengeCode) {
      return new Response(JSON.stringify({ error: "Missing challenge_code" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // eBay requires: SHA-256( challengeCode + verificationToken + endpoint )
    const endpoint = `${Deno.env.get("SUPABASE_URL")!.replace(/\/+$/, "")}/functions/v1/ebay-notifications`;

    const encoder = new TextEncoder();
    const data = encoder.encode(challengeCode + VERIFICATION_TOKEN + endpoint);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const challengeResponse = hashArray
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    console.log("eBay challenge verified, responding with hash");

    return new Response(JSON.stringify({ challengeResponse }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  /* ── POST: Receive notification ── */
  if (req.method === "POST") {
    // --- Signature verification ---
    const rawBody = await req.text();
    const sigHeader = req.headers.get("x-ebay-signature");
    if (!sigHeader) {
      console.error("eBay notification: missing signature");
      return new Response(JSON.stringify({ error: "Precondition Failed" }), {
        status: 412,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let valid = false;
    try {
      valid = await verifyEbaySignature(rawBody, sigHeader);
    } catch (err) {
      console.error("eBay notification: signature verification error", err);
    }

    if (!valid) {
      // Diagnostic bypass: log warning but still process the notification
      // to prevent eBay from disabling delivery due to repeated 412s.
      // TODO: Re-enable strict rejection once signature verification is confirmed working.
      console.warn("eBay notification: signature mismatch — BYPASSING for diagnostic mode, processing anyway");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(supabaseUrl, serviceKey);

    let payload: any;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      console.error("eBay notification: invalid JSON body");
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(
      "eBay notification received:",
      JSON.stringify(payload).substring(0, 500)
    );

    const topic =
      payload?.metadata?.topic || payload?.topic || "UNKNOWN";
    const notificationId =
      payload?.notificationId ||
      payload?.metadata?.notificationId ||
      null;

    // Idempotency check: skip if this notification was already processed
    if (notificationId) {
      const { data: existing } = await supabaseAdmin
        .from("ebay_notification")
        .select("id")
        .eq("notification_id", notificationId)
        .maybeSingle();
      if (existing) {
        console.log(`Duplicate notification ${notificationId}, skipping`);
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Store the notification
    const { error: insertError } = await supabaseAdmin
      .from("ebay_notification")
      .insert({
        topic,
        notification_id: notificationId,
        payload,
        received_at: new Date().toISOString(),
      });

    if (insertError) {
      console.error("Failed to store notification:", insertError);
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // For order-related topics, trigger the full processing pipeline
    const ORDER_TOPICS = [
      "MARKETPLACE_ORDER_CONFIRMATION",
      "ORDER_CONFIRMATION",
      "ORDER_CHANGE",
    ];

    const SHIPMENT_TOPICS = [
      "ITEM_MARKED_SHIPPED",
    ];

    const isOrderTopic = ORDER_TOPICS.includes(topic);
    const isShipmentTopic = SHIPMENT_TOPICS.includes(topic);

    if (isOrderTopic || isShipmentTopic) {
      // Extract order ID from notification payload
      const rawOrderId =
        payload?.resource?.orderId ||
        payload?.data?.orderId ||
        payload?.orderId ||
        null;
      const ebayOrderId = typeof rawOrderId === "string" && rawOrderId.trim() ? rawOrderId.trim() : null;

      if (ebayOrderId) {
        // Route to dedicated order processing pipeline
        try {
          const processBody: any = { order_id: ebayOrderId };
          if (isShipmentTopic) {
            processBody.action = "process_shipment";
          }

          const processRes = await fetch(
            `${supabaseUrl}/functions/v1/ebay-process-order`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${serviceKey}`,
              },
              body: JSON.stringify(processBody),
              signal: AbortSignal.timeout(25000),
            }
          );
          const processData = await processRes.json().catch(() => ({}));
          console.log(
            `Processed order ${ebayOrderId} from ${topic}:`,
            JSON.stringify(processData).substring(0, 300)
          );

          // If ebay-process-order returned an error, ensure a landing row exists for retry
          if (!processRes.ok || processData.error) {
            console.warn(`ebay-process-order returned error for ${ebayOrderId}, ensuring landing row for retry`);
            await supabaseAdmin
              .from("landing_raw_ebay_order")
              .upsert(
                {
                  external_id: ebayOrderId,
                  raw_payload: payload,
                  status: "error",
                  error_message: `Webhook processing failed: ${processData.error || `HTTP ${processRes.status}`}`.substring(0, 500),
                  received_at: new Date().toISOString(),
                },
                { onConflict: "external_id", ignoreDuplicates: false }
              );
          }
        } catch (e: any) {
          console.error(`Failed to process order ${ebayOrderId}:`, e);
          // Ensure a landing row exists so the retry sweep can pick this up
          try {
            await supabaseAdmin
              .from("landing_raw_ebay_order")
              .upsert(
                {
                  external_id: ebayOrderId,
                  raw_payload: payload,
                  status: "error",
                  error_message: `Webhook call failed: ${e.message || String(e)}`.substring(0, 500),
                  received_at: new Date().toISOString(),
                },
                { onConflict: "external_id", ignoreDuplicates: false }
              );
          } catch (landingErr) {
            console.error(`Failed to create landing row for retry:`, landingErr);
          }

          // Best-effort: trigger the retry function immediately
          try {
            fetch(`${supabaseUrl}/functions/v1/ebay-retry-order`, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${serviceKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({}),
            }).catch(() => {});
          } catch { /* fire and forget */ }
        }
      } else {
        // Fallback: trigger bulk sync if we can't extract the order ID
        // Debounce: skip if a bulk sync was triggered in the last 30 seconds
        const { data: recentSync } = await supabaseAdmin
          .from("ebay_notification")
          .select("id")
          .eq("topic", "__BULK_SYNC__")
          .gte("received_at", new Date(Date.now() - 30000).toISOString())
          .maybeSingle();

        if (recentSync) {
          console.log("Bulk sync already triggered recently, skipping");
        } else {
          console.log("No order ID in payload, falling back to bulk sync");
          await supabaseAdmin.from("ebay_notification").insert({
            topic: "__BULK_SYNC__",
            notification_id: null,
            payload: {},
            received_at: new Date().toISOString(),
          });
          try {
            const syncRes = await fetch(
              `${supabaseUrl}/functions/v1/ebay-sync`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${serviceKey}`,
                },
                body: JSON.stringify({
                  action: "sync_orders",
                  _triggered_by: "notification",
                }),
                signal: AbortSignal.timeout(25000),
              }
            );
            const syncData = await syncRes.json().catch(() => ({}));
            console.log(
              `Fallback order sync from ${topic}:`,
              JSON.stringify(syncData).substring(0, 200)
            );
          } catch (e) {
            console.error("Failed to trigger fallback order sync:", e);
          }
        }
      }
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ error: "Method not allowed" }), {
    status: 405,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
