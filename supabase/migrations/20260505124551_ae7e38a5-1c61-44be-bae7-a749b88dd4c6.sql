CREATE OR REPLACE FUNCTION public.invoke_subledger_scheduled_job(p_job text, p_body jsonb DEFAULT '{}'::jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_supabase_url TEXT;
  v_anon_key TEXT;
  v_internal_secret TEXT;
  v_headers JSONB;
  v_request_id BIGINT;
BEGIN
  SELECT decrypted_secret INTO v_supabase_url
  FROM vault.decrypted_secrets
  WHERE name IN ('supabase_url', 'SUPABASE_URL')
  ORDER BY CASE WHEN name = 'supabase_url' THEN 0 ELSE 1 END LIMIT 1;
  IF NULLIF(v_supabase_url, '') IS NULL THEN
    v_supabase_url := 'https://gcgrwujfyurgetvqlmbf.supabase.co';
  END IF;

  SELECT decrypted_secret INTO v_anon_key
  FROM vault.decrypted_secrets
  WHERE name IN ('anon_key', 'SUPABASE_ANON_KEY')
  ORDER BY CASE WHEN name = 'anon_key' THEN 0 ELSE 1 END LIMIT 1;

  -- Prefer internal_cron_secret because it is kept in sync with the
  -- INTERNAL_CRON_SECRET edge env var (the safety-net cron uses it
  -- successfully). The legacy subledger_scheduled_jobs_secret Vault
  -- entry has drifted and is intentionally deprioritised.
  SELECT decrypted_secret INTO v_internal_secret
  FROM vault.decrypted_secrets
  WHERE name IN (
    'internal_cron_secret','INTERNAL_CRON_SECRET',
    'subledger_scheduled_jobs_secret','SUBLEDGER_SCHEDULED_JOBS_SECRET',
    'subledger_cron_secret','SUBLEDGER_CRON_SECRET'
  )
  ORDER BY CASE
    WHEN name = 'internal_cron_secret' THEN 0
    WHEN name = 'INTERNAL_CRON_SECRET' THEN 1
    WHEN name = 'subledger_scheduled_jobs_secret' THEN 2
    WHEN name = 'SUBLEDGER_SCHEDULED_JOBS_SECRET' THEN 3
    WHEN name = 'subledger_cron_secret' THEN 4
    ELSE 5
  END LIMIT 1;

  IF NULLIF(v_internal_secret, '') IS NULL THEN
    RAISE EXCEPTION 'Missing internal cron secret in vault';
  END IF;

  v_headers := jsonb_build_object(
    'Content-Type','application/json',
    'x-internal-shared-secret', v_internal_secret
  );
  IF NULLIF(v_anon_key,'') IS NOT NULL THEN
    v_headers := v_headers || jsonb_build_object(
      'apikey', v_anon_key,
      'Authorization', 'Bearer ' || v_anon_key
    );
  END IF;

  SELECT net.http_post(
    url := rtrim(v_supabase_url,'/') || '/functions/v1/subledger-scheduled-jobs',
    headers := v_headers,
    body := COALESCE(p_body,'{}'::jsonb) || jsonb_build_object('job', p_job)
  ) INTO v_request_id;
  RETURN v_request_id;
END;
$function$;