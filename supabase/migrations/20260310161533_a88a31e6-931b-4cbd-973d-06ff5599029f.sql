ALTER TABLE public.product
  ADD COLUMN IF NOT EXISTS age_range text,
  ADD COLUMN IF NOT EXISTS length_cm numeric,
  ADD COLUMN IF NOT EXISTS width_cm numeric,
  ADD COLUMN IF NOT EXISTS height_cm numeric,
  ADD COLUMN IF NOT EXISTS weight_kg numeric;