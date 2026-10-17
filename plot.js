// ================= PLOT LAB (tab "plot") =================
// Dimuat lazy oleh app.js (ensurePlotLib) saat tab Plot pertama kali dibuka. DOM + SVG biasa, tanpa React.
// Semua bergantung pada urutan adegan di Kerangka (p.data.scenes, folder = bab). Data disimpan di project:
//   p.data.plot = {
//     structure: "three-act",                          // pola struktur yang dipakai (STRUCTURES)
//     tension:   { [sceneId]: 0..10 },                 // tingkat ketegangan tiap adegan (kurva)
//     beats:     { [structureId]: { [beatId]: sceneId } },   // beat pola -> adegan yang menjalankannya
//     threads:   [{ id, name, color, cells: { [sceneId]: 1|2|3 } }],   // 1 = muncul, 2 = titik balik, 3 = selesai
//     setups:    [{ id, text, from, to, note }]        // benih (setup) ditanam di adegan `from`, dituai (payoff) di `to`
//   }
// Empat tampilan: Kurva (ketegangan + pola struktur), Benang (anyaman subplot per adegan), Benih & panen (setup →
// payoff), Diagnosa (pemeriksaan otomatis atas ketiganya + rencana Kerangka).
(function () {
  "use strict";
  const VIEW_KEY = "novelist_plot_view";
  const COLORS = ["#d7a86e", "#6aa8ff", "#c77dff", "#4caf82", "#e15c5c", "#4fd1c5", "#f472b6", "#e0b072"];
  const MARKS = ["", "Muncul", "Titik balik", "Selesai"];
  const MOOD = ["Tenang", "Tenang", "Tenang", "Bergolak", "Bergolak", "Tegang", "Tegang", "Genting", "Genting", "Puncak", "Puncak"];

  // pola struktur: beat (posisi ideal dalam % cerita) + bentuk kurva ketegangan ideal [[%, 0..10], ...]
  const STRUCTURES = [
    { id: "three-act", name: "Tiga Babak", desc: "Persiapan, konfrontasi, resolusi — pola paling umum.",
      curve: [[0, 2], [10, 3.5], [25, 4.5], [35, 4], [50, 6.5], [62, 6], [75, 7.5], [80, 6], [88, 10], [95, 4], [100, 2.5]],
      beats: [
        ["hook", 0, "Pembuka", "Gambaran dunia & tokoh sebelum semuanya berubah. Beri pembaca alasan untuk peduli."],
        ["inciting", 10, "Insiden pemicu", "Peristiwa yang mengguncang hidup tokoh dan memulai cerita."],
        ["pp1", 25, "Titik plot 1", "Tokoh berkomitmen masuk ke konflik; tidak ada jalan kembali."],
        ["mid", 50, "Titik tengah", "Pembalikan besar: kebenaran terungkap atau taruhan naik. Tokoh berhenti bereaksi dan mulai bertindak."],
        ["pp2", 75, "Titik plot 2", "Kekalahan terbesar atau penemuan terakhir yang mendorong ke klimaks."],
        ["climax", 88, "Klimaks", "Konfrontasi terakhir; konflik utama diputuskan."],
        ["res", 97, "Resolusi", "Dunia setelah konflik — tunjukkan bagaimana tokoh berubah."],
      ] },
    { id: "save-the-cat", name: "Save the Cat", desc: "15 beat Blake Snyder, rinci & berirama.",
      curve: [[0, 2], [10, 4], [20, 4], [30, 5], [50, 7], [62, 6.5], [75, 8], [80, 6], [85, 7], [92, 10], [100, 3]],
      beats: [
        ["opening", 0, "Gambaran pembuka", "Potret \"sebelum\" tokoh dan dunianya."],
        ["theme", 5, "Tema dinyatakan", "Seseorang menyiratkan pelajaran yang harus dipelajari tokoh."],
        ["catalyst", 10, "Katalis", "Peristiwa yang mengubah segalanya."],
        ["debate", 15, "Keraguan", "Tokoh ragu: haruskah ia melangkah?"],
        ["break2", 20, "Masuk babak dua", "Tokoh memilih masuk ke dunia baru."],
        ["bstory", 22, "Cerita B", "Hubungan baru yang membawa tema (sering romansa atau mentor)."],
        ["fun", 30, "Senang-senang", "Janji premis: hal-hal yang membuat pembaca memilih buku ini."],
        ["mid", 50, "Titik tengah", "Kemenangan palsu atau kekalahan palsu; taruhan naik."],
        ["badguys", 62, "Musuh mendekat", "Tekanan dari luar dan keretakan dari dalam."],
        ["lost", 75, "Semua hilang", "Titik terendah; sesuatu (atau seseorang) hilang."],
        ["dark", 80, "Malam tergelap", "Tokoh meratapi kekalahan sebelum menemukan jawabannya."],
        ["break3", 85, "Masuk babak tiga", "Ide baru lahir dari gabungan cerita A & B."],
        ["finale", 90, "Final", "Tokoh menerapkan pelajarannya dan menghadapi tantangan terakhir."],
        ["final", 99, "Gambaran penutup", "Kebalikan gambaran pembuka: bukti perubahan."],
      ] },
    { id: "hero", name: "Perjalanan Pahlawan", desc: "12 tahap mitos Campbell / Vogler.",
      curve: [[0, 2], [8, 3.5], [12, 3], [17, 3.5], [25, 5], [35, 5.5], [45, 6.5], [52, 9], [60, 5.5], [75, 7], [88, 10], [100, 3]],
      beats: [
        ["ordinary", 0, "Dunia biasa", "Kehidupan tokoh sebelum petualangan."],
        ["call", 8, "Panggilan berpetualang", "Masalah atau tantangan datang mengetuk."],
        ["refusal", 12, "Penolakan", "Rasa takut membuat tokoh menolak panggilan itu."],
        ["mentor", 17, "Bertemu mentor", "Seseorang memberi bekal, nasihat, atau keberanian."],
        ["threshold", 25, "Melewati ambang", "Tokoh meninggalkan dunia biasa."],
        ["tests", 35, "Ujian, sekutu & musuh", "Aturan dunia baru dipelajari; kawan dan lawan terbentuk."],
        ["approach", 45, "Mendekati gua terdalam", "Persiapan menghadapi bahaya terbesar."],
        ["ordeal", 52, "Cobaan berat", "Tokoh menghadapi maut — secara harfiah atau kiasan."],
        ["reward", 60, "Imbalan", "Tokoh meraih sesuatu dari cobaan itu."],
        ["roadback", 75, "Jalan pulang", "Akibat dari cobaan memburu tokoh."],
        ["resurrection", 88, "Kebangkitan", "Ujian terakhir; tokoh lahir kembali sebagai pribadi baru."],
        ["elixir", 97, "Kembali membawa eliksir", "Tokoh pulang membawa sesuatu yang mengubah dunianya."],
      ] },
    { id: "kisho", name: "Kishōtenketsu", desc: "Pola Asia Timur: cerita bergerak lewat kejutan, bukan konflik.",
      curve: [[0, 2], [25, 3], [50, 3.5], [58, 8], [75, 6], [85, 4], [100, 3]],
      beats: [
        ["ki", 0, "Ki — pengenalan", "Perkenalkan tokoh & dunia tanpa konflik besar."],
        ["sho", 25, "Shō — pengembangan", "Kembangkan yang sudah ada; perdalam tanpa membalik."],
        ["ten", 55, "Ten — kejutan", "Unsur tak terduga yang mengubah cara kita melihat semuanya."],
        ["ketsu", 85, "Ketsu — rekonsiliasi", "Satukan semuanya; makna baru lahir dari kejutan tadi."],
      ] },
    { id: "freytag", name: "Piramida Freytag", desc: "Bentuk tragedi klasik: klimaks di tengah.",
      curve: [[0, 2], [20, 4], [50, 10], [70, 6], [90, 3], [100, 2]],
      beats: [
        ["expo", 0, "Eksposisi", "Latar, tokoh, dan keadaan awal."],
        ["rising", 20, "Aksi meningkat", "Komplikasi bertumpuk, taruhan naik."],
        ["climax", 50, "Klimaks", "Titik balik nasib tokoh."],
        ["falling", 70, "Aksi menurun", "Akibat klimaks mulai terasa."],
        ["denoue", 90, "Penyelesaian", "Simpul terakhir dibuka; keseimbangan baru."],
      ] },
    { id: "fichtean", name: "Kurva Fichtean", desc: "Krisis demi krisis sejak halaman pertama — cocok untuk thriller.",
      curve: [[0, 4], [12, 6], [22, 4.5], [35, 7], [44, 5.5], [58, 8], [66, 6.5], [80, 10], [92, 4], [100, 3]],
      beats: [
        ["c1", 12, "Krisis pertama", "Mulai langsung di tengah masalah."],
        ["c2", 35, "Krisis kedua", "Masalah lebih besar; jalan keluar pertama gagal."],
        ["c3", 58, "Krisis ketiga", "Taruhan memuncak; tokoh terpojok."],
        ["climax", 80, "Klimaks", "Krisis terbesar diselesaikan."],
        ["falling", 93, "Aksi menurun", "Napas lega; luka dan perubahan terlihat."],
      ] },
  ];
  const STRUCT_BY_ID = Object.fromEntries(STRUCTURES.map((s) => [s.id, s]));
  const VIEWS = [
    ["arc", "#ti-chart-line", "Kurva ketegangan"],
    ["threads", "#ti-route", "Benang cerita"],
    ["seeds", "#ti-seedling", "Benih & panen"],
    ["diag", "#ti-stethoscope", "Diagnosa"],
  ];

  let ctx = null;           // { getProject, onChange, openScene, openOutline, characters }
  let view = "arc";
  try { const v = localStorage.getItem(VIEW_KEY); if (VIEWS.some((x) => x[0] === v)) view = v; } catch (e) { /* abaikan */ }
  let sel = null;           // { kind: "scene" | "beat", id }
  let seedFilter = "all";
  let hoverSeed = null;
  let drag = null;          // { i, id } saat titik kurva diseret
  let sig = "";             // tanda data adegan -> render ulang bila Kerangka berubah di jendela lain
  let ro = null;
  let lastProject = null;
  let bound = false;
  const root = () => document.getElementById("plotRoot");
  const uid = (p) => p + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const ic = (ref, px) => `<svg class="ti" width="${px || 16}" height="${px || 16}" aria-hidden="true"><use href="${ref}"></use></svg>`;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const T = (s) => (window.NovelI18n ? window.NovelI18n.t(s) : s);   // teks bawaan yang menjadi DATA ikut bahasa antarmuka
  const pctTxt = (v) => Math.round(v) + "%";

  // ---------- data ----------
  function plot() {
    const d = ctx.getProject().data;
    let p = d.plot;
    if (!p || typeof p !== "object" || Array.isArray(p)) p = d.plot = {};
    if (!STRUCT_BY_ID[p.structure]) p.structure = "three-act";
    if (!p.tension || typeof p.tension !== "object") p.tension = {};
    if (!p.beats || typeof p.beats !== "object") p.beats = {};
    if (!Array.isArray(p.threads)) p.threads = [];
    if (!Array.isArray(p.setups)) p.setups = [];
    p.threads.forEach((t) => { if (!t.cells || typeof t.cells !== "object") t.cells = {}; });
    return p;
  }
  const struct = () => STRUCT_BY_ID[plot().structure];
  const beatMap = () => { const p = plot(); if (!p.beats[p.structure] || typeof p.beats[p.structure] !== "object") p.beats[p.structure] = {}; return p.beats[p.structure]; };
  function tensionOf(id) { const v = plot().tension[id]; return typeof v === "number" && v >= 0 && v <= 10 ? v : null; }
  // adegan berurutan seperti di Kerangka; bab = jalur folder ("Bab 1 › Sub")
  function scenes() {
    const out = [];
    (function walk(list, trail, fid) {
      (list || []).forEach((n) => {
        if (!n) return;
        if (n.type === "folder") walk(n.children, trail.concat(n.title || "Bab tanpa judul"), n.id);
        else out.push({ s: n, id: n.id, title: n.title || "Tanpa judul", chapter: trail.join(" › "), cid: fid || "" });
      });
    })(ctx.getProject().data.scenes, [], "");
    out.forEach((x, i) => { x.i = i; x.n = i + 1; x.pct = out.length > 1 ? (i / (out.length - 1)) * 100 : 0; });
    return out;
  }
  // kelompok bab berurutan (untuk pita latar kurva & kepala tabel benang)
  function chapterRuns(list) {
    const runs = [];
    list.forEach((x) => {
      const r = runs[runs.length - 1];
      if (r && r.cid === x.cid) r.end = x.i;
      else runs.push({ cid: x.cid, title: x.chapter || "Tanpa bab", start: x.i, end: x.i });
    });
    return runs;
  }
  // nilai kurva ideal pada posisi % (interpolasi linear antar titik pola)
  function idealAt(st, pct) {
    const c = st.curve;
    for (let i = 1; i < c.length; i++) {
      if (pct <= c[i][0]) { const [x0, y0] = c[i - 1], [x1, y1] = c[i]; return y0 + (y1 - y0) * ((pct - x0) / Math.max(1e-6, x1 - x0)); }
    }
    return c[c.length - 1][1];
  }
  const sceneLabel = (x) => x ? `${x.n}. ${x.title}` : "";
  function changed() { ctx.onChange(); }

  // ---------- kurva halus tanpa melampaui titik (monotone cubic, Fritsch–Carlson) ----------
  function smoothPath(pts) {
    const n = pts.length;
    if (!n) return "";
    if (n === 1) return `M${pts[0][0]},${pts[0][1]}`;
    const dx = [], m = [], t = [];
    for (let i = 0; i < n - 1; i++) { dx[i] = pts[i + 1][0] - pts[i][0] || 1e-6; m[i] = (pts[i + 1][1] - pts[i][1]) / dx[i]; }
    t[0] = m[0]; t[n - 1] = m[n - 2];
    for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
    for (let i = 0; i < n - 1; i++) {
      if (m[i] === 0) { t[i] = t[i + 1] = 0; continue; }
      const a = t[i] / m[i], b = t[i + 1] / m[i], s = a * a + b * b;
      if (s > 9) { const k = 3 / Math.sqrt(s); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
    }
    let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
    for (let i = 0; i < n - 1; i++) {
      const h = dx[i] / 3;
      d += ` C${(pts[i][0] + h).toFixed(1)},${(pts[i][1] + t[i] * h).toFixed(1)} ${(pts[i + 1][0] - h).toFixed(1)},${(pts[i + 1][1] - t[i + 1] * h).toFixed(1)} ${pts[i + 1][0].toFixed(1)},${pts[i + 1][1].toFixed(1)}`;
    }
    return d;
  }
  // sparkline pola di navigasi
  function sparkSvg(st) {
    const W = 64, H = 22;
    return `<svg class="pl-spark" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true"><path d="${smoothPath(st.curve.map(([x, y]) => [x / 100 * (W - 4) + 2, H - 2 - y / 10 * (H - 4)]))}"/></svg>`;
  }

  // ---------- kerangka panel ----------
  function shell() {
    const r = root();
    r.innerHTML = `<div class="pl">
      <nav class="pl-nav" aria-label="Plot">
        <div class="pl-brand">${ic("#ti-git-branch", 20)}<div><b>Plot Lab</b><span>Bentuk, benang &amp; janji cerita</span></div></div>
        <div class="pl-views" role="tablist" aria-label="Tampilan plot"></div>
        <div class="pl-nav-h">Pola struktur</div>
        <div class="pl-structs"></div>
      </nav>
      <main class="pl-main"><div class="pl-body"></div></main>
      <div class="pl-tip" hidden></div>
    </div>`;
    if (!bound) bindEvents(r);
    bound = true;
    if (ro) ro.disconnect();
    if (window.ResizeObserver) {
      let w = 0;
      ro = new ResizeObserver(() => {
        const nw = r.clientWidth;
        if (Math.abs(nw - w) < 2) return;
        w = nw;
        if (view === "arc") drawChart(); else if (view === "seeds") drawStrip(scenes());
      });
      ro.observe(r);
    }
  }
  function renderNav() {
    const r = root(), d = diagnose(), warns = d.filter((x) => x.level === "warn").length;
    r.querySelector(".pl-views").innerHTML = VIEWS.map(([id, icon, name]) => `<button type="button" role="tab" class="pl-view${id === view ? " is-on" : ""}" aria-selected="${id === view}" data-act="view" data-view="${id}" title="${name}">
      <span class="pl-view-ic">${ic(icon, 16)}</span><span class="pl-view-name">${name}</span>${id === "diag" && warns ? `<span class="pl-badge">${warns}</span>` : ""}</button>`).join("");
    const cur = plot().structure;
    r.querySelector(".pl-structs").innerHTML = STRUCTURES.map((st) => `<button type="button" class="pl-struct${st.id === cur ? " is-on" : ""}" data-act="struct" data-struct="${st.id}" title="${esc(st.desc)}" aria-pressed="${st.id === cur}">
      ${sparkSvg(st)}<span><b>${st.name}</b><small>${st.desc}</small></span></button>`).join("");
  }
  function render() {
    if (!ctx || !root() || !root().querySelector(".pl")) return;
    const list = scenes();
    sig = signature(list);
    renderNav();
    const body = root().querySelector(".pl-body");
    const scroll = body.scrollTop;
    body.dataset.view = view;
    if (!list.length) {
      body.innerHTML = `<div class="pl-empty">${ic("#ti-git-branch", 34)}<p>Belum ada adegan.</p>
        <span>Plot Lab membaca urutan adegan di Kerangka. Buat beberapa adegan dulu, lalu kembali ke sini untuk menggambar kurva ketegangan, menganyam subplot, dan melacak janji cerita.</span>
        <button type="button" class="pl-btn is-primary" data-act="outline">${ic("#ti-layout-board", 15)}<span>Buka Kerangka</span></button></div>`;
      return;
    }
    if (view === "arc") renderArc(list);
    else if (view === "threads") renderThreads(list);
    else if (view === "seeds") renderSeeds(list);
    else renderDiag(list);
    body.scrollTop = scroll;
  }
  function signature(list) { return list.map((x) => x.id + "\u0001" + x.title + "\u0001" + x.cid).join("\u0002"); }
  const head = (icon, title, sub, tools) => `<header class="pl-head"><div class="pl-head-ic">${ic(icon, 18)}</div><div class="pl-head-t"><h2>${title}</h2><p>${sub}</p></div><div class="pl-head-tools">${tools || ""}</div></header>`;

  // =============== KURVA KETEGANGAN ===============
  function renderArc(list) {
    const st = struct(), set = list.filter((x) => tensionOf(x.id) != null).length;
    if (sel && sel.kind === "scene" && !list.some((x) => x.id === sel.id)) sel = null;
    if (!sel) sel = { kind: "scene", id: list[0].id };
    root().querySelector(".pl-body").innerHTML = `
      ${head("#ti-chart-line", "Kurva ketegangan", `Seret titik naik-turun untuk memberi tingkat ketegangan tiap adegan. Garis putus-putus = bentuk ideal ${st.name}.`,
        `<button type="button" class="pl-btn" data-act="fill" title="Isi adegan yang belum bernilai dari bentuk pola">${ic("#ti-wand", 15)}<span>Isi dari pola</span></button>
         <button type="button" class="pl-btn is-ghost" data-act="clear-tension" title="Hapus semua nilai ketegangan"${set ? "" : " disabled"}>${ic("#ti-eraser", 15)}<span>Kosongkan</span></button>`)}
      <div class="pl-chart"><div class="pl-legend"><span><i class="pl-lg-line"></i>Kurvamu</span><span><i class="pl-lg-ideal"></i>Pola ideal</span><span><i class="pl-lg-beat"></i>Beat</span><span class="pl-lg-n">${set}/${list.length} adegan bernilai</span></div><svg class="pl-svg" role="img" aria-label="Kurva ketegangan"></svg></div>
      <div class="pl-arc-bottom">
        <section class="pl-card pl-beats"><h3>${ic("#ti-flag", 15)}<span>Beat ${st.name}</span></h3><div class="pl-beat-list"></div></section>
        <section class="pl-card pl-insp"></section>
      </div>`;
    drawChart();
    renderBeats(list);
    renderInspector(list);
  }
  function chartGeom(list) {
    const wrap = root().querySelector(".pl-chart"), lg = wrap.querySelector(".pl-legend");
    const W = Math.max(260, wrap.clientWidth - 2), H = Math.max(200, wrap.clientHeight - (lg ? lg.offsetHeight : 0) - 4);
    const L = 34, R = 14, T = 52, B = 30, n = list.length;
    const col = (W - L - R) / n;
    const x = (i) => L + col * (i + 0.5);
    const xPct = (pct) => L + col / 2 + (pct / 100) * (W - L - R - col);
    const y = (v) => T + (1 - v / 10) * (H - T - B);
    return { W, H, L, R, T, B, col, x, xPct, y };
  }
  function drawChart() {
    const svg = root() && root().querySelector(".pl-svg");
    if (!svg || view !== "arc") return;
    const list = scenes();
    if (!list.length) return;
    const g = chartGeom(list), st = struct(), bm = beatMap();
    const { W, H, L, R, T, B, x, y } = g;
    svg.setAttribute("width", W); svg.setAttribute("height", H); svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    let s = `<defs><linearGradient id="plFill" x1="0" y1="0" x2="0" y2="1"><stop class="pl-stop" offset="0" stop-opacity=".34"/><stop class="pl-stop" offset="1" stop-opacity="0"/></linearGradient></defs>`;
    // pita bab
    chapterRuns(list).forEach((r, k) => {
      const x0 = x(r.start) - g.col / 2, x1 = x(r.end) + g.col / 2, w = x1 - x0;
      s += `<rect class="pl-band${k % 2 ? " is-alt" : ""}" x="${x0.toFixed(1)}" y="${T - 14}" width="${w.toFixed(1)}" height="${(H - B - T + 14).toFixed(1)}"/>`;
      if (w > 46) s += `<text class="pl-band-t" x="${(x0 + 6).toFixed(1)}" y="${T - 3}" data-no-i18n><tspan>${esc(trim(r.title, Math.floor(w / 6.4)))}</tspan></text>`;
    });
    // kisi & label sumbu y
    for (let v = 0; v <= 10; v += 2) s += `<line class="pl-grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="pl-ylab" x="${L - 8}" y="${y(v) + 3.5}">${v}</text>`;
    // pola ideal
    const idealPts = [];
    for (let p = 0; p <= 100; p += 2) idealPts.push([g.xPct(p), y(idealAt(st, p))]);
    s += `<path class="pl-ideal" d="${smoothPath(idealPts)}"/>`;
    // beat: garis di adegan yang menjalankannya (atau posisi ideal bila belum dipasang) + nomor di atas
    let lastX = -99, row = 0;
    st.beats.forEach(([bid, pct, name], k) => {
      const sc = bm[bid] && list.find((q) => q.id === bm[bid]);
      const bx = sc ? x(sc.i) : g.xPct(pct);
      row = bx - lastX < 20 ? (row + 1) % 2 : 0; lastX = bx;
      const by = 12 + row * 17, on = sel && sel.kind === "beat" && sel.id === bid;
      s += `<line class="pl-beat-line${sc ? " is-set" : ""}${on ? " is-on" : ""}" x1="${bx.toFixed(1)}" x2="${bx.toFixed(1)}" y1="${by + 7}" y2="${H - B}"/>`;
      if (sc && Math.abs(sc.pct - pct) > 3) s += `<line class="pl-beat-drift" x1="${g.xPct(pct).toFixed(1)}" x2="${bx.toFixed(1)}" y1="${by}" y2="${by}"/><circle class="pl-beat-ghost" cx="${g.xPct(pct).toFixed(1)}" cy="${by}" r="2.5"/>`;
      s += `<g class="pl-beat-chip${sc ? " is-set" : ""}${on ? " is-on" : ""}" data-act="beat" data-beat="${bid}" transform="translate(${bx.toFixed(1)},${by})"><title>${esc(name)}</title><circle r="7.5"/><text y="3.2">${k + 1}</text></g>`;
    });
    // kurva pengguna
    const pts = list.filter((q) => tensionOf(q.id) != null).map((q) => [x(q.i), y(tensionOf(q.id))]);
    if (pts.length > 1) {
      const line = smoothPath(pts);
      s += `<path class="pl-area" d="${line} L${pts[pts.length - 1][0].toFixed(1)},${y(0)} L${pts[0][0].toFixed(1)},${y(0)} Z"/><path class="pl-line" d="${line}"/>`;
    }
    // titik adegan
    list.forEach((q) => {
      const v = tensionOf(q.id), on = sel && sel.kind === "scene" && sel.id === q.id;
      const st2 = q.s.status === "done" ? " is-done" : q.s.status === "draft" ? " is-draft" : "";
      s += `<g class="pl-pt${v == null ? " is-empty" : ""}${on ? " is-on" : ""}${st2}" data-i="${q.i}" tabindex="0" role="slider" aria-valuemin="0" aria-valuemax="10" aria-valuenow="${v == null ? 0 : v}" aria-label="${esc(sceneLabel(q))}" transform="translate(${x(q.i).toFixed(1)},${y(v == null ? 0 : v).toFixed(1)})"><circle class="pl-pt-hit" r="13"/><circle class="pl-pt-dot" r="${on ? 6.5 : 5}"/></g>`;
      if (g.col >= 16 || q.i % Math.ceil(16 / g.col) === 0) s += `<text class="pl-xlab${on ? " is-on" : ""}" x="${x(q.i).toFixed(1)}" y="${H - B + 17}">${q.n}</text>`;
    });
    svg.innerHTML = s;
  }
  const trim = (t, n) => (t.length > n ? t.slice(0, Math.max(1, n - 1)) + "…" : t);
  function setTension(id, v) {
    const p = plot();
    if (v == null) delete p.tension[id]; else p.tension[id] = clamp(Math.round(v), 0, 10);
  }
  function renderBeats(list) {
    const box = root().querySelector(".pl-beat-list");
    if (!box) return;
    const st = struct(), bm = beatMap();
    box.innerHTML = st.beats.map(([bid, pct, name, desc], k) => {
      const sc = bm[bid] && list.find((q) => q.id === bm[bid]);
      const drift = sc ? Math.round(sc.pct - pct) : 0, off = sc && Math.abs(drift) > 12;
      const on = sel && sel.kind === "beat" && sel.id === bid;
      return `<div class="pl-beat${sc ? " is-set" : ""}${on ? " is-on" : ""}" data-beat="${bid}">
        <button type="button" class="pl-beat-n" data-act="beat" data-beat="${bid}" title="${esc(desc)}">${k + 1}</button>
        <div class="pl-beat-main">
          <button type="button" class="pl-beat-name" data-act="beat" data-beat="${bid}" title="${esc(desc)}"><b>${name}</b><small>±${pct}%</small>${off ? `<span class="pl-drift" title="Jauh dari posisi idealnya">${drift > 0 ? "+" : ""}${drift}%</span>` : ""}</button>
          <select class="pl-sel" data-beat-scene="${bid}" aria-label="Adegan untuk beat ${esc(name)}"><option value="">— pilih adegan —</option>${sceneOptions(list, sc ? sc.id : "")}</select>
        </div></div>`;
    }).join("");
  }
  function sceneOptions(list, cur) {
    let out = "", lastC = null;
    list.forEach((q) => {
      if (q.cid !== lastC) { if (lastC !== null) out += "</optgroup>"; out += `<optgroup label="${esc(q.chapter || "Tanpa bab")}" data-no-i18n>`; lastC = q.cid; }
      out += `<option value="${esc(q.id)}"${q.id === cur ? " selected" : ""} data-no-i18n>${esc(sceneLabel(q))}</option>`;
    });
    return out + (lastC !== null ? "</optgroup>" : "");
  }
  function renderInspector(list) {
    const box = root().querySelector(".pl-insp");
    if (!box) return;
    const st = struct(), bm = beatMap();
    if (sel && sel.kind === "beat") {
      const b = st.beats.find((x) => x[0] === sel.id);
      if (b) {
        const [bid, pct, name, desc] = b, k = st.beats.indexOf(b) + 1;
        const sc = bm[bid] && list.find((q) => q.id === bm[bid]);
        const ideal = list.reduce((a, q) => (Math.abs(q.pct - pct) < Math.abs(a.pct - pct) ? q : a), list[0]);
        box.innerHTML = `<div class="pl-insp-k">${ic("#ti-flag", 14)}<span>Beat</span><b>${k}</b></div>
          <h3 class="pl-insp-t">${name}</h3>
          <p class="pl-insp-desc">${desc}</p>
          <dl class="pl-kv"><dt>Posisi ideal</dt><dd>±${pct}% <span class="pl-dim" data-no-i18n>(${esc(sceneLabel(ideal))})</span></dd>
            <dt>Dijalankan di</dt><dd data-no-i18n>${sc ? esc(sceneLabel(sc)) + ` <span class="pl-dim">· ${pctTxt(sc.pct)}</span>` : '<span class="pl-dim">—</span>'}</dd></dl>
          <div class="pl-insp-actions">${sc ? `<button type="button" class="pl-btn" data-act="select" data-scene="${esc(sc.id)}">${ic("#ti-chart-line", 15)}<span>Lihat adegan</span></button>
            <button type="button" class="pl-btn is-ghost" data-act="unbeat" data-beat="${bid}">${ic("#ti-unlink", 15)}<span>Lepas</span></button>`
            : `<button type="button" class="pl-btn is-primary" data-act="beat-here" data-beat="${bid}" data-scene="${esc(ideal.id)}">${ic("#ti-target-arrow", 15)}<span>Pasang di adegan ideal</span></button>`}</div>`;
        return;
      }
      sel = { kind: "scene", id: list[0].id };
    }
    const q = list.find((x) => sel && x.id === sel.id) || list[0];
    const v = tensionOf(q.id), s = q.s, plan = s.plan && typeof s.plan === "object" ? s.plan : {};
    const beats = st.beats.filter(([bid]) => bm[bid] === q.id);
    const threads = plot().threads.filter((t) => t.cells[q.id]);
    const seedsHere = plot().setups.filter((x) => x.from === q.id || x.to === q.id);
    const gco = [["goal", "Tujuan"], ["conflict", "Konflik"], ["outcome", "Hasil"]].filter(([k]) => typeof plan[k] === "string" && plan[k].trim());
    box.innerHTML = `<div class="pl-insp-k">${ic("#ti-file-text", 14)}<span>Adegan</span><b>${q.n}</b><span class="pl-dim pl-insp-ch" data-no-i18n>${esc(q.chapter)}</span>
        <span class="pl-insp-nav"><button type="button" class="pl-ibtn" data-act="step" data-d="-1" title="Adegan sebelumnya"${q.i ? "" : " disabled"}>${ic("#ti-chevron-left", 15)}</button><button type="button" class="pl-ibtn" data-act="step" data-d="1" title="Adegan berikutnya"${q.i < list.length - 1 ? "" : " disabled"}>${ic("#ti-chevron-right", 15)}</button></span></div>
      <h3 class="pl-insp-t" data-no-i18n>${esc(q.title)}</h3>
      <div class="pl-tension">
        <div class="pl-tension-top"><span>Ketegangan</span><b>${v == null ? "—" : v}</b><em>${v == null ? "Belum dinilai" : MOOD[v]}</em>
          ${v == null ? "" : `<button type="button" class="pl-link" data-act="unset" data-scene="${esc(q.id)}">Hapus nilai</button>`}</div>
        <input type="range" class="pl-range" min="0" max="10" step="1" value="${v == null ? 0 : v}" data-tension="${esc(q.id)}" aria-label="Ketegangan adegan" style="--v:${(v == null ? 0 : v) * 10}%">
        <div class="pl-ideal-note">Pola ${st.name} menyarankan sekitar <b>${Math.round(idealAt(st, q.pct))}</b> di posisi ini (${pctTxt(q.pct)}).</div>
      </div>
      ${s.synopsis ? `<p class="pl-insp-syn" data-no-i18n>${esc(s.synopsis)}</p>` : ""}
      ${gco.length ? `<dl class="pl-kv pl-gco">${gco.map(([k, l]) => `<dt>${l}</dt><dd data-no-i18n>${esc(plan[k])}</dd>`).join("")}</dl>` : ""}
      ${beats.length || threads.length || seedsHere.length ? `<div class="pl-chips">
        ${beats.map(([bid, , name]) => `<button type="button" class="pl-chip is-beat" data-act="beat" data-beat="${bid}">${ic("#ti-flag", 12)}<span>${name}</span></button>`).join("")}
        ${threads.map((t) => `<span class="pl-chip" style="--tc:${t.color}" title="${MARKS[t.cells[q.id]]}"><i></i><span data-no-i18n>${esc(t.name || "Benang")}</span></span>`).join("")}
        ${seedsHere.map((x) => `<span class="pl-chip is-seed" title="${x.from === q.id ? "Benih ditanam di sini" : "Benih dituai di sini"}">${ic(x.from === q.id ? "#ti-seedling" : "#ti-sparkles", 12)}<span data-no-i18n>${esc(trim(x.text || "Benih", 28))}</span></span>`).join("")}
      </div>` : ""}
      <div class="pl-insp-actions"><button type="button" class="pl-btn" data-act="open-scene" data-scene="${esc(q.id)}">${ic("#ti-arrow-up-right", 15)}<span>Buka adegan</span></button></div>`;
  }
  function selectScene(id, focusPoint) {
    sel = { kind: "scene", id };
    drawChart(); renderBeats(scenes()); renderInspector(scenes());
    if (focusPoint) { const list = scenes(), q = list.find((x) => x.id === id); const pt = q && root().querySelector(`.pl-pt[data-i="${q.i}"]`); if (pt) pt.focus({ preventScroll: true }); }
  }
  function pointerToValue(e) {
    const svg = root().querySelector(".pl-svg"), r = svg.getBoundingClientRect(), g = chartGeom(scenes());
    return clamp(Math.round((1 - (e.clientY - r.top - g.T) / (g.H - g.T - g.B)) * 10), 0, 10);
  }
  function nearestIndex(e) {
    const svg = root().querySelector(".pl-svg"), r = svg.getBoundingClientRect(), list = scenes(), g = chartGeom(list);
    return clamp(Math.floor((e.clientX - r.left - g.L) / g.col), 0, list.length - 1);
  }
  function showTip(e, html) {
    const tip = root().querySelector(".pl-tip"), box = root().querySelector(".pl").getBoundingClientRect();
    tip.innerHTML = html; tip.hidden = false;
    const tw = tip.offsetWidth;
    tip.style.left = clamp(e.clientX - box.left - tw / 2, 6, box.width - tw - 6) + "px";
    tip.style.top = Math.max(6, e.clientY - box.top - tip.offsetHeight - 14) + "px";
  }
  const hideTip = () => { const t = root() && root().querySelector(".pl-tip"); if (t) t.hidden = true; };

  // =============== BENANG CERITA ===============
  function threadStats(t, list) {
    const idx = list.filter((q) => t.cells[q.id]).map((q) => q.i);
    let gap = 0, gapAt = null;
    for (let k = 1; k < idx.length; k++) { const d = idx[k] - idx[k - 1] - 1; if (d > gap) { gap = d; gapAt = [idx[k - 1], idx[k]]; } }
    const resolved = list.some((q) => t.cells[q.id] === 3);
    return { idx, count: idx.length, first: idx.length ? idx[0] : -1, last: idx.length ? idx[idx.length - 1] : -1, gap, gapAt, resolved };
  }
  const gapLimit = (n) => Math.max(4, Math.ceil(n * 0.2));
  function renderThreads(list) {
    const p = plot(), lim = gapLimit(list.length), runs = chapterRuns(list);
    const chars = (ctx.characters() || []).map((c) => (c && c.title ? String(c.title).trim() : "")).filter(Boolean);
    const names = new Set(p.threads.map((t) => (t.name || "").trim().toLowerCase()));
    const sugg = ["Plot utama", "Subplot romansa", "Misteri", "Persahabatan"].map(T).concat(chars.slice(0, 6).map((c) => T("Arc {}").replace("{}", c))).filter((s) => !names.has(s.toLowerCase())).slice(0, 7);
    const density = list.map((q) => p.threads.filter((t) => t.cells[q.id]).length);
    const maxD = Math.max(1, ...density);
    root().querySelector(".pl-body").innerHTML = `
      ${head("#ti-route", "Benang cerita", `Tiap baris adalah satu alur (plot utama, subplot, arc tokoh). Klik kotak untuk menandai adegan yang memajukan alur itu: muncul → titik balik → selesai. Jeda lebih dari ${lim} adegan diberi tanda merah.`,
        `<span class="pl-key"><i class="pl-mk m1"></i>Muncul</span><span class="pl-key"><i class="pl-mk m2"></i>Titik balik</span><span class="pl-key"><i class="pl-mk m3"></i>Selesai</span>`)}
      ${p.threads.length ? `<div class="pl-tgrid"><table class="pl-tt" style="--n:${list.length}">
        <thead><tr class="pl-tt-chap"><th class="pl-tt-name"></th>${runs.map((r, k) => `<th colspan="${r.end - r.start + 1}" class="${k % 2 ? "is-alt" : ""}" title="${esc(r.title)}" data-no-i18n><span>${esc(r.title)}</span></th>`).join("")}<th class="pl-tt-sum"></th></tr>
          <tr class="pl-tt-num"><th class="pl-tt-name">Benang</th>${list.map((q) => `<th title="${esc(sceneLabel(q))}" data-no-i18n${q.s.status === "done" ? ' class="is-done"' : ""}>${q.n}</th>`).join("")}<th class="pl-tt-sum">Ringkasan</th></tr></thead>
        <tbody>${p.threads.map((t) => {
          const stt = threadStats(t, list);
          return `<tr data-thread="${esc(t.id)}" style="--tc:${t.color}">
            <th class="pl-tt-name"><div class="pl-tname"><button type="button" class="pl-swatch" data-act="t-color" data-thread="${esc(t.id)}" title="Ganti warna" aria-label="Ganti warna"></button>
              <input type="text" maxlength="60" value="${esc(t.name)}" data-thread-name="${esc(t.id)}" placeholder="Nama benang" aria-label="Nama benang">
              <button type="button" class="pl-ibtn is-danger" data-act="t-del" data-thread="${esc(t.id)}" title="Hapus benang" aria-label="Hapus benang">${ic("#ti-trash", 14)}</button></div></th>
            ${list.map((q) => {
              const m = t.cells[q.id] || 0, inSpan = stt.count > 1 && q.i > stt.first && q.i < stt.last;
              const gap = inSpan && !m && stt.idx.some((a, k) => k && stt.idx[k - 1] < q.i && a > q.i && a - stt.idx[k - 1] - 1 > lim);
              const cls = ["pl-c", inSpan || (m && stt.count > 1 && q.i !== stt.first && q.i !== stt.last) ? "is-span" : "", m && q.i === stt.first && stt.count > 1 ? "is-first" : "", m && q.i === stt.last && stt.count > 1 ? "is-last" : "", gap ? "is-gap" : ""].filter(Boolean).join(" ");
              return `<td class="${cls}"><button type="button" class="pl-cell" data-act="cell" data-thread="${esc(t.id)}" data-scene="${esc(q.id)}" aria-label="${esc(sceneLabel(q))}: ${MARKS[m] || "kosong"}" title="${MARKS[m] || "Klik untuk menandai"}"><i class="pl-mk m${m}"></i></button></td>`;
            }).join("")}
            <td class="pl-tt-sum"><span class="pl-sum"><b>${stt.count}</b> adegan</span>${stt.gap > lim ? `<span class="pl-sum is-warn" title="Jeda terpanjang">${ic("#ti-alert-triangle", 12)}<span>jeda ${stt.gap}</span></span>` : ""}${stt.resolved ? `<span class="pl-sum is-ok">${ic("#ti-check", 12)}<span>selesai</span></span>` : ""}</td>
          </tr>`;
        }).join("")}
          <tr class="pl-tt-density"><th class="pl-tt-name"><span title="Jumlah benang yang bergerak di tiap adegan">Kepadatan</span></th>${density.map((d) => `<td><i style="--d:${d / maxD}" title="${d}">${d || ""}</i></td>`).join("")}<td class="pl-tt-sum"></td></tr>
        </tbody></table></div>` : `<div class="pl-blank">${ic("#ti-route", 28)}<p>Belum ada benang.</p><span>Mulai dengan plot utama, lalu tambahkan subplot dan arc tokoh. Kamu akan langsung melihat alur mana yang terlupakan terlalu lama.</span></div>`}
      <div class="pl-add-row">
        <form class="pl-add" data-form="thread"><input type="text" maxlength="60" placeholder="Nama benang baru…" aria-label="Nama benang baru"><button type="submit" class="pl-btn is-primary">${ic("#ti-plus", 15)}<span>Benang</span></button></form>
        ${sugg.length ? `<div class="pl-sugg"><span class="pl-dim">Cepat:</span>${sugg.map((s) => `<button type="button" class="pl-chip is-add" data-act="t-quick" data-name="${esc(s)}">${ic("#ti-plus", 12)}<span>${esc(s)}</span></button>`).join("")}</div>` : ""}
      </div>`;
  }
  function addThread(name) {
    const p = plot(), used = new Set(p.threads.map((t) => t.color));
    const color = COLORS.find((c) => !used.has(c)) || COLORS[p.threads.length % COLORS.length];
    p.threads.push({ id: uid("thr"), name: String(name).trim().slice(0, 60) || "Benang", color, cells: {} });
    changed(); render();
  }

  // =============== BENIH & PANEN ===============
  function seedStatus(x, list) {
    const a = x.from && list.find((q) => q.id === x.from), b = x.to && list.find((q) => q.id === x.to);
    if (!a) return { key: "unplanted", label: "Belum ditanam", a, b };
    if (!b) return { key: "open", label: "Belum dituai", a, b };
    if (b.i < a.i) return { key: "reversed", label: "Urutan terbalik", a, b };
    return { key: "paid", label: "Terbayar", a, b };
  }
  function renderSeeds(list) {
    const p = plot(), all = p.setups.map((x) => ({ x, st: seedStatus(x, list) }));
    const open = all.filter((o) => o.st.key !== "paid").length;
    const shown = seedFilter === "open" ? all.filter((o) => o.st.key !== "paid") : all;
    root().querySelector(".pl-body").innerHTML = `
      ${head("#ti-seedling", "Benih & panen", "Catat setiap petunjuk, janji, atau benda penting (\"pistol Chekhov\") yang kamu tanam — lalu di adegan mana ia dituai. Benih yang belum dituai adalah janji yang belum kamu tepati pada pembaca.",
        `<div class="pl-seg" role="group" aria-label="Saring benih"><button type="button" data-act="seed-filter" data-f="all" aria-pressed="${seedFilter === "all"}">Semua <b>${all.length}</b></button><button type="button" data-act="seed-filter" data-f="open" aria-pressed="${seedFilter === "open"}">Belum tuntas <b>${open}</b></button></div>`)}
      <div class="pl-card pl-strip-card"><svg class="pl-strip" role="img" aria-label="Peta benih dan panen"></svg></div>
      <div class="pl-seeds">${shown.map(({ x, st }) => `<article class="pl-seed is-${st.key}${hoverSeed === x.id ? " is-hover" : ""}" data-seed="${esc(x.id)}">
          <div class="pl-seed-top"><span class="pl-seed-st">${ic(st.key === "paid" ? "#ti-circle-check" : st.key === "reversed" ? "#ti-alert-triangle" : "#ti-hourglass", 13)}<span>${st.label}</span></span>
            <button type="button" class="pl-ibtn is-danger" data-act="seed-del" data-seed="${esc(x.id)}" title="Hapus benih" aria-label="Hapus benih">${ic("#ti-trash", 14)}</button></div>
          <input class="pl-seed-text" type="text" maxlength="140" value="${esc(x.text)}" data-seed-f="text" placeholder="Apa yang ditanam? mis. Kunci perak di laci ayah" aria-label="Benih">
          <div class="pl-seed-flow">
            <label><span>${ic("#ti-seedling", 13)}Ditanam</span><select class="pl-sel" data-seed-f="from" aria-label="Ditanam di adegan"><option value="">—</option>${sceneOptions(list, x.from)}</select></label>
            <span class="pl-seed-arrow">${ic("#ti-arrow-up-right", 14)}</span>
            <label><span>${ic("#ti-sparkles", 13)}Dituai</span><select class="pl-sel" data-seed-f="to" aria-label="Dituai di adegan"><option value="">— belum —</option>${sceneOptions(list, x.to)}</select></label>
          </div>
          <textarea class="pl-seed-note" rows="1" maxlength="400" data-seed-f="note" placeholder="Catatan: bagaimana benih ini dituai?" aria-label="Catatan">${esc(x.note)}</textarea>
        </article>`).join("")}
        <button type="button" class="pl-seed-add" data-act="seed-add">${ic("#ti-plus", 18)}<span>Tanam benih</span></button>
      </div>`;
    drawStrip(list);
    root().querySelectorAll(".pl-seed-note").forEach(grow);
  }
  function grow(t) { if (t && t.offsetParent) { t.style.height = "auto"; t.style.height = t.scrollHeight + "px"; } }
  function drawStrip(list) {
    const svg = root().querySelector(".pl-strip");
    if (!svg) return;
    const W = Math.max(280, svg.parentElement.clientWidth - 24), n = list.length, p = plot();
    const seeds = p.setups.map((x) => ({ x, st: seedStatus(x, list) })).filter((o) => o.st.a);
    const span = (o) => (o.st.b ? Math.abs(o.st.b.i - o.st.a.i) : n - o.st.a.i);
    const maxSpan = Math.max(1, ...seeds.map(span));
    const H = 44 + Math.min(110, 26 + maxSpan / Math.max(1, n) * 120), base = H - 24, L = 12, R = 12, col = (W - L - R) / n;
    const x = (i) => L + col * (i + 0.5);
    let s = "";
    chapterRuns(list).forEach((r, k) => { s += `<rect class="pl-band${k % 2 ? " is-alt" : ""}" x="${(x(r.start) - col / 2).toFixed(1)}" y="6" width="${(col * (r.end - r.start + 1)).toFixed(1)}" height="${base - 6}"/>`; });
    s += `<line class="pl-strip-base" x1="${L}" x2="${W - R}" y1="${base}" y2="${base}"/>`;
    seeds.forEach(({ x: sd, st }) => {
      const x1 = x(st.a.i), x2 = st.b ? x(st.b.i) : W - R + 2, h = Math.min(base - 12, 14 + (span({ st }) / Math.max(1, n)) * 120);
      const on = hoverSeed === sd.id ? " is-hover" : "";
      s += `<path class="pl-arc is-${st.key}${on}" data-seed="${esc(sd.id)}" d="M${x1.toFixed(1)},${base} C${x1.toFixed(1)},${(base - h).toFixed(1)} ${x2.toFixed(1)},${(base - h).toFixed(1)} ${x2.toFixed(1)},${st.b ? base : base - h * 0.4}"><title>${esc(sd.text || "Benih")} — ${esc(st.label)}</title></path>`;
      s += `<circle class="pl-arc-dot is-plant" cx="${x1.toFixed(1)}" cy="${base}" r="3.5"/>`;
      if (st.b) s += `<circle class="pl-arc-dot is-${st.key}" cx="${x2.toFixed(1)}" cy="${base}" r="3.5"/>`;
    });
    list.forEach((q) => { if (col >= 14 || q.i % Math.ceil(14 / col) === 0) s += `<text class="pl-xlab" x="${x(q.i).toFixed(1)}" y="${base + 16}">${q.n}</text>`; });
    if (!seeds.length) s += `<text class="pl-strip-empty" x="${W / 2}" y="${base / 2 + 8}">Benih yang ditanam akan tampil sebagai busur dari adegan tanam ke adegan panen.</text>`;
    svg.setAttribute("width", W); svg.setAttribute("height", H); svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.innerHTML = s;
  }

  // =============== DIAGNOSA ===============
  function diagnose() {
    const out = [], list = scenes(), n = list.length;
    if (!n) return out;
    const st = struct(), bm = beatMap(), p = plot();
    const add = (level, area, text, jump) => out.push({ level, area, text, jump });
    const range = (a, b) => (a === b ? `${a}` : `${a}–${b}`);
    // ketegangan
    const vals = list.map((q) => tensionOf(q.id)), setN = vals.filter((v) => v != null).length;
    if (!setN) add("info", "arc", "Kurva ketegangan masih kosong. Seret titik di Kurva, atau pakai \"Isi dari pola\" sebagai titik awal.", { view: "arc" });
    else {
      if (setN < n) add("info", "arc", `${n - setN} adegan belum diberi tingkat ketegangan.`, { view: "arc", scene: list[vals.findIndex((v) => v == null)].id });
      let run = 1;
      for (let i = 1; i <= n; i++) {
        if (i < n && vals[i] != null && vals[i] === vals[i - 1]) { run++; continue; }
        if (run >= 4) add("warn", "arc", `Ketegangan datar di adegan ${range(i - run + 1, i)} (semua bernilai ${vals[i - 1]}). Pembaca bisa jenuh — beri kejutan, rintangan, atau jeda tenang.`, { view: "arc", scene: list[i - run].id });
        run = 1;
      }
      if (setN >= 4) {
        let mi = 0; vals.forEach((v, i) => { if (v != null && v >= (vals[mi] == null ? -1 : vals[mi])) mi = i; });
        const peak = list[mi], idealPeak = st.curve.reduce((a, c) => (c[1] > a[1] ? c : a))[0];
        if (Math.abs(peak.pct - idealPeak) > 25) add("warn", "arc", `Puncak ketegangan ada di adegan ${peak.n} (${pctTxt(peak.pct)} cerita), padahal ${st.name} memuncak sekitar ${idealPeak}%.`, { view: "arc", scene: peak.id });
        const lastV = vals[n - 1];
        if (lastV != null && lastV >= 8) add("info", "arc", "Cerita berakhir di ketegangan tinggi. Bagus untuk cliffhanger — tapi pastikan memang disengaja.", { view: "arc", scene: list[n - 1].id });
        let flatDiff = 0, cnt = 0; for (let i = 1; i < n; i++) if (vals[i] != null && vals[i - 1] != null) { flatDiff += Math.abs(vals[i] - vals[i - 1]); cnt++; }
        if (cnt >= 5 && flatDiff / cnt < 0.6) add("warn", "arc", "Kurvamu hampir tidak bergelombang. Cerita yang hidup biasanya naik-turun: tegang, lega, lalu lebih tegang.", { view: "arc" });
      }
    }
    // beat
    const missing = st.beats.filter(([bid]) => !(bm[bid] && list.some((q) => q.id === bm[bid])));
    if (missing.length === st.beats.length) add("info", "beats", `Belum ada beat ${st.name} yang dipasang ke adegan.`, { view: "arc", beat: st.beats[0][0] });
    else {
      if (missing.length) add("info", "beats", `${missing.length} beat belum dipasang: ${missing.map((b) => T(b[2])).join(", ")}.`, { view: "arc", beat: missing[0][0] });
      let prev = null;
      st.beats.forEach(([bid, pct, name]) => {
        const q = bm[bid] && list.find((x) => x.id === bm[bid]);
        if (!q) return;
        if (Math.abs(q.pct - pct) > 15 && n >= 5) add("warn", "beats", `Beat "${name}" jatuh di ${pctTxt(q.pct)} cerita — idealnya sekitar ${pct}%.`, { view: "arc", beat: bid });
        if (prev && q.i < prev.q.i) add("warn", "beats", `Beat "${name}" terjadi sebelum "${prev.name}". Urutannya terbalik.`, { view: "arc", beat: bid });
        prev = { q, name };
      });
    }
    // benang
    const lim = gapLimit(n);
    if (!p.threads.length) add("info", "threads", "Belum ada benang cerita. Tambahkan plot utama & subplot untuk melihat jalinan alurmu.", { view: "threads" });
    p.threads.forEach((t) => {
      const s = threadStats(t, list), nm = t.name || "Benang";
      if (!s.count) { add("info", "threads", `Benang "${nm}" belum muncul di adegan mana pun.`, { view: "threads" }); return; }
      if (s.gap > lim) add("warn", "threads", `Benang "${nm}" menghilang selama ${s.gap} adegan (antara adegan ${s.gapAt[0] + 1} dan ${s.gapAt[1] + 1}). Pembaca bisa lupa.`, { view: "threads", scene: list[s.gapAt[0] + 1].id });
      if (!s.resolved && s.last < n - 1 && list[s.last].pct < 70) add("warn", "threads", `Benang "${nm}" berhenti di adegan ${s.last + 1} tanpa diselesaikan.`, { view: "threads" });
      else if (!s.resolved && s.count >= 2) add("info", "threads", `Benang "${nm}" belum ditandai selesai.`, { view: "threads" });
      if (s.first > n * 0.6 && n >= 6) add("info", "threads", `Benang "${nm}" baru muncul di ${pctTxt(list[s.first].pct)} cerita. Pertimbangkan menanam isyaratnya lebih awal.`, { view: "threads" });
    });
    if (p.threads.length) {
      const idle = list.filter((q) => !p.threads.some((t) => t.cells[q.id]));
      if (idle.length) add(idle.length > n / 4 ? "warn" : "info", "threads", `${idle.length} adegan tidak memajukan benang mana pun (mis. adegan ${idle.slice(0, 4).map((q) => q.n).join(", ")}). Apa fungsinya bagi cerita?`, { view: "threads" });
    }
    // benih
    p.setups.forEach((x) => {
      const s = seedStatus(x, list), nm = x.text || "Benih";
      if (s.key === "open") add(s.a.pct < 75 ? "warn" : "info", "seeds", `"${nm}" ditanam di adegan ${s.a.n} tapi belum dituai.`, { view: "seeds" });
      else if (s.key === "reversed") add("warn", "seeds", `"${nm}" dituai (adegan ${s.b.n}) sebelum ditanam (adegan ${s.a.n}).`, { view: "seeds" });
      else if (s.key === "unplanted") add("info", "seeds", `"${nm}" belum punya adegan tanam.`, { view: "seeds" });
    });
    // rencana Kerangka
    const noConf = list.filter((q) => !(q.s.plan && typeof q.s.plan.conflict === "string" && q.s.plan.conflict.trim()));
    if (noConf.length && noConf.length < n) add("info", "outline", `${noConf.length} adegan belum punya konflik tertulis di Kerangka (mis. adegan ${noConf.slice(0, 4).map((q) => q.n).join(", ")}).`, { scene: noConf[0].id, outline: true });
    return out;
  }
  const AREAS = { arc: ["#ti-chart-line", "Kurva ketegangan"], beats: ["#ti-flag", "Beat struktur"], threads: ["#ti-route", "Benang cerita"], seeds: ["#ti-seedling", "Benih & panen"], outline: ["#ti-layout-board", "Kerangka"] };
  function renderDiag(list) {
    const d = diagnose(), warns = d.filter((x) => x.level === "warn").length, infos = d.length - warns;
    const set = list.filter((q) => tensionOf(q.id) != null).length, st = struct(), bm = beatMap();
    const beatsSet = st.beats.filter(([bid]) => bm[bid] && list.some((q) => q.id === bm[bid])).length;
    const p = plot(), paid = p.setups.filter((x) => seedStatus(x, list).key === "paid").length;
    const score = Math.max(5, 100 - warns * 9 - infos * 3);
    const meters = [
      ["Kurva", set, list.length], ["Beat", beatsSet, st.beats.length], ["Benih dituai", paid, p.setups.length],
    ];
    root().querySelector(".pl-body").innerHTML = `
      ${head("#ti-stethoscope", "Diagnosa plot", "Pemeriksaan otomatis atas kurva, beat, benang, benih, dan rencana adegan. Klik temuan untuk melompat ke tempatnya.")}
      <div class="pl-diag-top">
        <div class="pl-card pl-score" style="--s:${score};--c:${score >= 85 ? "var(--success)" : score >= 60 ? "var(--pl-warn)" : "var(--danger)"}"><div class="pl-ring"><b>${score}</b></div><div><b>${score >= 85 ? "Plot sehat" : score >= 60 ? "Perlu sedikit perhatian" : "Banyak yang bisa diperkuat"}</b><span class="pl-dim">${warns} peringatan · ${infos} saran</span></div></div>
        ${meters.map(([l, a, b]) => `<div class="pl-card pl-meter"><span>${l}</span><b>${a}<small>/${b}</small></b><i style="--m:${b ? a / b : 0}"></i></div>`).join("")}
      </div>
      ${d.length ? Object.keys(AREAS).filter((a) => d.some((x) => x.area === a)).map((a) => `<section class="pl-diag-sec"><h3>${ic(AREAS[a][0], 15)}<span>${AREAS[a][1]}</span></h3>
        ${d.filter((x) => x.area === a).sort((x, y) => (x.level === y.level ? 0 : x.level === "warn" ? -1 : 1)).map((x) => `<button type="button" class="pl-finding is-${x.level}" data-act="jump" data-jump="${esc(JSON.stringify(x.jump || {}))}">
          ${ic(x.level === "warn" ? "#ti-alert-triangle" : "#ti-info-circle", 16)}<span>${esc(x.text)}</span>${ic("#ti-chevron-right", 15)}</button>`).join("")}</section>`).join("")
        : `<div class="pl-blank">${ic("#ti-circle-check", 28)}<p>Tidak ada temuan.</p><span>Kurva, beat, benang, dan benihmu terlihat rapi.</span></div>`}`;
  }

  // ---------- event ----------
  function bindEvents(r) {
    r.addEventListener("click", (e) => {
      const b = e.target.closest("[data-act]");
      if (!b || !r.contains(b) || b.disabled) return;
      const act = b.dataset.act, list = scenes(), p = plot();
      if (act === "view") setView(b.dataset.view);
      else if (act === "struct") { p.structure = b.dataset.struct; if (sel && sel.kind === "beat") sel = null; changed(); render(); }
      else if (act === "outline") ctx.openOutline();
      else if (act === "fill") {
        const st = struct(), empty = list.filter((q) => tensionOf(q.id) == null);
        const targets = empty.length ? empty : (confirm("Semua adegan sudah bernilai. Timpa seluruh kurva dengan bentuk pola?") ? list : []);
        if (!targets.length) return;
        targets.forEach((q) => setTension(q.id, idealAt(st, q.pct)));
        changed(); render();
      } else if (act === "clear-tension") {
        if (!confirm("Hapus semua nilai ketegangan adegan?")) return;
        p.tension = {}; changed(); render();
      } else if (act === "beat") {
        if (view !== "arc") setView("arc");
        sel = { kind: "beat", id: b.dataset.beat }; drawChart(); renderBeats(list); renderInspector(list);
      } else if (act === "beat-here") { beatMap()[b.dataset.beat] = b.dataset.scene; changed(); drawChart(); renderBeats(list); renderInspector(list); renderNav(); }
      else if (act === "unbeat") { delete beatMap()[b.dataset.beat]; changed(); drawChart(); renderBeats(list); renderInspector(list); renderNav(); }
      else if (act === "select") selectScene(b.dataset.scene);
      else if (act === "step") {
        const q = list.find((x) => sel && x.id === sel.id) || list[0], nq = list[clamp(q.i + +b.dataset.d, 0, list.length - 1)];
        selectScene(nq.id);
      } else if (act === "unset") { setTension(b.dataset.scene, null); changed(); selectScene(b.dataset.scene); renderNav(); }
      else if (act === "open-scene") ctx.openScene(b.dataset.scene);
      else if (act === "cell") {
        const t = p.threads.find((x) => x.id === b.dataset.thread), sid = b.dataset.scene;
        if (!t) return;
        const next = e.shiftKey || e.altKey ? 0 : ((t.cells[sid] || 0) + 1) % 4;
        if (next) t.cells[sid] = next; else delete t.cells[sid];
        changed(); render(); refocus(`.pl-cell[data-thread="${cssq(t.id)}"][data-scene="${cssq(sid)}"]`);
      } else if (act === "t-color") {
        const t = p.threads.find((x) => x.id === b.dataset.thread);
        if (!t) return;
        t.color = COLORS[(COLORS.indexOf(t.color) + 1) % COLORS.length]; changed(); render();
      } else if (act === "t-del") {
        const t = p.threads.find((x) => x.id === b.dataset.thread);
        if (!t || (Object.keys(t.cells).length && !confirm(`Hapus benang "${t.name || "Benang"}"?`))) return;
        p.threads = p.threads.filter((x) => x !== t); changed(); render();
      } else if (act === "t-quick") addThread(b.dataset.name);
      else if (act === "seed-filter") { seedFilter = b.dataset.f; render(); }
      else if (act === "seed-add") {
        const cur = sel && sel.kind === "scene" && list.some((q) => q.id === sel.id) ? sel.id : "";
        const x = { id: uid("seed"), text: "", from: cur, to: "", note: "" };
        p.setups.push(x); seedFilter = "all"; changed(); render();
        const inp = r.querySelector(`.pl-seed[data-seed="${cssq(x.id)}"] .pl-seed-text`);
        if (inp) { inp.focus(); inp.scrollIntoView({ block: "nearest", behavior: "smooth" }); }
      } else if (act === "seed-del") {
        const x = p.setups.find((s) => s.id === b.dataset.seed);
        if (!x || ((x.text || x.note) && !confirm("Hapus benih ini?"))) return;
        p.setups = p.setups.filter((s) => s !== x); changed(); render();
      } else if (act === "jump") {
        let j = {}; try { j = JSON.parse(b.dataset.jump || "{}"); } catch (err) { j = {}; }
        if (j.outline && j.scene) { ctx.openScene(j.scene); return; }
        if (j.view) view = j.view;
        if (j.beat) sel = { kind: "beat", id: j.beat }; else if (j.scene) sel = { kind: "scene", id: j.scene };
        setView(view);
      }
    });
    r.addEventListener("submit", (e) => {
      const f = e.target.closest("[data-form=thread]");
      if (!f) return;
      e.preventDefault();
      const inp = f.querySelector("input");
      if (!inp.value.trim()) { inp.focus(); return; }
      addThread(inp.value);
      const ni = root().querySelector("[data-form=thread] input"); if (ni) ni.focus();
    });
    r.addEventListener("input", (e) => {
      const t = e.target;
      if (t.matches("[data-thread-name]")) {
        const th = plot().threads.find((x) => x.id === t.dataset.threadName);
        if (th) { th.name = t.value.slice(0, 60); changed(); }
      } else if (t.matches(".pl-range")) {
        setTension(t.dataset.tension, +t.value); changed();
        t.style.setProperty("--v", t.value * 10 + "%");
        const top = t.closest(".pl-tension").querySelector(".pl-tension-top");
        top.querySelector("b").textContent = t.value; top.querySelector("em").textContent = MOOD[+t.value];
        drawChart();
      } else if (t.matches("[data-seed-f=text], [data-seed-f=note]")) {
        const x = plot().setups.find((s) => s.id === t.closest(".pl-seed").dataset.seed);
        if (x) { x[t.dataset.seedF] = t.value; changed(); }
        if (t.tagName === "TEXTAREA") grow(t);
      }
    });
    r.addEventListener("change", (e) => {
      const t = e.target;
      if (t.matches("[data-beat-scene]")) {
        const bm = beatMap();
        if (t.value) bm[t.dataset.beatScene] = t.value; else delete bm[t.dataset.beatScene];
        sel = { kind: "beat", id: t.dataset.beatScene };
        changed(); drawChart(); renderBeats(scenes()); renderInspector(scenes()); renderNav();
      } else if (t.matches(".pl-range")) { renderInspector(scenes()); renderNav(); }
      else if (t.matches("select[data-seed-f]")) {
        const x = plot().setups.find((s) => s.id === t.closest(".pl-seed").dataset.seed);
        if (x) { x[t.dataset.seedF] = t.value; changed(); render(); }
      } else if (t.matches("[data-seed-f=text], [data-thread-name]")) renderNav();
    });
    // kurva: seret titik, klik kolom = pilih adegan
    r.addEventListener("pointerdown", (e) => {
      const svg = e.target.closest(".pl-svg");
      if (!svg || e.button !== 0) return;
      if (e.target.closest(".pl-beat-chip")) return;
      const pt = e.target.closest(".pl-pt"), list = scenes();
      const i = pt ? +pt.dataset.i : nearestIndex(e);
      const q = list[i];
      if (!q) return;
      sel = { kind: "scene", id: q.id };
      drag = { id: q.id, moved: false, startY: e.clientY, pointer: e.pointerId, direct: !!pt };
      svg.setPointerCapture(e.pointerId);
      if (pt) e.preventDefault();
      drawChart();
    });
    r.addEventListener("pointermove", (e) => {
      const svg = e.target.closest && e.target.closest(".pl-svg");
      if (drag && drag.pointer === e.pointerId) {
        if (!drag.direct && Math.abs(e.clientY - drag.startY) < 4 && !drag.moved) return;
        drag.moved = true;
        const v = pointerToValue(e);
        if (tensionOf(drag.id) !== v) { setTension(drag.id, v); drawChart(); }
        const q = scenes().find((x) => x.id === drag.id);
        showTip(e, `<b data-no-i18n>${esc(sceneLabel(q))}</b><span>${v} · <i>${MOOD[v]}</i></span>`);
        return;
      }
      if (!svg) { hideTip(); return; }
      const list = scenes(), q = list[nearestIndex(e)];
      if (!q) return;
      const v = tensionOf(q.id);
      showTip(e, `<b data-no-i18n>${esc(sceneLabel(q))}</b><span>${v == null ? "Seret untuk menilai" : `${v} · <i>${MOOD[v]}</i>`}</span>${q.chapter ? `<small data-no-i18n>${esc(q.chapter)}</small>` : ""}`);
    });
    const endDrag = (e) => {
      if (!drag || drag.pointer !== e.pointerId) return;
      const id = drag.id, moved = drag.moved;
      drag = null; hideTip();
      if (moved) changed();
      selectScene(id);
      renderNav();
    };
    r.addEventListener("pointerup", endDrag);
    r.addEventListener("pointercancel", endDrag);
    r.addEventListener("pointerleave", hideTip);
    r.addEventListener("keydown", (e) => {
      const pt = e.target.closest && e.target.closest(".pl-pt");
      if (!pt) return;
      const list = scenes(), q = list[+pt.dataset.i];
      if (!q) return;
      const v = tensionOf(q.id);
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        setTension(q.id, clamp((v == null ? 0 : v) + (e.key === "ArrowUp" ? 1 : -1), 0, 10)); changed();
        selectScene(q.id, true); renderNav();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        const nq = list[clamp(q.i + (e.key === "ArrowRight" ? 1 : -1), 0, list.length - 1)];
        selectScene(nq.id, true);
      } else if (e.key === "Delete" || e.key === "Backspace") { setTension(q.id, null); changed(); selectScene(q.id, true); renderNav(); }
      else if (e.key === "Enter") { ctx.openScene(q.id); }
      else if (/^[0-9]$/.test(e.key)) { setTension(q.id, +e.key); changed(); selectScene(q.id, true); renderNav(); }
      else return;
      e.preventDefault();
    });
    r.addEventListener("mouseover", (e) => {
      const s = e.target.closest && e.target.closest("[data-seed]");
      const id = s ? s.dataset.seed : null;
      if (id === hoverSeed || view !== "seeds") return;
      hoverSeed = id;
      r.querySelectorAll(".pl-seed, .pl-arc").forEach((n) => n.classList.toggle("is-hover", n.dataset.seed === id));
    });
    // Kerangka bisa berubah di jendela lain (split view): render ulang saat pointer kembali ke panel ini
    r.addEventListener("pointerenter", () => { if (ctx && sig !== signature(scenes()) && !r.contains(document.activeElement)) render(); });
  }
  const cssq = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/"/g, '\\"'));
  function refocus(q) { const n = root().querySelector(q); if (n) n.focus({ preventScroll: true }); }
  function setView(v) {
    view = VIEWS.some((x) => x[0] === v) ? v : "arc";
    try { localStorage.setItem(VIEW_KEY, view); } catch (e) { /* diblokir */ }
    hideTip();
    const body = root().querySelector(".pl-body");
    if (body) body.scrollTop = 0;
    render();
  }

  window.NovelPlot = {
    STRUCTURES,
    show(c) {
      const proj = c.getProject();
      if (proj !== lastProject) { sel = null; hoverSeed = null; lastProject = proj; }
      ctx = c;
      if (!root().querySelector(".pl")) shell();
      render();
    },
    refresh() { if (ctx && root() && root().querySelector(".pl")) render(); },
    hide() { drag = null; hideTip(); },
  };
})();
