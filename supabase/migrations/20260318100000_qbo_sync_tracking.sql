-- QBO sync tracking columns on sales_order
-- Ensures every sale records its QBO sync state so failed syncs are retried
-- and persistent failures alert the admin.

ALTER TABLE public.sales_order
  ADD COLUMN qbo_sales_receipt_id text,
  ADD COLUMN qbo_customer_id text,
  ADD COLUMN qbo_sync_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN qbo_retry_count integer NOT NULL DEFAULT 0,
  ADD COLUMN qbo_last_error text,
  ADD COLUMN qbo_last_attempt_at timestamptz;

-- Existing orders are assumed already reconciled with QBO
UPDATE public.sales_order SET qbo_sync_status = 'synced' WHERE qbo_sync_status = 'pending';

-- Orders imported FROM QBO already have their QBO IDs — backfill
UPDATE public.sales_order
  SET qbo_sales_receipt_id = origin_reference
  WHERE origin_channel IN ('qbo', 'qbo_refund')
    AND qbo_sales_receipt_id IS NULL;

-- Index for the retry function to efficiently find orders needing sync
CREATE INDEX idx_sales_order_qbo_sync_pending
  ON public.sales_order (qbo_sync_status, qbo_last_attempt_at ASC NULLS FIRST)
  WHERE qbo_sync_status IN ('pending', 'retrying');

-- Admin alert table — persistent notifications requiring acknowledgement
CREATE TABLE public.admin_alert (
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

ALTER TABLE public.admin_alert ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin alerts managed by staff"
  ON public.admin_alert
  FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'staff'::app_role));

-- Real-time subscription for admin alerts
ALTER PUBLICATION supabase_realtime ADD TABLE public.admin_alert;
