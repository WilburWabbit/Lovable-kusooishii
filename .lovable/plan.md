<final-text>I’ve narrowed it down to the backend deposit builder, not the UI. In `qbo-sync-payout`, the deposit currently excludes every `NON_SALE_CHARGE` and every `TRANSFER`. That only works if those omitted amounts net exactly to zero. Your live result (£221.19 vs £222.06) strongly suggests they do not for this payout, leaving a missing +£0.87.

Plan:
1. Inspect the live payout’s `ebay_payout_transactions` and landed QBO deposit lines to identify the exact omitted transaction(s) behind the £0.87.
2. Replace the hard-coded exclusion rule with a reconciliation guard: calculate the deposit total before posting and compare it to `payout.net_amount`.
3. If there is any delta over £0.01, either include the necessary balancing linked transaction or fail fast with a clear error instead of creating the wrong deposit.
4. Add “Expected eBay net” vs “Constructed QBO deposit total” to the payout card so the mismatch is visible before sync.
5. Reset/delete the incorrect QBO deposit and re-sync after the fix.

If you want, send a new request and I’ll continue with the live-data inspection and the exact code-change plan.</final-text>