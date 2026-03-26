const path = require('node:path');

require('dotenv').config({
  path: path.resolve(__dirname, '../../../.env'),
});

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const env = {
  nodeEnv: process.env.NODE_ENV || 'production',
  port: toNumber(process.env.PORT, 38417),
  sqlitePath:
    process.env.SQLITE_PATH || path.resolve(__dirname, '../../../data/app.db'),
  sqliteBusyTimeoutMs: toNumber(process.env.SQLITE_BUSY_TIMEOUT_MS, 5000),
  visitorRetentionDays: toNumber(process.env.VISITOR_RETENTION_DAYS, 7),
  matchWindowDays: toNumber(process.env.MATCH_WINDOW_DAYS, 3),
  requestTimeoutMs: toNumber(process.env.REQUEST_TIMEOUT_MS, 10000),
  defaultListLimit: toNumber(process.env.DEFAULT_LIST_LIMIT, 100),
  maxListLimit: toNumber(process.env.MAX_LIST_LIMIT, 500),
  apiAuthToken: process.env.API_AUTH_TOKEN || '',
  shopifyWebhookSecret: process.env.SHOPIFY_WEBHOOK_SECRET || '',
  tiktokPixelId: process.env.TIKTOK_PIXEL_ID || '',
  tiktokAccessToken: process.env.TIKTOK_ACCESS_TOKEN || '',
  tiktokApiUrl:
    process.env.TIKTOK_API_URL ||
    'https://business-api.tiktok.com/open_api/v1.3/event/track/',
  facebookPixelId: process.env.FACEBOOK_PIXEL_ID || '',
  facebookAccessToken: process.env.FACEBOOK_ACCESS_TOKEN || '',
};

module.exports = { env };
