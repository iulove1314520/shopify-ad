function createProcessOrderWebhook({
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
}) {
  return async function processOrderWebhook({
    order,
    rawBody,
    headers,
    traceId = '',
  }) {
    const webhookId = resolveWebhookId(headers, rawBody);
    const topic = String(headers['x-shopify-topic'] || 'orders/paid').trim();
    const shopifyOrderId = String(order.id || '').trim();

    if (!shopifyOrderId) {
      saveWebhookEvent(db, {
        webhookId,
        topic,
        shopifyOrderId: '',
        traceId,
        status: 'failed',
        errorMessage: 'Missing Shopify order id',
      });
      throw new Error('Missing Shopify order id');
    }

    const processingState = tryStartWebhookProcessing(db, {
      webhookId,
      topic,
      shopifyOrderId,
      traceId,
    });

    if (!processingState.shouldProcess) {
      logInfo(
        'webhook.duplicate_ignored',
        withTraceId(traceId, {
          webhookId,
          shopifyOrderId,
          reason: processingState.duplicateReason || 'webhook_locked',
          status: processingState.status || '',
        })
      );
      return {
        duplicate: true,
        reason: processingState.duplicateReason || 'webhook_locked',
        traceId,
      };
    }

    const orderRecord = upsertOrder(db, order, rawBody, traceId);
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
        db,
        orderRecord.id,
        'ignored_pending',
        'financial_status_pending',
        traceId
      );

      saveWebhookEvent(db, {
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

    if (hasSuccessfulCallback(db, shopifyOrderId)) {
      updateOrderStatus(
        db,
        orderRecord.id,
        'duplicate_ignored',
        'callback_already_succeeded',
        traceId
      );

      saveWebhookEvent(db, {
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

      saveWebhookEvent(db, {
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
      updateOrderStatus(
        db,
        orderRecord.id,
        'processing_failed',
        error.message,
        traceId
      );

      saveWebhookEvent(db, {
        webhookId,
        topic,
        shopifyOrderId,
        traceId,
        status: 'failed',
        errorMessage: error.message,
      });

      throw error;
    }
  };
}

module.exports = {
  createProcessOrderWebhook,
};
