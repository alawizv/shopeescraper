const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const DEFAULT_HREF = 'https://shopee.co.id/produk-keren-i.2.1';

function okResponse(body) {
  return { ok: true, status: 200, json: async () => body };
}

/**
 * Menjalankan content/injector.js yang asli di dunia content script palsu:
 * chrome.storage dalam memori, DOM kosong, fetch dan timer yang bisa dikendalikan.
 *
 * Timer ada dua mode. 'manual' (awal): callback hanya dicatat, tidak dijalankan, supaya
 * init() tidak memicu apa-apa sendiri. 'immediate': setTimeout/setInterval langsung jalan
 * tanpa menunggu, sehingga loop scraping selesai dalam hitungan milidetik.
 */
function createInjectorWorld({ href = DEFAULT_HREF, storage = {}, fetchImpl } = {}) {
  const url = new URL(href);
  const world = {
    storage: { ...storage },
    storageSets: [],       // setiap pemanggilan chrome.storage.local.set (objek yang ditulis)
    fetchCalls: [],
    clicks: 0,
    timerMode: 'manual',
    selectors: {}          // selector -> array elemen palsu untuk document.querySelectorAll
  };

  const messageListeners = [];
  const storageListeners = [];
  const intervals = new Set();
  let onMessage = null;
  let seq = 0;

  const fireStorageChanged = (changes) => storageListeners.forEach((fn) => fn(changes, 'local'));

  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    location: { href: url.href, origin: url.origin, pathname: url.pathname },
    document: {
      readyState: 'complete',
      head: { appendChild() {} },
      documentElement: { appendChild() {} },
      body: {},
      createElement: () => ({}),
      addEventListener() {},
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: (selector) => world.selectors[selector] || []
    },
    MutationObserver: class { observe() {} disconnect() {} },
    MouseEvent: class MouseEvent { constructor(type) { this.type = type; } },
    chrome: {
      runtime: {
        lastError: undefined,
        getURL: (p) => p,
        sendMessage: () => Promise.resolve(),
        onMessage: { addListener: (fn) => { onMessage = fn; } }
      },
      storage: {
        onChanged: { addListener: (fn) => storageListeners.push(fn) },
        local: {
          get(key, cb) {
            const keys = Array.isArray(key) ? key : [key];
            const result = {};
            keys.forEach((k) => { if (k in world.storage) result[k] = world.storage[k]; });
            queueMicrotask(() => cb(result));
          },
          set(obj, cb) {
            world.storageSets.push(obj);
            const changes = {};
            Object.keys(obj).forEach((k) => { changes[k] = { oldValue: world.storage[k], newValue: obj[k] }; });
            Object.assign(world.storage, obj);
            fireStorageChanged(changes);
            if (cb) queueMicrotask(cb);
          },
          remove(key, cb) {
            const changes = { [key]: { oldValue: world.storage[key] } };
            delete world.storage[key];
            fireStorageChanged(changes);
            if (cb) queueMicrotask(cb);
          }
        }
      }
    },
    fetch: async (...args) => {
      world.fetchCalls.push(args[0]);
      return (fetchImpl || (async () => okResponse({ data: { ratings: [] } })))(...args);
    },
    setTimeout(fn) {
      if (world.timerMode === 'immediate') setImmediate(() => { try { fn(); } catch (e) { /* abaikan */ } });
      return ++seq;
    },
    clearTimeout() {},
    setInterval(fn) {
      const id = ++seq;
      intervals.add(id);
      if (world.timerMode === 'immediate') {
        const tick = () => {
          if (!intervals.has(id)) return;
          try { fn(); } catch (e) { /* abaikan */ }
          setImmediate(tick);
        };
        setImmediate(tick);
      }
      return id;
    },
    clearInterval(id) { intervals.delete(id); },
    scrollTo() {}
  };
  sandbox.window = sandbox;
  sandbox.addEventListener = (type, fn) => { if (type === 'message') messageListeners.push(fn); };

  vm.createContext(sandbox);
  vm.runInContext(read('utils/antibot.js'), sandbox, { filename: 'antibot.js' });
  vm.runInContext(read('content/injector.js'), sandbox, { filename: 'injector.js' });

  world.context = sandbox;

  /** Seperti interceptor.js: kirim pesan ke content script lewat window.postMessage. */
  world.postFromInterceptor = (type, data) => {
    // `window` di dalam konteks adalah objek global hasil contextify, bukan `sandbox` mentah;
    // injector membandingkan event.source dengan window itu.
    const event = { source: vm.runInContext('window', sandbox), data: { source: 'SHOPEE_SCRAPER_INTERCEPTOR', type, data } };
    messageListeners.forEach((fn) => fn(event));
  };

  /** Seperti popup/panel: kirim perintah ke injector, kembalikan respons sinkronnya. */
  world.sendMessage = (message) => {
    let response;
    onMessage(message, {}, (r) => { response = r; });
    // Objek dari dalam vm beda realm; lewat JSON supaya bisa dibandingkan dengan deepEqual
    return response === undefined ? undefined : JSON.parse(JSON.stringify(response));
  };

  /** Ubah storage dari luar (tab lain / panel) sehingga chrome.storage.onChanged ikut terpicu. */
  world.setStorage = (key, value) => sandbox.chrome.storage.local.set({ [key]: value });
  world.removeStorage = (key) => sandbox.chrome.storage.local.remove(key);

  world.flush = async (ticks = 30) => {
    for (let i = 0; i < ticks; i++) await new Promise((resolve) => setImmediate(resolve));
  };

  world.dispose = () => { intervals.clear(); world.timerMode = 'manual'; };

  return world;
}

module.exports = { createInjectorWorld, okResponse, DEFAULT_HREF };
