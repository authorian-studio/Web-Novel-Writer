// ================= BERANDA: kanvas papan (React Flow) =================
// Dimuat lazy oleh app.js (ensureHomeLib) saat tab Beranda pertama kali dibuka — setelah React, ReactDOM, React Flow
// (vendor/) & home-canvas.css. Isinya: panel kaca berisi kanvas yang bisa digeser & di-zoom, kepala panel (papan,
// menu, perbesar), tombol tampilan di tepi kanan & bilah alat mengambang di bawah.
// Data per project (ikut tersimpan ke Drive):
//   p.data.canvas = { v: 1, active, boards: [{ id, title, nodes, edges, viewport, seq }] }
//   papan "home" (Beranda) = semua scene project, disimpan sebagai rujukan sceneId + posisi (bukan salinan isi);
//     tidak bisa dihapus. Papan lain = kanvas bebas (scene bisa ditambahkan lewat menu papan).
//   node = { id, t, x, y, ... }  t = scene { sceneId } | shape { shape, color, text, w, h } | note { color, text, w, h }
//          | image { src (WebP data URL, sisi terpanjang <= 1200px), w, h } | text { text, size, w } | frame { title, color, w, h }
//   edge = { id, source, target, label }  (penghubung buatan pengguna, berpanah)
//   Garis putus-putus antar scene berurutan di Beranda dihitung dari urutan scene (tidak disimpan; seq=false = disembunyikan).
// Viewport & papan aktif juga diingat per perangkat (localStorage), jadi menggeser kanvas tidak memicu simpan ke Drive.
// Keyboard: semua tombol ditangani modul ini sendiri (deleteKeyCode React Flow dimatikan) dan hanya saat tab Beranda
// tampil & fokus tidak sedang di kolom teks — Delete di tab lain tidak pernah menghapus isi kanvas.
(function () {
  "use strict";
  const React = window.React, ReactDOM = window.ReactDOM, RF = window.ReactFlow;
  const h = React.createElement;
  const Flow = RF.default || RF.ReactFlow;

  const HOME_ID = "home";
  const SCENE_W = 160, DOT_CY = 13;          // node scene: lebar tetap, pusat titik 13px dari atas kotak
  const MIN_Z = 0.2, MAX_Z = 2.5;
  const MAX_IMG = 30, IMG_PX = 1200;
  const TYPES = ["scene", "shape", "note", "image", "text", "frame"];
  const PLACE = ["shape", "note", "text", "frame"];   // alat yang menaruh objek dengan klik/seret di kanvas
  const EDITABLE = ["shape", "note", "text", "frame"];
  const SHAPES = ["rect", "circle", "triangle", "diamond"];
  const SHAPE_NAMES = { rect: "persegi", circle: "lingkaran", triangle: "segitiga", diamond: "belah ketupat" };
  const COLORS = { slate: "#a3a8b4", amber: "#d7a86e", green: "#4caf82", blue: "#6aa8ff", violet: "#b58cff", red: "#e15c5c", teal: "#3fb8c9" };
  const COLOR_NAMES = { slate: "Abu", amber: "Emas", green: "Hijau", blue: "Biru", violet: "Ungu", red: "Merah", teal: "Toska" };
  const NOTE_COLORS = { yellow: "#f6d97a", pink: "#f5adc8", blue: "#a9cff5", green: "#b2e3a8", orange: "#f7bd86", violet: "#cfbcf7" };
  const NOTE_NAMES = { yellow: "Kuning", pink: "Merah muda", blue: "Biru", green: "Hijau", orange: "Jingga", violet: "Ungu" };
  const TEXT_SIZES = { s: 16, m: 24, l: 40 };
  const DEF = { shape: { w: 160, h: 110 }, note: { w: 200, h: 200 }, text: { w: 240, h: 40 }, frame: { w: 520, h: 340 } };
  const MIN = { shape: { w: 40, h: 30 }, note: { w: 90, h: 70 }, image: { w: 40, h: 30 }, text: { w: 50, h: 20 }, frame: { w: 140, h: 100 } };
  const STATUS = { todo: "Todo", draft: "Draft", done: "Done" };
  const DATA_IMG = /^data:image\/(png|jpeg|webp|gif);base64,[a-z0-9+/=]+$/i;
  const MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || "");
  const MOD = MAC ? "⌘" : "Ctrl";

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
  function hashUnit(s, salt) {   // 0..1 yang tetap untuk id yang sama (sama dengan Beranda lama -> posisi lama terjaga)
    let x = 2166136261 ^ salt;
    for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); }
    return ((x >>> 0) % 10000) / 10000;
  }
  // HTML scene -> teks polos (untuk kartu hover & jumlah kata)
  const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " " };
  const plain = (html) => String(html || "").replace(/<(br|\/p|\/div|\/li|\/h\d)[^>]*>/gi, " ").replace(/<[^>]*>/g, "")
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m, k) => ENT[k]).replace(/\s+/g, " ").trim();
  // ikon Tabler (nama ditulis lengkap "#ti-NAMA" supaya tools/build-icons.mjs menemukannya)
  const ic = (href, size) => h("svg", { className: "ti", width: size || 16, height: size || 16, "aria-hidden": "true", focusable: "false" }, h("use", { href }));
  const icS = (href, size) => `<svg class="ti" width="${size || 16}" height="${size || 16}" aria-hidden="true" focusable="false"><use href="${href}"></use></svg>`;

  // ---------- state modul ----------
  let ctx = null;             // dari app.js: { project, onChange, getCurrentSceneId, openScene, onOpen, closeTab, preview, toggleTheme }
  let projId = null;
  let host = null, dom = null; // #homeCanvas & elemen panel
  let root = null;            // React root kanvas
  let board = null;           // papan aktif (objek di p.data.canvas.boards)
  let rev = 0, pendingSel = null;
  let tool = "select", space = false;
  // tombol pengubah dilacak sendiri (bukan useKeyPress React Flow): body.nokey membuat React Flow melewatkan keyup
  // sehingga Ctrl/Shift bisa "tersangkut" setelah pintasan seperti Ctrl+Z (roda jadi zoom, Shift+seret jadi geser)
  let mods = { shift: false, meta: false, multi: false };
  let shapeKind = "rect", shapeColor = "slate", noteColor = "yellow";
  let api = null;             // dari komponen App: { rf, store, setNodes, setEdges, setEditing }
  let editingNow = null;
  let clip = null, pasteN = 0, pasteTimer = null;
  let lastCreate = null, lastNudge = 0, rzSnap = null;
  let menu = null;            // { kind, anchor }
  let ctxPos = null;          // posisi flow klik kanan (untuk "... di sini")
  let toastTimer = null, zoomShown = "";
  let maxed = lsGet("novelist_hc_max") === true;
  let mini = lsGet("novelist_hc_minimap") === true;
  let bound = false;
  const hist = new Map();     // "<project>|<papan>" -> { undo: [], redo: [] }

  const cvs = () => ctx.project.data.canvas;
  const save = () => { if (ctx) ctx.onChange(); };
  const findNode = (id) => board && board.nodes.find((n) => n.id === id);
  const vpKey = (b) => "novelist_hcvp_" + projId + "_" + b.id;
  // buka scene di Tulis setelah event selesai (pindah tab melepas kanvas React; jangan di tengah handler React)
  const openScene = (id) => setTimeout(() => { if (ctx) ctx.openScene(id); }, 0);

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
    }
    return o;
  }
  function cleanBoard(b) {
    if (!isObj(b)) return null;
    const id = typeof b.id === "string" && b.id && b.id.length <= 80 ? b.id : uid("b");
    const nodes = [], ids = new Set();
    (Array.isArray(b.nodes) ? b.nodes : []).forEach((n) => { const c = cleanNode(n); if (c && !ids.has(c.id)) { ids.add(c.id); nodes.push(c); } });
    const edges = [], eids = new Set(), pairs = new Set();
    (Array.isArray(b.edges) ? b.edges : []).forEach((e) => {
      if (!isObj(e)) return;
      const s = String(e.source || ""), t = String(e.target || "");
      if (!ids.has(s) || !ids.has(t) || s === t || pairs.has(s + ">" + t)) return;
      const eid = typeof e.id === "string" && e.id && e.id.length <= 120 && !eids.has(e.id) ? e.id : uid("e");
      eids.add(eid); pairs.add(s + ">" + t);
      edges.push({ id: eid, source: s, target: t, label: str(e.label, 200) });
    });
    const title = typeof b.title === "string" && b.title.trim() ? b.title.trim().slice(0, 80) : (id === HOME_ID ? "Beranda" : "Papan");
    const vp = validVp(b.viewport) ? { x: Math.round(b.viewport.x), y: Math.round(b.viewport.y), zoom: +(+b.viewport.zoom).toFixed(3) } : null;
    return { id, title, nodes, edges, viewport: vp, seq: b.seq !== false };
  }
  // dipanggil tiap show(): p.data.canvas dibuat / diperbaiki (diam-diam, tidak menandai project berubah)
  function canvasOf(p) {
    const d = p.data;
    let c = d.canvas;
    if (!isObj(c)) c = d.canvas = { v: 1, active: HOME_ID, boards: [] };
    const seen = new Set();
    c.boards = (Array.isArray(c.boards) ? c.boards : []).map(cleanBoard).filter((b) => b && !seen.has(b.id) && seen.add(b.id));
    let home = c.boards.find((b) => b.id === HOME_ID);
    if (!home) { home = { id: HOME_ID, title: "Beranda", nodes: [], edges: [], viewport: null, seq: true }; c.boards.unshift(home); }
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
  // Beranda lama: titik ditaruh dengan hash id di area relatif -> dipetakan ke area 1200x760 (tampilan pertama sama)
  function legacyPos(s, i, n) {
    const cx = (0.08 + hashUnit(s.id, 1) * 0.84) * 1200;
    const cy = (0.12 + (n > 1 ? (i / (n - 1)) * 0.7 : 0.3) + (hashUnit(s.id, 2) - 0.5) * 0.08) * 760;
    return { x: Math.round(cx - SCENE_W / 2), y: Math.round(cy - DOT_CY) };
  }
  // scene baru: di sebelah kanan scene sebelumnya (urutan binder), bergeser ke bawah bila bertabrakan
  function autoPos(b, info, s) {
    const idx = info.map.get(s.id).i;
    let prev = null;
    for (let i = idx - 1; i >= 0 && !prev; i--) { const id = "s:" + info.order[i].id; prev = b.nodes.find((n) => n.id === id) || null; }
    let x, y;
    if (prev) { x = prev.x + 200; y = Math.round(prev.y + (hashUnit(s.id, 3) - 0.5) * 80); }
    else if (b.nodes.length) {
      x = Math.min(...b.nodes.map((n) => n.x)) - 220; y = Math.min(...b.nodes.map((n) => n.y));
    } else { x = -SCENE_W / 2; y = 0; }
    for (let k = 0; k < 60 && b.nodes.some((n) => n.t === "scene" && Math.abs(n.x - x) < 130 && Math.abs(n.y - y) < 54); k++) y += 64;
    return { x: Math.round(x), y: Math.round(y) };
  }
  // cocokkan papan dengan daftar scene: rujukan scene yang dihapus dibuang, Beranda mendapat scene baru
  function syncScenes(b, info) {
    const before = b.nodes.length;
    b.nodes = b.nodes.filter((n) => n.t !== "scene" || info.map.has(n.sceneId));
    if (b.id === HOME_ID) {
      const have = new Set(b.nodes.filter((n) => n.t === "scene").map((n) => n.sceneId));
      const legacy = have.size === 0;   // migrasi: belum ada posisi tersimpan -> tata letak Beranda lama
      info.order.forEach((s, i) => {
        if (have.has(s.id)) return;
        const p = legacy ? legacyPos(s, i, info.order.length) : autoPos(b, info, s);
        b.nodes.push({ id: "s:" + s.id, t: "scene", sceneId: s.id, x: p.x, y: p.y });
        have.add(s.id);
      });
    }
    if (b.nodes.length !== before) {
      const ids = new Set(b.nodes.map((n) => n.id));
      b.edges = b.edges.filter((e) => ids.has(e.source) && ids.has(e.target));
    }
  }

  // ================= RIWAYAT (urungkan / ulangi) =================
  const snap = () => ({ nodes: board.nodes.map((n) => ({ ...n })), edges: board.edges.map((e) => ({ ...e })) });
  function H() { const k = projId + "|" + board.id; let x = hist.get(k); if (!x) hist.set(k, (x = { undo: [], redo: [] })); return x; }
  function pushUndo(s) { const x = H(); x.undo.push(s); if (x.undo.length > 80) x.undo.shift(); x.redo.length = 0; }
  function restore(s) {
    board.nodes = s.nodes; board.edges = s.edges;
    syncScenes(board, sceneInfo());
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

  // kolom edit teks (klik dua kali / Enter). Uncontrolled: nilai dibaca saat selesai (blur, Esc, Ctrl+Enter)
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
      spellCheck: true, "aria-label": "Edit teks", maxLength: single ? 200 : 5000, onBlur: fin, onInput: grow,
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
      h("div", { className: "hc-tip-foot" }, words.toLocaleString("id-ID") + " kata · klik untuk menulis"));
  }
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
  const NODE_TYPES = { scene: SceneNode, shape: ShapeNode, note: NoteNode, image: ImageNode, text: TextNode, frame: FrameNode };

  // ================= REACT FLOW: garis =================
  // garis "mengambang": menempel di tepi objek (lingkaran/belah ketupat mengikuti bentuknya), bukan di titik handle
  function anchorOf(n) {
    const w = n.width || 0, hh = n.height || 0, p = n.positionAbsolute || n.position;
    if (n.type === "scene") return { cx: p.x + w / 2, cy: p.y + DOT_CY, kind: "dot", rx: 10, ry: 10 };
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
  function edgeGeom(s, t, padT) {
    const A = anchorOf(s), B = anchorOf(t);
    const a = borderPt(A, B.cx, B.cy, 3), b = borderPt(B, A.cx, A.cy, padT);
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
    const ed = ui.editing === "e:" + id, label = data && data.label;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    return h(React.Fragment, null,
      h(RF.BaseEdge, { id, path, interactionWidth: 18 }),
      h("path", { d: arrowPath(a, b, 10, 5), className: "hc-arrow" }),
      label || ed ? h(RF.EdgeLabelRenderer, null, h("div", {
        className: "hc-elabel nopan nodrag" + (selected ? " is-sel" : "") + (ed ? " is-edit" : ""),
        style: { transform: `translate(-50%, -50%) translate(${mx}px, ${my}px)` },
        onDoubleClick: (e) => { e.stopPropagation(); if (ui.tool === "select") ui.setEditing("e:" + id); },
      }, ed ? h(EditArea, { id: "e:" + id, value: label, single: true, className: "hc-elabel-edit" }) : label)) : null);
  }
  const EDGE_TYPES = { link: LinkEdge, seq: LinkEdge };

  // ---------- model -> node/garis React Flow ----------
  function buildNodes(sel, prev) {
    const info = sceneInfo(), cur = ctx.getCurrentSceneId ? ctx.getCurrentSceneId() : null;
    const pm = new Map((prev || []).map((n) => [n.id, n]));
    const out = [];
    board.nodes.forEach((m) => {
      const o = { id: m.id, type: m.t, position: { x: m.x, y: m.y }, selected: sel.has(m.id), data: { m } };
      if (m.t === "scene") {
        const si = info.map.get(m.sceneId);
        if (!si) return;
        o.data = { m, s: si.s, path: si.path, idx: si.i, current: si.s.id === cur };
      } else if (m.t === "text") o.style = { width: m.w };
      else o.style = { width: m.w, height: m.h };
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
  function buildEdges(sel) {
    const out = board.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, type: "link", selected: sel.has(e.id), data: { label: e.label || "" } }));
    if (board.id === HOME_ID && board.seq !== false) {
      const on = new Set(board.nodes.filter((n) => n.t === "scene").map((n) => n.sceneId));
      const order = sceneInfo().order.filter((s) => on.has(s.id));
      for (let i = 1; i < order.length; i++) {
        out.unshift({ id: "seq:" + order[i - 1].id + ">" + order[i].id, source: "s:" + order[i - 1].id, target: "s:" + order[i].id, type: "seq",
          selectable: false, focusable: false, deletable: false, data: { seq: true } });
      }
    }
    return out;
  }

  // ================= REACT FLOW: alat taruh (bentuk / catatan / teks / frame) =================
  // lapisan transparan di atas kanvas: klik = ukuran bawaan, seret = ukuran sesuai kotak. Roda tetap menggeser / zoom.
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
    const onWheel = (e) => {
      const vp = rf.getViewport(), r = e.currentTarget.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        const z2 = clamp(vp.zoom * Math.pow(2, -e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.01)), MIN_Z, MAX_Z), px = e.clientX - r.left, py = e.clientY - r.top;
        rf.setViewport({ x: px - ((px - vp.x) * z2) / vp.zoom, y: py - ((py - vp.y) * z2) / vp.zoom, zoom: z2 });
      } else {
        const k = e.deltaMode === 1 ? 20 : 1;
        rf.setViewport({ x: vp.x - e.deltaX * k * 0.9, y: vp.y - e.deltaY * k * 0.9, zoom: vp.zoom });
      }
    };
    return h("div", { className: "hc-place nopan nodrag nowheel", onPointerDown, onPointerMove, onPointerUp, onPointerCancel: () => { st.current = null; setG(null); }, onWheel },
      g ? h("div", { className: "hc-ghost is-" + kind + (kind === "shape" ? " is-" + shapeKind : ""), style: { left: g.l, top: g.t, width: g.w, height: g.h } }) : null);
  }

  // ================= REACT FLOW: bilah aksi objek terpilih =================
  function SelBar({ sel }) {
    const ids = sel.map((n) => n.id);
    const ms = ids.map(findNode).filter(Boolean);
    if (!ms.length) return null;
    const types = new Set(ms.map((m) => m.t)), only = types.size === 1 ? ms[0].t : null, one = ms.length === 1 ? ms[0] : null;
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
      fin.forEach((p, id) => { const m = findNode(id); if (!m) return; const x = Math.round(p.x), y = Math.round(p.y); if (m.x !== x || m.y !== y) { m.x = x; m.y = y; moved = true; } });
      if (moved) { pushUndo(d.snap); save(); updateChrome(); }
    };
    const onNodeClick = (e, node) => {
      if (t !== "select" || e.shiftKey || e.metaKey || e.ctrlKey) return;
      if (node.type === "scene") { const m = findNode(node.id); if (m) openScene(m.sceneId); }
    };
    const onNodeDoubleClick = (e, node) => { if (t === "select" && EDITABLE.includes(node.type)) setEditing(node.id); };
    const onConnect = (c) => {
      if (!c.source || !c.target || c.source === c.target) return;
      if (board.edges.some((x) => (x.source === c.source && x.target === c.target) || (x.source === c.target && x.target === c.source))) { toast("Kedua objek ini sudah terhubung."); return; }
      const id = uid("e");
      mutate(() => { board.edges.push({ id, source: c.source, target: c.target, label: "" }); }, [id]);
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
        defaultViewport: vp || undefined, fitView: !vp, fitViewOptions: { padding: 0.25, maxZoom: 1.1 },
        minZoom: MIN_Z, maxZoom: MAX_Z,
        // mode alat: Pilih = seret latar menggeser (Shift+seret = kotak pilih), Geser/Spasi = selalu menggeser
        nodesDraggable: sel, nodesConnectable: conn, elementsSelectable: sel || conn, selectNodesOnDrag: sel,
        // tombol React Flow dimatikan semua (lihat "mods"): Shift = kotak pilih, Shift/Ctrl/⌘+klik = tambah pilihan,
        // Ctrl+roda = zoom (cabang cubit React Flow), ⌘+roda (Mac) = zoom lewat zoomOnScroll
        panOnDrag: place ? false : box ? [1] : [0, 1], selectionOnDrag: box,
        selectionKeyCode: null, multiSelectionKeyCode: null, deleteKeyCode: null, panActivationKeyCode: null, zoomActivationKeyCode: null,
        panOnScroll: !props.meta, panOnScrollSpeed: 0.9, zoomOnScroll: !!props.meta, zoomOnPinch: true, zoomOnDoubleClick: false, preventScrolling: true,
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

  // warna objek di peta mini = warna aslinya (catatan/bentuk), scene = aksen
  function mmColor(n) {
    const m = n.data && n.data.m;
    if (n.type === "note") return NOTE_COLORS[m.color] || NOTE_COLORS.yellow;
    if (n.type === "shape") return COLORS[m.color] || COLORS.slate;
    if (n.type === "image") return "#8f97ab";
    if (n.type === "frame") return "transparent";
    return "#d7a86e";   // scene & teks: warnanya dari CSS (.hc-mm-*)
  }
  function renderFlow() {
    if (!root || !board) return;
    root.render(h(RF.ReactFlowProvider, { key: board.id }, h(App, { key: board.id, rev, tool, space, mini, shift: mods.shift, meta: mods.meta, multi: mods.multi, vp: viewportOf(board) })));
  }
  function viewportOf(b) {
    const v = lsGet(vpKey(b));
    if (validVp(v)) return v;
    if (b.viewport) return b.viewport;
    if (!b.nodes.length && dom) return { x: Math.round(dom.flow.clientWidth / 2), y: Math.round(dom.flow.clientHeight / 2), zoom: 1 };   // papan baru: titik 0,0 di tengah
    return null;   // -> fitView
  }
  let vpTimer = null;
  function saveViewport(v) {
    if (!board) return;
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

  // ================= AKSI =================
  const deletable = (m) => m.t !== "scene" || board.id !== HOME_ID;
  const canCopy = (m) => m.t !== "scene";
  function selModels() { return api ? api.rf.getNodes().filter((n) => n.selected).map((n) => findNode(n.id)).filter(Boolean) : []; }
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
    const ms = selModels(), es = selEdgeIds();
    const del = new Set(ms.filter(deletable).map((m) => m.id));
    if (!del.size && !es.size) { if (ms.length) toast("Scene hanya bisa dihapus dari tab Tulis."); return ms.length > 0; }
    mutate(() => {
      board.nodes = board.nodes.filter((m) => !del.has(m.id));
      board.edges = board.edges.filter((e) => !es.has(e.id) && !del.has(e.source) && !del.has(e.target));
    }, []);
    if (ms.length > del.size) toast("Scene tetap di Beranda — hapus scene dari tab Tulis.");
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
    if (!ms.length) { if (selModels().length) toast("Scene tidak bisa diduplikat di papan yang sama."); return; }
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
    const ms = selModels();
    if (!ms.length) { if (api) { const v = api.rf.getViewport(); api.rf.setViewport({ x: v.x - dx * 6, y: v.y - dy * 6, zoom: v.zoom }); } return; }
    const s = snap();
    ms.forEach((m) => { m.x += dx; m.y += dy; });
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
  function commitEdit(id, value, keepOpen) {
    if (!board) return;
    if (!keepOpen && api) api.setEditing((cur) => (cur === id ? null : cur));
    if (id.indexOf("e:") === 0) {
      const e = board.edges.find((x) => x.id === id.slice(2));
      const v = String(value || "").trim().slice(0, 200);
      if (e && (e.label || "") !== v) mutate(() => { e.label = v; });
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
    if ((n[key] || "") === v) return;
    mutate(() => { n[key] = v; });
  }
  // taruh objek baru (alat Bentuk/Catatan/Teks/Frame): a = titik awal, b = titik akhir (seret)
  function placeAt(kind, a, b, dragged) {
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
    if (!files.length || !board) return;
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
    board = b;
    cvs().active = b.id;
    lsSet("novelist_hcboard_" + projId, b.id);
    syncScenes(b, sceneInfo());
    pendingSel = null; zoomShown = "";
    renderFlow(); updateChrome();
    if (!quiet && ctx.onOpen) ctx.onOpen(b.id, b.title, b.id === HOME_ID);   // app.js: riwayat sidebar tab
  }
  function newBoard() {
    const c = cvs();
    let n = c.boards.length, title;
    do { title = "Papan " + n++; } while (c.boards.some((b) => b.title === title));
    const b = { id: uid("b"), title, nodes: [], edges: [], viewport: null, seq: true };
    c.boards.push(b);
    save();
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
    if (!confirm(home ? "Bersihkan papan Beranda? Semua catatan, bentuk, gambar, teks, frame & penghubung dihapus (scene tetap). Bisa diurungkan dengan " + MOD + "+Z."
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
    if (!api) return;
    if (!api.rf.getNodes().length) { const r = dom.flow.getBoundingClientRect(); api.rf.setViewport({ x: r.width / 2, y: r.height / 2, zoom: 1 }, { duration: dur(250) }); return; }
    api.rf.fitView({ padding: 0.2, maxZoom: 1.2, duration: dur(320) });
  }
  // tombol zoom beruntun: langkah berikutnya dihitung dari target sebelumnya (transisi yang belum selesai tidak membuang langkah)
  let zoomGoal = 0, zoomGoalT = 0;
  function zoomBy(inOut) {
    if (!api) return;
    const now = performance.now(), base = zoomGoal && now - zoomGoalT < 600 ? zoomGoal : api.rf.getZoom();
    zoomGoal = clamp(base * (inOut > 0 ? 1.2 : 1 / 1.2), MIN_Z, MAX_Z); zoomGoalT = now;
    zoomTo(zoomGoal, dur(180));
  }
  // tanpa animasi (gerak dikurangi / perf-boost): langsung lewat d3-zoom, tidak menunggu bingkai berikutnya
  function zoomTo(z, ms) {
    const st = api.store.getState();
    if (!ms && st.d3Zoom && st.d3Selection) st.d3Zoom.scaleTo(st.d3Selection, z);
    else api.rf.zoomTo(z, { duration: ms });
  }
  function zoom100() { zoomGoal = 0; if (api) zoomTo(1, dur(220)); }
  function setTool(t) {
    if (t === "image") { pickImage(); return; }
    if (!["select", "hand", "connect"].concat(PLACE).includes(t)) return;
    if (t !== tool) { tool = t; renderFlow(); }
    if (t !== "shape" && t !== "note" && menu && (menu.kind === "shape" || menu.kind === "note")) closeMenu();
    updateChrome();
  }
  function setMax(on) {
    maxed = !!on;
    lsSet("novelist_hc_max", maxed);
    updateChrome();
  }
  function setMini(on) { mini = !!on; lsSet("novelist_hc_minimap", mini); renderFlow(); updateChrome(); }

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
      case "seq": if (board.id === HOME_ID) { board.seq = board.seq === false; changed(null); } break;
      case "minimap": setMini(!mini); break;
      case "max": setMax(!maxed); break;
      case "preview": if (ctx.preview) ctx.preview(); break;
      case "theme": if (ctx.toggleTheme) ctx.toggleTheme(); break;
      case "help": openMenu("help", dom.help); return;
      case "export": exportPng(); break;
      case "clear": clearBoard(); break;
      case "close": if (ctx.closeTab) ctx.closeTab(); break;
      case "open": { const m = selModels()[0]; if (m && m.t === "scene") openScene(m.sceneId); break; }
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
      case "selall": selectAll(); break;
      case "elabel": if (api && arg) api.setEditing("e:" + arg); break;
      case "edel": if (arg) mutate(() => { board.edges = board.edges.filter((e) => e.id !== arg); }, []); break;
    }
    if (menu && menu.kind !== "shape" && menu.kind !== "note") closeMenu();
  }

  // ================= PANEL (DOM biasa): kepala, tombol tepi, bilah alat, menu =================
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
          <button type="button" class="hc-ibtn hc-max-btn" data-act="max" aria-pressed="false" aria-label="Perbesar panel" data-tip="Perbesar panel">${icS("#ti-arrows-maximize", 16)}${icS("#ti-arrows-minimize", 16)}</button>
          <button type="button" class="hc-ibtn" data-act="close" aria-label="Tutup tab Beranda" data-tip="Tutup tab Beranda">${icS("#ti-x", 16)}</button>
        </div>
      </header>
      <div class="hc-side" role="group" aria-label="Tampilan kanvas">
        <button type="button" class="hc-sbtn" data-act="zoomin" aria-label="Perbesar" data-tip="Perbesar · +">${icS("#ti-zoom-in", 16)}</button>
        <button type="button" class="hc-sbtn" data-act="zoomout" aria-label="Perkecil" data-tip="Perkecil · −">${icS("#ti-zoom-out", 16)}</button>
        <button type="button" class="hc-sbtn" data-act="fit" aria-label="Pas ke layar" data-tip="Pas ke layar · Shift+1">${icS("#ti-focus-centered", 16)}</button>
        <span class="hc-side-sep" aria-hidden="true"></span>
        <button type="button" class="hc-sbtn" data-act="minimap" aria-pressed="false" aria-label="Peta mini" data-tip="Peta mini">${icS("#ti-map-2", 16)}</button>
      </div>
      <div class="hc-hint" aria-live="polite"></div>
      <div class="hc-empty hidden"></div>
      <div class="hc-tools-wrap">
        <div class="hc-tools" role="toolbar" aria-label="Alat kanvas">
          ${tb("select", "Pilih", "V", icS("#ti-pointer-filled", 18), "hc-t-sm")}
          ${tb("hand", "Geser", "H", icS("#ti-hand-stop", 18), "hc-t-sm")}
          <span class="hc-tsep" aria-hidden="true"></span>
          ${tb("shape", "Bentuk", "S", `<span class="hc-shape-ic">${icS("#ti-triangle-filled", 26)}</span>`, "hc-t-big", ' aria-haspopup="menu"')}
          ${tb("note", "Catatan tempel", "N", '<span class="hc-note-prev" aria-hidden="true"><i></i><i></i><i></i></span>', "hc-t-big")}
          <button type="button" class="hc-tool hc-t-big" data-act="image" aria-label="Gambar (I)" data-tip="Gambar · I" data-tip-pos="top"><span class="hc-img-prev" aria-hidden="true">${icS("#ti-photo", 16)}</span></button>
          <span class="hc-tsep" aria-hidden="true"></span>
          ${tb("connect", "Penghubung", "C", `<span class="hc-conn-ic" aria-hidden="true">${icS("#ti-square-filled", 13)}${icS("#ti-circle-filled", 13)}${icS("#ti-arrow-up-right", 12)}</span>`)}
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
      maxBtn: q(".hc-max-btn"), miniBtn: q('[data-act="minimap"]'), hint: q(".hc-hint"), empty: q(".hc-empty"), tools: q(".hc-tools"),
      notePrev: q(".hc-note-prev"), imgPrev: q(".hc-img-prev"), pop: q(".hc-pop"), toast: q(".hc-toast"), file: q(".hc-file"),
    };
    zoomShown = "";
    dom.panel.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b || !dom.panel.contains(b) || b.disabled) return;
      if (b === dom.boardBtn) { toggleMenu("boards", b); return; }
      if (b.closest(".hc-pop")) { if (b.dataset.act) runAct(b.dataset.act, b.dataset.arg); return; }
      if (b.dataset.tool) {
        const t = b.dataset.tool;
        if (t === "shape") { setTool("shape"); toggleMenu("shape", b); return; }
        if (t === "note") { setTool("note"); toggleMenu("note", b); return; }
        closeMenu();
        setTool(t);
        return;
      }
      if (b.dataset.act === "more") { toggleMenu("more", b); return; }
      if (b.dataset.act === "help") { toggleMenu("help", b); return; }
      if (b.dataset.act) runAct(b.dataset.act, b.dataset.arg);
    });
    dom.file.addEventListener("change", () => { addImages(dom.file.files, null); dom.file.value = ""; });
    dom.titleInput.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") { e.preventDefault(); endRename(true); dom.boardBtn.focus(); }
      else if (e.key === "Escape") { e.preventDefault(); endRename(false); dom.boardBtn.focus(); }
    });
    dom.titleInput.addEventListener("blur", () => endRename(true));
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
  }

  function updateChrome() {
    if (!dom || !board) return;
    const home = board.id === HOME_ID;
    dom.title.textContent = board.title;
    const sc = board.nodes.filter((n) => n.t === "scene").length, other = board.nodes.length - sc;
    dom.sub.textContent = home ? `${sc} scene${other ? " · " + other + " objek" : ""}` : `${board.nodes.length} objek`;
    const t = space ? "hand" : tool;
    dom.panel.dataset.tool = t;
    dom.panel.classList.toggle("is-max", maxed);
    dom.tools.querySelectorAll("[data-tool]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.tool === t ? "true" : "false"));
    dom.maxBtn.setAttribute("aria-pressed", maxed ? "true" : "false");
    dom.maxBtn.dataset.tip = maxed ? "Kecilkan panel" : "Perbesar panel";
    dom.maxBtn.setAttribute("aria-label", dom.maxBtn.dataset.tip);
    dom.miniBtn.setAttribute("aria-pressed", mini ? "true" : "false");
    const ev = document.getElementById("editorView");
    if (ev) ev.classList.toggle("hc-max", maxed && isShown());
    dom.notePrev.style.setProperty("--c", NOTE_COLORS[noteColor]);
    const img = [...board.nodes].reverse().find((n) => n.t === "image");
    dom.imgPrev.style.backgroundImage = img ? `url("${img.src}")` : "";
    dom.imgPrev.classList.toggle("has-img", !!img);
    const hints = {
      shape: `Klik atau seret di kanvas untuk menaruh ${SHAPE_NAMES[shapeKind]} · Esc batal`,
      note: "Klik atau seret di kanvas untuk menaruh catatan · Esc batal",
      text: "Klik di kanvas untuk menulis teks · Esc batal",
      frame: "Seret di kanvas untuk membuat frame · Esc batal",
      connect: "Seret dari satu objek ke objek lain (atau klik keduanya) untuk menghubungkan · Esc selesai",
    };
    dom.hint.textContent = hints[t] || "";
    dom.hint.classList.toggle("is-on", !!hints[t]);
    const empty = !board.nodes.length;
    dom.empty.classList.toggle("hidden", !empty);
    if (empty) {
      dom.empty.innerHTML = home
        ? `<span class="hc-empty-ic">${icS("#ti-file-text", 22)}</span><p>Belum ada scene</p><small>Tambahkan scene di tab Tulis — titiknya muncul di sini dan bisa kamu susun bebas.</small>`
        : `<span class="hc-empty-ic">${icS("#ti-layout-board", 22)}</span><p>Papan ini masih kosong</p><small>Pilih alat di bawah — catatan, bentuk, gambar, teks atau frame. Seret latar untuk menggeser, ${MOD} + roda untuk zoom.</small>`;
    }
  }

  // ---------- menu / popover ----------
  function item(o) {
    if (o.sep) return '<div class="hc-mi-sep" role="separator"></div>';
    if (o.head) return `<div class="hc-mi-head">${esc(o.head)}</div>`;
    const role = o.check !== undefined ? (o.radio ? "menuitemradio" : "menuitemcheckbox") : "menuitem";
    return `<button type="button" class="hc-mi${o.danger ? " is-danger" : ""}" role="${role}" data-act="${o.act}"${o.arg !== undefined ? ` data-arg="${esc(o.arg)}"` : ""}` +
      `${o.check !== undefined ? ` aria-checked="${o.check ? "true" : "false"}"` : ""}${o.disabled ? " disabled" : ""}${o.title ? ` title="${esc(o.title)}"` : ""}>` +
      `<span class="hc-mi-ic">${o.ic || ""}</span><span class="hc-mi-label">${esc(o.label)}${o.sub ? `<small>${esc(o.sub)}</small>` : ""}</span>` +
      `${o.kbd ? `<kbd>${esc(o.kbd)}</kbd>` : ""}${o.check ? `<span class="hc-mi-check">${icS("#ti-check", 14)}</span>` : ""}</button>`;
  }
  function menuHtml(kind, o) {
    const home = board.id === HOME_ID, x = H();
    if (kind === "boards") {
      const info = sceneInfo();
      return [{ head: "Papan" }].concat(cvs().boards.map((b) => ({
        act: "board", arg: b.id, label: b.title, check: b === board, radio: true,
        ic: b.id === HOME_ID ? icS("#ti-home", 15) : icS("#ti-layout-board", 15),
        sub: b.id === HOME_ID ? info.order.length + " scene" : b.nodes.length + " objek",
      })), [{ sep: 1 },
        { act: "newboard", label: "Papan baru", ic: icS("#ti-plus", 15) },
        { act: "rename", label: "Ganti nama papan", ic: icS("#ti-pencil", 15) },
        home ? null : { act: "addscenes", label: "Tambah scene ke papan…", ic: icS("#ti-file-plus", 15) },
        { act: "delboard", label: "Hapus papan", ic: icS("#ti-trash", 15), danger: true, disabled: home, title: home ? "Papan Beranda tidak bisa dihapus" : "" },
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
        home ? { act: "seq", label: "Garis alur scene", ic: icS("#ti-line-dashed", 15), check: board.seq !== false } : null,
        { act: "minimap", label: "Peta mini", ic: icS("#ti-map-2", 15), check: mini },
        { act: "preview", label: "Preview manuskrip", ic: icS("#ti-eye", 15) },
        { act: "theme", label: light ? "Tema gelap" : "Tema terang", ic: light ? icS("#ti-moon", 15) : icS("#ti-sun", 15) },
        { act: "help", label: "Pintasan keyboard", ic: icS("#ti-keyboard", 15) },
        { sep: 1 },
        { act: "export", label: "Ekspor PNG", ic: icS("#ti-download", 15) },
        { act: "clear", label: "Bersihkan papan", ic: icS("#ti-eraser", 15), danger: true },
      ].filter(Boolean).map(item).join("");
    }
    if (kind === "node") {
      const ms = selModels(), one = ms.length === 1 ? ms[0] : null;
      return [
        one && one.t === "scene" ? { act: "open", label: "Buka di Tulis", ic: icS("#ti-pencil", 15) } : null,
        one && EDITABLE.includes(one.t) ? { act: "edit", label: "Edit teks", ic: icS("#ti-cursor-text", 15), kbd: "Enter" } : null,
        { act: "dup", label: "Duplikat", ic: icS("#ti-copy-plus", 15), kbd: MOD + "+D", disabled: !ms.some(canCopy) },
        { act: "copy", label: "Salin", ic: icS("#ti-copy", 15), kbd: MOD + "+C" },
        { act: "front", label: "Bawa ke depan", ic: icS("#ti-stack-front", 15), kbd: MOD + "+]" },
        { act: "back", label: "Kirim ke belakang", ic: icS("#ti-stack-back", 15), kbd: MOD + "+[" },
        { sep: 1 },
        { act: "del", label: "Hapus", ic: icS("#ti-trash", 15), kbd: "Del", danger: true, disabled: !ms.some(deletable) },
      ].filter(Boolean).map(item).join("");
    }
    if (kind === "edge") {
      return [{ act: "elabel", arg: o.arg, label: "Edit label", ic: icS("#ti-pencil", 15) }, { act: "edel", arg: o.arg, label: "Hapus penghubung", ic: icS("#ti-trash", 15), danger: true }].map(item).join("");
    }
    if (kind === "pane") {
      return [
        { act: "paste", label: "Tempel", ic: icS("#ti-clipboard", 15), kbd: MOD + "+V", disabled: !clip },
        { sep: 1 },
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
    if (kind === "help") {
      const rows = [
        ["V / H", "Pilih / Geser"], ["S · N · I", "Bentuk · Catatan · Gambar"], ["C · T · F", "Penghubung · Teks · Frame"],
        ["Seret latar", "Geser kanvas"], ["Spasi + seret", "Geser sementara"], ["Roda / 2 jari", "Geser"], [MOD + " + roda / cubit", "Zoom"],
        ["Shift + seret", "Kotak pilih"], ["Shift + klik", "Tambah ke pilihan"], ["Klik 2× / Enter", "Edit teks"],
        [MOD + "+D", "Duplikat"], [MOD + "+C / V", "Salin / tempel"], ["Delete", "Hapus"], [MOD + "+Z", "Urungkan"], [MOD + "+Shift+Z", "Ulangi"],
        [MOD + "+] / [", "Depan / belakang"], ["Panah", "Geser objek (Shift = 10px)"], ["Shift+1 / Shift+0", "Pas layar / 100%"], ["Esc", "Batal / lepas pilihan"],
      ];
      return `<div class="hc-help" role="document"><div class="hc-help-head">${icS("#ti-keyboard", 16)}<b>Pintasan kanvas</b></div><dl>${rows.map((r) => `<dt><kbd>${esc(r[0])}</kbd></dt><dd>${esc(r[1])}</dd>`).join("")}</dl></div>`;
    }
    return "";
  }
  function openMenu(kind, anchor, at) {
    if (!dom || !board) return;
    const pop = dom.pop;
    if (menu && menu.anchor && menu.anchor !== anchor) menu.anchor.setAttribute("aria-expanded", "false");
    menu = { kind, anchor, arg: at && at.arg };
    pop.className = "hc-pop is-" + kind;
    pop.setAttribute("role", kind === "help" ? "dialog" : kind === "shape" || kind === "note" ? "group" : "menu");
    pop.setAttribute("aria-label", { boards: "Papan", scenes: "Tambah scene", more: "Menu kanvas", node: "Menu objek", edge: "Menu penghubung", pane: "Menu kanvas", shape: "Pilihan bentuk", note: "Warna catatan", help: "Pintasan kanvas" }[kind] || "");
    pop.innerHTML = menuHtml(kind, { arg: at && at.arg });
    if (anchor) anchor.setAttribute("aria-expanded", "true");
    // posisi: di bawah tombol kepala, di atas tombol bilah alat, atau di titik klik kanan; dijaga tetap di dalam panel
    const pr = dom.panel.getBoundingClientRect(), pw = pop.offsetWidth, ph = pop.offsetHeight;
    let x, y;
    if (at && at.x !== undefined) { x = at.x - pr.left; y = at.y - pr.top; if (y + ph > pr.height - 8) y = Math.max(8, y - ph); }
    else {
      const r = anchor.getBoundingClientRect();
      const up = !!anchor.closest(".hc-tools");
      x = kind === "more" || kind === "help" ? r.right - pr.left - pw : up ? r.left - pr.left + r.width / 2 - pw / 2 : r.left - pr.left;
      y = up ? r.top - pr.top - ph - 10 : r.bottom - pr.top + 6;
    }
    pop.style.left = Math.round(clamp(x, 8, pr.width - pw - 8)) + "px";
    pop.style.top = Math.round(clamp(y, 8, pr.height - ph - 8)) + "px";
    const f = pop.querySelector(".hc-mi:not([disabled]), .hc-pick, .hc-sw");
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
    if (e.key === "Tab" && menu.kind !== "help") { closeMenu(); return; }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
    const list = [...dom.pop.querySelectorAll(".hc-mi:not([disabled]), .hc-pick, .hc-sw")];
    if (!list.length) return;
    e.preventDefault();
    const i = list.indexOf(document.activeElement);
    const j = e.key === "Home" ? 0 : e.key === "End" ? list.length - 1 : e.key === "ArrowDown" ? (i + 1) % list.length : (i - 1 + list.length) % list.length;
    list[j].focus();
  }
  function toast(msg) {
    if (!dom) return;
    dom.toast.textContent = msg;
    dom.toast.classList.add("is-on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => dom && dom.toast.classList.remove("is-on"), 2600);
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
    if (k === "Enter") { const ms = selModels(); if (ms.length === 1 && EDITABLE.includes(ms[0].t)) { e.preventDefault(); startEdit(ms[0].id); } else if (ms.length === 1 && ms[0].t === "scene") { e.preventDefault(); openScene(ms[0].sceneId); } return; }
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
    const map = { v: "select", h: "hand", s: "shape", n: "note", i: "image", c: "connect", t: "text", f: "frame" };
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
    if (isShown() && dom.panel.contains(e.target)) syncMods(e);   // jaga-jaga: keyup terlewat (mis. dilepas di jendela lain)
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
    if (!dom) return;
    const ta = dom.flow.querySelector(".hc-edit");
    if (ta && ta.dataset.id) commitEdit(ta.dataset.id, ta.value, keepOpen);
    else if (editingNow && api && !keepOpen) api.setEditing(null);
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
    await Promise.all(ns.filter((n) => n.type === "image").map((n) => new Promise((res) => { const im = new Image(); im.onload = () => { imgs.set(n.id, im); res(); }; im.onerror = res; im.src = n.data.m.src; })));
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
        const st = n.data.s.status, col = st === "draft" ? "#d7a86e" : st === "done" ? "#4caf82" : light ? "#55534d" : "#e8e8ec";
        const cx = p.x + w / 2, cy = p.y + DOT_CY;
        g.beginPath(); g.arc(cx, cy, 9.5, 0, Math.PI * 2); g.fillStyle = hexA(col.length === 7 ? col : "#e8e8ec", 0.12); g.fill();
        g.beginPath(); g.arc(cx, cy, 5.5, 0, Math.PI * 2); g.fillStyle = col; g.fill();
        g.font = font(11.5, 600); g.fillStyle = fg; g.textBaseline = "top";
        let t = String(n.data.s.title || "").trim() || "(tanpa judul)";
        while (g.measureText(t).width > SCENE_W - 8 && t.length > 2) t = t.slice(0, -2) + "…";
        g.fillText(t, cx - g.measureText(t).width / 2, cy + 12);
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
      ctx = c;
      bindOnce();
      if (fresh) {
        projId = c.project.id;
        hist.clear(); clip = null; tool = "select"; space = false; lastCreate = null; pendingSel = null;
      }
      const cv = canvasOf(c.project), info = sceneInfo();
      cv.boards.forEach((b) => syncScenes(b, info));
      const want = fresh ? lsGet("novelist_hcboard_" + projId) : board && board.id;
      board = cv.boards.find((b) => b.id === want) || cv.boards.find((b) => b.id === cv.active) || cv.boards[0];
      cv.active = board.id;
      mountChrome();
      if (!root) root = ReactDOM.createRoot(dom.flow);
      rev++;
      closeMenu();
      renderFlow();
      updateChrome();
      if (fresh && board.id !== HOME_ID && ctx.onOpen) ctx.onOpen(board.id, board.title, false);
    },
    // tab lain tampil / keluar project / logout: simpan teks yang sedang diedit lalu lepas kanvas
    hide() {
      if (!root) return;
      flushEdit(false);
      closeMenu();
      space = false; mods = { shift: false, meta: false, multi: false };
      try { root.unmount(); } catch (e) { /* abaikan */ }
      root = null; api = null; editingNow = null;
      const ev = document.getElementById("editorView");
      if (ev) ev.classList.remove("hc-max");
    },
    // scene berubah (tambah/ganti nama/hapus di Tulis) -> node ikut diperbarui bila Beranda sedang tampil
    refresh() {
      if (!isShown() || !board) return;
      syncScenes(board, sceneInfo());
      rev++;
      renderFlow();
      updateChrome();
    },
    // dari riwayat sidebar tab: buka papan tertentu
    open(id) { if (ctx && root && cvs() && cvs().boards.some((b) => b.id === id) && (!board || board.id !== id)) switchBoard(id, true); },
    // autosave / pindah tab: isi kolom edit yang masih terbuka ikut tersimpan
    flush() { if (root) flushEdit(isShown()); },
    boardTitle(p, id) { const c = p && p.data && p.data.canvas; const b = c && Array.isArray(c.boards) && c.boards.find((x) => x && x.id === id); return b ? b.title : null; },
  };
})();
