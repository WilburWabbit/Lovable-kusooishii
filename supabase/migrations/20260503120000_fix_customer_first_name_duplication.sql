UPDATE public.customer
SET first_name = NULLIF(TRIM(REGEXP_REPLACE(COALESCE(first_name, ''), '(\s+)?' || REGEXP_REPLACE(COALESCE(last_name, ''), '([\\.^$|()\[\]{}*+?\\-])', '\\\1', 'g') || '$', '', 'i')), '')
WHERE COALESCE(last_name, '') <> ''
  AND COALESCE(first_name, '') <> ''
  AND lower(TRIM(first_name)) LIKE '%' || lower(TRIM(last_name));
