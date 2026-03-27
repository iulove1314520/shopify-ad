const express = require('express');

const { env } = require('../config/env');
const { requireApiAuth } = require('../utils/auth');
const { createRateLimiter } = require('../utils/rate-limit');
const { handleVisitor, listVisitors } = require('../modules/visitor');
const { listMatches, listCallbacks } = require('../modules/match');
const {
  listOrders,
  listWebhookEvents,
  retryOrderCallback,
} = require('../modules/order');
const { getStats, getSystemDetail } = require('../modules/system');

const router = express.Router();
const visitorRateLimiter = createRateLimiter({
  name: 'visitor',
  windowMs: env.visitorRateLimitWindowMs,
  max: env.visitorRateLimitMax,
});
const retryRateLimiter = createRateLimiter({
  name: 'manual_retry',
  windowMs: env.retryRateLimitWindowMs,
  max: env.retryRateLimitMax,
});

router.post('/visitor', visitorRateLimiter, handleVisitor);
router.get('/system', requireApiAuth, getSystemDetail);
router.get('/stats', requireApiAuth, getStats);
router.get('/visitors', requireApiAuth, listVisitors);
router.get('/orders', requireApiAuth, listOrders);
router.post(
  '/orders/:orderId/retry-callback',
  requireApiAuth,
  retryRateLimiter,
  retryOrderCallback
);
router.get('/matches', requireApiAuth, listMatches);
router.get('/callbacks', requireApiAuth, listCallbacks);
router.get('/webhook-events', requireApiAuth, listWebhookEvents);

module.exports = router;
