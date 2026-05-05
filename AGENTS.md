# AGENTS.md — AI Agent Instructions

> **All AI agents working on this repository must read `docs/design-specification.md` and the YAML specs in `docs/specs/` before making significant changes.** Together they are the canonical design documents covering product design, architecture, domain rules, integration patterns, and operational requirements.

## Project Summary

This is a **LEGO resale commerce platform** — a full-stack web application with a public storefront and back-office for buying, grading, listing, selling, and reconciling LEGO sets across multiple channels (website, eBay, BrickLink, BrickOwl).

**Stack**: React 18 / TypeScript / Vite / Tailwind CSS / shadcn-ui on Supabase (PostgreSQL, Edge Functions, Auth, Storage). Payments via Stripe. Integrations with QuickBooks Online, eBay, BrickLink, BrickOwl, Rebrickable, BrickEconomy.

## Mandatory Design Principles

1. **App-controlled truth** — The app controls canonical data. No external system may write directly into canonical app tables.
2. **Staged integration only** — All external inputs: land → stage → validate → map → promote. Nothing writes straight into core tables.
3. **Dual mastery** — QBO is the financial/accounting master. The app is the operational master (unit-level stock, content, media, pricing, listings, audit).
4. **Master once, project many** — Content, media, SEO, and pricing are mastered centrally and projected to channels.
5. **Audit first** — Every material event must be traceable.
6. **Version-aware LEGO modelling** — MPN includes version suffix (e.g., `75367-1`). SKU = `MPN.grade` (e.g., `75367-1.3`). Condition grades 1–5 are saleable; grade 5 is Red Card and requires clear disclosure.
7. **Settings separate from operations** — Configuration and integrations live in Settings, not operational pages.

## Key Domain Terms

| Term | Definition |
|------|-----------|
| MPN | LEGO identifier with version, e.g., `75367-1` |
| SKU | `MPN.grade`, e.g., `75367-1.3` |
| Stock unit | Individual physical item tracked at unit level |
| Landed cost | Purchase cost + apportioned buying/delivery fees |
| Carrying value | Landed cost − accumulated impairment |
| Condition grade | 1 (best) to 5 (Red Card, lowest condition tier and saleable by operator choice) |

## Repository Structure

- `src/` — React frontend (components, pages, hooks, lib, integrations)
- `supabase/functions/` — Supabase Edge Functions (Deno/TypeScript)
- `supabase/migrations/` — SQL database migrations
- `docs/design-specification.md` — **Full design specification (READ THIS)**
- `docs/specs/` — **YAML spec files (READ THESE TOO)**

## API Specifications (`docs/specs/`)

27 OpenAPI YAML specs covering all external integrations and the platform's own API. **Read the relevant spec before writing or modifying any integration code.**

- **eBay** (18 specs): `sell_inventory_v1_oas3.yaml`, `sell_fulfillment_v1_oas3.yaml`, `sell_finances_v1_oas3.yaml`, `sell_marketing_v1_oas3.yaml`, `sell_account_v1/v2_oas3.yaml`, `sell_feed_v1_oas3.yaml`, `sell_metadata_v1_oas3.yaml`, `sell_compliance_v1_oas3.yaml`, `sell_analytics_v1_oas3.yaml`, `sell_negotiation_v1_oas3.yaml`, `sell_recommendation_v1_oas3.yaml`, `sell_stores_v1_oas3.yaml`, `sell_logistics_v1_oas3.yaml`, `sell_edelivery_international_shipping_oas3.yaml`, plus 3 developer APIs. Auth: OAuth 2.0. Note: Inventory API has 250 revisions/day limit per listing; Finances API requires digital signatures for EU/UK.
- **Google** (4 specs): `ga-admin-openapi.yaml`, `ga4-data-openapi.yaml`, `google-tag-manager-openapi.yaml`, `google-merchant-api-openapi.yaml`. Auth: OAuth 2.0.
- **BrickEconomy**: `brickeconomy-openapi.yaml`. API key header. **100 req/day hard limit.**
- **BrickOwl**: `brickowl-openapi.yaml`. API key. 600 req/min (100/min bulk).
- **Brickset**: `brickset-openapi.yaml`. API key. ASMX/JSON interface.
- **QuickBooks Online**: `quickbooks_account_api_full.yaml`. OAuth 2.0. Prod + sandbox.
- **Platform**: `lego_resale_platform_api.yaml`. The app's own API contract.

