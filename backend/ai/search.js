import natural from "natural";

const TfIdf = natural.TfIdf;

/* Levenshtein distance for typo correction */
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
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

function similarity(a, b) {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

export function searchProducts(products, query) {

  if (!products || products.length === 0) return [];

  const lowerQuery = query.toLowerCase().trim();

  /* ---- TF-IDF scoring ---- */
  const tfidf = new TfIdf();
  products.forEach(p => {
    const text = `${p.name} ${p.description} ${p.category}`.toLowerCase();
    tfidf.addDocument(text);
  });

  const scores = [];
  tfidf.tfidfs(lowerQuery, (i, score) => {
    scores.push({ product: products[i], score });
  });

  /* ---- Fuzzy / typo matching ---- */
  const qWords = lowerQuery.split(/\s+/).filter(w => w.length > 0);

  scores.forEach(entry => {
    const p = entry.product;
    const name = (p.name || '').toLowerCase();
    const desc = (p.description || '').toLowerCase();
    const nameWords = name.split(/\s+/);
    const allWords = (name + ' ' + desc + ' ' + (p.category || '')).toLowerCase().split(/\s+/);

    /* Exact / prefix / contains bonuses */
    if (name === lowerQuery) entry.score += 50;
    else if (name.startsWith(lowerQuery)) entry.score += 30;
    else if (name.includes(lowerQuery)) entry.score += 20;

    /* Word-level fuzzy matching */
    qWords.forEach(qw => {
      if (nameWords.some(nw => nw === qw)) entry.score += 15;
      else if (nameWords.some(nw => nw.startsWith(qw))) entry.score += 10;
      else {
        let bestSim = 0;
        allWords.forEach(w => {
          const s = similarity(qw, w);
          if (s > bestSim) bestSim = s;
        });
        if (bestSim > 0.6) entry.score += bestSim * 12;
      }
    });

    /* Price query support */
    const priceUnder = lowerQuery.match(/(?:under|below|less than|upto|up to|within)\s*(\d+)/);
    const priceAbove = lowerQuery.match(/(?:above|over|more than|greater than)\s*(\d+)/);
    if (priceUnder && p.price <= parseInt(priceUnder[1])) entry.score += 25;
    if (priceAbove && p.price >= parseInt(priceAbove[1])) entry.score += 25;
  });

  /* sort */
  scores.sort((a, b) => b.score - a.score);

  let results = scores
    .filter(s => s.score > 0)
    .map(s => s.product);

  /* fallback simple search if no score */
  if (results.length === 0) {
    results = products.filter(p =>
      p.name.toLowerCase().includes(lowerQuery) ||
      (p.description || '').toLowerCase().includes(lowerQuery)
    );
  }

  return results.slice(0, 10);

}