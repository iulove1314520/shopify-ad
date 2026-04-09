const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { createTestContext } = require('./helpers/test-context');

describe('match-main-path', () => {
  test('主路径成功时会写入 match_mode、lead_score_gap 和 decision_summary', async () => {
    const context = createTestContext({
      MATCH_WINDOW_DAYS: 1,
      CALLBACK_MAX_ATTEMPTS: 1,
    });
    try {
      const db = context.db;

      // Insert visitor with strong product match
      db.prepare(`
        INSERT INTO visitors (ttclid, fbclid, ip, timestamp, product_id, user_agent)
        VALUES ('ttclid_main_001', '', '198.51.100.30', '2026-04-01T01:00:00.000Z', '/products/rak-wastafel-dapur', 'ua')
      `).run();

      // Insert order with matching product title
      const rawPayload = JSON.stringify({
        id: 'SO-MAIN-1',
        created_at: '2026-04-01T01:30:00.000Z',
        total_price: 100,
        currency: 'IDR',
        financial_status: 'paid',
        browser_ip: '198.51.100.30',
        line_items: [{ title: 'Rak Wastafel Dapur dengan Pintu' }],
        shipping_address: { city: 'Bekasi', country_code: 'ID' },
      });

      db.prepare(`
        INSERT INTO orders (shopify_order_id, created_at, total_price, currency, zip, financial_status, raw_payload, status)
        VALUES ('SO-MAIN-1', '2026-04-01T01:30:00.000Z', 100, 'IDR', '', 'paid', ?, 'received')
      `).run(rawPayload);

      const order = db.prepare('SELECT * FROM orders WHERE shopify_order_id = ?').get('SO-MAIN-1');

      const { matchOrder } = context.requireServer('modules/match');

      // Use a mock sender that always succeeds
      const result = await matchOrder(order, {
        triggerSource: 'test',
        traceId: 'trace-main-001',
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

      assert.equal(result.matched, true, 'Should match');

      // Verify match record
      const match = db.prepare('SELECT * FROM matches WHERE order_id = ?').get(order.id);
      assert.ok(match, 'Match record should exist');
      assert.equal(match.active, 1, 'Match should be active');
      assert.equal(match.match_mode, 'main', 'Should use main path');
      assert.ok(match.lead_score_gap > 0, 'lead_score_gap should be > 0');
      assert.ok(match.decision_summary.includes('mode=main'), 'decision_summary should include mode=main');
      assert.ok(match.decision_summary.includes('product=strong'), 'decision_summary should include product=strong');
    } finally {
      context.cleanup();
    }
  });

  test('未匹配时 status_reason 会记录主原因 + 关键摘要', async () => {
    const context = createTestContext({
      MATCH_WINDOW_DAYS: 1,
      CALLBACK_MAX_ATTEMPTS: 1,
    });
    try {
      const db = context.db;

      // Insert order with no matching visitors
      const rawPayload = JSON.stringify({
        id: 'SO-NOMATCH-1',
        created_at: '2026-04-01T01:30:00.000Z',
        total_price: 100,
        currency: 'IDR',
        financial_status: 'paid',
        line_items: [{ title: 'Some Product' }],
      });

      db.prepare(`
        INSERT INTO orders (shopify_order_id, created_at, total_price, currency, zip, financial_status, raw_payload, status)
        VALUES ('SO-NOMATCH-1', '2026-04-01T01:30:00.000Z', 100, 'IDR', '', 'paid', ?, 'received')
      `).run(rawPayload);

      const order = db.prepare('SELECT * FROM orders WHERE shopify_order_id = ?').get('SO-NOMATCH-1');

      const { matchOrder } = context.requireServer('modules/match');
      const result = await matchOrder(order, {
        triggerSource: 'test',
        traceId: 'trace-nomatch-001',
        senders: {
          TikTok: async () => ({ platform: 'TikTok', status: 'success', retryable: false }),
        },
      });

      assert.equal(result.matched, false, 'Should not match');

      const updatedOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
      assert.equal(updatedOrder.status, 'unmatched', 'Order status should be unmatched');
      assert.ok(updatedOrder.status_reason.includes('reason='), 'status_reason should include reason=');
    } finally {
      context.cleanup();
    }
  });

  test('已被占用的访客不会出现在候选中', async () => {
    const context = createTestContext({
      MATCH_WINDOW_DAYS: 1,
      CALLBACK_MAX_ATTEMPTS: 1,
    });
    try {
      const db = context.db;

      // Insert a visitor
      db.prepare(`
        INSERT INTO visitors (ttclid, fbclid, ip, timestamp, product_id, user_agent)
        VALUES ('ttclid_occ_001', '', '10.0.0.1', '2026-04-01T01:00:00.000Z', '/products/rak-wastafel-dapur', 'ua')
      `).run();

      // Insert first order and match
      db.prepare(`
        INSERT INTO orders (shopify_order_id, created_at, total_price, currency, zip, financial_status, raw_payload, status)
        VALUES ('SO-OCC-1', '2026-04-01T01:30:00.000Z', 100, 'IDR', '', 'paid', '{}', 'callback_sent')
      `).run();

      db.prepare(`
        INSERT INTO matches (
          order_id, visitor_id, shopify_order_id, click_id, platform, confidence,
          match_score, match_signals, match_time, time_diff_seconds,
          active, match_mode, lead_score_gap, decision_summary
        ) VALUES (1, 1, 'SO-OCC-1', 'ttclid_occ_001', 'TikTok', '高', 90, 'product_strong', '2026-04-01T01:30:00.000Z', 1800, 1, 'main', 90, 'test')
      `).run();

      // Insert second order
      const rawPayload2 = JSON.stringify({
        id: 'SO-OCC-2',
        created_at: '2026-04-01T02:00:00.000Z',
        total_price: 200,
        currency: 'IDR',
        financial_status: 'paid',
        line_items: [{ title: 'Rak Wastafel Dapur' }],
      });

      db.prepare(`
        INSERT INTO orders (shopify_order_id, created_at, total_price, currency, zip, financial_status, raw_payload, status)
        VALUES ('SO-OCC-2', '2026-04-01T02:00:00.000Z', 200, 'IDR', '', 'paid', ?, 'received')
      `).run(rawPayload2);

      const order2 = db.prepare('SELECT * FROM orders WHERE shopify_order_id = ?').get('SO-OCC-2');

      const { matchOrder } = context.requireServer('modules/match');
      const result = await matchOrder(order2, {
        triggerSource: 'test',
        traceId: 'trace-occ-001',
        senders: {
          TikTok: async () => ({ platform: 'TikTok', status: 'success', retryable: false }),
        },
      });

      assert.equal(result.matched, false, 'Should not match because the only visitor is occupied');
    } finally {
      context.cleanup();
    }
  });
});
