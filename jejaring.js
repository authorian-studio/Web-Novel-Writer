// ================= JEJARING TOKOH: pohon relasi antar tokoh (React Flow) =================
// Dimuat lazy oleh app.js (ensureJejaringLib) saat tab "Jejaring Tokoh" pertama kali dibuka — setelah React, ReactDOM,
// React Flow (vendor/) & jejaring.css. Isinya: panel kaca berisi wizard "jejaring baru" (pilih templat -> atur jenis
// relasi, dengan pratinjau) dan kanvas pohon: kartu tokoh berfoto, tombol "+" di empat sisi untuk menambah relasi,
// garis siku berlabel, catatan tempel, teks, label berwarna, beberapa lembar per jejaring & "Rapikan" otomatis.
// Data per project (ikut tersimpan ke Drive):
//   p.data.jejaring = { v: 1, active, docs: [doc] }
//   doc   = { id, title, template, types: [type], tags: [tag], sheets: [sheet], activeSheet }
//   type  = { id, label, icon, dashed, color, dir }   dir: "up" (tokoh baru di atas, mis. Orang tua) | "down" (di bawah,
//           mis. Anak) | "side" (di samping, mis. Pasangan). Dipakai untuk penempatan kartu baru & "Rapikan".
//   tag   = { id, name, color }
//   sheet = { id, name, nodes: [node], edges: [edge], viewport }
//   node  = person { id, t:"person", x, y, name, charId?, photo? (WebP <= 400px), emoji?, tags: [tagId] }
//           | note { id, t:"note", x, y, w, h, color, text } | text { id, t:"text", x, y, w, text, size }
//           charId = id karakter di p.data.organize.characters (nama tampil diambil dari sana; "name" = cadangan).
//   edge  = { id, source, target, type: typeId | null, dir }   artinya "target adalah <type> dari source";
//           dir hanya dipakai untuk garis tanpa label (arah penempatan / Rapikan).
// Viewport, jejaring & lembar aktif juga diingat per perangkat (localStorage) supaya menggeser tidak memicu simpan.
// Keyboard ditangani modul ini sendiri (deleteKeyCode React Flow mati) dan hanya saat tab ini tampil & fokus tidak di
// kolom teks — Delete di tab lain tidak pernah menghapus kartu.
(function () {
  "use strict";
  const React = window.React, ReactDOM = window.ReactDOM, RF = window.ReactFlow;
  const h = React.createElement;
  const Flow = RF.default || RF.ReactFlow;
  const P = RF.Position;

  const CARD_W = 96, CARD_H = 132, PHOTO_H = 120;          // kartu tokoh: foto 96x120 + pil nama yang menjorok ke bawah
  const GAP_SIDE = 124, GAP_GEN = 96, GAP_BLOCK = 56, GAP_COMP = 120;
  const MIN_Z = 0.2, MAX_Z = 2.5;
  const PHOTO_PX = 400, MAX_PHOTO = 600000;
  const NTYPES = ["person", "note", "text"];
  const PLACE = ["person", "note", "text"];
  const DIRS = ["up", "down", "side"];
  const DIR_NAMES = { up: "di atas", down: "di bawah", side: "di samping" };
  const DATA_IMG = /^data:image\/(png|jpeg|webp|gif);base64,[a-z0-9+/=]+$/i;
  const MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || "");
  const MOD = MAC ? "⌘" : "Ctrl";
  // ikon yang bisa dipilih untuk jenis relasi (nama ditulis lengkap "#ti-NAMA" supaya tools/build-icons.mjs menemukannya)
  const ICONS = {
    "user": "#ti-user", "users": "#ti-users", "users-group": "#ti-users-group", "user-up": "#ti-user-up", "user-down": "#ti-user-down",
    "user-heart": "#ti-user-heart", "user-star": "#ti-user-star", "user-shield": "#ti-user-shield", "baby-carriage": "#ti-baby-carriage",
    "heart": "#ti-heart", "hearts": "#ti-hearts", "heart-handshake": "#ti-heart-handshake", "heart-broken": "#ti-heart-broken",
    "heart-plus": "#ti-heart-plus", "home-heart": "#ti-home-heart", "friends": "#ti-friends", "school": "#ti-school",
    "briefcase": "#ti-briefcase", "building": "#ti-building", "crown": "#ti-crown", "chess-king": "#ti-chess-king",
    "shield-half": "#ti-shield-half", "military-rank": "#ti-military-rank", "medal": "#ti-medal", "sword": "#ti-sword",
    "star": "#ti-star", "flag": "#ti-flag", "link": "#ti-link", "key": "#ti-key", "spy": "#ti-spy", "skull": "#ti-skull", "ghost": "#ti-ghost",
  };
  const COLORS = { amber: "#d7a86e", red: "#e15c5c", green: "#4caf82", blue: "#6aa8ff", violet: "#b58cff", teal: "#3fb8c9", pink: "#ec7fb0", slate: "#a3a8b4" };
  const COLOR_NAMES = { amber: "Emas", red: "Merah", green: "Hijau", blue: "Biru", violet: "Ungu", teal: "Toska", pink: "Merah muda", slate: "Abu" };
  const NOTE_COLORS = { yellow: "#f6d97a", pink: "#f5adc8", blue: "#a9cff5", green: "#b2e3a8", orange: "#f7bd86", violet: "#cfbcf7" };
  const NOTE_NAMES = { yellow: "Kuning", pink: "Merah muda", blue: "Biru", green: "Hijau", orange: "Jingga", violet: "Ungu" };
  const TEXT_SIZES = { s: 16, m: 24, l: 40 };
  const EMOJI = ["👑", "⚔️", "🛡️", "❤️", "💔", "⭐", "🔥", "💀", "👶", "🧓", "🎓", "💼", "🕊️", "🌙", "☀️", "🌿", "🗝️", "🩸", "✨", "❓"];

  // templat: jenis relasi bawaan + contoh pratinjau (rel: [sumber, target, jenis] = "target adalah <jenis> dari sumber")
  const TEMPLATES = [
    { id: "keluarga", name: "Keluarga", sub: "Relasi keluarga", icon: "#ti-home-heart", color: "#6aa8ff", types: [
      { id: "parent", label: "Orang tua", icon: "user-up", dir: "up" },
      { id: "child", label: "Anak", icon: "baby-carriage", dir: "down" },
      { id: "partner", label: "Pasangan", icon: "heart-handshake", dir: "side" },
      { id: "ex", label: "Mantan", icon: "heart-broken", dir: "side", dashed: true },
      { id: "sibling", label: "Saudara", icon: "users", dir: "side" },
      { id: "half", label: "Saudara tiri", icon: "users-group", dir: "side", dashed: true },
      { id: "adopted", label: "Diadopsi", icon: "heart-plus", dir: "down", dashed: true },
      { id: "step", label: "Orang tua tiri", icon: "user-heart", dir: "up", dashed: true },
    ], sample: {
      people: ["Laras", "Bima", "Sekar", "Arya", "Dimas", "Galih", "Wulan", "Tirta", "Kirana"],
      rel: [[1, 0, "partner"], [1, 2, "ex"], [2, 3, "ex"], [0, 4, "child"], [1, 5, "adopted"], [2, 5, "child"], [3, 6, "child"], [5, 6, "half"], [6, 7, "partner"], [6, 8, "child"]],
    } },
    { id: "perusahaan", name: "Perusahaan", sub: "Relasi kantor", icon: "#ti-building", color: "#e0954a", types: [
      { id: "boss", label: "Atasan", icon: "user-star", dir: "up" },
      { id: "report", label: "Bawahan", icon: "user-down", dir: "down" },
      { id: "peer", label: "Rekan kerja", icon: "users", dir: "side" },
      { id: "mentor", label: "Mentor", icon: "school", dir: "side", dashed: true },
    ], sample: {
      people: ["Hendra", "Maya", "Rudi", "Sinta", "Joko", "Andi"],
      rel: [[1, 0, "boss"], [0, 2, "report"], [1, 2, "peer"], [1, 3, "report"], [1, 4, "report"], [2, 5, "report"], [4, 5, "mentor"]],
    } },
    { id: "militer", name: "Militer", sub: "Rantai komando", icon: "#ti-shield", color: "#e15c5c", types: [
      { id: "cmd", label: "Komandan", icon: "military-rank", dir: "up" },
      { id: "officer", label: "Perwira", icon: "medal", dir: "down" },
      { id: "soldier", label: "Prajurit", icon: "sword", dir: "down" },
      { id: "aide", label: "Ajudan", icon: "user-shield", dir: "side", dashed: true },
    ], sample: {
      people: ["Surya", "Adit", "Bayu", "Cakra", "Dewa", "Eka", "Fajar"],
      rel: [[0, 1, "aide"], [2, 0, "cmd"], [0, 3, "officer"], [2, 4, "soldier"], [2, 5, "soldier"], [3, 6, "soldier"]],
    } },
    { id: "istana", name: "Istana Kerajaan", sub: "Relasi istana", icon: "#ti-crown", color: "#b58cff", types: [
      { id: "liege", label: "Penguasa", icon: "crown", dir: "up" },
      { id: "vassal", label: "Vasal", icon: "shield-half", dir: "down", dashed: true },
      { id: "heir", label: "Pewaris", icon: "chess-king", dir: "down" },
      { id: "consort", label: "Permaisuri", icon: "heart", dir: "side" },
    ], sample: {
      people: ["Arkana", "Sekarwangi", "Wira", "Laksmi", "Rangga", "Seno"],
      rel: [[0, 1, "consort"], [0, 2, "heir"], [1, 3, "heir"], [4, 0, "liege"], [0, 5, "vassal"]],
    } },
    { id: "kosong", name: "Mulai kosong", sub: "Relasi buatanmu sendiri", desc: "Beri nama relasimu sendiri sambil jalan", icon: "#ti-plus", color: "", types: [], sample: {
      people: ["Tokoh A", "Tokoh B", "Tokoh C", "Tokoh D"],
      rel: [[0, 1, null, "side"], [0, 2, null, "down"], [1, 3, null, "down"]],
    } },
  ];
  const TPL = Object.fromEntries(TEMPLATES.map((t) => [t.id, t]));

  // ---------- util ----------
  const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
  const num = (v, d) => (typeof v === "number" && isFinite(v) ? v : d);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");
  const uid = (p) => p + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const idOk = (v, max) => typeof v === "string" && !!v && v.length <= (max || 120);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const lsGet = (k) => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage diblokir: cukup di memori */ } };
  const reduceMotion = () => document.body.classList.contains("perf-boost") || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const dur = (ms) => (reduceMotion() ? 0 : ms);
  const validVp = (v) => isObj(v) && isFinite(v.x) && isFinite(v.y) && isFinite(v.zoom) && v.zoom >= MIN_Z && v.zoom <= MAX_Z;
  const fsScale = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--fs-scale")) || 1;
  const isEditable = (t) => !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ""));
  const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " " };
  const plain = (html) => String(html || "").replace(/<(br|\/p|\/div|\/li|\/h\d)[^>]*>/gi, " ").replace(/<[^>]*>/g, "")
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m, k) => ENT[k]).replace(/\s+/g, " ").trim();
  const ic = (href, size) => h("svg", { className: "ti", width: size || 16, height: size || 16, "aria-hidden": "true", focusable: "false" }, h("use", { href }));
  const icS = (href, size) => `<svg class="ti" width="${size || 16}" height="${size || 16}" aria-hidden="true" focusable="false"><use href="${href}"></use></svg>`;
  const typeIc = (t) => ICONS[t && t.icon] || ICONS.link;
  const dashSvg = (dashed) => `<svg class="jj-dash-svg" width="20" height="6" viewBox="0 0 20 6" aria-hidden="true"><line x1="1" y1="3" x2="19" y2="3"${dashed ? ' stroke-dasharray="4 3"' : ""}/></svg>`;
  const initials = (s) => String(s || "?").trim().split(/\s+/).slice(0, 2).map((w) => w.charAt(0).toUpperCase()).join("") || "?";
  function hue(s) { let x = 7; for (let i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) % 360; return x; }

  // ---------- state modul ----------
  let ctx = null;             // dari app.js: { project, onChange, closeTab, onOpen, onOrganizeChange, openCharacter, toggleTheme }
  let projId = null;
  let host = null, dom = null;
  let root = null;            // React root kanvas
  let pvRoot = null, pvApi = null;   // React root pratinjau wizard
  let doc = null, sheet = null;
  let rev = 0, pendingSel = null;
  let tool = "select", space = false;
  let mods = { shift: false, meta: false, multi: false };
  let api = null, editingNow = null;
  let menu = null;            // { kind, anchor, arg }
  let relCtx = null;          // popover relasi: { mode: new|connect|edge, nodeId, side, at, target, edgeId, char, view }
  let ctxPos = null;
  let wiz = null;             // { step, mode: new|edit, tpl, types, cancel }
  let noteColor = "yellow", focusTag = null;
  let clip = null, pasteN = 0, lastNudge = 0, rzSnap = null, photoTarget = null;
  let toastTimer = null, bound = false, animRaf = 0;
  let maxed = lsGet("novelist_jj_max") === true;
  let mini = lsGet("novelist_jj_minimap") === true;
  const hist = new Map();     // "<project>|<jejaring>" -> { undo: [], redo: [] }

  const save = () => { if (ctx) ctx.onChange(); };
  const data = () => ctx.project.data.jejaring;
  const findNode = (id) => sheet && sheet.nodes.find((n) => n.id === id);
  const vpKey = (d, s) => "novelist_jjvp_" + projId + "_" + d.id + "_" + s.id;
  const typeMap = () => new Map((doc ? doc.types : []).map((t) => [t.id, t]));
  const tagMap = () => new Map((doc ? doc.tags : []).map((t) => [t.id, t]));
  function chars() {
    const o = ctx && ctx.project.data.organize;
    return (o && Array.isArray(o.characters) ? o.characters : []).filter((c) => c && typeof c.id === "string");
  }
  const charMap = () => new Map(chars().map((c) => [c.id, c]));
  const charName = (c) => String((c && c.title) || "").trim() || "(tanpa nama)";
  function personName(m, cm) {
    const c = m.charId ? (cm || charMap()).get(m.charId) : null;
    return c ? charName(c) : m.name || "";
  }
  const orgChanged = () => { if (ctx && ctx.onOrganizeChange) ctx.onOrganizeChange(); };

  // ================= DATA: validasi / perbaikan =================
  function cleanType(t, used) {
    if (!isObj(t)) return null;
    const id = idOk(t.id, 60) && !used.has(t.id) ? t.id : uid("t");
    used.add(id);
    return { id, label: str(t.label, 40).trim() || "Relasi", icon: ICONS[t.icon] ? t.icon : "link", dashed: !!t.dashed, color: COLORS[t.color] ? t.color : "", dir: DIRS.includes(t.dir) ? t.dir : "side" };
  }
  function cleanNode(n, tags) {
    if (!isObj(n) || !NTYPES.includes(n.t)) return null;
    const o = { id: idOk(n.id) ? n.id : uid("n"), t: n.t, x: Math.round(clamp(num(n.x, 0), -1e6, 1e6)), y: Math.round(clamp(num(n.y, 0), -1e6, 1e6)) };
    if (n.t === "person") {
      o.name = str(n.name, 80);
      if (idOk(n.charId)) o.charId = n.charId;
      if (typeof n.photo === "string" && n.photo.length <= MAX_PHOTO && DATA_IMG.test(n.photo)) o.photo = n.photo;
      if (typeof n.emoji === "string" && n.emoji.length <= 8 && n.emoji.trim() && !/[<>&"'a-z0-9]/i.test(n.emoji)) o.emoji = n.emoji;
      o.tags = (Array.isArray(n.tags) ? n.tags : []).filter((t, i, a) => tags.has(t) && a.indexOf(t) === i).slice(0, 12);
    } else if (n.t === "note") {
      o.color = NOTE_COLORS[n.color] ? n.color : "yellow"; o.text = str(n.text, 5000);
      o.w = Math.round(clamp(num(n.w, 200), 60, 3000)); o.h = Math.round(clamp(num(n.h, 180), 50, 3000));
    } else {
      o.text = str(n.text, 5000); o.size = TEXT_SIZES[n.size] ? n.size : "m"; o.w = Math.round(clamp(num(n.w, 240), 30, 4000));
    }
    return o;
  }
  function cleanSheet(s, tags, types) {
    if (!isObj(s)) return null;
    const id = idOk(s.id, 80) ? s.id : uid("s");
    const nodes = [], ids = new Set(), persons = new Set();
    (Array.isArray(s.nodes) ? s.nodes : []).forEach((n) => { const c = cleanNode(n, tags); if (c && !ids.has(c.id)) { ids.add(c.id); nodes.push(c); if (c.t === "person") persons.add(c.id); } });
    const edges = [], eids = new Set(), pairs = new Set();
    (Array.isArray(s.edges) ? s.edges : []).forEach((e) => {
      if (!isObj(e)) return;
      const a = String(e.source || ""), b = String(e.target || "");
      const k = a < b ? a + "|" + b : b + "|" + a;
      if (!persons.has(a) || !persons.has(b) || a === b || pairs.has(k)) return;
      const eid = idOk(e.id) && !eids.has(e.id) ? e.id : uid("e");
      eids.add(eid); pairs.add(k);
      edges.push({ id: eid, source: a, target: b, type: typeof e.type === "string" && types.has(e.type) ? e.type : null, dir: DIRS.includes(e.dir) ? e.dir : "side" });
    });
    const vp = validVp(s.viewport) ? { x: Math.round(s.viewport.x), y: Math.round(s.viewport.y), zoom: +(+s.viewport.zoom).toFixed(3) } : null;
    return { id, name: str(s.name, 40).trim() || "Lembar", nodes, edges, viewport: vp };
  }
  function cleanDoc(d) {
    if (!isObj(d)) return null;
    const used = new Set();
    const types = (Array.isArray(d.types) ? d.types : []).map((t) => cleanType(t, used)).filter(Boolean).slice(0, 40);
    const tagIds = new Set();
    const tags = (Array.isArray(d.tags) ? d.tags : []).filter(isObj).map((t) => {
      const id = idOk(t.id, 60) && !tagIds.has(t.id) ? t.id : uid("g");
      tagIds.add(id);
      return { id, name: str(t.name, 30).trim() || "Label", color: COLORS[t.color] ? t.color : "amber" };
    }).slice(0, 30);
    const tset = new Set(types.map((t) => t.id));
    const seen = new Set();
    let sheets = (Array.isArray(d.sheets) ? d.sheets : []).map((s) => cleanSheet(s, tagIds, tset)).filter((s) => s && !seen.has(s.id) && seen.add(s.id));
    if (!sheets.length) sheets = [newSheetObj("Utama", true)];
    const id = idOk(d.id, 80) ? d.id : uid("j");
    return {
      id, title: str(d.title, 80).trim() || "Jejaring", template: TPL[d.template] ? d.template : "kosong", types, tags, sheets,
      activeSheet: sheets.some((s) => s.id === d.activeSheet) ? d.activeSheet : sheets[0].id,
    };
  }
  // dipanggil tiap show(): p.data.jejaring dibuat / diperbaiki (diam-diam, tidak menandai project berubah)
  function dataOf(p) {
    let j = p.data.jejaring;
    if (!isObj(j)) j = p.data.jejaring = { v: 1, active: null, docs: [] };
    const seen = new Set();
    j.docs = (Array.isArray(j.docs) ? j.docs : []).map(cleanDoc).filter((d) => d && !seen.has(d.id) && seen.add(d.id));
    if (!j.docs.some((d) => d.id === j.active)) j.active = j.docs[0] ? j.docs[0].id : null;
    j.v = 1;
    // karakter Organize yang sudah dihapus -> kartu tidak lagi tertaut (nama cadangan tetap)
    const cm = new Set(chars().map((c) => c.id));
    j.docs.forEach((d) => d.sheets.forEach((s) => s.nodes.forEach((n) => { if (n.charId && !cm.has(n.charId)) delete n.charId; })));
    return j;
  }
  function newSheetObj(name, withCard) {
    return { id: uid("s"), name, nodes: withCard ? [{ id: uid("n"), t: "person", x: -CARD_W / 2, y: -CARD_H / 2, name: "", tags: [] }] : [], edges: [], viewport: null };
  }

  // ================= TATA LETAK OTOMATIS (berlapis per generasi, tanpa dependensi) =================
  // nodes: [{ id, x, y }]  rels: [{ a, b, kind }]  kind "down" = a orang tua/atasan b, "side" = sejajar.
  // Hasil: Map id -> { x, y } (kiri-atas 0,0). Generasi dari BFS (orang tua = gen-1), urutan baris dengan barycenter,
  // kartu yang berelasi samping (pasangan/saudara) menjadi satu blok berurutan, lalu blok diratakan ke tengah orang tua/anak.
  function layoutTree(nodes, rels) {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const adj = new Map(nodes.map((n) => [n.id, []]));
    rels.forEach((r) => {
      if (!byId.has(r.a) || !byId.has(r.b) || r.a === r.b) return;
      const off = r.kind === "down" ? 1 : 0;
      adj.get(r.a).push({ v: r.b, off });
      adj.get(r.b).push({ v: r.a, off: -off });
    });
    const gen = new Map(), comps = [];
    nodes.slice().sort((p, q) => p.y - q.y || p.x - q.x).forEach((n) => {
      if (gen.has(n.id)) return;
      const comp = [n.id];
      gen.set(n.id, 0);
      for (let i = 0; i < comp.length; i++) {
        const u = comp[i];
        adj.get(u).forEach(({ v, off }) => { if (!gen.has(v)) { gen.set(v, gen.get(u) + off); comp.push(v); } });
      }
      const g0 = Math.min(...comp.map((id) => gen.get(id)));
      comp.forEach((id) => gen.set(id, gen.get(id) - g0));
      comps.push(comp);
    });
    const rel = (id, d) => adj.get(id).filter((e) => e.off === d && gen.get(e.v) === gen.get(id) + d).map((e) => e.v);
    const out = new Map();
    let cx = 0;
    comps.sort((a, b) => Math.min(...a.map((id) => byId.get(id).x)) - Math.min(...b.map((id) => byId.get(id).x)));
    comps.forEach((comp) => {
      const res = layoutComp(comp, gen, byId, (id) => rel(id, -1), (id) => rel(id, 1), (id) => rel(id, 0));
      let maxX = 0;
      res.forEach((p, id) => { out.set(id, { x: p.x + cx, y: p.y }); maxX = Math.max(maxX, p.x + CARD_W); });
      cx += maxX + GAP_COMP;
    });
    return out;
  }
  function layoutComp(comp, gen, byId, parentsOf, childrenOf, sidesOf) {
    const X = (id) => byId.get(id).x;
    const rows = [];
    comp.forEach((id) => { const g = gen.get(id); (rows[g] = rows[g] || []).push(id); });
    for (let g = 0; g < rows.length; g++) rows[g] = rows[g] || [];
    const STEP = CARD_W + GAP_SIDE;
    // blok: kartu yang tersambung relasi samping di baris yang sama, diurutkan sebagai rantai
    const blocks = rows.map((ids) => {
      const seen = new Set(), list = [];
      ids.slice().sort((a, b) => X(a) - X(b)).forEach((id) => {
        if (seen.has(id)) return;
        const mem = [id];
        seen.add(id);
        for (let i = 0; i < mem.length; i++) sidesOf(mem[i]).forEach((v) => { if (!seen.has(v)) { seen.add(v); mem.push(v); } });
        const start = mem.slice().sort((a, b) => sidesOf(a).length - sidesOf(b).length || X(a) - X(b))[0];
        const ord = [], vis = new Set();
        const walk = (u) => { vis.add(u); ord.push(u); sidesOf(u).slice().sort((a, b) => X(a) - X(b)).forEach((v) => { if (!vis.has(v)) walk(v); }); };
        walk(start);
        list.push({ ids: ord, w: ord.length * CARD_W + (ord.length - 1) * GAP_SIDE, x: 0 });
      });
      return list;
    });
    // urutan blok per baris: barycenter (indeks) terhadap baris atas / bawah, beberapa putaran
    const idx = new Map();
    const reindex = () => blocks.forEach((bl) => { let k = 0; bl.forEach((b) => b.ids.forEach((id) => idx.set(id, k++))); });
    reindex();
    const avg = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
    const sortRow = (g, relOf) => {
      const keyed = blocks[g].map((b, i) => {
        const xs = [];
        b.ids.forEach((id) => relOf(id).forEach((v) => xs.push(idx.get(v))));
        const k = avg(xs);
        return { b, i, k: k === null ? avg(b.ids.map((id) => idx.get(id))) : k };
      });
      keyed.sort((p, q) => p.k - q.k || p.i - q.i);
      blocks[g] = keyed.map((x) => x.b);
      reindex();
    };
    for (let it = 0; it < 3; it++) {
      for (let g = 1; g < rows.length; g++) sortRow(g, parentsOf);
      for (let g = rows.length - 2; g >= 0; g--) sortRow(g, childrenOf);
    }
    // koordinat: awal berurutan, lalu tiap blok ditarik ke tengah orang tua (turun) / anak (naik)
    const center = new Map();
    const upd = (g) => blocks[g].forEach((b) => b.ids.forEach((id, k) => center.set(id, b.x + k * STEP + CARD_W / 2)));
    blocks.forEach((bl, g) => { let x = 0; bl.forEach((b) => { b.x = x; x += b.w + GAP_BLOCK; }); upd(g); });
    const place = (g, relOf) => {
      const bl = blocks[g];
      if (!bl.length) return;
      // x blok yang diinginkan: tiap anggota yang berelasi ditarik ke tengah kerabatnya (bukan tengah blok), mis. anak
      // dari satu pasangan tepat di bawah orang tuanya, bukan di bawah tengah blok "pasangan + saudara tiri"
      const want = bl.map((b) => { const xs = []; b.ids.forEach((id, k) => relOf(id).forEach((v) => xs.push(center.get(v) - k * STEP - CARD_W / 2))); return avg(xs); });
      let prev = -Infinity;
      bl.forEach((b, i) => { b.x = Math.max(want[i] === null ? b.x : want[i], prev + GAP_BLOCK); prev = b.x + b.w; });
      const diffs = [];
      bl.forEach((b, i) => { if (want[i] !== null) diffs.push(want[i] - b.x); });
      const sh = avg(diffs) || 0;
      if (sh < 0) bl.forEach((b) => { b.x += sh; });   // hanya geser ke kiri: dorongan ke kanan sudah rapat
      upd(g);
    };
    for (let it = 0; it < 4; it++) {
      for (let g = 1; g < rows.length; g++) place(g, parentsOf);
      for (let g = rows.length - 2; g >= 0; g--) place(g, childrenOf);
    }
    let minX = Infinity;
    blocks.forEach((bl) => bl.forEach((b) => { minX = Math.min(minX, b.x); }));
    const res = new Map();
    blocks.forEach((bl, g) => bl.forEach((b) => b.ids.forEach((id, k) => res.set(id, { x: Math.round(b.x - minX + k * STEP), y: g * (CARD_H + GAP_GEN) }))));
    return res;
  }
  // relasi edge -> bentuk untuk layoutTree
  function relsOf(edges, tm) {
    return edges.map((e) => {
      const ty = e.type ? tm.get(e.type) : null, d = ty ? ty.dir : e.dir || "side";
      return d === "down" ? { a: e.source, b: e.target, kind: "down" } : d === "up" ? { a: e.target, b: e.source, kind: "down" } : { a: e.source, b: e.target, kind: "side" };
    });
  }

  // ================= RIWAYAT (urungkan / ulangi), satu tumpukan per jejaring =================
  const cloneN = (n) => { const o = { ...n }; if (n.tags) o.tags = n.tags.slice(); return o; };
  const snap = () => ({ sheet: sheet.id, nodes: sheet.nodes.map(cloneN), edges: sheet.edges.map((e) => ({ ...e })), types: doc.types.map((t) => ({ ...t })), tags: doc.tags.map((t) => ({ ...t })) });
  function H() { const k = projId + "|" + doc.id; let x = hist.get(k); if (!x) hist.set(k, (x = { undo: [], redo: [] })); return x; }
  function pushUndo(s) { const x = H(); x.undo.push(s); if (x.undo.length > 80) x.undo.shift(); x.redo.length = 0; }
  function applySnap(s) {
    const sh = doc.sheets.find((x) => x.id === s.sheet);
    if (!sh) return false;
    if (sh !== sheet) switchSheet(sh.id, true);
    sheet.nodes = s.nodes; sheet.edges = s.edges; doc.types = s.types; doc.tags = s.tags;
    changed([]);
    return true;
  }
  function stepHist(from, to, msg) {
    if (!doc) return;
    while (from.length) {
      const s = from.pop(), cur = doc.sheets.find((x) => x.id === s.sheet);
      if (!cur) continue;   // lembarnya sudah dihapus
      const was = sheet;
      sheet = cur;
      to.push(snap());
      sheet = was;
      applySnap(s);
      return;
    }
    toast(msg);
  }
  function undo() { if (doc) stepHist(H().undo, H().redo, "Tidak ada yang bisa diurungkan."); }
  function redo() { if (doc) stepHist(H().redo, H().undo, "Tidak ada yang bisa diulangi."); }
  function changed(sel) { rev++; pendingSel = sel || null; renderFlow(); save(); updateChrome(); }
  function mutate(fn, sel) { const s = snap(); if (fn() === false) return false; pushUndo(s); changed(sel); return true; }

  // ================= REACT FLOW: node =================
  const UiCtx = React.createContext({ tool: "select", editing: null, setEditing: () => {}, dragging: false });

  // kolom edit (nama / catatan / teks). Uncontrolled: nilai dibaca saat selesai (blur, Enter, Esc)
  function EditArea({ id, value, single, className, autoGrow, max, placeholder }) {
    const ref = React.useRef(null), done = React.useRef(false);
    React.useEffect(() => {
      let n = 0, raf = 0;
      const go = () => {
        const t = ref.current;
        if (!t) return;
        t.focus({ preventScroll: true });
        if (document.activeElement === t) { try { t.select(); } catch (e) { /* abaikan */ } grow(); }
        else if (n++ < 40) raf = requestAnimationFrame(go);
      };
      go();
      return () => cancelAnimationFrame(raf);
    }, []);
    const grow = () => { const t = ref.current; if (autoGrow && t) { t.style.height = "auto"; t.style.height = t.scrollHeight + "px"; } };
    const fin = (cancel) => { if (done.current) return; done.current = true; commitEdit(id, ref.current ? ref.current.value : value, false, cancel); };
    return h(single ? "input" : "textarea", {
      ref, className: "jj-edit nodrag nopan nowheel " + (className || ""), defaultValue: value || "", "data-id": id, placeholder: placeholder || "",
      spellCheck: !single, "aria-label": single ? "Nama tokoh" : "Edit teks", maxLength: max || 5000, onBlur: () => fin(false), onInput: grow,
      onKeyDown: (e) => {
        e.stopPropagation();
        if (e.key === "Escape") { e.preventDefault(); fin(true); return; }
        if (((e.metaKey || e.ctrlKey) && e.key === "Enter") || (single && e.key === "Enter")) { e.preventDefault(); fin(false); }
      },
      onPointerDown: (e) => e.stopPropagation(), onDoubleClick: (e) => e.stopPropagation(),
    });
  }
  function CharTip({ charId }) {
    const c = charMap().get(charId);
    if (!c) return null;
    const txt = plain(c.content), snip = txt.slice(0, 150);
    return h("div", { className: "jj-tip-card" },
      h("div", { className: "jj-tip-top" }, ic("#ti-id", 13), h("span", null, "Kartu Organize")),
      h("div", { className: "jj-tip-title" }, charName(c)),
      h("p", { className: "jj-tip-snip" + (snip ? "" : " is-empty") }, snip ? snip + (txt.length > 150 ? "…" : "") : "Belum ada deskripsi."));
  }
  const PersonNode = React.memo(function PersonNode({ id, data, selected }) {
    const ui = React.useContext(UiCtx), m = data.m;
    const [hover, setHover] = React.useState(false);
    const can = ui.tool === "select", ed = ui.editing === "name:" + id;
    const plusOn = selected && can && !ui.dragging && !ui.editing;
    const plus = (side, pos, label) => h(RF.Handle, {
      key: side, type: "source", position: pos, id: side, isConnectable: can, className: "jj-plus is-" + side + (plusOn ? " is-on" : ""),
      title: label, "aria-label": label, role: "button",
      onClick: (e) => { e.stopPropagation(); if (can) openRel(id, side, e.currentTarget); },
    }, ic("#ti-plus", 11));
    const name = data.name;
    return h("div", {
      className: "jj-card" + (m.photo ? " has-photo" : " is-empty") + (selected ? " is-sel" : "") + (data.linked ? " is-linked" : "") + (data.dim ? " is-dim" : ""),
      onPointerEnter: (e) => { if (e.pointerType !== "touch") setHover(true); }, onPointerLeave: () => setHover(false),
    },
      h(RF.Handle, { type: "target", position: P.Top, id: "c", isConnectableStart: false, className: "jj-hit" }),
      h("div", { className: "jj-photo" },
        m.photo ? h("img", { src: m.photo, alt: "", draggable: false })
          : h("button", { type: "button", className: "jj-photo-add", tabIndex: -1, "aria-label": "Tambah foto",
            onClick: (e) => { if (selected && can) { e.stopPropagation(); pickPhoto(id); } } }, ic("#ti-plus", 30)),
        data.tags.length ? h("div", { className: "jj-tags" }, data.tags.slice(0, 2).map((t) => h("span", { key: t.id, className: "jj-tag", style: { "--c": COLORS[t.color] } }, t.name)),
          data.tags.length > 2 ? h("span", { className: "jj-tag is-more" }, "+" + (data.tags.length - 2)) : null) : null,
        m.emoji ? h("span", { className: "jj-badge", "aria-hidden": "true" }, m.emoji) : null,
        data.linked ? h("span", { className: "jj-linked", title: "Tertaut ke kartu Organize" }, ic("#ti-link", 11)) : null),
      ed ? h(EditArea, { id: "name:" + id, value: name, single: true, className: "jj-name-edit", max: 80, placeholder: "Nama tokoh" })
        : h("button", { type: "button", className: "jj-name" + (name ? "" : " is-ph"), tabIndex: -1,
          onClick: (e) => { if (selected && can) { e.stopPropagation(); ui.setEditing("name:" + id); } } }, name || "Tambah nama"),
      plus("t", P.Top, "Tambah relasi di atas"), plus("r", P.Right, "Tambah relasi di kanan"),
      plus("b", P.Bottom, "Tambah relasi di bawah"), plus("l", P.Left, "Tambah relasi di kiri"),
      hover && !selected && can && !ui.dragging && data.linked ? h(RF.NodeToolbar, { isVisible: true, position: P.Bottom, offset: 8, className: "jj-tip" }, h(CharTip, { charId: m.charId })) : null);
  });
  const NoteNode = React.memo(function NoteNode({ id, data, selected }) {
    const ui = React.useContext(UiCtx), m = data.m, ed = ui.editing === id;
    return h("div", { className: "jj-note", style: { "--c": NOTE_COLORS[m.color] || NOTE_COLORS.yellow } },
      selected && ui.tool === "select" ? h(RF.NodeResizer, { minWidth: 90, minHeight: 70, lineClassName: "jj-rz-line", handleClassName: "jj-rz-handle",
        onResizeStart: () => { rzSnap = snap(); closeMenu(); }, onResizeEnd: (e, p) => resizeEnd(id, p) }) : null,
      ed ? h(EditArea, { id, value: m.text, className: "jj-note-edit" })
        : h("div", { className: "jj-note-text" }, m.text || h("span", { className: "jj-ph" }, "Klik dua kali untuk menulis…")));
  });
  const TextNode = React.memo(function TextNode({ id, data, selected }) {
    const ui = React.useContext(UiCtx), m = data.m, ed = ui.editing === id;
    return h("div", { className: "jj-textn" + (selected ? " is-sel" : ""), style: { "--fz": TEXT_SIZES[m.size] || 24 } },
      selected && ui.tool === "select" ? h(RF.NodeResizeControl, { position: "right", variant: RF.ResizeControlVariant.Line, minWidth: 50, className: "jj-rz-w",
        onResizeStart: () => { rzSnap = snap(); closeMenu(); }, onResizeEnd: (e, p) => resizeEnd(id, p) }) : null,
      ed ? h(EditArea, { id, value: m.text, className: "jj-textn-edit", autoGrow: true })
        : h("div", { className: "jj-textn-body" }, m.text || h("span", { className: "jj-ph" }, "Teks")));
  });
  // kartu contoh di pratinjau wizard (inisial berwarna, tanpa interaksi)
  const PreviewNode = React.memo(function PreviewNode({ data }) {
    const hh = hue(data.name);
    return h("div", { className: "jj-card is-pv has-photo" },
      h(RF.Handle, { type: "target", position: P.Top, id: "c", isConnectable: false, className: "jj-hit" }),
      h(RF.Handle, { type: "source", position: P.Bottom, id: "s", isConnectable: false, className: "jj-hit" }),   // garis butuh pegangan sumber
      h("div", { className: "jj-photo jj-pv-photo", style: { "--h1": `hsl(${hh} 42% 46%)`, "--h2": `hsl(${(hh + 48) % 360} 48% 24%)` } }, h("span", null, initials(data.name))),
      h("span", { className: "jj-name" }, data.name));
  });
  const NODE_TYPES = { person: PersonNode, note: NoteNode, text: TextNode, pv: PreviewNode };

  // ================= REACT FLOW: garis relasi (siku, berlabel) =================
  function rectOf(n) {
    const p = n.positionAbsolute || n.position, w = n.width || CARD_W, hh = n.height || CARD_H;
    return { x: p.x, y: p.y, w, h: hh, cx: p.x + w / 2, my: p.y + Math.min(PHOTO_H / 2, hh / 2) };
  }
  // vertikal bila kedua kartu berbeda baris (atas -> bawah), selain itu samping (kanan -> kiri)
  function route(s, t) {
    const a = rectOf(s), b = rectOf(t);
    if (b.y >= a.y + a.h + 6) return { sx: a.cx, sy: a.y + a.h, sp: P.Bottom, tx: b.cx, ty: b.y, tp: P.Top };
    if (a.y >= b.y + b.h + 6) return { sx: a.cx, sy: a.y, sp: P.Top, tx: b.cx, ty: b.y + b.h, tp: P.Bottom };
    if (b.cx >= a.cx) return { sx: a.x + a.w, sy: a.my, sp: P.Right, tx: b.x, ty: b.my, tp: P.Left };
    return { sx: a.x, sy: a.my, sp: P.Left, tx: b.x + b.w, ty: b.my, tp: P.Right };
  }
  function RelEdge({ id, source, target, data, selected }) {
    const s = RF.useStore(React.useCallback((st) => st.nodeInternals.get(source), [source]));
    const t = RF.useStore(React.useCallback((st) => st.nodeInternals.get(target), [target]));
    if (!s || !t || !s.width || !t.width) return null;
    const r = route(s, t);
    const [path, lx, ly] = RF.getSmoothStepPath({ sourceX: r.sx, sourceY: r.sy, sourcePosition: r.sp, targetX: r.tx, targetY: r.ty, targetPosition: r.tp, borderRadius: 10, offset: 16 });
    const ty = data && data.ty, pv = !!(data && data.pv), col = ty && ty.color ? COLORS[ty.color] : "";
    const style = {};
    if (ty && ty.dashed) style.strokeDasharray = "6 5";
    if (col) style.stroke = col;
    const chipStyle = { transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)` };
    if (col) chipStyle["--c"] = col;
    return h(React.Fragment, null,
      h(RF.BaseEdge, { id, path, style, interactionWidth: pv ? 0 : 16 }),
      ty ? h(RF.EdgeLabelRenderer, null, pv
        ? h("div", { className: "jj-elabel is-pv" + (col ? " has-c" : ""), style: chipStyle }, ic(typeIc(ty), 10), h("span", null, ty.label))
        : h("button", { type: "button", className: "jj-elabel nopan nodrag" + (selected ? " is-sel" : "") + (col ? " has-c" : ""), style: chipStyle,
          "aria-label": "Relasi " + ty.label + " — ubah", onClick: (e) => { e.stopPropagation(); edgeMenu(id, e.currentTarget); } },
          ic(typeIc(ty), 11), h("span", null, ty.label))) : null);
  }
  const EDGE_TYPES = { rel: RelEdge };

  // ---------- model -> node/garis React Flow ----------
  function buildNodes(sel, prev) {
    const cm = charMap(), tg = tagMap(), pm = new Map((prev || []).map((n) => [n.id, n]));
    return sheet.nodes.map((m) => {
      const o = { id: m.id, type: m.t, position: { x: m.x, y: m.y }, selected: sel.has(m.id), data: { m } };
      if (m.t === "person") {
        const c = m.charId ? cm.get(m.charId) : null;
        o.data = { m, name: c ? charName(c) : m.name, linked: !!c, tags: (m.tags || []).map((id) => tg.get(id)).filter(Boolean), dim: !!focusTag && !(m.tags || []).includes(focusTag) };
        o.style = { width: CARD_W, height: CARD_H }; o.width = CARD_W; o.height = CARD_H;
      } else if (m.t === "note") { o.style = { width: m.w, height: m.h }; o.width = m.w; o.height = m.h; if (focusTag) o.className = "is-dim"; }
      else {
        o.style = { width: m.w };
        const p = pm.get(m.id);
        o.width = m.w; o.height = p && p.height ? p.height : Math.round((TEXT_SIZES[m.size] || 24) * 1.25 * fsScale() + 4);
        if (focusTag) o.className = "is-dim";
      }
      return o;
    });
  }
  function buildEdges(sel) {
    const tm = typeMap();
    return sheet.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, type: "rel", selected: sel.has(e.id), data: { ty: e.type ? tm.get(e.type) || null : null } }));
  }

  // ================= alat taruh (tokoh / catatan / teks): klik di kanvas, catatan bisa diseret =================
  function PlaceLayer({ kind }) {
    const rf = RF.useReactFlow();
    const [g, setG] = React.useState(null);
    const st = React.useRef(null);
    const onPointerDown = (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      closeMenu();
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch (er) { /* abaikan */ }
      const r = e.currentTarget.getBoundingClientRect();
      st.current = { x0: e.clientX, y0: e.clientY, r, id: e.pointerId };
      if (kind === "note") setG({ l: e.clientX - r.left, t: e.clientY - r.top, w: 0, h: 0 });
    };
    const onPointerMove = (e) => {
      const s = st.current;
      if (!s || s.id !== e.pointerId || kind !== "note") return;
      setG({ l: Math.min(s.x0, e.clientX) - s.r.left, t: Math.min(s.y0, e.clientY) - s.r.top, w: Math.abs(e.clientX - s.x0), h: Math.abs(e.clientY - s.y0) });
    };
    const onPointerUp = (e) => {
      const s = st.current;
      st.current = null; setG(null);
      if (!s || s.id !== e.pointerId) return;
      const a = rf.screenToFlowPosition({ x: s.x0, y: s.y0 }), b = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      placeAt(kind, a, b, kind === "note" && Math.hypot(e.clientX - s.x0, e.clientY - s.y0) > 8);
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
    return h("div", { className: "jj-place nopan nodrag nowheel is-" + kind, onPointerDown, onPointerMove, onPointerUp, onPointerCancel: () => { st.current = null; setG(null); }, onWheel },
      g ? h("div", { className: "jj-ghost", style: { left: g.l, top: g.t, width: g.w, height: g.h } }) : null);
  }

  // ================= bilah aksi kartu terpilih (seperti referensi: Buat kartu · Tautkan kartu · foto · emoji · label · hapus) =================
  function SelBar({ sel }) {
    const ms = sel.map((n) => findNode(n.id)).filter(Boolean);
    if (!ms.length) return null;
    const one = ms.length === 1 ? ms[0] : null, allP = ms.every((m) => m.t === "person");
    const btn = (act, label, icon, o) => h("button", Object.assign({
      key: act + ((o && o.k) || ""), type: "button", className: "jj-sb-btn" + (o && o.cls ? " " + o.cls : ""), "aria-label": label,
      onClick: (e) => { e.stopPropagation(); runAct(act, o && o.arg, e.currentTarget); },
    }, o && o.text ? {} : { "data-tip": label }, o && o.attrs), icon, o && o.text ? h("span", null, o.text) : null);
    const sep = (k) => h("span", { key: "sep" + k, className: "jj-sb-sep" });
    const parts = [];
    if (one && one.t === "person") {
      const linked = !!(one.charId && charMap().get(one.charId));
      parts.push(linked ? btn("opencard", "Buka kartu di Organize", ic("#ti-id", 14), { text: "Buka kartu", cls: "is-wide" })
        : btn("makecard", "Buat kartu tokoh di Organize", ic("#ti-user-plus", 14), { text: "Buat kartu", cls: "is-wide" }));
      parts.push(btn("linkcard", linked ? "Ganti tautan kartu" : "Tautkan ke kartu tokoh", ic("#ti-link", 14), { text: linked ? "Ganti tautan" : "Tautkan kartu", cls: "is-wide", attrs: { "aria-haspopup": "menu" } }));
      parts.push(sep(1));
      parts.push(btn("photo", one.photo ? "Foto" : "Tambah foto", ic("#ti-photo", 15)));
      parts.push(sep(2));
      parts.push(btn("emoji", "Lencana emoji", ic("#ti-mood-smile", 15), { attrs: { "aria-haspopup": "menu" } }));
    }
    if (one && one.t === "note") {
      Object.keys(NOTE_COLORS).forEach((k) => parts.push(h("button", { key: "c" + k, type: "button", className: "jj-sw is-note", style: { "--c": NOTE_COLORS[k] }, "data-tip": NOTE_NAMES[k],
        "aria-label": "Warna " + NOTE_NAMES[k], "aria-pressed": one.color === k ? "true" : "false", onClick: (e) => { e.stopPropagation(); runAct("notecolor", k); } })));
      parts.push(sep(3));
    }
    if (one && one.t === "text") {
      ["s", "m", "l"].forEach((k) => parts.push(h("button", { key: "z" + k, type: "button", className: "jj-sb-btn jj-sb-size", "aria-pressed": one.size === k ? "true" : "false",
        "data-tip": { s: "Teks kecil", m: "Teks sedang", l: "Teks besar" }[k], onClick: (e) => { e.stopPropagation(); runAct("tsize", k); } }, k.toUpperCase())));
      parts.push(sep(4));
    }
    if (allP) parts.push(btn("tagsel", "Label", ic("#ti-tag", 15), { attrs: { "aria-haspopup": "menu" } }));
    if (!one || one.t !== "person") parts.push(btn("dup", "Duplikat · " + MOD + "+D", ic("#ti-copy-plus", 15)));
    parts.push(btn("del", "Hapus · Delete", ic("#ti-trash", 15), { cls: "is-danger" }));
    return h(RF.NodeToolbar, { nodeId: ms.map((m) => m.id), isVisible: true, position: P.Top, offset: ms.some((m) => m.t === "person") ? 30 : 12, className: "jj-selbar nopan nodrag nowheel" }, parts);
  }

  // ================= REACT FLOW: aplikasi kanvas =================
  function App(props) {
    const t = props.space ? "hand" : props.tool;
    const sel = t === "select", place = PLACE.includes(t);
    const init = React.useMemo(() => ({ nodes: buildNodes(new Set(props.sel || []), null), edges: buildEdges(new Set()) }), []);
    const [nodes, setNodes] = RF.useNodesState(init.nodes);
    const [edges, setEdges] = RF.useEdgesState(init.edges);
    const [editing, setEditing] = React.useState(null);
    const [dragging, setDragging] = React.useState(false);
    const [connecting, setConnecting] = React.useState(false);
    const boxSel = RF.useStore((s) => s.userSelectionActive);
    const rf = RF.useReactFlow(), store = RF.useStoreApi();
    const box = sel && (props.shift || boxSel);
    React.useEffect(() => { store.setState({ multiSelectionActive: !!(sel && props.multi) }); }, [sel, props.multi]);
    const first = React.useRef(true), drag = React.useRef(null), conn = React.useRef(null);

    React.useEffect(() => { api = { rf, store, setNodes, setEdges, setEditing }; return () => { if (api && api.rf === rf) api = null; }; }, [rf]);
    React.useEffect(() => { editingNow = editing; }, [editing]);
    React.useEffect(() => {
      if (first.current) { first.current = false; return; }
      const keep = pendingSel; pendingSel = null;
      setNodes((prev) => buildNodes(keep ? new Set(keep) : new Set(prev.filter((n) => n.selected).map((n) => n.id)), prev));
      setEdges((prev) => buildEdges(keep ? new Set(keep) : new Set(prev.filter((e) => e.selected).map((e) => e.id))));
    }, [props.rev]);

    const onNodesChange = React.useCallback((ch) => setNodes((ns) => RF.applyNodeChanges(ch.filter((c) => c.type !== "remove"), ns)), []);
    const onEdgesChange = React.useCallback((ch) => setEdges((es) => RF.applyEdgeChanges(ch.filter((c) => c.type !== "remove"), es)), []);
    const onNodeDragStart = () => { closeMenu(); drag.current = { snap: snap() }; setDragging(true); };
    const onNodeDragStop = (e, node, dragged) => {
      const d = drag.current;
      drag.current = null; setDragging(false);
      if (!d) return;
      let moved = false;
      (dragged && dragged.length ? dragged : [node]).forEach((n) => {
        const m = findNode(n.id);
        if (!m) return;
        const x = Math.round(n.position.x), y = Math.round(n.position.y);
        if (m.x !== x || m.y !== y) { m.x = x; m.y = y; moved = true; }
      });
      if (moved) { pushUndo(d.snap); save(); updateChrome(); }
    };
    const onNodeDoubleClick = (e, node) => {
      if (t !== "select") return;
      if (node.type === "person") setEditing("name:" + node.id);
      else setEditing(node.id);
    };
    // seret dari "+" ke kartu lain = hubungkan (lalu pilih jenis relasi); dilepas di latar = kartu baru di titik itu
    const pt = (e) => { const tt = e && e.changedTouches && e.changedTouches[0]; return tt ? { x: tt.clientX, y: tt.clientY } : { x: e ? e.clientX : 0, y: e ? e.clientY : 0 }; };
    const onConnectStart = (e, p) => { closeMenu(); const q = pt(e); conn.current = { nodeId: p.nodeId, side: p.handleId, x: q.x, y: q.y, made: null }; setConnecting(true); };
    const onConnect = (c) => { if (conn.current) conn.current.made = c; };
    const onConnectEnd = (e) => {
      const c = conn.current;
      conn.current = null; setConnecting(false);
      if (!c) return;
      const q = pt(e);
      if (c.made) {
        if (c.made.source === c.made.target) return;
        if (sheet.edges.some((x) => (x.source === c.made.source && x.target === c.made.target) || (x.source === c.made.target && x.target === c.made.source))) { toast("Kedua tokoh ini sudah terhubung — klik garisnya untuk mengubah relasi."); return; }
        relCtx = { mode: "connect", nodeId: c.made.source, target: c.made.target, side: c.side, view: "grid" };
        openMenu("rel", null, { x: q.x, y: q.y });
        return;
      }
      const under = document.elementFromPoint(q.x, q.y);
      if (Math.hypot(q.x - c.x, q.y - c.y) > 14 && under && under.closest(".react-flow__pane") && !under.closest(".react-flow__node")) {
        relCtx = { mode: "new", nodeId: c.nodeId, side: c.side, at: rf.screenToFlowPosition(q), view: "grid", char: null };
        openMenu("rel", null, { x: q.x, y: q.y });
      }
    };
    const ctxMenu = (kind) => (e, item) => {
      e.preventDefault();
      if (t !== "select") return;
      if (kind === "node" && item && !item.selected) selectOnly([item.id]);
      if (kind === "edge") { selectOnly([], [item.id]); edgeMenu(item.id, null, { x: e.clientX, y: e.clientY }); return; }
      ctxPos = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      openMenu(kind === "sel" ? "node" : kind, null, { x: e.clientX, y: e.clientY });
    };

    const ui = React.useMemo(() => ({ tool: t, editing, setEditing, dragging }), [t, editing, dragging]);
    const selN = nodes.filter((n) => n.selected);
    return h(UiCtx.Provider, { value: ui },
      h(Flow, {
        nodes, edges, nodeTypes: NODE_TYPES, edgeTypes: EDGE_TYPES, onNodesChange, onEdgesChange,
        onConnect, onConnectStart, onConnectEnd, onNodeDoubleClick, onNodeDragStart, onNodeDragStop,
        onEdgeClick: (e, edge) => { if (t === "select" && !e.shiftKey && !e.ctrlKey && !e.metaKey) edgeMenu(edge.id, null, { x: e.clientX, y: e.clientY }); },
        onNodeContextMenu: ctxMenu("node"), onSelectionContextMenu: ctxMenu("sel"), onPaneContextMenu: ctxMenu("pane"), onEdgeContextMenu: ctxMenu("edge"),
        onPaneClick: () => closeMenu(),
        onMoveEnd: (e, v) => saveViewport(v),
        defaultViewport: props.vp || undefined, fitView: !props.vp, fitViewOptions: { padding: 0.3, maxZoom: 1 },
        minZoom: MIN_Z, maxZoom: MAX_Z,
        nodesDraggable: sel, nodesConnectable: sel, elementsSelectable: sel, selectNodesOnDrag: sel,
        panOnDrag: place ? false : box ? [1] : [0, 1], selectionOnDrag: box,
        selectionKeyCode: null, multiSelectionKeyCode: null, deleteKeyCode: null, panActivationKeyCode: null, zoomActivationKeyCode: null,
        panOnScroll: !props.meta, panOnScrollSpeed: 0.9, zoomOnScroll: !!props.meta, zoomOnPinch: true, zoomOnDoubleClick: false, preventScrolling: true,
        connectionMode: RF.ConnectionMode.Loose, connectOnClick: false, connectionRadius: 30,
        connectionLineType: RF.ConnectionLineType.SmoothStep, connectionLineStyle: { stroke: "var(--accent)", strokeWidth: 1.8, strokeDasharray: "5 4" },
        elevateNodesOnSelect: false, elevateEdgesOnSelect: false, disableKeyboardA11y: true, nodeDragThreshold: 2,
        selectionMode: RF.SelectionMode.Partial, edgesUpdatable: false, edgesFocusable: false, nodesFocusable: false,
        attributionPosition: "bottom-left", className: "jj-rf is-" + t + (connecting ? " is-connecting" : "") + (props.focus ? " is-focus" : ""),
      },
        h(RF.Background, { variant: RF.BackgroundVariant.Dots, gap: 20, size: 1.3, color: "#8a8f99", className: "jj-bg" }),
        props.mini ? h(RF.MiniMap, { pannable: true, zoomable: true, position: "bottom-right", className: "jj-minimap", ariaLabel: "Peta mini jejaring",
          nodeColor: (n) => (n.type === "note" ? NOTE_COLORS[n.data.m.color] || NOTE_COLORS.yellow : n.type === "person" ? "#d7a86e" : "#8f97ab"), nodeBorderRadius: 3, nodeStrokeWidth: 0, maskColor: "rgba(0,0,0,0)" }) : null,
        sel && selN.length && !dragging && !editing && !boxSel && !connecting ? h(SelBar, { sel: selN }) : null,
        place ? h(PlaceLayer, { kind: t }) : null));
  }
  function renderFlow() {
    if (!dom) return;
    if (!doc || !sheet) { if (root) { try { root.unmount(); } catch (e) { /* abaikan */ } root = null; api = null; } return; }
    if (!root) root = ReactDOM.createRoot(dom.flow);
    root.render(h(RF.ReactFlowProvider, { key: doc.id + "|" + sheet.id }, h(App, { key: doc.id + "|" + sheet.id, rev, tool, space, mini, focus: !!focusTag, shift: mods.shift, meta: mods.meta, multi: mods.multi, vp: viewportOf(), sel: pendingSel })));
  }
  function viewportOf() {
    const v = lsGet(vpKey(doc, sheet));
    if (validVp(v)) return v;
    if (sheet.viewport) return sheet.viewport;
    return null;   // -> fitView
  }
  let vpTimer = null;
  function saveViewport(v) {
    if (!sheet) return;
    const vp = { x: Math.round(v.x), y: Math.round(v.y), zoom: +v.zoom.toFixed(3) };
    sheet.viewport = vp;   // ikut tersimpan bersama perubahan berikutnya (tidak memicu simpan sendiri)
    const key = vpKey(doc, sheet);
    clearTimeout(vpTimer);
    vpTimer = setTimeout(() => lsSet(key, vp), 150);
  }

  // ================= AKSI =================
  function selModels() { return api ? api.rf.getNodes().filter((n) => n.selected).map((n) => findNode(n.id)).filter(Boolean) : []; }
  function selEdgeIds() { return new Set(api ? api.rf.getEdges().filter((e) => e.selected).map((e) => e.id) : []); }
  function selectOnly(nodeIds, edgeIds) {
    if (!api) return;
    const n = new Set(nodeIds || []), e = new Set(edgeIds || []);
    api.store.setState({ nodesSelectionActive: false });
    api.setNodes((ns) => ns.map((x) => (!!x.selected === n.has(x.id) ? x : { ...x, selected: n.has(x.id) })));
    api.setEdges((es) => es.map((x) => (!!x.selected === e.has(x.id) ? x : { ...x, selected: e.has(x.id) })));
  }
  function viewCenter() {
    try { const r = dom.flow.getBoundingClientRect(); return api.rf.screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 }); }
    catch (e) { return { x: 0, y: 0 }; }
  }
  const sizeOf = (n) => (n.t === "person" ? { w: CARD_W, h: CARD_H } : { w: n.w || 200, h: n.h || 40 });
  function occupied(x, y, skip) {
    return sheet.nodes.some((n) => { if (n.id === skip) return false; const s = sizeOf(n); return x < n.x + s.w + 20 && x + CARD_W + 20 > n.x && y < n.y + s.h + 20 && y + CARD_H + 20 > n.y; });
  }
  function freeSpot(x, y, dx, dy) {
    for (let k = 0; k < 80 && occupied(x, y); k++) { x += dx; y += dy; }
    return { x: Math.round(x), y: Math.round(y) };
  }
  // tempat kartu baru relatif ke kartu sumber: atas/bawah = baris generasi, kiri/kanan = di sampingnya
  function spotFrom(src, where) {
    const tm = typeMap(), vert = [];
    sheet.edges.forEach((e) => {
      const ty = e.type ? tm.get(e.type) : null, d = ty ? ty.dir : e.dir;
      let other = null, up = false;
      if (e.source === src.id) { other = e.target; up = d === "up"; if (d !== "up" && d !== "down") return; }
      else if (e.target === src.id) { other = e.source; up = d === "down"; if (d !== "up" && d !== "down") return; }
      else return;
      const n = findNode(other);
      if (n && (where === "up") === up) vert.push(n);
    });
    const STEP = CARD_W + GAP_SIDE;
    if (where === "up" || where === "down") {
      const y = where === "up" ? src.y - CARD_H - GAP_GEN : src.y + CARD_H + GAP_GEN;
      const x = vert.length ? Math.max(...vert.map((n) => n.x)) + STEP : src.x;
      return freeSpot(x, y, STEP / 2, 0);
    }
    return freeSpot(where === "left" ? src.x - STEP : src.x + STEP, src.y, where === "left" ? -STEP / 2 : STEP / 2, 0);
  }
  const sideWhere = (side) => (side === "t" ? "up" : side === "b" ? "down" : side === "l" ? "left" : "right");
  const sideDir = (side) => (side === "t" ? "up" : side === "b" ? "down" : "side");
  // buat kartu baru dari "+" (atau seret ke latar) dengan jenis relasi typeId (null = tanpa label)
  function addRelated(srcId, side, typeId, at, charId, newType) {
    const src = findNode(srcId);
    if (!src) return;
    if (charId) {   // tokoh Organize itu sudah ada di lembar ini -> cukup hubungkan
      const ex = sheet.nodes.find((n) => n.t === "person" && n.charId === charId);
      if (ex) { connectPair(srcId, ex.id, typeId, sideDir(side), newType); return; }
    }
    const ty = newType || (typeId ? typeMap().get(typeId) : null);
    const where = ty && ty.dir !== "side" ? ty.dir : sideWhere(side) === "up" || sideWhere(side) === "down" ? (ty ? (side === "l" ? "left" : "right") : sideWhere(side)) : sideWhere(side);
    const pos = at ? freeSpot(Math.round(at.x - CARD_W / 2), Math.round(at.y - CARD_H / 2), 24, 24) : spotFrom(src, where);
    const c = charId ? charMap().get(charId) : null;
    const n = { id: uid("n"), t: "person", x: pos.x, y: pos.y, name: c ? charName(c) : "", tags: [] };
    if (c) n.charId = c.id;
    const e = { id: uid("e"), source: src.id, target: n.id, type: ty ? ty.id : null, dir: ty ? ty.dir : sideDir(side) };
    mutate(() => { if (newType) doc.types.push(newType); sheet.nodes.push(n); sheet.edges.push(e); }, [n.id]);
    if (!c && api) setTimeout(() => api && api.setEditing("name:" + n.id), 30);   // langsung ketik nama
  }
  function connectPair(a, b, typeId, dir, newType) {
    if (a === b) return;
    if (sheet.edges.some((x) => (x.source === a && x.target === b) || (x.source === b && x.target === a))) { toast("Kedua tokoh ini sudah terhubung."); return; }
    const A = findNode(a), B = findNode(b);
    const geo = !A || !B ? "side" : B.y + CARD_H + 6 <= A.y ? "up" : B.y >= A.y + CARD_H + 6 ? "down" : "side";
    const e = { id: uid("e"), source: a, target: b, type: typeId || null, dir: typeId ? dir || "side" : geo };
    mutate(() => { if (newType) doc.types.push(newType); sheet.edges.push(e); }, [b]);
  }
  function setEdgeType(edgeId, typeId, newType) {
    const e = sheet.edges.find((x) => x.id === edgeId);
    if (!e) return;
    if (e.type === typeId && !newType) return;
    mutate(() => { if (newType) doc.types.push(newType); e.type = typeId; if (!typeId) e.dir = e.dir || "side"; }, [e.target]);
  }
  function deleteSel() {
    const ms = selModels(), es = selEdgeIds();
    if (!ms.length && !es.size) return false;
    const del = new Set(ms.map((m) => m.id));
    mutate(() => {
      sheet.nodes = sheet.nodes.filter((m) => !del.has(m.id));
      sheet.edges = sheet.edges.filter((e) => !es.has(e.id) && !del.has(e.source) && !del.has(e.target));
    }, []);
    return true;
  }
  function cloneSet(models, edges, dx, dy, keepChar) {
    const map = new Map(), onSheet = new Set(sheet.nodes.filter((n) => n.charId).map((n) => n.charId));
    const nodes = models.map((m) => {
      const id = uid("n");
      map.set(m.id, id);
      const o = cloneN(m);
      o.id = id; o.x = Math.round(m.x + dx); o.y = Math.round(m.y + dy);
      if (o.t === "person" && o.charId) {
        const c = charMap().get(o.charId);
        if (c) o.name = charName(c);
        if (!keepChar || onSheet.has(o.charId)) delete o.charId; else onSheet.add(o.charId);
      }
      if (o.t === "person") o.tags = (o.tags || []).filter((t) => doc.tags.some((g) => g.id === t));
      return o;
    });
    const tm = typeMap();
    const es = edges.filter((e) => map.has(e.source) && map.has(e.target)).map((e) => ({ ...e, id: uid("e"), source: map.get(e.source), target: map.get(e.target), type: e.type && tm.has(e.type) ? e.type : null }));
    return { nodes, edges: es, ids: nodes.map((n) => n.id) };
  }
  function duplicate() {
    const ms = selModels();
    if (!ms.length) return;
    const c = cloneSet(ms, sheet.edges, 28, 28, false);
    mutate(() => { sheet.nodes.push(...c.nodes); sheet.edges.push(...c.edges); }, c.ids);
  }
  function copySel() {
    const ms = selModels();
    if (!ms.length) return false;
    const ids = new Set(ms.map((m) => m.id));
    clip = { nodes: ms.map(cloneN), edges: sheet.edges.filter((e) => ids.has(e.source) && ids.has(e.target)).map((e) => ({ ...e })) };
    pasteN = 0;
    return true;
  }
  function pasteClip() {
    if (!clip || !sheet) return;
    pasteN++;
    const c = cloneSet(clip.nodes, clip.edges, 28 * pasteN, 28 * pasteN, true);
    mutate(() => { sheet.nodes.push(...c.nodes); sheet.edges.push(...c.edges); }, c.ids);
  }
  function selectAll() {
    if (!api) return;
    api.setNodes((ns) => ns.map((n) => (n.selected ? n : { ...n, selected: true })));
  }
  function nudge(dx, dy) {
    const ms = selModels();
    if (!ms.length) { if (api) { const v = api.rf.getViewport(); api.rf.setViewport({ x: v.x - dx * 6, y: v.y - dy * 6, zoom: v.zoom }); } return; }
    const s = snap();
    ms.forEach((m) => { m.x += dx; m.y += dy; });
    if (Date.now() - lastNudge > 700) pushUndo(s);
    lastNudge = Date.now();
    changed(null);
  }
  function resizeEnd(id, p) {
    const m = findNode(id), s = rzSnap;
    rzSnap = null;
    if (!m || !s) return;
    m.x = Math.round(p.x); m.y = Math.round(p.y); m.w = Math.round(p.width);
    if (m.t === "note") m.h = Math.round(p.height);
    pushUndo(s); save(); updateChrome();
  }
  // selesai mengedit (nama tokoh / teks catatan); keepOpen = simpan saja (flush autosave)
  function commitEdit(id, value, keepOpen, cancel) {
    if (!sheet) return;
    if (!keepOpen && api) api.setEditing((cur) => (cur === id ? null : cur));
    if (cancel) return;
    if (id.indexOf("name:") === 0) {
      const m = findNode(id.slice(5));
      if (!m) return;
      const v = String(value || "").replace(/\s+/g, " ").trim().slice(0, 80);
      const c = m.charId ? charMap().get(m.charId) : null;
      if (c) {   // tertaut: nama kartu Organize ikut berubah (bukan bagian urungkan)
        if (!v || charName(c) === v) return;
        c.title = v; m.name = v;
        orgChanged(); rev++; renderFlow(); save(); updateChrome();
        return;
      }
      if ((m.name || "") === v) return;
      mutate(() => { m.name = v; });
      return;
    }
    const n = findNode(id);
    if (!n) return;
    const v = String(value || "").slice(0, 5000);
    if (n.t === "text" && !v.trim() && !keepOpen) { mutate(() => { sheet.nodes = sheet.nodes.filter((m) => m.id !== id); }, []); return; }
    if ((n.text || "") === v) return;
    mutate(() => { n.text = v; });
  }
  function placeAt(kind, a, b, dragged) {
    let n;
    if (kind === "person") n = { id: uid("n"), t: "person", x: Math.round(a.x - CARD_W / 2), y: Math.round(a.y - CARD_H / 2), name: "", tags: [] };
    else if (kind === "note") {
      const w = dragged ? Math.max(90, Math.abs(b.x - a.x)) : 200, hh = dragged ? Math.max(70, Math.abs(b.y - a.y)) : 180;
      n = { id: uid("n"), t: "note", x: Math.round(dragged ? Math.min(a.x, b.x) : a.x - w / 2), y: Math.round(dragged ? Math.min(a.y, b.y) : a.y - hh / 2), w: Math.round(w), h: Math.round(hh), color: noteColor, text: "" };
    } else n = { id: uid("n"), t: "text", x: Math.round(a.x - 120), y: Math.round(a.y - 18), w: 240, text: "", size: "m" };
    mutate(() => { sheet.nodes.push(n); }, [n.id]);
    setTool("select");
    if (api) setTimeout(() => api && api.setEditing(kind === "person" ? "name:" + n.id : n.id), 30);
  }
  function addPersonCenter() {
    if (!sheet) return;
    const c = viewCenter(), p = freeSpot(Math.round(c.x - CARD_W / 2), Math.round(c.y - CARD_H / 2), 32, 32);
    const n = { id: uid("n"), t: "person", x: p.x, y: p.y, name: "", tags: [] };
    mutate(() => { sheet.nodes.push(n); }, [n.id]);
  }
  // ---------- kartu Organize ----------
  function makeCard(id) {
    const m = findNode(id);
    if (!m || m.t !== "person") return;
    const o = ctx.project.data.organize || (ctx.project.data.organize = { characters: [], locations: [], notes: [] });
    if (!Array.isArray(o.characters)) o.characters = [];
    let cid = "characters-" + Date.now();
    while (o.characters.some((c) => c && c.id === cid)) cid = "characters-" + (Date.now() + Math.floor(Math.random() * 1e6));
    const name = (m.name || "").trim();
    const c = { id: cid, title: name || "Tokoh baru", content: "" };
    o.characters.push(c);
    orgChanged();
    mutate(() => { m.charId = c.id; m.name = c.title; }, [m.id]);
    toast(`Kartu "${c.title}" dibuat di Organize › Karakter.`);
    if (!name && api) setTimeout(() => api && api.setEditing("name:" + m.id), 30);
  }
  function linkCard(id, charId) {
    const m = findNode(id), c = charMap().get(charId);
    if (!m || !c) return;
    if (m.charId === charId) return;
    mutate(() => { m.charId = c.id; m.name = charName(c); }, [m.id]);
  }
  function unlinkCard(id) {
    const m = findNode(id);
    if (!m || !m.charId) return;
    const c = charMap().get(m.charId);
    mutate(() => { if (c) m.name = charName(c); delete m.charId; }, [m.id]);
  }
  // ---------- foto: unggah / seret -> diperkecil (<= 400px) -> WebP 0.8 (cadangan JPEG) ----------
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
          const g = cv.getContext("2d");
          g.drawImage(img, 0, 0, w, hh);
          let out = cv.toDataURL("image/webp", 0.8);
          if (!/^data:image\/webp/.test(out)) {
            const cj = document.createElement("canvas"), gj = cj.getContext("2d");
            cj.width = w; cj.height = hh;
            gj.fillStyle = "#ffffff"; gj.fillRect(0, 0, w, hh); gj.drawImage(cv, 0, 0);
            out = cj.toDataURL("image/jpeg", 0.82);
          }
          if (out.length > MAX_PHOTO) { reject(new Error("Gambar terlalu besar.")); return; }
          resolve(out);
        } catch (e) { reject(e); } finally { URL.revokeObjectURL(url); }
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Gambar tidak bisa dibaca.")); };
      img.src = url;
    });
  }
  function pickPhoto(id) { if (!dom) return; closeMenu(); photoTarget = id; dom.file.click(); }
  function setPhoto(id, file, at) {
    const sh = sheet;
    readImage(file, PHOTO_PX).then((src) => {
      if (sheet !== sh) return;   // pengguna sudah pindah lembar / jejaring
      const m = id ? findNode(id) : null;
      if (m && m.t === "person") { mutate(() => { m.photo = src; }, [m.id]); return; }
      if (id) return;
      const p = freeSpot(Math.round((at || viewCenter()).x - CARD_W / 2), Math.round((at || viewCenter()).y - CARD_H / 2), 28, 28);
      const n = { id: uid("n"), t: "person", x: p.x, y: p.y, name: "", tags: [], photo: src };
      mutate(() => { sheet.nodes.push(n); }, [n.id]);
    }).catch((err) => toast((err && err.message) || "Gambar gagal dibaca."));
  }
  // ---------- label ----------
  function nextTagColor() { const ks = Object.keys(COLORS); return ks[doc.tags.length % ks.length]; }
  function toggleTag(tagId) {
    const ps = selModels().filter((m) => m.t === "person");
    if (!ps.length || !doc.tags.some((t) => t.id === tagId)) return;
    const all = ps.every((m) => (m.tags || []).includes(tagId));
    mutate(() => { ps.forEach((m) => { m.tags = (m.tags || []).filter((t) => t !== tagId); if (!all) m.tags.push(tagId); }); });
  }
  function addTag(name, assign) {
    const v = String(name || "").trim().slice(0, 30);
    if (!v) return null;
    if (doc.tags.length >= 30) { toast("Maksimal 30 label per jejaring."); return null; }
    const t = { id: uid("g"), name: v, color: nextTagColor() };
    const ps = assign ? selModels().filter((m) => m.t === "person") : [];
    mutate(() => { doc.tags.push(t); ps.forEach((m) => { m.tags = (m.tags || []).concat(t.id); }); });
    return t;
  }
  function deleteTag(tagId) {
    const t = doc.tags.find((x) => x.id === tagId);
    if (!t) return;
    if (focusTag === tagId) focusTag = null;
    mutate(() => {
      doc.tags = doc.tags.filter((x) => x.id !== tagId);
      doc.sheets.forEach((s) => s.nodes.forEach((n) => { if (n.tags) n.tags = n.tags.filter((x) => x !== tagId); }));
    });
  }
  function setFocusTag(tagId) { focusTag = focusTag === tagId ? null : tagId; rev++; renderFlow(); updateChrome(); }

  // ---------- Rapikan: tata letak otomatis per generasi (beranimasi bila gerak tidak dikurangi) ----------
  function tidy() {
    if (!sheet) return;
    const ps = sheet.nodes.filter((n) => n.t === "person");
    if (ps.length < 2) { toast("Tambahkan beberapa tokoh dulu."); return; }
    const pos = layoutTree(ps, relsOf(sheet.edges, typeMap()));
    const x0 = Math.min(...ps.map((n) => n.x)), y0 = Math.min(...ps.map((n) => n.y));
    const s = snap(), from = new Map();
    let moved = false;
    ps.forEach((n) => {
      const p = pos.get(n.id);
      if (!p) return;
      const x = Math.round(x0 + p.x), y = Math.round(y0 + p.y);
      from.set(n.id, { x: n.x, y: n.y });
      if (n.x !== x || n.y !== y) { n.x = x; n.y = y; moved = true; }
    });
    if (!moved) { toast("Jejaring sudah rapi."); return; }
    pushUndo(s);
    toast("Jejaring dirapikan — urungkan dengan " + MOD + "+Z.");
    const fin = () => { changed(null); setTimeout(fit, 40); };
    if (!api || reduceMotion()) { fin(); return; }
    cancelAnimationFrame(animRaf);
    const t0 = performance.now(), D = 360;
    const step = (now) => {
      const k = Math.min(1, (now - t0) / D), e = 1 - Math.pow(1 - k, 3);
      if (!api) return;
      api.setNodes((ns) => ns.map((n) => { const f = from.get(n.id), m = f && findNode(n.id); return m ? { ...n, position: { x: f.x + (m.x - f.x) * e, y: f.y + (m.y - f.y) * e } } : n; }));
      if (k < 1) animRaf = requestAnimationFrame(step); else fin();
    };
    animRaf = requestAnimationFrame(step);
  }

  // ---------- jejaring (dokumen) & lembar ----------
  function switchDoc(id, quiet) {
    const d = data().docs.find((x) => x.id === id);
    if (!d) return;
    flushEdit(false);
    closeMenu();
    if (wiz) { wiz = null; renderWizard(); }   // pilih jejaring lain dari menu saat wizard terbuka
    doc = d;
    data().active = d.id;
    lsSet("novelist_jjdoc_" + projId, d.id);
    const want = lsGet("novelist_jjsheet_" + projId + "_" + d.id);
    sheet = d.sheets.find((s) => s.id === want) || d.sheets.find((s) => s.id === d.activeSheet) || d.sheets[0];
    d.activeSheet = sheet.id;
    focusTag = null; pendingSel = null;
    rev++;
    renderFlow(); updateChrome();
    if (!quiet && ctx.onOpen) ctx.onOpen(d.id, d.title);
  }
  function switchSheet(id, quiet) {
    const s = doc && doc.sheets.find((x) => x.id === id);
    if (!s || s === sheet) return;
    flushEdit(false);
    if (!quiet) closeMenu();
    sheet = s;
    doc.activeSheet = s.id;
    lsSet("novelist_jjsheet_" + projId + "_" + doc.id, s.id);
    pendingSel = null;
    rev++;
    renderFlow(); updateChrome();
  }
  function uniqueName(list, base, key) {
    let name = base, n = 2;
    while (list.some((x) => x[key] === name)) name = base + " " + n++;
    return name;
  }
  function newSheet() {
    if (!doc) return;
    if (doc.sheets.length >= 20) { toast("Maksimal 20 lembar per jejaring."); return; }
    const s = newSheetObj(uniqueName(doc.sheets, "Lembar " + (doc.sheets.length + 1), "name"), true);
    doc.sheets.push(s);
    save();
    switchSheet(s.id);
    pendingSel = [s.nodes[0].id]; rev++; renderFlow();
  }
  function dupSheet() {
    if (!doc || !sheet) return;
    if (doc.sheets.length >= 20) { toast("Maksimal 20 lembar per jejaring."); return; }
    const s = { id: uid("s"), name: uniqueName(doc.sheets, sheet.name + " (salinan)", "name").slice(0, 40), nodes: sheet.nodes.map(cloneN), edges: sheet.edges.map((e) => ({ ...e })), viewport: sheet.viewport };
    doc.sheets.splice(doc.sheets.indexOf(sheet) + 1, 0, s);
    save();
    switchSheet(s.id);
    toast("Lembar diduplikat.");
  }
  function deleteSheet() {
    if (!doc || !sheet) return;
    if (doc.sheets.length < 2) { toast("Jejaring perlu minimal satu lembar."); return; }
    if (!confirm(`Hapus lembar "${sheet.name}"? Semua kartu di lembar ini ikut terhapus.`)) return;
    const i = doc.sheets.indexOf(sheet), id = sheet.id;
    doc.sheets.splice(i, 1);
    try { localStorage.removeItem(vpKey(doc, { id })); } catch (e) { /* abaikan */ }
    const next = doc.sheets[Math.min(i, doc.sheets.length - 1)];
    sheet = null;
    save();
    switchSheet(next.id);
    toast("Lembar dihapus.");
  }
  function startSheetRename(id) {
    if (!dom || !doc) return;
    closeMenu();
    const s = doc.sheets.find((x) => x.id === id);
    const b = dom.sheets.querySelector(`[data-sheet="${CSS.escape(id)}"]`);
    if (!s || !b) return;
    const inp = document.createElement("input");
    inp.className = "jj-sheet-input";
    inp.maxLength = 40; inp.value = s.name; inp.setAttribute("aria-label", "Nama lembar"); inp.spellcheck = false;
    b.replaceWith(inp);
    inp.focus(); inp.select();
    let done = false;
    const fin = (ok) => {
      if (done) return;
      done = true;
      const v = inp.value.trim().slice(0, 40);
      if (ok && v && v !== s.name) { s.name = v; save(); }
      const refocus = document.activeElement === inp;
      inp.remove();   // tanpa ini updateChrome mengira masih mengganti nama dan tidak membangun ulang bar lembar
      updateChrome();
      if (refocus) { const nb = dom.sheets.querySelector(`[data-sheet="${CSS.escape(id)}"]`); if (nb) nb.focus({ preventScroll: true }); }
    };
    inp.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") { e.preventDefault(); fin(true); } else if (e.key === "Escape") { e.preventDefault(); fin(false); } });
    inp.addEventListener("blur", () => fin(true));
  }
  function deleteDoc() {
    if (!doc) return;
    if (!confirm(`Hapus jejaring "${doc.title}"? Semua lembar & kartunya ikut terhapus (kartu di Organize tetap ada).`)) return;
    const j = data(), id = doc.id;
    j.docs = j.docs.filter((d) => d.id !== id);
    hist.delete(projId + "|" + id);
    doc = null; sheet = null;
    save();
    if (j.docs.length) switchDoc(j.docs[0].id);
    else { j.active = null; renderFlow(); openWizard("new"); }
    toast("Jejaring dihapus.");
  }
  function startDocRename() {
    if (!dom || !doc) return;
    closeMenu();
    dom.docInput.value = doc.title;
    dom.docBtn.classList.add("hidden");
    dom.docInput.classList.remove("hidden");
    dom.docInput.focus(); dom.docInput.select();
  }
  function endDocRename(commit) {
    if (!dom || dom.docInput.classList.contains("hidden")) return;
    const v = dom.docInput.value.trim().slice(0, 80);
    dom.docInput.classList.add("hidden");
    dom.docBtn.classList.remove("hidden");
    if (commit && v && doc && v !== doc.title) { doc.title = v; save(); if (ctx.onOpen) ctx.onOpen(doc.id, doc.title); }
    updateChrome();
  }
  function clearSheet() {
    if (!sheet || !sheet.nodes.length) { toast("Lembar ini sudah kosong."); return; }
    if (!confirm(`Bersihkan lembar "${sheet.name}"? Semua kartu & relasinya dihapus. Bisa diurungkan dengan ${MOD}+Z.`)) return;
    mutate(() => { sheet.nodes = []; sheet.edges = []; }, []);
  }

  // ---------- tampilan ----------
  function fit() {
    zoomGoal = 0;
    if (!api) return;
    if (!api.rf.getNodes().length) { const r = dom.flow.getBoundingClientRect(); api.rf.setViewport({ x: r.width / 2, y: r.height / 2, zoom: 1 }, { duration: dur(250) }); return; }
    api.rf.fitView({ padding: 0.25, maxZoom: 1.1, duration: dur(320) });
  }
  let zoomGoal = 0, zoomGoalT = 0;
  function zoomBy(inOut) {
    if (!api) return;
    const now = performance.now(), base = zoomGoal && now - zoomGoalT < 600 ? zoomGoal : api.rf.getZoom();
    zoomGoal = clamp(base * (inOut > 0 ? 1.2 : 1 / 1.2), MIN_Z, MAX_Z); zoomGoalT = now;
    const st = api.store.getState(), ms = dur(180);
    if (!ms && st.d3Zoom && st.d3Selection) st.d3Zoom.scaleTo(st.d3Selection, zoomGoal);
    else api.rf.zoomTo(zoomGoal, { duration: ms });
  }
  function zoom100() { zoomGoal = 0; if (api) api.rf.zoomTo(1, { duration: dur(220) }); }
  function setTool(t) {
    if (!PLACE.concat(["select", "hand"]).includes(t)) return;
    if (t !== tool) { tool = t; renderFlow(); }
    updateChrome();
  }
  function setMax(on) { maxed = !!on; lsSet("novelist_jj_max", maxed); updateChrome(); }
  function setMini(on) { mini = !!on; lsSet("novelist_jj_minimap", mini); renderFlow(); updateChrome(); }

  // jalankan aksi dari menu / bilah / tombol
  function runAct(act, arg, el) {
    const one = () => { const ms = selModels(); return ms.length === 1 ? ms[0] : null; };
    switch (act) {
      case "doc": switchDoc(arg); break;
      case "newdoc": openWizard("new"); return;
      case "rename": startDocRename(); return;
      case "deldoc": deleteDoc(); break;
      case "types": openWizard("edit"); return;
      case "tidy": tidy(); break;
      case "fit": fit(); break;
      case "zoom100": zoom100(); break;
      case "zoomin": zoomBy(1); break;
      case "zoomout": zoomBy(-1); break;
      case "undo": undo(); break;
      case "redo": redo(); break;
      case "minimap": setMini(!mini); break;
      case "max": setMax(!maxed); break;
      case "theme": if (ctx.toggleTheme) ctx.toggleTheme(); break;
      case "help": openMenu("help", dom.more); return;
      case "labels": openMenu("labels", el || dom.tools.querySelector('[data-act="labels"]')); return;
      case "clear": clearSheet(); break;
      case "close": if (ctx.closeTab) ctx.closeTab(); break;
      case "newsheet": newSheet(); break;
      case "sheetrename": startSheetRename(arg || (sheet && sheet.id)); return;
      case "sheetdup": dupSheet(); break;
      case "sheetdel": deleteSheet(); break;
      case "addperson": addPersonCenter(); break;
      case "makecard": { const m = one(); if (m) makeCard(m.id); break; }
      case "opencard": { const m = one(); if (m && m.charId && ctx.openCharacter) { const cid = m.charId; closeMenu(); setTimeout(() => ctx && ctx.openCharacter(cid), 0); } return; }
      case "linkcard": { const m = one(); if (m) { relCtx = { mode: "link", nodeId: m.id, view: "chars" }; openMenu("rel", el); } return; }
      case "unlink": { const m = one(); if (m) unlinkCard(m.id); break; }
      case "photo": { const m = one(); if (!m) break; if (m.photo) { openMenu("photo", el); return; } pickPhoto(m.id); return; }
      case "photonew": { const m = one(); if (m) pickPhoto(m.id); return; }
      case "photodel": { const m = one(); if (m && m.photo) mutate(() => { delete m.photo; }); break; }
      case "emoji": openMenu("emoji", el); return;
      case "setemoji": { const m = one(); if (m && m.t === "person") mutate(() => { if (arg && EMOJI.includes(arg)) m.emoji = arg; else delete m.emoji; }); break; }
      case "tagsel": openMenu("tagsel", el); return;
      case "tagtoggle": toggleTag(arg); if (menu) openMenu(menu.kind, menu.anchor, menu.at); return;
      case "tagfocus": setFocusTag(arg); if (menu) openMenu(menu.kind, menu.anchor, menu.at); return;
      case "tagcolor": { const t = doc.tags.find((x) => x.id === arg); if (t) { const ks = Object.keys(COLORS); mutate(() => { t.color = ks[(ks.indexOf(t.color) + 1) % ks.length]; }); } if (menu) openMenu(menu.kind, menu.anchor, menu.at); return; }
      case "tagdel": deleteTag(arg); if (menu) openMenu(menu.kind, menu.anchor, menu.at); return;
      case "notecolor": { const m = one(); if (m && m.t === "note" && NOTE_COLORS[arg]) { mutate(() => { m.color = arg; }); noteColor = arg; } break; }
      case "tsize": { const m = one(); if (m && m.t === "text" && TEXT_SIZES[arg]) mutate(() => { m.size = arg; }); break; }
      case "edit": { const m = one(); if (m && api) api.setEditing(m.t === "person" ? "name:" + m.id : m.id); break; }
      case "dup": duplicate(); break;
      case "copy": copySel(); toast("Disalin — tempel dengan " + MOD + "+V."); break;
      case "paste": pasteClip(); break;
      case "del": deleteSel(); break;
      case "selall": selectAll(); break;
      case "addhere": { const at = ctxPos || viewCenter(); placeAt(arg, at, at, false); break; }
      case "focusoff": setFocusTag(null); break;
    }
    closeMenu();
  }

  // ================= POPOVER RELASI ("+" pada kartu, seret ke kartu lain, klik garis) =================
  function openRel(nodeId, side, anchor) {
    relCtx = { mode: "new", nodeId, side, view: "grid", char: null };
    openMenu("rel", anchor);
  }
  function edgeMenu(edgeId, anchor, at) {
    const e = sheet && sheet.edges.find((x) => x.id === edgeId);
    if (!e) return;
    selectOnly([], [edgeId]);
    relCtx = { mode: "edge", edgeId, view: "grid" };
    openMenu("rel", anchor, at);
  }
  function relPick(typeId, newType) {
    const r = relCtx;
    if (!r) return;
    closeMenu();
    if (r.mode === "new") addRelated(r.nodeId, r.side, typeId, r.at, r.char, newType);
    else if (r.mode === "connect") connectPair(r.nodeId, r.target, typeId, newType ? newType.dir : null, newType);
    else if (r.mode === "edge") setEdgeType(r.edgeId, typeId, newType);
    relCtx = null;
  }
  function relHtml() {
    const r = relCtx;
    if (!r) return "";
    if (r.view === "chars") {
      const cm = chars();
      const back = r.mode === "link" ? "" : `<button type="button" class="jj-pop-back" data-act="relgrid" aria-label="Kembali">${icS("#ti-arrow-left", 15)}</button>`;
      const m = findNode(r.nodeId);
      return `<div class="jj-pop-head">${back}<span>${r.mode === "link" ? "Tautkan kartu" : "Tautkan tokoh yang ada"}</span></div>` +
        (cm.length ? `<label class="jj-search">${icS("#ti-search", 14)}<input type="search" class="jj-char-q" placeholder="Cari tokoh di Organize…" aria-label="Cari tokoh" autocomplete="off" spellcheck="false"></label>` : "") +
        `<div class="jj-mi-scroll jj-char-list">${charRowsHtml("")}</div>` +
        (r.mode === "link" && m && m.charId ? '<div class="jj-mi-sep" role="separator"></div>' + item({ act: "unlink", label: "Lepas tautan", ic: icS("#ti-unlink", 15) }) : "");
    }
    if (r.view === "custom") {
      const d = r.mode === "new" ? sideDir(r.side) : "side";
      return `<div class="jj-pop-head"><button type="button" class="jj-pop-back" data-act="relgrid" aria-label="Kembali">${icS("#ti-arrow-left", 15)}</button><span>Relasi kustom</span></div>` +
        `<form class="jj-custom"><input class="jj-custom-in" maxlength="40" placeholder="Nama relasi, mis. Guru" aria-label="Nama relasi baru" autocomplete="off" spellcheck="false" required>` +
        `<button type="submit" class="jj-btn-sm">Buat</button></form>` +
        `<p class="jj-pop-note">Ditambahkan ke jenis relasi jejaring ini · kartu baru ditaruh ${DIR_NAMES[d]}.</p>`;
    }
    const want = r.mode === "new" ? sideDir(r.side) : null;
    const types = doc.types.slice().sort((a, b) => (b.dir === want) - (a.dir === want));
    let cur = null, sub = "";
    if (r.mode === "edge") {
      const e = sheet.edges.find((x) => x.id === r.edgeId), tm = typeMap();
      if (e) {
        cur = e.type && tm.has(e.type) ? e.type : null;
        const a = findNode(e.source), b = findNode(e.target), cm = charMap();
        sub = `${esc(personName(b, cm) || "Tanpa nama")} adalah <b>${cur ? esc(tm.get(cur).label) : "…"}</b> dari ${esc(personName(a, cm) || "tanpa nama")}`;
      }
    }
    let chip = "";
    if (r.mode === "new" && r.char) { const c = charMap().get(r.char); if (c) chip = `<div class="jj-relchip">${icS("#ti-id", 13)}<span>${esc(charName(c))}</span><button type="button" data-act="relcharoff" aria-label="Batal tautkan tokoh">${icS("#ti-x", 12)}</button></div>`; }
    const grid = types.length ? `<div class="jj-relgrid">${types.map((t) => `<button type="button" class="jj-rel${t.id === cur ? " is-on" : ""}${want && t.dir === want ? " is-fit" : ""}" data-act="relpick" data-arg="${esc(t.id)}"${t.color ? ` style="--c:${COLORS[t.color]}"` : ""}${t.id === cur ? ' aria-current="true"' : ""}>` +
      `${icS(typeIc(t), 15)}<span>${esc(t.label)}</span></button>`).join("")}</div>`
      : '<p class="jj-mi-empty">Belum ada jenis relasi — buat yang pertama.</p>';
    const rows = [{ act: "relcustom", label: "Buat kustom", ic: icS("#ti-plus", 15) }];
    if (r.mode === "new") rows.push({ sep: 1 }, { act: "relchars", label: "Tautkan tokoh yang ada…", ic: icS("#ti-link", 15) }, { act: "relskip", label: "Lewati dulu", ic: icS("#ti-player-skip-forward", 15), sub: "Kartu baru tanpa label relasi" });
    if (r.mode === "connect") rows.push({ sep: 1 }, { act: "relnone", label: "Tanpa label", ic: icS("#ti-line-dashed", 15) });
    if (r.mode === "edge") rows.push({ act: "relnone", label: "Tanpa label", ic: icS("#ti-line-dashed", 15), check: cur === null }, { act: "eflip", label: "Balik arah relasi", ic: icS("#ti-arrows-horizontal", 15) }, { sep: 1 }, { act: "edel", label: "Hapus relasi", ic: icS("#ti-trash", 15), danger: true });
    return `<div class="jj-pop-head is-cap"><span>${r.mode === "edge" ? "Ubah relasi" : "Relasi"}</span></div>` + (sub ? `<p class="jj-pop-sub">${sub}</p>` : "") + chip + grid + rows.map(item).join("");
  }
  function charRowsHtml(q) {
    const r = relCtx, list = chars(), on = new Set(sheet.nodes.filter((n) => n.charId).map((n) => n.charId));
    const qq = q.trim().toLowerCase(), m = r && findNode(r.nodeId);
    const rows = list.filter((c) => !qq || charName(c).toLowerCase().includes(qq));
    if (!list.length) return '<p class="jj-mi-empty">Belum ada tokoh di Organize › Karakter. Pakai "Buat kartu" untuk membuatnya dari kartu ini.</p>';
    if (!rows.length) return '<p class="jj-mi-empty">Tidak ada tokoh yang cocok.</p>';
    return rows.map((c) => item({ act: "relchar", arg: c.id, label: charName(c), ic: icS("#ti-user", 15), sub: on.has(c.id) ? "Sudah ada di lembar ini" : "", check: !!(m && m.charId === c.id) })).join("");
  }
  function onRelAct(act, arg) {
    const r = relCtx;
    if (!r) return false;
    switch (act) {
      case "relpick": relPick(arg); return true;
      case "relnone": relPick(null); return true;
      case "relskip": relPick(null); return true;
      case "relgrid": r.view = "grid"; openMenu("rel", menu && menu.anchor, menu && menu.at); return true;
      case "relchars": r.view = "chars"; openMenu("rel", menu && menu.anchor, menu && menu.at); return true;
      case "relcustom": r.view = "custom"; openMenu("rel", menu && menu.anchor, menu && menu.at); return true;
      case "relcharoff": r.char = null; openMenu("rel", menu && menu.anchor, menu && menu.at); return true;
      case "relchar":
        if (r.mode === "link") { closeMenu(); linkCard(r.nodeId, arg); relCtx = null; return true; }
        r.char = arg; r.view = "grid"; openMenu("rel", menu && menu.anchor, menu && menu.at); return true;
      case "eflip": {
        const e = sheet.edges.find((x) => x.id === r.edgeId);
        closeMenu(); relCtx = null;
        if (e) mutate(() => { const s = e.source; e.source = e.target; e.target = s; if (!e.type) e.dir = e.dir === "up" ? "down" : e.dir === "down" ? "up" : e.dir; });
        return true;
      }
      case "edel": { const id = r.edgeId; closeMenu(); relCtx = null; mutate(() => { sheet.edges = sheet.edges.filter((e) => e.id !== id); }, []); return true; }
    }
    return false;
  }
  function submitCustom(name) {
    const r = relCtx, v = String(name || "").trim().slice(0, 40);
    if (!r || !v) return;
    if (doc.types.length >= 40) { toast("Maksimal 40 jenis relasi."); return; }
    const exist = doc.types.find((t) => t.label.toLowerCase() === v.toLowerCase());
    if (exist) { relPick(exist.id); return; }
    const d = r.mode === "new" ? sideDir(r.side) : "side";
    const t = { id: uid("t"), label: v, icon: d === "up" ? "user-up" : d === "down" ? "user-down" : "link", dashed: false, color: "", dir: d };
    relPick(t.id, t);
  }

  // ================= WIZARD "Jejaring baru" (langkah 1: templat, langkah 2: jenis relasi) + pratinjau =================
  function openWizard(mode) {
    closeMenu();
    flushEdit(false);
    if (mode === "edit") {
      if (!doc) return;
      wiz = { step: 2, mode: "edit", tpl: doc.template, types: doc.types.map((t) => ({ ...t })), cancel: true };
    } else wiz = { step: 1, mode: "new", tpl: "keluarga", types: null, cancel: !!(data() && data().docs.length) };
    renderWizard(true);
  }
  function closeWizard() {
    if (!wiz || !wiz.cancel) return;
    wiz = null;
    renderWizard();
  }
  function tplTypes(id) { return TPL[id].types.map((t) => ({ id: t.id, label: t.label, icon: t.icon, dashed: !!t.dashed, color: "", dir: t.dir })); }
  function renderWizard(focus) {
    if (!dom) return;
    const w = dom.wiz;
    if (!wiz) {
      w.classList.add("hidden");
      w.innerHTML = "";
      if (pvRoot) { try { pvRoot.unmount(); } catch (e) { /* abaikan */ } pvRoot = null; pvApi = null; }
      dom.panel.classList.remove("is-wiz");
      updateChrome();
      return;
    }
    dom.panel.classList.add("is-wiz");
    if (w.classList.contains("hidden") || !w.querySelector(".jj-pv")) {
      w.classList.remove("hidden");
      w.innerHTML = `<div class="jj-wiz-dlg" role="dialog" aria-modal="true" aria-labelledby="jjWizT" aria-describedby="jjWizS">
        <div class="jj-wiz-left"></div>
        <div class="jj-wiz-right"><div class="jj-pv" aria-label="Pratinjau jejaring" role="img"></div>
          <div class="jj-pv-zoom" role="group" aria-label="Zoom pratinjau">
            <button type="button" class="jj-sbtn" data-w="pvin" aria-label="Perbesar pratinjau">${icS("#ti-zoom-in", 16)}</button>
            <button type="button" class="jj-sbtn" data-w="pvout" aria-label="Perkecil pratinjau">${icS("#ti-zoom-out", 16)}</button>
            <button type="button" class="jj-sbtn" data-w="pvfit" aria-label="Pas ke layar">${icS("#ti-focus-centered", 16)}</button>
          </div></div></div>`;
      pvRoot = ReactDOM.createRoot(w.querySelector(".jj-pv"));
    }
    renderWizLeft();
    renderPreview();
    updateChrome();
    if (focus) {
      const f = w.querySelector(wiz.step === 1 ? '.jj-tpl[aria-checked="true"]' : ".jj-trow-name") || w.querySelector("button");
      if (f) setTimeout(() => f.focus({ preventScroll: true }), 20);
    }
  }
  function renderWizLeft() {
    const left = dom.wiz.querySelector(".jj-wiz-left"), t = TPL[wiz.tpl], s1 = wiz.step === 1, edit = wiz.mode === "edit";
    const headIc = s1 ? `<span class="jj-wiz-ic">${icS("#ti-affiliate", 22)}</span>`
      : edit ? `<span class="jj-wiz-ic">${icS("#ti-adjustments-horizontal", 22)}</span>`
        : `<button type="button" class="jj-wiz-back" data-w="back" aria-label="Kembali ke pilihan templat" data-tip="Kembali">${icS("#ti-arrow-left", 18)}</button>`;
    const body = s1
      ? `<div class="jj-tpls" role="radiogroup" aria-label="Jenis jejaring">${TEMPLATES.map((x) => `<button type="button" class="jj-tpl" role="radio" data-w="tpl" data-arg="${x.id}" aria-checked="${x.id === wiz.tpl}" tabindex="${x.id === wiz.tpl ? 0 : -1}">` +
        `<span class="jj-tpl-ic"${x.color ? ` style="--c:${x.color}"` : ""}>${icS(x.icon, 18)}</span><span class="jj-tpl-text"><b>${esc(x.name)}</b><small>${esc(x.desc || x.types.slice(0, 4).map((y) => y.label).join(" · "))}</small></span></button>`).join("")}</div>`
      : `<div class="jj-types" role="list">${wiz.types.map(typeRowHtml).join("") || '<p class="jj-types-empty">Belum ada jenis relasi. Tambahkan sekarang, atau nanti lewat "Buat kustom" di kartu.</p>'}</div>` +
        `<button type="button" class="jj-wiz-add" data-w="add">${icS("#ti-plus", 15)}<span>Tambah relasi</span></button>`;
    left.innerHTML = `<div class="jj-wiz-head">${headIc}<div class="jj-wiz-titles"><h2 id="jjWizT">${edit ? "Jenis relasi" : "Jejaring Tokoh"}</h2>` +
      `<p id="jjWizS">${s1 ? "Pilih jenis jejaring yang ingin kamu buat" : edit ? esc(doc.title) + " · ubah, tambah atau hapus relasi" : esc(t.sub)}</p></div>` +
      `${wiz.cancel ? `<button type="button" class="jj-wiz-x" data-w="close" aria-label="Tutup" data-tip="Tutup · Esc">${icS("#ti-x", 16)}</button>` : ""}</div>` +
      `<div class="jj-wiz-body" data-lenis-prevent>${body}</div>` +
      `<div class="jj-wiz-foot"><button type="button" class="jj-btn-primary" data-w="${s1 ? "next" : "create"}">${s1 ? "Lanjut" : edit ? "Simpan" : "Buat jejaring"}</button></div>`;
  }
  function typeRowHtml(t, i) {
    const dirIc = t.dir === "up" ? icS("#ti-arrow-up", 15) : t.dir === "down" ? icS("#ti-arrow-down", 15) : icS("#ti-arrows-horizontal", 15);
    return `<div class="jj-trow" role="listitem" data-i="${i}">` +
      `<button type="button" class="jj-trow-ic" data-w="icon" aria-haspopup="menu" aria-label="Ganti ikon ${esc(t.label)}" data-tip="Ikon"${t.color ? ` style="--c:${COLORS[t.color]}"` : ""}>${icS(typeIc(t), 16)}</button>` +
      `<input class="jj-trow-name" value="${esc(t.label)}" maxlength="40" aria-label="Nama relasi" spellcheck="false" autocomplete="off">` +
      `<button type="button" class="jj-trow-btn" data-w="dir" aria-label="Posisi kartu baru: ${DIR_NAMES[t.dir]}" data-tip="Kartu baru ${DIR_NAMES[t.dir]}">${dirIc}</button>` +
      `<button type="button" class="jj-trow-btn" data-w="dash" aria-pressed="${t.dashed}" aria-label="Garis ${t.dashed ? "putus-putus" : "utuh"}" data-tip="Garis ${t.dashed ? "putus-putus" : "utuh"}">${dashSvg(t.dashed)}</button>` +
      `<button type="button" class="jj-trow-btn jj-trow-col${t.color ? " has-c" : ""}" data-w="color" aria-haspopup="menu" aria-label="Warna garis" data-tip="Warna"${t.color ? ` style="--c:${COLORS[t.color]}"` : ""}><i></i></button>` +
      `<button type="button" class="jj-trow-btn jj-trow-x" data-w="remove" aria-label="Hapus relasi ${esc(t.label)}" data-tip="Hapus">${icS("#ti-x", 15)}</button></div>`;
  }
  function wizAct(act, b) {
    if (!wiz) return;
    const row = b.closest(".jj-trow"), i = row ? +row.dataset.i : -1, t = i >= 0 ? wiz.types[i] : null;
    switch (act) {
      case "close": closeWizard(); return;
      case "tpl": if (TPL[b.dataset.arg]) { wiz.tpl = b.dataset.arg; renderWizLeft(); renderPreview(); const f = dom.wiz.querySelector('.jj-tpl[aria-checked="true"]'); if (f) f.focus({ preventScroll: true }); } return;
      case "next": wiz.step = 2; wiz.types = tplTypes(wiz.tpl); renderWizard(true); return;
      case "back": wiz.step = 1; renderWizard(true); return;
      case "add": {
        if (wiz.types.length >= 40) return;
        wiz.types.push({ id: uid("t"), label: "Relasi baru", icon: "link", dashed: false, color: "", dir: "side" });
        renderWizLeft(); renderPreview();
        const ins = dom.wiz.querySelectorAll(".jj-trow-name"), last = ins[ins.length - 1];
        if (last) { last.focus(); last.select(); }
        return;
      }
      case "remove": if (t) { wiz.types.splice(i, 1); renderWizLeft(); renderPreview(); const r = dom.wiz.querySelectorAll(".jj-trow-x")[Math.min(i, wiz.types.length - 1)]; (r || dom.wiz.querySelector('[data-w="add"]')).focus(); } return;
      case "dash": if (t) { t.dashed = !t.dashed; refreshRow(i, "dash"); } return;
      case "dir": if (t) { t.dir = DIRS[(DIRS.indexOf(t.dir) + 1) % DIRS.length]; refreshRow(i, "dir"); } return;
      case "icon": if (t) openMenu("wicon", b, null, i); return;
      case "color": if (t) openMenu("wcolor", b, null, i); return;
      case "create": finishWizard(); return;
      case "pvin": case "pvout": if (pvApi) pvApi.zoomTo(clamp(pvApi.getZoom() * (act === "pvin" ? 1.25 : 0.8), 0.15, 2), { duration: dur(180) }); return;
      case "pvfit": if (pvApi) pvApi.fitView({ padding: 0.12, duration: dur(250) }); return;
    }
  }
  function refreshRow(i, focusW) {
    const old = dom.wiz.querySelector(`.jj-trow[data-i="${i}"]`);
    if (!old) return;
    const tmp = document.createElement("div");
    tmp.innerHTML = typeRowHtml(wiz.types[i], i);
    old.replaceWith(tmp.firstChild);
    renderPreview();
    if (focusW) { const f = dom.wiz.querySelector(`.jj-trow[data-i="${i}"] [data-w="${focusW}"]`); if (f) f.focus({ preventScroll: true }); }
  }
  function cleanWizTypes() {
    const used = new Set();
    return wiz.types.map((t) => cleanType(t, used)).filter(Boolean);
  }
  function finishWizard() {
    if (!wiz) return;
    const types = cleanWizTypes();
    if (wiz.mode === "edit") {
      const keep = new Set(types.map((t) => t.id));
      let lost = 0;
      doc.sheets.forEach((s) => s.edges.forEach((e) => { if (e.type && !keep.has(e.type)) lost++; }));
      if (lost && !confirm(`${lost} relasi memakai jenis yang dihapus dan akan tampil tanpa label. Lanjutkan? (Bisa diurungkan dengan ${MOD}+Z.)`)) return;
      wiz = null;
      renderWizard();
      mutate(() => { doc.types = types; });
      toast("Jenis relasi disimpan.");
      return;
    }
    const j = data(), base = wiz.tpl === "kosong" ? "Jejaring baru" : "Jejaring " + TPL[wiz.tpl].name;
    const s = newSheetObj("Utama", true);
    const d = { id: uid("j"), title: uniqueName(j.docs, base, "title"), template: wiz.tpl, types, tags: [], sheets: [s], activeSheet: s.id };
    j.docs.push(d);
    wiz = null;
    renderWizard();
    save();
    switchDoc(d.id);
    pendingSel = [s.nodes[0].id]; rev++; renderFlow();
  }
  // ---------- pratinjau (React Flow hanya-baca, contoh per templat) ----------
  const sampleCache = new Map();
  function sampleOf(tplId) {
    if (sampleCache.has(tplId)) return sampleCache.get(tplId);
    const t = TPL[tplId], dirs = new Map(t.types.map((x) => [x.id, x.dir]));
    const nodes = t.sample.people.map((name, i) => ({ id: "p" + i, name, x: i * 10, y: 0 }));
    const edges = t.sample.rel.map((r, i) => ({ id: "r" + i, source: "p" + r[0], target: "p" + r[1], type: r[2], dir: r[3] || dirs.get(r[2]) || "side" }));
    const pos = layoutTree(nodes, edges.map((e) => (e.dir === "down" ? { a: e.source, b: e.target, kind: "down" } : e.dir === "up" ? { a: e.target, b: e.source, kind: "down" } : { a: e.source, b: e.target, kind: "side" })));
    const s = { nodes: nodes.map((n) => ({ id: n.id, type: "pv", position: pos.get(n.id), data: { name: n.name }, draggable: false, selectable: false, width: CARD_W, height: CARD_H, style: { width: CARD_W, height: CARD_H } })), edges };
    sampleCache.set(tplId, s);
    return s;
  }
  function PreviewApp({ tpl, types }) {
    const rf = RF.useReactFlow();
    React.useEffect(() => { pvApi = rf; return () => { if (pvApi === rf) pvApi = null; }; }, [rf]);
    const s = sampleOf(tpl);
    const tm = new Map(types.map((t) => [t.id, t]));
    const edges = s.edges.filter((e) => !e.type || tm.has(e.type)).map((e) => ({ id: e.id, source: e.source, target: e.target, type: "rel", selectable: false, focusable: false, data: { ty: e.type ? tm.get(e.type) : null, pv: true } }));
    return h(Flow, {
      nodes: s.nodes, edges, nodeTypes: NODE_TYPES, edgeTypes: EDGE_TYPES, fitView: true, fitViewOptions: { padding: 0.12 },
      minZoom: 0.15, maxZoom: 2, nodesDraggable: false, nodesConnectable: false, elementsSelectable: false, panOnDrag: true,
      panOnScroll: true, zoomOnScroll: false, zoomOnPinch: true, zoomOnDoubleClick: false, preventScrolling: true,
      deleteKeyCode: null, selectionKeyCode: null, multiSelectionKeyCode: null, disableKeyboardA11y: true, nodesFocusable: false, edgesFocusable: false,
      proOptions: { hideAttribution: true }, className: "jj-rf jj-pv-rf",
    }, h(RF.Background, { variant: RF.BackgroundVariant.Dots, gap: 16, size: 1.2, color: "#8a8f99", className: "jj-bg" }));
  }
  function renderPreview() {
    if (!pvRoot || !wiz) return;
    const types = wiz.step === 1 ? tplTypes(wiz.tpl) : wiz.types;
    pvRoot.render(h(RF.ReactFlowProvider, { key: wiz.tpl }, h(PreviewApp, { key: wiz.tpl, tpl: wiz.tpl, types: types.map((t) => ({ ...t })) })));
  }

  // ================= PANEL (DOM biasa): kepala, tombol zoom, lembar, bilah alat, menu =================
  function chromeHtml() {
    const tb = (id, label, key, inner) => `<button type="button" class="jj-tool" data-tool="${id}" aria-pressed="false" aria-label="${label} (${key})" data-tip="${label} · ${key}" data-tip-pos="top">${inner}</button>`;
    return `<div class="jj-panel" data-lenis-prevent>
      <div class="jj-flow"></div>
      <header class="jj-head">
        <div class="jj-doc">
          <button type="button" class="jj-doc-btn" aria-haspopup="menu" aria-expanded="false" aria-label="Pilih jejaring">
            <span class="jj-doc-ic">${icS("#ti-affiliate", 15)}</span><span class="jj-doc-title"></span>${icS("#ti-chevron-down", 14)}
          </button>
          <input class="jj-doc-input hidden" maxlength="80" aria-label="Nama jejaring" spellcheck="false" autocomplete="off" />
          <span class="jj-doc-sub"></span>
        </div>
        <div class="jj-head-right">
          <button type="button" class="jj-ibtn" data-act="more" aria-haspopup="menu" aria-expanded="false" aria-label="Menu jejaring" data-tip="Lainnya">${icS("#ti-dots", 17)}</button>
          <button type="button" class="jj-ibtn jj-max-btn" data-act="max" aria-pressed="false" aria-label="Perbesar panel" data-tip="Perbesar panel">${icS("#ti-arrows-maximize", 16)}${icS("#ti-arrows-minimize", 16)}</button>
          <button type="button" class="jj-ibtn" data-act="close" aria-label="Tutup tab Jejaring Tokoh" data-tip="Tutup tab">${icS("#ti-x", 16)}</button>
        </div>
      </header>
      <div class="jj-side" role="group" aria-label="Tampilan kanvas">
        <button type="button" class="jj-sbtn" data-act="zoomin" aria-label="Perbesar" data-tip="Perbesar · +">${icS("#ti-zoom-in", 16)}</button>
        <button type="button" class="jj-sbtn" data-act="zoomout" aria-label="Perkecil" data-tip="Perkecil · −">${icS("#ti-zoom-out", 16)}</button>
        <button type="button" class="jj-sbtn" data-act="fit" aria-label="Pas ke layar" data-tip="Pas ke layar · Shift+1">${icS("#ti-focus-centered", 16)}</button>
      </div>
      <div class="jj-hint" aria-live="polite"></div>
      <div class="jj-empty hidden"></div>
      <div class="jj-bottom">
        <div class="jj-sheets" role="tablist" aria-label="Lembar"></div>
        <div class="jj-tools-wrap">
          <div class="jj-tools" role="toolbar" aria-label="Alat jejaring">
            ${tb("select", "Pilih", "V", icS("#ti-pointer", 18))}
            ${tb("hand", "Geser", "H", icS("#ti-hand-stop", 18))}
            <span class="jj-tsep" aria-hidden="true"></span>
            ${tb("person", "Tambah tokoh", "P", icS("#ti-user-plus", 18))}
            ${tb("note", "Catatan tempel", "N", icS("#ti-note", 18))}
            ${tb("text", "Teks", "T", icS("#ti-letter-t", 18))}
            <span class="jj-tsep" aria-hidden="true"></span>
            <button type="button" class="jj-tool" data-act="labels" aria-haspopup="menu" aria-expanded="false" aria-label="Label (L)" data-tip="Label · L" data-tip-pos="top">${icS("#ti-tag", 18)}</button>
          </div>
        </div>
      </div>
      <div class="jj-wiz hidden"></div>
      <div class="jj-pop hidden"></div>
      <div class="jj-toast" role="status" aria-live="polite"></div>
      <input type="file" class="jj-file" accept="image/*" hidden />
    </div>`;
  }
  function mountChrome() {
    host = document.getElementById("jejaringCanvas");
    if (dom && host.contains(dom.panel)) return;
    host.innerHTML = chromeHtml();
    const q = (s) => host.querySelector(s);
    dom = {
      panel: q(".jj-panel"), flow: q(".jj-flow"), docBtn: q(".jj-doc-btn"), docTitle: q(".jj-doc-title"), docInput: q(".jj-doc-input"), docSub: q(".jj-doc-sub"),
      more: q('[data-act="more"]'), maxBtn: q(".jj-max-btn"), hint: q(".jj-hint"), empty: q(".jj-empty"), sheets: q(".jj-sheets"), tools: q(".jj-tools"),
      wiz: q(".jj-wiz"), pop: q(".jj-pop"), toast: q(".jj-toast"), file: q(".jj-file"),
    };
    if (root) { try { root.unmount(); } catch (e) { /* abaikan */ } root = null; api = null; }
    pvRoot = null; pvApi = null;
    dom.panel.addEventListener("click", onPanelClick);
    dom.panel.addEventListener("contextmenu", (e) => {
      const b = e.target.closest("[data-sheet]");
      if (!b) return;
      e.preventDefault();
      switchSheet(b.dataset.sheet);
      const nb = dom.sheets.querySelector(`[data-sheet="${CSS.escape(b.dataset.sheet)}"]`);
      openMenu("sheet", nb || b);
    });
    dom.panel.addEventListener("dblclick", (e) => { const b = e.target.closest("[data-sheet]"); if (b) startSheetRename(b.dataset.sheet); });
    dom.file.addEventListener("change", () => { const f = dom.file.files && dom.file.files[0]; if (f && photoTarget) setPhoto(photoTarget, f); photoTarget = null; dom.file.value = ""; });
    dom.docInput.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") { e.preventDefault(); endDocRename(true); dom.docBtn.focus(); }
      else if (e.key === "Escape") { e.preventDefault(); endDocRename(false); dom.docBtn.focus(); }
    });
    dom.docInput.addEventListener("blur", () => endDocRename(true));
    // wizard: ketik nama relasi -> pratinjau ikut berubah
    dom.wiz.addEventListener("input", (e) => {
      const inp = e.target.closest(".jj-trow-name");
      if (!inp || !wiz || !wiz.types) return;
      const t = wiz.types[+inp.closest(".jj-trow").dataset.i];
      if (t) { t.label = inp.value; renderPreview(); }
    });
    dom.wiz.addEventListener("keydown", onWizKey);
    // wadah React Flow tidak boleh ikut tergulir (fokus/scrollIntoView ke kartu di luar layar menggeser isi = koordinat kacau)
    dom.flow.addEventListener("scroll", (e) => {
      const t = e.target;
      if (t && t.nodeType === 1 && (t === dom.flow || t.matches(".react-flow, .react-flow__renderer, .react-flow__zoompane, .react-flow__pane")) && (t.scrollTop || t.scrollLeft)) { t.scrollTop = 0; t.scrollLeft = 0; }
    }, true);
    // seret foto dari komputer: ke kartu = foto kartu itu, ke latar = kartu baru berfoto
    const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files");
    dom.flow.addEventListener("dragover", (e) => { if (!hasFiles(e) || !sheet) return; e.preventDefault(); e.dataTransfer.dropEffect = "copy"; dom.panel.classList.add("is-drop"); });
    dom.flow.addEventListener("dragleave", (e) => { if (!dom.flow.contains(e.relatedTarget)) dom.panel.classList.remove("is-drop"); });
    dom.flow.addEventListener("drop", (e) => {
      dom.panel.classList.remove("is-drop");
      if (!hasFiles(e) || !sheet) return;
      e.preventDefault();
      const f = Array.from(e.dataTransfer.files || []).find((x) => /^image\//.test(x.type || ""));
      if (!f) { toast("File ini bukan gambar."); return; }
      const card = e.target.closest && e.target.closest(".react-flow__node-person");
      let at = null;
      try { at = api.rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }); } catch (er) { at = null; }
      setPhoto(card ? card.dataset.id : null, f, at);
    });
    dom.pop.addEventListener("keydown", onMenuKey);
    dom.pop.addEventListener("input", (e) => {
      if (e.target.classList.contains("jj-char-q")) { const l = dom.pop.querySelector(".jj-char-list"); if (l) l.innerHTML = charRowsHtml(e.target.value); }
    });
    dom.pop.addEventListener("submit", (e) => {
      e.preventDefault();
      const f = e.target;
      if (f.classList.contains("jj-custom")) submitCustom(f.querySelector("input").value);
      else if (f.classList.contains("jj-newtag")) {
        const v = f.querySelector("input").value;
        if (!v.trim()) return;
        addTag(v, menu && menu.kind === "tagsel");
        if (menu) openMenu(menu.kind, menu.anchor, menu.at);
        const inp = dom.pop.querySelector(".jj-newtag input");
        if (inp) inp.focus();
      }
    });
    dom.pop.addEventListener("change", (e) => {   // ganti nama label di pengelola label
      const inp = e.target.closest(".jj-tagname");
      if (!inp || !doc) return;
      const t = doc.tags.find((x) => x.id === inp.dataset.id), v = inp.value.trim().slice(0, 30);
      if (t && v && v !== t.name) mutate(() => { t.name = v; });
    });
  }
  function onPanelClick(e) {
    const b = e.target.closest("button");
    if (!b || !dom.panel.contains(b) || b.disabled) return;
    if (b.dataset.w && dom.wiz.contains(b)) { wizAct(b.dataset.w, b); return; }
    if (b === dom.docBtn) { if (data() && data().docs.length) toggleMenu("docs", b); return; }
    if (b.closest(".jj-pop")) {
      const act = b.dataset.act;
      if (!act) return;
      if (menu && (menu.kind === "wicon" || menu.kind === "wcolor")) { wizPick(act, b.dataset.arg); return; }
      if (onRelAct(act, b.dataset.arg)) return;
      runAct(act, b.dataset.arg, menu && menu.anchor);
      return;
    }
    if (b.dataset.sheet) {
      if (sheet && b.dataset.sheet === sheet.id) toggleMenu("sheet", b);
      else switchSheet(b.dataset.sheet);
      return;
    }
    if (b.dataset.tool) { closeMenu(); setTool(b.dataset.tool); return; }
    if (b.dataset.act === "more") { toggleMenu("more", b); return; }
    if (b.dataset.act === "labels") { toggleMenu("labels", b); return; }
    if (b.dataset.act) runAct(b.dataset.act, b.dataset.arg, b);
  }
  // wizard: pilih ikon / warna jenis relasi
  function wizPick(act, arg) {
    const i = menu ? menu.arg : -1, t = wiz && wiz.types ? wiz.types[i] : null;
    closeMenu();
    if (!t) return;
    if (act === "wseticon" && ICONS[arg]) t.icon = arg;
    if (act === "wsetcolor") t.color = COLORS[arg] ? arg : "";
    refreshRow(i, act === "wseticon" ? "icon" : "color");
  }
  function onWizKey(e) {
    if (!wiz) return;
    const t = e.target;
    if (e.key === "Escape" && !menu) { e.preventDefault(); e.stopPropagation(); closeWizard(); return; }
    if (t.classList.contains("jj-tpl") && /^Arrow(Up|Down|Left|Right)$/.test(e.key)) {
      e.preventDefault();
      const i = TEMPLATES.findIndex((x) => x.id === wiz.tpl), d = e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 1;
      wiz.tpl = TEMPLATES[(i + d + TEMPLATES.length) % TEMPLATES.length].id;
      renderWizLeft(); renderPreview();
      const f = dom.wiz.querySelector('.jj-tpl[aria-checked="true"]');
      if (f) f.focus();
      return;
    }
    if (t.classList.contains("jj-tpl") && e.key === "Enter") { e.preventDefault(); wizAct("next", t); return; }
    if (t.classList.contains("jj-trow-name") && e.key === "Enter") {
      e.preventDefault();
      const ins = [...dom.wiz.querySelectorAll(".jj-trow-name")], k = ins.indexOf(t);
      if (ins[k + 1]) { ins[k + 1].focus(); ins[k + 1].select(); } else dom.wiz.querySelector('[data-w="create"]').focus();
    }
  }

  function updateChrome() {
    if (!dom) return;
    const j = data(), has = !!(j && j.docs.length && doc);
    dom.panel.classList.toggle("is-nodoc", !has);
    dom.panel.classList.toggle("is-max", maxed);
    dom.docTitle.textContent = has ? doc.title : "Jejaring baru";
    dom.docBtn.classList.toggle("is-static", !has);
    dom.docBtn.setAttribute("aria-disabled", has ? "false" : "true");
    const ev = document.getElementById("editorView");
    if (ev) ev.classList.toggle("jj-maxed", maxed && isShown());
    dom.maxBtn.setAttribute("aria-pressed", maxed ? "true" : "false");
    dom.maxBtn.dataset.tip = maxed ? "Kecilkan panel" : "Perbesar panel";
    dom.maxBtn.setAttribute("aria-label", dom.maxBtn.dataset.tip);
    if (!has) { dom.docSub.textContent = ""; dom.sheets.innerHTML = ""; dom.empty.classList.add("hidden"); dom.hint.classList.remove("is-on"); return; }
    const ps = sheet.nodes.filter((n) => n.t === "person").length;
    dom.docSub.textContent = `${TPL[doc.template].name} · ${ps} tokoh`;
    const t = space ? "hand" : tool;
    dom.panel.dataset.tool = t;
    dom.tools.querySelectorAll("[data-tool]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.tool === t ? "true" : "false"));
    dom.tools.querySelector('[data-act="labels"]').classList.toggle("is-on", !!focusTag);
    // lembar (tidak dibangun ulang saat sedang ganti nama)
    if (!dom.sheets.querySelector(".jj-sheet-input")) {
      dom.sheets.innerHTML = doc.sheets.map((s) => `<button type="button" class="jj-sheet${s === sheet ? " is-on" : ""}" role="tab" aria-selected="${s === sheet}" data-sheet="${esc(s.id)}"` +
        `${s === sheet ? ' aria-haspopup="menu" title="Klik untuk menu lembar · klik dua kali untuk ganti nama"' : ""}>${esc(s.name)}</button>`).join("") +
        `<button type="button" class="jj-sheet-add" data-act="newsheet" aria-label="Lembar baru" data-tip="Lembar baru" data-tip-pos="top">${icS("#ti-plus", 14)}</button>`;
    }
    const hints = {
      person: "Klik di kanvas untuk menaruh kartu tokoh · Esc batal",
      note: "Klik atau seret di kanvas untuk menaruh catatan · Esc batal",
      text: "Klik di kanvas untuk menulis teks · Esc batal",
    };
    const ft = focusTag && doc.tags.find((x) => x.id === focusTag);
    const hint = hints[t] || (ft ? `Menyorot label "${ft.name}" · Esc untuk berhenti` : "");
    dom.hint.textContent = hint;
    dom.hint.classList.toggle("is-on", !!hint);
    const empty = !sheet.nodes.length;
    dom.empty.classList.toggle("hidden", !empty);
    if (empty) dom.empty.innerHTML = `<span class="jj-empty-ic">${icS("#ti-affiliate", 22)}</span><p>Lembar ini masih kosong</p>` +
      `<small>Tambahkan tokoh pertama, lalu pakai tombol + di sisi kartu untuk menambah orang tua, anak, pasangan, dan lainnya.</small>` +
      `<button type="button" class="jj-btn-primary jj-btn-sm" data-act="addperson">${icS("#ti-user-plus", 15)}<span>Tambah tokoh</span></button>`;
  }

  // ---------- menu / popover ----------
  function item(o) {
    if (o.sep) return '<div class="jj-mi-sep" role="separator"></div>';
    if (o.head) return `<div class="jj-mi-head">${esc(o.head)}</div>`;
    const role = o.check !== undefined ? (o.radio ? "menuitemradio" : "menuitemcheckbox") : "menuitem";
    return `<button type="button" class="jj-mi${o.danger ? " is-danger" : ""}" role="${role}" data-act="${o.act}"${o.arg !== undefined ? ` data-arg="${esc(o.arg)}"` : ""}` +
      `${o.check !== undefined ? ` aria-checked="${o.check ? "true" : "false"}"` : ""}${o.disabled ? " disabled" : ""}>` +
      `<span class="jj-mi-ic">${o.ic || ""}</span><span class="jj-mi-label">${esc(o.label)}${o.sub ? `<small>${esc(o.sub)}</small>` : ""}</span>` +
      `${o.kbd ? `<kbd>${esc(o.kbd)}</kbd>` : ""}${o.check ? `<span class="jj-mi-check">${icS("#ti-check", 14)}</span>` : ""}</button>`;
  }
  function tagRowsHtml(manage) {
    const ps = manage ? [] : selModels().filter((m) => m.t === "person");
    const count = (id) => sheet.nodes.filter((n) => n.t === "person" && (n.tags || []).includes(id)).length;
    const rows = doc.tags.map((t) => {
      if (manage) {
        return `<div class="jj-tagrow"><button type="button" class="jj-sw" data-act="tagcolor" data-arg="${esc(t.id)}" style="--c:${COLORS[t.color]}" aria-label="Ganti warna label ${esc(t.name)}" title="Ganti warna"></button>` +
          `<input class="jj-tagname" data-id="${esc(t.id)}" value="${esc(t.name)}" maxlength="30" aria-label="Nama label" spellcheck="false">` +
          `<span class="jj-tagcount" title="Kartu di lembar ini">${count(t.id)}</span>` +
          `<button type="button" class="jj-ibtn jj-ibtn-sm" data-act="tagfocus" data-arg="${esc(t.id)}" aria-pressed="${focusTag === t.id}" aria-label="Sorot kartu berlabel ${esc(t.name)}" title="Sorot">${focusTag === t.id ? icS("#ti-eye-off", 14) : icS("#ti-eye", 14)}</button>` +
          `<button type="button" class="jj-ibtn jj-ibtn-sm" data-act="tagdel" data-arg="${esc(t.id)}" aria-label="Hapus label ${esc(t.name)}" title="Hapus">${icS("#ti-trash", 14)}</button></div>`;
      }
      const n = ps.filter((m) => (m.tags || []).includes(t.id)).length;
      return `<button type="button" class="jj-mi jj-tagpick" role="menuitemcheckbox" aria-checked="${n === ps.length && n > 0}" data-act="tagtoggle" data-arg="${esc(t.id)}">` +
        `<span class="jj-mi-ic"><i class="jj-dot" style="--c:${COLORS[t.color]}"></i></span><span class="jj-mi-label">${esc(t.name)}</span>` +
        `${n === ps.length && n ? `<span class="jj-mi-check">${icS("#ti-check", 14)}</span>` : n ? '<span class="jj-mi-mixed" aria-hidden="true">–</span>' : ""}</button>`;
    }).join("");
    return rows || '<p class="jj-mi-empty">Belum ada label. Buat label untuk menandai kubu, keluarga, atau status tokoh.</p>';
  }
  function menuHtml(kind, o) {
    const x = doc ? H() : { undo: [], redo: [] };
    if (kind === "docs") {
      return [{ head: "Jejaring" }].concat(data().docs.map((d) => ({
        act: "doc", arg: d.id, label: d.title, check: d === doc, radio: true, ic: icS(TPL[d.template].icon, 15),
        sub: `${TPL[d.template].name} · ${d.sheets.length} lembar`,
      })), [{ sep: 1 },
        { act: "newdoc", label: "Jejaring baru", ic: icS("#ti-plus", 15) },
        { act: "rename", label: "Ganti nama", ic: icS("#ti-pencil", 15) },
        { act: "deldoc", label: "Hapus jejaring", ic: icS("#ti-trash", 15), danger: true },
      ]).map(item).join("");
    }
    if (kind === "more") {
      const light = document.body.classList.contains("light");
      return [
        { act: "tidy", label: "Rapikan", sub: "Susun otomatis per generasi", ic: icS("#ti-sitemap", 15) },
        { act: "types", label: "Jenis relasi…", ic: icS("#ti-adjustments-horizontal", 15) },
        { act: "labels", label: "Label…", ic: icS("#ti-tag", 15), kbd: "L" },
        { sep: 1 },
        { act: "undo", label: "Urungkan", ic: icS("#ti-arrow-back-up", 15), kbd: MOD + "+Z", disabled: !x.undo.length },
        { act: "redo", label: "Ulangi", ic: icS("#ti-arrow-forward-up", 15), kbd: MOD + "+Shift+Z", disabled: !x.redo.length },
        { act: "fit", label: "Pas ke layar", ic: icS("#ti-focus-centered", 15), kbd: "Shift+1" },
        { act: "zoom100", label: "Zoom 100%", ic: icS("#ti-zoom-reset", 15), kbd: "Shift+0" },
        { act: "minimap", label: "Peta mini", ic: icS("#ti-map-2", 15), check: mini },
        { act: "theme", label: light ? "Tema gelap" : "Tema terang", ic: light ? icS("#ti-moon", 15) : icS("#ti-sun", 15) },
        { act: "help", label: "Pintasan keyboard", ic: icS("#ti-keyboard", 15) },
        { sep: 1 },
        { act: "clear", label: "Bersihkan lembar", ic: icS("#ti-eraser", 15), danger: true },
      ].map(item).join("");
    }
    if (kind === "sheet") {
      return [
        { head: sheet.name },
        { act: "sheetrename", arg: sheet.id, label: "Ganti nama", ic: icS("#ti-pencil", 15) },
        { act: "sheetdup", label: "Duplikat lembar", ic: icS("#ti-copy", 15) },
        { act: "newsheet", label: "Lembar baru", ic: icS("#ti-plus", 15) },
        { sep: 1 },
        { act: "sheetdel", label: "Hapus lembar", ic: icS("#ti-trash", 15), danger: true, disabled: doc.sheets.length < 2 },
      ].map(item).join("");
    }
    if (kind === "rel") return relHtml();
    if (kind === "photo") return [{ act: "photonew", label: "Ganti foto…", ic: icS("#ti-photo-edit", 15) }, { act: "photodel", label: "Hapus foto", ic: icS("#ti-photo-x", 15), danger: true }].map(item).join("");
    if (kind === "emoji") {
      const m = selModels()[0];
      return `<div class="jj-pick-head">Lencana</div><div class="jj-emoji-grid">${EMOJI.map((e) => `<button type="button" class="jj-emoji${m && m.emoji === e ? " is-on" : ""}" data-act="setemoji" data-arg="${e}" aria-label="Lencana ${e}">${e}</button>`).join("")}</div>` +
        (m && m.emoji ? item({ act: "setemoji", arg: "", label: "Hapus lencana", ic: icS("#ti-x", 15) }) : "");
    }
    if (kind === "tagsel" || kind === "labels") {
      const manage = kind === "labels";
      return `<div class="jj-pop-head is-cap"><span>${manage ? "Label jejaring" : "Label kartu"}</span>${manage && focusTag ? `<button type="button" class="jj-link-btn" data-act="focusoff">Berhenti sorot</button>` : ""}</div>` +
        `<div class="jj-mi-scroll">${tagRowsHtml(manage)}</div>` +
        `<form class="jj-newtag"><span class="jj-dot" style="--c:${COLORS[nextTagColor()]}"></span><input maxlength="30" placeholder="Label baru…" aria-label="Nama label baru" autocomplete="off" spellcheck="false"><button type="submit" class="jj-btn-sm">Tambah</button></form>`;
    }
    if (kind === "node") {
      const ms = selModels(), one = ms.length === 1 ? ms[0] : null;
      return [
        one ? { act: "edit", label: one.t === "person" ? "Ganti nama" : "Edit teks", ic: icS("#ti-cursor-text", 15), kbd: "Enter" } : null,
        one && one.t === "person" && !one.charId ? { act: "makecard", label: "Buat kartu Organize", ic: icS("#ti-user-plus", 15) } : null,
        one && one.t === "person" && one.charId ? { act: "opencard", label: "Buka kartu di Organize", ic: icS("#ti-id", 15) } : null,
        { act: "dup", label: "Duplikat", ic: icS("#ti-copy-plus", 15), kbd: MOD + "+D" },
        { act: "copy", label: "Salin", ic: icS("#ti-copy", 15), kbd: MOD + "+C" },
        { sep: 1 },
        { act: "del", label: "Hapus", ic: icS("#ti-trash", 15), kbd: "Del", danger: true },
      ].filter(Boolean).map(item).join("");
    }
    if (kind === "pane") {
      return [
        { act: "paste", label: "Tempel", ic: icS("#ti-clipboard", 15), kbd: MOD + "+V", disabled: !clip },
        { sep: 1 },
        { act: "addhere", arg: "person", label: "Tokoh di sini", ic: icS("#ti-user-plus", 15) },
        { act: "addhere", arg: "note", label: "Catatan di sini", ic: icS("#ti-note", 15) },
        { act: "addhere", arg: "text", label: "Teks di sini", ic: icS("#ti-letter-t", 15) },
        { sep: 1 },
        { act: "tidy", label: "Rapikan", ic: icS("#ti-sitemap", 15) },
        { act: "selall", label: "Pilih semua", ic: icS("#ti-select-all", 15), kbd: MOD + "+A" },
        { act: "fit", label: "Pas ke layar", ic: icS("#ti-focus-centered", 15), kbd: "Shift+1" },
      ].map(item).join("");
    }
    if (kind === "wicon") {
      const t = wiz && wiz.types[o.arg];
      return `<div class="jj-pick-head">Ikon relasi</div><div class="jj-icon-grid">${Object.keys(ICONS).map((k) => `<button type="button" class="jj-pick${t && t.icon === k ? " is-on" : ""}" data-act="wseticon" data-arg="${k}" aria-label="Ikon ${k}" title="${k}">${icS(ICONS[k], 17)}</button>`).join("")}</div>`;
    }
    if (kind === "wcolor") {
      const t = wiz && wiz.types[o.arg];
      return `<div class="jj-pick-head">Warna garis</div><div class="jj-pick-row"><button type="button" class="jj-sw is-none${t && !t.color ? " is-on" : ""}" data-act="wsetcolor" data-arg="" aria-label="Bawaan" title="Bawaan"></button>` +
        Object.keys(COLORS).map((k) => `<button type="button" class="jj-sw${t && t.color === k ? " is-on" : ""}" data-act="wsetcolor" data-arg="${k}" style="--c:${COLORS[k]}" aria-label="Warna ${COLOR_NAMES[k]}" title="${COLOR_NAMES[k]}"></button>`).join("") + "</div>";
    }
    if (kind === "help") {
      const rows = [
        ["V / H", "Pilih / Geser"], ["P · N · T", "Tokoh · Catatan · Teks"], ["L", "Label"], ["Tombol + di kartu", "Tambah relasi"],
        ["Seret + ke kartu", "Hubungkan dua tokoh"], ["Klik garis", "Ubah / hapus relasi"], ["Seret latar", "Geser kanvas"],
        ["Roda / 2 jari", "Geser"], [MOD + " + roda / cubit", "Zoom"], ["Shift + seret", "Kotak pilih"], ["Klik 2× / Enter", "Ganti nama"],
        [MOD + "+D", "Duplikat"], [MOD + "+C / V", "Salin / tempel"], ["Delete", "Hapus"], [MOD + "+Z / Shift+Z", "Urungkan / ulangi"], ["Shift+1", "Pas layar"], ["Esc", "Batal / lepas pilihan"],
      ];
      return `<div class="jj-help" role="document"><div class="jj-help-head">${icS("#ti-keyboard", 16)}<b>Pintasan jejaring</b></div><dl>${rows.map((r) => `<dt><kbd>${esc(r[0])}</kbd></dt><dd>${esc(r[1])}</dd>`).join("")}</dl></div>`;
    }
    return "";
  }
  const MENU_LABELS = { docs: "Jejaring", more: "Menu jejaring", sheet: "Menu lembar", rel: "Relasi", photo: "Foto", emoji: "Lencana", tagsel: "Label kartu", labels: "Label jejaring", node: "Menu kartu", pane: "Menu kanvas", wicon: "Ikon relasi", wcolor: "Warna garis", help: "Pintasan" };
  function openMenu(kind, anchor, at, arg) {
    if (!dom) return;
    if ((kind !== "wicon" && kind !== "wcolor" && kind !== "help" && kind !== "docs") && !doc) return;
    const pop = dom.pop;
    if (menu && menu.anchor && menu.anchor !== anchor && menu.anchor.isConnected) menu.anchor.setAttribute("aria-expanded", "false");
    menu = { kind, anchor: anchor || null, at: at || null, arg: arg !== undefined ? arg : menu && menu.kind === kind ? menu.arg : undefined };
    pop.className = "jj-pop is-" + kind;
    pop.setAttribute("role", kind === "help" ? "dialog" : "menu");
    pop.setAttribute("aria-label", MENU_LABELS[kind] || "");
    pop.innerHTML = menuHtml(kind, { arg: menu.arg });
    if (anchor) anchor.setAttribute("aria-expanded", "true");
    // posisi: di samping "+" (seperti referensi), di bawah tombol kepala, di atas bilah bawah, atau di titik klik
    const pr = dom.panel.getBoundingClientRect(), pw = pop.offsetWidth, ph = pop.offsetHeight;
    let x, y;
    if (at && at.x !== undefined) { x = at.x - pr.left + 6; y = at.y - pr.top + 6; if (y + ph > pr.height - 8) y = Math.max(8, at.y - pr.top - ph - 6); }
    else if (anchor && anchor.isConnected) {
      const r = anchor.getBoundingClientRect();
      if (anchor.classList.contains("jj-plus")) {
        x = r.right - pr.left + 8; y = r.top - pr.top - 10;
        if (x + pw > pr.width - 8) x = r.left - pr.left - pw - 8;
      } else if (anchor.closest(".jj-bottom") || anchor.closest(".jj-selbar")) {
        x = r.left - pr.left + r.width / 2 - pw / 2;
        y = anchor.closest(".jj-bottom") ? r.top - pr.top - ph - 10 : r.bottom - pr.top + 8;
      } else if (anchor.closest(".jj-head")) {
        x = kind === "more" || kind === "help" ? r.right - pr.left - pw : r.left - pr.left;
        y = r.bottom - pr.top + 6;
      } else { x = r.left - pr.left; y = r.bottom - pr.top + 6; if (y + ph > pr.height - 8) y = r.top - pr.top - ph - 6; }
    } else { x = pr.width / 2 - pw / 2; y = pr.height / 2 - ph / 2; }
    pop.style.left = Math.round(clamp(x, 8, Math.max(8, pr.width - pw - 8))) + "px";
    pop.style.top = Math.round(clamp(y, 8, Math.max(8, pr.height - ph - 8))) + "px";
    const f = pop.querySelector(".jj-custom-in, .jj-char-q, .jj-mi:not([disabled]), .jj-rel, .jj-pick, .jj-emoji, .jj-sw, .jj-tagname");
    if (f && kind !== "labels" && kind !== "tagsel") f.focus({ preventScroll: true });
    else if ((kind === "labels" || kind === "tagsel") && !doc.tags.length) { const i = pop.querySelector(".jj-newtag input"); if (i) i.focus({ preventScroll: true }); }
  }
  function toggleMenu(kind, anchor) { if (menu && menu.kind === kind && menu.anchor === anchor) closeMenu(); else openMenu(kind, anchor); }
  function closeMenu(refocus) {
    if (!menu || !dom) return;
    const a = menu.anchor;
    if (menu.kind === "rel") relCtx = null;
    menu = null;
    dom.pop.className = "jj-pop hidden";
    dom.pop.innerHTML = "";
    if (a && a.isConnected) { a.setAttribute("aria-expanded", "false"); if (refocus) a.focus(); }
  }
  function onMenuKey(e) {
    if (!menu) return;
    e.stopPropagation();
    if (e.key === "Escape") { e.preventDefault(); closeMenu(true); return; }
    if (isEditable(e.target) && e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    if (e.key === "Tab" && menu.kind !== "help" && menu.kind !== "labels" && menu.kind !== "tagsel" && menu.kind !== "rel") { closeMenu(); return; }
    if (!/^(ArrowDown|ArrowUp|ArrowLeft|ArrowRight|Home|End)$/.test(e.key)) return;
    const list = [...dom.pop.querySelectorAll(".jj-mi:not([disabled]), .jj-rel, .jj-pick, .jj-emoji, .jj-sw")];
    if (!list.length) return;
    e.preventDefault();
    const i = list.indexOf(document.activeElement), back = e.key === "ArrowUp" || e.key === "ArrowLeft";
    const j = e.key === "Home" ? 0 : e.key === "End" ? list.length - 1 : i < 0 ? 0 : back ? (i - 1 + list.length) % list.length : (i + 1) % list.length;
    list[j].focus();
  }
  function toast(msg) {
    if (!dom) return;
    dom.toast.textContent = msg;
    dom.toast.classList.add("is-on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => dom && dom.toast.classList.remove("is-on"), 2800);
  }

  // ================= KEYBOARD & TEMPEL (hanya saat tab Jejaring tampil) =================
  function isShown() {
    const tab = document.getElementById("tabJejaring"), ev = document.getElementById("editorView");
    return !!(ctx && dom && dom.panel.isConnected && tab && !tab.classList.contains("hidden") && ev && !ev.classList.contains("hidden"));
  }
  function blocked() { return !!document.querySelector(".modal:not(.hidden), .tp-overlay:not(.hidden), .proj-sidebar.is-open, #editorView.tsb-drawer-open"); }
  function keyTargetOk(t) { return t === document.body || t === document.documentElement || (dom && dom.panel.contains(t)); }
  function syncMods(e) {
    const m = { shift: !!e.shiftKey, meta: MAC && !!e.metaKey, multi: !!(e.shiftKey || e.ctrlKey || e.metaKey) };
    if (m.shift === mods.shift && m.meta === mods.meta && m.multi === mods.multi) return;
    mods = m;
    if (root) renderFlow();
  }
  function onKeyDown(e) {
    if (!isShown()) return;
    if (/^(Shift|Control|Meta)$/.test(e.key)) syncMods(e);
    if (e.isComposing || wiz) return;   // wizard: tombol ditangani onWizKey
    const t = e.target;
    if (isEditable(t) || blocked() || !keyTargetOk(t) || !doc) return;
    if (menu && dom.pop.contains(t)) return;
    if (menu && e.key === "Escape") { e.preventDefault(); closeMenu(true); return; }
    const k = e.key, mod = e.ctrlKey || e.metaKey;
    if (k === " " && !mod) {
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
      if (kk === "v") { if (clip) { e.preventDefault(); pasteClip(); } return; }
      if (kk === "a") { e.preventDefault(); selectAll(); return; }
      if (k === "0") { e.preventDefault(); zoom100(); return; }
      if (k === "=" || k === "+") { e.preventDefault(); zoomBy(1); return; }
      if (k === "-") { e.preventDefault(); zoomBy(-1); return; }
      return;
    }
    if (e.altKey) return;
    if (k === "Delete" || k === "Backspace") { if (deleteSel()) e.preventDefault(); return; }
    if (k === "Escape") {
      if (tool !== "select") setTool("select");
      else if (focusTag) setFocusTag(null);
      else selectOnly([], []);
      return;
    }
    if (k === "Enter" || k === "F2") {
      const ms = selModels();
      if (ms.length === 1 && api) { e.preventDefault(); api.setEditing(ms[0].t === "person" ? "name:" + ms[0].id : ms[0].id); }
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
    const kk = k.toLowerCase();
    if (kk === "l") { e.preventDefault(); toggleMenu("labels", dom.tools.querySelector('[data-act="labels"]')); return; }
    const map = { v: "select", h: "hand", p: "person", n: "note", t: "text" };
    if (map[kk]) { e.preventDefault(); closeMenu(); setTool(map[kk]); }
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
    if (!isShown() || wiz || !sheet || isEditable(e.target) || blocked() || !keyTargetOk(e.target)) return;
    const f = Array.from((e.clipboardData && e.clipboardData.files) || []).find((x) => /^image\//.test(x.type || ""));
    if (!f) return;
    e.preventDefault();
    const ms = selModels();
    setPhoto(ms.length === 1 && ms[0].t === "person" ? ms[0].id : null, f, null);
  }
  function onDocPointerDown(e) {
    if (isShown() && dom.panel.contains(e.target)) syncMods(e);
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
  function flushEdit(keepOpen) {
    if (!dom) return;
    const ta = dom.flow.querySelector(".jj-edit");
    if (ta && ta.dataset.id) commitEdit(ta.dataset.id, ta.value, keepOpen);
    else if (editingNow && api && !keepOpen) api.setEditing(null);
  }

  // ================= API untuk app.js =================
  window.NovelJejaring = {
    // dipanggil tiap kali tab Jejaring tampil (juga saat pindah project)
    show(c) {
      const fresh = !ctx || ctx.project !== c.project;
      ctx = c;
      bindOnce();
      if (fresh) {
        projId = c.project.id;
        hist.clear(); clip = null; tool = "select"; space = false; pendingSel = null; focusTag = null; wiz = null;
      }
      const j = dataOf(c.project);
      mountChrome();
      const want = fresh ? lsGet("novelist_jjdoc_" + projId) : doc && doc.id;
      doc = j.docs.find((d) => d.id === want) || j.docs.find((d) => d.id === j.active) || j.docs[0] || null;
      sheet = null;
      if (doc) {
        j.active = doc.id;
        const ws = lsGet("novelist_jjsheet_" + projId + "_" + doc.id);
        sheet = doc.sheets.find((s) => s.id === ws) || doc.sheets.find((s) => s.id === doc.activeSheet) || doc.sheets[0];
        doc.activeSheet = sheet.id;
      } else if (!wiz) wiz = { step: 1, mode: "new", tpl: "keluarga", types: null, cancel: false };
      rev++;
      closeMenu();
      renderFlow();
      updateChrome();
      if (wiz) renderWizard(true);
      if (doc && ctx.onOpen) ctx.onOpen(doc.id, doc.title);
    },
    // tab lain tampil / keluar project / logout: simpan teks yang sedang diedit lalu lepas kanvas
    hide() {
      if (!dom) return;
      flushEdit(false);
      closeMenu();
      cancelAnimationFrame(animRaf);
      space = false; mods = { shift: false, meta: false, multi: false };
      if (root) { try { root.unmount(); } catch (e) { /* abaikan */ } }
      if (pvRoot) { try { pvRoot.unmount(); } catch (e) { /* abaikan */ } }
      root = null; api = null; pvRoot = null; pvApi = null; editingNow = null;
      if (dom.wiz) { dom.wiz.innerHTML = ""; dom.wiz.classList.add("hidden"); }
      const ev = document.getElementById("editorView");
      if (ev) ev.classList.remove("jj-maxed");
    },
    // dari riwayat sidebar tab: buka jejaring tertentu
    open(id) { if (ctx && dom && data() && data().docs.some((d) => d.id === id) && (!doc || doc.id !== id)) switchDoc(id); },
    flush() { if (root) flushEdit(isShown()); },
  };
})();
