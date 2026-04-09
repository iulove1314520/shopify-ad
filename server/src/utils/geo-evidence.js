/**
 * IP / Geo evidence utilities.
 *
 * Converts browser_ip, visitor IP, GeoIP lookup and shipping address
 * into a layered evidence object for the matching engine.
 *
 * Evidence levels:
 *   - strong: browser_ip exact match (25 pts)
 *   - weak: GeoIP city/region match without browser_ip
 *   - none: no usable IP information
 */

const geoip = require('geoip-lite');

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeCompact(value) {
  return normalizeText(value).replace(/\s+/g, '');
}

/**
 * Build IP / Geo evidence by comparing order signals with a visitor's IP.
 *
 * @param {{ browserIp: string, shipping: { country: string, region: string, city: string, zip: string } }} orderSignals
 * @param {string} visitorIp - The visitor's IP address
 * @returns {{ level: 'strong' | 'weak' | 'none', score: number, signals: string[], summary: string }}
 */
function buildIpEvidence(orderSignals, visitorIp) {
  const normalizedVisitorIp = normalizeText(visitorIp);

  if (!normalizedVisitorIp) {
    return { level: 'none', score: 0, signals: [], summary: 'ip_missing' };
  }

  // Strong evidence: browser_ip exact match
  const normalizedBrowserIp = normalizeText(orderSignals?.browserIp);
  if (normalizedBrowserIp && normalizedVisitorIp === normalizedBrowserIp) {
    return {
      level: 'strong',
      score: 25,
      signals: ['browser_ip_exact'],
      summary: 'browser_ip_exact',
    };
  }

  // When browser_ip is available but does not match, do NOT fall back to geo
  // — the mismatch itself is meaningful.
  if (normalizedBrowserIp) {
    return {
      level: 'none',
      score: 0,
      signals: ['browser_ip_mismatch'],
      summary: 'browser_ip_mismatch',
    };
  }

  // No browser_ip available → fall back to GeoIP evidence (weak)
  const geo = geoip.lookup(normalizedVisitorIp);
  if (!geo) {
    return { level: 'none', score: 0, signals: [], summary: 'geo_lookup_failed' };
  }

  const shipping = orderSignals?.shipping || {};
  let score = 0;
  const signals = [];
  const parts = [];

  const orderCity = normalizeCompact(shipping.city);
  const geoCity = normalizeCompact(geo.city);
  if (orderCity && geoCity && orderCity === geoCity) {
    score += 10;
    signals.push('geo_city');
    parts.push(`city=${geoCity}`);
  }

  const orderRegion = normalizeText(shipping.region);
  const geoRegion = normalizeText(geo.region);
  if (orderRegion && geoRegion && orderRegion === geoRegion) {
    score += 5;
    signals.push('geo_region');
    parts.push(`region=${geoRegion}`);
  }

  // geo_country is kept in signals/summary for observability but scores 0
  // per the design constraint: "去掉 geo_country 匹配加分"
  const orderCountry = normalizeText(shipping.country);
  const geoCountry = normalizeText(geo.country);
  if (orderCountry && geoCountry && orderCountry === geoCountry) {
    signals.push('geo_country');
    parts.push(`country=${geoCountry}`);
  }

  const level = score > 0 ? 'weak' : 'none';
  const summary = parts.length > 0 ? parts.join(',') : 'geo_no_match';

  return { level, score, signals, summary };
}

module.exports = {
  buildIpEvidence,
};
