DO $$
DECLARE
  v_id uuid;
  v_secret text := '8bcdd21fc4475756ff74e4d9';
BEGIN
  SELECT id INTO v_id FROM vault.secrets WHERE name = 'internal_cron_secret';
  IF v_id IS NULL THEN
    PERFORM vault.create_secret(v_secret, 'internal_cron_secret', 'Internal shared secret for cron-invoked edge functions');
  ELSE
    PERFORM vault.update_secret(v_id, v_secret, 'internal_cron_secret', 'Internal shared secret for cron-invoked edge functions');
  END IF;

  SELECT id INTO v_id FROM vault.secrets WHERE name = 'subledger_scheduled_jobs_secret';
  IF v_id IS NULL THEN
    PERFORM vault.create_secret(v_secret, 'subledger_scheduled_jobs_secret', 'Mirror of internal_cron_secret for subledger scheduled jobs');
  ELSE
    PERFORM vault.update_secret(v_id, v_secret, 'subledger_scheduled_jobs_secret', 'Mirror of internal_cron_secret for subledger scheduled jobs');
  END IF;
END $$;