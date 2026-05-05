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
- For `pg_cron` → Edge Function calls, use the vault-stored `service_role_key` as the `Authorization: Bearer` token. Read it inline in each `cron.schedule()` SQL body:
  ```sql
  (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
  ```
  The vault row must be seeded once (e.g. `SELECT vault.create_secret('<value>', 'service_role_key')`). Every new cron job must follow this pattern — do NOT introduce anon key + `x-internal-shared-secret` for cron auth. That pattern requires coordinated setup of both vault rows and Edge Function env vars and is operationally fragile.
- Edge Functions called by cron must accept service-role JWT. Use `verifyServiceRoleJWT()` from `supabase/functions/_shared/auth.ts` — do NOT byte-compare the raw token to `SUPABASE_SERVICE_ROLE_KEY`.
- Webhook receivers still must land raw payloads and return quickly. Auth cleanup must preserve the land -> stage -> validate -> map -> promote architecture and must not inline processing into receivers.

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
