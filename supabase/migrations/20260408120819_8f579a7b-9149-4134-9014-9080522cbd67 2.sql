-- Add missing enum values to v2_order_status
ALTER TYPE v2_order_status ADD VALUE IF NOT EXISTS 'refunded';
ALTER TYPE v2_order_status ADD VALUE IF NOT EXISTS 'cancelled';

-- Add delivered_at column to sales_order
ALTER TABLE sales_order ADD COLUMN IF NOT EXISTS delivered_at timestamptz;