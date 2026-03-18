

## Plan: Fix build error and deploy all edge functions

There is a TypeScript build error in `process-email-queue/index.ts` that must be fixed before deployment can succeed. The error is that `msg` and `id` parameters lack type annotations.

### Step 1: Fix TypeScript errors in process-email-queue

Add explicit type annotations to lines 125 and 130:
- Line 125: `(msg)` → `(msg: any)`
- Line 130: `(id)` → `(id: any)`

### Step 2: Deploy all 24 edge functions

Deploy every function declared in `supabase/config.toml`.

### Note on migrations

Database migrations are managed automatically by Lovable Cloud and cannot be manually triggered through this interface. The migrations in `supabase/migrations/` are applied when they are created. If there are unapplied migrations, they would need to be reviewed individually.

