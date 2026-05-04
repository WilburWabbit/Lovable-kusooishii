-- Repair storefront discovery after website listing publish.
-- Lovable-safe: SQL function bodies use single-quoted strings, not dollar quotes.

DROP FUNCTION IF EXISTS public.browse_catalog(text, uuid, text, boolean);
DROP FUNCTION IF EXISTS public.browse_catalog(text, uuid, text, boolean, boolean);

CREATE FUNCTION public.browse_catalog(
  search_term text DEFAULT NULL,
  filter_theme_id uuid DEFAULT NULL,
  filter_grade text DEFAULT NULL,
  filter_retired boolean DEFAULT NULL,
  include_out_of_stock boolean DEFAULT false
)
RETURNS TABLE(
  product_id uuid,
  mpn text,
  name text,
  theme_name text,
  theme_id uuid,
  retired_flag boolean,
  release_year integer,
  piece_count integer,
  min_price numeric,
  best_grade text,
  total_stock bigint,
  img_url text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS '
  WITH live_web_listing AS (
    SELECT DISTINCT ON (cl.sku_id)
      cl.sku_id,
      cl.listed_price,
      linked.current_price AS linked_current_price,
      linked.target_price AS linked_target_price
    FROM public.channel_listing cl
    LEFT JOIN public.price_decision_snapshot linked
      ON linked.id = cl.current_price_decision_snapshot_id
    WHERE cl.sku_id IS NOT NULL
      AND (
        cl.channel = ''web''
        OR cl.v2_channel::text IN (''web'', ''website'')
      )
      AND (
        upper(COALESCE(cl.offer_status, '''')) = ''PUBLISHED''
        OR lower(COALESCE(cl.v2_status::text, '''')) = ''live''
      )
    ORDER BY
      cl.sku_id,
      CASE WHEN lower(COALESCE(cl.v2_status::text, '''')) = ''live'' THEN 0 ELSE 1 END,
      COALESCE(cl.listed_at, cl.updated_at, cl.created_at) DESC
  ),
  latest_web_snapshot AS (
    SELECT DISTINCT ON (pds.sku_id)
      pds.sku_id,
      pds.current_price AS snapshot_current_price,
      pds.target_price AS snapshot_target_price
    FROM public.price_decision_snapshot pds
    WHERE pds.channel IN (''web'', ''website'')
    ORDER BY pds.sku_id, pds.created_at DESC
  ),
  catalog_rows AS (
    SELECT
      p.id AS product_id,
      p.mpn,
      p.name,
      COALESCE(t.name, CASE WHEN p.product_type = ''minifig'' THEN cmf.name END) AS theme_name,
      COALESCE(p.theme_id, CASE WHEN p.product_type = ''minifig'' THEN cmf.id END) AS theme_id,
      p.retired_flag,
      p.release_year,
      p.piece_count,
      MIN(COALESCE(
        lwl.listed_price,
        lwl.linked_target_price,
        lwl.linked_current_price,
        lws.snapshot_target_price,
        lws.snapshot_current_price,
        s.price
      )) AS min_price,
      MIN(s.condition_grade::text) AS best_grade,
      COUNT(DISTINCT su.id) AS total_stock,
      COALESCE(
        primary_media.original_url,
        first_media.original_url,
        catalog_image.img_url,
        p.img_url
      ) AS img_url
    FROM public.product p
    LEFT JOIN public.theme t ON t.id = p.theme_id
    LEFT JOIN LATERAL (
      SELECT id, name
      FROM public.theme
      WHERE slug = ''collectible-minifigures''
      LIMIT 1
    ) cmf ON true
    LEFT JOIN LATERAL (
      SELECT ma.original_url
      FROM public.product_media pm
      JOIN public.media_asset ma ON ma.id = pm.media_asset_id
      WHERE pm.product_id = p.id
        AND pm.is_primary = true
      ORDER BY pm.sort_order ASC, pm.created_at ASC, pm.id ASC
      LIMIT 1
    ) primary_media ON true
    LEFT JOIN LATERAL (
      SELECT ma.original_url
      FROM public.product_media pm
      JOIN public.media_asset ma ON ma.id = pm.media_asset_id
      WHERE pm.product_id = p.id
      ORDER BY pm.sort_order ASC, pm.created_at ASC, pm.id ASC
      LIMIT 1
    ) first_media ON true
    LEFT JOIN LATERAL (
      SELECT lc.img_url
      FROM public.lego_catalog lc
      WHERE lc.img_url IS NOT NULL
        AND (lc.id = p.lego_catalog_id OR lc.mpn = p.mpn)
      ORDER BY
        CASE WHEN lc.id = p.lego_catalog_id THEN 0 ELSE 1 END,
        lc.created_at ASC,
        lc.id ASC
      LIMIT 1
    ) catalog_image ON true
    JOIN public.sku s
      ON s.product_id = p.id
     AND s.active_flag = true
     AND s.saleable_flag = true
    JOIN live_web_listing lwl
      ON lwl.sku_id = s.id
    LEFT JOIN latest_web_snapshot lws
      ON lws.sku_id = s.id
    LEFT JOIN public.stock_unit su
      ON su.sku_id = s.id
     AND COALESCE(su.v2_status::text, su.status::text) IN (''available'', ''graded'', ''listed'', ''restocked'')
    WHERE p.status = ''active''
      AND (
        search_term IS NULL
        OR btrim(search_term) = ''''
        OR p.name ILIKE ''%'' || search_term || ''%''
        OR p.mpn ILIKE ''%'' || search_term || ''%''
        OR t.name ILIKE ''%'' || search_term || ''%''
        OR p.subtheme_name ILIKE ''%'' || search_term || ''%''
      )
      AND (
        filter_theme_id IS NULL
        OR p.theme_id = filter_theme_id
        OR (
          p.product_type = ''minifig''
          AND cmf.id IS NOT NULL
          AND filter_theme_id = cmf.id
        )
      )
      AND (filter_grade IS NULL OR s.condition_grade::text = filter_grade)
      AND (filter_retired IS NULL OR p.retired_flag = filter_retired)
    GROUP BY
      p.id,
      p.mpn,
      p.name,
      t.name,
      p.theme_id,
      p.product_type,
      cmf.id,
      cmf.name,
      p.retired_flag,
      p.release_year,
      p.piece_count,
      p.img_url,
      primary_media.original_url,
      first_media.original_url,
      catalog_image.img_url
  )
  SELECT
    catalog_rows.product_id,
    catalog_rows.mpn,
    catalog_rows.name,
    catalog_rows.theme_name,
    catalog_rows.theme_id,
    catalog_rows.retired_flag,
    catalog_rows.release_year,
    catalog_rows.piece_count,
    catalog_rows.min_price,
    catalog_rows.best_grade,
    catalog_rows.total_stock,
    catalog_rows.img_url
  FROM catalog_rows
  WHERE include_out_of_stock OR catalog_rows.total_stock > 0
  ORDER BY catalog_rows.name;
';

GRANT EXECUTE ON FUNCTION public.browse_catalog(text, uuid, text, boolean, boolean)
TO anon, authenticated, service_role;

UPDATE public.outbound_command
SET status = 'pending',
    next_attempt_at = now(),
    last_error = 'Recovered stale listing outbox processing claim.',
    updated_at = now()
WHERE entity_type = 'channel_listing'
  AND status = 'processing'
  AND sent_at IS NULL
  AND updated_at < now() - interval '15 minutes';

WITH live_products AS (
  SELECT DISTINCT
    p.id AS product_id,
    p.mpn,
    COALESCE(NULLIF(btrim(p.seo_title), ''), COALESCE(p.name, p.mpn) || ' (' || p.mpn || ')') AS title_tag,
    COALESCE(
      NULLIF(btrim(p.seo_description), ''),
      NULLIF(btrim(p.description), ''),
      'Shop ' || COALESCE(p.name, p.mpn) || ' with graded condition options and fast UK shipping from Kuso Oishii.'
    ) AS meta_description,
    COALESCE(p.name, p.mpn) AS product_name,
    p.img_url,
    p.theme_id,
    t.name AS theme_name
  FROM public.product p
  JOIN public.sku s
    ON s.product_id = p.id
   AND s.active_flag = true
   AND s.saleable_flag = true
  JOIN public.channel_listing cl
    ON cl.sku_id = s.id
   AND (cl.channel = 'web' OR cl.v2_channel::text IN ('web', 'website'))
   AND (upper(COALESCE(cl.offer_status, '')) = 'PUBLISHED' OR lower(COALESCE(cl.v2_status::text, '')) = 'live')
  LEFT JOIN public.theme t ON t.id = p.theme_id
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
    'product:' || live_products.mpn,
    'product',
    'product',
    live_products.product_id,
    live_products.mpn,
    'published',
    jsonb_build_object(
      'seeded_from', '20260504115458_repair_storefront_discovery_publish_pipeline',
      'refreshed_from', 'storefront_listing_backfill'
    )
  FROM live_products
  ON CONFLICT (document_key) DO UPDATE
    SET entity_type = EXCLUDED.entity_type,
        entity_id = EXCLUDED.entity_id,
        entity_reference = EXCLUDED.entity_reference,
        status = 'published',
        metadata = public.seo_document.metadata || EXCLUDED.metadata,
        updated_at = now()
  RETURNING id, document_key, published_revision_id
),
missing_revisions AS (
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
    COALESCE((
      SELECT MAX(sr.revision_number)
      FROM public.seo_revision sr
      WHERE sr.seo_document_id = documents.id
    ), 0) + 1,
    'published',
    '/sets/' || live_products.mpn,
    'https://www.kusooishii.com/sets/' || live_products.mpn,
    live_products.title_tag,
    live_products.meta_description,
    'index',
    'index, follow',
    jsonb_strip_nulls(jsonb_build_object(
      'type', 'product',
      'site_name', 'Kuso Oishii',
      'title', live_products.title_tag,
      'description', live_products.meta_description,
      'url', 'https://www.kusooishii.com/sets/' || live_products.mpn,
      'image', live_products.img_url
    )),
    jsonb_strip_nulls(jsonb_build_object(
      'card', CASE WHEN live_products.img_url IS NULL THEN 'summary' ELSE 'summary_large_image' END,
      'title', live_products.title_tag,
      'description', live_products.meta_description,
      'image', live_products.img_url
    )),
    jsonb_build_array(
      jsonb_build_object('name', 'Home', 'path', '/'),
      jsonb_build_object('name', 'Browse LEGO Sets', 'path', '/browse'),
      jsonb_build_object('name', live_products.product_name, 'path', '/sets/' || live_products.mpn)
    ),
    jsonb_strip_nulls(jsonb_build_object(
      'url', live_products.img_url,
      'alt', live_products.product_name || ' product image'
    )),
    jsonb_build_object(
      'include', true,
      'family', 'product',
      'changefreq', 'weekly',
      'priority', 0.8
    ),
    jsonb_build_object('region', 'GB', 'placename', 'United Kingdom'),
    array_remove(ARRAY[live_products.mpn, live_products.product_name, live_products.theme_name, 'LEGO resale', 'graded LEGO sets', 'UK LEGO store'], NULL),
    'storefront_listing_backfill',
    'Backfilled product SEO document after storefront listing discovery repair.',
    now(),
    jsonb_build_object('seeded_from', '20260504115458_repair_storefront_discovery_publish_pipeline')
  FROM documents
  JOIN live_products ON documents.document_key = 'product:' || live_products.mpn
  WHERE documents.published_revision_id IS NULL
  RETURNING id, seo_document_id
)
UPDATE public.seo_document
SET published_revision_id = missing_revisions.id,
    status = 'published',
    updated_at = now()
FROM missing_revisions
WHERE public.seo_document.id = missing_revisions.seo_document_id;

WITH live_themes AS (
  SELECT DISTINCT
    t.id AS theme_id,
    t.name AS theme_name
  FROM public.theme t
  JOIN public.product p ON p.theme_id = t.id
  JOIN public.sku s ON s.product_id = p.id AND s.active_flag = true AND s.saleable_flag = true
  JOIN public.channel_listing cl
    ON cl.sku_id = s.id
   AND (cl.channel = 'web' OR cl.v2_channel::text IN ('web', 'website'))
   AND (upper(COALESCE(cl.offer_status, '')) = 'PUBLISHED' OR lower(COALESCE(cl.v2_status::text, '')) = 'live')
  WHERE p.status = 'active'
),
theme_documents AS (
  INSERT INTO public.seo_document (
    document_key,
    document_type,
    route_path,
    entity_type,
    entity_id,
    entity_reference,
    status,
    metadata
  )
  SELECT
    'theme:' || live_themes.theme_id::text,
    'theme',
    '/browse?theme=' || live_themes.theme_id::text,
    'theme',
    live_themes.theme_id,
    live_themes.theme_name,
    'published',
    jsonb_build_object(
      'seeded_from', '20260504115458_repair_storefront_discovery_publish_pipeline',
      'refreshed_from', 'storefront_listing_backfill'
    )
  FROM live_themes
  ON CONFLICT (document_key) DO UPDATE
    SET route_path = EXCLUDED.route_path,
        entity_type = EXCLUDED.entity_type,
        entity_id = EXCLUDED.entity_id,
        entity_reference = EXCLUDED.entity_reference,
        status = 'published',
        metadata = public.seo_document.metadata || EXCLUDED.metadata,
        updated_at = now()
  RETURNING id, document_key, published_revision_id
),
missing_theme_revisions AS (
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
    breadcrumbs,
    sitemap,
    geo,
    keywords,
    source,
    change_summary,
    published_at,
    metadata
  )
  SELECT
    theme_documents.id,
    COALESCE((
      SELECT MAX(sr.revision_number)
      FROM public.seo_revision sr
      WHERE sr.seo_document_id = theme_documents.id
    ), 0) + 1,
    'published',
    '/browse?theme=' || live_themes.theme_id::text,
    'https://www.kusooishii.com/browse?theme=' || live_themes.theme_id::text,
    live_themes.theme_name || ' LEGO Sets',
    'Browse graded ' || live_themes.theme_name || ' LEGO sets and minifigures with clear condition data at Kuso Oishii.',
    'index',
    'index, follow',
    jsonb_build_array(
      jsonb_build_object('name', 'Home', 'path', '/'),
      jsonb_build_object('name', live_themes.theme_name || ' LEGO Sets', 'path', '/browse?theme=' || live_themes.theme_id::text)
    ),
    jsonb_build_object('include', true, 'family', 'theme', 'changefreq', 'weekly', 'priority', 0.7),
    jsonb_build_object('region', 'GB', 'placename', 'United Kingdom'),
    ARRAY[live_themes.theme_name, 'LEGO theme', 'graded LEGO sets', 'UK LEGO store'],
    'storefront_listing_backfill',
    'Backfilled theme SEO document after storefront listing discovery repair.',
    now(),
    jsonb_build_object('seeded_from', '20260504115458_repair_storefront_discovery_publish_pipeline')
  FROM theme_documents
  JOIN live_themes ON theme_documents.document_key = 'theme:' || live_themes.theme_id::text
  WHERE theme_documents.published_revision_id IS NULL
  RETURNING id, seo_document_id
)
UPDATE public.seo_document
SET published_revision_id = missing_theme_revisions.id,
    status = 'published',
    updated_at = now()
FROM missing_theme_revisions
WHERE public.seo_document.id = missing_theme_revisions.seo_document_id;

UPDATE public.seo_revision sr
SET sitemap = sr.sitemap || jsonb_build_object('include', true, 'changefreq', 'weekly'),
    metadata = sr.metadata || jsonb_build_object(
      'refreshed_from', 'storefront_listing_backfill',
      'refreshed_at', now()
    )
FROM public.seo_document sd
WHERE sr.id = sd.published_revision_id
  AND sd.document_key IN ('route:/browse', 'route:/themes', 'route:/new-arrivals', 'route:/deals');

WITH collections(document_key, route_path, title_tag, meta_description, entity_reference) AS (
  VALUES
    ('collection:new-arrivals', '/new-arrivals', 'New Arrivals', 'See the latest graded LEGO stock newly added to Kuso Oishii.', 'new-arrivals'),
    ('collection:deals', '/deals', 'Deals', 'Explore graded LEGO deals with clear condition details and fair UK pricing.', 'deals')
),
collection_documents AS (
  INSERT INTO public.seo_document (
    document_key,
    document_type,
    route_path,
    entity_type,
    entity_reference,
    status,
    metadata
  )
  SELECT
    collections.document_key,
    'collection',
    collections.route_path,
    'collection',
    collections.entity_reference,
    'published',
    jsonb_build_object(
      'seeded_from', '20260504115458_repair_storefront_discovery_publish_pipeline',
      'refreshed_from', 'storefront_listing_backfill'
    )
  FROM collections
  ON CONFLICT (document_key) DO UPDATE
    SET route_path = EXCLUDED.route_path,
        entity_type = EXCLUDED.entity_type,
        entity_reference = EXCLUDED.entity_reference,
        status = 'published',
        metadata = public.seo_document.metadata || EXCLUDED.metadata,
        updated_at = now()
  RETURNING id, document_key, published_revision_id
),
missing_collection_revisions AS (
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
    breadcrumbs,
    sitemap,
    geo,
    keywords,
    source,
    change_summary,
    published_at,
    metadata
  )
  SELECT
    collection_documents.id,
    COALESCE((
      SELECT MAX(sr.revision_number)
      FROM public.seo_revision sr
      WHERE sr.seo_document_id = collection_documents.id
    ), 0) + 1,
    'published',
    collections.route_path,
    'https://www.kusooishii.com' || collections.route_path,
    collections.title_tag,
    collections.meta_description,
    'index',
    'index, follow',
    jsonb_build_array(
      jsonb_build_object('name', 'Home', 'path', '/'),
      jsonb_build_object('name', collections.title_tag, 'path', collections.route_path)
    ),
    jsonb_build_object('include', true, 'family', 'collection', 'changefreq', 'weekly', 'priority', 0.7),
    jsonb_build_object('region', 'GB', 'placename', 'United Kingdom'),
    ARRAY[collections.title_tag, 'LEGO collection', 'graded LEGO sets', 'UK LEGO store'],
    'storefront_listing_backfill',
    'Backfilled collection SEO document after storefront listing discovery repair.',
    now(),
    jsonb_build_object('seeded_from', '20260504115458_repair_storefront_discovery_publish_pipeline')
  FROM collection_documents
  JOIN collections ON collection_documents.document_key = collections.document_key
  WHERE collection_documents.published_revision_id IS NULL
  RETURNING id, seo_document_id
)
UPDATE public.seo_document
SET published_revision_id = missing_collection_revisions.id,
    status = 'published',
    updated_at = now()
FROM missing_collection_revisions
WHERE public.seo_document.id = missing_collection_revisions.seo_document_id;
