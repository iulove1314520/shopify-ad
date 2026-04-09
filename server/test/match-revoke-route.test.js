const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { createTestContext } = require('./helpers/test-context');

describe('match-revoke-route', () => {
  test('人工撤销后会把 active 置为 0 并写入 released_at / released_reason', () => {
    const context = createTestContext();
    try {
      const db = context.db;
      const { revokeOrderMatch } = context.requireServer('modules/order');

      // Insert visitor + order + match
      db.prepare(`
        INSERT INTO visitors (ttclid, fbclid, ip, timestamp, product_id, user_agent)
        VALUES ('ttclid_revoke_001', '', '198.51.100.30', '2026-04-01T01:00:00.000Z', '/products/demo', 'ua')
      `).run();

      db.prepare(`
        INSERT INTO orders (shopify_order_id, created_at, total_price, currency, zip, financial_status, raw_payload, status)
        VALUES ('SO-REV-1', '2026-04-01T02:00:00.000Z', 100, 'IDR', '', 'paid', '{}', 'callback_sent')
      `).run();

      db.prepare(`
        INSERT INTO matches (
          order_id, visitor_id, shopify_order_id, click_id, platform, confidence,
          match_score, match_signals, match_time, time_diff_seconds,
          active, match_mode, lead_score_gap, decision_summary
        ) VALUES (1, 1, 'SO-REV-1', 'ttclid_revoke_001', 'TikTok', '高', 90, 'product,strong', '2026-04-01T02:00:00.000Z', 300, 1, 'main', 20, 'test')
      `).run();

      // Mock req/res
      const req = {
        params: { orderId: 'SO-REV-1' },
        headers: { 'x-trace-id': 'trace-revoke-001' },
        body: { reason: '确认误匹配' },
      };
      let responseStatus = null;
      let responseBody = null;
      const res = {
        status(code) { responseStatus = code; return this; },
        json(data) { responseBody = data; },
      };
      const next = (err) => { if (err) throw err; };

      revokeOrderMatch(req, res, next);

      // Verify response
      assert.equal(responseBody.ok, true, 'Response should indicate success');

      // Verify match was deactivated
      const match = db.prepare('SELECT * FROM matches WHERE order_id = 1').get();
      assert.equal(match.active, 0, 'Match should be deactivated');
      assert.ok(match.released_at, 'released_at should be set');
      assert.ok(match.released_reason.includes('确认误匹配'), 'released_reason should contain the provided reason');

      // Verify order status changed
      const order = db.prepare('SELECT * FROM orders WHERE id = 1').get();
      assert.equal(order.status, 'matched_revoked', 'Order status should be matched_revoked');
    } finally {
      context.cleanup();
    }
  });

  test('撤销不存在的订单返回 404', () => {
    const context = createTestContext();
    try {
      const { revokeOrderMatch } = context.requireServer('modules/order');

      const req = {
        params: { orderId: 'SO-NONEXIST' },
        headers: {},
        body: {},
      };
      let responseStatus = null;
      let responseBody = null;
      const res = {
        status(code) { responseStatus = code; return this; },
        json(data) { responseBody = data; },
      };
      const next = (err) => { if (err) throw err; };

      revokeOrderMatch(req, res, next);

      assert.equal(responseStatus, 404, 'Should return 404 for non-existent order');
    } finally {
      context.cleanup();
    }
  });

  test('没有活跃匹配记录时返回 409', () => {
    const context = createTestContext();
    try {
      const db = context.db;
      const { revokeOrderMatch } = context.requireServer('modules/order');

      // Insert order without any match
      db.prepare(`
        INSERT INTO orders (shopify_order_id, created_at, total_price, currency, zip, financial_status, raw_payload, status)
        VALUES ('SO-NOMATCH', '2026-04-01T02:00:00.000Z', 100, 'IDR', '', 'paid', '{}', 'unmatched')
      `).run();

      const req = {
        params: { orderId: 'SO-NOMATCH' },
        headers: {},
        body: {},
      };
      let responseStatus = null;
      let responseBody = null;
      const res = {
        status(code) { responseStatus = code; return this; },
        json(data) { responseBody = data; },
      };
      const next = (err) => { if (err) throw err; };

      revokeOrderMatch(req, res, next);

      assert.equal(responseStatus, 409, 'Should return 409 when no active match exists');
    } finally {
      context.cleanup();
    }
  });
});
