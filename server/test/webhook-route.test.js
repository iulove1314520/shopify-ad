const crypto = require('node:crypto');
const test = require('node:test');
const assert = require('node:assert/strict');

const { createTestContext } = require('./helpers/test-context');

test('webhook 处理失败时返回 500，避免过早确认成功', async () => {
  const context = createTestContext({
    SHOPIFY_WEBHOOK_SECRET: 'unit-test-secret',
  });

  let server;

  try {
    const orderModule = context.requireServer('modules/order');
    orderModule.processOrderWebhook = async () => {
      throw new Error('simulated processing failure');
    };

    const { createApp } = context.requireServer('app');
    const app = createApp();

    server = await new Promise((resolve) => {
      const instance = app.listen(0, () => resolve(instance));
    });

    const rawBody = JSON.stringify({
      id: 123456,
      financial_status: 'paid',
    });
    const signature = crypto
      .createHmac('sha256', 'unit-test-secret')
      .update(rawBody)
      .digest('base64');

    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/webhook/orders`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Hmac-Sha256': signature,
          'X-Shopify-Webhook-Id': 'webhook-test-001',
        },
        body: rawBody,
      }
    );

    assert.equal(response.status, 500);

    const payload = await response.json();
    assert.equal(payload.error, 'Internal Server Error');
  } finally {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    context.cleanup();
  }
});
