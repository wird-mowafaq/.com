/* وِرد — Service Worker: تثبيت التطبيق + عمل الواجهة دون اتصال + عرض الإشعارات */
const V = 'wird-v13';
const AD_CACHE = 'wird-adhan';   // ملفات الأذان: تبقى بين الإصدارات وتعمل دون إنترنت
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'logo.png', 'apple-touch-icon.png', 'icon-maskable-512.png', '404.html', 'quran-downloader.html', 'wird-search.js'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(V)
      .then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {}))))
      .then(() => caches.open(AD_CACHE)).then(c => Promise.all(['adhan.mp3', 'adhan-fajr.mp3'].map(u => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== V && k !== AD_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  // الخطوط: من الكاش إن وُجدت وإلا الشبكة ثم تخزَّن (تعمل دون اتصال بعد أول زيارة)
  if (/(^|\.)fonts\.(googleapis|gstatic)\.com$/.test(u.hostname)) {
    e.respondWith(caches.match(r).then(x => x || fetch(r).then(res => { const cp = res.clone(); caches.open(V).then(c => c.put(r, cp)).catch(() => {}); return res; })));
    return;
  }
  if (u.origin !== location.origin) return;            // الصوت وواجهات API من الشبكة دائمًا
  if (u.pathname.includes('/videos/')) return;
  // الأذان: من الكاش (مع دعم Range كما يطلبه مشغّل الصوت) وإلا من الشبكة
  if (/\/adhan[^\/]*\.mp3$|\/adhan\/[^\/]+\.mp3$/i.test(u.pathname)) { e.respondWith(adhanResponse(r)); return; }
  if (r.headers.has('range')) return;                  // طلبات الصوت الجزئية (Range) من الشبكة مباشرة         // الفيديوهات الكبيرة لا تُخزَّن
  // الصفحة: الشبكة أولًا (لتصل التحديثات) ثم النسخة المخزَّنة دون اتصال
  if (r.mode === 'navigate' || u.pathname.endsWith('/') || u.pathname.endsWith('index.html')) {
    e.respondWith(
      fetch(r).then(res => {
        if (res.ok) { const cp = res.clone(); caches.open(V).then(c => c.put(r, cp)).catch(() => {}); }
        return res;
      }).catch(() => caches.match(r).then(x => x || caches.match('index.html') || caches.match('./')))
    );
    return;
  }
  // بقية الملفات: المخزَّن أولًا مع تحديث في الخلفية (stale-while-revalidate) فلا تبقى أيقونة قديمة
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


async function adhanResponse(req) {
  const c = await caches.open(AD_CACHE);
  const hit = await c.match(req.url);
  if (!hit) return fetch(req);                       // غير محفوظ بعد: من الشبكة
  const buf = await hit.arrayBuffer(), size = buf.byteLength, rng = req.headers.get('range');
  const base = { 'Content-Type': 'audio/mpeg', 'Accept-Ranges': 'bytes' };
  if (!rng) return new Response(buf, { status: 200, headers: Object.assign({ 'Content-Length': size }, base) });
  const m = /bytes=(\d*)-(\d*)/.exec(rng);
  let start = 0, end = size - 1;
  if (m) {
    if (m[1] !== '') { start = +m[1]; if (m[2] !== '') end = +m[2]; }
    else if (m[2] !== '') start = Math.max(0, size - +m[2]);
  }
  end = Math.min(end, size - 1);
  if (start > end) return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + size } });
  return new Response(buf.slice(start, end + 1), { status: 206, headers: Object.assign({ 'Content-Range': 'bytes ' + start + '-' + end + '/' + size, 'Content-Length': end - start + 1 }, base) });
}
