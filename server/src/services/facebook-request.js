const { env } = require('../config/env');
const { pickBestUserAgent } = require('../utils/user-agent');

function parseOrderPayload(order) {
  try {
    const payload = JSON.parse(order?.raw_payload || '{}');
    return payload && typeof payload === 'object' ? payload : {};
  } catch (error) {
    return {};
  }
}

function buildFacebookRequestPayload(order, fbclid, callbackContext = {}, runtimeEnv = env) {
  const visitor = callbackContext?.visitor || null;
  const payload = parseOrderPayload(order);
  const clientDetails = payload?.client_details || {};
  const eventTimestamp = Math.floor(new Date(order.created_at).getTime() / 1000);

  const clientIp = (
    visitor?.ip
    || payload?.browser_ip
    || clientDetails?.browser_ip
    || ''
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

  const userData = { fbc: fbclid };
  if (clientIp) userData.client_ip_address = clientIp;
  if (clientUserAgent) userData.client_user_agent = clientUserAgent;

  const lineItems = Array.isArray(payload?.line_items) ? payload.line_items : [];
  const contents = lineItems
    .slice(0, 10)
    .map((item) => ({
      id: String(item?.product_id || item?.variant_id || item?.sku || ''),
      quantity: Number(item?.quantity || 1),
      item_price: Number(item?.price || 0),
    }))
    .filter((content) => content.id);

  const customData = {
    currency: order.currency,
    value: Number(order.total_price || 0),
  };
  if (contents.length > 0) {
    customData.contents = contents;
    customData.content_type = 'product';
  }

  return {
    data: [
      {
        event_name: 'Purchase',
        event_id: `order_${order.shopify_order_id}`,
        event_time: Number.isFinite(eventTimestamp)
          ? eventTimestamp
          : Math.floor(Date.now() / 1000),
        action_source: 'website',
        user_data: userData,
        custom_data: customData,
      },
    ],
    pixel_id: runtimeEnv.facebookPixelId,
  };
}

module.exports = {
  buildFacebookRequestPayload,
};
