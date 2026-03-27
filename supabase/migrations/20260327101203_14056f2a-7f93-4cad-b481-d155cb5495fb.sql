ALTER TABLE public.customer ADD COLUMN IF NOT EXISTS first_name text;
ALTER TABLE public.customer ADD COLUMN IF NOT EXISTS last_name text;
NOTIFY pgrst, 'reload schema';