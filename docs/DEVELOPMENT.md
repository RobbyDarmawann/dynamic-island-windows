# Dynamic Island buat Windows 11 — v1.12 (LIRIK BISA DITEKAN + RILIS .EXE)

**Terakhir dari Leonardo: v1.11 sisanya sudah oke** (chat stop/kunci, panel lirik, garis putih) — tinggal satu fitur + port ke .exe.

**Baris lirik bisa ditekan:** tiap baris lirik tersinkron sekarang bisa diklik (ada hover + tooltip) → lagu **langsung loncat ke detik baris itu dinyanyikan**, memakai rantai seek yang sama dengan garis progres; perkiraan waktu lokal diperbarui seketika jadi highlight-nya langsung pindah ke baris yang ditekan.

## Cara build .exe (di Windows Leonardo)

```powershell
cd D:\Proyek\dynamic-island-windows
taskkill /F /IM electron.exe   (kalau island lagi jalan)
npm install
npm run dist
```

Hasilnya di folder `dist\`:
- **Dynamic Island Setup 1.12.0.exe** — installer (bisa pilih folder, bikin shortcut desktop). Sesudah terpasang, aplikasi **jalan otomatis tiap Windows nyala** (autostart cuma aktif di versi terpasang) dan tidak bisa kebuka dobel (kunci satu instance baru di v1.12).
- **Dynamic Island 1.12.0.exe** — versi portable (sekali klik langsung jalan, tanpa install).

Sudah diaudit buat rilis: konfigurasi electron-builder lengkap (appId, target NSIS + portable), ikon `assets/icon.png` 512×512 valid, pengaturan + API key tersimpan di userData (aman dari reinstall), server bridge punya penanganan error port. Catatan: build-nya memang harus di Windows (electron-builder mengemas binary Windows) — makanya perintahnya dijalankan di PC Leonardo, bukan di sandbox ini.

Dari screenshot Leonardo: v1.10 **Gemini SUDAH BALAS** ("Halo! Ada yang bisa saya bantu hari ini?") dan placeholder cover tampil bagus — tapi beliau minta tiga hal:

**1. Chat ala aplikasi Gemini asli.** Kemarin pas nunggu, user masih bisa kirim pesan dobel (bubble "lagi mikir" numpuk dua) dan tidak ada cara menghentikan. Sekarang: pas Gemini mikir, **input terkunci**, bubble mikir pakai **tiga titik animasi + status model yang lagi dicoba** (progres disiarkan main → renderer: "Mikir pakai gemini-3.8-flash..." / "lagi rame, nyoba lagi..."), dan **tombol kirim berubah jadi tombol STOP** berdenyut yang membatalkan permintaan beneran (AbortController dilacak di main; renderer cuma kirim sinyal batal). Sudah diuji runtime dua skenario: stop di tengah fetch menggantung → berhenti 301ms dengan pesan bersih "Dibatalkan."; jalur anti-503 tetap jalan.

**2. Fitur lirik.** Tombol lirik baru (ikon teks) di deretan kontrol mode musik → panel lirik di bawah bar (mode `lyrics` 496×384, animasi masuk ala Dynamic Island). Sumbernya **LRCLIB** (API publik gratis tanpa key, diambil dari main): pasangan judul+artis+durasi persis dulu, cadangan pencarian dengan pemilihan durasi terdekat, judul dibersihkan dari embel-embel "(Official Video)" dsb., hasil di-cache per lagu. Lirik tersinkron (LRC) **menyala per baris + auto-scroll** ngikutin progres lagu; teks biasa tampil statis. Bisa disembunyikan lewat tombol yang sama / chevron / Esc; ganti lagu pas panel kebuka → lirik ikut ganti (tidak diusir ke mode musik). Pesan "tidak ketemu" dibedakan dari "LRCLIB tidak bisa dihubungi" (yang kedua tidak di-cache biar bisa dicoba lagi). Endpoint LRCLIB diverifikasi hidup dari sini (search 200; get "Love Story" Taylor Swift 200 + syncedLyrics ada).

**3. Garis putih di tampilan musik.** Di screenshot placeholder, tepi kiri-kanan kotak cover terlihat bergaris putih terang. Tersangka mekanisnya: ring `inset box-shadow` di layar Windows berskala (125/150%) ninggalin jahitan subpiksel terang. Di v1.11 **semua ring inset di island + cover + placeholder diganti border 1px beneran** yang tergambar tegas ngikutin lengkungan (border-top island tetap none karena nempel layar).

Sesudah ini bersih → port ke .exe (`npm run dist`).

**Gemini anti-503 (dari log Leonardo):** v1.9 sudah manggil Google beneran, tapi pas model lagi penuh user ketemu `503 high demand` dan chat langsung nyerah sambil nampilin JSON mentah — fallback kemarin cuma jalan buat 404. v1.10 menulis ulang mesin pemanggilnya: status 429/500/502/503/504 = coba ulang model yang sama sekali (jeda 1,2 detik) lalu **loncat ke model berikutnya**; rantai diperluas (pilihan user → 3.8-flash → 2.5-flash → 2.5-flash-lite → 3.5-flash-lite → 2.0-flash); 401/403 tetap berhenti sebagai error key; pesan error selalu **satu baris bersih** hasil parsing pesan Google, dan kalau semua model penuh, bunyinya jelas: itu server Google yang overload, bukan key user. **Sudah diuji runtime dengan fetch bohongan dua skenario**: 503 di model awal → sukses dibalas flash-lite; semua model 503 → 10 percobaan lalu satu kalimat bersih. (Catatan build: pas nulis ulang ini sempat ada deklarasi ganda GEMINI_FALLBACKS — ketangkap `node --check` sebelum dikirim, sudah dibersihkan jadi satu.)

**Kotak cover kosong dikembalikan (koreksi arah dari v1.9):** Leonardo maunya kotak itu TETAP ADA seperti sebelumnya, cuma elegan dan tanpa garis putih — bukan dihilangkan. Sekarang: placeholder lengkung kaca gradien lembut + ikon nada SVG pudar di tengah + ring tipis samar + bayangan halus; berlaku pas belum ada lagu dan pas lagu tidak punya cover (kelas `no-art`).

Sesudah ini bersih → port ke .exe (`npm run dist`).

**Fix Gemini (regresi dari v1.8, kesalahan di sisi build):** pas edit handler tes koneksi di v1.8, konstanta `GEMINI_FALLBACKS` ikut terhapus — Tes Koneksi tetap OK (jalur lain), tapi tiap kirim chat error `ReferenceError: GEMINI_FALLBACKS is not defined`. Di v1.9 konstanta itu didefinisikan ulang eksplisit tepat di atas `callGemini` dengan rantai cadangan model hidup: model pilihan → gemini-3.8-flash → gemini-2.5-flash → gemini-2.5-flash-lite → gemini-2.0-flash. Sudah diaudit: tidak ada konstanta lain yang hilang, dan logika rantainya diuji jalan. (Dari screenshot Leonardo: key valid, model aktifnya gemini-3.8-flash dari daftar dinamis — itu semua memang sudah jalan.)

**UI awal dibersihkan:** pita highlight putih di tepi atas island dilembutkan (alpha 0.16 → 0.07) dan ring tepi dikurangi; latar island lebih solid (alpha 0.80–0.88 → 0.93–0.95) biar jendela di belakang tidak tembus seperti hantu; keadaan kosong pas program baru jalan tidak lagi menampilkan kotak cover hitam — kotak cover disembunyikan, teks dipendekkan ("Tekan tombol merah buat mulai", tidak kepotong lagi), garis progres disamarkan.

**Optimasi lanjutan (target: ringan di segala device):**
- `powerSaveBlocker` sekarang **dinamis**: nyala cuma pas ada lagu yang sedang main (saat dia berguna mencegah jeda), mati pas pause/kosong — laptop tidak lagi dicegah tidur 24/7.
- Polling YT pas island sembunyi: 3 detik → 5 detik.
- Penjaga kursor: interval 220ms → 300ms + gerbang murah (skip total kalau island kelihatan dan auto-hide mati).
- Renderer: penulisan DOM progres/waktu digerbangi — cuma menulis pas nilai beneran berubah (progres dibulatkan 0,3%, teks pas detik berganti).

Sesudah v1.9 bersih (khususnya: chat Gemini bales beneran) → port ke .exe (`npm run dist`).

**Koreksi bentuk:** v1.7 kemarin gua bikin pill melayang penuh — salah tafsir. Maksud Leonardo: island **nempel tepi atas**, lengkung **cuma di kiri-kanan bawah**. v1.8 balik ke bentuk itu (y=0, radius bawah 28px), tapi `clip-path`-nya dipertahankan karena itu yang terbukti menghilangkan sisa kotak di lengkungan (dikonfirmasi Leonardo sesudah v1.7: kotaknya hilang).

**Gemini 4 Argon — gua yang salah kemarin, dan ini koreksinya:** Argon itu ADA beneran: `gemini-4-argon`, flagship Gemini 4 (rilis 13 Okt 2026). Tangkapannya: di **API** dia cuma buat **tier berbayar** — langganan AI Pro ngasih Argon di *aplikasi Gemini*, bukan di kuota API, jadi key AI Studio tier gratis tidak akan menampilkannya. Solusi tuntas di v1.8: dropdown model sekarang **dimuat dinamis dari key kamu sendiri** (buka Pengaturan chat → daftar diisi dari endpoint model Google, difilter yang bisa generateContent). Yang muncul = yang beneran bisa kamu pakai; `gemini-4-argon` juga ditambah manual ke daftar bawaan + jadi opsi pertama. Aktifkan billing API di AI Studio kalau mau Argon beneran bisa dipilih.

**Fix tombol YT mati sesudah buka chat (akar masalah ketemu di kode):** kelas `loading` di tombol YT dulu mematikan klik (`pointer-events: none`) dan cuma lepas pas halaman YT selesai loading — padahal kalau view-nya sudah pernah loading, event itu tidak nembak lagi, jadi tombolnya mati permanen. Sekarang: pointer-events dibuang, main proaktif ngirim status 'loaded' tiap panel dibuka kalau view sudah siap, dan ada pengaman lepas-otomatis 5 detik di renderer.

**Fix cover + warna bg macet sesudah skip:** ekstraksi lagu diganti ke **Media Session API** sebagai sumber utama (data resmi yang YT Music publikasikan ke OS tiap lagu ganti: judul/artis/cover selalu segar), DOM player bar jadi cadangan saja — di embedded, ekstensi Chrome, dan bridge. Pewarna kaca juga dapat jalur cadangan: kalau ambil gambar cover kehalang CORS, gambar diambil lewat proses main (data URL) jadi warna tetap pindah.

**UI chat dipoles:** latar kaca bertingkat ngikutin warna lagu, nama model aktif tampil sebagai pill di header chat, bubble user gradien biru-ungu, bubble AI kaca berbingkai, scrollbar tipis, input pill dengan fokus ungu lembut, panel pengaturan jadi kartu.

Sesudah build ini bersih di mesin Leonardo → port ke .exe (`npm run dist`).

**Sisa kotak di lengkungan — pendekatan final:** island sekarang **pill melayang penuh** (semua sudut 28px, jarak 8px dari tepi atas; bukan notch nempel lagi) dan `#island` dipotong pakai `clip-path: inset(0 round 28px)` yang memangkas *seluruh* lukisan elemen ke bentuk pill — secara konstruksi tidak bisa ada sisa persegi lagi. Konsekuensinya bayangan luar elemen hilang (kena clip juga); diganti ring inset.

