// Dynamic Island Windows v0.2 - main process
// Perubahan besar dari v0.1:
// - YT Music DITANAM di dalam island (WebContentsView), bukan lagi wajib buka Chrome.
//   Login Google sekali di dalam app, sesi tersimpan (partition persist), musik tetap
//   jalan di background walau panelnya ditutup (backgroundThrottling: false).
//   Info lagu dibaca langsung dari halaman embedded tiap detik (executeJavaScript),
//   jadi tidak perlu fetch lokal dari halaman HTTPS-nya.
// - Bridge Chrome lama TETAP ada sebagai cadangan (127.0.0.1:17890).
// - Island nempel ke tepi atas layar (y=0, tanpa margin), lengkungan cuma di bawah.
// - Tray icon + autostart (kalau sudah dibungkus .exe) biar jalan di background.
const { app, BrowserWindow, WebContentsView, ipcMain, desktopCapturer, screen, globalShortcut, Tray, Menu, nativeImage, session, shell, powerSaveBlocker } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { execFile } = require('child_process');

const BRIDGE_PORT = 17890;
// v1.7 ANTI-STUTTER AUDIO (hasil analisis):
// 1) CalculateNativeWinOcclusion dimatikan — fitur Chromium ini men-throttle
//    window yang dianggap tertutup aplikasi lain; island kita selalu di atas
//    tapi view YT Music di dalamnya bisa ikut kena jeda render/audio pas user
//    buka aplikasi fullscreen. App pemutar musik standar mematikan ini.
// 2) powerSaveBlocker 'prevent-app-suspension' dinyalakan di whenReady —
//    Windows tidak menidurkan proses pas layar/aplikasi lain sibuk.
// 3) backdrop-filter island DIBUANG (di CSS) — blur 22px di window transparan
//    selalu-ontop itu beban GPU konstan dan sumber jank DWM yang kerasa
//    sampai ke audio. Glass sekarang dari warna tint saja.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
// v1.3 — HASIL ANALISIS ytmdesktop (github.com/ytmdesktop/ytmdesktop):
// App itu BISA login tanpa trik apa pun: tidak ada spoof UA, tidak ada rewrite
// header client-hints, tidak ada jendela login khusus. Bedanya dari kita cuma:
// (a) Electron 45 (Chromium jauh lebih baru dari Electron 33 kita), (b) login
// dibiarkan jalan DI DALAM view yang sama dengan domain Google/YouTube di-
// whitelist untuk navigasi in-view, (c) view-nya sandboxed + partisi persist.
// Jadi di v1.3 semua penyamaran v1.0 DIBUANG (identitas stock Electron persis
// kayak ytmdesktop) dan alur login-nya disamakan. Google yang mutusin hasil
// akhirnya, tapi sekarang tidak ada satu pun variabel yang beda dari app
// referensi yang terbukti bisa login itu selain versi & alurnya sudah disamakan.
function isGoogleFlowUrl(u) {
  try {
    const url = new URL(u);
    const h = url.hostname;
    if (h === 'music.youtube.com' || h === 'accounts.youtube.com' || h === 'consent.youtube.com') return true;
    if (h === 'accounts.google.com' || h.startsWith('accounts.') || h.startsWith('myaccount.')) return true;
    if ((h === 'www.youtube.com' || h === 'youtube.com') && ['/signin', '/premium', '/musicpremium', '/signin_prompt'].includes(url.pathname)) return true;
    return false;
  } catch { return false; }
}

let win = null;
let tray = null;
let ytView = null;
let resizeTimer = null;
let latestTrack = null;
let queuedCommand = null;
let currentMode = 'idle';

const SIZES = {
  idle:     { w: 296, h: 44 },
  music:    { w: 496, h: 126 },
  lyrics:   { w: 496, h: 384 },
  chat:     { w: 460, h: 590 },
  musicapp: { w: 780, h: 580 },
};

function centeredBounds(size) {
  const area = screen.getPrimaryDisplay().workArea;
  // v1.8 (koreksi dari Leonardo): island NEMPEL tepi atas lagi (y=0), lengkung
  // cuma di kiri-kanan BAWAH — sesuai maksud awalnya. Yang dipertahankan dari
  // v1.7 adalah clip-path-nya, karena itu yang terbukti menghilangkan sisa
  // kotak di lengkungan (dikonfirmasi Leonardo: sesudah v1.7 kotaknya hilang).
  return { x: Math.round(area.x + (area.width - size.w) / 2), y: area.y, width: size.w, height: size.h };
}

function layoutYTView() {
  if (!ytView || !win) return;
  if (currentMode === 'musicapp') {
    const b = win.getBounds();
    const w = Math.max(0, b.width - 20);
    const h = Math.max(0, b.height - 124); // v1.5: sisa 30px di bawah buat tombol perkecil (di luar area view)
    // FIX v0.3: bounds negatif bikin setBounds lempar error dan mode batal berubah
    // (ini biang "tombol ditekan nggak ada aksi"). View cuma ditampilkan setelah
    // ukuran window beneran cukup, selama animasi resize ukurannya diklem aman.
    if (w < 50 || h < 50) { ytView.setVisible(false); return; }
    ytView.setVisible(true);
    ytView.setBounds({ x: 10, y: 94, width: w, height: h });
  } else {
    ytView.setVisible(false);
    ytView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
  }
}

