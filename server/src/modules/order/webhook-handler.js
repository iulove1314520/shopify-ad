async function handleOrdersWebhookRequest({
  req,
  res,
  next,
  env,
  db,
  logError,
  logWarn,
  getTraceId,
  withTraceId,
  processOrderWebhook,
  resolveWebhookId,
  verifyShopifySignature,
  markWebhookEventFailed,
}) {
  const traceId = getTraceId(req);

  if (!env.shopifyWebhookSecret) {
    res.status(503).json({ error: 'SHOPIFY_WEBHOOK_SECRET is not configured' });
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

  try {
    await processOrderWebhook({
      order,
      rawBody,
      headers: req.headers,
      traceId,
    });

    res.status(200).send('ok');
  } catch (error) {
    logError(
      'webhook.processing_failed',
      withTraceId(traceId, {
        message: error.message,
        shopifyOrderId: String(order?.id || '').trim(),
      })
    );

    // 保底: 尝试将 webhook_event 标记为 failed，防止状态卡在 received
    try {
      const webhookId = resolveWebhookId(req.headers, rawBody);

      markWebhookEventFailed(db, {
        webhookId,
        topic: String(req.get('x-shopify-topic') || 'orders/paid').trim(),
        shopifyOrderId: String(order?.id || '').trim(),
        traceId,
        errorMessage: error.message,
      });
    } catch (dbError) {
      logError('webhook.save_failure_failed', {
        message: dbError.message,
      });
    }

    next(error);
  }
}

module.exports = {
  handleOrdersWebhookRequest,
};
