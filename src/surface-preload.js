// Isolated, sandboxed page input handling. Nothing is exposed to the website.
const { ipcRenderer } = require('electron');
let press = null;
let lastClick = null;
const send = (phase, point) => ipcRenderer.send('pip:surface-drag', phase, point);
const point = event => ({ x: event.screenX, y: event.screenY });
const stopEvent = event => { event.preventDefault(); event.stopImmediatePropagation(); };

window.addEventListener('pointerdown', event => {
  if (!event.isTrusted || event.button !== 2) return;
  stopEvent(event);
  press = { pointerId: event.pointerId, origin: point(event), time: performance.now(), dragging: false };
  document.documentElement.setPointerCapture(event.pointerId);
}, true);

window.addEventListener('pointermove', event => {
  if (!event.isTrusted || !press || press.pointerId !== event.pointerId) return;
  if (!(event.buttons & 2)) { finish(null, true); return; }
  const current = point(event);
  if (!press.dragging) {
    if (Math.hypot(current.x - press.origin.x, current.y - press.origin.y) < 6) return;
    press.dragging = true;
    lastClick = null;
    send('start', press.origin);
  }
  stopEvent(event);
  send('move', current);
}, true);

function finish(event, cancelled = false) {
  const previous = press;
  if (!previous) return;
  press = null;
  if (event) stopEvent(event);
  if (document.documentElement.hasPointerCapture(previous.pointerId)) document.documentElement.releasePointerCapture(previous.pointerId);
  if (previous.dragging) { send('end'); return; }
  const now = performance.now();
  if (cancelled || now - previous.time > 450) { lastClick = null; return; }
  // Wait for release: a second press that becomes a drag must not switch modes.
  if (lastClick && now - lastClick.time <= 450 && Math.hypot(previous.origin.x - lastClick.x, previous.origin.y - lastClick.y) <= 6) {
    lastClick = null;
    send('toggle');
  } else lastClick = { ...previous.origin, time: now };
}
window.addEventListener('pointerup', event => {
  if (event.isTrusted && event.button === 2 && press?.pointerId === event.pointerId) finish(event);
}, true);
window.addEventListener('pointercancel', event => {
  if (event.isTrusted && press?.pointerId === event.pointerId) finish(event, true);
}, true);
window.addEventListener('lostpointercapture', event => {
  if (press?.pointerId === event.pointerId) finish(null, true);
}, true);
window.addEventListener('blur', () => { finish(null, true); lastClick = null; });
window.addEventListener('contextmenu', stopEvent, true);
window.addEventListener('auxclick', event => { if (event.button === 2) stopEvent(event); }, true);
window.addEventListener('mousemove', event => { if (press?.dragging) stopEvent(event); }, true);

// Guild synchronisation. Only the synced window receives a target from the
// main process; other windows never report anything. Still nothing exposed.
let syncTarget = null;
let applying = null;
let settleUntil = 0;
const currentVideoId = () => {
  try {
    const url = new URL(location.href);
    if (!/(^|\.)youtube\.com$/.test(url.hostname) || url.pathname !== '/watch') return null;
    const id = url.searchParams.get('v');
    return /^[A-Za-z0-9_-]{11}$/.test(id || '') ? id : null;
  } catch { return null; }
};
const mediaElement = () => document.querySelector('#movie_player video') || document.querySelector('video');
const adShowing = () => Boolean(document.querySelector('#movie_player.ad-showing'));
const expectedTime = () => syncTarget.position + (syncTarget.playing ? (performance.now() - syncTarget.at) / 1000 : 0);
function reportMedia(type, video) {
  const videoId = currentVideoId();
  if (!syncTarget || !videoId || !video) return;
  ipcRenderer.send('pip:sync-media', { type, time: video.currentTime || 0, playing: !video.paused, videoId, ad: adShowing() });
}
function isEcho(type, video) {
  if (!applying || performance.now() > applying.until) return false;
  if (type === 'play') return applying.playing;
  if (type === 'pause') return !applying.playing;
  if (type === 'seeked') return Math.abs(video.currentTime - applying.position) < 1.5;
  return false;
}
function enforce() {
  if (!syncTarget || syncTarget.videoId !== currentVideoId() || adShowing()) return;
  const video = mediaElement();
  if (!video || video.readyState < 1) return;
  const position = expectedTime();
  const seek = Math.abs(video.currentTime - position) > 2 && (!Number.isFinite(video.duration) || position < video.duration);
  const toggle = syncTarget.playing === video.paused;
  if (!seek && !toggle) return;
  applying = { playing: syncTarget.playing, position, until: performance.now() + 1500 };
  if (seek) video.currentTime = position;
  if (syncTarget.playing && video.paused) video.play().catch(() => {});
  else if (!syncTarget.playing && !video.paused) video.pause();
}
ipcRenderer.on('pip:sync-apply', (_event, target) => {
  syncTarget = target && typeof target.videoId === 'string'
    ? { videoId: target.videoId, playing: target.playing === true, position: Math.max(0, Number(target.position) || 0), at: performance.now() }
    : null;
  enforce();
});
for (const type of ['play', 'pause', 'seeked', 'ended']) {
  window.addEventListener(type, event => {
    const video = event.target;
    if (!syncTarget || !(video instanceof HTMLVideoElement) || video !== mediaElement() || adShowing()) return;
    if (syncTarget.videoId !== currentVideoId()) return;
    if (type !== 'ended' && (performance.now() < settleUntil || isEcho(type, video))) return;
    // A local action becomes the new reference immediately, so the periodic
    // correction does not fight it while the room confirms the change.
    syncTarget = { ...syncTarget, playing: !video.paused && type !== 'ended', position: video.currentTime, at: performance.now() };
    reportMedia(type, video);
  }, true);
}
// YouTube starts playing by itself after loading: let the room state win.
window.addEventListener('loadedmetadata', event => {
  if (!syncTarget || event.target !== mediaElement()) return;
  settleUntil = performance.now() + 2500;
  reportMedia('ready', event.target);
  enforce();
}, true);
setInterval(enforce, 2000);
