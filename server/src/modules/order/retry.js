function createRetryOrderCallback({
  db,
  matchOrder,
  logWarn,
  getTraceId,
  withTraceId,
  findOrderByShopifyOrderId,
  hasSuccessfulCallback,
}) {
  return async function retryOrderCallback(req, res, next) {
    try {
      const shopifyOrderId = String(req.params.orderId || '').trim();
      const traceId = getTraceId(req);

      if (!shopifyOrderId) {
        res.status(400).json({ error: 'Missing order id' });
        return;
      }

      const order = findOrderByShopifyOrderId(db, shopifyOrderId);

      if (!order) {
        res.status(404).json({ error: 'Order not found' });
        return;
      }

      if (String(order.financial_status || '').toLowerCase() === 'pending') {
        res.status(409).json({ error: 'Pending orders cannot be retried' });
        return;
      }

      if (hasSuccessfulCallback(db, shopifyOrderId)) {
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
  };
}

module.exports = {
  createRetryOrderCallback,
};
