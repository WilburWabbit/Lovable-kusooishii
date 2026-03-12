
DROP POLICY "Profiles viewable by everyone" ON public.profile;

CREATE POLICY "Profiles viewable by owner or staff" ON public.profile
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'staff'::app_role));
