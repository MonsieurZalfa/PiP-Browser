// Native interception for Twitch: its player can consume/cancel DOM pointer events.
function createRightGesture({ start, move, end, toggle, now = () => performance.now() }) {
  let press = null, last = null;
  const point = mouse => ({ x: mouse.globalX ?? mouse.x, y: mouse.globalY ?? mouse.y });
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const cancel = () => { if (press?.dragging) end(); press = null; last = null; };
  function handle(event, mouse) {
    if (mouse.type === 'contextMenu') { event.preventDefault(); return; }
    if (mouse.type === 'mouseDown') {
      if (mouse.button !== 'right') { last = null; return; }
      event.preventDefault();
      press = { origin: point(mouse), time: now(), dragging: false };
      return;
    }
    if (mouse.type === 'mouseUp' && mouse.button === 'right') {
      event.preventDefault();
      const previous = press; press = null;
      if (!previous) return;
      if (previous.dragging) { end(); last = null; return; }
      const time = now();
      if (time - previous.time > 450) { last = null; return; }
      if (last && time - last.time <= 450 && distance(previous.origin, last) <= 6) {
        last = null; toggle();
      } else last = { ...previous.origin, time };
      return;
    }
    if (mouse.type !== 'mouseMove' || !press) return;
    if (mouse.modifiers && !mouse.modifiers.includes('rightButtonDown')) { cancel(); return; }
    const current = point(mouse);
    if (!press.dragging) {
      if (distance(current, press.origin) < 6) return;
      press.dragging = true; last = null; start(press.origin);
    }
    event.preventDefault(); move(current);
  }
  return { handle, cancel };
}
module.exports = { createRightGesture };
