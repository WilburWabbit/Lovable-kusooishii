// ============================================================
// qbo-sync-payout — entry point
// ============================================================
// Thin HTTP wrapper. All sync logic lives in `core.ts`; per-channel
// behaviour lives in `adapters/<channel>.ts` and is selected via
// `adapters/registry.ts` based on the payout's `channel` column.
// ============================================================

import {
  corsHeaders,
  createAdminClient,
  authenticateRequest,
  errorResponse,
} from "../_shared/qbo-helpers.ts";
import { syncPayoutCore } from "./core.ts";
import { resolveAdapter } from "./adapters/registry.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const admin = createAdminClient();
    await authenticateRequest(req, admin);

    const { payoutId } = await req.json();
    if (!payoutId) throw new Error("payoutId is required");

    // Look up the payout to learn its channel, then dispatch via adapter.
    const { data: payout, error } = await admin
      .from("payouts" as never)
      .select("channel")
      .eq("id", payoutId)
      .single();

    if (error || !payout) throw new Error(`Payout not found: ${payoutId}`);
    const channel = (payout as { channel: string }).channel;

    const adapter = resolveAdapter(channel);
    return await syncPayoutCore(payoutId, admin, adapter);
  } catch (err) {
    return errorResponse(err);
  }
});
