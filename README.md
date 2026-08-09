# Novelist Web — v0.6.0

**Pembaruan terbaru (v0.6.0):**
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