## Constraints

- Do NOT let external systems write directly to canonical tables
- Do NOT use Rebrickable as a sales channel (data source only)
- Do NOT scrape BrickEconomy beyond their 100 req/day API limit
- Do NOT remove MPN version suffixes — they affect pricing and collectability
- Do NOT embed integration config on operational pages
- Do NOT collapse unit-level stock into coarse SKU-only operations
- Do NOT process webhook payloads inline in receivers — land in staging, process asynchronously
- Do NOT skip staging tables for any external data
- Do NOT build monolithic receive-validate-process-write Edge Functions
- For migrations that may be run through Lovable SQL, do NOT use dollar-quoted function bodies (`$$` or `$function$`). Use single-quoted function bodies with doubled internal quotes, because Lovable's SQL runner can misparse dollar-quoted PL/pgSQL as an unterminated string.

## Supabase in Lovable Projects

Lovable auto-injects `SUPABASE_SERVICE_ROLE_KEY` into every Edge Function at runtime. Reading it with `Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")` to create a server-side admin Supabase client is correct and expected. Do not remove those admin-client usages when auditing service-role handling.

Service-role misuse to avoid:

- Do NOT authenticate internal callers by byte-comparing bearer tokens to `Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")` (for example, `token === serviceRoleKey`). This breaks after key rotation when a valid service-role JWT in another caller no longer byte-matches the function environment.
- For service-role bypasses, decode the JWT and verify `role === "service_role"` and `ref === <project-ref-from-SUPABASE_URL>`. The existing good pattern is in `supabase/functions/qbo-process-pending/index.ts`; new or refactored code should centralize this as `verifyServiceRoleJWT()` in `supabase/functions/_shared/auth.ts`.
- Webhook receivers still must land raw payloads and return quickly. Auth cleanup must preserve the land -> stage -> validate -> map -> promote architecture and must not inline processing into receivers.

## Cron Jobs (pg_cron → Edge Function) — End-to-End Pattern

This is the canonical, working pattern for every scheduled job. It survives Supabase API-key rotations and the new `sb_secret_*` / `sb_publishable_*` key format.

### Architecture

```
pg_cron (cron.schedule)
   │  Authorization: Bearer <vault.service_role_key>
   ▼
Edge Function
   │  verifyServiceRoleJWT(token, SUPABASE_URL)  ← from _shared/auth.ts
   ▼
Business logic (uses createAdminClient())
```

Two secrets must stay in sync:

| Where | Name | Source of truth |
|---|---|---|
| Edge Function env | `SUPABASE_SERVICE_ROLE_KEY` | Lovable runtime (auto-injected) |
| Postgres Vault | `service_role_key` | Synced by `bootstrap-cron-vault` |

The bootstrap function copies the runtime env value into Vault so cron always sends the current key.

### One-time setup (per project)

1. **Vault helper RPC** — `public.admin_set_cron_vault_secret(p_name, p_value)` (SECURITY DEFINER, granted to `service_role` only). Allowed names: `internal_cron_secret`, `subledger_scheduled_jobs_secret`, `service_role_key`. Seed Vault rows once with `SELECT vault.create_secret('<placeholder>', '<name>')` if missing.
2. **`bootstrap-cron-vault` Edge Function** — reads `SUPABASE_SERVICE_ROLE_KEY` and `INTERNAL_CRON_SECRET` from env and upserts them into Vault via the RPC. Authn accepts either the `x-internal-shared-secret` header or a valid service-role token (validated via `verifyServiceRoleJWT`).
3. **Run bootstrap** after every key rotation:
   ```bash
   curl -X POST "$SUPABASE_URL/functions/v1/bootstrap-cron-vault" \
     -H "x-internal-shared-secret: $INTERNAL_CRON_SECRET"
   ```

### Shared auth helper (`supabase/functions/_shared/auth.ts`)

`verifyServiceRoleJWT(token, supabaseUrl)` accepts BOTH formats:

- **New API-key format** (`sb_secret_…`): constant-time compare against the runtime `SUPABASE_SERVICE_ROLE_KEY`.
- **Legacy/asymmetric JWT**: decode payload, require `role === "service_role"` AND (`ref === <project-ref>` OR `iss` host starts with the project ref).

Never byte-compare a raw bearer token to `SUPABASE_SERVICE_ROLE_KEY` directly in a function — always go through this helper.

