/**
 * zip-reader.js
 * ==============
 * Pembaca ZIP minimal (tanpa library) untuk update dari dalam extension.
 * Hanya mendukung ZIP biasa: method stored (0) dan deflate (8), tanpa enkripsi
 * atau ZIP64 — cukup untuk arsip repo yang dibuat GitHub.
 *
 * Ukuran file dibaca dari central directory, bukan dari local header, karena
 * local header boleh kosong jika arsip memakai data descriptor.
 */

var ShopeeZip = {

  /**
   * @param {ArrayBuffer} buffer - isi berkas ZIP
   * @returns {Promise<Array<{path: string, data: Uint8Array}>>} semua file (direktori dilewati)
   */
  async unzip(buffer) {
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);
    const eocd = this._findEndOfCentralDirectory(view);
    const entryCount = view.getUint16(eocd + 10, true);
    let pos = view.getUint32(eocd + 16, true);
    if (entryCount === 0xFFFF || pos === 0xFFFFFFFF) {
      throw new Error('ZIP64 tidak didukung');
    }

    const decoder = new TextDecoder('utf-8');
    const files = [];

    for (let i = 0; i < entryCount; i++) {
      if (view.getUint32(pos, true) !== 0x02014b50) {
        throw new Error('Central directory ZIP rusak');
      }
      const method = view.getUint16(pos + 10, true);
      const compSize = view.getUint32(pos + 20, true);
      const size = view.getUint32(pos + 24, true);
      const nameLen = view.getUint16(pos + 28, true);
      const extraLen = view.getUint16(pos + 30, true);
      const commentLen = view.getUint16(pos + 32, true);
      const localOffset = view.getUint32(pos + 42, true);
      const path = decoder.decode(bytes.subarray(pos + 46, pos + 46 + nameLen));
      pos += 46 + nameLen + extraLen + commentLen;

      if (path.endsWith('/')) continue; // entri direktori

      if (view.getUint32(localOffset, true) !== 0x04034b50) {
        throw new Error(`Local header ZIP rusak: ${path}`);
      }
      const dataStart = localOffset + 30 +
        view.getUint16(localOffset + 26, true) +
        view.getUint16(localOffset + 28, true);
      const raw = bytes.subarray(dataStart, dataStart + compSize);

      let data;
      if (method === 0) {
        data = raw;
      } else if (method === 8) {
        data = await this._inflate(raw);
      } else {
        throw new Error(`Metode kompresi ZIP ${method} tidak didukung: ${path}`);
      }
      if (data.length !== size) {
        throw new Error(`Ukuran hasil ekstrak tidak cocok: ${path}`);
      }
      files.push({ path, data });
    }
    return files;
  },

  _findEndOfCentralDirectory(view) {
    const lowest = Math.max(0, view.byteLength - 22 - 0xFFFF);
    for (let i = view.byteLength - 22; i >= lowest; i--) {
      if (view.getUint32(i, true) === 0x06054b50) return i;
    }
    throw new Error('Bukan berkas ZIP yang valid');
  },

  async _inflate(raw) {
    const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
};

if (typeof module !== 'undefined') {
  module.exports = ShopeeZip;
}
