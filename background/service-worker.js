/**
 * service-worker.js
 * ==================
 * Background service worker untuk Chrome Extension MV3.
 * Menangani:
 * - Komunikasi antara content script dan popup
 * - Google Sheets OAuth
 * - Penyimpanan data lokal (IndexedDB)
 */

try {
  importScripts('../utils/db.js');
} catch (e) {
  console.error('[Service Worker] Gagal import db.js:', e);
}

// ========================================
// Listener untuk pesan dari content script dan popup
// ========================================
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  // ── Operasi Database Riwayat Produk (IndexedDB) ──
  if (message.action === 'DB_SAVE_PRODUCT') {
    if (typeof ShopeeDB !== 'undefined' && ShopeeDB._direct) {
      ShopeeDB._direct.save(message.record)
        .then(result => sendResponse({ ok: true, data: result }))
        .catch(err => sendResponse({ error: err.message }));
      return true;
    }
  }

  if (message.action === 'DB_GET_ALL') {
    if (typeof ShopeeDB !== 'undefined' && ShopeeDB._direct) {
      ShopeeDB._direct.getAll()
        .then(list => sendResponse({ ok: true, data: list }))
        .catch(err => sendResponse({ error: err.message }));
      return true;
    }
  }

  if (message.action === 'DB_GET_ONE') {
    if (typeof ShopeeDB !== 'undefined' && ShopeeDB._direct) {
      ShopeeDB._direct.get(message.id)
        .then(item => sendResponse({ ok: true, data: item }))
        .catch(err => sendResponse({ error: err.message }));
      return true;
    }
  }

  if (message.action === 'DB_DELETE') {
    if (typeof ShopeeDB !== 'undefined' && ShopeeDB._direct) {
      ShopeeDB._direct.delete(message.id)
        .then(() => sendResponse({ ok: true }))
        .catch(err => sendResponse({ error: err.message }));
      return true;
    }
  }

  if (message.action === 'DB_CLEAR') {
    if (typeof ShopeeDB !== 'undefined' && ShopeeDB._direct) {
      ShopeeDB._direct.clear()
        .then(() => sendResponse({ ok: true }))
        .catch(err => sendResponse({ error: err.message }));
      return true;
    }
  }

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
    assertOAuthConfigured();

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

/**
 * Pastikan client_id OAuth sudah diisi di manifest.
 * Tanpa ini, chrome.identity hanya melempar error generik yang membingungkan.
 */
function assertOAuthConfigured() {
  const clientId = chrome.runtime.getManifest()?.oauth2?.client_id || '';
  if (!clientId || clientId.startsWith('GANTI_DENGAN')) {
    throw new Error(
      'Client ID Google belum dikonfigurasi. Isi kolom "oauth2.client_id" di manifest.json ' +
      'dengan OAuth Client ID (tipe Chrome Extension) dari Google Cloud Console.'
    );
  }
}

/**
 * Jumlah baris grid yang perlu dipesan (sheet baru default 1000 baris dan
 * values.update tidak memperluas grid secara otomatis)
 */
function gridRowCount(neededRows) {
  return Math.max(1000, (neededRows || 0) + 50);
}

