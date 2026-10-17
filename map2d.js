// ================= MAP 2D (editor peta world-building) =================
// Dimuat lazy oleh app.js setelah map-core.js & map-trees.js; dipakai map-ui.js: NovelMap2D.create(container, opts) -> editor.
//   opts: { onBeforeChange(), onChange("terrain"|"vector"), onSelect(sel|null), onViewChange({ pxPerCell }),
//           fitInsets?: { top, right, bottom, left } }   (px tepi kanvas yang tertutup UI; bisa diubah: editor.setFitInsets)
//   sel  = { type: "place"|"label"|"zone"|"river"|"path", id }
// Tampilannya dibuat sama dengan tampilan 3D (map3d.js) dilihat dari atas. Lapisan gambar (dari bawah):
//   1. medan  -> kanvas offscreen 8 px/sel (1024x1024) diisi per piksel lewat ImageData: palet & pola bioma sama dengan
//                tekstur permukaan 3D; tinggi/kemiringan/jarak pantai dari grid vertex 2/sel (rumus sama dengan 3D);
//                cahaya matahari dari barat daya + langit seperti 3D (bayangan pohon & puncak ikut dilukis ke tanah).
//                Laut meniru shader air 3D: biru muda terang, buih putih, cincin pasir krem; garis tinta biru tua tegas di
//                pantai digambar sebagai vektor (drawCoast) supaya tetap tajam di semua zoom.
//                Hanya area yang berubah yang dihitung ulang (diff medan lama vs baru)
//   2. dekor  -> pohon ilustrasi 2D datar (map-trees.js: isi rata, bayang & sorot, garis tinta; dibuat sekali per ukuran);
//                gunung = bukit batu dari medan itu sendiri. Posisi pohon sama dengan papan pohon 3D. Digambar urut
//                belakang->depan ke ubin cache per potongan 16x16 sel (zoom jauh) atau langsung (zoom dekat)
//   3. vektor -> wilayah, sungai (berhenti di pantai), jalan, lalu teks: pin & nama tempat, nama wilayah, label
//                (koordinat layar; nama otomatis dirapikan supaya tidak bertumpuk)
//   4. overlay (kanvas kedua) -> lingkaran kuas & pratinjau sungai/jalan/wilayah; digambar ulang tiap gerak pointer
// Bingkai krem digambar di kanvas; bayangannya pakai div (box-shadow) supaya murah saat pan/zoom.
(function () {
  "use strict";

  const R = 8;                     // piksel offscreen per sel
  const CHUNK = 16;                // ukuran potongan cache dekor (sel)
  const FRAME = 6;                 // tebal bingkai krem (px layar)
  const MAX_PX = 48;               // zoom maksimum (px layar per sel)
  const WARP = 0.62 / 127.5;       // amplitudo distorsi tepi pantai/bioma (sel)
  const LAND_T = 0.45;             // kontur pantai pada topeng darat halus
  // grid tinggi seperti map3d.js: tinggi dunia = terrain.h x VSCALE, 2 vertex/sel, kemiringan pantai, jarak pantai maks
  const VSCALE = 10, SEA_DEEP = 3.6, SUB = 2, BANK = 1.3, DCAP = 20, SNOW_MIN = 14;   // salju hanya di puncak yang sangat tinggi (alat Ketinggian)
  const MT_SHADE = 1.9;            // penguat bayang-terang bukit batu (gunung) di 2D
  const TILE_MAX = 46;             // px perangkat per sel: di atas ini dekor digambar langsung (bukan ubin)
  const TILE_BUDGET = 24e6;        // total piksel ubin dekor yang disimpan
  const CREAM = "#f1e9cf", INK = "#2b2118", ACCENT = "#d7a86e";
  const SERIF = 'Georgia, "Times New Roman", serif';
  const SANS = 'Inter, -apple-system, "Segoe UI", sans-serif';
  const ARR = { place: "places", label: "labels", zone: "zones", river: "rivers", path: "paths" };
  const BRUSH_TOOLS = { brush: 1, eraser: 1, elevation: 1 };
  const TOOLS = ["select", "brush", "eraser", "elevation", "river", "path", "place", "zone", "label"];
  const PAT = { plain: 0, grass: 1, fields: 2, woods: 3, marsh: 4, desert: 5, tundra: 6, cracks: 7, mountain: 8 };
  const TAU = Math.PI * 2;

  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const sstep = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
  const rgb = (hex) => { const v = parseInt(String(hex).slice(1, 7), 16) || 0; return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };
  const rgba = (hex, a) => { const c = rgb(/^#[0-9a-f]{6}$/i.test(hex) ? hex : "#e8e8ec"); return `rgba(${c[0]},${c[1]},${c[2]},${a})`; };
  const round2 = (v) => Math.round(v * 100) / 100;
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const isTyping = (t) => !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

  // warna tekstur permukaan — sama dengan map3d.js (T_*, FIELD_TONES)
  const T_SAND = rgb("#e9dcae"), T_FLOOR = rgb("#d9c99a"), T_DEEP = rgb("#557580"), T_HIGH = rgb("#a39a7e"),
    T_SNOW = rgb("#f3f5f6"), T_POOL = rgb("#6a8a82"), T_HEDGE = rgb("#5f7236"), T_CRACK = rgb("#83502c"), T_ROCK = rgb("#877a6c");
  const FIELD_TONES = ["#e0cb70", "#b7c865", "#9fbc5a", "#d7b061", "#cbda84", "#cc9d5c", "#dfcb78"].map(rgb);
  const T_GRASS_D = rgb("#a0b35d"), T_POOL_RIM = rgb("#b2b985");

  // ---------- cahaya seperti 3D: matahari (-70,125,80) 2.35 + langit/tanah 1.35 (linear, sudah /π) ----------
  const s2l = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const linHex = (hex) => rgb(hex).map(s2l);
  const SUN = (() => { const l = Math.hypot(70, 125, 80); return [-70 / l, 125 / l, 80 / l]; })();   // x timur, y atas, z selatan
  const SUN_C = linHex("#fff3df").map((v) => (v * 2.35) / Math.PI);
  const SKY_C = linHex("#eaf2ff").map((v) => (v * 1.35) / Math.PI), GND_C = linHex("#6b5a48").map((v) => (v * 1.35) / Math.PI);
  const SHX = -SUN[0] / SUN[1], SHY = -SUN[2] / SUN[1];   // geser bayangan per satuan tinggi (ke timur laut)
  // linear 0..1 -> byte sRGB; pengali cahaya linear 0..2 -> pengali sRGB (≈ v^(1/2.2))
  const ENC = new Uint8Array(4097), FLUT = new Float32Array(2049);
  for (let i = 0; i <= 4096; i++) { const v = i / 4096; ENC[i] = Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055)); }
  for (let i = 0; i <= 2048; i++) FLUT[i] = Math.pow(i / 1024, 1 / 2.2);
  const enc = (v) => ENC[v <= 0 ? 0 : v >= 1 ? 4096 : (v * 4096 + 0.5) | 0];
  const fl = (v) => FLUT[v <= 0 ? 0 : v >= 2 ? 2048 : (v * 1024 + 0.5) | 0];
  // air (shader air 3D): dangkal, dalam, buih, garis tinta pantai (linear)
  const W_SH = linHex("#b3dfea"), W_DP = linHex("#7db7cf"), W_FOAM = linHex("#e9f6f6"), W_INK = linHex("#263a4c");   // air terang ala ilustrasi
  const FLAT = [0, 1, 2].map((c) => fl(SUN_C[c] * SUN[1] + SKY_C[c]));   // pengali sRGB permukaan datar

  // ---------- tekstur noise per seed (belang daratan, distorsi tepi, gelombang/punggung vertex) — sama dengan map3d.js ----------
  // cache kecil (2 entri terakhir) supaya pratinjau palet bioma tidak membuang cache peta utama
  const cache2 = (m, key, make) => { let v = m.get(key); if (v) { m.delete(key); m.set(key, v); return v; } v = make(); m.set(key, v); if (m.size > 2) m.delete(m.keys().next().value); return v; };
  const fieldCache = new Map();
  function getFields(C, seed, n) { return cache2(fieldCache, seed + "|" + n, () => makeFields(C, seed, n)); }
  function makeFields(C, seed, n) {
    const W = n * R, G = n * 2 + 2;   // grid kasar 2 sampel per sel, lalu diperbesar bilinear ke resolusi piksel
    const grid = (fn, lo, hi) => {
      const a = new Float32Array(G * G), k = 255 / (hi - lo);
      for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) { const v = (fn(x / 2, y / 2) - lo) * k; a[y * G + x] = v < 0 ? 0 : v > 255 ? 255 : v; }
      return a;
    };
    const up = (src) => {
      const out = new Uint8Array(W * W), f = 2 / R;
      for (let py = 0; py < W; py++) {
        const gy = (py + 0.5) * f, y0 = gy | 0, ty = gy - y0, r0 = y0 * G, r1 = r0 + G;
        for (let px = 0; px < W; px++) {
          const gx = (px + 0.5) * f, x0 = gx | 0, tx = gx - x0;
          const a = src[r0 + x0] + (src[r0 + x0 + 1] - src[r0 + x0]) * tx, b = src[r1 + x0] + (src[r1 + x0 + 1] - src[r1 + x0]) * tx;
          out[py * W + px] = a + (b - a) * ty;
        }
      }
      return out;
    };
    const wxG = grid((u, v) => C.fbm(u / 2.4, v / 2.4, seed + 37, 3), 0.27, 0.73);
    const wyG = grid((u, v) => C.fbm(u / 2.4, v / 2.4, seed + 53, 3), 0.27, 0.73);
    const f = { seed, n, G, wxG, wyG, warpX: up(wxG), warpY: up(wyG),
      mottle: up(grid((u, v) => C.fbm(u / 3.2, v / 3.2, seed + 23, 3), 0.22, 0.78)), grain: new Uint8Array(W * W) };
    const gr = f.grain;
    for (let py = 0, i = 0; py < W; py++) for (let px = 0; px < W; px++, i++) gr[i] = C.hash2(px, py, seed) * 255;   // butiran acak
    // per vertex (statis per seed): gelombang lembut daratan & punggung gunung bergerigi
    const w = n * SUB + 1;
    f.wave = new Float32Array(w * w); f.ridge = new Float32Array(w * w);
    for (let j = 0; j < w; j++) for (let i = 0; i < w; i++) {
      const X = i / SUB, Y = j / SUB, k = j * w + i;
      f.wave[k] = C.fbm(X / 3.5, Y / 3.5, seed + 61, 3) - 0.5;
      f.ridge[k] = 1 - Math.abs(2 * C.noise2(X / 2.2, Y / 2.2, seed + 71) - 1);
    }
    // kisi hash untuk pola bioma (nilai sama persis dengan noise2/worley yang memanggil hash2, tanpa hitung hash per piksel)
    const lat = (scale, sd, k) => {
      const G = Math.ceil((n + 1) * scale) + 5, a = new Float32Array(G * G);
      for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) a[y * G + x] = C.hash2(x - 2, y - 2, sd + k);
      return { G, a };
    };
    const vt = (scale, sd) => ({ scale, ...lat(scale, sd, 0) });
    const wt = (scale, sd) => { const p = lat(scale, sd, 0); return { scale, G: p.G, fx: p.a, fy: lat(scale, sd, 1).a, fc: lat(scale, sd, 7).a }; };
    f.nGrass = vt(0.42, seed + 201); f.nWoods = vt(1.9, seed + 61); f.nTundra = vt(0.55, seed + 211);
    f.wBig = wt(0.44, seed + 87); f.wFine = wt(0.9, seed + 83);
    return f;
  }
  // value noise dari kisi (= C.noise2(x·scale, y·scale, seed))
  function vnoise(T, x, y) {
    x *= T.scale; y *= T.scale;
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const id = (yi + 2) * T.G + xi + 2, A = T.a, a = A[id], b = A[id + 1], c = A[id + T.G], d = A[id + T.G + 1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  // jarak tepi sel Voronoi (F2 - F1) dari kisi titik fitur; wCellOut = hash sel terdekat (rona per pelat)
  let wCellOut = 0;
  function worleyT(T, x, y) {
    x *= T.scale; y *= T.scale;
    const xi = Math.floor(x), yi = Math.floor(y), G = T.G, FX = T.fx, FY = T.fy;
    let f1 = 9, f2 = 9, bi = 0;
    for (let j = -1; j <= 1; j++) {
      const row = (yi + j + 2) * G + xi + 2, dy0 = yi + j - y;
      for (let k = -1; k <= 1; k++) {
        const id = row + k, dx = xi + k + FX[id] - x, dy = dy0 + FY[id], dd = dx * dx + dy * dy;
        if (dd < f1) { f2 = f1; f1 = dd; bi = id; } else if (dd < f2) f2 = dd;
      }
    }
    wCellOut = T.fc[bi];
    return Math.sqrt(f2) - Math.sqrt(f1);
  }
  // bercak awan terang air (sama dengan tekstur air 3D: 256 px, mulus saat diulang, nilai 0.86..1)
  let BLOT = null;
  function getBlot(C) {
    if (BLOT) return BLOT;
    const S = 256, P = 5, a = new Float32Array(S * S);
    const pn = (x, y, p, sd) => {
      const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), m = (k) => ((k % p) + p) % p;
      const A = C.hash2(m(xi), m(yi), sd), B = C.hash2(m(xi + 1), m(yi), sd), Cc = C.hash2(m(xi), m(yi + 1), sd), D = C.hash2(m(xi + 1), m(yi + 1), sd);
      return A + (B - A) * u + (Cc - A) * v + (A - B - Cc + D) * u * v;
    };
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      let sum = 0, amp = 0.5, norm = 0, f = 1;
      for (let o = 0; o < 4; o++) { sum += amp * pn((x / S) * 5 * f, (y / S) * 5 * f, P * f, 17 + o * 31); norm += amp; amp *= 0.5; f *= 2; }
      const t = clamp01((sum / norm - 0.5) / 0.22);
      a[y * S + x] = Math.round((0.86 + 0.14 * t * t * (3 - 2 * t)) * 255) / 255;
    }
    BLOT = a;
    return a;
  }

  // bercak air per piksel medan (nilai & goyangan tepi seperti shader air 3D), dikuantisasi 0..255 -> BLV; di-cache per ukuran peta
  const BLV = new Float32Array(256);
  for (let q = 0; q < 256; q++) BLV[q] = 0.855 + (q / 255) * 0.145;
  const blq = (v) => Math.round(clamp01((v - 0.855) / 0.145) * 255);
  const blotCache = new Map();
  function getBlotPix(C, n) { return cache2(blotCache, n, () => makeBlotPix(C, n)); }
  function makeBlotPix(C, n) {
    const BL = getBlot(C), W = n * R, bk = 512 / n / R, a = new Uint8Array(W * W), b = new Uint8Array(W * W);
    const smp = (x, y) => {
      const xi = Math.floor(x), yi = Math.floor(y), tx = x - xi, ty = y - yi, x0 = xi & 255, y0 = yi & 255, x1 = (x0 + 1) & 255, y1 = (y0 + 1) & 255;
      const p = BL[y0 * 256 + x0], q = BL[y0 * 256 + x1], r = BL[y1 * 256 + x0], d = BL[y1 * 256 + x1];
      return p + (q - p) * tx + (r - p) * ty + (p - q - r + d) * tx * ty;
    };
    for (let py = 0, i = 0; py < W; py++) for (let px = 0; px < W; px++, i++) {
      const u = (px + 0.5) * bk, v = (py + 0.5) * bk;
      a[i] = blq(smp(u, v));
      b[i] = blq(smp(u * 2.7 + 79.36, v * 2.7 - 181.76));
    }
    return { n, a, b };
  }
  // laut lepas (jarak pantai > 5.5 sel, dalam > 4.5, tanpa bayangan): warna air per tingkat bercak sudah jadi (sRGB x alfa 0.95)
  const OPEN = [0, 1, 2].map((c) => Float32Array.from(BLV, (bl) => 0.95 * enc(bl * W_DP[c] * (SUN_C[c] * SUN[1] + SKY_C[c]))));
  const DEEPF = [0, 1, 2].map((c) => 0.05 * T_DEEP[c] * FLAT[c]);

  // ================= SPRITE DEKOR: pohon ilustrasi 2D datar (map-trees.js; papan pohon 3D memakai gambar yang sama) =================
  const TREES = window.NovelMapTrees;
  const KIND = { pine: 0, pineLight: 1, snowPine: 2, broad: 3, broadLight: 4, palm: 5, reed: 6 };
  const KIND_NAMES = Object.keys(KIND);
  // dim = ukuran gambar (unit pohon, kaki di tengah bawah); sh = bayangan [tinggi0, jari0, tinggi1, jari1]
  const DECOR = KIND_NAMES.map((k) => ({ dim: TREES.DIM[k], sh: TREES.DIM[k].sh }));
  const TREE_ROT = TREES.VARIANTS;   // varian bentuk per jenis
  // ember ukuran: P (px perangkat per unit) dibulatkan ke atas per √2
  const bucketOf = (P) => Math.max(2, Math.ceil(2 * Math.log2(Math.max(1, P)) - 1e-6));
  const bucketPx = (b) => Math.pow(2, b / 2);
  const SPRITES = new Map();
  // warna instance pohon (k x (1+tint), k, k x (1-1.3 tint)) seperti 3D, 6 varian
  const TREE_TINTS = [[0.9, 0.05], [0.9, -0.05], [0.98, 0.05], [0.98, -0.05], [1.06, 0.05], [1.06, -0.05]].map(([k, t]) => [k * (1 + t), k, k * (1 - t * 1.3)]);
  function getSprite(kind, v, t, P) {
    const b = Math.min(14, bucketOf(P)), key = ((kind * 32 + v) * 8 + t) * 64 + b;   // maks 128 px/unit (zoom terdekat)
    let s = SPRITES.get(key);
    if (s) return s;
    const Pb = bucketPx(b);
    s = TREES.draw(KIND_NAMES[kind], v, TREE_TINTS[t], Pb);
    s.P = Pb;
    SPRITES.set(key, s);
    return s;
  }

  // ---------- geometri garis ----------
  function simplify(C, pts, eps) {   // Ramer–Douglas–Peucker
    if (pts.length < 3) return pts.slice();
    const keep = new Uint8Array(pts.length), stack = [[0, pts.length - 1]];
    keep[0] = keep[pts.length - 1] = 1;
    while (stack.length) {
      const [a, b] = stack.pop();
      let md = 0, mi = -1;
      for (let i = a + 1; i < b; i++) {
        const d = C.distToSegment(pts[i][0], pts[i][1], pts[a][0], pts[a][1], pts[b][0], pts[b][1]);
        if (d > md) { md = d; mi = i; }
      }
      if (md > eps) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
    }
    return pts.filter((_, i) => keep[i]);
  }
  function chaikin(pts, iter) {     // penghalus garis untuk tampilan saja (data tetap titik asli)
    let p = pts;
    for (let k = 0; k < iter && p.length > 2; k++) {
      const out = [p[0]];
      for (let i = 0; i < p.length - 1; i++) {
        const a = p[i], b = p[i + 1];
        out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
      }
      out.push(p[p.length - 1]);
      p = out;
    }
    return p;
  }
  function polyLength(pts) { let l = 0; for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return l; }
  // pita (sungai); sp = titik layar, hw = setengah lebar per titik, roundA/roundB = ujung awal/akhir membulat
  // (false = rata, untuk muara). Ditambahkan ke path aktif.
  function traceRibbon(c, sp, hw, roundA = true, roundB = true) {
    const m = sp.length;
    if (m < 2) return;
    const nx = new Float32Array(m), ny = new Float32Array(m);
    for (let i = 0; i < m; i++) {
      const a = sp[Math.max(0, i - 1)], b = sp[Math.min(m - 1, i + 1)];
      const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
      nx[i] = -dy / l; ny[i] = dx / l;
    }
    c.moveTo(sp[0][0] + nx[0] * hw[0], sp[0][1] + ny[0] * hw[0]);
    for (let i = 1; i < m; i++) c.lineTo(sp[i][0] + nx[i] * hw[i], sp[i][1] + ny[i] * hw[i]);
    if (roundB) { const ae = Math.atan2(ny[m - 1], nx[m - 1]); c.arc(sp[m - 1][0], sp[m - 1][1], hw[m - 1], ae, ae - Math.PI, true); }
    for (let i = m - 1; i >= 0; i--) c.lineTo(sp[i][0] - nx[i] * hw[i], sp[i][1] - ny[i] * hw[i]);
    if (roundA) { const as = Math.atan2(-ny[0], -nx[0]); c.arc(sp[0][0], sp[0][1], hw[0], as, as - Math.PI, true); }
    c.closePath();
  }
  // titik label wilayah: pusat massa poligon (kalau jatuh di luar -> rata-rata titik)
  function polyLabelPoint(C, pts) {
    let a = 0, cx = 0, cy = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const f = pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
      a += f; cx += (pts[j][0] + pts[i][0]) * f; cy += (pts[j][1] + pts[i][1]) * f;
    }
    if (Math.abs(a) > 1e-6) { cx /= 3 * a; cy /= 3 * a; if (C.pointInPolygon(cx, cy, pts)) return [cx, cy]; }
    let sx = 0, sy = 0;
    pts.forEach((p) => { sx += p[0]; sy += p[1]; });
    return [sx / pts.length, sy / pts.length];
  }

  // ---------- ikon tempat (koordinat lokal -1..1, warna tinta sudah di-set) ----------
  const ICONS = {
    city(c) {
      c.beginPath(); c.rect(-0.92, -0.12, 0.5, 0.98); c.rect(-0.3, -0.86, 0.6, 1.72); c.rect(0.42, -0.42, 0.5, 1.28); c.fill();
    },
    village(c) {
      c.beginPath(); c.moveTo(-0.78, 0.82); c.lineTo(-0.78, -0.06); c.lineTo(0, -0.8); c.lineTo(0.78, -0.06); c.lineTo(0.78, 0.82); c.closePath();
      c.rect(-0.2, 0.25, 0.4, 0.57); c.fill("evenodd");
    },
    castle(c) {
      c.beginPath(); c.moveTo(-0.86, 0.86);
      [[-0.86, -0.78], [-0.56, -0.78], [-0.56, -0.5], [-0.16, -0.5], [-0.16, -0.78], [0.16, -0.78], [0.16, -0.5], [0.56, -0.5], [0.56, -0.78], [0.86, -0.78], [0.86, 0.86]]
        .forEach(([x, y]) => c.lineTo(x, y));
      c.closePath();
      c.moveTo(-0.26, 0.86); c.lineTo(-0.26, 0.32); c.arc(0, 0.32, 0.26, Math.PI, 0); c.lineTo(0.26, 0.86); c.closePath();
      c.fill("evenodd");
    },
    port(c) {
      c.lineWidth = 0.22; c.lineCap = "round"; c.beginPath();
      c.moveTo(0.2, -0.66); c.arc(0, -0.66, 0.2, 0, TAU);
      c.moveTo(0, -0.46); c.lineTo(0, 0.82); c.moveTo(-0.42, -0.18); c.lineTo(0.42, -0.18);
      c.moveTo(-0.72, 0.2); c.quadraticCurveTo(-0.6, 0.86, 0, 0.84); c.quadraticCurveTo(0.6, 0.86, 0.72, 0.2);
      c.stroke();
    },
    temple(c) {
      c.beginPath(); c.moveTo(-0.92, -0.34); c.lineTo(0, -0.9); c.lineTo(0.92, -0.34); c.closePath();
      c.rect(-0.86, -0.3, 1.72, 0.17); c.rect(-0.7, -0.08, 0.24, 0.66); c.rect(-0.12, -0.08, 0.24, 0.66); c.rect(0.46, -0.08, 0.24, 0.66);
      c.rect(-0.92, 0.62, 1.84, 0.24); c.fill();
    },
    ruin(c) {
      c.beginPath();
      c.moveTo(-0.76, 0.6); c.lineTo(-0.76, -0.3); c.lineTo(-0.6, -0.46); c.lineTo(-0.46, -0.24); c.lineTo(-0.46, 0.6); c.closePath();
      c.moveTo(0.02, 0.6); c.lineTo(0.02, -0.72); c.lineTo(0.18, -0.56); c.lineTo(0.32, -0.84); c.lineTo(0.32, 0.6); c.closePath();
      c.rect(-0.94, 0.62, 1.88, 0.24); c.rect(0.5, 0.34, 0.32, 0.26); c.fill();
    },
    camp(c) {
      c.beginPath(); c.moveTo(-0.96, 0.78); c.lineTo(0, -0.86); c.lineTo(0.96, 0.78); c.closePath();
      c.moveTo(-0.26, 0.78); c.lineTo(0, 0.14); c.lineTo(0.26, 0.78); c.closePath(); c.fill("evenodd");
    },
    landmark(c) {
      c.beginPath();
      for (let k = 0; k < 10; k++) { const r = k % 2 ? 0.42 : 0.98, a = -Math.PI / 2 + (k * Math.PI) / 5; c.lineTo(Math.cos(a) * r, Math.sin(a) * r + 0.06); }
      c.closePath(); c.fill();
    },
  };


  // ======================================================================
  function create(container, opts) {
    const C = window.NovelMapCore;
    if (!C) throw new Error("NovelMapCore belum dimuat");
    opts = opts || {};
    const BIOMES = C.BIOMES;
    const emit = (name, arg) => { const fn = opts[name]; if (typeof fn === "function") fn(arg); };

    // ---------- tabel bioma (indeks 0..255; yang tidak dikenal = laut), sama dengan 3D ----------
    const landLUT = new Uint8Array(256), pat = new Uint8Array(256), mtLUT = new Uint8Array(256);
    const cR = new Float32Array(256), cG = new Float32Array(256), cB = new Float32Array(256);
    const aR = new Float32Array(256), aG = new Float32Array(256), aB = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const b = BIOMES[i] || BIOMES[0], c = rgb(b.color), a = rgb(b.alt || b.color);
      landLUT[i] = b.land ? 1 : 0; mtLUT[i] = b.mountain ? 1 : 0;
      cR[i] = c[0]; cG[i] = c[1]; cB[i] = c[2]; aR[i] = a[0]; aG[i] = a[1]; aB[i] = a[2];
      pat[i] = b.mountain ? PAT.mountain : b.pattern === "fields" ? PAT.fields : b.pattern === "cracks" ? PAT.cracks
        : ({ grassland: PAT.grass, forest: PAT.woods, pine: PAT.woods, jungle: PAT.woods, marsh: PAT.marsh, desert: PAT.desert, tundra: PAT.tundra })[b.key]
        ?? (b.tree && b.treeDensity > 0.3 ? PAT.woods : PAT.plain);
    }
    // pohon per bioma (sama dengan treeCfg 3D): hutan lebat = grid rapat, bioma jarang = peluang treeDensity
    const TREE_GAP = { pine: 1.1, broad: 1.5, palm: 1.4 };   // hutan lebat: tajuk besar saling menutup (ala ilustrasi)
    const TREE_SIZE = [[1.06, 0.4], [0.95, 0.32], [1, 0.32], [1.02, 0.34], [0.95, 0.3], [1.04, 0.32], [0.95, 0.55]];   // per jenis: [dasar, variasi]
    const treeCfg = [];
    BIOMES.forEach((b, i) => {
      if (!b.land || !b.tree) return;
      const dens = b.treeDensity || 0, dense = dens > 0.3, c = rgb(b.color);
      const pale = (c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11) / 255 > 0.62;
      const kind = b.tree === "pine" ? (pale ? "snowPine" : "pine") : b.tree === "broad" ? (pale ? "broadLight" : "broad") : b.tree;
      treeCfg[i] = { s: dense ? TREE_GAP[kind] || 0.8 : 1, p: dense ? 0.55 + dens * 0.5 : Math.min(0.6, dens * (b.tree === "reed" ? 2 : 1.25)),
        kind: KIND[kind] ?? KIND.broad, mix: b.tree === "broad" && pale, z: dense ? (b.tree === "broad" ? 1.6 : 1.3) : b.tree === "reed" ? 1 : 1.55 };   // z = pengali ukuran pohon (jarang = pohon besar)
    });
    const SPACINGS = [...new Set(treeCfg.filter(Boolean).map((c) => c.s))];

    // ---------- DOM ----------
    const root = document.createElement("div");
    root.className = "map2d";
    root.style.cssText = "position:absolute;inset:0;overflow:hidden;user-select:none;-webkit-user-select:none;";
    const shadowEl = document.createElement("div");
    shadowEl.style.cssText = "position:absolute;left:0;top:0;pointer-events:none;border-radius:2px;display:none;" +
      "box-shadow:0 14px 40px rgba(0,0,0,0.5),0 3px 10px rgba(0,0,0,0.35);";
    const cv = document.createElement("canvas"), ov = document.createElement("canvas");
    cv.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;outline:none;";
    ov.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none;";
    cv.setAttribute("aria-label", "Kanvas peta");
    root.append(shadowEl, cv, ov);
    if (getComputedStyle(container).position === "static") container.style.position = "relative";
    container.appendChild(root);
    const ctx = cv.getContext("2d"), octx = ov.getContext("2d");
    const ground = document.createElement("canvas");
    let gctx = null;

    // ---------- state ----------
    let map = null, n = 128, fields = null, terrain = null, drawnBiome = null;
    let layers = Object.fromEntries(C.LAYER_KEYS.map((k) => [k, true]));
    let chunks = [], CN = 0, mask = null, shadowBuf = null;
    let coastD = null, coastPaths = [];   // jarak bertanda ke kontur pantai per piksel (Int8, 1/64 sel) & garis pantai vektor per potongan
    let tiles = [], tilePx = 0, frameNo = 0;      // ubin dekor per potongan: Map(ember -> { cv, used })
    let pending = null, terrainCost = 5, lastSync = 0;
    let cssW = 0, cssH = 0, dpr = 1;
    const view = { scale: 4, ox: 0, oy: 0 };
    // tepi kanvas yang tertutup UI shell (px CSS): fit() menaruh peta di area sisanya
    const normInsets = (o) => { const v = (k) => Math.max(0, Number(o && o[k]) || 0); return { top: v("top"), right: v("right"), bottom: v("bottom"), left: v("left") }; };
    let insets = normInsets(opts.fitInsets);
    let autoFit = true, lastVS = -1, lastVX = 0, lastVY = 0;
    let tool = "select";
    const brush = { biome: 1, size: 4 }, elev = { mode: "raise", strength: 0.5, size: 4 };
    let placeIcon = "city", pathKind = "road";
    let sel = null, action = null, zoneDraft = null, lastZoneClick = null;
    let hover = null, hoverInside = false, hoverHit = null, spaceDown = false, coarse = false;   // coarse = pointer terakhir sentuhan
    const touches = new Map();
    let raf = 0, needMain = false, needOver = false, destroyed = false;

    const toCell = (p) => ({ x: (p.x - view.ox) / view.scale, y: (p.y - view.oy) / view.scale });
    const sx = (x) => view.ox + x * view.scale, sy = (y) => view.oy + y * view.scale;
    const clampPt = (c) => [round2(Math.max(0, Math.min(n, c.x))), round2(Math.max(0, Math.min(n, c.y)))];
    const union = (a, b) => (!a ? b && { ...b } : !b ? { ...a } : { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) });
    const grow = (b, k) => ({ x0: Math.max(0, b.x0 - k), y0: Math.max(0, b.y0 - k), x1: Math.min(n - 1, b.x1 + k), y1: Math.min(n - 1, b.y1 + k) });
    const findObj = (s) => (s && map ? (map[ARR[s.type]] || []).find((o) => o.id === s.id) : null);
    const emitSelect = () => emit("onSelect", sel ? { type: sel.type, id: sel.id } : null);
    const isShown = () => !destroyed && cssW > 0 && root.getClientRects().length > 0;

    function requestDraw(main, over) {
      if (main !== false) needMain = true;
      if (over !== false) needOver = true;
      if (!raf && !destroyed) raf = requestAnimationFrame(frame);
    }

    // ================= MEDAN =================
    // bilinear nilai per sel (pusat sel = x+0.5)
    function bil(a, u, v) {
      const nm = n - 1;
      let fx = u - 0.5, fy = v - 0.5;
      fx = fx < 0 ? 0 : fx > nm ? nm : fx; fy = fy < 0 ? 0 : fy > nm ? nm : fy;
      const x0 = fx | 0, y0 = fy | 0, x1 = x0 < nm ? x0 + 1 : x0, y1 = y0 < nm ? y0 + 1 : y0, tx = fx - x0, ty = fy - y0;
      const r0 = y0 * n, r1 = y1 * n;
      const a0 = a[r0 + x0] + (a[r0 + x1] - a[r0 + x0]) * tx, a1 = a[r1 + x0] + (a[r1 + x1] - a[r1 + x0]) * tx;
      return a0 + (a1 - a0) * ty;
    }
    // topeng daratan dihaluskan [1 2 1]/4 per sumbu -> garis pantai membulat (bukan tangga sel); kontur = LAND_T
    // landPend = kotak sel yang landS-nya berubah sejak jarak pantai terakhir dihitung
    let landS = null, landVer = 0, landPend = null;   // landVer naik tiap landS berubah (kunci cache potongan sungai)
    function updateLandS(bb) {
      landVer++;
      const bio = map.biome, nm = n - 1;
      let x0 = n, y0 = n, x1 = -1, y1 = -1;
      for (let y = Math.max(0, bb.y0); y <= Math.min(nm, bb.y1); y++) for (let x = Math.max(0, bb.x0); x <= Math.min(nm, bb.x1); x++) {
        let s = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy < 0 ? 0 : y + dy > nm ? nm : y + dy, ky = dy ? 0.25 : 0.5, row = yy * n;
          for (let dx = -1; dx <= 1; dx++) { const xx = x + dx < 0 ? 0 : x + dx > nm ? nm : x + dx; s += (dx ? 0.25 : 0.5) * ky * landLUT[bio[row + xx]]; }
        }
        const i = y * n + x;
        if (landS[i] !== s) { landS[i] = s; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      }
      if (x1 >= 0) landPend = union(landPend, { x0, y0, x1, y1 });
    }
    // nilai daratan halus di titik ber-distorsi (sama dengan garis pantai render medan); >= LAND_T = darat
    function landAtWarped(x, y) {
      const W = n * R, px = Math.max(0, Math.min(W - 1, (x * R) | 0)), py = Math.max(0, Math.min(W - 1, (y * R) | 0)), i = py * W + px;
      return bil(landS, x + (fields.warpX[i] - 127.5) * WARP, y + (fields.warpY[i] - 127.5) * WARP);
    }

    // ---------- grid vertex (2/sel) seperti 3D: tinggi dunia, jarak bertanda ke pantai, kemiringan, cahaya ----------
    let VW = 0, Hc = null, SD = null, SL = null, LD = null, LH = null, AO = null, KR = null, KG = null, KB = null, vS = null, vD = null, vDw = null;
    let snowLine = SNOW_MIN;
    const rU = (a, b) => (!a ? b : !b ? a : { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) });
    const rG = (r, k, max) => r && { x0: Math.max(0, r.x0 - k), y0: Math.max(0, r.y0 - k), x1: Math.min(max, r.x1 + k), y1: Math.min(max, r.y1 + k) };
    // kotak vertex -> kotak sel yang pikselnya memakai vertex itu
    const v2c = (v) => v && { x0: Math.max(0, Math.floor((v.x0 - 2) / SUB)), y0: Math.max(0, Math.floor((v.y0 - 2) / SUB)), x1: Math.min(n - 1, Math.floor(v.x1 / SUB)), y1: Math.min(n - 1, Math.floor(v.y1 / SUB)) };
    function allocVerts() {
      const w = n * SUB + 1, len = w * w;
      VW = w; Hc = new Float32Array(len); SD = new Float32Array(len); SL = new Float32Array(len);
      LD = new Float32Array(len); LH = new Float32Array(len); AO = new Float32Array(len);
      KR = new Float32Array(len); KG = new Float32Array(len); KB = new Float32Array(len);   // pengali sRGB tanpa bayangan
      vS = new Uint8Array(len); vD = new Float32Array(len); vDw = new Float32Array(len);
    }
    // tinggi dunia di titik sel (bilinear grid vertex)
    function sampleH(px, py) {
      const w = VW, m = w - 1, gx = Math.max(0, Math.min(m, px * SUB)), gy = Math.max(0, Math.min(m, py * SUB));
      const i0 = Math.min(m - 1, gx | 0), j0 = Math.min(m - 1, gy | 0), fx = gx - i0, fy = gy - j0, k = j0 * w + i0;
      const a = Hc[k], b = Hc[k + 1], c = Hc[k + w], d = Hc[k + w + 1];
      return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
    }
    // jarak ke garis pantai (sama dengan coastDist 3D, seluruh grid): benih = vertex dekat kontur, lalu chamfer 2 lintasan
    function coastDist() {
      const nm = n - 1, w = VW, Gn = fields.G, wxG = fields.wxG, wyG = fields.wyG, LS = landS, D = vDw;
      for (let j = 0; j < w; j++) for (let i = 0; i < w; i++) {
        const k = j * w + i, g = j * Gn + i;
        let fx = i / SUB + (wxG[g] - 127.5) * WARP - 0.5, fy = j / SUB + (wyG[g] - 127.5) * WARP - 0.5;
        fx = fx < 0 ? 0 : fx > nm ? nm : fx; fy = fy < 0 ? 0 : fy > nm ? nm : fy;
        const x0 = fx | 0, y0 = fy | 0, x1 = x0 < nm ? x0 + 1 : x0, y1 = y0 < nm ? y0 + 1 : y0, tx = fx - x0, ty = fy - y0;
        const s00 = LS[y0 * n + x0], s10 = LS[y0 * n + x1], s01 = LS[y1 * n + x0], s11 = LS[y1 * n + x1];
        const L = s00 * (1 - tx) * (1 - ty) + s10 * tx * (1 - ty) + s01 * (1 - tx) * ty + s11 * tx * ty;
        const gx = (s10 - s00) * (1 - ty) + (s11 - s01) * ty, gy = (s01 - s00) * (1 - tx) + (s11 - s10) * tx;
        const d0 = Math.abs(L - LAND_T) / Math.max(0.2, Math.sqrt(gx * gx + gy * gy));
        vS[k] = L >= LAND_T ? 1 : 0;
        D[k] = d0 < 0.8 ? d0 : 1e9;
      }
      const st = 1 / SUB, dg = st * Math.SQRT2, m = w - 1;
      for (let j = 0; j < w; j++) for (let i = 0; i < w; i++) {
        const k = j * w + i;
        let d = D[k];
        if (i > 0 && D[k - 1] + st < d) d = D[k - 1] + st;
        if (j > 0) {
          if (D[k - w] + st < d) d = D[k - w] + st;
          if (i > 0 && D[k - w - 1] + dg < d) d = D[k - w - 1] + dg;
          if (i < m && D[k - w + 1] + dg < d) d = D[k - w + 1] + dg;
        }
        D[k] = d;
      }
      for (let j = m; j >= 0; j--) for (let i = m; i >= 0; i--) {
        const k = j * w + i;
        let d = D[k];
        if (i < m && D[k + 1] + st < d) d = D[k + 1] + st;
        if (j < m) {
          if (D[k + w] + st < d) d = D[k + w] + st;
          if (i < m && D[k + w + 1] + dg < d) d = D[k + w + 1] + dg;
          if (i > 0 && D[k + w - 1] + dg < d) d = D[k + w - 1] + dg;
        }
        D[k] = d;
        vD[k] = d < DCAP ? d : DCAP;
      }
    }
    // tinggi & jarak bertanda vertex di kotak V (rumus heightsRect 3D) -> { dh, ds } kotak vertex yang berubah
    function heightsRect(V) {
      const nm = n - 1, w = VW, t = terrain, h = t.h, land = t.land, shore = t.shore, bio = map.biome, wave = fields.wave, ridge = fields.ridge;
      let hx0 = w, hy0 = w, hx1 = -1, hy1 = -1, sx0 = w, sy0 = w, sx1 = -1, sy1 = -1;
      for (let j = V.y0; j <= V.y1; j++) for (let i = V.x0; i <= V.x1; i++) {
        const k = j * w + i, X = i / SUB, Y = j / SUB;
        let fx = X - 0.5, fy = Y - 0.5;
        fx = fx < 0 ? 0 : fx > nm ? nm : fx; fy = fy < 0 ? 0 : fy > nm ? nm : fy;
        const x0 = fx | 0, y0 = fy | 0, x1 = x0 < nm ? x0 + 1 : x0, y1 = y0 < nm ? y0 + 1 : y0, tx = fx - x0, ty = fy - y0;
        const a0 = y0 * n + x0, a1 = y0 * n + x1, a2 = y1 * n + x0, a3 = y1 * n + x1;
        const w0 = (1 - tx) * (1 - ty), w1 = tx * (1 - ty), w2 = (1 - tx) * ty, w3 = tx * ty;
        const l0 = land[a0] * w0, l1 = land[a1] * w1, l2 = land[a2] * w2, l3 = land[a3] * w3, wl = l0 + l1 + l2 + l3, ws = 1 - wl;
        const sumH = h[a0] * w0 + h[a1] * w1 + h[a2] * w2 + h[a3] * w3, sumL = h[a0] * l0 + h[a1] * l1 + h[a2] * l2 + h[a3] * l3;
        const d = vD[k];
        let H, S;
        if (vS[k]) {
          const HL = wl > 1e-6 ? sumL / wl : 0.05;
          const SH = shore[a0] * w0 + shore[a1] * w1 + shore[a2] * w2 + shore[a3] * w3;
          const MT = mtLUT[bio[a0]] * w0 + mtLUT[bio[a1]] * w1 + mtLUT[bio[a2]] * w2 + mtLUT[bio[a3]] * w3;
          let v = HL + sstep(0.3, 1, SH) * wave[k] * 0.09;
          if (MT > 0) v += MT * ridge[k] * 0.05;   // tekstur batu tipis saja (gunung membulat, tidak bergerigi)
          v *= VSCALE;
          const bank = BANK * d;
          H = Math.max(Math.min(v, bank), Math.min(bank, 0.08));
          S = d;
        } else {
          const HS = ws > 1e-6 ? (sumH - sumL) / ws : -0.03;
          H = Math.max(HS * VSCALE * SEA_DEEP, -(BANK * d + 0.9 * d * d));
          S = -d;
        }
        H = Math.fround(H); S = Math.fround(S);
        if (H !== Hc[k]) { if (i < hx0) hx0 = i; if (i > hx1) hx1 = i; if (j < hy0) hy0 = j; if (j > hy1) hy1 = j; }
        // jarak pantai hanya terlihat dalam -5.2..2 sel (cincin air dangkal, buih, pasir, batu tebing); di luar itu jenuh
        const cs = S < -5.2 ? -5.2 : S > 2 ? 2 : S, co = SD[k] < -5.2 ? -5.2 : SD[k] > 2 ? 2 : SD[k];
        if (cs !== co) { if (i < sx0) sx0 = i; if (i > sx1) sx1 = i; if (j < sy0) sy0 = j; if (j > sy1) sy1 = j; }
        Hc[k] = H; SD[k] = S;
      }
      return { dh: hx1 < 0 ? null : { x0: hx0, y0: hy0, x1: hx1, y1: hy1 }, ds: sx1 < 0 ? null : { x0: sx0, y0: sy0, x1: sx1, y1: sy1 } };
    }
    // kemiringan, oklusi (seperti warna vertex 3D) & cahaya (normal grid) di kotak E -> kotak yang berubah
    function lightRect(E) {
      const w = VW, H = Hc, m = w - 1;
      let x0 = w, y0 = w, x1 = -1, y1 = -1;
      for (let j = E.y0; j <= E.y1; j++) for (let i = E.x0; i <= E.x1; i++) {
        const k = j * w + i, hw = H[k];
        const hl = H[j * w + Math.max(0, i - 1)], hr = H[j * w + Math.min(m, i + 1)], hu = H[Math.max(0, j - 1) * w + i], hd = H[Math.min(m, j + 1) * w + i];
        const gx = (hr - hl) * SUB * 0.5, gz = (hd - hu) * SUB * 0.5;
        const sl = Math.fround(Math.sqrt(gx * gx + gz * gz));
        let ao = 1, ld = SUN[1], lh = 1;
        if (hw >= 0) {
          const c1 = H[j * w + Math.max(0, i - SUB)] + H[j * w + Math.min(m, i + SUB)] + H[Math.max(0, j - SUB) * w + i] + H[Math.min(m, j + SUB) * w + i];
          ao = Math.max(0.84, Math.min(1.06, 1 - (c1 * 0.25 - hw) * 0.12));
          const l = Math.sqrt(gx * gx + gz * gz + 1);
          ld = Math.max(0, (-gx * SUN[0] + SUN[1] - gz * SUN[2]) / l); lh = 0.5 / l + 0.5;
        }
        ao = Math.fround(ao); ld = Math.fround(ld); lh = Math.fround(lh);
        if (sl !== SL[k] || ao !== AO[k] || ld !== LD[k] || lh !== LH[k]) {
          SL[k] = sl; AO[k] = ao; LD[k] = ld; LH[k] = lh;
          KR[k] = fl((SUN_C[0] * ld + GND_C[0] + (SKY_C[0] - GND_C[0]) * lh) * ao);
          KG[k] = fl((SUN_C[1] * ld + GND_C[1] + (SKY_C[1] - GND_C[1]) * lh) * ao);
          KB[k] = fl((SUN_C[2] * ld + GND_C[2] + (SKY_C[2] - GND_C[2]) * lh) * ao);
          if (i < x0) x0 = i; if (i > x1) x1 = i; if (j < y0) y0 = j; if (j > y1) y1 = j;
        }
      }
      return x1 < 0 ? null : { x0, y0, x1, y1 };
    }
    // grid vertex di sekitar perubahan (T = kotak sel medan/bioma berubah; null = seluruh grid) -> kotak sel yang
    // tampilannya berubah (null = sama). Jarak pantai dihitung ulang hanya bila garis pantai bergeser, lalu tinggi
    // diperbarui sampai DCAP sel dari situ (seperti syncTerrain 3D)
    const c2v = (c) => ({ x0: Math.max(0, c.x0 * SUB), y0: Math.max(0, c.y0 * SUB), x1: Math.min(VW - 1, (c.x1 + 1) * SUB), y1: Math.min(VW - 1, (c.y1 + 1) * SUB) });
    function updateVerts(T) {
      const m = VW - 1;
      let V = T ? c2v(grow(T, 1)) : { x0: 0, y0: 0, x1: m, y1: m };
      if (landPend || !T) {
        coastDist();
        if (landPend) V = rU(V, c2v(grow(landPend, DCAP + 2)));
        landPend = null;
      }
      const { dh, ds } = heightsRect(V);
      const dl = dh ? lightRect(rG(dh, SUB, m)) : null;
      return v2c(rU(rU(dh, ds), dl));
    }
    function topHeight() { let mt = 0; for (let k = 0; k < Hc.length; k++) if (Hc[k] > mt) mt = Hc[k]; return mt; }

    // ---------- warna permukaan per piksel (port landColor map3d.js) ----------
    let LR = 0, LG = 0, LB = 0, SR = 0, SG = 0, SB = 0;   // keluaran landColor / seaColor
    let fieldAng = { c: 1, s: 0 };
    // edge = jarak ke pantai (sel), hT = terrain.h, hw/sl/sd = tinggi dunia, kemiringan, jarak bertanda grid vertex
    function landColor(bi, i, wu, wv, gr, m, edge, hT, hw, sl, sd) {
      let t = (m - 0.5) * 2.2 + 0.5; t = t < 0 ? 0 : t > 1 ? 1 : t;
      let r = cR[bi] + (aR[bi] - cR[bi]) * t, g = cG[bi] + (aG[bi] - cG[bi]) * t, b = cB[bi] + (aB[bi] - cB[bi]) * t;
      const p = pat[bi], seed = map.seed;
      let k, f, snowW = 0;
      switch (p) {
        case PAT.grass:            // bercak hijau lebih tua + bintik rumput halus
          f = vnoise(fields.nGrass, wu, wv);
          if (f > 0.55) { f = Math.min(1, (f - 0.55) * 3) * 0.45; r += (T_GRASS_D[0] - r) * f; g += (T_GRASS_D[1] - g) * f; b += (T_GRASS_D[2] - b) * f; }
          break;
        case PAT.fields: {         // ladang petak-petak + pematang tegas + alur bajak
          const fu = (wu * fieldAng.c - wv * fieldAng.s) / 3.4, fv = (wu * fieldAng.s + wv * fieldAng.c) / 2.4;   // petak ladang besar
          const row = Math.floor(fv), fu2 = fu + C.hash2(row, 7, seed) * 3.7, col = Math.floor(fu2);
          const fid = C.hash2(col, row, seed + 5), ex = fu2 - col, ey = fv - row;
          const tone = FIELD_TONES[(fid * FIELD_TONES.length) | 0];
          k = 0.97 + (m - 0.5) * 0.12;
          r = tone[0] * k; g = tone[1] * k; b = tone[2] * k;
          k = 1 + Math.sin((fid > 0.5 ? ex * 3.4 : ey * 2.4) * TAU * 1.6) * 0.04;
          r *= k; g *= k; b *= k;
          const e = Math.min(Math.min(ex, 1 - ex) * 3.4, Math.min(ey, 1 - ey) * 2.4);
          f = (1 - sstep(0.06, 0.13, e)) * 0.85;
          if (f > 0) { r += (T_HEDGE[0] - r) * f; g += (T_HEDGE[1] - g) * f; b += (T_HEDGE[2] - b) * f; }
          break;
        }
        case PAT.woods:            // lantai hutan: belang gelap
          k = 0.8 + vnoise(fields.nWoods, wu, wv) * 0.24;
          r *= k; g *= k; b *= k;
          break;
        case PAT.marsh:            // genangan bertepi terang + bintik
          f = 1 - sstep(0.32, 0.42, m);
          if (f > 0) { f *= 0.8; r += (T_POOL[0] - r) * f; g += (T_POOL[1] - g) * f; b += (T_POOL[2] - b) * f; }
          else if (m < 0.47) { f = (1 - sstep(0.42, 0.47, m)) * 0.3; r += (T_POOL_RIM[0] - r) * f; g += (T_POOL_RIM[1] - g) * f; b += (T_POOL_RIM[2] - b) * f; }
          if (gr > 0.9) { r *= 0.9; g *= 0.93; b *= 0.9; }
          break;
        case PAT.desert: {         // bukit pasir bergaris, punggung bukit terang
          const sn = Math.sin((wu * 0.75 + wv * 0.32) * 3.4 + m * 2.4);
          k = 1 + sn * 0.055 + (sn > 0.8 ? (sn - 0.8) * 0.35 : 0);
          r *= k; g *= k; b *= k;
          if (gr > 0.955) { r *= 0.9; g *= 0.87; b *= 0.82; }
          break;
        }
        case PAT.tundra:           // putih keabuan berawan + petak salju + batu kecil
          k = 0.95 + vnoise(fields.nTundra, wu, wv) * 0.08;
          r *= k; g *= k; b *= k * 1.01;
          f = sstep(0.6, 0.72, m) * 0.6;
          if (f > 0) { r += (T_SNOW[0] - r) * f; g += (T_SNOW[1] - g) * f; b += (T_SNOW[2] - b) * f; }
          if (gr > 0.955) { r *= 0.84; g *= 0.85; b *= 0.86; }
          snowW = 0.9;
          break;
        case PAT.cracks: {         // pelat besar bergaris retak tegas + retakan halus, rona per pelat
          const e = worleyT(fields.wBig, wu, wv);
          k = 0.94 + wCellOut * 0.1 + sstep(0, 0.35, e) * 0.05;
          r *= k; g *= k; b *= k;
          f = (1 - sstep(0.03, 0.075, e)) * 0.82;
          const e2 = worleyT(fields.wFine, wu, wv);
          f = Math.max(f, (1 - sstep(0.045, 0.12, e2)) * 0.34);
          if (f > 0) { r += (T_CRACK[0] - r) * f; g += (T_CRACK[1] - g) * f; b += (T_CRACK[2] - b) * f; }
          break;
        }
        case PAT.mountain: {       // bukit batu abu-abu: makin tinggi makin terang
          k = clamp01((hT - 0.2) / 0.75) * 0.75 + t * 0.25;
          r = cR[bi] + (aR[bi] - cR[bi]) * k; g = cG[bi] + (aG[bi] - cG[bi]) * k; b = cB[bi] + (aB[bi] - cB[bi]) * k;   // batu abu-abu netral
          // bukit batu ala ilustrasi: tepi tegas (tanpa kaki berumput) + guratan bongkah batu samar
          const e = worleyT(fields.wBig, wu * 0.8, wv * 0.8);
          k = 0.96 + wCellOut * 0.09 - (1 - sstep(0.02, 0.09, e)) * 0.08;
          r *= k; g *= k; b *= k;
          if (gr > 0.95) { r *= 0.95; g *= 0.95; b *= 0.95; }
          break;
        }
      }
      if (p !== PAT.mountain && hT > 0.45) { f = clamp01((hT - 0.45) / 0.45) * 0.38; r += (T_HIGH[0] - r) * f; g += (T_HIGH[1] - g) * f; b += (T_HIGH[2] - b) * f; }
      // tebing curam jadi batu (bukan tepi pantai)
      f = sl > 0.6 && p !== PAT.mountain ? sstep(0.6, 1.4, sl) * 0.8 * sstep(0.8, 1.6, sd) : 0;
      if (f > 0) { r += (T_ROCK[0] - r) * f; g += (T_ROCK[1] - g) * f; b += (T_ROCK[2] - b) * f; }
      // salju hanya di bagian puncak (relatif ke puncak tertinggi), tepinya berpetak
      f = hw < snowLine - 1.9 ? 0 : sstep(snowLine - 0.35, snowLine + 0.5, hw + (m - 0.5) * 2.4 + (fields.warpX[i] - 127.5) * 0.006) * (1 - sstep(2.6, 4, sl) * 0.5);
      if (f > 0) { r += (T_SNOW[0] - r) * f; g += (T_SNOW[1] - g) * f; b += (T_SNOW[2] - b) * f; }
      // tebing batu berlapis (shader medan 3D): pita & garis mendatar menurut tinggi dunia di lereng curam
      if (sl > 0.65 && p !== PAT.mountain) {   // gunung: batu mulus tanpa pita lapisan
        let rk = sstep(0.18, 0.45, 1 - 1 / Math.sqrt(1 + sl * sl)) * Math.min(1, sstep(0.7, 1.4, sl) * 0.77);
        rk *= 1 - Math.max(snowW, sstep(snowLine - 1, snowLine, hw));
        if (rk > 0) {
          const sv = hw * 0.95 + (m - 0.5) * 0.3, fr = sv - Math.floor(sv), ln = 1 - sstep(0.03, 0.1, Math.min(fr, 1 - fr));
          k = 1 + rk * (Math.sin(sv * TAU) * 0.06 - ln * 0.2);
          r *= k; g *= k; b *= k;
        }
      }
      // pantai: pasir tipis + garis gelap halus tepat di tepi
      if (edge < 0.6 && p !== PAT.tundra && p !== PAT.mountain) {   // cincin pasir krem di sisi darat garis pantai
        f = (1 - sstep(0.25, 0.6, edge)) * 0.75; r += (T_SAND[0] - r) * f; g += (T_SAND[1] - g) * f; b += (T_SAND[2] - b) * f;
      }
      if (edge < 0.06) { k = 0.86 + edge * 2.3; r *= k; g *= k; b *= k; }
      k = 0.965 + gr * 0.07;
      LR = r * k; LG = g * k; LB = b * k;
    }
    // air seperti shader air 3D (dilihat dari atas): warna menurut jarak ke pantai (dist, sel), bercak awan, buih, garis tinta,
    // tembus pandang ke dasar laut (pasir -> biru gelap menurut kedalaman); shd = bayangan (0..1)
    let BLA = null, BLB = null;   // bercak per piksel (getBlotPix)
    function seaColor(i, gr, dist, depth, shd, floorOnly) {
      const kg = 0.97 + gr * 0.06;
      if (dist > 5.5 && depth > 4.5 && shd === 0 && !floorOnly) {
        const q = BLA[i];
        SR = OPEN[0][q] + DEEPF[0] * kg; SG = OPEN[1][q] + DEEPF[1] * kg; SB = OPEN[2][q] + DEEPF[2] * kg;
        return;
      }
      const td = sstep(0.25, 4.5, depth);
      const fr = (T_FLOOR[0] + (T_DEEP[0] - T_FLOOR[0]) * td) * kg * FLAT[0], fg = (T_FLOOR[1] + (T_DEEP[1] - T_FLOOR[1]) * td) * kg * FLAT[1], fb = (T_FLOOR[2] + (T_DEEP[2] - T_FLOOR[2]) * td) * kg * FLAT[2];
      if (floorOnly) { SR = fr; SG = fg; SB = fb; return; }
      if (dist < 0) dist = 0;
      const bl = BLV[BLA[i]], wob = BLV[BLB[i]] - 0.93;
      const tD = sstep(0.5, 4.2, dist + wob * 9);
      let r = bl * (W_SH[0] + (W_DP[0] - W_SH[0]) * tD), g = bl * (W_SH[1] + (W_DP[1] - W_SH[1]) * tD), b = bl * (W_SH[2] + (W_DP[2] - W_SH[2]) * tD);
      let a = 0.86 + 0.09 * tD;
      const fo = 1 - sstep(0.1, 1.25 + wob * 7, dist), rip = (1 - sstep(0, 0.07, Math.abs(dist - 2.1 - wob * 4))) * 0.08;
      let f = Math.max(fo * fo * 0.95, rip);
      if (f > 0) { r += (W_FOAM[0] - r) * f; g += (W_FOAM[1] - g) * f; b += (W_FOAM[2] - b) * f; a += (0.98 - a) * fo; }
      f = 1 - sstep(0.07, 0.17, dist);
      if (f > 0) { const q = f * 0.85; r += (W_INK[0] - r) * q; g += (W_INK[1] - g) * q; b += (W_INK[2] - b) * q; a += (1 - a) * f; }
      const ds = SUN[1] * (1 - shd);
      r = enc(r * (SUN_C[0] * ds + SKY_C[0])); g = enc(g * (SUN_C[1] * ds + SKY_C[1])); b = enc(b * (SUN_C[2] * ds + SKY_C[2]));
      SR = r * a + fr * (1 - a); SG = g * a + fg * (1 - a); SB = b * a + fb * (1 - a);
    }
    // bioma piksel darat: bobot bilinear terbesar di antara sudut darat (batas bioma ikut kontur, bukan tangga sel).
    // pb2/pbd = bioma kedua & selisih bobotnya -> dipakai untuk anti-alias batas bioma
    let pb2 = -1, pbd = 1;
    function pickBiome(b00, b10, b01, b11, k00, k10, k01, k11, x0, y0, x1, y1, tx, ty) {
      let best = -1, bw = -1, sec = -1, sw = -1, w;
      const take = (b) => { if (w > bw) { sec = best; sw = bw; best = b; bw = w; } else if (w > sw) { sec = b; sw = w; } };
      if (landLUT[b00]) { w = k00 + (b10 === b00 ? k10 : 0) + (b01 === b00 ? k01 : 0) + (b11 === b00 ? k11 : 0); take(b00); }
      if (landLUT[b10] && b10 !== b00) { w = k10 + (b01 === b10 ? k01 : 0) + (b11 === b10 ? k11 : 0); take(b10); }
      if (landLUT[b01] && b01 !== b00 && b01 !== b10) { w = k01 + (b11 === b01 ? k11 : 0); take(b01); }
      if (landLUT[b11] && b11 !== b00 && b11 !== b10 && b11 !== b01) { w = k11; take(b11); }
      pb2 = sec; pbd = sec >= 0 ? bw - sw : 1;
      if (best >= 0) return best;
      // teluk sempit yang tertutup oleh penghalusan: ambil darat terdekat di sekitar sel
      const cx = tx < 0.5 ? x0 : x1, cy = ty < 0.5 ? y0 : y1, nm = n - 1, bio = map.biome;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const b = bio[Math.max(0, Math.min(nm, cy + dy)) * n + Math.max(0, Math.min(nm, cx + dx))];
        if (landLUT[b]) return b;
      }
      return 1;
    }

    let fullImg = null;
    function renderGround(bb) {
      const W = n * R, nm = n - 1, inv = 1 / R, w = VW, m1 = w - 1;
      const px0 = bb.x0 * R, py0 = bb.y0 * R, pw = (bb.x1 - bb.x0 + 1) * R, ph = (bb.y1 - bb.y0 + 1) * R;
      const img = pw === W && ph === W ? fullImg || (fullImg = gctx.createImageData(W, W)) : gctx.createImageData(pw, ph), out = img.data;
      const wX = fields.warpX, wY = fields.warpY, GR = fields.grain, MO = fields.mottle, bio = map.biome, LS = landS, TH = terrain.h;
      const Hv = Hc, SDv = SD, SLv = SL, LDv = LD, LHv = LH, AOv = AO, KRv = KR, KGv = KG, KBv = KB, SHB = shadowBuf, CD = coastD;
      const a = (C.hash2(map.seed, 3, 17) - 0.5) * 0.7;
      fieldAng = { c: Math.cos(a), s: Math.sin(a) };
      const bp = getBlotPix(C, n);
      BLA = bp.a; BLB = bp.b;
      let o = 0;
      for (let py = py0; py < py0 + ph; py++) {
        const v = (py + 0.5) * inv, gv = v * SUB, j0 = Math.min(m1 - 1, gv | 0), fyv = gv - j0;
        for (let px = px0; px < px0 + pw; px++, o += 4) {
          const i = py * W + px, u = (px + 0.5) * inv;
          // tinggi/jarak pantai/cahaya grid vertex (bilinear, tanpa distorsi)
          const gu = u * SUB, i0 = Math.min(m1 - 1, gu | 0), fxv = gu - i0, vk = j0 * w + i0, vk2 = vk + w;
          const e00 = (1 - fxv) * (1 - fyv), e10 = fxv * (1 - fyv), e01 = (1 - fxv) * fyv, e11 = fxv * fyv;
          const hw = Hv[vk] * e00 + Hv[vk + 1] * e10 + Hv[vk2] * e01 + Hv[vk2 + 1] * e11;
          const sd = SDv[vk] * e00 + SDv[vk + 1] * e10 + SDv[vk2] * e01 + SDv[vk2 + 1] * e11;
          const gr = GR[i] * (1 / 255), shd = SHB[i] * (1 / 255);
          if (sd < -3.5) {   // laut jauh dari pantai: tanpa topeng darat
            seaColor(i, gr, -sd, -hw, shd, hw > 0.05);
            out[o] = SR; out[o + 1] = SG; out[o + 2] = SB; out[o + 3] = 255; CD[i] = -127;
            continue;
          }
          // topeng darat pada titik terdistorsi
          const wu = u + (wX[i] - 127.5) * WARP, wv = v + (wY[i] - 127.5) * WARP;
          let fx = wu - 0.5, fy = wv - 0.5;
          fx = fx < 0 ? 0 : fx > nm ? nm : fx; fy = fy < 0 ? 0 : fy > nm ? nm : fy;
          const x0 = fx | 0, y0 = fy | 0, x1 = x0 < nm ? x0 + 1 : x0, y1 = y0 < nm ? y0 + 1 : y0, tx = fx - x0, ty = fy - y0;
          const q00 = y0 * n + x0, q10 = y0 * n + x1, q01 = y1 * n + x0, q11 = y1 * n + x1;
          const s00 = LS[q00], s10 = LS[q10], s01 = LS[q01], s11 = LS[q11];
          let r, g, b, cd = 127;
          if (s00 === 0 && s10 === 0 && s01 === 0 && s11 === 0) {
            seaColor(i, gr, -sd, -hw, shd, hw > 0.05); r = SR; g = SG; b = SB; cd = -127;   // dasar laut di atas muka air = beting pasir
          } else {
            const k00 = (1 - tx) * (1 - ty), k10 = tx * (1 - ty), k01 = (1 - tx) * ty, k11 = tx * ty;
            const b00 = bio[q00], b10 = bio[q10], b01 = bio[q01], b11 = bio[q11];
            const uni = b00 === b10 && b00 === b01 && b00 === b11 && landLUT[b00];
            const bi = uni ? b00 : pickBiome(b00, b10, b01, b11, k00, k10, k01, k11, x0, y0, x1, y1, tx, ty);
            const hT = TH[q00] * k00 + TH[q10] * k10 + TH[q01] * k01 + TH[q11] * k11, m = MO[i] * (1 / 255);
            const sl = SLv[vk] * e00 + SLv[vk + 1] * e10 + SLv[vk2] * e01 + SLv[vk2 + 1] * e11;
            // cahaya: matahari (dikurangi bayangan) + langit/tanah, x oklusi -> pengali sRGB per kanal
            let kr, kg, kb;
            if (shd === 0) {
              kr = KRv[vk] * e00 + KRv[vk + 1] * e10 + KRv[vk2] * e01 + KRv[vk2 + 1] * e11;
              kg = KGv[vk] * e00 + KGv[vk + 1] * e10 + KGv[vk2] * e01 + KGv[vk2 + 1] * e11;
              kb = KBv[vk] * e00 + KBv[vk + 1] * e10 + KBv[vk2] * e01 + KBv[vk2 + 1] * e11;
            } else {
              const ld = (LDv[vk] * e00 + LDv[vk + 1] * e10 + LDv[vk2] * e01 + LDv[vk2 + 1] * e11) * (1 - shd);
              const lh = LHv[vk] * e00 + LHv[vk + 1] * e10 + LHv[vk2] * e01 + LHv[vk2 + 1] * e11;
              const ao = AOv[vk] * e00 + AOv[vk + 1] * e10 + AOv[vk2] * e01 + AOv[vk2 + 1] * e11;
              kr = fl((SUN_C[0] * ld + GND_C[0] + (SKY_C[0] - GND_C[0]) * lh) * ao);
              kg = fl((SUN_C[1] * ld + GND_C[1] + (SKY_C[1] - GND_C[1]) * lh) * ao);
              kb = fl((SUN_C[2] * ld + GND_C[2] + (SKY_C[2] - GND_C[2]) * lh) * ao);
            }
            if (pat[bi] === PAT.mountain) {   // bukit batu: bayang-terang dipertegas supaya bentuknya terbaca dari atas
              kr = FLAT[0] + (kr - FLAT[0]) * MT_SHADE; kg = FLAT[1] + (kg - FLAT[1]) * MT_SHADE; kb = FLAT[2] + (kb - FLAT[2]) * MT_SHADE;
            }
            if (s00 === 1 && s10 === 1 && s01 === 1 && s11 === 1) {
              landColor(bi, i, wu, wv, gr, m, 1, hT, hw, sl, sd); r = LR; g = LG; b = LB;
              if (!uni && pb2 >= 0 && pbd < 0.14) {   // anti-alias batas antar bioma
                const t = 0.5 + pbd / 0.28;
                landColor(pb2, i, wu, wv, gr, m, 1, hT, hw, sl, sd);
                r = r * t + LR * (1 - t); g = g * t + LG * (1 - t); b = b * t + LB * (1 - t);
              }
              r *= kr; g *= kg; b *= kb;
            } else {
              // tepi pantai: jarak bertanda ke kontur (satuan sel) -> anti-alias darat/air, buih & garis tinta di sisi air
              const L = s00 * k00 + s10 * k10 + s01 * k01 + s11 * k11;
              const gx = (s10 - s00) * (1 - ty) + (s11 - s01) * ty, gy = (s01 - s00) * (1 - tx) + (s11 - s10) * tx;
              const d = (L - LAND_T) / Math.max(0.2, Math.sqrt(gx * gx + gy * gy));
              const al = clamp01(0.5 + d * R);
              cd = d < -1.98 ? -127 : d > 1.98 ? 127 : Math.round(d * 64);
              r = g = b = 0;
              if (al > 0) { landColor(bi, i, wu, wv, gr, m, d < 0 ? 0 : d, hT, hw, sl, sd); r = LR * kr * al; g = LG * kg * al; b = LB * kb * al; }
              if (al < 1) {
                const dA = -d, dV = -sd;   // dekat kontur pakai jarak analitik, makin jauh berbaur ke jarak grid
                seaColor(i, gr, dA < 0.5 ? dA : dA < 1 ? dA + (dV - dA) * (dA - 0.5) * 2 : dV, -hw, shd, false);
                r += SR * (1 - al); g += SG * (1 - al); b += SB * (1 - al);
              }
            }
          }
          out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = 255; CD[i] = cd;
        }
      }
      gctx.putImageData(img, px0, py0);
      forChunks(bb.x0 - 1, bb.y0 - 1, bb.x1 + 1, bb.y1 + 1, (ci) => { coastPaths[ci] = undefined; });
    }

    // ================= DEKOR: pohon & puncak gunung per potongan (posisi = buildTrees/buildMountains 3D) =================
    // instance: { x, y, k (jenis), v/t (varian sprite), s (skala; puncak: jari), sy (skala tegak), h (tinggi puncak),
    //             e: kotak sprite [x0,y0,x1,y1] (sel), se: kotak bayangan, key }
    function decorInst(q) {
      const d = DECOR[q.k], hw = d.dim.w / 2;
      q.e = [q.x - hw * q.s, q.y - d.dim.h * q.s * q.sy, q.x + hw * q.s, q.y + 0.05];
      const h0 = d.sh[0] * q.s * q.sy, r0 = d.sh[1] * q.s, h1 = d.sh[2] * q.s * q.sy, r1 = d.sh[3] * q.s;
      q.sh = [q.x + SHX * h0, q.y + SHY * h0, r0, q.x + SHX * h1, q.y + SHY * h1, r1];
      const rr = Math.max(r0, r1) + 0.2;
      q.se = [Math.min(q.sh[0], q.sh[3]) - rr, Math.min(q.sh[1], q.sh[4]) - rr, Math.max(q.sh[0], q.sh[3]) + rr, Math.max(q.sh[1], q.sh[4]) + rr];
      q.key = q.k * 1e10 + Math.round(q.x * 256) * 65536 + Math.round(q.y * 256);
      return q;
    }
    // area bebas pohon: sekitar jalan & tempat (sama dengan 3D)
    function buildMask() {
      const m = new Uint8Array(n * n), cl = (v) => Math.max(0, Math.min(n - 1, v));
      (map.paths || []).forEach((pa) => {
        const pts = pa.points, rad = 0.9;
        if (!pts || pts.length < 2) return;
        for (let s = 1; s < pts.length; s++) {
          const [ax, ay] = pts[s - 1], [bx, by] = pts[s];
          for (let y = cl(Math.floor(Math.min(ay, by) - rad)); y <= cl(Math.ceil(Math.max(ay, by) + rad)); y++)
            for (let x = cl(Math.floor(Math.min(ax, bx) - rad)); x <= cl(Math.ceil(Math.max(ax, bx) + rad)); x++)
              if (!m[y * n + x] && C.distToSegment(x + 0.5, y + 0.5, ax, ay, bx, by) <= rad) m[y * n + x] = 1;
        }
      });
      (map.places || []).forEach((pl) => {
        for (let y = cl(Math.floor(pl.y - 2)); y <= cl(Math.ceil(pl.y + 2)); y++)
          for (let x = cl(Math.floor(pl.x - 2)); x <= cl(Math.ceil(pl.x + 2)); x++)
            if (Math.hypot(x + 0.5 - pl.x, y + 0.5 - pl.y) <= 1.6) m[y * n + x] = 1;
      });
      return m;
    }
    function buildChunk(cx, cy) {
      const list = [], seed = map.seed, bio = map.biome, river = terrain.river;
      const x0 = cx * CHUNK, y0 = cy * CHUNK, x1 = Math.min(n, x0 + CHUNK), y1 = Math.min(n, y0 + CHUNK);
      // pohon: grid ber-jitter per jarak (hash sama dengan 3D -> pohon di tempat yang sama)
      for (const sp of SPACINGS) {
        const sd = seed + 911 + Math.round(sp * 100) * 7919, GN = Math.ceil(n / sp);
        for (let gy = Math.max(0, Math.floor(y0 / sp) - 1); gy <= Math.min(GN - 1, Math.ceil(y1 / sp)); gy++)
          for (let gx = Math.max(0, Math.floor(x0 / sp) - 1); gx <= Math.min(GN - 1, Math.ceil(x1 / sp)); gx++) {
            const x = (gx + 0.5 + (C.hash2(gx, gy, sd) - 0.5) * 0.86) * sp, y = (gy + 0.5 + (C.hash2(gx, gy, sd + 1) - 0.5) * 0.86) * sp;
            if (x < x0 || x >= x1 || y < y0 || y >= y1) continue;
            if (x < 0.05 || y < 0.05 || x > n - 0.05 || y > n - 0.05) continue;
            const ci = (y | 0) * n + (x | 0), cfg = treeCfg[bio[ci]];
            if (!cfg || cfg.s !== sp || river[ci] || mask[ci] || C.hash2(gx, gy, sd + 2) >= cfg.p) continue;
            if (landAtWarped(x, y) < 0.8) continue;
            const h = sampleH(x, y);
            if (h < 0.22 || h > snowLine) continue;
            const sl = Math.abs(sampleH(x + 0.5, y) - sampleH(x - 0.5, y)) + Math.abs(sampleH(x, y + 0.5) - sampleH(x, y - 0.5));
            if (sl > 1.7) continue;
            const r1 = C.hash2(gx, gy, sd + 3), r2 = C.hash2(gx, gy, sd + 4), r3 = C.hash2(gx, gy, sd + 5);
            const k = cfg.mix ? (r3 < 0.35 ? KIND.pineLight : KIND.broadLight) : cfg.kind, sz = TREE_SIZE[k];
            list.push(decorInst({ x, y, k, v: (((r2 * 3.1) % 1) * TREE_ROT) | 0, t: Math.min(2, (r2 * 3) | 0) * 2 + (r3 < 0.5 ? 0 : 1),
              s: (sz[0] + sz[1] * r1) * cfg.z, sy: 0.9 + r3 * 0.24 }));
          }
      }
      list.sort((a, b) => a.y - b.y || a.x - b.x);
      return list;
    }
    const extU = (r, e) => (!r ? e.slice() : [Math.min(r[0], e[0]), Math.min(r[1], e[1]), Math.max(r[2], e[2]), Math.max(r[3], e[3])]);
    const e2c = (e) => ({ x0: Math.max(0, Math.floor(e[0])), y0: Math.max(0, Math.floor(e[1])), x1: Math.min(n - 1, Math.floor(e[2])), y1: Math.min(n - 1, Math.floor(e[3])) });
    function forChunks(x0, y0, x1, y1, fn) {
      for (let cy = Math.max(0, Math.floor(y0 / CHUNK)); cy <= Math.min(CN - 1, Math.floor(y1 / CHUNK)); cy++)
        for (let cx = Math.max(0, Math.floor(x0 / CHUNK)); cx <= Math.min(CN - 1, Math.floor(x1 / CHUNK)); cx++) fn(cy * CN + cx, cx, cy);
    }
    // bangun ulang dekor potongan yang menyentuh kotak sel bb; ubin & bayangan instance yang berubah ikut diperbarui.
    // -> kotak sel tanah yang perlu dirender ulang karena bayangannya berubah (atau null)
    function rebuildDecor(bb) {
      let spr = null, shd = null;
      forChunks(bb.x0, bb.y0, bb.x1, bb.y1, (ci, cx, cy) => {
        const old = chunks[ci] || [], nw = buildChunk(cx, cy), om = new Map();
        for (const q of old) om.set(q.key, q);
        for (const q of nw) {
          const o = om.get(q.key);
          if (o && o.v === q.v && o.t === q.t && o.s === q.s && o.sy === q.sy) om.delete(q.key);
          else { spr = extU(spr, q.e); shd = extU(shd, q.se); }
        }
        om.forEach((q) => { spr = extU(spr, q.e); shd = extU(shd, q.se); });
        chunks[ci] = nw;
      });
      if (spr) invalidateTiles(spr);
      if (!shd) return null;
      const r = e2c(shd);
      stampShadows(r);
      return r;
    }
    // instance yang kotaknya (e = sprite / se = bayangan) menyentuh kotak sel [x0,y0,x1,y1]
    function gatherDecor(x0, y0, x1, y1, shadow) {
      const out = [], M = 5.5;
      forChunks(x0 - M, y0 - M, x1 + M, y1 + M, (ci) => {
        const l = chunks[ci];
        if (l) for (const q of l) { const e = shadow ? q.se : q.e; if (e[2] >= x0 && e[0] <= x1 && e[3] >= y0 && e[1] <= y1) out.push(q); }
      });
      return out;
    }
    // bayangan pohon & puncak ke tanah (8 px/sel, seperti peta bayangan 3D): kapsul meruncing dari kaki ke ujung bayangan
    const SH_SOFT = 0.14, SH_MAX = 236;
    function stampShadows(rc) {
      const W = n * R, px0 = rc.x0 * R, py0 = rc.y0 * R, px1 = (rc.x1 + 1) * R - 1, py1 = (rc.y1 + 1) * R - 1, B = shadowBuf;
      for (let py = py0; py <= py1; py++) B.fill(0, py * W + px0, py * W + px1 + 1);
      for (const q of gatherDecor(rc.x0, rc.y0, rc.x1 + 1, rc.y1 + 1, true)) {
        const [ax, ay, r0, bx, by, r1] = q.sh, dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1e-6;
        const X0 = Math.max(px0, Math.floor(q.se[0] * R)), X1 = Math.min(px1, Math.ceil(q.se[2] * R)), Y0 = Math.max(py0, Math.floor(q.se[1] * R)), Y1 = Math.min(py1, Math.ceil(q.se[3] * R));
        for (let py = Y0; py <= Y1; py++) {
          const cy = (py + 0.5) / R - ay;
          for (let px = X0; px <= X1; px++) {
            const cx = (px + 0.5) / R - ax;
            let t = (cx * dx + cy * dy) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
            const ex = cx - dx * t, ey = cy - dy * t, rr = r0 + (r1 - r0) * t, c = (rr - Math.sqrt(ex * ex + ey * ey)) / SH_SOFT + 0.5;
            if (c <= 0) continue;
            const v = c >= 1 ? SH_MAX : c * SH_MAX, k = py * W + px;
            if (v > B[k]) B[k] = v;
          }
        }
      }
    }

    // ---------- ubin dekor (zoom jauh): satu kanvas per potongan per ember ukuran, isinya sprite urut belakang->depan ----------
    function freeTile(t) { if (t.cv) { tilePx -= t.cv.width * t.cv.height; t.cv.width = t.cv.height = 0; t.cv = null; } }
    function invalidateTiles(e) {
      forChunks(e[0], e[1], e[2], e[3], (ci) => { const m = tiles[ci]; if (m) { m.forEach(freeTile); m.clear(); } });
    }
    function clearTiles() { tiles.forEach((m) => m && m.forEach(freeTile)); tiles = []; tilePx = 0; }
    function drawInst(g, q, X, Y, ppc) {   // X,Y = px titik kaki; ppc = px per sel
      const P = ppc * q.s, sp = getSprite(q.k, q.v, q.t, P), f = P / sp.P, fy = f * q.sy;
      g.drawImage(sp.cv, X - sp.ax * f, Y - sp.ay * fy, sp.w * f, sp.h * fy);
    }
    function renderTile(ci, b) {
      const cx = ci % CN, cy = (ci / CN) | 0, size = Math.max(1, Math.round(CHUNK * bucketPx(b))), ppc = size / CHUNK;
      const X0 = cx * CHUNK, Y0 = cy * CHUNK, list = gatherDecor(X0, Y0, X0 + CHUNK, Y0 + CHUNK, false);
      const t = { cv: null, used: frameNo };
      if (list.length) {
        list.sort((a, b2) => a.y - b2.y || a.x - b2.x);
        const c = document.createElement("canvas");
        c.width = c.height = size;
        const g = c.getContext("2d");
        for (const q of list) drawInst(g, q, (q.x - X0) * ppc, (q.y - Y0) * ppc, ppc);
        t.cv = c; tilePx += size * size;
      }
      (tiles[ci] || (tiles[ci] = new Map())).set(b, t);
      return t;
    }
    function evictTiles() {
      if (tilePx <= TILE_BUDGET) return;
      const all = [];
      tiles.forEach((m) => m && m.forEach((t, b) => { if (t.cv && t.used < frameNo) all.push([t.used, m, b, t]); }));
      all.sort((a, b) => a[0] - b[0]);
      for (const [, m, b, t] of all) { if (tilePx <= TILE_BUDGET * 0.8) break; freeTile(t); m.delete(b); }
    }
    // garis tinta pantai vektor (zoom dekat): kontur jarak = COAST_L dari coastD dengan marching squares per potongan
    // (tekstur medan hanya 8 px/sel; 3D menggambar garis ini per piksel layar, jadi tetap tajam saat diperbesar)
    const COAST_L = -0.045 * 64;
    function coastPath(ci) {
      let p = coastPaths[ci];
      if (p !== undefined) return p;
      const W = n * R, cx = ci % CN, cy = (ci / CN) | 0, CD = coastD, L = COAST_L;
      const X0 = cx * CHUNK * R, Y0 = cy * CHUNK * R, X1 = Math.min(W - 2, X0 + CHUNK * R - 1), Y1 = Math.min(W - 2, Y0 + CHUNK * R - 1);
      // segmen: [id sisi A, x, y, id sisi B, x, y]; id sisi grid unik -> segmen bisa disambung jadi polyline
      const segs = [], at = new Map();
      for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++) {
        const i = y * W + x, a = CD[i] - L, b = CD[i + 1] - L, c = CD[i + W + 1] - L, d = CD[i + W] - L;
        const k = (a > 0 ? 1 : 0) | (b > 0 ? 2 : 0) | (c > 0 ? 4 : 0) | (d > 0 ? 8 : 0);
        if (k === 0 || k === 15) continue;
        const E = (s0) => s0 === 0 ? [i * 2, x + a / (a - b), y] : s0 === 1 ? [(i + 1) * 2 + 1, x + 1, y + b / (b - c)]
          : s0 === 2 ? [(i + W) * 2, x + d / (d - c), y + 1] : [i * 2 + 1, x, y + a / (a - d)];
        const seg = (s0, s1) => {
          const A = E(s0), B = E(s1), q = segs.length;
          segs.push([A[0], (A[1] + 0.5) / R, (A[2] + 0.5) / R, B[0], (B[1] + 0.5) / R, (B[2] + 0.5) / R]);
          for (const id of [A[0], B[0]]) { const l = at.get(id); if (l) l.push(q); else at.set(id, [q]); }
        };
        const ctr = a + b + c + d > 0;
        switch (k) {
          case 1: case 14: seg(0, 3); break;
          case 2: case 13: seg(0, 1); break;
          case 3: case 12: seg(1, 3); break;
          case 4: case 11: seg(1, 2); break;
          case 6: case 9: seg(0, 2); break;
          case 7: case 8: seg(2, 3); break;
          case 5: if (ctr) { seg(0, 1); seg(2, 3); } else { seg(0, 3); seg(1, 2); } break;
          case 10: if (ctr) { seg(0, 3); seg(1, 2); } else { seg(0, 1); seg(2, 3); } break;
        }
      }
      p = null;
      if (segs.length) {
        const used = new Uint8Array(segs.length);
        // dari ujung sisi `id` lanjut ke segmen lain yang belum dipakai; tambahkan titik ke pts
        const walk = (id, pts) => {
          for (;;) {
            const l = at.get(id), q = l && l.find((j) => !used[j]);
            if (q === undefined) return;
            used[q] = 1;
            const g = segs[q], fwd = g[0] === id;
            pts.push(fwd ? [g[4], g[5]] : [g[1], g[2]]);
            id = fwd ? g[3] : g[0];
          }
        };
        p = new Path2D();
        for (let q = 0; q < segs.length; q++) {
          if (used[q]) continue;
          used[q] = 1;
          const g = segs[q], fw = [[g[1], g[2]], [g[4], g[5]]], bw = [];
          walk(g[3], fw); walk(g[0], bw);
          const pts = simplify(C, bw.reverse().concat(fw), 0.02);
          p.moveTo(pts[0][0], pts[0][1]);
          for (let j = 1; j < pts.length; j++) p.lineTo(pts[j][0], pts[j][1]);
        }
      }
      coastPaths[ci] = p;
      return p;
    }
    function drawCoast() {
      // garis tinta biru tua tegas di setiap pantai/tepi danau (vektor -> tetap tajam di semua zoom, ala peta ilustrasi)
      const s = view.scale, a = clamp01((s - 1.2) / 1.5);
      if (a <= 0) return;
      const vx0 = -view.ox / s, vy0 = -view.oy / s, vx1 = (cssW - view.ox) / s, vy1 = (cssH - view.oy) / s;
      ctx.save();
      ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * view.ox, dpr * view.oy);
      ctx.globalAlpha = a; ctx.strokeStyle = "#263a4c"; ctx.lineWidth = Math.max(1.3, Math.min(4.2, s * 0.3)) / s; ctx.lineCap = "round"; ctx.lineJoin = "round";
      forChunks(vx0 - 0.5, vy0 - 0.5, vx1 + 0.5, vy1 + 0.5, (ci) => { const p = coastPath(ci); if (p) ctx.stroke(p); });
      ctx.restore();
    }
    function drawDecor() {
      frameNo++;
      const s = view.scale, dev = s * dpr;
      const vx0 = -view.ox / s, vy0 = -view.oy / s, vx1 = (cssW - view.ox) / s, vy1 = (cssH - view.oy) / s;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (dev > TILE_MAX) {   // zoom dekat: sprite langsung (hanya yang terlihat)
        const list = gatherDecor(vx0, vy0, vx1, vy1, false);
        list.sort((a, b) => a.y - b.y || a.x - b.x);
        for (const q of list) drawInst(ctx, q, dpr * (view.ox + q.x * s), dpr * (view.oy + q.y * s), dev);
      } else {
        const b = bucketOf(dev), t0 = performance.now();
        let late = false, made = 0;
        forChunks(vx0, vy0, vx1, vy1, (ci, cx, cy) => {
          const m = tiles[ci];
          let t = m && m.get(b);
          if (!t) {
            // ember baru (zoom): bila waktu frame sudah habis, pakai sementara ubin ember lain lalu lanjut di frame berikut
            // (minimal satu ubin baru per frame supaya selalu maju)
            let fb = null, fk = 0;
            if (m && made && performance.now() - t0 > 12) m.forEach((x, kb) => { if (!fb || Math.abs(kb - b) < Math.abs(fk - b)) { fb = x; fk = kb; } });
            if (fb) { t = fb; late = true; } else { t = renderTile(ci, b); made++; }
          }
          t.used = frameNo;
          if (!t.cv) return;
          const x0 = Math.round(dpr * (view.ox + cx * CHUNK * s)), x1 = Math.round(dpr * (view.ox + (cx + 1) * CHUNK * s));
          const y0 = Math.round(dpr * (view.oy + cy * CHUNK * s)), y1 = Math.round(dpr * (view.oy + (cy + 1) * CHUNK * s));
          ctx.drawImage(t.cv, x0, y0, x1 - x0, y1 - y0);
        });
        if (late) requestDraw(true, false);
        evictTiles();
      }
      ctx.restore();
    }

    // hitung ulang medan penuh lalu render ulang hanya sel yang berbeda (+ tepi pengaruh, vertex yang berubah, bayangan dekor).
    // live = sedang menyapu (garis salju relatif puncak tertinggi baru diperbarui saat sapuan selesai, seperti 3D)
    function syncTerrain(full, live) {
      const t0 = performance.now();
      const nt = C.computeTerrain(map);
      let bb = null;
      if (full || !terrain) bb = { x0: 0, y0: 0, x1: n - 1, y1: n - 1 };
      else {
        const b = map.biome, ob = drawnBiome, h = nt.h, oh = terrain.h, s = nt.shore, os = terrain.shore, rv = nt.river, orv = terrain.river;
        let x0 = n, y0 = n, x1 = -1, y1 = -1;
        for (let y = 0, i = 0; y < n; y++) for (let x = 0; x < n; x++, i++) {
          if (b[i] !== ob[i] || h[i] !== oh[i] || s[i] !== os[i] || rv[i] !== orv[i]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
        }
        if (x1 >= 0) bb = { x0, y0, x1, y1 };
      }
      terrain = nt; drawnBiome.set(map.biome);
      if (bb) {
        updateLandS(grow(bb, 1));
        const rc = union(bb, updateVerts(full ? null : bb));
        if (full) snowLine = Math.max(SNOW_MIN, topHeight() * 0.78);
        const sr = rebuildDecor(grow(rc, 1));
        renderGround(union(grow(rc, 2), sr));
        needMain = true;
      }
      if (!live && !full) settleSnow();
      terrainCost = performance.now() - t0;
    }
    // garis salju relatif ke puncak tertinggi (sama dengan 3D): bila bergeser, perbarui hanya bagian yang cukup tinggi
    function settleSnow() {
      const sl = Math.max(SNOW_MIN, topHeight() * 0.78);
      if (sl === snowLine) return;
      const lo = Math.min(sl, snowLine) - 2.5, w = VW;
      snowLine = sl;
      let r = null;
      for (let j = 0, k = 0; j < w; j++) for (let i = 0; i < w; i++, k++) if (Hc[k] >= lo) r = rU(r, { x0: i, y0: j, x1: i, y1: j });
      if (!r) return;
      const rc = grow(v2c(r), 1), sr = rebuildDecor(rc);
      renderGround(union(rc, sr));
      needMain = true;
    }
    function applyPending(now) {
      const bb = pending;
      pending = null;
      // saat menyapu: medan penuh dihitung ulang tiap frame kecuali perangkat lambat (lalu pakai medan lama sementara)
      const stroke = !!action && action.type === "stroke";
      if (!stroke || now - lastSync >= terrainCost * 2.5) { syncTerrain(false, stroke); lastSync = now; }
      else {
        updateLandS(grow(bb, 1));
        const sr = rebuildDecor(grow(bb, 1));
        renderGround(union(grow(bb, 2), sr));
      }
    }
    // area bebas pohon (jalan & tempat) berubah -> dekor & bayangan di sekitarnya diperbarui
    function syncMask() {
      if (!map || !mask) return;
      const nm = buildMask(), om = mask;
      let x0 = n, y0 = n, x1 = -1, y1 = -1;
      for (let y = 0, i = 0; y < n; y++) for (let x = 0; x < n; x++, i++) if (nm[i] !== om[i]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      if (x1 < 0) return;
      mask = nm;
      const sr = rebuildDecor(grow({ x0, y0, x1, y1 }, 1));
      if (sr) renderGround(sr);
      requestDraw();
    }

    // ================= GAMBAR LAYAR =================
    function frame() {
      raf = 0;
      if (destroyed) return;
      const now = performance.now();
      if (action && action.type === "stroke" && tool === "elevation" && now - action.lastDab > 70) {   // kuas udara saat diam
        dabAt(action.cur.x, action.cur.y); action.lastDab = now;
      }
      if (pending && map) { applyPending(now); needMain = true; }
      if (needMain) { needMain = false; drawMain(); }
      if (needOver) { needOver = false; drawOverlay(); }
      if (map && (view.scale !== lastVS || view.ox !== lastVX || view.oy !== lastVY)) {
        lastVS = view.scale; lastVX = view.ox; lastVY = view.oy;
        emit("onViewChange", { pxPerCell: view.scale });
      }
      if (action && action.type === "stroke" && tool === "elevation") raf = requestAnimationFrame(frame);
    }

    function drawMain() {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);
      if (!map || !cssW) { shadowEl.style.display = "none"; return; }
      const s = view.scale, X = view.ox, Y = view.oy, M = n * s;
      shadowEl.style.display = "block";
      shadowEl.style.width = M + FRAME * 2 + "px"; shadowEl.style.height = M + FRAME * 2 + "px";
      shadowEl.style.transform = `translate(${X - FRAME}px,${Y - FRAME}px)`;
      // bingkai krem
      ctx.fillStyle = CREAM;
      ctx.fillRect(X - FRAME, Y - FRAME, M + FRAME * 2, M + FRAME * 2);
      ctx.strokeStyle = "rgba(120,98,60,0.45)"; ctx.lineWidth = 1;
      ctx.strokeRect(X - FRAME + 0.5, Y - FRAME + 0.5, M + FRAME * 2 - 1, M + FRAME * 2 - 1);
      ctx.save();
      ctx.beginPath(); ctx.rect(X, Y, M, M); ctx.clip();
      if (layers.terrain) {
        ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
        ctx.drawImage(ground, X, Y, M, M);
        ctx.imageSmoothingQuality = "low";
        drawCoast();
        drawDecor();
      } else {
        ctx.fillStyle = BIOMES[0].color; ctx.fillRect(X, Y, M, M);
      }
      if (layers.zones) drawZones();
      if (layers.rivers) drawRivers();
      if (layers.paths) drawPaths();
      ctx.restore();
      ctx.strokeStyle = "rgba(70,52,28,0.4)"; ctx.lineWidth = 1;
      ctx.strokeRect(X - 0.5, Y - 0.5, M + 1, M + 1);
      // teks di atas semua garis: kotak label jadi rintangan lebih dulu, lalu pin & nama tempat, nama wilayah;
      // label digambar paling atas
      textBoxes.clear();
      const labs = layers.labels ? layoutLabels() : [];
      if (layers.places) drawPlaces(); else placeNameBox.clear();
      if (layers.zones) drawZoneNames();
      if (labs.length) drawLabels(labs);
    }


    function nextZoneColor() {
      const pal = C.ZONE_COLORS, last = map.zones[map.zones.length - 1];
      const i = last ? pal.indexOf(last.color) : -1;
      return pal[i >= 0 ? (i + 1) % pal.length : map.zones.length % pal.length];
    }
    function spacedWidth(c, text, sp) {
      if (sp <= 0) return c.measureText(text).width;
      let w = 0;
      for (const ch of text) w += c.measureText(ch).width + sp;
      return Math.max(0, w - sp);
    }
    // teks berpusat di (x,y) dengan jarak huruf manual (ctx.letterSpacing belum merata di semua browser)
    function spacedText(c, text, x, y, sp, w, stroke) {
      if (sp <= 0) { c.textAlign = "center"; stroke ? c.strokeText(text, x, y) : c.fillText(text, x, y); return; }
      c.textAlign = "left";
      let cx = x - w / 2;
      for (const ch of text) { stroke ? c.strokeText(ch, cx, y) : c.fillText(ch, cx, y); cx += c.measureText(ch).width + sp; }
    }

    // ---------- penataan teks: kotak terarah {cx,cy,hx,hy,c,s} + uji tabrakan (sumbu pemisah) ----------
    // Tiap frame: kotak label (posisi tetap) -> pin -> nama tempat -> nama wilayah. Teks otomatis yang bertabrakan
    // dipindah ke posisi lain atau dilewati; label tetap digambar paling atas.
    const TB_CELL = 64;               // grid spasial kotak teks (px) supaya cek tabrakan tetap murah di peta padat
    const textBoxes = new Map();      // kunci sel grid -> kotak di sel itu
    const placeNameBox = new Map();   // id tempat -> kotak nama yang digambar (dipakai hit-test)
    const obox = (cx, cy, hx, hy, ang) => ({ cx, cy, hx, hy, c: ang ? Math.cos(ang) : 1, s: ang ? Math.sin(ang) : 0 });
    function boxCells(b, fn) {        // sel grid yang dilalui AABB kotak
      const ex = Math.abs(b.c) * b.hx + Math.abs(b.s) * b.hy, ey = Math.abs(b.s) * b.hx + Math.abs(b.c) * b.hy;
      // dibatasi ke layar ± 4 sel: teks yang dicek tabrakannya selalu dekat layar
      const mx = Math.ceil(cssW / TB_CELL) + 4, my = Math.ceil(cssH / TB_CELL) + 4;
      const gx0 = Math.max(-4, Math.floor((b.cx - ex) / TB_CELL)), gx1 = Math.min(mx, Math.floor((b.cx + ex) / TB_CELL));
      const gy0 = Math.max(-4, Math.floor((b.cy - ey) / TB_CELL)), gy1 = Math.min(my, Math.floor((b.cy + ey) / TB_CELL));
      for (let gy = gy0; gy <= gy1; gy++) for (let gx = gx0; gx <= gx1; gx++) if (fn(gx * 65536 + gy) === false) return false;
      return true;
    }
    function addBox(b) { boxCells(b, (k) => { const l = textBoxes.get(k); if (l) l.push(b); else textBoxes.set(k, [b]); }); }
    function boxHit(a, b) {
      const dx = b.cx - a.cx, dy = b.cy - a.cy;
      if (!a.s && !b.s) return Math.abs(dx) <= a.hx + b.hx && Math.abs(dy) <= a.hy + b.hy;
      for (let k = 0; k < 4; k++) {
        const o = k < 2 ? a : b, ux = k & 1 ? -o.s : o.c, uy = k & 1 ? o.c : o.s;
        const ra = a.hx * Math.abs(a.c * ux + a.s * uy) + a.hy * Math.abs(a.c * uy - a.s * ux);
        const rb = b.hx * Math.abs(b.c * ux + b.s * uy) + b.hy * Math.abs(b.c * uy - b.s * ux);
        if (Math.abs(dx * ux + dy * uy) > ra + rb) return false;
      }
      return true;
    }
    function freeSpot(b, skip) {
      return boxCells(b, (k) => { const l = textBoxes.get(k); if (l) for (const o of l) if (o !== skip && boxHit(b, o)) return false; });
    }

    // tinta nama wilayah: warna wilayah digelapkan 25%; warna pucat digelapkan lagi supaya kontras di atas halo krem
    const inkCache = new Map();
    function zoneInk(hex) {
      let v = inkCache.get(hex);
      if (v) return v;
      const lin = (x) => { x /= 255; return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
      let c = rgb(/^#[0-9a-f]{6}$/i.test(hex) ? hex : "#e8e8ec").map((x) => x * 0.75);
      for (let k = 0; k < 12 && 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]) > 0.16; k++) c = c.map((x) => x * 0.9);
      v = `rgb(${c.map(Math.round).join(",")})`;
      inkCache.set(hex, v);
      return v;
    }

    function drawZones() {
      const s = view.scale, band = Math.max(6, Math.min(24, s * 1.2));
      ctx.lineJoin = "round";
      for (const z of map.zones) {
        const pts = z.points || [];
        if (pts.length < 3) continue;
        const isSel = sel && sel.type === "zone" && sel.id === z.id;
        ctx.beginPath();
        pts.forEach(([x, y], i) => (i ? ctx.lineTo(sx(x), sy(y)) : ctx.moveTo(sx(x), sy(y))));
        ctx.closePath();
        // isian tipis (bioma di bawahnya tetap terbaca) + pita tepi dalam sebagai penanda wilayah
        ctx.fillStyle = rgba(z.color, isSel ? 0.12 : 0.07); ctx.fill();
        ctx.save(); ctx.clip(); ctx.lineWidth = band; ctx.strokeStyle = rgba(z.color, isSel ? 0.3 : 0.22); ctx.stroke(); ctx.restore();
        if (isSel) { ctx.setLineDash([]); ctx.lineWidth = 5; ctx.strokeStyle = "rgba(20,16,10,0.3)"; ctx.stroke(); }
        ctx.setLineDash(isSel ? [] : [7, 5]); ctx.lineWidth = isSel ? 2.4 : 1.8; ctx.strokeStyle = rgba(z.color, 0.95); ctx.stroke();
        ctx.setLineDash([]);
        if (isSel) pts.forEach(([x, y]) => { ctx.beginPath(); ctx.arc(sx(x), sy(y), 3.5, 0, TAU); ctx.fillStyle = "#fff"; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = z.color; ctx.stroke(); });
      }
    }
    // nama wilayah: digambar di atas sungai/jalan/tempat (setelah drawPlaces), ukuran ikut zoom, menghindari teks lain
    const ZONE_DY = [0, 1.2, -1.2, 2.4, -2.4, 3.6, -3.6], ZONE_DX = [0, -0.3, 0.3];
    function drawZoneNames() {
      const s = view.scale, fs = Math.max(11, Math.min(22, s * 1.4)), sp = fs * 0.12, hh = fs * 0.62;
      const list = map.zones.filter((z) => z.name && z.points && z.points.length >= 3);
      if (!list.length) return;
      if (sel && sel.type === "zone") list.sort((a, b) => (b.id === sel.id) - (a.id === sel.id));
      ctx.font = `700 ${fs}px ${SANS}`; ctx.textBaseline = "middle"; ctx.lineJoin = "round";
      for (const z of list) {
        const pts = z.points, isSel = !!sel && sel.type === "zone" && sel.id === z.id;
        let x0 = Infinity, x1 = -Infinity;
        pts.forEach((p) => { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); });
        if ((x1 - x0) * s < 34) continue;
        const [lx, ly] = polyLabelPoint(C, pts), text = String(z.name).toUpperCase(), w = spacedWidth(ctx, text, sp);
        const X = sx(lx), Y = sy(ly);
        if (X + w / 2 < 0 || X - w / 2 > cssW || Y + fs < 0 || Y - fs > cssH) continue;
        // posisi: titik tengah, lalu bergeser per 1.2x tinggi huruf (bawah/atas, lalu kiri/kanan) selama tetap di dalam wilayah
        let box = null;
        for (const ky of ZONE_DY) {
          for (const kx of ZONE_DX) {
            const cx = X + kx * w, cy = Y + ky * fs;
            if ((kx || ky) && !C.pointInPolygon((cx - view.ox) / s, (cy - view.oy) / s, pts)) continue;
            const b = obox(cx, cy, w / 2 + 2, hh + 2);
            if (freeSpot(b)) { box = b; break; }
          }
          if (box) break;
        }
        if (!box && isSel) box = obox(X, Y, w / 2 + 2, hh + 2);
        if (!box) continue;
        addBox(box);
        ctx.strokeStyle = "rgba(246,240,224,0.85)"; ctx.lineWidth = Math.max(3.5, fs * 0.18); spacedText(ctx, text, box.cx, box.cy, sp, w, true);
        ctx.fillStyle = zoneInk(z.color); spacedText(ctx, text, box.cx, box.cy, sp, w, false);
      }
      ctx.textAlign = "left";
    }

    // ---------- sungai ----------
    // rapatkan titik (≤ step sel) supaya potongan di garis pantai presisi; key[i] = 1 bila titik asli (verteks)
    function resample(pts, step) {
      const out = [[pts[0][0], pts[0][1]]], key = [1];
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i], d = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (d < 1e-6) continue;
        const k = Math.ceil(d / step);
        for (let j = 1; j <= k; j++) { out.push([a[0] + ((b[0] - a[0]) * j) / k, a[1] + ((b[1] - a[1]) * j) / k]); key.push(j === k ? 1 : 0); }
      }
      return { P: out, key };
    }
    const isDry = (x, y) => landAtWarped(x, y) >= LAND_T;
    // potongan sungai dalam koordinat sel, di-cache per objek sampai titiknya / garis pantai (landVer) berubah.
    // full = seluruh garis; cut = hanya bagian di darat (sama dengan 3D: sungai berhenti di laut/danau).
    // potongan: { pts, len (jarak dari hulu), da/db: arah ke air bila ujung awal/akhir berupa muara }
    const riverCache = new WeakMap();
    function riverCells(rv) {
      const src = rv.points;
      let sum = 0;
      for (let i = 0; i < src.length; i++) sum += src[i][0] * (i + 1) + src[i][1] * (i + 7) * 1.37;
      const ck = src.length + ":" + sum + ":" + landVer;
      let c = riverCache.get(rv);
      if (c && c.key === ck) return c;
      const { P, key } = resample(chaikin(src, 2), 0.5), m = P.length, L = new Float32Array(m);
      for (let i = 1; i < m; i++) L[i] = L[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
      // pita cukup lewat verteks (+ titik potong); titik rapat hanya untuk mencari garis pantai
      const pick = (i0, i1) => { const pts = [], len = []; for (let i = i0; i <= i1; i++) if (key[i] || i === i0 || i === i1) { pts.push(P[i]); len.push(L[i]); } return { pts, len }; };
      const full = [{ ...pick(0, m - 1), da: null, db: null }], cut = [];
      if (landS) {
        const dry = new Uint8Array(m);
        for (let i = 0; i < m; i++) dry[i] = isDry(P[i][0], P[i][1]) ? 1 : 0;
        // titik potong antara w (air) & d (darat): bagi dua, lalu geser 0.15 sel ke arah air
        const cross = (w, d) => {
          const A = P[w], B = P[d], seg = Math.abs(L[d] - L[w]) || 1e-6;
          let lo = 0, hi = 1;
          for (let k = 0; k < 7; k++) { const t = (lo + hi) / 2; if (isDry(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t)) hi = t; else lo = t; }
          const t = Math.max(0, hi - 0.15 / seg);
          return { p: [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t], l: L[w] + (L[d] - L[w]) * t, dir: [(A[0] - B[0]) / seg, (A[1] - B[1]) / seg] };
        };
        for (let i = 0; i < m; i++) {
          if (!dry[i]) continue;
          let j = i;
          while (j + 1 < m && dry[j + 1]) j++;
          const r = pick(i, j);
          let ca = null, cb = null;
          if (i > 0) { ca = cross(i - 1, i); r.pts.unshift(ca.p); r.len.unshift(ca.l); }
          if (j < m - 1) { cb = cross(j + 1, j); r.pts.push(cb.p); r.len.push(cb.l); }
          if (r.pts.length >= 2) cut.push({ pts: r.pts, len: r.len, da: ca && ca.dir, db: cb && cb.dir });
          i = j;
        }
      }
      c = { key: ck, total: L[m - 1] || 1, full, cut: landS ? cut : full };
      riverCache.set(rv, c);
      return c;
    }
    // geometri layar: tiap potongan { sp: titik layar, hw: setengah lebar (meruncing di hulu), a/b: ujung = muara, da/db }
    function riverGeom(rv, cut) {
      const c = riverCells(rv), base = ((rv.width || 1.5) * view.scale) / 2, total = c.total;
      return (cut ? c.cut : c.full).map((r) => ({
        sp: r.pts.map((p) => [sx(p[0]), sy(p[1])]),
        hw: r.len.map((l) => Math.max(0.75, base * (0.4 + 0.6 * sstep(0, 0.3, l / total)))),
        a: !!r.da, b: !!r.db, da: r.da, db: r.db,
      }));
    }
    function drawRiverSet(c, geoms, extra, style) {
      c.beginPath();
      for (const runs of geoms) for (const r of runs) traceRibbon(c, r.sp, extra ? r.hw.map((v) => v + extra) : r.hw, !r.a, !r.b);
      c.fillStyle = style; c.fill();
    }
    // muara: kipas pendek yang memudar ke air (bukan ujung bulat di tengah laut)
    function drawMouth(c, p, hw, d) {
      const len = Math.max(3, Math.min(hw * 1.6, view.scale * 0.9)), nx = -d[1], ny = d[0], we = hw * 1.45;
      const bx = p[0] - d[0], by = p[1] - d[1];   // mulai 1 px di dalam ujung pita supaya tidak ada celah
      const ex = p[0] + d[0] * len, ey = p[1] + d[1] * len, g = c.createLinearGradient(bx, by, ex, ey);
      g.addColorStop(0, "rgba(80,137,176,0.75)"); g.addColorStop(1, "rgba(80,137,176,0)");
      c.beginPath();
      c.moveTo(bx + nx * hw, by + ny * hw); c.lineTo(ex + nx * we, ey + ny * we);
      c.lineTo(ex - nx * we, ey - ny * we); c.lineTo(bx - nx * hw, by - ny * hw);
      c.closePath(); c.fillStyle = g; c.fill();
    }
    function drawRivers() {
      const list = map.rivers.filter((rv) => rv.points && rv.points.length >= 2);
      if (!list.length) return;
      const selR = sel && sel.type === "river" ? list.find((r) => r.id === sel.id) : null;
      const geoms = list.map((rv) => riverGeom(rv, true));
      if (selR) {
        // bagian di air tidak digambar -> jalurnya ditampilkan putus-putus saat terpilih
        ctx.beginPath();
        chaikin(selR.points, 2).forEach((p, i) => (i ? ctx.lineTo(sx(p[0]), sy(p[1])) : ctx.moveTo(sx(p[0]), sy(p[1]))));
        ctx.setLineDash([5, 4]); ctx.lineWidth = 2; ctx.lineJoin = "round"; ctx.strokeStyle = ACCENT; ctx.stroke(); ctx.setLineDash([]);
        drawRiverSet(ctx, [geoms[list.indexOf(selR)]], 5, rgba(ACCENT, 0.6));
      }
      drawRiverSet(ctx, geoms, 1.2, "rgba(36,72,98,0.9)");
      drawRiverSet(ctx, geoms, 0, "#5089b0");
      for (const runs of geoms) for (const r of runs) {
        if (r.a) drawMouth(ctx, r.sp[0], r.hw[0], r.da);
        if (r.b) drawMouth(ctx, r.sp[r.sp.length - 1], r.hw[r.hw.length - 1], r.db);
      }
      if (selR) endDots(selR.points);
    }
    function endDots(pts) {
      [pts[0], pts[pts.length - 1]].forEach((p) => {
        ctx.beginPath(); ctx.arc(sx(p[0]), sy(p[1]), 3.5, 0, TAU);
        ctx.fillStyle = "#fff"; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = ACCENT; ctx.stroke();
      });
    }
    function pathWidth(kind) { const s = view.scale; return kind === "trail" ? Math.max(1.1, Math.min(3, s * 0.2)) : Math.max(1.5, Math.min(5, s * 0.32)); }
    function strokePath(c, pts, kind, isSel) {
      const sp = chaikin(pts, 2), w = pathWidth(kind), trail = kind === "trail";
      c.beginPath();
      sp.forEach((p, i) => (i ? c.lineTo(sx(p[0]), sy(p[1])) : c.moveTo(sx(p[0]), sy(p[1]))));
      c.lineCap = "round"; c.lineJoin = "round";
      if (isSel) { c.setLineDash([]); c.lineWidth = w + 9; c.strokeStyle = rgba(ACCENT, 0.55); c.stroke(); }
      c.setLineDash([]); c.lineWidth = w + 2.6; c.strokeStyle = "rgba(246,238,214,0.55)"; c.stroke();
      c.setLineDash(trail ? [0.1, w * 2.5] : [w * 2.6, w * 1.7]);
      c.lineWidth = w; c.strokeStyle = trail ? "#6a4d31" : "#7a5534"; c.stroke();
      c.setLineDash([]);
    }
    function drawPaths() {
      for (const pt of map.paths) {
        if (!pt.points || pt.points.length < 2) continue;
        const isSel = sel && sel.type === "path" && sel.id === pt.id;
        strokePath(ctx, pt.points, pt.kind, isSel);
        if (isSel) endDots(pt.points);
      }
    }

    // ---------- tempat: pin & nama ikut zoom (kecil di HP), nama dirapikan supaya tidak bertumpuk ----------
    const pinRadius = () => Math.max(5.5, Math.min(13, view.scale * 1.25));
    const placeFont = () => Math.max(9.5, Math.min(13, view.scale * 2.1));
    const ICON_RANK = { city: 0, castle: 1, port: 2, temple: 3, village: 4, landmark: 5, ruin: 6, camp: 7 };
    function drawPlaces() {
      const r = pinRadius(), fs = placeFont(), hh = fs * 0.6, named = [];
      placeNameBox.clear();
      ctx.lineJoin = "round";
      for (const pl of map.places) {
        const x = sx(pl.x), y = sy(pl.y);
        if (x < -160 || x > cssW + 160 || y < -40 || y > cssH + 40) continue;
        const isSel = !!sel && sel.type === "place" && sel.id === pl.id;
        if (isSel) {   // sorotan: isian aksen + cincin putih + cincin aksen, tetap jelas di atas daratan terang
          ctx.beginPath(); ctx.arc(x, y, r + 6, 0, TAU); ctx.fillStyle = rgba(ACCENT, 0.28); ctx.fill();
          ctx.lineWidth = 3.5; ctx.strokeStyle = "rgba(255,255,255,0.95)"; ctx.stroke();
          ctx.lineWidth = 2; ctx.strokeStyle = ACCENT; ctx.stroke();
        }
        ctx.beginPath(); ctx.ellipse(x + 1, y + r * 0.85, r * 0.8, r * 0.28, 0, 0, TAU); ctx.fillStyle = "rgba(0,0,0,0.22)"; ctx.fill();
        ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fillStyle = "#f7f1e1"; ctx.fill();
        ctx.lineWidth = r < 8 ? 1.2 : 1.5; ctx.strokeStyle = INK; ctx.stroke();
        ctx.save(); ctx.translate(x, y); const k = r * 0.58; ctx.scale(k, k);
        ctx.fillStyle = INK; ctx.strokeStyle = INK; (ICONS[pl.icon] || ICONS.landmark)(ctx);
        ctx.restore();
        const pin = obox(x, y + r * 0.1, r + 1, r * 1.1 + 1);
        addBox(pin);
        if (pl.name) named.push({ pl, x, y, isSel, pin, rank: ICON_RANK[pl.icon] ?? 8 });
      }
      // nama: yang terpilih & ikon penting lebih dulu; coba bawah -> kanan -> kiri -> atas, lewati bila semua bertabrakan
      named.sort((a, b) => (b.isSel - a.isSel) || (a.rank - b.rank));
      ctx.font = `600 ${fs}px ${SANS}`; ctx.textBaseline = "middle"; ctx.textAlign = "center";
      for (const v of named) {
        const name = String(v.pl.name), hw = ctx.measureText(name).width / 2, x = v.x, y = v.y;
        const spots = [[x, y + r + 3 + hh], [x + r + 5 + hw, y], [x - r - 5 - hw, y], [x, y - r - 3 - hh]];
        let box = null;
        for (const [cx, cy] of spots) { const b = obox(cx, cy, hw + 2, hh + 2); if (freeSpot(b, v.pin)) { box = b; break; } }
        if (!box && v.isSel) box = obox(spots[0][0], spots[0][1], hw + 2, hh + 2);
        if (!box) continue;
        addBox(box); placeNameBox.set(v.pl.id, box);
        ctx.lineWidth = Math.max(2.5, fs * 0.3); ctx.strokeStyle = "rgba(246,240,224,0.92)"; ctx.strokeText(name, box.cx, box.cy);
        ctx.fillStyle = "#1f1a14"; ctx.fillText(name, box.cx, box.cy);
      }
      ctx.textAlign = "left";
    }

    // ---------- label ----------
    const LABEL_MIN_PX = 7.5;   // lebih kecil dari ini tak terbaca -> tidak digambar & tidak bisa diklik (kecuali yang terpilih)
    function labelLook(lb, isSel) {
      const st = lb.style === "water" || lb.style === "small" ? lb.style : "region";
      let px = Math.max(0.5, Number(lb.size) || 4) * view.scale * 0.9;
      if (st === "small") px *= 0.72;
      if (isSel) px = Math.max(px, 10);   // yang terpilih selalu terlihat
      px = Math.min(px, 400);
      const raw = String(lb.text == null ? "" : lb.text).replace(/\s+/g, " ").trim();
      if (st === "region") return { px, text: raw.toUpperCase(), font: `600 ${px}px ${SERIF}`, sp: px * 0.28, fill: "#3a2c1d", halo: "rgba(244,236,214,0.72)", hw: Math.max(2, px * 0.2) };
      if (st === "water") return { px, text: raw, font: `italic 500 ${px}px ${SERIF}`, sp: px * 0.08, fill: "#173550", halo: "rgba(196,220,236,0.45)", hw: Math.max(2, px * 0.2) };
      return { px, text: raw, font: `500 ${px}px ${SERIF}`, sp: 0, fill: "#2b2118", halo: "rgba(244,236,214,0.8)", hw: Math.max(2, px * 0.16) };
    }
    function labelMetrics(lb) {   // null = tidak digambar
      const isSel = !!sel && sel.type === "label" && sel.id === lb.id, L = labelLook(lb, isSel);
      if ((L.px < LABEL_MIN_PX && !isSel) || !L.text) return null;
      ctx.font = L.font;
      const w = spacedWidth(ctx, L.text, L.sp), x = sx(lb.x), y = sy(lb.y), ang = ((Number(lb.rotation) || 0) * Math.PI) / 180;
      return { lb, L, w, x, y, ang, isSel, box: obox(x, y, w / 2 + 4, L.px * 0.62 + 2, ang) };
    }
    function layoutLabels() {
      const out = [];
      for (const lb of map.labels) {
        const m = labelMetrics(lb);
        if (!m || Math.abs(m.x) > cssW * 3 + m.w || Math.abs(m.y) > cssH * 3 + m.L.px) continue;
        out.push(m); addBox(m.box);
      }
      return out;
    }
    function drawLabels(list) {
      ctx.textBaseline = "middle"; ctx.lineJoin = "round";
      for (const m of list) {
        const L = m.L, w = m.w;
        ctx.save(); ctx.translate(m.x, m.y); if (m.ang) ctx.rotate(m.ang);
        ctx.font = L.font;
        if (m.isSel) {   // kotak pilihan: garis putih di bawah garis putus-putus aksen supaya kontras di daratan terang
          ctx.beginPath(); ctx.rect(-w / 2 - 6, -L.px * 0.68 - 3, w + 12, L.px * 1.36 + 6);
          ctx.fillStyle = rgba(ACCENT, 0.12); ctx.fill();
          ctx.lineWidth = 3; ctx.strokeStyle = "rgba(255,255,255,0.8)"; ctx.stroke();
          ctx.setLineDash([6, 4]); ctx.lineWidth = 2; ctx.strokeStyle = ACCENT; ctx.stroke(); ctx.setLineDash([]);
        }
        ctx.strokeStyle = L.halo; ctx.lineWidth = L.hw; spacedText(ctx, L.text, 0, 0, L.sp, w, true);
        ctx.fillStyle = L.fill; spacedText(ctx, L.text, 0, 0, L.sp, w, false);
        ctx.restore();
      }
      ctx.textAlign = "left";
    }

    // ---------- overlay: kursor kuas & pratinjau ----------
    function drawOverlay() {
      octx.setTransform(dpr, 0, 0, dpr, 0, 0);
      octx.clearRect(0, 0, cssW, cssH);
      if (!map) return;
      if (action && action.type === "line" && action.pts.length > 1) {
        octx.save(); octx.globalAlpha = 0.85;
        if (action.kind === "river") { const g = [riverGeom({ points: action.pts, width: 1.5 }, false)]; drawRiverSet(octx, g, 1.2, "rgba(36,72,98,0.9)"); drawRiverSet(octx, g, 0, "#5089b0"); }
        else strokePath(octx, action.pts, pathKind, false);
        octx.restore();
      }
      // sungai di bawah kursor (alat pilih): tampilkan seluruh jalurnya, karena bagian di air tidak digambar
      if (tool === "select" && !action && hoverHit && hoverHit.type === "river" && !(sel && sel.type === "river" && sel.id === hoverHit.id)) {
        const rv = findObj(hoverHit);
        if (rv && rv.points && rv.points.length >= 2) {
          octx.beginPath();
          chaikin(rv.points, 2).forEach((p, i) => (i ? octx.lineTo(sx(p[0]), sy(p[1])) : octx.moveTo(sx(p[0]), sy(p[1]))));
          octx.setLineDash([5, 4]); octx.lineWidth = 1.5; octx.lineJoin = "round"; octx.strokeStyle = "rgba(255,255,255,0.75)"; octx.stroke(); octx.setLineDash([]);
        }
      }
      if (zoneDraft && zoneDraft.length) {
        const col = nextZoneColor(), pts = zoneDraft.map((p) => [sx(p[0]), sy(p[1])]);
        if (hover && hoverInside) pts.push([hover.x, hover.y]);
        octx.beginPath(); pts.forEach((p, i) => (i ? octx.lineTo(p[0], p[1]) : octx.moveTo(p[0], p[1])));
        if (pts.length > 2) { octx.closePath(); octx.fillStyle = rgba(col, 0.14); octx.fill(); }
        octx.lineJoin = "round"; octx.setLineDash([7, 5]); octx.lineWidth = 2; octx.strokeStyle = col; octx.stroke(); octx.setLineDash([]);
        const nearFirst = zoneDraft.length >= 3 && hover && dist(hover, { x: pts[0][0], y: pts[0][1] }) <= 10;
        zoneDraft.forEach((p, i) => {
          octx.beginPath(); octx.arc(sx(p[0]), sy(p[1]), i === 0 && nearFirst ? 7 : 4, 0, TAU);
          octx.fillStyle = i === 0 && nearFirst ? col : "#fff"; octx.fill(); octx.lineWidth = 1.5; octx.strokeStyle = col; octx.stroke();
        });
      }
      const busy = action && action.type !== "stroke";
      if (BRUSH_TOOLS[tool] && hover && (hoverInside || (action && action.type === "stroke")) && !spaceDown && !busy) {
        const size = tool === "elevation" ? elev.size : brush.size, r = Math.max(2, size * view.scale);
        octx.beginPath(); octx.arc(hover.x, hover.y, r, 0, TAU);
        if (tool === "brush") { octx.fillStyle = rgba((BIOMES[brush.biome] || BIOMES[0]).color, 0.22); octx.fill(); }
        octx.lineWidth = 3; octx.strokeStyle = "rgba(0,0,0,0.35)"; octx.stroke();
        octx.lineWidth = 1.5; octx.strokeStyle = "rgba(255,255,255,0.95)";
        if (tool === "eraser") octx.setLineDash([5, 4]);
        octx.stroke(); octx.setLineDash([]);
        octx.strokeStyle = "rgba(255,255,255,0.95)"; octx.lineWidth = 1.5; octx.beginPath();
        if (tool === "elevation") {
          octx.moveTo(hover.x - 5, hover.y); octx.lineTo(hover.x + 5, hover.y);
          if (elev.mode !== "lower") { octx.moveTo(hover.x, hover.y - 5); octx.lineTo(hover.x, hover.y + 5); }
          octx.stroke();
        } else { octx.arc(hover.x, hover.y, 1.6, 0, TAU); octx.fillStyle = "#fff"; octx.fill(); }
      }
    }

    // ================= INTERAKSI =================
    function hitTest(p) {
      if (!map) return null;
      const s = view.scale, c = toCell(p);
      if (layers.labels) {
        for (let i = map.labels.length - 1; i >= 0; i--) {
          const m = labelMetrics(map.labels[i]);
          if (!m) continue;
          const a = -m.ang, dx = p.x - m.x, dy = p.y - m.y;
          const lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a);
          if (Math.abs(lx) <= m.w / 2 + 6 && Math.abs(ly) <= m.L.px * 0.68 + 4) return { type: "label", id: m.lb.id };
        }
      }
      if (layers.places) {
        const r = pinRadius(), slop = coarse ? 9 : 4;
        for (let i = map.places.length - 1; i >= 0; i--) {
          const pl = map.places[i], x = sx(pl.x), y = sy(pl.y);
          if (Math.hypot(p.x - x, p.y - y) <= r + slop) return { type: "place", id: pl.id };
          const b = placeNameBox.get(pl.id);   // nama hanya bisa diklik bila memang tergambar (posisi hasil penataan)
          if (b && Math.abs(p.x - b.cx) <= b.hx + 1 && Math.abs(p.y - b.cy) <= b.hy + 1) return { type: "place", id: pl.id };
        }
      }
      let best = null, bd = Infinity;
      if (layers.paths) for (const pt of map.paths) {
        const d = C.distToPolyline(c.x, c.y, pt.points) * s;
        if (d <= Math.max(7, pathWidth(pt.kind) / 2 + 4) && d < bd) { bd = d; best = { type: "path", id: pt.id }; }
      }
      // sungai tetap bisa diklik di sepanjang garisnya (termasuk bagian di air yang tidak digambar) supaya
      // sungai yang seluruhnya di laut tidak jadi objek tak terjangkau; saat terpilih jalurnya tampil putus-putus
      if (layers.rivers) for (const rv of map.rivers) {
        const d = C.distToPolyline(c.x, c.y, rv.points) * s;
        if (d <= Math.max(7, ((rv.width || 1.5) * s) / 2 + 4) && d < bd) { bd = d; best = { type: "river", id: rv.id }; }
      }
      if (best) return best;
      if (layers.zones) {
        for (let i = map.zones.length - 1; i >= 0; i--) {
          const z = map.zones[i], pts = z.points || [];
          if (pts.length < 3) continue;
          if (C.pointInPolygon(c.x, c.y, pts) || C.distToPolyline(c.x, c.y, pts.concat([pts[0]])) * s <= 6) return { type: "zone", id: z.id };
        }
      }
      return null;
    }

    function updateCursor() {
      let c;
      const t = action && action.type;
      if (t === "pan" || t === "pinch" || t === "move") c = "grabbing";
      else if (spaceDown && hoverInside) c = "grab";
      else if (BRUSH_TOOLS[tool]) c = "none";
      else if (tool === "select") c = hoverHit ? (sel && hoverHit.type === sel.type && hoverHit.id === sel.id ? "move" : "pointer") : "default";
      else c = "crosshair";
      const V = { move: "move", pointer: "pointer", default: "default", crosshair: "cross" };   // set kursor Novelist (cursor.js)
      if (V[c]) c = `var(--cur-${V[c]}, ${c})`;
      if (cv.style.cursor !== c) cv.style.cursor = c;
    }
    function localPos(e) { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }

    // area fit = kanvas dikurangi tepi yang tertutup UI shell (insets); minimal 40% kanvas per sumbu
    function fitArea() {
      const I = insets, side = (full, a, b) => {
        const free = full - a - b, len = Math.max(full * 0.4, free);
        return [free >= len ? a : ((full - len) * a) / (a + b || 1), len];
      };
      const [x, w] = side(cssW, I.left, I.right), [y, h] = side(cssH, I.top, I.bottom);
      return { x, y, w, h };
    }
    function fitScale() {
      const A = fitArea(), m = Math.max(14, Math.min(A.w, A.h) * 0.03) + FRAME;
      return Math.max(0.3, Math.min((A.w - 2 * m) / n, (A.h - 2 * m) / n));
    }
    function clampView() {
      const M = n * view.scale, pad = 48;
      view.ox = Math.min(cssW - pad, Math.max(pad - M, view.ox));
      view.oy = Math.min(cssH - pad, Math.max(pad - M, view.oy));
    }
    function zoomAt(x, y, factor) {
      if (!map || !cssW) return;
      const ns = Math.max(fitScale() * 0.5, Math.min(MAX_PX, view.scale * factor)), k = ns / view.scale;
      if (k === 1) return;
      view.ox = x - (x - view.ox) * k; view.oy = y - (y - view.oy) * k; view.scale = ns;
      clampView(); autoFit = false; requestDraw();
    }

    // ---------- kuas ----------
    function wouldChange(cx, cy, r) {
      const bio = map.biome, ht = map.height;
      const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(n - 1, Math.ceil(cx + r)), y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(n - 1, Math.ceil(cy + r));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (d > r) continue;
        const i = y * n + x;
        if (tool === "brush" ? bio[i] !== brush.biome : tool === "eraser" ? bio[i] !== 0 || ht[i] !== 0
          : d < r * 0.8 && (elev.mode === "lower" ? ht[i] > 0 : ht[i] < 255)) return true;
      }
      return false;
    }
    function dabAt(x, y) {
      const a = action, size = tool === "elevation" ? elev.size : brush.size;
      if (!a.began) {   // checkpoint undo baru dibuat saat sapuan benar-benar mengubah sesuatu
        if (!wouldChange(x, y, size)) return;
        a.began = true; emit("onBeforeChange");
      }
      const r = tool === "brush" ? C.paintBiome(map, x, y, size, brush.biome)
        : tool === "eraser" ? C.erase(map, x, y, size)
          : C.sculpt(map, x, y, size, (elev.mode === "lower" ? -1 : 1) * (0.05 + 0.3 * elev.strength));
      if (r) pending = union(pending, r);
    }
    function finishStroke(a) {
      if (pending) pending = null;
      syncTerrain(false); lastSync = performance.now();
      if (a.began) emit("onChange", "terrain");
    }

    // ---------- objek vektor ----------
    function select(s) { sel = s; emitSelect(); requestDraw(); }
    function commitLine(a) {
      let pts = simplify(C, a.pts, Math.max(0.2, 1.2 / view.scale));
      if (pts.length < 2 || polyLength(pts) < Math.max(0.6, 6 / view.scale)) return;
      pts = pts.map((p) => [round2(p[0]), round2(p[1])]);
      emit("onBeforeChange");
      const river = a.kind === "river";
      const obj = river ? { id: C.uid("river"), name: "Sungai", points: pts, width: 1.5 } : { id: C.uid("path"), name: "Jalan", points: pts, kind: pathKind };
      map[river ? "rivers" : "paths"].push(obj);
      sel = { type: a.kind, id: obj.id };
      if (river) syncTerrain(false); else syncMask();
      emit("onChange", "vector"); emitSelect();
    }
    function createAt(p) {
      const c = toCell(p);
      if (c.x < 0 || c.y < 0 || c.x > n || c.y > n) return;
      const type = tool === "place" ? "place" : "label", hit = hitTest(p);
      if (hit && hit.type === type) { select(hit); return; }   // klik objek sejenis = pilih, bukan buat baru
      emit("onBeforeChange");
      const o = type === "place"
        ? { id: C.uid("place"), name: "Tempat baru", x: round2(c.x), y: round2(c.y), icon: placeIcon, desc: "", sceneId: null }
        : { id: C.uid("label"), text: "Label", x: round2(c.x), y: round2(c.y), size: 4, rotation: 0, style: "region" };
      map[ARR[type]].push(o);
      sel = { type, id: o.id };
      if (type === "place") syncMask();
      emit("onChange", "vector"); emitSelect(); requestDraw();
    }
    function zoneClick(p) {
      const now = performance.now(), prev = lastZoneClick;
      lastZoneClick = { t: now, x: p.x, y: p.y };
      if (zoneDraft && zoneDraft.length >= 3) {
        if (dist(p, { x: sx(zoneDraft[0][0]), y: sy(zoneDraft[0][1]) }) <= 10) { finishZone(); return; }       // klik titik pertama
        if (prev && now - prev.t < 400 && dist(p, prev) < 8) { finishZone(); return; }                           // dobel-klik
      }
      if (zoneDraft && zoneDraft.length) { const l = zoneDraft[zoneDraft.length - 1]; if (dist(p, { x: sx(l[0]), y: sy(l[1]) }) < 4) return; }
      const c = toCell(p);
      if (!zoneDraft && (c.x < 0 || c.y < 0 || c.x > n || c.y > n)) return;
      (zoneDraft || (zoneDraft = [])).push(clampPt(c));
      requestDraw(false, true);
    }
    function finishZone() {
      if (!zoneDraft || zoneDraft.length < 3) return;
      emit("onBeforeChange");
      const z = { id: C.uid("zone"), name: "Wilayah baru", color: nextZoneColor(), points: zoneDraft, desc: "" };
      map.zones.push(z);
      zoneDraft = null; lastZoneClick = null; sel = { type: "zone", id: z.id };
      emit("onChange", "vector"); emitSelect(); requestDraw();
    }
    function deleteSelection() {
      const arr = map[ARR[sel.type]] || [], i = arr.findIndex((o) => o.id === sel.id);
      if (i < 0) { select(null); return; }
      emit("onBeforeChange");
      const wasRiver = sel.type === "river";
      arr.splice(i, 1);
      sel = null; hoverHit = null;
      if (wasRiver) syncTerrain(false); else syncMask();
      emit("onChange", "vector"); emitSelect(); requestDraw(); updateCursor();
    }
    function beginMove(a) {
      const o = findObj(a.hit);
      if (!o) return null;
      emit("onBeforeChange");
      const pts = o.points ? o.points.map((p) => p.slice()) : null;
      let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
      (pts || [[o.x, o.y]]).forEach(([x, y]) => { bx0 = Math.min(bx0, x); by0 = Math.min(by0, y); bx1 = Math.max(bx1, x); by1 = Math.max(by1, y); });
      return { type: "move", id: a.id, hit: a.hit, start: a.start, ox: o.x, oy: o.y, pts, bb: [bx0, by0, bx1, by1] };
    }
    function applyMove(a, p) {
      const o = findObj(a.hit);
      if (!o) return;
      const [bx0, by0, bx1, by1] = a.bb;
      const dx = Math.max(-bx0, Math.min(n - bx1, (p.x - a.start.x) / view.scale));
      const dy = Math.max(-by0, Math.min(n - by1, (p.y - a.start.y) / view.scale));
      if (a.pts) { if (o.points.length !== a.pts.length) o.points = a.pts.map((q) => q.slice()); a.pts.forEach((q, i) => { o.points[i][0] = round2(q[0] + dx); o.points[i][1] = round2(q[1] + dy); }); }
      else { o.x = round2(a.ox + dx); o.y = round2(a.oy + dy); }
      a.moved = true;
      requestDraw();
    }

    // ---------- pointer ----------
    function startTool(p, id) {
      const c = toCell(p);
      if (BRUSH_TOOLS[tool]) {
        action = { type: "stroke", id, cell: c, cur: c, began: false, lastDab: performance.now() };
        dabAt(c.x, c.y); requestDraw();
      } else if (tool === "river" || tool === "path") {
        action = { type: "line", id, kind: tool, pts: [clampPt(c)] };
      } else if (tool === "place" || tool === "label") {
        action = { type: "click", id, start: p };
      } else if (tool === "zone") {
        zoneClick(p); action = { type: "noop", id };
      } else {
        const hit = hitTest(p);
        if (!hit) {
          if (sel) select(null);
          action = { type: "pan", id, sx: p.x, sy: p.y, ox: view.ox, oy: view.oy };
        } else {
          const was = !!sel && sel.type === hit.type && sel.id === hit.id;
          if (!was) select(hit);
          // wilayah besar: geser hanya kalau sudah terpilih (supaya drag biasa tetap bisa pan)
          action = { type: "press", id, start: p, hit, canMove: hit.type !== "zone" || was };
        }
      }
      updateCursor();
    }
    function moveAction(p) {
      const a = action;
      switch (a.type) {
        case "pan":
          view.ox = a.ox + p.x - a.sx; view.oy = a.oy + p.y - a.sy; clampView(); autoFit = false; requestDraw(); break;
        case "stroke": {
          const c = toCell(p), size = tool === "elevation" ? elev.size : brush.size, step = Math.max(0.3, size / 2);
          a.cur = c;
          const d = Math.hypot(c.x - a.cell.x, c.y - a.cell.y), k = Math.floor(d / step);
          if (k > 0) {
            const ux = (c.x - a.cell.x) / d, uy = (c.y - a.cell.y) / d;
            for (let j = 1; j <= k; j++) dabAt(a.cell.x + ux * step * j, a.cell.y + uy * step * j);
            a.cell = { x: a.cell.x + ux * step * k, y: a.cell.y + uy * step * k };
            a.lastDab = performance.now();
          }
          requestDraw(); break;
        }
        case "line": {
          const c = clampPt(toCell(p)), l = a.pts[a.pts.length - 1];
          if (Math.hypot(c[0] - l[0], c[1] - l[1]) * view.scale >= 3) { a.pts.push(c); requestDraw(false, true); }
          break;
        }
        case "press":
          if (dist(p, a.start) > 4) {
            if (a.canMove) { const m = beginMove(a); action = m || null; if (m) applyMove(m, p); }
            else action = { type: "pan", id: a.id, sx: a.start.x, sy: a.start.y, ox: view.ox, oy: view.oy };
            updateCursor();
          }
          break;
        case "move": applyMove(a, p); break;
        case "click":
          if (dist(p, a.start) > 6) { action = { type: "pan", id: a.id, sx: a.start.x, sy: a.start.y, ox: view.ox, oy: view.oy }; moveAction(p); updateCursor(); }
          break;
      }
    }
    function endAction(cancel) {
      const a = action;
      action = null;
      if (!a) return;
      if (a.type === "stroke") finishStroke(a);
      else if (a.type === "line" && !cancel) commitLine(a);
      else if (a.type === "move" && a.moved) {
        if (a.hit.type === "river") syncTerrain(false); else syncMask();
        emit("onChange", "vector");
      } else if (a.type === "click" && !cancel) createAt(a.start);
      updateCursor(); requestDraw();
    }
    function interruptForPinch() {
      if (!action) return;
      if (action.type === "touchwait") clearTimeout(action.timer);
      else if (action.type === "stroke" || action.type === "move") endAction(false);   // simpan yang sudah terjadi
      action = null;
      requestDraw();
    }
    function pinchPts() { const v = [...touches.values()]; return [v[0], v[1]]; }
    function startPinch() {
      const [a, b] = pinchPts(), m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      action = { type: "pinch", d0: Math.max(10, dist(a, b)), s0: view.scale, cell: toCell(m) };
      hover = null; updateCursor(); requestDraw(false, true);
    }
    function updatePinch() {
      const [a, b] = pinchPts(), m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      view.scale = Math.max(fitScale() * 0.5, Math.min(MAX_PX, (action.s0 * dist(a, b)) / action.d0));
      view.ox = m.x - action.cell.x * view.scale; view.oy = m.y - action.cell.y * view.scale;
      clampView(); autoFit = false; requestDraw();
    }

    function onDown(e) {
      if (!map) return;
      const p = localPos(e);
      coarse = e.pointerType === "touch";
      if (e.pointerType === "touch") {
        touches.set(e.pointerId, p);
        try { cv.setPointerCapture(e.pointerId); } catch (_) { /* abaikan */ }
        if (touches.size === 2) { interruptForPinch(); startPinch(); return; }
        if (touches.size > 2 || action) return;
        hover = p;
        // tunggu sebentar: kalau jari kedua menyusul, ini pinch (bukan sapuan kuas)
        const id = e.pointerId;
        action = { type: "touchwait", id, start: p, timer: setTimeout(() => { if (action && action.type === "touchwait" && action.id === id) { action = null; startTool(p, id); } }, 110) };
        return;
      }
      if (action) return;
      hover = p; hoverInside = true;
      try { cv.setPointerCapture(e.pointerId); } catch (_) { /* abaikan */ }
      if (e.button === 1 || e.button === 2 || (e.button === 0 && spaceDown)) {
        e.preventDefault();
        action = { type: "pan", id: e.pointerId, sx: p.x, sy: p.y, ox: view.ox, oy: view.oy };
        updateCursor(); requestDraw(false, true); return;
      }
      if (e.button !== 0) return;
      startTool(p, e.pointerId);
    }
    function onMove(e) {
      if (!map) return;
      const p = localPos(e);
      if (e.pointerType === "touch") {
        if (touches.has(e.pointerId)) touches.set(e.pointerId, p);
        if (action && action.type === "pinch") { if (touches.size >= 2) updatePinch(); return; }
      } else { hoverInside = true; coarse = false; }
      if (!action) {
        if (e.pointerType === "touch") return;
        hover = p;
        const h = tool === "select" ? hitTest(p) : null;
        if ((h && h.id) !== (hoverHit && hoverHit.id)) {
          if ((h && h.type === "river") || (hoverHit && hoverHit.type === "river")) requestDraw(false, true);
          hoverHit = h;
        }
        updateCursor();
        if (BRUSH_TOOLS[tool] || zoneDraft) requestDraw(false, true);
        return;
      }
      if (action.id !== e.pointerId) return;
      hover = p;
      if (action.type === "touchwait") {
        if (dist(p, action.start) <= 8) return;
        clearTimeout(action.timer);
        const st = action.start;
        action = null; startTool(st, e.pointerId);
        if (!action) return;
      }
      moveAction(p);
      if (BRUSH_TOOLS[tool] || zoneDraft || action && action.type === "line") requestDraw(false, true);
    }
    function onUp(e) {
      if (e.pointerType === "touch") {
        touches.delete(e.pointerId);
        if (action && action.type === "pinch") { action = touches.size ? { type: "touchrest" } : null; updateCursor(); return; }
        if (action && action.type === "touchrest") { if (!touches.size) action = null; return; }
        if (action && action.type === "touchwait" && action.id === e.pointerId) {   // ketukan singkat
          clearTimeout(action.timer);
          const st = action.start;
          action = null; startTool(st, e.pointerId);
        }
        if (!touches.size) hover = null;
      }
      if (!action || action.id !== e.pointerId) return;
      endAction(e.type === "pointercancel");
      if (e.pointerType === "touch") { hover = null; requestDraw(false, true); }
    }
    function onLeave(e) {
      if (e.pointerType === "touch") return;
      hoverInside = false; hoverHit = null;
      if (!action) hover = null;
      requestDraw(false, true);
    }
    function onWheel(e) {
      if (!map) return;
      e.preventDefault();
      const p = localPos(e);
      let dy = e.deltaY;
      if (e.deltaMode === 1) dy *= 16; else if (e.deltaMode === 2) dy *= cssH;
      zoomAt(p.x, p.y, Math.max(0.5, Math.min(2, Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015)))));
      hover = p; requestDraw(false, true);
    }
    function onKeyDown(e) {
      if (!map || !isShown() || isTyping(e.target)) return;
      if (e.code === "Space" || e.key === " ") {
        if (hoverInside || spaceDown) { e.preventDefault(); if (!spaceDown) { spaceDown = true; updateCursor(); requestDraw(false, true); } }
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "Escape") {
        if (action && action.type === "line") { action = null; requestDraw(false, true); }
        else if (zoneDraft) { zoneDraft = null; lastZoneClick = null; requestDraw(false, true); }
        else if (sel && !action) select(null);
      } else if (e.key === "Enter" && zoneDraft) {
        e.preventDefault(); finishZone();
      } else if (e.key === "Backspace" && zoneDraft) {
        e.preventDefault(); zoneDraft.pop(); if (!zoneDraft.length) zoneDraft = null; requestDraw(false, true);
      } else if ((e.key === "Delete" || e.key === "Backspace") && sel && !action) {
        e.preventDefault(); deleteSelection();
      }
    }
    function onKeyUp(e) { if ((e.code === "Space" || e.key === " ") && spaceDown) { spaceDown = false; updateCursor(); requestDraw(false, true); } }
    function onBlur() { if (spaceDown) { spaceDown = false; updateCursor(); } }
    const onContext = (e) => e.preventDefault();
    const onMouseDown = (e) => { if (e.button === 1) e.preventDefault(); };   // cegah autoscroll tombol tengah

    cv.addEventListener("pointerdown", onDown);
    cv.addEventListener("pointermove", onMove);
    cv.addEventListener("pointerup", onUp);
    cv.addEventListener("pointercancel", onUp);
    cv.addEventListener("pointerleave", onLeave);
    cv.addEventListener("wheel", onWheel, { passive: false });
    cv.addEventListener("contextmenu", onContext);
    cv.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);

    // ---------- ukuran ----------
    function resize() {
      if (destroyed) return;
      const w = root.clientWidth, h = root.clientHeight, nd = window.devicePixelRatio || 1;
      if (!w || !h) return;   // tab tersembunyi
      if (w === cssW && h === cssH && nd === dpr) return;
      const center = map && cssW ? toCell({ x: cssW / 2, y: cssH / 2 }) : null;
      cssW = w; cssH = h; dpr = nd;
      cv.width = ov.width = Math.round(w * dpr); cv.height = ov.height = Math.round(h * dpr);
      if (map) {
        if (autoFit || !center) fit();
        else { view.scale = Math.max(view.scale, fitScale() * 0.5); view.ox = w / 2 - center.x * view.scale; view.oy = h / 2 - center.y * view.scale; clampView(); }
      }
      // kanvas terhapus saat ukurannya diubah -> gambar langsung supaya tidak berkedip
      needMain = needOver = true;
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      frame();
    }
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => resize()) : null;
    if (ro) ro.observe(root); else window.addEventListener("resize", resize);

    function fit() {
      autoFit = true;
      if (!map || !cssW) return;
      const s = fitScale(), A = fitArea();
      view.scale = s; view.ox = A.x + (A.w - n * s) / 2; view.oy = A.y + (A.h - n * s) / 2;
      requestDraw();
    }

    // ================= API =================
    const editor = {
      setMap(m) {
        if (destroyed) return;
        if (action && action.type === "touchwait") clearTimeout(action.timer);
        action = null; zoneDraft = null; sel = null; hoverHit = null; pending = null;
        map = m || null;
        if (!map) { requestDraw(); return; }
        n = map.size || C.N;
        layers = Object.assign(Object.fromEntries(C.LAYER_KEYS.map((k) => [k, true])), map.layers || {});
        fields = getFields(C, map.seed, n);
        const a = (C.hash2(map.seed, 3, 17) - 0.5) * 0.7;
        fieldAng = { c: Math.cos(a), s: Math.sin(a) };
        if (ground.width !== n * R) { ground.width = ground.height = n * R; gctx = null; fullImg = null; }
        gctx = gctx || ground.getContext("2d");
        CN = Math.ceil(n / CHUNK); chunks = []; clearTiles();
        drawnBiome = new Uint8Array(n * n); landS = new Float32Array(n * n); shadowBuf = new Uint8Array(n * R * n * R);
        coastD = new Int8Array(n * R * n * R); coastPaths = [];
        allocVerts(); mask = buildMask(); snowLine = SNOW_MIN; landPend = null;
        terrain = null;
        syncTerrain(true);
        resize();
        fit();
      },
      setTool(t) {
        if (!TOOLS.includes(t) || t === tool) return;
        if (action && action.type !== "pinch" && action.type !== "touchrest") endAction(action.type === "line");
        tool = t; zoneDraft = null; lastZoneClick = null; hoverHit = null;
        updateCursor(); requestDraw(false, true);
      },
      setBrush(b) {
        if (!b) return;
        if (b.biome != null) {
          const i = typeof b.biome === "string" ? BIOMES.findIndex((x) => x.key === b.biome) : Number(b.biome);
          if (i >= 0 && i < BIOMES.length) brush.biome = i;
        }
        if (b.size != null) brush.size = Math.max(1, Math.min(20, Number(b.size) || 1));
        requestDraw(false, true);
      },
      setElevation(o) {
        if (!o) return;
        if (o.mode === "raise" || o.mode === "lower") elev.mode = o.mode;
        if (o.strength != null) elev.strength = clamp01(Number(o.strength) || 0);
        if (o.size != null) elev.size = Math.max(1, Math.min(20, Number(o.size) || 1));
        requestDraw(false, true);
      },
      setPlaceIcon(k) { if (k) placeIcon = String(k); },
      setPathKind(k) { if (k === "road" || k === "trail") { pathKind = k; requestDraw(false, true); } },
      setLayers(l) {
        layers = Object.assign(Object.fromEntries(C.LAYER_KEYS.map((k) => [k, true])), l || {});
        hoverHit = null; requestDraw();
      },
      setSelection(s) {
        sel = s && s.type && s.id && ARR[s.type] ? { type: s.type, id: s.id } : null;
        requestDraw();
      },
      refresh() {
        if (!map || destroyed) return;
        if (map.seed !== fields.seed || (map.size || C.N) !== n) { const s0 = sel; editor.setMap(map); sel = s0; }   // data diganti total
        syncTerrain(false);
        syncMask();
        if (sel && !findObj(sel)) { sel = null; emitSelect(); }
        hoverHit = null;
        requestDraw();
      },
      fit,
      setFitInsets(o) {   // tambahan kontrak: {top,right,bottom,left} px; fit ulang bila tampilan masih auto-fit
        const v = normInsets(o);
        if (v.top === insets.top && v.right === insets.right && v.bottom === insets.bottom && v.left === insets.left) return;
        insets = v;
        if (autoFit) fit();
      },
      zoomBy(f) { if (cssW) zoomAt(cssW / 2, cssH / 2, Number(f) || 1); },
      // pratinjau kecil tengah peta (medan + dekor, tanpa bingkai/vektor) -> kanvas w x h px pada ppc px per sel
      renderPreview(w, h, ppc) {
        if (!map) return null;
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        const g = c.getContext("2d"), ox = w / 2 - (n / 2) * ppc, oy = h / 2 - (n / 2) * ppc;
        g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
        g.drawImage(ground, ox, oy, n * ppc, n * ppc);
        g.imageSmoothingQuality = "low";
        const list = gatherDecor(-ox / ppc, -oy / ppc, (w - ox) / ppc, (h - oy) / ppc, false);
        list.sort((a, b) => a.y - b.y || a.x - b.x);
        for (const q of list) drawInst(g, q, ox + q.x * ppc, oy + q.y * ppc, ppc);
        return c;
      },
      getPxPerCell() { return view.scale; },
      resize() { resize(); requestDraw(); },
      destroy() {
        if (destroyed) return;
        destroyed = true;
        if (raf) cancelAnimationFrame(raf);
        if (action && action.type === "touchwait") clearTimeout(action.timer);
        action = null; map = null; chunks = []; clearTiles();
        if (ro) ro.disconnect(); else window.removeEventListener("resize", resize);
        window.removeEventListener("keydown", onKeyDown);
        window.removeEventListener("keyup", onKeyUp);
        window.removeEventListener("blur", onBlur);
        cv.removeEventListener("pointerdown", onDown);
        cv.removeEventListener("pointermove", onMove);
        cv.removeEventListener("pointerup", onUp);
        cv.removeEventListener("pointercancel", onUp);
        cv.removeEventListener("pointerleave", onLeave);
        cv.removeEventListener("wheel", onWheel);
        cv.removeEventListener("contextmenu", onContext);
        cv.removeEventListener("mousedown", onMouseDown);
        ground.width = ground.height = 0; cv.width = cv.height = ov.width = ov.height = 0;
        root.remove();
      },
    };
    resize();
    return editor;
  }

  // pratinjau bioma untuk palet kuas: peta kecil berisi satu bioma, dirender persis seperti peta 2D -> data URL (di-cache).
  // Satu editor tersembunyi (ukuran 0 -> tidak menggambar ke layar) dipakai bergantian lalu dibuang saat tidak dipakai lagi
  const swatchCache = new Map();
  let prev = null;
  function swatch(bi, w, h) {
    const key = bi + "|" + w + "|" + h;
    if (swatchCache.has(key)) return swatchCache.get(key);
    const C = window.NovelMapCore, B = C && C.BIOMES[bi];
    if (!B || !document.body) return null;
    let url = null;
    try {
      if (!prev) {
        const box = document.createElement("div");
        box.style.cssText = "position:fixed;left:-10000px;top:0;width:0;height:0;overflow:hidden;visibility:hidden;pointer-events:none;";
        document.body.appendChild(box);
        prev = { box, ed: create(box, {}), timer: 0 };
      }
      clearTimeout(prev.timer);
      prev.timer = setTimeout(() => { const p = prev; prev = null; p.ed.destroy(); p.box.remove(); }, 1500);
      const ppc = B.mountain ? 7 : 9, N = Math.ceil(Math.max(w, h) / ppc) + 2, m = C.createMap("pratinjau");   // cukup selebar pratinjau
      m.size = N; m.seed = 4242; m.biome = new Uint8Array(N * N).fill(bi); m.height = new Uint8Array(N * N);
      if (!B.land) C.paintBiome(m, N / 2 + w / ppc / 2 - 0.5, N / 2 + 3.2, 2.6, 1);   // laut: secuil pantai supaya buih & cincin dangkal terlihat
      prev.ed.setMap(m);
      const c = prev.ed.renderPreview(w, h, ppc);
      url = c && c.toDataURL("image/png");
    } catch (err) {
      console.warn("Pratinjau bioma:", err);
    }
    if (url) swatchCache.set(key, url);
    return url;
  }

  window.NovelMap2D = { create, swatch };
})();
