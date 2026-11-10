-- Channel Green: initial schema.
-- Only the realtime server talks to these tables, using the service-role key.
-- Row level security is switched on with no public policies, so the browser (anon key)
-- can read and write nothing here. Run in the Supabase SQL editor or with `supabase db push`.

create table if not exists public.profiles (
  id          uuid primary key,              -- the Supabase auth user id
  name        text not null,
  avatar      jsonb not null,
  updated_at  timestamptz not null default now()
);

create table if not exists public.bans (
  uid         text primary key,              -- guest id or auth user id
  reason      text not null default '',
  created_at  timestamptz not null default now()
);

create table if not exists public.blocks (
  owner_uid    text not null,
  blocked_uid  text not null,
  created_at   timestamptz not null default now(),
  primary key (owner_uid, blocked_uid)
);

create table if not exists public.reports (
  id             text primary key,
  reporter_uid   text not null,
  target_uid     text,
  confession_id  text,
  reason         text not null,
  details        text,
  map_id         text,
  context        jsonb,
  created_at     timestamptz not null default now()
);
create index if not exists reports_created_idx on public.reports (created_at desc);

create table if not exists public.confessions (
  id          text primary key,
  body        text not null,
  author_uid  text not null,                 -- kept for moderation only, never sent to other players
  hearts      integer not null default 0,
  hidden      boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists confessions_created_idx on public.confessions (created_at desc);

create table if not exists public.confession_hearts (
  confession_id  text not null references public.confessions (id) on delete cascade,
  uid            text not null,
  primary key (confession_id, uid)
);

create table if not exists public.confession_reports (
  confession_id  text not null references public.confessions (id) on delete cascade,
  reporter_uid   text not null,
  primary key (confession_id, reporter_uid)
);

alter table public.profiles           enable row level security;
alter table public.bans               enable row level security;
alter table public.blocks             enable row level security;
alter table public.reports            enable row level security;
alter table public.confessions        enable row level security;
alter table public.confession_hearts  enable row level security;
alter table public.confession_reports enable row level security;
-- No policies on purpose: the service-role key bypasses RLS, everyone else is denied.
