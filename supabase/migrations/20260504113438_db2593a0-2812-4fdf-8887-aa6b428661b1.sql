ALTER TABLE public.landing_raw_ebay_order
  ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_retry_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_landing_ebay_order_retry
  ON public.landing_raw_ebay_order (status, last_retry_at ASC NULLS FIRST)
  WHERE status IN ('error', 'retrying');