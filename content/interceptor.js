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
  // Intercept XMLHttpRequest
  // ========================================
  const originalXHROpen = XMLHttpRequest.prototype.open;
  const originalXHRSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...args) {
    // Simpan URL untuk dicek saat response diterima
    this._interceptedUrl = url;
    return originalXHROpen.apply(this, [method, url, ...args]);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener('load', function () {
      try {
        const url = this._interceptedUrl || '';

        // Cek apakah response ini adalah data produk
        if (matchesPattern(url, API_PATTERNS.productDetail)) {
          const responseData = JSON.parse(this.responseText);
          console.log('[Shopee Scraper] XHR Intercepted: Product Detail', url);
          sendToContentScript('product', responseData);
        }

        // Cek apakah response ini adalah data review
        if (matchesPattern(url, API_PATTERNS.reviews)) {
          const responseData = JSON.parse(this.responseText);
          console.log('[Shopee Scraper] XHR Intercepted: Reviews', url);
          sendToContentScript('reviews', responseData);
        }

        // Cek apakah response ini adalah data toko
        if (matchesPattern(url, API_PATTERNS.shop)) {
          const responseData = JSON.parse(this.responseText);
          console.log('[Shopee Scraper] XHR Intercepted: Shop Detail', url);
          sendToContentScript('shop', responseData);
        }

        // Cek apakah response ini adalah data pencarian (Terjual/Bulan)
        if (matchesPattern(url, API_PATTERNS.search)) {
          const responseData = JSON.parse(this.responseText);
          console.log('[Shopee Scraper] XHR Intercepted: Search Items', url);
          sendToContentScript('search_items', responseData);
        }
      } catch (e) {
        // Abaikan error parsing — bukan response JSON
      }
    });

    return originalXHRSend.apply(this, args);
  };

  // ========================================
  // Intercept Fetch API
  // ========================================
  const originalFetch = window.fetch;

  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input instanceof Request ? input.url : '');

    return originalFetch.apply(this, arguments).then(response => {
      // Clone response agar body tetap bisa dibaca oleh Shopee
      const clonedResponse = response.clone();

      // Cek apakah URL cocok dengan pattern produk
      if (matchesPattern(url, API_PATTERNS.productDetail)) {
        clonedResponse.json().then(data => {
          console.log('[Shopee Scraper] Fetch Intercepted: Product Detail', url);
          sendToContentScript('product', data);
        }).catch(() => { });
      }

      // Cek apakah URL cocok dengan pattern review
      if (matchesPattern(url, API_PATTERNS.reviews)) {
        clonedResponse.json().then(data => {
          console.log('[Shopee Scraper] Fetch Intercepted: Reviews', url);
          sendToContentScript('reviews', data);
        }).catch(() => { });
      }

      // Cek apakah URL cocok dengan pattern toko
      if (matchesPattern(url, API_PATTERNS.shop)) {
        clonedResponse.json().then(data => {
          console.log('[Shopee Scraper] Fetch Intercepted: Shop Detail', url);
          sendToContentScript('shop', data);
        }).catch(() => { });
      }

      // Cek apakah URL cocok dengan pattern pencarian (Terjual/Bulan)
      if (matchesPattern(url, API_PATTERNS.search)) {
        clonedResponse.json().then(data => {
          console.log('[Shopee Scraper] Fetch Intercepted: Search Items', url);
          sendToContentScript('search_items', data);
        }).catch(() => { });
      }

      return response;
    });
  };

  // Tandai bahwa interceptor sudah aktif
  console.log('[Shopee Scraper] Interceptor aktif — menunggu data API...');
  sendToContentScript('interceptor_ready', { status: 'active' });

})();
