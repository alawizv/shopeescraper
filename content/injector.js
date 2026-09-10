/**
 * injector.js
 * ============
 * Content script yang berjalan di konteks content script Chrome.
 * Fungsinya:
 * 1. Inject interceptor.js ke page context
 * 2. Terima data dari interceptor via postMessage
 * 3. Simpan data dan kirim ke popup/background via chrome.runtime
 * 4. Fallback ke DOM scraping jika intercept gagal
 */

(function () {
  'use strict';

  // ========================================
  // 0. Guard anti double-inject
  // ========================================
  // popup.js dapat menyuntik ulang file ini via chrome.scripting.executeScript.
  // Tanpa penjaga ini, listener onMessage, MutationObserver, dan interval SPA
  // akan terdaftar dua kali dan saling menimpa state review.
  if (window.__SHOPEE_SCRAPER_INJECTOR_READY__) {
    console.log('[Shopee Scraper] Injector sudah aktif di tab ini, inject ulang diabaikan.');
    return;
  }
  window.__SHOPEE_SCRAPER_INJECTOR_READY__ = true;

  // ========================================
  // State untuk menyimpan data yang ter-intercept
  // ========================================
  let interceptedData = {
    product: null,
    reviews: [],
    shop: null,
    interceptorReady: false,
    dataSource: 'none',     // 'api' atau 'dom'
    fetchStatus: null
  };

  // Cache: item_id -> { sold_per_month, sold_total } dari search API
  const monthlySoldCache = {};

  // Timer untuk fallback ke DOM scraping
  let fallbackTimer = null;
  const FALLBACK_TIMEOUT = 8000; // 8 detik tunggu API, lalu fallback

  // ========================================
  // 1. Inject interceptor.js ke page context
  // ========================================
  function injectInterceptor() {
    try {
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('content/interceptor.js');
      script.onload = function () {
        // Hapus tag script setelah di-load (bersih-bersih)
        this.remove();
      };
      (document.head || document.documentElement).appendChild(script);
      console.log('[Shopee Scraper] Interceptor berhasil di-inject');
    } catch (e) {
      console.error('[Shopee Scraper] Gagal inject interceptor:', e);
      // Langsung fallback ke DOM jika inject gagal
      startDOMScraping();
    }
  }

  // ========================================
  // 2. Listener untuk data dari interceptor
  // ========================================
  window.addEventListener('message', function (event) {
    // Hanya terima pesan dari interceptor kita
    if (event.source !== window) return;
    if (!event.data || event.data.source !== 'SHOPEE_SCRAPER_INTERCEPTOR') return;

    const { type, data } = event.data;

    switch (type) {
      case 'interceptor_ready':
        interceptedData.interceptorReady = true;
        console.log('[Shopee Scraper] Interceptor siap');
        // Set timer fallback — jika dalam 8 detik tidak ada data API, fallback DOM
        startFallbackTimer();
        break;

      case 'product':
        console.log('[Shopee Scraper] Data produk diterima dari API');
        interceptedData.product = data;
        interceptedData.dataSource = 'api';
        clearFallbackTimer();
        // Simpan ke storage langsung agar panel/popup tidak menunggu auto-fetch review.
        // autoFetchReviews() bisa return lebih awal (bukan PDP, ID gagal diekstrak,
        // review sudah ada), jadi penyimpanan tidak boleh bergantung padanya.
        saveDataToStorage();
        // Setelah 5 detik, auto-fetch review via direct API (tanpa pagination/scroll)
        setTimeout(() => autoFetchReviews(), 5000);

        // Auto-fetch shop detail dinonaktifkan agar bisa di-trigger via tombol manual "Muat Info Terjual & Toko"
        break;

      case 'reviews':
        console.log('[Shopee Scraper] Data review diterima dari API');
        interceptedData.reviews.push(data);
        // Simpan ke storage (update)
        saveDataToStorage();
        break;

      case 'shop':
        console.log('[Shopee Scraper] Data toko diterima dari API');
        interceptedData.shop = data;
        saveDataToStorage();
        break;
      
      case 'search_items':
        // Ekstrak data "Terjual/Bulan" dari hasil pencarian Shopee
        extractMonthlySoldFromSearch(data);
        processBulkSearchItems(data);
        break;
    }
  });

  // ========================================
  // 3. Fallback timer management
  // ========================================
  function startFallbackTimer() {
    clearFallbackTimer();
    fallbackTimer = setTimeout(() => {
      if (!interceptedData.product) {
        console.log('[Shopee Scraper] API timeout, fallback ke DOM scraping');
        startDOMScraping();
      }
    }, FALLBACK_TIMEOUT);
  }

  function clearFallbackTimer() {
    if (fallbackTimer) {
      clearTimeout(fallbackTimer);
      fallbackTimer = null;
    }
  }

  // ========================================
  // 4. DOM Scraping (Fallback)
  // ========================================
  function startDOMScraping() {
    console.log('[Shopee Scraper] Memulai DOM scraping...');
    interceptedData.dataSource = 'dom';

    // Gunakan MutationObserver untuk menunggu konten ter-render
    const observer = new MutationObserver((mutations, obs) => {
      const scrapedData = scrapeFromDOM();
      if (scrapedData) {
        obs.disconnect();
        interceptedData.product = scrapedData;
        saveDataToStorage();
      }
    });

    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true
    });

    // Coba scrape langsung juga (mungkin sudah ter-render)
    setTimeout(() => {
      const scrapedData = scrapeFromDOM();
      if (scrapedData) {
        observer.disconnect();
        interceptedData.product = scrapedData;
        saveDataToStorage();
      }
    }, 1000);

    // Timeout final — stop observer setelah 4 detik (jangan terlalu lama)
    setTimeout(() => {
      observer.disconnect();
      // Scrape last attempt
      if (!interceptedData.product) {
         const finalData = scrapeFromDOM();
         if (finalData) {
            interceptedData.product = finalData;
            saveDataToStorage();
         }
      }
    }, 4000);
  }

  /**
   * Enhance data API dengan data DOM — merge field yang kosong/nol
   */
  function enhanceWithDOM() {
    if (!interceptedData.product) return;
    
    console.log('[Shopee Scraper] Mencoba enhance data API dengan DOM...');
    const domData = scrapeFromDOM();
    if (!domData || !domData.data) {
      console.log('[Shopee Scraper] DOM data tidak tersedia, skip enhance');
      return;
    }

    const apiItem = interceptedData.product?.data?.item ||
                    interceptedData.product?.data ||
                    interceptedData.product?.item ||
                    interceptedData.product;
                    
    // Jika domData berasal dari __NEXT_DATA__, formatnya beda sedikit (bukan format DOM manual kita)
    const isFromApiDOM = domData._source === 'api_from_dom';
    const domItem = isFromApiDOM ? (domData.data.item || domData.data) : domData.data;
    let enhanced = false;

    // Merge total_sold jika API = 0
    const domSoldInfo = domItem.historical_sold || domItem.sold || domItem.item_sold || 0;
    if ((!apiItem.historical_sold && !apiItem.sold && !apiItem.item_sold) && domSoldInfo > 0) {
      apiItem.historical_sold = domSoldInfo;
      enhanced = true;
      console.log('[Shopee Scraper] Enhance: total_sold dari DOM/NEXT_DATA =', domSoldInfo);
    }

    // Merge review_count jika API = 0 
    const apiRating = apiItem.item_rating || apiItem.rating || {};
    const apiReviewCount = Array.isArray(apiRating.rating_count) ? apiRating.rating_count[0] : (apiRating.rating_count || 0);
    
    const domRating = domItem.item_rating || domItem.rating || {};
    const domReviewCount = Array.isArray(domRating.rating_count) ? domRating.rating_count[0] : (domRating.rating_count || 0);

    if (apiReviewCount === 0 && domReviewCount > 0) {
      if (!apiItem.item_rating) apiItem.item_rating = {};
      apiItem.item_rating.rating_count = domRating.rating_count;
      enhanced = true;
      console.log('[Shopee Scraper] Enhance: review_count dari DOM/NEXT_DATA =', domReviewCount);
    }

    // Merge rating jika API = 0
    const apiRatingStar = apiRating.rating_star || 0;
    const domRatingStar = domRating.rating_star || 0;
    if (apiRatingStar === 0 && domRatingStar > 0) {
      if (!apiItem.item_rating) apiItem.item_rating = {};
      apiItem.item_rating.rating_star = domRatingStar;
      enhanced = true;
    }

    // Merge sold_per_month_actual
    const domMonthlySold = domItem.sold_per_month_actual || 0;
    if (domMonthlySold > 0) {
      apiItem.sold_per_month_actual = domMonthlySold;
      enhanced = true;
      console.log('[Shopee Scraper] Enhance: sold_per_month_actual dari DOM =', domMonthlySold);
    }

    // Merge tier_variations jika API kosong tapi DOM punya
    const apiTiers = apiItem.tier_variations || [];
    const domTiers = domItem.tier_variations || [];
    if (apiTiers.length === 0 && domTiers.length > 0) {
      apiItem.tier_variations = domTiers;
      enhanced = true;
      console.log('[Shopee Scraper] Enhance: varian dari DOM, tiers =', domTiers.length);
    }

    if (enhanced) {
      interceptedData.dataSource = 'api+dom';
      console.log('[Shopee Scraper] Data enhanced! Source: api+dom');
    }
    
    // SELALU panggil saveDataToStorage() di akhir fungsi untuk menjamin 
    // event storage onChanged memicu panel.js refresh dan menghilangkan status 'loading...'
    saveDataToStorage();
  }

  /**
   * Scrape data produk dari DOM halaman Shopee
   * @returns {object|null} Data produk atau null jika gagal
   */
  function scrapeFromDOM() {
    try {
      // Variabel penyimpan jika __NEXT_DATA__ ditemukan
      let apiFromDomItem = null;

      // === TAHAP 1: EKSTRAKSI __NEXT_DATA__ (SANGAT AKURAT TAPI KADANG DISENSOR) ===
      const nextDataScript = document.getElementById('__NEXT_DATA__');
      if (nextDataScript) {
        try {
           const nextData = JSON.parse(nextDataScript.textContent);
           let foundItem = null;
           const searchForItem = (obj) => {
             if (!obj || typeof obj !== 'object' || foundItem) return;
             if (obj.itemid && obj.shopid && obj.models) {
                foundItem = obj;
                return;
             }
             if (obj.item && obj.item.itemid) {
                foundItem = obj.item;
                return;
             }
             // Lanjutkan pencarian secara rekursif
             for (const key of Object.keys(obj)) {
               searchForItem(obj[key]);
             }
           };
           searchForItem(nextData);

           if (foundItem) {
               console.log('%c[Shopee Scraper] Jackpot! Data item dari __NEXT_DATA__!', 'background: green; color: white; font-size: 14px;');
               console.log('[Shopee Scraper] item keys:', Object.keys(foundItem).join(', '));
               if (foundItem.models && Array.isArray(foundItem.models) && foundItem.models.length > 0) {
                   console.log('[Shopee Scraper] models[0] keys:', Object.keys(foundItem.models[0]).join(', '));
                   console.log('[Shopee Scraper] models[0] sold data:', JSON.stringify({
                       sold: foundItem.models[0].sold,
                       historical_sold: foundItem.models[0].historical_sold,
                       item_sold: foundItem.models[0].item_sold,
                       stock: foundItem.models[0].stock,
                       normal_stock: foundItem.models[0].normal_stock,
                       price: foundItem.models[0].price,
                       name: foundItem.models[0].name
                   }));
               } else {
                   console.warn('[Shopee Scraper] __NEXT_DATA__ item TIDAK punya models[]!');
               }
               apiFromDomItem = foundItem;
            }
        } catch(e) {
           console.warn('[Shopee Scraper] Gagal parse __NEXT_DATA__ untuk item utama:', e);
        }
      }

      // === TAHAP 2: Cek LD-JSON ===
      const ldJsons = document.querySelectorAll('script[type="application/ld+json"]');
      let ldProduct = null;
      for (const script of ldJsons) {
        try {
          const data = JSON.parse(script.textContent);
          if (data['@type'] === 'Product') {
            ldProduct = data;
            break;
          }
        } catch(e) {}
      }

      // === Nama produk ===
      const nameSelectors = [
        'div[class*="product-briefing"] span[class*="title"]',
        'div[class*="pdp-name"] h1',
        'h1[class*="product-name"]',
        'div._44qnta span',
        'section[class*="page-product"] h1',
        'div[data-sqe="name"] h1',
        'div[class*="flex-auto"] span[class*="VCNkp"]', // title di sebelah harga
        '.product-briefing span'
      ];

      let productName = ldProduct && ldProduct.name ? ldProduct.name : null;
      if (!productName) {
        for (const sel of nameSelectors) {
          const el = document.querySelector(sel);
          if (el && el.textContent.trim()) {
            productName = el.textContent.trim();
            break;
          }
        }
      }

      // Fallback nama ke title dokumen jika selector HTML murni gagal
      if (!productName) {
         productName = document.title.replace(' | Shopee Indonesia', '').trim();
      }

      // Jika nama produk tidak ditemukan sama sekali (sangat jarang jika title ada)
      if (!productName || productName === 'Shopee Indonesia') return null;

      // === Harga ===
      const priceSelectors = [
        'div[class*="product-briefing"] div[class*="price"]',
        'div[class*="pdp-price"]',
        'div[class*="pqTWkA"]',
        'section[class*="product-price"]',
        'div[class*="flex-auto"] div[class*="price"]',
        '.G27A-C', 
        '.pmOPn',
        'div[aria-live="polite"]',
        'div.flex.items-center span.text-orange-500' 
      ];

      let priceText = '';
      for (const sel of priceSelectors) {
        const el = document.querySelector(sel);
        if (el && el.textContent.trim()) {
          priceText = el.textContent.trim();
          break;
        }
      }

      const prices = extractPrices(priceText);
      if (prices.min === 0 && ldProduct && ldProduct.offers) {
          prices.min = parseInt(ldProduct.offers.lowPrice || ldProduct.offers.price || 0, 10);
          prices.max = parseInt(ldProduct.offers.highPrice || ldProduct.offers.price || 0, 10);
      }

      // === Rating ===
      const ratingSelectors = [
        'div[class*="product-briefing"] div[class*="rating"]',
        'div[class*="pdp-review"] div[class*="rating"]',
        'div[class*="shopee-rating-stars"]',
        'div._46GsLO'
      ];

      let rating = ldProduct && ldProduct.aggregateRating && ldProduct.aggregateRating.ratingValue ? parseFloat(ldProduct.aggregateRating.ratingValue) : 0;
      if (rating === 0) {
        for (const sel of ratingSelectors) {
          const el = document.querySelector(sel);
          if (el) {
            const text = el.textContent.trim();
            const num = parseFloat(text);
            if (!isNaN(num) && num > 0 && num <= 5) {
              rating = num;
              break;
            }
          }
        }
      }

      // Teks yang dipakai untuk pencarian regex.
      // Dibatasi ke area info produk agar tidak menangkap angka dari daftar
      // produk rekomendasi / "Produk Serupa" di bagian bawah halaman.
      const scopeText = getProductScopeText();

      // === Total terjual ===
      const soldSelectors = [
        'div[class*="product-briefing"] span[class*="sold"]',
        'div[class*="pdp-quantity"] span',
        'span[class*="sold"]',
        'div._22sp0A'
      ];

      let totalSold = 0;
      for (const sel of soldSelectors) {
        const el = document.querySelector(sel);
        if (el) {
          totalSold = extractNumber(el.textContent);
          if (totalSold > 0) break;
        }
      }

      if (totalSold === 0) {
        // Penyesuaian regex untuk tipe "10RB+ Terjual", "10 RB Terjual"
        const soldMatch = scopeText.match(/(\d[\d.,]*)\s*(RB|rb|K|k|Ribu|ribu)?\s*\+?\s*[Tt]erjual/);
        if (soldMatch) {
          totalSold = extractNumber(soldMatch[0]);
        }
      }

      // === Jumlah review ===
      let reviewCount = ldProduct && ldProduct.aggregateRating && ldProduct.aggregateRating.reviewCount ? parseInt(ldProduct.aggregateRating.reviewCount, 10) : 0;
      if (reviewCount === 0) {
        const reviewSelectors = [
          'div[class*="pdp-review-count"]',
          'a[class*="rating-count"]',
          'div[class*="OitLRu"]',
        ];

        for (const sel of reviewSelectors) {
          const el = document.querySelector(sel);
          if (el) {
            const num = extractNumber(el.textContent);
            if (num > 5) { // >5 agar tidak menangkap rating bintang (1-5)
              reviewCount = num;
              break;
            }
          }
        }
      }

      // Fallback: cari teks "XX Penilaian" atau "XX Ulasan" di area produk
      if (reviewCount === 0) {
        // Tangkap misalnya "20RB Penilaian" atau "1K+ Penilaian"
        const reviewMatch = scopeText.match(/(\d[\d.,]*)\s*(RB|rb|K|k|Ribu|ribu)?\s*\+?\s*[Pp]enilaian/);
        if (reviewMatch) {
          reviewCount = extractNumber(reviewMatch[0]);
        }
        if (reviewCount === 0) {
          const ulasanMatch = scopeText.match(/(\d[\d.,]*)\s*(RB|rb|K|k|Ribu|ribu)?\s*\+?\s*[Uu]lasan/);
          if (ulasanMatch) {
            reviewCount = extractNumber(ulasanMatch[0]);
          }
        }
      }

      // === Terjual bulanan (data riil Shopee) ===
      const monthlySoldSelectors = [
        'div[class*="product-briefing"] span[class*="monthly-sold"]',
        'div[class*="pdp-quantity"] span[class*="monthly"]',
        'div[class*="v-center"] span:contains("Terjual / Bulan")',
        'div.flex.items-center span.text-sm.leading-4' // Seringkali di sini dampingan dengan rating
      ];

      let soldPerMonth = 0;
      // Cari teks "X Terjual / Bulan" di area produk jika selector spesifik gagal
      const monthlyMatch = scopeText.match(/(\d[\d.,]*)\s*(RB|rb|K|k|Ribu|ribu)?\s*\+?\s*[Tt]erjual\s*\/\s*[Bb]ulan/);
      if (monthlyMatch) {
         soldPerMonth = extractNumber(monthlyMatch[0]);
      }

      // === Bangun data DOM format mirip API ===
      const domData = {
        _source: 'dom',
        data: {
          name: productName,
          price_min: prices.min * 100000,
          price_max: prices.max * 100000,
          item_rating: {
            rating_star: rating,
            rating_count: [reviewCount, 0, 0, 0, 0, 0]
          },
          historical_sold: totalSold,
          sold_per_month_actual: soldPerMonth,
          tier_variations: [],
          models: []
        }
      };

      // === Coba ambil data varian dari DOM ===
      const variantData = scrapeVariantsFromDOM();
      if (variantData.tiers.length > 0) {
        domData.data.tier_variations = variantData.tiers;
      }

      console.log('[Shopee Scraper] DOM scraping berhasil:', domData);
      
      // Jika kita juga punya data dari __NEXT_DATA__, gunakan format tersebut tapi MENGKOPY hasil regex layar
      if (apiFromDomItem) {
        console.log('[Shopee Scraper] Merge data dari Regex layar ke __NEXT_DATA__ object...');
        if (totalSold > 0) {
           apiFromDomItem.historical_sold = totalSold;
           if (apiFromDomItem.item_base) apiFromDomItem.item_base.historical_sold = totalSold;
           // juga menimpa ke domData sebagai fallback ganda
           domData.data.historical_sold = totalSold;
        }
        if (reviewCount > 0) {
           if (!apiFromDomItem.item_rating) apiFromDomItem.item_rating = {};
           apiFromDomItem.item_rating.rating_count = [reviewCount, 0, 0, 0, 0, 0];
           
           if (!domData.data.item_rating) domData.data.item_rating = {};
           domData.data.item_rating.rating_count = [reviewCount, 0, 0, 0, 0, 0];
        }
        
        return {
           _source: 'api_from_dom',
           data: { item: apiFromDomItem }
        };
      }

      // Beritahu parser bahwa ini dari DOM manual rutin
      domData._source = 'dom';
      
      return domData;

    } catch (e) {
      console.error('[Shopee Scraper] DOM scraping error:', e);
      return null;
    }
  }

  /**
   * Ekstrak varian produk dari DOM - Multi-layer approach
   */
  function scrapeVariantsFromDOM() {
    const tiers = [];

    try {
      // === Layer 1: Coba baca dari __NEXT_DATA__ (Shopee Next.js) ===
      const nextDataScript = document.getElementById('__NEXT_DATA__');
      if (nextDataScript) {
        try {
          const nextData = JSON.parse(nextDataScript.textContent);
          // Traverse tree untuk cari tier_variations
          const searchForVariants = (obj) => {
            if (!obj || typeof obj !== 'object') return null;
            if (obj.tier_variations && Array.isArray(obj.tier_variations) && obj.tier_variations.length > 0) {
              return obj.tier_variations;
            }
            for (const key of Object.keys(obj)) {
              const found = searchForVariants(obj[key]);
              if (found) return found;
            }
            return null;
          };
          const found = searchForVariants(nextData);
          if (found) {
            found.forEach(tier => {
              const opts = tier.options || tier.option_list?.map(o => o.option) || [];
              if (opts.length > 0) {
                tiers.push({ name: tier.name || 'Varian', options: opts });
              }
            });
            if (tiers.length > 0) return { tiers, models: [] };
          }
        } catch (e) { /* Abaikan */ }
      }

      // === Layer 2: Multi CSS selector untuk Shopee layout ===
      const containerSelectors = [
        'div[class*="product-variation"]',
        'div[class*="variation-group"]',
        'section[class*="variation"]',
        'div[class*="Variation"]',
        // Shopee attribute-based
        'div[data-sqe="variation"]',
        'div[data-sqe="sku"]',
        // Blok yang memiliki label lalu tombol
        'div[class*="sku-selector"]',
        'div[class*="sku-prop"]',
      ];

      let variantContainers = null;
      for (const sel of containerSelectors) {
        const found = document.querySelectorAll(sel);
        if (found && found.length > 0) {
          variantContainers = found;
          break;
        }
      }

      if (variantContainers && variantContainers.length > 0) {
        variantContainers.forEach((container, index) => {
          // Cari label nama varian
          const labelSelectors = [
            'label', '[class*="title"]', '[class*="header"]',
            '[class*="label"]', 'p', 'span:first-child', 'div:first-child'
          ];

          let labelText = `Varian ${index + 1}`;
          for (const sel of labelSelectors) {
            const el = container.querySelector(sel);
            if (el && el.textContent.trim() && el.textContent.trim().length < 80) {
              const candidate = el.textContent.trim().replace(/[:：]/g, '');
              if (candidate) { labelText = candidate; break; }
            }
          }

          // Cari option buttons
          const optionSelectors = [
            'button', 'div[class*="option"]', 'div[class*="item"]',
            'span[class*="option"]', 'div[class*="btn"]', '[role="button"]'
          ];
          let buttonsFound = [];
          for (const sel of optionSelectors) {
            const found = Array.from(container.querySelectorAll(sel));
            if (found.length > 0) { buttonsFound = found; break; }
          }

          const options = [];
          buttonsFound.forEach(btn => {
            const text = btn.textContent.trim();
            if (text && text.length < 60 && text !== labelText && !text.includes('\n')) {
              options.push(text);
            }
          });

          if (options.length > 0) {
            tiers.push({ name: labelText, options });
          }
        });

        if (tiers.length > 0) return { tiers, models: [] };
      }

      // === Layer 3: Text-based parsing — cari pola "LABEL: opsi1 opsi2 ..." ===
      // Keyword yang umum dipakai Shopee untuk label varian
      const variantKeywords = [
        'WARNA', 'Warna', 'COLOR', 'Color',
        'VARIAN', 'Varian', 'VARIANT',
        'UKURAN', 'Ukuran', 'SIZE', 'Size',
        'KAPASITAS', 'Kapasitas', 'STORAGE', 'Storage', 'RAM',
        'TIPE', 'Tipe', 'TYPE', 'Type',
        'MODEL', 'Model',
      ];

      // Cari elemen yang textContent-nya adalah salah satu keyword di atas
      const allSpans = document.querySelectorAll('span, p, label, div');
      for (const el of allSpans) {
        if (el.children.length > 0) continue; // Skip elemen dengan anak
        const text = el.textContent.trim().replace(/[:：]$/, '');
        if (!variantKeywords.includes(text)) continue;

        // Temukan parent/sibling yang berisi option buttons
        let parent = el.parentElement;
        for (let depth = 0; depth < 4 && parent; depth++) {
          const buttons = parent.querySelectorAll('button, [role="button"]');
          const opts = Array.from(buttons)
            .map(b => b.textContent.trim())
            .filter(t => t.length > 0 && t.length < 60 && !variantKeywords.includes(t));

          if (opts.length > 0) {
            // Cek belum ada tier dengan nama ini
            if (!tiers.find(t => t.name === text)) {
              tiers.push({ name: text, options: opts });
            }
            break;
          }
          parent = parent.parentElement;
        }
      }

    } catch (e) {
      console.warn('[Shopee Scraper] Gagal scrape varian dari DOM:', e);
    }

    return { tiers, models: [] };

  }

  /**
   * Ambil teks dari area info produk saja (bukan seluruh body).
   * Bagian bawah PDP Shopee berisi "Produk Serupa" / rekomendasi yang juga
   * memuat teks "Terjual" dan "Penilaian", sehingga regex atas seluruh body
   * bisa mengambil angka milik produk lain.
   */
  function getProductScopeText() {
    const scopeSelectors = [
      'div[class*="product-briefing"]',
      'section[class*="page-product"] > div:first-child',
      'div[class*="pdp-main"]',
      'div[class*="product-detail"]'
    ];

    let scoped = '';
    for (const sel of scopeSelectors) {
      const el = document.querySelector(sel);
      const text = el && (el.innerText || el.textContent || '').trim();
      if (text) { scoped = text; break; }
    }

    // Teks body dipotong pada penanda section rekomendasi
    const bodyText = (document.body && document.body.innerText) || '';
    const cutMarkers = ['Produk Serupa', 'Produk Terkait', 'Anda Mungkin Juga Suka', 'Produk Lainnya Dari Toko Ini'];
    let cutAt = bodyText.length;
    cutMarkers.forEach(marker => {
      const idx = bodyText.indexOf(marker);
      if (idx > 0 && idx < cutAt) cutAt = idx;
    });
    const trimmedBody = bodyText.slice(0, cutAt);

    // Gabungkan dengan area produk di DEPAN: String.match() mengambil kecocokan
    // pertama, jadi angka milik produk utama menang. Teks body yang sudah
    // dipotong tetap disertakan sebagai cadangan bila area produk tidak memuatnya.
    return scoped ? `${scoped}\n${trimmedBody}` : trimmedBody;
  }

  /**
   * Ekstrak angka harga dari teks
   */
  function extractPrices(text) {
    if (!text) return { min: 0, max: 0 };

    const priceNumbers = text.match(/[\d.]+/g);
    if (!priceNumbers) return { min: 0, max: 0 };

    const prices = priceNumbers.map(p => {
      return parseInt(p.replace(/\./g, ''), 10);
    }).filter(p => p > 0);

    if (prices.length === 0) return { min: 0, max: 0 };

    return {
      min: Math.min(...prices),
      max: Math.max(...prices)
    };
  }

  /**
   * Ekstrak angka dari teks (support format "12RB", "1,5jt", dll.)
   */
  function extractNumber(text) {
    if (!text) return 0;

    const rbMatch = text.match(/([\d.,]+)\s*(RB|rb|K|k)/);
    if (rbMatch) {
      const num = parseFloat(rbMatch[1].replace(',', '.'));
      return Math.round(num * 1000);
    }

    const jtMatch = text.match(/([\d.,]+)\s*(JT|jt|M|m)/);
    if (jtMatch) {
      const num = parseFloat(jtMatch[1].replace(',', '.'));
      return Math.round(num * 1000000);
    }

    const numMatch = text.match(/[\d]+/g);
    if (numMatch) {
      return parseInt(numMatch.join(''), 10);
    }

    return 0;
  }

  // ========================================
  // 4.5 Ekstrak Monthly Sold dari Search API
  // ========================================
  function extractMonthlySoldFromSearch(searchData) {
    try {
      // Shopee search API menyimpan item di beberapa kemungkinan path
      const items = searchData?.data?.items ||
                    searchData?.items ||
                    searchData?.data?.item_brief_list ||
                    [];
      
      if (!Array.isArray(items) || items.length === 0) return;

      let found = 0;
      items.forEach(entry => {
        // Item bisa langsung atau di dalam wrapper {item: {...}}
        const item = entry?.item_basic || entry?.item || entry;
        const itemId = item?.itemid || item?.item_id;
        
        if (!itemId) return;

        // 'sold' di search results adalah penjualan BULANAN (bukan historical_sold)
        const soldMonthly = item?.sold || item?.sold_per_month || 0;
        const soldTotal   = item?.historical_sold || item?.total_sold || 0;
        
        if (soldMonthly > 0) {
          monthlySoldCache[itemId] = {
            sold_per_month: soldMonthly,
            sold_total: soldTotal,
            name: item?.name || '',
            captured_at: Date.now()
          };
          found++;
        }
      });

      if (found > 0) {
        console.log(`%c[Shopee Scraper] 📊 Search cache diperbarui: ${found} produk punya data Terjual/Bulan`, 'background: green; color: white;');
        // Jika produk yang sedang dibuka ada di cache, langsung simpan ulang
        const currentItem = interceptedData.product?.data?.item ||
                            interceptedData.product?.data ||
                            interceptedData.product?.item ||
                            interceptedData.product;
        const currentId = currentItem?.itemid || currentItem?.item_id;
        if (currentId && monthlySoldCache[currentId]) {
          console.log(`%c[Shopee Scraper] ✅ Produk aktif ditemukan di search cache! Sold/bulan: ${monthlySoldCache[currentId].sold_per_month}`, 'background: green; color: white;');
          saveDataToStorage();
        }
      }
    } catch (e) {
      console.warn('[Shopee Scraper] Gagal ekstrak monthly sold dari search:', e);
    }
  }

  // ========================================
  // 4.6 Olah Seluruh Data Pencarian (Bulk Scraper)
  // ========================================
  const bulkSearchProductsMap = new Map();

  function processBulkSearchItems(searchData) {
    try {
      const rawItems = searchData?.data?.items ||
                       searchData?.items ||
                       searchData?.data?.item_brief_list ||
                       searchData?.data?.sections?.[0]?.data?.item ||
                       [];

      if (!Array.isArray(rawItems) || rawItems.length === 0) return;

      rawItems.forEach(entry => {
        const item = entry?.item_basic || entry?.item || entry;
        const itemId = item?.itemid || item?.item_id;
        if (!itemId || !item.name) return;

        const pmin = item.price_min !== undefined ? Math.round(item.price_min / 100000) : (item.price !== undefined ? Math.round(item.price / 100000) : 0);
        const pmax = item.price_max !== undefined ? Math.round(item.price_max / 100000) : pmin;
        const priceAvg = Math.round((pmin + pmax) / 2);
        const monthlySold = item.sold || item.sold_per_month || 0;
        const totalSold = item.historical_sold || item.total_sold || 0;
        const omset = Math.round(monthlySold * priceAvg);

        const ratingVal = item.item_rating?.rating_star || item.item_rating?.star || item.rating_star || 0;
        const ratingStar = Math.round(ratingVal * 10) / 10;

        const shopId = item.shopid || item.shop_id || null;
        const url = `https://shopee.co.id/product/${shopId || '0'}/${itemId}`;

        const productObj = {
          itemid: String(itemId),
          shopid: shopId ? String(shopId) : null,
          name: item.name,
          price_min: pmin,
          price_max: pmax,
          price_avg: priceAvg,
          rating: ratingStar,
          total_sold: totalSold,
          monthly_sold: monthlySold,
          estimated_omset: omset,
          shop_location: item.shop_location || item.shop_location_clean || item.location || '-',
          shop_name: item.shop_name || '-',
          image: item.image ? `https://down-id.img.susercontent.com/file/${item.image}` : null,
          url: url
        };

        bulkSearchProductsMap.set(String(itemId), productObj);
      });

      const allProducts = Array.from(bulkSearchProductsMap.values());
      if (allProducts.length === 0) return;

      // Hitung metrik pasar
      const totalOmset = allProducts.reduce((acc, cur) => acc + (cur.estimated_omset || 0), 0);
      const totalMonthlySold = allProducts.reduce((acc, cur) => acc + (cur.monthly_sold || 0), 0);
      const prices = allProducts.map(p => p.price_avg).filter(p => p > 0);
      const minPrice = prices.length ? Math.min(...prices) : 0;
      const maxPrice = prices.length ? Math.max(...prices) : 0;
      const avgPrice = prices.length ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : 0;
      const ratings = allProducts.map(p => p.rating).filter(r => r > 0);
      const avgRating = ratings.length ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10 : 0;

      // Ambil keyword dari URL
      let keyword = 'Pencarian Shopee';
      try {
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.has('keyword')) {
          keyword = decodeURIComponent(urlParams.get('keyword'));
        } else {
          const path = window.location.pathname.replace(/^\/|\/$/g, '');
          if (path.startsWith('search')) {
            keyword = 'Pencarian Shopee';
          } else if (path.length > 0) {
            keyword = `Toko: ${path.split('/')[0]}`;
          }
        }
      } catch (e) {}

      const bulkPayload = {
        keyword: keyword,
        url: window.location.href,
        captured_at: new Date().toISOString(),
        total_products: allProducts.length,
        stats: {
          total_omset: totalOmset,
          total_monthly_sold: totalMonthlySold,
          min_price: minPrice,
          max_price: maxPrice,
          avg_price: avgPrice,
          avg_rating: avgRating
        },
        products: allProducts
      };

      chrome.storage.local.set({ shopeeBulkSearchData: bulkPayload }, () => {
        console.log(`%c[Shopee Scraper] 🔍 Bulk data tersimpan (${allProducts.length} produk). Total Omset: Rp ${totalOmset.toLocaleString('id-ID')}`, 'background: #531dab; color: #fff; font-weight: bold;');
      });

    } catch (e) {
      console.warn('[Shopee Scraper] Gagal proses bulk search items:', e);
    }
  }

  // ========================================
  // 5. Simpan data ke chrome.storage
  // ========================================
  function saveDataToStorage() {
    try {
      // Cari apakah produk aktif ada di monthly sold cache
      const currentItem = interceptedData.product?.data?.item ||
                          interceptedData.product?.data ||
                          interceptedData.product?.item ||
                          interceptedData.product;
      const currentId = currentItem?.itemid || currentItem?.item_id;
      const cachedMonthly = (currentId && monthlySoldCache[currentId]) 
        ? monthlySoldCache[currentId].sold_per_month 
        : null;

      const dataToSave = {
        rawProduct: interceptedData.product,
        rawReviews: interceptedData.reviews,
        rawShop: interceptedData.shop,
        dataSource: interceptedData.dataSource,
        fetchStatus: interceptedData.fetchStatus || null,
        monthlySoldFromSearch: cachedMonthly, // Data riil dari search API
        url: window.location.href,
        timestamp: new Date().toISOString()
      };

      const notifyUpdated = (payload) => {
        try {
          chrome.runtime.sendMessage({
            action: 'DATA_UPDATED',
            data: payload
          }).catch(() => {
            // Popup mungkin belum terbuka — abaikan error
          });
        } catch (e) { /* extension context invalidated */ }
      };

      chrome.storage.local.set({ shopeeScraperData: dataToSave }, () => {
        if (chrome.runtime.lastError) {
          const msg = chrome.runtime.lastError.message || '';
          console.warn('[Shopee Scraper] Storage set error:', msg);

          // Kuota terlampaui: simpan ulang tanpa review mentah agar data produk,
          // toko, dan status tetap sampai ke panel/popup (jangan gagal diam-diam).
          if (/quota|QUOTA/i.test(msg)) {
            const trimmed = {
              ...dataToSave,
              rawReviews: [],
              fetchStatus: `${interceptedData.fetchStatus || 'done:0'}`,
              storageTrimmed: true
            };
            chrome.storage.local.set({ shopeeScraperData: trimmed }, () => {
              if (chrome.runtime.lastError) {
                console.error('[Shopee Scraper] Storage tetap gagal setelah dipangkas:', chrome.runtime.lastError.message);
                return;
              }
              console.warn('[Shopee Scraper] ⚠️ Kuota storage penuh — review mentah tidak ikut disimpan.');
              notifyUpdated(trimmed);
            });
          }
          return;
        }
        console.log('[Shopee Scraper] Data disimpan ke storage');

        // Beritahu popup/background bahwa data tersedia
        notifyUpdated(dataToSave);
      });
    } catch (e) {
      console.warn('[Shopee Scraper] Gagal menyimpan data:', e.message);
    }
  }

  // ========================================
  // 5.5 Fetch API Manual (Fallback)
  // ========================================
  async function fetchProductManual() {
    const ids = extractIdsFromURL();
    if (!ids) throw new Error('Tidak bisa mengekstrak ID produk');
    
    // Shopee get_pc endpoint biasa
    const apiUrl = `https://shopee.co.id/api/v4/pdp/get_pc?item_id=${ids.itemId}&shop_id=${ids.shopId}`;
    const response = await fetch(apiUrl, {
      credentials: 'include',
      headers: {
        'Accept': 'application/json',
        'X-Requested-With': 'XMLHttpRequest'
      }
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    
    // Shopee sering memalsukan HTTP 200 walaupun sebenarnya diblokir bot (error 403 / data null)
    if (data.error || !data.data) {
        throw new Error(`Shopee API Error: ${data.error || 'Data kosong'}`);
    }
    
    return data;
  }

  // ========================================
  // 6. Listener untuk request dari popup
  // ========================================
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'GET_SCRAPED_DATA') {
      chrome.storage.local.get('shopeeScraperData', (result) => {
        sendResponse(result.shopeeScraperData || null);
      });
      return true;
    }

    if (message.action === 'TRIGGER_SCRAPE') {
      // Jika data API sudah berhasil ditangkap, JANGAN reset. Cukup refresh DOM enhancement.
      if (interceptedData.product && interceptedData.dataSource.includes('api')) {
        console.log('[Shopee Scraper] Menggunakan ulang data API yang sudah ke-intercept.');
        enhanceWithDOM();
        sendResponse({ status: 'scraping_started' });
        return true;
      }

      // Jika belum ada data API (kemungkinan reload page/gagal), coba fetch manual dulu
      console.log('[Shopee Scraper] Data API kosong, mencoba fetch product manual...');
      interceptedData.product = null;
      interceptedData.dataSource = 'none';
      
      fetchProductManual().then(data => {
         console.log('[Shopee Scraper] Berhasil fetch product secara manual!');
         interceptedData.product = data;
         interceptedData.dataSource = 'api';
         saveDataToStorage();
         setTimeout(() => enhanceWithDOM(), 3000);
      }).catch(err => {
         console.warn('[Shopee Scraper] Fetch manual gagal, fallback ke interceptor/DOM:', err);
         injectInterceptor();
         startFallbackTimer();
      });

      sendResponse({ status: 'scraping_started' });
      return true;
    }

    if (message.action === 'STOP_SCRAPE') {
      console.log('[Shopee Scraper V3] 🛑 Perintah STOP diterima. Scraping akan dihentikan di putaran berikutnya.');
      window.CS_SHOPEE_STOP_FLAG = true;
      
      // Jika ada review yang sudah terkumpul di interceptor (dari progressive save),
      // simpan langsung sebagai 'done' agar panel menampilkan persentase yang benar
      // dari data yang sudah ada, tanpa menunggu loop selesai
      const currentReviewCount = (() => {
        try {
          const reviews = interceptedData.reviews;
          if (!reviews || reviews.length === 0) return 0;
          // Hitung jumlah rating dari semua batch yang ada
          let count = 0;
          reviews.forEach(batch => {
            const ratings = batch?.data?.ratings || batch?.ratings || [];
            if (Array.isArray(ratings)) count += ratings.length;
          });
          return count;
        } catch(e) { return 0; }
      })();
      
      if (currentReviewCount > 0) {
        // Ada review yang sudah tersimpan — tandai sebagai done agar persentase langsung muncul
        interceptedData.fetchStatus = `done:${currentReviewCount}`;
        saveDataToStorage();
        console.log(`[Shopee Scraper V3] 💾 STOP: Menyimpan ${currentReviewCount} review yang sudah terkumpul.`);
      } else {
        // Belum ada data review — set status stopped agar badge update
        interceptedData.fetchStatus = `stopped:0`;
        saveDataToStorage();
      }
      
      sendResponse({ status: 'stopping' });
      return false;
    }

    if (message.action === 'FETCH_REVIEWS') {
      // ⚡ PERBAIKAN KRITIS: Balas SEGERA agar channel Chrome tidak timeout (>30 detik)
      // Fetch review berlanjut di background, panel akan auto-update via storage.onChanged
      sendResponse({ status: 'processing' });
      
      // Reset stop flag — penting agar scrape bisa berjalan jika sebelumnya pernah di-stop
      window.CS_SHOPEE_STOP_FLAG = false;
      
      // Set loading status
      interceptedData.fetchStatus = 'loading:0';
      saveDataToStorage();
      
      fetchNegativeReviews().then(reviews => {
        console.log(`%c[Shopee Scraper V3] ✅ FETCH_REVIEWS selesai! Total: ${reviews.length} review`, 'background: green; color: white; font-size: 14px;');
        
        // Simpan ke state dan storage — panel akan auto-refresh via storage.onChanged
        interceptedData.reviews = [{ data: { ratings: reviews } }];
        interceptedData.fetchStatus = `done:${reviews.length}`;
        saveDataToStorage();
      }).catch(err => {
        console.error('[Shopee Scraper V3] FETCH_REVIEWS gagal:', err);
        interceptedData.fetchStatus = 'error';
        saveDataToStorage();
      });
      
      return false; // false = sudah sendResponse, jangan tahan channel
    }

    if (message.action === 'CLICK_REVIEW_TABS') {
      sendResponse({ status: 'clicking' });
      
      clickReviewFilterTabs().then(result => {
        console.log(`[Shopee Scraper] Selesai klik ${result.clicked} tab review`);
        interceptedData.fetchStatus = `tabs_done:${result.clicked}`;
        saveDataToStorage();
      }).catch(err => {
        console.warn('[Shopee Scraper] Gagal klik tab review:', err);
      });
      
      return false;
    }

    if (message.action === 'FETCH_SHOP_DETAIL') {
      fetchShopDetail().then(shopData => {
        interceptedData.shop = shopData;
        saveDataToStorage();
        sendResponse({ shop: shopData });
      }).catch(err => {
        sendResponse({ shop: null, error: err.message });
      });
      return true;
    }

    if (message.action === 'FETCH_EXTRA_INFO') {
      sendResponse({ status: 'fetching_extra' });
      
      console.log('[Shopee Scraper] Fetch extra info (Shop & Monthly Sales)...');
      
      // Ambil terjual per bulan dari DOM
      enhanceWithDOM(); 
      
      // Fetch shop detail terbaru
      fetchShopDetail().then(shopData => {
        interceptedData.shop = shopData;
        saveDataToStorage();
        console.log('[Shopee Scraper] Berhasil fetch extra shop info');
      }).catch(err => {
        console.warn('[Shopee Scraper] Fetch extra shop gagal:', err);
      });
      
      return false;
    }

    if (message.action === 'CHECK_PAGE') {
      const isProductPage = checkIsProductPage();
      sendResponse({ isProductPage, url: window.location.href });
      return true;
    }
  });

  /**
   * Cek apakah halaman saat ini adalah halaman produk Shopee
   */
  function checkIsProductPage() {
    const url = window.location.href;
    return /shopee\.co\.id\/.+-i\.\d+\.\d+/.test(url);
  }

  /**
   * Auto-klik semua tab filter review di halaman produk Shopee
   * Tujuannya: agar interceptor menangkap response API review dari setiap tab filter
   * Urutan: Semua → 5☆ → 4☆ → 3☆ → 2☆ → 1☆ → Dengan Komentar → Dengan Media
   */
  async function clickReviewFilterTabs() {
    console.log('[Shopee Scraper] Memulai auto-klik tab filter review...');
    
    // Step 1: Scroll ke bagian review agar tab-tab terlihat
    const reviewSection = document.querySelector('.product-ratings, [class*="product-rating"], [class*="shopee-product-rating"]');
    if (reviewSection) {
      reviewSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await new Promise(r => setTimeout(r, 1000));
    }
    
    // Step 2: Temukan semua tab filter review
    // Shopee menggunakan div/button dengan teks "Semua", "5 Bintang", dll.
    const allFilterButtons = [];
    
    // Selector untuk tab filter review Shopee
    const selectors = [
      '.product-ratings .product-rating-overview__filter--all',
      '.product-ratings .product-rating-overview__filter',
      '[class*="product-rating"] [class*="filter"]',
      '.shopee-product-rating [role="tab"]',
      '.shopee-product-rating button',
    ];
    
    for (const sel of selectors) {
      const btns = document.querySelectorAll(sel);
      if (btns.length > 0) {
        btns.forEach(b => allFilterButtons.push(b));
        break;
      }
    }
    
    // Fallback: cari berdasarkan teks content
    if (allFilterButtons.length === 0) {
      const allDivs = document.querySelectorAll('.product-ratings div, [class*="product-rating"] div');
      const keywords = ['Semua', '5 Bintang', '4 Bintang', '3 Bintang', '2 Bintang', '1 Bintang', 'Dengan Komentar', 'Dengan Media'];
      
      allDivs.forEach(div => {
        const text = (div.textContent || '').trim();
        if (keywords.some(kw => text.startsWith(kw)) && div.children.length === 0) {
          // Cari parent yang clickable
          const clickTarget = div.closest('[role="tab"], button, .product-rating-overview__filter') || div;
          if (!allFilterButtons.includes(clickTarget)) {
            allFilterButtons.push(clickTarget);
          }
        }
      });
    }
    
    if (allFilterButtons.length === 0) {
      console.warn('[Shopee Scraper] Tidak ditemukan tab filter review di halaman ini.');
      return { clicked: 0 };
    }
    
    console.log(`[Shopee Scraper] Ditemukan ${allFilterButtons.length} tab filter review`);
    
    // Step 3: Klik setiap tab secara berurutan
    let clicked = 0;
    for (let i = 0; i < allFilterButtons.length; i++) {
      const btn = allFilterButtons[i];
      const label = (btn.textContent || '').trim().substring(0, 30);
      
      try {
        btn.click();
        clicked++;
        console.log(`[Shopee Scraper] Klik tab [${i + 1}/${allFilterButtons.length}]: "${label}"`);
        
        // Tunggu 2 detik agar API review sempat merespons dan ter-intercept
        await new Promise(r => setTimeout(r, 2000));
      } catch (e) {
        console.warn(`[Shopee Scraper] Gagal klik tab "${label}":`, e);
      }
    }
    
    // Step 4: Kembali ke tab "Semua" di akhir
    if (allFilterButtons.length > 0) {
      try {
        allFilterButtons[0].click();
        console.log('[Shopee Scraper] Kembali ke tab "Semua"');
      } catch (e) { /* silent */ }
    }
    
    console.log(`[Shopee Scraper] Selesai auto-klik ${clicked} tab filter review`);
    return { clicked };
  }

  /**
   * Ekstrak shop_id dan item_id dari URL
   */
  function extractIdsFromURL() {
    const url = window.location.href;
    const match = url.match(/i\.(\d+)\.(\d+)/);
    if (match) {
      return {
        shopId: parseInt(match[1], 10),
        itemId: parseInt(match[2], 10)
      };
    }
    return null;
  }

  /**
   * Fetch detail toko dari API Shopee berdasarkan shop_id dari URL
   */
  async function fetchShopDetail() {
    const ids = extractIdsFromURL();
    if (!ids) throw new Error('Tidak bisa mengekstrak shop_id dari URL');

    // Coba ambil shop_id dari product yang sudah discrape jika ada
    let shopId = ids.shopId;
    if (interceptedData.product) {
      const item = interceptedData.product?.data?.item ||
                   interceptedData.product?.data ||
                   interceptedData.product?.item ||
                   interceptedData.product;
      shopId = item?.shopid || item?.shop_id || shopId;
    }

    const apiUrl = `https://shopee.co.id/api/v4/shop/get_shop_detail?shopid=${shopId}`;

    const response = await fetch(apiUrl, {
      credentials: 'include',
      headers: {
        'Accept': 'application/json',
        'X-Requested-With': 'XMLHttpRequest'
      }
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    console.log('[Shopee Scraper] Data toko berhasil di-fetch:', data);
    return data;
  }

  /**
   * Auto-fetch review via direct API — dipanggil otomatis setelah product data diterima.
   * Versi ringan tanpa scroll/klik pagination agar UX tetap smooth.
   * Maksimal ~300 review (50 halaman × 6 per halaman).
   */
  async function autoFetchReviews() {
    // Skip jika sudah ada review yang di-collect (dari interceptor atau fetch sebelumnya)
    if (interceptedData.reviews && interceptedData.reviews.length > 0) {
      console.log('[Shopee Scraper] Auto-fetch skip: sudah ada review dari interceptor');
      return;
    }

    // Pastikan halaman produk
    if (!checkIsProductPage()) return;

    const ids = extractIdsFromURL();
    if (!ids) return;

    console.log('%c[Shopee Scraper] 🔄 Auto-fetch reviews dimulai (direct API)...', 'background: teal; color: white;');

    const allReviews = [];
    const seenIds = new Set();
    let offset = 0;
    const limit = 6;
    const maxPages = 50; // Max 300 review
    let retryCount = 0;
    const maxRetries = 3;
    let page = 0;
    let lastProgressSave = 0;

    // Set loading status
    interceptedData.fetchStatus = 'auto_loading:0';
    saveDataToStorage();

    try {
      while (page < maxPages) {
        const apiUrl = `https://shopee.co.id/api/v2/item/get_ratings?filter=0&flag=1&itemid=${ids.itemId}&limit=${limit}&offset=${offset}&shopid=${ids.shopId}&type=0`;
        const response = await fetch(apiUrl, {
          credentials: 'include',
          headers: {
            'Accept': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
            'Referer': window.location.href
          }
        });

        if (!response.ok) {
          if (response.status === 429 || response.status === 403) {
            retryCount++;
            const waitTime = Math.min(3000 * retryCount, 15000);
            console.warn(`[Shopee Scraper] ⚠️ Auto-fetch HTTP ${response.status}. Retry ${retryCount}/${maxRetries}`);
            await new Promise(r => setTimeout(r, waitTime));
            if (retryCount > maxRetries) {
              console.warn('[Shopee Scraper] ⛔ Auto-fetch: API diblokir, menghentikan.');
              break;
            }
            continue;
          }
          break;
        }

        retryCount = 0;
        const data = await response.json();
        const ratings = data?.data?.ratings || [];
        if (ratings.length === 0) break;

        ratings.forEach(r => {
          const id = r.rating_id || r.cmnt_id;
          if (!id || !seenIds.has(id)) {
            if (id) seenIds.add(id);
            allReviews.push(r);
          }
        });

        offset += limit;
        page++;

        // Progressive save setiap 100 review
        // (pakai selisih, bukan modulo — modulo bisa terpicu beberapa kali beruntun)
        if (allReviews.length - lastProgressSave >= 100) {
          lastProgressSave = allReviews.length;
          interceptedData.reviews = [{ data: { ratings: allReviews } }];
          interceptedData.fetchStatus = `auto_loading:${allReviews.length}`;
          saveDataToStorage();
          interceptedData.reviews = [];
        }

        if (ratings.length < limit) break;
        await new Promise(r => setTimeout(r, 800)); // Rate limit
      }
    } catch (e) {
      console.warn('[Shopee Scraper] Auto-fetch error:', e.message);
    }

    if (allReviews.length > 0) {
      console.log(`%c[Shopee Scraper] ✅ Auto-fetch selesai! ${allReviews.length} review`, 'background: green; color: white; font-size: 14px;');
      interceptedData.reviews = [{ data: { ratings: allReviews } }];
      interceptedData.fetchStatus = `done:${allReviews.length}`;
      saveDataToStorage();
    } else {
      console.log('[Shopee Scraper] Auto-fetch: tidak ada review yang didapat.');
      interceptedData.fetchStatus = 'done:0';
      saveDataToStorage();
    }
  }

  /**
   * Fetch review dari API Shopee — 2 tahap:
   * 1. Coba fetch SEMUA bintang (type=0) untuk data lengkap (varian sales)
   * 2. Fallback ke per-star (type=1,2,3) jika diblokir
   * Parser nanti yang filter bintang ≤3 untuk review negatif
   */
  async function fetchNegativeReviews() {
    console.log('%c[Shopee Scraper V3] 🚦 MULAI FETCH NEGATIVE REVIEWS', 'background: yellow; color: black; font-weight: bold; font-size: 14px;');
    const ids = extractIdsFromURL();
    if (!ids) throw new Error('Tidak bisa mengekstrak ID produk dari URL');

    const allReviews = [];

    // Helper untuk mengekstrak array ratings secara rekursif dari object JSON
    const extractRatings = (obj) => {
      let result = [];
      const search = (node) => {
        if (!node || typeof node !== 'object') return;
        
        // Pengecekan ketat: array harus ada isinya DAN elemen pertama wajib memiliki ciri khas ulasan (rating_id/rating_star/author)
        const isTrueReviewArray = (arr) => {
           return Array.isArray(arr) && arr.length > 0 && typeof arr[0] === 'object' && ('rating_star' in arr[0] || 'rating_id' in arr[0] || 'cmnt_id' in arr[0] || 'author_username' in arr[0]);
        };

        if (node.ratings && isTrueReviewArray(node.ratings)) {
          result.push(...node.ratings);
          return;
        }
        // cari itemratings (kadang penamaannya berbeda)
        if (node.item_rating_list && isTrueReviewArray(node.item_rating_list)) {
           result.push(...node.item_rating_list);
           return;
        }
        for (const key of Object.keys(node)) {
          search(node[key]);
        }
      };
      
      search(obj);
      return result;
    };
    
    // === Tahap 0: Seed dari interceptor (ulasan yang sudah ditangkap saat page-load) ===
    const seenIds = new Set();
    if (interceptedData.reviews && interceptedData.reviews.length > 0) {
      for (const batch of interceptedData.reviews) {
        const found = extractRatings(batch);
        found.forEach(r => {
          const id = r.rating_id || r.cmnt_id;
          if (!id || !seenIds.has(id)) {
            if (id) seenIds.add(id);
            allReviews.push(r);
          }
        });
      }
      console.log(`%c[Shopee Scraper V3] 🌱 Seed: ${allReviews.length} review dari interceptor`, 'background: blue; color: white;');
    }
    // Reset cache agar kita bisa tangkap halaman berikutnya
    interceptedData.reviews = [];
    
    // Update status awal
    interceptedData.fetchStatus = `loading:${allReviews.length}`;
    saveDataToStorage();

    // === Tahap 0.5: Simulasi klik pagination Shopee (bypass 403) ===
    // Shopee mengizinkan fetch dari browser-nya sendiri — kita manfaatkan ini.
    // Dengan klik tombol "next page" review, Shopee memanggil API-nya sendiri,
    // dan interceptor kita menangkap semua response-nya.
    
    let totalReviewsOfficial = 0;
    try {
      const item = interceptedData.product?.data?.item || interceptedData.product?.item || interceptedData.product;
      const countArr = item?.item_rating?.rating_count || [];
      totalReviewsOfficial = countArr[0] || item?.history_sold || 0;
    } catch(e) {}
    
    // PERBAIKAN: Ambil 100% ulasan, tidak dibatasi 30% lagi.
    const targetScraped = totalReviewsOfficial > 0 ? Math.ceil(totalReviewsOfficial) : Infinity;
    console.log(`%c[Shopee Scraper V3] 🎯 Target cakupan: ${targetScraped !== Infinity ? targetScraped : 'Semua'} review. Saat ini: ${allReviews.length}`, 'background: teal; color: white;');

      if (allReviews.length < targetScraped && !window.CS_SHOPEE_STOP_FLAG) {
      console.log('%c[Shopee Scraper V3] 📜 Scroll ke bagian review + simulasi pagination...', 'background: teal; color: white;');
      let paginationRounds = 0;      // jumlah halaman yang benar-benar menghasilkan review
      let paginationAttempts = 0;    // jumlah putaran loop (naik selalu, jadi loop pasti berhenti)
      let emptyStreak = 0;           // putaran beruntun tanpa review baru
      const MAX_PAGINATION_ROUNDS = 3000; // Maks 3000 halaman klik (sekitar 18000 review)
      const MAX_PAGINATION_ATTEMPTS = MAX_PAGINATION_ROUNDS + 50;
      const MAX_EMPTY_STREAK = 5;    // menyerah setelah 5 klik beruntun tanpa data baru
      let lastProgressSave = 0;
      let currentFilterTabIndex = 0; // Mulai dari tab "Semua" (index 0)
        
        try {
          // Scroll ke bagian review
          const reviewSectionSelectors = [
          'div.product-ratings', 'div[class*="product-rating"]',
          'div[class*="pdp-review"]', 'div[class*="rating-filter"]',
          'div[data-sqe="rating"]', 'section[class*="review"]'
        ];
        let reviewSection = null;
        for (const sel of reviewSectionSelectors) {
          reviewSection = document.querySelector(sel);
          if (reviewSection) break;
        }
        if (reviewSection) {
          reviewSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else {
          window.scrollTo({ top: document.body.scrollHeight * 0.7, behavior: 'smooth' });
        }
        await new Promise(r => setTimeout(r, 2000));

        // Loop klik tombol "next page" dan tunggu interceptor menangkap hasilnya
        while (paginationRounds < MAX_PAGINATION_ROUNDS && paginationAttempts < MAX_PAGINATION_ATTEMPTS) {
          paginationAttempts++; // selalu naik — mencegah loop tak berujung saat klik berhasil tapi tidak ada data
          let clicked = false;
          let targetBtn = null;
          
          // Retry mencari tombol Next yang aktif (maks 10x per 400ms = 4 detik)
          // Ini penting karena DOM React butuh waktu update setelah interceptor selesai
          for (let attempt = 0; attempt < 10; attempt++) {
            let nextBtnCandidates = [];
            
            // Re-query 'root' setiap putaran agar tidak menggunakan DOM React yang detached/mati
            const reviewSectionSelectors = [
              'div.product-ratings', 'div[class*="product-rating"]',
              'div[class*="pdp-review"]', 'div[class*="rating-filter"]',
              'div[data-sqe="rating"]', 'section[class*="review"]'
            ];
            let currentRoot = document;
            for (const sel of reviewSectionSelectors) {
              const rs = document.querySelector(sel);
              if (rs) { currentRoot = rs; break; }
            }
            const root = currentRoot;
            
            // Pendekatan 1: Deduksi dari tombol halaman web "Aktif" (yg berwarna merah/utama) di dalam review area
            const activePageBtn = root.querySelector('.shopee-page-controller button.shopee-button-solid--primary, .product-ratings button.shopee-button-solid--primary, button[aria-current="true"]');
            if (activePageBtn) {
              const paginationContainer = activePageBtn.closest('.shopee-page-controller, ul, nav, div.product-ratings div[style*="justify-content"]');
              if (paginationContainer) {
                const childrenArr = Array.from(paginationContainer.children);
                if (childrenArr.length > 0) {
                  let lastChild = childrenArr[childrenArr.length - 1];
                  let nextBtn = lastChild.tagName === 'BUTTON' ? lastChild : (lastChild.querySelector('button, [role="button"], a') || lastChild);
                  nextBtnCandidates.push(nextBtn);
                }
              }
            }
            
            // Pendekatan 2: Cari path SVG "panah ke kanan" namun KETAT hanya dalam review area
            const rightArrowPaths = root.querySelectorAll('.shopee-page-controller path[d^="m2.5 11c .1 0"], .shopee-page-controller path[d^="m11 6.5c0"], .shopee-page-controller path[d*="l6-5"]');
            rightArrowPaths.forEach(p => {
               const btn = p.closest('button, li, a, [role="button"]');
               if (btn) nextBtnCandidates.push(btn);
            });
            
            // Pendekatan 3: Selector Spesifik hanya di dalam pagination Shopee
            const specificSelectors = [
              '.shopee-page-controller button.shopee-icon-button--right',
              '.shopee-page-controller button:last-of-type',
              'button.shopee-icon-button--right'
            ];
            specificSelectors.forEach(sel => {
              root.querySelectorAll(sel).forEach(b => nextBtnCandidates.push(b));
            });
            
            // Pendekatan 4: Berdasarkan Screenshot Pagination Sederhana (Cari tombol >)
            // Shopee kadang pake tombol biasa dengan text > atau svg kecil
            // Cari elemen pembungkus pagination yg mirip susunan: < 1 2 3 >
            const allButtons = root.querySelectorAll('button, a[role="button"]');
            let paginationNumWrapper = null;
            allButtons.forEach(b => {
               // Jika tombol ini berisi angka (halaman aktif/tidak)
               if(b.textContent && b.textContent.trim().match(/^\d+$/)) {
                  paginationNumWrapper = b.parentElement; // Ambil container-nya
               }
            });
            
            if (paginationNumWrapper) {
               const contChildren = Array.from(paginationNumWrapper.children);
               if (contChildren.length > 2) { // Minimal ada prev, angka, next
                  let lastEl = contChildren[contChildren.length - 1]; // Elemen panah Kanan
                  let btn = lastEl.tagName === 'BUTTON' ? lastEl : (lastEl.querySelector('button') || lastEl);
                  nextBtnCandidates.push(btn);
               }
            }
            
            // Pendekatan 5: Cari Node Button Paling Terakhir di Review Section
            // Diasumsikan pagination selalu di bagian paling bawah ulasan
            const allReviewButtons = Array.from(root.querySelectorAll('button'));
            const svgOrPanahBtns = allReviewButtons.filter(b => {
                const txt = (b.textContent || '').trim();
                const hasSvg = b.querySelector('svg');
                // Tombol kecil, bukan tombol teks panjang spt 'Laporkan' atau 'Membantu'
                if (b.offsetWidth < 50 && b.offsetHeight < 50) {
                   // Memastikan ini berada di bagian bottom/akhir elemen review
                   if(hasSvg || txt === '>' || txt === 'next' || txt === 'Next') return true;
                }
                return false;
            });
            if (svgOrPanahBtns.length > 0) {
               nextBtnCandidates.push(svgOrPanahBtns[svgOrPanahBtns.length - 1]); // Ambill yang paling akhir
            }
            
            const uniqueBtns = [...new Set(nextBtnCandidates)].filter(Boolean);
            
            // Evaluasi tombol
            for (const btn of uniqueBtns) {
              const isDisabled = btn.disabled || 
                                 btn.classList.contains('shopee-icon-button--disabled') || 
                                 btn.closest('[disabled]') ||
                                 btn.closest('.shopee-icon-button--disabled') ||
                                 btn.getAttribute('aria-disabled') === 'true' ||
                                 btn.classList.contains('disabled');
              
              const rect = btn.getBoundingClientRect();
              const isVisible = rect.width > 0 && rect.height > 0;
              
              if (!isDisabled && isVisible) {
                targetBtn = btn;
                break;
              }
            }
            
            if (targetBtn) break; // Berhenti retry jika berhasil dapat tombol
            await new Promise(r => setTimeout(r, 400)); // Tunggu DOM update
          }
          
          if (targetBtn) {
            targetBtn.scrollIntoView({ block: 'center' });
            await new Promise(r => setTimeout(r, 200)); // Sedikit jeda agar stabil untuk diklik
            
            // Trick klik 1: Eksekusi click di anak pertamanya (misal svg), karena event binding React kadang spesifik
            const firstChild = targetBtn.firstElementChild;
            if (firstChild) {
              try { firstChild.click(); } catch (e) {}
            }
            
            // Trick klik 2: Native Element Clicks
            try { targetBtn.click(); } catch(e) {}
            
            // Trick klik 3: Dispatch native events (jurus terakhir untuk React bypass)
            const eventOpts = { bubbles: true, cancelable: true, view: window };
            targetBtn.dispatchEvent(new MouseEvent('pointerdown', eventOpts));
            targetBtn.dispatchEvent(new MouseEvent('mousedown', eventOpts));
            targetBtn.dispatchEvent(new MouseEvent('pointerup', eventOpts));
            targetBtn.dispatchEvent(new MouseEvent('mouseup', eventOpts));
            targetBtn.dispatchEvent(new MouseEvent('click', eventOpts));
            
            clicked = true;
            console.log(`[Shopee Scraper V3] 🖱️ Klik next page (round ${paginationRounds + 1}) pada elemen:`, targetBtn);
            await new Promise(r => setTimeout(r, 500)); // Beri waktu DOM mengirim request API
          }
          
          if (!clicked) {
            console.log(`%c[Shopee Scraper V3] 🏁 Tidak ada tombol next page lagi di tab ini. Mencoba pindah tab filter...`, 'background: orange; color: black;');
            
            // Coba temukan semua tombol filter review
            const filterSelectors = [
              '.product-ratings .product-rating-overview__filter',
              '[class*="product-rating"] [class*="filter"]',
              '.shopee-product-rating [role="tab"]'
            ];
            
            let filterBtns = [];
            for (const sel of filterSelectors) {
              const fbs = document.querySelectorAll(sel);
              if (fbs.length > 0) {
                filterBtns = Array.from(fbs);
                break;
              }
            }
            
            currentFilterTabIndex++;
            
            if (filterBtns.length > 0 && currentFilterTabIndex < filterBtns.length) {
                const fBtn = filterBtns[currentFilterTabIndex];
                const fLabel = (fBtn.textContent || '').trim().substring(0, 15);
                console.log(`[Shopee Scraper V3] 🔄 Pindah ke tab filter: ${fLabel}`);
                
                try {
                  fBtn.click();
                  await new Promise(r => setTimeout(r, 2000));
                  // Kita berhasil pindah tab, lanjut ke loop pagination lagi!
                  clicked = true;
                } catch(e) {
                  console.warn('[Shopee Scraper] Gagal klik tab filter', e);
                }
            }

            // Jika masih !clicked, berarti gagal pindah tab atau tab sudah habis
            if (!clicked) {
              console.log(`%c[Shopee Scraper V3] 🏁 Semua tab exhaust. Total review: ${allReviews.length}`, 'background: green; color: white;');
              break;
            }
          }

          if (window.CS_SHOPEE_STOP_FLAG) {
            console.log('%c[Shopee Scraper V3] 🛑 Proses pagination dihentikan paksa oleh user!', 'background: red; color: white; font-weight: bold;');
            break;
          }
          
          // Tunggu hingga interceptor menangkap batch baru setelah klik (max 6 detik)
          const captured = await new Promise(resolve => {
            let waited = 0;
            const interval = setInterval(() => {
              waited += 300;
              // Cek cache interceptor terus-menerus
              if (interceptedData.reviews && interceptedData.reviews.length > 0) {
                const newBatches = interceptedData.reviews;
                interceptedData.reviews = []; // Reset segera
                let newFound = 0;
                newBatches.forEach(batch => {
                  extractRatings(batch).forEach(r => {
                    const id = r.rating_id || r.cmnt_id;
                    if (!id || !seenIds.has(id)) {
                      if (id) seenIds.add(id);
                      allReviews.push(r);
                      newFound++;
                    }
                  });
                });
                if (newFound > 0) {
                  clearInterval(interval);
                  resolve(newFound);
                  return;
                }
              }
              if (waited >= 6000) {
                clearInterval(interval);
                resolve(0);
              }
            }, 300);
          });

          if (captured > 0) {
            paginationRounds++;
            emptyStreak = 0;
            const coverage = totalReviewsOfficial > 0 ? ((allReviews.length / totalReviewsOfficial) * 100).toFixed(1) : '?';
            console.log(`[Shopee Scraper V3] 📄 Halaman ${paginationRounds}: +${captured} review, total: ${allReviews.length} (${coverage}%)`);

            // Progressive save setiap 100 review
            if (allReviews.length - lastProgressSave >= 100) {
              lastProgressSave = allReviews.length;
              interceptedData.reviews = [{ data: { ratings: allReviews } }];
              interceptedData.fetchStatus = `loading:${allReviews.length}`;
              saveDataToStorage();
              interceptedData.reviews = []; // Reset lagi setelah save
              console.log(`%c[Shopee Scraper V3] 💾 Progressive save: ${allReviews.length}`, 'background: teal; color: white;');
            }
          } else {
            // Klik berhasil tapi tidak ada review baru — jangan berputar selamanya
            emptyStreak++;
            console.log(`[Shopee Scraper V3] ⏳ Tidak ada review baru setelah klik (${emptyStreak}/${MAX_EMPTY_STREAK}).`);
            if (emptyStreak >= MAX_EMPTY_STREAK) {
              console.log(`%c[Shopee Scraper V3] 🏁 ${MAX_EMPTY_STREAK}× klik beruntun tanpa data baru. Menghentikan pagination.`, 'background: orange; color: black;');
              break;
            }
          }

          // Berhenti jika sudah mencapai target atau STOP ditekan
          if (allReviews.length >= targetScraped || window.CS_SHOPEE_STOP_FLAG) {
            console.log(`%c[Shopee Scraper V3] 🎯 Target tercapai atau STOP ditekan (${allReviews.length} dari ${totalReviewsOfficial}). Menghentikan klik next!`, 'background: green; color: white; font-weight: bold;');
            break;
          }

          if (paginationRounds >= MAX_PAGINATION_ROUNDS) {
            console.log(`[Shopee Scraper V3] ⚠️ Mencapai batas ${MAX_PAGINATION_ROUNDS} halaman.`);
            break;
          }
          if (paginationAttempts >= MAX_PAGINATION_ATTEMPTS) {
            console.log(`[Shopee Scraper V3] ⚠️ Mencapai batas ${MAX_PAGINATION_ATTEMPTS} percobaan klik.`);
            break;
          }
        }
      } catch (e) {
        console.warn('[Shopee Scraper V3] Pagination simulation error:', e);
      }
    } else {
      console.log(`%c[Shopee Scraper V3] 🎯 Target cakupan sudah terpenuhi atau STOP aktif (${allReviews.length} review). Skip pagination.`, 'background: green; color: white; font-weight: bold;');
    }

    // === Tahap 1: Jika pagination tidak berhasil, coba direct API dengan limit konservatif ===
    if (allReviews.length < 10) {
      console.log('%c[Shopee Scraper V3] 🚀 Pagination gagal, mencoba direct API (limit=6)...', 'background: orange; color: black; font-weight: bold;');
      try {
        let offset = 0;
        const limit = 6; // Konservatif — sama dengan yang dipakai Shopee native
        let retryCount = 0;
        const maxRetries = 3;
        let lastProgressSaveApi = 0;

        while (true) {
          if (window.CS_SHOPEE_STOP_FLAG) { // Check stop flag here too
            console.log('%c[Shopee Scraper V3] 🛑 Proses direct API dihentikan paksa oleh user!', 'background: red; color: white; font-weight: bold;');
            break;
          }

          const apiUrl = `https://shopee.co.id/api/v2/item/get_ratings?filter=0&flag=1&itemid=${ids.itemId}&limit=${limit}&offset=${offset}&shopid=${ids.shopId}&type=0`;
          const response = await fetch(apiUrl, {
            credentials: 'include',
            headers: {
              'Accept': 'application/json',
              'X-Requested-With': 'XMLHttpRequest',
              'Referer': window.location.href
            }
          });

          if (!response.ok) {
            if (response.status === 429 || response.status === 403) {
              retryCount++;
              const waitTime = Math.min(3000 * retryCount, 15000);
              console.warn(`[Shopee Scraper V3] ⚠️ HTTP ${response.status}. Retry ${retryCount}/${maxRetries}, tunggu ${waitTime/1000}s...`);
              await new Promise(r => setTimeout(r, waitTime));
              if (retryCount > maxRetries) { console.warn('[Shopee Scraper V3] ⛔ API tetap diblokir.'); break; }
              continue;
            }
            throw new Error(`HTTP ${response.status}`);
          }

          retryCount = 0;
          const data = await response.json();
          const ratings = data?.data?.ratings || [];
          if (ratings.length === 0) break;

          ratings.forEach(r => {
            const id = r.rating_id || r.cmnt_id;
            if (!id || !seenIds.has(id)) {
              if (id) seenIds.add(id);
              allReviews.push(r);
            }
          });
          offset += limit;

          if (allReviews.length - lastProgressSaveApi >= 200) {
            lastProgressSaveApi = allReviews.length;
            interceptedData.reviews = [{ data: { ratings: allReviews } }];
            interceptedData.fetchStatus = `loading:${allReviews.length}`;
            saveDataToStorage();
            interceptedData.reviews = [];
          }

          if (ratings.length < limit) break;
          await new Promise(r => setTimeout(r, 800));
        }
      } catch (e) {
        console.warn('[Shopee Scraper V3] ⛔ Direct API error:', e.message);
      }
    }

    // === Tahap 2: (Ditiadakan - digantikan pagination simulation) ===


    // === Tahap 3: Fallback DOM dari __NEXT_DATA__ jika API benar-benar diblokir ===
    if (allReviews.length === 0) {
      console.log('%c[Shopee Scraper V3] 🕵️‍♂️ API DIBLOKIR. Mencari di __NEXT_DATA__...', 'background: purple; color: white;');
      try {
        const nextDataScript = document.getElementById('__NEXT_DATA__');
        if (nextDataScript) {
          const nextData = JSON.parse(nextDataScript.textContent);
          
          // Traverse tree untuk cari key 'ratings' yang isinya array
          const searchForRatings = (obj) => {
            if (!obj || typeof obj !== 'object') return;
            if (obj.ratings && Array.isArray(obj.ratings) && obj.ratings.length > 0) {
               console.log('%c[Shopee Scraper V3] ✅ Review ditemukan di __NEXT_DATA__!', 'background: green; color: white;', obj.ratings.length);
               allReviews.push(...obj.ratings);
               return; // Jangan cari lebih dalam di cabang ini jika sudah ketemu
            }
            for (const key of Object.keys(obj)) {
              searchForRatings(obj[key]);
            }
          };
          
          searchForRatings(nextData);
        }
      } catch (e) {
        console.warn('[Shopee Scraper V3] Gagal parsing review dari DOM __NEXT_DATA__:', e);
      }
    }

    // === Tahap 4: Fallback DOM HTML Murni (Visual Element Scraping) ===
    if (allReviews.length === 0) {
      console.log('%c[Shopee Scraper V3] 👁️ Semua API Tertutup. Mencoba scrape elemen HTML murni (Peringatan: sangat terbatas)', 'background: red; color: white;');
      try {
        const nodes = document.querySelectorAll('div.shopee-product-rating, div[class*="product-rating"]');
        
        // FILTER: Pastikan elemen ini BUKAN container raksasa yang membungkus komentar lain.
        // Elemen review tunggal hanya boleh punya maksimal 1 nama author.
        const reviewElements = Array.from(nodes).filter(el => {
            const authorsCount = el.querySelectorAll('.shopee-product-rating__author-name, a[class*="author"]').length;
            const contentsCount = el.querySelectorAll('.shopee-product-rating__content, div[class*="content"]').length;
            return (authorsCount === 1 || contentsCount === 1) && el.textContent.trim().length > 0;
        });

        // Hapus duplikat (kadang selektor menangkap node yang overlap)
        const uniqueReviews = [...new Set(reviewElements)];

        for (const el of uniqueReviews) {
           const authorEl = el.querySelector('.shopee-product-rating__author-name, a[class*="author"], div[class*="author"]');
           const author = authorEl ? authorEl.textContent.trim() : 'User';
           
           // Hitung bintang aktif
           const starEls = el.querySelectorAll('svg.icon-rating-solid, svg[class*="icon-rating-solid"]');
           let stars = starEls.length;
           if (stars > 5) stars = 5;
           if (stars === 0) stars = 5; // Default jika gagal baca SVG

           // Varian (Ekstraksi Regex Agresif per Review)
           let variation = '';
           const rawText = el.innerText || el.textContent || '';
           const varMatch = rawText.match(/(?:Varias?i?|Varian|Variant):\s*([^\n|]+)/i);
           
           if (varMatch && varMatch[1]) {
               variation = varMatch[1].trim();
           } else {
               // Fallback lama jika regex gagal
               const variationEl = el.querySelector('.shopee-product-rating__variation, div[class*="variation"]');
               if (variationEl) {
                  variation = variationEl.textContent.replace(/Varian:|Variasi:/i, '').trim();
               }
           }
           
           // Komentar
           const contentEl = el.querySelector('.shopee-product-rating__content, div[class*="content"]');
           const comment = contentEl ? contentEl.textContent.trim() : '';

           // Masukkan format palsu mirip API agar bisa dipompa ke parser
           allReviews.push({
              rating_id: Math.random().toString(36).substr(2, 9),
              rating_star: stars,
              variation: variation,
              comment: comment,
              author_username: author
           });
        }
        if (allReviews.length > 0) {
           console.log(`%c[Shopee Scraper V3] ✅ Berhasil mengekstrak ${allReviews.length} review terfiltrasi dari HTML.`, 'background: green; color: white;');
        }
      } catch (e) {
        console.warn('[Shopee Scraper V3] ❌ Gagal scrape review dari HTML murni:', e);
      }
    }

    console.log(`%c[Shopee Scraper V3] 🏁 SELESAI. Total review yang diangkut ke Parser: ${allReviews.length}`, 'background: blue; color: white; border: 1px solid blue;');
    return allReviews;
  }

  // ========================================
  // 7. Inisialisasi
  // ========================================
  function init() {
    if (checkIsProductPage()) {
      console.log('[Shopee Scraper] Halaman produk terdeteksi di awal, memulai...');
      startFallbackTimer();
    }

    // Deteksi perubahan SPA
    let lastUrl = window.location.href;
    setInterval(() => {
      if (window.location.href !== lastUrl) {
         lastUrl = window.location.href;
         bulkSearchProductsMap.clear();
         if (checkIsProductPage()) {
            console.log('[Shopee Scraper] Navigasi SPA ke PDP terdeteksi, restart intercept/fallback...');
            interceptedData.product = null;
            interceptedData.reviews = [];
            interceptedData.shop = null;
            interceptedData.dataSource = 'none';
            interceptedData.fetchStatus = null;
            window.CS_SHOPEE_STOP_FLAG = true; // hentikan loop scrape produk sebelumnya
            // Kosongkan storage agar panel tidak menampilkan data produk lama
            try {
              chrome.storage.local.set({ shopeeScraperData: null }, () => {
                void chrome.runtime.lastError;
              });
            } catch (e) { /* extension context invalidated */ }
            setTimeout(() => { window.CS_SHOPEE_STOP_FLAG = false; }, 1000);
            startFallbackTimer();
         }
      }
    }, 1000);
  }

  // Interceptor HARUS di-inject sinkron saat script dievaluasi (run_at: document_start).
  // Menundanya sampai DOMContentLoaded membuat request API awal Shopee terlewat,
  // sehingga data produk tidak pernah tertangkap dan selalu jatuh ke fallback DOM.
  console.log('[Shopee Scraper] Injector dimulai, inject interceptor selalu aktif untuk SPA...');
  injectInterceptor();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
