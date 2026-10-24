const test = require('node:test');
const assert = require('node:assert/strict');
const ShopeeAntiBot = require('../utils/antibot.js');

test('classify: HTTP 403 dan 429 adalah sinyal blokir', () => {
  assert.equal(ShopeeAntiBot.classify({ status: 403 }), 'http_403');
  assert.equal(ShopeeAntiBot.classify({ status: 429 }), 'http_429');
});

test('classify: error 90309999 di body (HTTP 200) adalah sinyal blokir', () => {
  assert.equal(ShopeeAntiBot.classify({ status: 200, error: 90309999 }), 'error_90309999');
  assert.equal(ShopeeAntiBot.classify({ error: '90309999' }), 'error_90309999');
});

test('classify: respons normal dan error biasa bukan blokir', () => {
  assert.equal(ShopeeAntiBot.classify({ status: 200, error: 0 }), null);
  assert.equal(ShopeeAntiBot.classify({ status: 200, error: null }), null);
  assert.equal(ShopeeAntiBot.classify({ status: 200 }), null);
  assert.equal(ShopeeAntiBot.classify({ status: 404 }), null);
  assert.equal(ShopeeAntiBot.classify({ status: 500, error: 12345 }), null);
  assert.equal(ShopeeAntiBot.classify({ error: undefined }), null);
  assert.equal(ShopeeAntiBot.classify(), null);
});

test('isVerifyPath: mengenali halaman tantangan Shopee', () => {
  assert.equal(ShopeeAntiBot.isVerifyPath('/verify/traffic/error'), true);
  assert.equal(ShopeeAntiBot.isVerifyPath('/verify/captcha'), true);
  assert.equal(ShopeeAntiBot.isVerifyPath('/produk-keren-i.1.2'), false);
  assert.equal(ShopeeAntiBot.isVerifyPath('/search'), false);
  assert.equal(ShopeeAntiBot.isVerifyPath('/shop/verify/x'), false);
  assert.equal(ShopeeAntiBot.isVerifyPath(''), false);
  assert.equal(ShopeeAntiBot.isVerifyPath(undefined), false);
});

test('createBlock + activeBlock: berlaku sampai cooldown habis', () => {
  const now = 1_000_000;
  const block = ShopeeAntiBot.createBlock('http_403', now);
  assert.deepEqual(block, { reason: 'http_403', at: now, until: now + ShopeeAntiBot.COOLDOWN_MS });

  assert.equal(ShopeeAntiBot.activeBlock(block, now + 1), block);
  assert.equal(ShopeeAntiBot.activeBlock(block, block.until - 1), block);
  assert.equal(ShopeeAntiBot.activeBlock(block, block.until), null, 'tepat saat habis sudah tidak aktif');
  assert.equal(ShopeeAntiBot.activeBlock(block, block.until + 60_000), null);
});

test('activeBlock: catatan kosong atau rusak dianggap tidak ada blokir', () => {
  assert.equal(ShopeeAntiBot.activeBlock(null), null);
  assert.equal(ShopeeAntiBot.activeBlock(undefined), null);
  assert.equal(ShopeeAntiBot.activeBlock({}), null);
  assert.equal(ShopeeAntiBot.activeBlock({ until: 'besok' }), null);
});

test('cooldown default cukup panjang (30 menit)', () => {
  assert.equal(ShopeeAntiBot.COOLDOWN_MS, 30 * 60 * 1000);
});

test('describe: teks mencantumkan alasan dan jam berakhir (waktu lokal)', () => {
  const until = new Date(2026, 9, 24, 14, 5).getTime();
  const info = ShopeeAntiBot.describe({ reason: 'http_403', at: until - 1, until });
  assert.equal(info.untilLabel, '14:05');
  assert.match(info.text, /HTTP 403/);
  assert.match(info.text, /sampai 14:05/);
});

test('describe: alasan tak dikenal tetap menghasilkan teks yang masuk akal', () => {
  const info = ShopeeAntiBot.describe({ reason: 'sesuatu_baru', at: 0, until: 60_000 });
  assert.match(info.text, /Shopee menolak permintaan/);
});
