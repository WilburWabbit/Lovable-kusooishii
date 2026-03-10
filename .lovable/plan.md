

## Storefront Build — Porting from kusooishii Reference

This is a large body of work covering ~30 files across storefront UI, Stripe checkout, analytics, shipping, and content pages. I'll break it into logical phases.

### Current State

- **This project** has: StorefrontHeader, StorefrontFooter, StorefrontLayout, BrowsePage (with `browse_catalog` RPC), ProductDetailPage (with local DB queries), Index page (mock featured sets), auth system, and a full admin back-office
- **The reference project (kusooishii)** has: Zustand store for cart/wishlist, Stripe checkout via `create-checkout` edge function, `stripe-webhook` for order recording, GTM/GA4 analytics, cookie consent, shipping bands, SEO hooks, and full content pages (About, FAQ, Contact, Terms, Privacy, Shipping, Returns, Order Tracking)
- Key difference: the reference pulls products from a separate Hub database; this project uses its own local database with `browse_catalog` RPC and `product_detail_offers` RPC

### Architecture Decisions

1. **Zustand store** — Port the cart/wishlist Zustand store but adapt it to work with this project's local product data (not the Hub). Products come from `browse_catalog` RPC and product detail queries.
2. **Stripe** — Port `create-checkout` and `stripe-webhook` edge functions. The webhook will record orders in a local `orders` table and also create internal `sales_order` records to integrate with the existing back-office pipeline.
3. **Shipping** — Port the `use-shipping` hook but query shipping bands from the local database (new `shipping_band` table) instead of the Hub.
4. **GTM/GA4** — Port the GTM hook but store the container ID as a secret rather than fetching from a Hub channel config table.
5. **Content pages** — Adapt all content pages to use this project's design system (Space Grotesk + Noto Sans JP, torii red) rather than the reference's Inter-based system.

### Implementation Plan

#### Phase 1: Infrastructure & Store (5 files)

| File | Change |
|------|--------|
| `src/lib/store.ts` | **New** — Zustand store with cart, wishlist, recently viewed, search, filters (adapted from reference) |
| `src/components/ScrollToTop.tsx` | **New** — Scroll to top on route change |
| `src/components/CookieConsent.tsx` | **New** — Cookie consent banner with accept/reject, adapted to project's design system |
| `src/hooks/use-page-seo.ts` | **New** — SEO meta tag management hook |
| `src/lib/gtm-ecommerce.ts` | **New** — GA4 ecommerce event helpers (add_to_cart, begin_checkout, purchase) |

#### Phase 2: GTM & Analytics (1 file)

| File | Change |
|------|--------|
| `src/hooks/use-gtm.ts` | **New** — GTM container injection + page_view tracking. Container ID stored as a config value in the database or a secret. |

#### Phase 3: Header, Footer, Layout Updates (3 files)

| File | Change |
|------|--------|
| `src/components/StorefrontHeader.tsx` | **Rewrite** — Add search bar toggle, wishlist icon with badge, cart icon with live count from Zustand store, nav items matching reference (Shop, Themes, Just Landed, Deals, Wishlist) |
| `src/components/StorefrontFooter.tsx` | **Rewrite** — Match reference layout: brand + quick links + customer service + newsletter signup, dark background |
| `src/components/StorefrontLayout.tsx` | **Update** — Add CookieConsent, ScrollToTop, LiveStoreSync |

#### Phase 4: Product Cards & Filters (3 files)

| File | Change |
|------|--------|
| `src/components/ProductCard.tsx` | **New** — Product card with image, condition badge, wishlist heart, add-to-cart button, savings percentage, low stock warning. Adapted to use this project's product data shape. |
| `src/components/ProductFilters.tsx` | **New** — Collapsible filter sidebar with theme, condition, price range, year, retired toggle, active filter badges |
| `src/components/SearchBar.tsx` | **New** — Search input with navigation to search results page |

#### Phase 5: Shipping (2 files)

