/**
 * service-worker.js
 * ==================
 * Background service worker untuk Chrome Extension MV3.
 * Menangani:
 * - Komunikasi antara content script dan popup
 * - Google Sheets OAuth
 * - Penyimpanan data
 */

// ========================================
// Listener untuk pesan dari content script dan popup
// ========================================
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  // ── Forward pesan dari panel ke injector dalam tab yang sama ──
  if (message.action === 'PANEL_FORWARD_TO_TAB') {
    const tabId = sender?.tab?.id;
    if (!tabId) {
      sendResponse({ error: 'Tab tidak ditemukan' });
      return;
    }
    chrome.tabs.sendMessage(tabId, message.payload, (resp) => {
      if (chrome.runtime.lastError) {
        sendResponse({ error: chrome.runtime.lastError.message });
      } else {
        sendResponse(resp || { ok: true });
      }
    });
    return true; // async
  }

  if (message.action === 'DATA_UPDATED') {
    console.log('[Service Worker] Data produk diupdate');
    chrome.runtime.sendMessage({
      action: 'REFRESH_POPUP',
      data: message.data
    }).catch(() => {});
    return;
  }

  if (message.action === 'EXPORT_GOOGLE_SHEETS') {
    handleGoogleSheetsExport(message.data)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }

  if (message.action === 'GET_GOOGLE_TOKEN') {
    chrome.identity.getAuthToken({ interactive: true }, (token) => {
      if (chrome.runtime.lastError) {
        sendResponse({ error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ token: token });
      }
    });
    return true;
  }

  if (message.action === 'GOOGLE_LOGOUT') {
    chrome.identity.getAuthToken({ interactive: false }, (token) => {
      if (token) {
        chrome.identity.removeCachedAuthToken({ token: token }, () => {
          sendResponse({ success: true });
        });
      } else {
        sendResponse({ success: true });
      }
    });
    return true;
  }
});

/**
 * Handle export ke Google Sheets dari service worker
 */
async function handleGoogleSheetsExport(data) {
  try {
    const token = await new Promise((resolve, reject) => {
      chrome.identity.getAuthToken({ interactive: true }, (token) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(token);
        }
      });
    });

    if (!token) throw new Error('Token Google tidak tersedia');

    const savedId = await new Promise((resolve) => {
      chrome.storage.local.get('shopeeSpreadsheetId', (result) => {
        resolve(result.shopeeSpreadsheetId || null);
      });
    });

    let spreadsheetId = savedId;
    const dateStr = getDateString();

    if (spreadsheetId) {
      try {
        await appendToExistingSheet(token, spreadsheetId, data, dateStr);
        return { url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}` };
      } catch (e) {
        console.warn('[Service Worker] Append gagal, buat baru...');
        spreadsheetId = null;
      }
    }

    spreadsheetId = await createNewSpreadsheet(token, data, dateStr);

    await new Promise((resolve) => {
      chrome.storage.local.set({ shopeeSpreadsheetId: spreadsheetId }, resolve);
    });

    return { url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}` };

  } catch (e) {
    console.error('[Service Worker] Google Sheets export gagal:', e);
    throw e;
  }
}

async function createNewSpreadsheet(token, data, dateStr) {
  const title = `Shopee Scraper - ${dateStr}`;

  const createResp = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      properties: { title },
      sheets: [
        { properties: { title: 'Product Info' } },
        { properties: { title: 'Shop Info' } },
        { properties: { title: 'Trend' } },
        { properties: { title: 'Variants' } },
        { properties: { title: 'Negative Reviews' } }
      ]
    })
  });

  if (!createResp.ok) throw new Error('Gagal membuat spreadsheet');

  const spreadsheet = await createResp.json();
  const id = spreadsheet.spreadsheetId;

  await writeToSheet(token, id, 'Product Info', buildProductRows(data));
  await writeToSheet(token, id, 'Shop Info', buildShopRows(data));
  await writeToSheet(token, id, 'Trend', buildTrendRows(data));
  await writeToSheet(token, id, 'Variants', buildVariantRows(data));
  await writeToSheet(token, id, 'Negative Reviews', buildReviewRows(data));

  return id;
}

