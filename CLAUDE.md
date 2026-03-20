# CLAUDE.md — AI Agent Context for LEGO Resale Commerce Platform

> **Read `docs/design-specification.md` and the YAML specs in `docs/specs/` before making any significant changes.** Together they are the single source of truth for product design, architecture, domain rules, and integration patterns.
>
> **Cross-reference `docs/knowledgebase/`** (git submodule → [Lovable-knowledgebase](https://github.com/WilburWabbit/Lovable-knowledgebase)) for additional technical specs, integration details, and domain knowledge shared across projects.

## What This Project Is

A LEGO resale commerce platform — public storefront + back-office operations — for buying, grading, listing, selling, and reconciling LEGO sets across multiple channels (website, eBay, BrickLink, BrickOwl). Built with Lovable (React/Tailwind/Vite) on Supabase (PostgreSQL, Edge Functions, Auth, Storage).

## Tech Stack

- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui (Radix), React Router 6, TanStack Query, Zustand, Framer Motion
- **Backend**: Supabase (PostgreSQL, Edge Functions in Deno/TypeScript, Row Level Security, Realtime)
- **Payments**: Stripe Checkout
- **Integrations**: QuickBooks Online, eBay, BrickLink, BrickOwl, Rebrickable, BrickEconomy, GTM/GA4
- **Testing**: Playwright (E2E), Vitest (unit)

## Critical Design Principles

1. **App-controlled truth** — The app controls canonical data and lifecycle rules. No external system may write directly into canonical app tables.
2. **Staged integration only** — All external inputs land → stage → validate → promote. Nothing writes straight into core tables.
3. **QBO is financial master; app is operational master** — QBO owns accounting; the app owns unit-level stock, content, media, pricing, listings, and audit.
4. **Master once, project many** — Content, media, SEO, pricing are mastered centrally and projected outward to channels.
5. **Audit first** — Every material event must be traceable from trigger to downstream effects.
6. **Version-aware LEGO modelling** — MPN version suffixes (e.g., `75367-1`) are material and must be preserved everywhere.
7. **Settings separate from operations** — Config, integrations, and credentials belong in Settings pages, not operational pages.

## Domain Model Essentials

- **MPN**: LEGO identifier including version suffix, e.g., `75367-1`
- **SKU**: `MPN.grade`, e.g., `75367-1.3`
- **Condition grades**: 1 (highest) to 4 (lowest saleable), 5 (non-saleable)
- **Stock unit**: Individual physical item tracked at unit level
- **Landed cost**: Purchase cost + apportioned fees
- **Carrying value**: Landed cost less accumulated impairment

## Project Structure

```
src/                    # React frontend
  components/           # UI components (shadcn + custom)
  pages/                # Route pages (public storefront + admin back-office)
  hooks/                # Custom React hooks
  lib/                  # Utilities, Supabase client, helpers
  integrations/         # Supabase types and client config
supabase/
  functions/            # Edge Functions (Deno/TypeScript)
  migrations/           # SQL migrations
docs/
  design-specification.md   # FULL design spec — READ THIS
  specs/                    # YAML spec files — READ THESE TOO
  knowledgebase/            # Shared knowledge base (git submodule)
```

## API Specs (`docs/specs/`)

The `docs/specs/` directory contains **27 OpenAPI specifications** for every external integration and the platform's own API. **Consult the relevant spec before building or modifying any integration code.**

| Integration | Spec files | Key constraints |
|---|---|---|
| **eBay** (18 specs) | `sell_inventory_v1_oas3.yaml` (listings/offers), `sell_fulfillment_v1_oas3.yaml` (orders/shipping), `sell_finances_v1_oas3.yaml` (payouts — requires digital signatures for EU/UK), `sell_marketing_v1_oas3.yaml` (Promoted Listings), `sell_account_v1_oas3.yaml` / `v2` (seller config), `sell_feed_v1_oas3.yaml` (bulk uploads), `sell_metadata_v1_oas3.yaml` (marketplace policies), `sell_compliance_v1_oas3.yaml`, `sell_analytics_v1_oas3.yaml`, `sell_negotiation_v1_oas3.yaml`, `sell_recommendation_v1_oas3.yaml`, `sell_stores_v1_oas3.yaml`, `sell_logistics_v1_oas3.yaml`, `sell_edelivery_international_shipping_oas3.yaml`, `developer_analytics_v1_beta_oas3.yaml`, `developer_key_management_v1_oas3.yaml`, `developer_client_registration_v1_oas3.yaml` | OAuth 2.0; Inventory API: 250 revisions/day per listing |
| **Google** (4 specs) | `ga-admin-openapi.yaml` (Analytics Admin), `ga4-data-openapi.yaml` (GA4 reporting), `google-tag-manager-openapi.yaml` (GTM), `google-merchant-api-openapi.yaml` (Merchant Center) | OAuth 2.0; standard GCP quotas |
| **BrickEconomy** | `brickeconomy-openapi.yaml` | API key header; **100 req/day hard limit** |
| **BrickOwl** | `brickowl-openapi.yaml` | API key; 600 req/min (100/min bulk) |
| **Brickset** | `brickset-openapi.yaml` | API key; ASMX/JSON interface |
| **QuickBooks Online** | `quickbooks_account_api_full.yaml` | OAuth 2.0; prod + sandbox environments |
| **Platform API** | `lego_resale_platform_api.yaml` | The app's own API contract for inventory, orders, pricing, media, club collections |

**When to read a spec**: Any time you are writing, modifying, or debugging code that calls an external API or implements an endpoint defined in the platform API spec, open the relevant YAML first.

## Key Conventions

- Use TypeScript strict mode; prefer explicit types over `any`
- Use TanStack Query for all server state; Zustand for client-only state
- Edge Functions use Deno imports and Supabase client from `supabase-js`
- All database access from Edge Functions uses the service-role client for admin operations
- Follow existing component patterns with shadcn/ui; don't introduce new UI libraries
- Respect RLS policies — public-facing queries use the anon key; admin uses service role
- Keep Edge Functions focused — one concern per function where possible

## What NOT To Do

- Do NOT let external systems write directly to canonical tables
- Do NOT use Rebrickable as a sales channel (it's a data source only)
- Do NOT scrape BrickEconomy beyond their 100 req/day API limit
- Do NOT collapse unit-level stock into coarse SKU-only operations
- Do NOT embed integration config on operational pages
- Do NOT remove MPN version suffixes — they affect pricing and collectability
