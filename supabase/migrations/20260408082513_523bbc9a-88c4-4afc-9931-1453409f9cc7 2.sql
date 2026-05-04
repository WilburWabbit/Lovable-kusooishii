-- Add tier and destination columns to shipping_rate_table
ALTER TABLE public.shipping_rate_table
  ADD COLUMN IF NOT EXISTS tier text,
  ADD COLUMN IF NOT EXISTS destination text NOT NULL DEFAULT 'domestic';

-- Notify PostgREST to pick up schema changes
NOTIFY pgrst, 'reload schema';