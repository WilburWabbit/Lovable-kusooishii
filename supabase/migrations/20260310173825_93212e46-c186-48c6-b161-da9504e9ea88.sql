ALTER TABLE public.sales_order
  ADD COLUMN shipped_via text,
  ADD COLUMN shipped_date date,
  ADD COLUMN tracking_number text;