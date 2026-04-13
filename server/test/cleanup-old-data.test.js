const test = require('node:test');
const assert = require('node:assert/strict');

const { createTestContext } = require('./helpers/test-context');

function daysAgoIso(daysAgo) {
  return new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
}

test('cleanup 内部模块支持显式依赖注入并返回删除摘要', () => {
  const context = createTestContext({
    VISITOR_RETENTION_DAYS: 7,
    BUSINESS_DATA_RETENTION_DAYS: 30,
  });

  try {
    const { env } = context.requireServer('config/env');
    const { cleanupOldDataRecords } = context.requireServer('modules/system/cleanup');

    context.db
      .prepare(
        `
          INSERT INTO visitors (ttclid, fbclid, ip, timestamp, product_id, user_agent)
          VALUES (?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        'ttclid_cleanup_internal_old',
        '',
        '198.51.100.10',
        daysAgoIso(10),
        '/products/internal-cleanup',
        'cleanup-internal'
      );

    const result = cleanupOldDataRecords({
      db: context.db,
      env,
      options: {
        visitorRetentionDays: 7,
        businessRetentionDays: 30,
      },
    });

    assert.equal(result.deleted.visitors, 1);
    assert.equal(result.deleted.orders, 0);
    assert.equal(result.deleted.matches, 0);
    assert.equal(result.deleted.callbacks, 0);
    assert.equal(result.deleted.webhook_events, 0);
  } finally {
    context.cleanup();
  }
});

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

test('cleanupOldDataRecords 支持按本次选择的自定义天数清理', () => {
  const context = createTestContext({
    VISITOR_RETENTION_DAYS: 7,
    BUSINESS_DATA_RETENTION_DAYS: 30,
  });

  try {
    const { cleanupOldDataRecords } = context.requireServer('modules/system');

    context.db
      .prepare(
        `
          INSERT INTO visitors (ttclid, fbclid, ip, timestamp, product_id, user_agent)
          VALUES (?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        'ttclid_custom_old',
        '',
        '198.51.100.41',
        daysAgoIso(4),
        '/products/custom-old',
        'cleanup-custom-old'
      );

    context.db
      .prepare(
        `
          INSERT INTO visitors (ttclid, fbclid, ip, timestamp, product_id, user_agent)
          VALUES (?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        'ttclid_custom_recent',
        '',
        '198.51.100.42',
        daysAgoIso(2),
        '/products/custom-recent',
        'cleanup-custom-recent'
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
        'order_custom_old',
        daysAgoIso(12),
        66,
        'USD',
        '',
        'paid',
        JSON.stringify({ source: 'custom-old' }),
        'received',
        '',
        'trace-custom-old'
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
        'order_custom_recent',
        daysAgoIso(5),
        77,
        'USD',
        '',
        'paid',
        JSON.stringify({ source: 'custom-recent' }),
        'received',
        '',
        'trace-custom-recent'
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
        'webhook-custom-old',
        'orders/paid',
        'order_custom_old',
        'trace-custom-old',
        1,
        'processed',
        '',
        daysAgoIso(12),
        daysAgoIso(12)
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
        'webhook-custom-recent',
        'orders/paid',
        'order_custom_recent',
        'trace-custom-recent',
        1,
        'processed',
        '',
        daysAgoIso(5),
        daysAgoIso(5)
      );

    const result = cleanupOldDataRecords({
      visitorRetentionDays: 3,
      businessRetentionDays: 10,
    });

    assert.deepEqual(result.retention_policy, {
      visitors_days: 3,
      business_days: 10,
    });
    assert.deepEqual(result.deleted, {
      visitors: 1,
      orders: 1,
      matches: 0,
      callbacks: 0,
      webhook_events: 1,
    });

    const remainingVisitor = context.db
      .prepare('SELECT ttclid FROM visitors ORDER BY id ASC')
      .all();
    const remainingOrder = context.db
      .prepare('SELECT shopify_order_id FROM orders ORDER BY id ASC')
      .all();

    assert.deepEqual(remainingVisitor, [{ ttclid: 'ttclid_custom_recent' }]);
    assert.deepEqual(remainingOrder, [{ shopify_order_id: 'order_custom_recent' }]);
  } finally {
    context.cleanup();
  }
});

test('resolveCleanupRetentionDays 会拦截非法的自定义天数', () => {
  const context = createTestContext();

  try {
    const { resolveCleanupRetentionDays } = context.requireServer('modules/system');

    assert.throws(
      () => resolveCleanupRetentionDays({ visitorRetentionDays: 0 }),
      /访客数据保留天数需为 1-3650 之间的整数天数/
    );
    assert.throws(
      () => resolveCleanupRetentionDays({ businessRetentionDays: 5000 }),
      /业务数据保留天数需为 1-3650 之间的整数天数/
    );
  } finally {
    context.cleanup();
  }
});

test('purgeAllDataRecords 会清空全部访客、订单、回传和事件数据', () => {
  const context = createTestContext();

  try {
    const { purgeAllDataRecords } = context.requireServer('modules/system');

    const visitor = context.db
      .prepare(
        `
          INSERT INTO visitors (ttclid, fbclid, ip, timestamp, product_id, user_agent)
          VALUES (?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        'ttclid_purge_demo',
        '',
        '198.51.100.51',
        daysAgoIso(1),
        '/products/purge-demo',
        'purge-test'
      );

    const order = context.db
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
        'order_purge_demo',
        daysAgoIso(1),
        109,
        'USD',
        '',
        'paid',
        JSON.stringify({ source: 'purge-demo' }),
        'callback_sent',
        '',
        'trace-purge'
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
        order.lastInsertRowid,
        visitor.lastInsertRowid,
        'order_purge_demo',
        'ttclid_purge_demo',
        'TikTok',
        '高',
        98,
        'time_close,product_match,browser_ip_exact',
        daysAgoIso(1),
        50
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
        order.lastInsertRowid,
        'order_purge_demo',
        'TikTok',
        'webhook',
        'trace-purge',
        1,
        'success',
        0,
        200,
        'purge request',
        'purge response',
        '',
        daysAgoIso(1)
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
        'webhook-purge-demo',
        'orders/paid',
        'order_purge_demo',
        'trace-purge',
        1,
        'processed',
        '',
        daysAgoIso(1),
        daysAgoIso(1)
      );

    const result = purgeAllDataRecords();

    assert.equal(result.mode, 'purge_all');
    assert.deepEqual(result.deleted, {
      visitors: 1,
      orders: 1,
      matches: 1,
      callbacks: 1,
      webhook_events: 1,
    });

    assert.equal(
      context.db.prepare('SELECT COUNT(*) AS count FROM visitors').get().count,
      0
    );
    assert.equal(
      context.db.prepare('SELECT COUNT(*) AS count FROM orders').get().count,
      0
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
      0
    );
  } finally {
    context.cleanup();
  }
});

test('assertPurgeAllConfirmation 会要求显式确认文本', () => {
  const context = createTestContext();

  try {
    const { assertPurgeAllConfirmation } = context.requireServer('modules/system');

    assert.throws(
      () => assertPurgeAllConfirmation({ confirm: true, confirmText: '全部删除' }),
      /清空全部数据前，请输入确认文本：清空全部数据/
    );

    assert.doesNotThrow(() =>
      assertPurgeAllConfirmation({ confirm: true, confirmText: '清空全部数据' })
    );
  } finally {
    context.cleanup();
  }
});
