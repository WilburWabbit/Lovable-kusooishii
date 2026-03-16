

## Fix: Use existing eBay merchant location "brookville"

### Problem
The edge function tries to check for and create a "default" merchant location on every listing attempt. This is unnecessary — the eBay account already has a location with key `brookville`.

### Changes

**File: `supabase/functions/ebay-sync/index.ts`**

1. **Remove the entire location-check block** (lines 661-678) — no need to check or create any location.

2. **Update `merchantLocationKey`** in the offer body (line 690):
   - Change `"default"` → `"brookville"`

