

## Plan: Round target prices up to .99

### Change

In `supabase/functions/admin-data/index.ts`, after the target price is calculated (line ~829), round it up to the nearest `.99` ending. Same for the ceiling price.

**Rounding logic:** `Math.floor(value) + 0.99` — e.g. £12.34 → £12.99, £25.00 → £25.99, £7.99 → £7.99.

Edge case: if the value is already exactly `.99`, keep it as-is.

### Lines affected (~827-834)

```typescript
// Current
targetPrice = Math.round(marketConsensus * condMultiplier * 100) / 100;
if (targetPrice < floorPrice) targetPrice = floorPrice;

const ceilingPrice = Math.round(Math.max(floorPrice, marketConsensus ?? floorPrice) * 100) / 100;

// Updated
targetPrice = Math.floor(marketConsensus * condMultiplier) + 0.99;
if (targetPrice < floorPrice) targetPrice = floorPrice;

const ceilingPrice = Math.floor(Math.max(floorPrice, marketConsensus ?? floorPrice)) + 0.99;
```

### Files
- `supabase/functions/admin-data/index.ts` — apply `.99` rounding to target and ceiling prices

