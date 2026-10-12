// ================= TIMELINE (React Flow) =================
// Dimuat lazy oleh app.js (ensureTimelineLib) saat tab Timeline pertama kali dibuka, setelah React, ReactDOM &
// React Flow (folder vendor/). Data disimpan di project: p.data.timelines = [{ id, title, start, end, events, links }]
//   event = { id, title, year, y, desc, color, sceneId }   -> x di kanvas dihitung dari tahun, y = posisi vertikal bebas
//   link  = { id, source, target }                          -> garis sambung antar event (sebab-akibat, dll.)
// React hanya menggambar kanvas; sidebar daftar timeline, header & panel edit event memakai DOM biasa.
(function () {
  const h = React.createElement;
  const RF = window.ReactFlow;
  const { ReactFlowProvider, Controls, Handle, Position, useNodesState, useEdgesState, useReactFlow, MarkerType } = RF;
  const Flow = RF.default || RF.ReactFlow;

  const AXIS_W = 1600;          // panjang sumbu tahun di kanvas (px, sebelum zoom)
  const AXIS_LINE_Y = 14;       // posisi garis sumbu di dalam node sumbu
  const CARD_W = 172, CARD_H = 54;
  const COLORS = ["#e8e8ec", "#d7a86e", "#4caf82", "#6aa8ff", "#c77dff", "#e15c5c"];

  let ctx = null;               // { project, onChange, getScenes, openScene }
  let tl = null;                // timeline yang sedang dibuka
  let selectedId = null;        // event yang sedang dipilih
  let rev = 0;                  // dinaikkan tiap data berubah dari luar kanvas -> node dibangun ulang
  let mode = "pan";
  let api = null;               // instance React Flow (fitView, screenToFlowPosition)
  let root = null;
  let bound = false;
  const $ = (id) => document.getElementById(id);

  const uid = (p) => p + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const timelines = () => { const d = ctx.project.data; if (!Array.isArray(d.timelines)) d.timelines = []; return d.timelines; };
  const scaleOf = (t) => AXIS_W / Math.max(1, t.end - t.start);
  const yearToX = (t, year) => (year - t.start) * scaleOf(t);
  const xToYear = (t, x) => Math.round(t.start + x / scaleOf(t));
  function niceStep(span) {   // jarak label tahun supaya sekitar 8 label di sepanjang sumbu
    const raw = span / 8, p = Math.pow(10, Math.floor(Math.log10(raw)));
    for (const m of [1, 2, 5, 10]) if (m * p >= raw) return Math.max(1, m * p);
    return 10 * p;
  }
  function changed() { rev++; renderFlow(); ctx.onChange(); }
  const findEvent = (id) => tl && tl.events.find((e) => e.id === id);

  // ---------- node: sumbu tahun ----------
  function AxisNode({ data }) {
    const { start, end } = data, span = Math.max(1, end - start), sc = AXIS_W / span;
    const step = niceStep(span), minor = step >= 5 ? step / 5 : 0;
    const parts = [h("line", { key: "l", x1: 0, y1: AXIS_LINE_Y, x2: AXIS_W, y2: AXIS_LINE_Y, className: "tl-axis-line" }),
      h("circle", { key: "a", cx: 0, cy: AXIS_LINE_Y, r: 3.5, className: "tl-axis-end" }),
      h("circle", { key: "b", cx: AXIS_W, cy: AXIS_LINE_Y, r: 3.5, className: "tl-axis-end" })];
    if (minor >= 1) for (let y = Math.ceil(start / minor) * minor; y <= end; y += minor) {
      if (y % step === 0) continue;
      const x = (y - start) * sc;
      parts.push(h("line", { key: "m" + y, x1: x, y1: AXIS_LINE_Y - 2, x2: x, y2: AXIS_LINE_Y + 2, className: "tl-axis-tick minor" }));
    }
    for (let y = Math.ceil(start / step) * step; y <= end; y += step) {
      const x = (y - start) * sc;
      parts.push(h("line", { key: "t" + y, x1: x, y1: AXIS_LINE_Y - 4, x2: x, y2: AXIS_LINE_Y + 4, className: "tl-axis-tick" }));
      parts.push(h("text", { key: "x" + y, x, y: AXIS_LINE_Y + 20, className: "tl-axis-label" }, String(y)));
    }
    return h("svg", { className: "tl-axis", width: AXIS_W, height: AXIS_LINE_Y + 28, style: { overflow: "visible" } }, parts);
  }

  // ---------- node: event (kartu kecil + tiang ke sumbu); tahun ikut berubah langsung saat digeser ----------
  function EventNode({ data, selected, xPos, yPos }) {
    const t = data.tl, cy = yPos + CARD_H / 2, year = xToYear(t, xPos + CARD_W / 2);
    const stem = Math.max(0, Math.abs(cy) - CARD_H / 2);
    return h("div", { className: "tl-event" + (selected ? " is-selected" : ""), style: { "--ev": data.color || COLORS[0] } },
      h(Handle, { type: "target", position: Position.Left, className: "tl-handle" }),
      h(Handle, { type: "source", position: Position.Right, className: "tl-handle" }),
      stem > 0 ? h("span", { className: "tl-stem " + (cy < 0 ? "down" : "up"), style: { height: stem } }) : null,
      h("span", { className: "tl-event-meta" }, h("b", null, String(year)), data.sceneTitle ? h("span", null, "· " + data.sceneTitle) : null),
      h("span", { className: "tl-event-title" }, data.title || "(tanpa judul)"));
  }
  const nodeTypes = { axis: AxisNode, event: EventNode };

  function buildNodes() {
    const scenes = ctx.getScenes();
    const axis = { id: "__axis", type: "axis", position: { x: 0, y: -AXIS_LINE_Y }, data: { start: tl.start, end: tl.end },
      draggable: false, selectable: false, connectable: false, deletable: false, zIndex: 0 };
    return [axis].concat(tl.events.map((ev) => ({
      id: ev.id, type: "event", zIndex: 1, selected: ev.id === selectedId,
      position: { x: yearToX(tl, ev.year) - CARD_W / 2, y: ev.y - CARD_H / 2 },
      data: { tl, title: ev.title, color: ev.color, sceneTitle: (scenes.find((s) => s.id === ev.sceneId) || {}).title },
    })));
  }
  const buildEdges = () => (tl.links || []).map((l) => ({ id: l.id, source: l.source, target: l.target, type: "smoothstep", className: "tl-link", markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 } }));

  function FlowApp({ tlRev, panMode }) {
    const [nodes, setNodes, onNodesChange] = useNodesState([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState([]);
    api = useReactFlow();
    React.useEffect(() => { setNodes(buildNodes()); setEdges(buildEdges()); }, [tlRev]);

    const onNodeDragStop = (_e, _node, dragged) => {
      (dragged || [_node]).forEach((n) => {
        const ev = findEvent(n.id); if (!ev) return;
        ev.year = xToYear(tl, n.position.x + CARD_W / 2);
        ev.y = Math.round(n.position.y + CARD_H / 2);
      });
      if (selectedId) fillEditor();
      changed();   // posisi x dirapikan tepat ke tahunnya
    };
    const onConnect = (c) => {
      if (!c.source || !c.target || c.source === c.target) return;
      if ((tl.links || []).some((l) => l.source === c.source && l.target === c.target)) return;
      (tl.links = tl.links || []).push({ id: uid("lk"), source: c.source, target: c.target });
      changed();
    };
    const onNodesDelete = (del) => {
      const ids = new Set(del.map((n) => n.id));
      tl.events = tl.events.filter((e) => !ids.has(e.id));
      tl.links = (tl.links || []).filter((l) => !ids.has(l.source) && !ids.has(l.target));
      if (ids.has(selectedId)) { selectedId = null; hideEditor(); }
      changed();
    };
    const onEdgesDelete = (del) => {
      const ids = new Set(del.map((e) => e.id));
      tl.links = (tl.links || []).filter((l) => !ids.has(l.id));
      changed();
    };
    // pilih event = klik / mulai geser node; klik area kosong = batal pilih
    const selectEvent = (_e, node) => {
      if (node.type !== "event" || node.id === selectedId) return;
      selectedId = node.id; fillEditor();
    };
    const onPaneClick = () => { if (!selectedId) return; selectedId = null; hideEditor(); };

    return h(Flow, {
      nodes, edges, nodeTypes, onNodesChange, onEdgesChange, onNodeDragStop, onConnect, onNodesDelete, onEdgesDelete, onPaneClick,
      onNodeClick: selectEvent, onNodeDragStart: selectEvent,
      panOnDrag: panMode ? true : [1, 2], selectionOnDrag: !panMode, panOnScroll: false, zoomOnDoubleClick: false,
      fitView: true, fitViewOptions: { padding: 0.25 }, minZoom: 0.1, maxZoom: 2.5, deleteKeyCode: ["Backspace", "Delete"],
      attributionPosition: "bottom-left",
    }, h(Controls, { showInteractive: false, position: "bottom-right", className: "tl-controls" }));
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
    $("tlTitle").value = tl.title || "";
    $("tlStart").value = tl.start;
    $("tlEnd").value = tl.end;
  }
  function openTimeline(id) {
    tl = timelines().find((t) => t.id === id) || null;
    selectedId = null; hideEditor();
    rev++;
    renderList(); renderHead(); renderFlow();
  }

  // ---------- panel edit event ----------
  function fillEditor() {
    const ev = findEvent(selectedId);
    if (!ev) return hideEditor();
    $("tlEvTitle").value = ev.title || "";
    $("tlEvYear").value = ev.year;
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

  function addEvent() {
    if (!tl) return;
    let year = Math.round((tl.start + tl.end) / 2), y = -110;
    const box = $("tlFlow").getBoundingClientRect();
    if (api && api.screenToFlowPosition) {   // taruh di tengah layar yang sedang dilihat
      const p = api.screenToFlowPosition({ x: box.left + box.width / 2, y: box.top + box.height / 2 });
      year = Math.min(tl.end, Math.max(tl.start, xToYear(tl, p.x)));
      if (Math.abs(p.y) > 70) y = Math.round(p.y);
    }
    const near = tl.events.filter((e) => Math.abs(yearToX(tl, e.year) - yearToX(tl, year)) < CARD_W && Math.abs(e.y - y) < CARD_H + 10).length;
    const ev = { id: uid("ev"), title: "Event baru", year, y: y + near * (CARD_H + 16) * Math.sign(y || -1), desc: "", color: COLORS[0], sceneId: "" };
    tl.events.push(ev);
    selectedId = ev.id;
    fillEditor();
    changed();
    setTimeout(() => { $("tlEvTitle").focus(); $("tlEvTitle").select(); }, 0);
  }

  function bindOnce() {
    if (bound) return; bound = true;
    $("tlSearch").addEventListener("input", renderList);
    $("tlNew").onclick = () => {
      const t = { id: uid("tl"), title: "Timeline Baru", start: 1500, end: 1900, events: [], links: [] };
      timelines().push(t); ctx.onChange(); openTimeline(t.id);
      setTimeout(() => { $("tlTitle").focus(); $("tlTitle").select(); }, 0);
    };
    $("tlCreateFirst").onclick = () => $("tlNew").click();
    $("tlTitle").addEventListener("input", () => { if (!tl) return; tl.title = $("tlTitle").value; renderList(); ctx.onChange(); });
    const onRange = () => {
      if (!tl) return;
      const s = parseInt($("tlStart").value, 10), e = parseInt($("tlEnd").value, 10);
      if (Number.isNaN(s) || Number.isNaN(e) || e <= s) { renderHead(); return; }   // rentang tidak valid -> kembalikan
      tl.start = s; tl.end = e; changed();
      setTimeout(() => api && api.fitView({ padding: 0.25, duration: 300 }), 30);
    };
    $("tlStart").addEventListener("change", onRange);
    $("tlEnd").addEventListener("change", onRange);
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
    $("tlAddEvent").onclick = addEvent;
    $("tlFit").onclick = () => api && api.fitView({ padding: 0.25, duration: 400 });

    const colors = $("tlEvColors");
    COLORS.forEach((c) => {
      const b = document.createElement("button");
      b.className = "tl-color"; b.dataset.color = c; b.style.background = c; b.title = c; b.setAttribute("aria-label", "Warna " + c);
      b.onclick = () => { const ev = findEvent(selectedId); if (!ev) return; ev.color = c; fillEditor(); changed(); };
      colors.appendChild(b);
    });
    const edit = (fn) => () => { const ev = findEvent(selectedId); if (!ev) return; fn(ev); changed(); };
    $("tlEvTitle").addEventListener("input", edit((ev) => { ev.title = $("tlEvTitle").value; }));
    $("tlEvDesc").addEventListener("input", () => { const ev = findEvent(selectedId); if (ev) { ev.desc = $("tlEvDesc").value; ctx.onChange(); } });
    $("tlEvYear").addEventListener("change", edit((ev) => { const y = parseInt($("tlEvYear").value, 10); if (!Number.isNaN(y)) ev.year = y; $("tlEvYear").value = ev.year; }));
    $("tlEvScene").addEventListener("change", edit((ev) => { ev.sceneId = $("tlEvScene").value; $("tlEvOpenScene").disabled = !ev.sceneId; }));
    $("tlEvOpenScene").onclick = () => { const ev = findEvent(selectedId); if (ev && ev.sceneId) ctx.openScene(ev.sceneId); };
    $("tlEvDelete").onclick = () => {
      const ev = findEvent(selectedId); if (!ev) return;
      tl.events = tl.events.filter((e) => e.id !== ev.id);
      tl.links = (tl.links || []).filter((l) => l.source !== ev.id && l.target !== ev.id);
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
      $("tlSearch").value = sameProject ? $("tlSearch").value : "";
      const keep = sameProject && tl && timelines().includes(tl) ? tl.id : (timelines()[0] || {}).id;
      if (keep) openTimeline(keep);
      else { tl = null; selectedId = null; hideEditor(); renderList(); renderHead(); renderFlow(); }
    },
  };
})();
