/* quill-tiles.js — ISI PANEL KANAN QUILL: alat (tombol bulat) + tile (kartu kaca) di editor chapter.
   Dimuat malas oleh app.js tepat setelah quill.js (ensureQuillLib). Hanya memakai API window.NovelQuill (lihat komentar
   di awal quill.js). Gaya ada di quill.css bagian "PANEL KANAN — ISI", semua kelas berawalan qdt-.
   Ikon: Tabler, selalu tiIcon("NAMA") dengan nama literal (dipindai tools/build-icons.mjs).

   ALAT  : Draf · Gaya · Pohon relasi · Kanvas · Map · Model 3D (segera)
   TILE  : Kartu dunia · Kartu terdeteksi · Catatan chapter · Papan suasana · Grafik dunia
   React + React Flow (vendor/) baru dimuat saat Pohon relasi / Kanvas dibuka.

   DATA — semuanya di dalam objek cerita (story.panel[id] = ctx.store milik alat/tile itu), ikut tersimpan ke Drive:
     drafts    { byCh: { [chapterId]: [{ id, title, at, words, hash, kind: "manual" | "auto" | "restore", html }] },
                 img: { [kunci]: dataURL } }   // gambar data: di draf disimpan sekali saja (html memakai src="qdtimg:KUNCI")
     style     { font?, size?, lh?, pgap?, indent?, width?, theme? }   // hanya setelan yang diubah (kosong = bawaan)
     relations { pos: { [charId]: { x, y } }, edges: [{ id, source, target, label }], vp?: { x, y, zoom } }
     canvas    { items: [{ id, kind: "note" | "img", x, y, w, h, text?, color?, src? }], vp? }
     notes     { byCh: { [chapterId]: [{ id, text, at }] } }
     mood      { images: [{ id, src, at }] }
   Karakter / lokasi / catatan dibaca dari project.data.organize (ctx.getOrganize()); Pohon relasi boleh menambah karakter. */
