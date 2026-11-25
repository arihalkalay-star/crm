-- Alkalay CRM v1 schema. Run once in the Supabase SQL editor.
create extension if not exists pgcrypto;

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null default '',
  company text,
  role text,
  phone text,
  email text,
  status text not null default 'ליד',
  source text,
  tags text[] not null default '{}',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.deals (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  title text not null default '',
  stage text not null default 'ליד חדש',
  value numeric,
  product text,
  tags text[] not null default '{}',
  next_step text,
  next_step_date date,
  close_date date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null default '',
  status text not null default 'לעשות',
  priority text not null default 'רגילה',
  due_date date,
  client_id uuid references public.clients(id) on delete set null,
  deal_id uuid references public.deals(id) on delete set null,
  notes text,
  position double precision not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.updates (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users(id) on delete cascade,
  client_id uuid references public.clients(id) on delete cascade,
  deal_id uuid references public.deals(id) on delete cascade,
  kind text not null default 'הערה',
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists deals_client_idx on public.deals(client_id);
create index if not exists tasks_client_idx on public.tasks(client_id);
create index if not exists tasks_deal_idx on public.tasks(deal_id);
create index if not exists updates_client_idx on public.updates(client_id);
create index if not exists updates_deal_idx on public.updates(deal_id);

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists clients_touch on public.clients;
create trigger clients_touch before update on public.clients for each row execute function public.touch_updated_at();
drop trigger if exists deals_touch on public.deals;
create trigger deals_touch before update on public.deals for each row execute function public.touch_updated_at();
drop trigger if exists tasks_touch on public.tasks;
create trigger tasks_touch before update on public.tasks for each row execute function public.touch_updated_at();

alter table public.clients enable row level security;
alter table public.deals   enable row level security;
alter table public.tasks   enable row level security;
alter table public.updates enable row level security;

drop policy if exists own_clients on public.clients;
create policy own_clients on public.clients for all to authenticated using (owner = auth.uid()) with check (owner = auth.uid());
drop policy if exists own_deals on public.deals;
create policy own_deals on public.deals for all to authenticated using (owner = auth.uid()) with check (owner = auth.uid());
drop policy if exists own_tasks on public.tasks;
create policy own_tasks on public.tasks for all to authenticated using (owner = auth.uid()) with check (owner = auth.uid());
drop policy if exists own_updates on public.updates;
create policy own_updates on public.updates for all to authenticated using (owner = auth.uid()) with check (owner = auth.uid());

revoke all on public.clients, public.deals, public.tasks, public.updates from anon;
grant select, insert, update, delete on public.clients, public.deals, public.tasks, public.updates to authenticated;
