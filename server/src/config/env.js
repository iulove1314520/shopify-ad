const path = require('node:path');

require('dotenv').config({
  path: path.resolve(__dirname, '../../../.env'),
});

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function hasValue(value) {
  return Boolean(String(value || '').trim());
}

const env = {
  nodeEnv: process.env.NODE_ENV || 'production',
  port: toNumber(process.env.PORT, 38417),
  corsAllowOrigins: toList(process.env.CORS_ALLOW_ORIGINS),
  sqlitePath:
    process.env.SQLITE_PATH || path.resolve(__dirname, '../../../data/app.db'),
  sqliteBusyTimeoutMs: toNumber(process.env.SQLITE_BUSY_TIMEOUT_MS, 5000),
  visitorRetentionDays: toNumber(process.env.VISITOR_RETENTION_DAYS, 7),
  businessDataRetentionDays: toNumber(
    process.env.BUSINESS_DATA_RETENTION_DAYS,
    30
  ),
  requestTimeoutMs: toNumber(process.env.REQUEST_TIMEOUT_MS, 10000),
  callbackMaxAttempts: toNumber(process.env.CALLBACK_MAX_ATTEMPTS, 2),
  callbackRetryDelayMs: toNumber(process.env.CALLBACK_RETRY_DELAY_MS, 800),
  visitorRateLimitWindowMs: toNumber(
    process.env.VISITOR_RATE_LIMIT_WINDOW_MS,
    60000
  ),
  visitorRateLimitMax: toNumber(process.env.VISITOR_RATE_LIMIT_MAX, 90),
  webhookRateLimitWindowMs: toNumber(
    process.env.WEBHOOK_RATE_LIMIT_WINDOW_MS,
    60000
  ),
  webhookRateLimitMax: toNumber(process.env.WEBHOOK_RATE_LIMIT_MAX, 120),
  retryRateLimitWindowMs: toNumber(
    process.env.RETRY_RATE_LIMIT_WINDOW_MS,
    60000
  ),
  retryRateLimitMax: toNumber(process.env.RETRY_RATE_LIMIT_MAX, 10),
  cleanupRateLimitWindowMs: toNumber(
    process.env.CLEANUP_RATE_LIMIT_WINDOW_MS,
    3600000
  ),
  cleanupRateLimitMax: toNumber(process.env.CLEANUP_RATE_LIMIT_MAX, 2),
  purgeRateLimitWindowMs: toNumber(
    process.env.PURGE_RATE_LIMIT_WINDOW_MS,
    3600000
  ),
  purgeRateLimitMax: toNumber(process.env.PURGE_RATE_LIMIT_MAX, 1),
  defaultListLimit: toNumber(process.env.DEFAULT_LIST_LIMIT, 100),
  maxListLimit: toNumber(process.env.MAX_LIST_LIMIT, 500),
  apiAuthToken: process.env.API_AUTH_TOKEN || '',
  shopifyWebhookSecret: process.env.SHOPIFY_WEBHOOK_SECRET || '',
  tiktokPixelId: process.env.TIKTOK_PIXEL_ID || '',
  tiktokAccessToken: process.env.TIKTOK_ACCESS_TOKEN || '',
  tiktokPageUrlBase: process.env.TIKTOK_PAGE_URL_BASE || '',
  tiktokApiUrl:
    process.env.TIKTOK_API_URL ||
    'https://business-api.tiktok.com/open_api/v1.3/event/track/',
  facebookPixelId: process.env.FACEBOOK_PIXEL_ID || '',
  facebookAccessToken: process.env.FACEBOOK_ACCESS_TOKEN || '',
};

function getPlatformConfigChecks() {
  const tiktokIssues = [];
  const facebookIssues = [];

  if (!hasValue(env.tiktokPixelId)) {
    tiktokIssues.push('缺少 TikTok Pixel ID');
  }

  if (!hasValue(env.tiktokAccessToken)) {
    tiktokIssues.push('缺少 TikTok Access Token');
  }

  if (!hasValue(env.facebookPixelId)) {
    facebookIssues.push('缺少 Facebook Pixel ID');
  }

  if (!hasValue(env.facebookAccessToken)) {
    facebookIssues.push('缺少 Facebook Access Token');
  }

  return [
    {
      id: 'tiktok',
      label: 'TikTok',
      configured: tiktokIssues.length === 0,
      pixelIdConfigured: hasValue(env.tiktokPixelId),
      accessTokenConfigured: hasValue(env.tiktokAccessToken),
      issues: tiktokIssues,
    },
    {
      id: 'facebook',
      label: 'Facebook',
      configured: facebookIssues.length === 0,
      pixelIdConfigured: hasValue(env.facebookPixelId),
      accessTokenConfigured: hasValue(env.facebookAccessToken),
      issues: facebookIssues,
    },
  ];
}

function validateEnv() {
  const errors = [];

  if (
    env.nodeEnv === 'production' &&
    (!env.apiAuthToken || env.apiAuthToken === 'change_me')
  ) {
    errors.push(
      'API_AUTH_TOKEN must be configured to a non-default value in production'
    );
  }

  return errors;
}

module.exports = { env, validateEnv, getPlatformConfigChecks };
