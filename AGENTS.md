# AGENTS.md — AI Agent Instructions

> **All AI agents working on this repository must read `docs/design-specification.md` before making significant changes.** It is the canonical design document covering product design, architecture, domain rules, integration patterns, and operational requirements.

## Project Summary

This is a **LEGO resale commerce platform** — a full-stack web application with a public storefront and back-office for buying, grading, listing, selling, and reconciling LEGO sets across multiple channels (website, eBay, BrickLink, BrickOwl).

**Stack**: React 18 / TypeScript / Vite / Tailwind CSS / shadcn-ui on Supabase (PostgreSQL, Edge Functions, Auth, Storage). Payments via Stripe. Integrations with QuickBooks Online, eBay, BrickLink, BrickOwl, Rebrickable, BrickEconomy.

## Mandatory Design Principles

1. **App-controlled truth** — The app controls canonical data. No external system may write directly into canonical app tables.
2. **Staged integration only** — All external inputs: land → stage → validate → map → promote. Nothing writes straight into core tables.
3. **Dual mastery** — QBO is the financial/accounting master. The app is the operational master (unit-level stock, content, media, pricing, listings, audit).
4. **Master once, project many** — Content, media, SEO, and pricing are mastered centrally and projected to channels.
5. **Audit first** — Every material event must be traceable.
6. **Version-aware LEGO modelling** — MPN includes version suffix (e.g., `75367-1`). SKU = `MPN.grade` (e.g., `75367-1.3`). Condition grades 1–4 are saleable, 5 is non-saleable.
7. **Settings separate from operations** — Configuration and integrations live in Settings, not operational pages.

## Key Domain Terms

| Term | Definition |
|------|-----------|
| MPN | LEGO identifier with version, e.g., `75367-1` |
| SKU | `MPN.grade`, e.g., `75367-1.3` |
| Stock unit | Individual physical item tracked at unit level |
| Landed cost | Purchase cost + apportioned buying/delivery fees |
| Carrying value | Landed cost − accumulated impairment |
| Condition grade | 1 (best) to 4 (lowest saleable), 5 (non-saleable) |

## Repository Structure

- `src/` — React frontend (components, pages, hooks, lib, integrations)
- `supabase/functions/` — Supabase Edge Functions (Deno/TypeScript)
- `supabase/migrations/` — SQL database migrations
- `docs/design-specification.md` — **Full design specification (READ THIS)**

## Constraints

- Do NOT let external systems write directly to canonical tables
- Do NOT use Rebrickable as a sales channel (data source only)
- Do NOT scrape BrickEconomy beyond their 100 req/day API limit
- Do NOT remove MPN version suffixes — they affect pricing and collectability
- Do NOT embed integration config on operational pages
- Do NOT collapse unit-level stock into coarse SKU-only operations
