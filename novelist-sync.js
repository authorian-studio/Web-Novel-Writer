/* =====================================================================================================================
   NOVELIST SYNC — simpan di perangkat dulu (bisa offline), lalu sinkron ke Google Drive dengan deteksi konflik.

   Dimuat SETELAH app.js (lihat scripts/build-www.mjs). Tidak ada kode app.js yang diedit: fungsi global app.js yang
   berhubungan dengan penyimpanan diganti/dibungkus dari sini, jadi app.js tetap salinan apa adanya dari situs web.

   Cara kerja
   - Setiap kali app.js menyimpan (autosave, tombol simpan, kembali ke dashboard, dll.) isi project LANGSUNG ditulis ke
     IndexedDB "novelist-sync" di perangkat ini. Setelah itu baru dikirim ke Drive kalau ada internet & sudah login.
     Tanpa internet: tulisan tetap aman di perangkat dan dikirim otomatis begitu online lagi.
   - Tiap project mengingat "base" = modifiedTime file Drive saat terakhir sinkron, dan hash isi saat itu. Sebelum
     mengunggah, modifiedTime di Drive dicek dulu. Kalau berubah (project disunting dari web / HP lain):
       • isi Drive sama dengan isi di sini               -> cukup catat base baru
       • di sini TIDAK ada perubahan                      -> versi Drive diambil (otomatis, tanpa bertanya)
       • di Drive cuma metadata yang berubah              -> versi di sini diunggah
       • dua-duanya berubah                              -> KONFLIK: pengguna memilih (simpan keduanya / pakai versi
         perangkat ini / pakai versi Drive). Versi yang tidak dipakai disimpan dulu ke folder backup Drive.
   - Saat aplikasi/tab kembali dibuka (visibilitychange/focus/online) dan berkala tiap 2 menit, project yang terbuka
     dicek ke Drive, jadi pindah menulis dari HP ke web (dan sebaliknya) langsung memakai versi terbaru.
   - Project yang dihapus saat offline ditandai lalu dipindah ke Trash Drive begitu online.
   - Project yang dihapus di perangkat lain (dipindah ke Trash) ikut hilang di sini, kecuali di sini ada perubahan yang
     belum terkirim — perubahan itu diunggah ulang sebagai file baru supaya tidak hilang.

   Kait dari luar (opsional, dipasang novelist-android.js):
     NovelistSync.hooks.refreshToken(force) -> Promise<boolean>   ambil access token baru tanpa interaksi
     NovelistSync.hooks.interactiveLogin()  -> Promise             login dengan interaksi (saat indikator diklik)
     NovelistSync.deviceLabel                                     "HP" / "web" (nama salinan saat konflik)
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
  const RETRY_MS = 30000;           // coba lagi setelah gagal sinkron
  const RESUME_THROTTLE_MS = 15000; // cek saat app/tab kembali dibuka paling sering tiap 15 dtk

  const hooks = { refreshToken: null, interactiveLogin: null };
  const S = {
    account: null,          // permissionId akun Google yang aktif
    state: "idle",          // synced | syncing | local | offline | login | error
    busy: 0,
    needLogin: false,
    lastResumeCheck: 0,
    retryTimer: 0,
    pollTimer: 0,
    wiped: false,           // data lokal sudah dihapus (Hapus akun) -> jangan tulis apa pun lagi
    pendingTrash: new Map(),// driveFileId -> record yang dihapus saat offline
  };

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
  function localHash(p) { return hash(payloadJson(p)); }
  // "Berubah di perangkat ini" = benar-benar ada suntingan sejak sinkron terakhir (ditandai lewat markDirtyAndSchedule),
  // BUKAN sekadar isi yang berbeda: membuka tab Beranda/Jejaring/Timeline/Map menambahkan struktur bawaan ke data project
  // tanpa ada yang diketik, dan itu tidak boleh dianggap perubahan (kalau dianggap, setiap pindah perangkat jadi konflik).
  function isChanged(p) { return !p.driveFileId || !!p._edited; }
  function markEdited(p) { p._edited = true; p._editSeq = (p._editSeq || 0) + 1; }
  function parseRemote(text) {
    const raw = JSON.parse(text);
    const cover = raw.cover || null;
    const data = migrateOldData(raw);
    const json = JSON.stringify({ ...data, cover });
    return { data, cover, json, hash: hash(json) };
  }
  const isOnline = () => navigator.onLine !== false;
  const editorVisible = () => !el("editorView").classList.contains("hidden");
  const dashVisible = () => !el("dashboardView").classList.contains("hidden");
  const isOpen = (p) => p && currentProjectId === p.id && editorVisible();
  const nowTime = () => new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
  function isAuthError(e) { return !!e && (e.code === "auth" || /Sesi Google berakhir|Belum login/i.test(e.message || "")); }
  function isNetError(e) { return !!e && (e.name === "TypeError" || e.code === "offline" || !isOnline()); }
  function syncError(code, msg) { const e = new Error(msg); e.code = code; return e; }

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

  function persistLocal(p, extra) {
    if (S.wiped || !p) return Promise.resolve();
    const rec = {
      key: recKey(p.id), account: S.account || "local", id: p.id,
      title: p.title, description: p.description || "", template: p.template || "standard",
      colorA: p.colorA, colorB: p.colorB, driveFileId: p.driveFileId || null, updatedAt: p.updatedAt,
      base: p._base || null, syncedHash: p._syncedHash || null, edited: !!p._edited, json: payloadJson(p),
      pendingTrash: false, savedAt: Date.now(), ...(extra || {}),
    };
    return tx(STORE, "readwrite", (s) => s.put(rec));
  }
  function deleteLocal(id) {
    if (S.wiped) return Promise.resolve();
    return tx(STORE, "readwrite", (s) => s.delete(recKey(id))).catch((e) => console.warn("[Sync]", e));
  }
  function recordToProject(r) {
    const parsed = JSON.parse(r.json);
    // data lama (sebelum ada tanda "edited"): anggap berubah kalau isinya beda dari versi yang terakhir disinkron
    const edited = typeof r.edited === "boolean" ? r.edited : (!!r.syncedHash && hash(r.json) !== r.syncedHash);
    const cover = parsed.cover || null;
    const data = migrateOldData(parsed);
    return {
      id: r.id, title: r.title || data.title || "Tanpa Judul", description: r.description || "", template: r.template || "standard",
      cover, colorA: r.colorA, colorB: r.colorB, driveFileId: r.driveFileId || null, updatedAt: r.updatedAt || new Date().toISOString(),
      data, _base: r.base || null, _syncedHash: r.syncedHash || null, _edited: edited,
    };
  }
  async function loadLocalProjects() {
    let recs = [];
    try { recs = (await tx(STORE, "readonly", (s) => s.index("account").getAll(S.account || "local"))) || []; }
    catch (e) { console.warn("[Sync] gagal membaca data lokal", e); }
    S.pendingTrash = new Map();
    const list = [];
    for (const r of recs) {
      if (r.pendingTrash) { S.pendingTrash.set(r.driveFileId || "local:" + r.id, r); continue; }
      try { list.push(recordToProject(r)); } catch (e) { console.warn("[Sync] data lokal rusak dilewati:", r.id, e); }
    }
    // project yang sudah ada di memori (mis. baru dibuat) dipertahankan
    const extra = projects.filter((p) => !list.some((x) => x.id === p.id));
    projects = list.concat(extra);
    sortProjects();
  }
  function sortProjects() { projects.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""))); }

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

  // ------------------------------------------------------------------ indikator status
  const STATES = {
    synced:  { icon: "cloud-check",  text: "Tersinkron",                       color: "var(--success)" },
    syncing: { icon: "loader-2",     text: "Menyinkronkan…",                   color: "var(--text-dim)" },
    local:   { icon: "device-floppy",text: "Tersimpan di perangkat",           color: "var(--text-dim)" },
    offline: { icon: "cloud-x",      text: "Offline — tersimpan di perangkat", color: "var(--text-dim)" },
    login:   { icon: "cloud-x",      text: "Ketuk untuk login & sinkron",      color: "var(--danger)" },
    error:   { icon: "cloud-x",      text: "Gagal sinkron — ketuk untuk coba lagi", color: "var(--danger)" },
  };
  function setState(state) {
    S.state = state;
    const ind = el("syncIndicator");
    if (!ind) return;
    const st = STATES[state] || STATES.synced;
    ind.innerHTML = `${tiPx(tiIcon(st.icon), 14)}<span>${escapeHtml(st.text)}</span>`;
    ind.style.color = st.color;
    ind.style.cursor = "pointer";
    ind.classList.toggle("ns-spin", state === "syncing");
    ind.title = state === "synced" ? "Ketuk untuk sinkron sekarang" : st.text;
  }
  function pendingCount() { return projects.filter(isChanged).length + S.pendingTrash.size; }
  function refreshState() {
    if (S.busy > 0) return setState("syncing");
    if (S.needLogin) return setState("login");
    if (!isOnline()) return setState("offline");
    if (S.state === "error") return setState("error");
    setState(pendingCount() ? "local" : "synced");
  }
  function begin() { S.busy++; if (S.busy === 1) setState("syncing"); }
  function end() { S.busy = Math.max(0, S.busy - 1); if (S.busy === 0) refreshState(); }
  // status di top bar editor
  function editorSaved(p, label, icon) {
    if (!p || currentProjectId !== p.id || firstDirtyAt !== null) return;   // masih ada ketikan yang belum disimpan
    markSaved(label, icon);
  }
  function scheduleRetry() {
    clearTimeout(S.retryTimer);
    S.retryTimer = setTimeout(() => { if (isOnline() && !S.needLogin) syncAll(); }, RETRY_MS);
  }
  function handleError(e, p) {
    if (isAuthError(e)) {
      S.needLogin = true;
      if (p) editorSaved(p, "Tersimpan di perangkat — login untuk sinkron", tiIcon("device-floppy"));
    } else if (isNetError(e)) {
      if (p) editorSaved(p, "Tersimpan di perangkat (offline)", tiIcon("device-floppy"));
      scheduleRetry();
    } else {
      console.error("[Sync]", e);
      S.state = "error";
      if (p) editorSaved(p, "Tersimpan di perangkat — gagal sinkron", tiIcon("alert-triangle"));
      scheduleRetry();
    }
  }

  // ------------------------------------------------------------------ akses Drive
  // driveFetch app.js + ambil token baru otomatis (Android: tanpa interaksi lewat Google Play services)
  const origDriveFetch = driveFetch;
  window.driveFetch = async function (url, options = {}) {
    if (!accessToken && hooks.refreshToken) await hooks.refreshToken(false).catch(() => false);
    if (!accessToken) throw syncError("auth", "Belum login ke Google");
    try {
      const res = await origDriveFetch(url, options);
      if (S.needLogin) { S.needLogin = false; refreshState(); }
      return res;
    } catch (e) {
      if (isAuthError(e) && hooks.refreshToken) {
        const ok = await hooks.refreshToken(true).catch(() => false);
        if (ok && accessToken) return origDriveFetch(url, options);
      }
      throw e;
    }
  };
  async function driveReady() {
    if (!isOnline()) return false;
    if (!accessToken && hooks.refreshToken) await hooks.refreshToken(false).catch(() => false);
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
  // upload digabung: selama satu upload menunggu giliran, permintaan berikutnya ikut upload yang sama
  function scheduleUpload(p) {
    if (p._uploadPending) return p._uploadPending;
    p._uploadPending = enqueue(p, () => { p._uploadPending = null; return pushProject(p); });
    return p._uploadPending;
  }

  async function pushProject(p) {
    if (!p || p._deleted || p._conflict || !projects.includes(p)) return;
    if (p.driveFileId && !isChanged(p)) { editorSaved(p, "Tersimpan " + nowTime()); refreshState(); return; }
    if (!(await driveReady())) {
      if (!isOnline()) editorSaved(p, "Tersimpan di perangkat (offline)", tiIcon("device-floppy"));
      else { S.needLogin = true; editorSaved(p, "Tersimpan di perangkat — login untuk sinkron", tiIcon("device-floppy")); }
      refreshState();
      return;
    }
    begin();
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
      const json = payloadJson(p);
      const seq = p._editSeq || 0;
      const result = await driveUpload(p.title + ".novj", json, p.driveFileId, folderId);
      if (p._deleted) {
        // dihapus saat upload ini berjalan: jangan biarkan file-nya tertinggal di folder utama
        try { await driveMoveFile(result.id, folderId, await getOrCreateFolder(DRIVE_TRASH_FOLDER_NAME, "trash")); } catch (e) { console.error(e); }
        return;
      }
      p.driveFileId = result.id;
      p._base = result.modifiedTime;
      p._syncedHash = hash(json);
      if ((p._editSeq || 0) === seq) p._edited = false;   // ada ketikan baru selama upload -> tetap ditandai berubah
      p.updatedAt = new Date().toISOString();
      S.state = "idle";
      await persistLocal(p).catch((e) => console.warn("[Sync]", e));
      editorSaved(p, "Tersimpan " + nowTime());
      if (dashVisible()) renderDashboard();
    } catch (e) {
      handleError(e, p);
    } finally {
      end();
    }
  }

  // Drive berubah sejak sinkron terakhir. Hasil: "same" | "pulled" | "push" | "copy" (sudah ditangani di sini kecuali "push")
  async function reconcile(p, meta) {
    if (isOpen(p)) flushCurrentEdits();
    const remote = parseRemote(await driveGetContent(p.driveFileId));
    const lh = localHash(p);
    if (remote.hash === lh) {                       // isinya sudah sama
      p._base = meta.modifiedTime; p._syncedHash = lh; p._edited = false;
      await persistLocal(p);
      return "same";
    }
    if (!p._edited) {                               // di sini tidak ada suntingan -> ambil versi Drive
      await applyRemote(p, remote, meta.modifiedTime);
      toast(`"${p.title}" diperbarui dengan versi terbaru dari perangkat lain`, tiIcon("cloud-download"));
      return "pulled";
    }
    if (remote.hash === p._syncedHash) {            // di Drive cuma metadata yang berubah
      p._base = meta.modifiedTime;
      return "push";
    }
    return askConflict(p, remote, meta);
  }

  // ganti isi project dengan versi Drive; kalau project sedang terbuka, tampilannya dimuat ulang di tab yang sama
  // modul yang memegang tampilan/isi project sendiri: ditutup dulu sebelum data project diganti
  const PROJECT_MODULES = ["NovelMap", "NovelQuill", "NovelHome", "NovelJejaring"];
  async function applyRemote(p, remote, modifiedTime) {
    const open = isOpen(p);
    const sceneId = open ? currentSceneId : null;
    if (open) {
      PROJECT_MODULES.forEach((m) => { if (window[m] && typeof window[m].hide === "function") window[m].hide(); });
      el("focusOverlay").classList.add("hidden");   // isinya sudah ikut dibandingkan (flushCurrentEdits di reconcile)
    }
    p.data = remote.data;
    p.cover = remote.cover;
    p.title = remote.data.title || p.title;
    p._base = modifiedTime;
    p._syncedHash = remote.hash;
    p._edited = false;
    p.updatedAt = modifiedTime || new Date().toISOString();
    await persistLocal(p);
    if (open && currentProjectId === p.id) {
      closeSceneDrawer();
      openProject(p.id);                                  // tab yang sedang aktif dipulihkan sendiri oleh app.js
      if (sceneId && findScene(sceneId)) selectScene(sceneId);
    } else if (dashVisible()) renderDashboard();
  }

  // ------------------------------------------------------------------ konflik
  function fmtTime(iso) { try { return formatDateTime(iso); } catch (e) { return iso || ""; } }
  function askConflict(p, remote, meta) {
    p._conflict = true;
    const device = NovelistSync.deviceLabel;
    return new Promise((resolve) => {
      const m = document.createElement("div");
      m.className = "modal ns-conflict-modal";
      m.innerHTML = `<div class="modal-box" role="alertdialog" aria-modal="true" aria-labelledby="nsConflictTitle">
          <h3 id="nsConflictTitle" class="modal-title-ic">${tiPx(tiIcon("alert-triangle"), 20)}Versi project berbeda</h3>
          <p class="ns-conflict-text"></p>
          <ul class="ns-conflict-list">
            <li><b>Simpan keduanya</b> — versi Drive dipakai di project ini, versi ${escapeHtml(device)} disimpan sebagai project baru.</li>
            <li><b>Pakai versi ${escapeHtml(device)}</b> — menimpa Drive.</li>
            <li><b>Pakai versi Drive</b> — perubahan di ${escapeHtml(device)} diganti.</li>
          </ul>
          <p class="field-hint">Versi yang tidak dipakai tetap disimpan di folder backup Drive ("${escapeHtml(DRIVE_BACKUP_FOLDER_NAME)}").</p>
          <div class="modal-buttons ns-conflict-buttons">
            <button type="button" class="btn-secondary" data-pick="remote">Pakai versi Drive</button>
            <button type="button" class="btn-secondary" data-pick="local">Pakai versi ${escapeHtml(device)}</button>
            <button type="button" class="btn-primary" data-pick="both">Simpan keduanya</button>
          </div>
        </div>`;
      m.querySelector(".ns-conflict-text").textContent =
        `"${p.title}" diubah di perangkat lain (Drive: ${fmtTime(meta.modifiedTime)}), sementara di ${device} juga ada perubahan yang belum terkirim.`;
      document.body.appendChild(m);
      const btns = m.querySelectorAll("button[data-pick]");
      btns.forEach((b) => b.onclick = async () => {
        btns.forEach((x) => { x.disabled = true; });
        b.textContent = "Memproses…";
        let result = "same";
        try { result = await resolveConflict(p, remote, meta, b.dataset.pick); }
        catch (e) { handleError(e, p); }
        p._conflict = false;
        m.remove();
        resolve(result);
      });
    });
  }
  async function resolveConflict(p, remote, meta, pick) {
    if (isOpen(p)) flushCurrentEdits();
    const localJson = payloadJson(p);
    if (pick === "local") {
      await backupJson(p.title, remote.json, "versi Drive (konflik)").catch((e) => console.warn("[Sync] backup gagal", e));
      p._base = meta.modifiedTime;
      return "push";
    }
    if (pick === "remote") {
      await backupJson(p.title, localJson, "versi perangkat (konflik)").catch((e) => console.warn("[Sync] backup gagal", e));
      await applyRemote(p, remote, meta.modifiedTime);
      toast("Versi Drive dipakai. Versi " + NovelistSync.deviceLabel + " disimpan di backup.", tiIcon("history"));
      return "pulled";
    }
    // simpan keduanya: salinan baru berisi versi perangkat ini, project asli memakai versi Drive
    const stamp = new Date().toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
    const copy = createProject(`${p.title} (versi ${NovelistSync.deviceLabel} ${stamp})`, p.description, p.template);
    const parsed = JSON.parse(localJson);
    copy.cover = parsed.cover || null;
    copy.data = migrateOldData(parsed);
    copy.data.title = copy.title;
    copy.colorA = p.colorA; copy.colorB = p.colorB;
    projects.unshift(copy);
    await persistLocal(copy);
    await applyRemote(p, remote, meta.modifiedTime);
    scheduleUpload(copy);
    toast(`Versi ${NovelistSync.deviceLabel} disimpan sebagai "${copy.title}"`, tiIcon("copy"));
    return "copy";
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
            data: remote.data, _base: f.modifiedTime, _syncedHash: remote.hash,
          };
          projects.push(np);
          await persistLocal(np);
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
      const uploads = projects.filter((p) => !p._deleted && !p._conflict && isChanged(p)).map(scheduleUpload);
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
      await persistLocal(p);
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
    const now = Date.now();
    if (now - S.lastResumeCheck < RESUME_THROTTLE_MS) return;
    S.lastResumeCheck = now;
    if (editorVisible()) checkOpenProject().then(() => { if (pendingCount()) syncAll(); });
    else syncAll();
  }

  // ------------------------------------------------------------------ pengganti fungsi app.js
  // Semua suntingan (editor, judul, Organize, Quill, Map, Timeline, Beranda, Jejaring, …) lewat markDirtyAndSchedule.
  const origMarkDirty = markDirtyAndSchedule;
  window.markDirtyAndSchedule = function () {
    const p = getProject(currentProjectId);
    if (p && editorVisible()) markEdited(p);
    return origMarkDirty.apply(this, arguments);
  };
  window.saveProjectToDriveMain = async function (p) {
    if (!p || p._deleted || S.wiped) return;
    // dipanggil dari dashboard (ganti sampul, edit project, "kirim ke cloud"): isi yang berbeda = suntingan
    if (!isOpen(p) && p.driveFileId && localHash(p) !== p._syncedHash) markEdited(p);
    try { await persistLocal(p); }
    catch (e) { console.error("[Sync] simpan lokal gagal", e); }
    if (!isOnline()) { editorSaved(p, "Tersimpan di perangkat (offline)", tiIcon("device-floppy")); refreshState(); return; }
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
    origSignOut();
    stopPolling();
    clearTimeout(S.retryTimer);
    S.account = null; S.needLogin = false; S.pendingTrash = new Map();
    metaSet("lastAccount", null);
    if (unsynced && !S.wiped) toast(`${unsynced} project belum tersinkron — tetap tersimpan di perangkat ini & dikirim saat kamu login lagi.`, tiIcon("device-floppy"));
  };

  const origPull = pullFromCloud;
  window.pullFromCloud = async function (f) {
    await origPull(f);
    const p = projects.find((x) => x.driveFileId === f.id);
    if (p) { p._base = f.modifiedTime; p._syncedHash = localHash(p); p._edited = false; await persistLocal(p).catch(() => {}); }
  };

  const origRestore = restoreFromTrash;
  window.restoreFromTrash = async function (f) {
    await origRestore(f);
    const p = projects.find((x) => x.driveFileId === f.id);
    // base sengaja dikosongkan: cek berikutnya membandingkan isi dan langsung cocok tanpa upload ulang
    if (p) { p._base = null; p._syncedHash = localHash(p); p._edited = false; await persistLocal(p).catch(() => {}); }
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
        await persistLocal(p, { pendingTrash: true });
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
    try { const d = await dbPromise; if (d) d.close(); } catch (e) { /* abaikan */ }
    dbPromise = null;
    await new Promise((resolve) => {
      let req;
      try { req = indexedDB.deleteDatabase(DB_NAME); } catch (e) { resolve(); return; }
      const t = setTimeout(resolve, 2500);
      req.onsuccess = req.onerror = req.onblocked = () => { clearTimeout(t); resolve(); };
    });
    return origClearLocal();
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

  // ------------------------------------------------------------------ pemicu
  function startPolling() {
    stopPolling();
    S.pollTimer = setInterval(() => {
      if (document.hidden || !S.account) return;
      if (editorVisible()) checkOpenProject(); else if (dashVisible()) syncAll();
    }, POLL_MS);
  }
  function stopPolling() { clearInterval(S.pollTimer); S.pollTimer = 0; }

  window.addEventListener("online", () => { S.lastResumeCheck = 0; refreshState(); if (S.account) syncAll(); });
  window.addEventListener("offline", () => refreshState());
  document.addEventListener("visibilitychange", () => { if (!document.hidden) onResume(); });
  window.addEventListener("focus", onResume);

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
      const act = async () => {
        if (S.needLogin || !accessToken) {
          if (!hooks.interactiveLogin) return;
          try { await hooks.interactiveLogin(); S.needLogin = false; }
          catch (e) { toast("Login gagal: " + ((e && (e.error || e.message)) || e), tiIcon("alert-triangle")); refreshState(); return; }
        }
        S.state = "idle";
        await syncAll();
        toast(S.state === "error" ? "Sinkron belum berhasil" : (pendingCount() ? "Sebagian belum tersinkron" : "Semua project tersinkron"),
          tiIcon(S.state === "error" ? "alert-triangle" : "cloud-check"));
      };
      ind.addEventListener("click", act);
      ind.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); act(); } });
      // di editor: status "… login untuk sinkron" / "gagal sinkron" juga bisa diketuk
      const status = el("saveStatus");
      if (status) status.addEventListener("click", () => { if (S.needLogin || S.state === "error" || !accessToken) act(); });
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
    get state() { return S.state; },
    // untuk pengujian
    _internal: { hash, payloadJson, persistLocal, S },
  };
})();
