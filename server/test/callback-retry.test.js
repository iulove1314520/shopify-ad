const test = require('node:test');
const assert = require('node:assert/strict');

const { createTestContext } = require('./helpers/test-context');

test('matchOrder 在可重试失败后会再次尝试并记录每次回传', async () => {
  const context = createTestContext({
    CALLBACK_MAX_ATTEMPTS: 2,
    CALLBACK_RETRY_DELAY_MS: 0,
  });

  try {
    const { matchOrder } = context.requireServer('modules/match');

    context.db
      .prepare(
        `
          INSERT INTO visitors (ttclid, fbclid, ip, timestamp, product_id, user_agent)
          VALUES (?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        'ttclid_retry_demo',
        '',
        '198.51.100.24',
        '2026-03-28T01:20:00.000Z',
        '/products/demo-shirt',
        'retry-test'
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
            last_trace_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        'order_retry_001',
        '2026-03-28T01:40:00.000Z',
        199,
        'USD',
        '',
        'paid',
        JSON.stringify({
          line_items: [
            {
              product_id: 'demo-shirt',
              title: 'Demo Shirt',
            },
          ],
          client_details: {
            browser_ip: '198.51.100.24',
          },
        }),
        'received',
        ''
      );

    const order = context.db
      .prepare('SELECT * FROM orders WHERE shopify_order_id = ? LIMIT 1')
      .get('order_retry_001');

    let callCount = 0;
    const result = await matchOrder(order, {
      triggerSource: 'manual_retry',
      traceId: 'trace-retry-test',
      senders: {
        TikTok: async () => {
          callCount += 1;

          if (callCount === 1) {
            return {
              platform: 'TikTok',
              status: 'failed',
              retryable: true,
              httpStatus: 500,
              failureCode: 'http_500',
              errorMessage: 'temporary upstream issue',
              requestSummary: 'attempt-1',
              responseSummary: 'server error',
            };
          }

          return {
            platform: 'TikTok',
            status: 'success',
            retryable: false,
            httpStatus: 200,
            failureCode: '',
            errorMessage: '',
            requestSummary: 'attempt-2',
            responseSummary: 'ok',
          };
        },
      },
    });

    assert.equal(result.matched, true);
    assert.equal(result.callbackStatus, 'success');
    assert.equal(result.attemptsUsed, 2);

    const callbacks = context.db
      .prepare(
        `
          SELECT attempt_number, status, trace_id
          FROM callbacks
          WHERE shopify_order_id = ?
          ORDER BY attempt_number ASC
        `
      )
      .all('order_retry_001');

    assert.equal(callbacks.length, 2);
    assert.deepEqual(
      callbacks.map((item) => item.status),
      ['failed', 'success']
    );
    assert.ok(callbacks.every((item) => item.trace_id === 'trace-retry-test'));

    const orderAfter = context.db
      .prepare(
        `
          SELECT status, last_trace_id
          FROM orders
          WHERE shopify_order_id = ?
          LIMIT 1
        `
      )
      .get('order_retry_001');

    assert.equal(orderAfter.status, 'callback_sent');
    assert.equal(orderAfter.last_trace_id, 'trace-retry-test');
  } finally {
    context.cleanup();
  }
});
