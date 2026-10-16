// ================= MAP 3D (diorama three.js) =================
// Di-import dinamis oleh map-ui.js (import('./map3d.js')) saat pengguna pertama kali beralih ke tampilan 3D.
// Membangun "slab" peta dari data NovelMapCore: permukaan medan (grid 2 vertex/sel + tekstur 8 px/sel bergaya 2D,
// dipertajam & diberi detail halus di shader saat dekat; tebing batu berlapis menurut tinggi), dinding sisi berlapis tanah,
// air transparan (garis tinta pantai, buih putih, cincin air dangkal), pohon = papan bergambar ilustrasi 2D (map-trees.js,
// InstancedMesh; shader memutar tiap papan menghadap kamera), gunung = bukit batu membulat dari medan, sungai/jalan/wilayah yang menempel medan, label peta (decal menempel medan) & pin
// tempat (Sprite; nama dirapikan agar tidak bertumpuk). Render hanya saat perlu: setelah ±2.5 dtk tanpa interaksi tidak ada
// frame sama sekali (air berhenti beriak) supaya tidak membebani GPU; devicePixelRatio dibatasi MAX_PR.
// Garis pantai & pola bioma memakai rumus yang sama dengan map2d.js supaya tampilan 2D dan 3D cocok.
// Skala dunia: 1 unit = 1 sel (1 km); tinggi darat = terrain.h * 10; dasar laut diperdalam khusus 3D (x SEA_DEEP);
//   muka air y = 0; dasar slab y = -13; peta berpusat di origin (x = cx - N/2, z = cy - N/2).
// Kontrak: createMap3D(container, { onSelect }) -> { setMap, refresh, setLayers, resetCamera, zoomBy, resize, setActive, dispose }
//   + setSelection(sel|null) opsional: menyorot pin tempat terpilih.
// Melukis di 3D (tambahan kontrak): opts { onBeforeChange(), onChange("terrain") } seperti editor 2D, dan
//   setTool("select"|"brush"|"eraser"|"elevation"; lainnya = mode lihat), setBrush({ biome, size }), setElevation({ mode, strength, size }),
//   setFitInsets({ top, bottom }) (px tertutup UI; pose kamera melukis lebih dekat/miring dipaskan di sisa layar).
//   Sapuan memakai NovelMapCore.paintBiome/erase/sculpt persis seperti map2d.js; medan diperbarui bertahap (hanya grid & tekstur
//   di area yang berubah, tiap frame), pohon/gunung/dinding dibangun ulang tiap ±300 ms & saat sapuan selesai.
//   Kamera saat alat lukis aktif: kiri = lukis, kanan = putar, tengah/Shift = geser, scroll = zoom; sentuh: 1 jari lukis, 2 jari putar/zoom.
import * as THREE from "./vendor/three-0.169.0.module.min.js";
import { OrbitControls } from "./vendor/three-0.169.0.OrbitControls.js";

const VSCALE = 10;            // terrain.h daratan -> unit dunia
const SEA_DEEP = 3.6;         // dasar laut diperdalam (≈ -0.4 .. -9.7 unit) agar dinding air setebal referensi
const BASE_Y = -13;           // dasar slab
const SUB = 2;                // vertex medan per sel; indeks vertex = indeks grid noise 2D (sampel tiap 0.5 sel)
const TEX_R = 8;              // piksel tekstur permukaan per sel (sama dengan 2D)
const LAND_T = 0.45;          // kontur pantai pada topeng darat halus — sama dengan map2d.js
const WARP = 0.62 / 127.5;    // distorsi tepi pantai/bioma — sama dengan map2d.js
const BANK = 1.3;             // kemiringan medan di garis air (unit per sel), sama di darat & laut -> pantai tepat di kontur
const DEPTH_K = 7;            // peta air (RG8): R = (1 - y) / DEPTH_K (kedalaman), G = (1 - jarak bertanda) / SHORE_K
const SHORE_K = 9;            //   (sel; laut positif) -> jarak 0 tepat di garis air setelah interpolasi linear
const DCAP = 20;              // jarak pantai (sel) terjauh yang masih berpengaruh (tebing pantai, buih, pasir); lebih jauh = jenuh
const STRATA_TOP = 20;        // batas atas tekstur lapisan tanah (unit dunia)
const STRATA_TILE = 32;       // tekstur lapisan tanah berulang tiap 32 unit
const SNOW_MIN = 14;          // salju di tanah mulai max(14 unit, 78% puncak tertinggi) — gunung biasa tanpa salju
const FOV = 45;
const ELEV = THREE.MathUtils.degToRad(24);        // sudut kamera awal dari horizontal (dilihat dari selatan), layar lebar
const ELEV_TALL = THREE.MathUtils.degToRad(34);   // layar tegak (HP): sedikit lebih dari atas, sisi slab tetap terlihat
const ELEV_EDIT = THREE.MathUtils.degToRad(37), ELEV_EDIT_TALL = THREE.MathUtils.degToRad(46);   // pose melukis: lebih miring & dekat
const FIT_Y = 0.8;            // porsi tinggi layar (NDC) maksimum yang diisi slab saat kamera di-reset
const IDLE_MS = 66;           // sesaat setelah interaksi, air tetap beriak ±15 fps…
const IDLE_STOP = 2500;       // …lalu berhenti total (tidak ada render saat diam -> GPU/baterai hemat, tidak lag)
const MAX_PR = 1.5;           // batas devicePixelRatio kanvas 3D (layar 2x/3x tetap tajam, beban piksel jauh lebih ringan)
const CREAM = "#f7f1e1", INK = "#2b2118", ACCENT = "#d7a86e";
const SERIF = 'Georgia, "Times New Roman", serif';
const SANS = 'Inter, -apple-system, "Segoe UI", sans-serif';
const PAT = { plain: 0, grass: 1, fields: 2, woods: 3, marsh: 4, desert: 5, tundra: 6, cracks: 7, mountain: 8 };
const TAU = Math.PI * 2;
// pin (px CSS): lebar/tinggi tetes, jari-jari kepala, jarak pil nama dari ujung pin
const PIN = { M: 6, W: 24, H: 32, R: 10, GAP: 4, PILL_H: 20, PM: 4 };

const smooth = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lin = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
const rgb8 = (hex) => { const v = parseInt(String(hex).slice(1, 7), 16) || 0; return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };
const toLin = (c) => Math.pow(c / 255, 2.2);
const glsl = (hex) => "vec3(" + lin(hex).map((v) => v.toFixed(4)).join(", ") + ")";

// warna vertex (linear)
const PLAIN = lin("#d8cfb6"), BEACH = lin("#eadcae"), SAND = lin("#d9c99a"), FLOOR_DEEP = lin("#557580"),
  SOIL = lin("#9a8064"), SEA_LINE = lin("#968a7e"), RIVER = "#5d95bf", ROAD = lin("#86633f"), TRAIL = lin("#a5885f");
// warna tekstur permukaan (byte sRGB) — detail sama dengan 2D
const T_SAND = rgb8("#e9dcae"), T_FLOOR = rgb8("#d9c99a"), T_DEEP = rgb8("#557580"), T_HIGH = rgb8("#a39a7e"),
  T_SNOW = rgb8("#f3f5f6"), T_POOL = rgb8("#6a8a82"), T_HEDGE = rgb8("#5f7236"), T_CRACK = rgb8("#83502c"), T_ROCK = rgb8("#877a6c");
// ladang: rona sama urutannya dengan 2D, sedikit lebih cerah/jenuh (ilustrasi referensi)
const FIELD_TONES = ["#e0cb70", "#b7c865", "#9fbc5a", "#d7b061", "#cbda84", "#cc9d5c", "#dfcb78"].map(rgb8);
const T_GRASS_D = rgb8("#a0b35d"), T_POOL_RIM = rgb8("#b2b985");

