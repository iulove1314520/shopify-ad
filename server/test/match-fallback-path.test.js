const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { createTestContext } = require('./helpers/test-context');

describe('match-fallback-path', () => {
  test('降级路径通过时会标记 mode=fallback 且摘要包含相关信号', async () => {
    const context = createTestContext({
      MATCH_WINDOW_DAYS: 1,
      CALLBACK_MAX_ATTEMPTS: 1,
    });
    try {
      const db = context.db;

      // Insert visitor without strong product match
      db.prepare(`
        INSERT INTO visitors (ttclid, fbclid, ip, timestamp, product_id, user_agent)
        VALUES ('ttclid_fb_001', '', '198.51.100.40', '2026-04-01T00:30:00.000Z', '/products/some-other-product', 'ua')
      `).run();

      // Insert order - no product evidence overlap, but same browser_ip
      const rawPayload = JSON.stringify({
        id: 'SO-FB-1',
        created_at: '2026-04-01T01:00:00.000Z',
        total_price: 100,
        currency: 'IDR',
        financial_status: 'paid',
        browser_ip: '198.51.100.40',
        line_items: [{ title: 'Completely Different Product' }],
        shipping_address: { city: 'Bekasi', country_code: 'ID' },
      });

      db.prepare(`
        INSERT INTO orders (shopify_order_id, created_at, total_price, currency, zip, financial_status, raw_payload, status)
        VALUES ('SO-FB-1', '2026-04-01T01:00:00.000Z', 100, 'IDR', '', 'paid', ?, 'received')
      `).run(rawPayload);

      const order = db.prepare('SELECT * FROM orders WHERE shopify_order_id = ?').get('SO-FB-1');

      const { matchOrder } = context.requireServer('modules/match');
      const result = await matchOrder(order, {
        triggerSource: 'test',
        traceId: 'trace-fb-001',
        senders: {
          TikTok: async () => ({
            platform: 'TikTok',
            status: 'success',
            retryable: false,
            httpStatus: 200,
            requestSummary: '',
            responseSummary: '',
            errorMessage: '',
            failureCode: '',
          }),
        },
      });

      // With time_close (30) + browser_ip_exact (25) = 55, this should pass fallback
      // (score >= 35, single candidate so leadGap = score itself)
      assert.equal(result.matched, true, 'Should match via fallback path');

      const match = db.prepare('SELECT * FROM matches WHERE order_id = ?').get(order.id);
      assert.ok(match, 'Match record should exist');
      assert.equal(match.match_mode, 'fallback', 'Should use fallback path');
      assert.ok(match.decision_summary.includes('mode=fallback'), 'Summary should include fallback mode');
    } finally {
      context.cleanup();
    }
  });

  test('降级路径分差不足时拒绝匹配', async () => {
    const context = createTestContext({
      MATCH_WINDOW_DAYS: 1,
      CALLBACK_MAX_ATTEMPTS: 1,
    });
    try {
      const db = context.db;

      // Insert two visitors with similar scores (both weak product, close time)
      db.prepare(`
        INSERT INTO visitors (ttclid, fbclid, ip, timestamp, product_id, user_agent)
        VALUES ('ttclid_ambig_001', '', '10.0.0.1', '2026-04-01T00:45:00.000Z', '/products/ambig-a', 'ua')
      `).run();

      db.prepare(`
        INSERT INTO visitors (ttclid, fbclid, ip, timestamp, product_id, user_agent)
        VALUES ('ttclid_ambig_002', '', '10.0.0.2', '2026-04-01T00:40:00.000Z', '/products/ambig-b', 'ua')
      `).run();

      // Order with no overlapping product titles
      const rawPayload = JSON.stringify({
        id: 'SO-AMBIG-1',
        created_at: '2026-04-01T01:00:00.000Z',
        total_price: 100,
        currency: 'IDR',
        financial_status: 'paid',
        line_items: [{ title: 'Unrelated Item' }],
      });

      db.prepare(`
        INSERT INTO orders (shopify_order_id, created_at, total_price, currency, zip, financial_status, raw_payload, status)
        VALUES ('SO-AMBIG-1', '2026-04-01T01:00:00.000Z', 100, 'IDR', '', 'paid', ?, 'received')
      `).run(rawPayload);

      const order = db.prepare('SELECT * FROM orders WHERE shopify_order_id = ?').get('SO-AMBIG-1');

      const { matchOrder } = context.requireServer('modules/match');
      const result = await matchOrder(order, {
        triggerSource: 'test',
        traceId: 'trace-ambig-001',
        senders: {
          TikTok: async () => ({ platform: 'TikTok', status: 'success', retryable: false }),
        },
      });

      // Both have ~30 time score, no product, no IP → both ~30, gap ~0 → fallback_gap_too_small or fallback_score_too_low
      assert.equal(result.matched, false, 'Should not match with ambiguous candidates');
      assert.ok(
        ['fallback_gap_too_small', 'fallback_score_too_low'].includes(result.reasonCode),
        `Reason should be fallback rejection, got: ${result.reasonCode}`
      );
    } finally {
      context.cleanup();
    }
  });
});