// v1.5: resize window sekarang DIANIMASIKAN (easeOutQuart ±300ms) ala Dynamic
// Island asli — bukan lompat satu langkah kayak v0.4. Aman dihidupkan lagi
// karena biang masalah v0.3 dulu sudah ketahuan (renderer mati total), dan
// layoutYTView sudah diklem sejak v0.3 sehingga frame kecil di tengah animasi
// tidak akan melempar error.
let boundsAnim = null;
function animateBounds(target, after) {
  if (!win || win.isDestroyed()) return;
  // v1.14: saat status SEMBUNYI, tidak boleh ada animasi ukuran sama sekali.
  // (applyHidden(false) dan setIslandMode selalu mengosongkan isHidden DULU
  // sebelum menganimasikan, jadi kunci ini tidak menghalangi kemunculan.)
  if (isHidden) { if (after) after(); return; }
  const from = win.getBounds();
  if (from.width === target.width && from.height === target.height) { if (after) after(); return; }
  if (boundsAnim) { clearInterval(boundsAnim); boundsAnim = null; }
  // v1.15: animasi pegas khas Dynamic Island — pas MEMBESAR pakai easeOutBack
  // (melewati target sedikit lalu mantul menetap, terasa hidup seperti di
  // iPhone); pas mengecil antar-mode tetap easeOutQuart yang tenang.
  const growing = (target.width * target.height) >= (from.width * from.height);
  const start = Date.now();
  const dur = growing ? 330 : 220;
  const easeOutQuart = (t) => 1 - Math.pow(1 - t, 4);
  const easeOutBack = (t) => { const c1 = 1.35, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
  const ease = growing ? easeOutBack : easeOutQuart;
  boundsAnim = setInterval(() => {
    const t = Math.min(1, (Date.now() - start) / dur);
    const e = ease(t);
    try {
      win.setBounds({
        x: Math.round(from.x + (target.x - from.x) * e), y: target.y,
        width: Math.round(from.width + (target.width - from.width) * e),
        height: Math.round(from.height + (target.height - from.height) * e),
      });
      if (currentMode === 'musicapp') layoutYTView();
    } catch { /* abaikan */ }
    if (t >= 1) { clearInterval(boundsAnim); boundsAnim = null; if (after) after(); }
  }, 16);
}

function setIslandMode(mode) {
  const size = SIZES[mode];
  if (!win || !size) return;
  currentMode = mode;
  noteActivity();
  // v1.4: lagi sembunyi dan mode-nya cuma bar (idle/music) -> tetap sembunyi,
  // mode dicatat saja. Panel/chat yang dibuka selalu memunculkan island.
  if (isHidden) {
    if (mode === 'idle' || mode === 'music') return;
    applyHidden(false, 'panel dibuka');
  }
  // FIX v0.4 (fungsi dulu): window langsung digedein SEKARANG, satu langkah,
  // tanpa timer animasi dan SEBELUM view YT dibuat. Jadi apa pun yang terjadi
  // sesudah ini (view gagal, load lama, error), tampilan island PASTI berubah
  // duluan — nggak ada lagi klik yang hilang tanpa respon visual.
  animateBounds(centeredBounds(size));
  if (mode === 'musicapp') {
    try { ensureYTView(); } catch (e) { console.error('ensureYTView gagal:', e.message); openYTFallbackWindow(e.message); }
    layoutYTView();
    // v1.8 FIX tombol YT mati: kalau view SUDAH ada dan sudah selesai loading,
    // did-finish-load tidak akan nembak lagi — kabari renderer 'loaded'
    // sekarang juga, biar kelas loading di tombol YT selalu terlepas.
    const wcNow = getYTContents();
    if (wcNow && !wcNow.isLoading()) sendYTState('loaded');
  } else {
    layoutYTView();
  }
}

// ================= v1.4: AUTO-HIDE =================
// Island menyusut jadi garis hitam kecil (168x9) di tengah atas layar setelah
// 5 detik tanpa aktivitas di mode bar. Muncul lagi kalau: kursor disentuhkan
// ke tepi paling atas layar, lagu berganti (ngintip 3,5 detik), panel/chat
// dibuka, atau Ctrl+Shift+H / menu tray. Mode panel (musicapp) dan chat TIDAK
// pernah disembunyikan otomatis — jadi pas daftar lagu lagi kebuka, island
// diam di tempat; sembunyi lanjut lagi setelah panel ditutup.
const HIDDEN_SIZE = { w: 140, h: 2 }; // v1.15: garis rambut saja — sesudah menyusut, jendela dibuat transparan penuh (opacity 0), jadi yang terlihat di layar BENAR-BENAR tidak ada apa-apa, persis Dynamic Island asli pas tidak aktif
let isHidden = false;
let autoHideEnabled = true;
let hideDelaySec = 5;
let lastActivityAt = Date.now();
let peekUntil = 0;

function noteActivity() { lastActivityAt = Date.now(); }

// v1.15: sembunyi ala Dynamic Island asli — island menyusut cepat jadi garis
// rambut (170ms), lalu jendelanya dibuat TRANSPARAN PENUH (opacity 0). Di layar
// tidak tersisa apa pun, jadi keluhan "garisnya masih besar" mustahil terulang
// berapa pun ukuran jendelanya. Muncul lagi (kursor ke tepi atas / lagu ganti /
// pintasan): opacity kembali 1 dan island memegas membesar (easeOutBack).
function animateHide() {
  if (boundsAnim) { clearInterval(boundsAnim); boundsAnim = null; }
  const from = win.getBounds();
  const target = centeredBounds(HIDDEN_SIZE);
  const finish = () => {
    try {
      win.setBounds(target);
      win.setOpacity(0);
      const b = win.getBounds();
      console.log('[Island] SEMBUNYI total (opacity 0), bounds: ' + b.width + 'x' + b.height + 'px');
    } catch { /* abaikan */ }
  };
  if (from.width === target.width && from.height === target.height) { finish(); return; }
  const start = Date.now();
  const dur = 170;
  boundsAnim = setInterval(() => {
    const t = Math.min(1, (Date.now() - start) / dur);
    const e = t * t * t; // easeInCubic: menyusut makin cepat, lalu hilang
    try {
      win.setBounds({
        x: Math.round(from.x + (target.x - from.x) * e), y: target.y,
        width: Math.round(from.width + (target.width - from.width) * e),
        height: Math.round(from.height + (target.height - from.height) * e),
      });
    } catch { /* abaikan */ }
    if (t >= 1) { clearInterval(boundsAnim); boundsAnim = null; finish(); }
  }, 16);
}

function applyHidden(hidden, reason) {
  if (!win || win.isDestroyed() || hidden === isHidden) return;
  isHidden = hidden;
  if (hidden) {
    if (ytView) ytView.setVisible(false);
    animateHide(); // membatalkan animasi apa pun yang sedang berjalan (satu slot interval yang sama)
  } else {
    try { win.setOpacity(1); } catch { /* abaikan */ } // tampilkan DULU, baru memegas membesar
    animateBounds(centeredBounds(SIZES[currentMode]), () => layoutYTView());
    noteActivity();
  }
  win.webContents.send('hidden-state', hidden);
  console.log('[Island] Island ' + (hidden ? 'SEMBUNYI' : 'MUNCUL') + ' (' + reason + ')');
}

function startCursorWatcher() {
  setInterval(() => {
    if (!win || win.isDestroyed()) return;
    // v1.9: gerbang murah — kalau island kelihatan DAN auto-hide mati, tidak
    // ada yang perlu diputuskan interval ini. Interval juga dilonggarkan
    // 220ms -> 300ms; total panggilan API layar turun ±30%.
    if (!isHidden && !autoHideEnabled) return;
    try {
      const p = screen.getCursorScreenPoint();
      const disp = screen.getDisplayNearestPoint(p);
      const cx = disp.bounds.x + Math.round(disp.bounds.width / 2);
      const inTopZone = p.y <= disp.bounds.y + 4 && Math.abs(p.x - cx) <= 320;
      if (isHidden) { if (inTopZone) applyHidden(false, 'kursor ke tepi atas'); return; }
      const b = win.getBounds();
      const insideWin = p.x >= b.x - 6 && p.x <= b.x + b.width + 6 && p.y >= b.y - 2 && p.y <= b.y + b.height + 8;
      if (insideWin) noteActivity();
      if (currentMode === 'chat' || currentMode === 'musicapp' || currentMode === 'lyrics') return;
      if (insideWin || Date.now() < peekUntil) return;
      if (Date.now() - lastActivityAt > hideDelaySec * 1000) applyHidden(true, hideDelaySec + ' detik tanpa aktivitas');
    } catch { /* abaikan */ }
  }, 300);
}

function peekOnTrackChange() {
  peekUntil = Date.now() + 3500;
  noteActivity();
  if (isHidden) {
    applyHidden(false, 'lagu berganti');
    setTimeout(() => {
      if (!autoHideEnabled || currentMode === 'chat' || currentMode === 'musicapp' || currentMode === 'lyrics') return;
      if (Date.now() - lastActivityAt < 3400) return; // user lagi interaksi, biarin poller yang mutusin
      applyHidden(true, 'ngintip selesai');
    }, 3600);
  }
}

// ================= v1.4: VOLUME LAPTOP (Windows Core Audio via PowerShell) ===
// Ngatur volume SISTEM beneran (bukan volume player doang): baca level + mute,
// set level absolut, step naik/turun. Kalau COM audio gagal di mesin user,
// fallback ke tombol media keyboard virtual (VK_VOLUME_*).
const VOL_CS = `
using System;
using System.Runtime.InteropServices;
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator {
  int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr devices);
  int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
  int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice device);
  int RegisterEndpointNotificationCallback(IntPtr client);
  int UnregisterEndpointNotificationCallback(IntPtr client);
}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
  int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
  int OpenPropertyStore(int access, out IntPtr properties);
  int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
  int GetState(out int state);
}
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  int RegisterControlChangeNotify(IntPtr notify);
  int UnregisterControlChangeNotify(IntPtr notify);
  int GetChannelCount(out uint count);
  int SetMasterVolumeLevel(float levelDb, ref Guid ctx);
  int SetMasterVolumeLevelScalar(float level, ref Guid ctx);
  int GetMasterVolumeLevel(out float levelDb);
  int GetMasterVolumeLevelScalar(out float level);
  int SetChannelVolumeLevel(uint channel, float levelDb, ref Guid ctx);
  int SetChannelVolumeLevelScalar(uint channel, float level, ref Guid ctx);
  int GetChannelVolumeLevel(uint channel, out float levelDb);
  int GetChannelVolumeLevelScalar(uint channel, out float level);
  int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid ctx);
  int GetMute(out bool mute);
  int GetVolumeStepInfo(out uint step, out uint stepCount);
  int VolumeStepUp(ref Guid ctx);
  int VolumeStepDown(ref Guid ctx);
  int QueryHardwareSupport(out uint mask);
  int GetVolumeRange(out float minDb, out float maxDb, out float incDb);
}
public static class VolCtl {
  static IAudioEndpointVolume GetVol() {
    var t = Type.GetTypeFromCLSID(new Guid("BCDE0395-E52F-467C-8E3D-C4579291692E"));
    var e = (IMMDeviceEnumerator)Activator.CreateInstance(t);
    IMMDevice dev; Marshal.ThrowExceptionForHR(e.GetDefaultAudioEndpoint(0, 0, out dev));
    var iid = new Guid("5CDF2C82-841E-4546-9722-0CF74078229A");
    object o; Marshal.ThrowExceptionForHR(dev.Activate(ref iid, 23, IntPtr.Zero, out o));
    return (IAudioEndpointVolume)o;
  }
  public static string Get() { var v = GetVol(); float l; bool m; v.GetMasterVolumeLevelScalar(out l); v.GetMute(out m); return Math.Round(l * 100).ToString() + "|" + (m ? "1" : "0"); }
  public static void Set(float f) { var v = GetVol(); var g = Guid.Empty; v.SetMasterVolumeLevelScalar(f, ref g); v.SetMute(false, ref g); }
  public static void Mute(bool m) { var v = GetVol(); var g = Guid.Empty; v.SetMute(m, ref g); }
}
public static class KeyVol {
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  public static void Press(int vk) { keybd_event((byte)vk, 0, 0, UIntPtr.Zero); keybd_event((byte)vk, 0, 2, UIntPtr.Zero); }
}`;

const VOL_PS = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition $env:DI_VOL_CODE
switch ($env:DI_VOL_ACTION) {
  'get'  { [VolCtl]::Get() }
  'set'  { [VolCtl]::Set([single]$env:DI_VOL_VALUE / 100); [VolCtl]::Get() }
  'mute' { [VolCtl]::Mute($env:DI_VOL_VALUE -eq '1'); [VolCtl]::Get() }
  'keyup'   { [KeyVol]::Press(175); [VolCtl]::Get() }
  'keydown' { [KeyVol]::Press(174); [VolCtl]::Get() }
  'keymute' { [KeyVol]::Press(173); [VolCtl]::Get() }
}`;

let volCache = { at: 0, state: null };
function runVolume(action, value) {
  return new Promise(resolve => {
    execFile('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', VOL_PS],
      { env: { ...process.env, DI_VOL_CODE: VOL_CS, DI_VOL_ACTION: action, DI_VOL_VALUE: String(value ?? '') }, windowsHide: true, timeout: 9000 },
      (err, stdout) => {
        const m = /(\d{1,3})\|([01])/.exec(String(stdout || ''));
        if (err || !m) { console.error('[Island] Volume ' + action + ' gagal:', err ? err.message : 'output tidak dikenal'); return resolve(null); }
        const state = { ok: true, level: Math.max(0, Math.min(100, parseInt(m[1], 10))), muted: m[2] === '1' };
        volCache = { at: Date.now(), state };
        resolve(state);
      });
  });
}
async function getVolumeState(force) {
  // v1.5 CPU: cache 20 detik (dulu 1,5) — tiap panggilan PowerShell itu compile
  // C# dari nol, jadi jangan sering-sering. vol-set/step tetap update cache.
  if (!force && volCache.state && Date.now() - volCache.at < 20000) return volCache.state;
  return (await runVolume('get')) || { ok: false, level: 0, muted: false };
}

// --- YT Music embedded ---
const EXTRACT_JS = `(() => {
  const video = document.querySelector('video');
  if (!video) return null;
  // v1.8: SUMBER UTAMA = Media Session API. Itu data resmi yang YT Music
  // sendiri publikasikan ke OS tiap lagu berganti (judul, artis, cover semua
  // ukuran) — jauh lebih bisa diandalkan daripada mengorek DOM player bar,
  // yang img-nya bisa nyangkut di lagu sebelumnya pas skip (bug "cuma judul
  // yang berubah, cover + warna bg macet" kemarin persis dari situ).
  let title = '', artist = '', artwork = '';
  const ms = navigator.mediaSession && navigator.mediaSession.metadata;
  if (ms) {
    title = ms.title || '';
    artist = ms.artist || '';
    const arts = ms.artwork || [];
    if (arts.length) artwork = arts[arts.length - 1].src || '';
  }
  const bar = document.querySelector('ytmusic-player-bar');
  if (!title && bar) { const t = bar.querySelector('.title'); if (t) title = t.textContent.trim(); }
  if (!artist && bar) { const by = bar.querySelector('.byline'); if (by) artist = by.textContent.trim().replace(/\\s+/g, ' '); }
  if (!artwork && bar) { const img = bar.querySelector('img'); if (img) artwork = img.src || ''; }
  if (!title) return null;
  artwork = String(artwork || '').replace(/=w\\d+-h\\d+/, '=w512-h512');
  return { title, artist, artwork, paused: video.paused, currentTime: video.currentTime || 0, duration: video.duration || 0, url: location.href, source: 'embedded' };
})()`;

// FIX v0.3: tiap perintah sekarang BALIKIN true/false — true cuma kalau elemennya
// beneran ketemu dan diklik/diputar. Dulu tidak ada return value sama sekali, jadi
// perintah selalu dianggap berhasil walau tidak ada video, dan jalur cadangan
// (bridge Chrome) tidak pernah kepakai.
const COMMAND_JS = {
  playpause: `(() => { const v = document.querySelector('video'); if (!v) return false; v.paused ? v.play() : v.pause(); return true; })()`,
  next: `(() => { const b = document.querySelector('ytmusic-player-bar .next-button'); if (!b) return false; b.click(); return true; })()`,
  prev: `(() => { const b = document.querySelector('ytmusic-player-bar .previous-button'); if (!b) return false; b.click(); return true; })()`,
};

// v1.9: powerSaveBlocker DINAMIS — nyala cuma pas ada lagu yang SEDANG MAIN
// (di situlah dia berguna mencegah jeda audio), mati pas pause/kosong biar
// laptop tidak dicegah tidur sia-sia. Lebih ringan di segala device.
let psbId = null;
function syncPowerBlocker(playing) {
  try {
    if (playing && psbId === null) psbId = powerSaveBlocker.start('prevent-app-suspension');
    else if (!playing && psbId !== null) { powerSaveBlocker.stop(psbId); psbId = null; }
  } catch { /* abaikan */ }
}

function publishTrack(track) {
  if (!track || !track.title) return;
  const changed = !latestTrack || latestTrack.title !== track.title || latestTrack.artist !== track.artist;
  latestTrack = { ...track, receivedAt: Date.now() };
  syncPowerBlocker(!track.paused);
  if (win) {
    win.webContents.send('track', latestTrack);
    if (changed) { win.webContents.send('track-changed', latestTrack); peekOnTrackChange(); }
  }
}

let ytFallbackWin = null;
let ytPollStarted = false;

function getYTContents() {
  if (ytView && !ytView.webContents.isDestroyed()) return ytView.webContents;
  if (ytFallbackWin && !ytFallbackWin.isDestroyed()) return ytFallbackWin.webContents;
  return null;
}

function sendYTState(state, message) {
  if (win) win.webContents.send('yt-state', { state, message: message || '' });
}

// Cadangan terakhir: kalau WebContentsView gagal dibuat di mesin user, YT Music
// dibuka sebagai window player biasa (tetap sesi persist yang sama, tetap kepolling).
// Fungsi tetap jalan duluan, tampilan nempel di island menyusul.
function openYTFallbackWindow(reason) {
  console.error('Embedded view gagal, pakai window cadangan:', reason);
  sendYTState('fallback', 'Mode nempel gagal (' + reason + '), YT Music gua buka sebagai window player.');
  if (ytFallbackWin && !ytFallbackWin.isDestroyed()) { ytFallbackWin.show(); ytFallbackWin.focus(); return; }
  ytFallbackWin = new BrowserWindow({
    width: 920, height: 680, autoHideMenuBar: true, title: 'YouTube Music — Dynamic Island',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: { partition: 'persist:ytmusic', backgroundThrottling: false, sandbox: true },
  });
  ytFallbackWin.on('closed', () => { ytFallbackWin = null; });
  ytFallbackWin.loadURL('https://music.youtube.com');
}

function ensureYTView() {
  if (ytView || ytFallbackWin) return ytView;
  // FIX v0.4: SELURUH langkah pembuatan view sekarang di dalam try/catch.
  // Di v0.3 cuma constructor-nya yang dijaga; langkah sesudahnya (addChildView,
  // loadURL, dll) kalau lempar error bikin mode batal diam-diam.
  try {
    ytView = new WebContentsView({
      webPreferences: { partition: 'persist:ytmusic', backgroundThrottling: false, sandbox: true, contextIsolation: true, autoplayPolicy: 'no-user-gesture-required' },
    });
    // Alur login ala ytmdesktop: popup dari halaman tidak dibuatkan window baru.
    // URL alur Google/YouTube dimuat DI VIEW YANG SAMA; sisanya dibuka eksternal.
    ytView.webContents.setWindowOpenHandler(({ url }) => {
      if (isGoogleFlowUrl(url)) { ytView.webContents.loadURL(url); return { action: 'deny' }; }
      shell.openExternal(url);
      return { action: 'deny' };
    });
    // Navigasi keluar dari alur Google/YouTube dicegah dan dibuka eksternal,
    // persis whitelist ytmviewmanager-nya ytmdesktop.
    ytView.webContents.on('will-navigate', (event, url) => {
      if (url.startsWith('https://music.youtube.com')) return;
      if (isGoogleFlowUrl(url)) return;
      event.preventDefault();
      shell.openExternal(url);
    });
    ytView.webContents.on('did-finish-load', () => sendYTState('loaded'));
    ytView.webContents.on('did-fail-load', (_e, code, desc) => { if (code !== -3) sendYTState('error', 'YT Music gagal dimuat: ' + desc); });
    ytView.setVisible(false);
    if (!win.contentView) throw new Error('contentView tidak tersedia di Electron ini');
    win.contentView.addChildView(ytView);
    ytView.webContents.loadURL('https://music.youtube.com');
  } catch (e) {
    ytView = null;
    openYTFallbackWindow(e.message);
    return null;
  }
  if (!ytPollStarted) {
    ytPollStarted = true;
    // Polling info lagu — jalan terus walau panel ditutup, makanya judul di island
    // tetap update dan lagu tetap bunyi di background.
    // v1.5 CPU: intervalnya ADAPTIF — panel kebuka 1 dtk (responsif), bar tampil
    // 1,5 dtk, lagi sembunyi 3 dtk (cukup buat deteksi ganti lagu buat ngintip).
    let lastYTPoll = 0;
    setInterval(async () => {
      const desired = currentMode === 'musicapp' ? 1000 : (isHidden ? 5000 : 1500);
      if (Date.now() - lastYTPoll < desired) return;
      lastYTPoll = Date.now();
      const wc = getYTContents();
      if (!wc || wc.isLoading()) return;
      try { publishTrack(await wc.executeJavaScript(EXTRACT_JS)); } catch { /* halaman lagi pindah */ }
    }, 500);
  }
  return ytView;
}

function buildSeekJS(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  return `(() => { const v = document.querySelector('video'); if (!v || !isFinite(v.duration)) return false; v.currentTime = ${s}; return true; })()`;
}

async function runEmbeddedCommand(cmd, arg) {
  const wc = getYTContents();
  if (!wc) return false;
  const js = cmd === 'seek' ? buildSeekJS(arg) : COMMAND_JS[cmd];
  if (!js) return false;
  try { return (await wc.executeJavaScript(js)) === true; } catch { return false; }
}

// --- Pengaturan (API key Gemini, disimpan lokal di PC user) ---
function settingsPath() { return path.join(app.getPath('userData'), 'settings.json'); }
function loadSettings() {
  try { return JSON.parse(fs.readFileSync(settingsPath(), 'utf8')); }
  catch { return { apiKey: '', model: 'gemini-2.5-flash' }; }
}
function saveSettings(s) {
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(s, null, 2));
}

// --- Bridge cadangan buat YT Music di Chrome (pola v0.1, tetap dipertahankan) ---
function startBridge() {
  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    if (req.method === 'POST' && req.url === '/track') {
      let body = '';
      req.on('data', c => { body += c; if (body.length > 1e6) req.destroy(); });
      req.on('end', () => {
        try { publishTrack(JSON.parse(body)); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}'); }
        catch { res.writeHead(400); res.end(); }
      });
      return;
    }
    if (req.method === 'GET' && req.url === '/command') {
      const q = queuedCommand; queuedCommand = null;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(q && typeof q === 'object' ? q : { cmd: q }));
    }
    res.writeHead(404); res.end();
  });
  server.listen(BRIDGE_PORT, '127.0.0.1', () => console.log('Bridge cadangan di http://127.0.0.1:' + BRIDGE_PORT));
  server.on('error', e => console.error('Bridge gagal:', e.message));
}

// --- Gemini ---
// v1.9 PERBAIKAN REGRESI: konstanta ini sempat kehapus pas edit v1.8 (blok
// handler tes koneksi diganti), bikin SEMUA chat Gemini error
// "GEMINI_FALLBACKS is not defined" — padahal key user valid (Tes Koneksi OK).
// Sekarang didefinisikan eksplisit di sini, tepat di atas pemakainya, dengan
// rantai cadangan model yang masih hidup.
const GEMINI_FALLBACKS = ['gemini-3.8-flash', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-3.5-flash-lite', 'gemini-2.0-flash'];
const GEMINI_RETRYABLE = new Set([429, 500, 502, 503, 504]);
const sleepMs = ms => new Promise(r => setTimeout(r, ms));

async function callGeminiOnce(modelName, parts, apiKey, outerSignal) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  const onOuterAbort = () => ctrl.abort();
  if (outerSignal) {
    if (outerSignal.aborted) ctrl.abort();
    else outerSignal.addEventListener('abort', onOuterAbort, { once: true });
  }
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`, {
      method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({ contents: [{ parts }] }),
    });
    clearTimeout(timer);
    if (!r.ok) {
      let msg = '';
      try { const j = await r.json(); msg = j?.error?.message || ''; } catch { /* abaikan */ }
      const err = new Error(msg ? msg.split('\n')[0] : ('HTTP ' + r.status));
      err.statusCode = r.status;
      throw err;
    }
    const data = await r.json();
    const text = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim();
    if (!text) { const err = new Error('Gemini balas kosong.'); err.statusCode = 204; throw err; }
    return text;
  } catch (e) {
    clearTimeout(timer);
    if (outerSignal) outerSignal.removeEventListener('abort', onOuterAbort);
    if (e.name === 'AbortError' && !(outerSignal && outerSignal.aborted)) { const err = new Error('Gemini timeout 30 detik.'); err.statusCode = 504; throw err; }
    throw e;
  }
}

