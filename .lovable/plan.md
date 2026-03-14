

## Plan: Remove Draft State from Listing Creation

### Problem
When creating listings (especially via the "ensure-channel-listing" action and bulk listing creation), the `offer_status` is set to `"DRAFT"`. There is no UI to transition from DRAFT to PUBLISHED, leaving listings stuck in an unusable state.

The `create-web-listing` action already correctly sets `"PUBLISHED"`, but two other code paths do not:

### Changes in `supabase/functions/admin-data/index.ts`

1. **`ensure-channel-listing` action (line 1015)**: Change `offer_status: "DRAFT"` to `offer_status: "PUBLISHED"`
2. **Bulk auto-create missing listings (line 879)**: Change `offer_status: "DRAFT"` to `offer_status: "PUBLISHED"`

Both are single-line changes in the edge function. No database migration or UI changes needed.

