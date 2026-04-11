const axios = require('axios');

const { env } = require('../config/env');
const {
  maskValue,
  summarize,
  createSkippedResult,
  createSuccessResult,
  createFailureResult,
} = require('./callback-utils');
const { pickBestUserAgent } = require('../utils/user-agent');

async function sendToFacebook(order, fbclid, callbackContext = {}) {
  const visitor = callbackContext?.visitor || null;

  let payload = {};
  try {
    payload = JSON.parse(order?.raw_payload || '{}');
    if (!payload || typeof payload !== 'object') payload = {};
  } catch (_e) {
    payload = {};
  }

  const clientDetails = payload?.client_details || {};
  const eventTimestamp = Math.floor(
    new Date(order.created_at).getTime() / 1000
  );

  // 从访客或订单 payload 中提取 IP 和 User-Agent（提升 Meta 匹配率）
  const clientIp = (
    visitor?.ip ||
    payload?.browser_ip ||
    clientDetails?.browser_ip ||
    ''
  ).trim();
  const clientUserAgent = pickBestUserAgent([
    { value: visitor?.user_agent, source: 'visitor' },
    { value: clientDetails?.user_agent, source: 'client_details_user_agent' },
    {
      value: clientDetails?.browser_user_agent,
      source: 'client_details_browser_user_agent',
    },
    {
      value: clientDetails?.http_user_agent,
      source: 'client_details_http_user_agent',
    },
    { value: payload?.user_agent, source: 'payload_user_agent' },
  ]).value;

  // 构建 user_data
  const userData = { fbc: fbclid };
  if (clientIp) userData.client_ip_address = clientIp;
  if (clientUserAgent) userData.client_user_agent = clientUserAgent;

  // 构建 contents（产品级归因数据）
  const lineItems = Array.isArray(payload?.line_items)
    ? payload.line_items
    : [];
  const contents = lineItems
    .slice(0, 10)
    .map((item) => ({
      id: String(item?.product_id || item?.variant_id || item?.sku || ''),
      quantity: Number(item?.quantity || 1),
      item_price: Number(item?.price || 0),
    }))
    .filter((c) => c.id);

  const customData = {
    currency: order.currency,
    value: Number(order.total_price || 0),
  };
  if (contents.length > 0) {
    customData.contents = contents;
    customData.content_type = 'product';
  }

  const eventId = `order_${order.shopify_order_id}`;

  const requestSummary = summarize({
    orderId: order.shopify_order_id,
    pixelId: env.facebookPixelId,
    event: 'Purchase',
    eventId,
    currency: order.currency,
    value: Number(order.total_price || 0),
    clickId: maskValue(fbclid),
    hasIp: Boolean(clientIp),
    hasUserAgent: Boolean(clientUserAgent),
    contentCount: contents.length,
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
            event_id: eventId,
            event_time: Number.isFinite(eventTimestamp)
              ? eventTimestamp
              : Math.floor(Date.now() / 1000),
            action_source: 'website',
            user_data: userData,
            custom_data: customData,
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
