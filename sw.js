/* وِرد — Service Worker (PWA)
   - تخزين مسبق لقشرة التطبيق والخطوط ونص المصحف وفهرس البحث ليعمل الموقع كاملًا دون إنترنت.
   - كاش الصوت (wird-audio-v1) يملؤه المستخدم بنفسه من «حفظ للاستماع دون إنترنت»؛ لا يُحذف عند تحديث الإصدار.
   - لا يُخزَّن أي رد من Supabase أو الواجهات الخارجية (حسابات، جلسات، إحصاءات)، فلا يوجد كاش مشترك لبيانات حساسة.
   - يدعم طلبات Range للصوت المخزَّن (التقديم والتأخير في الملفات الكبيرة). */
const V = 'wird-shell-v12';
const AUDIO = 'wird-audio-v1';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', '404.html', 'quran-downloader.html',
  'js/qdata.js', 'js/adhan-core.js', 'data/quran.json', 'adhan/registry.json',
  'adhan.mp3', 'adhan-fajr.mp3',
  'fonts/AmiriQuran-Regular.ttf', 'fonts/ReemKufi-VF.ttf', 'fonts/Tajawal-Regular.ttf', 'fonts/Tajawal-Medium.ttf',
  'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png', 'logo.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(V)
      .then(c => Promise.all(SHELL.map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

/* حذف كاشات القشرة القديمة فقط (بما فيها wird-v11 القديم)، مع إبقاء كاش الصوت */
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== V && k !== AUDIO && /^wird-/.test(k)).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* رد 206 من ملف مخزَّن، لتعمل شريحة التقدم والملفات الكبيرة */
async function ranged(req, hit) {
  const rg = /bytes=(\d*)-(\d*)/.exec(req.headers.get('range') || '');
  if (!rg) return hit;
  const blob = await hit.blob(), size = blob.size;
  let a, b;
  if (rg[1] === '' && rg[2] !== '') { a = Math.max(0, size - +rg[2]); b = size - 1; }
  else { a = rg[1] ? +rg[1] : 0; b = rg[2] ? Math.min(+rg[2], size - 1) : size - 1; }
  if (a >= size || a > b) return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + size } });
  return new Response(blob.slice(a, b + 1), {
    status: 206,
    headers: {
      'Content-Type': hit.headers.get('content-type') || 'audio/mpeg',
      'Content-Range': 'bytes ' + a + '-' + b + '/' + size,
      'Content-Length': String(b - a + 1),
      'Accept-Ranges': 'bytes'
    }
  });
}

async function fromCaches(req) {
  const url = req.url.split('#')[0];
  for (const n of [AUDIO, V]) {
    const c = await caches.open(n);
    const hit = await c.match(url, { ignoreVary: true, ignoreSearch: false });
    if (hit) return hit;
  }
  return null;
}

self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  const isAudio = /\.mp3$/i.test(u.pathname);

  /* الصوت (محلي أو من القرّاء): إن كان محفوظًا فمنه (مع Range)، وإلا الشبكة كما هي */
  if (isAudio) {
    e.respondWith((async () => {
      try {
        const hit = await fromCaches(r);
        if (hit) return await ranged(r, hit);
      } catch (_) {}
      return fetch(r);
    })());
    return;
  }

  if (u.origin !== location.origin) return;           // واجهات API وSupabase والخطوط الخارجية: من الشبكة دائمًا ودون تخزين
  if (u.pathname.includes('/videos/')) return;        // الفيديوهات الكبيرة لا تُخزَّن
  if (r.headers.has('range')) return;

  /* الصفحة: الشبكة أولًا (لتصل التحديثات) ثم النسخة المخزَّنة دون اتصال */
  if (r.mode === 'navigate' || u.pathname.endsWith('/') || u.pathname.endsWith('index.html')) {
    e.respondWith(
      fetch(r).then(res => {
        if (res.ok) { const cp = res.clone(); caches.open(V).then(c => c.put(r, cp)).catch(() => {}); }
        return res;
      }).catch(() => caches.open(V).then(c => c.match(r, { ignoreSearch: true })
        .then(x => x || c.match('index.html') || c.match('./'))
        .then(x => x || caches.match('404.html'))))
    );
    return;
  }

  /* بيانات المصحف والسجل والسكربتات والخطوط: المخزَّن أولًا (ثابتة داخل الإصدار)، وتُحدَّث بتغيير V */
  if (/\/(data|js|fonts)\//.test(u.pathname) || u.pathname.endsWith('/adhan/registry.json')) {
    e.respondWith(
      caches.open(V).then(c => c.match(r).then(x => x || fetch(r).then(res => {
        if (res.ok) c.put(r, res.clone()).catch(() => {});
        return res;
      })))
    );
    return;
  }

  /* بقية الملفات: المخزَّن أولًا مع تحديث في الخلفية */
  e.respondWith(
    caches.match(r).then(x => {
      const net = fetch(r).then(res => {
        if (res.status === 200) { const cp = res.clone(); caches.open(V).then(c => c.put(r, cp)).catch(() => {}); }
        return res;
      }).catch(() => x);
      return x || net;
    })
  );
});

/* الضغط على الإشعار يفتح الموقع */
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) { if ('focus' in c) return c.focus(); }
      return clients.openWindow('./');
    })
  );
});
