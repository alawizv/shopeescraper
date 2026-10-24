const test = require('node:test');
const assert = require('node:assert/strict');
const ShopeeUpdater = require('../utils/updater.js');

const NAME = 'Shopee Product Scraper';
const PLACEHOLDER = ShopeeUpdater.PLACEHOLDER_CLIENT_ID;
const enc = (s) => new TextEncoder().encode(s);
const dec = (b) => new TextDecoder().decode(b);

// Manifest minimal yang merujuk ke file-file yang harus ikut terunduh
function manifest({ version, clientId = PLACEHOLDER, name = NAME, extra = {} } = {}) {
  return JSON.stringify({
    name,
    version,
    content_scripts: [{ js: ['utils/antibot.js', 'content/injector.js'] }],
    background: { service_worker: 'background/sw.js' },
    action: { default_popup: 'popup/popup.html', default_icon: { 16: 'icons/i.png' } },
    icons: { 16: 'icons/i.png' },
    oauth2: { client_id: clientId },
    ...extra
  }, null, 2);
}

const NEW_FILES = {
  'manifest.json': manifest({ version: '2.0.0' }),
  'background/sw.js': 'sw baru',
  'content/injector.js': 'injector baru',
  'icons/i.png': 'png',
  'popup/popup.html': '<html>baru</html>',
  'update/update.js': 'update baru',
  'utils/antibot.js': 'antibot baru',
  // berkas pengembangan yang tidak boleh sampai ke folder extension
  'tests/a.test.js': 'tes',
  'dev/catatan.md': 'dev',
  '.github/workflows/x.yml': 'ci'
};

// ZIP palsu: ShopeeUpdater hanya memakai ShopeeZip.unzip(), jadi cukup mengembalikan entri.
function useZip(files, top = 'shopeescraper-main/') {
  globalThis.ShopeeZip = {
    unzip: async () => Object.entries(files).map(([path, text]) => ({ path: top + path, data: enc(text) }))
  };
}

// Folder tiruan berbasis peta datar path -> byte, meniru FileSystemDirectoryHandle.
function createFs(initial = {}) {
  const fs = {
    files: new Map(),
    dirs: new Set(),
    writes: [],                 // path yang berhasil ditulis, berurutan
    failWhen: () => null,       // (path, bytes) => Error | null, dievaluasi saat close()
    unreadable: new Set()       // path yang ada tapi tidak bisa dibaca
  };
  Object.entries(initial).forEach(([p, text]) => fs.files.set(p, enc(text)));

  const notFound = () => Object.assign(new Error('tidak ada'), { name: 'NotFoundError' });
  const handle = (prefix) => ({
    name: 'ext',
    async getDirectoryHandle(name, { create } = {}) {
      const p = prefix + name + '/';
      const exists = fs.dirs.has(p) || [...fs.files.keys()].some((k) => k.startsWith(p));
      if (!exists && !create) throw notFound();
      fs.dirs.add(p);
      return handle(p);
    },
    async getFileHandle(name, { create } = {}) {
      const p = prefix + name;
      if (!fs.files.has(p)) {
        if (!create) throw notFound();
        fs.files.set(p, new Uint8Array()); // Chrome langsung membuat file kosong
      }
      return {
        async getFile() {
          if (fs.unreadable.has(p)) throw Object.assign(new Error('diblokir'), { name: 'NotReadableError' });
          const bytes = fs.files.get(p);
          return {
            text: async () => dec(bytes),
            arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
          };
        },
        async createWritable() {
          let pending = new Uint8Array();
          return {
            async write(data) { pending = typeof data === 'string' ? enc(data) : new Uint8Array(data); },
            async close() {
              const error = fs.failWhen(p, pending);
              if (error) throw error;
              fs.files.set(p, pending);
              fs.writes.push(p);
            }
          };
        }
      };
    },
    async removeEntry(name) {
      const p = prefix + name;
      if (!fs.files.has(p)) throw notFound();
      fs.files.delete(p);
    }
  });

  fs.dir = handle('');
  fs.text = (p) => (fs.files.has(p) ? dec(fs.files.get(p)) : undefined);
  fs.snapshot = () => Object.fromEntries([...fs.files].map(([p, b]) => [p, dec(b)]));
  return fs;
}

const OLD_FILES = {
  'manifest.json': manifest({ version: '1.0.0' }),
  'background/sw.js': 'sw lama',
  'content/injector.js': 'injector lama',
  'icons/i.png': 'png',
  'popup/popup.html': '<html>lama</html>',
  'update/update.js': 'update lama'
};

const install = (fs, opts = {}) => ShopeeUpdater.install(fs.dir, { expectedName: NAME, fetchZip: async () => new ArrayBuffer(0), ...opts });

