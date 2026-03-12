

## Fix: Pricing Engine BrickEconomy Lookup + Surface Valuation on Product Page

### Root Cause

The pricing engine strips the version suffix from the MPN before querying `brickeconomy_collection`:

```text
baseMpn = mpn.replace(/-\d+$/, "")  →  "10281-1" becomes "10281"
```

But BrickEconomy stores `item_number` as `10281-1` (with the suffix). The query returns no match, so `marketConsensus` is always null, target/ceiling prices collapse to the floor, and confidence drops by 0.4.

### Changes

**1. Fix BrickEconomy lookup in `admin-data` edge function** (line ~749-756)

Query `brickeconomy_collection` using **both** the full MPN and the stripped base MPN, so it matches regardless of whether the BrickEconomy data includes the version suffix:

```text
.in("item_number", [mpn, baseMpn])
```

This is a one-line change in the `calculate-pricing` action.

**2. Show BrickEconomy valuation on ProductDetailAdminPage**

Add a small info section to the product detail page that surfaces the BrickEconomy `current_value` for the product's MPN, so admins can see the market data that feeds the pricing engine. This gives visibility into why target prices are what they are.

### Impact

- Target price will now correctly use `market_consensus * condition_multiplier` (e.g. £39.49 × 1.0 = £39.49 for Grade 1)
- Confidence score will jump from ~45% to ~85% for products with BE data + dimensions + fees
- Admins will see the BrickEconomy valuation alongside the pricing breakdown

