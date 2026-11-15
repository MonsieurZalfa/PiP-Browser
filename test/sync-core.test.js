const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseYoutubeVideo, watchUrl, normalizeRoomCode, expectedPosition, needsCorrection,
  isNewerRoom, clockOffset, sanitizeMediaReport, sanitizeSyncSettings, cleanText,
} = require('../src/sync-core');

test('only YouTube video addresses can be shared with the room', () => {
  for (const url of [
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42',
    'youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtu.be/dQw4w9WgXcQ?si=abc',
    'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://www.youtube.com/shorts/dQw4w9WgXcQ',
    'https://www.youtube.com/live/dQw4w9WgXcQ',
  ]) assert.equal(parseYoutubeVideo(url), 'dQw4w9WgXcQ', url);
  for (const url of [
    'https://example.com/watch?v=dQw4w9WgXcQ', 'https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ',
    'javascript:alert(1)', 'file:///C:/x', 'https://www.youtube.com/watch?v=short', 'https://www.youtube.com/',
    'https://user:pass@www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ"><script>', '', null,
  ]) assert.equal(parseYoutubeVideo(url), null, String(url));
  assert.equal(watchUrl('dQw4w9WgXcQ'), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.throws(() => watchUrl('../../evil'));
});

test('room codes are normalized and ambiguous characters rejected', () => {
  assert.equal(normalizeRoomCode(' abc-234 '), 'ABC234');
  assert.equal(normalizeRoomCode('ABCDE1'), null); // 1 is ambiguous with I
  assert.equal(normalizeRoomCode('ABCDEO'), null);
  assert.equal(normalizeRoomCode('ABC'), null);
  assert.equal(normalizeRoomCode(undefined), null);
});

test('expected position follows the server clock while playing', () => {
  const room = { video_id: 'dQw4w9WgXcQ', playing: true, position: 10, state_updated_at: '2026-11-15T12:00:00.000Z' };
  const now = Date.parse('2026-11-15T12:00:05.000Z');
  assert.equal(expectedPosition(room, now), 15);
  assert.equal(expectedPosition(room, now - 2000, 2000), 15); // local clock 2 s late
  assert.equal(expectedPosition({ ...room, playing: false }, now), 10);
  assert.equal(expectedPosition({ ...room, video_id: null }, now), 0);
  assert.equal(needsCorrection(13.5, 15), false);
  assert.equal(needsCorrection(12, 15), true);
});

test('stale realtime events never overwrite a newer room state', () => {
  const current = { id: 'ABC234', revision: 5 };
  assert.equal(isNewerRoom(current, { id: 'ABC234', revision: 4 }), false);
  assert.equal(isNewerRoom(current, { id: 'ABC234', revision: 5 }), true);
  assert.equal(isNewerRoom(current, { id: 'ABC234', revision: 6 }), true);
  assert.equal(isNewerRoom(current, null), false);
});

test('clock offset uses the middle of the round trip', () => {
  assert.equal(clockOffset(1000, 1200, new Date(3100).toISOString()), 2000);
  assert.equal(clockOffset(1000, 900, new Date(0).toISOString()), 0);
  assert.equal(clockOffset(1000, 1200, 'invalid'), 0);
});

test('media reports from pages and saved settings are validated', () => {
  assert.deepEqual(sanitizeMediaReport({ type: 'pause', time: 12.5, videoId: 'dQw4w9WgXcQ', playing: false }),
    { type: 'pause', time: 12.5, videoId: 'dQw4w9WgXcQ', playing: false, ad: false });
  for (const report of [null, { type: 'eval', time: 1, videoId: 'dQw4w9WgXcQ' }, { type: 'play', time: -1, videoId: 'dQw4w9WgXcQ' },
    { type: 'play', time: Infinity, videoId: 'dQw4w9WgXcQ' }, { type: 'play', time: 1, videoId: 'bad' }]) {
    assert.equal(sanitizeMediaReport(report), null);
  }
  assert.deepEqual(sanitizeSyncSettings({ enabled: 'yes', lastRoom: 'abc234' }), { enabled: false, lastRoom: 'ABC234' });
  assert.deepEqual(sanitizeSyncSettings(null), { enabled: false, lastRoom: null });
  assert.equal(cleanText('  a\u0000b\n  c ', 10), 'a b c');
});
