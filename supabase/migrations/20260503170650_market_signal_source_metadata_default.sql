ALTER TABLE public.market_signal_source
  ALTER COLUMN metadata SET DEFAULT '{}'::jsonb;

UPDATE public.market_signal_source
SET metadata = '{}'::jsonb
WHERE metadata IS NULL;
