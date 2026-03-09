
-- Make catalog_product_id nullable for standalone SKUs
ALTER TABLE public.sku ALTER COLUMN catalog_product_id DROP NOT NULL;

-- Add name column for standalone SKUs (display when no catalog product linked)
ALTER TABLE public.sku ADD COLUMN name text;
