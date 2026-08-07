# Novelist Web — v0.4.3

**Pembaruan terbaru:** halaman login diberi animasi baru terinspirasi
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
(buka lewat menu ⋮ di dashboard) untuk kontrol manual:

- **SEND TO CLOUD** — daftar semua project yang ada di perangkat ini,
  tinggal pencet ikon ⬆ di project yang mau dikirim manual ke Drive.
- **RECEIVE FROM CLOUD** — daftar semua file project yang ada di Drive
  (folder "Novelist Web Projects") lengkap dengan **waktu terakhir
  disimpan**, tinggal pencet salah satu untuk mengambil/membukanya di
  perangkat ini.

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
