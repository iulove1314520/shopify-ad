const test = require('node:test');
const assert = require('node:assert/strict');

const { createTestContext } = require('./helpers/test-context');

function daysAgoIso(daysAgo) {
  return new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
}

test('cleanupOldDataRecords 会删除超出保留期的旧数据并保留近期记录', () => {
  const context = createTestContext({
    VISITOR_RETENTION_DAYS: 7,
    BUSINESS_DATA_RETENTION_DAYS: 30,
  });

  try {
    const { cleanupOldDataRecords } = context.requireServer('modules/system');

    const oldVisitor = context.db
      .prepare(
        `
          INSERT INTO visitors (ttclid, fbclid, ip, timestamp, product_id, user_agent)
          VALUES (?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        'ttclid_old_cleanup',
        '',
        '198.51.100.30',
        daysAgoIso(10),
        '/products/legacy',
        'cleanup-test-old'
      );

    context.db
      .prepare(
        `
          INSERT INTO visitors (ttclid, fbclid, ip, timestamp, product_id, user_agent)
          VALUES (?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        'ttclid_recent_cleanup',
        '',
        '198.51.100.31',
        daysAgoIso(2),
        '/products/recent',
        'cleanup-test-recent'
      );

    const oldOrder = context.db
      .prepare(
        `
          INSERT INTO orders (
            shopify_order_id,
            created_at,
            total_price,
            currency,
            zip,
            financial_status,
            raw_payload,
            status,
            status_reason,
            last_trace_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        'order_cleanup_old',
        daysAgoIso(45),
        88,
        'USD',
        '',
        'paid',
        JSON.stringify({ source: 'cleanup-old' }),
        'callback_failed',
        'error=old',
        'trace-old'
      );

    context.db
      .prepare(
        `
          INSERT INTO orders (
            shopify_order_id,
            created_at,
            total_price,
            currency,
            zip,
            financial_status,
            raw_payload,
            status,
            status_reason,
            last_trace_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        'order_cleanup_recent',
        daysAgoIso(2),
        99,
        'USD',
        '',
        'paid',
        JSON.stringify({ source: 'cleanup-recent' }),
        'callback_sent',
        '',
        'trace-recent'
      );

    context.db
      .prepare(
        `
          INSERT INTO matches (
            order_id,
            visitor_id,
            shopify_order_id,
            click_id,
            platform,
            confidence,
            match_score,
            match_signals,
            match_time,
            time_diff_seconds
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        oldOrder.lastInsertRowid,
        oldVisitor.lastInsertRowid,
        'order_cleanup_old',
        'ttclid_old_cleanup',
        'TikTok',
        '中',
        76,
        'time_close,product_match',
        daysAgoIso(45),
        120
      );

    context.db
      .prepare(
        `
          INSERT INTO callbacks (
            order_id,
            shopify_order_id,
            platform,
            trigger_source,
            trace_id,
            attempt_number,
            status,
            retryable,
            http_status,
            request_summary,
            response_summary,
            error_message,
            callback_time
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        oldOrder.lastInsertRowid,
        'order_cleanup_old',
        'TikTok',
        'webhook',
        'trace-old',
        1,
        'failed',
        0,
        400,
        'old request',
        'old response',
        'old callback error',
        daysAgoIso(45)
      );

    context.db
      .prepare(
        `
          INSERT INTO webhook_events (
            webhook_id,
            topic,
            shopify_order_id,
            trace_id,
            signature_valid,
            status,
            error_message,
            received_at,
            processed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        'webhook-old-cleanup',
        'orders/paid',
        'order_cleanup_old',
        'trace-old',
        1,
        'processed',
        '',
        daysAgoIso(45),
        daysAgoIso(45)
      );

    context.db
      .prepare(
        `
          INSERT INTO webhook_events (
            webhook_id,
            topic,
            shopify_order_id,
            trace_id,
            signature_valid,
            status,
            error_message,
            received_at,
            processed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        'webhook-recent-cleanup',
        'orders/paid',
        'order_cleanup_recent',
        'trace-recent',
        1,
        'processed',
        '',
        daysAgoIso(2),
        daysAgoIso(2)
      );

    const result = cleanupOldDataRecords();

    assert.deepEqual(result.retention_policy, {
      visitors_days: 7,
      business_days: 30,
    });
    assert.deepEqual(result.deleted, {
      visitors: 1,
      orders: 1,
      matches: 1,
      callbacks: 1,
      webhook_events: 1,
    });

    assert.equal(
      context.db.prepare('SELECT COUNT(*) AS count FROM visitors').get().count,
      1
    );
    assert.equal(
      context.db.prepare('SELECT COUNT(*) AS count FROM orders').get().count,
      1
    );
    assert.equal(
      context.db.prepare('SELECT COUNT(*) AS count FROM matches').get().count,
      0
    );
    assert.equal(
      context.db.prepare('SELECT COUNT(*) AS count FROM callbacks').get().count,
      0
    );
    assert.equal(
      context.db.prepare('SELECT COUNT(*) AS count FROM webhook_events').get().count,
      1
    );

    const remainingOrder = context.db
      .prepare(
        `
          SELECT shopify_order_id
          FROM orders
          LIMIT 1
        `
      )
      .get();
    const remainingVisitor = context.db
      .prepare(
        `
          SELECT ttclid
          FROM visitors
          LIMIT 1
        `
      )
      .get();
    const remainingWebhook = context.db
      .prepare(
        `
          SELECT webhook_id
          FROM webhook_events
          LIMIT 1
        `
      )
      .get();

    assert.equal(remainingOrder.shopify_order_id, 'order_cleanup_recent');
    assert.equal(remainingVisitor.ttclid, 'ttclid_recent_cleanup');
    assert.equal(remainingWebhook.webhook_id, 'webhook-recent-cleanup');
  } finally {
    context.cleanup();
  }
});
