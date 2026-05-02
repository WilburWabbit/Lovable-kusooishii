# Add AI Provider Setting (Lovable AI primary, OpenAI fallback)

## Why
The Copy & SEO generator currently calls OpenAI directly. The OpenAI API key is returning **HTTP 429 `insufficient_quota`** (out of billing credits), which the function reports as "Rate limit exceeded." This will keep happening until billing is topped up. We'll switch the default to Lovable AI (uses the auto-provisioned `LOVABLE_API_KEY`, no separate billing) and keep OpenAI as a fallback.

## Behaviour
- **Default provider**: Lovable AI (configurable).
- **Automatic fallback**: when the primary provider is Lovable AI and it returns `429` (rate limit) or `402` (out of credits), the request is retried against OpenAI if `OPENAI_API_KEY` exists. The user gets the result, not an error.
- **No fallback when OpenAI is primary** — if you've explicitly chosen OpenAI you probably want to know it's broken, not silently spend Lovable credits.
- **Clear error messages** when both fail: distinguish "rate-limited" vs "credits exhausted" and suggest the right remediation.
- **UI toggle** in Data Sync settings showing which provider is active and recent fallback events.

## Changes

### 1. Database migration
Add a single column to `app_settings`:

```sql
ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS ai_provider text NOT NULL DEFAULT 'lovable';
ALTER TABLE app_settings
  ADD CONSTRAINT app_settings_ai_provider_check
  CHECK (ai_provider IN ('lovable', 'openai'));
```

### 2. Shared edge-function helper — `supabase/functions/_shared/ai-provider.ts` (new)
- `getConfiguredProvider(admin)` reads `app_settings.ai_provider`, defaults to `'lovable'`.
- `callChatCompletion(body, options)` — single entry point used by all AI-calling functions.
  - Picks endpoint + key per provider:
    - Lovable → `https://ai.gateway.lovable.dev/v1/chat/completions` with `LOVABLE_API_KEY`, model `openai/gpt-5` (gpt-4o-equivalent, supports vision + tool calling).
    - OpenAI → `https://api.openai.com/v1/chat/completions` with `OPENAI_API_KEY`, model `gpt-4o`.
  - On 429/402 from Lovable, transparently retries against OpenAI (when key present) and surfaces the result with a `fellBack: true` flag.
  - Returns user-friendly error messages keyed off the actual upstream status.

### 3. Update edge functions
- **`generate-product-copy/index.ts`** — replace direct `fetch("https://api.openai.com/...")` with `callChatCompletion(...)`. Drop the hand-rolled 429 handler (helper handles it). Tool-calling shape stays identical.
- **`chatgpt/index.ts`** — same swap for the age-mark vision call. Use the helper with `max_tokens: 20`.

### 4. admin-data router — new actions
- `get-ai-provider` → `{ ai_provider: 'lovable' | 'openai' }`.
- `set-ai-provider` → updates `app_settings.ai_provider`, writes an audit event, validates input.

### 5. UI — `src/components/admin-v2/AiProviderSettingsCard.tsx` (new)
- Reads the current provider via `admin-data` and renders a two-button segmented control: **Lovable AI** / **OpenAI**.
- Shows a small badge ("Active" / "Fallback available") and a one-line description of behaviour.
- Mounts on `src/pages/admin-v2/DataSyncPage.tsx` next to the other integration settings cards.

### 6. Toast messaging
Frontend callers (e.g. the Copy & SEO generator) keep their existing error display, but now the message comes from the helper and reads, e.g.:
- "Lovable AI is rate-limited. Please try again in a moment."
- "Lovable AI workspace credits are exhausted. Add funds in Settings → Workspace → Usage, or switch the AI provider to OpenAI."

## Out of scope
- Migrating non-chat features (image generation, embeddings) — none currently use OpenAI in this codebase.
- Per-user provider preference — single setting for the whole workspace, matching the other admin settings.

## Acceptance
- A Copy & SEO generation succeeds against Lovable AI by default.
- Setting `ai_provider = 'openai'` (via the UI) and triggering generation routes to OpenAI directly (and surfaces the current quota error verbatim).
- Setting `ai_provider = 'lovable'` while Lovable AI is intentionally rate-limited produces a successful response via the OpenAI fallback (with a log line `ai-provider: Lovable AI returned 429; falling back to OpenAI`).
