function saveWebhookEvent(
  db,
  {
    webhookId,
    topic,
    shopifyOrderId,
    traceId = '',
    status,
    errorMessage = '',
  }
) {
  const processedAt = status === 'received' ? null : new Date().toISOString();

  db.prepare(
    `
      INSERT INTO webhook_events (
        webhook_id,
        topic,
        shopify_order_id,
        trace_id,
        signature_valid,
        status,
        error_message,
        processed_at
      ) VALUES (?, ?, ?, ?, 1, ?, ?, ?)
      ON CONFLICT(webhook_id) DO UPDATE SET
        topic = excluded.topic,
        shopify_order_id = excluded.shopify_order_id,
        trace_id = excluded.trace_id,
        signature_valid = 1,
        status = excluded.status,
        error_message = excluded.error_message,
        processed_at = excluded.processed_at
    `
  ).run(
    webhookId,
    topic,
    shopifyOrderId,
    traceId,
    status,
    errorMessage,
    processedAt
  );
}

function tryStartWebhookProcessing(
  db,
  {
    webhookId,
    topic,
    shopifyOrderId,
    traceId = '',
  }
) {
  const processedAt = null;

  const inserted = db.prepare(
    `
      INSERT INTO webhook_events (
        webhook_id,
        topic,
        shopify_order_id,
        trace_id,
        signature_valid,
        status,
        error_message,
        processed_at
      ) VALUES (?, ?, ?, ?, 1, 'processing', '', ?)
      ON CONFLICT(webhook_id) DO NOTHING
    `
  ).run(webhookId, topic, shopifyOrderId, traceId, processedAt);

  if (inserted.changes > 0) {
    return {
      shouldProcess: true,
      status: 'processing',
      duplicateReason: '',
    };
  }

  const current = db.prepare(
    `
      SELECT status
      FROM webhook_events
      WHERE webhook_id = ?
      LIMIT 1
    `
  ).get(webhookId);
  const currentStatus = String(current?.status || '').trim();

  if (currentStatus === 'processed') {
    return {
      shouldProcess: false,
      status: currentStatus,
      duplicateReason: 'webhook_already_processed',
    };
  }

  if (currentStatus === 'processing') {
    return {
      shouldProcess: false,
      status: currentStatus,
      duplicateReason: 'webhook_in_progress',
    };
  }

  if (currentStatus === 'failed' || currentStatus === 'received') {
    const updated = db.prepare(
      `
        UPDATE webhook_events
        SET topic = ?,
            shopify_order_id = ?,
            trace_id = ?,
            signature_valid = 1,
            status = 'processing',
            error_message = '',
            processed_at = NULL
        WHERE webhook_id = ?
          AND status IN ('failed', 'received')
      `
    ).run(topic, shopifyOrderId, traceId, webhookId);

    if (updated.changes > 0) {
      return {
        shouldProcess: true,
        status: 'processing',
        duplicateReason: '',
      };
    }
  }

  return {
    shouldProcess: false,
    status: currentStatus || 'unknown',
    duplicateReason: 'webhook_locked',
  };
}

function markWebhookEventFailed(
  db,
  {
    webhookId,
    topic = 'orders/paid',
    shopifyOrderId = '',
    traceId = '',
    errorMessage = '',
  }
) {
  if (!webhookId) {
    return;
  }

  const existingEvent = db
    .prepare(
      `
        SELECT status
        FROM webhook_events
        WHERE webhook_id = ?
        LIMIT 1
      `
    )
    .get(webhookId);

  if (existingEvent?.status === 'processed') {
    return;
  }

  if (!existingEvent) {
    saveWebhookEvent(db, {
      webhookId,
      topic,
      shopifyOrderId,
      traceId,
      status: 'failed',
      errorMessage,
    });
    return;
  }

  db.prepare(
    `
      UPDATE webhook_events
      SET status = 'failed', error_message = ?, processed_at = ?
      WHERE webhook_id = ? AND status <> 'processed'
    `
  ).run(String(errorMessage || '').slice(0, 300), new Date().toISOString(), webhookId);
}

module.exports = {
  markWebhookEventFailed,
  saveWebhookEvent,
  tryStartWebhookProcessing,
};