async function callGemini(prompt, imageDataUrl, outerSignal, onProgress) {
  const { apiKey, model } = loadSettings();
  if (!apiKey) throw new Error('API key Gemini belum diisi. Klik ikon gear di island, isi key lu sendiri di sana.');
  const parts = [{ text: prompt || 'Jelaskan gambar ini.' }];
  if (imageDataUrl) {
    const m = /^data:(image\/\w+);base64,(.+)$/.exec(imageDataUrl);
    if (m) parts.push({ inline_data: { mime_type: m[1], data: m[2] } });
  }
  // v1.10 ANTI-503: kemarin fallback cuma jalan pas 404, jadi pas server Google
  // penuh (503 "high demand") chat langsung nyerah sambil nampilin JSON mentah.
  // Sekarang: status 429/5xx = coba ulang model yang sama sekali (jeda 1,2 dtk),
  // lalu LONCAT ke model berikutnya di rantai. 404 langsung loncat. 401/403 =
  // key salah, langsung berhenti. Pesan error selalu bersih satu baris.
  const modelsToTry = [model, ...GEMINI_FALLBACKS.filter(x => x !== model)];
  let lastErr = null;
  for (const mdl of modelsToTry) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (outerSignal && outerSignal.aborted) throw new Error('Dibatalkan.');
      try {
        if (onProgress) onProgress(mdl, attempt);
        return await callGeminiOnce(mdl, parts, apiKey, outerSignal);
      } catch (e) {
        if (outerSignal && outerSignal.aborted) throw new Error('Dibatalkan.');
        lastErr = e;
        if (e.statusCode === 401 || e.statusCode === 403) {
          throw new Error('API key ditolak Google (' + e.statusCode + '). Cek key di pengaturan island.');
        }
        if (e.statusCode === 404) break; // model tidak ada buat key ini -> berikutnya
        if (GEMINI_RETRYABLE.has(e.statusCode) || e.statusCode === 204) {
          if (attempt === 0) { await sleepMs(1200); continue; }
          break; // sudah dicoba ulang -> model berikutnya
        }
        throw e; // error lain (400 dsb) -> tampilkan apa adanya, sudah bersih
      }
    }
  }
  if (lastErr && GEMINI_RETRYABLE.has(lastErr.statusCode)) {
    throw new Error('Semua model Gemini lagi penuh (' + lastErr.statusCode + ') — itu server Google yang overload, bukan key kamu. Tunggu semenit lalu coba lagi, atau pilih model flash-lite yang biasanya lebih sepi.');
  }
  throw lastErr || new Error('Semua model Gemini gagal.');
}

