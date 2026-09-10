# 🛍️ Shopee Product Scraper — Chrome Extension

Chrome Extension (Manifest V3) untuk riset produk dan analisis kompetitor di Shopee.
Mengambil data produk, varian, estimasi omset, dan menganalisis keluhan pembeli —
langsung dari halaman Shopee, tanpa perlu login ke mana pun.

Mendukung **11 negara Shopee** (Indonesia, Singapura, Malaysia, Filipina, Thailand,
Vietnam, Taiwan, Brasil, Meksiko, Kolombia, Chili) dengan simbol mata uang otomatis.

## ✨ Fitur

### Riset satu produk
- **Data produk** — nama, harga, rating, total terjual, jumlah ulasan
- **Varian** — tier 1 & 2 (warna, ukuran, dll.) lengkap dengan harga dan persentase penjualan per varian
- **Terjual / bulan** — diambil dari API Shopee, dengan label sumber datanya (PDP API / Search API / DOM)
- **Estimasi omset** — dua metode sekaligus, lihat [Cara Membaca Angkanya](#cara-membaca-angkanya)
- **Info toko** — nama, lokasi, jumlah pengikut, rating, status Mall / Star+ / Regular

### Analisis ulasan
- **Filter bintang** — pilih bebas (semua / negatif 1–3★ / 1★ saja / kombinasi sendiri)
- **Insight keluhan pembeli** — ulasan dikelompokkan otomatis ke 6 kategori masalah:
  kualitas bahan, barang rusak, ukuran tidak sesuai, pengiriman lambat,
  tidak sesuai foto, dan fungsi bermasalah
- **Sentimen & kata kunci** — persentase ulasan positif dan kata keluhan yang paling sering muncul
- Hanya ulasan berteks minimal 10 kata yang dianalisis, supaya "bagus" dan emoji tidak mengotori hasil

### Riset massal
- **Halaman pencarian** — tangkap sekaligus hingga 60 produk kompetitor dalam satu halaman,
  otomatis diurutkan berdasarkan estimasi omset, lengkap dengan statistik rata-rata pasar
- **Riwayat** — setiap produk yang di-scrape tersimpan di perangkat dan bisa dibuka lagi kapan saja

### Antarmuka
- **Panel melayang** di halaman Shopee — muncul otomatis, bisa digeser dan diminimize
- **Popup extension** dengan tampilan lengkap
- **Update otomatis terdeteksi** — lihat [bagian Update](#update)

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

### A. Riset satu produk

1. Buka halaman produk Shopee mana pun
   - Contoh: `https://shopee.co.id/nama-produk-i.123456.789012`
2. **Panel melayang muncul sendiri** di pojok kanan bawah halaman.
   Bisa juga klik ikon extension di toolbar untuk tampilan popup yang lebih lengkap.
3. Data produk langsung terisi otomatis
4. Atur **Filter Bintang Review** sesuai kebutuhan, lalu klik **🔄 Scrape Data**
   untuk mengambil ulasan (bisa dihentikan kapan saja lewat tombol **🛑 Stop**)
5. Klik **⚡ Muat Info Terjual & Toko** untuk melengkapi data terjual/bulan dan info toko

### B. Riset massal dari halaman pencarian

1. Cari kata kunci apa pun di Shopee, misalnya `kaos polos pria`
2. **Scroll perlahan sampai bawah** supaya semua produk termuat
3. Buka panel melayang → tampil tabel hingga 60 produk **urut dari omset tertinggi**,
   beserta rata-rata harga, rating, dan terjual/bulan di kategori tersebut
4. Klik **📋 Salin ke Sheets (TSV)** untuk langsung tempel ke spreadsheet,
   atau **📥 Simpan ke Riwayat**

### C. Riwayat

Semua produk yang pernah di-scrape tersimpan otomatis di perangkat (IndexedDB, tidak dikirim
ke mana pun). Dari bagian **Riwayat** di popup kamu bisa menyalin seluruhnya sebagai TSV,
mengunduh CSV, atau menghapus semuanya.

---

## Cara Membaca Angkanya

Bagian ini penting supaya tidak salah ambil keputusan.

### Terjual / bulan

Ada label sumber di sebelah angkanya:

| Label | Artinya | Tingkat keyakinan |
|---|---|---|
| **PDP API** | Angka resmi dari API halaman produk | Paling akurat |
| **Search API** | Angka dari hasil pencarian Shopee | Akurat |
| **DOM Scraping** | Dibaca dari tampilan halaman | Cukup |
| **(est)** | Diperkirakan dari jumlah ulasan | Kasar — perlakukan sebagai ancar-ancar |

### Estimasi omset

Ada dua angka, dihitung dengan cara berbeda supaya bisa saling dicek:

- **Omset Quick** = terjual per bulan × harga rata-rata.
  Cepat, tapi ikut meleset kalau angka terjual/bulan berlabel *(est)*.
- **Omset 30 Hari (Detail)** = ulasan 30 hari terakhir × harga varian yang dibeli × faktor koreksi.
  Faktor koreksi = total terjual ÷ total ulasan (karena tidak semua pembeli menulis ulasan).

Kalau kedua angka berjauhan, artinya data produk itu memang kurang meyakinkan —
jangan jadikan satu angka saja sebagai dasar keputusan.

### Persentase penjualan varian

Kalau Shopee membuka data penjualan per varian, yang dipakai adalah **angka asli**.
Kalau tidak, persentasenya diperkirakan dari varian yang disebut di ulasan — berguna untuk
melihat kecenderungan, tapi bukan angka pasti.

### Cakupan sampel ulasan

Bagian **Sampel Review** menampilkan berapa ulasan yang berhasil terbaca dibanding total ulasan.
Semakin tinggi persentasenya, semakin bisa dipercaya analisis keluhan dan omset detailnya.

---

## 📤 Export Data

| Tombol | Hasil | Perlu setup? |
|---|---|---|
| 📄 **JSON** | File `.json` berisi seluruh data mentah | Tidak |
| 📊 **CSV** | File `.csv`, siap dibuka di Excel | Tidak |
| 📋 **TSV** | Disalin ke clipboard — tinggal **Ctrl+V** ke Google Sheets atau Excel | Tidak |
| 📗 **Google Sheets** | Langsung terkirim ke spreadsheet | Ya, lihat di bawah |

> **Paling praktis: tombol TSV.** Baris pertamanya berupa *master tracking sheet* —
> satu baris berisi tanggal, nama produk, toko, lokasi, status toko, harga, terjual/bulan,
> estimasi omset, rating, jumlah ulasan, keluhan teratas, dan URL. Cocok untuk menumpuk
> banyak produk dalam satu spreadsheet riset. Tanpa setup apa pun.

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
| Data tidak muncul | Refresh halaman produk, tunggu 3–5 detik sampai halaman termuat penuh |
| "Bukan halaman produk" | Pastikan URL berformat `...-i.<shopid>.<itemid>` |
| Panel melayang tidak muncul | Refresh halaman. Kalau tadi diminimize, panel muncul lagi saat pindah produk |
| Ulasan kosong | Atur Filter Bintang lalu klik **Scrape Data**. Ulasan di bawah 10 kata memang sengaja dilewati |
| Produk pencarian tidak terbaca | Scroll perlahan sampai bawah halaman pencarian dulu, baru buka panel |
| Terjual/bulan kosong | Klik **⚡ Muat Info Terjual & Toko** |
| Angka omset terasa aneh | Cek label sumber datanya — lihat [Cara Membaca Angkanya](#cara-membaca-angkanya) |
| Google Sheets error | Pastikan OAuth2 sudah di-setup dan extension sudah di-reload |
| Extension tidak aktif | Cek statusnya di `chrome://extensions/` |

## 📁 Struktur File

```
ShopeeScraperExtension/
├── manifest.json              # Konfigurasi extension MV3
├── version.json               # Versi terbaru + changelog (dibaca pengecek update)
├── install-update.bat         # Pemasang & pembaru sekali klik
├── background/
│   └── service-worker.js      # Background worker, OAuth Sheets, pengecek update
├── content/
│   ├── injector.js            # Content script (jembatan) + fallback DOM scraping
│   ├── interceptor.js         # Menyadap respons API Shopee
│   └── panel.js               # Panel melayang di halaman (Shadow DOM)
├── popup/
│   ├── popup.html             # Struktur UI popup
│   ├── popup.js               # Logika popup
│   └── popup.css              # Styling popup
├── utils/
│   ├── parser.js              # Parser data mentah + analisis keluhan + hitung omset
│   ├── db.js                  # Riwayat produk (IndexedDB)
│   └── exporter.js            # Export JSON / CSV / TSV / Google Sheets
├── icons/
├── dev/                       # Berkas bantu pengembangan (tidak dipakai extension)
└── .github/workflows/
    └── auto-bump-version.yml  # Naikkan versi otomatis tiap push
```

## 🌏 Negara yang Didukung

`shopee.co.id` · `shopee.sg` · `shopee.com.my` · `shopee.ph` · `shopee.co.th` ·
`shopee.vn` · `shopee.tw` · `shopee.com.br` · `shopee.com.mx` · `shopee.com.co` · `shopee.cl`

Simbol mata uang menyesuaikan sendiri mengikuti domain yang sedang dibuka.

## 🔒 Privasi

Semua data disimpan **di perangkat kamu sendiri** (`chrome.storage` dan IndexedDB).
Tidak ada data produk maupun data pribadi yang dikirim ke server mana pun.
Satu-satunya koneksi keluar adalah:

- **Shopee** — mengambil data produk yang sedang kamu buka
- **raw.githubusercontent.com** — hanya membaca `version.json` untuk mengecek update
- **Google Sheets** — hanya kalau kamu sendiri yang menekan tombol export-nya

## ⚠️ Disclaimer

Extension ini dibuat untuk keperluan riset dan analisis kompetitor.
Gunakan secara bertanggung jawab dan patuhi Terms of Service Shopee.
Jangan melakukan scraping secara agresif.

## 📝 Lisensi

MIT License — gunakan dan modifikasi sesuka hati.
