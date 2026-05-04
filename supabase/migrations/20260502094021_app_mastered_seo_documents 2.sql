CREATE TABLE public.seo_document (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_key text NOT NULL UNIQUE,
  document_type text NOT NULL CHECK (document_type IN ('route', 'product', 'theme', 'collection', 'system')),
  route_path text,
  entity_type text,
  entity_id uuid,
  entity_reference text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  published_revision_id uuid,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (document_type <> 'route' OR route_path IS NOT NULL),
  CHECK (document_type <> 'product' OR entity_reference IS NOT NULL)
);

CREATE TABLE public.seo_revision (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seo_document_id uuid NOT NULL REFERENCES public.seo_document(id) ON DELETE CASCADE,
  revision_number integer NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  canonical_path text NOT NULL,
  canonical_url text NOT NULL,
  title_tag text NOT NULL,
  meta_description text NOT NULL,
  indexation_policy text NOT NULL DEFAULT 'index' CHECK (indexation_policy IN ('index', 'noindex')),
  robots_directive text NOT NULL DEFAULT 'index, follow',
  open_graph jsonb NOT NULL DEFAULT '{}'::jsonb,
  twitter_card jsonb NOT NULL DEFAULT '{}'::jsonb,
  breadcrumbs jsonb NOT NULL DEFAULT '[]'::jsonb,
  structured_data jsonb NOT NULL DEFAULT '[]'::jsonb,
  image_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  sitemap jsonb NOT NULL DEFAULT '{}'::jsonb,
  geo jsonb NOT NULL DEFAULT '{}'::jsonb,
  keywords text[] NOT NULL DEFAULT '{}'::text[],
  source text NOT NULL DEFAULT 'manual',
  change_summary text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (seo_document_id, revision_number)
);

ALTER TABLE public.seo_document
  ADD CONSTRAINT seo_document_published_revision_id_fkey
  FOREIGN KEY (published_revision_id)
  REFERENCES public.seo_revision(id)
  ON DELETE SET NULL;

CREATE INDEX idx_seo_document_document_type ON public.seo_document(document_type);
CREATE INDEX idx_seo_document_route_path ON public.seo_document(route_path);
CREATE INDEX idx_seo_document_entity_reference ON public.seo_document(entity_type, entity_reference);
CREATE INDEX idx_seo_document_published_revision_id ON public.seo_document(published_revision_id);
CREATE INDEX idx_seo_revision_document_created ON public.seo_revision(seo_document_id, created_at DESC);
CREATE INDEX idx_seo_revision_status ON public.seo_revision(status);

CREATE TRIGGER trg_seo_document_updated_at
  BEFORE UPDATE ON public.seo_document
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.seo_document ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seo_revision ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.seo_document TO anon, authenticated;
GRANT SELECT ON public.seo_revision TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.seo_document TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.seo_revision TO authenticated;
GRANT ALL ON public.seo_document TO service_role;
GRANT ALL ON public.seo_revision TO service_role;

CREATE POLICY "Published SEO documents are public"
  ON public.seo_document
  FOR SELECT
  TO anon, authenticated
  USING (status = 'published' AND published_revision_id IS NOT NULL);

CREATE POLICY "Staff manage SEO documents"
  ON public.seo_document
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'staff'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'staff'::app_role));

CREATE POLICY "Published SEO revisions are public"
  ON public.seo_revision
  FOR SELECT
  TO anon, authenticated
  USING (
    status = 'published'
    AND id IN (
      SELECT published_revision_id
      FROM public.seo_document
      WHERE status = 'published'
    )
  );

CREATE POLICY "Staff manage SEO revisions"
  ON public.seo_revision
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'staff'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'staff'::app_role));

