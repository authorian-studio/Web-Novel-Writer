/* kodeks.js — KODEKS: wiki dunia cerita (menggantikan tab Organize; id tab tetap "organize").
   Dimuat sebelum app.js; semua fungsi app.js (getProject, el, markDirtyAndSchedule, ...) baru dipakai saat dipanggil.

   DATA (tetap di project.data.organize, jadi data Organize lama langsung terbaca & modul lain tetap jalan):
     organize[kind] = [{ id, title, content (HTML deskripsi/catatan — isi Organize lama),
                         fields?: { kunci: teks }   isian templat jenisnya
                         aliases?: "nama lain, panggilan"   ikut dicari di "Disebut di"
                         tags?: ["tag", ...], folder?: "nama folder", photo?: "data:image/..." }]
     kind = characters | locations | factions | items | creatures | cultures | magic | history | notes
       (characters / locations / notes = kunci Organize lama; array jenis baru baru dibuat saat entri pertama dibuat)
     organize.folders = { [kind]: ["nama folder", ...] }   urutan folder + folder yang masih kosong
   app.js tetap memegang currentOrgCat (jenis aktif) & currentOrgItemId (entri terpilih); switchOrganizeCat /
   renderOrganizeList / renderOrganizeDetail / syncOrganizeFromDetail di app.js meneruskan ke sini.
   Tampilan (daftar / galeri / tabel) disimpan di perangkat (localStorage), tidak memicu simpan ke Drive. */
