# Novelist Web — v0.9.5

## Riwayat perubahan terbaru (v0.9.5) — paling baru di atas

- **Map 3D: tampilan bergaya ilustrasi seperti vvd + bisa melukis langsung di 3D**
  - **Pohon baru** (bukan bola-bola kecil lagi): gaya kartun dengan garis tepi gelap & shading bertingkat —
    pinus berupa tumpukan kerucut yang rapat, pohon rindang bertajuk bulat, rimba seperti palem lebat, rumpun
    rawa, pinus bersalju di tundra, pohon kecil hijau muda di padang rumput. Hutan kini tertutup rapat.
  - **Tekstur bioma lebih kaya:** ladang petak warna-warni dengan garis batas & alur bajak, tanah retak berupa
    lempeng dengan retakan gelap, rawa bergenangan, tundra putih berawan, gurun bergelombang, gunung batu bertebing
    berlapis dengan kaki berumput; pantai dengan garis tinta, buih putih & cincin air dangkal biru muda.
  - **Melukis di 3D:** alat **Kuas**, **Penghapus** & **Ketinggian** (juga shortcut B/E/K) kini bisa dipakai
    langsung di tampilan 3D, lengkap dengan palet bioma & ukuran kuas, lingkaran kuas yang menempel di medan, dan
    hasil yang langsung terlihat saat menyapu. Kontrol saat alat lukis aktif: seret kiri = melukis, klik kanan +
    seret = memutar, tombol tengah / Shift + seret = menggeser, scroll = zoom; di HP 1 jari = melukis, 2 jari =
    putar/zoom. Undo/Redo berfungsi di 3D, dan hasilnya sama persis saat kembali ke 2D. Alat lain (sungai, jalan,
    tempat, wilayah, label) tetap khusus 2D.
  - Saat alat lukis aktif, kamera 3D dibuka lebih dekat & miring (seperti referensi vvd).

### v0.9.4

- **Tailwind CSS v4, Radix UI & shadcn/ui terpasang** (semua tanpa CDN; situs tetap statis tanpa build step).
  - **Tailwind CSS 4.3.3** → `vendor/tailwind.css` (±81 KB, ±12 KB terkompres), dimuat di `index.html`, dikompilasi dari
    `tailwind.input.css`. **Tanpa preflight** dan semuanya di dalam `@layer`, jadi `style.css` tetap menang dan tampilan
    lama tidak berubah. Kelas dipindai dari `components/ui`, `index.html`, `app.js`, `map-ui.js`, `timeline.js` — setelah
    menambah kelas Tailwind baru jalankan `npm install` (sekali) lalu `npm run build:css`.
  - **Radix UI 1.6.7** → `vendor/radix-ui-1.6.7.min.js` → `window.RadixUI` (primitive tanpa gaya). Muat dengan
    `await ensureRadixUI()`.
  - **shadcn/ui** (registry `shadcn@4.21.0`, gaya new-york) — seperti cara kerja shadcn, **kode sumber komponennya ada di
    proyek ini**: `components/ui/*.tsx` (45 komponen: Button, Card, Dialog, AlertDialog, Sheet, Select, DropdownMenu,
    Popover, Tooltip, Tabs, Accordion, Switch, Checkbox, Slider, Table, dll.) + `lib/utils.ts` (`cn()`), konfigurasi di
    `components.json`. Dikompilasi ke `vendor/shadcn-ui.min.js` → `window.ShadcnUI`; muat dengan `await ensureShadcnUI()`.
    Gayanya dari `vendor/tailwind.css`; tema gelap/terang otomatis mengikuti tema aplikasi (`body.light`).
    Variabel tema shadcn memakai awalan `--sh-*` agar tidak bentrok dengan `--border`/`--accent` milik `style.css`.
    ```js
    const UI = await ensureShadcnUI();
    const h = React.createElement;
    ReactDOM.createRoot(el).render(
      h(UI.Dialog, null,
        h(UI.DialogTrigger, { asChild: true }, h(UI.Button, { variant: "outline" }, "Hapus scene")),
        h(UI.DialogContent, null, h(UI.DialogHeader, null, h(UI.DialogTitle, null, "Yakin?")),
          h(UI.DialogFooter, null, h(UI.Button, { variant: "destructive" }, "Hapus")))));
    ```
  - Semua library React (Base UI, Radix, shadcn) dibangun ulang dengan `npm run build:vendor` (`tools/build-vendor.mjs`,
    esbuild) dan memakai **satu** React 18 yang sama dari `vendor/`. `npm run build` = vendor + CSS.
  - Belum termasuk (butuh library tambahan): calendar, chart, carousel, command, drawer, form, input-otp, resizable,
    sidebar, sonner, toast. Komponen ditulis untuk React 19: di React 18 semuanya berfungsi, hanya `ref` ke komponen
    shadcn tidak diteruskan.

