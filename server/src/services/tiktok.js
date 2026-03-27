const axios = require('axios');

const { env } = require('../config/env');
const {
  maskValue,
  summarize,
  createSkippedResult,
  createSuccessResult,
  createFailureResult,
} = require('./callback-utils');

async function sendToTikTok(order, ttclid) {
  const requestSummary = summarize({
    orderId: order.shopify_order_id,
    pixelCode: env.tiktokPixelId,
    event: 'Purchase',
    currency: order.currency,
    value: Number(order.total_price || 0),
    clickId: maskValue(ttclid),
  });

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
      {
        pixel_code: env.tiktokPixelId,
        event: 'Purchase',
        event_time: Math.floor(new Date(order.created_at).getTime() / 1000),
        properties: {
          currency: order.currency,
          value: Number(order.total_price || 0),
        },
        context: {
          ad: {
            callback: ttclid,
          },
        },
      },
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

module.exports = { sendToTikTok };
