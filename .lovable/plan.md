

## Plan: Orders Schema with Guest and Authenticated Checkout Support

### Summary
Create `sales_order` and `sales_order_line` tables following the design spec, with guest checkout support via inline guest fields and an optional `user_id` for authenticated users. Add RLS policies and indexes.

### Database Migration

**Table: `sales_order`**

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | default `gen_random_uuid()` |
| `order_number` | text, unique, not null | Human-readable, generated via sequence |
| `origin_channel` | text, not null | `'web'`, `'ebay'`, `'bricklink'`, `'brickowl'`, `'cash'` |
| `origin_reference` | text | External order ID from channel |
| `user_id` | uuid, nullable | Links to `auth.users` for authenticated buyers |
| `guest_email` | text, nullable | For guest checkout |
| `guest_name` | text, nullable | For guest checkout |
| `status` | `order_status` enum | Default `'pending_payment'` |
| `currency` | text | Default `'GBP'` |
| `merchandise_subtotal` | numeric, not null | |
| `discount_total` | numeric | Default `0` |
| `shipping_total` | numeric | Default `0` |
| `tax_total` | numeric | Default `0` |
| `gross_total` | numeric, not null | |
| `club_id` | uuid, nullable FK → `club` | |
| `club_discount_amount` | numeric | Default `0` |
| `club_commission_amount` | numeric | Default `0` |
| `payment_reference` | text, nullable | Stripe payment intent ID |
| `shipping_name` | text | Shipping address fields inline |
| `shipping_line_1` | text | |
| `shipping_line_2` | text, nullable | |
| `shipping_city` | text | |
| `shipping_county` | text, nullable | |
| `shipping_postcode` | text | |
| `shipping_country` | text | Default `'GB'` |
| `notes` | text, nullable | |
| `created_at` | timestamptz | Default `now()` |
| `updated_at` | timestamptz | Default `now()` |

Validation trigger: ensure either `user_id` or `guest_email` is set.

**Table: `sales_order_line`**

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `sales_order_id` | uuid FK → `sales_order` ON DELETE CASCADE | |
| `sku_id` | uuid FK → `sku` | |
| `stock_unit_id` | uuid, nullable FK → `stock_unit` | Assigned at picking |
| `quantity` | integer | Default `1` |
| `unit_price` | numeric, not null | |
| `line_discount` | numeric | Default `0` |
| `line_total` | numeric, not null | |
| `created_at` | timestamptz | |

**Sequence for order numbers:**
```sql
CREATE SEQUENCE sales_order_number_seq;
```
Default for `order_number`: `'KO-' || lpad(nextval('sales_order_number_seq')::text, 7, '0')`

### RLS Policies

- **Members read own orders:** `SELECT` where `auth.uid() = user_id`
- **Staff/admin full access:** `ALL` where `has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'staff')`
- **Guest orders:** not directly queryable by guests (retrieved via order confirmation / email link in future)
- **Order lines** inherit access through a subquery join to `sales_order`

### Indexes
- `sales_order(user_id)`
- `sales_order(guest_email)`
- `sales_order(status)`
- `sales_order(origin_channel)`
- `sales_order(order_number)`
- `sales_order_line(sales_order_id)`
- `sales_order_line(sku_id)`

### Triggers
- `update_updated_at` on `sales_order` (reuse existing function)
- Validation trigger ensuring `user_id IS NOT NULL OR guest_email IS NOT NULL`

### What This Does NOT Include
- Stripe integration (separate task)
- Cart/basket logic
- Shipment, payment, refund tables (future iterations per spec)
- Guest order "claim" flow (future — lets a user link past guest orders by email after signup)

