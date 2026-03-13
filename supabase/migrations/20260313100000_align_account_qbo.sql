-- Phase 1a: Extend profile table with name fields, company, and social accounts
ALTER TABLE public.profile
  ADD COLUMN IF NOT EXISTS first_name text,
  ADD COLUMN IF NOT EXISTS last_name text,
  ADD COLUMN IF NOT EXISTS company_name text,
  ADD COLUMN IF NOT EXISTS mobile text,
  ADD COLUMN IF NOT EXISTS ebay_username text,
  ADD COLUMN IF NOT EXISTS facebook_handle text,
  ADD COLUMN IF NOT EXISTS instagram_handle text;

-- Phase 1b: Modify customer table - make qbo_customer_id nullable, add user_id link
ALTER TABLE public.customer
  ALTER COLUMN qbo_customer_id DROP NOT NULL;

ALTER TABLE public.customer
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS company_name text,
  ADD COLUMN IF NOT EXISTS web_addr text;

-- Phase 1c: Add address_type to member_address (billing vs delivery)
ALTER TABLE public.member_address
  ADD COLUMN IF NOT EXISTS address_type text NOT NULL DEFAULT 'delivery';

ALTER TABLE public.member_address
  ADD CONSTRAINT member_address_type_check
    CHECK (address_type IN ('billing', 'delivery'));

-- Phase 1d: Create profile_change_log for change history
CREATE TABLE IF NOT EXISTS public.profile_change_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  effective_date timestamptz NOT NULL DEFAULT now(),
  field_name text NOT NULL,
  old_value text,
  new_value text,
  changed_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.profile_change_log ENABLE ROW LEVEL SECURITY;

-- Users can read their own change history
CREATE POLICY "Users can view own change log"
  ON public.profile_change_log FOR SELECT
  USING (auth.uid() = user_id);

-- Users can insert their own change log entries
CREATE POLICY "Users can insert own change log"
  ON public.profile_change_log FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Staff/admin can view all change logs
CREATE POLICY "Staff can view all change logs"
  ON public.profile_change_log FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_roles.user_id = auth.uid()
        AND user_roles.role IN ('admin', 'staff')
    )
  );

-- Phase 1e: Create admin RPC for detailed user listing with order stats
CREATE OR REPLACE FUNCTION public.admin_list_users_detailed()
RETURNS TABLE (
  user_id uuid,
  email text,
  display_name text,
  first_name text,
  last_name text,
  company_name text,
  avatar_url text,
  phone text,
  mobile text,
  ebay_username text,
  facebook_handle text,
  instagram_handle text,
  roles text[],
  order_count bigint,
  total_order_value numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Check caller is admin or staff
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role IN ('admin', 'staff')
  ) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  RETURN QUERY
  SELECT
    u.id AS user_id,
    u.email::text AS email,
    p.display_name,
    p.first_name,
    p.last_name,
    p.company_name,
    p.avatar_url,
    p.phone,
    p.mobile,
    p.ebay_username,
    p.facebook_handle,
    p.instagram_handle,
    COALESCE(
      array_agg(DISTINCT ur.role::text) FILTER (WHERE ur.role IS NOT NULL),
      ARRAY[]::text[]
    ) AS roles,
    COUNT(DISTINCT so.id) AS order_count,
    COALESCE(SUM(so.gross_total), 0) AS total_order_value
  FROM auth.users u
  LEFT JOIN public.profile p ON p.user_id = u.id
  LEFT JOIN public.user_roles ur ON ur.user_id = u.id
  LEFT JOIN public.sales_order so
    ON so.user_id = u.id
    OR (so.guest_email IS NOT NULL AND lower(so.guest_email) = lower(u.email))
  GROUP BY u.id, u.email, p.display_name, p.first_name, p.last_name,
           p.company_name, p.avatar_url, p.phone, p.mobile,
           p.ebay_username, p.facebook_handle, p.instagram_handle;
END;
$$;
