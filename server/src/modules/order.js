const { env } = require('../config/env');
const { db } = require('../db/client');
const { matchOrder } = require('./match');
const { createRetryOrderCallback } = require('./order/retry');
const { verifyShopifySignature: verifyShopifySignatureWithSecret } = require('./order/signature');
const {
  findOrderByShopifyOrderId,
  hasSuccessfulCallback,
  updateOrderStatus,
  upsertOrder,
} = require('./order/order-store');
const { resolveWebhookId } = require('./order/webhook-id');
const { createProcessOrderWebhook } = require('./order/webhook-processor');
const { handleOrdersWebhookRequest } = require('./order/webhook-handler');
const {
  markWebhookEventFailed,
  saveWebhookEvent,
  tryStartWebhookProcessing,
} = require('./order/webhook-events');
const {
  logInfo,
  logError,
  logWarn,
  getTraceId,
  withTraceId,
} = require('../utils/logger');
const { resolveLimit } = require('../utils/pagination');
const processOrderWebhook = createProcessOrderWebhook({
  db,
  matchOrder,
  logInfo,
  withTraceId,
  resolveWebhookId,
  tryStartWebhookProcessing,
  saveWebhookEvent,
  upsertOrder,
  updateOrderStatus,
  hasSuccessfulCallback,
});

const retryOrderCallback = createRetryOrderCallback({
  db,
  matchOrder,
  logWarn,
  getTraceId,
  withTraceId,
  findOrderByShopifyOrderId,
  hasSuccessfulCallback,
});

function verifyShopifySignature(rawBody, signature) {
  return verifyShopifySignatureWithSecret(rawBody, signature, env.shopifyWebhookSecret);
}

async function handleWebhookOrders(req, res, next) {
  return handleOrdersWebhookRequest({
    req,
    res,
    next,
    env,
    db,
    logError,
    logWarn,
    getTraceId,
    withTraceId,
    processOrderWebhook: module.exports.processOrderWebhook,
    resolveWebhookId: module.exports.resolveWebhookId,
    verifyShopifySignature: module.exports.verifyShopifySignature,
    markWebhookEventFailed,
  });
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

function revokeOrderMatch(req, res, next) {
  try {
    const shopifyOrderId = String(req.params.orderId || '').trim();
    const traceId = getTraceId(req);
    const reason = String(req.body?.reason || 'manual_revoke').trim();

    if (!shopifyOrderId) {
      res.status(400).json({ error: 'Missing order id' });
      return;
    }

    const order = findOrderByShopifyOrderId(db, shopifyOrderId);

    if (!order) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }

    const activeMatch = db
      .prepare(
        `
          SELECT id, visitor_id, click_id, platform
          FROM matches
          WHERE order_id = ? AND active = 1
          LIMIT 1
        `
      )
      .get(order.id);

    if (!activeMatch) {
      res.status(409).json({ error: 'No active match to revoke' });
      return;
    }

    const now = new Date().toISOString();

    db.prepare(
      `
        UPDATE matches
        SET active = 0, released_at = ?, released_reason = ?
        WHERE id = ?
      `
    ).run(now, reason, activeMatch.id);

    updateOrderStatus(
      db,
      order.id,
      'matched_revoked',
      `revoked;reason=${reason}`,
      traceId
    );

    logWarn(
      'match.manual_revoke',
      withTraceId(traceId, {
        shopifyOrderId,
        matchId: activeMatch.id,
        visitorId: activeMatch.visitor_id,
        reason,
      })
    );

    res.json({
      ok: true,
      orderId: shopifyOrderId,
      matchId: activeMatch.id,
      visitorId: activeMatch.visitor_id,
      releasedAt: now,
      reason,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  handleWebhookOrders,
  processOrderWebhook,
  resolveWebhookId,
  verifyShopifySignature,
  listOrders,
  listWebhookEvents,
  retryOrderCallback,
  revokeOrderMatch,
};
