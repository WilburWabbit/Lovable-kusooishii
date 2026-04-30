-- Drop the overpermissive policy that grants all authenticated users full access
DROP POLICY IF EXISTS "Admin access" ON public.qbo_account_mapping;

-- Create proper admin/staff-only policy
CREATE POLICY "Admin and staff manage qbo_account_mapping"
  ON public.qbo_account_mapping
  FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'staff'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'staff'::app_role));