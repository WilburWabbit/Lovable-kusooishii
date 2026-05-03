-- Keep admin Settings > Pricing minimum margin in sync with the canonical
-- commerce quote engine input used for floor calculations.

INSERT INTO public.selling_cost_defaults (key, value)
SELECT 'minimum_margin_rate', ps.value
FROM public.pricing_settings ps
WHERE ps.key = 'minimum_margin_target'
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_at = now();

CREATE OR REPLACE FUNCTION public.sync_minimum_margin_setting_to_cost_defaults()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS '
BEGIN
  IF NEW.key = ''minimum_margin_target'' THEN
    INSERT INTO public.selling_cost_defaults (key, value)
    VALUES (''minimum_margin_rate'', NEW.value)
    ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value,
        updated_at = now();
  END IF;

  RETURN NEW;
END;
';

DROP TRIGGER IF EXISTS trg_sync_minimum_margin_setting_to_cost_defaults
  ON public.pricing_settings;

CREATE TRIGGER trg_sync_minimum_margin_setting_to_cost_defaults
AFTER INSERT OR UPDATE OF value ON public.pricing_settings
FOR EACH ROW
EXECUTE FUNCTION public.sync_minimum_margin_setting_to_cost_defaults();
