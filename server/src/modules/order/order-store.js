function updateOrderStatus(db, orderId, status, statusReason = '', traceId = '') {
  db.prepare(
    `
      UPDATE orders
      SET status = ?, status_reason = ?, last_trace_id = ?, processed_at = ?
      WHERE id = ?
    `
  ).run(status, statusReason, traceId, new Date().toISOString(), orderId);
}

function upsertOrder(db, order, rawBody, traceId = '') {
  const shopifyOrderId = String(order.id || '').trim();

  db.prepare(
    `
      INSERT INTO orders (
        shopify_order_id,
        created_at,
        total_price,
        currency,
        zip,
        financial_status,
        raw_payload,
        status,
        last_trace_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(shopify_order_id) DO UPDATE SET
        created_at = excluded.created_at,
        total_price = excluded.total_price,
        currency = excluded.currency,
        zip = excluded.zip,
        financial_status = excluded.financial_status,
        raw_payload = excluded.raw_payload,
        last_trace_id = excluded.last_trace_id
    `
  ).run(
    shopifyOrderId,
    String(order.created_at || new Date().toISOString()),
    Number(order.total_price || 0),
    String(order.currency || 'IDR'),
    String(order.shipping_address?.zip || ''),
    String(order.financial_status || ''),
    rawBody.toString('utf8'),
    'received',
    traceId
  );

  return findOrderByShopifyOrderId(db, shopifyOrderId);
}

function hasSuccessfulCallback(db, shopifyOrderId) {
  const row = db
    .prepare(
      `
        SELECT id
        FROM callbacks
        WHERE shopify_order_id = ? AND status = 'success'
        LIMIT 1
      `
    )
    .get(shopifyOrderId);

  return Boolean(row);
}

function findOrderByShopifyOrderId(db, shopifyOrderId) {
  return db
    .prepare('SELECT * FROM orders WHERE shopify_order_id = ? LIMIT 1')
    .get(shopifyOrderId);
}

module.exports = {
  findOrderByShopifyOrderId,
  hasSuccessfulCallback,
  updateOrderStatus,
  upsertOrder,
};
