create extension if not exists pgcrypto;

create type public.user_role as enum ('admin', 'tl', 'banker');
create type public.progress_status as enum ('locked', 'in_progress', 'completed');
create type public.challenge_status as enum ('active', 'completed');

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  tl_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  auth_id uuid not null unique references auth.users(id) on delete cascade,
  full_name text not null,
  role public.user_role not null,
  team_id uuid references public.teams(id) on delete set null,
  started_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.teams
  add constraint teams_tl_id_fkey
  foreign key (tl_id) references public.users(id)
  on delete set null;

create table if not exists public.modules (
  id uuid primary key default gen_random_uuid(),
  order_index int not null unique check (order_index between 1 and 8),
  title text not null,
  description text,
  video_url text not null,
  pdf_url text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null references public.modules(id) on delete cascade,
  description text not null,
  created_at timestamptz not null default now(),
  unique (module_id, description)
);

create table if not exists public.user_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  module_id uuid not null references public.modules(id) on delete cascade,
  status public.progress_status not null default 'locked',
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, module_id)
);

create table if not exists public.task_completions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  completed_at timestamptz not null default now(),
  unique (user_id, task_id)
);

create table if not exists public.gamification_challenges (
  id uuid primary key default gen_random_uuid(),
  tl_id uuid not null references public.users(id) on delete cascade,
  description text not null,
  status public.challenge_status not null default 'active',
  assigned_at timestamptz not null default now(),
  completed_at timestamptz
);

create or replace function public.current_user_profile_id()
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select id from public.users where auth_id = auth.uid() limit 1;
$$;

