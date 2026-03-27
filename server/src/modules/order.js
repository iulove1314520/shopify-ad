const crypto = require('node:crypto');

const { env } = require('../config/env');
const { db } = require('../db/client');
const { matchOrder } = require('./match');
const {
  logInfo,
  logWarn,
  getTraceId,
  withTraceId,
} = require('../utils/logger');
const { resolveLimit } = require('../utils/pagination');

function verifyShopifySignature(rawBody, signature) {
  if (!env.shopifyWebhookSecret || !signature) {
    return false;
  }

  const digest = crypto
    .createHmac('sha256', env.shopifyWebhookSecret)
    .update(rawBody)
    .digest('base64');

  const expected = Buffer.from(signature);
  const actual = Buffer.from(digest);

  if (expected.length !== actual.length) {
    return false;
  }

  return crypto.timingSafeEqual(expected, actual);
}

function hashBody(rawBody) {
  return crypto.createHash('sha256').update(rawBody).digest('hex');
}

function saveWebhookEvent({
  webhookId,
  topic,
  shopifyOrderId,
  traceId = '',
  status,
  errorMessage = '',
}) {
  const processedAt = status === 'received' ? null : new Date().toISOString();

  db.prepare(
    `
      INSERT INTO webhook_events (
        webhook_id,
        topic,
        shopify_order_id,
        trace_id,
        signature_valid,
        status,
        error_message,
        processed_at
      ) VALUES (?, ?, ?, ?, 1, ?, ?, ?)
      ON CONFLICT(webhook_id) DO UPDATE SET
        topic = excluded.topic,
        shopify_order_id = excluded.shopify_order_id,
        trace_id = excluded.trace_id,
        signature_valid = 1,
        status = excluded.status,
        error_message = excluded.error_message,
        processed_at = excluded.processed_at
    `
  ).run(
    webhookId,
    topic,
    shopifyOrderId,
    traceId,
    status,
    errorMessage,
    processedAt
  );
}

function updateOrderStatus(orderId, status, statusReason = '', traceId = '') {
  db.prepare(
    `
      UPDATE orders
      SET status = ?, status_reason = ?, last_trace_id = ?, processed_at = ?
      WHERE id = ?
    `
  ).run(status, statusReason, traceId, new Date().toISOString(), orderId);
}

function upsertOrder(order, rawBody, traceId = '') {
  const shopifyOrderId = String(order.id || '').trim();

  db.prepare(
    `
      INSERT INTO orders (
        shopify_order_id,
        created_at,
        total_price,
        currency,
        zip,
        financial_status,
        raw_payload,
        status,
        last_trace_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(shopify_order_id) DO UPDATE SET
        created_at = excluded.created_at,
        total_price = excluded.total_price,
        currency = excluded.currency,
        zip = excluded.zip,
        financial_status = excluded.financial_status,
        raw_payload = excluded.raw_payload,
        last_trace_id = excluded.last_trace_id
    `
  ).run(
    shopifyOrderId,
    String(order.created_at || new Date().toISOString()),
    Number(order.total_price || 0),
    String(order.currency || 'IDR'),
    String(order.shipping_address?.zip || ''),
    String(order.financial_status || ''),
    rawBody.toString('utf8'),
    'received',
    traceId
  );

  return db
    .prepare('SELECT * FROM orders WHERE shopify_order_id = ?')
    .get(shopifyOrderId);
}

function hasSuccessfulCallback(shopifyOrderId) {
  const row = db
    .prepare(
      `
        SELECT id
        FROM callbacks
        WHERE shopify_order_id = ? AND status = 'success'
        LIMIT 1
      `
    )
    .get(shopifyOrderId);

  return Boolean(row);
}

function findOrderByShopifyOrderId(shopifyOrderId) {
  return db
    .prepare('SELECT * FROM orders WHERE shopify_order_id = ? LIMIT 1')
    .get(shopifyOrderId);
}

