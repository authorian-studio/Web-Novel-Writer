/* kodeks-sheet.js — LEMBAR KARAKTER untuk Kodeks (entri jenis Karakter). Dimuat sebelum kodeks.js.
   Bagian-bagian opsional di bawah "Templat Karakter": pengguna menambah bagian yang dibutuhkan lewat chip
   "Tambah bagian" (atau "Tampilkan semua"), tiap bagian bisa dilipat / disembunyikan (isinya tetap tersimpan).
   Isinya terinspirasi lembar karakter TTRPG (ambang luka, HP & stres, senjata & armor aktif, pengalaman, emas,
   fitur, inventaris) + data penulisan (profil, fisik, skill, emosi, kepribadian, hubungan, arc, riwayat).
   DATA: item.sheet = { on: [idBagian, ...], <idBagian>: { kunci: nilai, <daftar>: [{ kolom: nilai }] } }
   Semua nilai berupa teks/angka biasa; data yang tidak dikenal dibiarkan apa adanya.
   API: window.KodeksSheet = { html(item), bind(box, item, onChange), text(item), exportHtml(item) } */
(function () {
  "use strict";
  // ikon (ditulis lengkap untuk tools/build-icons.mjs): #ti-id #ti-body-scan #ti-heartbeat #ti-sword #ti-shield #ti-star
  // #ti-coins #ti-sparkles #ti-backpack #ti-chart-bar #ti-mood-heart #ti-brain #ti-users #ti-trending-up #ti-history
  // #ti-plus #ti-x #ti-chevron-down #ti-eye-off #ti-clipboard-list
  const EMO = ["", "Bahagia", "Tenang", "Bersemangat", "Penuh harap", "Bangga", "Jatuh cinta", "Sedih", "Kesepian", "Marah", "Kesal", "Takut",
    "Cemas", "Bingung", "Malu", "Bersalah", "Iri", "Jijik", "Terkejut", "Putus asa", "Hampa", "Lelah", "Curiga", "Dendam"];
  const MBTI = ["", "INTJ", "INTP", "ENTJ", "ENTP", "INFJ", "INFP", "ENFJ", "ENFP", "ISTJ", "ISFJ", "ESTJ", "ESFJ", "ISTP", "ISFP", "ESTP", "ESFP"];
  const ENNEA = ["", "1 · Perfeksionis", "2 · Penolong", "3 · Pencapai", "4 · Individualis", "5 · Pengamat", "6 · Loyalis", "7 · Petualang", "8 · Penantang", "9 · Pendamai"];
  const ALIGN = ["", "Lawful Good", "Neutral Good", "Chaotic Good", "Lawful Neutral", "True Neutral", "Chaotic Neutral", "Lawful Evil", "Neutral Evil", "Chaotic Evil"];
  const TEMPER = ["", "Sanguinis", "Koleris", "Melankolis", "Plegmatis"];
  const STATUS = ["", "Hidup", "Meninggal", "Hilang", "Tidak diketahui", "Abadi / tak menua"];
  const ATT = ["", "Keluarga", "Sahabat", "Sekutu", "Kekasih", "Mentor", "Murid", "Rekan", "Netral", "Rival", "Musuh"];
  const SLOT = ["", "Utama", "Cadangan"];

  // blok: f = kolom isian [kunci, label, "t"|"n"|"a"|"s", placeholder | opsi[]]
  //       pips = kotak yang bisa diklik { k, label, max | maxKey+def+lim, round }
  //       meters = slider 0–100 [[kunci, label]] · check = { k, label }
  //       list = baris berulang { k, cols: [[kunci, label, tipe, lebar, opsi/placeholder]], add } (tipe "r" = rating 0–5)
  //       sub = judul kecil
  const SECTIONS = [
    { id: "profile", title: "Profil & identitas", icon: "id", blocks: [
      { f: [["pronouns", "Kata ganti", "t", "dia / ia / mereka…"], ["heritage", "Keturunan & komunitas", "t", "Ras, suku, kampung halaman…"],
        ["birth", "Tanggal lahir", "t"], ["zodiac", "Zodiak / tanda lahir", "t"], ["nation", "Kebangsaan / asal negeri", "t"],
        ["language", "Bahasa dikuasai", "t"], ["belief", "Kepercayaan", "t"], ["status", "Status", "s", STATUS],
        ["location", "Lokasi sekarang", "t"], ["first", "Muncul pertama", "t", "Bab / scene"], ["voiceActor", "Inspirasi / face claim", "t"]] },
    ] },
    { id: "looks", title: "Fisik detail", icon: "body-scan", blocks: [
      { f: [["height", "Tinggi", "t", "170 cm"], ["weight", "Berat", "t"], ["build", "Postur tubuh", "t"], ["hair", "Rambut", "t"],
        ["eyes", "Mata", "t"], ["skin", "Kulit", "t"], ["marks", "Tanda khusus", "t", "Bekas luka, tato, tahi lalat…"],
        ["style", "Gaya pakaian", "a"], ["voice", "Suara & cara bicara", "a"], ["mannerism", "Gerak-gerik khas", "a"]] },
    ] },
    { id: "health", title: "Kerusakan & kesehatan", icon: "heartbeat", blocks: [
      { sub: "Ambang kerusakan" },
      { f: [["minor", "Luka ringan (tandai 1 HP)", "n"], ["major", "Luka berat (tandai 2 HP)", "n"], ["severe", "Luka parah (tandai 3 HP)", "n"]] },
      { pips: { k: "hp", label: "HP", maxKey: "hpMax", def: 6, lim: 12 } },
      { pips: { k: "stress", label: "Stres", maxKey: "stressMax", def: 6, lim: 12 } },
      { f: [["conditions", "Kondisi / luka saat ini", "a", "Racun, patah tulang, kutukan…"], ["health", "Riwayat kesehatan", "a"]] },
    ] },
    { id: "weapons", title: "Senjata aktif", icon: "sword", blocks: [
      { pips: { k: "prof", label: "Kemahiran", max: 6, round: true } },
      { sub: "Utama" },
      { f: [["p_name", "Nama", "t"], ["p_trait", "Atribut & jangkauan", "t", "Agility · dekat"], ["p_dmg", "Dadu & jenis kerusakan", "t", "d8+1 fisik"], ["p_feat", "Fitur", "a"]] },
      { sub: "Cadangan" },
      { f: [["s_name", "Nama", "t"], ["s_trait", "Atribut & jangkauan", "t"], ["s_dmg", "Dadu & jenis kerusakan", "t"], ["s_feat", "Fitur", "a"]] },
    ] },
    { id: "armor", title: "Armor aktif", icon: "shield", blocks: [
      { f: [["name", "Nama", "t"], ["thresholds", "Ambang dasar", "t", "6 / 13"], ["score", "Skor dasar", "n"], ["feat", "Fitur", "a"]] },
    ] },
    { id: "exp", title: "Pengalaman", icon: "star", blocks: [
      { list: { k: "rows", add: "Tambah pengalaman", cols: [["text", "Pengalaman", "t", 4, "Mantan pencuri jalanan…"], ["mod", "Bonus", "t", 1, "+2"]] } },
    ] },
    { id: "gold", title: "Emas & kekayaan", icon: "coins", blocks: [
      { pips: { k: "handfuls", label: "Genggam", max: 10, round: true } },
      { pips: { k: "bags", label: "Kantong", max: 10 } },
      { check: { k: "chest", label: "Punya peti harta" } },
      { f: [["other", "Mata uang / aset lain", "a", "Tanah, saham, utang…"]] },
    ] },
    { id: "feature", title: "Fitur & kemampuan", icon: "sparkles", blocks: [
      { f: [["classFeat", "Fitur kelas / bawaan", "a"]] },
      { list: { k: "abilities", add: "Tambah kemampuan", cols: [["name", "Kemampuan", "t", 2], ["cost", "Biaya / batas", "t", 1], ["desc", "Keterangan", "t", 3]] } },
    ] },
    { id: "inventory", title: "Inventaris", icon: "backpack", blocks: [
      { list: { k: "items", add: "Tambah barang", cols: [["name", "Barang", "t", 3], ["qty", "Jml", "t", 1], ["note", "Catatan", "t", 3]] } },
      { sub: "Senjata di inventaris" },
      { list: { k: "weapons", add: "Tambah senjata", cols: [["name", "Nama", "t", 2], ["trait", "Atribut & jangkauan", "t", 2], ["dmg", "Dadu & jenis", "t", 2], ["feat", "Fitur", "t", 2], ["slot", "Slot", "s", 1, SLOT]] } },
    ] },
    { id: "skills", title: "Skill & keahlian", icon: "chart-bar", blocks: [
      { list: { k: "rows", add: "Tambah skill", cols: [["name", "Skill", "t", 3, "Berpedang, memasak, diplomasi…"], ["lvl", "Tingkat", "r", 2], ["note", "Catatan", "t", 3]] } },
      { f: [["learning", "Sedang dipelajari", "t"], ["weakness", "Tidak bisa sama sekali", "t"]] },
    ] },
    { id: "emotion", title: "Emosi & kondisi mental", icon: "mood-heart", blocks: [
      { f: [["mood", "Emosi dominan saat ini", "s", EMO], ["mood2", "Emosi tersembunyi", "s", EMO]] },
      { meters: [["joy", "Kebahagiaan"], ["sad", "Kesedihan"], ["anger", "Amarah"], ["fear", "Ketakutan"], ["anxiety", "Kecemasan"],
        ["trust", "Kepercayaan pada orang lain"], ["confidence", "Kepercayaan diri"], ["empathy", "Empati"], ["stability", "Kestabilan mental"],
        ["morale", "Semangat / moral"], ["pressure", "Tekanan batin"]] },
      { f: [["triggers", "Pemicu emosi", "a"], ["coping", "Cara menenangkan diri", "a"], ["trauma", "Trauma / luka batin", "a"], ["express", "Cara menunjukkan perasaan", "a"]] },
    ] },
    { id: "psyche", title: "Kepribadian mendalam", icon: "brain", blocks: [
      { f: [["mbti", "MBTI", "s", MBTI], ["ennea", "Enneagram", "s", ENNEA], ["align", "Alignment", "s", ALIGN], ["temper", "Temperamen", "s", TEMPER],
        ["virtues", "Sifat positif", "t"], ["flaws", "Sifat negatif", "t"], ["fear", "Ketakutan terbesar", "t"], ["desire", "Keinginan terdalam", "t"],
        ["secret", "Rahasia", "t"], ["lie", "Kebohongan yang dipercaya", "t"], ["habits", "Kebiasaan", "t"], ["hobbies", "Hobi", "t"],
        ["likes", "Suka", "t"], ["dislikes", "Tidak suka", "t"], ["morals", "Prinsip / batas moral", "t"], ["quote", "Kutipan khas", "a", "“…”"]] },
    ] },
    { id: "relations", title: "Hubungan", icon: "users", blocks: [
      { list: { k: "rows", add: "Tambah hubungan", cols: [["name", "Tokoh", "t", 2], ["rel", "Hubungan", "t", 2, "Kakak, guru…"], ["att", "Sikap", "s", 1, ATT], ["note", "Catatan", "t", 3]] } },
    ] },
    { id: "arc", title: "Arc karakter", icon: "trending-up", blocks: [
      { f: [["want", "Yang diinginkan (want)", "t"], ["need", "Yang dibutuhkan (need)", "t"], ["start", "Di awal cerita", "a"], ["turn", "Titik balik", "a"],
        ["end", "Di akhir cerita", "a"], ["theme", "Tema / pelajaran", "t"]] },
    ] },
    { id: "history", title: "Riwayat hidup", icon: "history", blocks: [
      { list: { k: "rows", add: "Tambah peristiwa", cols: [["when", "Kapan", "t", 1, "Usia 12"], ["event", "Peristiwa", "t", 4]] } },
    ] },
  ];
  const SEC = Object.fromEntries(SECTIONS.map((s) => [s.id, s]));
  const closed = new Set();   // bagian yang dilipat (per sesi)

  const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const ic = (name, px) => tiPx(tiIcon(name), px || 15);
  const sheetOf = (it) => (isObj(it.sheet) ? it.sheet : null);
  const onOf = (it) => { const s = sheetOf(it); return s && Array.isArray(s.on) ? s.on.filter((id) => SEC[id]) : []; };
  const secData = (it, id, create) => {
    let s = sheetOf(it);
    if (!s) { if (!create) return {}; s = it.sheet = { on: [] }; }
    if (!isObj(s[id])) { if (!create) return {}; s[id] = {}; }
    return s[id];
  };
  const num = (v, d) => { const n = parseInt(v, 10); return isFinite(n) ? n : d; };
  const clampN = (v, a, b) => Math.max(a, Math.min(b, v));

  // ---------- render ----------
  function fieldHtml(id, d, val) {
    const key = id + "." + d[0], v = val == null ? "" : String(val), fid = "kxs-" + id + "-" + d[0];
    if (d[2] === "a") return `<label class="kx-field is-area" for="${fid}"><span>${esc(d[1])}</span><textarea id="${fid}" data-sh="${key}" rows="2" placeholder="${esc(d[3] || "")}">${esc(v)}</textarea></label>`;
    if (d[2] === "s") return `<label class="kx-field" for="${fid}"><span>${esc(d[1])}</span><select id="${fid}" data-sh="${key}" class="kx-sh-select">${d[3].map((o) => `<option value="${esc(o)}"${o === v ? " selected" : ""}>${o ? esc(o) : "—"}</option>`).join("")}${v && !d[3].includes(v) ? `<option selected value="${esc(v)}">${esc(v)}</option>` : ""}</select></label>`;
    return `<label class="kx-field" for="${fid}"><span>${esc(d[1])}</span><input id="${fid}" data-sh="${key}"${d[2] === "n" ? ' type="number" inputmode="numeric"' : ""} value="${esc(v)}" placeholder="${esc(typeof d[3] === "string" ? d[3] : "")}" autocomplete="off"></label>`;
  }
  function pipsHtml(id, p, data) {
    const max = p.max || clampN(num(data[p.maxKey], p.def), 1, p.lim), val = clampN(num(data[p.k], 0), 0, max);
    const pips = Array.from({ length: max }, (_, i) => `<button type="button" class="kx-pip${p.round ? " is-round" : ""}${i < val ? " is-on" : ""}" data-shp="${id}.${p.k}" data-v="${i + 1}" aria-label="${esc(p.label)} ${i + 1}" aria-pressed="${i < val}"></button>`).join("");
    const ctl = p.maxKey ? `<span class="kx-pip-max"><button type="button" class="kx-icon-btn" data-shm="${id}.${p.maxKey}" data-d="-1" data-def="${p.def}" data-lim="${p.lim}" aria-label="Kurangi kotak ${esc(p.label)}" title="Kurangi kotak">−</button><button type="button" class="kx-icon-btn" data-shm="${id}.${p.maxKey}" data-d="1" data-def="${p.def}" data-lim="${p.lim}" aria-label="Tambah kotak ${esc(p.label)}" title="Tambah kotak">+</button></span>` : "";
    return `<div class="kx-pips-row"><span class="kx-pips-label">${esc(p.label)}</span><span class="kx-pips" role="group" aria-label="${esc(p.label)}">${pips}</span><span class="kx-pips-n">${val}/${max}</span>${ctl}</div>`;
  }
  function meterHtml(id, m, data) {
    const v = clampN(num(data[m[0]], 0), 0, 100);
    return `<label class="kx-meter"><span class="kx-meter-label">${esc(m[1])}</span><input type="range" min="0" max="100" step="5" value="${v}" data-sh="${id}.${m[0]}" data-meter style="--v:${v}%" aria-label="${esc(m[1])}"><b class="kx-meter-v">${v}</b></label>`;
  }
  function listHtml(id, L, data) {
    const rows = Array.isArray(data[L.k]) ? data[L.k] : [];
    const tpl = L.cols.map((c) => c[3] + "fr").join(" ") + " 28px";
    const head = `<div class="kx-sl-row is-head" style="--cols:${tpl}">${L.cols.map((c) => `<span>${esc(c[1])}</span>`).join("")}<span></span></div>`;
    const body = rows.map((r, i) => `<div class="kx-sl-row" style="--cols:${tpl}">${L.cols.map((c) => {
      const v = isObj(r) && r[c[0]] != null ? String(r[c[0]]) : "", path = `${id}.${L.k}.${i}.${c[0]}`;
      if (c[2] === "r") { const n = clampN(num(v, 0), 0, 5); return `<span class="kx-rate" role="group" aria-label="${esc(c[1])}">${[1, 2, 3, 4, 5].map((k) => `<button type="button" class="kx-pip is-round is-sm${k <= n ? " is-on" : ""}" data-shr="${path}" data-v="${k}" aria-label="${esc(c[1])} ${k}" aria-pressed="${k <= n}"></button>`).join("")}</span>`; }
      if (c[2] === "s") return `<select data-shl="${path}" aria-label="${esc(c[1])}" class="kx-sh-select">${c[4].map((o) => `<option value="${esc(o)}"${o === v ? " selected" : ""}>${o ? esc(o) : "—"}</option>`).join("")}</select>`;
      return `<input data-shl="${path}" value="${esc(v)}" placeholder="${esc(i === 0 && typeof c[4] === "string" ? c[4] : "")}" aria-label="${esc(c[1])}" autocomplete="off">`;
    }).join("")}<button type="button" class="kx-icon-btn kx-sl-del" data-shdel="${id}.${L.k}.${i}" aria-label="Hapus baris" title="Hapus baris">${ic("x", 14)}</button></div>`).join("");
    return `<div class="kx-sl">${rows.length ? head + body : ""}<button type="button" class="kx-sl-add" data-shadd="${id}.${L.k}">${ic("plus", 14)}${esc(L.add)}</button></div>`;
  }
  function sectionHtml(it, id) {
    const S = SEC[id], data = secData(it, id), shut = closed.has(id);
    let body = "", fields = [];
    const flush = () => { if (fields.length) { body += `<div class="kx-fields">${fields.filter((d) => d[2] !== "a").map((d) => fieldHtml(id, d, data[d[0]])).join("")}</div>` + (fields.some((d) => d[2] === "a") ? `<div class="kx-fields is-areas">${fields.filter((d) => d[2] === "a").map((d) => fieldHtml(id, d, data[d[0]])).join("")}</div>` : ""); fields = []; } };
    S.blocks.forEach((b) => {
      if (b.f) { fields = fields.concat(b.f); return; }
      flush();
      if (b.sub) body += `<h4 class="kx-sh-sub">${esc(b.sub)}</h4>`;
      else if (b.pips) body += pipsHtml(id, b.pips, data);
      else if (b.meters) body += `<div class="kx-meters">${b.meters.map((m) => meterHtml(id, m, data)).join("")}</div>`;
      else if (b.check) body += `<label class="kx-check"><input type="checkbox" data-sh="${id}.${b.check.k}"${data[b.check.k] ? " checked" : ""}><span>${esc(b.check.label)}</span></label>`;
      else if (b.list) body += listHtml(id, b.list, data);
    });
    flush();
    return `<section class="kx-d-sec kx-sh${shut ? " is-closed" : ""}" data-sec="${id}">
      <h3><button type="button" class="kx-sh-toggle" data-shtog="${id}" aria-expanded="${!shut}">${ic(S.icon)}<span>${esc(S.title)}</span>${ic("chevron-down", 14)}</button>
        <button type="button" class="kx-icon-btn kx-sh-hide" data-shoff="${id}" title="Sembunyikan bagian (isinya tetap tersimpan)" aria-label="Sembunyikan bagian ${esc(S.title)}">${ic("eye-off", 14)}</button></h3>
      <div class="kx-sh-body">${body}</div></section>`;
  }
  function addBarHtml(it) {
    const on = onOf(it), off = SECTIONS.filter((s) => !on.includes(s.id));
    if (!off.length) return "";
    return `<div class="kx-sh-add" role="group" aria-label="Tambah bagian lembar karakter"><span class="kx-sh-add-label">${ic("clipboard-list", 15)}Tambah bagian</span>` +
      off.map((s) => `<button type="button" class="kx-sh-chip" data-shon="${s.id}">${ic(s.icon, 13)}${esc(s.title)}</button>`).join("") +
      (off.length > 1 ? `<button type="button" class="kx-sh-chip is-all" data-shon="*">${ic("plus", 13)}Tampilkan semua</button>` : "") + "</div>";
  }
  function html(it) {
    return `<div class="kx-sheet">${onOf(it).map((id) => sectionHtml(it, id)).join("")}${addBarHtml(it)}</div>`;
  }

  // ---------- interaksi ----------
  function bind(box, it, onChange) {
    const root = box.querySelector(".kx-sheet");
    if (!root) return;
    const rerender = (focusSel) => {
      root.innerHTML = html(it).replace(/^<div class="kx-sheet">|<\/div>$/g, "");
      root.querySelectorAll("textarea").forEach(grow);
      if (focusSel) { const f = root.querySelector(focusSel); if (f) f.focus({ preventScroll: true }); }
    };
    const setOn = (list) => { const s = sheetOf(it) || (it.sheet = { on: [] }); s.on = list; };
    root.addEventListener("input", (e) => {
      const t = e.target;
      if (t.dataset.sh) {
        const [id, k] = t.dataset.sh.split("."), d = secData(it, id, true);
        const v = t.type === "checkbox" ? t.checked : t.value;
        if (v === "" || v === false) delete d[k]; else d[k] = t.type === "checkbox" ? true : v;
        if (t.dataset.meter !== undefined) { t.style.setProperty("--v", t.value + "%"); const b = t.parentElement.querySelector(".kx-meter-v"); if (b) b.textContent = t.value; }
        if (t.tagName === "TEXTAREA") grow(t);
        onChange();
      } else if (t.dataset.shl) {
        const [id, k, i, c] = t.dataset.shl.split("."), rows = secData(it, id, true)[k];
        if (Array.isArray(rows) && isObj(rows[i])) { if (t.value) rows[i][c] = t.value; else delete rows[i][c]; onChange(); }
      }
    });
    root.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b || !root.contains(b)) return;
      const ds = b.dataset;
      if (ds.shon) {
        const on = onOf(it), add = ds.shon === "*" ? SECTIONS.map((s) => s.id).filter((x) => !on.includes(x)) : [ds.shon];
        setOn(on.concat(add)); add.forEach((x) => closed.delete(x)); onChange(); rerender(`[data-sec="${add[0]}"] input, [data-sec="${add[0]}"] select, [data-sec="${add[0]}"] .kx-sl-add`);
      } else if (ds.shoff) { setOn(onOf(it).filter((x) => x !== ds.shoff)); onChange(); rerender(); }
      else if (ds.shtog) { if (closed.has(ds.shtog)) closed.delete(ds.shtog); else closed.add(ds.shtog); rerender(`[data-shtog="${ds.shtog}"]`); }
      else if (ds.shp) {
        const [id, k] = ds.shp.split("."), d = secData(it, id, true), v = num(ds.v, 0);
        d[k] = num(d[k], 0) === v ? v - 1 : v; if (!d[k]) delete d[k];
        onChange(); rerender(`[data-shp="${ds.shp}"][data-v="${v}"]`);
      } else if (ds.shm) {
        const [id, k] = ds.shm.split("."), d = secData(it, id, true), lim = num(ds.lim, 12);
        d[k] = clampN(num(d[k], num(ds.def, 6)) + num(ds.d, 0), 1, lim);
        onChange(); rerender(`[data-shm="${ds.shm}"][data-d="${ds.d}"]`);
      } else if (ds.shr) {
        const [id, k, i, c] = ds.shr.split("."), rows = secData(it, id, true)[k], v = num(ds.v, 0);
        if (Array.isArray(rows) && isObj(rows[i])) { rows[i][c] = num(rows[i][c], 0) === v ? v - 1 : v; if (!rows[i][c]) delete rows[i][c]; onChange(); rerender(`[data-shr="${ds.shr}"][data-v="${v}"]`); }
      } else if (ds.shadd) {
        const [id, k] = ds.shadd.split("."), d = secData(it, id, true);
        if (!Array.isArray(d[k])) d[k] = [];
        if (d[k].length >= 200) return;
        d[k].push({});
        onChange(); rerender(`[data-shl^="${id}.${k}.${d[k].length - 1}."]`);
      } else if (ds.shdel) {
        const [id, k, i] = ds.shdel.split("."), d = secData(it, id, true);
        if (Array.isArray(d[k])) { d[k].splice(num(i, -1), 1); if (!d[k].length) delete d[k]; onChange(); rerender(`[data-shadd="${id}.${k}"]`); }
      }
    });
    root.querySelectorAll("textarea").forEach(grow);
  }
  function grow(t) { t.style.height = "auto"; t.style.height = Math.min(420, t.scrollHeight + 2) + "px"; }

  // ---------- teks untuk pencarian & ekspor ----------
  function text(it) {
    const s = sheetOf(it);
    if (!s) return "";
    const out = [];
    const walk = (v) => { if (typeof v === "string") out.push(v); else if (Array.isArray(v)) v.forEach(walk); else if (isObj(v)) Object.keys(v).forEach((k) => { if (k !== "on") walk(v[k]); }); };
    walk(s);
    return out.join(" ");
  }
  function exportHtml(it) {
    return onOf(it).map((id) => {
      const S = SEC[id], d = secData(it, id), parts = [];
      S.blocks.forEach((b) => {
        if (b.f) b.f.forEach((f) => { if (d[f[0]] != null && String(d[f[0]]).trim()) parts.push(`<b>${esc(f[1])}:</b> ${esc(d[f[0]]).replace(/\n/g, "<br>")}`); });
        else if (b.pips) { const v = num(d[b.pips.k], 0); if (v) parts.push(`<b>${esc(b.pips.label)}:</b> ${v}/${b.pips.max || clampN(num(d[b.pips.maxKey], b.pips.def), 1, b.pips.lim)}`); }
        else if (b.meters) b.meters.forEach((m) => { if (num(d[m[0]], 0)) parts.push(`<b>${esc(m[1])}:</b> ${num(d[m[0]], 0)}/100`); });
        else if (b.check) { if (d[b.check.k]) parts.push(`<b>${esc(b.check.label)}</b>`); }
        else if (b.list && Array.isArray(d[b.list.k])) d[b.list.k].forEach((r) => {
          const t = b.list.cols.map((c) => (isObj(r) && r[c[0]] != null && String(r[c[0]]).trim() ? (c[2] === "r" ? c[1] + " " + r[c[0]] + "/5" : esc(r[c[0]])) : "")).filter(Boolean).join(" · ");
          if (t) parts.push("• " + t);
        });
      });
      return parts.length ? `<p style="margin:8px 0 2px;"><b><u>${esc(S.title)}</u></b></p>` + parts.map((x) => `<p style="margin:2px 0;">${x}</p>`).join("") : "";
    }).join("");
  }

  window.KodeksSheet = { html, bind, text, exportHtml, sections: SECTIONS.map((s) => ({ id: s.id, title: s.title })) };
})();
