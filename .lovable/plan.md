

# Refactor Payouts: List + Detail Page (replace slide-out)

## Summary
Extract the `PayoutDetailSheet` slide-out into a standalone `PayoutDetail` component rendered on its own page at `/admin/payouts/:payoutId`, matching the Orders pattern.

## Changes

### 1. New file: `src/pages/admin-v2/PayoutDetailPage.tsx`
Thin page wrapper (identical pattern to `OrderDetailPage`):
- Reads `payoutId` from URL params
- Renders `AdminV2Layout > PayoutDetail`

### 2. New file: `src/components/admin-v2/PayoutDetail.tsx`
Extract the content from `PayoutDetailSheet` (lines 450-727 of PayoutView.tsx) into a standalone component:
- Props: `{ payoutId: string }`
- Fetches payout data by ID (add `usePayout(id)` hook or inline query)
- Same layout as the sheet interior but rendered as a full page with `BackButton`, `StickyActions`
- Keeps: totals cards, meta grid, fee breakdown, fee detail by category, linked orders table, reconcile + QBO sync buttons
- Replaces `Sheet`/`SheetContent` wrapper with standard page layout

### 3. Update `src/components/admin-v2/PayoutView.tsx`
- Remove `PayoutDetailSheet` component entirely
- Remove `Sheet`/`SheetContent` imports
- Change table row `onClick` from `setSelectedPayout(row)` to `navigate(\`/admin/payouts/${row.id}\`)`
- Remove `selectedPayout` state
- Keep `CreatePayoutDialog` as-is (it's a modal, not a slide-out)

### 4. Update `src/hooks/admin/use-payouts.ts`
- Add a `usePayout(payoutId: string)` hook that fetches a single payout row by ID (the list hook returns all payouts; the detail page needs one by ID)

### 5. Update `src/App.tsx`
- Add lazy import for `PayoutDetailPage`
- Add route: `/admin/payouts/:payoutId` (between the payouts list and pricing routes)

### 6. Update `src/pages/admin-v2/PayoutListPage.tsx`
No changes needed (it just renders `PayoutView`).

## No database or edge function changes required.

