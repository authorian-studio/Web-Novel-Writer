// ================= STATE (semua di memori, tidak pakai localStorage) =================
let project = null;
let currentItemId = null;
let driveFileId = null;
let dirty = false;
let accessToken = null; // token Google, hanya hidup selama tab ini terbuka
let tokenClient = null;
let driveAutosaveTimer = null;

const el = (id) => document.getElementById(id);

// ================= MODEL PROJECT =================
function blankProject() {
  return {
    title: "Novel Tanpa Judul",
    createdAt: new Date().toISOString(),
    items: [
      { id: "manuscript", type: "folder", title: "Manuskrip", children: [
        { id: "scene-1", type: "scene", title: "Scene 1", content: "" }
      ]},
      { id: "characters", type: "folder", title: "Karakter", children: [] },
      { id: "locations", type: "folder", title: "Lokasi", children: [] },
      { id: "notes", type: "folder", title: "Catatan", children: [] }
    ]
  };
}

function findFolder(key) {
  return project.items.find((i) => i.id === key);
}
function findItem(id, list = project.items) {
  for (const it of list) {
    if (it.id === id) return it;
    if (it.children) {
      const found = findItem(id, it.children);
      if (found) return found;
    }
  }
  return null;
}

function renderBinder() {
  const map = { manuscript: "list-manuscript", characters: "list-characters", locations: "list-locations", notes: "list-notes" };
  for (const key in map) {
    const folder = findFolder(key);
    const container = el(map[key]);
    container.innerHTML = "";
    (folder.children || []).forEach((item) => {
      const div = document.createElement("div");
      div.className = "binder-item" + (item.id === currentItemId ? " active" : "");
      div.textContent = item.title || "(tanpa judul)";
      div.onclick = () => { selectItem(item.id); closeMobileBinder(); };
      container.appendChild(div);
    });
  }
}

function selectItem(id) {
  syncCurrentItemFromEditor();
  currentItemId = id;
  const item = findItem(id);
  el("itemTitle").value = item.title || "";
  el("editor").innerHTML = item.content || "";
  renderBinder();
  updateWordCount();
}

function updateWordCount() {
  const text = el("editor").innerText.trim();
  const count = text.length ? text.split(/\s+/).length : 0;
  el("wordCount").textContent = `${count} kata`;
}

function markDirty() {
  dirty = true;
  el("saveStatus").textContent = "Belum disimpan";
}
function markSaved(label) {
  dirty = false;
  el("saveStatus").textContent = label || ("Tersimpan " + new Date().toLocaleTimeString());
}

function syncCurrentItemFromEditor() {
  if (!currentItemId) return;
  const item = findItem(currentItemId);
  if (!item) return;
  item.title = el("itemTitle").value;
  item.content = el("editor").innerHTML;
}

function serializeProject() {
  syncCurrentItemFromEditor();
  project.title = el("projectTitle").value;
  return JSON.stringify(project, null, 2);
}

function loadProjectData(data) {
  project = data;
  driveFileId = null;
  el("projectTitle").value = project.title || "Novel Tanpa Judul";
  const firstScene = project.items[0]?.children?.[0];
  currentItemId = firstScene ? firstScene.id : null;
  renderBinder();
  if (currentItemId) selectItem(currentItemId);
  else { el("itemTitle").value = ""; el("editor").innerHTML = ""; }
  markDirty();
}

function addItem(parentKey) {
  const folder = findFolder(parentKey);
  const id = parentKey + "-" + Date.now();
  const typeMap = { manuscript: "scene", characters: "character", locations: "location", notes: "note" };
  folder.children = folder.children || [];
  folder.children.push({ id, type: typeMap[parentKey], title: "Baru", content: "" });
  renderBinder();
  selectItem(id);
  markDirty();
}

