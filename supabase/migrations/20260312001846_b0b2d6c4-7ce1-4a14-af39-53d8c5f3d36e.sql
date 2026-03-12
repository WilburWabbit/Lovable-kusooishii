DROP INDEX IF EXISTS sku_qbo_item_id_unique;
ALTER TABLE public.sku ADD CONSTRAINT sku_qbo_item_id_unique UNIQUE (qbo_item_id);