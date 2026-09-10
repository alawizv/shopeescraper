/**
 * panel.js
 * =========
 * Panel overlay yang muncul otomatis di halaman produk Shopee.
 * - Auto-open saat masuk halaman produk
 * - Auto-open ulang saat pindah ke produk lain (Shopee SPA)
 * - Bisa diminimize sementara, muncul lagi saat pindah produk
 * - Menggunakan Shadow DOM agar CSS tidak bentrok dengan Shopee
 */

/** Cek URL halaman produk Shopee */
function isShopeeProductPage(url) {
  return /shopee\.[a-z.]+\/.+-i\.\d+\.\d+/.test(url || location.href) || /shopee\.[a-z.]+\/product\/\d+\/\d+/.test(url || location.href);
}

/** Cek URL halaman pencarian Shopee */
function isShopeeSearchPage(url) {
  return /shopee\.[a-z.]+\/search/.test(url || location.href);
}

/** Cek URL halaman etalase toko Shopee */
function isShopeeShopPage(url) {
  const u = url || location.href;
  if (isShopeeProductPage(u) || isShopeeSearchPage(u)) return false;
  try {
    const urlObj = new URL(u);
    if (!urlObj.hostname.includes('shopee.')) return false;
    const p = urlObj.pathname.replace(/^\/|\/$/g, '');
    const reserved = ['cart', 'user', 'buyer', 'checkout', 'daily_discover', 'flash_sale', 'top_products', 'm', 'portal', 'api', 'help'];
    return p.length > 0 && !reserved.includes(p.split('/')[0]);
  } catch(e) {
    return false;
  }
}

/** Cek apakah halaman didukung oleh scraper (produk, search, atau toko) */
function isSupportedShopeePage(url) {
  const u = url || location.href;
  return isShopeeProductPage(u) || isShopeeSearchPage(u) || isShopeeShopPage(u);
}

function getCurrencySymbol(urlOrHost) {
  const h = (urlOrHost || location.href || '').toLowerCase();
  if (h.includes('.sg')) return 'S$';
  if (h.includes('.com.my') || h.includes('.my')) return 'RM';
  if (h.includes('.ph')) return '₱';
  if (h.includes('.co.th') || h.includes('.th')) return '฿';
  if (h.includes('.vn')) return '₫';
  if (h.includes('.tw')) return 'NT$';
  if (h.includes('.com.br') || h.includes('.br')) return 'R$';
  if (h.includes('.com.mx') || h.includes('.mx')) return 'MX$';
  if (h.includes('.com.co') || h.includes('.co')) return 'COL$';
  if (h.includes('.cl')) return 'CL$';
  return 'Rp';
}

