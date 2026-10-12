// ================= MAP 3D (diorama three.js) =================
// Di-import dinamis oleh map-ui.js (import('./map3d.js')) saat pengguna pertama kali beralih ke tampilan 3D.
// Membangun "slab" peta dari data NovelMapCore: permukaan medan (vertex color bioma), dinding sisi berlapis tanah,
// air transparan, pohon (InstancedMesh), sungai/jalan/wilayah yang menempel medan, pin tempat & label (Sprite).
// Skala dunia: 1 unit = 1 sel (1 km); tinggi = terrain.h * 10; muka air y = 0; dasar slab y = -6;
//   peta berpusat di origin (x = cx - N/2, z = cy - N/2).
// Kontrak: createMap3D(container, { onSelect }) -> { setMap, refresh, setLayers, resetCamera, zoomBy, resize, setActive, dispose }
import * as THREE from "./vendor/three-0.169.0.module.min.js";
import { OrbitControls } from "./vendor/three-0.169.0.OrbitControls.js";

const VSCALE = 10;            // terrain.h -> unit dunia
const BASE_Y = -6;            // dasar slab
const STRATA_TOP = 20;        // batas atas tekstur lapisan tanah (unit dunia)
const STRATA_TILE = 32;       // tekstur lapisan tanah berulang tiap 32 unit
const SNOW_H = 7.4;           // mulai bersalju (unit dunia)
const FOV = 45;
const ELEV = THREE.MathUtils.degToRad(24);        // sudut kamera awal dari horizontal (dilihat dari selatan), layar lebar
const ELEV_TALL = THREE.MathUtils.degToRad(52);   // layar tegak (HP): lebih dari atas agar slab tidak kecil & gepeng
const FIT_X = 0.94, FIT_Y = 0.8, FIT_CY = 0.04;   // porsi layar (NDC) yang diisi slab saat kamera di-reset
const IDLE_MS = 66;           // saat diam, air tetap beriak ±15 fps
const PIN_COLORS = { city: "#e15c5c", village: "#cf9a5b", castle: "#8f7ad8", port: "#4f8fd6", temple: "#d9a62e",
  ruin: "#958a7c", camp: "#3fa477", landmark: "#c06ee8" };

const smooth = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lin = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };

// warna medan (linear)
const SAND = lin("#d9c99a"), BEACH = lin("#eadcae"), FLOOR_DEEP = lin("#557580"), ROCK = lin("#7d776d"),
  SNOW = lin("#f4f6f8"), PLAIN = lin("#d8cfb6"), SOIL = lin("#4b3526"), SOIL_SEA = lin("#b8a57c"),
  RIVER = "#5d95bf", ROAD = lin("#86633f"), TRAIL = lin("#a5885f");

