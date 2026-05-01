create table public.lovable_agent_transcripts (
  id uuid primary key default gen_random_uuid(),
  message_index integer not null,
  message_index_end integer,
  role text not null check (role in ('user','assistant','system','range')),
  occurred_at timestamptz,
  source_file text not null,
  part_number integer not null,
  title text,
  body text not null,
  token_count integer not null default 0,
  char_count integer not null default 0,
  created_at timestamptz not null default now(),
  unique (source_file, message_index, role)
);

create index lovable_agent_transcripts_chrono_idx
  on public.lovable_agent_transcripts (occurred_at desc nulls last, message_index desc);

create index lovable_agent_transcripts_role_idx
  on public.lovable_agent_transcripts (role);

alter table public.lovable_agent_transcripts enable row level security;

create policy "Admins and staff read transcripts"
  on public.lovable_agent_transcripts
  for select
  to authenticated
  using (
    public.has_role(auth.uid(), 'admin')
    or public.has_role(auth.uid(), 'staff')
  );