### Scheduling a job (SQL — use `supabase--insert`, NOT `migration`)

Cron schedules contain project-specific URLs and must NOT live in migration files (they would run on every remix).

```sql
SELECT cron.schedule(
  'my-job-every-5min',
  '*/5 * * * *',
  $cron$
  SELECT net.http_post(
    url := rtrim(
      (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1),
      '/'
    ) || '/functions/v1/my-function',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1
      )
    ),
    body := '{}'::jsonb
  );
  $cron$
);
```

Notes:
- Read `service_role_key` and `supabase_url` from `vault.decrypted_secrets` **inline in the schedule body** so each tick picks up the current value.
- Do NOT hardcode the anon key or use `x-internal-shared-secret` for cron — that pattern is fragile and is being phased out.
- `vault.decrypted_secrets` is blocked from `read_query`; verify Vault contents indirectly by triggering a job and inspecting `net._http_response`.

### Edge Function template for a cron-callable function

```typescript
import { verifyInternalSharedSecret, verifyServiceRoleJWT } from "../_shared/auth.ts";
import { corsHeaders, createAdminClient } from "../_shared/qbo-helpers.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : "";

  const isInternal =
    verifyInternalSharedSecret(req) ||           // human/admin-triggered with shared secret
    verifyServiceRoleJWT(token, supabaseUrl);    // pg_cron or service-to-service

  if (!isInternal) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createAdminClient();
  // … business logic …
});
```

For functions that fan out to other Edge Functions (e.g. `subledger-scheduled-jobs`), forward the runtime `SUPABASE_SERVICE_ROLE_KEY` as the `Authorization: Bearer` token — the receiving function's `verifyServiceRoleJWT` will accept it.

### Verification checklist (run after any change to cron auth)

1. Deploy: `bootstrap-cron-vault` + every cron-target function + `_shared/auth.ts` consumers.
2. Run `bootstrap-cron-vault` to refresh Vault.
3. Trigger the cron HTTP path manually:
   ```sql
   SELECT net.http_post(
     url := rtrim((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='supabase_url' LIMIT 1),'/')
            || '/functions/v1/<fn>',
     headers := jsonb_build_object(
       'Content-Type','application/json',
       'Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='service_role_key' LIMIT 1)
     ),
     body := '{}'::jsonb
   );
   ```
4. Inspect `net._http_response` for the returned `id` — expect 200 (or 207 with job-level results), never 401/403.
5. Check `cron.job_run_details` for `status='succeeded'` on the next tick.
6. Check Edge Function logs for absence of `Unauthorized — invalid token`.

### Common failure modes

| Symptom | Cause | Fix |
|---|---|---|
| 401 `Unauthorized` from cron after key rotation | Vault `service_role_key` is stale | Re-run `bootstrap-cron-vault` |
| 401 with `sb_secret_…` token | Function uses old `verifyServiceRoleJWT` that only accepts JWTs | Redeploy function so it picks up the updated `_shared/auth.ts` |
| 400 `Unauthorized` with valid token | Function still byte-compares to `SUPABASE_SERVICE_ROLE_KEY` | Replace with `verifyServiceRoleJWT()` |
| Cron `succeeded` but `net._http_response.status_code` is 4xx | Auth fails inside Edge Function | Check function logs; usually a stale deployment |


## Integration Architecture Patterns

> Full analysis: `docs/knowledgebase/docs/qbo-integration-lessons.md`

When building or modifying any external integration:

1. **Land-only receivers** — Webhook/API receiver Edge Functions store raw payloads in staging (`landing_raw_*`) and return immediately. No inline processing.
2. **Separate processor** — A dedicated processor function reads staging → validates → maps → promotes to canonical tables.
3. **Dependency ordering** — Process entities in strict dependency order. Parents before children. Check pending counts at tier boundaries.
4. **Reconciliation is separate** — Do not mix reconciliation into sync/promotion. It runs as a distinct admin action after all ingestion completes.
5. **Preserve failed data** — Never discard payloads on error. Failed records stay in staging with `status: "error"` for retry.
6. **Idempotency** — Every staged record needs an external ID to prevent duplicate processing.
7. **Cross-channel dedup** — Use external ID reference tables (DocNumber, origin_channel + origin_reference), not timing/amount matching.
8. **Fix architecture, not symptoms** — If 5+ incremental fixes target the same subsystem, the architecture needs restructuring.