function formatRupiah(num, urlOrHost) {
  if (num === null || num === undefined) return '-';
  const sym = getCurrencySymbol(urlOrHost);
  const n = Number(num) || 0;
  return sym + ' ' + n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function buildCSV(output) {
  let csv = '';

  csv += '=== INFO PRODUK ===\n';
  csv += 'Field,Value\n';
  csv += `Nama Produk,"${(output.product?.name || '').replace(/"/g, '""')}"\n`;
  csv += `Harga Min,${output.product?.price_min || 0}\n`;
  csv += `Harga Max,${output.product?.price_max || 0}\n`;
  csv += `Rating,${output.product?.rating || 0}\n`;
  csv += `Total Terjual,${output.product?.total_sold || 0}\n`;
  csv += `Jumlah Ulasan,${output.product?.review_count || 0}\n`;
  csv += `Terjual / Bulan (API),${output.monthly_sold?.value || 0}\n`;
  csv += `Omset/Bulan (Quick),${output.omset?.quick_value || 0}\n`;
  csv += `Omset 30 Hari (Detail),${output.omset?.detail_value || 0}\n`;
  csv += `Faktor Koreksi,${output.omset?.correction_factor || 0}\n`;
  csv += `URL,"${(output.url || '').replace(/"/g, '""')}"\n`;
  csv += `Waktu Scraping,"${output.scraped_at || ''}"\n\n`;

  if (output.shop) {
    csv += '=== INFO TOKO ===\n';
    csv += 'Field,Value\n';
    csv += `Nama Toko,"${(output.shop.name || '').replace(/"/g, '""')}"\n`;
    csv += `Lokasi,"${(output.shop.location || '').replace(/"/g, '""')}"\n`;
    csv += `Pengikut,${output.shop.follower_count || 0}\n`;
    csv += `Jumlah Produk,${output.shop.product_count || 0}\n`;
    csv += `Rating Toko,${output.shop.rating_star || 0}\n`;
    csv += `Status,"${output.shop.is_mall ? 'Mall' : output.shop.is_preferred ? 'Star+' : 'Regular'}"\n\n`;
  }

  csv += '=== VARIANTS ===\n';
  if (output.variants?.length) {
    csv += 'Tier 1,Tier 2,% Terjual,Harga\n';
    output.variants.forEach(v => {
      csv += `"${(v.tier1 || '-').replace(/"/g, '""')}","${(v.tier2 || '-').replace(/"/g, '""')}",${v.sales_percentage || 0}%,${v.price ?? ''}\n`;
    });
  } else {
    csv += 'Tidak ada varian\n';
  }
  csv += '\n';

  // Label section review dinamis
  const reviewLabel = output.star_filter_label
    ? `=== REVIEW (${output.star_filter_label.toUpperCase()}) ===`
    : '=== REVIEW ===';
  const reviewData = output.filtered_reviews || output.negative_reviews || [];

  csv += reviewLabel + '\n';
  if (reviewData.length) {
    csv += 'Stars,Date,User,Variant,Comment\n';
    reviewData.forEach(r => {
      csv += `${r.stars || ''},"${r.date || ''}","${(r.user || '').replace(/"/g, '""')}","${(r.variant || '-').replace(/"/g, '""')}","${(r.comment || '').replace(/"/g, '""').replace(/\n/g, ' ')}"\n`;
    });
  } else {
    csv += 'Tidak ada review yang sesuai filter\n';
  }

  if (output.review_insights && (output.review_insights.pain_points?.length || output.review_insights.top_complaint_words?.length)) {
    const ri = output.review_insights;
    csv += '\n=== INSIGHT KELUHAN PEMBELI ===\n';
    csv += 'Kategori Keluhan,Jumlah Terdeteksi,Persentase\n';
    (ri.pain_points || []).forEach(p => {
      csv += `"${(p.label || '').replace(/"/g, '""')}",${p.count},${p.percentage}%\n`;
    });
    if (ri.top_complaint_words?.length) {
      csv += `"Top Kata Kunci Keluhan","${ri.top_complaint_words.map(w => `${w.word} (${w.count}x)`).join(', ')}"\n`;
    }
  }

  return '\uFEFF' + csv; // BOM untuk Excel
}

/**
 * Buat string Tab-Separated Values (TSV) dari output.
 * Bisa langsung Ctrl+V ke Google Sheets / Excel tanpa instalasi apapun.
 */
function buildTSV(output) {
  const T = '\t'; // tab
  const N = '\n'; // newline
  const esc = (v) => String(v ?? '').replace(/\t/g, ' ').replace(/\n/g, ' ');

  let tsv = '';

  // ── Sheet 1: Info Produk ──────────────────────────────────────
  tsv += '=== INFO PRODUK ===' + N;
  tsv += 'Field' + T + 'Value' + N;
  tsv += 'Nama Produk'        + T + esc(output.product?.name)         + N;
  tsv += 'Harga Min'          + T + (output.product?.price_min || 0)  + N;
  tsv += 'Harga Max'          + T + (output.product?.price_max || 0)  + N;
  tsv += 'Rating'             + T + (output.product?.rating || 0)     + N;
  tsv += 'Total Terjual'      + T + (output.product?.total_sold || 0) + N;
  tsv += 'Jumlah Ulasan'      + T + (output.product?.review_count || 0) + N;
  tsv += 'Terjual / Bulan'    + T + (output.monthly_sold?.value || 0) + N;
  tsv += 'Sumber Sold/Bulan'  + T + esc(output.monthly_sold?.source)  + N;
  tsv += 'Omset Quick'        + T + (output.omset?.quick_value || 0)  + N;
  tsv += 'Omset Detail'       + T + (output.omset?.detail_value || 0) + N;
  tsv += 'Faktor Koreksi'     + T + (output.omset?.correction_factor || 0) + N;
  tsv += 'Sumber Quick'       + T + esc(output.omset?.sold_per_month_source) + N;
  tsv += 'URL'                + T + esc(output.url)                   + N;
  tsv += 'Waktu Scraping'     + T + esc(output.scraped_at)            + N;

  if (output.shop) {
    tsv += N + '=== INFO TOKO ===' + N;
    tsv += 'Field' + T + 'Value' + N;
    tsv += 'Nama Toko'       + T + esc(output.shop.name)            + N;
    tsv += 'Lokasi'          + T + esc(output.shop.location)         + N;
    tsv += 'Pengikut'        + T + (output.shop.follower_count || 0) + N;
    tsv += 'Jumlah Produk'   + T + (output.shop.product_count || 0) + N;
    tsv += 'Rating Toko'     + T + (output.shop.rating_star || 0)   + N;
    tsv += 'Status'          + T + (output.shop.is_mall ? 'Mall' : output.shop.is_preferred ? 'Star+' : 'Regular') + N;
  }

  if (output.variants?.length) {
    tsv += N + '=== VARIAN ===' + N;
    tsv += 'Tier 1' + T + 'Tier 2' + T + '% Terjual' + T + 'Harga' + N;
    const sortedV = [...output.variants].sort((a, b) => (b.sales_percentage || 0) - (a.sales_percentage || 0));
    sortedV.forEach(v => {
      tsv += esc(v.tier1 || '-') + T + esc(v.tier2 || '-') + T + (v.sales_percentage || 0) + '%' + T + (v.price || '-') + N;
    });
  }

  const reviewData = output.filtered_reviews || output.negative_reviews || [];
  if (reviewData.length) {
    const filterLabel = output.star_filter_label ? ` (${output.star_filter_label})` : '';
    tsv += N + `=== REVIEW${filterLabel} ===` + N;
    tsv += 'Bintang' + T + 'Tanggal' + T + 'User' + T + 'Varian' + T + 'Komentar' + N;
    reviewData.forEach(r => {
      tsv += (r.stars || '') + T + esc(r.date) + T + esc(r.user) + T + esc(r.variant || '-') + T + esc(r.comment) + N;
    });
  }

  if (output.review_insights && (output.review_insights.pain_points?.length || output.review_insights.top_complaint_words?.length)) {
    const ri = output.review_insights;
    tsv += N + '=== INSIGHT KELUHAN PEMBELI ===' + N;
    tsv += 'Kategori Keluhan' + T + 'Jumlah' + T + 'Persentase' + N;
    (ri.pain_points || []).forEach(p => {
      tsv += esc(p.label) + T + p.count + T + p.percentage + '%' + N;
    });
    if (ri.top_complaint_words?.length) {
      tsv += N + 'Top Kata Kunci Keluhan' + T + ri.top_complaint_words.map(w => `${w.word} (${w.count}x)`).join(', ') + N;
    }
  }

  return tsv;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.documentElement.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/**
 * Buat panel UI menggunakan Shadow DOM
 */
function createPanel() {
  const host = document.createElement('div');
  host.id = 'shopee-scraper-panel-host';
  host.style.position = 'fixed';
  host.style.top = '90px';
  host.style.right = '16px';
  host.style.zIndex = '2147483647';
  host.style.fontFamily = 'system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif';

  const shadow = host.attachShadow({ mode: 'open' });

  shadow.innerHTML = `
    <style>
      * { box-sizing: border-box; }

      .panel {
        width: 360px;
        max-height: 75vh;
        background: #fff;
        border: 1px solid #eee;
        box-shadow: 0 10px 30px rgba(0,0,0,.18);
        border-radius: 12px;
        overflow: hidden;
        display: flex;
        flex-direction: column;
      }

      .header {
        padding: 10px 12px;
        background: linear-gradient(135deg, #ee4d2d, #ff6633);
        color: #fff;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        flex-shrink: 0;
        cursor: default;
        user-select: none;
      }

      .title {
        font-weight: 800;
        font-size: 13px;
        letter-spacing: .2px;
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .badge {
        font-size: 10px;
        padding: 2px 8px;
        border-radius: 999px;
        background: rgba(255,255,255,.22);
        border: 1px solid rgba(255,255,255,.25);
        white-space: nowrap;
        font-weight: 700;
      }

      .badge.api  { background: rgba(76,175,80,.3); }
      .badge.dom  { background: rgba(255,193,7,.3); }
      .badge.loading { background: rgba(255,255,255,.15); animation: blink 1s infinite; }
      .badge.error   { background: rgba(244,67,54,.4); }

      @keyframes blink { 0%,100%{opacity:1} 50%{opacity:.4} }

      .btn-icon {
        background: rgba(255,255,255,.18);
        border: 1px solid rgba(255,255,255,.28);
        color: #fff;
        font-size: 11px;
        font-weight: 700;
        padding: 4px 8px;
        border-radius: 6px;
        cursor: pointer;
        transition: background .15s;
      }
      .btn-icon:hover { background: rgba(255,255,255,.35); }

      .body {
        padding: 10px 12px;
        overflow-y: auto;
        flex: 1;
      }

      .row { margin-bottom: 10px; }
      .label { font-size: 10px; color: #888; font-weight: 800; letter-spacing: .3px; text-transform: uppercase; }
      .value { font-size: 12px; color: #222; margin-top: 3px; line-height: 1.35; }

      .grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
        margin-top: 8px;
        margin-bottom: 10px;
      }

      .card {
        background: #fafafa;
        border: 1px solid #eee;
        border-radius: 10px;
        padding: 8px;
        text-align: center;
      }
      .card .k { font-size: 10px; color: #999; font-weight: 800; text-transform: uppercase; }
      .card .v { font-size: 14px; font-weight: 900; color: #ee4d2d; margin-top: 4px; }

      .monthly-sales-card {
        background: #fff8f0;
        border: 1px solid #ffccb3;
        grid-column: span 2;
      }
      .data-source-badge {
        display: inline-block;
        font-size: 9px;
        padding: 2px 6px;
        background: #ee4d2d;
        color: white;
        border-radius: 4px;
        margin-top: 4px;
      }
      .data-source-note {
        font-size: 9.5px;
        color: #777;
        background: #fdfdfd;
        border: 1px dashed #ccc;
        padding: 6px;
        border-radius: 5px;
        margin-top: 6px;
      }
      .data-source-note ul {
        margin: 4px 0 0 0;
        padding-left: 16px;
      }

      .actions {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
        margin-bottom: 12px;
      }

      .btn {
        border: 1px solid #e6e6e6;
        background: #fff;
        padding: 6px 10px;
        border-radius: 8px;
        cursor: pointer;
        font-weight: 700;
        font-size: 12px;
        transition: all .15s;
      }
      .btn:hover { border-color: #ee4d2d; color: #ee4d2d; }
      .btn.primary { background: #ee4d2d; border-color: #ee4d2d; color: #fff; }
      .btn.primary:hover { background: #d73d1e; }
      .btn:disabled { opacity: .55; cursor: not-allowed; transform: none; }

      /* Confidence badge untuk estimasi omset */
      .confidence-badge {
        display: inline-block;
        font-size: 9px;
        font-weight: 700;
        padding: 2px 7px;
        border-radius: 999px;
        margin-top: 4px;
        letter-spacing: .3px;
        text-transform: uppercase;
      }
      .confidence-badge.high   { background: #e8f5e9; color: #2e7d32; border: 1px solid #a5d6a7; }
      .confidence-badge.medium { background: #fff8e1; color: #f57f17; border: 1px solid #ffe082; }
      .confidence-badge.low    { background: #fce4ec; color: #c62828; border: 1px solid #ef9a9a; }
      .confidence-badge.none   { background: #f5f5f5; color: #9e9e9e; border: 1px solid #e0e0e0; }

      /* Tombol copy TSV */
      .btn.tsv { border-color: #1565c0; color: #1565c0; font-size: 11px; }
      .btn.tsv:hover { background: #e3f2fd; border-color: #0d47a1; color: #0d47a1; }

      /* Tab Navigasi */
      .nav-tabs {
        display: flex;
        background: #f8f8f8;
        border-bottom: 1px solid #eee;
        flex-shrink: 0;
      }
      .nav-tab {
        flex: 1;
        padding: 8px 10px;
        font-size: 11.5px;
        font-weight: 700;
        border: none;
        background: transparent;
        color: #777;
        cursor: pointer;
        transition: all .15s;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 5px;
        border-bottom: 2px solid transparent;
      }
      .nav-tab:hover { color: #ee4d2d; background: #fff; }
      .nav-tab.active {
        color: #ee4d2d;
        background: #fff;
        border-bottom-color: #ee4d2d;
      }
      .tab-badge {
        font-size: 9px;
        background: #eee;
        color: #555;
        padding: 1px 6px;
        border-radius: 999px;
        font-weight: 800;
      }
      .nav-tab.active .tab-badge {
        background: #ee4d2d;
        color: #fff;
      }

      /* History List & Cards */
      .history-actions {
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin-bottom: 10px;
      }
      .search-input {
        width: 100%;
        padding: 6px 10px;
        border: 1px solid #ddd;
        border-radius: 6px;
        font-size: 11px;
        box-sizing: border-box;
      }
      .search-input:focus {
        outline: none;
        border-color: #ee4d2d;
      }
      .history-btns {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
      }
      .btn.danger {
        border-color: #ffa39e;
        color: #cf1322;
      }
      .btn.danger:hover {
        background: #fff1f0;
        border-color: #ff4d4f;
      }
      .history-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
        max-height: 480px;
        overflow-y: auto;
      }
      .history-card {
        border: 1px solid #eee;
        border-radius: 8px;
        padding: 8px 10px;
        background: #fafafa;
        transition: all .15s;
      }
      .history-card:hover {
        border-color: #ffbb96;
        background: #fff8f0;
      }
      .history-card-title {
        font-size: 11.5px;
        font-weight: 700;
        color: #222;
        line-height: 1.35;
        margin-bottom: 4px;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }
      .history-card-meta {
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: 10px;
        color: #666;
        margin-bottom: 6px;
      }
      .history-card-price {
        font-weight: 800;
        color: #ee4d2d;
        font-size: 11px;
      }
      .history-card-stats {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 4px;
        font-size: 9.5px;
        color: #666;
        background: #fff;
        padding: 5px 6px;
        border-radius: 5px;
        border: 1px solid #f0f0f0;
        margin-bottom: 6px;
      }
      .history-card-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: 9px;
        color: #999;
      }
      .history-card-actions {
        display: flex;
        gap: 4px;
      }
      .btn-mini {
        padding: 3px 6px;
        font-size: 9.5px;
        font-weight: 700;
        border-radius: 4px;
        border: 1px solid #ddd;
        background: #fff;
        cursor: pointer;
        color: #333;
        text-decoration: none;
      }
      .btn-mini:hover {
        border-color: #ee4d2d;
        color: #ee4d2d;
      }
      .btn-mini.load {
        background: #fff0eb;
        border-color: #ffbb96;
        color: #d4380d;
      }
      .btn-mini.load:hover {
        background: #ee4d2d;
        color: #fff;
        border-color: #ee4d2d;
      }
      .btn-mini.delete:hover {
        border-color: #ff4d4f;
        color: #ff4d4f;
        background: #fff1f0;
      }

      /* Bulk Scraper Styles */
      .badge.search { background: #f9f0ff; color: #722ed1; border: 1px solid #d3adf7; }
      .bulk-thumb {
        width: 30px;
        height: 30px;
        object-fit: cover;
        border-radius: 4px;
        border: 1px solid #eee;
        flex-shrink: 0;
      }
      .bulk-prod-cell {
        display: flex;
        align-items: center;
        gap: 6px;
        max-width: 160px;
      }
      .bulk-prod-title {
        font-size: 10px;
        line-height: 1.25;
        font-weight: 600;
        color: #222;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }
      .bulk-rank {
        font-size: 9.5px;
        font-weight: 800;
        color: #888;
        text-align: center;
      }
      .bulk-rank.top3 {
        color: #ee4d2d;
      }

      .section-title {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-top: 12px;
        margin-bottom: 4px;
        font-weight: 900;
        color: #222;
        font-size: 12px;
        border-top: 1px solid #f0f0f0;
        padding-top: 10px;
      }

      table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 6px;
        font-size: 11px;
      }
      th, td {
        border-bottom: 1px solid #f0f0f0;
        padding: 5px 6px;
        text-align: left;
        vertical-align: top;
      }
      th { font-size: 10px; color: #777; text-transform: uppercase; letter-spacing: .3px; background: #fafafa; }
      tr:hover td { background: #fff8f0; }

      .muted { color: #aaa; font-size: 11px; margin-top: 8px; font-style: italic; }

      /* Mini button (saat panel ditutup) */
      .mini {
        display: none;
      }
      .mini button {
        background: linear-gradient(135deg, #ee4d2d, #ff6633);
        color: #fff;
        border: 0;
        padding: 10px 16px;
        border-radius: 999px;
        font-weight: 800;
        font-size: 12px;
        cursor: pointer;
        box-shadow: 0 6px 20px rgba(238,77,45,.4);
        transition: all .15s;
      }
      .mini button:hover { transform: translateY(-2px); box-shadow: 0 10px 28px rgba(238,77,45,.45); }
    </style>

    <!-- Panel Utama -->
    <div class="panel" id="panel">
      <div class="header" id="dragHandle">
        <div class="title">
          🛍️ Shopee Scraper
          <span class="badge" id="statusBadge">idle</span>
        </div>
        <div class="header-btns">
          <button class="btn-icon" id="btnClose">Tutup ✕</button>
        </div>
      </div>

      <!-- Tab Navigasi -->
      <div class="nav-tabs">
        <button class="nav-tab active" id="tabBtnActive">📦 Produk Aktif</button>
        <button class="nav-tab" id="tabBtnHistory">📜 Riwayat <span class="tab-badge" id="panelHistoryCount">0</span></button>
      </div>

      <div class="body" id="bodyActive">
        <!-- Aksi -->
        <div class="actions">
          <button class="btn primary" id="btnScrape">🔄 Scrape</button>
          <button class="btn" id="btnStop" style="display:none; background:#ff4d4f;">🛑 Stop</button>
          <button class="btn" id="btnFetchExtra" style="border-color:#1890ff; color:#1890ff;">⚡ Info Terjual & Toko</button>
          <button class="btn" id="btnJSON">📄 JSON</button>
          <button class="btn" id="btnCSV">📊 CSV</button>
          <button class="btn tsv" id="btnTSV" title="Salin data dalam format Tab-Separated (TSV) — langsung Ctrl+V ke Google Sheets atau Excel">📋 Salin ke Sheets</button>
        </div>

        <!-- Nama Produk -->
        <div class="row">
          <div class="label">Nama Produk</div>
          <div class="value" id="name">—</div>
        </div>

        <!-- Grid stats -->
        <div class="grid">
          <div class="card"><div class="k">Harga</div><div class="v" id="price">—</div></div>
          <div class="card"><div class="k">Rating ⭐</div><div class="v" id="rating">—</div></div>
          <div class="card"><div class="k">Terjual</div><div class="v" id="sold">—</div></div>
          <div class="card"><div class="k">Ulasan</div><div class="v" id="rcount">—</div></div>
        </div>

        <!-- Sampel Review -->
        <div class="section-title"><span>📋 Sampel Review</span><span class="badge" id="filterBadge" style="display:none; background:#ff6b35;"></span></div>
        <div id="reviewSampleWrap" class="muted">Belum ada ulasan yang ter-scrape</div>
        <div id="reviewSampleTableWrap" style="display:none; margin-top:6px;">
          <table>
            <tbody>
              <tr><td>Review Terscrape (Unik)</td><td id="sampleScraped" style="text-align:right;font-weight:700;">0</td></tr>
              <tr><td>Review dengan Teks</td><td id="sampleWithText" style="text-align:right;font-weight:700;">0</td></tr>
              <tr><td>Total Ulasan (Shopee)</td><td id="sampleTotal" style="text-align:right;font-weight:700;">0</td></tr>
              <tr><td>Cakupan Sampel</td><td id="sampleCoverage" style="text-align:right;font-weight:700;">0%</td></tr>
              <tr><td>Varian Unik Ditemukan</td><td id="sampleVariants" style="text-align:right;font-weight:700;">0</td></tr>
            </tbody>
          </table>
          <div id="sampleNote" style="font-size:9.5px; color:#888; font-style:italic; margin-top:4px; padding:4px; border-radius:4px; background:#f0f0f0; text-align:center;"></div>
        </div>

        <!-- Varian -->
        <div class="section-title">
          <span>🎨 Varian</span>
          <span class="badge" id="variantCount">0</span>
        </div>
        <div id="variantWrap" class="muted">Tidak ada data varian</div>
        <!-- V1 Style Tier Summaries (Persentase Per Opsi) -->
        <div id="tierSummariesWrap" style="margin-bottom: 15px; display: none;"></div>
        <div id="variantTableWrap" style="display:none;">
          <table>
            <thead>
              <tr><th>Tier 1</th><th>Tier 2</th><th>% Terjual</th><th>Harga</th></tr>
            </thead>
            <tbody id="variantTbody"></tbody>
          </table>
        </div>

        <!-- Terjual/Bulan -->
        <div class="section-title"><span>📈 Terjual / Bulan</span></div>
        <div class="grid" style="margin-bottom: 4px;">
          <div class="card monthly-sales-card">
            <div class="k">Penjualan Bulanan</div>
            <div class="v" id="monthlySoldValue">—</div>
            <div id="monthlySoldSource" class="data-source-badge">Belum tersedia</div>
          </div>
        </div>
        <div class="data-source-note" id="monthlySoldNote">
          <strong>ℹ️ Sumber Data:</strong>
          <ul>
            <li><b>Prioritas 1:</b> PDP API </li>
            <li><b>Prioritas 2:</b> Search API </li>
            <li><b>Prioritas 3:</b> DOM Scraping </li>
          </ul>
        </div>

        <!-- Estimasi Omset -->
        <div class="section-title"><span>💰 Estimasi Omset</span></div>
        <div class="grid">
          <div class="card monthly-sales-card">
            <div class="k">Omset / Bulan (Quick) 💨</div>
            <div class="v" id="omsetQuick">—</div>
            <div style="font-size:9px; color:#888; margin-top:2px;" id="omsetQuickNote"></div>
            <span class="confidence-badge none" id="omsetQuickConfidence">belum ada data</span>
          </div>
        </div>
        <div class="grid" style="margin-top:0;">
          <div class="card monthly-sales-card">
            <div class="k">Omset 30 Hari (Detail) 📊</div>
            <div class="v" id="omsetDetail">—</div>
            <div style="font-size:9px; color:#888; margin-top:2px;" id="omsetDetailNote"></div>
            <span class="confidence-badge none" id="omsetDetailConfidence">belum ada data</span>
          </div>
        </div>
        <div class="data-source-note" style="margin-bottom:10px;">
          <strong>ℹ️ Tingkat Keyakinan:</strong>
          <ul>
            <li><b style="color:#2e7d32">● Tinggi:</b> Terjual/Bulan dari API resmi Shopee</li>
            <li><b style="color:#f57f17">● Sedang:</b> Terjual/Bulan dari Search API (cache)</li>
            <li><b style="color:#c62828">● Rendah:</b> Estimasi dari rasio review × koreksi</li>
          </ul>
        </div>

        <!-- Info Toko -->
        <div class="section-title"><span>🏪 Info Toko</span></div>
        <div id="shopInfoWrap" class="muted">Data toko belum tersedia</div>
        <div id="shopTableWrap" style="display:none;">
          <table>
            <tbody id="shopInfoTbody"></tbody>
          </table>
          <div class="data-source-note" style="margin-top:6px;">
            <strong>ℹ️ Sumber Data:</strong> Shop API Shopee
          </div>
        </div>

        <!-- Review Insights (Analisis Keluhan Pembeli) -->
        <div class="section-title">
          <span>💡 Insight Keluhan Pembeli</span>
          <span class="badge" id="insightBadge" style="display:none; background:#722ed1;">0 Keluhan</span>
        </div>
        <div id="insightWrap" class="muted">Belum ada data ulasan untuk dianalisis</div>
        <div id="insightContentWrap" style="display:none; margin-bottom:12px;">
          <!-- Sentimen bar -->
          <div style="background:#f5f5f5; border-radius:6px; padding:6px 8px; margin-bottom:8px; border:1px solid #e8e8e8;">
            <div style="display:flex; justify-content:space-between; font-size:10px; margin-bottom:4px;">
              <span>Sentimen Ulasan:</span>
              <span id="sentimentRate" style="font-weight:700; color:#2e7d32;">0% Positif</span>
            </div>
            <div style="height:6px; background:#ff4d4f; border-radius:3px; overflow:hidden;">
              <div id="sentimentBar" style="height:100%; width:100%; background:#52c41a;"></div>
            </div>
          </div>

          <!-- Top Pain Points list -->
          <div id="painPointsList" style="display:flex; flex-direction:column; gap:4px; margin-bottom:8px;"></div>

          <!-- Cloud kata kunci keluhan -->
          <div style="font-size:9.5px; color:#888; margin-bottom:4px; font-weight:700;">Top Kata Kunci Keluhan:</div>
          <div id="complaintWordsCloud" style="display:flex; flex-wrap:wrap; gap:4px;"></div>
        </div>

        <!-- Review Terfilter -->
        <div class="section-title">
          <span id="reviewSectionTitle">📋 Review Terfilter</span>
          <span class="badge" id="negRevCount">0</span>
        </div>
        <div id="negWrap" class="muted">Tidak ada review yang sesuai filter (≥10 Kata)</div>
        <div id="negTableWrap" style="display:none; max-height:200px; overflow-y:auto; margin-bottom:10px;">
          <table>
            <thead>
              <tr><th style="width:35px">⭐</th><th>User</th><th>Komentar</th></tr>
            </thead>
            <tbody id="negTbody"></tbody>
          </table>
        </div>
      </div>

      <!-- Body Bulk Scraper (Pencarian & Toko) -->
      <div class="body" id="bodyBulk" style="display:none;">
        <!-- Header Info Pencarian -->
        <div style="background:#fff8f0; border:1px solid #ffd591; border-radius:8px; padding:8px 10px; margin-bottom:10px;">
          <div style="font-size:12px; font-weight:800; color:#d4380d;" id="bulkKeywordTitle">🔍 Riset Pencarian</div>
          <div style="font-size:10px; color:#888; margin-top:2px;" id="bulkDetectedCount">Menunggu produk terdeteksi dari Shopee...</div>
        </div>

        <!-- Metrik Pasar (Market Overview) -->
        <div class="grid" style="grid-template-columns: 1fr 1fr; margin-bottom:8px;">
          <div class="card">
            <div class="k">Est. Omset Pasar 💰</div>
            <div class="v" id="bulkTotalOmset" style="font-size:13px; color:#ee4d2d;">—</div>
            <div style="font-size:9px; color:#888;" id="bulkTotalSoldUnit">0 terjual / bln</div>
          </div>
          <div class="card">
            <div class="k">Rata-rata Harga 🏷️</div>
            <div class="v" id="bulkAvgPrice" style="font-size:13px;">—</div>
            <div style="font-size:9px; color:#888;" id="bulkPriceRange">Min: - | Max: -</div>
          </div>
        </div>

        <!-- Tombol Aksi Bulk -->
        <div class="actions" style="margin-bottom:10px;">
          <button class="btn tsv" id="btnBulkTSV" title="Salin seluruh tabel produk ke clipboard (TSV) — langsung paste ke Sheets / Excel">📋 Salin ke Sheets</button>
          <button class="btn" id="btnBulkCSV" title="Unduh CSV seluruh produk">📊 CSV</button>
          <button class="btn primary" id="btnBulkSaveHistory" title="Simpan seluruh produk ini ke database Riwayat">📥 Simpan ke Riwayat</button>
        </div>

        <!-- Baris Pengurutan (Sorting) -->
        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:6px; font-size:10.5px; color:#666;">
          <span><b>Urutkan:</b></span>
          <div style="display:flex; gap:4px;">
            <button class="btn-mini load" id="sortOmset" title="Omset tertinggi">Omset 🔽</button>
            <button class="btn-mini" id="sortSold" title="Penjualan bulanan terbanyak">Terjual 🔽</button>
            <button class="btn-mini" id="sortPrice" title="Harga termurah">Harga 🔼</button>
            <button class="btn-mini" id="sortRating" title="Rating tertinggi">Rating ⭐</button>
          </div>
        </div>

        <!-- Tabel Daftar Produk -->
        <div id="bulkTableWrap" style="max-height:360px; overflow-y:auto; border:1px solid #eee; border-radius:8px; background:#fff;">
          <table>
            <thead>
              <tr>
                <th style="width:20px; text-align:center;">#</th>
                <th>Produk</th>
                <th style="text-align:right;">Harga</th>
                <th style="text-align:right;">Terjual/bln</th>
                <th style="text-align:right;">Omset</th>
                <th style="width:30px; text-align:center;">Link</th>
              </tr>
            </thead>
            <tbody id="bulkTableTbody">
              <tr>
                <td colspan="6" style="text-align:center; padding:25px 10px; color:#999;">
                  Gulir (scroll) halaman Shopee untuk mendeteksi produk...
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Body Riwayat Produk (IndexedDB) -->
      <div class="body" id="bodyHistory" style="display:none;">
        <div class="history-actions">
          <input type="text" id="historySearchInput" placeholder="🔍 Cari nama produk / toko..." class="search-input">
          <div class="history-btns">
            <button class="btn tsv" id="btnHistoryTSV" title="Salin semua riwayat ke clipboard (TSV) — langsung Ctrl+V ke Sheets">📋 Salin Semua</button>
            <button class="btn" id="btnHistoryCSV" title="Download file CSV seluruh riwayat">📊 CSV</button>
            <button class="btn danger" id="btnHistoryClear" title="Hapus semua riwayat produk">🗑️ Hapus Semua</button>
          </div>
        </div>

        <div id="historyListWrap" class="history-list"></div>
        <div id="historyEmpty" class="muted" style="text-align:center; padding:30px 10px; display:none;">
          📭 Belum ada riwayat produk.<br>
          <span style="font-size:10px; color:#bbb;">Produk yang kamu buka/scrape akan otomatis tersimpan di sini.</span>
        </div>
      </div>
    </div>

    <!-- Mini button (saat panel ditutup) -->
    <div class="mini" id="mini">
      <button id="btnOpen">🛍️ Scraper</button>
    </div>
  `;

  return { host, shadow };
}

// ── Ambil data dari storage ──
async function getScraperData() {
  return new Promise(resolve => {
    chrome.storage.local.get('shopeeScraperData', (res) => resolve(res.shopeeScraperData || null));
  });
}

// ── Update badge status ──
function setBadge(shadow, text, type = '') {
  const el = shadow.getElementById('statusBadge');
  if (!el) return;
  el.textContent = text;
  el.className = 'badge' + (type ? ' ' + type : '');
}

// ── Render data ke panel ──
function render(shadow, output) {
  // Nama
  shadow.getElementById('name').innerHTML = escapeHTML(output.product?.name || '—');

  // Harga
  const pmin = output.product?.price_min || 0;
  const pmax = output.product?.price_max || 0;
  shadow.getElementById('price').textContent =
    (pmax && pmax !== pmin)
      ? `${formatRupiah(pmin)}–${formatRupiah(pmax)}`
      : formatRupiah(pmin);

  // Stats
  shadow.getElementById('rating').textContent = `${output.product?.rating || 0}`;
  shadow.getElementById('sold').textContent = Number(output.product?.total_sold || 0).toLocaleString('id-ID');
  shadow.getElementById('rcount').textContent = Number(output.product?.review_count || 0).toLocaleString('id-ID');

  // ── Sampel Review ──
  const sampleWrap = shadow.getElementById('reviewSampleWrap');
  const sampleTableWrap = shadow.getElementById('reviewSampleTableWrap');
  const rs = output.review_sample;
  
  if (!rs || rs.reviews_scraped <= 0) {
    if (sampleWrap) sampleWrap.style.display = 'block';
    if (sampleTableWrap) sampleTableWrap.style.display = 'none';
  } else {
    if (sampleWrap) sampleWrap.style.display = 'none';
    if (sampleTableWrap) sampleTableWrap.style.display = 'block';
    shadow.getElementById('sampleScraped').textContent = Number(rs.reviews_scraped).toLocaleString('id-ID');
    shadow.getElementById('sampleTotal').textContent = Number(rs.reviews_total).toLocaleString('id-ID');
    shadow.getElementById('sampleCoverage').textContent = rs.coverage_percent + '%';
    shadow.getElementById('sampleVariants').textContent = Number(rs.unique_variants_found).toLocaleString('id-ID');
    const noteEle = shadow.getElementById('sampleNote');
    if (noteEle) noteEle.textContent = rs.data_note || '';
  }

  // ── Varian ──
  const variants = output.variants || [];
  shadow.getElementById('variantCount').textContent = String(variants.length);

  const variantWrap = shadow.getElementById('variantWrap');
  const tableWrap = shadow.getElementById('variantTableWrap');
  const tbody = shadow.getElementById('variantTbody');
  const tierWrap = shadow.getElementById('tierSummariesWrap');
  tbody.innerHTML = '';

  if (!variants.length) {
    variantWrap.style.display = 'block';
    tableWrap.style.display = 'none';
    if (tierWrap) tierWrap.style.display = 'none';
  } else {
    variantWrap.style.display = 'none';
    tableWrap.style.display = 'block';
    
    // Render Tier Summaries (V1 Logic)
    if (tierWrap) {
        const ts = output.tierSummaries || [];
        if (ts && ts.length > 0) {
            tierWrap.style.display = 'block';
            let html = '';
            ts.forEach(t => {
                html += `
                  <div style="margin-bottom: 6px;">
                    <strong style="color:#333; font-size: 11px;">${escapeHTML(t.name)}</strong><br>
                    <span style="font-size: 11px; color: #444;">${escapeHTML(t.summary)}</span>
                  </div>
                `;
            });
            tierWrap.innerHTML = html;
        } else {
            tierWrap.style.display = 'block';
            tierWrap.innerHTML = '<span style="font-size: 10px; color: #999; font-style:italic;">(Persentase penjualan per varian tidak tersedia)</span>';
        }
    }

    variants.forEach(v => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHTML(v.tier1 || '-')}</td>
        <td>${escapeHTML(v.tier2 || '-')}</td>
        <td>${v.sales_percentage || 0}%</td>
        <td>${v.price ? formatRupiah(v.price) : '-'}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  // ── Terjual / Bulan ──
  const msWrap = shadow.getElementById('monthlySoldValue');
  const msSource = shadow.getElementById('monthlySoldSource');
  const monthlyData = output.monthly_sold || {};
  
  if (msWrap && msSource) {
    if (monthlyData.value !== null && monthlyData.value !== undefined) {
      msWrap.textContent = Number(monthlyData.value).toLocaleString('id-ID');
      
      let sourceText = 'Tidak diketahui';
      let sourceClass = 'error';
      if (monthlyData.source === 'API') {
        sourceText = 'PDP API';
        sourceClass = 'api';
      } else if (monthlyData.source === 'SEARCH_API') {
        sourceText = 'Search API';
        sourceClass = 'api';
      } else if (monthlyData.source === 'DOM') {
        sourceText = 'DOM Scraping';
        sourceClass = 'dom';
      }
      
      msSource.textContent = sourceText;
      msSource.className = 'data-source-badge ' + sourceClass;
      msSource.style.background = sourceClass === 'api' ? '#4CAF50' : (sourceClass === 'dom' ? '#FFC107' : '#F44336');
      if(sourceClass === 'dom') msSource.style.color = '#000';
    } else {
      msWrap.textContent = '-';
      msSource.textContent = 'Belum tersedia';
      msSource.style.background = '#999';
    }
  }

  // ── Estimasi Omset ──
  const omsetQuickEl = shadow.getElementById('omsetQuick');
  const omsetDetailEl = shadow.getElementById('omsetDetail');
  const omsetQuickNote = shadow.getElementById('omsetQuickNote');
  const omsetDetailNote = shadow.getElementById('omsetDetailNote');
  const omsetQuickBadge = shadow.getElementById('omsetQuickConfidence');
  const omsetDetailBadge = shadow.getElementById('omsetDetailConfidence');
  const omset = output.omset || {};

  // Helper: tentukan confidence level berdasarkan sumber data
  function getQuickConfidence(src) {
    if (src === 'API') return { level: 'high', label: '● Tinggi — API resmi Shopee' };
    if (src === 'SEARCH_API') return { level: 'medium', label: '● Sedang — Search API (cache)' };
    if (src === 'ESTIMATED') return { level: 'low', label: '● Rendah — Estimasi dari review' };
    return { level: 'none', label: 'belum ada data' };
  }

  if (omsetQuickEl) {
    if (omset.quick_value > 0) {
      omsetQuickEl.textContent = formatRupiah(omset.quick_value);
      const srcLabel = omset.sold_per_month_source === 'ESTIMATED'
        ? `~${Number(omset.sold_per_month || 0).toLocaleString('id-ID')} unit (est.) \u00d7 ${formatRupiah(omset.avg_price || 0)}`
        : `${Number(omset.sold_per_month || 0).toLocaleString('id-ID')} unit \u00d7 ${formatRupiah(omset.avg_price || 0)}`;
      if (omsetQuickNote) omsetQuickNote.textContent = srcLabel;
      if (omsetQuickBadge) {
        const conf = getQuickConfidence(omset.sold_per_month_source);
        omsetQuickBadge.textContent = conf.label;
        omsetQuickBadge.className = `confidence-badge ${conf.level}`;
      }
    } else {
      omsetQuickEl.textContent = '\u2014';
      if (omsetQuickNote) omsetQuickNote.textContent = 'Belum ada data (scrape dulu)';
      if (omsetQuickBadge) { omsetQuickBadge.textContent = 'belum ada data'; omsetQuickBadge.className = 'confidence-badge none'; }
    }
  }

  if (omsetDetailEl) {
    if (omset.detail_value > 0) {
      omsetDetailEl.textContent = formatRupiah(omset.detail_value);
      if (omsetDetailNote) omsetDetailNote.textContent = `${omset.reviews_30d || 0} review (30hr), koreksi ${omset.correction_factor || '?'}\u00d7`;
      if (omsetDetailBadge) {
        // Detail selalu berbasis review — keyakinannya Sedang jika ada review real, Rendah jika estimasi
        const detailConf = (omset.reviews_30d_with_price > 0) ? 'medium' : 'low';
        const detailLabel = (omset.reviews_30d_with_price > 0)
          ? '● Sedang — dari harga varian review'
          : '● Rendah — harga rata-rata × koreksi';
        omsetDetailBadge.textContent = detailLabel;
        omsetDetailBadge.className = `confidence-badge ${detailConf}`;
      }
    } else {
      omsetDetailEl.textContent = '\u2014';
      if (omsetDetailNote) omsetDetailNote.textContent = 'Belum ada review dalam 30 hari terakhir';
      if (omsetDetailBadge) { omsetDetailBadge.textContent = 'belum ada data'; omsetDetailBadge.className = 'confidence-badge none'; }
    }
  }

  // ── Info Toko ──
  const shopWrap = shadow.getElementById('shopInfoWrap');
  const shopTableWrap = shadow.getElementById('shopTableWrap');
  const shopTbody = shadow.getElementById('shopInfoTbody');
  const shop = output.shop || {};

  if (!shop.name) {
    if (shopWrap) shopWrap.style.display = 'block';
    if (shopTableWrap) shopTableWrap.style.display = 'none';
  } else {
    if (shopWrap) shopWrap.style.display = 'none';
    if (shopTableWrap) shopTableWrap.style.display = 'block';
    
    if (shopTbody) {
      shopTbody.innerHTML = `
        <tr><td>Nama Toko</td><td style="font-weight:700;">${escapeHTML(shop.name)}</td></tr>
        <tr><td>Lokasi</td><td>${escapeHTML(shop.location || '-')}</td></tr>
        <tr><td>Pengikut</td><td>${shop.follower_count ? Number(shop.follower_count).toLocaleString('id-ID') : '-'}</td></tr>
        <tr><td>Rating Toko</td><td>${shop.rating_star ? shop.rating_star.toFixed(2) : '-'} ⭐</td></tr>
        <tr><td>Status</td><td style="font-weight:700; color:#ee4d2d;">
          ${shop.is_mall ? 'Mall' : shop.is_preferred ? 'Star+' : 'Regular'}
        </td></tr>
      `;
    }
  }

  // ── Review Insights (Analisis Keluhan Pembeli) ──
  const insightWrap = shadow.getElementById('insightWrap');
  const insightContentWrap = shadow.getElementById('insightContentWrap');
  const insightBadge = shadow.getElementById('insightBadge');
  const sentimentRate = shadow.getElementById('sentimentRate');
  const sentimentBar = shadow.getElementById('sentimentBar');
  const painPointsList = shadow.getElementById('painPointsList');
  const complaintWordsCloud = shadow.getElementById('complaintWordsCloud');

  const insights = output.review_insights;
  if (!insights || insights.total_analyzed === 0 || (!insights.pain_points?.length && !insights.top_complaint_words?.length)) {
    if (insightWrap) insightWrap.style.display = 'block';
    if (insightContentWrap) insightContentWrap.style.display = 'none';
    if (insightBadge) insightBadge.style.display = 'none';
  } else {
    if (insightWrap) insightWrap.style.display = 'none';
    if (insightContentWrap) insightContentWrap.style.display = 'block';

    const totalPainPointsCount = (insights.pain_points || []).reduce((sum, p) => sum + p.count, 0);
    if (insightBadge) {
      insightBadge.textContent = `${totalPainPointsCount} Keluhan`;
      insightBadge.style.display = 'inline';
    }

    if (sentimentRate && sentimentBar) {
      const posRate = insights.sentiment?.positive_rate ?? 100;
      sentimentRate.textContent = `${posRate}% Positif | ${100 - posRate}% Keluhan`;
      sentimentBar.style.width = `${posRate}%`;
    }

    if (painPointsList) {
      let ppHtml = '';
      (insights.pain_points || []).forEach(p => {
        ppHtml += `
          <div style="background:#fff; border:1px solid #ffd591; border-radius:5px; padding:5px 8px; font-size:10px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:2px;">
              <span style="font-weight:700; color:#d4380d;">${p.icon} ${escapeHTML(p.label)}</span>
              <span style="background:#fff2e8; color:#d4380d; font-weight:800; font-size:9px; padding:1px 5px; border-radius:10px; border:1px solid #ffbb96;">${p.count}x (${p.percentage}%)</span>
            </div>
            ${p.sample ? `<div style="font-size:9px; color:#666; font-style:italic;">"${escapeHTML(p.sample)}"</div>` : ''}
          </div>
        `;
      });
      painPointsList.innerHTML = ppHtml;
    }

    if (complaintWordsCloud) {
      let wordsHtml = '';
      (insights.top_complaint_words || []).forEach(w => {
        wordsHtml += `<span style="background:#fff1f0; border:1px solid #ffa39e; color:#cf1322; padding:2px 6px; border-radius:10px; font-size:9.5px; font-weight:600;">#${escapeHTML(w.word)} (${w.count})</span>`;
      });
      complaintWordsCloud.innerHTML = wordsHtml || '<span style="color:#aaa; font-size:9.5px;">-</span>';
    }
  }

  // ── Review Terfilter ──
  const negWrap = shadow.getElementById('negWrap');
  const negTableWrap = shadow.getElementById('negTableWrap');
  const negTbody = shadow.getElementById('negTbody');
  const negCount = shadow.getElementById('negRevCount');
  const negTitle = shadow.getElementById('reviewSectionTitle');
  // Gunakan filtered_reviews jika ada (baru), fallback ke negative_reviews
  const negRevs = output.filtered_reviews || output.negative_reviews || [];
  
  // Update label section dinamis sesuai filter bintang
  if (negTitle) {
    const starLabel = output.star_filter_label || null;
    if (starLabel && output.star_filter?.length !== 5) {
      // Filter spesifik
      negTitle.textContent = `📋 Review (${starLabel})`;
    } else {
      // Semua bintang
      negTitle.textContent = '📋 Review Terfilter';
    }
  }
  
  // Update badge filter di sampel review
  const filterBadge = shadow.getElementById('filterBadge');
  if (filterBadge) {
    const sf = output.star_filter || [];
    if (sf.length > 0 && sf.length < 5) {
      filterBadge.textContent = [...sf].sort((a,b) => b-a).map(s => `${s}★`).join(' ');
      filterBadge.style.display = 'inline';
    } else {
      filterBadge.style.display = 'none';
    }
  }

  if (negCount) negCount.textContent = negRevs.length;

  if (negRevs.length === 0) {
    if (negWrap) negWrap.style.display = 'block';
    if (negTableWrap) negTableWrap.style.display = 'none';
  } else {
    if (negWrap) negWrap.style.display = 'none';
    if (negTableWrap) negTableWrap.style.display = 'block';
    
    if (negTbody) {
      let html = '';
      negRevs.forEach(r => {
        html += `
          <tr>
            <td style="color:#ee4d2d; font-weight:bold;">${escapeHTML(String(r.stars ?? '-'))}</td>
            <td style="font-size:9.5px;">${escapeHTML(r.user)}<br><span style="color:#999;font-size:8px;">${escapeHTML(r.date)}</span></td>
            <td style="font-size:10px; line-height:1.3;">${escapeHTML(r.comment)}</td>
          </tr>
        `;
      });
      negTbody.innerHTML = html;
    }
  }

  // Simpan otomatis ke IndexedDB (History) jika data produk valid
  if (typeof ShopeeDB !== 'undefined' && output.product?.name && output.product.name !== '—') {
    ShopeeDB.saveProduct(output).then(() => {
      updatePanelHistoryCount(shadow);
    }).catch(err => console.warn('[Shopee Scraper] Gagal auto-save history:', err));
  }
}

// ── Manajemen Riwayat Produk (IndexedDB) ──
async function updatePanelHistoryCount(shadow) {
  if (typeof ShopeeDB === 'undefined') return;
  try {
    const list = await ShopeeDB.getAll();
    const badge = shadow.getElementById('panelHistoryCount');
    if (badge) badge.textContent = list ? list.length : 0;
  } catch(e) {}
}

async function renderHistoryList(shadow, filterKeyword = '') {
  if (typeof ShopeeDB === 'undefined') return;
  const wrap = shadow.getElementById('historyListWrap');
  const empty = shadow.getElementById('historyEmpty');
  if (!wrap || !empty) return;

  wrap.innerHTML = '<div class="muted" style="text-align:center; padding:15px 0;">Memuat riwayat...</div>';

  try {
    let list = await ShopeeDB.getAll();
    updatePanelHistoryCount(shadow);

    if (filterKeyword && filterKeyword.trim()) {
      const kw = filterKeyword.toLowerCase().trim();
      list = list.filter(item =>
        (item.name || '').toLowerCase().includes(kw) ||
        (item.shop_name || '').toLowerCase().includes(kw)
      );
    }

    if (!list || list.length === 0) {
      wrap.innerHTML = '';
      empty.style.display = 'block';
      return;
    }

    empty.style.display = 'none';
    let html = '';

    list.forEach(item => {
      const pmin = item.price_min || 0;
      const pmax = item.price_max || 0;
      const priceText = (pmax && pmax !== pmin)
        ? `${formatRupiah(pmin)}–${formatRupiah(pmax)}`
        : formatRupiah(pmin);

      const timeStr = item.scraped_at ? new Date(item.scraped_at).toLocaleString('id-ID', {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
      }) : '-';

      html += `
        <div class="history-card">
          <div class="history-card-title" title="${escapeHTML(item.name)}">${escapeHTML(item.name)}</div>
          <div class="history-card-meta">
            <span class="history-card-price">${priceText}</span>
            <span>⭐ ${item.rating || 0} | ${Number(item.total_sold || 0).toLocaleString('id-ID')} terjual</span>
          </div>
          <div class="history-card-stats">
            <div><b>Terjual/bln:</b> ${Number(item.monthly_sold || 0).toLocaleString('id-ID')}</div>
            <div><b>Omset Quick:</b> ${item.omset_quick ? formatRupiah(item.omset_quick) : '-'}</div>
          </div>
          <div class="history-card-footer">
            <span>🏪 ${escapeHTML(item.shop_name || '-')} • ${timeStr}</span>
            <div class="history-card-actions">
              <button class="btn-mini load" data-action="view" data-id="${escapeHTML(item.id)}" title="Buka detail produk ini di panel">👁️ Buka</button>
              ${item.url ? `<a href="${escapeHTML(item.url)}" target="_blank" class="btn-mini" title="Buka produk ini di tab baru">🔗 Link</a>` : ''}
              <button class="btn-mini delete" data-action="delete" data-id="${escapeHTML(item.id)}" title="Hapus dari riwayat">✕</button>
            </div>
          </div>
        </div>
      `;
    });

    wrap.innerHTML = html;

    // Listener tombol pada setiap kartu riwayat
    wrap.querySelectorAll('[data-action="view"]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        const record = await ShopeeDB.get(id);
        if (record && record.output) {
          const tabActive = shadow.getElementById('tabBtnActive');
          const tabHistory = shadow.getElementById('tabBtnHistory');
          const bodyActive = shadow.getElementById('bodyActive');
          const bodyHistory = shadow.getElementById('bodyHistory');

          if (tabActive) tabActive.classList.add('active');
          if (tabHistory) tabHistory.classList.remove('active');
          if (bodyActive) bodyActive.style.display = 'block';
          if (bodyHistory) bodyHistory.style.display = 'none';

          render(shadow, record.output);
          setBadge(shadow, 'Riwayat 💾', 'api');
        }
      });
    });

    wrap.querySelectorAll('[data-action="delete"]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        await ShopeeDB.delete(id);
        renderHistoryList(shadow, filterKeyword);
      });
    });

  } catch(e) {
    console.error('Gagal render riwayat:', e);
    wrap.innerHTML = `<div class="muted" style="color:#ff4d4f; text-align:center;">Gagal memuat: ${e.message}</div>`;
  }
}