function createWindow() {
  win = new BrowserWindow({
    ...centeredBounds(SIZES.idle),
    frame: false, transparent: true, backgroundColor: '#00000000', resizable: false, movable: false,
    skipTaskbar: true, hasShadow: false, alwaysOnTop: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  try { win.setHasShadow(false); } catch { /* abaikan */ } // v1.6: pastikan tidak ada bayangan/bingkai bawaan Windows di sekeliling lengkungan
  win.setAlwaysOnTop(true, 'screen-saver');
  // === DEBUG v0.5: semua bukti diteruskan ke terminal ===
  win.webContents.on('console-message', (_e, _level, message, line, sourceId) => {
    if (String(message).includes('Content-Security-Policy')) return; // warning dev bawaan Electron, cuma bikin terminal penuh
    console.log('[Renderer] ' + message + '  <-- ' + String(sourceId).split(/[\\/]/).pop() + ':' + line);
  });
  win.webContents.on('did-fail-load', (_e, code, desc, url) => console.error('[Island] GAGAL load halaman:', code, desc, url));
  win.webContents.on('render-process-gone', (_e, details) => console.error('[Island] Renderer MATI:', details.reason));
  win.webContents.on('did-finish-load', async () => {
    console.log('[Island] Halaman island selesai dimuat, probing DOM...');
    try {
      const probe = await win.webContents.executeJavaScript(`({
        clock: (document.getElementById('clock') || {}).textContent,
        islandKeys: Object.keys(window.island || {}),
        scriptTagAda: !!document.querySelector('script[src="renderer.js"]'),
        tombolYT: !!document.getElementById('btn-yt'),
        btnYTPunyaHandler: typeof (document.getElementById('btn-yt') || {}).onclick === 'function'
      })`);
      console.log('[Island] Probe DOM: ' + JSON.stringify(probe));
    } catch (e) { console.error('[Island] Probe DOM gagal:', e.message); }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // v0.6: DevTools sudah TIDAK dibuka otomatis (itu cuma buat debug v0.5).
  // Probe DOM + forwarding console tetap jalan diam-diam ke terminal.
}

function buildTrayMenu() {
  const force = mode => { if (win) { win.show(); applyHidden(false, 'menu tray'); win.webContents.send('force-mode', mode); } };
  return Menu.buildFromTemplate([
    { label: 'Panel YT Music (embedded)', click: () => force('musicapp') },
    { label: 'Chat Gemini', click: () => force('chat') },
    { label: 'Kecilkan island', click: () => force('idle') },
    { type: 'separator' },
    {
      label: 'Sembunyikan otomatis', type: 'checkbox', checked: autoHideEnabled,
      click: item => {
        autoHideEnabled = item.checked;
        saveSettings({ ...loadSettings(), autoHide: autoHideEnabled });
        if (!autoHideEnabled) applyHidden(false, 'auto-hide dimatikan');
        if (tray) tray.setContextMenu(buildTrayMenu());
      },
    },
    {
      label: 'Jeda sebelum sembunyi',
      submenu: [3, 5, 8, 12].map(s => ({
        label: s + ' detik', type: 'radio', checked: hideDelaySec === s,
        click: () => {
          hideDelaySec = s;
          saveSettings({ ...loadSettings(), hideDelaySec: s });
          if (tray) tray.setContextMenu(buildTrayMenu());
        },
      })),
    },
    { label: 'Sembunyikan sekarang', click: () => { if (currentMode !== 'chat' && currentMode !== 'musicapp') applyHidden(true, 'manual dari tray'); } },
    { label: 'Sembunyikan total / tampilkan', click: () => { if (!win) return; win.isVisible() ? win.hide() : win.show(); } },
    { label: 'Keluar', click: () => app.quit() },
  ]);
}

function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  const icon = fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 }) : nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip('Dynamic Island');
  tray.setContextMenu(buildTrayMenu());
  tray.on('click', () => { if (win) win.isVisible() ? win.hide() : win.show(); });
}

// FIX v0.4: single-instance lock DIHAPUS. Di v0.2/v0.3 lock itu jebakan:
// instance lama yang masih hidup di tray/background bikin `npm start` versi baru
// langsung nyerah dan nyerahin fokus ke instance LAMA — file udah diganti pun
// yang jalan tetap kode lama. Sekarang versi baru selalu beneran jalan.
// (Konsekuensinya: jangan start dua kali barengan, bakal ada dua island numpuk.)
// v1.12 (rilis .exe): kunci satu instance — aplikasi yang sudah terpasang
// tidak boleh jalan dobel (dua island numpuk + berebut port bridge). Instance
// kedua langsung keluar diam-diam. (Di v0.4 kunci ini sempat dicabut buat
// keperluan debug; sekarang aplikasinya stabil dan ini perilaku rilis yang benar.)
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

app.whenReady().then(() => {
  createWindow();
  createTray();
  startBridge();
  // v1.9: powerSaveBlocker tidak lagi nyala permanen — diatur dinamis oleh
  // syncPowerBlocker() mengikuti status putar lagu (lihat publishTrack).
  autoHideEnabled = loadSettings().autoHide !== false;
  hideDelaySec = [3, 5, 8, 12].includes(loadSettings().hideDelaySec) ? loadSettings().hideDelaySec : 5;
  if (tray) tray.setContextMenu(buildTrayMenu());
  startCursorWatcher();
  console.log('[Island] Dynamic Island v1.15 SIAP. Electron ' + process.versions.electron + ' / Chromium ' + process.versions.chrome + ' / UA stock: ' + win.webContents.getUserAgent());
  if (app.isPackaged) { try { app.setLoginItemSettings({ openAtLogin: true }); } catch { /* abaikan */ } }
  globalShortcut.register('Control+Shift+A', () => { if (win) { win.show(); win.webContents.send('open-chat-screenshot'); } });
  globalShortcut.register('Control+Shift+M', () => { console.log('[Island] Ctrl+Shift+M diterima'); if (win) { win.show(); win.webContents.send('force-mode', 'musicapp'); } });
  // Tes bisek: shortcut ini manggil setIslandMode LANGSUNG di main, ngelewatin renderer total.
  globalShortcut.register('Control+Shift+B', () => { console.log('[Island] Ctrl+Shift+B diterima -> gedein island LANGSUNG dari main'); try { setIslandMode('musicapp'); } catch (e) { console.error('[Island] Ctrl+Shift+B GAGAL:', e.message); } });
  globalShortcut.register('Control+Shift+N', () => { console.log('[Island] Ctrl+Shift+N diterima -> kecilin island dari main'); try { setIslandMode('idle'); } catch (e) { console.error('[Island] Ctrl+Shift+N GAGAL:', e.message); } });
  // v1.4: sembunyi/muncul manual kapan aja.
  globalShortcut.register('Control+Shift+H', () => { if (!win) return; win.show(); if (isHidden) applyHidden(false, 'Ctrl+Shift+H'); else if (currentMode !== 'chat' && currentMode !== 'musicapp') applyHidden(true, 'Ctrl+Shift+H'); });
});
app.on('window-all-closed', () => { /* sengaja tidak quit: hidup di tray/background */ });
app.on('will-quit', () => globalShortcut.unregisterAll());

ipcMain.on('set-mode', (_e, mode) => {
  console.log('[Island] set-mode:', mode);
  try { setIslandMode(mode); }
  catch (e) { console.error('[Island] set-mode GAGAL:', e.message); sendYTState('error', 'Gagal ganti mode: ' + e.message); }
});
ipcMain.on('queue-command', async (_e, cmd, arg) => {
  noteActivity();
  if (cmd === 'seek') {
    const sec = Math.max(0, Math.round(Number(arg) || 0));
    const done = await runEmbeddedCommand('seek', sec);
    if (!done) queuedCommand = { cmd: 'seek', seek: sec };  // cadangan: Chrome via bridge
    return;
  }
  if (!['playpause', 'next', 'prev'].includes(cmd)) return;
  const done = await runEmbeddedCommand(cmd);   // utamakan player embedded
  if (!done) queuedCommand = cmd;               // cadangan: player di Chrome via bridge
});
ipcMain.on('quit', () => app.quit());
// v1.2: jalur utama = Chrome (dipilih user). Tombol merah island membuka
// YT Music di browser default (Chrome-nya, tempat dia sudah login Premium).
ipcMain.on('open-chrome-music', () => { shell.openExternal('https://music.youtube.com'); });
ipcMain.handle('get-settings', () => { const s = loadSettings(); return { hasKey: !!s.apiKey, model: s.model }; });
ipcMain.handle('save-settings', (_e, s) => {
  const cur = loadSettings();
  saveSettings({ ...cur, apiKey: (s.apiKey || '').trim() || cur.apiKey, model: s.model || cur.model });
  return { ok: true };
});
ipcMain.handle('screenshot', async () => {
  const display = screen.getPrimaryDisplay();
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: display.size.width, height: display.size.height } });
  if (!sources[0]) throw new Error('Layar tidak ditemukan.');
  return sources[0].thumbnail.toDataURL();
});
// v1.11: satu-satunya permintaan Gemini yang aktif dilacak di sini biar bisa
// DIBATALKAN dari tombol stop di renderer, dan progresnya (model mana yang
// lagi dicoba) disiarkan ke renderer buat status "lagi mikir" yang jujur.
let geminiCtrl = null;
ipcMain.handle('ask-gemini', async (_e, { prompt, imageDataUrl }) => {
  geminiCtrl = new AbortController();
  try {
    return await callGemini(prompt, imageDataUrl, geminiCtrl.signal, (mdl, attempt) => {
      if (win && !win.isDestroyed()) win.webContents.send('gemini-progress', { model: mdl, attempt });
    });
  } finally { geminiCtrl = null; }
});
ipcMain.on('abort-gemini', () => { try { geminiCtrl?.abort(); } catch { /* abaikan */ } });

