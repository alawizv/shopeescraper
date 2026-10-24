const test = require('node:test');
const assert = require('node:assert/strict');
const ShopeeAntiBot = require('../utils/antibot.js');
const { createInjectorWorld, okResponse } = require('./helpers/injector-world.js');

const KEY = ShopeeAntiBot.STORAGE_KEY;
const PRODUCT = { data: { item: { name: 'Kaos Polos' } } };

let ratingSeq = 0;
function ratings(n) {
  return Array.from({ length: n }, () => ({ rating_id: `r${++ratingSeq}`, rating_star: 5, comment: 'bagus' }));
}

function activeRecord() {
  return ShopeeAntiBot.createBlock('http_403');
}

function expiredRecord() {
  return ShopeeAntiBot.createBlock('http_403', Date.now() - ShopeeAntiBot.COOLDOWN_MS - 1000);
}

const status = (world) => world.storage.shopeeScraperData?.fetchStatus;

// ── Mendeteksi blokir ──

test('api_error HTTP 403 dari interceptor dicatat dan menghentikan scraping', () => {
  const world = createInjectorWorld();
  world.postFromInterceptor('api_error', { url: 'https://shopee.co.id/api/v2/item/get_ratings', status: 403, error: null });

  assert.equal(world.storage[KEY].reason, 'http_403');
  assert.ok(world.storage[KEY].until > Date.now(), 'jeda berlaku ke depan');
  assert.equal(world.context.CS_SHOPEE_STOP_FLAG, true);
});

test('HTTP 200 dengan error 90309999 juga dicatat sebagai blokir', () => {
  const world = createInjectorWorld();
  world.postFromInterceptor('api_error', { url: 'x', status: 200, error: 90309999 });
  assert.equal(world.storage[KEY].reason, 'error_90309999');
});

test('error biasa (HTTP 500, kode lain) bukan blokir', () => {
  const world = createInjectorWorld();
  world.postFromInterceptor('api_error', { url: 'x', status: 500, error: null });
  world.postFromInterceptor('api_error', { url: 'x', status: 200, error: 4 });
  assert.equal(world.storage[KEY], undefined);
  assert.notEqual(world.context.CS_SHOPEE_STOP_FLAG, true);
});

test('sinyal berikutnya selama jeda tidak menulis ulang catatan', () => {
  const world = createInjectorWorld();
  world.postFromInterceptor('api_error', { url: 'x', status: 403, error: null });
  world.postFromInterceptor('api_error', { url: 'x', status: 429, error: null });
  world.postFromInterceptor('api_error', { url: 'x', status: 200, error: 90309999 });

  const writes = world.storageSets.filter((s) => KEY in s);
  assert.equal(writes.length, 1);
  assert.equal(world.storage[KEY].reason, 'http_403');
});

test('mendarat di halaman /verify/ langsung dicatat sebagai blokir', () => {
  const world = createInjectorWorld({ href: 'https://shopee.co.id/verify/traffic/error' });
  assert.equal(world.storage[KEY].reason, 'redirect_verify');
});

test('halaman produk biasa tidak dicatat sebagai blokir', () => {
  const world = createInjectorWorld();
  assert.equal(world.storage[KEY], undefined);
});

// ── Menolak bekerja selama jeda ──

test('FETCH_REVIEWS dan CLICK_REVIEW_TABS ditolak selama jeda', () => {
  const world = createInjectorWorld({ storage: { [KEY]: activeRecord() } });
  return world.flush().then(() => {
    assert.deepEqual(world.sendMessage({ action: 'FETCH_REVIEWS' }), { status: 'blocked' });
    assert.deepEqual(world.sendMessage({ action: 'CLICK_REVIEW_TABS' }), { status: 'blocked' });
    assert.equal(world.fetchCalls.length, 0);
  });
});

test('jeda yang sudah habis tidak lagi menolak', async () => {
  const world = createInjectorWorld({ storage: { [KEY]: expiredRecord() } });
  await world.flush();
  world.timerMode = 'immediate';
  assert.deepEqual(world.sendMessage({ action: 'FETCH_REVIEWS' }), { status: 'processing' });
  await world.flush(200);
  world.dispose();
});

test('catatan blokir dari tab lain langsung berlaku, dan hilang saat dihapus', async () => {
  const world = createInjectorWorld();
  await world.flush();
  world.timerMode = 'immediate';

  world.setStorage(KEY, activeRecord());
  assert.deepEqual(world.sendMessage({ action: 'FETCH_REVIEWS' }), { status: 'blocked' });

  world.removeStorage(KEY);
  assert.deepEqual(world.sendMessage({ action: 'FETCH_REVIEWS' }), { status: 'processing' });
  await world.flush(200);
  world.dispose();
});

test('TRIGGER_SCRAPE tidak memanggil API produk langsung selama jeda', async () => {
  const world = createInjectorWorld({ storage: { [KEY]: activeRecord() } });
  await world.flush();
  world.sendMessage({ action: 'TRIGGER_SCRAPE' });
  await world.flush();
  assert.equal(world.fetchCalls.length, 0);
});

test('FETCH_SHOP_DETAIL tidak memanggil API toko selama jeda', async () => {
  const world = createInjectorWorld({ storage: { [KEY]: activeRecord() } });
  await world.flush();
  world.sendMessage({ action: 'FETCH_SHOP_DETAIL' });
  await world.flush();
  assert.equal(world.fetchCalls.length, 0);
});

