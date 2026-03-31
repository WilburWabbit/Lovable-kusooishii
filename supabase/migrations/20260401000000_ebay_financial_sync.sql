-- ============================================================
-- eBay Financial Sync — Schema
-- Adds transaction-level payout detail and QBO account mapping.
-- ============================================================

-- ─── 1. Extend payouts table ────────────────────────────────

ALTER TABLE payouts
  ADD COLUMN IF NOT EXISTS bank_reference text,
  ADD COLUMN IF NOT EXISTS transaction_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS matched_order_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unmatched_transaction_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS qbo_sync_error text,
  ADD COLUMN IF NOT EXISTS sync_attempted_at timestamptz;

-- ─── 2. eBay payout transactions ────────────────────────────

CREATE TABLE IF NOT EXISTS ebay_payout_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payout_id text NOT NULL,                           -- eBay payoutId (matches payouts.external_payout_id)
  transaction_id text NOT NULL,                      -- eBay transactionId
  transaction_type text NOT NULL,                    -- SALE, REFUND, SHIPPING_LABEL, TRANSFER, CREDIT, NON_SALE_CHARGE
  transaction_status text NOT NULL,                  -- PAYOUT, FUNDS_ON_HOLD, etc.
  transaction_date timestamptz NOT NULL,
  order_id text,                                     -- eBay orderId (for SALE/REFUND types)
  buyer_username text,
  gross_amount numeric(10,2) NOT NULL,               -- totalFeeBasisAmount (before fees)
  total_fees numeric(10,2) NOT NULL DEFAULT 0,       -- totalFeeAmount (absolute value)
  net_amount numeric(10,2) NOT NULL,                 -- netAmount
  currency text NOT NULL DEFAULT 'GBP',
  fee_details jsonb NOT NULL DEFAULT '[]',           -- Array of { feeType, amount }
  memo text,                                         -- transactionMemo from eBay
  -- Matching
  matched_order_id uuid,                             -- FK → sales_order.id
  matched boolean NOT NULL DEFAULT false,
  match_method text,                                 -- 'auto_ebay_order_id', 'manual', 'skipped'
  -- QBO linking
  qbo_sales_receipt_id text,                         -- Copied from matched order for convenience
  created_at timestamptz DEFAULT now(),
  UNIQUE(transaction_id, transaction_type)
);

-- ─── 3. QBO account mapping ────────────────────────────────

CREATE TABLE IF NOT EXISTS qbo_account_mapping (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose text UNIQUE NOT NULL,                      -- e.g., 'bank_account', 'ebay_selling_fees'
  qbo_account_id text NOT NULL,                      -- QBO Account Id
  qbo_account_name text NOT NULL,                    -- Human-readable name for UI
  account_type text NOT NULL,                        -- QBO account type: Bank, Expense, OtherCurrentAsset
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ─── 4. Indexes ─────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_ebay_payout_txns_payout_id
  ON ebay_payout_transactions(payout_id);

CREATE INDEX IF NOT EXISTS idx_ebay_payout_txns_order_id
  ON ebay_payout_transactions(order_id);

CREATE INDEX IF NOT EXISTS idx_ebay_payout_txns_matched
  ON ebay_payout_transactions(matched);

CREATE INDEX IF NOT EXISTS idx_payouts_sync_status
  ON payouts(qbo_sync_status);

-- ─── 5. RLS ─────────────────────────────────────────────────

ALTER TABLE ebay_payout_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE qbo_account_mapping ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin access" ON ebay_payout_transactions
  FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "Admin access" ON qbo_account_mapping
  FOR ALL USING (auth.role() = 'authenticated');
