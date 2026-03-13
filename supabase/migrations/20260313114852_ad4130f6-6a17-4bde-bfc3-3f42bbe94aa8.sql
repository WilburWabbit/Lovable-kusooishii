DROP POLICY "Users manage own club links" ON public.member_club_link;
CREATE POLICY "Users manage own club links" ON public.member_club_link
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id AND approved = false);