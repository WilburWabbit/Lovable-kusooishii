ALTER TABLE public.sales_order ADD COLUMN txn_date date;

UPDATE public.sales_order
SET txn_date = (regexp_match(notes, 'on (\d{4}-\d{2}-\d{2})'))[1]::date
WHERE notes IS NOT NULL
  AND notes ~ 'on \d{4}-\d{2}-\d{2}'
  AND txn_date IS NULL;