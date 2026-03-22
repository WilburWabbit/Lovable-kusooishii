-- Stripe test/sandbox mode support
-- Adds app_settings table (single-row) and is_test flags on transaction tables

-- Single-row app settings table
CREATE TABLE IF NOT EXISTS app_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_test_mode boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);

-- Seed the single canonical row
INSERT INTO app_settings (id)
VALUES ('00000000-0000-0000-0000-000000000001')
ON CONFLICT (id) DO NOTHING;

-- RLS: readable by authenticated users, writes via service role in edge functions
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read app_settings"
  ON app_settings FOR SELECT TO authenticated USING (true);

-- Add is_test flag to sales_order
ALTER TABLE sales_order ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;

-- Add is_test flag to landing_raw_stripe_event
ALTER TABLE landing_raw_stripe_event ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;

-- Index for fast cleanup queries
CREATE INDEX IF NOT EXISTS idx_sales_order_is_test ON sales_order (is_test) WHERE is_test = true;
CREATE INDEX IF NOT EXISTS idx_landing_raw_stripe_event_is_test ON landing_raw_stripe_event (is_test) WHERE is_test = true;
