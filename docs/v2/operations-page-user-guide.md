# Operations Page User Guide

This guide explains `/admin/operations`.

The page is a rolling operations console for settlement evidence, QBO posting, listing outboxes, Blue Bell accruals, and reconciliation exceptions. It is not a period-close page and it is not a task assignment system.

## What The Page Is For

Use Operations to:

- Monitor marketplace or processor-held payouts.
- Treat cash and in-person sales as settled once recorded, including undeposited funds.
- Run scheduled automation manually.
- Investigate actionable reconciliation cases.
- Open the related order, payout, listing, purchase, or settings record.
- Retry or cancel failed listing commands.
- Retry, run, or cancel QBO posting intents.
- Review and settle Blue Bell accruals.
- Export reports with app references, QBO IDs, QBO DocNumbers, and external references.

## Page Layout

1. Header actions and exports
2. Summary cards
3. Rolling Operations Health
4. Automation Runs
5. Rolling Settlement Monitor
6. Blue Bell Accrual Ledger
7. Reconciliation Inbox
8. Case Notes
9. Listing Command Outbox
10. QBO Posting Outbox

## Header Actions

**Run All Automation** runs market intelligence refresh, settlement reconciliation, listing command processing, and QBO posting intent processing.

**Refresh Cases** rebuilds reconciliation cases from current app data.

**Refresh Settlements** refreshes actual settlement lines and rebuilds related cases. Use this after importing Stripe/eBay payout evidence.

**Exports** download CSV reports for profit, reconciliation cases, rolling settlement, and Blue Bell accruals. Exports include the readable app reference plus QBO IDs, QBO DocNumbers, eBay/Stripe/channel references where available.

## Rolling Operations Health

This table shows current operational health by area. There are no due dates, owners, SLAs, or period-close checks.

Columns:

- **Status**: `ready`, `warning`, or `blocked`.
- **Area**: subsystem being checked.
- **Open**: unresolved items.
- **Pending**: queued work.
- **Failed**: failed items requiring correction.
- **Last Success**: latest successful automation run where known.
- **Oldest Item**: oldest unresolved/pending item.
- **Next Step**: plain-English recommendation.

Work blocked rows first, then warnings.

## Rolling Settlement Monitor

This table compares expected settlement against actual payout evidence on a rolling basis.

Important rule: cash and in-person sales are settled immediately when recorded, even if the money is posted to undeposited funds. Only marketplace or processor-held money, such as eBay or Stripe payouts, should remain under payout monitoring.

Columns:

- **Status**: `settled`, `awaiting payout`, or `review`.
- **Order**: clickable order.
- **Channel**: order channel and payment method.
- **Expected / Actual / Variance**: settlement comparison.
- **Cases**: open cases linked to that order.
- **References**: app reference, QBO DocNumber, QBO ID, and external reference.

Use **Reconcile** or **Refresh Settlements** after importing payout evidence.

## Blue Bell Accrual Ledger

Blue Bell is handled as a rolling accrual ledger, not a monthly close process.

Columns:

- **Status**
- **Order**
- **Basis**
- **Discount**
- **Commission**
- **Settlement**
- **References**

Select one or more open accruals and click **Create Settlement** when you want to record a settlement batch. The settlement can cover any date range implied by the selected accruals.

## Reconciliation Inbox

The Reconciliation Inbox is the main exception workflow.

Case rows include:

- severity
- case type
- **Open Record** link where a related record exists
- app/QBO/external references
- expected/actual variance
- likely root cause
- recommended fix
- evidence summary
- notes

Supported cases include missing COGS, unallocated order lines, unmatched payout fees, missing payouts, amount mismatches, unpaid Blue Bell accruals, QBO posting gaps, listing command failures, duplicate candidates, and QBO refresh drift.

There is no owner, due date, or SLA workflow. Use notes for investigation history.

Finance-sensitive cases require evidence or a meaningful resolution note before they can be resolved or ignored.

## Case Actions

- **Open Record** opens the related order, payout, listing, purchase, or settings page where available.
- **Link** attempts to link an unmatched payout fee by external order evidence.
- **Refresh** refreshes settlement evidence for missing payout, mismatch, or duplicate cases.
- **Queue QBO** queues QBO posting for an order posting gap.
- **Notes** opens the note/evidence history.
- **In Progress** marks a case as being investigated.
- **Resolve** closes a case with evidence where required.
- **Ignore** closes a case as intentionally accepted, with evidence where required.

## QBO Posting Outbox

This table tracks app-side posting intents to QuickBooks Online.

Columns include action, target, app reference, QBO DocNumber, QBO entity ID, external reference, retry count, next attempt, and last error.

Use:

- **Run posting now** for a pending intent.
- **Retry posting** after fixing the data/QBO issue.
- **Cancel posting** only when QBO should not receive the posting, with evidence recorded on the related case where appropriate.

Purchases created in the app are blocked from QBO until grading is complete. Placeholder intake SKUs must not be sent to QBO.

## Listing Command Outbox

This table tracks publish, reprice, pause, end, and quantity sync commands.

Use retry only after fixing the listing/channel data named in the error. Cancel obsolete commands that should not be sent.

## QBO Dry-Run Refresh

The QBO refresh flow lands QBO data into staging and creates drift cases. It does not rewrite canonical app records and does not change website/eBay listings, prices, listing IDs, or outbound commands.

Drift cases should be reviewed and applied only when the change is a reference/doc-number correction or other approved accounting traceability update.

## Routine

Daily:

- Review summary cards.
- Run listing/QBO outboxes if pending.
- Triage high-severity cases.

After payout import:

- Refresh Settlements.
- Refresh Cases.
- Resolve missing payout or mismatch cases with evidence.

Weekly:

- Run All Automation.
- Review Rolling Operations Health.
- Export Cases CSV if a handover record is useful.

Blue Bell:

- Review open accruals.
- Select accruals ready for payment/recording.
- Create a settlement record.
- Export the Blue Bell CSV when needed.
