/**
 * parser.js
 * ==========
 * Modul untuk menormalisasi data mentah dari API Shopee atau DOM
 * menjadi format standar yang digunakan oleh popup dan exporter.
 */

const ShopeeParser = {

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
  parseNegativeReviews(rawReviewsArray, variantsArray = []) {
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
    if (variantsArray) {
        variantsArray.forEach(v => {
            v.sold_count = 0;
            v._isReviewProxy = true; // Penanda khusus bahwa data ini murni dari ulasan
        });
    }
    
    let totalReviewsParsed = 0;
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
        // Hindari duplikasi penghitungan varian dari ulasan yang sama akibat pagination Fetch
        const reviewId = review.rating_id || review.cmnt_id;
        if (reviewId) {
            if (seenKeys.has(reviewId)) return;
            seenKeys.add(reviewId);
        }

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
            totalReviewsParsed++; // Menambah rasio total seluruh ulasan
            
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
        // Fitur Review Negatif Terfilter
        // Hanya kumpulkan review bintang 1, 2, atau 3 yang memiliki komentar
        // dengan jumlah kata minimal 10.
        // ===================================
        if (stars > 3 || stars < 1) return;

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

        const dedupeKey = `${user}_${timestamp}`;
        if (seenKeys.has(dedupeKey)) return;
        seenKeys.add(dedupeKey);

        allReviews.push({
          stars: stars,
          comment: comment,
          date: date,
          user: user,
          variant: variantPurchased || '-'
        });
      });
    });
    
    // Calculate percentage for variants based on sold_count over total string matched
    if (variantsArray) {
        // Cek sumber data penjualan
        const hasApiModels = variantsArray.some(v => v._source_sold === 'api_model');

        if (hasApiModels) {
            // Jika data dari API models langsung, jumlahkan total sold dari semua varian
            const totalSoldModels = variantsArray.reduce((sum, v) => sum + (v.sold_count || 0), 0);
            
            variantsArray.forEach(v => {
                if (totalSoldModels > 0) {
                    v.sales_percentage = Math.round((v.sold_count / totalSoldModels) * 100);
                } else {
                    v.sales_percentage = 0;
                }
            });
        } else if (totalReviewsParsed > 0) {
            // Fallback ke hitung persentase dari hasil parser string ulasan (Proxy Varian)
            variantsArray.forEach(v => {
                v.sales_percentage = Math.round((v.sold_count / totalReviewsParsed) * 100);
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

    // Return object containing both the negative reviews and the total reviews counted (for trend)
    return {
      reviews: allReviews.slice(0, 50),
      totalReviewsParsed: totalReviewsParsed,
      tierSummaries: tierSummaries,
      reviewVariantsCount: reviewVariantsCount,
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
   * Bangun output JSON final yang siap diekspor
   * @param {object} product
   * @param {object} parseReviewResult
   * @param {string} url
   * @param {object|null} rawShopData
   * @param {number|null} monthlySoldFromSearch - Data riil dari search API Shopee (tertinggi prioritasnya)
   */
  buildOutput(product, parseReviewResult, url, rawShopData, monthlySoldFromSearch = null) {
    const negativeReviews = parseReviewResult?.reviews || [];
    const recentSalesCount = parseReviewResult?.totalReviewsParsed || 0;
    
    const priceAvg = ((product?.price_min || 0) + (product?.price_max || product?.price_min || 0)) / 2;
    
    // === SAMPEL REVIEW (data mentah, tanpa pengali) ===
    const totalReviewsOfficial = product?.review_count || 0;
    const sampleCoverage = totalReviewsOfficial > 0
      ? Math.round((recentSalesCount / totalReviewsOfficial) * 100)
      : 0;

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
          ? `Sampel dari ${recentSalesCount} ulasan unik (${sampleCoverage}% dari ${totalReviewsOfficial} total)`
          : 'Belum ada ulasan yang ter-scrape'
      },
      variants: variants,
      negative_reviews: negativeReviews || []
    };
  }
};

if (typeof module !== 'undefined') {
  module.exports = ShopeeParser;
}