export function createMap3D(container, opts) {
  opts = opts || {};
  const C = window.NovelMapCore;
  let renderer;
  try {
    if (!C) throw new Error("NovelMapCore belum dimuat");
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
  } catch (err) {
    return fallbackView(container, err);
  }
  const { BIOMES, hash2, noise2, fbm } = C;
  const biomeLin = BIOMES.map((b) => ({ c: lin(b.color), a: lin(b.alt || b.color) }));

  // ---------- renderer, scene, kamera, kontrol ----------
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;         // medan statis: bayangan dihitung ulang hanya saat data berubah
  const canvas = renderer.domElement;
  canvas.className = "map3d-canvas";
  canvas.setAttribute("aria-label", "Tampilan peta 3D");
  // kanvas absolut agar ukurannya tidak pernah ikut mendorong ukuran container (ResizeObserver tidak berputar)
  canvas.style.cssText = "position:absolute;inset:0;display:block;width:100%;height:100%;touch-action:none;outline:none;";
  const prevPos = container.style.position;
  if (getComputedStyle(container).position === "static") container.style.position = "relative";
  container.appendChild(canvas);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.5, 4000);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.09;
  controls.screenSpacePanning = false;           // geser sejajar tanah
  controls.zoomToCursor = true;
  controls.rotateSpeed = 0.75;
  controls.minDistance = 8;
  controls.maxDistance = 600;
  controls.minPolarAngle = 0;
  controls.maxPolarAngle = THREE.MathUtils.degToRad(80);   // tidak sampai ke bawah horizon

  const hemi = new THREE.HemisphereLight(0xeaf2ff, 0x6b5a48, 1.35);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff3df, 2.35);
  sun.position.set(-70, 125, 80);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -100, right: 100, top: 100, bottom: -100, near: 10, far: 400 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);

  const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy() || 1);
  const shared = makeShared(maxAniso, hash2);   // tekstur & material yang dipakai sepanjang umur view
  const root = new THREE.Group();
  scene.add(root);
  const G = {};
  ["terrain", "trees", "rivers", "paths", "zones", "places", "labels"].forEach((k) => { G[k] = new THREE.Group(); root.add(G[k]); });
  G.places.renderOrder = 30;

  // mesh medan/air/dinding (geometri dibangun ulang di refresh)
  const terrainMesh = new THREE.Mesh(new THREE.BufferGeometry(), shared.terrainMat);
  terrainMesh.receiveShadow = true; terrainMesh.castShadow = true;
  const wallMesh = new THREE.Mesh(new THREE.BufferGeometry(), shared.wallMat);
  wallMesh.receiveShadow = true;
  const waterMesh = new THREE.Mesh(new THREE.BufferGeometry(), shared.waterMat);
  waterMesh.renderOrder = 2; waterMesh.receiveShadow = true;
  const waterWallMesh = new THREE.Mesh(new THREE.BufferGeometry(), shared.waterWallMat);
  waterWallMesh.renderOrder = 1;
  const skirtMesh = new THREE.Mesh(waterWallMesh.geometry, shared.skirtMat);   // geometri sama dengan dinding air
  const bottomMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), shared.bottomMat);
  bottomMesh.rotation.x = Math.PI / 2;
  const dropShadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), shared.dropMat);
  dropShadow.rotation.x = -Math.PI / 2;
  dropShadow.renderOrder = -1;
  G.terrain.add(terrainMesh, wallMesh, bottomMesh);
  root.add(waterMesh, waterWallMesh, skirtMesh, dropShadow);

  // ---------- state ----------
  let map = null, mapKey = "", size = 128, Hc = null, colBiome = null, colPlain = null, maxTop = 2;
  let layers = { terrain: true, rivers: true, paths: true, places: true, zones: true, labels: true };
  let active = true, disposed = false, raf = 0, needsRender = true, lastRender = 0;
  let width = 0, height = 0, fitted = false, tween = null;
  const spriteCache = new Map();               // key teks/ikon -> { tex, w, h, cx, used }

  // ---------- data -> geometri ----------
  // ketinggian sudut grid ((n+1)^2, unit dunia) = rata-rata sel di sekitarnya; sudut di garis pantai diatur khusus
  // supaya pantai mengikuti batas sel lukisan 2D (bukan menyusut setengah sel ke darat).
  function cornerData(terrain) {
    const n = terrain.size, w = n + 1, h = terrain.h, land = terrain.land, shore = terrain.shore;
    const H = new Float32Array(w * w), LF = new Float32Array(w * w), SH = new Float32Array(w * w);
    for (let cy = 0; cy <= n; cy++) for (let cx = 0; cx <= n; cx++) {
      let sum = 0, cnt = 0, lc = 0, ss = 0;
      for (let dy = -1; dy <= 0; dy++) {
        const y = cy + dy; if (y < 0 || y >= n) continue;
        for (let dx = -1; dx <= 0; dx++) {
          const x = cx + dx; if (x < 0 || x >= n) continue;
          const i = y * n + x; sum += h[i]; cnt++; lc += land[i]; ss += shore[i];
        }
      }
      const k = cy * w + cx, lf = lc / cnt;
      let v = sum / cnt;
      // sudut cembung (1/4 darat) sedikit di bawah air, cekung di atas -> pantai tangga jadi diagonal halus
      if (lc > 0) v = lf <= 0.26 ? Math.min(v, -0.012) : lf <= 0.5 ? Math.max(v, 0.012) : Math.max(v, 0.018);
      H[k] = v * VSCALE; LF[k] = lf; SH[k] = ss / cnt;
    }
    // sel darat yang keempat sudutnya tenggelam (pulau 1 sel) tetap dimunculkan
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      if (!land[y * n + x]) continue;
      const a = y * w + x, b = a + 1, c = a + w, d = c + 1;
      if (Math.max(H[a], H[b], H[c], H[d]) > 0.05) continue;
      H[a] = Math.max(H[a], 0.08); H[b] = Math.max(H[b], 0.08); H[c] = Math.max(H[c], 0.08); H[d] = Math.max(H[d], 0.08);
    }
    return { H, LF, SH };
  }

  function sampleH(px, py) {
    const n = size, w = n + 1;
    px = clamp(px, 0, n); py = clamp(py, 0, n);
    const x0 = Math.min(n - 1, Math.floor(px)), y0 = Math.min(n - 1, Math.floor(py)), fx = px - x0, fy = py - y0;
    const a = Hc[y0 * w + x0], b = Hc[y0 * w + x0 + 1], c = Hc[(y0 + 1) * w + x0], d = Hc[(y0 + 1) * w + x0 + 1];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }

  // warna dasar per sel (linear rgb): bioma + variasi noise/pola; sel laut = pasir (diwarnai ulang per kedalaman)
  function cellColors(terrain) {
    const n = terrain.size, seed = map.seed, out = new Float32Array(n * n * 3);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const i = y * n + x, bi = map.biome[i], B = BIOMES[bi] || BIOMES[0], L = biomeLin[bi] || biomeLin[0];
      let r, g, b;
      if (!B.land) { r = SAND[0]; g = SAND[1]; b = SAND[2]; }
      else {
        let t = smooth(0.36, 0.7, fbm(x / 7, y / 7, seed + 31, 3)), k = 1 + (hash2(x, y, seed + 5) - 0.5) * 0.09;
        if (B.pattern === "fields") {
          const fy = Math.floor(y / 5), fx = Math.floor((x + fy * 3) / 6), hv = hash2(fx, fy, seed + 77);
          t = hv < 0.42 ? 0.05 : hv < 0.8 ? 0.95 : 0.5; k *= 0.88 + hv * 0.2;
        } else if (B.pattern === "cracks") {
          if (Math.abs(noise2(x / 2.6, y / 2.6, seed + 9) - 0.5) < 0.045) k *= 0.8;
        } else if (B.mountain) {
          t = smooth(0.35, 1.1, terrain.h[i]);
        } else if (bi && B.key === "desert") {
          t = 0.5 + 0.5 * Math.sin((x * 0.55 + y * 0.25) + noise2(x / 5, y / 5, seed + 3) * 4);
        }
        r = (L.c[0] + (L.a[0] - L.c[0]) * t) * k; g = (L.c[1] + (L.a[1] - L.c[1]) * t) * k; b = (L.c[2] + (L.a[2] - L.c[2]) * t) * k;
      }
      out[i * 3] = r; out[i * 3 + 1] = g; out[i * 3 + 2] = b;
    }
    return out;
  }

  function buildTerrain(terrain) {
    const n = terrain.size, w = n + 1, half = n / 2, seed = map.seed;
    const cd = cornerData(terrain);
    Hc = cd.H;
    maxTop = 0; for (let i = 0; i < Hc.length; i++) if (Hc[i] > maxTop) maxTop = Hc[i];
    const cells = cellColors(terrain);
    const pos = new Float32Array(w * w * 3), uv = new Float32Array(w * w * 2);
    colBiome = new Float32Array(w * w * 3); colPlain = new Float32Array(w * w * 3);
    for (let cy = 0; cy <= n; cy++) for (let cx = 0; cx <= n; cx++) {
      const k = cy * w + cx, hw = Hc[k];
      pos[k * 3] = cx - half; pos[k * 3 + 1] = hw; pos[k * 3 + 2] = cy - half;
      uv[k * 2] = cx / n; uv[k * 2 + 1] = 1 - cy / n;
      let r = 0, g = 0, b = 0, cnt = 0;
      for (let dy = -1; dy <= 0; dy++) {
        const y = cy + dy; if (y < 0 || y >= n) continue;
        for (let dx = -1; dx <= 0; dx++) {
          const x = cx + dx; if (x < 0 || x >= n) continue;
          const i = (y * n + x) * 3; r += cells[i]; g += cells[i + 1]; b += cells[i + 2]; cnt++;
        }
      }
      r /= cnt; g /= cnt; b /= cnt;
      let pr, pg, pb;
      if (hw < 0) {
        // dasar laut: pasir di pantai, makin dalam makin gelap kebiruan
        const t = smooth(0.2, 2.5, -hw);
        r = SAND[0] + (FLOOR_DEEP[0] - SAND[0]) * t; g = SAND[1] + (FLOOR_DEEP[1] - SAND[1]) * t; b = SAND[2] + (FLOOR_DEEP[2] - SAND[2]) * t;
        pr = r; pg = g; pb = b;
      } else {
        const hl = Hc[cy * w + Math.max(0, cx - 1)], hr = Hc[cy * w + Math.min(n, cx + 1)];
        const hu = Hc[Math.max(0, cy - 1) * w + cx], hd = Hc[Math.min(n, cy + 1) * w + cx];
        const slope = Math.hypot(hr - hl, hd - hu) * 0.5, conc = (hl + hr + hu + hd) * 0.25 - hw;
        // pantai: pasir terang tipis di garis air
        const beach = (cd.LF[k] < 1 ? 0.6 : smooth(0.6, 0.45, cd.SH[k]) * 0.18) * smooth(1.5, 0.5, hw);
        r += (BEACH[0] - r) * beach; g += (BEACH[1] - g) * beach; b += (BEACH[2] - b) * beach;
        pr = PLAIN[0] + (BEACH[0] - PLAIN[0]) * beach; pg = PLAIN[1] + (BEACH[1] - PLAIN[1]) * beach; pb = PLAIN[2] + (BEACH[2] - PLAIN[2]) * beach;
        // tebing curam = batu, puncak tinggi = salju
        const rock = smooth(0.9, 1.9, slope) * 0.75;
        r += (ROCK[0] - r) * rock; g += (ROCK[1] - g) * rock; b += (ROCK[2] - b) * rock;
        const snow = smooth(SNOW_H, SNOW_H + 1.6, hw + (noise2(cx / 3, cy / 3, seed + 41) - 0.5) * 1.6) * (1 - smooth(1.8, 3, slope) * 0.6);
        r += (SNOW[0] - r) * snow; g += (SNOW[1] - g) * snow; b += (SNOW[2] - b) * snow;
        // oklusi sederhana: lembah sedikit gelap, punggung sedikit terang
        const ao = clamp(1 - conc * 0.12, 0.84, 1.06);
        r *= ao; g *= ao; b *= ao; pr *= ao; pg *= ao; pb *= ao;
      }
      colBiome[k * 3] = r; colBiome[k * 3 + 1] = g; colBiome[k * 3 + 2] = b;
      colPlain[k * 3] = pr; colPlain[k * 3 + 1] = pg; colPlain[k * 3 + 2] = pb;
    }
    // diagonal tiap kotak dipilih mengikuti beda tinggi terkecil -> garis pantai lebih halus
    const idx = (w * w > 65535) ? new Uint32Array(n * n * 6) : new Uint16Array(n * n * 6);
    let p = 0;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const a = y * w + x, b = a + 1, c = a + w, d = c + 1;
      if (Math.abs(Hc[a] - Hc[d]) <= Math.abs(Hc[b] - Hc[c])) { idx[p++] = a; idx[p++] = c; idx[p++] = d; idx[p++] = a; idx[p++] = d; idx[p++] = b; }
      else { idx[p++] = a; idx[p++] = c; idx[p++] = b; idx[p++] = b; idx[p++] = c; idx[p++] = d; }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(layers.terrain ? colBiome : colPlain), 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    swapGeometry(terrainMesh, geo);
    buildWater(n, w, half);
  }

  // bidang air y=0: warna & alfa per kedalaman (dangkal kehijauan, dalam biru); busa tipis di garis pantai
  // dihitung per piksel di shader dari atribut kedalaman (aDepth) agar tidak melebar satu sel penuh
  function buildWater(n, w, half) {
    const pos = new Float32Array(w * w * 3), col = new Float32Array(w * w * 4), uv = new Float32Array(w * w * 2), dep = new Float32Array(w * w);
    const SHALLOW = lin("#74aabd"), DEEP = lin("#467ea6");
    for (let cy = 0; cy <= n; cy++) for (let cx = 0; cx <= n; cx++) {
      const k = cy * w + cx, d = -Hc[k], t = smooth(0.1, 2.2, d);
      pos[k * 3] = cx - half; pos[k * 3 + 2] = cy - half;
      uv[k * 2] = cx / n; uv[k * 2 + 1] = 1 - cy / n;
      dep[k] = d;
      col[k * 4] = SHALLOW[0] + (DEEP[0] - SHALLOW[0]) * t; col[k * 4 + 1] = SHALLOW[1] + (DEEP[1] - SHALLOW[1]) * t;
      col[k * 4 + 2] = SHALLOW[2] + (DEEP[2] - SHALLOW[2]) * t; col[k * 4 + 3] = 0.6 + 0.32 * t;
    }
    const idx = (w * w > 65535) ? new Uint32Array(n * n * 6) : new Uint16Array(n * n * 6);
    let p = 0;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const a = y * w + x, b = a + 1, c = a + w, d = c + 1;
      idx[p++] = a; idx[p++] = c; idx[p++] = b; idx[p++] = b; idx[p++] = c; idx[p++] = d;
    }
    const nor = new Float32Array(w * w * 3);
    for (let i = 1; i < nor.length; i += 3) nor[i] = 1;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 4));
    geo.setAttribute("aDepth", new THREE.BufferAttribute(dep, 1));
    geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    swapGeometry(waterMesh, geo);
  }

  // dinding sisi: tanah berlapis (tekstur strata) dari permukaan ke dasar; dinding air biru di tepi yang di bawah laut
  function buildWalls() {
    const n = size, w = n + 1, half = n / 2;
    const edges = [
      { at: (k) => [k, n], nx: 0, nz: 1 },        // selatan (kiri -> kanan dilihat dari luar)
      { at: (k) => [n, n - k], nx: 1, nz: 0 },    // timur
      { at: (k) => [n - k, 0], nx: 0, nz: -1 },   // utara
      { at: (k) => [0, k], nx: -1, nz: 0 },       // barat
    ];
    const cols = n + 1, ROWS = 5, vPer = cols * ROWS;
    const pos = new Float32Array(4 * vPer * 3), nor = new Float32Array(4 * vPer * 3), uv = new Float32Array(4 * vPer * 2),
      col = new Float32Array(4 * vPer * 3), idx = new Uint32Array(4 * n * (ROWS - 1) * 6);
    const wp = [], wc = [], wn = [];   // dinding air (segitiga lepas, rgba)
    const WT = lin("#72b3e2"), WB = lin("#3873a6");
    const waterV = (x, y, z, e) => {
      const t = clamp(-y / 3, 0, 1);
      wp.push(x, y, z); wn.push(e.nx, 0, e.nz);
      wc.push(WT[0] + (WB[0] - WT[0]) * t, WT[1] + (WB[1] - WT[1]) * t, WT[2] + (WB[2] - WT[2]) * t, 0.86 + 0.1 * t);
    };
    let ip = 0;
    edges.forEach((e, ei) => {
      const base = ei * vPer;
      const pts = [];
      for (let k = 0; k <= n; k++) {
        const [cx, cy] = e.at(k), ck = cy * w + cx, top = Hc[ck];
        const wx = cx - half, wz = cy - half, u = (ei * n + k) / STRATA_TILE;
        const land = top > 0;
        const tc = land ? [colBiome[ck * 3] * 0.72, colBiome[ck * 3 + 1] * 0.72, colBiome[ck * 3 + 2] * 0.72] : SOIL_SEA;
        const sc = land ? SOIL : SOIL_SEA;
        const rows = [[top, tc], [top - 0.16, sc], [top - 0.5, sc], [top - 0.62, [1, 1, 1]], [BASE_Y, [0.82, 0.82, 0.82]]];
        rows.forEach(([y, c], r) => {
          const v = base + r * cols + k;
          pos[v * 3] = wx; pos[v * 3 + 1] = y; pos[v * 3 + 2] = wz;
          nor[v * 3] = e.nx; nor[v * 3 + 2] = e.nz;
          uv[v * 2] = u; uv[v * 2 + 1] = (y - BASE_Y) / (STRATA_TOP - BASE_Y);
          col[v * 3] = c[0]; col[v * 3 + 1] = c[1]; col[v * 3 + 2] = c[2];
        });
        pts.push([wx, wz, top]);
      }
      for (let r = 0; r < ROWS - 1; r++) for (let k = 0; k < n; k++) {
        const tl = base + r * cols + k, tr = tl + 1, bl = tl + cols, br = bl + 1;
        idx[ip++] = tl; idx[ip++] = bl; idx[ip++] = br; idx[ip++] = tl; idx[ip++] = br; idx[ip++] = tr;
      }
      // air: dari dasar laut (tepi medan) ke y=0, dipotong tepat di titik medan menembus muka air
      for (let k = 0; k < n; k++) {
        const [ax, az, ha] = pts[k], [bx, bz, hb] = pts[k + 1];
        if (ha >= 0 && hb >= 0) continue;
        if (ha < 0 && hb < 0) {
          waterV(ax, ha, az, e); waterV(bx, hb, bz, e); waterV(bx, 0, bz, e);
          waterV(ax, ha, az, e); waterV(bx, 0, bz, e); waterV(ax, 0, az, e);
        } else {
          const t = ha / (ha - hb), mx = ax + (bx - ax) * t, mz = az + (bz - az) * t;
          if (ha < 0) { waterV(ax, ha, az, e); waterV(mx, 0, mz, e); waterV(ax, 0, az, e); }
          else { waterV(mx, 0, mz, e); waterV(bx, hb, bz, e); waterV(bx, 0, bz, e); }
        }
      }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    swapGeometry(wallMesh, geo);
    const wgeo = new THREE.BufferGeometry();
    wgeo.setAttribute("position", new THREE.Float32BufferAttribute(wp, 3));
    wgeo.setAttribute("normal", new THREE.Float32BufferAttribute(wn, 3));
    wgeo.setAttribute("color", new THREE.Float32BufferAttribute(wc, 4));
    swapGeometry(waterWallMesh, wgeo);
    skirtMesh.geometry = wgeo;
    bottomMesh.scale.set(n, n, 1); bottomMesh.position.y = BASE_Y;
    dropShadow.scale.set(n * 1.7, n * 1.7, 1); dropShadow.position.y = BASE_Y - 0.6;
  }

  // ---------- pohon (InstancedMesh, deterministik dengan hash2) ----------
  function buildTrees(terrain) {
    clearGroup(G.trees);
    const n = terrain.size, half = n / 2, seed = map.seed;
    // area bebas pohon: sekitar jalan & tempat
    const mask = new Uint8Array(n * n);
    const markLine = (pts, rad) => {   // per segmen (kotak kecil), bukan kotak seluruh garis -> cepat untuk garis panjang
      if (!pts || pts.length < 2) return;
      for (let s = 1; s < pts.length; s++) {
        const [ax, ay] = pts[s - 1], [bx, by] = pts[s];
        for (let y = clamp(Math.floor(Math.min(ay, by) - rad), 0, n - 1); y <= clamp(Math.ceil(Math.max(ay, by) + rad), 0, n - 1); y++)
          for (let x = clamp(Math.floor(Math.min(ax, bx) - rad), 0, n - 1); x <= clamp(Math.ceil(Math.max(ax, bx) + rad), 0, n - 1); x++)
            if (!mask[y * n + x] && C.distToSegment(x + 0.5, y + 0.5, ax, ay, bx, by) <= rad) mask[y * n + x] = 1;
      }
    };
    (map.paths || []).forEach((pa) => markLine(pa.points, 0.9));
    (map.places || []).forEach((pl) => {
      for (let y = clamp(Math.floor(pl.y - 2), 0, n - 1); y <= clamp(Math.ceil(pl.y + 2), 0, n - 1); y++)
        for (let x = clamp(Math.floor(pl.x - 2), 0, n - 1); x <= clamp(Math.ceil(pl.x + 2), 0, n - 1); x++)
          if (Math.hypot(x + 0.5 - pl.x, y + 0.5 - pl.y) <= 1.6) mask[y * n + x] = 1;
    });
    const buckets = { pine: [], broad: [], palm: [], reed: [] };
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const i = y * n + x, B = BIOMES[map.biome[i]];
      if (!B || !B.land || !B.tree || !buckets[B.tree] || terrain.river[i] || mask[i]) continue;
      const dens = B.treeDensity || 0, trials = dens > 0.3 ? 2 : 1, chance = trials === 2 ? dens * 0.82 : dens;
      for (let t = 0; t < trials; t++) {
        if (hash2(x * 3 + t, y * 5 + t * 11, seed + 911) >= chance) continue;
        const jx = x + 0.12 + 0.76 * hash2(x + t * 17, y, seed + 3), jy = y + 0.12 + 0.76 * hash2(x, y + t * 23, seed + 4);
        const h = sampleH(jx, jy);
        if (h < 0.22 || h > SNOW_H + 0.4) continue;
        const sl = Math.abs(sampleH(jx + 0.5, jy) - sampleH(jx - 0.5, jy)) + Math.abs(sampleH(jx, jy + 0.5) - sampleH(jx, jy - 0.5));
        if (sl > 1.7) continue;
        const r1 = hash2(x + t * 7, y + 3, seed + 61), r2 = hash2(x + 9, y + t * 5, seed + 62);
        buckets[B.tree].push(jx - half, h - 0.06, jy - half, 0.72 + 0.55 * r1, r2 * Math.PI * 2, r2, hash2(x, y + t, seed + 63));
      }
    }
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), s = new THREE.Vector3(), c = new THREE.Color();
    Object.keys(buckets).forEach((kind) => {
      const arr = buckets[kind], count = arr.length / 7;
      if (!count) return;
      const mesh = new THREE.InstancedMesh(shared.treeGeos[kind], shared.treeMat, count);
      for (let j = 0; j < count; j++) {
        const o = j * 7, sc = arr[o + 3];
        v.set(arr[o], arr[o + 1], arr[o + 2]);
        q.setFromEuler(e.set((arr[o + 6] - 0.5) * 0.12, arr[o + 4], (arr[o + 5] - 0.5) * 0.12));
        s.set(sc, sc * (0.88 + arr[o + 6] * 0.3), sc);
        mesh.setMatrixAt(j, m4.compose(v, q, s));
        const k = 0.84 + arr[o + 5] * 0.3, tint = (arr[o + 6] - 0.5) * 0.16;
        mesh.setColorAt(j, c.setRGB(k * (1 + tint), k, k * (1 - tint)));
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.castShadow = true; mesh.receiveShadow = true;
      G.trees.add(mesh);
    });
  }

  // ---------- pita yang menempel medan (sungai, jalan, batas wilayah) ----------
  function chaikin(pts, iter) {
    let p = pts;
    for (let it = 0; it < iter && p.length > 2; it++) {
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
  function resample(pts, step, closed) {
    const src = closed ? pts.concat([pts[0]]) : pts, out = [[src[0][0], src[0][1]]];
    for (let i = 1; i < src.length; i++) {
      const a = src[i - 1], b = src[i], d = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (d < 1e-6) continue;
      const k = Math.ceil(d / step);
      for (let j = 1; j <= k; j++) out.push([a[0] + (b[0] - a[0]) * j / k, a[1] + (b[1] - a[1]) * j / k]);
    }
    return out;
  }
  function addRibbon(acc, pts, o) {
    if (!pts || pts.length < 2) return;
    const P = resample(o.smooth ? chaikin(pts, 2) : pts, 0.5, o.closed), m = P.length;
    if (m < 2) return;
    const half = size / 2, L = new Float32Array(m);
    for (let i = 1; i < m; i++) L[i] = L[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
    const total = L[m - 1] || 1, base = acc.pos.length / 3, wet = o.dry ? new Uint8Array(m) : null;
    for (let i = 0; i < m; i++) {
      const p = P[i];
      const prev = i > 0 ? P[i - 1] : (o.closed ? P[m - 2] : null), next = i < m - 1 ? P[i + 1] : (o.closed ? P[1] : null);
      let n1x = 0, n1y = 0, n2x = 0, n2y = 0;
      if (prev) { const dx = p[0] - prev[0], dy = p[1] - prev[1], l = Math.hypot(dx, dy) || 1; n1x = -dy / l; n1y = dx / l; }
      if (next) { const dx = next[0] - p[0], dy = next[1] - p[1], l = Math.hypot(dx, dy) || 1; n2x = -dy / l; n2y = dx / l; }
      if (!prev) { n1x = n2x; n1y = n2y; }
      if (!next) { n2x = n1x; n2y = n1y; }
      let mx = n1x + n2x, my = n1y + n2y, ml = Math.hypot(mx, my);
      if (ml < 1e-4) { mx = n1x; my = n1y; ml = 1; }
      mx /= ml; my /= ml;
      const miter = 1 / Math.max(0.4, mx * n1x + my * n1y), hw = o.width(L[i] / total) * 0.5 * miter;
      const lx = p[0] + mx * hw, ly = p[1] + my * hw, rx = p[0] - mx * hw, ry = p[1] - my * hw;
      const h0 = sampleH(p[0], p[1]), hc = Math.max(h0, o.minY);
      if (wet) wet[i] = h0 < -0.3 ? 1 : 0;
      acc.pos.push(lx - half, Math.max(sampleH(lx, ly), hc) + o.lift, ly - half, rx - half, Math.max(sampleH(rx, ry), hc) + o.lift, ry - half);
      acc.col.push(o.color[0], o.color[1], o.color[2], o.color[0], o.color[1], o.color[2]);
    }
    for (let i = 0; i < m - 1; i++) {
      if (o.dash && ((L[i] + L[i + 1]) * 0.5) % (o.dash[0] + o.dash[1]) > o.dash[0]) continue;
      if (wet && wet[i] && wet[i + 1]) continue;   // sungai berhenti di laut
      const a = base + i * 2;
      acc.idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  function ribbonMesh(acc, mat) {
    if (!acc.idx.length) return null;
    const geo = new THREE.BufferGeometry(), nv = acc.pos.length / 3, nor = new Float32Array(nv * 3);
    for (let i = 1; i < nor.length; i += 3) nor[i] = 1;
    geo.setAttribute("position", new THREE.Float32BufferAttribute(acc.pos, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(acc.col, 3));
    geo.setIndex(nv > 65535 ? new THREE.Uint32BufferAttribute(acc.idx, 1) : new THREE.Uint16BufferAttribute(acc.idx, 1));
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    return mesh;
  }
  function buildVectors() {
    clearGroup(G.rivers); clearGroup(G.paths); clearGroup(G.zones);
    const rv = { pos: [], col: [], idx: [] }, riverCol = lin(RIVER);
    (map.rivers || []).forEach((r) => {
      const wd = Math.max(0.5, +r.width || 1.5);
      addRibbon(rv, r.points, { smooth: true, dry: true, lift: 0.12, minY: 0.04, color: riverCol, width: (t) => wd * (0.45 + 0.55 * smooth(0, 0.16, t)) });
    });
    const rm = ribbonMesh(rv, shared.riverMat); if (rm) G.rivers.add(rm);
    const pa = { pos: [], col: [], idx: [] };
    (map.paths || []).forEach((p) => {
      const trail = p.kind === "trail";
      addRibbon(pa, p.points, { smooth: true, lift: 0.16, minY: 0.06, color: trail ? TRAIL : ROAD,
        width: () => (trail ? 0.34 : 0.55), dash: trail ? [1.1, 0.7] : null });
    });
    const pm = ribbonMesh(pa, shared.pathMat); if (pm) G.paths.add(pm);
    const zo = { pos: [], col: [], idx: [] };
    (map.zones || []).forEach((z) => {
      if (!z.points || z.points.length < 3) return;
      addRibbon(zo, z.points, { closed: true, lift: 0.22, minY: 0.06, color: lin(z.color || "#e15c5c"), width: () => 0.42 });
    });
    const zm = ribbonMesh(zo, shared.zoneMat); if (zm) G.zones.add(zm);
  }

  // ---------- tempat (pin + nama) & label peta: Sprite CanvasTexture ----------
  function cached(key, make) {
    let e = spriteCache.get(key);
    if (!e) { e = make(); spriteCache.set(key, e); }
    e.used = true;
    return e;
  }
  function buildSprites() {
    clearGroup(G.places, true); clearGroup(G.labels, true);
    spriteCache.forEach((e) => { e.used = false; });
    const half = size / 2;
    (map.places || []).forEach((pl) => {
      const name = String(pl.name || "").trim() || "Tanpa nama";
      const e = cached("p|" + (pl.icon || "") + "|" + name, () => makePinSprite(pl.icon, name));
      const mat = new THREE.SpriteMaterial({ map: e.tex, depthTest: false, depthWrite: false, sizeAttenuation: false, premultipliedAlpha: true });
      const sp = new THREE.Sprite(mat);
      sp.center.set(e.cx, e.cy);
      sp.position.set(pl.x - half, Math.max(sampleH(pl.x, pl.y), 0) + 0.05, pl.y - half);
      sp.renderOrder = 30;
      sp.userData = { placeId: pl.id, pw: e.w, ph: e.h };
      G.places.add(sp);
    });
    (map.labels || []).forEach((lb) => {
      const text = String(lb.text || "").trim();
      if (!text) return;
      const style = lb.style === "water" || lb.style === "small" ? lb.style : "region";
      const e = cached("l|" + style + "|" + text, () => makeLabelSprite(text, style));
      const mat = new THREE.SpriteMaterial({ map: e.tex, depthTest: false, depthWrite: false, premultipliedAlpha: true,
        rotation: -(+lb.rotation || 0) * Math.PI / 180 });
      const sp = new THREE.Sprite(mat), world = Math.max(0.6, +lb.size || 4) * 0.9;   // tinggi huruf ≈ size sel
      sp.scale.set(e.w / e.fs * world, e.h / e.fs * world, 1);
      sp.position.set(lb.x - half, Math.max(sampleH(lb.x, lb.y), 0) + 1.2 + world * 0.5, lb.y - half);
      sp.renderOrder = 20;
      G.labels.add(sp);
    });
    spriteCache.forEach((e, k) => { if (!e.used) { e.tex.dispose(); spriteCache.delete(k); } });
    updateSpriteScale();
  }
  // pin berukuran tetap di layar (sizeAttenuation:false): skala = px * 2 * tan(fov/2) / tinggi viewport
  function updateSpriteScale() {
    if (!height) return;
    const k = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / height * (width < 560 ? 0.84 : 1);
    G.places.children.forEach((sp) => sp.scale.set(sp.userData.pw * k, sp.userData.ph * k, 1));
  }

  // ---------- bangun ulang semua ----------
  function refresh() {
    if (disposed) return;
    if (!map) { clearAll(); requestRender(); return; }
    const terrain = C.computeTerrain(map);
    size = terrain.size;
    buildTerrain(terrain);
    buildWalls();
    buildTrees(terrain);
    buildVectors();
    buildSprites();
    applyLayers();
    if (!fitted && width && height) resetCamera(true);
  }
  function clearAll() {
    [terrainMesh, wallMesh, waterMesh, waterWallMesh].forEach((m) => swapGeometry(m, new THREE.BufferGeometry()));
    skirtMesh.geometry = waterWallMesh.geometry;
    ["trees", "rivers", "paths", "zones"].forEach((k) => clearGroup(G[k]));
    clearGroup(G.places, true); clearGroup(G.labels, true);
    spriteCache.forEach((e) => e.tex.dispose()); spriteCache.clear();
    Hc = null;
  }
  function applyLayers() {
    G.trees.visible = !!layers.terrain;
    ["rivers", "paths", "zones", "places", "labels"].forEach((k) => { G[k].visible = !!layers[k]; });
    const attr = terrainMesh.geometry.getAttribute("color");
    if (attr && colBiome && attr.count * 3 === colBiome.length) { attr.array.set(layers.terrain ? colBiome : colPlain); attr.needsUpdate = true; }
    renderer.shadowMap.needsUpdate = true;
    requestRender();
  }

  // ---------- kamera ----------
  // pose awal: arah tetap (dari selatan, miring ELEV); target & jarak diiterasi sampai kotak slab pas di layar
  function fitPose() {
    const half = size / 2, top = Math.max(1.5, Math.min(12, maxTop)), cam = camera.clone();
    const el = ELEV_TALL + (ELEV - ELEV_TALL) * smooth(0.6, 1.5, camera.aspect);
    const dir = new THREE.Vector3(0, Math.sin(el), Math.cos(el)), target = new THREE.Vector3(0, -2, 0);
    const pts = [], v = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3();
    for (const x of [-half, half]) for (const z of [-half, half]) for (const y of [BASE_Y, top]) pts.push(new THREE.Vector3(x, y, z));
    let d = size * 2;
    for (let it = 0; it < 8; it++) {
      cam.position.copy(target).addScaledVector(dir, d); cam.lookAt(target); cam.updateMatrixWorld(true);
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      pts.forEach((p) => { v.copy(p).project(cam); x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y); });
      const tV = Math.tan(THREE.MathUtils.degToRad(FOV / 2)), tH = tV * cam.aspect;
      right.setFromMatrixColumn(cam.matrixWorld, 0); up.setFromMatrixColumn(cam.matrixWorld, 1);
      target.addScaledVector(right, ((x0 + x1) / 2) * tH * d).addScaledVector(up, ((y0 + y1) / 2 - FIT_CY) * tV * d);
      d *= Math.max((x1 - x0) / (2 * FIT_X), (y1 - y0) / (2 * FIT_Y));
    }
    // geser target di sepanjang garis pandang ke y=-2 (gambar sama, target tetap di dalam batas clampTarget)
    const t = (-2 - target.y) / dir.y;
    target.addScaledVector(dir, t); d -= t;
    return { target, pos: target.clone().addScaledVector(dir, d), d };
  }
  function resetCamera(instant) {
    if (disposed) return;
    const f = fitPose();
    controls.maxDistance = Math.max(260, f.d * 2.6);
    if (instant === true || !fitted) {
      tween = null;
      camera.position.copy(f.pos); controls.target.copy(f.target); camera.lookAt(f.target);
      controls.update();
      fitted = !!(width && height);
    } else startTween(f.pos, f.target, 520);
    requestRender();
  }
  function zoomBy(factor) {
    if (disposed || !(factor > 0)) return;
    const off = camera.position.clone().sub(controls.target);
    const d = clamp(off.length() / factor, controls.minDistance, controls.maxDistance);
    startTween(controls.target.clone().add(off.setLength(d)), controls.target.clone(), 240);
  }
  function startTween(pos, target, ms) {
    tween = { p0: camera.position.clone(), t0: controls.target.clone(), p1: pos, t1: target, start: performance.now(), ms };
    requestRender();
  }
  function stepTween(now) {
    const k = clamp((now - tween.start) / tween.ms, 0, 1), e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    camera.position.lerpVectors(tween.p0, tween.p1, e);
    controls.target.lerpVectors(tween.t0, tween.t1, e);
    if (k >= 1) tween = null;
  }
  const _tv = new THREE.Vector3();
  function clampTarget() {
    const lim = size * 0.6, t = controls.target;
    _tv.set(clamp(t.x, -lim, lim), clamp(t.y, BASE_Y, 14), clamp(t.z, -lim, lim)).sub(t);
    if (_tv.lengthSq() < 1e-10) return false;
    t.add(_tv); camera.position.add(_tv);
    return true;
  }
  controls.addEventListener("start", () => { tween = null; });
  controls.addEventListener("change", () => { needsRender = true; });

  // ---------- render loop (hanya saat aktif) ----------
  function requestRender() { needsRender = true; }
  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (!width || !height) return;
    let moved = false;
    if (tween) { stepTween(now); moved = true; }
    if (controls.update()) moved = true;
    if (clampTarget()) moved = true;
    if (!moved && !needsRender && now - lastRender < IDLE_MS) return;
    const t = now * 0.001;
    shared.waterNormal.offset.set(t * 0.011, t * 0.006);
    shared.waterTex.offset.set(t * 0.0012, -t * 0.0007);
    renderer.render(scene, camera);
    lastRender = now; needsRender = false;
  }
  function setActive(on) {
    if (disposed) return;
    active = !!on;
    if (active && !raf) { resize(); needsRender = true; raf = requestAnimationFrame(frame); }
    else if (!active && raf) { cancelAnimationFrame(raf); raf = 0; }
  }

  function resize() {
    if (disposed) return;
    const w = Math.round(container.clientWidth), h = Math.round(container.clientHeight);
    const pr = Math.min(window.devicePixelRatio || 1, 2);
    if (pr !== renderer.getPixelRatio()) { renderer.setPixelRatio(pr); requestRender(); }
    if (w === width && h === height) return;
    width = w; height = h;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    updateSpriteScale();
    if (!fitted && map) resetCamera(true);
    requestRender();
  }
  const ro = typeof ResizeObserver === "function" ? new ResizeObserver(() => resize()) : null;
  if (ro) ro.observe(container); else window.addEventListener("resize", resize);

  // ---------- klik pin tempat (raycast) & kursor ----------
  const raycaster = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let down = null, hoverPending = false, lastMove = null;
  function pickPlace(clientX, clientY) {
    if (!layers.places || !G.places.children.length) return null;
    const r = canvas.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObjects(G.places.children, false)[0];
    return hit ? hit.object.userData.placeId : null;
  }
  function onDown(e) { down = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId }; }
  function onUp(e) {
    const d = down; down = null;
    if (!d || d.id !== e.pointerId || e.button > 0) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6 || performance.now() - d.t > 700) return;
    const id = pickPlace(e.clientX, e.clientY);
    if (typeof opts.onSelect === "function") opts.onSelect(id ? { type: "place", id } : null);
  }
  function onMove(e) {
    if (e.pointerType !== "mouse" || e.buttons) return;
    lastMove = e;
    if (hoverPending) return;
    hoverPending = true;
    requestAnimationFrame(() => {
      hoverPending = false;
      if (disposed || !lastMove) return;
      canvas.style.cursor = pickPlace(lastMove.clientX, lastMove.clientY) ? "pointer" : "";
    });
  }
  function onLeave() { lastMove = null; canvas.style.cursor = ""; }
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerleave", onLeave);

  // ---------- util ----------
  function swapGeometry(mesh, geo) { if (mesh.geometry) mesh.geometry.dispose(); mesh.geometry = geo; }
  function clearGroup(g, sprites) {
    for (let i = g.children.length - 1; i >= 0; i--) {
      const o = g.children[i];
      g.remove(o);
      if (o.isInstancedMesh) o.dispose();                   // geometri/material pohon dipakai bersama
      else if (sprites || o.isSprite) { if (o.material) o.material.dispose(); }   // tekstur ada di spriteCache
      else { if (o.geometry) o.geometry.dispose(); }        // material pita dipakai bersama
    }
  }

  function setMap(m) {
    if (disposed) return;
    const key = m ? m.id + "|" + m.size : "";
    if (key !== mapKey) fitted = false;
    map = m || null; mapKey = key;
    if (map && map.layers) layers = Object.assign({}, layers, map.layers);
    refresh();
    if (map && !fitted && width && height) resetCamera(true);
  }
  function setLayers(l) {
    if (disposed || !l) return;
    layers = Object.assign({}, layers, l);
    applyLayers();
  }
  function dispose() {
    if (disposed) return;
    setActive(false);
    disposed = true;
    if (ro) ro.disconnect(); else window.removeEventListener("resize", resize);
    canvas.removeEventListener("pointerdown", onDown);
    canvas.removeEventListener("pointerup", onUp);
    canvas.removeEventListener("pointermove", onMove);
    canvas.removeEventListener("pointerleave", onLeave);
    controls.dispose();
    clearAll();
    [terrainMesh, wallMesh, waterMesh, waterWallMesh, bottomMesh, dropShadow].forEach((m) => m.geometry.dispose());
    shared.dispose();
    sun.shadow.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    canvas.remove();
    container.style.position = prevPos;
    map = null;
  }

  resize();
  raf = requestAnimationFrame(frame);

  return {
    setMap, refresh: () => refresh(), setLayers, resetCamera: () => resetCamera(false), zoomBy,
    resize, setActive, dispose,
  };
}

// ---------- tekstur, geometri pohon & material bersama ----------
function makeShared(maxAniso, hash2) {
  const disposables = [];
  const keep = (o) => (disposables.push(o), o);

  const strata = keep(new THREE.CanvasTexture(strataCanvas()));
  strata.colorSpace = THREE.SRGBColorSpace;
  strata.wrapS = THREE.RepeatWrapping; strata.wrapT = THREE.ClampToEdgeWrapping;
  strata.anisotropy = maxAniso;
  const waterTex = keep(new THREE.CanvasTexture(blotchCanvas(hash2)));   // bercak awan terang (pengali warna, linear)
  waterTex.wrapS = waterTex.wrapT = THREE.RepeatWrapping;
  waterTex.repeat.set(2, 2);
  const waterNormal = keep(new THREE.CanvasTexture(rippleNormalCanvas(hash2)));
  waterNormal.wrapS = waterNormal.wrapT = THREE.RepeatWrapping;
  waterNormal.repeat.set(14, 14);
  const drop = keep(new THREE.CanvasTexture(dropShadowCanvas()));

  const terrainMat = keep(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0 }));
  const wallMat = keep(new THREE.MeshStandardMaterial({ map: strata, vertexColors: true, roughness: 0.96, metalness: 0 }));
  const waterMat = keep(new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, depthWrite: false, map: waterTex,
    normalMap: waterNormal, normalScale: new THREE.Vector2(0.22, 0.22), roughness: 0.32, metalness: 0 }));
  waterMat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nattribute float aDepth;\nvarying float vDepth;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\n\tvDepth = aDepth;");
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying float vDepth;")
      .replace("#include <color_fragment>", "#include <color_fragment>\n\tfloat foam = 1.0 - smoothstep(0.0, 0.5, vDepth);\n" +
        "\tdiffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.80, 0.88, 0.87), foam * 0.85);\n\tdiffuseColor.a = mix(diffuseColor.a, 0.96, foam);");
  };
  const waterWallMat = keep(new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, depthWrite: false, roughness: 0.4, metalness: 0 }));
  // sisi dalam dinding air (terlihat menembus air dari atas) diwarnai seperti dasar laut dalam, bukan latar belakang
  const skirtMat = keep(new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(FLOOR_DEEP[0] * 0.78, FLOOR_DEEP[1] * 0.82, FLOOR_DEEP[2] * 0.85), side: THREE.BackSide }));
  const bottomMat = keep(new THREE.MeshStandardMaterial({ color: 0x46321f, roughness: 1, metalness: 0 }));
  const dropMat = keep(new THREE.MeshBasicMaterial({ map: drop, transparent: true, depthWrite: false }));
  const treeMat = keep(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.88, metalness: 0 }));
  const ribbon = (extra) => keep(new THREE.MeshStandardMaterial(Object.assign({ vertexColors: true, metalness: 0,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }, extra)));
  const riverMat = ribbon({ roughness: 0.3, emissive: 0x15324a, emissiveIntensity: 0.6 });
  const pathMat = ribbon({ roughness: 0.95 });
  const zoneMat = ribbon({ roughness: 0.7, emissive: 0xffffff, emissiveIntensity: 0, transparent: true, opacity: 0.92 });
  zoneMat.onBeforeCompile = (sh) => {   // garis wilayah sedikit menyala agar warnanya tetap jelas di medan gelap
    sh.fragmentShader = sh.fragmentShader.replace("#include <emissivemap_fragment>",
      "#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += diffuseColor.rgb * 0.35;");
  };

  const treeGeos = { pine: keep(pineGeo()), broad: keep(broadGeo()), palm: keep(palmGeo()), reed: keep(reedGeo()) };
  return {
    terrainMat, wallMat, waterMat, waterWallMat, skirtMat, bottomMat, dropMat, treeMat, riverMat, pathMat, zoneMat, treeGeos,
    waterTex, waterNormal,
    dispose() { disposables.forEach((o) => o.dispose()); },
  };
}

