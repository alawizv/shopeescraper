const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'content', 'interceptor.js'), 'utf8');

const RATINGS_URL = 'https://shopee.co.id/api/v2/item/get_ratings?itemid=1&limit=6&offset=0&shopid=2&type=0';
const PRODUCT_URL = 'https://shopee.co.id/api/v4/pdp/get_pc?item_id=1&shop_id=2';
const UNRELATED_URL = 'https://shopee.co.id/api/v4/tracking/ping?x=1';

// Halaman Shopee palsu: XHR dan fetch tiruan, postMessage ditangkap.
function createPage() {
  const posted = [];
  const cloned = [];

  class FakeXHR {
    constructor() { this.listeners = {}; }
    open() {}
    send() {}
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  }

  const page = {
    XMLHttpRequest: FakeXHR,
    Request: class Request { constructor(url) { this.url = url; } },
    URL,
    console: { log() {}, warn() {}, error() {} },
    fetchResponses: {}
  };
  page.window = page;
  page.postMessage = (message) => posted.push(message);
  page.fetch = async (input) => {
    const url = typeof input === 'string' ? input : (input.url || input.href);
    const spec = page.fetchResponses[url] || { status: 200, body: {} };
    return {
      status: spec.status,
      ok: spec.status >= 200 && spec.status < 300,
      clone() {
        cloned.push(url);
        return { json: async () => { if (spec.body === undefined) throw new SyntaxError('bukan JSON'); return spec.body; } };
      }
    };
  };

  vm.createContext(page);
  vm.runInContext(source, page, { filename: 'interceptor.js' });

  const messages = (type) => posted
    .filter((m) => m && m.source === 'SHOPEE_SCRAPER_INTERCEPTOR' && (!type || m.type === type));

  // Jalankan satu XHR sampai event load.
  const xhr = (url, status, responseText) => {
    const req = new page.XMLHttpRequest();
    req.open('GET', url);
    req.send();
    req.status = status;
    req.responseText = responseText;
    (req.listeners.load || []).forEach((fn) => fn.call(req));
  };

  // Jalankan satu fetch sampai body-nya selesai dibaca interceptor.
  const doFetch = async (input, spec) => {
    const url = typeof input === 'string' ? input : (input.url || input.href);
    page.fetchResponses[url] = spec;
    const response = await page.window.fetch(input);
    await new Promise((resolve) => setImmediate(resolve));
    return response;
  };

  return { page, messages, cloned, xhr, doFetch };
}

test('XHR: respons review normal diteruskan sebagai "reviews"', () => {
  const { messages, xhr } = createPage();
  xhr(RATINGS_URL, 200, JSON.stringify({ error: 0, data: { ratings: [{ rating_id: 1 }] } }));
  assert.equal(messages('reviews').length, 1);
  assert.equal(messages('api_error').length, 0);
});

test('XHR: HTTP 403 dilaporkan sebagai api_error dan datanya tidak diteruskan', () => {
  const { messages, xhr } = createPage();
  xhr(RATINGS_URL, 403, JSON.stringify({ error: 403, data: null }));
  const errors = messages('api_error');
  assert.equal(errors.length, 1);
  assert.equal(errors[0].data.status, 403);
  assert.equal(messages('reviews').length, 0);
});

test('XHR: HTTP 403 dengan body bukan JSON tetap dilaporkan', () => {
  const { messages, xhr } = createPage();
  xhr(RATINGS_URL, 403, '<html>Forbidden</html>');
  const errors = messages('api_error');
  assert.equal(errors.length, 1);
  assert.equal(errors[0].data.status, 403);
  assert.equal(errors[0].data.error, null);
});

test('XHR: HTTP 200 dengan error 90309999 di body dilaporkan', () => {
  const { messages, xhr } = createPage();
  xhr(PRODUCT_URL, 200, JSON.stringify({ error: 90309999, error_msg: null, data: null }));
  const errors = messages('api_error');
  assert.equal(errors.length, 1);
  assert.equal(errors[0].data.status, 200);
  assert.equal(errors[0].data.error, 90309999);
});

test('XHR: query string tidak ikut terkirim di laporan error', () => {
  const { messages, xhr } = createPage();
  xhr(RATINGS_URL, 403, '{}');
  assert.equal(messages('api_error')[0].data.url, 'https://shopee.co.id/api/v2/item/get_ratings');
});

test('XHR: url berupa objek URL tetap dikenali', () => {
  const { page, messages } = createPage();
  const req = new page.XMLHttpRequest();
  req.open('GET', new URL(RATINGS_URL));
  req.send();
  req.status = 403;
  req.responseText = '{}';
  req.listeners.load.forEach((fn) => fn.call(req));
  assert.equal(messages('api_error').length, 1);
});

test('XHR: endpoint di luar daftar diabaikan sepenuhnya', () => {
  const { messages, xhr } = createPage();
  xhr(UNRELATED_URL, 403, '{}');
  assert.equal(messages('api_error').length, 0);
  assert.equal(messages('reviews').length, 0);
});

test('fetch: respons normal diteruskan dan response asli dikembalikan utuh', async () => {
  const { messages, doFetch } = createPage();
  const response = await doFetch(PRODUCT_URL, { status: 200, body: { error: 0, data: { item: { name: 'x' } } } });
  assert.equal(response.status, 200);
  assert.equal(messages('product').length, 1);
  assert.equal(messages('api_error').length, 0);
});

test('fetch: HTTP 403 dilaporkan sebagai api_error', async () => {
  const { messages, doFetch } = createPage();
  await doFetch(RATINGS_URL, { status: 403, body: { error: 403 } });
  assert.equal(messages('api_error').length, 1);
  assert.equal(messages('api_error')[0].data.status, 403);
  assert.equal(messages('reviews').length, 0);
});

test('fetch: error 90309999 pada HTTP 200 dilaporkan', async () => {
  const { messages, doFetch } = createPage();
  await doFetch(RATINGS_URL, { status: 200, body: { error: 90309999, data: null } });
  assert.equal(messages('api_error')[0].data.error, 90309999);
});

test('fetch: input berupa objek URL tetap dikenali', async () => {
  const { messages, doFetch } = createPage();
  await doFetch(new URL(RATINGS_URL), { status: 403, body: {} });
  assert.equal(messages('api_error').length, 1);
});

test('fetch: endpoint di luar daftar tidak di-clone dan tidak dilaporkan', async () => {
  const { messages, cloned, doFetch } = createPage();
  await doFetch(UNRELATED_URL, { status: 403, body: {} });
  assert.equal(cloned.length, 0, 'body respons asing tidak boleh disentuh');
  assert.equal(messages('api_error').length, 0);
});

test('interceptor tetap mengumumkan kesiapannya', () => {
  const { messages } = createPage();
  assert.equal(messages('interceptor_ready').length, 1);
});
