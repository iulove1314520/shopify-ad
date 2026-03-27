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
