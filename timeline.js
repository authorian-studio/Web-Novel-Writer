// ================= TIMELINE (React Flow) =================
// Dimuat lazy oleh app.js (ensureTimelineLib) saat tab Timeline pertama kali dibuka, setelah React, ReactDOM &
// React Flow (folder vendor/). Data disimpan di project: p.data.timelines = [{ id, title, start, end, events }]
//   start/end = rentang dasar garis waktu (default 1500–1900); tombol + di kedua ujung garis menambah 100 tahun per klik
//   event     = { id, title, year, month, day, desc, color, sceneId, image?, tags?, cards? }  (month/day boleh kosong;
//               image = data:image/... kecil, tags = ["tag", ...])
// Aturan garis waktu (ala vvd):
//   - garisnya selalu satu garis horizontal; event menempel di garis itu (hanya bisa digeser kiri/kanan)
//   - arahkan kursor ke garis -> muncul tanggal lengkap (tanggal bulan tahun) + "klik untuk menambah"
//   - klik garis -> event baru + kartu langsung muncul di atas titiknya (judul siap diketik); klik event -> kartu yang sama.
//     Kartu bisa disunting di tempat: gambar, judul, tanggal, deskripsi, tag, kartu Kodeks yang ditautkan (ev.cards =
//     [{ kind, id }]); tombol mata = panel detail lengkap (scene terkait, warna)
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
  const EN = !!(window.NovelI18n && window.NovelI18n.lang === "en");   // nama bulan & era ikut bahasa antarmuka
  const MONTHS = EN ? ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    : ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
  const MONTHS_FULL = EN ? ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
    : ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
  const EXTEND_YEARS = 100;     // tombol + di ujung garis
  const IMG_PX = 640, MAX_IMG = 400000;
  const MDAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const CUM = MDAYS.reduce((a, d, i) => (a.push(i ? a[i - 1] + MDAYS[i - 1] : 0), a), []);

  let ctx = null;               // { project, onChange, getScenes, openScene }
  let tl = null;                // timeline yang sedang dibuka
  let selectedId = null;        // event yang sedang dipilih
  let cardId = null;            // event yang kartunya sedang tampil (klik event / baru dibuat)
  let animUntil = 0;            // animasi kamera terprogram (lompat ke tanggal) sedang berjalan -> kunci tinggi garis dilewati
  let findMark = null;          // hasil pencarian tanggal: { frac, date } -> penanda berdenyut di garis
  let freshId = null;           // event yang baru dibuat -> judul di kartu langsung terpilih untuk diketik
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
  const fmtLong = (d) => (d.month ? (d.day ? d.day + " " : "") + MONTHS_FULL[d.month - 1] + " " : "") + (d.year < 0 ? Math.abs(d.year) + (EN ? " BC" : " SM") : d.year);
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

  // ---------- kartu event (ala vvd): muncul tepat di atas titik event saat event diklik / baru dibuat ----------
  // Bisa langsung disunting di tempat: gambar, judul, tanggal, deskripsi, tag & kartu Kodeks yang ditautkan.
  // Tombol mata = panel detail lengkap (scene terkait, warna), tong sampah = hapus. Kartu mengikuti geser/zoom kanvas.
  // ikon: #ti-calendar-event #ti-eye #ti-trash #ti-plus #ti-chevron-right #ti-x #ti-cards #ti-search #ti-photo #ti-color-picker
  const ic = (name, n) => h("svg", { className: "ti", width: n || 14, height: n || 14, "aria-hidden": "true", focusable: "false" }, h("use", { href: "#ti-" + name }));
  const cardsOf = (ev) => (Array.isArray(ev.cards) ? ev.cards.filter((c) => c && typeof c.id === "string" && typeof c.kind === "string") : []);
  function kodeksItem(c) {
    const K = window.NovelKodeks;
    if (!K || !K.isKind(c.kind)) return null;
    const it = K.find(c.kind, c.id);
    return it ? { it, name: String(it.title || "").trim() || "(tanpa judul)", color: K.colorOf(c.kind, it), kindName: K.kindName(c.kind) } : null;
  }
  // warna kustom yang sudah dipakai event lain di timeline ini (bukan dari palet), terbaru dulu
  function recentColors(ev) {
    const pal = new Set(PALETTE.map((c) => c.toLowerCase()).concat(COLORS)), out = [];
    for (let i = tl.events.length - 1; i >= 0 && out.length < 8; i--) {
      const c = String(tl.events[i].color || "").toLowerCase();
      if (HEX6.test(c) && !pal.has(c) && !out.includes(c) && tl.events[i] !== ev) out.push(c);
    }
    return out;
  }
  function CardPicker({ ev, onDone }) {
    const [q, setQ] = React.useState("");
    const K = window.NovelKodeks, have = new Set(cardsOf(ev).map((c) => c.kind + "|" + c.id)), nq = q.trim().toLowerCase();
    const rows = [];
    if (K) K.kindIds.forEach((kind) => K.entries(kind).forEach((it) => {
      const name = String(it.title || "").trim() || "(tanpa judul)";
      if (have.has(kind + "|" + it.id) || (nq && !name.toLowerCase().includes(nq))) return;
      rows.push({ kind, it, name, color: K.colorOf(kind, it), kindName: K.kindName(kind) });
    }));
    const pick = (r) => { ev.cards = cardsOf(ev).concat([{ kind: r.kind, id: r.it.id }]); onDone(); changed(); };
    return h("div", { className: "tl-ec-pick" },
      h("label", { className: "tl-ec-pick-search" }, ic("search", 13),
        h("input", { autoFocus: true, value: q, placeholder: "Cari kartu Kodeks…", "aria-label": "Cari kartu Kodeks", onChange: (e) => setQ(e.target.value),
          onKeyDown: (e) => { if (e.key === "Escape") { e.stopPropagation(); onDone(); } else if (e.key === "Enter" && rows[0]) pick(rows[0]); } })),
      h("div", { className: "tl-ec-pick-list" },
        rows.length ? rows.slice(0, 60).map((r) => h("button", { key: r.kind + r.it.id, type: "button", className: "tl-ec-pick-row", style: { "--kc": r.color }, onClick: () => pick(r) },
          h("i", { className: "tl-ec-kdot" }), h("span", { className: "tl-ec-pick-name" }, r.name), h("small", null, r.kindName)))
          : h("p", { className: "tl-ec-pick-empty" }, K ? (nq ? "Tidak ada kartu yang cocok." : "Belum ada kartu di Kodeks.") : "Kodeks belum dimuat.")));
  }
  // ---------- pemilih warna modern: palet + warna bebas (kotak saturasi/kecerahan, slider hue, hex) ----------
  const PALETTE = ["#e8e8ec", "#94a3b8", "#f87171", "#fb923c", "#fbbf24", "#d7a86e", "#a3e635", "#4ade80",
    "#2dd4bf", "#38bdf8", "#60a5fa", "#818cf8", "#a78bfa", "#e879f9", "#f472b6", "#fb7185"];
  const HEX6 = /^#[0-9a-f]{6}$/i;
  function hexToHsv(hex) {
    const v = parseInt(hex.slice(1), 16), r = ((v >> 16) & 255) / 255, g = ((v >> 8) & 255) / 255, b = (v & 255) / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let hh = 0;
    if (d) hh = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return { h: ((hh * 60) + 360) % 360, s: mx ? d / mx : 0, v: mx };
  }
  function hsvToHex({ h: hh, s: ss, v: vv }) {
    const f = (n) => { const k = (n + hh / 60) % 6; return vv - vv * ss * Math.max(0, Math.min(k, 4 - k, 1)); };
    return "#" + [f(5), f(3), f(1)].map((x) => Math.round(x * 255).toString(16).padStart(2, "0")).join("");
  }
  function ColorPicker({ value, recent, onPick }) {
    const cur = HEX6.test(value || "") ? value.toLowerCase() : COLORS[0];
    const [hsv, setHsv] = React.useState(() => hexToHsv(cur));
    const [hex, setHex] = React.useState(cur);
    const svRef = React.useRef(null);
    const apply = (n) => { setHsv(n); const x = hsvToHex(n); setHex(x); onPick(x); };
    const dragSV = (e) => {
      const box = svRef.current.getBoundingClientRect();
      const move = (ev) => apply({ h: hsv.h, s: Math.max(0, Math.min(1, (ev.clientX - box.left) / box.width)), v: 1 - Math.max(0, Math.min(1, (ev.clientY - box.top) / box.height)) });
      move(e);
      const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
      window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
    };
    const pickHex = (x) => { setHsv(hexToHsv(x)); setHex(x); onPick(x); };
    const sw = (c, extra) => h("button", { key: c + (extra || ""), type: "button", className: "tl-cp-sw" + (c.toLowerCase() === cur ? " is-on" : ""), style: { "--c": c }, title: c, "aria-label": "Warna " + c, onClick: () => pickHex(c.toLowerCase()) });
    return h("div", { className: "tl-cp", role: "group", "aria-label": "Warna event" },
      h("div", { className: "tl-cp-grid" }, PALETTE.map((c) => sw(c))),
      recent.length ? h("div", { className: "tl-cp-recent" }, h("span", null, "Terakhir dipakai"), recent.map((c) => sw(c, "r"))) : null,
      h("div", { ref: svRef, className: "tl-cp-sv", style: { "--hue": `hsl(${Math.round(hsv.h)} 100% 50%)` }, onPointerDown: (e) => { e.preventDefault(); dragSV(e); } },
        h("span", { className: "tl-cp-thumb", style: { left: hsv.s * 100 + "%", top: (1 - hsv.v) * 100 + "%", background: hex } })),
      h("input", { type: "range", className: "tl-cp-hue", min: 0, max: 359, value: Math.round(hsv.h), "aria-label": "Hue", onChange: (e) => apply({ ...hsv, h: Number(e.target.value), s: hsv.s || 0.6, v: hsv.v || 0.9 }) }),
      h("div", { className: "tl-cp-row" },
        h("span", { className: "tl-cp-prev", style: { background: hex } }),
        h("input", { className: "tl-cp-hex", value: hex, maxLength: 7, spellCheck: false, "aria-label": "Kode warna hex",
          onChange: (e) => { let x = e.target.value.trim(); if (x && x[0] !== "#") x = "#" + x; setHex(x); if (HEX6.test(x)) { setHsv(hexToHsv(x)); onPick(x.toLowerCase()); } } }),
        window.EyeDropper ? h("button", { type: "button", className: "tl-ec-ibtn", title: "Ambil warna dari layar", "aria-label": "Ambil warna dari layar",
          onClick: () => new window.EyeDropper().open().then((r) => r && r.sRGBHex && pickHex(r.sRGBHex.toLowerCase())).catch(() => {}) }, ic("color-picker", 15)) : null));
  }
  function EventCard({ ev, range, fresh }) {
    const [tx, ty, zoom] = RF.useStore((st) => st.transform);
    const width = RF.useStore((st) => st.width), height = RF.useStore((st) => st.height);
    const [dateOpen, setDateOpen] = React.useState(false);
    const [tagsOpen, setTagsOpen] = React.useState(tagsOf(ev).length > 0);
    const [picking, setPicking] = React.useState(false);
    const [colorOpen, setColorOpen] = React.useState(false);
    const [tagText, setTagText] = React.useState("");
    const titleRef = React.useRef(null), fileRef = React.useRef(null);
    React.useEffect(() => { if (fresh && titleRef.current) { titleRef.current.focus(); titleRef.current.select(); } }, [ev.id]);
    const x = tx + fracToX(range, dateToFrac(ev)) * zoom;
    if (x < -40 || x > width + 40) return null;
    const W = Math.min(270, width - 24), cx = Math.max(12 + W / 2, Math.min(width - 12 - W / 2, x));
    const above = ty > 300 || ty > height - ty;   // utamakan di atas garis (seperti vvd); di bawah bila ruang atas sempit
    const close = () => { cardId = null; freshId = null; rev++; renderFlow(); };
    const set = (fn) => { fn(ev); changed(); };
    const setTags = (list) => { const seen = new Set(), t = list.map((v) => v.replace(/^#+/, "").replace(/\s+/g, " ").trim().slice(0, 40)).filter((v) => v && !seen.has(v.toLowerCase()) && seen.add(v.toLowerCase())); if (t.length) ev.tags = t; else delete ev.tags; changed(); };
    const tags = tagsOf(ev), cards = cardsOf(ev);
    const pickImg = (f) => { if (f) { selectedId = ev.id; setImage(f); } };
    return h(React.Fragment, null, h("span", { className: "tl-ec-tail" + (above ? "" : " is-below"), style: { left: x, top: above ? ty - 26 : ty + 6 } }), h("div", {
      className: "tl-ecard" + (above ? " is-above" : " is-below"), role: "dialog", "aria-label": "Event " + (ev.title || ""),
      style: { left: cx, top: above ? ty - 26 : ty + 26, width: W, maxHeight: Math.max(160, above ? ty - 34 : height - ty - 34), "--ev": ev.color || COLORS[0] },
      onPointerDown: (e) => e.stopPropagation(), onWheel: (e) => e.stopPropagation(), onDoubleClick: (e) => e.stopPropagation(),
      onKeyDown: (e) => { if (e.key === "Escape" && !picking) { e.stopPropagation(); close(); } else e.stopPropagation(); },
    },
      h("div", { className: "tl-ec-head" },
        h("button", { type: "button", className: "tl-ec-img" + (ev.image ? " has-img" : ""), title: ev.image ? "Ganti gambar" : "Tambah gambar", "aria-label": ev.image ? "Ganti gambar" : "Tambah gambar",
          style: ev.image ? { backgroundImage: `url("${ev.image}")` } : null, onClick: () => fileRef.current && fileRef.current.click(),
          onDragOver: (e) => { if (Array.from(e.dataTransfer.types || []).includes("Files")) e.preventDefault(); },
          onDrop: (e) => { e.preventDefault(); pickImg(e.dataTransfer.files && e.dataTransfer.files[0]); } },
          ev.image ? null : ic("plus", 22)),
        h("input", { ref: fileRef, type: "file", accept: "image/*", hidden: true, onChange: (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ""; pickImg(f); } }),
        h("div", { className: "tl-ec-main" },
          h("div", { className: "tl-ec-row" },
            h("input", { ref: titleRef, className: "tl-ec-title", value: ev.title || "", placeholder: "Judul event", maxLength: 120, "aria-label": "Judul event",
              onChange: (e) => set((v) => { v.title = e.target.value; }), onKeyDown: (e) => { if (e.key === "Enter") e.target.blur(); } }),
            h("button", { type: "button", className: "tl-ec-ibtn tl-ec-colorbtn" + (colorOpen ? " is-on" : ""), title: "Warna event", "aria-label": "Warna event", "aria-expanded": colorOpen,
              onClick: () => setColorOpen(!colorOpen) }, h("span", { className: "tl-ec-cdot" })),
            h("button", { type: "button", className: "tl-ec-ibtn", title: "Detail lengkap (scene, warna)", "aria-label": "Detail lengkap",
              onClick: () => { selectedId = ev.id; cardId = null; freshId = null; fillEditor(); rev++; renderFlow(); } }, ic("eye", 15)),
            h("button", { type: "button", className: "tl-ec-ibtn is-danger", title: "Hapus event", "aria-label": "Hapus event",
              onClick: () => { tl.events = tl.events.filter((e) => e.id !== ev.id); if (selectedId === ev.id) { selectedId = null; hideEditor(); } cardId = null; freshId = null; changed(); } }, ic("trash", 15))),
          h("button", { type: "button", className: "tl-ec-date" + (dateOpen ? " is-open" : ""), onClick: () => setDateOpen(!dateOpen), "aria-expanded": dateOpen }, ic("calendar-event", 13), fmtLong(ev)))),
      dateOpen ? h("div", { className: "tl-ec-datef" },
            h("input", { type: "number", min: 1, max: 31, placeholder: "Tgl", "aria-label": "Tanggal", value: ev.day || "", disabled: !ev.month,
              onChange: (e) => set((v) => { const d = parseInt(e.target.value, 10); v.day = v.month && d >= 1 ? Math.min(d, MDAYS[v.month - 1]) : null; }) }),
            h("select", { "aria-label": "Bulan", value: ev.month || "", onChange: (e) => set((v) => { const m = parseInt(e.target.value, 10); v.month = m >= 1 && m <= 12 ? m : null; if (!v.month) v.day = null; else if (v.day) v.day = Math.min(v.day, MDAYS[v.month - 1]); }) },
              h("option", { value: "" }, "—"), MONTHS.map((m, i) => h("option", { key: m, value: i + 1 }, m))),
            h("input", { type: "number", placeholder: "Tahun", "aria-label": "Tahun", value: ev.year,
              onChange: (e) => { const y = parseInt(e.target.value, 10); if (!Number.isNaN(y)) set((v) => { v.year = y; }); } })) : null,
      colorOpen ? h(ColorPicker, { value: ev.color, recent: recentColors(ev), onPick: (c) => set((v) => { v.color = c; }) }) : null,
      h("textarea", { className: "tl-ec-desc", value: ev.desc || "", placeholder: "Deskripsi", rows: 3, "aria-label": "Deskripsi",
        onChange: (e) => { ev.desc = e.target.value; ctx.onChange(); rev++; renderFlow(); } }),
      h("div", { className: "tl-ec-sec" },
        h("button", { type: "button", className: "tl-ec-sec-head" + (tagsOpen ? " is-open" : ""), onClick: () => setTagsOpen(!tagsOpen), "aria-expanded": tagsOpen },
          ic("chevron-right", 13), "Tag", tags.length ? h("b", null, tags.length) : null),
        tagsOpen ? h("div", { className: "tl-ec-tags" },
          tags.map((t) => h("span", { key: t, className: "tl-ec-tag" }, "#" + t,
            h("button", { type: "button", "aria-label": "Hapus tag " + t, onClick: () => setTags(tags.filter((x) => x !== t)) }, ic("x", 11)))),
          h("input", { className: "tl-ec-tagin", value: tagText, placeholder: tags.length ? "+ tag" : "Tambah tag, Enter…", "aria-label": "Tambah tag",
            onChange: (e) => setTagText(e.target.value),
            onKeyDown: (e) => {
              if ((e.key === "Enter" || e.key === ",") && tagText.trim()) { e.preventDefault(); setTags(tags.concat(tagText.split(","))); setTagText(""); }
              else if (e.key === "Backspace" && !tagText && tags.length) setTags(tags.slice(0, -1));
            } })) : null),
      cards.length ? h("div", { className: "tl-ec-cards" }, cards.map((c) => {
        const k = kodeksItem(c);
        if (!k) return null;
        return h("span", { key: c.kind + c.id, className: "tl-ec-card", style: { "--kc": k.color }, title: k.kindName },
          h("button", { type: "button", className: "tl-ec-card-open", onClick: () => ctx.openDoc && ctx.openDoc(c.kind, c.id) }, h("i", { className: "tl-ec-kdot" }), k.name),
          h("button", { type: "button", className: "tl-ec-card-x", "aria-label": "Lepas kartu " + k.name, onClick: () => set((v) => { v.cards = cardsOf(v).filter((x) => !(x.kind === c.kind && x.id === c.id)); if (!v.cards.length) delete v.cards; }) }, ic("x", 11)));
      })) : null,
      picking ? h(CardPicker, { ev, onDone: () => setPicking(false) })
        : h("button", { type: "button", className: "tl-ec-add", onClick: () => setPicking(true) }, ic("plus", 13), "Tautkan kartu")));
  }

  // ---------- CARI DI TIMELINE: tahun / tanggal / judul event -> lompat & tandai ----------
  // Format tanggal: "1319", "Des 1319", "Desember 1319", "21 Des 1319", "Dec 21 1319", "21/12/1319", "12/1319",
  // "1319-12-21", "200 SM" / "200 BC" / "-200". Bulan Indonesia & Inggris (nama lengkap atau 3 huruf).
  const MON_ALIASES = [["jan", "januari", "january"], ["feb", "februari", "february", "pebruari"], ["mar", "maret", "march"], ["apr", "april"],
    ["mei", "may"], ["jun", "juni", "june"], ["jul", "juli", "july"], ["agu", "agustus", "aug", "august", "agt"], ["sep", "sept", "september"],
    ["okt", "oktober", "oct", "october"], ["nov", "november", "nop"], ["des", "desember", "dec", "december"]];
  const monthOf = (w) => { w = w.toLowerCase().replace(/\./g, ""); const i = MON_ALIASES.findIndex((a) => a.includes(w)); return i < 0 ? 0 : i + 1; };
  function parseDateQuery(q) {
    let t = q.trim().toLowerCase().replace(/,/g, " ").replace(/\s+/g, " ");
    if (!t) return null;
    let neg = false;
    const era = t.match(/\s*(sm|bc|bce|s\.m\.)$/);
    if (era) { neg = true; t = t.slice(0, era.index).trim(); }
    if (/^-\d+$/.test(t)) { neg = true; t = t.slice(1); }
    const Y = (y) => (neg ? -Math.abs(y) : y);
    let m;
    if ((m = t.match(/^(\d{1,6})$/))) return { year: Y(+m[1]), month: null, day: null };
    if ((m = t.match(/^(\d{1,6})-(\d{1,2})-(\d{1,2})$/))) return mk(Y(+m[1]), +m[2], +m[3]);   // 1319-12-21
    if ((m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{1,6})$/))) return mk(Y(+m[3]), +m[2], +m[1]);   // 21/12/1319
    if ((m = t.match(/^(\d{1,2})[/.-](\d{1,6})$/))) return mk(Y(+m[2]), +m[1], null);   // 12/1319
    if ((m = t.match(/^(\d{1,2}) ([a-z.]+) (\d{1,6})$/))) return mk(Y(+m[3]), monthOf(m[2]), +m[1]);   // 21 des 1319
    if ((m = t.match(/^([a-z.]+) (\d{1,2}) (\d{1,6})$/))) return mk(Y(+m[3]), monthOf(m[1]), +m[2]);   // dec 21 1319
    if ((m = t.match(/^([a-z.]+) (\d{1,6})$/))) return mk(Y(+m[2]), monthOf(m[1]), null);   // des 1319
    return null;
    function mk(y, mo, d) {
      if (!(mo >= 1 && mo <= 12)) return null;
      if (d != null && !(d >= 1 && d <= MDAYS[mo - 1])) return null;
      return { year: y, month: mo, day: d || null };
    }
  }
  function findResults(q) {
    const out = [], date = parseDateQuery(q), nq = q.trim().toLowerCase();
    if (date) out.push({ kind: "date", date, label: fmtLong(date) });
    if (nq) tl.events.filter((ev) => [ev.title, ev.desc, tagsOf(ev).join(" "), fmtLong(ev), fmtDate(ev)].join(" \u0001 ").toLowerCase().includes(nq))
      .sort((a, b) => dateToFrac(a) - dateToFrac(b)).slice(0, 8).forEach((ev) => out.push({ kind: "event", ev, label: ev.title || "(tanpa judul)", sub: fmtLong(ev) }));
    return out;
  }
  // lompat ke tanggal: garis memanjang (kelipatan 100 th) bila di luar rentang; zoom menyesuaikan ketelitian tanggal
  function jumpTo(date, evId) {
    if (!tl || !api) return;
    const f = dateToFrac(date), r0 = rangeOf(tl);
    if (f < r0.start) tl.start = Math.floor(f / EXTEND_YEARS) * EXTEND_YEARS;
    if (f > r0.end) tl.end = Math.ceil((f + 1) / EXTEND_YEARS) * EXTEND_YEARS;
    if (f < r0.start || f > r0.end) ctx.onChange();
    findMark = evId ? null : { frac: f + (date.month ? (date.day ? 0.5 : 15) / 365 : 0.5), date };
    if (evId) { selectedId = evId; cardId = evId; freshId = null; hideEditor(); }
    rev++; renderFlow(); renderHead();
    setTimeout(() => {
      const r = rangeOf(tl), box = $("tlFlow"), w = box.clientWidth;
      const span = date.day ? 0.6 : date.month ? 3 : Math.max(8, Math.min(60, (r.end - r.start) / 8));   // tahun tampil di layar
      const zoom = Math.max(0.05, Math.min(1000, w / (span * scaleOf(r))));
      const xf = fracToX(r, findMark ? findMark.frac : f), v = api.getViewport();
      animUntil = performance.now() + 600;
      api.setViewport({ x: w / 2 - xf * zoom, y: v.y, zoom }, { duration: 450 });
      setTimeout(() => {   // posisi akhir dipasang persis (interpolasi d3 bisa menggeser tinggi garis), lalu label dihitung ulang
        animUntil = performance.now() + 60;   // lewati kunci tinggi garis untuk lompatan akhir ini juga
        api.setViewport({ x: w / 2 - xf * zoom, y: v.y, zoom });
        rev++; renderFlow();
      }, 480);
    }, 0);
  }
  function FindMark({ range }) {
    const [tx, ty, zoom] = RF.useStore((st) => st.transform);
    if (!findMark) return null;
    const x = tx + fracToX(range, findMark.frac) * zoom, d = findMark.date;
    const add = () => { const dd = { year: d.year, month: d.month, day: d.day }; findMark = null; addEventAt(dd); };
    return h("div", { className: "tl-findmark", style: { left: x, top: ty }, onPointerDown: (e) => e.stopPropagation() },
      h("span", { className: "tl-findmark-ring" }),
      h("div", { className: "tl-findmark-tip" },
        h("b", null, fmtLong(d)),
        h("button", { type: "button", onClick: add }, ic("plus", 12), "Event di sini"),
        h("button", { type: "button", className: "is-x", "aria-label": "Tutup penanda", onClick: () => { findMark = null; rev++; renderFlow(); } }, ic("x", 12))));
  }
  function bindFind() {
    const inp = $("tlFind"), pop = $("tlFindPop");
    let items = [], active = 0;
    const close = () => { pop.classList.add("hidden"); inp.setAttribute("aria-expanded", "false"); };
    const choose = (it) => {
      if (!it) return;
      close();
      if (it.kind === "date") jumpTo(it.date); else jumpTo(it.ev, it.ev.id);
      inp.blur();
    };
    const draw = () => {
      const q = inp.value;
      items = tl && q.trim() ? findResults(q) : [];
      active = Math.min(active, Math.max(0, items.length - 1));
      if (!q.trim()) { close(); return; }
      pop.innerHTML = items.length ? items.map((it, i) => it.kind === "date"
        ? `<button type="button" role="option" class="tl-find-row is-date${i === active ? " is-active" : ""}" data-i="${i}"><svg class="ti" width="15" height="15" aria-hidden="true"><use href="#ti-calendar-event"></use></svg><span><b>${esc(it.label)}</b><small>Lompat ke tanggal ini</small></span><kbd>Enter</kbd></button>`
        : `<button type="button" role="option" class="tl-find-row${i === active ? " is-active" : ""}" data-i="${i}" style="--ev:${esc(it.ev.color || COLORS[0])}"><i class="tl-find-dot"></i><span><b>${esc(it.label)}</b><small>${esc(it.sub)}</small></span></button>`).join("")
        : `<p class="tl-find-empty">Tidak ditemukan. Coba tahun (1319), bulan & tahun (Des 1319), tanggal lengkap (21/12/1319), atau judul event.</p>`;
      pop.classList.remove("hidden"); inp.setAttribute("aria-expanded", "true");
    };
    inp.addEventListener("input", () => { active = 0; draw(); });
    inp.addEventListener("focus", draw);
    inp.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); if (items.length) { active = (active + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length; draw(); } }
      else if (e.key === "Enter") { e.preventDefault(); choose(items[active]); }
      else if (e.key === "Escape") { if (inp.value) inp.value = ""; close(); inp.blur(); }
    });
    inp.addEventListener("blur", () => setTimeout(close, 150));
    pop.addEventListener("pointerdown", (e) => e.preventDefault());   // klik hasil tidak menutup dulu lewat blur
    pop.addEventListener("click", (e) => { const b = e.target.closest(".tl-find-row"); if (b) choose(items[+b.dataset.i]); });
    // "/" = fokus ke pencarian (saat tab Timeline tampil & tidak sedang mengetik)
    document.addEventListener("keydown", (e) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (!inp.offsetParent) return;
      e.preventDefault(); inp.focus(); inp.select();
    });
  }

  function FlowApp({ tlRev, panMode }) {
    const [nodes, setNodes, onNodesChangeBase] = useNodesState([]);
    const [ghost, setGhost] = React.useState(null);   // penanda + tooltip "klik untuk menambah"
    const lastVp = React.useRef(null);
    // saat zoom, garis tetap di ketinggian layar yang sama (kalau tidak, zoom dalam bisa "melempar" garis keluar layar)
    const onMove = (_e, v) => {
      const prev = lastVp.current;
      if (performance.now() < animUntil) { lastVp.current = v; return; }
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
      selectedId = node.id; freshId = null;
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
      if (selectedId || cardId || findMark) { selectedId = null; cardId = null; findMark = null; hideEditor(); rev++; renderFlow(); }
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
      h(FindMark, { range: rangeOf(tl) }),
      cardId && findEvent(cardId) ? h(EventCard, { key: cardId, ev: findEvent(cardId), range: rangeOf(tl), fresh: freshId === cardId }) : null,
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
    selectedId = null; cardId = null; findMark = null; hideEditor();
    $("tlFind").value = "";
    rev++;
    renderList(); renderHead(); renderFlow();
    if (tl && ctx.onOpen) ctx.onOpen(tl.id);   // app.js: riwayat sidebar tab
  }

  // ---------- event: tambah & panel edit ----------
  function addEventAt(date) {
    const ev = { id: uid("ev"), title: "Event baru", year: date.year, month: date.month || null, day: date.day || null, desc: "", color: COLORS[0], sceneId: "" };
    tl.events.push(ev);
    selectedId = ev.id; cardId = ev.id; freshId = ev.id;   // kartu langsung muncul di atas titik event, judul siap diketik
    hideEditor();
    changed();
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
      if (selectedId === id && editorOpen()) fillEditor();
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
    bindFind();
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
