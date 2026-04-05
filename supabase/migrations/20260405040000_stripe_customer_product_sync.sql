-- ============================================================
-- Admin V2 — Migration: Stripe Customer + Product Sync IDs
--
-- Stores Stripe object ids locally so customers and SKU variants
-- can be synced to Stripe and reused by the in-person sales flow.
-- ============================================================

ALTER TABLE public.customer
  ADD COLUMN IF NOT EXISTS stripe_customer_id text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_stripe_customer_id_unique
  ON public.customer (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

COMMENT ON COLUMN public.customer.stripe_customer_id IS
  'Stripe Customer ID used for in-person sales and checkout reconciliation.';

ALTER TABLE public.sku
  ADD COLUMN IF NOT EXISTS stripe_product_id text,
  ADD COLUMN IF NOT EXISTS stripe_price_id text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sku_stripe_product_id_unique
  ON public.sku (stripe_product_id)
  WHERE stripe_product_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sku_stripe_price_id_unique
  ON public.sku (stripe_price_id)
  WHERE stripe_price_id IS NOT NULL;

COMMENT ON COLUMN public.sku.stripe_product_id IS
  'Stripe Product ID for the SKU variant in the Stripe catalog.';

COMMENT ON COLUMN public.sku.stripe_price_id IS
  'Current active Stripe Price ID for the SKU variant.';
