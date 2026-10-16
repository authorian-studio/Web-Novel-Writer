// ================= MAP TREES (pohon ilustrasi 2D datar, dipakai 2D & 3D) =================
// Dimuat lazy oleh app.js setelah map-core.js, sebelum map2d.js. Tanpa dependensi.
// Pohon digambar langsung di kanvas 2D bergaya ilustrasi (isi rata + bayang & sorot sederhana + garis tinta tegas):
//   2D (map2d.js)  -> draw(kind, variant, tint, P): sprite per ukuran zoom, kaki pohon di (ax, ay)
//   3D (map3d.js)  -> atlas(P): semua jenis x varian dalam satu kanvas; dipasang di papan (billboard) yang selalu
//                     menghadap kamera, jadi bentuk 2D yang sama terlihat dari arah mana pun.
// Satuan "unit" = skala pohon 1 (±1 sel peta). DIM[kind] = { w, h (unit, kaki di tengah bawah), sh: bayangan 2D
// [tinggi0, jari0, tinggi1, jari1] }.
(function () {
  "use strict";
  const INK = "#1f2e1c", TRUNK = "#6b4a2f", TRUNK_D = "#4f3522";
  const VARIANTS = 4;
  const DIM = {
    pine:       { w: 1.0,  h: 1.9,  sh: [0.25, 0.36, 1.66, 0.03] },
    pineLight:  { w: 0.86, h: 1.58, sh: [0.2, 0.3, 1.36, 0.03] },
    snowPine:   { w: 0.94, h: 1.75, sh: [0.22, 0.33, 1.5, 0.03] },
    broad:      { w: 1.3,  h: 1.62, sh: [0.4, 0.4, 1.42, 0.16] },
    broadLight: { w: 1.06, h: 1.32, sh: [0.31, 0.31, 1.11, 0.12] },
    palm:       { w: 1.5,  h: 1.55, sh: [0.62, 0.62, 0.9, 0.56] },
    reed:       { w: 0.8,  h: 0.78, sh: [0.02, 0.12, 0.42, 0.05] },
  };
  const KINDS = Object.keys(DIM);
  // warna [dasar, bayang, sorot]
  const COL = {
    pine: ["#3f7a4b", "#2a5536", "#5f9b67"],
    pineLight: ["#6c9e4d", "#4e7b38", "#8cba62"],
    snowPine: ["#3c6e48", "#2b5135", "#f3f7f8"],
    broad: ["#5f9440", "#43702c", "#8dc05a"],
    broadLight: ["#86b555", "#658e3d", "#acd36e"],
    palm: ["#4f9d3a", "#2d6f2a", "#82c957"],
    reed: ["#6f7d3d", "#56632c", "#8c9a50"],
  };
  const hex = (h) => { const v = parseInt(h.slice(1), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };
  const tinted = (h, t) => { const c = hex(h); return `rgb(${Math.min(255, c[0] * t[0]) | 0},${Math.min(255, c[1] * t[1]) | 0},${Math.min(255, c[2] * t[2]) | 0})`; };
  // acak deterministik per jenis & varian (bentuk tajuk sedikit berbeda)
  function rng(seed) { let s = seed * 9301 + 49297; return () => ((s = (s * 16807) % 2147483647) / 2147483647); }

  // ---------- gambar satu pohon: g = konteks, X/Y = px kaki pohon, u = px per unit, lw = tebal tinta (px) ----------
  function drawBroad(g, X, Y, u, lw, c, rnd, k) {
    const p = (x, y) => [X + x * u * k, Y - y * u * k];
    // batang
    const tb = p(-0.075, 0), tt = p(-0.05, 0.62), tr = p(0.05, 0.62), tbr = p(0.075, 0);
    g.beginPath(); g.moveTo(tb[0], tb[1]); g.lineTo(tt[0], tt[1]); g.lineTo(tr[0], tr[1]); g.lineTo(tbr[0], tbr[1]); g.closePath();
    g.fillStyle = TRUNK; g.fill(); g.lineWidth = lw; g.strokeStyle = INK; g.stroke();
    // tajuk = gabungan beberapa lingkaran (garis tinta hanya di luar gabungan: stroke tebal dulu, lalu isi)
    const L = [[0, 0.92, 0.42], [-0.3, 0.76, 0.29], [0.3, 0.78, 0.29], [-0.17, 1.17, 0.3], [0.19, 1.13, 0.29], [0.01, 1.32, 0.23]]
      .map(([x, y, r]) => [x + (rnd() - 0.5) * 0.07, y + (rnd() - 0.5) * 0.06, r * (0.93 + rnd() * 0.14)]);
    const crown = () => { g.beginPath(); for (const [x, y, r] of L) { const q = p(x, y); g.moveTo(q[0] + r * u * k, q[1]); g.arc(q[0], q[1], r * u * k, 0, Math.PI * 2); } };
    crown(); g.lineWidth = lw * 2; g.strokeStyle = INK; g.stroke();
    g.fillStyle = c[1]; g.fill();
    g.save(); crown(); g.clip();
    // dasar terang di kiri atas tiap lobus, bayang tetap di kanan bawah
    g.fillStyle = c[0];
    g.beginPath(); for (const [x, y, r] of L) { const q = p(x - r * 0.12, y + r * 0.12); g.moveTo(q[0] + r * 0.9 * u * k, q[1]); g.arc(q[0], q[1], r * 0.9 * u * k, 0, Math.PI * 2); } g.fill();
    g.fillStyle = c[2];
    g.beginPath(); for (const [x, y, r] of L) { const q = p(x - r * 0.35, y + r * 0.35), rr = r * 0.36 * u * k; g.moveTo(q[0] + rr, q[1]); g.arc(q[0], q[1], rr, 0, Math.PI * 2); } g.fill();
    g.restore();
    // guratan daun kecil
    g.lineWidth = Math.max(0.8, lw * 0.6); g.strokeStyle = "rgba(31,46,28,0.45)"; g.lineCap = "round";
    for (let i = 0; i < 3; i++) {
      const [x, y, r] = L[(i * 2 + 1) % L.length], q = p(x + r * 0.25, y - r * 0.2);
      g.beginPath(); g.arc(q[0], q[1], r * 0.3 * u * k, 0.3, 1.6); g.stroke();
    }
  }
  function drawPine(g, X, Y, u, lw, c, rnd, k, snow) {
    const p = (x, y) => [X + x * u * k, Y - y * u * k];
    const tb = p(-0.06, 0), tt = p(0.06, 0.34);
    g.fillStyle = TRUNK_D; g.fillRect(tb[0], tt[1], tt[0] - tb[0], tb[1] - tt[1]);
    g.lineWidth = lw; g.strokeStyle = INK; g.strokeRect(tb[0], tt[1], tt[0] - tb[0], tb[1] - tt[1]);
    const T = [[0.22, 0.98, 0.5], [0.58, 1.32, 0.41], [0.92, 1.64, 0.31], [1.22, 1.88, 0.2]];
    T.forEach(([b, a, hw], ti) => {
      hw *= 0.94 + rnd() * 0.12;
      const tier = () => {   // tingkat daun: puncak, sisi melengkung, tepi bawah bergerigi lembut
        const ap = p(0, a), R = p(hw, b), Lp = p(-hw, b), n = 3;
        g.beginPath(); g.moveTo(ap[0], ap[1]);
        g.quadraticCurveTo(...p(hw * 0.45, (a + b) * 0.5 + 0.02), R[0], R[1]);
        for (let i = 1; i <= n; i++) {
          const x0 = hw - (2 * hw * (i - 0.5)) / n, x1 = hw - (2 * hw * i) / n;
          const m = p(x0, b - 0.07), e = p(x1, b);
          g.quadraticCurveTo(m[0], m[1], e[0], e[1]);
        }
        g.lineTo(Lp[0], Lp[1]);
        g.quadraticCurveTo(...p(-hw * 0.45, (a + b) * 0.5 + 0.02), ap[0], ap[1]);
        g.closePath();
      };
      tier(); g.fillStyle = c[0]; g.fill();
      g.save(); tier(); g.clip();
      g.fillStyle = c[1]; const q = p(0.04, a + 0.1); g.fillRect(q[0], q[1], hw * u * k * 1.2, (a - b + 0.3) * u * k);   // sisi kanan gelap
      if (snow) {   // salju menumpuk di tepi bawah tiap tingkat (bagian yang tidak tertutup tingkat di atasnya)
        const sb = b + (a - b) * 0.22;
        g.fillStyle = c[2]; g.beginPath(); const s1 = p(-hw - 0.1, sb), s2 = p(hw + 0.1, sb);
        g.moveTo(s1[0], s1[1]);
        for (let i = 1; i <= 4; i++) { const x0 = -hw + (2 * hw * (i - 0.5)) / 4, x1 = -hw + (2 * hw * i) / 4; const m = p(x0, sb + 0.07), e = p(x1, sb); g.quadraticCurveTo(m[0], m[1], e[0], e[1]); }
        g.lineTo(s2[0], s2[1]); g.lineTo(s2[0], p(0, b - 0.2)[1]); g.lineTo(s1[0], p(0, b - 0.2)[1]); g.closePath(); g.fill();
        if (ti === T.length - 1) { const t0 = p(-hw, b + (a - b) * 0.55), t1 = p(hw, b + (a - b) * 0.55); g.fillRect(t0[0], p(0, a + 0.1)[1], t1[0] - t0[0], t0[1] - p(0, a + 0.1)[1]); }
      } else {
        g.strokeStyle = c[2]; g.lineWidth = Math.max(1, lw * 0.9); g.lineCap = "round";   // sorot tipis di sisi kiri
        g.beginPath(); const h0 = p(-hw * 0.18, a - 0.08), h1 = p(-hw * 0.62, b + 0.08); g.moveTo(h0[0], h0[1]); g.lineTo(h1[0], h1[1]); g.stroke();
      }
      g.restore();
      tier(); g.lineWidth = ti === 0 ? lw * 1.2 : lw; g.strokeStyle = INK; g.lineJoin = "round"; g.stroke();
    });
  }
  function drawPalm(g, X, Y, u, lw, c, rnd) {
    const p = (x, y) => [X + x * u, Y - y * u];
    const top = p(0.1 + (rnd() - 0.5) * 0.08, 0.98), cp = p(-0.12, 0.5), base = p(0, 0);
    const trunk = () => { g.beginPath(); g.moveTo(base[0], base[1]); g.quadraticCurveTo(cp[0], cp[1], top[0], top[1]); };
    g.lineCap = "round";
    trunk(); g.lineWidth = 0.13 * u + lw * 2; g.strokeStyle = INK; g.stroke();
    trunk(); g.lineWidth = 0.13 * u; g.strokeStyle = TRUNK; g.stroke();
    const A = [-172, -140, -112, -68, -40, -8, -90].map((a) => (a + (rnd() - 0.5) * 14) * Math.PI / 180);
    A.forEach((a, i) => {
      const len = (0.62 + rnd() * 0.12) * u * (i === 6 ? 0.7 : 1), droop = 0.25 * u;
      const ex = top[0] + Math.cos(a) * len, ey = top[1] + Math.sin(a) * len + droop * Math.abs(Math.cos(a));
      const mx = top[0] + Math.cos(a) * len * 0.5, my = top[1] + Math.sin(a) * len * 0.5 - 0.06 * u;
      const nx = -Math.sin(a) * 0.11 * u, ny = Math.cos(a) * 0.11 * u;
      g.beginPath(); g.moveTo(top[0], top[1]);
      g.quadraticCurveTo(mx + nx, my + ny, ex, ey); g.quadraticCurveTo(mx - nx, my - ny, top[0], top[1]); g.closePath();
      g.fillStyle = i % 2 ? c[0] : c[1]; g.fill(); g.lineWidth = lw; g.strokeStyle = INK; g.lineJoin = "round"; g.stroke();
      g.beginPath(); g.moveTo(top[0], top[1]); g.quadraticCurveTo(mx, my, ex, ey); g.lineWidth = Math.max(0.8, lw * 0.6); g.strokeStyle = c[2]; g.stroke();
    });
    g.beginPath(); g.arc(top[0], top[1] + 0.03 * u, 0.07 * u, 0, Math.PI * 2); g.fillStyle = TRUNK_D; g.fill(); g.lineWidth = lw; g.strokeStyle = INK; g.stroke();
  }
  function drawReed(g, X, Y, u, lw, c, rnd) {
    const p = (x, y) => [X + x * u, Y - y * u];
    g.lineCap = "round";
    const B = [[-0.28, 0.5], [-0.14, 0.66], [0, 0.72], [0.15, 0.62], [0.3, 0.46]].map(([x, h]) => [x + (rnd() - 0.5) * 0.05, h * (0.9 + rnd() * 0.2)]);
    const blade = ([x, h]) => { const b = p(x * 0.4, 0), m = p(x * 0.7, h * 0.55), t = p(x, h); g.beginPath(); g.moveTo(b[0], b[1]); g.quadraticCurveTo(m[0], m[1], t[0], t[1]); };
    B.forEach((q) => { blade(q); g.lineWidth = lw * 2.6; g.strokeStyle = INK; g.stroke(); });
    B.forEach((q, i) => { blade(q); g.lineWidth = lw * 1.3; g.strokeStyle = c[i % 3]; g.stroke(); });
    [[-0.1, 0.62], [0.16, 0.54]].forEach(([x, y]) => {
      const q = p(x, y);
      g.beginPath(); g.ellipse(q[0], q[1], 0.045 * u, 0.1 * u, 0, 0, Math.PI * 2);
      g.fillStyle = TRUNK; g.fill(); g.lineWidth = lw; g.strokeStyle = INK; g.stroke();
    });
  }
  function paint(g, kind, variant, X, Y, u, lw, tint) {
    const t = tint || [1, 1, 1], c = COL[kind].map((h) => tinted(h, t)), rnd = rng(KINDS.indexOf(kind) * 31 + variant * 7 + 3);
    switch (kind) {
      case "broad": drawBroad(g, X, Y, u, lw, c, rnd, 1); break;
      case "broadLight": drawBroad(g, X, Y, u, lw, c, rnd, 0.8); break;
      case "pine": drawPine(g, X, Y, u, lw, c, rnd, 1, false); break;
      case "pineLight": drawPine(g, X, Y, u, lw, c, rnd, 0.82, false); break;
      case "snowPine": drawPine(g, X, Y, u, lw, c, rnd, 0.92, true); break;
      case "palm": drawPalm(g, X, Y, u, lw, c, rnd); break;
      default: drawReed(g, X, Y, u, lw, c, rnd);
    }
  }
  const inkW = (P) => Math.max(1, Math.min(4, P * 0.055));
  const padOf = (P) => Math.ceil(inkW(P) * 1.5 + 1);

  // sprite 2D: P = px per unit -> { cv, ax, ay (px kaki), w, h }
  function draw(kind, variant, tint, P) {
    const D = DIM[kind] || DIM.broad, pad = padOf(P);
    const w = Math.max(2, Math.ceil(D.w * P + pad * 2)), h = Math.max(2, Math.ceil(D.h * P + pad * 2));
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    const g = cv.getContext("2d");
    paint(g, kind, variant % VARIANTS, w / 2, h - pad, P, inkW(P), tint);
    return { cv, ax: w / 2, ay: h - pad, w, h };
  }
  // atlas 3D: baris = jenis (urutan KINDS), kolom = varian. Per jenis: { row, w, h (unit, ukuran papan), y0 (unit, geser
  // turun supaya kaki di y = 0), u0, u1, v1 (koordinat tekstur di dalam sel, 0..1, v dari bawah) }
  function atlas(P) {
    const pad = padOf(P), gap = 4;
    let mw = 0, mh = 0;
    KINDS.forEach((k) => { mw = Math.max(mw, DIM[k].w); mh = Math.max(mh, DIM[k].h); });
    const cw = Math.ceil(mw * P + pad * 2) + gap * 2, ch = Math.ceil(mh * P + pad * 2) + gap * 2;
    const cv = document.createElement("canvas");
    cv.width = cw * VARIANTS; cv.height = ch * KINDS.length;
    const g = cv.getContext("2d"), info = {};
    KINDS.forEach((k, row) => {
      const D = DIM[k], kw = Math.ceil(D.w * P + pad * 2), kh = Math.ceil(D.h * P + pad * 2);
      for (let v = 0; v < VARIANTS; v++) {
        g.save();
        g.beginPath(); g.rect(v * cw + gap, row * ch + gap, cw - gap * 2, ch - gap * 2); g.clip();
        paint(g, k, v, v * cw + cw / 2, row * ch + ch - gap - pad, P, inkW(P), null);
        g.restore();
      }
      info[k] = { row, w: kw / P, h: kh / P, y0: pad / P, u0: (cw - kw) / 2 / cw, u1: (cw + kw) / 2 / cw, v0: gap / ch, v1: (gap + kh) / ch };
    });
    return { canvas: cv, cols: VARIANTS, rows: KINDS.length, info };
  }

  window.NovelMapTrees = { KINDS, DIM, VARIANTS, draw, atlas };
})();