// v1.11: LIRIK dari LRCLIB (API publik gratis, tanpa key) — dicoba pasangan
// judul+artis+durasi persis dulu, kalau tidak ketemu dicari lalu dipilih yang
// durasinya paling dekat. Hasil (termasuk "tidak ada") di-cache per lagu.
const lyricsCache = new Map();
function cleanSongTitle(t) {
  return String(t || '')
    .replace(/\((?:official|music|lyric|audio|video|hd|4k|mv)[^)]*\)/gi, '')
    .replace(/\[(?:official|music|lyric|audio|video|hd|4k|mv)[^\]]*\]/gi, '')
    .replace(/\s+/g, ' ').trim();
}
let lrclibSawResponse = false;
async function lrclibFetch(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'DynamicIslandWindows/1.11 (personal app)' } });
    clearTimeout(timer);
    lrclibSawResponse = true;
    if (!r.ok) return null;
    return await r.json();
  } catch { clearTimeout(timer); return null; }
}
ipcMain.handle('get-lyrics', async (_e, { title, artist, duration }) => {
  const clean = cleanSongTitle(title);
  const key = (clean + '|' + (artist || '')).toLowerCase();
  if (lyricsCache.has(key)) return lyricsCache.get(key);
  let result = { found: false };
  const q = new URLSearchParams({ track_name: clean, artist_name: artist || '', duration: String(Math.round(duration || 0)) });
  const exact = duration ? await lrclibFetch('https://lrclib.net/api/get?' + q.toString()) : null;
  const pick = d => d && (d.syncedLyrics || d.plainLyrics) ? { found: true, plain: d.plainLyrics || '', synced: d.syncedLyrics || '' } : null;
  result = pick(exact) || result;
  if (!result.found) {
    const qs = new URLSearchParams({ track_name: clean, artist_name: artist || '' });
    const list = await lrclibFetch('https://lrclib.net/api/search?' + qs.toString());
    if (Array.isArray(list) && list.length) {
      const scored = list.filter(d => d.syncedLyrics || d.plainLyrics)
        .sort((a, b) => Math.abs((a.duration || 0) - (duration || 0)) - Math.abs((b.duration || 0) - (duration || 0)));
      result = pick(scored[0]) || result;
    }
  }
  if (!result.found && !lrclibSawResponse) result = { found: false, unavailable: true };
  if (!result.unavailable) lyricsCache.set(key, result);
  return result;
});
async function fetchGeminiModelNames(key) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', {
      signal: ctrl.signal, headers: { 'x-goog-api-key': key },
    });
    clearTimeout(timer);
    if (r.status === 400 || r.status === 401 || r.status === 403) throw new Error('Key ditolak Google (' + r.status + '). Cek key-nya, atau bikin baru di AI Studio.');
    if (!r.ok) throw new Error('Google balas ' + r.status);
    const data = await r.json();
    return (data.models || [])
      .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map(m => String(m.name || '').replace(/^models\//, ''))
      .filter(Boolean);
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') throw new Error('Timeout 15 detik — koneksi ke Google lambat.');
    throw e;
  }
}

