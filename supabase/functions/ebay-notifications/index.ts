import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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
    if (!sigHeader || !VERIFICATION_TOKEN) {
      console.error("eBay notification: missing signature or verification token");
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Compute HMAC-SHA256 of the raw body using the verification token
    const encoder = new TextEncoder();
    const keyData = encoder.encode(VERIFICATION_TOKEN);
    const cryptoKey = await crypto.subtle.importKey(
      "raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
    );
    const sigBytes = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(rawBody));
    const computed = Array.from(new Uint8Array(sigBytes))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    // Constant-time comparison
    if (computed.length !== sigHeader.length || !crypto.subtle.timingSafeEqual
      ? computed !== sigHeader
      : !timingSafeEqual(computed, sigHeader)) {
      console.error("eBay notification: signature mismatch");
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
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
        } catch (e) {
          console.error(`Failed to process order ${ebayOrderId}:`, e);
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
