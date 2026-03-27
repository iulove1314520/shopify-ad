const axios = require('axios');

const { env } = require('../config/env');
const {
  maskValue,
  summarize,
  createSkippedResult,
  createSuccessResult,
  createFailureResult,
} = require('./callback-utils');

async function sendToFacebook(order, fbclid) {
  const requestSummary = summarize({
    orderId: order.shopify_order_id,
    pixelId: env.facebookPixelId,
    event: 'Purchase',
    currency: order.currency,
    value: Number(order.total_price || 0),
    clickId: maskValue(fbclid),
  });

  if (!env.facebookPixelId || !env.facebookAccessToken) {
    return createSkippedResult(
      'Facebook',
      'Facebook credentials are missing',
      requestSummary,
      'credentials_missing'
    );
  }

  try {
    const response = await axios.post(
      `https://graph.facebook.com/v18.0/${env.facebookPixelId}/events`,
      {
        data: [
          {
            event_name: 'Purchase',
            event_time: Math.floor(new Date(order.created_at).getTime() / 1000),
            action_source: 'website',
            user_data: {
              fbc: fbclid,
            },
            custom_data: {
              currency: order.currency,
              value: Number(order.total_price || 0),
            },
          },
        ],
        access_token: env.facebookAccessToken,
      },
      {
        timeout: env.requestTimeoutMs,
      }
    );

    return createSuccessResult('Facebook', response, requestSummary);
  } catch (error) {
    return createFailureResult('Facebook', error, requestSummary);
  }
}

module.exports = { sendToFacebook };
