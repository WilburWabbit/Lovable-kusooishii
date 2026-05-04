-- Adds an AI provider preference to app_settings.
-- 'lovable' (default) routes generative AI calls through the Lovable AI gateway;
-- 'openai' routes them directly to OpenAI. Edge functions also fall back from
-- Lovable -> OpenAI on rate-limit / payment errors when the OpenAI key exists.

ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS ai_provider text NOT NULL DEFAULT 'lovable';

ALTER TABLE app_settings
  DROP CONSTRAINT IF EXISTS app_settings_ai_provider_check;

ALTER TABLE app_settings
  ADD CONSTRAINT app_settings_ai_provider_check
  CHECK (ai_provider IN ('lovable', 'openai'));
