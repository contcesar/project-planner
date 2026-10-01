-- Project Planner database schema.
-- Run this once in your Supabase project: SQL Editor → New query → paste → Run.

create table if not exists public.clients (
  id          text primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null,
  color       text not null default '#2f5bea',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.projects (
  id          text primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  client_id   text references public.clients (id) on delete set null,
  title       text not null,
  status      text not null default 'backlog'
              check (status in ('backlog', 'todo', 'doing', 'review', 'done')),
  due         date,
  notes       text not null default '',
  sort_order  double precision not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists clients_user_id_idx on public.clients (user_id);
create index if not exists projects_user_id_idx on public.projects (user_id);
create index if not exists projects_client_id_idx on public.projects (client_id);

-- Each signed-in user can only see and change their own rows.
alter table public.clients enable row level security;
alter table public.projects enable row level security;

drop policy if exists "Own clients" on public.clients;
create policy "Own clients" on public.clients
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Own projects" on public.projects;
create policy "Own projects" on public.projects
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Live updates: other devices refresh as soon as something changes.
do $$
begin
  alter publication supabase_realtime add table public.clients, public.projects;
exception when duplicate_object then null;
end $$;
