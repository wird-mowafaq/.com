-- شغّله مرة واحدة في SQL Editor داخل مشروع "القران" (آمن لو شغّلته أكثر من مرة)
-- ===== الجداول الأساسية =====
create table if not exists staff(email text primary key,name text not null,role text not null default 'admin' check(role in('owner','admin')),up boolean default true,del boolean default false,stats boolean default false);
create table if not exists backgrounds(id bigint generated always as identity primary key,name text,path text not null,url text not null,created timestamptz default now());
create table if not exists events(id bigint generated always as identity primary key,kind text,reciter text,surah text,who text,dev text,created timestamptz default now());
alter table staff add column if not exists stats boolean default false;
alter table events add column if not exists dev text;
-- ===== جداول جديدة: قوائم الخلفيات، الاقتراحات، حسابات المالك =====
create table if not exists bg_lists(id bigint generated always as identity primary key,name text not null,created timestamptz default now());
create table if not exists bg_allow(list_id bigint not null references bg_lists(id) on delete cascade,email text not null,primary key(list_id,email));
alter table backgrounds add column if not exists list_id bigint references bg_lists(id) on delete set null;
create table if not exists suggestions(id bigint generated always as identity primary key,who text,body text not null,created timestamptz default now());
create table if not exists links(id bigint generated always as identity primary key,title text not null,url text not null,created timestamptz default now());
alter table staff enable row level security;alter table backgrounds enable row level security;alter table events enable row level security;
alter table bg_lists enable row level security;alter table bg_allow enable row level security;alter table suggestions enable row level security;alter table links enable row level security;
-- ===== دوال الصلاحيات =====
create or replace function me_role() returns text language sql stable security definer set search_path=public as $$select role from staff where email=auth.jwt()->>'email'$$;
create or replace function me_can(p text) returns boolean language sql stable security definer set search_path=public as $$select coalesce((select role='owner' or (p='up' and up) or (p='del' and del) or (p='stats' and stats) from staff where email=auth.jwt()->>'email'),false)$$;
create or replace function me_list(lid bigint) returns boolean language sql stable security definer set search_path=public as $$select coalesce(lid is not null and (select role='owner' or (up and exists(select 1 from bg_allow a where a.list_id=lid and a.email=staff.email)) from staff where email=auth.jwt()->>'email'),false)$$;
-- ===== السياسات =====
drop policy if exists s_read on staff;drop policy if exists s_owner on staff;
drop policy if exists b_read on backgrounds;drop policy if exists b_add on backgrounds;drop policy if exists b_del on backgrounds;drop policy if exists b_upd on backgrounds;
drop policy if exists e_add on events;drop policy if exists e_read on events;
drop policy if exists l_read on bg_lists;drop policy if exists l_owner on bg_lists;
drop policy if exists a_read on bg_allow;drop policy if exists a_owner on bg_allow;
drop policy if exists sg_add on suggestions;drop policy if exists sg_read on suggestions;drop policy if exists sg_del on suggestions;
drop policy if exists k_read on links;drop policy if exists k_owner on links;
create policy s_read on staff for select using(email=auth.jwt()->>'email' or me_role()='owner');
create policy s_owner on staff for all using(me_role()='owner') with check(me_role()='owner');
create policy b_read on backgrounds for select using(true);
create policy b_add on backgrounds for insert with check(me_role()='owner' or me_list(list_id));
create policy b_del on backgrounds for delete using(me_can('del') or me_list(list_id));
create policy b_upd on backgrounds for update using(me_role()='owner') with check(me_role()='owner');
create policy e_add on events for insert to anon,authenticated with check(kind in('listen','download','visit'));
create policy e_read on events for select using(me_can('stats'));
create policy l_read on bg_lists for select using(true);
create policy l_owner on bg_lists for all using(me_role()='owner') with check(me_role()='owner');
create policy a_read on bg_allow for select using(me_role()='owner' or email=auth.jwt()->>'email');
create policy a_owner on bg_allow for all using(me_role()='owner') with check(me_role()='owner');
create policy sg_add on suggestions for insert to anon,authenticated with check(length(body) between 2 and 1000);
create policy sg_read on suggestions for select using(me_role()='owner');
create policy sg_del on suggestions for delete using(me_role()='owner');
create policy k_read on links for select using(true);
create policy k_owner on links for all using(me_role()='owner') with check(me_role()='owner');
-- ===== التخزين =====
insert into storage.buckets(id,name,public) values('backgrounds','backgrounds',true) on conflict do nothing;
drop policy if exists o_add on storage.objects;drop policy if exists o_del on storage.objects;
create policy o_add on storage.objects for insert with check(bucket_id='backgrounds' and me_can('up'));
create policy o_del on storage.objects for delete using(bucket_id='backgrounds' and (me_can('del') or exists(select 1 from public.backgrounds b where b.path=storage.objects.name and me_list(b.list_id))));
-- ===== المالك =====
-- المالك: أنشئ حساب المالك أولًا (Authentication ← Users ← Add user ببريد عشوائي وكلمة مرور طويلة)، ثم أدرج بريده هنا.
-- لا تنشر بريد المالك في مستودع عام، ولا تشتقه من الكود.
-- insert into staff(email,name,role,up,del,stats) values('OWNER_EMAIL_HERE','المالك','owner',true,true,true) on conflict (email) do update set role='owner',up=true,del=true,stats=true;
update auth.users set email_confirmed_at=now() where email_confirmed_at is null and (email like '%@staff.nur' or email like '%@user.nur');