function reviewListOf(data) {
  return data.filtered_reviews || data.negative_reviews || [];
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
        { properties: { title: 'Variants', gridProperties: { rowCount: gridRowCount((data.variants || []).length + 1), columnCount: 26 } } },
        { properties: { title: 'Negative Reviews', gridProperties: { rowCount: gridRowCount(reviewListOf(data).length + 1), columnCount: 26 } } }
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
        { addSheet: { properties: { title: `${prefix} - Variants`, gridProperties: { rowCount: gridRowCount((data.variants || []).length + 1), columnCount: 26 } } } },
        { addSheet: { properties: { title: `${prefix} - Reviews`, gridProperties: { rowCount: gridRowCount(reviewListOf(data).length + 1), columnCount: 26 } } } }
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
    // RAW, bukan USER_ENTERED: komentar review yang diawali "=", "+", "-", atau "@"
    // akan dieksekusi sebagai formula spreadsheet kalau memakai USER_ENTERED.
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
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
    ['Terjual / Bulan', data.monthly_sold?.value || 0],
    ['Sumber Terjual / Bulan', data.monthly_sold?.source || '-'],
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
  // buildOutput() menghasilkan `omset` dan `monthly_sold`, bukan `trend`.
  // `data.trend` tetap didukung untuk data lama yang mungkin masih tersimpan.
  if (data.trend) {
    return [
      ['Field', 'Value'],
      ['Omset / Bulan', data.trend.omset_per_month || 0],
      ['Omset 30 hari', data.trend.omset_30_days || 0],
      ['Terjual / Bulan', data.trend.sold_per_month || 0],
      ['Penjualan 30 hari', data.trend.sold_30_days || 0],
      ['Trend Percentage (%)', data.trend.trend_percentage || 0]
    ];
  }

  const o = data.omset;
  const m = data.monthly_sold || {};
  if (!o) return [['Data omset belum tersedia', '']];

  return [
    ['Field', 'Value'],
    ['Omset / Bulan (Quick)', o.quick_value || 0],
    ['Omset 30 Hari (Detail)', o.detail_value || 0],
    ['Terjual / Bulan', o.sold_per_month || 0],
    ['Sumber Terjual / Bulan', o.sold_per_month_source || m.source || '-'],
    ['Harga Rata-rata', o.avg_price || 0],
    ['Review dalam 30 Hari', o.reviews_30d || 0],
    ['Review 30 Hari dengan Harga Varian', o.reviews_30d_with_price || 0],
    ['Omset dari Review (sebelum koreksi)', o.omset_from_reviews || 0],
    ['Faktor Koreksi', o.correction_factor || 0]
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
  // Gunakan filtered_reviews (baru) dengan fallback ke negative_reviews (lama)
  const reviewData = reviewListOf(data);
  if (reviewData.length > 0) {
    reviewData.forEach(r => {
      rows.push([r.stars ?? 0, r.comment || '', r.date || '', r.user || '', r.variant || '-']);
    });
  } else {
    rows.push(['Tidak ada review yang sesuai filter', '', '', '', '']);
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

  // Cek update segera setelah install/update, lalu jadwalkan tiap 24 jam
  checkForUpdate();
  chrome.alarms.create('shopeeScraperUpdateCheck', { periodInMinutes: 1440 }); // 24 jam
});

// Cek update saat browser/extension pertama kali aktif (startup)
chrome.runtime.onStartup.addListener(() => {
  checkForUpdate();
});

// Tangani alarm update
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'shopeeScraperUpdateCheck') {
    checkForUpdate();
  }
});

// ========================================
// Update Checker
// ========================================
const VERSION_URL = 'https://raw.githubusercontent.com/alawizv/shopeescraper/main/version.json';

/**
 * Bandingkan dua string versi semver (misal: "1.2.0" vs "1.1.0")
 * Return true jika remoteVersion lebih baru dari localVersion
 */
function isNewerVersion(localVersion, remoteVersion) {
  const local  = (localVersion  || '0.0.0').split('.').map(Number);
  const remote = (remoteVersion || '0.0.0').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((remote[i] || 0) > (local[i] || 0)) return true;
    if ((remote[i] || 0) < (local[i] || 0)) return false;
  }
  return false;
}

async function checkForUpdate() {
  try {
    const resp = await fetch(VERSION_URL + '?t=' + Date.now(), { cache: 'no-store' });
    if (!resp.ok) return;

    const data = await resp.json();
    const remoteVersion = data.version;
    const changelog     = data.changelog || '';
    const localVersion  = chrome.runtime.getManifest().version;

    console.log(`[Shopee Scraper] Versi lokal: ${localVersion} | Versi terbaru: ${remoteVersion}`);

    if (!isNewerVersion(localVersion, remoteVersion)) {
      // Sudah up-to-date — hapus flag update jika ada
      chrome.storage.local.remove('shopeeUpdateInfo');
      chrome.action.setBadgeText({ text: '' });
      return;
    }

    // Ada versi baru!
    const updateInfo = { remoteVersion, changelog, checkedAt: Date.now() };
    chrome.storage.local.set({ shopeeUpdateInfo: updateInfo });

    // Badge merah di icon extension
    chrome.action.setBadgeText({ text: 'NEW' });
    chrome.action.setBadgeBackgroundColor({ color: '#ee4d2d' });

    // Notifikasi Chrome (muncul di pojok kanan bawah layar)
    chrome.notifications.create('shopeeScraperUpdate', {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: '🛍️ Shopee Scraper — Update Tersedia!',
      message: `Versi ${remoteVersion} sudah tersedia (kamu: ${localVersion}).\n${changelog}`,
      buttons: [{ title: 'Cara Update' }],
      priority: 1
    });

    // Broadcast ke popup jika sedang terbuka
    chrome.runtime.sendMessage({
      action: 'UPDATE_AVAILABLE',
      updateInfo
    }).catch(() => {});

  } catch (e) {
    console.warn('[Shopee Scraper] Gagal cek update:', e.message);
  }
}

// Klik tombol "Cara Update" di notifikasi → buka halaman release GitHub
chrome.notifications.onButtonClicked.addListener((notifId, btnIdx) => {
  if (notifId === 'shopeeScraperUpdate' && btnIdx === 0) {
    chrome.tabs.create({ url: 'https://github.com/alawizv/shopeescraper#update' });
  }
});

