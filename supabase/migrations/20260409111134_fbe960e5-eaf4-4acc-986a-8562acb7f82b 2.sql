-- Remove the permissive client-side INSERT policy
DROP POLICY IF EXISTS "Users can insert own change log" ON public.profile_change_log;

-- Only service_role (edge functions, triggers) can insert audit entries
CREATE POLICY "Service role inserts change log"
  ON public.profile_change_log
  FOR INSERT
  TO public
  WITH CHECK (auth.role() = 'service_role');