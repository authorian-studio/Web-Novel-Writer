# Novelist Web — v0.1

Aplikasi menulis novel minimalis (mirip Scrivener) yang jalan di **browser**,
di Windows maupun Android — tidak perlu install apa pun selain browser.
Bisa disimpan/dibuka lewat Google Drive, atau diunduh sebagai file `.novj` biasa.

## Cara Coba Sekarang (paling gampang)

1. Extract zip ini.
2. Buka file `index.html` langsung dua kali klik di file explorer (akan
   terbuka di browser). **Catatan:** fitur "Unduh file" dan editor tetap
   jalan normal dengan cara ini, tapi login Google Drive **tidak akan
   berfungsi** kalau dibuka lewat `file://` — Google mengharuskan web
   dibuka lewat alamat `http://` atau `https://` (lihat bagian di bawah).

## Cara Hosting supaya Google Drive Berfungsi (gratis, pilih salah satu)

### Opsi A — GitHub Pages (paling gampang untuk online 24 jam)
1. Buat repo baru di GitHub, upload semua file di folder ini.
2. Settings > Pages > Branch: main > Save.
3. Tunggu 1-2 menit, dapat URL seperti `https://namakamu.github.io/novelist-web/`.
4. Daftarkan URL itu di Google Cloud Console (lihat bagian bawah).

### Opsi B — Coba di komputer sendiri dulu (lokal)
Kalau pakai VS Code, install extension **"Live Server"**, klik kanan
`index.html` > "Open with Live Server". Biasanya akan jalan di
`http://127.0.0.1:5500`.

## Setup Google Drive Login

1. Buka https://console.cloud.google.com/ → buat project baru.
2. "APIs & Services" > "Library" → cari **Google Drive API** → Enable.
3. "APIs & Services" > "OAuth consent screen"
   - User type: External → isi nama app & email → Save
   - Tambahkan emailmu sendiri di bagian "Test users"
4. "APIs & Services" > "Credentials" > "Create Credentials" > "OAuth client ID"
   - Application type: **Web application**
   - Di "Authorized JavaScript origins", tambahkan alamat tempat kamu
     buka web ini, contoh:
     - `http://127.0.0.1:5500` (kalau pakai Live Server)
     - `https://namakamu.github.io` (kalau pakai GitHub Pages)
   - Klik Create → salin **Client ID**
5. Buka file `config.js`, ganti `GOOGLE_CLIENT_ID` dengan Client ID kamu.
6. Buka ulang web-nya, klik "☁ Drive" > "Login dengan Google".

Project akan tersimpan sebagai file `.novj` di folder Google Drive bernama
**"Novelist Web Projects"**. Untuk buka di HP Android atau laptop lain:
buka web yang sama di browser, login Google yang sama, klik "☁ Drive",
lalu pilih project dari daftar — tinggal pencet dan lanjut menulis.

## Pakai di Android

Karena ini web biasa, di Android tinggal:
1. Buka URL hosting-nya (GitHub Pages, dll) di Chrome Android.
2. Menu (⋮) > "Add to Home Screen" / "Install app".
3. Ikon akan muncul di homescreen dan terbuka seperti aplikasi biasa
   (full screen, tanpa address bar) — ini yang disebut PWA.

## Fitur v0.1
- Binder/organizer: Manuskrip (scene), Karakter, Lokasi, Catatan
- Editor rich text dasar (bold/italic/underline/heading) + hitung kata
- Mode Fokus & tema gelap/terang
- Login Google Drive → simpan & buka project dari cloud
- Autosave otomatis ke Drive tiap 30 detik (kalau sudah login)
- Simpan/buka file `.novj` manual ke/dari perangkat (tanpa perlu Drive)
- Responsif — layout menyesuaikan di layar HP

## Batasan yang perlu diketahui
- Data project **tidak** disimpan otomatis di browser (tidak pakai
  penyimpanan lokal browser) — supaya aman dan konsisten, sumber
  kebenaran datanya adalah Google Drive atau file `.novj` yang kamu unduh.
  Jadi kalau menutup tab sebelum sempat simpan ke Drive / unduh, isi
  tulisan bisa hilang. Ke depan bisa ditambahkan pengingat/autosave lokal.
- Login Google akan minta ulang tiap kali reload halaman (token tidak
  disimpan permanen) — ini bisa ditingkatkan nanti kalau mau (misalnya
  pakai refresh token lewat server kecil).

## Rencana Selanjutnya
- Ingatkan otomatis kalau ada perubahan belum tersimpan sebelum menutup tab
- Export ke DOCX / EPUB / HTML
- Tag & metadata untuk karakter/lokasi
- Drag & drop reorder di binder