### v0.9.3

- **Library komponen Base UI (base-ui.com) terpasang** — `@base-ui/react` 1.8.0 (MIT) dibundel sekali dengan
  esbuild menjadi `vendor/base-ui-1.8.0.min.js` (tanpa CDN, tanpa build step di aplikasi). Bundel ini memakai
  React 18 yang sudah ada di `vendor/` (dipakai bersama Timeline, jadi React tetap dimuat sekali saja) dan
  menghasilkan global `window.BaseUI` berisi 46 komponen tanpa gaya: Dialog, AlertDialog, Popover, Tooltip,
  Menu, ContextMenu, Select, Combobox, Tabs, Accordion, Switch, Checkbox, Slider, NumberField, Toast, dll.
  - Ukurannya ±495 KB (±167 KB terkompres), jadi **tidak dimuat di awal** — panggil `ensureBaseUI()` (di `app.js`)
    saat dibutuhkan:
    ```js
    const BaseUI = await ensureBaseUI();
    const h = React.createElement;
    ReactDOM.createRoot(el).render(
      h(BaseUI.Popover.Root, null,
        h(BaseUI.Popover.Trigger, { className: "btn" }, "Buka"),
        h(BaseUI.Popover.Portal, null, h(BaseUI.Popover.Positioner, null,
          h(BaseUI.Popover.Popup, { className: "my-popup" }, "Isi popover")))));
    ```
  - Komponen Base UI tidak membawa CSS — gayanya diatur sendiri lewat `className` / atribut `data-*`
    (mis. `[data-checked]`, `[data-open]`). Dokumentasi: https://base-ui.com/react/overview/quick-start
  - `loadScriptOnce()` di `app.js` kini benar-benar memuat tiap file sekali (dipakai bersama Timeline, Map & Base UI).

### v0.9.2

- **Library animasi Motion (motion.dev) terpasang** — `vendor/motion-13.4.3.min.js` (build UMD, MIT, tanpa CDN)
  dimuat di `index.html` sebelum `app.js`, jadi tersedia global sebagai `window.Motion` untuk pengembangan
  animasi UI berikutnya. Contoh pemakaian di kode:
  ```js
  const { animate, stagger, inView, spring } = window.Motion;
  animate(".project-card", { opacity: [0, 1], y: [12, 0] }, { delay: stagger(0.05), duration: 0.4 });
  animate(el, { scale: 1.05 }, { type: spring, stiffness: 300, damping: 20 });
  inView(".dash-title", (el) => { animate(el, { opacity: 1 }); });
  ```
  Dokumentasi: https://motion.dev/docs (bagian JavaScript / "animate").

### v0.9.1

- **Map: perbaikan hasil review**
  - **3D lebih mirip referensi:** slab jauh lebih tebal dengan dinding air biru di sisi laut, permukaan
    bertekstur (sama dengan 2D, pantai halus), gunung berbatu runcing dengan salju hanya di puncak, padang
    rumput sedikit bergelombang, pohon lebih variatif. Label peta kini "tercetak" di permukaan dan pin tempat
    bergaya sama dengan 2D (tidak lagi menutupi layar). Kamera awal di HP/tablet lebih miring.
  - **2D:** nama wilayah tidak lagi tertimpa sungai/jalan, isian wilayah lebih transparan, pin & nama tempat
    menyesuaikan zoom, label yang terlalu kecil disembunyikan, sungai berhenti di pantai, sorotan objek lebih jelas.
  - **Bug:** tombol Delete/Backspace di tab Map tidak lagi ikut menghapus event Timeline yang sedang terpilih;
    ketukan di peta (HP) tidak lagi "tembus" ke panel objek yang baru muncul; palet kuas langsung tampil saat tab
    Map dibuka; objek lama yang dipulihkan lewat undo tidak lagi dianggap baru.
  - **Tampilan:** panel objek di HP tidak menutupi seluruh peta, Layers tidak tertutup panel objek, skala km
    punya latar, popover Tempat/Jalan lebih ringkas, contoh garis jalan sesuai gaya di peta.

### v0.9.0

