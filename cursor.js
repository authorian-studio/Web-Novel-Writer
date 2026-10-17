/* cursor.js — KURSOR KUSTOM (Pengaturan Akun → Kursor). Dimuat di <head>, sebelum halaman tampil.
   Mode (disimpan di perangkat, localStorage "novelist_cursor"):
     "novelist" (bawaan) = set kursor "W11 Cursor Free" (Jepri Creations; PNG 32 px di folder cursors/, dikonversi dari
                           .cur/.ani Windows): versi putih (cursors/light) di tema gelap, versi hitam (cursors/dark) di
                           tema terang — otomatis ikut body.light. Panah, tangan, I-beam, dilarang, sibuk, crosshair,
                           geser & ubah ukuran semuanya ikut set ini (variabel --cur-* di style.css, html.cur-set).
     "system"            = kursor bawaan sistem operasi.
     "custom"            = gambar pilihan pengguna (diperkecil ke 24/32/48 px, PNG), titik tunjuk di ujung kiri atas
                           atau di tengah; dipakai untuk kursor biasa & di atas tombol.
   Hanya untuk perangkat dengan mouse/trackpad (any-pointer: fine) — layar sentuh tidak terpengaruh.
   CSS-nya di style.css bagian "KURSOR KUSTOM" (html.cur-on + variabel --cur-*; semua "cursor: x" di file CSS ditulis
   var(--cur-x, x) sehingga tanpa variabel tetap kursor sistem).
   API: window.NovelCursor = { get(), set({ mode, img, size, hot }), readImage(file, size) -> Promise<dataURL> } */
(function () {
  "use strict";
  const KEY = "novelist_cursor";
  function get() {
    try { const v = JSON.parse(localStorage.getItem(KEY) || "null"); if (v && typeof v === "object") return v; } catch (e) { /* abaikan */ }
    return { mode: "novelist" };
  }
  function apply(c) {
    const r = document.documentElement;
    r.classList.remove("cur-on", "cur-set");
    r.style.removeProperty("--cur-default"); r.style.removeProperty("--cur-pointer");
    if (c.mode === "system") return;
    if (c.mode === "custom" && typeof c.img === "string" && /^data:image\/png;base64,/.test(c.img)) {
      const s = [24, 32, 48].includes(c.size) ? c.size : 32, h = c.hot === "center" ? Math.round(s / 2) : 1;
      const u = `url("${c.img}") ${h} ${h}`;
      r.style.setProperty("--cur-default", u + ", auto");
      r.style.setProperty("--cur-pointer", u + ", pointer");
    } else {
      r.classList.add("cur-set");   // variabel --cur-* untuk set W11 ada di style.css (ikut tema)
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
  window.NovelCursor = { get, set, readImage, resize, preview: { novelist: "cursors/light/arrow.png" } };
  apply(get());
})();
