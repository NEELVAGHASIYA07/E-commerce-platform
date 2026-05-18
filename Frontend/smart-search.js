/* ============================================================
   ROMUYKS — AI SMART SEARCH ENGINE
   Fuzzy matching, typo correction, autocomplete suggestions
============================================================ */

const SmartSearch = (() => {

  const API_BASE = 'http://localhost:5000';
  let _allProducts = null;
  let _cacheTime = 0;
  const CACHE_TTL = 5 * 60 * 1000;
  let _debounceTimer = null;

  const SYNONYM_MAP = {
    earbuds: ['ear buds', 'earbud', 'ear bud', 'earphone', 'earphones'],
    'ear buds': ['earbuds', 'earphone', 'earphones'],
    headphone: ['headphones', 'headset'],
    headphones: ['headphone', 'headset'],
    mobile: ['phone', 'smartphone', 'iphone'],
    phone: ['mobile', 'smartphone', 'iphone'],
    projector: ['galaxy projector'],
    kurta: ['fashion', 'clothing'],
    diffuser: ['aroma diffuser'],
    bulb: ['lamp', 'lighting'],
    lamp: ['bulb', 'lighting']
  };

  const CATEGORY_INTENT_GROUPS = [
    {
      terms: ['tech', 'electronics', 'gadget', 'headphone', 'headphones', 'earbuds', 'ear buds', 'projector', 'bulb', 'lamp', 'iphone', 'phone', 'mobile'],
      categoryHints: ['tech', 'electronics', 'audio', 'lighting', 'projector', 'mobile']
    },
    {
      terms: ['home', 'kitchen', 'living', 'waffle', 'diffuser', 'appliance'],
      categoryHints: ['living', 'home', 'kitchen']
    },
    {
      terms: ['beauty', 'care', 'nivea', 'skin', 'personal'],
      categoryHints: ['beauty', 'care']
    },
    {
      terms: ['fashion', 'style', 'kurta', 'muffs', 'ear muffs', 'winter', 'wear'],
      categoryHints: ['fashion', 'style', 'winter']
    }
  ];

  /* =========================
     PRODUCT CACHE
     Scrapes DOM instantly, then tries API in background
  ========================= */
  async function getAllProducts() {
    // Return cache if valid
    if (_allProducts && _allProducts.length > 0 && (Date.now() - _cacheTime < CACHE_TTL)) return _allProducts;

    // Scrape DOM immediately — this always works on the shop page
    const domProducts = scrapeProductsFromDOM();
    if (domProducts.length > 0 && !_allProducts) {
      _allProducts = domProducts;
      _cacheTime = Date.now();
    }

    // Try API with fast timeout (non-blocking upgrade)
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);
      const res = await fetch(API_BASE + '/api/products', { signal: controller.signal });
      clearTimeout(timeoutId);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          // Merge: API products + any DOM-only products (dedup by name OR image)
          const apiNames = new Set(data.map(p => (p.name || '').toLowerCase()));
          const apiImages = new Set(data.map(p => (p.image || '').toLowerCase().replace(/^.*imgs\//, '')));
          const merged = [...data];
          domProducts.forEach(dp => {
            const dpName = (dp.name || '').toLowerCase();
            const dpImg = (dp.image || '').toLowerCase().replace(/^.*imgs\//, '');
            if (!apiNames.has(dpName) && (!dpImg || !apiImages.has(dpImg))) merged.push(dp);
          });
          _allProducts = merged;
          _cacheTime = Date.now();
        }
      }
    } catch { /* API unavailable, DOM products already cached */ }

    return _allProducts || domProducts || [];
  }

  function scrapeProductsFromDOM() {
    const products = [];
    const seen = new Set();
    const cards = document.querySelectorAll('.product-card');
    cards.forEach(card => {
      // Method 1: Parse onclick attribute
      const onclick = (card.getAttribute('onclick') || '').replace(/\n/g, ' ').replace(/\s+/g, ' ');
      const match = onclick.match(/openModal\s*\(\s*'([^']*)'\s*,\s*'[^\d]*(\d+)'\s*,\s*'([^']*)'\s*,\s*\[([^\]]*)\]\s*,\s*'([^']*)'/);
      if (match) {
        const catMatch = onclick.match(/'([^']+)'\s*,?\s*\)\s*$/);
        const name = match[1];
        if (!seen.has(name.toLowerCase())) {
          seen.add(name.toLowerCase());
          products.push({
            name: name,
            price: parseInt(match[2]) || 0,
            description: match[3],
            category: catMatch ? catMatch[1] : '',
            image: match[5]
          });
        }
        return;
      }
      // Method 2: Scrape from visible elements (fallback)
      const nameEl = card.querySelector('h3');
      const priceEl = card.querySelector('.price');
      const imgEl = card.querySelector('img');
      if (nameEl) {
        const name = nameEl.textContent.trim();
        const priceText = priceEl ? priceEl.textContent.replace(/[^\d]/g, '') : '0';
        const imgSrc = imgEl ? (imgEl.getAttribute('src') || '').replace(/^.*imgs\//, '') : '';
        if (name && !seen.has(name.toLowerCase())) {
          seen.add(name.toLowerCase());
          products.push({
            name: name,
            price: parseInt(priceText) || 0,
            description: '',
            category: '',
            image: imgSrc
          });
        }
      }
    });
    return products;
  }

  /* =========================
     FUZZY / TYPO MATCHING
     Levenshtein distance for character-level similarity
  ========================= */
  function levenshtein(a, b) {
    const m = a.length, n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,
          dp[i][j - 1] + 1,
          dp[i - 1][j - 1] + cost
        );
      }
    }
    return dp[m][n];
  }

  /* Normalized similarity 0..1 (1 = identical) */
  function similarity(a, b) {
    const maxLen = Math.max(a.length, b.length);
    if (maxLen === 0) return 1;
    return 1 - levenshtein(a, b) / maxLen;
  }

  /* Check if query words appear as subsequence in text */
  function subsequenceMatch(query, text) {
    let qi = 0;
    for (let ti = 0; ti < text.length && qi < query.length; ti++) {
      if (text[ti] === query[qi]) qi++;
    }
    return qi === query.length;
  }

  function tokenizeQuery(query) {
    return String(query || "")
      .toLowerCase()
      .trim()
      .split(/\s+/)
      .map((w) => w.replace(/[^a-z0-9+-]/g, ''))
      .filter((w) => w.length > 0);
  }

  function expandQueryWords(queryWords) {
    const expanded = new Set();
    const words = Array.isArray(queryWords) ? queryWords : [];

    words.forEach((word) => {
      const cleaned = String(word || '').trim().toLowerCase();
      if (!cleaned) return;
      expanded.add(cleaned);

      const synonyms = SYNONYM_MAP[cleaned] || [];
      synonyms.forEach((syn) => {
        String(syn || '')
          .toLowerCase()
          .split(/\s+/)
          .map((w) => w.replace(/[^a-z0-9+-]/g, ''))
          .filter(Boolean)
          .forEach((token) => expanded.add(token));
      });
    });

    return Array.from(expanded);
  }

  function getCategoryBoost(product, expandedWords) {
    const words = Array.isArray(expandedWords) ? expandedWords : [];
    if (!words.length) return 0;

    const productCategory = String(product?.category || '').toLowerCase();
    const productName = String(product?.name || '').toLowerCase();
    const productContext = `${productCategory} ${productName}`;

    let boost = 0;
    CATEGORY_INTENT_GROUPS.forEach((group) => {
      const hasIntent = words.some((w) => group.terms.includes(w));
      if (!hasIntent) return;

      const categoryHit = group.categoryHints.some((hint) => productContext.includes(hint));
      if (categoryHit) boost += 14;
    });

    return boost;
  }

  function hasStrongWordMatch(token, textWords) {
    if (!token || !Array.isArray(textWords)) return false;

    // Short words like "pro" or "max" must match exactly to avoid noisy matches.
    if (token.length <= 3) {
      return textWords.some((w) => w === token);
    }

    if (textWords.some((w) => w === token)) return true;
    if (textWords.some((w) => w.startsWith(token))) return true;
    if (token.length >= 5 && textWords.some((w) => w.includes(token))) return true;

    let best = 0;
    textWords.forEach((w) => {
      const sim = similarity(token, w);
      if (sim > best) best = sim;
    });

    return best >= 0.78;
  }

  function countStrongQueryWordMatches(product, query) {
    const qWords = tokenizeQuery(query);
    const nameWords = String(product?.name || "").toLowerCase().split(/\s+/).filter(Boolean);
    const descWords = String(product?.description || "").toLowerCase().split(/\s+/).filter(Boolean);
    const catWords = String(product?.category || "").toLowerCase().split(/\s+/).filter(Boolean);
    const allWords = [...nameWords, ...descWords, ...catWords];

    let matched = 0;
    qWords.forEach((qw) => {
      if (hasStrongWordMatch(qw, allWords)) matched += 1;
    });

    return matched;
  }

  function getRequiredStrongMatches(queryWords) {
    const words = Array.isArray(queryWords) ? queryWords.filter(Boolean) : [];
    if (words.length >= 3) return 2;
    if (words.length === 2) return 2;
    return 1;
  }

  /* =========================
     SMART SCORING
     Combines exact match, prefix, contains, fuzzy, word overlap
  ========================= */
  function scoreProduct(product, query) {
    const q = query.toLowerCase().trim();
    if (!q) return 0;

    const name = (product.name || '').toLowerCase();
    const desc = (product.description || '').toLowerCase();
    const cat = (product.category || '').toLowerCase();
    const fullText = name + ' ' + desc + ' ' + cat;

    let score = 0;
    const qWords = tokenizeQuery(q);
    const expandedQWords = expandQueryWords(qWords);

    // 1. Exact name match
    if (name === q) score += 100;

    // 2. Name starts with query
    if (name.startsWith(q)) score += 70;

    // 3. Name contains query
    if (name.includes(q)) score += 50;

    // 4. Description/category contains query
    if (desc.includes(q) || cat.includes(q)) score += 30;

    // 5. Word-level matching (each query word)
    const nameWords = name.split(/\s+/);
    const allWords = fullText.split(/\s+/);

    expandedQWords.forEach(qw => {
      // Exact word match in name
      if (nameWords.some(nw => nw === qw)) score += 25;
      // Prefix match in name words
      else if (qw.length >= 4 && nameWords.some(nw => nw.startsWith(qw))) score += 20;
      // Contains match in name words
      else if (qw.length >= 5 && nameWords.some(nw => nw.includes(qw))) score += 12;
      // Match in description/category
      else if (qw.length >= 4 && allWords.some(w => w.includes(qw))) score += 8;
      // Fuzzy match against name words (typo correction)
      else if (qw.length >= 4) {
        let bestFuzzy = 0;
        nameWords.forEach(nw => {
          const sim = similarity(qw, nw);
          if (sim > bestFuzzy) bestFuzzy = sim;
        });
        // Accept if similarity > 0.6 (allows 1-2 char typos for short words)
        if (bestFuzzy > 0.6) score += bestFuzzy * 20;
        else {
          // Try fuzzy against all words
          allWords.forEach(w => {
            const sim = similarity(qw, w);
            if (sim > bestFuzzy) bestFuzzy = sim;
          });
          if (bestFuzzy > 0.6) score += bestFuzzy * 10;
        }
      }
    });

    // 6. Subsequence bonus (e.g., "wfl" matches "waffle")
    if (subsequenceMatch(q.replace(/\s/g, ''), name.replace(/\s/g, ''))) {
      score += 15;
    }

    // 7. Overall fuzzy similarity between full query and name
    const nameSim = similarity(q, name);
    if (nameSim > 0.5) score += nameSim * 15;

    // 8. Intent-aware category boost
    score += getCategoryBoost(product, expandedQWords);

    // 9. Price query handling ("under 500", "below 800", "above 1000")
    const priceUnder = q.match(/(?:under|below|less than|upto|up to|within|<=?)\s*(\d+)/);
    const priceAbove = q.match(/(?:above|over|more than|greater than|>=?)\s*(\d+)/);
    const priceRange = q.match(/(\d+)\s*(?:to|-)\s*(\d+)/);

    if (priceUnder && product.price <= parseInt(priceUnder[1])) score += 40;
    if (priceAbove && product.price >= parseInt(priceAbove[1])) score += 40;
    if (priceRange) {
      const lo = parseInt(priceRange[1]), hi = parseInt(priceRange[2]);
      if (product.price >= lo && product.price <= hi) score += 40;
    }

    return score;
  }

  /* =========================
     AUTOCOMPLETE SUGGESTIONS
     Returns top matches as user types
  ========================= */
  async function getAutocompleteSuggestions(query, limit = 6) {
    if (!query || query.trim().length < 1) return [];
    const products = await getAllProducts();
    const qWords = tokenizeQuery(query);

    const requiredMatches = getRequiredStrongMatches(qWords);

    const scored = products
      .map(p => ({
        product: p,
        score: scoreProduct(p, query),
        matchedWords: countStrongQueryWordMatches(p, query)
      }))
      .filter(s => {
        if (qWords.length >= 3) return s.matchedWords >= requiredMatches && s.score > 12;
        if (qWords.length === 2) return s.matchedWords >= requiredMatches && s.score > 8;
        return s.matchedWords >= 1 && s.score > 5;
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return scored.map(s => s.product);
  }

  /* =========================
     FULL SEARCH (with typo correction)
  ========================= */
  async function search(query, limit = 10) {
    if (!query || query.trim().length === 0) return [];
    const products = await getAllProducts();
    const qWords = tokenizeQuery(query);

    const requiredMatches = getRequiredStrongMatches(qWords);

    const scored = products
      .map(p => ({
        product: p,
        score: scoreProduct(p, query),
        matchedWords: countStrongQueryWordMatches(p, query)
      }))
      .filter(s => {
        if (qWords.length >= 3) return s.matchedWords >= requiredMatches && s.score > 12;
        if (qWords.length === 2) return s.matchedWords >= requiredMatches && s.score > 8;
        return s.matchedWords >= 1 && s.score > 5;
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    const results = scored.map(s => s.product);

    if (typeof window !== 'undefined' && typeof window.trackAnalyticsEvent === 'function') {
      window.trackAnalyticsEvent('search_used', {
        query: String(query || '').slice(0, 120),
        resultCount: results.length
      });

      if (results.length === 0) {
        window.trackAnalyticsEvent('search_zero_results', {
          query: String(query || '').slice(0, 120)
        });
      }
    }

    return results;
  }

  /* =========================
     RENDER: AUTOCOMPLETE DROPDOWN
  ========================= */
  function renderAutocompleteDropdown(containerId, products, query, onSelect) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (!products || products.length === 0) {
      container.style.display = 'none';
      container.innerHTML = '';
      return;
    }

    const q = (query || '').toLowerCase();

    let html = '<div class="smart-ac-header"><i class="fa-solid fa-wand-magic-sparkles"></i> Suggestions</div>';

    products.forEach(p => {
      const name = p.name || 'Product';
      const price = p.price || 0;
      const image = p.image || '';
      const desc = p.description || '';
      const shortDesc = desc.length > 60 ? desc.substring(0, 60) + '...' : desc;

      // Highlight matching text in name
      const highlightedName = highlightMatch(name, q);

      html += `
        <div class="smart-ac-item" data-name="${name.replace(/"/g, '&quot;')}" data-price="${price}" data-image="${image}" data-desc="${desc.replace(/"/g, '&quot;')}">
          <img class="smart-ac-img" src="imgs/${image}" alt="${name}" onerror="this.src='https://placehold.co/48x48/1c1a27/666?text=?'">
          <div class="smart-ac-info">
            <div class="smart-ac-name">${highlightedName}</div>
            <div class="smart-ac-desc">${shortDesc}</div>
          </div>
          <div class="smart-ac-price">₹${price.toLocaleString('en-IN')}</div>
        </div>`;
    });

    container.innerHTML = html;
    container.style.display = 'block';

    // Add click handlers
    container.querySelectorAll('.smart-ac-item').forEach(item => {
      item.addEventListener('click', () => {
        const data = {
          name: item.dataset.name,
          price: item.dataset.price,
          image: item.dataset.image,
          desc: item.dataset.desc
        };
        if (onSelect) onSelect(data);
      });
    });
  }

  function highlightMatch(text, query) {
    if (!query) return text;
    const qWords = query.split(/\s+/).filter(w => w.length > 0);
    if (qWords.length === 0) return text;
    // Build a single regex matching any query word to avoid replacing inside previous <mark> tags
    const escaped = qWords.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const regex = new RegExp('(' + escaped.join('|') + ')', 'gi');
    return text.replace(regex, '<mark class="smart-ac-highlight">$1</mark>');
  }

  /* =========================
     RENDER: FULL SEARCH RESULTS GRID
  ========================= */
  function renderSearchResults(containerId, products, query) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (!products || products.length === 0) {
      container.innerHTML = `
        <div class="smart-no-results">
          <i class="fa-solid fa-magnifying-glass"></i>
          <p>No products found for "<strong>${query}</strong>"</p>
          <span>Try checking your spelling or use different keywords</span>
        </div>`;
      return;
    }

    let html = `<div class="smart-results-header">
      <span><i class="fa-solid fa-sparkles"></i> Found ${products.length} result${products.length !== 1 ? 's' : ''} for "<strong>${query}</strong>"</span>
    </div>
    <div class="smart-results-grid">`;

    products.forEach(p => {
      const name = p.name || 'Product';
      const price = p.price || 0;
      const image = p.image || '';
      const desc = p.description || '';
      const escapedName = name.replace(/'/g, "\\'");
      const escapedDesc = desc.replace(/'/g, "\\'");
      const category = (p.category || '').replace(/'/g, "\\'");

      html += `
        <div class="smart-result-card" onclick="if(typeof openModal==='function') openModal('${escapedName}','₹${price}','${escapedDesc}',['Amazon','Flipkart','Meesho'],'${image}','${category}')">
          <div class="smart-result-img-wrap">
            <img src="imgs/${image}" alt="${name}" onerror="this.src='https://placehold.co/200x200/1c1a27/666?text=No+Image'">
          </div>
          <div class="smart-result-body">
            <h4 class="smart-result-name">${name}</h4>
            <p class="smart-result-desc">${desc.length > 80 ? desc.substring(0, 80) + '...' : desc}</p>
            <div class="smart-result-footer">
              <span class="smart-result-price">₹${price.toLocaleString('en-IN')}</span>
              <button class="smart-result-cart-btn" onclick="event.stopPropagation(); addToCart('${escapedName}', ${price}, '${image}');">
                <i class="fa-solid fa-cart-plus"></i>
              </button>
            </div>
          </div>
        </div>`;
    });

    html += '</div>';
    container.innerHTML = html;
  }

  /* =========================
     DEBOUNCED INPUT HANDLER
     Wire this to the search input's 'input' event
  ========================= */
  function debounceAutocomplete(query, dropdownId, onSelect, delay = 250) {
    clearTimeout(_debounceTimer);
    _debounceTimer = setTimeout(async () => {
      const suggestions = await getAutocompleteSuggestions(query, 6);
      renderAutocompleteDropdown(dropdownId, suggestions, query, onSelect);
    }, delay);
  }

  function hideAutocomplete(dropdownId) {
    clearTimeout(_debounceTimer);
    const el = document.getElementById(dropdownId);
    if (el) { el.style.display = 'none'; el.innerHTML = ''; }
  }

  /* =========================
     PUBLIC API
  ========================= */
  return {
    search,
    getAutocompleteSuggestions,
    getAllProducts,
    renderAutocompleteDropdown,
    renderSearchResults,
    debounceAutocomplete,
    hideAutocomplete,
    scoreProduct
  };

})();
