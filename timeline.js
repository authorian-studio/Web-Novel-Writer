// ================= TIMELINE (React Flow) =================
// Dimuat lazy oleh app.js (ensureTimelineLib) saat tab Timeline pertama kali dibuka, setelah React, ReactDOM &
// React Flow (folder vendor/). Data disimpan di project: p.data.timelines = [{ id, title, start, end, events }]
//   start/end = rentang dasar garis waktu (default 1500–1900, TIDAK bisa diubah pengguna)
//   event     = { id, title, year, month, day, desc, color, sceneId }  (month/day boleh kosong)
// Aturan garis waktu (ala vvd):
//   - garisnya selalu satu garis horizontal; event menempel di garis itu (hanya bisa digeser kiri/kanan)
//   - arahkan kursor ke garis -> muncul tanggal + "klik untuk menambah"; bisa juga di luar ujung garis
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
  const MDAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const CUM = MDAYS.reduce((a, d, i) => (a.push(i ? a[i - 1] + MDAYS[i - 1] : 0), a), []);

  let ctx = null;               // { project, onChange, getScenes, openScene }
  let tl = null;                // timeline yang sedang dibuka
  let selectedId = null;        // event yang sedang dipilih
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
    const year = Math.floor(f), doy = Math.min(364, Math.floor((f - year) * 365));
    let m = 0; while (m < 11 && CUM[m + 1] <= doy) m++;
    return prec === "month" ? { year, month: m + 1, day: null } : { year, month: m + 1, day: doy - CUM[m] + 1 };
  }
  const fmtDate = (d) => (d.month ? (d.day ? d.day + " " : "") + MONTHS[d.month - 1] + " " : "") + d.year;
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
    const live = dragging ? fmtDate(fracToDate(xToFrac(data.range, xPos + NODE_W / 2), data.prec)) : data.dateLabel;
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
    const onNodeDragStart = (_e, node) => {
      if (node.type !== "event") return;
      if (node.id !== selectedId) { selectedId = node.id; fillEditor(); }
      setGhost(null);
    };
    const onNodeDragStop = (_e, node, dragged) => {
      const r = rangeOf(tl), prec = precisionNow(r);
      (dragged || [node]).forEach((n) => {
        const ev = findEvent(n.id); if (!ev) return;
        Object.assign(ev, fracToDate(xToFrac(r, n.position.x + NODE_W / 2), prec));
      });
      if (selectedId) fillEditor();
      changed();   // garis memanjang otomatis bila event digeser keluar rentang
    };
    const onNodesDelete = (del) => {
      const ids = new Set(del.map((n) => n.id));
      tl.events = tl.events.filter((e) => !ids.has(e.id));
      if (ids.has(selectedId)) { selectedId = null; hideEditor(); }
      changed();
    };
    const onNodeClick = (_e, node) => { if (node.type === "event" && node.id !== selectedId) { selectedId = node.id; fillEditor(); } };

    // posisi kursor -> tanggal di garis (null bila kursor tidak dekat garis)
    const hoverAt = (e) => {
      const wrap = $("tlFlow").getBoundingClientRect();
      const p = api.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const axisY = api.flowToScreenPosition({ x: p.x, y: 0 }).y;
      if (Math.abs(e.clientY - axisY) > HOVER_BAND) return null;
      const r = rangeOf(tl), date = fracToDate(xToFrac(r, p.x), precisionNow(r));
      const left = e.clientX - wrap.left;
      const edge = left < 130 ? " at-left" : left > wrap.width - 130 ? " at-right" : "";   // tooltip tidak terpotong di tepi
      return { left, top: axisY - wrap.top, date, edge };
    };
    const onPaneMouseMove = (e) => setGhost(hoverAt(e));
    const onPaneClick = (e) => {
      const g = hoverAt(e);
      if (g) { addEventAt(g.date); setGhost(null); return; }
      if (selectedId) { selectedId = null; hideEditor(); rev++; renderFlow(); }
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
      h(Controls, { showInteractive: false, showFitView: false, position: "bottom-right", className: "tl-controls" }),
      ghost ? h("div", { className: "tl-ghost", style: { left: ghost.left, top: ghost.top } },
        h("span", { className: "tl-ghost-tip" + ghost.edge }, h("b", null, fmtDate(ghost.date)), " · klik untuk menambah"),
        h("span", { className: "tl-ghost-plus" }, "+")) : null);
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
      b.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="12" x2="21" y2="12"/><path d="M7 9v6M16 7v10"/></svg><span></span>';
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
  function openTimeline(id) {
    tl = timelines().find((t) => t.id === id) || null;
    selectedId = null; hideEditor();
    rev++;
    renderList(); renderHead(); renderFlow();
  }

  // ---------- event: tambah & panel edit ----------
  function addEventAt(date) {
    const ev = { id: uid("ev"), title: "Event baru", year: date.year, month: date.month || null, day: date.day || null, desc: "", color: COLORS[0], sceneId: "" };
    tl.events.push(ev);
    selectedId = ev.id;
    fillEditor();
    changed();
    setTimeout(() => { $("tlEvTitle").focus(); $("tlEvTitle").select(); }, 0);
  }
  function addEventAtCenter() {
    if (!tl) return;
    const r = rangeOf(tl), box = $("tlFlow").getBoundingClientRect();
    let f = (r.start + r.end) / 2;
    if (api) f = xToFrac(r, api.screenToFlowPosition({ x: box.left + box.width / 2, y: box.top + box.height / 2 }).x);
    addEventAt(fracToDate(f, precisionNow(r)));
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
    const sel = $("tlEvScene");
    sel.innerHTML = '<option value="">— tidak ada —</option>';
    ctx.getScenes().forEach((s) => { const o = document.createElement("option"); o.value = s.id; o.textContent = s.title || "(tanpa judul)"; sel.appendChild(o); });
    sel.value = ev.sceneId || "";
    $("tlEvOpenScene").disabled = !ev.sceneId;
    $("tlEvColors").querySelectorAll("button").forEach((b) => b.classList.toggle("is-on", b.dataset.color === (ev.color || COLORS[0])));
    $("tlEditor").classList.remove("hidden");
  }
  function hideEditor() { $("tlEditor").classList.add("hidden"); }
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
    $("tlEvScene").addEventListener("change", edit((ev) => { ev.sceneId = $("tlEvScene").value; $("tlEvOpenScene").disabled = !ev.sceneId; }));
    $("tlEvOpenScene").onclick = () => { const ev = findEvent(selectedId); if (ev && ev.sceneId) ctx.openScene(ev.sceneId); };
    $("tlEvDelete").onclick = () => {
      const ev = findEvent(selectedId); if (!ev) return;
      tl.events = tl.events.filter((e) => e.id !== ev.id);
      selectedId = null; hideEditor(); changed();
    };
    $("tlEditorClose").onclick = () => { selectedId = null; hideEditor(); rev++; renderFlow(); };
  }

  window.NovelTimeline = {
    // dipanggil setiap kali tab Timeline dibuka
    show(c) {
      const sameProject = ctx && ctx.project === c.project;
      ctx = c;
      bindOnce();
      if (!sameProject) $("tlSearch").value = "";
      const keep = sameProject && tl && timelines().includes(tl) ? tl.id : (timelines()[0] || {}).id;
      if (keep) openTimeline(keep);
      else { tl = null; selectedId = null; hideEditor(); renderList(); renderHead(); renderFlow(); }
    },
  };
})();
