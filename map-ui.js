// ================= MAP UI (shell tab Map) =================
// Dimuat lazy oleh app.js (ensureMapLib) setelah map-core.js & map2d.js, saat tab Map pertama kali dibuka.
// Data di project: p.data.maps = [NovelMapCore.serialize(map), ...] — ditulis ulang SINKRON setiap ada perubahan,
// lalu ctx.onChange() (autosave app). Tiap peta didecode sekali saat dibuka & punya riwayat undo/redo sendiri.
// Modul ini hanya mengurus DOM di sekitar kanvas: sidebar daftar peta, header, layer, skala, toolbar alat + popover
// (bioma, ukuran kuas, ketinggian, ikon tempat, jenis jalan) dan panel inspektor objek terpilih.
//   kanvas 2D -> NovelMap2D.create(#mp2d)      kanvas 3D -> import('./map3d.js') baru saat pertama kali beralih ke 3D
(function () {
  "use strict";
  const C = window.NovelMapCore;
  const $ = (id) => document.getElementById(id);
  const TAU = Math.PI * 2;

  const ARR = { place: "places", label: "labels", zone: "zones", river: "rivers", path: "paths" };
  const TYPE_NAMES = { place: "Tempat", label: "Label", zone: "Wilayah", river: "Sungai", path: "Jalan" };
  // alat -> layer yang otomatis ditampilkan saat alat itu dipilih
  const TOOL_LAYER = { brush: "terrain", eraser: "terrain", elevation: "terrain", river: "rivers", path: "paths", place: "places", zone: "zones", label: "labels" };
  const TOOL_KEYS = { v: "select", b: "brush", e: "eraser", k: "elevation", s: "river", j: "path", t: "place", w: "zone", l: "label" };
  // perangkat sentuh tanpa mouse (HP/tablet): petunjuk pakai "ketuk", keyboard tidak dibuka otomatis
  const isTouch = () => !!(window.matchMedia && window.matchMedia("(hover: none)").matches);
  const TOOL_HINTS = {
    river: "Seret di peta untuk menggambar sungai.",
    zone: "Klik titik-titik batas wilayah · dobel-klik, klik titik pertama, atau Enter untuk selesai · Esc batal.",
    label: "Klik di peta untuk menaruh label, lalu ubah teksnya di panel.",
    place: "Pilih ikon, lalu klik di peta untuk menaruh tempat.",
    path: "Pilih jenis, lalu seret di peta untuk menggambar jalan.",
  };
  const TOOL_HINTS_TOUCH = {
    zone: "Ketuk titik-titik batas wilayah · ketuk titik pertama atau ketuk dua kali untuk selesai.",
    label: "Ketuk peta untuk menaruh label, lalu ubah teksnya di panel.",
    place: "Pilih ikon, lalu ketuk peta untuk menaruh tempat.",
  };
  const SCALE_STEPS = [1, 2, 5, 10, 20, 50];   // pilihan panjang garis skala (km)
  const PREFS_KEY = "novelist_map_prefs";

  // ikon tempat (SVG garis, 24x24) — dipakai di popover alat Tempat & inspektor
  const PLACE_SVG = {
    city: '<path d="M3 21h18M5 21V11l4-2.5V21M9 21V4h6v17M15 21v-9l4 2v7"/><path d="M11.5 8h1M11.5 12h1M11.5 16h1"/>',
    village: '<path d="m3 11 9-7 9 7"/><path d="M5 9.5V20h14V9.5"/><path d="M10 20v-5h4v5"/>',
    castle: '<path d="M4 21V6h3v3h3V6h4v3h3V6h3v15Z"/><path d="M10 21v-4a2 2 0 0 1 4 0v4"/>',
    port: '<circle cx="12" cy="5" r="2"/><path d="M12 7v14M8 11h8"/><path d="M4 13a8 8 0 0 0 16 0"/>',
    temple: '<path d="m3 9 9-5 9 5"/><path d="M4 9h16M6 9v9M10 9v9M14 9v9M18 9v9M3 21h18M4 18h16"/>',
    ruin: '<path d="M3 21h18M6 21V9.5l2.5-1.2V21M11 21v-7.5l2.5.8V21M16 21V6.5l2.5 1V21"/>',
    camp: '<path d="M2 20h20M4 20 12 5l8 15"/><path d="m12 20-3-5h6Z"/>',
    landmark: '<path d="M6 21V4"/><path d="M6 4h11l-2 4 2 4H6"/>',
  };

  let ctx = null;            // { project, onChange, getScenes, openScene }
  let cur = null;            // peta yang sedang dibuka: { map, hist, ser }
  const cache = new Map();   // id peta -> { map, hist, ser } (didecode sekali; ser = objek terakhir di project)
  let editor = null;         // editor 2D (NovelMap2D)
  let view3d = null, view3dLoading = null, dirty3d = true, refresh3dTimer = 0;
  let mode = "2d";           // "2d" | "3d"
  let shown = false;
  let selection = null;      // { type, id }
  let editKey = null;        // satu checkpoint undo per sesi edit field yang sama (mis. mengetik nama)
  let popOpen = true;        // popover alat terbuka (klik alat yang aktif = buka/tutup)
  let refreshRaf = 0;
  let knownIds = null;       // id objek sebelum perubahan terakhir -> objek baru dikenali saat dipilih
  let lastTouch = false;     // pointer terakhir bukan mouse (laptop layar sentuh juga): keyboard tidak dibuka otomatis
  const touchInput = () => lastTouch || isTouch();
  let bound = false;
  const prefs = loadPrefs();

  // ---------- preferensi alat (per browser, tidak ikut project) ----------
  function loadPrefs() {
    const def = { tool: "brush", biome: 1, size: 6, elevMode: "raise", elevStrength: 0.5, elevSize: 6, placeIcon: "city", pathKind: "road" };
    try {
      const p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
      if (p && typeof p === "object") Object.keys(def).forEach((k) => { if (typeof p[k] === typeof def[k]) def[k] = p[k]; });
    } catch (e) { /* storage diblokir: pakai bawaan */ }
    if (!C.BIOMES[def.biome]) def.biome = 1;
    def.size = C.clamp(Math.round(def.size), 1, 20); def.elevSize = C.clamp(Math.round(def.elevSize), 1, 20);
    def.elevStrength = C.clamp(def.elevStrength, 0.05, 1);
    if (!PLACE_SVG[def.placeIcon]) def.placeIcon = "city";
    if (def.pathKind !== "trail") def.pathKind = "road";
    if (def.elevMode !== "lower") def.elevMode = "raise";
    if (!TOOL_LAYER[def.tool] && def.tool !== "select") def.tool = "brush";
    return def;
  }
  function savePrefs() { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) { /* abaikan */ } }

  // ---------- data project ----------
  const maps = () => { const d = ctx.project.data; if (!Array.isArray(d.maps)) d.maps = []; return d.maps; };
  const findSer = (id) => maps().find((o) => o && o.id === id);
  const findObj = (s) => (s && cur ? (cur.map[ARR[s.type]] || []).find((o) => o.id === s.id) : null);
  function entryFor(id) {
    const ser = findSer(id);
    if (!ser) return null;
    let e = cache.get(id);
    if (!e || e.ser !== ser) {   // belum didecode, atau data di project diganti dari luar (mis. dimuat ulang)
      const map = C.deserialize(ser);
      map.id = id;
      e = { map, hist: C.createHistory(map), ser };
      cache.set(id, e);
    }
    return e;
  }
  // tulis peta yang sedang dibuka ke project (sinkron)
  function writeCurrent() {
    if (!cur) return;
    const arr = maps(), ser = C.serialize(cur.map), i = arr.findIndex((o) => o && o.id === cur.map.id);
    if (i >= 0) arr[i] = ser; else arr.push(ser);
    cur.ser = ser;
  }
  // dipanggil setelah data peta berubah (kanvas 2D, inspektor, undo/redo)
  // in3d = false: perubahan tidak tampil di 3D (catatan, scene, nama wilayah/sungai/jalan) -> tanpa bangun ulang 3D
  function commit(redraw2d, in3d = true) {
    if (!cur) return;
    writeCurrent();
    if (in3d) { dirty3d = true; if (mode === "3d") schedule3d(250); }
    if (redraw2d) refresh2d();
    updateUndo();
    ctx.onChange();
  }
  function refresh2d() {
    if (!editor || refreshRaf) return;
    refreshRaf = requestAnimationFrame(() => { refreshRaf = 0; if (editor) editor.refresh(); });
  }

  // ---------- sidebar daftar peta + header ----------
  function setState(state) { document.querySelector("#tabMap .mp-main").dataset.state = state; }
  function renderList() {
    const q = $("mpSearch").value.trim().toLowerCase();
    const list = $("mpList");
    list.innerHTML = "";
    const items = maps().filter((m) => m && (!q || (m.title || "").toLowerCase().includes(q)));
    if (!items.length) {
      const empty = document.createElement("p");
      empty.className = "mp-empty";
      empty.textContent = maps().length ? "Tidak ada yang cocok." : "Belum ada peta.";
      list.appendChild(empty);
    }
    items.forEach((m) => {
      const b = document.createElement("button");
      b.className = "mp-item" + (cur && m.id === cur.map.id ? " is-current" : "");
      b.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20Z"/><path d="M9 4v13.5M15 6.5V20"/></svg><span></span>';
      b.querySelector("span").textContent = m.title || "(tanpa nama)";
      b.onclick = () => { if (!cur || cur.map.id !== m.id) openMap(m.id); };
      list.appendChild(b);
    });
  }
  function renderHead() {
    if (!cur) return;
    if (document.activeElement !== $("mpTitle")) $("mpTitle").value = cur.map.title || "";
    const km = cur.map.size * C.KM_PER_CELL;
    $("mpInfo").textContent = `${km} × ${km} km`;
  }
  function nextTitle() {
    const names = new Set(maps().map((m) => m && m.title));
    if (!names.has("Peta Baru")) return "Peta Baru";
    let i = 2; while (names.has("Peta Baru " + i)) i++;
    return "Peta Baru " + i;
  }
  function openMap(id) {
    cur = id ? entryFor(id) : null;
    selection = null; editKey = null; knownIds = null; hideInspector(); sel3d();
    renderList();
    if (!cur) {
      if (mode === "3d") setMode("2d");
      if (editor) editor.setMap(null);
      if (view3d) view3d.setMap(null);   // lepas geometri peta lama
      dirty3d = true;
      setState("empty");
      renderTools();
      return;
    }
    setState("ready");
    renderHead();
    ensureEditor();
    editor.setMap(cur.map);
    editor.setSelection(null);
    renderLayers();
    updateUndo();
    renderTools();   // popover alat (bioma, ukuran, ikon, ...) mengikuti peta yang baru dibuka
    updateScale(editor.getPxPerCell());
    dirty3d = true;
    if (mode === "3d") activate3d();
  }
  function newMap() {
    const map = C.createMap(nextTitle()), ser = C.serialize(map);
    maps().push(ser);
    cache.set(map.id, { map, hist: C.createHistory(map), ser });
    ctx.onChange();
    $("mpSearch").value = "";
    if (mode === "3d") setMode("2d");
    openMap(map.id);
    setTool("brush", true);   // peta baru = laut kosong: langsung siap melukis daratan
    // langsung ketik nama peta (perangkat ber-mouse saja; di HP keyboard tidak dibuka)
    if (!touchInput()) setTimeout(() => { if (cur && cur.map.id === map.id) { $("mpTitle").focus(); $("mpTitle").select(); } }, 0);
  }
  function deleteMap() {
    if (!cur || !confirm(`Hapus peta "${cur.map.title || "(tanpa nama)"}"? Tindakan ini tidak bisa dibatalkan.`)) return;
    const id = cur.map.id;
    ctx.project.data.maps = maps().filter((m) => !m || m.id !== id);
    cache.delete(id);
    cur = null;
    ctx.onChange();
    const first = maps()[0];
    openMap(first ? first.id : null);
  }

  // ---------- editor 2D ----------
  function ensureEditor() {
    if (editor) return;
    const box = $("mp2d");
    box.innerHTML = "";
    editor = window.NovelMap2D.create(box, {
      onBeforeChange: () => {
        if (!cur) return;
        cur.hist.checkpoint(); editKey = null;
        knownIds = new Set();
        Object.values(ARR).forEach((k) => (cur.map[k] || []).forEach((o) => knownIds.add(o.id)));
      },
      // map2d memanggil onSelect objek baru sinkron tepat setelah onChange; sesudah itu knownIds dibuang supaya
      // objek lama (mis. dipulihkan lewat undo) tidak dikira baru saat dipilih nanti
      onChange: () => { commit(false); queueMicrotask(() => { knownIds = null; }); },
      onSelect: (s) => select(s),
      onViewChange: (v) => updateScale(v && v.pxPerCell),
    });
    updateFitInsets();
    editor.setTool(prefs.tool);
    editor.setBrush({ biome: prefs.biome, size: prefs.size });
    editor.setElevation({ mode: prefs.elevMode, strength: prefs.elevStrength, size: prefs.elevSize });
    editor.setPlaceIcon(prefs.placeIcon);
    editor.setPathKind(prefs.pathKind);
  }

  // kanvas sempit & tegak (HP): peta dirapatkan ke atas, tepat di bawah baris Layers/3D, supaya ruang bawah untuk
  // popover alat & lembar inspektor tidak menutupi peta. Area fit tetap persegi selebar kanvas -> skala tidak berubah.
  // Kanvas lebar: tanpa inset (peta di tengah). setFitInsets opsional di map2d.js; hanya berlaku saat masih auto-fit.
  function updateFitInsets() {
    if (!editor || typeof editor.setFitInsets !== "function") return;
    const st = $("mpStage"), w = st.clientWidth, h = st.clientHeight, top = 48;
    if (!w || !h) return;   // tab / panggung tersembunyi
    const slack = h - top - w;
    editor.setFitInsets(w <= 760 && slack > 56 ? { top, bottom: slack } : {});
  }

  // ---------- skala "10 km" (panjang garis mengikuti zoom) ----------
  function updateScale(pxPerCell) {
    if (!(pxPerCell > 0)) return;
    const pxPerKm = pxPerCell / C.KM_PER_CELL;
    let km = SCALE_STEPS[0];
    SCALE_STEPS.forEach((s) => { if (s * pxPerKm <= 120) km = s; });
    $("mpScaleText").textContent = km + " km";
    $("mpScaleBar").style.width = Math.max(4, Math.round(km * pxPerKm)) + "px";
  }

  // ---------- 2D <-> 3D ----------
  function setMode(m) {
    if (m === mode || (m === "3d" && !cur)) return;
    mode = m;
    const is3d = m === "3d";
    $("mpStage").classList.toggle("is-3d", is3d);
    $("mp2d").classList.toggle("hidden", is3d);
    $("mp3d").classList.toggle("hidden", !is3d);
    const btn = $("mpViewToggle");
    btn.textContent = is3d ? "2D" : "3D";
    btn.title = is3d ? "Kembali ke peta 2D (edit)" : "Lihat sebagai 3D";
    btn.setAttribute("aria-label", btn.title);
    closeLayers();
    // toolbar bisa sudah tergeser (HP): di 3D mulai dari kiri, di 2D alat aktif digeser ke tampilan
    if (is3d) $("mpToolScroll").scrollLeft = 0;
    renderTools();
    if (is3d) { ensure3D(); return; }
    clearTimeout(refresh3dTimer);
    $("mpLoading3d").classList.add("hidden");
    if (view3d) view3d.setActive(false);
    if (editor) { editor.resize(); updateScale(editor.getPxPerCell()); }
  }
  function ensure3D() {
    if (view3d) { activate3d(); return; }
    if (!view3dLoading) {
      $("mpLoading3d").classList.remove("hidden");
      view3dLoading = import("./map3d.js")
        .then((mod) => {
          view3d = mod.createMap3D($("mp3d"), {
            onSelect: (s) => { select(s); if (editor) editor.setSelection(selection); },
          });
          dirty3d = true;
        })
        .catch((err) => {
          console.warn("Tampilan 3D gagal dimuat:", err);
          view3dLoading = null;
          if (typeof window.toast === "function") window.toast("Tampilan 3D gagal dimuat. Coba lagi nanti.");
          setMode("2d");
        })
        .finally(() => $("mpLoading3d").classList.add("hidden"));
    }
    view3dLoading.then(() => activate3d());
  }
  function activate3d() {
    if (!view3d) return;
    if (mode !== "3d" || !shown || !cur) { view3d.setActive(false); return; }
    if (dirty3d) { view3d.setMap(cur.map); dirty3d = false; }
    sel3d();
    view3d.setActive(true);
    view3d.resize();
  }
  function schedule3d(ms) {
    clearTimeout(refresh3dTimer);
    refresh3dTimer = setTimeout(() => {
      if (mode === "3d" && shown && view3d && cur) { view3d.setMap(cur.map); dirty3d = false; }
    }, ms || 0);
  }

  // ---------- layer ----------
  function renderLayers() {
    const pop = $("mpLayersPop");
    if (!pop.childElementCount) {
      C.LAYER_KEYS.forEach((k) => {
        const row = document.createElement("label");
        row.className = "mp-layer-row";
        row.innerHTML = '<input type="checkbox" /><span class="mp-switch" aria-hidden="true"></span><span></span>';
        row.lastElementChild.textContent = C.LAYER_NAMES[k];
        const input = row.querySelector("input");
        input.dataset.layer = k;
        input.addEventListener("change", () => setLayer(k, input.checked));
        pop.appendChild(row);
      });
    }
    if (!cur) return;
    pop.querySelectorAll("input").forEach((i) => { i.checked = cur.map.layers[i.dataset.layer] !== false; });
    const hidden = C.LAYER_KEYS.filter((k) => cur.map.layers[k] === false).length;
    $("mpLayersBtn").classList.toggle("has-hidden", hidden > 0);
  }
  function setLayer(k, on) {
    if (!cur) return;
    cur.map.layers[k] = !!on;
    if (editor) editor.setLayers(cur.map.layers);
    if (view3d) view3d.setLayers(cur.map.layers);
    if (!on && selection && ARR[selection.type] === k) clearSelection();
    renderLayers();
    writeCurrent();
    ctx.onChange();
  }
  // .is-open menaikkan popover di atas inspektor (di layar sempit lembar inspektor menutupi area popover)
  function openLayers() {
    $("mpLayersPop").classList.remove("hidden");
    $("mpLayersPop").parentElement.classList.add("is-open");
    $("mpLayersBtn").setAttribute("aria-expanded", "true");
    $("mpLayersBtn").classList.add("is-active");
  }
  function closeLayers() {
    const pop = $("mpLayersPop");
    pop.classList.add("hidden");
    pop.parentElement.classList.remove("is-open");
    $("mpLayersBtn").setAttribute("aria-expanded", "false");
    $("mpLayersBtn").classList.remove("is-active");
    if (pop.contains(document.activeElement)) document.activeElement.blur();   // fokus jangan tertinggal di sakelar tersembunyi
  }

  // ---------- alat + popover ----------
  // fromToolbar: klik alat yang sedang aktif = buka/tutup popover-nya
  function setTool(t, forceOpen, fromToolbar) {
    if (t !== "select" && !TOOL_LAYER[t]) return;
    if (prefs.tool === t && fromToolbar && !forceOpen) popOpen = !popOpen;
    else { popOpen = true; if (prefs.tool !== t) { prefs.tool = t; savePrefs(); } }
    if (editor) editor.setTool(t);
    const lk = TOOL_LAYER[t];
    if (lk && cur && cur.map.layers[lk] === false) setLayer(lk, true);   // alat tidak berguna kalau layernya tersembunyi
    renderTools();
  }
  function renderTools() {
    const bar = $("mpToolScroll");
    $("mpTools").querySelectorAll(".mp-tool").forEach((b) => {
      const on = b.dataset.tool === prefs.tool;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
      // toolbar bisa digeser mendatar (HP): pastikan alat aktif terlihat utuh (di luar tepi yang memudar)
      if (on && bar.scrollWidth > bar.clientWidth) {
        const l = b.offsetLeft, r = l + b.offsetWidth, m = 30;
        if (l - m < bar.scrollLeft) bar.scrollLeft = l - m;
        else if (r + m > bar.scrollLeft + bar.clientWidth) bar.scrollLeft = r - bar.clientWidth + m;
      }
    });
    renderToolPop();
    updateFade(bar);
  }
  // baris yang bisa digeser mendatar (HP: toolbar & palet bioma): sisi yang masih menyimpan isi dibuat memudar
  function updateFade(el) {
    const max = el.scrollWidth - el.clientWidth;
    el.classList.toggle("fade-l", max > 1 && el.scrollLeft > 1);
    el.classList.toggle("fade-r", max > 1 && el.scrollLeft < max - 1);
  }
  function renderToolPop() {
    const pop = $("mpToolPop"), t = prefs.tool;
    let any = false;
    pop.querySelectorAll(".mp-pop-sec").forEach((sec) => {
      const on = sec.dataset.tools.split(" ").includes(t);
      sec.classList.toggle("hidden", !on);
      any = any || on;
    });
    const hint = (isTouch() && TOOL_HINTS_TOUCH[t]) || TOOL_HINTS[t] || "";
    $("mpHint").textContent = hint;
    $("mpHint").classList.toggle("hidden", !hint);
    pop.dataset.tool = t;
    pop.classList.toggle("has-sec", any);   // ada kontrol: lebar popover mengikuti kontrol, petunjuk ikut membungkus
    pop.classList.toggle("hidden", !(cur && mode === "2d" && popOpen && (any || hint)));
    // nilai kontrol
    $("mpBiomes").querySelectorAll(".mp-biome").forEach((b) => {
      const on = Number(b.dataset.biome) === prefs.biome;
      b.classList.toggle("is-on", on); b.setAttribute("aria-checked", on ? "true" : "false");
    });
    $("mpElevMode").querySelectorAll("button").forEach((b) => {
      const on = b.dataset.mode === prefs.elevMode;
      b.classList.toggle("is-on", on); b.setAttribute("aria-checked", on ? "true" : "false");
    });
    $("mpElevStrength").value = prefs.elevStrength;
    $("mpElevStrengthVal").textContent = Math.round(prefs.elevStrength * 100) + "%";
    $("mpPlaceIcons").querySelectorAll("button").forEach((b) => {
      const on = b.dataset.icon === prefs.placeIcon;
      b.classList.toggle("is-on", on); b.setAttribute("aria-checked", on ? "true" : "false");
    });
    $("mpPathKind").querySelectorAll("button").forEach((b) => {
      const on = b.dataset.kind === prefs.pathKind;
      b.classList.toggle("is-on", on); b.setAttribute("aria-checked", on ? "true" : "false");
    });
    renderSize();
    updateFade($("mpBiomes"));
  }
  // pratinjau lingkaran ukuran kuas (diameter mengikuti ukuran; warna mengikuti bioma / alat)
  function renderSize() {
    const t = prefs.tool, size = t === "elevation" ? prefs.elevSize : prefs.size;
    $("mpSize").value = size;
    $("mpSizeVal").textContent = size + " km";
    const dot = $("mpSizeDot"), d = Math.round(8 + (size - 1) * 2.3);
    dot.style.width = dot.style.height = d + "px";
    dot.className = "mp-size-dot is-" + t + (t === "elevation" ? " is-" + prefs.elevMode : "");
    dot.style.background = t === "brush" ? (C.BIOMES[prefs.biome] || C.BIOMES[1]).color : "";
  }

  // pratinjau tekstur kecil tiap bioma (digambar sekali ke kanvas -> data URL)
  function biomeSwatch(b, idx) {
    const W = 72, H = 30, k = 2, cv = document.createElement("canvas");
    cv.width = W * k; cv.height = H * k;
    const g = cv.getContext("2d");
    g.scale(k, k);
    const r = (n) => C.hash2(idx * 53 + n, n * 7 + 11, 4242);
    const dots = (count, col, rMin, rMax, alpha) => {
      g.fillStyle = col; g.globalAlpha = alpha;
      for (let n = 0; n < count; n++) { g.beginPath(); g.arc(r(n) * W, r(n + 500) * H, rMin + r(n + 900) * (rMax - rMin), 0, TAU); g.fill(); }
      g.globalAlpha = 1;
    };
    const tree = (x, y, s, col, kind) => {
      g.fillStyle = "rgba(20,30,15,.28)";
      g.beginPath(); g.ellipse(x + s * 0.35, y + s * 0.55, s * 0.75, s * 0.35, 0, 0, TAU); g.fill();
      g.fillStyle = col;
      if (kind === "pine") { g.beginPath(); g.moveTo(x, y - s * 1.3); g.lineTo(x + s * 0.75, y + s * 0.5); g.lineTo(x - s * 0.75, y + s * 0.5); g.closePath(); g.fill(); }
      else { g.beginPath(); g.arc(x, y, s * 0.8, 0, TAU); g.fill(); g.fillStyle = "rgba(255,255,255,.18)"; g.beginPath(); g.arc(x - s * 0.25, y - s * 0.25, s * 0.35, 0, TAU); g.fill(); }
    };
    g.fillStyle = b.color; g.fillRect(0, 0, W, H);
    switch (b.key) {
      case "sea":
        dots(26, b.alt, 3, 8, 0.32);
        g.strokeStyle = "rgba(230,242,248,.35)"; g.lineWidth = 1;
        for (let n = 0; n < 4; n++) { const x = r(n + 40) * W, y = 5 + r(n + 60) * (H - 10); g.beginPath(); g.arc(x, y, 4, Math.PI * 1.1, Math.PI * 1.9); g.stroke(); }
        break;
      case "farmland": {
        const tones = [b.color, b.alt, "#d6c46f", "#b3c063", "#c1d07c", "#bb9c60"];
        g.save(); g.translate(W / 2, H / 2); g.rotate(-0.18);
        for (let y = -3; y < 3; y++) for (let x = -5; x < 5; x++) { g.fillStyle = tones[Math.floor(r(x * 7 + y * 13 + 80) * tones.length)]; g.fillRect(x * 11, y * 9, 10.2, 8.2); }
        g.strokeStyle = "rgba(110,120,60,.55)"; g.lineWidth = 0.8;
        for (let y = -3; y < 3; y++) { g.beginPath(); g.moveTo(-60, y * 9 - 0.4); g.lineTo(60, y * 9 - 0.4); g.stroke(); }
        g.restore();
        break;
      }
      case "grassland":
        dots(30, b.alt, 1, 3, 0.6);
        g.strokeStyle = "#93a25a"; g.lineWidth = 0.9;
        for (let n = 0; n < 12; n++) { const x = r(n + 30) * W, y = r(n + 70) * H; g.beginPath(); g.moveTo(x - 1.5, y - 2); g.lineTo(x, y); g.lineTo(x + 1.5, y - 2); g.stroke(); }
        tree(52, 12, 3, "#6b9446"); tree(18, 21, 2.6, "#6b9446");
        break;
      case "forest": case "pine": case "jungle": {
        dots(20, b.alt, 2, 5, 0.5);
        const kind = b.key === "pine" ? "pine" : "broad", cols = { forest: ["#4b7a37", "#5c8c43", "#3f6a2f"], pine: ["#2f5034", "#3a5f3e", "#284530"], jungle: ["#2c6a25", "#3f8a33", "#25591f"] }[b.key];
        const step = b.key === "jungle" ? 6.5 : 8;
        for (let y = 4; y < H + 4; y += step * 0.8) for (let x = 2; x < W + 4; x += step) {
          const n = Math.round(x * 3 + y * 17), jx = (r(n) - 0.5) * 4, jy = (r(n + 3) - 0.5) * 3;
          tree(x + jx + ((y / step) % 2 ? step / 2 : 0), y + jy, b.key === "jungle" ? 3.6 : 3.1, cols[Math.floor(r(n + 9) * 3)], kind);
        }
        break;
      }
      case "marsh":
        dots(14, b.alt, 3, 6, 0.6);
        dots(6, "#6c8d86", 2, 4, 0.9);
        g.strokeStyle = "#5d7048"; g.lineWidth = 0.9;
        for (let n = 0; n < 16; n++) { const x = r(n + 20) * W, y = 4 + r(n + 45) * (H - 4); g.beginPath(); g.moveTo(x, y); g.lineTo(x - 1, y - 4); g.moveTo(x, y); g.lineTo(x + 1.5, y - 3.5); g.stroke(); }
        break;
      case "desert":
        dots(18, b.alt, 2, 5, 0.45);
        g.strokeStyle = "rgba(170,130,70,.55)"; g.lineWidth = 1;
        for (let n = 0; n < 6; n++) { const x = r(n + 5) * W, y = 4 + r(n + 15) * (H - 6); g.beginPath(); g.arc(x, y + 6, 8, Math.PI * 1.25, Math.PI * 1.75); g.stroke(); }
        break;
      case "tundra":
        dots(26, b.alt, 1.5, 4, 0.7);
        dots(10, "#f6f8f8", 1, 2.5, 0.9);
        tree(50, 16, 2.6, "#4d6650", "pine"); tree(22, 22, 2.2, "#4d6650", "pine");
        break;
      case "cracklands":
        dots(16, b.alt, 2, 5, 0.5);
        g.strokeStyle = "rgba(142,92,52,.8)"; g.lineWidth = 0.9;
        for (let n = 0; n < 7; n++) {
          let x = r(n + 3) * W, y = r(n + 33) * H;
          g.beginPath(); g.moveTo(x, y);
          for (let s = 0; s < 3; s++) { x += (r(n * 5 + s) - 0.5) * 14; y += (r(n * 5 + s + 50) - 0.5) * 10; g.lineTo(x, y); }
          g.stroke();
        }
        break;
      case "mountains": {
        g.fillStyle = "#a8a296"; g.fillRect(0, 0, W, H);
        const peaks = [[14, 25, 11, 15], [36, 27, 14, 20], [58, 25, 11, 15], [25, 31, 9, 11], [48, 32, 9, 11]];
        peaks.forEach(([x, base, w, h]) => {
          const top = base - h;
          g.fillStyle = "#c6c0b4"; g.beginPath(); g.moveTo(x - w, base); g.lineTo(x, top); g.lineTo(x, base); g.closePath(); g.fill();
          g.fillStyle = "#7d776c"; g.beginPath(); g.moveTo(x, top); g.lineTo(x + w, base); g.lineTo(x, base); g.closePath(); g.fill();
          if (h > 13) { g.fillStyle = "#f8f9fa"; g.beginPath(); g.moveTo(x, top); g.lineTo(x - w * 0.3, top + h * 0.3); g.lineTo(x + w * 0.3, top + h * 0.3); g.closePath(); g.fill(); }
          g.strokeStyle = "rgba(58,52,44,.7)"; g.lineWidth = 0.8; g.beginPath(); g.moveTo(x - w, base); g.lineTo(x, top); g.lineTo(x + w, base); g.stroke();
        });
        break;
      }
      default:
        dots(20, b.alt || b.color, 2, 5, 0.5);
    }
    return cv.toDataURL("image/png");
  }
  const placeIconSvg = (key, size) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PLACE_SVG[key] || PLACE_SVG.landmark}</svg>`;
  function buildToolPop() {
    const grid = $("mpBiomes");
    C.BIOMES.forEach((b, i) => {
      const btn = document.createElement("button");
      btn.className = "mp-biome"; btn.dataset.biome = i; btn.title = b.name;
      btn.setAttribute("role", "radio");
      btn.innerHTML = '<span class="mp-biome-img"></span><span class="mp-biome-name"></span>';
      btn.firstChild.style.backgroundImage = `url("${biomeSwatch(b, i)}")`;
      btn.lastChild.textContent = b.name;
      btn.onclick = () => {
        prefs.biome = i; savePrefs();
        if (editor) editor.setBrush({ biome: i });
        renderToolPop();
      };
      grid.appendChild(btn);
    });
    const icons = $("mpPlaceIcons");
    C.PLACE_ICONS.forEach((ic) => {
      const btn = document.createElement("button");
      btn.className = "mp-icon-btn"; btn.dataset.icon = ic.key; btn.title = ic.name;
      btn.setAttribute("role", "radio");
      btn.innerHTML = placeIconSvg(ic.key, 18) + "<span></span>";
      btn.lastChild.textContent = ic.name;
      btn.onclick = () => { prefs.placeIcon = ic.key; savePrefs(); if (editor) editor.setPlaceIcon(ic.key); renderToolPop(); };
      icons.appendChild(btn);
    });
    $("mpElevMode").querySelectorAll("button").forEach((b) => {
      b.onclick = () => { prefs.elevMode = b.dataset.mode; savePrefs(); if (editor) editor.setElevation({ mode: prefs.elevMode }); renderToolPop(); };
    });
    $("mpElevStrength").addEventListener("input", () => {
      prefs.elevStrength = C.clamp(Number($("mpElevStrength").value) || 0.5, 0.05, 1);
      $("mpElevStrengthVal").textContent = Math.round(prefs.elevStrength * 100) + "%";
      if (editor) editor.setElevation({ strength: prefs.elevStrength });
    });
    $("mpElevStrength").addEventListener("change", savePrefs);
    $("mpPathKind").querySelectorAll("button").forEach((b) => {
      b.onclick = () => { prefs.pathKind = b.dataset.kind; savePrefs(); if (editor) editor.setPathKind(prefs.pathKind); renderToolPop(); };
    });
    $("mpSize").addEventListener("input", () => {
      const v = C.clamp(Math.round(Number($("mpSize").value) || 1), 1, 20);
      if (prefs.tool === "elevation") { prefs.elevSize = v; if (editor) editor.setElevation({ size: v }); }
      else { prefs.size = v; if (editor) editor.setBrush({ size: v }); }
      renderSize();
    });
    $("mpSize").addEventListener("change", savePrefs);
  }

  // ---------- pilihan + panel inspektor ----------
  function select(s) {
    const o = s && s.type && ARR[s.type] ? findObj(s) : null;
    const fresh = !!o && !!knownIds && !knownIds.has(o.id);
    knownIds = null;
    selection = o ? { type: s.type, id: s.id } : null;
    editKey = null;
    sel3d();
    if (!selection) { hideInspector(); return; }
    fillInspector();
    // objek baru (tempat/label/wilayah) -> langsung ketik namanya (hanya input mouse; dengan sentuhan keyboard tidak dibuka)
    if (fresh && /^(place|label|zone)$/.test(selection.type) && !touchInput()) {
      const input = $(selection.type === "label" ? "mpInText" : "mpInName");
      setTimeout(() => { if (!$("mpInspector").classList.contains("hidden")) { input.focus(); input.select(); } }, 0);
    }
  }
  function clearSelection() {
    selection = null; editKey = null;
    if (editor) editor.setSelection(null);
    sel3d();
    hideInspector();
  }
  // sorot pin terpilih di 3D (setSelection opsional di map3d.js)
  function sel3d() { if (view3d && typeof view3d.setSelection === "function") view3d.setSelection(selection); }
  const setSeg = (id, attr, val) => $(id).querySelectorAll("button").forEach((b) => {
    const on = b.dataset[attr] === val;
    b.classList.toggle("is-on", on); b.setAttribute("aria-checked", on ? "true" : "false");
  });
  function fillScenes(o) {
    const sel = $("mpInScene"), scenes = ctx.getScenes();
    sel.innerHTML = '<option value="">— tidak ada —</option>';
    scenes.forEach((s) => { const op = document.createElement("option"); op.value = s.id; op.textContent = s.title || "(tanpa judul)"; sel.appendChild(op); });
    const exists = !!o.sceneId && scenes.some((s) => s.id === o.sceneId);
    sel.value = exists ? o.sceneId : "";
    $("mpInOpenScene").disabled = !exists;
  }
  function fillInspector() {
    const o = findObj(selection);
    if (!o) { hideInspector(); return; }
    const t = selection.type, insp = $("mpInspector");
    insp.dataset.type = t;
    $("mpInspType").textContent = TYPE_NAMES[t];
    insp.querySelectorAll("[data-for]").forEach((el) => el.classList.toggle("hidden", !el.dataset.for.split(" ").includes(t)));
    if (t === "label") {
      $("mpInText").value = o.text || "";
      $("mpInSize").value = o.size || 4; $("mpInSizeVal").textContent = (Number(o.size) || 4) + " km";
      $("mpInRot").value = o.rotation || 0; $("mpInRotVal").textContent = Math.round(o.rotation || 0) + "°";
      setSeg("mpInStyle", "style", o.style || "region");
    } else {
      $("mpInName").value = o.name || "";
    }
    if (t === "place") {
      $("mpInIcons").querySelectorAll("button").forEach((b) => {
        const on = b.dataset.icon === (o.icon || "city");
        b.classList.toggle("is-on", on); b.setAttribute("aria-checked", on ? "true" : "false");
      });
      fillScenes(o);
    }
    if (t === "place" || t === "zone") $("mpInDesc").value = o.desc || "";
    if (t === "zone") $("mpInColors").querySelectorAll("button").forEach((b) => {
      const on = b.dataset.color === o.color;
      b.classList.toggle("is-on", on); b.setAttribute("aria-checked", on ? "true" : "false");
    });
    if (t === "river") { $("mpInWidth").value = o.width || 1.5; $("mpInWidthVal").textContent = (Number(o.width) || 1.5).toFixed(1) + " km"; }
    if (t === "path") setSeg("mpInKind", "kind", o.kind === "trail" ? "trail" : "road");
    insp.classList.remove("hidden");
    $("mpStage").classList.add("has-inspector");
  }
  function hideInspector() {
    $("mpInspector").classList.add("hidden");
    $("mpStage").classList.remove("has-inspector");
  }
  // field yang tidak digambar: catatan & scene tidak tampil di peta; nama sungai/jalan tidak digambar,
  // nama wilayah hanya di 2D -> tidak perlu gambar ulang 2D / bangun ulang 3D tiap ketukan
  const shows2d = (type, field) => field !== "desc" && field !== "scene" && !(field === "name" && (type === "river" || type === "path"));
  const shows3d = (type, field) => shows2d(type, field) && !(field === "name" && type === "zone");
  // edit dari inspektor: checkpoint undo sekali per sesi (field + objek yang sama), lalu tulis & gambar ulang
  function inspEdit(field, fn, discrete) {
    return (ev) => {
      const o = findObj(selection);
      if (!o) return;
      const key = field + ":" + selection.id;
      if (discrete || editKey !== key) cur.hist.checkpoint();
      editKey = discrete ? null : key;
      fn(o, ev);
      commit(shows2d(selection.type, field), shows3d(selection.type, field));
    };
  }
  function bindInspector() {
    const endSession = () => { editKey = null; };
    const text = (id, field, apply) => {
      $(id).addEventListener("input", inspEdit(field, (o) => apply(o, $(id).value)));
      $(id).addEventListener("change", endSession);
    };
    text("mpInName", "name", (o, v) => { o.name = v; });
    text("mpInText", "text", (o, v) => { o.text = v; });
    // Enter / Esc di kolom satu baris = selesai mengetik (kembali ke peta)
    ["mpInName", "mpInText"].forEach((id) => $(id).addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === "Escape") { e.preventDefault(); e.stopPropagation(); $(id).blur(); }
    }));
    text("mpInDesc", "desc", (o, v) => { o.desc = v; });
    const range = (id, field, apply) => {
      $(id).addEventListener("input", inspEdit(field, (o) => apply(o, Number($(id).value))));
      $(id).addEventListener("change", endSession);
    };
    range("mpInSize", "size", (o, v) => { o.size = v; $("mpInSizeVal").textContent = v + " km"; });
    range("mpInRot", "rotation", (o, v) => { o.rotation = v; $("mpInRotVal").textContent = v + "°"; });
    range("mpInWidth", "width", (o, v) => { o.width = v; $("mpInWidthVal").textContent = v.toFixed(1) + " km"; });
    $("mpInStyle").querySelectorAll("button").forEach((b) => {
      b.onclick = inspEdit("style", (o) => { o.style = b.dataset.style; setSeg("mpInStyle", "style", o.style); }, true);
    });
    $("mpInKind").querySelectorAll("button").forEach((b) => {
      b.onclick = inspEdit("kind", (o) => { o.kind = b.dataset.kind; setSeg("mpInKind", "kind", o.kind); }, true);
    });
    const icons = $("mpInIcons");
    C.PLACE_ICONS.forEach((ic) => {
      const btn = document.createElement("button");
      btn.className = "mp-icon-btn"; btn.dataset.icon = ic.key; btn.title = ic.name;
      btn.setAttribute("role", "radio"); btn.setAttribute("aria-label", ic.name);
      btn.innerHTML = placeIconSvg(ic.key, 17);
      btn.onclick = inspEdit("icon", (o) => { o.icon = ic.key; fillInspector(); }, true);
      icons.appendChild(btn);
    });
    const colors = $("mpInColors");
    C.ZONE_COLORS.forEach((c) => {
      const btn = document.createElement("button");
      btn.className = "mp-color"; btn.dataset.color = c; btn.style.background = c;
      btn.setAttribute("role", "radio"); btn.setAttribute("aria-label", "Warna " + c); btn.title = c;
      btn.onclick = inspEdit("color", (o) => { o.color = c; fillInspector(); }, true);
      colors.appendChild(btn);
    });
    $("mpInScene").addEventListener("change", inspEdit("scene", (o) => {
      o.sceneId = $("mpInScene").value;
      $("mpInOpenScene").disabled = !o.sceneId;
    }, true));
    $("mpInOpenScene").onclick = () => { const o = findObj(selection); if (o && o.sceneId) ctx.openScene(o.sceneId); };
    $("mpInDelete").onclick = deleteSelected;
    $("mpInspClose").onclick = clearSelection;
  }
  // hapus objek terpilih (tombol Hapus inspektor; Delete/Backspace di 3D — di 2D ditangani map2d)
  function deleteSelected() {
    const o = findObj(selection);
    if (!o) return;
    cur.hist.checkpoint();
    const arr = cur.map[ARR[selection.type]];
    arr.splice(arr.indexOf(o), 1);
    clearSelection();
    commit(true);
  }

  // ---------- undo / redo ----------
  function updateUndo() {
    $("mpUndo").disabled = !(cur && cur.hist.canUndo);
    $("mpRedo").disabled = !(cur && cur.hist.canRedo);
  }
  function undoRedo(redo) {
    if (!cur || !(redo ? cur.hist.redo() : cur.hist.undo())) return;
    editKey = null; knownIds = null;
    if (editor) editor.refresh();
    commit(false);
    if (mode === "3d") schedule3d(0);
    if (selection && findObj(selection)) fillInspector();
    else if (selection) clearSelection();
  }

  // ---------- keyboard ----------
  // hanya kolom teks yang dianggap "mengetik"; slider & sakelar layer yang masih fokus tidak memblok shortcut
  const isTyping = (t) => !!t && (t.isContentEditable || t.tagName === "TEXTAREA" || t.tagName === "SELECT" ||
    (t.tagName === "INPUT" && !/^(range|checkbox|radio|button|submit|reset|color)$/i.test(t.type)));
  function mapVisible() {
    const tab = $("tabMap"), view = $("editorView");
    return shown && !!cur && !tab.classList.contains("hidden") && !(view && view.classList.contains("hidden"));
  }
  function onKeyDown(e) {
    // Esc menutup popover layer saja (pilihan di peta tidak ikut dilepas)
    if (e.key === "Escape" && !$("mpLayersPop").classList.contains("hidden")) { e.stopPropagation(); closeLayers(); return; }
    if (!mapVisible()) return;
    // modal app (pratinjau, backup, dll.) atau sidebar project menutupi peta: tombol tidak diteruskan ke editor peta
    // (mis. Delete tidak menghapus objek terpilih di belakang modal); Ctrl/Cmd+S app tetap jalan
    const side = $("projSidebar");
    if (document.querySelector(".modal:not(.hidden)") || (side && side.classList.contains("is-open"))) {
      if (!e.ctrlKey && !e.metaKey) e.stopPropagation();
      return;
    }
    if (e.defaultPrevented || isTyping(e.target) || isTyping(document.activeElement)) return;
    const k = (e.key || "").toLowerCase();
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      if (k === "z") { e.preventDefault(); undoRedo(e.shiftKey); }
      else if (k === "y") { e.preventDefault(); undoRedo(true); }
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    // Delete/Backspace = hapus objek terpilih. Di 2D biasanya ditangani map2d, kecuali fokus masih di slider/sakelar
    // (map2d mengabaikan tombol dari INPUT); di 3D map2d tidak aktif
    if ((e.key === "Delete" || e.key === "Backspace") && selection && (mode === "3d" || e.target.tagName === "INPUT")) {
      e.preventDefault(); deleteSelected(); return;
    }
    if (mode !== "2d") return;
    if (TOOL_KEYS[k]) { e.preventDefault(); if (prefs.tool !== TOOL_KEYS[k]) setTool(TOOL_KEYS[k]); }
  }
  function onDocPointerDown(e) {
    lastTouch = e.pointerType !== "mouse";
    if ($("mpLayersPop").classList.contains("hidden")) return;
    if (!e.target.closest || !e.target.closest(".mp-layers")) closeLayers();
  }

  function bindOnce() {
    if (bound) return;
    bound = true;
    $("mpSearch").addEventListener("input", renderList);
    $("mpNew").onclick = newMap;
    $("mpCreateFirst").onclick = newMap;
    $("mpTitle").addEventListener("input", () => {
      if (!cur) return;
      cur.map.title = $("mpTitle").value;
      writeCurrent(); renderList(); ctx.onChange();
    });
    $("mpTitle").addEventListener("keydown", (e) => { if (e.key === "Enter") $("mpTitle").blur(); });
    $("mpDelete").onclick = deleteMap;

    $("mpLayersBtn").onclick = () => ($("mpLayersPop").classList.contains("hidden") ? openLayers() : closeLayers());
    $("mpViewToggle").onclick = () => setMode(mode === "3d" ? "2d" : "3d");
    $("mpZoomIn").onclick = () => { if (mode === "3d") { if (view3d) view3d.zoomBy(1.3); } else if (editor) editor.zoomBy(1.3); };
    $("mpZoomOut").onclick = () => { if (mode === "3d") { if (view3d) view3d.zoomBy(1 / 1.3); } else if (editor) editor.zoomBy(1 / 1.3); };
    $("mpFit").onclick = () => { if (mode === "3d") { if (view3d) view3d.resetCamera(); } else if (editor) editor.fit(); };
    $("mpTools").querySelectorAll(".mp-tool").forEach((b) => { b.onclick = () => setTool(b.dataset.tool, false, true); });
    // klik di kanvas: lepas fokus dari kolom/tombol panel (akhiri pengetikan di inspektor, dan Spasi untuk geser peta
    // tidak ikut "menekan" tombol alat yang terakhir diklik)
    $("mp2d").addEventListener("pointerdown", () => {
      const a = document.activeElement;
      if (a && a !== document.body && $("tabMap").contains(a) && !$("mp2d").contains(a)) a.blur();
    }, true);
    // ketukan jari di kanvas 2D/3D: batalkan mouse & klik "kompatibilitas" yang dikirim browser SETELAH touchend.
    // Tanpa ini klik itu jatuh ke panel yang baru muncul di bawah jari (inspektor/popover): ikon berganti,
    // keyboard terbuka, bahkan tombol Hapus tertekan. Kanvas sendiri hanya memakai pointer event.
    const noGhostClick = (e) => { if (e.cancelable) e.preventDefault(); };
    $("mp2d").addEventListener("touchend", noGhostClick, { passive: false });
    $("mp3d").addEventListener("touchend", noGhostClick, { passive: false });
    $("mpUndo").onclick = () => undoRedo(false);
    $("mpRedo").onclick = () => undoRedo(true);
    $("mp3dHintText").textContent = isTouch() ? "1 jari memutar · 2 jari geser & zoom" : "Seret untuk memutar · klik kanan untuk menggeser";

    ["mpToolScroll", "mpBiomes"].forEach((id) => $(id).addEventListener("scroll", () => updateFade($(id)), { passive: true }));
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(() => { updateFade($("mpToolScroll")); updateFade($("mpBiomes")); });
      ro.observe($("mpToolScroll")); ro.observe($("mpBiomes"));
      new ResizeObserver(updateFitInsets).observe($("mpStage"));
    }
    buildToolPop();
    bindInspector();
    renderLayers();
    renderTools();
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onDocPointerDown, true);
  }

  window.NovelMap = {
    // dipanggil setiap kali tab Map dibuka
    show(c) {
      const sameProject = !!ctx && ctx.project === c.project;
      ctx = c;
      shown = true;
      bindOnce();
      if (!sameProject) {
        cache.clear(); cur = null; selection = null;
        $("mpSearch").value = "";
        if (mode === "3d") setMode("2d");
      }
      const arr = maps();
      const keepId = cur && findSer(cur.map.id) ? cur.map.id : (arr.find((m) => m && m.id) || {}).id;
      if (!keepId) { openMap(null); return; }
      if (!cur || cur.map.id !== keepId || findSer(keepId) !== cur.ser) { openMap(keepId); return; }
      // peta yang sama masih terbuka: cukup segarkan daftar, header & inspektor (judul scene bisa berubah)
      setState("ready");
      renderList(); renderHead();
      if (selection && findObj(selection)) fillInspector(); else if (selection) clearSelection();
      if (editor) editor.resize();
      if (mode === "3d") activate3d();
    },
    // dipanggil saat tab Map ditinggalkan: hentikan render loop 3D
    hide() {
      if (!shown) return;
      shown = false;
      clearTimeout(refresh3dTimer);
      if (view3d) view3d.setActive(false);
      closeLayers();
    },
    // tulis data peta terbaru ke project (biasanya sudah sinkron; ini jaring pengaman sebelum simpan)
    flush() {
      if (!ctx || !cur || !findSer(cur.map.id)) return;
      if (ctx.project.data.maps && cur.ser !== findSer(cur.map.id)) return;   // data di project lebih baru dari luar
      writeCurrent();
    },
  };
})();
