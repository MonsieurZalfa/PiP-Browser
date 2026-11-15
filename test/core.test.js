const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeUrl, constrainResize, heightForWidth, sanitizeSavedWindow } = require('../src/core');

test('navigation accepts website addresses and rejects local or executable protocols', () => {
  assert.equal(normalizeUrl('youtube.com/watch?v=abc'), 'https://youtube.com/watch?v=abc');
  assert.equal(normalizeUrl('http://localhost:3000'), 'http://localhost:3000/');
  for (const url of ['file:///C:/Windows/test', 'javascript:alert(1)', 'data:text/html,hello', 'https://user:password@example.com', '']) {
    assert.throws(() => normalizeUrl(url));
  }
});
test('resize keeps 16:9 content for every handle, including the minimum size', () => {
  const current = { x: 100, y: 100, width: 640, height: 448 };
  for (const compact of [false, true]) for (const edge of ['left', 'right', 'top', 'bottom', 'top-left', 'top-right', 'bottom-left', 'bottom-right']) {
    for (const size of [10, 500, 1200]) {
      const result = constrainResize(current, { x: 70, y: 80, width: size, height: size }, edge, compact);
      assert.ok(result.width >= 384);
      assert.equal(result.height, heightForWidth(result.width, compact));
      if (edge.includes('left')) assert.equal(result.x + result.width, current.x + current.width);
      if (edge.includes('top')) assert.equal(result.y + result.height, current.y + current.height);
    }
  }
});
test('saved settings cannot restore an invisible window or unsafe URL', () => {
  assert.equal(sanitizeSavedWindow(null).url, 'https://www.youtube.com/');
  const result = sanitizeSavedWindow({ opacity: 0.01, width: 1, url: 'file:///secret', x: Infinity });
  assert.equal(result.opacity, .2);
  assert.equal(result.width, 384);
  assert.equal(result.url, 'https://www.youtube.com/');
  assert.equal(result.x, undefined);
});

test('upgrade makes oversized legacy windows manageable without losing their URL', () => {
  const restored = sanitizeSavedWindow({ width: 3400, compact: true, url: 'https://www.youtube.com/watch?v=abc' });
  assert.equal(restored.width, 800);
  assert.equal(restored.compact, false);
  assert.equal(restored.url, 'https://www.youtube.com/watch?v=abc');
  assert.equal(sanitizeSavedWindow({ width: 1200, layoutVersion: 2 }).width, 1200);
});