WITH seed (
  document_key,
  route_path,
  title_tag,
  meta_description,
  indexation_policy,
  robots_directive,
  breadcrumb_label,
  sitemap_include,
  sitemap_family,
  sitemap_changefreq,
  sitemap_priority
) AS (
  VALUES
    ('route:/', '/', 'Graded LEGO Sets & Minifigures', 'Shop graded LEGO sets and minifigures with clear condition notes, fair pricing, and fast UK dispatch from Kuso Oishii.', 'index', 'index, follow', 'Home', true, 'storefront', 'monthly', 1.0),
    ('route:/browse', '/browse', 'Browse LEGO Sets', 'Browse graded LEGO sets and minifigures with clear condition data at Kuso Oishii.', 'index', 'index, follow', 'Browse LEGO Sets', true, 'browse', 'monthly', 0.7),
    ('route:/themes', '/themes', 'Browse Themes', 'Browse LEGO sets by theme at Kuso Oishii.', 'index', 'index, follow', 'Browse Themes', true, 'browse', 'monthly', 0.7),
    ('route:/new-arrivals', '/new-arrivals', 'New Arrivals', 'See the latest graded LEGO stock newly added to Kuso Oishii.', 'index', 'index, follow', 'New Arrivals', true, 'browse', 'weekly', 0.7),
    ('route:/deals', '/deals', 'Deals', 'Explore graded LEGO deals with clear condition details and fair UK pricing.', 'index', 'index, follow', 'Deals', true, 'browse', 'weekly', 0.7),
    ('route:/about', '/about', 'About Kuso Oishii', 'Learn about Kuso Oishii, our LEGO resale standards, and how we grade every set before listing.', 'index', 'index, follow', 'About', true, 'content', 'monthly', 0.7),
    ('route:/faq', '/faq', 'Frequently Asked Questions', 'Answers to common questions about LEGO set conditions, ordering, shipping, and returns at Kuso Oishii.', 'index', 'index, follow', 'Frequently Asked Questions', true, 'content', 'monthly', 0.7),
    ('route:/grading', '/grading', 'LEGO Set Grading Guide', 'Understand Kuso Oishii condition grades for sealed, open-box, damaged-box, and incomplete LEGO sets.', 'index', 'index, follow', 'Grading Guide', true, 'content', 'monthly', 0.7),
    ('route:/contact', '/contact', 'Contact Kuso Oishii', 'Contact Kuso Oishii for order support, LEGO set questions, or collection enquiries.', 'index', 'index, follow', 'Contact', true, 'content', 'monthly', 0.7),
    ('route:/shipping-policy', '/shipping-policy', 'Shipping Policy', 'Read Kuso Oishii shipping options, dispatch timings, and UK delivery information for graded LEGO orders.', 'index', 'index, follow', 'Shipping Policy', true, 'content', 'monthly', 0.6),
    ('route:/returns-exchanges', '/returns-exchanges', 'Returns & Exchanges', 'Read the Kuso Oishii returns and exchanges policy for graded LEGO sets and minifigures.', 'index', 'index, follow', 'Returns & Exchanges', true, 'content', 'monthly', 0.6),
    ('route:/terms', '/terms', 'Terms of Service', 'Read the terms of service for using Kuso Oishii and buying graded LEGO sets through the store.', 'index', 'index, follow', 'Terms of Service', true, 'policy', 'yearly', 0.4),
    ('route:/privacy', '/privacy', 'Privacy Policy', 'Read how Kuso Oishii handles customer data, privacy, and account information.', 'index', 'index, follow', 'Privacy Policy', true, 'policy', 'yearly', 0.4),
    ('route:/bluebell', '/bluebell', 'Blue Bell LEGO Club', 'Find information about the Blue Bell LEGO Club collection option and community links with Kuso Oishii.', 'index', 'index, follow', 'Blue Bell LEGO Club', true, 'content', 'monthly', 0.6),
    ('route:/cart', '/cart', 'Cart', 'Your Kuso Oishii shopping cart.', 'noindex', 'noindex, nofollow', 'Cart', false, 'utility', 'monthly', 0.0),
    ('route:/checkout/success', '/checkout/success', 'Order Confirmed', 'Your Kuso Oishii order has been placed successfully.', 'noindex', 'noindex, nofollow', 'Order Confirmed', false, 'utility', 'monthly', 0.0),
    ('route:/order-tracking', '/order-tracking', 'Track Your Order', 'Track your Kuso Oishii LEGO order with your order number and email address.', 'noindex', 'noindex, nofollow', 'Track Your Order', false, 'utility', 'monthly', 0.0),
    ('route:/login', '/login', 'Sign In', 'Sign in to your Kuso Oishii account.', 'noindex', 'noindex, nofollow', 'Sign In', false, 'auth', 'monthly', 0.0),
    ('route:/signup', '/signup', 'Create Account', 'Create a Kuso Oishii account.', 'noindex', 'noindex, nofollow', 'Create Account', false, 'auth', 'monthly', 0.0),
    ('route:/forgot-password', '/forgot-password', 'Reset Password', 'Request a Kuso Oishii password reset link.', 'noindex', 'noindex, nofollow', 'Reset Password', false, 'auth', 'monthly', 0.0),
    ('route:/reset-password', '/reset-password', 'Set New Password', 'Set a new Kuso Oishii account password.', 'noindex', 'noindex, nofollow', 'Set New Password', false, 'auth', 'monthly', 0.0),
    ('route:/account', '/account', 'Account', 'Private Kuso Oishii member account area.', 'noindex', 'noindex, nofollow', 'Account', false, 'member', 'monthly', 0.0),
    ('route:/welcome', '/welcome', 'Welcome', 'Private Kuso Oishii customer welcome page.', 'noindex', 'noindex, nofollow', 'Welcome', false, 'tokenized', 'monthly', 0.0),
    ('route:/unsubscribe', '/unsubscribe', 'Unsubscribe', 'Manage Kuso Oishii email preferences.', 'noindex', 'noindex, nofollow', 'Unsubscribe', false, 'utility', 'monthly', 0.0),
    ('route:/admin', '/admin', 'Admin', 'Private Kuso Oishii administration area.', 'noindex', 'noindex, nofollow', 'Admin', false, 'admin', 'monthly', 0.0),
    ('route:/404', '/404', 'Page Not Found', 'The requested Kuso Oishii page could not be found.', 'noindex', 'noindex, nofollow', 'Page Not Found', false, 'system', 'monthly', 0.0)
),
documents AS (
  INSERT INTO public.seo_document (
    document_key,
    document_type,
    route_path,
    status,
    metadata
  )
  SELECT
    document_key,
    'route',
    route_path,
    'published',
    jsonb_build_object('seeded_from', '20260502094021_app_mastered_seo_documents')
  FROM seed
  ON CONFLICT (document_key) DO UPDATE
    SET
      route_path = EXCLUDED.route_path,
      status = EXCLUDED.status,
      metadata = public.seo_document.metadata || EXCLUDED.metadata,
      updated_at = now()
  RETURNING id, document_key
),
revisions AS (
  INSERT INTO public.seo_revision (
    seo_document_id,
    revision_number,
    status,
    canonical_path,
    canonical_url,
    title_tag,
    meta_description,
    indexation_policy,
    robots_directive,
    open_graph,
    twitter_card,
    breadcrumbs,
    structured_data,
    sitemap,
    geo,
    source,
    change_summary,
    published_at,
    metadata
  )
  SELECT
    documents.id,
    1,
    'published',
    seed.route_path,
    'https://www.kusooishii.com' || seed.route_path,
    seed.title_tag,
    seed.meta_description,
    seed.indexation_policy,
    seed.robots_directive,
    jsonb_build_object(
      'type', 'website',
      'site_name', 'Kuso Oishii',
      'title', seed.title_tag,
      'description', seed.meta_description,
      'url', 'https://www.kusooishii.com' || seed.route_path
    ),
    jsonb_build_object(
      'card', 'summary',
      'title', seed.title_tag,
      'description', seed.meta_description
    ),
    CASE
      WHEN seed.route_path = '/' THEN jsonb_build_array(jsonb_build_object('name', 'Home', 'path', '/'))
      WHEN seed.indexation_policy = 'index' THEN jsonb_build_array(
        jsonb_build_object('name', 'Home', 'path', '/'),
        jsonb_build_object('name', seed.breadcrumb_label, 'path', seed.route_path)
      )
      ELSE '[]'::jsonb
    END,
    CASE
      WHEN seed.route_path IN ('/', '/contact') THEN jsonb_build_array(
        jsonb_build_object(
          '@context', 'https://schema.org',
          '@type', 'Organization',
          '@id', 'https://www.kusooishii.com/#organization',
          'name', 'Kuso Oishii',
          'url', 'https://www.kusooishii.com',
          'logo', jsonb_build_object('@type', 'ImageObject', 'url', 'https://www.kusooishii.com/favicon.ico'),
          'description', 'Kuso Oishii sells graded LEGO sets and minifigures for adult collectors in the United Kingdom.',
          'email', 'hello@kusooishii.com',
          'areaServed', jsonb_build_object('@type', 'Country', 'name', 'United Kingdom'),
          'contactPoint', jsonb_build_object(
            '@type', 'ContactPoint',
            'contactType', 'customer support',
            'email', 'hello@kusooishii.com',
            'areaServed', 'GB',
            'availableLanguage', 'en-GB'
          ),
          'knowsAbout', jsonb_build_array('LEGO resale', 'LEGO set condition grading', 'retired LEGO sets', 'collectible minifigures')
        )
      )
      ELSE '[]'::jsonb
    END,
    jsonb_build_object(
      'include', seed.sitemap_include,
      'family', seed.sitemap_family,
      'changefreq', seed.sitemap_changefreq,
      'priority', seed.sitemap_priority
    ),
    CASE
      WHEN seed.indexation_policy = 'index' THEN jsonb_build_object('region', 'GB', 'placename', 'United Kingdom')
      ELSE '{}'::jsonb
    END,
    'migration_seed',
    'Initial app-mastered SEO route records from the design spec.',
    now(),
    jsonb_build_object('seeded_from', '20260502094021_app_mastered_seo_documents')
  FROM documents
  JOIN seed ON seed.document_key = documents.document_key
  ON CONFLICT (seo_document_id, revision_number) DO UPDATE
    SET
      status = EXCLUDED.status,
      canonical_path = EXCLUDED.canonical_path,
      canonical_url = EXCLUDED.canonical_url,
      title_tag = EXCLUDED.title_tag,
      meta_description = EXCLUDED.meta_description,
      indexation_policy = EXCLUDED.indexation_policy,
      robots_directive = EXCLUDED.robots_directive,
      open_graph = EXCLUDED.open_graph,
      twitter_card = EXCLUDED.twitter_card,
      breadcrumbs = EXCLUDED.breadcrumbs,
      structured_data = EXCLUDED.structured_data,
      sitemap = EXCLUDED.sitemap,
      geo = EXCLUDED.geo,
      source = EXCLUDED.source,
      change_summary = EXCLUDED.change_summary,
      published_at = COALESCE(public.seo_revision.published_at, EXCLUDED.published_at),
      metadata = public.seo_revision.metadata || EXCLUDED.metadata
  RETURNING id, seo_document_id
)
UPDATE public.seo_document
SET
  published_revision_id = revisions.id,
  status = 'published',
  updated_at = now()
