-- ============================================================================
-- ملف مراجعة فقط — لا تشغّله قبل قراءته. شغّله بعد نسخة احتياطية، في SQL Editor.
-- مبني على ملفات المشروع، ولم يُجرَّب على قاعدتك الحية.
-- ============================================================================

-- 1) حدود الأطوال على events (NOT VALID: لا يفحص الصفوف القديمة، يفحص الجديدة)
alter table public.events drop constraint if exists events_len;
alter table public.events add constraint events_len check (
  length(coalesce(reciter,'')) <= 80 and length(coalesce(surah,'')) <= 200
  and length(coalesce(who,'')) <= 60 and length(coalesce(dev,'')) <= 200
) not valid;

-- 2) الاقتراحات: جدول suggestions مع حد لطول who أيضًا
drop policy if exists sg_add on public.suggestions;
create policy sg_add on public.suggestions for insert to anon, authenticated
  with check (length(body) between 2 and 1000 and length(coalesce(who,'')) <= 60);

-- 3) سقف عام للإدخال (ليس لكل عنوان IP، فهو يحمي القاعدة من الإغراق لا من التعطيل)
create or replace function public.throttle_inserts() returns trigger
language plpgsql security definer set search_path = public as $$
declare lim int := tg_argv[0]::int; n int;
begin
  execute format('select count(*) from public.%I where created > now() - interval ''1 minute''', tg_table_name) into n;
  if n >= lim then raise exception 'rate limit exceeded' using errcode = 'P0001'; end if;
  return new;
end $$;
drop trigger if exists events_throttle on public.events;
create trigger events_throttle before insert on public.events for each row execute function public.throttle_inserts(300);
drop trigger if exists suggestions_throttle on public.suggestions;
create trigger suggestions_throttle before insert on public.suggestions for each row execute function public.throttle_inserts(30);

-- 4) التخزين: إزالة السياستين الأوسع، فيبقى المالك وحده (سياسة supabase-policies.sql)
--    تنبيه: بعد هذا لا يستطيع المشرفون العاديون رفع الخلفيات/حذفها من التخزين.
--    إن أردت إبقاءهم فتجاهل هذا القسم.
drop policy if exists o_add on storage.objects;
drop policy if exists o_del on storage.objects;
drop policy if exists "owner manage backgrounds storage" on storage.objects;
create policy "owner manage backgrounds storage" on storage.objects for all to authenticated
  using (bucket_id = 'backgrounds' and exists (select 1 from public.staff s where s.email = (auth.jwt() ->> 'email') and s.role = 'owner'))
  with check (bucket_id = 'backgrounds' and exists (select 1 from public.staff s where s.email = (auth.jwt() ->> 'email') and s.role = 'owner'));

-- 5) حدود المخزن: 100 ميغابايت للملف وأنواع محددة (عدّل القائمة إن رفعت أنواعًا أخرى)
update storage.buckets set
  file_size_limit = 104857600,
  allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif','image/avif','video/mp4','video/webm','application/json']
where id = 'backgrounds';

-- 6) الاحتفاظ بالبيانات: حذف سجلات events الأقدم من 180 يومًا (شغّل يدويًا أو جدولها بـ pg_cron)
create or replace function public.purge_old_events() returns void
language sql security definer set search_path = public as $$
  delete from public.events where created < now() - interval '180 days';
$$;
revoke all on function public.purge_old_events() from public, anon, authenticated;
-- مثال جدولة (يتطلب تفعيل إضافة pg_cron):
-- select cron.schedule('purge-events', '0 3 * * *', 'select public.purge_old_events()');

-- 7) تحقق بعد التشغيل:
-- select policyname, cmd from pg_policies where schemaname='storage' and tablename='objects';
-- select conname from pg_constraint where conrelid='public.events'::regclass;
