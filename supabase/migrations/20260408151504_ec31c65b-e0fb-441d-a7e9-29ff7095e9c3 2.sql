-- 1. Fix ebay_payout_transactions: restrict to admin/staff only
DROP POLICY IF EXISTS "Admin access" ON public.ebay_payout_transactions;

CREATE POLICY "Staff manage ebay payout transactions"
  ON public.ebay_payout_transactions
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));

-- 2. Add missing UPDATE and DELETE policies on storage.objects for 'media' bucket
CREATE POLICY "Staff can update media"
  ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'media' AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff')));

CREATE POLICY "Staff can delete media"
  ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'media' AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff')));