/* =====================================================================================================================
   NOVELIST SYNC — simpan di perangkat dulu (bisa offline), lalu sinkron ke Google Drive dengan deteksi konflik.

   Dimuat SETELAH app.js (lihat scripts/build-www.mjs). Fungsi global app.js yang berhubungan dengan penyimpanan
   diganti/dibungkus dari sini. Tetap jalan dengan app.js lama (fitur baru app.js dideteksi dulu sebelum dipakai).

   Cara kerja
   - Setiap suntingan (markDirtyAndSchedule) ditulis ke IndexedDB "novelist-sync" di perangkat ini paling lambat ±1 dtk
     setelah diketik — terpisah dari upload ke Drive. Upload menyusul (autosave app.js) kalau ada internet & sudah login.
     Tanpa internet / sesi Google habis: tulisan tetap aman di perangkat dan dikirim otomatis begitu bisa.
   - Saat tab ditutup / disembunyikan / dimuat ulang (app.js memanggil NovelistSync.emergencySave), suntingan yang belum
     sempat masuk IndexedDB ditulis SINKRON ke localStorage ("salinan darurat") lalu dipulihkan saat dibuka lagi.
   - Tiap project mengingat "base" = modifiedTime file Drive saat terakhir sinkron, hash isi saat itu, dan nomor simpan
     (novelistSave.rev di dalam file). Sebelum mengunggah, modifiedTime di Drive dicek dulu. Kalau berubah:
       • isi Drive sama dengan isi di sini               -> cukup catat base baru
       • di sini TIDAK ada perubahan                      -> versi Drive diambil (otomatis) — kecuali nomor simpannya
         LEBIH KECIL dari yang terakhir tersinkron di sini (ditimpa tab / aplikasi versi lama) -> pengguna memilih
       • di Drive cuma metadata yang berubah              -> versi di sini diunggah
       • dua-duanya berubah                              -> KONFLIK: pengguna memilih (simpan keduanya / pakai versi
         perangkat ini / pakai versi Drive). Versi yang tidak dipakai disimpan dulu ke folder backup Drive.
   - Versi Drive TIDAK diterapkan saat pengguna sedang mengetik (ketikan < 4 dtk / kolom edit kanvas terbuka / kolom
     teks project masih fokus dengan ketikan < 30 dtk) — dicek lagi sebentar kemudian. Ketikan yang masuk selama versi Drive diunduh = suntingan -> konflik, tidak ditimpa.
     Setelah versi lain diterapkan, project dibuka ulang di tab yang sama (modul Jejaring/Beranda/Quill/Map/Timeline/
     Tulis/Organize memakai data baru) + event window "novelist:project-replaced" { detail: { id } }.
   - Saat aplikasi/tab kembali dibuka (visibilitychange/focus/online) dan berkala tiap 2 menit, project yang terbuka
     dicek ke Drive. Gagal sinkron (jaringan / Drive 5xx) -> dicoba lagi otomatis: 2 dtk, 4, 8, … maks. 1 menit.
   - Beberapa tab di browser yang sama: tiap tulisan IndexedDB punya nomor revisi (rev) + id tab. Tab yang datanya sudah
     ketinggalan tidak boleh menimpa (compare-and-set); tab lain diberi tahu lewat BroadcastChannel dan memuat versi
     terbaru kalau di sana tidak ada suntingan, kalau ada -> dialog konflik "tab lain".
   - Project yang dihapus saat offline ditandai lalu dipindah ke Trash Drive begitu online.
   - Project yang dihapus di perangkat lain (dipindah ke Trash) ikut hilang di sini, kecuali di sini ada perubahan yang
     belum terkirim — perubahan itu diunggah ulang sebagai file baru supaya tidak hilang.
   - File yang ditulis versi Novelist lebih baru (novelistSave.schema > SCHEMA) dibuka HANYA-BACA (tidak pernah diunggah
     dari sini) + ajakan memuat ulang halaman.

   Kait dari luar (opsional, dipasang novelist-android.js) — tidak berubah:
     NovelistSync.hooks.refreshToken(force) -> Promise<boolean>   ambil access token baru tanpa interaksi
     NovelistSync.hooks.interactiveLogin()  -> Promise             login dengan interaksi (saat status diklik)
     NovelistSync.deviceLabel                                     "HP" / "web" (nama salinan saat konflik)

   Catatan untuk aplikasi Android (perubahan perilaku sejak versi sebelumnya):
   - hooks.refreshToken kini juga dipanggil oleh driveFetch app.js baru (sebelum token dipakai bila sudah/hampir habis,
     dan sekali saat Drive menjawab 401). Tanpa hook, web memakai GIS (prompt ""). Hook boleh dipanggil berulang.
   - Setelah interactiveLogin, akun dicek: login dengan akun Google lain ditolak (token dibuang, status tetap login).
   - Record IndexedDB punya field baru: rev, tab, hv, syncedRev (record lama tetap terbaca). hash/syncedHash kini hash ISI
     tanpa novelistSave (hv: 2); record lama dihitung ulang saat dibaca.
   - Sebelum versi Drive dibandingkan (reconcile), record IndexedDB terbaru dari tab lain diambil dulu.
   - File .novj punya field baru "novelistSave": { rev, schema, by, at } (dibiarkan apa adanya oleh versi lama).
   - Panggil NovelistSync.emergencySave() di onPause kalau WebView tidak menembakkan pagehide/visibilitychange.
   - API baru: hasPending(), emergencySave(), flushLocal(), act() (sama dengan mengetuk status).
   ===================================================================================================================== */
