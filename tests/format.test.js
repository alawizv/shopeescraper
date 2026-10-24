const test = require('node:test');
const assert = require('node:assert/strict');
const ShopeeFormat = require('../utils/format.js');

test('groupThousands: pemisah ribuan titik gaya Indonesia', () => {
  assert.equal(ShopeeFormat.groupThousands(0), '0');
  assert.equal(ShopeeFormat.groupThousands(999), '999');
  assert.equal(ShopeeFormat.groupThousands(1000), '1.000');
  assert.equal(ShopeeFormat.groupThousands(1234567), '1.234.567');
});

test('groupThousands: desimal dibulatkan, bukan ditulis "12.345.5"', () => {
  assert.equal(ShopeeFormat.groupThousands(12345.5), '12.346');
  assert.equal(ShopeeFormat.groupThousands(12345.4), '12.345');
  assert.equal(ShopeeFormat.groupThousands(0.4), '0');
  assert.equal(ShopeeFormat.groupThousands(12345.123456789), '12.345');
});

test('groupThousands: noise floating point tidak muncul di hasil', () => {
  assert.equal(ShopeeFormat.groupThousands(0.1 + 0.2), '0');
  assert.equal(ShopeeFormat.groupThousands(1234.30000000000004, 2), '1.234,3');
});

test('groupThousands: mata uang bersen memakai koma desimal', () => {
  assert.equal(ShopeeFormat.groupThousands(12.9, 2), '12,9');
  assert.equal(ShopeeFormat.groupThousands(1234.567, 2), '1.234,57');
});

test('groupThousands: negatif dan nilai tidak valid', () => {
  assert.equal(ShopeeFormat.groupThousands(-1234.5), '-1.235');
  assert.equal(ShopeeFormat.groupThousands('abc'), '0');
  assert.equal(ShopeeFormat.groupThousands(NaN), '0');
  assert.equal(ShopeeFormat.groupThousands(Infinity), '0');
});

test('groupThousands: string angka dari API tetap diformat', () => {
  assert.equal(ShopeeFormat.groupThousands('1500000'), '1.500.000');
});

test('formatMoney: Rupiah dibulatkan tanpa desimal', () => {
  assert.equal(ShopeeFormat.formatMoney(12345.5, 'Rp'), 'Rp 12.346');
  assert.equal(ShopeeFormat.formatMoney(0, 'Rp'), 'Rp 0');
  assert.equal(ShopeeFormat.formatMoney(2500000, 'Rp'), 'Rp 2.500.000');
});

test('formatMoney: mata uang lain mempertahankan sen', () => {
  assert.equal(ShopeeFormat.formatMoney(12.9, 'RM'), 'RM 12,9');
  assert.equal(ShopeeFormat.formatMoney(1234, 'S$'), 'S$ 1.234');
});

test('formatMoney: Dong tidak punya sen', () => {
  assert.equal(ShopeeFormat.formatMoney(150000.6, '₫'), '₫ 150.001');
});
