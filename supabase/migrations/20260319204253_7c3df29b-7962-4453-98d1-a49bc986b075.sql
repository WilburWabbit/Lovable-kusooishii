ALTER TABLE public.sku ADD COLUMN IF NOT EXISTS qbo_parent_item_id text;
NOTIFY pgrst, 'reload schema';