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

    // Compatibility wrapper: QBO writes now go through posting_intent.
    // Legacy direct retry is intentionally not invoked from this trigger.
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const batchSize = Number(body.batchSize ?? body.batch_size ?? 25);

    const postingRes = await fetchWithTimeout(
      `${supabaseUrl}/functions/v1/accounting-posting-intents-process`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${serviceRoleKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ batchSize }),
      },
    );

    const postingResult = await postingRes.json();
    return jsonResponse({
      triggered: true,
      posting_intent_result: postingResult,
    });
  } catch (err) {
    return errorResponse(err);
  }
});