// ---------- tekstur noise per seed (belang daratan, distorsi tepi, butiran) — sama dengan getFields map2d.js ----------
let fieldCache = null;
function getFields(C, seed, n) {
  if (fieldCache && fieldCache.seed === seed && fieldCache.n === n) return fieldCache;
  fieldCache = null;
  const W = n * TEX_R, G = n * 2 + 2;
  const grid = (fn, lo, hi) => {   // sampel tiap 0.5 sel, diskalakan ke 0..255
    const a = new Float32Array(G * G), k = 255 / (hi - lo);
    for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) { const v = (fn(x / 2, y / 2) - lo) * k; a[y * G + x] = v < 0 ? 0 : v > 255 ? 255 : v; }
    return a;
  };
  const up = (src) => {             // diperbesar bilinear ke resolusi piksel
    const out = new Uint8Array(W * W), f = 2 / TEX_R;
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
  let r = (seed * 2654435761) >>> 0 || 1;
  for (let i = 0; i < W * W; i++) { r ^= r << 13; r ^= r >>> 17; r ^= r << 5; f.grain[i] = (r >>> 0) & 255; }   // xorshift32
  // per vertex medan (statis per seed): gelombang lembut daratan & punggung gunung bergerigi (dipakai ulang tiap pembaruan medan)
  const w = n * SUB + 1;
  f.wave = new Float32Array(w * w); f.ridge = new Float32Array(w * w);
  for (let j = 0; j < w; j++) for (let i = 0; i < w; i++) {
    const X = i / SUB, Y = j / SUB, k = j * w + i;
    f.wave[k] = C.fbm(X / 3.5, Y / 3.5, seed + 61, 3) - 0.5;
    f.ridge[k] = 1 - Math.abs(2 * C.noise2(X / 2.2, Y / 2.2, seed + 71) - 1);
  }
  fieldCache = f;
  return f;
}

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

  // tabel bioma (indeks 0..255; yang tidak dikenal = laut), sama dengan 2D
  const landLUT = new Uint8Array(256), pat = new Uint8Array(256), mtLUT = new Uint8Array(256);
  const cR = new Float32Array(256), cG = new Float32Array(256), cB = new Float32Array(256);
  const aR = new Float32Array(256), aG = new Float32Array(256), aB = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const b = BIOMES[i] || BIOMES[0], c = rgb8(b.color), a = rgb8(b.alt || b.color);
    landLUT[i] = b.land ? 1 : 0; mtLUT[i] = b.mountain ? 1 : 0;
    cR[i] = c[0]; cG[i] = c[1]; cB[i] = c[2]; aR[i] = a[0]; aG[i] = a[1]; aB[i] = a[2];
    pat[i] = b.mountain ? PAT.mountain : b.pattern === "fields" ? PAT.fields : b.pattern === "cracks" ? PAT.cracks
      : ({ grassland: PAT.grass, forest: PAT.woods, pine: PAT.woods, jungle: PAT.woods, marsh: PAT.marsh, desert: PAT.desert, tundra: PAT.tundra })[b.key]
      ?? (b.tree && b.treeDensity > 0.3 ? PAT.woods : PAT.plain);
  }

  // ---------- renderer, scene, kamera, kontrol ----------
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PR));
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;         // medan statis: bayangan dihitung ulang hanya saat data berubah
  renderer.localClippingEnabled = true;          // label decal dipotong di tepi slab
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
  // kuas didaftarkan sebelum OrbitControls: tombol kiri saat alat lukis aktif ditahan di sini (stopImmediatePropagation)
  canvas.addEventListener("pointerdown", onPaintDown);
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
  ["terrain", "trees", "mounts", "rivers", "paths", "zones", "places", "labels"].forEach((k) => { G[k] = new THREE.Group(); root.add(G[k]); });

  // mesh medan/air/dinding (geometri dibangun ulang saat medan berubah)
  const terrainMesh = new THREE.Mesh(new THREE.BufferGeometry(), shared.terrainMat);
  terrainMesh.receiveShadow = true; terrainMesh.castShadow = true;
  const wallMesh = new THREE.Mesh(new THREE.BufferGeometry(), shared.wallMat);
  wallMesh.receiveShadow = true;
  const waterGeo = new THREE.PlaneGeometry(1, 1);
  waterGeo.rotateX(-Math.PI / 2);                // posisi lokal = koordinat dunia (dipakai shader untuk peta kedalaman)
  const waterMesh = new THREE.Mesh(waterGeo, shared.waterMat);
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
  waterMesh.visible = false;
  // label dipotong di tepi slab (dunia: -N/2..N/2)
  const labelClip = [new THREE.Plane(new THREE.Vector3(1, 0, 0), 64), new THREE.Plane(new THREE.Vector3(-1, 0, 0), 64),
    new THREE.Plane(new THREE.Vector3(0, 0, 1), 64), new THREE.Plane(new THREE.Vector3(0, 0, -1), 64)];

  // ---------- state ----------
  let map = null, mapKey = "", size = 128;
  let terrain = null, terrainSig = null, fields = null, landS = null;
  let VW = 0, Hc = null, SD = null, SL = null;     // grid vertex: tinggi dunia, jarak bertanda ke pantai (sel, + = darat), kemiringan
  let vS = null, vD = null, vDw = null;            // per vertex: darat?, jarak ke pantai (maks DCAP), larik kerja chamfer
  let surfTex = null, surfData = null, depthTex = null, depthData = null, dwTex = null, dwData = null;
  let colTex = null, colPlain = null, maxTop = 2, snowLine = SNOW_MIN;
  let layers = { terrain: true, rivers: true, paths: true, places: true, zones: true, labels: true };
  let active = true, disposed = false, raf = 0, needsRender = true, lastRender = 0, layoutDirty = true;
  let width = 0, height = 0, fitted = false, tween = null;
  let selPlace = null, prioPlace = null;           // pin tersorot (setSelection) & prioritas nama (klik terakhir)
  let pins = [];                                   // { id, icon, pin, name, pos, pillW, side }
  const spriteCache = new Map();                   // key teks/ikon -> { tex, w, h, ..., used }
  // kuas 3D
  const PAINT = { brush: 1, eraser: 1, elevation: 1 };
  let tool = "select";
  const brush = { biome: 1, size: 4 }, elev = { mode: "raise", strength: 0.5, size: 4 };
  let stroke = null;                               // { id, cell, cur, began, lastDab, H } (H = salinan tinggi saat sapuan mulai)
  let touchWait = null, touchBusy = false;         // sentuhan pertama menunggu jari kedua; sisa gestur 2 jari diabaikan
  const touchIds = new Set();
  let hoverXY = null, orbiting = false, cursorDirty = false;
  let dataDirty = false, lastSync = 0, syncCost = 8, decorDirty = false, lastDecor = 0, topLive = 0, wallDirty = false;

  // ================= MEDAN =================
  // bilinear nilai per sel (pusat sel = x+0.5)
  function bil(a, u, v) {
    const n = size, nm = n - 1;
    let fx = u - 0.5, fy = v - 0.5;
    fx = fx < 0 ? 0 : fx > nm ? nm : fx; fy = fy < 0 ? 0 : fy > nm ? nm : fy;
    const x0 = fx | 0, y0 = fy | 0, x1 = x0 < nm ? x0 + 1 : x0, y1 = y0 < nm ? y0 + 1 : y0, tx = fx - x0, ty = fy - y0;
    const r0 = y0 * n, r1 = y1 * n;
    const a0 = a[r0 + x0] + (a[r0 + x1] - a[r0 + x0]) * tx, a1 = a[r1 + x0] + (a[r1 + x1] - a[r1 + x0]) * tx;
    return a0 + (a1 - a0) * ty;
  }
  // topeng darat dihaluskan [1 2 1]/4 per sumbu (sama dengan 2D) -> kontur LAND_T = garis pantai
  function smoothLand(t) {
    const n = t.size, nm = n - 1, L = t.land, out = new Float32Array(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      let s = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const row = clamp(y + dy, 0, nm) * n, ky = dy ? 0.25 : 0.5;
        for (let dx = -1; dx <= 1; dx++) s += (dx ? 0.25 : 0.5) * ky * L[row + clamp(x + dx, 0, nm)];
      }
      out[y * n + x] = s;
    }
    return out;
  }
  // nilai darat halus di titik ber-distorsi (sama dengan garis pantai 2D); >= LAND_T = darat
  function landAtWarped(x, y) {
    const W = size * TEX_R, i = clamp((y * TEX_R) | 0, 0, W - 1) * W + clamp((x * TEX_R) | 0, 0, W - 1);
    return bil(landS, x + (fields.warpX[i] - 127.5) * WARP, y + (fields.warpY[i] - 127.5) * WARP);
  }
  // tinggi dunia di titik sel (bilinear grid vertex); sampleArr = sama untuk larik tinggi lain (salinan saat sapuan mulai)
  function sampleArr(A, px, py) {
    const w = VW, m = w - 1, gx = clamp(px * SUB, 0, m), gy = clamp(py * SUB, 0, m);
    const i0 = Math.min(m - 1, gx | 0), j0 = Math.min(m - 1, gy | 0), fx = gx - i0, fy = gy - j0, k = j0 * w + i0;
    const a = A[k], b = A[k + 1], c = A[k + w], d = A[k + w + 1];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }
  function sampleH(px, py) { return sampleArr(Hc, px, py); }
  function sampleHMax(px, py) {
    return Math.max(sampleH(px, py), sampleH(px - 0.3, py - 0.3), sampleH(px + 0.3, py - 0.3), sampleH(px - 0.3, py + 0.3), sampleH(px + 0.3, py + 0.3));
  }

  // ---------- kotak (inklusif) {x0,y0,x1,y1} untuk pembaruan sebagian: sel, vertex grid (x SUB) & piksel tekstur (x TEX_R) ----------
  const rU = (a, b) => (!a ? b : !b ? a : { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) });
  const rG = (r, k, max) => r && { x0: Math.max(0, r.x0 - k), y0: Math.max(0, r.y0 - k), x1: Math.min(max, r.x1 + k), y1: Math.min(max, r.y1 + k) };
  // sel -> vertex yang memakainya (bilinear pusat sel), margin m sel
  const vr = (c, m) => c && { x0: Math.max(0, 2 * (c.x0 - m)), y0: Math.max(0, 2 * (c.y0 - m)), x1: Math.min(VW - 1, 2 * (c.x1 + 1 + m)), y1: Math.min(VW - 1, 2 * (c.y1 + 1 + m)) };
  // vertex -> piksel di sekitarnya; sel -> piksel (margin m sel: distorsi tepi + bilinear)
  const vpx = (v) => v && { x0: Math.max(0, v.x0 * 4 - 4), y0: Math.max(0, v.y0 * 4 - 4), x1: Math.min(size * TEX_R - 1, v.x1 * 4 + 4), y1: Math.min(size * TEX_R - 1, v.y1 * 4 + 4) };
  const cpx = (c, m) => c && { x0: Math.max(0, (c.x0 - m) * TEX_R), y0: Math.max(0, (c.y0 - m) * TEX_R), x1: Math.min(size * TEX_R - 1, (c.x1 + 1 + m) * TEX_R - 1), y1: Math.min(size * TEX_R - 1, (c.y1 + 1 + m) * TEX_R - 1) };
  // kotak sel yang nilainya berbeda (null = sama)
  function diffRect(a, b) {
    const n = size;
    let x0 = n, y0 = n, x1 = -1, y1 = -1;
    for (let y = 0, i = 0; y < n; y++) for (let x = 0; x < n; x++, i++) {
      if (a[i] !== b[i]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    return x1 < 0 ? null : { x0, y0, x1, y1 };
  }

  // ---------- grid vertex medan (dihitung per kotak; bangun penuh = kotak seluruh grid) ----------
  // tinggi vertex: darat = terrain.h (+ gelombang lembut, punggung gunung bergerigi), laut = diperdalam;
  // di dekat pantai tinggi = BANK x jarak bertanda ke kontur 2D, jadi garis air jatuh tepat di garis pantai 2D
  function allocHeights() {
    const w = size * SUB + 1, len = w * w;
    VW = w; Hc = new Float32Array(len); SD = new Float32Array(len); SL = new Float32Array(len);
    vS = new Uint8Array(len); vD = new Float32Array(len); vDw = new Float32Array(len);
    colTex = new Float32Array(len * 3); colPlain = new Float32Array(len * 3);
  }
  // jarak ke garis pantai: benih = vertex dekat kontur (jarak dari gradien topeng darat halus), lalu chamfer 2 lintasan
  // (langkah 0.5 sel) di kotak W. Hasil (maks DCAP) hanya disalin ke kotak inti Cr: W = Cr + DCAP sel, jadi nilai ≤ DCAP
  // di Cr sama persis dengan hitungan seluruh grid (lebih jauh dari itu memang jenuh)
  function coastDist(W, Cr) {
    const n = size, nm = n - 1, w = VW, Gn = fields.G, wxG = fields.wxG, wyG = fields.wyG, LS = landS, D = vDw;
    for (let j = W.y0; j <= W.y1; j++) for (let i = W.x0; i <= W.x1; i++) {
      const k = j * w + i, g = j * Gn + i;
      const fx = clamp(i / SUB + (wxG[g] - 127.5) * WARP - 0.5, 0, nm), fy = clamp(j / SUB + (wyG[g] - 127.5) * WARP - 0.5, 0, nm);
      const x0 = fx | 0, y0 = fy | 0, x1 = x0 < nm ? x0 + 1 : x0, y1 = y0 < nm ? y0 + 1 : y0, tx = fx - x0, ty = fy - y0;
      const s00 = LS[y0 * n + x0], s10 = LS[y0 * n + x1], s01 = LS[y1 * n + x0], s11 = LS[y1 * n + x1];
      const L = s00 * (1 - tx) * (1 - ty) + s10 * tx * (1 - ty) + s01 * (1 - tx) * ty + s11 * tx * ty;
      const gx = (s10 - s00) * (1 - ty) + (s11 - s01) * ty, gy = (s01 - s00) * (1 - tx) + (s11 - s10) * tx;
      const d0 = Math.abs(L - LAND_T) / Math.max(0.2, Math.sqrt(gx * gx + gy * gy));
      vS[k] = L >= LAND_T ? 1 : 0;
      D[k] = d0 < 0.8 ? d0 : 1e9;
    }
    const st = 1 / SUB, dg = st * Math.SQRT2, { x0, y0, x1, y1 } = W;
    for (let j = y0; j <= y1; j++) for (let i = x0; i <= x1; i++) {
      const k = j * w + i;
      let d = D[k];
      if (i > x0 && D[k - 1] + st < d) d = D[k - 1] + st;
      if (j > y0) {
        if (D[k - w] + st < d) d = D[k - w] + st;
        if (i > x0 && D[k - w - 1] + dg < d) d = D[k - w - 1] + dg;
        if (i < x1 && D[k - w + 1] + dg < d) d = D[k - w + 1] + dg;
      }
      D[k] = d;
    }
    for (let j = y1; j >= y0; j--) for (let i = x1; i >= x0; i--) {
      const k = j * w + i;
      let d = D[k];
      if (i < x1 && D[k + 1] + st < d) d = D[k + 1] + st;
      if (j < y1) {
        if (D[k + w] + st < d) d = D[k + w] + st;
        if (i < x1 && D[k + w + 1] + dg < d) d = D[k + w + 1] + dg;
        if (i > x0 && D[k + w - 1] + dg < d) d = D[k + w - 1] + dg;
      }
      D[k] = d;
    }
    for (let j = Cr.y0; j <= Cr.y1; j++) for (let i = Cr.x0; i <= Cr.x1; i++) { const k = j * w + i; vD[k] = Math.min(D[k], DCAP); }
  }
  // tinggi & jarak bertanda vertex di kotak V -> { dh: kotak yang tingginya berubah, ds: kotak yang jarak pantai efektifnya berubah }
  function heightsRect(V) {
    const n = size, nm = n - 1, w = VW, t = terrain, h = t.h, land = t.land, shore = t.shore, bio = map.biome;
    const wave = fields.wave, ridge = fields.ridge;
    let hx0 = w, hy0 = w, hx1 = -1, hy1 = -1, sx0 = w, sy0 = w, sx1 = -1, sy1 = -1;
    for (let j = V.y0; j <= V.y1; j++) for (let i = V.x0; i <= V.x1; i++) {
      const k = j * w + i, X = i / SUB, Y = j / SUB;
      // rata-rata sel darat & sel laut di sekitar vertex (bobot bilinear pusat sel, tanpa distorsi)
      const fx = clamp(X - 0.5, 0, nm), fy = clamp(Y - 0.5, 0, nm);
      const x0 = fx | 0, y0 = fy | 0, x1 = x0 < nm ? x0 + 1 : x0, y1 = y0 < nm ? y0 + 1 : y0, tx = fx - x0, ty = fy - y0;
      const a0 = y0 * n + x0, a1 = y0 * n + x1, a2 = y1 * n + x0, a3 = y1 * n + x1;
      const w0 = (1 - tx) * (1 - ty), w1 = tx * (1 - ty), w2 = (1 - tx) * ty, w3 = tx * ty;
      const l0 = land[a0] * w0, l1 = land[a1] * w1, l2 = land[a2] * w2, l3 = land[a3] * w3, wl = l0 + l1 + l2 + l3, ws = 1 - wl;
      const sumH = h[a0] * w0 + h[a1] * w1 + h[a2] * w2 + h[a3] * w3, sumL = h[a0] * l0 + h[a1] * l1 + h[a2] * l2 + h[a3] * l3;
      const dist = vD[k];
      let H, S;
      if (vS[k]) {
        const HL = wl > 1e-6 ? sumL / wl : 0.05;                                      // rata-rata sel darat saja
        const SH = shore[a0] * w0 + shore[a1] * w1 + shore[a2] * w2 + shore[a3] * w3;
        const MT = mtLUT[bio[a0]] * w0 + mtLUT[bio[a1]] * w1 + mtLUT[bio[a2]] * w2 + mtLUT[bio[a3]] * w3;
        let v = HL + smooth(0.3, 1, SH) * wave[k] * 0.09;   // gelombang lembut
        if (MT > 0) v += MT * ridge[k] * 0.05;   // tekstur batu tipis saja (gunung membulat, tidak bergerigi)
        v *= VSCALE;
        const bank = BANK * dist;
        H = Math.max(Math.min(v, bank), Math.min(bank, 0.08));
        S = dist;
      } else {
        // paparan dangkal di dekat pantai lalu makin dalam; jauh dari darat ikut dasar laut computeTerrain (x SEA_DEEP)
        const HS = ws > 1e-6 ? (sumH - sumL) / ws : -0.03;                            // rata-rata sel laut saja
        H = Math.max(HS * VSCALE * SEA_DEEP, -(BANK * dist + 0.9 * dist * dist));
        S = -dist;
      }
      // larik Float32: bandingkan setelah dibulatkan ke float32
      H = Math.fround(H); S = Math.fround(S);
      if (H !== Hc[k]) { if (i < hx0) hx0 = i; if (i > hx1) hx1 = i; if (j < hy0) hy0 = j; if (j > hy1) hy1 = j; }
      // jarak pantai hanya dipakai dalam -9..2 sel (buih/air dangkal, pasir, batu tebing); di luar itu jenuh
      if (clamp(S, -9, 2) !== clamp(SD[k], -9, 2)) { if (i < sx0) sx0 = i; if (i > sx1) sx1 = i; if (j < sy0) sy0 = j; if (j > sy1) sy1 = j; }
      Hc[k] = H; SD[k] = S;
    }
    return { dh: hx1 < 0 ? null : { x0: hx0, y0: hy0, x1: hx1, y1: hy1 }, ds: sx1 < 0 ? null : { x0: sx0, y0: sy0, x1: sx1, y1: sy1 } };
  }
  // kemiringan (unit per sel), oklusi sederhana & warna vertex di kotak E -> kotak yang kemiringannya berubah
  function slopeColRect(E) {
    const w = VW, H = Hc;
    let x0 = w, y0 = w, x1 = -1, y1 = -1;
    for (let j = E.y0; j <= E.y1; j++) for (let i = E.x0; i <= E.x1; i++) {
      const k = j * w + i, hw = H[k];
      const hl = H[j * w + Math.max(0, i - 1)], hr = H[j * w + Math.min(w - 1, i + 1)];
      const hu = H[Math.max(0, j - 1) * w + i], hd = H[Math.min(w - 1, j + 1) * w + i];
      const sl = Math.fround(Math.hypot(hr - hl, hd - hu) * SUB * 0.5);
      if (sl !== SL[k]) { SL[k] = sl; if (i < x0) x0 = i; if (i > x1) x1 = i; if (j < y0) y0 = j; if (j > y1) y1 = j; }
      let r, g, b, ao = 1;
      if (hw < 0) {
        const tt = smooth(0.3, 4.5, -hw);   // dasar laut (layer daratan mati): pasir -> biru gelap
        r = SAND[0] + (FLOOR_DEEP[0] - SAND[0]) * tt; g = SAND[1] + (FLOOR_DEEP[1] - SAND[1]) * tt; b = SAND[2] + (FLOOR_DEEP[2] - SAND[2]) * tt;
      } else {
        const c1 = H[j * w + Math.max(0, i - SUB)] + H[j * w + Math.min(w - 1, i + SUB)] + H[Math.max(0, j - SUB) * w + i] + H[Math.min(w - 1, j + SUB) * w + i];
        ao = clamp(1 - (c1 * 0.25 - hw) * 0.12, 0.84, 1.06);   // lembah sedikit gelap, punggung sedikit terang
        const beach = smooth(0.4, 0.05, SD[k]) * 0.6;
        r = (PLAIN[0] + (BEACH[0] - PLAIN[0]) * beach) * ao; g = (PLAIN[1] + (BEACH[1] - PLAIN[1]) * beach) * ao; b = (PLAIN[2] + (BEACH[2] - PLAIN[2]) * beach) * ao;
      }
      colTex[k * 3] = colTex[k * 3 + 1] = colTex[k * 3 + 2] = ao;
      colPlain[k * 3] = r; colPlain[k * 3 + 1] = g; colPlain[k * 3 + 2] = b;
    }
    return x1 < 0 ? null : { x0, y0, x1, y1 };
  }
  function buildHeights() {
    allocHeights();
    const all = { x0: 0, y0: 0, x1: VW - 1, y1: VW - 1 };
    coastDist(all, all);
    heightsRect(all);
    maxTop = 0;
    for (let k = 0; k < Hc.length; k++) if (Hc[k] > maxTop) maxTop = Hc[k];
    snowLine = Math.max(SNOW_MIN, maxTop * 0.78);
    topLive = maxTop;
    slopeColRect(all);
  }

  // ---------- tekstur permukaan per piksel (pola sama dengan 2D, tanpa bayangan bukit karena 3D punya cahaya) ----------
  let LR = 0, LG = 0, LB = 0, FR = 0, FG = 0, FB = 0;   // keluaran landColor / floorColor
  let fieldAng = { c: 1, s: 0 };
  let wCell = 0;                   // hash sel Voronoi terdekat dari worleyEdge terakhir (rona per pelat tanah retak)
  function worleyEdge(x, y, s) {   // jarak tepi sel Voronoi (F2 - F1) untuk retakan tanah
    const xi = Math.floor(x), yi = Math.floor(y);
    let f1 = 9, f2 = 9, bx = 0, by = 0;
    for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) {
      const gx = xi + k, gy = yi + j;
      const dx = gx + hash2(gx, gy, s) - x, dy = gy + hash2(gx, gy, s + 1) - y, dd = dx * dx + dy * dy;
      if (dd < f1) { f2 = f1; f1 = dd; bx = gx; by = gy; } else if (dd < f2) f2 = dd;
    }
    wCell = hash2(bx, by, s + 7);
    return Math.sqrt(f2) - Math.sqrt(f1);
  }
  // edge = jarak ke pantai (sel), hT = terrain.h, hw/sl/sd = tinggi dunia, kemiringan, jarak bertanda grid 3D
  let pSeed = 0, pWarp = null;   // diisi paintSurface (hindari lookup properti per piksel)
  function landColor(bi, i, wu, wv, gr, m, edge, hT, hw, sl, sd) {
    let t = (m - 0.5) * 2.2 + 0.5; t = t < 0 ? 0 : t > 1 ? 1 : t;
    let r = cR[bi] + (aR[bi] - cR[bi]) * t, g = cG[bi] + (aG[bi] - cG[bi]) * t, b = cB[bi] + (aB[bi] - cB[bi]) * t;
    const p = pat[bi], seed = pSeed;
    let k, f;
    switch (p) {
      case PAT.grass:            // bercak hijau lebih tua + bintik rumput halus
        f = noise2(wu * 0.42, wv * 0.42, seed + 201);
        if (f > 0.55) { f = Math.min(1, (f - 0.55) * 3) * 0.45; r += (T_GRASS_D[0] - r) * f; g += (T_GRASS_D[1] - g) * f; b += (T_GRASS_D[2] - b) * f; }
        break;
      case PAT.fields: {         // ladang petak-petak (letak sama dengan 2D) + pematang tegas + alur bajak
        const fu = (wu * fieldAng.c - wv * fieldAng.s) / 3.4, fv = (wu * fieldAng.s + wv * fieldAng.c) / 2.4;   // petak ladang besar
        const row = Math.floor(fv), fu2 = fu + hash2(row, 7, seed) * 3.7, col = Math.floor(fu2);
        const fid = hash2(col, row, seed + 5), ex = fu2 - col, ey = fv - row;
        const tone = FIELD_TONES[(fid * FIELD_TONES.length) | 0];
        k = 0.97 + (m - 0.5) * 0.12;
        r = tone[0] * k; g = tone[1] * k; b = tone[2] * k;
        k = 1 + Math.sin((fid > 0.5 ? ex * 3.4 : ey * 2.4) * TAU * 1.6) * 0.04;
        r *= k; g *= k; b *= k;
        const e = Math.min(Math.min(ex, 1 - ex) * 3.4, Math.min(ey, 1 - ey) * 2.4);
        f = (1 - smooth(0.06, 0.13, e)) * 0.85;
        if (f > 0) { r += (T_HEDGE[0] - r) * f; g += (T_HEDGE[1] - g) * f; b += (T_HEDGE[2] - b) * f; }
        break;
      }
      case PAT.woods:            // lantai hutan: belang gelap
        k = 0.8 + noise2(wu * 1.9, wv * 1.9, seed + 61) * 0.24;
        r *= k; g *= k; b *= k;
        break;
      case PAT.marsh: {          // genangan bertepi terang + bintik (rumpun 3D di atasnya)
        f = 1 - smooth(0.32, 0.42, m);
        if (f > 0) { f *= 0.8; r += (T_POOL[0] - r) * f; g += (T_POOL[1] - g) * f; b += (T_POOL[2] - b) * f; }
        else if (m < 0.47) { f = (1 - smooth(0.42, 0.47, m)) * 0.3; r += (T_POOL_RIM[0] - r) * f; g += (T_POOL_RIM[1] - g) * f; b += (T_POOL_RIM[2] - b) * f; }
        if (gr > 0.9) { r *= 0.9; g *= 0.93; b *= 0.9; }
        break;
      }
      case PAT.desert: {         // bukit pasir bergaris, punggung bukit terang
        const dv = (wu * 0.75 + wv * 0.32) * 3.4 + m * 2.4, sn = Math.sin(dv);
        k = 1 + sn * 0.055 + (sn > 0.8 ? (sn - 0.8) * 0.35 : 0);
        r *= k; g *= k; b *= k;
        if (gr > 0.955) { r *= 0.9; g *= 0.87; b *= 0.82; }
        break;
      }
      case PAT.tundra:           // putih keabuan berawan + petak salju + batu kecil
        k = 0.95 + noise2(wu * 0.55, wv * 0.55, seed + 211) * 0.08;
        r *= k; g *= k; b *= k * 1.01;
        f = smooth(0.6, 0.72, m) * 0.6;
        if (f > 0) { r += (T_SNOW[0] - r) * f; g += (T_SNOW[1] - g) * f; b += (T_SNOW[2] - b) * f; }
        if (gr > 0.955) { r *= 0.84; g *= 0.85; b *= 0.86; }
        break;
      case PAT.cracks: {         // pelat besar bergaris retak tegas + retakan halus (sama dengan 2D), rona per pelat
        const e = worleyEdge(wu * 0.44, wv * 0.44, seed + 87);
        k = 0.94 + wCell * 0.1 + smooth(0, 0.35, e) * 0.05;
        r *= k; g *= k; b *= k;
        f = (1 - smooth(0.03, 0.075, e)) * 0.82;
        const e2 = worleyEdge(wu * 0.9, wv * 0.9, seed + 83);
        f = Math.max(f, (1 - smooth(0.045, 0.12, e2)) * 0.34);
        if (f > 0) { r += (T_CRACK[0] - r) * f; g += (T_CRACK[1] - g) * f; b += (T_CRACK[2] - b) * f; }
        break;
      }
      case PAT.mountain: {       // bukit batu abu-abu: makin tinggi makin terang
        k = clamp01((hT - 0.2) / 0.75) * 0.75 + t * 0.25;
        r = cR[bi] + (aR[bi] - cR[bi]) * k; g = cG[bi] + (aG[bi] - cG[bi]) * k; b = cB[bi] + (aB[bi] - cB[bi]) * k;   // batu abu-abu netral
        // bukit batu ala ilustrasi (sama dengan 2D): tepi tegas + guratan bongkah batu samar
        const e = worleyEdge(wu * 0.35, wv * 0.35, seed + 87);
        k = 0.96 + wCell * 0.09 - (1 - smooth(0.02, 0.09, e)) * 0.08;
        r *= k; g *= k; b *= k;
        if (gr > 0.95) { r *= 0.95; g *= 0.95; b *= 0.95; }
        break;
      }
    }
    if (p !== PAT.mountain && hT > 0.45) { f = clamp01((hT - 0.45) / 0.45) * 0.38; r += (T_HIGH[0] - r) * f; g += (T_HIGH[1] - g) * f; b += (T_HIGH[2] - b) * f; }
    // tebing curam jadi batu (bukan tepi pantai)
    f = sl > 0.6 && p !== PAT.mountain ? smooth(0.6, 1.4, sl) * 0.8 * smooth(0.8, 1.6, sd) : 0;
    if (f > 0) { r += (T_ROCK[0] - r) * f; g += (T_ROCK[1] - g) * f; b += (T_ROCK[2] - b) * f; }
    // salju hanya di bagian puncak (relatif ke puncak tertinggi), tepinya berpetak
    f = hw < snowLine - 1.9 ? 0 : smooth(snowLine - 0.35, snowLine + 0.5, hw + (m - 0.5) * 2.4 + (pWarp[i] - 127.5) * 0.006) * (1 - smooth(2.6, 4, sl) * 0.5);
    if (f > 0) { r += (T_SNOW[0] - r) * f; g += (T_SNOW[1] - g) * f; b += (T_SNOW[2] - b) * f; }
    // pantai: pasir tipis + garis gelap halus tepat di tepi
    if (edge < 0.3 && p !== PAT.tundra && p !== PAT.mountain) {
      f = (1 - edge / 0.3) * 0.5; r += (T_SAND[0] - r) * f; g += (T_SAND[1] - g) * f; b += (T_SAND[2] - b) * f;
    }
    if (edge < 0.06) { k = 0.86 + edge * 2.3; r *= k; g *= k; b *= k; }
    k = 0.965 + gr * 0.07;
    LR = r * k; LG = g * k; LB = b * k;
  }
  function floorColor(d, gr) {      // dasar laut: pasir di pantai, makin dalam makin gelap kebiruan
    const t = smooth(0.25, 4.5, d), k = 0.97 + gr * 0.06;
    FR = (T_FLOOR[0] + (T_DEEP[0] - T_FLOOR[0]) * t) * k; FG = (T_FLOOR[1] + (T_DEEP[1] - T_FLOOR[1]) * t) * k; FB = (T_FLOOR[2] + (T_DEEP[2] - T_FLOOR[2]) * t) * k;
  }
  // bioma piksel darat: bobot bilinear terbesar di antara sudut darat (sama dengan 2D); pb2/pbd untuk anti-alias batas
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
    const n = size, nm = n - 1, cx = tx < 0.5 ? x0 : x1, cy = ty < 0.5 ? y0 : y1, bio = map.biome;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const b = bio[clamp(cy + dy, 0, nm) * n + clamp(cx + dx, 0, nm)];
      if (landLUT[b]) return b;
    }
    return 1;
  }
  // P = kotak piksel (inklusif) yang dilukis ulang
  function paintSurface(t, P) {
    const n = size, nm = n - 1, W = n * TEX_R, inv = 1 / TEX_R, w = VW, m1 = w - 1;
    const wX = fields.warpX, wY = fields.warpY, GR = fields.grain, MO = fields.mottle, bio = map.biome, LS = landS, TH = t.h;
    const H = Hc, SLp = SL, SDp = SD, out = surfData;
    const a = (hash2(map.seed, 3, 17) - 0.5) * 0.7;
    fieldAng = { c: Math.cos(a), s: Math.sin(a) };
    pSeed = map.seed; pWarp = wX;
    for (let py = P.y0; py <= P.y1; py++) {
      const v = (py + 0.5) * inv, gv = v * SUB, j0 = Math.min(m1 - 1, gv | 0), fyv = gv - j0;
      for (let px = P.x0, o = (py * W + px) * 4; px <= P.x1; px++, o += 4) {
        const i = py * W + px, u = (px + 0.5) * inv;
        // tinggi/kemiringan/jarak pantai 3D (bilinear grid vertex)
        const gu = u * SUB, i0 = Math.min(m1 - 1, gu | 0), fxv = gu - i0, vk = j0 * w + i0;
        const e00 = (1 - fxv) * (1 - fyv), e10 = fxv * (1 - fyv), e01 = (1 - fxv) * fyv, e11 = fxv * fyv;
        const hw = H[vk] * e00 + H[vk + 1] * e10 + H[vk + w] * e01 + H[vk + w + 1] * e11;
        const gr = GR[i] * (1 / 255);
        // topeng darat pada titik terdistorsi (sama dengan 2D)
        const wu = u + (wX[i] - 127.5) * WARP, wv = v + (wY[i] - 127.5) * WARP;
        let fx = wu - 0.5, fy = wv - 0.5;
        fx = fx < 0 ? 0 : fx > nm ? nm : fx; fy = fy < 0 ? 0 : fy > nm ? nm : fy;
        const x0 = fx | 0, y0 = fy | 0, x1 = x0 < nm ? x0 + 1 : x0, y1 = y0 < nm ? y0 + 1 : y0, tx = fx - x0, ty = fy - y0;
        const q00 = y0 * n + x0, q10 = y0 * n + x1, q01 = y1 * n + x0, q11 = y1 * n + x1;
        const s00 = LS[q00], s10 = LS[q10], s01 = LS[q01], s11 = LS[q11];
        let r, g, b;
        if (s00 === 0 && s10 === 0 && s01 === 0 && s11 === 0) {
          floorColor(-hw, gr); r = FR; g = FG; b = FB;
        } else {
          const k00 = (1 - tx) * (1 - ty), k10 = tx * (1 - ty), k01 = (1 - tx) * ty, k11 = tx * ty;
          const b00 = bio[q00], b10 = bio[q10], b01 = bio[q01], b11 = bio[q11];
          const uni = b00 === b10 && b00 === b01 && b00 === b11 && landLUT[b00];
          const bi = uni ? b00 : pickBiome(b00, b10, b01, b11, k00, k10, k01, k11, x0, y0, x1, y1, tx, ty);
          const hT = TH[q00] * k00 + TH[q10] * k10 + TH[q01] * k01 + TH[q11] * k11, m = MO[i] * (1 / 255);
          const sl = SLp[vk] * e00 + SLp[vk + 1] * e10 + SLp[vk + w] * e01 + SLp[vk + w + 1] * e11;
          const sd = SDp[vk] * e00 + SDp[vk + 1] * e10 + SDp[vk + w] * e01 + SDp[vk + w + 1] * e11;
          if (s00 === 1 && s10 === 1 && s01 === 1 && s11 === 1) {
            landColor(bi, i, wu, wv, gr, m, 1, hT, hw, sl, sd); r = LR; g = LG; b = LB;
            if (!uni && pb2 >= 0 && pbd < 0.14) {   // anti-alias batas antar bioma
              const tt = 0.5 + pbd / 0.28;
              landColor(pb2, i, wu, wv, gr, m, 1, hT, hw, sl, sd);
              r = r * tt + LR * (1 - tt); g = g * tt + LG * (1 - tt); b = b * tt + LB * (1 - tt);
            }
          } else {
            // tepi pantai: jarak bertanda ke kontur (sel) -> anti-alias darat/dasar laut
            const L = s00 * k00 + s10 * k10 + s01 * k01 + s11 * k11;
            const gx = (s10 - s00) * (1 - ty) + (s11 - s01) * ty, gy = (s01 - s00) * (1 - tx) + (s11 - s10) * tx;
            const d = (L - LAND_T) / Math.max(0.2, Math.sqrt(gx * gx + gy * gy));
            const al = clamp01(0.5 + d * TEX_R);
            r = g = b = 0;
            if (al > 0) { landColor(bi, i, wu, wv, gr, m, d < 0 ? 0 : d, hT, hw, sl, sd); r = LR * al; g = LG * al; b = LB * al; }
            if (al < 1) { floorColor(Math.max(0, -hw), gr); r += FR * (1 - al); g += FG * (1 - al); b += FB * (1 - al); }
          }
        }
        out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = 255;
      }
    }
  }

  // bobot detail per pola bioma: [rumput, pasir, batu, salju]
  const DW_PAT = [[0.6, 0, 0, 0], [1, 0, 0, 0], [0.5, 0, 0.05, 0], [0.8, 0, 0, 0], [0.7, 0, 0, 0], [0, 1, 0, 0], [0, 0, 0.15, 0.9],
    [0, 0.3, 0.5, 0], [0.25, 0, 0.08, 0]];   // gunung: batu mulus (hampir tanpa pita lapisan tebing)
  function detailWeights(R) {
    const n = size, w = VW, bio = map.biome, out = dwData;
    for (let j = R.y0; j <= R.y1; j++) for (let i = R.x0; i <= R.x1; i++) {
      const k = j * w + i, o = k * 4, hw = Hc[k];
      let R = 0, Gs = 0.5, B = 0, A = 0;
      if (hw >= 0) {
        const q = DW_PAT[pat[bio[Math.min(n - 1, (j / SUB) | 0) * n + Math.min(n - 1, (i / SUB) | 0)]]] || DW_PAT[0];
        R = q[0]; Gs = q[1]; B = q[2]; A = q[3];
        const beach = smooth(0.45, 0.1, SD[k]), steep = smooth(0.7, 1.4, SL[k]), snow = smooth(snowLine - 1, snowLine, hw);
        R *= 1 - beach; Gs = Math.max(Gs, beach * 0.7);
        if (q !== DW_PAT[PAT.mountain]) B = Math.max(B * (1 - steep * 0.5), steep * 0.35);   // lereng curam: tekstur meregang (bukan gunung)
        if (snow > 0) { R *= 1 - snow; Gs *= 1 - snow; B *= 1 - snow * 0.7; A = Math.max(A, snow); }
      }
      out[o] = R * 255; out[o + 1] = Gs * 255; out[o + 2] = B * 255; out[o + 3] = A * 255;
    }
  }

  function depthFill(R) {
    const w = VW;
    for (let j = R.y0; j <= R.y1; j++) for (let i = R.x0, k = j * w + i; i <= R.x1; i++, k++) {
      depthData[k * 2] = clamp01((1 - Hc[k]) / DEPTH_K) * 255;
      depthData[k * 2 + 1] = clamp01((1 - SD[k]) / SHORE_K) * 255;
    }
  }
  // diagonal tiap kotak grid dipilih mengikuti beda tinggi terkecil -> garis air lebih halus (kotak q = kotak grid x0..x1, y0..y1)
  function fillIndex(idx, q) {
    const w = VW, m = w - 1;
    for (let y = q.y0; y <= q.y1; y++) for (let x = q.x0, p = (y * m + x) * 6; x <= q.x1; x++) {
      const a = y * w + x, b = a + 1, c = a + w, d = c + 1;
      if (Math.abs(Hc[a] - Hc[d]) <= Math.abs(Hc[b] - Hc[c])) { idx[p++] = a; idx[p++] = c; idx[p++] = d; idx[p++] = a; idx[p++] = d; idx[p++] = b; }
      else { idx[p++] = a; idx[p++] = c; idx[p++] = b; idx[p++] = b; idx[p++] = c; idx[p++] = d; }
    }
  }

  // geometri medan + tekstur permukaan + peta kedalaman air
  function buildGround() {
    const n = size, w = VW, m = w - 1, half = n / 2, W = n * TEX_R;
    const pos = new Float32Array(w * w * 3), uv = new Float32Array(w * w * 2);
    for (let j = 0; j < w; j++) for (let i = 0; i < w; i++) {
      const k = j * w + i;
      pos[k * 3] = i / SUB - half; pos[k * 3 + 1] = Hc[k]; pos[k * 3 + 2] = j / SUB - half;
      uv[k * 2] = i / m; uv[k * 2 + 1] = j / m;    // DataTexture: baris 0 = utara (v = 0)
    }
    const idx = new Uint32Array(m * m * 6);
    fillIndex(idx, { x0: 0, y0: 0, x1: m - 1, y1: m - 1 });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(layers.terrain ? colTex : colPlain), 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    swapGeometry(terrainMesh, geo);
    // tekstur permukaan (dipakai ulang selama ukuran sama)
    if (!surfTex || surfTex.image.width !== W) {
      if (surfTex) surfTex.dispose();
      surfData = new Uint8ClampedArray(W * W * 4);   // Clamped: piksel bukit pasir yang terlalu terang tidak "melingkar" jadi bintik cyan
      surfTex = new THREE.DataTexture(surfData, W, W, THREE.RGBAFormat, THREE.UnsignedByteType);
      surfTex.colorSpace = THREE.SRGBColorSpace;
      surfTex.magFilter = THREE.LinearFilter; surfTex.minFilter = THREE.LinearMipmapLinearFilter;
      surfTex.generateMipmaps = true; surfTex.anisotropy = maxAniso;
      shared.terrainMat.map = surfTex; shared.terrainMat.needsUpdate = true;
    }
    const all = { x0: 0, y0: 0, x1: w - 1, y1: w - 1 };
    paintSurface(terrain, { x0: 0, y0: 0, x1: W - 1, y1: W - 1 });
    surfTex.needsUpdate = true;
    // bobot detail halus per vertex (R rumput, G pasir, B batu, A salju)
    if (!dwTex || dwTex.image.width !== w) {
      if (dwTex) dwTex.dispose();
      dwData = new Uint8Array(w * w * 4);
      dwTex = new THREE.DataTexture(dwData, w, w, THREE.RGBAFormat, THREE.UnsignedByteType);
      dwTex.magFilter = dwTex.minFilter = THREE.LinearFilter; dwTex.generateMipmaps = false;
      shared.terrainUniforms.uDW.value = dwTex;
    }
    detailWeights(all);
    dwTex.needsUpdate = true;
    shared.terrainUniforms.uDRep.value = n / DETAIL_CELLS;
    // peta kedalaman untuk shader air (nilai bertanda -> garis buih tepat di garis air)
    if (!depthTex || depthTex.image.width !== w) {
      if (depthTex) depthTex.dispose();
      depthData = new Uint8Array(w * w * 2);
      depthTex = new THREE.DataTexture(depthData, w, w, THREE.RGFormat, THREE.UnsignedByteType);
      depthTex.magFilter = depthTex.minFilter = THREE.LinearFilter;
      depthTex.generateMipmaps = false; depthTex.unpackAlignment = 1;
      shared.waterUniforms.uDepth.value = depthTex;
    }
    depthFill(all);
    depthTex.needsUpdate = true;
    shared.waterUniforms.uGrid.value.set(half, SUB, w);
    waterMesh.scale.set(n, 1, n);
    waterMesh.visible = true;
  }
  // unggah kotak piksel P tekstur permukaan (texSubImage2D) lalu buat ulang mipmap di GPU. Sengaja tanpa
  // renderer.copyTextureToTexture: fungsi itu memanggil gl.getParameter (sinkron, menunggu GPU menyelesaikan frame) tiap kali.
  // Unggahan penuh masih tertunda (atau belum pernah diunggah): data sudah ikut di situ.
  let stage = new Uint8Array(0);
  function uploadSurfRect(P) {
    const tp = renderer.properties.get(surfTex), wt = tp.__webglTexture;
    if (!wt || tp.__version !== surfTex.version) return;
    const W = surfTex.image.width, w = P.x1 - P.x0 + 1, h = P.y1 - P.y0 + 1;
    if (stage.length < w * h * 4) stage = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) stage.set(surfData.subarray(((P.y0 + y) * W + P.x0) * 4, ((P.y0 + y) * W + P.x1 + 1) * 4), y * w * 4);
    const gl = renderer.getContext();
    renderer.state.bindTexture(gl.TEXTURE_2D, wt);   // lewat state three supaya cache ikatan teksturnya tetap benar
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, P.x0, P.y0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, stage, 0);
    gl.generateMipmap(gl.TEXTURE_2D);
  }
  // pembaruan sebagian (kotak vertex): tinggi/diagonal/normal grid (dh), warna vertex (E), tekstur permukaan (kotak piksel P),
  // bobot detail (Rdw) & peta kedalaman air (Rdep). Ke GPU hanya baris/kotak yang berubah.
  function patchGround(dh, E, P, Rdw, Rdep) {
    const geo = terrainMesh.geometry, w = VW, m = w - 1, pm = size * TEX_R - 1;
    // dinding sisi memakai tinggi & warna tekstur di tepi slab: perlu dibangun ulang hanya bila tepi ikut berubah
    if ((dh && (dh.x0 === 0 || dh.y0 === 0 || dh.x1 === m || dh.y1 === m)) || (P && (P.x0 === 0 || P.y0 === 0 || P.x1 === pm || P.y1 === pm))) wallDirty = true;
    if (dh) {
      const pos = geo.getAttribute("position"), nor = geo.getAttribute("normal"), idx = geo.index, P3 = pos.array, N3 = nor.array, I = idx.array;
      for (let j = dh.y0; j <= dh.y1; j++) for (let i = dh.x0, k = j * w + i; i <= dh.x1; i++, k++) P3[k * 3 + 1] = Hc[k];
      pos.addUpdateRange(dh.y0 * w * 3, (dh.y1 - dh.y0 + 1) * w * 3); pos.needsUpdate = true;
      const q = { x0: Math.max(0, dh.x0 - 1), y0: Math.max(0, dh.y0 - 1), x1: Math.min(m - 1, dh.x1), y1: Math.min(m - 1, dh.y1) };
      fillIndex(I, q);
      idx.addUpdateRange(q.y0 * m * 6, (q.y1 - q.y0 + 1) * m * 6); idx.needsUpdate = true;
      // normal vertex = jumlah normal segitiga (berbobot luas) di sekitarnya, urutan sama dengan computeVertexNormals
      const nv = rG(dh, 1, m);
      for (let j = nv.y0; j <= nv.y1; j++) N3.fill(0, (j * w + nv.x0) * 3, (j * w + nv.x1 + 1) * 3);
      const add = (v, x, y, z) => {
        const vx = v % w, vy = (v / w) | 0;
        if (vx >= nv.x0 && vx <= nv.x1 && vy >= nv.y0 && vy <= nv.y1) { N3[v * 3] += x; N3[v * 3 + 1] += y; N3[v * 3 + 2] += z; }
      };
      for (let y = Math.max(0, nv.y0 - 1); y <= Math.min(m - 1, nv.y1); y++) for (let x = Math.max(0, nv.x0 - 1); x <= Math.min(m - 1, nv.x1); x++) {
        for (let p = (y * m + x) * 6, e = p + 6; p < e; p += 3) {
          const a = I[p] * 3, b = I[p + 1] * 3, c = I[p + 2] * 3;
          const cbx = P3[c] - P3[b], cby = P3[c + 1] - P3[b + 1], cbz = P3[c + 2] - P3[b + 2];
          const abx = P3[a] - P3[b], aby = P3[a + 1] - P3[b + 1], abz = P3[a + 2] - P3[b + 2];
          const nx = cby * abz - cbz * aby, ny = cbz * abx - cbx * abz, nz = cbx * aby - cby * abx;
          add(I[p], nx, ny, nz); add(I[p + 1], nx, ny, nz); add(I[p + 2], nx, ny, nz);
        }
      }
      for (let j = nv.y0; j <= nv.y1; j++) for (let i = nv.x0, o = (j * w + i) * 3; i <= nv.x1; i++, o += 3) {
        const l = Math.sqrt(N3[o] * N3[o] + N3[o + 1] * N3[o + 1] + N3[o + 2] * N3[o + 2]) || 1;
        N3[o] /= l; N3[o + 1] /= l; N3[o + 2] /= l;
      }
      nor.addUpdateRange(nv.y0 * w * 3, (nv.y1 - nv.y0 + 1) * w * 3); nor.needsUpdate = true;
    }
    if (E) {
      const col = geo.getAttribute("color"), src = layers.terrain ? colTex : colPlain;
      if (col && col.array.length === src.length) {
        for (let j = E.y0; j <= E.y1; j++) col.array.set(src.subarray((j * w + E.x0) * 3, (j * w + E.x1 + 1) * 3), (j * w + E.x0) * 3);
        col.addUpdateRange(E.y0 * w * 3, (E.y1 - E.y0 + 1) * w * 3); col.needsUpdate = true;
      }
    }
    if (P) { paintSurface(terrain, P); uploadSurfRect(P); }
    if (Rdw) { detailWeights(Rdw); dwTex.needsUpdate = true; }
    if (Rdep) { depthFill(Rdep); depthTex.needsUpdate = true; }
  }

  // dinding sisi: tanah berlapis (tekstur strata) dari permukaan ke dasar; dinding air biru di tepi yang di bawah laut
  function buildWalls() {
    const n = size, m = n * SUB, w = VW, half = n / 2, W = n * TEX_R;
    wallDirty = false;
    const edges = [
      { at: (k) => [k, m], nx: 0, nz: 1 },        // selatan (kiri -> kanan dilihat dari luar)
      { at: (k) => [m, m - k], nx: 1, nz: 0 },    // timur
      { at: (k) => [m - k, 0], nx: 0, nz: -1 },   // utara
      { at: (k) => [0, k], nx: -1, nz: 0 },       // barat
    ];
    const cols = m + 1, ROWS = 5, vPer = cols * ROWS;
    const pos = new Float32Array(4 * vPer * 3), nor = new Float32Array(4 * vPer * 3), uv = new Float32Array(4 * vPer * 2),
      col = new Float32Array(4 * vPer * 3), idx = new Uint32Array(4 * m * (ROWS - 1) * 6);
    const wp = [], wc = [], wn = [];   // dinding air (segitiga lepas, rgba)
    const WT = lin("#6cb0dc"), WB = lin("#3570a3"), WHITE = [1, 1, 1], LOW = [0.9, 0.9, 0.9];
    const waterV = (x, y, z, e) => {
      const t = clamp(-y / 9.5, 0, 1);
      wp.push(x, y, z); wn.push(e.nx, 0, e.nz);
      wc.push(WT[0] + (WB[0] - WT[0]) * t, WT[1] + (WB[1] - WT[1]) * t, WT[2] + (WB[2] - WT[2]) * t, 0.84 + 0.12 * t);
    };
    // warna tepi atas dinding = warna tekstur permukaan di tepi itu (digelapkan)
    const rim = (i, j) => {
      const px = clamp(Math.round((i / SUB) * TEX_R), 0, W - 1), py = clamp(Math.round((j / SUB) * TEX_R), 0, W - 1), o = (py * W + px) * 4;
      return [toLin(surfData[o]) * 0.62, toLin(surfData[o + 1]) * 0.62, toLin(surfData[o + 2]) * 0.62];
    };
    let ip = 0;
    edges.forEach((e, ei) => {
      const base = ei * vPer, pts = [];
      for (let k = 0; k <= m; k++) {
        const [i, j] = e.at(k), top = Hc[j * w + i];
        const wx = i / SUB - half, wz = j / SUB - half, u = (ei * n + k / SUB) / STRATA_TILE;
        const rows = top > 0
          ? [[top, rim(i, j)], [top - 0.14, SOIL], [top - 0.42, SOIL], [top - 0.56, WHITE], [BASE_Y, LOW]]
          : [[top, SEA_LINE], [top - 0.16, SEA_LINE], [top - 0.3, WHITE], [top - 0.5, WHITE], [BASE_Y, LOW]];
        rows.forEach(([y, c], r) => {
          const v = base + r * cols + k;
          pos[v * 3] = wx; pos[v * 3 + 1] = y; pos[v * 3 + 2] = wz;
          nor[v * 3] = e.nx; nor[v * 3 + 2] = e.nz;
          uv[v * 2] = u; uv[v * 2 + 1] = (y - BASE_Y) / (STRATA_TOP - BASE_Y);
          col[v * 3] = c[0]; col[v * 3 + 1] = c[1]; col[v * 3 + 2] = c[2];
        });
        pts.push([wx, wz, top]);
      }
      for (let r = 0; r < ROWS - 1; r++) for (let k = 0; k < m; k++) {
        const tl = base + r * cols + k, tr = tl + 1, bl = tl + cols, br = bl + 1;
        idx[ip++] = tl; idx[ip++] = bl; idx[ip++] = br; idx[ip++] = tl; idx[ip++] = br; idx[ip++] = tr;
      }
      // air: dari dasar laut (tepi medan) ke y=0, dipotong tepat di titik medan menembus muka air
      for (let k = 0; k < m; k++) {
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

  // ---------- puncak gunung batu (posisi = simbol gunung 2D) ----------
  // Gunung kini berupa bukit batu membulat dari medan itu sendiri (NovelMapCore.computeTerrain) — tanpa puncak kerucut
  // bergerigi; grup dikosongkan saja (dipertahankan supaya alur bangun ulang tetap sama).
  function buildMountains() {
    clearGroup(G.mounts);
  }

  // ---------- pohon (InstancedMesh per jenis & per potongan TREE_CHUNK sel agar bisa di-cull; deterministik dengan hash2) ----------
  // Titik pohon = grid ber-jitter dengan jarak per bioma: hutan lebat rapat (tajuk saling menutup seperti ilustrasi),
  // bioma jarang (padang rumput, tundra, rawa) memakai peluang = treeDensity. Bioma pucat memakai pohon hijau muda/bersalju.
  const TREE_CHUNK = 32;
  const TREE_GAP = { pine: 1.1, broad: 1.5, palm: 1.4 };   // hutan lebat: tajuk besar saling menutup (ala ilustrasi)   // jarak grid hutan lebat (sel)
  const treeCfg = [];   // indeks bioma -> { s: jarak grid (sel), p: peluang, kind, mix }
  BIOMES.forEach((b, i) => {
    if (!b.land || !b.tree) return;
    const dens = b.treeDensity || 0, dense = dens > 0.3, c = rgb8(b.color);
    const pale = (c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11) / 255 > 0.62;   // sama dengan 2D
    const kind = b.tree === "pine" ? (pale ? "snowPine" : "pine") : b.tree === "broad" ? (pale ? "broadLight" : "broad") : b.tree;
    treeCfg[i] = { s: dense ? TREE_GAP[kind] || 0.8 : 1, p: dense ? 0.55 + dens * 0.5 : Math.min(0.6, dens * (b.tree === "reed" ? 2 : 1.25)),
      kind, mix: b.tree === "broad" && pale, z: dense ? (b.tree === "broad" ? 1.6 : 1.3) : b.tree === "reed" ? 1 : 1.55 };   // z = pengali ukuran pohon (jarang = pohon besar)
  });
  // skala pohon [dasar, variasi] (tinggi pinus skala 1 ±1.7 sel)
  const TREE_VARS = window.NovelMapTrees ? window.NovelMapTrees.VARIANTS : 4;
  const TREE_SIZE = { pine: [1.06, 0.4], pineLight: [0.95, 0.32], snowPine: [1, 0.32], broad: [1.02, 0.34], broadLight: [0.95, 0.3], palm: [1.04, 0.32], reed: [0.95, 0.55] };
  function buildTrees(t) {
    clearGroup(G.trees);
    const n = t.size, half = n / 2, seed = map.seed, bio = map.biome, river = t.river;
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
    // bioma berpohon yang ada di peta, dikelompokkan per jarak grid
    const used = new Uint8Array(256);
    for (let i = 0; i < n * n; i++) used[bio[i]] = 1;
    const spacings = [];
    treeCfg.forEach((c, i) => { if (c && used[i] && !spacings.includes(c.s)) spacings.push(c.s); });
    const CN = Math.ceil(n / TREE_CHUNK), buckets = new Map();   // "jenis|potongan" -> [x, y, z, skala, -, skalaY, r, g, b, varian, ...]
    spacings.forEach((sp) => {
      const GN = Math.ceil(n / sp), sd = seed + 911 + Math.round(sp * 100) * 7919;   // per jarak grid (stabil saat bioma lain ditambah)
      for (let gy = 0; gy < GN; gy++) for (let gx = 0; gx < GN; gx++) {
        const x = (gx + 0.5 + (hash2(gx, gy, sd) - 0.5) * 0.86) * sp, y = (gy + 0.5 + (hash2(gx, gy, sd + 1) - 0.5) * 0.86) * sp;
        if (x < 0.05 || y < 0.05 || x > n - 0.05 || y > n - 0.05) continue;
        const ci = (y | 0) * n + (x | 0), cfg = treeCfg[bio[ci]];
        if (!cfg || cfg.s !== sp || river[ci] || mask[ci] || hash2(gx, gy, sd + 2) >= cfg.p) continue;
        if (landAtWarped(x, y) < 0.8) continue;
        const h = sampleH(x, y);
        if (h < 0.22 || h > snowLine) continue;
        const sl = Math.abs(sampleH(x + 0.5, y) - sampleH(x - 0.5, y)) + Math.abs(sampleH(x, y + 0.5) - sampleH(x, y - 0.5));
        if (sl > 1.7) continue;
        const r1 = hash2(gx, gy, sd + 3), r2 = hash2(gx, gy, sd + 4), r3 = hash2(gx, gy, sd + 5);
        const kind = cfg.mix ? (r3 < 0.35 ? "pineLight" : "broadLight") : cfg.kind;
        const key = kind + "|" + (((y / TREE_CHUNK) | 0) * CN + ((x / TREE_CHUNK) | 0));
        let arr = buckets.get(key);
        if (!arr) buckets.set(key, (arr = []));
        const sz = TREE_SIZE[kind], k = 0.86 + r2 * 0.24, tint = (r3 - 0.5) * 0.16, vr = (((r2 * 3.1) % 1) * TREE_VARS) | 0;   // varian = 2D
        arr.push(x - half, h - 0.06, y - half, (sz[0] + sz[1] * r1) * cfg.z, 0, 0.9 + r3 * 0.24, k * (1 + tint), k, k * (1 - tint * 1.3), vr);
      }
    });
    buckets.forEach((arr, key) => {
      const count = arr.length / 10, mesh = treeMesh(key.slice(0, key.indexOf("|")), count), M = mesh.instanceMatrix.array;
      const col = new Float32Array(count * 3), cell = mesh.geometry.getAttribute("aCell").array, row = mesh.userData.row;
      for (let j = 0; j < count; j++) {
        const o = j * 10, sc = arr[o + 3], m = j * 16;
        // papan menghadap kamera dihitung di shader; matriks instance hanya posisi kaki + skala (lebar, tinggi)
        M[m] = sc; M[m + 1] = 0; M[m + 2] = 0; M[m + 3] = 0;
        M[m + 4] = 0; M[m + 5] = sc * arr[o + 5]; M[m + 6] = 0; M[m + 7] = 0;
        M[m + 8] = 0; M[m + 9] = 0; M[m + 10] = sc; M[m + 11] = 0;
        M[m + 12] = arr[o]; M[m + 13] = arr[o + 1]; M[m + 14] = arr[o + 2]; M[m + 15] = 1;
        col[j * 3] = arr[o + 6]; col[j * 3 + 1] = arr[o + 7]; col[j * 3 + 2] = arr[o + 8];
        cell[j * 2] = arr[o + 9]; cell[j * 2 + 1] = row;
      }
      mesh.instanceColor = new THREE.InstancedBufferAttribute(col, 3);
      mesh.computeBoundingSphere();
      G.trees.add(mesh);
    });
  }
  // InstancedMesh papan pohon jenis `kind` (geometri sendiri: atribut sel atlas per instance)
  function treeMesh(kind, count) {
    const T = shared.trees[kind], geo = T.geo.clone();
    geo.setAttribute("aCell", new THREE.InstancedBufferAttribute(new Float32Array(count * 2), 2));
    const mesh = new THREE.InstancedMesh(geo, shared.treeMat, count);
    mesh.customDepthMaterial = shared.treeDepthMat;   // bayangan = siluet gambar pohon
    mesh.castShadow = true;
    mesh.userData.row = T.row;
    mesh.userData.ownGeo = true;
    return mesh;
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

  // ---------- label peta: decal teks yang menempel medan (gaya & ukuran sama dengan 2D) ----------
  function cached(key, make) {
    let e = spriteCache.get(key);
    if (!e) { e = make(); spriteCache.set(key, e); }
    e.used = true;
    return e;
  }
  function buildLabels() {
    clearGroup(G.labels);
    const half = size / 2;
    labelClip.forEach((pl) => { pl.constant = half; });
    (map.labels || []).forEach((lb) => {
      const text = String(lb.text == null ? "" : lb.text).replace(/\s+/g, " ").trim();
      if (!text) return;
      const style = lb.style === "water" || lb.style === "small" ? lb.style : "region";
      const e = cached("l|" + style + "|" + text, () => makeLabelTexture(text, style));
      const em = Math.max(0.5, +lb.size || 4) * 0.9 * (style === "small" ? 0.6 : 1);   // tinggi huruf (sel) = 2D
      const k = em / e.fs, LW = e.w * k, LH = e.h * k;
      const nu = Math.max(2, Math.ceil(LW / 0.5) + 1), nv = Math.max(2, Math.ceil(LH / 0.5) + 1);
      const rot = ((+lb.rotation || 0) * Math.PI) / 180, cs = Math.cos(rot), sn = Math.sin(rot);
      const pos = new Float32Array(nu * nv * 3), uv = new Float32Array(nu * nv * 2), idx = [];
      for (let b = 0; b < nv; b++) for (let a = 0; a < nu; a++) {
        const v = b * nu + a, lu = (a / (nu - 1) - 0.5) * LW, lv = (b / (nv - 1) - 0.5) * LH;
        const x = lb.x + lu * cs - lv * sn, y = lb.y + lu * sn + lv * cs;   // rotasi searah jarum jam (sama dengan 2D)
        pos[v * 3] = x - half; pos[v * 3 + 1] = Math.max(0, sampleHMax(x, y)) + 0.2; pos[v * 3 + 2] = y - half;
        uv[v * 2] = a / (nu - 1); uv[v * 2 + 1] = 1 - b / (nv - 1);
        if (a < nu - 1 && b < nv - 1) idx.push(v, v + nu, v + 1, v + 1, v + nu, v + nu + 1);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
      geo.setIndex(idx);
      const mat = new THREE.MeshBasicMaterial(Object.assign({ map: e.tex, depthWrite: false, clippingPlanes: labelClip }, PREMUL));
      mat.onBeforeCompile = labelDepthBias;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.renderOrder = 20;
      G.labels.add(mesh);
    });
  }

  // ---------- tempat: pin (ukuran tetap di layar) + pil nama terpisah yang dirapikan tiap kamera bergerak ----------
  function pinTex(icon, sel) { return cached("p|" + icon + "|" + (sel ? 1 : 0), () => makePinTexture(icon, sel)); }
  function buildPins() {
    clearGroup(G.places);
    pins = [];
    const half = size / 2;
    (map.places || []).forEach((pl) => {
      const name = String(pl.name || "").trim() || "Tanpa nama", icon = pl.icon || "";
      const pe = pinTex(icon, pl.id === selPlace), ne = cached("n|" + name, () => makeNameTexture(name));
      const pin = new THREE.Sprite(new THREE.SpriteMaterial(Object.assign({ map: pe.tex, depthTest: false, depthWrite: false, sizeAttenuation: false }, PREMUL)));
      const nm = new THREE.Sprite(new THREE.SpriteMaterial(Object.assign({ map: ne.tex, depthTest: false, depthWrite: false, sizeAttenuation: false }, PREMUL)));
      const pos = new THREE.Vector3(pl.x - half, Math.max(sampleH(pl.x, pl.y), 0) + 0.05, pl.y - half);
      pin.position.copy(pos); nm.position.copy(pos);
      pin.center.set(pe.cx, pe.cy);
      pin.renderOrder = 31; nm.renderOrder = 30;
      pin.userData = { placeId: pl.id, pw: pe.w, ph: pe.h };
      nm.userData = { placeId: pl.id, pw: ne.w, ph: ne.h };
      G.places.add(nm, pin);
      pins.push({ id: pl.id, icon, pin, name: nm, pos, pillW: ne.pillW, nw: ne.w, nh: ne.h, side: 0 });
    });
    spriteCache.forEach((e, k) => { if (!e.used) { e.tex.dispose(); spriteCache.delete(k); } });
    updatePinScale();
    layoutDirty = true;
  }
  const pinK = () => (width < 560 ? 0.84 : 1);
  // sprite ukuran tetap di layar (sizeAttenuation:false): skala = px * 2 * tan(fov/2) / tinggi viewport
  function updatePinScale() {
    if (!height) return;
    const px = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / height, k = px * pinK();
    G.places.children.forEach((sp) => sp.scale.set(sp.userData.pw * k, sp.userData.ph * k, 1));
    layoutDirty = true;
  }
  // letak pil nama: kanan pin, kalau bertabrakan coba kiri, kalau masih bertabrakan disembunyikan (pin tetap tampil).
  // Urutan: tempat prioritas/terpilih dulu, lalu yang terdekat ke kamera.
  const _pv = new THREE.Vector3();
  function layoutNames() {
    layoutDirty = false;
    if (!pins.length || !width || !height) return;
    camera.updateMatrixWorld();
    const f = pinK(), pad = 4, PH = PIN.PILL_H, headUp = PIN.H - PIN.R - 1, gap = PIN.W / 2 + PIN.GAP;
    const list = [];
    for (const p of pins) {
      _pv.copy(p.pos).project(camera);
      const on = _pv.z > -1 && _pv.z < 1 && Math.abs(_pv.x) < 1.3 && Math.abs(_pv.y) < 1.3;
      p.sx = (_pv.x + 1) * 0.5 * width; p.sy = (1 - _pv.y) * 0.5 * height; p.on = on;
      p.d = camera.position.distanceToSquared(p.pos);
      p.box = [p.sx - (PIN.W / 2) * f, p.sy - PIN.H * f, p.sx + (PIN.W / 2) * f, p.sy];
      if (on) list.push(p); else p.name.visible = false;
    }
    const rank = (p) => (p.id === selPlace ? 0 : p.id === prioPlace ? 1 : 2);
    list.sort((a, b) => rank(a) - rank(b) || a.d - b.d);
    const placed = [];
    const hit = (bx, self) => {
      for (const r of placed) if (bx[0] < r[2] + pad && bx[2] > r[0] - pad && bx[1] < r[3] + pad && bx[3] > r[1] - pad) return true;
      for (const q of list) if (q !== self && bx[0] < q.box[2] && bx[2] > q.box[0] && bx[1] < q.box[3] && bx[3] > q.box[1]) return true;
      return false;
    };
    for (const p of list) {
      const y0 = p.sy - (headUp + PH / 2) * f, y1 = p.sy - (headUp - PH / 2) * f, w = p.pillW * f;
      const boxes = [
        [p.sx + gap * f, y0, p.sx + gap * f + w, y1],                               // 1 kanan
        [p.sx - gap * f - w, y0, p.sx - gap * f, y1],                               // 2 kiri
        [p.sx - w / 2, p.sy - (PIN.H + 3 + PH) * f, p.sx + w / 2, p.sy - (PIN.H + 3) * f],   // 3 atas
        [p.sx - w / 2, p.sy + 3 * f, p.sx + w / 2, p.sy + (3 + PH) * f],             // 4 bawah
      ];
      let side = 0;
      if (p.id === selPlace) side = 1;
      else for (let c = 0; c < 4 && !side; c++) if (!hit(boxes[c], p)) side = c + 1;
      p.name.visible = side !== 0;
      if (!side) continue;
      placed.push(boxes[side - 1]);
      if (p.side !== side) {
        p.side = side;
        // titik jangkar (ujung pin) dalam koordinat tekstur pil, diukur dari kiri-bawah
        const nw = p.nw, nh = p.nh, M = PIN.PM;
        const ax = side === 1 ? M - gap : side === 2 ? nw - M + gap : nw / 2;
        const ay = side <= 2 ? nh / 2 - headUp : side === 3 ? M - PIN.H - 3 : nh - M + 3;
        p.name.center.set(ax / nw, ay / nh);
      }
    }
  }

  // ---------- bangun ulang ----------
  // medan diubah di tempat (kuas 3D, undo/redo): medan core dihitung ulang penuh (±5 ms), lalu hanya bagian grid & tekstur
  // yang benar-benar berbeda dari bangunan terakhir yang dihitung ulang & diunggah (hasil sama dengan bangun penuh).
  // Garis salju tetap selama sapuan; disesuaikan settleSnow() setelahnya.
  function syncTerrain() {
    const t0 = performance.now(), sig = terrainSig, n = size, vmax = VW - 1;
    const B = diffRect(map.biome, sig.biome);
    const nt = C.computeTerrain(map), oh = terrain.h, os = terrain.shore, ol = terrain.land, h = nt.h, sh = nt.shore, ld = nt.land;
    let x0 = n, y0 = n, x1 = -1, y1 = -1;
    for (let y = 0, i = 0; y < n; y++) for (let x = 0; x < n; x++, i++) {
      if (h[i] !== oh[i] || sh[i] !== os[i] || ld[i] !== ol[i]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    const T = x1 < 0 ? null : { x0, y0, x1, y1 };
    const nls = smoothLand(nt), L = diffRect(nls, landS);
    sig.biome.set(map.biome); sig.height.set(map.height);
    terrain = nt; landS = nls;
    if (!B && !T && !L) { syncCost = performance.now() - t0; return false; }
    // vertex yang masukannya berubah; garis pantai bergeser -> jarak pantai dihitung ulang sampai DCAP sel dari situ
    let V = rU(vr(rU(T, B), 1), vr(L, 2));
    if (L) { const core = vr(L, 2 + DCAP); coastDist(vr(L, 3 + 2 * DCAP), core); V = rU(V, core); }
    const { dh, ds } = heightsRect(V);
    const E = rU(rG(dh, 2, vmax), ds), dsl = E ? slopeColRect(E) : null, vd = rU(rU(dh, ds), dsl);
    patchGround(dh, E, rU(vpx(vd), cpx(rU(rU(B, T), L), 3)), rU(vd, vr(B, 0)), rU(dh, ds));
    if (dh) for (let j = dh.y0; j <= dh.y1; j++) for (let i = dh.x0, k = j * VW + i; i <= dh.x1; i++, k++) if (Hc[k] > topLive) topLive = Hc[k];
    syncCost = performance.now() - t0;
    return true;
  }
  // garis salju relatif ke puncak tertinggi (sama dengan bangun penuh): bila bergeser, lukis ulang hanya bagian yang cukup tinggi
  function settleSnow() {
    let mt = 0;
    for (let k = 0; k < Hc.length; k++) if (Hc[k] > mt) mt = Hc[k];
    maxTop = topLive = mt;
    const sl = Math.max(SNOW_MIN, mt * 0.78);
    if (sl === snowLine) return;
    const lo = Math.min(sl, snowLine) - 2, w = VW;
    snowLine = sl;
    let r = null;
    for (let j = 0, k = 0; j < w; j++) for (let i = 0; i < w; i++, k++) if (Hc[k] >= lo) r = rU(r, { x0: i, y0: j, x1: i, y1: j });
    if (r) { r = rG(r, 1, w - 1); patchGround(null, null, vpx(r), r, null); }
  }
  function sameTerrain() {
    const s = terrainSig;
    if (!s || !terrain || s.seed !== map.seed || s.size !== map.size) return false;
    const b = map.biome, hgt = map.height;
    if (b.length !== s.biome.length) return false;
    for (let i = 0; i < b.length; i++) if (b[i] !== s.biome[i] || hgt[i] !== s.height[i]) return false;
    return s.rivers === JSON.stringify(map.rivers || []);
  }
  function refresh() {
    if (disposed) return;
    cancelStroke();
    if (!map) { clearAll(); requestRender(); return; }
    // medan (berat: tekstur 1024², grid 257²) hanya dihitung ulang bila bioma/ketinggian/sungai berubah;
    // bila hanya bioma/ketinggian (undo/redo, kuas), cukup bagian yang berbeda
    if (!sameTerrain()) {
      const sig = terrainSig;
      if (sig && terrain && Hc && sig.seed === map.seed && sig.size === map.size && sig.rivers === JSON.stringify(map.rivers || [])) {
        syncTerrain(); settleSnow();
        terrainMesh.geometry.computeBoundingSphere();
      } else {
        terrain = C.computeTerrain(map);
        size = terrain.size;
        fields = getFields(C, map.seed, size);
        landS = smoothLand(terrain);
        buildHeights();
        buildGround();
        terrainSig = { seed: map.seed, size: map.size, biome: map.biome.slice(), height: map.height.slice(), rivers: JSON.stringify(map.rivers || []) };
      }
      buildWalls();
      buildMountains();
    }
    buildTrees(terrain);
    buildVectors();
    spriteCache.forEach((e) => { e.used = false; });   // tekstur yang tidak dipakai lagi dibuang di akhir buildPins
    buildLabels();
    buildPins();
    applyLayers();
    if (!fitted && width && height) resetCamera(true);
  }
  function clearAll() {
    [terrainMesh, wallMesh, waterWallMesh].forEach((m) => swapGeometry(m, new THREE.BufferGeometry()));
    skirtMesh.geometry = waterWallMesh.geometry;
    waterMesh.visible = false;
    ["trees", "mounts", "rivers", "paths", "zones", "labels", "places"].forEach((k) => clearGroup(G[k]));
    pins = [];
    spriteCache.forEach((e) => e.tex.dispose()); spriteCache.clear();
    Hc = SD = SL = vS = vD = vDw = null; terrain = null; terrainSig = null; landS = null;
  }
  function applyLayers() {
    G.trees.visible = G.mounts.visible = !!layers.terrain;
    ["rivers", "paths", "zones", "places", "labels"].forEach((k) => { G[k].visible = !!layers[k]; });
    terrainMesh.material = layers.terrain ? shared.terrainMat : shared.plainMat;
    const attr = terrainMesh.geometry.getAttribute("color");
    if (attr && colTex && attr.count * 3 === colTex.length) { attr.array.set(layers.terrain ? colTex : colPlain); attr.clearUpdateRanges(); attr.needsUpdate = true; }
    renderer.shadowMap.needsUpdate = true;
    layoutDirty = true;
    requestRender();
  }

  // ---------- kamera ----------
  // pose awal: arah tetap (dari selatan, miring ELEV); target & jarak diiterasi sampai kotak slab pas di layar.
  // edit (alat lukis aktif): lebih miring & hanya permukaan peta yang dipaskan (sisi slab boleh keluar layar) -> diorama besar
  function fitPose(edit) {
    const half = size / 2, top = Math.max(1.5, Math.min(12, maxTop)), cam = camera.clone();
    const tall = 1 - smooth(0.6, 1.5, camera.aspect);
    const el = edit ? ELEV_EDIT + (ELEV_EDIT_TALL - ELEV_EDIT) * tall : ELEV + (ELEV_TALL - ELEV) * tall;
    const fitX = edit ? 1 : 0.94 + 0.06 * (1 - smooth(0.7, 0.95, camera.aspect));
    let fitCY = 0.04 * smooth(0.7, 0.95, camera.aspect), fitY = FIT_Y;
    if (edit) {   // pita layar yang tidak tertutup UI (setFitInsets), minimal 45% tinggi kanvas
      let t = insets.top, b = insets.bottom;
      const free = height - t - b, need = height * 0.45;
      if (free < need) { const k = (height - need) / Math.max(1, t + b); t *= k; b *= k; }
      const yT = 1 - (2 * t) / height, yB = -1 + (2 * b) / height;
      fitCY = (yT + yB) / 2; fitY = ((yT - yB) / 2) * 0.95;
    }
    const dir = new THREE.Vector3(0, Math.sin(el), Math.cos(el)), target = new THREE.Vector3(0, -2, 0);
    const pts = [], v = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3();
    for (const x of [-half, half]) for (const z of [-half, half]) for (const y of [edit ? 0 : BASE_Y, top]) pts.push(new THREE.Vector3(x, y, z));
    let d = size * 2;
    for (let it = 0; it < 8; it++) {
      cam.position.copy(target).addScaledVector(dir, d); cam.lookAt(target); cam.updateMatrixWorld(true);
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      pts.forEach((p) => { v.copy(p).project(cam); x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y); });
      const tV = Math.tan(THREE.MathUtils.degToRad(FOV / 2)), tH = tV * cam.aspect;
      right.setFromMatrixColumn(cam.matrixWorld, 0); up.setFromMatrixColumn(cam.matrixWorld, 1);
      target.addScaledVector(right, ((x0 + x1) / 2) * tH * d).addScaledVector(up, ((y0 + y1) / 2 - fitCY) * tV * d);
      d *= Math.max((x1 - x0) / (2 * fitX), (y1 - y0) / (2 * fitY));
    }
    // geser target di sepanjang garis pandang ke y=-2 (gambar sama, target tetap di dalam batas clampTarget)
    const t = (-2 - target.y) / dir.y;
    target.addScaledVector(dir, t); d -= t;
    return { target, pos: target.clone().addScaledVector(dir, d), d };
  }
  // autoPose: kamera masih di pose otomatis (belum diputar/digeser/di-zoom) -> ikut berganti saat alat lukis <-> lihat
  let autoPose = false, insets = { top: 0, bottom: 0 };
  // opsional (mirip setFitInsets map2d.js): px kanvas atas/bawah yang tertutup UI (baris Layers, popover alat + toolbar).
  // Hanya pose lukis yang memakainya, saat pose berikutnya dihitung (3D dibuka, Fit, ganti alat lihat <-> lukis, ukuran
  // berubah). Sengaja tidak langsung menggeser kamera: tinggi popover berganti tiap alat, peta tidak ikut bergoyang
  function setFitInsets(o) {
    if (disposed) return;
    insets = { top: Math.max(0, Math.round(Number(o && o.top) || 0)), bottom: Math.max(0, Math.round(Number(o && o.bottom) || 0)) };
  }
  function resetCamera(instant) {
    if (disposed) return;
    const view = fitPose(false), f = PAINT[tool] ? fitPose(true) : view;
    controls.maxDistance = Math.max(260, view.d * 2.6);
    autoPose = true;
    if (instant === true || !fitted) {
      tween = null; stopInertia();
      camera.position.copy(f.pos); controls.target.copy(f.target); camera.lookAt(f.target);
      controls.update();
      fitted = !!(width && height);
    } else startTween(f.pos, f.target, 520);
    layoutDirty = true;
    requestRender();
  }
  function zoomBy(factor) {
    if (disposed || !(factor > 0)) return;
    autoPose = false;
    const off = camera.position.clone().sub(controls.target);
    const d = clamp(off.length() / factor, controls.minDistance, controls.maxDistance);
    startTween(controls.target.clone().add(off.setLength(d)), controls.target.clone(), 240);
  }
  // sisa inersia putar/geser OrbitControls (damping) dibuang saat kamera diatur dari kode, kalau tidak pose akhir ikut bergeser
  // (field internal OrbitControls r169 yang disertakan di vendor/)
  function stopInertia() {
    if (controls._sphericalDelta) controls._sphericalDelta.set(0, 0, 0);
    if (controls._panOffset) controls._panOffset.set(0, 0, 0);
  }
  function startTween(pos, target, ms) {
    stopInertia();
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
  controls.addEventListener("start", () => { tween = null; orbiting = true; cursorDirty = true; autoPose = false; });
  controls.addEventListener("end", () => { orbiting = false; cursorDirty = true; });
  controls.addEventListener("change", () => { needsRender = true; layoutDirty = true; });

  // ---------- pemanasan shader (sekali, saat medan pertama siap) ----------
  // three mengompilasi program saat pertama dipakai & menunggunya sinkron -> patah-patah di awal sapuan (kursor kuas; pohon,
  // garis tepi & batu di peta yang belum punya). Semua dikompilasi paralel dulu (compileAsync) sebelum frame pertama: instance
  // mungil tiap material pohon ikut di adegan sampai bayangan pertama digambar. compile() juga menyiapkan cahaya, jadi program
  // bayangan frame pertama sudah yang final (tanpa itu three memakai program bayangan "tanpa cahaya" lalu mengompilasi ulang).
  let warm = 0, warmT = 0, warmG = null;   // 0 belum, 1 menunggu kompilasi, 2 siap
  function warmUp(now) {
    if (warm === 0) {
      warm = 1; warmT = now;
      warmG = new THREE.Group();
      const m4 = new THREE.Matrix4().makeScale(1e-4, 1e-4, 1e-4).setPosition(0, BASE_Y - 4, 0);   // di bawah slab
      {   // papan pohon (+ materi bayangannya) dikompilasi lebih dulu
        const im = treeMesh("pine", 1);
        im.setMatrixAt(0, m4); im.setColorAt(0, new THREE.Color(1, 1, 1));
        im.frustumCulled = false;
        warmG.add(im);
      }
      scene.add(warmG);
      const done = () => { if (warm === 1) { warm = 2; needsRender = true; renderer.shadowMap.needsUpdate = true; } };
      try { renderer.compileAsync(scene, camera).then(done, done); } catch (e) { done(); }
    }
    if (warm === 1 && now - warmT > 4000) { warm = 2; renderer.shadowMap.needsUpdate = true; }   // jaga-jaga
    return warm === 2;
  }

  // ---------- render loop (hanya saat aktif) ----------
  let lastActive = 0;
  function requestRender() { needsRender = true; }
  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (!width || !height) return;
    if (warm !== 2 && Hc && !warmUp(now)) return;
    paintTick(now);
    let moved = false;
    if (tween) { stepTween(now); moved = true; }
    if (controls.update()) moved = true;
    if (clampTarget()) moved = true;
    if (moved && PAINT[tool]) cursorDirty = true;   // titik di bawah pointer & tebal cincin ikut kamera
    if (cursorDirty) updateCursor();
    if (moved || needsRender) lastActive = now;
    else if (now - lastRender < IDLE_MS || now - lastActive > IDLE_STOP) return;
    if (moved || layoutDirty) layoutNames();
    const t = now * 0.001;
    shared.waterNormal.offset.set(t * 0.011, t * 0.006);
    shared.waterTex.offset.set(t * 0.0012, -t * 0.0007);
    // frame pemanasan: kursor kuas ikut digambar sekali (geometrinya masih titik nol, tak terlihat) supaya driver tanpa
    // kompilasi paralel menuntaskan programnya sekarang, bukan saat kursor pertama muncul
    const warmCur = !!warmG && !cursorG.visible;
    if (warmCur) { cursorG.visible = true; mark.scale.setScalar(0); }
    renderer.render(scene, camera);
    lastRender = now; needsRender = false;
    if (warmCur) cursorG.visible = false;
    if (warmG) { scene.remove(warmG); warmG.children.forEach((o) => { o.dispose(); o.geometry.dispose(); }); warmG = null; }   // bayangan sudah digambar
  }
  function setActive(on) {
    if (disposed) return;
    active = !!on;
    if (!active) {   // sapuan yang sedang berjalan disimpan; kursor kuas disembunyikan
      if (stroke) endStroke();
      cancelStroke();
      hoverXY = null; touchIds.clear(); touchBusy = false; cursorG.visible = false;
    }
    if (active && !raf) { resize(); needsRender = true; raf = requestAnimationFrame(frame); }
    else if (!active && raf) { cancelAnimationFrame(raf); raf = 0; }
  }

  function resize() {
    if (disposed) return;
    const w = Math.round(container.clientWidth), h = Math.round(container.clientHeight);
    const pr = Math.min(window.devicePixelRatio || 1, MAX_PR);
    if (pr !== renderer.getPixelRatio()) { renderer.setPixelRatio(pr); requestRender(); }
    if (w === width && h === height) return;
    width = w; height = h;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    updatePinScale();
    if ((!fitted || autoPose) && map) resetCamera(true);   // pose otomatis mengikuti ukuran baru
    requestRender();
  }
  const ro = typeof ResizeObserver === "function" ? new ResizeObserver(() => resize()) : null;
  if (ro) ro.observe(container); else window.addEventListener("resize", resize);

  // ---------- klik pin tempat (raycast) & kursor ----------
  const raycaster = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let down = null, hoverPending = false, lastMove = null;
  function pickPlace(clientX, clientY) {
    if (!layers.places || !pins.length) return null;
    const r = canvas.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const vis = G.places.children.filter((o) => o.visible);   // raycaster tidak memeriksa .visible
    const hit = raycaster.intersectObjects(vis, false)[0];
    return hit ? hit.object.userData.placeId : null;
  }
  function onDown(e) { down = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId }; }
  function onUp(e) {
    const d = down; down = null;
    if (!d || d.id !== e.pointerId || e.button > 0 || PAINT[tool]) return;   // alat lukis: ketukan = tapak kuas
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6 || performance.now() - d.t > 700) return;
    const id = pickPlace(e.clientX, e.clientY);
    if (id) { prioPlace = id; layoutDirty = true; requestRender(); }
    if (typeof opts.onSelect === "function") opts.onSelect(id ? { type: "place", id } : null);
  }
  function onMove(e) {
    if (e.pointerType !== "mouse" || e.buttons || PAINT[tool]) return;
    lastMove = e;
    if (hoverPending) return;
    hoverPending = true;
    requestAnimationFrame(() => {
      hoverPending = false;
      if (disposed || !lastMove || PAINT[tool]) return;
      canvas.style.cursor = pickPlace(lastMove.clientX, lastMove.clientY) ? "pointer" : "";
    });
  }
  function onLeave() { lastMove = null; if (!stroke) canvas.style.cursor = ""; }
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerleave", onLeave);

  // ================= KUAS 3D: lukis bioma, hapus, naik/turunkan medan (perilaku sama dengan map2d.js) =================
  function emit(name, arg) { const fn = opts[name]; if (typeof fn === "function") fn(arg); }
  const brushSize = () => (tool === "elevation" ? elev.size : brush.size);
  // sel di bawah pointer: sinar kamera dimajukan bertahap di atas permukaan yang terlihat (maks(medan, muka air)) lalu
  // dipersempit bagi dua. Tidak kena medan: bidang muka air (sapuan dari tepi/luar peta tetap jalan seperti 2D).
  // A = larik tinggi vertex (Hc, atau salinan saat sapuan mulai supaya titik kuas tidak bergeser saat medan naik)
  function pickCell(clientX, clientY, A) {
    if (!A || !width || !height) return null;
    const rc = canvas.getBoundingClientRect();
    if (!rc.width || !rc.height) return null;
    ndc.set(((clientX - rc.left) / rc.width) * 2 - 1, -((clientY - rc.top) / rc.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const o = raycaster.ray.origin, d = raycaster.ray.direction, half = size / 2;
    const above = (t) => o.y + d.y * t - Math.max(0, sampleArr(A, o.x + d.x * t + half, o.z + d.z * t + half));
    let t0 = 0, t1 = Infinity;
    const slab = (oo, dd, lo, hi) => {   // potong sinar dengan kotak peta per sumbu
      if (Math.abs(dd) < 1e-9) return oo >= lo && oo <= hi;
      let a = (lo - oo) / dd, b = (hi - oo) / dd;
      if (a > b) { const tmp = a; a = b; b = tmp; }
      if (a > t0) t0 = a;
      if (b < t1) t1 = b;
      return t0 <= t1;
    };
    if (slab(o.x, d.x, -half, half) && slab(o.y, d.y, 0, Math.max(0, topLive) + 0.5) && slab(o.z, d.z, -half, half)) {
      const dt = Math.min(0.3 / Math.max(Math.hypot(d.x, d.z), 1e-4), 0.4 / Math.max(Math.abs(d.y), 1e-4));
      let ta = t0, hit = above(ta) <= 0 ? ta : -1;
      for (let i = 0; hit < 0 && i < 5000 && ta < t1; i++) {
        const tb = Math.min(ta + dt, t1);
        if (above(tb) <= 0) {
          let lo = ta, hi = tb;
          for (let k = 0; k < 14; k++) { const mid = (lo + hi) / 2; if (above(mid) > 0) lo = mid; else hi = mid; }
          hit = hi;
        }
        ta = tb;
      }
      if (hit >= 0) return { x: o.x + d.x * hit + half, y: o.z + d.z * hit + half };
    }
    if (d.y < -1e-4) { const t = -o.y / d.y; if (t > 0) return { x: o.x + d.x * t + half, y: o.z + d.z * t + half }; }
    return null;
  }
  // checkpoint undo baru dibuat saat sapuan benar-benar mengubah sesuatu (sama dengan 2D)
  function wouldChange(cx, cy, r) {
    const n = size, bio = map.biome, ht = map.height;
    const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(n - 1, Math.ceil(cx + r)), y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(n - 1, Math.ceil(cy + r));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const dd = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (dd > r) continue;
      const i = y * n + x;
      if (tool === "brush" ? bio[i] !== brush.biome : tool === "eraser" ? bio[i] !== 0 || ht[i] !== 0
        : dd < r * 0.8 && (elev.mode === "lower" ? ht[i] > 0 : ht[i] < 255)) return true;
    }
    return false;
  }
  function dabAt(x, y) {
    const s = stroke, sz = brushSize();
    if (!s.began) {
      if (!wouldChange(x, y, sz)) return;
      s.began = true; emit("onBeforeChange");
      if (stroke !== s) return;   // pemanggil menghentikan sapuan
    }
    const r = tool === "brush" ? C.paintBiome(map, x, y, sz, brush.biome)
      : tool === "eraser" ? C.erase(map, x, y, sz)
        : C.sculpt(map, x, y, sz, (elev.mode === "lower" ? -1 : 1) * (0.05 + 0.3 * elev.strength));
    if (r) dataDirty = true;
  }
  function beginStroke(id, clientX, clientY) {
    if (!map || !Hc || !PAINT[tool]) return;
    const H = Hc.slice(), c = pickCell(clientX, clientY, H);
    if (!c) return;
    stroke = { id, cell: c, cur: c, began: false, lastDab: performance.now(), H };
    dabAt(c.x, c.y);
    cursorDirty = true;
  }
  // tapak kuas diinterpolasi sepanjang gerakan (jarak ≤ ukuran/2), sama dengan 2D
  function moveStroke(clientX, clientY) {
    const s = stroke, c = pickCell(clientX, clientY, s.H);
    if (!c) return;
    const step = Math.max(0.3, brushSize() / 2), d = Math.hypot(c.x - s.cell.x, c.y - s.cell.y), k = Math.floor(d / step);
    s.cur = c;
    if (k > 0) {
      const ux = (c.x - s.cell.x) / d, uy = (c.y - s.cell.y) / d;
      for (let j = 1; j <= k && stroke === s; j++) dabAt(s.cell.x + ux * step * j, s.cell.y + uy * step * j);
      s.cell = { x: s.cell.x + ux * step * k, y: s.cell.y + uy * step * k };
      s.lastDab = performance.now();
    }
    cursorDirty = true;
  }
  function endStroke() {
    const s = stroke;
    stroke = null;
    if (!s) return;
    if (dataDirty) { dataDirty = false; syncTerrain(); }
    if (s.began || decorDirty) {
      settleSnow();
      terrainMesh.geometry.computeBoundingSphere();
      rebuildDecor(true);
    }
    cursorDirty = true;
    requestRender();
    if (s.began) emit("onChange", "terrain");
  }
  function cancelStroke() {
    stroke = null; dataDirty = false;
    if (touchWait) { clearTimeout(touchWait.timer); touchWait = null; }
  }
  // pohon, puncak & dinding mengikuti medan: tiap ±300 ms saat menyapu, lengkap (+ sungai/jalan/label/pin) saat selesai
  function rebuildDecor(final) {
    decorDirty = false; lastDecor = performance.now();
    if (wallDirty) buildWalls();
    buildMountains(); buildTrees(terrain);
    if (final) {
      buildVectors();
      spriteCache.forEach((e) => { e.used = false; });
      buildLabels(); buildPins(); applyLayers();
    } else { renderer.shadowMap.needsUpdate = true; requestRender(); }
  }
  // dipanggil tiap frame: kuas udara ketinggian saat diam, pembaruan medan (dibatasi bila mahal), dekorasi tiap ±300 ms
  // (sebisa mungkin tidak di frame yang sama dengan pembaruan medan supaya satu frame tidak menanggung keduanya)
  function paintTick(now) {
    if (touchWait && touchWait.ready && !stroke) { const tw = touchWait; touchWait = null; beginStroke(tw.id, tw.x, tw.y); }   // 1 jari ditahan
    if (stroke && tool === "elevation" && now - stroke.lastDab > 70) { stroke.lastDab = now; dabAt(stroke.cur.x, stroke.cur.y); }
    let synced = false;
    if (dataDirty && map && Hc && (!stroke || now - lastSync >= syncCost * 1.5)) {
      dataDirty = false; lastSync = now; synced = true;
      if (syncTerrain()) { decorDirty = true; needsRender = true; cursorDirty = true; }
    }
    if (stroke && decorDirty && now - lastDecor > (synced ? 900 : 300)) rebuildDecor(false);
  }

  // ---------- pointer kuas (kiri = lukis; kanan/tengah/Shift diteruskan ke OrbitControls; sentuh: 1 jari lukis) ----------
  function onPaintDown(e) {
    if (!PAINT[tool] || !map || !Hc || disposed) return;
    if (e.pointerType === "touch") {
      touchIds.add(e.pointerId);
      if (touchIds.size > 1) { interruptForPinch(); return; }   // jari kedua: putar/zoom
      if (touchBusy || stroke) return;
      // tunggu sebentar: kalau jari kedua menyusul, ini putar/zoom (bukan sapuan kuas). Jeda diukur menurut waktu event:
      // bila event ini datang terlambat (main thread sibuk), jari kedua juga akan terlambat -> tunggu selama keterlambatan itu.
      // Sapuan baru dimulai di frame berikutnya (paintTick) supaya pointerdown jari kedua yang sudah antre diproses lebih dulu
      const id = e.pointerId, x = e.clientX, y = e.clientY, lag = clamp(performance.now() - e.timeStamp, 0, 5000) || 0;
      touchWait = { id, x, y, ready: false, timer: setTimeout(() => { if (touchWait && touchWait.id === id) touchWait.ready = true; }, 110 + lag) };
      return;   // tetap diteruskan: OrbitControls menghitung jari (1 jari = tanpa aksi)
    }
    if (e.button !== 0 || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || stroke) return;
    e.stopImmediatePropagation();
    try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* abaikan */ }
    hoverXY = { x: e.clientX, y: e.clientY };
    beginStroke(e.pointerId, e.clientX, e.clientY);
  }
  function onPaintMove(e) {
    if (e.pointerType === "touch") {
      if (touchWait && touchWait.id === e.pointerId && Math.hypot(e.clientX - touchWait.x, e.clientY - touchWait.y) > 8) {
        clearTimeout(touchWait.timer);
        const tw = touchWait;
        touchWait = null;
        beginStroke(tw.id, tw.x, tw.y);
      }
    } else {
      hoverXY = stroke || !e.buttons ? { x: e.clientX, y: e.clientY } : null;   // tombol lain ditekan = kamera diputar/digeser
      if (PAINT[tool]) cursorDirty = true;
    }
    if (stroke && stroke.id === e.pointerId) moveStroke(e.clientX, e.clientY);
  }
  function onPaintUp(e) {
    if (e.pointerType === "touch") {
      touchIds.delete(e.pointerId);
      if (touchWait && touchWait.id === e.pointerId) {   // ketukan singkat = satu tapak kuas
        clearTimeout(touchWait.timer);
        const tw = touchWait;
        touchWait = null;
        if (!touchBusy && e.type !== "pointercancel") { beginStroke(tw.id, tw.x, tw.y); endStroke(); }
      }
      if (!touchIds.size) { touchBusy = false; cursorDirty = true; }
    }
    if (stroke && stroke.id === e.pointerId) endStroke();
  }
  function onPaintLeave(e) { if (e.pointerType !== "touch" && !stroke) { hoverXY = null; cursorDirty = true; } }
  function interruptForPinch() {
    if (touchWait) { clearTimeout(touchWait.timer); touchWait = null; }
    if (stroke) endStroke();   // simpan yang sudah terjadi
    touchBusy = true; cursorDirty = true;
  }
  canvas.addEventListener("pointermove", onPaintMove);
  canvas.addEventListener("pointerup", onPaintUp);
  canvas.addEventListener("pointercancel", onPaintUp);
  canvas.addEventListener("pointerleave", onPaintLeave);
  // alat lukis: kanan = putar, tengah = geser (kiri + Shift/Ctrl = geser lewat OrbitControls); sentuh 2 jari = putar & zoom
  function applyControlMode() {
    const paint = !!PAINT[tool], mb = controls.mouseButtons, tc = controls.touches;
    mb.LEFT = THREE.MOUSE.ROTATE;
    mb.MIDDLE = paint ? THREE.MOUSE.PAN : THREE.MOUSE.DOLLY;
    mb.RIGHT = paint ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN;
    tc.ONE = paint ? null : THREE.TOUCH.ROTATE;
    tc.TWO = paint ? THREE.TOUCH.DOLLY_ROTATE : THREE.TOUCH.DOLLY_PAN;
  }

  // ---------- kursor kuas: cincin menempel medan (tebal tetap di layar), isi tipis warna bioma (kuas), tanda tengah ----------
  const RING = 128, FSEG = 48, FRING = 4;
  const cursorG = new THREE.Group();
  cursorG.visible = false;
  scene.add(cursorG);
  const overlayMat = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
  function overlayMesh(nv, ni, mat, order) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(nv * 3), 3).setUsage(THREE.DynamicDrawUsage));
    geo.setIndex(new THREE.BufferAttribute(new Uint16Array(ni), 1).setUsage(THREE.DynamicDrawUsage));
    const m = new THREE.Mesh(geo, mat);
    m.renderOrder = order; m.frustumCulled = false;
    cursorG.add(m);
    return m;
  }
  const ringDark = overlayMesh(RING * 2, RING * 6, overlayMat(0x000000, 0.4), 41);
  const ringLite = overlayMesh(RING * 2, RING * 6, overlayMat(0xffffff, 0.95), 42);
  const fillMesh = overlayMesh(1 + FRING * FSEG, FSEG * 3 + (FRING - 1) * FSEG * 6, overlayMat(0xffffff, 0.22), 40);
  {   // indeks cakram isi (tetap): kipas tengah + cincin-cincin
    const I = fillMesh.geometry.index.array;
    let c = 0;
    for (let s = 0; s < FSEG; s++) { I[c++] = 0; I[c++] = 1 + s; I[c++] = 1 + ((s + 1) % FSEG); }
    for (let r = 1; r < FRING; r++) for (let s = 0; s < FSEG; s++) {
      const a = 1 + (r - 1) * FSEG + s, b = 1 + (r - 1) * FSEG + ((s + 1) % FSEG), a2 = a + FSEG, b2 = b + FSEG;
      I[c++] = a; I[c++] = a2; I[c++] = b; I[c++] = b; I[c++] = a2; I[c++] = b2;
    }
  }
  const markTex = { dot: markTexture("dot"), plus: markTexture("plus"), minus: markTexture("minus") };
  const mark = new THREE.Sprite(new THREE.SpriteMaterial(Object.assign({ map: markTex.dot.tex, depthTest: false, depthWrite: false, sizeAttenuation: false }, PREMUL)));
  mark.renderOrder = 43;
  cursorG.add(mark);
  const _cp = new Float32Array(RING * 3), _cv = new THREE.Vector3();
  // pita kamera-menghadap sepanjang titik cincin _cp: tebal halfPx (px layar) di jarak berapa pun; dashN = jumlah putus-putus
  function setRibbon(mesh, halfPx, pxk, dashN) {
    const pos = mesh.geometry.getAttribute("position"), A = pos.array, idx = mesh.geometry.index, I = idx.array, cam = camera.position;
    for (let i = 0; i < RING; i++) {
      const p = i * 3, a = ((i + RING - 1) % RING) * 3, b = ((i + 1) % RING) * 3;
      const x = _cp[p], y = _cp[p + 1], z = _cp[p + 2], tx = _cp[b] - _cp[a], ty = _cp[b + 1] - _cp[a + 1], tz = _cp[b + 2] - _cp[a + 2];
      const vx = x - cam.x, vy = y - cam.y, vz = z - cam.z;
      let sx = ty * vz - tz * vy, sy = tz * vx - tx * vz, sz = tx * vy - ty * vx;
      const k = (halfPx * pxk * Math.hypot(vx, vy, vz)) / (Math.hypot(sx, sy, sz) || 1);
      sx *= k; sy *= k; sz *= k;
      A[i * 6] = x + sx; A[i * 6 + 1] = y + sy; A[i * 6 + 2] = z + sz;
      A[i * 6 + 3] = x - sx; A[i * 6 + 4] = y - sy; A[i * 6 + 5] = z - sz;
    }
    pos.needsUpdate = true;
    let c = 0;
    for (let i = 0; i < RING; i++) {
      if (dashN && ((i * dashN * 2) / RING | 0) % 2) continue;
      const a = i * 2, b = ((i + 1) % RING) * 2;
      I[c++] = a; I[c++] = a + 1; I[c++] = b; I[c++] = a + 1; I[c++] = b + 1; I[c++] = b;
    }
    mesh.geometry.setDrawRange(0, c);
    idx.needsUpdate = true;
  }
  function updateCursor() {
    cursorDirty = false;
    let c = null;
    if (PAINT[tool] && map && Hc && active && !orbiting && !touchBusy) c = stroke ? stroke.cur : hoverXY ? pickCell(hoverXY.x, hoverXY.y, Hc) : null;
    const inside = !!c && c.x >= 0 && c.y >= 0 && c.x <= size && c.y <= size;
    if (PAINT[tool]) { const cur = inside || stroke ? "none" : ""; if (canvas.style.cursor !== cur) canvas.style.cursor = cur; }
    if (!inside) { if (cursorG.visible) { cursorG.visible = false; needsRender = true; } return; }
    const half = size / 2, r = brushSize(), yAt = (x, y) => Math.max(0, sampleH(x, y)) + 0.05;
    for (let i = 0; i < RING; i++) {
      const a = (i / RING) * TAU, x = c.x + Math.cos(a) * r, y = c.y + Math.sin(a) * r;
      _cp[i * 3] = x - half; _cp[i * 3 + 1] = yAt(x, y); _cp[i * 3 + 2] = y - half;
    }
    const pxk = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / height;
    _cv.set(c.x - half, yAt(c.x, c.y), c.y - half);
    // penghapus: garis putih putus-putus ±9 px per periode (seperti 2D)
    const dashN = tool === "eraser" ? clamp(Math.round((TAU * r) / (camera.position.distanceTo(_cv) * pxk) / 9), 6, RING / 2) : 0;
    setRibbon(ringDark, 1.5, pxk, 0);
    setRibbon(ringLite, 0.75, pxk, dashN);
    fillMesh.visible = tool === "brush";
    if (fillMesh.visible) {
      const A = fillMesh.geometry.getAttribute("position").array;
      A[0] = _cv.x; A[1] = _cv.y; A[2] = _cv.z;
      for (let k = 1; k <= FRING; k++) for (let s = 0; s < FSEG; s++) {
        const a = (s / FSEG) * TAU, rr = (r * k) / FRING, x = c.x + Math.cos(a) * rr, y = c.y + Math.sin(a) * rr, o = (1 + (k - 1) * FSEG + s) * 3;
        A[o] = x - half; A[o + 1] = yAt(x, y); A[o + 2] = y - half;
      }
      fillMesh.geometry.getAttribute("position").needsUpdate = true;
      fillMesh.material.color.set((BIOMES[brush.biome] || BIOMES[1]).color);
    }
    const mt = tool === "elevation" ? (elev.mode === "lower" ? markTex.minus : markTex.plus) : markTex.dot;
    if (mark.material.map !== mt.tex) { mark.material.map = mt.tex; mark.material.needsUpdate = true; }
    mark.position.copy(_cv);
    mark.scale.set(mt.w * pxk, mt.h * pxk, 1);
    cursorG.visible = true;
    needsRender = true;
  }

  // ---------- util ----------
  function swapGeometry(mesh, geo) { if (mesh.geometry) mesh.geometry.dispose(); mesh.geometry = geo; }
  function clearGroup(g) {
    for (let i = g.children.length - 1; i >= 0; i--) {
      const o = g.children[i];
      g.remove(o);
      if (o.isInstancedMesh) { o.dispose(); if (o.userData.ownGeo) o.geometry.dispose(); }   // material pohon dipakai bersama
      else if (o.isSprite) { if (o.material) o.material.dispose(); }   // tekstur ada di spriteCache
      else {
        if (o.geometry) o.geometry.dispose();
        if (o.material && o.material.map && o.material.isMeshBasicMaterial) o.material.dispose();   // material label (tekstur di cache)
      }
    }
  }

  function setMap(m) {
    if (disposed) return;
    const key = m ? m.id + "|" + m.size : "";
    if (key !== mapKey) { fitted = false; selPlace = prioPlace = null; }
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
  // opsional (di luar kontrak dasar): sorot pin tempat terpilih; jenis lain / null = tanpa sorotan
  function setSelection(sel) {
    if (disposed) return;
    const id = sel && sel.type === "place" ? sel.id : null;
    if (id === selPlace) return;
    selPlace = id;
    pins.forEach((p) => {
      const tex = pinTex(p.icon, p.id === selPlace).tex;
      if (p.pin.material.map !== tex) { p.pin.material.map = tex; p.pin.material.needsUpdate = true; }
    });
    layoutDirty = true;
    requestRender();
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
    canvas.removeEventListener("pointerdown", onPaintDown);
    canvas.removeEventListener("pointermove", onPaintMove);
    canvas.removeEventListener("pointerup", onPaintUp);
    canvas.removeEventListener("pointercancel", onPaintUp);
    canvas.removeEventListener("pointerleave", onPaintLeave);
    cursorG.children.forEach((o) => { if (o.geometry) o.geometry.dispose(); o.material.dispose(); });
    Object.values(markTex).forEach((t) => t.tex.dispose());
    if (warmG) { warmG.children.forEach((o) => o.dispose()); warmG = null; }
    controls.dispose();
    clearAll();
    [terrainMesh, wallMesh, waterWallMesh, bottomMesh, dropShadow].forEach((m) => m.geometry.dispose());
    waterGeo.dispose();
    if (surfTex) surfTex.dispose();
    if (depthTex) depthTex.dispose();
    if (dwTex) dwTex.dispose();
    surfData = depthData = dwData = colTex = colPlain = null; stage = null;
    fieldCache = null;
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

  // ---------- alat kuas (tambahan kontrak; nilai sama dengan editor 2D) ----------
  function setTool(t) {
    const nt = PAINT[t] ? t : "select";   // alat lain = mode lihat (putar kamera, klik pin)
    if (disposed || nt === tool) return;
    if (stroke) endStroke();
    cancelStroke();
    const swap = !PAINT[tool] !== !PAINT[nt];
    tool = nt;
    applyControlMode();
    if (swap && autoPose && fitted && map) resetCamera(false);   // kamera belum disentuh: pindah ke pose lukis / lihat
    canvas.style.cursor = "";
    cursorDirty = true; requestRender();
  }
  function setBrush(b) {
    if (!b) return;
    if (b.biome != null) {
      const i = typeof b.biome === "string" ? BIOMES.findIndex((x) => x.key === b.biome) : Number(b.biome);
      if (i >= 0 && i < BIOMES.length) brush.biome = i;
    }
    if (b.size != null) brush.size = clamp(Number(b.size) || 1, 1, 20);
    cursorDirty = true;
  }
  function setElevation(o) {
    if (!o) return;
    if (o.mode === "raise" || o.mode === "lower") elev.mode = o.mode;
    if (o.strength != null) elev.strength = clamp01(Number(o.strength) || 0);
    if (o.size != null) elev.size = clamp(Number(o.size) || 1, 1, 20);
    cursorDirty = true;
  }

  return {
    setMap, refresh: () => refresh(), setLayers, resetCamera: () => resetCamera(false), zoomBy,
    resize, setActive, dispose, setSelection, setTool, setBrush, setElevation, setFitInsets,
  };
}

// label decal: kedalaman digeser LABEL_BIAS unit ke arah kamera di sepanjang garis pandang (posisi layar tetap),
// jadi teks tetap menempel tanah tapi tidak tertutup pohon/puncak di dekatnya; bukit yang jauh di depan tetap menutupinya
const LABEL_BIAS = 6;
function labelDepthBias(sh) {
  sh.vertexShader = sh.vertexShader.replace("#include <project_vertex>", [
    "#include <project_vertex>",
    "\t{",
    `\t\tvec4 mvB = vec4(mvPosition.xyz + normalize(-mvPosition.xyz) * ${LABEL_BIAS.toFixed(1)}, 1.0);`,
    "\t\tvec4 clipB = projectionMatrix * mvB;",
    "\t\tgl_Position.z = clipB.z / clipB.w * gl_Position.w;",
    "\t}",
  ].join("\n"));
}

// alfa premultiplied (tekstur kanvas di-upload premultiplied) -> tepi teks/pin tanpa pinggiran gelap
const PREMUL = { transparent: true, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor };

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

  // permukaan: tekstur bergaya 2D (diisi saat medan dibangun) x warna vertex (oklusi); layer daratan mati = warna polos
  const terrainMat = keep(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0 }));
  // detail halus saat dekat: tekstur ubin 4 kanal (rumput, pasir, batu, salju) x bobot per vertex (uDW, diisi buildGround);
  // mipmap meratakan detail saat jauh (nilai tengah 0.5 = tanpa perubahan)
  const detail = keep(new THREE.DataTexture(detailData(hash2), DETAIL_S, DETAIL_S, THREE.RGBAFormat, THREE.UnsignedByteType));
  detail.wrapS = detail.wrapT = THREE.RepeatWrapping;
  detail.magFilter = THREE.LinearFilter; detail.minFilter = THREE.LinearMipmapLinearFilter;
  detail.generateMipmaps = true; detail.anisotropy = maxAniso; detail.needsUpdate = true;
  const terrainUniforms = { uDetail: { value: detail }, uDW: { value: null }, uDRep: { value: 80 } };
  terrainMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, terrainUniforms);
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec2 vTUv;\nvarying vec2 vRock;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\n\tvTUv = uv;\n\tvRock = vec2(position.y, 1.0 - normal.y);");
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nuniform sampler2D uDetail, uDW;\nuniform float uDRep;\nvarying vec2 vTUv;\nvarying vec2 vRock;")
      .replace("#include <map_fragment>", [
        // tekstur permukaan dipertajam (unsharp mask) hanya saat diperbesar: garis ladang/retakan tetap tegas dari dekat
        "#ifdef USE_MAP",
        "\tvec4 sampledDiffuseColor = texture2D(map, vMapUv);",
        "\tvec2 tsz = vec2(textureSize(map, 0)), tx = 1.0 / tsz;",
        "\tvec2 fw = fwidth(vMapUv * tsz);",
        "\tfloat mag = clamp((1.0 - max(fw.x, fw.y)) * 1.6, 0.0, 1.0);",
        "\tif (mag > 0.0) {",
        "\t\tvec3 bl = (texture2D(map, vMapUv + vec2(tx.x, 0.0)).rgb + texture2D(map, vMapUv - vec2(tx.x, 0.0)).rgb",
        "\t\t\t+ texture2D(map, vMapUv + vec2(0.0, tx.y)).rgb + texture2D(map, vMapUv - vec2(0.0, tx.y)).rgb) * 0.25;",
        "\t\tsampledDiffuseColor.rgb = max(sampledDiffuseColor.rgb + (sampledDiffuseColor.rgb - bl) * (0.6 * mag), 0.0);",
        "\t}",
        "\tdiffuseColor *= sampledDiffuseColor;",
        "#endif",
        "\tvec4 dT = texture2D(uDetail, vTUv * uDRep) * 2.0 - 1.0, dW = texture2D(uDW, vTUv);",
        "\tdiffuseColor.rgb *= 1.0 + dot(dW, dT) * 0.42;",
        // tebing batu berlapis: pita & garis lapisan mendatar menurut tinggi dunia, hanya di lereng curam berbatu
        "\tfloat rk = smoothstep(0.18, 0.45, vRock.y) * clamp(dW.b * 2.2, 0.0, 1.0) * (1.0 - dW.a);",
        "\tif (rk > 0.0) {",
        "\t\tfloat sv = vRock.x * 0.95 + dT.b * 0.22, fr = fract(sv);",
        "\t\tfloat ln = 1.0 - smoothstep(0.03, 0.1, min(fr, 1.0 - fr));",
        "\t\tdiffuseColor.rgb *= 1.0 + rk * (sin(sv * 6.2832) * 0.06 - ln * 0.2);",
        "\t}",
      ].join("\n"));
  };
  const plainMat = keep(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0 }));
  const wallMat = keep(new THREE.MeshStandardMaterial({ map: strata, vertexColors: true, roughness: 0.96, metalness: 0 }));
  // air: warna & alfa per kedalaman (dangkal kehijauan, dalam biru), buih & riak tipis di garis pantai;
  // kedalaman dibaca per piksel dari peta kedalaman (grid medan) sehingga garis buih tajam mengikuti pantai
  const waterUniforms = { uDepth: { value: null }, uGrid: { value: new THREE.Vector3(64, 2, 257) } };
  const waterMat = keep(new THREE.MeshStandardMaterial({ transparent: true, depthWrite: false, map: waterTex,
    normalMap: waterNormal, normalScale: new THREE.Vector2(0.22, 0.22), roughness: 0.32, metalness: 0 }));
  waterMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, waterUniforms);
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nuniform vec3 uGrid;\nvarying vec2 vDUv;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\n\tvDUv = (((modelMatrix * vec4(position, 1.0)).xz + uGrid.x) * uGrid.y + 0.5) / uGrid.z;");
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nuniform sampler2D uDepth;\nvarying vec2 vDUv;")
      .replace("#include <color_fragment>", [
        "#include <color_fragment>",
        "\tvec2 wd = texture2D(uDepth, vDUv).rg;",
        `\tfloat dep = wd.r * ${DEPTH_K.toFixed(1)} - 1.0, dist = wd.g * ${SHORE_K.toFixed(1)} - 1.0;`,
        "\tif (dep < -0.05) discard;",
        // bercak awan (0.86..1) menggoyang tepi cincin dangkal & buih supaya tidak seperti garis kontur
        "\tfloat wob = texture2D(map, vMapUv * 2.7 + 0.31).r - 0.93;",
        "\tfloat tD = smoothstep(0.5, 4.2, dist + wob * 9.0);",
        `\tdiffuseColor.rgb *= mix(${glsl("#b3dfea")}, ${glsl("#7db7cf")}, tD);`,   // air terang ala ilustrasi (sama dengan 2D)
        "\tdiffuseColor.a *= mix(0.9, 0.97, tD);",
        // buih putih lembut menempel pantai + riak tipis sejajar pantai (seperti 2D)
        "\tfloat foam = 1.0 - smoothstep(0.1, 1.25 + wob * 7.0, dist);",
        "\tfloat rip = (1.0 - smoothstep(0.0, 0.07, abs(dist - 2.1 - wob * 4.0))) * 0.08;",
        `\tdiffuseColor.rgb = mix(diffuseColor.rgb, ${glsl("#e9f6f6")}, max(foam * foam * 0.95, rip));`,
        "\tdiffuseColor.a = mix(diffuseColor.a, 0.98, foam);",
        // garis tinta biru tua tegas tepat di garis pantai (pulau seperti potongan ilustrasi)
        "\tfloat coast = 1.0 - smoothstep(0.12, 0.28, dist);",
        `\tdiffuseColor.rgb = mix(diffuseColor.rgb, ${glsl("#263a4c")}, coast * 0.95);`,
        "\tdiffuseColor.a = mix(diffuseColor.a, 1.0, coast);",
      ].join("\n"));
  };
  const waterWallMat = keep(new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, depthWrite: false, roughness: 0.4, metalness: 0 }));
  // sisi dalam dinding air (terlihat menembus air dari atas) diwarnai seperti dasar laut dalam, bukan latar belakang
  const skirtMat = keep(new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(FLOOR_DEEP[0] * 0.78, FLOOR_DEEP[1] * 0.82, FLOOR_DEEP[2] * 0.85), side: THREE.BackSide }));
  const bottomMat = keep(new THREE.MeshStandardMaterial({ color: 0x46321f, roughness: 1, metalness: 0 }));
  const dropMat = keep(new THREE.MeshBasicMaterial({ map: drop, transparent: true, depthWrite: false }));
  // pohon: papan (billboard) bergambar ilustrasi 2D (map-trees.js, atlas: baris = jenis, kolom = varian) yang selalu
  // menghadap kamera — berputar mengikuti arah pandang & sedikit condong ke kamera saat dilihat dari atas. Tanpa cahaya
  // (warna gambar apa adanya, seperti 2D); bayangan = siluet gambar yang menghadap matahari (materi kedalaman sendiri).
  const TR = window.NovelMapTrees, AT = TR.atlas(96);
  const atlasTex = keep(new THREE.CanvasTexture(AT.canvas));
  atlasTex.colorSpace = THREE.SRGBColorSpace; atlasTex.anisotropy = maxAniso;
  const cellU = { value: new THREE.Vector2(1 / AT.cols, 1 / AT.rows) };
  const BB = [
    "vec4 bbC = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);",
    "float bbS = length(instanceMatrix[0].xyz), bbSY = length(instanceMatrix[1].xyz);",
    "vec3 bbF = normalize(cameraPosition - bbC.xyz);",
    "vec3 bbR = cross(vec3(0.0, 1.0, 0.0), bbF);",
    "bbR = dot(bbR, bbR) > 1e-6 ? normalize(bbR) : vec3(1.0, 0.0, 0.0);",
    "vec3 bbU = normalize(mix(vec3(0.0, 1.0, 0.0), cross(bbF, bbR), 0.35));",   // tegak, condong 35% ke kamera
    "vec4 mvPosition = viewMatrix * vec4(bbC.xyz + bbR * (transformed.x * bbS) + bbU * (transformed.y * bbSY), 1.0);",
    "gl_Position = projectionMatrix * mvPosition;",
  ].join("\n\t");
  const billboard = (sh) => {
    sh.uniforms.uCell = cellU;
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nattribute vec2 aCell;\nuniform vec2 uCell;")
      .replace("#include <uv_vertex>", "#include <uv_vertex>\n#ifdef USE_MAP\n\tvMapUv = (aCell + uv) * uCell;\n#endif")
      .replace("#include <project_vertex>", "\t" + BB);
  };
  const treeMat = keep(new THREE.MeshBasicMaterial({ map: atlasTex, alphaTest: 0.5, side: THREE.DoubleSide }));
  treeMat.onBeforeCompile = billboard;
  const treeDepthMat = keep(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: atlasTex, alphaTest: 0.5, side: THREE.DoubleSide }));
  treeDepthMat.onBeforeCompile = billboard;
  // geometri papan per jenis: kaki di y = 0, uv = bagian sel atlas yang berisi gambar (sel ditambah offset per instance)
  const trees = {};
  TR.KINDS.forEach((k) => {
    const I = AT.info[k], geo = new THREE.PlaneGeometry(I.w, I.h);
    geo.translate(0, I.h / 2 - I.y0, 0);
    const uv = geo.getAttribute("uv");
    for (let i = 0; i < uv.count; i++) uv.setXY(i, I.u0 + uv.getX(i) * (I.u1 - I.u0), I.v0 + uv.getY(i) * (I.v1 - I.v0));
    keep(geo);
    trees[k] = { geo, row: AT.rows - 1 - I.row };   // tekstur flipY: baris dihitung dari bawah
  });
  const ribbon = (extra) => keep(new THREE.MeshStandardMaterial(Object.assign({ vertexColors: true, metalness: 0,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }, extra)));
  const riverMat = ribbon({ roughness: 0.3, emissive: 0x15324a, emissiveIntensity: 0.6 });
  const pathMat = ribbon({ roughness: 0.95 });
  const zoneMat = ribbon({ roughness: 0.7, emissive: 0xffffff, emissiveIntensity: 0, transparent: true, opacity: 0.92 });
  zoneMat.onBeforeCompile = (sh) => {   // garis wilayah sedikit menyala agar warnanya tetap jelas di medan gelap
    sh.fragmentShader = sh.fragmentShader.replace("#include <emissivemap_fragment>",
      "#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += diffuseColor.rgb * 0.35;");
  };

  return {
    terrainMat, terrainUniforms, plainMat, wallMat, waterMat, waterWallMat, skirtMat, bottomMat, dropMat, treeMat, treeDepthMat,
    riverMat, pathMat, zoneMat, trees, waterTex, waterNormal, waterUniforms,
    dispose() { disposables.forEach((o) => o.dispose()); },
  };
}

