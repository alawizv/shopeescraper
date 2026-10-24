const test = require('node:test');
const assert = require('node:assert/strict');
const ShopeeParser = require('../utils/parser.js');

// Ulasan palsu dengan bentuk yang sama seperti respons get_ratings Shopee.
let seq = 0;
function review({ stars, comment, ctime }) {
  seq++;
  return {
    rating_id: `r${seq}`,
    rating_star: stars,
    comment: comment ?? '',
    ctime: ctime ?? 1700000000,
    author_username: `user${seq}`,
    product_items: []
  };
}

const LONG_COMMENT = 'barang ini kualitasnya sangat tipis dan jelek sekali tidak seperti di foto';

function parse(reviews, starFilter) {
  return ShopeeParser.parseNegativeReviews([{ data: { ratings: reviews } }], [], starFilter);
}

test('sentimen dihitung dari semua ulasan, bukan hanya yang lolos filter bintang', () => {
  // 8 ulasan 5★ tanpa komentar + 2 ulasan 1★ berkomentar panjang.
  const reviews = [
    ...Array.from({ length: 8 }, () => review({ stars: 5 })),
    review({ stars: 1, comment: LONG_COMMENT }),
    review({ stars: 1, comment: LONG_COMMENT })
  ];
  const parsed = parse(reviews, [1]);
  const insights = ShopeeParser.extractReviewInsights(parsed.reviews, parsed.starCounts);

  assert.equal(parsed.reviews.length, 2, 'hanya 2 ulasan 1★ yang lolos filter');
  assert.deepEqual(parsed.starCounts, { 1: 2, 2: 0, 3: 0, 4: 0, 5: 8 });
  assert.equal(insights.sentiment.positive_rate, 80);
  assert.equal(insights.sentiment.positive_count, 8);
  assert.equal(insights.sentiment.negative_count, 2);
  assert.equal(insights.sentiment.basis, 'all_reviews');
});

test('ulasan 5★ pendek (di bawah 10 kata) tetap dihitung di sentimen', () => {
  const reviews = [
    review({ stars: 5, comment: 'bagus' }),
    review({ stars: 5, comment: 'mantap' }),
    review({ stars: 2, comment: LONG_COMMENT })
  ];
  const parsed = parse(reviews, [1, 2, 3, 4, 5]);
  const insights = ShopeeParser.extractReviewInsights(parsed.reviews, parsed.starCounts);

  assert.equal(parsed.reviews.length, 1, 'hanya ulasan panjang yang masuk daftar terfilter');
  assert.equal(insights.sentiment.positive_rate, 67);
});

test('ulasan duplikat tidak dihitung dua kali di distribusi bintang', () => {
  const dup = review({ stars: 4 });
  const parsed = ShopeeParser.parseNegativeReviews(
    [{ data: { ratings: [dup] } }, { data: { ratings: [dup] } }],
    [],
    [1, 2, 3, 4, 5]
  );
  assert.equal(parsed.starCounts[4], 1);
});

test('tanpa starCounts, sentimen jatuh kembali ke ulasan terfilter', () => {
  const insights = ShopeeParser.extractReviewInsights([
    { stars: 5, comment: LONG_COMMENT },
    { stars: 1, comment: LONG_COMMENT }
  ]);
  assert.equal(insights.sentiment.positive_rate, 50);
  assert.equal(insights.sentiment.basis, 'filtered_reviews');
});

test('tanpa data sama sekali, persen positif null (bukan 100%)', () => {
  const insights = ShopeeParser.extractReviewInsights([], null);
  assert.equal(insights.total_analyzed, 0);
  assert.equal(insights.sentiment.positive_rate, null);
});

test('buildOutput meneruskan distribusi bintang ke review_insights', () => {
  const reviews = [
    ...Array.from({ length: 3 }, () => review({ stars: 5 })),
    review({ stars: 1, comment: LONG_COMMENT })
  ];
  const parsed = parse(reviews, [1]);
  const output = ShopeeParser.buildOutput({ name: 'X', price_min: 1000, price_max: 1000 }, parsed, 'https://shopee.co.id/x-i.1.2', null, null, [1]);
  assert.equal(output.review_insights.sentiment.positive_rate, 75);
});
