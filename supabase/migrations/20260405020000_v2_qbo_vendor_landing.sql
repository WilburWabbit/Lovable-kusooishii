-- ============================================================
-- Admin V2 — Migration: QBO Vendor Landing Table
--
-- Adds a landing table so QBO vendors can follow the existing
-- land-then-process pipeline before being written to vendor.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.landing_raw_qbo_vendor (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id text NOT NULL,
  raw_payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  status public.landing_status NOT NULL DEFAULT 'pending',
  error_message text,
  correlation_id uuid DEFAULT gen_random_uuid(),
  UNIQUE (external_id)
);

ALTER TABLE public.landing_raw_qbo_vendor ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff manage landing_raw_qbo_vendor" ON public.landing_raw_qbo_vendor;
CREATE POLICY "Staff manage landing_raw_qbo_vendor" ON public.landing_raw_qbo_vendor
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'staff'));

CREATE INDEX IF NOT EXISTS idx_landing_qbo_vendor_status
  ON public.landing_raw_qbo_vendor (status)
  WHERE status = 'pending';
