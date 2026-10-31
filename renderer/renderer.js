// Dynamic Island renderer v0.4 — ditulis DEFENSIF:
// - Semua handler tombol dipasang PALING ATAS, sebelum panggilan API island apa pun.
// - Semua panggilan window.island dibungkus aman (opsional + try/catch), jadi satu
//   fungsi yang hilang/error TIDAK BISA mematikan tombol-tombol lain.
//   (Di v0.3 satu panggilan onYTState yang gagal bisa membatalkan semua handler
//   di bawahnya karena script jalan berurutan.)
const $ = id => document.getElementById(id);
console.log('[Renderer] script renderer.js MULAI jalan');
const ISL = window.island || {};
console.log('[Renderer] window.island keys: ' + Object.keys(ISL).join(', '));
const islCall = (name, ...args) => { try { return ISL[name] && ISL[name](...args); } catch (e) { console.error('island.' + name + ' gagal:', e); } };
const islOn = (name, fn) => { try { ISL[name] && ISL[name](fn); } catch (e) { console.error('island.' + name + ' gagal:', e); } };

let mode = 'idle';
let track = null;
let toastUntil = 0;
let leaveTimer = null;
let attachment = null;
const islandEl = $('island'); // FIX v0.6: nama variabel JANGAN 'island' — bentrok dengan window.island dari preload (contextBridge), bikin SyntaxError "Identifier 'island' has already been declared" dan SELURUH script renderer ditolak sejak v0.1. Itu biang jam macet 00:00 + semua tombol mati.

function setMode(next) {
  console.log('[Renderer] setMode dipanggil -> ' + next);
  const prev = mode;
  mode = next;
  document.body.classList.remove('mode-' + prev);
  document.body.classList.add('mode-' + next);
  if (prev !== next && islandEl.animate) {
    islandEl.animate([
      { transform: 'scale(1, 1)' },
      { transform: 'scale(1.03, 0.93)', offset: 0.35 },
      { transform: 'scale(0.995, 1.012)', offset: 0.7 },
      { transform: 'scale(1, 1)' },
    ], { duration: 380, easing: 'cubic-bezier(.32,.72,.35,1)' });
  }
  if (next === 'musicapp') {
    $('btn-yt').classList.add('loading');
    // v1.8: pengaman — kelas loading WAJIB lepas maksimal 5 detik apa pun
    // yang terjadi, biar tombol YT tidak pernah nyangkut dalam keadaan mati.
    clearTimeout(window.__ytLoadTimer);
    window.__ytLoadTimer = setTimeout(() => $('btn-yt').classList.remove('loading'), 5000);
  } else {
    $('btn-yt').classList.remove('loading');
  }
  if (next === 'music') refreshVolume();
  $('idle-view').classList.toggle('hidden', next !== 'idle' && next !== 'chat');
  $('music-view').classList.toggle('hidden', next !== 'music' && next !== 'musicapp' && next !== 'lyrics');
  $('musicapp-note').classList.toggle('hidden', next !== 'musicapp');
  $('lyrics').classList.toggle('hidden', next !== 'lyrics');
  $('chat').classList.toggle('hidden', next !== 'chat');
  islCall('setMode', next);
}

// === HANDLER TOMBOL — dipasang duluan, sebelum langganan event apa pun ===
$('btn-yt').onclick = () => setMode(mode === 'musicapp' ? 'idle' : 'musicapp'); // v1.3: panel embedded jadi jalur utama lagi (pola ytmdesktop), Chrome tetap jalan sebagai cadangan di belakang
$('btn-ai').onclick = () => setMode(mode === 'chat' ? 'idle' : 'chat');
$('btn-quit').onclick = () => islCall('quit');
$('btn-play').onclick = () => { islCall('queueCommand', 'playpause'); if (track) { track.paused = !track.paused; renderTrack(); } };
$('btn-next').onclick = () => islCall('queueCommand', 'next');
$('btn-prev').onclick = () => islCall('queueCommand', 'prev');
$('btn-close-chat').onclick = () => setMode('idle');
$('art').onclick = () => setMode('musicapp');
$('track-info').onclick = () => setMode('musicapp');
document.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
  b.classList.remove('pressed'); void b.offsetWidth; b.classList.add('pressed');
}));
islandEl.addEventListener('mouseenter', () => {
  if (leaveTimer) clearTimeout(leaveTimer);
  if (mode === 'idle') setMode('music');
});
islandEl.addEventListener('mouseleave', () => {
  leaveTimer = setTimeout(() => { if (mode === 'music' && Date.now() >= toastUntil) setMode('idle'); }, 500);
});

