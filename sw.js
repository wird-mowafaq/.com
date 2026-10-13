/* وِرد — Service Worker: تثبيت التطبيق + عمل الواجهة دون اتصال + عرض الإشعارات */
const V = 'wird-v7';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'logo.png', 'apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(V)
      .then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (u.origin !== location.origin) return;            // الصوت وواجهات API من الشبكة دائمًا
  if (u.pathname.includes('/videos/')) return;         // الفيديوهات الكبيرة لا تُخزَّن
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
  // بقية الملفات: المخزَّن أولًا
  e.respondWith(
    caches.match(r).then(x => x || fetch(r).then(res => {
      if (res.status === 200) { const cp = res.clone(); caches.open(V).then(c => c.put(r, cp)).catch(() => {}); }
      return res;
    }))
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
