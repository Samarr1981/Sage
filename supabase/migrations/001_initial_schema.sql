-- ─────────────────────────────────────────────────────────────────────────────
-- TABLES
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.users (
  id          uuid primary key default gen_random_uuid(),
  clerk_id    text unique not null,
  email       text,
  created_at  timestamptz not null default now()
);

create table if not exists public.sessions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.users(id) on delete cascade,
  role             text,
  level            text,
  created_at       timestamptz not null default now(),
  duration_seconds integer
);

create table if not exists public.evaluations (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references public.sessions(id) on delete cascade,
  overall_score numeric,
  strengths     text[],
  improvements  text[],
  created_at    timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.users      enable row level security;
alter table public.sessions   enable row level security;
alter table public.evaluations enable row level security;

-- users: each row is only visible/writable to the matching Clerk user.
-- auth.jwt() ->> 'sub' contains the Clerk user ID when you use the
-- Clerk → Supabase JWT template (see README note below).
create policy "users: own record only"
  on public.users for all
  using  (clerk_id = (auth.jwt() ->> 'sub'))
  with check (clerk_id = (auth.jwt() ->> 'sub'));

-- sessions: only accessible through the user's own users row.
create policy "sessions: own sessions only"
  on public.sessions for all
  using (
    user_id in (
      select id from public.users
      where clerk_id = (auth.jwt() ->> 'sub')
    )
  )
  with check (
    user_id in (
      select id from public.users
      where clerk_id = (auth.jwt() ->> 'sub')
    )
  );

-- evaluations: only accessible through the user's own sessions.
create policy "evaluations: own evaluations only"
  on public.evaluations for all
  using (
    session_id in (
      select s.id from public.sessions s
      join public.users u on u.id = s.user_id
      where u.clerk_id = (auth.jwt() ->> 'sub')
    )
  )
  with check (
    session_id in (
      select s.id from public.sessions s
      join public.users u on u.id = s.user_id
      where u.clerk_id = (auth.jwt() ->> 'sub')
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- NOTE: Clerk JWT → Supabase setup (one-time, in dashboards)
-- 1. Clerk Dashboard → JWT Templates → New → Supabase
--    Copy the generated signing secret.
-- 2. Supabase Dashboard → Project Settings → API → JWT Secret
--    Paste the signing secret from step 1.
-- After this, tokens issued by Clerk will be accepted by Supabase RLS.
-- ─────────────────────────────────────────────────────────────────────────────
