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

test('retention 内部模块会暴露默认限制和当前保留策略', () => {
  const context = createTestContext({
    VISITOR_RETENTION_DAYS: 14,
    BUSINESS_DATA_RETENTION_DAYS: 45,
  });

  try {
    const { env } = context.requireServer('config/env');
    const { getCleanupLimits, getRetentionPolicy } = context.requireServer('modules/system/retention');

    assert.deepEqual(getCleanupLimits(), {
      min_days: 1,
      max_days: 3650,
    });
    assert.deepEqual(getRetentionPolicy(env), {
      visitors_days: 14,
      business_days: 45,
    });
  } finally {
    context.cleanup();
  }
});

test('detail 内部模块会独立构建系统详情并暴露 TikTok Purchase 模式', () => {
  const context = createTestContext({
    TIKTOK_PURCHASE_MODE: 'disabled',
  });

  try {
    const { buildSystemDetail } = context.requireServer('modules/system/detail');
    const detail = buildSystemDetail();
    assert.equal(detail.tiktok_purchase_mode, 'disabled');
    assert.equal(detail.ok, true);
  } finally {
    context.cleanup();
  }
});
