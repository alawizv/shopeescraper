/**
 * popup.js
 * =========
 * Script utama untuk popup extension.
 * Mengelola:
 * - Tampilan data produk, varian, dan review
 * - Interaksi user (tombol scrape, export, dll.)
 * - Komunikasi dengan content script dan background
 */

(function () {
  'use strict';

  // ========================================
  // State aplikasi
  // ========================================
  let currentData = null;
  let parsedProduct = null;
  let negativeReviews = [];

  // ========================================
  // Referensi elemen DOM
  // ========================================
  const elements = {
    statusBadge: document.getElementById('status-badge'),
    statusText: document.getElementById('status-text'),
    notProductPage: document.getElementById('not-product-page'),
    errorMessage: document.getElementById('error-message'),
    errorText: document.getElementById('error-text'),
    mainContent: document.getElementById('main-content'),
    loadingOverlay: document.getElementById('loading-overlay'),
    loadingText: document.getElementById('loading-text'),

    btnScrape: document.getElementById('btn-scrape'),
    btnStop: document.getElementById('btn-stop'),
    btnFetchExtra: document.getElementById('btn-fetch-extra'),
    btnExportJSON: document.getElementById('btn-export-json'),
    btnExportCSV: document.getElementById('btn-export-csv'),
    btnExportSheets: document.getElementById('btn-export-sheets'),

    productName: document.getElementById('product-name'),
    productPrice: document.getElementById('product-price'),
    productRating: document.getElementById('product-rating'),
    productSold: document.getElementById('product-sold'),
    productReviews: document.getElementById('product-reviews'),

    variantCount: document.getElementById('variant-count'),
    noVariants: document.getElementById('no-variants'),
    variantTableWrapper: document.getElementById('variant-table-wrapper'),
    tierSummariesWrap: document.getElementById('tierSummariesWrap'),
    variantTbody: document.getElementById('variant-tbody'),
    
    reviewSampleWrap: document.getElementById('reviewSampleWrap'),
    reviewSampleTableWrap: document.getElementById('reviewSampleTableWrap'),
    sampleScraped: document.getElementById('sample-scraped'),
    sampleTotal: document.getElementById('sample-total'),
    sampleCoverage: document.getElementById('sample-coverage'),
    sampleVariants: document.getElementById('sample-variants'),
    sampleNote: document.getElementById('sample-note'),

    // Monthly Sales
    monthlySoldValue: document.getElementById('monthly-sold-value'),
    monthlySoldSource: document.getElementById('monthly-sold-source'),

    // Shop Info
    noShopData: document.getElementById('no-shop-data'),
    shopInfoContent: document.getElementById('shop-info-content'),
    shopInfoTbody: document.getElementById('shop-info-tbody'),

    exportStatus: document.getElementById('export-status'),
  };

  // ========================================
  // Inisialisasi
  // ========================================
  async function init() {
    console.log('[Popup] Inisialisasi...');

    setupEventListeners();

    const tab = await getActiveTab();

    if (!tab || !isShopeeProductURL(tab.url)) {
      showNotProductPage();
      return;
    }

    showLoading('Memuat data produk...');

    try {
      const response = await sendMessageToTab(tab.id, { action: 'GET_SCRAPED_DATA' });

      if (response && response.rawProduct) {
        processRawData(response);
      } else {
        await checkStorageFallback(tab.url);
      }
    } catch (e) {
      console.warn('[Popup] Gagal komunikasi dengan content script, mencoba re-inject:', e);
      hideLoading();
      
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['utils/parser.js', 'content/injector.js', 'content/panel.js']
        });
        showLoading('Menyambung ulang...');
        
        setTimeout(async () => {
          try {
            await sendMessageToTab(tab.id, { action: 'TRIGGER_SCRAPE' });
            setTimeout(async () => {
              try {
                const resp2 = await sendMessageToTab(tab.id, { action: 'GET_SCRAPED_DATA' });
                if (resp2 && resp2.rawProduct) {
                  processRawData(resp2);
                } else {
                  await checkStorageFallback(tab.url);
                }
              } catch(err3) {
                await checkStorageFallback(tab.url);
              }
            }, 3000);
          } catch(err2) {
            await checkStorageFallback(tab.url);
          }
        }, 1000);
      } catch (injectErr) {
        console.error('[Popup] Gagal inject:', injectErr);
        await checkStorageFallback(tab.url);
      }
    }
  }

  async function checkStorageFallback(currentUrl) {
      hideLoading();
      const storageData = await getFromStorage('shopeeScraperData');
      if (storageData && storageData.rawProduct && storageData.url && currentUrl.includes(extractProductSlug(storageData.url))) {
        processRawData(storageData);
      } else {
        setStatus('error', 'Gagal memuat');
        showError('Gagal berkomunikasi dengan halaman. Coba refresh halaman Shopee.');
      }
  }

  // ========================================
  // Setup event listeners
  // ========================================
  function setupEventListeners() {

    elements.btnScrape.addEventListener('click', async () => {
      const tab = await getActiveTab();
      if (!tab) return;

      showLoading('Scraping ulang...');
      elements.btnScrape.disabled = true;
      elements.btnStop.style.display = 'block';

      try {
        await sendMessageToTab(tab.id, { action: 'TRIGGER_SCRAPE' });

        let attempts = 0;
        const maxAttempts = 15; // 15 detik timeout
        
        const checkData = setInterval(async () => {
          attempts++;
          const response = await sendMessageToTab(tab.id, { action: 'GET_SCRAPED_DATA' });
          
          if (response && response.rawProduct && (response.dataSource !== 'none')) {
            clearInterval(checkData);
            processRawData(response);
            elements.btnScrape.disabled = false;
            elements.btnStop.style.display = 'none';
            
            // ⚡ AUTO-FETCH REVIEWS setelah data produk berhasil didapat
            // Jangan tunggu hasilnya — berjalan di background, panel akan update otomatis
            setTimeout(async () => {
              try {
                const tab2 = await getActiveTab();
                if (tab2) await sendMessageToTab(tab2.id, { action: 'FETCH_REVIEWS' });
              } catch(e) { /* silent fail — review tidak kritis */ }
            }, 2000);
            
          } else if (attempts >= maxAttempts) {
            clearInterval(checkData);
            hideLoading();
            setStatus('error', 'Gagal scrape');
            elements.btnScrape.disabled = false;
            elements.btnStop.style.display = 'none';
          }
        }, 1000);

      } catch (e) {
        hideLoading();
        setStatus('error', 'Error');
        elements.btnScrape.disabled = false;
        showError('Gagal memulai scraping. Refresh halaman dan coba lagi.');
      }
    });

    elements.btnStop.addEventListener('click', async () => {
      const tab = await getActiveTab();
      if (!tab) return;
      try {
        await sendMessageToTab(tab.id, { action: 'STOP_SCRAPE' });
        elements.btnStop.style.display = 'none';
        elements.btnScrape.disabled = false;
        setStatus('ok', 'Dihentikan');
      } catch (e) {
        console.warn('Gagal set stop flag:', e);
      }
    });

    elements.btnFetchExtra.addEventListener('click', async () => {
      const tab = await getActiveTab();
      if (!tab) return;
      
      elements.btnFetchExtra.disabled = true;
      elements.btnFetchExtra.textContent = 'Memuat...';
      
      try {
        await sendMessageToTab(tab.id, { action: 'FETCH_EXTRA_INFO' });
      } catch (e) {
        console.warn('[Popup] Gagal memuat info tambahan:', e);
      }
      
      setTimeout(() => {
        elements.btnFetchExtra.disabled = false;
        elements.btnFetchExtra.textContent = '⚡ Muat Info Terjual & Toko';
      }, 3000);
    });

    elements.btnExportJSON.addEventListener('click', () => {
      if (!currentData) {
        showExportStatus('Tidak ada data untuk diekspor', 'error');
        return;
      }
      ShopeeExporter.downloadJSON(currentData, 'shopee-product');
      showExportStatus('✅ File JSON berhasil diunduh', 'success');
    });

    elements.btnExportCSV.addEventListener('click', () => {
      if (!currentData) {
        showExportStatus('Tidak ada data untuk diekspor', 'error');
        return;
      }
      ShopeeExporter.downloadCSV(currentData, 'shopee-product');
      showExportStatus('✅ File CSV berhasil diunduh', 'success');
    });

    elements.btnExportSheets.addEventListener('click', async () => {
      if (!currentData) {
        showExportStatus('Tidak ada data untuk diekspor', 'error');
        return;
      }

      elements.btnExportSheets.disabled = true;
      showExportStatus('⏳ Menghubungkan ke Google Sheets...', 'info');

      try {
        const result = await chrome.runtime.sendMessage({
          action: 'EXPORT_GOOGLE_SHEETS',
          data: currentData
        });

        if (result.error) throw new Error(result.error);

        if (result.url) {
          showExportStatus(`✅ Berhasil! <a href="${result.url}" target="_blank">Buka Spreadsheet</a>`, 'success');
        }
      } catch (e) {
        console.error('[Popup] Google Sheets export error:', e);
        showExportStatus('❌ Gagal export ke Google Sheets. Mengunduh JSON sebagai fallback...', 'error');

        setTimeout(() => {
          ShopeeExporter.downloadJSON(currentData, 'shopee-product');
          showExportStatus('📄 File JSON telah diunduh sebagai pengganti', 'success');
        }, 1500);
      }

      elements.btnExportSheets.disabled = false;
    });
  }


  // ========================================
  // Proses data mentah
  // ========================================
  function processRawData(rawData) {
    try {
      console.log('[Popup] Memproses data mentah...');

      parsedProduct = ShopeeParser.parseProduct(rawData.rawProduct);

      if (!parsedProduct) {
        hideLoading();
        setStatus('error', 'Parse gagal');
        showError('Gagal mengolah data produk. Coba refresh halaman.');
        return;
      }

      // parseNegativeReviews selalu mengembalikan { reviews: [], totalReviewsParsed: 0 }
      const parsedReviews = ShopeeParser.parseNegativeReviews(rawData.rawReviews || [], parsedProduct?.variants || []);
      negativeReviews = parsedReviews;

      currentData = ShopeeParser.buildOutput(
        parsedProduct,
        parsedReviews,
        rawData.url || '',
        rawData.rawShop || null,
        rawData.monthlySoldFromSearch || null
      );

      renderProduct(parsedProduct);
      renderReviewSample(currentData.review_sample || null);
      renderMonthlySales(parsedProduct, rawData);
      renderShopInfo(currentData.shop || null);
      renderVariants(currentData.variants || [], currentData.tierSummaries || []);

      const source = rawData.dataSource === 'api' ? 'API' : rawData.dataSource === 'api+dom' ? 'API+DOM' : 'DOM';
      setStatus('success', `Data dari ${source}`);

      hideLoading();
      showMainContent();

    } catch (e) {
      console.error('[Popup] Error processing data:', e);
      hideLoading();
      setStatus('error', 'Error');
      showError('Terjadi error saat memproses data: ' + e.message);
    }
  }

  // ========================================
  // Render functions
  // ========================================
  function renderProduct(product) {
    elements.productName.textContent = product.name || '-';

    if (product.price_min === product.price_max || !product.price_max) {
      elements.productPrice.textContent = formatRupiah(product.price_min);
    } else {
      elements.productPrice.textContent = `${formatRupiah(product.price_min)} - ${formatRupiah(product.price_max)}`;
    }

    elements.productRating.innerHTML = `${product.rating || 0} ⭐`;
    elements.productSold.textContent = formatNumber(product.total_sold);
    elements.productReviews.textContent = formatNumber(product.review_count);
  }

  function renderReviewSample(sample) {
    if (!sample || sample.reviews_scraped <= 0) {
      if (elements.reviewSampleWrap) elements.reviewSampleWrap.style.display = 'block';
      if (elements.reviewSampleTableWrap) elements.reviewSampleTableWrap.style.display = 'none';
      return;
    }

    if (elements.reviewSampleWrap) elements.reviewSampleWrap.style.display = 'none';
    if (elements.reviewSampleTableWrap) elements.reviewSampleTableWrap.style.display = 'block';

    if (elements.sampleScraped) elements.sampleScraped.textContent = formatNumber(sample.reviews_scraped);
    if (elements.sampleTotal) elements.sampleTotal.textContent = formatNumber(sample.reviews_total);
    if (elements.sampleCoverage) elements.sampleCoverage.textContent = sample.coverage_percent + '%';
    if (elements.sampleVariants) elements.sampleVariants.textContent = formatNumber(sample.unique_variants_found);
    if (elements.sampleNote) elements.sampleNote.textContent = sample.data_note || '';
  }

  function renderVariants(variants, tierSummaries = []) {
    elements.variantCount.textContent = variants.length;

    if (!variants || variants.length === 0) {
      elements.noVariants.classList.remove('d-none');
      elements.variantTableWrapper.classList.add('d-none');
      if (elements.tierSummariesWrap) elements.tierSummariesWrap.style.display = 'none';
      return;
    }

    elements.noVariants.classList.add('d-none');
    elements.variantTableWrapper.classList.remove('d-none');
    
    // Render Tier Summaries (V1 Logic)
    if (elements.tierSummariesWrap) {
        if (tierSummaries && tierSummaries.length > 0) {
            elements.tierSummariesWrap.style.display = 'block';
            let tierHtml = '';
            tierSummaries.forEach(ts => {
                tierHtml += `
                  <div style="margin-bottom: 6px;">
                    <strong style="color:#333; font-size: 11px;">${escapeHTML(ts.name)}</strong><br>
                    <span style="font-size: 11px; color: #444;">${escapeHTML(ts.summary)}</span>
                  </div>
                `;
            });
            elements.tierSummariesWrap.innerHTML = tierHtml;
        } else {
            elements.tierSummariesWrap.style.display = 'block';
            elements.tierSummariesWrap.innerHTML = '<span style="font-size: 10px; color: #999; font-style:italic;">(Persentase penjualan per varian tidak tersedia)</span>';
        }
    }

    elements.variantTbody.innerHTML = '';

    variants.forEach(v => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHTML(v.tier1 || '-')}</td>
        <td>${escapeHTML(v.tier2 || '-')}</td>
        <td>${v.sales_percentage || 0}%</td>
        <td>${v.price ? formatRupiah(v.price) : '-'}</td>
      `;

      elements.variantTbody.appendChild(tr);
    });
  }

  /**
   * Render data Terjual / Bulan
   */
  function renderMonthlySales(product, rawData) {
    let monthlySold = 0;
    let sourceText = 'Belum tersedia';

    // Prioritas 1: sold_per_month_actual dari PDP API
    if (product && product.sold_per_month_actual > 0) {
      monthlySold = product.sold_per_month_actual;
      sourceText = '✅ Sumber: PDP API (field "sold")';
    }
    // Prioritas 2: monthlySoldFromSearch dari Search API
    else if (rawData && rawData.monthlySoldFromSearch > 0) {
      monthlySold = rawData.monthlySoldFromSearch;
      sourceText = '✅ Sumber: Search API (cache)';
    }
    // Prioritas 3: Tidak ada data
    else {
      sourceText = '⚠️ Data belum tersedia — refresh halaman atau browse produk lain dulu';
    }

    if (elements.monthlySoldValue) {
      elements.monthlySoldValue.textContent = monthlySold > 0
        ? formatNumber(monthlySold) + ' / bulan'
        : '-';
    }
    if (elements.monthlySoldSource) {
      elements.monthlySoldSource.textContent = sourceText;
      elements.monthlySoldSource.className = monthlySold > 0
        ? 'data-source-badge active'
        : 'data-source-badge';
    }
  }

  /**
   * Render data Info Toko
   */
  function renderShopInfo(shop) {
    if (!shop) {
      if (elements.noShopData) elements.noShopData.classList.remove('d-none');
      if (elements.shopInfoContent) elements.shopInfoContent.classList.add('d-none');
      return;
    }

    if (elements.noShopData) elements.noShopData.classList.add('d-none');
    if (elements.shopInfoContent) elements.shopInfoContent.classList.remove('d-none');

    // Build status badge
    let statusLabel = 'Regular';
    let statusClass = 'regular';
    if (shop.is_mall) { statusLabel = 'Shopee Mall'; statusClass = 'mall'; }
    else if (shop.is_preferred) { statusLabel = 'Star+'; statusClass = 'preferred'; }

    const rows = [
      ['Nama Toko', escapeHTML(shop.name || '-')],
      ['Lokasi', escapeHTML(shop.location || '-')],
      ['Followers', formatNumber(shop.follower_count || 0)],
      ['Jumlah Produk', formatNumber(shop.product_count || 0)],
      ['Rating Toko', (shop.rating_star || 0) + ' ⭐'],
      ['Response Rate', shop.response_rate !== null ? shop.response_rate + '%' : '-'],
      ['Status', `<span class="shop-status-badge ${statusClass}">${statusLabel}</span>`]
    ];

    if (elements.shopInfoTbody) {
      elements.shopInfoTbody.innerHTML = '';
      rows.forEach(([label, value]) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${label}</td><td>${value}</td>`;
        elements.shopInfoTbody.appendChild(tr);
      });
    }
  }


  // UI State Management
  // ========================================
  function setStatus(state, text) {
    elements.statusBadge.className = `status-badge ${state}`;
    elements.statusText.textContent = text;
  }

  function showNotProductPage() {
    elements.notProductPage.classList.remove('d-none');
    elements.mainContent.classList.add('d-none');
    elements.errorMessage.classList.add('d-none');
    hideLoading();
    setStatus('idle', 'Bukan halaman produk');
  }

  function showError(message) {
    elements.errorMessage.classList.remove('d-none');
    elements.errorText.textContent = message;
    elements.mainContent.classList.remove('d-none');
  }

  function showMainContent() {
    elements.notProductPage.classList.add('d-none');
    elements.errorMessage.classList.add('d-none');
    elements.mainContent.classList.remove('d-none');
  }

  function showLoading(text) {
    elements.loadingOverlay.classList.remove('d-none');
    elements.loadingText.textContent = text || 'Memuat...';
    setStatus('loading', 'Memuat...');
  }

  function hideLoading() {
    elements.loadingOverlay.classList.add('d-none');
  }

  function showExportStatus(message, type) {
    elements.exportStatus.classList.remove('d-none');
    elements.exportStatus.innerHTML = message;
    elements.exportStatus.className = `export-status ${type}`;

    setTimeout(() => {
      elements.exportStatus.classList.add('d-none');
    }, 5000);
  }

  // ========================================
  // Helper functions
  // ========================================
  function formatRupiah(num) {
    if (!num && num !== 0) return '-';
    return 'Rp' + num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }

  function formatNumber(num) {
    if (!num && num !== 0) return '0';
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'JT';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'RB';
    return num.toString();
  }

  function escapeHTML(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function isShopeeProductURL(url) {
    if (!url) return false;
    return /shopee\.co\.id\/.+-i\.\d+\.\d+/.test(url);
  }

  function extractProductSlug(url) {
    if (!url) return '';
    const match = url.match(/i\.(\d+\.\d+)/);
    return match ? match[1] : '';
  }

  async function getActiveTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0] || null;
  }

  function sendMessageToTab(tabId, message) {
    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      });
    });
  }

  function getFromStorage(key) {
    return new Promise((resolve) => {
      chrome.storage.local.get(key, (result) => {
        resolve(result[key] || null);
      });
    });
  }

  // ========================================
  // Listener untuk update data real-time
  // ========================================
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'REFRESH_POPUP' && message.data) {
      console.log('[Popup] Menerima update data real-time');
      processRawData(message.data);
    }
  });

  // ========================================
  // Jalankan inisialisasi
  // ========================================
  init();

})();
