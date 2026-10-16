// ================= BERANDA: kanvas papan (React Flow) =================
// Dimuat lazy oleh app.js (ensureHomeLib) saat tab Beranda pertama kali dibuka — setelah React, ReactDOM, React Flow
// (vendor/) & home-canvas.css. Kanvas memenuhi SELURUH layar project (di belakang bar atas, seperti "dunia" di vvd):
// chip papan & menu mengambang di kiri/kanan atas, tombol tampilan + filter jejak di tepi kanan, bilah alat di bawah.
// Navigasi: roda mouse = zoom halus di titik kursor, cubit / Ctrl+roda = zoom, seret latar = geser, Shift+roda = geser
// ke samping, Alt+roda = geser atas-bawah, usapan dua jari trackpad = geser (dikenali dari deltaX / pola wheelDelta;
// kalau ragu dianggap roda mouse = zoom).
// Data per project (ikut tersimpan ke Drive):
//   p.data.canvas = { v: 1, active, boards: [{ id, title, nodes, edges, viewport, seq }], trail: [entry] }
//   trail = JEJAK: semua dokumen yang pernah dibuat di project, urut waktu dibuat -> titik bercahaya di papan Beranda
//     yang disambung benang tipis. entry = { kind, id, at, x, y }   kind = scene | folder | characters | locations |
//     notes | timeline | map | story | chapter | jejaring | board;  at = waktu dibuat (ms, 0 = tidak tercatat);
//     x/y = posisi titik. Dicocokkan dengan isi project tiap Beranda tampil & sebentar setelah project berubah (track):
//     dokumen baru ditambahkan (ditaruh dekat titik sebelumnya, jalur berkelok, tidak bertumpuk), yang dihapus dibuang,
//     judul selalu dibaca langsung dari dokumennya. Project lama disemai SEKALI dari waktu yang tertanam di id
//     (Date.now()) / urutan yang ada — posisi titik scene lama dipakai — tanpa menandai project berubah.
//   DUA JENIS PAPAN:
//   - "home" (Beranda) = GRAF JEJAK saja: titik dokumen yang sudah dibuat + benangnya; alat tambah objek tidak ada di
//     sini (hanya Pilih / Geser, filter, zoom). Tidak bisa dihapus. Objek bebas yang dulu ada di Beranda dipindah SEKALI
//     ke papan Brainstorm baru (migrateHome); penghubung ke titik jejak jadi kartu dokumen di papan itu.
//   - papan lain = BRAINSTORM: kanvas bebas — kartu karakter / tempat / dokumen lain (baru atau yang sudah ada),
//     catatan, bentuk, gambar, teks, frame, scene, disambung "benang" tipis (edge.style = "thread", bawaan papan ini)
//     atau panah.
//   node = { id, t, x, y, ... }  t = scene { sceneId } (papan lain) | shape { shape, color, text, w, h } | note { color, text, w, h }
//          | image { src (WebP data URL, sisi terpanjang <= 1200px), w, h } | text { text, size, w } | frame { title, color, w, h }
//          | doc { kind, ref, w, h }  (kartu dokumen dari alat "Dokumen": hanya rujukan, isinya dibaca dari dokumennya)
//   edge = { id, source, target, label, style? }  (penghubung buatan pengguna; style "thread" = benang tipis melengkung
//          tanpa panah, selain itu panah; di Beranda boleh ke titik jejak "s:<scene>" / "t:<jenis>:<id>")
//   Garis putus-putus urutan scene di Beranda (seq = true) dihitung dari urutan binder (tidak disimpan).
// Per perangkat (localStorage, tidak memicu simpan ke Drive): viewport & papan aktif, filter jejak, peta mini, antarmuka
// disembunyikan.
// Keyboard: semua tombol ditangani modul ini sendiri (deleteKeyCode React Flow dimatikan) dan hanya saat tab Beranda
// tampil & fokus tidak sedang di kolom teks — Delete di tab lain tidak pernah menghapus isi kanvas.
(function () {
  "use strict";
  const React = window.React, ReactDOM = window.ReactDOM, RF = window.ReactFlow;
  const h = React.createElement;
  const Flow = RF.default || RF.ReactFlow;

  const HOME_ID = "home";
  const SCENE_W = 160, DOT_CY = 13;          // node scene / titik jejak: lebar tetap, pusat titik 13px dari atas kotak
  const MIN_Z = 0.1, MAX_Z = 2.5;
  const MAX_IMG = 30, IMG_PX = 1200;
  const TYPES = ["scene", "shape", "note", "image", "text", "frame", "doc"];
  const PLACE = ["shape", "note", "text", "frame", "doc"];   // alat yang menaruh objek dengan klik/seret di kanvas
  const EDITABLE = ["shape", "note", "text", "frame"];
  const SHAPES = ["rect", "circle", "triangle", "diamond"];
  const SHAPE_NAMES = { rect: "persegi", circle: "lingkaran", triangle: "segitiga", diamond: "belah ketupat" };
  const COLORS = { slate: "#a3a8b4", amber: "#d7a86e", green: "#4caf82", blue: "#6aa8ff", violet: "#b58cff", red: "#e15c5c", teal: "#3fb8c9" };
  const COLOR_NAMES = { slate: "Abu", amber: "Emas", green: "Hijau", blue: "Biru", violet: "Ungu", red: "Merah", teal: "Toska" };
  const NOTE_COLORS = { yellow: "#f6d97a", pink: "#f5adc8", blue: "#a9cff5", green: "#b2e3a8", orange: "#f7bd86", violet: "#cfbcf7" };
  const NOTE_NAMES = { yellow: "Kuning", pink: "Merah muda", blue: "Biru", green: "Hijau", orange: "Jingga", violet: "Ungu" };
  const TEXT_SIZES = { s: 16, m: 24, l: 40 };
  const DEF = { shape: { w: 160, h: 110 }, note: { w: 200, h: 200 }, text: { w: 240, h: 40 }, frame: { w: 520, h: 340 }, doc: { w: 240, h: 172 } };
  const MIN = { shape: { w: 40, h: 30 }, note: { w: 90, h: 70 }, image: { w: 40, h: 30 }, text: { w: 50, h: 20 }, frame: { w: 140, h: 100 }, doc: { w: 170, h: 116 } };
  const STATUS = { todo: "Todo", draft: "Draft", done: "Done" };
  const DATA_IMG = /^data:image\/(png|jpeg|webp|gif);base64,[a-z0-9+/=]+$/i;
  const IMG_URL = /^data:image\/(png|jpeg|webp|gif);base64,/i;
  const MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || "");
  const MOD = MAC ? "⌘" : "Ctrl";
  // jenis dokumen (jejak & kartu): nama, ikon Tabler, warna titik (gelap / terang)
  const KINDS = {
    scene: { name: "Scene", icon: "#ti-file-text", c: "#e8e8ec", cl: "#5d5a52" },
    folder: { name: "Bab", icon: "#ti-folder", c: "#e3c27a", cl: "#a87b25" },
    characters: { name: "Karakter", icon: "#ti-user", c: "#ec7fb0", cl: "#c24b80" },
    locations: { name: "Lokasi", icon: "#ti-map-pin", c: "#5fc3a0", cl: "#23866a" },
    notes: { name: "Catatan", icon: "#ti-note", c: "#f2d16b", cl: "#a8841a" },
    // jenis Kodeks lainnya (kodeks.js)
    factions: { name: "Faksi", icon: "#ti-flag", c: "#f08a5d", cl: "#c2562a" },
    items: { name: "Benda", icon: "#ti-sword", c: "#e3c27a", cl: "#9c7420" },
    creatures: { name: "Makhluk", icon: "#ti-dragon", c: "#9ccc65", cl: "#5a8a22" },
    cultures: { name: "Budaya/Agama", icon: "#ti-building-church", c: "#c7a4ff", cl: "#8a5fd6" },
    magic: { name: "Sistem Sihir", icon: "#ti-wand", c: "#7fb4ff", cl: "#3c74c9" },
    history: { name: "Sejarah", icon: "#ti-hourglass", c: "#d9a066", cl: "#9a6224" },
    timeline: { name: "Timeline", icon: "#ti-timeline", c: "#6aa8ff", cl: "#2f6fcf" },
    map: { name: "Peta", icon: "#ti-map", c: "#3fb8c9", cl: "#1b8494" },
    story: { name: "Cerita", icon: "#ti-book-2", c: "#b58cff", cl: "#7d55d0" },
    chapter: { name: "Chapter", icon: "#ti-bookmark", c: "#d3c2ff", cl: "#8f78c9" },
    jejaring: { name: "Tree Relations", icon: "#ti-affiliate", c: "#f5a66b", cl: "#c86c2c" },
    board: { name: "Brainstorm", icon: "#ti-bulb", c: "#a3a8b4", cl: "#6c717c" },
  };
  const ORG = ["characters", "locations", "factions", "items", "creatures", "cultures", "magic", "history", "notes"];   // entri Kodeks
  const CARD_KINDS = ["scene", "characters", "locations", "factions", "items", "creatures", "cultures", "magic", "history", "notes", "timeline", "map", "story", "jejaring", "board"];
  // ubin alat "Dokumen" (urutan seperti referensi: Kartu, Peta, Kanvas, Pohon relasi, ...)
  const TILES = [
    { id: "card", kind: "characters", name: "Kartu" }, { id: "map", kind: "map", name: "Peta" }, { id: "board", kind: "board", name: "Brainstorm" },
    { id: "jejaring", kind: "jejaring", name: "Tree" }, { id: "timeline", kind: "timeline", name: "Timeline" },
    { id: "scene", kind: "scene", name: "Scene" }, { id: "story", kind: "story", name: "Cerita" },
  ];
  const LIST_NAMES = { characters: "Kartu", locations: "Kartu", notes: "Kartu", factions: "Kartu", items: "Kartu", creatures: "Kartu", cultures: "Kartu", magic: "Kartu", history: "Kartu", map: "Peta", board: "Papan brainstorm", jejaring: "Tree Relations", timeline: "Timeline", scene: "Scene", story: "Cerita Quill" };
  const NEW_NAMES = { characters: "karakter", locations: "lokasi", notes: "catatan", map: "peta", board: "papan brainstorm", jejaring: "tree", timeline: "timeline", scene: "scene", story: "cerita" };
  // sampul Quill (salinan warna preset quill.js, untuk pratinjau kartu cerita)
  const COVERS = { midnight: ["#1c1f3b"], ink: ["#141418"], wine: ["#4b1627"], forest: ["#173a2b"], ocean: ["#123552"], clay: ["#7a3b26"], sand: ["#d8c49c"],
    cream: ["#efe6d1"], dusk: ["#3b1f4a", "#b04a5a"], aurora: ["#0e2a3b", "#1f6f6a", "#93cfa2"], ember: ["#2a0e0a", "#b8472a"], nebula: ["#140f30", "#3d2b7c", "#c2709c"],
    gold: ["#33240f", "#c99b4b"], frost: ["#e3ecf5", "#a9bfd6"] };
  // warna bioma peta (salinan map-core.js, untuk gambar mini peta)
  const BIOME_RGB = ["#3f7396", "#b8c676", "#cdbb6c", "#5f8b46", "#46694a", "#3d7a33", "#8b9b62", "#e4ca91", "#d6dad6", "#d69b63", "#8e897f"]
    .map((x) => [parseInt(x.slice(1, 3), 16), parseInt(x.slice(3, 5), 16), parseInt(x.slice(5, 7), 16)]);

  // ---------- util ----------
  const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
  const num = (v, d) => (typeof v === "number" && isFinite(v) ? v : d);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");
  const uid = (p) => p + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const lsGet = (k) => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage diblokir: cukup di memori */ } };
  const reduceMotion = () => document.body.classList.contains("perf-boost") || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const dur = (ms) => (reduceMotion() ? 0 : ms);
  const validVp = (v) => isObj(v) && isFinite(v.x) && isFinite(v.y) && isFinite(v.zoom) && v.zoom >= MIN_Z && v.zoom <= MAX_Z;
  const fsScale = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--fs-scale")) || 1;
  const isEditable = (t) => !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ""));
  const hasXY = (e) => isFinite(e.x) && isFinite(e.y);
  const fmt = (n) => Number(n || 0).toLocaleString((window.NovelI18n ? NovelI18n.locale : "id-ID"));
  const wordsOf = (t) => (t ? t.split(" ").length : 0);
  const ROMAN = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
  const roman = (n) => { let s = ""; ROMAN.forEach(([v, r]) => { while (n >= v) { s += r; n -= v; } }); return s || "I"; };
  function hashUnit(s, salt) {   // 0..1 yang tetap untuk id yang sama (posisi titik jejak deterministik)
    let x = 2166136261 ^ salt;
    for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); }
    return ((x >>> 0) % 10000) / 10000;
  }
  // "3 hari lalu" (lebih dari 30 hari: tanggalnya)
  function ago(t) {
    if (!t) return "";
    const s = (Date.now() - t) / 1000;
    if (s < 60) return "baru saja";
    if (s < 3600) return Math.floor(s / 60) + " menit lalu";
    if (s < 86400) return Math.floor(s / 3600) + " jam lalu";
    if (s < 86400 * 30) return Math.floor(s / 86400) + " hari lalu";
    try { return new Date(t).toLocaleDateString((window.NovelI18n ? NovelI18n.locale : "id-ID"), { day: "numeric", month: "short", year: "numeric" }); } catch (e) { return ""; }
  }
  // HTML scene -> teks polos (untuk kartu hover & jumlah kata)
  const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " " };
  const plain = (html) => String(html || "").replace(/<(br|\/p|\/div|\/li|\/h\d)[^>]*>/gi, " ").replace(/<[^>]*>/g, "")
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m, k) => ENT[k]).replace(/\s+/g, " ").trim();
  // ikon Tabler (nama ditulis lengkap "#ti-NAMA" supaya tools/build-icons.mjs menemukannya)
  const ic = (href, size) => h("svg", { className: "ti", width: size || 16, height: size || 16, "aria-hidden": "true", focusable: "false" }, h("use", { href }));
  const icS = (href, size) => `<svg class="ti" width="${size || 16}" height="${size || 16}" aria-hidden="true" focusable="false"><use href="${href}"></use></svg>`;
  const kStyle = (kind) => { const K = KINDS[kind] || KINDS.scene; return { "--kc": K.c, "--kcl": K.cl }; };
  const kAttr = (kind) => { const K = KINDS[kind] || KINDS.scene; return `--kc:${K.c};--kcl:${K.cl}`; };

  // ---------- state modul ----------
  let ctx = null;             // dari app.js: { project, onChange, getCurrentSceneId, openScene, openDoc, createDoc, onOpen, closeTab, preview, toggleTheme }
  let projId = null;
  let dataRef = null;         // p.data saat show() terakhir (diganti = versi project lain dimuat)
  let host = null, dom = null; // #homeCanvas & elemen panel
  let root = null;            // React root kanvas
  let board = null;           // papan aktif (objek di p.data.canvas.boards)
  let rev = 0, pendingSel = null;
  let tool = "select", space = false;
  // tombol pengubah dilacak sendiri (bukan useKeyPress React Flow): body.nokey membuat React Flow melewatkan keyup
  // sehingga Ctrl/Shift bisa "tersangkut" setelah pintasan seperti Ctrl+Z (Shift+seret jadi geser)
  let mods = { shift: false, meta: false, multi: false };
  let shapeKind = "rect", shapeColor = "slate", noteColor = "yellow";
  let api = null;             // dari komponen App: { rf, store, setNodes, setEdges, setEditing }
  let editingNow = null;
  let clip = null, pasteN = 0, pasteTimer = null;
  let lastCreate = null, lastNudge = 0, rzSnap = null;
  let menu = null;            // { kind, anchor }
  let ctxPos = null;          // posisi flow klik kanan (untuk "... di sini")
  let toastTimer = null, zoomShown = "";
  let bare = lsGet("novelist_hc_bare") === true;          // "Sembunyikan antarmuka"
  let mini = lsGet("novelist_hc_minimap") === true;
  let bound = false;
  let tf = { hide: {}, threads: true, parents: true };     // filter jejak (per project, per perangkat)
  let dm = { kind: "characters", q: "" };                  // daftar alat Dokumen yang sedang dibuka
  let pendingDoc = null;      // { kind, ref } kartu yang menunggu ditaruh (alat Dokumen)
  let pendingCard = null;     // dokumen yang dibuat di tab lain (Jejaring): kartunya ditaruh saat Beranda tampil lagi
  let kbdClick = false;       // klik terakhir dari keyboard (Enter/Spasi) -> kartu langsung di tengah layar
  const freshKeys = new Map(); // dokumen yang baru masuk jejak -> titiknya dianimasikan saat muncul
  let freshTimer = 0;
  let trackTimer = 0, trackP = null;
  let ixC = null, ixRev = -1;
  const hist = new Map();     // "<project>|<papan>" -> { undo: [], redo: [] }

  const cvs = () => ctx.project.data.canvas;
  const save = () => { if (ctx) ctx.onChange(); };
  const findNode = (id) => board && board.nodes.find((n) => n.id === id);
  const vpKey = (b) => "novelist_hcvp_" + projId + "_" + b.id;
  // buka scene di Tulis setelah event selesai (pindah tab melepas kanvas React; jangan di tengah handler React)
  const openScene = (id) => setTimeout(() => { if (ctx) ctx.openScene(id); }, 0);

  // ---------- jejak: kunci & id node ----------
  const tkey = (e) => e.kind + ":" + e.id;
  const tid = (e) => (e.kind === "scene" ? "s:" : "t:" + e.kind + ":") + e.id;
  const trailArr = () => { const c = ctx && ctx.project.data.canvas; return c && Array.isArray(c.trail) ? c.trail : []; };
  const trailById = (nid) => trailArr().find((e) => tid(e) === nid) || null;
  const findAny = (id) => findNode(id) || (board && board.id === HOME_ID ? trailById(id) : null);

  // ================= DATA: validasi / perbaikan / migrasi =================
  function cleanNode(n) {
    if (!isObj(n) || !TYPES.includes(n.t)) return null;
    const o = { id: typeof n.id === "string" && n.id && n.id.length <= 120 ? n.id : uid("n"), t: n.t, x: Math.round(clamp(num(n.x, 0), -1e6, 1e6)), y: Math.round(clamp(num(n.y, 0), -1e6, 1e6)) };
    const size = (lo, hi, dw, dh) => { o.w = Math.round(clamp(num(n.w, dw), lo, hi)); o.h = Math.round(clamp(num(n.h, dh), lo, hi)); };
    switch (n.t) {
      case "scene":
        if (typeof n.sceneId !== "string" || !n.sceneId) return null;
        o.sceneId = n.sceneId; o.id = "s:" + n.sceneId;
        break;
      case "shape": o.shape = SHAPES.includes(n.shape) ? n.shape : "rect"; o.color = COLORS[n.color] ? n.color : "slate"; o.text = str(n.text, 2000); size(20, 4000, 160, 110); break;
      case "note": o.color = NOTE_COLORS[n.color] ? n.color : "yellow"; o.text = str(n.text, 5000); size(40, 3000, 200, 200); break;
      case "image": if (typeof n.src !== "string" || !DATA_IMG.test(n.src)) return null; o.src = n.src; size(20, 4000, 280, 200); break;
      case "text": o.text = str(n.text, 5000); o.size = TEXT_SIZES[n.size] ? n.size : "m"; o.w = Math.round(clamp(num(n.w, 240), 30, 4000)); break;
      case "frame": o.title = str(n.title, 120); o.color = COLORS[n.color] ? n.color : ""; size(60, 10000, 520, 340); break;
      case "doc":
        if (!CARD_KINDS.includes(n.kind) || typeof n.ref !== "string" || !n.ref || n.ref.length > 200) return null;
        o.kind = n.kind; o.ref = n.ref; size(100, 3000, DEF.doc.w, DEF.doc.h);
        break;
    }
    return o;
  }
  // loose (papan Beranda): penghubung ke titik jejak ("s:" / "t:") diterima dulu, dicek lagi setelah jejak dicocokkan
  function cleanBoard(b) {
    if (!isObj(b)) return null;
    const id = typeof b.id === "string" && b.id && b.id.length <= 80 ? b.id : uid("b");
    const loose = id === HOME_ID;
    const nodes = [], ids = new Set();
    (Array.isArray(b.nodes) ? b.nodes : []).forEach((n) => { const c = cleanNode(n); if (c && !ids.has(c.id)) { ids.add(c.id); nodes.push(c); } });
    const okId = (x) => ids.has(x) || (loose && /^(s|t):/.test(x));
    const edges = [], eids = new Set(), pairs = new Set();
    (Array.isArray(b.edges) ? b.edges : []).forEach((e) => {
      if (!isObj(e)) return;
      const s = String(e.source || ""), t = String(e.target || "");
      if (!okId(s) || !okId(t) || s === t || pairs.has(s + ">" + t)) return;
      const eid = typeof e.id === "string" && e.id && e.id.length <= 120 && !eids.has(e.id) ? e.id : uid("e");
      eids.add(eid); pairs.add(s + ">" + t);
      const o = { id: eid, source: s, target: t, label: str(e.label, 200) };
      if (e.style === "thread") o.style = "thread";
      edges.push(o);
    });
    const title = typeof b.title === "string" && b.title.trim() ? b.title.trim().slice(0, 80) : (id === HOME_ID ? "Beranda" : "Papan");
    const vp = validVp(b.viewport) ? { x: Math.round(b.viewport.x), y: Math.round(b.viewport.y), zoom: +(+b.viewport.zoom).toFixed(3) } : null;
    return { id, title, nodes, edges, viewport: vp, seq: b.seq !== false };
  }
  // kerangka p.data.canvas tanpa membersihkan papan (dipakai track(): papan yang sedang tampil tidak boleh diganti objeknya)
  function shellOf(p) {
    const d = p.data;
    if (!isObj(d.canvas)) d.canvas = { v: 1, active: HOME_ID, boards: [] };
    const c = d.canvas;
    if (!Array.isArray(c.boards)) c.boards = [];
    let home = c.boards.find((b) => isObj(b) && b.id === HOME_ID);
    if (!home) { home = { id: HOME_ID, title: "Beranda", nodes: [], edges: [], viewport: null, seq: false }; c.boards.unshift(home); }
    if (!Array.isArray(home.nodes)) home.nodes = [];
    if (!Array.isArray(home.edges)) home.edges = [];
    return c;
  }
  // dipanggil tiap show(): p.data.canvas dibuat / diperbaiki (diam-diam, tidak menandai project berubah)
  function canvasOf(p) {
    const d = p.data;
    let c = d.canvas;
    if (!isObj(c)) c = d.canvas = { v: 1, active: HOME_ID, boards: [] };
    const seen = new Set();
    c.boards = (Array.isArray(c.boards) ? c.boards : []).map(cleanBoard).filter((b) => b && !seen.has(b.id) && seen.add(b.id));
    let home = c.boards.find((b) => b.id === HOME_ID);
    if (!home) { home = { id: HOME_ID, title: "Beranda", nodes: [], edges: [], viewport: null, seq: false }; c.boards.unshift(home); }
    else if (c.boards[0] !== home) { c.boards.splice(c.boards.indexOf(home), 1); c.boards.unshift(home); }
    if (typeof c.active !== "string" || !c.boards.some((b) => b.id === c.active)) c.active = HOME_ID;
    c.v = 1;
    return c;
  }
  // scene project (urut seperti binder) + jalur folder/bab-nya
  function sceneInfo() {
    const map = new Map(), order = [];
    const walk = (list, path) => (list || []).forEach((n) => {
      if (!n) return;
      if (n.type === "folder") walk(n.children, path.concat(String(n.title || "").trim() || "Folder"));
      else { map.set(n.id, { s: n, path, i: order.length }); order.push(n); }
    });
    walk(ctx.project.data.scenes, []);
    return { map, order };
  }
  // cocokkan papan dengan daftar scene: rujukan scene yang dihapus dibuang. Beranda tidak lagi berisi node scene
  // (scene tampil sebagai titik jejak) — node scene lama di Beranda sudah dipindah ke jejak saat penyemaian.
  function syncScenes(b, info) {
    const before = b.nodes.length;
    b.nodes = b.nodes.filter((n) => n.t !== "scene" || (b.id !== HOME_ID && info.map.has(n.sceneId)));
    if (b.nodes.length !== before && b.id !== HOME_ID) {
      const ids = new Set(b.nodes.map((n) => n.id));
      b.edges = b.edges.filter((e) => ids.has(e.source) && ids.has(e.target));
    }
  }

  // ================= DOKUMEN PROJECT (indeks untuk jejak, kartu & daftar alat Dokumen) =================
  function flatScenes(list, out) {
    out = out || [];
    (Array.isArray(list) ? list : []).forEach((n) => { if (!isObj(n)) return; if (n.type === "folder") flatScenes(n.children, out); else out.push(n); });
    return out;
  }
  // semua dokumen project (urut: naskah, Organize, timeline, peta, cerita & chapter, jejaring, papan)
  // r = { kind, id, key, title, obj, i, parent ("folder:<id>" / "story:<id>"), path?, si?, ci? }
  function docIndex(p) {
    const d = (p && p.data) || {}, list = [], map = new Map();
    const add = (kind, id, title, obj, extra) => {
      if (typeof id !== "string" || !id || id.length > 200) return;
      const key = kind + ":" + id;
      if (map.has(key)) return;
      const r = Object.assign({ kind, id, key, title: String(title == null ? "" : title).trim(), obj, i: list.length, parent: null }, extra);
      map.set(key, r); list.push(r);
    };
    let si = 0;
    const walk = (arr, path, parent) => (Array.isArray(arr) ? arr : []).forEach((n) => {
      if (!isObj(n)) return;
      if (n.type === "folder") { add("folder", n.id, n.title, n, { path, parent }); walk(n.children, path.concat(String(n.title || "").trim() || "Bab"), "folder:" + n.id); }
      else add("scene", n.id, n.title, n, { path, parent, si: si++ });
    });
    walk(d.scenes, [], null);
    const org = isObj(d.organize) ? d.organize : {};
    ORG.forEach((c) => (Array.isArray(org[c]) ? org[c] : []).forEach((x) => { if (isObj(x)) add(c, x.id, x.title, x); }));
    (Array.isArray(d.timelines) ? d.timelines : []).forEach((t) => { if (isObj(t)) add("timeline", t.id, t.title, t); });
    (Array.isArray(d.maps) ? d.maps : []).forEach((m) => { if (isObj(m)) add("map", m.id, m.title, m); });
    const stories = isObj(d.quill) && Array.isArray(d.quill.stories) ? d.quill.stories : [];
    stories.forEach((s) => {
      if (!isObj(s)) return;
      add("story", s.id, s.title, s);
      (Array.isArray(s.chapters) ? s.chapters : []).forEach((c, i) => { if (isObj(c)) add("chapter", c.id, String(c.title || "").trim() || "Chapter " + roman(i + 1), c, { parent: "story:" + s.id, ci: i }); });
    });
    const jj = isObj(d.jejaring) && Array.isArray(d.jejaring.docs) ? d.jejaring.docs : [];
    jj.forEach((x) => { if (isObj(x)) add("jejaring", x.id, x.title, x); });
    const boards = isObj(d.canvas) && Array.isArray(d.canvas.boards) ? d.canvas.boards : [];
    boards.forEach((b) => { if (isObj(b) && b.id !== HOME_ID) add("board", b.id, b.title, b); });
    // foto tokoh dari Jejaring Tokoh (kartu yang tertaut ke karakter Organize) -> potret di kartu Karakter
    const photo = new Map();
    jj.forEach((x) => (isObj(x) && Array.isArray(x.sheets) ? x.sheets : []).forEach((s) => (isObj(s) && Array.isArray(s.nodes) ? s.nodes : []).forEach((n) => {
      if (isObj(n) && n.t === "person" && typeof n.charId === "string" && typeof n.photo === "string" && IMG_URL.test(n.photo) && !photo.has(n.charId)) photo.set(n.charId, n.photo);
    })));
    return { list, map, photo };
  }
  function curIx() { if (!ixC || ixRev !== rev) { ixC = docIndex(ctx.project); ixRev = rev; } return ixC; }
  function docTitle(r) {
    if (!r) return "";
    if (r.title) return r.title;
    return r.kind === "story" ? "Cerita tanpa judul" : r.kind === "board" ? "Papan" : "(tanpa judul)";
  }
  const jjPeople = (o) => {
    const out = [], seen = new Set();
    (Array.isArray(o.sheets) ? o.sheets : []).forEach((s) => (isObj(s) && Array.isArray(s.nodes) ? s.nodes : []).forEach((n) => {
      if (isObj(n) && n.t === "person" && !seen.has(n.id)) { seen.add(n.id); out.push(n); }
    }));
    return out;
  };
  const personName = (n, ix) => { const c = n.charId && ix.map.get("characters:" + n.charId); return (c && c.title) || String(n.name || "").trim() || "Tokoh"; };
  // ringkasan dokumen untuk kartu hover & kartu dokumen: { path, snip, meta, status? }
  function docMeta(r, ix) {
    const o = r.obj || {};
    switch (r.kind) {
      case "scene": {
        const txt = plain(o.content), syn = String(o.synopsis || "").trim();
        return { path: ((r.path || []).length ? r.path.join(" / ") + " · " : "") + "#" + ((r.si || 0) + 1), snip: syn || txt, meta: fmt(wordsOf(txt)) + " kata", status: STATUS[o.status] ? o.status : "todo" };
      }
      case "folder": {
        const sc = flatScenes(o.children), w = sc.reduce((a, s) => a + wordsOf(plain(s.content)), 0);
        return { path: (r.path || []).join(" / ") || "Naskah", snip: sc.slice(0, 4).map((s) => String(s.title || "").trim()).filter(Boolean).join(" · "), meta: sc.length + " scene · " + fmt(w) + " kata" };
      }
      case "characters": case "locations": case "notes": case "factions": case "items": case "creatures": case "cultures": case "magic": case "history":
        return { path: "Kodeks · " + KINDS[r.kind].name, snip: plain(o.content), meta: "" };
      case "timeline": {
        const ev = Array.isArray(o.events) ? o.events.filter(isObj) : [], ys = ev.map((e) => e.year).filter((y) => typeof y === "number" && isFinite(y));
        return { path: "Timeline", snip: ev.slice(0, 4).map((e) => String(e.title || "").trim()).filter(Boolean).join(" · "), meta: ev.length + " peristiwa" + (ys.length ? " · " + Math.min(...ys) + "–" + Math.max(...ys) : "") };
      }
      case "map": {
        const pl = Array.isArray(o.places) ? o.places.filter(isObj) : [], zn = Array.isArray(o.zones) ? o.zones.length : 0;
        return { path: "Peta", snip: pl.slice(0, 5).map((x) => String(x.name || "").trim()).filter(Boolean).join(" · "), meta: pl.length + " tempat · " + zn + " wilayah" };
      }
      case "story": {
        const ch = Array.isArray(o.chapters) ? o.chapters.filter(isObj) : [], w = ch.reduce((a, c) => a + wordsOf(plain(c.html)), 0);
        return { path: "Quill" + (o.author ? " · oleh " + String(o.author).trim() : ""), snip: ch.slice(0, 4).map((c, i) => String(c.title || "").trim() || "Chapter " + roman(i + 1)).join(" · "), meta: ch.length + " chapter · " + fmt(w) + " kata" };
      }
      case "chapter": {
        const txt = plain(o.html), s = ix && ix.map.get(r.parent);
        return { path: s ? docTitle(s) : "Quill", snip: txt, meta: fmt(wordsOf(txt)) + " kata" };
      }
      case "jejaring": {
        const ppl = jjPeople(o);
        return { path: "Tree Relations", snip: ppl.slice(0, 6).map((n) => personName(n, ix)).join(" · "), meta: ppl.length + " tokoh · " + (Array.isArray(o.sheets) ? o.sheets.length : 0) + " lembar" };
      }
      case "board": return { path: "Papan kanvas", snip: "", meta: (Array.isArray(o.nodes) ? o.nodes.length : 0) + " objek" };
    }
    return { path: "", snip: "", meta: "" };
  }
  // waktu dibuat dari dokumennya: createdAt (cerita) atau Date.now() yang tertanam di id ("scene-1712..." / base36 uid)
  const okTs = (t) => t > 1.2e12 && t < Date.now() + 864e5;
  function idTs(r) {
    const o = r.obj;
    if (o && typeof o.createdAt === "string") { const t = Date.parse(o.createdAt); if (okTs(t)) return t; }
    const s = String(r.id);
    let m = s.match(/-(\d{13})/);
    if (m && okTs(+m[1])) return +m[1];
    m = s.match(/^[a-z]+-([0-9a-z]{8})[0-9a-z]{3,7}$/);
    if (m) { const t = parseInt(m[1], 36); if (okTs(t)) return t; }
    return 0;
  }

  // ================= JEJAK: cocokkan dengan isi project & tata letak titik =================
  // Hasil: { seeded, added: [kunci baru], removed }. Tidak memanggil save(): dokumen baru/terhapus sudah menandai project.
  function syncTrail(p) {
    const c = shellOf(p), ix = docIndex(p), home = c.boards.find((b) => isObj(b) && b.id === HOME_ID);
    const res = { seeded: false, added: [], removed: 0 };
    if (!Array.isArray(c.trail)) {
      // semai sekali: urut waktu di id, posisi titik scene Beranda lama dipakai, node scene lama pindah ke jejak
      const pos = new Map();
      home.nodes.forEach((n) => { if (isObj(n) && n.t === "scene" && typeof n.sceneId === "string" && isFinite(n.x) && isFinite(n.y)) pos.set(n.sceneId, n); });
      c.trail = ix.list.map((r) => ({ r, ts: idTs(r) })).sort((a, b) => a.ts - b.ts || a.r.i - b.r.i).map(({ r, ts }) => {
        const e = { kind: r.kind, id: r.id, at: ts };
        const s = r.kind === "scene" && pos.get(r.id);
        if (s) { e.x = Math.round(s.x); e.y = Math.round(s.y); }
        return e;
      });
      home.nodes = home.nodes.filter((n) => !isObj(n) || n.t !== "scene");
      home.seq = false;   // garis urutan scene lama jadi pilihan di menu "…"
      res.seeded = true;
    } else {
      const seen = new Set(), before = c.trail.length;
      c.trail = c.trail.filter((e) => {
        if (!isObj(e) || !KINDS[e.kind] || typeof e.id !== "string") return false;
        const k = tkey(e);
        if (seen.has(k) || !ix.map.has(k)) return false;
        seen.add(k);
        if (typeof e.at !== "number" || !isFinite(e.at)) e.at = 0;
        if (hasXY(e)) { e.x = Math.round(clamp(e.x, -1e6, 1e6)); e.y = Math.round(clamp(e.y, -1e6, 1e6)); } else { delete e.x; delete e.y; }
        return true;
      });
      res.removed = before - c.trail.length;
      const now = Date.now();
      ix.list.forEach((r) => {
        if (seen.has(r.key)) return;
        const ts = idTs(r), e = { kind: r.kind, id: r.id, at: ts && ts <= now ? ts : now };
        let i = c.trail.length;
        while (i > 0 && c.trail[i - 1].at > e.at) i--;
        c.trail.splice(i, 0, e);
        res.added.push(r.key);
      });
    }
    placeMissing(c, home);
    return res;
  }
  // titik baru: dekat titik sebelumnya (urut waktu), jalur berkelok seperti ular (7 titik per baris, lalu turun & balik
  // arah), sudut & jarak sedikit acak tapi tetap (hash id), tidak menabrak titik / objek lain
  const ROW = 7;
  function placeMissing(c, home) {
    const T = c.trail, pts = T.filter(hasXY);
    if (pts.length === T.length) return false;
    const rects = (home.nodes || []).filter(isObj).map((n) => ({ x: num(n.x, 0), y: num(n.y, 0), w: num(n.w, SCENE_W), h: num(n.h, 40) }));
    const clash = (x, y) => pts.some((q) => Math.abs(q.x - x) < 140 && Math.abs(q.y - y) < 62)
      || rects.some((r) => x + SCENE_W > r.x - 16 && x < r.x + r.w + 16 && y + 44 > r.y - 16 && y < r.y + r.h + 16);
    T.forEach((e, i) => {
      if (hasXY(e)) return;
      let prev = null;
      for (let j = i - 1; j >= 0 && !prev; j--) if (hasXY(T[j])) prev = T[j];
      const p = prev ? stepFrom(prev, i, tkey(e), clash) : firstSpot(pts, rects, clash);
      e.x = p.x; e.y = p.y;
      pts.push(e);
    });
    return true;
  }
  function stepFrom(prev, i, key, clash) {
    const col = i % ROW, row = Math.floor(i / ROW);
    const base = col === 0 ? Math.PI / 2 : row % 2 ? Math.PI : 0;
    const a0 = base + (hashUnit(key, 7) - 0.5) * 0.8, s0 = 168 + hashUnit(key, 11) * 44;
    for (let k = 0; k < 36; k++) {
      const a = a0 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.4, s = s0 + Math.floor(k / 12) * 80;
      const x = Math.round(prev.x + Math.cos(a) * s), y = Math.round(prev.y + Math.sin(a) * s * 0.72);
      if (!clash(x, y)) return { x, y };
    }
    return { x: Math.round(prev.x + s0), y: Math.round(prev.y + 130) };
  }
  function firstSpot(pts, rects, clash) {
    if (!pts.length && !rects.length) return { x: -SCENE_W / 2, y: -DOT_CY };
    const xs = pts.map((q) => q.x).concat(rects.map((r) => r.x)), ys = pts.map((q) => q.y).concat(rects.map((r) => r.y));
    let x = Math.min(...xs) - 220, y = Math.min(...ys);
    for (let k = 0; k < 60 && clash(x, y); k++) y += 70;
    return { x: Math.round(x), y: Math.round(y) };
  }
  // penghubung Beranda yang ujungnya tidak ada lagi (titik jejak dokumen yang dihapus) dibuang
  function pruneHome() {
    const c = ctx && ctx.project.data.canvas, home = c && Array.isArray(c.boards) && c.boards.find((b) => isObj(b) && b.id === HOME_ID);
    if (!home || !Array.isArray(home.edges)) return false;
    const ids = new Set(home.nodes.map((n) => n.id));
    trailArr().forEach((e) => ids.add(tid(e)));
    const before = home.edges.length;
    home.edges = home.edges.filter((e) => ids.has(e.source) && ids.has(e.target));
    return home.edges.length !== before;
  }
  function markFresh(keys) {
    if (!keys.length) return;
    const now = Date.now();
    keys.forEach((k) => freshKeys.set(k, now));
  }
  // cocokkan jejak project yang sedang tampil sekarang juga (dokumen baru dibuat dari Beranda, papan dihapus, ...)
  function syncNow() {
    if (!ctx) return null;
    clearTimeout(trackTimer); trackTimer = 0; trackP = null;
    const res = syncTrail(ctx.project);
    markFresh(res.added);
    if (res.seeded || res.added.length || res.removed) pruneHome();
    return res;
  }
  // dari app.js (markDirtyAndSchedule): project berubah -> cek dokumen baru/terhapus sebentar kemudian
  function runTrack() {
    clearTimeout(trackTimer); trackTimer = 0;
    const p = trackP;
    trackP = null;
    if (!p || !p.data) return;
    const res = syncTrail(p);
    markFresh(res.added);
    const shown = isShown() && ctx.project === p;
    if (!shown) return;
    if (res.seeded || res.added.length || res.removed) {
      pruneHome();
      if (board && board.id === HOME_ID) { rev++; renderFlow(); scheduleFreshClear(); }
      updateChrome();
    }
  }
  function scheduleFreshClear() { clearTimeout(freshTimer); freshTimer = setTimeout(() => freshKeys.clear(), 2400); }

  // ================= RIWAYAT (urungkan / ulangi) =================
  const snap = () => ({
    nodes: board.nodes.map((n) => ({ ...n })), edges: board.edges.map((e) => ({ ...e })),
    tp: board.id === HOME_ID ? trailArr().map((e) => [tkey(e), e.x, e.y]) : null,   // posisi titik jejak
  });
  function H() { const k = projId + "|" + board.id; let x = hist.get(k); if (!x) hist.set(k, (x = { undo: [], redo: [] })); return x; }
  function pushUndo(s) { const x = H(); x.undo.push(s); if (x.undo.length > 80) x.undo.shift(); x.redo.length = 0; }
  function restore(s) {
    board.nodes = s.nodes; board.edges = s.edges;
    if (s.tp) { const m = new Map(s.tp.map((a) => [a[0], a])); trailArr().forEach((e) => { const a = m.get(tkey(e)); if (a && isFinite(a[1]) && isFinite(a[2])) { e.x = a[1]; e.y = a[2]; } }); }
    syncScenes(board, sceneInfo());
    if (board.id === HOME_ID) pruneHome();
    changed([]);
  }
  function undo() { if (!board) return; const x = H(); if (!x.undo.length) { toast("Tidak ada yang bisa diurungkan."); return; } x.redo.push(snap()); restore(x.undo.pop()); lastCreate = null; }
  function redo() { if (!board) return; const x = H(); if (!x.redo.length) { toast("Tidak ada yang bisa diulangi."); return; } x.undo.push(snap()); restore(x.redo.pop()); }
  // perubahan data -> bangun ulang node, simpan (debounce di app.js), segarkan panel
  function changed(sel) { rev++; pendingSel = sel || null; renderFlow(); save(); updateChrome(); }
  function mutate(fn, sel) { const s = snap(); if (fn() === false) return false; pushUndo(s); changed(sel); return true; }

  // ================= REACT FLOW: node =================
  const UiCtx = React.createContext({ tool: "select", editing: null, setEditing: () => {}, dragging: false });
  // pegangan penghubung (menutupi objek); hanya bisa dipakai saat alat Penghubung aktif (isConnectable dari React Flow)
  const Hdl = (on, cls) => h(RF.Handle, { type: "source", position: RF.Position.Top, id: "c", isConnectable: !!on, className: "hc-handle" + (cls ? " " + cls : "") });
  const Rz = (id, minW, minH, keep) => h(RF.NodeResizer, {
    minWidth: minW, minHeight: minH, keepAspectRatio: !!keep, lineClassName: "hc-rz-line", handleClassName: "hc-rz-handle",
    onResizeStart: () => { rzSnap = snap(); closeMenu(); },
    onResizeEnd: (e, p) => resizeEnd(id, p),
  });
  const ResizeW = (id) => h(RF.NodeResizeControl, { position: "right", variant: RF.ResizeControlVariant.Line, minWidth: MIN.text.w, className: "hc-rz-w",
    onResizeStart: () => { rzSnap = snap(); closeMenu(); }, onResizeEnd: (e, p) => resizeEnd(id, p) });
  function resizeEnd(id, p) {
    const m = findNode(id);
    const s = rzSnap; rzSnap = null;
    if (!m || !s) return;
    m.x = Math.round(p.x); m.y = Math.round(p.y); m.w = Math.round(p.width);
    if (m.t !== "text") m.h = Math.round(p.height);
    pushUndo(s); save(); updateChrome();
  }

  // kolom edit teks (klik dua kali / Enter). Uncontrolled; ketikan langsung masuk data (liveInput, jeda singkat) supaya
  // ikut autosave walau kolomnya belum ditutup. Selesai: blur, Esc, Ctrl+Enter.
  function EditArea({ id, value, single, className, autoGrow }) {
    const ref = React.useRef(null), done = React.useRef(false);
    React.useEffect(() => {
      let n = 0, raf = 0;
      const go = () => {   // node baru tampil setelah diukur React Flow -> fokus dicoba beberapa frame
        const t = ref.current;
        if (!t) return;
        t.focus({ preventScroll: true });
        if (document.activeElement === t) { const L = t.value.length; try { t.setSelectionRange(L, L); } catch (e) { /* abaikan */ } grow(); }
        else if (n++ < 40) raf = requestAnimationFrame(go);
      };
      go();
      return () => cancelAnimationFrame(raf);
    }, []);
    const grow = () => { const t = ref.current; if (autoGrow && t) { t.style.height = "auto"; t.style.height = t.scrollHeight + "px"; } };
    const fin = () => { if (done.current) return; done.current = true; commitEdit(id, ref.current ? ref.current.value : value, false); };
    return h(single ? "input" : "textarea", {
      ref, className: "hc-edit nodrag nopan nowheel " + (className || ""), defaultValue: value || "", "data-id": id,
      spellCheck: true, "aria-label": "Edit teks", maxLength: single ? 200 : 5000, onBlur: fin,
      onInput: (e) => { grow(); if (!done.current) liveInput(id, e.currentTarget.value); },
      onKeyDown: (e) => {
        e.stopPropagation();
        if (e.key === "Escape" || ((e.metaKey || e.ctrlKey) && e.key === "Enter") || (single && e.key === "Enter")) { e.preventDefault(); fin(); }
      },
      onPointerDown: (e) => e.stopPropagation(), onDoubleClick: (e) => e.stopPropagation(),
    });
  }

  function SceneTip({ data }) {
    const s = data.s, st = STATUS[s.status] ? s.status : "todo";
    const txt = plain(s.content), syn = String(s.synopsis || "").trim();
    const src = syn || txt, snip = src.slice(0, 160);
    const words = txt ? txt.split(" ").length : 0;
    return h("div", { className: "hc-tip-card" },
      h("div", { className: "hc-tip-top" },
        h("span", { className: "hc-tip-status is-" + st }, STATUS[st]),
        h("span", { className: "hc-tip-path" }, (data.path.length ? data.path.join(" / ") + " · " : "") + "#" + (data.idx + 1))),
      h("div", { className: "hc-tip-title" }, String(s.title || "").trim() || "(tanpa judul)"),
      h("p", { className: "hc-tip-snip" + (snip ? "" : " is-empty") }, snip ? snip + (src.length > 160 ? "…" : "") : "Belum ada sinopsis atau isi."),
      h("div", { className: "hc-tip-foot" }, words.toLocaleString((window.NovelI18n ? NovelI18n.locale : "id-ID")) + " kata · klik untuk menulis"));
  }
  // node scene di papan selain Beranda (di Beranda scene tampil sebagai titik jejak)
  const SceneNode = React.memo(function SceneNode({ data, selected, isConnectable }) {
    const ui = React.useContext(UiCtx);
    const [hover, setHover] = React.useState(false);
    const s = data.s, st = STATUS[s.status] ? s.status : "todo";
    const tip = hover && ui.tool === "select" && !ui.dragging;
    return h("div", {
      className: "hc-scene" + (selected ? " is-sel" : "") + (data.current ? " is-current" : ""),
      onPointerEnter: (e) => { if (e.pointerType !== "touch") setHover(true); }, onPointerLeave: () => setHover(false),
    },
      Hdl(isConnectable),
      h("span", { className: "hc-scene-dot is-" + st }),
      h("span", { className: "hc-scene-label" }, String(s.title || "").trim() || "(tanpa judul)"),
      tip ? h(RF.NodeToolbar, { isVisible: true, position: RF.Position.Bottom, offset: 4, className: "hc-tip" }, h(SceneTip, { data })) : null);
  });

  // ---------- titik jejak (semua dokumen; scene memakai warna statusnya) ----------
  function TrailTip({ data }) {
    const r = data.r, e = data.e, K = KINDS[r.kind], meta = docMeta(r, data.ix);
    const snip = String(meta.snip || "").slice(0, 170);
    return h("div", { className: "hc-tip-card" },
      h("div", { className: "hc-tip-top" },
        h("span", { className: "hc-tip-kind", style: kStyle(r.kind) }, ic(K.icon, 12), K.name),
        meta.status ? h("span", { className: "hc-tip-status is-" + meta.status }, STATUS[meta.status]) : null,
        h("span", { className: "hc-tip-path" }, meta.path)),
      h("div", { className: "hc-tip-title" }, docTitle(r)),
      snip ? h("p", { className: "hc-tip-snip" }, snip + (String(meta.snip).length > 170 ? "…" : "")) : null,
      h("div", { className: "hc-tip-foot" },
        h("span", { className: "hc-tip-when" }, ic("#ti-history", 12), e.at ? "Dibuat " + ago(e.at) : "Waktu dibuat tidak tercatat"),
        meta.meta ? h("span", null, " · " + meta.meta) : null),
      h("div", { className: "hc-tip-go" }, r.kind === "scene" ? "Klik untuk menulis" : "Klik untuk membuka"));
  }
  const TrailNode = React.memo(function TrailNode({ data, selected, isConnectable }) {
    const ui = React.useContext(UiCtx);
    const [hover, setHover] = React.useState(false);
    const r = data.r, K = KINDS[r.kind];
    const st = r.kind === "scene" ? (STATUS[r.obj.status] ? r.obj.status : "todo") : "";
    const tip = hover && ui.tool === "select" && !ui.dragging;
    return h("div", {
      className: "hc-trail is-k-" + r.kind + (st ? " is-" + st : "") + (selected ? " is-sel" : "") + (data.current ? " is-current" : "") + (data.fresh ? " is-new" : ""),
      style: kStyle(r.kind), "data-key": r.key,
      onPointerEnter: (e) => { if (e.pointerType !== "touch") setHover(true); }, onPointerLeave: () => setHover(false),
    },
      Hdl(isConnectable),
      h("span", { className: "hc-trail-dot" }, ic(K.icon, 11)),
      h("span", { className: "hc-trail-label" }, docTitle(r)),
      tip ? h(RF.NodeToolbar, { isVisible: true, position: RF.Position.Bottom, offset: 2, className: "hc-tip" }, h(TrailTip, { data })) : null);
  });

  // ---------- kartu dokumen (alat "Dokumen") ----------
  // gambar mini peta dari data tersimpan (grid bioma RLE + base64, sama dengan map-core.js) -> data URL, di-cache
  const thumbCache = new Map();
  function decodeRle(s, len) {
    const u8 = new Uint8Array(len);
    if (!s) return u8;
    const bin = atob(s);
    let p = 0, i = 0;
    while (p < bin.length && i < len) {
      const v = bin.charCodeAt(p++);
      let run = 0, shift = 0, b;
      do { b = bin.charCodeAt(p++); run |= (b & 0x7f) << shift; shift += 7; } while (b & 0x80 && p < bin.length);
      u8.fill(v, i, Math.min(len, i + run)); i += run;
    }
    return u8;
  }
  function hashStr(s) { let x = 2166136261; for (let i = 0; i < s.length; i += 3) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); } return (x >>> 0).toString(36); }
  function mapThumb(m) {
    if (!isObj(m) || typeof m.biome !== "string") return null;
    const size = Math.round(num(m.size, 128));
    if (size < 8 || size > 1024) return null;
    const pl = Array.isArray(m.places) ? m.places.filter(isObj) : [];
    const key = m.id + "|" + size + "|" + m.biome.length + "|" + hashStr(m.biome) + "|" + String(m.height || "").length + "|" + pl.length;
    if (thumbCache.has(key)) return thumbCache.get(key);
    let url = null;
    try {
      const len = size * size, bio = decodeRle(m.biome, len), hei = decodeRle(typeof m.height === "string" ? m.height : "", len);
      const S = Math.min(112, size), cv = document.createElement("canvas");
      cv.width = cv.height = S;
      const g = cv.getContext("2d"), img = g.createImageData(S, S), D = img.data;
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const i = Math.floor((y * size) / S) * size + Math.floor((x * size) / S), b = bio[i], c = BIOME_RGB[b] || BIOME_RGB[0];
        const lit = b === 0 ? 1 : 0.9 + (hei[i] / 255) * 0.35, o = (y * S + x) * 4;
        D[o] = Math.min(255, c[0] * lit); D[o + 1] = Math.min(255, c[1] * lit); D[o + 2] = Math.min(255, c[2] * lit); D[o + 3] = 255;
      }
      g.putImageData(img, 0, 0);
      g.fillStyle = "#fff"; g.strokeStyle = "rgba(0,0,0,.45)"; g.lineWidth = 1;
      pl.slice(0, 40).forEach((q) => { if (!isFinite(q.x) || !isFinite(q.y)) return; g.beginPath(); g.arc((q.x / size) * S, (q.y / size) * S, 2, 0, Math.PI * 2); g.fill(); g.stroke(); });
      url = cv.toDataURL("image/png");
    } catch (e) { url = null; }
    thumbCache.set(key, url);
    if (thumbCache.size > 60) thumbCache.delete(thumbCache.keys().next().value);
    return url;
  }
  function coverBg(b) {
    const c = (b && (COVERS[b.color] || (/^#[0-9a-f]{6}$/i.test(b.color || "") ? [b.color] : null))) || COVERS.midnight;
    return c.length > 1 ? `linear-gradient(160deg, ${c.join(", ")})` : c[0];
  }
  const initial = (t) => (String(t || "").trim().charAt(0) || "?").toUpperCase();
  function BookMini({ s, title }) {
    const b = isObj(s.book) ? s.book : {}, jk = typeof b.jacket === "string" && IMG_URL.test(b.jacket) ? b.jacket : null;
    const tc = /^#[0-9a-f]{6}$/i.test(b.titleColor || "") ? b.titleColor : "#f3ede2";
    return h("div", { className: "hc-book", style: { background: jk ? `center / cover no-repeat url("${jk}")` : coverBg(b), color: tc } },
      jk ? null : h("span", { className: "hc-book-t" }, title));
  }
  function TimelineMini({ o }) {
    const ev = (Array.isArray(o.events) ? o.events.filter(isObj) : []).filter((e) => typeof e.year === "number" && isFinite(e.year)).slice(0, 40);
    const lo = Math.min(num(o.start, 1500), ...ev.map((e) => e.year)), hi = Math.max(num(o.end, 1900), ...ev.map((e) => e.year));
    const X = (y) => 6 + ((y - lo) / Math.max(1, hi - lo)) * 108;
    return h("svg", { className: "hc-doc-svg", viewBox: "0 0 120 28", preserveAspectRatio: "none", "aria-hidden": "true" },
      h("line", { x1: 4, y1: 18, x2: 116, y2: 18, className: "hc-mini-axis" }),
      ev.map((e, i) => h("g", { key: i },
        h("line", { x1: X(e.year), y1: 18, x2: X(e.year), y2: i % 2 ? 10 : 7, className: "hc-mini-stem" }),
        h("circle", { cx: X(e.year), cy: 18, r: 2.4, fill: /^#[0-9a-f]{6}$/i.test(e.color || "") ? e.color : "#d7a86e" }))));
  }
  function PeopleMini({ o, ix }) {
    const ppl = jjPeople(o), show = ppl.slice(0, 5);
    return h("div", { className: "hc-people" },
      show.map((n) => {
        const ph = typeof n.photo === "string" && IMG_URL.test(n.photo) ? n.photo : null;
        return h("span", { key: n.id, className: "hc-person", style: ph ? { backgroundImage: `url("${ph}")` } : null }, ph ? null : (n.emoji ? String(n.emoji).slice(0, 4) : initial(personName(n, ix))));
      }),
      ppl.length > show.length ? h("span", { className: "hc-person is-more" }, "+" + (ppl.length - show.length)) : null);
  }
  function BoardMini({ b }) {
    const ns = (Array.isArray(b.nodes) ? b.nodes : []).filter((n) => isObj(n) && isFinite(n.x) && isFinite(n.y)).slice(0, 80);
    if (!ns.length) return h("div", { className: "hc-doc-svg is-empty" }, ic("#ti-layout-board", 20));
    const W = (n) => num(n.w, n.t === "scene" ? 40 : 160), Hh = (n) => num(n.h, n.t === "text" ? 30 : n.t === "scene" ? 20 : 110);
    const x0 = Math.min(...ns.map((n) => n.x)), y0 = Math.min(...ns.map((n) => n.y));
    const x1 = Math.max(...ns.map((n) => n.x + W(n))), y1 = Math.max(...ns.map((n) => n.y + Hh(n)));
    const s = Math.min(112 / Math.max(1, x1 - x0), 52 / Math.max(1, y1 - y0)), ox = (120 - (x1 - x0) * s) / 2, oy = (60 - (y1 - y0) * s) / 2;
    return h("svg", { className: "hc-doc-svg", viewBox: "0 0 120 60", "aria-hidden": "true" }, ns.map((n, i) => {
      const x = ox + (n.x - x0) * s, y = oy + (n.y - y0) * s, w = Math.max(2, W(n) * s), hh = Math.max(2, Hh(n) * s);
      if (n.t === "scene") return h("circle", { key: i, cx: x + w / 2, cy: y + 3, r: 2, className: "hc-mini-dot" });
      if (n.t === "frame") return h("rect", { key: i, x, y, width: w, height: hh, rx: 2, className: "hc-mini-frame" });
      if (n.t === "text") return h("rect", { key: i, x, y: y + hh / 2 - 1, width: w, height: 2, rx: 1, className: "hc-mini-text" });
      const fill = n.t === "note" ? NOTE_COLORS[n.color] || NOTE_COLORS.yellow : n.t === "shape" ? COLORS[n.color] || COLORS.slate : n.t === "doc" ? (KINDS[n.kind] || KINDS.scene).c : "#8f97ab";
      return h("rect", { key: i, x, y, width: w, height: hh, rx: n.t === "shape" && n.shape === "circle" ? Math.min(w, hh) / 2 : 1.5, fill, opacity: n.t === "shape" ? 0.55 : 0.92 });
    }));
  }
  function DocBody({ r, ix }) {
    const o = r.obj || {}, K = KINDS[r.kind], meta = docMeta(r, ix), title = docTitle(r);
    const T = h("div", { className: "hc-doc-title" }, title);
    const M = meta.meta ? h("div", { className: "hc-doc-meta" }, meta.meta) : null;
    const S = (txt, empty) => h("p", { className: "hc-doc-snip" + (txt ? "" : " is-empty") }, txt ? String(txt).slice(0, 420) : empty);
    switch (r.kind) {
      case "map": {
        const u = mapThumb(o);
        return h("div", { className: "hc-doc-body is-media" },
          h("div", { className: "hc-doc-thumb", style: u ? { backgroundImage: `url("${u}")` } : null }, u ? null : ic("#ti-map", 26)),
          h("div", { className: "hc-doc-cap" }, T, M));
      }
      case "story":
        return h("div", { className: "hc-doc-body is-row" }, h(BookMini, { s: o, title }),
          h("div", { className: "hc-doc-col" }, T, meta.path ? h("div", { className: "hc-doc-sub" }, meta.path) : null, M));
      case "characters": case "locations": case "notes": case "factions": case "items": case "creatures": case "cultures": case "magic": case "history": {
        const ph = (typeof o.photo === "string" && IMG_URL.test(o.photo) ? o.photo : null) || (r.kind === "characters" ? ix.photo.get(r.id) : null);
        return h("div", { className: "hc-doc-body is-row" },
          h("div", { className: "hc-doc-portrait" + (ph ? " has-photo" : ""), style: ph ? { backgroundImage: `url("${ph}")` } : null }, ph ? null : r.kind === "characters" ? initial(title) : ic(K.icon, 20)),
          h("div", { className: "hc-doc-col" }, T, S(meta.snip, "Belum ada deskripsi.")));
      }
      case "timeline": return h("div", { className: "hc-doc-body" }, T, h(TimelineMini, { o }), M);
      case "jejaring": return h("div", { className: "hc-doc-body" }, T, h(PeopleMini, { o, ix }), M);
      case "board": return h("div", { className: "hc-doc-body" }, T, h(BoardMini, { b: o }), M);
      default:
        return h("div", { className: "hc-doc-body" }, T, S(meta.snip, "Belum ada sinopsis atau isi."),
          h("div", { className: "hc-doc-meta" }, h("span", { className: "hc-doc-st is-" + meta.status }), STATUS[meta.status] + " · " + meta.meta));
    }
  }
  const DocNode = React.memo(function DocNode({ id, data, selected, isConnectable }) {
    const ui = React.useContext(UiCtx), m = data.m, r = data.r, K = KINDS[m.kind] || KINDS.scene;
    return h("div", { className: "hc-doc is-k-" + m.kind + (r ? "" : " is-gone") + (selected ? " is-sel" : ""), style: kStyle(m.kind) },
      Hdl(isConnectable),
      selected && ui.tool === "select" ? Rz(id, MIN.doc.w, MIN.doc.h) : null,
      h("div", { className: "hc-doc-head" },
        h("span", { className: "hc-doc-ic" }, ic(K.icon, 13)),
        h("span", { className: "hc-doc-kind" }, K.name),
        r ? h("span", { className: "hc-doc-open", title: "Klik dua kali untuk membuka" }, ic("#ti-arrow-up-right", 13)) : null),
      r ? h(DocBody, { r, ix: data.ix })
        : h("div", { className: "hc-doc-gone" }, ic("#ti-trash", 18), h("b", null, "Dokumen dihapus"), h("small", null, "Hapus kartu ini, atau taruh dokumen lain lewat alat Dokumen.")));
  });

  const ShapeNode = React.memo(function ShapeNode({ id, data, selected, isConnectable }) {
    const ui = React.useContext(UiCtx), m = data.m, ed = ui.editing === id;
    const poly = m.shape === "triangle" ? "50,3 97,97 3,97" : m.shape === "diamond" ? "50,2 98,50 50,98 2,50" : null;
    return h("div", { className: "hc-shape is-" + m.shape, style: { "--c": COLORS[m.color] || COLORS.slate } },
      Hdl(isConnectable),
      selected && ui.tool === "select" ? Rz(id, MIN.shape.w, MIN.shape.h) : null,
      poly ? h("svg", { className: "hc-shape-svg", viewBox: "0 0 100 100", preserveAspectRatio: "none", "aria-hidden": "true" }, h("polygon", { points: poly, vectorEffect: "non-scaling-stroke" })) : null,
      ed ? h(EditArea, { id, value: m.text, className: "hc-shape-edit" }) : h("div", { className: "hc-shape-text" }, m.text));
  });
  const NoteNode = React.memo(function NoteNode({ id, data, selected, isConnectable }) {
    const ui = React.useContext(UiCtx), m = data.m, ed = ui.editing === id;
    return h("div", { className: "hc-note", style: { "--c": NOTE_COLORS[m.color] || NOTE_COLORS.yellow } },
      Hdl(isConnectable),
      selected && ui.tool === "select" ? Rz(id, MIN.note.w, MIN.note.h) : null,
      ed ? h(EditArea, { id, value: m.text, className: "hc-note-edit" })
        : h("div", { className: "hc-note-text" }, m.text || h("span", { className: "hc-ph" }, "Klik dua kali untuk menulis…")));
  });
  const ImageNode = React.memo(function ImageNode({ id, data, selected, isConnectable }) {
    const ui = React.useContext(UiCtx);
    return h("div", { className: "hc-image" },
      Hdl(isConnectable),
      selected && ui.tool === "select" ? Rz(id, MIN.image.w, MIN.image.h, true) : null,
      h("img", { src: data.m.src, alt: "", draggable: false }));
  });
  const TextNode = React.memo(function TextNode({ id, data, selected, isConnectable }) {
    const ui = React.useContext(UiCtx), m = data.m, ed = ui.editing === id;
    return h("div", { className: "hc-textn" + (selected ? " is-sel" : ""), style: { "--fz": TEXT_SIZES[m.size] || 24 } },
      Hdl(isConnectable),
      selected && ui.tool === "select" ? ResizeW(id) : null,
      ed ? h(EditArea, { id, value: m.text, className: "hc-textn-edit", autoGrow: true })
        : h("div", { className: "hc-textn-body" }, m.text || h("span", { className: "hc-ph" }, "Teks")));
  });
  const FrameNode = React.memo(function FrameNode({ id, data, selected, isConnectable }) {
    const ui = React.useContext(UiCtx), m = data.m, ed = ui.editing === id;
    // judul & tepi pegangan frame berukuran tetap di layar (tidak ikut mengecil saat zoom jauh)
    const z = RF.useStore((st) => st.transform[2]);
    const st = { "--k": +(1 / (z || 1)).toFixed(3) };
    if (m.color) st["--c"] = COLORS[m.color];
    return h("div", { className: "hc-frame" + (m.color ? " has-c" : ""), style: st },
      Hdl(isConnectable, "hc-handle-frame"),
      selected && ui.tool === "select" ? Rz(id, MIN.frame.w, MIN.frame.h) : null,
      h("div", { className: "hc-frame-title" }, ed ? h(EditArea, { id, value: m.title, single: true, className: "hc-frame-edit" }) : (m.title || "Frame")),
      h("span", { className: "hc-frame-edge is-t" }), h("span", { className: "hc-frame-edge is-r" }),
      h("span", { className: "hc-frame-edge is-b" }), h("span", { className: "hc-frame-edge is-l" }));
  });
  const NODE_TYPES = { scene: SceneNode, trail: TrailNode, doc: DocNode, shape: ShapeNode, note: NoteNode, image: ImageNode, text: TextNode, frame: FrameNode };

  // ================= REACT FLOW: garis =================
  // garis "mengambang": menempel di tepi objek (lingkaran/belah ketupat mengikuti bentuknya), bukan di titik handle
  function anchorOf(n) {
    const w = n.width || 0, hh = n.height || 0, p = n.positionAbsolute || n.position;
    if (n.type === "scene") return { cx: p.x + w / 2, cy: p.y + DOT_CY, kind: "dot", rx: 10, ry: 10 };
    if (n.type === "trail") return { cx: p.x + w / 2, cy: p.y + DOT_CY, kind: "dot", rx: 7, ry: 7 };
    const shape = n.type === "shape" && n.data && n.data.m ? n.data.m.shape : "";
    return { cx: p.x + w / 2, cy: p.y + hh / 2, kind: shape === "circle" ? "ell" : shape === "diamond" ? "dia" : "rect", rx: w / 2, ry: hh / 2 };
  }
  function borderPt(a, tx, ty, pad) {
    const dx = tx - a.cx, dy = ty - a.cy, L = Math.hypot(dx, dy);
    if (!L) return { x: a.cx, y: a.cy };
    let s;
    if (a.kind === "dot") s = a.rx / L;
    else if (a.kind === "ell") s = 1 / Math.sqrt((dx * dx) / (a.rx * a.rx || 1) + (dy * dy) / (a.ry * a.ry || 1));
    else if (a.kind === "dia") s = 1 / (Math.abs(dx) / (a.rx || 1) + Math.abs(dy) / (a.ry || 1));
    else s = Math.min(a.rx / Math.abs(dx || 1e-6), a.ry / Math.abs(dy || 1e-6));
    s = Math.min(s, 1);
    return { x: a.cx + dx * s + (dx / L) * pad, y: a.cy + dy * s + (dy / L) * pad };
  }
  function edgeGeom(s, t, padT, padS) {
    const A = anchorOf(s), B = anchorOf(t);
    const a = borderPt(A, B.cx, B.cy, padS == null ? 3 : padS), b = borderPt(B, A.cx, A.cy, padT);
    return { a, b };
  }
  function arrowPath(a, b, L, W) {
    const ang = Math.atan2(b.y - a.y, b.x - a.x), c = Math.cos(ang), s = Math.sin(ang);
    const bx = b.x - c * L, by = b.y - s * L;
    return `M${b.x},${b.y}L${bx - s * W},${by + c * W}L${bx + s * W},${by - c * W}Z`;
  }
  function LinkEdge({ id, source, target, data, selected }) {
    const ui = React.useContext(UiCtx);
    const s = RF.useStore(React.useCallback((st) => st.nodeInternals.get(source), [source]));
    const t = RF.useStore(React.useCallback((st) => st.nodeInternals.get(target), [target]));
    if (!s || !t || !s.width || !t.width) return null;
    const seq = !!(data && data.seq);
    const { a, b } = edgeGeom(s, t, seq ? 3 : 4);
    const path = `M${a.x},${a.y}L${b.x},${b.y}`;
    if (seq) return h(RF.BaseEdge, { id, path, interactionWidth: 0 });
    const ed = ui.editing === "e:" + id, label = data && data.label, thread = !!(data && data.thread);
    let mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, d = path;
    if (thread) {   // benang: lengkung lembut (titik kendali digeser tegak lurus 12% panjang garis)
      const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1, k = Math.min(60, L * 0.12);
      const cx = mx - (dy / L) * k, cy = my + (dx / L) * k;
      d = `M${a.x},${a.y}Q${cx},${cy} ${b.x},${b.y}`;
      mx = (a.x + 2 * cx + b.x) / 4; my = (a.y + 2 * cy + b.y) / 4;
    }
    return h(React.Fragment, null,
      h(RF.BaseEdge, { id, path: d, interactionWidth: 18 }),
      thread ? null : h("path", { d: arrowPath(a, b, 10, 5), className: "hc-arrow" }),
      label || ed ? h(RF.EdgeLabelRenderer, null, h("div", {
        className: "hc-elabel nopan nodrag" + (selected ? " is-sel" : "") + (ed ? " is-edit" : ""),
        style: { transform: `translate(-50%, -50%) translate(${mx}px, ${my}px)` },
        onDoubleClick: (e) => { e.stopPropagation(); if (ui.tool === "select") ui.setEditing("e:" + id); },
      }, ed ? h(EditArea, { id: "e:" + id, value: label, single: true, className: "hc-elabel-edit" }) : label)) : null);
  }
  // benang jejak: garis sangat tipis antar-titik (urutan dibuat) / titik-titik ke induknya (bab, cerita)
  function TrailEdge({ source, target, data }) {
    const s = RF.useStore(React.useCallback((st) => st.nodeInternals.get(source), [source]));
    const t = RF.useStore(React.useCallback((st) => st.nodeInternals.get(target), [target]));
    if (!s || !t || !s.width || !t.width) return null;
    const { a, b } = edgeGeom(s, t, 2, 2);
    const chain = !data || data.trail !== "parent";
    return h("path", { d: `M${a.x},${a.y}L${b.x},${b.y}`, className: "hc-thread", fill: "none", pathLength: chain ? 1 : undefined });
  }
  const EDGE_TYPES = { link: LinkEdge, seq: LinkEdge, trail: TrailEdge };

  // ---------- model -> node/garis React Flow ----------
  function buildNodes(sel, prev) {
    const info = sceneInfo(), ix = curIx(), cur = ctx.getCurrentSceneId ? ctx.getCurrentSceneId() : null;
    const pm = new Map((prev || []).map((n) => [n.id, n]));
    const out = [];
    if (board.id === HOME_ID) trailArr().forEach((e) => {
      if (tf.hide[e.kind] || !hasXY(e)) return;
      const r = ix.map.get(tkey(e));
      if (!r) return;
      const id = tid(e), p = pm.get(id);
      const o = { id, type: "trail", position: { x: e.x, y: e.y }, selected: sel.has(id), data: { e, r, ix, current: e.kind === "scene" && e.id === cur, fresh: freshKeys.has(r.key) } };
      if (p && p.width && p.height) { o.width = p.width; o.height = p.height; } else { o.width = SCENE_W; o.height = 46; }
      out.push(o);
    });
    board.nodes.forEach((m) => {
      const o = { id: m.id, type: m.t, position: { x: m.x, y: m.y }, selected: sel.has(m.id), data: { m } };
      if (m.t === "scene") {
        const si = info.map.get(m.sceneId);
        if (!si) return;
        o.data = { m, s: si.s, path: si.path, idx: si.i, current: si.s.id === cur };
      } else if (m.t === "text") o.style = { width: m.w };
      else o.style = { width: m.w, height: m.h };
      if (m.t === "doc") o.data = { m, r: ix.map.get(m.kind + ":" + m.ref) || null, ix };
      if (m.t === "frame") { o.zIndex = -1; o.style.pointerEvents = "none"; }   // isi frame tembus klik: latar tetap bisa digeser
      // ukuran diketahui -> node langsung tampil (React Flow menyembunyikan node sampai terukur); ResizeObserver tetap mengoreksi
      const p = pm.get(m.id);
      if (m.t !== "scene" && m.t !== "text") { o.width = m.w; o.height = m.h; }
      else if (p && p.width && p.height) { o.width = p.width; o.height = p.height; }
      else if (m.t === "text") { o.width = m.w; o.height = Math.round((TEXT_SIZES[m.size] || 24) * 1.25 * fsScale() + 4); }
      out.push(o);
    });
    return out;
  }
  // titik jejak yang tampil (urut waktu, sesuai filter)
  function visibleTrail() { const ix = curIx(); return trailArr().filter((e) => !tf.hide[e.kind] && hasXY(e) && ix.map.has(tkey(e))); }
  function buildEdges(sel) {
    const out = [], vis = new Set();
    if (board.id === HOME_ID) {
      const ix = curIx(), T = visibleTrail(), pairs = new Set();
      T.forEach((e) => vis.add(tid(e)));
      const nope = { selectable: false, focusable: false, deletable: false };
      if (tf.threads) for (let i = 1; i < T.length; i++) {
        const a = tid(T[i - 1]), b = tid(T[i]);
        pairs.add(a + ">" + b);
        out.push(Object.assign({ id: "tr:" + a + ">" + b, source: a, target: b, type: "trail", className: freshKeys.has(tkey(T[i])) ? "is-new" : "", data: { trail: "chain" } }, nope));
      }
      if (tf.parents) T.forEach((e) => {
        const r = ix.map.get(tkey(e)), pk = r && r.parent;
        if (!pk) return;
        const j = pk.indexOf(":"), a = tid({ kind: pk.slice(0, j), id: pk.slice(j + 1) }), b = tid(e);
        if (!vis.has(a) || pairs.has(a + ">" + b) || pairs.has(b + ">" + a)) return;
        out.push(Object.assign({ id: "tp:" + a + ">" + b, source: a, target: b, type: "trail", className: "is-parent", data: { trail: "parent" } }, nope));
      });
      if (board.seq === true) {   // garis urutan scene (pilihan di menu "…")
        const order = sceneInfo().order.filter((s) => vis.has("s:" + s.id));
        for (let i = 1; i < order.length; i++) {
          out.push(Object.assign({ id: "seq:" + order[i - 1].id + ">" + order[i].id, source: "s:" + order[i - 1].id, target: "s:" + order[i].id, type: "seq", data: { seq: true } }, nope));
        }
      }
    }
    board.nodes.forEach((n) => vis.add(n.id));
    board.edges.forEach((e) => {
      if (!vis.has(e.source) || !vis.has(e.target)) return;   // ujungnya jenis jejak yang disembunyikan filter
      out.push({ id: e.id, source: e.source, target: e.target, type: "link", selected: sel.has(e.id), className: e.style === "thread" ? "is-thread" : "", data: { label: e.label || "", thread: e.style === "thread" } });
    });
    return out;
  }

  // ================= REACT FLOW: alat taruh (bentuk / catatan / teks / frame / kartu dokumen) =================
  // lapisan transparan di atas kanvas: klik = ukuran bawaan, seret = ukuran sesuai kotak. Roda tetap zoom (lihat onWheel).
  function PlaceLayer({ kind }) {
    const rf = RF.useReactFlow();
    const [g, setG] = React.useState(null);
    const st = React.useRef(null);
    const rel = (e, r) => ({ x: e.clientX - r.left, y: e.clientY - r.top });
    const onPointerDown = (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      closeMenu();
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch (er) { /* abaikan */ }
      const r = e.currentTarget.getBoundingClientRect();
      st.current = { x0: e.clientX, y0: e.clientY, r, id: e.pointerId };
      const p = rel(e, r);
      setG({ l: p.x, t: p.y, w: 0, h: 0 });
    };
    const onPointerMove = (e) => {
      const s = st.current;
      if (!s || s.id !== e.pointerId) return;
      setG({ l: Math.min(s.x0, e.clientX) - s.r.left, t: Math.min(s.y0, e.clientY) - s.r.top, w: Math.abs(e.clientX - s.x0), h: Math.abs(e.clientY - s.y0) });
    };
    const onPointerUp = (e) => {
      const s = st.current;
      st.current = null; setG(null);
      if (!s || s.id !== e.pointerId) return;
      const a = rf.screenToFlowPosition({ x: s.x0, y: s.y0 }), b = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      placeAt(kind, a, b, Math.hypot(e.clientX - s.x0, e.clientY - s.y0) > 8);
    };
    return h("div", { className: "hc-place nopan nodrag", onPointerDown, onPointerMove, onPointerUp, onPointerCancel: () => { st.current = null; setG(null); } },
      g ? h("div", { className: "hc-ghost is-" + kind + (kind === "shape" ? " is-" + shapeKind : ""), style: { left: g.l, top: g.t, width: g.w, height: g.h } }) : null);
  }

  // ================= REACT FLOW: bilah aksi objek terpilih =================
  function SelBar({ sel }) {
    const ids = sel.map((n) => n.id);
    const ms = ids.map(findNode).filter(Boolean);
    const trs = sel.filter((n) => n.type === "trail");
    if (!ms.length) {   // hanya titik jejak: satu titik -> tombol buka
      if (trs.length !== 1) return null;
      const r = trs[0].data.r;
      return h(RF.NodeToolbar, { nodeId: ids, isVisible: true, position: RF.Position.Top, offset: 8, className: "hc-selbar nopan nodrag nowheel" },
        h("button", { type: "button", className: "hc-sb-btn hc-sb-wide", onClick: (e) => { e.stopPropagation(); runAct("open"); } },
          ic(r.kind === "scene" ? "#ti-pencil" : "#ti-arrow-up-right", 14), h("span", null, r.kind === "scene" ? "Tulis" : "Buka " + KINDS[r.kind].name.toLowerCase())));
    }
    const types = new Set(ms.map((m) => m.t)), only = types.size === 1 ? ms[0].t : null, one = ms.length === 1 && !trs.length ? ms[0] : null;
    const btn = (act, label, icon, extra) => h("button", Object.assign({ type: "button", className: "hc-sb-btn", "data-tip": label, "aria-label": label,
      onClick: (e) => { e.stopPropagation(); runAct(act, extra && extra.arg); } }, extra && extra.attrs), icon);
    const sw = (act, key, hex, name, on) => h("button", { key: act + key, type: "button", className: "hc-sw" + (on ? " is-on" : ""), style: { "--c": hex || "transparent" },
      "data-tip": name, "aria-label": "Warna " + name, "aria-pressed": on ? "true" : "false", onClick: (e) => { e.stopPropagation(); runAct(act, key); } });
    const parts = [];
    if (only === "shape" || only === "frame") {
      const cur = ms[0].color || "";
      if (only === "frame") parts.push(sw("color", "", "", "Tanpa warna", cur === ""));
      Object.keys(COLORS).forEach((k) => parts.push(sw("color", k, COLORS[k], COLOR_NAMES[k], cur === k)));
      parts.push(h("span", { key: "s1", className: "hc-sb-sep" }));
    }
    if (only === "note") {
      const cur = ms[0].color;
      Object.keys(NOTE_COLORS).forEach((k) => parts.push(sw("color", k, NOTE_COLORS[k], NOTE_NAMES[k], cur === k)));
      parts.push(h("span", { key: "s1", className: "hc-sb-sep" }));
    }
    if (only === "shape") {
      parts.push(h("span", { key: "sk", className: "hc-sb-group" },
        btn("shapekind", "Persegi", ic("#ti-square", 15), { arg: "rect", attrs: { key: "r", "aria-pressed": ms[0].shape === "rect" ? "true" : "false" } }),
        btn("shapekind", "Lingkaran", ic("#ti-circle", 15), { arg: "circle", attrs: { key: "c", "aria-pressed": ms[0].shape === "circle" ? "true" : "false" } }),
        btn("shapekind", "Segitiga", ic("#ti-triangle", 15), { arg: "triangle", attrs: { key: "t", "aria-pressed": ms[0].shape === "triangle" ? "true" : "false" } }),
        btn("shapekind", "Belah ketupat", ic("#ti-diamond", 15), { arg: "diamond", attrs: { key: "d", "aria-pressed": ms[0].shape === "diamond" ? "true" : "false" } })));
      parts.push(h("span", { key: "s2", className: "hc-sb-sep" }));
    }
    if (only === "text") {
      ["s", "m", "l"].forEach((k) => parts.push(h("button", { key: "z" + k, type: "button", className: "hc-sb-btn hc-sb-size", "aria-pressed": ms[0].size === k ? "true" : "false",
        "data-tip": { s: "Teks kecil", m: "Teks sedang", l: "Teks besar" }[k], onClick: (e) => { e.stopPropagation(); runAct("tsize", k); } }, k.toUpperCase())));
      parts.push(h("span", { key: "s3", className: "hc-sb-sep" }));
    }
    if (one && one.t === "scene") parts.push(h("button", { key: "open", type: "button", className: "hc-sb-btn hc-sb-wide", onClick: (e) => { e.stopPropagation(); runAct("open"); } }, ic("#ti-pencil", 14), h("span", null, "Tulis")));
    if (one && one.t === "doc" && sel[0].data && sel[0].data.r) parts.push(h("button", { key: "open", type: "button", className: "hc-sb-btn hc-sb-wide", onClick: (e) => { e.stopPropagation(); runAct("open"); } }, ic("#ti-arrow-up-right", 14), h("span", null, "Buka")));
    if (one && EDITABLE.includes(one.t)) parts.push(h(React.Fragment, { key: "edit" }, btn("edit", "Edit teks · Enter", ic("#ti-cursor-text", 15))));
    if (ms.some(canCopy)) parts.push(h(React.Fragment, { key: "dup" }, btn("dup", "Duplikat · " + MOD + "+D", ic("#ti-copy-plus", 15))));
    parts.push(h(React.Fragment, { key: "front" }, btn("front", "Bawa ke depan · " + MOD + "+]", ic("#ti-stack-front", 15))));
    parts.push(h(React.Fragment, { key: "back" }, btn("back", "Kirim ke belakang · " + MOD + "+[", ic("#ti-stack-back", 15))));
    if (ms.some(deletable)) parts.push(h(React.Fragment, { key: "del" }, btn("del", "Hapus · Delete", ic("#ti-trash", 15))));
    return h(RF.NodeToolbar, { nodeId: ids, isVisible: true, position: RF.Position.Top, offset: 14, className: "hc-selbar nopan nodrag nowheel" }, parts);
  }

  // ================= REACT FLOW: aplikasi =================
  function App(props) {
    const t = props.space ? "hand" : props.tool;
    const sel = t === "select", conn = t === "connect", place = PLACE.includes(t);
    const init = React.useMemo(() => ({ nodes: buildNodes(new Set(), null), edges: buildEdges(new Set()) }), []);
    const [nodes, setNodes] = RF.useNodesState(init.nodes);
    const [edges, setEdges] = RF.useEdgesState(init.edges);
    const [editing, setEditing] = React.useState(null);
    const [dragging, setDragging] = React.useState(false);
    const boxSel = RF.useStore((s) => s.userSelectionActive);
    const rf = RF.useReactFlow(), store = RF.useStoreApi();
    const box = sel && (props.shift || boxSel);   // Shift ditahan = kotak pilih (selama kotak masih ditarik tetap aktif)
    React.useEffect(() => { store.setState({ multiSelectionActive: !!(sel && props.multi) }); }, [sel, props.multi]);
    const first = React.useRef(true), drag = React.useRef(null);

    React.useEffect(() => { api = { rf, store, setNodes, setEdges, setEditing }; return () => { if (api && api.rf === rf) api = null; }; }, [rf]);
    React.useEffect(() => { editingNow = editing; }, [editing]);
    React.useEffect(() => {   // data berubah -> bangun ulang (pilihan dipertahankan, atau diganti pendingSel)
      if (first.current) { first.current = false; return; }
      const keep = pendingSel; pendingSel = null;
      setNodes((prev) => buildNodes(keep ? new Set(keep) : new Set(prev.filter((n) => n.selected).map((n) => n.id)), prev));
      setEdges((prev) => buildEdges(keep ? new Set(keep) : new Set(prev.filter((e) => e.selected).map((e) => e.id))));
    }, [props.rev]);

    const onNodesChange = React.useCallback((ch) => setNodes((ns) => RF.applyNodeChanges(ch.filter((c) => c.type !== "remove"), ns)), []);
    const onEdgesChange = React.useCallback((ch) => setEdges((es) => RF.applyEdgeChanges(ch.filter((c) => c.type !== "remove"), es)), []);

    // seret: frame ikut membawa objek yang seluruhnya ada di dalamnya
    const onNodeDragStart = (e, node, dragged) => {
      closeMenu();
      cancelWheelZoom();
      const list = dragged && dragged.length ? dragged : [node];
      const ids = new Set(list.map((n) => n.id)), kids = new Map(), all = rf.getNodes();
      list.forEach((f) => {
        if (f.type !== "frame" || !f.width) return;
        const r = { x: f.position.x, y: f.position.y, w: f.width, h: f.height };
        all.forEach((n) => {
          if (ids.has(n.id) || kids.has(n.id) || !n.width) return;
          if (n.position.x >= r.x && n.position.y >= r.y && n.position.x + n.width <= r.x + r.w && n.position.y + n.height <= r.y + r.h)
            kids.set(n.id, { x: n.position.x, y: n.position.y, f: f.id, fx: f.position.x, fy: f.position.y });
        });
      });
      drag.current = { snap: snap(), kids };
      setDragging(true);
    };
    const onNodeDrag = (e, node, dragged) => {
      const d = drag.current;
      if (!d || !d.kids.size) return;
      const pos = new Map((dragged && dragged.length ? dragged : [node]).map((n) => [n.id, n.position]));
      setNodes((ns) => ns.map((n) => { const k = d.kids.get(n.id), fp = k && pos.get(k.f); return fp ? { ...n, position: { x: k.x + fp.x - k.fx, y: k.y + fp.y - k.fy } } : n; }));
    };
    const onNodeDragStop = (e, node, dragged) => {
      const d = drag.current;
      drag.current = null; setDragging(false);
      if (!d) return;
      const fin = new Map();
      (dragged && dragged.length ? dragged : [node]).forEach((n) => fin.set(n.id, n.position));
      d.kids.forEach((k, id) => { const fp = fin.get(k.f); if (fp) fin.set(id, { x: k.x + fp.x - k.fx, y: k.y + fp.y - k.fy }); });
      let moved = false;
      fin.forEach((p, id) => { const m = findAny(id); if (!m) return; const x = Math.round(p.x), y = Math.round(p.y); if (m.x !== x || m.y !== y) { m.x = x; m.y = y; moved = true; } });
      if (moved) { pushUndo(d.snap); save(); updateChrome(); }
    };
    const onNodeClick = (e, node) => {
      if (t !== "select" || e.shiftKey || e.metaKey || e.ctrlKey) return;
      if (node.type === "scene") { const m = findNode(node.id); if (m) openScene(m.sceneId); }
      else if (node.type === "trail") openEntry(node.data.e);
    };
    const onNodeDoubleClick = (e, node) => {
      if (t !== "select") return;
      if (EDITABLE.includes(node.type)) setEditing(node.id);
      else if (node.type === "doc") openCard(findNode(node.id));
    };
    const onConnect = (c) => {
      if (!c.source || !c.target || c.source === c.target) return;
      if (board.edges.some((x) => (x.source === c.source && x.target === c.target) || (x.source === c.target && x.target === c.source))) { toast("Kedua objek ini sudah terhubung."); return; }
      const id = uid("e");
      const e = { id, source: c.source, target: c.target, label: "" };
      if (board.id !== HOME_ID) e.style = "thread";   // Brainstorm: benang tipis
      mutate(() => { board.edges.push(e); }, [id]);
    };
    // klik kanan: objek / pilihan / garis / latar
    const ctxMenu = (kind) => (e, item) => {
      e.preventDefault();
      if (t === "hand" || place) return;
      let arg;
      if (kind === "node" && item && !item.selected) selectOnly([item.id]);
      if (kind === "edge") { if (!item || item.type !== "link") return; selectOnly([], [item.id]); arg = item.id; }
      ctxPos = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      openMenu(kind === "sel" ? "node" : kind, null, { x: e.clientX, y: e.clientY, arg });
    };

    const ui = React.useMemo(() => ({ tool: t, editing, setEditing, dragging }), [t, editing, dragging]);
    const selN = nodes.filter((n) => n.selected);
    const vp = props.vp;
    return h(UiCtx.Provider, { value: ui },
      h(Flow, {
        nodes, edges, nodeTypes: NODE_TYPES, edgeTypes: EDGE_TYPES, onNodesChange, onEdgesChange, onConnect,
        onNodeClick, onNodeDoubleClick, onNodeDragStart, onNodeDrag, onNodeDragStop,
        onNodeContextMenu: ctxMenu("node"), onSelectionContextMenu: ctxMenu("sel"), onPaneContextMenu: ctxMenu("pane"), onEdgeContextMenu: ctxMenu("edge"),
        onEdgeDoubleClick: (e, edge) => { if (t === "select" && edge.type === "link") setEditing("e:" + edge.id); },
        onPaneClick: () => closeMenu(),
        onMove: (e, v) => setZoomLabel(v.zoom),
        onMoveEnd: (e, v) => saveViewport(v),
        onInit: (inst) => setZoomLabel(inst.getZoom()),
        defaultViewport: vp || undefined, fitView: !vp, fitViewOptions: { padding: 0.25, maxZoom: 1.1, minZoom: 0.45 },   // jejak panjang: label tetap terbaca
        minZoom: MIN_Z, maxZoom: MAX_Z,
        // mode alat: Pilih = seret latar menggeser (Shift+seret = kotak pilih), Geser/Spasi = selalu menggeser
        nodesDraggable: sel, nodesConnectable: conn, elementsSelectable: sel || conn, selectNodesOnDrag: sel,
        // tombol React Flow dimatikan semua (lihat "mods"): Shift = kotak pilih, Shift/Ctrl/⌘+klik = tambah pilihan.
        // Roda & cubit trackpad ditangani onWheel (zoom halus di titik kursor); cubit layar sentuh tetap lewat React Flow
        panOnDrag: place ? false : box ? [1] : [0, 1], selectionOnDrag: box,
        selectionKeyCode: null, multiSelectionKeyCode: null, deleteKeyCode: null, panActivationKeyCode: null, zoomActivationKeyCode: null,
        panOnScroll: false, zoomOnScroll: false, zoomOnPinch: true, zoomOnDoubleClick: false, preventScrolling: true,
        connectionMode: RF.ConnectionMode.Loose, connectionLineType: RF.ConnectionLineType.Straight, connectionRadius: 26,
        connectionLineStyle: { stroke: "var(--accent)", strokeWidth: 1.8, strokeDasharray: "5 4" },
        elevateNodesOnSelect: false, elevateEdgesOnSelect: false, disableKeyboardA11y: true, nodeDragThreshold: 2,
        selectionMode: RF.SelectionMode.Partial, edgesUpdatable: false, edgesFocusable: false, nodesFocusable: false,
        attributionPosition: "bottom-left", className: "hc-rf is-" + t,
      },
        h(RF.Background, { variant: RF.BackgroundVariant.Dots, gap: 20, size: 1.3, color: "#8a8f99", className: "hc-bg" }),
        props.mini ? h(RF.MiniMap, { pannable: true, zoomable: true, position: "bottom-right", className: "hc-minimap", ariaLabel: "Peta mini kanvas",
          nodeClassName: (n) => "hc-mm-" + n.type, nodeColor: mmColor, nodeBorderRadius: 3, nodeStrokeWidth: 0, maskColor: "rgba(0,0,0,0)" }) : null,
        sel && selN.length && !dragging && !editing && !boxSel ? h(SelBar, { sel: selN }) : null,
        place ? h(PlaceLayer, { kind: t }) : null));
  }

  // warna objek di peta mini = warna aslinya (catatan/bentuk/jenis dokumen)
  function mmColor(n) {
    const m = n.data && n.data.m, light = document.body.classList.contains("light");
    if (n.type === "trail") { const K = KINDS[n.data.r.kind] || KINDS.scene; return light ? K.cl : K.c; }
    if (n.type === "doc") { const K = KINDS[m.kind] || KINDS.scene; return light ? K.cl : K.c; }
    if (n.type === "note") return NOTE_COLORS[m.color] || NOTE_COLORS.yellow;
    if (n.type === "shape") return COLORS[m.color] || COLORS.slate;
    if (n.type === "image") return "#8f97ab";
    if (n.type === "frame") return "transparent";
    return "#d7a86e";   // scene & teks: warnanya dari CSS (.hc-mm-*)
  }
  function renderFlow() {
    if (!root || !board) return;
    root.render(h(RF.ReactFlowProvider, { key: board.id }, h(App, { key: board.id, rev, tool, space, mini, shift: mods.shift, multi: mods.multi, vp: viewportOf(board) })));
  }
  function viewportOf(b) {
    const v = lsGet(vpKey(b));
    if (validVp(v)) return v;
    if (b.viewport) return b.viewport;
    const empty = b.id === HOME_ID ? !b.nodes.length && !trailArr().length : !b.nodes.length;
    if (empty && dom) return { x: Math.round(dom.flow.clientWidth / 2), y: Math.round(dom.flow.clientHeight / 2), zoom: 1 };   // papan baru: titik 0,0 di tengah
    return null;   // -> fitView
  }
  let vpTimer = null;
  function saveViewport(v) {
    if (!board || !v) return;
    const vp = { x: Math.round(v.x), y: Math.round(v.y), zoom: +v.zoom.toFixed(3) };
    board.viewport = vp;   // ikut tersimpan bersama perubahan berikutnya (tidak memicu simpan sendiri)
    const b = board;
    clearTimeout(vpTimer);
    vpTimer = setTimeout(() => lsSet(vpKey(b), vp), 150);
  }
  function setZoomLabel(z) {
    const s = Math.round(z * 100) + "%";
    if (dom && s !== zoomShown) { zoomShown = s; dom.zoom.textContent = s; }
  }

  // ================= RODA / TRACKPAD: zoom halus di titik kursor =================
  let wz = null;                       // animasi zoom roda: { goal, px, py, raf, last }
  const gest = { t: 0, pad: false };   // satu gerakan roda/trackpad (jeda > 220 ms = gerakan baru)
  let vpSaveT = null;
  // usapan dua jari trackpad: ada geser samping (roda mouse biasa tidak punya), atau pola Chrome/Safari
  // wheelDeltaY = -3 × deltaY dengan delta kecil. Kalau ragu -> dianggap roda mouse (= zoom).
  function looksLikePad(e) {
    if (e.deltaMode !== 0) return false;
    if (e.deltaX !== 0 && !e.shiftKey) return true;
    const wd = e.wheelDeltaY;
    return typeof wd === "number" && wd !== 0 && Math.abs(e.deltaY) < 40 && wd === -3 * e.deltaY;
  }
  function cancelWheelZoom() { if (wz) { cancelAnimationFrame(wz.raf); wz = null; } }
  const vpAround = (v, z, px, py) => ({ x: px - ((px - v.x) * z) / v.zoom, y: py - ((py - v.y) * z) / v.zoom, zoom: z });
  // viewport diubah langsung (bukan lewat gerakan React Flow): label zoom + simpan posisi (ditunda)
  function vpTouched() {
    if (!api) return;
    const v = api.rf.getViewport();
    setZoomLabel(v.zoom);
    clearTimeout(vpSaveT);
    vpSaveT = setTimeout(() => { if (api) saveViewport(api.rf.getViewport()); }, 180);
  }
  function wheelZoom(px, py, factor, smooth) {
    const v = api.rf.getViewport();
    const goal = clamp((wz ? wz.goal : v.zoom) * factor, MIN_Z, MAX_Z);
    zoomGoal = 0;
    if (!smooth || reduceMotion()) {
      cancelWheelZoom();
      if (goal !== v.zoom) { api.rf.setViewport(vpAround(v, goal, px, py)); vpTouched(); }
      return;
    }
    if (!wz) wz = { goal, px, py, raf: 0, last: performance.now() };
    wz.goal = goal; wz.px = px; wz.py = py;
    if (!wz.raf) wz.raf = requestAnimationFrame(stepWheelZoom);
  }
  function stepWheelZoom(t) {
    const w = wz;
    if (!w || !api) { wz = null; return; }
    const v = api.rf.getViewport(), dt = Math.min(120, Math.max(1, t - w.last));   // bingkai lambat: tetap cepat sampai
    w.last = t;
    const k = 1 - Math.exp(-dt / 65);
    let z = Math.exp(Math.log(v.zoom) + (Math.log(w.goal) - Math.log(v.zoom)) * k);
    if (Math.abs(Math.log(w.goal / z)) < 0.003) z = w.goal;
    api.rf.setViewport(vpAround(v, z, w.px, w.py));
    vpTouched();
    if (z === w.goal) { wz = null; return; }
    w.raf = requestAnimationFrame(stepWheelZoom);
  }
  function panBy(dx, dy) {
    cancelWheelZoom();
    const v = api.rf.getViewport();
    api.rf.setViewport({ x: v.x + dx, y: v.y + dy, zoom: v.zoom });
    vpTouched();
  }
  function onWheel(e) {
    if (!api || !dom || !isShown()) return;
    const t = e.target;
    if (t && t.closest && (t.closest(".nowheel") || t.closest(".react-flow__minimap"))) return;   // kolom teks yang bisa digulir / peta mini
    e.preventDefault();
    e.stopPropagation();   // React Flow (d3-zoom) tidak ikut memproses roda
    const r = dom.flow.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
    const k = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? r.height : 1;
    const dx = e.deltaX * k, dy = e.deltaY * k, now = performance.now();
    if (now - gest.t > 220) gest.pad = false;
    gest.t = now;
    const notch = (d) => Math.pow(2, -clamp(d, -240, 240) * 0.0028);
    if (e.ctrlKey || e.metaKey) {   // cubit trackpad (ctrlKey) / Ctrl+roda
      if (e.deltaMode === 0 && Math.abs(dy) < 50) wheelZoom(px, py, Math.pow(2, -dy * 0.01), false);
      else wheelZoom(px, py, notch(dy), true);
      return;
    }
    if (e.shiftKey) { panBy(-(dx || dy), 0); return; }
    if (e.altKey) { panBy(-dx, -dy); return; }
    if (!gest.pad && looksLikePad(e)) gest.pad = true;
    if (gest.pad) { panBy(-dx, -dy); return; }
    wheelZoom(px, py, notch(dy), true);
  }

  // ================= AKSI =================
  const deletable = (m) => m.t !== "scene" || board.id !== HOME_ID;
  const canCopy = (m) => m.t !== "scene";
  function selModels() { return api ? api.rf.getNodes().filter((n) => n.selected).map((n) => findNode(n.id)).filter(Boolean) : []; }
  function selTrail() { return api && board && board.id === HOME_ID ? api.rf.getNodes().filter((n) => n.selected && n.type === "trail").map((n) => n.data.e) : []; }
  function selEdgeIds() { return new Set(api ? api.rf.getEdges().filter((e) => e.selected && e.type === "link").map((e) => e.id) : []); }
  function selectOnly(nodeIds, edgeIds) {
    if (!api) return;
    const n = new Set(nodeIds || []), e = new Set(edgeIds || []);
    api.store.setState({ nodesSelectionActive: false });   // kotak pilihan lama (hasil Shift+seret) ikut hilang
    api.setNodes((ns) => ns.map((x) => (!!x.selected === n.has(x.id) ? x : { ...x, selected: n.has(x.id) })));
    api.setEdges((es) => es.map((x) => (!!x.selected === e.has(x.id) ? x : { ...x, selected: e.has(x.id) })));
  }
  function viewCenter() {
    try { const r = dom.flow.getBoundingClientRect(); return api.rf.screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 }); }
    catch (e) { return { x: 0, y: 0 }; }
  }
  function deleteSel() {
    const ms = selModels(), es = selEdgeIds(), trs = selTrail();
    const del = new Set(ms.filter(deletable).map((m) => m.id));
    if (!del.size && !es.size) {
      if (trs.length) toast("Titik jejak tidak bisa dihapus di sini — hapus dokumennya di tabnya, atau sembunyikan jenisnya lewat filter.");
      else if (ms.length) toast("Scene hanya bisa dihapus dari tab Tulis.");
      return ms.length + trs.length > 0;
    }
    mutate(() => {
      board.nodes = board.nodes.filter((m) => !del.has(m.id));
      board.edges = board.edges.filter((e) => !es.has(e.id) && !del.has(e.source) && !del.has(e.target));
    }, []);
    if (trs.length) toast("Titik jejak tetap ada — hapus dokumennya di tabnya.");
    else if (ms.length > del.size) toast("Scene tetap di papan — hapus scene dari tab Tulis.");
    return true;
  }
  function cloneSet(models, edges, dx, dy) {
    const map = new Map();
    const nodes = models.map((m) => { const id = m.t === "scene" ? "s:" + m.sceneId : uid("n"); map.set(m.id, id); return { ...m, id, x: Math.round(m.x + dx), y: Math.round(m.y + dy) }; });
    const es = edges.filter((e) => map.has(e.source) && map.has(e.target)).map((e) => ({ ...e, id: uid("e"), source: map.get(e.source), target: map.get(e.target) }));
    return { nodes, edges: es, ids: nodes.map((n) => n.id) };
  }
  function duplicate() {
    const ms = selModels().filter(canCopy);
    if (!ms.length) { if (selModels().length) toast("Scene tidak bisa diduplikat di papan yang sama."); else if (selTrail().length) toast("Titik jejak tidak bisa diduplikat."); return; }
    const c = cloneSet(ms, board.edges, 24, 24);
    mutate(() => { board.nodes.push(...c.nodes); board.edges.push(...c.edges); }, c.ids);
  }
  function copySel() {
    const ms = selModels();
    if (!ms.length) return false;
    const ids = new Set(ms.map((m) => m.id));
    clip = { nodes: ms.map((m) => ({ ...m })), edges: board.edges.filter((e) => ids.has(e.source) && ids.has(e.target)).map((e) => ({ ...e })) };
    pasteN = 0;
    return true;
  }
  function pasteClip() {
    if (!board || board.id === HOME_ID) return;
    if (!clip || !board) return;
    const info = sceneInfo();
    const on = new Set(board.nodes.filter((n) => n.t === "scene").map((n) => n.sceneId));
    const ms = clip.nodes.filter((m) => m.t !== "scene" || (board.id !== HOME_ID && info.map.has(m.sceneId) && !on.has(m.sceneId)));
    if (!ms.length) { toast(clip.nodes.length ? "Scene itu sudah ada di papan ini." : "Papan klip kosong."); return; }
    pasteN++;
    const c = cloneSet(ms, clip.edges, 24 * pasteN, 24 * pasteN);
    mutate(() => { board.nodes.push(...c.nodes); board.edges.push(...c.edges); }, c.ids);
  }
  function reorder(front) {
    const ids = new Set(selModels().map((m) => m.id));
    if (!ids.size) return;
    mutate(() => {
      const a = board.nodes.filter((m) => ids.has(m.id)), b = board.nodes.filter((m) => !ids.has(m.id));
      board.nodes = front ? b.concat(a) : a.concat(b);
    });
  }
  function selectAll() {
    if (!api) return;
    api.setNodes((ns) => ns.map((n) => (n.selected ? n : { ...n, selected: true })));
    api.setEdges((es) => es.map((e) => (e.type !== "link" || e.selected ? e : { ...e, selected: true })));
  }
  function nudge(dx, dy) {
    const ms = selModels(), trs = selTrail();
    if (!ms.length && !trs.length) { if (api) { const v = api.rf.getViewport(); api.rf.setViewport({ x: v.x - dx * 6, y: v.y - dy * 6, zoom: v.zoom }); vpTouched(); } return; }
    const s = snap();
    ms.forEach((m) => { m.x += dx; m.y += dy; });
    trs.forEach((e) => { e.x += dx; e.y += dy; });
    if (Date.now() - lastNudge > 700) pushUndo(s);   // tekan beruntun = satu langkah urungkan
    lastNudge = Date.now();
    changed(null);
  }
  function setColor(key) {
    const ms = selModels().filter((m) => m.t === "shape" || m.t === "note" || m.t === "frame");
    if (!ms.length) return;
    mutate(() => { ms.forEach((m) => { if (m.t === "note") { if (NOTE_COLORS[key]) m.color = key; } else if (COLORS[key] || (m.t === "frame" && key === "")) m.color = key; }); });
    const m = ms[0];
    if (m.t === "note" && NOTE_COLORS[key]) noteColor = key; else if (m.t === "shape" && COLORS[key]) shapeColor = key;
    updateChrome();
  }
  function startEdit(id) { if (api && findNode(id) && EDITABLE.includes(findNode(id).t)) api.setEditing(id); }
  // selesai mengedit teks (keepOpen = simpan saja, kolom tetap terbuka — dipakai flush() saat autosave)
  // ---- ketikan langsung masuk data: jeda 300 ms (maks. 1 dtk saat mengetik terus), lalu commitEdit(keepOpen) ----
  const LIVE_MS = 300, LIVE_MAX_MS = 1000;
  let liveTimer = 0, livePend = null, liveSince = 0;
  let liveUndoId = null;      // kolom edit yang sudah punya titik urungkan di sesi edit ini
  function liveInput(id, value) {
    if (!livePend) liveSince = Date.now();
    livePend = { id, value };
    clearTimeout(liveTimer);
    liveTimer = setTimeout(flushLive, Date.now() - liveSince >= LIVE_MAX_MS ? 0 : LIVE_MS);
  }
  function flushLive() {
    clearTimeout(liveTimer); liveTimer = 0;
    const x = livePend;
    livePend = null;
    if (x) commitEdit(x.id, x.value, true);
  }
  function dropLive() { clearTimeout(liveTimer); liveTimer = 0; livePend = null; liveUndoId = null; }
  // simpan isi kolom edit. keepOpen = kolom masih terbuka (ketikan / autosave): data + autosave saja, kanvas tidak
  // dibangun ulang. Titik urungkan sekali per sesi edit (objek yang baru dibuat: titik saat dibuat).
  function commitEdit(id, value, keepOpen) {
    if (!board) return;
    if (livePend && livePend.id === id) { clearTimeout(liveTimer); livePend = null; }   // nilai ini sudah yang terbaru
    if (!keepOpen && api) api.setEditing((cur) => (cur === id ? null : cur));
    const live = liveUndoId === id;
    if (!keepOpen && live) liveUndoId = null;
    const refresh = () => { if (!keepOpen && live) { rev++; renderFlow(); updateChrome(); } };   // nilai sudah masuk saat diketik
    const isNew = !!lastCreate && lastCreate.id === id;
    const apply = (fn) => {
      if (keepOpen) {
        if (!live && !isNew) pushUndo(snap());
        liveUndoId = id;
        fn(); save();
        return;
      }
      if (live) { fn(); changed(); } else mutate(fn);
    };
    if (id.indexOf("e:") === 0) {
      const e = board.edges.find((x) => x.id === id.slice(2));
      const v = String(value || "").trim().slice(0, 200);
      if (e && (e.label || "") !== v) apply(() => { e.label = v; }); else refresh();
      return;
    }
    const n = findNode(id);
    if (!n) return;
    const key = n.t === "frame" ? "title" : "text";
    const v = n.t === "frame" ? String(value || "").trim().slice(0, 120) : String(value || "").slice(0, 5000);
    if (n.t === "text" && !v.trim() && !keepOpen) {   // teks kosong dibuang; teks yang baru dibuat -> tanpa jejak di riwayat
      const x = H();
      if (lastCreate && lastCreate.id === id && x.undo.length === lastCreate.len) { x.undo.pop(); board.nodes = board.nodes.filter((m) => m !== n); changed([]); }
      else mutate(() => { board.nodes = board.nodes.filter((m) => m.id !== id); board.edges = board.edges.filter((e) => e.source !== id && e.target !== id); }, []);
      lastCreate = null;
      return;
    }
    if (!keepOpen) lastCreate = null;
    if ((n[key] || "") === v) { refresh(); return; }
    apply(() => { n[key] = v; });
  }
  // taruh objek baru (alat Bentuk/Catatan/Teks/Frame/Dokumen): a = titik awal, b = titik akhir (seret)
  function placeAt(kind, a, b, dragged) {
    if (kind === "doc" && !pendingDoc) { setTool("select"); return; }
    const D = DEF[kind], M = MIN[kind];
    let x, y, w, hh;
    if (dragged) {
      x = Math.min(a.x, b.x); y = kind === "text" ? a.y : Math.min(a.y, b.y);
      w = Math.max(Math.abs(b.x - a.x), M.w); hh = Math.max(Math.abs(b.y - a.y), M.h);
    } else { w = D.w; hh = D.h; x = a.x - w / 2; y = a.y - (kind === "text" ? 18 : hh / 2); }
    const n = { id: uid("n"), t: kind, x: Math.round(x), y: Math.round(y), w: Math.round(w) };
    if (kind !== "text") n.h = Math.round(hh);
    if (kind === "shape") Object.assign(n, { shape: shapeKind, color: shapeColor, text: "" });
    if (kind === "note") Object.assign(n, { color: noteColor, text: "" });
    if (kind === "text") Object.assign(n, { text: "", size: "m" });
    if (kind === "frame") Object.assign(n, { title: "Frame " + (board.nodes.filter((m) => m.t === "frame").length + 1), color: "" });
    if (kind === "doc") { Object.assign(n, { kind: pendingDoc.kind, ref: pendingDoc.ref }); pendingDoc = null; }
    mutate(() => { board.nodes.push(n); }, [n.id]);
    lastCreate = { id: n.id, len: H().undo.length };
    setTool("select");
    if (kind === "note" || kind === "text") startEdit(n.id);
  }
  function addAt(kind, at) { placeAt(kind, at || viewCenter(), null, false); }
  // objek baru tanpa posisi pilihan (tengah layar) tidak menumpuk persis di atas objek lain: bergeser serong
  function freeSpot(x, y, w, hh) {
    const near = (n) => Math.abs(n.x + (n.w || SCENE_W) / 2 - x - w / 2) < 16 && Math.abs(n.y + (n.h || 40) / 2 - y - hh / 2) < 16;
    for (let k = 0; k < 40 && board.nodes.some(near); k++) { x += 28; y += 28; }
    return { x, y };
  }

  // ---------- buka dokumen (titik jejak / kartu) tepat di tempatnya ----------
  function openRef(kind, id) {
    if (!ctx) return;
    if (!docIndex(ctx.project).map.has(kind + ":" + id)) { toast("Dokumen ini sudah dihapus."); return; }
    if (kind === "board") { if (!board || board.id !== id) setTimeout(() => switchBoard(id), 0); return; }
    // pindah tab melepas kanvas React -> setelah event selesai
    setTimeout(() => { if (!ctx) return; if (ctx.openDoc) ctx.openDoc(kind, id); else if (kind === "scene") ctx.openScene(id); }, 0);
  }
  function openEntry(e) { if (e) openRef(e.kind, e.id); }
  function openCard(m) { if (m && m.t === "doc") openRef(m.kind, m.ref); }
  // geser tampilan ke titik jejak (tombol "Ke jejak terbaru" / dokumen baru di luar layar) + denyut kecil
  function focusEntry(e, onlyIfOff) {
    if (!api || !e || !hasXY(e) || !dom) return;
    const v = api.rf.getViewport(), cx = e.x + SCENE_W / 2, cy = e.y + DOT_CY;
    const r = dom.flow.getBoundingClientRect(), sx = cx * v.zoom + v.x, sy = cy * v.zoom + v.y;
    const off = sx < 80 || sx > r.width - 80 || sy < 110 || sy > r.height - 120;
    if (!onlyIfOff || off) {
      cancelWheelZoom();
      api.rf.setCenter(cx, cy, { zoom: onlyIfOff ? v.zoom : Math.max(v.zoom, 0.9), duration: dur(420) });
      setTimeout(vpTouched, dur(420) + 20);
    }
    setTimeout(() => {
      const n = dom && dom.flow.querySelector(`.react-flow__node[data-id="${CSS.escape(tid(e))}"] .hc-trail`);
      if (!n) return;
      n.classList.remove("is-ping"); void n.offsetWidth; n.classList.add("is-ping");
      setTimeout(() => n.classList.remove("is-ping"), 1500);
    }, dur(420) + 30);
  }
  function focusLatest() {
    const T = visibleTrail();
    if (!T.length) { toast(trailArr().length ? "Semua jenis jejak sedang disembunyikan filter." : "Belum ada jejak dokumen."); return; }
    focusEntry(T.reduce((a, e) => (e.at >= a.at ? e : a), T[0]), false);
  }
  function revealFresh() {
    if (!board || board.id !== HOME_ID || !freshKeys.size) return;
    const T = visibleTrail().filter((e) => freshKeys.has(tkey(e)));
    if (T.length) focusEntry(T.reduce((a, e) => (e.at >= a.at ? e : a), T[0]), true);
  }

  // ---------- alat Dokumen: pilih jenis -> daftar dokumen -> taruh kartu ----------
  function startPlaceDoc(kind, ref, kbd) {
    closeMenu();
    if (!CARD_KINDS.includes(kind)) return;
    pendingDoc = { kind, ref };
    if (kbd) {   // dari keyboard: langsung di tengah layar (bergeser serong bila ada kartu lain di situ)
      const c = viewCenter(), f = freeSpot(Math.round(c.x - DEF.doc.w / 2), Math.round(c.y - DEF.doc.h / 2), DEF.doc.w, DEF.doc.h);
      placeAt("doc", { x: f.x + DEF.doc.w / 2, y: f.y + DEF.doc.h / 2 }, null, false);
      return;
    }
    setTool("doc");
  }
  function makeBoard(title) {
    const c = cvs();
    let t = String(title || "").trim().slice(0, 80);
    if (!t) { let n = c.boards.length; do { t = "Brainstorm " + n++; } while (c.boards.some((b) => b.title === t)); }
    const b = { id: uid("b"), title: t, nodes: [], edges: [], viewport: null, seq: true };
    c.boards.push(b);
    save();
    return b;
  }
  // "Buat baru" di daftar alat Dokumen: lewat fungsi pembuat dokumen app.js (Jejaring: wizard di tabnya)
  function createFromMenu(kbd) {
    const kind = dm.kind, title = dm.q.trim(), K = KINDS[kind];
    if (kind === "board") {
      const b = makeBoard(title);
      syncNow(); rev++;
      startPlaceDoc("board", b.id, kbd);
      toast(`Papan brainstorm "${b.title}" dibuat.`);
      return;
    }
    if (!ctx.createDoc) return;
    const known = new Set(docIndex(ctx.project).list.map((r) => r.key)), at = viewCenter(), bid = board.id, pid = projId;
    closeMenu();
    Promise.resolve(ctx.createDoc(kind, title)).then((id) => {
      if (!ctx || projId !== pid) return;
      if (!id) { pendingCard = { pid, kinds: [kind], boardId: bid, at, known, t: Date.now() }; return; }   // dibuat di tabnya
      if (!isShown() || !board || board.id !== bid) return;
      syncNow(); rev++;
      if (board.id === HOME_ID) renderFlow();
      scheduleFreshClear();
      startPlaceDoc(kind, id, kbd);
      toast(K.name + " baru dibuat — " + (kbd ? "kartunya ada di tengah layar." : "klik di kanvas untuk menaruh kartunya."));
    }).catch(() => toast("Dokumen gagal dibuat."));
  }
  // dokumen yang dibuat di tab lain lewat "Buat baru" (Jejaring) -> kartunya ditaruh di papan saat Beranda tampil lagi
  function placePendingCard() {
    const pc = pendingCard;
    if (!pc || pc.pid !== projId) return;
    if (Date.now() - pc.t > 30 * 60e3) { pendingCard = null; return; }
    const r = docIndex(ctx.project).list.find((x) => pc.kinds.includes(x.kind) && !pc.known.has(x.key));
    if (!r) return;
    pendingCard = null;
    const b = cvs().boards.find((x) => x.id === pc.boardId);
    if (!b) return;
    let x = Math.round(pc.at.x - DEF.doc.w / 2), y = Math.round(pc.at.y - DEF.doc.h / 2);
    for (let k = 0; k < 40 && b.nodes.some((m) => Math.abs(m.x - x) < 30 && Math.abs(m.y - y) < 30); k++) { x += 28; y += 28; }   // tidak menumpuk
    const n = { id: uid("n"), t: "doc", kind: r.kind, ref: r.id, x, y, w: DEF.doc.w, h: DEF.doc.h };
    b.nodes.push(n);
    save();
    setTimeout(() => toast(`Kartu "${docTitle(r)}" ditaruh di papan.`), 300);
  }

  // ---------- gambar: unggah / seret / tempel -> diperkecil (<= 1200px) -> WebP 0.82 (cadangan JPEG) ----------
  function readImage(file, max) {
    return new Promise((resolve, reject) => {
      if (!file || !/^image\//.test(file.type || "")) { reject(new Error("File ini bukan gambar.")); return; }
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => {
        try {
          const s = Math.min(1, max / img.naturalWidth, max / img.naturalHeight);
          const w = Math.max(1, Math.round(img.naturalWidth * s)), hh = Math.max(1, Math.round(img.naturalHeight * s));
          const cv = document.createElement("canvas");
          cv.width = w; cv.height = hh;
          cv.getContext("2d").drawImage(img, 0, 0, w, hh);
          let out = cv.toDataURL("image/webp", 0.82);
          if (!/^data:image\/webp/.test(out)) {
            const cj = document.createElement("canvas"), g = cj.getContext("2d");
            cj.width = w; cj.height = hh;
            g.fillStyle = "#ffffff"; g.fillRect(0, 0, w, hh); g.drawImage(cv, 0, 0);
            out = cj.toDataURL("image/jpeg", 0.85);
          }
          resolve({ src: out, w, h: hh });
        } catch (e) { reject(e); } finally { URL.revokeObjectURL(url); }
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Gambar tidak bisa dibaca.")); };
      img.src = url;
    });
  }
  function addImages(files, at) {
    files = Array.from(files || []).filter((f) => /^image\//.test(f.type || ""));
    if (!files.length || !board || board.id === HOME_ID) return;
    const b = board, room = MAX_IMG - b.nodes.filter((n) => n.t === "image").length;
    if (room <= 0) { toast(`Papan ini penuh (maks. ${MAX_IMG} gambar).`); return; }
    if (files.length > room) toast(`Hanya ${room} gambar lagi yang muat di papan ini.`);
    const base = at || viewCenter();
    let k = 0;
    files.slice(0, room).reduce((chain, f) => chain.then(() => readImage(f, IMG_PX).then((r) => {
      if (board !== b) return;   // pengguna sudah pindah papan / project
      const w = Math.min(320, r.w), hh = Math.max(20, Math.round((w * r.h) / r.w));
      const p = at ? { x: base.x - w / 2 + k * 28, y: base.y - hh / 2 + k * 28 } : freeSpot(Math.round(base.x - w / 2), Math.round(base.y - hh / 2), w, hh);
      const n = { id: uid("n"), t: "image", x: Math.round(p.x), y: Math.round(p.y), w, h: hh, src: r.src };
      k++;
      mutate(() => { b.nodes.push(n); }, [n.id]);
    })), Promise.resolve()).catch((err) => toast((err && err.message) || "Gambar gagal dibaca."));
  }
  function pickImage() { if (dom) { closeMenu(); dom.file.click(); } }

  // ---------- papan ----------
  function switchBoard(id, quiet) {
    const b = cvs().boards.find((x) => x.id === id);
    if (!b) return;
    flushEdit(false);
    closeMenu();
    cancelWheelZoom();
    if (pendingDoc && tool === "doc") { pendingDoc = null; tool = "select"; }
    if (b.id === HOME_ID && tool !== "select" && tool !== "hand") tool = "select";   // Beranda: hanya Pilih / Geser
    board = b;
    cvs().active = b.id;
    lsSet("novelist_hcboard_" + projId, b.id);
    if (b.id === HOME_ID) syncNow();
    syncScenes(b, sceneInfo());
    pendingSel = null; zoomShown = "";
    rev++;
    renderFlow(); updateChrome();
    if (!quiet && ctx.onOpen) ctx.onOpen(b.id, b.title, b.id === HOME_ID);   // app.js: riwayat sidebar tab
  }
  // Beranda lama berisi objek bebas (catatan, bentuk, kartu, …) -> dipindah ke papan Brainstorm baru (sekali).
  // Penghubung dari objek ke titik jejak menjadi penghubung ke KARTU dokumen yang sama di papan baru itu.
  function migrateHome(cv) {
    const home = cv.boards.find((b) => b.id === HOME_ID);
    if (!home || !home.nodes.length) return null;
    const moved = new Set(home.nodes.map((n) => n.id)), T = new Map(trailArr().map((e) => [tid(e), e])), cardFor = new Map();
    let title = "Brainstorm", n = 2;
    while (cv.boards.some((b) => b.title === title)) title = "Brainstorm " + n++;
    const nb = { id: uid("b"), title, nodes: home.nodes.filter((m) => m.t !== "scene"), edges: [], viewport: home.viewport, seq: true };
    const end = (x) => {
      if (moved.has(x)) return nb.nodes.some((m) => m.id === x) ? x : null;
      if (cardFor.has(x)) return cardFor.get(x);
      const te = T.get(x);
      if (!te || !CARD_KINDS.includes(te.kind) || !hasXY(te)) return null;
      const id = uid("n");
      nb.nodes.push({ id, t: "doc", kind: te.kind, ref: te.id, x: Math.round(te.x - DEF.doc.w / 2), y: Math.round(te.y + 24), w: DEF.doc.w, h: DEF.doc.h });
      cardFor.set(x, id);
      return id;
    };
    const keep = [];
    home.edges.forEach((e) => {
      if (!moved.has(e.source) && !moved.has(e.target)) { keep.push(e); return; }
      const a = end(e.source), b = end(e.target);
      if (a && b && a !== b) nb.edges.push(Object.assign({}, e, { source: a, target: b }));
    });
    home.nodes = []; home.edges = keep;
    if (nb.nodes.length) cv.boards.splice(1, 0, nb);
    return nb.nodes.length ? nb : null;
  }
  function newBoard() {
    const b = makeBoard("");
    switchBoard(b.id);
    startRename();
  }
  function deleteBoard() {
    if (!board || board.id === HOME_ID) return;
    if (!confirm(`Hapus papan "${board.title}"? Semua isi papan ini ikut terhapus.`)) return;
    const id = board.id;
    cvs().boards = cvs().boards.filter((b) => b.id !== id);
    hist.delete(projId + "|" + id);
    try { localStorage.removeItem(vpKey({ id })); } catch (e) { /* abaikan */ }
    save();
    switchBoard(HOME_ID);
    toast("Papan dihapus.");
  }
  function clearBoard() {
    if (!board) return;
    const home = board.id === HOME_ID;
    const extra = board.nodes.filter((n) => !home || n.t !== "scene").length + board.edges.length;
    if (!extra) { toast("Papan ini sudah bersih."); return; }
    if (!confirm(home ? "Bersihkan papan Beranda? Semua catatan, bentuk, gambar, teks, frame, kartu & penghubung dihapus (jejak dokumen tetap). Bisa diurungkan dengan " + MOD + "+Z."
      : `Bersihkan papan "${board.title}"? Semua isinya dihapus. Bisa diurungkan dengan ${MOD}+Z.`)) return;
    mutate(() => { board.nodes = home ? board.nodes.filter((n) => n.t === "scene") : []; board.edges = []; }, []);
  }
  function addSceneToBoard(sceneId) {
    const info = sceneInfo(), si = info.map.get(sceneId);
    if (!si || board.id === HOME_ID || board.nodes.some((n) => n.t === "scene" && n.sceneId === sceneId)) return;
    const c = viewCenter(), k = board.nodes.filter((n) => n.t === "scene").length % 6;
    const n = { id: "s:" + sceneId, t: "scene", sceneId, x: Math.round(c.x - SCENE_W / 2 + k * 26), y: Math.round(c.y - DOT_CY + k * 26) };
    mutate(() => { board.nodes.push(n); }, [n.id]);
  }
  function startRename() {
    if (!dom || !board) return;
    closeMenu();
    dom.titleInput.value = board.title;
    dom.boardBtn.classList.add("hidden");
    dom.titleInput.classList.remove("hidden");
    dom.titleInput.focus();
    dom.titleInput.select();
  }
  function endRename(commit) {
    if (!dom || dom.titleInput.classList.contains("hidden")) return;
    const v = dom.titleInput.value.trim().slice(0, 80);
    dom.titleInput.classList.add("hidden");
    dom.boardBtn.classList.remove("hidden");
    if (commit && v && board && v !== board.title) {
      board.title = v;
      save();
      if (ctx.onOpen) ctx.onOpen(board.id, board.title, board.id === HOME_ID);
    }
    updateChrome();
  }

  // ---------- tampilan ----------
  function fit() {
    zoomGoal = 0;
    cancelWheelZoom();
    if (!api) return;
    if (!api.rf.getNodes().length) { const r = dom.flow.getBoundingClientRect(); api.rf.setViewport({ x: r.width / 2, y: r.height / 2, zoom: 1 }, { duration: dur(250) }); setTimeout(vpTouched, dur(250) + 20); return; }
    api.rf.fitView({ padding: 0.2, maxZoom: 1.2, duration: dur(320) });
    setTimeout(vpTouched, dur(320) + 20);
  }
  // tombol zoom beruntun: langkah berikutnya dihitung dari target sebelumnya (transisi yang belum selesai tidak membuang langkah)
  let zoomGoal = 0, zoomGoalT = 0;
  function zoomBy(inOut) {
    if (!api) return;
    cancelWheelZoom();
    const now = performance.now(), base = zoomGoal && now - zoomGoalT < 600 ? zoomGoal : api.rf.getZoom();
    zoomGoal = clamp(base * (inOut > 0 ? 1.2 : 1 / 1.2), MIN_Z, MAX_Z); zoomGoalT = now;
    zoomTo(zoomGoal, dur(180));
  }
  // tanpa animasi (gerak dikurangi / perf-boost): langsung lewat d3-zoom, tidak menunggu bingkai berikutnya
  function zoomTo(z, ms) {
    const st = api.store.getState();
    if (!ms && st.d3Zoom && st.d3Selection) st.d3Zoom.scaleTo(st.d3Selection, z);
    else api.rf.zoomTo(z, { duration: ms });
    setTimeout(vpTouched, (ms || 0) + 20);
  }
  function zoom100() { zoomGoal = 0; cancelWheelZoom(); if (api) zoomTo(1, dur(220)); }
  function setTool(t) {
    if (board && board.id === HOME_ID && t !== "select" && t !== "hand") return;   // Beranda = graf jejak saja
    if (t === "image") { pickImage(); return; }
    if (t === "doc" && !pendingDoc) { if (dom) openMenu("docs", dom.docBtn); return; }
    if (!["select", "hand", "connect"].concat(PLACE).includes(t)) return;
    if (t !== "doc") pendingDoc = null;
    if (t !== tool) { tool = t; renderFlow(); }
    if (t !== "shape" && t !== "note" && menu && (menu.kind === "shape" || menu.kind === "note")) closeMenu();
    updateChrome();
  }
  function setBare(on) {
    bare = !!on;
    lsSet("novelist_hc_bare", bare);
    closeMenu();
    updateChrome();
  }
  function setMini(on) { mini = !!on; lsSet("novelist_hc_minimap", mini); renderFlow(); updateChrome(); }
  // filter jejak (per project, di perangkat ini)
  function loadFilter() {
    const v = lsGet("novelist_hctrail_" + projId);
    tf = { hide: {}, threads: !(v && v.threads === false), parents: !(v && v.parents === false) };
    if (v && Array.isArray(v.hide)) v.hide.forEach((k) => { if (KINDS[k]) tf.hide[k] = true; });
  }
  function saveFilter() { lsSet("novelist_hctrail_" + projId, { hide: Object.keys(tf.hide).filter((k) => tf.hide[k]), threads: tf.threads, parents: tf.parents }); }
  function filterChanged(act, arg) {
    saveFilter();
    rev++; renderFlow(); updateChrome();
    if (menu && menu.kind === "filter") {   // menu filter tetap terbuka, fokus kembali ke pilihan yang sama
      openMenu("filter", menu.anchor);
      const b = dom.pop.querySelector(`[data-act="${act}"]${arg ? `[data-arg="${CSS.escape(arg)}"]` : ""}`);
      if (b) b.focus({ preventScroll: true });
    } else closeMenu();
  }

  // jalankan aksi dari menu / bilah / tombol
  function runAct(act, arg) {
    switch (act) {
      case "board": switchBoard(arg); break;
      case "newboard": newBoard(); break;
      case "rename": startRename(); break;
      case "delboard": deleteBoard(); break;
      case "addscenes": openMenu("scenes", dom.boardBtn); return;
      case "addsc": addSceneToBoard(arg); break;
      case "fit": fit(); break;
      case "zoom100": zoom100(); break;
      case "zoomin": zoomBy(1); break;
      case "zoomout": zoomBy(-1); break;
      case "undo": undo(); break;
      case "redo": redo(); break;
      case "seq": if (board.id === HOME_ID) { board.seq = board.seq !== true; changed(null); } break;
      case "minimap": setMini(!mini); break;
      case "bare": setBare(!bare); break;
      case "preview": if (ctx.preview) ctx.preview(); break;
      case "theme": if (ctx.toggleTheme) ctx.toggleTheme(); break;
      case "help": openMenu("help", dom.help); return;
      case "export": exportPng(); break;
      case "clear": clearBoard(); break;
      case "close": if (ctx.closeTab) ctx.closeTab(); break;
      case "open": {
        const ms = selModels(), trs = selTrail();
        if (ms.length === 1 && !trs.length) { const m = ms[0]; if (m.t === "scene") openScene(m.sceneId); else if (m.t === "doc") openCard(m); }
        else if (!ms.length && trs.length === 1) openEntry(trs[0]);
        break;
      }
      case "edit": { const m = selModels()[0]; if (m) startEdit(m.id); break; }
      case "dup": duplicate(); break;
      case "copy": copySel(); toast("Disalin — tempel dengan " + MOD + "+V."); break;
      case "paste": pasteClip(); break;
      case "front": reorder(true); break;
      case "back": reorder(false); break;
      case "del": deleteSel(); break;
      case "color": setColor(arg); break;
      case "shapekind": { const ms = selModels().filter((m) => m.t === "shape"); if (ms.length && SHAPES.includes(arg)) { mutate(() => { ms.forEach((m) => { m.shape = arg; }); }); shapeKind = arg; } break; }
      case "tsize": { const ms = selModels().filter((m) => m.t === "text"); if (ms.length && TEXT_SIZES[arg]) mutate(() => { ms.forEach((m) => { m.size = arg; }); }); break; }
      case "pickshape": if (SHAPES.includes(arg)) { shapeKind = arg; setTool("shape"); } closeMenu(); return;
      case "pickshapecolor": if (COLORS[arg]) { shapeColor = arg; updateChrome(); if (menu) openMenu("shape", menu.anchor); } return;
      case "picknotecolor": if (NOTE_COLORS[arg]) { noteColor = arg; updateChrome(); if (menu) openMenu("note", menu.anchor); } return;
      case "addhere": addAt(arg, ctxPos); break;
      case "addimage": pickImage(); break;
      case "adddoc": closeMenu(); setTool("doc"); return;
      case "selall": selectAll(); break;
      case "elabel": if (api && arg) api.setEditing("e:" + arg); break;
      case "estyle": { const ee = board.edges.find((x) => x.id === arg); if (ee) mutate(() => { if (ee.style === "thread") delete ee.style; else ee.style = "thread"; }, [arg]); break; }
      case "tobrain": { const bs = cvs().boards.filter((b) => b.id !== HOME_ID); if (bs.length) openMenu("boards", dom.boardBtn); else newBoard(); return; }
      case "quickdoc": if (board.id !== HOME_ID && KINDS[arg]) { dm = { kind: arg, q: "" }; openMenu("doclist", dom.tools.querySelector(`[data-act="quickdoc"][data-arg="${arg}"]`) || dom.docBtn); } return;
      case "edel": if (arg) mutate(() => { board.edges = board.edges.filter((e) => e.id !== arg); }, []); break;
      // alat Dokumen
      case "doctile": {
        const T = TILES.find((x) => x.id === arg);
        if (!T) return;
        dm = { kind: T.id === "card" ? (ORG.includes(dm.kind) ? dm.kind : "characters") : T.kind, q: "" };
        openMenu("doclist", menu && menu.anchor ? menu.anchor : dom.docBtn);
        return;
      }
      case "docback": openMenu("docs", menu && menu.anchor ? menu.anchor : dom.docBtn); return;
      case "doccat": if (ORG.includes(arg)) { dm.kind = arg; openMenu("doclist", menu && menu.anchor ? menu.anchor : dom.docBtn); } return;
      case "docpick": { const s = String(arg || ""), i = s.indexOf("|"); if (i > 0) startPlaceDoc(s.slice(0, i), s.slice(i + 1), kbdClick); return; }
      case "docnew": createFromMenu(kbdClick); return;
      // filter jejak (menu tetap terbuka)
      case "filter": openMenu("filter", dom.filterBtn); return;
      case "tthreads": tf.threads = !tf.threads; filterChanged(act); return;
      case "tparents": tf.parents = !tf.parents; filterChanged(act); return;
      case "tkind": if (KINDS[arg]) { if (tf.hide[arg]) delete tf.hide[arg]; else tf.hide[arg] = true; filterChanged(act, arg); } return;
      case "tall": tf.hide = {}; tf.threads = true; filterChanged(act); return;
      case "latest": closeMenu(); focusLatest(); return;
    }
    if (menu && menu.kind !== "shape" && menu.kind !== "note") closeMenu();
  }

  // ================= PANEL (DOM biasa): kepala, tombol tepi, bilah alat, menu =================
  // ilustrasi kecil ubin alat Dokumen (SVG/CSS; peta memakai gambar mini peta project bila ada)
  function tileArt(id) {
    switch (id) {
      case "card": return '<svg viewBox="0 0 64 44" aria-hidden="true"><rect x="19" y="3" width="26" height="38" rx="4" fill="#e9d9bd"/><rect x="21.5" y="5.5" width="21" height="25" rx="2" fill="#c9a77e"/><circle cx="32" cy="15" r="5" fill="#7a5638"/><path d="M23.5 30.5c.8-6 4.3-8.6 8.5-8.6s7.7 2.6 8.5 8.6z" fill="#7a5638"/><rect x="23" y="34" width="18" height="2.2" rx="1.1" fill="#a68a66"/></svg>';
      case "map": {
        const ms = isObj(ctx.project.data) && Array.isArray(ctx.project.data.maps) ? ctx.project.data.maps : [];
        const u = ms.length ? mapThumb(ms[ms.length - 1]) : null;
        if (u) return `<span class="hc-tile-img" style="background-image:url('${u}')"></span>`;
        return '<svg viewBox="0 0 64 44" aria-hidden="true"><rect width="64" height="44" fill="#4d82a3"/><path d="M14 30c-4-6 2-14 9-14 3-6 13-8 18-3 7-1 12 5 9 11 3 5-2 11-9 10-5 4-14 4-18 0-5 1-8-1-9-4z" fill="#d9cf9a"/><path d="M19 28c0-4 4-8 9-8 2-4 9-5 12-1 5 0 8 4 6 8 2 3-2 7-6 6-4 3-10 3-13 0-4 1-8-1-8-5z" fill="#93b467"/><path d="M22 26 30 21 39 24 44 19" fill="none" stroke="#fff" stroke-width="1.2" stroke-dasharray="2 2"/><circle cx="44" cy="19" r="2.4" fill="#e15c5c"/></svg>';
      }
      case "board": return '<svg viewBox="0 0 64 44" aria-hidden="true"><rect width="64" height="44" fill="#2a2d36"/><g fill="#555b68"><circle cx="8" cy="8" r=".8"/><circle cx="20" cy="8" r=".8"/><circle cx="32" cy="8" r=".8"/><circle cx="44" cy="8" r=".8"/><circle cx="56" cy="8" r=".8"/><circle cx="8" cy="36" r=".8"/><circle cx="56" cy="36" r=".8"/></g><rect x="7" y="12" width="15" height="14" rx="1.5" fill="#f6d97a" transform="rotate(-4 14 19)"/><rect x="25" y="9" width="15" height="14" rx="1.5" fill="#f5adc8"/><rect x="43" y="13" width="14" height="13" rx="1.5" fill="#a9cff5" transform="rotate(5 50 19)"/><rect x="14" y="28" width="20" height="11" rx="2" fill="#8f97ab"/><path d="M16 37l5-5 4 3 3-2 4 4z" fill="#c9cfdb"/><rect x="38" y="30" width="18" height="2" rx="1" fill="#c9cdd6"/><rect x="38" y="34" width="12" height="2" rx="1" fill="#8d93a0"/></svg>';
      case "jejaring": return '<svg viewBox="0 0 64 44" aria-hidden="true"><g stroke="#c7ccd6" stroke-width="1.1" fill="none"><path d="M32 12v8M20 20h24M20 20v6M44 20v6M14 30h12M20 30v0"/></g><circle cx="32" cy="9" r="5" fill="#f5a66b"/><circle cx="20" cy="29" r="5" fill="#6aa8ff"/><circle cx="44" cy="29" r="5" fill="#ec7fb0"/><circle cx="32" cy="38" r="3.4" fill="#5fc3a0"/><path d="M20 34l12 4M44 34l-12 4" stroke="#c7ccd6" stroke-width="1" fill="none" stroke-dasharray="1.6 1.6"/></svg>';
      case "timeline": return '<svg viewBox="0 0 64 44" aria-hidden="true"><line x1="5" y1="28" x2="59" y2="28" stroke="#c7ccd6" stroke-width="1.6" stroke-linecap="round"/><line x1="15" y1="28" x2="15" y2="16" stroke="#c7ccd6" stroke-width="1"/><line x1="33" y1="28" x2="33" y2="20" stroke="#c7ccd6" stroke-width="1"/><line x1="48" y1="28" x2="48" y2="13" stroke="#c7ccd6" stroke-width="1"/><rect x="8" y="10" width="15" height="6" rx="3" fill="#d7a86e"/><rect x="27" y="14" width="13" height="6" rx="3" fill="#6aa8ff"/><rect x="42" y="7" width="15" height="6" rx="3" fill="#4caf82"/><circle cx="15" cy="28" r="2.6" fill="#d7a86e"/><circle cx="33" cy="28" r="2.6" fill="#6aa8ff"/><circle cx="48" cy="28" r="2.6" fill="#4caf82"/></svg>';
      case "scene": return '<svg viewBox="0 0 64 44" aria-hidden="true"><rect x="18" y="3" width="28" height="38" rx="3" fill="#f3efe6"/><rect x="22" y="8" width="14" height="2.6" rx="1.3" fill="#3c3a35"/><g fill="#a9a497"><rect x="22" y="14" width="20" height="1.6" rx=".8"/><rect x="22" y="18" width="19" height="1.6" rx=".8"/><rect x="22" y="22" width="20" height="1.6" rx=".8"/><rect x="22" y="26" width="14" height="1.6" rx=".8"/><rect x="22" y="31" width="20" height="1.6" rx=".8"/><rect x="22" y="35" width="11" height="1.6" rx=".8"/></g><circle cx="42" cy="9.3" r="2" fill="#d7a86e"/></svg>';
      case "story": return '<svg viewBox="0 0 64 44" aria-hidden="true"><rect x="21" y="3" width="25" height="38" rx="2.5" fill="#3d2b7c"/><rect x="21" y="3" width="4" height="38" rx="1.5" fill="#2a1d57"/><path d="M28 12h13M29 16h11" stroke="#e8dcff" stroke-width="1.4" stroke-linecap="round"/><circle cx="34.5" cy="27" r="4" fill="none" stroke="#c2709c" stroke-width="1.2"/><path d="M46 6l2.5 1v34l-2.5 0z" fill="#e8e1d3"/></svg>';
    }
    return "";
  }
  function chromeHtml() {
    const tb = (id, label, key, inner, cls, extra) => `<button type="button" class="hc-tool${cls ? " " + cls : ""}" data-tool="${id}" aria-pressed="false" aria-label="${label} (${key})" data-tip="${label} · ${key}" data-tip-pos="top"${extra || ""}>${inner}</button>`;
    return `<div class="hc-panel" data-lenis-prevent>
      <div class="hc-flow"></div>
      <header class="hc-head">
        <div class="hc-board">
          <button type="button" class="hc-board-btn" aria-haspopup="menu" aria-expanded="false" aria-label="Pilih papan">
            <span class="hc-board-title"></span>${icS("#ti-chevron-down", 14)}
          </button>
          <input class="hc-board-input hidden" maxlength="80" aria-label="Nama papan" spellcheck="false" autocomplete="off" />
          <span class="hc-board-sub"></span>
        </div>
        <div class="hc-head-right">
          <button type="button" class="hc-pill" data-act="help" aria-haspopup="dialog">${icS("#ti-keyboard", 14)}<span>Pintasan</span></button>
          <button type="button" class="hc-zoom" data-act="zoom100" data-tip="Zoom 100% · Shift+0" aria-label="Zoom 100%">100%</button>
          <button type="button" class="hc-ibtn" data-act="more" aria-haspopup="menu" aria-expanded="false" aria-label="Menu kanvas" data-tip="Lainnya">${icS("#ti-dots", 17)}</button>
          <button type="button" class="hc-ibtn hc-bare-btn" data-act="bare" aria-pressed="false" aria-label="Sembunyikan antarmuka" data-tip="Sembunyikan antarmuka">${icS("#ti-eye-off", 16)}${icS("#ti-eye", 16)}</button>
          <button type="button" class="hc-ibtn hc-close-btn" data-act="close" aria-label="Tutup tab Beranda" data-tip="Tutup tab Beranda">${icS("#ti-x", 16)}</button>
        </div>
      </header>
      <div class="hc-rail">
        <div class="hc-side" role="group" aria-label="Tampilan kanvas">
          <button type="button" class="hc-sbtn" data-act="preview" aria-label="Preview manuskrip" data-tip="Preview manuskrip">${icS("#ti-eye", 16)}</button>
          <span class="hc-side-sep" aria-hidden="true"></span>
          <button type="button" class="hc-sbtn" data-act="zoomin" aria-label="Perbesar" data-tip="Perbesar · + / roda mouse">${icS("#ti-zoom-in", 16)}</button>
          <button type="button" class="hc-sbtn" data-act="zoomout" aria-label="Perkecil" data-tip="Perkecil · − / roda mouse">${icS("#ti-zoom-out", 16)}</button>
          <button type="button" class="hc-sbtn" data-act="fit" aria-label="Pas ke layar" data-tip="Pas ke layar · Shift+1">${icS("#ti-focus-centered", 16)}</button>
          <span class="hc-side-sep" aria-hidden="true"></span>
          <button type="button" class="hc-sbtn" data-act="minimap" aria-pressed="false" aria-label="Peta mini" data-tip="Peta mini">${icS("#ti-map-2", 16)}</button>
        </div>
        <div class="hc-side hc-side-trail" role="group" aria-label="Jejak dokumen">
          <button type="button" class="hc-sbtn hc-filter-btn" data-act="filter" aria-haspopup="menu" aria-expanded="false" aria-label="Filter jejak dokumen" data-tip="Filter jejak">${icS("#ti-adjustments-horizontal", 16)}<span class="hc-badge" aria-hidden="true"></span></button>
          <button type="button" class="hc-sbtn" data-act="latest" aria-label="Ke jejak terbaru" data-tip="Ke dokumen terbaru">${icS("#ti-history", 16)}</button>
        </div>
      </div>
      <div class="hc-hint" aria-live="polite"></div>
      <div class="hc-empty hidden"></div>
      <div class="hc-tools-wrap">
        <div class="hc-tools" role="toolbar" aria-label="Alat kanvas">
          ${tb("select", "Pilih", "V", icS("#ti-pointer-filled", 18), "hc-t-sm")}
          ${tb("hand", "Geser", "H", icS("#ti-hand-stop", 18), "hc-t-sm")}
          <span class="hc-tsep" aria-hidden="true"></span>
          <button type="button" class="hc-tool hc-t-cta hc-home-only" data-act="tobrain" aria-label="Brainstorm: tambah & sambungkan karakter, tempat, catatan" data-tip="Tambah & sambungkan ide di papan Brainstorm" data-tip-pos="top">${icS("#ti-bulb", 17)}<span>Brainstorm</span></button>
          <button type="button" class="hc-tool hc-t-quick hc-brain-only" data-act="quickdoc" data-arg="characters" aria-haspopup="menu" aria-label="Tambah karakter (baru atau yang sudah ada)" data-tip="Karakter — baru / yang sudah ada" data-tip-pos="top">${icS("#ti-user-plus", 17)}<span>Karakter</span></button>
          <button type="button" class="hc-tool hc-t-quick hc-brain-only" data-act="quickdoc" data-arg="locations" aria-haspopup="menu" aria-label="Tambah tempat (baru atau yang sudah ada)" data-tip="Tempat — baru / yang sudah ada" data-tip-pos="top">${icS("#ti-map-pin-plus", 17)}<span>Tempat</span></button>
          <span class="hc-tsep hc-brain-only" aria-hidden="true"></span>
          ${tb("shape", "Bentuk", "S", `<span class="hc-shape-ic">${icS("#ti-triangle-filled", 26)}</span>`, "hc-t-big", ' aria-haspopup="menu"')}
          ${tb("doc", "Dokumen", "D", `<span class="hc-doc-prev" aria-hidden="true"><i></i><i>${icS("#ti-user", 12)}</i></span>`, "hc-t-big", ' aria-haspopup="menu" aria-expanded="false"')}
          ${tb("note", "Catatan tempel", "N", '<span class="hc-note-prev" aria-hidden="true"><i></i><i></i><i></i></span>', "hc-t-big")}
          <button type="button" class="hc-tool hc-t-big" data-act="image" aria-label="Gambar (I)" data-tip="Gambar · I" data-tip-pos="top"><span class="hc-img-prev" aria-hidden="true">${icS("#ti-photo", 16)}</span></button>
          <span class="hc-tsep" aria-hidden="true"></span>
          ${tb("connect", "Benang / penghubung", "C", `<span class="hc-conn-ic" aria-hidden="true">${icS("#ti-square-filled", 13)}${icS("#ti-circle-filled", 13)}${icS("#ti-arrow-up-right", 12)}</span>`)}
          ${tb("text", "Teks", "T", icS("#ti-letter-t", 19))}
          ${tb("frame", "Frame", "F", icS("#ti-app-window", 19))}
        </div>
      </div>
      <div class="hc-pop hidden"></div>
      <div class="hc-toast" role="status" aria-live="polite"></div>
      <input type="file" class="hc-file" accept="image/*" multiple hidden />
    </div>`;
  }
  function mountChrome() {
    host = document.getElementById("homeCanvas");
    if (dom && host.contains(dom.panel)) return;
    host.innerHTML = chromeHtml();
    const q = (s) => host.querySelector(s);
    dom = {
      panel: q(".hc-panel"), flow: q(".hc-flow"), head: q(".hc-head"), boardBtn: q(".hc-board-btn"), title: q(".hc-board-title"),
      titleInput: q(".hc-board-input"), sub: q(".hc-board-sub"), zoom: q(".hc-zoom"), more: q('[data-act="more"]'), help: q('[data-act="help"]'),
      bareBtn: q(".hc-bare-btn"), miniBtn: q('[data-act="minimap"]'), hint: q(".hc-hint"), empty: q(".hc-empty"), tools: q(".hc-tools"),
      notePrev: q(".hc-note-prev"), imgPrev: q(".hc-img-prev"), pop: q(".hc-pop"), toast: q(".hc-toast"), file: q(".hc-file"),
      trailSide: q(".hc-side-trail"), filterBtn: q(".hc-filter-btn"), docBtn: q('[data-tool="doc"]'),
    };
    zoomShown = "";
    dom.panel.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b || !dom.panel.contains(b) || b.disabled) return;
      kbdClick = e.detail === 0;   // Enter/Spasi pada tombol
      if (b === dom.boardBtn) { toggleMenu("boards", b); return; }
      if (b.closest(".hc-pop")) { if (b.dataset.act) runAct(b.dataset.act, b.dataset.arg); return; }
      if (b.dataset.tool) {
        const t = b.dataset.tool;
        if (t === "shape") { setTool("shape"); toggleMenu("shape", b); return; }
        if (t === "note") { setTool("note"); toggleMenu("note", b); return; }
        if (t === "doc") { if (menu && (menu.kind === "docs" || menu.kind === "doclist")) closeMenu(); else openMenu("docs", b); return; }
        closeMenu();
        setTool(t);
        return;
      }
      if (b.dataset.act === "more") { toggleMenu("more", b); return; }
      if (b.dataset.act === "help") { toggleMenu("help", b); return; }
      if (b.dataset.act === "filter") { toggleMenu("filter", b); return; }
      if (b.dataset.act) runAct(b.dataset.act, b.dataset.arg);
    });
    dom.file.addEventListener("change", () => { addImages(dom.file.files, null); dom.file.value = ""; });
    dom.titleInput.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") { e.preventDefault(); endRename(true); dom.boardBtn.focus(); }
      else if (e.key === "Escape") { e.preventDefault(); endRename(false); dom.boardBtn.focus(); }
    });
    dom.titleInput.addEventListener("blur", () => endRename(true));
    // roda / trackpad: zoom halus di titik kursor (fase capture: sebelum React Flow)
    dom.flow.addEventListener("wheel", onWheel, { passive: false, capture: true });
    // seret gambar dari komputer ke kanvas
    const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files");
    dom.flow.addEventListener("dragover", (e) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = "copy"; dom.panel.classList.add("is-drop"); });
    dom.flow.addEventListener("dragleave", (e) => { if (!dom.flow.contains(e.relatedTarget)) dom.panel.classList.remove("is-drop"); });
    dom.flow.addEventListener("drop", (e) => {
      dom.panel.classList.remove("is-drop");
      if (!hasFiles(e)) return;
      e.preventDefault();
      let at = null;
      try { at = api.rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }); } catch (er) { at = null; }
      addImages(e.dataTransfer.files, at);
    });
    dom.pop.addEventListener("keydown", onMenuKey);
    // daftar alat Dokumen: cari langsung saat mengetik
    dom.pop.addEventListener("input", (e) => {
      if (!e.target.classList.contains("hc-dl-input") || !menu || menu.kind !== "doclist") return;
      dm.q = e.target.value.slice(0, 120);
      const L = dom.pop.querySelector(".hc-dl-list");
      if (L) L.innerHTML = docListHtml();
    });
  }

  function updateChrome() {
    if (!dom || !board) return;
    const home = board.id === HOME_ID;
    dom.title.textContent = board.title;
    const T = home ? trailArr() : [], other = board.nodes.length;
    const hidden = T.filter((e) => tf.hide[e.kind]).length;
    dom.sub.textContent = home ? `${T.length} dokumen${hidden ? " (" + hidden + " disembunyikan)" : ""}${other ? " · " + other + " objek" : ""}` : `${other} objek`;
    const t = space ? "hand" : tool;
    dom.panel.dataset.tool = t;
    dom.panel.classList.toggle("is-bare", bare);
    dom.tools.querySelectorAll("[data-tool]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.tool === t ? "true" : "false"));
    const bareTip = bare ? "Tampilkan antarmuka" : "Sembunyikan antarmuka";
    dom.bareBtn.setAttribute("aria-pressed", bare ? "true" : "false");
    dom.bareBtn.dataset.tip = bareTip;
    dom.bareBtn.setAttribute("aria-label", bareTip);
    dom.miniBtn.setAttribute("aria-pressed", mini ? "true" : "false");
    dom.trailSide.classList.toggle("hidden", !home);
    dom.panel.classList.toggle("is-home", home);
    dom.panel.classList.toggle("is-brain", !home);
    dom.filterBtn.classList.toggle("is-on", !!hidden || !tf.threads);
    dom.notePrev.style.setProperty("--c", NOTE_COLORS[noteColor]);
    const img = [...board.nodes].reverse().find((n) => n.t === "image");
    dom.imgPrev.style.backgroundImage = img ? `url("${img.src}")` : "";
    dom.imgPrev.classList.toggle("has-img", !!img);
    let docName = "";
    if (t === "doc" && pendingDoc) { const r = docIndex(ctx.project).map.get(pendingDoc.kind + ":" + pendingDoc.ref); docName = r ? docTitle(r) : ""; }
    const hints = {
      shape: `Klik atau seret di kanvas untuk menaruh ${SHAPE_NAMES[shapeKind]} · Esc batal`,
      note: "Klik atau seret di kanvas untuk menaruh catatan · Esc batal",
      text: "Klik di kanvas untuk menulis teks · Esc batal",
      frame: "Seret di kanvas untuk membuat frame · Esc batal",
      doc: `Klik atau seret di kanvas untuk menaruh kartu “${docName}” · Esc batal`,
      connect: "Seret dari satu objek ke objek lain (atau klik keduanya) untuk menghubungkan · Esc selesai",
    };
    dom.hint.textContent = hints[t] || "";
    dom.hint.classList.toggle("is-on", !!hints[t]);
    const empty = home ? !board.nodes.length && T.length === hidden : !board.nodes.length;
    dom.empty.classList.toggle("hidden", !empty);
    if (empty) {
      dom.empty.innerHTML = home
        ? (T.length
          ? `<span class="hc-empty-ic">${icS("#ti-adjustments-horizontal", 22)}</span><p>Semua jejak disembunyikan</p><small>Buka filter jejak di tepi kanan untuk menampilkan jenis dokumen lagi.</small>`
          : `<span class="hc-empty-ic">${icS("#ti-route", 22)}</span><p>Belum ada jejak</p><small>Setiap scene, bab, karakter, peta, timeline, cerita & tree relasi yang kamu buat muncul di sini sebagai titik yang tersambung benang — klik titiknya untuk kembali ke dokumen itu.</small>`)
        : `<span class="hc-empty-ic">${icS("#ti-bulb", 22)}</span><p>Papan brainstorm masih kosong</p><small>Tambah <b>Karakter</b> atau <b>Tempat</b> (baru atau yang sudah ada), catatan, bentuk, gambar & teks dari bilah bawah, lalu sambungkan dengan alat <b>Benang</b> (C). Seret latar untuk menggeser, roda mouse untuk zoom.</small>`;
    }
  }

  // ---------- menu / popover ----------
  function item(o) {
    if (o.sep) return '<div class="hc-mi-sep" role="separator"></div>';
    if (o.head) return `<div class="hc-mi-head">${esc(o.head)}</div>`;
    const role = o.check !== undefined ? (o.radio ? "menuitemradio" : "menuitemcheckbox") : "menuitem";
    return `<button type="button" class="hc-mi${o.danger ? " is-danger" : ""}${o.cls ? " " + o.cls : ""}" role="${role}" data-act="${o.act}"${o.arg !== undefined ? ` data-arg="${esc(o.arg)}"` : ""}` +
      `${o.check !== undefined ? ` aria-checked="${o.check ? "true" : "false"}"` : ""}${o.disabled ? " disabled" : ""}${o.title ? ` title="${esc(o.title)}"` : ""}>` +
      `<span class="hc-mi-ic">${o.ic || ""}</span><span class="hc-mi-label">${esc(o.label)}${o.sub ? `<small>${esc(o.sub)}</small>` : ""}</span>` +
      `${o.kbd ? `<kbd>${esc(o.kbd)}</kbd>` : ""}${o.check ? `<span class="hc-mi-check">${icS("#ti-check", 14)}</span>` : ""}</button>`;
  }
  // daftar dokumen satu jenis (alat Dokumen) + "Buat baru"
  function docListHtml() {
    const ix = docIndex(ctx.project), kind = dm.kind, K = KINDS[kind], q = dm.q.trim().toLowerCase();
    const onBoard = new Set(board.nodes.filter((n) => n.t === "doc").map((n) => n.kind + ":" + n.ref));
    const list = ix.list.filter((r) => r.kind === kind && !(kind === "board" && r.id === board.id))
      .filter((r) => !q || (docTitle(r) + " " + (r.kind === "scene" ? String(r.obj.synopsis || "") : "")).toLowerCase().includes(q));
    const rows = list.slice(0, 200).map((r) => {
      const meta = docMeta(r, ix), sub = r.kind === "scene" ? meta.path + " · " + meta.meta : ORG.includes(r.kind) ? (meta.snip ? meta.snip.slice(0, 80) : "Belum ada deskripsi") : meta.meta || meta.path;
      return `<button type="button" class="hc-mi hc-dl-item" role="menuitem" data-act="docpick" data-arg="${esc(r.kind + "|" + r.id)}">` +
        `<span class="hc-mi-ic hc-dl-ic" style="${kAttr(r.kind)}">${icS(K.icon, 14)}</span><span class="hc-mi-label">${esc(docTitle(r))}${sub ? `<small>${esc(sub)}</small>` : ""}</span>` +
        `${onBoard.has(r.key) ? '<span class="hc-dl-on">di papan</span>' : ""}</button>`;
    }).join("");
    const none = !list.length ? `<p class="hc-mi-empty">${q ? "Tidak ada yang cocok." : `Belum ada ${NEW_NAMES[kind]} di project ini.`}</p>` : "";
    const viaTab = kind === "jejaring";
    const newLabel = `Buat ${NEW_NAMES[kind]} baru${dm.q.trim() && !viaTab ? ` “${dm.q.trim()}”` : ""}${viaTab ? "…" : ""}`;
    return rows + none + '<div class="hc-mi-sep" role="separator"></div>' +
      `<button type="button" class="hc-mi hc-dl-new" role="menuitem" data-act="docnew"${viaTab ? ' title="Dibuat lewat wizard di tab Tree Relations"' : ""}><span class="hc-mi-ic">${icS("#ti-plus", 15)}</span><span class="hc-mi-label">${esc(newLabel)}${viaTab ? "<small>Lewat wizard di tab Tree Relations — kartunya ditaruh di sini setelah dibuat</small>" : ""}</span></button>`;
  }
  function menuHtml(kind, o) {
    const home = board.id === HOME_ID, x = H();
    if (kind === "boards") {
      const row = (b) => ({
        act: "board", arg: b.id, label: b.title, check: b === board, radio: true,
        ic: b.id === HOME_ID ? icS("#ti-home", 15) : icS("#ti-bulb", 15),
        sub: b.id === HOME_ID ? "Graf · " + trailArr().length + " dokumen di jejak" : b.nodes.length + " objek",
      });
      const bs = cvs().boards.filter((b) => b.id !== HOME_ID);
      return [{ head: "Beranda" }, row(cvs().boards.find((b) => b.id === HOME_ID))].concat([{ head: "Brainstorm" }], bs.map(row),
        bs.length ? [] : [{ act: "newboard", label: "Belum ada papan brainstorm", ic: icS("#ti-bulb", 15), sub: "Klik untuk membuat yang pertama" }], [{ sep: 1 },
        { act: "newboard", label: "Brainstorm baru", ic: icS("#ti-plus", 15) },
        { act: "rename", label: "Ganti nama papan", ic: icS("#ti-pencil", 15) },
        home ? null : { act: "addscenes", label: "Tambah scene ke papan…", ic: icS("#ti-file-plus", 15) },
        home ? null : { act: "delboard", label: "Hapus papan", ic: icS("#ti-trash", 15), danger: true },
      ].filter(Boolean)).map(item).join("");
    }
    if (kind === "scenes") {
      const on = new Set(board.nodes.filter((n) => n.t === "scene").map((n) => n.sceneId));
      const list = sceneInfo().order.filter((s) => !on.has(s.id));
      return item({ head: "Tambah scene" }) + (list.length ? `<div class="hc-mi-scroll">${list.map((s) => item({ act: "addsc", arg: s.id, label: String(s.title || "").trim() || "(tanpa judul)", ic: icS("#ti-file-text", 15) })).join("")}</div>`
        : '<p class="hc-mi-empty">Semua scene sudah ada di papan ini.</p>');
    }
    if (kind === "more") {
      const light = document.body.classList.contains("light");
      return [
        { act: "fit", label: "Pas ke layar", ic: icS("#ti-focus-centered", 15), kbd: "Shift+1" },
        { act: "zoom100", label: "Zoom 100%", ic: icS("#ti-zoom-reset", 15), kbd: "Shift+0" },
        { act: "undo", label: "Urungkan", ic: icS("#ti-arrow-back-up", 15), kbd: MOD + "+Z", disabled: !x.undo.length },
        { act: "redo", label: "Ulangi", ic: icS("#ti-arrow-forward-up", 15), kbd: MOD + "+Shift+Z", disabled: !x.redo.length },
        { sep: 1 },
        home ? { act: "seq", label: "Garis urutan scene", ic: icS("#ti-line-dashed", 15), check: board.seq === true } : null,
        { act: "minimap", label: "Peta mini", ic: icS("#ti-map-2", 15), check: mini },
        { act: "bare", label: bare ? "Tampilkan antarmuka" : "Sembunyikan antarmuka", ic: bare ? icS("#ti-eye", 15) : icS("#ti-eye-off", 15) },
        { act: "preview", label: "Preview manuskrip", ic: icS("#ti-eye", 15) },
        { act: "theme", label: light ? "Tema gelap" : "Tema terang", ic: light ? icS("#ti-moon", 15) : icS("#ti-sun", 15) },
        { act: "help", label: "Pintasan keyboard", ic: icS("#ti-keyboard", 15) },
        { sep: 1 },
        { act: "export", label: "Ekspor PNG", ic: icS("#ti-download", 15) },
        { act: "clear", label: "Bersihkan papan", ic: icS("#ti-eraser", 15), danger: true },
      ].filter(Boolean).map(item).join("");
    }
    if (kind === "node") {
      const ms = selModels(), trs = selTrail(), one = ms.length === 1 && !trs.length ? ms[0] : null;
      if (!ms.length && trs.length) {
        const r = trs.length === 1 && docIndex(ctx.project).map.get(tkey(trs[0]));
        return [
          r ? { act: "open", label: r.kind === "scene" ? "Buka di Tulis" : "Buka " + KINDS[r.kind].name.toLowerCase(), ic: icS("#ti-arrow-up-right", 15), kbd: "Enter" } : null,
          r ? { act: "tkind", arg: r.kind, label: "Sembunyikan jenis " + KINDS[r.kind].name.toLowerCase(), ic: icS("#ti-eye-off", 15) } : null,
          { act: "filter", label: "Filter jejak…", ic: icS("#ti-adjustments-horizontal", 15) },
        ].filter(Boolean).map(item).join("");
      }
      return [
        one && one.t === "scene" ? { act: "open", label: "Buka di Tulis", ic: icS("#ti-pencil", 15) } : null,
        one && one.t === "doc" ? { act: "open", label: "Buka dokumen", ic: icS("#ti-arrow-up-right", 15), kbd: "Enter", disabled: !docIndex(ctx.project).map.has(one.kind + ":" + one.ref) } : null,
        one && EDITABLE.includes(one.t) ? { act: "edit", label: "Edit teks", ic: icS("#ti-cursor-text", 15), kbd: "Enter" } : null,
        { act: "dup", label: "Duplikat", ic: icS("#ti-copy-plus", 15), kbd: MOD + "+D", disabled: !ms.some(canCopy) },
        { act: "copy", label: "Salin", ic: icS("#ti-copy", 15), kbd: MOD + "+C", disabled: !ms.length },
        { act: "front", label: "Bawa ke depan", ic: icS("#ti-stack-front", 15), kbd: MOD + "+]", disabled: !ms.length },
        { act: "back", label: "Kirim ke belakang", ic: icS("#ti-stack-back", 15), kbd: MOD + "+[", disabled: !ms.length },
        { sep: 1 },
        { act: "del", label: "Hapus", ic: icS("#ti-trash", 15), kbd: "Del", danger: true, disabled: !ms.some(deletable) },
      ].filter(Boolean).map(item).join("");
    }
    if (kind === "edge") {
      const ee = board.edges.find((x) => x.id === o.arg), th = !!(ee && ee.style === "thread");
      return [{ act: "elabel", arg: o.arg, label: "Edit label", ic: icS("#ti-pencil", 15) },
        { act: "estyle", arg: o.arg, label: th ? "Jadikan panah" : "Jadikan benang tipis", ic: th ? icS("#ti-arrow-up-right", 15) : icS("#ti-line", 15) },
        { act: "edel", arg: o.arg, label: "Hapus penghubung", ic: icS("#ti-trash", 15), danger: true }].map(item).join("");
    }
    if (kind === "pane" && home) {
      return [
        { act: "tobrain", label: "Buka papan Brainstorm…", ic: icS("#ti-bulb", 15) },
        { sep: 1 },
        { act: "selall", label: "Pilih semua", ic: icS("#ti-select-all", 15), kbd: MOD + "+A" },
        { act: "fit", label: "Pas ke layar", ic: icS("#ti-focus-centered", 15), kbd: "Shift+1" },
      ].map(item).join("");
    }
    if (kind === "pane") {
      return [
        { act: "paste", label: "Tempel", ic: icS("#ti-clipboard", 15), kbd: MOD + "+V", disabled: !clip },
        { sep: 1 },
        { act: "adddoc", label: "Kartu dokumen…", ic: icS("#ti-cards", 15), kbd: "D" },
        { act: "addhere", arg: "note", label: "Catatan di sini", ic: icS("#ti-note", 15) },
        { act: "addhere", arg: "shape", label: "Bentuk di sini", ic: icS("#ti-square", 15) },
        { act: "addhere", arg: "text", label: "Teks di sini", ic: icS("#ti-letter-t", 15) },
        { act: "addhere", arg: "frame", label: "Frame di sini", ic: icS("#ti-app-window", 15) },
        { act: "addimage", label: "Gambar…", ic: icS("#ti-photo", 15) },
        { sep: 1 },
        { act: "selall", label: "Pilih semua", ic: icS("#ti-select-all", 15), kbd: MOD + "+A" },
        { act: "fit", label: "Pas ke layar", ic: icS("#ti-focus-centered", 15), kbd: "Shift+1" },
      ].map(item).join("");
    }
    if (kind === "shape") {
      const sh = { rect: icS("#ti-square", 18), circle: icS("#ti-circle", 18), triangle: icS("#ti-triangle", 18), diamond: icS("#ti-diamond", 18) };
      return `<div class="hc-pick-head">Bentuk</div><div class="hc-pick-row">${SHAPES.map((k) => `<button type="button" class="hc-pick" data-act="pickshape" data-arg="${k}" aria-pressed="${k === shapeKind}" aria-label="${SHAPE_NAMES[k]}" title="${SHAPE_NAMES[k]}">${sh[k]}</button>`).join("")}</div>` +
        `<div class="hc-pick-head">Warna</div><div class="hc-pick-row">${Object.keys(COLORS).map((k) => `<button type="button" class="hc-sw" data-act="pickshapecolor" data-arg="${k}" style="--c:${COLORS[k]}" aria-pressed="${k === shapeColor}" aria-label="Warna ${COLOR_NAMES[k]}" title="${COLOR_NAMES[k]}"></button>`).join("")}</div>`;
    }
    if (kind === "note") {
      return `<div class="hc-pick-head">Warna catatan</div><div class="hc-pick-row">${Object.keys(NOTE_COLORS).map((k) => `<button type="button" class="hc-sw is-note" data-act="picknotecolor" data-arg="${k}" style="--c:${NOTE_COLORS[k]}" aria-pressed="${k === noteColor}" aria-label="Warna ${NOTE_NAMES[k]}" title="${NOTE_NAMES[k]}"></button>`).join("")}</div>` +
        '<p class="hc-pick-note">Klik di kanvas untuk menaruh catatan.</p>';
    }
    if (kind === "docs") {
      const ix = docIndex(ctx.project), cnt = (kinds) => ix.list.filter((r) => kinds.includes(r.kind) && !(r.kind === "board" && r.id === board.id)).length;
      return `<div class="hc-pick-head">Taruh dokumen di papan</div><div class="hc-tiles">${TILES.map((T) => {
        const n = cnt(T.id === "card" ? ORG : [T.kind]);
        return `<button type="button" class="hc-tile" data-act="doctile" data-arg="${T.id}" aria-label="${T.name} (${n})"><span class="hc-tile-art">${tileArt(T.id)}</span><span class="hc-tile-name">${T.name}</span><span class="hc-tile-n">${n}</span></button>`;
      }).join("")}</div>`;
    }
    if (kind === "doclist") {
      const K = KINDS[dm.kind], org = ORG.includes(dm.kind);
      return `<div class="hc-dl-head"><button type="button" class="hc-dl-back" data-act="docback" aria-label="Kembali ke jenis dokumen" title="Kembali">${icS("#ti-chevron-left", 16)}</button>` +
        `<span class="hc-dl-ic" style="${kAttr(dm.kind)}">${icS(org ? "#ti-cards" : K.icon, 15)}</span><b>${esc(LIST_NAMES[dm.kind])}</b></div>` +
        (org ? `<div class="hc-dl-seg" role="radiogroup" aria-label="Jenis kartu">${ORG.map((k) => `<button type="button" role="radio" class="hc-dl-segb" data-act="doccat" data-arg="${k}" aria-checked="${k === dm.kind}">${icS(KINDS[k].icon, 13)}${KINDS[k].name}</button>`).join("")}</div>` : "") +
        `<label class="hc-dl-search">${icS("#ti-search", 14)}<input class="hc-dl-input" type="search" value="${esc(dm.q)}" placeholder="Cari ${esc(K.name.toLowerCase())}, atau ketik nama baru…" aria-label="Cari ${esc(K.name)}" autocomplete="off" spellcheck="false" /></label>` +
        `<div class="hc-dl-list hc-mi-scroll" role="group" aria-label="Dokumen">${docListHtml()}</div>`;
    }
    if (kind === "filter") {
      const counts = {};
      trailArr().forEach((e) => { counts[e.kind] = (counts[e.kind] || 0) + 1; });
      const anyHidden = Object.keys(tf.hide).some((k) => tf.hide[k]);
      return [{ head: "Jejak dokumen" },
        { act: "tthreads", label: "Tampilkan benang jejak", sub: "Garis tipis antar-dokumen, urut waktu dibuat", ic: icS("#ti-route", 15), check: tf.threads },
        { act: "tparents", label: "Benang ke bab & cerita", sub: "Scene ke babnya, chapter ke ceritanya", ic: icS("#ti-git-commit", 15), check: tf.parents },
        { sep: 1 }, { head: "Jenis dokumen" },
      ].concat(Object.keys(KINDS).map((k) => ({
        act: "tkind", arg: k, label: KINDS[k].name, check: !tf.hide[k], kbd: String(counts[k] || 0), cls: "hc-fk",
        ic: `<span class="hc-fk-dot" style="${kAttr(k)}"></span>`,
      }))).concat([{ sep: 1 }, { act: "tall", label: "Tampilkan semua", ic: icS("#ti-eye", 15), disabled: !anyHidden && tf.threads }]).map(item).join("");
    }
    if (kind === "help") {
      const rows = [
        ["V / H", "Pilih / Geser"], ["S · D · N · I", "Bentuk · Dokumen · Catatan · Gambar"], ["C · T · F", "Penghubung · Teks · Frame"],
        ["Roda mouse", "Zoom di titik kursor"], ["Cubit / " + MOD + " + roda", "Zoom"], ["Seret latar", "Geser kanvas"], ["Spasi + seret", "Geser sementara"],
        ["Shift + roda", "Geser ke samping"], ["Alt + roda", "Geser atas-bawah"], ["2 jari (trackpad)", "Geser"],
        ["Klik titik jejak", "Buka dokumennya"], ["Klik 2× kartu", "Buka dokumen"],
        ["Shift + seret", "Kotak pilih"], ["Shift + klik", "Tambah ke pilihan"], ["Klik 2× / Enter", "Edit teks"],
        [MOD + "+D", "Duplikat"], [MOD + "+C / V", "Salin / tempel"], ["Delete", "Hapus"], [MOD + "+Z", "Urungkan"], [MOD + "+Shift+Z", "Ulangi"],
        [MOD + "+] / [", "Depan / belakang"], ["Panah", "Geser objek (Shift = 10px)"], ["Shift+1 / Shift+0", "Pas layar / 100%"], ["Esc", "Batal / lepas pilihan"],
      ];
      return `<div class="hc-help" role="document"><div class="hc-help-head">${icS("#ti-keyboard", 16)}<b>Pintasan kanvas</b></div><dl>${rows.map((r) => `<dt><kbd>${esc(r[0])}</kbd></dt><dd>${esc(r[1])}</dd>`).join("")}</dl></div>`;
    }
    return "";
  }
  const KEEP_TAB = ["help", "doclist", "docs", "filter"];   // Tab tetap di dalam popover (tidak menutupnya)
  function openMenu(kind, anchor, at) {
    if (!dom || !board) return;
    const pop = dom.pop;
    if (menu && menu.anchor && menu.anchor !== anchor) menu.anchor.setAttribute("aria-expanded", "false");
    menu = { kind, anchor, arg: at && at.arg };
    pop.className = "hc-pop is-" + kind;
    pop.setAttribute("role", kind === "help" ? "dialog" : kind === "shape" || kind === "note" || kind === "docs" || kind === "doclist" ? "group" : "menu");
    pop.setAttribute("aria-label", { boards: "Papan", scenes: "Tambah scene", more: "Menu kanvas", node: "Menu objek", edge: "Menu penghubung", pane: "Menu kanvas", shape: "Pilihan bentuk", note: "Warna catatan", help: "Pintasan kanvas", docs: "Jenis dokumen", doclist: "Pilih dokumen", filter: "Filter jejak" }[kind] || "");
    pop.innerHTML = menuHtml(kind, { arg: at && at.arg });
    if (anchor) anchor.setAttribute("aria-expanded", "true");
    // posisi: di bawah tombol kepala, di atas tombol bilah alat, di kiri tombol tepi kanan, atau di titik klik kanan;
    // dijaga tetap di dalam layar
    const pr = dom.panel.getBoundingClientRect(), pw = pop.offsetWidth, ph = pop.offsetHeight;
    let x, y;
    if (at && at.x !== undefined) { x = at.x - pr.left; y = at.y - pr.top; if (y + ph > pr.height - 8) y = Math.max(8, y - ph); }
    else {
      const r = anchor.getBoundingClientRect();
      const up = !!anchor.closest(".hc-tools"), side = !!anchor.closest(".hc-rail");
      if (side) { x = r.left - pr.left - pw - 10; y = r.top - pr.top - 4; }
      else {
        x = kind === "more" || kind === "help" ? r.right - pr.left - pw : up ? r.left - pr.left + r.width / 2 - pw / 2 : r.left - pr.left;
        y = up ? r.top - pr.top - ph - 10 : r.bottom - pr.top + 6;
      }
    }
    pop.style.left = Math.round(clamp(x, 8, pr.width - pw - 8)) + "px";
    pop.style.top = Math.round(clamp(y, 8, pr.height - ph - 8)) + "px";
    if (kind === "doclist") { const inp = pop.querySelector(".hc-dl-input"); if (inp) { inp.focus({ preventScroll: true }); const L = inp.value.length; try { inp.setSelectionRange(L, L); } catch (e) { /* abaikan */ } } return; }
    const f = pop.querySelector(kind === "docs" ? ".hc-tile" : ".hc-mi:not([disabled]), .hc-pick, .hc-sw");
    if (f && kind !== "shape" && kind !== "note") f.focus({ preventScroll: true });
  }
  function toggleMenu(kind, anchor) { if (menu && menu.kind === kind) closeMenu(); else openMenu(kind, anchor); }
  function closeMenu(refocus) {
    if (!menu || !dom) return;
    const a = menu.anchor;
    menu = null;
    dom.pop.className = "hc-pop hidden";
    dom.pop.innerHTML = "";
    if (a) { a.setAttribute("aria-expanded", "false"); if (refocus) a.focus(); }
  }
  function onMenuKey(e) {
    if (!menu) return;
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeMenu(true); return; }
    if (e.key === "Tab" && !KEEP_TAB.includes(menu.kind)) { closeMenu(); return; }
    const inInput = e.target.classList && e.target.classList.contains("hc-dl-input");
    if (inInput && e.key === "Enter") {   // Enter di kolom cari: dokumen pertama, atau buat baru bila tidak ada
      e.preventDefault();
      const first = dom.pop.querySelector(".hc-dl-item");
      kbdClick = true;
      if (first) runAct("docpick", first.dataset.arg); else runAct("docnew");
      return;
    }
    if (menu.kind === "docs" && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
      const tiles = [...dom.pop.querySelectorAll(".hc-tile")], i = tiles.indexOf(document.activeElement);
      if (i < 0) return;
      e.preventDefault();
      tiles[(i + (e.key === "ArrowRight" ? 1 : tiles.length - 1)) % tiles.length].focus();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
    if (inInput && (e.key === "Home" || e.key === "End")) return;
    const list = [...dom.pop.querySelectorAll(".hc-mi:not([disabled]), .hc-pick, .hc-sw, .hc-tile")];
    if (!list.length) return;
    e.preventDefault();
    const i = list.indexOf(document.activeElement);
    if (inInput) { (e.key === "ArrowUp" ? list[list.length - 1] : list[0]).focus(); return; }
    const j = e.key === "Home" ? 0 : e.key === "End" ? list.length - 1 : e.key === "ArrowDown" ? (i + 1) % list.length : (i - 1 + list.length) % list.length;
    list[j].focus();
  }
  function toast(msg) {
    if (!dom) return;
    dom.toast.textContent = msg;
    dom.toast.classList.add("is-on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => dom && dom.toast.classList.remove("is-on"), 2800);
  }

  // ================= KEYBOARD & TEMPEL (hanya saat Beranda tampil) =================
  function isShown() {
    const tab = document.getElementById("tabHome"), ev = document.getElementById("editorView");
    return !!(ctx && root && dom && dom.panel.isConnected && tab && !tab.classList.contains("hidden") && ev && !ev.classList.contains("hidden"));
  }
  function blocked() { return !!document.querySelector(".modal:not(.hidden), .tp-overlay:not(.hidden), .proj-sidebar.is-open, #editorView.tsb-drawer-open"); }
  function keyTargetOk(t) { return t === document.body || t === document.documentElement || (dom && dom.panel.contains(t)); }
  // sinkronkan Shift/Ctrl/⌘ dari event apa pun (keydown/keyup/pointer) -> render ulang hanya bila berubah
  function syncMods(e) {
    const m = { shift: !!e.shiftKey, meta: MAC && !!e.metaKey, multi: !!(e.shiftKey || e.ctrlKey || e.metaKey) };
    if (m.shift === mods.shift && m.meta === mods.meta && m.multi === mods.multi) return;
    mods = m;
    if (root) renderFlow();
  }
  function onKeyDown(e) {
    if (!isShown()) return;
    if (/^(Shift|Control|Meta)$/.test(e.key)) syncMods(e);
    if (e.isComposing) return;
    const t = e.target;
    if (isEditable(t) || blocked() || !keyTargetOk(t)) return;
    if (menu && dom.pop.contains(t)) return;   // tombol di dalam menu ditangani onMenuKey
    if (menu && e.key === "Escape") { e.preventDefault(); closeMenu(true); return; }
    const k = e.key, mod = e.ctrlKey || e.metaKey;
    if (k === " " && !mod) {   // Spasi ditahan = alat Geser sementara
      if (t !== document.body && t !== document.documentElement && !dom.flow.contains(t)) return;
      e.preventDefault();
      if (!space) { space = true; renderFlow(); updateChrome(); }
      return;
    }
    if (mod && !e.altKey) {
      const kk = k.toLowerCase();
      if (kk === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (kk === "y") { e.preventDefault(); redo(); return; }
      if (kk === "d") { e.preventDefault(); duplicate(); return; }
      if (kk === "c") { if (copySel()) e.preventDefault(); return; }
      if (kk === "x") { if (copySel()) { e.preventDefault(); deleteSel(); } return; }
      if (kk === "v") { clearTimeout(pasteTimer); if (clip) pasteTimer = setTimeout(pasteClip, 60); return; }   // gambar di clipboard menang (lihat onPaste)
      if (kk === "a") { e.preventDefault(); selectAll(); return; }
      if (k === "]" || e.code === "BracketRight") { e.preventDefault(); reorder(true); return; }
      if (k === "[" || e.code === "BracketLeft") { e.preventDefault(); reorder(false); return; }
      if (k === "0") { e.preventDefault(); zoom100(); return; }
      if (k === "=" || k === "+") { e.preventDefault(); zoomBy(1); return; }
      if (k === "-") { e.preventDefault(); zoomBy(-1); return; }
      return;
    }
    if (e.altKey) return;
    if (k === "Delete" || k === "Backspace") { if (deleteSel()) e.preventDefault(); return; }
    if (k === "Escape") {
      if (tool !== "select") setTool("select");
      else selectOnly([], []);
      return;
    }
    if (k === "Enter") {
      const ms = selModels(), trs = selTrail();
      if (ms.length === 1 && !trs.length) {
        const m = ms[0];
        if (EDITABLE.includes(m.t)) { e.preventDefault(); startEdit(m.id); }
        else if (m.t === "scene") { e.preventDefault(); openScene(m.sceneId); }
        else if (m.t === "doc") { e.preventDefault(); openCard(m); }
      } else if (!ms.length && trs.length === 1) { e.preventDefault(); openEntry(trs[0]); }
      return;
    }
    if (k.indexOf("Arrow") === 0) {
      e.preventDefault();
      const d = e.shiftKey ? 10 : 1;
      nudge(k === "ArrowLeft" ? -d : k === "ArrowRight" ? d : 0, k === "ArrowUp" ? -d : k === "ArrowDown" ? d : 0);
      return;
    }
    if (e.shiftKey && e.code === "Digit1") { e.preventDefault(); fit(); return; }
    if (e.shiftKey && e.code === "Digit0") { e.preventDefault(); zoom100(); return; }
    if (k === "+" || k === "=") { zoomBy(1); return; }
    if (k === "-") { zoomBy(-1); return; }
    if (e.shiftKey) return;
    const map = board && board.id === HOME_ID ? { v: "select", h: "hand" } : { v: "select", h: "hand", s: "shape", d: "doc", n: "note", i: "image", c: "connect", t: "text", f: "frame" };
    const tt = map[k.toLowerCase()];
    if (tt) { e.preventDefault(); closeMenu(); setTool(tt); }
  }
  function onKeyUp(e) {
    if (isShown() && /^(Shift|Control|Meta)$/.test(e.key)) syncMods(e);
    if (e.key === " " && space) { space = false; renderFlow(); updateChrome(); }
  }
  function onBlurWin() {
    mods = { shift: false, meta: false, multi: false };
    if (space) space = false;
    if (root) { renderFlow(); updateChrome(); }
  }
  function onPaste(e) {
    if (!isShown() || isEditable(e.target) || blocked() || !keyTargetOk(e.target)) return;
    const files = Array.from((e.clipboardData && e.clipboardData.files) || []).filter((f) => /^image\//.test(f.type || ""));
    if (!files.length) return;
    e.preventDefault();
    clearTimeout(pasteTimer);
    addImages(files, null);
  }
  function onDocPointerDown(e) {
    if (isShown() && dom.panel.contains(e.target)) { syncMods(e); if (dom.flow.contains(e.target)) cancelWheelZoom(); }   // jaga-jaga: keyup terlewat (mis. dilepas di jendela lain)
    if (!menu || !dom) return;
    if (dom.pop.contains(e.target) || (menu.anchor && menu.anchor.contains(e.target))) return;
    closeMenu();
  }
  function bindOnce() {
    if (bound) return;
    bound = true;
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    document.addEventListener("paste", onPaste);
    document.addEventListener("pointerdown", onDocPointerDown, true);
    window.addEventListener("blur", onBlurWin);
  }
  // kolom edit teks yang masih terbuka -> simpan isinya
  function flushEdit(keepOpen) {
    const ta = dom && dom.flow.querySelector(".hc-edit");
    if (ta && ta.dataset.id) commitEdit(ta.dataset.id, ta.value, keepOpen);
    else if (editingNow && api && !keepOpen) api.setEditing(null);
    flushLive();   // sisa ketikan yang belum masuk (kolomnya sudah tidak ada)
  }

  // ================= EKSPOR PNG (digambar ulang ke <canvas>) =================
  function hexA(hex, a) { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; }
  function rr(g, x, y, w, hh, r) {
    r = Math.min(r, w / 2, hh / 2);
    g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + hh, r); g.arcTo(x + w, y + hh, x, y + hh, r); g.arcTo(x, y + hh, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }
  function wrap(g, text, maxW) {
    const out = [];
    String(text || "").split("\n").forEach((para) => {
      let line = "";
      para.split(/(\s+)/).forEach((w) => {
        const test = line + w;
        if (g.measureText(test).width > maxW && line.trim()) { out.push(line.trimEnd()); line = w.trimStart(); }
        else line = test;
      });
      out.push(line);
    });
    return out;
  }
  function drawText(g, text, x, y, w, hh, o) {
    g.font = o.font; g.fillStyle = o.color; g.textBaseline = "top";
    const lines = wrap(g, text, Math.max(10, w)), lh = o.lh;
    const total = lines.length * lh;
    let ty = o.middle ? y + (hh - total) / 2 : y;
    lines.forEach((ln) => {
      if (hh && ty + lh > y + hh + 1) return;
      const tw = g.measureText(ln).width;
      g.fillText(ln, o.center ? x + (w - tw) / 2 : x, ty);
      ty += lh;
    });
  }
  function dotColor(kind, status, light) {
    if (kind === "scene") return status === "draft" ? "#d7a86e" : status === "done" ? "#4caf82" : light ? "#55534d" : "#e8e8ec";
    const K = KINDS[kind] || KINDS.scene;
    return light ? K.cl : K.c;
  }
  async function exportPng() {
    if (!api || !board) return;
    const ns = api.rf.getNodes().filter((n) => n.width && n.height);
    if (!ns.length) { toast("Papan masih kosong."); return; }
    const light = document.body.classList.contains("light");
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    ns.forEach((n) => { const p = n.positionAbsolute || n.position; x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y - (n.type === "frame" ? 28 : 0)); x1 = Math.max(x1, p.x + n.width); y1 = Math.max(y1, p.y + n.height); });
    const pad = 48, W = x1 - x0 + pad * 2, HH = y1 - y0 + pad * 2;
    const sc = Math.max(0.25, Math.min(2, 4096 / Math.max(W, HH)));
    const cv = document.createElement("canvas");
    cv.width = Math.ceil(W * sc); cv.height = Math.ceil(HH * sc);
    const g = cv.getContext("2d");
    g.scale(sc, sc);
    g.fillStyle = light ? "#f4f1ea" : "#131419"; g.fillRect(0, 0, W, HH);
    g.fillStyle = light ? "rgba(0,0,0,.13)" : "rgba(255,255,255,.09)";
    const ox = (((pad - x0) % 20) + 20) % 20, oy = (((pad - y0) % 20) + 20) % 20;
    for (let x = ox; x < W; x += 20) for (let y = oy; y < HH; y += 20) g.fillRect(x - 0.6, y - 0.6, 1.3, 1.3);
    g.translate(pad - x0, pad - y0);
    const fg = light ? "#24221f" : "#eceae6", dim = light ? "#6f6b62" : "#8f8f97";
    const font = (px, wt) => `${wt || 500} ${px}px Inter, -apple-system, "Segoe UI", sans-serif`;
    const imgs = new Map();
    const srcOf = (n) => (n.type === "image" ? n.data.m.src : n.type === "doc" && n.data.r && n.data.r.kind === "map" ? mapThumb(n.data.r.obj) : null);
    await Promise.all(ns.filter(srcOf).map((n) => new Promise((res) => { const im = new Image(); im.onload = () => { imgs.set(n.id, im); res(); }; im.onerror = res; im.src = srcOf(n); })));
    const byId = new Map(ns.map((n) => [n.id, n]));
    const P = (n) => n.positionAbsolute || n.position;
    // frame paling bawah
    ns.filter((n) => n.type === "frame").forEach((n) => {
      const p = P(n), m = n.data.m, c = m.color ? COLORS[m.color] : null;
      rr(g, p.x, p.y, n.width, n.height, 14);
      g.fillStyle = c ? hexA(c, 0.07) : light ? "rgba(0,0,0,.025)" : "rgba(255,255,255,.03)"; g.fill();
      g.lineWidth = 1.5; g.strokeStyle = c ? hexA(c, 0.6) : light ? "rgba(0,0,0,.16)" : "rgba(255,255,255,.18)"; g.stroke();
      g.font = font(12, 600); g.fillStyle = dim; g.textBaseline = "alphabetic"; g.fillText(m.title || "Frame", p.x + 4, p.y - 9);
    });
    // garis
    api.rf.getEdges().forEach((e) => {
      const s = byId.get(e.source), t = byId.get(e.target);
      if (!s || !t) return;
      if (e.type === "trail") {   // benang jejak: tipis, titik-titik untuk induk
        const parent = e.data && e.data.trail === "parent", { a, b } = edgeGeom(s, t, 2, 2);
        g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y);
        g.setLineDash(parent ? [1.5, 4] : []); g.lineWidth = parent ? 1 : 0.9;
        g.strokeStyle = light ? "rgba(0,0,0,.22)" : "rgba(255,255,255,.26)"; g.stroke(); g.setLineDash([]);
        return;
      }
      const seq = e.type === "seq", { a, b } = edgeGeom(s, t, seq ? 3 : 4);
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y);
      g.setLineDash(seq ? [3, 5] : []); g.lineWidth = seq ? 1 : 1.6;
      g.strokeStyle = seq ? (light ? "rgba(0,0,0,.22)" : "rgba(255,255,255,.2)") : light ? "#8a8578" : "#9a9aa3"; g.stroke(); g.setLineDash([]);
      if (seq) return;
      g.fillStyle = g.strokeStyle; g.fill(new Path2D(arrowPath(a, b, 10, 5)));
      const lb = e.data && e.data.label;
      if (lb) {
        g.font = font(12, 600); const tw = g.measureText(lb).width, mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        rr(g, mx - tw / 2 - 8, my - 11, tw + 16, 22, 7); g.fillStyle = light ? "#ffffff" : "#1d1d22"; g.fill();
        g.fillStyle = fg; g.textBaseline = "middle"; g.fillText(lb, mx - tw / 2, my + 0.5);
      }
    });
    // objek lain sesuai urutan papan
    const dot = (cx, cy, col, label) => {
      g.beginPath(); g.arc(cx, cy, 9.5, 0, Math.PI * 2); g.fillStyle = hexA(col, 0.14); g.fill();
      g.beginPath(); g.arc(cx, cy, 5.5, 0, Math.PI * 2); g.fillStyle = col; g.fill();
      g.font = font(11.5, 600); g.fillStyle = fg; g.textBaseline = "top";
      let t = label;
      while (g.measureText(t).width > SCENE_W - 8 && t.length > 2) t = t.slice(0, -2) + "…";
      g.fillText(t, cx - g.measureText(t).width / 2, cy + 12);
    };
    ns.forEach((n) => {
      const p = P(n), w = n.width, hh = n.height, m = n.data.m;
      if (n.type === "shape") {
        const c = COLORS[m.color] || COLORS.slate;
        g.beginPath();
        if (m.shape === "circle") g.ellipse(p.x + w / 2, p.y + hh / 2, w / 2, hh / 2, 0, 0, Math.PI * 2);
        else if (m.shape === "triangle") { g.moveTo(p.x + w / 2, p.y + hh * 0.03); g.lineTo(p.x + w * 0.97, p.y + hh * 0.97); g.lineTo(p.x + w * 0.03, p.y + hh * 0.97); g.closePath(); }
        else if (m.shape === "diamond") { g.moveTo(p.x + w / 2, p.y); g.lineTo(p.x + w, p.y + hh / 2); g.lineTo(p.x + w / 2, p.y + hh); g.lineTo(p.x, p.y + hh / 2); g.closePath(); }
        else rr(g, p.x, p.y, w, hh, 12);
        g.fillStyle = hexA(c, 0.2); g.fill(); g.lineWidth = 1.5; g.strokeStyle = c; g.stroke();
        if (m.text) drawText(g, m.text, p.x + 12, p.y + (m.shape === "triangle" ? hh * 0.3 : 8), w - 24, hh - 16 - (m.shape === "triangle" ? hh * 0.25 : 0), { font: font(14, 600), color: fg, lh: 19, center: true, middle: true });
      } else if (n.type === "note") {
        rr(g, p.x, p.y, w, hh, 4); g.fillStyle = NOTE_COLORS[m.color] || NOTE_COLORS.yellow; g.fill();
        if (m.text) drawText(g, m.text, p.x + 14, p.y + 14, w - 28, hh - 28, { font: font(14, 500), color: "#2b2618", lh: 20 });
      } else if (n.type === "image") {
        const im = imgs.get(n.id);
        g.save(); rr(g, p.x, p.y, w, hh, 10); g.clip();
        if (im) { const s = Math.max(w / im.width, hh / im.height), iw = im.width * s, ih = im.height * s; g.drawImage(im, p.x + (w - iw) / 2, p.y + (hh - ih) / 2, iw, ih); }
        g.restore();
      } else if (n.type === "text") {
        const fz = TEXT_SIZES[m.size] || 24;
        if (m.text) drawText(g, m.text, p.x + 4, p.y + 2, w - 8, 0, { font: font(fz, 600), color: fg, lh: Math.round(fz * 1.25) });
      } else if (n.type === "scene") {
        dot(p.x + w / 2, p.y + DOT_CY, dotColor("scene", n.data.s.status, light), String(n.data.s.title || "").trim() || "(tanpa judul)");
      } else if (n.type === "trail") {
        const r = n.data.r;
        dot(p.x + w / 2, p.y + DOT_CY, dotColor(r.kind, r.kind === "scene" ? r.obj.status : "", light), docTitle(r));
      } else if (n.type === "doc") {
        const r = n.data.r, K = KINDS[m.kind] || KINDS.scene, col = light ? K.cl : K.c;
        rr(g, p.x, p.y, w, hh, 14); g.fillStyle = light ? "#ffffff" : "#1b1c22"; g.fill();
        g.lineWidth = 1; g.strokeStyle = light ? "rgba(0,0,0,.12)" : "rgba(255,255,255,.12)"; g.stroke();
        g.fillStyle = col; g.beginPath(); g.arc(p.x + 16, p.y + 15, 4, 0, Math.PI * 2); g.fill();
        g.font = font(10.5, 700); g.fillStyle = dim; g.textBaseline = "middle"; g.fillText(K.name.toUpperCase(), p.x + 26, p.y + 15.5);
        if (!r) { drawText(g, "Dokumen dihapus", p.x + 12, p.y + 34, w - 24, hh - 44, { font: font(13, 600), color: dim, lh: 18 }); return; }
        const im = imgs.get(n.id);
        let ty = p.y + 32;
        if (im) { const ih = Math.max(20, hh - 92); g.save(); rr(g, p.x + 10, ty, w - 20, ih, 9); g.clip(); const s = Math.max((w - 20) / im.width, ih / im.height); g.drawImage(im, p.x + 10 + (w - 20 - im.width * s) / 2, ty + (ih - im.height * s) / 2, im.width * s, im.height * s); g.restore(); ty += ih + 8; }
        drawText(g, docTitle(r), p.x + 12, ty, w - 24, 40, { font: font(14, 700), color: fg, lh: 18 });
        const meta = docMeta(r, curIx());
        if (!im && meta.snip) drawText(g, meta.snip, p.x + 12, ty + 22, w - 24, Math.max(0, p.y + hh - ty - 42), { font: font(12, 500), color: dim, lh: 17 });
        if (meta.meta) { g.font = font(11, 500); g.fillStyle = dim; g.textBaseline = "alphabetic"; g.fillText(meta.meta, p.x + 12, p.y + hh - 10); }
      }
    });
    cv.toBlob((blob) => {
      if (!blob) { toast("Ekspor gagal."); return; }
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = (String(board.title || "papan").replace(/[\\/:*?"<>|]+/g, " ").trim() || "papan") + ".png";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      toast("PNG diekspor.");
    }, "image/png");
  }

  // ================= API untuk app.js =================
  window.NovelHome = {
    // dipanggil tiap kali tab Beranda tampil (juga saat pindah project)
    show(c) {
      const fresh = !ctx || ctx.project !== c.project;
      // isi project diganti (versi dari perangkat lain / backup): riwayat urungkan milik data lama dibuang,
      // papan dicari ulang lewat id di data baru (di bawah)
      const replaced = !fresh && dataRef !== c.project.data;
      ctx = c;
      dataRef = c.project.data;
      bindOnce();
      if (fresh || replaced) dropLive();
      if (replaced) { hist.clear(); lastCreate = null; pendingSel = null; }
      if (fresh) {
        projId = c.project.id;
        hist.clear(); clip = null; tool = "select"; space = false; lastCreate = null; pendingSel = null; pendingDoc = null;
        loadFilter();
      }
      const cv = canvasOf(c.project);
      syncNow();
      pruneHome();   // penghubung ke titik jejak yang tidak ada lagi
      const moved = migrateHome(cv);   // Beranda = graf saja: objek bebas lama pindah ke papan Brainstorm
      const info = sceneInfo();
      cv.boards.forEach((b) => syncScenes(b, info));
      const want = fresh ? lsGet("novelist_hcboard_" + projId) : board && board.id;
      board = cv.boards.find((b) => b.id === want) || cv.boards.find((b) => b.id === cv.active) || cv.boards[0];
      cv.active = board.id;
      mountChrome();
      placePendingCard();
      if (!root) root = ReactDOM.createRoot(dom.flow);
      rev++;
      closeMenu();
      renderFlow();
      updateChrome();
      if (freshKeys.size) { setTimeout(revealFresh, 120); scheduleFreshClear(); }
      if (moved) { save(); toast(`Beranda kini khusus graf dokumen — catatan & objek lainnya dipindah ke papan "${moved.title}".`); }
      if (fresh && board.id !== HOME_ID && ctx.onOpen) ctx.onOpen(board.id, board.title, false);
    },
    // tab lain tampil / keluar project / logout: simpan teks yang sedang diedit lalu lepas kanvas
    hide() {
      if (!root) { flushLive(); return; }
      flushEdit(false);
      dropLive();
      closeMenu();
      cancelWheelZoom();
      if (api) saveViewport(api.rf.getViewport());
      space = false; mods = { shift: false, meta: false, multi: false };
      if (tool === "doc") { tool = "select"; pendingDoc = null; }
      try { root.unmount(); } catch (e) { /* abaikan */ }
      root = null; api = null; editingNow = null;
    },
    // scene berubah (tambah/ganti nama/hapus di Tulis) -> node ikut diperbarui bila Beranda sedang tampil
    refresh() {
      if (!isShown() || !board) return;
      syncNow();
      syncScenes(board, sceneInfo());
      rev++;
      renderFlow();
      updateChrome();
      if (freshKeys.size) scheduleFreshClear();
    },
    // project berubah (markDirtyAndSchedule): dokumen baru/terhapus dicatat ke jejak sebentar kemudian
    track(p) {
      if (!p || !p.data) return;
      trackP = p;
      clearTimeout(trackTimer);
      trackTimer = setTimeout(runTrack, 400);
    },
    // dari riwayat sidebar tab: buka papan tertentu
    open(id) { if (ctx && root && cvs() && cvs().boards.some((b) => b.id === id) && (!board || board.id !== id)) switchBoard(id, true); },
    // autosave / pindah tab: isi kolom edit yang masih terbuka + jejak yang belum dicatat ikut tersimpan
    flush() { if (trackTimer) runTrack(); flushEdit(!!root && isShown()); },
    boardTitle(p, id) { const c = p && p.data && p.data.canvas; const b = c && Array.isArray(c.boards) && c.boards.find((x) => x && x.id === id); return b ? b.title : null; },
  };
})();
