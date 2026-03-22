

## App Emails: Welcome, Order Confirmation, Order Shipped

### Scope

Three branded transactional email templates + BCC to contact@kusooishii.com. Emails triggered only for **web storefront** orders (Stripe). No email triggers for eBay orders.

### Step 1 — Scaffold transactional email infrastructure

Call `scaffold_transactional_email` to create `send-transactional-email`, `handle-email-unsubscribe`, `handle-email-suppression` edge functions, registry, and sample template.

### Step 2 — Create three email templates

All in `supabase/functions/_shared/transactional-email-templates/`, matching existing auth email style (Torii red buttons, Space Grotesk + Noto Sans JP, Kuso Oishii logo, white background, edgy tone).

1. **`welcome.tsx`** — Sent after signup. Subject: "Welcome to the obsession". Brand intro, link to browse catalog.
2. **`order-confirmation.tsx`** — Sent after Stripe checkout. Subject: "Order confirmed — {orderNumber}". Order number, items, shipping address, total. Props: `orderNumber`, `items`, `shippingName`, `grossTotal`, `currency`.
3. **`order-shipped.tsx`** — Sent when web order status changes to "shipped" (admin action). Subject: "Your order has shipped — {orderNumber}". Tracking number, carrier. Props: `orderNumber`, `trackingNumber`, `shippingCarrier`.

Register all three in `registry.ts`.

### Step 3 — Add BCC support

After each primary email is enqueued in `send-transactional-email/index.ts`, enqueue a duplicate to `contact@kusooishii.com` with idempotency key suffixed `-bcc`.

### Step 4 — Wire triggers

**`stripe-webhook/index.ts`** — After order creation (~line 488), invoke `send-transactional-email` with `order-confirmation` template using customer email and order details. Only fires for web/Stripe orders.

**Welcome email** — Invoke from auth-email-hook or client-side after first login/email verification.

**Order shipped** — No eBay trigger. Will be triggered from the admin UI when an order's status is manually updated to "shipped" (future admin action).

### Step 5 — Unsubscribe page

Create `/unsubscribe` route with branded page that validates tokens via `handle-email-unsubscribe`. Add route to `App.tsx`.

### Step 6 — Deploy

Deploy all new/modified edge functions.

### Files Created
- `supabase/functions/_shared/transactional-email-templates/welcome.tsx`
- `supabase/functions/_shared/transactional-email-templates/order-confirmation.tsx`
- `supabase/functions/_shared/transactional-email-templates/order-shipped.tsx`
- `supabase/functions/_shared/transactional-email-templates/registry.ts`
- `supabase/functions/send-transactional-email/index.ts` (scaffolded)
- `supabase/functions/handle-email-unsubscribe/index.ts` (scaffolded)
- `supabase/functions/handle-email-suppression/index.ts` (scaffolded)
- `src/pages/UnsubscribePage.tsx`

### Files Modified
- `supabase/functions/stripe-webhook/index.ts` — order confirmation email trigger
- `supabase/functions/send-transactional-email/index.ts` — BCC logic
- `src/App.tsx` — /unsubscribe route

