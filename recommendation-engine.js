/* ============================================================
   ROMUYKS — AI RECOMMENDATION ENGINE
   Tracks user behavior & provides real-time recommendations
============================================================ */

const RecommendationEngine = (() => {

  const STORAGE_KEY = 'romuyks_user_behavior';
  const MAX_HISTORY = 50;
  const API_BASE = 'http://localhost:5000';

  /* =========================
     BEHAVIOR TRACKING STORE
  ========================= */
  function getBehavior() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || defaultBehavior();
    } catch { return defaultBehavior(); }
  }

  function saveBehavior(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  function defaultBehavior() {
    return {
      viewedProducts: [],   // { name, price, category, image, timestamp, count }
      cartHistory: [],      // { name, price, image, timestamp }
      purchaseHistory: [],  // { name, price, image, timestamp }
      categoryScores: {},   // { categoryName: score }
      priceRange: { min: 0, max: 0, avg: 0 }
    };
  }

  /* =========================
     TRACK: PRODUCT VIEW
  ========================= */
  function trackView(name, price, image, category) {
    const data = getBehavior();
    const existing = data.viewedProducts.find(v => v.name === name);
    if (existing) {
      existing.count += 1;
      existing.timestamp = Date.now();
    } else {
      data.viewedProducts.push({
        name, price: parseFloat(price) || 0, image, category: category || 'general',
        timestamp: Date.now(), count: 1
      });
    }
    // Trim to max history
    if (data.viewedProducts.length > MAX_HISTORY)
      data.viewedProducts = data.viewedProducts.slice(-MAX_HISTORY);
    // Update category scores
    const cat = category || 'general';
    data.categoryScores[cat] = (data.categoryScores[cat] || 0) + 1;
    // Update price range
    updatePriceRange(data);
    saveBehavior(data);
  }

  /* =========================
     TRACK: ADD TO CART
  ========================= */
  function trackCartAdd(name, price, image) {
    const data = getBehavior();
    data.cartHistory.push({ name, price: parseFloat(price) || 0, image, timestamp: Date.now() });
    if (data.cartHistory.length > MAX_HISTORY)
      data.cartHistory = data.cartHistory.slice(-MAX_HISTORY);
    updatePriceRange(data);
    saveBehavior(data);
  }

  /* =========================
     TRACK: PURCHASE
  ========================= */
  function trackPurchase(items) {
    const data = getBehavior();
    items.forEach(item => {
      data.purchaseHistory.push({
        name: item.name, price: parseFloat(item.price) || 0,
        image: item.image, timestamp: Date.now()
      });
    });
    if (data.purchaseHistory.length > MAX_HISTORY)
      data.purchaseHistory = data.purchaseHistory.slice(-MAX_HISTORY);
    updatePriceRange(data);
    saveBehavior(data);
  }

  function updatePriceRange(data) {
    const allPrices = [
      ...data.viewedProducts.map(p => p.price),
      ...data.cartHistory.map(p => p.price),
      ...data.purchaseHistory.map(p => p.price)
    ].filter(p => p > 0);
    if (allPrices.length > 0) {
      data.priceRange.min = Math.min(...allPrices);
      data.priceRange.max = Math.max(...allPrices);
      data.priceRange.avg = allPrices.reduce((a, b) => a + b, 0) / allPrices.length;
    }
  }

  /* =========================
     SCORING ALGORITHM
  ========================= */
  function scoreProduct(product, behavior, context) {
    let score = 0;
    const pName = (product.name || '').toLowerCase();
    const pCat = (product.category || 'general').toLowerCase();
    const pPrice = product.price || 0;

    // 1. Category affinity (weight: 30)
    Object.entries(behavior.categoryScores).forEach(([cat, count]) => {
      if (pCat === cat.toLowerCase()) score += count * 5;
    });

    // 2. Price proximity to user's preferred range (weight: 20)
    if (behavior.priceRange.avg > 0) {
      const diff = Math.abs(pPrice - behavior.priceRange.avg);
      const maxDiff = behavior.priceRange.max - behavior.priceRange.min || 1;
      score += Math.max(0, 20 - (diff / maxDiff) * 20);
    }

    // 3. Recency of views — recently viewed categories/price ranges get boosted
    const recentViews = behavior.viewedProducts.slice(-10);
    recentViews.forEach(v => {
      if (pCat === (v.category || '').toLowerCase()) score += 3;
      if (Math.abs(pPrice - v.price) < 200) score += 2;
      // Name similarity (shared words)
      const sharedWords = nameOverlap(pName, (v.name || '').toLowerCase());
      score += sharedWords * 4;
    });

    // 4. Co-purchase / co-cart boost (weight: 25)
    if (context.currentProduct) {
      const cpName = context.currentProduct.toLowerCase();
      // Items bought together with the current product
      behavior.cartHistory.forEach(c => {
        if (c.name.toLowerCase() !== cpName && pName !== cpName) {
          const sharedWords = nameOverlap(pName, c.name.toLowerCase());
          score += sharedWords * 3;
        }
      });
    }

    // 5. Cart complement — if user has items in cart, recommend complementary
    if (context.cartItems && context.cartItems.length > 0) {
      context.cartItems.forEach(ci => {
        if (pName !== ci.name.toLowerCase()) {
          score += 2; // general diversity bonus
          if (Math.abs(pPrice - (ci.price || 0)) < 300) score += 3;
        }
      });
    }

    // 6. Popularity fallback — view count from behavior
    const viewEntry = behavior.viewedProducts.find(v => v.name.toLowerCase() === pName);
    if (viewEntry) score -= 5; // penalize already-viewed for freshness

    // 7. Avoid already purchased
    const purchased = behavior.purchaseHistory.find(p => p.name.toLowerCase() === pName);
    if (purchased) score -= 20;

    return score;
  }

  function nameOverlap(a, b) {
    const stopWords = new Set(['the', 'a', 'an', 'for', 'and', 'or', 'with', 'in', 'of']);
    const wordsA = a.split(/\s+/).filter(w => w.length > 2 && !stopWords.has(w));
    const wordsB = b.split(/\s+/).filter(w => w.length > 2 && !stopWords.has(w));
    return wordsA.filter(w => wordsB.includes(w)).length;
  }

  /* =========================
     RECOMMENDATION GENERATORS
  ========================= */

  // Fetch all products once and cache for the session
  let _productsCache = null;
  let _cacheTime = 0;
  const CACHE_TTL = 5 * 60 * 1000; // 5 min

  async function fetchProducts() {
    if (_productsCache && _productsCache.length > 0 && (Date.now() - _cacheTime < CACHE_TTL)) return _productsCache;
    try {
      const res = await fetch(API_BASE + '/api/products');
      const data = await res.json();
      if (data && data.length > 0) {
        _productsCache = data;
        _cacheTime = Date.now();
        return _productsCache;
      }
    } catch { /* API unavailable */ }

    // Fallback: scrape from DOM product cards
    const domProducts = [];
    document.querySelectorAll('.product-card').forEach(card => {
      const onclick = (card.getAttribute('onclick') || '').replace(/\n/g, ' ').replace(/\s+/g, ' ');
      const match = onclick.match(/openModal\s*\(\s*'([^']*)'\s*,\s*'[^\d]*(\d+)'\s*,\s*'([^']*)'\s*,\s*\[([^\]]*)\]\s*,\s*'([^']*)'/);
      if (match) {
        domProducts.push({
          name: match[1],
          price: parseInt(match[2]) || 0,
          description: match[3],
          category: '',
          image: match[5]
        });
      }
    });
    if (domProducts.length > 0) {
      _productsCache = domProducts;
      _cacheTime = Date.now();
    }
    return _productsCache || [];
  }

  /**
   * "Recommended For You" — personalized based on full behavior profile
   */
  async function getRecommendedForYou(limit = 6, excludeNames = []) {
    const products = await fetchProducts();
    const behavior = getBehavior();
    const exclude = new Set(excludeNames.map(n => n.toLowerCase()));

    const scored = products
      .filter(p => !exclude.has((p.name || '').toLowerCase()))
      .map(p => ({ product: p, score: scoreProduct(p, behavior, {}) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return scored.map(s => s.product);
  }

  /* =========================
     KEYWORD TAG GROUPS
     Used for smart similarity matching
  ========================= */
  const KEYWORD_GROUPS = [
    { tag: 'lighting', words: ['lamp', 'bulb', 'light', 'led', 'glow', 'projector', 'crystal', 'moon', 'night', 'neon', 'fairy'] },
    { tag: 'kitchen', words: ['waffle', 'maker', 'mixer', 'blender', 'toaster', 'oven', 'cooker', 'kitchen', 'cook', 'bake'] },
    { tag: 'winter', words: ['ear', 'muff', 'warm', 'winter', 'glove', 'scarf', 'beanie', 'jacket', 'coat'] },
    { tag: 'home-decor', words: ['aroma', 'diffuser', 'candle', 'decor', 'vase', 'frame', 'cushion', 'rug', 'curtain'] },
    { tag: 'audio', words: ['speaker', 'headphone', 'earphone', 'earbud', 'sound', 'music', 'bluetooth'] },
    { tag: 'tech', words: ['phone', 'charger', 'cable', 'gadget', 'smart', 'wireless', 'usb', 'power', 'bank'] },
    { tag: 'ambiance', words: ['galaxy', 'star', 'projector', 'mood', 'ambiance', 'diffuser', 'aroma', 'lamp', 'night'] },
  ];

  function getProductTags(name, description) {
    const text = ((name || '') + ' ' + (description || '')).toLowerCase();
    const tags = new Set();
    KEYWORD_GROUPS.forEach(group => {
      for (const word of group.words) {
        if (text.includes(word)) { tags.add(group.tag); break; }
      }
    });
    return tags;
  }

  /**
   * "Similar Products" — shows only genuinely similar products
   * Uses category, keyword tags, name overlap, and description matching.
   * Returns empty array if no product passes the similarity threshold.
   */
  const SIMILARITY_THRESHOLD = 15;

  async function getSimilarProducts(currentProductName, limit = 4, currentDesc, currentCategory) {
    const products = await fetchProducts();
    const cpName = (currentProductName || '').toLowerCase();

    // Find the current product from API (fallback to passed params)
    const current = products.find(p => (p.name || '').toLowerCase() === cpName);
    const currentCat = (currentCategory || (current ? current.category : '') || '').toLowerCase();
    const currentPrice = current ? current.price : 0;
    const currentDescription = currentDesc || (current ? current.description : '') || '';

    // Get keyword tags for the current product
    const currentTags = getProductTags(currentProductName, currentDescription);

    const scored = products
      .filter(p => (p.name || '').toLowerCase() !== cpName)
      .map(p => {
        let sim = 0;
        const cat = (p.category || '').toLowerCase();
        const pDesc = (p.description || '').toLowerCase();

        // 1. Exact category match (strong signal)
        if (cat && currentCat && cat === currentCat && cat !== 'general') sim += 30;

        // 2. Keyword tag overlap (strongest signal for uncategorized products)
        const pTags = getProductTags(p.name, p.description);
        let tagOverlap = 0;
        currentTags.forEach(t => { if (pTags.has(t)) tagOverlap++; });
        sim += tagOverlap * 25;

        // 3. Name word overlap
        const overlap = nameOverlap((p.name || '').toLowerCase(), cpName);
        sim += overlap * 15;

        // 4. Description word overlap
        if (currentDescription && pDesc) {
          const descOverlap = nameOverlap(pDesc, currentDescription.toLowerCase());
          sim += descOverlap * 5;
        }

        // 5. Price proximity (minor signal)
        if (currentPrice > 0 && p.price > 0) {
          const ratio = Math.min(p.price, currentPrice) / Math.max(p.price, currentPrice);
          sim += ratio * 8; // max +8 for same price
        }

        return { product: p, score: sim };
      })
      .filter(s => s.score >= SIMILARITY_THRESHOLD)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return scored.map(s => s.product);
  }

  /**
   * "Customers Also Bought" — based on cart/purchase co-occurrence
   */
  async function getCustomersAlsoBought(currentItems, limit = 4) {
    const products = await fetchProducts();
    const behavior = getBehavior();
    const currentNames = new Set(currentItems.map(i => (i.name || '').toLowerCase()));

    const scored = products
      .filter(p => !currentNames.has((p.name || '').toLowerCase()))
      .map(p => {
        let score = 0;
        // Check co-occurrence in cart history
        const cartNames = behavior.cartHistory.map(c => c.name.toLowerCase());
        const purchaseNames = behavior.purchaseHistory.map(c => c.name.toLowerCase());

        currentNames.forEach(cn => {
          // If current item and candidate were both in cart history, strong signal
          if (cartNames.includes(cn) && cartNames.includes((p.name || '').toLowerCase())) {
            score += 15;
          }
          if (purchaseNames.includes(cn) && purchaseNames.includes((p.name || '').toLowerCase())) {
            score += 20;
          }
        });

        // Price complementarity
        const avgCurrentPrice = currentItems.reduce((s, i) => s + (i.price || 0), 0) / currentItems.length;
        if (Math.abs(p.price - avgCurrentPrice) < 500) score += 10;

        // Category diversity bonus
        score += scoreProduct(p, behavior, { cartItems: currentItems }) * 0.2;

        // General popularity from views
        const views = behavior.viewedProducts.find(v => v.name.toLowerCase() === (p.name || '').toLowerCase());
        if (views) score += views.count * 2;

        return { product: p, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return scored.map(s => s.product);
  }

  /**
   * "Trending / Popular" — fallback when no behavior data
   */
  async function getTrending(limit = 6, excludeNames = []) {
    const products = await fetchProducts();
    const exclude = new Set(excludeNames.map(n => n.toLowerCase()));
    // Shuffle for variety, then return top N
    const shuffled = products
      .filter(p => !exclude.has((p.name || '').toLowerCase()))
      .sort(() => Math.random() - 0.5)
      .slice(0, limit);
    return shuffled;
  }

  /* =========================
     UI RENDERING
  ========================= */

  function renderProductCard(product) {
    const name = product.name || 'Product';
    const price = product.price || 0;
    const image = product.image || '';
    const desc = product.description || '';
    const escapedName = name.replace(/'/g, "\\'");
    const escapedDesc = desc.replace(/'/g, "\\'");

    return `
      <div class="rec-product-card" onclick="if(typeof openModal==='function') openModal('${escapedName}','₹${price}','${escapedDesc}',['Amazon','Flipkart','Meesho'],'${image}')">
        <div class="rec-product-img">
          <img src="imgs/${image}" alt="${name}" onerror="this.src='https://placehold.co/200x200/1c1a27/666?text=No+Image'">
        </div>
        <div class="rec-product-info">
          <h4>${name}</h4>
          <span class="rec-product-price">₹${price.toLocaleString('en-IN')}</span>
        </div>
        <button class="rec-add-to-cart" onclick="event.stopPropagation(); addToCart('${escapedName}', ${price}, '${image}'); if(typeof RecommendationEngine!=='undefined') RecommendationEngine.trackCartAdd('${escapedName}',${price},'${image}');">
          <i class="fa-solid fa-cart-plus"></i> Add
        </button>
      </div>
    `;
  }

  function renderSection(containerId, title, icon, products) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (!products || products.length === 0) {
      container.style.display = 'none';
      return;
    }

    container.style.display = 'block';
    container.innerHTML = `
      <div class="rec-section">
        <div class="rec-section-header">
          <div class="rec-section-title">
            <span class="rec-icon">${icon}</span>
            <h3>${title}</h3>
          </div>
          <div class="rec-scroll-controls">
            <button class="rec-scroll-btn" onclick="this.closest('.rec-section').querySelector('.rec-products-row').scrollBy({left:-280,behavior:'smooth'})">
              <i class="fa-solid fa-chevron-left"></i>
            </button>
            <button class="rec-scroll-btn" onclick="this.closest('.rec-section').querySelector('.rec-products-row').scrollBy({left:280,behavior:'smooth'})">
              <i class="fa-solid fa-chevron-right"></i>
            </button>
          </div>
        </div>
        <div class="rec-products-row">
          ${products.map(p => renderProductCard(p)).join('')}
        </div>
      </div>
    `;
  }

  /* =========================
     PAGE-SPECIFIC LOADERS
  ========================= */

  /**
   * Load recommendations for the HOMEPAGE
   */
  async function loadHomepageRecommendations() {
    const behavior = getBehavior();
    const hasData = behavior.viewedProducts.length > 0 ||
                    behavior.cartHistory.length > 0 ||
                    behavior.purchaseHistory.length > 0;

    if (hasData) {
      const recommended = await getRecommendedForYou(6);
      renderSection('recForYouHome', 'Recommended For You', '<i class="fa-solid fa-wand-magic-sparkles"></i>', recommended);
    } else {
      const trending = await getTrending(6);
      renderSection('recForYouHome', 'Trending Products', '<i class="fa-solid fa-fire-flame-curved"></i>', trending);
    }

    const trending = await getTrending(6);
    renderSection('recTrendingHome', 'Popular Right Now', '<i class="fa-solid fa-bolt"></i>', trending);
  }

  /**
   * Load recommendations for the PRODUCT MODAL / SHOP PAGE
   */
  async function loadProductRecommendations(productName, productDesc, productCategory) {
    const isShopPage = typeof window !== 'undefined' && (window.location.pathname.endsWith('4.shop.html') || window.location.pathname.endsWith('/shop.html'));

    if (!isShopPage) {
      const similar = await getSimilarProducts(productName, 4, productDesc, productCategory);
      renderSection('recSimilarProducts', 'Similar Products', '<i class="fa-solid fa-layer-group"></i>', similar);
    } else {
      const container = document.getElementById('recSimilarProducts');
      if (container) {
        container.style.display = 'none';
        container.innerHTML = '';
      }
    }

    const alsoBought = await getCustomersAlsoBought(
      [{ name: productName, price: 0 }], 4
    );
    renderSection('recAlsoBought', 'Customers Also Bought', '<i class="fa-solid fa-users"></i>', alsoBought);
  }

  /**
   * Load recommendations for the CART PAGE
   */
  async function loadCartRecommendations() {
    const cart = JSON.parse(localStorage.getItem('cart')) || [];
    if (cart.length === 0) {
      const trending = await getTrending(6);
      renderSection('recCartSuggestions', 'You Might Like', '<i class="fa-solid fa-sparkles"></i>', trending);
      return;
    }

    const cartNames = cart.map(c => c.name);
    const alsoBought = await getCustomersAlsoBought(cart, 6);
    renderSection('recCartAlsoBought', 'Customers Also Bought', '<i class="fa-solid fa-users"></i>', alsoBought);

    const recommended = await getRecommendedForYou(6, cartNames);
    renderSection('recCartSuggestions', 'You Might Also Like', '<i class="fa-solid fa-wand-magic-sparkles"></i>', recommended);
  }

  /* =========================
     PUBLIC API
  ========================= */
  return {
    trackView,
    trackCartAdd,
    trackPurchase,
    getRecommendedForYou,
    getSimilarProducts,
    getCustomersAlsoBought,
    getTrending,
    loadHomepageRecommendations,
    loadProductRecommendations,
    loadCartRecommendations,
    renderSection,
    fetchProducts
  };

})();
