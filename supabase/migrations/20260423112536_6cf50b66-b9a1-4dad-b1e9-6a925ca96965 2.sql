-- Remove orphaned purchase batch PO-667 (header + line item, 0 stock units)
DELETE FROM public.purchase_line_items WHERE batch_id = 'PO-667';
DELETE FROM public.purchase_batches WHERE id = 'PO-667';