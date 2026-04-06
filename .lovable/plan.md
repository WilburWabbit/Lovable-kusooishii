

# BrickEconomy Market Data Not Displaying — Fix Plan

## Root Cause

The `BrickEconomyPriceChart` component strips the version suffix from the MPN before querying:

```typescript
const setNumber = mpn.split("-")[0]; // "75367-1" → "75367"
```

But the database stores `item_number` WITH the suffix (e.g., `75367-1` for sets). The query returns zero rows, so the UI shows "No price history yet" despite 646 rows existing in the table.

Minifig item numbers (e.g., `nex016`) have no hyphen, so `.split("-")[0]` works for them — but the component defaults `itemType` to `"set"`, so minifigs are unlikely to be queried correctly either.

## Fix

**File: `src/components/admin-v2/BrickEconomyPriceChart.tsx` (line 62)**

Remove the `.split("-")[0]` — pass the full MPN directly as the `itemNumber` to the price history hook:

```typescript
// Before:
const setNumber = mpn.split("-")[0];
const { data: history = [], isLoading } = useBrickEconomyPriceHistory(itemType, setNumber);

// After:
const { data: history = [], isLoading } = useBrickEconomyPriceHistory(itemType, mpn);
```

This is a one-line change. The MPN already matches the `item_number` format stored by the sync function (e.g., `75367-1`).

No other files need changes — the hook, the sync function, and the settings card are all correct.

