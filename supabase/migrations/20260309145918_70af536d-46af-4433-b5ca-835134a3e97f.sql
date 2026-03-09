
-- Admin-only function to list all users with their roles
CREATE OR REPLACE FUNCTION public.admin_list_users()
RETURNS TABLE(user_id uuid, email text, display_name text, avatar_url text, roles app_role[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT p.user_id, u.email::text, p.display_name, p.avatar_url,
         COALESCE(array_agg(ur.role) FILTER (WHERE ur.role IS NOT NULL), '{}')
  FROM profile p
  JOIN auth.users u ON u.id = p.user_id
  LEFT JOIN user_roles ur ON ur.user_id = p.user_id
  WHERE has_role(auth.uid(), 'admin')
  GROUP BY p.user_id, u.email, p.display_name, p.avatar_url;
$$;

-- Admin-only function to assign/remove a role for a user
CREATE OR REPLACE FUNCTION public.admin_set_user_role(
  target_user_id uuid, target_role app_role, assign boolean
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  IF assign THEN
    INSERT INTO user_roles(user_id, role) VALUES(target_user_id, target_role)
    ON CONFLICT(user_id, role) DO NOTHING;
  ELSE
    DELETE FROM user_roles WHERE user_id = target_user_id AND role = target_role;
  END IF;
END;$$;

-- Seed admin role for contact@kusooishii.com
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::app_role FROM auth.users WHERE email = 'contact@kusooishii.com'
ON CONFLICT (user_id, role) DO NOTHING;
