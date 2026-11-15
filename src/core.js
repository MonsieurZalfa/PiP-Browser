const BAR_HEIGHT = 108;
const FRAME_MARGIN = 6;
const MIN_WIDTH = 384;
const DEFAULT_URL = 'https://www.youtube.com/';

function normalizeUrl(input) {
  if (typeof input !== 'string' || !input.trim()) throw new Error('Saisis une adresse internet.');
  const value = input.trim();
  const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Seules les adresses HTTP et HTTPS sans identifiants sont autorisées.');
  }
  return url.href;
}

function heightForWidth(width, compact) {
  return Math.round((width - FRAME_MARGIN * 2) * 9 / 16) + (compact ? FRAME_MARGIN : BAR_HEIGHT) + FRAME_MARGIN;
}

// Preserve the opposite edge while resizing from a top or left handle.
function constrainResize(current, proposed, edge, compact) {
  const vertical = edge === 'top' || edge === 'bottom';
  const chrome = (compact ? FRAME_MARGIN : BAR_HEIGHT) + FRAME_MARGIN;
  const width = Math.max(MIN_WIDTH, Math.round(vertical ? (proposed.height - chrome) * 16 / 9 + FRAME_MARGIN * 2 : proposed.width));
  const height = heightForWidth(width, compact);
  return {
    x: edge.includes('left') ? current.x + current.width - width : proposed.x,
    y: edge.includes('top') ? current.y + current.height - height : proposed.y,
    width,
    height,
  };
}

function sanitizeSavedWindow(saved = {}) {
  if (!saved || typeof saved !== 'object') saved = {};
  let url = DEFAULT_URL;
  try { url = normalizeUrl(saved.url); } catch {}
  return {
    url,
    width: Math.round(Math.max(MIN_WIDTH, Math.min(saved.layoutVersion === 2 ? 1600 : 800, Number(saved.width) || 640))),
    x: Number.isFinite(saved.x) ? saved.x : undefined,
    y: Number.isFinite(saved.y) ? saved.y : undefined,
    opacity: Math.max(0.2, Math.min(1, Number(saved.opacity) || 1)),
    compact: saved.layoutVersion === 2 && saved.compact === true,
    videoOnly: saved.videoOnly === true,
    layoutVersion: 2,
  };
}

module.exports = { BAR_HEIGHT, FRAME_MARGIN, MIN_WIDTH, DEFAULT_URL, normalizeUrl, heightForWidth, constrainResize, sanitizeSavedWindow };
