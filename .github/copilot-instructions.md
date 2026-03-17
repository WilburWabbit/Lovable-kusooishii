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