async function appendToExistingSheet(token, spreadsheetId, data, dateStr) {
  const prefix = `Scrape ${dateStr}`;

  const batchResp = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      requests: [
        { addSheet: { properties: { title: `${prefix} - Product` } } },
        { addSheet: { properties: { title: `${prefix} - Shop` } } },
        { addSheet: { properties: { title: `${prefix} - Trend` } } },
        { addSheet: { properties: { title: `${prefix} - Variants` } } },
        { addSheet: { properties: { title: `${prefix} - Reviews` } } }
      ]
    })
  });

  if (!batchResp.ok) {
    const errText = await batchResp.text();
    throw new Error(`Gagal menambah sheet baru: ${errText}`);
  }

  await writeToSheet(token, spreadsheetId, `${prefix} - Product`, buildProductRows(data));
  await writeToSheet(token, spreadsheetId, `${prefix} - Shop`, buildShopRows(data));
  await writeToSheet(token, spreadsheetId, `${prefix} - Trend`, buildTrendRows(data));
  await writeToSheet(token, spreadsheetId, `${prefix} - Variants`, buildVariantRows(data));
  await writeToSheet(token, spreadsheetId, `${prefix} - Reviews`, buildReviewRows(data));
}

async function writeToSheet(token, spreadsheetId, sheetName, rows) {
  const range = `'${sheetName}'!A1`;

  const resp = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ range, majorDimension: 'ROWS', values: rows })
    }
  );

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Gagal menulis ke "${sheetName}": ${err}`);
  }
}

function buildProductRows(data) {
  return [
    ['Field', 'Value'],
    ['Nama Produk', data.product?.name || ''],
    ['Harga Min', data.product?.price_min || 0],
    ['Harga Max', data.product?.price_max || 0],
    ['Rating', data.product?.rating || 0],
    ['Total Terjual', data.product?.total_sold || 0],
    ['Jumlah Ulasan', data.product?.review_count || 0],
    ['URL', data.url || ''],
    ['Waktu Scraping', data.scraped_at || '']
  ];
}

function buildShopRows(data) {
  if (!data.shop) return [['Field', 'Value'], ['Data toko belum diambil', '-']];
  const s = data.shop;
  return [
    ['Field', 'Value'],
    ['Nama Toko', s.name || '-'],
    ['Lokasi', s.location || '-'],
    ['Followers', s.follower_count || 0],
    ['Jumlah Produk', s.product_count || 0],
    ['Rating Toko', s.rating_star || 0],
    ['Respon Rate (%)', s.response_rate !== null ? s.response_rate : '-'],
    ['Status', s.is_mall ? 'Mall' : s.is_preferred ? 'Preferred+' : 'Regular']
  ];
}

function buildTrendRows(data) {
  if (!data.trend) return [['Trend data not available', '']];
  return [
    ['Field', 'Value'],
    ['Omset / Bulan', data.trend.omset_per_month || 0],
    ['Omset 30 hari', data.trend.omset_30_days || 0],
    ['Terjual / Bulan', data.trend.sold_per_month || 0],
    ['Penjualan 30 hari', data.trend.sold_30_days || 0],
    ['Trend Percentage (%)', data.trend.trend_percentage || 0]
  ];
}

function buildVariantRows(data) {
  const rows = [['Tier 1', 'Tier 2', '% Terjual', 'Harga']];
  if (data.variants?.length > 0) {
    data.variants.forEach(v => {
      rows.push([v.tier1 || '-', v.tier2 || '-', `${v.sales_percentage || 0}%`, v.price || '-']);
    });
  } else {
    rows.push(['Tidak ada varian', '', '', '']);
  }
  return rows;
}

function buildReviewRows(data) {
  const rows = [['Bintang', 'Komentar', 'Tanggal', 'Username', 'Varian']];
  if (data.negative_reviews?.length > 0) {
    data.negative_reviews.forEach(r => {
      rows.push([r.stars, r.comment || '', r.date || '', r.user || '', r.variant || '-']);
    });
  } else {
    rows.push(['Tidak ada review negatif', '', '', '', '']);
  }
  return rows;
}

function getDateString() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}`;
}

// ========================================
// Listener install / update extension
// ========================================
chrome.runtime.onInstalled.addListener((details) => {
  console.log('[Shopee Scraper] Extension installed/updated:', details.reason);

  if (details.reason === 'install') {
    chrome.storage.local.set({
      shopeeScraperData: null,
      shopeeSpreadsheetId: null
    });
  }
});
