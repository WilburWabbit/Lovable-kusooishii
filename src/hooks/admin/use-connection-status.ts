// ============================================================
// Admin V2 — Connection Status Hook
// Checks QBO, eBay, and Stripe connection states.
// ============================================================

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface ConnectionStatus {
  qbo: 'connected' | 'expired' | 'disconnected';
  ebay: 'connected' | 'expired' | 'disconnected';
  stripe: 'connected' | 'disconnected';
}

export function useConnectionStatus() {
  return useQuery({
    queryKey: ['v2', 'connection-status'] as const,
    queryFn: async (): Promise<ConnectionStatus> => {
      // QBO: check qbo_connection table
      let qbo: ConnectionStatus['qbo'] = 'disconnected';
      const { data: qboConn } = await supabase
        .from('qbo_connection')
        .select('token_expires_at')
        .limit(1)
        .maybeSingle();

      if (qboConn) {
        const expiresAt = new Date((qboConn as Record<string, unknown>).token_expires_at as string);
        qbo = expiresAt > new Date() ? 'connected' : 'expired';
      }

      // eBay: check for stored eBay auth token
      let ebay: ConnectionStatus['ebay'] = 'disconnected';
      const { data: ebayConn } = await supabase
        .from('ebay_auth_tokens' as never)
        .select('expires_at')
        .limit(1)
        .maybeSingle();

      if (ebayConn) {
        const expiresAt = new Date((ebayConn as Record<string, unknown>).expires_at as string);
        ebay = expiresAt > new Date() ? 'connected' : 'expired';
      }

      // Stripe: always considered connected if the app is running
      // (webhook is configured at deployment time)
      const stripe: ConnectionStatus['stripe'] = 'connected';

      return { qbo, ebay, stripe };
    },
    staleTime: 60_000, // Cache for 1 minute
  });
}
