# GitHub Copilot Instructions — LEGO Resale Commerce Platform

## Context
Read `docs/design-specification.md` and the YAML specs in `docs/specs/` for full project context, architecture, and domain rules.

This is a LEGO resale commerce platform (public storefront + back-office) built with React/TypeScript/Vite/Tailwind/shadcn-ui on Supabase. It integrates with QBO, eBay, BrickLink, BrickOwl, Rebrickable, BrickEconomy, and Stripe.

## Design Principles
- App-controlled truth: no external system writes directly to canonical tables
- Staged integration: all external data passes through land → stage → validate → promote
- QBO = financial master; app = operational master (stock, content, media, pricing, audit)
- Master once, project many: content/media/pricing mastered centrally, projected to channels
- Audit first: every material event must be traceable
- Version-aware LEGO modelling: MPN version suffixes (e.g., `75367-1`) are always preserved
- SKU format: `MPN.grade` (e.g., `75367-1.3`), grades 1–4 saleable, 5 non-saleable

## API Specs (`docs/specs/`)
27 OpenAPI YAML specs for all integrations. Read the relevant spec before writing integration code.
- eBay (18 specs): sell_inventory, sell_fulfillment, sell_finances, sell_marketing, sell_account v1/v2, sell_feed, sell_metadata, sell_compliance, sell_analytics, sell_negotiation, sell_recommendation, sell_stores, sell_logistics, sell_edelivery, plus 3 developer APIs. OAuth 2.0; 250 revisions/day per listing.
- Google (4): ga-admin, ga4-data, google-tag-manager, google-merchant-api. OAuth 2.0.
- BrickEconomy: brickeconomy-openapi.yaml. API key. 100 req/day hard limit.
- BrickOwl: brickowl-openapi.yaml. API key. 600 req/min.
- Brickset: brickset-openapi.yaml. API key.
- QBO: quickbooks_account_api_full.yaml. OAuth 2.0.
- Platform: lego_resale_platform_api.yaml (the app's own API contract).

## Code Style
- TypeScript strict mode; explicit types, avoid `any`
- TanStack Query for server state; Zustand for client-only state
- shadcn/ui components with Tailwind; no additional UI libraries
- Edge Functions use Deno imports and supabase-js
- Service-role client for admin operations; anon key for public queries
- One concern per Edge Function

## Avoid
- Direct external writes to canonical tables
- Using Rebrickable as a sales channel
- Scraping BrickEconomy beyond 100 req/day
- Removing MPN version suffixes
- Mixing integration config into operational pages
