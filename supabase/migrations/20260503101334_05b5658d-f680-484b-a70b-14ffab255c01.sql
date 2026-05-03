CREATE OR REPLACE FUNCTION public.save_seo_revision_draft(
  p_seo_document_id uuid,
  p_canonical_path text,
  p_canonical_url text,
  p_title_tag text DEFAULT '',
  p_meta_description text DEFAULT '',
  p_indexation_policy text DEFAULT 'index',
  p_robots_directive text DEFAULT 'index, follow',
  p_open_graph jsonb DEFAULT '{}'::jsonb,
  p_twitter_card jsonb DEFAULT '{}'::jsonb,
  p_breadcrumbs jsonb DEFAULT '[]'::jsonb,
  p_structured_data jsonb DEFAULT '[]'::jsonb,
  p_image_metadata jsonb DEFAULT '{}'::jsonb,
  p_sitemap jsonb DEFAULT '{}'::jsonb,
  p_geo jsonb DEFAULT '{}'::jsonb,
  p_keywords text[] DEFAULT '{}'::text[],
  p_source text DEFAULT 'admin_ui',
  p_change_summary text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE(id uuid, revision_number integer)
LANGUAGE plpgsql
SET search_path = public
AS '
DECLARE
  v_document public.seo_document%ROWTYPE;
  v_draft_id uuid;
  v_revision_id uuid;
  v_revision_number integer;
BEGIN
  IF NOT (
    public.has_role(auth.uid(), ''admin''::public.app_role)
    OR public.has_role(auth.uid(), ''staff''::public.app_role)
  ) THEN
    RAISE EXCEPTION ''Forbidden: admin or staff role required'';
  END IF;

  SELECT *
    INTO v_document
    FROM public.seo_document
   WHERE seo_document.id = p_seo_document_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION ''SEO document % not found'', p_seo_document_id;
  END IF;

  SELECT sr.id, sr.revision_number
    INTO v_draft_id, v_revision_number
    FROM public.seo_revision sr
   WHERE sr.seo_document_id = p_seo_document_id
     AND sr.status = ''draft''
   ORDER BY sr.revision_number DESC
   LIMIT 1;

  IF v_draft_id IS NOT NULL THEN
    UPDATE public.seo_revision
       SET canonical_path = p_canonical_path,
           canonical_url = p_canonical_url,
           title_tag = p_title_tag,
           meta_description = p_meta_description,
           indexation_policy = p_indexation_policy,
           robots_directive = p_robots_directive,
           open_graph = p_open_graph,
           twitter_card = p_twitter_card,
           breadcrumbs = p_breadcrumbs,
           structured_data = p_structured_data,
           image_metadata = p_image_metadata,
           sitemap = p_sitemap,
           geo = p_geo,
           keywords = p_keywords,
           source = p_source,
           change_summary = p_change_summary,
           metadata = p_metadata,
           created_by = auth.uid()
     WHERE seo_revision.id = v_draft_id
     RETURNING seo_revision.id INTO v_revision_id;
  ELSE
    SELECT COALESCE(MAX(sr.revision_number), 0) + 1
      INTO v_revision_number
      FROM public.seo_revision sr
     WHERE sr.seo_document_id = p_seo_document_id;

    INSERT INTO public.seo_revision (
      seo_document_id, revision_number, status, canonical_path, canonical_url,
      title_tag, meta_description, indexation_policy, robots_directive,
      open_graph, twitter_card, breadcrumbs, structured_data, image_metadata,
      sitemap, geo, keywords, source, change_summary, created_by, metadata
    )
    VALUES (
      p_seo_document_id, v_revision_number, ''draft'', p_canonical_path, p_canonical_url,
      p_title_tag, p_meta_description, p_indexation_policy, p_robots_directive,
      p_open_graph, p_twitter_card, p_breadcrumbs, p_structured_data, p_image_metadata,
      p_sitemap, p_geo, p_keywords, p_source, p_change_summary, auth.uid(), p_metadata
    )
    RETURNING seo_revision.id INTO v_revision_id;
  END IF;

  UPDATE public.seo_document
     SET status = CASE WHEN published_revision_id IS NULL THEN ''draft'' ELSE status END,
         updated_by = auth.uid(),
         updated_at = now()
   WHERE seo_document.id = p_seo_document_id;

  id := v_revision_id;
  revision_number := v_revision_number;
  RETURN NEXT;
END;
';

GRANT EXECUTE ON FUNCTION public.save_seo_revision_draft(
  uuid, text, text, text, text, text, text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, text[], text, text, jsonb
) TO authenticated;

CREATE OR REPLACE FUNCTION public.publish_seo_revision(
  p_seo_document_id uuid,
  p_canonical_path text,
  p_canonical_url text,
  p_title_tag text,
  p_meta_description text,
  p_indexation_policy text DEFAULT 'index',
  p_robots_directive text DEFAULT 'index, follow',
  p_open_graph jsonb DEFAULT '{}'::jsonb,
  p_twitter_card jsonb DEFAULT '{}'::jsonb,
  p_breadcrumbs jsonb DEFAULT '[]'::jsonb,
  p_structured_data jsonb DEFAULT '[]'::jsonb,
  p_image_metadata jsonb DEFAULT '{}'::jsonb,
  p_sitemap jsonb DEFAULT '{}'::jsonb,
  p_geo jsonb DEFAULT '{}'::jsonb,
  p_keywords text[] DEFAULT '{}'::text[],
  p_source text DEFAULT 'admin_ui',
  p_change_summary text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE(id uuid, revision_number integer)
LANGUAGE plpgsql
SET search_path = public
AS '
DECLARE
  v_document public.seo_document%ROWTYPE;
  v_revision_id uuid;
  v_revision_number integer;
BEGIN
  IF NOT (
    public.has_role(auth.uid(), ''admin''::public.app_role)
    OR public.has_role(auth.uid(), ''staff''::public.app_role)
  ) THEN
    RAISE EXCEPTION ''Forbidden: admin or staff role required'';
  END IF;

  SELECT *
    INTO v_document
    FROM public.seo_document
   WHERE seo_document.id = p_seo_document_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION ''SEO document % not found'', p_seo_document_id;
  END IF;

  UPDATE public.seo_revision
     SET status = ''archived''
   WHERE seo_document_id = p_seo_document_id
     AND status = ''draft'';

  SELECT COALESCE(MAX(sr.revision_number), 0) + 1
    INTO v_revision_number
    FROM public.seo_revision sr
   WHERE sr.seo_document_id = p_seo_document_id;

  INSERT INTO public.seo_revision (
    seo_document_id, revision_number, status, canonical_path, canonical_url,
    title_tag, meta_description, indexation_policy, robots_directive,
    open_graph, twitter_card, breadcrumbs, structured_data, image_metadata,
    sitemap, geo, keywords, source, change_summary, created_by, published_at, metadata
  )
  VALUES (
    p_seo_document_id, v_revision_number, ''published'', p_canonical_path, p_canonical_url,
    p_title_tag, p_meta_description, p_indexation_policy, p_robots_directive,
    p_open_graph, p_twitter_card, p_breadcrumbs, p_structured_data, p_image_metadata,
    p_sitemap, p_geo, p_keywords, p_source, p_change_summary, auth.uid(), now(), p_metadata
  )
  RETURNING seo_revision.id INTO v_revision_id;

  UPDATE public.seo_document
     SET status = ''published'',
         published_revision_id = v_revision_id,
         updated_by = auth.uid(),
         updated_at = now()
   WHERE seo_document.id = p_seo_document_id;

  id := v_revision_id;
  revision_number := v_revision_number;
  RETURN NEXT;
END;
';