// === Jam & progress ===
let firstTick = true;
function tickClock() {
  const d = new Date();
  const t = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  $('clock').textContent = t;
  if (firstTick) { firstTick = false; console.log('[Renderer] tick jam pertama: ' + t + ' (script renderer HIDUP)'); }
}
tickClock();
setInterval(tickClock, 1000);
let lastProgW = -1, lastTimeCur = '', lastTimeDur = '';
setInterval(() => {
  if (!track || !track.duration) return;
  let cur = track.currentTime || 0;
  if (!track.paused) cur += (Date.now() - track.receivedAt) / 1000;
  cur = Math.min(cur, track.duration);
  // v1.9 hemat DOM: tulis cuma pas nilainya beneran berubah (progres dibulatkan
  // 0,3%; teks waktu cuma pas detiknya berganti) — lebih ringan di device lemah.
  const w = Math.round(Math.min(100, (cur / track.duration) * 100) * 3.33);
  if (w !== lastProgW) { lastProgW = w; $('progress-fill').style.width = (w / 3.33) + '%'; }
  const tc = fmtTime(cur);
  if (tc !== lastTimeCur) { lastTimeCur = tc; $('time-cur').textContent = tc; }
  const td = fmtTime(track.duration);
  if (td !== lastTimeDur) { lastTimeDur = td; $('time-dur').textContent = td; }
}, 500);

