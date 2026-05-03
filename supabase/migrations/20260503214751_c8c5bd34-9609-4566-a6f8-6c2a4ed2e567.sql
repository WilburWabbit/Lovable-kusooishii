-- Apply pending pricing migrations 190000, 193000, 212000, 220000 (final superseding form)
UPDATE public.selling_cost_defaults
SET value = value / 100,
    updated_at = now()
WHERE key = 'risk_reserve_rate'
  AND value >= 0.10;

CREATE OR REPLACE FUNCTION public.validate_risk_reserve_default()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS '
BEGIN
  IF NEW.key = ''risk_reserve_rate'' THEN
    IF NEW.value < 0 OR NEW.value > 0.10 THEN
      RAISE EXCEPTION ''risk_reserve_rate must be between 0 and 0.10 (decimal, where 0.005 = 0.5%%)'';
    END IF;
  END IF;
  RETURN NEW;
END;
';

DROP TRIGGER IF EXISTS trg_validate_risk_reserve_default ON public.selling_cost_defaults;
CREATE TRIGGER trg_validate_risk_reserve_default
BEFORE INSERT OR UPDATE OF value, key ON public.selling_cost_defaults
FOR EACH ROW
EXECUTE FUNCTION public.validate_risk_reserve_default();