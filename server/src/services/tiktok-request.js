const { URL } = require('node:url');

const { env } = require('../config/env');
const { buildHashedMatchKeys } = require('../utils/tiktok-match-keys');
const { pickBestUserAgent } = require('../utils/user-agent');

function parseOrderPayload(order) {
  try {
    const payload = JSON.parse(order?.raw_payload || '{}');
    return payload && typeof payload === 'object' ? payload : {};
  } catch (error) {
    return {};
  }
}

function pickFirstText(...values) {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) {
      return text;
    }
  }

  return '';
}

function toNumber(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeBaseUrl(value) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }

  try {
    return new URL(text).toString();
  } catch (error) {
    return '';
  }
}

function toAbsoluteUrl(value, baseUrl = '') {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }

  if (/^https?:\/\//i.test(text)) {
    try {
      return new URL(text).toString();
    } catch (error) {
      return '';
    }
  }

  if (!baseUrl) {
    return '';
  }

  try {
    return new URL(text, baseUrl).toString();
  } catch (error) {
    return '';
  }
}

function buildContents(payload, visitor) {
  const items = Array.isArray(payload?.line_items) ? payload.line_items : [];
  const contents = items
    .map((item, index) => {
      const content = {
        content_id: pickFirstText(
          item?.product_id,
          item?.variant_id,
          item?.sku,
          item?.id,
          index === 0 ? visitor?.product_id : ''
        ),
        content_name: pickFirstText(item?.title, item?.name),
      };

      const quantity = toNumber(item?.quantity, null);
      const price = toNumber(item?.price, null);

      if (quantity !== null) {
        content.quantity = quantity;
      }

      if (price !== null) {
        content.price = price;
      }

      const category = pickFirstText(item?.product_type, item?.vendor);
      if (category) {
        content.content_category = category;
      }

      return Object.fromEntries(
        Object.entries(content).filter(([, value]) => value !== '' && value !== null)
      );
    })
    .filter((item) => Object.keys(item).length > 0);

  if (contents.length > 0) {
    return contents.slice(0, 10);
  }

  const visitorProduct = pickFirstText(visitor?.product_id);
  if (!visitorProduct) {
    return [];
  }

  return [
    {
      content_id: visitorProduct,
      content_name: visitorProduct,
      quantity: 1,
    },
  ];
}

function buildPageContext(payload, visitor, runtimeEnv = env) {
  const baseUrl = normalizeBaseUrl(runtimeEnv.tiktokPageUrlBase);
  const url = toAbsoluteUrl(
    pickFirstText(
      payload?.landing_site,
      payload?.landing_site_ref,
      visitor?.product_id
    ),
    baseUrl
  );
  const referrer = toAbsoluteUrl(payload?.referring_site, baseUrl);

  if (!url && !referrer) {
    return null;
  }

  const page = {};
  if (url) {
    page.url = url;
  }

  if (referrer) {
    page.referrer = referrer;
  }

  return page;
}

function buildUser(payload, visitor, ttclid) {
  const clientDetails =
    payload?.client_details && typeof payload.client_details === 'object'
      ? payload.client_details
      : {};

  const user = {};

  const trimmedTtclid = String(ttclid || '').trim();
  if (trimmedTtclid) {
    user.ttclid = trimmedTtclid;
  }

  const ip = pickFirstText(
    visitor?.ip,
    payload?.browser_ip,
    clientDetails?.browser_ip,
    clientDetails?.ip
  );
  if (ip) {
    user.ip = ip;
  }

  const userAgent = pickBestUserAgent([
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
  if (userAgent) {
    user.user_agent = userAgent;
  }

  const matchKeys = buildHashedMatchKeys(payload, visitor);
  Object.assign(user, matchKeys);

  return user;
}

function buildTikTokRequestBody(order, ttclid, callbackContext = {}, runtimeEnv = env) {
  const payload = parseOrderPayload(order);
  const visitor = callbackContext?.visitor || null;
  const eventTimestampMs = (() => {
    const parsed = new Date(order?.created_at).getTime();
    return Number.isFinite(parsed) ? parsed : Date.now();
  })();
  const eventTime = Math.floor(eventTimestampMs / 1000);
  const user = buildUser(payload, visitor, ttclid);
  const page = buildPageContext(payload, visitor, runtimeEnv);
  const contents = buildContents(payload, visitor);
  const properties = {
    currency: order.currency,
    value: Number(order.total_price || 0),
  };

  if (contents.length > 0) {
    properties.contents = contents;
    properties.content_type = 'product';
  }

  const dataItem = {
    event: 'Purchase',
    event_id: `order_${order.shopify_order_id}`,
    event_time: eventTime,
    properties,
  };

  if (Object.keys(user).length > 0) {
    dataItem.user = user;
  }

  if (page) {
    dataItem.page = page;
  }

  return {
    event_source: 'web',
    event_source_id: runtimeEnv.tiktokPixelId,
    data: [dataItem],
  };
}

module.exports = {
  buildTikTokRequestBody,
};