- **Fitur baru: Map (peta world-building ala vvd)** — tab **Map** di top bar project (di sebelah Timeline).
  - Sidebar kiri: cari peta, **+** untuk membuat peta baru, klik untuk membuka. Header: nama peta
    (langsung bisa diganti), ukuran **128 × 128 km** (1 kotak = 1 km), tombol hapus peta (dengan konfirmasi).
  - **Lukis daratan dengan kuas** di tampilan 2D (dilihat dari atas): laut biru berbintik awan dalam
    bingkai krem. Popover kuas berisi **11 bioma** dengan pratinjau tekstur — Laut & danau, Padang rumput,
    Ladang, Hutan, Hutan pinus, Rimba, Rawa, Gurun, Tundra, Tanah retak, Pegunungan — plus slider
    **ukuran kuas** (1–20 km) dengan pratinjau lingkaran. Pantai, pohon & simbol gunung tergambar otomatis.
  - Toolbar bawah: **Pilih** (klik/geser objek, Delete untuk hapus), **Kuas**, **Penghapus** (jadi laut),
    **Ketinggian** (naik/turun + kekuatan), **Sungai** & **Jalan** (gambar bebas sambil diseret; jalan raya /
    setapak), **Tempat** (8 ikon: kota, desa, kastil, pelabuhan, kuil, reruntuhan, perkemahan, penanda),
    **Wilayah** (klik titik-titik batas, dobel-klik / Enter untuk selesai), **Label** (gaya wilayah,
    perairan, kecil), lalu **Undo / Redo** (juga Ctrl+Z, Ctrl+Shift+Z / Ctrl+Y). Shortcut alat: V, B, E, K,
    S, J, T, W, L.
  - **Layers** (kiri atas): tampilkan/sembunyikan daratan, sungai, jalan, tempat, wilayah, label.
    Kanan bawah: tombol **3D/2D**, zoom, tampilkan seluruh peta. Kiri bawah: **skala km** yang
    panjangnya mengikuti zoom. Geser peta: tombol tengah/kanan mouse, Spasi + seret, atau dua jari di HP.
  - Panel kanan untuk objek terpilih: nama/teks, ikon, ukuran & rotasi label, warna wilayah, lebar
    sungai, jenis jalan, **catatan**, dan **scene terkait** (tombol "Buka scene" langsung ke editor).
  - **Tampilan 3D**: peta jadi diorama/slab tebal — air transparan, sisi tanah bergaris, pohon, gunung
    bersalju, sungai, jalan, wilayah, pin tempat & label. Seret untuk memutar, klik kanan untuk menggeser,
    scroll untuk zoom; klik pin tempat untuk membuka panelnya.
  - Data peta tersimpan di file project (`data.maps`, grid dikompres RLE + base64 jadi kecil) — ikut
    autosave & backup ke Google Drive.
  - Semua file baru dimuat **hanya saat tab Map dibuka** (`map-core.js`, `map2d.js`, `map-ui.js`), dan
    three.js (`vendor/`, tanpa CDN) + `map3d.js` baru dimuat saat pertama kali beralih ke 3D.
  - Responsif: di HP daftar peta jadi deretan chip, toolbar & pilihan bioma bisa digeser mendatar,
    panel objek muncul dari bawah.

### v0.8.1

- **Timeline: satu garis waktu horizontal ala vvd**
  - Garis waktu **tidak bisa diubah manual** (input rentang tahun dihapus). Rentang dasarnya
    1500–1900, dan garis **memanjang otomatis** kalau ada event di luar rentang itu — mis. event
    tahun 1472 membuat garis mulai dari 1472.
  - Semua event **menempel di garis** (label + tiang + titik) dan hanya bisa digeser **mendatar**;
    tanggalnya tampil langsung saat digeser. Label yang berdekatan otomatis ditumpuk bertingkat.
  - **Tambah event dari garis:** arahkan kursor ke garis (juga di luar ujungnya) → muncul
    "tanggal · klik untuk menambah", klik untuk membuat event di tanggal itu.
  - **Waktu event bisa diedit:** tanggal, bulan, tahun (bulan & tanggal boleh kosong).
  - **Zoom sampai level hari:** label di garis berubah dari tahun → bulan, dan presisi tanggal saat
    menambah/menggeser ikut zoom (tahun → bulan → hari). Ukuran label tetap di layar berapa pun zoom-nya.
  - Fitur sambungan panah antar event dihapus (semua event kini satu garis).

### v0.8.0

- **Fitur baru: Timeline (React Flow)** — tab **Timeline** di top bar kiri (di dalam project).
  - Sidebar kiri: cari timeline, **+** untuk membuat timeline baru, klik untuk membuka.
  - Header: nama timeline, rentang tahun (awal – akhir), tombol hapus timeline.
  - Kanvas: **sumbu tahun** dengan label otomatis; **event** berupa kartu kecil dengan tiang ke
    sumbu. Geser event ke kiri/kanan = tahunnya ikut berubah (langsung terlihat saat digeser),
    atas/bawah = posisi bebas. Tarik titik di sisi kanan kartu ke kartu lain untuk
    **menyambungkan event** (panah sebab-akibat). Pilih lalu tekan Delete/Backspace untuk hapus.
  - Toolbar bawah: mode **pilih** (seret untuk memilih banyak) / **geser kanvas**, **+ Event**,
    **tampilkan semua**; zoom di kanan bawah.
  - Panel edit event: judul, tahun, catatan, **scene terkait** (tombol "Buka scene" langsung ke
    editor), warna, hapus.
  - Data timeline tersimpan di file project (`data.timelines`) bersama scene — ikut autosave &
    backup ke Google Drive.
  - Library React 18 + React Flow 11 disimpan di folder `vendor/` (tidak bergantung CDN) dan baru
    dimuat saat tab Timeline pertama kali dibuka, jadi tidak memperlambat aplikasi.
