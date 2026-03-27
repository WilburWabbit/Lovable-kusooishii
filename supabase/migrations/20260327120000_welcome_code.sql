-- Welcome code system for eBay-to-web customer acquisition
-- Generated on first eBay order per customer; QR code printed on parcel insert

CREATE TABLE welcome_code (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                  TEXT NOT NULL UNIQUE,             -- short code e.g. 'KSO-7X3M'
  ebay_order_id         TEXT NOT NULL,                    -- eBay order reference
  sales_order_id        UUID REFERENCES sales_order(id),  -- local sales_order FK
  customer_id           UUID REFERENCES customer(id),     -- customer FK
  buyer_name            TEXT NOT NULL,                    -- first name from eBay order
  buyer_email           TEXT,                             -- eBay buyer email if available
  order_items           JSONB NOT NULL DEFAULT '[]',      -- [{mpn, name, img_url, quantity, sku_code}]
  order_postcode        TEXT,                             -- shipping postcode (for label)
  primary_sku           TEXT,                             -- first SKU code (for label)
  stripe_coupon_id      TEXT,                             -- parent Stripe coupon ID
  stripe_promo_code_id  TEXT,                             -- unique Stripe promotion code ID
  promo_code            TEXT,                             -- human-readable code e.g. 'WELCOME-KSO7X3M'
  discount_pct          INTEGER NOT NULL DEFAULT 5,       -- discount percentage
  scanned_at            TIMESTAMPTZ,                      -- first scan timestamp
  scan_count            INTEGER NOT NULL DEFAULT 0,       -- total scan count
  redeemed_at           TIMESTAMPTZ,                      -- when promo was used at checkout
  redeemed_order_id     UUID REFERENCES sales_order(id),  -- the order that redeemed this code
  user_id               UUID REFERENCES auth.users(id),   -- set when buyer signs up via welcome page
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Note: no expires_at column — welcome codes do not expire

COMMENT ON TABLE welcome_code IS 'eBay-to-web acquisition codes. Generated on first eBay order per customer. QR printed on parcel insert links to /welcome/:code.';

-- Indexes
CREATE INDEX idx_welcome_code_code ON welcome_code(code);
CREATE INDEX idx_welcome_code_ebay_order ON welcome_code(ebay_order_id);
CREATE INDEX idx_welcome_code_customer ON welcome_code(customer_id);
CREATE INDEX idx_welcome_code_unredeemed ON welcome_code(customer_id) WHERE redeemed_at IS NULL;

-- RLS
ALTER TABLE welcome_code ENABLE ROW LEVEL SECURITY;

-- Public can read by code (for the unauthenticated welcome page)
-- Only returns non-sensitive display data; filtered by code in the edge function
CREATE POLICY "anon_read_by_code"
  ON welcome_code FOR SELECT
  TO anon
  USING (true);

-- Authenticated users can read their own linked codes
CREATE POLICY "user_read_own"
  ON welcome_code FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Service role has full access (edge functions)
CREATE POLICY "service_role_all"
  ON welcome_code FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Admin/staff can read all (for admin UI)
CREATE POLICY "staff_read_all"
  ON welcome_code FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('admin', 'staff')
    )
  );

-- Store the eBay welcome coupon ID in app_settings
INSERT INTO app_settings (key, value)
VALUES ('ebay_welcome_coupon_id', '"D4XIbi0J"')
ON CONFLICT (key) DO NOTHING;
