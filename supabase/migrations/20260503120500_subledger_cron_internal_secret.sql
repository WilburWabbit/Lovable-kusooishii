-- Move subledger cron invocation off service-role bearer tokens.
-- Lovable SQL runner note: do not use dollar-quoted function bodies in this file.

CREATE OR REPLACE FUNCTION public.invoke_subledger_scheduled_job(
  p_job TEXT,
  p_body JSONB DEFAULT '{}'::jsonb
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS '
DECLARE
  v_supabase_url TEXT := current_setting(''app.settings.supabase_url'', true);
  v_anon_key TEXT := current_setting(''app.settings.anon_key'', true);
  v_internal_secret TEXT := current_setting(''app.settings.subledger_scheduled_jobs_secret'', true);
  v_headers JSONB;
  v_request_id BIGINT;
BEGIN
  IF NULLIF(v_supabase_url, '''') IS NULL THEN
    SELECT decrypted_secret
    INTO v_supabase_url
    FROM vault.decrypted_secrets
    WHERE name IN (''supabase_url'', ''SUPABASE_URL'')
    ORDER BY CASE WHEN name = ''supabase_url'' THEN 0 ELSE 1 END
    LIMIT 1;
  END IF;

  IF NULLIF(v_supabase_url, '''') IS NULL THEN
    v_supabase_url := ''https://gcgrwujfyurgetvqlmbf.supabase.co'';
  END IF;

  IF NULLIF(v_anon_key, '''') IS NULL THEN
    SELECT decrypted_secret
    INTO v_anon_key
    FROM vault.decrypted_secrets
    WHERE name IN (''anon_key'', ''SUPABASE_ANON_KEY'')
    ORDER BY CASE WHEN name = ''anon_key'' THEN 0 ELSE 1 END
    LIMIT 1;
  END IF;

  IF NULLIF(v_internal_secret, '''') IS NULL THEN
    SELECT decrypted_secret
    INTO v_internal_secret
    FROM vault.decrypted_secrets
    WHERE name IN (
      ''subledger_scheduled_jobs_secret'',
      ''SUBLEDGER_SCHEDULED_JOBS_SECRET'',
      ''subledger_cron_secret'',
      ''SUBLEDGER_CRON_SECRET''
    )
    ORDER BY CASE
      WHEN name = ''subledger_scheduled_jobs_secret'' THEN 0
      WHEN name = ''SUBLEDGER_SCHEDULED_JOBS_SECRET'' THEN 1
      WHEN name = ''subledger_cron_secret'' THEN 2
      ELSE 3
    END
    LIMIT 1;
  END IF;

  IF NULLIF(v_internal_secret, '''') IS NULL THEN
    RAISE EXCEPTION ''Missing internal secret for scheduled subledger job. Store it in vault as subledger_scheduled_jobs_secret.'';
  END IF;

  v_headers := jsonb_build_object(
    ''Content-Type'', ''application/json'',
    ''x-internal-shared-secret'', v_internal_secret
  );

  IF NULLIF(v_anon_key, '''') IS NOT NULL THEN
    v_headers := v_headers || jsonb_build_object(
      ''apikey'', v_anon_key,
      ''Authorization'', ''Bearer '' || v_anon_key
    );
  END IF;

  SELECT net.http_post(
    url := rtrim(v_supabase_url, ''/'') || ''/functions/v1/subledger-scheduled-jobs'',
    headers := v_headers,
    body := COALESCE(p_body, ''{}''::jsonb) || jsonb_build_object(''job'', p_job)
  )
  INTO v_request_id;

  RETURN v_request_id;
END;
';

GRANT EXECUTE ON FUNCTION public.invoke_subledger_scheduled_job(TEXT, JSONB) TO postgres, service_role;

COMMENT ON FUNCTION public.invoke_subledger_scheduled_job(TEXT, JSONB)
IS 'Invokes the subledger-scheduled-jobs Edge Function for pg_cron automation using an internal shared-secret header, without requiring a service-role key in Postgres.';
