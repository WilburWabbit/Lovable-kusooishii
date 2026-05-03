ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS ai_provider text NOT NULL DEFAULT 'lovable';

ALTER TABLE app_settings
  DROP CONSTRAINT IF EXISTS app_settings_ai_provider_check;

ALTER TABLE app_settings
  ADD CONSTRAINT app_settings_ai_provider_check
  CHECK (ai_provider IN ('lovable', 'openai'));