// ================= FILE LOKAL (unduh / buka dari perangkat) =================
function downloadProjectFile() {
  const json = serializeProject();
  const fileName = (project.title || "novel").replace(/[\\/:*?"<>|]/g, "_") + ".novj";
  const blob = new Blob([json], { type: "application/json" });
  const urlObj = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = urlObj;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(urlObj);
  markSaved("Diunduh " + new Date().toLocaleTimeString());
}

function openLocalFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      loadProjectData(data);
      markSaved("Dibuka dari file lokal");
    } catch (e) {
      alert("File tidak valid: " + e.message);
    }
  };
  reader.readAsText(file);
}

// ================= GOOGLE DRIVE (REST API via fetch) =================
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";

function ensureTokenClient() {
  if (tokenClient) return tokenClient;
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: GOOGLE_SCOPES,
    callback: () => {} // di-override tiap kali requestAccessToken dipanggil
  });
  return tokenClient;
}

function driveSignIn() {
  return new Promise((resolve, reject) => {
    const client = ensureTokenClient();
    client.callback = (resp) => {
      if (resp.error) { reject(resp); return; }
      accessToken = resp.access_token;
      resolve(accessToken);
    };
    client.requestAccessToken({ prompt: "consent" });
  });
}

function driveSignOut() {
  if (accessToken && google.accounts?.oauth2?.revoke) {
    google.accounts.oauth2.revoke(accessToken, () => {});
  }
  accessToken = null;
}

async function driveFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${accessToken}` }
  });
  if (!res.ok) throw new Error(`Drive API error ${res.status}: ${await res.text()}`);
  return res;
}

async function getOrCreateAppFolder() {
  const q = encodeURIComponent(`mimeType='application/vnd.google-apps.folder' and name='${DRIVE_FOLDER_NAME}' and trashed=false`);
  const res = await driveFetch(`${DRIVE_API}/files?q=${q}&fields=files(id,name)`);
  const data = await res.json();
  if (data.files.length > 0) return data.files[0].id;

  const createRes = await driveFetch(`${DRIVE_API}/files`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: DRIVE_FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" })
  });
  const folder = await createRes.json();
  return folder.id;
}

async function driveListProjects() {
  const folderId = await getOrCreateAppFolder();
  const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
  const res = await driveFetch(`${DRIVE_API}/files?q=${q}&fields=files(id,name,modifiedTime)&orderBy=modifiedTime desc`);
  const data = await res.json();
  return data.files;
}

async function driveSaveProject(fileName, jsonContent, fileId) {
  const metadata = fileId ? {} : { name: fileName, parents: [await getOrCreateAppFolder()] };
  const boundary = "novelist_boundary_" + Date.now();
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${jsonContent}\r\n--${boundary}--`;

  const url = fileId
    ? `${DRIVE_UPLOAD_API}/files/${fileId}?uploadType=multipart&fields=id,name,modifiedTime`
    : `${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=id,name,modifiedTime`;

  const res = await driveFetch(url, {
    method: fileId ? "PATCH" : "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body
  });
  return await res.json();
}

async function driveLoadProject(fileId) {
  const res = await driveFetch(`${DRIVE_API}/files/${fileId}?alt=media`);
  return await res.text();
}

