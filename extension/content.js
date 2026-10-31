// Dynamic Island — content script ekstensi Chrome untuk YouTube Music.
// Jalan OTOMATIS di setiap tab music.youtube.com (tidak perlu paste console lagi).
// Membaca player bar halaman milik user sendiri, mengirim judul/artis/cover/posisi
// ke island lewat background relay, dan mengeksekusi perintah play/next/prev dari island.
(function () {
  if (window.__diBridge) return;
  window.__diBridge = true;

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
    if (!title && bar) { const t = bar.querySelector('.title'); if (t) title = t.textContent.trim(); }
    if (!artist && bar) { const by = bar.querySelector('.byline'); if (by) artist = by.textContent.trim().replace(/\s+/g, ' '); }
    if (!artwork && bar) { const img = bar.querySelector('img'); if (img) artwork = img.src || ''; }
    if (!title) return null;
    artwork = String(artwork || '').replace(/=w\d+-h\d+/, '=w512-h512');
    return {
      title, artist, artwork,
      paused: video.paused,
      currentTime: video.currentTime || 0,
      duration: video.duration || 0,
      url: location.href,
      source: 'chrome-extension',
    };
  }

  function runCommand(cmd, seek) {
    if (cmd === 'seek') {
      const v = document.querySelector('video');
      if (v && isFinite(v.duration)) v.currentTime = Math.max(0, Number(seek) || 0);
    }
    if (cmd === 'playpause') {
      const v = document.querySelector('video');
      if (v) { v.paused ? v.play() : v.pause(); }
    }
    if (cmd === 'next') {
      const b = document.querySelector('ytmusic-player-bar .next-button');
      if (b) b.click();
    }
    if (cmd === 'prev') {
      const b = document.querySelector('ytmusic-player-bar .previous-button');
      if (b) b.click();
    }
  }

  let lastKey = '';
  function tick() {
    try {
      const t = readTrack();
      if (t) {
        const key = t.title + '|' + t.artist;
        chrome.runtime.sendMessage({ type: 'track', track: t }, () => { void chrome.runtime.lastError; });
        if (key !== lastKey) { lastKey = key; console.log('[Dynamic Island]', t.title, '-', t.artist); }
      }
      chrome.runtime.sendMessage({ type: 'command' }, res => {
        void chrome.runtime.lastError;
        if (res && res.cmd) runCommand(res.cmd, res.seek);
      });
    } catch { /* ekstensi lagi reload / tab pindah */ }
  }
  setInterval(tick, 1000);
  console.log('[Dynamic Island] Bridge ekstensi aktif di tab YT Music ini.');
})();
