

# Build eBay Title Generator & Wire into ChannelsTab

## Problem

The `generate-ebay-title.ts` utility referenced in the wiring prompt does not exist in the current codebase (likely lost in a previous reset). It needs to be rebuilt, then wired into `ChannelsTab` per the existing prompt spec.

## Changes

### 1. Create `src/lib/utils/generate-ebay-title.ts` (new file)

Build a Cassini-optimised eBay title generator with:

- **Input**: `{ name, mpn, theme, grade, retired, retiredYear, pieceCount }`
- **Output**: `{ title: string, length: number, warnings: string[] }`
- **Core logic**: Start with `LEGO` prefix, then set number/MPN, then product name. Append descriptors in priority order until 80-char limit is reached:
  1. Grade marker — grade 1: `SEALED` / `BNIB`; grade 2: `COMPLETE`
  2. `RETIRED` flag (if retired)
  3. Piece count (e.g. `1234 Pieces`)
  4. Theme name
  5. Retired year (e.g. `Retired 2023`)
- **Truncation**: Hard limit at 80 characters; truncate name (not descriptors) if needed
- **Validation**: `validateTitle()` checks for eBay banned terms (e.g. "rare", "must have", "look", "wow", "L@@K")
- **Pure function** — no React dependencies, fully testable

### 2. Update `src/components/admin-v2/ChannelsTab.tsx`

- Import `generateEbayTitle` from the new utility
- Add a `useMemo` inside `VariantChannelsCard` that calls `generateEbayTitle()` with product metadata
- Change the `useState` initialiser so eBay titles default to the generated title instead of using the simple `defaultTitle()` function; other channels keep using `product.name`
- Remove or replace the existing `defaultTitle()` helper since the generator supersedes it for eBay

### 3. No change needed to `ProductDetail.tsx`

The `product` prop is already passed to `ChannelsTab` from a previous task.

## Files

| File | Action |
|------|--------|
| `src/lib/utils/generate-ebay-title.ts` | Create — title generator with descriptor priority system |
| `src/components/admin-v2/ChannelsTab.tsx` | Edit — wire generator into eBay default title |

