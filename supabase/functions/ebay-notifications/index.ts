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
    const endpoint = `${Deno.env.get("SUPABASE_URL")}/functions/v1/ebay-notifications`;

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
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(supabaseUrl, serviceKey);

    let payload: any;
    try {
      payload = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON" }), {
        status: 400,
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
    }

    // For order-related topics, trigger the full processing pipeline
    const ORDER_TOPICS = [
      "MARKETPLACE_ORDER_CONFIRMATION",
      "ORDER_CONFIRMATION",
      "ORDER_CHANGE",
    ];
    if (ORDER_TOPICS.includes(topic)) {
      // Extract order ID from notification payload
      const ebayOrderId =
        payload?.resource?.orderId ||
        payload?.data?.orderId ||
        payload?.orderId ||
        null;

      if (ebayOrderId) {
        // Route to dedicated order processing pipeline
        try {
          const processRes = await fetch(
            `${supabaseUrl}/functions/v1/ebay-process-order`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${serviceKey}`,
              },
              body: JSON.stringify({ order_id: ebayOrderId }),
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
        console.log("No order ID in payload, falling back to bulk sync");
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