- **Home project disederhanakan** — sapaan, statistik, dan kartu Manuskrip / Dunia & Karakter
  dihapus; Home sekarang hanya kanvas titik-titik scene.

### v0.7.0

- **Halaman login: logo & footer**
  - Tulisan "Novelist" diganti **logo animasi** (`login-logo.webm` / `login-logo.mp4`,
    poster `login-logo-poster.webp`) — dipotong 360×360 dari video logo asli, tanpa suara,
    latar hitamnya menyatu dengan dot-grid.
  - **Footer** di bawah: **Bantuan | Ketentuan | Privasi | ID ⌄**. Bantuan membuka panduan,
    Ketentuan & Privasi membuka modal, dan pilihan bahasa (Bahasa Indonesia / English)
    mengganti semua teks halaman login (tersimpan di browser).
- **Sidebar project** — logo di kiri atas (di dalam project) membuka sidebar yang bisa
  ditutup (klik logo lagi, tombol ‹, klik di luar, atau Esc). Isinya: Keluar ke Dashboard,
  daftar project (pindah langsung), Simpan ke Drive, Ganti Tema.
- **Tampilan dalam project dirombak ala vvd** — background cover project di-blur + dot-grid
  samar, top bar berupa chip (project + tab Home/Write/Organize/Plot/Schedule/Tools + jam),
  tab **Home** (sapaan acak, statistik kata/scene/karakter, kartu Manuskrip & Dunia &
  Karakter, canvas titik-titik scene), Write & Organize jadi panel kaca.
- **Dashboard** — project tampil sebagai kartu sampul buku di kiri atas; judul tengah diacak
  tiap refresh; "+ Project Baru" tepat di bawah judul; hover kartu = sampulnya memudar ke
  background; dot-grid dibuat samar ala vvd.
- **Background & logo** — foto background diganti ngarai + aurora (`bg-canyon.jpg`, di-blur),
  logo dashboard punya mode idle pelan & aktif saat kursor mendekat, favicon/ikon PWA
  diganti logo heksagon.

---


**Pembaruan terbaru (v0.6.2):**
- **Area menulis dilebarkan penuh** — batas max-width dihapus total (sebelumnya
  1360px), sekarang mengikuti penuh lebar panel dari tepi kiri ke kanan
  (menyisakan padding 48px di kedua sisi), sesuai contoh yang dikirim.



**Pembaruan terbaru (v0.6.1):**
- **Google Client ID diperbarui** ke `994669345414-5kulq7vvh2rogij9536asf80qdcrvaun.apps.googleusercontent.com`
  (sudah ditempel di `config.js`).
- **Area menulis (Obsidian-pane) dilebarkan** dari max-width 960px menjadi
  1360px, supaya lebih lega dipakai di layar lebar.
- **Judul scene di atas area tulisan sekarang di-pusatkan (center)** dan
  dibuat **sticky** — tetap menempel di atas walau kamu scroll ke bawah
  saat tulisannya panjang, jadi selalu jelas scene mana yang sedang dibuka.


- **Panel SCENES di tab Write diganti total jadi tree view** ala Scrivener/
  VS Code, terinspirasi komponen `TreeView` (motion/react) yang dikirim —
  diadaptasi ke vanilla JS/CSS (tanpa Framer Motion) karena struktur
  project ini tidak pakai React:
  - Baris jadi ramping (30px), chevron ▸ yang **berputar 90°** saat
    folder/chapter dibuka (bukan lagi ganti karakter ▸/▾).
  - **Garis indentasi vertikal** di kiri anak-anak folder (border-left),
    persis seperti file tree VS Code / komponen aslinya.
  - Expand/collapse folder dianimasikan halus pakai trik CSS
    `grid-template-rows: 0fr → 1fr` (auto-height animation tanpa perlu
    JS mengukur tinggi konten), dengan easing yang sama seperti
    komponen aslinya.
  - Ikon folder/dokumen diganti SVG stroke minimalis (bukan emoji 📁📄).
  - Kolom "meta" di kanan tiap baris: folder menampilkan **jumlah isi**
    `(n)`, scene menampilkan **jumlah kata** (`128w`) dihitung otomatis
    dari isi tulisannya.
  - Tombol aksi (tambah/fokus/duplikat/hapus) disembunyikan default,
    baru muncul saat baris di-hover atau sedang aktif — supaya tree-nya
    tetap bersih dan padat seperti binder Scrivener asli.
  - **Drag & drop pindah scene/chapter** (ke urutan lain atau ke dalam
    folder lain) tetap berfungsi persis seperti sebelumnya — cuma
    tampilannya yang diganti, logika pemindahan datanya tidak disentuh.
  - Preview synopsis dipindah sepenuhnya ke panel kanan "MAIN
    INFORMATION" (sudah ada di sana), tidak lagi ditampilkan di baris
    tree supaya barisnya tetap ringkas satu baris.
  - Tab **Organize** (Karakter/Lokasi/Catatan) TIDAK terpengaruh —
    tampilannya tetap seperti biasa (bukan tree, karena strukturnya
    flat/tidak berjenjang).

