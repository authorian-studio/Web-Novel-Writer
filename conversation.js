// ================= CONVERSATION (tab "conversation") =================
// Dimuat lazy oleh app.js (ensureConversationLib) saat tab Conversation pertama kali dibuka. DOM biasa, tanpa React.
// Tempat menyusun dialog antar tokoh dari Kodeks (organize.characters) seperti obrolan, lalu menyisipkannya sebagai
// paragraf prosa ke adegan di Kerangka (Write) atau ke chapter Quill. Data disimpan di project:
//   p.data.conversations = {
//     list: [{ id, title, situation,                       // situation = "Apa yang terjadi?" (catatan, tidak ikut disisipkan)
//              cast: [charId, ...],                        // tokoh yang ikut bicara; cast[0] = POV (gelembung di kanan)
//              lines: [{ id, who: charId | "", name,       // who "" = narator; name = salinan nama (bila tokoh dihapus)
//                        kind: "say" | "act", text, tag }],// tag = kata kerja dialog ("bisik"); "" = otomatis (kata / tanya)
//              inserted: [{ kind: "scene" | "chapter", id, label, t }],   // riwayat penyisipan (maks. 6)
//              createdAt, updatedAt }]
//   }
// Percakapan yang terakhir dibuka & pilihan format sisip disimpan di perangkat (localStorage), bukan di project.
(function () {
  "use strict";
  const ACTIVE_KEY = "novelist_conv_active_";
  const FMT_KEY = "novelist_conv_fmt";
  const COLORS = ["#d7a86e", "#6aa8ff", "#c77dff", "#4caf82", "#e15c5c", "#4fd1c5", "#f472b6", "#e0b072"];
  const TAGS = {
    id: ["kata", "tanya", "jawab", "sahut", "bisik", "seru", "teriak", "gumam", "desis", "ujar", "isak", "geram"],
    en: ["said", "asked", "replied", "answered", "whispered", "exclaimed", "shouted", "murmured", "hissed", "muttered", "sobbed", "growled"],
  };
  const QUOTES = { curly: ["“", "”"], straight: ['"', '"'], single: ["‘", "’"], corner: ["「", "」"], guillemet: ["«", "»"], dash: ["— ", ""] };
  const STYLES = [
    ["novel", "Novel — dengan tag dialog", "“Aku pergi,” kata Raka."],
    ["plain", "Novel — tanpa tag", "“Aku pergi.”"],
    ["script", "Naskah — NAMA: dialog", "RAKA: Aku pergi."],
  ];

  let ctx = null;          // { getProject, onChange, characters, openCharacter, openKodeks, scenes, currentSceneId, stories,
                           //   canCursor(target), insert(target, html, atCursor), openTarget(target) }
  let pop = null;          // popover yang sedang terbuka { el, close }
  let dragId = null;
  let bound = false;
  const root = () => document.getElementById("convRoot");
  const uid = (p) => p + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const ic = (ref, px) => `<svg class="ti" width="${px || 16}" height="${px || 16}" aria-hidden="true"><use href="${ref}"></use></svg>`;
  const T = (s) => (window.NovelI18n ? window.NovelI18n.t(s) : s);   // teks bawaan yang menjadi DATA ikut bahasa antarmuka
  const uiLang = () => (window.NovelI18n && window.NovelI18n.lang === "en" ? "en" : "id");
  const now = () => new Date().toISOString();
  function store(k, v) { try { if (v === undefined) return JSON.parse(localStorage.getItem(k) || "null"); localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage diblokir */ } return null; }

  // ---------- data ----------
  function data() {
    const d = ctx.getProject().data;
    let c = d.conversations;
    if (!c || typeof c !== "object" || Array.isArray(c)) c = d.conversations = {};
    if (!Array.isArray(c.list)) c.list = [];
    c.list = c.list.filter((x) => x && typeof x === "object");
    c.list.forEach((x) => {
      if (!x.id) x.id = uid("cv");
      if (typeof x.title !== "string") x.title = "";
      if (typeof x.situation !== "string") x.situation = "";
      if (!Array.isArray(x.cast)) x.cast = [];
      if (!Array.isArray(x.lines)) x.lines = [];
      if (!Array.isArray(x.inserted)) x.inserted = [];
      x.lines = x.lines.filter((l) => l && typeof l === "object");
      x.lines.forEach((l) => {
        if (!l.id) l.id = uid("ln");
        if (l.kind !== "act") l.kind = "say";
        if (typeof l.text !== "string") l.text = "";
        if (typeof l.tag !== "string") l.tag = "";
        if (typeof l.who !== "string") l.who = "";
      });
    });
    return c;
  }
  const activeKey = () => ACTIVE_KEY + ctx.getProject().id;
  function active() {
    const c = data();
    const id = store(activeKey());
    return c.list.find((x) => x.id === id) || c.list[0] || null;
  }
  function setActive(conv) { store(activeKey(), conv ? conv.id : null); }
  function changed(conv) { if (conv) conv.updatedAt = now(); ctx.onChange(); }
  function chars() { return (ctx.characters() || []).filter((x) => x && x.id); }
  function charById(id) { return id ? chars().find((x) => x.id === id) || null : null; }
  function nameOf(line) {
    if (!line.who) return T("Narator");
    const ch = charById(line.who);
    return ch ? (ch.title || T("Tanpa nama")) : (line.name || T("Tokoh terhapus"));
  }
  function colorOf(id) {
    if (!id) return "var(--text-dim)";
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return COLORS[h % COLORS.length];
  }
  function initials(name) {
    const w = String(name || "?").trim().split(/\s+/).filter(Boolean);
    return ((w[0] || "?")[0] + (w.length > 1 ? w[w.length - 1][0] : "")).toUpperCase();
  }
  function avatar(id, px, fallbackName) {
    const ch = charById(id), sz = px || 34;
    if (!id) return `<span class="cv-av is-narr" style="width:${sz}px;height:${sz}px">${ic("#ti-feather", Math.round(sz * 0.48))}</span>`;
    if (ch && ch.photo) return `<span class="cv-av" style="width:${sz}px;height:${sz}px"><img src="${esc(ch.photo)}" alt=""></span>`;
    const nm = ch ? ch.title : fallbackName;
    return `<span class="cv-av" style="width:${sz}px;height:${sz}px;--av:${colorOf(id)};font-size:${Math.round(sz * 0.38)}px" data-no-i18n>${esc(initials(nm))}</span>`;
  }

  function newConversation() {
    const c = data();
    const n = c.list.length + 1;
    const conv = { id: uid("cv"), title: T("Percakapan") + " " + n, situation: "", cast: [], lines: [], inserted: [], createdAt: now(), updatedAt: now() };
    c.list.unshift(conv);
    setActive(conv);
    changed(conv);
    return conv;
  }
  function addCast(conv, id) { if (id && !conv.cast.includes(id)) conv.cast.push(id); }
  // pembicara berikutnya: pembicara sebelum baris terakhir yang berbeda (A-B-A-B), lalu tokoh cast berikutnya
  function nextSpeaker(conv, afterIdx) {
    const lines = conv.lines.slice(0, afterIdx + 1).filter((l) => l.kind === "say" && l.who);
    const last = lines.length ? lines[lines.length - 1].who : null;
    if (!last) return conv.cast[0] || "";
    for (let i = lines.length - 2; i >= 0; i--) if (lines[i].who !== last) return lines[i].who;
    const other = conv.cast.find((x) => x !== last);
    return other || last;
  }
  function addLine(conv, afterIdx, opts) {
    const o = opts || {};
    const who = o.who !== undefined ? o.who : nextSpeaker(conv, afterIdx);
    const ch = charById(who);
    const line = { id: uid("ln"), who, name: ch ? ch.title : "", kind: o.kind || "say", text: "", tag: "" };
    addCast(conv, who);
    conv.lines.splice(afterIdx + 1, 0, line);
    changed(conv);
    return line;
  }

  // ---------- format keluaran (prosa) ----------
  function fmtPrefs() {
    const f = store(FMT_KEY) || {};
    return {
      style: STYLES.some((s) => s[0] === f.style) ? f.style : "novel",
      quote: QUOTES[f.quote] ? f.quote : "curly",
      lang: f.lang === "en" || f.lang === "id" ? f.lang : uiLang(),
      target: f.target === "chapter" ? "chapter" : "scene",
      open: f.open !== false,
    };
  }
  function autoTag(text, lang) {
    const q = /\?\s*$/.test(text);
    return lang === "en" ? (q ? "asked" : "said") : (q ? "tanya" : "kata");
  }
  // satu baris dialog -> { text, html } (html sudah di-escape; nama tokoh tebal di gaya naskah)
  function lineOut(line, f) {
    const raw = line.text.replace(/\s*\n+\s*/g, " ").trim();
    const nm = nameOf(line);
    if (line.kind === "act" || !line.who) {
      if (!raw) return null;
      if (f.style === "script") return { text: `(${raw})`, html: `<em>(${esc(raw)})</em>` };
      return { text: raw, html: esc(raw) };
    }
    if (!raw) return null;
    const [o, c] = QUOTES[f.quote];
    if (f.style === "script") {
      const N = nm.toLocaleUpperCase();
      return { text: `${N}: ${raw}`, html: `<strong>${esc(N)}:</strong> ${esc(raw)}` };
    }
    const endsPunct = /[.?!…—–-]["'”’»」]?$/.test(raw);
    if (f.style === "plain" || line.tag === "-") {
      const t = endsPunct ? raw : raw + ".";
      const s = o + t + c;
      return { text: s, html: esc(s) };
    }
    const tag = line.tag || autoTag(raw, f.lang);
    let body = raw;
    if (/\.$/.test(body) && !/\.\.$/.test(body)) body = body.slice(0, -1) + ",";
    else if (!endsPunct) body += ",";
    const quoted = o + body + c;
    const tail = f.lang === "en" ? ` ${nm} ${tag}.` : ` ${tag} ${nm}.`;
    // "kata Raka" lebih umum di prosa Indonesia; dalam English, "Raka said" — tag yang diawali huruf besar dibiarkan apa adanya
    return { text: quoted + tail, html: esc(quoted) + esc(tail) };
  }
  function buildOutput(conv, f) {
    const rows = conv.lines.map((l) => lineOut(l, f)).filter(Boolean);
    return {
      html: rows.map((r) => `<p>${r.html}</p>`).join(""),
      text: rows.map((r) => r.text).join("\n\n"),
      count: rows.length,
    };
  }

  // ---------- render ----------
  function render() {
    const host = root();
    if (!host || !ctx) return;
    closePop();
    const c = data();
    const conv = active();
    if (!conv) { host.innerHTML = emptyHtml(c); return; }
    setActive(conv);
    const cast = conv.cast.filter((id) => charById(id) || conv.lines.some((l) => l.who === id));
    const pov = conv.cast[0] || null;
    host.innerHTML = `
      <div class="cv" data-conv="${esc(conv.id)}">
        <header class="cv-bar">
          <button type="button" class="cv-pick" data-act="list" aria-haspopup="menu" title="Daftar percakapan">
            <span class="cv-pick-t" data-no-i18n>${esc(conv.title || "Percakapan tanpa judul")}</span>${ic("#ti-chevron-down", 14)}
          </button>
          <span class="cv-count">${conv.lines.length} baris</span>
          <span class="cv-spacer"></span>
          <button type="button" class="cv-btn is-ghost" data-act="new" title="Percakapan baru">${ic("#ti-plus", 15)}<span>Baru</span></button>
          <button type="button" class="cv-btn is-primary" data-act="insert" ${conv.lines.some((l) => l.text.trim()) ? "" : "disabled"} title="Sisipkan ke adegan (Write) atau chapter Quill">${ic("#ti-file-import", 15)}<span>Sisipkan</span></button>
          <button type="button" class="cv-ibtn" data-act="more" aria-haspopup="menu" title="Lainnya">${ic("#ti-dots", 16)}</button>
        </header>
        <div class="cv-scroll">
          <div class="cv-col">
            <input class="cv-sit" data-f="situation" value="${esc(conv.situation)}" placeholder="Apa yang terjadi?" aria-label="Apa yang terjadi di percakapan ini" spellcheck="false">
            <div class="cv-cast" aria-label="Tokoh dalam percakapan">
              ${cast.map((id, i) => `
                <span class="cv-chip${id === pov ? " is-pov" : ""}" data-id="${esc(id)}">
                  ${avatar(id, 22, (conv.lines.find((l) => l.who === id) || {}).name)}
                  <b data-no-i18n>${esc(nameOf({ who: id, name: (conv.lines.find((l) => l.who === id) || {}).name }))}</b>
                  ${id === pov ? `<em title="Gelembungnya tampil di kanan">POV</em>` : ""}
                  <span class="cv-chip-k" title="Ctrl+${i + 1} di kolom dialog">${i < 9 ? i + 1 : ""}</span>
                  <button type="button" class="cv-chip-x" data-act="uncast" data-id="${esc(id)}" title="Keluarkan dari percakapan" aria-label="Keluarkan dari percakapan">${ic("#ti-x", 12)}</button>
                </span>`).join("")}
              <button type="button" class="cv-chip is-add" data-act="cast" aria-haspopup="menu">${ic("#ti-user-plus", 14)}<span>Tokoh</span></button>
            </div>
            <div class="cv-lines" role="list">
              ${conv.lines.map((l, i) => lineHtml(l, i, pov)).join("")}
            </div>
            ${conv.lines.length ? "" : `<div class="cv-hint">${chars().length
              ? "Pilih tokoh lalu tulis dialognya. <b>Enter</b> = baris berikutnya (pembicara bergantian), <b>Shift+Enter</b> = baris baru di dialog yang sama, <b>Ctrl+1–9</b> = ganti pembicara."
              : "Kodeks belum punya karakter. Buat karakter dulu di Kodeks supaya bisa dipilih sebagai pembicara — atau mulai dengan narasi."}</div>`}
            <div class="cv-adds">
              <button type="button" class="cv-add" data-act="add">${ic("#ti-plus", 15)}<span>Tambah dialog</span></button>
              <button type="button" class="cv-add is-soft" data-act="add-act">${ic("#ti-feather", 15)}<span>Narasi / aksi</span></button>
              ${chars().length ? "" : `<button type="button" class="cv-add is-soft" data-act="kodeks">${ic("#ti-books", 15)}<span>Buka Kodeks</span></button>`}
            </div>
            ${conv.inserted.length ? `<div class="cv-ins">${ic("#ti-history", 14)}<span>Sudah disisipkan ke:</span>
              ${conv.inserted.slice(0, 4).map((r) => `<button type="button" class="cv-ins-i" data-act="goto" data-kind="${esc(r.kind)}" data-id="${esc(r.id)}" data-story="${esc(r.story || "")}" data-no-i18n>${esc(r.label)}</button>`).join("")}</div>` : ""}
          </div>
        </div>
      </div>`;
    host.querySelectorAll(".cv-text").forEach(grow);
  }
  function lineHtml(l, i, pov) {
    const nm = nameOf(l);
    if (l.kind === "act") {
      return `
        <div class="cv-line is-act" role="listitem" data-id="${esc(l.id)}" draggable="false">
          <button type="button" class="cv-grip" data-act="grip" title="Seret untuk memindah (Alt+↑/↓)" aria-label="Pindahkan baris">${ic("#ti-grip-vertical", 14)}</button>
          <div class="cv-act">
            <button type="button" class="cv-who-s" data-act="who" title="Ganti pembicara / jenis baris" data-no-i18n>${l.who ? esc(nm) : ""}${ic("#ti-feather", 13)}</button>
            <textarea class="cv-text" rows="1" data-f="text" placeholder="Narasi atau gerak tokoh… (mis. Raka menutup pintu pelan-pelan.)" aria-label="Narasi" spellcheck="false">${esc(l.text)}</textarea>
          </div>
          ${toolsHtml(l)}
        </div>`;
    }
    const side = l.who && l.who === pov ? "r" : "l";
    return `
      <div class="cv-line is-say side-${side}" role="listitem" data-id="${esc(l.id)}" style="--av:${colorOf(l.who)}">
        <button type="button" class="cv-grip" data-act="grip" title="Seret untuk memindah (Alt+↑/↓)" aria-label="Pindahkan baris">${ic("#ti-grip-vertical", 14)}</button>
        <button type="button" class="cv-who" data-act="who" title="Ganti pembicara" aria-haspopup="menu">${avatar(l.who, 34, l.name)}</button>
        <div class="cv-bub">
          <div class="cv-meta">
            <b class="cv-name" data-no-i18n>${esc(nm)}</b>
            <button type="button" class="cv-tag${l.tag ? "" : " is-auto"}" data-act="tag" title="Kata kerja dialog (tag)" aria-haspopup="menu"><span data-no-i18n>${l.tag === "-" ? "—" : esc(l.tag || "auto")}</span>${ic("#ti-chevron-down", 11)}</button>
          </div>
          <textarea class="cv-text" rows="1" data-f="text" placeholder="Tulis dialog…" aria-label="Dialog ${esc(nm)}" spellcheck="false">${esc(l.text)}</textarea>
        </div>
        ${toolsHtml(l)}
      </div>`;
  }
  function toolsHtml(l) {
    return `<div class="cv-tools">
      <button type="button" class="cv-ibtn" data-act="kind" title="${l.kind === "act" ? "Jadikan dialog" : "Jadikan narasi / aksi"}" aria-label="${l.kind === "act" ? "Jadikan dialog" : "Jadikan narasi / aksi"}">${ic(l.kind === "act" ? "#ti-message" : "#ti-feather", 15)}</button>
      <button type="button" class="cv-ibtn is-danger" data-act="del" title="Hapus baris" aria-label="Hapus baris">${ic("#ti-trash", 15)}</button>
    </div>`;
  }
  function emptyHtml(c) {
    return `
      <div class="cv">
        <div class="cv-empty">
          ${ic("#ti-messages", 34)}
          <p>Belum ada percakapan</p>
          <span>Susun dialog antar tokoh dari Kodeks seperti obrolan, lalu sisipkan sebagai prosa ke adegan di Write atau ke chapter Quill.</span>
          <button type="button" class="cv-btn is-primary" data-act="new">${ic("#ti-plus", 15)}<span>Percakapan baru</span></button>
          ${chars().length ? "" : `<small>Tips: buat karakter dulu di <button type="button" class="cv-linkbtn" data-act="kodeks">Kodeks</button> supaya bisa dipilih sebagai pembicara.</small>`}
        </div>
      </div>`;
  }
  function grow(t) { t.style.height = "auto"; t.style.height = t.scrollHeight + "px"; }
  function lineEl(id) { return root().querySelector(`.cv-line[data-id="${CSS.escape(id)}"]`); }
  function focusLine(id, atEnd) {
    const e = lineEl(id), t = e && e.querySelector(".cv-text");
    if (!t) return;
    t.focus({ preventScroll: false });
    const n = atEnd === false ? 0 : t.value.length;
    t.setSelectionRange(n, n);
    e.scrollIntoView({ block: "nearest" });
  }
  function updateHeader(conv) {
    const r = root();
    const cnt = r.querySelector(".cv-count");
    if (cnt) cnt.textContent = conv.lines.length + " baris";
    const ins = r.querySelector('[data-act="insert"]');
    if (ins) ins.disabled = !conv.lines.some((l) => l.text.trim());
  }

  // ---------- popover / menu ----------
  function closePop() {
    if (!pop) return;
    const p = pop; pop = null;
    p.el.remove();
    document.removeEventListener("pointerdown", p.outside, true);
    document.removeEventListener("keydown", p.keys, true);
    if (p.onClose) p.onClose();
  }
  function openPop(anchor, html, onClick, opts) {
    closePop();
    const o = opts || {};
    const el = document.createElement("div");
    el.className = "cv-pop" + (o.cls ? " " + o.cls : "");
    el.setAttribute("role", "menu");
    el.innerHTML = html;
    document.body.appendChild(el);
    const r = anchor.getBoundingClientRect();
    const w = el.offsetWidth, h = el.offsetHeight;
    let x = o.alignRight ? r.right - w : r.left;
    let y = r.bottom + 6;
    if (y + h > window.innerHeight - 8) y = Math.max(8, r.top - h - 6);
    x = Math.max(8, Math.min(x, window.innerWidth - w - 8));
    el.style.left = x + "px"; el.style.top = y + "px";
    const outside = (e) => { if (!el.contains(e.target) && !anchor.contains(e.target)) closePop(); };
    const keys = (e) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closePop(); anchor.focus(); return; }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const items = [...el.querySelectorAll("button:not(:disabled)")];
        if (!items.length) return;
        const i = items.indexOf(document.activeElement);
        const n = e.key === "ArrowDown" ? (i + 1) % items.length : (i <= 0 ? items.length - 1 : i - 1);
        if (document.activeElement && document.activeElement.tagName === "INPUT" && e.key === "ArrowUp") return;
        e.preventDefault(); items[n].focus();
      }
    };
    el.addEventListener("click", (e) => { const b = e.target.closest("button[data-v]"); if (b) onClick(b.dataset.v, b); });
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", keys, true);
    pop = { el, outside, keys, onClose: o.onClose };
    const first = el.querySelector("input") || el.querySelector("button[data-v]");
    if (first) first.focus();
    return el;
  }
  // pemilih tokoh: cast dulu, lalu semua karakter Kodeks; ketik untuk mencari
  function pickCharacter(anchor, conv, cur, withNarr, done) {
    const all = chars();
    const items = () => {
      const q = (pop && pop.el.querySelector("input").value || "").trim().toLowerCase();
      const hit = (ch) => !q || (ch.title || "").toLowerCase().includes(q) || (ch.aliases || "").toLowerCase().includes(q);
      const inCast = conv.cast.map(charById).filter(Boolean).filter(hit);
      const rest = all.filter((ch) => !conv.cast.includes(ch.id) && hit(ch));
      const row = (ch) => `<button type="button" class="cv-pi${ch.id === cur ? " is-on" : ""}" data-v="${esc(ch.id)}">${avatar(ch.id, 24)}<span data-no-i18n>${esc(ch.title || "Tanpa nama")}</span>${ch.fields && ch.fields.role ? `<small data-no-i18n>${esc(ch.fields.role)}</small>` : ""}</button>`;
      return (inCast.length ? `<div class="cv-ph">Dalam percakapan</div>${inCast.map(row).join("")}` : "")
        + (rest.length ? `<div class="cv-ph">Karakter Kodeks</div>${rest.map(row).join("")}` : "")
        + (!inCast.length && !rest.length ? `<div class="cv-pe">${all.length ? "Tidak ada yang cocok" : "Kodeks belum punya karakter"}</div>` : "")
        + (withNarr ? `<div class="cv-psep"></div><button type="button" class="cv-pi${cur === "" ? " is-on" : ""}" data-v="">${avatar("", 24)}<span>Narator / aksi</span></button>` : "")
        + `<button type="button" class="cv-pi is-dim" data-v="__kodeks">${ic("#ti-books", 16)}<span>Kelola karakter di Kodeks</span></button>`;
    };
    const el = openPop(anchor, `<input class="cv-psearch" placeholder="Cari tokoh…" aria-label="Cari tokoh" spellcheck="false"><div class="cv-plist">${""}</div>`, (v) => {
      closePop();
      if (v === "__kodeks") { ctx.openKodeks(); return; }
      done(v);
    }, { cls: "is-chars" });
    const list = el.querySelector(".cv-plist");
    list.innerHTML = items();
    const inp = el.querySelector("input");
    inp.addEventListener("input", () => { list.innerHTML = items(); });
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); const b = list.querySelector("button[data-v]"); if (b) b.click(); }
      if (e.key === "ArrowDown") { e.preventDefault(); const b = list.querySelector("button[data-v]"); if (b) b.focus(); }
    });
  }
  function pickTag(anchor, conv, line) {
    const lang = fmtPrefs().lang;
    const list = TAGS[lang];
    const html = `
      <div class="cv-ph">Tag dialog</div>
      <button type="button" class="cv-pi${!line.tag ? " is-on" : ""}" data-v=""><span>Otomatis</span><small data-no-i18n>${lang === "en" ? "said / asked" : "kata / tanya"}</small></button>
      <button type="button" class="cv-pi${line.tag === "-" ? " is-on" : ""}" data-v="-"><span>Tanpa tag</span><small>“…”</small></button>
      <div class="cv-tags" data-no-i18n>${list.map((t) => `<button type="button" class="cv-tg${line.tag === t ? " is-on" : ""}" data-v="${esc(t)}">${esc(t)}</button>`).join("")}</div>
      <div class="cv-psep"></div>
      <input class="cv-psearch" placeholder="Kata kerja lain… (Enter)" aria-label="Tag dialog sendiri" value="${line.tag && line.tag !== "-" && !list.includes(line.tag) ? esc(line.tag) : ""}" spellcheck="false">`;
    const set = (v) => { line.tag = v; changed(conv); render(); focusLine(line.id); };
    const el = openPop(anchor, html, (v) => { closePop(); set(v); }, { cls: "is-tags" });
    const inp = el.querySelector("input");
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); const v = inp.value.trim(); closePop(); set(v); } });
    const on = el.querySelector(".cv-pi.is-on, .cv-tg.is-on");
    if (on) on.focus();
  }
  function listMenu(anchor) {
    const c = data(), cur = active();
    const html = `
      <div class="cv-ph">Percakapan</div>
      <div class="cv-plist is-convs">${c.list.map((x) => `
        <button type="button" class="cv-pi${cur && x.id === cur.id ? " is-on" : ""}" data-v="open:${esc(x.id)}">${ic("#ti-messages", 16)}
          <span data-no-i18n>${esc(x.title || "Percakapan tanpa judul")}</span><small>${x.lines.length}</small></button>`).join("")}</div>
      <div class="cv-psep"></div>
      <button type="button" class="cv-pi" data-v="new">${ic("#ti-plus", 16)}<span>Percakapan baru</span></button>`;
    openPop(anchor, html, (v) => {
      closePop();
      if (v === "new") { newConversation(); render(); focusTitle(); return; }
      const conv = c.list.find((x) => "open:" + x.id === v);
      if (conv) { setActive(conv); render(); }
    }, { cls: "is-list" });
  }
  function moreMenu(anchor, conv) {
    const html = `
      <button type="button" class="cv-pi" data-v="rename">${ic("#ti-pencil", 16)}<span>Ganti judul</span></button>
      <button type="button" class="cv-pi" data-v="dup">${ic("#ti-copy", 16)}<span>Duplikat</span></button>
      <button type="button" class="cv-pi" data-v="copy" ${conv.lines.some((l) => l.text.trim()) ? "" : "disabled"}>${ic("#ti-clipboard", 16)}<span>Salin sebagai teks</span></button>
      <div class="cv-psep"></div>
      <button type="button" class="cv-pi is-danger" data-v="del">${ic("#ti-trash", 16)}<span>Hapus percakapan</span></button>`;
    openPop(anchor, html, (v) => {
      closePop();
      const c = data();
      if (v === "rename") focusTitle();
      else if (v === "dup") {
        const copy = JSON.parse(JSON.stringify(conv));
        copy.id = uid("cv"); copy.title = (conv.title || T("Percakapan")) + " (" + T("salinan") + ")"; copy.inserted = [];
        copy.lines.forEach((l) => { l.id = uid("ln"); });
        copy.createdAt = copy.updatedAt = now();
        c.list.splice(c.list.indexOf(conv) + 1, 0, copy);
        setActive(copy); changed(copy); render();
      } else if (v === "copy") copyText(buildOutput(conv, fmtPrefs()));
      else if (v === "del") {
        if (conv.lines.some((l) => l.text.trim()) && !confirm(`Hapus percakapan "${conv.title || "tanpa judul"}"? Teks yang sudah disisipkan ke Write/Quill tidak ikut terhapus.`)) return;
        c.list.splice(c.list.indexOf(conv), 1);
        setActive(c.list[0] || null); changed(null); render();
      }
    }, { alignRight: true });
  }
  // judul diganti di tempat: tombol judul menjadi kolom ketik
  function focusTitle() {
    const conv = active(), btn = root().querySelector(".cv-pick");
    if (!conv || !btn) return;
    const inp = document.createElement("input");
    inp.className = "cv-title-in";
    inp.value = conv.title;
    inp.placeholder = "Judul percakapan";
    inp.setAttribute("aria-label", "Judul percakapan");
    inp.spellcheck = false;
    btn.replaceWith(inp);
    inp.focus(); inp.select();
    let done = false;
    const commit = (save) => {
      if (done) return; done = true;
      if (save) { const v = inp.value.trim(); if (v !== conv.title) { conv.title = v; changed(conv); } }
      render();
    };
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); commit(true); } else if (e.key === "Escape") { e.preventDefault(); commit(false); } });
    inp.addEventListener("blur", () => commit(true));
  }
  function copyText(out) {
    const done = () => toast("Teks percakapan disalin");
    try {
      if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
        navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([out.html], { type: "text/html" }), "text/plain": new Blob([out.text], { type: "text/plain" }) })]).then(done, () => navigator.clipboard.writeText(out.text).then(done));
      } else navigator.clipboard.writeText(out.text).then(done);
    } catch (e) { /* clipboard tidak tersedia */ }
  }
  function toast(msg, icon) { if (typeof window.toast === "function") window.toast(msg, icon); }

  // ---------- dialog sisipkan ----------
  function sceneOptions(cur) {
    const groups = [];
    let loose = [];
    (function walk(list, trail) {
      (list || []).forEach((n) => {
        if (!n) return;
        if (n.type === "folder") walk(n.children, trail.concat(n.title || "Bab"));
        else {
          const label = n.title || "Adegan tanpa judul";
          if (!trail.length) loose.push([n.id, label]);
          else {
            const g = trail.join(" › ");
            let grp = groups.find((x) => x.g === g);
            if (!grp) groups.push(grp = { g, items: [] });
            grp.items.push([n.id, label]);
          }
        }
      });
    })(ctx.getProject().data.scenes || [], []);
    const opt = ([id, t]) => `<option value="${esc(id)}"${id === cur ? " selected" : ""}>${esc(t)}</option>`;
    const total = loose.length + groups.reduce((a, g) => a + g.items.length, 0);
    return { total, html: loose.map(opt).join("") + groups.map((g) => `<optgroup label="${esc(g.g)}">${g.items.map(opt).join("")}</optgroup>`).join("") };
  }
  function openInsert(conv) {
    closePop();
    const f = fmtPrefs();
    const stories = ctx.stories();
    const ov = document.createElement("div");
    ov.className = "cv-modal";
    ov.innerHTML = `
      <div class="cv-dlg" role="dialog" aria-modal="true" aria-labelledby="cvDlgT">
        <header class="cv-dlg-h">
          <span class="cv-dlg-ic">${ic("#ti-file-import", 18)}</span>
          <div><h3 id="cvDlgT">Sisipkan percakapan</h3><p>Dialog diubah menjadi paragraf prosa lalu ditambahkan ke naskah.</p></div>
          <button type="button" class="cv-ibtn" data-x title="Tutup" aria-label="Tutup">${ic("#ti-x", 16)}</button>
        </header>
        <div class="cv-dlg-b">
          <div class="cv-seg" role="radiogroup" aria-label="Tujuan">
            <button type="button" role="radio" data-tg="scene">${ic("#ti-pencil", 15)}<span>Write</span><small>Adegan di Kerangka</small></button>
            <button type="button" role="radio" data-tg="chapter">${ic("#ti-feather", 15)}<span>Quill</span><small>Chapter cerita</small></button>
          </div>
          <div class="cv-field" data-for="scene"><label for="cvScene">Adegan</label><select id="cvScene" class="cv-sel"></select></div>
          <div class="cv-field cv-two" data-for="chapter">
            <div><label for="cvStory">Cerita</label><select id="cvStory" class="cv-sel">${stories.map((s) => `<option value="${esc(s.id)}">${esc(s.title || "Cerita tanpa judul")}</option>`).join("")}</select></div>
            <div><label for="cvChap">Chapter</label><select id="cvChap" class="cv-sel"></select></div>
          </div>
          <div class="cv-none" data-none></div>
          <div class="cv-field"><span class="cv-lab">Posisi</span>
            <div class="cv-radios">
              <label><input type="radio" name="cvPos" value="end" checked> Di akhir</label>
              <label data-cur><input type="radio" name="cvPos" value="cursor"> Di posisi kursor terakhir</label>
            </div>
          </div>
          <div class="cv-field cv-three">
            <div><label for="cvStyle">Gaya</label><select id="cvStyle" class="cv-sel">${STYLES.map((s) => `<option value="${s[0]}"${s[0] === f.style ? " selected" : ""}>${s[1]}</option>`).join("")}</select></div>
            <div><label for="cvQuote">Tanda kutip</label><select id="cvQuote" class="cv-sel" data-no-i18n>${Object.keys(QUOTES).map((k) => `<option value="${k}"${k === f.quote ? " selected" : ""}>${esc(QUOTES[k][0].trim() + "…" + (QUOTES[k][1] || ""))}</option>`).join("")}</select></div>
            <div><label for="cvLang">Bahasa tag</label><select id="cvLang" class="cv-sel"><option value="id"${f.lang === "id" ? " selected" : ""}>Indonesia (kata Raka)</option><option value="en"${f.lang === "en" ? " selected" : ""}>English (Raka said)</option></select></div>
          </div>
          <div class="cv-lab">Pratinjau</div>
          <div class="cv-prev" data-no-i18n></div>
          <label class="cv-check"><input type="checkbox" id="cvOpen"${f.open ? " checked" : ""}> Buka tujuan setelah disisipkan</label>
        </div>
        <footer class="cv-dlg-f">
          <button type="button" class="cv-btn is-ghost" data-copy>${ic("#ti-clipboard", 15)}<span>Salin</span></button>
          <span class="cv-spacer"></span>
          <button type="button" class="cv-btn" data-x>Batal</button>
          <button type="button" class="cv-btn is-primary" data-go>${ic("#ti-file-import", 15)}<span>Sisipkan</span></button>
        </footer>
      </div>`;
    document.body.appendChild(ov);
    const $ = (s) => ov.querySelector(s);
    let tgt = f.target;
    const sc = sceneOptions(ctx.currentSceneId());
    $("#cvScene").innerHTML = sc.html;
    function fillChapters() {
      const s = stories.find((x) => x.id === $("#cvStory").value);
      $("#cvChap").innerHTML = (s ? s.chapters : []).map((c, i) => `<option value="${esc(c.id)}">${esc(c.title || T("Chapter") + " " + (i + 1))}</option>`).join("");
      const cur = ctx.currentChapter();
      if (cur && s && cur.storyId === s.id) $("#cvChap").value = cur.chapterId;
    }
    const cur = ctx.currentChapter();
    if (cur && stories.some((s) => s.id === cur.storyId)) $("#cvStory").value = cur.storyId;
    fillChapters();
    const fmt = () => ({ style: $("#cvStyle").value, quote: $("#cvQuote").value, lang: $("#cvLang").value });
    const target = () => (tgt === "scene"
      ? ($("#cvScene").value ? { kind: "scene", id: $("#cvScene").value, label: $("#cvScene").selectedOptions[0].textContent } : null)
      : ($("#cvChap").value ? { kind: "chapter", storyId: $("#cvStory").value, id: $("#cvChap").value, label: $("#cvChap").selectedOptions[0].textContent } : null));
    function sync() {
      ov.querySelectorAll("[data-tg]").forEach((b) => { b.classList.toggle("is-on", b.dataset.tg === tgt); b.setAttribute("aria-checked", String(b.dataset.tg === tgt)); });
      ov.querySelectorAll("[data-for]").forEach((n) => n.classList.toggle("hidden", n.dataset.for !== tgt));
      const none = tgt === "scene" ? (sc.total ? "" : "Belum ada adegan di Kerangka. Buat adegan dulu di tab Kerangka.")
        : (!stories.length ? "Belum ada cerita di Quill. Buat cerita dulu di tab Quill."
          : (!$("#cvChap").options.length ? "Cerita ini belum punya chapter." : ""));
      $("[data-none]").textContent = none;
      $("[data-none]").classList.toggle("hidden", !none);
      const t = target();
      const canCur = !!t && ctx.canCursor(t);
      const curLab = $("[data-cur]");
      curLab.classList.toggle("is-off", !canCur);
      curLab.querySelector("input").disabled = !canCur;
      curLab.title = canCur ? "" : "Hanya bila tujuan sedang terbuka di editor (mis. split view)";
      if (!canCur) ov.querySelector('input[name="cvPos"][value="end"]').checked = true;
      const out = buildOutput(conv, fmt());
      $(".cv-prev").innerHTML = out.html || `<p class="cv-dim">${esc(T("Belum ada dialog berisi teks."))}</p>`;
      $("[data-go]").disabled = !t || !out.count;
    }
    function close() { ov.remove(); document.removeEventListener("keydown", keys, true); }
    function keys(e) {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
      else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); go(); }
    }
    function go() {
      const t = target(), fm = fmt(), out = buildOutput(conv, fm);
      if (!t || !out.count) return;
      const open = $("#cvOpen").checked;
      store(FMT_KEY, Object.assign({}, fm, { target: tgt, open }));
      const atCursor = ov.querySelector('input[name="cvPos"]:checked').value === "cursor";
      if (!ctx.insert(t, out.html, atCursor)) { toast("Gagal menyisipkan — tujuan tidak ditemukan", "#ti-alert-triangle"); return; }
      conv.inserted = [{ kind: t.kind, id: t.id, story: t.storyId || "", label: t.label, t: now() }].concat(conv.inserted.filter((r) => r.id !== t.id)).slice(0, 6);
      changed(conv);
      close();
      toast(`${out.count} paragraf disisipkan ke "${t.label}"`);
      if (open) ctx.openTarget(t); else render();
    }
    ov.addEventListener("click", (e) => {
      if (e.target === ov || e.target.closest("[data-x]")) { close(); return; }
      const b = e.target.closest("[data-tg]");
      if (b) { tgt = b.dataset.tg; sync(); return; }
      if (e.target.closest("[data-go]")) go();
      else if (e.target.closest("[data-copy]")) copyText(buildOutput(conv, fmt()));
    });
    ov.addEventListener("change", (e) => { if (e.target.id === "cvStory") fillChapters(); sync(); });
    document.addEventListener("keydown", keys, true);
    sync();
    const first = ov.querySelector(`[data-tg="${tgt}"]`);
    if (first) first.focus();
  }

  // ---------- interaksi ----------
  function convOf(e) { const c = e.target.closest(".cv[data-conv]"); return c ? data().list.find((x) => x.id === c.dataset.conv) : null; }
  function lineOf(conv, e) { const n = e.target.closest(".cv-line"); return n && conv ? conv.lines.find((l) => l.id === n.dataset.id) : null; }
  function bind() {
    if (bound) return;
    bound = true;
    const host = root();
    host.addEventListener("click", (e) => {
      const b = e.target.closest("[data-act]");
      if (!b || !ctx) return;
      const act = b.dataset.act, conv = convOf(e), line = lineOf(conv, e);
      if (act === "new") { newConversation(); render(); focusTitle(); return; }
      if (act === "kodeks") { ctx.openKodeks(); return; }
      if (!conv) return;
      if (act === "list") listMenu(b);
      else if (act === "more") moreMenu(b, conv);
      else if (act === "insert") openInsert(conv);
      else if (act === "cast") pickCharacter(b, conv, null, false, (id) => { if (id) { addCast(conv, id); changed(conv); render(); } });
      else if (act === "uncast") {
        const id = b.dataset.id;
        conv.cast = conv.cast.filter((x) => x !== id);
        changed(conv); render();
      } else if (act === "add" || act === "add-act") {
        const l = addLine(conv, conv.lines.length - 1, act === "add-act" ? { kind: "act", who: "" } : null);
        render(); focusLine(l.id);
        if (act === "add" && !l.who && chars().length) { const w = lineEl(l.id).querySelector(".cv-who"); if (w) w.click(); }
      } else if (act === "goto") ctx.openTarget({ kind: b.dataset.kind, id: b.dataset.id, storyId: b.dataset.story });
      else if (!line) return;
      else if (act === "who") {
        pickCharacter(b, conv, line.who, true, (id) => {
          line.who = id;
          const ch = charById(id);
          line.name = ch ? ch.title : "";
          if (!id) line.kind = "act";
          else { addCast(conv, id); if (line.kind === "act" && b.classList.contains("cv-who")) line.kind = "say"; }
          changed(conv); render(); focusLine(line.id);
        });
      } else if (act === "tag") pickTag(b, conv, line);
      else if (act === "kind") {
        line.kind = line.kind === "act" ? "say" : "act";
        if (line.kind === "say" && !line.who) { line.who = nextSpeaker(conv, conv.lines.indexOf(line) - 1); addCast(conv, line.who); const ch = charById(line.who); line.name = ch ? ch.title : ""; }
        changed(conv); render(); focusLine(line.id);
      } else if (act === "del") {
        const i = conv.lines.indexOf(line);
        conv.lines.splice(i, 1);
        changed(conv); render();
        const nb = conv.lines[i] || conv.lines[i - 1];
        if (nb) focusLine(nb.id);
      }
    });
    host.addEventListener("input", (e) => {
      const t = e.target, conv = convOf(e);
      if (!conv || !t.dataset.f) return;
      if (t.dataset.f === "situation") conv.situation = t.value;
      else if (t.dataset.f === "text") { const l = lineOf(conv, e); if (!l) return; l.text = t.value; grow(t); updateHeader(conv); }
      changed(conv);
    });
    host.addEventListener("keydown", (e) => {
      const t = e.target;
      if (!t.classList || !t.classList.contains("cv-text")) return;
      const conv = convOf(e), line = lineOf(conv, e);
      if (!line) return;
      const i = conv.lines.indexOf(line);
      if (e.key === "Enter" && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey && !e.isComposing) {
        e.preventDefault();
        const l = addLine(conv, i, line.kind === "act" ? { kind: "say" } : null);
        render(); focusLine(l.id);
      } else if (e.key === "Backspace" && !t.value && t.selectionStart === 0 && conv.lines.length > 0) {
        e.preventDefault();
        conv.lines.splice(i, 1);
        changed(conv); render();
        const pv = conv.lines[i - 1] || conv.lines[0];
        if (pv) focusLine(pv.id);
      } else if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        const j = e.key === "ArrowUp" ? i - 1 : i + 1;
        if (j < 0 || j >= conv.lines.length) return;
        conv.lines.splice(i, 1); conv.lines.splice(j, 0, line);
        changed(conv); render(); focusLine(line.id);
      } else if (!e.altKey && !e.shiftKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        // pindah ke baris tetangga bila kursor di ujung kolom
        const up = e.key === "ArrowUp";
        if (up ? t.selectionStart !== 0 || t.selectionEnd !== 0 : t.selectionStart !== t.value.length) return;
        if (e.ctrlKey || e.metaKey) return;
        const nb = conv.lines[up ? i - 1 : i + 1];
        if (nb) { e.preventDefault(); focusLine(nb.id, !up); }
      } else if ((e.ctrlKey || e.metaKey) && /^[0-9]$/.test(e.key)) {
        e.preventDefault();
        const id = e.key === "0" ? "" : conv.cast[+e.key - 1];
        if (id === undefined) return;
        line.who = id;
        const ch = charById(id);
        line.name = ch ? ch.title : "";
        line.kind = id ? "say" : "act";
        changed(conv); render(); focusLine(line.id);
      }
    });
    // seret baris lewat pegangan (pointer, bekerja juga di layar sentuh)
    host.addEventListener("pointerdown", (e) => {
      const g = e.target.closest(".cv-grip");
      if (!g || e.button !== 0) return;
      const conv = convOf(e), line = lineOf(conv, e);
      if (!line) return;
      e.preventDefault();
      dragId = line.id;
      const rowEl = lineEl(line.id);
      rowEl.classList.add("is-drag");
      const lines = () => [...host.querySelectorAll(".cv-line")];
      let target = null;
      const move = (ev) => {
        target = null;
        lines().forEach((n) => n.classList.remove("drop-a", "drop-b"));
        for (const n of lines()) {
          const r = n.getBoundingClientRect();
          if (ev.clientY >= r.top && ev.clientY <= r.bottom && n.dataset.id !== dragId) {
            const after = ev.clientY > r.top + r.height / 2;
            n.classList.add(after ? "drop-b" : "drop-a");
            target = { id: n.dataset.id, after };
            break;
          }
        }
      };
      const up = () => {
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerup", up);
        document.removeEventListener("pointercancel", up);
        dragId = null;
        if (!target) { render(); return; }
        const from = conv.lines.indexOf(line);
        conv.lines.splice(from, 1);
        let to = conv.lines.findIndex((l) => l.id === target.id);
        if (to < 0) to = conv.lines.length; else if (target.after) to++;
        conv.lines.splice(to, 0, line);
        changed(conv); render();
      };
      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", up);
      document.addEventListener("pointercancel", up);
    });
  }

  window.NovelConversation = {
    show(opts) {
      ctx = opts;
      bind();
      render();
    },
    hide() { closePop(); const m = document.querySelector(".cv-modal"); if (m) m.remove(); },
    refresh() { if (ctx && root() && !root().closest(".hidden")) { const a = document.activeElement; if (!a || !root().contains(a) || !/INPUT|TEXTAREA/.test(a.tagName)) render(); } },
    // untuk pengujian (bukan API inti)
    _internal: { buildOutput, lineOut },
  };
})();
