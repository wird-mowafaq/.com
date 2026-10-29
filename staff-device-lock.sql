-- staff-device-lock.sql — قفل الدخول الإداري على جهاز واحد (للمالك والأدمن) — للمراجعة قبل التشغيل
-- لا يحذف أي جدول أو بيانات. شغّله في Supabase ← SQL Editor بعد setup.sql (وبعد fixes-review.sql إن شغّلته)،
-- ثم سجّل دخول المالك فورًا من جهازك ليُربط به.
--
-- الفكرة: الواجهة ترسل سرًّا عشوائيًا للجهاز (32 خانة) في ترويسة x-device. يُخزَّن في staff.device «بصمته» SHA-256 فقط،
-- فلا يستطيع أحد قراءة السر وإعادة استخدامه حتى لو قرأ صفه. وكل دوال الصلاحيات تتجاهل أي جلسة لا يطابق جهازها الجهاز المربوط،
-- فمن عرف كود الدخول من جهاز آخر يحصل على جلسة بلا أي صلاحية.

create extension if not exists pgcrypto with schema extensions;
alter table staff add column if not exists device text;

create or replace function dev_hash(x text) returns text language sql immutable set search_path=public,extensions as $$
 select encode(extensions.digest(coalesce(x,''),'sha256'),'hex')$$;

-- ترحيل: إن كانت قيمة قديمة بلا تجزئة (32 خانة) حوّلها إلى بصمة
update staff set device=dev_hash(device) where device ~ '^[0-9a-f]{32}$';

create or replace function dev_ok() returns boolean language sql stable security definer set search_path=public,extensions as $$
 select coalesce((select device is not null and device = dev_hash(nullif(current_setting('request.headers',true)::json->>'x-device',''))
                  from staff where email=auth.jwt()->>'email'),false)$$;

-- كل الصلاحيات الإدارية (ومنها المالك) لا تعمل إلا من الجهاز المربوط
create or replace function me_role() returns text language sql stable security definer set search_path=public as $$
 select role from staff where email=auth.jwt()->>'email' and dev_ok()$$;
create or replace function me_can(p text) returns boolean language sql stable security definer set search_path=public as $$
 select coalesce((select role='owner' or (p='up' and up) or (p='del' and del) or (p='stats' and stats)
                  from staff where email=auth.jwt()->>'email' and dev_ok()),false)$$;
create or replace function me_list(lid bigint) returns boolean language sql stable security definer set search_path=public as $$
 select coalesce(lid is not null and (select role='owner' or (up and exists(select 1 from bg_allow a where a.list_id=lid and a.email=staff.email))
                  from staff where email=auth.jwt()->>'email' and dev_ok()),false)$$;

-- سياسة تخزين المالك كانت تفحص staff مباشرة فتتجاوز القفل: نجعلها تمر عبر me_role()
drop policy if exists "owner manage backgrounds storage" on storage.objects;
create policy "owner manage backgrounds storage" on storage.objects for all to authenticated
  using (bucket_id='backgrounds' and me_role()='owner') with check (bucket_id='backgrounds' and me_role()='owner');

-- ربط أول جهاز عند أول دخول؛ أي جهاز آخر يُرفض (device_locked)
create or replace function bind_device(d text) returns void language plpgsql security definer set search_path=public,extensions as $$
declare e text:=auth.jwt()->>'email'; cur text;
begin
 if d is null or d !~ '^[0-9a-f]{32}$' then raise exception 'bad_device'; end if;
 select device into cur from staff where email=e;
 if not found then raise exception 'not_staff'; end if;
 if cur is null then update staff set device=dev_hash(d) where email=e;
 elsif cur<>dev_hash(d) then raise exception 'device_locked'; end if;
end$$;
revoke all on function bind_device(text) from public, anon;
grant execute on function bind_device(text) to authenticated;

-- فك ربط الأدمن: من لوحة المالك (زر «فك ربط الجهاز»). فك ربط المالك نفسه (جهاز ضاع) يكون من هنا فقط:
--   update staff set device=null where role='owner';
-- ثم يُربط أول جهاز يسجل الدخول.

-- حدّ المحاولات: Supabase Auth لا يتيح خطافًا مجانيًا قبل التحقق من كلمة المرور، فالعدّاد الصارم في الواجهة
-- (5 محاولات ثم قفل يتصاعد إلى 24 ساعة، للمالك والأدمن) يحمي الجهاز المربوط فقط. أما من يخمّن الكود من جهاز آخر
-- فقفل الجهاز أعلاه يجعل نجاحه بلا أي صلاحية. وللتشديد فعّل من Supabase ← Authentication ← Rate Limits
-- حدّ تسجيل الدخول لكل IP، وفعّل CAPTCHA، وعطّل التسجيل العام إن لم تحتجه.
-- ملاحظة: يجب أن يسمح Supabase بالترويسة x-device (PostgREST يعكس الترويسات المطلوبة في CORS افتراضيًا)؛ جرّب الدخول بعد التشغيل.
