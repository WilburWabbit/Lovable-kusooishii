
-- Drop the overly permissive public SELECT policy
DROP POLICY IF EXISTS "Clubs readable by all" ON public.club;

-- Create a safe public view that omits financial rates
CREATE OR REPLACE VIEW public.club_public AS
SELECT id, name, slug, city, postcode, location_description, active
FROM public.club;

-- Allow public reads on the view
GRANT SELECT ON public.club_public TO anon, authenticated;

-- Re-add a SELECT policy restricted to authenticated users only
CREATE POLICY "Clubs readable by authenticated"
ON public.club
FOR SELECT
TO authenticated
USING (true);
