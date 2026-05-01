# Lovable Agent Transcripts: DB import + Admin viewer + CSV export

## Overview

Parse the 10 transcript markdown files in `docs/transcript/`, load them into a new `lovable_agent_transcripts` table (one row per message), and add an admin page at `/admin/system/transcripts` that lists messages in reverse-chronological order with a "Export CSV" button.

## 1. Database

New migration creating:

```sql
create table public.lovable_agent_transcripts (
  id uuid primary key default gen_random_uuid(),
  message_index integer not null,            -- e.g. 197 (or first index of a range block)
  message_index_end integer,                  -- non-null when source is a range block (e.g. 851–870)
  role text not null check (role in ('user','assistant','system','range')),
  occurred_at timestamptz,                    -- parsed from header when present
  source_file text not null,                  -- e.g. PART_02_msgs_197-256.md
  part_number integer not null,               -- 2
  title text,                                 -- header tail after the dash if present
  body text not null,                         -- verbatim message body
  token_count integer not null,               -- estimated tokens (see §3)
  char_count integer not null,
  created_at timestamptz not null default now(),
  unique (source_file, message_index, role)
);

create index on public.lovable_agent_transcripts (occurred_at desc nulls last, message_index desc);
create index on public.lovable_agent_transcripts (role);

alter table public.lovable_agent_transcripts enable row level security;

create policy "Admins read transcripts"
  on public.lovable_agent_transcripts for select
  to authenticated
  using (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'staff'));
```

No public/insert policies — only the importer (service role) writes; admins read.

## 2. Importer (one-off seed via Edge Function)

New edge function `transcripts-import` (admin-only, requires `service_role` JWT):

- Reads each `docs/transcript/PART_*.md` shipped with the function as static assets (bundled into the function via `Deno.readTextFile` against files copied into `supabase/functions/transcripts-import/data/`).
- Parses two header shapes:
  - Per-message: `^## Message (\d+) — (User|Assistant) — (YYYY-MM-DD HH:MM)?$`
  - Range block: `^## Messages (\d+)[–-](\d+) — (.+)$` → role `range`, no timestamp, title = tail.
- Body = lines after the header up to the next header or end of file.
- Computes `token_count = Math.ceil(char_count / 4)` (cheap heuristic — no external API). `char_count` is exact.
- Upserts on `(source_file, message_index, role)` so re-running is idempotent.
- Returns `{ inserted, updated, skipped }`.

Triggered manually from the new admin page via a "Re-import transcripts" button.

## 3. Token counting

We do not have access to the actual Lovable per-message token usage (it's not stored in this repo, and there is no API to fetch it). Two options shown to the user before build:

- **A. Heuristic (default)**: `Math.ceil(chars / 4)`, labelled "Tokens (est.)" in the UI.
- **B. Exact via tiktoken**: add `js-tiktoken` to the edge function, encode each body with `cl100k_base`. ~30% slower import, but accurate.

I recommend A unless you specifically want exact counts; the heuristic is fine for relative sizing.

## 4. Admin page

New route `/admin/system/transcripts` (lazy-loaded) → `src/pages/admin-v2/TranscriptsPage.tsx`.

- Sidebar: add "Transcripts" item under the existing "System" group in `AdminV2Sidebar.tsx` (icon: `MessageSquare`).
- Layout: `AdminV2Layout` + `SectionHead` matching `AppHealthPage`.
- Toolbar:
  - Role filter: All / User / Assistant / Range
  - Text search (server-side `ilike` on `body` and `title`)
  - "Export CSV" button (uses existing `rowsToCsv` / `downloadCsv` from `src/lib/csv-sync/csv-utils.ts` — but with a transcripts-specific header list since transcripts are not a registered csv-sync table).
  - "Re-import" button (calls `transcripts-import` edge function).
- Table (shadcn `Table`), reverse-chronological by `occurred_at desc nulls last, message_index desc`:
  - Columns: When · Part · # · Role · Title/Preview (first ~140 chars of body) · Tokens · Chars
  - Row click → expands inline to show full `body` in a `<pre>` block.
- Pagination: 100/page using existing `PaginationControls`.

## 5. CSV export

Two modes via the same button group:

- **Page export**: current filtered/sorted page → client-side CSV from already-loaded rows.
- **Full export**: queries all matching rows in batches of 1000 (Supabase default limit) via the client, concatenates, and downloads `lovable_agent_transcripts_<YYYY-MM-DD>.csv`.

CSV columns: `message_index, message_index_end, role, occurred_at, source_file, part_number, title, token_count, char_count, body` (body quoted per RFC 4180 — newlines preserved).

## 6. Files touched

```
supabase/migrations/<ts>_lovable_agent_transcripts.sql        new
supabase/functions/transcripts-import/index.ts                 new
supabase/functions/transcripts-import/data/PART_*.md           new (copies of docs/transcript/*.md)
src/pages/admin-v2/TranscriptsPage.tsx                         new
src/hooks/admin/use-transcripts.ts                             new
src/components/admin-v2/AdminV2Sidebar.tsx                     +1 nav item
src/App.tsx                                                    +1 lazy route
```

## 7. Out of scope

- Live capture of new chat messages (not possible without a Lovable export API; same limitation noted in `docs/transcript/README.md`).
- Updating the existing `chat-and-plan` markdown export workflow.

## Open question

Token counting method — heuristic (fast, approximate) or `js-tiktoken` (exact, slower import)? Default is heuristic unless you say otherwise.
