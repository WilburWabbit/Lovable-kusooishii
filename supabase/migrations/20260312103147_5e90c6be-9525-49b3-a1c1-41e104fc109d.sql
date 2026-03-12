
ALTER TABLE public.shipping_rate_table
  ADD COLUMN IF NOT EXISTS size_band text,
  ADD COLUMN IF NOT EXISTS max_girth_cm numeric,
  ADD COLUMN IF NOT EXISTS max_width_cm numeric,
  ADD COLUMN IF NOT EXISTS max_depth_cm numeric,
  ADD COLUMN IF NOT EXISTS price_ex_vat numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS price_inc_vat numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vat_exempt boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tracked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS max_compensation numeric,
  ADD COLUMN IF NOT EXISTS est_delivery text;