**Analisis stutter audio (sebelum fix, sesuai permintaan):** tersangka terkuat di kode kita sendiri: (1) `backdrop-filter: blur(22px)` di window transparan selalu-on-top = beban GPU konstan + jank DWM → **dibuang total**; (2) fitur Chromium *CalculateNativeWinOcclusion* men-throttle window yang dianggap tertutup → **dimatikan**; (3) Windows menidurkan proses latar → **powerSaveBlocker prevent-app-suspension dinyalakan**; (4) view YT diberi `autoplayPolicy: no-user-gesture-required` (pola ytmdesktop) biar playback tidak diganggu kebijakan gesture. Verifikasi di mesin user: dengarkan ±10 menit termasuk pas island animasi sembunyi/muncul — kalau masih stutter, catat kejadiannya pas apa (itu data buat putaran berikutnya; jangan port ke .exe dulu).

**Gemini:** alurnya: gear di panel chat → tempel key AI Studio → pilih model → **Simpan** (tersimpan cuma di PC ini) → chat langsung pakai model itu, 404 jatuh ke model cadangan otomatis. Langganan Google AI Pro ≠ kuota API: key AI Studio berdiri sendiri (tier gratis AI Studio punya batas sendiri), jadi model yang bisa dipakai = yang tersedia buat key itu di AI Studio. Daftar model sekarang: **gemini-2.5-pro**, **gemini-3-pro-preview**, 2.5-flash, 2.5-flash-lite, 2.0-flash — plus tombol **Tes koneksi** yang memvalidasi key ke endpoint daftar model Google dan ngasih tahu model pilihanmu beneran tersedia buat key itu atau tidak. (Tidak ada model bernama "argon" di Gemini API — kemungkinan itu nama dari aplikasi lain.)

