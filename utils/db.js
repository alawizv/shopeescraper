/**
 * db.js
 * =====
 * Manajemen database lokal (IndexedDB) untuk Shopee Product Scraper.
 * Menyimpan riwayat multi-produk yang pernah di-scrape.
 *
 * Kompatibel dengan:
 * - Background Service Worker (importScripts)
 * - Popup Window (<script src>)
 * - Content Script (auto-forward ke service worker via chrome.runtime.sendMessage)
 */

var ShopeeDB = (typeof ShopeeDB !== 'undefined' && ShopeeDB) ? ShopeeDB : (function () {
  'use strict';

  const DB_NAME = 'ShopeeScraperDB';
  const DB_VERSION = 1;
  const STORE_NAME = 'history';

  let dbPromise = null;

  /**
   * Cek apakah script berjalan di context halaman web (Content Script)
   */
  function isContentScript() {
    try {
      return typeof window !== 'undefined' &&
             window.location &&
             (window.location.protocol === 'http:' || window.location.protocol === 'https:');
    } catch (e) {
      return false;
    }
  }

  /**
   * Buka koneksi ke IndexedDB (hanya di extension context: background / popup)
   */
  function openDB() {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
      const idb = (typeof window !== 'undefined' && window.indexedDB) ||
                  (typeof self !== 'undefined' && self.indexedDB);

      if (!idb) {
        return reject(new Error('IndexedDB tidak tersedia di environment ini'));
      }

      const req = idb.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('scraped_at', 'scraped_at', { unique: false });
          store.createIndex('name', 'name', { unique: false });
          store.createIndex('shop_name', 'shop_name', { unique: false });
        }
      };

      req.onsuccess = (e) => {
        const db = e.target.result;
        db.onclose = () => { dbPromise = null; };
        resolve(db);
      };

      req.onerror = (e) => {
        dbPromise = null;
        reject(req.error || new Error('Gagal membuka IndexedDB'));
      };
    });

    return dbPromise;
  }

  // ── Native IndexedDB Operations ──

  async function directSave(record) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(record);

      req.onsuccess = () => resolve(record);
      req.onerror = () => reject(req.error);
    });
  }

  async function directGetAll() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();

      req.onsuccess = () => {
        const list = req.result || [];
        list.sort((a, b) => new Date(b.scraped_at || 0) - new Date(a.scraped_at || 0));
        resolve(list);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async function directGet(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(String(id));

      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function directDelete(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(String(id));

      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }

  async function directClear() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.clear();

      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }

  // ── Bridge via chrome.runtime.sendMessage untuk Content Script ──

  function sendToBackground(action, payload = {}) {
    return new Promise((resolve, reject) => {
      if (!chrome.runtime || !chrome.runtime.sendMessage) {
        return reject(new Error('chrome.runtime.sendMessage tidak tersedia'));
      }
      try {
        chrome.runtime.sendMessage({ action, ...payload }, (resp) => {
          if (chrome.runtime.lastError) {
            return reject(new Error(chrome.runtime.lastError.message));
          }
          if (resp && resp.error) {
            return reject(new Error(resp.error));
          }
          resolve(resp ? resp.data : null);
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  return {
    async saveProduct(output) {
      if (!output || !output.product?.name) return null;

      const itemId = output.product?.item_id ||
                     output.url?.match(/-i\.(\d+)\.(\d+)/)?.[2] ||
                     output.url?.match(/\/product\/(\d+)\/(\d+)/)?.[2] ||
                     String(Date.now());

      const shopId = output.product?.shop_id ||
                     output.shop?.shop_id ||
                     output.url?.match(/-i\.(\d+)\.(\d+)/)?.[1] ||
                     output.url?.match(/\/product\/(\d+)\/(\d+)/)?.[1] ||
                     null;

      const record = {
        id: String(itemId),
        itemid: String(itemId),
        shopid: shopId ? String(shopId) : null,
        name: output.product.name,
        price_min: output.product.price_min || 0,
        price_max: output.product.price_max || 0,
        rating: output.product.rating || 0,
        total_sold: output.product.total_sold || 0,
        monthly_sold: output.monthly_sold?.value || 0,
        monthly_sold_source: output.monthly_sold?.source || '-',
        omset_quick: output.omset?.quick_value || 0,
        omset_detail: output.omset?.detail_value || 0,
        sold_per_month_source: output.omset?.sold_per_month_source || '-',
        shop_name: output.shop?.name || '-',
        shop_location: output.shop?.location || '-',
        url: output.url || '',
        scraped_at: output.scraped_at || new Date().toISOString(),
        variants_count: (output.variants || []).length,
        output: {
          ...output,
          filtered_reviews: (output.filtered_reviews || []).slice(0, 20),
          negative_reviews: (output.negative_reviews || []).slice(0, 20)
        }
      };

      if (isContentScript()) {
        return sendToBackground('DB_SAVE_PRODUCT', { record });
      } else {
        return directSave(record);
      }
    },

    /**
     * Simpan batch produk dari hasil pencarian (Bulk Scraper)
     */
    async saveBulkProducts(products) {
      if (!Array.isArray(products) || products.length === 0) return 0;
      let count = 0;
      for (const p of products) {
        if (!p || !p.name) continue;
        const record = {
          id: String(p.itemid),
          itemid: String(p.itemid),
          shopid: p.shopid ? String(p.shopid) : null,
          name: p.name,
          price_min: p.price_min || 0,
          price_max: p.price_max || 0,
          rating: p.rating || 0,
          total_sold: p.total_sold || 0,
          monthly_sold: p.monthly_sold || 0,
          monthly_sold_source: 'SEARCH_API',
          omset_quick: p.estimated_omset || 0,
          omset_detail: p.estimated_omset || 0,
          sold_per_month_source: 'SEARCH_API',
          shop_name: p.shop_name || '-',
          shop_location: p.shop_location || '-',
          url: p.url || '',
          scraped_at: new Date().toISOString(),
          variants_count: 0
        };
        try {
          if (isContentScript()) {
            await sendToBackground('DB_SAVE_PRODUCT', { record });
          } else {
            await directSave(record);
          }
          count++;
        } catch (e) {}
      }
      return count;
    },

    async getAll() {
      if (isContentScript()) {
        return (await sendToBackground('DB_GET_ALL')) || [];
      } else {
        return directGetAll();
      }
    },

    async get(id) {
      if (isContentScript()) {
        return sendToBackground('DB_GET_ONE', { id });
      } else {
        return directGet(id);
      }
    },

    async delete(id) {
      if (isContentScript()) {
        return sendToBackground('DB_DELETE', { id });
      } else {
        return directDelete(id);
      }
    },

    async clear() {
      if (isContentScript()) {
        return sendToBackground('DB_CLEAR');
      } else {
        return directClear();
      }
    },

    buildBulkTSV(records) {
      const T = '\t';
      const N = '\n';
      const esc = (v) => String(v ?? '').replace(/\t/g, ' ').replace(/\n/g, ' ');

      let tsv = '';
      tsv += 'No' + T +
             'Nama Produk' + T +
             'Harga Min' + T +
             'Harga Max' + T +
             'Rating' + T +
             'Total Terjual' + T +
             'Terjual / Bulan' + T +
             'Omset Quick' + T +
             'Omset Detail' + T +
             'Toko' + T +
             'Lokasi' + T +
             'URL Produk' + T +
             'Waktu Scraping' + N;

      (records || []).forEach((r, idx) => {
        tsv += (idx + 1) + T +
               esc(r.name) + T +
               (r.price_min || 0) + T +
               (r.price_max || 0) + T +
               (r.rating || 0) + T +
               (r.total_sold || 0) + T +
               (r.monthly_sold || 0) + T +
               (r.omset_quick || 0) + T +
               (r.omset_detail || 0) + T +
               esc(r.shop_name) + T +
               esc(r.shop_location) + T +
               esc(r.url) + T +
               esc(r.scraped_at) + N;
      });

      return tsv;
    },

    buildBulkCSV(records) {
      const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

      let csv = 'No,Nama Produk,Harga Min,Harga Max,Rating,Total Terjual,Terjual / Bulan,Omset Quick,Omset Detail,Toko,Lokasi,URL Produk,Waktu Scraping\n';

      (records || []).forEach((r, idx) => {
        csv += `${idx + 1},${esc(r.name)},${r.price_min || 0},${r.price_max || 0},${r.rating || 0},${r.total_sold || 0},${r.monthly_sold || 0},${r.omset_quick || 0},${r.omset_detail || 0},${esc(r.shop_name)},${esc(r.shop_location)},${esc(r.url)},${esc(r.scraped_at)}\n`;
      });

      return '\uFEFF' + csv;
    },

    _direct: {
      save: directSave,
      getAll: directGetAll,
      get: directGet,
      delete: directDelete,
      clear: directClear
    }
  };
})();

if (typeof module !== 'undefined') {
  module.exports = ShopeeDB;
}
