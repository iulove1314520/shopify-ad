const geoip = require('geoip-lite');

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeCompactText(value) {
  return normalizeText(value).replace(/\s+/g, '');
}

function normalizeProductValue(value) {
  let normalized = String(value || '').trim().toLowerCase();

  if (!normalized) {
    return '';
  }

  try {
    normalized = decodeURIComponent(normalized);
  } catch (error) {
    // Ignore malformed URI components and keep the original text.
  }

  normalized = normalized.replace(/^https?:\/\/[^/]+/i, '');
  normalized = normalized.split(/[?#]/)[0];
  normalized = normalized.replace(/^\/+/, '').replace(/\/+$/, '');

  if (normalized.startsWith('products/')) {
    normalized = normalized.slice('products/'.length);
  }

  normalized = normalized
    .replace(/[_\s]+/g, '-')
    .replace(/[^a-z0-9/-]+/g, '')
    .replace(/\/+/g, '/')
    .trim();

  return normalized;
}

function addNormalizedValue(target, value, normalizer = normalizeText) {
  const normalized = normalizer(value);
  if (normalized) {
    target.add(normalized);
  }
}

function parseRawPayload(rawPayload) {
  if (!rawPayload) {
    return {};
  }

  if (typeof rawPayload === 'object') {
    return rawPayload;
  }

  try {
    return JSON.parse(rawPayload);
  } catch (error) {
    return {};
  }
}

function extractOrderSignals(order) {
  const payload = parseRawPayload(order?.raw_payload);
  const shippingAddress = payload.shipping_address || {};
  const clientDetails = payload.client_details || {};
  const lineItems = Array.isArray(payload.line_items) ? payload.line_items : [];
  const productKeySet = new Set();

  for (const item of lineItems) {
    addNormalizedValue(productKeySet, item?.product_id, normalizeProductValue);
    addNormalizedValue(productKeySet, item?.variant_id, normalizeProductValue);
    addNormalizedValue(productKeySet, item?.sku, normalizeProductValue);
    addNormalizedValue(productKeySet, item?.title, normalizeProductValue);
    addNormalizedValue(productKeySet, item?.name, normalizeProductValue);
    addNormalizedValue(productKeySet, item?.product_title, normalizeProductValue);
    addNormalizedValue(productKeySet, item?.handle, normalizeProductValue);
    addNormalizedValue(productKeySet, item?.product_handle, normalizeProductValue);
    addNormalizedValue(productKeySet, item?.url, normalizeProductValue);
    addNormalizedValue(productKeySet, item?.link, normalizeProductValue);
  }

  return {
    payload,
    browserIp: normalizeText(payload.browser_ip || clientDetails.browser_ip),
    productKeys: Array.from(productKeySet),
    shipping: {
      zip: normalizeCompactText(order?.zip || shippingAddress.zip),
      country: normalizeText(shippingAddress.country_code || shippingAddress.country),
      region: normalizeText(
        shippingAddress.province_code || shippingAddress.province
      ),
      city: normalizeCompactText(shippingAddress.city),
    },
  };
}

function getConfidenceFromScore(score) {
  if (score >= 80) {
    return '高';
  }

  if (score >= 55) {
    return '中';
  }

  return '低';
}

function getTimeScore(timeDiffMs) {
  const hours = timeDiffMs / (60 * 60 * 1000);

  if (hours <= 1) {
    return 65;
  }

  if (hours <= 6) {
    return 55;
  }

  if (hours <= 24) {
    return 40;
  }

  if (hours <= 48) {
    return 25;
  }

  if (hours <= 72) {
    return 12;
  }

  return 0;
}

function getIpSignals(orderSignals, visitorIp) {
  const signals = [];
  let score = 0;
  let exactIpMatched = false;
  let geoMatched = false;

  const normalizedVisitorIp = normalizeText(visitorIp);
  if (!normalizedVisitorIp) {
    return { score, signals, exactIpMatched, geoMatched };
  }

  if (orderSignals.browserIp && normalizedVisitorIp === orderSignals.browserIp) {
    return {
      score: 25,
      signals: ['browser_ip_exact'],
      exactIpMatched: true,
      geoMatched: true,
    };
  }

  const geo = geoip.lookup(normalizedVisitorIp);
  if (!geo) {
    return { score, signals, exactIpMatched, geoMatched };
  }

  const orderCountry = normalizeText(orderSignals.shipping.country);
  const orderRegion = normalizeText(orderSignals.shipping.region);
  const orderCity = normalizeCompactText(orderSignals.shipping.city);

  if (orderCountry && normalizeText(geo.country) === orderCountry) {
    score += 6;
    signals.push('geo_country');
    geoMatched = true;
  }

  if (orderRegion && normalizeText(geo.region) === orderRegion) {
    score += 4;
    signals.push('geo_region');
    geoMatched = true;
  }

  if (orderCity && normalizeCompactText(geo.city) === orderCity) {
    score += 4;
    signals.push('geo_city');
    geoMatched = true;
  }

  return { score, signals, exactIpMatched, geoMatched };
}

function scoreVisitorCandidate(order, visitor, orderSignals = extractOrderSignals(order)) {
  const orderCreatedAt = new Date(order?.created_at).getTime();
  const visitorTimestamp = new Date(visitor?.timestamp).getTime();
  const timeDiffMs = orderCreatedAt - visitorTimestamp;

  if (!Number.isFinite(orderCreatedAt) || !Number.isFinite(visitorTimestamp)) {
    return null;
  }

  if (timeDiffMs < 0) {
    return null;
  }

  const timeScore = getTimeScore(timeDiffMs);
  const visitorProductKey = normalizeProductValue(visitor?.product_id);
  const productSignals = [];
  let productScore = 0;
  let productMatched = false;

  if (visitorProductKey && orderSignals.productKeys.includes(visitorProductKey)) {
    productScore += 25;
    productSignals.push('product_match');
    productMatched = true;
  } else if (visitorProductKey && orderSignals.productKeys.length > 0) {
    productScore -= 15;
    productSignals.push('product_mismatch');
  }

  const ipSignals = getIpSignals(orderSignals, visitor?.ip);
  const score = timeScore + productScore + ipSignals.score;
  const signals = [];

  if (timeScore >= 55) {
    signals.push('time_close');
  } else if (timeScore >= 25) {
    signals.push('time_window_ok');
  } else if (timeScore > 0) {
    signals.push('time_far');
  }

  signals.push(...productSignals, ...ipSignals.signals);

  return {
    visitor,
    score,
    confidence: getConfidenceFromScore(score),
    timeDiffMs,
    signals,
    productMatched,
    exactIpMatched: ipSignals.exactIpMatched,
    geoMatched: ipSignals.geoMatched,
    orderProductSignalCount: orderSignals.productKeys.length,
    visitorHasProductHint: Boolean(visitorProductKey),
  };
}

function rankVisitorCandidates(order, visitors) {
  const orderSignals = extractOrderSignals(order);

  return visitors
    .map((visitor) => scoreVisitorCandidate(order, visitor, orderSignals))
    .filter(Boolean)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return left.timeDiffMs - right.timeDiffMs;
    });
}

module.exports = {
  extractOrderSignals,
  getConfidenceFromScore,
  normalizeProductValue,
  rankVisitorCandidates,
  scoreVisitorCandidate,
};