async function processOrderWebhook({ order, rawBody, headers, traceId = '' }) {
  const webhookId =
    String(headers['x-shopify-webhook-id'] || '').trim() || hashBody(rawBody);
  const topic = String(headers['x-shopify-topic'] || 'orders/paid').trim();
  const shopifyOrderId = String(order.id || '').trim();

  if (!shopifyOrderId) {
    saveWebhookEvent({
      webhookId,
      topic,
      shopifyOrderId: '',
      traceId,
      status: 'failed',
      errorMessage: 'Missing Shopify order id',
    });
    throw new Error('Missing Shopify order id');
  }

  const existingEvent = db
    .prepare('SELECT status FROM webhook_events WHERE webhook_id = ?')
    .get(webhookId);

  if (existingEvent?.status === 'processed') {
    logInfo(
      'webhook.duplicate_ignored',
      withTraceId(traceId, {
        webhookId,
        shopifyOrderId,
        reason: 'webhook_already_processed',
      })
    );
    return { duplicate: true, reason: 'webhook_already_processed', traceId };
  }

  saveWebhookEvent({
    webhookId,
    topic,
    shopifyOrderId,
    traceId,
    status: 'received',
  });

  const orderRecord = upsertOrder(order, rawBody, traceId);
  logInfo(
    'webhook.received',
    withTraceId(traceId, {
      webhookId,
      topic,
      shopifyOrderId,
      financialStatus: order.financial_status || '',
    })
  );

  if (String(order.financial_status || '').toLowerCase() === 'pending') {
    updateOrderStatus(
      orderRecord.id,
      'ignored_pending',
      'financial_status_pending',
      traceId
    );

    saveWebhookEvent({
      webhookId,
      topic,
      shopifyOrderId,
      traceId,
      status: 'processed',
    });

    logInfo(
      'webhook.ignored_pending',
      withTraceId(traceId, {
        webhookId,
        shopifyOrderId,
      })
    );

    return { ignored: true, reason: 'financial_status_pending', traceId };
  }

  if (hasSuccessfulCallback(shopifyOrderId)) {
    updateOrderStatus(
      orderRecord.id,
      'duplicate_ignored',
      'callback_already_succeeded',
      traceId
    );

    saveWebhookEvent({
      webhookId,
      topic,
      shopifyOrderId,
      traceId,
      status: 'processed',
    });

    logInfo(
      'webhook.callback_already_succeeded',
      withTraceId(traceId, {
        webhookId,
        shopifyOrderId,
      })
    );

    return { duplicate: true, reason: 'callback_already_succeeded', traceId };
  }

  try {
    const result = await matchOrder(orderRecord, {
      triggerSource: 'webhook',
      traceId,
    });

    saveWebhookEvent({
      webhookId,
      topic,
      shopifyOrderId,
      traceId,
      status: 'processed',
    });

    logInfo(
      'webhook.processed',
      withTraceId(traceId, {
        webhookId,
        shopifyOrderId,
        matched: result.matched,
        callbackStatus: result.callbackStatus || '',
        attemptsUsed: result.attemptsUsed || 0,
      })
    );

    return result;
  } catch (error) {
    updateOrderStatus(orderRecord.id, 'processing_failed', error.message, traceId);

    saveWebhookEvent({
      webhookId,
      topic,
      shopifyOrderId,
      traceId,
      status: 'failed',
      errorMessage: error.message,
    });

    throw error;
  }
}

async function retryOrderCallback(req, res, next) {
  try {
    const shopifyOrderId = String(req.params.orderId || '').trim();
    const traceId = getTraceId(req);

    if (!shopifyOrderId) {
      res.status(400).json({ error: 'Missing order id' });
      return;
    }

    const order = findOrderByShopifyOrderId(shopifyOrderId);

    if (!order) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }

    if (String(order.financial_status || '').toLowerCase() === 'pending') {
      res.status(409).json({ error: 'Pending orders cannot be retried' });
      return;
    }

    if (hasSuccessfulCallback(shopifyOrderId)) {
      res.status(409).json({ error: 'Callback already succeeded' });
      return;
    }

    logWarn(
      'callback.manual_retry_requested',
      withTraceId(traceId, {
        shopifyOrderId,
        currentStatus: order.status,
      })
    );

    const result = await matchOrder(order, {
      triggerSource: 'manual_retry',
      traceId,
    });

    res.json({
      ok: true,
      orderId: shopifyOrderId,
      trace_id: traceId,
      result,
    });
  } catch (error) {
    next(error);
  }
}

function listOrders(req, res, next) {
  try {
    const rows = db
      .prepare(
        `
          SELECT
            shopify_order_id AS order_id,
            created_at,
            total_price,
            currency,
            zip,
            financial_status,
            status,
            status_reason,
            last_trace_id AS trace_id,
            processed_at,
            created_record_at
          FROM orders
          ORDER BY created_record_at DESC
          LIMIT ?
        `
      )
      .all(resolveLimit(req.query.limit));

    res.json(rows);
  } catch (error) {
    next(error);
  }
}

function listWebhookEvents(req, res, next) {
  try {
    const rows = db
      .prepare(
        `
          SELECT
            webhook_id,
            topic,
            shopify_order_id,
            trace_id,
            status,
            error_message,
            received_at,
            processed_at
          FROM webhook_events
          ORDER BY received_at DESC
          LIMIT ?
        `
      )
      .all(resolveLimit(req.query.limit));

    res.json(rows);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  processOrderWebhook,
  verifyShopifySignature,
  listOrders,
  listWebhookEvents,
  retryOrderCallback,
};
