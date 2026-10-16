/* cursor.js — KURSOR KUSTOM (Pengaturan Akun → Kursor). Dimuat di <head>, sebelum halaman tampil.
   Mode (disimpan di perangkat, localStorage "novelist_cursor"):
     "novelist" (bawaan) = kursor khas Novelist: mata pena kecil krem bergaris gelap + titik emas; di atas tombol /
                           tautan jadi pena emas. Teks (kolom ketik, editor) tetap kursor I-beam, seret/ubah ukuran
                           tetap kursor sistem.
     "system"            = kursor bawaan sistem operasi.
     "custom"            = gambar pilihan pengguna (diperkecil ke 24/32/48 px, PNG), titik tunjuk di ujung kiri atas
                           atau di tengah; dipakai untuk kursor biasa & di atas tombol.
   Hanya untuk perangkat dengan mouse/trackpad (any-pointer: fine) — layar sentuh tidak terpengaruh.
   CSS-nya di style.css bagian "KURSOR KUSTOM" (html.cur-on + variabel --cur-default / --cur-pointer).
   API: window.NovelCursor = { get(), set({ mode, img, size, hot }), readImage(file, size) -> Promise<dataURL> } */
(function () {
  "use strict";
  const KEY = "novelist_cursor";
  const svgUrl = (svg) => "url(\"data:image/svg+xml," + encodeURIComponent(svg).replace(/'/g, "%27").replace(/"/g, "'") + "\")";
  // mata pena: ujung di (2,2); badan krem, garis gelap + lingkar tipis terang (terlihat di tema gelap & terang), titik emas
  const NIB = (fill, dot) => `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 26 26"><path d="M2.2 2.2 L21 9.6 Q22.2 10.1 21 10.7 L13.3 13.3 L10.7 21 Q10.1 22.2 9.6 21 Z" fill="none" stroke="rgba(255,255,255,.7)" stroke-width="3.4" stroke-linejoin="round"/><path d="M2.2 2.2 L21 9.6 Q22.2 10.1 21 10.7 L13.3 13.3 L10.7 21 Q10.1 22.2 9.6 21 Z" fill="${fill}" stroke="#141418" stroke-width="1.6" stroke-linejoin="round"/><circle cx="13.1" cy="13.1" r="1.9" fill="${dot}" stroke="#141418" stroke-width="1"/></svg>`;
  const DEF = svgUrl(NIB("#f5efe3", "#d7a86e")) + " 2 2, auto";
  const PTR = svgUrl(NIB("#d7a86e", "#f5efe3")) + " 2 2, pointer";
  function get() {
    try { const v = JSON.parse(localStorage.getItem(KEY) || "null"); if (v && typeof v === "object") return v; } catch (e) { /* abaikan */ }
    return { mode: "novelist" };
  }
  function apply(c) {
    const r = document.documentElement;
    r.classList.remove("cur-on");
    r.style.removeProperty("--cur-default"); r.style.removeProperty("--cur-pointer");
    if (c.mode === "system") return;
    if (c.mode === "custom" && typeof c.img === "string" && /^data:image\/png;base64,/.test(c.img)) {
      const s = [24, 32, 48].includes(c.size) ? c.size : 32, h = c.hot === "center" ? Math.round(s / 2) : 1;
      const u = `url("${c.img}") ${h} ${h}`;
      r.style.setProperty("--cur-default", u + ", auto");
      r.style.setProperty("--cur-pointer", u + ", pointer");
    } else {
      r.style.setProperty("--cur-default", DEF);
      r.style.setProperty("--cur-pointer", PTR);
    }
    r.classList.add("cur-on");
  }
  function set(c) {
    try { localStorage.setItem(KEY, JSON.stringify(c)); } catch (e) { /* storage penuh/diblokir: tetap berlaku sampai muat ulang */ }
    apply(c);
  }
  // gambar -> PNG persegi size×size (proporsi dijaga, latar transparan)
  function readImage(file, size) {
    return new Promise((resolve, reject) => {
      if (!file || !/^image\//.test(file.type || "")) { reject(new Error("File itu bukan gambar.")); return; }
      if (file.size > 5 * 1024 * 1024) { reject(new Error("Gambarnya terlalu besar (maksimal 5 MB).")); return; }
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => {
        try {
          const cv = document.createElement("canvas");
          cv.width = cv.height = size;
          const k = Math.min(size / img.naturalWidth, size / img.naturalHeight), w = img.naturalWidth * k, h = img.naturalHeight * k;
          cv.getContext("2d").drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
          resolve(cv.toDataURL("image/png"));
        } catch (e) { reject(e); } finally { URL.revokeObjectURL(url); }
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Gambar tidak bisa dibuka.")); };
      img.src = url;
    });
  }
  // master (dataURL, mis. 96 px) -> PNG ukuran baru (dipakai saat ukuran kursor kustom diganti)
  function resize(dataUrl, size) {
    return fetch(dataUrl).then((r) => r.blob()).then((b) => readImage(new File([b], "c.png", { type: b.type || "image/png" }), size));
  }
  window.NovelCursor = { get, set, readImage, resize, preview: { novelist: DEF, pointer: PTR } };
  apply(get());
})();
