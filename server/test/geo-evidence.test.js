const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const { buildIpEvidence } = require('../src/utils/geo-evidence');

describe('geo-evidence', () => {
  // ──────── browser_ip exact ────────

  test('browser_ip 精确一致时返回 strong IP evidence', () => {
    const evidence = buildIpEvidence(
      {
        browserIp: '198.51.100.24',
        shipping: { country: 'id', region: '', city: 'bekasi', zip: '17610' },
      },
      '198.51.100.24'
    );

    assert.equal(evidence.level, 'strong');
    assert.equal(evidence.score, 25);
    assert.ok(evidence.signals.includes('browser_ip_exact'));
  });

  test('browser_ip 存在但不一致时返回 none（不降级到 geo）', () => {
    const evidence = buildIpEvidence(
      {
        browserIp: '198.51.100.24',
        shipping: { country: 'id', region: '', city: 'bekasi', zip: '17610' },
      },
      '10.0.0.1'
    );

    assert.equal(evidence.level, 'none');
    assert.ok(evidence.signals.includes('browser_ip_mismatch'));
  });

  // ──────── GeoIP fallback ────────

  test('没有 browser_ip 时，GeoIP 城市一致只返回 weak evidence', () => {
    const evidence = buildIpEvidence(
      {
        browserIp: '',
        shipping: { country: 'id', region: '', city: 'bekasi', zip: '17610' },
      },
      '103.0.0.1'
    );

    // The geo lookup may or may not match "bekasi" depending on geoip-lite data.
    // We verify the return shape is correct and level is weak or none.
    assert.ok(['weak', 'none'].includes(evidence.level));
    assert.ok(typeof evidence.score === 'number');
    assert.ok(Array.isArray(evidence.signals));
  });

  // ──────── Edge cases ────────

  test('访客 IP 为空时返回 none', () => {
    const evidence = buildIpEvidence(
      {
        browserIp: '198.51.100.24',
        shipping: { country: 'id', region: '', city: '', zip: '' },
      },
      ''
    );

    assert.equal(evidence.level, 'none');
    assert.equal(evidence.score, 0);
    assert.equal(evidence.summary, 'ip_missing');
  });

  test('orderSignals 为 null 时不抛错', () => {
    const evidence = buildIpEvidence(null, '198.51.100.24');
    assert.ok(['weak', 'none'].includes(evidence.level));
  });

  test('geo_country 不加分', () => {
    // Even if country matches, score should not include country points
    const evidence = buildIpEvidence(
      {
        browserIp: '',
        shipping: { country: 'US', region: '', city: '', zip: '' },
      },
      '8.8.8.8' // Google DNS - US
    );

    // geo_country should appear in signals but NOT add score
    if (evidence.signals.includes('geo_country')) {
      // If country matched, score should only come from city/region (both empty here)
      assert.equal(evidence.score, 0, 'geo_country should not add score');
    }
  });
});