test('update normal: file baru tertulis, folder teratas ZIP dibuang, manifest paling akhir', async () => {
  useZip(NEW_FILES);
  const fs = createFs(OLD_FILES);
  const result = await install(fs);

  assert.equal(result.version, '2.0.0');
  assert.equal(fs.text('content/injector.js'), 'injector baru');
  assert.equal(fs.text('utils/antibot.js'), 'antibot baru');
  assert.equal(JSON.parse(fs.text('manifest.json')).version, '2.0.0');
  assert.equal(fs.writes[fs.writes.length - 1], 'manifest.json', 'manifest.json ditulis terakhir');
  assert.equal(fs.writes.filter((p) => p === 'manifest.json').length, 1);
});

test('berkas pengembangan (tests/, dev/, .github/) tidak disalin ke folder extension', async () => {
  useZip(NEW_FILES);
  const fs = createFs(OLD_FILES);
  const result = await install(fs);

  const paths = [...fs.files.keys()];
  assert.ok(!paths.some((p) => p.startsWith('tests/') || p.startsWith('dev/') || p.startsWith('.github/')), paths.join(', '));
  assert.equal(result.fileCount, 7);
});

test('hanya file yang berubah yang ditulis; yang sama persis dilewati', async () => {
  useZip(NEW_FILES);
  const fs = createFs({ ...OLD_FILES, 'popup/popup.html': NEW_FILES['popup/popup.html'], 'icons/i.png': 'png' });
  const result = await install(fs);

  assert.ok(!fs.writes.includes('popup/popup.html'));
  assert.ok(!fs.writes.includes('icons/i.png'));
  assert.ok(fs.writes.includes('content/injector.js'));
  assert.equal(result.unchanged, 2);
  assert.equal(result.written, result.fileCount - 2);
});

test('menjalankan update dua kali: kali kedua tidak menulis apa pun', async () => {
  useZip(NEW_FILES);
  const fs = createFs(OLD_FILES);
  await install(fs);
  fs.writes.length = 0;

  const second = await install(fs);
  assert.deepEqual(fs.writes, []);
  assert.equal(second.written, 0);
  assert.equal(second.unchanged, second.fileCount);
});

test('Client ID milik user dipertahankan; placeholder dibiarkan', async () => {
  useZip(NEW_FILES);
  const withId = createFs({ ...OLD_FILES, 'manifest.json': manifest({ version: '1.0.0', clientId: 'milik-user.apps.googleusercontent.com' }) });
  await install(withId);
  assert.equal(JSON.parse(withId.text('manifest.json')).oauth2.client_id, 'milik-user.apps.googleusercontent.com');

  const placeholder = createFs(OLD_FILES);
  await install(placeholder);
  assert.equal(JSON.parse(placeholder.text('manifest.json')).oauth2.client_id, PLACEHOLDER);
});

test('file yang tidak ada di ZIP tidak dihapus', async () => {
  useZip(NEW_FILES);
  const fs = createFs({ ...OLD_FILES, 'catatan-saya.txt': 'tetap ada' });
  await install(fs);
  assert.equal(fs.text('catatan-saya.txt'), 'tetap ada');
});

// ── Kegagalan menulis (mis. antivirus memblokir satu file) ──

const virusError = () => Object.assign(new Error('The user aborted a request.'), { name: 'AbortError' });
const blockNewUpdateJs = (fs) => {
  // Meniru Defender: isi BARU update.js ditolak, isi lama tetap boleh ditulis
  fs.failWhen = (p, bytes) => (p === 'update/update.js' && dec(bytes) === 'update baru' ? virusError() : null);
};

test('penulisan gagal di tengah jalan: semua file dikembalikan persis seperti semula', async () => {
  useZip(NEW_FILES);
  const fs = createFs(OLD_FILES);
  const before = fs.snapshot();
  blockNewUpdateJs(fs);

  await assert.rejects(install(fs), (e) => {
    assert.equal(e.name, 'UpdateWriteError');
    assert.equal(e.path, 'update/update.js');
    assert.match(e.message, /update\/update\.js/);
    assert.match(e.message, /antivirus/i);
    assert.match(e.message, /dikembalikan seperti semula/);
    assert.deepEqual(e.notRestored, []);
    return true;
  });

  assert.deepEqual(fs.snapshot(), before, 'folder tidak boleh tertinggal setengah ter-update');
});

test('penulisan gagal: file BARU yang sempat dibuat ikut dihapus', async () => {
  useZip(NEW_FILES);
  const fs = createFs(OLD_FILES); // utils/antibot.js belum ada
  fs.failWhen = (p) => (p === 'utils/antibot.js' ? virusError() : null);

  await assert.rejects(install(fs), /utils\/antibot\.js/);
  assert.ok(!fs.files.has('utils/antibot.js'), 'file kosong sisa penulisan yang gagal harus dibersihkan');
  assert.equal(JSON.parse(fs.text('manifest.json')).version, '1.0.0');
});