// ── State & Fungsi Bulk Scraper (Pencarian & Toko) ──
let currentBulkProducts = [];
let currentBulkSort = 'omset';

function renderBulkSearch(shadow, bulkData) {
  if (!bulkData) return;
  const products = bulkData.products || [];
  currentBulkProducts = [...products];

  const kwTitle = shadow.getElementById('bulkKeywordTitle');
  if (kwTitle) {
    kwTitle.textContent = bulkData.keyword ? `🔍 ${bulkData.keyword}` : '🔍 Riset Pencarian';
  }

  const countEl = shadow.getElementById('bulkDetectedCount');
  if (countEl) {
    countEl.textContent = products.length > 0
      ? `✅ ${products.length} produk terdeteksi (scroll halaman untuk menambah)`
      : 'Menunggu produk terdeteksi dari Shopee...';
  }

  const badgeCount = shadow.getElementById('panelBulkCount');
  if (badgeCount) badgeCount.textContent = products.length;

  const stats = bulkData.stats || {};
  const omsetEl = shadow.getElementById('bulkTotalOmset');
  if (omsetEl) omsetEl.textContent = formatRupiah(stats.total_omset || 0);

  const soldUnitEl = shadow.getElementById('bulkTotalSoldUnit');
  if (soldUnitEl) soldUnitEl.textContent = `${Number(stats.total_monthly_sold || 0).toLocaleString('id-ID')} unit terjual / bln`;

  const avgPriceEl = shadow.getElementById('bulkAvgPrice');
  if (avgPriceEl) avgPriceEl.textContent = formatRupiah(stats.avg_price || 0);

  const priceRangeEl = shadow.getElementById('bulkPriceRange');
  if (priceRangeEl) priceRangeEl.textContent = `Min: ${formatRupiah(stats.min_price || 0)} | Max: ${formatRupiah(stats.max_price || 0)}`;

  renderBulkTable(shadow);
}