**Pembaruan v0.5.1:**

**Pembaruan terbaru (v0.5.1):**
- **Rail navigasi kiri di halaman project (Plot/Write/Organize/Schedule/
  Tools) didesain ulang** terinspirasi komponen `IconNavigation` dari
  "Interfaces" (icon nav rail 2-level sidebar) — sekarang jadi rail
  ramping (64px) berisi tombol ikon persegi rounded, **icon-only** (label
  teks diganti tooltip `title`), dengan highlight background halus saat
  hover/aktif dan transisi "soft spring" (`cubic-bezier(0.25, 1.1, 0.4, 1)`)
  yang lembut. Ikon emoji lama (🧩⌨️🗂️⏱️🛠️) diganti SVG stroke-based
  minimalis (branch/pen/folder/clock/wrench) supaya konsisten dengan
  gaya ikon di bar aksi dashboard. Berlaku juga di versi bottom-bar mobile.

**Pembaruan v0.5.0:**
- **Bar aksi baru di pojok kanan atas dashboard** — menggantikan tombol
  "⋮ Pengaturan" lama, sekarang berupa pill berisi 5 ikon interaktif
  terinspirasi komponen `ExpandableTabs` (21st.dev): ikon diam sebagai
  icon-only, lalu melebar menampilkan label saat di-hover **atau diklik**
  (klik memicu animasi expand-nya sendiri tanpa perlu arahkan kursor —
  penting juga untuk pengguna HP/layar sentuh yang tidak punya hover).
  Kecepatan animasinya sengaja dibuat pelan (~0.55–0.6 detik) supaya
  transisinya tidak terlalu cepat dilihat.
  - 🏠 **Tema** — toggle dark/light langsung
  - ⬆ **Cloud Library** — ikon upload (panah ke atas + tray), buka Cloud
    Library langsung satu klik
  - ⚙️ **Pengaturan** — tetap buka dropdown lengkap (Ganti Tema/Cloud
    Library/Logout) sebagai menu cadangan
  - ❓ **Support** — buka modal "Panduan Penggunaan" yang menjelaskan
    tiap fitur web (Write, Plot, Organize, Schedule, Cloud Library,
    Autosave, Trash)
  - 🚪 **Logout** — ikon pintu (bukan lagi shield), minta konfirmasi
    dulu sebelum logout dari Google
- **Sistem Trash di Cloud Library** — project yang dihapus tidak
  langsung hilang permanen. Sekarang ada folder Drive terpisah
  **"Novelist Web Trash"** dan tab ketiga **TRASH** di Cloud Library
  (selain SEND TO CLOUD & RECEIVE FROM CLOUD), lengkap dengan tombol
  **Pulihkan (⟲)** dan **Hapus Permanen (🗑, merah)** per item.
- **Perbaikan bug "project hapus tapi muncul lagi"** — sebelumnya delete
  cuma menghapus dari daftar lokal, filenya tetap ada di Drive. Sekarang
  delete benar-benar memindahkan file ke folder Trash di Drive. Ada juga
  guard race-condition (`_deleted` flag) supaya kalau ada autosave yang
  masih berjalan pas project dihapus, hasil save itu otomatis ikut
  dipindah ke Trash juga (bukan malah menghidupkan project yang sudah
  dihapus).
- **Empty state dashboard didesain ulang** meniru komponen `Empty` dari
  reui: ikon folder dalam kotak rounded, judul "Belum ada apa-apa di
  sini", deskripsi dengan link "membuat project pertamamu", dan tombol
  "+ Project Baru" — semua trigger buka modal Add Project.
- **Tombol "+ Add Project" (FAB) otomatis sembunyi** saat belum ada
  project sama sekali, dan muncul lagi begitu ada minimal 1 project.
- **Tombol back (←) di halaman project** diganti animasi ala FlowButton
  (21st.dev): border pill yang berubah rounded-rect saat hover/tap, dan
  lingkaran aksen yang membesar dari tengah.
- **Tombol Exit (pengganti tombol back)** — versi penuh FlowButton
  dengan teks "Exit", dua panah yang saling bertukar posisi, dan
  lingkaran yang membesar memenuhi tombol saat hover/tap.



