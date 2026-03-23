# CI/CD: Supabase Edge Functions

## Overview

A GitHub Actions workflow automatically deploys all Supabase Edge Functions whenever changes to `supabase/functions/` or `supabase/config.toml` are merged into `main`.

**Workflow file:** `.github/workflows/deploy-edge-functions.yml`

## Required GitHub Secrets

Configure these in **GitHub → Settings → Secrets and variables → Actions**:

| Secret | Value | How to obtain |
|---|---|---|
| `SUPABASE_ACCESS_TOKEN` | A Supabase personal access token | Generate at https://supabase.com/dashboard/account/tokens |
| `SUPABASE_PROJECT_ID` | `gcgrwujfyurgetvqlmbf` | Supabase project reference ID |

## How It Works

- **Trigger:** Push to `main` that changes files under `supabase/functions/**` or `supabase/config.toml`
- **Manual trigger:** Can also be run from the GitHub Actions UI via `workflow_dispatch`
- **Deployment:** Runs `supabase functions deploy` which deploys all functions declared in `supabase/config.toml`

Frontend-only commits do not trigger the workflow.

## Adding a New Edge Function

1. Create the function directory: `supabase/functions/<function-name>/index.ts`
2. Add an entry to `supabase/config.toml`:
   ```toml
   [functions.<function-name>]
   verify_jwt = false
   ```
3. Merge to `main` — the workflow will deploy it automatically

## Manual Deployment

To trigger a deployment without a code change:

1. Go to the **Actions** tab in GitHub
2. Select **Deploy Edge Functions**
3. Click **Run workflow** → select `main` → **Run workflow**

## Notes

- All functions use `verify_jwt = false` because they handle JWT validation manually in their source code
- Lovable may also deploy edge functions via its chat UI — `config.toml` ensures the repo remains the source of truth for which functions exist

---

# CI/CD: Database Migrations

## Overview

A separate GitHub Actions workflow automatically applies database migrations whenever changes to `supabase/migrations/` are merged into `main`.

**Workflow file:** `.github/workflows/deploy-migrations.yml`

## Required GitHub Secrets

Same secrets as edge function deployment — no additional configuration needed:

| Secret | Value |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | Supabase personal access token |
| `SUPABASE_PROJECT_ID` | `gcgrwujfyurgetvqlmbf` |

## How It Works

- **Trigger:** Push to `main` that changes files under `supabase/migrations/**`
- **Manual trigger:** Can also be run from the GitHub Actions UI via `workflow_dispatch`
- **Deployment:** Runs `supabase db push` which applies any unapplied migrations in order, skipping those already recorded in the remote `supabase_migrations.schema_migrations` table

The command is idempotent — safe to run repeatedly. Migrations applied by Lovable Cloud are tracked in the same history table, so both paths are compatible.

## Manual Deployment

1. Go to the **Actions** tab in GitHub
2. Select **Deploy Migrations**
3. Click **Run workflow** → select `main` → **Run workflow**
