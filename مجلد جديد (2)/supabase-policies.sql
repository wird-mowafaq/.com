-- شغّله مرة واحدة في Supabase ← SQL Editor
-- يسمح للمالك فقط (الموجود في جدول staff بدور owner) بالكتابة والتعديل والحذف في مخزن backgrounds
-- القراءة العامة تبقى كما هي (المخزن عام).

drop policy if exists "owner manage backgrounds storage" on storage.objects;
create policy "owner manage backgrounds storage"
on storage.objects for all to authenticated
using (
  bucket_id = 'backgrounds'
  and exists (select 1 from public.staff s where s.email = (auth.jwt() ->> 'email') and s.role = 'owner')
)
with check (
  bucket_id = 'backgrounds'
  and exists (select 1 from public.staff s where s.email = (auth.jwt() ->> 'email') and s.role = 'owner')
);
