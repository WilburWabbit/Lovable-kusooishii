-- ============================================================
-- Add fee-aware pricing columns to channel_listing
-- Stores fee calculations alongside the listing price so
-- the UI can show estimated fees and net proceeds.
-- ============================================================

ALTER TABLE public.channel_listing
  ADD COLUMN IF NOT EXISTS fee_adjusted_price NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS estimated_fees NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS estimated_net NUMERIC(12,2);
