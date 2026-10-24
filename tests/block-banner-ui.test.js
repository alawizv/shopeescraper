const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

// Elemen banner blokir harus ada di markup tempat JS-nya mencarinya; kalau salah ketik,
// getElementById mengembalikan null dan banner diam-diam tidak pernah tampil.
test('panel.js: id banner blokir ada di template dan dipakai kodenya', () => {
  const src = read('content/panel.js');
  for (const id of ['panelBlockBanner', 'panelBlockText', 'btnPanelClearBlock']) {
    assert.ok(src.includes(`id="${id}"`), `template tidak punya #${id}`);
    assert.ok(src.includes(`getElementById('${id}')`), `kode tidak mencari #${id}`);
  }
});

test('popup: id banner blokir ada di popup.html dan dipakai popup.js', () => {
  const html = read('popup/popup.html');
  const js = read('popup/popup.js');
  for (const id of ['block-banner', 'block-banner-text', 'btn-popup-clear-block']) {
    assert.ok(html.includes(`id="${id}"`), `popup.html tidak punya #${id}`);
    assert.ok(js.includes(`getElementById('${id}')`), `popup.js tidak mencari #${id}`);
  }
});

test('popup.css punya gaya untuk banner blokir dan kelas d-none', () => {
  const css = read('popup/popup.css');
  assert.match(css, /\.block-banner\s*\{/);
  assert.match(css, /\.d-none\s*\{/);
});
