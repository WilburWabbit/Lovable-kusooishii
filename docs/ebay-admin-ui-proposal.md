# eBay Storefront Admin Expansion Proposal

## Goal
Design a new **Admin → Channels → eBay Storefront Manager** experience that expands what operators can manage, automates repetitive work, and keeps the platform aligned with app-controlled truth and staged integration architecture.

## What can be managed via eBay APIs

Based on `docs/specs/sell_*` OpenAPI specs, the app can manage the following major storefront capabilities.

### 1) Listings, offers, and inventory publication (Sell Inventory API)
- Create/update/delete inventory items (`inventory_item`, bulk variants)
- Bulk update price and quantity
- Create/update/delete offers; publish/withdraw offers
- Manage inventory locations
- Retrieve listing fees before publish

**Operational value:** direct control of what appears on eBay, listing lifecycle, pricing, stock exposure, and storefront coverage.

### 2) Business policies and account rules (Sell Account API v1/v2)
- Fulfillment/payment/return policy CRUD
- Sales tax table endpoints
- Combined shipping rules and shipping-cost updates (v2)
- Payout settings and payout percentage (v2)
- User preferences and opted-in programs

**Operational value:** storefront checkout behavior, shipping standards, return posture, and account-level defaults.

### 3) Orders and fulfillment actions (Sell Fulfillment API)
- Read orders and shipping fulfillments
- Create shipping fulfillment
- Issue refunds
- Manage payment dispute lifecycle (fetch, contest, accept, evidence upload/update)

**Operational value:** post-sale operations, service quality, and dispute response workflows.

### 4) Financial transparency (Sell Finances API)
- Payouts and payout summary
- Transaction feeds and summaries
- Order earnings and seller funds summary
- Billing activities

**Operational value:** daily cashflow visibility, fee diagnostics, and reconciliation input into accounting flows.

### 5) Marketing and promotions (Sell Marketing API)
- Campaign CRUD + state transitions (launch/pause/resume/end)
- Ads, ad groups, keywords, negative keywords
- Bid and budget operations
- Promotion endpoints (`item_price_markdown`, `item_promotion`)
- Report task creation and retrieval

**Operational value:** paid visibility control and conversion optimization from admin.

### 6) Store taxonomy management (Sell Stores API)
- Read store metadata
- Store category CRUD + move operations
- Store task status reads

**Operational value:** improves storefront navigation and merchandising logic.

### 7) Compliance, standards, and performance (Sell Compliance + Analytics APIs)
- Listing violation summary/details
- Seller standards profiles and customer service metrics
- Traffic report endpoint

**Operational value:** risk management and account health protection.

### 8) Metadata and policy discovery (Sell Metadata API)
- Category, condition, return/shipping policy discovery
- Regulatory/product safety policy discovery
- Shipping carrier/service/location discovery

**Operational value:** dynamic guardrails and valid-value catalogs for listing forms.

### 9) Negotiation and recommendation endpoints
- Send offers to interested buyers
- Listing recommendations discovery

**Operational value:** demand capture and listing quality improvements.

---

## What should be automated

Use automation where APIs support high-volume or repetitive actions, but keep operator approvals for high-impact decisions.

## A) Safe default automations (auto-run)
1. **Metadata refresh jobs**
   - Nightly refresh of category/condition/shipping/regulatory policy datasets.
2. **Violation watch**
   - Poll listing violations and open an internal exception queue.
3. **Seller standards pulse**
   - Scheduled pull of standards/metrics with trend snapshots.
4. **Payout/transaction ingestion**
   - Scheduled finances ingestion into staging for reconciliation.
5. **Store category sync checks**
   - Detect drift between internal taxonomy mapping and eBay store categories.

## B) Semi-automations (human approval required)
1. **Bulk repricing to eBay**
   - Suggest price updates, stage as batch, require operator approval before publish.
2. **Offer publish/withdraw waves**
   - Prepare publication sets from stock + policy readiness checks, then approve/run.
3. **Promoted listings budget optimization**
   - Propose bid/budget changes based on ROI rules; require confirmation.
4. **Interested-buyer offer campaigns**
   - Auto-build candidate list, human reviews discount bounds.

## C) Guardrail-heavy automations
1. **Revision budget enforcement**
   - Hard guard against excessive revisions per listing/day.
