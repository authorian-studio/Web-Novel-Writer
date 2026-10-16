/* quill.js — QUILL: menulis cerita bergaya buku di dalam tab Write (tombol "Scene | Quill").
   Dimuat malas oleh app.js (ensureQuillLib -> loadScriptOnce("quill.js")) saat mode Quill pertama kali dibuka.
   Gaya ada di quill.css. Ikon: Tabler — selalu tulis tiIcon("NAMA") dengan nama literal (dipindai tools/build-icons.mjs).

   =============================== DATA (project.data.quill) ===============================
   { mode: "scene" | "quill",                       // dipegang app.js (tombol Scene | Quill)
     stories: [{
       id, title, author, createdAt, updatedAt,      // tanggal = ISO string
       book: { kind: "hardcover" | "paperback" | "paper",
               color,                                // id preset di COVERS (mis. "midnight") atau "#rrggbb"
               jacket: dataURL | null, jacketFit: "cover" | "contain",
               titleFont,                            // id di FONTS (georgia, palatino, times, dancing, inter, mono)
               titleColor: "#rrggbb", showAuthor: bool },
       chapters: [{ id, title, header: dataURL | null, html, updatedAt }],
       panel: {}                                     // milik panel kanan (lihat di bawah)
     }] }
   - Dibuat malas & dimigrasi diam-diam (field hilang diisi bawaan) setiap show().
   - Gambar diperkecil (sampul ≤ 1000 px, header ≤ 1600 px, gambar isi ≤ 1200 px) lalu disimpan sebagai data URL
     WebP kualitas 0.82 (fallback JPEG) supaya JSON di Drive tetap kecil.
   - HTML chapter selalu disanitasi saat dimuat/ditempel (hanya tag format dasar; script, style, atribut onXxx & URL javascript: dibuang).

   =============================== EXTENSION API (stabil) ===============================
   window.NovelQuill = {
     version: 1,
     show(opts)        opts = { project, container, onChange, getUser() -> { name }, openTab(tab), getOrganize(), getMaps(),
                                escapeHtml }   (dipanggil app.js; onChange = markDirtyAndSchedule, openTab = switchTab)
     hide()            simpan isi editor, hentikan audio/mode baca, kosongkan container
     flush()           tulis isi editor yang belum tersimpan ke data project (tanpa memanggil onChange)
     isOpen() -> bool
     registerTool(def) -> unregister()
                       def = { id, label, icon, open(ctx), disabled?, badge?, hint? }  -> tombol ikon bulat di baris atas
                       panel kanan (disabled = tombol mati, badge = label kecil di ikon mis. "Segera", hint = tooltip)
     registerTile(def) -> unregister()
                       def = { id, title, icon, defaultOn = true, render(el, ctx), update?(el, ctx, reason), destroy?(el) }
                       -> kartu kaca bertumpuk di panel kanan, dengan tombol tutup (x), bisa diseret (urutan), dan menu
                          "+ Tambah tile" untuk memunculkan lagi tile yang ditutup. Tampil/urutan disimpan per cerita di
                          story.panel.layout = { tiles: [{ id, on }], tabs: [{ id, name, tiles: [{ id, on }] }], tab }
                          (tiles = tab "Beranda"; tabs = tab buatan pengguna lewat tombol "+", masing-masing punya
                          susunan tile sendiri dan mulai kosong; tab = id tab aktif atau "home").
                       render() dipanggil sekali saat tile dipasang (editor dibuka / tile ditambah);
                       update(el, ctx, reason) dipanggil saat chapter aktif berganti (reason "chapter") atau
                       refreshPanel() (reason "refresh"); destroy(el) saat tile dilepas (ditutup / editor ditutup).
     unregisterTool(id), unregisterTile(id)
     getContext() -> ctx | null      (ctx untuk chapter yang sedang dibuka di editor)
     refreshPanel()                  panggil update(el, ctx, "refresh") di semua tile yang tampil
     openPanel(), closePanel(), togglePanel()
     on(type, cb) -> off()           kait layar (untuk modul seperti quill-tiles.js):
                       "screen": cb({ view, story, el, project }) setelah setiap layar Quill digambar
                                 (view = "library" | "create" | "story" | "editor" | "publish", atau null saat Quill disembunyikan)
                       "reader": cb({ story, el, project }) saat mode baca (Putar) dibuka, SEBELUM halaman dihitung
   }
   Modul yang dimuat SEBELUM quill.js: (window.__novelQuillReady = window.__novelQuillReady || []).push((api) => api.registerTile(...));
   atau dengarkan event window "novelquill:ready" (event.detail = API). Tile/alat boleh didaftarkan kapan saja — editor
   yang sedang terbuka langsung memasangnya.
   icon (tool/tile): nama ikon Tabler ("stack-2") ATAU markup dari tiIcon("stack-2"). Kalau memakai nama saja, tulis juga
     komentar "#ti-stack-2" di kode supaya tools/build-icons.mjs memasukkan ikonnya ke sprite.
   ctx = {
     project, story, chapter,           // getter: selalu nilai terkini (chapter = chapter yang sedang dibuka)
     getChapterHtml(), getChapterText(),
     insertHtmlAtCursor(html),          // disanitasi, disisipkan di posisi kursor terakhir di editor
     replaceChapterHtml(html),          // disanitasi, mengganti seluruh isi chapter
     onChange(),                        // tandai project berubah (autosave ke Drive)
     openProjectTab(tab),               // pindah tab project ("home", "organize", "timeline", "map", ...)
     user: { name }, el(tag, cls), escapeHtml(str), sanitizeHtml(html),
     onChapterChange(cb) -> off(),      // cb(chapter, story) saat chapter aktif berganti
     onTextChange(cb) -> off(),         // cb(chapter, story), di-debounce ±600 ms setelah mengetik
     getOrganize(), getMaps(),          // project.data.organize / project.data.maps
     openChapter(id),
     store,                             // objek data per cerita milik tile/alat ini: story.panel[def.id] (dibuat malas);
                                        // ubah isinya lalu panggil ctx.onChange()
     panelEl                            // titik pasang kosong (div) di panel kanan, untuk isi bebas
   }
   Langganan onChapterChange/onTextChange otomatis dilepas saat tile dilepas atau editor ditutup.
*/
(function () {
  "use strict";
  if (window.NovelQuill) return;

  /* ============================ UTIL ============================ */
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const px = (svg, n) => svg.replace("<svg ", `<svg width="${n}" height="${n}" `);
  const uid = (p) => p + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const nowIso = () => new Date().toISOString();
  const $ = (root, sel) => root.querySelector(sel);
  const $$ = (root, sel) => Array.from(root.querySelectorAll(sel));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const reduceMotion = () => !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
  const isNarrow = () => !!(window.matchMedia && matchMedia("(max-width: 900px)").matches);
  const fmtNum = (n) => Number(n || 0).toLocaleString((window.NovelI18n ? NovelI18n.locale : "id-ID"));
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage diblokir */ } },
  };
  const K_SIDE = "novelist_quill_side_collapsed", K_PANEL = "novelist_quill_panel_open", K_TTS = "novelist_quill_tts", K_RFS = "novelist_quill_reader_fs";
  const toast = (msg, icon) => { if (typeof window.toast === "function") window.toast(msg, icon); };

  function roman(n) {
    n = clamp(n | 0, 1, 3999);
    const t = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
    let s = "";
    for (const [v, r] of t) while (n >= v) { s += r; n -= v; }
    return s;
  }
  const countWords = (text) => { const m = String(text || "").match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu); return m ? m.length : 0; };
  const htmlWords = (html) => countWords(String(html || "").replace(/<[^>]*>/g, " ").replace(/&[a-z0-9#]+;/gi, " "));
  function ago(iso) {
    const d = (Date.now() - new Date(iso).getTime()) / 1000;
    if (!isFinite(d)) return "";
    if (d < 60) return "baru saja";
    if (d < 3600) return Math.floor(d / 60) + " menit lalu";
    if (d < 86400) return Math.floor(d / 3600) + " jam lalu";
    if (d < 86400 * 30) return Math.floor(d / 86400) + " hari lalu";
    return new Date(iso).toLocaleDateString((window.NovelI18n ? NovelI18n.locale : "id-ID"), { day: "numeric", month: "short", year: "numeric" });
  }
  const safeName = (s) => (String(s || "").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").trim().slice(0, 80) || "cerita");

  /* ============================ PRESET BUKU ============================ */
  const KINDS = [
    { id: "hardcover", label: "Hardcover", desc: "Sampul keras & tebal, punggung membulat" },
    { id: "paperback", label: "Paperback", desc: "Sampul lunak mengilap, lebih tipis" },
    { id: "paper", label: "Sampul kertas", desc: "Tipis seperti buklet, kertas doff" },
  ];
  const COVERS = [
    { id: "midnight", label: "Tengah malam", c: ["#1c1f3b"] },
    { id: "ink", label: "Tinta", c: ["#141418"] },
    { id: "wine", label: "Anggur", c: ["#4b1627"] },
    { id: "forest", label: "Hutan", c: ["#173a2b"] },
    { id: "ocean", label: "Samudra", c: ["#123552"] },
    { id: "clay", label: "Tanah liat", c: ["#7a3b26"] },
    { id: "sand", label: "Pasir", c: ["#d8c49c"] },
    { id: "cream", label: "Krem", c: ["#efe6d1"] },
    { id: "dusk", label: "Senja", c: ["#3b1f4a", "#b04a5a"] },
    { id: "aurora", label: "Aurora", c: ["#0e2a3b", "#1f6f6a", "#93cfa2"] },
    { id: "ember", label: "Bara", c: ["#2a0e0a", "#b8472a"] },
    { id: "nebula", label: "Nebula", c: ["#140f30", "#3d2b7c", "#c2709c"] },
    { id: "gold", label: "Emas", c: ["#33240f", "#c99b4b"] },
    { id: "frost", label: "Embun", c: ["#e3ecf5", "#a9bfd6"] },
  ];
  const FONTS = [
    { id: "georgia", label: "Georgia", css: 'Georgia, "Times New Roman", serif' },
    { id: "palatino", label: "Palatino", css: '"Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif' },
    { id: "times", label: "Times", css: '"Times New Roman", Times, serif' },
    { id: "dancing", label: "Dancing Script", css: '"Dancing Script", "Brush Script MT", cursive' },
    { id: "inter", label: "Inter", css: 'Inter, -apple-system, "Segoe UI", Arial, sans-serif' },
    { id: "mono", label: "Mono", css: 'ui-monospace, Menlo, Consolas, "Courier New", monospace' },
  ];
  const TITLE_COLORS = ["#f3ede2", "#ffffff", "#e8c48a", "#d7a86e", "#b9d7f0", "#f2b8c6", "#1d1b18", "#5b2a1a"];
  const LIGHT_TITLE = "#f3ede2", DARK_TITLE = "#1d1b18";
  const HEX = /^#[0-9a-f]{6}$/i;
  const DATA_IMG = /^data:image\/(png|jpeg|webp|gif);base64,[a-z0-9+/=]+$/i;

  function coverColors(b) {
    const p = COVERS.find((c) => c.id === b.color);
    return p ? p.c : [HEX.test(b.color || "") ? b.color : "#1c1f3b"];
  }
  const gradCss = (cols) => cols.length === 1 ? cols[0] : `linear-gradient(160deg, ${cols.map((c, i) => `${c} ${Math.round(i / (cols.length - 1) * 100)}%`).join(", ")})`;
  function lum(hex) {
    const n = parseInt(hex.slice(1), 16);
    return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
  }
  const coverIsLight = (b) => { const c = coverColors(b); return c.reduce((a, h) => a + lum(h), 0) / c.length > 0.6; };
  const fontCss = (id) => (FONTS.find((f) => f.id === id) || FONTS[0]).css;

  /* ============================ DATA ============================ */
  function normBook(b) {
    b = b && typeof b === "object" ? b : {};
    return {
      kind: KINDS.some((k) => k.id === b.kind) ? b.kind : "hardcover",
      color: COVERS.some((c) => c.id === b.color) || HEX.test(b.color || "") ? b.color : "midnight",
      jacket: typeof b.jacket === "string" && DATA_IMG.test(b.jacket) ? b.jacket : null,
      jacketFit: b.jacketFit === "contain" ? "contain" : "cover",
      titleFont: FONTS.some((f) => f.id === b.titleFont) ? b.titleFont : "georgia",
      titleColor: HEX.test(b.titleColor || "") ? b.titleColor.toLowerCase() : LIGHT_TITLE,
      showAuthor: b.showAuthor !== false,
    };
  }
  function normStory(s) {
    if (!s || typeof s !== "object") return null;
    if (typeof s.id !== "string" || !s.id) s.id = uid("story");
    s.title = typeof s.title === "string" ? s.title : "";
    s.author = typeof s.author === "string" ? s.author : "";
    s.createdAt = typeof s.createdAt === "string" ? s.createdAt : nowIso();
    s.updatedAt = typeof s.updatedAt === "string" ? s.updatedAt : s.createdAt;
    s.book = normBook(s.book);
    s.chapters = (Array.isArray(s.chapters) ? s.chapters : []).filter((c) => c && typeof c === "object");
    const seen = new Set();
    s.chapters.forEach((c) => {
      if (typeof c.id !== "string" || !c.id || seen.has(c.id)) c.id = uid("ch");
      seen.add(c.id);
      c.title = typeof c.title === "string" ? c.title : "";
      c.header = typeof c.header === "string" && DATA_IMG.test(c.header) ? c.header : null;
      c.html = typeof c.html === "string" ? c.html : "";
      c.updatedAt = typeof c.updatedAt === "string" ? c.updatedAt : s.updatedAt;
    });
    if (!s.panel || typeof s.panel !== "object" || Array.isArray(s.panel)) s.panel = {};
    return s;
  }
  function ensureData(p) {
    if (!p.data || typeof p.data !== "object") p.data = {};
    let q = p.data.quill;
    if (!q || typeof q !== "object" || Array.isArray(q)) q = p.data.quill = { mode: "quill", stories: [] };
    if (q.mode !== "scene" && q.mode !== "quill") q.mode = "quill";
    const seen = new Set();
    q.stories = (Array.isArray(q.stories) ? q.stories : []).map(normStory).filter((s) => {
      if (!s) return false;
      if (seen.has(s.id)) s.id = uid("story");
      seen.add(s.id);
      return true;
    });
    return q;
  }
  const qdata = () => (P.data && P.data.quill && Array.isArray(P.data.quill.stories) ? P.data.quill : ensureData(P));
  const findStory = (id) => (id && P ? qdata().stories.find((s) => s.id === id) : null) || null;
  const storyTitle = (s) => (s.title || "").trim() || "Cerita tanpa judul";
  const chapterLabel = (c, i) => (c.title || "").trim() || "Chapter " + roman(i + 1);
  const storyWords = (s) => s.chapters.reduce((a, c) => a + htmlWords(c.html), 0);
  const isDefaultChTitle = (t) => /^chapter\s+[ivxlcdm]+$/i.test((t || "").trim());
  function renumberDefaults(s) { s.chapters.forEach((c, i) => { if (isDefaultChTitle(c.title)) c.title = "Chapter " + roman(i + 1); }); }
  function addChapter(s) {
    const c = { id: uid("ch"), title: "Chapter " + roman(s.chapters.length + 1), header: null, html: "", updatedAt: nowIso() };
    s.chapters.push(c);
    s.updatedAt = c.updatedAt;
    return c;
  }
  const changed = () => { if (O && typeof O.onChange === "function") O.onChange(); };
  function userName() {
    let u = null;
    try { u = O && typeof O.getUser === "function" ? O.getUser() : null; } catch (e) { u = null; }
    return (u && typeof u.name === "string" && u.name.trim()) || "Penulis";
  }

  /* ============================ SANITASI HTML ============================ */
  // Hanya tag format dasar yang boleh tinggal. Tag berbahaya dibuang beserta isinya, tag lain "dibuka" (isinya dipertahankan).
  const DROP_TAGS = new Set(["SCRIPT", "STYLE", "IFRAME", "FRAME", "FRAMESET", "OBJECT", "EMBED", "LINK", "META", "TITLE", "HEAD", "NOSCRIPT",
    "TEMPLATE", "SVG", "MATH", "FORM", "INPUT", "BUTTON", "SELECT", "OPTION", "TEXTAREA", "VIDEO", "AUDIO", "SOURCE", "TRACK", "CANVAS",
    "APPLET", "BASE", "PORTAL", "DIALOG", "MAP", "AREA", "PARAM", "XML"]);
  const KEEP_TAGS = new Set(["P", "BR", "B", "STRONG", "I", "EM", "U", "S", "STRIKE", "DEL", "SUB", "SUP", "H1", "H2", "BLOCKQUOTE", "UL", "OL",
    "LI", "HR", "IMG", "SPAN", "DIV", "A", "FIGURE", "FIGCAPTION"]);
  const RENAME = { H3: "H2", H4: "H2", H5: "H2", H6: "H2", INS: "U", MARK: "SPAN", FONT: "SPAN", CENTER: "DIV", ARTICLE: "DIV", SECTION: "DIV",
    HEADER: "DIV", FOOTER: "DIV", MAIN: "DIV", ASIDE: "DIV", NAV: "DIV", PRE: "P", ADDRESS: "P", TR: "P", DT: "P", DD: "P", CITE: "I", Q: "SPAN" };
  const SAFE_IMG = /^(data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+|https:\/\/[^\s"'<>]+)$/i;
  const ALIGN_TAGS = new Set(["P", "DIV", "H1", "H2", "BLOCKQUOTE", "LI", "UL", "OL", "FIGURE", "FIGCAPTION"]);
  function cleanStyle(text, opt, tag) {
    const out = [];
    String(text || "").split(";").forEach((decl) => {
      const i = decl.indexOf(":");
      if (i < 0) return;
      const prop = decl.slice(0, i).trim().toLowerCase(), val = decl.slice(i + 1).trim().toLowerCase().replace(/\s*!important$/, "");
      if (prop === "text-align" && ALIGN_TAGS.has(tag) && /^(left|right|center|justify)$/.test(val)) out.push("text-align: " + val);
      else if (prop === "font-size" && !opt.paste) {
        const m = val.match(/^(\d{1,3}(?:\.\d+)?)px$/);
        if (m && +m[1] >= 8 && +m[1] <= 96) out.push("font-size: " + +m[1] + "px");
      } else if (prop === "font-weight" && /^(bold|bolder|[6-9]00)$/.test(val)) out.push("font-weight: bold");
      else if (prop === "font-style" && val === "italic") out.push("font-style: italic");
      else if ((prop === "text-decoration" || prop === "text-decoration-line") && /(underline|line-through)/.test(val)) {
        out.push("text-decoration: " + (val.includes("underline") ? "underline" : "") + (val.includes("underline") && val.includes("line-through") ? " " : "") + (val.includes("line-through") ? "line-through" : ""));
      }
    });
    return out.join("; ");
  }
  function cleanAttrs(n, tag, opt) {
    let style = "";
    for (const a of Array.from(n.attributes)) {
      const name = a.name.toLowerCase(), v = a.value.trim();
      if (name === "style") style += ";" + v;
      else if (name === "align" && /^(left|right|center|justify)$/i.test(v)) style += ";text-align:" + v.toLowerCase();
      else if (name === "class" && tag === "HR" && /\bqd-break\b/.test(v)) continue;
      else if (tag === "IMG" && name === "src" && SAFE_IMG.test(v)) continue;
      else if (tag === "IMG" && name === "alt") continue;
      else if (tag === "A" && name === "href" && /^(https?:|mailto:)/i.test(v)) continue;
      else if (tag === "OL" && name === "start" && /^\d{1,4}$/.test(v)) continue;
      n.removeAttribute(a.name);
    }
    n.removeAttribute("style");
    const s = cleanStyle(style, opt, tag);
    if (s) n.setAttribute("style", s);
    if (tag === "HR" && n.getAttribute("class")) n.setAttribute("class", "qd-break");
    if (tag === "IMG" && !n.hasAttribute("alt")) n.setAttribute("alt", "");
  }
  function cleanNode(parent, opt) {
    let n = parent.firstChild;
    while (n) {
      const next = n.nextSibling;
      if (n.nodeType === 3) { n = next; continue; }
      if (n.nodeType !== 1) { parent.removeChild(n); n = next; continue; }   // komentar, instruksi, dll.
      let tag = n.tagName.toUpperCase();
      if (DROP_TAGS.has(tag)) { parent.removeChild(n); n = next; continue; }
      if (RENAME[tag]) {
        const r = n.ownerDocument.createElement(RENAME[tag].toLowerCase());
        if (tag === "CENTER") r.setAttribute("style", "text-align:center");
        else if (n.getAttribute("style")) r.setAttribute("style", n.getAttribute("style"));
        if (n.getAttribute("align")) r.setAttribute("align", n.getAttribute("align"));
        while (n.firstChild) r.appendChild(n.firstChild);
        parent.replaceChild(r, n);
        n = r; tag = RENAME[tag];
      }
      if (!KEEP_TAGS.has(tag)) {   // buka tag: anak-anaknya naik ke parent lalu ikut diproses
        const first = n.firstChild;
        while (n.firstChild) parent.insertBefore(n.firstChild, n);
        parent.removeChild(n);
        n = first || next;
        continue;
      }
      cleanAttrs(n, tag, opt);
      if (tag === "IMG" && !n.getAttribute("src")) { parent.removeChild(n); n = next; continue; }
      if (tag === "A" && !n.getAttribute("href")) {   // tautan tanpa href aman -> buka
        const first = n.firstChild;
        while (n.firstChild) parent.insertBefore(n.firstChild, n);
        parent.removeChild(n);
        n = first || next;
        continue;
      }
      cleanNode(n, opt);
      n = next;
    }
  }
  // Dokumen "inert" (tanpa browsing context): script tidak jalan & gambar tidak dimuat selama sanitasi.
  let inertDoc = null;
  function sanitizeHtml(html, opt) {
    opt = opt || {};
    if (!inertDoc) inertDoc = document.implementation.createHTMLDocument("");
    const box = inertDoc.createElement("div");
    box.innerHTML = String(html || "");
    cleanNode(box, opt);
    return box.innerHTML;
  }
  function textToHtml(text) {
    return String(text || "").replace(/\r\n?/g, "\n").split(/\n{2,}/).map((p) => p.trim() ? "<p>" + esc(p).replace(/\n/g, "<br>") + "</p>" : "").join("");
  }

  /* ============================ GAMBAR ============================ */
  // file gambar -> diperkecil -> data URL WebP 0.82 (fallback JPEG bila browser tidak bisa encode WebP)
  function readImageFile(file, maxW, maxH) {
    return new Promise((resolve, reject) => {
      if (!file || !/^image\//.test(file.type || "")) { reject(new Error("File ini bukan gambar.")); return; }
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        try {
          const s = Math.min(1, maxW / img.naturalWidth, maxH / img.naturalHeight);
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
          resolve(out);
        } catch (e) { reject(e); } finally { URL.revokeObjectURL(url); }
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Gambar tidak bisa dibaca.")); };
      img.src = url;
    });
  }
  const imgFromFiles = (list) => Array.from(list || []).filter((f) => /^image\//.test(f.type || ""));
  const hasFiles = (e) => !!(e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files"));
  function loadImg(src) {
    return new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error("img")); i.src = src; });
  }

  /* ============================ STATE ============================ */
  let O = null;                // opts dari app.js
  let P = null;                // project aktif
  let host = null;             // container (#quillRoot)
  let visible = false;
  let route = { view: "library" };
  const routes = new Map();    // id project -> layar terakhir (di memori saja)
  let cleanups = [];           // bersih-bersih layar aktif
  let ed = null;               // state editor chapter (null kalau editor tidak terbuka)
  const reg = { tools: [], tiles: [] };
  const bus = new Set();       // langganan ctx.onChapterChange / onTextChange
  const hooks = new Set();     // langganan NovelQuill.on("screen" | "reader", cb)
  function onHook(type, cb) {
    if (typeof cb !== "function" || (type !== "screen" && type !== "reader")) return () => {};
    const rec = { type, cb };
    hooks.add(rec);
    return () => hooks.delete(rec);
  }
  function fireHook(type, info) {
    Array.from(hooks).forEach((r) => { if (r.type === type) { try { r.cb(info); } catch (e) { console.error("[Quill] hook " + type, e); } } });
  }

  /* ============================ BUKU 3D (CSS) ============================ */
  function bookHtml(s, size) {
    const b = s.book, title = storyTitle(s), author = (s.author || "").trim();
    const light = coverIsLight(b);
    return `<div class="qd-book ${size || ""} qd-k-${b.kind}${light ? " is-light" : ""}" style="--qd-cover:${gradCss(coverColors(b))};--qd-title:${b.titleColor}">
      <div class="qd-book-shadow" aria-hidden="true"></div>
      <div class="qd-book-rot" aria-hidden="true">
        <div class="qd-bf qd-bf-back"></div>
        <div class="qd-bf qd-bf-fore"></div>
        <div class="qd-bf qd-bf-top"></div>
        <div class="qd-bf qd-bf-bottom"></div>
        <div class="qd-bf qd-bf-spine"><span class="qd-spine-title qd-f-${b.titleFont}">${esc(title)}</span><img class="qd-spine-logo" src="icon-192.png" alt="" draggable="false"></div>
        <div class="qd-bf qd-bf-front">
          ${b.jacket ? `<div class="qd-jacket" style="background-image:url('${b.jacket}');background-size:${b.jacketFit}"></div>` : ""}
          <div class="qd-cover-text${b.jacket ? " on-art" : ""}">
            <div class="qd-cover-title qd-f-${b.titleFont}">${esc(title)}</div>
            ${b.showAuthor && author ? `<div class="qd-cover-author qd-f-${b.titleFont}">${esc(author)}</div>` : ""}
          </div>
          <div class="qd-cover-sheen"></div>
        </div>
      </div>
    </div>`;
  }
  // Buku miring mengikuti kursor & bisa diseret untuk diputar (rotasi lewat variabel CSS --rx/--ry di stage,
  // jadi tetap bertahan walau isi buku di-render ulang).
  function attachTilt(stage) {
    const BX = 5, BY = 26;
    let rx = BX, ry = BY, tx = BX, ty = BY, spin = 0, drag = null, raf = 0, backT = 0;
    const apply = () => {
      stage.style.setProperty("--rx", rx.toFixed(2) + "deg");
      stage.style.setProperty("--ry", ry.toFixed(2) + "deg");
      stage.style.setProperty("--sx", clamp((ry - BY) * 1.4, -60, 60).toFixed(1) + "%");   // kilau sampul ikut bergeser
    };
    const loop = () => {
      raf = 0;
      if (!stage.isConnected) return;
      rx += (tx - rx) * 0.14; ry += (ty - ry) * 0.14;
      if (Math.abs(tx - rx) < 0.03 && Math.abs(ty - ry) < 0.03) { rx = tx; ry = ty; }
      apply();
      if (rx !== tx || ry !== ty) raf = requestAnimationFrame(loop);
    };
    const kick = () => { if (reduceMotion() && !drag) { rx = tx; ry = ty; apply(); return; } if (!raf) raf = requestAnimationFrame(loop); };
    const hover = (e) => {
      if (drag || reduceMotion() || e.pointerType === "touch") return;
      const r = stage.getBoundingClientRect();
      const fx = clamp((e.clientX - r.left) / r.width - 0.5, -0.6, 0.6), fy = clamp((e.clientY - r.top) / r.height - 0.5, -0.6, 0.6);
      ty = BY + spin + fx * 18; tx = BX - fy * 12;
      kick();
    };
    stage.addEventListener("pointermove", (e) => {
      if (drag && e.pointerId === drag.id) {
        spin = drag.spin0 + (e.clientX - drag.x) * 0.55;
        tx = clamp(drag.rx0 - (e.clientY - drag.y) * 0.25, -25, 30);
        ty = BY + spin;
        kick();
      } else hover(e);
    });
    stage.addEventListener("pointerdown", (e) => {
      if (e.button > 0 || e.target.closest("button, input, a")) return;
      clearTimeout(backT);
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, spin0: spin, rx0: tx };
      stage.classList.add("is-grabbing");
      try { stage.setPointerCapture(e.pointerId); } catch (err) { /* abaikan */ }
    });
    const end = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      drag = null;
      stage.classList.remove("is-grabbing");
      clearTimeout(backT);
      backT = setTimeout(() => { if (!stage.isConnected || drag) return; spin = ((spin % 360) + 540) % 360 - 180; ry = BY + spin; spin = 0; tx = BX; ty = BY; kick(); }, 2200);
    };
    stage.addEventListener("pointerup", end);
    stage.addEventListener("pointercancel", end);
    stage.addEventListener("pointerleave", () => { if (drag) return; tx = BX; ty = BY + spin; kick(); });
    apply();
  }

  /* ============================ KERANGKA LAYAR ============================ */
  function render() {
    if (!host || !visible || !P) return;
    teardownScreen();
    if (route.view === "create") renderCreate();
    else if (route.view === "story" && findStory(route.storyId)) renderStory();
    else if (route.view === "editor" && findStory(route.storyId)) renderEditor();
    else if (route.view === "publish" && findStory(route.storyId)) renderPublish();
    else { route = { view: "library" }; renderLibrary(); }
    host.dataset.view = route.view;
    fireHook("screen", { view: route.view, story: findStory(route.storyId), el: host.firstElementChild, project: P });
  }
  function go(view, params) {
    flush();
    route = Object.assign({ view }, params || {});
    render();
    if (host) host.scrollTop = 0;
  }
  function teardownScreen() {
    closeMenu();
    const fns = cleanups;
    cleanups = [];
    fns.forEach((f) => { try { f(); } catch (e) { console.error("[Quill]", e); } });
  }
  const backBtn = (label) => `<button type="button" class="qd-back" data-act="back">${px(tiIcon("chevron-left"), 16)}<span>${esc(label)}</span></button>`;
  const PILLS = {
    play: [tiIcon("player-play"), "Putar"], audio: [tiIcon("headphones"), "Audio"],
    write: [tiIcon("pencil"), "Tulis"], publish: [tiIcon("send"), "Terbitkan"],
  };
  const pillbar = (active, ids) => `<nav class="qd-pillbar" aria-label="Mode cerita">${ids.map((id) =>
    `<button type="button" class="qd-pill${id === active ? " is-active" : ""}" data-pill="${id}"${id === active ? ' aria-current="page"' : ""}>${px(PILLS[id][0], 16)}<span>${PILLS[id][1]}</span></button>`).join("")}</nav>`;

  // menu kecil (popover) di bawah tombol
  let menuEl = null, menuOff = null;
  function openMenu(anchor, items) {
    closeMenu();
    const m = document.createElement("div");
    m.className = "qd-menu";
    m.setAttribute("role", "menu");
    m.innerHTML = items.map((it, i) => it.note
      ? `<div class="qd-menu-note">${esc(it.note)}</div>`
      : `<button type="button" role="menuitem" class="qd-menu-item${it.danger ? " is-danger" : ""}" data-i="${i}">${it.icon ? px(it.icon, 16) : ""}<span>${esc(it.label)}</span></button>`).join("");
    document.body.appendChild(m);
    const r = anchor.getBoundingClientRect(), mw = m.offsetWidth, mh = m.offsetHeight;
    let left = clamp(r.right - mw, 8, window.innerWidth - mw - 8), top = r.bottom + 6;
    if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 6);
    m.style.left = left + "px"; m.style.top = top + "px";
    m.addEventListener("click", (e) => {
      const b = e.target.closest("[data-i]");
      if (!b) return;
      const it = items[+b.dataset.i];
      closeMenu();
      if (it && it.onSelect) it.onSelect();
    });
    const outside = (e) => { if (!m.contains(e.target) && !anchor.contains(e.target)) closeMenu(); };
    const key = (e) => { if (e.key === "Escape") { e.stopPropagation(); closeMenu(); anchor.focus(); } };
    setTimeout(() => document.addEventListener("pointerdown", outside, true), 0);
    document.addEventListener("keydown", key, true);
    menuEl = m;
    menuOff = () => { document.removeEventListener("pointerdown", outside, true); document.removeEventListener("keydown", key, true); };
    const first = $(m, "button");
    if (first) first.focus({ preventScroll: true });
  }
  function closeMenu() { if (menuOff) menuOff(); menuOff = null; if (menuEl) menuEl.remove(); menuEl = null; }

  // urutkan daftar dengan menyeret pegangan (mouse & sentuh); onDone(urutanId)
  function makeSortable(list, itemSel, handleSel, onDone) {
    const ids = () => $$(list, itemSel).map((x) => x.dataset.id);
    list.addEventListener("pointerdown", (e) => {
      const h = e.target.closest(handleSel);
      if (!h || !list.contains(h) || e.button > 0) return;
      const item = h.closest(itemSel);
      if (!item) return;
      e.preventDefault();
      const start = ids().join("|");
      item.classList.add("is-dragging");
      list.classList.add("is-sorting");
      const move = (ev) => {
        if (ev.pointerId !== e.pointerId) return;
        const items = $$(list, itemSel).filter((x) => x !== item);
        let before = null;
        for (const it of items) { const r = it.getBoundingClientRect(); if (ev.clientY < r.top + r.height / 2) { before = it; break; } }
        if (before) { if (item.nextElementSibling !== before) list.insertBefore(item, before); }
        else { const last = items[items.length - 1]; if (last && last.nextElementSibling !== item) last.after(item); }
      };
      const up = (ev) => {
        if (ev.pointerId !== e.pointerId) return;
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
        item.classList.remove("is-dragging");
        list.classList.remove("is-sorting");
        const order = ids();
        if (order.join("|") !== start) onDone(order);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
    });
  }
  // area seret-lepas file gambar
  function dropZone(elm, onFiles) {
    elm.addEventListener("dragover", (e) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = "copy"; elm.classList.add("is-over"); });
    elm.addEventListener("dragleave", (e) => { if (!elm.contains(e.relatedTarget)) elm.classList.remove("is-over"); });
    elm.addEventListener("drop", (e) => {
      elm.classList.remove("is-over");
      if (!hasFiles(e)) return;
      e.preventDefault();
      const files = imgFromFiles(e.dataTransfer.files);
      if (files.length) onFiles(files); else toast("File itu bukan gambar.", tiIcon("alert-triangle"));
    });
  }

  /* ============================ A. PUSTAKA ============================ */
  function renderLibrary() {
    const list = qdata().stories.slice().sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    host.innerHTML = `<div class="qd-screen qd-lib">
      <header class="qd-lib-head">
        <h1 class="qd-h1">Cerita Saya</h1>
        <button type="button" class="qd-btn qd-btn-ghost" data-act="new">${px(tiIcon("plus"), 16)}<span>Cerita baru</span></button>
      </header>
      ${list.length ? `<div class="qd-lib-grid">${list.map((s) => `
        <button type="button" class="qd-card" data-act="open" data-id="${esc(s.id)}" aria-label="Buka cerita ${esc(storyTitle(s))}">
          <span class="qd-card-stage">${bookHtml(s, "is-sm")}</span>
          <span class="qd-card-title">${esc(storyTitle(s))}</span>
          <span class="qd-card-meta">${s.chapters.length} chapter · diedit ${esc(ago(s.updatedAt))}</span>
        </button>`).join("")}</div>` : `
      <div class="qd-empty">
        <div class="qd-empty-icon">${px(tiIcon("book"), 22)}</div>
        <div class="qd-empty-title">Belum ada cerita</div>
        <div class="qd-empty-sub">Mulai cerita pertamamu untuk menulis.</div>
        <button type="button" class="qd-btn qd-btn-soft" data-act="new">${px(tiIcon("plus"), 16)}<span>Buat cerita</span></button>
      </div>`}
    </div>`;
    host.firstElementChild.addEventListener("click", (e) => {
      const b = e.target.closest("[data-act]");
      if (!b) return;
      if (b.dataset.act === "new") go("create", { editId: null });
      else if (b.dataset.act === "open") go("story", { storyId: b.dataset.id });
    });
  }

  /* ============================ B. BUAT / EDIT CERITA ============================ */
  function renderCreate() {
    const editing = route.editId ? findStory(route.editId) : null;
    if (route.editId && !editing) { route = { view: "library" }; renderLibrary(); return; }
    if (!route.draft || route.draft.forId !== (editing ? editing.id : null)) {
      route.draft = editing
        ? { forId: editing.id, title: editing.title, author: editing.author, book: normBook(editing.book) }
        : { forId: null, title: "", author: userName(), book: normBook({}) };
    }
    if (!route.tab) route.tab = "style";
    const d = route.draft;
    const tabs = [["style", tiIcon("book"), "Gaya buku"], ["jacket", tiIcon("photo"), "Sampul"], ["text", tiIcon("typography"), "Teks"]];
    host.innerHTML = `<div class="qd-screen qd-create">
      <div class="qd-topbar">${backBtn(editing ? "Kembali ke cerita" : "Kembali ke pustaka")}</div>
      <div class="qd-create-body">
        <div class="qd-stage qd-stage-lg" title="Seret untuk memutar buku · lepas gambar di sini untuk sampul">${bookHtml(d, "is-lg")}</div>
        <div class="qd-create-form">
          <input class="qd-title-input" type="text" maxlength="120" placeholder="Cerita tanpa judul" aria-label="Judul cerita" value="${esc(d.title)}">
          <label class="qd-byline qd-byline-edit">oleh <input class="qd-author-input" type="text" maxlength="60" placeholder="Nama penulis" aria-label="Nama penulis" value="${esc(d.author)}"></label>
          <div class="qd-tabs" role="tablist" aria-label="Pengaturan buku">
            ${tabs.map(([id, ic, label]) => `<button type="button" role="tab" class="qd-tab${route.tab === id ? " is-active" : ""}" data-tab="${id}" aria-selected="${route.tab === id}">${px(ic, 16)}<span>${label}</span></button>`).join("")}
          </div>
          <div class="qd-tabpanel" role="tabpanel"></div>
          <div class="qd-create-actions">
            <button type="button" class="qd-btn qd-btn-primary" data-act="save">${editing ? "Simpan" : "Buat cerita"}</button>
            ${editing ? `<button type="button" class="qd-btn qd-btn-ghost" data-act="back">Batal</button>` : ""}
          </div>
        </div>
      </div>
      <input type="file" accept="image/*" class="qd-file" data-for="jacket" hidden>
    </div>`;
    const scr = host.firstElementChild, stage = $(scr, ".qd-stage"), panel = $(scr, ".qd-tabpanel"), file = $(scr, '.qd-file[data-for="jacket"]');
    let raf = 0;
    const paintBook = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { stage.innerHTML = bookHtml(d, "is-lg"); }); };
    const paintTab = () => {
      const b = d.book;
      if (route.tab === "style") {
        panel.innerHTML = `<div class="qd-kind-grid">${KINDS.map((k) => `<button type="button" class="qd-kind${b.kind === k.id ? " is-active" : ""}" data-kind="${k.id}" aria-pressed="${b.kind === k.id}">
          <span class="qd-kind-ic qd-kind-ic-${k.id}" aria-hidden="true"></span><span class="qd-kind-name">${k.label}</span><span class="qd-kind-desc">${k.desc}</span></button>`).join("")}</div>`;
      } else if (route.tab === "jacket") {
        const custom = HEX.test(b.color);
        panel.innerHTML = `
          <div class="qd-field"><div class="qd-field-label">Gambar sampul</div>
            ${b.jacket ? `<div class="qd-jacket-row"><span class="qd-jacket-thumb" style="background-image:url('${b.jacket}')"></span>
                <div class="qd-jacket-btns"><button type="button" class="qd-btn qd-btn-ghost qd-btn-sm" data-act="jacket-pick">${px(tiIcon("replace"), 15)}<span>Ganti gambar</span></button>
                <button type="button" class="qd-btn qd-btn-ghost qd-btn-sm is-danger" data-act="jacket-remove">${px(tiIcon("trash"), 15)}<span>Hapus</span></button></div></div>`
            : `<button type="button" class="qd-drop" data-act="jacket-pick">${px(tiIcon("photo-up"), 26)}<span>Seret gambar ke sini atau <u>pilih file</u></span><small>JPG, PNG, atau WebP · diperkecil otomatis</small></button>`}
          </div>
          <div class="qd-field"><div class="qd-field-label">Posisi gambar</div>
            <div class="qd-seg" role="group" aria-label="Posisi gambar">
              <button type="button" class="${b.jacketFit === "cover" ? "is-active" : ""}" data-fit="cover" aria-pressed="${b.jacketFit === "cover"}">Penuhi sampul</button>
              <button type="button" class="${b.jacketFit === "contain" ? "is-active" : ""}" data-fit="contain" aria-pressed="${b.jacketFit === "contain"}">Tampilkan utuh</button>
            </div></div>
          <div class="qd-field"><div class="qd-field-label">Warna sampul</div>
            <div class="qd-swatches">${COVERS.map((c) => `<button type="button" class="qd-swatch${b.color === c.id ? " is-active" : ""}" data-color="${c.id}" title="${esc(c.label)}" aria-label="${esc(c.label)}" style="background:${gradCss(c.c)}"></button>`).join("")}
              <label class="qd-swatch qd-swatch-custom${custom ? " is-active" : ""}" title="Warna lain"${custom ? ` style="background:${b.color}"` : ""}><input type="color" data-color-custom value="${custom ? b.color : "#30324a"}" aria-label="Warna sampul lain">${px(tiIcon("palette"), 15)}</label>
            </div></div>`;
      } else {
        panel.innerHTML = `
          <div class="qd-field"><div class="qd-field-label">Font judul</div>
            <div class="qd-font-grid">${FONTS.map((f) => `<button type="button" class="qd-font${b.titleFont === f.id ? " is-active" : ""}" data-font="${f.id}" aria-pressed="${b.titleFont === f.id}"><span class="qd-font-sample qd-f-${f.id}">Aa</span><span class="qd-font-name">${esc(f.label)}</span></button>`).join("")}</div></div>
          <div class="qd-field"><div class="qd-field-label">Warna judul</div>
            <div class="qd-swatches">${TITLE_COLORS.map((c) => `<button type="button" class="qd-swatch qd-swatch-sm${b.titleColor === c ? " is-active" : ""}" data-tcolor="${c}" title="${c}" aria-label="Warna ${c}" style="background:${c}"></button>`).join("")}
              <label class="qd-swatch qd-swatch-sm qd-swatch-custom${TITLE_COLORS.includes(b.titleColor) ? "" : " is-active"}" title="Warna lain" style="background:${b.titleColor}"><input type="color" data-tcolor-custom value="${b.titleColor}" aria-label="Warna judul lain"></label>
            </div></div>
          <div class="qd-field qd-field-row"><span class="qd-field-label">Tampilkan nama penulis</span>
            <button type="button" role="switch" aria-checked="${b.showAuthor}" aria-label="Tampilkan nama penulis" class="qd-switch${b.showAuthor ? " is-on" : ""}" data-act="toggle-author"><span></span></button></div>`;
      }
    };
    const setJacket = (f) => {
      if (!f) return;
      stage.classList.add("is-busy");
      readImageFile(f, 1000, 1000)
        .then((url) => { d.book.jacket = url; if (route.tab !== "jacket") { route.tab = "jacket"; $$(scr, ".qd-tab").forEach((t) => { t.classList.toggle("is-active", t.dataset.tab === "jacket"); t.setAttribute("aria-selected", t.dataset.tab === "jacket"); }); } paintTab(); paintBook(); })
        .catch((err) => toast(err.message || "Gambar gagal dibaca.", tiIcon("alert-triangle")))
        .finally(() => stage.classList.remove("is-busy"));
    };
    const pickCover = (id) => {
      const wasDefault = d.book.titleColor === LIGHT_TITLE || d.book.titleColor === DARK_TITLE;
      d.book.color = id;
      if (wasDefault) d.book.titleColor = coverIsLight(d.book) ? DARK_TITLE : LIGHT_TITLE;   // judul tetap terbaca
    };
    paintTab();
    attachTilt(stage);
    dropZone(stage, (files) => setJacket(files[0]));
    dropZone(panel, (files) => setJacket(files[0]));
    file.addEventListener("change", () => { setJacket(file.files[0]); file.value = ""; });
    $(scr, ".qd-title-input").addEventListener("input", (e) => { d.title = e.target.value; paintBook(); });
    $(scr, ".qd-author-input").addEventListener("input", (e) => { d.author = e.target.value; paintBook(); });
    $(scr, ".qd-title-input").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $(scr, ".qd-author-input").focus(); } });
    scr.addEventListener("input", (e) => {
      const t = e.target;
      if (t.matches("[data-color-custom]")) { pickCover(t.value.toLowerCase()); const lab = t.closest(".qd-swatch"); $$(panel, ".qd-swatch").forEach((s) => s.classList.remove("is-active")); lab.classList.add("is-active"); lab.style.background = t.value; paintBook(); }
      else if (t.matches("[data-tcolor-custom]")) { d.book.titleColor = t.value.toLowerCase(); const lab = t.closest(".qd-swatch"); $$(panel, ".qd-swatch").forEach((s) => s.classList.remove("is-active")); lab.classList.add("is-active"); lab.style.background = t.value; paintBook(); }
    });
    scr.addEventListener("click", (e) => {
      const t = e.target.closest("[data-tab],[data-kind],[data-fit],[data-color],[data-tcolor],[data-font],[data-act]");
      if (!t) return;
      const b = d.book;
      if (t.dataset.tab) {
        route.tab = t.dataset.tab;
        $$(scr, ".qd-tab").forEach((x) => { x.classList.toggle("is-active", x === t); x.setAttribute("aria-selected", x === t); });
        paintTab();
        return;
      }
      if (t.dataset.kind) b.kind = t.dataset.kind;
      else if (t.dataset.fit) b.jacketFit = t.dataset.fit;
      else if (t.dataset.color) pickCover(t.dataset.color);
      else if (t.dataset.tcolor) b.titleColor = t.dataset.tcolor;
      else if (t.dataset.font) b.titleFont = t.dataset.font;
      else if (t.dataset.act === "toggle-author") b.showAuthor = !b.showAuthor;
      else if (t.dataset.act === "jacket-pick") { file.click(); return; }
      else if (t.dataset.act === "jacket-remove") b.jacket = null;
      else if (t.dataset.act === "back") { route.draft = null; if (editing) go("story", { storyId: editing.id }); else go("library"); return; }
      else if (t.dataset.act === "save") { save(); return; }
      else return;
      paintTab(); paintBook();
    });
    const save = () => {
      const title = d.title.trim() || "Cerita tanpa judul", author = d.author.trim(), t = nowIso();
      if (editing) {
        Object.assign(editing, { title, author, book: normBook(d.book), updatedAt: t });
        changed();
        go("story", { storyId: editing.id });
      } else {
        const s = normStory({ id: uid("story"), title, author, createdAt: t, updatedAt: t, book: normBook(d.book), chapters: [], panel: {} });
        qdata().stories.push(s);
        changed();
        go("story", { storyId: s.id });
      }
    };
    if (!editing) setTimeout(() => { const i = $(scr, ".qd-title-input"); if (i && i.isConnected && !isNarrow()) i.focus({ preventScroll: true }); }, 60);
  }

  /* ============================ C. HALAMAN CERITA ============================ */
  function renderStory() {
    const s = findStory(route.storyId), n = s.chapters.length;
    const chl = (c, i) => `<li class="qd-chl-item" data-id="${esc(c.id)}">
        <span class="qd-grip" title="Seret untuk mengurutkan" aria-hidden="true">${px(tiIcon("grip-vertical"), 16)}</span>
        <span class="qd-roman">${roman(i + 1)}</span>
        <button type="button" class="qd-chl-open" data-act="opench" data-id="${esc(c.id)}" title="Buka chapter (Alt+↑/↓ untuk memindah)"><span class="qd-chl-title">${esc(chapterLabel(c, i))}</span><span class="qd-chl-words">${fmtNum(htmlWords(c.html))} kata</span></button>
        <button type="button" class="qd-icon-btn qd-chl-del" data-act="delch" data-id="${esc(c.id)}" title="Hapus chapter" aria-label="Hapus ${esc(chapterLabel(c, i))}">${px(tiIcon("trash"), 16)}</button>
      </li>`;
    host.innerHTML = `<div class="qd-screen qd-story">
      <div class="qd-topbar">${backBtn("Kembali ke cerita-cerita")}</div>
      <div class="qd-story-body">
        <div class="qd-stage qd-stage-md" title="Seret untuk memutar buku">${bookHtml(s, "is-md")}</div>
        <div class="qd-story-info">
          <h1 class="qd-story-title">${esc(storyTitle(s))}</h1>
          ${s.author ? `<div class="qd-byline">oleh ${esc(s.author)}</div>` : ""}
          <div class="qd-meta">${n} chapter${n ? " · " + fmtNum(storyWords(s)) + " kata" : ""}</div>
          ${n ? `<ol class="qd-chl" aria-label="Daftar chapter">${s.chapters.map(chl).join("")}</ol>` : `<p class="qd-muted">Cerita ini belum punya chapter.</p>`}
          <div class="qd-story-actions">
            <button type="button" class="qd-btn qd-btn-accent" data-act="newch">${px(tiIcon("plus"), 16)}<span>${n ? "Chapter baru" : "Tulis chapter pertama"}</span></button>
            <button type="button" class="qd-btn qd-btn-ghost" data-act="editcover">${px(tiIcon("edit"), 16)}<span>Edit sampul</span></button>
          </div>
          <button type="button" class="qd-link-danger" data-act="delete">${px(tiIcon("trash"), 15)}<span>Hapus cerita</span></button>
        </div>
      </div>
      ${pillbar("write", ["write", "publish"])}
    </div>`;
    const scr = host.firstElementChild;
    attachTilt($(scr, ".qd-stage"));
    const list = $(scr, ".qd-chl");
    const reorder = (order) => {
      s.chapters.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
      renumberDefaults(s);
      s.updatedAt = nowIso();
      changed();
      render();
    };
    if (list) {
      makeSortable(list, ".qd-chl-item", ".qd-grip", reorder);
      list.addEventListener("keydown", (e) => {
        const b = e.target.closest(".qd-chl-open");
        if (!b || !e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
        e.preventDefault();
        const ids = s.chapters.map((c) => c.id), i = ids.indexOf(b.dataset.id), j = i + (e.key === "ArrowUp" ? -1 : 1);
        if (j < 0 || j >= ids.length) return;
        [ids[i], ids[j]] = [ids[j], ids[i]];
        reorder(ids);
        const nb = $(host, `.qd-chl-open[data-id="${CSS.escape(b.dataset.id)}"]`);
        if (nb) nb.focus();
      });
    }
    scr.addEventListener("click", (e) => {
      const t = e.target.closest("[data-act],[data-pill]");
      if (!t) return;
      const act = t.dataset.act || "pill-" + t.dataset.pill;
      if (act === "back") go("library");
      else if (act === "newch") { const c = addChapter(s); changed(); go("editor", { storyId: s.id, chapterId: c.id }); }
      else if (act === "opench") go("editor", { storyId: s.id, chapterId: t.dataset.id });
      else if (act === "editcover") go("create", { editId: s.id });
      else if (act === "pill-write") go("editor", { storyId: s.id, chapterId: s.chapters[0] ? s.chapters[0].id : null });
      else if (act === "pill-publish") go("publish", { storyId: s.id, from: "story" });
      else if (act === "delch") {
        const i = s.chapters.findIndex((c) => c.id === t.dataset.id);
        if (i < 0 || !confirm(`Hapus "${chapterLabel(s.chapters[i], i)}"? Isi chapter ini akan hilang.`)) return;
        s.chapters.splice(i, 1);
        renumberDefaults(s);
        s.updatedAt = nowIso();
        changed();
        render();
      } else if (act === "delete") {
        if (!confirm(`Hapus cerita "${storyTitle(s)}"? Semua chapter di dalamnya ikut terhapus dan tidak bisa dikembalikan.`)) return;
        const q = qdata();
        q.stories = q.stories.filter((x) => x !== s);
        changed();
        go("library");
        toast("Cerita dihapus", tiIcon("trash"));
      }
    });
  }

  /* ============================ D. EDITOR CHAPTER ============================ */
  const FLOURISH = `<svg class="qd-flourish" viewBox="0 0 120 18" aria-hidden="true" focusable="false"><path d="M4 10c14-7 28 5 44-1 4-1.5 7-4 12-4.5 5 .5 8 3 12 4.5 16 6 30-6 44 1" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M60 9.5l2.6 2.6L60 14.7l-2.6-2.6z" fill="currentColor"/></svg>`;
  const SIZES = [12, 14, 16, 18, 20, 24, 28, 32];
  function toolbarHtml() {
    const b = (cmd, icon, label, extra) => `<button type="button" class="qd-tb" data-cmd="${cmd}" title="${label}" aria-label="${label}"${extra || ""}>${px(icon, 17)}</button>`;
    return `<div class="qd-toolbar" role="toolbar" aria-label="Format teks">
      <select class="qd-sel qd-sel-block" data-ctl="block" title="Gaya paragraf" aria-label="Gaya paragraf">
        <option value="p">Paragraf</option><option value="h1">Judul 1</option><option value="h2">Judul 2</option><option value="blockquote">Kutipan</option>
      </select>
      <select class="qd-sel qd-sel-size" data-ctl="size" title="Ukuran huruf" aria-label="Ukuran huruf">
        <option value="">Aa</option>${SIZES.map((n) => `<option value="${n}">${n}</option>`).join("")}
      </select>
      <span class="qd-tb-sep"></span>
      ${b("bold", tiIcon("bold"), "Tebal (Ctrl+B)")}${b("italic", tiIcon("italic"), "Miring (Ctrl+I)")}${b("underline", tiIcon("underline"), "Garis bawah (Ctrl+U)")}${b("strikeThrough", tiIcon("strikethrough"), "Coret")}
      <span class="qd-tb-sep"></span>
      ${b("insertUnorderedList", tiIcon("list"), "Daftar berpoin")}${b("insertOrderedList", tiIcon("list-numbers"), "Daftar bernomor")}${b("quote", tiIcon("blockquote"), "Kutipan")}
      <span class="qd-tb-sep"></span>
      ${b("justifyLeft", tiIcon("align-left"), "Rata kiri")}${b("justifyCenter", tiIcon("align-center"), "Rata tengah")}${b("justifyRight", tiIcon("align-right"), "Rata kanan")}${b("justifyFull", tiIcon("align-justified"), "Rata kiri-kanan")}
      <span class="qd-tb-sep"></span>
      ${b("divider", tiIcon("separator-horizontal"), "Pemisah adegan")}${b("image", tiIcon("photo"), "Sisipkan gambar")}
      <span class="qd-tb-sep"></span>
      ${b("undo", tiIcon("arrow-back-up"), "Urungkan (Ctrl+Z)")}${b("redo", tiIcon("arrow-forward-up"), "Ulangi (Ctrl+Y)")}
      <span class="qd-tb-flex"></span>
      <span class="qd-wordcount" aria-live="polite">0 kata</span>
    </div>`;
  }
  function renderEditor() {
    const s = findStory(route.storyId);
    if (!s.chapters.length) { addChapter(s); changed(); }
    const ch = s.chapters.find((c) => c.id === route.chapterId) || s.chapters[0];
    route.chapterId = ch.id;
    const narrow = isNarrow();
    const sideCollapsed = !narrow && LS.get(K_SIDE, "0") === "1";
    const panelOpen = !narrow && LS.get(K_PANEL, "1") === "1";
    host.innerHTML = `<div class="qd-screen qd-editor${sideCollapsed ? " side-collapsed" : ""}${panelOpen ? "" : " panel-collapsed"}">
      <aside class="qd-side" aria-label="Daftar chapter">
        <div class="qd-side-head">
          <button type="button" class="qd-icon-btn" data-act="tostory" title="Kembali ke halaman cerita" aria-label="Kembali ke halaman cerita">${px(tiIcon("chevron-left"), 18)}</button>
          <div class="qd-side-titles"><div class="qd-side-title"></div><div class="qd-side-meta"></div></div>
          <button type="button" class="qd-icon-btn qd-side-collapse" data-act="side-toggle" title="Sembunyikan daftar chapter" aria-label="Sembunyikan daftar chapter">${px(tiIcon("layout-sidebar-left-collapse"), 18)}</button>
        </div>
        <div class="qd-side-label">Chapter</div>
        <ol class="qd-side-list"></ol>
        <button type="button" class="qd-side-new" data-act="newch">${px(tiIcon("plus"), 16)}<span>Chapter baru</span></button>
      </aside>
      <div class="qd-scrim" data-act="close-drawers"></div>
      <section class="qd-main" aria-label="Editor chapter">
        <div class="qd-main-top">
          <button type="button" class="qd-icon-btn qd-side-open" data-act="side-toggle" title="Tampilkan daftar chapter" aria-label="Tampilkan daftar chapter">${px(tiIcon("layout-sidebar-left-expand"), 18)}</button>
          <span class="qd-flex"></span>
          <button type="button" class="qd-icon-btn" data-act="chmenu" title="Opsi chapter" aria-label="Opsi chapter" aria-haspopup="menu">${px(tiIcon("dots"), 18)}</button>
          <button type="button" class="qd-icon-btn" data-act="tostory" title="Tutup editor" aria-label="Tutup editor">${px(tiIcon("x"), 18)}</button>
          <button type="button" class="qd-icon-btn qd-panel-open" data-act="panel-toggle" title="Panel alat" aria-label="Tampilkan panel alat">${px(tiIcon("layout-sidebar-right"), 18)}</button>
        </div>
        <div class="qd-main-scroll">
          <div class="qd-page">
            <input class="qd-ch-title" type="text" maxlength="140" aria-label="Judul chapter" spellcheck="false">
            ${FLOURISH}
            <div class="qd-header-zone"></div>
            ${toolbarHtml()}
            <div class="qd-body" contenteditable="true" spellcheck="true" role="textbox" aria-multiline="true" aria-label="Isi chapter" data-placeholder="Mulai menulis chapter-mu…"></div>
          </div>
        </div>
        <div class="qd-audio-bar hidden" role="region" aria-label="Audio"></div>
        ${pillbar("write", ["play", "audio", "write", "publish"])}
      </section>
      <aside class="qd-panel" aria-label="Panel alat">
        <div class="qd-panel-head">
          <div class="qd-ptabs" role="tablist" aria-label="Tab panel"></div>
          <button type="button" class="qd-icon-btn qd-panel-close" data-act="panel-toggle" title="Sembunyikan panel" aria-label="Sembunyikan panel alat">${px(tiIcon("layout-sidebar-right-collapse"), 18)}</button>
        </div>
        <div class="qd-panel-body">
          <div class="qd-tools-row"></div>
          <div class="qd-panel-mount"></div>
          <div class="qd-tiles"></div>
          <div class="qd-ptab-empty hidden">${px(tiIcon("layout-grid"), 20)}<span>Tab ini masih kosong.<br>Pilih tile lewat "Tambah tile".</span></div>
          <div class="qd-panel-empty">${px(tiIcon("layout-sidebar-right"), 22)}<span>Panel alat akan tampil di sini</span></div>
          <button type="button" class="qd-tile-add hidden" data-act="tile-add">${px(tiIcon("plus"), 15)}<span>Tambah tile</span></button>
        </div>
      </aside>
      <input type="file" accept="image/*" class="qd-file" data-for="header" hidden>
      <input type="file" accept="image/*" class="qd-file" data-for="inline" multiple hidden>
    </div>`;
    const scr = host.firstElementChild;
    ed = {
      story: s, ch, scr,
      bodyEl: $(scr, ".qd-body"), titleEl: $(scr, ".qd-ch-title"), zoneEl: $(scr, ".qd-header-zone"), wcEl: $(scr, ".qd-wordcount"),
      scrollEl: $(scr, ".qd-main-scroll"), sideList: $(scr, ".qd-side-list"), tilesEl: $(scr, ".qd-tiles"), toolsEl: $(scr, ".qd-tools-row"),
      mountEl: $(scr, ".qd-panel-mount"), audioEl: $(scr, ".qd-audio-bar"), ptabsEl: $(scr, ".qd-ptabs"),
      dirty: false, timer: 0, range: null, pendingSize: 0, internalDrag: false, mounted: new Map(), ctxs: [], tsRaf: 0,
    };
    loadChapter();
    renderSide();
    renderPanelTabs();
    renderTools();
    mountTiles();
    wireEditor(scr);
    document.addEventListener("selectionchange", onSelChange);
    cleanups.push(teardownEditor);
  }
  function teardownEditor() {
    if (!ed) return;
    stopAudio();
    syncEditor();
    clearTimeout(ed.timer);
    document.removeEventListener("selectionchange", onSelChange);
    unmountTiles();
    ed.ctxs.forEach((c) => c._dispose());
    ed = null;
  }
  function loadChapter() {
    const { story: s, ch } = ed, i = s.chapters.indexOf(ch);
    ed.titleEl.value = ch.title;
    ed.titleEl.placeholder = "Chapter " + roman(i + 1);
    ed.bodyEl.innerHTML = sanitizeHtml(ch.html) || "<p><br></p>";
    ed.range = null;
    ed.dirty = false;
    renderHeaderZone();
    updateEmpty();
    updateWordCount();
    ed.scrollEl.scrollTop = 0;
  }
  function renderSide() {
    const { story: s, ch } = ed;
    $(ed.scr, ".qd-side-title").textContent = storyTitle(s);
    $(ed.scr, ".qd-side-meta").textContent = s.chapters.length + " chapter";
    ed.sideList.innerHTML = s.chapters.map((c, i) => `<li class="qd-side-item${c === ch ? " is-active" : ""}" data-id="${esc(c.id)}">
        <button type="button" class="qd-side-btn" data-act="opench" data-id="${esc(c.id)}"${c === ch ? ' aria-current="true"' : ""}><span class="qd-roman">${roman(i + 1)}</span><span class="qd-side-name">${esc(chapterLabel(c, i))}</span></button>
        <span class="qd-grip qd-side-grip" title="Seret untuk mengurutkan" aria-hidden="true">${px(tiIcon("grip-vertical"), 14)}</span>
      </li>`).join("");
  }
  function renderHeaderZone() {
    const { ch, zoneEl } = ed;
    zoneEl.innerHTML = ch.header
      ? `<figure class="qd-header-img"><img src="${esc(ch.header)}" alt="Gambar header chapter"><div class="qd-header-actions">
          <button type="button" class="qd-btn qd-btn-glass qd-btn-sm" data-act="hdr-pick">${px(tiIcon("replace"), 15)}<span>Ganti</span></button>
          <button type="button" class="qd-btn qd-btn-glass qd-btn-sm is-danger" data-act="hdr-remove">${px(tiIcon("trash"), 15)}<span>Hapus</span></button></div></figure>`
      : `<button type="button" class="qd-header-drop" data-act="hdr-pick">${px(tiIcon("photo-plus"), 26)}<span>Tambah gambar header</span><small>klik atau seret gambar ke sini</small></button>`;
  }
  function updateEmpty() { if (ed) ed.bodyEl.classList.toggle("is-empty", !ed.bodyEl.textContent.trim() && !ed.bodyEl.querySelector("img,hr,li")); }
  function updateWordCount() { if (ed) { const n = countWords(ed.bodyEl.innerText || ed.bodyEl.textContent); ed.wcEl.textContent = fmtNum(n) + " kata"; } }
  // innerHTML editor tanpa sorotan audio (kelas sementara tidak boleh ikut tersimpan)
  function bodyHtml() {
    if (!ed) return "";
    const hl = $$(ed.bodyEl, ".qd-reading");
    hl.forEach((x) => x.classList.remove("qd-reading"));
    const html = ed.bodyEl.innerHTML;
    hl.forEach((x) => x.classList.add("qd-reading"));
    return html;
  }
  function syncEditor() {
    if (!ed || !ed.dirty) return;
    ed.ch.html = bodyHtml().replace(/ class=""/g, "");
    if (ed.ch.html === "<p><br></p>") ed.ch.html = "";
    ed.ch.updatedAt = ed.story.updatedAt = nowIso();
    ed.dirty = false;
    updateWordCount();
    emit("text");
  }
  // Teks yang menempel langsung di root editor (mis. setelah Ctrl+A lalu hapus) dibungkus <p>, supaya Enter selalu
  // membuat paragraf <p>. (Tidak memakai execCommand("defaultParagraphSeparator") karena setelan itu berlaku untuk
  // seluruh dokumen — editor Scene harus tetap seperti sebelumnya.)
  const BLOCK_RE = /^(P|DIV|H1|H2|BLOCKQUOTE|UL|OL|HR|FIGURE)$/;
  const INNER_BLOCKS = ":scope > p, :scope > div, :scope > h1, :scope > h2, :scope > blockquote, :scope > ul, :scope > ol, :scope > hr, :scope > figure";
  function ensureBlocks() {
    const b = ed.bodyEl;
    let kids = Array.from(b.childNodes);
    // <p> yang membungkus blok lain (Chrome kadang membuat <p><ul>…</ul></p>) dibuka supaya HTML-nya valid
    const badP = kids.filter((n) => n.nodeType === 1 && n.tagName === "P" && n.querySelector(INNER_BLOCKS));
    const isLoose = (n) => (n.nodeType === 3 && n.textContent.trim()) || (n.nodeType === 1 && !BLOCK_RE.test(n.tagName) && n.tagName !== "BR");
    // <div> buatan Chrome (Enter setelah judul, dll.) yang hanya berisi teks -> <p> (gaya paragraf buku & EPUB sama)
    const leafDivs = kids.filter((n) => n.nodeType === 1 && n.tagName === "DIV" && !n.querySelector("p,div,h1,h2,blockquote,ul,ol,hr,figure"));
    if (!badP.length && !leafDivs.length && !kids.some(isLoose)) return;
    const sel = document.getSelection();
    const keep = sel && sel.rangeCount ? [sel.anchorNode, sel.anchorOffset, sel.focusNode, sel.focusOffset] : null;
    const swap = new Map();
    badP.forEach((pp) => {
      const first = pp.firstChild;
      while (pp.firstChild) b.insertBefore(pp.firstChild, pp);
      swap.set(pp, first || b);
      pp.remove();
    });
    const looseInline = Array.from(b.childNodes).some(isLoose);
    leafDivs.forEach((d) => {
      const np = document.createElement("p");
      if (d.getAttribute("style")) np.setAttribute("style", d.getAttribute("style"));
      while (d.firstChild) np.appendChild(d.firstChild);
      d.replaceWith(np);
      swap.set(d, np);
    });
    if (looseInline) {
      let n = b.firstChild, wrap = null;
      while (n) {
        const next = n.nextSibling;
        const inline = n.nodeType === 3 ? !!n.textContent.trim() || !!wrap : n.nodeType === 1 && !BLOCK_RE.test(n.tagName);
        if (inline) { if (!wrap) { wrap = document.createElement("p"); b.insertBefore(wrap, n); } wrap.appendChild(n); }
        else wrap = null;
        n = next;
      }
    }
    if (keep && keep[0]) {
      const an = swap.get(keep[0]) || keep[0], fn = swap.get(keep[2]) || keep[2];
      if (swap.has(keep[0])) keep[1] = 0;
      if (swap.has(keep[2])) keep[3] = 0;
      if (b.contains(an) && b.contains(fn)) { try { sel.setBaseAndExtent(an, keep[1], fn, keep[3]); } catch (e) { /* abaikan */ } }
    }
  }
  function onBodyInput() {
    if (!ed) return;
    ensureBlocks();
    convertFonts(true);
    const sel = document.getSelection();
    if (sel && sel.rangeCount && ed.bodyEl.contains(sel.getRangeAt(0).commonAncestorContainer)) ed.range = sel.getRangeAt(0).cloneRange();
    ed.dirty = true;
    updateEmpty();
    changed();
    clearTimeout(ed.timer);
    ed.timer = setTimeout(syncEditor, 600);
  }
  // execCommand("fontSize", "7") menghasilkan <font size="7"> -> diganti <span style="font-size:Npx">
  function convertFonts(keepCaret) {
    const fonts = $$(ed.bodyEl, "font");
    if (!fonts.length) return;
    const made = [];
    fonts.forEach((f) => {
      const sp = document.createElement("span");
      if (f.getAttribute("size") === "7" && ed.pendingSize) sp.style.fontSize = ed.pendingSize + "px";
      while (f.firstChild) sp.appendChild(f.firstChild);
      f.replaceWith(sp);
      made.push(sp);
    });
    const sel = document.getSelection(), r = document.createRange();
    if (keepCaret) { const last = made[made.length - 1]; r.selectNodeContents(last); r.collapse(false); }
    else { r.setStartBefore(made[0]); r.setEndAfter(made[made.length - 1]); }
    sel.removeAllRanges(); sel.addRange(r);
    ed.range = r.cloneRange();
  }
  function onSelChange() {
    if (!ed) return;
    const sel = document.getSelection();
    if (!sel || !sel.rangeCount) return;
    const r = sel.getRangeAt(0);
    if (!ed.bodyEl.contains(r.commonAncestorContainer)) return;
    ed.range = r.cloneRange();
    if (!ed.tsRaf) ed.tsRaf = requestAnimationFrame(() => { if (ed) { ed.tsRaf = 0; updateToolbarState(); } });
  }
  // Kembalikan seleksi terakhir di editor (mis. setelah memilih dropdown di toolbar). Kalau editor masih fokus
  // dengan seleksi di dalamnya, seleksi itu yang terbaru — jangan ditimpa rentang simpanan yang mungkin sudah basi.
  function restoreSel() {
    if (!ed) return;
    const b = ed.bodyEl, sel = document.getSelection();
    if (document.activeElement === b && sel && sel.rangeCount && b.contains(sel.getRangeAt(0).commonAncestorContainer)) { ed.range = sel.getRangeAt(0).cloneRange(); return; }
    if (document.activeElement !== b) b.focus({ preventScroll: true });
    if (ed.range && b.contains(ed.range.commonAncestorContainer)) { sel.removeAllRanges(); sel.addRange(ed.range); }
    else if (!sel.rangeCount || !b.contains(sel.anchorNode)) { const r = document.createRange(); r.selectNodeContents(b); r.collapse(false); sel.removeAllRanges(); sel.addRange(r); }
  }
  function exec(cmd, val) {
    restoreSel();
    document.execCommand(cmd, false, val == null ? null : val);
    onBodyInput();
    updateToolbarState();
  }
  function blockOfSelection() {
    const sel = document.getSelection();
    let n = sel && sel.rangeCount ? sel.anchorNode : null;
    while (n && n !== ed.bodyEl) { if (n.nodeType === 1 && /^(P|H1|H2|BLOCKQUOTE|LI|DIV)$/.test(n.tagName)) return n; n = n.parentNode; }
    return null;
  }
  function updateToolbarState() {
    if (!ed) return;
    const tb = $(ed.scr, ".qd-toolbar");
    ["bold", "italic", "underline", "strikeThrough", "insertUnorderedList", "insertOrderedList", "justifyLeft", "justifyCenter", "justifyRight", "justifyFull"].forEach((cmd) => {
      let on = false;
      try { on = document.queryCommandState(cmd); } catch (e) { on = false; }
      const btn = $(tb, `[data-cmd="${cmd}"]`);
      if (btn) { btn.classList.toggle("is-on", !!on); btn.setAttribute("aria-pressed", on ? "true" : "false"); }
    });
    const blk = blockOfSelection();
    let tag = blk ? blk.tagName.toLowerCase() : "p";
    if (blk && blk.closest("blockquote")) tag = "blockquote";
    $(tb, '[data-cmd="quote"]').classList.toggle("is-on", tag === "blockquote");
    const bs = $(tb, '[data-ctl="block"]');
    bs.value = ["p", "h1", "h2", "blockquote"].includes(tag) ? tag : "p";
    const sel = document.getSelection();
    let node = sel && sel.rangeCount ? sel.anchorNode : null;
    if (node && node.nodeType === 3) node = node.parentNode;
    const fs = node && ed.bodyEl.contains(node) ? Math.round(parseFloat(getComputedStyle(node).fontSize)) : 0;
    const ss = $(tb, '[data-ctl="size"]');
    ss.value = SIZES.includes(fs) ? String(fs) : "";
  }
  function insertImages(files) {
    files = imgFromFiles(files);
    if (!files.length) return;
    files.reduce((chain, f) => chain.then(() => readImageFile(f, 1200, 1600).then((url) => {
      if (!ed) return;
      exec("insertHTML", `<img src="${url}" alt="">`);
    })), Promise.resolve()).catch((err) => toast(err.message || "Gambar gagal disisipkan.", tiIcon("alert-triangle")));
  }
  function setHeader(f) {
    if (!f || !ed) return;
    const target = ed.ch;
    ed.zoneEl.classList.add("is-busy");
    readImageFile(f, 1600, 1600)
      .then((url) => { target.header = url; target.updatedAt = nowIso(); changed(); if (ed && ed.ch === target) renderHeaderZone(); })
      .catch((err) => toast(err.message || "Gambar gagal dibaca.", tiIcon("alert-triangle")))
      .finally(() => { if (ed) ed.zoneEl.classList.remove("is-busy"); });
  }
  function openChapter(id) {
    if (!ed) return;
    const c = ed.story.chapters.find((x) => x.id === id);
    if (!c) return;
    stopAudio();
    syncEditor();
    ed.ch = c;
    route.chapterId = c.id;
    loadChapter();
    renderSide();
    closeDrawers();
    emit("chapter");
  }
  function newChapter() {
    if (!ed) return;
    syncEditor();
    const c = addChapter(ed.story);
    changed();
    openChapter(c.id);
    ed.bodyEl.focus();
  }
  function deleteCurrentChapter() {
    const { story: s, ch } = ed, i = s.chapters.indexOf(ch);
    if (!confirm(`Hapus "${chapterLabel(ch, i)}"? Isi chapter ini akan hilang.`)) return;
    ed.dirty = false;
    s.chapters.splice(i, 1);
    renumberDefaults(s);
    s.updatedAt = nowIso();
    changed();
    if (!s.chapters.length) { go("story", { storyId: s.id }); return; }
    openChapter(s.chapters[Math.min(i, s.chapters.length - 1)].id);
  }
  function closeDrawers() { if (ed) ed.scr.classList.remove("side-open", "panel-open"); }
  function setPanelOpen(open) {
    if (!ed) return;
    if (isNarrow()) { ed.scr.classList.toggle("panel-open", open); ed.scr.classList.remove("side-open"); }
    else { ed.scr.classList.toggle("panel-collapsed", !open); LS.set(K_PANEL, open ? "1" : "0"); }
  }
  const panelIsOpen = () => !!ed && (isNarrow() ? ed.scr.classList.contains("panel-open") : !ed.scr.classList.contains("panel-collapsed"));
  function wireEditor(scr) {
    const { bodyEl: body, titleEl: title } = ed;
    const fileHeader = $(scr, '.qd-file[data-for="header"]'), fileInline = $(scr, '.qd-file[data-for="inline"]');
    body.addEventListener("input", onBodyInput);
    body.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
        const k = e.key.toLowerCase();
        if (k === "b" || k === "i" || k === "u") { e.preventDefault(); exec(k === "b" ? "bold" : k === "i" ? "italic" : "underline"); }
      }
    });
    body.addEventListener("paste", (e) => {
      const cd = e.clipboardData;
      if (!cd) return;
      const files = imgFromFiles(cd.files);
      e.preventDefault();
      if (files.length) { insertImages(files); return; }
      const html = cd.getData("text/html"), text = cd.getData("text/plain");
      if (html) exec("insertHTML", sanitizeHtml(html, { paste: true }));
      else if (text) { if (/\n/.test(text)) exec("insertHTML", textToHtml(text)); else exec("insertText", text); }
    });
    body.addEventListener("dragstart", () => { ed.internalDrag = true; });
    body.addEventListener("dragend", () => { if (ed) ed.internalDrag = false; });
    body.addEventListener("drop", (e) => {
      if (!ed || ed.internalDrag || !e.dataTransfer) return;
      const files = imgFromFiles(e.dataTransfer.files), html = e.dataTransfer.getData("text/html");
      if (!files.length && !html) return;   // teks biasa: biar browser yang menyisipkan
      e.preventDefault();
      const r = document.caretRangeFromPoint ? document.caretRangeFromPoint(e.clientX, e.clientY) : null;
      if (r && body.contains(r.startContainer)) ed.range = r;
      if (files.length) insertImages(files); else exec("insertHTML", sanitizeHtml(html, { paste: true }));
    });
    title.addEventListener("input", () => {
      ed.ch.title = title.value;
      ed.ch.updatedAt = ed.story.updatedAt = nowIso();
      const nm = $(ed.sideList, `.qd-side-item[data-id="${CSS.escape(ed.ch.id)}"] .qd-side-name`);
      if (nm) nm.textContent = chapterLabel(ed.ch, ed.story.chapters.indexOf(ed.ch));
      changed();
    });
    title.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      body.focus();
      const r = document.createRange(); r.selectNodeContents(body); r.collapse(true);
      const sel = document.getSelection(); sel.removeAllRanges(); sel.addRange(r);
    });
    // toolbar: mousedown dicegah supaya seleksi di editor tidak hilang
    const tb = $(scr, ".qd-toolbar");
    tb.addEventListener("mousedown", (e) => { if (e.target.closest("button")) e.preventDefault(); });
    tb.addEventListener("click", (e) => {
      const b = e.target.closest("[data-cmd]");
      if (!b) return;
      const cmd = b.dataset.cmd;
      if (cmd === "quote") { const blk = blockOfSelection(); exec("formatBlock", blk && blk.closest("blockquote") ? "<p>" : "<blockquote>"); }
      else if (cmd === "divider") exec("insertHTML", '<hr class="qd-break"><p><br></p>');
      else if (cmd === "image") { restoreSel(); fileInline.click(); }
      else exec(cmd);
    });
    $(tb, '[data-ctl="block"]').addEventListener("change", (e) => { exec("formatBlock", "<" + e.target.value + ">"); });
    $(tb, '[data-ctl="size"]').addEventListener("change", (e) => {
      const n = parseInt(e.target.value, 10);
      if (!n) return;
      ed.pendingSize = n;
      restoreSel();
      const collapsed = document.getSelection().isCollapsed;
      document.execCommand("styleWithCSS", false, false);
      document.execCommand("fontSize", false, "7");
      if (!collapsed) convertFonts(false);
      onBodyInput();
    });
    fileInline.addEventListener("change", () => { insertImages(fileInline.files); fileInline.value = ""; });
    fileHeader.addEventListener("change", () => { setHeader(imgFromFiles(fileHeader.files)[0]); fileHeader.value = ""; });
    dropZone(ed.zoneEl, (files) => setHeader(files[0]));
    makeSortable(ed.sideList, ".qd-side-item", ".qd-side-grip", (order) => {
      const s = ed.story;
      syncEditor();
      s.chapters.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
      renumberDefaults(s);
      s.updatedAt = nowIso();
      changed();
      renderSide();
      ed.titleEl.placeholder = "Chapter " + roman(s.chapters.indexOf(ed.ch) + 1);
      if (ed.titleEl.value !== ed.ch.title) ed.titleEl.value = ed.ch.title;
    });
    makeSortable(ed.tilesEl, ".qd-tile", ".qd-tile-grip", (order) => {
      const states = tileStates(ed.story);
      const shown = order.map((id) => states.find((t) => t.id === id)).filter(Boolean);
      setLayout(shown.concat(states.filter((t) => !order.includes(t.id))));
    });
    scr.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && (scr.classList.contains("side-open") || scr.classList.contains("panel-open"))) { e.stopPropagation(); closeDrawers(); }
    });
    scr.addEventListener("click", (e) => {
      const t = e.target.closest("[data-act],[data-pill],[data-tool],[data-ptab]");
      if (!t || !ed) return;
      if (t.dataset.tool) { openTool(t.dataset.tool); return; }
      if (t.dataset.ptab) { if (!t.querySelector("input")) clickPanelTab(t); return; }
      const act = t.dataset.act || "pill-" + t.dataset.pill;
      if (act === "tostory") go("story", { storyId: ed.story.id });
      else if (act === "opench") { if (t.dataset.id !== ed.ch.id) openChapter(t.dataset.id); else closeDrawers(); }
      else if (act === "newch") newChapter();
      else if (act === "side-toggle") {
        if (isNarrow()) { scr.classList.toggle("side-open"); scr.classList.remove("panel-open"); }
        else { const c = !scr.classList.contains("side-collapsed"); scr.classList.toggle("side-collapsed", c); LS.set(K_SIDE, c ? "1" : "0"); }
      } else if (act === "panel-toggle") setPanelOpen(!panelIsOpen());
      else if (act === "close-drawers") closeDrawers();
      else if (act === "chmenu") openMenu(t, [
        { icon: tiIcon("player-play"), label: "Putar dari chapter ini", onSelect: () => openReader(ed.story, ed.ch.id) },
        { icon: tiIcon("plus"), label: "Chapter baru", onSelect: newChapter },
        { icon: tiIcon("trash"), label: "Hapus chapter", danger: true, onSelect: deleteCurrentChapter },
      ]);
      else if (act === "hdr-pick") fileHeader.click();
      else if (act === "hdr-remove") { ed.ch.header = null; ed.ch.updatedAt = nowIso(); changed(); renderHeaderZone(); }
      else if (act === "tile-add") openTileMenu(t);
      else if (act === "ptab-add") addPanelTab();
      else if (act === "pill-play") openReader(ed.story, ed.ch.id);
      else if (act === "pill-audio") toggleAudioBar();
      else if (act === "pill-write") body.focus();
      else if (act === "pill-publish") go("publish", { storyId: ed.story.id, from: "editor", chapterId: ed.ch.id });
      else if (act === "a-play") audioPlayPause();
      else if (act === "a-stop") stopAudio("Berhenti");
      else if (act === "a-close") { stopAudio(); ed.audioEl.classList.add("hidden"); $(scr, '[data-pill="audio"]').classList.remove("is-on"); }
    });
  }

  /* ---------- PANEL KANAN (shell + extension API) ---------- */
  function iconMarkup(icon) {
    if (typeof icon === "string" && /^\s*<svg[\s>]/.test(icon)) return icon;   // markup dari tiIcon("NAMA")
    if (typeof icon === "string" && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(icon)) return '<svg class="ti" aria-hidden="true" focusable="false"><use href="#ti-' + icon + '"></use></svg>';
    return "";
  }
  // story.panel.layout = { tiles: [{ id, on }],                       <- tab "Beranda"
  //                        tabs: [{ id, name, tiles: [{ id, on }] }],  <- tab buatan pengguna (tombol "+"), isi tile sendiri
  //                        tab: "home" | id tab aktif }
  function layoutOf(story) {
    const p = story.panel;
    if (!p.layout || typeof p.layout !== "object" || Array.isArray(p.layout)) p.layout = { tiles: [] };
    const l = p.layout;
    if (!Array.isArray(l.tiles)) l.tiles = [];
    if (!Array.isArray(l.tabs)) l.tabs = [];
    l.tabs = l.tabs.filter((t) => t && typeof t === "object" && typeof t.id === "string" && t.id && t.id !== "home");
    l.tabs.forEach((t) => { t.name = typeof t.name === "string" ? t.name : "Tab"; if (!Array.isArray(t.tiles)) t.tiles = []; });
    return l;
  }
  // tab aktif (null = Beranda)
  function activeTab(story) {
    const l = story.panel.layout;
    if (!l || !Array.isArray(l.tabs) || !l.tab || l.tab === "home") return null;
    return l.tabs.find((t) => t && t.id === l.tab && Array.isArray(t.tiles)) || null;
  }
  // urutan + status tampil semua tile di tab aktif (tile yang belum pernah dicatat: Beranda memakai defaultOn, tab lain mati)
  function tileStates(story) {
    const tab = activeTab(story);
    const src = tab ? tab.tiles : story.panel.layout && story.panel.layout.tiles;
    const saved = (Array.isArray(src) ? src : []).filter((t) => t && typeof t.id === "string").map((t) => ({ id: t.id, on: !!t.on }));
    const known = new Set(saved.map((t) => t.id));
    reg.tiles.forEach((d) => { if (!known.has(d.id)) saved.push({ id: d.id, on: !tab && d.defaultOn !== false }); });
    return saved;
  }
  function setLayout(states) {
    if (!ed) return;
    const list = states.map((t) => ({ id: t.id, on: !!t.on })), tab = activeTab(ed.story);
    if (tab) tab.tiles = list; else layoutOf(ed.story).tiles = list;
    changed();
  }
  /* ---------- tab panel: "Beranda" + tab buatan sendiri ---------- */
  function renderPanelTabs() {
    if (!ed) return;
    const l = layoutOf(ed.story), cur = activeTab(ed.story);
    const tab = (id, name, icon, on, custom) => `<button type="button" role="tab" class="qd-ptab${on ? " is-active" : ""}" data-ptab="${esc(id)}" aria-selected="${on}"${on && custom ? ' title="Klik untuk ganti nama / hapus" aria-haspopup="menu"' : ""}>${icon}<span class="qd-ptab-name">${esc(name)}</span>${on && custom ? px(tiIcon("chevron-down"), 13) : ""}</button>`;
    ed.ptabsEl.innerHTML = tab("home", "Beranda", px(tiIcon("home"), 14), !cur, false) +
      l.tabs.map((t) => tab(t.id, t.name.trim() || "Tab", "", t === cur, true)).join("") +
      `<button type="button" class="qd-icon-btn qd-ptab-add" data-act="ptab-add" title="Tab baru" aria-label="Tambah tab panel">${px(tiIcon("plus"), 16)}</button>`;
  }
  function switchPanelTab(id) {
    if (!ed) return;
    const l = layoutOf(ed.story);
    l.tab = id !== "home" && l.tabs.some((t) => t.id === id) ? id : "home";
    renderPanelTabs();
    mountTiles();
    const b = $(ed.ptabsEl, ".qd-ptab.is-active");
    if (b) b.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
  function clickPanelTab(btn) {
    const id = btn.dataset.ptab, cur = activeTab(ed.story);
    if (!cur || cur.id !== id) { switchPanelTab(id); return; }
    openMenu(btn, [
      { icon: tiIcon("pencil"), label: "Ganti nama tab", onSelect: () => renamePanelTab(id) },
      { icon: tiIcon("trash"), label: "Hapus tab", danger: true, onSelect: () => deletePanelTab(id) },
    ]);
  }
  function addPanelTab() {
    if (!ed) return;
    const l = layoutOf(ed.story);
    if (l.tabs.length >= 12) { toast("Maksimal 12 tab.", tiIcon("info-circle")); return; }
    const t = { id: uid("tab"), name: "Tab " + (l.tabs.length + 2), tiles: [] };
    l.tabs.push(t);
    changed();
    switchPanelTab(t.id);
    renamePanelTab(t.id);
  }
  // ganti nama langsung di tombol tab (Enter / klik di luar = simpan, Esc = batal)
  function renamePanelTab(id) {
    if (!ed) return;
    const t = layoutOf(ed.story).tabs.find((x) => x.id === id), btn = $(ed.ptabsEl, `[data-ptab="${CSS.escape(id)}"]`);
    if (!t || !btn) return;
    const inp = document.createElement("input");
    inp.className = "qd-ptab-input";
    inp.maxLength = 40;
    inp.value = t.name;
    inp.setAttribute("aria-label", "Nama tab");
    btn.innerHTML = "";
    btn.appendChild(inp);
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      const v = inp.value.trim();
      if (save && v && v !== t.name) { t.name = v; changed(); }
      if (ed) renderPanelTabs();
    };
    inp.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") { e.preventDefault(); finish(true); } else if (e.key === "Escape") { e.preventDefault(); finish(false); }
    });
    inp.addEventListener("blur", () => finish(true));
    inp.addEventListener("click", (e) => e.stopPropagation());
    inp.focus();
    inp.select();
  }
  function deletePanelTab(id) {
    if (!ed) return;
    const l = layoutOf(ed.story), t = l.tabs.find((x) => x.id === id);
    if (!t || !confirm(`Hapus tab "${t.name.trim() || "Tab"}"? Data tile-nya tetap tersimpan.`)) return;
    l.tabs = l.tabs.filter((x) => x !== t);
    changed();
    switchPanelTab(l.tab === id ? "home" : l.tab);
  }
  function makeCtx(ownerId) {
    const subs = [];
    const on = (type, cb) => {
      if (typeof cb !== "function") return () => {};
      const rec = { type, cb };
      bus.add(rec); subs.push(rec);
      return () => bus.delete(rec);
    };
    const ctx = {
      get project() { return P; },
      get story() { return ed ? ed.story : null; },
      get chapter() { return ed ? ed.ch : null; },
      get user() { return { name: userName() }; },
      get store() {
        const s = ed && ed.story;
        if (!s || !ownerId) return null;
        if (!s.panel[ownerId] || typeof s.panel[ownerId] !== "object") s.panel[ownerId] = {};
        return s.panel[ownerId];
      },
      get panelEl() { return ed ? ed.mountEl : null; },
      getChapterHtml: () => (ed ? bodyHtml() : ""),
      getChapterText: () => (ed ? ed.bodyEl.innerText || ed.bodyEl.textContent || "" : ""),
      insertHtmlAtCursor(html) { if (!ed) return false; exec("insertHTML", sanitizeHtml(html)); return true; },
      replaceChapterHtml(html) {
        if (!ed) return false;
        ed.bodyEl.innerHTML = sanitizeHtml(html) || "<p><br></p>";
        ed.range = null;
        onBodyInput();
        syncEditor();
        return true;
      },
      onChange: changed,
      openProjectTab(tab) { flush(); if (O && typeof O.openTab === "function") O.openTab(tab); },
      el(tag, cls) { const e = document.createElement(tag || "div"); if (cls) e.className = cls; return e; },
      escapeHtml: esc,
      sanitizeHtml: (html) => sanitizeHtml(html),
      onChapterChange: (cb) => on("chapter", cb),
      onTextChange: (cb) => on("text", cb),
      getOrganize: () => (O && typeof O.getOrganize === "function" ? O.getOrganize() : P && P.data.organize) || null,
      getMaps: () => (O && typeof O.getMaps === "function" ? O.getMaps() : P && P.data.maps) || null,
      openChapter: (id) => openChapter(id),
      _dispose() { subs.forEach((r) => bus.delete(r)); subs.length = 0; },
    };
    return ctx;
  }
  function emit(type) {
    if (!ed) return;
    const { ch, story } = ed;
    Array.from(bus).forEach((r) => { if (r.type === type) { try { r.cb(ch, story); } catch (e) { console.error("[Quill] listener", e); } } });
    if (type === "chapter") ed.mounted.forEach((m) => callUpdate(m, "chapter"));
  }
  function callUpdate(m, reason) {
    if (typeof m.def.update !== "function") return;
    try { m.def.update(m.body, m.ctx, reason); } catch (e) { console.error("[Quill] tile " + m.def.id, e); }
  }
  function renderTools() {
    if (!ed) return;
    // def.disabled = tombol mati, def.badge = label kecil di ikon (mis. "Segera"), def.hint = tooltip (bawaan: label)
    ed.toolsEl.innerHTML = reg.tools.map((t) => `<button type="button" class="qd-tool${t.disabled ? " is-disabled" : ""}" data-tool="${esc(t.id)}" title="${esc(t.hint || t.label || t.id)}" aria-label="${esc(t.hint || t.label || t.id)}"${t.disabled ? " disabled" : ""}><span class="qd-tool-ic">${iconMarkup(t.icon)}${t.badge ? `<span class="qd-tool-badge">${esc(t.badge)}</span>` : ""}</span><span class="qd-tool-label">${esc(t.label || "")}</span></button>`).join("");
    updatePanelEmpty();
  }
  function openTool(id) {
    const def = reg.tools.find((t) => t.id === id);
    if (!def || !ed) return;
    const ctx = makeCtx(def.id);
    ed.ctxs.push(ctx);
    try { def.open(ctx); } catch (e) { console.error("[Quill] tool " + id, e); }
  }
  function mountTile(def, before) {
    if (!ed || ed.mounted.has(def.id)) return;
    const card = document.createElement("section");
    card.className = "qd-tile";
    card.dataset.id = def.id;
    card.innerHTML = `<header class="qd-tile-head">
        <span class="qd-tile-grip" title="Seret untuk memindah" aria-hidden="true">${px(tiIcon("grip-vertical"), 14)}</span>
        ${def.icon ? `<span class="qd-tile-ic">${iconMarkup(def.icon)}</span>` : ""}
        <span class="qd-tile-title">${esc(def.title || def.id)}</span>
        <button type="button" class="qd-icon-btn qd-tile-close" title="Tutup tile" aria-label="Tutup tile ${esc(def.title || def.id)}">${px(tiIcon("x"), 15)}</button>
      </header><div class="qd-tile-body"></div>`;
    if (before && before.parentNode === ed.tilesEl) ed.tilesEl.insertBefore(card, before); else ed.tilesEl.appendChild(card);
    const body = $(card, ".qd-tile-body"), ctx = makeCtx(def.id);
    const m = { def, card, body, ctx };
    ed.mounted.set(def.id, m);
    $(card, ".qd-tile-close").addEventListener("click", () => {
      const states = tileStates(ed.story);
      const st = states.find((t) => t.id === def.id);
      if (st) st.on = false;
      unmountTile(def.id);
      setLayout(states);
      updatePanelEmpty();
    });
    try { def.render(body, ctx); } catch (e) { console.error("[Quill] tile " + def.id, e); body.textContent = "Tile ini gagal dimuat."; }
  }
  function unmountTile(id) {
    const m = ed && ed.mounted.get(id);
    if (!m) return;
    try { if (typeof m.def.destroy === "function") m.def.destroy(m.body); } catch (e) { console.error("[Quill] tile " + id, e); }
    m.ctx._dispose();
    m.card.remove();
    ed.mounted.delete(id);
  }
  function unmountTiles() { if (ed) Array.from(ed.mounted.keys()).forEach(unmountTile); }
  function mountTiles() {
    if (!ed) return;
    unmountTiles();
    tileStates(ed.story).forEach((st) => { if (!st.on) return; const def = reg.tiles.find((t) => t.id === st.id); if (def) mountTile(def); });
    updatePanelEmpty();
  }
  function updatePanelEmpty() {
    if (!ed) return;
    const panel = $(ed.scr, ".qd-panel");
    $(panel, ".qd-panel-empty").classList.toggle("hidden", reg.tools.length > 0 || reg.tiles.length > 0);
    $(panel, ".qd-tile-add").classList.toggle("hidden", reg.tiles.length === 0);
    $(panel, ".qd-ptab-empty").classList.toggle("hidden", !activeTab(ed.story) || reg.tiles.length === 0 || ed.mounted.size > 0);
    ed.toolsEl.classList.toggle("hidden", reg.tools.length === 0);
  }
  function openTileMenu(anchor) {
    const states = tileStates(ed.story);
    const off = states.filter((t) => !t.on && reg.tiles.some((d) => d.id === t.id));
    openMenu(anchor, off.length ? off.map((st) => {
      const def = reg.tiles.find((d) => d.id === st.id);
      return {
        icon: iconMarkup(def.icon) || tiIcon("plus"), label: def.title || def.id,
        onSelect: () => {
          if (!ed) return;
          const ss = tileStates(ed.story), me = ss.find((t) => t.id === st.id);
          me.on = true;
          // pasang di posisi urutannya (sebelum tile tampil berikutnya)
          const after = ss.slice(ss.indexOf(me) + 1).find((t) => t.on && ed.mounted.has(t.id));
          mountTile(def, after ? ed.mounted.get(after.id).card : null);
          setLayout(ss);
          updatePanelEmpty();
          const card = ed.mounted.get(def.id);
          if (card) card.card.scrollIntoView({ block: "nearest", behavior: reduceMotion() ? "auto" : "smooth" });
        },
      };
    }) : [{ note: "Semua tile sudah tampil" }]);
  }

  /* ---------- AUDIO (speechSynthesis) ---------- */
  const A = { on: false, paused: false, gen: 0, blocks: [], idx: 0, voices: [] };
  const synth = () => (typeof window.speechSynthesis !== "undefined" ? window.speechSynthesis : null);
  function ttsPrefs() { try { return JSON.parse(LS.get(K_TTS, "{}")) || {}; } catch (e) { return {}; } }
  function toggleAudioBar() {
    if (!ed) return;
    const bar = ed.audioEl, pill = $(ed.scr, '[data-pill="audio"]');
    if (!bar.classList.contains("hidden")) { stopAudio(); bar.classList.add("hidden"); pill.classList.remove("is-on"); return; }
    pill.classList.add("is-on");
    bar.classList.remove("hidden");
    if (!synth() || typeof window.SpeechSynthesisUtterance === "undefined") {
      bar.innerHTML = `<span class="qd-a-status is-warn">${px(tiIcon("alert-triangle"), 16)}Browser ini belum mendukung fitur suara (text-to-speech).</span><span class="qd-flex"></span>
        <button type="button" class="qd-icon-btn" data-act="a-close" title="Tutup" aria-label="Tutup audio">${px(tiIcon("x"), 16)}</button>`;
      return;
    }
    const pr = ttsPrefs();
    bar.innerHTML = `<button type="button" class="qd-icon-btn qd-a-play" data-act="a-play" title="Putar" aria-label="Putar">${px(tiIcon("player-play"), 18)}</button>
      <button type="button" class="qd-icon-btn" data-act="a-stop" title="Berhenti" aria-label="Berhenti">${px(tiIcon("player-stop"), 18)}</button>
      <select class="qd-sel qd-a-voice" aria-label="Suara" title="Suara"></select>
      <select class="qd-sel qd-a-rate" aria-label="Kecepatan" title="Kecepatan">${[0.75, 0.9, 1, 1.15, 1.3, 1.5, 1.75, 2].map((r) => `<option value="${r}"${(+pr.rate || 1) === r ? " selected" : ""}>${String(r).replace(".", ",")}×</option>`).join("")}</select>
      <span class="qd-a-status" aria-live="polite">Siap membacakan chapter ini</span><span class="qd-flex"></span>
      <button type="button" class="qd-icon-btn" data-act="a-close" title="Tutup" aria-label="Tutup audio">${px(tiIcon("x"), 16)}</button>`;
    fillVoices();
    const sy = synth();
    if (sy && !A.vcBound) { A.vcBound = true; try { sy.addEventListener("voiceschanged", fillVoices); } catch (e) { /* abaikan */ } }
    const save = () => LS.set(K_TTS, JSON.stringify({ voice: $(bar, ".qd-a-voice").value, rate: +$(bar, ".qd-a-rate").value }));
    $(bar, ".qd-a-voice").addEventListener("change", () => { save(); if (A.on) restartAudio(); });
    $(bar, ".qd-a-rate").addEventListener("change", () => { save(); if (A.on) restartAudio(); });
  }
  function fillVoices() {
    if (!ed) return;
    const sel = $(ed.audioEl, ".qd-a-voice");
    if (!sel) return;
    let vs = [];
    try { vs = synth().getVoices() || []; } catch (e) { vs = []; }
    const isId = (v) => /^id([-_]|$)/i.test(v.lang || "");
    vs = vs.slice().sort((a, b) => (isId(b) - isId(a)) || String(a.lang).localeCompare(String(b.lang)) || String(a.name).localeCompare(String(b.name)));
    A.voices = vs;
    const want = ttsPrefs().voice;
    const pick = vs.find((v) => v.voiceURI === want) || vs.find(isId) || vs.find((v) => v.default) || vs[0];
    sel.innerHTML = vs.length ? vs.map((v) => `<option value="${esc(v.voiceURI)}"${v === pick ? " selected" : ""}>${esc(v.name)} (${esc(v.lang)})</option>`).join("") : `<option value="">Suara bawaan (id-ID)</option>`;
  }
  function audioStatus(msg) { const s = ed && $(ed.audioEl, ".qd-a-status"); if (s) s.textContent = msg; }
  function setPlayIcon(playing) {
    const b = ed && $(ed.audioEl, ".qd-a-play");
    if (!b) return;
    b.innerHTML = playing ? px(tiIcon("player-pause"), 18) : px(tiIcon("player-play"), 18);
    b.title = playing ? "Jeda" : "Putar";
    b.setAttribute("aria-label", b.title);
  }
  function audioPlayPause() {
    const sy = synth();
    if (!sy || !ed) return;
    if (A.on && !A.paused) { sy.pause(); A.paused = true; setPlayIcon(false); audioStatus("Dijeda"); return; }
    if (A.on && A.paused) { sy.resume(); A.paused = false; setPlayIcon(true); audioStatus(`Membaca paragraf ${A.idx + 1} dari ${A.blocks.length}`); return; }
    syncEditor();
    A.blocks = $$(ed.bodyEl, "p, h1, h2, li, blockquote, div").filter((b) => !b.querySelector("p, h1, h2, li, div") && (b.textContent || "").trim());
    if (!A.blocks.length) { audioStatus("Chapter ini masih kosong."); return; }
    let start = 0;
    const blk = ed.range ? (ed.range.startContainer.nodeType === 1 ? ed.range.startContainer : ed.range.startContainer.parentNode) : null;
    if (blk) { const i = A.blocks.findIndex((b) => b === blk || b.contains(blk)); if (i > 0) start = i; }
    A.on = true; A.paused = false;
    setPlayIcon(true);
    speakBlock(start, ++A.gen);
  }
  function restartAudio() { const i = A.idx; const sy = synth(); A.gen++; try { sy.cancel(); } catch (e) { /* abaikan */ } A.paused = false; setPlayIcon(true); speakBlock(i, ++A.gen); }
  function speakBlock(i, g) {
    if (g !== A.gen || !ed) return;
    $$(ed.bodyEl, ".qd-reading").forEach((x) => x.classList.remove("qd-reading"));
    if (i >= A.blocks.length) { stopAudio("Selesai dibacakan"); return; }
    A.idx = i;
    const blk = A.blocks[i];
    if (!blk.isConnected) { speakBlock(i + 1, g); return; }
    blk.classList.add("qd-reading");
    blk.scrollIntoView({ block: "center", behavior: reduceMotion() ? "auto" : "smooth" });
    audioStatus(`Membaca paragraf ${i + 1} dari ${A.blocks.length}`);
    // potong per kalimat (±220 karakter) — Chrome kadang berhenti sendiri pada ucapan yang panjang
    const text = blk.textContent.replace(/\s+/g, " ").trim();
    const chunks = (text.match(/[^.!?…]+[.!?…]*["”’)]*\s*/g) || [text]).reduce((acc, sn) => {
      if (acc.length && (acc[acc.length - 1] + sn).length < 220) acc[acc.length - 1] += sn; else acc.push(sn);
      return acc;
    }, []);
    const voiceSel = $(ed.audioEl, ".qd-a-voice"), rateSel = $(ed.audioEl, ".qd-a-rate");
    const voice = voiceSel ? A.voices.find((v) => v.voiceURI === voiceSel.value) : null;
    const rate = rateSel ? +rateSel.value || 1 : 1;
    let k = 0;
    const next = () => {
      if (g !== A.gen) return;
      if (k >= chunks.length) { speakBlock(i + 1, g); return; }
      const u = new SpeechSynthesisUtterance(chunks[k++]);
      u.lang = voice && voice.lang ? voice.lang : "id-ID";
      if (voice) { try { u.voice = voice; } catch (e) { /* suara tidak valid: pakai bawaan sesuai bahasa */ } }
      u.rate = rate;
      u.onend = () => { if (g === A.gen) next(); };
      u.onerror = (e) => { if (g !== A.gen || e.error === "interrupted" || e.error === "canceled") return; stopAudio("Suara gagal diputar."); };
      try { synth().speak(u); } catch (e) { stopAudio("Suara gagal diputar."); }
    };
    next();
  }
  function stopAudio(msg) {
    const wasOn = A.on;
    A.gen++; A.on = false; A.paused = false;
    if (wasOn) { try { const sy = synth(); if (sy) sy.cancel(); } catch (e) { /* abaikan */ } }
    if (ed) {
      $$(ed.bodyEl, ".qd-reading").forEach((x) => x.classList.remove("qd-reading"));
      setPlayIcon(false);
      if (msg) audioStatus(msg);
    }
  }

  /* ============================ E. MODE BACA (Putar) ============================ */
  let reader = null;
  function readerContent(s) {
    return `<section class="qd-r-titlepage"><div class="qd-r-tp-title">${esc(storyTitle(s))}</div>${FLOURISH}${s.author ? `<div class="qd-r-tp-author">${esc(s.author)}</div>` : ""}</section>` +
      s.chapters.map((c, i) => {
        const label = chapterLabel(c, i);
        return `<section class="qd-r-ch" data-ch="${esc(c.id)}">
          ${isDefaultChTitle(label) ? `<div class="qd-r-num">${roman(i + 1)}</div>` : `<div class="qd-r-num">${roman(i + 1)}</div><h2 class="qd-r-title">${esc(label)}</h2>`}
          ${FLOURISH}
          ${c.header ? `<img class="qd-r-header" src="${esc(c.header)}" alt="">` : ""}
          <div class="qd-r-body">${sanitizeHtml(c.html) || '<p class="qd-r-empty">(Chapter ini masih kosong)</p>'}</div>
        </section>`;
      }).join("") + '<span class="qd-r-end"></span>';
  }
  function openReader(s, startId) {
    flush();
    stopAudio();
    closeReader();
    if (!s.chapters.length) { toast("Belum ada chapter untuk dibaca.", tiIcon("info-circle")); return; }
    const ov = document.createElement("div");
    ov.className = "qd-reader";
    ov.setAttribute("role", "dialog");
    ov.setAttribute("aria-modal", "true");
    ov.setAttribute("aria-label", "Mode baca: " + storyTitle(s));
    ov.innerHTML = `<div class="qd-r-top">
        <div class="qd-r-head"><span class="qd-r-story">${esc(storyTitle(s))}</span><span class="qd-r-chap"></span></div>
        <div class="qd-r-tools">
          <select class="qd-sel qd-r-toc" aria-label="Daftar isi" title="Daftar isi">${s.chapters.map((c, i) => `<option value="${esc(c.id)}">${roman(i + 1)}. ${esc(chapterLabel(c, i))}</option>`).join("")}</select>
          <button type="button" class="qd-icon-btn" data-act="r-smaller" title="Perkecil huruf" aria-label="Perkecil huruf">${px(tiIcon("text-decrease"), 18)}</button>
          <button type="button" class="qd-icon-btn" data-act="r-bigger" title="Perbesar huruf" aria-label="Perbesar huruf">${px(tiIcon("text-increase"), 18)}</button>
          <button type="button" class="qd-icon-btn" data-act="r-close" title="Tutup (Esc)" aria-label="Tutup mode baca">${px(tiIcon("x"), 18)}</button>
        </div>
      </div>
      <div class="qd-r-stage">
        <button type="button" class="qd-r-nav is-prev" data-act="r-prev" aria-label="Halaman sebelumnya">${px(tiIcon("chevron-left"), 24)}</button>
        <div class="qd-r-book"><div class="qd-r-view"><div class="qd-r-flow">${readerContent(s)}</div></div>
          <span class="qd-r-folio is-l"></span><span class="qd-r-folio is-r"></span></div>
        <button type="button" class="qd-r-nav is-next" data-act="r-next" aria-label="Halaman berikutnya">${px(tiIcon("chevron-right"), 24)}</button>
      </div>
      <div class="qd-r-bottom"><input type="range" class="qd-r-slider" min="0" max="0" value="0" aria-label="Posisi halaman"><span class="qd-r-count"></span></div>`;
    document.body.appendChild(ov);
    fireHook("reader", { story: s, el: ov, project: P });   // sebelum tata letak halaman: gaya dari modul lain ikut terhitung
    const prevFocus = document.activeElement;
    reader = { ov, s, spread: 0, spreads: 1, pages: 1, per: 2, step: 0, pitch: 0, starts: [], fs: clamp(+LS.get(K_RFS, "17") || 17, 13, 26), prevFocus };
    const onKey = (e) => {
      if (!reader) return;
      if (e.target && e.target.closest && e.target.closest("select") && /^Arrow/.test(e.key)) return;
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeReader(); }
      else if (["ArrowRight", "PageDown", " "].includes(e.key)) { e.preventDefault(); readerGo(reader.spread + 1); }
      else if (["ArrowLeft", "PageUp"].includes(e.key)) { e.preventDefault(); readerGo(reader.spread - 1); }
      else if (e.key === "Home") { e.preventDefault(); readerGo(0); }
      else if (e.key === "End") { e.preventDefault(); readerGo(reader.spreads - 1); }
    };
    let rt = 0;
    const onResize = () => { clearTimeout(rt); rt = setTimeout(() => readerLayout(true), 120); };
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", onResize);
    reader.off = () => { document.removeEventListener("keydown", onKey, true); window.removeEventListener("resize", onResize); clearTimeout(rt); };
    ov.addEventListener("click", (e) => {
      const t = e.target.closest("[data-act]");
      if (!t || !reader) return;
      const a = t.dataset.act;
      if (a === "r-close") closeReader();
      else if (a === "r-prev") readerGo(reader.spread - 1);
      else if (a === "r-next") readerGo(reader.spread + 1);
      else if (a === "r-smaller" || a === "r-bigger") { reader.fs = clamp(reader.fs + (a === "r-bigger" ? 1 : -1), 13, 26); LS.set(K_RFS, String(reader.fs)); readerLayout(true); }
    });
    $(ov, ".qd-r-toc").addEventListener("change", (e) => readerGoChapter(e.target.value));
    $(ov, ".qd-r-slider").addEventListener("input", (e) => readerGo(+e.target.value, false));
    // geser (swipe) di layar sentuh
    let sx = null;
    const book = $(ov, ".qd-r-book");
    book.addEventListener("pointerdown", (e) => { sx = { x: e.clientX, y: e.clientY }; });
    book.addEventListener("pointerup", (e) => {
      if (!sx || !reader) return;
      const dx = e.clientX - sx.x, dy = e.clientY - sx.y;
      sx = null;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) readerGo(reader.spread + (dx < 0 ? 1 : -1));
    });
    readerLayout(false);
    readerGoChapter(startId, false);
    requestAnimationFrame(() => ov.classList.add("is-in"));
    $(ov, '[data-act="r-close"]').focus({ preventScroll: true });
    // tunggu gambar & font selesai dimuat lalu hitung ulang halaman
    $$(ov, "img").forEach((im) => { if (!im.complete) im.addEventListener("load", () => readerLayout(true), { once: true }); });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => readerLayout(true));
  }
  function readerLayout(keep) {
    const r = reader;
    if (!r) return;
    const ov = r.ov, stage = $(ov, ".qd-r-stage"), book = $(ov, ".qd-r-book"), flow = $(ov, ".qd-r-flow");
    const frac = keep && r.spreads > 1 ? r.spread / (r.spreads - 1) : 0;
    const keepCh = keep ? readerChapterAt(r.spread) : null;
    const sw = stage.clientWidth, sh = stage.clientHeight;
    const nav = sw > 720 ? 56 : 0;
    const availW = Math.max(200, sw - nav * 2 - 8), availH = Math.max(240, sh - 8);
    const ratio = 0.68;
    const two = availW >= 860 && availW / availH > 1.1;
    let ph = availH, pw = Math.floor(ph * ratio);
    if (two && pw * 2 > availW) { pw = Math.floor(availW / 2); ph = Math.floor(pw / ratio); }
    if (!two && pw > availW) { pw = availW; ph = Math.min(availH, Math.floor(pw / 0.6)); }
    const pad = Math.max(20, Math.round(pw * 0.1)), padB = pad + 22;
    r.per = two ? 2 : 1;
    r.pitch = pw;
    r.step = pw * r.per;
    book.classList.toggle("is-two", two);
    book.style.width = pw * r.per + "px";
    book.style.height = ph + "px";
    flow.style.left = pad + "px";
    flow.style.top = pad + "px";
    flow.style.width = pw * r.per - 2 * pad + "px";
    flow.style.height = ph - pad - padB + "px";
    flow.style.columnCount = String(r.per);
    flow.style.columnGap = 2 * pad + "px";
    flow.style.fontSize = r.fs + "px";
    flow.style.setProperty("--rh", ph - pad - padB + "px");
    flow.style.transition = "none";
    flow.style.transform = "none";
    const fr = flow.getBoundingClientRect(), endR = $(flow, ".qd-r-end").getBoundingClientRect();
    r.pages = Math.max(1, Math.floor((endR.left - fr.left + 2) / r.pitch) + 1);
    r.spreads = Math.max(1, Math.ceil(r.pages / r.per));
    r.starts = $$(flow, ".qd-r-ch").map((sec) => { const rc = sec.getClientRects()[0]; return { id: sec.dataset.ch, page: rc ? Math.max(0, Math.round((rc.left - fr.left) / r.pitch)) : 0 }; });
    const sl = $(ov, ".qd-r-slider");
    sl.max = String(r.spreads - 1);
    sl.disabled = r.spreads < 2;
    if (keepCh && keep) {
      const st = r.starts.find((x) => x.id === keepCh.id);
      readerGo(st && frac === 0 ? Math.floor(st.page / r.per) : Math.round(frac * (r.spreads - 1)), false);
    } else readerGo(clamp(r.spread, 0, r.spreads - 1), false);
  }
  function readerChapterAt(spread) {
    const r = reader;
    if (!r || !r.starts.length) return null;
    const first = spread * r.per + (r.per - 1);   // halaman terakhir yang terlihat
    let cur = null;
    r.starts.forEach((st) => { if (st.page <= first) cur = st; });
    return cur || r.starts[0];
  }
  function readerGoChapter(id, animate) {
    const r = reader;
    if (!r) return;
    const st = r.starts.find((x) => x.id === id) || r.starts[0];
    readerGo(st ? Math.floor(st.page / r.per) : 0, animate);
  }
  function readerGo(n, animate) {
    const r = reader;
    if (!r) return;
    r.spread = clamp(n | 0, 0, r.spreads - 1);
    const ov = r.ov, flow = $(ov, ".qd-r-flow");
    flow.style.transition = animate === false || reduceMotion() ? "none" : "transform .45s cubic-bezier(.3,.7,.2,1)";
    flow.style.transform = `translateX(${-r.spread * r.step}px)`;
    const a = r.spread * r.per + 1, b = Math.min(r.pages, a + r.per - 1);
    $(ov, ".qd-r-folio.is-l").textContent = a > 1 ? a : "";
    $(ov, ".qd-r-folio.is-r").textContent = r.per === 2 && b > a ? b : "";
    $(ov, ".qd-r-count").textContent = r.per === 2 && b > a ? `Halaman ${a}–${b} dari ${r.pages}` : `Halaman ${a} dari ${r.pages}`;
    $(ov, ".qd-r-slider").value = String(r.spread);
    $(ov, '[data-act="r-prev"]').disabled = r.spread <= 0;
    $(ov, '[data-act="r-next"]').disabled = r.spread >= r.spreads - 1;
    const cur = readerChapterAt(r.spread);
    if (cur) {
      const i = r.s.chapters.findIndex((c) => c.id === cur.id);
      $(ov, ".qd-r-chap").textContent = i >= 0 ? " · " + chapterLabel(r.s.chapters[i], i) : "";
      $(ov, ".qd-r-toc").value = cur.id;
    }
  }
  function closeReader() {
    if (!reader) return;
    const r = reader;
    reader = null;
    r.off();
    r.ov.remove();
    if (r.prevFocus && r.prevFocus.isConnected) { try { r.prevFocus.focus({ preventScroll: true }); } catch (e) { /* abaikan */ } }
  }

  /* ============================ F. TERBITKAN ============================ */
  function manuscriptHtml(s) {
    return `<div class="qd-ms-title">${esc(storyTitle(s))}</div>${s.author ? `<div class="qd-ms-author">oleh ${esc(s.author)}</div>` : ""}${FLOURISH}` +
      s.chapters.map((c, i) => `<section class="qd-ms-ch"><div class="qd-ms-num">${roman(i + 1)}</div><h2 class="qd-ms-ch-title">${esc(chapterLabel(c, i))}</h2>
        ${c.header ? `<img class="qd-ms-header" src="${esc(c.header)}" alt="">` : ""}<div class="qd-ms-body">${sanitizeHtml(c.html) || '<p class="qd-muted">(kosong)</p>'}</div></section>`).join("");
  }
  function renderPublish() {
    const s = findStory(route.storyId), n = s.chapters.length, words = storyWords(s);
    const fromEditor = route.from === "editor";
    host.innerHTML = `<div class="qd-screen qd-publish">
      <div class="qd-topbar">${backBtn(fromEditor ? "Kembali ke editor" : "Kembali ke cerita")}</div>
      <div class="qd-pub-body">
        <div class="qd-pub-side">
          <div class="qd-stage qd-stage-sm" title="Seret untuk memutar buku">${bookHtml(s, "is-md")}</div>
          <h1 class="qd-story-title">${esc(storyTitle(s))}</h1>
          ${s.author ? `<div class="qd-byline">oleh ${esc(s.author)}</div>` : ""}
          <div class="qd-meta">${n} chapter · ${fmtNum(words)} kata · ±${Math.max(1, Math.round(words / 200))} menit baca</div>
          <div class="qd-pub-actions">
            <button type="button" class="qd-export" data-act="epub"${n ? "" : " disabled"}>${px(tiIcon("book-download"), 22)}<span><b>Unduh EPUB</b><small>Untuk e-reader & aplikasi buku (Apple Books, Google Play Buku, Kobo)</small></span></button>
            <button type="button" class="qd-export" data-act="doc"${n ? "" : " disabled"}>${px(tiIcon("file-word"), 22)}<span><b>Unduh Word (.doc)</b><small>Buka & sunting di Microsoft Word atau Google Docs</small></span></button>
            <button type="button" class="qd-export" data-act="html"${n ? "" : " disabled"}>${px(tiIcon("file-code"), 22)}<span><b>Unduh HTML</b><small>Satu file halaman web, siap dibagikan</small></span></button>
            <button type="button" class="qd-btn qd-btn-ghost" data-act="read"${n ? "" : " disabled"}>${px(tiIcon("player-play"), 16)}<span>Baca pratinjau</span></button>
          </div>
        </div>
        <div class="qd-pub-preview" aria-label="Pratinjau naskah">
          ${n ? `<div class="qd-paper">${manuscriptHtml(s)}</div>` : `<div class="qd-empty qd-empty-sm"><div class="qd-empty-icon">${px(tiIcon("file-text"), 22)}</div><div class="qd-empty-title">Belum ada chapter</div><div class="qd-empty-sub">Tulis minimal satu chapter untuk menerbitkan cerita ini.</div></div>`}
        </div>
      </div>
      ${pillbar("publish", ["write", "publish"])}
    </div>`;
    const scr = host.firstElementChild;
    attachTilt($(scr, ".qd-stage"));
    scr.addEventListener("click", (e) => {
      const t = e.target.closest("[data-act],[data-pill]");
      if (!t || t.disabled) return;
      const act = t.dataset.act || "pill-" + t.dataset.pill;
      if (act === "back") { if (fromEditor) go("editor", { storyId: s.id, chapterId: route.chapterId }); else go("story", { storyId: s.id }); }
      else if (act === "pill-write") go("editor", { storyId: s.id, chapterId: route.chapterId || (s.chapters[0] && s.chapters[0].id) });
      else if (act === "read") openReader(s, s.chapters[0] && s.chapters[0].id);
      else if (act === "epub" || act === "doc" || act === "html") runExport(act, s, t);
    });
  }
  function runExport(kind, s, btn) {
    flush();
    btn.classList.add("is-busy");
    btn.disabled = true;
    const job = kind === "epub" ? exportEpub(s) : kind === "doc" ? exportDoc(s) : exportHtml(s);
    Promise.resolve(job)
      .then(() => toast(kind === "epub" ? "EPUB berhasil diunduh" : kind === "doc" ? "File Word berhasil diunduh" : "File HTML berhasil diunduh", tiIcon("file-download")))
      .catch((e) => { console.error("[Quill] export", e); toast("Ekspor gagal: " + (e && e.message ? e.message : e), tiIcon("alert-triangle")); })
      .finally(() => { btn.classList.remove("is-busy"); btn.disabled = false; });
  }
  function download(blob, name) {
    const u = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = u; a.download = name; a.rel = "noopener";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 5000);
  }
  // sampul lengkap (warna + gambar + judul) digambar ke canvas — dipakai EPUB & HTML
  async function renderCover(s, W, H, type) {
    W = W || 1000; H = H || 1500;
    const b = s.book, cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const g = cv.getContext("2d");
    const cols = coverColors(b);
    if (cols.length === 1) g.fillStyle = cols[0];
    else {
      const a = 160 * Math.PI / 180, dx = Math.sin(a), dy = -Math.cos(a), L = Math.abs(W * dx) + Math.abs(H * dy);
      const gr = g.createLinearGradient(W / 2 - dx * L / 2, H / 2 - dy * L / 2, W / 2 + dx * L / 2, H / 2 + dy * L / 2);
      cols.forEach((c, i) => gr.addColorStop(i / (cols.length - 1), c));
      g.fillStyle = gr;
    }
    g.fillRect(0, 0, W, H);
    if (b.jacket) {
      try {
        const im = await loadImg(b.jacket);
        const sc = (b.jacketFit === "contain" ? Math.min : Math.max)(W / im.naturalWidth, H / im.naturalHeight);
        const w = im.naturalWidth * sc, h = im.naturalHeight * sc;
        g.drawImage(im, (W - w) / 2, (H - h) / 2, w, h);
      } catch (e) { /* gambar rusak: tetap warna polos */ }
    }
    const font = fontCss(b.titleFont), title = storyTitle(s);
    g.fillStyle = b.titleColor;
    g.textAlign = "center";
    g.textBaseline = "top";
    if (b.jacket) { g.shadowColor = "rgba(0,0,0,.55)"; g.shadowBlur = W * 0.02; }
    let size = Math.round(W * 0.095);
    const wrap = (text, maxW) => {
      const words = text.split(/\s+/), lines = [];
      let line = "";
      words.forEach((w) => { const t = line ? line + " " + w : w; if (g.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t; });
      if (line) lines.push(line);
      return lines;
    };
    let lines;
    for (;;) { g.font = `700 ${size}px ${font}`; lines = wrap(title, W * 0.8); if (lines.length <= 4 || size < W * 0.05) break; size = Math.round(size * 0.88); }
    lines.forEach((ln, i) => g.fillText(ln, W / 2, H * 0.14 + i * size * 1.18));
    if (b.showAuthor && (s.author || "").trim()) {
      g.font = `500 ${Math.round(W * 0.045)}px ${font}`;
      g.textBaseline = "bottom";
      g.fillText(s.author.trim(), W / 2, H * 0.9);
    }
    return cv.toDataURL(type || "image/jpeg", 0.9);
  }
  function dataUrlBytes(url) {
    const bin = atob(url.slice(url.indexOf(",") + 1));
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  }
  // gambar apa pun -> JPEG (PNG tetap PNG supaya transparansi aman) untuk e-reader yang belum mengenal WebP
  async function toEpubImage(src) {
    if (/^data:image\/(jpeg|png);/i.test(src)) return { bytes: dataUrlBytes(src), ext: /png/i.test(src.slice(0, 20)) ? "png" : "jpg" };
    const im = await loadImg(src);
    const cv = document.createElement("canvas");
    cv.width = im.naturalWidth; cv.height = im.naturalHeight;
    const g = cv.getContext("2d");
    g.fillStyle = "#ffffff"; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(im, 0, 0);
    return { bytes: dataUrlBytes(cv.toDataURL("image/jpeg", 0.88)), ext: "jpg" };
  }
  // ---- ZIP "store" (tanpa kompresi) + CRC32: cukup untuk EPUB (mimetype wajib tidak dikompres & paling depan) ----
  const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function zipStore(files, mime) {
    const enc = new TextEncoder(), parts = [], central = [];
    const d = new Date();
    const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const dosDate = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    let offset = 0;
    files.forEach((f) => {
      const name = enc.encode(f.name), data = typeof f.data === "string" ? enc.encode(f.data) : f.data, crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 10, true); lh.setUint16(6, 0, true); lh.setUint16(8, 0, true);
      lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true); lh.setUint32(14, crc, true);
      lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      parts.push(new Uint8Array(lh.buffer), name, data);
      const cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 10, true); cd.setUint16(8, 0, true); cd.setUint16(10, 0, true);
      cd.setUint16(12, dosTime, true); cd.setUint16(14, dosDate, true); cd.setUint32(16, crc, true);
      cd.setUint32(20, data.length, true); cd.setUint32(24, data.length, true); cd.setUint16(28, name.length, true);
      cd.setUint16(30, 0, true); cd.setUint16(32, 0, true); cd.setUint16(34, 0, true); cd.setUint16(36, 0, true); cd.setUint32(38, 0, true);
      cd.setUint32(42, offset, true);
      central.push(new Uint8Array(cd.buffer), name);
      offset += 30 + name.length + data.length;
    });
    const cdSize = central.reduce((a, b) => a + b.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(4, 0, true); end.setUint16(6, 0, true);
    end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true); end.setUint16(20, 0, true);
    return new Blob(parts.concat(central, [new Uint8Array(end.buffer)]), { type: mime || "application/zip" });
  }
  const xmlEsc = (s) => esc(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
  // UUID tetap per cerita (diturunkan dari id) supaya e-reader mengenali versi baru sebagai buku yang sama
  function storyUuid(id) {
    const h = (seed) => { let x = 2166136261 ^ seed; for (let i = 0; i < id.length; i++) { x ^= id.charCodeAt(i); x = Math.imul(x, 16777619); } return (x >>> 0).toString(16).padStart(8, "0"); };
    const hex = h(1) + h(2) + h(3) + h(4);
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${"89ab"[parseInt(hex[16], 16) & 3]}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  }
  // HTML (sudah disanitasi) -> XHTML well-formed; gambar data URL dipindah ke file images/*
  async function toXhtml(html, addImage) {
    const doc = document.implementation.createHTMLDocument("");
    doc.body.innerHTML = sanitizeHtml(html);
    for (const im of Array.from(doc.body.querySelectorAll("img"))) {
      const src = im.getAttribute("src") || "";
      if (/^data:image\//i.test(src)) {
        try { im.setAttribute("src", await addImage(src)); } catch (e) { im.remove(); }
      } else im.remove();   // gambar luar tidak ikut di EPUB (harus offline)
    }
    doc.body.querySelectorAll("hr.qd-break").forEach((hr) => hr.setAttribute("class", "scene-break"));
    doc.body.querySelectorAll("p").forEach((pp) => { if (!pp.firstChild) pp.remove(); });   // sisa <p> kosong dari nesting editor
    const xml = new XMLSerializer().serializeToString(doc.body);
    return xml.replace(/^<body[^>]*>/, "").replace(/<\/body>$/, "").replace(/<body[^>]*\/>$/, "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
  }
  const EPUB_CSS = `body{font-family:Georgia,"Times New Roman",serif;line-height:1.6;margin:0 5%;}
h1,h2{font-weight:normal;text-align:center;line-height:1.25;}
.ch-num{text-align:center;letter-spacing:.2em;margin:3em 0 .4em;font-size:.9em;color:#777;}
.ch-title{font-size:1.7em;margin:0 0 1.2em;}
.ch-header{text-align:center;margin:0 0 1.4em;} .ch-header img{max-width:100%;max-height:40vh;}
p{margin:0;text-indent:1.4em;text-align:justify;} h1+p,h2+p,.ch-header+p,hr+p,p:first-child{text-indent:0;}
blockquote{margin:1em 1.5em;font-style:italic;}
hr.scene-break{border:0;text-align:center;margin:1.4em 0;height:1.2em;} hr.scene-break:after{content:"\\2726 \\2726 \\2726";color:#888;}
img{max-width:100%;}
.titlepage{text-align:center;margin-top:30%;} .titlepage h1{font-size:2.2em;margin:0 0 .6em;} .titlepage .author{font-size:1.1em;color:#555;}
.cover{margin:0;padding:0;text-align:center;} .cover img{max-width:100%;max-height:100vh;}
nav ol{list-style:none;padding:0;} nav li{margin:.4em 0;}`;
  async function buildEpub(s) {
    const title = storyTitle(s), author = (s.author || "").trim() || userName(), uuid = storyUuid(s.id);
    const modified = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    const files = [{ name: "mimetype", data: "application/epub+zip" }];
    const manifest = [], images = [];
    let imgN = 0;
    const addImage = async (src) => {
      const { bytes, ext } = await toEpubImage(src);
      const name = `images/img-${++imgN}.${ext}`;
      images.push({ id: "img" + imgN, href: name, type: ext === "png" ? "image/png" : "image/jpeg", bytes });
      return name;
    };
    const page = (t, body, bodyCls) => `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="id" xml:lang="id">\n<head><meta charset="UTF-8"/><title>${xmlEsc(t)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>\n<body${bodyCls ? ` class="${bodyCls}"` : ""}>${body}</body>\n</html>\n`;
    files.push({ name: "META-INF/container.xml", data: `<?xml version="1.0" encoding="UTF-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>\n` });
    // sampul
    const coverBytes = dataUrlBytes(await renderCover(s, 1000, 1500, "image/jpeg"));
    files.push({ name: "OEBPS/images/cover.jpg", data: coverBytes });
    manifest.push(`<item id="cover-image" href="images/cover.jpg" media-type="image/jpeg" properties="cover-image"/>`);
    files.push({ name: "OEBPS/cover.xhtml", data: page("Sampul", `<section epub:type="cover" class="cover"><img src="images/cover.jpg" alt="${xmlEsc("Sampul: " + title)}"/></section>`, "cover") });
    manifest.push(`<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>`);
    files.push({ name: "OEBPS/title.xhtml", data: page(title, `<section epub:type="titlepage" class="titlepage"><h1>${xmlEsc(title)}</h1><p class="author">${xmlEsc(author)}</p></section>`) });
    manifest.push(`<item id="titlepage" href="title.xhtml" media-type="application/xhtml+xml"/>`);
    const chapters = [];
    for (let i = 0; i < s.chapters.length; i++) {
      const c = s.chapters[i], label = chapterLabel(c, i), href = `chapter-${i + 1}.xhtml`;
      let head = "";
      if (c.header) { try { head = `<div class="ch-header"><img src="${await addImage(c.header)}" alt=""/></div>`; } catch (e) { head = ""; } }
      const body = await toXhtml(c.html, addImage);
      files.push({ name: "OEBPS/" + href, data: page(label, `<section epub:type="chapter" class="chapter" id="ch${i + 1}"><p class="ch-num">${roman(i + 1)}</p><h1 class="ch-title">${xmlEsc(label)}</h1>${head}${body}</section>`) });
      manifest.push(`<item id="ch${i + 1}" href="${href}" media-type="application/xhtml+xml"/>`);
      chapters.push({ href, label, id: "ch" + (i + 1) });
    }
    images.forEach((im) => { files.push({ name: "OEBPS/" + im.href, data: im.bytes }); manifest.push(`<item id="${im.id}" href="${im.href}" media-type="${im.type}"/>`); });
    files.push({ name: "OEBPS/style.css", data: EPUB_CSS });
    files.push({ name: "OEBPS/nav.xhtml", data: page("Daftar Isi", `<nav epub:type="toc" id="toc"><h1>Daftar Isi</h1><ol>${chapters.map((c) => `<li><a href="${c.href}">${xmlEsc(c.label)}</a></li>`).join("")}</ol></nav><nav epub:type="landmarks" id="landmarks" hidden="hidden"><ol><li><a epub:type="cover" href="cover.xhtml">Sampul</a></li><li><a epub:type="bodymatter" href="${chapters[0].href}">Mulai membaca</a></li></ol></nav>`) });
    files.push({ name: "OEBPS/toc.ncx", data: `<?xml version="1.0" encoding="UTF-8"?>\n<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="urn:uuid:${uuid}"/><meta name="dtb:depth" content="1"/><meta name="dtb:totalPageCount" content="0"/><meta name="dtb:maxPageNumber" content="0"/></head><docTitle><text>${xmlEsc(title)}</text></docTitle><navMap>${chapters.map((c, i) => `<navPoint id="np${i + 1}" playOrder="${i + 1}"><navLabel><text>${xmlEsc(c.label)}</text></navLabel><content src="${c.href}"/></navPoint>`).join("")}</navMap></ncx>\n` });
    const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:${uuid}</dc:identifier>
    <dc:title>${xmlEsc(title)}</dc:title>
    <dc:creator>${xmlEsc(author)}</dc:creator>
    <dc:language>id</dc:language>
    <dc:publisher>Novelist</dc:publisher>
    <meta property="dcterms:modified">${modified}</meta>
    <meta name="cover" content="cover-image"/>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="css" href="style.css" media-type="text/css"/>
    ${manifest.join("\n    ")}
  </manifest>
  <spine toc="ncx">
    <itemref idref="cover" linear="yes"/>
    <itemref idref="titlepage"/>
    ${chapters.map((c) => `<itemref idref="${c.id}"/>`).join("\n    ")}
    <itemref idref="nav" linear="no"/>
  </spine>
</package>
`;
    files.push({ name: "OEBPS/content.opf", data: opf });
    // urutan: mimetype harus paling depan, sisanya bebas (META-INF dulu supaya rapi)
    const order = (n) => n === "mimetype" ? 0 : n.startsWith("META-INF/") ? 1 : n === "OEBPS/content.opf" ? 2 : 3;
    files.sort((a, b) => order(a.name) - order(b.name));
    return zipStore(files, "application/epub+zip");
  }
  async function exportEpub(s) { download(await buildEpub(s), safeName(storyTitle(s)) + ".epub"); }
  function exportDoc(s) {
    const title = storyTitle(s);
    const body = (html) => sanitizeHtml(html).replace(/<hr class="qd-break">/g, '<p style="text-align:center;color:#888;">&#10022; &#10022; &#10022;</p>');
    let html = `<div style="text-align:center;margin-top:160pt;"><h1 style="font-family:Georgia,serif;font-size:30pt;font-weight:normal;">${esc(title)}</h1>${s.author ? `<p style="font-family:Georgia,serif;font-size:14pt;color:#555;">oleh ${esc(s.author)}</p>` : ""}</div>`;
    s.chapters.forEach((c, i) => {
      html += `<br clear="all" style="page-break-before:always" /><p style="text-align:center;font-family:Georgia,serif;color:#888;letter-spacing:3pt;margin-top:40pt;">${roman(i + 1)}</p>`;
      html += `<h1 style="text-align:center;font-family:Georgia,serif;font-weight:normal;font-size:22pt;">${esc(chapterLabel(c, i))}</h1>`;
      if (c.header) html += `<p style="text-align:center;"><img src="${esc(c.header)}" style="max-width:100%;" width="560" alt=""></p>`;
      html += `<div style="font-family:Georgia,serif;font-size:12pt;line-height:1.6;">${body(c.html)}</div>`;
    });
    const pre = "<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'><head><meta charset='utf-8'><title>" + esc(title) + "</title><style>blockquote{margin:12pt 24pt;font-style:italic;} img{max-width:100%;}</style></head><body>";
    download(new Blob(["﻿", pre + html + "</body></html>"], { type: "application/msword" }), safeName(title) + ".doc");
  }
  async function exportHtml(s) {
    const title = storyTitle(s);
    let cover = "";
    try { cover = await renderCover(s, 800, 1200, "image/jpeg"); } catch (e) { cover = ""; }
    const toc = s.chapters.map((c, i) => `<li><a href="#ch${i + 1}"><span>${roman(i + 1)}</span>${esc(chapterLabel(c, i))}</a></li>`).join("");
    const chs = s.chapters.map((c, i) => `<section class="ch" id="ch${i + 1}"><p class="num">${roman(i + 1)}</p><h2>${esc(chapterLabel(c, i))}</h2>
      ${c.header ? `<img class="hdr" src="${esc(c.header)}" alt="">` : ""}${sanitizeHtml(c.html)}</section>`).join("\n");
    const doc = `<!DOCTYPE html>
<html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="generator" content="Novelist Quill">
<title>${esc(title)}</title>
<style>
:root{--bg:#f6f1e7;--text:#26221d;--dim:#7b7268;--line:#e0d6c4;}
@media (prefers-color-scheme:dark){:root{--bg:#141317;--text:#e9e4da;--dim:#9a9389;--line:#2c2a30;}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:18px/1.75 Georgia,"Times New Roman",serif;}
main{max-width:680px;margin:0 auto;padding:48px 22px 96px;}
.cover{display:block;width:min(320px,70vw);margin:24px auto 28px;border-radius:4px;box-shadow:0 20px 50px rgba(0,0,0,.35);}
h1{text-align:center;font-weight:normal;font-size:2.4em;line-height:1.2;margin:0 0 .2em;}.by{text-align:center;color:var(--dim);margin:0 0 2.4em;}
nav{border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:1em 0;margin-bottom:3em;}nav ol{list-style:none;margin:0;padding:0;}
nav a{color:inherit;text-decoration:none;display:flex;gap:.8em;padding:.25em 0;}nav a span{color:var(--dim);min-width:2.6em;text-align:right;}
.ch{margin-top:4em;}.num{text-align:center;color:var(--dim);letter-spacing:.25em;margin:0;}
h2{text-align:center;font-weight:normal;font-size:1.8em;margin:.2em 0 1.2em;}
.hdr{display:block;width:100%;max-height:420px;object-fit:cover;border-radius:6px;margin:0 0 1.6em;}
p{margin:0 0 .9em;}blockquote{margin:1.2em 1.6em;font-style:italic;color:var(--dim);}img{max-width:100%;}
hr.qd-break{border:0;text-align:center;height:1.4em;margin:1.6em 0;}hr.qd-break:after{content:"\\2726 \\2726 \\2726";color:var(--dim);}
footer{text-align:center;color:var(--dim);font-size:.8em;margin-top:5em;}
</style></head>
<body><main>
${cover ? `<img class="cover" src="${cover}" alt="Sampul ${esc(title)}">` : ""}
<h1>${esc(title)}</h1>${s.author ? `<p class="by">oleh ${esc(s.author)}</p>` : ""}
<nav aria-label="Daftar isi"><ol>${toc}</ol></nav>
${chs}
<footer>Ditulis dengan Novelist</footer>
</main></body></html>`;
    download(new Blob([doc], { type: "text/html;charset=utf-8" }), safeName(title) + ".html");
  }

  /* ============================ API PUBLIK ============================ */
  function show(opts) {
    if (opts) O = opts;
    if (!O || !O.project || !O.container) return;
    const projChanged = P !== O.project;
    if (visible && (projChanged || host !== O.container)) { flush(); hideInner(); }
    if (projChanged) route = routes.get(O.project.id) || { view: "library" };   // tiap project ingat layar terakhirnya
    P = O.project;
    host = O.container;
    ensureData(P);
    visible = true;
    host.classList.add("qd-host");
    render();
  }
  function hideInner() {
    teardownScreen();
    closeReader();
    stopAudio();
    if (P) routes.set(P.id, Object.assign({}, route));
    if (host) { host.innerHTML = ""; delete host.dataset.view; }
    visible = false;
    fireHook("screen", { view: null, story: null, el: null, project: P });
  }
  function hide() { if (!visible) return; flush(); hideInner(); }
  function flush() { if (ed) syncEditor(); }
  function validId(id) { return typeof id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(id) && id !== "layout"; }
  function registerTool(def) {
    if (!def || !validId(def.id) || typeof def.open !== "function") { console.error("[Quill] registerTool: butuh { id, label, icon, open(ctx) }"); return () => {}; }
    reg.tools = reg.tools.filter((t) => t.id !== def.id).concat([def]);
    renderTools();
    return () => unregisterTool(def.id);
  }
  function unregisterTool(id) { reg.tools = reg.tools.filter((t) => t.id !== id); renderTools(); }
  function registerTile(def) {
    if (!def || !validId(def.id) || typeof def.render !== "function") { console.error("[Quill] registerTile: butuh { id, title, icon, render(el, ctx) }"); return () => {}; }
    if (ed && ed.mounted.has(def.id)) unmountTile(def.id);
    reg.tiles = reg.tiles.filter((t) => t.id !== def.id).concat([def]);
    if (ed) {
      const states = tileStates(ed.story), st = states.find((t) => t.id === def.id);
      if (st && st.on) {
        const after = states.slice(states.indexOf(st) + 1).find((t) => t.on && ed.mounted.has(t.id));
        mountTile(def, after ? ed.mounted.get(after.id).card : null);
      }
      updatePanelEmpty();
    }
    return () => unregisterTile(def.id);
  }
  function unregisterTile(id) {
    if (ed) unmountTile(id);
    reg.tiles = reg.tiles.filter((t) => t.id !== id);
    updatePanelEmpty();
  }
  function getContext() { if (!ed) return null; const c = makeCtx(null); ed.ctxs.push(c); return c; }
  function refreshPanel() { if (ed) ed.mounted.forEach((m) => callUpdate(m, "refresh")); }

  window.NovelQuill = {
    version: 1,
    show, hide, flush,
    isOpen: () => visible,
    registerTool, unregisterTool, registerTile, unregisterTile,
    getContext, refreshPanel,
    on: onHook,
    openPanel: () => setPanelOpen(true),
    closePanel: () => setPanelOpen(false),
    togglePanel: () => setPanelOpen(!panelIsOpen()),
    // untuk pengujian & modul lain (bukan bagian API inti)
    _internal: { sanitizeHtml, buildEpub, roman, ensureData },
  };
  // Modul yang dimuat lebih dulu dari quill.js boleh menitip callback: (window.__novelQuillReady ||= []).push((api) => ...).
  // Setelah API siap juga dikirim event window "novelquill:ready" (detail = API).
  const pending = Array.isArray(window.__novelQuillReady) ? window.__novelQuillReady.splice(0) : [];
  window.__novelQuillReady = { push: (fn) => { try { fn(window.NovelQuill); } catch (e) { console.error("[Quill]", e); } return 0; } };
  pending.forEach((fn) => window.__novelQuillReady.push(fn));
  try { window.dispatchEvent(new CustomEvent("novelquill:ready", { detail: window.NovelQuill })); } catch (e) { /* abaikan */ }
})();
