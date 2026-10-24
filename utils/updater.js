/**
 * updater.js
 * ===========
 * Logika update extension dari dalam extension (tanpa install-update.bat):
 * unduh ZIP versi terbaru dari GitHub, lalu tulis ke folder extension lewat
 * File System Access API.
 *
 * Sengaja tidak menyentuh DOM maupun chrome.* supaya bisa diuji di Node.
 * Membutuhkan ShopeeZip (utils/zip-reader.js) sudah dimuat.
 */

var ShopeeUpdater = {

  ZIP_URL: 'https://codeload.github.com/alawizv/shopeescraper/zip/refs/heads/main',

  // Nilai bawaan di manifest.json. Kalau user sudah mengisi Client ID sendiri,
  // nilai itu dipertahankan saat manifest.json ditimpa (sama seperti install-update.bat).
  PLACEHOLDER_CLIENT_ID: 'GANTI_DENGAN_CLIENT_ID_GOOGLE_ANDA.apps.googleusercontent.com',

  // Berkas yang hanya berguna untuk pengembangan; tidak perlu ada di folder extension pengguna.
  // Tidak menulisnya juga mengurangi jumlah file .js yang harus dipindai antivirus.
  DEV_ONLY_PREFIXES: ['tests/', 'dev/', '.github/'],

  async fetchZip() {
    const resp = await fetch(this.ZIP_URL, { cache: 'no-store' });
    if (!resp.ok) throw new Error(`Gagal mengunduh dari GitHub (HTTP ${resp.status}).`);
    return resp.arrayBuffer();
  },

  async readManifest(dir) {
    const fileHandle = await dir.getFileHandle('manifest.json');
    return JSON.parse(await (await fileHandle.getFile()).text());
  },

  /**
   * Pastikan folder yang dipilih memang folder extension ini, bukan folder sembarang.
   * @returns manifest.json folder tersebut
   */
  async assertExtensionDir(dir, expectedName) {
    let manifest;
    try {
      manifest = await this.readManifest(dir);
    } catch (e) {
      throw new Error('Folder ini tidak berisi manifest.json. Pilih folder extension (yang ada file manifest.json-nya).');
    }
    if (manifest.name !== expectedName) {
      throw new Error(`Folder ini bukan folder extension "${expectedName}".`);
    }
    return manifest;
  },

  /**
   * Unduh versi terbaru dan timpa isi folder extension.
   * Semua validasi dilakukan SEBELUM ada file yang ditulis. Hanya file yang isinya
   * berbeda yang ditulis, dan manifest.json paling akhir. Kalau satu penulisan gagal
   * (mis. antivirus memblokir sebuah file), semua file yang sudah ditulis dikembalikan
   * ke isi semula, jadi folder tidak tertinggal setengah ter-update.
   *
   * @param {FileSystemDirectoryHandle} dir
   * @param {{expectedName: string, onProgress?: (pct: number, text: string) => void, fetchZip?: () => Promise<ArrayBuffer>}} opts
   * @returns {Promise<{version: string, fileCount: number, written: number, unchanged: number}>}
   */
  async install(dir, { expectedName, onProgress = () => {}, fetchZip = () => this.fetchZip() } = {}) {
    onProgress(5, 'Mengunduh versi terbaru dari GitHub…');
    const buffer = await fetchZip();

    onProgress(25, 'Membuka file unduhan…');
    const entries = await ShopeeZip.unzip(buffer);
    // GitHub membungkus isi repo dalam satu folder teratas ("shopeescraper-main/")
    const top = entries.length ? entries[0].path.split('/')[0] + '/' : '';
    const allFiles = entries
      .filter(e => e.path.startsWith(top))
      .map(e => ({ path: e.path.slice(top.length), data: e.data }));
    allFiles.forEach(f => this._assertSafePath(f.path));
    const files = allFiles.filter(f => !this.DEV_ONLY_PREFIXES.some(prefix => f.path.startsWith(prefix)));

    const manifestFile = files.find(f => f.path === 'manifest.json');
    if (!manifestFile) {
      throw new Error('File unduhan tidak berisi manifest.json. Update dibatalkan, file kamu tidak diubah.');
    }

    let manifestText = new TextDecoder().decode(manifestFile.data);
    const newManifest = JSON.parse(manifestText);
    if (newManifest.name !== expectedName) {
      throw new Error('File unduhan bukan extension yang sama. Update dibatalkan, file kamu tidak diubah.');
    }
    this._assertManifestFilesPresent(newManifest, new Set(files.map(f => f.path)));

    const oldManifest = await this.assertExtensionDir(dir, expectedName);
    const clientId = oldManifest.oauth2 && oldManifest.oauth2.client_id;
    if (clientId && !clientId.startsWith('GANTI_DENGAN')) {
      manifestText = manifestText.replace(this.PLACEHOLDER_CLIENT_ID, () => clientId);
      JSON.parse(manifestText); // pastikan tetap JSON valid
    }

    const queue = [
      ...files.filter(f => f !== manifestFile),
      { path: 'manifest.json', data: new TextEncoder().encode(manifestText) }
    ];
    const backups = [];
    let written = 0;
    let unchanged = 0;

    for (let i = 0; i < queue.length; i++) {
      const file = queue[i];
      onProgress(30 + Math.round(((i + 1) / queue.length) * 65), `Memeriksa ${file.path}…`);

      const existing = await this._readExisting(dir, file.path);
      if (existing.bytes && this._sameBytes(existing.bytes, file.data)) {
        unchanged++;
        continue;
      }

      backups.push({ path: file.path, existing });
      try {
        await this._writeFile(dir, file.path, file.data);
        written++;
      } catch (e) {
        const notRestored = await this._rollback(dir, backups);
        throw this._writeError(file.path, e, notRestored);
      }
    }

    onProgress(100, 'Selesai');
    return { version: newManifest.version, fileCount: files.length, written, unchanged };
  },

  _assertSafePath(relPath) {
    const parts = relPath.split('/');
    if (parts.some(p => !p || p === '.' || p === '..' || /[\\:]/.test(p))) {
      throw new Error(`Path tidak aman di file unduhan: ${relPath}`);
    }
  },

  /**
   * Manifest yang merujuk ke file yang tidak ada di unduhan membuat Chrome menolak
   * memuat extension. Lebih baik batal sekarang, sebelum ada yang ditulis.
   */
  _assertManifestFilesPresent(manifest, available) {
    const refs = new Set();
    (manifest.content_scripts || []).forEach(group => {
      [...(group.js || []), ...(group.css || [])].forEach(f => refs.add(f));
    });
    if (manifest.background && manifest.background.service_worker) refs.add(manifest.background.service_worker);
    if (manifest.action && manifest.action.default_popup) refs.add(manifest.action.default_popup);
    Object.values(manifest.icons || {}).forEach(f => refs.add(f));
    Object.values((manifest.action && manifest.action.default_icon) || {}).forEach(f => refs.add(f));
    (manifest.web_accessible_resources || []).forEach(group => {
      (group.resources || []).filter(r => !r.includes('*')).forEach(f => refs.add(f));
    });

    const missing = [...refs].filter(f => !available.has(f));
    if (missing.length) {
      throw new Error(
        `File unduhan tidak lengkap: manifest.json merujuk ke ${missing.join(', ')} yang tidak ada. ` +
        'Update dibatalkan, file kamu tidak diubah.'
      );
    }
  },

  /** Isi file yang sekarang ada di folder. `unreadable` = ada tapi tidak bisa dibaca. */
  async _readExisting(root, relPath) {
    const parts = relPath.split('/');
    try {
      let dir = root;
      for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
      const file = await (await dir.getFileHandle(parts[parts.length - 1])).getFile();
      return { bytes: new Uint8Array(await file.arrayBuffer()), unreadable: false };
    } catch (e) {
      if (e && e.name === 'NotFoundError') return { bytes: null, unreadable: false };
      return { bytes: null, unreadable: true };
    }
  },

  _sameBytes(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  },

  /**
   * Kembalikan file yang sudah sempat ditulis ke isi semula (urutan terbalik).
   * @returns {Promise<string[]>} path yang TIDAK bisa dikembalikan
   */
  async _rollback(root, backups) {
    const notRestored = [];
    for (const { path, existing } of [...backups].reverse()) {
      try {
        if (existing.unreadable) {
          notRestored.push(path); // isi lama tidak sempat dibaca, tidak ada cadangan
        } else if (existing.bytes === null) {
          await this._removeFile(root, path); // file baru yang dibuat update ini
        } else {
          await this._writeFile(root, path, existing.bytes);
        }
      } catch (e) {
        notRestored.push(path);
      }
    }
    return notRestored;
  },

  _writeError(path, cause, notRestored) {
    const detail = cause && cause.message ? `${cause.name || 'Error'}: ${cause.message}` : String(cause);
    const restoreNote = notRestored.length
      ? `Update dibatalkan, tetapi file ini belum bisa dikembalikan: ${notRestored.join(', ')}.`
      : 'Update dibatalkan dan semua file dikembalikan seperti semula.';
    const err = new Error(
      `Gagal menulis "${path}" (${detail}). ` +
      'Kemungkinan antivirus (mis. Windows Defender) memblokir file ini: cek Windows Security > ' +
      `Perlindungan virus & ancaman > Riwayat perlindungan. ${restoreNote}`
    );
    err.name = 'UpdateWriteError';
    err.path = path;
    err.notRestored = notRestored;
    err.cause = cause;
    return err;
  },

  async _removeFile(root, relPath) {
    const parts = relPath.split('/');
    try {
      let dir = root;
      for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
      await dir.removeEntry(parts[parts.length - 1]);
    } catch (e) {
      if (!e || e.name !== 'NotFoundError') throw e; // belum sempat terbentuk = tidak ada yang perlu dihapus
    }
  },

  async _writeFile(root, relPath, data) {
    const parts = relPath.split('/');
    let dir = root;
    for (const part of parts.slice(0, -1)) {
      dir = await dir.getDirectoryHandle(part, { create: true });
    }
    const fileHandle = await dir.getFileHandle(parts[parts.length - 1], { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(data);
    await writable.close();
  }
};

if (typeof module !== 'undefined') {
  module.exports = ShopeeUpdater;
}