| File | Change |
|------|--------|
| Database migration | **New** — `shipping_band` table (carrier, service_name, max dimensions, max weight, price_inc_vat, is_active) |
| `src/hooks/use-shipping.ts` | **New** — Fetch shipping bands from local DB, calculate best band per cart item. Free standard (Evri), paid express (Royal Mail/Parcelforce), free collection. |

#### Phase 6: Cart & Checkout (4 files)

| File | Change |
|------|--------|
| `src/pages/CartPage.tsx` | **New** — Full cart page with item management, shipping method selector (standard free / express paid / collection), collection 5% discount, Stripe checkout button |
| `src/pages/CheckoutSuccessPage.tsx` | **New** — Success page after Stripe checkout, clears cart, fires GA4 purchase event |
| `supabase/functions/create-checkout/index.ts` | **New** — Stripe Checkout Session creation with dynamic line items, shipping as line item, collection coupon, promo codes |
| `supabase/functions/stripe-webhook/index.ts` | **New** — Handle `checkout.session.completed`, upsert to local `orders` table, create `sales_order` + `sales_order_line` records, deplete stock |

#### Phase 7: Content Pages (8 files)

| File | Change |
|------|--------|
| `src/pages/AboutPage.tsx` | **New** — About us page with hero, story, difference cards, how it works, sustainability |
| `src/pages/FAQPage.tsx` | **New** — FAQ with accordion sections: condition grades, buyer education, ordering, shipping, returns |
| `src/pages/ContactPage.tsx` | **New** — Contact form + info sidebar |
| `src/pages/ShippingPolicyPage.tsx` | **New** — Shipping options, processing time, packaging info |
| `src/pages/ReturnsPage.tsx` | **New** — Returns policy for sealed/open-box/damaged-box, how to return process |
| `src/pages/OrderTrackingPage.tsx` | **New** — Order tracking by order number + email, step timeline |
| `src/pages/TermsPage.tsx` | **New** — Terms of service |
| `src/pages/PrivacyPage.tsx` | **New** — Privacy policy (UK GDPR) |

#### Phase 8: Browse & Homepage Updates (2 files)

| File | Change |
|------|--------|
| `src/pages/Index.tsx` | **Rewrite** — Use live product data from store, featured products sorted by savings, hero with brand messaging, value props, newsletter |
| `src/pages/BrowsePage.tsx` | **Rewrite** — Replace inline filters with ProductFilters component, use ProductCard for grid items, integrate with Zustand store for add-to-cart |

#### Phase 9: Routing (1 file)

| File | Change |
|------|--------|
| `src/App.tsx` | **Update** — Add routes for cart, checkout success, about, faq, contact, shipping-policy, returns-exchanges, order-tracking, terms, privacy, search |

#### Phase 10: Database & Secrets

| Item | Detail |
|------|--------|
| `shipping_band` table | carrier, service_name, max dimensions, weight, price, is_active |
| `orders` table | stripe_session_id, customer_email, status, subtotal, shipping, total, items (jsonb), shipping_address (jsonb) |
| `STRIPE_SECRET_KEY` secret | Required for checkout and webhook |
| `STRIPE_WEBHOOK_SECRET` secret | Required for webhook signature verification |
| `GTM_CONTAINER_ID` secret | Optional, for Google Tag Manager |

### Stripe Integration Note

This will require enabling Stripe on the project. The `create-checkout` function creates a Stripe Checkout Session with:
- Dynamic `price_data` line items (no pre-created Stripe products needed)
- Shipping as a separate line item when express is selected
- `allow_promotion_codes: true` for standard orders (Stripe discount codes)
- A specific collection coupon ID for the 5% LEGO club collection discount
- `shipping_address_collection` for delivered orders only

### Data Flow Adaptation

The reference project uses a Hub database for products. This project has its own database with `browse_catalog` RPC. The Zustand store will be populated by querying the local DB rather than a Hub client. The `useLiveStore` hook will call `browse_catalog` and map results to the store's Product interface.

### Estimated Scope

~30 new/modified files across phases. This should be implemented incrementally — I recommend starting with Phases 1-4 (store, layout, cards) first, then adding Stripe and content pages.

