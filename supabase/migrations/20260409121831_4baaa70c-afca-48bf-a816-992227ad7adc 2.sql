-- Fix 1: Vendor table - drop existing and recreate
DROP POLICY IF EXISTS "auth_manage_vendor" ON public.vendor;
DROP POLICY IF EXISTS "vendor_staff_write" ON public.vendor;

CREATE POLICY "vendor_staff_write"
  ON public.vendor FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'staff'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'staff'::app_role));

-- Fix 2: User roles - lock down writes to service_role only
DROP POLICY IF EXISTS "Service role inserts user_roles" ON public.user_roles;
DROP POLICY IF EXISTS "Service role updates user_roles" ON public.user_roles;
DROP POLICY IF EXISTS "Service role deletes user_roles" ON public.user_roles;

CREATE POLICY "Service role inserts user_roles"
  ON public.user_roles FOR INSERT
  TO public
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role updates user_roles"
  ON public.user_roles FOR UPDATE
  TO public
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role deletes user_roles"
  ON public.user_roles FOR DELETE
  TO public
  USING (auth.role() = 'service_role');