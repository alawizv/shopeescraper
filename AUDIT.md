# Audit Kode — Shopee Product Scraper

Tanggal audit: **2026-09-16**
Versi yang diaudit: **1.2.2** (commit `446c049`)
Cakupan: seluruh sumber (~8.400 baris) — `manifest.json`, `background/service-worker.js`,
`content/{interceptor,injector,panel}.js`, `popup/popup.js`, `utils/{parser,exporter,db}.js`,
`.github/workflows/auto-bump-version.yml`, `install-update.bat`.

Status: **belum ada yang diperbaiki** — dokumen ini murni catatan temuan.

---

## Urutan perbaikan yang disarankan

| # | Temuan | Berat | Status |
|---|--------|-------|--------|
| 1 | `shopId` tidak terdefinisi → Riset Massal mati total | 🔴 Kritis | ☑ |
| 2 | `panel.js` tidak bisa di-inject ulang + `db.js` hilang dari daftar inject | 🔴 Kritis | ☐ |
| 3 | `formatRupiah` rusak untuk angka desimal | 🔴 Kritis | ☐ |
| 4 | Sentimen & analisis keluhan dihitung dari sampel yang salah | 🟠 Logika | ☐ |
| 5 | `escapeHTML()` tidak meng-escape tanda kutip | 🟠 Logika | ☐ |
| 6 | Service worker bisa menggantung pemanggilnya | 🟠 Logika | ☐ |
| 7 | Tanggal memakai UTC, bukan waktu lokal | 🟠 Logika | ☐ |
| 8 | Re-parse O(n²) saat scraping review | 🟡 Performa | ☐ |
| 9 | Race pada injeksi interceptor | 🟡 Performa | ☐ |
| 10+ | Kualitas kode & saran (lihat bagian bawah) | 🔵 Saran | ☐ |

---

## 🔴 1. Fitur "Riset Massal / Bulk Search" tidak pernah jalan — `shopId` tidak terdefinisi

**Lokasi:** `content/injector.js:887` dan `content/injector.js:891`, di dalam `processBulkSearchItems()`

```js
const url = `${origin}/product/${shopId || '0'}/${itemId}`;   // baris 887
// ...
shopid: shopId ? String(shopId) : null,                        // baris 891
```

`shopId` **tidak pernah dideklarasikan** di fungsi ini maupun di scope luarnya. Satu-satunya
deklarasi ada di `fetchShopDetail()` (`injector.js:1347`, `let shopId`) yang scope-nya terpisah.

Seluruh file berada dalam IIFE `'use strict'`, jadi membaca variabel tak terdeklarasi melempar
`ReferenceError: shopId is not defined` pada item **pertama**. Error itu tertelan oleh `catch`
di akhir `processBulkSearchItems()` yang hanya mencetak
`'[Shopee Scraper] Gagal proses bulk search items'`, sehingga
`chrome.storage.local.set({ shopeeBulkSearchData })` **tidak pernah dieksekusi**.

**Dampak:** tab "🔍 Riset Pasar" di panel dan blok bulk di popup selamanya menampilkan
"Menunggu produk terdeteksi dari Shopee…". Padahal "riset massal halaman pencarian" disebut
sebagai fitur utama di `manifest.json` → `description`.

**Verifikasi:**
```
$ node -e "'use strict'; (()=>{ try { const u=`x/${shopId||'0'}/1` } catch(e){ console.log('CAUGHT:', e.constructor.name, e.message) } })()"
CAUGHT: ReferenceError shopId is not defined
```

**Perbaikan:** ambil dari item-nya, sejajar dengan `itemId` tepat di atasnya:
```js
const itemId = item?.itemid || item?.item_id;
const shopId = item?.shopid || item?.shop_id || null;   // ← tambahkan
```

---

## 🔴 2. Jalur pemulihan popup rusak — `panel.js` tidak bisa di-inject ulang

**Lokasi:** `popup/popup.js:124`

```js
await chrome.scripting.executeScript({
  target: { tabId: tab.id },
  files: ['utils/parser.js', 'content/injector.js', 'content/panel.js']
});
```

Dua masalah terpisah:

**2a. `panel.js` tidak punya guard anti-double-inject.** File itu mendeklarasikan `let` di
top-level:
- `content/panel.js:1474` — `let currentBulkProducts = [];`
- `content/panel.js:1475` — `let currentBulkSort = 'omset';`
- `content/panel.js:2217` — `let activeShadow = null;`

Content script berbagi lexical scope global dalam isolated world yang sama, jadi eksekusi kedua
melempar `SyntaxError: Identifier 'activeShadow' has already been declared` dan **seluruh file
gagal dievaluasi**. Ironisnya komentar di `utils/parser.js:8-10` sudah menjelaskan persis
masalah ini (dan itulah alasan `parser.js` memakai `var` + penjaga), tapi `panel.js` belum ikut
diperbaiki. `injector.js` aman karena punya flag `window.__SHOPEE_SCRAPER_INJECTOR_READY__`.