test('manifest.json baru tidak pernah tertulis kalau ada file lain yang gagal', async () => {
  useZip(NEW_FILES);
  const fs = createFs(OLD_FILES);
  blockNewUpdateJs(fs);
  await assert.rejects(install(fs));
  assert.ok(!fs.writes.includes('manifest.json'));
});

test('kalau file lama juga tidak bisa dikembalikan, pesan menyebut file itu', async () => {
  useZip(NEW_FILES);
  const fs = createFs(OLD_FILES);
  fs.failWhen = (p) => (p === 'update/update.js' ? virusError() : null); // baik isi baru maupun lama ditolak

  await assert.rejects(install(fs), (e) => {
    assert.deepEqual(e.notRestored, ['update/update.js']);
    assert.match(e.message, /belum bisa dikembalikan: update\/update\.js/);
    return true;
  });
  assert.equal(fs.text('content/injector.js'), 'injector lama', 'file lain tetap dikembalikan');
});

test('file lama yang tidak terbaca (diblokir antivirus) tetap ditimpa dengan versi baru', async () => {
  useZip(NEW_FILES);
  const fs = createFs(OLD_FILES);
  fs.unreadable.add('update/update.js');

  await install(fs);
  assert.equal(fs.text('update/update.js'), 'update baru');
});

// ── Validasi sebelum menulis ──

async function assertRejectedWithoutWriting(fs, matcher, opts) {
  await assert.rejects(install(fs, opts), matcher);
  assert.deepEqual(fs.writes, [], 'tidak boleh menulis apa pun');
}

test('manifest yang merujuk file yang tidak ada di unduhan: batal sebelum menulis', async () => {
  const { 'utils/antibot.js': _omit, ...withoutAntibot } = NEW_FILES;
  useZip(withoutAntibot);
  const fs = createFs(OLD_FILES);
  await assertRejectedWithoutWriting(fs, /manifest\.json merujuk ke utils\/antibot\.js/);
});

test('ikon dan popup yang dirujuk manifest juga diperiksa', async () => {
  const { 'icons/i.png': _a, 'popup/popup.html': _b, ...broken } = NEW_FILES;
  useZip(broken);
  const fs = createFs(OLD_FILES);
  await assertRejectedWithoutWriting(fs, /icons\/i\.png.*popup\/popup\.html|popup\/popup\.html.*icons\/i\.png/);
});

test('folder yang dipilih bukan folder extension ini: ditolak', async () => {
  useZip(NEW_FILES);
  await assertRejectedWithoutWriting(createFs({ 'manifest.json': manifest({ version: '1', name: 'Extension Lain' }) }), /bukan folder extension/);
  await assertRejectedWithoutWriting(createFs({ 'catatan.txt': 'halo' }), /tidak berisi manifest\.json/);
});

test('ZIP tanpa manifest, berisi path tidak aman, atau extension lain: batal', async () => {
  const fs = createFs(OLD_FILES);

  useZip({ 'a.txt': 'a' });
  await assertRejectedWithoutWriting(fs, /manifest\.json/);

  useZip({ ...NEW_FILES, '../evil.txt': 'x' });
  await assertRejectedWithoutWriting(fs, /tidak aman/);

  useZip({ 'manifest.json': manifest({ version: '9', name: 'Extension Lain' }) });
  await assertRejectedWithoutWriting(fs, /bukan extension yang sama/);
});

test('progress tidak pernah mundur dan berakhir di 100', async () => {
  useZip(NEW_FILES);
  const fs = createFs(OLD_FILES);
  const seen = [];
  await install(fs, { onProgress: (pct) => seen.push(pct) });
  assert.ok(seen.every((p, i) => i === 0 || p >= seen[i - 1]), seen.join(','));
  assert.equal(seen[seen.length - 1], 100);
});

// ── Repo asli ──

test('manifest.json repo ini hanya merujuk file yang benar-benar ada di repo', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.join(__dirname, '..');
  const walk = (dir, prefix = '') => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === '.git' || entry.name === 'node_modules') return [];
    const rel = prefix + entry.name;
    return entry.isDirectory() ? walk(path.join(dir, entry.name), rel + '/') : [rel];
  });
  const repoFiles = new Set(walk(root).filter((p) => !ShopeeUpdater.DEV_ONLY_PREFIXES.some((d) => p.startsWith(d))));
  const real = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

  assert.doesNotThrow(() => ShopeeUpdater._assertManifestFilesPresent(real, repoFiles));
});
