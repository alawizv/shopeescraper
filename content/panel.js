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
  return /shopee\.co\.id\/.+-i\.\d+\.\d+/.test(url || location.href);
}

function formatRupiah(num) {
  if (num === null || num === undefined) return '-';
  const n = Number(num) || 0;
  return 'Rp' + n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
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

  csv += '=== NEGATIVE REVIEWS (1-3) ===\n';
  if (output.negative_reviews?.length) {
    csv += 'Stars,Date,User,Variant,Comment\n';
    output.negative_reviews.forEach(r => {
      csv += `${r.stars || ''},"${r.date || ''}","${(r.user || '').replace(/"/g, '""')}","${(r.variant || '-').replace(/"/g, '""')}","${(r.comment || '').replace(/"/g, '""').replace(/\n/g, ' ')}"\n`;
    });
  } else {
    csv += 'Tidak ada review negatif\n';
  }

  return '\uFEFF' + csv; // BOM untuk Excel
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

      <div class="body">
        <!-- Aksi -->
        <div class="actions">
          <button class="btn primary" id="btnScrape">🔄 Scrape</button>
          <button class="btn" id="btnStop" style="display:none; background:#ff4d4f;">🛑 Stop</button>
          <button class="btn" id="btnFetchExtra" style="border-color:#1890ff; color:#1890ff;">⚡ Info Terjual & Toko</button>
          <button class="btn" id="btnJSON">📄 JSON</button>
          <button class="btn" id="btnCSV">📊 CSV</button>
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
        <div class="section-title"><span>📋 Sampel Review</span></div>
        <div id="reviewSampleWrap" class="muted">Belum ada ulasan yang ter-scrape</div>
        <div id="reviewSampleTableWrap" style="display:none; margin-top:6px;">
          <table>
            <tbody>
              <tr><td>Ulasan Terbaca (Unik)</td><td id="sampleScraped" style="text-align:right;font-weight:700;">0</td></tr>
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
          </div>
        </div>
        <div class="grid" style="margin-top:0;">
          <div class="card monthly-sales-card">
            <div class="k">Omset 30 Hari (Detail) 📊</div>
            <div class="v" id="omsetDetail">—</div>
            <div style="font-size:9px; color:#888; margin-top:2px;" id="omsetDetailNote"></div>
          </div>
        </div>
        <div class="data-source-note" style="margin-bottom:10px;">
          <strong>ℹ️ Metode:</strong>
          <ul>
            <li><b>Quick:</b> Terjual/Bulan × Harga Rata-rata</li>
            <li><b>Detail:</b> Review 30hr × Harga Varian × Koreksi</li>
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

        <!-- Ulasan Negatif Terfilter -->
        <div class="section-title">
          <span>⚠️ Ulasan Negatif Terfilter</span>
          <span class="badge" id="negRevCount">0</span>
        </div>
        <div id="negWrap" class="muted">Tidak ada ulasan negatif (1-3 ⭐, &ge;10 Kata)</div>
        <div id="negTableWrap" style="display:none; max-height:200px; overflow-y:auto; margin-bottom:10px;">
          <table>
            <thead>
              <tr><th style="width:35px">⭐</th><th>User</th><th>Komentar</th></tr>
            </thead>
            <tbody id="negTbody"></tbody>
          </table>
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
  const omset = output.omset || {};

  if (omsetQuickEl) {
    if (omset.quick_value > 0) {
      omsetQuickEl.textContent = formatRupiah(omset.quick_value);
      const srcLabel = omset.sold_per_month_source === 'ESTIMATED'
        ? `~${Number(omset.sold_per_month || 0).toLocaleString('id-ID')} unit (est.) \u00d7 ${formatRupiah(omset.avg_price || 0)}`
        : `${Number(omset.sold_per_month || 0).toLocaleString('id-ID')} unit \u00d7 ${formatRupiah(omset.avg_price || 0)}`;
      if (omsetQuickNote) omsetQuickNote.textContent = srcLabel;
    } else {
      omsetQuickEl.textContent = '\u2014';
      if (omsetQuickNote) omsetQuickNote.textContent = 'Belum ada data (scrape dulu)';
    }
  }

  if (omsetDetailEl) {
    if (omset.detail_value > 0) {
      omsetDetailEl.textContent = formatRupiah(omset.detail_value);
      if (omsetDetailNote) omsetDetailNote.textContent = `${omset.reviews_30d || 0} review (30hr), koreksi ${omset.correction_factor || '?'}\u00d7`;
    } else {
      omsetDetailEl.textContent = '\u2014';
      if (omsetDetailNote) omsetDetailNote.textContent = 'Belum ada review dalam 30 hari terakhir';
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

  // ── Ulasan Negatif Terfilter ──
  const negWrap = shadow.getElementById('negWrap');
  const negTableWrap = shadow.getElementById('negTableWrap');
  const negTbody = shadow.getElementById('negTbody');
  const negCount = shadow.getElementById('negRevCount');
  const negRevs = output.negative_reviews || [];

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
            <td style="color:#ee4d2d; font-weight:bold;">${r.stars}</td>
            <td style="font-size:9.5px;">${escapeHTML(r.user)}<br><span style="color:#999;font-size:8px;">${r.date}</span></td>
            <td style="font-size:10px; line-height:1.3;">${escapeHTML(r.comment)}</td>
          </tr>
        `;
      });
      negTbody.innerHTML = html;
    }
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

  const product = ShopeeParser.parseProduct(saved.rawProduct);
  const neg = ShopeeParser.parseNegativeReviews(saved.rawReviews || [], product?.variants || []);
  const output = ShopeeParser.buildOutput(
    product, neg,
    saved.url || location.href,
    saved.rawShop || null,
    saved.monthlySoldFromSearch || null  // Data riil Terjual/Bulan dari search API
  );

  render(shadow, output);

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

// ── MAIN ──
(async function main() {
  // Cegah double inject
  if (document.getElementById('shopee-scraper-panel-host')) return;

  // JANGAN inject panel jika bukan halaman detail produk
  if (!isShopeeProductPage(location.href)) {
    console.log('[Shopee Scraper Panel] Bukan halaman produk, panel tidak dimuat.');
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
  if (isShopeeProductPage(location.href)) {
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
    const product = ShopeeParser.parseProduct(saved.rawProduct);
    const neg = ShopeeParser.parseNegativeReviews(saved.rawReviews || [], product?.variants || []);
    const output = ShopeeParser.buildOutput(product, neg, saved.url || location.href, saved.rawShop || null);
    const blob = new Blob([JSON.stringify(output, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `shopee_${Date.now()}.json`);
  });

  // ── Tombol CSV ──
  shadow.getElementById('btnCSV').addEventListener('click', async () => {
    const saved = await getScraperData();
    if (!saved?.rawProduct) return;
    const product = ShopeeParser.parseProduct(saved.rawProduct);
    const neg = ShopeeParser.parseNegativeReviews(saved.rawReviews || [], product?.variants || []);
    const output = ShopeeParser.buildOutput(product, neg, saved.url || location.href, saved.rawShop || null);
    const blob = new Blob([buildCSV(output)], { type: 'text/csv;charset=utf-8;' });
    downloadBlob(blob, `shopee_${Date.now()}.csv`);
  });

  // ── Render awal ──
  await refreshFromStorage(shadow);

  // ── Auto update saat storage berubah (intercept / DOM fallback selesai) ──
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (!isShopeeProductPage(location.href)) return; // Abaikan jika pindah halaman non-produk (SPA)
    if (changes.shopeeScraperData) refreshFromStorage(shadow);
  });

  // ── Deteksi pindah produk (Shopee SPA) ──
  // (Dinonaktifkan demi stabilitas: Auto-scrape per detik 
  // sangat rawan menimbulkan Extension context invalidated 
  // ketika pengguna berpindah tab/reload)
  
})();
