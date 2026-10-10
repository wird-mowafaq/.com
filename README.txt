طريقة النشر على GitHub Pages
1) ارفع كل الملفات في هذا المجلد (بما فيها .nojekyll) إلى جذر المستودع، واستبدل الملفات القديمة.
2) Settings ← Pages ← Branch: main ← Folder: / (root) ← Save.
3) افتح الرابط بعد دقيقة. إن ظهرت نسخة قديمة فحدّث الصفحة بقوة (Ctrl+Shift+R).

ملاحظات:
- مجلد videos اختياري: الخلفيات تُدار من لوحة المالك (Supabase).
- GATE=false في index.html يعني الدخول للجميع بلا حساب. DL_NEEDS_ACCOUNT=true يشترط الحساب للتنزيل فقط.
- تأكد في Supabase أن سياسات RLS تسمح بحذف الجدول backgrounds ومخزن backgrounds للمالك فقط.
