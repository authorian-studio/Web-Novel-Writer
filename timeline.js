// ================= TIMELINE (React Flow) =================
// Dimuat lazy oleh app.js (ensureTimelineLib) saat tab Timeline pertama kali dibuka, setelah React, ReactDOM &
// React Flow (folder vendor/). Data disimpan di project: p.data.timelines = [{ id, title, start, end, events }]
//   start/end = rentang dasar garis waktu (default 1500–1900); tombol + di kedua ujung garis menambah 100 tahun per klik
//   event     = { id, title, year, month, day, desc, color, sceneId, image?, tags? }  (month/day boleh kosong;
//               image = data:image/... kecil, tags = ["tag", ...])
// Aturan garis waktu (ala vvd):
//   - garisnya selalu satu garis horizontal; event menempel di garis itu (hanya bisa digeser kiri/kanan)
//   - arahkan kursor ke garis -> muncul tanggal lengkap (tanggal bulan tahun) + "klik untuk menambah"
//   - klik event -> kartu kecil (gambar, judul, tanggal, deskripsi, tag); "Edit" membuka panel edit
//   - event di luar rentang dasar (mis. 1464 < 1500) membuat garis otomatis memanjang sampai tanggal itu
// React hanya menggambar kanvas; sidebar daftar timeline, header & panel edit event memakai DOM biasa.
(function () {
  const h = React.createElement;
  const RF = window.ReactFlow;
  const { ReactFlowProvider, Controls, useNodesState, useReactFlow } = RF;
  const Flow = RF.default || RF.ReactFlow;

  const AXIS_W = 1600;          // panjang garis di kanvas (satuan flow, sebelum zoom) untuk seluruh rentang yang tampil
  const NODE_W = 220;           // lebar kotak node event (transparan; yang terlihat hanya pill + tiang + titik)
  const DOT = 10, STEM_BASE = 14, LEVEL_GAP = 34, MAX_LEVELS = 4;
  const HOVER_BAND = 16;        // jarak (px layar) dari garis agar tooltip "klik untuk menambah" muncul
  const COLORS = ["#e8e8ec", "#d7a86e", "#4caf82", "#6aa8ff", "#c77dff", "#e15c5c"];
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
  const MONTHS_FULL = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
  const EXTEND_YEARS = 100;     // tombol + di ujung garis
  const IMG_PX = 640, MAX_IMG = 400000;
  const MDAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const CUM = MDAYS.reduce((a, d, i) => (a.push(i ? a[i - 1] + MDAYS[i - 1] : 0), a), []);

  let ctx = null;               // { project, onChange, getScenes, openScene }
  let tl = null;                // timeline yang sedang dibuka
  let selectedId = null;        // event yang sedang dipilih
  let cardId = null;            // event yang kartunya sedang tampil (klik event)
  let sideOpen = true;          // sidebar daftar timeline (disimpan di perangkat)
  try { sideOpen = localStorage.getItem("novelist_tlside") !== "0"; } catch (e) { /* abaikan */ }
  let rev = 0;                  // dinaikkan tiap data berubah -> node dibangun ulang
  let mode = "pan";
  let api = null;               // instance React Flow
  let root = null;
  let bound = false;
  const $ = (id) => document.getElementById(id);
  const uid = (p) => p + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const timelines = () => { const d = ctx.project.data; if (!Array.isArray(d.timelines)) d.timelines = []; return d.timelines; };
  const findEvent = (id) => tl && tl.events.find((e) => e.id === id);
  function changed() { rev++; renderFlow(); renderHead(); ctx.onChange(); }

  // ---------- tanggal <-> posisi ----------
  const dateToFrac = (ev) => ev.year + (ev.month ? (CUM[ev.month - 1] + (ev.day ? ev.day - 1 : 0)) / 365 : 0);
  function fracToDate(f, prec) {
    if (prec === "year") return { year: Math.round(f), month: null, day: null };
    const year = Math.floor(f), doy = Math.min(364, Math.floor((f - year) * 365 + 1e-6));
    let m = 0; while (m < 11 && CUM[m + 1] <= doy) m++;
    return prec === "month" ? { year, month: m + 1, day: null } : { year, month: m + 1, day: doy - CUM[m] + 1 };
  }
  const fmtDate = (d) => (d.month ? (d.day ? d.day + " " : "") + MONTHS[d.month - 1] + " " : "") + d.year;
  const fmtLong = (d) => (d.month ? (d.day ? d.day + " " : "") + MONTHS_FULL[d.month - 1] + " " : "") + (d.year < 0 ? Math.abs(d.year) + " SM" : d.year);
  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const tagsOf = (ev) => (Array.isArray(ev.tags) ? ev.tags.filter((t) => typeof t === "string" && t.trim()) : []);
  // rentang garis = rentang dasar, diperpanjang otomatis supaya semua event masuk
  function rangeOf(t) {
    let start = t.start, end = t.end;
    t.events.forEach((ev) => { const f = dateToFrac(ev); if (f < start) start = Math.floor(f); if (f > end) end = Math.ceil(f); });
    return { start, end };
  }
  const scaleOf = (r) => AXIS_W / Math.max(1, r.end - r.start);
  const fracToX = (r, f) => (f - r.start) * scaleOf(r);
  const xToFrac = (r, x) => r.start + x / scaleOf(r);
  // presisi tanggal mengikuti zoom: makin dekat, makin detail (tahun -> bulan -> hari)
  function precisionNow(r) {
    const pxPerYear = scaleOf(r) * (api ? api.getZoom() : 1);
    return pxPerYear >= 365 * 3 ? "day" : pxPerYear >= 12 * 6 ? "month" : "year";
  }
  // jarak label di garis (dalam bulan) supaya label berjarak minimal ~90px di layar
  const STEP_MONTHS = [1, 2, 3, 6, 12, 24, 60, 120, 240, 600, 1200, 2400, 6000, 12000, 24000, 60000, 120000];
  function axisStep(pxPerYear) {
    for (const m of STEP_MONTHS) if ((m / 12) * pxPerYear >= 90) return m;
    return STEP_MONTHS[STEP_MONTHS.length - 1];
  }
  function fitAxis(duration) {   // tampilkan seluruh garis waktu
    const box = $("tlFlow");
    if (!api || !box.clientWidth) return;
    api.setViewport({ x: box.clientWidth * 0.08, y: box.clientHeight * 0.6, zoom: (box.clientWidth * 0.84) / AXIS_W }, { duration: duration || 0 });
  }

  // ---------- garis waktu: digambar di koordinat layar (ukuran teks & garis tetap, label menyesuaikan zoom) ----------
  function AxisLayer({ range }) {
    const [tx, ty, zoom] = RF.useStore((st) => st.transform);
    const width = RF.useStore((st) => st.width);
    const pxYear = scaleOf(range) * zoom;
    const left = tx, right = tx + AXIS_W * zoom, y = ty;
    const parts = [h("line", { key: "l", x1: Math.max(left, -20), y1: y, x2: Math.min(right, width + 20), y2: y, className: "tl-axis-line" })];
    if (left >= -10 && left <= width + 10) parts.push(h("circle", { key: "a", cx: left, cy: y, r: 3.5, className: "tl-axis-end" }));
    if (right >= -10 && right <= width + 10) parts.push(h("circle", { key: "b", cx: right, cy: y, r: 3.5, className: "tl-axis-end" }));
    const step = axisStep(pxYear);
    const minor = step >= 60 ? step / 5 : step === 12 && pxYear / 12 >= 6 ? 1 : step === 24 ? 12 : 0;
    const fyL = Math.max(range.start, range.start + (0 - tx) / pxYear), fyR = Math.min(range.end, range.start + (width - tx) / pxYear);
    const xOf = (idx) => tx + (idx / 12 - range.start) * pxYear;
    if (minor) for (let i = Math.ceil(fyL * 12 / minor) * minor, n = 0; i <= fyR * 12 && n < 600; i += minor, n++) {
      if (i % step === 0) continue;
      parts.push(h("line", { key: "m" + i, x1: xOf(i), y1: y - 2, x2: xOf(i), y2: y + 2, className: "tl-axis-tick minor" }));
    }
    for (let i = Math.ceil(fyL * 12 / step) * step, n = 0; i <= fyR * 12 && n < 300; i += step, n++) {
      const yr = Math.floor(i / 12), mo = ((i % 12) + 12) % 12, x = xOf(i);
      parts.push(h("line", { key: "t" + i, x1: x, y1: y - 4, x2: x, y2: y + 4, className: "tl-axis-tick" }));
      parts.push(h("text", { key: "x" + i, x, y: y + 20, className: "tl-axis-label" }, mo === 0 ? String(yr) : MONTHS[mo] + " " + yr));
    }
    return h("svg", { className: "tl-axis-layer", width: "100%", height: "100%" }, parts);
  }

  // ---------- node: event = label (pill) + tiang + titik di garis; tanggal ikut berubah langsung saat digeser ----------
  function EventNode({ data, selected, xPos, dragging }) {
    const zoom = RF.useStore((st) => st.transform[2]);
    const live = dragging ? fmtDate(fracToDate(xToFrac(data.range, xPos + NODE_W / 2), "day")) : data.dateLabel;
    return h("div", { className: "tl-event" + (selected ? " is-selected" : ""), style: { "--ev": data.color || COLORS[0] } },
      h("div", { className: "tl-event-inner", style: { transform: `scale(${1 / zoom}) translateY(${DOT / 2}px)` } },
        h("div", { className: "tl-pill", title: data.title + " — " + live },
          h("span", { className: "tl-pill-title" }, data.title || "(tanpa judul)"),
          dragging ? h("span", { className: "tl-pill-date" }, live) : null),
        h("span", { className: "tl-stem", style: { height: data.stem } }),
        h("span", { className: "tl-dot" })));
  }
  const nodeTypes = { event: EventNode };

  // label yang berdekatan ditumpuk di beberapa "tingkat" supaya tidak saling menutupi
  function assignLevels(items, zoom) {
    const ends = [];
    items.slice().sort((a, b) => a.x - b.x).forEach((it) => {
      const w = Math.min(NODE_W - 8, 26 + (it.label || "").length * 6.6) / zoom, left = it.x - w / 2;
      let lvl = ends.findIndex((end) => end + 10 / zoom < left);
      if (lvl === -1) lvl = ends.length < MAX_LEVELS ? ends.length : ends.indexOf(Math.min(...ends));
      ends[lvl] = it.x + w / 2;
      it.level = lvl;
    });
  }
  function buildNodes() {
    const r = rangeOf(tl), prec = precisionNow(r), scenes = ctx.getScenes(), zoom = api ? api.getZoom() : 1;
    const items = tl.events.map((ev) => {
      const scene = scenes.find((s) => s.id === ev.sceneId);
      return { ev, x: fracToX(r, dateToFrac(ev)), label: (ev.title || "(tanpa judul)") + (scene ? "  ·  " + scene.title : "") };
    });
    assignLevels(items, zoom);
    return items.map(({ ev, x, label, level }) => {
      const stem = STEM_BASE + level * LEVEL_GAP;
      return {
        id: ev.id, type: "event", zIndex: 1, selected: ev.id === selectedId, connectable: false,
        position: { x: x - NODE_W / 2, y: -1 },   // kotak setinggi 2px yang tengahnya tepat di garis (y = 0)
        data: { title: label, color: ev.color, dateLabel: fmtDate(ev), range: r, prec, stem },
      };
    });
  }

  // ---------- tombol + di kedua ujung garis: tambah 100 tahun ----------
  function EndButtons({ range }) {
    const [tx, ty, zoom] = RF.useStore((st) => st.transform);
    const width = RF.useStore((st) => st.width);
    // ujung di luar layar -> tombol menempel di tepi kanvas (tetap bisa diklik)
    const left = Math.max(tx, 104), right = Math.min(tx + AXIS_W * zoom, width - 104);
    const btn = (side, x) => h("button", {
      key: side, type: "button", className: "tl-extend is-" + side + ((side === "start" ? tx < 104 : tx + AXIS_W * zoom > width - 104) ? " is-pinned" : ""), style: { left: x, top: ty },
      title: (side === "start" ? "Tambah 100 tahun sebelum " + range.start : "Tambah 100 tahun setelah " + range.end),
      "aria-label": side === "start" ? "Tambah 100 tahun di awal" : "Tambah 100 tahun di akhir",
      onClick: (e) => { e.stopPropagation(); extendRange(side); },
    }, h("svg", { className: "ti", width: 14, height: 14, "aria-hidden": "true", focusable: "false" }, h("use", { href: "#ti-plus" })),
      h("span", null, "100 th"));
    return h("div", { className: "tl-ends" }, btn("start", left), btn("end", right));
  }
  function extendRange(side) {
    if (!tl) return;
    const r0 = rangeOf(tl), s0 = scaleOf(r0);
    if (side === "start") tl.start = r0.start - EXTEND_YEARS; else tl.end = r0.end + EXTEND_YEARS;
    if (side === "end" && tl.start > r0.start) tl.start = r0.start;   // rentang dasar ikut event yang sudah memanjangkan garis
    if (side === "start" && tl.end < r0.end) tl.end = r0.end;
    const r1 = rangeOf(tl), s1 = scaleOf(r1);
    if (api) {   // tahun yang sedang terlihat tetap di posisi layar yang sama, lalu ujung baru digeser ke dalam layar
      const v0 = api.getViewport(), w0 = $("tlFlow").clientWidth;
      if (v0.x >= 0 && v0.x + AXIS_W * v0.zoom <= w0) { changed(); fitAxis(350); return; }   // seluruh garis tadinya terlihat -> tetap terlihat
      const v = v0, zoom = v.zoom * s0 / s1, x = v.x + (r1.start - r0.start) * s0 * v.zoom;
      api.setViewport({ x, y: v.y, zoom });
      const w = $("tlFlow").clientWidth, endX = side === "start" ? x : x + AXIS_W * zoom;
      const want = side === "start" ? Math.max(endX, 70) : Math.min(endX, w - 70);
      if (want !== endX) api.setViewport({ x: x + (want - endX), y: v.y, zoom }, { duration: 350 });
    }
    changed();
  }

  // ---------- kartu kecil event (muncul saat event diklik; mengikuti geser/zoom kanvas) ----------
  function EventCard({ ev, range }) {
    const [tx, ty, zoom] = RF.useStore((st) => st.transform);
    const width = RF.useStore((st) => st.width), height = RF.useStore((st) => st.height);
    const x = tx + fracToX(range, dateToFrac(ev)) * zoom;
    if (x < -40 || x > width + 40) return null;
    const W = Math.min(270, width - 24), cx = Math.max(12 + W / 2, Math.min(width - 12 - W / 2, x));
    const below = height - ty > 230;   // cukup ruang di bawah garis? (label event ada di atas garis)
    const tags = tagsOf(ev), scene = ev.sceneId && ctx.getScenes().find((s) => s.id === ev.sceneId);
    // ikon: #ti-calendar-event #ti-x #ti-pencil #ti-file-text (ditulis lengkap untuk tools/build-icons.mjs)
    const ic = (name, n) => h("svg", { className: "ti", width: n || 14, height: n || 14, "aria-hidden": "true", focusable: "false" }, h("use", { href: "#ti-" + name }));
    const close = () => { cardId = null; rev++; renderFlow(); };
    return h("div", {
      className: "tl-card" + (below ? " is-below" : " is-above"), role: "dialog", "aria-label": "Event " + (ev.title || ""),
      style: { left: cx, top: below ? ty + 34 : ty - 150, width: W, "--ev": ev.color || COLORS[0] },
      onPointerDown: (e) => e.stopPropagation(), onWheel: (e) => e.stopPropagation(),
      onKeyDown: (e) => { if (e.key === "Escape") close(); },
    },
      ev.image ? h("div", { className: "tl-card-img", style: { backgroundImage: `url("${ev.image}")` } }) : null,
      h("div", { className: "tl-card-body" },
        h("div", { className: "tl-card-top" },
          h("span", { className: "tl-card-date" }, ic("calendar-event", 13), fmtLong(ev)),
          h("button", { type: "button", className: "tl-card-x", title: "Tutup", "aria-label": "Tutup kartu", onClick: close }, ic("x", 14))),
        h("div", { className: "tl-card-title" }, ev.title || "(tanpa judul)"),
        ev.desc ? h("p", { className: "tl-card-desc" }, ev.desc) : h("p", { className: "tl-card-desc is-dim" }, "Belum ada deskripsi."),
        tags.length ? h("div", { className: "tl-card-tags" }, tags.map((t) => h("span", { key: t, className: "tl-card-tag" }, "#" + t))) : null,
        h("div", { className: "tl-card-acts" },
          h("button", { type: "button", className: "tl-btn tl-btn-sm", autoFocus: true, onClick: () => { selectedId = ev.id; cardId = null; fillEditor(); rev++; renderFlow(); setTimeout(() => $("tlEvTitle").focus(), 0); } }, ic("pencil"), "Edit"),
          scene ? h("button", { type: "button", className: "tl-btn tl-btn-sm", title: scene.title, onClick: () => ctx.openScene(scene.id) }, ic("file-text"), "Buka scene") : null)));
  }

  function FlowApp({ tlRev, panMode }) {
    const [nodes, setNodes, onNodesChangeBase] = useNodesState([]);
    const [ghost, setGhost] = React.useState(null);   // penanda + tooltip "klik untuk menambah"
    const lastVp = React.useRef(null);
    // saat zoom, garis tetap di ketinggian layar yang sama (kalau tidak, zoom dalam bisa "melempar" garis keluar layar)
    const onMove = (_e, v) => {
      const prev = lastVp.current;
      if (prev && v.zoom !== prev.zoom && v.y !== prev.y) {
        lastVp.current = { x: v.x, y: prev.y, zoom: v.zoom };
        api.setViewport(lastVp.current);
        return;
      }
      lastVp.current = v;
    };
    api = useReactFlow();
    React.useEffect(() => { setNodes(buildNodes()); }, [tlRev]);

    // event hanya boleh bergeser mendatar: posisi y dikunci ke garis
    const onNodesChange = (changes) => onNodesChangeBase(changes.map((c) => {
      if (c.type !== "position" || !c.position) return c;
      const n = nodes.find((x) => x.id === c.id);
      return n ? { ...c, position: { x: c.position.x, y: n.position.y }, positionAbsolute: c.positionAbsolute && { x: c.positionAbsolute.x, y: n.position.y } } : c;
    }));
    const dragFrom = React.useRef(new Map());   // posisi x saat mulai diseret (klik tanpa geser = tanggal tidak berubah)
    const onNodeDragStart = (_e, node, dragged) => {
      if (node.type !== "event") return;
      dragFrom.current = new Map((dragged || [node]).map((n) => [n.id, n.position.x]));
      if (node.id !== selectedId) { selectedId = node.id; if (editorOpen()) fillEditor(); }
      if (cardId) { cardId = null; renderFlow(); }
      setGhost(null);
    };
    const onNodeDragStop = (_e, node, dragged) => {
      const r = rangeOf(tl);
      let moved = false;
      (dragged || [node]).forEach((n) => {
        const ev = findEvent(n.id); if (!ev) return;
        const x0 = dragFrom.current.get(n.id);
        if (x0 != null && Math.abs(x0 - n.position.x) < 1e-9) return;
        moved = true;
        Object.assign(ev, fracToDate(xToFrac(r, n.position.x + NODE_W / 2), "day"));
      });
      if (!moved) return;
      if (selectedId && editorOpen()) fillEditor();
      changed();   // garis memanjang otomatis bila event digeser keluar rentang
    };
    const onNodesDelete = (del) => {
      const ids = new Set(del.map((n) => n.id));
      tl.events = tl.events.filter((e) => !ids.has(e.id));
      if (ids.has(selectedId)) { selectedId = null; hideEditor(); }
      if (ids.has(cardId)) cardId = null;
      changed();
    };
    // klik event -> kartu kecil (panel edit yang terbuka ikut pindah ke event ini)
    const onNodeClick = (_e, node) => {
      if (node.type !== "event") return;
      selectedId = node.id;
      if (editorOpen()) { cardId = null; fillEditor(); }
      else cardId = cardId === node.id ? null : node.id;
      rev++; renderFlow();
    };

    // posisi kursor -> tanggal di garis (null bila kursor tidak dekat garis)
    const hoverAt = (e) => {
      const wrap = $("tlFlow").getBoundingClientRect();
      const p = api.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const axisY = api.flowToScreenPosition({ x: p.x, y: 0 }).y;
      if (Math.abs(e.clientY - axisY) > HOVER_BAND) return null;
      const r = rangeOf(tl), date = fracToDate(xToFrac(r, p.x), "day");   // selalu tanggal lengkap
      const left = e.clientX - wrap.left;
      const edge = left < 130 ? " at-left" : left > wrap.width - 130 ? " at-right" : "";   // tooltip tidak terpotong di tepi
      return { left, top: axisY - wrap.top, date, edge };
    };
    const onPaneMouseMove = (e) => setGhost(hoverAt(e));
    const onPaneClick = (e) => {
      const g = hoverAt(e);
      if (g) { addEventAt(g.date); setGhost(null); return; }
      if (selectedId || cardId) { selectedId = null; cardId = null; hideEditor(); rev++; renderFlow(); }
    };

    return h(Flow, {
      nodes, edges: [], nodeTypes, onNodesChange, onNodeDragStart, onNodeDragStop, onNodesDelete, onNodeClick,
      onPaneMouseMove, onPaneMouseLeave: () => setGhost(null), onPaneClick, onMoveEnd: () => setNodes(buildNodes()),
      onInit: (inst) => { api = inst; fitAxis(); setNodes(buildNodes()); }, onMove,
      panOnDrag: panMode ? true : [1, 2], selectionOnDrag: !panMode, panOnScroll: false, zoomOnDoubleClick: false,
      nodesConnectable: false, minZoom: 0.05, maxZoom: 1000,
      deleteKeyCode: ["Backspace", "Delete"], attributionPosition: "bottom-left",
      className: ghost ? "is-adding" : "",
    },
      h(AxisLayer, { range: rangeOf(tl) }),
      h(EndButtons, { range: rangeOf(tl) }),
      cardId && findEvent(cardId) ? h(EventCard, { ev: findEvent(cardId), range: rangeOf(tl) }) : null,
      h(Controls, { showInteractive: false, showFitView: false, position: "bottom-right", className: "tl-controls" }),
      ghost ? h("div", { className: "tl-ghost", style: { left: ghost.left, top: ghost.top } },
        h("span", { className: "tl-ghost-tip" + ghost.edge }, h("b", null, fmtLong(ghost.date)), " · klik untuk menambah"),
        h("span", { className: "tl-ghost-plus" },
          h("svg", { className: "ti", width: 12, height: 12, "aria-hidden": "true", focusable: "false" }, h("use", { href: "#ti-plus" })))) : null);
  }

  function renderFlow() {
    const box = $("tlFlow");
    if (!tl) { if (root) { root.unmount(); root = null; } box.innerHTML = ""; return; }
    if (!root) { box.innerHTML = ""; root = ReactDOM.createRoot(box); }
    root.render(h(ReactFlowProvider, null, h(FlowApp, { key: tl.id, tlRev: rev, panMode: mode === "pan" })));
  }

  // ---------- sidebar daftar timeline + header ----------
  function renderList() {
    const q = $("tlSearch").value.trim().toLowerCase();
    const list = $("tlList");
    list.innerHTML = "";
    const items = timelines().filter((t) => !q || (t.title || "").toLowerCase().includes(q));
    if (!items.length) {
      const empty = document.createElement("p");
      empty.className = "tl-empty";
      empty.textContent = timelines().length ? "Tidak ada yang cocok." : "Belum ada timeline.";
      list.appendChild(empty);
    }
    items.forEach((t) => {
      const b = document.createElement("button");
      b.className = "tl-item" + (tl && t.id === tl.id ? " is-current" : "");
      b.innerHTML = '<svg class="ti" width="14" height="14" aria-hidden="true" focusable="false"><use href="#ti-timeline"></use></svg><span></span>';
      b.querySelector("span").textContent = t.title || "(tanpa nama)";
      b.onclick = () => openTimeline(t.id);
      list.appendChild(b);
    });
  }
  function renderHead() {
    const main = document.querySelector("#tabTimeline .tl-main");
    main.classList.toggle("is-empty", !tl);
    if (!tl) return;
    if (document.activeElement !== $("tlTitle")) $("tlTitle").value = tl.title || "";
    const r = rangeOf(tl);
    $("tlRangeText").textContent = `${r.start} – ${r.end} · ${tl.events.length} event`;
  }
  // dropdown judul: ganti timeline / buat baru
  function renderMenu() {
    const m = $("tlMenu");
    m.innerHTML = '<div class="tl-menu-list">' + timelines().map((t) => `<button type="button" role="menuitemradio" class="tl-menu-item${tl && t.id === tl.id ? " is-current" : ""}" aria-checked="${!!(tl && t.id === tl.id)}" data-id="${esc(t.id)}">` +
      `<svg class="ti" width="15" height="15" aria-hidden="true" focusable="false"><use href="#ti-timeline"></use></svg><span>${esc(t.title || "(tanpa nama)")}</span><small>${(t.events || []).length}</small>` +
      (tl && t.id === tl.id ? '<svg class="ti tl-menu-check" width="15" height="15" aria-hidden="true" focusable="false"><use href="#ti-check"></use></svg>' : "") + "</button>").join("") + "</div>" +
      '<div class="tl-menu-sep"></div><button type="button" role="menuitem" class="tl-menu-item" data-act="new"><svg class="ti" width="15" height="15" aria-hidden="true" focusable="false"><use href="#ti-plus"></use></svg><span>Timeline baru</span></button>';
  }
  function menuKey(e) {
    if (e.key === "Escape") { closeMenu(); $("tlTitleMenu").focus(); return; }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const items = Array.from($("tlMenu").querySelectorAll(".tl-menu-item"));
    if (!items.length) return;
    e.preventDefault();
    const i = items.indexOf(document.activeElement);
    items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length].focus();
  }
  function menuOutside(e) { if (!e.target.closest(".tl-title-wrap")) closeMenu(); }
  function openMenu() {
    renderMenu();
    $("tlMenu").classList.remove("hidden");
    $("tlTitleMenu").setAttribute("aria-expanded", "true");
    document.addEventListener("pointerdown", menuOutside, true);
    document.addEventListener("keydown", menuKey, true);
    const cur = $("tlMenu").querySelector(".is-current") || $("tlMenu").querySelector(".tl-menu-item");
    if (cur) cur.focus();
  }
  function closeMenu() {
    $("tlMenu").classList.add("hidden");
    $("tlTitleMenu").setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", menuOutside, true);
    document.removeEventListener("keydown", menuKey, true);
  }
  function applySide() {
    const tab = $("tabTimeline");
    tab.classList.toggle("tl-side-closed", !sideOpen);
    const b = $("tlSideToggle"), label = sideOpen ? "Tutup daftar timeline" : "Buka daftar timeline";
    b.title = label; b.setAttribute("aria-label", label); b.setAttribute("aria-expanded", String(sideOpen));
    b.querySelector("use").setAttribute("href", sideOpen ? "#ti-layout-sidebar-left-collapse" : "#ti-layout-sidebar-left-expand");
  }
  function openTimeline(id) {
    tl = timelines().find((t) => t.id === id) || null;
    selectedId = null; cardId = null; hideEditor();
    rev++;
    renderList(); renderHead(); renderFlow();
    if (tl && ctx.onOpen) ctx.onOpen(tl.id);   // app.js: riwayat sidebar tab
  }

  // ---------- event: tambah & panel edit ----------
  function addEventAt(date) {
    const ev = { id: uid("ev"), title: "Event baru", year: date.year, month: date.month || null, day: date.day || null, desc: "", color: COLORS[0], sceneId: "" };
    tl.events.push(ev);
    selectedId = ev.id; cardId = null;
    fillEditor();
    changed();
    setTimeout(() => { $("tlEvTitle").focus(); $("tlEvTitle").select(); }, 0);
  }
  function addEventAtCenter() {
    if (!tl) return;
    const r = rangeOf(tl), box = $("tlFlow").getBoundingClientRect();
    let f = (r.start + r.end) / 2;
    if (api) f = xToFrac(r, api.screenToFlowPosition({ x: box.left + box.width / 2, y: box.top + box.height / 2 }).x);
    addEventAt(fracToDate(f, "day"));
  }
  function fillEditor() {
    const ev = findEvent(selectedId);
    if (!ev) return hideEditor();
    $("tlEvTitle").value = ev.title || "";
    $("tlEvYear").value = ev.year;
    $("tlEvMonth").value = ev.month || "";
    $("tlEvDay").value = ev.day || "";
    $("tlEvDay").disabled = !ev.month;
    $("tlEvDesc").value = ev.desc || "";
    $("tlEvTags").value = tagsOf(ev).join(", ");
    const img = $("tlEvImg");
    img.classList.toggle("has-img", !!ev.image);
    img.style.backgroundImage = ev.image ? `url("${ev.image}")` : "";
    $("tlEvImgDel").hidden = !ev.image;
    const sel = $("tlEvScene");
    sel.innerHTML = '<option value="">— tidak ada —</option>';
    ctx.getScenes().forEach((s) => { const o = document.createElement("option"); o.value = s.id; o.textContent = s.title || "(tanpa judul)"; sel.appendChild(o); });
    sel.value = ev.sceneId || "";
    $("tlEvOpenScene").disabled = !ev.sceneId;
    $("tlEvColors").querySelectorAll("button").forEach((b) => b.classList.toggle("is-on", b.dataset.color === (ev.color || COLORS[0])));
    $("tlEditor").classList.remove("hidden");
  }
  function hideEditor() { $("tlEditor").classList.add("hidden"); }
  const editorOpen = () => !$("tlEditor").classList.contains("hidden");
  // gambar event: diperkecil (<= 640 px) -> WebP (cadangan JPEG) supaya file project tetap ringan
  function readImage(file) {
    return new Promise((resolve, reject) => {
      if (!file || !/^image\//.test(file.type || "")) { reject(new Error("File ini bukan gambar.")); return; }
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => {
        try {
          const k = Math.min(1, IMG_PX / img.naturalWidth, IMG_PX / img.naturalHeight);
          const w = Math.max(1, Math.round(img.naturalWidth * k)), hh = Math.max(1, Math.round(img.naturalHeight * k));
          const cv = document.createElement("canvas");
          cv.width = w; cv.height = hh;
          cv.getContext("2d").drawImage(img, 0, 0, w, hh);
          let out = cv.toDataURL("image/webp", 0.8);
          if (!/^data:image\/webp/.test(out)) {
            const cj = document.createElement("canvas"), g = cj.getContext("2d");
            cj.width = w; cj.height = hh; g.fillStyle = "#fff"; g.fillRect(0, 0, w, hh); g.drawImage(cv, 0, 0);
            out = cj.toDataURL("image/jpeg", 0.82);
          }
          if (out.length > MAX_IMG) { reject(new Error("Gambar terlalu besar.")); return; }
          resolve(out);
        } catch (e) { reject(e); } finally { URL.revokeObjectURL(url); }
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Gambar tidak bisa dibaca.")); };
      img.src = url;
    });
  }
  function setImage(file) {
    const id = selectedId;
    readImage(file).then((src) => {
      const ev = tl && tl.events.find((e) => e.id === id);
      if (!ev) return;
      ev.image = src;
      if (selectedId === id) fillEditor();
      changed();
    }).catch((e) => { if (typeof toast === "function") toast(e.message || "Gambar gagal dipasang", tiIcon("alert-triangle")); });
  }
  // baca ulang tahun/bulan/tanggal dari form (tanggal dibatasi sesuai jumlah hari bulan itu)
  function readDateFields(ev) {
    const y = parseInt($("tlEvYear").value, 10);
    if (!Number.isNaN(y)) ev.year = y;
    const m = parseInt($("tlEvMonth").value, 10);
    ev.month = m >= 1 && m <= 12 ? m : null;
    const d = parseInt($("tlEvDay").value, 10);
    ev.day = ev.month && d >= 1 ? Math.min(d, MDAYS[ev.month - 1]) : null;
    fillEditor();
  }

  function bindOnce() {
    if (bound) return; bound = true;
    $("tlSearch").addEventListener("input", renderList);
    $("tlNew").onclick = () => {
      const t = { id: uid("tl"), title: "Timeline Baru", start: 1500, end: 1900, events: [] };
      timelines().push(t); ctx.onChange(); openTimeline(t.id);
      setTimeout(() => { $("tlTitle").focus(); $("tlTitle").select(); }, 0);
    };
    $("tlCreateFirst").onclick = () => $("tlNew").click();
    $("tlTitle").addEventListener("input", () => { if (!tl) return; tl.title = $("tlTitle").value; renderList(); ctx.onChange(); });
    $("tlDelete").onclick = () => {
      if (!tl || !confirm(`Hapus timeline "${tl.title || "(tanpa nama)"}"?`)) return;
      ctx.project.data.timelines = timelines().filter((t) => t.id !== tl.id);
      ctx.onChange();
      const first = timelines()[0];
      if (first) openTimeline(first.id); else { tl = null; hideEditor(); renderList(); renderHead(); renderFlow(); }
    };

    const setMode = (m) => { mode = m; $("tlModePan").classList.toggle("is-active", m === "pan"); $("tlModeSelect").classList.toggle("is-active", m === "select"); renderFlow(); };
    $("tlModePan").onclick = () => setMode("pan");
    $("tlModeSelect").onclick = () => setMode("select");
    $("tlAddEvent").onclick = addEventAtCenter;
    $("tlFit").onclick = () => fitAxis(400);

    $("tlEvMonth").innerHTML = '<option value="">—</option>' + MONTHS.map((m, i) => `<option value="${i + 1}">${m}</option>`).join("");
    const colors = $("tlEvColors");
    COLORS.forEach((c) => {
      const b = document.createElement("button");
      b.className = "tl-color"; b.dataset.color = c; b.style.background = c; b.title = c; b.setAttribute("aria-label", "Warna " + c);
      b.onclick = () => { const ev = findEvent(selectedId); if (!ev) return; ev.color = c; fillEditor(); changed(); };
      colors.appendChild(b);
    });
    const edit = (fn) => () => { const ev = findEvent(selectedId); if (!ev) return; fn(ev); changed(); };
    $("tlEvTitle").addEventListener("input", edit((ev) => { ev.title = $("tlEvTitle").value; }));
    ["tlEvYear", "tlEvMonth", "tlEvDay"].forEach((id) => $(id).addEventListener("change", edit(readDateFields)));
    $("tlEvDesc").addEventListener("input", () => { const ev = findEvent(selectedId); if (ev) { ev.desc = $("tlEvDesc").value; ctx.onChange(); } });
    $("tlEvTags").addEventListener("input", () => {
      const ev = findEvent(selectedId); if (!ev) return;
      const seen = new Set(), t = $("tlEvTags").value.split(",").map((x) => x.replace(/^#+/, "").replace(/\s+/g, " ").trim().slice(0, 40))
        .filter((x) => x && !seen.has(x.toLowerCase()) && seen.add(x.toLowerCase()));
      if (t.length) ev.tags = t; else delete ev.tags;
      ctx.onChange();
    });
    const imgBox = $("tlEvImg"), imgFile = $("tlEvImgFile");
    imgBox.onclick = () => imgFile.click();
    imgBox.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); imgFile.click(); } };
    imgBox.addEventListener("dragover", (e) => { if (Array.from(e.dataTransfer.types || []).includes("Files")) { e.preventDefault(); imgBox.classList.add("is-over"); } });
    imgBox.addEventListener("dragleave", () => imgBox.classList.remove("is-over"));
    imgBox.addEventListener("drop", (e) => { e.preventDefault(); imgBox.classList.remove("is-over"); const f = e.dataTransfer.files && e.dataTransfer.files[0]; if (f) setImage(f); });
    imgFile.onchange = () => { const f = imgFile.files && imgFile.files[0]; imgFile.value = ""; if (f) setImage(f); };
    $("tlEvImgDel").onclick = edit((ev) => { delete ev.image; fillEditor(); });
    // sidebar & dropdown judul
    $("tlSideToggle").onclick = () => {
      sideOpen = !sideOpen;
      try { localStorage.setItem("novelist_tlside", sideOpen ? "1" : "0"); } catch (e) { /* abaikan */ }
      applySide();
      setTimeout(() => { if (tl) { rev++; renderFlow(); } }, 0);
    };
    $("tlTitleMenu").onclick = () => ($("tlMenu").classList.contains("hidden") ? openMenu() : closeMenu());
    $("tlMenu").addEventListener("click", (e) => {
      const b = e.target.closest(".tl-menu-item");
      if (!b) return;
      closeMenu();
      if (b.dataset.act === "new") $("tlNew").click();
      else if (!tl || b.dataset.id !== tl.id) openTimeline(b.dataset.id);
    });
    $("tlEvScene").addEventListener("change", edit((ev) => { ev.sceneId = $("tlEvScene").value; $("tlEvOpenScene").disabled = !ev.sceneId; }));
    $("tlEvOpenScene").onclick = () => { const ev = findEvent(selectedId); if (ev && ev.sceneId) ctx.openScene(ev.sceneId); };
    $("tlEvDelete").onclick = () => {
      const ev = findEvent(selectedId); if (!ev) return;
      tl.events = tl.events.filter((e) => e.id !== ev.id);
      selectedId = null; cardId = null; hideEditor(); changed();
    };
    $("tlEditorClose").onclick = () => { selectedId = null; hideEditor(); rev++; renderFlow(); };
    applySide();
  }

  window.NovelTimeline = {
    // dipanggil setiap kali tab Timeline dibuka
    show(c) {
      const sameProject = ctx && ctx.project === c.project;
      ctx = c;
      bindOnce();
      if (!sameProject) $("tlSearch").value = "";
      // dicocokkan lewat id: data project bisa diganti (versi dari perangkat lain / backup) -> objek timeline-nya baru
      const keep = sameProject && tl && timelines().some((t) => t.id === tl.id) ? tl.id : (timelines()[0] || {}).id;
      if (keep) openTimeline(keep);
      else { tl = null; selectedId = null; cardId = null; hideEditor(); renderList(); renderHead(); renderFlow(); }
    },
    // buka timeline tertentu (mis. dari riwayat sidebar tab); dipanggil setelah show()
    open(id) {
      if (!ctx || !timelines().some((t) => t.id === id) || (tl && tl.id === id)) return;
      $("tlSearch").value = "";
      openTimeline(id);
    },
  };
})();