**2b. `utils/db.js` tidak ada di daftar inject.** `panel.js` memanggil `ShopeeDB` untuk riwayat
dan simpan-bulk. Kalau content script dari manifest memang belum pernah berjalan (justru itu
kondisi yang memicu jalur pemulihan ini), `ShopeeDB` undefined dan semua tombol riwayat
`return` diam-diam tanpa pesan apa pun ke user.

**Perbaikan:**
- Bungkus `panel.js` dalam IIFE dengan flag `window.__SHOPEE_PANEL_READY__`, atau ubah tiga
  `let` top-level itu menjadi pola `var X = (typeof X !== 'undefined' && X) ? X : …` seperti
  `parser.js`.
- Tambahkan `'utils/db.js'` ke awal daftar `files`.

---

## 🔴 3. `formatRupiah` rusak untuk angka desimal

**Lokasi:** `utils/parser.js` (`buildOutput`), lalu ditampilkan oleh `popup/popup.js`
`formatRupiah()` dan `content/panel.js:58` `formatRupiah()`.

```js
const omsetQuick = soldPerMonth * priceAvg;   // TIDAK di-Math.round()
// bandingkan: detail_value: Math.round(omsetDetail)   ← yang ini sudah benar
```

`priceAvg = (price_min + price_max) / 2` — dua bilangan bulat dibagi 2, jadi bisa berakhiran
`.5`. Nilai desimal itu masuk ke formatter yang menyisipkan titik ribuan secara buta:

```js
n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')
```

**Verifikasi:**
```
formatRupiah(12345.5)   → "Rp 12.345.5"     ❌
formatRupiah(1234567.5) → "Rp 1.234.567.5"  ❌
formatRupiah(4999.5)    → "Rp 4.999.5"      ❌
formatRupiah(250000)    → "Rp 250.000"      ✅
```

**Dampak:** muncul di popup, panel, file TSV, dan file CSV. Di spreadsheet, `12345.5` yang
ditulis mentah juga berisiko salah-parse pada locale id-ID.

**Perbaikan:** `Math.round()` pada `quick_value` di `buildOutput`, **dan** sebagai jaring
pengaman tambahkan `Math.round(n)` di dalam `formatRupiah` — ada **tiga** salinan fungsi ini
(`popup/popup.js`, `content/panel.js:58`, dan `getCurrencySymbol` pasangannya di
`utils/parser.js`).

---

## 🟠 4. Sentimen & analisis keluhan dihitung dari sampel yang salah

**Lokasi:** `utils/parser.js`, akhir `buildOutput()`

```js
review_insights: this.extractReviewInsights(negativeReviews)
```

`negativeReviews` adalah `parseReviewResult.reviews` — yaitu review yang **sudah lolos filter
bintang pilihan user DAN syarat minimal 10 kata**. Jadi `sentiment.positive_rate` bukan metrik
produk, melainkan cerminan filter itu sendiri.

**Dampak konkret:** kalau user memilih filter "1★ Saja", panel dan popup menampilkan
**"0% Positif | 100% Keluhan"** untuk produk apa pun — termasuk produk dengan rating 4,9.
Angka itu tampil berdampingan dengan data produk asli sehingga terbaca sebagai fakta produk.

**Perbaikan:** hitung `sentiment` dari **semua** ulasan unik yang ter-parse. Loop di
`parseNegativeReviews` sudah memegang `stars` untuk setiap review sebelum filter diterapkan —
cukup akumulasi `positive/negative` di sana dan kembalikan bersama `omset30d`. Sisakan
`pain_points` dan `top_complaint_words` untuk review berteks.

**Catatan terkait (bukan bug, tapi pertimbangkan):** syarat minimal 10 kata
(`parser.js`, `if (wordCount < 10) return;`) membuang mayoritas ulasan Indonesia — "barang
bagus, sesuai foto, pengiriman cepat" hanya 6 kata. Pertimbangkan turunkan ke 4–5 kata atau
jadikan opsi yang bisa diatur user.

---

## 🟠 5. `escapeHTML()` tidak meng-escape tanda kutip

**Lokasi:** `content/panel.js:65` dan fungsi kembarannya di `popup/popup.js`

```js
function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}
```

Jalur `textContent → innerHTML` meng-escape `&`, `<`, `>` tapi **tidak** `"` maupun `'`.
Fungsi ini dipakai di dalam **atribut** dengan data yang dikendalikan penjual:

