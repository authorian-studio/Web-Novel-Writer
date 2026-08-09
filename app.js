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
  const hasProjects = projects.length > 0;
  el("emptyState").classList.toggle("hidden", hasProjects);
  // FAB "Add Project" is hidden while the empty state is showing (first-time / no projects),
  // and reappears once a project/template exists.
  el("btnAddProject").classList.toggle("hidden", !hasProjects);

  projects.forEach((p, idx) => {
    const card = document.createElement("div");
    card.className = "project-card";
    card.style.animationDelay = (idx * 0.04) + "s";
    const coverInner = p.cover
      ? `<img class="cover-img" src="${p.cover}" alt="" draggable="false" />`
      : `<span class="cover-letter">${escapeHtml((p.title || "?").charAt(0).toUpperCase())}</span>`;
    card.innerHTML = `
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
        toast("Gagal memindahkan ke Trash: " + e.message);
        return; // jangan hapus dari daftar lokal kalau gagal — supaya tidak dikira sudah terhapus padahal masih ada di Drive
      }
    }
    projects = projects.filter((x) => x.id !== p.id);
    renderDashboard();
    toast("Project dipindahkan ke Trash 🗑");
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
  toast("File Word berhasil diunduh 📄");
}

// ================= PROJECT VIEW (Write / Organize) =================
function openProject(id) {
  currentProjectId = id;
  const p = getProject(id);
  el("projectTitle").value = p.title;
  switchTab("write");
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
  el("dashboardView").classList.add("hidden");
  el("editorView").classList.remove("hidden");
}
function backToLibrary() {
  flushCurrentEdits();
  const p = getProject(currentProjectId);
  if (p) { p.title = el("projectTitle").value; p.data.title = p.title; p.updatedAt = new Date().toISOString(); }
  saveProjectToDriveMain(p);
  closeSceneDrawer();
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
  updateSceneDrawerVisibility();
}
function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// ---- WRITE TAB : binder bertingkat (folder/chapter berisi scene), tampil sebagai tree view ----
let draggedNodeId = null;
let expandedFolders = new Set();
let sceneHistory = [];
let sceneHistoryIndex = -1;
let pendingSceneParentId = null;
let pendingSceneType = "scene";
let currentZoom = 100;

const TREE_ICONS = {
  caret: `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>`,
  folder: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6Z"/></svg>`,
  file: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
  plus: `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>`,
  pen: `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4Z"/></svg>`,
  copy: `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
  trash: `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>`,
};
function countWordsFromHtml(html) {
  if (!html) return 0;
  const text = html.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").trim();
  return text ? text.split(/\s+/).filter(Boolean).length : 0;
}
function countAllNodes(list, isFolder) {
  return (list || []).filter((n) => (n.type === "folder") === isFolder).length;
}

function toggleFolder(id) {
  if (expandedFolders.has(id)) expandedFolders.delete(id); else expandedFolders.add(id);
  renderSceneList();
}

function renderSceneList() {
  const p = getProject(currentProjectId);
  const container = el("sceneList");
  container.innerHTML = "";
  (p.data.scenes || []).forEach((node) => container.appendChild(buildTreeNode(node)));
}

function buildTreeNode(node) {
  const wrap = document.createElement("div");
  wrap.className = "tree-node";

  const isFolder = node.type === "folder";
  const isOpen = isFolder && expandedFolders.has(node.id);
  const childCount = isFolder ? (node.children || []).length : 0;
  const metaText = isFolder ? (childCount ? `${childCount}` : "") : (countWordsFromHtml(node.content) + "w");

  const row = document.createElement("div");
  row.className = "tree-row" + (node.id === currentSceneId ? " active" : "");
  row.draggable = true;
  row.innerHTML = `
    <span class="tree-drag-handle" title="Seret untuk pindahkan">⠿</span>
    <span class="tree-caret ${isFolder ? (isOpen ? "open" : "") : "leaf"}">${isFolder ? TREE_ICONS.caret : ""}</span>
    <span class="tree-icon">${isFolder ? TREE_ICONS.folder : TREE_ICONS.file}</span>
    ${!isFolder ? `<span class="tree-status-dot ${node.status}"></span>` : ""}
    <span class="tree-label">${escapeHtml(node.title || "(tanpa judul)")}</span>
    <span class="tree-meta">${metaText}</span>
    <div class="tree-actions">
      ${isFolder
        ? `<button class="tree-action-btn" data-action="addChild" title="Tambah scene di dalam folder ini">${TREE_ICONS.plus}</button>
           <button class="tree-action-btn tree-action-danger" data-action="delete" title="Hapus folder & seluruh isinya">${TREE_ICONS.trash}</button>`
        : `<button class="tree-action-btn" data-action="focus" title="Mode fokus (tanpa gangguan)">${TREE_ICONS.pen}</button>
           <button class="tree-action-btn" data-action="duplicate" title="Duplikat scene">${TREE_ICONS.copy}</button>
           <button class="tree-action-btn tree-action-danger" data-action="delete" title="Hapus scene">${TREE_ICONS.trash}</button>`}
    </div>`;

  row.addEventListener("click", (e) => {
    const action = e.target.closest(".tree-action-btn")?.dataset.action;
    if (action === "addChild") { openAddSceneModal(node.id); return; }
    if (action === "focus") { openFocusMode(node.id); return; }
    if (action === "duplicate") { duplicateScene(node.id); return; }
    if (action === "delete") { deleteSceneNode(node.id); return; }
    if (isFolder) toggleFolder(node.id); else selectScene(node.id);
  });

  const labelEl = row.querySelector(".tree-label");
  labelEl.addEventListener("dblclick", (e) => { e.stopPropagation(); e.preventDefault(); startRenameNode(node, labelEl); });
  labelEl.title = "Klik dua kali untuk ganti nama";

  row.addEventListener("dragstart", (e) => { draggedNodeId = node.id; row.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; e.stopPropagation(); });
  row.addEventListener("dragend", () => row.classList.remove("dragging"));
  row.addEventListener("dragover", (e) => { e.preventDefault(); e.stopPropagation(); row.classList.add("drag-over"); });
  row.addEventListener("dragleave", () => row.classList.remove("drag-over"));
  row.addEventListener("drop", (e) => {
    e.preventDefault(); e.stopPropagation();
    row.classList.remove("drag-over");
    if (!draggedNodeId || draggedNodeId === node.id) return;
    dropNodeOnto(draggedNodeId, node);
  });

  wrap.appendChild(row);

  if (isFolder) {
    const group = document.createElement("div");
    group.className = "tree-group" + (isOpen ? " open" : "");
    const inner = document.createElement("div");
    inner.className = "tree-group-inner";
    (node.children || []).forEach((child) => inner.appendChild(buildTreeNode(child)));
    group.appendChild(inner);
    wrap.appendChild(group);
  }

  return wrap;
}

function startRenameNode(node, labelEl) {
  if (labelEl.querySelector(".tree-rename-input")) return; // sudah dalam mode edit
  const rowEl = labelEl.closest(".tree-row");
  if (rowEl) rowEl.draggable = false; // supaya drag-select teks di input tidak bentrok dengan drag-drop tree
  const originalTitle = node.title || "";
  const input = document.createElement("input");
  input.type = "text";
  input.className = "tree-rename-input";
  input.value = originalTitle;
  labelEl.textContent = "";
  labelEl.appendChild(input);
  input.focus();
  input.select();

  let done = false;
  const commit = () => {
    if (done) return;
    done = true;
    const newTitle = input.value.trim() || originalTitle || "Tanpa Judul";
    node.title = newTitle;
    if (node.id === currentSceneId) {
      const bp = document.querySelector(".breadcrumb-path");
      if (bp) bp.textContent = "📄 " + newTitle;
      const tf = el("sceneTitleField");
      if (tf) tf.value = newTitle;
    }
    renderSceneList();
    markDirtyAndSchedule();
  };
  const cancel = () => {
    if (done) return;
    done = true;
    renderSceneList();
  };

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); input.blur(); }
    else if (e.key === "Escape") { e.preventDefault(); cancel(); }
  });
  input.addEventListener("blur", commit);
  input.addEventListener("click", (e) => e.stopPropagation());
  input.addEventListener("dblclick", (e) => e.stopPropagation());
}

function dropNodeOnto(draggedId, targetNode) {
  const p = getProject(currentProjectId);
  const draggedInfo = findSceneNode(draggedId, p.data.scenes);
  if (!draggedInfo) return;
  if (draggedInfo.node.type === "folder" && isDescendantOf(draggedInfo.node, targetNode.id)) return; // cegah folder dipindah ke dalam anaknya sendiri
  draggedInfo.array.splice(draggedInfo.index, 1);
  if (targetNode.type === "folder") {
    targetNode.children = targetNode.children || [];
    targetNode.children.push(draggedInfo.node);
    expandedFolders.add(targetNode.id);
  } else {
    const targetInfo = findSceneNode(targetNode.id, p.data.scenes);
    if (targetInfo) targetInfo.array.splice(targetInfo.index, 0, draggedInfo.node);
    else p.data.scenes.push(draggedInfo.node); // fallback aman
  }
  renderSceneList();
  markDirtyAndSchedule();
}

function selectScene(id, addToHistory = true) {
  syncSceneFromDetail();
  currentSceneId = id;
  if (addToHistory) {
    sceneHistory = sceneHistory.slice(0, sceneHistoryIndex + 1);
    sceneHistory.push(id);
    sceneHistoryIndex = sceneHistory.length - 1;
  }
  renderSceneList();
  renderSceneDetail();
}
function goSceneBack() { if (sceneHistoryIndex > 0) { sceneHistoryIndex--; selectScene(sceneHistory[sceneHistoryIndex], false); } }
function goSceneForward() { if (sceneHistoryIndex < sceneHistory.length - 1) { sceneHistoryIndex++; selectScene(sceneHistory[sceneHistoryIndex], false); } }

function syncSceneFromDetail() {
  if (!currentProjectId || !currentSceneId) return;
  const s = findScene(currentSceneId);
  if (!s || !el("sceneTitleField")) return;
  s.title = el("sceneTitleField").value;
  s.synopsis = el("sceneSynopsis").value;
  s.content = el("sceneEditor").innerHTML;
}

function renderSceneDetail() {
  const col = el("sceneDetailCol");
  const s = currentSceneId ? findScene(currentSceneId) : null;
  if (!s) {
    col.innerHTML = '<div class="scene-empty-hint">Pilih atau buat scene untuk mulai menulis.</div>';
    updateSceneDrawerVisibility();
    return;
  }
  col.innerHTML = `
    <div class="obsidian-pane">
      <div class="breadcrumb-bar">
        <button id="sceneNavBack" class="mini-icon-btn" title="Kembali" ${sceneHistoryIndex <= 0 ? "disabled" : ""}>◀</button>
        <button id="sceneNavForward" class="mini-icon-btn" title="Maju" ${sceneHistoryIndex >= sceneHistory.length - 1 ? "disabled" : ""}>▶</button>
        <span class="breadcrumb-path">📄 ${escapeHtml(s.title || "(tanpa judul)")}</span>
      </div>
      <div id="sceneEditor" class="obsidian-editor" contenteditable="true" spellcheck="false" style="font-size:${16 * currentZoom / 100}px">${s.content || ""}</div>
    </div>

    <div class="obsidian-statusbar">
      <span id="sceneWordCount" class="stats-pill">0 kata</span>
      <div class="zoom-control">
        <span>🔍</span>
        <input type="range" id="zoomSlider" min="70" max="160" value="${currentZoom}" />
        <span id="zoomLabel">${currentZoom}%</span>
      </div>
    </div>`;

  const updateSceneWordCount = () => {
    const stats = computeTextStats(el("sceneEditor").innerText);
    el("sceneWordCount").textContent = statsLabel(stats);
  };
  updateSceneWordCount();

  el("sceneEditor").addEventListener("input", () => { s.content = el("sceneEditor").innerHTML; updateSceneWordCount(); markDirtyAndSchedule(); });

  el("sceneNavBack").onclick = goSceneBack;
  el("sceneNavForward").onclick = goSceneForward;

  el("zoomSlider").oninput = () => {
    currentZoom = parseInt(el("zoomSlider").value, 10);
    el("zoomLabel").textContent = currentZoom + "%";
    el("sceneEditor").style.fontSize = (16 * currentZoom / 100) + "px";
  };

  renderSceneDrawerBody(s);
  updateSceneDrawerVisibility();
}

// ============ SCENE OPTIONS DRAWER (nama, synopsis, status, format tulisan) ============
function renderSceneDrawerBody(s) {
  const body = el("sceneDrawerBody");
  if (!body) return;
  body.innerHTML = `
    <div class="drawer-section">
      <div class="drawer-section-label">👤 Main Information</div>
      <label class="field-label">Title</label>
      <input id="sceneTitleField" class="field-input" value="${escapeHtml(s.title)}" />
      <label class="field-label">Synopsis</label>
      <textarea id="sceneSynopsis" class="field-input textarea" placeholder="Synopsis singkat scene ini...">${escapeHtml(s.synopsis || "")}</textarea>
      <div class="status-row">
        <button class="status-chip chip-todo ${s.status === "todo" ? "selected" : ""}" data-status="todo">Todo</button>
        <button class="status-chip chip-draft ${s.status === "draft" ? "selected" : ""}" data-status="draft">Draft</button>
        <button class="status-chip chip-done ${s.status === "done" ? "selected" : ""}" data-status="done">Done</button>
      </div>
    </div>

    <div class="drawer-section">
      <div class="drawer-section-label">🪶 Formatting</div>
      <div class="drawer-toolbar-selects">
        <select id="fmtFont" title="Font">
          <option value="Georgia">Georgia</option>
          <option value="'Segoe UI',sans-serif">Segoe UI</option>
          <option value="'Times New Roman',serif">Times New Roman</option>
          <option value="'Courier New',monospace">Courier New</option>
        </select>
        <select id="fmtSize" title="Ukuran">
          <option value="2">12</option><option value="3" selected>14</option><option value="4">16</option>
          <option value="5">18</option><option value="6">24</option><option value="7">32</option>
        </select>
        <select id="fmtStyle" title="Gaya">
          <option value="p">Paragraf</option><option value="h1">Heading 1</option>
          <option value="h2">Heading 2</option><option value="h3">Heading 3</option>
        </select>
      </div>
      <div class="drawer-toolbar-row">
        <button data-cmd="bold" title="Bold"><b>B</b></button>
        <button data-cmd="italic" title="Italic"><i>I</i></button>
        <button data-cmd="underline" title="Underline"><u>U</u></button>
        <span class="toolbar-sep"></span>
        <button data-cmd="justifyLeft" title="Rata kiri">⯇</button>
        <button data-cmd="justifyCenter" title="Rata tengah">☰</button>
        <button data-cmd="justifyRight" title="Rata kanan">⯈</button>
        <span class="toolbar-sep"></span>
        <button data-cmd="insertUnorderedList" title="Bullet list">• ≡</button>
        <button data-cmd="insertOrderedList" title="Numbered list">1. ≡</button>
        <input type="color" id="fmtColor" title="Warna teks" value="#e7e5e0" />
      </div>
    </div>

    <div class="drawer-section">
      <div class="drawer-section-label">⚙️ Scene Actions</div>
      <div class="drawer-action-row">
        <button id="sceneDuplicateBtn" class="drawer-action-btn">📄 Duplikat Scene</button>
        <button id="sceneDeleteBtn" class="drawer-action-btn drawer-action-danger">🗑️ Hapus Scene</button>
      </div>
    </div>`;

  el("sceneTitleField").addEventListener("input", () => {
    s.title = el("sceneTitleField").value;
    const bp = document.querySelector(".breadcrumb-path");
    if (bp) bp.textContent = "📄 " + (s.title || "(tanpa judul)");
    renderSceneList();
    markDirtyAndSchedule();
  });
  el("sceneSynopsis").addEventListener("input", () => { s.synopsis = el("sceneSynopsis").value; renderSceneList(); markDirtyAndSchedule(); });

  body.querySelectorAll(".status-chip").forEach((btn) => {
    btn.onclick = () => {
      s.status = btn.dataset.status;
      body.querySelectorAll(".status-chip").forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
      renderSceneList();
      markDirtyAndSchedule();
    };
  });

  // ---- toolbar format (bekerja pada seleksi terakhir di #sceneEditor) ----
  body.querySelectorAll(".drawer-toolbar-row button[data-cmd]").forEach((btn) => {
    btn.onclick = () => { document.execCommand(btn.dataset.cmd, false, null); el("sceneEditor").focus(); };
  });
  el("fmtFont").onchange = () => { document.execCommand("fontName", false, el("fmtFont").value); el("sceneEditor").focus(); };
  el("fmtSize").onchange = () => { document.execCommand("fontSize", false, el("fmtSize").value); el("sceneEditor").focus(); };
  el("fmtStyle").onchange = () => { document.execCommand("formatBlock", false, el("fmtStyle").value); el("sceneEditor").focus(); };
  el("fmtColor").oninput = () => { document.execCommand("foreColor", false, el("fmtColor").value); el("sceneEditor").focus(); };

  el("sceneDuplicateBtn").onclick = () => duplicateScene(s.id);
  el("sceneDeleteBtn").onclick = () => deleteSceneNode(s.id);
}

function updateSceneDrawerVisibility() {
  const tabWrite = el("tabWrite");
  const writeActive = tabWrite && !tabWrite.classList.contains("hidden");
  const show = !!(writeActive && currentSceneId && findScene(currentSceneId));
  el("sceneDrawerToggle").classList.toggle("hidden", !show);
  if (!show) closeSceneDrawer();
}

function openSceneDrawer() {
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
  const copy = deepCloneNode(info.node);
  copy.title = info.node.title + " (copy)";
  info.array.splice(info.index + 1, 0, copy);
  renderSceneList();
  toast((copy.type === "folder" ? "Chapter" : "Scene") + " diduplikat 📄");
  markDirtyAndSchedule();
}
function deleteSceneNode(id) {
  const info = findSceneNode(id);
  if (!info) return;
  const msg = info.node.type === "folder" ? "Hapus chapter ini beserta seluruh scene di dalamnya?" : "Hapus scene ini?";
  if (!confirm(msg)) return;
  info.array.splice(info.index, 1);
  if (!findSceneNode(currentSceneId)) { const first = findFirstScene(getProject(currentProjectId).data.scenes); currentSceneId = first ? first.id : null; }
  renderSceneList(); renderSceneDetail();
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
  const stats = computeTextStats(el("focusEditor").innerText);
  el("focusStats").textContent = statsLabel(stats);
}
function updateFocusToolbarState() {
  document.querySelectorAll(".focus-toolbar button[data-cmd]").forEach((btn) => {
    try { btn.classList.toggle("active", document.queryCommandState(btn.dataset.cmd)); } catch (e) {}
  });
}

// ---- FOCUS MODE (full writer tanpa gangguan) ----
let focusSceneId = null;
function openFocusMode(id) {
  syncSceneFromDetail();
  focusSceneId = id;
  const s = findScene(id);
  el("focusTitle").value = s.title;
  el("focusEditor").innerHTML = s.content || "";
  el("focusOverlay").classList.remove("hidden");
  el("focusEditor").focus();
  updateFocusStats();
}
function closeFocusMode() {
  const s = findScene(focusSceneId);
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
        <span class="drag-handle" title="Seret untuk pindahkan urutan">⠿</span>
        <div class="scene-card-title">${escapeHtml(item.title)}</div>
        <div class="scene-card-icons">
          <button class="scene-icon-btn scene-icon-danger" data-action="delete" title="Hapus">🗑</button>
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
    if (n.type === "folder") { html += `<h2>📁 ${escapeHtml(n.title)}</h2>`; html += previewNodesToHtml(n.children); }
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
function markDirty() { hasUnsyncedChanges = true; dirtySinceLastBackup = true; if (!firstDirtyAt) firstDirtyAt = Date.now(); el("saveStatus").textContent = "Menyimpan..."; }
function markSaved(label) { hasUnsyncedChanges = false; firstDirtyAt = null; el("saveStatus").textContent = label || "Tersimpan"; }
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
}

// ================= GOOGLE DRIVE (REST API) =================
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
let mainFolderIdCache = null;
let backupFolderIdCache = null;
let trashFolderIdCache = null;

async function driveFetch(url, options = {}) {
  const res = await fetch(url, { ...options, headers: { ...(options.headers || {}), Authorization: `Bearer ${accessToken}` } });
  if (res.status === 401) { accessToken = null; throw new Error("Sesi Google berakhir, silakan login ulang."); }
  if (!res.ok) throw new Error(`Drive API error ${res.status}: ${await res.text()}`);
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
// Pindahkan file antar folder tanpa upload ulang isinya (dipakai untuk Trash: pindah ke/keluar folder trash)
async function driveMoveFile(fileId, fromFolderId, toFolderId) {
  await driveFetch(`${DRIVE_API}/files/${fileId}?addParents=${toFolderId}&removeParents=${fromFolderId}&fields=id,parents`, { method: "PATCH" });
}

// ---- simpan file utama project ----
async function saveProjectToDriveMain(p) {
  if (!p || !accessToken || p._deleted) return;
  try {
    const folderId = await getOrCreateFolder(DRIVE_FOLDER_NAME, "main");
    const payload = { ...p.data, cover: p.cover || null };
    const json = JSON.stringify(payload);
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
    const payload = { ...p.data, cover: p.cover || null };
    await driveUpload(fileName, JSON.stringify(payload), null, folderId);
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
        const restored = migrateOldData(JSON.parse(content));
        p.data = restored;
        p.cover = restored.cover || null;
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
    if (isInitialLogin) toast("Gagal memuat project dari Drive: " + e.message);
  }
  renderDashboard();
}
// ================= CLOUD LIBRARY (manual send/receive, terpisah dari autosave) =================
function formatDateTime(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }) + " " + d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
}
function openCloudLibrary() {
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
      <button class="cloud-action-btn" title="Kirim ke Cloud">⬆</button>`;
    row.querySelector(".cloud-action-btn").onclick = async (e) => {
      e.stopPropagation();
      const btn = e.currentTarget;
      btn.textContent = "…";
      if (currentProjectId === p.id) flushCurrentEdits();
      await saveProjectToDriveMain(p);
      btn.textContent = "✓";
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
        <button class="cloud-action-btn" title="Ambil dari Cloud">⬇</button>`;
      row.onclick = () => pullFromCloud(f);
      panel.appendChild(row);
    });
  } catch (e) { panel.innerHTML = '<p class="cloud-empty">Gagal memuat daftar: ' + e.message + "</p>"; }
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
    toast('Project "' + p.title + '" diambil dari Cloud ✅');
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
          <button class="cloud-action-btn" data-act="restore" title="Pulihkan project">⟲</button>
          <button class="cloud-action-btn cloud-action-danger" data-act="wipe" title="Hapus permanen">🗑</button>
        </div>`;
      row.querySelector('[data-act="restore"]').onclick = (e) => { e.stopPropagation(); restoreFromTrash(f); };
      row.querySelector('[data-act="wipe"]').onclick = (e) => { e.stopPropagation(); permanentlyDeleteFromTrash(f); };
      panel.appendChild(row);
    });
  } catch (e) { panel.innerHTML = '<p class="cloud-empty">Gagal memuat Trash: ' + e.message + "</p>"; }
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
    toast('Project "' + p.title + '" dipulihkan ✅');
    renderTrashList();
  } catch (e) { toast("Gagal memulihkan: " + e.message); }
}
async function permanentlyDeleteFromTrash(f) {
  if (!confirm(`Hapus permanen "${f.name.replace(/\.novj$/, "")}"? Tindakan ini tidak bisa dibatalkan.`)) return;
  try {
    await driveDelete(f.id);
    toast("Dihapus permanen dari Trash ✅");
    renderTrashList();
  } catch (e) { toast("Gagal menghapus permanen: " + e.message); }
}

