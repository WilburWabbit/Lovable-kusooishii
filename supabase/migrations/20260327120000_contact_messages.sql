-- Contact form messages table
create table if not exists public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  subject text not null,
  message text not null,
  created_at timestamptz not null default now()
);

-- RLS: only service_role can insert/read (edge function uses service_role)
alter table public.contact_messages enable row level security;

-- No public policies — only service_role bypasses RLS
comment on table public.contact_messages is 'Stores contact form submissions from the storefront.';
