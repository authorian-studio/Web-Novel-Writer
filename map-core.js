// ================= MAP CORE (data peta world-building) =================
// Dipakai bersama oleh editor 2D (map2d.js), tampilan 3D (map3d.js) & UI (map-ui.js). Tanpa dependensi.
// Satu peta = grid N x N sel (1 sel = 1 km). Koordinat "sel": x ke kanan, y ke bawah (utara di atas), 0..N.
// Data runtime:
//   { id, title, size: N, seed, biome: Uint8Array(N*N), height: Uint8Array(N*N),
//     rivers: [{ id, name, points: [[x,y],...], width }],          // width dalam sel
//     paths:  [{ id, name, points: [[x,y],...], kind: "road"|"trail" }],
//     places: [{ id, name, x, y, icon, desc, sceneId }],
//     zones:  [{ id, name, color, points: [[x,y],...], desc }],     // poligon tertutup
//     labels: [{ id, text, x, y, size, rotation, style: "region"|"water"|"small" }],
//     layers: { terrain, rivers, paths, places, zones, labels }   // true = tampil
//   }
// Disimpan di project sebagai p.data.maps = [serialize(map), ...] (grid dikompres RLE + base64).
(function () {
  const N = 128;
  const KM_PER_CELL = 1;

  // Bioma (index = nilai di layer biome). "land: false" = air. Warna dipakai 2D & 3D.
  const BIOMES = [
    { key: "sea",        name: "Laut & danau",  color: "#3f7396", alt: "#5d90b2", land: false },
    { key: "grassland",  name: "Padang rumput", color: "#b8c676", alt: "#cad78e", land: true, tree: "broad", treeDensity: 0.016 },
    { key: "farmland",   name: "Ladang",        color: "#cdbb6c", alt: "#a3b75c", land: true, pattern: "fields" },
    { key: "forest",     name: "Hutan",         color: "#5f8b46", alt: "#4e7a3a", land: true, tree: "broad", treeDensity: 0.55 },
    { key: "pine",       name: "Hutan pinus",   color: "#46694a", alt: "#38593d", land: true, tree: "pine", treeDensity: 0.6 },
    { key: "jungle",     name: "Rimba",         color: "#3d7a33", alt: "#2e6828", land: true, tree: "palm", treeDensity: 0.7 },
    { key: "marsh",      name: "Rawa",          color: "#8b9b62", alt: "#6e8a6c", land: true, tree: "reed", treeDensity: 0.25 },
    { key: "desert",     name: "Gurun",         color: "#e4ca91", alt: "#d5b678", land: true },
    { key: "tundra",     name: "Tundra",        color: "#d6dad6", alt: "#c2c8c5", land: true, tree: "pine", treeDensity: 0.02 },
    { key: "cracklands", name: "Tanah retak",   color: "#d69b63", alt: "#ba824f", land: true, pattern: "cracks" },
    { key: "mountains",  name: "Pegunungan",    color: "#77736e", alt: "#a9a49c", land: true, mountain: true },
  ];
  const SEA = 0;

  const PLACE_ICONS = [
    { key: "city", name: "Kota" }, { key: "village", name: "Desa" }, { key: "castle", name: "Kastil" },
    { key: "port", name: "Pelabuhan" }, { key: "temple", name: "Kuil" }, { key: "ruin", name: "Reruntuhan" },
    { key: "camp", name: "Perkemahan" }, { key: "landmark", name: "Penanda" },
  ];
  const ZONE_COLORS = ["#e15c5c", "#d7a86e", "#e3d26f", "#4caf82", "#6aa8ff", "#c77dff", "#f08bc0", "#e8e8ec"];
  const LAYER_KEYS = ["terrain", "rivers", "paths", "places", "zones", "labels"];
  const LAYER_NAMES = { terrain: "Daratan", rivers: "Sungai", paths: "Jalan", places: "Tempat", zones: "Wilayah", labels: "Label" };

  const uid = (p) => p + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  // ---------- noise deterministik (value noise + fbm) untuk tekstur & gunung ----------
  function hash2(x, y, seed) {
    let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  }
  function noise2(x, y, seed) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed), c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function fbm(x, y, seed, octaves) {
    let sum = 0, amp = 0.5, freq = 1, norm = 0;
    for (let o = 0; o < (octaves || 4); o++) { sum += amp * noise2(x * freq, y * freq, seed + o * 101); norm += amp; amp *= 0.5; freq *= 2; }
    return sum / norm;
  }

  // ---------- buat / simpan / muat ----------
  function createMap(title) {
    return {
      id: uid("map"), title: title || "Peta Baru", size: N, seed: Math.floor(Math.random() * 1e6),
      biome: new Uint8Array(N * N), height: new Uint8Array(N * N),
      rivers: [], paths: [], places: [], zones: [], labels: [],
      layers: Object.fromEntries(LAYER_KEYS.map((k) => [k, true])),
    };
  }
  // RLE (nilai, panjang-varint) lalu base64 — peta yang banyak lautnya jadi sangat kecil
  function encodeLayer(u8) {
    const out = [];
    for (let i = 0; i < u8.length;) {
      const v = u8[i]; let run = 1;
      while (i + run < u8.length && u8[i + run] === v) run++;
      out.push(v);
      let r = run; while (r >= 0x80) { out.push((r & 0x7f) | 0x80); r >>>= 7; } out.push(r);
      i += run;
    }
    let bin = ""; for (let i = 0; i < out.length; i += 0x8000) bin += String.fromCharCode.apply(null, out.slice(i, i + 0x8000));
    return btoa(bin);
  }
  function decodeLayer(str, length) {
    const u8 = new Uint8Array(length);
    if (!str) return u8;
    const bin = atob(str);
    let p = 0, i = 0;
    while (p < bin.length && i < length) {
      const v = bin.charCodeAt(p++);
      let run = 0, shift = 0, b;
      do { b = bin.charCodeAt(p++); run |= (b & 0x7f) << shift; shift += 7; } while (b & 0x80);
      u8.fill(v, i, Math.min(length, i + run)); i += run;
    }
    return u8;
  }
  function serialize(map) {
    return {
      v: 1, id: map.id, title: map.title, size: map.size, seed: map.seed,
      biome: encodeLayer(map.biome), height: encodeLayer(map.height),
      rivers: map.rivers, paths: map.paths, places: map.places, zones: map.zones, labels: map.labels, layers: map.layers,
    };
  }
  function deserialize(obj) {
    const size = obj.size || N, len = size * size;
    return {
      id: obj.id || uid("map"), title: obj.title || "Peta", size, seed: obj.seed || 1,
      biome: decodeLayer(obj.biome, len), height: decodeLayer(obj.height, len),
      rivers: obj.rivers || [], paths: obj.paths || [], places: obj.places || [], zones: obj.zones || [], labels: obj.labels || [],
      layers: Object.assign(Object.fromEntries(LAYER_KEYS.map((k) => [k, true])), obj.layers || {}),
    };
  }

  // ---------- kuas: lukis bioma, hapus (jadi laut), naik/turunkan ketinggian ----------
  // Semua mengembalikan kotak sel yang berubah {x0,y0,x1,y1} (inklusif) atau null bila tidak ada perubahan.
  function forCircle(map, cx, cy, r, fn) {
    const n = map.size, x0 = clamp(Math.floor(cx - r), 0, n - 1), x1 = clamp(Math.ceil(cx + r), 0, n - 1);
    const y0 = clamp(Math.floor(cy - r), 0, n - 1), y1 = clamp(Math.ceil(cy + r), 0, n - 1);
    let changed = false;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy, d = Math.sqrt(dx * dx + dy * dy);
      if (d <= r && fn(y * n + x, d / Math.max(r, 0.0001))) changed = true;
    }
    return changed ? { x0, y0, x1, y1 } : null;
  }
  function paintBiome(map, cx, cy, r, biomeIdx) {
    return forCircle(map, cx, cy, r, (i) => { if (map.biome[i] === biomeIdx) return false; map.biome[i] = biomeIdx; return true; });
  }
  function erase(map, cx, cy, r) {
    return forCircle(map, cx, cy, r, (i) => {
      if (map.biome[i] === SEA && map.height[i] === 0) return false;
      map.biome[i] = SEA; map.height[i] = 0; return true;
    });
  }
  // amount: -1..1 per sapuan (positif = naik). Tepi kuas lembut.
  function sculpt(map, cx, cy, r, amount) {
    return forCircle(map, cx, cy, r, (i, t) => {
      const f = (1 - t * t) * (1 - t * t), nv = clamp(Math.round(map.height[i] + amount * 40 * f), 0, 255);
      if (nv === map.height[i]) return false; map.height[i] = nv; return true;
    });
  }

  // ---------- medan: ketinggian per sel (permukaan laut = 0) ----------
  function boxBlur(src, n, rad) {
    const tmp = new Float32Array(n * n), out = new Float32Array(n * n);
    for (let y = 0; y < n; y++) {
      let acc = 0; const row = y * n;
      for (let x = -rad; x <= rad; x++) acc += src[row + clamp(x, 0, n - 1)];
      for (let x = 0; x < n; x++) {
        tmp[row + x] = acc / (2 * rad + 1);
        acc += src[row + clamp(x + rad + 1, 0, n - 1)] - src[row + clamp(x - rad, 0, n - 1)];
      }
    }
    for (let x = 0; x < n; x++) {
      let acc = 0;
      for (let y = -rad; y <= rad; y++) acc += tmp[clamp(y, 0, n - 1) * n + x];
      for (let y = 0; y < n; y++) {
        out[y * n + x] = acc / (2 * rad + 1);
        acc += tmp[clamp(y + rad + 1, 0, n - 1) * n + x] - tmp[clamp(y - rad, 0, n - 1) * n + x];
      }
    }
    return out;
  }
  function distToSegment(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 ? clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1) : 0;
    const qx = ax + t * dx - px, qy = ay + t * dy - py;
    return Math.sqrt(qx * qx + qy * qy);
  }
  function distToPolyline(px, py, pts) {
    if (!pts || !pts.length) return Infinity;
    if (pts.length === 1) return Math.hypot(px - pts[0][0], py - pts[0][1]);
    let best = Infinity;
    for (let i = 1; i < pts.length; i++) best = Math.min(best, distToSegment(px, py, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]));
    return best;
  }
  function pointInPolygon(px, py, pts) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  // Hasil: { size, h: Float32Array (≈ -0.3 .. 1.6; <0 = di bawah air), land: Float32Array 0/1,
  //          shore: Float32Array 0..1 (kedekatan ke darat), river: Uint8Array 0/1 }
  // Pemakai 3D mengalikan h dengan skala vertikal sendiri (mis. 10 sel).
  function computeTerrain(map) {
    const n = map.size, len = n * n, seed = map.seed;
    const land = new Float32Array(len), mount = new Float32Array(len);
    for (let i = 0; i < len; i++) { const b = BIOMES[map.biome[i]] || BIOMES[0]; land[i] = b.land ? 1 : 0; mount[i] = b.mountain ? 1 : 0; }
    const shore = boxBlur(boxBlur(land, n, 3), n, 2);
    // gunung = bukit batu besar yang membulat (bukan punggung bergerigi): topeng diperhalus lebar -> kubah
    const mountS = boxBlur(boxBlur(boxBlur(mount, n, 3), n, 3), n, 2);
    const h = new Float32Array(len), river = new Uint8Array(len);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const i = y * n + x, s = shore[i], e = map.height[i] / 255, nz = fbm(x / 14, y / 14, seed, 4);
      if (land[i]) {
        const ms = mountS[i], dome = ms * ms * (3 - 2 * ms), lump = fbm(x / 10, y / 10, seed + 7, 3);   // kubah + benjolan lembut
        h[i] = 0.035 + s * 0.06 + e * 0.9 + dome * (0.32 + lump * 0.9) + (nz - 0.5) * 0.04;
        if (h[i] < 0.015) h[i] = 0.015;
      } else {
        h[i] = Math.min(-0.012, -0.03 - (1 - s) * 0.24 + e * 0.25 + (nz - 0.5) * 0.02);
      }
    }
    // sungai: alur diturunkan sedikit & ditandai sebagai air
    (map.rivers || []).forEach((rv) => {
      const pts = rv.points || []; if (pts.length < 2) return;
      const w = Math.max(0.6, (rv.width || 1.5) / 2 + 0.35);
      let x0 = n, y0 = n, x1 = 0, y1 = 0;
      pts.forEach(([px, py]) => { x0 = Math.min(x0, px); y0 = Math.min(y0, py); x1 = Math.max(x1, px); y1 = Math.max(y1, py); });
      for (let y = clamp(Math.floor(y0 - w - 1), 0, n - 1); y <= clamp(Math.ceil(y1 + w + 1), 0, n - 1); y++)
        for (let x = clamp(Math.floor(x0 - w - 1), 0, n - 1); x <= clamp(Math.ceil(x1 + w + 1), 0, n - 1); x++) {
          if (distToPolyline(x + 0.5, y + 0.5, pts) > w) continue;
          const i = y * n + x;
          river[i] = 1;
          if (h[i] > 0) h[i] = Math.max(0.004, h[i] - 0.05);
        }
    });
    return { size: n, h, land, shore, river };
  }
  // bayangan bukit untuk 2D: cahaya dari barat laut; ~0.65 (gelap) .. ~1.3 (terang), 1 = datar
  function computeShade(terrain, strength) {
    const n = terrain.size, h = terrain.h, out = new Float32Array(n * n), k = (strength || 1) * 9;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const hl = h[y * n + Math.max(0, x - 1)], hr = h[y * n + Math.min(n - 1, x + 1)];
      const hu = h[Math.max(0, y - 1) * n + x], hd = h[Math.min(n - 1, y + 1) * n + x];
      const dx = Math.max(0, hr) - Math.max(0, hl), dy = Math.max(0, hd) - Math.max(0, hu);
      out[y * n + x] = clamp(1 - (dx + dy) * k * 0.5, 0.65, 1.3);
    }
    return out;
  }

  // ---------- riwayat (undo / redo) ----------
  // Pakai: hist.checkpoint() SEBELUM perubahan (sekali per sapuan/aksi); undo()/redo() mengembalikan
  // data peta di tempat (array yang sama diisi ulang) lalu return true — pemanggil wajib render ulang.
  function snapshot(map) {
    return { biome: map.biome.slice(), height: map.height.slice(),
      vec: JSON.stringify({ rivers: map.rivers, paths: map.paths, places: map.places, zones: map.zones, labels: map.labels }) };
  }
  function restore(map, snap) {
    map.biome.set(snap.biome); map.height.set(snap.height);
    Object.assign(map, JSON.parse(snap.vec));
  }
  function createHistory(map, limit) {
    let undoStack = [], redoStack = [];
    const max = limit || 40;
    return {
      reset(m) { map = m; undoStack = []; redoStack = []; },
      checkpoint() { undoStack.push(snapshot(map)); if (undoStack.length > max) undoStack.shift(); redoStack = []; },
      undo() { if (!undoStack.length) return false; redoStack.push(snapshot(map)); restore(map, undoStack.pop()); return true; },
      redo() { if (!redoStack.length) return false; undoStack.push(snapshot(map)); restore(map, redoStack.pop()); return true; },
      get canUndo() { return undoStack.length > 0; },
      get canRedo() { return redoStack.length > 0; },
    };
  }

  window.NovelMapCore = {
    N, KM_PER_CELL, BIOMES, SEA, PLACE_ICONS, ZONE_COLORS, LAYER_KEYS, LAYER_NAMES,
    uid, clamp, noise2, fbm, hash2,
    createMap, serialize, deserialize, encodeLayer, decodeLayer,
    paintBiome, erase, sculpt, computeTerrain, computeShade,
    distToPolyline, distToSegment, pointInPolygon, createHistory,
  };
})();
