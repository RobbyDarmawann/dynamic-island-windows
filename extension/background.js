// Dynamic Island — background relay ekstensi Chrome.
// Content script di tab YT Music TIDAK fetch langsung ke localhost (dari halaman
// HTTPS itu bisa kena mixed-content / Private Network Access). Dia kirim pesan
// ke sini, dan service worker ekstensi yang fetch ke island — dengan
// host_permissions, jalur ini diizinkan Chrome.
const BASE = 'http://127.0.0.1:17890';

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg) return false;
  if (msg.type === 'track') {
    fetch(BASE + '/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(msg.track),
    }).catch(() => { /* island belum jalan, diam */ });
    return false;
  }
  if (msg.type === 'command') {
    fetch(BASE + '/command')
      .then(r => r.json())
      .then(d => sendResponse(d))
      .catch(() => sendResponse({ cmd: null }));
    return true; // async response
  }
  return false;
});
