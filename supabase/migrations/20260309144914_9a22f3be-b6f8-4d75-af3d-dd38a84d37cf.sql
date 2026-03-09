-- ========================================
-- Profiles, Wishlists, Clubs — Auth Phase
-- ========================================

-- Member profiles
CREATE TABLE public.profile (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  avatar_url TEXT,
  phone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profile ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Profiles viewable by everyone" ON public.profile
  FOR SELECT USING (true);
CREATE POLICY "Users can update own profile" ON public.profile
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own profile" ON public.profile
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_profile_updated_at BEFORE UPDATE ON public.profile
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Auto-create profile + member role on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profile (user_id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data ->> 'display_name', split_part(NEW.email, '@', 1)));

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'member');

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Member addresses
CREATE TABLE public.member_address (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT 'Home',
  line_1 TEXT NOT NULL,
  line_2 TEXT,
  city TEXT NOT NULL,
  county TEXT,
  postcode TEXT NOT NULL,
  country TEXT NOT NULL DEFAULT 'GB',
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.member_address ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own addresses" ON public.member_address
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_member_address_updated_at BEFORE UPDATE ON public.member_address
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Clubs
CREATE TABLE public.club (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  location_description TEXT,
  city TEXT,
  postcode TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  discount_rate NUMERIC(5,4) NOT NULL DEFAULT 0.05,
  commission_rate NUMERIC(5,4) NOT NULL DEFAULT 0.05,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.club ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Clubs readable by all" ON public.club
  FOR SELECT USING (true);
CREATE POLICY "Clubs managed by admin" ON public.club
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_club_updated_at BEFORE UPDATE ON public.club
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Member-club membership
CREATE TABLE public.member_club_link (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  club_id UUID NOT NULL REFERENCES public.club(id) ON DELETE CASCADE,
  approved BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, club_id)
);
ALTER TABLE public.member_club_link ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own club links" ON public.member_club_link
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins manage all club links" ON public.member_club_link
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Wishlists
CREATE TABLE public.wishlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'My Wishlist',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.wishlist ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own wishlists" ON public.wishlist
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_wishlist_updated_at BEFORE UPDATE ON public.wishlist
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Wishlist items
CREATE TABLE public.wishlist_item (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wishlist_id UUID NOT NULL REFERENCES public.wishlist(id) ON DELETE CASCADE,
  catalog_product_id UUID NOT NULL REFERENCES public.catalog_product(id) ON DELETE CASCADE,
  preferred_grade condition_grade,
  max_price NUMERIC(12,2),
  notify_on_stock BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (wishlist_id, catalog_product_id)
);
ALTER TABLE public.wishlist_item ENABLE ROW LEVEL SECURITY;

-- RLS via join to wishlist owner
CREATE POLICY "Users manage own wishlist items" ON public.wishlist_item
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.wishlist w WHERE w.id = wishlist_id AND w.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.wishlist w WHERE w.id = wishlist_id AND w.user_id = auth.uid()
    )
  );

-- Auto-create default wishlist on profile creation
CREATE OR REPLACE FUNCTION public.handle_new_profile_wishlist()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.wishlist (user_id, name) VALUES (NEW.user_id, 'My Wishlist');
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_profile_created_wishlist
  AFTER INSERT ON public.profile
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_profile_wishlist();