// ==UserScript==
// @name         YT Music -> Dynamic Island Bridge
// @match        https://music.youtube.com/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @connect      127.0.0.1
// ==/UserScript==
//
// Cara pakai (pilih satu):
// A) Tampermonkey: buat script baru, tempel file ini, simpan. Jalan otomatis tiap buka YT Music.
// B) Console: buka music.youtube.com, F12 > Console, tempel semua isi file ini, Enter.
//    (cara B harus diulang tiap refresh halaman)
//
// Yang dikirim ke island (http://127.0.0.1:17890, cuma lokal): judul, artis, cover,
// posisi/durasi lagu, status pause. Island bisa kirim balik perintah play/next/prev
// yang dieksekusi di sini dengan klik tombol player aslinya.
(function () {
  if (window.__ytIslandBridge) { console.log('[Island] Bridge sudah jalan.'); return; }
  window.__ytIslandBridge = true;
  const BASE = 'http://127.0.0.1:17890';
  let lastSent = '';

  // Di Tampermonkey, pakai GM_xmlhttpRequest (diizinkan eksplisit lewat @grant/@connect
  // di header) supaya panggilan ke localhost tidak kena mixed-content/PNA halaman.
  // Di console biasa, jatuh ke fetch standar.
  function req(method, path, data) {
    if (typeof GM_xmlhttpRequest === 'function') {
      return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          method, url: BASE + path,
          headers: { 'Content-Type': 'application/json' },
          data: data ? JSON.stringify(data) : undefined,
          onload: r => resolve(r.responseText || ''),
          onerror: reject,
        });
      });
    }
    return fetch(BASE + path, {
      method, headers: { 'Content-Type': 'application/json' },
      body: data ? JSON.stringify(data) : undefined,
    }).then(r => r.text());
  }

  function readTrack() {
    const video = document.querySelector('video');
    if (!video) return null;
    // v1.8: Media Session = sumber utama (selalu segar tiap ganti lagu),
    // DOM player bar cuma cadangan.
    let title = '', artist = '', artwork = '';
    const ms = navigator.mediaSession && navigator.mediaSession.metadata;
    if (ms) {
      title = ms.title || '';
      artist = ms.artist || '';
      const arts = ms.artwork || [];
      if (arts.length) artwork = arts[arts.length - 1].src || '';
    }
    const bar = document.querySelector('ytmusic-player-bar');
    if (!title && bar) title = bar.querySelector('.title')?.textContent?.trim() || '';
    if (!artist && bar) artist = bar.querySelector('.byline')?.textContent?.trim().replace(/\s+/g, ' ') || '';
    if (!artwork && bar) artwork = bar.querySelector('img')?.src || '';
    if (!title) return null;
    artwork = String(artwork || '').replace(/=w\d+-h\d+/, '=w512-h512');
    return {
      title, artist, artwork,
      paused: video.paused,
      currentTime: video.currentTime || 0,
      duration: video.duration || 0,
      url: location.href,
      source: 'chrome-bridge',
    };
  }

  async function tick() {
    try {
      const t = readTrack();
      if (t) {
        // Judul/artis/status dikirim tiap detik buat progress, tapi log cuma saat lagu ganti.
        const key = t.title + '|' + t.artist;
        await req('POST', '/track', t);
        if (key !== lastSent) { lastSent = key; console.log('[Island]', t.title, '-', t.artist); }
      }
      const { cmd, seek } = JSON.parse((await req('GET', '/command')) || '{"cmd":null}');
      if (cmd === 'seek') { const v = document.querySelector('video'); if (v && isFinite(v.duration)) v.currentTime = Math.max(0, Number(seek) || 0); }
      if (cmd === 'playpause') document.querySelector('video')?.paused
        ? document.querySelector('video')?.play() : document.querySelector('video')?.pause();
      if (cmd === 'next') document.querySelector('ytmusic-player-bar .next-button')?.click();
      if (cmd === 'prev') document.querySelector('ytmusic-player-bar .previous-button')?.click();
    } catch { /* island belum jalan, diam aja */ }
  }
  const timer = setInterval(tick, 1000);
  window.stopYTMusicBridge = () => { clearInterval(timer); window.__ytIslandBridge = false; console.log('[Island] Bridge berhenti.'); };
  console.log('[Island] Bridge YT Music jalan. Berhenti: stopYTMusicBridge()');
})();
