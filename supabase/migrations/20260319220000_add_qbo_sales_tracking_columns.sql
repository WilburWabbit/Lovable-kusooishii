-- Defensive re-add of QBO tracking columns on sales_order.
-- Migration 20260318100000 adds these columns but bundles them with
-- CREATE TABLE admin_alert in one transaction. If admin_alert already
-- existed, the entire migration rolled back — leaving these columns missing.
-- This migration uses IF NOT EXISTS so it's safe to run regardless.

ALTER TABLE public.sales_order
  ADD COLUMN IF NOT EXISTS qbo_sales_receipt_id text,
  ADD COLUMN IF NOT EXISTS qbo_customer_id text,
  ADD COLUMN IF NOT EXISTS qbo_sync_status text DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS qbo_retry_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS qbo_last_error text,
  ADD COLUMN IF NOT EXISTS qbo_last_attempt_at timestamptz;

-- Mark existing orders as synced (they predate this tracking)
UPDATE public.sales_order
  SET qbo_sync_status = 'synced'
  WHERE qbo_sync_status = 'pending'
    AND created_at < now() - interval '1 hour';

-- Backfill QBO IDs for orders imported from QBO
UPDATE public.sales_order
  SET qbo_sales_receipt_id = origin_reference
  WHERE origin_channel IN ('qbo', 'qbo_refund')
    AND qbo_sales_receipt_id IS NULL
    AND origin_reference IS NOT NULL;

-- Ensure admin_alert table exists (may also have been rolled back)
CREATE TABLE IF NOT EXISTS public.admin_alert (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  severity text NOT NULL DEFAULT 'warning',
  category text NOT NULL,
  title text NOT NULL,
  detail text,
  entity_type text,
  entity_id uuid,
  acknowledged boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Index for the retry function to find orders needing sync
CREATE INDEX IF NOT EXISTS idx_sales_order_qbo_sync_pending
  ON public.sales_order (qbo_sync_status, qbo_last_attempt_at ASC NULLS FIRST)
  WHERE qbo_sync_status IN ('pending', 'retrying');