FROM revisions
WHERE public.seo_document.id = revisions.seo_document_id;

WITH seed AS (
  SELECT
    'product:' || p.mpn AS document_key,
    p.id AS entity_id,
    p.mpn AS entity_reference,
    '/sets/' || p.mpn AS canonical_path,
    COALESCE(NULLIF(btrim(p.seo_title), ''), COALESCE(p.name, p.mpn) || ' (' || p.mpn || ')') AS title_tag,
    COALESCE(
      NULLIF(btrim(p.seo_description), ''),
      NULLIF(btrim(p.description), ''),
      'Shop ' || COALESCE(p.name, p.mpn) || ' with graded condition options and fast UK shipping from Kuso Oishii.'
    ) AS meta_description,
    COALESCE(p.name, p.mpn) AS name,
    p.img_url
  FROM public.product p
  WHERE p.status = 'active'
    AND p.mpn IS NOT NULL
    AND btrim(p.mpn) <> ''
),
documents AS (
  INSERT INTO public.seo_document (
    document_key,
    document_type,
    entity_type,
    entity_id,
    entity_reference,
    status,
    metadata
  )
  SELECT
    document_key,
    'product',
    'product',
    entity_id,
    entity_reference,
    'published',
    jsonb_build_object('seeded_from', '20260502094021_app_mastered_seo_documents')
  FROM seed
  ON CONFLICT (document_key) DO UPDATE
    SET
      entity_type = EXCLUDED.entity_type,
      entity_id = EXCLUDED.entity_id,
      entity_reference = EXCLUDED.entity_reference,
      status = EXCLUDED.status,
      metadata = public.seo_document.metadata || EXCLUDED.metadata,
      updated_at = now()
  RETURNING id, document_key
),
revisions AS (
  INSERT INTO public.seo_revision (
    seo_document_id,
    revision_number,
    status,
    canonical_path,
    canonical_url,
    title_tag,
    meta_description,
    indexation_policy,
    robots_directive,
    open_graph,
    twitter_card,
    breadcrumbs,
    image_metadata,
    sitemap,
    geo,
    keywords,
    source,
    change_summary,
    published_at,
    metadata
  )
  SELECT
    documents.id,
    1,
    'published',
    seed.canonical_path,
    'https://www.kusooishii.com' || seed.canonical_path,
    seed.title_tag,
    seed.meta_description,
    'index',
    'index, follow',
    jsonb_strip_nulls(jsonb_build_object(
      'type', 'product',
      'site_name', 'Kuso Oishii',
      'title', seed.title_tag,
      'description', seed.meta_description,
      'url', 'https://www.kusooishii.com' || seed.canonical_path,
      'image', seed.img_url
    )),
    jsonb_strip_nulls(jsonb_build_object(
      'card', CASE WHEN seed.img_url IS NULL THEN 'summary' ELSE 'summary_large_image' END,
      'title', seed.title_tag,
      'description', seed.meta_description,
      'image', seed.img_url
    )),
    jsonb_build_array(
      jsonb_build_object('name', 'Home', 'path', '/'),
      jsonb_build_object('name', 'Browse LEGO Sets', 'path', '/browse'),
      jsonb_build_object('name', seed.name, 'path', seed.canonical_path)
    ),
    jsonb_strip_nulls(jsonb_build_object(
      'url', seed.img_url,
      'alt', seed.name || ' product image'
    )),
    jsonb_build_object(
      'include', true,
      'family', 'product',
      'changefreq', 'weekly',
      'priority', 0.8
    ),
    jsonb_build_object('region', 'GB', 'placename', 'United Kingdom'),
    array_remove(ARRAY[seed.entity_reference, seed.name, 'LEGO resale', 'graded LEGO sets', 'UK LEGO store'], NULL),
    'migration_seed',
    'Initial app-mastered product SEO revisions from product master fields.',
    now(),
    jsonb_build_object('seeded_from', '20260502094021_app_mastered_seo_documents')
  FROM documents
  JOIN seed ON seed.document_key = documents.document_key
  ON CONFLICT (seo_document_id, revision_number) DO UPDATE
    SET
      status = EXCLUDED.status,
      canonical_path = EXCLUDED.canonical_path,
      canonical_url = EXCLUDED.canonical_url,
      title_tag = EXCLUDED.title_tag,
      meta_description = EXCLUDED.meta_description,
      indexation_policy = EXCLUDED.indexation_policy,
      robots_directive = EXCLUDED.robots_directive,
      open_graph = EXCLUDED.open_graph,
      twitter_card = EXCLUDED.twitter_card,
      breadcrumbs = EXCLUDED.breadcrumbs,
      image_metadata = EXCLUDED.image_metadata,
      sitemap = EXCLUDED.sitemap,
      geo = EXCLUDED.geo,
      keywords = EXCLUDED.keywords,
      source = EXCLUDED.source,
      change_summary = EXCLUDED.change_summary,
      published_at = COALESCE(public.seo_revision.published_at, EXCLUDED.published_at),
      metadata = public.seo_revision.metadata || EXCLUDED.metadata
  RETURNING id, seo_document_id
)
UPDATE public.seo_document
SET
  published_revision_id = revisions.id,
  status = 'published',
  updated_at = now()
FROM revisions
WHERE public.seo_document.id = revisions.seo_document_id;