// lapisan tanah bergelombang (berulang mulus ke samping). v=0 -> BASE_Y, v=1 -> STRATA_TOP
function strataCanvas() {
  const W = 1024, H = 640, span = STRATA_TOP - BASE_Y;
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const g = cv.getContext("2d");
  let s = 1234567;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const py = (y) => H - ((y - BASE_Y) / span) * H;
  const tones = ["#ab9278", "#8c7461", "#bba286", "#997f68", "#b0977d", "#826b59", "#c1a98c", "#9d836b"];
  g.fillStyle = "#6b5646"; g.fillRect(0, 0, W, H);
  let y = BASE_Y + 0.45, ti = 0;
  while (y < STRATA_TOP + 1) {
    const A = 0.18 + rnd() * 0.22, c1 = 2 + Math.floor(rnd() * 3), c2 = 5 + Math.floor(rnd() * 4), f1 = rnd() * 6.28, f2 = rnd() * 6.28;
    g.fillStyle = tones[ti++ % tones.length];
    g.beginPath();
    for (let u = 0; u <= W; u += 8) {
      const a = (u / W) * Math.PI * 2;
      const yy = y + A * Math.sin(a * c1 + f1) + A * 0.45 * Math.sin(a * c2 + f2);
      if (u === 0) g.moveTo(u, py(yy)); else g.lineTo(u, py(yy));
    }
    g.lineTo(W, 0); g.lineTo(0, 0); g.closePath(); g.fill();
    y += 0.95 + rnd() * 0.75;
  }
  // butiran halus
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = rnd() < 0.5 ? "rgba(40,26,14,0.10)" : "rgba(255,240,215,0.07)";
    g.fillRect(rnd() * W, rnd() * H, 2 + rnd() * 3, 1 + rnd() * 2);
  }
  return cv;
}

