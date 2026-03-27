const express = require('express');

const { env } = require('../config/env');
const {
  logError,
  logWarn,
  getTraceId,
  withTraceId,
} = require('../utils/logger');
const { createRateLimiter } = require('../utils/rate-limit');
const {
  processOrderWebhook,
  verifyShopifySignature,
} = require('../modules/order');

const router = express.Router();
const webhookRateLimiter = createRateLimiter({
  name: 'webhook_orders',
  windowMs: env.webhookRateLimitWindowMs,
  max: env.webhookRateLimitMax,
});

router.post(
  '/orders',
  webhookRateLimiter,
  express.raw({ type: 'application/json', limit: '1mb' }),
  (req, res) => {
    const traceId = getTraceId(req);

    if (!env.shopifyWebhookSecret) {
      res
        .status(503)
        .json({ error: 'SHOPIFY_WEBHOOK_SECRET is not configured' });
      return;
    }

    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from([]);
    const signature = String(req.get('x-shopify-hmac-sha256') || '').trim();

    if (!verifyShopifySignature(rawBody, signature)) {
      logWarn(
        'webhook.invalid_signature',
        withTraceId(traceId, {
          path: req.originalUrl,
          webhookId: String(req.get('x-shopify-webhook-id') || '').trim(),
        })
      );
      res.status(401).json({ error: 'Invalid webhook signature' });
      return;
    }

    let order;
    try {
      order = JSON.parse(rawBody.toString('utf8'));
    } catch (error) {
      logWarn(
        'webhook.invalid_json',
        withTraceId(traceId, {
          path: req.originalUrl,
          message: error.message,
        })
      );
      res.status(400).json({ error: 'Invalid JSON payload' });
      return;
    }

    res.status(200).send('ok');

    processOrderWebhook({
      order,
      rawBody,
      headers: req.headers,
      traceId,
    }).catch((error) => {
      logError(
        'webhook.processing_failed',
        withTraceId(traceId, {
          message: error.message,
          shopifyOrderId: String(order.id || ''),
        })
      );
    });
  }
);

module.exports = router;