function renderBulkTable(shadow) {
  const tbody = shadow.getElementById('bulkTableTbody');
  if (!tbody) return;

  if (!currentBulkProducts || currentBulkProducts.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align:center; padding:25px 10px; color:#999;">
          Belum ada produk terdeteksi. Gulir (scroll) halaman Shopee untuk memuat produk...
        </td>
      </tr>
    `;
    return;
  }

  // Pengurutan
  const sorted = [...currentBulkProducts].sort((a, b) => {
    if (currentBulkSort === 'omset') return (b.estimated_omset || 0) - (a.estimated_omset || 0);
    if (currentBulkSort === 'sold') return (b.monthly_sold || 0) - (a.monthly_sold || 0);
    if (currentBulkSort === 'price') return (a.price_min || 0) - (b.price_min || 0);
    if (currentBulkSort === 'rating') return (b.rating || 0) - (a.rating || 0);
    return 0;
  });

  let html = '';
  sorted.forEach((p, idx) => {
    const rankClass = idx < 3 ? 'bulk-rank top3' : 'bulk-rank';
    const rankBadge = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx + 1}`;
    const imgTag = p.image ? `<img src="${escapeHTML(p.image)}" class="bulk-thumb" loading="lazy">` : '';

    html += `
      <tr>
        <td class="${rankClass}">${rankBadge}</td>
        <td>
          <div class="bulk-prod-cell">
            ${imgTag}
            <div class="bulk-prod-title" title="${escapeHTML(p.name)}">${escapeHTML(p.name)}</div>
          </div>
        </td>
        <td style="text-align:right; font-weight:700; white-space:nowrap; font-size:10.5px;">${formatRupiah(p.price_min)}</td>
        <td style="text-align:right; white-space:nowrap; font-size:10.5px; color:#666;">${Number(p.monthly_sold || 0).toLocaleString('id-ID')}</td>
        <td style="text-align:right; font-weight:800; color:#ee4d2d; white-space:nowrap; font-size:10.5px;">${p.estimated_omset ? formatRupiah(p.estimated_omset) : '-'}</td>
        <td style="text-align:center;">
          <a href="${escapeHTML(p.url)}" target="_blank" class="btn-mini" style="padding:2px 5px;" title="Buka produk di tab baru">🔗</a>
        </td>
      </tr>
    `;
  });

  tbody.innerHTML = html;
}