create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists(
    select 1 from public.users where auth_id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.is_tl()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists(
    select 1 from public.users where auth_id = auth.uid() and role = 'tl'
  );
$$;

create or replace function public.can_set_module_in_progress(p_user_id uuid, p_module_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  with me as (
    select started_at
    from public.users
    where id = p_user_id
  ),
  target as (
    select order_index
    from public.modules
    where id = p_module_id
  ),
  unlock as (
    select least(
      8,
      (floor(extract(epoch from (now() - coalesce(me.started_at, now()))) / 86400 / 7)::int * 2) + 2
    ) as allowed_count
    from me
  )
  select
    exists (select 1 from target)
    and (select order_index from target) <= (select allowed_count from unlock)
    and not exists (
      select 1
      from public.modules previous_module
      left join public.user_progress previous_progress
        on previous_progress.module_id = previous_module.id
       and previous_progress.user_id = p_user_id
      where previous_module.order_index < (select order_index from target)
        and coalesce(previous_progress.status, 'locked'::public.progress_status) <> 'completed'::public.progress_status
    );
$$;

create or replace function public.module_tasks_completed(p_user_id uuid, p_module_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select not exists (
    select 1
    from public.tasks t
    where t.module_id = p_module_id
      and not exists (
        select 1
        from public.task_completions tc
        where tc.task_id = t.id
          and tc.user_id = p_user_id
      )
  );
$$;

create or replace function public.can_complete_task(p_user_id uuid, p_task_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.tasks t
    join public.user_progress up
      on up.module_id = t.module_id
     and up.user_id = p_user_id
    where t.id = p_task_id
      and up.status = 'in_progress'::public.progress_status
      and public.can_set_module_in_progress(p_user_id, up.module_id)
  );
$$;

grant execute on function public.current_user_profile_id() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_tl() to authenticated;
grant execute on function public.can_set_module_in_progress(uuid, uuid) to authenticated;
grant execute on function public.module_tasks_completed(uuid, uuid) to authenticated;
grant execute on function public.can_complete_task(uuid, uuid) to authenticated;

create or replace function public.init_user_progress()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_progress (user_id, module_id, status)
  select new.id, m.id,
         case when m.order_index = 1 then 'in_progress'::public.progress_status else 'locked'::public.progress_status end
  from public.modules m
  on conflict (user_id, module_id) do nothing;
  return new;
end;
$$;

drop trigger if exists users_init_user_progress on public.users;
create trigger users_init_user_progress
after insert on public.users
for each row execute function public.init_user_progress();

alter table public.users enable row level security;
alter table public.teams enable row level security;
alter table public.modules enable row level security;
alter table public.tasks enable row level security;
alter table public.user_progress enable row level security;
alter table public.task_completions enable row level security;
alter table public.gamification_challenges enable row level security;

create policy "users_select_self_or_admin" on public.users
for select using (auth_id = auth.uid() or public.is_admin());

create policy "users_insert_self_or_admin" on public.users
for insert with check (auth_id = auth.uid() or public.is_admin());

create policy "users_update_self_or_admin" on public.users
for update using (auth_id = auth.uid() or public.is_admin())
with check (auth_id = auth.uid() or public.is_admin());

create policy "users_delete_admin" on public.users
for delete using (public.is_admin());

create policy "teams_select_members_or_admin" on public.teams
for select using (
  public.is_admin()
  or tl_id = public.current_user_profile_id()
  or id = (select team_id from public.users where id = public.current_user_profile_id())
);

create policy "teams_admin_manage" on public.teams
for all using (public.is_admin()) with check (public.is_admin());

create policy "modules_select_authenticated" on public.modules
for select using (auth.uid() is not null);

create policy "modules_admin_manage" on public.modules
for all using (public.is_admin()) with check (public.is_admin());

create policy "tasks_select_authenticated" on public.tasks
for select using (auth.uid() is not null);

create policy "tasks_admin_manage" on public.tasks
for all using (public.is_admin()) with check (public.is_admin());

create policy "progress_select_scope" on public.user_progress
for select using (
  public.is_admin()
  or user_id = public.current_user_profile_id()
  or (
    public.is_tl()
    and exists (
      select 1
      from public.users u_me
      join public.users u_banker on u_banker.team_id = u_me.team_id
      where u_me.id = public.current_user_profile_id()
      and u_me.role = 'tl'
      and u_banker.id = user_progress.user_id
    )
  )
);

create policy "progress_insert_admin_only" on public.user_progress
for insert with check (public.is_admin());

create policy "progress_update_self_or_admin" on public.user_progress
for update using (public.is_admin() or user_id = public.current_user_profile_id())
with check (
  public.is_admin()
  or (
    user_id = public.current_user_profile_id()
    and (
      status = 'locked'::public.progress_status
      or (
        status = 'in_progress'::public.progress_status
        and public.can_set_module_in_progress(user_id, module_id)
      )
      or (
        status = 'completed'::public.progress_status
        and public.can_set_module_in_progress(user_id, module_id)
        and public.module_tasks_completed(user_id, module_id)
      )
    )
  )
);

create policy "progress_delete_admin" on public.user_progress
for delete using (public.is_admin());

create policy "task_completion_select_scope" on public.task_completions
for select using (
  public.is_admin()
  or user_id = public.current_user_profile_id()
  or (
    public.is_tl()
    and exists (
      select 1
      from public.users u_me
      join public.users u_banker on u_banker.team_id = u_me.team_id
      where u_me.id = public.current_user_profile_id()
      and u_me.role = 'tl'
      and u_banker.id = task_completions.user_id
    )
  )
);

create policy "task_completion_insert_self_or_admin" on public.task_completions
for insert with check (
  public.is_admin()
  or (
    user_id = public.current_user_profile_id()
    and public.can_complete_task(user_id, task_id)
  )
);

create policy "task_completion_delete_self_or_admin" on public.task_completions
for delete using (public.is_admin() or user_id = public.current_user_profile_id());

create policy "gamification_select_scope" on public.gamification_challenges
for select using (public.is_admin() or tl_id = public.current_user_profile_id());

create policy "gamification_insert_scope" on public.gamification_challenges
for insert with check (public.is_admin() or tl_id = public.current_user_profile_id());

create policy "gamification_update_scope" on public.gamification_challenges
for update using (public.is_admin() or tl_id = public.current_user_profile_id())
with check (public.is_admin() or tl_id = public.current_user_profile_id());

create policy "gamification_delete_admin" on public.gamification_challenges
for delete using (public.is_admin());

with seeded_modules(order_index, title, description, video_url, pdf_url) as (
  values
    (1, 'Osobní značka a profesionalita', 'Budování důvěryhodné osobní značky v bankovním prodeji.', 'https://example.com/video/module-1', 'https://example.com/pdf/module-1.pdf'),
    (2, 'Telefonování a domluvení schůzky', 'Jak vést efektivní úvodní hovor a domluvit schůzku.', 'https://example.com/video/module-2', 'https://example.com/pdf/module-2.pdf'),
    (3, 'Zjišťování potřeb (Otevřené otázky)', 'Práce s otevřenými otázkami pro hlubší pochopení klienta.', 'https://example.com/video/module-3', 'https://example.com/pdf/module-3.pdf'),
    (4, 'Aktivní naslouchání', 'Techniky aktivního naslouchání pro vyšší důvěru.', 'https://example.com/video/module-4', 'https://example.com/pdf/module-4.pdf'),
    (5, 'Psychologie prodeje a řeč těla', 'Vliv neverbální komunikace a rozhodovacích vzorců.', 'https://example.com/video/module-5', 'https://example.com/pdf/module-5.pdf'),
    (6, 'Návrh řešení (Prezentace řešení)', 'Jak srozumitelně prezentovat návrh řešení.', 'https://example.com/video/module-6', 'https://example.com/pdf/module-6.pdf'),
    (7, 'Efektivní práce s námitkou', 'Modely práce s námitkami bez ztráty tempa rozhovoru.', 'https://example.com/video/module-7', 'https://example.com/pdf/module-7.pdf'),
    (8, 'Uzavření obchodu a Follow up', 'Uzavření, další kroky a péče po schůzce.', 'https://example.com/video/module-8', 'https://example.com/pdf/module-8.pdf')
)
insert into public.modules (order_index, title, description, video_url, pdf_url)
select order_index, title, description, video_url, pdf_url
from seeded_modules
on conflict (order_index) do update set
  title = excluded.title,
  description = excluded.description,
  video_url = excluded.video_url,
  pdf_url = excluded.pdf_url;

with seeded_tasks(order_index, description) as (
  values
    (1, 'Nahraj 30s představení sebe sama a vyhodnoť jasnost sdělení.'),
    (1, 'Uprav podpis e-mailu tak, aby posiloval tvou důvěryhodnost.'),
    (1, 'Požádej kolegu o zpětnou vazbu na první dojem.'),
    (2, 'Nacvič 3 varianty úvodní věty pro telefonát.'),
    (2, 'Zavolej alespoň 5 klientům a sleduj míru domluvených schůzek.'),
    (2, 'Po každém hovoru si zapiš jednu věc ke zlepšení.'),
    (3, 'Připrav si seznam 10 otevřených otázek do další schůzky.'),
    (3, 'Na schůzce polož minimálně 5 otevřených otázek.'),
    (3, 'Na konci schůzky shrň 3 klíčové potřeby klienta.'),
    (4, 'Použij techniku parafrázování alespoň 3x během schůzky.'),
    (4, 'Po schůzce si zapiš, kde jsi klientovi skočil do řeči.'),
    (4, 'Procvič 2 otázky pro potvrzení porozumění.'),
    (5, 'Při schůzce vědomě sleduj řeč těla klienta.'),
    (5, 'Vyzkoušej změnu tónu hlasu při klíčové nabídce.'),
    (5, 'Reflektuj, kdy klient projevil největší zájem.'),
    (6, 'Připrav prezentaci řešení na 5 minut bez odborného žargonu.'),
    (6, 'Ověř u klienta porozumění každému kroku návrhu.'),
    (6, 'Vyžádej si zpětnou vazbu na srozumitelnost návrhu.'),
    (7, 'Sepiš 5 nejčastějších námitek a vhodné reakce.'),
    (7, 'Na schůzce použij metodu uznání + otázka + návrh.'),
    (7, 'Po schůzce vyhodnoť, jaká námitka byla nejsilnější.'),
    (8, 'Na konci schůzky potvrď další krok s konkrétním termínem.'),
    (8, 'Pošli follow-up zprávu do 24 hodin.'),
    (8, 'Po týdnu proveď kontrolní kontakt s klientem.')
)
insert into public.tasks (module_id, description)
select m.id, t.description
from seeded_tasks t
join public.modules m on m.order_index = t.order_index
on conflict (module_id, description) do nothing;
