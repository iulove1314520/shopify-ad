const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { createTestContext } = require('./helpers/test-context');

describe('match-allocation', () => {
  test('同一条访客记录在 active=1 时不能匹配第二个订单', () => {
    const context = createTestContext();
    try {
      const db = context.db;

      // Insert a visitor
      db.prepare(`
        INSERT INTO visitors (ttclid, fbclid, ip, timestamp, product_id, user_agent)
        VALUES ('ttclid_lock_001', '', '198.51.100.24', '2026-04-01T01:00:00.000Z', '/products/demo-shelf', 'ua')
      `).run();

      // Insert first order
      db.prepare(`
        INSERT INTO orders (shopify_order_id, created_at, total_price, currency, zip, financial_status, raw_payload, status)
        VALUES ('SO-1', '2026-04-01T02:00:00.000Z', 100, 'IDR', '', 'paid', '{}', 'received')
      `).run();

      // Insert second order
      db.prepare(`
        INSERT INTO orders (shopify_order_id, created_at, total_price, currency, zip, financial_status, raw_payload, status)
        VALUES ('SO-2', '2026-04-01T03:00:00.000Z', 200, 'IDR', '', 'paid', '{}', 'received')
      `).run();

      // Insert first match - active=1, occupying visitor_id=1
      db.prepare(`
        INSERT INTO matches (
          order_id, visitor_id, shopify_order_id, click_id, platform, confidence,
          match_score, match_signals, match_time, time_diff_seconds,
          active, match_mode, lead_score_gap, decision_summary
        ) VALUES (1, 1, 'SO-1', 'ttclid_lock_001', 'TikTok', '高', 90, 'product,strong', '2026-04-01T02:00:00.000Z', 300, 1, 'main', 20, 'test')
      `).run();

      // Verify the active lock exists
      const locked = db.prepare('SELECT visitor_id FROM matches WHERE active = 1').all();
      assert.equal(locked.length, 1);

      // Attempting to insert a second active match for the same visitor should fail
      // due to the partial unique index on visitor_id WHERE active = 1
      assert.throws(
        () => {
          db.prepare(`
            INSERT INTO matches (
              order_id, visitor_id, shopify_order_id, click_id, platform, confidence,
              match_score, match_signals, match_time, time_diff_seconds,
              active, match_mode, lead_score_gap, decision_summary
            ) VALUES (2, 1, 'SO-2', 'ttclid_lock_001', 'TikTok', '中', 60, 'time_close', '2026-04-01T03:00:00.000Z', 600, 1, 'main', 10, 'test2')
          `).run();
        },
        (err) => {
          assert.ok(err.message.includes('UNIQUE constraint failed'), `Expected UNIQUE constraint error, got: ${err.message}`);
          return true;
        }
      );
    } finally {
      context.cleanup();
    }
  });

  test('active=0 时同一访客可以被另一个订单重新匹配', () => {
    const context = createTestContext();
    try {
      const db = context.db;

      // Insert visitor & orders
      db.prepare(`
        INSERT INTO visitors (ttclid, fbclid, ip, timestamp, product_id, user_agent)
        VALUES ('ttclid_reuse_001', '', '198.51.100.25', '2026-04-01T01:00:00.000Z', '/products/demo-shelf', 'ua')
      `).run();

      db.prepare(`
        INSERT INTO orders (shopify_order_id, created_at, total_price, currency, zip, financial_status, raw_payload, status)
        VALUES ('SO-R1', '2026-04-01T02:00:00.000Z', 100, 'IDR', '', 'paid', '{}', 'received')
      `).run();

      db.prepare(`
        INSERT INTO orders (shopify_order_id, created_at, total_price, currency, zip, financial_status, raw_payload, status)
        VALUES ('SO-R2', '2026-04-01T03:00:00.000Z', 200, 'IDR', '', 'paid', '{}', 'received')
      `).run();

      // Insert first match as released (active=0)
      db.prepare(`
        INSERT INTO matches (
          order_id, visitor_id, shopify_order_id, click_id, platform, confidence,
          match_score, match_signals, match_time, time_diff_seconds,
          active, released_at, released_reason, match_mode, lead_score_gap, decision_summary
        ) VALUES (1, 1, 'SO-R1', 'ttclid_reuse_001', 'TikTok', '高', 90, 'product,strong', '2026-04-01T02:00:00.000Z', 300, 0, '2026-04-01T04:00:00.000Z', 'manual_revoke', 'main', 20, 'test')
      `).run();

      // Now the same visitor should be insertable with active=1 for another order
      assert.doesNotThrow(() => {
        db.prepare(`
          INSERT INTO matches (
            order_id, visitor_id, shopify_order_id, click_id, platform, confidence,
            match_score, match_signals, match_time, time_diff_seconds,
            active, match_mode, lead_score_gap, decision_summary
          ) VALUES (2, 1, 'SO-R2', 'ttclid_reuse_001', 'TikTok', '中', 60, 'time_close', '2026-04-01T03:00:00.000Z', 600, 1, 'main', 10, 'test2')
        `).run();
      });
    } finally {
      context.cleanup();
    }
  });

  test('matches 表包含 active、released_at、released_reason、match_mode、lead_score_gap、decision_summary 字段', () => {
    const context = createTestContext();
    try {
      const db = context.db;
      const columns = db.prepare('PRAGMA table_info(matches)').all();
      const columnNames = columns.map((c) => c.name);

      assert.ok(columnNames.includes('active'), 'Missing column: active');
      assert.ok(columnNames.includes('released_at'), 'Missing column: released_at');
      assert.ok(columnNames.includes('released_reason'), 'Missing column: released_reason');
      assert.ok(columnNames.includes('match_mode'), 'Missing column: match_mode');
      assert.ok(columnNames.includes('lead_score_gap'), 'Missing column: lead_score_gap');
      assert.ok(columnNames.includes('decision_summary'), 'Missing column: decision_summary');
    } finally {
      context.cleanup();
    }
  });
});