(function () {
  "use strict";
  if (window.__novelQuillTiles) return;
  window.__novelQuillTiles = true;

  /* ============================ UTIL ============================ */
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const px = (svg, n) => svg.replace("<svg ", `<svg width="${n}" height="${n}" `);
  const uid = (p) => p + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const nowIso = () => new Date().toISOString();
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const $ = (root, sel) => root.querySelector(sel);
  const $$ = (root, sel) => Array.from(root.querySelectorAll(sel));
  const isObj = (o) => !!o && typeof o === "object" && !Array.isArray(o);
  const isNarrow = () => !!(window.matchMedia && matchMedia("(max-width: 900px)").matches);
  const isPhone = () => !!(window.matchMedia && matchMedia("(max-width: 700px)").matches);
  const fmtNum = (n) => Number(n || 0).toLocaleString((window.NovelI18n ? NovelI18n.locale : "id-ID"));
  const DATA_IMG = /^data:image\/(png|jpeg|webp|gif);base64,[a-z0-9+/=]+$/i;
  const isEditable = (t) => !!(t && t.closest && t.closest("input, textarea, select, [contenteditable='true']"));
  function debounce(fn, ms) {
    let t = 0;
    const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
    d.cancel = () => clearTimeout(t);
    return d;
  }
  // toast aplikasi (z-index-nya dinaikkan supaya tetap terlihat di atas dialog)
  function note(msg, icon) {
    if (typeof window.toast !== "function") return;
    window.toast(msg, icon || tiIcon("check"));
    const all = document.querySelectorAll("body > .app-toast");
    if (all.length) all[all.length - 1].style.zIndex = "1300";
  }
  function roman(n) {
    n = clamp(n | 0, 1, 3999);
    const t = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
    let s = "";
    for (const [v, r] of t) while (n >= v) { s += r; n -= v; }
    return s;
  }
  const chapterName = (story, ch) => (ch.title || "").trim() || "Chapter " + roman(story.chapters.indexOf(ch) + 1);
  const countWords = (text) => { const m = String(text || "").match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu); return m ? m.length : 0; };
  // HTML -> teks polos lewat dokumen "inert" (tanpa browsing context: script tidak jalan, gambar tidak dimuat).
  // Akhir blok diberi baris baru supaya kata di paragraf berbeda tidak menempel ("Raka</p><p>Dia" -> "Raka\nDia").
  let inertDoc = null;
  function htmlToText(html) {
    if (!html) return "";
    if (!inertDoc) inertDoc = document.implementation.createHTMLDocument("");
    const box = inertDoc.createElement("div");
    box.innerHTML = String(html).replace(/<\/(p|div|h1|h2|li|blockquote|figcaption)>|<br\s*\/?>|<hr[^>]*>/gi, "$&\n");
    box.querySelectorAll("script, style, template, noscript").forEach((x) => x.remove());   // isi kode bukan teks cerita
    return box.textContent || "";
  }
  function hashStr(s) {
    s = String(s || "");
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36) + s.length.toString(36);
  }
  function ago(iso) {
    const d = (Date.now() - new Date(iso).getTime()) / 1000;
    if (!isFinite(d)) return "";
    if (d < 60) return "baru saja";
    if (d < 3600) return Math.floor(d / 60) + " menit lalu";
    if (d < 86400) return Math.floor(d / 3600) + " jam lalu";
    if (d < 86400 * 30) return Math.floor(d / 86400) + " hari lalu";
    return new Date(iso).toLocaleDateString((window.NovelI18n ? NovelI18n.locale : "id-ID"), { day: "numeric", month: "short", year: "numeric" });
  }
  const fullDate = (iso) => { const d = new Date(iso); return isFinite(d) ? d.toLocaleString((window.NovelI18n ? NovelI18n.locale : "id-ID"), { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }) : ""; };
  // file gambar -> diperkecil (sisi terpanjang <= max) -> data URL WebP 0.82 (fallback JPEG)
  function readImage(file, max) {
    return new Promise((resolve, reject) => {
      if (!file || !/^image\//.test(file.type || "")) { reject(new Error("File ini bukan gambar.")); return; }
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        try {
          const s = Math.min(1, max / img.naturalWidth, max / img.naturalHeight);
          const w = Math.max(1, Math.round(img.naturalWidth * s)), h = Math.max(1, Math.round(img.naturalHeight * s));
          const cv = document.createElement("canvas");
          cv.width = w; cv.height = h;
          cv.getContext("2d").drawImage(img, 0, 0, w, h);
          let out = cv.toDataURL("image/webp", 0.82);
          if (!/^data:image\/webp/.test(out)) {
            const cj = document.createElement("canvas");
            cj.width = w; cj.height = h;
            const g = cj.getContext("2d");
            g.fillStyle = "#ffffff"; g.fillRect(0, 0, w, h); g.drawImage(cv, 0, 0);
            out = cj.toDataURL("image/jpeg", 0.85);
          }
          resolve({ src: out, w, h });
        } catch (e) { reject(e); } finally { URL.revokeObjectURL(url); }
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Gambar tidak bisa dibaca.")); };
      img.src = url;
    });
  }
  const imageFiles = (list) => Array.from(list || []).filter((f) => /^image\//.test(f.type || ""));
  const hasFiles = (e) => !!(e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files"));
  function dropFiles(elm, onFiles) {
    elm.addEventListener("dragover", (e) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = "copy"; elm.classList.add("is-over"); });
    elm.addEventListener("dragleave", (e) => { if (!elm.contains(e.relatedTarget)) elm.classList.remove("is-over"); });
    elm.addEventListener("drop", (e) => {
      elm.classList.remove("is-over");
      if (!hasFiles(e)) return;
      e.preventDefault();
      const files = imageFiles(e.dataTransfer.files);
      if (files.length) onFiles(files, e); else note("File itu bukan gambar.", tiIcon("alert-triangle"));
    });
  }
  const api = () => window.NovelQuill;

  /* ============================ OVERLAY (dialog, popover) ============================ */
  const overlays = new Set();   // urutan buka = urutan tumpuk; semuanya ditutup saat layar Quill berganti
  const topOverlay = () => { let t = null; overlays.forEach((o) => { t = o; }); return t; };
  function closeAll() { Array.from(overlays).reverse().forEach((o) => o.close()); }
  function trapTab(e, box) {
    const f = $$(box, 'button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])').filter((x) => x.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    else if (!box.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
  }
  // o = { title, sub, icon, size: "sm" | "md" | "lg", cls, onClose(), onKey(e) -> true bila sudah ditangani }
  function openDialog(o) {
    const scrim = document.createElement("div");
    scrim.className = "qdt-scrim";
    const tid = uid("qdt-t");
    scrim.innerHTML = `<div class="qdt-dlg is-${o.size || "md"} ${o.cls || ""}" role="dialog" aria-modal="true" aria-labelledby="${tid}">
        <header class="qdt-dlg-head">
          <span class="qdt-dlg-ic">${px(o.icon, 18)}</span>
          <div class="qdt-dlg-titles"><h2 class="qdt-dlg-title" id="${tid}"></h2><div class="qdt-dlg-sub"></div></div>
          <div class="qdt-dlg-actions"></div>
          <button type="button" class="qd-icon-btn qdt-dlg-close" title="Tutup (Esc)" aria-label="Tutup">${px(tiIcon("x"), 18)}</button>
        </header>
        <div class="qdt-dlg-body"></div>
      </div>`;
    const box = scrim.firstElementChild;
    $(box, ".qdt-dlg-title").textContent = o.title;
    $(box, ".qdt-dlg-sub").textContent = o.sub || "";
    const prevFocus = document.activeElement;
    const onKey = (e) => {
      if (topOverlay() !== d) return;
      if (o.onKey && o.onKey(e)) return;
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); d.close(); }
      else if (e.key === "Tab") trapTab(e, box);
    };
    const d = {
      scrim, el: box, body: $(box, ".qdt-dlg-body"), actions: $(box, ".qdt-dlg-actions"), closed: false,
      setSub(t) { $(box, ".qdt-dlg-sub").textContent = t || ""; },
      close() {
        if (d.closed) return;
        d.closed = true;
        overlays.delete(d);
        document.removeEventListener("keydown", onKey, true);
        try { if (o.onClose) o.onClose(); } catch (e) { console.error("[Quill tiles]", e); }
        scrim.remove();
        if (prevFocus && prevFocus.isConnected && !topOverlay()) { try { prevFocus.focus({ preventScroll: true }); } catch (e) { /* abaikan */ } }
      },
    };
    let downOnScrim = false;
    scrim.addEventListener("pointerdown", (e) => { downOnScrim = e.target === scrim; });
    scrim.addEventListener("click", (e) => { if (e.target === scrim && downOnScrim) d.close(); downOnScrim = false; });
    $(box, ".qdt-dlg-close").addEventListener("click", () => d.close());
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(scrim);
    overlays.add(d);
    requestAnimationFrame(() => { if (!d.closed && !box.contains(document.activeElement)) $(box, ".qdt-dlg-close").focus({ preventScroll: true }); });
    return d;
  }
  // popover kecil di samping elemen (di HP: lembar di bawah layar). build(pop) mengisi isinya.
  function openPopover(anchor, build, o) {
    Array.from(overlays).forEach((x) => { if (x.isPop) x.close(); });
    o = o || {};
    const pop = document.createElement("div");
    pop.className = "qdt-pop" + (o.cls ? " " + o.cls : "");
    pop.setAttribute("role", "dialog");
    pop.setAttribute("aria-label", o.label || "Detail");
    const prevFocus = document.activeElement;
    const d = {
      isPop: true, el: pop, closed: false,
      close() {
        if (d.closed) return;
        d.closed = true;
        overlays.delete(d);
        document.removeEventListener("pointerdown", outside, true);
        document.removeEventListener("keydown", onKey, true);
        window.removeEventListener("resize", place);
        pop.remove();
        if (prevFocus && prevFocus.isConnected && document.activeElement && (document.activeElement === document.body || !document.activeElement.isConnected)) { try { prevFocus.focus({ preventScroll: true }); } catch (e) { /* abaikan */ } }
      },
    };
    const outside = (e) => { if (!pop.contains(e.target) && !(anchor && anchor.contains(e.target))) d.close(); };
    const onKey = (e) => { if (topOverlay() === d && e.key === "Escape") { e.preventDefault(); e.stopPropagation(); d.close(); } };
    function place() {
      if (isPhone()) { pop.classList.add("is-sheet"); pop.style.left = pop.style.top = ""; return; }
      pop.classList.remove("is-sheet");
      const r = anchor.getBoundingClientRect(), w = pop.offsetWidth, hh = pop.offsetHeight, W = window.innerWidth, H = window.innerHeight;
      let left = r.left - w - 10, top = r.top - 6;
      if (left < 8) { left = clamp(r.left, 8, W - w - 8); top = r.bottom + 6; if (top + hh > H - 8) top = r.top - hh - 6; }
      pop.style.left = Math.round(left) + "px";
      pop.style.top = Math.round(clamp(top, 8, Math.max(8, H - hh - 8))) + "px";
    }
    build(pop, d);
    document.body.appendChild(pop);
    overlays.add(d);
    place();
    setTimeout(() => { if (!d.closed) document.addEventListener("pointerdown", outside, true); }, 0);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", place);
    const first = $(pop, "[data-autofocus]") || $(pop, "button");
    if (first) first.focus({ preventScroll: true });
    return d;
  }

  /* ============================ KARTU DUNIA (Organize) ============================ */
  const KINDS = {
    characters: { label: "Karakter", icon: () => tiIcon("user") },
    locations: { label: "Lokasi", icon: () => tiIcon("map-pin") },
    notes: { label: "Catatan", icon: () => tiIcon("note") },
    factions: { label: "Faksi", icon: () => tiIcon("flag") },
    items: { label: "Benda", icon: () => tiIcon("sword") },
    creatures: { label: "Makhluk", icon: () => tiIcon("dragon") },
    cultures: { label: "Budaya/Agama", icon: () => tiIcon("building-church") },
    magic: { label: "Sistem Sihir", icon: () => tiIcon("wand") },
    history: { label: "Sejarah", icon: () => tiIcon("hourglass") },
  };
  const ALL_KINDS = Object.keys(KINDS);   // semua jenis entri Kodeks
  function organizeOf(ctx) {
    const o = (ctx.getOrganize && ctx.getOrganize()) || (ctx.project && ctx.project.data && ctx.project.data.organize) || null;
    return isObj(o) ? o : null;
  }
  function entities(ctx, kinds) {
    const org = organizeOf(ctx) || {}, out = [];
    (kinds || ALL_KINDS).forEach((k) => (Array.isArray(org[k]) ? org[k] : []).forEach((it) => {
      if (it && typeof it.id === "string") out.push({ id: it.id, kind: k, title: typeof it.title === "string" ? it.title : "", item: it });
    }));
    return out;
  }
  const normKey = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
  const textCache = new WeakMap();   // item organize -> { html, text }
  function itemText(it) {
    const html = typeof it.content === "string" ? it.content : "";
    let c = textCache.get(it);
    if (!c || c.html !== html) { c = { html, text: htmlToText(html).replace(/\s+/g, " ").trim() }; textCache.set(it, c); }
    return c.text;
  }
  // Pencocok judul: satu regex gabungan, tidak peka huruf besar/kecil, hanya kata utuh (huruf/angka Unicode).
  const matchers = new Map();   // tanda tangan daftar judul -> pencocok (maks. 4 disimpan)
  function matcherFor(ents) {
    const usable = ents.filter((e) => normKey(e.title).length >= 2);
    const sig = usable.map((e) => e.id + "\u0001" + e.title).join("\u0002");
    if (matchers.has(sig)) return matchers.get(sig);
    const byKey = new Map();
    usable.forEach((e) => { const k = normKey(e.title); if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(e); });
    const keys = Array.from(byKey.keys()).sort((a, b) => b.length - a.length);
    let re = null, lb = true;
    if (keys.length) {
      const alts = keys.map((k) => k.split(" ").map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+")).join("|");
      try { re = new RegExp("(?<![\\p{L}\\p{N}_])(?:" + alts + ")(?![\\p{L}\\p{N}_])", "giu"); }
      catch (e) {   // browser tanpa lookbehind
        lb = false;
        try { re = new RegExp("(^|[^\\p{L}\\p{N}_])(" + alts + ")(?![\\p{L}\\p{N}_])", "giu"); } catch (e2) { re = null; }
      }
    }
    const m = { re, lb, byKey, sig };
    if (matchers.size >= 4) matchers.delete(matchers.keys().next().value);
    matchers.set(sig, m);
    return m;
  }
  function countMentions(text, m) {
    const out = new Map();
    if (!m.re || !text) return out;
    m.re.lastIndex = 0;
    let r;
    while ((r = m.re.exec(text))) {
      const hit = m.lb ? r[0] : r[2];
      const list = m.byKey.get(normKey(hit));
      if (list) list.forEach((e) => out.set(e.id, (out.get(e.id) || 0) + 1));
      if (!r[0].length) m.re.lastIndex++;
    }
    return out;
  }
  // buka item di tab Organize (memakai fungsi app.js bila ada; kalau tidak, cukup buka tabnya)
  function openInOrganize(ctx, ent) {
    ctx.openProjectTab("organize");
    try {
      if (typeof switchOrganizeCat === "function" && typeof renderOrganizeDetail === "function") {
        switchOrganizeCat(ent.kind);
        currentOrgItemId = ent.id;   // variabel global app.js
        renderOrganizeList();
        renderOrganizeDetail();
      }
    } catch (e) { /* tab Organize tetap terbuka */ }
  }
  function insertName(ctx, ent) {
    if (!ctx.chapter) return;
    ctx.insertHtmlAtCursor(esc(ent.title));
    note(`"${ent.title}" disisipkan`, tiIcon("cursor-text"));
    if (isNarrow() && api()) api().closePanel();
  }
  function showEntity(anchor, ent, ctx) {
    openPopover(anchor, (pop, d) => {
      const k = KINDS[ent.kind] || KINDS.notes;
      const html = ctx.sanitizeHtml(ent.item && typeof ent.item.content === "string" ? ent.item.content : "");
      const empty = !htmlToText(html).trim() && !/<img/i.test(html);
      pop.innerHTML = `<div class="qdt-pop-head">
          <span class="qdt-kind-ic is-${ent.kind}">${px(k.icon(), 15)}</span>
          <div class="qdt-pop-titles"><div class="qdt-pop-title">${esc(ent.title.trim() || "(tanpa judul)")}</div><div class="qdt-pop-kind">${k.label}</div></div>
          <button type="button" class="qd-icon-btn" data-x="close" title="Tutup" aria-label="Tutup">${px(tiIcon("x"), 16)}</button>
        </div>
        <div class="qdt-pop-content">${empty ? '<p class="qdt-dim">Kartu ini belum punya isi.</p>' : html}</div>
        <div class="qdt-pop-actions">
          <button type="button" class="qd-btn qd-btn-accent qd-btn-sm" data-x="insert" data-autofocus${ent.title.trim() ? "" : " disabled"}>${px(tiIcon("cursor-text"), 15)}<span>Sisipkan nama</span></button>
          <button type="button" class="qd-btn qd-btn-soft qd-btn-sm" data-x="organize">${px(tiIcon("external-link"), 15)}<span>Buka di Kodeks</span></button>
        </div>`;
      pop.addEventListener("click", (e) => {
        const b = e.target.closest("[data-x]");
        if (!b) return;
        if (b.dataset.x === "close") d.close();
        else if (b.dataset.x === "insert") { d.close(); insertName(ctx, ent); }
        else if (b.dataset.x === "organize") { d.close(); openInOrganize(ctx, ent); }
      });
    }, { label: ent.title, cls: "qdt-pop-card" });
  }
  const kindIc = (kind, n) => `<span class="qdt-kind-ic is-${kind}">${px((KINDS[kind] || KINDS.notes).icon(), n || 14)}</span>`;
  function findEnt(list, btn) { return list.find((e) => e.id === btn.dataset.id && e.kind === btn.dataset.kind) || null; }

  /* ---------- TILE: Kartu dunia ---------- */
  const tileWorldCards = {
    id: "worldcards", title: "Kartu dunia", icon: tiIcon("cards"),
    render(el, ctx) {
      const tabs = [["all", "Semua"], ["characters", "Karakter"], ["locations", "Lokasi"], ["notes", "Catatan"]];
      el.innerHTML = `<label class="qdt-search">${px(tiIcon("search"), 15)}<input type="search" placeholder="Cari kartu…" aria-label="Cari kartu dunia" autocomplete="off" spellcheck="false"></label>
        <div class="qdt-chips" role="group" aria-label="Jenis kartu">${tabs.map(([k, l], i) => `<button type="button" class="qdt-chip${i ? "" : " is-on"}" data-kind="${k}" aria-pressed="${!i}">${l}</button>`).join("")}</div>
        <div class="qdt-cards" role="list"></div>`;
      const st = { q: "", kind: "all", ents: [] };
      const input = $(el, "input"), box = $(el, ".qdt-cards");
      st.draw = () => {
        const all = entities(ctx);
        st.ents = all;
        const q = normKey(st.q);
        const list = all.filter((e) => (st.kind === "all" || e.kind === st.kind) && (!q || normKey(e.title).includes(q) || (q.length >= 3 && itemText(e.item).toLowerCase().includes(q))));
        if (!all.length) box.innerHTML = `<div class="qdt-empty">Belum ada kartu di dunia ini.<button type="button" class="qdt-link" data-x="org">Buat di Kodeks</button></div>`;
        else if (!list.length) box.innerHTML = '<div class="qdt-empty">Tidak ada yang cocok.</div>';
        else box.innerHTML = list.slice(0, 300).map((e) => {
          const snip = itemText(e.item).slice(0, 90);
          return `<button type="button" class="qdt-card" role="listitem" data-id="${esc(e.id)}" data-kind="${e.kind}" title="${esc((KINDS[e.kind] || KINDS.notes).label)}">${kindIc(e.kind)}<span class="qdt-card-main"><span class="qdt-card-title">${esc(e.title.trim() || "(tanpa judul)")}</span>${snip ? `<span class="qdt-card-snip">${esc(snip)}</span>` : ""}</span></button>`;
        }).join("");
      };
      input.addEventListener("input", () => { st.q = input.value; st.draw(); });
      el.addEventListener("click", (e) => {
        const chip = e.target.closest(".qdt-chip");
        if (chip) {
          st.kind = chip.dataset.kind;
          $$(el, ".qdt-chip").forEach((c) => { c.classList.toggle("is-on", c === chip); c.setAttribute("aria-pressed", String(c === chip)); });
          st.draw();
          return;
        }
        if (e.target.closest('[data-x="org"]')) { ctx.openProjectTab("organize"); return; }
        const card = e.target.closest(".qdt-card");
        if (card) { const ent = findEnt(st.ents, card); if (ent) showEntity(card, ent, ctx); }
      });
      el._qdt = st;
      st.draw();
    },
    update(el, ctx, reason) { if (reason === "refresh" && el._qdt) el._qdt.draw(); },
  };

  /* ---------- TILE: Kartu terdeteksi ---------- */
  const tileDetected = {
    id: "detected", title: "Kartu terdeteksi", icon: tiIcon("radar"),
    render(el, ctx) {
      el.innerHTML = '<div class="qdt-det" aria-live="polite"></div>';
      const box = $(el, ".qdt-det"), st = { found: [] };
      st.draw = () => {
        if (!ctx.chapter) return;
        const ents = entities(ctx), counts = countMentions(ctx.getChapterText(), matcherFor(ents));
        st.found = ents.filter((e) => counts.get(e.id)).map((e) => ({ e, n: counts.get(e.id) }))
          .sort((a, b) => b.n - a.n || a.e.title.localeCompare(b.e.title, "id"));
        box.innerHTML = st.found.length
          ? `<div class="qdt-det-list">${st.found.map(({ e, n }) => `<button type="button" class="qdt-det-item" data-id="${esc(e.id)}" data-kind="${e.kind}" title="${esc(e.title)} — disebut ${n} kali">${kindIc(e.kind, 13)}<span class="qdt-det-name">${esc(e.title)}</span><span class="qdt-det-n">${n}×</span></button>`).join("")}</div>`
          : '<div class="qdt-empty">Kartu yang terdeteksi akan muncul di sini saat kamu menulis</div>';
      };
      box.addEventListener("click", (e) => {
        const b = e.target.closest(".qdt-det-item");
        if (!b) return;
        const hit = st.found.find((f) => f.e.id === b.dataset.id && f.e.kind === b.dataset.kind);
        if (hit) showEntity(b, hit.e, ctx);
      });
      ctx.onTextChange(() => st.draw());   // sudah di-debounce ±600 ms oleh Quill
      el._qdt = st;
      st.draw();
    },
    update(el) { if (el._qdt) el._qdt.draw(); },
  };

  /* ---------- TILE: Catatan chapter ---------- */
  function notesStore(ctx) {
    const s = ctx.store;
    if (!isObj(s.byCh)) s.byCh = {};
    return s;
  }
  const tileNotes = {
    id: "notes", title: "Catatan chapter", icon: tiIcon("notes"),
    render(el, ctx) {
      el.innerHTML = `<div class="qdt-notes"></div><button type="button" class="qdt-add" data-x="add">${px(tiIcon("plus"), 15)}<span>Catatan baru</span></button>`;
      const box = $(el, ".qdt-notes"), save = debounce(() => ctx.onChange(), 500);
      const list = () => { const s = notesStore(ctx), a = s.byCh[ctx.chapter.id]; return Array.isArray(a) ? a : []; };
      const grow = (ta) => { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight + 2, 320) + "px"; };
      const draw = (focusId) => {
        if (!ctx.chapter) return;
        // catatan milik chapter yang sudah dihapus ikut dibuang
        const s = notesStore(ctx), ids = new Set(ctx.story.chapters.map((c) => c.id));
        Object.keys(s.byCh).forEach((k) => { if (!ids.has(k) || !Array.isArray(s.byCh[k]) || !s.byCh[k].length) delete s.byCh[k]; });
        const notes = list().filter((n) => n && typeof n.id === "string");
        if (!notes.length) { box.innerHTML = '<div class="qdt-empty">Belum ada catatan</div>'; return; }
        box.innerHTML = notes.map((n) => `<div class="qdt-note" data-id="${esc(n.id)}">
            <textarea class="qdt-note-text" rows="2" placeholder="Tulis catatan…" aria-label="Catatan" spellcheck="true"></textarea>
            <div class="qdt-note-foot"><span class="qdt-note-time" title="${esc(fullDate(n.at))}">${esc(ago(n.at))}</span>
              <button type="button" class="qd-icon-btn qdt-note-del" data-x="del" title="Hapus catatan" aria-label="Hapus catatan">${px(tiIcon("trash"), 14)}</button></div>
          </div>`).join("");
        $$(box, ".qdt-note").forEach((row) => {
          const n = notes.find((x) => x.id === row.dataset.id), ta = $(row, "textarea");
          ta.value = typeof n.text === "string" ? n.text : "";
          requestAnimationFrame(() => grow(ta));
          ta.addEventListener("input", () => {
            n.text = ta.value.slice(0, 5000);
            n.at = nowIso();
            $(row, ".qdt-note-time").textContent = "baru saja";
            grow(ta);
            save();
          });
          ta.addEventListener("blur", () => {   // catatan baru yang dibiarkan kosong dibuang lagi
            if (ta.value.trim() || !row.isConnected) return;
            setTimeout(() => {
              if (!row.isConnected || ta.value.trim() || document.activeElement === ta) return;
              const a = list(), i = a.indexOf(n);
              if (i >= 0) { a.splice(i, 1); ctx.onChange(); draw(); }
            }, 150);
          });
          if (n.id === focusId) ta.focus();
        });
      };
      el.addEventListener("click", (e) => {
        const b = e.target.closest("[data-x]");
        if (!b || !ctx.chapter) return;
        if (b.dataset.x === "add") {
          const s = notesStore(ctx), id = ctx.chapter.id;
          if (!Array.isArray(s.byCh[id])) s.byCh[id] = [];
          if (s.byCh[id].length >= 100) { note("Maksimal 100 catatan per chapter.", tiIcon("info-circle")); return; }
          const n = { id: uid("note"), text: "", at: nowIso() };
          s.byCh[id].push(n);
          ctx.onChange();
          draw(n.id);
        } else if (b.dataset.x === "del") {
          const row = b.closest(".qdt-note"), a = list(), n = a.find((x) => x.id === row.dataset.id);
          if (!n || ((n.text || "").trim() && !confirm("Hapus catatan ini?"))) return;
          a.splice(a.indexOf(n), 1);
          save.cancel();
          ctx.onChange();
          draw();
        }
      });
      el._qdt = { draw };
      draw();
    },
    update(el, ctx, reason) { if (el._qdt && (reason === "chapter" || reason === "refresh")) el._qdt.draw(); },
  };

  /* ---------- TILE: Papan suasana ---------- */
  const MOOD_MAX = 24;
  function moodImages(ctx) {
    const s = ctx.store;
    if (!Array.isArray(s.images)) s.images = [];
    s.images = s.images.filter((m) => m && typeof m.src === "string" && DATA_IMG.test(m.src));
    return s.images;
  }
  function openLightbox(ctx, start, onChanged) {
    let i = start;
    const d = openDialog({
      title: "Papan suasana", icon: tiIcon("photo"), size: "lg", cls: "qdt-lightbox",
      onKey: (e) => {
        if (isEditable(e.target)) return false;
        if (e.key === "ArrowRight") { e.preventDefault(); go(1); return true; }
        if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); return true; }
        return false;
      },
    });
    d.actions.innerHTML = `<button type="button" class="qd-btn qd-btn-soft qd-btn-sm is-danger" data-x="del">${px(tiIcon("trash"), 15)}<span>Hapus</span></button>`;
    d.body.innerHTML = `<div class="qdt-lb">
        <button type="button" class="qdt-lb-nav" data-x="prev" aria-label="Gambar sebelumnya">${px(tiIcon("chevron-left"), 22)}</button>
        <img class="qdt-lb-img" alt="Gambar papan suasana">
        <button type="button" class="qdt-lb-nav" data-x="next" aria-label="Gambar berikutnya">${px(tiIcon("chevron-right"), 22)}</button>
      </div>`;
    const show = () => {
      const imgs = moodImages(ctx);
      if (!imgs.length) { d.close(); return; }
      i = (i + imgs.length) % imgs.length;
      $(d.body, "img").src = imgs[i].src;
      d.setSub(`${i + 1} dari ${imgs.length}`);
      $$(d.body, ".qdt-lb-nav").forEach((b) => { b.disabled = imgs.length < 2; });
    };
    const go = (n) => { i += n; show(); };
    d.el.addEventListener("click", (e) => {
      const b = e.target.closest("[data-x]");
      if (!b) return;
      if (b.dataset.x === "prev") go(-1);
      else if (b.dataset.x === "next") go(1);
      else if (b.dataset.x === "del") {
        if (!confirm("Hapus gambar ini dari papan suasana?")) return;
        moodImages(ctx).splice(i, 1);
        ctx.onChange();
        onChanged();
        show();
      }
    });
    show();
  }
  const tileMood = {
    id: "mood", title: "Papan suasana", icon: tiIcon("photo"),
    render(el, ctx) {
      el.innerHTML = '<div class="qdt-mood"></div><input type="file" accept="image/*" multiple hidden class="qdt-file">';
      const box = $(el, ".qdt-mood"), file = $(el, ".qdt-file");
      let busy = false;
      const draw = () => {
        const imgs = moodImages(ctx);
        if (!imgs.length) {
          box.innerHTML = `<div class="qdt-mood-empty">
              <div class="qdt-mood-dots" aria-hidden="true">${px(tiIcon("layout-grid"), 20)}</div>
              <button type="button" class="qdt-add" data-x="pick">${px(tiIcon("plus"), 15)}<span>Buat papan suasana</span></button>
              <small>atau seret gambar ke sini</small>
            </div>`;
          return;
        }
        box.innerHTML = `<div class="qdt-mood-grid">${imgs.map((m, i) => `<div class="qdt-mood-cell">
            <button type="button" class="qdt-mood-img" data-x="view" data-i="${i}" aria-label="Perbesar gambar ${i + 1}"><img alt="" draggable="false"></button>
            <button type="button" class="qdt-mood-del" data-x="del" data-i="${i}" title="Hapus gambar" aria-label="Hapus gambar ${i + 1}">${px(tiIcon("x"), 12)}</button>
          </div>`).join("")}${imgs.length < MOOD_MAX ? `<button type="button" class="qdt-mood-add" data-x="pick" title="Tambah gambar" aria-label="Tambah gambar">${px(tiIcon("plus"), 18)}</button>` : ""}</div>`;
        $$(box, ".qdt-mood-img img").forEach((im, i) => { im.src = imgs[i].src; });   // src lewat properti (sudah divalidasi)
      };
      const add = (files) => {
        files = imageFiles(files);
        if (!files.length || busy) return;
        const room = MOOD_MAX - moodImages(ctx).length;
        if (room <= 0) { note(`Papan suasana penuh (maks. ${MOOD_MAX} gambar).`, tiIcon("info-circle")); return; }
        if (files.length > room) note(`Hanya ${room} gambar lagi yang muat.`, tiIcon("info-circle"));
        busy = true;
        el.classList.add("is-busy");
        files.slice(0, room).reduce((chain, f) => chain.then(() => readImage(f, 800).then((r) => { moodImages(ctx).push({ id: uid("mood"), src: r.src, at: nowIso() }); })), Promise.resolve())
          .catch((err) => note(err.message || "Gambar gagal dibaca.", tiIcon("alert-triangle")))
          .finally(() => { busy = false; el.classList.remove("is-busy"); ctx.onChange(); if (el.isConnected) draw(); });
      };
      file.addEventListener("change", () => { add(file.files); file.value = ""; });
      dropFiles(el, add);
      el.addEventListener("click", (e) => {
        const b = e.target.closest("[data-x]");
        if (!b) return;
        if (b.dataset.x === "pick") file.click();
        else if (b.dataset.x === "view") openLightbox(ctx, +b.dataset.i, draw);
        else if (b.dataset.x === "del") {
          const imgs = moodImages(ctx), i = +b.dataset.i;
          if (!imgs[i]) return;
          imgs.splice(i, 1);
          ctx.onChange();
          draw();
        }
      });
      el._qdt = { draw };
      draw();
    },
    update(el, ctx, reason) { if (reason === "refresh" && el._qdt) el._qdt.draw(); },
  };

  /* ---------- TILE: Grafik dunia (karakter/lokasi yang muncul di tiap chapter cerita ini) ---------- */
  const tileWorldGraph = {
    id: "worldgraph", title: "Grafik dunia", icon: tiIcon("chart-dots-3"),
    render(el, ctx) {
      el.innerHTML = '<div class="qdt-graph"></div>';
      const box = $(el, ".qdt-graph"), cache = new Map();   // id chapter -> { key, counts } (chapter lain jarang berubah)
      const st = { ents: [], w: 0 };
      const compute = () => {
        const story = ctx.story, cur = ctx.chapter;
        const ents = entities(ctx, ["characters", "locations"]), m = matcherFor(ents);
        const chs = story.chapters.map((c, i) => {
          let counts;
          if (c === cur) counts = countMentions(ctx.getChapterText(), m);
          else {
            const key = m.sig.length + "|" + hashStr(m.sig) + "|" + c.updatedAt + "|" + c.html.length;
            let hit = cache.get(c.id);
            if (!hit || hit.key !== key) { hit = { key, counts: countMentions(htmlToText(c.html), m) }; cache.set(c.id, hit); }
            counts = hit.counts;
          }
          return { c, i, counts };
        });
        const tot = new Map(), links = [];
        chs.forEach((x) => x.counts.forEach((n, id) => { tot.set(id, (tot.get(id) || 0) + n); links.push({ ch: x.c.id, ent: id, n }); }));
        const used = ents.filter((e) => tot.get(e.id)).sort((a, b) => tot.get(b.id) - tot.get(a.id)).slice(0, 14);
        const keep = new Set(used.map((e) => e.id));
        const linked = new Set(links.filter((l) => keep.has(l.ent)).map((l) => l.ch));
        const chShown = (chs.length <= 30 ? chs : chs.filter((x) => linked.has(x.c.id) || x.c === cur)).slice(0, 40);
        return { story, cur, chs: chShown, ents: used, links: links.filter((l) => keep.has(l.ent) && chShown.some((x) => x.c.id === l.ch)), tot };
      };
      const draw = () => {
        if (!ctx.chapter) return;
        const g = compute();
        st.ents = g.ents;
        if (!g.links.length) {
          box.innerHTML = '<div class="qdt-empty">Tautkan beberapa dokumen dan dunianya akan terbentuk di sini<small>Sebut nama karakter atau lokasi dari Kodeks di chapter-mu.</small></div>';
          return;
        }
        const W = Math.max(260, Math.round(box.clientWidth || 300)), row = 26, pad = 12;
        st.w = W;
        const H = Math.max(g.chs.length, g.ents.length) * row + pad * 2;
        const xL = Math.round(W * 0.36), xR = W - xL, maxCh = Math.max(6, Math.floor((xL - 16) / 6.3));
        const yOf = (i, n) => pad + (H - pad * 2 - n * row) / 2 + i * row + row / 2;
        const cut = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);
        const chY = new Map(g.chs.map((x, i) => [x.c.id, yOf(i, g.chs.length)])), enY = new Map(g.ents.map((e, i) => [e.id, yOf(i, g.ents.length)]));
        const mid = W / 2;
        const edges = g.links.map((l) => {
          const y1 = chY.get(l.ch), y2 = enY.get(l.ent), sw = (1 + Math.min(3, Math.log2(l.n + 1) * 0.9)).toFixed(2);
          return `<path class="qdt-g-edge" data-ch="${esc(l.ch)}" data-ent="${esc(l.ent)}" d="M${xL + 6} ${y1.toFixed(1)} C${mid} ${y1.toFixed(1)} ${mid} ${y2.toFixed(1)} ${xR - 6} ${y2.toFixed(1)}" stroke-width="${sw}"><title>${l.n}×</title></path>`;
        }).join("");
        const chNodes = g.chs.map((x) => {
          const y = chY.get(x.c.id), label = roman(x.i + 1) + " · " + chapterName(g.story, x.c), on = x.c === g.cur;
          return `<g class="qdt-g-node is-ch${on ? " is-cur" : ""}" data-ch="${esc(x.c.id)}" tabindex="0" role="button" aria-label="${esc((on ? "Chapter ini: " : "Buka ") + label)}">
              <circle cx="${xL}" cy="${y.toFixed(1)}" r="${on ? 6 : 5}"></circle>
              <text x="${xL - 11}" y="${(y + 4).toFixed(1)}" text-anchor="end">${esc(cut(label, maxCh))}</text></g>`;
        }).join("");
        const enNodes = g.ents.map((e) => {
          const y = enY.get(e.id);
          return `<g class="qdt-g-node is-ent is-${e.kind}" data-ent="${esc(e.id)}" data-kind="${e.kind}" tabindex="0" role="button" aria-label="${esc(e.title)}: ${g.tot.get(e.id)} sebutan">
              <circle cx="${xR}" cy="${y.toFixed(1)}" r="5"></circle>
              <text x="${xR + 11}" y="${(y + 4).toFixed(1)}">${esc(cut(e.title, maxCh))}</text></g>`;
        }).join("");
        box.innerHTML = `<svg class="qdt-g-svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Grafik kemunculan karakter dan lokasi per chapter">${edges}${chNodes}${enNodes}</svg>
          <div class="qdt-g-legend"><span><i class="is-ch"></i>Chapter</span><span><i class="is-characters"></i>Karakter</span><span><i class="is-locations"></i>Lokasi</span></div>`;
      };
      const later = debounce(draw, 350);
      const hl = (node) => {
        const svg = $(box, "svg");
        if (!svg) return;
        $$(svg, ".qdt-g-edge.is-hl").forEach((p) => p.classList.remove("is-hl"));
        svg.classList.toggle("is-hover", !!node);
        if (!node) return;
        const sel = node.dataset.ch ? `.qdt-g-edge[data-ch="${CSS.escape(node.dataset.ch)}"]` : `.qdt-g-edge[data-ent="${CSS.escape(node.dataset.ent)}"]`;
        $$(svg, sel).forEach((p) => p.classList.add("is-hl"));
      };
      const act = (node) => {
        if (node.dataset.ch) { if (!ctx.chapter || node.dataset.ch !== ctx.chapter.id) ctx.openChapter(node.dataset.ch); }
        else { const ent = st.ents.find((e) => e.id === node.dataset.ent && e.kind === node.dataset.kind); if (ent) showEntity(node, ent, ctx); }
      };
      box.addEventListener("mouseover", (e) => hl(e.target.closest(".qdt-g-node")));
      box.addEventListener("mouseleave", () => hl(null));
      box.addEventListener("focusin", (e) => hl(e.target.closest(".qdt-g-node")));
      box.addEventListener("click", (e) => { const n = e.target.closest(".qdt-g-node"); if (n) act(n); });
      box.addEventListener("keydown", (e) => { const n = e.target.closest(".qdt-g-node"); if (n && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); act(n); } });
      ctx.onTextChange(later);
      if (typeof ResizeObserver !== "undefined") {
        st.ro = new ResizeObserver(() => { const w = Math.round(box.clientWidth); if (w && st.w && Math.abs(w - st.w) > 16) later(); });
        st.ro.observe(box);
      }
      st.draw = draw;
      st.later = later;
      el._qdt = st;
      draw();
    },
    update(el) { if (el._qdt) el._qdt.draw(); },
    destroy(el) { if (el._qdt) { el._qdt.later.cancel(); if (el._qdt.ro) el._qdt.ro.disconnect(); } },
  };

  /* ============================ ALAT: DRAF ============================ */
  const MAX_DRAFTS = 20, AUTO_MS = 30 * 60 * 1000;
  function draftStore(story) {
    const p = story.panel;
    if (!isObj(p.drafts)) p.drafts = {};
    const d = p.drafts;
    if (!isObj(d.byCh)) d.byCh = {};
    if (!isObj(d.img)) d.img = {};
    return d;
  }
  function draftsOf(store, chId) {
    const a = store.byCh[chId];
    if (!Array.isArray(a)) return [];
    const ok = a.filter((x) => x && typeof x.id === "string" && typeof x.html === "string" && typeof x.at === "string");
    if (ok.length !== a.length) store.byCh[chId] = ok;
    return store.byCh[chId];
  }
  const cleanHtml = (html) => { const h = String(html || "").replace(/ class=""/g, ""); return h === "<p><br></p>" ? "" : h; };
  const hasContent = (html) => !!html && (/<img/i.test(html) || !!htmlToText(html).trim());
  // gambar data: di html draf -> src="qdtimg:KUNCI" (data URL-nya disimpan sekali di store.img)
  function poolize(html, pool) {
    return html.replace(/src="(data:image\/(?:png|jpeg|webp|gif);base64,[a-z0-9+/=]+)"/gi, (m, url) => { const k = hashStr(url); pool[k] = url; return `src="qdtimg:${k}"`; });
  }
  function expandHtml(html, pool) {
    return String(html || "").replace(/src="qdtimg:([a-z0-9]+)"/g, (m, k) => (typeof pool[k] === "string" && DATA_IMG.test(pool[k]) ? `src="${pool[k]}"` : 'src=""'));
  }
  function gcDrafts(story, store) {
    const ids = new Set(story.chapters.map((c) => c.id)), used = new Set();
    Object.keys(store.byCh).forEach((k) => { if (!ids.has(k) || !Array.isArray(store.byCh[k]) || !store.byCh[k].length) delete store.byCh[k]; });
    Object.keys(store.byCh).forEach((k) => draftsOf(store, k).forEach((d) => { for (const m of d.html.matchAll(/qdtimg:([a-z0-9]+)/g)) used.add(m[1]); }));
    Object.keys(store.img).forEach((k) => { if (!used.has(k)) delete store.img[k]; });
  }
  function takeDraft(story, ch, html, title, kind) {
    html = cleanHtml(html);
    if (kind !== "manual" && !hasContent(html)) return null;
    const store = draftStore(story), hash = hashStr(html);
    if (!Array.isArray(store.byCh[ch.id])) store.byCh[ch.id] = [];
    const arr = draftsOf(store, ch.id);
    if (kind !== "manual" && arr[0] && arr[0].hash === hash) return null;   // sama persis dengan draf terbaru
    const dr = { id: uid("draft"), title: String(title || "").trim().slice(0, 80), at: nowIso(), words: countWords(htmlToText(html)), hash, kind, html: poolize(html, store.img) };
    arr.unshift(dr);
    if (arr.length > MAX_DRAFTS) arr.splice(MAX_DRAFTS);
    gcDrafts(story, store);
    return dr;
  }
  // dipanggil saat editor/chapter dibuka: draf otomatis bila draf terakhir > 30 menit & isinya berbeda
  function autoDraft(ctx) {
    const story = ctx.story, ch = ctx.chapter;
    if (!story || !ch || !hasContent(ch.html)) return;
    const store = isObj(story.panel.drafts) && isObj(story.panel.drafts.byCh) ? story.panel.drafts : null;
    const last = store ? draftsOf(store, ch.id)[0] : null;
    if (last && (Date.now() - new Date(last.at).getTime() <= AUTO_MS || last.hash === hashStr(cleanHtml(ch.html)))) return;
    if (takeDraft(story, ch, ch.html, "", "auto")) ctx.onChange();
  }
  const draftLabel = (d) => d.title || (d.kind === "auto" ? "Draf otomatis" : d.kind === "restore" ? "Sebelum dipulihkan" : "Draf tanpa judul");
  function openDrafts(ctx) {
    const story = ctx.story, ch = ctx.chapter;
    if (!story || !ch) return;
    api().flush();
    const store = draftStore(story);
    gcDrafts(story, store);
    const d = openDialog({ title: "Draf", sub: chapterName(story, ch), icon: tiIcon("stack-2"), size: "md", cls: "qdt-drafts" });
    d.body.innerHTML = `<div class="qdt-dr">
        <section class="qdt-dr-side">
          <form class="qdt-dr-new">
            <input class="qdt-input" maxlength="80" placeholder="Judul draf (opsional)" aria-label="Judul draf">
            <button type="submit" class="qd-btn qd-btn-accent qd-btn-sm">${px(tiIcon("device-floppy"), 15)}<span>Simpan draf</span></button>
          </form>
          <p class="qdt-hint">Draf otomatis dibuat saat chapter dibuka bila draf terakhir lebih dari 30 menit dan isinya berubah. Maks. ${MAX_DRAFTS} draf per chapter.</p>
          <ol class="qdt-dr-list" aria-label="Daftar draf"></ol>
        </section>
        <section class="qdt-dr-view" aria-live="polite"></section>
      </div>`;
    const listEl = $(d.body, ".qdt-dr-list"), view = $(d.body, ".qdt-dr-view"), form = $(d.body, ".qdt-dr-new"), titleIn = $(form, "input");
    let selId = null;
    const curWords = () => countWords(htmlToText(ch.html));
    const drawList = () => {
      const arr = draftsOf(store, ch.id);
      listEl.innerHTML = arr.length ? arr.map((x) => `<li><button type="button" class="qdt-dr-item${x.id === selId ? " is-on" : ""}" data-id="${esc(x.id)}" aria-pressed="${x.id === selId}" title="${esc(fullDate(x.at))}">
            <span class="qdt-dr-ic">${px(x.kind === "auto" ? tiIcon("clock") : x.kind === "restore" ? tiIcon("history") : tiIcon("file-text"), 15)}</span>
            <span class="qdt-dr-main"><span class="qdt-dr-title">${esc(draftLabel(x))}</span><span class="qdt-dr-meta">${esc(ago(x.at))} · ${fmtNum(x.words)} kata</span></span>
            ${x.kind === "auto" ? '<span class="qdt-badge">Otomatis</span>' : ""}
          </button></li>`).join("")
        : '<li class="qdt-empty">Belum ada draf untuk chapter ini.</li>';
    };
    const drawView = () => {
      const x = draftsOf(store, ch.id).find((y) => y.id === selId);
      if (!x) {
        view.innerHTML = `<div class="qdt-empty-big">${px(tiIcon("stack-2"), 28)}<p>${draftsOf(store, ch.id).length ? "Pilih draf untuk melihat isinya." : "Simpan draf untuk membuat titik pulih chapter ini."}</p></div>`;
        return;
      }
      const diff = x.words - curWords();
      view.innerHTML = `<div class="qdt-dr-vhead">
          <div class="qdt-dr-vtitles"><div class="qdt-dr-vtitle">${esc(draftLabel(x))}</div>
            <div class="qdt-dr-meta">${esc(fullDate(x.at))} · ${fmtNum(x.words)} kata${diff ? ` (${diff > 0 ? "+" : "−"}${fmtNum(Math.abs(diff))} dari sekarang)` : " (sama dengan sekarang)"}</div></div>
          <div class="qdt-dr-vact">
            <button type="button" class="qd-btn qd-btn-accent qd-btn-sm" data-x="restore">${px(tiIcon("restore"), 15)}<span>Pulihkan</span></button>
            <button type="button" class="qd-btn qd-btn-soft qd-btn-sm is-danger" data-x="del">${px(tiIcon("trash"), 15)}<span>Hapus</span></button>
          </div>
        </div>
        <div class="qdt-dr-paper">${ctx.sanitizeHtml(expandHtml(x.html, store.img)) || '<p class="qdt-dim">(Draf ini kosong)</p>'}</div>`;
    };
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      api().flush();
      if (!hasContent(cleanHtml(ch.html))) { note("Chapter ini masih kosong.", tiIcon("info-circle")); return; }
      const x = takeDraft(story, ch, ch.html, titleIn.value, "manual");
      titleIn.value = "";
      ctx.onChange();
      selId = x.id;
      drawList(); drawView();
      note("Draf disimpan", tiIcon("device-floppy"));
    });
    listEl.addEventListener("click", (e) => {
      const b = e.target.closest(".qdt-dr-item");
      if (!b) return;
      selId = b.dataset.id;
      drawList(); drawView();
      if (isPhone()) view.scrollIntoView({ block: "start", behavior: "smooth" });
    });
    view.addEventListener("click", (e) => {
      const b = e.target.closest("[data-x]"), arr = draftsOf(store, ch.id), x = arr.find((y) => y.id === selId);
      if (!b || !x) return;
      if (b.dataset.x === "restore") {
        if (!confirm(`Pulihkan "${draftLabel(x)}"? Isi chapter sekarang disimpan dulu sebagai draf.`)) return;
        if (!ctx.chapter) return;
        api().flush();
        takeDraft(story, ch, ch.html, "Sebelum memulihkan", "restore");
        ctx.replaceChapterHtml(expandHtml(x.html, store.img));
        ctx.onChange();
        drawList(); drawView();
        note("Draf dipulihkan", tiIcon("restore"));
      } else if (b.dataset.x === "del") {
        if (!confirm(`Hapus "${draftLabel(x)}"?`)) return;
        arr.splice(arr.indexOf(x), 1);
        gcDrafts(story, store);
        ctx.onChange();
        selId = null;
        drawList(); drawView();
      }
    });
    selId = (draftsOf(store, ch.id)[0] || {}).id || null;
    drawList(); drawView();
  }

  /* ============================ ALAT: GAYA (tipografi per cerita) ============================ */
  const STYLE_FONTS = [
    { id: "book", label: "Buku", css: '"Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif' },
    { id: "georgia", label: "Georgia", css: 'Georgia, "Times New Roman", serif' },
    { id: "sans", label: "Sans", css: 'Inter, -apple-system, "Segoe UI", Arial, sans-serif' },
    { id: "mono", label: "Mono", css: 'ui-monospace, Menlo, Consolas, "Courier New", monospace' },
    { id: "dyslexic", label: "OpenDyslexic", css: '"OpenDyslexic", Inter, -apple-system, sans-serif' },
  ];
  const STYLE_THEMES = [
    { id: "auto", label: "Ikuti aplikasi" },
    { id: "dark", label: "Gelap", paper: "#17181d", ink: "#e7e2d8", dim: "#9b968d" },
    { id: "paper", label: "Kertas", paper: "#fbf8f1", ink: "#28241f", dim: "#7a7266" },
    { id: "sepia", label: "Sepia", paper: "#f1e3c6", ink: "#4a3a28", dim: "#86704f" },
  ];
  const STYLE_DEF = { font: "book", size: 18, lh: 1.78, pgap: 0.95, indent: 0, width: 760, theme: "auto" };
  const STYLE_RANGE = {
    size: { label: "Ukuran huruf", min: 14, max: 26, step: 1, fmt: (v) => v + " px" },
    lh: { label: "Jarak baris", min: 1.3, max: 2.2, step: 0.02, fmt: (v) => v.toFixed(2).replace(".", ",") },
    pgap: { label: "Jarak paragraf", min: 0, max: 1.6, step: 0.05, fmt: (v) => v.toFixed(2).replace(".", ",") + " em" },
    indent: { label: "Inden baris pertama", min: 0, max: 3, step: 0.1, fmt: (v) => (v ? v.toFixed(1).replace(".", ",") + " em" : "tanpa inden") },
    width: { label: "Lebar halaman", min: 560, max: 1000, step: 20, fmt: (v) => v + " px" },
  };
  const fontCss = (id) => (STYLE_FONTS.find((f) => f.id === id) || STYLE_FONTS[0]).css;
  // hanya setelan yang valid & diubah pengguna
  function styleOf(story) {
    const raw = story && isObj(story.panel) && isObj(story.panel.style) ? story.panel.style : null, o = {};
    if (!raw) return o;
    if (STYLE_FONTS.some((f) => f.id === raw.font)) o.font = raw.font;
    Object.keys(STYLE_RANGE).forEach((k) => {
      const v = Number(raw[k]), r = STYLE_RANGE[k];
      if (raw[k] != null && raw[k] !== "" && isFinite(v)) o[k] = clamp(v, r.min, r.max);
    });
    if (raw.theme !== "auto" && STYLE_THEMES.some((t) => t.id === raw.theme)) o.theme = raw.theme;
    return o;
  }
  const STYLE_VARS = ["--qdt-font", "--qdt-size", "--qdt-rscale", "--qdt-lh", "--qdt-pgap", "--qdt-indent", "--qdt-width", "--qdt-paper", "--qdt-ink", "--qdt-dim"];
  // pasang setelan ke elemen .qd-editor (editor) atau .qd-reader (Putar): kelas qdt-s-* + variabel CSS (lihat quill.css)
  function applyStyle(el, st) {
    if (!el) return;
    Array.from(el.classList).filter((c) => /^qdt-(s-|theme)/.test(c)).forEach((c) => el.classList.remove(c));
    STYLE_VARS.forEach((v) => el.style.removeProperty(v));
    if (el.classList.contains("qd-reader")) { el.style.removeProperty("--paper"); el.style.removeProperty("--ink"); }
    const set = (k, v) => el.style.setProperty(k, v);
    if (st.font) { el.classList.add("qdt-s-font"); set("--qdt-font", fontCss(st.font)); }
    if (st.size != null) { el.classList.add("qdt-s-size"); set("--qdt-size", st.size + "px"); set("--qdt-rscale", (st.size / STYLE_DEF.size).toFixed(3) + "em"); }
    if (st.lh != null) { el.classList.add("qdt-s-lh"); set("--qdt-lh", String(st.lh)); }
    if (st.pgap != null) { el.classList.add("qdt-s-pgap"); set("--qdt-pgap", st.pgap + "em"); }
    if (st.indent != null) { el.classList.add("qdt-s-indent"); set("--qdt-indent", st.indent + "em"); }
    if (st.width != null) { el.classList.add("qdt-s-width"); set("--qdt-width", st.width + "px"); }
    const th = st.theme && STYLE_THEMES.find((t) => t.id === st.theme);
    if (th && th.paper) {
      el.classList.add("qdt-theme", "qdt-theme-" + th.id);
      set("--qdt-paper", th.paper); set("--qdt-ink", th.ink); set("--qdt-dim", th.dim);
      if (el.classList.contains("qd-reader")) { set("--paper", th.paper); set("--ink", th.ink); }
    }
  }
  const SAMPLE = "<p>Hujan turun pelan di atas atap-atap kota tua. Di ujung gang, sebuah lampu jalan berkedip, seolah ragu untuk tetap menyala.</p><p>Raka merapatkan mantelnya. Ia sudah menunggu terlalu lama, dan surat di sakunya terasa semakin berat setiap kali angin berembus.</p><p>“Kau datang juga,” kata sebuah suara dari balik bayangan.</p>";
  function previewHtml(ctx) {
    if (!inertDoc) inertDoc = document.implementation.createHTMLDocument("");
    const box = inertDoc.createElement("div");
    box.innerHTML = ctx.sanitizeHtml(ctx.getChapterHtml());
    $$(box, "img, figure, hr").forEach((x) => x.remove());
    const blocks = Array.from(box.children).filter((x) => (x.textContent || "").trim()).slice(0, 4);
    return blocks.length && blocks.reduce((a, b) => a + (b.textContent || "").length, 0) > 60 ? blocks.map((b) => b.outerHTML).join("") : SAMPLE;
  }
  let curEditorEl = null;   // .qd-editor yang sedang tampil (dari kait "screen")
  function openStyle(ctx) {
    const story = ctx.story;
    if (!story) return;
    const store = ctx.store, save = debounce(() => ctx.onChange(), 400);
    const d = openDialog({ title: "Gaya", sub: "Tipografi editor & mode Putar untuk cerita ini", icon: tiIcon("palette"), size: "md", cls: "qdt-style" });
    const range = (k) => { const r = STYLE_RANGE[k]; return `<div class="qdt-field"><div class="qdt-label"><span>${r.label}</span><output class="qdt-val" data-for="${k}"></output></div>
        <input type="range" class="qdt-range" data-key="${k}" min="${r.min}" max="${r.max}" step="${r.step}" aria-label="${r.label}"></div>`; };
    d.body.innerHTML = `<div class="qdt-st">
        <div class="qdt-st-ctl">
          <div class="qdt-field"><div class="qdt-label"><span>Huruf</span></div>
            <div class="qdt-fonts" role="radiogroup" aria-label="Huruf">${STYLE_FONTS.map((f) => `<button type="button" class="qdt-font" role="radio" data-font="${f.id}" title="${esc(f.label)}"><b style="font-family:${esc(f.css)}">Aa</b><span>${esc(f.label)}</span></button>`).join("")}</div></div>
          ${Object.keys(STYLE_RANGE).map(range).join("")}
          <div class="qdt-field"><div class="qdt-label"><span>Tema kertas</span></div>
            <div class="qdt-themes" role="radiogroup" aria-label="Tema kertas">${STYLE_THEMES.map((t) => `<button type="button" class="qdt-theme-sw" role="radio" data-theme="${t.id}"><span class="qdt-theme-chip is-${t.id}"></span><span>${t.label}</span></button>`).join("")}</div></div>
          <div class="qdt-st-foot">
            <button type="button" class="qd-btn qd-btn-soft qd-btn-sm" data-x="reset">${px(tiIcon("restore"), 15)}<span>Atur ulang</span></button>
            <span class="qdt-flex"></span>
            <button type="button" class="qd-btn qd-btn-primary qd-btn-sm" data-x="done">Selesai</button>
          </div>
        </div>
        <div class="qdt-st-pv">
          <div class="qdt-label"><span>Pratinjau</span></div>
          <div class="qdt-pv-page"><div class="qdt-pv-title"></div><div class="qdt-pv-body"></div></div>
          <p class="qdt-hint">Berlaku di editor chapter dan mode Putar. Di mode Putar, ukuran huruf masih bisa diatur lagi dengan tombol A−/A+.</p>
        </div>
      </div>`;
    const page = $(d.body, ".qdt-pv-page");
    $(page, ".qdt-pv-title").textContent = ctx.chapter ? chapterName(story, ctx.chapter) : "Chapter I";
    $(page, ".qdt-pv-body").innerHTML = previewHtml(ctx);
    const sync = () => {
      const st = styleOf(story), eff = Object.assign({}, STYLE_DEF, st);
      $$(d.body, ".qdt-font").forEach((b) => { const on = b.dataset.font === eff.font; b.classList.toggle("is-on", on); b.setAttribute("aria-checked", String(on)); });
      $$(d.body, ".qdt-theme-sw").forEach((b) => { const on = b.dataset.theme === eff.theme; b.classList.toggle("is-on", on); b.setAttribute("aria-checked", String(on)); });
      $$(d.body, ".qdt-range").forEach((r) => { const k = r.dataset.key; if (document.activeElement !== r) r.value = String(eff[k]); $(d.body, `.qdt-val[data-for="${k}"]`).textContent = STYLE_RANGE[k].fmt(eff[k]); });
      // pratinjau memakai nilai efektif (bawaan + yang diubah)
      page.style.fontFamily = fontCss(eff.font);
      page.style.fontSize = eff.size + "px";
      page.style.lineHeight = String(eff.lh);
      page.style.setProperty("--qdt-pgap", eff.pgap + "em");
      page.style.setProperty("--qdt-indent", eff.indent + "em");
      const th = STYLE_THEMES.find((t) => t.id === eff.theme);
      page.className = "qdt-pv-page is-" + eff.theme;
      if (th && th.paper) { page.style.setProperty("--qdt-paper", th.paper); page.style.setProperty("--qdt-ink", th.ink); page.style.setProperty("--qdt-dim", th.dim); }
      applyStyle(curEditorEl && curEditorEl.isConnected ? curEditorEl : document.querySelector("#quillRoot .qd-editor"), st);
    };
    d.body.addEventListener("input", (e) => {
      const r = e.target.closest(".qdt-range");
      if (!r) return;
      store[r.dataset.key] = Number(r.value);
      sync(); save();
    });
    d.body.addEventListener("click", (e) => {
      const f = e.target.closest(".qdt-font"), t = e.target.closest(".qdt-theme-sw"), x = e.target.closest("[data-x]");
      if (f) store.font = f.dataset.font;
      else if (t) { if (t.dataset.theme === "auto") delete store.theme; else store.theme = t.dataset.theme; }
      else if (x && x.dataset.x === "reset") Object.keys(store).forEach((k) => delete store[k]);
      else if (x && x.dataset.x === "done") { d.close(); return; }
      else return;
      sync(); save();
    });
    sync();
  }

  /* ============================ ALAT: MAP ============================ */
  // buka tab Map lalu pilih petanya lewat daftar peta di sidebar Map (modul Map tidak punya API pilih-peta)
  function openMapTab(ctx, mapId) {
    ctx.openProjectTab("map");
    if (!mapId) return;
    const t0 = Date.now();
    (function pick() {
      const tab = document.getElementById("tabMap"), list = document.getElementById("mpList");
      if (!tab || tab.classList.contains("hidden")) return;   // pengguna sudah pindah tab
      if (window.NovelMap && list && list.querySelector(".mp-item")) {
        const search = document.getElementById("mpSearch");
        if (search && search.value) { search.value = ""; search.dispatchEvent(new Event("input")); }
        const maps = (ctx.project.data.maps || []).filter((m) => m);
        const btn = list.querySelectorAll(".mp-item")[maps.findIndex((m) => m.id === mapId)];
        if (btn && !btn.classList.contains("is-current")) btn.click();
        return;
      }
      if (Date.now() - t0 < 10000) setTimeout(pick, 120);
    })();
  }
  function openMaps(ctx) {
    const maps = (Array.isArray(ctx.getMaps()) ? ctx.getMaps() : []).filter((m) => m && typeof m.id === "string");
    const d = openDialog({ title: "Map", sub: maps.length ? maps.length + " peta di project ini" : "Peta di project ini", icon: tiIcon("map-2"), size: "sm", cls: "qdt-maps" });
    d.body.innerHTML = maps.length
      ? `<div class="qdt-maplist">${maps.map((m) => {
          const places = Array.isArray(m.places) ? m.places.length : 0, zones = Array.isArray(m.zones) ? m.zones.length : 0;
          return `<button type="button" class="qdt-map" data-id="${esc(m.id)}"><span class="qdt-map-ic">${px(tiIcon("map"), 18)}</span>
            <span class="qdt-map-main"><b>${esc((m.title || "").trim() || "(tanpa nama)")}</b><small>${fmtNum(places)} tempat · ${fmtNum(zones)} wilayah</small></span>${px(tiIcon("chevron-right"), 16)}</button>`;
        }).join("")}</div>
        <div class="qdt-dlg-foot"><button type="button" class="qd-btn qd-btn-soft qd-btn-sm" data-x="tab">${px(tiIcon("external-link"), 15)}<span>Buka tab Map</span></button></div>`
      : `<div class="qdt-empty-big">${px(tiIcon("map-off"), 28)}<p>Belum ada peta di project ini.</p>
          <button type="button" class="qd-btn qd-btn-accent qd-btn-sm" data-x="tab">${px(tiIcon("plus"), 15)}<span>Buat peta di tab Map</span></button></div>`;
    d.body.addEventListener("click", (e) => {
      const m = e.target.closest(".qdt-map"), t = e.target.closest('[data-x="tab"]');
      if (!m && !t) return;
      d.close();
      openMapTab(ctx, m ? m.dataset.id : null);
    });
  }

  /* ============================ REACT FLOW (Pohon relasi & Kanvas) ============================ */
  let flowPromise = null;
  function ensureFlow() {
    if (window.ReactFlow && window.React && window.ReactDOM) return Promise.resolve();
    if (!flowPromise) {
      const load = typeof loadScriptOnce === "function" ? loadScriptOnce : (src) => new Promise((res, rej) => {
        const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => { s.remove(); rej(new Error("Gagal memuat " + src)); }; document.head.appendChild(s);
      });
      const react = typeof ensureReact === "function" ? ensureReact() : load("vendor/react-18.3.1.min.js").then(() => load("vendor/react-dom-18.3.1.min.js"));
      flowPromise = react.then(() => load("vendor/reactflow-11.11.4.umd.js"));
      flowPromise.catch(() => { flowPromise = null; });   // boleh dicoba lagi
    }
    return flowPromise;
  }
  const PALETTE = ["#d7a86e", "#6aa8ff", "#4caf82", "#c77dff", "#e15c5c", "#3fb8c9", "#e98a4f", "#b6c35a"];
  const colorOf = (id) => PALETTE[parseInt(hashStr(id).slice(0, 4), 36) % PALETTE.length];
  const initialOf = (name) => { const m = String(name || "").trim().match(/[\p{L}\p{N}]/u); return m ? m[0].toUpperCase() : "?"; };
  const validVp = (v) => isObj(v) && isFinite(v.x) && isFinite(v.y) && isFinite(v.zoom) && v.zoom > 0.05 && v.zoom < 5;
  const darkUi = () => !document.body.classList.contains("light");
  let KIT = null;
  function flowKit() {
    if (KIT) return KIT;
    const RF = window.ReactFlow, React = window.React, h = React.createElement;
    const Flow = RF.default || RF.ReactFlow;
    const SIDES = ["top", "right", "bottom", "left"];
    // --- Pohon relasi: node karakter + garis "mengambang" (menempel di tepi kotak, mengikuti posisi node)
    const CharNode = React.memo(({ data, selected }) => h("div", { className: "qdt-rn" + (selected ? " is-sel" : "") },
      SIDES.map((p) => h(RF.Handle, { key: p, id: p, type: "source", position: p, className: "qdt-rn-h" })),
      h("span", { className: "qdt-rn-av", style: { background: data.color } }, data.initial),
      h("span", { className: "qdt-rn-name" }, data.label),
      data.count ? h("span", { className: "qdt-rn-n", title: data.count + " relasi" }, String(data.count)) : null));
    const center = (n) => ({ x: n.positionAbsolute.x + (n.width || 120) / 2, y: n.positionAbsolute.y + (n.height || 40) / 2 });
    function borderPoint(n, to) {
      const c = center(n), w = (n.width || 120) / 2 + 3, hh = (n.height || 40) / 2 + 3, dx = to.x - c.x, dy = to.y - c.y;
      if (!dx && !dy) return c;
      const s = Math.min(w / Math.abs(dx || 1e-6), hh / Math.abs(dy || 1e-6));
      return { x: c.x + dx * s, y: c.y + dy * s };
    }
    const FloatEdge = ({ id, source, target, data, selected }) => {
      const s = RF.useStore(React.useCallback((st) => st.nodeInternals.get(source), [source]));
      const t = RF.useStore(React.useCallback((st) => st.nodeInternals.get(target), [target]));
      if (!s || !t || !s.positionAbsolute || !t.positionAbsolute) return null;
      const a = borderPoint(s, center(t)), b = borderPoint(t, center(s));
      const [path, lx, ly] = RF.getStraightPath({ sourceX: a.x, sourceY: a.y, targetX: b.x, targetY: b.y });
      const label = data && data.label;
      return h(React.Fragment, null,
        h(RF.BaseEdge, { id, path, interactionWidth: 22, style: { stroke: selected ? "var(--accent)" : "var(--qdt-edge)", strokeWidth: selected ? 2.4 : 1.7 } }),
        label ? h(RF.EdgeLabelRenderer, null, h("div", {
          className: "qdt-re-label nodrag nopan" + (selected ? " is-sel" : ""),
          style: { transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)` },
          onClick: () => data.onPick && data.onPick(id),
        }, label)) : null);
    };
    // --- Kanvas: catatan tempel & gambar (bisa diubah ukurannya)
    const NoteNode = React.memo(({ id, data, selected }) => h("div", { className: "qdt-cn qdt-cn-note qdt-c-" + data.color + (selected ? " is-sel" : "") },
      h(RF.NodeResizer, { isVisible: selected, minWidth: 120, minHeight: 90, onResizeEnd: (e, p) => data.onResize(id, p), lineClassName: "qdt-rz-line", handleClassName: "qdt-rz-handle" }),
      h("div", { className: "qdt-cn-bar", title: "Seret untuk memindah" }),
      h("textarea", { className: "qdt-cn-text nodrag nowheel", defaultValue: data.text, placeholder: "Tulis catatan…", "aria-label": "Isi catatan", onChange: (e) => data.onText(id, e.target.value) })));
    const ImgNode = React.memo(({ id, data, selected }) => h("div", { className: "qdt-cn qdt-cn-img" + (selected ? " is-sel" : "") },
      h(RF.NodeResizer, { isVisible: selected, keepAspectRatio: true, minWidth: 60, minHeight: 40, onResizeEnd: (e, p) => data.onResize(id, p), lineClassName: "qdt-rz-line", handleClassName: "qdt-rz-handle" }),
      h("img", { src: data.src, alt: "", draggable: false })));
    KIT = { RF, React, h, Flow, relNodes: { char: CharNode }, relEdges: { float: FloatEdge }, cvNodes: { note: NoteNode, img: ImgNode } };
    return KIT;
  }
  // dialog besar berisi kanvas React Flow; build(kit, flowEl, sideEl) -> elemen React
  async function flowDialog(o, build) {
    const d = openDialog(Object.assign({ size: "lg" }, o));
    d.body.classList.add("is-flow");
    d.body.innerHTML = `<div class="qdt-flowwrap${o.side ? " has-side" : ""}"><div class="qdt-flow"><div class="qdt-loading">${px(tiIcon("loader-2"), 18)}<span>Memuat…</span></div></div>${o.side ? '<aside class="qdt-flow-side"></aside>' : ""}</div>`;
    const flowEl = $(d.body, ".qdt-flow");
    try { await ensureFlow(); }
    catch (e) { flowEl.innerHTML = `<div class="qdt-loading">${esc(o.title)} gagal dimuat. Periksa koneksi lalu coba lagi.</div>`; return null; }
    if (d.closed) return null;
    const kit = flowKit();
    flowEl.innerHTML = "";
    const root = window.ReactDOM.createRoot(flowEl);
    const prevClose = d.close;
    d.close = () => { if (d.closed) return; try { root.unmount(); } catch (e) { /* abaikan */ } prevClose(); };
    const el = build(kit, flowEl, $(d.body, ".qdt-flow-side"), d);
    root.render(kit.h(kit.RF.ReactFlowProvider, null, el));
    return d;
  }

  /* ============================ ALAT: POHON RELASI ============================ */
  const REL_PRESETS = ["saudara", "sahabat", "teman", "kekasih", "musuh", "rival", "orang tua", "anak", "mentor", "rekan"];
  function openRelations(ctx) {
    const story = ctx.story;
    if (!story) return;
    const store = ctx.store;
    if (!isObj(store.pos)) store.pos = {};
    if (!Array.isArray(store.edges)) store.edges = [];
    const chars = () => entities(ctx, ["characters"]);
    const sel = { node: null, edge: null };
    const bridge = {};
    const save = debounce(() => ctx.onChange(), 400);
    flowDialog({ title: "Pohon relasi", sub: "Hubungan antar karakter · seret titik di tepi kartu ke karakter lain untuk menghubungkan", icon: tiIcon("hierarchy-2"), cls: "qdt-rel", side: true,
      onKey: (e) => {
        if ((e.key === "Delete" || e.key === "Backspace") && !isEditable(e.target) && sel.edge && bridge.removeEdge) { e.preventDefault(); bridge.removeEdge(sel.edge); return true; }
        return false;
      } }, (kit, flowEl, side) => {
      const { RF, React, h, Flow } = kit;
      // bersihkan relasi ke karakter yang sudah dihapus dari Organize
      const ids = new Set(chars().map((c) => c.id));
      store.edges = store.edges.filter((e) => e && typeof e.id === "string" && ids.has(e.source) && ids.has(e.target) && e.source !== e.target);
      const list = chars();
      const R = Math.max(170, list.length * 36);
      list.forEach((c, i) => {   // karakter baru: susun melingkar
        const p = store.pos[c.id];
        if (!isObj(p) || !isFinite(p.x) || !isFinite(p.y)) { const a = (i / Math.max(1, list.length)) * Math.PI * 2 - Math.PI / 2; store.pos[c.id] = { x: Math.round(Math.cos(a) * R), y: Math.round(Math.sin(a) * R * 0.75) }; }
      });
      const degree = (id) => store.edges.filter((e) => e.source === id || e.target === id).length;
      const toNode = (c) => ({ id: c.id, type: "char", position: { x: store.pos[c.id].x, y: store.pos[c.id].y }, data: { label: c.title.trim() || "(tanpa nama)", initial: initialOf(c.title), color: colorOf(c.id), count: degree(c.id) } });
      const pick = (id) => selectEdge(id);
      const toEdge = (e) => ({ id: e.id, source: e.source, target: e.target, type: "float", data: { label: e.label, onPick: pick } });
      const nameOf = (id) => { const c = chars().find((x) => x.id === id); return c ? c.title.trim() || "(tanpa nama)" : "?"; };
      const refreshCounts = () => { if (bridge.setNodes) bridge.setNodes((ns) => ns.map((n) => (n.data.count === degree(n.id) ? n : { ...n, data: { ...n.data, count: degree(n.id) } }))); };
      function selectEdge(id) {
        if (!bridge.setEdges) return;
        bridge.setEdges((es) => es.map((e) => (!!e.selected === (e.id === id) ? e : { ...e, selected: e.id === id })));
        bridge.setNodes((ns) => ns.map((n) => (n.selected ? { ...n, selected: false } : n)));
        sel.edge = id; sel.node = null;
        drawSel(); drawAll();
      }
      function addEdge(a, b, label) {
        if (!a || !b || a === b) { note("Pilih dua karakter yang berbeda.", tiIcon("info-circle")); return; }
        const ex = store.edges.find((e) => (e.source === a && e.target === b) || (e.source === b && e.target === a));
        if (ex) { selectEdge(ex.id); note("Relasi ini sudah ada — ubah labelnya di samping.", tiIcon("info-circle")); return; }
        const e = { id: uid("rel"), source: a, target: b, label: String(label || "").trim().slice(0, 40) };
        store.edges.push(e);
        ctx.onChange();
        bridge.setEdges((es) => es.map((x) => (x.selected ? { ...x, selected: false } : x)).concat([{ ...toEdge(e), selected: true }]));
        bridge.setNodes((ns) => ns.map((n) => (n.selected ? { ...n, selected: false } : n)));
        sel.edge = e.id; sel.node = null;
        refreshCounts(); drawSel(true); drawAll();
      }
      bridge.addEdge = addEdge;
      bridge.removeEdge = removeEdge;   // dipakai tombol Delete (onKey dialog ada di luar closure ini)
      function removeEdge(id) {
        const e = store.edges.find((x) => x.id === id);
        if (!e) return;
        store.edges = store.edges.filter((x) => x !== e);
        ctx.onChange();
        bridge.setEdges((es) => es.filter((x) => x.id !== id));
        if (sel.edge === id) sel.edge = null;
        refreshCounts(); drawSel(); drawAll();
      }
      function setLabel(id, label) {
        const e = store.edges.find((x) => x.id === id);
        if (!e) return;
        e.label = String(label || "").slice(0, 40);
        bridge.setEdges((es) => es.map((x) => (x.id === id ? { ...x, data: { ...x.data, label: e.label } } : x)));
        save(); drawAll();
      }
      function addChar(name) {
        name = String(name || "").trim().slice(0, 80);
        if (!name) return;
        const p = ctx.project;
        if (!isObj(p.data.organize)) p.data.organize = { characters: [], locations: [], notes: [] };
        if (!Array.isArray(p.data.organize.characters)) p.data.organize.characters = [];
        const c = { id: uid("char"), title: name, content: "" };
        p.data.organize.characters.push(c);
        let pos = { x: 0, y: 0 };
        try { const r = flowEl.getBoundingClientRect(); pos = bridge.rf.screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 }); } catch (e) { /* pakai 0,0 */ }
        const n = chars().length;
        store.pos[c.id] = { x: Math.round(pos.x - 60 + (n % 5) * 18), y: Math.round(pos.y - 20 + (n % 5) * 14) };
        ctx.onChange();
        bridge.setNodes((ns) => ns.concat([toNode({ id: c.id, title: name })]));
        fillSelects(); drawAll();
        note(`Karakter "${name}" ditambahkan ke Kodeks`, tiIcon("user-plus"));
      }
      // ---------- panel samping (DOM biasa) ----------
      side.innerHTML = `<section class="qdt-rs-block qdt-rs-sel hidden"></section>
        <section class="qdt-rs-block">
          <h3 class="qdt-rs-h">Relasi baru</h3>
          <form class="qdt-rs-new">
            <select class="qd-sel qdt-rs-a" aria-label="Karakter pertama"></select>
            <select class="qd-sel qdt-rs-b" aria-label="Karakter kedua"></select>
            <input class="qdt-input qdt-rs-label" maxlength="40" placeholder="Label, mis. saudara" aria-label="Label relasi" list="qdtRelPresets">
            <datalist id="qdtRelPresets">${REL_PRESETS.map((p) => `<option value="${esc(p)}"></option>`).join("")}</datalist>
            <button type="submit" class="qd-btn qd-btn-accent qd-btn-sm">${px(tiIcon("link"), 15)}<span>Tambah relasi</span></button>
          </form>
        </section>
        <section class="qdt-rs-block"><h3 class="qdt-rs-h">Semua relasi <span class="qdt-rs-count"></span></h3><div class="qdt-rs-all"></div></section>
        <section class="qdt-rs-block">
          <h3 class="qdt-rs-h">Karakter baru</h3>
          <form class="qdt-rs-char"><input class="qdt-input" maxlength="80" placeholder="Nama karakter" aria-label="Nama karakter baru"><button type="submit" class="qd-btn qd-btn-soft qd-btn-sm">${px(tiIcon("user-plus"), 15)}<span>Tambah</span></button></form>
          <p class="qdt-hint">Karakter baru juga muncul di tab Kodeks.</p>
        </section>`;
      const selBox = $(side, ".qdt-rs-sel"), allBox = $(side, ".qdt-rs-all"), fa = $(side, ".qdt-rs-a"), fb = $(side, ".qdt-rs-b");
      function fillSelects() {
        const cs = chars(), opt = (c) => `<option value="${esc(c.id)}">${esc(c.title.trim() || "(tanpa nama)")}</option>`;
        const va = fa.value, vb = fb.value;
        fa.innerHTML = cs.map(opt).join("");
        fb.innerHTML = cs.map(opt).join("");
        if (cs.some((c) => c.id === va)) fa.value = va;
        if (cs.some((c) => c.id === vb)) fb.value = vb; else if (cs[1]) fb.value = cs[1].id;
        $(side, ".qdt-rs-new button").disabled = cs.length < 2;
      }
      function drawAll() {
        $(side, ".qdt-rs-count").textContent = store.edges.length ? "(" + store.edges.length + ")" : "";
        allBox.innerHTML = store.edges.length
          ? store.edges.map((e) => `<button type="button" class="qdt-rs-row${e.id === sel.edge ? " is-on" : ""}" data-edge="${esc(e.id)}"><span>${esc(nameOf(e.source))}</span>${px(tiIcon("arrows-horizontal"), 13)}<span>${esc(nameOf(e.target))}</span>${e.label ? `<em>${esc(e.label)}</em>` : ""}</button>`).join("")
          : `<p class="qdt-dim">${chars().length < 2 ? "Tambahkan minimal dua karakter dulu." : "Belum ada relasi. Seret titik di tepi kartu karakter ke karakter lain, atau pakai formulir di atas."}</p>`;
      }
      function drawSel(focus) {
        const e = sel.edge && store.edges.find((x) => x.id === sel.edge);
        if (!e && sel.node) {
          const mine = store.edges.filter((x) => x.source === sel.node || x.target === sel.node);
          selBox.classList.remove("hidden");
          selBox.innerHTML = `<h3 class="qdt-rs-h">${esc(nameOf(sel.node))}</h3>
            ${mine.length ? mine.map((x) => `<button type="button" class="qdt-rs-row" data-edge="${esc(x.id)}">${px(tiIcon("arrows-horizontal"), 13)}<span>${esc(nameOf(x.source === sel.node ? x.target : x.source))}</span>${x.label ? `<em>${esc(x.label)}</em>` : ""}</button>`).join("") : '<p class="qdt-dim">Belum punya relasi.</p>'}`;
          fa.value = sel.node;
          return;
        }
        if (!e) { selBox.classList.add("hidden"); selBox.innerHTML = ""; return; }
        selBox.classList.remove("hidden");
        selBox.innerHTML = `<h3 class="qdt-rs-h">Relasi terpilih</h3>
          <div class="qdt-rs-pair"><b>${esc(nameOf(e.source))}</b>${px(tiIcon("arrows-horizontal"), 14)}<b>${esc(nameOf(e.target))}</b></div>
          <input class="qdt-input qdt-rs-edit" maxlength="40" placeholder="Label relasi" aria-label="Label relasi terpilih">
          <div class="qdt-chips">${REL_PRESETS.map((p) => `<button type="button" class="qdt-chip${e.label === p ? " is-on" : ""}" data-preset="${esc(p)}">${esc(p)}</button>`).join("")}</div>
          <button type="button" class="qd-btn qd-btn-soft qd-btn-sm is-danger" data-x="del-edge">${px(tiIcon("trash"), 15)}<span>Hapus relasi</span></button>`;
        const inp = $(selBox, ".qdt-rs-edit");
        inp.value = e.label || "";
        inp.addEventListener("input", () => { setLabel(e.id, inp.value); $$(selBox, ".qdt-chip").forEach((c) => c.classList.toggle("is-on", c.dataset.preset === inp.value)); });
        if (focus) setTimeout(() => inp.focus(), 30);
      }
      side.addEventListener("submit", (ev) => {
        ev.preventDefault();
        if (ev.target.classList.contains("qdt-rs-new")) { const li = $(side, ".qdt-rs-label"); addEdge(fa.value, fb.value, li.value); li.value = ""; }
        else if (ev.target.classList.contains("qdt-rs-char")) { const ci = $(ev.target, "input"); addChar(ci.value); ci.value = ""; }
      });
      side.addEventListener("click", (ev) => {
        const row = ev.target.closest("[data-edge]"), pre = ev.target.closest("[data-preset]"), x = ev.target.closest("[data-x]");
        if (row) {
          const e = store.edges.find((y) => y.id === row.dataset.edge);
          selectEdge(row.dataset.edge);
          if (e && bridge.rf) { try { bridge.rf.fitView({ nodes: [{ id: e.source }, { id: e.target }], padding: 0.6, maxZoom: 1.3, duration: 350 }); } catch (er) { /* abaikan */ } }
        } else if (pre && sel.edge) { setLabel(sel.edge, pre.dataset.preset); drawSel(); }
        else if (x && x.dataset.x === "del-edge" && sel.edge) removeEdge(sel.edge);
      });
      fillSelects(); drawAll();
      // ---------- kanvas React Flow ----------
      const initNodes = list.map(toNode), initEdges = store.edges.map(toEdge);
      const vp = validVp(store.vp) ? store.vp : null;
      const App = () => {
        const [nodes, setNodes, onNodesChange] = RF.useNodesState(initNodes);
        const [edges, setEdges, onEdgesChange] = RF.useEdgesState(initEdges);
        const rf = RF.useReactFlow();
        // rf berganti objek begitu viewport siap (sebelumnya screenToFlowPosition/fitView masih fungsi kosong)
        React.useEffect(() => { bridge.setNodes = setNodes; bridge.setEdges = setEdges; bridge.rf = rf; }, [rf]);
        return h(Flow, {
          nodes, edges, onNodesChange, onEdgesChange,
          nodeTypes: kit.relNodes, edgeTypes: kit.relEdges, className: "qdt-rf",
          connectionMode: RF.ConnectionMode.Loose, deleteKeyCode: null,
          minZoom: 0.2, maxZoom: 2.5,
          defaultViewport: vp || undefined, fitView: !vp, fitViewOptions: { padding: 0.3, maxZoom: 1.2 },
          onConnect: (c) => addEdge(c.source, c.target, ""),
          onNodeDragStop: (e, n, ns) => { (ns && ns.length ? ns : [n]).forEach((x) => { store.pos[x.id] = { x: Math.round(x.position.x), y: Math.round(x.position.y) }; }); ctx.onChange(); },
          onSelectionChange: ({ nodes: sn, edges: se }) => {
            const ne = se[0] ? se[0].id : null, nn = sn[0] ? sn[0].id : null;
            if (ne === sel.edge && nn === sel.node) return;
            sel.edge = ne; sel.node = ne ? null : nn;
            drawSel(); drawAll();
          },
          onMoveEnd: (e, v) => { store.vp = { x: Math.round(v.x), y: Math.round(v.y), zoom: +v.zoom.toFixed(3) }; },
        },
        h(RF.Background, { variant: RF.BackgroundVariant.Dots, gap: 20, size: 1.3, color: darkUi() ? "rgba(255,255,255,.13)" : "rgba(0,0,0,.16)" }),
        h(RF.Controls, { showInteractive: false, position: "bottom-left" }),
        list.length ? null : h(RF.Panel, { position: "top-center", className: "qdt-flow-hint" }, "Belum ada karakter di Kodeks — tambahkan di panel samping."));
      };
      return h(App);
    });
  }

  /* ============================ ALAT: KANVAS ============================ */
  const NOTE_COLORS = ["yellow", "pink", "blue", "green", "purple", "gray"];
  const CANVAS_MAX_IMG = 30;
  function openCanvas(ctx) {
    const story = ctx.story;
    if (!story) return;
    const store = ctx.store;
    if (!Array.isArray(store.items)) store.items = [];
    store.items = store.items.filter((it) => it && typeof it.id === "string" && isFinite(it.x) && isFinite(it.y) && (it.kind === "note" || (it.kind === "img" && typeof it.src === "string" && DATA_IMG.test(it.src))));
    const bridge = {}, save = debounce(() => ctx.onChange(), 500);
    let selected = [], lastColor = "yellow", fileIn = null;
    flowDialog({ title: "Kanvas", sub: "Papan bebas untuk cerita ini · seret, perbesar, susun", icon: tiIcon("grid-dots"), cls: "qdt-canvas",
      onKey: (e) => {
        if ((e.key === "Delete" || e.key === "Backspace") && !isEditable(e.target) && selected.length && bridge.removeSelected) { e.preventDefault(); bridge.removeSelected(); return true; }
        return false;
      } }, (kit, flowEl, side, d) => {
      const { RF, React, h, Flow } = kit;
      const item = (id) => store.items.find((x) => x.id === id);
      const onText = (id, v) => { const it = item(id); if (it) { it.text = String(v).slice(0, 5000); save(); } };
      const onResize = (id, p) => { const it = item(id); if (!it) return; it.x = Math.round(p.x); it.y = Math.round(p.y); it.w = Math.round(p.width); it.h = Math.round(p.height); ctx.onChange(); };
      const toNode = (it) => ({
        id: it.id, type: it.kind === "img" ? "img" : "note", position: { x: it.x, y: it.y },
        style: { width: clamp(+it.w || 200, 40, 2000), height: clamp(+it.h || 160, 40, 2000) },
        data: it.kind === "img" ? { src: it.src, onResize } : { text: it.text || "", color: NOTE_COLORS.includes(it.color) ? it.color : "yellow", onText, onResize },
      });
      // ---------- bilah alat (melayang di atas kanvas) ----------
      const bar = document.createElement("div");
      bar.className = "qdt-cv-bar";
      bar.innerHTML = `<button type="button" class="qd-btn qd-btn-soft qd-btn-sm" data-x="note">${px(tiIcon("note"), 15)}<span>Catatan</span></button>
        <button type="button" class="qd-btn qd-btn-soft qd-btn-sm" data-x="img">${px(tiIcon("photo-plus"), 15)}<span>Gambar</span></button>
        <span class="qdt-cv-sep"></span>
        <span class="qdt-cv-colors" role="group" aria-label="Warna catatan">${NOTE_COLORS.map((c) => `<button type="button" class="qdt-cv-color qdt-c-${c}" data-color="${c}" title="Warna ${c}" aria-label="Warna catatan ${c}"></button>`).join("")}</span>
        <button type="button" class="qd-icon-btn" data-x="del" title="Hapus yang dipilih (Delete)" aria-label="Hapus yang dipilih" disabled>${px(tiIcon("trash"), 17)}</button>
        <button type="button" class="qd-icon-btn" data-x="fit" title="Tampilkan semua" aria-label="Tampilkan semua">${px(tiIcon("focus-centered"), 17)}</button>
        <input type="file" accept="image/*" multiple hidden>`;
      d.body.querySelector(".qdt-flowwrap").appendChild(bar);
      const empty = document.createElement("div");
      empty.className = "qdt-cv-empty";
      empty.innerHTML = `${px(tiIcon("grid-dots"), 26)}<p>Kanvas masih kosong.</p><small>Tambah catatan atau gambar dari bilah di atas, atau seret gambar ke sini.</small>`;
      d.body.querySelector(".qdt-flowwrap").appendChild(empty);
      fileIn = $(bar, "input[type=file]");
      const updateUi = () => {
        empty.classList.toggle("hidden", store.items.length > 0);
        $(bar, '[data-x="del"]').disabled = !selected.length;
        const notes = selected.map(item).filter((it) => it && it.kind === "note");
        const col = notes.length ? notes[0].color : lastColor;
        $$(bar, ".qdt-cv-color").forEach((b) => b.classList.toggle("is-on", b.dataset.color === col));
      };
      const viewCenter = () => {
        try { const r = flowEl.getBoundingClientRect(); return bridge.rf.screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 }); } catch (e) { return { x: 0, y: 0 }; }
      };
      const cascade = () => (store.items.length % 6) * 22;
      function addItem(it, select) {
        store.items.push(it);
        ctx.onChange();
        bridge.setNodes((ns) => ns.map((n) => (n.selected && select ? { ...n, selected: false } : n)).concat([{ ...toNode(it), selected: !!select }]));
        if (select) selected = [it.id];
        updateUi();
      }
      function addNote() {
        const c = viewCenter(), o = cascade();
        const it = { id: uid("cv"), kind: "note", x: Math.round(c.x - 100 + o), y: Math.round(c.y - 80 + o), w: 200, h: 160, text: "", color: lastColor };
        addItem(it, true);
        // fokus ke catatan baru begitu node-nya tampil (React Flow baru menampilkan node setelah diukur; di perangkat
        // lambat bisa beberapa frame). Berhenti kalau pengguna sudah memindah fokus ke tempat lain.
        let tries = 0;
        const focusNew = () => {
          if (d.closed) return;
          const ta = flowEl.querySelector(`.react-flow__node[data-id="${CSS.escape(it.id)}"] textarea`), ae = document.activeElement;
          if (ta && ae === ta) return;
          if (ae && ae !== document.body && !bar.contains(ae) && !d.el.contains(ae)) return;
          if (ae && d.el.contains(ae) && !bar.contains(ae) && ae.tagName === "TEXTAREA") return;
          if (ta) ta.focus({ preventScroll: true });
          if (document.activeElement !== ta && ++tries < 40) setTimeout(focusNew, 50);
        };
        setTimeout(focusNew, 30);
      }
      function addImages(files, at) {
        files = imageFiles(files);
        const imgs = store.items.filter((x) => x.kind === "img").length, room = CANVAS_MAX_IMG - imgs;
        if (!files.length) return;
        if (room <= 0) { note(`Kanvas penuh (maks. ${CANVAS_MAX_IMG} gambar).`, tiIcon("info-circle")); return; }
        let base = at || viewCenter(), n = 0;
        files.slice(0, room).reduce((chain, f) => chain.then(() => readImage(f, 900).then((r) => {
          if (d.closed) return;
          const w = Math.min(280, r.w), hh = Math.round(w * (r.h / r.w));
          addItem({ id: uid("cv"), kind: "img", x: Math.round(base.x - w / 2 + n * 24), y: Math.round(base.y - hh / 2 + n * 24), w, h: hh, src: r.src }, true);
          n++;
        })), Promise.resolve()).catch((err) => note(err.message || "Gambar gagal dibaca.", tiIcon("alert-triangle")));
      }
      bridge.removeSelected = removeSelected;   // dipakai tombol Delete (onKey dialog ada di luar closure ini)
      function removeSelected() {
        if (!selected.length) return;
        const del = new Set(selected);
        store.items = store.items.filter((x) => !del.has(x.id));
        ctx.onChange();
        bridge.setNodes((ns) => ns.filter((n) => !del.has(n.id)));
        selected = [];
        updateUi();
      }
      function setColor(c) {
        lastColor = c;
        const ids = new Set(selected.filter((id) => { const it = item(id); return it && it.kind === "note"; }));
        ids.forEach((id) => { item(id).color = c; });
        if (ids.size) { ctx.onChange(); bridge.setNodes((ns) => ns.map((n) => (ids.has(n.id) ? { ...n, data: { ...n.data, color: c } } : n))); }
        updateUi();
      }
      bar.addEventListener("click", (e) => {
        const b = e.target.closest("[data-x],[data-color]");
        if (!b || !bridge.setNodes) return;
        if (b.dataset.color) setColor(b.dataset.color);
        else if (b.dataset.x === "note") addNote();
        else if (b.dataset.x === "img") fileIn.click();
        else if (b.dataset.x === "del") removeSelected();
        else if (b.dataset.x === "fit") bridge.rf.fitView({ padding: 0.2, maxZoom: 1.4, duration: 300 });
      });
      fileIn.addEventListener("change", () => { addImages(fileIn.files); fileIn.value = ""; });
      dropFiles(d.body.querySelector(".qdt-flowwrap"), (files, e) => {
        let at = null;
        try { at = bridge.rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }); } catch (er) { at = null; }
        addImages(files, at);
      });
      // tempel gambar (Ctrl+V) langsung ke kanvas
      d.el.addEventListener("paste", (e) => {
        if (isEditable(e.target)) return;
        const files = imageFiles(e.clipboardData && e.clipboardData.files);
        if (files.length) { e.preventDefault(); addImages(files); }
      });
      updateUi();
      const vp = validVp(store.vp) ? store.vp : null;
      const initNodes = store.items.map(toNode);
      const App = () => {
        const [nodes, setNodes, onNodesChange] = RF.useNodesState(initNodes);
        const rf = RF.useReactFlow();
        React.useEffect(() => { bridge.setNodes = setNodes; bridge.rf = rf; }, [rf]);   // rf baru setelah viewport siap
        return h(Flow, {
          nodes, edges: [], onNodesChange, nodeTypes: kit.cvNodes, className: "qdt-rf qdt-rf-canvas",
          deleteKeyCode: null, minZoom: 0.15, maxZoom: 2.5, nodesConnectable: false,
          defaultViewport: vp || undefined, fitView: !vp && initNodes.length > 0, fitViewOptions: { padding: 0.2, maxZoom: 1.2 },
          onNodeDragStop: (e, n, ns) => { (ns && ns.length ? ns : [n]).forEach((x) => { const it = item(x.id); if (it) { it.x = Math.round(x.position.x); it.y = Math.round(x.position.y); } }); ctx.onChange(); },
          onSelectionChange: ({ nodes: sn }) => { selected = sn.map((n) => n.id); updateUi(); },
          onMoveEnd: (e, v) => { store.vp = { x: Math.round(v.x), y: Math.round(v.y), zoom: +v.zoom.toFixed(3) }; },
        },
        h(RF.Background, { variant: RF.BackgroundVariant.Dots, gap: 22, size: 1.4, color: darkUi() ? "rgba(255,255,255,.14)" : "rgba(0,0,0,.17)" }),
        h(RF.Controls, { showInteractive: false, position: "bottom-left" }));
      };
      return h(App);
    });
  }

  /* ============================ KAIT LAYAR ============================ */
  function onScreen(info) {
    closeAll();   // dialog/popover milik layar sebelumnya
    curEditorEl = info && info.view === "editor" ? info.el : null;
    if (!curEditorEl || !info.story) return;
    applyStyle(curEditorEl, styleOf(info.story));
    const ctx = api().getContext();   // langganannya dilepas otomatis saat editor ditutup
    if (!ctx) return;
    try { autoDraft(ctx); } catch (e) { console.error("[Quill tiles] draf otomatis", e); }
    ctx.onChapterChange(() => { try { autoDraft(ctx); } catch (e) { console.error("[Quill tiles] draf otomatis", e); } });
  }
  function onReader(info) { if (info && info.el && info.story) applyStyle(info.el, styleOf(info.story)); }

  /* ============================ DAFTARKAN ============================ */
  function register(Q) {
    const tools = [
      { id: "drafts", label: "Draf", hint: "Draf: simpan & pulihkan versi chapter", icon: tiIcon("stack-2"), open: openDrafts },
      { id: "style", label: "Gaya", hint: "Gaya: tipografi editor & mode Putar", icon: tiIcon("palette"), open: openStyle },
      { id: "relations", label: "Pohon relasi", hint: "Pohon relasi karakter", icon: tiIcon("hierarchy-2"), open: openRelations },
      { id: "canvas", label: "Kanvas", hint: "Kanvas bebas: catatan tempel & gambar", icon: tiIcon("grid-dots"), open: openCanvas },
      { id: "maps", label: "Map", hint: "Buka peta project di tab Map", icon: tiIcon("map-2"), open: openMaps },
      { id: "model3d", label: "Model 3D", hint: "Model 3D — segera hadir", icon: tiIcon("cube"), badge: "Segera", disabled: true, open() { note("Model 3D segera hadir.", tiIcon("info-circle")); } },
    ];
    const tiles = [tileWorldCards, tileDetected, tileNotes, tileMood, tileWorldGraph];
    tools.forEach((t) => { try { Q.registerTool(t); } catch (e) { console.error("[Quill tiles] alat " + t.id, e); } });
    tiles.forEach((t) => { try { Q.registerTile(t); } catch (e) { console.error("[Quill tiles] tile " + t.id, e); } });
    if (typeof Q.on === "function") { Q.on("screen", onScreen); Q.on("reader", onReader); }
    // editor yang sudah terbuka sebelum modul ini dimuat: pasang gaya + draf otomatis sekarang
    const ed = document.querySelector("#quillRoot .qd-editor"), ctx = Q.getContext && Q.getContext();
    if (ed && ctx && ctx.story) onScreen({ view: "editor", story: ctx.story, el: ed });
  }
  (window.__novelQuillReady = window.__novelQuillReady || []).push(register);
})();
