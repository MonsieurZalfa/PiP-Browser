const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { sanitizeBookmarks, createBookmarkStore } = require('../src/bookmarks');

test('saved bookmarks reject unsafe URLs and duplicates, and retain page titles as text', () => {
  assert.deepEqual(sanitizeBookmarks([
    null, { url: 'javascript:alert(1)' }, { url: 'file:///secret' },
    { url: 'https://user:password@example.com' },
    { url: 'https://example.com', title: '<b>Mon favori & vidéo</b>' },
    { url: 'https://example.com/', title: 'Doublon' },
    { url: 'https://other.test', title: ' ' },
  ]), [
    { url: 'https://example.com/', title: '<b>Mon favori & vidéo</b>' },
    { url: 'https://other.test/', title: 'https://other.test/' },
  ]);
  assert.deepEqual(sanitizeBookmarks({}), []);
});

test('favorites survive restart, can be removed, and preserve distinct video URLs', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pip-bookmarks-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'bookmarks.json');
  const store = createBookmarkStore(file);
  assert.deepEqual(store.list(), []);
  store.toggle('https://example.test/watch?v=1', 'Vidéo 1');
  store.toggle('https://example.test/watch?v=2', 'Vidéo 2');
  const restored = createBookmarkStore(file);
  assert.deepEqual(restored.list(), store.list());
  const copy = restored.list();
  copy[0].title = 'Changed';
  assert.equal(restored.list()[0].title, 'Vidéo 1');
  restored.toggle('https://example.test/watch?v=1');
  assert.equal(restored.has('https://example.test/watch?v=1'), false);
  restored.remove('https://example.test/watch?v=2');
  assert.deepEqual(createBookmarkStore(file).list(), []);
  assert.throws(() => restored.toggle('javascript:alert(1)'));
  assert.equal(restored.has('about:blank'), false);
});

test('a failed save leaves the current favorites intact', () => {
  const store = createBookmarkStore(path.join(os.tmpdir(), 'pip-missing-parent', 'missing', 'bookmarks.json'));
  assert.throws(() => store.toggle('https://example.test'), /Impossible d’enregistrer/);
  assert.deepEqual(store.list(), []);
});
