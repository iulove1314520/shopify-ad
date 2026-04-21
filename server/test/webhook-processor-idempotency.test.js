const test = require('node:test');
const assert = require('node:assert/strict');

const { createTestContext } = require('./helpers/test-context');

function createOrderPayload(orderId) {
  return {
    id: orderId,
    financial_status: 'paid',
    created_at: '2026-04-01T00:00:00.000Z',
    total_price: 100,
    currency: 'USD',
    shipping_address: {
      zip: '10001',
    },
  };
}

test('并发相同 webhook_id 时只允许一个请求进入处理流程', async () => {
  const context = createTestContext();

  try {
    const { createProcessOrderWebhook } = context.requireServer(
      'modules/order/webhook-processor'
    );
    const {
      saveWebhookEvent,
      tryStartWebhookProcessing,
    } = context.requireServer('modules/order/webhook-events');
    const { upsertOrder, updateOrderStatus } = context.requireServer(
      'modules/order/order-store'
    );
    const { resolveWebhookId } = context.requireServer('modules/order/webhook-id');

    let releaseFirst;
    const firstStarted = new Promise((resolve) => {
      releaseFirst = resolve;
    });
    let matchCallCount = 0;

    const processOrderWebhook = createProcessOrderWebhook({
      db: context.db,
      matchOrder: async () => {
        matchCallCount += 1;
        if (matchCallCount === 1) {
          await firstStarted;
        }
        return {
          matched: true,
          callbackStatus: 'success',
          attemptsUsed: 1,
        };
      },
      logInfo: () => {},
      withTraceId: (_traceId, details) => details,
      resolveWebhookId,
      tryStartWebhookProcessing,
      saveWebhookEvent,
      upsertOrder,
      updateOrderStatus,
      hasSuccessfulCallback: () => false,
    });

    const order = createOrderPayload('ORDER-IDEMP-1');
    const headers = {
      'x-shopify-webhook-id': 'webhook-idempotent-001',
      'x-shopify-topic': 'orders/paid',
    };
    const rawBody = Buffer.from(JSON.stringify(order), 'utf8');

    const firstPromise = processOrderWebhook({
      order,
      rawBody,
      headers,
      traceId: 'trace-1',
    });

    // Let the first call acquire the processing lock before second call.
    await new Promise((resolve) => setImmediate(resolve));

    const secondResult = await processOrderWebhook({
      order,
      rawBody,
      headers,
      traceId: 'trace-2',
    });

    assert.equal(secondResult.duplicate, true);
    assert.equal(secondResult.reason, 'webhook_in_progress');
    assert.equal(matchCallCount, 1);

    releaseFirst();
    const firstResult = await firstPromise;
    assert.equal(firstResult.matched, true);

    const savedEvent = context.db
      .prepare(
        `
          SELECT status
          FROM webhook_events
          WHERE webhook_id = ?
          LIMIT 1
        `
      )
      .get('webhook-idempotent-001');

    assert.equal(savedEvent.status, 'processed');
    assert.equal(matchCallCount, 1);
  } finally {
    context.cleanup();
  }
});