// noise periodik (mulus saat diulang)
function pnoise(x, y, P, seed, hash2) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), m = (k) => ((k % P) + P) % P;
  const a = hash2(m(xi), m(yi), seed), b = hash2(m(xi + 1), m(yi), seed), c = hash2(m(xi), m(yi + 1), seed), d = hash2(m(xi + 1), m(yi + 1), seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function pfbm(x, y, P, seed, oct, hash2) {
  let sum = 0, amp = 0.5, norm = 0, f = 1;
  for (let o = 0; o < oct; o++) { sum += amp * pnoise(x * f, y * f, P * f, seed + o * 31, hash2); norm += amp; amp *= 0.5; f *= 2; }
  return sum / norm;
}
function blotchCanvas(hash2) {
  const S = 256, cv = document.createElement("canvas"); cv.width = cv.height = S;
  const g = cv.getContext("2d"), img = g.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const v = pfbm((x / S) * 5, (y / S) * 5, 5, 17, 4, hash2), t = Math.min(1, Math.max(0, (v - 0.5) / 0.22));
    const c = Math.round((0.86 + 0.14 * t * t * (3 - 2 * t)) * 255), i = (y * S + x) * 4;
    img.data[i] = c; img.data[i + 1] = c; img.data[i + 2] = c; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return cv;
}
function rippleNormalCanvas(hash2) {
  const S = 128, cv = document.createElement("canvas"); cv.width = cv.height = S;
  const g = cv.getContext("2d"), img = g.createImageData(S, S), hgt = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) hgt[y * S + x] = pfbm((x / S) * 4, (y / S) * 4, 4, 5, 3, hash2);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = (hgt[y * S + ((x + 1) % S)] - hgt[y * S + ((x - 1 + S) % S)]) * 6;
    const dy = (hgt[((y + 1) % S) * S + x] - hgt[((y - 1 + S) % S) * S + x]) * 6;
    const l = Math.hypot(dx, dy, 1), i = (y * S + x) * 4;
    img.data[i] = Math.round((-dx / l * 0.5 + 0.5) * 255); img.data[i + 1] = Math.round((dy / l * 0.5 + 0.5) * 255);
    img.data[i + 2] = Math.round((1 / l * 0.5 + 0.5) * 255); img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return cv;
}
// bayangan lembut di bawah slab (pakai shadowBlur agar jalan di semua browser)
function dropShadowCanvas() {
  const S = 256, cv = document.createElement("canvas"); cv.width = cv.height = S;
  const g = cv.getContext("2d"), r = S / 1.7 / 2;
  g.shadowColor = "rgba(0,0,0,0.5)"; g.shadowBlur = 34; g.shadowOffsetX = S;
  g.fillStyle = "#000";
  g.fillRect(S / 2 - r - S, S / 2 - r, r * 2, r * 2);
  return cv;
}

