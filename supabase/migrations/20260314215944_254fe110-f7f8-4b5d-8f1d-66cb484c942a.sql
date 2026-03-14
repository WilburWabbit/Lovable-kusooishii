
DROP POLICY "Clubs readable by authenticated" ON public.club;

CREATE POLICY "Clubs readable by staff" ON public.club
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'staff'::app_role));