// ── Auto-fetch review via direct API ──

async function runAutoFetch(world) {
  await world.flush();
  world.timerMode = 'immediate';
  world.postFromInterceptor('product', PRODUCT); // memicu autoFetchReviews() setelah jeda
  await world.flush(200);
  world.dispose();
}

test('auto-fetch: HTTP 403 menghentikan setelah satu request dan mencatat blokir', async () => {
  const world = createInjectorWorld({ fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({}) }) });
  await runAutoFetch(world);
  assert.equal(world.fetchCalls.length, 1);
  assert.equal(world.storage[KEY].reason, 'http_403');
});

test('auto-fetch: HTTP 429 juga berhenti total (tanpa retry)', async () => {
  const world = createInjectorWorld({ fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({}) }) });
  await runAutoFetch(world);
  assert.equal(world.fetchCalls.length, 1);
  assert.equal(world.storage[KEY].reason, 'http_429');
});

test('auto-fetch: HTTP 200 berisi error 90309999 dianggap blokir', async () => {
  const world = createInjectorWorld({ fetchImpl: async () => okResponse({ error: 90309999, data: null }) });
  await runAutoFetch(world);
  assert.equal(world.fetchCalls.length, 1);
  assert.equal(world.storage[KEY].reason, 'error_90309999');
});

test('auto-fetch: dilewati sepenuhnya selama jeda', async () => {
  const world = createInjectorWorld({ storage: { [KEY]: activeRecord() }, fetchImpl: async () => okResponse({ data: { ratings: ratings(6) } }) });
  await runAutoFetch(world);
  assert.equal(world.fetchCalls.length, 0);
});

test('auto-fetch: tanpa blokir tetap berjalan sampai halaman terakhir', async () => {
  const pages = [ratings(6), ratings(3)];
  const world = createInjectorWorld({ fetchImpl: async () => okResponse({ data: { ratings: pages.shift() || [] } }) });
  await runAutoFetch(world);
  assert.equal(world.fetchCalls.length, 2);
  assert.equal(world.storage[KEY], undefined);
  assert.equal(status(world), 'done:9');
});

test('auto-fetch: blokir di halaman kedua menyimpan hasil sebagian sebagai "stopped"', async () => {
  let call = 0;
  const world = createInjectorWorld({
    fetchImpl: async () => (++call === 1
      ? okResponse({ data: { ratings: ratings(6) } })
      : { ok: false, status: 403, json: async () => ({}) })
  });
  await runAutoFetch(world);
  assert.equal(world.fetchCalls.length, 2);
  assert.equal(status(world), 'stopped:6');
});

// ── Jalur utama: klik pagination ──

// Tombol "next" palsu yang ditemukan oleh loop pagination; onClick meniru apa yang
// terjadi di halaman asli (Shopee mengirim request, interceptor melaporkan hasilnya).
function installNextButton(world, onClick) {
  const btn = {
    disabled: false,
    firstElementChild: null,
    classList: { contains: () => false },
    closest: () => null,
    getAttribute: () => null,
    getBoundingClientRect: () => ({ width: 10, height: 10 }),
    scrollIntoView() {},
    dispatchEvent() {},
    click() { world.clicks++; onClick(world.clicks); }
  };
  world.selectors['button.shopee-icon-button--right'] = [btn];
}

async function runPagination(world) {
  await world.flush();
  world.timerMode = 'immediate';
  assert.deepEqual(world.sendMessage({ action: 'FETCH_REVIEWS' }), { status: 'processing' });
  await world.flush(600);
  world.dispose();
}

test('pagination: respons 403 setelah klik menghentikan klik berikutnya dan direct API', async () => {
  const world = createInjectorWorld();
  installNextButton(world, () => {
    world.postFromInterceptor('api_error', { url: 'https://shopee.co.id/api/v2/item/get_ratings', status: 403, error: null });
  });
  await runPagination(world);

  assert.equal(world.clicks, 1, 'tidak ada klik setelah blokir terdeteksi');
  assert.equal(world.fetchCalls.length, 0, 'tidak jatuh ke direct API setelah diblokir');
  assert.equal(world.storage[KEY].reason, 'http_403');
  assert.equal(status(world), 'stopped:0');
});

test('pagination: error 90309999 pada klik ke-3 menyisakan 12 review dan berhenti', async () => {
  const world = createInjectorWorld();
  installNextButton(world, (n) => {
    if (n < 3) world.postFromInterceptor('reviews', { data: { ratings: ratings(6) } });
    else world.postFromInterceptor('api_error', { url: 'x', status: 200, error: 90309999 });
  });
  await runPagination(world);

  assert.equal(world.clicks, 3);
  assert.equal(world.storage[KEY].reason, 'error_90309999');
  assert.equal(status(world), 'stopped:12');
});

test('pagination: tanpa blokir loop tetap jalan sampai data habis (kontrol)', async () => {
  const world = createInjectorWorld();
  installNextButton(world, (n) => {
    if (n <= 3) world.postFromInterceptor('reviews', { data: { ratings: ratings(6) } });
  });
  await runPagination(world);

  assert.ok(world.clicks > 3, 'terus mengklik sampai beberapa klik kosong beruntun');
  assert.equal(world.storage[KEY], undefined);
  assert.equal(status(world), 'done:18');
});