function buildBulkSearchTSV(products) {
  const T = '\t';
  const N = '\n';
  const esc = (v) => String(v ?? '').replace(/\t/g, ' ').replace(/\n/g, ' ');

  let tsv = 'Rank' + T +
            'Nama Produk' + T +
            'Harga Min' + T +
            'Harga Max' + T +
            'Rating' + T +
            'Terjual / Bulan' + T +
            'Total Terjual' + T +
            'Est. Omset / Bulan' + T +
            'Lokasi Toko' + T +
            'URL Produk' + N;

  (products || []).forEach((p, idx) => {
    tsv += (idx + 1) + T +
           esc(p.name) + T +
           (p.price_min || 0) + T +
           (p.price_max || 0) + T +
           (p.rating || 0) + T +
           (p.monthly_sold || 0) + T +
           (p.total_sold || 0) + T +
           (p.estimated_omset || 0) + T +
           esc(p.shop_location) + T +
           esc(p.url) + N;
  });

  return tsv;
}

function buildBulkSearchCSV(products) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

  let csv = 'Rank,Nama Produk,Harga Min,Harga Max,Rating,Terjual / Bulan,Total Terjual,Est. Omset / Bulan,Lokasi Toko,URL Produk\n';

  (products || []).forEach((p, idx) => {
    csv += `${idx + 1},${esc(p.name)},${p.price_min || 0},${p.price_max || 0},${p.rating || 0},${p.monthly_sold || 0},${p.total_sold || 0},${p.estimated_omset || 0},${esc(p.shop_location)},${esc(p.url)}\n`;
  });

  return '\uFEFF' + csv;
}

