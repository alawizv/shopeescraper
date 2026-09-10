# 🛍️ Shopee Product Scraper — Chrome Extension

Chrome Extension MV3 untuk men-scrape data produk dari halaman produk Shopee Indonesia.

## ✨ Fitur

- **Data Produk**: Nama, harga, rating, total terjual, jumlah ulasan
- **Varian Produk**: Tier 1 & 2 (warna, ukuran, dll.) dengan stok dan harga per kombinasi
- **Review Negatif**: Bintang 1–3 dengan komentar, tanggal, username, dan varian yang dibeli
- **Export**: JSON, CSV, dan Google Sheets
- **Otomatis**: Intercept API Shopee dengan fallback ke DOM scraping

## 📦 Instalasi

> Tidak perlu punya akun GitHub. Tidak perlu install Git. Cukup 1 file.

### Langkah 1: Unduh file pemasang

Unduh **`install-update.bat`** dari repo ini
([klik kanan link ini → Save link as](https://raw.githubusercontent.com/alawizv/shopeescraper/main/install-update.bat)),
simpan di mana saja — misalnya Desktop.

### Langkah 2: Klik dua kali file itu

File tersebut akan mengunduh extension versi terbaru secara otomatis ke folder:

```
Documents\ShopeeScraperExtension
```

Kalau Windows menampilkan peringatan **"Windows protected your PC"**,
klik **More info** → **Run anyway**. (Peringatan ini muncul karena file `.bat`
diunduh dari internet, bukan karena file-nya berbahaya.)

### Langkah 3: Pasang ke Chrome

Setelah unduhan selesai, halaman Extensions Chrome terbuka sendiri. Lakukan 4 langkah
yang juga ditampilkan di layar:

1. Nyalakan **Developer mode** (tombol geser di pojok kanan atas)
2. Klik **Load unpacked**
3. Pilih folder `Documents\ShopeeScraperExtension`
4. Klik **Select Folder**

Ikon extension akan muncul di toolbar Chrome. Selesai.

---

## Update

Extension mengecek versi terbaru sendiri **setiap 24 jam**. Kalau ada versi baru,
akan muncul:

- Notifikasi Windows di pojok kanan bawah layar
- Tulisan **NEW** berwarna merah di ikon extension
- Banner hijau di dalam popup extension

### Cara memperbarui (2 langkah)

**1. Klik dua kali `install-update.bat`** — file yang sama seperti waktu instalasi.
File ini otomatis tahu bahwa extension sudah terpasang, jadi ia hanya mengunduh
file-file yang baru. Tidak akan menghapus data hasil scraping.

**2. Klik ikon extension di Chrome → klik tombol "Muat Ulang"** di dalam popup.

Selesai. Versi baru langsung aktif tanpa perlu memasang ulang di `chrome://extensions`.

> **Ingin cek update sekarang juga?** Klik tulisan versi (`v1.2.0`) di pojok kanan
> atas popup. Kalau sudah versi terbaru, akan berubah jadi **✓ Terbaru**.

### Kalau file `install-update.bat` hilang

Unduh ulang [di sini](https://raw.githubusercontent.com/alawizv/shopeescraper/main/install-update.bat)
(klik kanan → Save link as), lalu klik dua kali seperti biasa.

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
