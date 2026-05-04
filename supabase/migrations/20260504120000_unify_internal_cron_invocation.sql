-- Centralize internal cron -> Edge Function invocation auth envelope.
-- Uses one shared secret mapping:
--   Edge env: INTERNAL_CRON_SECRET
--   Vault:    cron_shared_secret

CREATE OR REPLACE FUNCTION public.invoke_internal_function(
  fn_name TEXT,
  body JSONB DEFAULT '{}'::JSONB
) RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS '
DECLARE
  req_id BIGINT;
BEGIN
  SELECT net.http_post(
    url := (SELECT rtrim(decrypted_secret, ''/'') FROM vault.decrypted_secrets WHERE name = ''supabase_url'') || ''/functions/v1/'' || fn_name,
    headers := jsonb_build_object(
      ''Content-Type'', ''application/json'',
      ''apikey'', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = ''anon_key''),
      ''Authorization'', ''Bearer '' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = ''anon_key''),
      ''x-internal-shared-secret'', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = ''cron_shared_secret'')
    ),
    body := body
  ) INTO req_id;

  RETURN req_id;
END;
';

REVOKE ALL ON FUNCTION public.invoke_internal_function(TEXT, JSONB) FROM PUBLIC, anon, authenticated;

-- Ensure single shared secret slot exists for operator-managed sync with Lovable env secret.
DO '
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = ''cron_shared_secret'') THEN
    PERFORM vault.create_secret(''REPLACE_ME_WITH_INTERNAL_CRON_SECRET'', ''cron_shared_secret'');
  END IF;
END;
';

-- Remove deprecated per-function secret rows if present.
DO '
DECLARE
  v_id UUID;
BEGIN
  SELECT id INTO v_id FROM vault.secrets WHERE name = ''internal_cron_secret'';
  IF v_id IS NOT NULL THEN
    PERFORM vault.delete_secret(v_id);
  END IF;

  v_id := NULL;
  SELECT id INTO v_id FROM vault.secrets WHERE name = ''subledger_scheduled_jobs_secret'';
  IF v_id IS NOT NULL THEN
    PERFORM vault.delete_secret(v_id);
  END IF;
END;
';

-- Standardize cron commands to use one helper envelope.
DO '
DECLARE
  v_job_id BIGINT;
BEGIN
  FOR v_job_id IN
    SELECT jobid FROM cron.job WHERE jobname IN (
      ''qbo-process-pending-safety-net'',
      ''subledger-listing-outbox-processor'',
      ''subledger-qbo-posting-outbox-processor'',
      ''subledger-settlement-reconciliation-refresh'',
      ''subledger-market-intelligence-refresh'',
      ''ebay-retry-order'',
      ''ebay-import-payouts'',
      ''ebay-sync'',
      ''rebrickable-daily-sync'',
      ''process-email-queue''
    )
  LOOP
    PERFORM cron.alter_job(
      job_id := v_job_id,
      command := CASE
        WHEN (SELECT jobname FROM cron.job WHERE jobid = v_job_id) = ''qbo-process-pending-safety-net''
          THEN ''SELECT public.invoke_internal_function(''''qbo-process-pending'''');''
        WHEN (SELECT jobname FROM cron.job WHERE jobid = v_job_id) = ''subledger-listing-outbox-processor''
          THEN ''SELECT public.invoke_internal_function(''''subledger-scheduled-jobs'''', ''{"job":"listing_outbox"}''::jsonb);''
        WHEN (SELECT jobname FROM cron.job WHERE jobid = v_job_id) = ''subledger-qbo-posting-outbox-processor''
          THEN ''SELECT public.invoke_internal_function(''''subledger-scheduled-jobs'''', ''{"job":"qbo_posting_outbox"}''::jsonb);''
        WHEN (SELECT jobname FROM cron.job WHERE jobid = v_job_id) = ''subledger-settlement-reconciliation-refresh''
          THEN ''SELECT public.invoke_internal_function(''''subledger-scheduled-jobs'''', ''{"job":"settlement_reconciliation_refresh"}''::jsonb);''
        WHEN (SELECT jobname FROM cron.job WHERE jobid = v_job_id) = ''subledger-market-intelligence-refresh''
          THEN ''SELECT public.invoke_internal_function(''''subledger-scheduled-jobs'''', ''{"job":"market_intelligence_refresh"}''::jsonb);''
        WHEN (SELECT jobname FROM cron.job WHERE jobid = v_job_id) = ''ebay-retry-order''
          THEN ''SELECT public.invoke_internal_function(''''ebay-retry-order'''');''
        WHEN (SELECT jobname FROM cron.job WHERE jobid = v_job_id) = ''ebay-import-payouts''
          THEN ''SELECT public.invoke_internal_function(''''ebay-import-payouts'''');''
        WHEN (SELECT jobname FROM cron.job WHERE jobid = v_job_id) = ''ebay-sync''
          THEN ''SELECT public.invoke_internal_function(''''ebay-sync'''');''
        WHEN (SELECT jobname FROM cron.job WHERE jobid = v_job_id) = ''rebrickable-daily-sync''
          THEN ''SELECT public.invoke_internal_function(''''rebrickable-sync'''');''
        WHEN (SELECT jobname FROM cron.job WHERE jobid = v_job_id) = ''process-email-queue''
          THEN ''SELECT public.invoke_internal_function(''''process-email-queue'''');''
        ELSE (SELECT command FROM cron.job WHERE jobid = v_job_id)
      END
    );
  END LOOP;
END;
';
