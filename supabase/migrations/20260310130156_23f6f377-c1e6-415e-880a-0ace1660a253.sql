ALTER TABLE public.sales_order ADD COLUMN IF NOT EXISTS doc_number text;

UPDATE public.sales_order
SET doc_number = (regexp_match(notes, '#(.+?) on '))[1]
WHERE notes IS NOT NULL
  AND notes ~ '#.+? on '
  AND doc_number IS NULL;