

## Modular payout → QBO architecture

You're right. Today `qbo-sync-payout` hard-codes eBay assumptions (reads `ebay_payout_transactions`, eBay vendor ref, eBay-specific fee categories, TRANSFER/NON_SALE_CHARGE settlement logic). Adding Stripe by branching inside that file would compound the problem; adding a third channel later would make it worse. Let me lay out a clean separation that fixes the immediate Stripe payout AND sets up future channels (BrickLink, BrickOwl, Etsy, in-person card processors, etc.) cleanly.

### Guiding principle

**Channel adapters know their world. The QBO core knows QBO. They meet at one neutral handover contract.**

```text
┌─────────────────────────────────────────────────────────────┐
│  Channel-specific receivers (one per channel)               │
│  ─ ebay-import-payouts        ─ stripe-webhook              │
│  ─ bricklink-import-payouts   ─ etsy-webhook   (future)     │
│                                                             │
│  Job: land raw payout + per-tx + per-fee data into          │
│        canonical neutral tables. NO QBO knowledge.          │
└──────────────────┬──────────────────────────────────────────┘
                   │ writes to
                   ▼
┌─────────────────────────────────────────────────────────────┐
│  Neutral payout tables (channel-agnostic)                   │
│  ─ payouts            (already exists)                      │
│  ─ payout_orders      (already exists, fix nulls)           │
│  ─ payout_fee         (already exists, fee_category enum)   │
│  ─ payout_tx          (NEW — replaces eBay-only tx table    │
│                        for the QBO core's purposes)         │
└──────────────────┬──────────────────────────────────────────┘
                   │ read by
                   ▼
┌─────────────────────────────────────────────────────────────┐
│  v2-reconcile-payout (channel-agnostic, already mostly is)  │
│  Links orders ↔ units ↔ fees, transitions stock, fires QBO  │
└──────────────────┬──────────────────────────────────────────┘
                   ▼
┌─────────────────────────────────────────────────────────────┐
│  qbo-sync-payout (channel-agnostic core)                    │
│  Reads ONLY from neutral tables + a per-channel             │
│  PayoutAdapter contract. Builds Purchases + Deposit.        │
│                                                             │
│  Pluggable adapters (small, isolated):                      │
│  ─ adapters/ebay.ts     ─ adapters/stripe.ts                │
│  ─ adapters/bricklink.ts (future) etc.                      │
└─────────────────────────────────────────────────────────────┘
```

### The neutral handover contract

A `PayoutAdapter` (TypeScript interface, lives in `supabase/functions/_shared/payout-adapter.ts`) is what each channel implements. It is the only place channel-specific QBO knowledge lives:

```text
interface PayoutAdapter {
  channel: 'ebay' | 'stripe' | 'bricklink' | 'etsy' | …
  qboVendorRef: { value: string; name: string }
  // Which QBO account-mapping purpose to use for this channel's fees
  feeAccountPurpose(feeCategory: FeeCategory): string
  // Optional channel quirks (e.g. eBay TRANSFER settlement) — default no-op
  classifyTransactions?(txs: PayoutTx[]): { settledTxIds: Set<string>; ... }
  // Optional: customise expense description per channel
  describeExpense?(fee: PayoutFee, order?: SalesOrder): string
}
```

The core function does all the heavy lifting once: load orders + fees + txs from neutral tables, drift-detect SalesReceipt totals, recreate if needed, build Purchases (one per fee row using `adapter.feeAccountPurpose`), build Deposit lines from SalesReceipts, persist results, handle failures. The adapter just answers a few "how do you do it?" questions.

### Tables: keep what works, add one

- `payouts`, `payout_orders`, `payout_fee`, `payout_fee_line` — keep, already neutral
- `ebay_payout_transactions` — **rename concept, keep table**. Introduce a thin **view `payout_tx`** that exposes the channel-agnostic columns the QBO core cares about (id, payout_id, channel, transaction_id, transaction_type, order_id, gross_amount, total_fees, net_amount, matched_order_id, qbo_purchase_id) sourced from `ebay_payout_transactions` UNION future per-channel tx tables. Existing eBay code keeps writing to `ebay_payout_transactions` unchanged. Stripe doesn't need a tx table at all because its "transactions" are the matched sales_orders themselves — its adapter synthesises rows from `payout_orders` on the fly.

