const axios = require('axios');

const { env } = require('../config/env');
const {
  maskValue,
  summarize,
  createSkippedResult,
  createSuccessResult,
  createFailureResult,
} = require('./callback-utils');
const { buildTikTokRequestBody } = require('./tiktok-request');

async function sendToTikTok(order, ttclid, callbackContext = {}) {
  const requestBody = buildTikTokRequestBody(order, ttclid, callbackContext, env);
  const firstEvent = Array.isArray(requestBody.data) ? requestBody.data[0] || {} : {};
  const requestSummary = summarize({
    orderId: order.shopify_order_id,
    purchaseMode: env.tiktokPurchaseMode,
    purchaseSource: 'self_hosted_backend',
    pixelCode: env.tiktokPixelId,
    eventSource: requestBody.event_source,
    eventSourceId: env.tiktokPixelId,
    event: firstEvent.event || '',
    eventId: firstEvent.event_id || '',
    currency: order.currency,
    value: Number(order.total_price || 0),
    clickId: maskValue(ttclid),
    hasIp: Boolean(firstEvent.user?.ip),
    hasUserAgent: Boolean(firstEvent.user?.user_agent),
    hasEmail: Boolean(firstEvent.user?.email),
    hasPhone: Boolean(firstEvent.user?.phone),
    hasExternalId: Boolean(firstEvent.user?.external_id),
    hasTtp: Boolean(firstEvent.user?.ttp),
    hasTtclid: Boolean(firstEvent.user?.ttclid),
    pageUrl: firstEvent.page?.url || '',
    contentCount: Array.isArray(firstEvent.properties?.contents)
      ? firstEvent.properties.contents.length
      : 0,
  });

  if (env.tiktokPurchaseMode === 'disabled') {
    return createSkippedResult(
      'TikTok',
      'TikTok purchase callbacks are disabled by configuration',
      requestSummary,
      'purchase_mode_disabled'
    );
  }

  if (!env.tiktokPixelId || !env.tiktokAccessToken) {
    return createSkippedResult(
      'TikTok',
      'TikTok credentials are missing',
      requestSummary,
      'credentials_missing'
    );
  }

  try {
    const response = await axios.post(
      env.tiktokApiUrl,
      requestBody,
      {
        headers: {
          'Access-Token': env.tiktokAccessToken,
          'Content-Type': 'application/json',
        },
        timeout: env.requestTimeoutMs,
      }
    );

    return createSuccessResult('TikTok', response, requestSummary);
  } catch (error) {
    return createFailureResult('TikTok', error, requestSummary);
  }
}

module.exports = {
  buildRequestBody: buildTikTokRequestBody,
  buildTikTokRequestBody,
  sendToTikTok,
};
