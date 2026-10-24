const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

// Skrip yang dipasang Chrome lewat manifest di halaman Shopee.
function manifestContentScripts() {
  const manifest = JSON.parse(read('manifest.json'));
  return manifest.content_scripts.flatMap((group) => group.js);
}

// Skrip yang disuntik popup.js saat content script tidak menjawab.
function popupReinjectFiles() {
  const src = read('popup/popup.js');
  const match = src.match(/files:\s*\[([^\]]+)\]/);
  assert.ok(match, 'daftar files di executeScript popup.js tidak ditemukan');
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

test('re-inject popup menyuntik semua skrip yang dipasang manifest', () => {
  const fromManifest = [...new Set(manifestContentScripts())].sort();
  const fromPopup = [...new Set(popupReinjectFiles())].sort();
  assert.deepEqual(fromPopup, fromManifest);
});

test('popup.html memuat semua skrip utils manifest sebelum popup.js', () => {
  const html = read('popup/popup.html');
  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1].replace(/^\.\.\//, ''));
  const popupAt = scripts.indexOf('popup.js');
  assert.ok(popupAt > 0, 'popup.js harus ada di popup.html');
  for (const dep of manifestContentScripts().filter((f) => f.startsWith('utils/'))) {
    const at = scripts.indexOf(dep);
    assert.ok(at >= 0 && at < popupAt, `${dep} harus dimuat popup.html sebelum popup.js`);
  }
});

test('re-inject popup memuat dependensi sebelum panel.js', () => {
  const files = popupReinjectFiles();
  const panelAt = files.indexOf('content/panel.js');
  assert.ok(panelAt > 0, 'panel.js harus ada di daftar');
  for (const dep of files.filter((f) => f.startsWith('utils/'))) {
    assert.ok(files.indexOf(dep) < panelAt, `${dep} harus dimuat sebelum panel.js`);
  }
});
