import {
  corsHeaders,
  createAdminClient,
  authenticateRequest,
  fetchWithTimeout,
  jsonResponse,
  errorResponse,
} from "../_shared/qbo-helpers.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const admin = createAdminClient();
    await authenticateRequest(req, admin);

    // Trigger the posting-intent worker first; keep qbo-retry-sync as a
    // compatibility pass for any legacy pending orders not yet queued.
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const postingRes = await fetchWithTimeout(
      `${supabaseUrl}/functions/v1/accounting-posting-intents-process`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${serviceRoleKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ batchSize: 25 }),
      },
    );

    const postingResult = await postingRes.json();

    const retryRes = await fetchWithTimeout(
      `${supabaseUrl}/functions/v1/qbo-retry-sync`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${serviceRoleKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      },
    );

    const retryResult = await retryRes.json();
    return jsonResponse({
      triggered: true,
      posting_intent_result: postingResult,
      retry_result: retryResult,
    });
  } catch (err) {
    return errorResponse(err);
  }
});
