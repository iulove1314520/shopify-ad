const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const {
  buildVisitorProductFingerprint,
  classifyProductEvidence,
  normalizeProductTitle,
  buildTitleTokens,
} = require('../src/utils/product-fingerprint');

describe('product-fingerprint', () => {
  // ──────── buildVisitorProductFingerprint ────────

  test('商品页路径会被归一化为 handle 和 token 集合', () => {
    const result = buildVisitorProductFingerprint('/products/rak-wastafel-dapur?ref=ad');
    assert.deepEqual(result, {
      raw: '/products/rak-wastafel-dapur?ref=ad',
      handle: 'rak-wastafel-dapur',
      tokens: ['rak', 'wastafel', 'dapur'],
    });
  });

  test('完整 URL 会被正确归一化', () => {
    const result = buildVisitorProductFingerprint(
      'https://shop.example.com/products/stainless-shelf-organizer?utm=tiktok'
    );
    assert.equal(result.handle, 'stainless-shelf-organizer');
    assert.deepEqual(result.tokens, ['stainless', 'shelf', 'organizer']);
  });

  test('空值返回空 handle 和空 tokens', () => {
    const result = buildVisitorProductFingerprint('');
    assert.equal(result.handle, '');
    assert.deepEqual(result.tokens, []);
  });

  // ──────── normalizeProductTitle ────────

  test('商品标题会去掉 (Not linked to Shopify) 标记', () => {
    const result = normalizeProductTitle('Rak Wastafel Dapur (Not linked to Shopify)');
    assert.ok(!result.includes('not linked'));
    assert.ok(result.includes('rak'));
    assert.ok(result.includes('wastafel'));
    assert.ok(result.includes('dapur'));
  });

  // ──────── buildTitleTokens ────────

  test('标题 token 拆分正确', () => {
    const tokens = buildTitleTokens('Rak Wastafel Dapur dengan Pintu (Not linked to Shopify)');
    assert.ok(tokens.includes('rak'));
    assert.ok(tokens.includes('wastafel'));
    assert.ok(tokens.includes('dapur'));
    assert.ok(tokens.includes('dengan'));
    assert.ok(tokens.includes('pintu'));
  });

  // ──────── classifyProductEvidence ────────

  test('订单标题与访客路径高度一致时返回 strong', () => {
    const evidence = classifyProductEvidence(
      ['Rak Wastafel Dapur dengan Pintu (Not linked to Shopify)'],
      '/products/rak-wastafel-dapur'
    );
    assert.equal(evidence.level, 'strong');
    assert.ok(evidence.overlapRatio >= 0.75);
    assert.ok(evidence.overlapCount >= 2);
  });

  test('订单标题只部分相似时返回 weak', () => {
    const evidence = classifyProductEvidence(
      ['Rak Stainless Multifungsi Dapur'],
      '/products/rak-wastafel-dapur'
    );
    assert.equal(evidence.level, 'weak');
    assert.ok(evidence.overlapRatio >= 0.50);
    assert.ok(evidence.overlapCount >= 2);
  });

  test('完全不相关的标题返回 none', () => {
    const evidence = classifyProductEvidence(
      ['Hanger Baju Premium Stainless'],
      '/products/rak-wastafel-dapur'
    );
    assert.equal(evidence.level, 'none');
  });

  test('空标题列表返回 none', () => {
    const evidence = classifyProductEvidence([], '/products/rak-wastafel-dapur');
    assert.equal(evidence.level, 'none');
    assert.equal(evidence.details, 'order_no_titles');
  });

  test('空访客路径返回 none', () => {
    const evidence = classifyProductEvidence(
      ['Rak Wastafel Dapur'],
      ''
    );
    assert.equal(evidence.level, 'none');
    assert.equal(evidence.details, 'visitor_no_product');
  });

  test('多个标题取最佳匹配', () => {
    const evidence = classifyProductEvidence(
      [
        'Hanger Baju Premium Stainless',
        'Rak Wastafel Dapur dengan Pintu',
      ],
      '/products/rak-wastafel-dapur'
    );
    assert.equal(evidence.level, 'strong');
  });
});
