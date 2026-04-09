/**
 * Product fingerprint utilities.
 *
 * Converts visitor product page paths and order product titles into
 * comparable product evidence for the matching engine.
 */

/**
 * Normalise a product title string: lowercase, strip Shopify link markers,
 * remove non-alphanumeric characters (keep spaces, hyphens, slashes), and
 * collapse whitespace.
 */
function normalizeProductTitle(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\(not linked to shopify\)/gi, '')
    .replace(/[^a-z0-9\s/\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalise a visitor product page path (or URL) into a comparable handle.
 *
 * Examples:
 *   '/products/rak-wastafel-dapur?ref=ad' → 'rak-wastafel-dapur'
 *   'https://shop.com/products/rak-wastafel-dapur' → 'rak-wastafel-dapur'
 */
function normalizeProductPath(value) {
  let normalized = String(value || '').trim().toLowerCase();

  if (!normalized) {
    return '';
  }

  try {
    normalized = decodeURIComponent(normalized);
  } catch (_) {
    // Ignore malformed URI components and keep the original text.
  }

  // Strip protocol + host
  normalized = normalized.replace(/^https?:\/\/[^/]+/i, '');
  // Strip query string and fragment
  normalized = normalized.split(/[?#]/)[0];
  // Strip leading/trailing slashes
  normalized = normalized.replace(/^\/+/, '').replace(/\/+$/, '');
  // Strip 'products/' prefix
  if (normalized.startsWith('products/')) {
    normalized = normalized.slice('products/'.length);
  }
  // Normalise separators
  normalized = normalized
    .replace(/[_\s]+/g, '-')
    .replace(/[^a-z0-9\-]+/g, '')
    .trim();

  return normalized;
}

/**
 * Build a visitor product fingerprint from the visitor's product page path.
 *
 * @param {string} value - The visitor's product_id / path / URL
 * @returns {{ raw: string, handle: string, tokens: string[] }}
 */
function buildVisitorProductFingerprint(value) {
  const raw = String(value || '');
  const handle = normalizeProductPath(raw);
  const tokens = handle.split(/[-/]/).filter(Boolean);
  return { raw, handle, tokens };
}

/**
 * Build tokens from an order product title.
 *
 * @param {string} title - Order line item title
 * @returns {string[]}
 */
function buildTitleTokens(title) {
  const cleaned = normalizeProductTitle(title);
  return cleaned.split(/[\s\-/]+/).filter(Boolean);
}

/**
 * Classify how strongly an order's product titles match a visitor's product path.
 *
 * @param {string[]} orderTitles - Array of order line item titles
 * @param {string} visitorPath - The visitor's product page path
 * @returns {{ level: 'strong' | 'weak' | 'none', overlapRatio: number, overlapCount: number, details: string }}
 */
function classifyProductEvidence(orderTitles, visitorPath) {
  const visitorFp = buildVisitorProductFingerprint(visitorPath);

  if (!visitorFp.handle || visitorFp.tokens.length === 0) {
    return { level: 'none', overlapRatio: 0, overlapCount: 0, details: 'visitor_no_product' };
  }

  if (!Array.isArray(orderTitles) || orderTitles.length === 0) {
    return { level: 'none', overlapRatio: 0, overlapCount: 0, details: 'order_no_titles' };
  }

  let bestOverlapRatio = 0;
  let bestOverlapCount = 0;
  let bestTitle = '';

  for (const title of orderTitles) {
    const titleTokens = buildTitleTokens(title);
    if (titleTokens.length === 0) {
      continue;
    }

    // Count how many visitor tokens appear in the title
    const visitorSet = new Set(visitorFp.tokens);
    const titleSet = new Set(titleTokens);
    let overlap = 0;

    for (const token of visitorSet) {
      if (titleSet.has(token)) {
        overlap += 1;
      }
    }

    // Use the smaller set as the denominator to avoid penalising long titles
    const denominator = Math.min(visitorSet.size, titleSet.size);
    const ratio = denominator > 0 ? overlap / denominator : 0;

    if (ratio > bestOverlapRatio || (ratio === bestOverlapRatio && overlap > bestOverlapCount)) {
      bestOverlapRatio = ratio;
      bestOverlapCount = overlap;
      bestTitle = title;
    }
  }

  if (bestOverlapRatio >= 0.75 && bestOverlapCount >= 2) {
    return {
      level: 'strong',
      overlapRatio: bestOverlapRatio,
      overlapCount: bestOverlapCount,
      details: `strong_match:${bestTitle}`,
    };
  }

  if (bestOverlapRatio >= 0.50 && bestOverlapCount >= 2) {
    return {
      level: 'weak',
      overlapRatio: bestOverlapRatio,
      overlapCount: bestOverlapCount,
      details: `weak_match:${bestTitle}`,
    };
  }

  return {
    level: 'none',
    overlapRatio: bestOverlapRatio,
    overlapCount: bestOverlapCount,
    details: 'no_match',
  };
}

module.exports = {
  normalizeProductTitle,
  normalizeProductPath,
  buildVisitorProductFingerprint,
  buildTitleTokens,
  classifyProductEvidence,
};
