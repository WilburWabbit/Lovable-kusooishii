

## Cost Apportionment for Account Lines

### Problem
QBO purchases contain two types of lines:
- **Item lines** (`is_stock_line = true`): actual products with qty/unit cost
- **Account lines** (`is_stock_line = false`): overhead costs like shipping, duties, fees

Currently, account line costs are stored but ignored during processing. The landed cost per unit only reflects the item's direct cost, not the true all-in cost.

### Approach
Apportion account line totals across item lines **pro-rata by line total**, then divide by quantity to get a per-unit overhead. This is the standard landed cost methodology.

**Example**: Receipt has 2 item lines (£100 and £200) plus £30 shipping (account line).
- Item A gets £30 × (100/300) = £10 overhead → £110 total
- Item B gets £30 × (200/300) = £20 overhead → £220 total

### Changes

**1. `process-receipt` edge function** — Add apportionment logic:
- Sum all `is_stock_line = false` line totals as overhead pool
- Sum all stock line totals as the base
- For each stock line, calculate: `overhead_per_unit = (line_total / total_stock_cost) × total_overhead / quantity`
- Set `landed_cost = unit_cost + overhead_per_unit` on each stock_unit
- Store `carrying_value` equal to `landed_cost`

**2. Intake page UI** — Visually distinguish line types:
- Show account lines with a different style (muted/italic, no MPN input)
- Add a summary row showing total overhead to be apportioned
- Show the calculated landed cost (direct + apportioned) per unit in the dialog before processing

**3. No schema changes needed** — `landed_cost` and `carrying_value` columns already exist on `stock_unit`.

### Technical Detail

```text
Receipt Lines:
┌──────────────────────┬────────┬──────────┬──────────┐
│ Description          │ Type   │ Qty      │ Total    │
├──────────────────────┼────────┼──────────┼──────────┤
│ LEGO 75192           │ Item   │ 2        │ £200.00  │
│ LEGO 10294           │ Item   │ 1        │ £150.00  │
│ Royal Mail Shipping  │ Acct   │ —        │ £30.00   │
│ Import Duty          │ Acct   │ —        │ £20.00   │
└──────────────────────┴────────┴──────────┴──────────┘

Overhead pool: £50.00
Stock base:    £350.00

75192: overhead = 50 × (200/350) = £28.57 → per unit = £14.29
       landed_cost = £100.00 + £14.29 = £114.29

10294: overhead = 50 × (150/350) = £21.43 → per unit = £21.43
       landed_cost = £150.00 + £21.43 = £171.43
```

