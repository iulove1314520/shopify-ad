const axios = require('axios');

const { env } = require('../config/env');
const {
  maskValue,
  summarize,
  createSkippedResult,
  createSuccessResult,
  createFailureResult,
} = require('./callback-utils');
const { buildFacebookRequestPayload } = require('./facebook-request');

async function sendToFacebook(order, fbclid, callbackContext = {}) {
  const requestPayload = buildFacebookRequestPayload(order, fbclid, callbackContext, env);
  const firstEvent = Array.isArray(requestPayload.data) ? requestPayload.data[0] || {} : {};

  const requestSummary = summarize({
    orderId: order.shopify_order_id,
    pixelId: env.facebookPixelId,
    event: firstEvent.event_name || 'Purchase',
    eventId: firstEvent.event_id || `order_${order.shopify_order_id}`,
    currency: order.currency,
    value: Number(order.total_price || 0),
    clickId: maskValue(fbclid),
    hasIp: Boolean(firstEvent.user_data?.client_ip_address),
    hasUserAgent: Boolean(firstEvent.user_data?.client_user_agent),
    contentCount: Array.isArray(firstEvent.custom_data?.contents)
      ? firstEvent.custom_data.contents.length
      : 0,
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
        ...requestPayload,
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

module.exports = {
  buildFacebookRequestPayload,
  sendToFacebook,
};
