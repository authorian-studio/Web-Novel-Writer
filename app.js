// ================= STATE (di memori, tidak pakai localStorage) =================
let projects = [];
let currentProjectId = null;
let currentSceneId = null;
let currentOrgCat = "characters";
let currentOrgItemId = null;
let accessToken = null;
let tokenClient = null;
let activeCardMenuProjectId = null;
let editingProjectId = null;
let saveDebounceTimer = null;
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
    scenes: [{ id: "scene-" + Date.now(), title: "Scene 1", synopsis: "", status: "todo", content: "" }],
    organize: { characters: [], locations: [], notes: [] }
  };
  if (template === "standard") {
    data.organize.characters.push({ id: "char-" + Date.now(), title: "Protagonis", content: "<p>Deskripsi karakter utama...</p>" });
    data.organize.locations.push({ id: "loc-" + Date.now(), title: "Lokasi Utama", content: "<p>Deskripsi lokasi...</p>" });
  }
  return data;
}

// Migrasi format lama (.novj versi sebelumnya yang pakai "items")
function migrateOldData(data) {
  if (!data.items) return data;
  const migrated = { title: data.title || "Tanpa Judul", scenes: [], organize: { characters: [], locations: [], notes: [] } };
  data.items.forEach((folder) => {
    (folder.children || []).forEach((child) => {
      if (folder.id === "manuscript") {
        migrated.scenes.push({ id: child.id, title: child.title, synopsis: "", status: "todo", content: child.content || "" });
      } else if (folder.id === "characters") {
        migrated.organize.characters.push({ id: child.id, title: child.title, content: child.content || "" });
      } else if (folder.id === "locations") {
        migrated.organize.locations.push({ id: child.id, title: child.title, content: child.content || "" });
      } else if (folder.id === "notes") {
        migrated.organize.notes.push({ id: child.id, title: child.title, content: child.content || "" });
      }
    });
  });
  if (migrated.scenes.length === 0) migrated.scenes.push({ id: "scene-" + Date.now(), title: "Scene 1", synopsis: "", status: "todo", content: "" });
  return migrated;
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
function toast(msg) {
  const t = document.createElement("div");
  t.textContent = msg;
  t.style.cssText = "position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--bg-panel);border:1px solid var(--border);color:var(--text);padding:10px 18px;border-radius:8px;box-shadow:var(--shadow);z-index:500;font-size:13px;animation:fadeIn .2s ease;";
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}

// ================= LOGIN GATE =================
function ensureTokenClient() {
  if (tokenClient) return tokenClient;
  tokenClient = google.accounts.oauth2.initTokenClient({ client_id: GOOGLE_CLIENT_ID, scope: GOOGLE_SCOPES, callback: () => {} });
  return tokenClient;
}
function driveSignIn(interactive = true) {
  return new Promise((resolve, reject) => {
    if (GOOGLE_CLIENT_ID.startsWith("ISI_CLIENT_ID")) { reject({ error: "Client ID Google belum diisi di config.js" }); return; }
    const client = ensureTokenClient();
    client.callback = (resp) => { if (resp.error) { reject(resp); return; } accessToken = resp.access_token; resolve(accessToken); };
    client.requestAccessToken({ prompt: interactive ? "consent" : "" });
  });
}
function driveSignOut() {
  if (accessToken && google.accounts?.oauth2?.revoke) google.accounts.oauth2.revoke(accessToken, () => {});
  accessToken = null;
  projects = [];
  stopBackupInterval();
  el("dashboardView").classList.add("hidden");
  el("editorView").classList.add("hidden");
  el("loginView").classList.remove("hidden");
}

async function handleLogin() {
  el("loginError").classList.add("hidden");
  el("btnLoginGoogle").textContent = "Menunggu login...";
  try {
    await driveSignIn(true);
    el("loginView").classList.add("hidden");
    el("dashboardView").classList.remove("hidden");
    await loadProjectsFromDrive(true);
    startBackupInterval();
  } catch (e) {
    el("loginError").textContent = "Login gagal: " + (e.error || e.message || e);
    el("loginError").classList.remove("hidden");
  }
  el("btnLoginGoogle").innerHTML = '<span class="g-icon">G</span> Login dengan Google';
}

// ================= DASHBOARD RENDER =================
function renderDashboard() {
  const grid = el("projectGrid");
  grid.innerHTML = "";
  el("loadingState").classList.add("hidden");
  el("emptyState").classList.toggle("hidden", projects.length > 0);

  projects.forEach((p, idx) => {
    const card = document.createElement("div");
    card.className = "project-card";
    card.style.animationDelay = (idx * 0.04) + "s";
    const coverInner = p.cover
      ? `<img class="cover-img" src="${p.cover}" alt="" draggable="false" />`
      : `<span class="cover-letter">${escapeHtml((p.title || "?").charAt(0).toUpperCase())}</span>`;
    card.innerHTML = `
      <div class="accent-bar" style="background:${p.colorA}"></div>
      <div class="cover" style="background-image:linear-gradient(135deg, ${p.colorA}, ${p.colorB})">
        <button class="card-gear" title="Opsi">⚙️</button>
        ${coverInner}
      </div>
      <div class="card-body">
        <div class="card-title">${escapeHtml(p.title)}</div>
        <div class="card-desc">${escapeHtml(p.description || "")}</div>
        <div class="card-meta">${p.driveFileId ? '<span class="drive-dot"></span> Tersinkron' : "Belum disinkron"} · ${timeAgo(p.updatedAt)}</div>
      </div>`;
    card.addEventListener("click", (e) => { if (!e.target.closest(".card-gear")) openProject(p.id); });
    card.querySelector(".card-gear").addEventListener("click", (e) => { e.stopPropagation(); openCardMenu(p.id, e.currentTarget); });
    grid.appendChild(card);
  });
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
  if (action === "sendCloud") { await saveProjectToDriveMain(p); toast("Tersimpan ke Google Drive ✅"); }
  if (action === "delete") {
    if (!confirm(`Hapus project "${p.title}"? File di Drive tidak ikut terhapus otomatis.`)) return;
    projects = projects.filter((x) => x.id !== p.id);
    renderDashboard();
  }
}

// ================= EXPORT KE WORD (.doc) =================
function binderToHtml(data) {
  let html = `<h1 style="font-family:Georgia,serif;">${escapeHtml(data.title)}</h1>`;
  html += `<h2 style="font-family:Georgia,serif;border-bottom:1px solid #ccc;">Manuskrip</h2>`;
  (data.scenes || []).forEach((s) => {
    html += `<h3 style="font-family:Georgia,serif;">${escapeHtml(s.title)}</h3>`;
    if (s.synopsis) html += `<p style="font-style:italic;color:#555;">${escapeHtml(s.synopsis)}</p>`;
    html += `<div style="font-family:Georgia,serif;font-size:14px;">${s.content || ""}</div>`;
  });
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
  toast("File Word berhasil diunduh 📄");
}

// ================= PROJECT VIEW (Write / Organize) =================
function openProject(id) {
  currentProjectId = id;
  const p = getProject(id);
  el("projectTitle").value = p.title;
  switchTab("write");
  renderSceneList();
  currentSceneId = p.data.scenes[0]?.id || null;
  renderSceneDetail();
  currentOrgCat = "characters";
  document.querySelectorAll(".org-subtab").forEach((b) => b.classList.toggle("active", b.dataset.cat === "characters"));
  el("organizeCatLabel").textContent = "KARAKTER";
  renderOrganizeList();
  currentOrgItemId = null;
  renderOrganizeDetail();
  markSaved();
  el("dashboardView").classList.add("hidden");
  el("editorView").classList.remove("hidden");
}
function backToLibrary() {
  flushCurrentEdits();
  const p = getProject(currentProjectId);
  if (p) { p.title = el("projectTitle").value; p.data.title = p.title; p.updatedAt = new Date().toISOString(); }
  saveProjectToDriveMain(p);
  el("editorView").classList.add("hidden");
  el("dashboardView").classList.remove("hidden");
  renderDashboard();
}
function flushCurrentEdits() {
  syncSceneFromDetail();
  syncOrganizeFromDetail();
}

function switchTab(tab) {
  document.querySelectorAll(".rail-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  ["write", "organize", "plot", "schedule", "tools"].forEach((t) => el("tab" + capitalize(t)).classList.toggle("hidden", t !== tab));
}
function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// ---- WRITE TAB : scenes ----
function renderSceneList() {
  const p = getProject(currentProjectId);
  const container = el("sceneList");
  container.innerHTML = "";
  p.data.scenes.forEach((s) => {
    const card = document.createElement("div");
    card.className = "scene-card" + (s.id === currentSceneId ? " active" : "");
    card.innerHTML = `
      <div class="scene-card-top">
        <div class="scene-card-title">${escapeHtml(s.title || "(tanpa judul)")}</div>
        <div class="scene-card-icons">
          <button class="scene-icon-btn" data-action="focus" title="Mode fokus (tanpa gangguan)">🖋</button>
          <button class="scene-icon-btn" data-action="duplicate" title="Duplikat scene">📄</button>
        </div>
      </div>
      <div class="scene-card-bottom">
        <span class="status-dot ${s.status}"></span>
        <span class="scene-card-synopsis">${escapeHtml(s.synopsis || "Belum ada synopsis")}</span>
      </div>`;
    card.addEventListener("click", (e) => {
      const action = e.target.closest(".scene-icon-btn")?.dataset.action;
      if (action === "focus") { openFocusMode(s.id); return; }
      if (action === "duplicate") { duplicateScene(s.id); return; }
      selectScene(s.id);
    });
    container.appendChild(card);
  });
}
function selectScene(id) {
  syncSceneFromDetail();
  currentSceneId = id;
  renderSceneList();
  renderSceneDetail();
}
function syncSceneFromDetail() {
  if (!currentProjectId || !currentSceneId) return;
  const p = getProject(currentProjectId);
  const s = p.data.scenes.find((x) => x.id === currentSceneId);
  if (!s || !el("sceneTitleField")) return;
  s.title = el("sceneTitleField").value;
  s.synopsis = el("sceneSynopsis").value;
  s.content = el("sceneEditor").innerHTML;
}
function renderSceneDetail() {
  const p = getProject(currentProjectId);
  const col = el("sceneDetailCol");
  const s = p.data.scenes.find((x) => x.id === currentSceneId);
  if (!s) { col.innerHTML = '<div class="scene-empty-hint">Pilih atau buat scene untuk mulai menulis.</div>'; return; }
  col.innerHTML = `
    <div class="scene-detail-header">
      <input id="sceneTitleField" class="scene-title-input" value="${escapeHtml(s.title)}" />
      <button id="sceneMenuBtn" class="icon-btn" title="Menu">⋮</button>
    </div>
    <div class="main-info-card">
      <div class="main-info-header">👤 MAIN INFORMATION</div>
      <label class="field-label">Synopsis</label>
      <textarea id="sceneSynopsis" class="field-input textarea" placeholder="Synopsis singkat scene ini...">${escapeHtml(s.synopsis || "")}</textarea>
      <div class="status-row">
        <button class="status-chip chip-todo ${s.status === "todo" ? "selected" : ""}" data-status="todo">Todo</button>
        <button class="status-chip chip-draft ${s.status === "draft" ? "selected" : ""}" data-status="draft">Draft</button>
        <button class="status-chip chip-done ${s.status === "done" ? "selected" : ""}" data-status="done">Done</button>
      </div>
    </div>
    <div class="scene-writer-half">
      <div class="writer-half-label">✍️ TULISAN</div>
      <div id="sceneEditor" contenteditable="true" spellcheck="false">${s.content || ""}</div>
    </div>`;

  el("sceneTitleField").addEventListener("input", () => { s.title = el("sceneTitleField").value; renderSceneListSoft(); markDirtyAndSchedule(); });
  el("sceneSynopsis").addEventListener("input", () => { s.synopsis = el("sceneSynopsis").value; renderSceneListSoft(); markDirtyAndSchedule(); });
  el("sceneEditor").addEventListener("input", () => { s.content = el("sceneEditor").innerHTML; markDirtyAndSchedule(); });
  col.querySelectorAll(".status-chip").forEach((btn) => {
    btn.onclick = () => { s.status = btn.dataset.status; renderSceneDetail(); renderSceneList(); markDirtyAndSchedule(); };
  });
  el("sceneMenuBtn").onclick = (e) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const menu = el("sceneMenu");
    menu.style.top = rect.bottom + 6 + "px";
    menu.style.right = (window.innerWidth - rect.right) + "px"; menu.style.left = "auto";
    menu.classList.remove("hidden");
    menu.dataset.sceneId = s.id;
  };
}
// render ulang list tanpa reset scroll/detail (dipakai saat mengetik supaya list judul ikut update)
function renderSceneListSoft() { renderSceneList(); }

function openAddSceneModal() {
  el("sceneFieldTitle").value = ""; el("sceneFieldSynopsis").value = "";
  el("sceneModal").classList.remove("hidden");
  el("sceneFieldTitle").focus();
}
function saveNewScene() {
  const p = getProject(currentProjectId);
  const title = el("sceneFieldTitle").value.trim() || "Scene Baru";
  const synopsis = el("sceneFieldSynopsis").value.trim();
  const s = { id: "scene-" + Date.now(), title, synopsis, status: "todo", content: "" };
  p.data.scenes.push(s);
  el("sceneModal").classList.add("hidden");
  currentSceneId = s.id;
  renderSceneList(); renderSceneDetail();
  markDirtyAndSchedule();
}
function duplicateScene(id) {
  const p = getProject(currentProjectId);
  const s = p.data.scenes.find((x) => x.id === id);
  if (!s) return;
  const copy = { ...s, id: "scene-" + Date.now(), title: s.title + " (copy)" };
  const idx = p.data.scenes.findIndex((x) => x.id === id);
  p.data.scenes.splice(idx + 1, 0, copy);
  renderSceneList();
  toast("Scene diduplikat 📄");
  markDirtyAndSchedule();
}
function deleteScene(id) {
  const p = getProject(currentProjectId);
  if (!confirm("Hapus scene ini?")) return;
  p.data.scenes = p.data.scenes.filter((x) => x.id !== id);
  if (currentSceneId === id) currentSceneId = p.data.scenes[0]?.id || null;
  renderSceneList(); renderSceneDetail();
  markDirtyAndSchedule();
}

// ---- FOCUS MODE (full writer tanpa gangguan) ----
let focusSceneId = null;
function openFocusMode(id) {
  syncSceneFromDetail();
  focusSceneId = id;
  const p = getProject(currentProjectId);
  const s = p.data.scenes.find((x) => x.id === id);
  el("focusTitle").value = s.title;
  el("focusEditor").innerHTML = s.content || "";
  el("focusOverlay").classList.remove("hidden");
  el("focusEditor").focus();
}
function closeFocusMode() {
  const p = getProject(currentProjectId);
  const s = p.data.scenes.find((x) => x.id === focusSceneId);
  if (s) { s.title = el("focusTitle").value; s.content = el("focusEditor").innerHTML; }
  el("focusOverlay").classList.add("hidden");
  renderSceneList(); renderSceneDetail();
  markDirtyAndSchedule();
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
function renderOrganizeList() {
  const p = getProject(currentProjectId);
  const list = p.data.organize[currentOrgCat] || [];
  const container = el("organizeList");
  container.innerHTML = "";
  list.forEach((item) => {
    const card = document.createElement("div");
    card.className = "scene-card" + (item.id === currentOrgItemId ? " active" : "");
    card.innerHTML = `<div class="scene-card-top"><div class="scene-card-title">${escapeHtml(item.title)}</div></div>`;
    card.onclick = () => { syncOrganizeFromDetail(); currentOrgItemId = item.id; renderOrganizeList(); renderOrganizeDetail(); };
    container.appendChild(card);
  });
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
function openPreview() {
  flushCurrentEdits();
  const p = getProject(currentProjectId);
  el("previewTitle").textContent = p.title;
  let html = "";
  p.data.scenes.forEach((s) => { html += `<h2>${escapeHtml(s.title)}</h2>${s.content || "<p><i>(kosong)</i></p>"}`; });
  el("previewContent").innerHTML = html || "<p>Belum ada tulisan.</p>";
  el("previewModal").classList.remove("hidden");
}

// ================= SAVE STATUS =================
function markDirty() { hasUnsyncedChanges = true; dirtySinceLastBackup = true; el("saveStatus").textContent = "Menyimpan..."; }
function markSaved(label) { hasUnsyncedChanges = false; el("saveStatus").textContent = label || "Tersimpan"; }
function markDirtyAndSchedule() {
  markDirty();
  clearTimeout(saveDebounceTimer);
  saveDebounceTimer = setTimeout(async () => {
    flushCurrentEdits();
    const p = getProject(currentProjectId);
    if (p) { p.title = el("projectTitle").value; p.data.title = p.title; await saveProjectToDriveMain(p); }
  }, AUTOSAVE_DEBOUNCE_MS);
}

// ================= GOOGLE DRIVE (REST API) =================
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
let mainFolderIdCache = null;
let backupFolderIdCache = null;

async function driveFetch(url, options = {}) {
  const res = await fetch(url, { ...options, headers: { ...(options.headers || {}), Authorization: `Bearer ${accessToken}` } });
  if (res.status === 401) { accessToken = null; throw new Error("Sesi Google berakhir, silakan login ulang."); }
  if (!res.ok) throw new Error(`Drive API error ${res.status}: ${await res.text()}`);
  return res;
}
async function getOrCreateFolder(name, cacheKey) {
  if (cacheKey === "main" && mainFolderIdCache) return mainFolderIdCache;
  if (cacheKey === "backup" && backupFolderIdCache) return backupFolderIdCache;
  const q = encodeURIComponent(`mimeType='application/vnd.google-apps.folder' and name='${name}' and trashed=false`);
  const res = await driveFetch(`${DRIVE_API}/files?q=${q}&fields=files(id,name)`);
  const data = await res.json();
  let id;
  if (data.files.length > 0) id = data.files[0].id;
  else {
    const createRes = await driveFetch(`${DRIVE_API}/files`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder" }) });
    id = (await createRes.json()).id;
  }
  if (cacheKey === "main") mainFolderIdCache = id; else backupFolderIdCache = id;
  return id;
}
async function driveListInFolder(folderId, extraQuery = "") {
  const q = encodeURIComponent(`'${folderId}' in parents and trashed=false${extraQuery}`);
  const res = await driveFetch(`${DRIVE_API}/files?q=${q}&fields=files(id,name,modifiedTime)&orderBy=modifiedTime desc&pageSize=100`);
  return (await res.json()).files;
}
async function driveUpload(fileName, jsonContent, fileId, folderId) {
  const metadata = fileId ? {} : { name: fileName, parents: [folderId] };
  const boundary = "novelist_boundary_" + Date.now();
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${jsonContent}\r\n--${boundary}--`;
  const url = fileId ? `${DRIVE_UPLOAD_API}/files/${fileId}?uploadType=multipart&fields=id,name,modifiedTime` : `${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=id,name,modifiedTime`;
  const res = await driveFetch(url, { method: fileId ? "PATCH" : "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body });
  return await res.json();
}
async function driveGetContent(fileId) { return (await driveFetch(`${DRIVE_API}/files/${fileId}?alt=media`)).text(); }
async function driveDelete(fileId) { await driveFetch(`${DRIVE_API}/files/${fileId}`, { method: "DELETE" }); }

// ---- simpan file utama project ----
async function saveProjectToDriveMain(p) {
  if (!p || !accessToken) return;
  try {
    const folderId = await getOrCreateFolder(DRIVE_FOLDER_NAME, "main");
    const json = JSON.stringify(p.data);
    const result = await driveUpload(p.title + ".novj", json, p.driveFileId, folderId);
    p.driveFileId = result.id;
    p.updatedAt = new Date().toISOString();
    markSaved("Tersimpan " + new Date().toLocaleTimeString());
    updateSyncIndicator(true);
    if (!el("dashboardView").classList.contains("hidden")) renderDashboard();
  } catch (e) {
    markSaved("Gagal sinkron ⚠");
    updateSyncIndicator(false);
    console.error(e);
  }
}

// ---- backup bertimestamp ke folder terpisah ----
async function backupProjectNow(p, silent = false) {
  if (!p || !accessToken) return;
  try {
    const folderId = await getOrCreateFolder(DRIVE_BACKUP_FOLDER_NAME, "backup");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const fileName = `${p.title}__${stamp}.novj`;
    await driveUpload(fileName, JSON.stringify(p.data), null, folderId);
    await pruneOldBackups(p, folderId);
    if (!silent) toast("Backup tersimpan 🗄");
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
        p.data = migrateOldData(JSON.parse(content));
        el("backupModal").classList.add("hidden");
        openProject(p.id);
        toast("Project dipulihkan dari backup ✅");
      };
      el("backupList").appendChild(row);
    });
  } catch (e) { el("backupList").innerHTML = '<p style="color:var(--danger);font-size:13px;">Gagal memuat backup.</p>'; }
}

async function loadProjectsFromDrive(isInitialLogin = false) {
  el("loadingState").classList.remove("hidden");
  el("emptyState").classList.add("hidden");
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
    if (isInitialLogin) toast("Gagal memuat project dari Drive: " + e.message);
  }
  renderDashboard();
}
function updateSyncIndicator(ok) {
  const ind = el("syncIndicator");
  ind.textContent = ok ? "☁ Tersinkron" : "☁ Gagal sinkron";
  ind.style.color = ok ? "var(--success)" : "var(--danger)";
}

// ================= EVENT BINDING =================
window.addEventListener("DOMContentLoaded", () => {
  el("btnLoginGoogle").onclick = handleLogin;

  el("btnAddProject").onclick = openAddProjectModal;
  el("btnCancelProject").onclick = () => el("projectModal").classList.add("hidden");
  el("btnSaveProject").onclick = saveProjectModal;

  document.querySelectorAll("#cardMenu button").forEach((btn) => btn.onclick = () => handleCardMenuAction(btn.dataset.action));

  el("btnSettings").onclick = (e) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const menu = el("settingsMenu");
    menu.style.top = rect.bottom + 6 + "px"; menu.style.right = (window.innerWidth - rect.right) + "px"; menu.style.left = "auto";
    menu.classList.toggle("hidden");
  };
  document.addEventListener("click", closeAllDropdowns);
  el("menuThemeToggle").onclick = () => document.body.classList.toggle("light");
  el("menuDriveLoad").onclick = () => loadProjectsFromDrive(false);
  el("menuDriveLogout").onclick = driveSignOut;

  // ---- project view ----
  el("btnBack").onclick = backToLibrary;
  el("projectTitle").addEventListener("input", markDirtyAndSchedule);
  el("btnPreview").onclick = openPreview;
  el("btnClosePreview").onclick = () => el("previewModal").classList.add("hidden");

  el("btnProjectMenu").onclick = (e) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const menu = el("projectMenu");
    menu.style.top = rect.bottom + 6 + "px"; menu.style.right = (window.innerWidth - rect.right) + "px"; menu.style.left = "auto";
    menu.classList.remove("hidden");
  };
  document.querySelectorAll("#projectMenu button").forEach((btn) => btn.onclick = async () => {
    closeAllDropdowns();
    const p = getProject(currentProjectId);
    const action = btn.dataset.action;
    if (action === "sendCloud") { flushCurrentEdits(); await saveProjectToDriveMain(p); toast("Tersimpan ke Drive ✅"); }
    if (action === "backupNow") { flushCurrentEdits(); await backupProjectNow(p); }
    if (action === "history") openBackupHistory();
    if (action === "exportWord") { flushCurrentEdits(); exportProjectToWord(p); }
  });

  document.querySelectorAll(".rail-btn").forEach((btn) => btn.onclick = () => switchTab(btn.dataset.tab));

  // Write tab
  el("btnAddScene").onclick = openAddSceneModal;
  el("btnCancelScene").onclick = () => el("sceneModal").classList.add("hidden");
  el("btnSaveScene").onclick = saveNewScene;
  document.querySelectorAll("#sceneMenu button").forEach((btn) => btn.onclick = () => {
    const id = el("sceneMenu").dataset.sceneId;
    closeAllDropdowns();
    if (btn.dataset.action === "duplicate") duplicateScene(id);
    if (btn.dataset.action === "delete") deleteScene(id);
  });
  el("btnExitFocus").onclick = closeFocusMode;

  // Organize tab
  document.querySelectorAll(".org-subtab").forEach((btn) => btn.onclick = () => switchOrganizeCat(btn.dataset.cat));
  el("btnAddOrganizeItem").onclick = openAddOrganizeModal;
  el("btnCancelOrganize").onclick = () => el("organizeModal").classList.add("hidden");
  el("btnSaveOrganize").onclick = saveNewOrganizeItem;

  // Backup modal
  el("btnCloseBackup").onclick = () => el("backupModal").classList.add("hidden");

  // Cegah kehilangan data kalau tab ditutup sebelum sempat autosave
  window.addEventListener("beforeunload", (e) => {
    if (hasUnsyncedChanges) { e.preventDefault(); e.returnValue = ""; }
  });

  window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
      flushCurrentEdits();
      const p = getProject(currentProjectId);
      if (p) saveProjectToDriveMain(p);
    }
  });
});
