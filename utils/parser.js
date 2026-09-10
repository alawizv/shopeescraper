/**
 * parser.js
 * ==========
 * Modul untuk menormalisasi data mentah dari API Shopee atau DOM
 * menjadi format standar yang digunakan oleh popup dan exporter.
 */

// Dideklarasikan dengan `var` + penjaga, bukan `const`: popup.js bisa menyuntik
// ulang file ini via chrome.scripting.executeScript, dan `const` yang dideklarasikan
// dua kali di scope yang sama melempar SyntaxError sehingga inject ulang gagal total.
var ShopeeParser = (typeof ShopeeParser !== 'undefined' && ShopeeParser) ? ShopeeParser : {

  /**
   * Parse data produk dari response API Shopee
   */
  parseProduct(rawData) {
    if (!rawData) return null;

    // Format 1: Hasil dari __NEXT_DATA__ (api_from_dom) - punya tier_variations dan models
    if (rawData?._source === 'api_from_dom') {
      const item = rawData?.data?.item || rawData?.data;
      if (item) return this._parseProductFromAPI(item);
    }

    // Format 2: Hasil dari DOM scraping murni - tidak punya models
    if (rawData?._source === 'dom') {
      return this._parseProductFromDOM(rawData.data);
    }

    // Format 3: Langsung dari API atau raw data
    const item = rawData?.data?.item ||
                 rawData?.data ||
                 rawData?.item ||
                 rawData;

    return this._parseProductFromAPI(item);
  },

  /**
   * Parse data toko dari response API Shopee
   */
  parseShop(rawShopData) {
    if (!rawShopData) return null;

    try {
      // Response bisa berada di data.data atau langsung di root
      const shop = rawShopData?.data?.data ||
                   rawShopData?.data ||
                   rawShopData;

      if (!shop || !shop.shopid) return null;

      return {
        shop_id: shop.shopid || null,
        name: shop.name || shop.shop_name || '-',
        location: shop.shop_location || shop.location || '-',
        follower_count: shop.follower_count || shop.follow_count || 0,
        product_count: shop.item_count || shop.product_count || 0,
        rating_star: shop.rating_star
          ? Math.round(shop.rating_star * 10) / 10
          : 0,
        response_rate: shop.response_rate !== undefined
          ? (shop.response_rate > 1 ? Math.round(shop.response_rate) : Math.round(shop.response_rate * 100))
          : null,
        response_time: shop.response_time || null,
        is_mall: !!(shop.is_shopee_mall || shop.official_shop_label_with_moderation),
        is_preferred: !!(shop.is_preferred_plus_seller || shop.is_preferred_seller)
      };
    } catch (e) {
      console.error('[Shopee Parser] Error parsing shop:', e);
      return null;
    }
  },

  /**
   * Parse data produk dari API response
   */
  _parseProductFromAPI(item) {
    if (!item) return null;

    try {
      const priceUnit = 100000;
      let priceMin = 0;
      let priceMax = 0;

      if (item.price_min !== undefined) {
        priceMin = Math.round(item.price_min / priceUnit);
        priceMax = Math.round((item.price_max || item.price_min) / priceUnit);
      } else if (item.price !== undefined) {
        priceMin = Math.round(item.price / priceUnit);
        priceMax = priceMin;
      }

      const ratingData = item.item_rating || item.rating || {};
      const ratingAvg = ratingData.rating_star ||
                        ratingData.rating_average ||
                        ratingData.star ||
                        0;

      const ratingCount = ratingData.rating_count || [];
      const totalReviews = Array.isArray(ratingCount)
        ? (ratingCount[0] || 0)
        : (typeof ratingCount === 'number' ? ratingCount : 0);

      // historical_sold = total kumulatif sepanjang waktu
      // sold = penjualan BULANAN (yang ditampilkan Shopee di listing "X Terjual/Bulan")
      const totalSold = item.historical_sold || item.item_sold || 0;
      const soldPerMonthActual = item.sold || 0; // Angka riil bulanan dari Shopee

      const variants = this._parseVariants(item);

      return {
        name: item.name || item.title || 'Nama tidak tersedia',
        price_min: priceMin,
        price_max: priceMax,
        price_before_discount: item.price_before_discount
          ? Math.round(item.price_before_discount / priceUnit)
          : null,
        rating: Math.round(ratingAvg * 10) / 10,
        total_sold: totalSold,
        sold_per_month_actual: soldPerMonthActual, // ✅ Data riil bulanan dari API
        review_count: totalReviews,
        variants: variants,
        shop_id: item.shopid || item.shop_id || null,
        item_id: item.itemid || item.item_id || null
      };

    } catch (e) {
      console.error('[Shopee Parser] Error parsing product API:', e);
      return null;
    }
  },

  /**
   * Parse data produk dari DOM scraping
   */
  _parseProductFromDOM(domData) {
    if (!domData) return null;

    const priceUnit = 100000;

    return {
      name: domData.name || 'Nama tidak tersedia',
      price_min: domData.price_min ? Math.round(domData.price_min / priceUnit) : 0,
      price_max: domData.price_max ? Math.round(domData.price_max / priceUnit) : 0,
      price_before_discount: null,
      rating: domData.item_rating?.rating_star || 0,
      total_sold: domData.historical_sold || 0,
      sold_per_month_actual: domData.sold_per_month_actual || 0,
      review_count: domData.item_rating?.rating_count?.[0] || 0,
      variants: this._parseVariants(domData),
      shop_id: null,
      item_id: null
    };
  },

  /**
   * Parse data varian dari item
   */
  _parseVariants(item) {
    const variants = [];

    try {
      const tierVariations = item.tier_variations || [];
      const models = item.models || [];

      if (tierVariations.length === 0 && models.length === 0) {
        return [];
      }

      const tier1Options = tierVariations[0]?.options || tierVariations[0]?.option_list?.map(o => o.option) || [];
      const tier2Options = tierVariations[1]?.options || tierVariations[1]?.option_list?.map(o => o.option) || [];

      const tier1Name = tierVariations[0]?.name || 'Varian 1';
      const tier2Name = tierVariations[1]?.name || 'Varian 2';

      // Kita simpan model name untuk nanti dicocokkan dengan review
      if (models.length > 0) {
        console.log('%c[Parser V3] _parseVariants: models.length =', 'background: purple; color: white;', models.length);
        if (models[0]) {
          console.log('[Parser V3] models[0] ALL keys:', Object.keys(models[0]).join(', '));
          console.log('[Parser V3] models[0] sold-related:', JSON.stringify({
            sold: models[0].sold, historical_sold: models[0].historical_sold,
            item_sold: models[0].item_sold, stock: models[0].stock, 
            normal_stock: models[0].normal_stock, price: models[0].price, name: models[0].name
          }));
        }
        models.forEach(model => {
          const tierIndex = model.tier_index || model.extinfo?.tier_index || [];
          const tier1Idx = tierIndex[0] !== undefined ? tierIndex[0] : 0;
          const tier2Idx = tierIndex[1];

          let variantName = tier1Options[tier1Idx] || '';
          if (tier2Idx !== undefined && tier2Options[tier2Idx]) {
              variantName += ',' + tier2Options[tier2Idx];
          }

          const variant = {
            tier1: tier1Options[tier1Idx] || '-',
            tier1_name: tier1Name,
            tier2: tier2Idx !== undefined && tier2Options[tier2Idx]
              ? tier2Options[tier2Idx]
              : null,
            tier2_name: tier2Options.length > 0 ? tier2Name : null,
            stock: model.stock !== undefined ? model.stock : (model.normal_stock || 0),
            price: model.price
              ? Math.round(model.price / 100000)
              : null,
            model_id: model.modelid || model.model_id || null,
            sku: model.sku || null,
            model_name: model.name || variantName,
            // ⚡ KRITIS: Ambil data 'terjual' langsung dari objek model API jika ada (sangat berguna jika review diblokir)
            sold_count: model.historical_sold || model.sold || model.item_sold || 0,
            _source_sold: (model.historical_sold !== undefined || model.sold !== undefined) ? 'api_model' : 'none'
          };

          variants.push(variant);
        });
      } else if (tier1Options.length > 0) {
        // Fallback jika tidak ada models (jarang)
        tier1Options.forEach(opt1 => {
          if (tier2Options.length > 0) {
            tier2Options.forEach(opt2 => {
              variants.push({
                tier1: opt1,
                tier1_name: tier1Name,
                tier2: opt2,
                tier2_name: tier2Name,
                stock: 0,
                price: null,
                model_id: null,
                sku: null,
                model_name: opt1 + ',' + opt2,
                sold_count: 0
              });
            });
          } else {
            variants.push({
              tier1: opt1,
              tier1_name: tier1Name,
              tier2: null,
              tier2_name: null,
              stock: 0,
              price: null,
              model_id: null,
              sku: null,
              model_name: opt1,
              sold_count: 0
            });
          }
        });
      }

    } catch (e) {
      console.error('[Shopee Parser] Error parsing variants:', e);
    }

    return variants;
  },

  /**
   * Parse dan filter review negatif serta review u/ varian
   */
  /**
   * starFilter: array bintang yang ingin dikumpulkan, misal [4,5] atau [1,2,3,4,5]
   * Default: semua bintang (1-5)
   */
  parseNegativeReviews(rawReviewsArray, variantsArray = [], starFilter = [1,2,3,4,5]) {
    if (!rawReviewsArray || !Array.isArray(rawReviewsArray)) return { reviews: [], totalReviewsParsed: 0 };

    const allReviews = [];
    const seenKeys = new Set();

    console.log('%c[Parser V3] parseNegativeReviews dipanggil. rawReviewsArray.length =', 'background: teal; color: white;', rawReviewsArray.length);
    console.log('%c[Parser V3] variantsArray.length =', 'background: teal; color: white;', variantsArray.length);
    
    // Log format 1 data pertama untuk debug  
    if (rawReviewsArray.length > 0) {
      const first = rawReviewsArray[0];
      const firstRatings = first?.data?.ratings || first?.ratings || (first?.rating_star !== undefined ? [first] : []);
      console.log('[Parser V3] Entry pertama format:', JSON.stringify({
        hasData: !!first?.data, hasRatings: !!first?.data?.ratings, 
        hasDirectRatings: !!first?.ratings, isDirectReview: first?.rating_star !== undefined,
        ratingsCount: firstRatings.length
      }));
      if (firstRatings.length > 0) {
        const sampleRating = firstRatings[0];
        console.log('[Parser V3] Sample rating keys:', Object.keys(sampleRating).join(', '));
        console.log('[Parser V3] Sample model_name/variation:', {
          product_items_0_model_name: sampleRating?.product_items?.[0]?.model_name,
          variation: sampleRating?.variation
        });
      }
    }
    
    // Tahap 1 & 2: Reset Tracking dan Inisiasi Proxy
    // PENTING: sold_count hasil _parseVariants bisa berasal dari API models
    // (model.historical_sold). Angka itu harus diselamatkan dulu ke _api_sold_count,
    // kalau tidak ia terhapus di sini dan perhitungan "sumber api_model" di bawah
    // jadi memakai angka nol.
    if (variantsArray) {
        variantsArray.forEach(v => {
            if (v._api_sold_count === undefined) {
                v._api_sold_count = (v._source_sold === 'api_model') ? (v.sold_count || 0) : 0;
            }
            v.sold_count = 0;
            v._isReviewProxy = true; // Sementara; di-set ulang di bawah jika data API dipakai
        });
    }

    let totalReviewsParsed = 0;   // semua ulasan unik yang diproses (untuk statistik sampel)
    let variantReviewTotal = 0;   // ulasan yang membawa info varian (penyebut persentase proxy)
    const reviewVariantsCount = {}; // V1 Logic Proxy Tracker

    // Tracking untuk kalkulasi omset 30 hari
    let reviews30dCount = 0;
    let omset30dFromReviews = 0;
    let reviews30dWithPrice = 0;
    const nowUnix = Math.floor(Date.now() / 1000);
    const thirtyDaysAgoUnix = nowUnix - (30 * 24 * 60 * 60);

    rawReviewsArray.forEach(rawResponse => {
      // Menangani berbagai format response (API intercept maupun DOM fallback)
      let ratings = [];
      if (rawResponse.rating_star !== undefined) {
          ratings = [rawResponse];
      } else {
          ratings = rawResponse?.data?.ratings ||
                    rawResponse?.ratings ||
                    rawResponse?.data?.comments ||
                    [];
      }

      if (!Array.isArray(ratings)) return;

      ratings.forEach(review => {
        // Hindari duplikasi penghitungan ulasan & varian: cek rating_id / cmnt_id / composite key (anti double-count)
        const reviewKey = String(
          review.rating_id ||
          review.cmnt_id ||
          `comp:${review.author_username || review.username || review.user || 'anon'}_${(review.comment || review.content || '').slice(0, 40)}_${review.ctime || review.create_time || review.date || ''}_${review.rating_star || review.star || review.rating || ''}`
        );
        if (seenKeys.has(reviewKey)) return;
        seenKeys.add(reviewKey);

        // Dihitung untuk SEMUA ulasan unik — bukan hanya yang punya info varian.
        // Kalau tidak, produk tanpa varian selalu melaporkan "0 ulasan ter-scrape".
        totalReviewsParsed++;

        const stars = review.rating_star || review.star || review.rating || 0;

        // Tahap 2: Menggali Informasi Varian dari Komentar (product_items[0].model_name)
        const productItems = review.product_items || [];
        const variantPurchased = productItems.length > 0
          ? (productItems[0].model_name || productItems[0].variation || '')
          : (review.variation || '');
          
        if (variantPurchased) {
            reviewVariantsCount[variantPurchased] = (reviewVariantsCount[variantPurchased] || 0) + 1;
        }

        let matchedPrice = 0;
        if (variantPurchased && variantsArray && variantsArray.length > 0) {
            variantReviewTotal++; // Penyebut untuk persentase varian berbasis ulasan

            const normalize = (str) => (str || '').toString().toLowerCase().replace(/[^a-z0-9]/g, '');
            const normPurchased = normalize(variantPurchased);
            
            // 2. Loop setiap varian di tabel kita
            for (let v of variantsArray) {
                let isMatch = false;
                
                // Prioritas 1: Kecocokan persis pada model_name
                if (normPurchased === normalize(v.model_name)) {
                    isMatch = true;
                } 
                // Prioritas 2: Pemisahan string berdasarkan koma (misal: "Hitam, XL")
                else {
                    // String asli dari Shopee sering dibelah oleh koma
                    const purchasedParts = variantPurchased.split(',').map(s => normalize(s.trim()));
                    const t1 = normalize(v.tier1);
                    const t2 = (v.tier2 && v.tier2 !== '-') ? normalize(v.tier2) : '';
                    
                    if (purchasedParts.length === 2 && t2 !== '') {
                        // Harus sama persis kedua sisinya
                        if (purchasedParts[0] === t1 && purchasedParts[1] === t2) isMatch = true;
                        else if (purchasedParts[1] === t1 && purchasedParts[0] === t2) isMatch = true; // antisipasi terbalik
                    } else if (purchasedParts.length === 1 && t1 !== 'default') {
                        if (purchasedParts[0] === t1) isMatch = true;
                    }
                }
                
                // Tahap 3: Menghitung Frekuensi Pembelian (Tallying)
                if (isMatch) {
                    v.sold_count++;
                    matchedPrice = v.price || 0;
                    break;
                }
            }
        }

        // === Tracking Omset 30 Hari ===
        const reviewTime = review.ctime || review.create_time || review.mtime || 0;
        if (reviewTime >= thirtyDaysAgoUnix && reviewTime > 0) {
            reviews30dCount++;
            if (matchedPrice > 0) {
                omset30dFromReviews += matchedPrice;
                reviews30dWithPrice++;
            }
        }

        // ===================================
        // Fitur Review Terfilter (berdasarkan pilihan bintang user)
        // Hanya kumpulkan review sesuai starFilter yang memiliki komentar
        // dengan jumlah kata minimal 10.
        // ===================================
        if (!starFilter.includes(stars)) return;

        const comment = (review.comment || review.content || '').trim();
        if (!comment) return;
        if (this._isEmptyOrEmojiOnly(comment)) return;

        // Cek jumlah kata (minimal 10 kata)
        const wordCount = comment.split(/\s+/).filter(w => w.length > 0).length;
        if (wordCount < 10) return;

        const user = review.anonymous
          ? 'Anonim'
          : (review.author_username || review.username || 'User');

        const timestamp = review.ctime || review.create_time || review.mtime || 0;
        const date = timestamp
          ? new Date(timestamp * 1000).toISOString().split('T')[0]
          : 'Tidak diketahui';

        allReviews.push({
          stars: stars,
          comment: comment,
          date: date,
          user: user,
          variant: variantPurchased || '-'
        });
      });
    });
    
    // Hitung persentase penjualan per varian
    if (variantsArray) {
        // Sumber terbaik: angka penjualan asli dari API models (yang sudah
        // diselamatkan ke _api_sold_count sebelum tally ulasan dimulai)
        const totalSoldModels = variantsArray.reduce((sum, v) => sum + (v._api_sold_count || 0), 0);
        const hasApiModels = totalSoldModels > 0;

        if (hasApiModels) {
            variantsArray.forEach(v => {
                // Kembalikan angka API — inilah data penjualan sebenarnya
                v.sold_count = v._api_sold_count || 0;
                v._isReviewProxy = false;
                v.sales_percentage = Math.round((v.sold_count / totalSoldModels) * 100);
            });
        } else if (variantReviewTotal > 0) {
            // Fallback ke hitung persentase dari hasil parser string ulasan (Proxy Varian)
            variantsArray.forEach(v => {
                v.sales_percentage = Math.round((v.sold_count / variantReviewTotal) * 100);
            });
        } else {
            variantsArray.forEach(v => {
                v.sales_percentage = 0;
            });
        }
    }

    // ===================================
    // V1 LOGIC: Cek persentase per TIER secara independen (Warna sendiri, Ukuran sendiri)
    // Berfungsi mengelompokkan varian persis seperti di ekstensi Shopee Scraper V1 lama
    // ===================================
    const tierSummaries = [];
    if (variantsArray && variantsArray.length > 0) {
        const tier1Name = variantsArray[0]?.tier1_name || 'Tier 1';
        const tier2Name = variantsArray[0]?.tier2_name || 'Tier 2';

        const tier1Options = [...new Set(variantsArray.map(v => v.tier1).filter(t => t && t !== '-' && t !== 'default'))];
        const tier2Options = [...new Set(variantsArray.map(v => v.tier2).filter(t => t && t !== '-' && t !== 'default'))];

        const tierVariantsData = [];
        if (tier1Options.length > 0) tierVariantsData.push({ name: tier1Name, options: tier1Options });
        if (tier2Options.length > 0) tierVariantsData.push({ name: tier2Name, options: tier2Options });

        tierVariantsData.forEach((tier, tierIndex) => {
            const tierOptions = tier.options;
            const optionCounts = {};
            let tierTotalSold = 0;

            Object.keys(reviewVariantsCount).forEach(rvName => {
                const rvSold = reviewVariantsCount[rvName];
                const parts = rvName.split(',').map(s => s.trim());
                let matchedOption = parts.find(p => tierOptions.includes(p));

                if (!matchedOption && parts.length === tierVariantsData.length && tierIndex < parts.length) {
                    matchedOption = parts[tierIndex];
                }

                if (matchedOption) {
                    optionCounts[matchedOption] = (optionCounts[matchedOption] || 0) + rvSold;
                    tierTotalSold += rvSold;
                }
            });

            if (tierTotalSold > 0) {
                let breakdown = [];
                const sortedOptions = Object.keys(optionCounts).sort((a, b) => optionCounts[b] - optionCounts[a]);

                sortedOptions.forEach(opt => {
                    let pct = Math.round((optionCounts[opt] / tierTotalSold) * 100);
                    if (pct < 1 && optionCounts[opt] > 0) pct = 1;
                    breakdown.push(`${opt} (${pct}%)`);
                });

                tierSummaries.push({
                    name: tier.name,
                    summary: breakdown.join(', '),
                    options: optionCounts
                });
            }
        });
    }

    // Return object containing both the filtered reviews and the total reviews counted (for trend)
    return {
      reviews: allReviews, // Kembalikan SEMUA review yang lolos filter (tanpa batas 50)
      totalReviewsParsed: totalReviewsParsed,   // semua ulasan unik yang diproses
      variantReviewTotal: variantReviewTotal,   // ulasan yang membawa info varian
      tierSummaries: tierSummaries,
      reviewVariantsCount: reviewVariantsCount,
      starFilter: starFilter, // Simpan filter yang digunakan untuk label export
      omset30d: {
        reviews_in_30d: reviews30dCount,
        reviews_with_price: reviews30dWithPrice,
        omset_from_reviews: omset30dFromReviews,
        avg_price_from_reviews: reviews30dWithPrice > 0 ? Math.round(omset30dFromReviews / reviews30dWithPrice) : 0
      }
    };
  },

  /**
   * Cek apakah string hanya berisi emoji, spasi, atau karakter non-teks
   */
  _isEmptyOrEmojiOnly(str) {
    if (!str) return true;

    const cleaned = str
      .replace(/[\u{1F600}-\u{1F64F}]/gu, '')
      .replace(/[\u{1F300}-\u{1F5FF}]/gu, '')
      .replace(/[\u{1F680}-\u{1F6FF}]/gu, '')
      .replace(/[\u{2600}-\u{26FF}]/gu, '')
      .replace(/[\u{2700}-\u{27BF}]/gu, '')
      .replace(/[\u{FE00}-\u{FE0F}]/gu, '')
      .replace(/[\u{1F900}-\u{1F9FF}]/gu, '')
      .replace(/[\u{200D}]/gu, '')
      .replace(/[\u{20E3}]/gu, '')
      .replace(/[\u{FE0F}]/gu, '')
      .replace(/\s+/g, '')
      .trim();

    return cleaned.length === 0;
  },

  /**
   * Dapatkan simbol mata uang berdasarkan URL atau host Shopee
   */
  getCurrencySymbol(url) {
    const h = (url || '').toLowerCase();
    if (h.includes('.co.id') || h.includes('shopee.id')) return 'Rp';
    if (h.includes('.co.th')) return '฿';
    if (h.includes('.sg')) return 'S$';
    if (h.includes('.com.my') || h.includes('.my')) return 'RM';
    if (h.includes('.ph')) return '₱';
    if (h.includes('.vn')) return '₫';
    if (h.includes('.tw')) return 'NT$';
    if (h.includes('.com.br') || h.includes('.br')) return 'R$';
    if (h.includes('.com.mx') || h.includes('.mx')) return 'MX$';
    if (h.includes('.com.co')) return 'COL$';
    if (h.includes('.cl')) return 'CL$';
    return 'Rp';
  },

  /**
   * Ekstrak insight ulasan pembeli (Pain Points & Analisis Keluhan)
   * Mengelompokkan keluhan utama pembeli ke dalam kategori spesifik dan kata kunci teratas.
   */
  extractReviewInsights(reviews) {
    if (!reviews || !Array.isArray(reviews) || reviews.length === 0) {
      return {
        total_analyzed: 0,
        sentiment: { positive_count: 0, negative_count: 0, positive_rate: 100 },
        pain_points: [],
        top_complaint_words: []
      };
    }

    const categories = [
      {
        id: 'kualitas',
        label: 'Kualitas Bahan / Produk Kurang',
        icon: '🧵',
        keywords: ['tipis', 'jelek', 'kualitas', 'kasar', 'panas', 'nerawang', 'murahan', 'gatal', 'bau', 'kotor', 'kusam', 'buruk', 'luntur', 'gampang rusak', 'mudah sobek', 'ringkih', 'abal', 'jelek banget', 'tipis banget'],
        count: 0,
        samples: []
      },
      {
        id: 'kerusakan',
        label: 'Barang Rusak / Cacat Fisik',
        icon: '💔',
        keywords: ['rusak', 'pecah', 'patah', 'retak', 'cacat', 'sobek', 'bolong', 'jahitan', 'copot', 'bocor', 'hancur', 'penyok', 'tergores', 'lepas', 'remuk', 'robek'],
        count: 0,
        samples: []
      },
      {
        id: 'ukuran',
        label: 'Ukuran / Fitting Tidak Sesuai',
        icon: '📏',
        keywords: ['kekecilan', 'kebesaran', 'sempit', 'panjang', 'pendek', 'gak muat', 'tidak muat', 'salah ukuran', 'size', 'ketat', 'longgar', 'muat', 'kurang besar'],
        count: 0,
        samples: []
      },
      {
        id: 'pengiriman',
        label: 'Pengiriman / Kurir Lambat',
        icon: '🚚',
        keywords: ['lama', 'lelet', 'pengiriman', 'kurir', 'lambat', 'telat', 'nunggu', 'berhari-hari', 'packing', 'kemasan', 'lama banget', 'pending', 'paket'],
        count: 0,
        samples: []
      },
      {
        id: 'ketidaksesuaian',
        label: 'Tidak Sesuai Foto / Pesanan',
        icon: '📸',
        keywords: ['tidak sesuai', 'beda', 'kecewa', 'salah kirim', 'salah warna', 'kurang', 'gak lengkap', 'tidak lengkap', 'zonk', 'tertipu', 'lain', 'palsu', 'kw', 'beda warna', 'gak sama'],
        count: 0,
        samples: []
      },
      {
        id: 'fungsi',
        label: 'Fungsi / Performa Bermasalah',
        icon: '⚙️',
        keywords: ['mati', 'tidak berfungsi', 'gak nyala', 'error', 'tidak bisa', 'baterai', 'bocor', 'rusak', 'macet', 'mati total', 'bunyi'],
        count: 0,
        samples: []
      }
    ];

    const stopwords = new Set([
      'dan', 'yang', 'ini', 'itu', 'di', 'ke', 'dari', 'aku', 'saya', 'kamu', 'dia', 'mereka',
      'ada', 'tidak', 'gak', 'nggak', 'tak', 'udah', 'sudah', 'belum', 'bisa', 'karena', 'tapi',
      'tp', 'yg', 'nya', 'untuk', 'pada', 'dengan', 'adalah', 'akan', 'juga', 'bgt', 'banget',
      'aja', 'saja', 'buat', 'mau', 'harus', 'jadi', 'lagi', 'kok', 'pas', 'sih',
      'dong', 'lah', 'kan', 'deh', 'ya', 'yaa', 'nih', 'kalo', 'kalau', 'sama', 'agak', 'terus',
      'lebih', 'malah', 'bukan', 'padahal', 'minta', 'beli', 'pesan', 'order', 'barang',
      'produk', 'shopee', 'seller', 'toko', 'terima', 'kasih', 'bagus'
    ]);

    let positiveCount = 0;
    let negativeCount = 0;
    const wordFreq = {};

    reviews.forEach(r => {
      const stars = Number(r.stars) || 5;
      if (stars >= 4) positiveCount++;
      else negativeCount++;

      const comment = (r.comment || '').toLowerCase();
      if (!comment) return;

      categories.forEach(cat => {
        const matched = cat.keywords.some(kw => comment.includes(kw));
        if (matched) {
          cat.count++;
          if (cat.samples.length < 2) {
            cat.samples.push(r.comment.slice(0, 80) + (r.comment.length > 80 ? '...' : ''));
          }
        }
      });

      if (stars <= 3) {
        const words = comment.replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/);
        words.forEach(w => {
          const word = w.trim();
          if (word.length >= 4 && !stopwords.has(word) && !/^\d+$/.test(word)) {
            wordFreq[word] = (wordFreq[word] || 0) + 1;
          }
        });
      }
    });

    const totalAnalyzed = reviews.length;
    const totalComplaints = categories.reduce((sum, c) => sum + c.count, 0);

    const activePainPoints = categories
      .filter(c => c.count > 0)
      .sort((a, b) => b.count - a.count)
      .map(c => ({
        id: c.id,
        icon: c.icon,
        label: c.label,
        count: c.count,
        percentage: totalComplaints > 0 ? Math.round((c.count / totalComplaints) * 100) : 0,
        sample: c.samples[0] || null
      }));

    const topWords = Object.keys(wordFreq)
      .map(w => ({ word: w, count: wordFreq[w] }))
      .filter(w => w.count >= 2)
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    const positiveRate = totalAnalyzed > 0 ? Math.round((positiveCount / totalAnalyzed) * 100) : 100;

    return {
      total_analyzed: totalAnalyzed,
      sentiment: {
        positive_count: positiveCount,
        negative_count: negativeCount,
        positive_rate: positiveRate
      },
      pain_points: activePainPoints,
      top_complaint_words: topWords
    };
  },

  /**
   * Ekstrak shopid dan itemid dari URL produk Shopee
   */
  _extractIdFromUrl(url) {
    if (!url) return { shopid: null, itemid: null };
    try {
      const m1 = url.match(/-i\.(\d+)\.(\d+)/);
      if (m1) return { shopid: m1[1], itemid: m1[2] };
      const m2 = url.match(/\/product\/(\d+)\/(\d+)/);
      if (m2) return { shopid: m2[1], itemid: m2[2] };
    } catch (e) {}
    return { shopid: null, itemid: null };
  },

  /**
   * Bangun output JSON final yang siap diekspor
   * @param {object} product
   * @param {object} parseReviewResult
   * @param {string} url
   * @param {object|null} rawShopData
   * @param {number|null} monthlySoldFromSearch - Data riil dari search API Shopee (tertinggi prioritasnya)
   */
  buildOutput(product, parseReviewResult, url, rawShopData, monthlySoldFromSearch = null, starFilter = [1,2,3,4,5]) {
    const negativeReviews = parseReviewResult?.reviews || [];
    const recentSalesCount = parseReviewResult?.totalReviewsParsed || 0;
    const activeStarFilter = parseReviewResult?.starFilter || starFilter;
    const activeStarFilterSorted = [...activeStarFilter].sort((a,b)=>b-a);
    const starFilterLabel = activeStarFilter.length === 5 ? 'Semua Bintang' : `Bintang ${activeStarFilterSorted.join(', ')}`;
    const starFilterLabelShort = activeStarFilterSorted.map(s=>`${s}★`).join('+');
    
    const priceAvg = ((product?.price_min || 0) + (product?.price_max || product?.price_min || 0)) / 2;
    
    // === SAMPEL REVIEW (data mentah, tanpa pengali) ===
    const totalReviewsOfficial = product?.review_count || 0;
    let sampleCoverage = 0;
    if (totalReviewsOfficial > 0 && recentSalesCount > 0) {
      const pct = (recentSalesCount / totalReviewsOfficial) * 100;
      if (pct >= 100) {
        sampleCoverage = 100;
      } else if (pct < 0.01) {
        sampleCoverage = 0.01;
      } else if (pct < 1) {
        sampleCoverage = Number(pct.toFixed(2));
      } else {
        sampleCoverage = Number(pct.toFixed(1));
      }
    }

    // Parse data toko jika ada
    const shop = rawShopData ? this.parseShop(rawShopData) : null;

    // Tahap 4: Gunakan sales_percentage dari parseNegativeReviews (sudah dihitung benar)
    // JANGAN hitung ulang di sini — parseNegativeReviews sudah menghitung dengan total
    // yang tepat (dari api_model atau dari matched review), sehingga totalnya selalu 100%
    const variants = (product?.variants || []).map(v => {
      const soldCount = v.sold_count || 0;
      return {
        tier1: v.tier1 || '-',
        tier2: v.tier2 || '-',
        stock: v.stock || 0,
        price: v.price || null,
        sold_count: soldCount,
        // Gunakan sales_percentage yang sudah dihitung benar di parseNegativeReviews
        // Fallback ke 0 jika belum ada ulasan sama sekali
        sales_percentage: v.sales_percentage !== undefined ? v.sales_percentage : 0,
        model_name: v.model_name || '',
        _isReviewProxy: v._isReviewProxy || false
      };
    });
    
    // Fitur Terjual / Bulan
    let monthlySoldValue = null;
    let monthlySoldSource = 'NONE';
    if (product && product.sold_per_month_actual > 0) {
      monthlySoldValue = product.sold_per_month_actual;
      monthlySoldSource = 'API'; 
    } else if (monthlySoldFromSearch > 0) {
      monthlySoldValue = monthlySoldFromSearch;
      monthlySoldSource = 'SEARCH_API';
    }

    // === Kalkulasi Omset ===
    const omset30dData = parseReviewResult?.omset30d || {};

    // Detail: Omset dari review 30 hari × faktor koreksi
    const reviews30d = omset30dData.reviews_in_30d || 0;
    const reviews30dWithPrice = omset30dData.reviews_with_price || 0;
    const omsetFromReviews30d = omset30dData.omset_from_reviews || 0;
    const correctionFactor = totalReviewsOfficial > 0
      ? (product?.total_sold || 0) / totalReviewsOfficial
      : 1;
    // Jika ada review dengan harga varian, gunakan. Jika tidak, fallback ke avg price.
    let omsetDetail = 0;
    if (omsetFromReviews30d > 0) {
      omsetDetail = omsetFromReviews30d * correctionFactor;
    } else if (reviews30d > 0) {
      omsetDetail = reviews30d * priceAvg * correctionFactor;
    }

    // Quick: Terjual/Bulan × Harga Rata-rata
    // Fallback: jika API sold_per_month kosong, estimasi dari review 30 hari × koreksi
    let soldPerMonth = monthlySoldValue || 0;
    let soldPerMonthSource = monthlySoldSource;
    if (soldPerMonth === 0 && reviews30d > 0) {
      soldPerMonth = Math.round(reviews30d * correctionFactor);
      soldPerMonthSource = 'ESTIMATED';
    }
    const omsetQuick = soldPerMonth * priceAvg;
    
    return {
      scraped_at: new Date().toISOString(),
      url: url || '',
      product: {
        item_id: product?.item_id || this._extractIdFromUrl(url)?.itemid || null,
        shop_id: product?.shop_id || shop?.shop_id || this._extractIdFromUrl(url)?.shopid || null,
        name: product?.name || '',
        price_min: product?.price_min || 0,
        price_max: product?.price_max || 0,
        rating: product?.rating || 0,
        total_sold: product?.total_sold || 0,
        review_count: totalReviewsOfficial
      },
      tierSummaries: parseReviewResult?.tierSummaries || [],
      shop: shop || null,
      monthly_sold: {
        value: monthlySoldValue,
        source: monthlySoldSource
      },
      omset: {
        quick_value: omsetQuick,
        detail_value: Math.round(omsetDetail),
        sold_per_month: soldPerMonth,
        sold_per_month_source: soldPerMonthSource,
        avg_price: Math.round(priceAvg),
        reviews_30d: reviews30d,
        reviews_30d_with_price: reviews30dWithPrice,
        omset_from_reviews: omsetFromReviews30d,
        correction_factor: Math.round(correctionFactor * 10) / 10
      },
      review_sample: {
        reviews_scraped: recentSalesCount,
        reviews_total: totalReviewsOfficial,
        coverage_percent: sampleCoverage,
        unique_variants_found: Object.keys(parseReviewResult?.reviewVariantsCount || {}).length,
        data_note: recentSalesCount > 0
          ? (sampleCoverage >= 100
              ? `✅ Semua ${Number(totalReviewsOfficial).toLocaleString('id-ID')} ulasan berhasil ter-scrape (${Number(recentSalesCount).toLocaleString('id-ID')} unik)`
              : `Sampel dari ${Number(recentSalesCount).toLocaleString('id-ID')} ulasan unik (${sampleCoverage}% dari ${Number(totalReviewsOfficial).toLocaleString('id-ID')} total)${recentSalesCount >= 3000 ? ' — batas maksimal pagination web Shopee' : ''}`)
          : 'Belum ada ulasan yang ter-scrape'
      },
      variants: variants,
      star_filter: activeStarFilter,
      star_filter_label: starFilterLabel,
      star_filter_label_short: starFilterLabelShort,
      filtered_reviews: negativeReviews || [], // Nama lebih netral (bukan hanya 'negatif')
      negative_reviews: negativeReviews || [], // Tetap ada untuk backward compatibility
      currency_symbol: this.getCurrencySymbol(url),
      review_insights: this.extractReviewInsights(negativeReviews)
    };
  }
};

if (typeof module !== 'undefined') {
  module.exports = ShopeeParser;
}