(function () {
  "use strict";
  // ---------- jenis entri & templat isian ----------
  // f = [kunci, label, "t" (satu baris) | "a" (paragraf), placeholder?]; col = kunci yang tampil di tabel
  const KINDS = [
    { id: "characters", name: "Karakter", one: "Karakter", icon: "user", c: "#ec7fb0", col: ["role", "age", "occupation"], f: [
      ["role", "Peran", "t", "Protagonis, antagonis, mentor…"], ["age", "Usia", "t"], ["gender", "Gender", "t"],
      ["race", "Ras / spesies", "t"], ["occupation", "Pekerjaan / gelar", "t"], ["origin", "Asal", "t"],
      ["looks", "Penampilan", "a", "Ciri fisik, pakaian, kebiasaan yang terlihat…"], ["personality", "Kepribadian", "a"],
      ["goal", "Tujuan & motivasi", "a"], ["strengths", "Kekuatan & kelemahan", "a"], ["backstory", "Latar belakang", "a"],
    ] },
    { id: "locations", name: "Lokasi", one: "Lokasi", icon: "map-pin", c: "#5fc3a0", col: ["type", "region", "ruler"], f: [
      ["type", "Jenis", "t", "Kota, desa, hutan, istana…"], ["region", "Wilayah / berada di", "t"], ["climate", "Iklim", "t"],
      ["population", "Penduduk", "t"], ["ruler", "Penguasa", "t"],
      ["features", "Ciri khas", "a", "Pemandangan, bau, suara, bangunan penting…"], ["history", "Sejarah singkat", "a"],
    ] },
    { id: "factions", name: "Faksi", one: "Faksi", icon: "flag", c: "#f08a5d", col: ["type", "leader", "base"], f: [
      ["type", "Jenis", "t", "Kerajaan, guild, sekte, klan…"], ["leader", "Pemimpin", "t"], ["base", "Markas", "t"],
      ["members", "Anggota penting", "t"], ["allies", "Sekutu", "t"], ["enemies", "Musuh", "t"],
      ["goal", "Tujuan", "a"], ["ideology", "Ideologi & aturan", "a"],
    ] },
    { id: "items", name: "Benda", one: "Benda", icon: "sword", c: "#e3c27a", col: ["type", "owner", "origin"], f: [
      ["type", "Jenis", "t", "Senjata, artefak, dokumen…"], ["owner", "Pemilik", "t"], ["origin", "Asal / pembuat", "t"],
      ["looks", "Penampilan", "a"], ["power", "Fungsi & kekuatan", "a"],
    ] },
    { id: "creatures", name: "Makhluk", one: "Makhluk", icon: "dragon", c: "#9ccc65", col: ["class", "habitat", "size"], f: [
      ["class", "Klasifikasi", "t", "Binatang buas, roh, naga…"], ["habitat", "Habitat", "t"], ["size", "Ukuran", "t"],
      ["danger", "Tingkat bahaya", "t"], ["abilities", "Kemampuan", "a"], ["weakness", "Kelemahan", "a"], ["behavior", "Perilaku", "a"],
    ] },
    { id: "cultures", name: "Budaya/Agama", one: "Budaya/Agama", icon: "building-church", c: "#b58cff", col: ["type", "region", "deity"], f: [
      ["type", "Jenis", "t", "Agama, suku, tradisi…"], ["region", "Wilayah", "t"], ["deity", "Dewa / tokoh suci", "t"],
      ["followers", "Penganut", "t"], ["beliefs", "Kepercayaan", "a"], ["rituals", "Ritual & tradisi", "a"],
      ["taboos", "Pantangan", "a"],
    ] },
    { id: "magic", name: "Sistem Sihir", one: "Sistem Sihir", icon: "wand", c: "#6aa8ff", col: ["source", "users"], f: [
      ["source", "Sumber kekuatan", "t", "Mana, roh, darah, bintang…"], ["users", "Pengguna", "t"],
      ["rules", "Aturan", "a"], ["cost", "Batasan & harga", "a"], ["levels", "Tingkatan", "a"],
    ] },
    { id: "history", name: "Sejarah", one: "Peristiwa", icon: "hourglass", c: "#d9a066", col: ["era", "place"], f: [
      ["era", "Era / tanggal", "t", "Tahun 312 Kalender Bulan…"], ["place", "Tempat", "t"], ["people", "Tokoh terlibat", "t"],
      ["summary", "Ringkasan", "a"], ["impact", "Dampak", "a"],
    ] },
    { id: "notes", name: "Catatan", one: "Catatan", icon: "notes", c: "#f2d16b", col: ["category"], f: [
      ["category", "Kategori", "t", "Riset, ide, aturan dunia…"],
    ] },
  ];
  // nama ikon ditulis lengkap supaya terdeteksi tools/build-icons.mjs (helper ic() tidak dipindai):
  // #ti-at #ti-books #ti-category #ti-chevron-right #ti-chevron-up #ti-chevron-down #ti-file-text #ti-files #ti-folder
  // #ti-folder-open #ti-folder-plus #ti-list-details #ti-mood-sad #ti-pencil #ti-photo-plus #ti-plus #ti-search #ti-tag
  // #ti-trash #ti-x #ti-bookmark #ti-layout-list #ti-layout-grid #ti-table
  // tiIcon("user") tiIcon("map-pin") tiIcon("flag") tiIcon("sword") tiIcon("dragon") tiIcon("building-church") tiIcon("wand") tiIcon("hourglass") tiIcon("notes")
  const K = {};
  KINDS.forEach((k) => { K[k.id] = k; k.fmap = {}; k.f.forEach((f) => { k.fmap[f[0]] = f; }); });
  const VIEWS = [["list", "Daftar", "layout-list"], ["gallery", "Galeri", "layout-grid"], ["table", "Tabel", "table"]];
  const PHOTO_PX = 520, MAX_PHOTO = 450000;
  const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const ic = (name, px) => tiPx(tiIcon(name), px || 16);
  const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* abaikan */ } },
  };

  // ---------- state tampilan (bukan data project) ----------
  const st = {
    all: false,                     // "Semua jenis"
    view: (VIEWS.some((v) => v[0] === store.get("novelist_kodeks_view")) && store.get("novelist_kodeks_view")) || "list",
    q: "", tag: "", folder: "",     // folder: "" = semua, "\u0000" = tanpa folder
    sort: { key: "title", dir: 1 },
    closed: new Set(),              // folder yang dilipat (kind + "\u0001" + nama)
    projectId: null,
  };
  let root = null, dom = null, detailFor = null, dragId = null;

  // ---------- akses data ----------
  const proj = () => (typeof currentProjectId !== "undefined" && currentProjectId ? getProject(currentProjectId) : null);
  function org(p, create) {
    p = p || proj();
    if (!p) return null;
    if (!isObj(p.data.organize)) { if (!create) return {}; p.data.organize = { characters: [], locations: [], notes: [] }; }
    return p.data.organize;
  }
  function arr(kind, create, p) {
    const o = org(p, create);
    if (!o) return [];
    if (Array.isArray(o[kind])) return o[kind];
    if (!create) return [];
    return (o[kind] = []);
  }
  const entries = (kind, p) => arr(kind, false, p).filter((x) => isObj(x) && typeof x.id === "string");
  function find(kind, id, p) { return id ? entries(kind, p).find((x) => x.id === id) || null : null; }
  function findAny(id, p) {
    for (const k of KINDS) { const x = find(k.id, id, p); if (x) return { kind: k.id, item: x }; }
    return null;
  }
  const tagsOf = (it) => (Array.isArray(it.tags) ? it.tags.filter((t) => typeof t === "string" && t.trim()) : []);
  const folderOf = (it) => (typeof it.folder === "string" ? it.folder.trim() : "");
  const fieldsOf = (it) => (isObj(it.fields) ? it.fields : {});
  const aliasesOf = (it) => String(typeof it.aliases === "string" ? it.aliases : "").split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
  function foldersOf(kind) {
    const o = org(), saved = isObj(o.folders) && Array.isArray(o.folders[kind]) ? o.folders[kind].filter((s) => typeof s === "string" && s.trim()) : [];
    const out = saved.map((s) => s.trim());
    entries(kind).forEach((it) => { const f = folderOf(it); if (f && !out.includes(f)) out.push(f); });
    return out;
  }
  function saveFolders(kind, list) {
    const o = org(null, true);
    if (!isObj(o.folders)) o.folders = {};
    o.folders[kind] = list.slice();
  }
  const textCache = new WeakMap();
  const htmlText = (html) => {
    const s = String(html || "");
    if (!s) return "";
    const d = document.createElement("div");
    d.innerHTML = s.replace(/<(br|\/p|\/div|\/h\d|\/li)\b[^>]*>/gi, "$& ");
    return (d.textContent || "").replace(/\s+/g, " ").trim();
  };
  function plainOf(obj, key) {
    const html = typeof obj[key] === "string" ? obj[key] : "";
    let c = textCache.get(obj);
    if (!c || c.html !== html) { c = { html, text: htmlText(html) }; textCache.set(obj, c); }
    return c.text;
  }
  function summaryOf(kind, it) {
    const f = fieldsOf(it), k = K[kind];
    for (const d of k.f) { const v = String(f[d[0]] || "").trim(); if (v && d[2] === "a") return v; }
    return plainOf(it, "content");
  }
  function subOf(kind, it) {
    const f = fieldsOf(it), k = K[kind];
    return k.col.map((c) => String(f[c] || "").trim()).filter(Boolean).slice(0, 2).join(" · ");
  }
  // foto tokoh dari Jejaring Tokoh (kartu yang tertaut ke karakter) — cadangan bila entri belum punya foto
  function jjPhotos(p) {
    const out = new Map(), d = p && p.data;
    const docs = d && isObj(d.jejaring) && Array.isArray(d.jejaring.docs) ? d.jejaring.docs : [];
    docs.forEach((x) => (isObj(x) && Array.isArray(x.sheets) ? x.sheets : []).forEach((s) => (isObj(s) && Array.isArray(s.nodes) ? s.nodes : []).forEach((n) => {
      if (isObj(n) && n.t === "person" && typeof n.charId === "string" && typeof n.photo === "string" && /^data:image\//.test(n.photo) && !out.has(n.charId)) out.set(n.charId, n.photo);
    })));
    return out;
  }
  let photoMap = new Map();
  const photoOf = (kind, it) => (typeof it.photo === "string" && /^(data:image\/|https:)/.test(it.photo) ? it.photo : kind === "characters" ? photoMap.get(it.id) || "" : "");
  const safeUrl = (u) => String(u).replace(/["'()\\\s]/g, (c) => encodeURIComponent(c));

  // ---------- "Disebut di": scene (Tulis) & chapter (Quill) yang menyebut nama / nama lain entri ----------
  function sources(p) {
    const out = [], d = p.data || {};
    const walk = (list, path) => (Array.isArray(list) ? list : []).forEach((n) => {
      if (!isObj(n)) return;
      if (n.type === "folder") walk(n.children, path.concat(String(n.title || "").trim() || "Bab"));
      else out.push({ type: "scene", id: n.id, obj: n, key: "content", where: path.join(" › "), title: String(n.title || "").trim() || "Scene" });
    });
    walk(d.scenes, []);
    const stories = isObj(d.quill) && Array.isArray(d.quill.stories) ? d.quill.stories : [];
    stories.forEach((s) => (isObj(s) && Array.isArray(s.chapters) ? s.chapters : []).forEach((c, i) => {
      if (isObj(c)) out.push({ type: "chapter", id: c.id, obj: c, key: "html", where: "Quill › " + (String(s.title || "").trim() || "Cerita"), title: String(c.title || "").trim() || "Chapter " + (i + 1) });
    }));
    return out;
  }
  let mx = null;   // { sig, re, byKey }
  function matcher(p) {
    const byKey = new Map();
    KINDS.forEach((k) => entries(k.id, p).forEach((it) => {
      [String(it.title || "")].concat(aliasesOf(it)).forEach((n) => {
        const key = norm(n);
        if (key.length < 2) return;
        if (!byKey.has(key)) byKey.set(key, new Set());
        byKey.get(key).add(it.id);
      });
    }));
    const keys = Array.from(byKey.keys()).sort((a, b) => b.length - a.length);
    const sig = keys.map((k) => k + "\u0001" + Array.from(byKey.get(k)).join(",")).join("\u0002");
    if (mx && mx.sig === sig) return mx;
    let re = null;
    if (keys.length) {
      const alts = keys.map((k) => k.split(" ").map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+")).join("|");
      try { re = new RegExp("(^|[^\\p{L}\\p{N}_])(" + alts + ")(?=[^\\p{L}\\p{N}_]|$)", "giu"); }
      catch (e) { try { re = new RegExp("(^|[^\\w])(" + alts + ")(?=[^\\w]|$)", "gi"); } catch (e2) { re = null; } }
    }
    mx = { sig, re, byKey, hits: new WeakMap() };
    return mx;
  }
  // hasil per sumber di-cache selama teks & daftar nama tidak berubah
  function hitsIn(src, m) {
    const text = plainOf(src.obj, src.key);
    let c = m.hits.get(src.obj);
    if (c && c.text === text) return c.map;
    const map = new Map();
    if (m.re && text) {
      m.re.lastIndex = 0;
      let r;
      while ((r = m.re.exec(text))) {
        const ids = m.byKey.get(norm(r[2]));
        const at = r.index + r[1].length;
        if (ids) ids.forEach((id) => { const h = map.get(id); if (h) h.n++; else map.set(id, { n: 1, at, len: r[2].length }); });
        if (!r[0].length) m.re.lastIndex++;
      }
    }
    m.hits.set(src.obj, { text, map });
    return map;
  }
  // { id -> [{ src, n, snip }] }
  function mentionIndex(p) {
    const m = matcher(p), out = new Map();
    sources(p).forEach((src) => hitsIn(src, m).forEach((h, id) => {
      if (!out.has(id)) out.set(id, []);
      out.get(id).push({ src, n: h.n, at: h.at, len: h.len });
    }));
    return out;
  }
  function snippet(src, at, len) {
    const t = plainOf(src.obj, src.key), a = Math.max(0, at - 50), b = Math.min(t.length, at + len + 60);
    return (a > 0 ? "…" : "") + esc(t.slice(a, at)) + "<mark>" + esc(t.slice(at, at + len)) + "</mark>" + esc(t.slice(at + len, b)) + (b < t.length ? "…" : "");
  }

  // ---------- filter ----------
  function matchesQ(kind, it, q) {
    if (!q) return true;
    const f = fieldsOf(it);
    const hay = [it.title, it.aliases, folderOf(it), tagsOf(it).join(" "), Object.keys(f).map((k) => f[k]).join(" "), plainOf(it, "content")].map(norm).join(" \u0001 ");
    return q.split(" ").every((w) => hay.includes(w));
  }
  function visible(kind) {
    const q = norm(st.q);
    return entries(kind).filter((it) => matchesQ(kind, it, q)
      && (!st.tag || tagsOf(it).includes(st.tag))
      && (!st.folder || (st.folder === "\u0000" ? !folderOf(it) : folderOf(it) === st.folder)));
  }
  const scopeKinds = () => (st.all ? KINDS.map((k) => k.id) : [currentOrgCat]);
  function rows() {   // [{ kind, it }]
    const out = [];
    scopeKinds().forEach((kind) => visible(kind).forEach((it) => out.push({ kind, it })));
    return out;
  }

  // ---------- kerangka ----------
  function build() {
    root = el("kodeksRoot");
    if (!root) return false;
    if (dom && dom.root === root) return true;
    root.innerHTML = `
      <nav class="kx-nav" aria-label="Jenis entri Kodeks">
        <div class="kx-brand">${ic("books", 18)}<div><b>Kodeks</b><span>Wiki dunia cerita</span></div></div>
        <div class="kx-kinds" role="list"></div>
      </nav>
      <section class="kx-main">
        <header class="kx-bar">
          <div class="kx-head">
            <span class="kx-head-ic"></span>
            <h2 class="kx-head-title"></h2>
            <span class="kx-head-count"></span>
          </div>
          <label class="kx-search">${ic("search", 15)}<input type="search" placeholder="Cari nama, isian, tag…" aria-label="Cari di Kodeks" autocomplete="off" spellcheck="false"></label>
          <div class="kx-filters">
            <label class="kx-select" title="Saring folder">${ic("folder", 14)}<select data-f="folder" aria-label="Saring folder"></select></label>
            <label class="kx-select" title="Saring tag">${ic("tag", 14)}<select data-f="tag" aria-label="Saring tag"></select></label>
            <div class="kx-views" role="radiogroup" aria-label="Tampilan">${VIEWS.map(([v, l, i]) => `<button type="button" role="radio" class="kx-view" data-view="${v}" title="${l}" aria-label="${l}">${ic(i, 16)}<span>${l}</span></button>`).join("")}</div>
            <button type="button" class="kx-btn kx-btn-soft" data-act="newfolder" title="Folder baru">${ic("folder-plus", 16)}<span>Folder</span></button>
            <button type="button" class="kx-btn kx-btn-accent" data-act="new">${ic("plus", 16)}<span class="kx-new-label">Entri</span></button>
          </div>
        </header>
        <div class="kx-body">
          <div class="kx-coll" data-ns-scroll></div>
          <aside class="kx-detail" data-ns-scroll aria-label="Entri Kodeks"></aside>
        </div>
      </section>
      <input type="file" accept="image/*" class="kx-file" hidden>`;
    const $ = (s) => root.querySelector(s);
    dom = { root, kinds: $(".kx-kinds"), headIc: $(".kx-head-ic"), headTitle: $(".kx-head-title"), headCount: $(".kx-head-count"),
      search: $(".kx-search input"), folderSel: $('[data-f="folder"]'), tagSel: $('[data-f="tag"]'), body: $(".kx-body"),
      coll: $(".kx-coll"), detail: $(".kx-detail"), file: $(".kx-file"), newLabel: $(".kx-new-label") };
    dom.search.addEventListener("input", () => { st.q = dom.search.value; renderList(); });
    dom.folderSel.addEventListener("change", () => { st.folder = dom.folderSel.value; renderList(); });
    dom.tagSel.addEventListener("change", () => { st.tag = dom.tagSel.value; renderList(); });
    root.addEventListener("click", onRootClick);
    dom.kinds.addEventListener("click", (e) => {
      const b = e.target.closest("[data-kind]");
      if (!b) return;
      if (b.dataset.kind === "all") { sync(); st.all = true; st.folder = ""; st.tag = ""; renderList(); return; }
      st.all = false; st.folder = ""; st.tag = "";
      if (b.dataset.kind === currentOrgCat) { renderList(); return; }
      switchOrganizeCat(b.dataset.kind);
    });
    dom.file.addEventListener("change", () => {
      const f = dom.file.files && dom.file.files[0];
      dom.file.value = "";
      if (f && detailFor) setPhoto(detailFor.kind, detailFor.id, f);
    });
    bindCollection();
    return true;
  }

  function onRootClick(e) {
    const v = e.target.closest(".kx-view");
    if (v) { setView(v.dataset.view); return; }
    const b = e.target.closest("[data-act]");
    if (!b || !root.contains(b)) return;
    if (b.dataset.act === "new") newEntry(currentOrgCat);
    else if (b.dataset.act === "newfolder") newFolder();
  }
  function setView(v) {
    if (!VIEWS.some((x) => x[0] === v) || st.view === v) return;
    sync();
    st.view = v;
    store.set("novelist_kodeks_view", v);
    renderList(); renderDetail();
  }

  // ---------- render ----------
  function render() {
    if (!build()) return;
    const p = proj();
    if (!p) return;
    if (st.projectId !== p.id) { st.projectId = p.id; st.q = ""; st.tag = ""; st.folder = ""; st.all = false; dom.search.value = ""; detailFor = null; }
    if (!K[currentOrgCat]) currentOrgCat = "characters";
    renderList(); renderDetail();
  }
  function renderNav() {
    const q = norm(st.q);
    let total = 0;
    const counts = KINDS.map((k) => { const n = q ? entries(k.id).filter((it) => matchesQ(k.id, it, q)).length : entries(k.id).length; total += n; return n; });
    dom.kinds.innerHTML = `<button type="button" role="listitem" class="kx-kind${st.all ? " is-on" : ""}" data-kind="all" style="--kc:var(--accent)">
        <span class="kx-kind-ic">${ic("category", 16)}</span><span class="kx-kind-name">Semua</span><span class="kx-kind-n">${total}</span></button>` +
      KINDS.map((k, i) => `<button type="button" role="listitem" class="kx-kind${!st.all && currentOrgCat === k.id ? " is-on" : ""}" data-kind="${k.id}" style="--kc:${k.c}">
        <span class="kx-kind-ic">${ic(k.icon, 16)}</span><span class="kx-kind-name">${k.name}</span><span class="kx-kind-n">${counts[i] || ""}</span></button>`).join("");
  }
  function renderBar() {
    const k = K[currentOrgCat];
    dom.root.style.setProperty("--kc", st.all ? "var(--accent)" : k.c);
    dom.headIc.innerHTML = ic(st.all ? "category" : k.icon, 18);
    dom.headTitle.textContent = st.all ? "Semua entri" : k.name;
    dom.newLabel.textContent = k.one;
    dom.root.querySelector('[data-act="new"]').title = "Entri " + k.one + " baru";
    dom.root.querySelector('[data-act="newfolder"]').hidden = st.all;
    dom.root.querySelectorAll(".kx-view").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.view === st.view)));
    // folder & tag yang ada di cakupan ini
    const folders = st.all ? [] : foldersOf(currentOrgCat), tags = new Set();
    scopeKinds().forEach((kind) => entries(kind).forEach((it) => tagsOf(it).forEach((t) => tags.add(t))));
    if (st.folder && st.folder !== "\u0000" && !folders.includes(st.folder)) st.folder = "";
    if (st.tag && !tags.has(st.tag)) st.tag = "";
    dom.folderSel.parentElement.hidden = st.all || !folders.length;
    if (st.all) st.folder = "";
    dom.folderSel.innerHTML = `<option value="">Semua folder</option><option value="\u0000">Tanpa folder</option>` + folders.map((f) => `<option value="${esc(f)}">${esc(f)}</option>`).join("");
    dom.folderSel.value = st.folder;
    const tl = Array.from(tags).sort((a, b) => a.localeCompare(b, "id"));
    dom.tagSel.parentElement.hidden = !tl.length;
    dom.tagSel.innerHTML = `<option value="">Semua tag</option>` + tl.map((t) => `<option value="${esc(t)}">#${esc(t)}</option>`).join("");
    dom.tagSel.value = st.tag;
  }
  function renderList() {
    if (!dom) return;
    const p = proj();
    if (!p) return;
    photoMap = jjPhotos(p);
    renderNav(); renderBar();
    const list = rows();
    dom.headCount.textContent = list.length + " entri";
    dom.body.dataset.view = st.view;
    dom.body.classList.toggle("has-sel", !!find(currentOrgCat, currentOrgItemId));
    const scrollTop = dom.coll.scrollTop;
    if (st.view === "gallery") dom.coll.innerHTML = galleryHtml(list);
    else if (st.view === "table") dom.coll.innerHTML = tableHtml(list, p);
    else dom.coll.innerHTML = listHtml(list);
    dom.coll.scrollTop = scrollTop;
  }
  const thumb = (kind, it, cls) => {
    const ph = photoOf(kind, it), k = K[kind];
    return ph ? `<span class="${cls}" style="background-image:url('${safeUrl(ph)}')"></span>`
      : `<span class="${cls} is-empty" style="--kc:${k.c}">${String(it.title || "").trim() ? esc(String(it.title).trim().charAt(0).toUpperCase()) : ic(k.icon, 14)}</span>`;
  };
  const kindChip = (kind) => `<span class="kx-kchip" style="--kc:${K[kind].c}">${ic(K[kind].icon, 12)}${K[kind].name}</span>`;
  const tagChips = (it, max) => { const t = tagsOf(it); return t.length ? `<span class="kx-tags">${t.slice(0, max || 3).map((x) => `<span class="kx-tag">#${esc(x)}</span>`).join("")}${t.length > (max || 3) ? `<span class="kx-tag is-more">+${t.length - (max || 3)}</span>` : ""}</span>` : ""; };
  const emptyHtml = () => {
    const k = K[currentOrgCat], filtered = st.q || st.tag || st.folder;
    if (filtered) return `<div class="kx-empty">${ic("mood-sad", 28)}<p>Tidak ada entri yang cocok.</p></div>`;
    if (st.all) return `<div class="kx-empty">${ic("books", 30)}<p>Kodeks masih kosong.</p><small>Pilih jenis di kiri lalu buat entri pertama — karakter, lokasi, faksi, sihir, sejarah…</small></div>`;
    return `<div class="kx-empty" style="--kc:${k.c}">${ic(k.icon, 30)}<p>Belum ada entri ${esc(k.name)}.</p><button type="button" class="kx-btn kx-btn-accent" data-act="new">${ic("plus", 16)}<span>Buat ${esc(k.one)}</span></button></div>`;
  };
  function rowHtml(kind, it) {
    const sub = subOf(kind, it) || summaryOf(kind, it).slice(0, 90);
    return `<div class="kx-row${kind === currentOrgCat && it.id === currentOrgItemId ? " is-on" : ""}" role="listitem" draggable="true" data-id="${esc(it.id)}" data-kind="${kind}" tabindex="0">
      ${thumb(kind, it, "kx-row-ph")}
      <span class="kx-row-main"><span class="kx-row-title">${esc(String(it.title || "").trim() || "(tanpa judul)")}</span>${sub ? `<span class="kx-row-sub">${esc(sub)}</span>` : ""}</span>
      ${st.all ? kindChip(kind) : tagChips(it, 1)}
      <button type="button" class="kx-icon-btn kx-row-del" data-x="del" title="Hapus" aria-label="Hapus ${esc(it.title || "entri")}">${ic("trash", 14)}</button>
    </div>`;
  }
  function listHtml(list) {
    if (!list.length) return emptyHtml();
    if (st.all) {
      return KINDS.map((k) => {
        const items = list.filter((r) => r.kind === k.id);
        if (!items.length) return "";
        return `<div class="kx-group"><div class="kx-group-head is-kind" style="--kc:${k.c}">${ic(k.icon, 14)}<span>${k.name}</span><b>${items.length}</b></div><div class="kx-group-body" role="list">${items.map((r) => rowHtml(r.kind, r.it)).join("")}</div></div>`;
      }).join("");
    }
    const kind = currentOrgCat, folders = foldersOf(kind), filtered = !!(st.q || st.tag || st.folder);
    let html = "";
    folders.forEach((f) => {
      const items = list.filter((r) => folderOf(r.it) === f);
      if (filtered && !items.length) return;
      const key = kind + "\u0001" + f, closed = st.closed.has(key) && !st.q;
      html += `<div class="kx-group${closed ? " is-closed" : ""}" data-folder="${esc(f)}">
        <div class="kx-group-head is-folder" data-x="fold" data-drop="${esc(f)}">
          <span class="kx-caret">${ic("chevron-right", 13)}</span>${ic(closed ? "folder" : "folder-open", 15)}<span class="kx-group-name">${esc(f)}</span><b>${items.length}</b>
          <span class="kx-group-acts"><button type="button" class="kx-icon-btn" data-x="renfolder" title="Ganti nama folder" aria-label="Ganti nama folder">${ic("pencil", 13)}</button><button type="button" class="kx-icon-btn" data-x="delfolder" title="Hapus folder" aria-label="Hapus folder">${ic("trash", 13)}</button></span>
        </div>
        <div class="kx-group-body" role="list">${closed ? "" : items.map((r) => rowHtml(r.kind, r.it)).join("") || '<div class="kx-group-empty">Seret entri ke sini</div>'}</div></div>`;
    });
    const loose = list.filter((r) => !folderOf(r.it));
    if (loose.length || !folders.length) html += `<div class="kx-group is-loose">${folders.length ? `<div class="kx-group-head is-loose" data-drop="">${ic("files", 14)}<span class="kx-group-name">Tanpa folder</span><b>${loose.length}</b></div>` : ""}<div class="kx-group-body" role="list">${loose.map((r) => rowHtml(r.kind, r.it)).join("")}</div></div>`;
    return html;
  }
  function galleryHtml(list) {
    if (!list.length) return emptyHtml();
    return `<div class="kx-gallery" role="list">${list.map(({ kind, it }) => {
      const sub = subOf(kind, it), sum = summaryOf(kind, it).slice(0, 140), f = folderOf(it);
      return `<button type="button" class="kx-card${kind === currentOrgCat && it.id === currentOrgItemId ? " is-on" : ""}" role="listitem" data-id="${esc(it.id)}" data-kind="${kind}" style="--kc:${K[kind].c}">
        ${thumb(kind, it, "kx-card-ph")}
        <span class="kx-card-body">
          <span class="kx-card-top">${st.all ? kindChip(kind) : f ? `<span class="kx-card-folder">${ic("folder", 12)}${esc(f)}</span>` : ""}</span>
          <span class="kx-card-title">${esc(String(it.title || "").trim() || "(tanpa judul)")}</span>
          ${sub ? `<span class="kx-card-sub">${esc(sub)}</span>` : ""}
          ${sum ? `<span class="kx-card-sum">${esc(sum)}</span>` : ""}
          ${tagChips(it, 3)}
        </span></button>`;
    }).join("")}</div>`;
  }
  function tableCols() {
    if (st.all) return [["kind", "Jenis"], ["folder", "Folder"], ["tags", "Tag"], ["mentions", "Disebut"]];
    const k = K[currentOrgCat];
    return k.col.map((c) => ["f:" + c, k.fmap[c][1]]).concat([["folder", "Folder"], ["tags", "Tag"], ["mentions", "Disebut"]]);
  }
  function cellVal(r, key, mi) {
    if (key === "title") return String(r.it.title || "").trim();
    if (key === "kind") return K[r.kind].name;
    if (key === "folder") return folderOf(r.it);
    if (key === "tags") return tagsOf(r.it).join(", ");
    if (key === "mentions") return (mi.get(r.it.id) || []).reduce((a, h) => a + h.n, 0);
    if (key.startsWith("f:")) return String(fieldsOf(r.it)[key.slice(2)] || "").trim();
    return "";
  }
  function tableHtml(list, p) {
    if (!list.length) return emptyHtml();
    const mi = mentionIndex(p), cols = [["title", "Nama"]].concat(tableCols());
    const s = st.sort, sorted = list.slice();
    if (cols.some((c) => c[0] === s.key)) {
      sorted.sort((a, b) => {
        const x = cellVal(a, s.key, mi), y = cellVal(b, s.key, mi);
        if (typeof x === "number") return (x - y) * s.dir;
        if (!x !== !y) return x ? -1 : 1;   // kosong selalu di bawah
        return String(x).localeCompare(String(y), "id", { numeric: true, sensitivity: "base" }) * s.dir;
      });
    }
    return `<div class="kx-table-wrap"><table class="kx-table"><thead><tr>${cols.map(([key, label]) => `<th scope="col"${key === "mentions" ? ' class="is-num"' : ""}><button type="button" data-x="sort" data-key="${key}" aria-sort="${s.key === key ? (s.dir > 0 ? "ascending" : "descending") : "none"}">${esc(label)}${s.key === key ? ic(s.dir > 0 ? "chevron-up" : "chevron-down", 12) : ""}</button></th>`).join("")}</tr></thead>
      <tbody>${sorted.map((r) => `<tr class="kx-tr${r.kind === currentOrgCat && r.it.id === currentOrgItemId ? " is-on" : ""}" data-id="${esc(r.it.id)}" data-kind="${r.kind}" tabindex="0">${cols.map(([key]) => {
        if (key === "title") return `<td class="kx-td-title"><div>${thumb(r.kind, r.it, "kx-row-ph")}<span>${esc(cellVal(r, key, mi) || "(tanpa judul)")}</span></div></td>`;
        if (key === "kind") return `<td>${kindChip(r.kind)}</td>`;
        if (key === "tags") return `<td>${tagChips(r.it, 4)}</td>`;
        const v = cellVal(r, key, mi);
        return `<td${key === "mentions" ? ' class="is-num"' : ""}>${key === "mentions" ? (v ? v + "×" : '<span class="kx-dim">—</span>') : v ? esc(v) : '<span class="kx-dim">—</span>'}</td>`;
      }).join("")}</tr>`).join("")}</tbody></table></div>`;
  }

  // ---------- interaksi koleksi ----------
  function select(kind, id) {
    sync();
    if (kind !== currentOrgCat) currentOrgCat = kind;
    currentOrgItemId = id;
    renderList(); renderDetail();
    if (st.view !== "list" || window.matchMedia("(max-width: 700px)").matches) { const t = dom.detail.querySelector(".kx-title-in"); if (t && !t.value) t.focus(); }
  }
  function bindCollection() {
    const c = dom.coll;
    c.addEventListener("click", (e) => {
      const x = e.target.closest("[data-x]");
      if (x && x.dataset.x === "sort") {
        const key = x.dataset.key;
        st.sort = st.sort.key === key ? { key, dir: -st.sort.dir } : { key, dir: key === "mentions" ? -1 : 1 };
        renderList();
        return;
      }
      const group = e.target.closest(".kx-group");
      if (x && group && group.dataset.folder != null) {
        const f = group.dataset.folder;
        if (x.dataset.x === "renfolder") { renameFolder(f); return; }
        if (x.dataset.x === "delfolder") { deleteFolder(f); return; }
        if (x.dataset.x === "fold") { const key = currentOrgCat + "\u0001" + f; if (st.closed.has(key)) st.closed.delete(key); else st.closed.add(key); renderList(); return; }
      }
      const item = e.target.closest("[data-id][data-kind]");
      if (!item) return;
      if (x && x.dataset.x === "del") { deleteEntry(item.dataset.kind, item.dataset.id); return; }
      select(item.dataset.kind, item.dataset.id);
    });
    c.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const item = e.target.closest(".kx-row[data-id], .kx-tr[data-id]");
      if (!item || e.target !== item) return;
      e.preventDefault();
      select(item.dataset.kind, item.dataset.id);
    });
    // seret: urutkan & pindah folder
    c.addEventListener("dragstart", (e) => {
      const r = e.target.closest(".kx-row");
      if (!r || st.all) { if (r) e.preventDefault(); return; }
      dragId = r.dataset.id; r.classList.add("is-drag");
      e.dataTransfer.effectAllowed = "move";
      try { e.dataTransfer.setData("text/plain", r.querySelector(".kx-row-title").textContent); } catch (er) { /* abaikan */ }
    });
    c.addEventListener("dragend", () => { dragId = null; c.querySelectorAll(".is-drag, .is-over").forEach((n) => n.classList.remove("is-drag", "is-over")); });
    const target = (e) => e.target.closest(".kx-row, [data-drop]");
    c.addEventListener("dragover", (e) => {
      if (!dragId) return;
      const t = target(e);
      if (!t) return;
      e.preventDefault();
      c.querySelectorAll(".is-over").forEach((n) => n !== t && n.classList.remove("is-over"));
      t.classList.add("is-over");
    });
    c.addEventListener("dragleave", (e) => { const t = target(e); if (t && !t.contains(e.relatedTarget)) t.classList.remove("is-over"); });
    c.addEventListener("drop", (e) => {
      if (!dragId) return;
      const t = target(e);
      if (!t) return;
      e.preventDefault();
      const list = arr(currentOrgCat), from = list.findIndex((x) => x && x.id === dragId), it = list[from];
      if (!it) return;
      if (t.classList.contains("kx-row")) {
        if (t.dataset.id === it.id) return;
        const to = list.findIndex((x) => x && x.id === t.dataset.id), tgt = list[to];
        if (!tgt) return;
        list.splice(from, 1);
        list.splice(list.indexOf(tgt) + (from < to ? 1 : 0), 0, it);   // turun: sesudah target, naik: sebelum target
        setFolder(it, folderOf(tgt));
      } else setFolder(it, t.dataset.drop);
      dragId = null;
      markDirtyAndSchedule();
      renderList();
      if (detailFor && detailFor.id === it.id) renderDetail();
    });
  }
  function setFolder(it, f) { if (f) it.folder = f; else delete it.folder; }

  // ---------- entri ----------
  function newEntry(kind, title) {
    sync();
    const list = arr(kind, true), stamp = Date.now();
    let id = kind + "-" + stamp;
    while (findAny(id)) id = kind + "-" + stamp + "-" + Math.random().toString(36).slice(2, 6);
    const it = { id, title: String(title || "").trim() || K[kind].one + " baru", content: "" };
    if (!st.all && st.folder && st.folder !== "\u0000") it.folder = st.folder;
    list.push(it);
    markDirtyAndSchedule();
    if (dom) {
      st.all = false;
      st.q = ""; st.tag = ""; dom.search.value = "";
      currentOrgCat = kind; currentOrgItemId = id;
      renderList(); renderDetail();
      const t = dom.detail.querySelector(".kx-title-in");
      if (t) { t.focus(); t.select(); }
    }
    return id;
  }
  function deleteEntry(kind, id) {
    const it = find(kind, id);
    if (!it || !confirm(`Hapus entri "${String(it.title || "").trim() || "tanpa judul"}" dari Kodeks?`)) return;
    sync();
    const o = org();
    o[kind] = arr(kind).filter((x) => !(x && x.id === id));
    if (currentOrgCat === kind && currentOrgItemId === id) { currentOrgItemId = null; detailFor = null; }
    markDirtyAndSchedule();
    renderList(); renderDetail();
    toast("Entri dihapus", tiIcon("trash"));
  }
  function askName(msg, def) {
    const v = prompt(msg, def || "");
    return v == null ? null : v.replace(/\s+/g, " ").trim().slice(0, 80);
  }
  function newFolder() {
    if (st.all) return;
    const kind = currentOrgCat, name = askName(`Nama folder baru di ${K[kind].name}:`, "");
    if (!name) return;
    const list = foldersOf(kind);
    if (list.includes(name)) { toast(`Folder "${name}" sudah ada`, tiIcon("alert-triangle")); return; }
    list.push(name);
    saveFolders(kind, list);
    st.closed.delete(kind + "\u0001" + name);
    markDirtyAndSchedule();
    if (st.view !== "list") setView("list"); else renderList();
  }
  function renameFolder(f) {
    const kind = currentOrgCat, name = askName("Ganti nama folder:", f);
    if (!name || name === f) return;
    const list = foldersOf(kind);
    if (list.includes(name)) { toast(`Folder "${name}" sudah ada`, tiIcon("alert-triangle")); return; }
    sync();
    saveFolders(kind, list.map((x) => (x === f ? name : x)));
    entries(kind).forEach((it) => { if (folderOf(it) === f) it.folder = name; });
    if (st.folder === f) st.folder = name;
    markDirtyAndSchedule();
    renderList(); renderDetail();
  }
  function deleteFolder(f) {
    const kind = currentOrgCat, n = entries(kind).filter((it) => folderOf(it) === f).length;
    if (!confirm(n ? `Hapus folder "${f}"? ${n} entri di dalamnya dipindah ke "Tanpa folder" (tidak ikut terhapus).` : `Hapus folder "${f}"?`)) return;
    sync();
    saveFolders(kind, foldersOf(kind).filter((x) => x !== f));
    entries(kind).forEach((it) => { if (folderOf(it) === f) delete it.folder; });
    if (st.folder === f) st.folder = "";
    markDirtyAndSchedule();
    renderList(); renderDetail();
  }

  // ---------- foto ----------
  function readImage(file) {
    return new Promise((resolve, reject) => {
      if (!file || !/^image\//.test(file.type || "")) { reject(new Error("File ini bukan gambar.")); return; }
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => {
        try {
          const s = Math.min(1, PHOTO_PX / img.naturalWidth, PHOTO_PX / img.naturalHeight);
          const w = Math.max(1, Math.round(img.naturalWidth * s)), h = Math.max(1, Math.round(img.naturalHeight * s));
          const cv = document.createElement("canvas");
          cv.width = w; cv.height = h;
          cv.getContext("2d").drawImage(img, 0, 0, w, h);
          let out = cv.toDataURL("image/webp", 0.8);
          if (!/^data:image\/webp/.test(out)) {
            const cj = document.createElement("canvas"), g = cj.getContext("2d");
            cj.width = w; cj.height = h; g.fillStyle = "#fff"; g.fillRect(0, 0, w, h); g.drawImage(cv, 0, 0);
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
  function setPhoto(kind, id, file) {
    readImage(file).then((src) => {
      const it = find(kind, id);
      if (!it) return;
      it.photo = src;
      markDirtyAndSchedule();
      renderList();
      if (detailFor && detailFor.id === id) renderDetail();
    }).catch((e) => toast(e.message || "Foto gagal dipasang", tiIcon("alert-triangle")));
  }

  // ---------- detail ----------
  function sync() {
    if (!detailFor || !dom) return;
    const it = find(detailFor.kind, detailFor.id);
    const t = dom.detail.querySelector(".kx-title-in"), ed = dom.detail.querySelector(".kx-editor");
    if (!it || !t || !ed) return;
    it.title = t.value;
    it.content = ed.innerHTML;
  }
  function renderDetail() {
    if (!dom) return;
    const p = proj();
    if (!p) return;
    const kind = currentOrgCat, it = find(kind, currentOrgItemId);
    const box = dom.detail;
    dom.body.classList.toggle("has-sel", !!it);
    if (!it) {
      detailFor = null;
      box.innerHTML = `<div class="kx-detail-empty">${ic("books", 34)}<p>Pilih entri untuk melihat & mengisinya,<br>atau buat entri baru.</p></div>`;
      return;
    }
    detailFor = { kind, id: it.id };
    const k = K[kind], f = fieldsOf(it), ph = photoOf(kind, it), own = typeof it.photo === "string" && !!it.photo;
    const folders = foldersOf(kind), fo = folderOf(it);
    const fieldHtml = (d) => {
      const v = String(f[d[0]] == null ? "" : f[d[0]]);
      const id = "kxf-" + d[0];
      return d[2] === "a"
        ? `<label class="kx-field is-area" for="${id}"><span>${esc(d[1])}</span><textarea id="${id}" data-field="${d[0]}" rows="2" placeholder="${esc(d[3] || "")}">${esc(v)}</textarea></label>`
        : `<label class="kx-field" for="${id}"><span>${esc(d[1])}</span><input id="${id}" data-field="${d[0]}" value="${esc(v)}" placeholder="${esc(d[3] || "")}" autocomplete="off"></label>`;
    };
    box.style.setProperty("--kc", k.c);
    box.innerHTML = `
      <div class="kx-d-top">
        <button type="button" class="kx-icon-btn kx-d-close" data-d="close" title="Tutup" aria-label="Tutup entri">${ic("x", 16)}</button>
      </div>
      <header class="kx-d-head">
        <div class="kx-photo${ph ? " has-ph" : ""}" ${ph ? `style="background-image:url('${safeUrl(ph)}')"` : ""} data-d="photo" role="button" tabindex="0" title="${ph ? "Ganti foto (atau seret gambar ke sini)" : "Tambah foto (atau seret gambar ke sini)"}" aria-label="Foto entri">
          ${ph ? "" : `<span class="kx-photo-ic">${ic(k.icon, 30)}</span><span class="kx-photo-add">${ic("photo-plus", 14)}Foto</span>`}
          ${own ? `<button type="button" class="kx-photo-del" data-d="nophoto" title="Hapus foto" aria-label="Hapus foto">${ic("x", 13)}</button>` : ""}
        </div>
        <div class="kx-d-titles">
          <span class="kx-kchip" style="--kc:${k.c}">${ic(k.icon, 12)}${k.name}</span>
          <input class="kx-title-in" value="${esc(it.title || "")}" placeholder="Nama ${esc(k.one.toLowerCase())}" aria-label="Nama entri" autocomplete="off" spellcheck="false">
          <input class="kx-alias-in" data-meta="aliases" value="${esc(typeof it.aliases === "string" ? it.aliases : "")}" placeholder="Nama lain / panggilan (pisahkan dengan koma)" aria-label="Nama lain" autocomplete="off">
        </div>
      </header>
      <div class="kx-d-meta">
        <label class="kx-select is-field" title="Folder">${ic("folder", 14)}<select data-meta="folder" aria-label="Folder">
          <option value="">Tanpa folder</option>${folders.map((x) => `<option value="${esc(x)}"${x === fo ? " selected" : ""}>${esc(x)}</option>`).join("")}<option value="\u0001new">+ Folder baru…</option></select></label>
        <div class="kx-tagbox" title="Tag">${ic("tag", 14)}${tagsOf(it).map((t) => `<span class="kx-tag is-edit">#${esc(t)}<button type="button" data-d="untag" data-tag="${esc(t)}" aria-label="Hapus tag ${esc(t)}">${ic("x", 11)}</button></span>`).join("")}
          <input class="kx-tag-in" placeholder="${tagsOf(it).length ? "tag…" : "Tambah tag…"}" aria-label="Tambah tag" list="kxTagList" autocomplete="off"><datalist id="kxTagList"></datalist></div>
      </div>
      <section class="kx-d-sec">
        <h3>${ic("list-details", 15)}Templat ${esc(k.name)}</h3>
        <div class="kx-fields">${k.f.filter((d) => d[2] === "t").map(fieldHtml).join("")}</div>
        <div class="kx-fields is-areas">${k.f.filter((d) => d[2] === "a").map(fieldHtml).join("")}</div>
      </section>
      <section class="kx-d-sec">
        <h3>${ic("file-text", 15)}${kind === "notes" ? "Isi catatan" : "Deskripsi & catatan"}</h3>
        <div class="kx-editor organize-editor" contenteditable="true" spellcheck="false" data-placeholder="Tulis bebas di sini…">${it.content || ""}</div>
      </section>
      <section class="kx-d-sec kx-mentions-sec">
        <h3>${ic("at", 15)}Disebut di <span class="kx-mention-n"></span></h3>
        <div class="kx-mentions"></div>
      </section>
      <footer class="kx-d-foot"><button type="button" class="kx-btn kx-btn-danger" data-d="delete">${ic("trash", 15)}<span>Hapus entri</span></button></footer>`;
    // daftar tag untuk saran
    const allTags = new Set();
    KINDS.forEach((kk) => entries(kk.id).forEach((x) => tagsOf(x).forEach((t) => allTags.add(t))));
    box.querySelector("#kxTagList").innerHTML = Array.from(allTags).filter((t) => !tagsOf(it).includes(t)).map((t) => `<option value="${esc(t)}">`).join("");
    bindDetail(box, kind, it);
    renderMentions(p, it);
    box.querySelectorAll("textarea").forEach(autoGrow);
    if (typeof noteTabDoc === "function") noteTabDoc("organize", { doc: it.id, kind, title: it.title });   // TAB PROJECT: riwayat
  }
  function autoGrow(t) { t.style.height = "auto"; t.style.height = Math.min(480, t.scrollHeight + 2) + "px"; }
  let listTimer = 0;
  const softList = () => { clearTimeout(listTimer); listTimer = setTimeout(renderList, 250); };
  function bindDetail(box, kind, it) {
    const title = box.querySelector(".kx-title-in"), ed = box.querySelector(".kx-editor");
    title.addEventListener("input", () => { it.title = title.value; markDirtyAndSchedule(); softList(); });
    title.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); const n = box.querySelector(".kx-alias-in"); if (n) n.focus(); } });
    title.addEventListener("change", () => { if (typeof noteTabDoc === "function") noteTabDoc("organize", { doc: it.id, kind, title: it.title }); renderMentions(proj(), it); });
    ed.addEventListener("input", () => { it.content = ed.innerHTML; markDirtyAndSchedule(); softList(); });
    box.querySelectorAll("[data-field]").forEach((inp) => inp.addEventListener("input", () => {
      if (!isObj(it.fields)) it.fields = {};
      const v = inp.value;
      if (v) it.fields[inp.dataset.field] = v; else delete it.fields[inp.dataset.field];
      if (!Object.keys(it.fields).length) delete it.fields;
      if (inp.tagName === "TEXTAREA") autoGrow(inp);
      markDirtyAndSchedule(); softList();
    }));
    const alias = box.querySelector(".kx-alias-in");
    alias.addEventListener("input", () => { if (alias.value.trim()) it.aliases = alias.value; else delete it.aliases; markDirtyAndSchedule(); });
    alias.addEventListener("change", () => renderMentions(proj(), it));
    const fsel = box.querySelector('select[data-meta="folder"]');
    fsel.addEventListener("change", () => {
      let v = fsel.value;
      if (v === "\u0001new") {
        v = askName(`Nama folder baru di ${K[kind].name}:`, "");
        if (!v) { fsel.value = folderOf(it); return; }
        const list = foldersOf(kind);
        if (!list.includes(v)) { list.push(v); saveFolders(kind, list); }
      }
      setFolder(it, v);
      markDirtyAndSchedule();
      renderList(); renderDetail();
    });
    const tagIn = box.querySelector(".kx-tag-in");
    const addTag = () => {
      const vals = tagIn.value.split(",").map((s) => s.replace(/^#+/, "").replace(/\s+/g, " ").trim().slice(0, 40)).filter(Boolean);
      if (!vals.length) return false;
      const t = tagsOf(it);
      vals.forEach((v) => { if (!t.some((x) => x.toLowerCase() === v.toLowerCase())) t.push(v); });
      it.tags = t;
      markDirtyAndSchedule();
      renderList(); renderDetail();
      const n = dom.detail.querySelector(".kx-tag-in"); if (n) n.focus();
      return true;
    };
    tagIn.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === ",") { if (tagIn.value.trim()) { e.preventDefault(); addTag(); } }
      else if (e.key === "Backspace" && !tagIn.value && tagsOf(it).length) { it.tags = tagsOf(it).slice(0, -1); if (!it.tags.length) delete it.tags; markDirtyAndSchedule(); renderList(); renderDetail(); const n = dom.detail.querySelector(".kx-tag-in"); if (n) n.focus(); }
    });
    tagIn.addEventListener("change", () => { if (tagIn.value.trim() && allTagSet().has(tagIn.value.trim())) addTag(); });
    tagIn.addEventListener("blur", () => { if (tagIn.value.trim()) addTag(); });
    const photo = box.querySelector(".kx-photo");
    photo.addEventListener("dragover", (e) => { if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files")) { e.preventDefault(); photo.classList.add("is-over"); } });
    photo.addEventListener("dragleave", () => photo.classList.remove("is-over"));
    photo.addEventListener("drop", (e) => { e.preventDefault(); photo.classList.remove("is-over"); const fl = e.dataTransfer.files && e.dataTransfer.files[0]; if (fl) setPhoto(kind, it.id, fl); });
    photo.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); dom.file.click(); } });
    box.addEventListener("click", (e) => {
      const b = e.target.closest("[data-d]");
      if (!b) return;
      const d = b.dataset.d;
      if (d === "nophoto") { e.stopPropagation(); delete it.photo; markDirtyAndSchedule(); renderList(); renderDetail(); }
      else if (d === "photo") dom.file.click();
      else if (d === "untag") { it.tags = tagsOf(it).filter((t) => t !== b.dataset.tag); if (!it.tags.length) delete it.tags; markDirtyAndSchedule(); renderList(); renderDetail(); }
      else if (d === "delete") deleteEntry(kind, it.id);
      else if (d === "close") { sync(); currentOrgItemId = null; renderList(); renderDetail(); }
      else if (d === "mention") openMention(b.dataset.type, b.dataset.id);
    });
  }
  function allTagSet() { const s = new Set(); KINDS.forEach((kk) => entries(kk.id).forEach((x) => tagsOf(x).forEach((t) => s.add(t)))); return s; }
  function renderMentions(p, it) {
    if (!dom || !p) return;
    const box = dom.detail.querySelector(".kx-mentions"), nEl = dom.detail.querySelector(".kx-mention-n");
    if (!box) return;
    const names = [String(it.title || "").trim()].concat(aliasesOf(it)).filter((n) => norm(n).length >= 2);
    const list = (mentionIndex(p).get(it.id) || []);
    const total = list.reduce((a, h) => a + h.n, 0);
    nEl.textContent = list.length ? `${total}× di ${list.length} ${list.some((h) => h.src.type === "chapter") ? "bagian" : "scene"}` : "";
    if (!names.length) { box.innerHTML = '<p class="kx-dim">Beri nama dulu — bab & scene yang menyebut nama itu (atau nama lainnya) akan muncul di sini.</p>'; return; }
    if (!list.length) { box.innerHTML = `<p class="kx-dim">Belum disebut di naskah. Nama yang dicari: ${names.map((n) => `<b>${esc(n)}</b>`).join(", ")}.</p>`; return; }
    box.innerHTML = list.map((h) => `<button type="button" class="kx-mention" data-d="mention" data-type="${h.src.type}" data-id="${esc(h.src.id)}">
        <span class="kx-mention-ic">${ic(h.src.type === "scene" ? "file-text" : "bookmark", 15)}</span>
        <span class="kx-mention-main"><span class="kx-mention-title">${h.src.where ? `<span class="kx-mention-where">${esc(h.src.where)} ›</span> ` : ""}${esc(h.src.title)}</span><span class="kx-mention-snip">${snippet(h.src, h.at, h.len)}</span></span>
        <span class="kx-mention-n">${h.n}×</span></button>`).join("");
  }
  function openMention(type, id) {
    sync();
    if (type === "scene" && typeof openSceneInWrite === "function") openSceneInWrite(id);
    else if (typeof openProjectDoc === "function") openProjectDoc(type, id);
  }

  // dipanggil saat tab Kodeks ditampilkan: naskah mungkin berubah -> "Disebut di" & tabel diperbarui
  function refresh() { if (!dom || !proj()) { render(); return; } renderList(); const it = detailFor && find(detailFor.kind, detailFor.id); if (it) renderMentions(proj(), it); }

  window.NovelKodeks = {
    KINDS: KINDS.map((k) => ({ id: k.id, name: k.name, one: k.one, icon: k.icon, color: k.c, fields: k.f.map((f) => ({ key: f[0], label: f[1], long: f[2] === "a" })) })),
    kindIds: KINDS.map((k) => k.id),
    isKind: (k) => !!K[k],
    kindName: (k) => (K[k] ? K[k].name : ""),
    render, renderList, renderDetail, sync, refresh, newEntry, find, findAny,
    // HTML ringkas satu entri untuk ekspor Word
    exportHtml(item, kind) {
      const k = K[kind];
      if (!k || !isObj(item)) return "";
      const f = fieldsOf(item), rowsH = k.f.filter((d) => String(f[d[0]] || "").trim()).map((d) => `<p style="margin:2px 0;"><b>${esc(d[1])}:</b> ${esc(f[d[0]]).replace(/\n/g, "<br>")}</p>`).join("");
      const meta = [item.aliases ? "Nama lain: " + esc(item.aliases) : "", folderOf(item) ? "Folder: " + esc(folderOf(item)) : "", tagsOf(item).length ? "Tag: " + tagsOf(item).map(esc).join(", ") : ""].filter(Boolean).join(" · ");
      return (meta ? `<p style="color:#666;font-size:12px;">${meta}</p>` : "") + rowsH;
    },
  };
})();
