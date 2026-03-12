-- Add brand to product table (parsed from QBO parent item name)
ALTER TABLE public.product ADD COLUMN IF NOT EXISTS brand text;

-- Add QBO parent item ID to SKU for traceability
ALTER TABLE public.sku ADD COLUMN IF NOT EXISTS qbo_parent_item_id text;
