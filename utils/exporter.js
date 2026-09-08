/**
 * exporter.js
 * =============
 * Modul untuk mengekspor data ke berbagai format:
 * - JSON (download file)
 * - CSV (download file)
 * - Google Sheets (via API)
 */

const ShopeeExporter = {

  /**
   * Download data sebagai file JSON
   */
  downloadJSON(data, filename = 'shopee-product') {
    const jsonString = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}_${this._getDateString()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  /**
   * Download data sebagai file CSV (multi-section dalam 1 file)
   */
  downloadCSV(data, filename = 'shopee-product') {
    let csvContent = '';

    csvContent += '=== INFO PRODUK ===\n';
    csvContent += 'Field,Value\n';
    csvContent += `Nama Produk,"${this._escapeCSV(data.product?.name || '')}"\n`;
    csvContent += `Harga Min,${data.product?.price_min || 0}\n`;
    csvContent += `Harga Max,${data.product?.price_max || 0}\n`;
    csvContent += `Rating,${data.product?.rating || 0}\n`;
    csvContent += `Total Terjual,${data.product?.total_sold || 0}\n`;
    csvContent += `Jumlah Ulasan,${data.product?.review_count || 0}\n`;
    csvContent += `Terjual / Bulan (API),${data.monthly_sold?.value || 0}\n`;
    csvContent += `URL,"${this._escapeCSV(data.url || '')}"\n`;
    csvContent += `Waktu Scraping,"${data.scraped_at || ''}"\n`;
    csvContent += '\n';

    if (data.shop) {
      csvContent += '=== INFO TOKO ===\n';
      csvContent += 'Field,Value\n';
      csvContent += `Nama Toko,"${this._escapeCSV(data.shop.name || '')}"\n`;
      csvContent += `Lokasi,"${this._escapeCSV(data.shop.location || '')}"\n`;
      csvContent += `Pengikut,${data.shop.follower_count || 0}\n`;
      csvContent += `Jumlah Produk,${data.shop.product_count || 0}\n`;
      csvContent += `Rating Toko,${data.shop.rating_star || 0}\n`;
      csvContent += `Status,"${data.shop.is_mall ? 'Mall' : data.shop.is_preferred ? 'Star+' : 'Regular'}"\n`;
      csvContent += '\n';
    }

    if (data.trend) {
      csvContent += '=== TREND 30 HARI ===\n';
      csvContent += 'Field,Value\n';
      csvContent += `Omset / Bulan,${data.trend.omset_per_month || 0}\n`;
      csvContent += `Omset 30 hari,${data.trend.omset_30_days || 0}\n`;
      csvContent += `Terjual / Bulan,${data.trend.sold_per_month || 0}\n`;
      csvContent += `Penjualan 30 hari,${data.trend.sold_30_days || 0}\n`;
      csvContent += `Trend Percentage,${data.trend.trend_percentage || 0}%\n`;
      csvContent += '\n';
    }

    csvContent += '=== VARIAN PRODUK ===\n';
    if (data.variants && data.variants.length > 0) {
      csvContent += 'Tier 1,Tier 2,% Terjual,Harga\n';
      // Urutkan dari % terjual terbesar ke terkecil (descending)
      const sortedVariants = [...data.variants].sort((a, b) => (b.sales_percentage || 0) - (a.sales_percentage || 0));
      sortedVariants.forEach(v => {
        csvContent += `"${this._escapeCSV(v.tier1 || '-')}","${this._escapeCSV(v.tier2 || '-')}",${v.sales_percentage || 0}%,${v.price || '-'}\n`;
      });
    } else {
      csvContent += 'Tidak ada varian\n';
    }
    csvContent += '\n';

    // Label section review dinamis sesuai filter bintang
    const reviewLabel = data.star_filter_label
      ? `=== REVIEW (${data.star_filter_label.toUpperCase()}) ===`
      : '=== REVIEW ==='; 
    const reviewData = data.filtered_reviews || data.negative_reviews || [];
    
    csvContent += reviewLabel + '\n';
    if (reviewData.length > 0) {
      csvContent += 'Bintang,Komentar,Tanggal,Username,Varian\n';
      reviewData.forEach(r => {
        csvContent += `${r.stars},"${this._escapeCSV(r.comment || '')}","${r.date || ''}","${this._escapeCSV(r.user || '')}","${this._escapeCSV(r.variant || '-')}"\n`;
      });
    } else {
      csvContent += 'Tidak ada review yang sesuai filter\n';
    }

    const BOM = '\uFEFF';
    const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}_${this._getDateString()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  /**
   * Export data ke Google Sheets
   */
  async exportToGoogleSheets(data) {
    const token = await this._getGoogleAuthToken();
    if (!token) {
      throw new Error('Gagal mendapatkan token Google. Pastikan sudah login.');
    }

    const savedSheet = await this._getSavedSpreadsheetId();
    let spreadsheetId = savedSheet;

    if (spreadsheetId) {
      try {
        await this._appendToSpreadsheet(token, spreadsheetId, data);
        return `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;
      } catch (e) {
        console.warn('[Shopee Exporter] Gagal append, membuat spreadsheet baru...', e);
        spreadsheetId = null;
      }
    }

    spreadsheetId = await this._createSpreadsheet(token, data);
    await this._saveSpreadsheetId(spreadsheetId);

    return `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;
  },

  /**
   * Dapatkan token OAuth2 dari Google via chrome.identity
   */
  _getGoogleAuthToken() {
    return new Promise((resolve) => {
      chrome.identity.getAuthToken({ interactive: true }, (token) => {
        if (chrome.runtime.lastError) {
          console.error('[Shopee Exporter] OAuth error:', chrome.runtime.lastError);
          resolve(null);
        } else {
          resolve(token);
        }
      });
    });
  },

  /**
   * Buat spreadsheet baru di Google Sheets
   */
  async _createSpreadsheet(token, data) {
    const dateStr = this._getDateString();
    const title = `Shopee Scraper - ${dateStr}`;

    const createResponse = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        properties: { title: title },
        sheets: [
          { properties: { title: 'Product Info' } },
          { properties: { title: 'Trend' } },
          { properties: { title: 'Variants' } },
          { properties: { title: data.star_filter_label_short ? `Reviews (${data.star_filter_label_short})` : 'Reviews' } }
        ]
      })
    });

    if (!createResponse.ok) {
      const errText = await createResponse.text();
      throw new Error(`Gagal membuat spreadsheet: ${errText}`);
    }

    const spreadsheet = await createResponse.json();
    const spreadsheetId = spreadsheet.spreadsheetId;

    await this._writeProductInfo(token, spreadsheetId, data);
    await this._writeSheetData(token, spreadsheetId, 'Trend', this._buildTrendRows(data));
    await this._writeVariants(token, spreadsheetId, data);
    await this._writeNegativeReviews(token, spreadsheetId, data, data.star_filter_label_short ? `Reviews (${data.star_filter_label_short})` : 'Reviews');

    return spreadsheetId;
  },

  /**
   * Append ke spreadsheet yang sudah ada
   */
  async _appendToSpreadsheet(token, spreadsheetId, data) {
    const dateStr = this._getDateString();
    const sheetTitle = `Scrape ${dateStr}`;

    const batchResp = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          requests: [
            { addSheet: { properties: { title: `${sheetTitle} - Product` } } },
            { addSheet: { properties: { title: `${sheetTitle} - Trend` } } },
            { addSheet: { properties: { title: `${sheetTitle} - Variants` } } },
            { addSheet: { properties: { title: `${sheetTitle} - Reviews` } } }
          ]
        })
      }
    );

    if (!batchResp.ok) {
      const errText = await batchResp.text();
      throw new Error(`Gagal menambah sheet baru: ${errText}`);
    }

    await this._writeSheetData(token, spreadsheetId, `${sheetTitle} - Product`, this._buildProductRows(data));
    await this._writeSheetData(token, spreadsheetId, `${sheetTitle} - Trend`, this._buildTrendRows(data));
    await this._writeSheetData(token, spreadsheetId, `${sheetTitle} - Variants`, this._buildVariantRows(data));
    const reviewSheetTitle = data.star_filter_label_short ? `${sheetTitle} - Reviews (${data.star_filter_label_short})` : `${sheetTitle} - Reviews`;
    await this._writeSheetData(token, spreadsheetId, reviewSheetTitle, this._buildReviewRows(data));
  },

  async _writeProductInfo(token, spreadsheetId, data) {
    await this._writeSheetData(token, spreadsheetId, 'Product Info', this._buildProductRows(data));
  },

  async _writeVariants(token, spreadsheetId, data) {
    await this._writeSheetData(token, spreadsheetId, 'Variants', this._buildVariantRows(data));
  },

  async _writeNegativeReviews(token, spreadsheetId, data, sheetName = 'Reviews') {
    await this._writeSheetData(token, spreadsheetId, sheetName, this._buildReviewRows(data));
  },

  _buildProductRows(data) {
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
  },

  _buildTrendRows(data) {
    if (!data.trend) return [['Trend data not available', '']];
    return [
      ['Field', 'Value'],
      ['Omset / Bulan', data.trend.omset_per_month || 0],
      ['Omset 30 hari', data.trend.omset_30_days || 0],
      ['Terjual / Bulan', data.trend.sold_per_month || 0],
      ['Penjualan 30 hari', data.trend.sold_30_days || 0],
      ['Trend Percentage (%)', data.trend.trend_percentage || 0]
    ];
  },

  _buildVariantRows(data) {
    const rows = [['Tier 1', 'Tier 2', '% Terjual', 'Harga']];
    if (data.variants && data.variants.length > 0) {
      // Urutkan dari % terjual terbesar ke terkecil (descending)
      const sortedVariants = [...data.variants].sort((a, b) => (b.sales_percentage || 0) - (a.sales_percentage || 0));
      sortedVariants.forEach(v => {
        rows.push([v.tier1 || '-', v.tier2 || '-', `${v.sales_percentage || 0}%`, v.price || '-']);
      });
    } else {
      rows.push(['Tidak ada varian', '', '', '']);
    }
    return rows;
  },

  _buildReviewRows(data) {
    // Label header dinamis berdasarkan filter bintang
    const headerLabel = data.star_filter_label
      ? `Bintang (Filter: ${data.star_filter_label})`
      : 'Bintang';
    
    const rows = [[headerLabel, 'Komentar', 'Tanggal', 'Username', 'Varian']];
    // Gunakan filtered_reviews (baru) dengan fallback ke negative_reviews (lama)
    const reviewData = data.filtered_reviews || data.negative_reviews || [];
    if (reviewData.length > 0) {
      reviewData.forEach(r => {
        rows.push([r.stars || 0, r.comment || '', r.date || '', r.user || '', r.variant || '-']);
      });
    } else {
      rows.push(['Tidak ada review yang sesuai filter', '', '', '', '']);
    }
    return rows;
  },

  async _writeSheetData(token, spreadsheetId, sheetName, rows) {
    const range = `'${sheetName}'!A1`;

    const response = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          range: range,
          majorDimension: 'ROWS',
          values: rows
        })
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error(`[Shopee Exporter] Gagal menulis ke sheet "${sheetName}":`, errText);
    }
  },

  async _saveSpreadsheetId(spreadsheetId) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ shopeeSpreadsheetId: spreadsheetId }, resolve);
    });
  },

  async _getSavedSpreadsheetId() {
    return new Promise((resolve) => {
      chrome.storage.local.get('shopeeSpreadsheetId', (result) => {
        resolve(result.shopeeSpreadsheetId || null);
      });
    });
  },

  _escapeCSV(str) {
    if (!str) return '';
    return str.replace(/"/g, '""').replace(/\n/g, ' ').replace(/\r/g, '');
  },

  _getDateString() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}`;
  }
};

if (typeof module !== 'undefined') {
  module.exports = ShopeeExporter;
}
