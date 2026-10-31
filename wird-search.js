/*!
 * wird-search.js — بحث في آيات القرآن + تنزيل MP3 (بلا حد للمالك)
 * ملف واحد مستقل: أضِفه للموقع بسطر واحد قبل </body>:
 *   <script src="wird-search.js" defer></script>
 *
 * - البحث يعمل بدون تشكيل ويتجاهل اختلاف الهمزات (أ إ آ) و(ة ه) و(ى ي).
 *   أمثلة: «الصابرين» ، «لا اله الا الله» ، «2:255» ، «سورة الكهف»
 * - نص المصحف يُحمَّل مرة واحدة ثم يُحفظ على الجهاز، فيعمل البحث بعدها بلا إنترنت.
 * - الزائر العادي: حد أقصى 20 آية في التنزيل. المالك: بلا حد.
 *
 * تفعيل وضع المالك (واحدة من ثلاث):
 *   1) في كود موقعك بعد تسجيل دخول المالك:  window.wirdIsOwner = () => (شرط المالك عندك);
 *   2) أو  window.WIRD_OWNER = true;
 *   3) أو مرة واحدة في كونسول جهاز المالك:  localStorage.setItem('wird_owner','1')
 */
(function () {
  'use strict';
  if (window.WirdSearch) return;

  /* ===================== الإعدادات ===================== */
  var CFG = {
    FREE_LIMIT: 20,          // حد الزائر العادي
    CONCURRENCY: 6,          // عدد الاتصالات المتوازية
    PAGE: 50,                // عدد النتائج في كل دفعة
    TEXT_URL: 'https://api.alquran.cloud/v1/quran/quran-uthmani',   // للعرض
    SIMPLE_URL: 'https://api.alquran.cloud/v1/quran/quran-simple',  // للبحث (إملاء عادي)
    DB: 'wird-search', STORE: 'kv', KEY: 'quran-v2',
    // أضِف أي قارئ هنا: url يستقبل الآية {g: الرقم العام 1..6236, s: السورة, n: رقم الآية}
    READERS: [
      { id: 'alafasy',   name: 'مشاري العفاسي',        url: function (a) { return 'https://cdn.islamic.network/quran/audio/128/ar.alafasy/' + a.g + '.mp3'; } },
      { id: 'husary',    name: 'محمود الحصري',         url: function (a) { return 'https://cdn.islamic.network/quran/audio/128/ar.husary/' + a.g + '.mp3'; } },
      { id: 'minshawi',  name: 'محمد صدّيق المنشاوي',  url: function (a) { return 'https://cdn.islamic.network/quran/audio/128/ar.minshawi/' + a.g + '.mp3'; } },
      { id: 'abdulbasit',name: 'عبد الباسط (مرتّل)',   url: function (a) { return 'https://cdn.islamic.network/quran/audio/128/ar.abdulbasitmurattal/' + a.g + '.mp3'; } },
      { id: 'sudais',    name: 'عبد الرحمن السديس',    url: function (a) { return 'https://cdn.islamic.network/quran/audio/128/ar.abdurrahmaansudais/' + a.g + '.mp3'; } },
      { id: 'maher',     name: 'ماهر المعيقلي',        url: function (a) { return 'https://cdn.islamic.network/quran/audio/128/ar.mahermuaiqly/' + a.g + '.mp3'; } },
      { id: 'hudhaify',  name: 'علي الحذيفي',          url: function (a) { return 'https://cdn.islamic.network/quran/audio/128/ar.hudhaify/' + a.g + '.mp3'; } },
      { id: 'shaatree',  name: 'أبو بكر الشاطري',      url: function (a) { return 'https://cdn.islamic.network/quran/audio/128/ar.shaatree/' + a.g + '.mp3'; } }
    ]
  };

  function isOwner() {
    try { if (window.WIRD_OWNER === true) return true; } catch (e) {}
    try { if (typeof window.wirdIsOwner === 'function' && window.wirdIsOwner()) return true; } catch (e) {}
    try { return localStorage.getItem('wird_owner') === '1'; } catch (e) { return false; }
  }

  /* ===================== تطبيع النص والبحث ===================== */
  var AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
  var STRIP = /[\u0640\u064B-\u065F\u0670\u06D6-\u06ED\u08D3-\u08FF]/;

  function westernDigits(s) { return s.replace(/[٠-٩]/g, function (d) { return AR_DIGITS.indexOf(d); }); }

  function mapChar(ch) {
    if (STRIP.test(ch)) return '';
    if ('أإآٱ'.indexOf(ch) !== -1) return 'ا';
    if (ch === 'ى' || ch === 'ئ') return 'ي';
    if (ch === 'ة') return 'ه';
    if (ch === 'ؤ') return 'و';
    return ch;
  }

  // يعيد النص المطبَّع مع خريطة من موضع كل حرف مطبَّع إلى موضعه في الأصل
  function normMap(text, loose) {
    var n = '', map = [], lastSpace = true;
    for (var i = 0; i < text.length; i++) {
      var c = mapChar(text[i]);
      if (c === '' || (loose && c === 'ا')) continue;
      if (/\s/.test(c)) { if (lastSpace) continue; c = ' '; lastSpace = true; } else { lastSpace = false; }
      n += c; map.push(i);
    }
    if (n.charAt(n.length - 1) === ' ') { n = n.slice(0, -1); map.pop(); }
    return { n: n, map: map };
  }
  function norm(t) { return normMap(t).n; }

  function esc(s) { return s.replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function highlight(text, tokens) {
    var nm = normMap(text), nl = null, ranges = [], i;
    function scan(m, t, isLoose) {
      var p = 0, found = false;
      if (!t) return false;
      while ((p = m.n.indexOf(t, p)) !== -1) {
        var s = m.map[p], e = m.map[p + t.length - 1] + 1;
        if (isLoose) while (s > 0 && /[اٱأإآ]/.test(text[s - 1])) s--;
        while (e < text.length && STRIP.test(text[e])) e++;
        ranges.push([s, e]); p += t.length; found = true;
      }
      return found;
    }
    tokens.forEach(function (t) {
      if (scan(nm, t)) return;
      var lt = t.replace(/ا/g, '');          // الرسم العثماني يحذف الألف أحيانًا
      if (lt.length < 2) return;
      if (!nl) nl = normMap(text, true);
      scan(nl, lt, true);
    });
    if (!ranges.length) return esc(text);
    ranges.sort(function (a, b) { return a[0] - b[0]; });
    var merged = [ranges[0].slice()];
    for (i = 1; i < ranges.length; i++) {
      var last = merged[merged.length - 1];
      if (ranges[i][0] <= last[1]) last[1] = Math.max(last[1], ranges[i][1]); else merged.push(ranges[i].slice());
    }
    var out = '', pos = 0;
    merged.forEach(function (r) { out += esc(text.slice(pos, r[0])) + '<mark>' + esc(text.slice(r[0], r[1])) + '</mark>'; pos = r[1]; });
    return out + esc(text.slice(pos));
  }

  /* ===================== تخزين محلي (IndexedDB) ===================== */
  function idb() {
    return new Promise(function (res, rej) {
      var r = indexedDB.open(CFG.DB, 1);
      r.onupgradeneeded = function () { r.result.createObjectStore(CFG.STORE); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
  }
  function withTimeout(p, ms, fallback) {
    return new Promise(function (res) {
      var done = false, t = setTimeout(function () { if (!done) { done = true; res(fallback); } }, ms);
      p.then(function (v) { if (!done) { done = true; clearTimeout(t); res(v); } },
             function () { if (!done) { done = true; clearTimeout(t); res(fallback); } });
    });
  }
  function idbGet(k) {
    return withTimeout(idb().then(function (db) {
      return new Promise(function (res, rej) {
        var q = db.transaction(CFG.STORE).objectStore(CFG.STORE).get(k);
        q.onsuccess = function () { res(q.result); }; q.onerror = function () { rej(q.error); };
      });
    }), 1500, null);
  }
  function idbSet(k, v) {
    return withTimeout(idb().then(function (db) {
      return new Promise(function (res, rej) {
        var tx = db.transaction(CFG.STORE, 'readwrite'); tx.objectStore(CFG.STORE).put(v, k);
        tx.oncomplete = res; tx.onerror = function () { rej(tx.error); };
      });
    }), 4000, null);
  }

  /* ===================== تحميل نص المصحف ===================== */
  var Q = null, loading = null;

  function stripBasmala(t) {
    var w = t.split(/\s+/);
    return norm(w.slice(0, 4).join(' ')) === 'بسم الله الرحمن الرحيم' ? w.slice(4).join(' ') : t;
  }

  function build(raw) {
    var ayahs = [], surahs = [];
    raw.forEach(function (s) {
      var start = ayahs.length;
      s.a.forEach(function (y) {
        var g = y[0], n = y[1], text = y[2], simple = y[3] || y[2];
        if (n === 1 && s.n !== 1 && s.n !== 9) { text = stripBasmala(text); simple = stripBasmala(simple); }  // البسملة الملتصقة بالآية الأولى
        ayahs.push({ g: g, s: s.n, n: n, text: text, norm: norm(simple) });
      });
      surahs.push({ n: s.n, name: s.name, key: norm(s.name).replace(/^سوره\s+/, ''), start: start, count: s.a.length });
    });
    return { ayahs: ayahs, surahs: surahs };
  }

  function loadQuran() {
    if (Q) return Promise.resolve(Q);
    if (loading) return loading;
    loading = idbGet(CFG.KEY).then(function (raw) {
      if (raw) return raw;
      function getJson(u) { return fetch(u).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }); }
      return Promise.all([getJson(CFG.TEXT_URL), getJson(CFG.SIMPLE_URL).catch(function () { return null; })]).then(function (r) {
        var u = r[0], sm = r[1];
        var raw = u.data.surahs.map(function (s, i) {
          var ss = sm && sm.data.surahs[i];
          return { n: s.number, name: s.name, a: s.ayahs.map(function (y, k) {
            return [y.number, y.numberInSurah, y.text, (ss && ss.ayahs[k]) ? ss.ayahs[k].text : y.text];
          }) };
        });
        idbSet(CFG.KEY, raw);   // حفظ في الخلفية دون انتظار
        return raw;
      });
    }).then(function (raw) { Q = build(raw); return Q; }).catch(function (e) { loading = null; throw e; });
    return loading;
  }

  function search(q) {
    q = westernDigits((q || '').trim());
    if (!q) return { list: [], tokens: [] };
    var m = q.match(/^(\d{1,3})\s*[:\/\-.]\s*(\d{1,3})$/);
    if (m) {
      var S = Q.surahs[+m[1] - 1], a = +m[2];
      return (S && a >= 1 && a <= S.count) ? { list: [Q.ayahs[S.start + a - 1]], tokens: [] } : { list: [], tokens: [] };
    }
    var qn = norm(q);
    if (/^سوره\s+/.test(qn)) {
      var key = qn.replace(/^سوره\s+/, ''), sur = null;
      for (var i = 0; i < Q.surahs.length; i++) if (Q.surahs[i].key === key) { sur = Q.surahs[i]; break; }
      if (sur) return { list: Q.ayahs.slice(sur.start, sur.start + sur.count), tokens: [] };
    }
    var tokens = qn.split(' ').filter(Boolean);
    return { list: Q.ayahs.filter(function (a) { return tokens.every(function (t) { return a.norm.indexOf(t) !== -1; }); }), tokens: tokens };
  }

  /* ===================== التنزيل ===================== */
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function fetchAyah(reader, ay, signal) {
    var attempt = 0;
    function go() {
      return fetch(reader.url(ay), { signal: signal }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status + ' (آية ' + ay.s + ':' + ay.n + ')');
        return r.arrayBuffer();
      }).catch(function (e) {
        if (signal.aborted || ++attempt > 2) throw e;
        return sleep(400 * attempt).then(go);
      });
    }
    return go();
  }

  // يجلب الآيات بالتوازي ويضمّها بالترتيب في ملف MP3 واحد
  function fetchBlob(list, reader, ctl, onTick) {
    var parts = new Array(list.length), next = 0;
    function worker() {
      if (next >= list.length) return Promise.resolve();
      var i = next++;
      return fetchAyah(reader, list[i], ctl.signal).then(function (buf) {
        parts[i] = new Blob([buf], { type: 'audio/mpeg' }); onTick(); return worker();
      });
    }
    var ws = [], k = Math.min(CFG.CONCURRENCY, list.length);
    for (var i = 0; i < k; i++) ws.push(worker());
    return Promise.all(ws).then(function () { return new Blob(parts, { type: 'audio/mpeg' }); })
      .catch(function (e) { ctl.abort(); throw e; });
  }

  function saveBlob(blob, name) {
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }

  function groupBySurah(list) {
    var groups = [], cur = null;
    list.forEach(function (a) { if (!cur || cur[0].s !== a.s) { cur = []; groups.push(cur); } cur.push(a); });
    return groups;
  }

  /* ===================== الواجهة ===================== */
  var CSS = '' +
    '.wsu-fab{position:fixed;left:16px;bottom:16px;z-index:99998;width:52px;height:52px;border-radius:50%;border:1px solid #d4af37;background:#0e2623;color:#f3e3a3;font-size:22px;cursor:pointer;box-shadow:0 4px 14px #0009}' +
    '.wsu-ov{position:fixed;inset:0;z-index:99999;background:#000b;display:none;align-items:flex-end;justify-content:center}.wsu-ov.on{display:flex}' +
    '.wsu-p{direction:rtl;width:min(720px,100%);height:min(94vh,880px);background:#0e2623;color:#ecf2f0;border:1px solid #2a4b46;border-radius:16px 16px 0 0;display:flex;flex-direction:column;font-family:inherit}' +
    '.wsu-p *{box-sizing:border-box}' +
    '.wsu-hd{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid #2a4b46}.wsu-hd b{flex:1;font-size:1.05rem}' +
    '.wsu-own{background:#d4af37;color:#1b1b1b;border-radius:10px;padding:2px 8px;font-size:.78rem}' +
    '.wsu-p button{font-family:inherit;cursor:pointer}.wsu-x{background:none;border:0;color:#ecf2f0;font-size:1.2rem}' +
    '.wsu-sr{padding:10px 14px}.wsu-sr input{width:100%;padding:11px 12px;border-radius:10px;border:1px solid #2a4b46;background:#13322e;color:#fff;font-size:1rem;font-family:inherit}' +
    '.wsu-meta{padding:0 14px 6px;font-size:.85rem;color:#9fb8b3;min-height:22px}' +
    '.wsu-list{flex:1;overflow:auto;padding:0 14px 8px}' +
    '.wsu-it{border-bottom:1px solid #1d3f3a;padding:10px 0}' +
    '.wsu-ref{font-size:.8rem;color:#d4af37;margin-bottom:4px}' +
    '.wsu-tx{font-family:"Amiri Quran","Amiri","Scheherazade New",serif;font-size:1.25rem;line-height:2.1}' +
    '.wsu-tx mark{background:#d4af3755;color:#fff;border-radius:3px}' +
    '.wsu-ac{display:flex;gap:6px;flex-wrap:wrap;margin-top:4px}' +
    '.wsu-ac button,.wsu-more{background:#13322e;color:#ecf2f0;border:1px solid #2a4b46;border-radius:8px;padding:5px 10px;font-size:.82rem}' +
    '.wsu-more{display:block;margin:10px auto}' +
    '.wsu-dl{border-top:1px solid #2a4b46;padding:10px 14px 14px;background:#0b1f1c}' +
    '.wsu-row{display:flex;gap:8px;align-items:center;margin-bottom:8px}.wsu-row label{width:44px;font-size:.85rem;color:#9fb8b3}' +
    '.wsu-row select{flex:1;min-width:0;padding:8px;border-radius:8px;border:1px solid #2a4b46;background:#13322e;color:#fff;font-family:inherit}' +
    '.wsu-info{font-size:.84rem;color:#9fb8b3;margin-bottom:8px}' +
    '.wsu-go{flex:1;padding:11px;border-radius:10px;border:0;background:#d4af37;color:#1b1b1b;font-weight:700;font-size:.95rem}.wsu-go[disabled]{opacity:.45}' +
    '.wsu-go2{flex:1;padding:11px;border-radius:10px;border:1px solid #d4af37;background:none;color:#f3e3a3;font-size:.9rem}' +
    '.wsu-chk{display:flex;gap:6px;align-items:center;font-size:.85rem;margin:2px 0 8px}' +
    '.wsu-prog{height:8px;background:#13322e;border-radius:6px;overflow:hidden;margin:6px 0}.wsu-prog div{height:100%;width:0;background:#d4af37;transition:width .15s}' +
    '.wsu-msg{font-size:.85rem;min-height:20px}.wsu-msg.err{color:#ff9d9d}' +
    '[hidden]{display:none!important}';

  var ui = null, st = { res: [], tokens: [], shown: 0 }, busy = false, ctl = null, audio = null, playingG = null;

  function el(html) { var d = document.createElement('div'); d.innerHTML = html; return d.firstElementChild; }

  function buildUI() {
    var ov = el(
      '<div class="wsu-ov" role="dialog" aria-modal="true"><div class="wsu-p">' +
      '<div class="wsu-hd"><b>🔎 بحث وتنزيل الآيات</b><span class="wsu-own" data-own hidden>👑 المالك</span><button class="wsu-x" data-x aria-label="إغلاق">✕</button></div>' +
      '<div class="wsu-sr"><input data-q type="search" placeholder="كلمة أو جزء آية… أو 2:255 أو «سورة الكهف»" autocomplete="off"></div>' +
      '<div class="wsu-meta" data-meta></div><div class="wsu-list" data-list></div>' +
      '<div class="wsu-dl">' +
      '<div class="wsu-row"><label>القارئ</label><select data-rd></select></div>' +
      '<div class="wsu-row"><label>من</label><select data-sf></select><select data-af style="max-width:90px"></select></div>' +
      '<div class="wsu-row"><label>إلى</label><select data-st></select><select data-at style="max-width:90px"></select></div>' +
      '<div class="wsu-info" data-info></div>' +
      '<label class="wsu-chk" data-pswrap hidden><input type="checkbox" data-ps> ملف منفصل لكل سورة</label>' +
      '<div class="wsu-row"><button class="wsu-go" data-dl>⬇ تنزيل المقطع MP3</button><button class="wsu-go2" data-dla hidden>⬇ كل نتائج البحث</button><button class="wsu-go2" data-cx hidden>إلغاء</button></div>' +
      '<div class="wsu-prog" data-prog hidden><div data-bar></div></div><div class="wsu-msg" data-msg></div>' +
      '</div></div></div>');
    document.body.appendChild(ov);
    var $ = function (k) { return ov.querySelector('[data-' + k + ']'); };
    ui = { ov: ov, $: $ };

    CFG.READERS.forEach(function (r) { var o = document.createElement('option'); o.value = r.id; o.textContent = r.name; $('rd').appendChild(o); });
    try { var saved = localStorage.getItem('wsu_reader'); if (saved) $('rd').value = saved; } catch (e) {}
    $('rd').onchange = function () { try { localStorage.setItem('wsu_reader', $('rd').value); } catch (e) {} };

    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    $('x').onclick = close;
    $('list').onclick = onListClick;
    var t = null;
    $('q').oninput = function () { clearTimeout(t); t = setTimeout(doSearch, 180); };
    ['sf', 'st'].forEach(function (k) { $(k).onchange = function () { fillAyahs(k === 'sf' ? 'af' : 'at', k); info(); }; });
    ['af', 'at'].forEach(function (k) { $(k).onchange = info; });
    $('dl').onclick = function () { run(rangeList(), $('ps').checked); };
    $('dla').onclick = function () { run(st.res, $('ps').checked); };
    $('cx').onclick = function () { if (ctl) ctl.abort(); };
  }

  function fillSurahs() {
    var $ = ui.$;
    ['sf', 'st'].forEach(function (k) {
      var sel = $(k); sel.innerHTML = '';
      Q.surahs.forEach(function (s) {
        var o = document.createElement('option'); o.value = s.n;
        o.textContent = s.n + '. ' + s.name.replace(/^\S+\s+/, ''); sel.appendChild(o);
      });
    });
    fillAyahs('af', 'sf'); fillAyahs('at', 'st'); info();
  }
  function fillAyahs(ak, sk) {
    var sel = ui.$(ak), S = Q.surahs[+ui.$(sk).value - 1]; sel.innerHTML = '';
    for (var i = 1; i <= S.count; i++) { var o = document.createElement('option'); o.value = i; o.textContent = i; sel.appendChild(o); }
  }
  function setPos(sk, ak, a) { ui.$(sk).value = a.s; fillAyahs(ak, sk); ui.$(ak).value = a.n; }

  function rangeList() {
    var $ = ui.$, i = Q.surahs[+$('sf').value - 1].start + (+$('af').value) - 1, j = Q.surahs[+$('st').value - 1].start + (+$('at').value) - 1;
    if (i > j) { var x = i; i = j; j = x; }
    return Q.ayahs.slice(i, j + 1);
  }

  function info() {
    if (!Q || !ui) return;
    var $ = ui.$, owner = isOwner(), n = rangeList().length;
    $('own').hidden = !owner; $('pswrap').hidden = !owner; $('dla').hidden = !(owner && st.res.length > 0);
    if (st.res.length) $('dla').textContent = '⬇ كل نتائج البحث (' + st.res.length + ')';
    var over = !owner && n > CFG.FREE_LIMIT;
    $('info').textContent = 'المحدّد: ' + n + ' آية — ' + (owner ? 'بلا حد (صلاحية المالك)' : 'الحد الأقصى ' + CFG.FREE_LIMIT + ' آية');
    $('dl').disabled = busy || over;
  }

  function msg(t, err) { var m = ui.$('msg'); m.textContent = t || ''; m.className = 'wsu-msg' + (err ? ' err' : ''); }

  function renderMore() {
    var list = ui.$('list'), frag = document.createDocumentFragment();
    var old = list.querySelector('.wsu-more'); if (old) old.remove();
    var end = Math.min(st.res.length, st.shown + CFG.PAGE);
    for (var i = st.shown; i < end; i++) {
      var a = st.res[i], S = Q.surahs[a.s - 1];
      var it = el('<div class="wsu-it"><div class="wsu-ref"></div><div class="wsu-tx"></div><div class="wsu-ac">' +
        '<button data-a="play">▶ استماع</button><button data-a="dl">⬇ تنزيل</button><button data-a="from">من هنا</button><button data-a="to">إلى هنا</button></div></div>');
      it.querySelector('.wsu-ref').textContent = S.name + ' — آية ' + a.n;
      it.querySelector('.wsu-tx').innerHTML = highlight(a.text, st.tokens) + ' \u06DD' + a.n;
      it._a = a; frag.appendChild(it);
    }
    st.shown = end; list.appendChild(frag);
    if (st.shown < st.res.length) {
      var b = el('<button class="wsu-more">عرض المزيد (' + (st.res.length - st.shown) + ' متبقّية)</button>'); b.onclick = renderMore; list.appendChild(b);
    }
  }

  function onListClick(e) {
    var b = e.target.closest('button[data-a]'); if (!b) return;
    var a = b.parentNode.parentNode._a, act = b.getAttribute('data-a');
    if (act === 'from') { setPos('sf', 'af', a); if (Q.surahs[+ui.$('st').value - 1].start + (+ui.$('at').value) - 1 < a.g - 1) setPos('st', 'at', a); info(); }
    else if (act === 'to') { setPos('st', 'at', a); info(); }
    else if (act === 'dl') run([a], false);
    else if (act === 'play') play(a);
  }

  function play(a) {
    var reader = CFG.READERS.filter(function (r) { return r.id === ui.$('rd').value; })[0];
    if (audio) { audio.pause(); audio = null; if (playingG === a.g) { playingG = null; return; } }
    playingG = a.g; audio = new Audio(reader.url(a));
    audio.onended = function () { playingG = null; };
    audio.play().catch(function () { msg('تعذّر تشغيل الصوت (تحقّق من الاتصال).', true); });
  }

  function doSearch() {
    if (!Q) return;
    var q = ui.$('q').value, r = search(q);
    st.res = r.list; st.tokens = r.tokens; st.shown = 0; ui.$('list').innerHTML = '';
    ui.$('meta').textContent = q.trim() ? (r.list.length ? 'عدد النتائج: ' + r.list.length : 'لا توجد نتائج.') : 'اكتب كلمة للبحث في المصحف كله.';
    renderMore(); info();
  }

  function run(list, perSurah) {
    if (busy || !list.length) return;
    var owner = isOwner();
    if (!owner && list.length > CFG.FREE_LIMIT) { msg('الحد الأقصى ' + CFG.FREE_LIMIT + ' آية.', true); return; }
    if (list.length > 1500 && !perSurah && !confirm('الملف كبير جدًا (' + list.length + ' آية) وقد يستهلك ذاكرة الجهاز. الأفضل «ملف منفصل لكل سورة». هل تتابع؟')) return;
    var reader = CFG.READERS.filter(function (r) { return r.id === ui.$('rd').value; })[0];
    var groups = (perSurah && owner) ? groupBySurah(list) : [list], total = list.length, done = 0, $ = ui.$;
    busy = true; ctl = new AbortController(); $('cx').hidden = false; $('prog').hidden = false; $('bar').style.width = '0'; msg('جارٍ التنزيل…'); info();
    var tick = function () { done++; $('bar').style.width = (done / total * 100) + '%'; $('msg').textContent = 'جارٍ التنزيل… ' + done + ' / ' + total; };
    var chain = Promise.resolve();
    groups.forEach(function (g) {
      chain = chain.then(function () {
        return fetchBlob(g, reader, ctl, tick).then(function (blob) {
          var l = g[g.length - 1];
          saveBlob(blob, 'wird_' + reader.id + '_' + g[0].s + '-' + g[0].n + '_' + l.s + '-' + l.n + '.mp3');
        });
      });
    });
    chain.then(function () { msg('تم التنزيل ✔ (' + total + ' آية)'); })
      .catch(function (e) { msg(ctl.signal.aborted && !(e && e.message && /HTTP/.test(e.message)) ? 'أُلغي التنزيل.' : 'تعذّر التنزيل: ' + (e && e.message || e), true); })
      .then(function () { busy = false; $('cx').hidden = true; $('prog').hidden = true; info(); });
  }

  function open() {
    if (!ui) buildUI();
    ui.ov.classList.add('on'); info();
    if (Q) { ui.$('q').focus(); return; }
    ui.$('meta').textContent = 'جارٍ تحميل نص المصحف (مرة واحدة فقط)…';
    loadQuran().then(function () { fillSurahs(); doSearch(); ui.$('q').focus(); })
      .catch(function () { ui.$('meta').textContent = 'تعذّر تحميل نص المصحف. تحقّق من الاتصال ثم أعد المحاولة.'; });
  }
  function close() { if (ui) ui.ov.classList.remove('on'); if (audio) { audio.pause(); audio = null; playingG = null; } }

  function init() {
    var s = document.createElement('style'); s.textContent = CSS; document.head.appendChild(s);
    var fab = document.createElement('button'); fab.className = 'wsu-fab'; fab.title = 'بحث في الآيات'; fab.textContent = '🔎'; fab.onclick = open;
    document.body.appendChild(fab);
  }

  window.WirdSearch = { open: open, close: close, isOwner: isOwner, _t: { norm: norm, normMap: normMap, highlight: highlight, build: build, westernDigits: westernDigits } };
  if (typeof document !== 'undefined' && document.addEventListener) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  }
})();
