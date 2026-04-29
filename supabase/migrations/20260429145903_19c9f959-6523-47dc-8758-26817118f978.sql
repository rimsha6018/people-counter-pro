-- Roles enum + table
create type public.app_role as enum ('admin', 'user');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);
alter table public.user_roles enable row level security;

-- Security definer role check
create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.user_roles where user_id = _user_id and role = _role
  )
$$;

-- Auto-create profile + assign role on signup (first user = admin)
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  user_count int;
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.email));

  select count(*) into user_count from public.user_roles;
  if user_count = 0 then
    insert into public.user_roles (user_id, role) values (new.id, 'admin');
  else
    insert into public.user_roles (user_id, role) values (new.id, 'user');
  end if;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Profiles policies
create policy "Users view own profile" on public.profiles
  for select to authenticated using (auth.uid() = id);
create policy "Users update own profile" on public.profiles
  for update to authenticated using (auth.uid() = id);
create policy "Admins view all profiles" on public.profiles
  for select to authenticated using (public.has_role(auth.uid(), 'admin'));

-- user_roles policies
create policy "Users view own roles" on public.user_roles
  for select to authenticated using (auth.uid() = user_id);
create policy "Admins view all roles" on public.user_roles
  for select to authenticated using (public.has_role(auth.uid(), 'admin'));
create policy "Admins manage roles" on public.user_roles
  for all to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

-- Employees
create table public.employees (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text,
  face_descriptors jsonb not null default '[]'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.employees enable row level security;

create policy "Authenticated view employees" on public.employees
  for select to authenticated using (true);
create policy "Admins insert employees" on public.employees
  for insert to authenticated with check (public.has_role(auth.uid(), 'admin'));
create policy "Admins update employees" on public.employees
  for update to authenticated using (public.has_role(auth.uid(), 'admin'));
create policy "Admins delete employees" on public.employees
  for delete to authenticated using (public.has_role(auth.uid(), 'admin'));

-- Detection logs
create table public.detection_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  count int not null default 0,
  source text not null default 'webcam',
  recognized_employee_ids uuid[] default '{}',
  created_at timestamptz not null default now()
);
alter table public.detection_logs enable row level security;

create policy "Authenticated view logs" on public.detection_logs
  for select to authenticated using (true);
create policy "Authenticated insert logs" on public.detection_logs
  for insert to authenticated with check (auth.uid() = user_id);

-- Entry/exit events
create table public.entry_exit_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  direction text not null check (direction in ('in','out')),
  employee_id uuid references public.employees(id) on delete set null,
  track_id int,
  created_at timestamptz not null default now()
);
alter table public.entry_exit_events enable row level security;

create policy "Authenticated view events" on public.entry_exit_events
  for select to authenticated using (true);
create policy "Authenticated insert events" on public.entry_exit_events
  for insert to authenticated with check (auth.uid() = user_id);

-- Alerts
create table public.alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  type text not null,
  message text not null,
  severity text not null default 'info' check (severity in ('info','warning','critical')),
  acknowledged boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.alerts enable row level security;

create policy "Authenticated view alerts" on public.alerts
  for select to authenticated using (true);
create policy "Authenticated insert alerts" on public.alerts
  for insert to authenticated with check (auth.uid() = user_id);
create policy "Admins update alerts" on public.alerts
  for update to authenticated using (public.has_role(auth.uid(), 'admin'));

-- updated_at trigger
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

create trigger employees_updated before update on public.employees
  for each row execute function public.set_updated_at();
create trigger profiles_updated before update on public.profiles
  for each row execute function public.set_updated_at();