2. **Policy completeness gate**
   - Block listing publish if required return/payment/fulfillment policy mapping missing.
3. **Grade-aware disclosure gate**
   - For grade 5 (Red Card), force disclosure template + required photo checklist.

---

## Proposed new Admin UI

## Information architecture
Add a new top-level admin area:

- **Channels**
  - **eBay Storefront Manager**
    - Overview
    - Listings & Offers
    - Orders & Disputes
    - Policies
    - Promotions
    - Store Categories
    - Compliance & Health
    - Finance & Payouts
    - Jobs & Automation
    - Activity & Audit

## Page designs

### 1) Overview (command center)
**Widgets**
- Active listings, unpublished offers, blocked listings
- Open policy mismatches
- Violations by severity
- Orders awaiting fulfillment
- Disputes requiring action
- Today/7-day payout snapshot
- Campaign spend/revenue delta

**Primary actions**
- Publish approved offers
- Run policy sync
- Open violation queue
- Open disputes queue

### 2) Listings & Offers
**Table features**
- Source SKU (`MPN.grade`), channel listing ID, status, price, qty, policy set
- Readiness status: `Ready`, `Missing Policy`, `Compliance Risk`, `Revision Cap Risk`
- Bulk actions: stage publish, stage withdraw, stage price/qty updates

**Detail drawer**
- eBay offer payload preview
- Fee preview (`getListingFees`)
- Validation results and warnings

### 3) Orders & Disputes
- Order work queue with SLA timers
- Fulfillment action panel (tracking/carrier/service)
- Refund assistant (amount/reason guardrails)
- Dispute case workspace with evidence checklist and timeline

### 4) Policies
- CRUD UI for fulfillment/payment/return policies
- Combined shipping editor
- Payout settings visibility/editor
- Policy mapping matrix from app policy profile → eBay policy IDs

### 5) Promotions
- Campaign board (Draft/Running/Paused/Ended)
- Ad group and keyword tabs
- Budget & bid tuning panel with recommendation badges
- Markdown promotion builder and calendar

### 6) Store Categories
- Tree editor for eBay store categories
- Drag/move category operations
- Mapping view: internal taxonomy ↔ eBay category

### 7) Compliance & Health
- Violation inbox with severity, due date, and impacted listings
- Seller standards scorecards and trend charts
- Traffic overview and conversion indicators

### 8) Finance & Payouts
- Payout timeline
- Transaction and fee explorer
- Exception panel: unmatched payouts/fees pending accounting mapping

### 9) Jobs & Automation
- Schedules list (nightly syncs, hourly monitors)
- Job run history and retries
- “Dry run” mode for bulk operations
- Circuit breakers and throttle controls

### 10) Activity & Audit
- Event stream of all eBay-side mutations initiated by app
- Actor, source, correlation ID, payload hash, result
- Retry and rollback links where supported

---

## Backend architecture for this UI (required)

1. **Outbound command model**
   - UI writes intent rows into `integration_outbox_ebay_*` tables.
   - Worker/Edge processor executes eBay API call asynchronously.
2. **Inbound data model**
   - eBay pulls/webhooks land raw in `landing_raw_ebay_*`.
   - Separate processors validate/map/promote into canonical and channel-projection tables.
3. **Idempotency & dedup**
   - Use external IDs and deterministic idempotency keys per command.
4. **Audit envelope**
   - Persist request/response metadata, actor, schedule, and correlation IDs.
5. **Dependency sequencing**
   - Policy + location readiness before offer publish.
   - Offer creation before publish.

---

## Suggested rollout phases

### Phase 1 (high impact, low risk)
- Overview
- Listings & Offers (read + staged bulk actions)
- Policies (read/write)
- Compliance & Health (read)
- Jobs & Automation (read + manual trigger)

### Phase 2
- Orders & Disputes actions
- Finance & Payouts analytics and exceptioning
- Store Categories management

### Phase 3
- Promotions full suite
- Recommendation/negotiation-assisted workflows
- Advanced optimization suggestions

---

## Non-negotiable guardrails
- No direct external writes into canonical tables.
- No inline webhook processing in receiver functions.
- Keep integration config and credentials in Settings.
- Preserve versioned MPN and grade-aware SKU semantics in all eBay mappings.
- Every bulk action supports dry-run preview, approval, and auditable execution trail.