function switchPanelMode(shadow) {
  const isSearchOrShop = isShopeeSearchPage(location.href) || isShopeeShopPage(location.href);
  const isProduct = isShopeeProductPage(location.href);

  const tabActive = shadow.getElementById('tabBtnActive');
  const tabHistory = shadow.getElementById('tabBtnHistory');
  const bodyActive = shadow.getElementById('bodyActive');
  const bodyBulk = shadow.getElementById('bodyBulk');
  const bodyHistory = shadow.getElementById('bodyHistory');

  if (tabActive) tabActive.classList.add('active');
  if (tabHistory) tabHistory.classList.remove('active');
  if (bodyHistory) bodyHistory.style.display = 'none';

  if (isSearchOrShop) {
    if (tabActive) tabActive.innerHTML = `🔍 Riset Pasar <span class="tab-badge" id="panelBulkCount">${currentBulkProducts.length}</span>`;
    if (bodyActive) bodyActive.style.display = 'none';
    if (bodyBulk) bodyBulk.style.display = 'block';
    setBadge(shadow, isShopeeSearchPage(location.href) ? 'Search 🔍' : 'Toko 🏪', 'search');
    chrome.storage.local.get('shopeeBulkSearchData', (res) => {
      if (res.shopeeBulkSearchData) renderBulkSearch(shadow, res.shopeeBulkSearchData);
    });
  } else if (isProduct) {
    if (tabActive) tabActive.innerHTML = '📦 Produk Aktif';
    if (bodyActive) bodyActive.style.display = 'block';
    if (bodyBulk) bodyBulk.style.display = 'none';
    refreshFromStorage(shadow);
  }
}

