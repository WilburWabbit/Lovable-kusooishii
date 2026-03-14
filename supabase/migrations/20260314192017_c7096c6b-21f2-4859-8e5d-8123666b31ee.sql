
-- Recreate the view with SECURITY INVOKER (safe default)
CREATE OR REPLACE VIEW public.club_public
WITH (security_invoker = true) AS
SELECT id, name, slug, city, postcode, location_description, active
FROM public.club;