// lapisan tanah bergelombang tebal (berulang mulus ke samping). v=0 -> BASE_Y, v=1 -> STRATA_TOP
function strataCanvas() {
  const W = 1024, H = 1024, span = STRATA_TOP - BASE_Y;
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const g = cv.getContext("2d");
  let s = 1234567;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const py = (y) => H - ((y - BASE_Y) / span) * H;
  // pita terang/gelap selang-seling (warna akhir di layar ≈ referensi setelah pencahayaan)
  const tones = ["#a98e79", "#bea483", "#9f856c", "#d7bb92", "#b49575", "#cbab86", "#a68b74", "#c4a882"];
  g.fillStyle = "#4d3e33"; g.fillRect(0, 0, W, H);
  let y = BASE_Y + 0.4, ti = 0;
  while (y < STRATA_TOP + 1) {
    const A = 0.35 + rnd() * 0.2, c1 = 1 + Math.floor(rnd() * 2), c2 = 3 + Math.floor(rnd() * 3), f1 = rnd() * 6.28, f2 = rnd() * 6.28;
    g.fillStyle = tones[ti++ % tones.length];
    g.beginPath();
    for (let u = 0; u <= W; u += 8) {
      const a = (u / W) * Math.PI * 2;
      const yy = y + A * Math.sin(a * c1 + f1) + A * 0.4 * Math.sin(a * c2 + f2);
      if (u === 0) g.moveTo(u, py(yy)); else g.lineTo(u, py(yy));
    }
    g.lineTo(W, 0); g.lineTo(0, 0); g.closePath(); g.fill();
    y += 1.55 + rnd() * 0.45;
  }
  // butiran halus
  for (let i = 0; i < 14000; i++) {
    g.fillStyle = rnd() < 0.5 ? "rgba(40,26,14,0.09)" : "rgba(255,240,215,0.06)";
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
// tekstur detail ubin (DETAIL_S², mulus saat diulang): R rumput (bintik terang/gelap), G pasir (riak), B batu (butir + guratan),
// A salju (awan lembut + kilau). Nilai 128 = netral.
const DETAIL_S = 128, DETAIL_CELLS = 1.6;   // ukuran ubin (px) & lebar ubin di peta (sel)
function detailData(hash2) {
  const S = DETAIL_S, out = new Uint8Array(S * S * 4), q = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S, o = (y * S + x) * 4;
    // rumput: bintik bulat ±1.3 px per blok 4x4 + belang halus
    const bx = x >> 2, by = y >> 2, cx = bx * 4 + 1 + hash2(bx, by, 41) * 2, cy = by * 4 + 1 + hash2(bx, by, 42) * 2;
    let gv = 0.5 + (pfbm(u * 8, v * 8, 8, 43, 3, hash2) - 0.5) * 0.3;
    if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) < 1.3) gv += hash2(bx, by, 44) > 0.45 ? 0.2 : -0.26;
    // pasir: riak bergelombang + butir
    const sv = 0.5 + Math.sin(TAU * (u * 6 + (pfbm(u * 3, v * 3, 3, 45, 2, hash2) - 0.5) * 1.6 + v * 1)) * 0.14 + (hash2(x, y, 46) - 0.5) * 0.1;
    // batu: belang berlapis + guratan gelap (punggung noise)
    const rn = pfbm(u * 6, v * 6, 6, 47, 4, hash2), ridge = 1 - Math.abs(pfbm(u * 4, v * 4, 4, 48, 3, hash2) * 2 - 1);
    const rv = 0.5 + (rn - 0.5) * 0.55 - Math.max(0, ridge - 0.86) * 2.2 + (hash2(x, y, 49) - 0.5) * 0.08;
    // salju: awan lembut + kilau
    const nv = 0.5 + (pfbm(u * 4, v * 4, 4, 50, 3, hash2) - 0.5) * 0.36 + (hash2(x, y, 51) > 0.985 ? 0.2 : 0);
    out[o] = q(gv); out[o + 1] = q(sv); out[o + 2] = q(rv); out[o + 3] = q(nv);
  }
  return out;
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
function canvasTexture(cv, mip) {
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.premultiplyAlpha = true;
  tex.generateMipmaps = !!mip;
  tex.minFilter = mip ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  if (mip) tex.anisotropy = 8;
  return tex;
}
function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.arcTo(x + w, y, x + w, y + r, r); g.lineTo(x + w, y + h - r);
  g.arcTo(x + w, y + h, x + w - r, y + h, r); g.lineTo(x + r, y + h); g.arcTo(x, y + h, x, y + h - r, r);
  g.lineTo(x, y + r); g.arcTo(x, y, x + r, y, r); g.closePath();
}
// ikon tempat (koordinat lokal -1..1, warna tinta) — sama dengan map2d.js
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
// pin tetes: kepala lingkaran krem bergaris tinta + ikon tinta (gaya 2D), ekor krem lebih gelap; jangkar = ujung bawah.
// Dimensi dalam px CSS; kanvas digambar 2x agar tajam.
function makePinTexture(icon, selected) {
  const S = 2, { M, W: PW, H: PH, R } = PIN, w = PW + M * 2, h = PH + M * 2;
  const cv = document.createElement("canvas"); cv.width = w * S; cv.height = h * S;
  const g = cv.getContext("2d");
  g.scale(S, S);
  const cx = M + PW / 2, cy = M + R + 1, tipY = M + PH;
  if (selected) {   // sorotan seperti 2D (cincin aksen)
    g.beginPath(); g.arc(cx, cy, R + 4.5, 0, TAU);
    g.fillStyle = "rgba(215,168,110,0.38)"; g.fill(); g.lineWidth = 2; g.strokeStyle = ACCENT; g.stroke();
  }
  const d = tipY - cy, a = Math.acos(R / d);
  g.save();
  g.shadowColor = "rgba(0,0,0,0.45)"; g.shadowBlur = 4; g.shadowOffsetY = 1;
  g.beginPath(); g.moveTo(cx, tipY); g.arc(cx, cy, R, Math.PI / 2 - a, Math.PI / 2 + a, true); g.closePath();
  g.fillStyle = "#ddd0b2"; g.fill();
  g.restore();
  g.lineWidth = 1.5; g.lineJoin = "round"; g.strokeStyle = INK; g.stroke();
  g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.fillStyle = CREAM; g.fill(); g.stroke();
  g.save();
  g.translate(cx, cy); g.scale(R * 0.58, R * 0.58);
  g.fillStyle = INK; g.strokeStyle = INK;
  (ICONS[icon] || ICONS.landmark)(g);
  g.restore();
  return { tex: canvasTexture(cv, false), w, h, cx: cx / w, cy: M / h };
}
// tanda tengah kursor kuas (seperti 2D): titik (kuas/penghapus), + / − (ketinggian); putih berhalo gelap, px CSS digambar 2x
function markTexture(kind) {
  const S = 2, D = 16, cv = document.createElement("canvas");
  cv.width = cv.height = D * S;
  const g = cv.getContext("2d");
  g.scale(S, S); g.translate(D / 2, D / 2);
  g.lineCap = "round";
  if (kind === "dot") {
    g.beginPath(); g.arc(0, 0, 2.2, 0, TAU); g.fillStyle = "#fff"; g.fill();
    g.lineWidth = 1; g.strokeStyle = "rgba(0,0,0,0.45)"; g.stroke();
  } else {
    const path = () => { g.beginPath(); g.moveTo(-5, 0); g.lineTo(5, 0); if (kind === "plus") { g.moveTo(0, -5); g.lineTo(0, 5); } };
    path(); g.lineWidth = 3.6; g.strokeStyle = "rgba(0,0,0,0.4)"; g.stroke();
    path(); g.lineWidth = 1.6; g.strokeStyle = "#fff"; g.stroke();
  }
  return { tex: canvasTexture(cv, false), w: D, h: D };
}
// pil nama krem bertinta (posisi kiri/kanan pin diatur lewat sprite.center)
function makeNameTexture(name) {
  const S = 2, m = PIN.PM, FS = 12, PH = PIN.PILL_H, PAD = 8;
  if (name.length > 32) name = name.slice(0, 31) + "…";
  const font = `600 ${FS}px ${SANS}`;
  const meas = document.createElement("canvas").getContext("2d");
  meas.font = font;
  const pillW = Math.ceil(meas.measureText(name).width) + PAD * 2, w = pillW + m * 2, h = PH + m * 2;
  const cv = document.createElement("canvas"); cv.width = w * S; cv.height = h * S;
  const g = cv.getContext("2d");
  g.scale(S, S);
  g.save();
  g.shadowColor = "rgba(0,0,0,0.35)"; g.shadowBlur = 3; g.shadowOffsetY = 1;
  roundRect(g, m, m, pillW, PH, PH / 2); g.fillStyle = "rgba(247,241,225,0.95)"; g.fill();
  g.restore();
  g.lineWidth = 1; g.strokeStyle = "rgba(43,33,24,0.5)"; roundRect(g, m + 0.5, m + 0.5, pillW - 1, PH - 1, (PH - 1) / 2); g.stroke();
  g.fillStyle = "#1f1a14"; g.font = font; g.textBaseline = "middle";
  g.fillText(name, m + PAD, m + PH / 2 + 0.5);
  return { tex: canvasTexture(cv, false), w, h, pillW };
}
// tekstur label peta (gaya sama dengan labelLook map2d.js): region = serif kapital berjarak, water = serif miring biru tua,
// small = serif kecil tinta; semuanya ber-halo terang
function makeLabelTexture(text, style) {
  const FS = 96;
  const L = style === "water" ? { font: `italic 500 ${FS}px ${SERIF}`, sp: FS * 0.08, fill: "#173550", halo: "rgba(196,220,236,0.45)" }
    : style === "small" ? { font: `500 ${FS}px ${SERIF}`, sp: 0, fill: "#2b2118", halo: "rgba(244,236,214,0.8)" }
    : { font: `600 ${FS}px ${SERIF}`, sp: FS * 0.28, fill: "#3a2c1d", halo: "rgba(244,236,214,0.72)" };
  const str = style === "region" ? text.toUpperCase() : text;
  const meas = document.createElement("canvas").getContext("2d");
  meas.font = L.font;
  const chars = Array.from(str.length > 60 ? str.slice(0, 59) + "…" : str), widths = chars.map((ch) => meas.measureText(ch).width);
  const tw = widths.reduce((s, x) => s + x, 0) + L.sp * Math.max(0, chars.length - 1), pad = FS * 0.3;
  const k = Math.min(1, 2040 / (tw + pad * 2));       // kanvas maks ±2048 px (aman untuk GPU HP)
  const w = Math.ceil((tw + pad * 2) * k), h = Math.ceil(FS * 1.5 * k);
  const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
  const g = cv.getContext("2d");
  g.scale(k, k);
  g.font = L.font; g.textBaseline = "middle"; g.lineJoin = "round";
  g.lineWidth = FS * 0.2; g.strokeStyle = L.halo; g.fillStyle = L.fill;
  ["stroke", "fill"].forEach((mode) => {
    let x = pad;
    chars.forEach((ch, i) => {
      if (mode === "stroke") g.strokeText(ch, x, h / 2 / k); else g.fillText(ch, x, h / 2 / k);
      x += widths[i] + L.sp;
    });
  });
  return { tex: canvasTexture(cv, true), w, h, fs: FS * k };
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
  return { setMap: noop, refresh: noop, setLayers: noop, resetCamera: noop, zoomBy: noop, resize: noop, setActive: noop, setSelection: noop,
    setTool: noop, setBrush: noop, setElevation: noop, setFitInsets: noop,
    dispose() { box.remove(); container.style.position = prevPos; } };
}
