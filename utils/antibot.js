/**
 * antibot.js
 * ==========
 * Logika murni untuk mengenali dan mengingat blokir anti-bot Shopee.
 * Tanpa akses DOM / chrome.* sehingga bisa diuji langsung di Node.
 *
 * Alurnya: interceptor.js melaporkan respons API yang ditolak -> injector.js memanggil
 * classify() -> bila cocok, scraping dihentikan total dan sebuah catatan blokir disimpan
 * di chrome.storage.local (STORAGE_KEY) sampai COOLDOWN_MS lewat. Catatan itu bertahan
 * walau Shopee mengalihkan tab ke /verify/, dan berlaku untuk semua tab Shopee.
 *
 * Pola `var X = typeof X ...` membuat file ini aman disuntik ulang oleh popup.js.
 */

var ShopeeAntiBot = (typeof ShopeeAntiBot !== 'undefined' && ShopeeAntiBot) ? ShopeeAntiBot : {
  STORAGE_KEY: 'shopeeScraperBlock',

  // Lama scraping dijeda setelah blokir. Mengulang request saat sesi sudah ditandai bot
  // hanya memperdalam blokirnya, jadi jedanya sengaja panjang.
  COOLDOWN_MS: 30 * 60 * 1000,

  // Kode `error` di body JSON yang dikirim Shopee (sering dengan HTTP 200) saat request
  // ditolak sistem anti-fraud. Tambahkan kode baru di sini bila ditemukan.
  BLOCK_ERROR_CODES: [90309999],

  REASON_TEXT: {
    http_403: 'Shopee menolak permintaan (HTTP 403)',
    http_429: 'Shopee membatasi jumlah permintaan (HTTP 429)',
    error_90309999: 'Shopee menandai sesi ini sebagai otomatis (error 90309999)',
    redirect_verify: 'Shopee mengalihkan ke halaman verifikasi'
  },

  /**
   * Apakah respons API ini sinyal blokir? Mengembalikan kode alasan, atau null.
   * @param {{status?: number, error?: number|string|null}} response
   */
  classify(response) {
    const { status, error } = response || {};
    if (status === 403) return 'http_403';
    if (status === 429) return 'http_429';
    const code = Number(error);
    if (error !== null && error !== undefined && this.BLOCK_ERROR_CODES.includes(code)) {
      return 'error_' + code;
    }
    return null;
  },

  /** Halaman tantangan Shopee, mis. /verify/traffic/error atau /verify/captcha */
  isVerifyPath(pathname) {
    return /^\/verify\//.test(pathname || '');
  },

  createBlock(reason, now = Date.now()) {
    return { reason, at: now, until: now + this.COOLDOWN_MS };
  },

  /** Catatan blokir yang masih berlaku, atau null bila kosong / sudah lewat. */
  activeBlock(record, now = Date.now()) {
    if (!record || typeof record.until !== 'number') return null;
    return record.until > now ? record : null;
  },

  /** Teks siap tampil untuk panel dan popup. */
  describe(record) {
    const pad = (n) => String(n).padStart(2, '0');
    const until = new Date(record.until);
    const untilLabel = `${pad(until.getHours())}:${pad(until.getMinutes())}`;
    const reason = this.REASON_TEXT[record.reason] || 'Shopee menolak permintaan';
    return {
      reason,
      untilLabel,
      text: `⛔ ${reason}. Scraping dijeda sampai ${untilLabel}. Buka Shopee secara manual dan selesaikan verifikasi bila diminta.`
    };
  }
};

if (typeof module !== 'undefined') {
  module.exports = ShopeeAntiBot;
}
