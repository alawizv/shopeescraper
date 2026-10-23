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
   * Semua validasi dilakukan SEBELUM ada file yang ditulis, dan manifest.json
   * ditulis paling akhir, jadi kegagalan di tengah jalan tidak meninggalkan
   * manifest baru yang menunjuk ke file lama.
   *
   * @param {FileSystemDirectoryHandle} dir
   * @param {{expectedName: string, onProgress?: (pct: number, text: string) => void, fetchZip?: () => Promise<ArrayBuffer>}} opts
   * @returns {Promise<{version: string, fileCount: number}>}
   */
  async install(dir, { expectedName, onProgress = () => {}, fetchZip = () => this.fetchZip() } = {}) {
    onProgress(5, 'Mengunduh versi terbaru dari GitHub…');
    const buffer = await fetchZip();

    onProgress(25, 'Membuka file unduhan…');
    const entries = await ShopeeZip.unzip(buffer);
    // GitHub membungkus isi repo dalam satu folder teratas ("shopeescraper-main/")
    const top = entries.length ? entries[0].path.split('/')[0] + '/' : '';
    const files = entries
      .filter(e => e.path.startsWith(top))
      .map(e => ({ path: e.path.slice(top.length), data: e.data }));
    files.forEach(f => this._assertSafePath(f.path));

    const manifestFile = files.find(f => f.path === 'manifest.json');
    if (!manifestFile) {
      throw new Error('File unduhan tidak berisi manifest.json. Update dibatalkan, file kamu tidak diubah.');
    }

    let manifestText = new TextDecoder().decode(manifestFile.data);
    const newManifest = JSON.parse(manifestText);
    if (newManifest.name !== expectedName) {
      throw new Error('File unduhan bukan extension yang sama. Update dibatalkan, file kamu tidak diubah.');
    }

    const oldManifest = await this.assertExtensionDir(dir, expectedName);
    const clientId = oldManifest.oauth2 && oldManifest.oauth2.client_id;
    if (clientId && !clientId.startsWith('GANTI_DENGAN')) {
      manifestText = manifestText.replace(this.PLACEHOLDER_CLIENT_ID, () => clientId);
      JSON.parse(manifestText); // pastikan tetap JSON valid
    }

    const others = files.filter(f => f !== manifestFile);
    for (let i = 0; i < others.length; i++) {
      onProgress(30 + Math.round(((i + 1) / others.length) * 65), `Menyalin ${others[i].path}…`);
      await this._writeFile(dir, others[i].path, others[i].data);
    }
    await this._writeFile(dir, 'manifest.json', new TextEncoder().encode(manifestText));

    onProgress(100, 'Selesai');
    return { version: newManifest.version, fileCount: files.length };
  },

  _assertSafePath(relPath) {
    const parts = relPath.split('/');
    if (parts.some(p => !p || p === '.' || p === '..' || /[\\:]/.test(p))) {
      throw new Error(`Path tidak aman di file unduhan: ${relPath}`);
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
