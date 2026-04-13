const test = require('node:test');
const assert = require('node:assert/strict');

const { createTestContext } = require('./helpers/test-context');

function insertVisitorAndOrder(context, shopifyOrderId) {
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
      shopifyOrderId,
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

  return context.db
    .prepare('SELECT * FROM orders WHERE shopify_order_id = ? LIMIT 1')
    .get(shopifyOrderId);
}

function readCallbacks(context, shopifyOrderId) {
  return context.db
    .prepare(
      `
        SELECT attempt_number, status, trace_id
        FROM callbacks
        WHERE shopify_order_id = ?
        ORDER BY attempt_number ASC
      `
    )
    .all(shopifyOrderId);
}

function readOrderStatus(context, shopifyOrderId) {
  return context.db
    .prepare(
      `
        SELECT status, status_reason, last_trace_id
        FROM orders
        WHERE shopify_order_id = ?
        LIMIT 1
      `
    )
    .get(shopifyOrderId);
}

test('callback dispatcher 内部模块会记录 attempt 并在成功后停止重试', async () => {
  const context = createTestContext();

  try {
    const { dispatchCallback } = context.requireServer('modules/match/callback-dispatcher');
    const savedCallbacks = [];
    const logs = [];
    let callCount = 0;
    let nextAttempt = 0;

    const result = await dispatchCallback({
      order: {
        id: 1,
        shopify_order_id: 'dispatch_direct_001',
      },
      platform: 'TikTok',
      clickId: 'ttclid-direct',
      triggerSource: 'manual_retry',
      traceId: 'trace-dispatch-direct',
      env: {
        callbackMaxAttempts: 2,
        callbackRetryDelayMs: 0,
      },
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
      callbackContext: {
        traceId: 'trace-dispatch-direct',
      },
      getNextAttemptNumber: () => {
        nextAttempt += 1;
        return nextAttempt;
      },
      saveCallback: (order, callbackResult, triggerSource, traceId) => {
        savedCallbacks.push({
          orderId: order.shopify_order_id,
          status: callbackResult.status,
          attemptNumber: callbackResult.attemptNumber,
          triggerSource,
          traceId,
        });
      },
      logInfoFn: (message, details) => {
        logs.push({ level: 'info', message, details });
      },
      logWarnFn: (message, details) => {
        logs.push({ level: 'warn', message, details });
      },
      withTraceIdFn: (traceId, details) => ({
        traceId,
        ...details,
      }),
      sleepFn: async () => {},
    });

    assert.equal(result.status, 'success');
    assert.equal(result.attemptNumber, 2);
    assert.equal(callCount, 2);
    assert.deepEqual(
      savedCallbacks.map((item) => item.status),
      ['failed', 'success']
    );
    assert.deepEqual(
      savedCallbacks.map((item) => item.attemptNumber),
      [1, 2]
    );
    assert.ok(
      logs.some((item) => item.level === 'info' && item.message === 'callback.sent')
    );
  } finally {
    context.cleanup();
  }
});

test('matchOrder 在可重试失败后会再次尝试并记录每次回传', async () => {
  const context = createTestContext({
    CALLBACK_MAX_ATTEMPTS: 2,
    CALLBACK_RETRY_DELAY_MS: 0,
  });

  try {
    const { matchOrder } = context.requireServer('modules/match');
    const order = insertVisitorAndOrder(context, 'order_retry_001');

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

    const callbacks = readCallbacks(context, 'order_retry_001');

    assert.equal(callbacks.length, 2);
    assert.deepEqual(
      callbacks.map((item) => item.status),
      ['failed', 'success']
    );
    assert.ok(callbacks.every((item) => item.trace_id === 'trace-retry-test'));

    const orderAfter = readOrderStatus(context, 'order_retry_001');

    assert.equal(orderAfter.status, 'callback_sent');
    assert.equal(orderAfter.last_trace_id, 'trace-retry-test');
    assert.match(orderAfter.status_reason, /matched_platform=tiktok/);
    assert.match(orderAfter.status_reason, /callback=success/);
    assert.match(orderAfter.status_reason, /attempt=2/);
  } finally {
    context.cleanup();
  }
});