function fmtTime(s) {
  s = Math.max(0, Math.floor(s || 0));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

// v1.5: klik garis progres = loncat (seek) ke posisi itu
$('progress').addEventListener('pointerdown', e => {
  if (!track || !track.duration) return;
  const r = $('progress').getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  const target = Math.round(ratio * track.duration);
  track.currentTime = target;
  track.receivedAt = Date.now();
  islCall('queueCommand', 'seek', target);
});

// v1.5: keluar dari mode panel/chat — tombol chevron di bawah panel + tombol Esc
$('btn-collapse').onclick = () => setMode('idle');

// === v1.11: LIRIK (LRCLIB lewat main) ===
// Panel lirik di bawah bar lagu. Kalau LRCLIB punya lirik tersinkron (LRC),
// baris yang lagi dinyanyikan menyala + auto-scroll; kalau cuma teks biasa,
// ditampilkan statis. Ganti lagu pas panel kebuka = lirik ikut diganti.
let lrcLines = null;   // [{t, text, el}] kalau tersinkron
let lrcActiveIdx = -1;
let lyricsForKey = '';
function parseLRC(s) {
  const out = [];
  for (const line of String(s || '').split('\n')) {
    const m = /\[(\d+):(\d+(?:\.\d+)?)\]/.exec(line);
    if (m) out.push({ t: parseInt(m[1], 10) * 60 + parseFloat(m[2]), text: line.replace(/\[[^\]]*\]/g, '').trim() });
  }
  return out.sort((a, b) => a.t - b.t);
}
async function loadLyrics() {
  const body = $('lyrics-body');
  if (!track) { body.innerHTML = '<div class="lyrics-msg">Belum ada lagu — putar dulu di YouTube Music.</div>'; lrcLines = null; return; }
  const key = (track.title + '|' + track.artist).toLowerCase();
  if (key === lyricsForKey && body.dataset.loaded === '1') return;
  lyricsForKey = key;
  $('lyrics-title').textContent = track.title;
  body.innerHTML = '<div class="lyrics-msg">Nyari lirik...</div>';
  delete body.dataset.loaded;
  lrcLines = null; lrcActiveIdx = -1;
  try {
    const r = await ISL.getLyrics({ title: track.title, artist: track.artist, duration: track.duration });
    if (lyricsForKey !== key) return; // lagu sudah ganti di tengah jalan
    if (!r || !r.found) { body.innerHTML = '<div class="lyrics-msg">' + (r && r.unavailable ? 'LRCLIB lagi tidak bisa dihubungi — cek internet, lalu buka lagi panel ini.' : 'Lirik lagu ini tidak ketemu di LRCLIB.') + '</div>'; return; }
    body.dataset.loaded = '1';
    if (r.synced) {
      lrcLines = parseLRC(r.synced);
      body.innerHTML = '';
      for (const ln of lrcLines) {
        const d = document.createElement('div');
        d.className = 'lrc-line clickable';
        d.textContent = ln.text || '♪';
        d.title = 'Klik buat loncat ke bagian ini';
        // v1.12: baris lirik BISA DITEKAN — lagu langsung loncat ke waktu
        // baris itu dinyanyikan (rantai seek yang sama kayak garis progres),
        // plus perkiraan lokal diperbarui biar highlight pindah seketika.
        d.onclick = () => {
          if (!track) return;
          track.currentTime = ln.t;
          track.receivedAt = Date.now();
          islCall('queueCommand', 'seek', Math.round(ln.t));
          lrcActiveIdx = -1; // paksa sinkronisasi ulang highlight habis loncat
          syncLyrics(ln.t);
        };
        ln.el = d;
        body.appendChild(d);
      }
      if (!lrcLines.length) body.innerHTML = '<div class="lyrics-msg">Format lirik tersinkron kosong.</div>';
    } else {
      lrcLines = null;
      body.innerHTML = '';
      const pre = document.createElement('div');
      pre.className = 'lyrics-plain';
      pre.textContent = r.plain || '';
      body.appendChild(pre);
    }
    body.scrollTop = 0;
  } catch {
    body.innerHTML = '<div class="lyrics-msg">Gagal ngambil lirik — cek koneksi internet.</div>';
  }
}
function syncLyrics(cur) {
  if (!lrcLines || !lrcLines.length || mode !== 'lyrics') return;
  let idx = -1;
  for (let i = 0; i < lrcLines.length; i++) { if (lrcLines[i].t <= cur + 0.15) idx = i; else break; }
  if (idx === lrcActiveIdx) return;
  if (lrcActiveIdx >= 0 && lrcLines[lrcActiveIdx].el) lrcLines[lrcActiveIdx].el.classList.remove('on');
  lrcActiveIdx = idx;
  if (idx >= 0 && lrcLines[idx].el) {
    lrcLines[idx].el.classList.add('on');
    lrcLines[idx].el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}
$('btn-lyrics').onclick = () => { if (mode === 'lyrics') setMode('music'); else { setMode('lyrics'); loadLyrics(); } };
$('btn-close-lyrics').onclick = () => setMode('music');
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && (mode === 'musicapp' || mode === 'chat')) setMode('idle');
  else if (e.key === 'Escape' && mode === 'lyrics') setMode('music');
});

// v1.5 GLASS: ambil warna dominan cover lagu, jadikan tint kaca island
// v1.7: warna kaca DIGESER halus pakai tween JS (lerp per frame ±900ms) —
// mengganti variabel CSS mentah terbukti lompat patah-patah karena transisi
// CSS tidak menginterpolasi isi variabel. Sekarang tiap ganti lagu warnanya
// mengalir natural ke warna cover baru, gaya Dynamic Island asli.
let glassCur = { r: 52, g: 54, b: 66 };
let glassRaf = null;
function tweenGlassTo(r, g, b) {
  const from = { ...glassCur };
  const to = { r, g, b };
  const t0 = performance.now();
  const dur = 900;
  if (glassRaf) cancelAnimationFrame(glassRaf);
  const step = now => {
    const k = Math.min(1, (now - t0) / dur);
    const e = 1 - Math.pow(1 - k, 3);
    glassCur = {
      r: Math.round(from.r + (to.r - from.r) * e),
      g: Math.round(from.g + (to.g - from.g) * e),
      b: Math.round(from.b + (to.b - from.b) * e),
    };
    document.documentElement.style.setProperty('--glass', glassCur.r + ', ' + glassCur.g + ', ' + glassCur.b);
    if (k < 1) glassRaf = requestAnimationFrame(step);
  };
  glassRaf = requestAnimationFrame(step);
}

