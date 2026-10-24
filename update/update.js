/**
 * update.js
 * ==========
 * Halaman update extension dari dalam extension, tanpa install-update.bat.
 * User memilih folder extension SEKALI (handle-nya disimpan di IndexedDB);
 * update berikutnya cukup 1 klik. Logika unduh + tulis ada di utils/updater.js.
 *
 * Halaman ini dibuka sebagai tab (bukan popup) karena popup tertutup sendiri
 * begitu dialog pilih folder muncul.
 */

(function () {
  'use strict';

  const DIR_KEY = 'extensionDir';
  const EXTENSION_NAME = chrome.runtime.getManifest().name;

  const $ = (id) => document.getElementById(id);
  const el = {
    verNow: $('ver-now'),
    verNew: $('ver-new'),
    changelog: $('changelog'),
    folderName: $('folder-name'),
    folderHelp: $('folder-help'),
    btnShowPath: $('btn-show-path'),
    btnChange: $('btn-change-folder'),
    btnUpdate: $('btn-update'),
    btnReload: $('btn-reload'),
    progress: $('progress'),
    bar: $('progress-bar'),
    status: $('status')
  };

  // ========================================
  // IndexedDB — menyimpan handle folder antar sesi
  // ========================================
  function withStore(mode, fn) {
    return new Promise((resolve, reject) => {
      const open = indexedDB.open('shopeeScraperUpdater', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('kv');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction('kv', mode);
        const req = fn(tx.objectStore('kv'));
        tx.oncomplete = () => { db.close(); resolve(req.result); };
        tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
      };
    });
  }
  const kvGet = (key) => withStore('readonly', (s) => s.get(key));
  const kvSet = (key, val) => withStore('readwrite', (s) => s.put(val, key));
  const kvDelete = (key) => withStore('readwrite', (s) => s.delete(key));

  // ========================================
  // UI helpers
  // ========================================
  function setStatus(text, kind) {
    el.status.textContent = text;
    el.status.className = 'status' + (kind ? ' ' + kind : '');
  }

  function setProgress(pct) {
    el.progress.classList.remove('d-none');
    el.bar.style.width = pct + '%';
  }

  function setBusy(busy) {
    el.btnUpdate.disabled = busy;
    el.btnChange.disabled = busy;
  }

  function showFolder(dir) {
    el.folderName.textContent = dir ? dir.name : 'Belum dipilih';
    el.folderHelp.classList.toggle('d-none', !!dir);
    el.btnChange.classList.toggle('d-none', !dir);
    el.btnUpdate.textContent = dir ? '⬇️ Update sekarang' : '📂 Pilih folder & update';
  }

  function renderUpdateInfo(info) {
    if (info && info.remoteVersion) {
      el.verNew.textContent = 'v' + info.remoteVersion;
      el.changelog.textContent = info.changelog || '';
    } else {
      el.verNew.textContent = 'v' + chrome.runtime.getManifest().version + ' ✓';
      el.changelog.textContent = 'Sudah versi terbaru. Tombol di bawah tetap bisa dipakai untuk memasang ulang file.';
    }
  }

  // ========================================
  // Folder extension
  // ========================================
  async function ensureWritable(dir) {
    const opts = { mode: 'readwrite' };
    if ((await dir.queryPermission(opts)) === 'granted') return true;
    return (await dir.requestPermission(opts)) === 'granted';
  }

  /**
   * Chrome membaca file extension langsung dari disk, jadi file yang baru dibuat di
   * folder yang BENAR akan terbaca lewat chrome.runtime.getURL(). Ini mendeteksi kasus
   * "update berhasil tapi versi tidak berubah" karena folder yang dipilih hanya salinan
   * lain (mis. folder lama), bukan folder yang dimuat Chrome.
   *
   * @returns {Promise<'same'|'different'|'unknown'>} 'unknown' = pengecekan sendiri gagal
   */
  async function checkLoadedFolder(dir) {
    const name = `update-probe-${Date.now()}.txt`;
    let wrote = false;
    try {
      const writable = await (await dir.getFileHandle(name, { create: true })).createWritable();
      await writable.write('probe');
      await writable.close();
      wrote = true;
      const resp = await fetch(chrome.runtime.getURL(name), { cache: 'no-store' });
      return resp.ok ? 'same' : 'different';
    } catch (e) {
      // Sudah tertulis tapi tidak terbaca Chrome = folder lain; gagal menulis = tidak bisa dipastikan
      return wrote ? 'different' : 'unknown';
    } finally {
      try { await dir.removeEntry(name); } catch (e) { /* sudah tidak ada */ }
    }
  }

  const NOT_LOADED_FOLDER_HELP =
    'Folder ini BUKAN folder yang sedang dimuat Chrome. File akan terpasang di sini, ' +
    'tetapi extension yang Anda pakai tidak berubah.\n\n' +
    'Klik "Lihat lokasi folder di Chrome", lihat baris "Source" / "Sumber", lalu pilih folder itu.';

  async function chooseFolder() {
    const dir = await window.showDirectoryPicker({ id: 'shopee-scraper-extension', mode: 'readwrite' });
    await ShopeeUpdater.assertExtensionDir(dir, EXTENSION_NAME);

    if ((await checkLoadedFolder(dir)) === 'different') {
      const proceed = confirm(NOT_LOADED_FOLDER_HELP + '\n\nTetap lanjutkan dengan folder ini?');
      if (!proceed) throw new DOMException('Dibatalkan', 'AbortError');
    }

    await kvSet(DIR_KEY, dir);
    return dir;
  }

  // ========================================
  // Update
  // ========================================
  async function runUpdate() {
    setBusy(true);
    el.btnReload.classList.add('d-none');
    try {
      let dir = await kvGet(DIR_KEY);
      if (dir) {
        if (!(await ensureWritable(dir))) {
          throw new Error('Izin menulis ke folder ditolak. Klik Update lagi, lalu pilih "Izinkan".');
        }
        await ShopeeUpdater.assertExtensionDir(dir, EXTENSION_NAME);
        // Folder tersimpan dari sesi lalu bisa saja bukan folder yang dimuat Chrome
        if ((await checkLoadedFolder(dir)) === 'different') {
          throw new Error(NOT_LOADED_FOLDER_HELP.replace('\n\n', ' ') + ' Lalu klik "Ganti folder".');
        }
      } else {
        dir = await chooseFolder();
      }
      showFolder(dir);

      const result = await ShopeeUpdater.install(dir, {
        expectedName: EXTENSION_NAME,
        onProgress: (pct, text) => { setProgress(pct); setStatus(text); }
      });

      setStatus(
        `✅ File v${result.version} sudah terpasang (${result.written} file diperbarui, ${result.unchanged} tidak berubah). ` +
        'Klik tombol di bawah untuk memakai versi barunya, lalu refresh tab Shopee yang sedang terbuka.',
        'ok'
      );
      el.btnReload.classList.remove('d-none');
    } catch (e) {
      if (e && e.name === 'AbortError') {
        setStatus('Dibatalkan.');
      } else {
        console.error('[Shopee Scraper] Update gagal:', e);
        setStatus('❌ ' + (e && e.message ? e.message : e), 'error');
      }
    } finally {
      setBusy(false);
    }
  }

  async function changeFolder() {
    await kvDelete(DIR_KEY);
    showFolder(null);
    await runUpdate(); // masih di dalam klik user, jadi dialog pilih folder boleh langsung muncul
  }

  // ========================================
  // Event & init
  // ========================================
  el.btnUpdate.addEventListener('click', runUpdate);
  el.btnChange.addEventListener('click', changeFolder);

  el.btnShowPath.addEventListener('click', () => {
    chrome.tabs.create({ url: 'chrome://extensions/?id=' + chrome.runtime.id });
  });

  el.btnReload.addEventListener('click', async () => {
    try { await chrome.runtime.sendMessage({ action: 'RELOAD_EXTENSION_NOW' }); } catch (e) { /* worker sedang restart */ }
    // Tab ini ikut rusak saat extension dimuat ulang, jadi tutup dulu.
    chrome.tabs.getCurrent((tab) => { if (tab) chrome.tabs.remove(tab.id); });
  });

  async function init() {
    el.verNow.textContent = 'v' + chrome.runtime.getManifest().version;

    try {
      showFolder(await kvGet(DIR_KEY));
    } catch (e) {
      showFolder(null);
    }

    try {
      const resp = await chrome.runtime.sendMessage({ action: 'CHECK_FOR_UPDATE_NOW' });
      renderUpdateInfo(resp && resp.updateInfo);
    } catch (e) {
      el.verNew.textContent = 'Tidak bisa dicek';
    }
  }

  init();
})();
