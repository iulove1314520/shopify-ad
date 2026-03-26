const crypto = require('node:crypto');

const { env } = require('../config/env');
const { db } = require('../db/client');
const { matchOrder } = require('./match');
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
  status,
  errorMessage = '',
}) {
  const processedAt =
    status === 'received' ? null : new Date().toISOString();

  db.prepare(
    `
      INSERT INTO webhook_events (
        webhook_id,
        topic,
        shopify_order_id,
        signature_valid,
        status,
        error_message,
        processed_at
      ) VALUES (?, ?, ?, 1, ?, ?, ?)
      ON CONFLICT(webhook_id) DO UPDATE SET
        topic = excluded.topic,
        shopify_order_id = excluded.shopify_order_id,
        signature_valid = 1,
        status = excluded.status,
        error_message = excluded.error_message,
        processed_at = excluded.processed_at
    `
  ).run(webhookId, topic, shopifyOrderId, status, errorMessage, processedAt);
}

function updateOrderStatus(orderId, status, statusReason = '') {
  db.prepare(
    `
      UPDATE orders
      SET status = ?, status_reason = ?, processed_at = ?
      WHERE id = ?
    `
  ).run(status, statusReason, new Date().toISOString(), orderId);
}

function upsertOrder(order, rawBody) {
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
        status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(shopify_order_id) DO UPDATE SET
        created_at = excluded.created_at,
        total_price = excluded.total_price,
        currency = excluded.currency,
        zip = excluded.zip,
        financial_status = excluded.financial_status,
        raw_payload = excluded.raw_payload
    `
  ).run(
    shopifyOrderId,
    String(order.created_at || new Date().toISOString()),
    Number(order.total_price || 0),
    String(order.currency || 'IDR'),
    String(order.shipping_address?.zip || ''),
    String(order.financial_status || ''),
    rawBody.toString('utf8'),
    'received'
  );

  return db
    .prepare('SELECT * FROM orders WHERE shopify_order_id = ?')
    .get(shopifyOrderId);
}

function hasProcessedCallback(shopifyOrderId) {
  const row = db
    .prepare('SELECT id FROM callbacks WHERE shopify_order_id = ? LIMIT 1')
    .get(shopifyOrderId);

  return Boolean(row);
}

async function processOrderWebhook({ order, rawBody, headers }) {
  const webhookId =
    String(headers['x-shopify-webhook-id'] || '').trim() || hashBody(rawBody);
  const topic = String(headers['x-shopify-topic'] || 'orders/paid').trim();
  const shopifyOrderId = String(order.id || '').trim();

  if (!shopifyOrderId) {
    saveWebhookEvent({
      webhookId,
      topic,
      shopifyOrderId: '',
      status: 'failed',
      errorMessage: 'Missing Shopify order id',
    });
    throw new Error('Missing Shopify order id');
  }

  const existingEvent = db
    .prepare('SELECT status FROM webhook_events WHERE webhook_id = ?')
    .get(webhookId);

  if (existingEvent?.status === 'processed') {
    return { duplicate: true, reason: 'webhook_already_processed' };
  }

  saveWebhookEvent({
    webhookId,
    topic,
    shopifyOrderId,
    status: 'received',
  });

  const orderRecord = upsertOrder(order, rawBody);

  if (String(order.financial_status || '').toLowerCase() === 'pending') {
    updateOrderStatus(
      orderRecord.id,
      'ignored_pending',
      'financial_status_pending'
    );

    saveWebhookEvent({
      webhookId,
      topic,
      shopifyOrderId,
      status: 'processed',
    });

    return { ignored: true, reason: 'financial_status_pending' };
  }

  if (hasProcessedCallback(shopifyOrderId)) {
    updateOrderStatus(
      orderRecord.id,
      'duplicate_ignored',
      'callback_already_recorded'
    );

    saveWebhookEvent({
      webhookId,
      topic,
      shopifyOrderId,
      status: 'processed',
    });

    return { duplicate: true, reason: 'callback_already_recorded' };
  }

  try {
    const result = await matchOrder(orderRecord);

    saveWebhookEvent({
      webhookId,
      topic,
      shopifyOrderId,
      status: 'processed',
    });

    return result;
  } catch (error) {
    updateOrderStatus(orderRecord.id, 'processing_failed', error.message);

    saveWebhookEvent({
      webhookId,
      topic,
      shopifyOrderId,
      status: 'failed',
      errorMessage: error.message,
    });

    throw error;
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
};
