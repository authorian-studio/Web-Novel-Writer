/* ==========================================================================================================
   Novelist — SCROLL HALUS + SCROLLBAR MODERN (smooth-scroll.js + smooth-scroll.css)
   - Scrollbar overlay buatan sendiri: thumb tipis (pil) mengambang di tepi kanan area scroll, tidak memakan lebar isi.
     Kaca transparan di tema gelap, gelap di tema terang; melebar 4 → 8 px & berwarna aksen saat kursor mendekat /
     diseret; hilang sendiri ±1 dtk setelah diam, muncul lagi saat scroll / kursor bergerak di area itu.
     Thumb bisa diseret (pointer capture: mouse, sentuh, pena); klik di track = lompat halus ke titik itu.
   - Scroll halus roda mouse/trackpad: Lenis (vendor/lenis-1.3.26.min.js, lenis.dev, MIT). Satu instance per area,
     SATU loop requestAnimationFrame bersama yang berhenti total saat semua area diam (tanpa CPU saat idle).
     Sentuhan, keyboard, caret editor, cari-di-halaman, anchor & scrollIntoView tetap native (Lenis menyesuaikan diri).
   - Lenis mati (scrollbar custom tetap) saat prefers-reduced-motion, body.perf-boost, atau tanpa pointer halus (HP).
   - Area dipasang otomatis dari REGISTRY (selector) + MutationObserver (juga elemen yang muncul belakangan), atau:
       atribut  data-ns-scroll           → ikut (nilai "bar" = scrollbar saja tanpa Lenis, "x" = juga bar horizontal)
       atribut  data-ns-ignore           → jangan pernah dipasang walau cocok registry
       atribut  data-lenis-prevent       → di DALAM area: roda mouse di elemen ini tidak dihaluskan (native)
   - API: window.NovelScroll = { attach(el, opts), detach(el), refresh(el?), scrollTo(elOrContainer, target, opts),
          get(el), register(selector, opts), show(el, ms), stats(), debug(el) }
       opts attach: { smooth: false (scrollbar saja), x: true|false (bar horizontal), lerp, wheelMultiplier }
   ========================================================================================================== */