let lastGlassUrl = '';
function sampleTintFromImage(img) {
  const c = document.createElement('canvas');
  c.width = 12; c.height = 12;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0, 12, 12);
  const d = ctx.getImageData(0, 0, 12, 12).data;
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
  tweenGlassTo(Math.round(r / n * 0.82), Math.round(g / n * 0.82), Math.round(b / n * 0.82));
}
function updateGlassTint(url) {
  if (!url || url === lastGlassUrl) return;
  lastGlassUrl = url;
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => { try { sampleTintFromImage(img); } catch { fallbackTint(url); } };
  img.onerror = () => fallbackTint(url);
  img.src = url;
}
// v1.8: jalur cadangan pewarna kaca — gambar diambil lewat main (tanpa CORS)
// sebagai data URL, jadi canvas tidak pernah kehalang lagi.
async function fallbackTint(url) {
  try {
    const dataUrl = await ISL.fetchArtwork(url);
    const img = new Image();
    img.onload = () => { try { sampleTintFromImage(img); } catch { /* biarin tint lama */ } };
    img.src = dataUrl;
  } catch { /* biarin tint lama */ }
}

function renderTrack() {
  document.body.classList.toggle('no-track', !track);
  if (!track) return;
  $('track-title').textContent = track.title;
  $('track-artist').textContent = track.artist || '';
  if (track.artwork) { $('art').src = track.artwork; $('art').classList.remove('no-art'); $('mini-art').src = track.artwork; $('mini-art').classList.remove('hidden'); updateGlassTint(track.artwork); }
  else { $('art').removeAttribute('src'); $('art').classList.add('no-art'); $('mini-art').removeAttribute('src'); $('mini-art').classList.add('hidden'); }
  $('mini-title').textContent = track.title;
  $('mini-title').classList.remove('hidden');
  $('icon-play').classList.toggle('hidden', !track.paused);
  $('icon-pause').classList.toggle('hidden', track.paused);
  $('wave-idle').classList.toggle('on', !track.paused);
  document.body.classList.toggle('playing', !track.paused);
}