// ── Kirim perintah ke injector via background ──
function forwardToInjector(payload) {
  return chrome.runtime.sendMessage({ action: 'PANEL_FORWARD_TO_TAB', payload }).then(resp => {
    if (resp && resp.error) throw new Error(resp.error);
    return resp;
  });
}

// ── Refresh panel dari storage ──
async function refreshFromStorage(shadow, savedsource) {
  const saved = await getScraperData();
  if (!saved?.rawProduct) {
    setBadge(shadow, 'idle');
    return;
  }

  // Load star filter dari storage
  const starFilter = await new Promise(resolve => {
    chrome.storage.local.get('shopeeStarFilter', (res) => {
      const sf = res.shopeeStarFilter;
      resolve((sf && Array.isArray(sf) && sf.length > 0) ? sf : [1,2,3,4,5]);
    });
  });

  const product = ShopeeParser.parseProduct(saved.rawProduct);
  const neg = ShopeeParser.parseNegativeReviews(saved.rawReviews || [], product?.variants || [], starFilter);
  const output = ShopeeParser.buildOutput(
    product, neg,
    saved.url || location.href,
    saved.rawShop || null,
    saved.monthlySoldFromSearch || null,
    starFilter
  );

  render(shadow, output);
  
  // Update sampleWithText jika ada
  const sampleWithTextEl = shadow.getElementById('sampleWithText');
  if (sampleWithTextEl) {
    const filteredCount = output.filtered_reviews?.length || output.negative_reviews?.length || 0;
    sampleWithTextEl.textContent = Number(filteredCount).toLocaleString('id-ID');
  }

  // Badge logic & Button State: prioritas fetchStatus > dataSource
  const fetchStatus = saved.fetchStatus || null;
  const src = saved.dataSource;
  const btnScrape = shadow.getElementById('btnScrape');
  const btnStop = shadow.getElementById('btnStop');

  if (fetchStatus && fetchStatus.startsWith('loading:')) {
    const count = fetchStatus.split(':')[1] || '0';
    setBadge(shadow, `📥 Ulasan: ${count}...`, 'loading');
    if (btnStop) btnStop.style.display = 'inline-block';
    if (btnScrape) btnScrape.disabled = true;
  } else if (fetchStatus && fetchStatus.startsWith('done:')) {
    const count = fetchStatus.split(':')[1] || '0';
    const srcBadge = src === 'api' ? 'API' : src === 'api+dom' ? 'API+DOM' : src === 'dom' ? 'DOM' : '';
    setBadge(shadow, `${srcBadge} ✓ ${count} ulasan`, src === 'api+dom' ? 'api' : (src || 'api'));
    if (btnStop) btnStop.style.display = 'none';
    if (btnScrape) btnScrape.disabled = false;
  } else if (fetchStatus && fetchStatus.startsWith('stopped:')) {
    const count = fetchStatus.split(':')[1] || '0';
    setBadge(shadow, `🛑 Dihentikan (${count} ulasan)`, 'dom');
    if (btnStop) btnStop.style.display = 'none';
    if (btnScrape) btnScrape.disabled = false;
  } else if (fetchStatus === 'error') {
    setBadge(shadow, 'Review gagal ⚠', 'error');
    if (btnStop) btnStop.style.display = 'none';
    if (btnScrape) btnScrape.disabled = false;
  } else {
    const badgeText = src === 'api' ? 'API ✓' : src === 'api+dom' ? 'API+DOM ✓' : src === 'dom' ? 'DOM ✓' : 'ok';
    setBadge(shadow, badgeText, src === 'api+dom' ? 'api' : (src || 'api'));
    if (btnStop) btnStop.style.display = 'none';
    if (btnScrape) btnScrape.disabled = false;
  }
}

// ── DRAG support ──
function makeDraggable(host, handle) {
  let isDragging = false;
  let startX, startY, origRight, origTop;

  handle.addEventListener('mousedown', (e) => {
    if (e.target.tagName === 'BUTTON') return;
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    origRight = parseInt(host.style.right) || 16;
    origTop = parseInt(host.style.top) || 90;
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const dx = startX - e.clientX;
    const dy = e.clientY - startY;
    host.style.right = (origRight + dx) + 'px';
    host.style.top = (origTop + dy) + 'px';
  });

  document.addEventListener('mouseup', () => { isDragging = false; });
}

