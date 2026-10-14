/* bg-upload.js — رفع خلفيات صور للموقع وحفظها في متصفح المستخدم (IndexedDB)
   الاستخدام: أضف السطر التالي قبل </body> في صفحتك:
   <script src="bg-upload.js"></script>
*/
(function () {
  const DB_NAME = 'site-backgrounds';
  const STORE = 'images';
  const ACTIVE_KEY = 'activeBackgroundId';
  const MAX_SIDE = 1920; // تصغير الصور الكبيرة لتوفير المساحة

  /* ---------- قاعدة البيانات ---------- */
  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () =>
        req.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function tx(mode, fn) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const result = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(result.result !== undefined ? result.result : undefined);
      t.onerror = () => reject(t.error);
    });
  }
  const addImage = (blob, name) => tx('readwrite', s => s.add({ blob, name, added: Date.now() }));
  const getAll = () => tx('readonly', s => s.getAll());
  const getOne = id => tx('readonly', s => s.get(id));
  const removeImage = id => tx('readwrite', s => s.delete(id));

  /* ---------- تصغير الصورة ---------- */
  function shrink(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob(b => (b ? resolve(b) : reject(new Error('فشل التحويل'))), 'image/jpeg', 0.88);
      };
      img.onerror = () => reject(new Error('الملف ليس صورة صالحة'));
      img.src = url;
    });
  }

  /* ---------- طبقة الخلفية ---------- */
  const layer = document.createElement('div');
  layer.id = 'user-bg-layer';
  Object.assign(layer.style, {
    position: 'fixed', inset: '0', zIndex: '-1',
    backgroundSize: 'cover', backgroundPosition: 'center',
    backgroundRepeat: 'no-repeat', transition: 'opacity .4s', opacity: '0',
    pointerEvents: 'none'
  });
  document.body.prepend(layer);

  let currentURL = null;
  async function applyBackground(id) {
    if (currentURL) { URL.revokeObjectURL(currentURL); currentURL = null; }
    if (id == null) {
      layer.style.opacity = '0';
      layer.style.backgroundImage = 'none';
      localStorage.removeItem(ACTIVE_KEY);
      return;
    }
    const rec = await getOne(id);
    if (!rec) return applyBackground(null);
    currentURL = URL.createObjectURL(rec.blob);
    layer.style.backgroundImage = `url("${currentURL}")`;
    layer.style.opacity = '1';
    localStorage.setItem(ACTIVE_KEY, String(id));
  }

  /* ---------- الواجهة ---------- */
  const css = document.createElement('style');
  css.textContent = `
  #bgu-btn{position:fixed;bottom:16px;left:16px;z-index:9998;width:48px;height:48px;border-radius:50%;
    border:none;background:#1f6f54;color:#fff;font-size:22px;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.3)}
  #bgu-panel{position:fixed;bottom:76px;left:16px;z-index:9999;width:min(340px,calc(100vw - 32px));
    max-height:70vh;overflow:auto;background:#fff;color:#222;border-radius:14px;padding:14px;
    box-shadow:0 8px 30px rgba(0,0,0,.35);font-family:inherit;direction:rtl;display:none}
  #bgu-panel.open{display:block}
  #bgu-panel h3{margin:0 0 10px;font-size:16px}
  #bgu-panel .row{display:flex;gap:8px;margin-bottom:10px}
  #bgu-panel button.act{flex:1;padding:9px;border:none;border-radius:8px;background:#1f6f54;color:#fff;cursor:pointer;font-family:inherit}
  #bgu-panel button.none{background:#888}
  #bgu-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
  .bgu-item{position:relative;aspect-ratio:1;border-radius:8px;overflow:hidden;cursor:pointer;border:3px solid transparent}
  .bgu-item.active{border-color:#e0b100}
  .bgu-item img{width:100%;height:100%;object-fit:cover;display:block}
  .bgu-item .del{position:absolute;top:2px;right:2px;width:22px;height:22px;border:none;border-radius:50%;
    background:rgba(0,0,0,.65);color:#fff;cursor:pointer;line-height:1}
  #bgu-msg{font-size:12px;color:#b00020;margin-top:8px;min-height:14px}
  `;
  document.head.appendChild(css);

  const btn = document.createElement('button');
  btn.id = 'bgu-btn'; btn.title = 'خلفياتي'; btn.textContent = '🖼️';
  const panel = document.createElement('div');
  panel.id = 'bgu-panel';
  panel.innerHTML = `
    <h3>خلفياتي</h3>
    <div class="row">
      <button class="act" id="bgu-add">+ رفع صورة</button>
      <button class="act none" id="bgu-clear">بدون خلفية</button>
    </div>
    <input type="file" id="bgu-file" accept="image/*" multiple hidden>
    <div id="bgu-grid"></div>
    <div id="bgu-msg"></div>`;
  document.body.append(btn, panel);

  const fileInput = panel.querySelector('#bgu-file');
  const grid = panel.querySelector('#bgu-grid');
  const msg = panel.querySelector('#bgu-msg');

  btn.onclick = () => panel.classList.toggle('open');
  panel.querySelector('#bgu-add').onclick = () => fileInput.click();
  panel.querySelector('#bgu-clear').onclick = async () => { await applyBackground(null); render(); };

  fileInput.onchange = async () => {
    msg.textContent = '';
    let lastId = null;
    for (const f of fileInput.files) {
      try {
        const blob = await shrink(f);
        lastId = await addImage(blob, f.name);
      } catch (e) { msg.textContent = e.message || 'تعذّر رفع الصورة'; }
    }
    fileInput.value = '';
    if (lastId != null) await applyBackground(lastId);
    render();
  };

  async function render() {
    const items = await getAll();
    const active = Number(localStorage.getItem(ACTIVE_KEY));
    grid.innerHTML = '';
    items.forEach(rec => {
      const d = document.createElement('div');
      d.className = 'bgu-item' + (rec.id === active ? ' active' : '');
      const im = document.createElement('img');
      im.src = URL.createObjectURL(rec.blob);
      im.onload = () => URL.revokeObjectURL(im.src);
      const x = document.createElement('button');
      x.className = 'del'; x.textContent = '×'; x.title = 'حذف';
      x.onclick = async e => {
        e.stopPropagation();
        await removeImage(rec.id);
        if (rec.id === active) await applyBackground(null);
        render();
      };
      d.onclick = async () => { await applyBackground(rec.id); render(); };
      d.append(im, x);
      grid.appendChild(d);
    });
  }

  /* ---------- عند فتح الصفحة ---------- */
  (async function init() {
    const saved = localStorage.getItem(ACTIVE_KEY);
    if (saved) await applyBackground(Number(saved));
    render();
  })();

  // للاستخدام من أكوادك الأخرى: window.UserBackgrounds.open()
  window.UserBackgrounds = {
    open: () => panel.classList.add('open'),
    close: () => panel.classList.remove('open'),
    clear: () => applyBackground(null)
  };
})();
