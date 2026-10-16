/* i18n.js — BAHASA ANTARMUKA (English = bawaan, Bahasa Indonesia = pilihan).
   Dimuat paling awal di <head> setelah i18n-en.js (kamus), sebelum semua modul.
   Cara kerja: kode sumber tetap menulis teks antarmuka dalam Bahasa Indonesia; saat bahasa = "en", setiap teks yang
   tampil di DOM (simpul teks + atribut title / placeholder / aria-label / data-tip / alt / data-placeholder) diganti
   terjemahannya lewat MutationObserver — sebelum browser menggambar, jadi tidak berkedip. Kamus: window.NOVELIST_EN
     exact    = { "teks Indonesia": "English text" }            (cocok persis, spasi di tepi dipertahankan)
     patterns = [["{} scene · {} kata", "{1} scenes · {2} words"]]  ({} = nilai dinamis; nilainya ikut diterjemahkan
                                                                     bila ada di kamus)
   ISI TULISAN PENGGUNA TIDAK PERNAH DITERJEMAHKAN: kolom ketik (input, textarea, contenteditable) dilewati, begitu
   juga elemen di dalam [data-no-i18n] (pratinjau naskah, pembaca cerita, cuplikan, dsb.).
   alert / confirm / prompt ikut diterjemahkan. Ganti bahasa: NovelI18n.set("en" | "id") -> disimpan di perangkat
   (localStorage "novelist_lang") lalu halaman dimuat ulang. Format angka/tanggal: NovelI18n.locale ("en-US" / "id-ID"). */
