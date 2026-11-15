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
