# Novelist Web — v0.12.2

## Riwayat perubahan terbaru (v0.12.2) — paling baru di atas

**Jejaring Tokoh berganti nama jadi Tree Relations** (`jejaring.js`, `jejaring.css`; id tab & data `data.jejaring`
tetap sama, jadi tree lama langsung terbaca).
- **Satu kartu → banyak kartu:** pilih kartu lalu tombol **Hubungkan** di bilah kartu (atau "+" → "Hubungkan ke kartu
  lain…"), centang satu atau beberapa kartu di lembar itu (bisa dicari; yang sudah terhubung ditandai), lalu pilih jenis
  relasinya (atau buat kustom / tanpa label). Semua garis dibuat sekaligus dan bisa diurungkan dengan sekali Ctrl+Z.
- **Garis siku yang tidak saling tumpuk (ala vvd):** semua garis kini dirutekan bersama —
  - garis yang keluar/masuk di sisi kartu yang sama mendapat titik sambung sendiri-sendiri, diurutkan menurut letak
    kartu di ujung lainnya;
  - ruas tengah yang sejajar di lorong yang sama diberi jalur berbeda (berjarak 9 px), dengan urutan yang dipilih
    supaya persilangan sesedikit mungkin;
  - sudut membulat, label relasi di tengah ruas tengah. Berlaku juga di pratinjau wizard.

### v0.12.1

**Timeline dirombak** (`timeline.js`, gaya di `style.css` bagian Timeline).
- **Latar bintik samar** di kanvas (tema gelap & terang).
- **Hover di garis waktu = tanggal lengkap** (mis. "12 Maret 1620"); klik di garis menambah event di tanggal itu.
  Menggeser event juga menyimpan tanggal lengkap; klik event tanpa menggeser tidak lagi mengubah tanggalnya.
- **Klik event → kartu kecil**: gambar, judul, tanggal, deskripsi, tag, "Edit" (panel edit) & "Buka scene". Kartu ikut
  bergeser/zoom bersama kanvas; tutup dengan ×, Esc, atau klik area kosong.
- Panel edit event punya **Gambar** (klik / seret; diperkecil otomatis) dan **Tag** (pisahkan dengan koma).
  Data baru di event: `image`, `tags`.
- **Tombol "+ 100 th" di kedua ujung garis**: tiap klik menambah 100 tahun sebelum awal / sesudah akhir (`start`/`end`
  timeline). Bila ujungnya di luar layar, tombolnya menempel di tepi kanvas.
- **Tombol mata/bulan di kanan dihapus** dari tab Timeline (kanvas memakai seluruh lebar).
- **Sidebar daftar timeline bisa ditutup & dibuka** (tombol di kiri judul; diingat di perangkat).
- **Ganti timeline lewat dropdown judul** (panah di samping judul): daftar timeline + jumlah event, "Timeline baru".
  Judul tetap bisa diketik untuk ganti nama.

### v0.12.0

**Kodeks — wiki dunia cerita** (menggantikan tab Organize; `kodeks.js` + `kodeks.css`).
- **9 jenis entri:** Karakter, Lokasi, Faksi, Benda, Makhluk, Budaya/Agama, Sistem Sihir, Sejarah, Catatan — plus
  "Semua" untuk melihat & mencari lintas jenis. Tiap jenis punya warna & ikon sendiri.
- **Templat isian per jenis** (mis. Karakter: peran, usia, gender, ras, pekerjaan, asal, penampilan, kepribadian,
  motivasi, kekuatan & kelemahan, latar belakang; Sistem Sihir: sumber, pengguna, aturan, batasan & harga, tingkatan),
  ditambah kolom bebas **Deskripsi & catatan** (isi Organize lama tetap di sini).
- **Foto** (klik / seret gambar; diperkecil otomatis). Karakter tanpa foto memakai foto kartunya di Tree Relations (dulu Jejaring Tokoh).
- **Nama lain / panggilan**, **tag** (saran dari tag yang sudah ada, filter tag), **folder** per jenis (buat, ganti
  nama, hapus — entri tidak ikut terhapus; seret entri ke folder atau untuk mengurutkan).
- **Pencarian** di nama, nama lain, isian templat, tag, folder & deskripsi.
- **Disebut di:** daftar scene (dengan babnya) & chapter Quill yang menyebut nama atau nama lain entri — jumlah sebutan +
  cuplikan bertanda; klik untuk membuka scene/chapter itu.
- **Tampilan Daftar** (dikelompokkan per folder + panel detail), **Galeri** (kartu bergambar) dan **Tabel** (kolom
  templat utama, folder, tag, jumlah sebutan; klik judul kolom untuk mengurutkan). Pilihan tampilan diingat di perangkat.
  Di HP: jenis jadi chip mendatar, daftar ↔ detail bergantian.
- **Data Organize lama tetap terbaca apa adanya** — data tetap di `data.organize` (kunci `characters`, `locations`,
  `notes` sama; jenis baru `factions`, `items`, `creatures`, `cultures`, `magic`, `history` dibuat saat entri pertama
  dibuat; isian baru: `fields`, `aliases`, `tags`, `folder`, `photo`; urutan/folder kosong di `organize.folders`).
  Jejaring Tokoh, Quill (Kartu dunia), Beranda (titik jejak & kartu dokumen), riwayat tab & ekspor Word ikut mengenali
  semua jenis baru.

### v0.11.2

**Perbaikan & penguatan sistem simpan Google Drive** (tulisan di Jejaring Tokoh yang tidak tersimpan).
Penyebab yang ditemukan & diperbaiki:
- **Sesi Google habis (±1 jam) → simpan berhenti diam-diam.** Sekarang token diperpanjang otomatis tanpa popup
  (sebelum habis & saat Drive menjawab 401), lalu simpan dicoba lagi. Kalau perpanjangan gagal: data tetap aman di
  perangkat, status **"Perlu login ulang"** bisa diklik untuk login lalu langsung tersinkron.
- **Simpan yang gagal dianggap berhasil.** Status "belum tersimpan" tidak lagi dihapus saat upload gagal, jadi dicoba
  lagi otomatis (2, 4, 8 … maks. 60 dtk) dan browser tetap memperingatkan sebelum tab ditutup.
- **Jejaring & Beranda hanya menyimpan saat kolom ditinggalkan / Enter; Esc membuang ketikan.** Sekarang ketikan
  langsung tercatat sambil mengetik, Esc menyimpan teks (Ctrl+Z tetap bisa mengurungkan), dan semua kolom yang
  sedang disunting disetor dulu sebelum simpan/sinkron/tab disembunyikan.
- **Dua tab / versi lama menimpa data yang lebih baru**, dan versi Drive yang diambil otomatis membuat editor yang
  terbuka "lepas" dari data. Sekarang tab yang ketinggalan tidak boleh menimpa (nomor revisi + BroadcastChannel),
  versi Drive tidak diterapkan saat sedang mengetik, perubahan di dua tempat → dialog konflik (simpan keduanya /
  pilih salah satu, versi lain masuk backup), dan setelah versi baru diambil semua modul dibuka ulang dengan data baru.
- **Upload tumpang tindih** (urutan acak, file project baru dobel) → kini satu upload per project, yang terakhir menang.
- Status **di pojok editor tidak lagi tertutup kanvas Jejaring**: "Menyimpan…", "Tersimpan di perangkat",
  "Tersinkron ke Drive · JJ.MM", "Offline — tersimpan di perangkat", "Perlu login ulang", "Gagal sinkron — coba lagi".
- **Simpan di perangkat dulu** (novelist-sync.js, sama dengan aplikasi Android): tiap suntingan masuk IndexedDB ±1 dtk
  setelah diketik + salinan darurat saat tab ditutup, dipulihkan & dikirim ke Drive saat dibuka lagi; bisa offline.
- Diuji dengan Drive tiruan: semua modul (Tulis, Organize, Quill, Jejaring nama/catatan/garis/kartu, Beranda
  catatan/dokumen, Map, Timeline) tersimpan, pulih setelah tab ditutup < 300 ms, token habis, offline, Drive 500,
  suntingan cepat, versi dari perangkat lain, konflik, dua tab, IndexedDB diblokir, project > 5 MB — semuanya lulus.

### v0.11.1

- **Beranda memenuhi seluruh layar** (seperti halaman dunia di vvd): kanvas tidak lagi di dalam panel berbingkai.
  Topbar, sidebar tab & tombol-tombol melayang di atasnya; judul papan, zoom % & menu "…" jadi chip kecil di atas,
  tombol zoom/pas/minimap/pratinjau & filter di tepi kanan. Tombol "perbesar" diganti **Sembunyikan antarmuka**.
- **Roda mouse = zoom in/out** di titik kursor (halus; instan bila "kurangi gerakan" / mode hemat performa aktif).
  Cubit trackpad & Ctrl/⌘+roda juga zoom; seret area kosong = geser; Shift+roda = geser ke samping, Alt+roda = geser
  atas-bawah.
- **Benang jejak otomatis:** setiap hal yang kamu buat — scene, bab, karakter/lokasi/catatan, timeline, peta, cerita &
  chapter Quill, jejaring, papan kanvas — muncul sebagai titik bercahaya di Beranda, tersambung benang tipis sesuai
  urutan dibuat (plus benang samar scene→bab & chapter→cerita). Hover = jenis, judul, kapan dibuat & cuplikan; **klik =
  langsung membuka dokumen itu** di tab-nya. Titik bisa diseret (posisi disimpan), nama ikut berubah saat diganti, dan
  hilang saat dokumennya dihapus. Project lama otomatis disusun dari waktu pembuatan. Tombol **filter** di kanan untuk
  memilih jenis yang tampil & menyalakan/mematikan benang; garis urutan scene lama jadi opsi di menu "…".
- **Alat baru "Dokumen"** (ke-4 di toolbar, pintasan D): ubin bergambar Kartu, Peta, Kanvas, Jejaring, Timeline,
  Scene, Cerita → pilih dari daftar (bisa cari) atau "Buat baru" → taruh di kanvas sebagai **kartu pratinjau**
  (cuplikan scene, potret tokoh, peta mini, strip timeline, avatar jejaring, sampul cerita). Klik dua kali / "Buka" untuk
  membuka dokumennya; kartu bisa diubah ukuran, dipindah, dihubungkan.
- Tombol **ganti tema** di rail dashboard dihapus (tema diatur di Pengaturan Akun → Tema tampilan).
- **Simpan di perangkat dulu + sinkron dengan deteksi konflik** (`novelist-sync.js`, dimuat setelah `app.js`; file yang
  sama dipakai aplikasi Android, repo Web-Novel-Writer-Android). Tidak ada kode `app.js` yang diubah — fungsi simpan/muat
  Drive dibungkus dari file itu.
  - Setiap simpan langsung ditulis ke IndexedDB `novelist-sync` (per akun Google), baru dikirim ke Drive. Koneksi putus /
    sesi Google habis: tulisan tetap aman di browser dan dikirim otomatis saat online / setelah login lagi (indikator
    sinkron di dashboard — atau status simpan di editor — bisa diklik untuk sinkron sekarang atau login ulang).
  - Sebelum mengunggah, `modifiedTime` file di Drive dicek. Diubah dari perangkat lain (mis. HP) sementara di sini tidak
    ada suntingan → versi Drive langsung dimuat (tab yang aktif tetap). Dua-duanya disunting → dialog **Versi project
    berbeda**: *Simpan keduanya* / *Pakai versi web* / *Pakai versi Drive*; versi yang tidak dipakai disimpan dulu ke
    folder backup Drive. Tab yang dibiarkan terbuka tidak lagi menimpa tulisan dari perangkat lain.
  - "Disunting" = ada perubahan lewat `markDirtyAndSchedule` (mengetik, Organize, Quill, Map, Timeline, Beranda, Jejaring,
    …). Sekadar membuka tab Beranda/Jejaring/Timeline/Map (yang menambahkan struktur bawaannya ke project) tidak dihitung.
  - Project yang terbuka dicek ke Drive saat tab kembali aktif dan tiap 2 menit; dashboard ikut menampilkan project baru
    / menghapus project yang dipindah ke Trash dari perangkat lain. Hapus project saat offline diproses begitu online.
  - Hapus akun ikut menghapus IndexedDB `novelist-sync`.

### v0.11.0

- **Fitur baru: Jejaring Tokoh** (tab baru, tambahkan lewat tombol + → "Jejaring Tokoh") — pohon/jejaring hubungan
  antar-tokoh.
  - **Wizard 2 langkah:** pilih jenis — **Keluarga**, **Perusahaan**, **Militer**, **Istana Kerajaan** atau
    **Mulai kosong** — dengan pratinjau langsung; lalu atur jenis hubungan (ikon, nama, garis lurus/putus-putus,
    warna, arah, tambah/hapus) → "Buat jejaring".
  - **Kanvas kartu tokoh:** kartu potret (foto + nama) dengan tombol **+** di keempat sisi → menu hubungan (atas =
    orang tua, bawah = anak, samping = pasangan/saudara), "Buat kustom", "Tautkan tokoh yang ada…" (dari Organize),
    "Lewati dulu". Garis penghubung berlabel ikon + nama; klik garis untuk ganti jenis, balik arah, atau hapus.
  - **Toolbar kartu:** Buat kartu (jadikan tokoh di Organize), Tautkan kartu, Foto, Emoji, Label, Hapus.
    **Toolbar bawah:** Pilih, Geser, Tambah tokoh, Catatan, Teks, Label. **Lembar** ("Utama" + tambah lembar),
    **Rapikan** (tata otomatis per generasi), undo/redo, duplikat, zoom & geser seperti Beranda.
  - Beberapa jejaring per project (dropdown judul), tersimpan di project (`data.jejaring`) & tampil di riwayat sidebar
    tab. File: `jejaring.js`, `jejaring.css`.
- **Tab Tulis dirombak jadi lebih nyaman:**
  - **Halaman tulis di tengah** (lebar bisa diatur): label "Bab · Scene i dari n", judul besar dengan ornamen,
    chip status (klik untuk ganti Todo/Draft/Done), jumlah kata & waktu baca, sinopsis yang bisa diedit, toolbar
    format yang menempel di atas (paragraf/judul, tebal/miring/garis bawah/coret, daftar, rata, pemisah adegan ✦ ✦ ✦,
    undo/redo) + gelembung format saat memilih teks; tempel dari Word/Docs dibersihkan.
  - **Daftar scene "Naskah":** titik status, jumlah kata, cari (dengan sorotan), bab yang bisa dilipat, tombol
    "+ Scene" & "+ Bab", seret untuk mengurutkan (juga Alt+↑/↓), pratinjau saat hover, bar progres status; bisa
    disembunyikan (Ctrl+\) dan jadi laci di HP.
  - **Bar bawah:** statistik, kata per sesi / **target harian** (disimpan di project), zoom, mode fokus, status simpan.
  - **Pengaturan scene** dirapikan (info scene + pindah bab, tampilan editor: Serif/Sans/Mono, lebar halaman, jarak
    baris, ukuran) dan menempel di samping halaman di layar lebar.
  - Perbaikan: jumlah kata saat pertama dibuka kini benar; scene aktif langsung tersorot saat project dibuka.

### v0.10.1

- **Beranda jadi kanvas yang bisa digeser & di-zoom** (React Flow, seperti kanvas di vvd): tampil di panel kaca
  berbingkai dengan dot-grid.
  - **Navigasi:** seret area kosong = geser (Shift+seret = kotak pilihan), alat Geser / Spasi+seret selalu menggeser,
    roda mouse / dua jari = geser, Ctrl/⌘+roda atau cubit = zoom (20–250 %). Posisi tampilan diingat per papan.
  - **Scene** tampil sebagai titik bernama yang bisa diseret (posisinya disimpan); klik = buka di Tulis, hover =
    status, folder, sinopsis & jumlah kata. Garis putus-putus antar-scene tetap ada (bisa disembunyikan).
  - **Toolbar bawah:** Pilih (V), Geser (H), Bentuk (S), Catatan tempel (N), Gambar (I), Penghubung/panah (C),
    Teks (T), Frame (F). Objek bisa diubah ukuran, diedit (klik dua kali), diwarnai, diduplikat (Ctrl+D), dihapus,
    disalin-tempel, undo/redo (Ctrl+Z / Ctrl+Shift+Z), dipindah ke depan/belakang (Ctrl+] / Ctrl+[). Frame ikut
    membawa objek di dalamnya.
  - **Header panel:** dropdown papan (ganti, papan baru, ubah nama, hapus, tambah scene ke papan lain), zoom %,
    daftar "Pintasan", menu "…" (pas ke layar, 100 %, minimap, ekspor PNG, bersihkan papan), perbesar & tutup;
    tombol zoom/pas/minimap di tepi kanan.
  - Data tersimpan di project (`data.canvas`, ikut autosave Drive); project lama otomatis memakai tata letak lama.
    Tombol Delete hanya bekerja saat Beranda tampil & tidak sedang mengetik. File: `home-canvas.js`, `home-canvas.css`.

### v0.10.0

- **Tab project bisa ditutup & dibuka (tidak bertumpuk lagi):** topbar project kini hanya menampilkan tab yang
  sedang terbuka. Tab aktif berupa pil berikon + label (diwarnai warna project), tab lain berupa ikon bulat. Tutup tab
  dengan × (muncul saat disorot), klik tengah, atau Delete; urutkan dengan seret atau Alt+Shift+←/→. Project baru
  dibuka dengan Beranda, Tulis & Organize. Bila tab penuh, deretannya bisa digeser.
  - **Tombol +** membuka jendela **"Tambah tab"** di tengah layar: kotak cari + kartu fitur (Beranda, Tulis, Quill,
    Organize, Timeline, Map, Plot, Schedule, Tools) dengan deskripsi singkat & tanda "Terbuka"; bisa pakai panah + Enter.
  - Kalau semua tab ditutup, tampil halaman "Kamu ada di <project>" dengan chip fitur & kotak "Cari fitur…".
  - Fitur lain yang membuka tab tertutup (mis. buka scene dari Timeline) otomatis menambahkan tabnya lagi.
  - Pilihan Scene | Quill di tab Tulis tersinkron dengan tab Tulis & Quill.
- **Sidebar tab (kiri):** dibuka/ditutup lewat tombol paling kiri di topbar. Berisi pencarian "Cari tab…", daftar
  **Terbuka** (tab beserta dokumen yang sedang dibuka di dalamnya; klik untuk pindah, × untuk menutup, seret untuk
  mengurutkan) dan **Riwayat** (scene, item Organize, timeline, peta & cerita Quill yang pernah dibuka, dengan waktu
  "baru saja", "5 menit lalu"; klik untuk membuka lagi, × untuk menghapus, "Bersihkan riwayat"), plus deretan ikon
  cepat di bawah. Di layar lebar menempel di kiri, di HP/tablet (≤ 900 px) muncul sebagai laci. Status tab & riwayat
  disimpan di perangkat ini (tidak memicu simpan ke Drive).
- **Scrollbar modern + scroll halus (Lenis 1.3.26):** scrollbar abu-abu bawaan browser diganti scrollbar ramping
  yang melayang di tepi area (muncul saat menggulir, menebal & berwarna aksen saat disorot, bisa diseret, klik jalur
  untuk lompat, hilang sendiri saat diam). Gulir roda mouse/trackpad kini halus berkat [Lenis](https://lenis.dev)
  di Quill (termasuk halaman Terbitkan), Pengaturan Akun, Tulis/Organize, daftar Timeline & Map, Cloud Library,
  dashboard, sidebar & modal. Timeline, Map & kanvas tetap memakai gulir/zoom asli. Lenis otomatis mati di "Mode hemat
  performa" & "kurangi gerakan" (scrollbar baru tetap ada); di HP gulir sentuh tetap asli. Area lain memakai
  scrollbar tipis bergaya baru. File: `smooth-scroll.js`, `smooth-scroll.css`, `vendor/lenis-1.3.26.min.js`.

### v0.9.9

- **Quill — fitur menulis cerita di dalam tab Write.** Di atas tab Write ada pilihan **Scene | Quill** (diingat per
  project); "Scene" tetap editor lama.
  - **Pustaka "Cerita Saya"** berisi buku-buku 3D, plus "Cerita baru".
  - **Buat/edit cerita:** buku 3D (CSS) yang miring mengikuti kursor & bisa diputar; tab **Gaya buku** (Hardcover /
    Paperback / Sampul kertas), **Sampul** (unggah gambar, warna/gradasi) dan **Teks** (font & warna judul, nama
    penulis).
  - **Halaman cerita:** daftar chapter (seret untuk mengurutkan, hapus), "Tulis chapter pertama", edit sampul, hapus cerita.
  - **Editor chapter:** sidebar chapter, judul serif "Chapter I" dengan ornamen, gambar header, toolbar (paragraf/
    judul/kutipan, ukuran, tebal/miring/garis bawah/coret, daftar, rata, pemisah adegan, gambar, undo/redo), hitungan
    kata. Teks yang ditempel dibersihkan dari kode berbahaya.
  - Bar bawah: **Putar** (mode baca seperti buku, 2 halaman di layar lebar), **Audio** (dibacakan suara browser,
    suara Indonesia diutamakan), **Tulis**, **Terbitkan** (unduh **EPUB**, **Word .doc**, **HTML**).
  - **Panel kanan editor (alat & tile):** tombol alat **Draf** (simpan/pulihkan versi chapter, otomatis tiap
    buka chapter bila > 30 menit, maks. 20), **Gaya** (font termasuk OpenDyslexic, ukuran, jarak baris & paragraf,
    indentasi, lebar halaman, tema kertas Gelap/Kertas/Sepia — berlaku di editor & mode Putar), **Pohon relasi**
    (peta hubungan karakter dari Organize dengan React Flow, relasi berlabel), **Kanvas** (papan bebas: catatan
    tempel berwarna & gambar, geser/ubah ukuran), **Map** (buka peta project di tab Map) dan **Model 3D** (segera).
    Tile: **Kartu dunia** (cari karakter/lokasi/catatan, sisipkan namanya), **Kartu terdeteksi** (item Organize yang
    disebut di chapter, diperbarui saat mengetik), **Catatan chapter**, **Papan suasana** (kumpulan gambar) dan
    **Grafik dunia** (siapa/di mana muncul di chapter mana). Tile bisa ditutup & ditambah lagi, dan ada tab panel sendiri.
  - Data cerita tersimpan di dalam project (ikut autosave & backup Google Drive); gambar diperkecil otomatis.
- **Pengaturan Akun → Aksesibilitas:** **Ukuran teks** (Bawaan 100 % / Sedang 105 % / Besar 110 % / Sangat besar 120 %,
  hanya memperbesar teks), **Font ramah disleksia** (OpenDyslexic, disimpan di `vendor/fonts/`) dan **Mode hemat
  performa** (mematikan blur & transparansi; otomatis mengikuti pengaturan sistem sampai dipilih). Semua disimpan di
  perangkat ini dan langsung berlaku sejak halaman dimuat (termasuk halaman login).
- **Pengaturan Akun → Zona berbahaya → Hapus akun:** setelah mengetik `HAPUS`, folder Novelist di Google Drive
  (project, backup, trash) dipindah ke **Sampah Google Drive** (masih bisa dipulihkan 30 hari), semua data Novelist di
  perangkat ini dihapus, akses Google dicabut, lalu kembali ke halaman login. Kalau ada yang gagal, semuanya
  dikembalikan dan kamu tetap login.
- Tombol "Keluar dari akun" di halaman akun dihapus (logout tetap ada di sidebar & menu pengaturan).
- Perbaikan tata letak kecil: topbar project di lebar 701–860 px tidak lagi meluber, judul project di HP tidak
  menabrak status "Tersimpan", panel Scene Settings tidak lagi tertutup topbar.

### v0.9.8

- **Map 2D kini tampil seperti Map 3D:** warna & pola tiap bioma memakai palet yang sama dengan 3D (rumput, ladang
  berpagar semak, retakan, genangan rawa, bukit pasir, tundra berawan, gunung berbatu berkaki rumput, salju di puncak
  tertinggi), pencahayaan bukit dari arah matahari yang sama, laut dengan bercak awan terang, cincin air dangkal
  toska, buih putih & garis tinta pantai. **Pohon & puncak gunung** kini memakai model kartun yang sama dengan 3D
  (digambar sebagai sprite bergaris tepi, sedikit dari atas) di posisi yang sama. Contoh warna di panel kuas juga
  dibuat dari renderer 2D yang baru. Menggambar ulang malah sedikit lebih cepat; format data peta tidak berubah.
- **Perbaikan Map 3D:** bintik-bintik cyan di bioma gurun hilang (warna bukit pasir yang terlalu terang tidak lagi
  "melingkar").
- **Ganti background dashboard (Pengaturan Akun → Tampilan):** pilih gambar sendiri ("Ganti background…" atau
  seret-lepas gambar ke baris Background) untuk menggantikan foto ngarai di dashboard. Tampilannya tetap seperti
  sebelumnya: di-blur, dengan vignette & dot-grid di atasnya. Ada slider **Blur** (0–30 px, bawaan 6 px) dan **Redup**
  (0–80 %, bawaan 30 %), plus "Kembalikan bawaan". Project tanpa sampul juga memakai background ini. Di tema terang,
  background custom tetap tampil dengan lapisan terang supaya teks terbaca. Gambar diperkecil otomatis (maks.
  2560 px) dan disimpan di perangkat ini (IndexedDB), jadi tetap ada setelah halaman dibuka ulang.
- **Sidebar kiri dashboard bisa dibuka-tutup:** klik **logo di kiri atas** untuk membuka/menutup rail ikon, atau
  arahkan kursor ke **tepi kiri layar** sebentar untuk membukanya otomatis. Setelah terbuka, sidebar tetap terbuka
  (tidak menutup sendiri) sampai logo diklik lagi. Status buka/tutup diingat. Pengguna baru melihat petunjuk kecil di
  samping logo. Di HP (≤ 700 px) bar bawah tetap selalu tampil seperti sebelumnya.

### v0.9.7

- **Semua ikon diganti ke Tabler Icons** ([tabler.io/icons](https://tabler.io/icons), MIT) — ikon lama (SVG gaya lama,
  emoji, dan karakter seperti `+ ← ⋮ × ☁ 🗑 📄`) diganti ikon garis yang modern dan sesuai fungsinya, di semua
  halaman: login (logo Google/Discord/Apple), dashboard, menu, tab project (Home, Write, Organize, Plot, Schedule,
  Tools, Timeline, Map), pohon scene, panel Scene Settings & tombol format teks, Cloud Library, toast/notifikasi,
  status sinkron, Timeline, dan editor Map (termasuk ikon jenis tempat: kota, desa, kastel, pelabuhan, dll.).
  - Hanya ikon yang dipakai yang disimpan: `vendor/tabler-icons.js` (sprite ±104 ikon, ±27 KB, tanpa CDN).
  - Cara pakai di kode: HTML `<svg class="ti"><use href="#ti-home"></use></svg>`, JS `tiIcon("home")`.
    Setelah menambah ikon baru jalankan `cd tools && npm run build:icons` (`tools/build-icons.mjs` memindai kode dan
    gagal bila ada nama ikon yang tidak ada di Tabler).
- **Jendela Pengaturan Akun (setelah login)**, mirip referensi vvd:
  - Menu gear di kiri bawah dirombak: **Pengaturan Akun**, Ganti Tema, Cloud Library, Bantuan & Panduan, Keluar.
  - Rail kiri dashboard punya tombol **Project** (grid) dan **avatar akun** (foto profil Google).
  - Halaman akun: foto profil (bisa diganti), nama, email, "Member sejak …"; bagian **Profil** (username, edit
    profil publik: nama tampilan & foto, tema tampilan, email), **Metode masuk** (Google terhubung + tombol Putuskan;
    Email, Apple, Discord menyusul), **Penyimpanan** (pemakaian Google Drive, jumlah project, link ke Drive), **Paket**
    (Gratis), dan tombol **Keluar dari akun**. Bisa juga dibuka dari sidebar project.
  - Data akun dibaca dari Google Drive API (`about`) dengan izin yang sudah ada (tanpa izin baru). Username, nama
    tampilan & foto custom disimpan di browser perangkat ini. Pilihan tema kini diingat.
- **Ganti gambar halftone di halaman login:** tombol baru di **pojok kiri bawah** halaman login → "Unggah gambar…"
  (atau seret-lepas gambar ke kolom kiri) untuk mengganti gambar karakter halftone dengan gambar sendiri, dan
  "Kembalikan gambar bawaan" untuk kembali ke default. Gambar otomatis diperkecil (maks. 1600 px) dan disimpan di
  perangkat ini (IndexedDB), jadi tetap ada setelah halaman dibuka ulang. Tombol hanya tampil di layar lebar (>900 px),
  sama seperti kolom gambarnya.
- **Perbaikan:** setelah logout lalu login dengan akun Google lain di tab yang sama, project kini dibaca dari folder
  Drive akun yang baru (sebelumnya masih memakai ID folder akun lama).

### v0.9.6

- **Perbaikan deploy Cloudflare Workers:** alat build (`package.json`, `package-lock.json`, `tailwind.input.css`)
  dipindah dari root repo ke folder `tools/`. Saat `package.json` ada di root, Cloudflare Workers Builds menganggap
  situs ini proyek Node dan deploy gagal (sejak v0.9.4). Root repo kembali berisi situs statis saja; isi `vendor/`
  tidak berubah (hasil build ulang identik). Membangun ulang library/CSS sekarang: `cd tools && npm install && npm run build`.

### v0.9.5

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
    `tools/tailwind.input.css`. **Tanpa preflight** dan semuanya di dalam `@layer`, jadi `style.css` tetap menang dan tampilan
    lama tidak berubah. Kelas dipindai dari `components/ui`, `index.html`, `app.js`, `map-ui.js`, `timeline.js` — setelah
    menambah kelas Tailwind baru jalankan `cd tools && npm install` (sekali) lalu `npm run build:css`.
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
  - Semua library React (Base UI, Radix, shadcn) dibangun ulang dengan `cd tools && npm run build:vendor` (`tools/build-vendor.mjs`,
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
├── jejaring.js, jejaring.css   (Jejaring Tokoh: wizard + kanvas pohon hubungan)
├── home-canvas.js, home-canvas.css   (kanvas Beranda: papan React Flow + toolbar)
├── smooth-scroll.js, smooth-scroll.css   (scrollbar custom + Lenis smooth scroll)
├── quill.js, quill.css, quill-tiles.js   (fitur Quill di tab Write: cerita, buku 3D, editor chapter, panel alat)
├── map-core.js, map2d.js, map3d.js, map-ui.js   (fitur Map: data, editor 2D, tampilan 3D, UI tab)
├── vendor/   (react, react-dom, reactflow, three.js r169 + OrbitControls, motion 13.4.3, base-ui 1.8.0,
│              radix-ui 1.6.7, shadcn-ui, tailwind.css, tabler-icons.js (sprite ikon), lenis 1.3.26, fonts/ (OpenDyslexic) + lisensinya)
├── components/ui/*.tsx, lib/utils.ts, components.json   (kode sumber shadcn/ui)
├── tools/   (package.json, tailwind.input.css, build-vendor.mjs, build-icons.mjs — hanya untuk membangun ulang vendor/: cd tools && npm install && npm run build)
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
