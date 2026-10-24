const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const panelSource = fs.readFileSync(path.join(__dirname, '..', 'content', 'panel.js'), 'utf8');

// Dunia content script palsu di halaman non-Shopee: panel tidak dipasang, tetapi
// listener storage dan interval navigasi SPA tetap didaftarkan oleh panel.js.
function createWorld() {
  const calls = { storageListeners: 0, intervals: 0 };
  const world = {
    location: { href: 'https://example.com/' },
    document: { getElementById: () => null },
    chrome: {
      storage: { onChanged: { addListener: () => { calls.storageListeners++; } } },
      runtime: { onMessage: { addListener: () => {} } }
    },
    setInterval: () => { calls.intervals++; return 0; },
    console
  };
  world.window = world;
  return { context: vm.createContext(world), calls };
}

test('panel.js bisa disuntik ulang tanpa error di dunia yang sama', () => {
  const { context } = createWorld();
  vm.runInContext(panelSource, context, { filename: 'panel.js' });
  assert.doesNotThrow(() => vm.runInContext(panelSource, context, { filename: 'panel.js' }));
});

test('suntik ulang panel.js tidak menggandakan listener dan interval', () => {
  const { context, calls } = createWorld();
  vm.runInContext(panelSource, context, { filename: 'panel.js' });
  try {
    vm.runInContext(panelSource, context, { filename: 'panel.js' });
  } catch (e) {
    // dilaporkan oleh tes di atas; di sini yang diperiksa hanya efek sampingnya
  }
  assert.equal(calls.storageListeners, 1);
  assert.equal(calls.intervals, 1);
});
