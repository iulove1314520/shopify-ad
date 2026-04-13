const express = require('express');

const { env } = require('../config/env');
const { createRateLimiter } = require('../utils/rate-limit');
const { handleWebhookOrders } = require('../modules/order');

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
  handleWebhookOrders
);

module.exports = router;
