-- ============================================================
-- Add barcode fields (EAN, UPC, ISBN) and girth to product table
-- EAN is the primary barcode; UPC and ISBN are fallbacks for
-- Google Merchant Center and Meta integrations.
-- Girth = length + width + height (used for shipping quotes).
-- ============================================================

ALTER TABLE public.product
  ADD COLUMN IF NOT EXISTS ean text,
  ADD COLUMN IF NOT EXISTS upc text,
  ADD COLUMN IF NOT EXISTS isbn text,
  ADD COLUMN IF NOT EXISTS girth_cm numeric GENERATED ALWAYS AS (
    COALESCE(length_cm, 0) + COALESCE(width_cm, 0) + COALESCE(height_cm, 0)
  ) STORED;
