UPDATE public.outbound_command
SET status = 'pending',
    retry_count = 0,
    last_error = NULL,
    next_attempt_at = now(),
    updated_at = now()
WHERE target_system IN ('google_shopping', 'gmc')
  AND entity_type = 'channel_listing'
  AND status IN ('pending', 'failed')
  AND last_error = '[object Object]';

UPDATE public.reconciliation_case rc
SET due_at = now(),
    recommended_action = 'Rerun the listing outbox processor after the Google Merchant API v1 migration.',
    evidence = jsonb_set(
      jsonb_set(
        jsonb_set(
          COALESCE(rc.evidence, '{}'::jsonb),
          '{last_error}',
          to_jsonb('Reset after Google Merchant API v1 migration; previous error was masked as [object Object].'::text),
          true
        ),
        '{retry_count}',
        '0'::jsonb,
        true
      ),
      '{reset_reason}',
      to_jsonb('merchant_api_v1beta_shutdown'::text),
      true
    ),
    updated_at = now()
FROM public.outbound_command oc
WHERE rc.case_type = 'listing_command_failed'
  AND rc.related_entity_type = 'outbound_command'
  AND rc.related_entity_id = oc.id
  AND rc.status IN ('open', 'in_progress')
  AND oc.target_system IN ('google_shopping', 'gmc')
  AND oc.entity_type = 'channel_listing'
  AND rc.evidence->>'last_error' = '[object Object]';