**Warna bg natural:** ganti warna cover sekarang di-tween JS per frame (±900ms lerp) — variabel CSS mentah kemarin memang lompat patah karena transisi CSS tidak menginterpolasi isi variabel.

**Polesan terakhir sesuai screenshot user:** layout mode kecil ditata ulang total — urutannya sekarang cover → judul mini → equalizer di kiri, titik status + jam di kanan sebelum tombol aksi, semua gap seragam 9px, dan **label versi dihapus dari tampilan island** (tetap ada di log terminal buat diagnosis). Keadaan belum ada lagu: grup jam+status pindah ke tengah biar simetris, bukan kosong sebelah. Sisa latar di sekitar lengkungan dibersihkan: window diberi `backgroundColor` transparan eksplisit + `setHasShadow(false)`, border elemen island **dihapus** (diganti ring inset yang mengikuti lengkungan persis), dan bayangan luar diperhalus dari 60px/0.6 jadi 28px/0.32.

**Keluar dari mode panel (pertanyaan user pas lihat screenshot panel):** sekarang ada **tombol panah ke bawah di tengah-bawah panel** dan tombol **Esc** — dua-duanya mengecilkan island balik ke bar. Cara lama tetap bisa: klik tombol merah lagi, atau Ctrl+Shift+N.

