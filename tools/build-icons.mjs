// tools/build-icons.mjs — membuat vendor/tabler-icons.js: subset Tabler Icons (tabler.io/icons, MIT) yang DIPAKAI saja.
//
// Cara kerja: memindai semua *.html & *.js di root repo, mengumpulkan nama ikon dari dua pola:
//   1. "#ti-NAMA"          -> markup HTML:  <svg class="ti"><use href="#ti-home"></use></svg>
//   2. tiIcon("NAMA" ...)  -> helper JS:    el.innerHTML = tiIcon("trash") + " Hapus";
// Nama berakhiran "-filled" memakai versi filled (mis. "#ti-star-filled"); selain itu versi outline.
// Nama yang dibentuk dinamis (mis. tiIcon(cond ? "a" : "b")) tetap terdeteksi selama string-nya tertulis lengkap
// di dalam tiIcon(...) — kalau benar-benar dirakit dari potongan string, tulis komentar "#ti-NAMA" di dekatnya.
// Nama yang tidak ada di Tabler -> build gagal dengan daftar namanya (supaya tidak ada ikon kosong diam-diam).
//
// Jalankan: cd tools && npm run build:icons   (ikut dijalankan oleh npm run build)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const pkgDir = path.join(here, "node_modules/@tabler/icons");
const version = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8")).version;

const sources = fs.readdirSync(root).filter((f) => /\.(html|js)$/.test(f) && f !== "login-art-data.js");
const names = new Set();
const patterns = [/#ti-([a-z0-9]+(?:-[a-z0-9]+)*)/g, /\btiIcon\(\s*["'`]([a-z0-9]+(?:-[a-z0-9]+)*)["'`]/g];
for (const f of sources) {
  const text = fs.readFileSync(path.join(root, f), "utf8");
  for (const re of patterns) for (const m of text.matchAll(re)) names.add(m[1]);
  // pola ternary/array di dalam tiIcon(...): tiIcon(x ? "a" : "b")
  for (const m of text.matchAll(/\btiIcon\(([^)]*)\)/g)) {
    for (const s of m[1].matchAll(/["'`]([a-z0-9]+(?:-[a-z0-9]+)*)["'`]/g)) names.add(s[1]);
  }
}

const missing = [];
const symbols = [];
for (const name of [...names].sort()) {
  const filled = name.endsWith("-filled");
  const file = filled
    ? path.join(pkgDir, "icons/filled", name.slice(0, -"-filled".length) + ".svg")
    : path.join(pkgDir, "icons/outline", name + ".svg");
  if (!fs.existsSync(file)) { missing.push(name); continue; }
  const svg = fs.readFileSync(file, "utf8");
  const inner = svg
    .replace(/^[\s\S]*?<svg[^>]*>/, "")
    .replace(/<\/svg>\s*$/, "")
    .replace(/<path stroke="none" d="M0 0h24v24H0z" fill="none"\s*\/>/, "")
    .replace(/\s*\n\s*/g, "")
    .trim();
  // outline: atribut stroke diwarisi dari CSS .ti (ketebalan bisa diatur lewat --ti-stroke); filled: isi currentColor.
  const attrs = filled ? ' fill="currentColor" stroke="none"' : "";
  symbols.push(`<symbol id="ti-${name}" viewBox="0 0 24 24"${attrs}>${inner}</symbol>`);
}
if (missing.length) {
  console.error("Ikon tidak ditemukan di Tabler Icons " + version + ": " + missing.join(", "));
  console.error("Cari nama yang benar di https://tabler.io/icons");
  process.exit(1);
}

const sprite = `<svg xmlns="http://www.w3.org/2000/svg" style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true" focusable="false">${symbols.join("")}</svg>`;
const out = `/* Tabler Icons ${version} (https://tabler.io/icons, MIT, lihat vendor/LICENSE-tabler-icons) — subset ${symbols.length} ikon.
   DIHASILKAN OTOMATIS oleh tools/build-icons.mjs, jangan diedit manual. Tambah ikon: pakai "#ti-NAMA" / tiIcon("NAMA")
   di kode, lalu jalankan: cd tools && npm run build:icons
   Pakai di HTML: <svg class="ti"><use href="#ti-home"></use></svg>   |   di JS: tiIcon("home", "kelas-tambahan") */
(function () {
  "use strict";
  var SPRITE = ${JSON.stringify(sprite)};
  function inject() {
    if (document.getElementById("tabler-sprite")) return;
    var host = document.createElement("div");
    host.id = "tabler-sprite";
    host.setAttribute("aria-hidden", "true");
    host.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
    host.innerHTML = SPRITE;
    document.body.insertBefore(host, document.body.firstChild);
  }
  if (document.body) inject(); else document.addEventListener("DOMContentLoaded", inject);
  // Markup SVG satu ikon (string), untuk innerHTML / template literal.
  window.tiIcon = function (name, cls) {
    return '<svg class="ti' + (cls ? " " + cls : "") + '" aria-hidden="true" focusable="false"><use href="#ti-' + name + '"></use></svg>';
  };
  window.TablerIcons = { version: ${JSON.stringify(version)}, names: ${JSON.stringify(symbols.map((s) => s.match(/id="ti-([^"]+)"/)[1]))} };
})();
`;
fs.writeFileSync(path.join(root, "vendor/tabler-icons.js"), out);
fs.copyFileSync(path.join(pkgDir, "LICENSE"), path.join(root, "vendor/LICENSE-tabler-icons"));
console.log(`vendor/tabler-icons.js: ${symbols.length} ikon, ${(out.length / 1024).toFixed(1)} KB (Tabler Icons ${version})`);