(function () {
  "use strict";
  const KEY = "novelist_lang";
  let lang = "en";
  try { const v = localStorage.getItem(KEY); if (v === "id" || v === "en") lang = v; } catch (e) { /* bawaan: en */ }
  const data = window.NOVELIST_EN || { exact: {}, patterns: [] };
  const norm = (s) => s.replace(/\s+/g, " ").trim();
  const EX = new Map();
  Object.keys(data.exact || {}).forEach((k) => { const v = data.exact[k]; if (typeof v === "string" && v !== k) EX.set(norm(k), v); });
  const EXL = new Map();   // pencarian tanpa beda huruf besar/kecil untuk nilai dinamis ({} di pola)
  EX.forEach((v, k) => { const l = k.toLowerCase(); if (!EXL.has(l)) EXL.set(l, v); });
  const capT = (t) => {
    if (EX.has(t)) return EX.get(t);
    const v = EXL.get(t.toLowerCase());
    return v === undefined ? null : t === t.toLowerCase() ? v.toLowerCase() : v;
  };
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const PATS = [];
  (data.patterns || []).forEach(([src, en]) => {
    if (typeof src !== "string" || typeof en !== "string") return;
    const parts = norm(src).split("{}");
    if (parts.length < 2) return;
    const lits = parts.filter((p) => p.trim().length);
    if (!lits.length) return;
    try {
      PATS.push({ re: new RegExp("^" + parts.map((p) => esc(p).replace(/ /g, "\\s+")).join("([\\s\\S]*?)") + "$"), en, key: lits.reduce((a, b) => (b.length > a.length ? b : a)).trim() });
    } catch (e) { /* lewati pola rusak */ }
  });
  const cache = new Map();
  function core(s) {
    const hit = EX.get(s);
    if (hit !== undefined) return hit;
    if (cache.has(s)) return cache.get(s);
    let out = null;
    for (const p of PATS) {
      if (p.key && s.indexOf(p.key) < 0) continue;
      const m = s.match(p.re);
      if (!m) continue;
      out = p.en.replace(/\{(\d+)\}/g, (_, i) => { const v = m[+i] == null ? "" : m[+i]; const t = norm(v), o = t ? capT(t) : null; return o != null ? v.replace(t, o) : v; });
      break;
    }
    if (cache.size > 8000) cache.clear();
    cache.set(s, out);
    return out;
  }
  // terjemahkan satu teks; null = tidak berubah
  function tr(s) {
    if (lang !== "en" || typeof s !== "string" || !s || !/[A-Za-z]/.test(s)) return null;
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s), c = norm(m[2]);
    if (!c) return null;
    const o = core(c);
    return o == null || o === c ? null : m[1] + o + m[3];
  }
  const t = (s) => { const o = tr(s); return o == null ? s : o; };

  const ATTRS = ["title", "placeholder", "aria-label", "data-tip", "alt", "data-placeholder", "aria-description"];
  // isi teks: lewati kolom ketik & area isi pengguna. Atribut (placeholder, title, …) kolom ketik tetap diterjemahkan.
  const SKIP_TAGS = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, NOSCRIPT: 1, CODE: 1, PRE: 1 };
  function skipEl(el) {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      if (SKIP_TAGS[n.tagName] || n.isContentEditable || n.hasAttribute("data-no-i18n")) return true;
    }
    return false;
  }
  const noAttr = (el) => !!(el.closest && el.closest("[data-no-i18n]"));
  function doText(node) {
    const p = node.parentElement;
    if (!p || skipEl(p)) return;
    const o = tr(node.nodeValue);
    if (o != null) node.nodeValue = o;
  }
  function doAttrs(el) {
    for (const a of ATTRS) {
      const v = el.getAttribute(a);
      if (v) { const o = tr(v); if (o != null) el.setAttribute(a, o); }
    }
  }
  function walk(root) {
    if (root.nodeType === 3) { doText(root); return; }
    if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
    if (root.nodeType === 1) {
      if (noAttr(root)) return;
      doAttrs(root);
      if (skipEl(root)) { root.querySelectorAll && root.querySelectorAll("[placeholder],[title],[aria-label],[data-tip],[data-placeholder]").forEach((e) => { if (!noAttr(e)) doAttrs(e); }); return; }
    }
    const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => {
        if (n.nodeType !== 1) return NodeFilter.FILTER_ACCEPT;
        if (n.hasAttribute("data-no-i18n")) return NodeFilter.FILTER_REJECT;
        if (SKIP_TAGS[n.tagName] || n.isContentEditable) { doAttrs(n); return NodeFilter.FILTER_REJECT; }   // isi dilewati, atributnya tidak
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let n;
    while ((n = w.nextNode())) { if (n.nodeType === 3) doText(n); else doAttrs(n); }
  }
  function onMut(list) {
    for (const m of list) {
      if (m.type === "childList") m.addedNodes.forEach(walk);
      else if (m.type === "characterData") doText(m.target);
      else if (m.type === "attributes" && m.target.nodeType === 1 && !noAttr(m.target)) {
        const v = m.target.getAttribute(m.attributeName);
        if (v) { const o = tr(v); if (o != null) m.target.setAttribute(m.attributeName, o); }
      }
    }
  }

  window.NovelI18n = {
    get lang() { return lang; },
    get locale() { return lang === "en" ? "en-US" : "id-ID"; },
    t,
    set(l) {
      if (l !== "en" && l !== "id") return;
      try { localStorage.setItem(KEY, l); } catch (e) { /* abaikan */ }
      if (l === lang) return;
      lang = l;
      location.reload();
    },
  };
  document.documentElement.lang = lang;
  if (lang !== "en") return;

  // dialog bawaan browser
  const A = window.alert, C = window.confirm, P = window.prompt;
  window.alert = (m) => A.call(window, t(String(m == null ? "" : m)));
  window.confirm = (m) => C.call(window, t(String(m == null ? "" : m)));
  window.prompt = (m, d) => P.call(window, t(String(m == null ? "" : m)), d);

  const mo = new MutationObserver(onMut);
  mo.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  walk(document.documentElement);   // yang sudah ada (head: <title>)
  document.addEventListener("DOMContentLoaded", () => { onMut(mo.takeRecords()); walk(document.body); });
})();