// v1.8: daftar model DINAMIS — diisi dari key user sendiri, jadi model apa pun
// yang beneran tersedia buat key itu (termasuk gemini-4-argon buat key API
// berbayar) muncul apa adanya. Argon TIDAK ada di tier gratis API: langganan
// AI Pro ngasih Argon di aplikasi Gemini, bukan di kuota API.
ipcMain.handle('list-gemini-models', async (_e, { apiKey } = {}) => {
  const key = (apiKey || '').trim() || loadSettings().apiKey;
  if (!key) throw new Error('Key masih kosong.');
  return fetchGeminiModelNames(key);
});

// v1.7: tes koneksi Gemini — validasi key + cek model pilihan tersedia buat key itu.
ipcMain.handle('test-gemini', async (_e, { apiKey, model }) => {
  const key = (apiKey || '').trim() || loadSettings().apiKey;
  if (!key) throw new Error('Key masih kosong — tempel dulu key dari AI Studio.');
  const names = await fetchGeminiModelNames(key);
  return { ok: true, modelFound: names.includes(model), totalModels: names.length };
});

// v1.8: ambil gambar cover lewat main (tanpa CORS) buat fallback pewarna kaca
// pas pengambilan langsung dari renderer kehalang.
ipcMain.handle('fetch-artwork', async (_e, url) => {
  if (!/^https:\/\//.test(url || '')) throw new Error('URL gambar tidak valid');
  const r = await fetch(url);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const ct = r.headers.get('content-type') || '';
  if (!ct.startsWith('image/')) throw new Error('Bukan gambar');
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > 2500000) throw new Error('Gambar kegedean');
  return 'data:' + ct + ';base64,' + buf.toString('base64');
});
ipcMain.handle('get-track', () => latestTrack);
// v1.4: volume laptop
ipcMain.handle('vol-get', () => getVolumeState(false));
ipcMain.handle('vol-set', async (_e, pct) => {
  const v = Math.max(0, Math.min(100, Math.round(Number(pct) || 0)));
  return (await runVolume('set', v)) || { ok: false, level: v, muted: false };
});
ipcMain.handle('vol-mute', async (_e, muted) => (await runVolume('mute', muted ? '1' : '0')) || { ok: false, level: 0, muted: !!muted });
ipcMain.handle('vol-step', async (_e, dir) => {
  const cur = await getVolumeState(false);
  if (cur && cur.ok) {
    const v = Math.max(0, Math.min(100, cur.level + (dir > 0 ? 5 : -5)));
    return (await runVolume('set', v)) || cur;
  }
  return (await runVolume(dir > 0 ? 'keyup' : 'keydown')) || { ok: false, level: 0, muted: false };
});
