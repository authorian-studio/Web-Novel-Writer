// =============================================================
// KONFIGURASI GOOGLE DRIVE (WEB) — WAJIB DIISI
// =============================================================
// 1. Buka https://console.cloud.google.com/ -> buat project baru.
// 2. "APIs & Services" > "Library" > cari "Google Drive API" > Enable.
// 3. "APIs & Services" > "OAuth consent screen"
//    - User type: External -> isi nama app & email -> Save
//    - Tambahkan emailmu di "Test users"
// 4. "APIs & Services" > "Credentials" > "Create Credentials" > "OAuth client ID"
//    - Application type: "Web application"
//    - Di "Authorized JavaScript origins" tambahkan URL tempat web ini dibuka
//        contoh: https://namakamu.github.io
//    - Create, lalu salin "Client ID" ke bawah ini.
// =============================================================

const GOOGLE_CLIENT_ID = "ISI_CLIENT_ID_KAMU_DI_SINI.apps.googleusercontent.com";
const GOOGLE_SCOPES = "https://www.googleapis.com/auth/drive.file";

// Dua folder terpisah di Drive: satu untuk file project aktif,
// satu lagi khusus backup otomatis (supaya aman kalau file utama korup/kehapus).
const DRIVE_FOLDER_NAME = "Novelist Web Projects";
const DRIVE_BACKUP_FOLDER_NAME = "Novelist Web Backups";

// Interval autosave & backup (ms)
const AUTOSAVE_DEBOUNCE_MS = 1500;     // simpan ke Drive 1.5 detik setelah berhenti mengetik (lebih instan)
const AUTOSAVE_MAX_WAIT_MS = 8000;     // walau terus mengetik tanpa jeda, tetap dipaksa simpan tiap 8 detik
const BACKUP_INTERVAL_MS = 3 * 60000;  // buat salinan backup bertimestamp tiap 3 menit
const MAX_BACKUPS_PER_PROJECT = 6;     // backup lama otomatis dihapus, sisakan yang terbaru