(If you'd rather avoid a UNION view, an equivalent option is to extend `ebay_payout_transactions` to include a `channel` column and rename it `payout_tx` outright — same end state, more migration work. The view approach is non-breaking.)

### What changes in each function

- `qbo-sync-payout/index.ts` — refactor into a `core.ts` (channel-agnostic, ~600 lines extracted from the existing 1729) plus an `adapters/` folder. The current 1729-line file becomes the orchestrator: load payout → pick adapter by `channel` → call core. The eBay-specific bits (TRANSFER classification, insertion-fee item lookup, `EBAY_VENDOR_REF`) move into `adapters/ebay.ts` behind the interface. **No behavioural change for eBay** — it's a pure refactor for that path.
- `adapters/stripe.ts` — new file, ~80 lines: vendor = "Stripe", fee account = `stripe_processing_fees` (with safe fallback to existing fees mapping if missing), synthesises one `PayoutTx` per `payout_orders` row so the core can build SalesReceipt-linked deposit lines using the existing drift/rebuild logic.
- `stripe-webhook/index.ts` — already lands the payout. Add the missing per-charge `payout_fee` insert (~20 lines) so reconciliation populates `order_fees`/`order_net` correctly. **No QBO knowledge added here.**
- `v2-reconcile-payout/index.ts` — already channel-agnostic. No changes needed once `payout_fee` rows exist.
- `admin-data` — add a small `backfill-stripe-payout-fees` action for the one-off historical fix (lists Stripe balance txs, inserts missing `payout_fee` rows, re-runs reconcile). Reusable shape if a future channel ever needs the same "we missed fees, backfill" tool.

### Migration order (safe, incremental, no eBay regression)

1. **Extract core + adapter contract, eBay adapter only.** Behaviour-preserving refactor of `qbo-sync-payout`. Deploy. Run an existing eBay payout end-to-end to confirm parity.
2. **Add `payout_tx` view + Stripe adapter + Stripe `payout_fee` insert in webhook.** Deploy.
3. **Backfill `0897f8ac-…`** via the new admin action. Verify UI shows correct per-order figures.
4. **Click Sync to QBO** on the Stripe payout — Purchases + Deposit created, totals match, `qbo_sync_status='synced'`.
5. Document the adapter contract in `docs/v2/` so adding BrickLink later is a "write one ~80-line file" job, not a 1700-line edit.

### Files

**New**
- `supabase/functions/_shared/payout-adapter.ts` — the interface + shared types
- `supabase/functions/qbo-sync-payout/core.ts` — channel-agnostic orchestrator extracted from current code
- `supabase/functions/qbo-sync-payout/adapters/ebay.ts` — current eBay logic, isolated
- `supabase/functions/qbo-sync-payout/adapters/stripe.ts` — new
- DB migration: view `payout_tx` + new account-mapping purpose `stripe_processing_fees`
- `docs/v2/PAYOUT_ADAPTER_CONTRACT.md` — short spec for future channels

**Edited**
- `supabase/functions/qbo-sync-payout/index.ts` — slimmed to ~80-line dispatcher
- `supabase/functions/stripe-webhook/index.ts` — add per-order `payout_fee` insert in `payout.paid` handler
- `supabase/functions/admin-data/index.ts` — add `backfill-stripe-payout-fees` action
- `src/components/admin-v2/PayoutDetail.tsx` — optional cosmetic "(awaiting fee data)" hint when all per-order values are null

### Explicitly NOT changed

- `payouts`, `payout_orders`, `payout_fee`, `payout_fee_line` schemas — already neutral, just need to be consistently populated
- `v2-reconcile-payout` — works for both channels once data is in place
- `ebay_payout_transactions` table — keeps its current writers; QBO core reads it through the new view
- Order processing, SalesReceipt creation, stock-unit transitions — untouched
- Anything in eBay's behavioural path through QBO sync — pure refactor, same outputs

### Verification

Two payouts must both round-trip cleanly after the work:

- `0897f8ac-…` (Stripe, the broken one): per-order fees ≈ £0.46 each totalling £3.25, deposit £174.20 with 7 LinkedTxn lines and a £3.25 Stripe-fees expense, deposit-net £170.95
- The most recent already-synced eBay payout: `qbo_sync` produces byte-identical Deposit + Purchase set as before the refactor (regression check)

