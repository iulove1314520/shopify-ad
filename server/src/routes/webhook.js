const express = require('express');

const { env } = require('../config/env');
const { logError } = require('../utils/logger');
const {
  processOrderWebhook,
  verifyShopifySignature,
} = require('../modules/order');

const router = express.Router();

router.post(
  '/orders',
  express.raw({ type: 'application/json', limit: '1mb' }),
  (req, res) => {
    if (!env.shopifyWebhookSecret) {
      res
        .status(503)
        .json({ error: 'SHOPIFY_WEBHOOK_SECRET is not configured' });
      return;
    }

    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from([]);
    const signature = String(req.get('x-shopify-hmac-sha256') || '').trim();

    if (!verifyShopifySignature(rawBody, signature)) {
      res.status(401).json({ error: 'Invalid webhook signature' });
      return;
    }

    let order;
    try {
      order = JSON.parse(rawBody.toString('utf8'));
    } catch (error) {
      res.status(400).json({ error: 'Invalid JSON payload' });
      return;
    }

    res.status(200).send('ok');

    processOrderWebhook({
      order,
      rawBody,
      headers: req.headers,
    }).catch((error) => {
      logError('webhook.processing_failed', {
        message: error.message,
        shopifyOrderId: String(order.id || ''),
      });
    });
  }
);

module.exports = router;

