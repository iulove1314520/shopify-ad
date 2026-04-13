const { URL } = require('node:url');
const axios = require('axios');

const { env } = require('../config/env');
const {
  maskValue,
  summarize,
  createSkippedResult,
  createSuccessResult,
  createFailureResult,
} = require('./callback-utils');
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

function buildPageContext(payload, visitor) {
  const baseUrl = normalizeBaseUrl(env.tiktokPageUrlBase);
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

function buildContext(payload, visitor, ttclid) {
  const clientDetails =
    payload?.client_details && typeof payload.client_details === 'object'
      ? payload.client_details
      : {};

  const context = {
    ad: {
      callback: ttclid,
    },
  };

  const ip = pickFirstText(
    visitor?.ip,
    payload?.browser_ip,
    clientDetails?.browser_ip,
    clientDetails?.ip
  );
  if (ip) {
    context.ip = ip;
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
    context.user_agent = userAgent;
  }

  const page = buildPageContext(payload, visitor);
  if (page) {
    context.page = page;
  }

  const user = buildHashedMatchKeys(payload, visitor);
  if (Object.keys(user).length > 0) {
    context.user = user;
  }

  return context;
}

function buildRequestBody(order, ttclid, callbackContext = {}) {
  const payload = parseOrderPayload(order);
  const visitor = callbackContext?.visitor || null;
  const eventTimestampMs = (() => {
    const parsed = new Date(order?.created_at).getTime();
    return Number.isFinite(parsed) ? parsed : Date.now();
  })();
  const context = buildContext(payload, visitor, ttclid);
  const contents = buildContents(payload, visitor);
  const properties = {
    currency: order.currency,
    value: Number(order.total_price || 0),
  };

  if (contents.length > 0) {
    properties.contents = contents;
    properties.content_type = 'product';
  }

  return {
    event_source: 'web',
    event_source_id: env.tiktokPixelId,
    pixel_code: env.tiktokPixelId,
    data: [
      {
        event: 'Purchase',
        event_id: `order_${order.shopify_order_id}`,
        timestamp: eventTimestampMs,
        event_time: Math.floor(eventTimestampMs / 1000),
        properties,
        context,
      },
    ],
  };
}

async function sendToTikTok(order, ttclid, callbackContext = {}) {
  const requestBody = buildRequestBody(order, ttclid, callbackContext);
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
    hasIp: Boolean(firstEvent.context?.ip),
    hasUserAgent: Boolean(firstEvent.context?.user_agent),
    hasEmail: Boolean(firstEvent.context?.user?.email),
    hasPhone: Boolean(firstEvent.context?.user?.phone_number),
    hasExternalId: Boolean(firstEvent.context?.user?.external_id),
    hasTtp: Boolean(firstEvent.context?.user?.ttp),
    pageUrl: firstEvent.context?.page?.url || '',
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

module.exports = { sendToTikTok, buildRequestBody };
