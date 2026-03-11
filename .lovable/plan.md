## Design vs Implementation: Deviation Report

I have reviewed the full 2,628-line design specification against the current codebase (database schema, edge functions, admin pages, storefront pages, and routing). Below is a structured summary of what aligns, what partially exists, and what is missing or deviates.

---

### What aligns well with the design


| Area                                                                                                                                                                              | Status                                     |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| **Core enums** (condition_grade 1-5, stock_unit_status, order_status, listing_status, receipt_status, app_role)                                                                   | Fully match design spec sections 11.1-11.3 |
| **Catalog product** (`lego_catalog` table) with MPN, version_descriptor, rebrickable_id, brickeconomy_id, bricklink_item_no, brickowl_boid                                        | Matches section 12.2                       |
| **SKU model** with condition_grade, saleable_flag, qbo_item_id, product_id FK                                                                                                     | Matches section 12.2                       |
| **Stock unit** with landed_cost, accumulated_impairment, carrying_value, inbound_receipt_line_id, reservation_id, location_id                                                     | Matches section 12.2                       |
| **Inbound receipt + lines** with fee apportionment fields (is_stock_line, mpn, qbo_item_id)                                                                                       | Matches sections 13.2-13.3                 |
| **Sales order** with club_id, club_discount_amount, club_commission_amount, origin_channel, shipping fields                                                                       | Matches section 12.2                       |
| **Channel listing** with sku_id, external_listing_id, offer_status                                                                                                                | Partial match to section 12.2              |
| **Audit event** with before/after JSON, correlation_id, causation_id, checksum, parser_version                                                                                    | Matches section 12.2                       |
| **Media model** (media_asset + product_media with sort_order, is_primary, alt_text)                                                                                               | Partial match to section 16.2              |
| **Wishlist + wishlist_item** with notify_on_stock, preferred_grade, max_price                                                                                                     | Matches sections on demand                 |
| **Club + member_club_link**                                                                                                                                                       | Matches section 17.6                       |
| **Roles** (user_roles table with has_role function, separate from profiles)                                                                                                       | Matches section 20                         |
| **Back-office navigation** (Dashboard, Intake, Inventory, Products, Listings, Orders, Customers, Reconciliation, Demand, Analytics, Audit)                                        | Matches section 19.3                       |
| **Settings separation** (QBO, eBay, BrickEconomy panels in Settings, not on operational pages)                                                                                    | Matches design principle 8                 |
| **Edge functions** for QBO sync (purchases, sales, customers, tax-rates, webhook), eBay (auth, sync, notifications, process-order), Stripe (webhook, checkout), BrickEconomy sync | Matches integration scope                  |


---

### Partial implementations (started but incomplete)


| Area                      | What exists                                                              | What the design requires but is missing                                                                                                                                                                                                                |
| ------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Channel listing table** | Basic fields: channel, external_listing_id, offer_status, listed_price   | Missing: `listing_scope`, `status` (uses offer_status instead of canonical listing_status enum), `published_quantity`, `price_floor`, `price_target`, `price_ceiling`, `current_price`, `external_offer_id`, `media_projection_id`, `copy_revision_id` |
| **Product table**         | Has content fields (description, highlights, seo_title, seo_description) | Missing: versioned `content_document` / `content_revision` model (section 16.1). Content is flat on the product row, not revisioned                                                                                                                    |
| **Media model**           | media_asset + product_media join                                         | Missing: `media_collection`, `media_slot` (focal point, caption per slot), `media_variant` (derivatives/crops), `channel_media_projection` (section 16.2)                                                                                              |
| **Settings page**         | QBO, eBay, BrickEconomy panels, Users, VAT Rates                         | Missing most settings sections from 28.1: Pricing rules, Shipping rate tables, Channel fee schedules, Club configuration, SEO templates, Media presets, Notification rules, Audit retention, Feature flags, Sync schedules, Webhook endpoints          |
| **Table UX standards**    | Sortable columns, column visibility, filters, persistent preferences     | Missing from section 19.4: checkbox selection, select all, bulk actions, saved views, export, quick actions, deep-linked filters, row-level audit link                                                                                                 |
| **Storefront**            | Home, Browse, Product Detail, Cart, Checkout, Auth, Account, Wishlist    | Missing: stock alerts subscription, grading guide page, club collection pages (the stripe hosted payment currently used is acceptable)                                                                                                                 |
| **Dashboard**             | Static placeholder stats, integration health dots                        | Missing: live data from sales_order, real integration health checks, recent orders feed                                                                                                                                                                |


---

### Missing from the design (not yet started)