// ================= UI EVENTS =================
window.addEventListener("DOMContentLoaded", () => {
  loadProjectData(blankProject());
  markSaved("Belum disimpan");

  el("btnNew").onclick = () => { if (confirm("Buat project baru? Perubahan yang belum disimpan akan hilang.")) loadProjectData(blankProject()); };
  el("btnOpenLocal").onclick = () => el("fileInputHidden").click();
  el("fileInputHidden").onchange = (e) => { if (e.target.files[0]) openLocalFile(e.target.files[0]); e.target.value = ""; };
  el("btnSaveLocal").onclick = downloadProjectFile;

  document.querySelectorAll(".add-item").forEach((btn) => { btn.onclick = () => addItem(btn.dataset.parent); });

  el("editor").addEventListener("input", () => { syncCurrentItemFromEditor(); updateWordCount(); markDirty(); });
  el("itemTitle").addEventListener("input", () => { syncCurrentItemFromEditor(); renderBinder(); markDirty(); });
  el("projectTitle").addEventListener("input", markDirty);

  document.querySelectorAll(".toolbar-buttons button").forEach((btn) => {
    btn.onclick = () => { document.execCommand(btn.dataset.cmd, false, btn.dataset.value || null); el("editor").focus(); };
  });

  el("btnFocus").onclick = () => document.body.classList.toggle("focus-mode");
  el("btnTheme").onclick = () => document.body.classList.toggle("light");
  el("btnMenuMobile").onclick = () => el("binder").classList.toggle("open");

  window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); downloadProjectFile(); }
  });

  // -------- DRIVE MODAL --------
  el("btnDrive").onclick = () => {
    el("driveModal").classList.remove("hidden");
    toggleDriveUI(!!accessToken);
    if (accessToken) refreshDriveList();
  };
  el("btnCloseDrive").onclick = () => el("driveModal").classList.add("hidden");

  el("btnDriveSignIn").onclick = async () => {
    if (GOOGLE_CLIENT_ID.startsWith("ISI_CLIENT_ID")) {
      alert("Client ID Google belum diisi di config.js. Lihat README untuk caranya.");
      return;
    }
    el("btnDriveSignIn").textContent = "Menunggu login...";
    try {
      await driveSignIn();
      toggleDriveUI(true);
      await refreshDriveList();
      startDriveAutosave();
    } catch (e) {
      alert("Login gagal: " + (e.error || e.message || e));
    }
    el("btnDriveSignIn").textContent = "Login dengan Google";
  };

  el("btnDriveSignOut").onclick = () => {
    driveSignOut();
    toggleDriveUI(false);
    stopDriveAutosave();
  };

  el("btnDriveSaveNow").onclick = async () => {
    const json = serializeProject();
    const fileName = (project.title || "novel") + ".novj";
    try {
      const result = await driveSaveProject(fileName, json, driveFileId);
      driveFileId = result.id;
      markSaved("Tersimpan ke Drive " + new Date().toLocaleTimeString());
      await refreshDriveList();
    } catch (e) {
      alert("Gagal simpan ke Drive: " + e.message);
    }
  };
});

function closeMobileBinder() {
  if (window.innerWidth <= 760) el("binder").classList.remove("open");
}

function toggleDriveUI(signedIn) {
  el("driveNotSignedIn").classList.toggle("hidden", signedIn);
  el("driveSignedIn").classList.toggle("hidden", !signedIn);
}

async function refreshDriveList() {
  try {
    const files = await driveListProjects();
    const container = el("driveProjectList");
    container.innerHTML = "";
    files.forEach((f) => {
      const div = document.createElement("div");
      div.className = "drive-item";
      div.innerHTML = `<span>${f.name}</span><span>${new Date(f.modifiedTime).toLocaleDateString()}</span>`;
      div.onclick = async () => {
        const content = await driveLoadProject(f.id);
        const data = JSON.parse(content);
        loadProjectData(data);
        driveFileId = f.id;
        markSaved("Dibuka dari Drive");
        el("driveModal").classList.add("hidden");
      };
      container.appendChild(div);
    });
  } catch (e) {
    console.error(e);
  }
}

// Autosave ke Drive tiap 30 detik selama sudah login & sedang mengetik
function startDriveAutosave() {
  stopDriveAutosave();
  driveAutosaveTimer = setInterval(async () => {
    if (!dirty || !accessToken) return;
    const json = serializeProject();
    const fileName = (project.title || "novel") + ".novj";
    try {
      const result = await driveSaveProject(fileName, json, driveFileId);
      driveFileId = result.id;
      markSaved("Autosave ke Drive " + new Date().toLocaleTimeString());
    } catch (e) { console.error("Autosave gagal", e); }
  }, 30000);
}
function stopDriveAutosave() {
  if (driveAutosaveTimer) clearInterval(driveAutosaveTimer);
  driveAutosaveTimer = null;
}