function updateSyncIndicator(ok) {
  const ind = el("syncIndicator");
  ind.textContent = ok ? "☁ Tersinkron" : "☁ Gagal sinkron";
  ind.style.color = ok ? "var(--success)" : "var(--danger)";
}

// ================= PARTICLES BACKGROUND (halaman login) =================
function initLoginParticles() {
  const canvas = document.getElementById("particlesCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const QUANTITY = 110;
  const EASE = 20; // makin besar makin "lembut" gerakan menjauh dari mouse
  let particles = [];
  let mouse = { x: -9999, y: -9999 };
  let raf = null;
  let dpr = Math.min(window.devicePixelRatio || 1, 2);

  function resize() {
    canvas.width = canvas.clientWidth * dpr;
    canvas.height = canvas.clientHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function makeParticle() {
    return {
      x: Math.random() * canvas.clientWidth,
      y: Math.random() * canvas.clientHeight,
      baseX: 0, baseY: 0,
      vx: (Math.random() - 0.5) * 0.15,
      vy: (Math.random() - 0.5) * 0.15,
      r: Math.random() * 1.4 + 0.4,
      alpha: Math.random() * 0.5 + 0.2
    };
  }

  function initParticles() {
    particles = Array.from({ length: QUANTITY }, makeParticle);
  }

  function step() {
    ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    particles.forEach((p) => {
      // drift lambat
      p.x += p.vx;
      p.y += p.vy;
      // wrap di tepi layar
      if (p.x < -5) p.x = canvas.clientWidth + 5;
      if (p.x > canvas.clientWidth + 5) p.x = -5;
      if (p.y < -5) p.y = canvas.clientHeight + 5;
      if (p.y > canvas.clientHeight + 5) p.y = -5;

      // dorongan halus menjauh dari mouse, lalu "ease" kembali
      const dx = p.x - mouse.x, dy = p.y - mouse.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 110) {
        const force = (110 - dist) / 110;
        p.x += (dx / (dist || 1)) * force * (EASE / 10);
        p.y += (dy / (dist || 1)) * force * (EASE / 10);
      }

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(180,180,190,${p.alpha})`;
      ctx.fill();
    });
    raf = requestAnimationFrame(step);
  }

  resize();
  initParticles();
  step();

  window.addEventListener("resize", () => { resize(); });
  window.addEventListener("load", () => { resize(); });
  canvas.addEventListener("mousemove", (e) => { const r = canvas.getBoundingClientRect(); mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top; });
  canvas.addEventListener("mouseleave", () => { mouse.x = -9999; mouse.y = -9999; });

  // hentikan animasi begitu halaman login sudah tidak terlihat (hemat CPU)
  const loginViewEl = document.getElementById("loginView");
  const observer = new MutationObserver(() => {
    if (loginViewEl.classList.contains("hidden") && raf) { cancelAnimationFrame(raf); raf = null; }
    else if (!loginViewEl.classList.contains("hidden") && !raf) { step(); }
  });
  observer.observe(loginViewEl, { attributes: true, attributeFilter: ["class"] });
}

// ================= EVENT BINDING =================
window.addEventListener("DOMContentLoaded", () => {
  initLoginParticles();
  el("btnLoginGoogle").onclick = handleLogin;

  el("btnAddProject").onclick = openAddProjectModal;
  el("emptyStateBtn").onclick = openAddProjectModal;
  el("emptyStateLink").onclick = (e) => { e.preventDefault(); openAddProjectModal(); };
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
  el("menuCloudLibrary").onclick = openCloudLibrary;
  el("menuDriveLogout").onclick = () => { if (confirm("Logout dari Google?")) driveSignOut(); };

  // ---- Quick action icons (top-right expandable tabs bar) ----
  // Klik langsung memicu animasi "expand" (menampilkan label) tanpa perlu hover dulu —
  // penting juga untuk perangkat sentuh yang tidak punya state hover sama sekali.
  function pulseExpTab(btn) {
    document.querySelectorAll(".exp-tab.is-active").forEach((t) => t.classList.remove("is-active"));
    btn.classList.add("is-active");
    clearTimeout(btn._expTimer);
    btn._expTimer = setTimeout(() => btn.classList.remove("is-active"), 1700);
  }
  document.querySelectorAll(".exp-tab").forEach((btn) => {
    btn.addEventListener("click", () => pulseExpTab(btn));
  });
  el("btnQuickTheme").addEventListener("click", () => document.body.classList.toggle("light"));
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
  el("btnAddScene").onclick = () => openAddSceneModal(null);
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
  el("focusEditor").addEventListener("input", updateFocusStats);
  document.querySelectorAll(".focus-toolbar button[data-cmd]").forEach((btn) => {
    btn.onclick = () => { document.execCommand(btn.dataset.cmd, false, null); el("focusEditor").focus(); updateFocusToolbarState(); };
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

  // Cegah kehilangan data kalau tab ditutup sebelum sempat autosave
  window.addEventListener("beforeunload", (e) => {
    if (hasUnsyncedChanges) { e.preventDefault(); e.returnValue = ""; }
  });
  // Simpan langsung (tanpa menunggu debounce) begitu tab disembunyikan / app kehilangan fokus
  document.addEventListener("visibilitychange", () => { if (document.hidden && hasUnsyncedChanges) doAutosaveFlush(); });
  window.addEventListener("pagehide", () => { if (hasUnsyncedChanges) doAutosaveFlush(); });

  window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
      flushCurrentEdits();
      const p = getProject(currentProjectId);
      if (p) saveProjectToDriveMain(p);
    }
  });
});