**Pembaruan terbaru (logo animasi):** monogram "N" di pojok kiri atas dashboard
diganti logo geometris animasi Novelist (`logo-anim.mp4`, looping tanpa suara,
poster `logo-anim-poster.webp`). Video asli (1920x1080, 4,5 MB, ada audio)
dipotong ke area logo, latarnya dihitamkan murni, tepinya dibuat memudar, dan
audionya dibuang — sekarang ±180 KB. Latar hitamnya jadi transparan lewat CSS
`mix-blend-mode: screen` (tema terang: warna dibalik + `multiply`). Elemen
`.rail-logo` HARUS tetap di luar `.dash-rail`; di dalamnya blend tidak bisa
"melihat" foto background. Video hanya diputar saat dashboard terlihat & tab
aktif, dan tidak diputar bila pengguna memilih "reduce motion".

**Pembaruan terbaru (tampilan dalam project, ala vvd):** saat project dibuka,
background-nya memakai cover project yang di-blur (fallback `bg-canyon.jpg`) +
dot-grid samar. Top bar berupa chip: logo (membuka sidebar: keluar ke dashboard,
pindah project, simpan, ganti tema), chip project
(cover + judul + menu ▾), dan tab Home / Write / Organize / Plot / Schedule /
Tools, plus jam di kanan atas. Tab **Home** berisi sapaan acak, statistik (kata,
scene, karakter), kartu "Manuskrip" & "Dunia & Karakter", dan canvas berisi
titik-titik scene (klik untuk langsung menulis scene itu). Write & Organize
tampil sebagai panel kaca di atas background yang sama.

**Pembaruan sebelumnya (dashboard setelah login):** tampilan dashboard dirombak
ala vvd — rail ikon di kiri (Cloud Library, Ganti Tema, Logout, Pengaturan),
judul "Mau menulis apa hari ini?" di tengah, project berupa baris lebar
(cover + judul + status sinkron + menu ⋯), tombol "Project Baru" di bawah
daftar, dan tombol bantuan "?" di kanan bawah. Background: foto
(`bg-canyon.jpg`, ngarai bersalju + aurora) yang diredupkan + di-blur + vignette, dengan dot-grid ala React Flow di
seluruh halaman. Di tema terang foto disembunyikan dan hanya dot-grid yang
tampil. Di HP rail berpindah jadi bar bawah. Bagian yang diatur di `style.css`
(blok "DASHBOARD"): `.galaxy-photo` (opacity/blur foto), `.galaxy-dots`
(kerapatan & transparansi titik).
Project tampil sebagai kartu sampul buku di kiri atas (`.dash-shelf`); saat kursor
di atas kartu, sampulnya memudar masuk ke background (`.galaxy-cover`). Judul di
tengah diacak tiap refresh dari daftar `DASH_TITLES` di `app.js`.

**Pembaruan terbaru (halaman login):** layout login dijadikan dua kolom —
kiri berisi komponen HalftoneReveal dari React Bits (foto yang tampil sebagai
halftone dot, lalu "terbuka" jadi foto asli di bawah kursor; klik untuk
ledakan reveal), kanan berisi form dengan tombol bertumpuk
"Lanjutkan dengan Google / Discord / Apple / Email" di atas background
dot-grid ala React Flow. Hanya Google yang aktif (project tersimpan di Google
Drive); tiga tombol lainnya masih tampilan dengan tag "Segera". Komponen
HalftoneReveal asli berbasis React, jadi di sini di-port ke JS biasa di file
`halftone-reveal.js` (shader sama persis). Di layar < 900px kolom kiri
disembunyikan dan WebGL tidak dijalankan. Opsi tampilan (foto, ukuran dot,
warna, dll) ada di `LOGIN_ART_OPTIONS` di bagian bawah `app.js`. Gambarnya
`login-art.webp` adalah ilustrasi karakter dengan background transparan
(opsi `transparent: true`), jadi dot halftone hanya menutupi karakternya dan
dot-grid di belakangnya tetap terlihat. Untuk ganti karakter: siapkan gambar
PNG/WebP berlatar transparan lalu ganti `src` (file harus di-upload ke root repo).
`login-art-data.js` berisi gambar yang sama dalam bentuk data URI: WebGL tidak boleh
memakai gambar lokal saat halaman dibuka langsung dari file (`file://`), jadi tanpa
file ini kolom kiri akan kosong kalau `index.html` di-klik dua kali. Via GitHub Pages /
Live Server kedua cara jalan.

