// ================= STATE (di memori, tidak pakai localStorage) =================
let projects = [];
let currentProjectId = null;
let currentSceneId = null;
let currentOrgCat = "characters";
let currentOrgItemId = null;
let accessToken = null;
let tokenClient = null;
let tokenExpiresAt = 0;        // kapan access token Google habis (ms); 0 = tidak diketahui (mis. token dari Android)
let activeCardMenuProjectId = null;
let editingProjectId = null;
let saveDebounceTimer = null;
let firstDirtyAt = null;
let backupIntervalHandle = null;
let dirtySinceLastBackup = false;
let hasUnsyncedChanges = false;

const el = (id) => document.getElementById(id);
const COLOR_PAIRS = [
  ["#e15c5c", "#5c1f1f"], ["#5c9ee1", "#1f3b5c"], ["#e1b25c", "#5c451f"],
  ["#8b5cf6", "#2f1f5c"], ["#4caf82", "#1f5c3b"], ["#e15ca0", "#5c1f42"]
];
const STATUS_LABELS = { todo: "Todo", draft: "Draft", done: "Done" };

// ================= DATA MODEL =================
function blankBinderData(title, template) {
  const data = {
    title,
    scenes: [{ id: "scene-" + Date.now(), type: "scene", title: "Scene 1", synopsis: "", status: "todo", content: "" }],
    organize: { characters: [], locations: [], notes: [] }
  };
  if (template === "standard") {
    data.organize.characters.push({ id: "char-" + Date.now(), title: "Protagonis", content: "<p>Deskripsi karakter utama...</p>" });
    data.organize.locations.push({ id: "loc-" + Date.now(), title: "Lokasi Utama", content: "<p>Deskripsi lokasi...</p>" });
  }
  return data;
}

// Pastikan tiap node scene punya field "type" (scene/folder) - buat kompatibel dengan
// project lama (v0.3) yang scene-nya masih flat tanpa field type.
function ensureSceneTypes(list) {
  return (list || []).map((n) => {
    if (!n.type) n.type = "scene";
    if (n.type === "folder") n.children = ensureSceneTypes(n.children || []);
    return n;
  });
}

// Migrasi format lama (.novj versi sebelumnya yang pakai "items")
function migrateOldData(data) {
  if (!data.items) { if (data.scenes) data.scenes = ensureSceneTypes(data.scenes); return data; }
  const migrated = { title: data.title || "Tanpa Judul", scenes: [], organize: { characters: [], locations: [], notes: [] } };
  data.items.forEach((folder) => {
    (folder.children || []).forEach((child) => {
      if (folder.id === "manuscript") {
        migrated.scenes.push({ id: child.id, type: "scene", title: child.title, synopsis: "", status: "todo", content: child.content || "" });
      } else if (folder.id === "characters") {
        migrated.organize.characters.push({ id: child.id, title: child.title, content: child.content || "" });
      } else if (folder.id === "locations") {
        migrated.organize.locations.push({ id: child.id, title: child.title, content: child.content || "" });
      } else if (folder.id === "notes") {
        migrated.organize.notes.push({ id: child.id, title: child.title, content: child.content || "" });
      }
    });
  });
  if (migrated.scenes.length === 0) migrated.scenes.push({ id: "scene-" + Date.now(), type: "scene", title: "Scene 1", synopsis: "", status: "todo", content: "" });
  return migrated;
}

// ---- Helper untuk pohon binder bertingkat (folder/chapter berisi scene) ----
function findSceneNode(id, list, parent = null) {
  list = list || getProject(currentProjectId).data.scenes;
  for (let i = 0; i < list.length; i++) {
    if (list[i].id === id) return { node: list[i], array: list, index: i, parent };
    if (list[i].children) {
      const found = findSceneNode(id, list[i].children, list[i]);
      if (found) return found;
    }
  }
  return null;
}
function findScene(id) { const info = findSceneNode(id); return info ? info.node : null; }
function findFirstScene(list) {
  for (const n of list) {
    if (n.type === "scene") return n;
    if (n.children) { const f = findFirstScene(n.children); if (f) return f; }
  }
  return null;
}
function isDescendantOf(folderNode, id) {
  if (!folderNode.children) return false;
  return folderNode.children.some((c) => c.id === id || (c.children && isDescendantOf(c, id)));
}
function deepCloneNode(node) {
  const clone = JSON.parse(JSON.stringify(node));
  const reassign = (n) => { n.id = (n.type === "folder" ? "folder-" : "scene-") + Date.now() + Math.floor(Math.random() * 10000); if (n.children) n.children.forEach(reassign); };
  reassign(clone);
  return clone;
}



function createProject(title, description, template) {
  const colorPair = COLOR_PAIRS[Math.floor(Math.random() * COLOR_PAIRS.length)];
  return {
    id: "proj-" + Date.now() + Math.floor(Math.random() * 1000),
    title: title || "Tanpa Judul",
    description: description || "",
    template,
    cover: null,
    colorA: colorPair[0], colorB: colorPair[1],
    driveFileId: null,
    updatedAt: new Date().toISOString(),
    data: blankBinderData(title || "Tanpa Judul", template)
  };
}
function getProject(id) { return projects.find((p) => p.id === id); }
function escapeHtml(str) { const d = document.createElement("div"); d.textContent = str || ""; return d.innerHTML; }
function timeAgo(iso) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "baru saja";
  if (diff < 3600) return Math.floor(diff / 60) + " menit lalu";
  if (diff < 86400) return Math.floor(diff / 3600) + " jam lalu";
  return Math.floor(diff / 86400) + " hari lalu";
}
// Ikon Tabler berukuran tetap (atribut width/height seperti SVG inline lama), mis. tiPx(tiIcon("trash"), 12).
// Nama ikon tetap ditulis lengkap di dalam tiIcon("...") supaya terdeteksi tools/build-icons.mjs
// (jangan menulis string lain di dalam tiIcon(...) — build menganggap semua string di situ nama ikon).
function tiPx(svg, px) { return svg.replace("<svg ", `<svg width="${px}" height="${px}" `); }
// toast(pesan, ikon?) — ikon = markup ikon Tabler, mis. toast("Tersimpan", tiIcon("circle-check")).
// Ikon peringatan/gagal (alert-triangle, cloud-x, circle-x) otomatis berwarna merah, lainnya warna aksen.
function toast(msg, icon) {
  const t = document.createElement("div");
  t.className = "app-toast";
  if (icon) {
    t.innerHTML = tiPx(icon, 16);
    if (/#ti-(alert-triangle|cloud-x|circle-x)"/.test(icon)) t.classList.add("is-danger");
  }
  const text = document.createElement("span");
  text.textContent = msg;   // teks selalu lewat textContent (aman dari HTML di judul project / pesan error)
  t.appendChild(text);
  t.style.cssText = "position:fixed;bottom:24px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:8px;max-width:calc(100vw - 32px);background:var(--bg-panel);border:1px solid var(--border);color:var(--text);padding:10px 18px;border-radius:8px;box-shadow:var(--shadow);z-index:500;font-size:calc(13px * var(--fs-scale, 1));animation:fadeIn .2s ease;";
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}

// ================= LOGIN GATE =================
// Access token Google (GIS token model) habis setelah ±1 jam. Token baru diminta diam-diam (prompt "") sebelum habis
// dan saat Drive menjawab 401; kalau itu gagal (mis. popup diblokir browser), tulisan tetap aman di perangkat dan status
// simpan berubah jadi "Perlu login ulang" yang bisa diklik.
let tokenWaiters = [];          // permintaan token yang menunggu jawaban GIS
let tokenRefreshing = null;     // satu refresh diam-diam pada satu waktu
let tokenRefreshTimer = 0;
const TOKEN_REFRESH_EARLY_MS = 5 * 60000;   // perpanjang 5 menit sebelum habis
const TOKEN_SILENT_TIMEOUT_MS = 20000;      // GIS tidak menjawab (popup tertutup diam-diam) -> anggap gagal
function ensureTokenClient() {
  if (tokenClient) return tokenClient;
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID, scope: GOOGLE_SCOPES, callback: onTokenResponse,
    error_callback: onTokenError,   // popup ditutup / diblokir -> janji login tidak menggantung selamanya
  });
  return tokenClient;
}
function settleTokenWaiters(resp) {
  const list = tokenWaiters;
  tokenWaiters = [];
  list.forEach((w) => { clearTimeout(w.t); if (!resp || resp.error) w.reject(resp || { error: "unknown" }); else w.resolve(accessToken); });
}
function onTokenResponse(resp) {
  if (resp && !resp.error && resp.access_token) {
    accessToken = resp.access_token;
    tokenExpiresAt = Date.now() + (Number(resp.expires_in) || 3600) * 1000;
    tokenSilentFailAt = 0;
    scheduleTokenRefresh();
  }
  settleTokenWaiters(resp && resp.access_token ? resp : { error: (resp && resp.error) || "no_token" });
}
function onTokenError(err) { settleTokenWaiters({ error: (err && (err.type || err.message)) || "popup_error" }); }
// prompt: "consent" (login pertama) | "" (tanpa layar izin bila sudah pernah setuju). timeoutMs 0 = tunggu terus.
function requestGoogleToken(prompt, timeoutMs) {
  return new Promise((resolve, reject) => {
    if (GOOGLE_CLIENT_ID.startsWith("ISI_CLIENT_ID")) { reject({ error: "Client ID Google belum diisi di config.js" }); return; }
    if (!window.google || !google.accounts || !google.accounts.oauth2) { reject({ error: "Layanan login Google belum dimuat" }); return; }
    const client = ensureTokenClient();
    const w = { resolve, reject, t: 0 };
    if (timeoutMs) w.t = setTimeout(() => { tokenWaiters = tokenWaiters.filter((x) => x !== w); reject({ error: "timeout" }); }, timeoutMs);
    tokenWaiters.push(w);
    client.callback = onTokenResponse;
    client.error_callback = onTokenError;
    const opts = { prompt };
    const email = typeof accountInfo !== "undefined" && accountInfo && accountInfo.user && accountInfo.user.emailAddress;
    if (prompt === "" && email) opts.login_hint = email;   // akun yang sama, tanpa memilih akun lagi
    try { client.requestAccessToken(opts); } catch (e) { settleTokenWaiters({ error: (e && e.message) || "request_failed" }); }
  });
}
function driveSignIn(interactive = true) { return requestGoogleToken(interactive ? "consent" : "", 0); }
// token baru tanpa interaksi -> Promise<boolean>. Satu permintaan bersamaan saja; baru saja gagal (mis. popup diblokir)
// -> tidak dicoba terus-menerus tiap simpan (menunggu 2 menit atau login lewat klik status).
let tokenSilentFailAt = 0;
function driveRefreshToken() {
  if (tokenRefreshing) return tokenRefreshing;
  if (Date.now() - tokenSilentFailAt < 120000) return Promise.resolve(false);
  tokenRefreshing = requestGoogleToken("", TOKEN_SILENT_TIMEOUT_MS)
    .then(() => true, () => { tokenSilentFailAt = Date.now(); return false; })
    .finally(() => { tokenRefreshing = null; });
  return tokenRefreshing;
}
// dipakai driveFetch: Android memasang NovelistSync.hooks.refreshToken (Google Play services), web memakai GIS
function refreshAccessToken(force) {
  const hook = window.NovelistSync && window.NovelistSync.hooks && window.NovelistSync.hooks.refreshToken;
  if (hook) return Promise.resolve().then(() => hook(!!force)).then((ok) => !!ok && !!accessToken, () => false);
  return driveRefreshToken();
}
function scheduleTokenRefresh() {
  clearTimeout(tokenRefreshTimer);
  if (!tokenExpiresAt) return;
  const wait = Math.max(30000, tokenExpiresAt - Date.now() - TOKEN_REFRESH_EARLY_MS);
  tokenRefreshTimer = setTimeout(() => { if (accessToken) refreshAccessToken(false); }, wait);
}
const tokenExpiringSoon = () => !!tokenExpiresAt && Date.now() > tokenExpiresAt - 60000;
function driveSignOut() {
  if (accessToken && window.google && google.accounts?.oauth2?.revoke) google.accounts.oauth2.revoke(accessToken, () => {});
  accessToken = null;
  tokenExpiresAt = 0;
  clearTimeout(tokenRefreshTimer);
  projects = [];
  // ID folder Drive milik akun ini — dibuang supaya login dengan akun Google lain tidak memakai folder akun sebelumnya
  mainFolderIdCache = backupFolderIdCache = trashFolderIdCache = null;
  stopBackupInterval();
  if (window.NovelMap) window.NovelMap.hide();
  if (window.NovelQuill) window.NovelQuill.hide();
  if (window.NovelHome) window.NovelHome.hide();
  if (window.NovelJejaring) window.NovelJejaring.hide();
  muteTimelineKeys(true);
  el("dashboardView").classList.add("hidden");
  el("editorView").classList.add("hidden");
  el("loginView").classList.remove("hidden");
  resetAccountState();   // info akun di memori dibuang, halaman akun ditutup
}

const LAST_LOGIN_KEY = "novelist_last_login";

function showLastLoginHint() {
  let last = null;
  try { last = localStorage.getItem(LAST_LOGIN_KEY); } catch (e) { /* storage bisa diblokir browser */ }
  el("lastLoginHint").classList.toggle("hidden", last !== "google");
}

let loginNoticeTimer = null;
function showLoginNotice(msg) {
  const n = el("loginNotice");
  n.textContent = msg;
  n.classList.remove("hidden");
  clearTimeout(loginNoticeTimer);
  loginNoticeTimer = setTimeout(() => n.classList.add("hidden"), 4000);
}

// ---- BAHASA HALAMAN LOGIN (ID / EN) + footer Help | Terms | Privacy ----
const LOGIN_LANG_KEY = "novelist_login_lang";
const LOGIN_I18N = {
  id: {
    heading: "Sign In atau Mulai Menulis", tagline: "Tulis novelmu, tersimpan otomatis ke Google Drive-mu sendiri.",
    google: "Lanjutkan dengan Google", discord: "Lanjutkan dengan Discord", apple: "Lanjutkan dengan Apple", email: "Lanjutkan dengan Email",
    soon: "Segera", lastUsed: "Terakhir kamu login pakai Google", waiting: "Menunggu login...", loginFailed: "Login gagal: ",
    note: "Login diperlukan supaya project kamu aman tersimpan & ter-backup otomatis di Google Drive-mu. Tidak ada data yang disimpan di server kami.",
    soonNotice: (n) => `Login dengan ${n} belum tersedia. Untuk saat ini pakai Google dulu ya — project kamu disimpan di Google Drive-mu.`,
    help: "Bantuan", terms: "Ketentuan", privacy: "Privasi",
    // tombol ganti gambar halftone (kiri-bawah)
    artChange: "Ganti gambar", artUpload: "Unggah gambar…", artReset: "Kembalikan gambar bawaan",
    artHint: "Atau seret gambar ke area ilustrasi", artDrop: "Lepaskan untuk mengganti gambar",
    artNotImage: "File itu bukan gambar. Pilih file JPG, PNG, WebP, atau GIF.",
    artTooBig: "Gambarnya terlalu besar (maksimal 20 MB).",
    artFailed: "Gambar tidak bisa dibuka. Coba file lain (JPG, PNG, atau WebP).",
    artChanged: "Gambar login diganti — tersimpan di perangkat ini.",
    artChangedTemp: "Gambar diganti, tapi browser menolak menyimpannya — akan kembali ke gambar bawaan saat halaman dimuat ulang.",
    artRestored: "Gambar bawaan dikembalikan.",
    termsTitle: "Ketentuan Penggunaan",
    termsBody: [
      ["Pemakaian", "Novelist adalah alat bantu menulis novel. Kamu bebas memakainya untuk karya pribadi maupun komersial."],
      ["Karyamu milikmu", "Semua tulisan, karakter, dan cerita yang kamu buat sepenuhnya milikmu. Kami tidak mengklaim hak apa pun atas karyamu."],
      ["Penyimpanan", "Project disimpan di Google Drive milikmu. Kamu bertanggung jawab menjaga akses akun Google-mu."],
      ["Tanpa jaminan", "Aplikasi disediakan apa adanya. Kami berusaha menjaga datamu aman lewat autosave & backup, tapi tetap simpan cadangan untuk karya penting."],
    ],
    privacyTitle: "Kebijakan Privasi",
    privacyBody: [
      ["Data yang kami simpan", "Tidak ada. Novelist berjalan di browser-mu dan tidak punya server penyimpanan sendiri."],
      ["Google Drive", "Project disimpan sebagai file di Google Drive-mu sendiri. Akses Drive hanya dipakai untuk membaca & menyimpan file project Novelist."],
      ["Penyimpanan lokal", "Browser menyimpan beberapa preferensi kecil (misalnya tema, bahasa, login terakhir, dan gambar halaman login pilihanmu) di perangkatmu."],
      ["Mencabut akses", "Kamu bisa mencabut akses Novelist kapan saja lewat pengaturan keamanan akun Google-mu."],
    ],
  },
  en: {
    heading: "Sign In or Start Writing", tagline: "Write your novel, saved automatically to your own Google Drive.",
    google: "Continue with Google", discord: "Continue with Discord", apple: "Continue with Apple", email: "Continue with Email",
    soon: "Soon", lastUsed: "You last signed in with Google", waiting: "Waiting for sign-in...", loginFailed: "Sign-in failed: ",
    note: "Sign-in is required so your projects are safely saved & backed up automatically to your Google Drive. No data is stored on our servers.",
    soonNotice: (n) => `Signing in with ${n} isn't available yet. Please use Google for now — your projects are stored in your Google Drive.`,
    help: "Help", terms: "Terms", privacy: "Privacy",
    artChange: "Change image", artUpload: "Upload image…", artReset: "Restore default image",
    artHint: "Or drag an image onto the artwork", artDrop: "Drop to change the image",
    artNotImage: "That file isn't an image. Choose a JPG, PNG, WebP, or GIF file.",
    artTooBig: "That image is too large (20 MB max).",
    artFailed: "Couldn't open that image. Try another file (JPG, PNG, or WebP).",
    artChanged: "Login image changed — saved on this device.",
    artChangedTemp: "Image changed, but your browser blocked saving it — it will go back to the default when the page reloads.",
    artRestored: "Default image restored.",
    termsTitle: "Terms of Use",
    termsBody: [
      ["Use", "Novelist is a novel-writing tool. You're free to use it for personal and commercial work."],
      ["Your work is yours", "All writing, characters, and stories you create belong entirely to you. We claim no rights over your work."],
      ["Storage", "Projects are stored in your own Google Drive. You're responsible for keeping your Google account secure."],
      ["No warranty", "The app is provided as is. We try to keep your data safe with autosave & backups, but keep your own copies of important work."],
    ],
    privacyTitle: "Privacy Policy",
    privacyBody: [
      ["Data we store", "None. Novelist runs in your browser and has no storage server of its own."],
      ["Google Drive", "Projects are saved as files in your own Google Drive. Drive access is only used to read & save Novelist project files."],
      ["Local storage", "Your browser keeps a few small preferences (such as theme, language, last sign-in, and your chosen login-page image) on your device."],
      ["Revoking access", "You can revoke Novelist's access at any time from your Google account's security settings."],
    ],
  },
};
let loginLang = "id";
function lt(key) { return LOGIN_I18N[loginLang][key]; }
function applyLoginLang(lang) {
  loginLang = LOGIN_I18N[lang] ? lang : "id";
  try { localStorage.setItem(LOGIN_LANG_KEY, loginLang); } catch (e) { /* abaikan */ }
  document.querySelectorAll("#loginView [data-i18n]").forEach((n) => { n.textContent = lt(n.dataset.i18n); });
  el("loginLangLabel").textContent = loginLang.toUpperCase();
  document.documentElement.lang = loginLang;
}
function openLegalModal(kind) {
  el("legalTitle").textContent = lt(kind + "Title");
  el("legalBody").innerHTML = lt(kind + "Body").map(([t, d]) => `<div class="support-item"><div class="support-item-title">${escapeHtml(t)}</div><p>${escapeHtml(d)}</p></div>`).join("");
  el("legalModal").classList.remove("hidden");
}
function initLoginFooter() {
  let saved = null;
  try { saved = localStorage.getItem(LOGIN_LANG_KEY); } catch (e) { /* abaikan */ }
  applyLoginLang(saved || "id");
  el("btnLoginHelp").onclick = () => el("supportModal").classList.remove("hidden");
  el("btnLoginTerms").onclick = () => openLegalModal("terms");
  el("btnLoginPrivacy").onclick = () => openLegalModal("privacy");
  el("btnCloseLegal").onclick = () => el("legalModal").classList.add("hidden");
  const menu = el("loginLangMenu"), btn = el("btnLoginLang");
  const setOpen = (open) => { menu.classList.toggle("hidden", !open); btn.setAttribute("aria-expanded", String(open)); };
  btn.onclick = (e) => { e.stopPropagation(); setOpen(menu.classList.contains("hidden")); };
  menu.querySelectorAll("button").forEach((b) => b.onclick = () => { applyLoginLang(b.dataset.lang); setOpen(false); });
  document.addEventListener("click", () => setOpen(false));
  // logo animasi login: diam di frame pertama bila pengguna memilih "reduce motion"
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { const v = el("loginLogoVideo"); v.removeAttribute("autoplay"); v.pause(); }
}

// Discord / Apple / Email baru tampilan — project tersimpan di Google Drive, jadi sementara hanya Google yang aktif.
function handleSoonProvider(provider) {
  const names = { discord: "Discord", apple: "Apple", email: "Email" };
  showLoginNotice(lt("soonNotice")(names[provider] || provider));
}

async function handleLogin() {
  const btn = el("btnLoginGoogle");
  const label = btn.querySelector(".btn-label");
  el("loginError").classList.add("hidden");
  el("loginNotice").classList.add("hidden");
  btn.disabled = true;
  label.textContent = lt("waiting");
  try {
    await driveSignIn(true);
    loadAccountInfo(true);   // nama & foto akun untuk rail (tidak ditunggu; gagal = placeholder)
    try { localStorage.setItem(LAST_LOGIN_KEY, "google"); } catch (e) { /* abaikan */ }
    el("loginView").classList.add("hidden");
    el("dashboardView").classList.remove("hidden");
    await loadProjectsFromDrive(true);
    startBackupInterval();
  } catch (e) {
    el("loginError").textContent = lt("loginFailed") + (e.error || e.message || e);
    el("loginError").classList.remove("hidden");
  }
  btn.disabled = false;
  label.textContent = lt("google");
  showLastLoginHint();
}

// ================= DASHBOARD RENDER =================
// Judul dashboard dipilih acak tiap kali halaman dimuat/di-refresh (tidak sama dengan yang terakhir tampil).
const DASH_TITLES = [
  "Mau menulis apa hari ini?",
  "Cerita apa yang menunggumu hari ini?",
  "Siap melanjutkan petualangan?",
  "Bab berikutnya menantimu.",
  "Dunia mana yang mau kamu bangun hari ini?",
  "Satu kalimat dulu, sisanya menyusul.",
  "Tokoh-tokohmu sudah menunggu.",
  "Halaman kosong ini milikmu.",
  "Ayo lanjutkan kisahmu.",
  "Ide apa yang muncul hari ini?",
];
function pickDashTitle() {
  let last = null;
  try { last = localStorage.getItem("dashTitleLast"); } catch (e) {}
  const pool = DASH_TITLES.filter((t) => t !== last);
  const t = pool[Math.floor(Math.random() * pool.length)];
  try { localStorage.setItem("dashTitleLast", t); } catch (e) {}
  el("dashTitle").textContent = t;
}

// Saat kursor di atas kartu project, sampulnya memudar masuk ke background; memudar keluar saat kursor pergi.
// Dua lapisan dipakai bergantian supaya pindah dari kartu ke kartu jadi crossfade, bukan kedip.
let dashCoverFront = "A";
function showDashCover(p) {
  const next = dashCoverFront === "A" ? "B" : "A";
  const layer = el("dashCoverBg" + next);
  layer.style.backgroundImage = p.cover ? `url("${p.cover}")` : `linear-gradient(135deg, ${p.colorA}, ${p.colorB})`;
  el("dashCoverBg" + dashCoverFront).classList.remove("is-on");
  layer.classList.add("is-on");
  dashCoverFront = next;
}
function hideDashCover() {
  el("dashCoverBgA").classList.remove("is-on");
  el("dashCoverBgB").classList.remove("is-on");
}

function renderDashboard() {
  hideDashCover();
  const grid = el("projectGrid");
  grid.innerHTML = "";
  el("loadingState").classList.add("hidden");
  const hasProjects = projects.length > 0;
  el("emptyState").classList.toggle("hidden", hasProjects);
  // FAB "Add Project" is hidden while the empty state is showing (first-time / no projects),
  // and reappears once a project/template exists.
  el("btnAddProject").classList.toggle("hidden", !hasProjects);

  projects.forEach((p, idx) => {
    const card = document.createElement("div");
    card.className = "project-card";
    card.style.animationDelay = (idx * 0.04) + "s";
    if (p.description) card.title = p.description;   // deskripsi tampil sebagai tooltip (baris dibuat ringkas)
    const coverInner = p.cover
      ? `<img class="cover-img" src="${p.cover}" alt="" draggable="false" />`
      : `<span class="cover-letter">${escapeHtml((p.title || "?").charAt(0).toUpperCase())}</span>`;
    card.innerHTML = `
      <div class="cover" style="background-image:linear-gradient(135deg, ${p.colorA}, ${p.colorB})">${coverInner}</div>
      <div class="card-body">
        <div class="card-title">${escapeHtml(p.title)}</div>
        <div class="card-meta">${p.driveFileId ? '<span class="drive-dot"></span> Tersinkron' : "Belum disinkron"} · ${timeAgo(p.updatedAt)}</div>
      </div>
      <button class="card-gear" title="Opsi" aria-label="Opsi project">${tiPx(tiIcon("dots"), 18)}</button>`;
    card.addEventListener("click", (e) => { if (!e.target.closest(".card-gear")) openProject(p.id); });
    card.addEventListener("mouseenter", () => showDashCover(p));
    card.addEventListener("mouseleave", hideDashCover);
    card.querySelector(".card-gear").addEventListener("click", (e) => { e.stopPropagation(); openCardMenu(p.id, e.currentTarget); });
    grid.appendChild(card);
  });
  renderAccountView();   // jumlah project di halaman akun (kalau sedang terbuka)
}

// ================= ADD / EDIT PROJECT MODAL =================
function openAddProjectModal() {
  editingProjectId = null;
  el("projectModalTitle").textContent = "Add project";
  el("fieldTitle").value = ""; el("fieldDesc").value = "";
  el("templateBlock").classList.remove("hidden");
  document.querySelector('input[name="template"][value="standard"]').checked = true;
  el("projectModal").classList.remove("hidden");
  el("fieldTitle").focus();
}
function openEditProjectModal(id) {
  const p = getProject(id);
  editingProjectId = id;
  el("projectModalTitle").textContent = "Edit project";
  el("fieldTitle").value = p.title; el("fieldDesc").value = p.description || "";
  el("templateBlock").classList.add("hidden");
  el("projectModal").classList.remove("hidden");
  el("fieldTitle").focus();
}
async function saveProjectModal() {
  const title = el("fieldTitle").value.trim() || "Tanpa Judul";
  const desc = el("fieldDesc").value.trim();
  let p;
  if (editingProjectId) {
    p = getProject(editingProjectId);
    p.title = title; p.description = desc; p.updatedAt = new Date().toISOString();
  } else {
    const template = document.querySelector('input[name="template"]:checked').value;
    p = createProject(title, desc, template);
    projects.unshift(p);
  }
  el("projectModal").classList.add("hidden");
  renderDashboard();
  await saveProjectToDriveMain(p); // langsung disimpan begitu dibuat/diedit
}

// ================= CARD GEAR MENU =================
function openCardMenu(id, anchorEl) {
  activeCardMenuProjectId = id;
  const menu = el("cardMenu");
  const rect = anchorEl.getBoundingClientRect();
  menu.style.top = rect.bottom + 6 + "px";
  menu.style.left = Math.min(rect.left, window.innerWidth - 230) + "px";
  menu.classList.remove("hidden");
}
function closeAllDropdowns() {
  ["cardMenu", "settingsMenu", "projectMenu", "sceneMenu"].forEach((id) => el(id).classList.add("hidden"));
  el("btnSettings").setAttribute("aria-expanded", "false");
}
async function handleCardMenuAction(action) {
  const p = getProject(activeCardMenuProjectId);
  if (!p) return;
  closeAllDropdowns();
  if (action === "edit") openEditProjectModal(p.id);
  if (action === "setCover") {
    el("coverInputHidden").onchange = (e) => {
      const file = e.target.files[0]; if (!file) return;
      const reader = new FileReader();
      reader.onload = async () => { p.cover = reader.result; p.updatedAt = new Date().toISOString(); renderDashboard(); await saveProjectToDriveMain(p); };
      reader.readAsDataURL(file);
      e.target.value = "";
    };
    el("coverInputHidden").click();
  }
  if (action === "clearCover") { p.cover = null; renderDashboard(); await saveProjectToDriveMain(p); }
  if (action === "backupWord") exportProjectToWord(p);
  if (action === "sendCloud") { await saveProjectToDriveMain(p); toast("Tersimpan ke Google Drive", tiIcon("cloud-check")); }
  if (action === "delete") {
    if (!confirm(`Pindahkan project "${p.title}" ke Trash? Kamu masih bisa memulihkannya nanti dari Cloud Library.`)) return;
    p._deleted = true; // guard: kalau ada autosave lain yang masih berjalan untuk project ini, dia tidak akan menghidupkannya lagi
    if (p.driveFileId) {
      try {
        const mainFolderId = await getOrCreateFolder(DRIVE_FOLDER_NAME, "main");
        const trashFolderId = await getOrCreateFolder(DRIVE_TRASH_FOLDER_NAME, "trash");
        await driveMoveFile(p.driveFileId, mainFolderId, trashFolderId);
      } catch (e) {
        console.error(e);
        p._deleted = false;
        toast("Gagal memindahkan ke Trash: " + e.message, tiIcon("alert-triangle"));
        return; // jangan hapus dari daftar lokal kalau gagal — supaya tidak dikira sudah terhapus padahal masih ada di Drive
      }
    }
    projects = projects.filter((x) => x.id !== p.id);
    renderDashboard();
    toast("Project dipindahkan ke Trash", tiIcon("trash"));
  }
}

// ================= EXPORT KE WORD (.doc) =================
function sceneNodesToHtml(list, depth) {
  let html = "";
  (list || []).forEach((n) => {
    if (n.type === "folder") {
      const tag = depth === 0 ? "h2" : "h3";
      html += `<${tag} style="font-family:Georgia,serif;">${escapeHtml(n.title)}</${tag}>`;
      html += sceneNodesToHtml(n.children, depth + 1);
    } else {
      html += `<h3 style="font-family:Georgia,serif;">${escapeHtml(n.title)}</h3>`;
      if (n.synopsis) html += `<p style="font-style:italic;color:#555;">${escapeHtml(n.synopsis)}</p>`;
      html += `<div style="font-family:Georgia,serif;font-size:14px;">${n.content || ""}</div>`;
    }
  });
  return html;
}
function binderToHtml(data) {
  let html = `<h1 style="font-family:Georgia,serif;">${escapeHtml(data.title)}</h1>`;
  html += `<h2 style="font-family:Georgia,serif;border-bottom:1px solid #ccc;">Manuskrip</h2>`;
  html += sceneNodesToHtml(data.scenes, 0);
  const catLabels = { characters: "Karakter", locations: "Lokasi", notes: "Catatan" };
  Object.keys(catLabels).forEach((cat) => {
    const list = data.organize?.[cat] || [];
    if (list.length === 0) return;
    html += `<h2 style="font-family:Georgia,serif;border-bottom:1px solid #ccc;">${catLabels[cat]}</h2>`;
    list.forEach((it) => {
      html += `<h3 style="font-family:Georgia,serif;">${escapeHtml(it.title)}</h3>`;
      html += `<div style="font-family:Georgia,serif;font-size:14px;">${it.content || ""}</div>`;
    });
  });
  return html;
}
function exportProjectToWord(p) {
  const pre = "<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'><head><meta charset='utf-8'><title>Export</title></head><body>";
  const fullHtml = pre + binderToHtml(p.data) + "</body></html>";
  const blob = new Blob(["\ufeff", fullHtml], { type: "application/msword" });
  const urlObj = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = urlObj; a.download = (p.title || "novel").replace(/[\\/:*?"<>|]/g, "_") + ".doc"; a.click();
  URL.revokeObjectURL(urlObj);
  toast("File Word berhasil diunduh", tiIcon("file-download"));
}

// ================= PROJECT VIEW (Write / Organize) =================
function openProject(id) {
  closeAccountView();
  hideDashCover();
  currentProjectId = id;
  const p = getProject(id);
  el("projectTitle").value = p.title;
  fitProjectTitle();
  applyProjectLook(p);
  expandedFolders = new Set(p.data.scenes.filter((n) => n.type === "folder").map((n) => n.id));
  sceneHistory = []; sceneHistoryIndex = -1;
  renderSceneList();
  const first = findFirstScene(p.data.scenes);
  currentSceneId = first ? first.id : null;
  if (currentSceneId) { sceneHistory = [currentSceneId]; sceneHistoryIndex = 0; }
  renderSceneDetail();
  currentOrgCat = "characters";
  document.querySelectorAll(".org-subtab").forEach((b) => b.classList.toggle("active", b.dataset.cat === "characters"));
  el("organizeCatLabel").textContent = "KARAKTER";
  renderOrganizeList();
  currentOrgItemId = null;
  renderOrganizeDetail();
  markSaved();
  restoreProjectTabs(p);   // TAB PROJECT: tab terbuka + tab aktif project ini (bawaan: Beranda)
  el("dashboardView").classList.add("hidden");
  el("editorView").classList.remove("hidden");
  startProjClock();
}
// ---- SIDEBAR PROJECT (dibuka dari logo kiri atas) ----
function renderProjSidebarList() {
  const list = el("projSidebarList");
  list.innerHTML = "";
  projects.forEach((p) => {
    const b = document.createElement("button");
    b.className = "proj-side-project" + (p.id === currentProjectId ? " is-current" : "");
    const thumb = p.cover ? `<span class="proj-side-thumb" style="background-image:url('${p.cover}')"></span>`
      : `<span class="proj-side-thumb" style="background-image:linear-gradient(135deg, ${p.colorA}, ${p.colorB})">${escapeHtml((p.title || "?").charAt(0).toUpperCase())}</span>`;
    b.innerHTML = `${thumb}<span class="proj-side-title">${escapeHtml(p.id === currentProjectId ? el("projectTitle").value : p.title)}</span>`;
    b.onclick = () => { closeProjSidebar(); if (p.id !== currentProjectId) switchToProject(p.id); };
    list.appendChild(b);
  });
}
function projSidebarKeyHandler(e) { if (e.key === "Escape") closeProjSidebar(); }
function openProjSidebar() {
  renderProjSidebarList();
  el("projSidebar").classList.add("is-open");
  el("projSidebarScrim").classList.add("is-open");
  el("projSidebar").setAttribute("aria-hidden", "false");
  el("btnProjSidebar").setAttribute("aria-expanded", "true");
  document.addEventListener("keydown", projSidebarKeyHandler);
}
function closeProjSidebar() {
  el("projSidebar").classList.remove("is-open");
  el("projSidebarScrim").classList.remove("is-open");
  el("projSidebar").setAttribute("aria-hidden", "true");
  el("btnProjSidebar").setAttribute("aria-expanded", "false");
  document.removeEventListener("keydown", projSidebarKeyHandler);
}
// simpan project yang sedang dibuka (judul + isi) lalu kirim ke Drive
function saveCurrentProject() {
  flushCurrentEdits();
  const p = getProject(currentProjectId);
  if (!p) return Promise.resolve();
  p.title = el("projectTitle").value; p.data.title = p.title; p.updatedAt = new Date().toISOString();
  return saveProjectToDriveMain(p);
}
function switchToProject(id) {
  saveCurrentProject();
  closeSceneDrawer();
  openProject(id);
}

// modul yang memegang tampilan/isi project sendiri: simpan teks yang sedang diedit lalu lepas
function hideProjectModules() {
  if (window.NovelMap) window.NovelMap.hide();
  if (window.NovelQuill) window.NovelQuill.hide();
  if (window.NovelHome) window.NovelHome.hide();
  if (window.NovelJejaring) window.NovelJejaring.hide();
}
function backToLibrary() {
  closeProjSidebar();
  flushCurrentEdits();
  hideProjectModules();
  muteTimelineKeys(true);
  const p = getProject(currentProjectId);
  if (p) { p.title = el("projectTitle").value; p.data.title = p.title; p.updatedAt = new Date().toISOString(); }
  saveProjectToDriveMain(p);
  closeSceneDrawer();
  stopProjClock();
  el("editorView").classList.add("hidden");
  el("dashboardView").classList.remove("hidden");
  renderDashboard();
}
function flushCurrentEdits() {
  syncSceneFromDetail();
  syncOrganizeFromDetail();
  if (window.NovelMap) window.NovelMap.flush();
  if (window.NovelQuill) window.NovelQuill.flush();   // Quill: isi editor chapter
  if (window.NovelHome) window.NovelHome.flush();     // Beranda: teks catatan/bentuk yang sedang diedit
  if (window.NovelJejaring) window.NovelJejaring.flush();   // Jejaring Tokoh: nama / teks yang sedang diedit
}

// ================= TAB PROJECT =================
// Bar atas hanya berisi tab yang TERBUKA: tab aktif = pill berlabel, lainnya ikon bulat; × (hover/fokus) atau klik
// tengah menutup, seret untuk mengurutkan, "+" membuka jendela "Tambah tab". Sidebar tab (kiri) berisi tab terbuka +
// riwayat (tab & dokumen yang dibuka: scene, item Organize, timeline, peta, cerita Quill).
// Disimpan per project DI PERANGKAT INI (status tampilan, tidak memicu simpan ke Drive):
//   novelist_tabs_<id>    = { open: ["home", "write", ...], active: "write" | null }   (null = semua tab ditutup)
//   novelist_tabhist_<id> = [{ k, tab, doc, kind, title, t }]  (terbaru di depan, maks. 30)
//   novelist_tabsidebar   = true/false  (sidebar menempel di desktop)
// "quill" = panel Write dalam mode Quill (tab sendiri). switchTab(x) dari mana pun (Timeline "buka scene", alat Map di
// Quill, Home, riwayat, ...) otomatis membuka tab x kalau sedang tertutup (disisipkan setelah tab aktif).
const TAB_DEFS = [
  { id: "home", panel: "home", name: "Beranda", icon: tiIcon("home"), desc: "Jejak semua dokumenmu & papan ide — zoom, susun, hubungkan" },
  { id: "write", panel: "write", name: "Tulis", icon: tiIcon("pencil"), desc: "Editor scene: bab & adegan bertingkat" },
  { id: "quill", panel: "write", name: "Quill", icon: tiIcon("feather"), desc: "Tulis cerita bergaya buku, lalu terbitkan" },
  { id: "organize", panel: "organize", name: "Organize", icon: tiIcon("folders"), desc: "Karakter, lokasi & catatan dunia cerita" },
  { id: "jejaring", panel: "jejaring", name: "Jejaring Tokoh", icon: tiIcon("affiliate"), desc: "Pohon relasi tokoh: keluarga, kantor, militer, istana" },
  { id: "timeline", panel: "timeline", name: "Timeline", icon: tiIcon("timeline"), desc: "Garis waktu peristiwa, terhubung ke scene" },
  { id: "map", panel: "map", name: "Map", icon: tiIcon("map"), desc: "Lukis peta dunia & lihat sebagai diorama 3D" },
  { id: "plot", panel: "plot", name: "Plot", icon: tiIcon("git-branch"), desc: "Susun alur & konflik cerita (segera hadir)" },
  { id: "schedule", panel: "schedule", name: "Schedule", icon: tiIcon("calendar-time"), desc: "Jadwal & target menulis (segera hadir)" },
  { id: "tools", panel: "tools", name: "Tools", icon: tiIcon("tool"), desc: "Alat bantu menulis (segera hadir)" },
];
const TAB_BY_ID = Object.fromEntries(TAB_DEFS.map((d) => [d.id, d]));
const TAB_PANELS = ["home", "write", "organize", "jejaring", "timeline", "map", "plot", "schedule", "tools"];
const TAB_DEFAULT = ["home", "write", "organize"];
const TAB_QUICK = ["home", "write", "quill", "timeline", "map"];          // baris ikon bawah sidebar
const TAB_EMPTY_MAIN = ["home", "write", "quill", "organize", "timeline"]; // chip utama saat semua tab ditutup
const TAB_HIST_MAX = 30;
const TAB_DOC_ICONS = { scene: tiIcon("file-text"), characters: tiIcon("user"), locations: tiIcon("map-pin"), notes: tiIcon("note"), timeline: tiIcon("timeline"), map: tiIcon("map"), story: tiIcon("book-2"), board: tiIcon("layout-board"), jejaring: tiIcon("affiliate") };
const tabNarrowMq = window.matchMedia("(max-width: 900px)");
const tabReduceMq = window.matchMedia("(prefers-reduced-motion: reduce)");
let projTabs = { open: [], active: null };   // tab project yang sedang dibuka
let tabHist = [];                            // riwayat project ini
let tabLastDoc = {};                         // dokumen terakhir per tab (timeline/map/quill) untuk label & riwayat
let tabPendingDoc = null;                    // { tab, id }: timeline/peta dari riwayat, dibuka setelah modulnya tampil
let tabVisitPending = null, tabVisitTimer = null;
let tabSbDocked = false, tabSbDrawer = false; // sidebar: menempel (desktop, diingat) / laci (<= 900 px)
let tabHistRows = [];                        // baris riwayat yang sedang tampil (indeks = data-i)
let quillNav = null, quillScreen = null;     // buka cerita Quill dari riwayat (lewat tombol di layar Quill)
let teMore = false;                          // layar kosong: chip "Lainnya" dibuka

function tabStoreGet(key) { try { return JSON.parse(localStorage.getItem(key) || "null"); } catch (e) { return null; } }
function tabStoreSet(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* storage diblokir: cukup di memori */ } }
function saveProjectTabs() { if (currentProjectId) tabStoreSet("novelist_tabs_" + currentProjectId, { open: projTabs.open, active: projTabs.active }); }
function saveTabHist() { if (currentProjectId) tabStoreSet("novelist_tabhist_" + currentProjectId, tabHist); }

// dipanggil openProject: pulihkan tab project ini (bawaan: Beranda, Tulis, Organize) lalu tampilkan tab aktifnya
function restoreProjectTabs(p) {
  const s = tabStoreGet("novelist_tabs_" + p.id);
  let open = s && Array.isArray(s.open) ? s.open.filter((t, i, a) => TAB_BY_ID[t] && a.indexOf(t) === i) : null;
  if (!open) {
    open = TAB_DEFAULT.slice();
    if (writeMode(p) === "quill") open.splice(2, 0, "quill");   // project yang dulu ditulis di mode Quill: tab Quill ikut terbuka
  }
  projTabs = { open, active: s && open.includes(s.active) ? s.active : (open[0] || null) };
  const h = tabStoreGet("novelist_tabhist_" + p.id);
  tabHist = Array.isArray(h) ? h.filter((x) => x && TAB_BY_ID[x.tab] && typeof x.k === "string" && typeof x.t === "number").slice(0, TAB_HIST_MAX) : [];
  tabLastDoc = {}; tabPendingDoc = null; quillNav = null; quillScreen = null; teMore = false;
  el("tsbSearch").value = ""; el("teSearch").value = "";
  const v = el("editorView");
  v.style.setProperty("--ptab-tint", p.colorA || "#d7a86e");   // warna pill tab aktif mengikuti warna project
  el("tabPicker").style.setProperty("--ptab-tint", p.colorA || "#d7a86e");
  v.classList.add("tsb-no-anim");                               // ganti project: tanpa animasi buka sidebar/tab
  el("tabStrip").innerHTML = "";
  v.dataset.ptab = "";   // ganti project: panel tab aktif selalu dibangun ulang walau id tabnya sama (mis. Beranda -> Beranda)
  tabSbDrawer = false;
  applyTabSidebar();
  if (projTabs.active) switchTab(projTabs.active);
  else { saveProjectTabs(); showTabPanel(null); renderProjectTabs(); }
  requestAnimationFrame(() => requestAnimationFrame(() => v.classList.remove("tsb-no-anim")));
}

function switchTab(tab) {
  if (!TAB_BY_ID[tab] || !currentProjectId) return;
  if (!projTabs.open.includes(tab)) insertProjectTab(tab, false);   // tab tertutup dipanggil fitur lain -> buka otomatis
  const same = projTabs.active === tab && el("editorView").dataset.ptab === tab;
  projTabs.active = tab;
  saveProjectTabs();
  if (same) { consumeTabPendingDoc(tab); stepQuillNav(); }   // tab yang sama: panel tidak dibangun ulang
  else showTabPanel(tab);
  renderProjectTabs();
  noteTabVisit(tab);
}
function insertProjectTab(tab, atEnd) {
  const i = projTabs.open.indexOf(projTabs.active);
  if (atEnd || i < 0) projTabs.open.push(tab); else projTabs.open.splice(i + 1, 0, tab);
}
// tampilkan panel milik tab (null = semua ditutup -> layar kosong). Isi lama switchTab().
function showTabPanel(tab) {
  const panel = tab ? TAB_BY_ID[tab].panel : null;
  if (panel !== "home" && window.NovelHome) window.NovelHome.hide();   // Beranda: simpan teks yang diedit + lepas kanvas
  if (panel === "home") { flushCurrentEdits(); renderProjectHome(); }
  if (panel !== "jejaring" && window.NovelJejaring) window.NovelJejaring.hide();   // Jejaring: simpan nama yang diedit + lepas kanvas
  if (panel === "jejaring") { flushCurrentEdits(); renderJejaringTab(); }
  if (panel === "write") setWriteModeQuiet(tab === "quill" ? "quill" : "scene");
  else if (window.NovelQuill) window.NovelQuill.hide();   // Quill: simpan + bersihkan sebelum tab lain tampil
  TAB_PANELS.forEach((t) => el("tab" + capitalize(t)).classList.toggle("hidden", t !== panel));
  el("tabEmpty").classList.toggle("hidden", !!panel);
  el("editorView").dataset.tab = panel || "empty";
  el("editorView").dataset.ptab = tab || "";
  if (panel === "write") applyWriteMode();   // Quill: tampilkan mode Scene / Quill sesuai tabnya
  updateSceneDrawerVisibility();
  muteTimelineKeys(panel !== "timeline");
  if (panel !== "map" && window.NovelMap) window.NovelMap.hide();   // hentikan render loop 3D
  if (panel === "timeline") openTimelineTab();
  if (panel === "map") openMapTab();
  if (!panel) renderTabEmpty();
}
// mode Scene/Quill kini mengikuti tab (Tulis / Quill) — tidak menandai project berubah (bukan isi cerita)
function setWriteModeQuiet(mode) {
  const p = getProject(currentProjectId);
  if (!p || writeMode(p) === mode) return;
  flushCurrentEdits();
  if (mode === "quill" && !p.data.quill) p.data.quill = { mode: "quill", stories: [] };
  if (p.data.quill) p.data.quill.mode = mode;
}
function closeProjectTab(tab) {
  const i = projTabs.open.indexOf(tab);
  if (i < 0) return;
  projTabs.open.splice(i, 1);
  if (projTabs.active !== tab) { saveProjectTabs(); renderProjectTabs(); return; }
  const next = projTabs.open[i] || projTabs.open[i - 1] || null;   // tab aktif ditutup -> tetangga kanan, lalu kiri
  if (next) { switchTab(next); return; }
  projTabs.active = null;
  saveProjectTabs();
  showTabPanel(null);
  renderProjectTabs();
}
function moveProjectTab(tab, delta) {
  const i = projTabs.open.indexOf(tab), j = i + delta;
  if (i < 0 || j < 0 || j >= projTabs.open.length) return;
  projTabs.open.splice(i, 1);
  projTabs.open.splice(j, 0, tab);
  saveProjectTabs();
  renderProjectTabs();
}
function renderProjectTabs() {
  renderTabStrip();
  if (tabSidebarVisible()) renderTabSidebar();
}

// ---- bar tab (atas; bar bawah di HP) ----
function buildTabNode(id) {
  const d = TAB_BY_ID[id];
  const n = document.createElement("div");
  n.className = "ptab";
  n.dataset.tab = id;
  n.innerHTML = `<button type="button" class="ptab-btn" role="tab" id="ptab-${id}" aria-controls="tabContent" aria-keyshortcuts="Delete">` +
    `<span class="ptab-ic">${tiPx(d.icon, 17)}</span><span class="ptab-lw"><span class="ptab-label"><span class="ptab-text">${d.name}</span></span></span></button>` +
    `<button type="button" class="ptab-x" tabindex="-1" aria-hidden="true" title="Tutup (klik tengah juga bisa)">${tiPx(tiIcon("x"), 12)}</button>`;
  return n;
}
function renderTabStrip() {
  const strip = el("tabStrip");
  const anim = !tabReduceMq.matches && !el("editorView").classList.contains("tsb-no-anim");
  const nodes = new Map();
  strip.querySelectorAll(".ptab").forEach((n) => { if (!n.classList.contains("is-leaving")) nodes.set(n.dataset.tab, n); });
  nodes.forEach((n, id) => { if (!projTabs.open.includes(id)) leaveTabNode(n, anim); });
  let prev = null;
  projTabs.open.forEach((id) => {
    let n = nodes.get(id);
    const fresh = !n;
    if (fresh) n = buildTabNode(id);
    const want = prev ? prev.nextSibling : strip.firstChild;
    if (n !== want) strip.insertBefore(n, want);
    const on = id === projTabs.active, b = n.firstElementChild;
    n.classList.toggle("is-active", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
    b.tabIndex = on ? 0 : -1;
    if (on) delete b.dataset.tip; else b.dataset.tip = TAB_BY_ID[id].name;
    if (fresh && anim) enterTabNode(n);
    prev = n;
  });
  if (!projTabs.active) { const f = strip.querySelector(".ptab:not(.is-leaving) .ptab-btn"); if (f) f.tabIndex = 0; }
  el("btnAddTab").classList.toggle("is-alone", !projTabs.open.length);
  revealActiveTab();
  setTimeout(revealActiveTab, 340);   // setelah pill aktif selesai melebar
}
// tab baru: melebar dari 0 sampai lebar aslinya; tab ditutup: menyusut lalu dilepas
function enterTabNode(n) {
  const w = n.scrollWidth;
  n.classList.add("is-entering");
  n.style.maxWidth = "0px";
  void n.offsetWidth;
  n.classList.remove("is-entering");
  n.style.maxWidth = w + 40 + "px";
  setTimeout(() => { n.style.maxWidth = ""; }, 360);
}
function leaveTabNode(n, anim) {
  if (!anim) { n.remove(); return; }
  n.style.maxWidth = n.offsetWidth + "px";
  void n.offsetWidth;
  n.classList.add("is-leaving");
  n.setAttribute("aria-hidden", "true");
  n.inert = true;
  n.style.maxWidth = "0px";
  setTimeout(() => n.remove(), 300);
}
// tab aktif selalu terlihat walau bar tab digulir (banyak tab / layar sempit) + bayangan tepi saat bisa digulir
function revealActiveTab() {
  const strip = el("tabStrip");
  const a = strip.querySelector(".ptab.is-active");
  if (a && strip.scrollWidth > strip.clientWidth + 1) {
    const l = a.offsetLeft, r = l + a.offsetWidth, sl = strip.scrollLeft, w = strip.clientWidth;
    if (l < sl + 8) strip.scrollTo({ left: Math.max(0, l - 8), behavior: tabReduceMq.matches ? "auto" : "smooth" });
    else if (r > sl + w - 8) strip.scrollTo({ left: r - w + 8, behavior: tabReduceMq.matches ? "auto" : "smooth" });
  }
  updateTabStripFade();
}
function updateTabStripFade() {
  const s = el("tabStrip");
  s.classList.toggle("fade-l", s.scrollLeft > 2);
  s.classList.toggle("fade-r", s.scrollLeft + s.clientWidth < s.scrollWidth - 2);
}

// ---- seret untuk mengurutkan (mouse/pen; sentuhan dipakai untuk menggulir bar tab). axis "x" | "y" ----
function makeTabSortable(container, itemSel, axis, onDrop, enabled) {
  const X = axis === "x", T = X ? "translateX" : "translateY";
  const pos = (e) => (X ? e.clientX : e.clientY);
  const items = () => [...container.querySelectorAll(itemSel)].filter((n) => !n.classList.contains("is-leaving"));
  let d = null;
  container.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || e.pointerType === "touch" || (enabled && !enabled())) return;
    const item = e.target.closest(itemSel);
    if (!item || item.classList.contains("is-leaving") || e.target.closest(".ptab-x, .tsb-row-x")) return;
    d = { item, id: e.pointerId, start: pos(e), on: false, grab: 0, tx: 0, order0: items().map((n) => n.dataset.tab) };
  });
  container.addEventListener("pointermove", (e) => {
    if (!d || e.pointerId !== d.id) return;
    if (!d.on) {
      if (Math.abs(pos(e) - d.start) < 6) return;
      const r = d.item.getBoundingClientRect();
      d.on = true;
      d.grab = d.start - (X ? r.left : r.top);
      d.item.classList.add("is-dragging");
      container.classList.add("is-sorting");
      try { container.setPointerCapture(e.pointerId); } catch (err) { /* abaikan */ }
      hideTabTip();
    }
    e.preventDefault();
    const place = () => {
      const r = d.item.getBoundingClientRect();
      d.tx = pos(e) - d.grab - ((X ? r.left : r.top) - d.tx);
      d.item.style.transform = `${T}(${d.tx}px)`;
      return r;
    };
    const r = place();
    const center = pos(e) - d.grab + (X ? r.width : r.height) / 2;
    const sibs = items().filter((n) => n !== d.item);
    const before = sibs.find((s) => { const sr = s.getBoundingClientRect(); return center < (X ? sr.left + sr.width / 2 : sr.top + sr.height / 2); }) || null;
    const nextNow = items()[items().indexOf(d.item) + 1] || null;
    if (before === nextNow) return;
    const old = new Map(sibs.map((s) => [s, s.getBoundingClientRect()]));
    if (before) container.insertBefore(d.item, before);
    else if (sibs.length) container.insertBefore(d.item, sibs[sibs.length - 1].nextSibling);
    place();
    if (!tabReduceMq.matches) sibs.forEach((s) => {   // FLIP: tetangga meluncur ke tempat barunya
      const a = old.get(s), b = s.getBoundingClientRect(), dd = X ? a.left - b.left : a.top - b.top;
      if (Math.abs(dd) > 0.5) s.animate([{ transform: `${T}(${dd}px)` }, { transform: "none" }], { duration: 170, easing: "cubic-bezier(.2,.8,.2,1)" });
    });
  });
  const end = (e) => {
    if (!d || e.pointerId !== d.id) return;
    const was = d;
    d = null;
    if (!was.on) return;
    container.classList.remove("is-sorting");
    was.item.classList.remove("is-dragging");
    was.item.style.transform = "";
    if (was.tx && !tabReduceMq.matches) was.item.animate([{ transform: `${T}(${was.tx}px)` }, { transform: "none" }], { duration: 180, easing: "cubic-bezier(.2,.8,.2,1)" });
    container.dataset.dragged = "1";   // klik setelah seret tidak dihitung
    setTimeout(() => { delete container.dataset.dragged; }, 0);
    const order = items().map((n) => n.dataset.tab);
    if (order.join() !== was.order0.join()) onDrop(order);
  };
  container.addEventListener("pointerup", end);
  container.addEventListener("pointercancel", end);
}

// ---- tooltip kecil untuk tombol ber-data-tip (tab bulat, +, sidebar). Satu elemen, mengambang di #editorView ----
let tabTipEl = null, tabTipFor = null;
function showTabTip(t) {
  const v = el("editorView");
  if (!tabTipEl) { tabTipEl = document.createElement("div"); tabTipEl.className = "ptab-tip"; tabTipEl.setAttribute("aria-hidden", "true"); v.appendChild(tabTipEl); }
  tabTipFor = t;
  tabTipEl.textContent = t.dataset.tip;
  const r = t.getBoundingClientRect(), vr = v.getBoundingClientRect();
  const w = tabTipEl.offsetWidth, h = tabTipEl.offsetHeight;
  const up = t.dataset.tipPos === "top" || r.bottom + h + 12 > vr.bottom;
  const top = up ? r.top - vr.top - h - 8 : r.bottom - vr.top + 8;
  const left = Math.max(6, Math.min(vr.width - w - 6, r.left - vr.left + r.width / 2 - w / 2));
  tabTipEl.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  tabTipEl.classList.add("is-on");
}
function hideTabTip() { tabTipFor = null; if (tabTipEl) tabTipEl.classList.remove("is-on"); }

// ---- jendela "Tambah tab" ----
let tpItems = [], tpIndex = 0, tpPrevFocus = null, tpHideTimer = null;
function openTabPicker(query) {
  if (!currentProjectId) return;
  if (tabSbDrawer) toggleTabSidebar(false);
  hideTabTip();
  tpPrevFocus = document.activeElement;
  clearTimeout(tpHideTimer);
  const o = el("tabPicker");
  el("tpSearch").value = query || "";
  o.classList.remove("hidden");
  el("btnAddTab").setAttribute("aria-expanded", "true");
  renderTabPicker(true);
  void o.offsetWidth;
  o.classList.add("is-open");
  el("tpSearch").focus();
  if (window.NovelScroll && typeof window.NovelScroll.attach === "function" && !el("tpGrid").dataset.scrollAttached) {
    try { window.NovelScroll.attach(el("tpGrid")); el("tpGrid").dataset.scrollAttached = "1"; } catch (e) { /* opsional */ }
  }
  document.addEventListener("keydown", tabPickerKeys, true);
}
function closeTabPicker(restoreFocus = true) {
  const o = el("tabPicker");
  if (o.classList.contains("hidden")) return;
  o.classList.remove("is-open");
  document.removeEventListener("keydown", tabPickerKeys, true);
  el("btnAddTab").setAttribute("aria-expanded", "false");
  if (tabReduceMq.matches) o.classList.add("hidden");
  else tpHideTimer = setTimeout(() => o.classList.add("hidden"), 200);
  if (restoreFocus && tpPrevFocus && tpPrevFocus.isConnected) tpPrevFocus.focus();
}
function isTabPickerOpen() { return !el("tabPicker").classList.contains("hidden") && el("tabPicker").classList.contains("is-open"); }
function renderTabPicker(reset) {
  const q = el("tpSearch").value.trim().toLowerCase();
  tpItems = TAB_DEFS.filter((d) => !q || (d.name + " " + d.desc + " " + d.id).toLowerCase().includes(q));
  if (reset || tpIndex >= tpItems.length) tpIndex = 0;
  el("tpGrid").innerHTML = tpItems.map((d, i) => {
    const isOpen = projTabs.open.includes(d.id), on = i === tpIndex;
    return `<div class="tp-card${on ? " is-active" : ""}${isOpen ? " is-open" : ""}" role="option" id="tp-opt-${d.id}" data-tab="${d.id}" aria-selected="${on}">` +
      `<span class="tp-card-ic">${tiPx(d.icon, 20)}</span>` +
      `<span class="tp-card-text"><span class="tp-card-name">${d.name}${isOpen ? '<span class="tp-badge">Terbuka</span>' : ""}</span><span class="tp-card-desc">${d.desc}</span></span></div>`;
  }).join("");
  el("tpEmpty").classList.toggle("hidden", tpItems.length > 0);
  if (tpItems.length) el("tpSearch").setAttribute("aria-activedescendant", "tp-opt-" + tpItems[tpIndex].id);
  else el("tpSearch").removeAttribute("aria-activedescendant");
}
function setTabPickerIndex(i) {
  if (!tpItems.length) return;
  tpIndex = Math.max(0, Math.min(tpItems.length - 1, i));
  el("tpGrid").querySelectorAll(".tp-card").forEach((c, k) => { c.classList.toggle("is-active", k === tpIndex); c.setAttribute("aria-selected", k === tpIndex ? "true" : "false"); });
  el("tpSearch").setAttribute("aria-activedescendant", "tp-opt-" + tpItems[tpIndex].id);
  const c = el("tpGrid").children[tpIndex];
  if (c) c.scrollIntoView({ block: "nearest" });
}
function tabPickerCols() {
  const cards = el("tpGrid").children;
  if (!cards.length) return 1;
  let n = 0;
  for (const c of cards) { if (c.offsetTop !== cards[0].offsetTop) break; n++; }
  return Math.max(1, n);
}
function chooseTabPicker(id) {
  if (!TAB_BY_ID[id]) return;
  closeTabPicker(false);
  if (!projTabs.open.includes(id)) insertProjectTab(id, true);   // dari "+": tab baru di ujung kanan
  switchTab(id);
  const b = el("ptab-" + id);
  if (b) b.focus({ preventScroll: true });
}
function tabPickerKeys(e) {
  if (!isTabPickerOpen()) return;
  const k = e.key;
  if (k === "Escape") { e.preventDefault(); e.stopPropagation(); closeTabPicker(); return; }
  if (k === "Tab") {   // jebakan fokus: kolom cari <-> tombol tutup
    const f = [el("tpSearch"), el("tpClose")];
    const i = f.indexOf(document.activeElement);
    e.preventDefault();
    f[(i + (e.shiftKey ? f.length - 1 : 1) + f.length) % f.length].focus();
    return;
  }
  if (document.activeElement !== el("tpSearch")) return;
  const empty = !el("tpSearch").value;
  if (k === "ArrowDown") { e.preventDefault(); setTabPickerIndex(tpIndex + tabPickerCols()); }
  else if (k === "ArrowUp") { e.preventDefault(); setTabPickerIndex(tpIndex - tabPickerCols()); }
  else if (k === "ArrowRight" && empty) { e.preventDefault(); setTabPickerIndex(tpIndex + 1); }
  else if (k === "ArrowLeft" && empty) { e.preventDefault(); setTabPickerIndex(tpIndex - 1); }
  else if (k === "Enter") { e.preventDefault(); if (tpItems[tpIndex]) chooseTabPicker(tpItems[tpIndex].id); }
}

// ---- layar kosong (semua tab ditutup) ----
function renderTabEmpty() {
  const p = getProject(currentProjectId);
  if (!p) return;
  el("teTitle").textContent = el("projectTitle").value || p.title || "";
  el("teCover").style.backgroundImage = el("projChipCover").style.backgroundImage;
  el("teCover").textContent = el("projChipCover").textContent;
  const q = el("teSearch").value.trim().toLowerCase();
  const list = TAB_DEFS.filter((d) => (q ? (d.name + " " + d.desc).toLowerCase().includes(q) : teMore || TAB_EMPTY_MAIN.includes(d.id)));
  el("teChips").innerHTML = list.map((d) => `<button type="button" class="te-chip" data-tab="${d.id}">${tiPx(d.icon, 16)}<span>${d.name}</span></button>`).join("") +
    (q && !list.length ? '<p class="te-none">Tidak ada fitur yang cocok.</p>' : "") +
    (q ? "" : `<div class="te-more-row"><button type="button" class="te-chip te-more" data-act="more" aria-expanded="${teMore}">${tiPx(tiIcon(teMore ? "chevron-up" : "chevron-down"), 16)}<span>${teMore ? "Lebih sedikit" : "Lainnya"}</span></button></div>`);
}
function openTabFromEmpty(id) {
  if (!projTabs.open.includes(id)) insertProjectTab(id, true);
  el("teSearch").value = "";
  switchTab(id);
}

// ---- sidebar tab: daftar tab terbuka + riwayat ----
function tabSidebarVisible() { return tabNarrowMq.matches ? tabSbDrawer : tabSbDocked; }
function applyTabSidebar() {
  const v = el("editorView"), narrow = tabNarrowMq.matches, open = tabSidebarVisible();
  v.classList.toggle("tsb-docked", !narrow && tabSbDocked);
  v.classList.toggle("tsb-drawer-open", narrow && tabSbDrawer);
  el("tabSidebar").setAttribute("aria-hidden", open ? "false" : "true");
  el("tabSidebar").inert = !open;
  el("tabSidebarScrim").classList.toggle("is-open", narrow && tabSbDrawer);
  const b = el("btnTabSidebar");
  b.setAttribute("aria-expanded", open ? "true" : "false");
  b.setAttribute("aria-label", open ? "Tutup sidebar tab" : "Buka sidebar tab");
  b.dataset.tip = open ? "Tutup sidebar" : "Buka sidebar";
  b.classList.toggle("is-open", open);
  if (open) {
    renderTabSidebar();
    if (window.NovelScroll && typeof window.NovelScroll.attach === "function" && !el("tsbScroll").dataset.scrollAttached) {
      try { window.NovelScroll.attach(el("tsbScroll")); el("tsbScroll").dataset.scrollAttached = "1"; } catch (e) { /* opsional */ }
    }
  }
}
function toggleTabSidebar(force) {
  const narrow = tabNarrowMq.matches;
  const next = typeof force === "boolean" ? force : !tabSidebarVisible();
  const hadFocus = el("tabSidebar").contains(document.activeElement);
  if (narrow) tabSbDrawer = next;
  else { tabSbDocked = next; tabStoreSet("novelist_tabsidebar", next); }
  hideTabTip();
  applyTabSidebar();
  if (!next && hadFocus) el("btnTabSidebar").focus();
  if (next && narrow) { const f = el("tabSidebar").querySelector(".tsb-row-main") || el("tsbCollapse"); setTimeout(() => f.focus({ preventScroll: true }), 30); }
}
// label dokumen yang sedang dibuka di sebuah tab (baris "Terbuka" di sidebar)
function tabCurrentDoc(tab) {
  const p = getProject(currentProjectId);
  if (!p) return null;
  if (tab === "write") { const s = currentSceneId ? findScene(currentSceneId) : null; return s && s.type !== "folder" ? { doc: s.id, kind: "scene", title: s.title } : null; }
  if (tab === "organize") {
    const it = currentOrgItemId ? (p.data.organize[currentOrgCat] || []).find((x) => x.id === currentOrgItemId) : null;
    return it ? { doc: it.id, kind: currentOrgCat, title: it.title } : null;
  }
  const last = tabLastDoc[tab];
  return last && tabDocInfo(p, Object.assign({ tab }, last)) ? last : null;
}
// judul terkini dokumen di riwayat; null = dokumennya sudah dihapus
function tabDocInfo(p, h) {
  if (!h.doc) return { title: TAB_BY_ID[h.tab].name };
  const d = p.data;
  let x = null;
  if (h.tab === "write") { x = findScene(h.doc); if (x && x.type === "folder") x = null; }
  else if (h.tab === "organize") x = ((d.organize || {})[h.kind] || []).find((i) => i && i.id === h.doc);
  else if (h.tab === "timeline") x = (d.timelines || []).find((t) => t && t.id === h.doc);
  else if (h.tab === "map") x = (d.maps || []).find((m) => m && m.id === h.doc);
  else if (h.tab === "quill") x = ((d.quill && d.quill.stories) || []).find((s) => s && s.id === h.doc);
  else if (h.tab === "home") x = ((d.canvas && Array.isArray(d.canvas.boards) && d.canvas.boards) || []).find((b) => b && b.id === h.doc && b.id !== "home");
  else if (h.tab === "jejaring") x = ((d.jejaring && Array.isArray(d.jejaring.docs) && d.jejaring.docs) || []).find((j) => j && j.id === h.doc);
  if (!x) return null;
  return { title: String(x.title || "").trim() || (h.tab === "quill" ? "Cerita tanpa judul" : "(tanpa judul)") };
}
function renderTabSidebar() {
  const p = getProject(currentProjectId);
  if (!p) return;
  const q = el("tsbSearch").value.trim().toLowerCase();
  const has = (s) => !q || String(s || "").toLowerCase().includes(q);
  const x14 = tiPx(tiIcon("x"), 14);
  // Terbuka
  const open = projTabs.open.map((id) => ({ id, d: TAB_BY_ID[id], doc: tabCurrentDoc(id) })).filter((r) => has(r.d.name) || (r.doc && has(r.doc.title)));
  el("tsbOpenCount").textContent = projTabs.open.length ? String(projTabs.open.length) : "";
  el("tsbOpenList").innerHTML = open.map((r) => {
    const on = r.id === projTabs.active;
    return `<div class="tsb-row${on ? " is-active" : ""}" role="listitem" data-tab="${r.id}">` +
      `<button type="button" class="tsb-row-main" data-act="tab"${on ? ' aria-current="true"' : ""}><span class="tsb-row-ic">${tiPx(r.d.icon, 16)}</span>` +
      `<span class="tsb-row-text"><span class="tsb-row-name">${r.d.name}</span>${r.doc ? `<span class="tsb-row-sub">${escapeHtml(r.doc.title || "(tanpa judul)")}</span>` : ""}</span></button>` +
      `<button type="button" class="tsb-row-x" data-act="close" aria-label="Tutup tab ${r.d.name}">${x14}</button></div>`;
  }).join("") || (q ? '<p class="tsb-empty-line">Tidak ada yang cocok.</p>'
    : `<div class="tsb-empty"><span class="tsb-empty-ic">${tiPx(tiIcon("layout-grid-add"), 20)}</span><p>Semua tab ditutup.</p><button type="button" class="tsb-empty-btn" data-act="add">${tiPx(tiIcon("plus"), 14)}<span>Tambah tab</span></button></div>`);
  // Riwayat (dokumen yang sudah dihapus tidak ditampilkan)
  tabHistRows = [];
  tabHist.forEach((h) => {
    const info = tabDocInfo(p, h);
    if (!info) return;
    const tabName = TAB_BY_ID[h.tab].name;
    if (has(info.title) || has(tabName)) tabHistRows.push({ h, title: info.title, tabName });
  });
  el("tsbClearHist").hidden = !tabHist.length;
  el("tsbHistList").innerHTML = tabHistRows.map((r, i) => {
    const icon = r.h.doc ? TAB_DOC_ICONS[r.h.kind] || TAB_BY_ID[r.h.tab].icon : TAB_BY_ID[r.h.tab].icon;
    return `<div class="tsb-row tsb-hist" role="listitem" data-i="${i}">` +
      `<button type="button" class="tsb-row-main" data-act="hist"><span class="tsb-row-ic">${tiPx(icon, 16)}</span>` +
      `<span class="tsb-row-text"><span class="tsb-row-name">${escapeHtml(r.title)}</span><span class="tsb-row-sub">${r.h.doc ? r.tabName + " · " : ""}<span class="tsb-time" data-t="${r.h.t}">${timeAgo(r.h.t)}</span></span></span></button>` +
      `<button type="button" class="tsb-row-x" data-act="del" aria-label="Hapus dari riwayat">${x14}</button></div>`;
  }).join("") || (q && tabHist.length ? '<p class="tsb-empty-line">Tidak ada yang cocok.</p>'
    : `<div class="tsb-empty"><span class="tsb-empty-ic">${tiPx(tiIcon("history"), 20)}</span><p>Belum ada riwayat</p><span class="tsb-empty-hint">Tab, scene, timeline, peta &amp; cerita yang kamu buka akan muncul di sini.</span></div>`);
  // baris ikon bawah
  el("tsbQuick").querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("is-on", b.dataset.tab === projTabs.active));
}
function refreshTabHistTimes() {
  if (!tabSidebarVisible() || el("editorView").classList.contains("hidden")) return;
  el("tsbHistList").querySelectorAll(".tsb-time").forEach((s) => { s.textContent = timeAgo(Number(s.dataset.t)); });
}

// ---- riwayat ----
// kunjungan tab ditunda sebentar: kalau dokumen di tab itu langsung dibuka (mis. Beranda -> scene), cukup dokumennya
function noteTabVisit(tab) {
  tabVisitPending = { tab, pid: currentProjectId };
  clearTimeout(tabVisitTimer);
  tabVisitTimer = setTimeout(() => {
    const v = tabVisitPending;
    tabVisitPending = null;
    if (!v || v.pid !== currentProjectId || projTabs.active !== v.tab) return;
    pushTabHist(Object.assign({ tab: v.tab }, tabCurrentDoc(v.tab) || {}));
  }, 0);
}
// dokumen dibuka di dalam tab (scene, item Organize, timeline, peta, cerita Quill). doc = { doc, kind, title }
function noteTabDoc(tab, doc) {
  if (!currentProjectId || !doc || !doc.doc) return;
  if (tab === "timeline" || tab === "map" || tab === "quill" || tab === "home" || tab === "jejaring") tabLastDoc[tab] = { doc: doc.doc, kind: doc.kind, title: doc.title };
  if (projTabs.active !== tab) return;
  if (tabVisitPending && tabVisitPending.tab === tab) tabVisitPending = null;
  pushTabHist(Object.assign({ tab }, doc));
}
function pushTabHist(e) {
  const k = e.tab + ":" + (e.doc || "");
  if (e.doc && tabHist[0] && tabHist[0].tab === e.tab && !tabHist[0].doc) tabHist.shift();   // kunjungan tab polos -> diganti dokumennya
  tabHist = tabHist.filter((h) => h.k !== k);
  tabHist.unshift({ k, tab: e.tab, doc: e.doc || null, kind: e.kind || null, title: String(e.title || "").slice(0, 120), t: Date.now() });
  if (tabHist.length > TAB_HIST_MAX) tabHist.length = TAB_HIST_MAX;
  saveTabHist();
  if (tabSidebarVisible()) renderTabSidebar();
}
function removeTabHist(k) { tabHist = tabHist.filter((h) => h.k !== k); saveTabHist(); renderTabSidebar(); }
// buka lagi entri riwayat: tabnya (dibuka kalau tertutup) + dokumennya
function openTabHist(h) {
  const p = getProject(currentProjectId);
  if (!p) return;
  if (h.doc && !tabDocInfo(p, h)) { removeTabHist(h.k); switchTab(h.tab); return; }
  if (!h.doc) { switchTab(h.tab); return; }
  if (h.tab === "write") openSceneInWrite(h.doc);
  else if (h.tab === "organize") {
    switchTab("organize");
    if (currentOrgCat !== h.kind) switchOrganizeCat(h.kind);
    if (currentOrgItemId !== h.doc) { syncOrganizeFromDetail(); currentOrgItemId = h.doc; renderOrganizeList(); renderOrganizeDetail(); }
  } else if (h.tab === "timeline" || h.tab === "map" || h.tab === "home" || h.tab === "jejaring") { tabPendingDoc = { tab: h.tab, id: h.doc }; switchTab(h.tab); }
  else if (h.tab === "quill") { quillNav = { id: h.doc, steps: 0 }; switchTab("quill"); }
}
// timeline/peta dari riwayat: dibuka setelah modulnya tampil (openTimelineTab/openMapTab memanggil ini)
function consumeTabPendingDoc(tab) {
  const d = tabPendingDoc;
  if (!d || d.tab !== tab) return;
  const api = tab === "timeline" ? window.NovelTimeline : tab === "home" ? window.NovelHome : tab === "jejaring" ? window.NovelJejaring : window.NovelMap;
  if (!api || typeof api.open !== "function" || el("tab" + capitalize(tab)).classList.contains("hidden")) return;
  tabPendingDoc = null;
  if (d.act === "new") { if (typeof api.create === "function") api.create(); return; }   // Beranda → "Buat jejaring baru"
  api.open(d.id);
}
// Quill: catat cerita yang dibuka (hook "screen") + jalankan navigasi dari riwayat langkah demi langkah
function onQuillScreen(e) {
  if (!e || !e.project || e.project.id !== currentProjectId) return;
  quillScreen = { view: e.view, storyId: e.story ? e.story.id : null };
  if (!e.view) return;   // Quill disembunyikan
  if (e.story) noteTabDoc("quill", { doc: e.story.id, kind: "story", title: String(e.story.title || "").trim() || "Cerita tanpa judul" });
  else if (e.view === "library") tabLastDoc.quill = null;
  stepQuillNav();
}
function stepQuillNav() {
  const nav = quillNav;
  if (!nav || projTabs.active !== "quill" || !quillScreen || !quillScreen.view) return;
  const v = quillScreen.view, host = el("quillRoot");
  // form cerita baru (jangan buang isiannya) / terlalu banyak langkah -> selesai
  if (v === "create" || nav.steps++ > 6) { quillNav = null; return; }
  if (quillScreen.storyId === nav.id) {   // sudah di cerita itu; chapter tertentu (titik jejak / kartu di Beranda) -> buka chapternya
    if (nav.page && v === "editor" && !nav.pageDone) {   // Beranda -> cerita: kembali ke halaman ceritanya
      const tb = host.querySelector('[data-act="tostory"]');
      nav.pageDone = true;
      if (tb) { setTimeout(() => { if (quillNav === nav && tb.isConnected) tb.click(); }, 0); return; }
    }
    const cb = nav.ch && !nav.chDone && (v === "story" || v === "editor") ? [...host.querySelectorAll('[data-act="opench"]')].find((b) => b.dataset.id === nav.ch) : null;
    if (!cb) { quillNav = null; return; }
    nav.chDone = true;
    setTimeout(() => { if (quillNav === nav && cb.isConnected) cb.click(); if (v === "editor" && quillNav === nav) quillNav = null; }, 0);
    return;
  }
  const btn = v === "library" ? [...host.querySelectorAll('.qd-card[data-act="open"]')].find((b) => b.dataset.id === nav.id)
    : host.querySelector('.qd-back[data-act="back"], [data-act="tostory"]');
  if (!btn) { quillNav = null; return; }
  setTimeout(() => { if (quillNav === nav && btn.isConnected) btn.click(); }, 0);   // klik setelah hook layar selesai
}

// ---- pasang semua event (dipanggil sekali saat halaman siap) ----
function initProjectTabs() {
  tabSbDocked = tabStoreGet("novelist_tabsidebar") === true;
  const strip = el("tabStrip");
  strip.addEventListener("click", (e) => {
    if (strip.dataset.dragged) return;
    const n = e.target.closest(".ptab");
    if (!n || n.classList.contains("is-leaving")) return;
    if (e.target.closest(".ptab-x")) closeProjectTab(n.dataset.tab);
    else switchTab(n.dataset.tab);
  });
  strip.addEventListener("mousedown", (e) => { if (e.button === 1 && e.target.closest(".ptab")) e.preventDefault(); });   // tanpa autoscroll
  strip.addEventListener("auxclick", (e) => {
    const n = e.target.closest(".ptab");
    if (e.button === 1 && n && !n.classList.contains("is-leaving")) { e.preventDefault(); closeProjectTab(n.dataset.tab); }
  });
  strip.addEventListener("keydown", (e) => {
    const b = e.target.closest(".ptab-btn");
    if (!b) return;
    const id = b.parentElement.dataset.tab;
    const btns = [...strip.querySelectorAll(".ptab:not(.is-leaving) .ptab-btn")];
    const i = btns.indexOf(b);
    if (e.altKey && e.shiftKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {   // Alt+Shift+panah: pindahkan tab
      e.preventDefault();
      moveProjectTab(id, e.key === "ArrowLeft" ? -1 : 1);
      const nb = el("ptab-" + id); if (nb) { nb.tabIndex = 0; nb.focus(); }
      return;
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      closeProjectTab(id);
      const left = [...strip.querySelectorAll(".ptab:not(.is-leaving) .ptab-btn")];
      const f = left[Math.min(i, left.length - 1)] || el("btnAddTab");
      f.focus();
      return;
    }
    let to = null;
    if (e.key === "ArrowRight") to = btns[(i + 1) % btns.length];
    else if (e.key === "ArrowLeft") to = btns[(i - 1 + btns.length) % btns.length];
    else if (e.key === "Home") to = btns[0];
    else if (e.key === "End") to = btns[btns.length - 1];
    if (to) { e.preventDefault(); btns.forEach((x) => { x.tabIndex = x === to ? 0 : -1; }); to.focus(); }
  });
  strip.addEventListener("scroll", updateTabStripFade, { passive: true });
  strip.addEventListener("wheel", (e) => {   // roda mouse vertikal menggulir bar tab ke samping
    if (strip.scrollWidth <= strip.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    e.preventDefault();
    strip.scrollLeft += e.deltaY;
  }, { passive: false });
  window.addEventListener("resize", () => { if (currentProjectId) updateTabStripFade(); });
  makeTabSortable(strip, ".ptab", "x", (order) => { projTabs.open = order.filter((t) => TAB_BY_ID[t]); saveProjectTabs(); renderProjectTabs(); });

  el("btnAddTab").onclick = () => openTabPicker();
  el("btnTabSidebar").onclick = () => toggleTabSidebar();
  el("tsbCollapse").onclick = () => toggleTabSidebar(false);
  el("tabSidebarScrim").onclick = () => toggleTabSidebar(false);
  tabNarrowMq.addEventListener("change", () => { tabSbDrawer = false; if (currentProjectId) applyTabSidebar(); });

  // tooltip
  const v = el("editorView");
  v.addEventListener("pointerover", (e) => {
    if (e.pointerType === "touch") return;
    const t = e.target.closest("[data-tip]");
    if (t && t !== tabTipFor && !document.querySelector(".is-sorting")) showTabTip(t);
    else if (!t && tabTipFor) hideTabTip();
  });
  v.addEventListener("pointerout", (e) => { if (tabTipFor && !tabTipFor.contains(e.relatedTarget)) hideTabTip(); });
  v.addEventListener("focusin", (e) => { const t = e.target.closest("[data-tip]"); if (t && t.matches(":focus-visible")) showTabTip(t); else hideTabTip(); });
  v.addEventListener("focusout", hideTabTip);
  v.addEventListener("pointerdown", hideTabTip, true);
  strip.addEventListener("scroll", hideTabTip, { passive: true });

  // jendela "Tambah tab"
  el("tpSearch").addEventListener("input", () => renderTabPicker(true));
  el("tpClose").onclick = () => closeTabPicker();
  el("tabPicker").addEventListener("click", (e) => { if (e.target === el("tabPicker")) closeTabPicker(); });
  el("tpGrid").addEventListener("click", (e) => { const c = e.target.closest(".tp-card"); if (c) chooseTabPicker(c.dataset.tab); });
  el("tpGrid").addEventListener("pointermove", (e) => {
    const c = e.target.closest(".tp-card");
    if (c && e.pointerType !== "touch") { const i = [...el("tpGrid").children].indexOf(c); if (i !== tpIndex && i >= 0) setTabPickerIndex(i); }
  });

  // layar kosong
  el("teChips").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.act === "more") { teMore = !teMore; renderTabEmpty(); const m = el("teChips").querySelector(".te-more"); if (m) m.focus(); return; }
    if (b.dataset.tab) openTabFromEmpty(b.dataset.tab);
  });
  el("teSearch").addEventListener("input", renderTabEmpty);
  el("teSearch").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { const c = el("teChips").querySelector(".te-chip[data-tab]"); if (c) { e.preventDefault(); openTabFromEmpty(c.dataset.tab); } }
    else if (e.key === "Escape" && el("teSearch").value) { e.preventDefault(); el("teSearch").value = ""; renderTabEmpty(); }
  });
  el("projectTitle").addEventListener("input", () => { if (!projTabs.active) el("teTitle").textContent = el("projectTitle").value; });

  // sidebar
  el("tsbSearch").addEventListener("input", renderTabSidebar);
  el("tabSidebar").addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (document.activeElement === el("tsbSearch") && el("tsbSearch").value) { e.preventDefault(); el("tsbSearch").value = ""; renderTabSidebar(); return; }
    if (tabNarrowMq.matches && tabSbDrawer) { e.preventDefault(); e.stopPropagation(); toggleTabSidebar(false); }
  });
  document.addEventListener("keydown", (e) => {   // Esc menutup laci sidebar (layar sempit) dari mana pun
    if (e.key === "Escape" && tabSbDrawer && tabNarrowMq.matches && !isTabPickerOpen() && !el("editorView").classList.contains("hidden")) toggleTabSidebar(false);
  });
  el("tsbOpenList").addEventListener("click", (e) => {
    if (el("tsbOpenList").dataset.dragged) return;
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.act === "add") { openTabPicker(); return; }
    const row = b.closest(".tsb-row");
    if (!row) return;
    if (b.dataset.act === "close") closeProjectTab(row.dataset.tab);
    else { switchTab(row.dataset.tab); if (tabNarrowMq.matches) toggleTabSidebar(false); }
  });
  el("tsbOpenList").addEventListener("auxclick", (e) => { const row = e.target.closest(".tsb-row"); if (e.button === 1 && row) { e.preventDefault(); closeProjectTab(row.dataset.tab); } });
  makeTabSortable(el("tsbOpenList"), ".tsb-row", "y", (order) => { projTabs.open = order.filter((t) => TAB_BY_ID[t]); saveProjectTabs(); renderProjectTabs(); }, () => !el("tsbSearch").value.trim());
  el("tsbHistList").addEventListener("click", (e) => {
    const b = e.target.closest("button"), row = b && b.closest(".tsb-row");
    const r = row && tabHistRows[Number(row.dataset.i)];
    if (!r) return;
    if (b.dataset.act === "del") { removeTabHist(r.h.k); return; }
    openTabHist(r.h);
    if (tabNarrowMq.matches) toggleTabSidebar(false);
  });
  el("tsbClearHist").onclick = () => { tabHist = []; saveTabHist(); renderTabSidebar(); };
  el("tsbQuick").innerHTML = TAB_QUICK.map((id) => `<button type="button" class="tsb-quick-btn" data-tab="${id}" data-tip="${TAB_BY_ID[id].name}" data-tip-pos="top" aria-label="Buka ${TAB_BY_ID[id].name}">${tiPx(TAB_BY_ID[id].icon, 17)}</button>`).join("") +
    `<span class="tsb-quick-sep" aria-hidden="true"></span><button type="button" class="tsb-quick-btn" data-act="add" data-tip="Tambah tab" data-tip-pos="top" aria-label="Tambah tab" aria-haspopup="dialog">${tiPx(tiIcon("plus"), 17)}</button>`;
  el("tsbQuick").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.act === "add") { openTabPicker(); return; }
    switchTab(b.dataset.tab);
    if (tabNarrowMq.matches) toggleTabSidebar(false);
  });
  setInterval(refreshTabHistTimes, 30000);   // "5 menit lalu" tetap akurat

  // Quill (dimuat belakangan): catat cerita yang dibuka
  (window.__novelQuillReady = window.__novelQuillReady || []).push((api) => { if (api && typeof api.on === "function") api.on("screen", onQuillScreen); });
}

// ---- QUILL (tab Write → tombol "Scene | Quill"): quill.js baru dimuat saat Quill pertama kali dibuka.
// Pilihan mode disimpan per project di p.data.quill.mode ("scene" | "quill"); data cerita di p.data.quill.stories.
let quillLibPromise = null;
function ensureQuillLib() {
  if (!quillLibPromise) {
    // quill-tiles.js = isi panel kanan (alat & tile). Kalau gagal dimuat, Quill tetap jalan tanpa panel.
    quillLibPromise = loadScriptOnce("quill.js").then(() => loadScriptOnce("quill-tiles.js").catch((e) => console.warn("[Quill]", e.message)));
    quillLibPromise.catch(() => { quillLibPromise = null; });   // boleh dicoba lagi
  }
  return quillLibPromise;
}
function writeMode(p) { return p && p.data && p.data.quill && p.data.quill.mode === "quill" ? "quill" : "scene"; }
function applyWriteMode() {
  const p = getProject(currentProjectId);
  const quill = writeMode(p) === "quill";
  el("tabWrite").classList.toggle("is-quill", quill);
  el("quillRoot").classList.toggle("hidden", !quill);
  el("writeModeSwitch").querySelectorAll(".wms-btn").forEach((b) => {
    const on = b.dataset.mode === (quill ? "quill" : "scene");
    b.classList.toggle("is-active", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
  });
  if (quill) openQuillMode();
  else if (window.NovelQuill) window.NovelQuill.hide();
}
// tombol "Scene | Quill" = pindah ke tab Tulis / Quill (TAB PROJECT; tab dibuka otomatis kalau sedang tertutup)
function setWriteMode(mode) { switchTab(mode === "quill" ? "quill" : "write"); }
async function openQuillMode() {
  const root = el("quillRoot");
  if (!window.NovelQuill) root.innerHTML = '<div class="quill-loading">Memuat Quill…</div>';
  try { await ensureQuillLib(); }
  catch (e) { root.innerHTML = '<div class="quill-loading">Quill gagal dimuat. Periksa koneksi lalu buka lagi.</div>'; return; }
  const p = getProject(currentProjectId);
  if (el("tabWrite").classList.contains("hidden") || !p || writeMode(p) !== "quill") return;   // pengguna sudah pindah
  window.NovelQuill.show({
    project: p,
    container: root,
    onChange: markDirtyAndSchedule,
    getUser: () => ({ name: quillUserName() }),
    openTab: (tab) => switchTab(tab),
    getOrganize: () => getProject(currentProjectId)?.data.organize || null,
    getMaps: () => getProject(currentProjectId)?.data.maps || null,
    escapeHtml,
  });
}
// nama penulis untuk Quill: username / nama tampilan akun (bagian AKUN) → bagian depan email Google → "Penulis"
function quillUserName() {
  try {
    if (typeof accountInfo !== "undefined" && accountInfo) {
      const n = (typeof accountUsername === "function" && accountUsername()) || (typeof accountDisplayName === "function" && accountDisplayName());
      if (n) return n;
    }
  } catch (e) { /* abaikan */ }
  return "Penulis";
}
// dari Home/Timeline/Map ke scene tertentu: selalu buka editor Scene
function openSceneInWrite(id) {
  switchTab("write");   // tab Tulis = mode Scene
  selectScene(id);
}
// bab (folder) dari Beranda: tab Tulis, bab terbuka di daftar + scene pertamanya dibuka
function openFolderInWrite(id) {
  const p = getProject(currentProjectId), path = p && twPath(id, p.data.scenes);
  if (!path) return;
  path.forEach((n) => { if (n.type === "folder") expandedFolders.add(n.id); });
  twClearSearch();
  const first = findFirstScene(path[path.length - 1].children || []);
  switchTab("write");
  if (first) selectScene(first.id); else renderSceneList();
  setTimeout(() => twFocusRow(id), 0);   // baris bab disorot
}
// BERANDA (titik jejak & kartu dokumen): buka dokumen apa pun tepat di tempatnya — tab dibuka otomatis bila tertutup,
// lewat jalur yang sama dengan riwayat sidebar tab (openTabHist / consumeTabPendingDoc / navigasi Quill)
function openProjectDoc(kind, id) {
  const p = getProject(currentProjectId);
  if (!p || !id) return;
  if (kind === "scene") { openSceneInWrite(id); return; }
  if (kind === "folder") { openFolderInWrite(id); return; }
  if (kind === "characters" || kind === "locations" || kind === "notes") { openTabHist({ k: "organize:" + id, tab: "organize", doc: id, kind }); return; }
  if (kind === "chapter") {
    const s = ((p.data.quill && p.data.quill.stories) || []).find((x) => x && Array.isArray(x.chapters) && x.chapters.some((c) => c && c.id === id));
    if (!s) return;
    quillNav = { id: s.id, ch: id, steps: 0 };
    switchTab("quill");
    return;
  }
  if (kind === "story") {   // halaman cerita (daftar chapter), juga bila editor chapter cerita itu sedang terbuka
    if (!tabDocInfo(p, { tab: "quill", doc: id })) return;
    quillNav = { id, steps: 0, page: true };
    switchTab("quill");
    return;
  }
  const tab = { timeline: "timeline", map: "map", jejaring: "jejaring" }[kind];
  if (tab) openTabHist({ k: tab + ":" + id, tab, doc: id, kind });
}
// BERANDA (alat Dokumen → "Buat baru"): dokumen baru dibuat dengan struktur data yang sama seperti di tabnya (scene di
// akhir naskah, item Organize, timeline, peta lewat map-core.js, cerita Quill). Mengembalikan id dokumen baru, atau null
// bila pembuatannya diteruskan ke tabnya (Jejaring Tokoh: wizard pilih templat).
async function createProjectDoc(kind, title) {
  const p = getProject(currentProjectId);
  if (!p) return null;
  const d = p.data, t = String(title || "").trim().slice(0, 120), stamp = Date.now();
  const rid = () => stamp.toString(36) + Math.random().toString(36).slice(2, 7);
  let id = null;
  if (kind === "scene") {
    syncSceneFromDetail();
    const all = flattenScenes(d.scenes);
    const node = { id: twNewId("scene"), type: "scene", title: t || twFreeTitle("Scene", all.length + 1, all), synopsis: "", status: "todo", content: "" };
    d.scenes.push(node);
    id = node.id;
    renderSceneList();
  } else if (kind === "characters" || kind === "locations" || kind === "notes") {
    syncOrganizeFromDetail();
    const arr = d.organize[kind] || (d.organize[kind] = []);
    let nid = kind + "-" + stamp;
    while (arr.some((x) => x && x.id === nid)) nid = kind + "-" + stamp + "-" + Math.random().toString(36).slice(2, 6);
    arr.push({ id: nid, title: t || { characters: "Karakter baru", locations: "Lokasi baru", notes: "Catatan baru" }[kind], content: "" });
    id = nid;
    if (currentOrgCat === kind) renderOrganizeList();
  } else if (kind === "timeline") {
    if (!Array.isArray(d.timelines)) d.timelines = [];
    const tl = { id: "tl-" + rid(), title: t || "Timeline Baru", start: 1500, end: 1900, events: [] };
    d.timelines.push(tl);
    id = tl.id;
  } else if (kind === "map") {
    await loadScriptOnce("map-core.js");
    if (getProject(currentProjectId) !== p) return null;   // sudah pindah project
    if (!Array.isArray(d.maps)) d.maps = [];
    const names = new Set(d.maps.map((m) => m && m.title));
    let name = t;
    if (!name) { name = "Peta Baru"; for (let i = 2; names.has(name); i++) name = "Peta Baru " + i; }   // sama dengan tab Map
    const m = window.NovelMapCore.createMap(name);
    d.maps.push(window.NovelMapCore.serialize(m));
    id = m.id;
  } else if (kind === "story") {
    if (!d.quill || typeof d.quill !== "object" || Array.isArray(d.quill)) d.quill = { mode: "scene", stories: [] };
    if (!Array.isArray(d.quill.stories)) d.quill.stories = [];
    const now = new Date().toISOString();
    const s = { id: "story-" + rid(), title: t, author: quillUserName(), createdAt: now, updatedAt: now, chapters: [], panel: {} };   // sampul bawaan diisi quill.js
    d.quill.stories.push(s);
    id = s.id;
  } else if (kind === "jejaring") {
    tabPendingDoc = { tab: "jejaring", id: null, act: "new" };
    switchTab("jejaring");
    return null;
  }
  if (id) markDirtyAndSchedule();
  return id;
}

// React Flow (Timeline) tetap mendengar Delete/Backspace di document walau tabnya tersembunyi, jadi event timeline
// yang masih terpilih ikut terhapus saat tombol itu dipakai di tab lain (mis. menghapus objek di Map).
// Kelas "nokey" di <body> membuat React Flow mengabaikan semua tombol selama tab Timeline tidak tampil.
function muteTimelineKeys(mute) { document.body.classList.toggle("nokey", mute); }

// ---- TIMELINE: React + React Flow (folder vendor/) + timeline.js baru dimuat saat tab ini pertama kali dibuka ----
let timelineLibPromise = null;
// Tiap file hanya dimuat sekali walau diminta beberapa fitur sekaligus (mis. React untuk Timeline & Base UI).
const scriptPromises = {};
function loadScriptOnce(src) {
  if (!scriptPromises[src]) {
    scriptPromises[src] = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src; s.onload = resolve;
      s.onerror = () => { delete scriptPromises[src]; s.remove(); reject(new Error("Gagal memuat " + src)); };   // boleh dicoba lagi
      document.head.appendChild(s);
    });
  }
  return scriptPromises[src];
}
const loadScriptsInOrder = (list) => list.reduce((chain, src) => chain.then(() => loadScriptOnce(src)), Promise.resolve());
// React 18 (UMD, vendor/) dipakai bersama oleh Timeline (React Flow) dan Base UI.
function ensureReact() { return loadScriptsInOrder(["vendor/react-18.3.1.min.js", "vendor/react-dom-18.3.1.min.js"]); }
// Base UI (base-ui.com): komponen React tanpa gaya (Dialog, Popover, Menu, Select, Tabs, Tooltip, Switch, Slider, Toast, ...).
// Dimuat hanya saat dibutuhkan:  const BaseUI = await ensureBaseUI();  lalu render dengan React.createElement + ReactDOM.createRoot.
function ensureBaseUI() {
  return ensureReact().then(() => loadScriptOnce("vendor/base-ui-1.8.0.min.js")).then(() => window.BaseUI);
}
// Radix UI (radix-ui.com): primitive React tanpa gaya -> window.RadixUI (Dialog, Popover, DropdownMenu, Tabs, Slot, ...)
function ensureRadixUI() {
  return ensureReact().then(() => loadScriptOnce("vendor/radix-ui-1.6.7.min.js")).then(() => window.RadixUI);
}
// shadcn/ui (ui.shadcn.com): komponen siap pakai bergaya Tailwind (kode sumber di components/ui, dibangun oleh
// tools/build-vendor.mjs) -> window.ShadcnUI (Button, Card, Dialog, Select, Tabs, Tooltip, ..., cn).
// CSS-nya sudah ada di vendor/tailwind.css. Tema terang/gelap otomatis mengikuti tema aplikasi (body.light).
function ensureShadcnUI() {
  return ensureReact().then(() => loadScriptOnce("vendor/shadcn-ui.min.js")).then(() => window.ShadcnUI);
}
function ensureTimelineLib() {
  if (!timelineLibPromise) {
    timelineLibPromise = ensureReact().then(() => loadScriptsInOrder(["vendor/reactflow-11.11.4.umd.js", "timeline.js"]));
    timelineLibPromise.catch(() => { timelineLibPromise = null; });   // boleh dicoba lagi
  }
  return timelineLibPromise;
}
async function openTimelineTab() {
  try { await ensureTimelineLib(); }
  catch (e) { el("tlFlow").innerHTML = '<div class="tl-loading">Timeline gagal dimuat. Periksa koneksi lalu buka tab ini lagi.</div>'; return; }
  if (el("tabTimeline").classList.contains("hidden") || !currentProjectId) return;   // pengguna sudah pindah tab
  window.NovelTimeline.show({
    project: getProject(currentProjectId),
    onChange: markDirtyAndSchedule,
    getScenes: () => flattenScenes(getProject(currentProjectId).data.scenes),
    openScene: (id) => openSceneInWrite(id),
    onOpen: (id) => {   // TAB PROJECT: riwayat
      const t = (getProject(currentProjectId).data.timelines || []).find((x) => x && x.id === id);
      noteTabDoc("timeline", { doc: id, kind: "timeline", title: t ? t.title : "" });
    },
  });
  consumeTabPendingDoc("timeline");   // dibuka dari riwayat
}

// ---- MAP: map-core.js (data) + map2d.js (editor 2D) + map-ui.js (shell) baru dimuat saat tab ini pertama kali dibuka.
// map3d.js + three.js (vendor/) di-import oleh map-ui.js hanya saat pengguna beralih ke tampilan 3D.
let mapLibPromise = null;
function ensureMapLib() {
  if (!mapLibPromise) {
    mapLibPromise = ["map-core.js", "map2d.js", "map-ui.js"]
      .reduce((chain, src) => chain.then(() => loadScriptOnce(src)), Promise.resolve());
    mapLibPromise.catch(() => { mapLibPromise = null; });   // boleh dicoba lagi
  }
  return mapLibPromise;
}
async function openMapTab() {
  const main = el("tabMap").querySelector(".mp-main");
  if (!window.NovelMap) { main.dataset.state = "loading"; el("mpStatus").textContent = "Memuat peta…"; }
  try { await ensureMapLib(); }
  catch (e) { main.dataset.state = "error"; el("mpStatus").textContent = "Peta gagal dimuat. Periksa koneksi lalu buka tab ini lagi."; return; }
  if (el("tabMap").classList.contains("hidden") || !currentProjectId) return;   // pengguna sudah pindah tab
  window.NovelMap.show({
    project: getProject(currentProjectId),
    onChange: markDirtyAndSchedule,
    getScenes: () => flattenScenes(getProject(currentProjectId).data.scenes),
    openScene: (id) => openSceneInWrite(id),
    onOpen: (id) => {   // TAB PROJECT: riwayat
      const m = (getProject(currentProjectId).data.maps || []).find((x) => x && x.id === id);
      noteTabDoc("map", { doc: id, kind: "map", title: m ? m.title : "" });
    },
  });
  consumeTabPendingDoc("map");   // dibuka dari riwayat
}

// ---- HOME TAB: canvas berisi titik-titik scene ----
// Background project = cover-nya (di-blur); kalau belum ada cover pakai foto default dashboard.
function applyProjectLook(p) {
  const bg = p.cover ? `url("${p.cover}")` : dashBgImageCss();   // tanpa cover: background dashboard (bawaan / pilihan sendiri)
  el("projBgPhoto").style.backgroundImage = bg;
  el("projChipCover").style.backgroundImage = p.cover ? `url("${p.cover}")` : `linear-gradient(135deg, ${p.colorA}, ${p.colorB})`;
  el("projChipCover").textContent = p.cover ? "" : (p.title || "?").charAt(0).toUpperCase();
}
// lebar input judul di chip mengikuti panjang judulnya
function fitProjectTitle() { const t = el("projectTitle"); t.style.width = Math.max(4, t.value.length + 1) + "ch"; }
function flattenScenes(list, out = []) {
  (list || []).forEach((n) => { if (n.type === "folder") flattenScenes(n.children, out); else out.push(n); });
  return out;
}
// Beranda = kanvas papan (home-canvas.js + home-canvas.css, dimuat saat tab ini pertama kali dibuka; React Flow dari
// vendor/ dipakai bersama Timeline). Data: p.data.canvas (lihat komentar di awal home-canvas.js).
let homeLibPromise = null;
const stylePromises = {};
function loadStyleOnce(href) {
  if (!stylePromises[href]) {
    stylePromises[href] = new Promise((resolve, reject) => {
      const l = document.createElement("link");
      l.rel = "stylesheet"; l.href = href; l.onload = resolve;
      l.onerror = () => { delete stylePromises[href]; l.remove(); reject(new Error("Gagal memuat " + href)); };
      document.head.appendChild(l);
    });
  }
  return stylePromises[href];
}
function ensureHomeLib() {
  if (!homeLibPromise) {
    homeLibPromise = Promise.all([ensureReact().then(() => loadScriptOnce("vendor/reactflow-11.11.4.umd.js")), loadStyleOnce("home-canvas.css")])
      .then(() => loadScriptOnce("home-canvas.js"));
    homeLibPromise.catch(() => { homeLibPromise = null; });   // boleh dicoba lagi
  }
  return homeLibPromise;
}
async function renderProjectHome() {
  const box = el("homeCanvas");
  if (!window.NovelHome) box.innerHTML = `<div class="home-loading">${tiPx(tiIcon("loader-2"), 18)}<span>Memuat kanvas…</span></div>`;
  try { await ensureHomeLib(); }
  catch (e) { box.innerHTML = '<div class="home-loading">Kanvas gagal dimuat. Periksa koneksi lalu buka tab ini lagi.</div>'; return; }
  if (el("tabHome").classList.contains("hidden") || el("editorView").classList.contains("hidden") || !currentProjectId) return;   // pengguna sudah pindah
  window.NovelHome.show({
    project: getProject(currentProjectId),
    onChange: markDirtyAndSchedule,
    getCurrentSceneId: () => currentSceneId,
    openScene: (id) => openSceneInWrite(id),
    openDoc: (kind, id) => openProjectDoc(kind, id),          // titik jejak / kartu dokumen -> dokumennya
    createDoc: (kind, title) => createProjectDoc(kind, title), // alat Dokumen -> "Buat baru"
    closeTab: () => closeProjectTab("home"),
    preview: () => el("btnPreview").click(),
    toggleTheme: () => el("btnProjectTheme").click(),
    onOpen: (id, title, isDefault) => {   // TAB PROJECT: riwayat (papan Beranda bawaan = kunjungan tab biasa)
      if (isDefault) tabLastDoc.home = null;
      else noteTabDoc("home", { doc: id, kind: "board", title });
      if (tabSidebarVisible()) renderTabSidebar();
    },
  });
  consumeTabPendingDoc("home");   // papan dibuka dari riwayat
}
// Jejaring Tokoh = pohon relasi tokoh (jejaring.js + jejaring.css, dimuat saat tab ini pertama kali dibuka; React Flow
// dari vendor/ dipakai bersama). Data: p.data.jejaring (lihat komentar di awal jejaring.js). Kartu bisa ditautkan ke
// karakter Organize (id karakter, nama diambil dari sana).
let jejaringLibPromise = null;
function ensureJejaringLib() {
  if (!jejaringLibPromise) {
    jejaringLibPromise = Promise.all([ensureReact().then(() => loadScriptOnce("vendor/reactflow-11.11.4.umd.js")), loadStyleOnce("jejaring.css")])
      .then(() => loadScriptOnce("jejaring.js"));
    jejaringLibPromise.catch(() => { jejaringLibPromise = null; });   // boleh dicoba lagi
  }
  return jejaringLibPromise;
}
async function renderJejaringTab() {
  const box = el("jejaringCanvas");
  if (!window.NovelJejaring) box.innerHTML = `<div class="home-loading">${tiPx(tiIcon("loader-2"), 18)}<span>Memuat Jejaring Tokoh…</span></div>`;
  try { await ensureJejaringLib(); }
  catch (e) { box.innerHTML = '<div class="home-loading">Jejaring Tokoh gagal dimuat. Periksa koneksi lalu buka tab ini lagi.</div>'; return; }
  if (el("tabJejaring").classList.contains("hidden") || el("editorView").classList.contains("hidden") || !currentProjectId) return;   // pengguna sudah pindah
  const p = getProject(currentProjectId);
  window.NovelJejaring.show({
    project: p,
    onChange: markDirtyAndSchedule,
    closeTab: () => closeProjectTab("jejaring"),
    toggleTheme: () => el("btnProjectTheme").click(),
    onOpen: (id, title) => {   // TAB PROJECT: riwayat jejaring yang dibuka
      noteTabDoc("jejaring", { doc: id, kind: "jejaring", title });
      if (tabSidebarVisible()) renderTabSidebar();
    },
    // kartu Organize dibuat / diganti namanya dari jejaring: daftar Organize ikut diperbarui (judul di detail juga,
    // supaya syncOrganizeFromDetail tidak menimpa nama baru dengan yang lama)
    onOrganizeChange: () => {
      if (!p.data.organize || currentOrgCat !== "characters") return;
      renderOrganizeList();
      const it = currentOrgItemId && (p.data.organize.characters || []).find((x) => x.id === currentOrgItemId);
      if (it && el("orgTitleField")) el("orgTitleField").value = it.title;
    },
    openCharacter: (cid) => {   // "Buka kartu" -> tab Organize › Karakter, item itu terpilih
      switchTab("organize");
      if (currentOrgCat !== "characters") switchOrganizeCat("characters");
      if (currentOrgItemId !== cid) { syncOrganizeFromDetail(); currentOrgItemId = cid; renderOrganizeList(); renderOrganizeDetail(); }
    },
  });
  consumeTabPendingDoc("jejaring");   // jejaring dibuka dari riwayat
}

// jam kecil di pojok kanan atas (seperti vvd)
let projClockHandle = null;
function tickProjClock() { el("projClock").textContent = new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }); }
function startProjClock() { tickProjClock(); stopProjClock(); projClockHandle = setInterval(tickProjClock, 15000); }
function stopProjClock() { if (projClockHandle) clearInterval(projClockHandle); projClockHandle = null; }
function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// ---- WRITE TAB : binder bertingkat (folder/chapter berisi scene), tampil sebagai tree view ----
let draggedNodeId = null;
let expandedFolders = new Set();
let sceneHistory = [];
let sceneHistoryIndex = -1;
let pendingSceneParentId = null;
let pendingSceneType = "scene";
let currentZoom = 100;   // ukuran tulisan editor (%) = twPrefs.zoom

// ---- TULIS (mode Scene): tampilan per perangkat (localStorage, tidak memicu simpan ke Drive) ----
//   novelist_tw_prefs         = { font, width, lh, para, zoom, side }  (huruf, lebar halaman, jarak baris, gaya paragraf, zoom %, daftar tampil)
//   novelist_tw_day_<project> = { d: "YYYY-MM-DD", base: N }           (jumlah kata project di awal hari -> progres target harian)
// Target harian per project ada di p.data.dailyGoal (ikut autosave Drive). Pemisah adegan = <hr class="scene-break">.
const TW_PREFS_KEY = "novelist_tw_prefs";
const TW_PREFS_DEFAULT = { font: "serif", width: "m", lh: "normal", para: "plain", zoom: 100, side: true };
const TW_PREF_OPTS = {
  font: [["serif", "Serif"], ["sans", "Sans"], ["mono", "Mono"]],
  width: [["s", "Sempit"], ["m", "Sedang"], ["l", "Lebar"], ["full", "Penuh"]],
  lh: [["tight", "Rapat"], ["normal", "Normal"], ["loose", "Lega"]],
  para: [["plain", "Biasa"], ["space", "Berjarak"], ["indent", "Inden"]],
};
const TW_STATUS_NEXT = { todo: "draft", draft: "done", done: "todo" };
const TW_RING = 2 * Math.PI * 8;   // keliling cincin progres target (r = 8)
const TW_FLOURISH = `<svg class="tw-flourish" viewBox="0 0 120 18" aria-hidden="true" focusable="false"><path d="M4 10c14-7 28 5 44-1 4-1.5 7-4 12-4.5 5 .5 8 3 12 4.5 16 6 30-6 44 1" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M60 9.5l2.6 2.6L60 14.7l-2.6-2.6z" fill="currentColor"/></svg>`;
const twNarrowMq = window.matchMedia("(max-width: 700px)");                 // HP: daftar scene jadi laci
const twFineMq = window.matchMedia("(hover: hover) and (pointer: fine)");   // toolbar mengambang & pratinjau hanya untuk mouse
let twPrefs = Object.assign({}, TW_PREFS_DEFAULT, tabStoreGet(TW_PREFS_KEY) || {});
Object.keys(TW_PREF_OPTS).forEach((k) => { if (!TW_PREF_OPTS[k].some((o) => o[0] === twPrefs[k])) twPrefs[k] = TW_PREFS_DEFAULT[k]; });
twPrefs.zoom = Math.min(160, Math.max(70, Math.round(Number(twPrefs.zoom) / 5) * 5 || 100));
twPrefs.side = twPrefs.side !== false;
currentZoom = twPrefs.zoom;
let twSearchQ = "";                       // kata kunci pencarian daftar
let twListPid = null;                     // project yang daftarnya tampil (ganti project -> pencarian dikosongkan)
let twSideDrawer = false;                 // HP: laci daftar terbuka
let twDrag = null;                        // { id } node yang sedang diseret
let twRange = null;                       // seleksi terakhir di editor (dipulihkan sebelum perintah format)
let twPointerSel = false;                 // sedang menyeleksi dengan mouse -> toolbar mengambang menunggu
let twSession = { pid: null, base: 0 };   // jumlah kata project saat dibuka (kata sesi)
let twLast = { total: 0, today: 0, sess: 0, goal: 0 };
let twStatsTimer = 0, twSelRaf = 0, twPeekTimer = 0, twPeekRow = null;
const twWordCache = new Map();            // id scene -> { c: isi, n: jumlah kata }
const twScrollMem = new Map();            // id scene -> posisi gulir terakhir (selama halaman terbuka)

// ikon tree binder (Tabler, ukuran sama dengan SVG lama)
const TREE_ICONS = {
  caret: tiPx(tiIcon("chevron-right"), 13),
  folder: tiPx(tiIcon("folder"), 14),
  folderOpen: tiPx(tiIcon("folder-open"), 14),
  file: tiPx(tiIcon("file-text"), 14),
  plus: tiPx(tiIcon("plus"), 13),
  focus: tiPx(tiIcon("focus-centered"), 12),
  copy: tiPx(tiIcon("copy"), 12),
  trash: tiPx(tiIcon("trash"), 12),
  grip: tiPx(tiIcon("grip-vertical"), 12),
};
function countWordsFromHtml(html) {
  if (!html) return 0;
  const text = html.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").trim();
  return text ? text.split(/\s+/).filter(Boolean).length : 0;
}
function countAllNodes(list, isFolder) {
  return (list || []).filter((n) => (n.type === "folder") === isFolder).length;
}

// ---- helper Tulis ----
function saveTwPrefs() { tabStoreSet(TW_PREFS_KEY, twPrefs); }
function twAttr(s) { return escapeHtml(String(s == null ? "" : s)).replace(/"/g, "&quot;"); }
function twFmt(n) { return Number(n || 0).toLocaleString("id-ID"); }
function twShort(n) { return n >= 1000 ? (n / 1000).toLocaleString("id-ID", { maximumFractionDigits: 1 }) + "k" : String(n); }
function twStatusOf(s) { return s && STATUS_LABELS[s.status] ? s.status : "todo"; }
// hitung kata dari HTML: tag blok = pemisah kata, tag inline (<b>, <span>) tidak memotong kata
function twCountWords(html) {
  if (!html) return 0;
  const t = html.replace(/<\/?(?:p|div|h[1-6]|li|ul|ol|blockquote|hr|br|tr|td|th|section|article|figure)\b[^>]*>/gi, " ")
    .replace(/<[^>]*>/g, "").replace(/&nbsp;|&#160;/g, " ").trim();
  return t ? t.split(/\s+/).filter(Boolean).length : 0;
}
function twWords(s) {   // kata per scene, di-cache selama isinya sama
  const c = s.content || "";
  const hit = twWordCache.get(s.id);
  if (hit && hit.c === c) return hit.n;
  const n = twCountWords(c);
  twWordCache.set(s.id, { c, n });
  return n;
}
function twCountFolders(list) { return (list || []).reduce((a, n) => a + (n.type === "folder" ? 1 + twCountFolders(n.children) : 0), 0); }
function twSceneOrder() { const p = getProject(currentProjectId); return p ? flattenScenes(p.data.scenes) : []; }
// jalur [bab, ..., node] menuju id (null = tidak ada)
function twPath(id, list, trail = []) {
  for (const n of list || []) {
    if (n.id === id) return trail.concat(n);
    if (n.type === "folder") { const r = twPath(id, n.children, trail.concat(n)); if (r) return r; }
  }
  return null;
}
function twMatch(node, q) { return !q || (node.title || "").toLowerCase().includes(q) || (node.type !== "folder" && (node.synopsis || "").toLowerCase().includes(q)); }
function twMark(text, q) {   // judul dengan kata kunci pencarian ditandai <mark>
  const t = String(text || ""), lo = t.toLowerCase(), i = q ? lo.indexOf(q) : -1;
  if (i < 0 || lo.length !== t.length) return escapeHtml(t);
  return escapeHtml(t.slice(0, i)) + "<mark>" + escapeHtml(t.slice(i, i + q.length)) + "</mark>" + escapeHtml(t.slice(i + q.length));
}
function twToday() { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
// baseline kata: sesi (sejak project dibuka) & hari ini (di perangkat ini). Mengembalikan total kata project.
function twEnsureBaselines(p) {
  const total = flattenScenes(p.data.scenes).reduce((a, s) => a + twWords(s), 0);
  if (twSession.pid !== p.id) twSession = { pid: p.id, base: total };
  const key = "novelist_tw_day_" + p.id, day = tabStoreGet(key);
  if (!day || day.d !== twToday() || typeof day.base !== "number") tabStoreSet(key, { d: twToday(), base: total });
  return total;
}
function twGoal(p) { const g = Math.round(Number(p && p.data && p.data.dailyGoal)); return g > 0 ? g : 0; }

// ---- daftar scene: tampil / ciut (desktop) atau laci (HP) ----
function twSideVisible() { return twNarrowMq.matches ? twSideDrawer : twPrefs.side; }
function applyTwSide() {
  const tw = el("tabWrite"), side = el("twSide");
  if (!tw || !side) return;
  const narrow = twNarrowMq.matches, vis = twSideVisible();
  tw.classList.toggle("tw-side-collapsed", !narrow && !twPrefs.side);
  tw.classList.toggle("tw-side-open", narrow && twSideDrawer);
  el("twScrim").classList.toggle("is-on", narrow && twSideDrawer);
  side.setAttribute("aria-hidden", vis ? "false" : "true");
  side.inert = !vis;
  el("twSideOpen").setAttribute("aria-expanded", vis ? "true" : "false");
}
function toggleTwSide(force) {
  const next = typeof force === "boolean" ? force : !twSideVisible();
  if (twNarrowMq.matches) twSideDrawer = next;
  else { twPrefs.side = next; saveTwPrefs(); }
  applyTwSide();
  twHidePeek();
  if (next && twNarrowMq.matches) setTimeout(() => { const r = el("sceneList").querySelector('.tw-row[tabindex="0"]') || el("twSearch"); r.focus({ preventScroll: true }); }, 60);
  else if (!next && el("twSide").contains(document.activeElement)) el("twSideOpen").focus({ preventScroll: true });
}
function twClearSearch() { if (twSearchQ) { twSearchQ = ""; el("twSearch").value = ""; } }

function toggleFolder(id, row) {
  const open = !expandedFolders.has(id);
  if (open) expandedFolders.add(id); else expandedFolders.delete(id);
  row = row || el("sceneList").querySelector(`.tw-row[data-id="${CSS.escape(id)}"]`);
  const group = row && row.parentElement.querySelector(":scope > .tree-group");
  if (!row || !group || twSearchQ.trim()) { renderSceneList(); return; }
  // buka/tutup di tempat (tanpa membangun ulang daftar) supaya animasinya terlihat
  row.setAttribute("aria-expanded", open ? "true" : "false");
  row.querySelector(".tw-caret").classList.toggle("open", open);
  row.querySelector(".tw-folder-ic").innerHTML = open ? TREE_ICONS.folderOpen : TREE_ICONS.folder;
  group.classList.toggle("open", open);
}

function renderSceneList() {
  const p = getProject(currentProjectId);
  const box = el("sceneList");
  if (!p || !box) return;
  if (twListPid !== p.id) { twListPid = p.id; twSearchQ = ""; el("twSearch").value = ""; twSideDrawer = false; twScrollMem.clear(); twWordCache.clear(); applyTwSide(); }
  twHidePeek();
  const q = twSearchQ.trim().toLowerCase();
  const frag = document.createDocumentFragment();
  (p.data.scenes || []).forEach((node) => { const n = buildTreeNode(node, q, 0); if (n) frag.appendChild(n); });
  box.innerHTML = "";
  box.classList.toggle("is-search", !!q);
  if (frag.childNodes.length) {
    box.appendChild(frag);
    if (!q) box.insertAdjacentHTML("beforeend", '<div class="tw-drop-end" aria-hidden="true"></div>');   // seret ke sini = pindah ke akhir naskah
  } else {
    box.innerHTML = q ? `<p class="tw-list-empty">Tidak ada scene yang cocok dengan “${escapeHtml(twSearchQ.trim())}”.</p>`
      : `<div class="tw-list-empty"><span class="tw-list-empty-ic">${tiPx(tiIcon("file-text"), 20)}</span><p>Belum ada scene</p><span>Buat scene atau bab lewat tombol di atas.</span></div>`;
  }
  // tab roving: hanya baris aktif (atau baris pertama) yang masuk urutan Tab; panah atas/bawah berpindah baris
  const act = box.querySelector(".tw-row.active") || box.querySelector(".tw-row");
  if (act) act.tabIndex = 0;
  renderTwSideInfo(p);
  if (window.NovelHome) window.NovelHome.refresh();   // Beranda tampil: node scene ikut diperbarui
}
// ringkasan di kepala & kaki daftar: jumlah scene/bab/kata + progres status
function renderTwSideInfo(p) {
  const sc = flattenScenes(p.data.scenes);
  const words = sc.reduce((a, s) => a + twWords(s), 0);
  el("twSideMeta").textContent = `${sc.length} scene · ${twCountFolders(p.data.scenes)} bab · ${twFmt(words)} kata`;
  const c = { done: 0, draft: 0, todo: 0 };
  sc.forEach((s) => { c[twStatusOf(s)]++; });
  const keys = ["done", "draft", "todo"];
  el("twSideFoot").innerHTML = !sc.length ? "" :
    `<div class="tw-prog" role="img" aria-label="${c.done} Done, ${c.draft} Draft, ${c.todo} Todo">${keys.map((k) => c[k] ? `<span class="is-${k}" style="flex:${c[k]}"></span>` : "").join("")}</div>` +
    `<div class="tw-prog-legend">${keys.map((k) => `<span><i class="tw-dot ${k}"></i>${c[k]} ${STATUS_LABELS[k]}</span>`).join("")}</div>`;
}

function buildTreeNode(node, q = "", depth = 0) {
  const isFolder = node.type === "folder";
  let kids = [];
  if (isFolder) {
    kids = (node.children || []).map((c) => buildTreeNode(c, q, depth + 1)).filter(Boolean);
    if (q && !kids.length && !twMatch(node, q)) return null;
  } else if (!twMatch(node, q)) return null;
  const isOpen = isFolder && (q ? true : expandedFolders.has(node.id));
  const wrap = document.createElement("div");
  wrap.className = "tree-node tw-node";
  const row = document.createElement("div");
  const active = node.id === currentSceneId;
  row.className = "tw-row " + (isFolder ? "is-folder" : "is-scene") + (active ? " active" : "");
  row.dataset.id = node.id;
  row.tabIndex = -1;
  row.draggable = !q;   // saat mencari: urutan tidak bisa diubah
  row.setAttribute("role", "treeitem");
  row.setAttribute("aria-level", String(depth + 1));
  if (active) row.setAttribute("aria-current", "true");
  const btn = (act, icon, label, danger) => `<button type="button" class="tw-act${danger ? " is-danger" : ""}" data-action="${act}" title="${label}" aria-label="${label}" tabindex="-1">${icon}</button>`;
  if (isFolder) {
    const sc = flattenScenes(node.children);
    const words = sc.reduce((a, s) => a + twWords(s), 0);
    row.setAttribute("aria-expanded", isOpen ? "true" : "false");
    row.innerHTML = `<span class="tw-caret${isOpen ? " open" : ""}">${TREE_ICONS.caret}</span>` +
      `<span class="tw-folder-ic">${isOpen ? TREE_ICONS.folderOpen : TREE_ICONS.folder}</span>` +
      `<span class="tw-row-title" title="Klik dua kali untuk ganti nama">${twMark(node.title || "Bab tanpa judul", q)}</span>` +
      `<span class="tw-count" title="${sc.length} scene · ${twFmt(words)} kata">${sc.length}</span>` +
      `<span class="tw-row-actions">${btn("addChild", TREE_ICONS.plus, "Tambah scene di bab ini")}${btn("rename", tiPx(tiIcon("pencil"), 13), "Ganti nama (F2)")}` +
      `${btn("duplicate", TREE_ICONS.copy, "Duplikat bab")}${btn("delete", TREE_ICONS.trash, "Hapus bab & isinya", true)}</span>`;
  } else {
    const st = twStatusOf(node), w = twWords(node);
    row.innerHTML = `<span class="tw-dot ${st}" title="${STATUS_LABELS[st]}"></span>` +
      `<span class="tw-row-title" title="Klik dua kali untuk ganti nama">${twMark(node.title || "(tanpa judul)", q)}</span>` +
      `<span class="tw-wc" title="${twFmt(w)} kata">${twShort(w)}</span>` +
      `<span class="tw-row-actions">${btn("focus", TREE_ICONS.focus, "Mode fokus")}${btn("duplicate", TREE_ICONS.copy, "Duplikat scene (Ctrl+D)")}${btn("delete", TREE_ICONS.trash, "Hapus scene (Delete)", true)}</span>`;
  }
  wrap.appendChild(row);
  if (isFolder) {
    const group = document.createElement("div");
    group.className = "tree-group" + (isOpen ? " open" : "");
    group.setAttribute("role", "group");
    const inner = document.createElement("div");
    inner.className = "tree-group-inner";
    kids.forEach((k) => inner.appendChild(k));
    if (!kids.length && !q) inner.innerHTML = `<button type="button" class="tw-folder-empty" data-action="addChild" data-id="${twAttr(node.id)}" tabindex="-1">${TREE_ICONS.plus}<span>Bab kosong — tambah scene</span></button>`;
    group.appendChild(inner);
    wrap.appendChild(group);
  }
  return wrap;
}
// tandai baris scene yang terbuka (tanpa membangun ulang daftar)
function twMarkActive() {
  const box = el("sceneList");
  if (!box) return;
  let act = null;
  box.querySelectorAll(".tw-row").forEach((r) => {
    const on = r.dataset.id === currentSceneId;
    r.classList.toggle("active", on);
    if (on) { r.setAttribute("aria-current", "true"); act = r; } else r.removeAttribute("aria-current");
  });
  if (act && !box.contains(document.activeElement)) { box.querySelectorAll('.tw-row[tabindex="0"]').forEach((r) => { r.tabIndex = -1; }); act.tabIndex = 0; }
}
function twVisibleRows() { return [...el("sceneList").querySelectorAll(".tw-row")].filter((r) => !r.closest(".tree-group:not(.open)")); }
function twRowEl(id) { return el("sceneList").querySelector(`.tw-row[data-id="${CSS.escape(id)}"]`); }
// gulir daftar seperlunya supaya baris terlihat (tanpa scrollIntoView: tidak ikut menggeser panel lain)
function twRevealRow(row) {
  const box = el("sceneList");
  if (!row || !box) return;
  const r = row.getBoundingClientRect(), b = box.getBoundingClientRect();
  if (r.top < b.top + 4) box.scrollTop -= b.top + 4 - r.top;
  else if (r.bottom > b.bottom - 4) box.scrollTop += r.bottom - b.bottom + 4;
}
function twFocusRow(id) {
  const row = twRowEl(id);
  if (!row) return;
  el("sceneList").querySelectorAll('.tw-row[tabindex="0"]').forEach((r) => { r.tabIndex = -1; });
  row.tabIndex = 0;
  row.focus({ preventScroll: true });
  twRevealRow(row);
}
// ganti nama di daftar (dibuka dulu bila barisnya tersembunyi)
function twRename(id) {
  const p = getProject(currentProjectId), path = p && twPath(id, p.data.scenes);
  if (!path) return;
  let row = twRowEl(id);
  if (!row || row.closest(".tree-group:not(.open)")) {
    twClearSearch();
    path.slice(0, -1).forEach((f) => expandedFolders.add(f.id));
    renderSceneList();
    row = twRowEl(id);
  }
  if (!twSideVisible()) toggleTwSide(true);
  if (row) { twRevealRow(row); startRenameNode(path[path.length - 1], row.querySelector(".tw-row-title")); }
}

function startRenameNode(node, labelEl) {
  if (!labelEl || labelEl.querySelector(".tree-rename-input")) return; // sudah dalam mode edit
  const rowEl = labelEl.closest(".tw-row");
  if (rowEl) { rowEl.draggable = false; rowEl.classList.add("is-renaming"); } // drag-select teks di input tidak bentrok dengan seret baris
  const originalTitle = node.title || "";
  const input = document.createElement("input");
  input.type = "text";
  input.className = "tree-rename-input";
  input.value = originalTitle;
  input.setAttribute("aria-label", node.type === "folder" ? "Nama bab" : "Judul scene");
  labelEl.textContent = "";
  labelEl.appendChild(input);
  input.focus();
  input.select();

  let done = false, viaKey = false;
  const commit = () => {
    if (done) return;
    done = true;
    node.title = input.value.trim() || originalTitle || (node.type === "folder" ? "Bab tanpa judul" : "Tanpa Judul");
    renderSceneList();
    const s = currentSceneId && findScene(currentSceneId);
    if (node.id === currentSceneId) twTitleChanged(s, "list");   // judul halaman, Scene Settings & jalur ikut
    else twRefreshCrumbs();                                        // bab di jalur scene aktif mungkin berganti nama
    if (viaKey) twFocusRow(node.id);
    markDirtyAndSchedule();
  };
  const cancel = () => {
    if (done) return;
    done = true;
    renderSceneList();
    twFocusRow(node.id);
  };

  input.addEventListener("keydown", (e) => {
    e.stopPropagation();   // panah/Delete/F2 di input tidak ikut menggerakkan daftar
    if (e.key === "Enter") { e.preventDefault(); viaKey = true; input.blur(); }
    else if (e.key === "Escape") { e.preventDefault(); cancel(); }
  });
  input.addEventListener("blur", commit);
  input.addEventListener("click", (e) => e.stopPropagation());
  input.addEventListener("dblclick", (e) => e.stopPropagation());
}

// pindahkan node: pos = "before" | "after" (di samping target), "inside" (masuk ke bab target), "end" (akhir naskah)
function moveSceneNode(dragId, targetId, pos) {
  const p = getProject(currentProjectId);
  const d = findSceneNode(dragId, p.data.scenes);
  if (!d) return;
  if (targetId && (targetId === dragId || (d.node.type === "folder" && isDescendantOf(d.node, targetId)))) return; // bab tidak boleh masuk ke dirinya sendiri
  d.array.splice(d.index, 1);
  const t = targetId && pos !== "end" ? findSceneNode(targetId, p.data.scenes) : null;
  if (!t) p.data.scenes.push(d.node);
  else if (pos === "inside" && t.node.type === "folder") { (t.node.children = t.node.children || []).push(d.node); expandedFolders.add(t.node.id); }
  else t.array.splice(t.index + (pos === "after" ? 1 : 0), 0, d.node);
  renderSceneList();
  twRefreshCrumbs();
  const sel = el("twMoveFolder");
  if (sel && currentSceneId) { const path = twPath(currentSceneId, p.data.scenes); sel.value = path && path.length > 1 ? path[path.length - 2].id : ""; }
  markDirtyAndSchedule();
}
function dropNodeOnto(draggedId, targetNode) { moveSceneNode(draggedId, targetNode.id, targetNode.type === "folder" ? "inside" : "before"); }
// Alt+↑/↓ di daftar: geser satu posisi di dalam bab yang sama
function twMoveBy(id, delta) {
  const info = findSceneNode(id);
  if (!info) return;
  const j = info.index + delta;
  if (j < 0 || j >= info.array.length) return;
  info.array.splice(info.index, 1);
  info.array.splice(j, 0, info.node);
  renderSceneList();
  twFocusRow(id);
  twRefreshCrumbs();
  markDirtyAndSchedule();
}
// target lepas saat menyeret di daftar
function twDropTarget(e) {
  const box = el("sceneList");
  const empty = e.target.closest(".tw-folder-empty");
  if (empty) return twValidDrop({ id: empty.dataset.id, pos: "inside", el: empty.closest(".tree-group").previousElementSibling });
  const row = e.target.closest(".tw-row");
  if (!row) return twValidDrop({ id: null, pos: "end", el: box.querySelector(".tw-drop-end") });
  const r = row.getBoundingClientRect(), y = (e.clientY - r.top) / Math.max(1, r.height);
  let pos;
  if (row.classList.contains("is-folder")) pos = y < 0.28 ? "before" : (y > 0.72 && !expandedFolders.has(row.dataset.id) ? "after" : "inside");
  else pos = y < 0.5 ? "before" : "after";
  return twValidDrop({ id: row.dataset.id, pos, el: row });
}
function twValidDrop(t) {
  const d = twDrag && findSceneNode(twDrag.id);
  t.valid = !!d && t.id !== twDrag.id && !(d.node.type === "folder" && t.id && isDescendantOf(d.node, t.id));
  return t;
}
function twClearDrop() { el("sceneList").querySelectorAll(".drop-before, .drop-after, .drop-inside, .is-on").forEach((n) => n.classList.remove("drop-before", "drop-after", "drop-inside", "is-on")); }
function twShowDrop(t) {
  twClearDrop();
  if (!t || !t.valid || !t.el) return;
  t.el.classList.add(t.pos === "end" ? "is-on" : "drop-" + t.pos);
}

// ---- kartu pratinjau (hover baris): status, kata, sinopsis / awal cerita ----
function twShowPeek(row) {
  const peek = el("twPeek"), info = row && row.isConnected && findSceneNode(row.dataset.id);
  if (!info || twDrag || !twFineMq.matches || twNarrowMq.matches) return;
  const n = info.node;
  let html;
  if (n.type === "folder") {
    const sc = flattenScenes(n.children), words = sc.reduce((a, s) => a + twWords(s), 0), done = sc.filter((s) => twStatusOf(s) === "done").length;
    html = `<div class="tw-peek-kicker">${tiPx(tiIcon("folder"), 13)}Bab</div><div class="tw-peek-title">${escapeHtml(n.title || "Bab tanpa judul")}</div>` +
      `<div class="tw-peek-meta">${sc.length} scene · ${twFmt(words)} kata · ${done} selesai</div>`;
  } else {
    const st = twStatusOf(n);
    let body = n.synopsis ? `<p class="tw-peek-syn">${escapeHtml(n.synopsis)}</p>` : "";
    if (!body) {
      const txt = (new DOMParser().parseFromString(n.content || "", "text/html").body.textContent || "").replace(/\s+/g, " ").trim();
      body = txt ? `<p class="tw-peek-syn is-excerpt">${escapeHtml(txt.slice(0, 160))}${txt.length > 160 ? "…" : ""}</p>` : '<p class="tw-peek-syn is-empty">Belum ada sinopsis atau isi.</p>';
    }
    html = `<div class="tw-peek-kicker"><span class="tw-dot ${st}"></span>${STATUS_LABELS[st]} · ${twFmt(twWords(n))} kata</div>` +
      `<div class="tw-peek-title">${escapeHtml(n.title || "(tanpa judul)")}</div>${body}`;
  }
  peek.innerHTML = html;
  const side = el("twSide").getBoundingClientRect(), r = row.getBoundingClientRect();
  peek.classList.add("is-on");
  const h = peek.offsetHeight;
  peek.style.transform = `translate(${Math.round(side.right + 10)}px, ${Math.round(Math.max(8, Math.min(innerHeight - h - 8, r.top - 6)))}px)`;
}
function twHidePeek() {
  clearTimeout(twPeekTimer);
  twPeekRow = null;
  const peek = el("twPeek");
  if (peek) peek.classList.remove("is-on");
}

// ---- event daftar (didelegasikan, dipasang sekali) ----
function initTwList() {
  const box = el("sceneList");
  box.addEventListener("click", (e) => {
    if (e.target.closest(".tree-rename-input")) return;
    const btn = e.target.closest("[data-action]"), row = e.target.closest(".tw-row");
    const id = (btn && btn.dataset.id) || (row && row.dataset.id);
    const info = id && findSceneNode(id);
    if (!info) return;
    const node = info.node, act = btn && btn.dataset.action;
    twHidePeek();
    if (act === "addChild") { twAddScene(node.id); return; }
    if (act === "rename") { twRename(node.id); return; }
    if (act === "focus") { openFocusMode(node.id); return; }
    if (act === "duplicate") { duplicateScene(node.id); return; }
    if (act === "delete") { deleteSceneNode(node.id); return; }
    if (node.type === "folder") { toggleFolder(node.id, row); return; }
    const kb = e.detail === 0;   // Enter/Spasi dari keyboard: fokus tetap di daftar
    if (node.id !== currentSceneId) selectScene(node.id);
    if (kb) twFocusRow(node.id);
    else if (twNarrowMq.matches) toggleTwSide(false);
  });
  box.addEventListener("dblclick", (e) => {
    const t = e.target.closest(".tw-row-title"), row = e.target.closest(".tw-row");
    if (!t || !row || e.target.closest(".tree-rename-input")) return;
    e.preventDefault();
    twRename(row.dataset.id);
  });
  box.addEventListener("keydown", (e) => {
    const row = e.target.closest && e.target.closest(".tw-row");
    if (!row || e.target.closest("input")) return;
    const id = row.dataset.id, info = findSceneNode(id);
    if (!info) return;
    const isFolder = info.node.type === "folder", rows = twVisibleRows(), i = rows.indexOf(row);
    const go = (r) => { if (r) twFocusRow(r.dataset.id); };
    twHidePeek();
    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) { e.preventDefault(); if (!twSearchQ.trim()) twMoveBy(id, e.key === "ArrowUp" ? -1 : 1); return; }
    if ((e.ctrlKey || e.metaKey) && (e.key === "d" || e.key === "D")) { e.preventDefault(); duplicateScene(id); return; }
    switch (e.key) {
      case "ArrowDown": e.preventDefault(); go(rows[i + 1]); break;
      case "ArrowUp": e.preventDefault(); go(rows[i - 1]); break;
      case "Home": e.preventDefault(); go(rows[0]); break;
      case "End": e.preventDefault(); go(rows[rows.length - 1]); break;
      case "ArrowRight":
        if (!isFolder) break;
        e.preventDefault();
        if (!expandedFolders.has(id) && !twSearchQ.trim()) toggleFolder(id, row); else go(rows[i + 1]);
        break;
      case "ArrowLeft":
        e.preventDefault();
        if (isFolder && expandedFolders.has(id) && !twSearchQ.trim()) toggleFolder(id, row);
        else if (info.parent) go(twRowEl(info.parent.id));
        break;
      case "Enter": case " ": e.preventDefault(); row.click(); break;
      case "F2": e.preventDefault(); twRename(id); break;
      case "Delete": e.preventDefault(); deleteSceneNode(id); break;
    }
  });
  // seret untuk mengurutkan: garis = sebelum/sesudah, kotak = masuk ke bab, area kosong bawah = akhir naskah
  box.addEventListener("dragstart", (e) => {
    const row = e.target.closest && e.target.closest(".tw-row");
    if (!row || !row.draggable) { e.preventDefault(); return; }
    twDrag = { id: row.dataset.id };
    row.classList.add("dragging");
    box.classList.add("is-dragging");
    twHidePeek();
    e.dataTransfer.effectAllowed = "move";
    try { e.dataTransfer.setData("text/plain", row.querySelector(".tw-row-title").textContent); } catch (err) { /* abaikan */ }
  });
  box.addEventListener("dragover", (e) => {
    if (!twDrag) return;
    e.preventDefault();
    const t = twDropTarget(e);
    e.dataTransfer.dropEffect = t.valid ? "move" : "none";
    twShowDrop(t);
  });
  box.addEventListener("dragleave", (e) => { if (twDrag && !box.contains(e.relatedTarget)) twClearDrop(); });
  box.addEventListener("drop", (e) => {
    if (!twDrag) return;
    e.preventDefault();
    const t = twDropTarget(e), id = twDrag.id;
    twClearDrop();
    twDrag = null;
    if (t.valid) moveSceneNode(id, t.id, t.pos);
  });
  box.addEventListener("dragend", () => {
    twDrag = null;
    box.classList.remove("is-dragging");
    box.querySelectorAll(".dragging").forEach((r) => r.classList.remove("dragging"));
    twClearDrop();
  });
  // pratinjau saat kursor diam sebentar di atas baris
  box.addEventListener("pointerover", (e) => {
    if (e.pointerType !== "mouse") return;
    const row = e.target.closest(".tw-row");
    if (row === twPeekRow) return;
    twHidePeek();
    if (!row || row.classList.contains("is-renaming")) return;
    twPeekRow = row;
    twPeekTimer = setTimeout(() => twShowPeek(row), 550);
  });
  box.addEventListener("pointerleave", twHidePeek);
  box.addEventListener("pointerdown", twHidePeek);
  box.addEventListener("scroll", twHidePeek, { passive: true });
}

function selectScene(id, addToHistory = true) {
  const col = el("sceneDetailCol");
  if (currentSceneId && col && el("sceneEditor")) twScrollMem.set(currentSceneId, col.scrollTop);
  syncSceneFromDetail();
  currentSceneId = id;
  const p = getProject(currentProjectId), path = p && twPath(id, p.data.scenes);
  if (path) path.slice(0, -1).forEach((f) => expandedFolders.add(f.id));   // bab yang berisi scene ini ikut dibuka
  if (path && twSearchQ.trim() && !twMatch(path[path.length - 1], twSearchQ.trim().toLowerCase())) twClearSearch();   // scene dari luar hasil cari
  if (addToHistory) {
    sceneHistory = sceneHistory.slice(0, sceneHistoryIndex + 1);
    sceneHistory.push(id);
    sceneHistoryIndex = sceneHistory.length - 1;
  }
  renderSceneList();
  renderSceneDetail();
  twRevealRow(el("sceneList").querySelector(".tw-row.active"));
  const sc = findScene(id);
  if (sc && sc.type !== "folder") noteTabDoc("write", { doc: id, kind: "scene", title: sc.title });   // TAB PROJECT: riwayat
}
function goSceneBack() { if (sceneHistoryIndex > 0) { sceneHistoryIndex--; selectScene(sceneHistory[sceneHistoryIndex], false); } }
function goSceneForward() { if (sceneHistoryIndex < sceneHistory.length - 1) { sceneHistoryIndex++; selectScene(sceneHistory[sceneHistoryIndex], false); } }

function syncSceneFromDetail() {
  if (!currentProjectId || !currentSceneId) return;
  const s = findScene(currentSceneId), ed = el("sceneEditor");
  if (!s || !ed || ed.dataset.sceneId !== s.id) return;
  if (focusSceneId === s.id && !el("focusOverlay").classList.contains("hidden")) return;   // mode fokus yang memegang isi scene ini
  s.content = ed.innerHTML;   // judul & sinopsis langsung ditulis saat diketik
}

// ---- halaman editor: judul besar, meta (status, kata, waktu baca), sinopsis, toolbar, isi ----
function renderSceneDetail() {
  const col = el("sceneDetailCol"), main = el("twMain");
  const p = getProject(currentProjectId);
  const s = p && currentSceneId ? findScene(currentSceneId) : null;
  twHideBubble();
  twCloseStats();
  twMarkActive();   // openProject membangun daftar sebelum scene pertama dipilih
  if (p) twEnsureBaselines(p);
  if (!s || s.type === "folder") {
    main.classList.add("is-empty");
    col.innerHTML = twEmptyHtml(p);
    twRenderCrumbs(null);
    updateSceneDrawerVisibility();
    return;
  }
  main.classList.remove("is-empty");
  col.innerHTML = `
    <article class="tw-page" id="twPage">
      <header class="tw-head">
        <div class="tw-kicker" id="twKicker"></div>
        <textarea id="twTitle" class="tw-title" rows="1" placeholder="Judul scene" aria-label="Judul scene" spellcheck="false"></textarea>
        ${TW_FLOURISH}
        <div class="tw-meta">
          <button type="button" id="twStatus" class="tw-status"></button>
          <span class="tw-meta-item" id="twMetaWords"></span>
          <span class="tw-meta-item" id="twMetaRead"></span>
        </div>
        <textarea id="twSynopsis" class="tw-syn" rows="1" placeholder="Tambah sinopsis singkat…" aria-label="Sinopsis scene"></textarea>
      </header>
      ${twToolbarHtml()}
      <div id="sceneEditor" class="tw-editor" contenteditable="true" spellcheck="false" role="textbox" aria-multiline="true" aria-label="Isi scene" data-placeholder="Mulai menulis di sini…"></div>
    </article>`;
  const ed = el("sceneEditor"), title = el("twTitle"), syn = el("twSynopsis");
  ed.innerHTML = s.content || "";
  ed.dataset.sceneId = s.id;
  title.value = s.title || "";
  syn.value = s.synopsis || "";
  twApplyPrefs();
  twPaintStatus(s);
  twRenderCrumbs();
  twUpdateEmpty();
  twUpdateStats();
  twRefit();

  title.addEventListener("input", () => { s.title = title.value; twAutoGrow(title); twTitleChanged(s, "page"); });
  title.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); twCaretToStart(ed); } });
  syn.addEventListener("input", () => {
    s.synopsis = syn.value;
    twAutoGrow(syn);
    if (el("sceneSynopsis")) el("sceneSynopsis").value = s.synopsis;
    markDirtyAndSchedule();
  });
  syn.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); twCaretToStart(ed); } });
  syn.addEventListener("focus", () => syn.classList.add("is-open"));
  syn.addEventListener("blur", () => { syn.classList.remove("is-open"); twAutoGrow(syn); });
  el("twStatus").onclick = () => twSetStatus(s, TW_STATUS_NEXT[twStatusOf(s)]);
  ed.addEventListener("input", twOnEditorInput);
  ed.addEventListener("paste", twOnPaste);
  ed.addEventListener("keydown", twEditorKeys);
  ed.addEventListener("pointerdown", () => { twPointerSel = true; twHideBubble(); });
  ed.addEventListener("blur", () => setTimeout(() => { if (!el("twBubble").contains(document.activeElement) && document.activeElement !== el("sceneEditor")) twHideBubble(); }, 0));
  const tb = col.querySelector(".tw-toolbar");
  tb.addEventListener("mousedown", (e) => { if (e.target.closest("button")) e.preventDefault(); });   // seleksi editor tidak hilang
  tb.addEventListener("click", (e) => { const b = e.target.closest("[data-cmd]"); if (b) twCmd(b.dataset.cmd); });
  tb.querySelector('[data-ctl="block"]').addEventListener("change", (e) => twCmd("block:" + e.target.value));
  col.scrollTop = twScrollMem.get(s.id) || 0;
  main.classList.toggle("is-scrolled", col.scrollTop > 4);

  renderSceneDrawerBody(s);
  updateSceneDrawerVisibility();
}
function twEmptyHtml(p) {
  const any = !!(p && flattenScenes(p.data.scenes).length);
  return `<div class="tw-empty">
    <div class="tw-empty-ic">${tiPx(tiIcon(any ? "file-text" : "feather"), 26)}</div>
    <h2 class="tw-empty-title">${any ? "Pilih scene untuk mulai menulis" : "Halaman ini masih kosong"}</h2>
    <p class="tw-empty-text">${any ? "Buka scene dari daftar di kiri, atau buat scene baru." : "Mulai ceritamu dengan scene pertama. Kelompokkan scene ke dalam bab supaya naskah tetap rapi."}</p>
    <div class="tw-empty-actions">
      ${any ? `<button type="button" class="tw-btn is-primary" data-act="first">${tiPx(tiIcon("file-text"), 16)}<span>Buka scene pertama</span></button>`
        : `<button type="button" class="tw-btn is-primary" data-act="add-scene">${tiPx(tiIcon("file-plus"), 16)}<span>Scene pertama</span></button>`}
      <button type="button" class="tw-btn" data-act="add-folder">${tiPx(tiIcon("folder-plus"), 16)}<span>Bab baru</span></button>
    </div>
  </div>`;
}
function twToolbarHtml() {
  const b = (cmd, icon, label) => `<button type="button" class="tw-tb" data-cmd="${cmd}" title="${label}" aria-label="${label}" aria-pressed="false">${tiPx(icon, 17)}</button>`;
  const sep = '<span class="tw-tb-sep" aria-hidden="true"></span>';
  return `<div class="tw-toolbar" role="toolbar" aria-label="Format teks">
    <span class="tw-tb-selwrap"><select class="tw-tb-sel" data-ctl="block" title="Gaya paragraf" aria-label="Gaya paragraf">
      <option value="p">Paragraf</option><option value="h1">Judul 1</option><option value="h2">Judul 2</option><option value="h3">Judul 3</option><option value="blockquote">Kutipan</option>
    </select>${tiPx(tiIcon("chevron-down"), 13)}</span>${sep}
    ${b("bold", tiIcon("bold"), "Tebal (Ctrl+B)")}${b("italic", tiIcon("italic"), "Miring (Ctrl+I)")}${b("underline", tiIcon("underline"), "Garis bawah (Ctrl+U)")}${b("strikeThrough", tiIcon("strikethrough"), "Coret")}${sep}
    ${b("insertUnorderedList", tiIcon("list"), "Daftar berpoin")}${b("insertOrderedList", tiIcon("list-numbers"), "Daftar bernomor")}${b("quote", tiIcon("blockquote"), "Kutipan")}${sep}
    ${b("justifyLeft", tiIcon("align-left"), "Rata kiri")}${b("justifyCenter", tiIcon("align-center"), "Rata tengah")}${b("justifyRight", tiIcon("align-right"), "Rata kanan")}${b("justifyFull", tiIcon("align-justified"), "Rata kiri-kanan")}${sep}
    ${b("divider", tiIcon("separator-horizontal"), "Pemisah adegan ✦ ✦ ✦")}${b("removeFormat", tiIcon("clear-formatting"), "Hapus format")}${sep}
    ${b("undo", tiIcon("arrow-back-up"), "Urungkan (Ctrl+Z)")}${b("redo", tiIcon("arrow-forward-up"), "Ulangi (Ctrl+Y)")}
  </div>`;
}
// kicker di atas judul + jalur di bar atas: "Bab 1 · Scene 2 dari 4"
function twRenderCrumbs(path) {
  const nav = el("twCrumb"), p = getProject(currentProjectId);
  if (!nav) return;
  if (path === undefined) path = p && currentSceneId ? twPath(currentSceneId, p.data.scenes) : null;
  const crumbs = path && path.length ? path : null;
  nav.innerHTML = !crumbs ? `<span class="tw-crumb-cur">${tiPx(tiIcon("book-2"), 14)}<span>${escapeHtml(el("projectTitle").value || (p && p.title) || "")}</span></span>`
    : crumbs.map((n, i) => i < crumbs.length - 1
      ? `<span class="tw-crumb-folder">${tiPx(tiIcon("folder"), 14)}<span>${escapeHtml(n.title || "Bab tanpa judul")}</span></span><span class="tw-crumb-sep" aria-hidden="true">${tiPx(tiIcon("chevron-right"), 12)}</span>`
      : `<span class="tw-crumb-cur">${tiPx(tiIcon("file-text"), 14)}<span>${escapeHtml(n.title || "(tanpa judul)")}</span></span>`).join("");
  const kick = el("twKicker");
  if (kick && crumbs) {
    // di dalam bab: "Bab · Scene i dari n" (urutan di bab itu); di luar bab: urutan di seluruh naskah
    const s = crumbs[crumbs.length - 1], parent = crumbs.length > 1 ? crumbs[crumbs.length - 2] : null;
    const sib = parent ? (parent.children || []).filter((x) => x.type !== "folder") : twSceneOrder();
    kick.innerHTML = (parent ? `<span class="tw-kicker-bab">${escapeHtml(parent.title || "Bab tanpa judul")}</span><span class="tw-kicker-sep" aria-hidden="true">·</span>` : "") +
      `<span>Scene ${sib.indexOf(s) + 1} dari ${sib.length}</span>`;
  }
  const order = twSceneOrder(), i = order.findIndex((x) => x.id === currentSceneId);
  el("twPrev").disabled = i <= 0;
  el("twNext").disabled = i < 0 || i >= order.length - 1;
}
function twRefreshCrumbs() { twRenderCrumbs(); }
function twGo(delta) { const order = twSceneOrder(), i = order.findIndex((x) => x.id === currentSceneId), t = order[i + delta]; if (i >= 0 && t) selectScene(t.id); }
// judul berubah dari salah satu tempat (halaman / Scene Settings / daftar / mode fokus) -> tempat lain ikut
function twTitleChanged(s, from) {
  if (!s) return;
  const onPage = !!el("sceneEditor") && el("sceneEditor").dataset.sceneId === s.id;   // halaman & Scene Settings sedang menampilkan scene ini
  if (onPage && from !== "drawer" && el("sceneTitleField")) el("sceneTitleField").value = s.title || "";
  if (onPage && from !== "page" && el("twTitle")) { el("twTitle").value = s.title || ""; twAutoGrow(el("twTitle")); }
  const t = twRowEl(s.id), label = t && t.querySelector(".tw-row-title");
  if (label && !label.querySelector("input")) label.innerHTML = twMark(s.title || "(tanpa judul)", twSearchQ.trim().toLowerCase());
  twRenderCrumbs();
  if (from !== "list") { if (window.NovelHome) window.NovelHome.refresh(); markDirtyAndSchedule(); }
}
function twPaintStatus(s) {
  const b = el("twStatus");
  if (!b) return;
  const st = twStatusOf(s);
  b.className = "tw-status is-" + st;
  b.innerHTML = `<span class="tw-dot ${st}"></span><span>${STATUS_LABELS[st]}</span>${tiPx(tiIcon("refresh"), 12)}`;
  b.title = "Status scene — klik untuk ganti (Todo → Draft → Done)";
  b.setAttribute("aria-label", `Status: ${STATUS_LABELS[st]}. Klik untuk ganti`);
}
function twSetStatus(s, st) {
  if (!s || !STATUS_LABELS[st]) return;
  s.status = st;
  twPaintStatus(s);
  const dot = twRowEl(s.id);
  if (dot && dot.querySelector(".tw-dot")) { dot.querySelector(".tw-dot").className = "tw-dot " + st; dot.querySelector(".tw-dot").title = STATUS_LABELS[st]; }
  el("sceneDrawerBody").querySelectorAll(".status-chip").forEach((b) => { const on = b.dataset.status === st; b.classList.toggle("selected", on); b.setAttribute("aria-checked", on ? "true" : "false"); });
  renderTwSideInfo(getProject(currentProjectId));
  if (window.NovelHome) window.NovelHome.refresh();
  markDirtyAndSchedule();
}
function twAutoGrow(t) {
  if (!t || !t.isConnected || !t.offsetParent) return;   // tab tersembunyi: diukur lagi saat tampil (twRefit)
  t.style.height = "auto";
  t.style.height = t.scrollHeight + "px";
  if (t.id === "twSynopsis") t.classList.toggle("is-long", t.scrollHeight > t.clientHeight + 2 || t.scrollHeight > 70);
}
function twRefit() { twAutoGrow(el("twTitle")); twAutoGrow(el("twSynopsis")); }
function twCaretToStart(ed) {
  ed.focus({ preventScroll: true });
  const r = document.createRange();
  r.selectNodeContents(ed);
  r.collapse(true);
  const sel = document.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
}
function twUpdateEmpty() {
  const ed = el("sceneEditor");
  if (ed) ed.classList.toggle("is-empty", !ed.textContent.trim() && !ed.querySelector("hr, img, li"));
}
// tampilan per perangkat -> atribut data-tw-* (dibaca CSS) di tab Tulis & layar mode fokus
function twApplyPrefs() {
  [el("tabWrite"), el("focusOverlay")].forEach((host) => {
    if (!host) return;
    host.dataset.twFont = twPrefs.font;
    host.dataset.twWidth = twPrefs.width;
    host.dataset.twLh = twPrefs.lh;
    host.dataset.twPara = twPrefs.para;
    host.style.setProperty("--tw-zoom", String(twPrefs.zoom / 100));
  });
}
function twRangeFill(r) { if (r) r.style.setProperty("--fill", ((r.value - r.min) / (r.max - r.min)) * 100 + "%"); }
function twSetZoom(z) {
  z = Math.min(160, Math.max(70, Math.round(Number(z) / 5) * 5 || 100));
  currentZoom = twPrefs.zoom = z;
  saveTwPrefs();
  ["zoomSlider", "twZoom2", "twZoomPop"].forEach((id) => { const r = el(id); if (r) { r.value = z; twRangeFill(r); } });
  ["zoomLabel", "twZoom2Val", "twZoomPopVal"].forEach((id) => { if (el(id)) el(id).textContent = z + "%"; });
  el("twZoomOut").disabled = z <= 70;
  el("twZoomIn").disabled = z >= 160;
  twApplyPrefs();
  twRefit();
  twPlaceBubble();
}

// ---- isi editor: input, statistik, tempel, pintasan ----
function twOnEditorInput() {
  const ed = el("sceneEditor"), s = ed && findScene(ed.dataset.sceneId);
  if (!s) return;
  s.content = ed.innerHTML;
  twUpdateEmpty();
  clearTimeout(twStatsTimer);
  twStatsTimer = setTimeout(twUpdateStats, 300);
  twQueueSel();
  markDirtyAndSchedule();
}
// teks polos editor dengan baris baru antar-blok — tidak bergantung pada tata letak (innerText salah saat tab tersembunyi)
function twTextOf(root) {
  let out = "";
  const BLOCK = /^(P|DIV|H[1-6]|LI|BLOCKQUOTE|UL|OL|HR|TR|SECTION|ARTICLE|FIGURE)$/;
  (function walk(n) {
    for (let c = n.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3) out += c.nodeValue;
      else if (c.nodeType === 1) {
        if (c.tagName === "BR") { out += "\n"; continue; }
        const b = BLOCK.test(c.tagName);
        if (b) out += "\n";
        walk(c);
        if (b) out += "\n";
      }
    }
  })(root);
  return out.replace(/ /g, " ");
}
function twUpdateStats() {
  const ed = el("sceneEditor"), p = getProject(currentProjectId), s = ed && findScene(ed.dataset.sceneId);
  if (!s || !p) return;
  const st = computeTextStats(twTextOf(ed));
  el("sceneWordCount").textContent = twFmt(st.words) + " kata";
  el("twStatsMore").textContent = ` · ${twFmt(st.chars)} karakter · ${twFmt(st.sentences)} kalimat · ${twFmt(st.paragraphs)} paragraf`;
  el("twStatsBtn").title = statsLabel(st) + " — klik untuk statistik & target";
  el("twMetaWords").textContent = twFmt(st.words) + " kata";
  el("twMetaRead").textContent = st.words ? "± " + Math.max(1, Math.round(st.words / 200)) + " menit baca" : "";
  const wc = twRowEl(s.id), n = twWords(s);
  if (wc && wc.querySelector(".tw-wc")) { wc.querySelector(".tw-wc").textContent = twShort(n); wc.querySelector(".tw-wc").title = twFmt(n) + " kata"; }
  renderTwSideInfo(p);
  twUpdateGoal(p);
  if (!el("twStatsPop").classList.contains("hidden") && !el("twStatsPop").contains(document.activeElement)) twRenderStatsPop();
}
function twUpdateGoal(p) {
  const total = twEnsureBaselines(p), day = tabStoreGet("novelist_tw_day_" + p.id);
  const today = Math.max(0, total - (day && day.d === twToday() ? day.base : total)), sess = total - twSession.base, goal = twGoal(p);
  twLast = { total, today, sess, goal };
  const pct = goal ? Math.min(1, today / goal) : 0;
  el("twRingFg").style.strokeDasharray = TW_RING.toFixed(2);
  el("twRingFg").style.strokeDashoffset = (TW_RING * (1 - pct)).toFixed(2);
  const btn = el("twGoalBtn");
  btn.classList.toggle("has-goal", !!goal);
  btn.classList.toggle("is-done", !!goal && today >= goal);
  el("twGoalText").textContent = goal ? `${twFmt(today)} / ${twFmt(goal)}` : `${sess < 0 ? "−" : "+"}${twFmt(Math.abs(sess))} sesi`;
  btn.title = goal ? `Target harian: ${twFmt(today)} dari ${twFmt(goal)} kata hari ini (sesi ini ${sess < 0 ? "−" : "+"}${twFmt(Math.abs(sess))})`
    : `Kata yang kamu tulis sejak membuka project ini — klik untuk memasang target harian`;
}
function twSetGoal(v) {
  const p = getProject(currentProjectId);
  if (!p) return;
  const g = Math.min(100000, Math.max(0, Math.round(Number(v) || 0)));
  if (g) p.data.dailyGoal = g; else delete p.data.dailyGoal;
  twUpdateGoal(p);
  twPaintPopGoal();
  markDirtyAndSchedule();
}
// popover statistik (klik angka kata di bar bawah)
function twRenderStatsPop() {
  const pop = el("twStatsPop"), ed = el("sceneEditor");
  if (!ed) return;
  const st = computeTextStats(twTextOf(ed)), L = twLast;
  const stat = (n, l) => `<div class="tw-pop-stat"><b>${twFmt(n)}</b><span>${l}</span></div>`;
  const row = (l, v) => `<div class="tw-pop-row"><span>${l}</span><b>${v}</b></div>`;
  pop.innerHTML = `<div class="tw-pop-head"><span>Statistik scene</span><button type="button" class="tw-icon-btn tw-pop-x" data-act="close" aria-label="Tutup">${tiPx(tiIcon("x"), 15)}</button></div>
    <div class="tw-pop-grid">${stat(st.words, "kata")}${stat(st.chars, "karakter")}${stat(st.sentences, "kalimat")}${stat(st.paragraphs, "paragraf")}</div>
    <div class="tw-pop-rows">${row("Waktu baca", "± " + Math.max(st.words ? 1 : 0, Math.round(st.words / 200)) + " menit")}${row("Total naskah", twFmt(L.total) + " kata")}${row("Sesi ini", (L.sess < 0 ? "−" : "+") + twFmt(Math.abs(L.sess)) + " kata")}${row("Hari ini", "+" + twFmt(L.today) + " kata")}</div>
    <div class="tw-pop-goal">
      <label class="tw-pop-label" for="twGoalInput">${tiPx(tiIcon("target-arrow"), 14)}Target harian</label>
      <div class="tw-pop-goal-in"><input id="twGoalInput" type="number" min="0" max="100000" step="50" inputmode="numeric" placeholder="mis. 500" /><span>kata / hari</span></div>
      <div class="tw-goal-bar"><span id="twGoalFill"></span></div>
      <p class="tw-pop-note" id="twGoalNote"></p>
    </div>
    <div class="tw-pop-zoom"><span class="tw-pop-label">${tiPx(tiIcon("text-size"), 14)}Ukuran tulisan</span><input type="range" id="twZoomPop" class="tw-range" min="70" max="160" step="5" aria-label="Ukuran tulisan" /><b id="twZoomPopVal"></b></div>`;
  el("twGoalInput").value = L.goal || "";
  el("twZoomPop").value = twPrefs.zoom;
  el("twZoomPopVal").textContent = twPrefs.zoom + "%";
  twRangeFill(el("twZoomPop"));
  twPaintPopGoal();
}
function twPaintPopGoal() {
  const fill = el("twGoalFill"), note = el("twGoalNote"), L = twLast;
  if (!fill || !note) return;
  fill.style.width = (L.goal ? Math.min(100, (L.today / L.goal) * 100) : 0) + "%";
  note.textContent = !L.goal ? "Kosongkan untuk tanpa target. Target disimpan di project."
    : L.today >= L.goal ? "Target hari ini tercapai — mantap!" : `${twFmt(L.goal - L.today)} kata lagi untuk hari ini.`;
}
function twToggleStats(force) {
  const pop = el("twStatsPop");
  const open = typeof force === "boolean" ? force : pop.classList.contains("hidden");
  if (!open) { twCloseStats(); return; }
  if (!el("sceneEditor")) return;
  twUpdateGoal(getProject(currentProjectId));
  twRenderStatsPop();
  pop.classList.remove("hidden");
  el("twStatsBtn").setAttribute("aria-expanded", "true");
  document.addEventListener("pointerdown", twPopOutside, true);
  document.addEventListener("keydown", twPopKeys, true);
}
function twCloseStats() {
  const pop = el("twStatsPop");
  if (!pop || pop.classList.contains("hidden")) return;
  pop.classList.add("hidden");
  el("twStatsBtn").setAttribute("aria-expanded", "false");
  document.removeEventListener("pointerdown", twPopOutside, true);
  document.removeEventListener("keydown", twPopKeys, true);
}
function twPopOutside(e) { if (!el("twStatsPop").contains(e.target) && !e.target.closest("#twStatsBtn, #twGoalBtn")) twCloseStats(); }
function twPopKeys(e) { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); twCloseStats(); el("twStatsBtn").focus(); } }

// perintah format (toolbar halaman, toolbar mengambang, Scene Settings) pada seleksi terakhir di editor
function twRestoreSel(ed) {
  const sel = document.getSelection();
  if (document.activeElement === ed && sel.rangeCount && ed.contains(sel.getRangeAt(0).commonAncestorContainer)) return;
  ed.focus({ preventScroll: true });
  if (twRange && ed.contains(twRange.commonAncestorContainer)) { sel.removeAllRanges(); sel.addRange(twRange); }
  else if (!sel.rangeCount || !ed.contains(sel.anchorNode)) { const r = document.createRange(); r.selectNodeContents(ed); r.collapse(false); sel.removeAllRanges(); sel.addRange(r); }
}
function twExec(cmd, val) {
  const ed = el("sceneEditor");
  if (!ed) return;
  twRestoreSel(ed);
  document.execCommand(cmd, false, val == null ? null : val);
  twOnEditorInput();
  twUpdateToolbar();
}
function twBlockOfSel() {
  const ed = el("sceneEditor"), sel = document.getSelection();
  let n = sel && sel.rangeCount ? sel.anchorNode : null;
  while (n && n !== ed) { if (n.nodeType === 1 && /^(P|H1|H2|H3|BLOCKQUOTE|LI|DIV)$/.test(n.tagName)) return n; n = n.parentNode; }
  return null;
}
function twCmd(cmd) {
  if (cmd.startsWith("block:")) { twExec("formatBlock", "<" + cmd.slice(6) + ">"); return; }
  const blk = () => { twRestoreSel(el("sceneEditor")); return twBlockOfSel(); };
  if (cmd === "quote") { const b = blk(); twExec("formatBlock", b && b.closest("blockquote") ? "<p>" : "<blockquote>"); }
  else if (cmd === "heading") { const b = blk(); twExec("formatBlock", b && b.tagName === "H2" ? "<p>" : "<h2>"); }
  else if (cmd === "divider") twExec("insertHTML", '<hr class="scene-break"><p><br></p>');
  else twExec(cmd);
}
function twUpdateToolbar() {
  const ed = el("sceneEditor");
  if (!ed) return;
  const tb = el("sceneDetailCol").querySelector(".tw-toolbar"), bub = el("twBubble");
  ["bold", "italic", "underline", "strikeThrough", "insertUnorderedList", "insertOrderedList", "justifyLeft", "justifyCenter", "justifyRight", "justifyFull"].forEach((cmd) => {
    let on = false;
    try { on = document.queryCommandState(cmd); } catch (e) { on = false; }
    [tb, bub].forEach((box) => { const b = box && box.querySelector(`[data-cmd="${cmd}"]`); if (b) { b.classList.toggle("is-on", !!on); b.setAttribute("aria-pressed", on ? "true" : "false"); } });
  });
  const b = twBlockOfSel();
  let tag = b ? b.tagName.toLowerCase() : "p";
  if (b && b.closest("blockquote")) tag = "blockquote";
  [tb, bub].forEach((box) => {
    const q = box && box.querySelector('[data-cmd="quote"]'); if (q) q.classList.toggle("is-on", tag === "blockquote");
    const h = box && box.querySelector('[data-cmd="heading"]'); if (h) h.classList.toggle("is-on", tag === "h2");
  });
  const s = tb && tb.querySelector('[data-ctl="block"]');
  if (s) s.value = ["p", "h1", "h2", "h3", "blockquote"].includes(tag) ? tag : "p";
}
function twQueueSel() { if (!twSelRaf) twSelRaf = requestAnimationFrame(() => { twSelRaf = 0; twUpdateToolbar(); twPlaceBubble(); }); }
function twOnSelChange() {
  const ed = el("sceneEditor"), sel = document.getSelection();
  if (!ed || !sel || !sel.rangeCount) { twHideBubble(); return; }
  const r = sel.getRangeAt(0);
  if (!ed.contains(r.commonAncestorContainer)) { if (!el("twBubble").contains(document.activeElement)) twHideBubble(); return; }
  twRange = r.cloneRange();
  twQueueSel();
}
// toolbar mengambang di atas teks terpilih (hanya mouse/trackpad; di layar sentuh menu bawaan sistem dipakai)
function twPlaceBubble() {
  const bub = el("twBubble"), ed = el("sceneEditor"), sel = document.getSelection();
  if (!bub) return;
  if (!ed || twPointerSel || !twFineMq.matches || !sel || !sel.rangeCount || sel.isCollapsed || el("tabWrite").classList.contains("hidden") ||
      !ed.contains(sel.getRangeAt(0).commonAncestorContainer)) { twHideBubble(); return; }
  const rect = sel.getRangeAt(0).getBoundingClientRect(), col = el("sceneDetailCol").getBoundingClientRect();
  if ((!rect.width && !rect.height) || rect.bottom < col.top + 40 || rect.top > col.bottom - 20) { twHideBubble(); return; }
  bub.classList.add("is-on");
  const bw = bub.offsetWidth, bh = bub.offsetHeight;
  const x = Math.max(8, Math.min(innerWidth - bw - 8, rect.left + rect.width / 2 - bw / 2));
  let y = rect.top - bh - 10;
  if (y < col.top + 52) y = rect.bottom + 10;
  bub.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}
function twHideBubble() { const b = el("twBubble"); if (b) b.classList.remove("is-on"); }
function twEditorKeys(e) {
  if (e.key === "Escape") { const sel = document.getSelection(); if (sel && !sel.isCollapsed) { sel.collapseToEnd(); twHideBubble(); } return; }
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && (e.key === "F" || e.key === "f")) { e.preventDefault(); if (currentSceneId) openFocusMode(currentSceneId); }   // Ctrl+Shift+F: mode fokus
}
// tempel: HTML dibersihkan (warna/font/ukuran dari Word/Docs/web dibuang supaya tetap terbaca di tema gelap & terang)
function twOnPaste(e) {
  const cd = e.clipboardData;
  if (!cd) return;
  const html = cd.getData("text/html"), text = cd.getData("text/plain");
  if (!html && !text) return;   // mis. gambar: biarkan browser
  e.preventDefault();
  if (html) document.execCommand("insertHTML", false, twCleanHtml(html) || escapeHtml(text));
  else if (/\n/.test(text)) document.execCommand("insertHTML", false, text.replace(/\r\n?/g, "\n").split("\n").map((l) => (l.trim() ? `<p>${escapeHtml(l)}</p>` : "<p><br></p>")).join(""));
  else document.execCommand("insertText", false, text);
}
function twCleanHtml(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const out = document.createElement("div");
  const SKIP = /^(SCRIPT|STYLE|META|LINK|TITLE|HEAD|NOSCRIPT|TEMPLATE|IFRAME|OBJECT|EMBED|SVG|MATH|IMG|PICTURE|VIDEO|AUDIO|CANVAS|BUTTON|INPUT|SELECT|TEXTAREA|FORM)$/;
  const MAP = { P: "p", DIV: "p", TR: "p", H1: "h1", H2: "h2", H3: "h3", H4: "h3", H5: "h3", H6: "h3", BLOCKQUOTE: "blockquote", UL: "ul", OL: "ol", LI: "li",
    B: "b", STRONG: "b", I: "i", EM: "i", U: "u", S: "s", STRIKE: "s", DEL: "s", SUB: "sub", SUP: "sup", BR: "br", HR: "hr" };
  const BLOCKS = "p,div,h1,h2,h3,h4,h5,h6,blockquote,ul,ol,li,table,tr";
  const walk = (src, dst) => {
    src.childNodes.forEach((n) => {
      if (n.nodeType === 3) { dst.appendChild(document.createTextNode(n.nodeValue)); return; }
      if (n.nodeType !== 1 || SKIP.test(n.tagName)) return;
      const st = n.getAttribute("style") || "";
      let tag = MAP[n.tagName];
      if (tag === "br" || tag === "hr") {
        const x = document.createElement(tag);
        if (tag === "hr" && /\b(scene-break|qd-break)\b/.test(n.getAttribute("class") || "")) x.className = "scene-break";
        dst.appendChild(x);
        return;
      }
      if (tag === "b" && /font-weight\s*:\s*(normal|[1-4]00)\b/i.test(st)) tag = null;   // Google Docs: <b style="font-weight:normal"> membungkus semuanya
      if (tag === "p" && n.querySelector(BLOCKS)) tag = null;                             // pembungkus blok lain: isinya saja
      if (!tag) {   // span/font/a/td/...: tebal/miring/garis dari style jadi tag sederhana, sisanya isi saja
        let host = dst;
        if (/font-weight\s*:\s*(bold|[6-9]00)\b/i.test(st)) host = host.appendChild(document.createElement("b"));
        if (/font-style\s*:\s*italic/i.test(st)) host = host.appendChild(document.createElement("i"));
        if (/text-decoration[^;]*underline/i.test(st)) host = host.appendChild(document.createElement("u"));
        if (/text-decoration[^;]*line-through/i.test(st)) host = host.appendChild(document.createElement("s"));
        walk(n, host);
        if (/^(TD|TH)$/.test(n.tagName)) dst.appendChild(document.createTextNode(" "));
        return;
      }
      const x = document.createElement(tag);
      const al = String((n.style && n.style.textAlign) || n.getAttribute("align") || "").toLowerCase();
      if (/^(p|h1|h2|h3|blockquote)$/.test(tag) && /^(center|right|justify)$/.test(al)) x.style.textAlign = al;
      walk(n, x);
      dst.appendChild(x);
    });
  };
  walk(doc.body, out);
  return out.innerHTML;
}

// ---- tambah scene / bab langsung (tanpa jendela) ----
function twNewId(kind) { let id = kind + "-" + Date.now(); while (findSceneNode(id)) id = kind + "-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6); return id; }
function twFreeTitle(base, n, nodes) {   // "Scene 4" / "Bab 2" yang belum dipakai
  const used = new Set(nodes.map((x) => (x.title || "").trim().toLowerCase()));
  while (used.has((base + " " + n).toLowerCase())) n++;
  return base + " " + n;
}
// scene baru: di akhir bab parentId, atau tepat setelah scene yang terbuka; judulnya langsung siap diketik
function twAddScene(parentId) {
  const p = getProject(currentProjectId);
  if (!p) return;
  syncSceneFromDetail();
  const all = flattenScenes(p.data.scenes);
  const node = { id: twNewId("scene"), type: "scene", title: twFreeTitle("Scene", all.length + 1, all), synopsis: "", status: "todo", content: "" };
  let arr = p.data.scenes, at = arr.length;
  const par = parentId ? findSceneNode(parentId, p.data.scenes) : null;
  if (par && par.node.type === "folder") { arr = par.node.children = par.node.children || []; at = arr.length; expandedFolders.add(par.node.id); }
  else if (!parentId && currentSceneId) { const c = findSceneNode(currentSceneId, p.data.scenes); if (c) { arr = c.array; at = c.index + 1; } }
  arr.splice(at, 0, node);
  twClearSearch();
  if (twNarrowMq.matches) toggleTwSide(false);
  selectScene(node.id);
  markDirtyAndSchedule();
  const t = el("twTitle");
  if (t) { t.focus({ preventScroll: true }); t.select(); }
}
function twAddFolder() {
  const p = getProject(currentProjectId);
  if (!p) return;
  const folders = [];
  (function walk(list) { (list || []).forEach((n) => { if (n.type === "folder") { folders.push(n); walk(n.children); } }); })(p.data.scenes);
  const node = { id: twNewId("folder"), type: "folder", title: twFreeTitle("Bab", folders.length + 1, folders), children: [] };
  p.data.scenes.push(node);
  expandedFolders.add(node.id);
  twClearSearch();
  if (!currentSceneId) renderSceneDetail();
  markDirtyAndSchedule();
  twRename(node.id);   // langsung ganti nama di daftar (daftar dibuka bila tersembunyi)
}

// ---- toolbar mengambang (muncul di atas teks terpilih) ----
function twBubbleHtml() {
  const b = (cmd, icon, label) => `<button type="button" class="tw-tb" data-cmd="${cmd}" title="${label}" aria-label="${label}" aria-pressed="false" tabindex="-1">${tiPx(icon, 16)}</button>`;
  const sep = '<span class="tw-tb-sep" aria-hidden="true"></span>';
  return b("bold", tiIcon("bold"), "Tebal") + b("italic", tiIcon("italic"), "Miring") + b("underline", tiIcon("underline"), "Garis bawah") + b("strikeThrough", tiIcon("strikethrough"), "Coret") + sep +
    b("heading", tiIcon("heading"), "Judul bagian") + b("quote", tiIcon("blockquote"), "Kutipan") + sep + b("removeFormat", tiIcon("clear-formatting"), "Hapus format");
}

// ---- status simpan di bar bawah = salinan #saveStatus (diubah markDirty / markSaved / sinkron Drive) ----
function twMirrorSave() {
  const box = el("twSave"), src = el("saveStatus");
  if (!box || !src) return;
  const t = src.textContent.replace(/\s+/g, " ").trim();
  // data-state dari setSaveStatus; teks lama tanpa data-state ditebak dari isinya
  const ds = src.dataset.state;
  const st = ds === "saving" ? "saving" : ds === "local" || ds === "offline" ? "local"
    : ds === "login" || ds === "error" || ds === "conflict" || ds === "readonly" ? "error" : ds ? "saved"
    : /menyimpan|menyinkron/i.test(t) ? "saving" : /gagal|error|offline|tidak|login/i.test(t) ? "error" : "saved";
  box.dataset.state = st;
  box.classList.toggle("is-action", src.classList.contains("is-action"));
  box.querySelector(".tw-save-text").textContent = st === "saving" ? "Menyimpan…" : (t || "Tersimpan");
  box.title = src.title || (st === "saving" ? "Menyimpan…" : (t || "Tersimpan"));
}

// ---- pasang event tab Tulis (sekali, saat halaman dimuat) ----
function initTwUi() {
  initTwList();
  el("twBubble").innerHTML = twBubbleHtml();
  el("btnAddScene").onclick = () => twAddScene(null);
  el("btnAddFolder").onclick = twAddFolder;
  el("twSideClose").onclick = () => toggleTwSide(false);
  el("twSideOpen").onclick = () => toggleTwSide();
  el("twScrim").onclick = () => toggleTwSide(false);
  el("twSide").addEventListener("keydown", (e) => { if (e.key === "Escape" && twNarrowMq.matches && twSideDrawer && !e.target.closest(".tree-rename-input")) { e.preventDefault(); toggleTwSide(false); } });
  const narrowChanged = () => { twSideDrawer = false; twHidePeek(); twHideBubble(); applyTwSide(); };
  if (twNarrowMq.addEventListener) twNarrowMq.addEventListener("change", narrowChanged); else twNarrowMq.addListener(narrowChanged);
  // pencarian: Enter = buka hasil pertama, ↓ = pindah ke daftar, Esc = kosongkan
  const search = el("twSearch");
  search.addEventListener("input", () => { twSearchQ = search.value; renderSceneList(); });
  search.addEventListener("keydown", (e) => {
    const first = () => el("sceneList").querySelector(".tw-row.is-scene") || el("sceneList").querySelector(".tw-row");
    if (e.key === "Escape" && search.value) { e.preventDefault(); e.stopPropagation(); search.value = ""; twSearchQ = ""; renderSceneList(); }
    else if (e.key === "ArrowDown") { const r = first(); if (r) { e.preventDefault(); twFocusRow(r.dataset.id); } }
    else if (e.key === "Enter") { const r = el("sceneList").querySelector(".tw-row.is-scene"); if (r) { e.preventDefault(); selectScene(r.dataset.id); if (twNarrowMq.matches) toggleTwSide(false); } }
  });
  el("twPrev").onclick = () => twGo(-1);
  el("twNext").onclick = () => twGo(1);
  // bar bawah
  el("zoomSlider").addEventListener("input", (e) => twSetZoom(e.target.value));
  el("twZoomOut").onclick = () => twSetZoom(twPrefs.zoom - 10);
  el("twZoomIn").onclick = () => twSetZoom(twPrefs.zoom + 10);
  el("twBarFocus").onclick = () => { if (currentSceneId && findScene(currentSceneId)) openFocusMode(currentSceneId); };
  el("twStatsBtn").onclick = () => twToggleStats();
  el("twGoalBtn").onclick = () => {
    const open = el("twStatsPop").classList.contains("hidden");
    twToggleStats(open);
    if (open && el("twGoalInput") && !twLast.goal) el("twGoalInput").focus({ preventScroll: true });
  };
  const pop = el("twStatsPop");
  pop.addEventListener("click", (e) => { if (e.target.closest('[data-act="close"]')) { twCloseStats(); el("twStatsBtn").focus(); } });
  pop.addEventListener("input", (e) => {
    if (e.target.id === "twGoalInput") twSetGoal(e.target.value);
    else if (e.target.id === "twZoomPop") twSetZoom(e.target.value);
  });
  pop.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.id === "twGoalInput") { e.preventDefault(); twCloseStats(); el("twStatsBtn").focus(); } });
  // halaman: tombol di layar kosong, bayangan bar atas saat digulir
  const col = el("sceneDetailCol");
  col.addEventListener("click", (e) => {
    const b = e.target.closest(".tw-empty [data-act]");
    if (!b) return;
    if (b.dataset.act === "first") { const f = twSceneOrder()[0]; if (f) selectScene(f.id); }
    else if (b.dataset.act === "add-scene") twAddScene(null);
    else if (b.dataset.act === "add-folder") twAddFolder();
  });
  col.addEventListener("scroll", () => {
    el("twMain").classList.toggle("is-scrolled", col.scrollTop > 4);
    if (el("twBubble").classList.contains("is-on")) twQueueSel();
  }, { passive: true });
  // toolbar mengambang
  const bub = el("twBubble");
  bub.addEventListener("mousedown", (e) => e.preventDefault());   // seleksi di editor tetap
  bub.addEventListener("click", (e) => { const b = e.target.closest("[data-cmd]"); if (b) twCmd(b.dataset.cmd); });
  document.addEventListener("selectionchange", () => { if (el("sceneEditor") && !el("tabWrite").classList.contains("hidden")) twOnSelChange(); });
  document.addEventListener("pointerup", () => { if (twPointerSel) { twPointerSel = false; if (el("sceneEditor")) twQueueSel(); } }, true);
  window.addEventListener("resize", () => { twHideBubble(); twHidePeek(); });
  // ukuran panel berubah (tab tampil lagi, jendela diubah, daftar diciutkan): tinggi judul & sinopsis diukur ulang
  if (window.ResizeObserver) new ResizeObserver(() => { twRefit(); if (el("twBubble").classList.contains("is-on")) twQueueSel(); }).observe(el("twMain"));
  // pintasan global saat tab Tulis tampil: Ctrl+\ = tampil/sembunyikan daftar, Alt+PageUp/PageDown = scene sebelum/berikut
  document.addEventListener("keydown", (e) => {
    if (el("tabWrite").classList.contains("hidden") || el("tabWrite").classList.contains("is-quill") || !el("focusOverlay").classList.contains("hidden") || el("editorView").classList.contains("hidden")) return;
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key === "\\") { e.preventDefault(); toggleTwSide(); }
    else if (e.altKey && !e.ctrlKey && (e.key === "PageUp" || e.key === "PageDown")) { e.preventDefault(); twGo(e.key === "PageUp" ? -1 : 1); }
  });
  // status simpan
  if (window.MutationObserver) new MutationObserver(twMirrorSave).observe(el("saveStatus"), { childList: true, characterData: true, subtree: true });
  twMirrorSave();
  // mode fokus: isi & judul langsung tersimpan saat diketik
  el("focusEditor").addEventListener("input", () => {
    const s = findScene(focusSceneId);
    if (s) s.content = el("focusEditor").innerHTML;
    updateFocusStats();
    markDirtyAndSchedule();
  });
  el("focusEditor").addEventListener("paste", twOnPaste);
  el("focusTitle").addEventListener("input", () => { const s = findScene(focusSceneId); if (s) { s.title = el("focusTitle").value; twTitleChanged(s, "focus"); } });
  el("focusTitle").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); twCaretToStart(el("focusEditor")); } });
  el("focusOverlay").addEventListener("keydown", (e) => { if (e.key === "Escape" && !el("focusOverlay").classList.contains("hidden")) { e.preventDefault(); closeFocusMode(); } });
  // tampilan awal
  twApplyPrefs();
  twSetZoom(twPrefs.zoom);
  applyTwSide();
}

// ============ SCENE OPTIONS DRAWER (nama, synopsis, status, format tulisan) ============
// Bagian: Info scene (judul, sinopsis, status, bab) · Tampilan editor (per perangkat) · Format teks (pada seleksi) · Aksi
function renderSceneDrawerBody(s) {
  const body = el("sceneDrawerBody");
  if (!body) return;
  const p = getProject(currentProjectId), path = p ? twPath(s.id, p.data.scenes) : null;
  const parentId = path && path.length > 1 ? path[path.length - 2].id : "";
  const folderOpts = [];
  (function walk(list, depth) {
    (list || []).forEach((n) => { if (n.type === "folder") { folderOpts.push(`<option value="${twAttr(n.id)}"${n.id === parentId ? " selected" : ""}>${" ".repeat(depth)}${escapeHtml(n.title || "Bab tanpa judul")}</option>`); walk(n.children, depth + 1); } });
  })(p ? p.data.scenes : [], 0);
  const st = twStatusOf(s);
  const sec = (icon, title, inner, note) => `<section class="drawer-section"><div class="drawer-section-label">${tiPx(icon, 14)}<span>${title}</span>${note ? `<small>${note}</small>` : ""}</div>${inner}</section>`;
  const seg = (key, label) => `<div class="tw-dr-field"><span class="tw-dr-label" id="twSegL-${key}">${label}</span><div class="tw-seg" role="radiogroup" aria-labelledby="twSegL-${key}" data-pref="${key}">` +
    TW_PREF_OPTS[key].map(([v, l]) => `<button type="button" role="radio" class="tw-seg-btn${key === "font" ? " tw-ff-" + v : ""}${twPrefs[key] === v ? " is-on" : ""}" data-v="${v}" aria-checked="${twPrefs[key] === v}">${l}</button>`).join("") + `</div></div>`;
  const fb = (cmd, icon, label) => `<button type="button" class="tw-tb" data-cmd="${cmd}" title="${label}" aria-label="${label}">${tiPx(icon, 16)}</button>`;
  body.innerHTML =
    sec(tiIcon("info-circle"), "Info scene", `
      <label class="tw-dr-label" for="sceneTitleField">Judul</label>
      <input id="sceneTitleField" class="field-input" autocomplete="off" />
      <label class="tw-dr-label" for="sceneSynopsis">Sinopsis</label>
      <textarea id="sceneSynopsis" class="field-input textarea" placeholder="Ringkasan singkat isi scene ini…"></textarea>
      <span class="tw-dr-label" id="twStatusL">Status</span>
      <div class="status-row" role="radiogroup" aria-labelledby="twStatusL">
        ${["todo", "draft", "done"].map((k) => `<button type="button" role="radio" class="status-chip chip-${k}${st === k ? " selected" : ""}" data-status="${k}" aria-checked="${st === k}"><i class="tw-dot ${k}"></i>${STATUS_LABELS[k]}</button>`).join("")}
      </div>
      <label class="tw-dr-label" for="twMoveFolder">Bab</label>
      <div class="tw-dr-select"><select id="twMoveFolder" class="field-input"><option value="">Tanpa bab (di luar bab)</option>${folderOpts.join("")}</select>${tiPx(tiIcon("chevron-down"), 14)}</div>`) +
    sec(tiIcon("layout"), "Tampilan editor", `
      ${seg("font", "Huruf")}${seg("width", "Lebar halaman")}${seg("lh", "Jarak baris")}${seg("para", "Paragraf")}
      <div class="tw-dr-field"><label class="tw-dr-label" for="twZoom2">Ukuran tulisan</label>
        <div class="tw-dr-range"><input type="range" id="twZoom2" class="tw-range" min="70" max="160" step="5" value="${twPrefs.zoom}" /><b id="twZoom2Val">${twPrefs.zoom}%</b></div></div>`, "perangkat ini") +
    sec(tiIcon("typography"), "Format teks", `
      <div class="drawer-toolbar-selects">
        <div class="tw-dr-select"><select id="fmtStyle" class="field-input" title="Gaya paragraf" aria-label="Gaya paragraf">
          <option value="p">Paragraf</option><option value="h1">Judul 1</option><option value="h2">Judul 2</option><option value="h3">Judul 3</option><option value="blockquote">Kutipan</option>
        </select>${tiPx(tiIcon("chevron-down"), 14)}</div>
        <div class="tw-dr-pair">
          <div class="tw-dr-select"><select id="fmtFont" class="field-input" title="Font teks terpilih" aria-label="Font teks terpilih">
            <option value="">Font…</option><option value="Georgia">Georgia</option><option value="'Palatino Linotype',Palatino,serif">Palatino</option><option value="'Segoe UI',sans-serif">Segoe UI</option>
            <option value="'Times New Roman',serif">Times New Roman</option><option value="'Courier New',monospace">Courier New</option>
          </select>${tiPx(tiIcon("chevron-down"), 14)}</div>
          <div class="tw-dr-select"><select id="fmtSize" class="field-input" title="Ukuran teks terpilih" aria-label="Ukuran teks terpilih">
            <option value="">Ukuran…</option><option value="2">Kecil</option><option value="3">Normal</option><option value="4">Sedang</option><option value="5">Besar</option><option value="6">Lebih besar</option><option value="7">Raksasa</option>
          </select>${tiPx(tiIcon("chevron-down"), 14)}</div>
        </div>
      </div>
      <div class="drawer-toolbar-row tw-dr-tools">
        ${fb("bold", tiIcon("bold"), "Tebal")}${fb("italic", tiIcon("italic"), "Miring")}${fb("underline", tiIcon("underline"), "Garis bawah")}${fb("strikeThrough", tiIcon("strikethrough"), "Coret")}
        ${fb("insertUnorderedList", tiIcon("list"), "Daftar berpoin")}${fb("insertOrderedList", tiIcon("list-numbers"), "Daftar bernomor")}${fb("divider", tiIcon("separator-horizontal"), "Pemisah adegan")}
        ${fb("justifyLeft", tiIcon("align-left"), "Rata kiri")}${fb("justifyCenter", tiIcon("align-center"), "Rata tengah")}${fb("justifyRight", tiIcon("align-right"), "Rata kanan")}${fb("justifyFull", tiIcon("align-justified"), "Rata kiri-kanan")}
        <label class="tw-dr-color" title="Warna teks terpilih">${tiPx(tiIcon("palette"), 16)}<input type="color" id="fmtColor" value="${document.body.classList.contains("light") ? "#24221f" : "#e7e5e0"}" aria-label="Warna teks terpilih" /></label>
        ${fb("removeFormat", tiIcon("clear-formatting"), "Hapus format")}
      </div>`, "teks terpilih") +
    sec(tiIcon("bolt"), "Aksi", `
      <div class="drawer-action-row">
        <button type="button" id="sceneFocusBtn" class="drawer-action-btn">${tiPx(tiIcon("arrows-maximize"), 16)}<span>Mode fokus</span><kbd>Ctrl+Shift+F</kbd></button>
        <button type="button" id="scenePreviewBtn" class="drawer-action-btn">${tiPx(tiIcon("eye"), 16)}<span>Pratinjau naskah</span></button>
        <button type="button" id="sceneDuplicateBtn" class="drawer-action-btn">${tiPx(tiIcon("copy"), 16)}<span>Duplikat scene</span></button>
        <button type="button" id="sceneDeleteBtn" class="drawer-action-btn drawer-action-danger">${tiPx(tiIcon("trash"), 16)}<span>Hapus scene</span></button>
      </div>`);
  el("sceneTitleField").value = s.title || "";
  el("sceneSynopsis").value = s.synopsis || "";

  el("sceneTitleField").addEventListener("input", () => { s.title = el("sceneTitleField").value; twTitleChanged(s, "drawer"); });
  el("sceneSynopsis").addEventListener("input", () => {
    s.synopsis = el("sceneSynopsis").value;
    const syn = el("twSynopsis");
    if (syn && el("sceneEditor") && el("sceneEditor").dataset.sceneId === s.id) { syn.value = s.synopsis; twAutoGrow(syn); }
    markDirtyAndSchedule();
  });
  body.querySelectorAll(".status-chip").forEach((btn) => { btn.onclick = () => twSetStatus(s, btn.dataset.status); });
  el("twMoveFolder").onchange = (e) => {
    const v = e.target.value;
    if (v) moveSceneNode(s.id, v, "inside"); else moveSceneNode(s.id, null, "end");
  };
  // tampilan editor (disimpan di perangkat ini)
  body.querySelectorAll(".tw-seg").forEach((g) => g.addEventListener("click", (e) => {
    const b = e.target.closest(".tw-seg-btn");
    if (!b) return;
    twPrefs[g.dataset.pref] = b.dataset.v;
    saveTwPrefs();
    g.querySelectorAll(".tw-seg-btn").forEach((x) => { const on = x === b; x.classList.toggle("is-on", on); x.setAttribute("aria-checked", on ? "true" : "false"); });
    twApplyPrefs();
    twRefit();
  }));
  twRangeFill(el("twZoom2"));
  el("twZoom2").addEventListener("input", (e) => twSetZoom(e.target.value));
  // format teks: bekerja pada seleksi terakhir di editor
  const tools = body.querySelector(".tw-dr-tools");
  tools.addEventListener("mousedown", (e) => { if (e.target.closest("button")) e.preventDefault(); });
  tools.addEventListener("click", (e) => { const b = e.target.closest("[data-cmd]"); if (b) twCmd(b.dataset.cmd); });
  el("fmtStyle").onchange = () => twCmd("block:" + el("fmtStyle").value);
  el("fmtFont").onchange = () => { if (el("fmtFont").value) twExec("fontName", el("fmtFont").value); el("fmtFont").value = ""; };
  el("fmtSize").onchange = () => { if (el("fmtSize").value) twExec("fontSize", el("fmtSize").value); el("fmtSize").value = ""; };
  el("fmtColor").oninput = () => twExec("foreColor", el("fmtColor").value);

  el("sceneFocusBtn").onclick = () => { closeSceneDrawer(); openFocusMode(s.id); };
  el("scenePreviewBtn").onclick = () => { closeSceneDrawer(); flushCurrentEdits(); el("btnPreview").click(); };
  el("sceneDuplicateBtn").onclick = () => duplicateScene(s.id);
  el("sceneDeleteBtn").onclick = () => deleteSceneNode(s.id);
}

function updateSceneDrawerVisibility() {
  const tabWrite = el("tabWrite");
  const writeActive = tabWrite && !tabWrite.classList.contains("hidden");
  const quill = writeMode(getProject(currentProjectId)) === "quill";   // mode Quill: tombol panel scene disembunyikan
  const show = !!(writeActive && !quill && currentSceneId && findScene(currentSceneId));
  el("sceneDrawerToggle").classList.toggle("hidden", !show);
  if (!show) closeSceneDrawer();
}

// layar lebar (>= 1100 px): laci menempel di kanan & halaman menyempit (tanpa scrim, editor tetap bisa dipakai);
// layar lebih kecil: laci menutupi halaman dengan scrim. Diatur CSS lewat kelas #tabWrite.tw-drawer-open.
function openSceneDrawer() {
  twHideBubble(); twCloseStats();
  el("tabWrite").classList.add("tw-drawer-open");
  el("sceneOptionsDrawer").classList.add("open");
  el("sceneOptionsDrawer").setAttribute("aria-hidden", "false");
  el("sceneDrawerScrim").classList.remove("hidden");
  requestAnimationFrame(() => el("sceneDrawerScrim").classList.add("visible"));
  el("sceneDrawerToggle").classList.add("is-open");
  el("sceneDrawerToggle").setAttribute("aria-expanded", "true");
  document.addEventListener("keydown", sceneDrawerKeyHandler);
}
function closeSceneDrawer() {
  const drawer = el("sceneOptionsDrawer");
  if (!drawer || !drawer.classList.contains("open")) return;
  el("tabWrite").classList.remove("tw-drawer-open");
  drawer.classList.remove("open");
  drawer.setAttribute("aria-hidden", "true");
  el("sceneDrawerScrim").classList.remove("visible");
  el("sceneDrawerToggle").classList.remove("is-open");
  el("sceneDrawerToggle").setAttribute("aria-expanded", "false");
  document.removeEventListener("keydown", sceneDrawerKeyHandler);
  setTimeout(() => { if (!drawer.classList.contains("open")) el("sceneDrawerScrim").classList.add("hidden"); }, 340);
}
function toggleSceneDrawer() {
  const drawer = el("sceneOptionsDrawer");
  if (drawer.classList.contains("open")) closeSceneDrawer(); else openSceneDrawer();
}
function sceneDrawerKeyHandler(e) { if (e.key === "Escape") closeSceneDrawer(); }

function setupSceneDrawerDrag() {
  const panel = el("sceneOptionsDrawer");
  const grip = el("sceneDrawerGrip");
  if (!panel || !grip) return;
  let dragging = false, startX = 0, startTime = 0, currentX = 0, pointerId = null;

  grip.addEventListener("pointerdown", (e) => {
    if (e.target.closest("#sceneDrawerClose")) return;
    dragging = true; startX = e.clientX; startTime = Date.now(); currentX = 0; pointerId = e.pointerId;
    panel.classList.add("dragging");
    grip.setPointerCapture(pointerId);
  });
  grip.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    currentX = Math.max(0, e.clientX - startX);
    panel.style.transform = `translateX(${currentX}px)`;
  });
  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    panel.classList.remove("dragging");
    panel.style.transform = "";
    const dt = Math.max(1, Date.now() - startTime);
    const velocity = (currentX / dt) * 1000;
    const width = panel.getBoundingClientRect().width || 360;
    if (currentX > width * 0.35 || velocity > 650) closeSceneDrawer();
  };
  grip.addEventListener("pointerup", endDrag);
  grip.addEventListener("pointercancel", endDrag);
}

function openAddSceneModal(parentId = null) {
  pendingSceneParentId = parentId;
  pendingSceneType = "scene";
  el("sceneFieldTitle").value = ""; el("sceneFieldSynopsis").value = "";
  el("sceneModalTitle").textContent = parentId ? "Add scene ke chapter ini" : "Add item";
  document.querySelectorAll(".type-toggle-btn").forEach((b) => b.classList.toggle("active", b.dataset.type === "scene"));
  el("sceneSynopsisLabel").classList.remove("hidden");
  el("sceneFieldSynopsis").classList.remove("hidden");
  el("sceneModal").classList.remove("hidden");
  el("sceneFieldTitle").focus();
}
function saveNewScene() {
  const p = getProject(currentProjectId);
  const title = el("sceneFieldTitle").value.trim() || (pendingSceneType === "folder" ? "Chapter Baru" : "Scene Baru");
  const synopsis = el("sceneFieldSynopsis").value.trim();
  const node = pendingSceneType === "folder"
    ? { id: "folder-" + Date.now(), type: "folder", title, children: [] }
    : { id: "scene-" + Date.now(), type: "scene", title, synopsis, status: "todo", content: "" };

  let targetArray = p.data.scenes;
  if (pendingSceneParentId) {
    const parentInfo = findSceneNode(pendingSceneParentId, p.data.scenes);
    if (parentInfo && parentInfo.node.type === "folder") {
      parentInfo.node.children = parentInfo.node.children || [];
      targetArray = parentInfo.node.children;
      expandedFolders.add(pendingSceneParentId);
    }
  }
  targetArray.push(node);
  el("sceneModal").classList.add("hidden");
  if (node.type === "scene") selectScene(node.id);
  else renderSceneList();
  markDirtyAndSchedule();
}
function duplicateScene(id) {
  const info = findSceneNode(id);
  if (!info) return;
  syncSceneFromDetail();   // salinan berisi tulisan terbaru
  const copy = deepCloneNode(info.node);
  copy.title = (info.node.title || (info.node.type === "folder" ? "Bab" : "Scene")) + " (salinan)";
  info.array.splice(info.index + 1, 0, copy);
  if (copy.type === "folder") expandedFolders.add(copy.id);
  twClearSearch();
  renderSceneList();
  twRefreshCrumbs();
  const row = twRowEl(copy.id);
  if (row) { twRevealRow(row); row.classList.add("is-new"); }
  toast((copy.type === "folder" ? "Bab" : "Scene") + " diduplikat", tiIcon("copy"));
  markDirtyAndSchedule();
}
function deleteSceneNode(id) {
  const info = findSceneNode(id);
  if (!info) return;
  const isFolder = info.node.type === "folder", name = info.node.title || (isFolder ? "Bab tanpa judul" : "tanpa judul");
  const n = isFolder ? flattenScenes(info.node.children).length : 0;
  const msg = isFolder ? (n ? `Hapus bab “${name}” beserta ${n} scene di dalamnya?` : `Hapus bab “${name}”?`) : `Hapus scene “${name}”?`;
  if (!confirm(msg)) return;
  syncSceneFromDetail();
  const before = twSceneOrder(), at = before.findIndex((x) => x.id === currentSceneId);
  const p = getProject(currentProjectId);
  info.array.splice(info.index, 1);
  const curGone = !currentSceneId || !findSceneNode(currentSceneId);
  if (curGone) {   // scene yang terbuka ikut terhapus -> buka tetangganya (sesudah, lalu sebelum)
    const left = new Set(flattenScenes(p.data.scenes).map((x) => x.id));
    const next = before.slice(Math.max(0, at)).find((x) => left.has(x.id)) || before.slice(0, Math.max(0, at)).reverse().find((x) => left.has(x.id)) || findFirstScene(p.data.scenes);
    currentSceneId = next ? next.id : null;
  }
  expandedFolders.delete(id);
  renderSceneList();
  if (curGone) renderSceneDetail(); else twRefreshCrumbs();
  toast((isFolder ? "Bab" : "Scene") + " dihapus", tiIcon("trash"));
  markDirtyAndSchedule();
}
// alias lama, tetap dipakai di beberapa tempat
function renderSceneListSoft() { renderSceneList(); }
function deleteScene(id) { deleteSceneNode(id); }



// ---- STATISTIK TEKS (kata, karakter, kalimat, paragraf) ----
function computeTextStats(text) {
  const trimmed = (text || "").trim();
  const words = trimmed ? trimmed.split(/\s+/).length : 0;
  const chars = (text || "").replace(/\n/g, "").length;
  const sentences = trimmed ? (trimmed.match(/[^.!?]*[.!?]+|[^.!?]+$/g) || []).filter((s) => s.trim().length > 0).length : 0;
  const paragraphs = trimmed ? trimmed.split(/\n+/).filter((p) => p.trim().length > 0).length : 0;
  return { words, chars, sentences, paragraphs };
}
function statsLabel(stats) { return `${stats.words} kata · ${stats.chars} karakter · ${stats.sentences} kalimat · ${stats.paragraphs} paragraf`; }
function updateFocusStats() {
  const fe = el("focusEditor"), stats = computeTextStats(twTextOf(fe));
  el("focusStats").textContent = `${twFmt(stats.words)} kata · ${twFmt(stats.chars)} karakter`;
  el("focusStats").title = statsLabel(stats);
  fe.classList.toggle("is-empty", !fe.textContent.trim() && !fe.querySelector("hr, img, li"));
}
function updateFocusToolbarState() {
  document.querySelectorAll(".focus-toolbar button[data-cmd]").forEach((btn) => {
    try { btn.classList.toggle("active", document.queryCommandState(btn.dataset.cmd)); } catch (e) {}
  });
}

// ---- FOCUS MODE (full writer tanpa gangguan) ----
let focusSceneId = null;
// isi & judul ditulis ke scene saat diketik (initTwUi); tampilan huruf/lebar/zoom sama dengan halaman Tulis
function openFocusMode(id) {
  const s = findScene(id);
  if (!s || s.type === "folder") return;
  if (id !== currentSceneId && !el("tabWrite").classList.contains("hidden")) selectScene(id);   // keluar dari mode fokus = kembali ke scene ini
  syncSceneFromDetail();
  focusSceneId = id;
  twHideBubble(); twHidePeek(); twCloseStats(); closeSceneDrawer();
  twApplyPrefs();
  el("focusTitle").value = s.title || "";
  el("focusTitle").placeholder = "Judul scene";
  el("focusEditor").innerHTML = s.content || "";
  el("focusEditor").dataset.placeholder = "Mulai menulis…";
  el("focusOverlay").classList.remove("hidden");
  el("focusEditor").focus();
  updateFocusStats();
}
function closeFocusMode() {
  const s = findScene(focusSceneId);
  if (s) { s.title = el("focusTitle").value; s.content = el("focusEditor").innerHTML; }
  el("focusOverlay").classList.add("hidden");
  focusSceneId = null;
  renderSceneList(); renderSceneDetail();
  markDirtyAndSchedule();
  const ed = el("sceneEditor");
  if (ed && !el("tabWrite").classList.contains("hidden")) ed.focus({ preventScroll: true });
}

// ---- ORGANIZE TAB ----
function switchOrganizeCat(cat) {
  syncOrganizeFromDetail();
  currentOrgCat = cat;
  currentOrgItemId = null;
  document.querySelectorAll(".org-subtab").forEach((b) => b.classList.toggle("active", b.dataset.cat === cat));
  const labels = { characters: "KARAKTER", locations: "LOKASI", notes: "CATATAN" };
  el("organizeCatLabel").textContent = labels[cat];
  renderOrganizeList(); renderOrganizeDetail();
}
let draggedOrgItemId = null;
function renderOrganizeList() {
  const p = getProject(currentProjectId);
  const list = p.data.organize[currentOrgCat] || [];
  const container = el("organizeList");
  container.innerHTML = "";
  list.forEach((item) => {
    const card = document.createElement("div");
    card.className = "scene-card" + (item.id === currentOrgItemId ? " active" : "");
    card.draggable = true;
    card.innerHTML = `
      <div class="scene-card-top">
        <span class="drag-handle" title="Seret untuk pindahkan urutan">${TREE_ICONS.grip}</span>
        <div class="scene-card-title">${escapeHtml(item.title)}</div>
        <div class="scene-card-icons">
          <button class="scene-icon-btn scene-icon-danger" data-action="delete" title="Hapus" aria-label="Hapus">${tiPx(tiIcon("trash"), 14)}</button>
        </div>
      </div>`;
    card.addEventListener("click", (e) => {
      if (e.target.closest(".scene-icon-btn")?.dataset.action === "delete") { deleteOrganizeItem(item.id); return; }
      syncOrganizeFromDetail(); currentOrgItemId = item.id; renderOrganizeList(); renderOrganizeDetail();
    });
    card.addEventListener("dragstart", (e) => { draggedOrgItemId = item.id; card.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; });
    card.addEventListener("dragend", () => card.classList.remove("dragging"));
    card.addEventListener("dragover", (e) => { e.preventDefault(); card.classList.add("drag-over"); });
    card.addEventListener("dragleave", () => card.classList.remove("drag-over"));
    card.addEventListener("drop", (e) => {
      e.preventDefault(); card.classList.remove("drag-over");
      if (!draggedOrgItemId || draggedOrgItemId === item.id) return;
      reorderOrganizeItems(draggedOrgItemId, item.id);
    });
    container.appendChild(card);
  });
}
function reorderOrganizeItems(draggedId, targetId) {
  const p = getProject(currentProjectId);
  const arr = p.data.organize[currentOrgCat];
  const fromIdx = arr.findIndex((x) => x.id === draggedId);
  const toIdx = arr.findIndex((x) => x.id === targetId);
  if (fromIdx < 0 || toIdx < 0) return;
  const [it] = arr.splice(fromIdx, 1);
  arr.splice(toIdx, 0, it);
  renderOrganizeList();
  markDirtyAndSchedule();
}
function deleteOrganizeItem(id) {
  if (!confirm("Hapus item ini?")) return;
  const p = getProject(currentProjectId);
  p.data.organize[currentOrgCat] = p.data.organize[currentOrgCat].filter((x) => x.id !== id);
  if (currentOrgItemId === id) currentOrgItemId = null;
  renderOrganizeList(); renderOrganizeDetail();
  markDirtyAndSchedule();
}
function syncOrganizeFromDetail() {
  if (!currentProjectId || !currentOrgItemId) return;
  const p = getProject(currentProjectId);
  const item = (p.data.organize[currentOrgCat] || []).find((x) => x.id === currentOrgItemId);
  if (!item || !el("orgTitleField")) return;
  item.title = el("orgTitleField").value;
  item.content = el("orgEditor").innerHTML;
}
function renderOrganizeDetail() {
  const p = getProject(currentProjectId);
  const col = el("organizeDetailCol");
  const item = (p.data.organize[currentOrgCat] || []).find((x) => x.id === currentOrgItemId);
  if (!item) { col.innerHTML = '<div class="scene-empty-hint">Pilih atau buat item untuk mulai isi.</div>'; return; }
  col.innerHTML = `
    <div class="scene-detail-header"><input id="orgTitleField" class="scene-title-input" value="${escapeHtml(item.title)}" /></div>
    <div id="orgEditor" class="organize-editor" contenteditable="true" spellcheck="false">${item.content || ""}</div>`;
  el("orgTitleField").addEventListener("input", () => { item.title = el("orgTitleField").value; renderOrganizeList(); markDirtyAndSchedule(); });
  el("orgEditor").addEventListener("input", () => { item.content = el("orgEditor").innerHTML; markDirtyAndSchedule(); });
  noteTabDoc("organize", { doc: item.id, kind: currentOrgCat, title: item.title });   // TAB PROJECT: riwayat
}
function openAddOrganizeModal() { el("organizeFieldTitle").value = ""; el("organizeModal").classList.remove("hidden"); el("organizeFieldTitle").focus(); }
function saveNewOrganizeItem() {
  const p = getProject(currentProjectId);
  const title = el("organizeFieldTitle").value.trim() || "Baru";
  const item = { id: currentOrgCat + "-" + Date.now(), title, content: "" };
  p.data.organize[currentOrgCat].push(item);
  el("organizeModal").classList.add("hidden");
  currentOrgItemId = item.id;
  renderOrganizeList(); renderOrganizeDetail();
  markDirtyAndSchedule();
}

// ---- PREVIEW ----
function previewNodesToHtml(list) {
  let html = "";
  (list || []).forEach((n) => {
    if (n.type === "folder") { html += `<h2 class="preview-chapter">${tiIcon("folder")}${escapeHtml(n.title)}</h2>`; html += previewNodesToHtml(n.children); }
    else html += `<h3>${escapeHtml(n.title)}</h3>${n.content || "<p><i>(kosong)</i></p>"}`;
  });
  return html;
}
function openPreview() {
  flushCurrentEdits();
  const p = getProject(currentProjectId);
  el("previewTitle").textContent = p.title;
  const html = previewNodesToHtml(p.data.scenes);
  el("previewContent").innerHTML = html || "<p>Belum ada tulisan.</p>";
  el("previewModal").classList.remove("hidden");
}

// ================= SAVE STATUS =================
// #saveStatus (kanan bawah editor; disalin ke bar bawah Tulis). data-state: saving | local | synced | offline | login |
// error | conflict | readonly. "login" & "error" bisa diklik: login ulang / coba sinkron lagi.
// markSaved HANYA untuk simpan yang benar-benar berhasil — status lain lewat setSaveStatus (tanda "belum tersimpan" tetap).
const SAVE_ACTION_STATES = ["login", "error"];
function setSaveStatus(label, icon, state) {
  const s = el("saveStatus");
  if (!s) return;
  const st = state || "synced", text = label || "Tersimpan";
  if (s.dataset.state === st && s.dataset.label === text) return;   // tiap ketukan tombol: tidak perlu menulis ulang DOM
  s.dataset.state = st; s.dataset.label = text;
  s.innerHTML = (icon ? tiPx(icon, 13) : "") + escapeHtml(text);
  const action = SAVE_ACTION_STATES.includes(st);
  s.classList.toggle("is-action", action);
  if (action) {
    s.setAttribute("role", "button"); s.tabIndex = 0;
    s.title = st === "login" ? "Klik untuk login ulang ke Google — tulisanmu tetap aman" : "Klik untuk mencoba sinkron lagi";
  } else { s.removeAttribute("role"); s.removeAttribute("tabindex"); s.title = ""; }
}
function markDirty() {
  hasUnsyncedChanges = true; dirtySinceLastBackup = true;
  if (!firstDirtyAt) firstDirtyAt = Date.now();
  const p = getProject(currentProjectId);
  if (p) p._editSeq = (p._editSeq || 0) + 1;   // nomor suntingan: simpan yang selesai setelah ada ketikan baru tidak dianggap "tersimpan"
  setSaveStatus("Menyimpan…", null, "saving");
}
// icon (opsional) = markup ikon Tabler di depan label status, mis. markSaved("Tersimpan", tiIcon("cloud-check"))
function markSaved(label, icon) {
  hasUnsyncedChanges = false; firstDirtyAt = null;
  setSaveStatus(label || "Tersimpan", icon, "synced");
}
const hhmm = () => new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
// masih ada yang belum sampai ke Drive? (dipakai peringatan "tinggalkan halaman")
function hasPendingSave() {
  const ns = window.NovelistSync;
  if (ns && typeof ns.hasPending === "function") return ns.hasPending();
  return hasUnsyncedChanges;
}
// Tab ditutup / disembunyikan / dimuat ulang: ketikan yang belum masuk data (kolom edit Jejaring/Beranda, editor) masuk
// sekarang, lalu salinan darurat ditulis SINKRON (novelist-sync -> localStorage), karena simpan async bisa tidak sempat selesai.
function flushBeforeLeave() {
  try {
    const p = getProject(currentProjectId);
    if (p && !el("editorView").classList.contains("hidden")) {
      flushCurrentEdits();
      const t = el("projectTitle").value;
      if (t && p.title !== t) { p.title = t; p.data.title = t; }
    }
  } catch (e) { console.error(e); }
  try { if (window.NovelistSync && typeof window.NovelistSync.emergencySave === "function") window.NovelistSync.emergencySave(); }
  catch (e) { console.error(e); }
}
async function doAutosaveFlush() {
  clearTimeout(saveDebounceTimer);
  firstDirtyAt = null;
  flushCurrentEdits();
  const p = getProject(currentProjectId);
  if (p) { p.title = el("projectTitle").value; p.data.title = p.title; await saveProjectToDriveMain(p); }
}
function markDirtyAndSchedule() {
  markDirty();
  clearTimeout(saveDebounceTimer);
  // Kalau sudah mengetik terus-menerus lebih dari MAX_WAIT, tetap paksa simpan
  // supaya tidak menunggu selamanya sampai orang berhenti mengetik.
  const elapsed = Date.now() - firstDirtyAt;
  const wait = elapsed >= AUTOSAVE_MAX_WAIT_MS ? 0 : AUTOSAVE_DEBOUNCE_MS;
  saveDebounceTimer = setTimeout(doAutosaveFlush, wait);
  // Beranda: dokumen baru / terhapus dicatat ke jejak (dicek sebentar kemudian; ikut tersimpan di simpan berikutnya)
  if (window.NovelHome && window.NovelHome.track) window.NovelHome.track(getProject(currentProjectId));
}

// ================= GOOGLE DRIVE (REST API) =================
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
let mainFolderIdCache = null;
let backupFolderIdCache = null;
let trashFolderIdCache = null;

// Error yang butuh login ulang ditandai code "auth" (dikenali novelist-sync & status simpan)
function driveAuthError(msg) { const e = new Error(msg); e.code = "auth"; return e; }
const isDriveAuthError = (e) => !!e && (e.code === "auth" || /Sesi Google berakhir|Belum login/i.test(e.message || ""));
const withAuth = (options) => ({ ...options, headers: { ...(options.headers || {}), Authorization: `Bearer ${accessToken}` } });
// Token yang hampir/sudah habis diperpanjang diam-diam dulu; jawaban 401 -> perpanjang lalu ulangi SEKALI.
// Baru kalau itu gagal, token dibuang & error "auth" dilempar (penyimpanan menunggu login ulang, data tidak dibuang).
async function driveFetch(url, options = {}) {
  if (!accessToken || tokenExpiringSoon()) await refreshAccessToken(false);
  if (!accessToken) throw driveAuthError("Belum login ke Google");
  let res = await fetch(url, withAuth(options));
  if (res.status === 401 && (await refreshAccessToken(true))) res = await fetch(url, withAuth(options));
  if (res.status === 401) { accessToken = null; tokenExpiresAt = 0; throw driveAuthError("Sesi Google berakhir, silakan login ulang."); }
  if (!res.ok) { const e = new Error(`Drive API error ${res.status}: ${await res.text()}`); e.status = res.status; throw e; }
  return res;
}
async function getOrCreateFolder(name, cacheKey) {
  if (cacheKey === "main" && mainFolderIdCache) return mainFolderIdCache;
  if (cacheKey === "backup" && backupFolderIdCache) return backupFolderIdCache;
  if (cacheKey === "trash" && trashFolderIdCache) return trashFolderIdCache;
  const q = encodeURIComponent(`mimeType='application/vnd.google-apps.folder' and name='${name}' and trashed=false`);
  const res = await driveFetch(`${DRIVE_API}/files?q=${q}&fields=files(id,name)`);
  const data = await res.json();
  let id;
  if (data.files.length > 0) id = data.files[0].id;
  else {
    const createRes = await driveFetch(`${DRIVE_API}/files`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder" }) });
    id = (await createRes.json()).id;
  }
  if (cacheKey === "main") mainFolderIdCache = id;
  else if (cacheKey === "backup") backupFolderIdCache = id;
  else if (cacheKey === "trash") trashFolderIdCache = id;
  return id;
}
async function driveListInFolder(folderId, extraQuery = "") {
  const q = encodeURIComponent(`'${folderId}' in parents and trashed=false${extraQuery}`);
  const res = await driveFetch(`${DRIVE_API}/files?q=${q}&fields=files(id,name,modifiedTime)&orderBy=modifiedTime desc&pageSize=100`);
  return (await res.json()).files;
}
// Upload multipart Drive dibatasi 5 MB; project yang lebih besar (banyak gambar) diunggah lewat sesi resumable
const DRIVE_MULTIPART_MAX = 4 * 1024 * 1024;
async function driveUpload(fileName, jsonContent, fileId, folderId) {
  const metadata = fileId ? {} : { name: fileName, parents: [folderId] };
  const n = jsonContent.length;
  if (n > DRIVE_MULTIPART_MAX || (n * 3 > DRIVE_MULTIPART_MAX && new Blob([jsonContent]).size > DRIVE_MULTIPART_MAX)) {
    return driveUploadResumable(metadata, jsonContent, fileId);
  }
  const boundary = "novelist_boundary_" + Date.now();
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${jsonContent}\r\n--${boundary}--`;
  const url = fileId ? `${DRIVE_UPLOAD_API}/files/${fileId}?uploadType=multipart&fields=id,name,modifiedTime` : `${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=id,name,modifiedTime`;
  const res = await driveFetch(url, { method: fileId ? "PATCH" : "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body });
  return await res.json();
}
async function driveUploadResumable(metadata, jsonContent, fileId) {
  const q = "?uploadType=resumable&fields=id,name,modifiedTime";
  const start = await driveFetch(fileId ? `${DRIVE_UPLOAD_API}/files/${fileId}${q}` : `${DRIVE_UPLOAD_API}/files${q}`, {
    method: fileId ? "PATCH" : "POST",
    headers: { "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": "application/json" },
    body: JSON.stringify(metadata),
  });
  const session = start.headers.get("Location");
  if (!session) throw new Error("Drive API error: sesi upload resumable tidak didapat");
  const res = await driveFetch(session, { method: "PUT", headers: { "Content-Type": "application/json" }, body: jsonContent });
  return await res.json();
}
async function driveGetContent(fileId) { return (await driveFetch(`${DRIVE_API}/files/${fileId}?alt=media`)).text(); }
async function driveDelete(fileId) { await driveFetch(`${DRIVE_API}/files/${fileId}`, { method: "DELETE" }); }
// Pindahkan file antar folder tanpa upload ulang isinya (dipakai untuk Trash: pindah ke/keluar folder trash)
async function driveMoveFile(fileId, fromFolderId, toFolderId) {
  await driveFetch(`${DRIVE_API}/files/${fileId}?addParents=${toFolderId}&removeParents=${fromFolderId}&fields=id,parents`, { method: "PATCH" });
}

// ---- simpan file utama project ----
// (Versi web & Android memakai novelist-sync.js yang mengganti fungsi ini: simpan di perangkat dulu + deteksi konflik.
// Ini jalur cadangan bila novelist-sync.js tidak termuat — tetap aman: satu upload per project, gagal = tetap ditandai
// belum tersimpan + dicoba lagi otomatis.)
// Satu upload per project pada satu waktu; permintaan selama upload berjalan digabung menjadi SATU upload berikutnya
// berisi data terbaru (urutan tidak bisa tertukar, project baru tidak dibuat dua kali).
const driveSaveJobs = new Map();   // p.id -> { promise, again }
const driveRetry = { timer: 0, delay: 0 };
function saveProjectToDriveMain(p) {
  if (!p || p._deleted) return Promise.resolve();
  const running = driveSaveJobs.get(p.id);
  if (running) { running.again = true; return running.promise; }
  const job = { again: false, promise: null };
  job.promise = (async () => {
    try { do { job.again = false; await uploadProjectOnce(p, job); } while (job.again && !p._deleted); }
    finally { driveSaveJobs.delete(p.id); }
  })();
  driveSaveJobs.set(p.id, job);
  return job.promise;
}
async function uploadProjectOnce(p, job) {
  const seq = p._editSeq || 0;
  try {
    const folderId = await getOrCreateFolder(DRIVE_FOLDER_NAME, "main");
    const json = JSON.stringify({ ...p.data, cover: p.cover || null });
    const result = await driveUpload(p.title + ".novj", json, p.driveFileId, folderId);
    if (p._deleted) {
      // Project dihapus SAAT save ini masih berjalan (race condition) — jangan biarkan
      // file yang baru saja dibuat/diupdate nongkrong di folder utama, langsung pindah ke Trash.
      try {
        const trashFolderId = await getOrCreateFolder(DRIVE_TRASH_FOLDER_NAME, "trash");
        await driveMoveFile(result.id, folderId, trashFolderId);
      } catch (e) { console.error(e); }
      return;
    }
    p.driveFileId = result.id;
    p.updatedAt = new Date().toISOString();
    driveRetry.delay = 0;
    // ada ketikan baru selama upload -> belum "tersimpan" (upload berikutnya sudah dijadwalkan autosave)
    if (p.id === currentProjectId && (p._editSeq || 0) === seq && !job.again) markSaved("Tersinkron ke Drive · " + hhmm(), tiIcon("cloud-check"));
    updateSyncIndicator(true);
    if (!el("dashboardView").classList.contains("hidden")) renderDashboard();
  } catch (e) {
    console.error(e);
    hasUnsyncedChanges = true;   // JANGAN dianggap tersimpan: peringatan saat menutup tab tetap muncul
    const auth = isDriveAuthError(e), offline = navigator.onLine === false;
    if (p.id === currentProjectId) {
      if (auth) setSaveStatus("Perlu login ulang", tiIcon("alert-triangle"), "login");
      else if (offline) setSaveStatus("Offline — belum tersinkron", tiIcon("cloud-x"), "offline");
      else setSaveStatus("Gagal sinkron — coba lagi", tiIcon("alert-triangle"), "error");
    }
    updateSyncIndicator(false);
    if (!auth) scheduleDriveRetry(p);
  }
}
// coba lagi otomatis: 2 dtk, 4, 8, … maks. 1 menit (offline: menunggu event "online")
function scheduleDriveRetry(p) {
  clearTimeout(driveRetry.timer);
  driveRetry.delay = Math.min(60000, Math.max(2000, driveRetry.delay * 2));
  driveRetry.timer = setTimeout(() => {
    if (navigator.onLine === false || window.NovelistSync) return;
    if (projects.includes(p) && !p._deleted) saveProjectToDriveMain(p);
  }, driveRetry.delay);
}
// klik status "Perlu login ulang" / "Gagal sinkron" (jalur cadangan; novelist-sync memasang penanganannya sendiri)
async function retrySaveFromStatus() {
  if (window.NovelistSync) return;
  const p = getProject(currentProjectId);
  if (!accessToken) {
    try { await driveSignIn(false); } catch (e) { toast("Login gagal: " + ((e && (e.error || e.message)) || e), tiIcon("alert-triangle")); return; }
  }
  if (p) { driveRetry.delay = 0; await saveProjectToDriveMain(p); }
}

// ---- backup bertimestamp ke folder terpisah ----
async function backupProjectNow(p, silent = false) {
  if (!p || !accessToken) return;
  try {
    const folderId = await getOrCreateFolder(DRIVE_BACKUP_FOLDER_NAME, "backup");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const fileName = `${p.title}__${stamp}.novj`;
    const payload = { ...p.data, cover: p.cover || null };
    await driveUpload(fileName, JSON.stringify(payload), null, folderId);
    await pruneOldBackups(p, folderId);
    if (!silent) toast("Backup tersimpan", tiIcon("history"));
    dirtySinceLastBackup = false;
  } catch (e) { console.error("Backup gagal", e); }
}
async function pruneOldBackups(p, folderId) {
  const q = ` and name contains '${p.title}__'`;
  const files = await driveListInFolder(folderId, q);
  if (files.length > MAX_BACKUPS_PER_PROJECT) {
    const toDelete = files.slice(MAX_BACKUPS_PER_PROJECT);
    for (const f of toDelete) { try { await driveDelete(f.id); } catch (e) {} }
  }
}
function startBackupInterval() {
  stopBackupInterval();
  backupIntervalHandle = setInterval(() => {
    const p = getProject(currentProjectId);
    if (p && dirtySinceLastBackup) backupProjectNow(p, true);
  }, BACKUP_INTERVAL_MS);
}
function stopBackupInterval() { if (backupIntervalHandle) clearInterval(backupIntervalHandle); backupIntervalHandle = null; }

async function openBackupHistory() {
  const p = getProject(currentProjectId);
  if (!p) return;
  el("backupModal").classList.remove("hidden");
  el("backupList").innerHTML = '<p style="color:var(--text-dim);font-size:13px;">Memuat...</p>';
  try {
    const folderId = await getOrCreateFolder(DRIVE_BACKUP_FOLDER_NAME, "backup");
    const files = await driveListInFolder(folderId, ` and name contains '${p.title}__'`);
    if (files.length === 0) { el("backupList").innerHTML = '<p style="color:var(--text-dim);font-size:13px;">Belum ada backup untuk project ini.</p>'; return; }
    el("backupList").innerHTML = "";
    files.forEach((f) => {
      const row = document.createElement("div");
      row.className = "backup-item";
      row.innerHTML = `<span>${new Date(f.modifiedTime).toLocaleString()}</span><button>Pulihkan</button>`;
      row.querySelector("button").onclick = async () => {
        if (!confirm("Pulihkan dari backup ini? Perubahan yang belum disimpan di project aktif akan tertimpa.")) return;
        const content = await driveGetContent(f.id);
        const restored = migrateOldData(JSON.parse(content));
        hideProjectModules();   // modul yang masih memegang data lama dilepas dulu (isinya tidak ikut menimpa)
        p.data = restored;
        p.cover = restored.cover || null;
        el("backupModal").classList.add("hidden");
        openProject(p.id);
        markDirtyAndSchedule();   // versi hasil pulihan = suntingan baru -> langsung disimpan (tidak kembali ke versi lama saat reload)
        toast("Project dipulihkan dari backup", tiIcon("restore"));
      };
      el("backupList").appendChild(row);
    });
  } catch (e) { el("backupList").innerHTML = '<p style="color:var(--danger);font-size:13px;">Gagal memuat backup.</p>'; }
}

async function loadProjectsFromDrive(isInitialLogin = false) {
  el("loadingState").classList.remove("hidden");
  el("emptyState").classList.add("hidden");
  el("btnAddProject").classList.add("hidden");
  try {
    const folderId = await getOrCreateFolder(DRIVE_FOLDER_NAME, "main");
    const files = await driveListInFolder(folderId);
    if (!isInitialLogin) projects = [];
    for (const f of files) {
      if (projects.some((p) => p.driveFileId === f.id)) continue;
      const content = await driveGetContent(f.id);
      const rawData = JSON.parse(content);
      const data = migrateOldData(rawData);
      const colorPair = COLOR_PAIRS[Math.floor(Math.random() * COLOR_PAIRS.length)];
      projects.push({
        id: "proj-" + f.id, title: data.title || f.name.replace(".novj", ""), description: "",
        template: "standard", cover: rawData.cover || null,
        colorA: colorPair[0], colorB: colorPair[1],
        driveFileId: f.id, updatedAt: f.modifiedTime, data
      });
    }
    updateSyncIndicator(true);
  } catch (e) {
    console.error(e);
    updateSyncIndicator(false);
    if (isInitialLogin) toast("Gagal memuat project dari Drive: " + e.message, tiIcon("alert-triangle"));
  }
  renderDashboard();
}
// ================= CLOUD LIBRARY (manual send/receive, terpisah dari autosave) =================
function formatDateTime(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }) + " " + d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
}
function openCloudLibrary() {
  closeAccountView();   // kembali dari Cloud Library = daftar project
  el("dashboardView").classList.add("hidden");
  el("editorView").classList.add("hidden");
  el("cloudLibraryView").classList.remove("hidden");
  switchCloudTab("send");
}
function closeCloudLibrary() {
  el("cloudLibraryView").classList.add("hidden");
  el("dashboardView").classList.remove("hidden");
  renderDashboard();
}
function switchCloudTab(tab) {
  el("tabSendToCloud").classList.toggle("active", tab === "send");
  el("tabReceiveFromCloud").classList.toggle("active", tab === "receive");
  el("tabTrash").classList.toggle("active", tab === "trash");
  el("sendToCloudPanel").classList.toggle("hidden", tab !== "send");
  el("receiveFromCloudPanel").classList.toggle("hidden", tab !== "receive");
  el("trashPanel").classList.toggle("hidden", tab !== "trash");
  if (tab === "send") renderSendToCloudList();
  else if (tab === "receive") renderReceiveFromCloudList();
  else renderTrashList();
}
function cloudAvatarHtml(title, cover, colorA, colorB) {
  if (cover) return `<img class="cloud-avatar" src="${cover}" alt="" />`;
  const bg = colorA ? `background:linear-gradient(135deg, ${colorA}, ${colorB || colorA})` : "";
  return `<div class="cloud-avatar cloud-avatar-letter" style="${bg}">${escapeHtml((title || "?").charAt(0).toUpperCase())}</div>`;
}
function renderSendToCloudList() {
  const panel = el("sendToCloudPanel");
  panel.innerHTML = "";
  if (projects.length === 0) { panel.innerHTML = '<p class="cloud-empty">Belum ada project lokal untuk dikirim.</p>'; return; }
  projects.forEach((p) => {
    const row = document.createElement("div");
    row.className = "cloud-row";
    row.innerHTML = `
      ${cloudAvatarHtml(p.title, p.cover, p.colorA, p.colorB)}
      <div class="cloud-row-title">${escapeHtml(p.title)}</div>
      <div class="cloud-row-meta">${p.driveFileId ? "Terkirim " + timeAgo(p.updatedAt) : "Belum pernah dikirim"}</div>
      <button class="cloud-action-btn" title="Kirim ke Cloud" aria-label="Kirim ke Cloud">${tiPx(tiIcon("cloud-upload"), 20)}</button>`;
    row.querySelector(".cloud-action-btn").onclick = async (e) => {
      e.stopPropagation();
      const btn = e.currentTarget;
      btn.innerHTML = tiPx(tiIcon("loader-2"), 20);   // berputar (CSS .cloud-action-btn.is-busy)
      btn.classList.add("is-busy");
      if (currentProjectId === p.id) flushCurrentEdits();
      await saveProjectToDriveMain(p);
      btn.classList.remove("is-busy");
      btn.innerHTML = tiPx(tiIcon("check"), 20);
      setTimeout(() => renderSendToCloudList(), 900);
    };
    panel.appendChild(row);
  });
}
async function renderReceiveFromCloudList() {
  const panel = el("receiveFromCloudPanel");
  panel.innerHTML = '<p class="cloud-empty">Memuat daftar dari Drive...</p>';
  try {
    const folderId = await getOrCreateFolder(DRIVE_FOLDER_NAME, "main");
    const files = await driveListInFolder(folderId);
    if (files.length === 0) { panel.innerHTML = '<p class="cloud-empty">Belum ada file tersimpan di Drive.</p>'; return; }
    panel.innerHTML = "";
    files.forEach((f) => {
      const localMatch = projects.find((p) => p.driveFileId === f.id);
      const row = document.createElement("div");
      row.className = "cloud-row";
      row.innerHTML = `
        ${cloudAvatarHtml(f.name, localMatch?.cover, localMatch?.colorA, localMatch?.colorB)}
        <div class="cloud-row-title">${escapeHtml(f.name.replace(/\.novj$/, ""))}</div>
        <div class="cloud-row-meta">${formatDateTime(f.modifiedTime)}</div>
        <button class="cloud-action-btn" title="Ambil dari Cloud" aria-label="Ambil dari Cloud">${tiPx(tiIcon("cloud-download"), 20)}</button>`;
      row.onclick = () => pullFromCloud(f);
      panel.appendChild(row);
    });
  } catch (e) { panel.innerHTML = '<p class="cloud-empty">Gagal memuat daftar: ' + escapeHtml(e.message) + "</p>"; }
}
async function pullFromCloud(f) {
  try {
    const content = await driveGetContent(f.id);
    const rawData = JSON.parse(content);
    const data = migrateOldData(rawData);
    let p = projects.find((x) => x.driveFileId === f.id);
    if (p) {
      p.data = data; p.title = data.title || p.title; p.cover = data.cover || null; p.updatedAt = f.modifiedTime;
    } else {
      const colorPair = COLOR_PAIRS[Math.floor(Math.random() * COLOR_PAIRS.length)];
      p = { id: "proj-" + f.id, title: data.title || f.name.replace(/\.novj$/, ""), description: "", template: "standard", cover: data.cover || null, colorA: colorPair[0], colorB: colorPair[1], driveFileId: f.id, updatedAt: f.modifiedTime, data };
      projects.unshift(p);
    }
    toast('Project "' + p.title + '" diambil dari Cloud', tiIcon("cloud-download"));
    el("cloudLibraryView").classList.add("hidden");
    openProject(p.id);
  } catch (e) { alert("Gagal mengambil dari Drive: " + e.message); }
}

// ---- TRASH: project yang dihapus dipindah ke sini dulu, bukan langsung hilang permanen ----
async function renderTrashList() {
  const panel = el("trashPanel");
  panel.innerHTML = '<p class="cloud-empty">Memuat Trash dari Drive...</p>';
  try {
    const trashFolderId = await getOrCreateFolder(DRIVE_TRASH_FOLDER_NAME, "trash");
    const files = await driveListInFolder(trashFolderId);
    if (files.length === 0) { panel.innerHTML = '<p class="cloud-empty">Trash kosong. Project yang dihapus akan muncul di sini.</p>'; return; }
    panel.innerHTML = "";
    files.forEach((f) => {
      const row = document.createElement("div");
      row.className = "cloud-row";
      row.innerHTML = `
        ${cloudAvatarHtml(f.name, null, null, null)}
        <div class="cloud-row-title">${escapeHtml(f.name.replace(/\.novj$/, ""))}</div>
        <div class="cloud-row-meta">Dihapus ${timeAgo(f.modifiedTime)}</div>
        <div class="cloud-row-actions">
          <button class="cloud-action-btn" data-act="restore" title="Pulihkan project" aria-label="Pulihkan project">${tiPx(tiIcon("restore"), 20)}</button>
          <button class="cloud-action-btn cloud-action-danger" data-act="wipe" title="Hapus permanen" aria-label="Hapus permanen">${tiPx(tiIcon("trash-x"), 20)}</button>
        </div>`;
      row.querySelector('[data-act="restore"]').onclick = (e) => { e.stopPropagation(); restoreFromTrash(f); };
      row.querySelector('[data-act="wipe"]').onclick = (e) => { e.stopPropagation(); permanentlyDeleteFromTrash(f); };
      panel.appendChild(row);
    });
  } catch (e) { panel.innerHTML = '<p class="cloud-empty">Gagal memuat Trash: ' + escapeHtml(e.message) + "</p>"; }
}
async function restoreFromTrash(f) {
  try {
    const mainFolderId = await getOrCreateFolder(DRIVE_FOLDER_NAME, "main");
    const trashFolderId = await getOrCreateFolder(DRIVE_TRASH_FOLDER_NAME, "trash");
    await driveMoveFile(f.id, trashFolderId, mainFolderId);
    const content = await driveGetContent(f.id);
    const rawData = JSON.parse(content);
    const data = migrateOldData(rawData);
    const colorPair = COLOR_PAIRS[Math.floor(Math.random() * COLOR_PAIRS.length)];
    const p = { id: "proj-" + f.id, title: data.title || f.name.replace(/\.novj$/, ""), description: "", template: "standard", cover: data.cover || null, colorA: colorPair[0], colorB: colorPair[1], driveFileId: f.id, updatedAt: new Date().toISOString(), data };
    if (!projects.some((x) => x.driveFileId === f.id)) projects.unshift(p);
    toast('Project "' + p.title + '" dipulihkan', tiIcon("restore"));
    renderTrashList();
  } catch (e) { toast("Gagal memulihkan: " + e.message, tiIcon("alert-triangle")); }
}
async function permanentlyDeleteFromTrash(f) {
  if (!confirm(`Hapus permanen "${f.name.replace(/\.novj$/, "")}"? Tindakan ini tidak bisa dibatalkan.`)) return;
  try {
    await driveDelete(f.id);
    toast("Dihapus permanen dari Trash", tiIcon("trash-x"));
    renderTrashList();
  } catch (e) { toast("Gagal menghapus permanen: " + e.message, tiIcon("alert-triangle")); }
}

function updateSyncIndicator(ok) {
  const ind = el("syncIndicator");
  ind.innerHTML = ok ? `${tiPx(tiIcon("cloud-check"), 14)}<span>Tersinkron</span>` : `${tiPx(tiIcon("cloud-x"), 14)}<span>Gagal sinkron</span>`;
  ind.style.color = ok ? "var(--success)" : "var(--danger)";
}

// ================= AKUN (Pengaturan Akun) =================
// Info akun dibaca dari Drive API about.get (jalan dengan scope drive.file): nama, email, foto, permissionId & kuota Drive.
// Preferensi profil (username, nama tampilan, foto unggahan) disimpan LOKAL di browser per akun Google
// (localStorage "novelist_profile_<permissionId>") — Novelist tidak punya server, jadi profil ini tidak ikut ke perangkat lain.
// Semua kegagalan jatuh ke placeholder supaya dashboard tidak pernah ikut rusak.
const ACCOUNT_REFRESH_MS = 5 * 60000;          // data akun disegarkan saat halaman akun dibuka bila lebih tua dari ini
const PROFILE_KEY_PREFIX = "novelist_profile_";
const FIRST_SEEN_KEY_PREFIX = "novelist_first_seen_";
const THEME_KEY = "novelist_theme";
const USERNAME_RE = /^[a-z0-9_.]{3,24}$/;
let accountInfo = null;          // { user: {displayName, emailAddress, photoLink, permissionId}, quota: {limit, usage} | null, memberSince, fetchedAt }
let accountStatus = "idle";      // idle | loading | ok | error
let accountFetchPromise = null;
let accountGen = 0;              // naik tiap logout: hasil fetch lama dibuang
let accountViewOpen = false;
let accountPendingAvatar;        // modal profil: undefined = tidak diubah, null = kembali ke foto Google, string = data URL baru
let avatarPickTarget = "direct"; // "direct" = klik avatar besar (langsung disimpan), "modal" = tombol unggah di modal profil

function loadAccountInfo(force = false) {
  if (!accessToken) return Promise.resolve(accountInfo);
  if (!force && accountInfo && Date.now() - accountInfo.fetchedAt < ACCOUNT_REFRESH_MS) return Promise.resolve(accountInfo);
  if (accountFetchPromise) return accountFetchPromise;
  const gen = accountGen;
  if (!accountInfo) { accountStatus = "loading"; renderAccountAll(); }
  const run = (async () => {
    try {
      const res = await driveFetch(`${DRIVE_API}/about?fields=user(displayName,emailAddress,photoLink,permissionId),storageQuota(limit,usage)`);
      const about = await res.json();
      if (gen !== accountGen) return null;
      const user = about.user || {};
      let memberSince = accountInfo && accountInfo.user.permissionId === user.permissionId ? accountInfo.memberSince : null;
      if (!memberSince) memberSince = await fetchMemberSince().catch(() => null);
      if (gen !== accountGen) return null;
      accountInfo = { user, quota: about.storageQuota || null, memberSince, fetchedAt: Date.now() };
      accountStatus = "ok";
      rememberFirstSeen();
    } catch (e) {
      console.warn("Info akun gagal dimuat:", e);
      if (gen === accountGen) accountStatus = accountInfo ? "ok" : "error";
    } finally {
      if (accountFetchPromise === run) accountFetchPromise = null;
    }
    if (gen === accountGen) renderAccountAll();
    return accountInfo;
  })();
  accountFetchPromise = run;
  return run;
}
// "Member sejak" = tanggal folder utama Novelist dibuat di Drive. Folder TIDAK dibuat dari sini (hanya dibaca),
// supaya tidak balapan dengan getOrCreateFolder() milik loadProjectsFromDrive saat login.
async function fetchMemberSince() {
  if (mainFolderIdCache) {
    const f = await (await driveFetch(`${DRIVE_API}/files/${mainFolderIdCache}?fields=createdTime`)).json();
    return f.createdTime || null;
  }
  const q = encodeURIComponent(`mimeType='application/vnd.google-apps.folder' and name='${DRIVE_FOLDER_NAME}' and trashed=false`);
  const data = await (await driveFetch(`${DRIVE_API}/files?q=${q}&fields=files(id,createdTime)&orderBy=createdTime&pageSize=1`)).json();
  return (data.files && data.files[0] && data.files[0].createdTime) || null;
}
function resetAccountState() {
  accountGen++;
  accountInfo = null; accountStatus = "idle"; accountFetchPromise = null;
  closeAccountView();
  renderAccountRail();
}

// ---- preferensi lokal per akun ----
function accountStoreKey(prefix) { return prefix + ((accountInfo && accountInfo.user.permissionId) || "local"); }
function rememberFirstSeen() {
  try { const k = accountStoreKey(FIRST_SEEN_KEY_PREFIX); if (!localStorage.getItem(k)) localStorage.setItem(k, new Date().toISOString()); } catch (e) { /* storage diblokir */ }
}
function readFirstSeen() { try { return localStorage.getItem(accountStoreKey(FIRST_SEEN_KEY_PREFIX)); } catch (e) { return null; } }
function loadProfilePrefs() {
  let p = null;
  try { p = JSON.parse(localStorage.getItem(accountStoreKey(PROFILE_KEY_PREFIX)) || "null"); } catch (e) { p = null; }
  if (!p || typeof p !== "object") p = {};
  return {
    username: typeof p.username === "string" && USERNAME_RE.test(p.username) ? p.username : null,
    displayName: typeof p.displayName === "string" && p.displayName.trim() ? p.displayName.trim().slice(0, 40) : null,
    avatar: typeof p.avatar === "string" && p.avatar.startsWith("data:image/") ? p.avatar : null,
  };
}
function saveProfilePrefs(patch) {
  const next = { ...loadProfilePrefs(), ...patch };
  Object.keys(next).forEach((k) => { if (next[k] == null || next[k] === "") delete next[k]; });
  try { localStorage.setItem(accountStoreKey(PROFILE_KEY_PREFIX), JSON.stringify(next)); return true; }
  catch (e) { toast("Gagal menyimpan: penyimpanan browser penuh atau diblokir", tiIcon("alert-triangle")); return false; }
}

// ---- nilai turunan (Google + override lokal) ----
function accountEmail() { return (accountInfo && accountInfo.user.emailAddress) || ""; }
function accountDisplayName() { return loadProfilePrefs().displayName || (accountInfo && accountInfo.user.displayName) || accountEmail().split("@")[0] || "Penulis"; }
function defaultUsername() {
  const base = (accountEmail().split("@")[0] || (accountInfo && accountInfo.user.displayName) || "").toLowerCase().replace(/[^a-z0-9_.]/g, "").slice(0, 24);
  return base.length >= 3 ? base : "penulis";
}
function accountUsername() { return loadProfilePrefs().username || defaultUsername(); }
function googlePhotoUrl() {
  const link = accountInfo && accountInfo.user.photoLink;
  if (!link) return null;
  return link.replace(/=s\d+(-c)?$/, "=s256-c");   // foto Google default 64px -> minta 256px supaya tajam di avatar besar
}
function accountAvatarSrc() { return loadProfilePrefs().avatar || googlePhotoUrl(); }
function formatBytes(n) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = Number(n) || 0, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return v.toLocaleString("id-ID", { maximumFractionDigits: i === 0 || v >= 100 ? 0 : 1 }) + " " + units[i];
}

// ---- render ----
// avatar bulat: huruf awal di atas lingkaran aksen; foto (Google / unggahan) menimpanya setelah berhasil dimuat
function paintAvatar(box, src, name) {
  if (!box) return;
  const initial = Array.from((name || "").trim())[0];
  const key = (src || "") + "|" + (initial || "");
  if (box.dataset.key === key) return;   // tidak berubah: jangan muat ulang gambarnya
  box.dataset.key = key;
  box.classList.remove("has-img");
  box.innerHTML = `<span class="acc-initial">${initial ? escapeHtml(initial.toUpperCase()) : tiIcon("user")}</span>`;
  if (!src) return;
  const img = document.createElement("img");
  img.alt = ""; img.draggable = false; img.decoding = "async"; img.referrerPolicy = "no-referrer";
  img.onload = () => box.classList.add("has-img");
  img.onerror = () => { img.remove(); box.classList.remove("has-img"); };
  img.src = src;
  box.appendChild(img);
}
function renderAccountRail() {
  const name = accountInfo ? accountDisplayName() : "";
  paintAvatar(el("railAvatar"), accountInfo ? accountAvatarSrc() : null, name);
  el("btnRailAccount").setAttribute("aria-label", name ? `Pengaturan Akun (${name})` : "Pengaturan Akun");
}
function renderAccountView() {
  if (!accountViewOpen) return;
  const u = (accountInfo && accountInfo.user) || {};
  const failed = !accountInfo && accountStatus === "error";
  const name = accountInfo ? accountDisplayName() : failed ? "Akun Google" : "Memuat akun…";
  el("accName").textContent = name;
  el("accEmail").textContent = u.emailAddress || (failed ? "Info akun belum bisa dimuat — coba buka lagi nanti." : "");
  const since = accountInfo ? accountInfo.memberSince || readFirstSeen() : null;
  const sinceDate = since ? new Date(since) : null;
  el("accSince").textContent = sinceDate && !isNaN(sinceDate) ? "Member sejak " + sinceDate.toLocaleDateString("id-ID", { month: "long", year: "numeric" }) : "";
  paintAvatar(el("accAvatar"), accountInfo ? accountAvatarSrc() : null, accountInfo ? name : "");
  el("accUsername").textContent = "@" + accountUsername();
  el("accEmailValue").textContent = u.emailAddress || "—";
  el("accEmailValue").title = u.emailAddress || "";
  el("accGoogleSub").textContent = u.emailAddress || "Terhubung";
  el("accProjectCount").textContent = projects.length + " project";
  renderAccountStorage(failed);
  syncAccountThemeSeg();
}
function renderAccountStorage(failed) {
  const q = accountInfo && accountInfo.quota;
  const text = el("accStorageText"), wrap = el("accStorageBarWrap"), bar = el("accStorageBar");
  wrap.classList.remove("is-empty", "is-unlimited", "is-full");
  wrap.removeAttribute("aria-valuenow");
  if (!q) {
    text.textContent = failed || accountInfo ? "Tidak tersedia" : "Memuat…";
    wrap.classList.add("is-empty");
  } else {
    const usage = Number(q.usage) || 0, limit = Number(q.limit) || 0;
    if (limit > 0) {
      const pct = Math.min(100, (usage / limit) * 100);
      text.textContent = `${formatBytes(usage)} dari ${formatBytes(limit)}`;
      bar.style.width = (usage > 0 ? Math.max(pct, 1.5) : 0) + "%";
      wrap.classList.toggle("is-full", pct >= 90);
      wrap.setAttribute("aria-valuenow", String(Math.round(pct)));
    } else {   // tanpa limit (mis. akun Workspace tertentu): tampilkan pemakaian saja
      text.textContent = `${formatBytes(usage)} terpakai · tanpa batas`;
      wrap.classList.add("is-unlimited");
    }
  }
  el("accStorageNote").innerHTML = `Semua project tersimpan di Google Drive-mu sendiri: folder <b>${escapeHtml(DRIVE_FOLDER_NAME)}</b>, backup otomatis di <b>${escapeHtml(DRIVE_BACKUP_FOLDER_NAME)}</b>, dan project yang dihapus di <b>${escapeHtml(DRIVE_TRASH_FOLDER_NAME)}</b>. Tidak ada yang disimpan di server kami.`;
}
function renderAccountAll() { renderAccountRail(); renderAccountView(); }
function syncAccountThemeSeg() {
  const light = document.body.classList.contains("light");
  el("accThemeSeg").querySelectorAll("button").forEach((b) => {
    const on = (b.dataset.theme === "light") === light;
    b.classList.toggle("is-on", on);
    b.setAttribute("aria-checked", String(on));
  });
}

// ---- buka / tutup halaman akun ----
function setRailPage(page) {
  [["btnRailProjects", "projects"], ["btnRailAccount", "account"]].forEach(([id, p]) => {
    const b = el(id);
    b.classList.toggle("is-active", p === page);
    if (p === page) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  });
}
function openAccountView() {
  closeAllDropdowns();
  hideDashCover();
  const view = el("accountView");
  const wasOpen = accountViewOpen;
  accountViewOpen = true;
  el("dashboardView").classList.add("is-account");
  view.classList.remove("hidden");
  setRailPage("account");
  renderAccountView();
  loadAccountInfo();   // segarkan bila data sudah lebih tua dari ACCOUNT_REFRESH_MS
  if (wasOpen) return;
  view.scrollTop = 0;
  document.addEventListener("keydown", accountKeyHandler);
  view.focus({ preventScroll: true });
  animateAccountIn();
}
function closeAccountView() {
  if (!accountViewOpen) return;
  accountViewOpen = false;
  closeAccountModals();
  el("dashboardView").classList.remove("is-account");
  el("accountView").classList.add("hidden");
  setRailPage("projects");
  document.removeEventListener("keydown", accountKeyHandler);
}
function accountKeyHandler(e) {
  if (e.key !== "Escape" || e.defaultPrevented) return;   // defaultPrevented: Esc sudah dipakai menutup menu gear
  const openModals = [...document.querySelectorAll(".modal:not(.hidden)")];
  if (openModals.length) { if (openModals.some((m) => m.classList.contains("acc-modal"))) closeAccountModals(); return; }
  if (!el("settingsMenu").classList.contains("hidden") || el("dashboardView").classList.contains("hidden")) return;
  closeAccountView();
  el("btnRailProjects").focus();
}
function animateAccountIn() {
  const M = window.Motion;
  if (!M || !M.animate || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  try {
    M.animate(el("accountView").querySelectorAll(".acc-anim"), { opacity: [0, 1], y: [10, 0] },
      { duration: 0.36, delay: M.stagger ? M.stagger(0.035) : 0, ease: [0.2, 0.8, 0.2, 1] });
  } catch (e) { /* animasi hanya hiasan */ }
}

// ---- modal username & profil ----
function closeAccountModals() {
  el("accUsernameModal").classList.add("hidden");
  el("accProfileModal").classList.add("hidden");
  closeAccountDeleteModal();   // tidak menutup saat penghapusan sedang berjalan
}
function usernameError(v) {
  if (v.length < 3) return "Minimal 3 karakter.";
  if (v.length > 24) return "Maksimal 24 karakter.";
  if (!USERNAME_RE.test(v)) return "Hanya huruf kecil, angka, titik (.) dan garis bawah (_).";
  return null;
}
function showUsernameMsg(err) {
  const msg = el("accUsernameMsg");
  msg.textContent = err || "3–24 karakter: huruf kecil, angka, titik (.) atau garis bawah (_).";
  msg.classList.toggle("is-error", !!err);
  el("accUsernameInput").classList.toggle("is-invalid", !!err);
  el("accUsernameInput").setAttribute("aria-invalid", String(!!err));
}
function openUsernameModal() {
  const input = el("accUsernameInput");
  input.value = accountUsername();
  showUsernameMsg(null);
  el("accUsernameModal").classList.remove("hidden");
  input.focus(); input.select();
}
function saveUsernameModal() {
  const v = el("accUsernameInput").value.trim().toLowerCase();
  const err = usernameError(v);
  if (err) { showUsernameMsg(err); el("accUsernameInput").focus(); return; }
  if (!saveProfilePrefs({ username: v })) return;
  closeAccountModals();
  renderAccountAll();
  toast("Username disimpan: @" + v, tiIcon("circle-check"));
}
function profileModalAvatarSrc() {
  if (accountPendingAvatar === undefined) return accountAvatarSrc();
  return accountPendingAvatar || googlePhotoUrl();
}
function paintProfileModalAvatar() {
  const name = el("accPfName").value.trim() || (accountInfo && accountInfo.user.displayName) || accountDisplayName();
  paintAvatar(el("accPfAvatar"), profileModalAvatarSrc(), name);
  const usingCustom = accountPendingAvatar === undefined ? !!loadProfilePrefs().avatar : !!accountPendingAvatar;
  el("accPfGoogle").disabled = !usingCustom;
}
function openProfileModal() {
  accountPendingAvatar = undefined;
  const input = el("accPfName");
  input.value = loadProfilePrefs().displayName || "";
  input.placeholder = (accountInfo && accountInfo.user.displayName) || "Nama tampilan";
  paintProfileModalAvatar();
  el("accProfileModal").classList.remove("hidden");
  input.focus();
}
function saveProfileModal() {
  const name = el("accPfName").value.trim().slice(0, 40);
  const googleName = accountInfo && accountInfo.user.displayName;
  const patch = { displayName: name && name !== googleName ? name : null };
  if (accountPendingAvatar !== undefined) patch.avatar = accountPendingAvatar;
  if (!saveProfilePrefs(patch)) return;
  closeAccountModals();
  renderAccountAll();
  toast("Profil disimpan", tiIcon("circle-check"));
}
// gambar apa pun -> potong persegi di tengah -> 256x256 JPEG (data URL kecil, muat di localStorage)
function imageFileToSquare(file, size = 256) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type)) { reject(new Error("File yang dipilih bukan gambar")); return; }
    if (file.size > 25 * 1024 * 1024) { reject(new Error("Gambar terlalu besar (maks. 25 MB)")); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const s = Math.min(img.naturalWidth, img.naturalHeight);
        const c = document.createElement("canvas");
        c.width = c.height = size;
        const ctx = c.getContext("2d");
        ctx.fillStyle = "#1d1d22";   // latar untuk gambar transparan (JPEG tidak punya alpha)
        ctx.fillRect(0, 0, size, size);
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, size, size);
        resolve(c.toDataURL("image/jpeg", 0.88));
      } catch (e) { reject(new Error("Gambar tidak bisa diproses")); }
      finally { URL.revokeObjectURL(url); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Gambar tidak bisa dibaca")); };
    img.src = url;
  });
}
function pickAvatar(target) {
  avatarPickTarget = target;
  const input = el("accAvatarInput");
  input.value = "";
  input.click();
}
async function onAvatarPicked(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    const dataUrl = await imageFileToSquare(file, 256);
    if (avatarPickTarget === "modal") { accountPendingAvatar = dataUrl; paintProfileModalAvatar(); }
    else if (saveProfilePrefs({ avatar: dataUrl })) { renderAccountAll(); toast("Foto profil diperbarui", tiIcon("circle-check")); }
  } catch (err) { toast(err.message || "Gambar tidak bisa dipakai", tiIcon("alert-triangle")); }
}

function initAccount() {
  // tema terakhir disimpan di browser; observer menjaga semua tombol tema (rail, menu, sidebar, halaman akun) tetap sinkron
  try { if (localStorage.getItem(THEME_KEY) === "light") document.body.classList.add("light"); } catch (e) { /* abaikan */ }
  let lastLight = document.body.classList.contains("light");
  new MutationObserver(() => {
    const light = document.body.classList.contains("light");
    if (light === lastLight) return;
    lastLight = light;
    try { localStorage.setItem(THEME_KEY, light ? "light" : "dark"); } catch (e) { /* abaikan */ }
    syncAccountThemeSeg();
  }).observe(document.body, { attributes: true, attributeFilter: ["class"] });
  syncAccountThemeSeg();
  renderAccountRail();

  el("btnRailProjects").onclick = () => closeAccountView();
  el("btnRailAccount").onclick = () => openAccountView();
  el("menuAccountSettings").onclick = () => openAccountView();
  el("menuHelp").onclick = () => el("supportModal").classList.remove("hidden");
  el("btnSideAccount").onclick = () => { backToLibrary(); openAccountView(); };
  el("accAvatarBtn").onclick = () => pickAvatar("direct");
  el("accRowUsername").onclick = openUsernameModal;
  el("accRowProfile").onclick = openProfileModal;
  el("accThemeSeg").querySelectorAll("button").forEach((b) => b.onclick = () => document.body.classList.toggle("light", b.dataset.theme === "light"));
  el("accGoogleDisconnect").onclick = () => { if (confirm("Putuskan Google dari Novelist? Kamu akan keluar dan perlu login lagi untuk membuka project-mu.")) driveSignOut(); };
  // (tombol "Keluar dari akun" dihapus dari halaman ini — keluar lewat rail & menu gear)
  initA11y();            // Aksesibilitas: ukuran teks, font disleksia, mode hemat performa
  initAccountDelete();   // Zona berbahaya: hapus akun

  const uInput = el("accUsernameInput");
  uInput.addEventListener("input", () => {
    const lower = uInput.value.toLowerCase().replace(/\s/g, "");
    if (lower !== uInput.value) { const pos = uInput.selectionStart; uInput.value = lower; uInput.setSelectionRange(pos, pos); }
    showUsernameMsg(lower.length >= 3 ? usernameError(lower) : null);   // terlalu pendek baru ditegur saat Simpan
  });
  uInput.addEventListener("keydown", (e) => { if (e.key === "Enter") saveUsernameModal(); });
  el("accUsernameCancel").onclick = closeAccountModals;
  el("accUsernameSave").onclick = saveUsernameModal;
  el("accPfName").addEventListener("input", paintProfileModalAvatar);
  el("accPfName").addEventListener("keydown", (e) => { if (e.key === "Enter") saveProfileModal(); });
  el("accPfUpload").onclick = () => pickAvatar("modal");
  el("accPfGoogle").onclick = () => { accountPendingAvatar = null; paintProfileModalAvatar(); };
  el("accPfCancel").onclick = closeAccountModals;
  el("accPfSave").onclick = saveProfileModal;
  el("accAvatarInput").addEventListener("change", onAvatarPicked);
  document.querySelectorAll(".acc-modal").forEach((m) => m.addEventListener("click", (e) => { if (e.target === m) closeAccountModals(); }));
  // Esc menutup menu gear (di halaman mana pun)
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !el("settingsMenu").classList.contains("hidden")) { e.preventDefault(); closeAllDropdowns(); el("btnSettings").focus(); }
  });
}

// ================= AKSESIBILITAS (Pengaturan Akun → Aksesibilitas) =================
// Tiga setelan, disimpan HANYA di perangkat ini (localStorage "novelist_a11y" = { scale, dyslexic, boost }), berlaku juga
// di halaman login:
// - Ukuran teks: variabel --fs-scale di <html> (1 / 1.05 / 1.1 / 1.2). Semua font-size di style.css ditulis
//   calc(Npx * var(--fs-scale, 1)), jadi hanya TEKS yang membesar — 1rem, ikon berukuran tetap & label kanvas peta tidak.
// - Font ramah disleksia: body.a11y-dyslexic -> OpenDyslexic (vendor/fonts, baru diunduh browser saat dipakai).
// - Mode hemat performa: body.perf-boost -> tanpa backdrop-filter & blur, panel kaca jadi solid, foto background disembunyikan.
//   "auto" (bawaan) mengikuti prefers-reduced-transparency sistem sampai pengguna memilih sendiri ("on" / "off").
// Skrip kecil di awal <body> (index.html) sudah memasang semuanya sebelum halaman pertama kali tampil; applyA11y() di sini
// menyamakan ulang + memberi tahu modul lain lewat event window "novelist:a11y".
const A11Y_KEY = "novelist_a11y";
const A11Y_SCALES = [1, 1.05, 1.1, 1.2];
const A11Y_DEFAULT = { scale: 1, dyslexic: false, boost: "auto" };
const a11yBoostMq = window.matchMedia ? window.matchMedia("(prefers-reduced-transparency: reduce)") : null;
let a11yPrefs = { ...A11Y_DEFAULT };

function loadA11yPrefs() {
  let p = null;
  try { p = JSON.parse(localStorage.getItem(A11Y_KEY) || "null"); } catch (e) { p = null; }
  if (!p || typeof p !== "object") p = {};
  return {
    scale: A11Y_SCALES.includes(Number(p.scale)) ? Number(p.scale) : 1,
    dyslexic: p.dyslexic === true,
    boost: p.boost === "on" || p.boost === "off" ? p.boost : "auto",
  };
}
function saveA11yPrefs() {
  const d = A11Y_DEFAULT;
  try {
    if (a11yPrefs.scale === d.scale && a11yPrefs.dyslexic === d.dyslexic && a11yPrefs.boost === d.boost) localStorage.removeItem(A11Y_KEY);
    else localStorage.setItem(A11Y_KEY, JSON.stringify(a11yPrefs));
  } catch (e) { /* storage diblokir: setelan tetap berlaku selama sesi ini */ }
}
function a11ySystemBoost() { return !!(a11yBoostMq && a11yBoostMq.matches); }
function a11yBoostOn() { return a11yPrefs.boost === "on" || (a11yPrefs.boost === "auto" && a11ySystemBoost()); }
function applyA11y() {
  const root = document.documentElement;
  if (a11yPrefs.scale === 1) root.style.removeProperty("--fs-scale"); else root.style.setProperty("--fs-scale", String(a11yPrefs.scale));
  document.body.classList.toggle("a11y-dyslexic", a11yPrefs.dyslexic);
  document.body.classList.toggle("perf-boost", a11yBoostOn());
  syncA11yControls();
  try { window.dispatchEvent(new CustomEvent("novelist:a11y", { detail: { ...a11yPrefs, boostOn: a11yBoostOn() } })); } catch (e) { /* abaikan */ }
}
function setA11y(patch) {
  a11yPrefs = { ...a11yPrefs, ...patch };
  saveA11yPrefs();
  applyA11y();
}
function syncA11yControls() {
  const seg = el("accFontSizeSeg");
  if (!seg) return;
  seg.querySelectorAll("button").forEach((b) => {
    const on = Number(b.dataset.scale) === a11yPrefs.scale;
    b.classList.toggle("is-on", on);
    b.setAttribute("aria-checked", String(on));
    b.tabIndex = on ? 0 : -1;   // radiogroup: Tab masuk ke pilihan aktif, panah untuk pindah
  });
  el("accDysSwitch").setAttribute("aria-checked", String(a11yPrefs.dyslexic));
  const boost = a11yBoostOn();
  el("accBoostSwitch").setAttribute("aria-checked", String(boost));
  el("accBoostState").textContent = a11yPrefs.boost === "auto"
    ? `Mengikuti sistem — sekarang ${boost ? "aktif" : "nonaktif"}`
    : `Dipilih manual — ${boost ? "aktif" : "nonaktif"}`;
  el("accBoostAuto").classList.toggle("hidden", a11yPrefs.boost === "auto");
}

function initA11y() {
  a11yPrefs = loadA11yPrefs();
  applyA11y();
  if (a11yBoostMq) {
    const onSys = () => { if (a11yPrefs.boost === "auto") applyA11y(); };
    if (a11yBoostMq.addEventListener) a11yBoostMq.addEventListener("change", onSys); else if (a11yBoostMq.addListener) a11yBoostMq.addListener(onSys);
  }
  const seg = el("accFontSizeSeg");
  const tiles = [...seg.querySelectorAll("button")];
  tiles.forEach((b) => b.onclick = () => setA11y({ scale: Number(b.dataset.scale) }));
  seg.addEventListener("keydown", (e) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const i = tiles.findIndex((b) => Number(b.dataset.scale) === a11yPrefs.scale);
    const next = e.key === "Home" ? 0 : e.key === "End" ? tiles.length - 1 : (i + step + tiles.length) % tiles.length;
    setA11y({ scale: Number(tiles[next].dataset.scale) });
    tiles[next].focus();
  });
  el("accDysSwitch").onclick = () => setA11y({ dyslexic: !a11yPrefs.dyslexic });
  el("accBoostSwitch").onclick = () => setA11y({ boost: a11yBoostOn() ? "off" : "on" });
  el("accBoostAuto").onclick = () => { setA11y({ boost: "auto" }); el("accBoostSwitch").focus(); };   // tombolnya hilang -> fokus pindah
  // klik di teks baris = klik saklarnya (tombol lain di baris itu tetap bekerja sendiri)
  [["accDysRow", "accDysSwitch"], ["accBoostRow", "accBoostSwitch"]].forEach(([rowId, swId]) => {
    el(rowId).addEventListener("click", (e) => { if (!e.target.closest("button")) el(swId).click(); });
  });
}

// ================= HAPUS AKUN (Pengaturan Akun → Zona berbahaya) =================
// Novelist tidak punya server, jadi "akun" = 3 folder buatan Novelist di Google Drive pengguna (project, backup, trash —
// nama dari config.js) + data di perangkat ini. Hapus akun:
//  1. hentikan autosave & backup berkala (supaya tidak ada yang membuat folder baru),
//  2. cari folder lewat nama (TANPA membuat — beda dengan getOrCreateFolder) lalu PATCH { trashed: true } satu per satu
//     -> masuk Trash Google Drive (bisa dipulihkan 30 hari). Gagal -> folder yang sudah dibuang dikembalikan, tetap login,
//  3. hapus semua key localStorage/sessionStorage "novelist*" (+ key lama tanpa awalan) & IndexedDB "novelist",
//  4. cabut token Google (driveSignOut), lalu muat ulang halaman supaya semua setelan kembali ke bawaan;
//     halaman login menampilkan pemberitahuan (flag sementara di sessionStorage).
const ACCOUNT_DELETE_WORD = "HAPUS";
const ACCOUNT_DELETED_FLAG = "novelist_account_deleted";   // sessionStorage, dibaca sekali setelah reload
const LEGACY_LOCAL_KEYS = ["dashTitleLast"];                 // key lama Novelist tanpa awalan "novelist"
let accountDeleteBusy = false;

function openAccountDeleteModal() {
  if (accountDeleteBusy) return;
  const names = [DRIVE_FOLDER_NAME, DRIVE_BACKUP_FOLDER_NAME, DRIVE_TRASH_FOLDER_NAME];
  el("accDelFolders").innerHTML = names.map((n) => `<b>${escapeHtml(n)}</b>`).join(", ");
  el("accDelCount").textContent = projects.length + " project";
  const input = el("accDeleteInput");
  input.value = "";
  input.disabled = false;
  setAccountDeleteMsg("", false);
  syncAccountDeleteConfirm();
  el("accDeleteModal").classList.remove("hidden");
  input.focus();
}
function closeAccountDeleteModal(force = false) {
  if (accountDeleteBusy && !force) return;
  el("accDeleteModal").classList.add("hidden");
}
function setAccountDeleteMsg(text, isError) {
  const m = el("accDeleteMsg");
  m.textContent = text;
  m.classList.toggle("is-error", !!isError);
}
function syncAccountDeleteConfirm() {
  const ok = el("accDeleteInput").value.trim().toUpperCase() === ACCOUNT_DELETE_WORD;
  el("accDeleteConfirm").disabled = !ok || accountDeleteBusy;
}
function setAccountDeleteBusy(on) {
  accountDeleteBusy = on;
  const btn = el("accDeleteConfirm");
  btn.classList.toggle("is-busy", on);
  btn.setAttribute("aria-busy", String(on));
  btn.querySelector("use").setAttribute("href", on ? "#ti-loader-2" : "#ti-trash");
  el("accDeleteConfirmLabel").textContent = on ? "Menghapus…" : "Hapus akun";
  el("accDeleteInput").disabled = on;
  el("accDeleteCancel").disabled = on;
  syncAccountDeleteConfirm();
}

// folder Novelist (dicari lewat nama, tidak pernah dibuat dari sini). Bisa lebih dari satu dengan nama yang sama.
async function findNovelistDriveFolders() {
  const found = [];
  for (const name of [DRIVE_FOLDER_NAME, DRIVE_BACKUP_FOLDER_NAME, DRIVE_TRASH_FOLDER_NAME]) {
    const safe = name.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const q = encodeURIComponent(`mimeType='application/vnd.google-apps.folder' and name='${safe}' and trashed=false`);
    const data = await (await driveFetch(`${DRIVE_API}/files?q=${q}&fields=files(id,name)&pageSize=100`)).json();
    (data.files || []).forEach((f) => { if (f && f.id && !found.some((x) => x.id === f.id)) found.push({ id: f.id, name }); });
  }
  return found;
}
function driveSetTrashed(id, trashed) {
  return driveFetch(`${DRIVE_API}/files/${encodeURIComponent(id)}?fields=id,trashed`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trashed }),
  });
}
// semua data Novelist di perangkat ini: localStorage & sessionStorage "novelist*" + key lama, IndexedDB "novelist"
async function clearNovelistLocalData() {
  [() => window.localStorage, () => window.sessionStorage].forEach((getStore) => {
    try {
      const store = getStore();   // mengakses storage saja bisa melempar error bila diblokir browser
      const keys = [];
      for (let i = 0; i < store.length; i++) keys.push(store.key(i));
      keys.forEach((k) => { if (k && (/^novelist/i.test(k) || LEGACY_LOCAL_KEYS.includes(k))) store.removeItem(k); });
    } catch (e) { /* storage diblokir: tidak ada yang tersimpan */ }
  });
  await new Promise((resolve) => {
    let req;
    try { req = window.indexedDB.deleteDatabase("novelist"); } catch (e) { resolve(); return; }
    const t = setTimeout(resolve, 2500);   // onblocked (tab lain masih membuka db): penghapusan tetap terjadi setelah tab itu menutup
    req.onsuccess = req.onerror = req.onblocked = () => { clearTimeout(t); resolve(); };
  });
}
// cabut token Google lalu tunggu sebentar (maks. 3 dtk) supaya permintaan revoke selesai sebelum halaman dimuat ulang
function revokeGoogleAccess() {
  return new Promise((resolve) => {
    const token = accessToken;
    const oauth2 = window.google && window.google.accounts && window.google.accounts.oauth2;
    if (!token || !oauth2 || !oauth2.revoke) { resolve(); return; }
    const t = setTimeout(resolve, 3000);
    try { oauth2.revoke(token, () => { clearTimeout(t); resolve(); }); } catch (e) { clearTimeout(t); resolve(); }
  });
}

async function runAccountDelete() {
  if (accountDeleteBusy || el("accDeleteInput").value.trim().toUpperCase() !== ACCOUNT_DELETE_WORD) return;
  if (!accessToken) { setAccountDeleteMsg("Sesi Google berakhir — login lagi dulu, lalu ulangi.", true); return; }
  setAccountDeleteBusy(true);
  // 1. hentikan semua penyimpanan otomatis
  const hadBackup = !!backupIntervalHandle;
  clearTimeout(saveDebounceTimer);
  stopBackupInterval();
  const trashed = [];
  try {
    // 2. folder Drive -> Trash
    setAccountDeleteMsg("Mencari folder Novelist di Google Drive…");
    const folders = await findNovelistDriveFolders();
    for (let i = 0; i < folders.length; i++) {
      setAccountDeleteMsg(`Memindahkan folder ke Trash Google Drive (${i + 1}/${folders.length}): ${folders[i].name}…`);
      await driveSetTrashed(folders[i].id, true);
      trashed.push(folders[i]);
    }
  } catch (e) {
    console.error("Hapus akun gagal:", e);
    let restored = true;
    for (const f of trashed.reverse()) { try { await driveSetTrashed(f.id, false); } catch (e2) { restored = false; } }
    setAccountDeleteBusy(false);
    if (hadBackup && accessToken) startBackupInterval();
    // "Drive API error 403: {json}" -> "Drive API error 403: <pesan dari Google>"
    let why = (e && e.message) || String(e);
    const m = /^(Drive API error \d+): ([\s\S]*)$/.exec(why);
    if (m) { try { const j = JSON.parse(m[2]); why = m[1] + ((j && j.error && j.error.message) ? " — " + j.error.message : ""); } catch (e2) { why = m[1]; } }
    setAccountDeleteMsg(`Gagal menghapus akun: ${why}.` + (trashed.length
      ? (restored ? " Folder yang sudah dipindah ke Trash sudah dikembalikan." : " Sebagian folder sudah ada di Trash Google Drive — pulihkan dari sana bila perlu.")
      : "") + (accessToken ? " Kamu masih login; coba lagi nanti." : " Login lagi, lalu coba lagi."), true);
    syncAccountDeleteConfirm();   // (tanpa toast: pesannya sudah di modal, toast malah menutupi tombolnya)
    return;
  }
  // 3. data di perangkat ini, 4. keluar + cabut akses Google, lalu mulai bersih
  setAccountDeleteMsg("Menghapus data Novelist di perangkat ini…");
  hasUnsyncedChanges = false;   // jangan ada peringatan "perubahan belum tersimpan" / autosave saat halaman dimuat ulang
  await clearNovelistLocalData();
  setAccountDeleteMsg("Keluar & mencabut akses Google…");
  await revokeGoogleAccess();
  accessToken = null;   // sudah dicabut di atas — driveSignOut tidak perlu mencabut lagi
  closeAccountDeleteModal(true);
  setAccountDeleteBusy(false);
  a11yPrefs = { ...A11Y_DEFAULT };   // setelan aksesibilitas langsung kembali ke bawaan (tanpa menyimpan apa pun)
  applyA11y();
  driveSignOut();
  showAccountDeletedNotice(trashed.length);
  // muat ulang supaya tema, background, gambar login, sidebar, aksesibilitas, dll. kembali ke bawaan; notice ditampilkan
  // lagi setelah reload lewat flag. sessionStorage diblokir -> tidak reload (notice di atas tetap terlihat).
  let flagged = false;
  try { sessionStorage.setItem(ACCOUNT_DELETED_FLAG, String(trashed.length)); flagged = true; } catch (e) { flagged = false; }
  if (flagged) setTimeout(() => { hasUnsyncedChanges = false; clearTimeout(saveDebounceTimer); location.reload(); }, 60);   // (modul yang ditutup driveSignOut bisa menandai "belum tersimpan")
}
function showAccountDeletedNotice(folderCount) {
  showLoginNotice("Akun Novelist-mu sudah dihapus. " + (Number(folderCount) > 0
    ? "Folder Novelist dipindah ke Trash Google Drive dan masih bisa dipulihkan dari sana selama 30 hari. "
    : "") + "Semua pengaturan di perangkat ini sudah dihapus dan akses Google sudah dicabut.");
  clearTimeout(loginNoticeTimer);   // pesan penting: tampil lebih lama dari notice biasa (4 dtk)
  loginNoticeTimer = setTimeout(() => el("loginNotice").classList.add("hidden"), 15000);
}

function initAccountDelete() {
  el("accDeleteBtn").onclick = openAccountDeleteModal;
  el("accDeleteCancel").onclick = () => closeAccountDeleteModal();
  el("accDeleteConfirm").onclick = runAccountDelete;
  const input = el("accDeleteInput");
  input.addEventListener("input", () => { syncAccountDeleteConfirm(); if (!accountDeleteBusy) setAccountDeleteMsg("", false); });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") runAccountDelete(); });
  // setelah reload karena hapus akun: tampilkan pemberitahuan sekali di halaman login
  let flag = null;
  try { flag = sessionStorage.getItem(ACCOUNT_DELETED_FLAG); sessionStorage.removeItem(ACCOUNT_DELETED_FLAG); } catch (e) { flag = null; }
  if (flag !== null) showAccountDeletedNotice(flag);
}

// ================= BACKGROUND (Pengaturan Akun → Tampilan) =================
// Foto background dashboard (bawaan bg-canyon.jpg) bisa diganti gambar sendiri. Tampilannya tetap sama dengan bawaan:
// gambarnya cuma dipasang sebagai inline background-image di #dashBgPhoto (.galaxy-photo), jadi blur, vignette, dot-grid
// kaca buram & crossfade cover project yang di-hover tetap dari CSS .galaxy-*. Project tanpa cover juga memakainya.
// Slider Blur & Redup = variabel CSS --dash-bg-blur / --dash-bg-dim di #dashboardView (default = tampilan bawaan).
// Disimpan HANYA di perangkat ini (tidak ikut akun/Drive, tetap ada setelah logout): gambar (Blob) di IndexedDB
// "novelist"/"kv" lewat loginArtKv() (helper key-value yang sama dengan login art), setelan slider di localStorage.
// Storage diblokir -> background tetap dipakai selama sesi ini.
const DASH_BG_KEY = "dashBgCustom";              // key di IndexedDB novelist/kv
const DASH_BG_PREFS_KEY = "novelist_dash_bg";    // localStorage: { blur, dim }
const DASH_BG_MAX_BYTES = 20 * 1024 * 1024;      // batas ukuran file masukan
const DASH_BG_MAX_SIDE = 2560;                   // sisi terpanjang setelah diperkecil (layar penuh, tapi di-blur -> cukup)
const DASH_BG_DEFAULT = { blur: 6, dim: 30 };    // = .galaxy-dots bawaan: blur(6px) + tint gelap .3
const DASH_BG_LIMITS = { blur: [0, 30], dim: [0, 80] };

let dashBg = null;               // { url, objectUrl, w, h, saved } gambar aktif; null = foto bawaan
let dashBgPrefs = { ...DASH_BG_DEFAULT };
let dashBgTouched = false;       // pengguna sudah ganti/reset sebelum gambar tersimpan selesai dibaca -> abaikan hasil bacaan
let dashBgBusy = false;

// url("...") yang aman untuk CSS (object URL / data URI / path)
function cssUrl(u) { return 'url("' + String(u).replace(/[\\"]/g, "\\$&").replace(/[\n\r]/g, "") + '")'; }
// background project tanpa cover = background dashboard yang sedang aktif
function dashBgImageCss() { return dashBg ? cssUrl(dashBg.url) : 'url("bg-canyon.jpg")'; }
function dashBgPrefsIsDefault() { return dashBgPrefs.blur === DASH_BG_DEFAULT.blur && dashBgPrefs.dim === DASH_BG_DEFAULT.dim; }

function loadDashBgPrefs() {
  let p = null;
  try { p = JSON.parse(localStorage.getItem(DASH_BG_PREFS_KEY) || "null"); } catch (e) { p = null; }
  const out = { ...DASH_BG_DEFAULT };
  if (p && typeof p === "object") Object.keys(DASH_BG_LIMITS).forEach((k) => {
    const v = Number(p[k]), [lo, hi] = DASH_BG_LIMITS[k];
    if (p[k] != null && Number.isFinite(v)) out[k] = Math.round(Math.min(hi, Math.max(lo, v)));
  });
  return out;
}
function saveDashBgPrefs() {
  try {
    if (dashBgPrefsIsDefault()) localStorage.removeItem(DASH_BG_PREFS_KEY);
    else localStorage.setItem(DASH_BG_PREFS_KEY, JSON.stringify(dashBgPrefs));
  } catch (e) { /* storage diblokir: setelan tetap berlaku selama sesi ini */ }
}
function applyDashBgPrefs() {
  const s = el("dashboardView").style;
  if (dashBgPrefs.blur === DASH_BG_DEFAULT.blur) s.removeProperty("--dash-bg-blur"); else s.setProperty("--dash-bg-blur", dashBgPrefs.blur + "px");
  if (dashBgPrefs.dim === DASH_BG_DEFAULT.dim) s.removeProperty("--dash-bg-dim"); else s.setProperty("--dash-bg-dim", String(dashBgPrefs.dim / 100));
}
function applyDashBg() {
  el("dashBgPhoto").style.backgroundImage = dashBg ? cssUrl(dashBg.url) : "";   // "" = kembali ke bg-canyon.jpg dari CSS
  el("dashboardView").classList.toggle("has-custom-bg", !!dashBg);
  const p = currentProjectId && getProject(currentProjectId);
  if (p && !p.cover) el("projBgPhoto").style.backgroundImage = dashBgImageCss();
  renderDashBgControls();
}
// ganti gambar aktif; object URL lama dilepas sedikit belakangan (transisi background-image project masih memakainya)
function setDashBg(next) {
  const prev = dashBg;
  dashBg = next;
  applyDashBg();
  if (prev && prev.objectUrl && (!next || next.url !== prev.url)) setTimeout(() => URL.revokeObjectURL(prev.url), 1500);
}

function renderDashBgControls() {
  const thumb = el("accBgThumb");
  if (!thumb) return;
  const plain = document.body.classList.contains("light") && !dashBg;   // tema terang bawaan: tanpa foto
  thumb.classList.toggle("is-plain", plain);
  thumb.style.backgroundImage = dashBg ? cssUrl(dashBg.url) : "";
  el("accBgSub").textContent = dashBg
    ? `Gambar sendiri · ${dashBg.w}×${dashBg.h}` + (dashBg.saved ? " · tersimpan di perangkat ini" : " · hanya sesi ini")
    : plain ? "Bawaan — tema terang memakai latar polos" : "Bawaan — foto ngarai bersalju";
  el("accBgReset").classList.toggle("hidden", !dashBg && dashBgPrefsIsDefault());
  [["blur", "accBgBlur", "accBgBlurVal", (v) => v + " px"], ["dim", "accBgDim", "accBgDimVal", (v) => v + "%"]].forEach(([k, id, valId, fmt]) => {
    const input = el(id), v = dashBgPrefs[k], [lo, hi] = DASH_BG_LIMITS[k];
    input.value = String(v);
    input.style.setProperty("--fill", ((v - lo) / (hi - lo)) * 100 + "%");
    input.setAttribute("aria-valuetext", fmt(v));
    input.disabled = plain;
    input.closest(".acc-range-row").classList.toggle("is-off", plain);
    el(valId).textContent = fmt(v);
  });
  el("accBgNote").classList.toggle("hidden", !plain);
}
function setDashBgBusy(on) {
  dashBgBusy = on;
  const pick = el("accBgPick");
  pick.classList.toggle("is-busy", on);
  pick.setAttribute("aria-busy", String(on));
  pick.querySelector("use").setAttribute("href", on ? "#ti-loader-2" : "#ti-photo");
  el("accBgPickLabel").textContent = on ? "Memproses…" : "Ganti background…";
  el("accBgReset").disabled = on;
}

function dashBgDecodes(url) {
  const img = new Image();
  img.src = url;
  return img.decode().then(() => img.naturalWidth > 0, () => false);
}
// File -> Blob kecil: decode, perkecil (sisi terpanjang <= DASH_BG_MAX_SIDE), encode WebP 0.9.
// Browser yang tidak bisa encode WebP (Safari) dapat JPEG di atas latar gelap.
async function prepareDashBgImage(file) {
  let source = null, url = null;
  try {
    if (window.createImageBitmap) { try { source = await createImageBitmap(file); } catch (e) { source = null; } }
    if (!source) {   // mis. SVG / browser lama: lewat <img>
      url = URL.createObjectURL(file);
      const img = new Image();
      img.src = url;
      await img.decode();
      source = img;
    }
    const w0 = source.naturalWidth || source.width, h0 = source.naturalHeight || source.height;
    if (!w0 || !h0) throw new Error("ukuran gambar 0");
    const vector = /svg/i.test(file.type || "") || /\.svg$/i.test(file.name || "");   // SVG boleh diperbesar
    const scale = vector ? 1920 / Math.max(w0, h0) : Math.min(1, DASH_BG_MAX_SIDE / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * scale)), h = Math.max(1, Math.round(h0 * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, 0, 0, w, h);
    const encode = (type, q) => new Promise((resolve) => canvas.toBlob(resolve, type, q));
    let blob = await encode("image/webp", 0.9);
    if (!blob || blob.type !== "image/webp") {
      ctx.globalCompositeOperation = "destination-over";   // JPEG tanpa alpha: isi bagian transparan dengan warna latar
      ctx.fillStyle = "#0a0a0c";
      ctx.fillRect(0, 0, w, h);
      blob = await encode("image/jpeg", 0.9);
    }
    if (!blob || !blob.size) throw new Error("encode gagal");
    return { blob, w, h, at: Date.now() };
  } finally {
    if (source && source.close) source.close();   // ImageBitmap
    if (url) URL.revokeObjectURL(url);
  }
}
function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error || new Error("FileReader gagal"));
    r.readAsDataURL(blob);
  });
}

// ---- simpan / baca di IndexedDB (perangkat ini) ----
async function saveDashBgCustom(rec) {
  try { await loginArtKv("readwrite", (s) => s.put(rec, DASH_BG_KEY)); return true; } catch (e) { /* coba sebagai data URI */ }
  try {   // browser yang menolak Blob di IndexedDB: simpan sebagai data URI
    const src = await blobToDataUrl(rec.blob);
    await loginArtKv("readwrite", (s) => s.put({ src, w: rec.w, h: rec.h, at: rec.at }, DASH_BG_KEY));
    return true;
  } catch (e) { /* lanjut */ }
  // gagal total: jangan sampai gambar LAMA yang tersimpan muncul lagi setelah reload
  try { await loginArtKv("readwrite", (s) => s.delete(DASH_BG_KEY)); } catch (e) { /* abaikan */ }
  return false;
}
async function clearDashBgCustom() {
  try { await loginArtKv("readwrite", (s) => s.delete(DASH_BG_KEY)); } catch (e) { /* abaikan */ }
}
async function loadDashBgCustom() {
  let rec = null;
  try { rec = await loginArtKv("readonly", (s) => s.get(DASH_BG_KEY)); } catch (e) { return null; }
  if (!rec || typeof rec !== "object") return null;
  const size = (v) => (Number.isFinite(v) && v > 0 ? Math.round(v) : "?");
  let bg = null;
  if (rec.blob instanceof Blob && /^image\//.test(rec.blob.type)) bg = { url: URL.createObjectURL(rec.blob), objectUrl: true };
  else if (typeof rec.src === "string" && /^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/]+=*$/i.test(rec.src)) bg = { url: rec.src, objectUrl: false };
  if (!bg) return null;
  Object.assign(bg, { w: size(rec.w), h: size(rec.h), saved: true });
  if (!(await dashBgDecodes(bg.url))) {   // data rusak -> buang supaya background tidak kosong terus
    if (bg.objectUrl) URL.revokeObjectURL(bg.url);
    clearDashBgCustom();
    return null;
  }
  return bg;
}

// ---- ganti / kembalikan ----
function pickDashBg() {
  if (dashBgBusy) return;
  const input = el("accBgInput");
  input.value = "";
  input.click();
}
async function changeDashBg(file) {
  if (dashBgBusy || !file) return;
  // file.type kadang kosong (mis. .webp di sistem lama) -> cek ekstensinya
  const isImage = /^image\//i.test(file.type || "") || (!file.type && /\.(png|jpe?g|webp|gif|bmp|avif|svg)$/i.test(file.name || ""));
  if (!isImage) { toast("File itu bukan gambar — pilih file JPG, PNG atau WebP", tiIcon("alert-triangle")); return; }
  if (file.size > DASH_BG_MAX_BYTES) { toast("Gambar terlalu besar (maks. 20 MB)", tiIcon("alert-triangle")); return; }
  setDashBgBusy(true);
  try {
    let rec = null;
    try { rec = await prepareDashBgImage(file); } catch (e) { console.warn("[background] gambar gagal diproses:", e); }
    const url = rec ? URL.createObjectURL(rec.blob) : null;
    if (!url || !(await dashBgDecodes(url))) {
      if (url) URL.revokeObjectURL(url);
      toast("Gambar tidak bisa dibaca — coba file lain (JPG, PNG atau WebP)", tiIcon("alert-triangle"));
      return;
    }
    dashBgTouched = true;
    setDashBg({ url, objectUrl: true, w: rec.w, h: rec.h, saved: false });
    const saved = await saveDashBgCustom(rec);
    if (dashBg && dashBg.url === url) { dashBg.saved = saved; renderDashBgControls(); }
    if (saved) toast("Background diganti", tiIcon("circle-check"));
    else toast("Background dipakai untuk sesi ini saja — penyimpanan browser diblokir", tiIcon("alert-triangle"));
  } finally {
    setDashBgBusy(false);
  }
}
async function resetDashBg() {
  if (dashBgBusy) return;
  dashBgTouched = true;
  dashBgPrefs = { ...DASH_BG_DEFAULT };
  saveDashBgPrefs();
  applyDashBgPrefs();
  setDashBg(null);
  toast("Background dikembalikan ke bawaan", tiIcon("restore"));
  await clearDashBgCustom();
}

function initDashBg() {
  dashBgPrefs = loadDashBgPrefs();
  applyDashBgPrefs();
  renderDashBgControls();
  // gambar tersimpan dibaca sedini mungkin (login butuh klik + popup Google, jadi biasanya sudah siap sebelum dashboard tampil)
  loadDashBgCustom().then((bg) => {
    if (!bg) return;
    if (dashBgTouched) { if (bg.objectUrl) URL.revokeObjectURL(bg.url); return; }
    setDashBg(bg);
  }, () => {});

  el("accBgPick").onclick = pickDashBg;
  el("accBgThumb").onclick = pickDashBg;
  el("accBgReset").onclick = () => { el("accBgPick").focus(); resetDashBg(); };   // tombolnya hilang setelah reset -> fokus pindah
  el("accBgInput").addEventListener("change", (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ""; if (f) changeDashBg(f); });
  [["blur", "accBgBlur"], ["dim", "accBgDim"]].forEach(([k, id]) => {
    const input = el(id);
    input.addEventListener("input", () => { dashBgPrefs[k] = Number(input.value); applyDashBgPrefs(); renderDashBgControls(); });   // pratinjau langsung
    input.addEventListener("change", saveDashBgPrefs);
  });
  // tema berubah: thumbnail & slider ikut (tema terang bawaan tidak memakai foto)
  let lastLight = document.body.classList.contains("light");
  new MutationObserver(() => {
    const light = document.body.classList.contains("light");
    if (light !== lastLight) { lastLight = light; renderDashBgControls(); }
  }).observe(document.body, { attributes: true, attributeFilter: ["class"] });

  // seret-lepas gambar ke baris Background; file yang dilepas di tempat lain di halaman akun diabaikan
  // (jangan sampai browser membuka file itu & meninggalkan aplikasi). Counter karena dragenter/leave ikut anak elemen.
  const view = el("accountView"), row = el("accBgRow");
  const hasFiles = (e) => !!e.dataTransfer && [...(e.dataTransfer.types || [])].includes("Files");
  let depth = 0;
  const endDrag = () => { depth = 0; view.classList.remove("is-file-drag"); row.classList.remove("is-drop"); };
  view.addEventListener("dragenter", (e) => { if (!hasFiles(e)) return; e.preventDefault(); depth++; view.classList.add("is-file-drag"); });
  view.addEventListener("dragleave", (e) => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) endDrag(); });
  view.addEventListener("dragover", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    const inRow = row.contains(e.target);
    row.classList.toggle("is-drop", inRow);
    e.dataTransfer.dropEffect = inRow ? "copy" : "none";
  });
  view.addEventListener("drop", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    const inRow = row.contains(e.target);
    endDrag();
    const f = inRow && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) changeDashBg(f);
  });
}

// ================= LOGIN ART (kolom kiri halaman login) =================
// HalftoneReveal dari React Bits (sudah di-port ke JS biasa: halftone-reveal.js).
// Gambar = ilustrasi karakter dengan background transparan (dibuang dari JPG asli). Dimuat dari login-art-data.js (data URI,
// berfungsi bahkan saat halaman dibuka dari file://); kalau file itu tidak ada, dipakai login-art.webp (butuh http/https).
// transparent: true + gambar ber-alpha -> dot halftone hanya menutupi karakternya, dot-grid #loginView tetap terlihat di sekelilingnya.
// Pengguna bisa mengganti gambarnya sendiri (tombol kiri-bawah #btnLoginArt) — lihat "Gambar pilihan pengguna" di bawah.
const LOGIN_ART_OPTIONS = {
  src: window.LOGIN_ART_DATA || "login-art.webp",
  transparent: true,
  fit: "contain",          // seluruh karakter terlihat, tidak terpotong
  mode: "mono",
  shape: "dot",
  cellSize: 6,
  angle: 45,
  inkColor: "#f4f1ea",
  paperColor: "#120f17",   // titik hitam untuk pemetaan terang-gelap dot (bukan lagi warna background kolom)
  revealRadius: 160,
  contrast: 1.5,           // karakternya serba terang -> contrast naik & brightness turun supaya wajah/rambut tidak menggumpal jadi putih
  brightness: -0.22        // kembalikan ke default (contrast 1.1, brightness 0) kalau mau lebih terang
};

// ---- Gambar pilihan pengguna (tombol kiri-bawah / seret-lepas ke kolom kiri) ----
// Disimpan HANYA di perangkat ini (halaman login tampil sebelum login, jadi bukan di Drive): IndexedDB "novelist"/"kv",
// localStorage sebagai cadangan bila datanya kecil. Disimpan sebagai data URI karena WebGL tidak boleh membaca file lokal
// di file:// (lihat login-art-data.js) — data URI selalu boleh.
const LOGIN_ART_CUSTOM_KEY = "loginArtCustom";          // key di IndexedDB novelist/kv
const LOGIN_ART_CUSTOM_LS_KEY = "novelist_login_art";   // cadangan localStorage
const LOGIN_ART_MAX_BYTES = 20 * 1024 * 1024;           // batas ukuran file masukan
const LOGIN_ART_MAX_SIDE = 1600;                        // sisi terpanjang setelah diperkecil (cukup tajam untuk kolom kiri)
const LOGIN_ART_LS_MAX_CHARS = 1500000;                 // localStorage cuma ~5 MB per situs -> hanya gambar kecil
// Gambar pengguna biasanya foto biasa: tone netral (default React Bits) cocok untuk foto apa pun, termasuk PNG ber-alpha.
// Setelan contrast 1.5 / brightness -0.22 di atas khusus untuk karakter bawaan yang serba terang.
const LOGIN_ART_CUSTOM_TONE = { contrast: 1.1, brightness: 0 };

let loginArt = null;          // instance HalftoneReveal yang aktif (null = belum dibuat / layar sempit)
let loginArtCustom = null;    // { src, alpha, w, h, at } gambar pilihan pengguna; null = karakter bawaan
let loginArtTouched = false;  // pengguna sudah ganti/reset sebelum gambar tersimpan selesai dibaca -> abaikan hasil bacaan
let loginArtBusy = false;

function loginArtOptions() {
  if (!loginArtCustom) return LOGIN_ART_OPTIONS;
  return Object.assign({}, LOGIN_ART_OPTIONS, LOGIN_ART_CUSTOM_TONE, { src: loginArtCustom.src });
}
// Browser tanpa WebGL2 (atau hardware acceleration mati): gambarnya ditampilkan apa adanya supaya kolom kiri tidak kosong.
function loginArtFallbackBg(src) { return 'center / contain no-repeat url("' + src + '")'; }

// Terapkan gambar aktif ke HalftoneReveal yang sedang jalan. update() sanggup mengganti src + tone tanpa bikin ulang konteks WebGL.
function applyLoginArt() {
  const host = el("loginArt");
  if (!host || !loginArt) return;   // belum dibuat -> sync() di initLoginArt memakai loginArtOptions() saat membuatnya
  const opts = loginArtOptions();
  if (loginArt.supported) loginArt.update(opts);
  else host.style.background = loginArtFallbackBg(opts.src);
}

// IndexedDB kecil key-value ("novelist" / store "kv"). Bisa gagal (mode privat, storage diblokir) -> pemanggil wajib siap.
function loginArtKv(mode, run) {
  return new Promise((resolve, reject) => {
    let req;
    try { req = window.indexedDB.open("novelist"); } catch (e) { reject(e); return; }   // tanpa nomor versi: tetap jalan kalau fitur lain menaikkan versinya
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains("kv")) req.result.createObjectStore("kv"); };
    req.onerror = () => reject(req.error || new Error("IndexedDB gagal dibuka"));
    req.onblocked = () => reject(new Error("IndexedDB terblokir"));
    req.onsuccess = () => {
      const db = req.result;
      try {
        const tx = db.transaction("kv", mode);
        const r = run(tx.objectStore("kv"));
        tx.oncomplete = () => { db.close(); resolve(r ? r.result : undefined); };
        tx.onerror = tx.onabort = () => { db.close(); reject(tx.error || new Error("IndexedDB gagal")); };
      } catch (e) { db.close(); reject(e); }
    };
  });
}

// hanya data URI gambar base64 (aman ditempel ke url("...") CSS fallback)
function isLoginArtRecord(rec) {
  return !!rec && typeof rec.src === "string" && /^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/]+=*$/i.test(rec.src);
}
function loginArtDecodes(src) {
  const img = new Image();
  img.src = src;
  return img.decode().then(() => img.naturalWidth > 0, () => false);
}

async function loadLoginArtCustom() {
  let rec = null;
  try { rec = await loginArtKv("readonly", (s) => s.get(LOGIN_ART_CUSTOM_KEY)); } catch (e) { rec = null; }
  if (!isLoginArtRecord(rec)) {
    rec = null;
    try { const raw = localStorage.getItem(LOGIN_ART_CUSTOM_LS_KEY); if (raw) rec = JSON.parse(raw); } catch (e) { rec = null; }
  }
  if (!isLoginArtRecord(rec)) return null;
  // data rusak -> buang supaya kolom kiri tidak kosong terus
  if (!(await loginArtDecodes(rec.src))) { clearLoginArtCustom(); return null; }
  return rec;
}
async function saveLoginArtCustom(rec) {
  let ok = false;
  try { await loginArtKv("readwrite", (s) => s.put(rec, LOGIN_ART_CUSTOM_KEY)); ok = true; } catch (e) { /* lanjut ke localStorage */ }
  try {
    if (ok || rec.src.length > LOGIN_ART_LS_MAX_CHARS) localStorage.removeItem(LOGIN_ART_CUSTOM_LS_KEY);
    else { localStorage.setItem(LOGIN_ART_CUSTOM_LS_KEY, JSON.stringify(rec)); ok = true; }
  } catch (e) { /* penuh / diblokir */ }
  // gagal total: jangan sampai gambar LAMA yang tersimpan muncul lagi setelah reload
  if (!ok) try { await loginArtKv("readwrite", (s) => s.delete(LOGIN_ART_CUSTOM_KEY)); } catch (e) { /* abaikan */ }
  return ok;
}
async function clearLoginArtCustom() {
  try { await loginArtKv("readwrite", (s) => s.delete(LOGIN_ART_CUSTOM_KEY)); } catch (e) { /* abaikan */ }
  try { localStorage.removeItem(LOGIN_ART_CUSTOM_LS_KEY); } catch (e) { /* abaikan */ }
}

// File -> data URI kecil: decode, perkecil (sisi terpanjang <= LOGIN_ART_MAX_SIDE), encode WebP (alpha tetap ada di Chromium).
// Browser yang tidak bisa encode WebP (Safari) otomatis dapat PNG (bila ada alpha) atau JPEG (foto biasa, lebih kecil).
async function prepareLoginArtImage(file) {
  let source = null, url = null;
  try {
    if (window.createImageBitmap) { try { source = await createImageBitmap(file); } catch (e) { source = null; } }
    if (!source) {   // mis. SVG / browser lama: lewat <img>
      url = URL.createObjectURL(file);
      const img = new Image();
      img.src = url;
      await img.decode();
      source = img;
    }
    const w0 = source.naturalWidth || source.width, h0 = source.naturalHeight || source.height;
    if (!w0 || !h0) throw new Error("ukuran gambar 0");
    const scale = Math.min(1, LOGIN_ART_MAX_SIDE / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * scale)), h = Math.max(1, Math.round(h0 * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, 0, 0, w, h);
    const px = ctx.getImageData(0, 0, w, h).data;
    let alpha = false;
    for (let i = 3; i < px.length; i += 4) if (px[i] < 250) { alpha = true; break; }
    let src = canvas.toDataURL("image/webp", 0.92);
    if (!src.startsWith("data:image/webp")) src = alpha ? canvas.toDataURL("image/png") : canvas.toDataURL("image/jpeg", 0.9);
    return { src, alpha, w, h, at: Date.now() };
  } finally {
    if (source && source.close) source.close();   // ImageBitmap
    if (url) URL.revokeObjectURL(url);
  }
}

function syncLoginArtMenu() {
  const reset = el("btnLoginArtReset");
  if (reset) reset.classList.toggle("hidden", !loginArtCustom);
}

// Ganti gambar halftone dengan file pilihan pengguna (dari tombol unggah atau seret-lepas).
async function changeLoginArt(file) {
  if (loginArtBusy || !file) return;
  // file.type kadang kosong (mis. .webp di sistem lama) -> cek ekstensinya
  const isImage = /^image\//i.test(file.type || "") || (!file.type && /\.(png|jpe?g|webp|gif|bmp|avif|svg)$/i.test(file.name || ""));
  if (!isImage) { showLoginNotice(lt("artNotImage")); return; }
  if (file.size > LOGIN_ART_MAX_BYTES) { showLoginNotice(lt("artTooBig")); return; }
  const ctl = el("loginArtCtl");
  loginArtBusy = true;
  ctl.classList.add("is-busy");
  try {
    let rec = null;
    try { rec = await prepareLoginArtImage(file); } catch (e) { rec = null; console.warn("[login art] gambar gagal diproses:", e); }
    if (!rec || !isLoginArtRecord(rec) || !(await loginArtDecodes(rec.src))) { showLoginNotice(lt("artFailed")); return; }
    loginArtTouched = true;
    loginArtCustom = rec;
    applyLoginArt();
    syncLoginArtMenu();
    showLoginNotice(lt((await saveLoginArtCustom(rec)) ? "artChanged" : "artChangedTemp"));
  } finally {
    loginArtBusy = false;
    ctl.classList.remove("is-busy");
  }
}

async function resetLoginArt() {
  loginArtTouched = true;
  loginArtCustom = null;
  applyLoginArt();
  syncLoginArtMenu();
  showLoginNotice(lt("artRestored"));
  await clearLoginArtCustom();
}

// Tombol kiri-bawah + menu kecil (unggah / kembalikan bawaan) + seret-lepas file gambar ke kolom kiri.
function initLoginArtPicker() {
  const ctl = el("loginArtCtl"), btn = el("btnLoginArt"), menu = el("loginArtMenu"), input = el("loginArtInput"), host = el("loginArt");
  if (!ctl || !btn || !menu || !input || !host) return;
  const items = () => [...menu.querySelectorAll("button")].filter((b) => !b.classList.contains("hidden"));
  const setOpen = (open) => { menu.classList.toggle("hidden", !open); btn.setAttribute("aria-expanded", String(open)); };
  btn.onclick = (e) => {
    const open = menu.classList.contains("hidden");
    setOpen(open);
    if (open && e.detail === 0) items()[0].focus();   // dibuka lewat keyboard -> fokus ke item pertama
  };
  el("btnLoginArtUpload").onclick = () => { setOpen(false); input.value = ""; input.click(); };
  el("btnLoginArtReset").onclick = () => { setOpen(false); btn.focus(); resetLoginArt(); };
  input.onchange = () => { const f = input.files && input.files[0]; input.value = ""; if (f) changeLoginArt(f); };
  document.addEventListener("pointerdown", (e) => { if (!ctl.contains(e.target)) setOpen(false); });
  ctl.addEventListener("keydown", (e) => {
    if (menu.classList.contains("hidden")) return;
    if (e.key === "Escape") { e.preventDefault(); setOpen(false); btn.focus(); return; }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const list = items(), i = list.indexOf(document.activeElement);
    list[(i + (e.key === "ArrowDown" ? 1 : list.length - 1)) % list.length].focus();
  });

  // seret-lepas: sorotan .is-drop selama file diseret di atas kolom kiri (counter karena dragenter/leave ikut anak elemen)
  const hasFiles = (e) => !!e.dataTransfer && [...(e.dataTransfer.types || [])].includes("Files");
  let depth = 0;
  host.addEventListener("dragenter", (e) => { if (!hasFiles(e)) return; e.preventDefault(); depth++; host.classList.add("is-drop"); });
  host.addEventListener("dragover", (e) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = "copy"; });
  host.addEventListener("dragleave", (e) => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) host.classList.remove("is-drop"); });
  host.addEventListener("drop", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0; host.classList.remove("is-drop");
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) changeLoginArt(f);
  });
  // file yang dilepas di luar kolom kiri: jangan sampai browser membuka file itu & meninggalkan halaman login
  const login = el("loginView");
  login.addEventListener("dragover", (e) => { if (hasFiles(e) && !host.contains(e.target)) { e.preventDefault(); e.dataTransfer.dropEffect = "none"; } });
  login.addEventListener("drop", (e) => { if (hasFiles(e) && !host.contains(e.target)) e.preventDefault(); });
}

async function initLoginArt() {
  const host = el("loginArt");
  if (!host || !window.HalftoneReveal) { const ctl = el("loginArtCtl"); if (ctl) ctl.hidden = true; return; }
  initLoginArtPicker();
  // Baca gambar tersimpan dulu (maks ~700 ms) supaya karakter bawaan tidak sempat berkedip sebelum diganti.
  // Kalau lebih lambat dari itu, art dibuat dengan gambar bawaan lalu diganti begitu gambar tersimpan siap.
  let started = false;
  const saved = loadLoginArtCustom().then((rec) => {
    if (!rec || loginArtTouched) return;
    loginArtCustom = rec;
    syncLoginArtMenu();
    if (started) applyLoginArt();
  }, () => {});
  await Promise.race([saved, new Promise((r) => setTimeout(r, 700))]);
  started = true;
  // Hanya jalan saat kolom kiri terlihat (>900px) — di HP kolomnya disembunyikan, jadi WebGL tidak dibuat sama sekali.
  const wide = window.matchMedia("(min-width: 901px)");
  const sync = () => {
    if (wide.matches && !loginArt) {
      const opts = loginArtOptions();
      loginArt = window.HalftoneReveal.create(host, opts);
      if (!loginArt.supported) host.style.background = loginArtFallbackBg(opts.src);
    } else if (!wide.matches && loginArt) {
      loginArt.destroy(); loginArt = null; host.style.background = "";
    }
  };
  sync();
  wide.addEventListener("change", sync);
}

// ================= LOGO ANIMASI (rail dashboard) =================
// Dua mode: IDLE = video diputar sangat pelan (+ "napas" CSS) supaya tidak kaku; AKTIF = saat kursor mendekat, kecepatan
// naik ke normal dan logo sedikit membesar/bersinar. Perpindahannya di-lerp tiap frame jadi transisinya halus.
// Video hanya diputar saat terlihat (dashboard tampil & tab aktif) supaya tidak boros baterai; dihentikan bila pengguna
// memilih "reduce motion" (yang tampil cuma frame pertama / poster).
const LOGO_IDLE_RATE = 0.3;      // kecepatan video saat idle
const LOGO_ACTIVE_RATE = 1;      // kecepatan video saat kursor dekat
const LOGO_NEAR_RADIUS = 170;    // px dari pusat logo: mulai "terbangun"
const LOGO_FULL_RADIUS = 50;     // px dari pusat logo: mode aktif penuh
function initRailLogo() {
  const v = el("railLogoVideo");
  if (!v) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const box = v.parentElement;
  let inView = false, energy = 0, target = 0, raf = 0;
  const sync = () => { if (inView && !document.hidden) v.play().catch(() => {}); else v.pause(); };
  const apply = () => {
    box.style.setProperty("--logo-energy", energy.toFixed(3));
    v.playbackRate = LOGO_IDLE_RATE + (LOGO_ACTIVE_RATE - LOGO_IDLE_RATE) * energy;
  };
  const tick = () => {
    energy += (target - energy) * (target > energy ? 0.12 : 0.04);   // bangun agak cepat, kembali idle perlahan
    if (Math.abs(target - energy) < 0.002) { energy = target; raf = 0; } else raf = requestAnimationFrame(tick);
    apply();
  };
  const setTarget = (t) => { target = t; if (!raf) raf = requestAnimationFrame(tick); };
  document.addEventListener("pointermove", (e) => {
    if (!inView || e.pointerType === "touch") return;
    const r = box.getBoundingClientRect();
    const d = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
    const t = Math.min(1, Math.max(0, (LOGO_NEAR_RADIUS - d) / (LOGO_NEAR_RADIUS - LOGO_FULL_RADIUS)));
    setTarget(t * t * (3 - 2 * t));   // smoothstep
  }, { passive: true });
  document.documentElement.addEventListener("mouseleave", () => setTarget(0));
  v.addEventListener("loadedmetadata", apply);
  apply();
  new IntersectionObserver((entries) => { inView = entries.some((e) => e.isIntersecting); if (!inView) setTarget(0); sync(); }).observe(v);
  document.addEventListener("visibilitychange", sync);
}

// ================= RAIL SIDEBAR (rail kiri dashboard bisa dibuka/ditutup) =================
// Layar lebar (>700px): klik logo kiri atas = buka/tutup rail. Saat tertutup, kursor yang diam sebentar di tepi kiri layar
// membukanya otomatis. Sekali terbuka, rail TETAP terbuka (tidak menutup sendiri saat kursor pergi, Esc juga tidak)
// sampai logo diklik lagi. Status diingat di perangkat ini; pengguna baru mulai dengan rail tertutup + petunjuk kecil.
// HP (<=700px): rail = bar bawah yang selalu tampil; logo kembali jadi hiasan saja.
const RAIL_OPEN_KEY = "novelist_rail_open";
const RAIL_HINT_KEY = "novelist_rail_hint_seen";
const RAIL_EDGE_PX = 10;            // lebar zona tepi kiri
const RAIL_EDGE_DWELL_MS = 120;     // kursor harus bertahan di zona tepi selama ini (hindari terbuka tanpa sengaja)
const RAIL_HINT_DELAY_MS = 900;     // petunjuk muncul sebentar setelah dashboard tampil...
const RAIL_HINT_SHOW_MS = 9000;     // ...lalu memudar sendiri (tampil lagi di kunjungan berikutnya sampai rail pernah dibuka)
const railMobileMq = window.matchMedia("(max-width: 700px)");
let railOpen = false, railHintDone = false, railHintTimer = 0, railEdgeTimer = 0;

function railIsMobile() { return railMobileMq.matches; }
function railDashVisible() { return !el("dashboardView").classList.contains("hidden"); }
function setRailOpen(open, { save = true } = {}) {
  railOpen = !!open;
  el("dashboardView").classList.toggle("rail-closed", !railOpen);
  syncRailLogo();
  if (save) { try { localStorage.setItem(RAIL_OPEN_KEY, railOpen ? "1" : "0"); } catch (e) { /* abaikan */ } }
  if (railOpen) { markRailHintSeen(); return; }
  cancelRailEdge();
  // tutup: menu gear ikut ditutup; fokus yang masih di dalam rail dipindah ke logo (rail jadi visibility:hidden)
  if (!el("settingsMenu").classList.contains("hidden")) closeAllDropdowns();
  if (el("dashRail").contains(document.activeElement)) el("btnRailLogo").focus({ preventScroll: true });
}
function syncRailLogo() {
  const btn = el("btnRailLogo");
  if (railIsMobile()) {   // bar bawah HP: tidak ada yang dibuka/ditutup
    btn.setAttribute("tabindex", "-1");
    btn.setAttribute("aria-hidden", "true");
    btn.removeAttribute("aria-expanded");
    hideRailHint();
    return;
  }
  const label = railOpen ? "Tutup sidebar" : "Buka sidebar";
  btn.removeAttribute("tabindex");
  btn.removeAttribute("aria-hidden");
  btn.setAttribute("aria-label", label);
  btn.setAttribute("aria-expanded", String(railOpen));
  el("railLogoTip").textContent = label;
}

// ---- petunjuk sekali tampil di samping logo ----
function railHintSeen() {
  if (railHintDone) return true;
  try { return localStorage.getItem(RAIL_HINT_KEY) === "1"; } catch (e) { return false; }
}
function hideRailHint() { clearTimeout(railHintTimer); el("railHint").classList.remove("is-on"); }
function markRailHintSeen() {
  hideRailHint();
  if (railHintDone) return;
  railHintDone = true;
  try { localStorage.setItem(RAIL_HINT_KEY, "1"); } catch (e) { /* abaikan */ }
}
function maybeShowRailHint() {
  hideRailHint();
  if (railOpen || railIsMobile() || railHintSeen()) return;
  railHintTimer = setTimeout(() => {
    if (railOpen || railIsMobile() || !railDashVisible()) return;
    el("railHint").classList.add("is-on");
    railHintTimer = setTimeout(hideRailHint, RAIL_HINT_SHOW_MS);
  }, RAIL_HINT_DELAY_MS);
}

// ---- buka otomatis saat kursor bertahan di tepi kiri (mouse/pen saja; tidak saat tombol ditekan / menyeret) ----
function cancelRailEdge() { clearTimeout(railEdgeTimer); railEdgeTimer = 0; }
function railEdgeAllowed() {
  return !railOpen && !railIsMobile() && railDashVisible() && !document.querySelector(".modal:not(.hidden)");
}
function onRailEdgePointer(e) {
  if (e.clientX > RAIL_EDGE_PX || e.pointerType === "touch" || e.buttons || !railEdgeAllowed()) { cancelRailEdge(); return; }
  if (railEdgeTimer) return;   // sudah menunggu: bergerak di dalam zona tepi tidak mengulang hitungan
  railEdgeTimer = setTimeout(() => { railEdgeTimer = 0; if (railEdgeAllowed()) setRailOpen(true); }, RAIL_EDGE_DWELL_MS);
}

function initRailSidebar() {
  let saved = null;
  try { saved = localStorage.getItem(RAIL_OPEN_KEY); } catch (e) { /* abaikan */ }
  setRailOpen(saved === "1", { save: false });   // default pengguna baru: tertutup
  el("btnRailLogo").addEventListener("click", () => { if (!railIsMobile()) setRailOpen(!railOpen); });
  el("railHint").addEventListener("click", () => setRailOpen(true));
  document.addEventListener("pointermove", onRailEdgePointer, { passive: true });
  document.addEventListener("pointerdown", cancelRailEdge, true);
  document.documentElement.addEventListener("mouseleave", cancelRailEdge);
  window.addEventListener("blur", cancelRailEdge);
  railMobileMq.addEventListener("change", () => { syncRailLogo(); if (!railIsMobile()) maybeShowRailHint(); });
  // petunjuk hanya saat dashboard benar-benar tampil (setelah login / kembali dari project)
  new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) maybeShowRailHint(); else hideRailHint();
  }).observe(el("btnRailLogo"));
}

// ================= BANNER APLIKASI (versi baru tersedia, project hanya-baca, dll.) =================
// showAppBanner({ id, text, icon, action, onAction, danger }) — satu banner per id, tombol × menutup.
function showAppBanner(o) {
  let b = document.getElementById("appBanner-" + o.id);
  if (!b) {
    b = document.createElement("div");
    b.id = "appBanner-" + o.id;
    b.className = "app-banner";
    b.setAttribute("role", "status");
    document.body.appendChild(b);
  }
  b.classList.toggle("is-danger", !!o.danger);
  b.innerHTML = `${o.icon ? tiPx(o.icon, 16) : ""}<span class="app-banner-text"></span>` +
    (o.action ? '<button type="button" class="app-banner-btn"></button>' : "") +
    `<button type="button" class="app-banner-x" aria-label="Tutup">${tiPx(tiIcon("x"), 14)}</button>`;
  b.querySelector(".app-banner-text").textContent = o.text;
  if (o.action) { const btn = b.querySelector(".app-banner-btn"); btn.textContent = o.action; btn.onclick = () => o.onAction && o.onAction(btn); }
  b.querySelector(".app-banner-x").onclick = () => b.remove();
  return b;
}
function hideAppBanner(id) { const b = document.getElementById("appBanner-" + id); if (b) b.remove(); }

// ================= VERSI BARU DI SERVER =================
// Tab yang dibiarkan terbuka berjam-jam tetap menjalankan kode lama (yang ikut menyimpan project). Tiap 10 menit & saat
// tab kembali dibuka, app.js + novelist-sync.js di server dicek (ETag / Last-Modified). Berubah -> ajakan muat ulang.
// Server tanpa penanda versi (mis. aset aplikasi Android) -> pengecekan dimatikan.
const UPDATE_CHECK_MS = 10 * 60000;
const updateCheck = { base: null, last: 0, off: false, shown: false };
async function fetchDeployStamp() {
  const parts = [];
  for (const f of ["app.js", "novelist-sync.js"]) {
    const r = await fetch(f, { method: "HEAD", cache: "no-store" });
    const v = r.ok ? r.headers.get("etag") || r.headers.get("last-modified") : null;
    if (!v) return null;
    parts.push(v);
  }
  return parts.join("|");
}
async function checkForAppUpdate(force) {
  if (updateCheck.off || updateCheck.shown || !/^https?:$/.test(location.protocol)) return;
  if (!force && Date.now() - updateCheck.last < 60000) return;
  updateCheck.last = Date.now();
  let stamp = null;
  try { stamp = await fetchDeployStamp(); } catch (e) { return; }   // offline: coba lagi nanti
  if (!stamp) { updateCheck.off = true; return; }
  if (updateCheck.base === null) { updateCheck.base = stamp; return; }
  if (stamp === updateCheck.base) return;
  updateCheck.shown = true;
  showAppBanner({
    id: "update", icon: tiIcon("refresh"), action: "Muat ulang",
    text: "Versi baru Novelist tersedia. Muat ulang halaman supaya tulisanmu disimpan dengan versi terbaru.",
    onAction: async (btn) => {
      btn.disabled = true; btn.textContent = "Menyimpan…";
      flushBeforeLeave();
      try { await Promise.race([doAutosaveFlush(), new Promise((r) => setTimeout(r, 5000))]); } catch (e) { /* tetap ada salinan di perangkat */ }
      location.reload();
    },
  });
}
function initUpdateCheck() {
  checkForAppUpdate(true);
  setInterval(() => { if (!document.hidden) checkForAppUpdate(); }, UPDATE_CHECK_MS);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) checkForAppUpdate(); });
}

// ================= EVENT BINDING =================
window.addEventListener("DOMContentLoaded", () => {
  initUpdateCheck();
  // novelist-sync.js (simpan di perangkat + sinkron) gagal dimuat -> jalur cadangan: hanya Drive, beri tahu pengguna
  if (!window.NovelistSync) {
    showAppBanner({ id: "nosync", danger: true, icon: tiIcon("alert-triangle"), action: "Muat ulang", onAction: () => location.reload(),
      text: "Penyimpanan di perangkat tidak aktif (novelist-sync.js gagal dimuat) — tulisan hanya tersimpan ke Google Drive. Muat ulang halaman." });
  }
  initLoginArt();
  initLoginFooter();
  initRailLogo();
  initRailSidebar();   // rail kiri dashboard: buka/tutup lewat logo & tepi kiri layar
  pickDashTitle();
  el("btnLoginGoogle").onclick = handleLogin;
  document.querySelectorAll("#loginView .btn-oauth.is-soon").forEach((b) => b.onclick = () => handleSoonProvider(b.dataset.provider));
  showLastLoginHint();

  el("btnAddProject").onclick = openAddProjectModal;
  el("emptyStateBtn").onclick = openAddProjectModal;
  el("emptyStateLink").onclick = (e) => { e.preventDefault(); openAddProjectModal(); };
  el("btnCancelProject").onclick = () => el("projectModal").classList.add("hidden");
  el("btnSaveProject").onclick = saveProjectModal;

  document.querySelectorAll("#cardMenu button").forEach((btn) => btn.onclick = () => handleCardMenuAction(btn.dataset.action));

  el("btnSettings").onclick = (e) => {
    e.stopPropagation();
    const btn = e.currentTarget;
    const menu = el("settingsMenu");
    const willOpen = menu.classList.contains("hidden");
    closeAllDropdowns();
    if (!willOpen) return;
    // menu muncul tepat di atas tombol gear, rata kiri dengan rail (ala vvd); di bar bawah HP juga di atas tombol
    const rect = btn.getBoundingClientRect();
    menu.style.top = "auto"; menu.style.right = "auto";
    menu.style.bottom = (window.innerHeight - rect.top + 8) + "px";
    menu.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - 222)) + "px";
    menu.classList.remove("hidden");
    btn.setAttribute("aria-expanded", "true");
  };
  document.addEventListener("click", closeAllDropdowns);
  el("menuThemeToggle").onclick = () => document.body.classList.toggle("light");
  el("menuCloudLibrary").onclick = openCloudLibrary;
  el("menuDriveLogout").onclick = () => { if (confirm("Logout dari Google?")) driveSignOut(); };
  initAccount();   // rail Project/Akun, menu Pengaturan Akun & Bantuan, halaman akun + modalnya
  initDashBg();    // background dashboard pilihan sendiri (Pengaturan Akun → Tampilan), dibaca dari IndexedDB sedini mungkin

  // ---- Ikon aksi di rail kiri dashboard (tombol tema dihapus: sudah ada di Pengaturan Akun → Tema tampilan) ----
  el("btnQuickCloud").addEventListener("click", openCloudLibrary);
  el("btnQuickLogout").addEventListener("click", () => { if (confirm("Logout dari Google?")) driveSignOut(); });
  el("btnSupport").addEventListener("click", () => el("supportModal").classList.remove("hidden"));
  el("btnCloseSupport").onclick = () => el("supportModal").classList.add("hidden");

  // ---- Cloud Library (manual send/receive, terpisah dari autosave) ----
  el("btnCloudBack").onclick = closeCloudLibrary;
  el("btnCloudMenu").onclick = (e) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const menu = el("cloudMenu");
    menu.style.top = rect.bottom + 6 + "px"; menu.style.right = (window.innerWidth - rect.right) + "px"; menu.style.left = "auto";
    menu.classList.remove("hidden");
  };
  el("menuCloudRefresh").onclick = () => {
    closeAllDropdowns();
    let activeTab = "send";
    if (el("tabReceiveFromCloud").classList.contains("active")) activeTab = "receive";
    else if (el("tabTrash").classList.contains("active")) activeTab = "trash";
    switchCloudTab(activeTab);
  };
  el("tabSendToCloud").onclick = () => switchCloudTab("send");
  el("tabReceiveFromCloud").onclick = () => switchCloudTab("receive");
  el("tabTrash").onclick = () => switchCloudTab("trash");

  // ---- project view ----
  el("btnBack").onclick = backToLibrary;
  el("btnProjSidebar").onclick = () => (el("projSidebar").classList.contains("is-open") ? closeProjSidebar() : openProjSidebar());
  el("btnProjSidebarClose").onclick = closeProjSidebar;
  el("projSidebarScrim").onclick = closeProjSidebar;
  el("btnSideTheme").onclick = () => document.body.classList.toggle("light");
  el("btnSideSave").onclick = async () => { closeProjSidebar(); await saveCurrentProject(); toast("Tersimpan ke Drive", tiIcon("cloud-check")); };
  el("projectTitle").addEventListener("input", () => { fitProjectTitle(); markDirtyAndSchedule(); });
  el("btnPreview").onclick = openPreview;
  el("btnClosePreview").onclick = () => el("previewModal").classList.add("hidden");

  el("btnProjectMenu").onclick = (e) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const menu = el("projectMenu");
    menu.style.top = rect.bottom + 6 + "px"; menu.style.left = Math.max(8, rect.right - 210) + "px"; menu.style.right = "auto";
    menu.classList.remove("hidden");
  };
  document.querySelectorAll("#projectMenu button").forEach((btn) => btn.onclick = async () => {
    closeAllDropdowns();
    const p = getProject(currentProjectId);
    const action = btn.dataset.action;
    if (action === "sendCloud") { flushCurrentEdits(); await saveProjectToDriveMain(p); toast("Tersimpan ke Drive", tiIcon("cloud-check")); }
    if (action === "backupNow") { flushCurrentEdits(); await backupProjectNow(p); }
    if (action === "history") openBackupHistory();
    if (action === "exportWord") { flushCurrentEdits(); exportProjectToWord(p); }
  });

  initProjectTabs();   // TAB PROJECT: bar tab, jendela "Tambah tab", sidebar tab & riwayat
  // Quill: tombol "Scene | Quill" di atas tab Write (panah kiri/kanan berpindah antar-tombol)
  el("writeModeSwitch").querySelectorAll(".wms-btn").forEach((btn) => {
    btn.onclick = () => setWriteMode(btn.dataset.mode);
    btn.onkeydown = (e) => { if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); const m = btn.dataset.mode === "scene" ? "quill" : "scene"; setWriteMode(m); el("writeModeSwitch").querySelector(`[data-mode="${m}"]`).focus(); } };
  });
  el("btnProjectTheme").onclick = () => document.body.classList.toggle("light");

  // Write tab (mode Scene): daftar, halaman, bar bawah, toolbar mengambang, mode fokus — lihat initTwUi()
  initTwUi();
  el("btnCancelScene").onclick = () => el("sceneModal").classList.add("hidden");
  el("btnSaveScene").onclick = saveNewScene;
  document.querySelectorAll(".type-toggle-btn").forEach((btn) => btn.onclick = () => {
    pendingSceneType = btn.dataset.type;
    document.querySelectorAll(".type-toggle-btn").forEach((b) => b.classList.toggle("active", b === btn));
    const isFolder = pendingSceneType === "folder";
    el("sceneSynopsisLabel").classList.toggle("hidden", isFolder);
    el("sceneFieldSynopsis").classList.toggle("hidden", isFolder);
  });
  document.querySelectorAll("#sceneMenu button").forEach((btn) => btn.onclick = () => {
    const id = el("sceneMenu").dataset.sceneId;
    closeAllDropdowns();
    if (btn.dataset.action === "duplicate") duplicateScene(id);
    if (btn.dataset.action === "delete") deleteSceneNode(id);
  });

  // Scene options drawer (obsidian-style writer: nama, synopsis, status & format dipindah ke sini)
  el("sceneDrawerToggle").onclick = toggleSceneDrawer;
  el("sceneDrawerClose").onclick = closeSceneDrawer;
  el("sceneDrawerScrim").onclick = closeSceneDrawer;
  setupSceneDrawerDrag();
  el("btnExitFocus").onclick = closeFocusMode;
  document.querySelectorAll(".focus-toolbar button[data-cmd]").forEach((btn) => {
    btn.onmousedown = (e) => e.preventDefault();   // seleksi di editor tetap
    btn.onclick = () => {
      if (btn.dataset.cmd === "divider") document.execCommand("insertHTML", false, '<hr class="scene-break"><p><br></p>');
      else document.execCommand(btn.dataset.cmd, false, null);
      el("focusEditor").focus(); updateFocusToolbarState();   // execCommand memicu "input" -> isi scene ikut tersimpan
    };
  });
  el("focusColor").oninput = () => { document.execCommand("foreColor", false, el("focusColor").value); el("focusEditor").focus(); };
  document.addEventListener("selectionchange", () => { if (!el("focusOverlay").classList.contains("hidden")) updateFocusToolbarState(); });

  // Organize tab
  document.querySelectorAll(".org-subtab").forEach((btn) => btn.onclick = () => switchOrganizeCat(btn.dataset.cat));
  el("btnAddOrganizeItem").onclick = openAddOrganizeModal;
  el("btnCancelOrganize").onclick = () => el("organizeModal").classList.add("hidden");
  el("btnSaveOrganize").onclick = saveNewOrganizeItem;

  // Backup modal
  el("btnCloseBackup").onclick = () => el("backupModal").classList.add("hidden");

  // Cegah kehilangan data kalau tab ditutup sebelum sempat autosave: ketikan yang masih di kolom edit dimasukkan dulu +
  // salinan darurat ditulis sinkron (flushBeforeLeave), lalu peringatan bila masih ada yang belum sampai ke Drive
  window.addEventListener("beforeunload", (e) => {
    flushBeforeLeave();
    if (hasPendingSave()) { e.preventDefault(); e.returnValue = ""; }
  });
  // Simpan langsung (tanpa menunggu debounce) begitu tab disembunyikan / app kehilangan fokus / halaman ditutup
  const saveOnLeave = () => { flushBeforeLeave(); if (hasUnsyncedChanges || hasPendingSave()) doAutosaveFlush(); };
  document.addEventListener("visibilitychange", () => { if (document.hidden) saveOnLeave(); });
  window.addEventListener("pagehide", saveOnLeave);
  // jalur cadangan (tanpa novelist-sync): kembali online -> kirim yang tertunda
  window.addEventListener("online", () => { if (!window.NovelistSync && hasUnsyncedChanges && currentProjectId) { driveRetry.delay = 0; doAutosaveFlush(); } });
  // status simpan yang bisa diklik ("Perlu login ulang" / "Gagal sinkron — coba lagi"); salinan di bar Tulis meneruskan klik
  const statusAct = (e) => { if (e.type === "keydown" && e.key !== "Enter" && e.key !== " ") return; if (!el("saveStatus").classList.contains("is-action")) return; if (e.type === "keydown") e.preventDefault(); retrySaveFromStatus(); };
  el("saveStatus").addEventListener("click", statusAct);
  el("saveStatus").addEventListener("keydown", statusAct);
  el("twSave").addEventListener("click", () => { if (el("saveStatus").classList.contains("is-action")) el("saveStatus").click(); });

  window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
      flushCurrentEdits();
      const p = getProject(currentProjectId);
      if (p) saveProjectToDriveMain(p);
    }
  });
});
