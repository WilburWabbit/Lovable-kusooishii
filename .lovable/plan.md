

# Fix Batch Repricing: Wrong Action Name

## Problem

The `PricingActionsCard` component calls the wrong edge function action. It calls `calculate-selling-costs` (which requires `sale_price` — used for post-sale P&L breakdown) instead of `calculate-pricing` (which computes floor/target/ceiling prices from costs and fees). Every call fails with `"sku_id, channel, and sale_price are required"`.

## Root cause

In `PricingActionsCard.tsx`:
- **Line 57**: Batch loop calls `calculate-selling-costs` — should be `calculate-pricing`
- **Line 98**: Single SKU calls `calculate-selling-costs` — should be `calculate-pricing`

The `calculate-pricing` action (line 829 of `admin-data/index.ts`) only requires `sku_id` and `channel`, and returns `floor_price`, `target_price`, `ceiling_price`, `confidence_score`, and `breakdown` — exactly what the component expects.

## Additional issue: Edge Function timeout risk

The batch loop makes 2 sequential HTTP calls per listing (calculate + update). With 30+ listings, this runs in the browser for minutes. Each call is fine individually, but the pattern is fragile. For now, fixing the action name will make it work. A queue-based approach can be considered later if the listing count grows significantly.

## Changes

### `src/components/admin-v2/PricingActionsCard.tsx`

Two line changes:
1. Line 57: Change `action: 'calculate-selling-costs'` to `action: 'calculate-pricing'`
2. Line 98: Same change for the single SKU lookup

No other files need changes — the edge function and update action are correct.

## Files changed

| File | Change |
|------|--------|
| `src/components/admin-v2/PricingActionsCard.tsx` | Fix action name from `calculate-selling-costs` to `calculate-pricing` (2 occurrences) |

