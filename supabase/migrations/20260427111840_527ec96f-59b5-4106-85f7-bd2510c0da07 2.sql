-- Rebrickable sync support: cursor store for resumable long-running syncs
create table if not exists public.sync_state (
  key        text        primary key,
  value      jsonb       not null,
  updated_at timestamptz not null default now()
);

alter table public.sync_state enable row level security;

-- Service role only (RLS blocks all JWT-based access; service role bypasses RLS).
-- Wrap in DO block so re-running the migration is idempotent.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename  = 'sync_state'
      and policyname = 'Service role only'
  ) then
    create policy "Service role only"
      on public.sync_state
      for all
      using (false)
      with check (false);
  end if;
end$$;

comment on table public.sync_state is
  'Key/value store for resumable sync cursors. Written by edge functions only.';