**Pembaruan sebelumnya:** halaman login diberi animasi baru terinspirasi
komponen "MinimalAuthPage" dari 21st.dev — partikel titik-titik halus yang
melayang pelan di background (canvas, ikut bereaksi lembut saat mouse
didekatkan), plus lapisan blob gradient abu-abu lembut di pojok kiri atas.
Semua dibangun ulang pakai vanilla JS/CSS (bukan React) supaya konsisten
dengan struktur project ini. Logo tetap teks "Novelist" biasa (belum pakai
logo custom), dan posisi kartu login tetap di tengah layar.



**Pembaruan terbaru:**
- Area tulisan di Mode Fokus digeser makin mepet ke tepi kiri & kanan
  (padding dipersempit jadi 2.5%).
- Ditambahkan toolbar kompak di Mode Fokus: Bold/Italic/Underline, rata
  kiri-tengah-kanan, dan pemilih warna teks — tombolnya menyala (highlight)
  otomatis kalau kursor sedang berada di teks dengan gaya itu.
- Panel statistik kata/karakter/kalimat/paragraf sekarang berbentuk pill
  (kotak highlight ujung bulat) supaya lebih kelihatan, baik di Mode Fokus
  maupun status bar editor Write biasa.



**Langkah pertama menuju tampilan Scrivener di bagian dalam project:**
- **Binder bertingkat** — sekarang bisa bikin **Chapter (folder)** yang berisi
  banyak Scene di dalamnya, mirip struktur Manuscript > Chapter > Scene di
  Scrivener. Klik tombol **+** di header SCENES, pilih "📄 Scene" atau
  "📁 Chapter (folder)". Folder bisa expand/collapse (klik ikon ▸/▾), dan
  punya tombol **+** sendiri untuk menambah scene langsung di dalamnya.
- **Drag & drop lintas folder** — seret scene/folder pakai ikon ⠿, bisa
  diurutkan ulang di level yang sama, atau dijatuhkan tepat ke atas sebuah
  folder untuk memindahkannya ke dalam folder itu.
- **Toolbar format lengkap** — font, ukuran, gaya paragraf/heading, bold/
  italic/underline, rata kiri-tengah-kanan, bullet & numbered list, warna teks.
- **Breadcrumb + navigasi back/forward** (◀ ▶) seperti Scrivener, buat
  lompat antar scene yang baru dibuka.
- **Status bar** di bawah area tulisan: jumlah kata real-time + slider zoom
  ukuran teks.

**Catatan:** ini baru sebagian fitur ala Scrivener. Struktur binder penuh
Scrivener (Front Matter/Back Matter/Research/Trash sebagai kategori khusus,
mode Corkboard/Outliner) belum diimplementasikan — bisa jadi langkah
berikutnya kalau dibutuhkan.



Web app menulis novel: **login Google wajib** → dashboard project →
editor ala Novelist (tab **Write** dengan Scenes + panel profil, tab
**Organize** untuk Karakter/Lokasi/Catatan). Semua project **auto-save**
ke Google Drive-mu sendiri, plus backup bertimestamp otomatis di folder
terpisah supaya data tidak pernah hilang walau tab/PC tiba-tiba mati.

## Setup Google Drive (WAJIB sebelum dipakai)

1. https://console.cloud.google.com/ → buat project baru
2. "APIs & Services" > "Library" → aktifkan **Google Drive API**
3. "APIs & Services" > "OAuth consent screen" → External → isi info dasar →
   tambahkan emailmu di "Test users"
4. "APIs & Services" > "Credentials" > "Create Credentials" > "OAuth client ID"
   - Application type: **Web application**
   - "Authorized JavaScript origins" → isi URL hosting kamu, misal
     `https://namakamu.github.io`
5. Salin **Client ID**, tempel ke `config.js` (ganti `GOOGLE_CLIENT_ID`)
6. Host filenya (GitHub Pages dll — lihat bagian fix 404 di bawah kalau perlu)

## Cara Kerja Auto-Save & Backup (menjawab kekhawatiran data hilang)

- Begitu login, kamu **wajib** masuk dengan akun Google — tidak ada mode "tanpa login".
- Setiap kali kamu mengetik (judul, synopsis, isi tulisan, dsb), setelah
  **4 detik berhenti mengetik**, project otomatis disimpan ke folder Drive
  **"Novelist Web Projects"** (file `.novj`, update di file yang sama — tidak
  membuat file baru terus-menerus).
- Setiap **3 menit sekali** (kalau ada perubahan), dibuat juga **salinan
  backup bertimestamp** di folder terpisah **"Novelist Web Backups"**.
  Hanya 6 backup terakhir per project yang disimpan (yang lama otomatis
  dihapus supaya Drive tidak penuh).
- Kalau kamu menutup tab sebelum sempat autosave jalan, browser akan
  menampilkan peringatan konfirmasi ("perubahan belum tersimpan").
- Kalau ada apa-apa (misal salah edit parah, atau file utama korup), buka
  menu **⋮ di halaman project > "Riwayat Backup"** untuk memulihkan dari
  salinan backup manapun.
