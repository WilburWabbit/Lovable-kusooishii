CREATE OR REPLACE FUNCTION public.admin_set_cron_vault_secret(p_name text, p_value text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS '
DECLARE
  v_id uuid;
BEGIN
  IF p_name NOT IN (''internal_cron_secret'',''subledger_scheduled_jobs_secret'') THEN
    RAISE EXCEPTION ''Disallowed secret name: %'', p_name;
  END IF;
  IF p_value IS NULL OR length(p_value) < 8 THEN
    RAISE EXCEPTION ''Secret value missing or too short'';
  END IF;

  SELECT id INTO v_id FROM vault.secrets WHERE name = p_name;
  IF v_id IS NULL THEN
    PERFORM vault.create_secret(p_value, p_name);
  ELSE
    PERFORM vault.update_secret(v_id, p_value, p_name);
  END IF;
  RETURN ''ok'';
END;
';

REVOKE ALL ON FUNCTION public.admin_set_cron_vault_secret(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_cron_vault_secret(text, text) TO service_role;