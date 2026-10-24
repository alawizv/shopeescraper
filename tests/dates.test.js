const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const parserPath = path.join(__dirname, '..', 'utils', 'parser.js');

// Date memakai zona waktu proses saat start, jadi tiap zona diuji di proses Node terpisah.
// Parser mencetak log ke stdout, maka hasil diambil dari baris terakhir.
function runInTimezone(tz, body) {
  const script = `
    const ShopeeParser = require(${JSON.stringify(parserPath)});
    const out = (() => { ${body} })();
    console.log(JSON.stringify(out));
  `;
  const stdout = execFileSync(process.execPath, ['-e', script], {
    env: { ...process.env, TZ: tz },
    encoding: 'utf8'
  });
  return JSON.parse(stdout.trim().split('\n').pop());
}

// 2026-01-01 20:00 UTC = 2026-01-02 03:00 WIB
const CTIME_JAN1_2000_UTC = Date.UTC(2026, 0, 1, 20, 0, 0) / 1000;

const reviewDate = `
  const comment = 'barang ini kualitasnya sangat tipis dan jelek sekali tidak seperti di foto';
  const raw = [{ data: { ratings: [{ rating_id: 'a', rating_star: 1, comment, ctime: ${CTIME_JAN1_2000_UTC}, author_username: 'u' }] } }];
  return ShopeeParser.parseNegativeReviews(raw, [], [1]).reviews[0].date;
`;

test('tanggal ulasan memakai zona waktu lokal (WIB), bukan UTC', () => {
  assert.equal(runInTimezone('Asia/Jakarta', reviewDate), '2026-01-02');
});

test('tanggal ulasan di zona UTC tetap sama', () => {
  assert.equal(runInTimezone('UTC', reviewDate), '2026-01-01');
});

test('toLocalDateString: ISO scraped_at diubah ke tanggal lokal', () => {
  const body = `return ShopeeParser.toLocalDateString('2026-01-01T20:00:00.000Z');`;
  assert.equal(runInTimezone('Asia/Jakarta', body), '2026-01-02');
  assert.equal(runInTimezone('UTC', body), '2026-01-01');
});

test('toLocalDateString: tanpa argumen memakai hari ini, nilai tak valid kosong', () => {
  const body = `
    const today = ShopeeParser.toLocalDateString();
    const now = new Date();
    const expected = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
    return { ok: today === expected, bad: ShopeeParser.toLocalDateString('bukan tanggal') };
  `;
  assert.deepEqual(runInTimezone('Asia/Jakarta', body), { ok: true, bad: '' });
});