// geometri pohon: bagian-bagian digabung dengan vertex color (batang coklat, tajuk hijau)
function part(geo, hex, tx, ty, tz, sx, sy, sz) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  g.scale(sx || 1, sy || 1, sz || 1); g.translate(tx, ty, tz);
  const c = new THREE.Color(hex), n = g.getAttribute("position").count, col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return g;
}
function merge(parts) {
  const total = parts.reduce((s, g) => s + g.getAttribute("position").count, 0);
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), col = new Float32Array(total * 3);
  let o = 0;
  parts.forEach((g) => {
    const n = g.getAttribute("position").count;
    pos.set(g.getAttribute("position").array, o * 3); nor.set(g.getAttribute("normal").array, o * 3); col.set(g.getAttribute("color").array, o * 3);
    o += n; g.dispose();
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  geo.computeBoundingSphere();
  return geo;
}
const TRUNK = "#6b4a2f";
function pineGeo() {
  return merge([
    part(new THREE.CylinderGeometry(0.05, 0.07, 0.3, 5), TRUNK, 0, 0.15, 0),
    part(new THREE.ConeGeometry(0.36, 0.72, 7), "#2f5c3c", 0, 0.6, 0),
    part(new THREE.ConeGeometry(0.26, 0.56, 7), "#356643", 0, 0.98, 0),
  ]);
}
function broadGeo() {
  return merge([
    part(new THREE.CylinderGeometry(0.05, 0.075, 0.42, 5), TRUNK, 0, 0.21, 0),
    part(new THREE.IcosahedronGeometry(0.38, 0), "#4f803b", 0, 0.66, 0, 1, 0.88, 1),
    part(new THREE.IcosahedronGeometry(0.22, 0), "#5b8c42", 0.12, 0.86, 0.06),
  ]);
}
function palmGeo() {
  return merge([
    part(new THREE.CylinderGeometry(0.035, 0.055, 0.8, 5), "#7a5a36", 0, 0.4, 0),
    part(new THREE.IcosahedronGeometry(0.34, 0), "#3e7d2d", 0, 0.84, 0, 1.55, 0.42, 1.55),
    part(new THREE.ConeGeometry(0.12, 0.2, 5), "#4a8a33", 0, 0.98, 0),
  ]);
}
function reedGeo() {
  return merge([
    part(new THREE.ConeGeometry(0.04, 0.46, 4), "#9fa25a", -0.09, 0.23, 0.02),
    part(new THREE.ConeGeometry(0.035, 0.38, 4), "#7f8f4b", 0.08, 0.19, -0.05),
    part(new THREE.ConeGeometry(0.035, 0.52, 4), "#b0a865", 0.01, 0.26, 0.09),
  ]);
}

// ---------- sprite tempat & label ----------
const UI_FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
function spriteTexture(cv, mip) {
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.premultiplyAlpha = true;
  tex.generateMipmaps = !!mip;
  tex.minFilter = mip ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  return tex;
}
function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.arcTo(x + w, y, x + w, y + r, r); g.lineTo(x + w, y + h - r);
  g.arcTo(x + w, y + h, x + w - r, y + h, r); g.lineTo(x + r, y + h); g.arcTo(x, y + h, x, y + h - r, r);
  g.lineTo(x, y + r); g.arcTo(x, y, x + r, y, r); g.closePath();
}
// pin tetes + glyph ikon + nama di kanan. Dimensi dalam px CSS; kanvas digambar 2x agar tajam.
function makePinSprite(icon, name) {
  const S = 2, M = 3, PW = 24, PH = 32, R = 10, GAP = 5, FS = 12, PILL_H = 20;
  if (name.length > 32) name = name.slice(0, 31) + "…";
  const meas = document.createElement("canvas").getContext("2d");
  meas.font = `600 ${FS}px ${UI_FONT}`;
  const tw = Math.ceil(meas.measureText(name).width), pillW = tw + 16;
  const w = M + PW + GAP + pillW + M, h = M + PH + M;
  const cv = document.createElement("canvas"); cv.width = w * S; cv.height = h * S;
  const g = cv.getContext("2d");
  g.scale(S, S);
  const cx = M + PW / 2, cy = M + R + 1, tipY = M + PH;
  // nama
  const py = cy - PILL_H / 2, px = M + PW + GAP;
  g.fillStyle = "rgba(20,16,30,0.80)";
  roundRect(g, px, py, pillW, PILL_H, PILL_H / 2); g.fill();
  g.fillStyle = "#fff"; g.font = `600 ${FS}px ${UI_FONT}`; g.textBaseline = "middle";
  g.fillText(name, px + 8, cy + 0.5);
  // pin
  const d = tipY - cy, a = Math.acos(R / d);
  g.save();
  g.shadowColor = "rgba(0,0,0,0.45)"; g.shadowBlur = 4; g.shadowOffsetY = 1;
  g.beginPath();
  g.moveTo(cx, tipY);
  g.arc(cx, cy, R, Math.PI / 2 - a, Math.PI / 2 + a, true);
  g.closePath();
  g.fillStyle = PIN_COLORS[icon] || "#e15c5c"; g.fill();
  g.restore();
  g.lineWidth = 1.6; g.strokeStyle = "rgba(255,255,255,0.95)"; g.stroke();
  drawGlyph(g, icon, cx, cy, 6.4);
  return { tex: spriteTexture(cv, false), w, h, cx: cx / w, cy: M / h };
}
function drawGlyph(g, key, cx, cy, r) {
  g.save();
  g.translate(cx, cy); g.scale(r / 8, r / 8);
  g.fillStyle = "#fff"; g.strokeStyle = "#fff"; g.lineWidth = 1.8; g.lineCap = "round"; g.lineJoin = "round";
  const poly = (pts) => { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.fill(); };
  switch (key) {
    case "city": g.fillRect(-7, -1, 4, 8); g.fillRect(-2, -7, 4, 14); g.fillRect(3, -3, 4, 10); break;
    case "village": poly([[-6, 6], [-6, -1], [0, -7], [6, -1], [6, 6]]); break;
    case "castle": poly([[-6, 7], [-6, -6], [-3.6, -6], [-3.6, -3.4], [-1.2, -3.4], [-1.2, -6], [1.2, -6], [1.2, -3.4], [3.6, -3.4], [3.6, -6], [6, -6], [6, 7]]); break;
    case "port":
      g.beginPath(); g.arc(0, -5, 1.9, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.moveTo(0, -3); g.lineTo(0, 6.5); g.moveTo(-3.5, -0.5); g.lineTo(3.5, -0.5); g.stroke();
      g.beginPath(); g.arc(0, 1, 5.6, Math.PI * 0.12, Math.PI * 0.88); g.stroke(); break;
    case "temple": poly([[-7, -3], [0, -7.5], [7, -3]]); g.fillRect(-6, -2, 2.2, 7); g.fillRect(-1.1, -2, 2.2, 7); g.fillRect(3.8, -2, 2.2, 7); g.fillRect(-7, 5, 14, 2); break;
    case "ruin": poly([[-6, 6], [-6, -3], [-4.8, -4.5], [-3.5, -2.5], [-3.5, 6]]); poly([[-1.2, 6], [-1.2, -6], [0.4, -4.2], [1.4, -5.5], [1.4, 6]]); poly([[3.8, 6], [3.8, 1], [5.2, 0], [6.4, 1.5], [6.4, 6]]); g.fillRect(-7, 6, 14, 1.6); break;
    case "camp": poly([[-7.5, 6.5], [0, -7], [7.5, 6.5]]); g.fillStyle = "rgba(0,0,0,0.35)"; poly([[-2, 6.5], [0, 1.5], [2, 6.5]]); break;
    case "landmark": {
      const pts = [];
      for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? 3.2 : 7.5; pts.push([Math.cos(a) * rr, Math.sin(a) * rr]); }
      poly(pts); break;
    }
    default: g.beginPath(); g.arc(0, 0, 3.5, 0, Math.PI * 2); g.fill();
  }
  g.restore();
}
// label peta (ukuran dunia): region = serif kapital berjarak, water = miring kebiruan, small = sans kecil
function makeLabelSprite(text, style) {
  const FS = 64;
  const font = style === "water" ? `italic 500 ${FS}px Georgia, "Times New Roman", serif`
    : style === "small" ? `600 ${FS}px ${UI_FONT}` : `600 ${FS}px Georgia, "Times New Roman", serif`;
  const str = style === "region" ? text.toUpperCase() : text;
  const spacing = style === "region" ? FS * 0.16 : style === "water" ? FS * 0.05 : 0;
  const fill = style === "water" ? "#e4f2ff" : style === "small" ? "#ffffff" : "#fbf2dc";
  const stroke = style === "water" ? "rgba(16,48,80,0.92)" : style === "small" ? "rgba(18,18,24,0.88)" : "rgba(46,32,18,0.92)";
  const meas = document.createElement("canvas").getContext("2d");
  meas.font = font;
  const chars = Array.from(str.length > 60 ? str.slice(0, 59) + "…" : str), widths = chars.map((ch) => meas.measureText(ch).width);
  const tw = widths.reduce((s, x) => s + x, 0) + spacing * Math.max(0, chars.length - 1), pad = FS * 0.3;
  const k = Math.min(1, 2040 / (tw + pad * 2));       // kanvas maks ±2048 px (aman untuk GPU HP)
  const fs = FS * k, w = Math.ceil((tw + pad * 2) * k), h = Math.ceil(fs * 1.45);
  const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
  const g = cv.getContext("2d");
  g.scale(k, k);
  g.font = font; g.textBaseline = "middle"; g.lineJoin = "round";
  g.lineWidth = FS * 0.17; g.strokeStyle = stroke; g.fillStyle = fill;
  ["stroke", "fill"].forEach((mode) => {
    let x = pad;
    chars.forEach((ch, i) => {
      if (mode === "stroke") g.strokeText(ch, x, h / 2 / k); else g.fillText(ch, x, h / 2 / k);
      x += widths[i] + spacing;
    });
  });
  return { tex: spriteTexture(cv, true), w, h, fs, cx: 0.5, cy: 0.5 };
}

// WebGL tidak tersedia: tampilkan pesan, semua method jadi no-op
function fallbackView(container, err) {
  const box = document.createElement("div");
  box.className = "map3d-fallback";
  box.style.cssText = "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:24px;" +
    "text-align:center;color:rgba(255,255,255,0.75);font:500 14px/1.5 system-ui,sans-serif;";
  box.textContent = "Tampilan 3D tidak bisa dibuka di perangkat/browser ini (WebGL tidak tersedia). Gunakan tampilan 2D.";
  const prevPos = container.style.position;
  if (getComputedStyle(container).position === "static") container.style.position = "relative";
  container.appendChild(box);
  if (err) console.warn("Map 3D:", err.message || err);
  const noop = () => {};
  return { setMap: noop, refresh: noop, setLayers: noop, resetCamera: noop, zoomBy: noop, resize: noop, setActive: noop,
    dispose() { box.remove(); container.style.position = prevPos; } };
}
