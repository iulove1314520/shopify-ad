const test = require('node:test');
const assert = require('node:assert/strict');

const { createTestContext } = require('./helpers/test-context');

test('callbacks attempt_number 对同一 order/platform 强制唯一', () => {
  const context = createTestContext();

  try {
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
            last_trace_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        'attempt_unique_order_001',
        '2026-03-28T01:40:00.000Z',
        199,
        'USD',
        '',
        'paid',
        '{}',
        'received',
        ''
      );

    const order = context.db
      .prepare('SELECT id FROM orders WHERE shopify_order_id = ? LIMIT 1')
      .get('attempt_unique_order_001');

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
        order.id,
        'attempt_unique_order_001',
        'TikTok',
        'webhook',
        'trace-1',
        1,
        'failed',
        1,
        500,
        'r1',
        'e1',
        'e1',
        '2026-03-28T01:41:00.000Z'
      );

    assert.throws(
      () =>
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
            order.id,
            'attempt_unique_order_001',
            'TikTok',
            'webhook',
            'trace-2',
            1,
            'success',
            0,
            200,
            'r2',
            'ok',
            '',
            '2026-03-28T01:42:00.000Z'
          ),
      /UNIQUE constraint failed/
    );
  } finally {
    context.cleanup();
  }
});