// === Langganan event dari main — semua opsional, gagal pun tombol tetap hidup ===
islOn('onTrack', t => { track = t; renderTrack(); });
islOn('onTrackChanged', t => {
  track = t; renderTrack();
  if ($('art').animate) $('art').animate([{ opacity: 0.15, transform: 'scale(.9)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 480, easing: 'cubic-bezier(.22,.9,.3,1)' });
  if (mode === 'chat' || mode === 'musicapp') return;
  if (mode === 'lyrics') { loadLyrics(); return; } // v1.11: lagi baca lirik -> liriknya saja yang diganti, jangan diusir balik ke mode musik
  toastUntil = Date.now() + 3500;
  setMode('music');
  setTimeout(() => { if (Date.now() >= toastUntil && mode === 'music' && !islandEl.matches(':hover')) setMode('idle'); }, 3600);
});
islOn('onForceMode', m => setMode(m));
islOn('onYTState', s => {
  $('btn-yt').classList.remove('loading');
  if (s.state !== 'loaded' && s.message) {
    const n = document.querySelector('#musicapp-note .note-inner');
    if (n) n.innerHTML = s.message + '<br><small>Island-nya tetap jalan normal.</small>';
    if (s.state === 'fallback') setMode('music');
  }
});
islOn('onOpenChatScreenshot', async () => { setMode('chat'); await takeScreenshot(); $('inp-msg').focus(); });
try { const p = ISL.getTrack && ISL.getTrack(); if (p && p.then) p.then(t => { if (t) { track = t; renderTrack(); } }); } catch { /* abaikan */ }

// === Chat Gemini ===
function addMsg(text, who) {
  const div = document.createElement('div');
  div.className = 'msg ' + who;
  div.textContent = text;
  $('messages').appendChild(div);
  $('messages').scrollTop = $('messages').scrollHeight;
  return div;
}
async function takeScreenshot() {
  try {
    attachment = await ISL.screenshot();
    $('attach-img').src = attachment;
    $('attach').classList.remove('hidden');
  } catch (e) { addMsg('Screenshot gagal: ' + e.message, 'ai'); }
}
// v1.11: status kirim ala aplikasi Gemini asli — pas nunggu: input TERKUNCI
// (tidak bisa kirim dobel), bubble "mikir" pakai titik animasi + status model
// yang lagi dicoba (dari progres main), dan tombol kirim berubah jadi STOP
// yang membatalkan permintaan beneran.
let sending = false;
let typingEl = null;
let typingStatusEl = null;
function setSending(on) {
  sending = on;
  $('inp-msg').disabled = on;
  $('btn-shot').disabled = on;
  $('btn-send').classList.toggle('stop', on);
  $('btn-send').title = on ? 'Berhenti' : 'Kirim';
  $('icon-send').classList.toggle('hidden', on);
  $('icon-stop').classList.toggle('hidden', !on);
}
islOn('onGeminiProgress', p => {
  if (typingStatusEl && p && p.model) {
    typingStatusEl.textContent = p.attempt > 0
      ? 'Model ' + p.model + ' lagi rame, nyoba lagi...'
      : 'Mikir pakai ' + p.model + '...';
  }
});
async function sendMsg() {
  if (sending) return;
  const prompt = $('inp-msg').value.trim();
  if (!prompt && !attachment) return;
  addMsg(prompt || '(screenshot tanpa prompt)', 'user');
  $('inp-msg').value = '';
  const img = attachment;
  attachment = null; $('attach').classList.add('hidden');
  typingEl = addMsg('', 'ai typing');
  typingEl.innerHTML = '<span class="dots"><i></i><i></i><i></i></span><span class="typing-status">Gemini lagi mikir...</span>';
  typingStatusEl = typingEl.querySelector('.typing-status');
  setSending(true);
  try {
    const answer = await ISL.askGemini(prompt, img);
    typingEl.textContent = answer;
    typingEl.classList.remove('typing');
  } catch (e) {
    const msg = (e.message || e).toString().replace(/^Error invoking remote method '[^']+': /, '').replace(/^Error: /, '');
    typingEl.textContent = msg === 'Dibatalkan.' ? 'Dibatalkan.' : 'Error: ' + msg;
    typingEl.classList.remove('typing');
    if (msg === 'Dibatalkan.') typingEl.classList.add('cancelled');
  } finally {
    typingEl = null; typingStatusEl = null;
    setSending(false);
    $('inp-msg').focus();
  }
}
$('btn-send').onclick = () => { if (sending) { try { ISL.abortGemini(); } catch { /* abaikan */ } } else sendMsg(); };
$('inp-msg').addEventListener('keydown', e => { if (e.key === 'Enter') sendMsg(); });
$('btn-shot').onclick = takeScreenshot;
$('btn-detach').onclick = () => { attachment = null; $('attach').classList.add('hidden'); };
$('btn-settings').onclick = async () => {
  $('settings').classList.toggle('hidden');
  try {
    const s = await ISL.getSettings();
    if (![...$('inp-model').options].some(o => o.value === s.model)) {
      $('inp-model').add(new Option(s.model, s.model));
    }
    $('inp-model').value = s.model;
    $('chat-model').textContent = s.model;
    $('settings-status').textContent = s.hasKey ? 'Key sudah tersimpan ✓' : 'Key belum diisi';
    // v1.8: muat daftar model ASLI dari key user — yang muncul = yang beneran
    // tersedia buat key itu (key gratis tidak akan menampilkan Argon, key
    // API berbayar akan). Gagal muat = daftar bawaan tetap dipakai.
    if (s.hasKey || $('inp-key').value.trim()) {
      try {
        const names = await ISL.listGeminiModels({ apiKey: $('inp-key').value });
        if (Array.isArray(names) && names.length) {
          const chosen = $('inp-model').value;
          const keep = ['gemini-4-argon', 'gemini-3.8-flash', 'gemini-3.1-pro-preview', 'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash'];
          const ordered = [...keep.filter(k => names.includes(k)), ...names.filter(n => !keep.includes(n))];
          $('inp-model').innerHTML = '';
          for (const n of ordered) $('inp-model').add(new Option(n, n));
          if (![...$('inp-model').options].some(o => o.value === chosen)) $('inp-model').add(new Option(chosen, chosen));
          $('inp-model').value = chosen;
          $('settings-status').textContent = 'Key valid ✓ — ' + ordered.length + ' model tersedia buat key ini.';
        }
      } catch { /* daftar bawaan tetap dipakai */ }
    }
  } catch { /* abaikan */ }
};
$('btn-save-settings').onclick = async () => {
  try { await ISL.saveSettings({ apiKey: $('inp-key').value, model: $('inp-model').value }); } catch { /* abaikan */ }
  $('inp-key').value = '';
  $('chat-model').textContent = $('inp-model').value;
  $('settings-status').textContent = 'Tersimpan ✓';
};
$('btn-test-gemini').onclick = async () => {
  const st = $('settings-status');
  st.textContent = 'Menghubungi Google...';
  try {
    const r = await ISL.testGemini({ apiKey: $('inp-key').value, model: $('inp-model').value });
    st.textContent = r.modelFound
      ? 'Koneksi OK ✓ — key valid, model ' + $('inp-model').value + ' tersedia buat key ini.'
      : 'Key valid ✓, tapi model ' + $('inp-model').value + ' TIDAK ada di daftar key ini (' + r.totalModels + ' model). Pilih model lain — pas dipakai, model itu bakal 404 dan jatuh ke cadangan.';
  } catch (e) { st.textContent = 'Tes gagal: ' + (e.message || e); }
};

addMsg('Garis sembunyi sekarang jauh lebih kecil dan gelap netral, dan animasinya diringankan — harusnya island terasa jauh lebih enteng.', 'ai');
// === v1.4: volume laptop ===
let volMuted = false;
function paintVolume(st) {
  if (!st) return;
  const slider = $('vol-slider');
  if (st.ok) {
    slider.disabled = false;
    slider.value = st.level;
    slider.style.setProperty('--fill', st.level + '%');
    volMuted = !!st.muted;
    $('vol-pct').textContent = st.level + '%';
    $('vol-pct').classList.toggle('muted', volMuted);
  } else {
    slider.disabled = true;
    $('vol-pct').textContent = '—';
    $('vol-pct').title = 'Volume sistem tidak terbaca di mesin ini';
  }
}
async function refreshVolume() { try { paintVolume(await window.island.getVolume()); } catch { /* abaikan */ } }
let volDebounce = null;
$('vol-slider').addEventListener('input', e => {
  const v = Number(e.target.value);
  e.target.style.setProperty('--fill', v + '%');
  $('vol-pct').textContent = v + '%';
  $('vol-pct').classList.remove('muted');
  clearTimeout(volDebounce);
  volDebounce = setTimeout(async () => { try { paintVolume(await window.island.setVolume(v)); } catch { /* abaikan */ } }, 140);
});
$('btn-vol-down').onclick = async () => { try { paintVolume(await window.island.volStep(-1)); } catch { /* abaikan */ } };
$('btn-vol-up').onclick = async () => { try { paintVolume(await window.island.volStep(1)); } catch { /* abaikan */ } };
$('vol-pct').onclick = async () => { try { paintVolume(await window.island.setMute(!volMuted)); } catch { /* abaikan */ } };
islOn('onHiddenState', hidden => document.body.classList.toggle('is-hidden', !!hidden));
refreshVolume();

console.log('[Renderer] SEMUA handler tombol terpasang, renderer v1.13 siap penuh.');
