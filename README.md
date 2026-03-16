# 🛍️ Shopee Product Scraper — Chrome Extension

Chrome Extension MV3 untuk men-scrape data produk dari halaman produk Shopee Indonesia.

## ✨ Fitur

- **Data Produk**: Nama, harga, rating, total terjual, jumlah ulasan
- **Varian Produk**: Tier 1 & 2 (warna, ukuran, dll.) dengan stok dan harga per kombinasi
- **Review Negatif**: Bintang 1–3 dengan komentar, tanggal, username, dan varian yang dibeli
- **Export**: JSON, CSV, dan Google Sheets
- **Otomatis**: Intercept API Shopee dengan fallback ke DOM scraping

## 📦 Instalasi

### Langkah 1: Download / Clone Project

Download ZIP dan ekstrak folder `shopee-scraper/`

### Langkah 2: Load di Chrome

1. Buka **Chrome** → ketik `chrome://extensions/` di address bar
2. Aktifkan **Developer mode** (toggle di pojok kanan atas)
3. Klik **Load unpacked**
4. Pilih folder `shopee-scraper/` yang sudah didownload
5. Extension akan muncul di toolbar Chrome

## 🚀 Cara Pakai

1. Buka halaman produk di **shopee.co.id**
   - Contoh: `https://shopee.co.id/nama-produk-i.123456.789012`
2. Klik icon extension **Shopee Scraper** di toolbar Chrome
3. Data produk akan otomatis tampil di popup
4. Klik **"Ambil Review"** untuk mengambil review negatif (bintang 1–3)
5. Gunakan tombol **Export** untuk mengunduh data:
   - 📄 **JSON** — Download file .json
   - 📊 **CSV** — Download file .csv (bisa dibuka di Excel)
   - 📗 **Google Sheets** — Export langsung ke Google Spreadsheet

## 📗 Setup Google Sheets (Opsional)

### Langkah 1: Buat Project di Google Cloud

1. Buka [Google Cloud Console](https://console.cloud.google.com/)
2. Buat project baru atau pilih project yang ada
3. Aktifkan **Google Sheets API**: APIs & Services → Library → cari "Google Sheets API" → Enable

### Langkah 2: Buat OAuth2 Credentials

1. Buka **APIs & Services** → **Credentials**
2. Klik **Create Credentials** → **OAuth client ID**
3. Pilih Application type: **Chrome extension**
4. Masukkan **Application ID** (ID extension dari `chrome://extensions/`)
5. Klik **Create** → Copy **Client ID**

### Langkah 3: Update manifest.json

```json
"oauth2": {
  "client_id": "PASTE_CLIENT_ID_ANDA_DISINI.apps.googleusercontent.com",
  "scopes": ["https://www.googleapis.com/auth/spreadsheets"]
}
```

### Langkah 4: Reload Extension

Di `chrome://extensions/` → klik tombol reload (🔄) pada extension ini.

## 🔧 Troubleshooting

| Masalah | Solusi |
|---|---|
| Data tidak muncul | Refresh halaman produk, lalu buka popup lagi |
| "Bukan halaman produk" | Pastikan URL mengandung format `-i.shopid.itemid` |
| Review kosong | Klik tombol "Ambil Review" |
| Google Sheets error | Pastikan OAuth2 sudah di-setup dengan benar |
| Extension tidak aktif | Pastikan sudah di-enable di `chrome://extensions/` |

## 📁 Struktur File

```
shopee-scraper/
├── manifest.json           # Konfigurasi extension MV3
├── background/
│   └── service-worker.js   # Background worker
├── content/
│   ├── injector.js         # Content script (bridge)
│   └── interceptor.js      # Intercept API Shopee
├── popup/
│   ├── popup.html          # UI popup
│   ├── popup.js            # Logic popup
│   └── popup.css           # Styling popup
├── utils/
│   ├── parser.js           # Parser data mentah
│   └── exporter.js         # Export JSON/CSV/Sheets
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## ⚠️ Disclaimer

Extension ini dibuat untuk keperluan riset dan analisis kompetitor.
Gunakan secara bertanggung jawab dan patuhi Terms of Service Shopee.
Jangan melakukan scraping secara agresif (rate limit).

## 📝 Lisensi

MIT License — gunakan dan modifikasi sesuka hati.