(function () {
  "use strict";
  if (window.NovelScroll) return;
  const doc = document;

  // ---------- area scroll yang dipasang otomatis (cek: README / laporan; aman bila selector tidak ada) ----------
  const REGISTRY = [
    // Quill (quill.js / quill-tiles.js): layar pustaka, buat/edit, halaman cerita, terbitkan; editor; sidebar; panel kanan
    ".qd-lib", ".qd-create", ".qd-story", ".qd-publish", ".qd-main-scroll", ".qd-side-list", ".qd-panel-body", ".qd-chl",
    ".qdt-cards", ".qdt-dlg-body", ".qdt-pop-content", ".qdt-dr-list", ".qdt-dr-paper", ".qdt-flow-side",
    // Pengaturan Akun
    "#accountView",
    // tab Write & Organize: daftar scene/item, kolom detail/editor, isi laci Scene Settings; mode fokus
    ".scenes-list", ".scene-detail-col", ".drawer-body", ".focus-editor",
    // Timeline & Map: daftar kiri, panel editor/inspektor, popover alat
    ".tl-list", ".tl-editor", ".mp-list", ".mp-inspector", ".mp-toolpop",
    // dashboard, sidebar project, Cloud Library
    "#dashBody", ".dash-shelf", ".proj-side-list", "#cloudTabContent",
    // TAB PROJECT: sidebar tab (riwayat), jendela "Tambah tab", layar tab kosong (app.js juga memanggil attach)
    ".tsb-scroll", ".tp-grid", ".tab-empty",
    // modal yang bisa panjang (bantuan, hapus akun, backup, preview, ...)
    ".modal-box", ".support-list", ".backup-list", ".preview-content",
  ];
  const extraOpts = new Map();   // selector tambahan dari register() -> opsi
  const baseSel = () => REGISTRY.concat([...extraOpts.keys()], ["[data-ns-scroll]", "[data-ns-host]"]).join(",");
  let SEL = baseSel();

  // elemen di dalam area yang butuh roda mouse mentah / scroll sendiri → Lenis tidak ikut campur
  const PREVENT = "textarea, select, input, canvas, iframe, video, .react-flow, .nowheel, [data-ns-prevent], " +
    "[role='listbox'], [role='menu'], .dropdown, .qd-menu";

  // ---------- konstanta tampilan ----------
  const HIDE_MS = 1000;   // thumb hilang setelah diam
  const EDGE = 16;        // jarak kursor dari tepi (px) yang menyalakan track
  const TRACK = 12;       // tebal area klik track (px)
  const GAP = 2;          // jarak track dari tepi area
  const MIN_THUMB = 28;   // tinggi thumb minimum
  const LERP = 0.12;      // kehalusan Lenis (0.1 = bawaan Lenis; makin besar makin cepat)

  const mqReduce = matchMedia("(prefers-reduced-motion: reduce)");
  const mqFine = matchMedia("(any-pointer: fine)");
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const now = () => performance.now();
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const isScrollStyle = (v) => v === "auto" || v === "scroll" || v === "overlay";

  const map = new WeakMap();   // elemen -> instance
  const all = new Set();
  let layer = null;            // lapisan tetap berisi semua track (di atas aplikasi, pointer-events hanya pada track aktif)

  function getLayer() {
    if (!layer || !layer.isConnected) {
      layer = doc.createElement("div");
      layer.className = "ns-layer";
      layer.setAttribute("aria-hidden", "true");
      doc.body.appendChild(layer);
    }
    return layer;
  }
  const inLayer = (n) => !!(layer && n && layer.contains(n));

  // Lenis boleh jalan?
  function smoothAllowed() {
    return typeof window.Lenis === "function" && !mqReduce.matches && mqFine.matches && !doc.body.classList.contains("perf-boost");
  }

  /* ============================== LOOP rAF BERSAMA (tidur saat diam) ============================== */
  const active = new Set();   // instance yang sedang beranimasi
  let rafId = 0, lastT = 0, frames = 0;
  function wake(inst) {
    active.add(inst);
    if (!rafId) rafId = requestAnimationFrame(loop);
  }
  function loop(t) {
    rafId = 0; frames++;
    // jam virtual per instance: selisih antar-frame dibatasi supaya bangun dari tidur tidak "melompat"
    const dt = lastT ? clamp(t - lastT, 0, 100) : 1000 / 60;
    lastT = t;
    for (const inst of active) {
      const L = inst.lenis;
      if (!L) { active.delete(inst); continue; }
      inst.clock += dt;
      L.raf(inst.clock);
      // browser memotong posisi (isi menyusut di tengah animasi) → berhenti di posisi nyata, jangan "berjalan di udara"
      if (L.isSmooth && Math.abs(inst.el.scrollTop - L.animatedScroll) > 3) L.reset();
      if (!L.isSmooth && !L.animate.isRunning) active.delete(inst);
    }
    if (active.size) rafId = requestAnimationFrame(loop);
    else lastT = 0;
  }

  /* ============================== LENIS PER AREA ============================== */
  function syncSmooth(inst) {
    const want = inst.opts.smooth !== false && smoothAllowed();
    if (want && !inst.lenis) startLenis(inst);
    else if (!want && inst.lenis) stopLenis(inst);
  }
  function startLenis(inst) {
    const el = inst.el;
    let L;
    try {
      L = new window.Lenis({
        wrapper: el, content: el, eventsTarget: el,
        autoResize: false, naiveDimensions: true,   // batas scroll dibaca langsung (scrollHeight) → selalu benar saat isi bertambah
        smoothWheel: true, syncTouch: false,        // sentuhan tetap native
        lerp: inst.opts.lerp || LERP, wheelMultiplier: inst.opts.wheelMultiplier || 1,
        orientation: "vertical", gestureOrientation: "vertical",
        anchors: false, autoRaf: false, allowNestedScroll: true, overscroll: true,
        prevent: (node) => !!(node.matches && node.matches(PREVENT)),
        virtualScroll: (d) => wheelGate(inst, d),
      });
    } catch (e) { console.warn("[NovelScroll] Lenis gagal:", e); return; }
    inst.lenis = L;
    inst.clock = 1;
    L.raf(1);
    // semua scrollTo (roda mouse maupun program) membangunkan loop bersama
    const orig = L.scrollTo;
    L.scrollTo = function () {
      const r = orig.apply(L, arguments);
      if (L.isSmooth || L.animate.isRunning) wake(inst);
      return r;
    };
    // posisi thumb diperbarui di frame yang sama dengan isi (tanpa telat 1 frame)
    inst.offLenis = L.on("scroll", () => { if (L.isSmooth) activity(inst); });
  }
  function stopLenis(inst) {
    const L = inst.lenis;
    if (!L) return;
    active.delete(inst);
    if (inst.offLenis) inst.offLenis();
    inst.offLenis = null;
    inst.lenis = null;
    try { L.destroy(); } catch (e) { /* abaikan */ }
  }

  // Lenis hanya mengambil alih roda mouse vertikal yang memang bisa menggulir area ini
  function wheelGate(inst, d) {
    const e = d.event;
    if (!e || e.type !== "wheel") return false;               // sentuhan: native
    // setelan berubah tanpa event (mis. media query di beberapa browser) → matikan Lenis setelah event ini
    if (!smoothAllowed()) { queueMicrotask(resyncAll); return false; }
    if (e.defaultPrevented || e.ctrlKey) return false;         // sudah dipakai elemen lain / zoom (Ctrl+roda, pinch)
    if (Math.abs(d.deltaX) > Math.abs(d.deltaY)) return false; // gestur horizontal: native
    readStyle(inst);
    if (!inst.ovY) return false;                               // overflow hidden: jangan digulir
    const el = inst.el, max = el.scrollHeight - el.clientHeight;
    if (max <= 1) return false;                                // tidak bisa digulir → biar area luar yang bergulir
    const L = inst.lenis;
    if (L && !L.isSmooth) {
      const st = el.scrollTop;
      // sudah di ujung & arah keluar: teruskan ke area luar (seperti scroll chaining native)
      if ((d.deltaY < 0 && st <= 0.5) || (d.deltaY > 0 && st >= max - 0.5)) return false;
      // posisi berubah tanpa sepengetahuan Lenis (dipotong browser, dll.) → mulai dari posisi nyata
      if (Math.abs(L.animatedScroll - st) > 1 || Math.abs(L.targetScroll - st) > 1) L.reset();
    }
    return true;
  }

  /* ============================== UKUR & GAMBAR SCROLLBAR ============================== */
  function readStyle(inst, force) {
    const t = now();
    if (!force && t - inst.styleT < 1000) return;
    inst.styleT = t;
    const cs = getComputedStyle(inst.el);
    inst.ovY = isScrollStyle(cs.overflowY);
    inst.ovX = isScrollStyle(cs.overflowX);
    inst.radius = parseFloat(cs.borderTopRightRadius) || 0;
    // leluhur yang memotong isi (overflow != visible): area bar dipotong mengikuti bagian yang terlihat
    const clips = [];
    for (let a = inst.el.parentElement; a && a !== doc.body && a !== doc.documentElement; a = a.parentElement) {
      const s = getComputedStyle(a);
      if (s.overflowX !== "visible" || s.overflowY !== "visible") clips.push(a);
    }
    inst.clips = clips;
  }

  function makeBar(inst, axis) {
    const track = doc.createElement("div");
    track.className = "ns-track is-" + axis;
    const thumb = doc.createElement("div");
    thumb.className = "ns-thumb";
    track.appendChild(thumb);
    const bar = { axis, track, thumb, on: false, over: false, x: NaN, y: NaN, len: -1, size: -1, pos: NaN };
    track.addEventListener("pointerdown", (e) => barDown(inst, bar, e));
    track.addEventListener("pointermove", (e) => barMove(inst, bar, e));
    track.addEventListener("pointerup", (e) => barUp(inst, bar, e));
    track.addEventListener("pointercancel", (e) => barUp(inst, bar, e));
    track.addEventListener("lostpointercapture", (e) => barUp(inst, bar, e));
    track.addEventListener("pointerenter", (e) => { if (e.pointerType !== "touch") { bar.over = true; applyVis(inst); } });
    track.addEventListener("pointerleave", (e) => {
      bar.over = false;
      // keluar ke luar area: matikan track; masih di dalam area: pointermove area yang menentukan
      if (!e.relatedTarget || !inst.el.contains(e.relatedTarget)) inst.near = null;
      applyVis(inst); bump(inst);
    });
    track.addEventListener("wheel", (e) => barWheel(inst, bar, e), { passive: false });
    getLayer().appendChild(track);
    return bar;
  }

  function setBar(bar, x, y, len, size, pos) {
    const st = bar.track.style, sy = bar.axis === "y";
    if (bar.x !== x || bar.y !== y) { st.transform = `translate3d(${x}px,${y}px,0)`; bar.x = x; bar.y = y; }
    if (bar.len !== len) { st[sy ? "height" : "width"] = len + "px"; bar.len = len; }
    if (bar.size !== size) { bar.thumb.style[sy ? "height" : "width"] = size + "px"; bar.size = size; }
    if (bar.pos !== pos) { bar.thumb.style.transform = sy ? `translate3d(0,${pos}px,0)` : `translate3d(${pos}px,0,0)`; bar.pos = pos; }
  }

  // ukur area + tulis posisi track/thumb. Hasil: apakah ada bar yang bisa tampil
  function layout(inst) {
    const el = inst.el;
    inst.dirty = false;
    inst.can = false;
    if (inst.opts.bar === false || !el.isConnected) return false;
    readStyle(inst);
    const r = el.getBoundingClientRect();
    if (r.width < 24 || r.height < 24) { offBars(inst); return false; }
    const ch = el.clientHeight, cw = el.clientWidth, sh = el.scrollHeight, sw = el.scrollWidth;
    let L = r.left + el.clientLeft, T = r.top + el.clientTop, R = L + cw, B = T + ch;
    for (const a of inst.clips) {
      const q = a.getBoundingClientRect(), ql = q.left + a.clientLeft, qt = q.top + a.clientTop;
      L = Math.max(L, ql); T = Math.max(T, qt);
      R = Math.min(R, ql + a.clientWidth); B = Math.min(B, qt + a.clientHeight);
    }
    L = Math.max(L, 0); T = Math.max(T, 0);
    R = Math.min(R, innerWidth); B = Math.min(B, innerHeight);
    inst.box = { L, T, R, B };
    const roomy = R - L > 24 && B - T > 24;
    const canY = roomy && inst.ovY && sh - ch > 2;   // luapan 1–2 px (pembulatan) tidak perlu bar
    const canX = roomy && inst.useX && inst.ovX && sw - cw > 2;
    const inset = 3 + Math.min(8, inst.radius * 0.4);
    if (canY) {
      const bar = inst.y || (inst.y = makeBar(inst, "y"));
      const top = T + inset, len = Math.max(0, B - inset - (canX ? TRACK : 0) - top);
      const size = Math.min(len, Math.max(Math.min(MIN_THUMB, len / 2), len * ch / sh));
      const pos = (len - size) * clamp(el.scrollTop / (sh - ch), 0, 1);
      setBar(bar, R - GAP - TRACK, top, len, size, pos);
      bar.on = len > 16;
    } else if (inst.y) inst.y.on = false;
    if (canX) {
      const bar = inst.x || (inst.x = makeBar(inst, "x"));
      const left = L + inset, len = Math.max(0, R - inset - (canY ? TRACK : 0) - left);
      const size = Math.min(len, Math.max(Math.min(MIN_THUMB, len / 2), len * cw / sw));
      const pos = (len - size) * clamp(el.scrollLeft / (sw - cw), 0, 1);
      setBar(bar, left, B - GAP - TRACK, len, size, pos);
      bar.on = len > 16;
    } else if (inst.x) inst.x.on = false;
    inst.can = !!((inst.y && inst.y.on) || (inst.x && inst.x.on));
    return inst.can;
  }
  function offBars(inst) { if (inst.y) inst.y.on = false; if (inst.x) inst.x.on = false; }

  function applyVis(inst) {
    for (const bar of [inst.y, inst.x]) {
      if (!bar) continue;
      const vis = inst.visible && bar.on;
      const drag = !!(inst.drag && inst.drag.bar === bar);
      const hot = vis && (drag || bar.over || inst.near === bar.axis);
      bar.track.classList.toggle("is-visible", vis);
      bar.track.classList.toggle("is-hot", hot);
      bar.track.classList.toggle("is-dragging", drag);
    }
  }

  // thumb tertutup elemen lain (menu, popover, modal di atas area ini)? → jangan tampil
  function occluded(inst) {
    const bar = inst.y && inst.y.on ? inst.y : inst.x;
    if (!bar) return true;
    const px = bar.axis === "y" ? bar.x + TRACK - 4 : bar.x + bar.pos + bar.size / 2;
    const py = bar.axis === "y" ? bar.y + bar.pos + bar.size / 2 : bar.y + TRACK - 4;
    const hit = doc.elementFromPoint(px, py);
    return !(hit && (hit === inst.el || inst.el.contains(hit) || inLayer(hit)));
  }

  function show(inst) {
    if (inst.opts.bar === false) return;
    if (!inst.dirty && !inst.can) return;          // tidak bisa digulir & belum ada perubahan
    const t = now();
    if (t - inst.failT < 150) return;              // percobaan gagal barusan: jangan ulang tiap event
    if (!layout(inst) || occluded(inst)) { inst.failT = t; return; }
    inst.visible = true;
    applyVis(inst);
    bump(inst);
  }
  function hide(inst) {
    inst.visible = false;
    inst.near = null;
    clearTimeout(inst.hideT); inst.hideT = 0;
    applyVis(inst);
  }
  // ada aktivitas (scroll / kursor): tampilkan atau perbarui posisi, tunda sembunyi
  function activity(inst) {
    if (inst.opts.bar === false) return;
    if (!inst.visible) { show(inst); return; }
    if (!layout(inst)) { hide(inst); return; }
    applyVis(inst);
    bump(inst);
  }
  function bump(inst) {
    inst.lastAct = now();
    if (!inst.hideT && inst.visible) inst.hideT = setTimeout(() => hideTick(inst), HIDE_MS);
  }
  function hideTick(inst) {
    inst.hideT = 0;
    if (!inst.visible) return;
    if (inst.drag || inst.near || (inst.y && inst.y.over) || (inst.x && inst.x.over)) return;   // ditahan; bump() saat dilepas
    const left = Math.max(inst.lastAct + HIDE_MS, inst.holdUntil) - now();
    if (left > 20) { inst.hideT = setTimeout(() => hideTick(inst), left); return; }
    hide(inst);
  }

  // pembaruan tertunda (ResizeObserver / MutationObserver / resize jendela) → sekali per frame, hanya bar yang tampil
  const pending = new Set();
  let pendRaf = 0;
  function schedule(inst) {
    pending.add(inst);
    if (!pendRaf) pendRaf = requestAnimationFrame(() => {
      pendRaf = 0;
      for (const i of pending) if (i.visible && all.has(i)) { if (layout(i)) applyVis(i); else hide(i); }
      pending.clear();
    });
  }

  /* ============================== INTERAKSI TRACK / THUMB ============================== */
  function smoothTo(inst, axis, v) {
    const el = inst.el;
    if (axis === "y" && inst.lenis) { inst.lenis.scrollTo(v, { duration: 0.5, easing: easeOut, force: true }); return; }
    el.scrollTo({ [axis === "y" ? "top" : "left"]: v, behavior: mqReduce.matches ? "auto" : "smooth" });
  }

  function barDown(inst, bar, e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (!inst.visible || !bar.on) return;
    e.preventDefault();            // jangan memilih teks / memindah fokus dari editor
    e.stopPropagation();
    const el = inst.el, sy = bar.axis === "y";
    const max = sy ? el.scrollHeight - el.clientHeight : el.scrollWidth - el.clientWidth;
    if (max <= 0) return;
    const p = sy ? e.clientY : e.clientX, start = sy ? bar.y : bar.x;
    const free = Math.max(1, bar.len - bar.size);
    if (inst.lenis) inst.lenis.reset();   // hentikan animasi roda yang sedang jalan
    let from = sy ? el.scrollTop : el.scrollLeft;
    const a = start + bar.pos, b = a + bar.size;
    if (p < a - 2 || p > b + 2) {          // klik di track (bukan thumb): lompat halus, thumb berpusat di titik klik
      from = clamp(((p - start - bar.size / 2) / free) * max, 0, max);
      smoothTo(inst, bar.axis, from);
    }
    inst.drag = { bar, id: e.pointerId, p0: p, from, ratio: max / free, max, moved: false };
    try { (e.target === bar.thumb ? bar.thumb : bar.track).setPointerCapture(e.pointerId); } catch (err) { /* abaikan */ }
    applyVis(inst);
    bump(inst);
  }
  function barMove(inst, bar, e) {
    const d = inst.drag;
    if (!d || d.bar !== bar || d.id !== e.pointerId) return;
    const sy = bar.axis === "y", p = sy ? e.clientY : e.clientX;
    if (!d.moved && Math.abs(p - d.p0) < 2) return;
    if (!d.moved) { d.moved = true; if (inst.lenis) inst.lenis.reset(); }   // seret mengalahkan lompatan halus
    const v = clamp(d.from + (p - d.p0) * d.ratio, 0, d.max);
    if (sy) inst.el.scrollTop = v; else inst.el.scrollLeft = v;
    activity(inst);
  }
  function barUp(inst, bar, e) {
    const d = inst.drag;
    if (!d || d.bar !== bar || d.id !== e.pointerId) return;
    inst.drag = null;
    applyVis(inst);
    bump(inst);
  }
  // roda mouse di atas track: teruskan ke area di bawahnya
  function barWheel(inst, bar, e) {
    if (e.ctrlKey) return;
    e.preventDefault();
    const el = inst.el, sy = bar.axis === "y";
    const m = e.deltaMode === 1 ? 100 / 6 : e.deltaMode === 2 ? (sy ? el.clientHeight : el.clientWidth) : 1;
    const dl = (Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX) * m;
    const L = inst.lenis;
    if (sy && L) L.scrollTo(L.targetScroll + dl, { programmatic: false, lerp: L.options.lerp });
    else if (sy) el.scrollTop += dl;
    else el.scrollLeft += dl;
    activity(inst);
  }

  /* ============================== PASANG / LEPAS ============================== */
  function attach(el, opts) {
    if (!el || el.nodeType !== 1 || el === doc.body || el === doc.documentElement || inLayer(el)) return null;
    let inst = map.get(el);
    if (inst) {
      if (opts) { Object.assign(inst.opts, opts); syncSmooth(inst); inst.dirty = true; }
      return handle(inst);
    }
    const o = Object.assign({}, opts || {});
    const cs = getComputedStyle(el);
    inst = {
      el, opts: o, lenis: null, offLenis: null, clock: 1, y: null, x: null,
      visible: false, can: false, dirty: true, near: null, drag: null, inside: false,
      styleT: 0, failT: 0, lastAct: 0, holdUntil: 0, hideT: 0, clips: [], box: null, ovX: false, ovY: false, radius: 0,
      // bar horizontal hanya bila diminta / scrollbar aslinya memang tidak sengaja disembunyikan
      useX: o.x === true || (o.x !== false && cs.scrollbarWidth !== "none" && !el.hasAttribute("data-ns-host")),
    };
    el.setAttribute("data-ns-host", "");
    // perubahan ukuran isi: area + anak langsung (anak baru ikut diamati)
    inst.ro = new ResizeObserver(() => { inst.dirty = true; if (inst.visible) schedule(inst); });
    inst.ro.observe(el);
    for (const c of el.children) inst.ro.observe(c);
    inst.mo = new MutationObserver((recs) => {
      for (const r of recs) {
        for (const n of r.addedNodes) if (n.nodeType === 1) inst.ro.observe(n);
        for (const n of r.removedNodes) if (n.nodeType === 1) inst.ro.unobserve(n);
      }
      inst.dirty = true;
      if (inst.visible) schedule(inst);
    });
    inst.mo.observe(el, { childList: true });

    inst.onScroll = () => {
      const L = inst.lenis;
      // posisi diubah dari luar (kode lain, scrollIntoView, isi menyusut) di tengah animasi → Lenis ikut posisi itu
      if (L && L.isSmooth && Math.abs(el.scrollTop - L.animatedScroll) > 3) L.reset();
      inst.dirty = true;
      activity(inst);
    };
    inst.onMove = (e) => {
      if (e.pointerType === "touch" || inst.opts.bar === false) return;
      const t = e.target, innermost = !t || !t.closest || t.closest("[data-ns-host]") === el;
      // sedang menyeret sesuatu (seleksi teks, item): jangan nyalakan track
      if (e.buttons) { if (innermost && inst.visible) bump(inst); if (inst.near) { inst.near = null; applyVis(inst); } return; }
      const b = inst.visible && inst.box ? inst.box : null;
      let R, B, T, Lf;
      if (b) { R = b.R; B = b.B; T = b.T; Lf = b.L; }
      else { const r = el.getBoundingClientRect(); R = r.right; B = r.bottom; T = r.top; Lf = r.left; }
      const x = e.clientX, y = e.clientY;
      let near = null;
      if (x >= R - EDGE && x <= R && y >= T && y <= B) near = "y";
      else if (y >= B - EDGE && y <= B && x >= Lf && x <= R) near = "x";
      // tampil sebentar saat kursor MASUK area (bukan tiap gerakan, supaya tidak mengganggu saat membaca/menulis)
      // dan selama kursor dekat tepi
      const enter = innermost && !inst.inside;
      inst.inside = innermost;
      if (enter || near) { if (inst.visible && !inst.dirty) bump(inst); else activity(inst); }
      if (near && !(inst[near] && inst[near].on && inst.visible)) near = null;
      if (near !== inst.near) { const was = inst.near; inst.near = near; applyVis(inst); if (was && !near) bump(inst); }
    };
    inst.onLeave = (e) => {
      if (inLayer(e.relatedTarget)) return;   // pindah ke track milik area ini: tetap "dekat"
      inst.inside = false;
      if (inst.near) { inst.near = null; applyVis(inst); bump(inst); }
    };
    el.addEventListener("scroll", inst.onScroll, { passive: true });
    el.addEventListener("pointermove", inst.onMove, { passive: true });
    el.addEventListener("pointerleave", inst.onLeave, { passive: true });
    map.set(el, inst);
    all.add(inst);
    syncSmooth(inst);
    return handle(inst);
  }

  function detach(el) {
    const inst = el && map.get(el);
    if (!inst) return false;
    map.delete(el); all.delete(inst); pending.delete(inst);
    stopLenis(inst);
    inst.ro.disconnect(); inst.mo.disconnect();
    el.removeEventListener("scroll", inst.onScroll);
    el.removeEventListener("pointermove", inst.onMove);
    el.removeEventListener("pointerleave", inst.onLeave);
    clearTimeout(inst.hideT);
    for (const bar of [inst.y, inst.x]) if (bar) bar.track.remove();
    inst.y = inst.x = null;
    el.removeAttribute("data-ns-host");
    return true;
  }

  function handle(inst) {
    const el = inst.el;
    return {
      el, get lenis() { return inst.lenis; }, get smooth() { return !!inst.lenis; }, get visible() { return inst.visible; },
      refresh: () => refresh(el), scrollTo: (t, o) => scrollTo(el, t, o), detach: () => detach(el),
    };
  }
  const get = (el) => { const i = el && map.get(el); return i ? handle(i) : null; };

  // tampilkan bar sebentar (mis. memberi tanda "bisa digulir" saat panel baru dibuka); ms = lama minimal tampil
  function flash(el, ms) {
    const inst = el && (map.get(el) || findInst(el));
    if (!inst) return false;
    inst.holdUntil = now() + (ms > 0 ? ms : HIDE_MS);
    inst.dirty = true; inst.failT = 0;
    clearTimeout(inst.hideT); inst.hideT = 0;   // waktu tahan bisa lebih pendek dari timer yang sedang jalan
    activity(inst);
    return inst.visible;
  }

  function refresh(el) {
    if (el) {
      const inst = map.get(el);
      if (!inst) return false;
      inst.dirty = true; inst.styleT = 0;
      syncSmooth(inst);
      if (inst.visible) { if (layout(inst)) applyVis(inst); else hide(inst); }
      return true;
    }
    scan(doc.body);
    for (const inst of all) { inst.dirty = true; inst.styleT = 0; syncSmooth(inst); if (inst.visible) schedule(inst); }
    return true;
  }

  function findInst(node) {
    for (let n = node; n && n.nodeType === 1; n = n.parentElement) { const i = map.get(n); if (i) return i; }
    return null;
  }

  // scrollTo(area | elemen di dalam area, target, { offset, immediate, duration, block })
  // target: angka (px) | "top" | "bottom" | elemen. Hasil: Promise<boolean> selesai.
  function scrollTo(elOrContainer, target, opts) {
    opts = opts || {};
    let inst = map.get(elOrContainer) || null;
    if (!inst && elOrContainer && elOrContainer.nodeType === 1 && target === undefined) {
      inst = findInst(elOrContainer.parentElement); target = elOrContainer;
    } else if (!inst) inst = findInst(elOrContainer);
    const reduce = mqReduce.matches;
    if (!inst) {   // bukan area NovelScroll: pakai cara native
      if (target && target.nodeType === 1) target.scrollIntoView({ block: opts.block || "start", behavior: reduce || opts.immediate ? "auto" : "smooth" });
      else if (elOrContainer && elOrContainer.scrollTo && typeof target === "number") elOrContainer.scrollTo({ top: target, behavior: reduce || opts.immediate ? "auto" : "smooth" });
      return Promise.resolve(false);
    }
    const el = inst.el, max = Math.max(0, el.scrollHeight - el.clientHeight);
    let y;
    if (typeof target === "number") y = target;
    else if (target === "top" || target === "start") y = 0;
    else if (target === "bottom" || target === "end") y = max;
    else if (target && target.nodeType === 1) {
      const a = target.getBoundingClientRect(), b = el.getBoundingClientRect();
      const top = el.scrollTop + a.top - b.top - el.clientTop;
      if (opts.block === "center") y = top - (el.clientHeight - a.height) / 2;
      else if (opts.block === "end") y = top - el.clientHeight + a.height;
      else if (opts.block === "nearest") y = top < el.scrollTop ? top : top + a.height > el.scrollTop + el.clientHeight ? top - el.clientHeight + a.height : el.scrollTop;
      else y = top;
    } else return Promise.resolve(false);
    y = clamp(y - (opts.offset || 0), 0, max);
    const immediate = !!opts.immediate || reduce;
    return new Promise((res) => {
      const L = inst.lenis;
      if (L) {
        L.scrollTo(y, { immediate, force: true, duration: opts.duration, easing: opts.duration ? easeOut : undefined, onComplete: () => res(true) });
      } else if (immediate) { el.scrollTop = y; res(true); }
      else {
        el.scrollTo({ top: y, behavior: "smooth" });
        let done = false;
        const fin = () => { if (done) return; done = true; el.removeEventListener("scrollend", fin); res(true); };
        el.addEventListener("scrollend", fin);
        setTimeout(fin, 1200);
      }
      activity(inst);
    });
  }

  /* ============================== PASANG OTOMATIS (registry + MutationObserver) ============================== */
  function autoOpts(el) {
    const o = Object.assign({}, ...[...extraOpts].filter(([s]) => el.matches(s)).map(([, v]) => v));
    const v = el.getAttribute("data-ns-scroll");
    if (v === "bar") o.smooth = false;
    if (v === "x" || v === "both") o.x = true;
    return o;
  }
  function autoAttach(el) {
    if (map.has(el) || el.hasAttribute("data-ns-ignore") || inLayer(el)) return;
    const v = el.getAttribute("data-ns-scroll");
    if (v === "off" || v === "none") return;
    attach(el, autoOpts(el));
  }
  function scan(root) {
    if (!root || root.nodeType !== 1 || inLayer(root)) return;
    if (root.matches(SEL)) autoAttach(root);
    for (const el of root.querySelectorAll(SEL)) autoAttach(el);
  }
  const added = new Set();
  let removed = false, scanT = 0;
  function flushScan() {
    scanT = 0;
    for (const n of added) if (n.isConnected) scan(n);
    added.clear();
    if (removed) { removed = false; for (const inst of [...all]) if (!inst.el.isConnected) detach(inst.el); }
  }
  const docMO = new MutationObserver((recs) => {
    for (const r of recs) {
      for (const n of r.addedNodes) if (n.nodeType === 1 && n !== layer && !inLayer(n)) added.add(n);
      if (r.removedNodes.length) removed = true;
    }
    if ((added.size || removed) && !scanT) scanT = setTimeout(flushScan, 40);   // dikumpulkan, maks. 1x per 40 ms
  });

  function register(selector, opts) {
    if (typeof selector !== "string" || !selector.trim()) return false;
    try { doc.querySelector(selector); } catch (e) { console.warn("[NovelScroll] selector tidak valid:", selector); return false; }
    extraOpts.set(selector, opts || {});
    SEL = baseSel();
    if (doc.body) scan(doc.body);
    return true;
  }

  // ganti setelan sistem / mode hemat performa → nyalakan / matikan Lenis di semua area
  function resyncAll() { modeAllowed = smoothAllowed(); for (const inst of all) syncSmooth(inst); }
  let modeAllowed = null;
  // dicek juga tiap roda mouse (event "change" media query kadang telat / tidak datang)
  function checkMode() { if (smoothAllowed() !== modeAllowed) resyncAll(); }

  function init() {
    getLayer();
    modeAllowed = smoothAllowed();
    scan(doc.body);
    docMO.observe(doc.body, { childList: true, subtree: true });
    // body.perf-boost dipasang / dilepas (Pengaturan Akun → Aksesibilitas)
    new MutationObserver(checkMode).observe(doc.body, { attributes: true, attributeFilter: ["class"] });
    if (mqReduce.addEventListener) { mqReduce.addEventListener("change", checkMode); mqFine.addEventListener("change", checkMode); }
    // fase capture, sebelum sampai ke area: Lenis sudah menyala/mati untuk roda yang sama
    addEventListener("wheel", checkMode, { capture: true, passive: true });
    addEventListener("resize", () => { for (const inst of all) { inst.dirty = true; inst.styleT = 0; if (inst.visible) schedule(inst); } }, { passive: true });
    // panel yang bergeser/beranimasi (laci, sidebar) → bar yang sedang tampil ikut pindah
    const reflow = () => { for (const inst of all) if (inst.visible) schedule(inst); };
    doc.addEventListener("transitionend", reflow, true);
    doc.addEventListener("animationend", reflow, true);
  }

  window.NovelScroll = {
    version: "1.0.0",
    attach: (el, opts) => attach(el, opts),
    detach, refresh, scrollTo, get, register, show: flash,
    get registry() { return REGISTRY.concat([...extraOpts.keys()]); },
    // untuk uji/diagnosa: jumlah area, berapa yang memakai Lenis, apakah loop rAF sedang jalan
    stats: () => ({ instances: all.size, smooth: [...all].filter((i) => i.lenis).length, visible: [...all].filter((i) => i.visible).length,
      animating: active.size, rafRunning: !!rafId, frames, smoothAllowed: smoothAllowed() }),
    // diagnosa satu area: status tampil / ditahan
    debug: (el) => { const i = el && map.get(el); if (!i) return null; const t = now();
      return { visible: i.visible, can: i.can, near: i.near, inside: i.inside, drag: !!i.drag, overY: !!(i.y && i.y.over), overX: !!(i.x && i.x.over),
        timer: !!i.hideT, sinceAct: Math.round(t - i.lastAct), hold: Math.round(i.holdUntil - t), smooth: !!i.lenis }; },
  };

  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
