/**
 * interceptor.js
 * ===============
 * Script ini berjalan di konteks halaman Shopee (page context).
 * Fungsinya: intercept semua response XHR dan fetch yang mengandung
 * data produk dan review dari API internal Shopee.
 * Data dikirim ke content script via window.postMessage.
 */

(function () {
  'use strict';

  // ========================================
  // Konfigurasi URL pattern API Shopee
  // ========================================
  const API_PATTERNS = {
    // Pattern untuk data produk utama (item detail)
    productDetail: [
      '/api/v4/item/get',
      '/api/v4/pdp/get',
      '/api/v2/item/get',
      '/pdp/api/pdp/get',
      '/api/v4/pdp/get_pc'
    ],
    // Pattern untuk data review/rating
    reviews: [
      '/api/v2/item/get_ratings',
      '/api/v4/item/get_ratings',
      '/pdp/api/pdp/get_ratings'
    ],
    // Pattern untuk data toko
    shop: [
      '/api/v4/shop/get_shop_detail',
      '/api/v2/shop/get',
      '/shop/get_shop_detail'
    ],
    // Pattern untuk data pencarian (mengandung data "Terjual/Bulan" per produk)
    search: [
      '/api/v4/search/search_items',
      '/api/v4/pdp/get_more_items_of_shop',
      '/api/v4/recommend/recommend_items',
      '/api/v4/item/get_items_by_shop',
      '/api/v4/flashsale/get_flash_sale_items',
      '/api/v4/shop_page/get_shop_item_list'
    ]
  };

  function matchesPattern(url, patterns) {
    return patterns.some(pattern => {
       // Mencegah false-positive di mana '/item/get' secara keliru menangkap '/item/get_ratings'
       return url.includes(pattern + '?') || url.includes(pattern + '&') || url.endsWith(pattern);
    });
  }

  /**
   * Kirim data hasil intercept ke content script
   * @param {string} type - Tipe data ('product' atau 'reviews')
   * @param {object} data - Data yang dikirim
   */
  function sendToContentScript(type, data) {
    window.postMessage({
      source: 'SHOPEE_SCRAPER_INTERCEPTOR',
      type: type,
      data: data
    }, '*');
  }

  // ========================================
  // Penerusan respons API ke content script
  // ========================================
  const ALL_API_PATTERNS = Object.values(API_PATTERNS).flat();

  function isApiUrl(url) {
    return matchesPattern(url, ALL_API_PATTERNS);
  }

  /**
   * Laporkan respons yang ditolak Shopee: HTTP >= 400, atau HTTP 200 dengan kode
   * `error` di body (cara Shopee menolak lewat sistem anti-fraud). Interceptor hanya
   * meneruskan fakta; injector.js yang memutuskan apakah ini blokir.
   */
  function reportIfRejected(url, status, data) {
    const error = data && typeof data === 'object' ? data.error : undefined;
    const hasErrorCode = typeof error === 'number' && error !== 0;
    if (status < 400 && !hasErrorCode) return;
    sendToContentScript('api_error', {
      url: String(url).split('?')[0],
      status: status,
      error: hasErrorCode ? error : null
    });
  }

  /**
   * Satu pintu untuk respons XHR maupun fetch pada endpoint yang kita pantau.
   * @param {string} via - 'XHR' atau 'Fetch' (hanya untuk log)
   * @param {number} status - HTTP status
   * @param {object|null} data - body JSON, null bila bukan JSON
   */
  function dispatchApiResponse(via, url, status, data) {
    reportIfRejected(url, status, data);
    // Body dari respons yang ditolak tidak berisi data berguna
    if (status >= 400 || data === null) return;

    if (matchesPattern(url, API_PATTERNS.productDetail)) {
      console.log(`[Shopee Scraper] ${via} Intercepted: Product Detail`, url);
      sendToContentScript('product', data);
    }

    if (matchesPattern(url, API_PATTERNS.reviews)) {
      console.log(`[Shopee Scraper] ${via} Intercepted: Reviews`, url);
      sendToContentScript('reviews', data);
    }

    if (matchesPattern(url, API_PATTERNS.shop)) {
      console.log(`[Shopee Scraper] ${via} Intercepted: Shop Detail`, url);
      sendToContentScript('shop', data);
    }

    // Data pencarian (Terjual/Bulan)
    if (matchesPattern(url, API_PATTERNS.search)) {
      console.log(`[Shopee Scraper] ${via} Intercepted: Search Items`, url);
      sendToContentScript('search_items', data);
    }
  }

  // ========================================
  // Intercept XMLHttpRequest
  // ========================================
  const originalXHROpen = XMLHttpRequest.prototype.open;
  const originalXHRSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...args) {
    // Simpan URL untuk dicek saat response diterima (url bisa berupa objek URL)
    this._interceptedUrl = String(url);
    return originalXHROpen.apply(this, [method, url, ...args]);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener('load', function () {
      try {
        const url = this._interceptedUrl || '';
        if (!isApiUrl(url)) return;

        let data = null;
        try {
          data = JSON.parse(this.responseText);
        } catch (e) {
          // Bukan JSON (mis. halaman HTML penolakan); status HTTP tetap dilaporkan
        }
        dispatchApiResponse('XHR', url, this.status, data);
      } catch (e) {
        // Abaikan error — jangan sampai mengganggu halaman Shopee
      }
    });

    return originalXHRSend.apply(this, args);
  };

  // ========================================
  // Intercept Fetch API
  // ========================================
  const originalFetch = window.fetch;

  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input
      : (input instanceof Request ? input.url
        : (input instanceof URL ? input.href : ''));

    return originalFetch.apply(this, arguments).then(response => {
      // Hanya endpoint yang kita pantau yang di-clone; respons lain dibiarkan apa adanya
      if (isApiUrl(url)) {
        // Clone response agar body tetap bisa dibaca oleh Shopee
        response.clone().json()
          .catch(() => null)
          .then(data => dispatchApiResponse('Fetch', url, response.status, data));
      }

      return response;
    });
  };

  // Tandai bahwa interceptor sudah aktif
  console.log('[Shopee Scraper] Interceptor aktif — menunggu data API...');
  sendToContentScript('interceptor_ready', { status: 'active' });

})();
