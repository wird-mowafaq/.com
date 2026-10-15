-- إصلاح خطأ «Could not find the table 'public.suggestions'»
-- شغّله في Supabase ← SQL Editor مرة واحدة (يتطلب أن تكون دالة me_role() موجودة من setup.sql).
create table if not exists public.suggestions(
  id bigint generated always as identity primary key,
  who text,
  body text not null,
  created timestamptz default now()
);
alter table public.suggestions enable row level security;
drop policy if exists sg_add on public.suggestions;
drop policy if exists sg_read on public.suggestions;
drop policy if exists sg_del on public.suggestions;
create policy sg_add  on public.suggestions for insert to anon, authenticated with check (length(body) between 2 and 1000);
create policy sg_read on public.suggestions for select using (me_role() = 'owner');
create policy sg_del  on public.suggestions for delete using (me_role() = 'owner');
-- تحديث ذاكرة المخطط ليراه الموقع فورًا
notify pgrst, 'reload schema';
