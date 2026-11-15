// Pure helpers for guild synchronisation. No Electron or network access here.
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const ROOM_CODE = /^[A-HJ-NP-Z2-9]{6}$/;
const DRIFT_TOLERANCE = 2;

// Only YouTube videos are shared between members, never an arbitrary address.
function parseYoutubeVideo(input) {
  if (typeof input !== 'string' || input.length > 2048) return null;
  let url;
  try { url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(input.trim()) ? input.trim() : `https://${input.trim()}`); } catch { return null; }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  let id = null;
  if (host === 'youtu.be') id = url.pathname.split('/')[1];
  else if (/^((www|m|music)\.)?youtube\.com$/.test(host)) {
    if (url.pathname === '/watch') id = url.searchParams.get('v');
    else {
      const match = url.pathname.match(/^\/(shorts|live|embed)\/([^/]+)/);
      if (match) id = match[2];
    }
  }
  return id && VIDEO_ID.test(id) ? id : null;
}

function watchUrl(videoId) {
  if (!VIDEO_ID.test(String(videoId))) throw new Error('Identifiant de vidéo invalide.');
  return `https://www.youtube.com/watch?v=${videoId}`;
}

function normalizeRoomCode(input) {
  const code = String(input ?? '').trim().toUpperCase().replace(/[\s-]/g, '');
  return ROOM_CODE.test(code) ? code : null;
}

function cleanText(input, max) {
  return String(input ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

// Position the room expects right now, using the server clock offset.
function expectedPosition(room, nowMs, serverOffsetMs = 0) {
  if (!room?.video_id) return 0;
  const base = Math.max(0, Number(room.position) || 0);
  if (!room.playing) return base;
  const updated = Date.parse(room.state_updated_at);
  if (!Number.isFinite(updated)) return base;
  return base + Math.max(0, nowMs + serverOffsetMs - updated) / 1000;
}

function needsCorrection(localTime, expected, tolerance = DRIFT_TOLERANCE) {
  return Number.isFinite(localTime) && Number.isFinite(expected) && Math.abs(localTime - expected) > tolerance;
}

// Realtime events can arrive out of order: keep only the newest room state.
function isNewerRoom(current, incoming) {
  if (!incoming || typeof incoming.id !== 'string') return false;
  if (!current || current.id !== incoming.id) return true;
  return Number(incoming.revision) >= Number(current.revision);
}

// Clock offset from one round trip to `server_now()`.
function clockOffset(sentMs, receivedMs, serverIso) {
  const server = Date.parse(serverIso);
  if (!Number.isFinite(server) || receivedMs < sentMs) return 0;
  return server - (sentMs + receivedMs) / 2;
}

// Validates media reports coming from the sandboxed page preload.
function sanitizeMediaReport(report) {
  if (!report || typeof report !== 'object') return null;
  if (!['play', 'pause', 'seeked', 'ended', 'ready'].includes(report.type)) return null;
  const time = Number(report.time);
  if (!Number.isFinite(time) || time < 0 || time > 86400) return null;
  const videoId = VIDEO_ID.test(String(report.videoId)) ? report.videoId : null;
  if (!videoId) return null;
  return { type: report.type, time, videoId, playing: report.playing === true, ad: report.ad === true };
}

function sanitizeSyncSettings(saved) {
  const settings = saved && typeof saved === 'object' ? saved : {};
  return { enabled: settings.enabled === true, lastRoom: normalizeRoomCode(settings.lastRoom) };
}

module.exports = {
  DRIFT_TOLERANCE, parseYoutubeVideo, watchUrl, normalizeRoomCode, cleanText, expectedPosition,
  needsCorrection, isNewerRoom, clockOffset, sanitizeMediaReport, sanitizeSyncSettings,
};
