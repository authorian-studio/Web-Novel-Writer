// ================= MAP 2D (editor peta world-building) =================
// Dimuat lazy oleh app.js setelah map-core.js; dipakai map-ui.js: NovelMap2D.create(container, opts) -> editor.
//   opts: { onBeforeChange(), onChange("terrain"|"vector"), onSelect(sel|null), onViewChange({ pxPerCell }) }
//   sel  = { type: "place"|"label"|"zone"|"river"|"path", id }
// Lapisan gambar (dari bawah):
//   1. medan  -> kanvas offscreen 8 px/sel (1024x1024) diisi per piksel lewat ImageData. Hanya area yang berubah
//                yang dihitung ulang (diff medan lama vs baru), lalu digambar ke layar dengan transform pan/zoom
//   2. glyph  -> pohon, alang-alang & simbol gunung (Path2D dalam koordinat sel, di-cache per potongan 16x16 sel)
//   3. vektor -> wilayah, sungai, jalan, tempat, label (koordinat layar)
//   4. overlay (kanvas kedua) -> lingkaran kuas & pratinjau sungai/jalan/wilayah; digambar ulang tiap gerak pointer
// Bingkai krem digambar di kanvas; bayangannya pakai div (box-shadow) supaya murah saat pan/zoom.
(function () {
  "use strict";

  const R = 8;                     // piksel offscreen per sel
  const CHUNK = 16;                // ukuran potongan cache glyph (sel)
  const FRAME = 6;                 // tebal bingkai krem (px layar)
  const MAX_PX = 48;               // zoom maksimum (px layar per sel)
  const SNOW_H = 0.8;              // terrain.h mulai bersalju
  const MT_GRID = 2.3;             // jarak grid simbol gunung (sel)
  const WARP = 0.62 / 127.5;       // amplitudo distorsi tepi pantai/bioma (sel)
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
  const scaleHex = (hex, k) => { const c = rgb(hex).map((v) => Math.max(0, Math.min(255, Math.round(v * k)))); return `rgb(${c[0]},${c[1]},${c[2]})`; };
  const round2 = (v) => Math.round(v * 100) / 100;
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const isTyping = (t) => !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

  // warna tetap untuk detail medan
  const FOAM = rgb("#e6f0ee"), SHOAL = rgb("#76a6c2"), RIPPLE = rgb("#9cc0d4"), SAND = rgb("#e9dcae");
  const HIGHLAND = rgb("#a39a7e"), SNOW = rgb("#f3f5f6"), POOL = rgb("#6c8d86"), HEDGE = rgb("#7b8748"), CRACK = rgb("#8e5c34");
  const FIELD_TONES = ["#d6c46f", "#b3c063", "#a1b65b", "#cbb162", "#c1d07c", "#bb9c60", "#cdbb6c"].map(rgb);
  const MT = { lit: "#c6c0b4", dark: "#7d776c", line: "rgba(58,52,44,0.85)", snowLit: "#f8f9fa", snowDark: "#c8d1d7", base: "rgba(30,26,20,0.16)", hatch: "rgba(52,46,38,0.4)" };

  // ---------- tekstur noise per seed (awan laut, belang daratan, distorsi tepi) — di-cache untuk seed terakhir ----------
  let fieldCache = null;
  function getFields(C, seed, n) {
    if (fieldCache && fieldCache.seed === seed && fieldCache.n === n) return fieldCache;
    const W = n * R, G = n * 2 + 2;   // grid kasar 2 sampel per sel, lalu diperbesar bilinear ke resolusi piksel
    const grid = (fn) => {
      const a = new Float32Array(G * G);
      for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) a[y * G + x] = fn(x / 2, y / 2);
      return a;
    };
    const up = (src, lo, hi) => {
      const out = new Uint8Array(W * W), k = 255 / (hi - lo), f = 2 / R;
      for (let py = 0; py < W; py++) {
        const gy = (py + 0.5) * f, y0 = gy | 0, ty = gy - y0, r0 = y0 * G, r1 = r0 + G;
        for (let px = 0; px < W; px++) {
          const gx = (px + 0.5) * f, x0 = gx | 0, tx = gx - x0;
          const a = src[r0 + x0] + (src[r0 + x0 + 1] - src[r0 + x0]) * tx;
          const b = src[r1 + x0] + (src[r1 + x0 + 1] - src[r1 + x0]) * tx;
          const v = (a + (b - a) * ty - lo) * k;
          out[py * W + px] = v < 0 ? 0 : v > 255 ? 255 : v;
        }
      }
      return out;
    };
    fieldCache = {
      seed, n,
      cloud: up(grid((u, v) => C.fbm(u / 6.5, v / 6.5, seed + 11, 4)), 0.22, 0.78),
      mottle: up(grid((u, v) => C.fbm(u / 3.2, v / 3.2, seed + 23, 3)), 0.22, 0.78),
      warpX: up(grid((u, v) => C.fbm(u / 2.4, v / 2.4, seed + 37, 3)), 0.27, 0.73),
      warpY: up(grid((u, v) => C.fbm(u / 2.4, v / 2.4, seed + 53, 3)), 0.27, 0.73),
      grain: new Uint8Array(W * W),   // butiran acak per piksel
    };
    const gr = fieldCache.grain;
    for (let py = 0, i = 0; py < W; py++) for (let px = 0; px < W; px++, i++) gr[i] = C.hash2(px, py, seed) * 255;
    return fieldCache;
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
  // pita (sungai) dengan ujung membulat; sp = titik layar, hw = setengah lebar per titik. Ditambahkan ke path aktif.
  function traceRibbon(c, sp, hw) {
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
    const ae = Math.atan2(ny[m - 1], nx[m - 1]);
    c.arc(sp[m - 1][0], sp[m - 1][1], hw[m - 1], ae, ae - Math.PI, true);
    for (let i = m - 1; i >= 0; i--) c.lineTo(sp[i][0] - nx[i] * hw[i], sp[i][1] - ny[i] * hw[i]);
    const as = Math.atan2(-ny[0], -nx[0]);
    c.arc(sp[0][0], sp[0][1], hw[0], as, as - Math.PI, true);
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

    // ---------- tabel bioma (indeks 0..255; yang tidak dikenal = laut) ----------
    const landLUT = new Uint8Array(256), pat = new Uint8Array(256);
    const cR = new Float32Array(256), cG = new Float32Array(256), cB = new Float32Array(256);
    const aR = new Float32Array(256), aG = new Float32Array(256), aB = new Float32Array(256);
    const treeCol = [];
    for (let i = 0; i < 256; i++) {
      const b = BIOMES[i] || BIOMES[0], c = rgb(b.color), a = rgb(b.alt || b.color);
      landLUT[i] = b.land ? 1 : 0;
      cR[i] = c[0]; cG[i] = c[1]; cB[i] = c[2]; aR[i] = a[0]; aG[i] = a[1]; aB[i] = a[2];
      pat[i] = b.mountain ? PAT.mountain : b.pattern === "fields" ? PAT.fields : b.pattern === "cracks" ? PAT.cracks
        : ({ grassland: PAT.grass, forest: PAT.woods, pine: PAT.woods, jungle: PAT.woods, marsh: PAT.marsh, desert: PAT.desert, tundra: PAT.tundra })[b.key]
        ?? (b.tree && b.treeDensity > 0.3 ? PAT.woods : PAT.plain);
      if (b.tree && i < BIOMES.length) {
        // bioma pucat (padang rumput, tundra) memakai warna pohon hijau sendiri
        const lum = (c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11) / 255;
        const base = lum > 0.62 ? (b.tree === "pine" ? "#56745a" : "#79984f") : b.color;
        treeCol[i] = b.tree === "reed" ? { body: scaleHex(b.color, 0.62), hi: scaleHex(b.color, 0.8) }
          : { body: scaleHex(base, 0.7), hi: scaleHex(base, 1.12) };
      }
    }
    // warna dasar laut per nilai awan (LUT 0..255): biru + awan terang lembut
    const SEA_C = rgb(BIOMES[0].color), SEA_A = rgb(BIOMES[0].alt || BIOMES[0].color);
    const seaR = new Float32Array(256), seaG = new Float32Array(256), seaB = new Float32Array(256);
    for (let v = 0; v < 256; v++) {
      const ct = sstep(0.36, 0.92, v / 255) * 0.45;
      seaR[v] = SEA_C[0] + (SEA_A[0] - SEA_C[0]) * ct; seaG[v] = SEA_C[1] + (SEA_A[1] - SEA_C[1]) * ct; seaB[v] = SEA_C[2] + (SEA_A[2] - SEA_C[2]) * ct;
    }

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
    let map = null, n = 128, fields = null, terrain = null, shade = null, drawnBiome = null;
    let layers = Object.fromEntries(C.LAYER_KEYS.map((k) => [k, true]));
    let chunks = [], CN = 0, mounts = [], mountsDirty = true;
    let pending = null, terrainCost = 5, lastSync = 0;
    let cssW = 0, cssH = 0, dpr = 1;
    const view = { scale: 4, ox: 0, oy: 0 };
    let autoFit = true, lastVS = -1, lastVX = 0, lastVY = 0;
    let tool = "select";
    const brush = { biome: 1, size: 4 }, elev = { mode: "raise", strength: 0.5, size: 4 };
    let placeIcon = "city", pathKind = "road";
    let sel = null, action = null, zoneDraft = null, lastZoneClick = null;
    let hover = null, hoverInside = false, hoverHit = null, spaceDown = false;
    const touches = new Map();
    let raf = 0, needMain = false, needOver = false, destroyed = false;

    const toCell = (p) => ({ x: (p.x - view.ox) / view.scale, y: (p.y - view.oy) / view.scale });
    const sx = (x) => view.ox + x * view.scale, sy = (y) => view.oy + y * view.scale;
    const clampPt = (c) => [round2(Math.max(0, Math.min(n, c.x))), round2(Math.max(0, Math.min(n, c.y)))];
    const union = (a, b) => (!a ? { ...b } : { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) });
    const grow = (b, k) => ({ x0: Math.max(0, b.x0 - k), y0: Math.max(0, b.y0 - k), x1: Math.min(n - 1, b.x1 + k), y1: Math.min(n - 1, b.y1 + k) });
    const findObj = (s) => (s && map ? (map[ARR[s.type]] || []).find((o) => o.id === s.id) : null);
    const emitSelect = () => emit("onSelect", sel ? { type: sel.type, id: sel.id } : null);
    const isShown = () => !destroyed && cssW > 0 && root.getClientRects().length > 0;

    function requestDraw(main, over) {
      if (main !== false) needMain = true;
      if (over !== false) needOver = true;
      if (!raf && !destroyed) raf = requestAnimationFrame(frame);
    }

    // ================= MEDAN: render per piksel ke offscreen =================
    // bilinear nilai per sel (pusat sel = x+0.5) — untuk penempatan glyph
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
    const LAND_T = 0.45;
    let landS = null;
    function updateLandS(bb) {
      const bio = map.biome, nm = n - 1;
      for (let y = Math.max(0, bb.y0); y <= Math.min(nm, bb.y1); y++) for (let x = Math.max(0, bb.x0); x <= Math.min(nm, bb.x1); x++) {
        let s = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy < 0 ? 0 : y + dy > nm ? nm : y + dy, ky = dy ? 0.25 : 0.5, row = yy * n;
          for (let dx = -1; dx <= 1; dx++) { const xx = x + dx < 0 ? 0 : x + dx > nm ? nm : x + dx; s += (dx ? 0.25 : 0.5) * ky * landLUT[bio[row + xx]]; }
        }
        landS[y * n + x] = s;
      }
    }
    // nilai daratan halus di titik ber-distorsi (sama dengan garis pantai render medan); >= LAND_T = darat
    function landAtWarped(x, y) {
      const W = n * R, px = Math.max(0, Math.min(W - 1, (x * R) | 0)), py = Math.max(0, Math.min(W - 1, (y * R) | 0)), i = py * W + px;
      return bil(landS, x + (fields.warpX[i] - 127.5) * WARP, y + (fields.warpY[i] - 127.5) * WARP);
    }
    // jarak tepi sel Voronoi (F2 - F1) untuk retakan tanah
    function worleyEdge(x, y, s) {
      const xi = Math.floor(x), yi = Math.floor(y);
      let f1 = 9, f2 = 9;
      for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) {
        const gx = xi + k, gy = yi + j;
        const dx = gx + C.hash2(gx, gy, s) - x, dy = gy + C.hash2(gx, gy, s + 1) - y, dd = dx * dx + dy * dy;
        if (dd < f1) { f2 = f1; f1 = dd; } else if (dd < f2) f2 = dd;
      }
      return Math.sqrt(f2) - Math.sqrt(f1);
    }

    let LR = 0, LG = 0, LB = 0, SR = 0, SG = 0, SB = 0;   // keluaran landColor / seaColor
    let fieldAng = { c: 1, s: 0 };
    // h = ketinggian, sh = bayangan bukit (bilinear di piksel ini), edge = jarak ke pantai (sel)
    function landColor(bi, i, wu, wv, gr, edge, h, sh) {
      const m = fields.mottle[i] / 255;
      let t = (m - 0.5) * 2.2 + 0.5; t = t < 0 ? 0 : t > 1 ? 1 : t;
      let r = cR[bi] + (aR[bi] - cR[bi]) * t, g = cG[bi] + (aG[bi] - cG[bi]) * t, b = cB[bi] + (aB[bi] - cB[bi]) * t;
      const p = pat[bi];
      let k, f;
      switch (p) {
        case PAT.grass:            // bintik rumput halus
          if (gr > 0.9) { r *= 0.9; g *= 0.94; b *= 0.86; }
          break;
        case PAT.fields: {         // ladang petak-petak + pematang + alur bajak
          const ca = fieldAng.c, sa = fieldAng.s;
          const fu = (wu * ca - wv * sa) / 1.7, fv = (wu * sa + wv * ca) / 1.15;
          const row = Math.floor(fv), fu2 = fu + C.hash2(row, 7, map.seed) * 3.7, col = Math.floor(fu2);
          const fid = C.hash2(col, row, map.seed + 5), ex = fu2 - col, ey = fv - row;
          const tone = FIELD_TONES[(fid * FIELD_TONES.length) | 0];
          k = 0.97 + (m - 0.5) * 0.12;
          r = tone[0] * k; g = tone[1] * k; b = tone[2] * k;
          k = 1 + Math.sin((fid > 0.5 ? ex * 1.7 : ey * 1.15) * TAU * 3.2) * 0.035;
          r *= k; g *= k; b *= k;
          const e = Math.min(Math.min(ex, 1 - ex) * 1.7, Math.min(ey, 1 - ey) * 1.15);
          if (e < 0.08) { f = (1 - e / 0.08) * 0.6; r += (HEDGE[0] - r) * f; g += (HEDGE[1] - g) * f; b += (HEDGE[2] - b) * f; }
          break;
        }
        case PAT.woods:            // kanopi belang gelap
          k = 0.84 + C.noise2(wu * 1.9, wv * 1.9, map.seed + 61) * 0.24;
          r *= k; g *= k; b *= k;
          break;
        case PAT.marsh:            // genangan air + bintik
          f = 1 - sstep(0.3, 0.43, m);
          if (f > 0) { f *= 0.75; r += (POOL[0] - r) * f; g += (POOL[1] - g) * f; b += (POOL[2] - b) * f; }
          if (gr > 0.88) { r *= 0.9; g *= 0.93; b *= 0.9; }
          break;
        case PAT.desert:           // bukit pasir bergaris + bintik
          k = 1 + Math.sin((wu * 0.75 + wv * 0.32) * 3.4 + m * 2.4) * 0.04;
          r *= k; g *= k; b *= k;
          if (gr > 0.955) { r *= 0.9; g *= 0.87; b *= 0.82; }
          break;
        case PAT.tundra:           // petak salju & batu kecil
          f = sstep(0.6, 0.72, m) * 0.7;
          if (f > 0) { r += (SNOW[0] - r) * f; g += (SNOW[1] - g) * f; b += (SNOW[2] - b) * f; }
          if (gr > 0.94) { r *= 0.88; g *= 0.89; b *= 0.9; }
          break;
        case PAT.cracks: {         // retakan poligon (Voronoi)
          const e = worleyEdge(wu * 0.9, wv * 0.9, map.seed + 83);
          f = (1 - sstep(0.035, 0.1, e)) * 0.78;
          if (f > 0) { r += (CRACK[0] - r) * f; g += (CRACK[1] - g) * f; b += (CRACK[2] - b) * f; }
          break;
        }
        case PAT.mountain:         // batu: makin tinggi makin terang
          k = clamp01((h - 0.2) / 0.75) * 0.75 + t * 0.25;
          r = cR[bi] + (aR[bi] - cR[bi]) * k; g = cG[bi] + (aG[bi] - cG[bi]) * k; b = cB[bi] + (aB[bi] - cB[bi]) * k;
          if (gr > 0.9) { r *= 0.9; g *= 0.9; b *= 0.9; }
          break;
      }
      // dataran tinggi non-gunung jadi tanah berbatu, lalu salju (bertepi tegas, berpetak) di ketinggian
      if (p !== PAT.mountain && h > 0.45) { f = clamp01((h - 0.45) / 0.45) * 0.38; r += (HIGHLAND[0] - r) * f; g += (HIGHLAND[1] - g) * f; b += (HIGHLAND[2] - b) * f; }
      f = sstep(SNOW_H - 0.03, SNOW_H + 0.04, h + (m - 0.5) * 0.22 + (fields.warpX[i] - 127.5) * 0.0005);
      if (f > 0) { r += (SNOW[0] - r) * f; g += (SNOW[1] - g) * f; b += (SNOW[2] - b) * f; }
      // pantai: pasir tipis + garis gelap halus tepat di tepi
      if (edge < 0.24 && p !== PAT.tundra && p !== PAT.mountain) {
        f = (1 - edge / 0.24) * 0.4; r += (SAND[0] - r) * f; g += (SAND[1] - g) * f; b += (SAND[2] - b) * f;
      }
      if (edge < 0.06) { k = 0.82 + edge * 3; r *= k; g *= k; b *= k; }
      // bayangan bukit (cahaya barat laut) + butiran
      k = (1 + (sh - 1) * (p === PAT.mountain ? 1.05 : 0.8)) * (0.965 + gr * 0.07);
      LR = r * k; LG = g * k; LB = b * k;
    }
    // e = ketinggian dasar laut (0..255), s = kedekatan ke darat (terrain.shore)
    function seaColor(i, gr, e, s) {
      const c = fields.cloud[i];
      let r = seaR[c], g = seaG[c], b = seaB[c];
      if (e > 0) { const f = Math.min(1, e / 110) * 0.5; r += (SHOAL[0] - r) * f; g += (SHOAL[1] - g) * f; b += (SHOAL[2] - b) * f; }
      if (s > 0.001) {
        const k = 1 - 0.11 * sstep(0.06, 0.5, s);                   // laut dangkal dekat pantai sedikit gelap
        r *= k; g *= k; b *= k;
        const rip = (1 - sstep(0.007, 0.02, Math.abs(s - 0.13))) * 0.16; // garis riak tipis sejajar pantai
        if (rip > 0) { r += (RIPPLE[0] - r) * rip; g += (RIPPLE[1] - g) * rip; b += (RIPPLE[2] - b) * rip; }
      }
      if (gr > 0.985) { r *= 1.06; g *= 1.05; b *= 1.04; }         // bintik terang
      SR = r; SG = g; SB = b;
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
      updateLandS(grow(bb, 1));
      const W = n * R, nm = n - 1, inv = 1 / R;
      const px0 = bb.x0 * R, py0 = bb.y0 * R, pw = (bb.x1 - bb.x0 + 1) * R, ph = (bb.y1 - bb.y0 + 1) * R;
      const img = pw === W && ph === W ? fullImg || (fullImg = gctx.createImageData(W, W)) : gctx.createImageData(pw, ph), out = img.data;
      const wX = fields.warpX, wY = fields.warpY, GR = fields.grain, bio = map.biome, LS = landS;
      const H = terrain.h, SHD = shade, SHO = terrain.shore, HT = map.height;
      let o = 0;
      for (let py = py0; py < py0 + ph; py++) {
        const v = (py + 0.5) * inv;
        for (let px = px0; px < px0 + pw; px++, o += 4) {
          const i = py * W + px, u = (px + 0.5) * inv;
          const wu = u + (wX[i] - 127.5) * WARP, wv = v + (wY[i] - 127.5) * WARP;
          let fx = wu - 0.5, fy = wv - 0.5;
          fx = fx < 0 ? 0 : fx > nm ? nm : fx; fy = fy < 0 ? 0 : fy > nm ? nm : fy;
          const x0 = fx | 0, y0 = fy | 0, x1 = x0 < nm ? x0 + 1 : x0, y1 = y0 < nm ? y0 + 1 : y0, tx = fx - x0, ty = fy - y0;
          const q00 = y0 * n + x0, q10 = y0 * n + x1, q01 = y1 * n + x0, q11 = y1 * n + x1;
          const k00 = (1 - tx) * (1 - ty), k10 = tx * (1 - ty), k01 = (1 - tx) * ty, k11 = tx * ty;
          const s00 = LS[q00], s10 = LS[q10], s01 = LS[q01], s11 = LS[q11], gr = GR[i] * (1 / 255);
          let r, g, b;
          if (s00 === 0 && s10 === 0 && s01 === 0 && s11 === 0) {
            seaColor(i, gr, HT[q00] * k00 + HT[q10] * k10 + HT[q01] * k01 + HT[q11] * k11, SHO[q00] * k00 + SHO[q10] * k10 + SHO[q01] * k01 + SHO[q11] * k11);
            r = SR; g = SG; b = SB;
          } else {
            const b00 = bio[q00], b10 = bio[q10], b01 = bio[q01], b11 = bio[q11];
            const uni = b00 === b10 && b00 === b01 && b00 === b11 && landLUT[b00];
            const bi = uni ? b00 : pickBiome(b00, b10, b01, b11, k00, k10, k01, k11, x0, y0, x1, y1, tx, ty);
            const h = H[q00] * k00 + H[q10] * k10 + H[q01] * k01 + H[q11] * k11;
            const sh = SHD[q00] * k00 + SHD[q10] * k10 + SHD[q01] * k01 + SHD[q11] * k11;
            if (s00 === 1 && s10 === 1 && s01 === 1 && s11 === 1) {
              landColor(bi, i, wu, wv, gr, 1, h, sh); r = LR; g = LG; b = LB;
              if (!uni && pb2 >= 0 && pbd < 0.14) {   // anti-alias batas antar bioma
                const t = 0.5 + pbd / 0.28;
                landColor(pb2, i, wu, wv, gr, 1, h, sh);
                r = r * t + LR * (1 - t); g = g * t + LG * (1 - t); b = b * t + LB * (1 - t);
              }
            } else {
              // tepi pantai: jarak bertanda ke kontur (satuan sel) -> anti-alias, buih, pasir
              const L = s00 * k00 + s10 * k10 + s01 * k01 + s11 * k11;
              const gx = (s10 - s00) * (1 - ty) + (s11 - s01) * ty, gy = (s01 - s00) * (1 - tx) + (s11 - s10) * tx;
              const d = (L - LAND_T) / Math.max(0.2, Math.sqrt(gx * gx + gy * gy));
              const a = clamp01(0.5 + d * R);
              r = g = b = 0;
              if (a > 0) { landColor(bi, i, wu, wv, gr, d < 0 ? 0 : d, h, sh); r = LR * a; g = LG * a; b = LB * a; }
              if (a < 1) {
                seaColor(i, gr, HT[q00] * k00 + HT[q10] * k10 + HT[q01] * k01 + HT[q11] * k11, SHO[q00] * k00 + SHO[q10] * k10 + SHO[q01] * k01 + SHO[q11] * k11);
                const fo = (1 - sstep(0.02, 0.2, -d)) * 0.85;
                if (fo > 0) { SR += (FOAM[0] - SR) * fo; SG += (FOAM[1] - SG) * fo; SB += (FOAM[2] - SB) * fo; }
                r += SR * (1 - a); g += SG * (1 - a); b += SB * (1 - a);
              }
            }
          }
          out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = 255;
        }
      }
      gctx.putImageData(img, px0, py0);
    }

    // ================= GLYPH: pohon & gunung per potongan =================
    function addTree(get, kind, bi, x, y, s) {
      if (kind === "reed") {
        const p = get("reed", bi);
        p.moveTo(x - 0.17 * s, y - 0.34 * s); p.lineTo(x, y); p.lineTo(x + 0.17 * s, y - 0.34 * s);
        p.moveTo(x, y); p.lineTo(x + 0.02 * s, y - 0.46 * s);
        return;
      }
      const sh = get("shadow"), b = get("body", bi), h = get("hi", bi);
      sh.moveTo(x + 0.54 * s, y + 0.06 * s); sh.ellipse(x + 0.12 * s, y + 0.06 * s, 0.42 * s, 0.22 * s, 0, 0, TAU);
      if (kind === "pine") {
        b.moveTo(x, y - 0.98 * s); b.lineTo(x + 0.34 * s, y + 0.04 * s); b.lineTo(x - 0.34 * s, y + 0.04 * s); b.closePath();
        h.moveTo(x, y - 0.98 * s); h.lineTo(x - 0.03 * s, y + 0.04 * s); h.lineTo(x - 0.34 * s, y + 0.04 * s); h.closePath();
      } else if (kind === "palm") {
        const cy = y - 0.3 * s;
        b.moveTo(x + 0.48 * s, cy);
        for (let k = 1; k < 14; k++) { const r = (k % 2 ? 0.27 : 0.48) * s, a = (k * Math.PI) / 7; b.lineTo(x + Math.cos(a) * r, cy + Math.sin(a) * r); }
        b.closePath();
        h.moveTo(x - 0.02 * s, cy - 0.12 * s); h.arc(x - 0.12 * s, cy - 0.12 * s, 0.1 * s, 0, TAU);
      } else {
        b.moveTo(x + 0.4 * s, y - 0.3 * s); b.arc(x, y - 0.3 * s, 0.4 * s, 0, TAU);
        h.moveTo(x - 0.0 * s, y - 0.42 * s); h.arc(x - 0.13 * s, y - 0.42 * s, 0.15 * s, 0, TAU);
      }
    }
    function buildChunk(cx, cy) {
      const ch = { shadow: null, body: new Map(), hi: new Map(), reed: new Map(), mts: [] };
      const get = (k, bi) => {
        if (k === "shadow") return ch.shadow || (ch.shadow = new Path2D());
        let p = ch[k].get(bi);
        if (!p) ch[k].set(bi, (p = new Path2D()));
        return p;
      };
      const seed = map.seed, bio = map.biome, H = terrain.h, river = terrain.river;
      const x0 = cx * CHUNK, y0 = cy * CHUNK, x1 = Math.min(n, x0 + CHUNK), y1 = Math.min(n, y0 + CHUNK);
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const i = y * n + x, bi = bio[i], B = BIOMES[bi];
        if (!B || !B.land || !B.tree || river[i]) continue;
        const dense = B.treeDensity > 0.3, sub = dense ? 2 : 1, dens = B.treeDensity * (dense ? 0.85 : 1);
        for (let sy2 = 0; sy2 < sub; sy2++) for (let sx2 = 0; sx2 < sub; sx2++) {
          const gx = x * sub + sx2, gy = y * sub + sy2;
          if (C.hash2(gx, gy, seed + 101) > dens) continue;
          const jit = dense ? 0.95 : 0.6;   // acak cukup besar supaya tidak tampak berbaris
          const tx = x + (sx2 + 0.5 + (C.hash2(gx, gy, seed + 103) - 0.5) * jit) / sub;
          const ty = y + (sy2 + 0.5 + (C.hash2(gx, gy, seed + 107) - 0.5) * jit) / sub;
          if (landAtWarped(tx, ty) < 0.8 || bil(H, tx, ty) > SNOW_H - 0.06) continue;
          const sz = (dense ? 0.6 : 0.8) * (0.8 + C.hash2(gx, gy, seed + 109) * 0.45);
          addTree(get, B.tree, bi, tx, ty, sz);
        }
      }
      // simbol gunung pada grid bergeser; tiap simbol milik potongan tempat titik dasarnya berada
      const g0x = Math.floor(x0 / MT_GRID) - 1, g1x = Math.ceil(x1 / MT_GRID) + 1, g0y = Math.floor(y0 / MT_GRID) - 1, g1y = Math.ceil(y1 / MT_GRID) + 1;
      for (let gy = g0y; gy <= g1y; gy++) for (let gx = g0x; gx <= g1x; gx++) {
        const mx = (gx + 0.5 + (C.hash2(gx, gy, seed + 131) - 0.5) * 0.7) * MT_GRID;
        const my = (gy + 0.5 + (C.hash2(gx, gy, seed + 137) - 0.5) * 0.7) * MT_GRID;
        if (mx < x0 || mx >= x1 || my < y0 || my >= y1) continue;
        const ci = (my | 0) * n + (mx | 0);
        if (!BIOMES[bio[ci]] || !BIOMES[bio[ci]].mountain || river[ci] || landAtWarped(mx, my) < 0.95) continue;
        const h = Math.max(0, bil(H, mx, my)), hv = C.hash2(gx, gy, seed + 139);
        const w = 1.5 + Math.min(h, 1.6) * 1.5;
        const snow = h > SNOW_H - 0.06;
        if (hv > 0.62) {   // kadang puncak kembar kecil di belakang
          const side = hv > 0.81 ? 1 : -1;
          ch.mts.push({ x: mx + side * w * 0.38, y: my + w * 0.06, w: w * 0.72, ht: w * 0.72 * (0.5 + hv * 0.2), po: side * 0.06 * w, snow });
        }
        ch.mts.push({ x: mx, y: my + w * 0.18, w, ht: w * (0.5 + hv * 0.22 + Math.min(h, 1) * 0.16), po: (hv - 0.5) * 0.24 * w, snow });
      }
      chunks[cy * CN + cx] = ch;
    }
    function rebuildChunks(bb) {
      for (let cy = Math.floor(bb.y0 / CHUNK); cy <= Math.floor(bb.y1 / CHUNK); cy++)
        for (let cx = Math.floor(bb.x0 / CHUNK); cx <= Math.floor(bb.x1 / CHUNK); cx++) buildChunk(cx, cy);
      mountsDirty = true;
    }

    // hitung ulang medan penuh (≈5 ms) lalu render ulang hanya sel yang berbeda (+ tepi pengaruh)
    function syncTerrain(full) {
      const t0 = performance.now();
      const nt = C.computeTerrain(map), ns = C.computeShade(nt);
      let bb = null;
      if (full || !terrain) bb = { x0: 0, y0: 0, x1: n - 1, y1: n - 1 };
      else {
        const b = map.biome, ob = drawnBiome, h = nt.h, oh = terrain.h, s = nt.shore, os = terrain.shore;
        let x0 = n, y0 = n, x1 = -1, y1 = -1;
        for (let y = 0, i = 0; y < n; y++) for (let x = 0; x < n; x++, i++) {
          if (b[i] !== ob[i] || h[i] !== oh[i] || s[i] !== os[i]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
        }
        if (x1 >= 0) bb = { x0, y0, x1, y1 };
      }
      terrain = nt; shade = ns; drawnBiome.set(map.biome);
      terrainCost = performance.now() - t0;
      if (bb) { renderGround(grow(bb, 2)); rebuildChunks(grow(bb, 1)); needMain = true; }
    }
    function applyPending(now) {
      const bb = pending;
      pending = null;
      // saat menyapu: medan penuh dihitung ulang tiap frame kecuali perangkat lambat (lalu pakai medan lama sementara)
      if (!action || action.type !== "stroke" || now - lastSync >= terrainCost * 2.5) { syncTerrain(false); lastSync = now; }
      else { const e = grow(bb, 2); renderGround(e); rebuildChunks(e); }
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
        drawGlyphs();
      } else {
        ctx.fillStyle = BIOMES[0].color; ctx.fillRect(X, Y, M, M);
      }
      if (layers.zones) drawZones();
      if (layers.rivers) drawRivers();
      if (layers.paths) drawPaths();
      ctx.restore();
      ctx.strokeStyle = "rgba(70,52,28,0.4)"; ctx.lineWidth = 1;
      ctx.strokeRect(X - 0.5, Y - 0.5, M + 1, M + 1);
      if (layers.places) drawPlaces();
      if (layers.labels) drawLabels();
    }

    function drawGlyphs() {
      const s = view.scale;
      const vx0 = -view.ox / s - 2, vy0 = -view.oy / s - 2, vx1 = (cssW - view.ox) / s + 2, vy1 = (cssH - view.oy) / s + 2;
      ctx.save();
      ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * view.ox, dpr * view.oy);
      const ta = clamp01((s - 2.2) / 1.6);   // pohon muncul saat cukup zoom
      if (ta > 0) {
        const list = [];
        for (let cy = Math.max(0, Math.floor(vy0 / CHUNK)); cy <= Math.min(CN - 1, Math.floor(vy1 / CHUNK)); cy++)
          for (let cx = Math.max(0, Math.floor(vx0 / CHUNK)); cx <= Math.min(CN - 1, Math.floor(vx1 / CHUNK)); cx++) if (chunks[cy * CN + cx]) list.push(chunks[cy * CN + cx]);
        ctx.globalAlpha = ta;
        ctx.fillStyle = "rgba(22,30,16,0.3)";
        for (const ch of list) if (ch.shadow) ctx.fill(ch.shadow);
        for (const ch of list) for (const [bi, p] of ch.body) { ctx.fillStyle = treeCol[bi].body; ctx.fill(p); }
        for (const ch of list) for (const [bi, p] of ch.hi) { ctx.fillStyle = treeCol[bi].hi; ctx.fill(p); }
        ctx.lineWidth = 1 / s; ctx.lineCap = "round"; ctx.lineJoin = "round";
        for (const ch of list) for (const [bi, p] of ch.reed) { ctx.strokeStyle = treeCol[bi].body; ctx.stroke(p); }
        ctx.globalAlpha = 1;
      }
      if (mountsDirty) {
        mounts = [];
        chunks.forEach((ch) => { if (ch) for (const m of ch.mts) mounts.push(m); });
        mounts.sort((a, b) => a.y - b.y);
        mountsDirty = false;
      }
      const lw = 1 / s;
      ctx.lineJoin = "round";
      for (const m of mounts) {
        if (m.x + m.w < vx0 || m.x - m.w > vx1 || m.y < vy0 || m.y - m.ht > vy1) continue;
        const hw = m.w / 2, px = m.x + m.po, py = m.y - m.ht, rx = m.x + m.po * 0.4 + hw * 0.12;
        ctx.fillStyle = MT.base;
        ctx.beginPath(); ctx.ellipse(m.x + hw * 0.3, m.y, hw * 0.95, m.w * 0.13, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = MT.lit;
        ctx.beginPath(); ctx.moveTo(m.x - hw, m.y); ctx.lineTo(px, py); ctx.lineTo(rx, m.y); ctx.closePath(); ctx.fill();
        ctx.fillStyle = MT.dark;
        ctx.beginPath(); ctx.moveTo(rx, m.y); ctx.lineTo(px, py); ctx.lineTo(m.x + hw, m.y); ctx.closePath(); ctx.fill();
        if (m.snow) {
          const k = 0.38, ax = px + (m.x - hw - px) * k, ay = py + (m.y - py) * k, bx = px + (m.x + hw - px) * k;
          const rmx = px + (rx - px) * (k + 0.06), rmy = py + (m.y - py) * (k + 0.06);
          ctx.fillStyle = MT.snowLit;
          ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ax + (rmx - ax) * 0.45, ay + m.ht * 0.1); ctx.lineTo(rmx, rmy); ctx.lineTo(px, py); ctx.closePath(); ctx.fill();
          ctx.fillStyle = MT.snowDark;
          ctx.beginPath(); ctx.moveTo(rmx, rmy); ctx.lineTo(rmx + (bx - rmx) * 0.5, ay - m.ht * 0.02); ctx.lineTo(bx, ay); ctx.lineTo(px, py); ctx.closePath(); ctx.fill();
        }
        // arsiran di sisi gelap
        ctx.strokeStyle = MT.hatch; ctx.lineWidth = lw * 0.8; ctx.beginPath();
        for (let t = 0.55; t < 0.95; t += 0.2) {
          const y = py + (m.y - py) * t, xr = px + (rx - px) * t, xe = px + (m.x + hw - px) * t;
          ctx.moveTo(xr + (xe - xr) * 0.2, y + m.ht * 0.03); ctx.lineTo(xr + (xe - xr) * 0.62, y - m.ht * 0.05);
        }
        ctx.stroke();
        ctx.strokeStyle = MT.line; ctx.lineWidth = lw;
        ctx.beginPath(); ctx.moveTo(m.x - hw, m.y); ctx.lineTo(px, py); ctx.lineTo(m.x + hw, m.y); ctx.stroke();
        ctx.lineWidth = lw * 0.6;
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + (rx - px) * 0.55, py + (m.y - py) * 0.55); ctx.stroke();
      }
      ctx.restore();
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

    function drawZones() {
      const s = view.scale;
      ctx.lineJoin = "round";
      for (const z of map.zones) {
        const pts = z.points || [];
        if (pts.length < 3) continue;
        const isSel = sel && sel.type === "zone" && sel.id === z.id;
        ctx.beginPath();
        pts.forEach(([x, y], i) => (i ? ctx.lineTo(sx(x), sy(y)) : ctx.moveTo(sx(x), sy(y))));
        ctx.closePath();
        ctx.fillStyle = rgba(z.color, isSel ? 0.26 : 0.17); ctx.fill();
        if (isSel) { ctx.setLineDash([]); ctx.lineWidth = 5; ctx.strokeStyle = "rgba(20,16,10,0.3)"; ctx.stroke(); }
        ctx.setLineDash(isSel ? [] : [7, 5]); ctx.lineWidth = isSel ? 2.4 : 1.8; ctx.strokeStyle = rgba(z.color, 0.95); ctx.stroke();
        ctx.setLineDash([]);
        if (isSel) pts.forEach(([x, y]) => { ctx.beginPath(); ctx.arc(sx(x), sy(y), 3.5, 0, TAU); ctx.fillStyle = "#fff"; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = z.color; ctx.stroke(); });
      }
      ctx.font = `700 11.5px ${SANS}`; ctx.textBaseline = "middle"; ctx.lineJoin = "round";
      for (const z of map.zones) {
        const pts = z.points || [];
        if (pts.length < 3 || !z.name) continue;
        let x0 = Infinity, x1 = -Infinity;
        pts.forEach((p) => { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); });
        if ((x1 - x0) * s < 34) continue;
        const [lx, ly] = polyLabelPoint(C, pts), text = String(z.name).toUpperCase(), w = spacedWidth(ctx, text, 1.6);
        ctx.strokeStyle = "rgba(18,16,22,0.62)"; ctx.lineWidth = 3.2; spacedText(ctx, text, sx(lx), sy(ly), 1.6, w, true);
        ctx.fillStyle = z.color || "#fff"; spacedText(ctx, text, sx(lx), sy(ly), 1.6, w, false);
      }
    }

    function riverShape(rv, extra) {   // titik layar + setengah lebar (meruncing di hulu)
      const sp = chaikin(rv.points, 2).map((p) => [sx(p[0]), sy(p[1])]);
      const total = polyLength(sp) || 1, base = ((rv.width || 1.5) * view.scale) / 2, hw = new Float32Array(sp.length);
      let acc = 0;
      for (let i = 0; i < sp.length; i++) {
        if (i) acc += Math.hypot(sp[i][0] - sp[i - 1][0], sp[i][1] - sp[i - 1][1]);
        hw[i] = Math.max(0.75, base * (0.4 + 0.6 * sstep(0, 0.3, acc / total))) + extra;
      }
      return { sp, hw };
    }
    function drawRiverSet(c, list, extra, style) {
      c.beginPath();
      for (const rv of list) { const { sp, hw } = riverShape(rv, extra); traceRibbon(c, sp, hw); }
      c.fillStyle = style; c.fill();
    }
    function drawRivers() {
      const list = map.rivers.filter((rv) => rv.points && rv.points.length >= 2);
      if (!list.length) return;
      const selR = sel && sel.type === "river" ? list.find((r) => r.id === sel.id) : null;
      if (selR) drawRiverSet(ctx, [selR], 5, rgba(ACCENT, 0.6));
      drawRiverSet(ctx, list, 1.2, "rgba(36,72,98,0.9)");
      drawRiverSet(ctx, list, 0, "#5089b0");
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

    const pinRadius = () => Math.max(8, Math.min(13, view.scale * 0.9));
    function drawPlaces() {
      const r = pinRadius();
      ctx.font = `600 12px ${SANS}`; ctx.textBaseline = "top"; ctx.textAlign = "center"; ctx.lineJoin = "round";
      for (const pl of map.places) {
        const x = sx(pl.x), y = sy(pl.y);
        if (x < -160 || x > cssW + 160 || y < -40 || y > cssH + 40) continue;
        const isSel = sel && sel.type === "place" && sel.id === pl.id;
        if (isSel) { ctx.beginPath(); ctx.arc(x, y, r + 5, 0, TAU); ctx.fillStyle = rgba(ACCENT, 0.35); ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = ACCENT; ctx.stroke(); }
        ctx.beginPath(); ctx.ellipse(x + 1, y + r * 0.85, r * 0.8, r * 0.28, 0, 0, TAU); ctx.fillStyle = "rgba(0,0,0,0.22)"; ctx.fill();
        ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fillStyle = "#f7f1e1"; ctx.fill();
        ctx.lineWidth = 1.5; ctx.strokeStyle = INK; ctx.stroke();
        ctx.save(); ctx.translate(x, y); const k = r * 0.58; ctx.scale(k, k);
        ctx.fillStyle = INK; ctx.strokeStyle = INK; (ICONS[pl.icon] || ICONS.landmark)(ctx);
        ctx.restore();
        if (pl.name) {
          ctx.lineWidth = 3.5; ctx.strokeStyle = "rgba(246,240,224,0.92)"; ctx.strokeText(pl.name, x, y + r + 3);
          ctx.fillStyle = "#1f1a14"; ctx.fillText(pl.name, x, y + r + 3);
        }
      }
      ctx.textAlign = "left";
    }

    function labelLook(lb) {
      const st = lb.style === "water" || lb.style === "small" ? lb.style : "region";
      let px = Math.max(0.5, Number(lb.size) || 4) * view.scale * 0.9;
      if (st === "small") px *= 0.6;
      px = Math.min(px, 400);
      const raw = String(lb.text == null ? "" : lb.text).replace(/\s+/g, " ").trim();
      if (st === "region") return { px, text: raw.toUpperCase(), font: `600 ${px}px ${SERIF}`, sp: px * 0.28, fill: "#3a2c1d", halo: "rgba(244,236,214,0.72)" };
      if (st === "water") return { px, text: raw, font: `italic 500 ${px}px ${SERIF}`, sp: px * 0.08, fill: "#173550", halo: "rgba(196,220,236,0.45)" };
      return { px, text: raw, font: `500 ${px}px ${SERIF}`, sp: 0, fill: "#2b2118", halo: "rgba(244,236,214,0.8)" };
    }
    function drawLabels() {
      ctx.textBaseline = "middle"; ctx.lineJoin = "round";
      for (const lb of map.labels) {
        const L = labelLook(lb);
        if (L.px < 4.5 || !L.text) continue;
        const x = sx(lb.x), y = sy(lb.y);
        ctx.save(); ctx.translate(x, y); if (lb.rotation) ctx.rotate((lb.rotation * Math.PI) / 180);
        ctx.font = L.font;
        const w = spacedWidth(ctx, L.text, L.sp);
        if (Math.abs(x) > cssW * 3 + w || Math.abs(y) > cssH * 3 + L.px) { ctx.restore(); continue; }
        if (sel && sel.type === "label" && sel.id === lb.id) {
          ctx.setLineDash([5, 4]); ctx.lineWidth = 1.5; ctx.strokeStyle = ACCENT; ctx.fillStyle = rgba(ACCENT, 0.12);
          ctx.beginPath(); ctx.rect(-w / 2 - 6, -L.px * 0.68 - 3, w + 12, L.px * 1.36 + 6); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
        }
        ctx.strokeStyle = L.halo; ctx.lineWidth = Math.max(2, L.px * 0.2); spacedText(ctx, L.text, 0, 0, L.sp, w, true);
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
        if (action.kind === "river") { drawRiverSet(octx, [{ points: action.pts, width: 1.5 }], 1.2, "rgba(36,72,98,0.9)"); drawRiverSet(octx, [{ points: action.pts, width: 1.5 }], 0, "#5089b0"); }
        else strokePath(octx, action.pts, pathKind, false);
        octx.restore();
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
          const lb = map.labels[i], L = labelLook(lb);
          if (L.px < 4.5 || !L.text) continue;
          ctx.font = L.font;
          const w = spacedWidth(ctx, L.text, L.sp), a = -((lb.rotation || 0) * Math.PI) / 180;
          const dx = p.x - sx(lb.x), dy = p.y - sy(lb.y);
          const lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a);
          if (Math.abs(lx) <= w / 2 + 6 && Math.abs(ly) <= L.px * 0.68 + 4) return { type: "label", id: lb.id };
        }
      }
      if (layers.places) {
        const r = pinRadius();
        ctx.font = `600 12px ${SANS}`;
        for (let i = map.places.length - 1; i >= 0; i--) {
          const pl = map.places[i], x = sx(pl.x), y = sy(pl.y);
          if (Math.hypot(p.x - x, p.y - y) <= r + 4) return { type: "place", id: pl.id };
          if (pl.name) { const w = ctx.measureText(pl.name).width; if (Math.abs(p.x - x) <= w / 2 + 3 && p.y >= y + r + 1 && p.y <= y + r + 19) return { type: "place", id: pl.id }; }
        }
      }
      let best = null, bd = Infinity;
      if (layers.paths) for (const pt of map.paths) {
        const d = C.distToPolyline(c.x, c.y, pt.points) * s;
        if (d <= Math.max(7, pathWidth(pt.kind) / 2 + 4) && d < bd) { bd = d; best = { type: "path", id: pt.id }; }
      }
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
      if (cv.style.cursor !== c) cv.style.cursor = c;
    }
    function localPos(e) { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }

    function fitScale() {
      const m = Math.max(14, Math.min(cssW, cssH) * 0.03) + FRAME;
      return Math.max(0.3, Math.min((cssW - 2 * m) / n, (cssH - 2 * m) / n));
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
      if (river) syncTerrain(false);
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
      if (wasRiver) syncTerrain(false);
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
        if (a.hit.type === "river") syncTerrain(false);
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
      } else hoverInside = true;
      if (!action) {
        if (e.pointerType === "touch") return;
        hover = p;
        const h = tool === "select" ? hitTest(p) : null;
        if ((h && h.id) !== (hoverHit && hoverHit.id)) hoverHit = h;
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
      const s = fitScale();
      view.scale = s; view.ox = (cssW - n * s) / 2; view.oy = (cssH - n * s) / 2;
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
        CN = Math.ceil(n / CHUNK); chunks = new Array(CN * CN).fill(null); mounts = []; mountsDirty = true;
        drawnBiome = new Uint8Array(n * n); landS = new Float32Array(n * n);
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
        if (sel && !findObj(sel)) { sel = null; emitSelect(); }
        hoverHit = null;
        requestDraw();
      },
      fit,
      zoomBy(f) { if (cssW) zoomAt(cssW / 2, cssH / 2, Number(f) || 1); },
      getPxPerCell() { return view.scale; },
      resize() { resize(); requestDraw(); },
      destroy() {
        if (destroyed) return;
        destroyed = true;
        if (raf) cancelAnimationFrame(raf);
        if (action && action.type === "touchwait") clearTimeout(action.timer);
        action = null; map = null; chunks = []; mounts = [];
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

  window.NovelMap2D = { create };
})();
