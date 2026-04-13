const crypto = require('node:crypto');
const test = require('node:test');
const assert = require('node:assert/strict');

const { createTestContext } = require('./helpers/test-context');

test('verifyShopifySignature 能正确校验 Shopify 签名', () => {
  const context = createTestContext({
    SHOPIFY_WEBHOOK_SECRET: 'unit-test-secret',
  });

  try {
    const { verifyShopifySignature } = context.requireServer('modules/order');
    const rawBody = Buffer.from(JSON.stringify({ id: 123456 }));
    const signature = crypto
      .createHmac('sha256', 'unit-test-secret')
      .update(rawBody)
      .digest('base64');

    assert.equal(verifyShopifySignature(rawBody, signature), true);
    assert.equal(verifyShopifySignature(rawBody, 'bad-signature'), false);
  } finally {
    context.cleanup();
  }
});

test('signature 工具支持显式 secret 参数，便于从 facade 抽离', () => {
  const context = createTestContext();

  try {
    const { verifyShopifySignature } = context.requireServer('modules/order/signature');
    const rawBody = Buffer.from(JSON.stringify({ id: 654321 }));
    const signature = crypto
      .createHmac('sha256', 'explicit-secret')
      .update(rawBody)
      .digest('base64');

    assert.equal(
      verifyShopifySignature(rawBody, signature, 'explicit-secret'),
      true
    );
    assert.equal(
      verifyShopifySignature(rawBody, signature, 'another-secret'),
      false
    );
  } finally {
    context.cleanup();
  }
});

test('webhook id 工具会优先使用 header，否则回退到 body hash', () => {
  const context = createTestContext();

  try {
    const { hashBody, resolveWebhookId } = context.requireServer('modules/order/webhook-id');
    const rawBody = Buffer.from(JSON.stringify({ id: 777888 }));

    assert.equal(
      resolveWebhookId({ 'x-shopify-webhook-id': 'webhook-header-001' }, rawBody),
      'webhook-header-001'
    );
    assert.equal(resolveWebhookId({}, rawBody), hashBody(rawBody));
  } finally {
    context.cleanup();
  }
});