test('callback skipped 时订单会稳定落到 matched_no_callback', async () => {
  const context = createTestContext({
    CALLBACK_MAX_ATTEMPTS: 2,
    CALLBACK_RETRY_DELAY_MS: 0,
  });

  try {
    const { matchOrder } = context.requireServer('modules/match');
    const order = insertVisitorAndOrder(context, 'order_retry_skipped_001');

    const result = await matchOrder(order, {
      triggerSource: 'manual_retry',
      traceId: 'trace-retry-skipped',
      senders: {
        TikTok: async () => ({
          platform: 'TikTok',
          status: 'skipped',
          retryable: false,
          httpStatus: 204,
          failureCode: 'callback_disabled',
          errorMessage: 'callback disabled for this shop',
          requestSummary: 'attempt-1',
          responseSummary: 'skipped',
        }),
      },
    });

    assert.equal(result.matched, true);
    assert.equal(result.callbackStatus, 'skipped');
    assert.equal(result.attemptsUsed, 1);

    const callbacks = readCallbacks(context, 'order_retry_skipped_001');
    assert.equal(callbacks.length, 1);
    assert.deepEqual(
      callbacks.map((item) => item.status),
      ['skipped']
    );

    const orderAfter = readOrderStatus(context, 'order_retry_skipped_001');
    assert.equal(orderAfter.status, 'matched_no_callback');
    assert.equal(orderAfter.last_trace_id, 'trace-retry-skipped');
    assert.match(orderAfter.status_reason, /callback=skipped/);
    assert.match(orderAfter.status_reason, /attempt=1/);
    assert.match(orderAfter.status_reason, /failure_code=callback_disabled/);
    assert.match(orderAfter.status_reason, /error=callback disabled for this shop/);
  } finally {
    context.cleanup();
  }
});

test('callback 最终失败时订单会稳定落到 callback_failed', async () => {
  const context = createTestContext({
    CALLBACK_MAX_ATTEMPTS: 2,
    CALLBACK_RETRY_DELAY_MS: 0,
  });

  try {
    const { matchOrder } = context.requireServer('modules/match');
    const order = insertVisitorAndOrder(context, 'order_retry_failed_001');
    let callCount = 0;

    const result = await matchOrder(order, {
      triggerSource: 'manual_retry',
      traceId: 'trace-retry-failed',
      senders: {
        TikTok: async () => {
          callCount += 1;

          return {
            platform: 'TikTok',
            status: 'failed',
            retryable: callCount === 1,
            httpStatus: 500,
            failureCode: 'http_500',
            errorMessage: `upstream error ${callCount}`,
            requestSummary: `attempt-${callCount}`,
            responseSummary: 'server error',
          };
        },
      },
    });

    assert.equal(result.matched, true);
    assert.equal(result.callbackStatus, 'failed');
    assert.equal(result.attemptsUsed, 2);

    const callbacks = readCallbacks(context, 'order_retry_failed_001');
    assert.equal(callbacks.length, 2);
    assert.deepEqual(
      callbacks.map((item) => item.status),
      ['failed', 'failed']
    );
    assert.ok(callbacks.every((item) => item.trace_id === 'trace-retry-failed'));

    const orderAfter = readOrderStatus(context, 'order_retry_failed_001');
    assert.equal(orderAfter.status, 'callback_failed');
    assert.equal(orderAfter.last_trace_id, 'trace-retry-failed');
    assert.match(orderAfter.status_reason, /callback=failed/);
    assert.match(orderAfter.status_reason, /attempt=2/);
    assert.match(orderAfter.status_reason, /failure_code=http_500/);
    assert.match(orderAfter.status_reason, /http_status=500/);
    assert.match(orderAfter.status_reason, /error=upstream error 2/);
  } finally {
    context.cleanup();
  }
});
