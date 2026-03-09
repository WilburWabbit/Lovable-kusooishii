

## Plan: Admin User Role Management

### Summary
Add an admin user management page at `/admin/settings/users` where admins can view all users, assign/remove roles (admin, staff, member), and set `contact@kusooishii.com` as admin. The Settings page becomes a sub-routed section with a sidebar/tab for "Users".

### Database Changes

1. **Migration: Add `staff` to `app_role` enum** — already exists (`admin | staff | member`), no change needed.

2. **Migration: Create an admin-only database function `admin_list_users`** (security definer) that joins `profile` and `user_roles` to return a list of users with their roles. This avoids RLS issues since `profile` is public-read but `user_roles` is restricted.

3. **Migration: Create `admin_set_user_role` function** (security definer) that allows admins to insert/delete roles for a user. Validates the caller has `admin` role.

4. **Data operation: Insert admin role for `contact@kusooishii.com`** — look up the user by email from `auth.users` via a security definer function, then insert into `user_roles`.

### Frontend Changes

1. **New page: `src/pages/admin/UsersSettingsPage.tsx`**
   - Table listing all users (display name, email, roles)
   - Each row has role toggles/badges for admin, staff, member
   - Calls the security definer RPCs to list and mutate roles
   - Uses existing `Table` components and design system

2. **Update routing in `App.tsx`**
   - Add route `/admin/settings/users` → `UsersSettingsPage`

3. **Update `BackOfficeSidebar.tsx`**
   - Add "Users" sub-item under Settings, or keep Settings as parent and add Users as a nested link

4. **Update `SettingsPage`**
   - Convert to a settings hub with navigation to sub-sections (Users being the first), or redirect `/admin/settings` to show a settings overview with links

### Security Model
- All user management RPCs use `SECURITY DEFINER` functions that check `has_role(auth.uid(), 'admin')` internally
- No direct table access for role mutations — everything goes through validated functions
- The existing RLS on `user_roles` (read-only for own user) stays intact

### Technical Details

**`admin_list_users` function:**
```sql
CREATE OR REPLACE FUNCTION public.admin_list_users()
RETURNS TABLE(user_id uuid, email text, display_name text, avatar_url text, roles app_role[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT p.user_id, u.email, p.display_name, p.avatar_url,
         COALESCE(array_agg(ur.role) FILTER (WHERE ur.role IS NOT NULL), '{}')
  FROM profile p
  JOIN auth.users u ON u.id = p.user_id
  LEFT JOIN user_roles ur ON ur.user_id = p.user_id
  GROUP BY p.user_id, u.email, p.display_name, p.avatar_url
$$;
```

**`admin_set_user_role` function:**
```sql
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
```

**Seed admin role** via a migration function that looks up the user by email in `auth.users`.

