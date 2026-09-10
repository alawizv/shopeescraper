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
  let lastRawData = null; // data mentah terakhir, dipakai untuk render ulang saat filter berubah
  let currentStarFilter = [1, 2, 3, 4, 5]; // Default: semua bintang

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
    btnExportTSV: document.getElementById('btn-export-tsv'),
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

    // Star filter
    starFilterCbs: document.querySelectorAll('.star-filter-cb'),
    starFilterNote: document.getElementById('star-filter-note'),
    reviewFilterBadge: document.getElementById('review-filter-badge'),
    sampleWithText: document.getElementById('sample-with-text'),
  };

  // ========================================
  // Inisialisasi
  // ========================================
  async function init() {
    console.log('[Popup] Inisialisasi...');

    try {
      const ver = chrome.runtime.getManifest()?.version;
      const verEl = document.getElementById('popup-version');
      if (verEl && ver) verEl.textContent = 'v' + ver;
    } catch (e) {}

    // Load filter bintang yang tersimpan dari sesi sebelumnya
    await loadStarFilter();

    // Cek apakah ada update yang belum dijalankan
    checkUpdateBanner();

    setupEventListeners();
    updatePopupHistoryCount();

    const tab = await getActiveTab();

    if (!tab || !isShopeeProductURL(tab.url)) {
      showNotProductPage(tab ? tab.url : null);
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
      // Slug wajib tidak kosong: String.includes('') selalu true, sehingga slug
      // kosong akan membuat data produk LAIN ditampilkan sebagai halaman aktif.
      const savedSlug = extractProductSlug(storageData?.url);
      if (storageData && storageData.rawProduct && savedSlug && currentUrl.includes(savedSlug)) {
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

    // Listener perubahan checkbox filter bintang
    document.querySelectorAll('.star-filter-cb').forEach(cb => {
      cb.addEventListener('change', () => {
        currentStarFilter = getSelectedStarFilters();
        saveStarFilter(currentStarFilter);
        updateStarFilterNote(currentStarFilter);
        updateReviewFilterBadge(currentStarFilter);

        // Bangun ulang data dengan filter baru. Tanpa ini, tombol export masih
        // memakai currentData hasil filter LAMA sampai user scrape ulang.
        if (lastRawData) processRawData(lastRawData);
      });
    });

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

    if (elements.btnExportTSV) {
      elements.btnExportTSV.addEventListener('click', async () => {
        if (!currentData) {
          showExportStatus('Tidak ada data untuk diekspor', 'error');
          return;
        }
        const tsvString = buildTSV(currentData);
        try {
          await navigator.clipboard.writeText(tsvString);
          showExportStatus('✅ Data tersalin! Buka Google Sheets atau Excel → Ctrl+V', 'success');
          elements.btnExportTSV.textContent = '✅ Tersalin!';
          setTimeout(() => { elements.btnExportTSV.textContent = '📋 Salin ke Sheets'; }, 2500);
        } catch (e) {
          // Fallback: unduh file .tsv
          const blob = new Blob([tsvString], { type: 'text/plain;charset=utf-8;' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url; a.download = `shopee_${Date.now()}.tsv`;
          document.body.appendChild(a); a.click(); a.remove();
          URL.revokeObjectURL(url);
          showExportStatus('⬇️ File TSV diunduh (clipboard tidak tersedia)', 'info');
        }
      });
    }

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

    // ── Tab Navigasi Popup (Produk Aktif vs Riwayat) ──
    const tabActive = document.getElementById('popup-tab-active');
    const tabHistory = document.getElementById('popup-tab-history');
    const viewActive = document.getElementById('view-active-product');
    const viewHistory = document.getElementById('view-history');

    if (tabActive && tabHistory) {
      tabActive.addEventListener('click', () => {
        tabActive.classList.add('active');
        tabHistory.classList.remove('active');
        if (viewActive) viewActive.classList.remove('d-none');
        if (viewHistory) viewHistory.classList.add('d-none');
      });

      tabHistory.addEventListener('click', () => {
        tabHistory.classList.add('active');
        tabActive.classList.remove('active');
        if (viewHistory) viewHistory.classList.remove('d-none');
        if (viewActive) viewActive.classList.add('d-none');
        renderPopupHistory();
      });
    }

    // ── Pencarian Riwayat di Popup ──
    const searchHistory = document.getElementById('popup-history-search');
    if (searchHistory) {
      searchHistory.addEventListener('input', (e) => {
        renderPopupHistory(e.target.value);
      });
    }

    // ── Salin Semua Riwayat (TSV) di Popup ──
    const btnPopHistTSV = document.getElementById('btn-popup-hist-tsv');
    if (btnPopHistTSV) {
      btnPopHistTSV.addEventListener('click', async () => {
        if (typeof ShopeeDB === 'undefined') return;
        const list = await ShopeeDB.getAll();
        if (!list || list.length === 0) {
          showExportStatus('Belum ada riwayat produk untuk disalin', 'error');
          return;
        }
        const tsv = ShopeeDB.buildBulkTSV(list);
        try {
          await navigator.clipboard.writeText(tsv);
          btnPopHistTSV.textContent = '✅ Tersalin!';
          setTimeout(() => { btnPopHistTSV.textContent = '📋 Salin Semua'; }, 2500);
        } catch(e) {
          const blob = new Blob([tsv], { type: 'text/plain;charset=utf-8;' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url; a.download = `riwayat_shopee_${Date.now()}.tsv`;
          document.body.appendChild(a); a.click(); a.remove();
          URL.revokeObjectURL(url);
        }
      });
    }

    // ── Unduh CSV Semua Riwayat di Popup ──
    const btnPopHistCSV = document.getElementById('btn-popup-hist-csv');
    if (btnPopHistCSV) {
      btnPopHistCSV.addEventListener('click', async () => {
        if (typeof ShopeeDB === 'undefined') return;
        const list = await ShopeeDB.getAll();
        if (!list || list.length === 0) {
          showExportStatus('Belum ada riwayat produk untuk diekspor', 'error');
          return;
        }
        const csv = ShopeeDB.buildBulkCSV(list);
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `riwayat_shopee_${Date.now()}.csv`;
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(url);
      });
    }

    // ── Hapus Semua Riwayat di Popup ──
    const btnPopHistClear = document.getElementById('btn-popup-hist-clear');
    if (btnPopHistClear) {
      btnPopHistClear.addEventListener('click', async () => {
        if (typeof ShopeeDB === 'undefined') return;
        if (confirm('Yakin ingin menghapus SELURUH riwayat produk?')) {
          await ShopeeDB.clear();
          renderPopupHistory();
          updatePopupHistoryCount();
        }
      });
    }

    // ── Salin TSV Bulk Search di Popup ──
    const btnPopupBulkTSV = document.getElementById('btn-popup-bulk-tsv');
    if (btnPopupBulkTSV) {
      btnPopupBulkTSV.addEventListener('click', async () => {
        if (!cachedBulkData || !cachedBulkData.products || cachedBulkData.products.length === 0) return;
        const tsv = buildBulkSearchTSV(cachedBulkData.products);
        try {
          await navigator.clipboard.writeText(tsv);
          btnPopupBulkTSV.textContent = '✅ Tersalin!';
        } catch (e) {
          const blob = new Blob([tsv], { type: 'text/plain;charset=utf-8;' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url; a.download = `shopee_bulk_${Date.now()}.tsv`;
          document.body.appendChild(a); a.click(); a.remove();
          URL.revokeObjectURL(url);
          btnPopupBulkTSV.textContent = '⬇️ Diunduh (.tsv)';
        }
        setTimeout(() => {
          btnPopupBulkTSV.textContent = '📋 Salin ke Sheets (TSV)';
        }, 2500);
      });
    }

    // ── Simpan Bulk Search ke Riwayat di Popup ──
    const btnPopupBulkSave = document.getElementById('btn-popup-bulk-save');
    if (btnPopupBulkSave) {
      btnPopupBulkSave.addEventListener('click', async () => {
        if (!cachedBulkData || !cachedBulkData.products || cachedBulkData.products.length === 0) return;
        btnPopupBulkSave.disabled = true;
        btnPopupBulkSave.textContent = 'Menyimpan...';
        const count = await ShopeeDB.saveBulkProducts(cachedBulkData.products);
        btnPopupBulkSave.textContent = `✅ ${count} Tersimpan!`;
        updatePopupHistoryCount();
        setTimeout(() => {
          btnPopupBulkSave.disabled = false;
          btnPopupBulkSave.textContent = '📥 Simpan ke Riwayat';
        }, 2500);
      });
    }
  }


  // ========================================
  // Proses data mentah
  // ========================================
  function processRawData(rawData) {
    try {
      console.log('[Popup] Memproses data mentah...');

      lastRawData = rawData; // disimpan agar filter bintang bisa render ulang tanpa scrape
      parsedProduct = ShopeeParser.parseProduct(rawData.rawProduct);

      if (!parsedProduct) {
        hideLoading();
        setStatus('error', 'Parse gagal');
        showError('Gagal mengolah data produk. Coba refresh halaman.');
        return;
      }

      // parseNegativeReviews sekarang menerima starFilter sebagai parameter ketiga
      const parsedReviews = ShopeeParser.parseNegativeReviews(rawData.rawReviews || [], parsedProduct?.variants || [], currentStarFilter);

      currentData = ShopeeParser.buildOutput(
        parsedProduct,
        parsedReviews,
        rawData.url || '',
        rawData.rawShop || null,
        rawData.monthlySoldFromSearch || null,
        currentStarFilter
      );

      renderProduct(parsedProduct);
      renderReviewSample(currentData.review_sample || null);
      renderMonthlySales(parsedProduct, rawData);
      renderShopInfo(currentData.shop || null);
      renderVariants(currentData.variants || [], currentData.tierSummaries || []);
      renderReviewList(currentData.filtered_reviews || currentData.negative_reviews || []);
      renderReviewInsights(currentData.review_insights || null);

      const source = rawData.dataSource === 'api' ? 'API' : rawData.dataSource === 'api+dom' ? 'API+DOM' : 'DOM';
      setStatus('success', `Data dari ${source}`);

      hideLoading();
      showMainContent();

      // Simpan otomatis ke database lokal (IndexedDB)
      if (typeof ShopeeDB !== 'undefined' && currentData?.product?.name) {
        ShopeeDB.saveProduct(currentData).then(() => {
          updatePopupHistoryCount();
        }).catch(err => console.warn('[Popup] Gagal simpan ke IndexedDB:', err));
      }

    } catch (e) {
      console.error('[Popup] Error processing data:', e);
      hideLoading();
      setStatus('error', 'Error');
      showError('Terjadi error saat memproses data: ' + e.message);
    }
  }

  // ========================================
  // Riwayat Produk (IndexedDB)
  // ========================================

  /**
   * Update badge hitungan riwayat di header tab popup
   */
  async function updatePopupHistoryCount() {
    if (typeof ShopeeDB === 'undefined') return;
    try {
      const list = await ShopeeDB.getAll();
      const badge = document.getElementById('popup-history-count');
      if (badge) badge.textContent = list ? list.length : 0;
    } catch (e) {}
  }

  /**
   * Render daftar riwayat produk ke dalam popup
   */
  async function renderPopupHistory(filterKeyword = '') {
    if (typeof ShopeeDB === 'undefined') return;
    const listEl = document.getElementById('popup-history-list');
    const emptyEl = document.getElementById('popup-history-empty');
    if (!listEl || !emptyEl) return;

    listEl.innerHTML = '<div style="text-align:center; padding:20px; color:#888;">Memuat riwayat...</div>';

    try {
      let list = await ShopeeDB.getAll();
      updatePopupHistoryCount();

      if (filterKeyword && filterKeyword.trim()) {
        const kw = filterKeyword.toLowerCase().trim();
        list = list.filter(item =>
          (item.name || '').toLowerCase().includes(kw) ||
          (item.shop_name || '').toLowerCase().includes(kw)
        );
      }

      if (!list || list.length === 0) {
        listEl.innerHTML = '';
        emptyEl.classList.remove('d-none');
        return;
      }

      emptyEl.classList.add('d-none');
      let html = '';

      list.forEach(item => {
        const pmin = item.price_min || 0;
        const pmax = item.price_max || 0;
        const priceText = (pmax && pmax !== pmin)
          ? `${formatRupiah(pmin)} - ${formatRupiah(pmax)}`
          : formatRupiah(pmin);

        const timeStr = item.scraped_at ? new Date(item.scraped_at).toLocaleString('id-ID', {
          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
        }) : '-';

        const isEst = item.monthly_sold_source === 'ESTIMATED' || String(item.sold_per_month_source || '').toLowerCase().includes('ulasan');
        const soldDisplay = item.monthly_sold > 0
          ? `${formatNumber(item.monthly_sold)}${isEst ? ' (est)' : ''}`
          : '-';

        html += `
          <div class="history-card">
            <div class="history-card-title" title="${escapeHTML(item.name)}">${escapeHTML(item.name)}</div>
            <div class="history-card-meta">
              <span class="history-card-price">${priceText}</span>
              <span>⭐ ${item.rating || 0} • ${formatNumber(item.total_sold)} terjual</span>
            </div>
            <div class="history-card-stats">
              <div><b>Terjual/bln:</b> ${soldDisplay}</div>
              <div><b>Omset Quick:</b> ${item.omset_quick ? formatRupiah(item.omset_quick) : '-'}</div>
            </div>
            <div class="history-card-footer">
              <span>🏪 ${escapeHTML(item.shop_name || '-')} • ${timeStr}</span>
              <div class="history-card-actions">
                <button class="btn-mini load" data-action="popup-view" data-id="${escapeHTML(item.id)}" title="Buka detail produk ini">👁️ Buka</button>
                ${item.url ? `<a href="${escapeHTML(item.url)}" target="_blank" class="btn-mini" title="Buka di tab baru">🔗 Link</a>` : ''}
                <button class="btn-mini delete" data-action="popup-delete" data-id="${escapeHTML(item.id)}" title="Hapus">✕</button>
              </div>
            </div>
          </div>
        `;
      });

      listEl.innerHTML = html;

      // Event listener tombol pada item riwayat di popup
      listEl.querySelectorAll('[data-action="popup-view"]').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const id = btn.getAttribute('data-id');
          const record = await ShopeeDB.get(id);
          if (record && record.output) {
            currentData = record.output;
            parsedProduct = record.output.product;

            // Buka tab produk aktif
            const tabActive = document.getElementById('popup-tab-active');
            const tabHistory = document.getElementById('popup-tab-history');
            const viewActive = document.getElementById('view-active-product');
            const viewHistory = document.getElementById('view-history');

            if (tabActive) tabActive.classList.add('active');
            if (tabHistory) tabHistory.classList.remove('active');
            if (viewActive) viewActive.classList.remove('d-none');
            if (viewHistory) viewHistory.classList.add('d-none');

            // Pastikan not-product-page disembunyikan dan main content ditampilkan
            const notProd = document.getElementById('not-product-page');
            if (notProd) notProd.classList.add('d-none');

            renderProduct(currentData.product);
            renderReviewSample(currentData.review_sample || null);
            renderMonthlySales(currentData.product, { monthlySoldFromSearch: currentData.monthly_sold?.value });
            renderShopInfo(currentData.shop || null);
            renderVariants(currentData.variants || [], currentData.tierSummaries || []);
            renderReviewList(currentData.filtered_reviews || currentData.negative_reviews || []);

            hideLoading();
            showMainContent();
            setStatus('success', 'Riwayat 💾');
          }
        });
      });

      listEl.querySelectorAll('[data-action="popup-delete"]').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const id = btn.getAttribute('data-id');
          await ShopeeDB.delete(id);
          renderPopupHistory(filterKeyword);
        });
      });

    } catch (e) {
      console.error('Gagal render riwayat popup:', e);
      listEl.innerHTML = `<div style="text-align:center; color:#ff4d4f; padding:20px;">Gagal: ${e.message}</div>`;
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
    
    // Tampilkan jumlah review yang memiliki teks (filtered_reviews dari output)
    const reviewWithTextCount = currentData?.filtered_reviews?.length || currentData?.negative_reviews?.length || 0;
    if (elements.sampleWithText) elements.sampleWithText.textContent = formatNumber(reviewWithTextCount);
    
    // Update badge filter
    updateReviewFilterBadge(currentStarFilter);
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

    // Urutkan varian dari % terjual terbesar ke terkecil (descending)
    const sortedVariants = [...variants].sort((a, b) => (b.sales_percentage || 0) - (a.sales_percentage || 0));

    sortedVariants.forEach(v => {
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
   * Render data Terjual / Bulan + Estimasi Omset dengan confidence badge
   */
  function renderMonthlySales(product, rawData) {
    let monthlySold = 0;
    let sourceText = 'Belum tersedia';

    // Prioritas 1: sold_per_month_actual dari PDP API
    if (product && product.sold_per_month_actual > 0) {
      monthlySold = product.sold_per_month_actual;
      sourceText = '✅ PDP API (● Tinggi)';
    }
    // Prioritas 2: monthlySoldFromSearch dari Search API
    else if (rawData && rawData.monthlySoldFromSearch > 0) {
      monthlySold = rawData.monthlySoldFromSearch;
      sourceText = '✅ Search API (● Sedang)';
    }
    // Prioritas 3: Estimasi ulasan 30 hari dari engine omset
    else if (currentData?.omset?.sold_per_month > 0) {
      monthlySold = currentData.omset.sold_per_month;
      sourceText = '🟣 Estimasi dari Ulasan 30 Hari';
    }
    // Prioritas 4: Tidak ada data
    else {
      sourceText = '⚠️ Belum tersedia di PDP';
    }

    const isEst = sourceText.includes('Estimasi');
    if (elements.monthlySoldValue) {
      elements.monthlySoldValue.textContent = monthlySold > 0
        ? formatNumber(monthlySold) + (isEst ? ' / bln (est)' : ' / bulan')
        : '-';
    }
    if (elements.monthlySoldSource) {
      elements.monthlySoldSource.textContent = sourceText;
      elements.monthlySoldSource.className = monthlySold > 0
        ? 'data-source-badge active'
        : 'data-source-badge';
    }

    // ── Render estimasi omset di bawah monthly sold (jika elemen ada) ──
    const omset = currentData?.omset || {};
    const omsetQuickEl = document.getElementById('popup-omset-quick');
    const omsetDetailEl = document.getElementById('popup-omset-detail');
    const omsetQuickBadgeEl = document.getElementById('popup-omset-quick-badge');
    const omsetDetailBadgeEl = document.getElementById('popup-omset-detail-badge');

    if (omsetQuickEl) {
      if (omset.quick_value > 0) {
        omsetQuickEl.textContent = formatRupiah(omset.quick_value);
        const conf = getOmsetConfidence(omset.sold_per_month_source);
        if (omsetQuickBadgeEl) {
          omsetQuickBadgeEl.textContent = conf.label;
          omsetQuickBadgeEl.className = `data-source-badge omset-confidence-${conf.level}`;
        }
      } else {
        omsetQuickEl.textContent = '-';
        if (omsetQuickBadgeEl) { omsetQuickBadgeEl.textContent = 'belum ada data'; omsetQuickBadgeEl.className = 'data-source-badge'; }
      }
    }
    if (omsetDetailEl) {
      if (omset.detail_value > 0) {
        omsetDetailEl.textContent = formatRupiah(omset.detail_value);
        const detailConf = (omset.reviews_30d_with_price > 0) ? 'medium' : 'low';
        const detailLabel = (omset.reviews_30d_with_price > 0) ? '● Sedang — harga varian review' : '● Rendah — harga rata-rata × koreksi';
        if (omsetDetailBadgeEl) {
          omsetDetailBadgeEl.textContent = detailLabel;
          omsetDetailBadgeEl.className = `data-source-badge omset-confidence-${detailConf}`;
        }
      } else {
        omsetDetailEl.textContent = '-';
        if (omsetDetailBadgeEl) { omsetDetailBadgeEl.textContent = 'belum ada data'; omsetDetailBadgeEl.className = 'data-source-badge'; }
      }
    }
  }

  /**
   * Render daftar review yang lolos filter bintang
   */
  function renderReviewList(reviews) {
    const wrapper = document.getElementById('review-list-wrapper');
    const emptyText = document.getElementById('no-review-list');
    const tbody = document.getElementById('review-list-tbody');
    const countBadge = document.getElementById('review-list-count');
    const title = document.getElementById('review-list-title');
    if (!wrapper || !tbody) return;

    if (countBadge) countBadge.textContent = reviews.length;
    if (title) {
      title.textContent = (currentStarFilter.length === 5)
        ? '📋 Review Terfilter'
        : `📋 Review (${[...currentStarFilter].sort((a, b) => b - a).map(s => `${s}★`).join('+')})`;
    }

    if (!reviews.length) {
      if (emptyText) emptyText.classList.remove('d-none');
      wrapper.classList.add('d-none');
      tbody.innerHTML = '';
      return;
    }

    if (emptyText) emptyText.classList.add('d-none');
    wrapper.classList.remove('d-none');

    tbody.innerHTML = '';
    reviews.forEach(r => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="color:#ee4d2d; font-weight:700;">${escapeHTML(String(r.stars ?? '-'))}</td>
        <td style="font-size:10px;">${escapeHTML(r.user || '-')}<br><span style="color:#999; font-size:9px;">${escapeHTML(r.date || '')}</span></td>
        <td style="font-size:10px; line-height:1.35;">${escapeHTML(r.comment || '')}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  /**
   * Render Review Insights (Analisis Keluhan Pembeli)
   */
  function renderReviewInsights(insights) {
    const wrap = document.getElementById('insight-content-wrapper');
    const emptyText = document.getElementById('no-insight-text');
    const badge = document.getElementById('insight-badge');
    const rateEl = document.getElementById('popup-sentiment-rate');
    const barEl = document.getElementById('popup-sentiment-bar');
    const painPointsList = document.getElementById('popup-pain-points');
    const wordsCloud = document.getElementById('popup-complaint-words');

    if (!insights || insights.total_analyzed === 0 || (!insights.pain_points?.length && !insights.top_complaint_words?.length)) {
      if (emptyText) emptyText.classList.remove('d-none');
      if (wrap) wrap.classList.add('d-none');
      if (badge) badge.style.display = 'none';
      return;
    }

    if (emptyText) emptyText.classList.add('d-none');
    if (wrap) wrap.classList.remove('d-none');

    const totalComplaints = (insights.pain_points || []).reduce((sum, p) => sum + p.count, 0);
    if (badge) {
      badge.textContent = `${totalComplaints} Keluhan`;
      badge.style.display = 'inline';
    }

    if (rateEl && barEl) {
      const posRate = insights.sentiment?.positive_rate ?? 100;
      rateEl.textContent = `${posRate}% Positif | ${100 - posRate}% Keluhan`;
      barEl.style.width = `${posRate}%`;
    }

    if (painPointsList) {
      let html = '';
      (insights.pain_points || []).forEach(p => {
        html += `
          <div class="pain-point-item">
            <div class="pain-point-header">
              <span class="pain-point-label">${p.icon} ${escapeHTML(p.label)}</span>
              <span class="pain-point-count">${p.count}x (${p.percentage}%)</span>
            </div>
            ${p.sample ? `<div class="pain-point-sample">"${escapeHTML(p.sample)}"</div>` : ''}
          </div>
        `;
      });
      painPointsList.innerHTML = html;
    }

    if (wordsCloud) {
      let html = '';
      (insights.top_complaint_words || []).forEach(w => {
        html += `<span class="complaint-tag">#${escapeHTML(w.word)} (${w.count})</span>`;
      });
      wordsCloud.innerHTML = html || '<span style="color:#aaa; font-size:10px;">-</span>';
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

  let cachedBulkData = null;

  function loadBulkSearchData() {
    chrome.storage.local.get('shopeeBulkSearchData', (res) => {
      const data = res.shopeeBulkSearchData;
      renderBulkSearchPopup(data);
    });
  }

  function renderBulkSearchPopup(bulkData) {
    const statsEl = document.getElementById('bulk-popup-stats');
    const loadingEl = document.getElementById('bulk-popup-loading');
    const actionsEl = document.getElementById('bulk-popup-actions');
    const keywordEl = document.getElementById('bulk-popup-keyword');

    if (!bulkData || !bulkData.products || bulkData.products.length === 0) {
      if (statsEl) statsEl.classList.add('d-none');
      if (actionsEl) actionsEl.classList.add('d-none');
      if (loadingEl) loadingEl.classList.remove('d-none');
      return;
    }

    cachedBulkData = bulkData;

    if (loadingEl) loadingEl.classList.add('d-none');
    if (statsEl) statsEl.classList.remove('d-none');
    if (actionsEl) actionsEl.classList.remove('d-none');

    if (keywordEl) {
      keywordEl.textContent = `${bulkData.keyword || 'Pencarian Shopee'} (${bulkData.total_products} Produk)`;
    }

    const s = bulkData.stats || {};
    const omsetEl = document.getElementById('bulk-popup-omset');
    const soldEl = document.getElementById('bulk-popup-sold');
    const priceEl = document.getElementById('bulk-popup-price');
    const ratingEl = document.getElementById('bulk-popup-rating');

    if (omsetEl) omsetEl.textContent = formatRupiah(s.total_omset || 0);
    if (soldEl) soldEl.textContent = `${formatNumber(s.total_monthly_sold || 0)} terjual`;
    if (priceEl) priceEl.textContent = formatRupiah(s.avg_price || 0);
    if (ratingEl) ratingEl.textContent = `${s.avg_rating || 0} ⭐`;
  }

  function showNotProductPage(currentUrl) {
    elements.notProductPage.classList.remove('d-none');
    elements.mainContent.classList.add('d-none');
    elements.errorMessage.classList.add('d-none');
    hideLoading();

    const standardHint = document.getElementById('not-product-standard');
    const searchHint = document.getElementById('is-search-page-hint');

    if (currentUrl && (isShopeeSearchURL(currentUrl) || isShopeeShopURL(currentUrl))) {
      setStatus('active', 'Mode Riset Pasar');
      if (standardHint) standardHint.classList.add('d-none');
      if (searchHint) searchHint.classList.remove('d-none');
      loadBulkSearchData();
    } else {
      setStatus('idle', 'Bukan halaman produk');
      if (standardHint) standardHint.classList.remove('d-none');
      if (searchHint) searchHint.classList.add('d-none');
    }
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
  // Update Banner
  // ========================================

  /**
   * Tampilkan banner update jika ada versi baru yang terdeteksi service worker
   */
  function checkUpdateBanner() {
    chrome.storage.local.get('shopeeUpdateInfo', (res) => {
      if (res.shopeeUpdateInfo) {
        showUpdateBanner(res.shopeeUpdateInfo);
      }
    });
  }

  function showUpdateBanner(updateInfo) {
    const banner = document.getElementById('update-banner');
    const text   = document.getElementById('update-banner-text');
    if (!banner) return;
    if (text) text.textContent = `🎉 Update v${updateInfo.remoteVersion} tersedia! ${updateInfo.changelog || ''}`;
    banner.classList.remove('d-none');
  }

  // Dengarkan pesan live dari service worker (jika popup terbuka tepat saat cek update)
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'UPDATE_AVAILABLE') {
      showUpdateBanner(message.updateInfo);
    }
  });

  // ========================================
  // Helper functions
  // ========================================
  function getCurrencySymbol(url) {
    const h = (url || '').toLowerCase();
    if (h.includes('.co.id') || h.includes('shopee.id')) return 'Rp';
    if (h.includes('.co.th')) return '฿';
    if (h.includes('.sg')) return 'S$';
    if (h.includes('.com.my') || h.includes('.my')) return 'RM';
    if (h.includes('.ph')) return '₱';
    if (h.includes('.vn')) return '₫';
    if (h.includes('.tw')) return 'NT$';
    if (h.includes('.com.br') || h.includes('.br')) return 'R$';
    if (h.includes('.com.mx') || h.includes('.mx')) return 'MX$';
    if (h.includes('.com.co')) return 'COL$';
    if (h.includes('.cl')) return 'CL$';
    return 'Rp';
  }

  function formatRupiah(num) {
    if (!num && num !== 0) return '-';
    const sym = getCurrencySymbol(currentData?.url || '');
    return sym + ' ' + num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }

  function formatNumber(num) {
    if (!num && num !== 0) return '0';
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'JT';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'RB';
    return num.toString();
  }

  /**
   * Helper: tentukan confidence level untuk estimasi omset Quick
   */
  function getOmsetConfidence(source) {
    if (source === 'API')         return { level: 'high',   label: '● Tinggi — API resmi Shopee' };
    if (source === 'SEARCH_API')  return { level: 'medium', label: '● Sedang — Search API (cache)' };
    if (source === 'ESTIMATED')   return { level: 'low',    label: '● Rendah — Estimasi dari review' };
    return { level: 'none', label: 'Belum ada data' };
  }

  /**
   * Buat string TSV siap tempel ke Google Sheets / Excel
   * Dilengkapi Tabel Master 1 Baris di atas agar langsung bisa dicopy ke spreadsheet tracking riset!
   */
  function buildTSV(data) {
    const T = '\t';
    const N = '\n';
    const esc = (v) => String(v ?? '').replace(/[\t\r\n]+/g, ' ').trim();

    let tsv = '';

    const monthlySold = data.monthly_sold?.value || data.omset?.sold_per_month || 0;
    const isEstimated = !data.monthly_sold?.value && data.omset?.sold_per_month > 0;
    const soldDisplay = monthlySold > 0 ? (isEstimated ? `${monthlySold} (est)` : monthlySold) : '-';
    const omsetValue = data.omset?.quick_value || data.omset?.detail_value || 0;
    const shopStatus = data.shop?.is_mall ? 'Shopee Mall' : data.shop?.is_preferred ? 'Star+' : 'Regular';
    const topPain = data.review_insights?.pain_points?.[0]?.label || '-';

    // ── 1. RINGKASAN MASTER SHEET (1 Baris Siap Masuk ke Spreadsheet Riset) ──
    tsv += '=== 📊 MASTER TRACKING SHEET (1 BARIS PRODUK) ===' + N;
    tsv += [
      'Tanggal Scraping',
      'Nama Produk',
      'Toko',
      'Lokasi',
      'Status Toko',
      'Harga Min',
      'Harga Max',
      'Terjual / Bln',
      'Est. Omset / Bln',
      'Rating',
      'Total Review',
      'Total Terjual',
      'Top Keluhan',
      'URL Produk'
    ].join(T) + N;

    tsv += [
      esc(data.scraped_at ? data.scraped_at.split('T')[0] : new Date().toISOString().split('T')[0]),
      esc(data.product?.name),
      esc(data.shop?.name || '-'),
      esc(data.shop?.location || '-'),
      shopStatus,
      data.product?.price_min || 0,
      data.product?.price_max || 0,
      soldDisplay,
      omsetValue,
      data.product?.rating || 0,
      data.product?.review_count || 0,
      data.product?.total_sold || 0,
      esc(topPain),
      esc(data.url)
    ].join(T) + N + N;

    // ── 2. INFO DETAIL PRODUK & ESTIMASI OMSET (Key-Value) ─────────
    tsv += '=== ℹ️ DETAIL PRODUK & ESTIMASI OMSET ===' + N;
    tsv += 'Field' + T + 'Value' + N;
    tsv += 'Nama Produk'        + T + esc(data.product?.name)              + N;
    tsv += 'Harga Min'          + T + (data.product?.price_min || 0)       + N;
    tsv += 'Harga Max'          + T + (data.product?.price_max || 0)       + N;
    tsv += 'Rating'             + T + (data.product?.rating || 0)          + N;
    tsv += 'Total Terjual'      + T + (data.product?.total_sold || 0)      + N;
    tsv += 'Jumlah Ulasan'      + T + (data.product?.review_count || 0)    + N;
    tsv += 'Terjual / Bulan'    + T + soldDisplay                          + N;
    tsv += 'Sumber Sold/Bulan'  + T + esc(data.monthly_sold?.source || data.omset?.sold_per_month_source || '-') + N;
    tsv += 'Omset Quick'        + T + (data.omset?.quick_value || 0)       + N;
    tsv += 'Omset Detail'       + T + (data.omset?.detail_value || 0)      + N;
    tsv += 'Faktor Koreksi'     + T + (data.omset?.correction_factor || 0) + N;
    tsv += 'URL'                + T + esc(data.url)                        + N;
    tsv += 'Waktu Scraping'     + T + esc(data.scraped_at)                 + N;

    if (data.shop) {
      tsv += N + '=== 🏪 INFO TOKO ===' + N;
      tsv += 'Field' + T + 'Value' + N;
      tsv += 'Nama Toko'       + T + esc(data.shop.name)              + N;
      tsv += 'Lokasi'          + T + esc(data.shop.location)           + N;
      tsv += 'Pengikut'        + T + (data.shop.follower_count || 0)  + N;
      tsv += 'Jumlah Produk'   + T + (data.shop.product_count || 0)  + N;
      tsv += 'Rating Toko'     + T + (data.shop.rating_star || 0)    + N;
      tsv += 'Status'          + T + shopStatus                       + N;
    }

    if (data.variants?.length) {
      tsv += N + '=== 📦 VARIAN PRODUK ===' + N;
      tsv += 'Tier 1' + T + 'Tier 2' + T + '% Terjual' + T + 'Harga' + N;
      const sorted = [...data.variants].sort((a, b) => (b.sales_percentage || 0) - (a.sales_percentage || 0));
      sorted.forEach(v => {
        tsv += esc(v.tier1 || '-') + T + esc(v.tier2 || '-') + T + (v.sales_percentage || 0) + '%' + T + (v.price || '-') + N;
      });
    }

    if (data.review_insights && (data.review_insights.pain_points?.length || data.review_insights.top_complaint_words?.length)) {
      const ri = data.review_insights;
      tsv += N + '=== ⚠️ INSIGHT KELUHAN PEMBELI (PAIN POINTS) ===' + N;
      tsv += 'Kategori Keluhan' + T + 'Jumlah' + T + 'Persentase' + N;
      (ri.pain_points || []).forEach(p => {
        tsv += esc(p.label) + T + p.count + T + p.percentage + '%' + N;
      });
      if (ri.top_complaint_words?.length) {
        tsv += N + 'Top Kata Kunci Keluhan' + T + ri.top_complaint_words.map(w => `${w.word} (${w.count}x)`).join(', ') + N;
      }
    }

    const reviews = data.filtered_reviews || data.negative_reviews || [];
    if (reviews.length) {
      const filterLabel = data.star_filter_label ? ` (${data.star_filter_label})` : '';
      tsv += N + `=== 💬 DAFTAR ULASAN PEMBELI${filterLabel} ===` + N;
      tsv += 'Bintang' + T + 'Tanggal' + T + 'User' + T + 'Varian' + T + 'Komentar' + N;
      reviews.forEach(r => {
        tsv += (r.stars || '') + T + esc(r.date) + T + esc(r.user) + T + esc(r.variant || '-') + T + esc(r.comment) + N;
      });
    }

    return tsv;
  }

  function escapeHTML(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function isShopeeProductURL(url) {
    if (!url) return false;
    return /shopee\.[a-z.]+\/.+-i\.\d+\.\d+/.test(url) || /shopee\.[a-z.]+\/product\/\d+\/\d+/.test(url);
  }

  function isShopeeSearchURL(url) {
    if (!url) return false;
    return /shopee\.[a-z.]+\/search/.test(url);
  }

  function isShopeeShopURL(url) {
    const u = url || '';
    if (isShopeeProductURL(u) || isShopeeSearchURL(u)) return false;
    try {
      const urlObj = new URL(u);
      if (!urlObj.hostname.includes('shopee.')) return false;
      const p = urlObj.pathname.replace(/^\/|\/$/g, '');
      const reserved = ['cart', 'user', 'buyer', 'checkout', 'daily_discover', 'flash_sale', 'top_products', 'm', 'portal', 'api', 'help'];
      return p.length > 0 && !reserved.includes(p.split('/')[0]);
    } catch (e) {
      return false;
    }
  }

  function buildBulkSearchTSV(products) {
    const T = '\t';
    const N = '\n';
    const esc = (v) => String(v ?? '').replace(/\t/g, ' ').replace(/\n/g, ' ');

    let tsv = 'No' + T + 'Nama Produk' + T + 'Estimasi Omset/Bulan' + T + 'Terjual/Bulan' + T + 'Total Terjual' + T + 'Harga Min' + T + 'Harga Max' + T + 'Rating' + T + 'Lokasi' + T + 'Toko' + T + 'URL' + N;

    products.forEach((p, idx) => {
      tsv += (idx + 1) + T +
        esc(p.name) + T +
        (p.estimated_omset || 0) + T +
        (p.monthly_sold || 0) + T +
        (p.total_sold || 0) + T +
        (p.price_min || 0) + T +
        (p.price_max || 0) + T +
        (p.rating || 0) + T +
        esc(p.shop_location || '-') + T +
        esc(p.shop_name || '-') + T +
        esc(p.url || '') + N;
    });

    return tsv;
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
  // Star Filter Helper Functions
  // ========================================

  /**
   * Baca checkbox yang dipilih dan return array angka bintang
   */
  function getSelectedStarFilters() {
    const selected = [];
    document.querySelectorAll('.star-filter-cb:checked').forEach(cb => {
      selected.push(parseInt(cb.value, 10));
    });
    // Jika tidak ada yang dipilih, default semua bintang
    return selected.length > 0 ? selected : [1, 2, 3, 4, 5];
  }

  /**
   * Simpan filter bintang ke chrome.storage agar persistent
   */
  function saveStarFilter(starFilter) {
    chrome.storage.local.set({ shopeeStarFilter: starFilter }, () => {});
  }

  /**
   * Load filter bintang dari chrome.storage, apply ke checkbox
   */
  async function loadStarFilter() {
    return new Promise((resolve) => {
      chrome.storage.local.get('shopeeStarFilter', (result) => {
        const saved = result.shopeeStarFilter;
        if (saved && Array.isArray(saved) && saved.length > 0) {
          currentStarFilter = saved;
          // Apply ke checkbox
          document.querySelectorAll('.star-filter-cb').forEach(cb => {
            cb.checked = saved.includes(parseInt(cb.value, 10));
          });
        } else {
          currentStarFilter = [1, 2, 3, 4, 5];
        }
        updateStarFilterNote(currentStarFilter);
        updateReviewFilterBadge(currentStarFilter);
        resolve();
      });
    });
  }

  /**
   * Update teks catatan filter bintang
   */
  function updateStarFilterNote(starFilter) {
    const note = document.getElementById('star-filter-note');
    if (!note) return;
    
    if (starFilter.length === 5) {
      note.textContent = 'Semua bintang dipilih — semua review berteks akan dikumpulkan';
    } else {
      const sorted = [...starFilter].sort((a, b) => b - a);
      note.textContent = `Bintang ${sorted.join(', ')} dipilih — hanya review bintang tersebut yang masuk export`;
    }
  }

  /**
   * Update badge filter di section Sampel Review
   */
  function updateReviewFilterBadge(starFilter) {
    const badge = document.getElementById('review-filter-badge');
    if (!badge) return;
    
    if (starFilter.length === 5) {
      badge.style.display = 'none';
    } else {
      const sorted = [...starFilter].sort((a, b) => b - a);
      badge.textContent = sorted.map(s => `${s}★`).join(' ');
      badge.style.display = 'inline';
    }
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

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (changes.shopeeBulkSearchData) {
      renderBulkSearchPopup(changes.shopeeBulkSearchData.newValue);
    }
  });

  // ========================================
  // Jalankan inisialisasi
  // ========================================
  init();

})();
