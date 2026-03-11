

## Update eBay OAuth Scopes

Update the `EBAY_SCOPES` array in `supabase/functions/ebay-auth/index.ts` (lines 10–17) to include all requested scopes. After deploying, you'll need to re-authorize eBay (disconnect + reconnect) to get a token with the new scopes.

### File changed

| File | Change |
|------|--------|
| `supabase/functions/ebay-auth/index.ts` | Replace `EBAY_SCOPES` with the full list of 25 scopes |