- Ctrl+S juga bisa dipakai untuk memaksa simpan langsung.

**Catatan jujur:** ini tetap web browser biasa, bukan aplikasi native — jadi
kalau PC mati/hang tanpa sempat browser memproses request terakhir, ada
kemungkinan sangat kecil detik-detik terakhir belum sempat ter-upload. Tapi
dengan kombinasi autosave 4 detik + backup berkala + peringatan sebelum
menutup tab, risiko kehilangan tulisan ditekan seminim mungkin.

## Cloud Library (kirim/ambil manual — beda dengan autosave)

Selain autosave otomatis di atas, ada juga layar terpisah **Cloud Library**
(buka lewat ikon ⬆ di bar kanan atas dashboard, atau lewat menu ⚙
Pengaturan) untuk kontrol manual — sekarang dengan 3 tab:

- **SEND TO CLOUD** — daftar semua project yang ada di perangkat ini,
  tinggal pencet ikon ⬆ di project yang mau dikirim manual ke Drive.
- **RECEIVE FROM CLOUD** — daftar semua file project yang ada di Drive
  (folder "Novelist Web Projects") lengkap dengan **waktu terakhir
  disimpan**, tinggal pencet salah satu untuk mengambil/membukanya di
  perangkat ini.
- **TRASH** — project yang dihapus dari dashboard dipindah ke sini dulu
  (folder Drive terpisah "Novelist Web Trash"), bukan langsung hilang.
  Bisa **dipulihkan (⟲)** kapan saja, atau **dihapus permanen (🗑)** kalau
  memang sudah yakin tidak dipakai lagi.

Ini cocok dipakai kalau kamu ganti perangkat (nanti termasuk dari HP)
dan mau pilih sendiri project mana yang diambil, terpisah dari mekanisme
autosave otomatis yang jalan diam-diam di belakang layar.

## Fitur v0.3
**Dashboard:** sama seperti sebelumnya (card project, cover custom, gear
menu: edit info/cover/backup Word/send to cloud/delete).

**Halaman Project (baru, mengikuti desain Novelist.app):**
- Rail navigasi kiri: Plot, **Write**, **Organize**, Schedule, Tools
  (Plot/Schedule/Tools masih placeholder, siap dikembangkan lagi nanti)
- **Write:**
  - Kolom kiri "SCENES" + tombol **+** untuk tambah scene (judul & synopsis)
  - Tiap scene punya 2 ikon: 🖋 **mode fokus** (layar penuh tanpa gangguan)
    dan 📄 **duplikat scene**
  - Klik scene → panel kanan "MAIN INFORMATION" (synopsis + status
    Todo/Draft/Done), dan di bawahnya area menulis penuh
- **Organize:** sub-tab Karakter / Lokasi / Catatan, tiap kategori bisa
  tambah item dan diisi kontennya sendiri
- Tombol 👁 preview → lihat seluruh manuskrip tergabung
- Menu ⋮ di halaman project → simpan manual, backup manual, riwayat
  backup, export ke Word

## ⚠️ Fix error 404 / index.html merah di GitHub Pages

Penyebab paling umum: file ke-upload di dalam subfolder, bukan langsung
di root repo. Struktur yang benar (semua file sejajar di root):
```
nama-repo/
├── index.html
├── style.css
├── app.js
├── halftone-reveal.js
├── login-art.webp
├── login-art-data.js
├── bg-canyon.jpg
├── favicon-32.png, apple-touch-icon.png, icon-192.png, icon-512.png
├── logo-anim.mp4
├── logo-anim-poster.webp
├── login-logo.webm, login-logo.mp4, login-logo-poster.webp
├── timeline.js
├── map-core.js, map2d.js, map3d.js, map-ui.js   (fitur Map: data, editor 2D, tampilan 3D, UI tab)
├── vendor/   (react, react-dom, reactflow, three.js r169 + OrbitControls, motion 13.4.3, base-ui 1.8.0,
│              radix-ui 1.6.7, shadcn-ui, tailwind.css + lisensinya)
├── components/ui/*.tsx, lib/utils.ts, components.json   (kode sumber shadcn/ui)
├── tailwind.input.css, tools/, package.json   (hanya untuk membangun ulang vendor/: npm run build)
├── config.js
├── manifest.json
```
**Cara upload yang benar:** extract zip → buka isi foldernya → select
SEMUA file di dalamnya (bukan folder itu sendiri) → upload/drag ke GitHub.
Lalu cek **Settings > Pages**: Source "Deploy from a branch", Branch
`main`, folder **`/ (root)`**.

## Rencana Selanjutnya
- Drag & drop reorder scene
- Fitur Plot (papan beat/plot point) dan Schedule (target kata harian)
- Export EPUB
