// =============================================================
// KONFIGURASI GOOGLE DRIVE (WEB)
// =============================================================
// 1. Buka https://console.cloud.google.com/ -> buat project baru.
// 2. "APIs & Services" > "Library" > cari "Google Drive API" > Enable.
// 3. "APIs & Services" > "OAuth consent screen"
//    - User type: External -> isi nama app & email -> Save
//    - Tambahkan emailmu di "Test users"
// 4. "APIs & Services" > "Credentials" > "Create Credentials" > "OAuth client ID"
//    - Application type: "Web application"
//    - Di "Authorized JavaScript origins" tambahkan URL tempat web ini
//      kamu buka, misalnya:
//        http://localhost:5500          (kalau dites lokal pakai Live Server)
//        https://namakamu.github.io      (kalau dihost di GitHub Pages)
//    - Create, lalu salin "Client ID" ke bawah ini.
// =============================================================

const GOOGLE_CLIENT_ID = "ISI_CLIENT_ID_KAMU_DI_SINI.apps.googleusercontent.com";
const GOOGLE_SCOPES = "https://www.googleapis.com/auth/drive.file";
const DRIVE_FOLDER_NAME = "Novelist Web Projects";
