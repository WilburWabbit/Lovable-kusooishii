

# Add Database Migration Deployment to GitHub Actions

## Overview

Add a new workflow (or extend the existing one) so that database migrations in `supabase/migrations/` are automatically applied to the Supabase project when merged to `main`.

## Approach

Create a separate workflow file dedicated to migrations. Keeping it separate from edge function deployment gives clearer logs and independent trigger paths.

## Changes

### 1. New workflow: `.github/workflows/deploy-migrations.yml`

- **Trigger**: Push to `main` changing `supabase/migrations/**`, plus `workflow_dispatch` for manual runs
- **Secrets required**: Same `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_ID` already configured
- **Steps**:
  1. Checkout repo
  2. Validate secrets
  3. Install Supabase CLI (`supabase/setup-cli@v1`)
  4. Link project: `supabase link --project-ref "$SUPABASE_PROJECT_ID"`
  5. Push migrations: `supabase db push --project-ref "$SUPABASE_PROJECT_ID"`

`supabase db push` applies any unapplied migrations from `supabase/migrations/` in order, skipping those already recorded in the remote `supabase_migrations.schema_migrations` table.

### 2. Update `docs/ci-cd.md`

Add a section documenting the new migrations workflow, triggers, and manual run instructions.

## Technical Notes

- No new GitHub secrets needed — reuses the existing `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_ID`
- The `supabase db push` command is idempotent — safe to run repeatedly
- Edge functions and migrations deploy independently based on which files changed
- Be aware: Lovable Cloud also manages migrations, so this workflow is for deployments via GitHub (outside Lovable). Both paths are compatible since they track the same migration history table.

