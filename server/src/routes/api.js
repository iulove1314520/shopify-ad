const express = require('express');

const { requireApiAuth } = require('../utils/auth');
const { handleVisitor, listVisitors } = require('../modules/visitor');
const { listMatches, listCallbacks } = require('../modules/match');
const {
  listOrders,
  listWebhookEvents,
  retryOrderCallback,
} = require('../modules/order');
const { getStats } = require('../modules/system');

const router = express.Router();

router.post('/visitor', handleVisitor);
router.get('/stats', requireApiAuth, getStats);
router.get('/visitors', requireApiAuth, listVisitors);
router.get('/orders', requireApiAuth, listOrders);
router.post('/orders/:orderId/retry-callback', requireApiAuth, retryOrderCallback);
router.get('/matches', requireApiAuth, listMatches);
router.get('/callbacks', requireApiAuth, listCallbacks);
router.get('/webhook-events', requireApiAuth, listWebhookEvents);

module.exports = router;