// ── MOUNT PANEL ──
async function mountPanel() {
  // Cegah double inject
  if (document.getElementById('shopee-scraper-panel-host')) return;

  // JANGAN inject panel jika bukan halaman yang didukung (produk, pencarian, atau toko)
  if (!isSupportedShopeePage(location.href)) {
    console.log('[Shopee Scraper Panel] Bukan halaman produk, pencarian, atau toko, panel tidak dimuat.');
    return;
  }

  const { host, shadow } = createPanel();
  document.documentElement.appendChild(host);

  const panel = shadow.getElementById('panel');
  const mini = shadow.getElementById('mini');

  // Drag
  makeDraggable(host, shadow.getElementById('dragHandle'));

  // ── Open / Close ──
  shadow.getElementById('btnClose').addEventListener('click', () => {
    panel.style.display = 'none';
    mini.style.display = 'block';
  });

  shadow.getElementById('btnOpen').addEventListener('click', () => {
    panel.style.display = 'flex';
    mini.style.display = 'none';
  });

  // ── Set visibility awal ──
  if (isSupportedShopeePage(location.href)) {
    panel.style.display = 'flex';
    mini.style.display = 'none';
  } else {
    panel.style.display = 'none';
    mini.style.display = 'none';
  }

  // ── Tombol Scrape Ulang ──
  const btnScrape = shadow.getElementById('btnScrape');
  const btnStop = shadow.getElementById('btnStop');

  btnStop.addEventListener('click', async () => {
    try {
      await forwardToInjector({ action: 'STOP_SCRAPE' });
      btnStop.style.display = 'none';
      btnScrape.style.display = 'inline-block';
      btnScrape.disabled = false;
      setBadge(shadow, 'Dihentikan', 'ok');
    } catch(e) {
      console.warn('Gagal set stop flag:', e);
    }
  });

  // ── Tombol Extra Info ──
  const btnFetchExtra = shadow.getElementById('btnFetchExtra');
  if (btnFetchExtra) {
    btnFetchExtra.addEventListener('click', async () => {
      btnFetchExtra.disabled = true;
      btnFetchExtra.textContent = 'Memuat...';
      try {
        await forwardToInjector({ action: 'FETCH_EXTRA_INFO' });
      } catch (e) {
        console.warn('Gagal fetch info tambahan:', e);
      }
      setTimeout(() => {
        btnFetchExtra.disabled = false;
        btnFetchExtra.textContent = '⚡ Info Terjual & Toko';
      }, 3000);
    });
  }

  btnScrape.addEventListener('click', async () => {
    btnScrape.disabled = true;
    btnScrape.style.display = 'none';
    btnStop.style.display = 'inline-block';
    setBadge(shadow, 'scraping...', 'loading');
    try {
      await forwardToInjector({ action: 'TRIGGER_SCRAPE' });
      
      // Step 2: Auto-klik tab filter review (Semua, 5☆, 4☆, 3☆, 2☆, 1☆, Komentar, Media)
      setBadge(shadow, 'klik tab...', 'loading');
      setTimeout(async () => {
        try {
          await forwardToInjector({ action: 'CLICK_REVIEW_TABS' });
        } catch(e) { /* silent */ }
        
        // Step 3: Fetch reviews via API setelah tab diklik
        setBadge(shadow, 'ambil review...', 'loading');
        setTimeout(async () => {
          try {
            await forwardToInjector({ action: 'FETCH_REVIEWS' });
          } catch(e) { /* silent */ }
        }, 18000); // Tunggu ~18 detik (8 tab × 2 detik + buffer)
      }, 2000);

    } catch (e) {
      setBadge(shadow, 'Refresh Page!', 'error');
      if (e.message.includes('Extension context invalidated') || e.message.includes('Tab tidak ditemukan')) {
        alert('Ekstensi Shopee Scraper baru saja diupdate. Silakan REFRESH (F5) halaman Shopee ini agar scraper dapat berjalan.');
      } else {
        alert('Gagal memulai scraping: ' + e.message);
      }
    } finally {
      setTimeout(() => {
        btnScrape.disabled = false;
        btnScrape.style.display = 'inline-block';
        btnStop.style.display = 'none';
      }, 25000);
    }
  });

  // ── Tombol JSON ──
  shadow.getElementById('btnJSON').addEventListener('click', async () => {
    const saved = await getScraperData();
    if (!saved?.rawProduct) return;
    // Load star filter dari storage
    const sfJSON = await new Promise(resolve => {
      chrome.storage.local.get('shopeeStarFilter', (res) => {
        const sf = res.shopeeStarFilter;
        resolve((sf && Array.isArray(sf) && sf.length > 0) ? sf : [1,2,3,4,5]);
      });
    });
    const product = ShopeeParser.parseProduct(saved.rawProduct);
    const neg = ShopeeParser.parseNegativeReviews(saved.rawReviews || [], product?.variants || [], sfJSON);
    // monthlySoldFromSearch harus ikut dikirim — kalau null, data "Terjual/Bulan"
    // yang tampil di panel hilang dari file hasil export.
    const output = ShopeeParser.buildOutput(product, neg, saved.url || location.href, saved.rawShop || null, saved.monthlySoldFromSearch || null, sfJSON);
    const blob = new Blob([JSON.stringify(output, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `shopee_${Date.now()}.json`);
  });

  // ── Tombol CSV ──
  shadow.getElementById('btnCSV').addEventListener('click', async () => {
    const saved = await getScraperData();
    if (!saved?.rawProduct) return;
    // Load star filter dari storage
    const sfCSV = await new Promise(resolve => {
      chrome.storage.local.get('shopeeStarFilter', (res) => {
        const sf = res.shopeeStarFilter;
        resolve((sf && Array.isArray(sf) && sf.length > 0) ? sf : [1,2,3,4,5]);
      });
    });
    const product = ShopeeParser.parseProduct(saved.rawProduct);
    const neg = ShopeeParser.parseNegativeReviews(saved.rawReviews || [], product?.variants || [], sfCSV);
    const output = ShopeeParser.buildOutput(product, neg, saved.url || location.href, saved.rawShop || null, saved.monthlySoldFromSearch || null, sfCSV);
    const blob = new Blob([buildCSV(output)], { type: 'text/csv;charset=utf-8;' });
    downloadBlob(blob, `shopee_${Date.now()}.csv`);
  });

  // ── Tombol Salin ke Sheets (TSV) ──
  shadow.getElementById('btnTSV').addEventListener('click', async () => {
    const saved = await getScraperData();
    if (!saved?.rawProduct) {
      alert('Belum ada data — jalankan Scrape dulu.');
      return;
    }
    const sfTSV = await new Promise(resolve => {
      chrome.storage.local.get('shopeeStarFilter', (res) => {
        const sf = res.shopeeStarFilter;
        resolve((sf && Array.isArray(sf) && sf.length > 0) ? sf : [1,2,3,4,5]);
      });
    });
    const product = ShopeeParser.parseProduct(saved.rawProduct);
    const neg = ShopeeParser.parseNegativeReviews(saved.rawReviews || [], product?.variants || [], sfTSV);
    const output = ShopeeParser.buildOutput(product, neg, saved.url || location.href, saved.rawShop || null, saved.monthlySoldFromSearch || null, sfTSV);
    const tsvString = buildTSV(output);

    const btnTSV = shadow.getElementById('btnTSV');
    try {
      await navigator.clipboard.writeText(tsvString);
      btnTSV.textContent = '✅ Tersalin!';
      btnTSV.style.borderColor = '#2e7d32';
      btnTSV.style.color = '#2e7d32';
    } catch (e) {
      // Fallback: buat file TSV dan download
      const blob = new Blob([tsvString], { type: 'text/plain;charset=utf-8;' });
      downloadBlob(blob, `shopee_${Date.now()}.tsv`);
      btnTSV.textContent = '⬇️ Diunduh (.tsv)';
    } finally {
      setTimeout(() => {
        btnTSV.textContent = '📋 Salin ke Sheets';
        btnTSV.style.borderColor = '';
        btnTSV.style.color = '';
      }, 2500);
    }
  });

  // ── Tab Navigasi (Produk Aktif / Riset Pasar vs Riwayat) ──
  const tabBtnActive = shadow.getElementById('tabBtnActive');
  const tabBtnHistory = shadow.getElementById('tabBtnHistory');
  const bodyActive = shadow.getElementById('bodyActive');
  const bodyBulk = shadow.getElementById('bodyBulk');
  const bodyHistory = shadow.getElementById('bodyHistory');

  if (tabBtnActive && tabBtnHistory) {
    tabBtnActive.addEventListener('click', () => {
      tabBtnActive.classList.add('active');
      tabBtnHistory.classList.remove('active');
      if (bodyHistory) bodyHistory.style.display = 'none';
      const isSearchOrShop = isShopeeSearchPage(location.href) || isShopeeShopPage(location.href);
      if (isSearchOrShop) {
        if (bodyBulk) bodyBulk.style.display = 'block';
        if (bodyActive) bodyActive.style.display = 'none';
      } else {
        if (bodyActive) bodyActive.style.display = 'block';
        if (bodyBulk) bodyBulk.style.display = 'none';
      }
    });

    tabBtnHistory.addEventListener('click', () => {
      tabBtnHistory.classList.add('active');
      tabBtnActive.classList.remove('active');
      if (bodyHistory) bodyHistory.style.display = 'block';
      if (bodyActive) bodyActive.style.display = 'none';
      if (bodyBulk) bodyBulk.style.display = 'none';
      renderHistoryList(shadow);
    });
  }

  // ── Event Listener untuk Bulk Scraper ──
  const btnBulkTSV = shadow.getElementById('btnBulkTSV');
  if (btnBulkTSV) {
    btnBulkTSV.addEventListener('click', async () => {
      if (!currentBulkProducts || currentBulkProducts.length === 0) {
        alert('Belum ada data produk pencarian yang terdeteksi. Gulir halaman Shopee terlebih dahulu.');
        return;
      }
      const tsv = buildBulkSearchTSV(currentBulkProducts);
      try {
        await navigator.clipboard.writeText(tsv);
        btnBulkTSV.textContent = '✅ Tersalin!';
        btnBulkTSV.style.borderColor = '#2e7d32';
        btnBulkTSV.style.color = '#2e7d32';
      } catch (e) {
        const blob = new Blob([tsv], { type: 'text/plain;charset=utf-8;' });
        downloadBlob(blob, `shopee_bulk_${Date.now()}.tsv`);
        btnBulkTSV.textContent = '⬇️ Diunduh (.tsv)';
      }
      setTimeout(() => {
        btnBulkTSV.textContent = '📋 Salin ke Sheets';
        btnBulkTSV.style.borderColor = '';
        btnBulkTSV.style.color = '';
      }, 2500);
    });
  }

  const btnBulkCSV = shadow.getElementById('btnBulkCSV');
  if (btnBulkCSV) {
    btnBulkCSV.addEventListener('click', () => {
      if (!currentBulkProducts || currentBulkProducts.length === 0) {
        alert('Belum ada data produk pencarian.');
        return;
      }
      const csv = buildBulkSearchCSV(currentBulkProducts);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      downloadBlob(blob, `shopee_bulk_${Date.now()}.csv`);
    });
  }

  const btnBulkSaveHist = shadow.getElementById('btnBulkSaveHistory');
  if (btnBulkSaveHist) {
    btnBulkSaveHist.addEventListener('click', async () => {
      if (!currentBulkProducts || currentBulkProducts.length === 0) {
        alert('Belum ada data produk pencarian untuk disimpan.');
        return;
      }
      btnBulkSaveHist.disabled = true;
      btnBulkSaveHist.textContent = 'Menyimpan...';
      const count = await ShopeeDB.saveBulkProducts(currentBulkProducts);
      btnBulkSaveHist.textContent = `✅ ${count} Tersimpan!`;
      updatePanelHistoryCount(shadow);
      setTimeout(() => {
        btnBulkSaveHist.disabled = false;
        btnBulkSaveHist.textContent = '📥 Simpan ke Riwayat';
      }, 2500);
    });
  }

  // Tombol Pengurutan Bulk (Sorting)
  const sortBtns = {
    sortOmset: 'omset',
    sortSold: 'sold',
    sortPrice: 'price',
    sortRating: 'rating'
  };
  Object.keys(sortBtns).forEach(id => {
    const btn = shadow.getElementById(id);
    if (btn) {
      btn.addEventListener('click', () => {
        currentBulkSort = sortBtns[id];
        Object.keys(sortBtns).forEach(bId => {
          const b = shadow.getElementById(bId);
          if (b) b.classList.toggle('load', bId === id);
        });
        renderBulkTable(shadow);
      });
    }
  });


  // ── Pencarian Riwayat Produk ──
  const historySearchInput = shadow.getElementById('historySearchInput');
  if (historySearchInput) {
    historySearchInput.addEventListener('input', (e) => {
      renderHistoryList(shadow, e.target.value);
    });
  }

  // ── Salin Semua Riwayat (TSV) ──
  const btnHistTSV = shadow.getElementById('btnHistoryTSV');
  if (btnHistTSV) {
    btnHistTSV.addEventListener('click', async () => {
      if (typeof ShopeeDB === 'undefined') return;
      const list = await ShopeeDB.getAll();
      if (!list || list.length === 0) {
        alert('Belum ada riwayat produk.');
        return;
      }
      const tsv = ShopeeDB.buildBulkTSV(list);
      try {
        await navigator.clipboard.writeText(tsv);
        btnHistTSV.textContent = '✅ Tersalin!';
        btnHistTSV.style.borderColor = '#2e7d32';
        btnHistTSV.style.color = '#2e7d32';
      } catch (e) {
        const blob = new Blob([tsv], { type: 'text/plain;charset=utf-8;' });
        downloadBlob(blob, `riwayat_shopee_${Date.now()}.tsv`);
        btnHistTSV.textContent = '⬇️ Diunduh (.tsv)';
      }
      setTimeout(() => {
        btnHistTSV.textContent = '📋 Salin Semua';
        btnHistTSV.style.borderColor = '';
        btnHistTSV.style.color = '';
      }, 2500);
    });
  }

  // ── Download CSV Semua Riwayat ──
  const btnHistCSV = shadow.getElementById('btnHistoryCSV');
  if (btnHistCSV) {
    btnHistCSV.addEventListener('click', async () => {
      if (typeof ShopeeDB === 'undefined') return;
      const list = await ShopeeDB.getAll();
      if (!list || list.length === 0) {
        alert('Belum ada riwayat produk.');
        return;
      }
      const csv = ShopeeDB.buildBulkCSV(list);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      downloadBlob(blob, `riwayat_shopee_${Date.now()}.csv`);
    });
  }

  // ── Hapus Semua Riwayat ──
  const btnHistClear = shadow.getElementById('btnHistoryClear');
  if (btnHistClear) {
    btnHistClear.addEventListener('click', async () => {
      if (typeof ShopeeDB === 'undefined') return;
      if (confirm('Yakin ingin menghapus SELURUH riwayat produk?')) {
        await ShopeeDB.clear();
        renderHistoryList(shadow);
        updatePanelHistoryCount(shadow);
      }
    });
  }

  // Inisialisasi hitungan riwayat
  updatePanelHistoryCount(shadow);

  // Shadow aktif dipakai listener storage global di bawah
  activeShadow = shadow;

  // ── Render awal ──
  switchPanelMode(shadow);
}

// Shadow root panel yang sedang terpasang (null saat panel tidak ada)
let activeShadow = null;

// ── Auto update saat storage berubah ──
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  if (!activeShadow || !document.getElementById('shopee-scraper-panel-host')) return;

  if (changes.shopeeScraperData && isShopeeProductPage(location.href)) {
    refreshFromStorage(activeShadow);
  }
  if (changes.shopeeBulkSearchData && (isShopeeSearchPage(location.href) || isShopeeShopPage(location.href))) {
    renderBulkSearch(activeShadow, changes.shopeeBulkSearchData.newValue);
  }
});

// ── Deteksi navigasi SPA Shopee ──
(function watchSpaNavigation() {
  let lastUrl = location.href;

  const syncPanelWithUrl = () => {
    const existingHost = document.getElementById('shopee-scraper-panel-host');

    if (isSupportedShopeePage(location.href)) {
      if (!existingHost) {
        mountPanel();
      } else if (activeShadow) {
        switchPanelMode(activeShadow);
      }
    } else if (existingHost) {
      // Pindah ke halaman yang tidak didukung — lepas panel
      existingHost.remove();
      activeShadow = null;
    }
  };

  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      syncPanelWithUrl();
    }
  }, 1000);

  syncPanelWithUrl();
})();
