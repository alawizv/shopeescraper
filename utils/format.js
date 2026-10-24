/**
 * format.js
 * =========
 * Helper tampilan yang dipakai bersama oleh panel.js (content script) dan popup.js.
 * Tanpa akses DOM / chrome.* sehingga bisa diuji langsung di Node.
 *
 * Pola `var X = typeof X ...` membuat file ini aman disuntik ulang oleh popup.js
 * (chrome.scripting.executeScript) tanpa error "already declared".
 */

var ShopeeFormat = (typeof ShopeeFormat !== 'undefined' && ShopeeFormat) ? ShopeeFormat : {
  /**
   * Angka dengan pemisah ribuan titik gaya Indonesia (1.234.567).
   * Dibulatkan ke `fractionDigits` desimal; sisa desimal ditulis dengan koma (12,9),
   * bukan titik, supaya tidak tertukar dengan pemisah ribuan.
   * Nilai yang bukan angka dianggap 0.
   */
  groupThousands(num, fractionDigits = 0) {
    const n = Number(num);
    return (Number.isFinite(n) ? n : 0).toLocaleString('id-ID', {
      minimumFractionDigits: 0,
      maximumFractionDigits: fractionDigits
    });
  },

  /**
   * Nominal uang dengan simbol mata uang, mis. "Rp 1.234.567".
   * Rupiah dan Dong tidak punya satuan sen sehingga selalu dibulatkan;
   * mata uang lain tampil sampai 2 desimal bila memang berpecahan.
   */
  formatMoney(num, symbol) {
    const noMinorUnit = symbol === 'Rp' || symbol === '₫';
    return symbol + ' ' + this.groupThousands(num, noMinorUnit ? 0 : 2);
  }
};

if (typeof module !== 'undefined') {
  module.exports = ShopeeFormat;
}