- `content/panel.js:1412` — `title="${escapeHTML(item.name)}"`
- `content/panel.js:1549` — `title="${escapeHTML(p.name)}"`
- `content/panel.js:1541` — `<img src="${escapeHTML(p.image)}">`
- `content/panel.js:1556`, `:1425` — `href="${escapeHTML(p.url)}"`
- `popup/popup.js` `renderPopupHistory()` — `title="${escapeHTML(item.name)}"` dan
  `href="${escapeHTML(item.url)}"`

Nama produk berisi `"` langsung memecah atribut dan memungkinkan penyisipan atribut baru
(mis. handler event). Di popup, CSP bawaan MV3 (`script-src 'self'`) memblokir handler inline
sehingga dampaknya terbatas; di panel (shadow DOM yang tertanam di halaman Shopee) tidak ada
jaminan serupa.

**Perbaikan:**
```js
function escapeHTML(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
```

---

## 🟠 6. Service worker bisa menggantung pemanggilnya

**Lokasi:** `background/service-worker.js:22-65`

Kelima handler `DB_SAVE_PRODUCT`, `DB_GET_ALL`, `DB_GET_ONE`, `DB_DELETE`, `DB_CLEAR`
menempatkan `return true` **di dalam** `if (typeof ShopeeDB !== 'undefined' && ShopeeDB._direct)`:

```js
if (message.action === 'DB_SAVE_PRODUCT') {
  if (typeof ShopeeDB !== 'undefined' && ShopeeDB._direct) {
    ShopeeDB._direct.save(message.record)…
    return true;
  }
  // ← tidak ada else: sendResponse tak pernah dipanggil
}
```

`importScripts('../utils/db.js')` dibungkus `try/catch` di `service-worker.js:11-15`, jadi
kegagalan import memang mungkin terjadi tanpa mematikan worker. Saat itu terjadi, channel
ditutup tanpa respons, dan di sisi pemanggil `utils/db.js:157`:

```js
resolve(resp ? resp.data : null);
```

mengembalikan `null` **tanpa error** — penyimpanan riwayat gagal sepenuhnya diam-diam.

**Perbaikan:** tambahkan cabang `else` di setiap handler:
```js
sendResponse({ error: 'ShopeeDB tidak tersedia di service worker' });
return true;
```

---

## 🟠 7. Tanggal memakai UTC, bukan waktu lokal

**Lokasi:** `utils/parser.js` (`parseNegativeReviews`)

```js
const date = timestamp ? new Date(timestamp * 1000).toISOString().split('T')[0] : 'Tidak diketahui';
```

`toISOString()` selalu UTC. Untuk WIB (UTC+7), ulasan yang ditulis pukul 00:00–07:00 tercatat
mundur satu hari. Batas jendela 30 hari (`thirtyDaysAgoUnix`) ikut bergeser, sehingga
`reviews_30d` — yang jadi basis `omset.detail_value` dan estimasi `sold_per_month` — sedikit
meleset.

**Perbaikan:** `toLocaleDateString('sv-SE')` (menghasilkan `YYYY-MM-DD` di zona waktu lokal)
atau terapkan offset eksplisit.

---

## 🟡 8. Re-parse O(n²) saat scraping review

**Lokasi:** `content/panel.js:1664` `refreshFromStorage()`, dipicu oleh listener
`chrome.storage.onChanged` di `panel.js:2220`.

Setiap kali `shopeeScraperData` berubah, panel menjalankan `parseProduct` +
`parseNegativeReviews` + `buildOutput` atas **seluruh** array review dari nol. Sementara itu
injector melakukan progressive save tiap 25–50 review:

```js
const saveInterval = allReviews.length < 150 ? 25 : 50;   // content/injector.js
```

Untuk produk dengan 3.000 ulasan itu ≈ 80 kali parsing penuh **plus** 80 kali serialisasi
seluruh array review ke `chrome.storage.local`. Panel terasa berat dan tab Shopee ikut
tersendat justru saat scraping sedang berjalan.

**Perbaikan:** debounce `refreshFromStorage` (~500 ms), dan saat `fetchStatus` masih
`loading:` cukup perbarui teks badge hitungan tanpa re-parse penuh.

---

## 🟡 9. Race pada injeksi interceptor

**Lokasi:** `content/injector.js` `injectInterceptor()`

```js
const script = document.createElement('script');
script.src = chrome.runtime.getURL('content/interceptor.js');
(document.head || document.documentElement).appendChild(script);
```

Script yang dibuat dinamis dimuat **asinkron**. Walaupun `injector.js` berjalan di
`document_start`, `XMLHttpRequest.prototype.open` baru ditimpa setelah file itu selesai
diunduh — request API pertama Shopee sering sudah lewat. Ini kemungkinan besar alasan
fallback DOM / timer 8 detik (`FALLBACK_TIMEOUT`) sering terpakai.

**Perbaikan:** Chrome 111+ mendukung main-world content script secara native. Pindahkan ke
`manifest.json` dan hapus `injectInterceptor()` beserta entri `web_accessible_resources`:

```json
{
  "matches": ["https://*.shopee.co.id/*", "…"],
  "js": ["content/interceptor.js"],
  "run_at": "document_start",
  "world": "MAIN"
}
```

Bonus: menghapus `web_accessible_resources` juga menghilangkan cara halaman mendeteksi
(fingerprint) keberadaan ekstensi ini.

---

## 🔵 Kualitas kode & saran

### 10. Duplikasi berat
- `guardFormula` + `esc` disalin **empat** kali: `content/panel.js:75`, `popup/popup.js`
  (`buildTSV` dan `buildBulkSearchTSV`), `utils/db.js:296` dan `:346`.
- `buildTSV` / `buildCSV` nyaris identik di `content/panel.js` dan `popup/popup.js`.
- `buildProductRows` / `buildTrendRows` / `buildVariantRows` / `buildReviewRows` punya **dua**
  versi hampir sama persis di `utils/exporter.js` dan `background/service-worker.js`.
- `getCurrencySymbol` dan `formatRupiah` ada tiga salinan.

→ Satukan ke `utils/format.js` yang bisa dipakai content script, popup, dan service worker.
Bug seperti #3 saat ini harus diperbaiki di beberapa tempat sekaligus.

### 11. `getCurrencySymbol` mencocokkan URL penuh, bukan hostname
`utils/parser.js`, `popup/popup.js`, `content/panel.js:42` semuanya memakai
`h.includes('.ph')`, `h.includes('.my')`, `h.includes('.cl')` atas **URL lengkap**. Slug produk
yang kebetulan memuat potongan itu memicu simbol mata uang yang salah.
→ Pakai `new URL(url).hostname`.

### 12. Interceptor melewatkan `URL` object
`content/interceptor.js:120`:
```js
const url = typeof input === 'string' ? input : (input instanceof Request ? input.url : '');
```
`fetch(new URL(...))` menghasilkan `''` → pattern tidak pernah cocok.
→ `const url = String(input?.url ?? input ?? '');`

### 13. Log debug ikut terkirim ke produksi
Puluhan `console.log` berwarna ("Parser V3", "Jackpot!", dump `Object.keys`) di
`injector.js`, `parser.js`, dan `interceptor.js` tampil di konsol user.
→ Bungkus dengan `const DEBUG = false;`

### 14. `version.json` berisi changelog yang tidak berguna
```json
{ "version": "1.2.2", "changelog": "Merge branch 'main' of https://github.com/alawizv/shopeescraper" }
```
Teks ini tampil apa adanya di notifikasi Chrome dan banner update. Workflow CI
(`.github/workflows/auto-bump-version.yml`) **sudah** diperbaiki untuk mengganti pesan merge
dengan kalimat netral, tapi file yang ter-commit belum ikut dibersihkan.
→ Isi manual dengan teks yang berarti bagi user.

### 15. Belum ada tes sama sekali
`utils/parser.js` dan `utils/db.js` sudah punya `module.exports` dan fungsinya murni.
Satu berkas tes Node untuk `parseNegativeReviews`, `buildOutput`, dan `isNewerVersion` akan
menangkap bug seperti #3 dan #4 sebelum rilis, tanpa perlu dependensi apa pun.

### 16. Agresivitas scraping
Auto-klik pagination sampai `MAX_PAGINATION_ROUNDS = 3000` halaman plus fetch API tiap 800 ms.
Retry untuk 429/403 sudah ada dan bagus, tapi pertimbangkan menaikkan jeda dasar dan
menghormati header `Retry-After` agar akun Shopee user tidak kena rate-limit.

### 17. Catatan kecil lain
- `utils/db.js:228` — `saveBulkProducts` memakai `id: String(p.itemid)` tanpa penjaga; kalau
  `itemid` undefined semua record bertabrakan di kunci `"undefined"`. Saat ini tidak terpicu
  karena `processBulkSearchItems` selalu mengisi `itemid` (dan lagipula sedang rusak — lihat #1),
  tapi tetap layak dijaga.
- `content/injector.js` — watcher SPA memanggil `bulkSearchProductsMap.clear()` pada **setiap**
  perubahan URL, termasuk saat Shopee memperbarui `?page=` di halaman pencarian. Akumulasi
  produk bulk jadi ter-reset padahal user masih di halaman pencarian yang sama.
- `popup/popup.js` `showError()` memanggil
  `elements.mainContent.classList.remove('d-none')` — menampilkan konten utama justru saat
  terjadi error. Kemungkinan disengaja, tapi terasa aneh.
- `utils/parser.js` — komentar di `buildOutput` mengklaim persentase varian "totalnya selalu
  100%". Pada jalur proxy (`v.sold_count / variantReviewTotal`) itu tidak benar, karena
  `variantReviewTotal` juga menghitung ulasan yang tidak cocok dengan varian mana pun.