**Durasi, dua-duanya dikerjain:**
- **Durasi lagu tampil**: di mode musik sekarang ada jam berjalan + total durasi (`1:23 / 3:45`) mengapit garis progres, dan **garis progresnya bisa diklik buat loncat (seek)** ke posisi itu — jalan di player embedded, dan perintah seek juga diteruskan ke jalur Chrome (ekstensi + bridge Tampermonkey diperbarui).
- **Durasi auto-hide bisa diatur**: tray → "Jeda sebelum sembunyi" → 3 / 5 / 8 / 12 detik (tersimpan).

**Glass + animasi:** island bukan hitam pekat lagi — tampilannya **kaca (glass) yang warnanya ngikutin warna dominan cover lagu** yang lagi muter (diambil dari artwork tiap lagu ganti, transisi warna ±0,9 detik; kalau cover tidak bisa dibaca, tint terakhir dipertahankan, default-nya slate netral). Resize window sekarang **dianimasikan easeOutQuart ±300ms** (dulu lompat satu langkah), cover lagu menyala-zoom halus pas lagu ganti.

**Optimasi CPU:** polling info lagu adaptif (panel kebuka 1 dtk, bar tampil 1,5 dtk, lagi sembunyi 3 dtk), cache volume PowerShell diperpanjang 1,5 → 20 detik (tiap panggilan itu compile C# — mahal), watcher kursor 150 → 220ms, dan animasi equalizer berhenti total pas lagu pause / island sembunyi.

**Login in-app SUDAH TERKONFIRMASI JALAN di v1.3** (pola ytmdesktop). v1.4 nambah perilaku + kontrol:

**Auto-hide (perilaku sembunyi):**
- Di mode bar (kecil/musik), island **menyusut sendiri jadi garis hitam kecil 168×9** setelah ±5 detik tanpa aktivitas.
- **Muncul lagi** kalau: kursor disentuhkan ke **tepi paling atas layar** (zona tengah), **lagu berganti** (island ngintip nampilin lagu baru ±3,5 detik, terus sembunyi lagi), panel/chat dibuka, **Ctrl+Shift+H**, atau dari menu tray.
- **Panel daftar lagu (mode musicapp) dan chat TIDAK ikut sembunyi** — selama daftar lagu kebuka island diam; auto-hide lanjut lagi setelah panel ditutup dan 5 detik berlalu.
- Atur di tray (klik kanan ikon island): centang **"Sembunyikan otomatis"** buat on/off (tersimpan), **"Sembunyikan sekarang"** buat manual. Itu beda dari "Sembunyikan total" lama yang ngilangin window sepenuhnya.

**Volume laptop:** di mode musik (arahkan kursor ke island / pas lagu ganti), di bawah kontrol lagu ada baris volume **sistem Windows beneran** (Core Audio via PowerShell, bukan volume player): geser slider buat atur level absolut, tombol speaker kiri/kanan buat turun/naik 5%, klik label persen buat mute/unmute. Kalau audio COM gagal terbaca, otomatis fallback ke tombol volume virtual — slider mati sendiri kalau dua-duanya gagal.

Tampilan: mode musik sedikit dilebarkan (496px) biar baris volume napasnya lega, transisi sembunyi/muncul pakai fade + susut ala notch.

**Hasil analisis repo ytmdesktop (yang dikirim user): app itu bisa login TANPA trik.** Di seluruh kodenya tidak ada spoof user-agent, tidak ada rewrite header client-hints, tidak ada matiin flag otomasi, tidak ada jendela login khusus. Yang dia lakukan cuma:
1. **Electron 45** (di package.json repo-nya) — Chromium-nya jauh lebih baru dari Electron 33 (Chromium 130) yang kita pakai sampai v1.2. "Browser may not be secure" adalah ember generik Google, salah satu isinya: engine browser kedaluwarsa.
2. YT Music dimuat di **satu view yang sama** (WebContentsView, partisi `persist:ytmview`, `sandbox: true`), dan login dibiarkan mengalir **di dalam view itu**: file `src/main/services/ytmviewmanager/index.ts` bikin whitelist domain (accounts.google.com dan semua domain Google, accounts.youtube.com, consent.youtube.com, youtube.com/signin|premium) yang boleh navigasi in-view; window.open dari halaman tidak dibuatkan popup — URL alur Google dimuat di view yang sama, sisanya dibuka ke browser eksternal.
3. Identitas browsernya **stock Electron apa adanya** — justru penyamaran kita di v1.0 (UA/header palsu yang tidak konsisten satu sama lain) bisa jadi sinyal negatif tambahan.

**v1.3 menyamakan ketiganya:** Electron dinaikkan 33 → 45 (WAJIB `npm install` ulang, lihat bawah), semua spoofing v1.0 dibuang total, view dibuat `sandbox: true` + `contextIsolation: true`, dan alur login diganti pola whitelist in-view di atas. Jendela login terpisah v1.0 dihapus. Catatan jujur: hasil akhir tetap keputusan server Google — tapi sekarang tidak ada lagi variabel yang beda dari app referensi yang terbukti bisa login.

**Upgrade Electron (sekali ini saja):** setelah timpa file, jalanin `npm install` — dia ngunduh Electron 45. Kalau start error "Electron failed to install correctly", jalanin `node node_modules\electron\install.js` sekali, terus `npm start` lagi. Terminal harusnya nulis: `Dynamic Island v1.3 SIAP. Electron 45.x / Chromium 140.x / UA stock: ...`.

Jalur Chrome v1.2 tetap berfungsi penuh sebagai cadangan (ekstensi/bridge tidak berubah) — kalau login embedded ini lolos, Chrome tidak perlu dibuka sama sekali.

Login Google di webview embedded ditolak Google di level kebijakan (dua putaran hardening sudah dicoba dan gagal). Keputusan final: **musik dan login tinggal di Chrome** (di sana kamu sudah login Premium dan tidak pernah ditolak), island jadi display + remote lewat ekstensi kecil. Panel embedded tetap ada sebagai cadangan (tray / Ctrl+Shift+M), tapi bukan jalur utama lagi.

**Yang berubah di v1.2:**
- Tombol merah di island sekarang **membuka YouTube Music di Chrome** (browser default). Klik cover/judul lagu di island juga sama.
- Alur harian: jalanin island → klik tombol merah → Chrome kebuka di YT Music (sudah login) → putar lagu → judul, cover, progres, dan kontrol play/next/prev jalan dari island. Tab Chrome boleh di-minimize; jangan ditutup.
- Ekstensi di folder `extension/` ngirim info lagu dari tab Chrome ke island tiap detik, dan neruskan perintah kontrol balik ke tab.

**Pasang ekstensi (SEKALI saja, GRATIS — bukan yang bayar 5 dolar; itu biaya publish ke Web Store buat publik, bukan buat pakai sendiri):**
1. Di Chrome, ketik di address bar: `chrome://extensions` lalu Enter.
2. Di kanan atas ada tombol **Developer mode** — nyalakan. (Ini cuma saklar di halaman itu, tidak ada pendaftaran, tidak ada pembayaran.)
3. Klik tombol **Load unpacked** yang muncul di kiri atas.
4. Pilih folder ini: `D:\Proyek\dynamic-island-windows\extension` lalu Select Folder.
5. Selesai — kartu "Dynamic Island — YT Music Bridge" muncul. Tidak perlu diapa-apain lagi, dia jalan sendiri tiap YT Music kebuka.

**Alternatif tanpa Developer mode sama sekali:** pakai file `bridge/yt-music-bridge.js` lewat ekstensi Tampermonkey (pasang Tampermonkey dari Web Store — gratis → Create a new script → hapus isinya → paste seluruh isi file bridge → Ctrl+S). Cara kerjanya sama.

**v1.1:** pill mode kecil dilebarkan (216 → 296px) dan jarak antar ikon dirapikan ulang — gap ikon aksi 9px, tombol 28px, padding bar lebih lega, isi pill kecil tidak lagi dempet-dempetan. Soal iklan: akun guest memang dari YouTube-nya dikasih iklan; yang menghilangkan iklan secara sah cuma login akun Premium asli (itu yang difasilitasi v1.0 di bawah).

**Fokus v1.0: login di dalam aplikasi + UI dibikin semirip Dynamic Island asli.**

### Login (tanpa browser luar)
Google kemarin nolak karena sesi aplikasi gampang dikenali bukan Chrome asli. Di v1.0 semua sinyalnya disamakan ke Chrome 130 beneran (sama dengan Chromium Electron 33):
- User-Agent global aplikasi + per sesi YT Music
- Header client hints (`sec-ch-ua` bermerek "Google Chrome", platform Windows) ditulis ulang untuk semua request ke Google/YouTube
- Flag otomasi Chromium tetap mati
- Klik **Sign in** di panel sekarang membuka **jendela login top-level milik aplikasi** (bukan popup kecil di panel, bukan Chrome) dengan sesi yang sama. Habis login berhasil (cookie sesi kedeteksi), jendela itu **nutup sendiri** dan panel island reload — akun Premium langsung kepakai di island.
- Menu tray juga punya item "Masuk ke YouTube Music" untuk buka jendela login kapan aja.

Jujur: yang mutusin lolos/tidak tetap server Google, tidak ada app pihak ketiga yang bisa jamin 100%. Tapi ini tumpukan teknik yang dipakai aplikasi Electron lain yang login Google-nya jalan, dan semua jalur resminya (ekstensi Chrome dari v0.7) tetap ada utuh sebagai cadangan terakhir — bukan jalan utama lagi.

### UI
- **Semua tombol sekarang ikon SVG** bergaya SF Symbols: skip, play/pause, tombol YouTube Music, sparkle Gemini, kamera, kirim, pengaturan, tutup. **Nol emoji/glyph teks** di UI (sudah diaudit pakai grep).
- Warna musik pakai merah Apple Music `#fc3c44`: equalizer, titik status, dan glow island pas lagu jalan.
- Material: hitam pekat nempel di atas, highlight radial halus di puncak, lengkungan kontinu cuma di bawah, bayangan berlapis, tipografi tabular untuk jam, progress bar lebih ramping dengan ujung bercahaya.
- Animasi sentuhan dipertahankan: island membal saat ganti mode, tombol membal saat ditekan, cover berdenyut saat lagu jalan.

### Cara update
`taskkill /F /IM electron.exe` → timpa file dengan zip v1.0 → `npm start` (tanpa install ulang). Klik tombol merah → panel kebuka → klik Sign in di panel → login di jendela aplikasi → tunggu jendela nutup sendiri → Premium kepakai di panel.

**Riwayat singkat:** v0.6 = renderer hidup lagi (fix `islandEl`). v0.7 = jalur ekstensi Chrome + klarifikasi biaya Web Store. v1.0 = login hardening + UI SVG total.

**v0.6 terbukti jalan** (island melebar, panel kebuka), dan risiko yang dari awal gua sebut kejadian beneran: **Google nolak login di panel embedded** — "This browser or app may not be secure". Screenshot user juga ngebuktiin akunnya sehat-sehat aja di Chrome (playlist kebaca, lagu muter).

**Jawaban jujur soal "loginnya dibawa ke Chrome":** sesi login Chrome *tidak bisa dipindah* ke app — cookie tiap browser dikunci terpisah, itu desain keamanan Google. Yang bisa (dan ini v0.7): **musiknya sekalian tetap hidup di Chrome**, island jadi display + remote-nya. Login tetap di Chrome seperti maunya user, tanpa paste console lagi:

**Pasang ekstensi (sekali aja):**
1. Di Chrome buka `chrome://extensions`
2. Nyalakan **Developer mode** (kanan atas)
3. Klik **Load unpacked**, pilih folder `extension` di dalam folder proyek ini
4. Refresh tab YT Music, putar lagu → dalam ±1 detik judul/cover muncul di island; tombol ⏮ ▶ ⏭ di island ngontrol Chrome

Ekstensinya kecil dan transparan: content script baca player bar YT Music → background service worker yang fetch ke `127.0.0.1:17890` (relay ini yang bikin tidak kena mixed-content/PNA, beda dari script console v0.1). Data tidak keluar dari komputer.

**Bonus percobaan:** di main sekarang flag `AutomationControlled` dimatikan (salah satu pemicu penolakan Google). Panel ♪ embedded layak dicoba login sekali lagi — kalau tetap ditolak, itu sudah keputusan Google, pakai jalur ekstensi.

**BIANG ASLINYA KETEMU (v0.6, dari log v0.5):**
```
[Renderer] Uncaught SyntaxError: Identifier 'island' has already been declared
```
Preload mengekspos API sebagai `window.island`, sementara `renderer.js` mendeklarasikan `const island = $('island')`. Tabrakan nama itu bikin **seluruh file renderer.js ditolak parser sejak v0.1** — tidak ada satu baris pun yang jalan. Itu ngejelasin SEMUA gejala sekaligus: island muncul (HTML/CSS tidak butuh JS), jam macet di placeholder `00:00`, hover/klik mati total, nol log `set-mode`, dan probe v0.5 ngebuktiin `btnYTPunyaHandler: false` sementara `window.island` isinya lengkap (preload sehat). Fix v0.6: variabel diganti nama jadi `islandEl`. DevTools otomatis dimatikan lagi; probe + forwarding console tetap dipertahankan (dengan filter warning CSP biar terminal bersih).

**Kenapa ada build debug (v0.5):** screenshot v0.4 dari user ngebuktiin v0.4 beneran jalan (label v0.4 + log SIAP), tapi (a) tidak ada log `set-mode` sama sekali setelah klik, dan (b) jam island macet di placeholder `00:00`. Jadi klik tidak sampai ke main, dan script renderer dicurigai tidak jalan. v0.5 tidak nebak — dia ngumpulin bukti:

- Semua `console.log`/error renderer **diteruskan ke terminal npm** (awalan `[Renderer]`)
- Habis halaman dimuat, main **mem-probe DOM** dan nulis hasilnya (`[Island] Probe DOM: {...}`): jam kebaca apa, `window.island` isinya apa, tombol ♪ punya handler atau tidak
- **DevTools island kebuka otomatis** di window terpisah (boleh ditutup, tidak ngaruh)
- Shortcut bisek: **Ctrl+Shift+B** = gedein island *langsung dari main process* (ngelewatin renderer), **Ctrl+Shift+N** = kecilin lagi. Kalau ini jalan tapi klik tidak, rusaknya di lapisan klik/renderer. Kalau ini pun tidak jalan, rusaknya di main/window.
- Jam sekarang di-set **langsung** saat script jalan (bukan nunggu 1 detik) + log tick pertama.

**Urutan tes:** `taskkill /F /IM electron.exe` → timpa file → `npm start` → tunggu 3 detik, screenshot terminal → klik ♪ sekali → tekan Ctrl+Shift+B → screenshot terminal lagi. Kirim dua screenshot itu.

**Fix v0.4 — kenapa v0.3 masih kelihatan mati, dan apa yang diubah:**
1. **Jebakan instance lama (paling mungkin):** v0.2/v0.3 pakai single-instance lock + hidup di tray. Instance lama yang belum mati bikin `npm start` versi baru langsung nyerah dan fokus balik ke instance lama — file diganti pun yang jalan tetap kode lama. **Lock-nya dihapus di v0.4.** Sebelum jalanin v0.4, bunuh dulu proses lama dari CMD:
   ```
   taskkill /F /IM electron.exe
   ```
   (Kalau balasannya "not found", abaikan.) Di island v0.4 ada label kecil **v0.4** di sebelah jam — itu bukti lu beneran jalanin build baru.
2. **Resize sekarang langsung, tanpa timer:** window digedein dalam satu langkah *sebelum* view YT dibuat, jadi tampilan pasti berubah duluan apa pun yang terjadi sesudahnya.
3. **Renderer ditulis defensif:** semua handler tombol dipasang paling atas, semua panggilan API dibungkus aman — satu error tidak bisa lagi mematikan semua tombol.
4. **Pembuatan embedded view sekarang ter-guard penuh** (semua langkah di dalam try/catch, fallback window kalau gagal).
5. **Log buat verifikasi:** tiap klik tombol, terminal npm nulis `[Island] set-mode: musicapp` (atau mode lain). Kalau log itu muncul tapi tampilan tidak berubah, masalahnya di main process; kalau log tidak muncul, masalahnya di klik/renderer — kirim ke gua log-nya.

**Fix v0.3 (fungsi dulu, baru animasi):**
- **Biang "tombol ditekan nggak ada aksi" ketemu:** di v0.2, layout panel YT Music dipanggil *sebelum* window selesai membesar, dengan tinggi `tinggi window saat itu − 104`. Dari mode idle (tinggi 40) hasilnya **negatif**, Electron nolak bounds itu dan perubahan mode batal di tengah — makanya klik ♪ kelihatan mati total. Sekarang bounds diklem aman dan view ikut membesar bareng animasi window.
- **Perintah player sekarang terverifikasi:** play/next/prev cuma dianggap berhasil kalau elemen video/tombolnya beneran ketemu; kalau nggak, otomatis jatuh ke jalur cadangan (bridge Chrome) kayak seharusnya.
- **Fallback window:** kalau embedded view tetap gagal dibuat di mesin lu, YT Music otomatis dibuka sebagai window player (sesi sama) — fungsi jalan terus, bukan diam.
- **Animasi sentuhan baru:** island membal halus (squash & stretch) tiap ganti mode, semua tombol membal pas ditekan, tombol ♪ berdenyut pas lagi loading, cover berdenyut pelan + glow lembut di island pas lagu jalan, pesan chat masuk dengan animasi.
- Upgrade dari v0.2 **nggak perlu `npm install` ulang** (nggak ada dependency baru): timpa file, `npm start`.

**Baru di v0.2:**
- **YT Music nempel di dalam island** — nggak perlu buka Chrome lagi. Klik tombol ♪ merah (atau `Ctrl+Shift+M`), YT Music kebuka di dalam panel island. Login Google **sekali aja** di situ, sesinya kesimpan permanen di app.
- **Musik jalan di background** — panel YT Music ditutup / island menyusut, lagu tetap bunyi. Info judul/cover/progress tetap update di island.
- **Nempel ke atas tanpa margin** — island sekarang flush ke tepi atas layar kayak notch: sudut atas lurus, lengkungan besar cuma di dua sudut bawah, hitam pekat + bayangan lembut.
- **Tray + autostart** — ikon di system tray (klik kanan: YT Music / Chat Gemini / Keluar). Kalau sudah jadi .exe terinstall, app otomatis jalan pas Windows nyala.
- Bridge Chrome v0.1 tetap ada sebagai cadangan.

## Perilaku island

| Keadaan | Tampilan |
|---|---|
| Idle | Pil kecil nempel di atas: jam, cover mini + judul kalau ada lagu, waveform hijau pas lagu jalan |
| Hover | Melebar jadi player: cover besar, judul, artis, progress, ⏮ ▶ ⏭ |
| Lagu ganti | Melebar sendiri 3,5 detik, lalu menyusut |
| Klik ♪ | Panel YT Music penuh di dalam island (780px) — cari lagu, playlist, semua di situ |
| Klik ✦ / Ctrl+Shift+A | Panel chat Gemini (screenshot otomatis terlampir kalau pakai shortcut) |

## Jalanin versi dev (kayak kemarin)

Di folder proyek ini. **Penting: hapus `package-lock.json` lama dulu** karena ada dependency baru (electron-builder), terus:

```
npm install
npm install-scripts approve electron
node node_modules\electron\install.js
npm start
```

(Kalau `npm install` langsung nggak ngeluh install script keblokir, dua langkah tengah boleh dilewati.)

## Bikin jadi .exe

Satu perintah ini di folder yang sama, di Windows lu:

```
npm run dist
```

Hasilnya di folder `dist\`:
- `Dynamic Island Setup 0.2.0.exe` — installer (ada shortcut desktop, autostart aktif setelah install)
- File portable juga ikut dibuat kalau pakai `npm run dist:portable`

electron-builder mungkin minta approve install script juga (`npm install-scripts ls` buat cek) — approve aja paket yang dia sebut, persis kayak electron kemarin.

## Gemini

Sama kayak v0.1: klik ✦ → ⚙ → tempel API key Gemini lu sendiri (tersimpan cuma di PC ini) → simpan. Tombol 📷 = screenshot, ketik prompt manual, kirim.

## Batasan jujur v0.2

- Login Google di dalam app pakai tampilan Chrome (user-agent disamakan). Kadang Google tetap galak ke browser embedded dan nolak login ("browser may not be secure"). Kalau itu kejadian di lu: tetap bisa pakai cara v0.1 (YT Music di Chrome + script bridge) — dua-duanya didukung barengan, dan gua bisa akalin lebih lanjut dari laporan error lu.
- .exe belum gua build dari sini (VM gua Linux, installer Windows harus dibuild di Windows) — konfigurasi electron-builder-nya sudah lengkap, tinggal `npm run dist` di PC lu.
- Belum Windows SMTC (Spotify dll) — masih kandidat berikutnya.
