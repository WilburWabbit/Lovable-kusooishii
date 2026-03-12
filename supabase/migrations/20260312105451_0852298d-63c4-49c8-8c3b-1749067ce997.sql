ALTER TABLE public.channel_listing
  ADD COLUMN IF NOT EXISTS price_floor numeric DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS price_target numeric DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS price_ceiling numeric DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS confidence_score numeric DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS pricing_notes text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS priced_at timestamptz DEFAULT NULL;