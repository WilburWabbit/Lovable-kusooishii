// ============================================================
// PayoutAdapter registry — single dispatch point per channel.
// To add a new channel, import its adapter and add it to the map.
// ============================================================

import type { PayoutAdapter } from "../../_shared/payout-adapter.ts";
import { ebayAdapter } from "./ebay.ts";
import { stripeAdapter } from "./stripe.ts";

const ADAPTERS: Record<string, PayoutAdapter> = {
  ebay: ebayAdapter,
  stripe: stripeAdapter,
};

export function resolveAdapter(channel: string): PayoutAdapter {
  const a = ADAPTERS[channel];
  if (!a) {
    throw new Error(
      `No PayoutAdapter registered for channel "${channel}". ` +
      `Add one in supabase/functions/qbo-sync-payout/adapters/.`,
    );
  }
  return a;
}