(function () {
  "use strict";
  if (window.NovelistSync) return;   // sudah dimuat (mis. versi web juga menyertakan file ini)
  if (typeof saveProjectToDriveMain !== "function" || typeof loadProjectsFromDrive !== "function") {
    console.error("[Sync] app.js tidak dikenali — sinkron offline tidak aktif.");
    return;
  }

  const DB_NAME = "novelist-sync";
  const STORE = "projects";
  const META = "meta";
  const POLL_MS = 2 * 60000;        // cek berkala project yang terbuka
  const RETRY_MIN_MS = 2000;        // coba lagi setelah gagal sinkron: 2 dtk, 4, 8, ... maks. 1 menit
  const RETRY_MAX_MS = 60000;
  const RESUME_THROTTLE_MS = 15000; // cek saat app/tab kembali dibuka paling sering tiap 15 dtk
  const PERSIST_MS = 300;           // suntingan -> IndexedDB setelah jeda 300 ms ...
  const PERSIST_MAX_MS = 1000;      // ... paling lambat 1 dtk walau terus mengetik
  const BUSY_MS = 4000;             // ketikan terakhir < 4 dtk = sedang mengetik (versi Drive ditunda)
  const FOCUS_BUSY_MS = 30000;      // kolom teks project masih fokus & ketikan terakhir < 30 dtk = juga ditunda
  const RECHECK_MS = 5000;          // cek ulang setelah penundaan
  const SCHEMA = 1;                 // versi format .novj yang dipahami file ini (naikkan bila versi lama akan merusak data baru)
  const RESCUE_PREFIX = "novelist_sync_rescue|";   // localStorage: salinan darurat (dihapus ikut "Hapus akun")
  const TAB_ID = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  const hooks = { refreshToken: null, interactiveLogin: null };
  const S = {
    account: null,          // permissionId akun Google yang aktif
    state: "idle",          // synced | syncing | local | offline | login | error
    busy: 0,
    needLogin: false,
    lastResumeCheck: 0,
    retryTimer: 0,
    retryDelay: 0,
    recheckTimer: 0,
    pollTimer: 0,
    lastInput: 0,           // ketikan terakhir di editor
    composing: false,       // IME sedang menyusun huruf
    localOk: true,          // tulisan terakhir ke IndexedDB berhasil
    wiped: false,           // data lokal sudah dihapus (Hapus akun) -> jangan tulis apa pun lagi
    pendingTrash: new Map(),// driveFileId -> record yang dihapus saat offline
  };
  const T = new WeakMap();  // status sementara per project (timer simpan lokal) — tidak ikut tersimpan

  // ------------------------------------------------------------------ util
  // hash cepat (cyrb53) untuk membandingkan isi project tanpa menyimpan salinan teksnya di memori
  function hash(str) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h2 >>> 0).toString(36) + "-" + (h1 >>> 0).toString(36) + "-" + str.length.toString(36);
  }
  // isi file .novj persis seperti yang ditulis app.js: { ...data, cover }
  function payloadJson(p) { return JSON.stringify({ ...p.data, cover: p.cover || null }); }
  // hash ISI project: tanpa novelistSave (nomor simpan / waktu unggah bukan isi). Jadi upload tab lain yang hanya
  // memperbarui penanda itu tidak terlihat seperti suntingan (tidak memicu konflik palsu). Record lama (tanpa hv: 2)
  // memakai hash isi penuh -> dihitung ulang saat dibaca.
  const HASH_V = 2;
  function contentHash(data, cover) { return hash(JSON.stringify({ ...data, novelistSave: undefined, cover: cover || null })); }
  function localHash(p) { return contentHash(p.data, p.cover); }
  function jsonContentHash(json) { const o = JSON.parse(json); return contentHash(o, o.cover); }
  // hash isi sebuah record IndexedDB (record lama dihitung ulang)
  function recHash(rec) {
    if (rec.hv === HASH_V && rec.hash) return rec.hash;
    try { return jsonContentHash(rec.json); } catch (e) { return null; }
  }
  // hash isi saat terakhir tersinkron (record lama: hanya bisa dipakai kalau tidak ada suntingan sejak itu)
  const recSyncedHash = (rec, contentH) => (rec.hv === HASH_V ? rec.syncedHash || null : rec.edited === false ? contentH : null);
  // "Berubah di perangkat ini" = benar-benar ada suntingan sejak sinkron terakhir (ditandai lewat markDirtyAndSchedule),
  // BUKAN sekadar isi yang berbeda: membuka tab Beranda/Jejaring/Timeline/Map menambahkan struktur bawaan ke data project
  // tanpa ada yang diketik, dan itu tidak boleh dianggap perubahan (kalau dianggap, setiap pindah perangkat jadi konflik).
  function isChanged(p) { return !p.driveFileId || !!p._edited; }
  function markEdited(p) { p._edited = true; p._editSeq = (p._editSeq || 0) + 1; }
  // suntingan yang belum masuk IndexedDB
  const unsaved = (p) => (p._editSeq || 0) > (p._persistSeq || 0);
  // nomor simpan & versi format di dalam file
  const saveRev = (d) => (d && d.novelistSave && Number(d.novelistSave.rev)) || 0;
  const saveSchema = (d) => (d && d.novelistSave && Number(d.novelistSave.schema)) || 0;
  function parseRemote(text) {
    const raw = JSON.parse(text);
    const cover = raw.cover || null;
    const data = migrateOldData(raw);
    const json = JSON.stringify({ ...data, cover });
    return { data, cover, json, hash: contentHash(data, cover), rev: saveRev(data), schema: saveSchema(data) };
  }
  const isOnline = () => navigator.onLine !== false;
  const editorVisible = () => !el("editorView").classList.contains("hidden");
  const dashVisible = () => !el("dashboardView").classList.contains("hidden");
  const isOpen = (p) => p && currentProjectId === p.id && editorVisible();
  const nowTime = () => new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
  function isAuthError(e) { return !!e && (e.code === "auth" || /Sesi Google berakhir|Belum login/i.test(e.message || "")); }
  function isNetError(e) { return !!e && (e.name === "TypeError" || e.code === "offline" || !isOnline()); }
  function syncError(code, msg) { const e = new Error(msg); e.code = code; return e; }
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsDel = (k) => { try { localStorage.removeItem(k); } catch (e) { /* storage diblokir */ } };

  // ------------------------------------------------------------------ IndexedDB
  let dbPromise = null;
  function db() {
    if (S.wiped) return Promise.reject(new Error("data lokal sudah dihapus"));
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        let req;
        try { req = indexedDB.open(DB_NAME, 1); } catch (e) { reject(e); return; }
        req.onupgradeneeded = () => {
          const d = req.result;
          if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: "key" }).createIndex("account", "account");
          if (!d.objectStoreNames.contains(META)) d.createObjectStore(META);
        };
        req.onsuccess = () => {
          const d = req.result;
          d.onversionchange = () => { d.close(); dbPromise = null; };
          resolve(d);
        };
        req.onerror = () => reject(req.error);
        req.onblocked = () => reject(new Error("IndexedDB sedang dipakai tab lain"));
      });
      dbPromise.catch(() => { dbPromise = null; });
    }
    return dbPromise;
  }
  function tx(store, mode, run) {
    return db().then((d) => new Promise((resolve, reject) => {
      const t = d.transaction(store, mode);
      const req = run(t.objectStore(store));
      let out;
      if (req) req.onsuccess = () => { out = req.result; };
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error("transaksi dibatalkan"));
    }));
  }
  const metaGet = (k) => tx(META, "readonly", (s) => s.get(k)).catch(() => null);
  const metaSet = (k, v) => (S.wiped ? Promise.resolve() : tx(META, "readwrite", (s) => s.put(v, k)).catch((e) => console.warn("[Sync]", e)));
  const recKey = (id) => (S.account || "local") + "|" + id;
  const readRecord = (id) => tx(STORE, "readonly", (s) => s.get(recKey(id))).catch(() => null);

  function buildRecord(p, extra) {
    const json = payloadJson(p);
    return {
      key: recKey(p.id), account: S.account || "local", id: p.id,
      title: p.title, description: p.description || "", template: p.template || "standard",
      colorA: p.colorA, colorB: p.colorB, driveFileId: p.driveFileId || null, updatedAt: p.updatedAt,
      base: p._base || null, syncedHash: p._syncedHash || null, syncedRev: p._syncedRev || 0, edited: !!p._edited,
      json, hash: localHash(p), hv: HASH_V, pendingTrash: false, savedAt: Date.now(), tab: TAB_ID, rev: 0, ...(extra || {}),
    };
  }
  // Tulis project ke IndexedDB dengan compare-and-set: kalau tab lain sudah menulis revisi yang lebih baru dari yang
  // terakhir dilihat tab ini, record TIDAK ditimpa — onLocalClash yang memutuskan (gabung status / ambil / konflik).
  // Nomor suntingan record (erev) hanya naik kalau isinya berisi suntingan (ketikan, versi Drive yang diambil, salinan
  // darurat, ...), tidak saat cuma status sinkron yang berubah (selesai unggah). Revisi tab lain yang erev-nya tidak lebih
  // baru dari yang sudah dilihat di sini = tidak ada suntingan baru di sana -> digabung (status sinkronnya diambil), bukan
  // konflik. Record tanpa erev (versi lama) selalu dianggap suntingan.
  // opts.force = tetap tulis (pengguna memilih "pakai versi tab ini"); opts.meta = hanya status sinkron yang berubah.
  // Hasil: "ok" | "clash" | "skip".
  function persistLocal(p, extra, opts) {
    if (S.wiped || !p) return Promise.resolve("skip");
    if (p._readOnly && !(extra && extra.pendingTrash)) return Promise.resolve("skip");
    const seq = p._editSeq || 0;
    const rec = buildRecord(p, extra);
    const bump = !(opts && opts.meta) || unsaved(p) || !!p._rescued;
    let merged = false;
    return db().then((d) => new Promise((resolve, reject) => {
      const t = d.transaction(STORE, "readwrite"), s = t.objectStore(STORE);
      let clash = null;
      const g = s.get(rec.key);
      g.onsuccess = () => {
        const cur = g.result, curRev = (cur && cur.rev) || 0;
        const curE = !cur ? 0 : typeof cur.erev === "number" ? cur.erev : Infinity;
        if (cur && !(opts && opts.force) && cur.tab !== TAB_ID && curRev > (p._rev || 0) && !cur.pendingTrash) {
          if (curE > (p._erev || 0)) { clash = cur; return; }
          // tab lain hanya mencatat status sinkron (mis. selesai mengunggah): status sinkron terbarunya ikut dipakai
          // (kecuali tulisan ini sendiri hasil sinkron — status itu yang terbaru)
          if (!(opts && opts.meta) && cur.base && (!rec.base || String(cur.base) > String(rec.base))) {
            rec.base = cur.base; rec.syncedHash = cur.syncedHash || null; rec.syncedRev = cur.syncedRev || 0; merged = true;
          }
          if (!(opts && opts.meta) && cur.driveFileId && !rec.driveFileId) { rec.driveFileId = cur.driveFileId; merged = true; }
        }
        rec.rev = Math.max(curRev, p._rev || 0) + 1;
        const e0 = Math.max(curE === Infinity ? 0 : curE, p._erev || 0);
        rec.erev = bump ? e0 + 1 : e0;
        s.put(rec);
      };
      t.oncomplete = () => resolve(clash);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error("transaksi dibatalkan"));
    })).then((clash) => {
      S.localOk = true;
      if (clash) { onLocalClash(p, clash); return "clash"; }
      if (merged) { p._base = rec.base; p._syncedHash = rec.syncedHash; p._syncedRev = rec.syncedRev; p.driveFileId = rec.driveFileId; }
      p._rev = rec.rev;
      p._erev = rec.erev;
      p._localHash = rec.hash;
      if (seq > (p._persistSeq || 0)) p._persistSeq = seq;
      if (!unsaved(p)) dropRescue(p);
      announce({ t: "saved", id: p.id, rev: rec.rev, hash: rec.hash });
      return "ok";
    }, (e) => { S.localOk = false; throw e; });
  }
  function deleteLocal(id) {
    if (S.wiped) return Promise.resolve();
    lsDel(RESCUE_PREFIX + recKey(id));
    announce({ t: "deleted", id });
    return tx(STORE, "readwrite", (s) => s.delete(recKey(id))).catch((e) => console.warn("[Sync]", e));
  }
  function recordToProject(r) {
    const parsed = JSON.parse(r.json);
    // data lama (sebelum ada tanda "edited"): anggap berubah kalau isinya beda dari versi yang terakhir disinkron
    const edited = typeof r.edited === "boolean" ? r.edited : (!!r.syncedHash && hash(r.json) !== r.syncedHash);
    const cover = parsed.cover || null;
    const data = migrateOldData(parsed);
    const ch = r.hv === HASH_V && r.hash ? r.hash : contentHash(data, cover);
    return {
      id: r.id, title: r.title || data.title || "Tanpa Judul", description: r.description || "", template: r.template || "standard",
      cover, colorA: r.colorA, colorB: r.colorB, driveFileId: r.driveFileId || null, updatedAt: r.updatedAt || new Date().toISOString(),
      data, _base: r.base || null, _syncedHash: recSyncedHash({ ...r, edited }, ch), _syncedRev: r.syncedRev || 0, _edited: edited,
      _rev: r.rev || 0, _erev: r.erev || 0, _localHash: ch, _editSeq: 0, _persistSeq: 0, _readOnly: saveSchema(data) > SCHEMA,
    };
  }
  async function loadLocalProjects() {
    let recs = [];
    try { recs = (await tx(STORE, "readonly", (s) => s.index("account").getAll(S.account || "local"))) || []; }
    catch (e) { console.warn("[Sync] gagal membaca data lokal", e); S.localOk = false; }
    S.pendingTrash = new Map();
    const list = [];
    for (const r of recs) {
      if (r.pendingTrash) { S.pendingTrash.set(r.driveFileId || "local:" + r.id, r); continue; }
      try { list.push(recordToProject(r)); } catch (e) { console.warn("[Sync] data lokal rusak dilewati:", r.id, e); }
    }
    const rescued = applyRescues(list, recs);
    // project yang sudah ada di memori (mis. baru dibuat) dipertahankan
    const extra = projects.filter((p) => !list.some((x) => x.id === p.id));
    projects = list.concat(extra);
    sortProjects();
    for (const p of rescued) {
      await persistLocal(p, null, { force: true }).catch((e) => console.warn("[Sync] salinan darurat belum bisa disimpan", e));
    }
    if (rescued.length) toast(rescued.length === 1 ? `Tulisan terakhir di "${rescued[0].title}" dipulihkan dari salinan darurat.` : `${rescued.length} project dipulihkan dari salinan darurat.`, tiIcon("device-floppy"));
  }
  function sortProjects() { projects.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""))); }

  // ------------------------------------------------------------------ salinan darurat (localStorage, sinkron)
  // Dipanggil app.js saat beforeunload / pagehide / tab disembunyikan, SETELAH ketikan di kolom edit dimasukkan
  // (flushCurrentEdits). IndexedDB async bisa tidak sempat selesai saat halaman ditutup; localStorage langsung tertulis.
  function emergencySave() {
    if (S.wiped) return;
    for (const p of projects) {
      if (!p || p._deleted || p._readOnly || !unsaved(p)) continue;
      try {
        const rec = buildRecord(p, { rev: p._rev || 0, rescueSeq: p._editSeq || 0, edited: true });
        localStorage.setItem(RESCUE_PREFIX + rec.key, JSON.stringify(rec));
        p._rescued = true;
      } catch (e) { console.warn("[Sync] salinan darurat gagal (penyimpanan penuh / diblokir)", e); }
      persistNow(p);   // dicoba juga; kalau sempat selesai, salinan darurat dihapus
    }
  }
  function dropRescue(p) { if (p._rescued) { lsDel(RESCUE_PREFIX + recKey(p.id)); p._rescued = false; } }
  // salinan darurat yang lebih baru dari record IndexedDB -> dipakai (ditandai berubah, lalu disimpan & diunggah)
  function applyRescues(list, recs) {
    const pre = RESCUE_PREFIX + (S.account || "local") + "|", found = [];
    try {
      for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.indexOf(pre) === 0) found.push(k); }
    } catch (e) { return []; }
    const out = [];
    for (const k of found) {
      let r = null;
      try { r = JSON.parse(lsGet(k) || "null"); } catch (e) { r = null; }
      if (!r || !r.json || !r.id) { lsDel(k); continue; }
      const cur = recs.find((x) => x.key === r.key);
      let use = !cur;
      if (cur && cur.pendingTrash) { lsDel(k); continue; }   // dihapus sesudahnya
      if (cur && !use) {
        const curHash = recHash(cur);
        if (curHash === r.hash) { lsDel(k); continue; }       // sudah sama
        if (cur.tab === r.tab) {                              // tab yang sama menulis lagi sesudahnya -> record sudah memuat semuanya
          if ((r.savedAt || 0) < (cur.savedAt || 0)) { lsDel(k); continue; }
          use = true;
        } else use = (r.rev || 0) >= (cur.rev || 0);          // dasarnya masih revisi terbaru
        if (!use) {
          // tab lain menulis sesudah salinan ini dibuat: dua-duanya disimpan (salinan jadi project baru)
          try {
            const copy = recordToProject({ ...r, id: r.id + "-pulih-" + Date.now().toString(36), driveFileId: null, base: null, syncedHash: null, syncedRev: 0, rev: 0 });
            copy.title = copy.title + " (dipulihkan)"; copy.data.title = copy.title; copy._edited = true; copy._rescued = true;
            list.push(copy); out.push(copy);
          } catch (e) { console.warn("[Sync] salinan darurat rusak", e); }
          lsDel(k);
          continue;
        }
      }
      try {
        const p = recordToProject({ ...r, rev: cur ? cur.rev || 0 : 0 });
        p._edited = true; p._rescued = true;
        const i = list.findIndex((x) => x.id === p.id);
        if (i >= 0) list[i] = p; else list.push(p);
        out.push(p);
      } catch (e) { console.warn("[Sync] salinan darurat rusak", e); lsDel(k); }
    }
    return out;
  }

  // ------------------------------------------------------------------ simpan lokal per suntingan (debounce)
  function schedulePersist(p) {
    if (!p || S.wiped) return;
    const st = T.get(p) || {};
    T.set(p, st);
    const now = Date.now();
    if (!st.first) st.first = now;
    clearTimeout(st.timer);
    st.timer = setTimeout(() => persistNow(p), now - st.first >= PERSIST_MAX_MS ? 0 : PERSIST_MS);
  }
  function persistNow(p) {
    const st = T.get(p) || {};
    T.set(p, st);
    clearTimeout(st.timer); st.timer = 0; st.first = 0;
    if (!p || p._conflict || p._deleted || p._readOnly || S.wiped) return Promise.resolve();
    if (st.running) { st.again = true; return st.running; }
    st.running = persistLocal(p)
      .catch((e) => { console.error("[Sync] simpan di perangkat gagal", e); })
      .then(() => {
        st.running = null;
        if (st.again) { st.again = false; if (unsaved(p)) return persistNow(p); }
        showStatus(p);
      });
    return st.running;
  }
  // semua suntingan yang belum masuk IndexedDB ditulis sekarang (mis. sebelum aplikasi Android dijeda)
  function flushLocal() {
    if (isOpen(getProject(currentProjectId))) flushCurrentEdits();
    return Promise.all(projects.filter((p) => p && unsaved(p)).map(persistNow));
  }

  // ------------------------------------------------------------------ beberapa tab di browser yang sama
  let chan = null;
  try { if (typeof BroadcastChannel === "function") chan = new BroadcastChannel("novelist-sync"); } catch (e) { chan = null; }
  function announce(m) {
    if (!chan || S.wiped) return;
    try { chan.postMessage({ ...m, account: S.account || "local", tab: TAB_ID }); } catch (e) { /* abaikan */ }
  }
  if (chan) chan.onmessage = (e) => { onTabMessage(e.data).catch((err) => console.warn("[Sync]", err)); };
  async function onTabMessage(m) {
    if (!m || m.tab === TAB_ID || S.wiped || m.account !== (S.account || "local")) return;
    const p = getProject(m.id);
    if (m.t === "deleted") {
      if (p && !isOpen(p) && !unsaved(p) && !p._edited) { projects = projects.filter((x) => x !== p); if (dashVisible()) renderDashboard(); }
      return;
    }
    if (m.t !== "saved") return;
    if (!p) {   // project baru dari tab lain
      const rec = await readRecord(m.id);
      if (!rec || rec.pendingTrash || getProject(m.id)) return;
      try { projects.push(recordToProject(rec)); sortProjects(); if (dashVisible()) renderDashboard(); } catch (e) { /* abaikan */ }
      return;
    }
    if ((m.rev || 0) > (p._rev || 0)) await syncFromLocal(p);
  }
  // record IndexedDB lebih baru dari yang dipegang tab ini (ditulis tab lain)
  async function syncFromLocal(p) {
    if (!p || p._conflict) return;
    const rec = await readRecord(p.id);
    if (!rec || (rec.rev || 0) <= (p._rev || 0)) return;
    if (rec.pendingTrash) {
      if (!unsaved(p) && !p._edited && !isOpen(p)) { projects = projects.filter((x) => x !== p); if (dashVisible()) renderDashboard(); }
      return;
    }
    if (recHash(rec) === p._localHash) { mergeMeta(p, rec); return; }                  // tab lain hanya mencatat status sinkron
    // tidak ada suntingan baru di tab lain (hanya unggah / tampilan modul disusun ulang): cukup gabung status sinkron
    if (typeof rec.erev === "number" && rec.erev <= (p._erev || 0)) { mergeMeta(p, rec); return; }
    if (unsaved(p) || (isOpen(p) && flushChanges(p))) return persistNow(p);          // di sini juga ada suntingan -> konflik
    adoptRecord(p, rec);
  }
  // isi sama, tab lain hanya memperbarui status sinkron (base / file Drive): ambil yang lebih baru
  function mergeMeta(p, rec) {
    p._rev = rec.rev || 0;
    if (typeof rec.erev === "number" && rec.erev > (p._erev || 0)) p._erev = rec.erev;
    if (rec.base && (!p._base || String(rec.base) > String(p._base))) {
      p._base = rec.base; p._syncedHash = recSyncedHash(rec, p._localHash); p._syncedRev = rec.syncedRev || 0;
      if (!rec.edited && !unsaved(p)) p._edited = false;
    }
    if (rec.driveFileId && !p.driveFileId) p.driveFileId = rec.driveFileId;
    showStatus(p); refreshState();
  }
  // ketikan di kolom edit yang belum masuk -> masukkan; true kalau ada yang berubah
  function flushChanges(p) { const seq = p._editSeq || 0; flushCurrentEdits(); return (p._editSeq || 0) !== seq; }
  function recordRemote(rec) {
    const r = parseRemote(rec.json);
    return { ...r, rec };
  }
  function adoptRecord(p, rec) {
    let r;
    try { r = recordRemote(rec); } catch (e) { console.warn("[Sync] record tab lain rusak", e); return false; }
    replaceData(p, r.data, r.cover, {
      title: rec.title || r.data.title || p.title, description: rec.description || p.description || "",
      driveFileId: rec.driveFileId || p.driveFileId || null, updatedAt: rec.updatedAt || p.updatedAt,
      _base: rec.base || null, _syncedHash: recSyncedHash(rec, r.hash), _syncedRev: rec.syncedRev || 0, _edited: !!rec.edited,
      _rev: rec.rev || 0, _erev: typeof rec.erev === "number" ? rec.erev : (p._erev || 0) + 1, _localHash: r.hash,
    });
    return true;
  }

  // ------------------------------------------------------------------ akun
  function setAccount(user) {
    if (!user || !user.permissionId) return;
    S.account = user.permissionId;
    metaSet("lastAccount", { permissionId: user.permissionId, emailAddress: user.emailAddress || "", displayName: user.displayName || "", photoLink: user.photoLink || "" });
  }
  async function ensureAccount() {
    if (accountInfo && accountInfo.user && accountInfo.user.permissionId) { setAccount(accountInfo.user); return; }
    try {
      const about = await (await driveFetch(`${DRIVE_API}/about?fields=user(displayName,emailAddress,photoLink,permissionId)`)).json();
      setAccount(about.user);
    } catch (e) {
      const last = await metaGet("lastAccount");
      if (last && last.permissionId) S.account = last.permissionId;
      else throw e;
    }
  }
  // dipakai novelist-android.js saat aplikasi dibuka tanpa internet
  async function restoreLastAccount() {
    const last = await metaGet("lastAccount");
    if (!last || !last.permissionId) return null;
    S.account = last.permissionId;
    return last;
  }
  // login ulang harus dengan akun yang sama (project di perangkat ini milik akun itu)
  async function sameAccount() {
    if (!S.account) return true;
    try {
      const about = await (await driveFetch(`${DRIVE_API}/about?fields=user(emailAddress,permissionId)`)).json();
      if (about && about.user && about.user.permissionId && about.user.permissionId !== S.account) {
        accessToken = null;
        if (typeof tokenExpiresAt !== "undefined") tokenExpiresAt = 0;
        S.needLogin = true;
        const last = await metaGet("lastAccount");
        toast(`Login dengan akun Google yang sama${last && last.emailAddress ? " (" + last.emailAddress + ")" : ""} — project di sini milik akun itu.`, tiIcon("alert-triangle"));
        refreshState();
        return false;
      }
    } catch (e) { /* belum bisa dicek: biarkan, sinkron berikutnya yang menilai */ }
    return true;
  }

  // ------------------------------------------------------------------ indikator status
  // dashboard (#syncIndicator)
  const STATES = {
    synced:  { icon: "cloud-check",  text: "Tersinkron ke Drive",              color: "var(--success)" },
    syncing: { icon: "loader-2",     text: "Menyinkronkan…",                   color: "var(--text-dim)" },
    local:   { icon: "device-floppy",text: "Tersimpan di perangkat",           color: "var(--text-dim)" },
    offline: { icon: "cloud-x",      text: "Offline — tersimpan di perangkat", color: "var(--text-dim)" },
    login:   { icon: "alert-triangle", text: "Perlu login ulang",              color: "var(--danger)" },
    error:   { icon: "alert-triangle", text: "Gagal sinkron — coba lagi",      color: "var(--danger)" },
  };
  function setState(state) {
    S.state = state;
    const ind = el("syncIndicator");
    if (!ind) return;
    const st = STATES[state] || STATES.synced;
    const text = state === "local" && !S.localOk ? "Belum tersinkron" : st.text;
    ind.innerHTML = `${tiPx(tiIcon(st.icon), 14)}<span>${escapeHtml(text)}</span>`;
    ind.style.color = st.color;
    ind.style.cursor = "pointer";
    ind.classList.toggle("ns-spin", state === "syncing");
    ind.title = state === "synced" ? "Klik untuk sinkron sekarang" : state === "login" ? "Klik untuk login ulang — tulisanmu tetap aman di perangkat ini" : text;
  }
  function pendingCount() { return projects.filter((p) => p && !p._deleted && isChanged(p)).length + S.pendingTrash.size; }
  // ada yang belum sampai ke Drive (peringatan saat menutup tab)
  function hasPending() {
    if (S.wiped || !S.account) return false;
    return projects.some((p) => p && !p._deleted && (isChanged(p) || unsaved(p)));
  }
  function refreshState() {
    if (S.busy > 0) setState("syncing");
    else if (S.needLogin) setState("login");
    else if (!isOnline()) setState("offline");
    else if (S.state === "error") setState("error");
    else setState(pendingCount() ? "local" : "synced");
    showStatus();
  }
  function begin() { S.busy++; if (S.busy === 1) setState("syncing"); }
  function end() { S.busy = Math.max(0, S.busy - 1); if (S.busy === 0) refreshState(); }

  // status di editor (#saveStatus) dihitung dari keadaan project yang terbuka
  function editorStatus(p) {
    const icon = (n) => tiIcon(n);
    if (p._readOnly) return ["Hanya baca — muat ulang halaman", icon("alert-triangle"), "readonly"];
    if (p._conflict) return ["Versi berbeda — pilih versi", icon("alert-triangle"), "conflict"];
    if (!isChanged(p) && !unsaved(p)) return ["Tersinkron ke Drive" + (p._syncedAt ? " · " + p._syncedAt : ""), icon("cloud-check"), "synced"];
    if (unsaved(p) && S.localOk) return ["Menyimpan…", null, "saving"];
    const safe = S.localOk;   // aman di perangkat (IndexedDB bisa dipakai) — kalau tidak, jangan pernah bilang "tersimpan"
    if (S.needLogin || (!accessToken && isOnline() && S.account)) return [safe ? "Perlu login ulang" : "Perlu login ulang — belum tersimpan", icon("alert-triangle"), "login"];
    if (!isOnline()) return safe ? ["Offline — tersimpan di perangkat", icon("cloud-x"), "offline"] : ["Offline — belum tersimpan", icon("alert-triangle"), "error"];
    if (S.state === "error") return ["Gagal sinkron — coba lagi", icon("alert-triangle"), "error"];
    if (!safe) return ["Menyimpan…", null, "saving"];
    return ["Tersimpan di perangkat", icon("device-floppy"), "local"];
  }
  function showStatus(p) {
    p = p || getProject(currentProjectId);
    hasUnsyncedChanges = hasPending();
    if (!p || currentProjectId !== p.id || !el("saveStatus")) return;
    const [text, ic, state] = editorStatus(p);
    if (typeof setSaveStatus === "function") setSaveStatus(text, ic, state);
    else el("saveStatus").innerHTML = (ic ? tiPx(ic, 13) : "") + escapeHtml(text);   // app.js lama
  }
  function scheduleRetry() {
    clearTimeout(S.retryTimer);
    S.retryDelay = Math.min(RETRY_MAX_MS, Math.max(RETRY_MIN_MS, S.retryDelay * 2));
    S.retryTimer = setTimeout(() => { if (isOnline() && !S.needLogin) syncAll(); }, S.retryDelay);
  }
  function resetRetry() { S.retryDelay = 0; clearTimeout(S.retryTimer); }
  function handleError(e, p) {
    if (isAuthError(e)) {
      S.needLogin = true;
    } else if (isNetError(e)) {
      scheduleRetry();
    } else {
      console.error("[Sync]", e);
      S.state = "error";
      scheduleRetry();
    }
    if (p) showStatus(p);
  }

  // ------------------------------------------------------------------ akses Drive
  // app.js baru: driveFetch sudah memperpanjang token sendiri (hook Android / GIS web) + mengulang sekali saat 401.
  // app.js lama: perpanjangan dilakukan di sini lewat hooks.refreshToken.
  const origDriveFetch = driveFetch;
  const appRefreshes = typeof refreshAccessToken === "function";
  function refreshToken(force) {
    if (hooks.refreshToken) return Promise.resolve().then(() => hooks.refreshToken(force)).then((ok) => !!ok, () => false);
    if (typeof driveRefreshToken === "function") return driveRefreshToken();
    return Promise.resolve(false);
  }
  window.driveFetch = async function (url, options = {}) {
    if (!appRefreshes) {
      if (!accessToken) await refreshToken(false);
      if (!accessToken) throw syncError("auth", "Belum login ke Google");
    }
    try {
      const res = await origDriveFetch(url, options);
      if (S.needLogin) { S.needLogin = false; refreshState(); }
      return res;
    } catch (e) {
      if (!appRefreshes && isAuthError(e) && hooks.refreshToken) {
        const ok = await refreshToken(true);
        if (ok && accessToken) return origDriveFetch(url, options);
      }
      if (isAuthError(e) && !e.code) e.code = "auth";
      throw e;
    }
  };
  async function driveReady() {
    if (!isOnline()) return false;
    if (!accessToken) await refreshToken(false);
    return !!accessToken;
  }
  async function fileMeta(id) {
    try {
      return await (await driveFetch(`${DRIVE_API}/files/${encodeURIComponent(id)}?fields=id,name,modifiedTime,trashed,parents`)).json();
    } catch (e) {
      if (/Drive API error 404/.test(e.message || "")) return null;
      throw e;
    }
  }
  async function listAll(folderId) {
    const out = [];
    let pageToken = "";
    const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
    do {
      const url = `${DRIVE_API}/files?q=${q}&fields=nextPageToken,files(id,name,modifiedTime)&pageSize=200${pageToken ? "&pageToken=" + encodeURIComponent(pageToken) : ""}`;
      const data = await (await driveFetch(url)).json();
      out.push(...(data.files || []));
      pageToken = data.nextPageToken || "";
    } while (pageToken);
    return out;
  }
  // file dianggap "dihapus" kalau sudah tidak ada, di Trash Google Drive, atau ada di folder Trash Novelist
  async function isGoneRemote(meta) {
    if (!meta || meta.trashed) return true;
    const parents = meta.parents || [];
    const mainId = await getOrCreateFolder(DRIVE_FOLDER_NAME, "main");
    if (parents.includes(mainId)) return false;
    const trashId = await getOrCreateFolder(DRIVE_TRASH_FOLDER_NAME, "trash");
    return parents.includes(trashId);
  }
  async function backupJson(title, json, tag) {
    const folderId = await getOrCreateFolder(DRIVE_BACKUP_FOLDER_NAME, "backup");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await driveUpload(`${title}__${stamp}.novj`, json, null, folderId);
    console.info("[Sync] backup", tag, title);
  }

  // ------------------------------------------------------------------ antrean per project
  // semua operasi Drive untuk satu project dijalankan berurutan (tidak ada dua upload yang balapan / file ganda)
  const queues = new Map();
  function enqueue(p, job) {
    const prev = queues.get(p.id) || Promise.resolve();
    const next = prev.catch(() => {}).then(job);
    queues.set(p.id, next);
    next.catch(() => {}).then(() => { if (queues.get(p.id) === next) queues.delete(p.id); });
    return next;
  }
  // upload digabung: selama satu upload menunggu giliran, permintaan berikutnya ikut upload yang sama (data terbaru)
  function scheduleUpload(p) {
    if (p._uploadPending) return p._uploadPending;
    p._uploadPending = enqueue(p, () => { p._uploadPending = null; return pushProject(p); });
    return p._uploadPending;
  }

  async function pushProject(p) {
    if (!p || p._deleted || p._conflict || p._readOnly || !projects.includes(p)) return;
    if (p.driveFileId && !isChanged(p)) { showStatus(p); refreshState(); return; }
    if (!(await driveReady())) {
      if (isOnline()) S.needLogin = true;
      showStatus(p); refreshState();
      return;
    }
    begin();
    p._uploading = true;
    try {
      const folderId = await getOrCreateFolder(DRIVE_FOLDER_NAME, "main");
      if (p.driveFileId) {
        const meta = await fileMeta(p.driveFileId);
        if (await isGoneRemote(meta)) {
          // dihapus dari perangkat lain padahal di sini ada perubahan -> simpan sebagai file baru (tidak hilang)
          p.driveFileId = null; p._base = null; p._syncedHash = null;
          toast(`"${p.title}" sudah dihapus di perangkat lain — versi di perangkat ini disimpan lagi ke Drive.`, tiIcon("cloud-upload"));
        } else if (meta.modifiedTime !== p._base) {
          const r = await reconcile(p, meta);
          if (r !== "push") return;
        }
      }
      if (isOpen(p)) flushCurrentEdits();   // ketikan terakhir ikut terkirim
      const rev = Math.max(saveRev(p.data), p._syncedRev || 0) + 1;
      p.data.novelistSave = { rev, schema: SCHEMA, by: NovelistSync.deviceLabel, at: new Date().toISOString() };
      const json = payloadJson(p), sentHash = localHash(p);
      const seq = p._editSeq || 0, sentData = p.data;
      const result = await driveUpload(p.title + ".novj", json, p.driveFileId, folderId);
      if (p._deleted) {
        // dihapus saat upload ini berjalan: jangan biarkan file-nya tertinggal di folder utama
        try { await driveMoveFile(result.id, folderId, await getOrCreateFolder(DRIVE_TRASH_FOLDER_NAME, "trash")); } catch (e) { console.error(e); }
        return;
      }
      p.driveFileId = result.id;
      p._base = result.modifiedTime;
      p._syncedHash = sentHash;
      p._syncedRev = rev;
      p._syncedAt = nowTime();
      // ada ketikan baru selama upload / isinya diganti versi tab lain -> tetap ditandai berubah
      if ((p._editSeq || 0) === seq && p.data === sentData) { p._edited = false; dropRescue(p); }
      p.updatedAt = new Date().toISOString();
      S.state = "idle";
      resetRetry();
      await persistLocal(p, null, { meta: true }).catch((e) => console.warn("[Sync]", e));
      if (dashVisible()) renderDashboard();
    } catch (e) {
      handleError(e, p);
    } finally {
      p._uploading = false;
      end();
      showStatus(p);
    }
  }

  // Drive berubah sejak sinkron terakhir. Hasil: "same" | "pulled" | "push" | "copy" | "defer" | "readonly"
  // (sudah ditangani di sini kecuali "push")
  async function reconcile(p, meta) {
    // tab lain di browser ini mungkin sudah menyinkronkan versi Drive ini (kabar BroadcastChannel terlewat, mis. tab
    // dibekukan): ambil dulu record IndexedDB terbarunya, supaya suntingan tab lain tidak dikira suntingan di sini
    await syncFromLocal(p).catch((e) => console.warn("[Sync]", e));
    if (p._conflict) return "defer";
    if (meta.modifiedTime === p._base) return isChanged(p) ? "push" : "same";
    if (isOpen(p)) flushCurrentEdits();
    const seq0 = p._editSeq || 0;
    const remote = parseRemote(await driveGetContent(p.driveFileId));
    if (isOpen(p)) flushCurrentEdits();   // ketikan selama versi Drive diunduh = suntingan
    const edited = !!p._edited || (p._editSeq || 0) !== seq0;
    const lh = localHash(p);
    if (remote.hash === lh) {                       // isinya sudah sama
      p._base = meta.modifiedTime; p._syncedHash = lh; p._syncedRev = Math.max(p._syncedRev || 0, remote.rev); p._syncedAt = nowTime();
      p._edited = false;
      await persistLocal(p, null, { meta: true }).catch((e) => console.warn("[Sync]", e));
      return "same";
    }
    if (remote.schema > SCHEMA) {                   // ditulis versi Novelist yang lebih baru: jangan diunggah dari sini
      p._readOnly = true;
      showReadOnly(p);
      return "readonly";
    }
    if (!edited) {                                  // di sini tidak ada suntingan -> ambil versi Drive
      if (p._syncedRev && remote.rev < p._syncedRev) return askConflict(p, remote, { kind: "stale", meta });
      if (isOpen(p) && userBusy()) { scheduleRecheck(); return "defer"; }
      const r = await applyRemote(p, remote, meta.modifiedTime, seq0);
      if (r === "pulled") {
        toast(`"${p.title}" diperbarui dengan versi terbaru dari perangkat lain`, tiIcon("cloud-download"));
        return "pulled";
      }
      // ada ketikan tepat sebelum diterapkan -> diperlakukan sebagai suntingan (di bawah)
    }
    if (remote.hash === p._syncedHash) {            // di Drive cuma metadata yang berubah
      p._base = meta.modifiedTime;
      return "push";
    }
    return askConflict(p, remote, { kind: "drive", meta });
  }
  // sedang mengetik / kolom edit kanvas terbuka / kolom teks project masih fokus setelah ketikan baru-baru ini ->
  // versi lain jangan diterapkan dulu (dicek ulang tiap RECHECK_MS)
  function userBusy() {
    const idle = Date.now() - S.lastInput;
    if (S.composing || idle < BUSY_MS) return true;
    const a = document.activeElement;
    if (!a || !a.matches) return false;
    if (a.matches(".jj-edit, .hc-edit")) return true;
    const typing = a.isContentEditable || a.matches("textarea, input:not([type]), input[type=text], input[type=search]");
    return typing && !!a.closest("#editorView") && idle < FOCUS_BUSY_MS;
  }
  function scheduleRecheck() {
    clearTimeout(S.recheckTimer);
    S.recheckTimer = setTimeout(() => { S.recheckTimer = 0; checkOpenProject(); }, RECHECK_MS);
  }

  // ganti isi project dengan versi Drive. expectSeq = nomor suntingan saat keputusan "tidak ada suntingan" dibuat:
  // kalau berubah (ada ketikan baru), TIDAK diterapkan -> "changed".
  async function applyRemote(p, remote, modifiedTime, expectSeq) {
    if (isOpen(p) && expectSeq != null && flushChanges(p)) return "changed";
    if (expectSeq != null && (p._editSeq || 0) !== expectSeq) return "changed";
    replaceData(p, remote.data, remote.cover, {
      title: remote.data.title || p.title, _base: modifiedTime, _syncedHash: remote.hash, _syncedRev: remote.rev,
      _edited: false, updatedAt: modifiedTime || new Date().toISOString(), _syncedAt: nowTime(),
    });
    await persistLocal(p).catch((e) => console.warn("[Sync]", e));
    return "pulled";
  }
  // Ganti p.data + field project, lalu tampilan project yang terbuka dibangun ulang di tab yang sama (scene, item
  // Organize, timeline/peta/papan/jejaring dicari lewat id di data baru). Sinkron, tanpa await di tengah.
  function replaceData(p, data, cover, fields) {
    const open = isOpen(p);
    const view = open ? { sceneId: currentSceneId, orgCat: currentOrgCat, orgItem: currentOrgItemId } : null;
    if (open) {
      if (typeof hideProjectModules === "function") hideProjectModules();
      else ["NovelMap", "NovelQuill", "NovelHome", "NovelJejaring"].forEach((m) => { if (window[m] && typeof window[m].hide === "function") window[m].hide(); });
      el("focusOverlay").classList.add("hidden");   // isinya sudah ikut dibandingkan (flushCurrentEdits)
    }
    p.data = data;
    p.cover = cover;
    Object.assign(p, fields || {});
    p._persistSeq = p._editSeq || 0;   // data diganti: tidak ada suntingan tersisa di memori
    p._readOnly = saveSchema(data) > SCHEMA;
    try { window.dispatchEvent(new CustomEvent("novelist:project-replaced", { detail: { id: p.id } })); } catch (e) { /* abaikan */ }
    if (open && currentProjectId === p.id) {
      closeSceneDrawer();
      openProject(p.id);                                  // tab yang sedang aktif dipulihkan sendiri oleh app.js
      if (view.sceneId && findScene(view.sceneId)) selectScene(view.sceneId);
      const org = view.orgItem && p.data.organize && (p.data.organize[view.orgCat] || []).find((x) => x && x.id === view.orgItem);
      if (org) {
        if (currentOrgCat !== view.orgCat) switchOrganizeCat(view.orgCat);
        currentOrgItemId = view.orgItem; renderOrganizeList(); renderOrganizeDetail();
      }
      if (p._readOnly) showReadOnly(p);
    } else if (dashVisible()) renderDashboard();
  }
  function showReadOnly(p) {
    if (typeof showAppBanner === "function") {
      showAppBanner({ id: "readonly", danger: true, icon: tiIcon("alert-triangle"), action: "Muat ulang", onAction: () => location.reload(),
        text: `"${p.title}" disimpan dengan versi Novelist yang lebih baru. Di sini hanya bisa dibaca — muat ulang halaman untuk memperbarui aplikasi.` });
    } else toast(`"${p.title}" disimpan dengan versi Novelist yang lebih baru — muat ulang aplikasi.`, tiIcon("alert-triangle"));
    showStatus(p);
  }

  // ------------------------------------------------------------------ konflik
  function fmtTime(iso) { try { return formatDateTime(iso); } catch (e) { return iso || ""; } }
  // info.kind: "drive" (diubah di perangkat lain) | "stale" (versi Drive lebih lama dari yang terakhir tersinkron) |
  // "tab" (diubah di tab lain di browser ini)
  function askConflict(p, remote, info) {
    p._conflict = true;
    showStatus(p);
    const device = NovelistSync.deviceLabel;
    const tab = info.kind === "tab";
    const here = tab ? "tab ini" : device, there = tab ? "tab lain" : "Drive";
    return new Promise((resolve) => {
      const m = document.createElement("div");
      m.className = "modal ns-conflict-modal";
      m.innerHTML = `<div class="modal-box" role="alertdialog" aria-modal="true" aria-labelledby="nsConflictTitle">
          <h3 id="nsConflictTitle" class="modal-title-ic">${tiPx(tiIcon("alert-triangle"), 20)}Versi project berbeda</h3>
          <p class="ns-conflict-text"></p>
          <ul class="ns-conflict-list">
            <li><b>Simpan keduanya</b> — versi ${escapeHtml(there)} dipakai di project ini, versi ${escapeHtml(here)} disimpan sebagai project baru.</li>
            <li><b>Pakai versi ${escapeHtml(here)}</b> — menimpa versi ${escapeHtml(there)}.</li>
            <li><b>Pakai versi ${escapeHtml(there)}</b> — perubahan di ${escapeHtml(here)} diganti.</li>
          </ul>
          <p class="field-hint">Versi yang tidak dipakai tetap disimpan di folder backup Drive ("${escapeHtml(DRIVE_BACKUP_FOLDER_NAME)}") bila sedang online.</p>
          <div class="modal-buttons ns-conflict-buttons">
            <button type="button" class="btn-secondary" data-pick="remote">Pakai versi ${escapeHtml(there)}</button>
            <button type="button" class="btn-secondary" data-pick="local">Pakai versi ${escapeHtml(here)}</button>
            <button type="button" class="btn-primary" data-pick="both">Simpan keduanya</button>
          </div>
        </div>`;
      m.querySelector(".ns-conflict-text").textContent = info.kind === "stale"
        ? `Versi "${p.title}" di Drive (${fmtTime(info.meta.modifiedTime)}) lebih lama dari versi terakhir di ${device} — kemungkinan tertimpa oleh tab atau aplikasi Novelist versi lama.`
        : tab ? `"${p.title}" juga diubah di tab lain di browser ini, sementara di tab ini ada perubahan yang belum tersimpan.`
        : `"${p.title}" diubah di perangkat lain (Drive: ${fmtTime(info.meta.modifiedTime)}), sementara di ${device} juga ada perubahan yang belum terkirim.`;
      document.body.appendChild(m);
      const btns = m.querySelectorAll("button[data-pick]");
      btns.forEach((b) => b.onclick = async () => {
        btns.forEach((x) => { x.disabled = true; });
        b.textContent = "Memproses…";
        let result = "same";
        p._conflict = false;
        try { result = await resolveConflict(p, remote, info, b.dataset.pick); }
        catch (e) { handleError(e, p); }
        m.remove();
        showStatus(p); refreshState();
        resolve(result);
      });
    });
  }
  async function resolveConflict(p, remote, info, pick) {
    if (isOpen(p)) flushCurrentEdits();
    const localJson = payloadJson(p);
    const keepCopy = () => backupJson(p.title, localJson, "versi perangkat (konflik)").catch((e) => console.warn("[Sync] backup gagal", e));
    if (info.kind === "tab") {
      if (pick === "local") {
        if (isOnline() && accessToken) backupJson(p.title, remote.json, "versi tab lain (konflik)").catch((e) => console.warn("[Sync] backup gagal", e));
        await persistLocal(p, null, { force: true });
        if (isChanged(p) && isOnline()) scheduleUpload(p);
        return "local";
      }
      if (pick === "remote") {
        if (isOnline() && accessToken) await keepCopy();
        adoptRecord(p, info.rec);
        return "pulled";
      }
    } else {
      if (pick === "local") {
        await backupJson(p.title, remote.json, "versi Drive (konflik)").catch((e) => console.warn("[Sync] backup gagal", e));
        p._base = info.meta.modifiedTime;
        p._syncedRev = Math.max(p._syncedRev || 0, remote.rev);
        markEdited(p);                    // versi ini yang diunggah (juga saat di sini sebenarnya belum diubah)
        persistNow(p);
        return "push";
      }
      if (pick === "remote") {
        await keepCopy();
        await applyRemote(p, remote, info.meta.modifiedTime);
        toast("Versi Drive dipakai. Versi " + NovelistSync.deviceLabel + " disimpan di backup.", tiIcon("history"));
        return "pulled";
      }
    }
    // simpan keduanya: salinan baru berisi versi di sini, project asli memakai versi lain
    const stamp = new Date().toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
    const label = info.kind === "tab" ? "tab lain" : NovelistSync.deviceLabel;
    const copy = createProject(`${p.title} (versi ${info.kind === "tab" ? "tab ini" : label} ${stamp})`, p.description, p.template);
    const parsed = JSON.parse(localJson);
    copy.cover = parsed.cover || null;
    copy.data = migrateOldData(parsed);
    delete copy.data.novelistSave;
    copy.data.title = copy.title;
    copy.colorA = p.colorA; copy.colorB = p.colorB;
    projects.unshift(copy);
    await persistLocal(copy).catch((e) => console.warn("[Sync]", e));
    if (info.kind === "tab") adoptRecord(p, info.rec);
    else await applyRemote(p, remote, info.meta.modifiedTime);
    scheduleUpload(copy);
    toast(`Versi ${info.kind === "tab" ? "tab ini" : label} disimpan sebagai "${copy.title}"`, tiIcon("copy"));
    return "copy";
  }
  // persistLocal bertemu record yang lebih baru dari tab lain
  function onLocalClash(p, rec) {
    if (recHash(rec) === p._localHash) { mergeMeta(p, rec); persistNow(p); return; }   // isi sama (tab lain hanya mengunggah): cukup gabung
    if (!unsaved(p) && !(isOpen(p) && flushChanges(p))) { adoptRecord(p, rec); return; }             // di sini tidak ada suntingan
    if (p._conflict) return;
    let remote;
    try { remote = recordRemote(rec); } catch (e) { console.warn("[Sync] record tab lain rusak — versi tab ini dipakai", e); persistLocal(p, null, { force: true }); return; }
    askConflict(p, remote, { kind: "tab", rec });
  }

  // ------------------------------------------------------------------ sinkron penuh
  let syncAllPromise = null;
  function syncAll() {
    if (!syncAllPromise) syncAllPromise = doSyncAll().finally(() => { syncAllPromise = null; });
    return syncAllPromise;
  }
  async function doSyncAll() {
    if (S.wiped || !S.account) { refreshState(); return; }
    if (!(await driveReady())) {
      if (isOnline()) S.needLogin = true;
      refreshState();
      return;
    }
    begin();
    try {
      S.state = "idle";
      const folderId = await getOrCreateFolder(DRIVE_FOLDER_NAME, "main");
      const files = await listAll(folderId);
      const seen = new Set();
      let added = false;
      for (const f of files) {
        seen.add(f.id);
        if (S.pendingTrash.has(f.id)) continue;
        const p = projects.find((x) => x.driveFileId === f.id);
        if (!p) {                                            // project baru dari perangkat lain
          let remote;
          try { remote = parseRemote(await driveGetContent(f.id)); } catch (e) { console.warn("[Sync] file dilewati:", f.name, e); continue; }
          if (projects.some((x) => x.driveFileId === f.id)) continue;
          const pair = COLOR_PAIRS[Math.floor(Math.random() * COLOR_PAIRS.length)];
          const np = {
            id: "proj-" + f.id, title: remote.data.title || f.name.replace(/\.novj$/, ""), description: "", template: "standard",
            cover: remote.cover, colorA: pair[0], colorB: pair[1], driveFileId: f.id, updatedAt: f.modifiedTime,
            data: remote.data, _base: f.modifiedTime, _syncedHash: remote.hash, _syncedRev: remote.rev, _readOnly: remote.schema > SCHEMA,
          };
          projects.push(np);
          await persistLocal(np).catch((e) => console.warn("[Sync]", e));
          added = true;
          continue;
        }
        if (p._base !== f.modifiedTime) {
          const r = await enqueue(p, () => (p._conflict || p._deleted ? null : reconcile(p, f)));
          if (r === "push") scheduleUpload(p);
        }
      }
      // project lokal yang file Drive-nya tidak ada lagi di folder utama
      for (const p of projects.slice()) {
        if (!p.driveFileId || seen.has(p.driveFileId) || p._deleted) continue;
        await enqueue(p, () => handleMissing(p));
      }
      await processPendingTrash(folderId);
      // project baru / yang berubah saat offline -> unggah
      const uploads = projects.filter((p) => !p._deleted && !p._conflict && !p._readOnly && isChanged(p)).map(scheduleUpload);
      await Promise.all(uploads);
      if (added) sortProjects();
    } catch (e) {
      handleError(e, null);
    } finally {
      end();
      if (dashVisible()) renderDashboard();
    }
  }
  async function handleMissing(p) {
    const meta = await fileMeta(p.driveFileId);
    if (!(await isGoneRemote(meta))) return;               // masih ada (di folder lain) -> biarkan
    if (isChanged(p)) {                                    // ada perubahan yang belum terkirim -> unggah sebagai file baru
      p.driveFileId = null; p._base = null; p._syncedHash = null;
      await persistLocal(p, null, { meta: true }).catch((e) => console.warn("[Sync]", e));
      toast(`"${p.title}" dihapus di perangkat lain — versi di perangkat ini disimpan lagi ke Drive.`, tiIcon("cloud-upload"));
      return;
    }
    p._deleted = true;
    projects = projects.filter((x) => x !== p);
    await deleteLocal(p.id);
    if (isOpen(p)) { toast(`"${p.title}" dihapus dari perangkat lain`, tiIcon("trash")); backToLibrary(); }
  }
  async function processPendingTrash(mainFolderId) {
    if (!S.pendingTrash.size) return;
    const trashId = await getOrCreateFolder(DRIVE_TRASH_FOLDER_NAME, "trash");
    for (const [key, rec] of Array.from(S.pendingTrash.entries())) {
      if (rec.driveFileId) {
        const meta = await fileMeta(rec.driveFileId);
        if (meta && !meta.trashed && (meta.parents || []).includes(mainFolderId)) await driveMoveFile(rec.driveFileId, mainFolderId, trashId);
      }
      S.pendingTrash.delete(key);
      await deleteLocal(rec.id);
    }
  }

  // project yang sedang terbuka: cek apakah di Drive ada versi lebih baru (dipanggil saat app/tab kembali aktif & berkala)
  async function checkOpenProject() {
    const p = getProject(currentProjectId);
    if (!p || !p.driveFileId || !isOpen(p) || p._conflict || !(await driveReady())) return;
    try {
      await enqueue(p, async () => {
        const meta = await fileMeta(p.driveFileId);
        if (!meta || meta.modifiedTime === p._base || (await isGoneRemote(meta))) return;
        const r = await reconcile(p, meta);
        if (r === "push") scheduleUpload(p);
      });
    } catch (e) { handleError(e, p); }
  }
  function onResume() {
    if (S.wiped || !S.account || document.hidden) return;
    const open = getProject(currentProjectId);
    if (open) syncFromLocal(open).catch(() => {});   // tab lain di browser ini mungkin sudah menyimpan versi lebih baru
    const now = Date.now();
    if (now - S.lastResumeCheck < RESUME_THROTTLE_MS) return;
    S.lastResumeCheck = now;
    if (editorVisible()) checkOpenProject().then(() => { if (pendingCount()) syncAll(); });
    else syncAll();
  }

  // status (indikator dashboard / status editor) diketuk: login ulang bila perlu, lalu sinkron sekarang
  async function act() {
    if (S.needLogin || !accessToken) {
      if (!hooks.interactiveLogin) return;
      try { await hooks.interactiveLogin(); }
      catch (e) { toast("Login gagal: " + ((e && (e.error || e.message)) || e), tiIcon("alert-triangle")); refreshState(); return; }
      if (!(await sameAccount())) return;
      S.needLogin = false;
    }
    S.state = "idle";
    resetRetry();
    await syncAll();
    const bad = S.state === "error" || S.needLogin;
    toast(S.state === "error" ? "Sinkron belum berhasil" : S.needLogin ? "Perlu login ulang" : (pendingCount() ? "Sebagian belum tersinkron" : "Semua project tersinkron"),
      tiIcon(bad ? "alert-triangle" : "cloud-check"));
  }

  // ------------------------------------------------------------------ pengganti fungsi app.js
  // Semua suntingan (editor, judul, Organize, Quill, Map, Timeline, Beranda, Jejaring, …) lewat markDirtyAndSchedule.
  const origMarkDirty = markDirtyAndSchedule;
  window.markDirtyAndSchedule = function () {
    const p = getProject(currentProjectId);
    const mine = p && editorVisible();
    if (mine) markEdited(p);
    const r = origMarkDirty.apply(this, arguments);
    if (mine) schedulePersist(p);   // ke perangkat ±1 dtk; upload Drive menyusul lewat autosave app.js
    return r;
  };
  window.saveProjectToDriveMain = async function (p) {
    if (!p || p._deleted || S.wiped) return;
    // dipanggil dari dashboard (ganti sampul, edit project, "kirim ke cloud"): isi yang berbeda = suntingan
    if (!isOpen(p) && p.driveFileId && localHash(p) !== p._syncedHash) markEdited(p);
    if (unsaved(p) || !p._rev) await persistNow(p);
    if (!isOnline()) { showStatus(p); refreshState(); return; }
    return scheduleUpload(p);
  };

  window.loadProjectsFromDrive = async function () {
    el("loadingState").classList.remove("hidden");
    el("emptyState").classList.add("hidden");
    el("btnAddProject").classList.add("hidden");
    try { await ensureAccount(); }
    catch (e) { console.warn("[Sync] akun belum diketahui", e); }
    await loadLocalProjects();
    if (projects.length) renderDashboard();            // tampilkan yang ada di perangkat dulu, lalu sinkron
    await syncAll();
    renderDashboard();
    startPolling();
  };

  window.updateSyncIndicator = function (ok) { if (!ok) S.state = "error"; refreshState(); };

  const origSignOut = driveSignOut;
  window.driveSignOut = function () {
    const unsynced = S.account ? pendingCount() : 0;
    flushLocal();
    origSignOut();
    stopPolling();
    resetRetry();
    S.account = null; S.needLogin = false; S.pendingTrash = new Map();
    metaSet("lastAccount", null);
    if (unsynced && !S.wiped) toast(`${unsynced} project belum tersinkron — tetap tersimpan di perangkat ini & dikirim saat kamu login lagi.`, tiIcon("device-floppy"));
  };

  const origPull = pullFromCloud;
  window.pullFromCloud = async function (f) {
    await origPull(f);
    const p = projects.find((x) => x.driveFileId === f.id);
    if (p) { p._base = f.modifiedTime; p._syncedHash = localHash(p); p._syncedRev = saveRev(p.data); p._edited = false; await persistLocal(p).catch(() => {}); showStatus(p); }
  };

  const origRestore = restoreFromTrash;
  window.restoreFromTrash = async function (f) {
    await origRestore(f);
    const p = projects.find((x) => x.driveFileId === f.id);
    // base sengaja dikosongkan: cek berikutnya membandingkan isi dan langsung cocok tanpa upload ulang
    if (p) { p._base = null; p._syncedHash = localHash(p); p._syncedRev = saveRev(p.data); p._edited = false; await persistLocal(p).catch(() => {}); }
    for (const [key, rec] of Array.from(S.pendingTrash.entries())) if (rec.driveFileId === f.id) S.pendingTrash.delete(key);
  };

  const origCardAction = handleCardMenuAction;
  window.handleCardMenuAction = async function (action) {
    const p = getProject(activeCardMenuProjectId);
    if (action === "delete" && p && (!p.driveFileId || !(await driveReady()))) {
      // hapus tanpa internet (atau project yang belum pernah terkirim): ditandai, dipindah ke Trash Drive saat online
      closeAllDropdowns();
      if (!confirm(`Pindahkan project "${p.title}" ke Trash? Kamu masih bisa memulihkannya nanti dari Cloud Library.`)) return;
      p._deleted = true;
      projects = projects.filter((x) => x !== p);
      if (p.driveFileId) {
        await persistLocal(p, { pendingTrash: true }, { force: true }).catch((e) => console.warn("[Sync]", e));
        S.pendingTrash.set(p.driveFileId, { id: p.id, driveFileId: p.driveFileId });
      } else await deleteLocal(p.id);
      renderDashboard();
      refreshState();
      toast(p.driveFileId ? "Project dipindahkan ke Trash (dikirim ke Drive saat online)" : "Project dihapus", tiIcon("trash"));
      return;
    }
    await origCardAction(action);
    if (action === "delete" && p && !projects.includes(p)) await deleteLocal(p.id);
  };

  const origClearLocal = clearNovelistLocalData;
  window.clearNovelistLocalData = async function () {
    S.wiped = true;
    stopPolling();
    resetRetry();
    try { const d = await dbPromise; if (d) d.close(); } catch (e) { /* abaikan */ }
    dbPromise = null;
    await new Promise((resolve) => {
      let req;
      try { req = indexedDB.deleteDatabase(DB_NAME); } catch (e) { resolve(); return; }
      const t = setTimeout(resolve, 2500);
      req.onsuccess = req.onerror = req.onblocked = () => { clearTimeout(t); resolve(); };
    });
    return origClearLocal();   // localStorage "novelist*" (termasuk salinan darurat) ikut dihapus
  };

  // Mode fokus: isinya ikut di-flush sebelum dibandingkan/diunggah (jaring pengaman; app.js v0.11+ juga menyimpannya
  // langsung saat diketik).
  const origFlush = flushCurrentEdits;
  window.flushCurrentEdits = function () {
    origFlush();
    if (!el("focusOverlay").classList.contains("hidden")) {
      const s = findScene(focusSceneId);
      if (s) { s.title = el("focusTitle").value; s.content = el("focusEditor").innerHTML; }
    }
  };

  // project dibuka: status simpan project itu + versi yang mungkin sudah disimpan tab lain
  const origOpen = openProject;
  window.openProject = function (id) {
    const r = origOpen.apply(this, arguments);
    const p = getProject(id);
    if (p) { showStatus(p); syncFromLocal(p).catch(() => {}); }
    return r;
  };

  // ------------------------------------------------------------------ pemicu
  function startPolling() {
    stopPolling();
    S.pollTimer = setInterval(() => {
      if (document.hidden || !S.account) return;
      if (editorVisible()) checkOpenProject(); else if (dashVisible()) syncAll();
    }, POLL_MS);
  }
  function stopPolling() { clearInterval(S.pollTimer); S.pollTimer = 0; }

  window.addEventListener("online", () => { S.lastResumeCheck = 0; resetRetry(); refreshState(); if (S.account) syncAll(); });
  window.addEventListener("offline", () => refreshState());
  document.addEventListener("visibilitychange", () => { if (!document.hidden) onResume(); });
  window.addEventListener("focus", onResume);
  // ketikan di editor -> versi dari perangkat lain ditunda sebentar (userBusy)
  const noteInput = (e) => { if (e.target && e.target.closest && e.target.closest("#editorView")) S.lastInput = Date.now(); };
  document.addEventListener("keydown", noteInput, true);
  document.addEventListener("input", noteInput, true);
  document.addEventListener("compositionstart", () => { S.composing = true; }, true);
  document.addEventListener("compositionend", () => { S.composing = false; S.lastInput = Date.now(); }, true);

  document.addEventListener("DOMContentLoaded", () => {
    const css = document.createElement("style");
    css.textContent = `
      .sync-indicator.ns-spin .ti { animation: spin .8s linear infinite; }
      .ns-conflict-modal { z-index: 900; }
      .ns-conflict-modal .modal-box { width: 480px; }
      .ns-conflict-text { margin: 0 0 10px; line-height: 1.5; }
      .ns-conflict-list { margin: 0 0 10px; padding-left: 18px; line-height: 1.5; font-size: calc(13px * var(--fs-scale, 1)); color: var(--text-dim); }
      .ns-conflict-list b { color: var(--text); }
      .ns-conflict-buttons { flex-wrap: wrap; }
      @media (max-width: 520px) { .ns-conflict-buttons { flex-direction: column-reverse; } .ns-conflict-buttons button { width: 100%; } }`;
    document.head.appendChild(css);
    const ind = el("syncIndicator");
    if (ind) {
      ind.setAttribute("role", "button");
      ind.tabIndex = 0;
      ind.addEventListener("click", act);
      ind.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); act(); } });
    }
    // di editor: status "Perlu login ulang" / "Gagal sinkron — coba lagi" bisa diketuk (app.js membuatnya bisa diklik)
    const status = el("saveStatus");
    if (status) {
      const go = () => { if (S.needLogin || S.state === "error" || !accessToken || !S.localOk) act(); };
      status.addEventListener("click", go);
      status.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
    }
  });

  // login ulang di web memakai popup Google (butuh klik); di Android diganti novelist-android.js
  hooks.interactiveLogin = () => driveSignIn(false);

  window.NovelistSync = {
    hooks,
    deviceLabel: "web",
    syncAll,
    checkOpenProject,
    restoreLastAccount,
    loadLocalProjects,
    startPolling,
    pendingCount,
    refreshState,
    hasPending,
    emergencySave,
    flushLocal,
    act,
    get state() { return S.state; },
    // untuk pengujian
    _internal: { hash, payloadJson, persistLocal, S, TAB_ID },
  };
})();
