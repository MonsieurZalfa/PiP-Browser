const fs = require('node:fs');
const { normalizeUrl } = require('./core');

function sanitizeBookmarks(value) {
  const bookmarks = new Map();
  for (const item of Array.isArray(value) ? value : []) {
    try {
      const url = normalizeUrl(item?.url);
      if (!bookmarks.has(url)) bookmarks.set(url, {
        url, title: typeof item.title === 'string' && item.title.trim() ? item.title.trim().slice(0, 300) : url,
      });
    } catch {}
  }
  return [...bookmarks.values()];
}

function createBookmarkStore(file) {
  let bookmarks = [];
  try { bookmarks = sanitizeBookmarks(JSON.parse(fs.readFileSync(file, 'utf8'))); }
  catch (error) { if (error.code !== 'ENOENT') console.warn('Lecture des favoris impossible :', error.message); }
  function save(next) {
    try {
      fs.writeFileSync(`${file}.tmp`, JSON.stringify(next, null, 2));
      fs.renameSync(`${file}.tmp`, file);
    } catch { throw new Error('Impossible d’enregistrer les favoris. Vérifie l’accès au dossier de données.'); }
    bookmarks = next;
  }
  return {
    list: () => bookmarks.map(item => ({ ...item })),
    has: url => { try { return bookmarks.some(item => item.url === normalizeUrl(url)); } catch { return false; } },
    toggle(url, title) {
      url = normalizeUrl(url);
      save(bookmarks.some(item => item.url === url)
        ? bookmarks.filter(item => item.url !== url)
        : [...bookmarks, ...sanitizeBookmarks([{ url, title }])]);
    },
    remove(url) { save(bookmarks.filter(item => item.url !== url)); },
  };
}

module.exports = { sanitizeBookmarks, createBookmarkStore };