| Design section                                           | What is missing                                                                                                                                                                                                                            |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Staging architecture** (section 10)                    | No `landing_raw_*` or `staging_*` tables. External data (QBO, eBay) writes directly into canonical tables via edge functions. This violates the core architectural rule: "No external system may write directly into canonical app tables" |
| **Stock movements and adjustments** (sections 13.6-13.8) | No `stock_movement`, `stock_adjustment`, or `valuation_adjustment` tables. No adjustment reason codes, no regrading workflow, no part-out or scrap flow                                                                                    |
| **Fee apportionment engine** (section 13.3)              | No `allocable_fee` or `fee_allocation` tables. Receipt lines exist but fee allocation to stock units is not implemented                                                                                                                    |
| **Reservation model** (section 15.2)                     | No `reservation` table. stock_unit has reservation_id but no allocator service                                                                                                                                                             |
| **Pricing intelligence** (section 14)                    | No `price_watch`, `price_snapshot`, `price_forecast`, `market_signal`, or `channel_price_band` tables. No floor/target/ceiling pricing engine                                                                                              |
| **SEO/GEO model** (section 16.4-16.5)                    | No `seo_document` or `seo_revision` tables. SEO fields are flat on product. No structured data (JSON-LD), no sitemap generation, no robots.txt strategy                                                                                    |
| **Content versioning** (section 16.1)                    | No `content_document` or `content_revision` tables. No AI-assisted vs human-edited tracking, no approval workflow                                                                                                                          |
| **Reconciliation** (section 18.3-18.5)                   | Reconciliation page is a placeholder. No settlement lifecycle tables, no auto-match logic, no exception inbox                                                                                                                              |
| **BrickLink connector** (section 10.4)                   | No edge functions or tables for BrickLink                                                                                                                                                                                                  |
| **BrickOwl connector** (section 10.4)                    | No edge functions or tables for BrickOwl                                                                                                                                                                                                   |
| **Rebrickable integration** (section 10.4)               | No edge function for Rebrickable. `import-sets` exists but appears to be a manual CSV-style import rather than API integration                                                                                                             |
| **GTM data layer** (section 24)                          | `use-gtm.ts` and `gtm-ecommerce.ts` exist but need verification against the full event spec (view_item_list, select_item, add_to_cart, purchase, refund, custom events)                                                                    |
| **GA4 Measurement Protocol** (section 24.6)              | No server-side event sending                                                                                                                                                                                                               |
| **Analytics warehouse** (section 21)                     | No fact tables, no dimensional model, no reporting views                                                                                                                                                                                   |
| **Exception inbox** (section 18.5)                       | No `exception_case` table or UI                                                                                                                                                                                                            |
| **Job run model** (section 26.2)                         | No `job_run` table or tracking                                                                                                                                                                                                             |
| **Dead letter handling** (section 26.3)                  | No `dead_letter_event` table                                                                                                                                                                                                               |
| **Outbound command model** (section 10.1)                | No `outbound_command` table. Listing publication happens synchronously in edge functions                                                                                                                                                   |
| **Record 360 view** (section 19.5)                       | No drill-in view showing audit timeline, related entities, raw payloads                                                                                                                                                                    |
| **Embedded Stripe Checkout** (section 17.3)              | Design explicitly recommends embedded checkout for dynamic shipping/club collection. Current `create-checkout` likely uses Stripe-hosted redirect                                                                                          |
| **Shipping policy engine** (section 17.5)                | No delivery rule engine evaluating member status, basket, club eligibility                                                                                                                                                                 |
| **Club collection flow** (section 17.8)                  | Club table exists but no checkout integration for club collection, no commission accrual workflow                                                                                                                                          |
| **Permissions model** (section 20.2)                     | Roles exist (admin/staff/member) but no granular permission scopes (e.g. `inventory.adjust`, `listing.publish`)                                                                                                                            |
| **WCAG 2.2 AA** (section 19.7)                           | Not systematically verified                                                                                                                                                                                                                |


---

### Naming deviations


| Design name                                                               | Actual table name                                                 | Impact                                                                                                                               |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `catalog_product`                                                         | `lego_catalog`                                                    | Cosmetic but may cause confusion when referencing design docs                                                                        |
| `product` (design uses catalog_product for master, no separate "product") | `product` table exists as a separate content/listing-ready entity | This is actually a reasonable separation (catalog vs sellable product) but diverges from the design's single `catalog_product` model |


---

### Summary priority ranking

**Critical deviations** (violate core design principles):

1. No staging architecture -- external data writes directly to canonical tables
2. No stock movement/adjustment tracking -- core operational subledger is incomplete
3. No pricing intelligence tables -- no floor/target/ceiling pricing

**Significant gaps** (major features not started):
4. No reconciliation engine or exception inbox
5. No BrickLink or BrickOwl connectors
6. No content/SEO versioning model
7. No embedded Stripe checkout or shipping policy engine
8. Channel listing table missing most design-specified fields

**UX gaps** (functional but incomplete):
9. No bulk actions, saved views, or export on admin tables
10. No Record 360 drill-in view
11. Dashboard shows static data only
12. Several Settings sections are placeholder or missing