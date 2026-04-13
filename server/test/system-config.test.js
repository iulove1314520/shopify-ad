const test = require('node:test');
const assert = require('node:assert/strict');

const { createTestContext } = require('./helpers/test-context');

test('env 会默认将 TikTok Purchase 模式设为 self_hosted_only', () => {
  const context = createTestContext();

  try {
    const { env } = context.requireServer('config/env');
    assert.equal(env.tiktokPurchaseMode, 'self_hosted_only');
  } finally {
    context.cleanup();
  }
});

test('system detail 会暴露当前 TikTok Purchase 模式', () => {
  const context = createTestContext({
    TIKTOK_PURCHASE_MODE: 'disabled',
  });

  try {
    const { buildSystemDetail } = context.requireServer('modules/system');
    const detail = buildSystemDetail();
    assert.equal(detail.tiktok_purchase_mode, 'disabled');
  } finally {
    context.cleanup();
  }
});
