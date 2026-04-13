function writeOrderStatus(db, orderId, status, statusReason = '', traceId = '') {
  db.prepare(
    `
      UPDATE orders
      SET status = ?, status_reason = ?, last_trace_id = ?, processed_at = ?
      WHERE id = ?
    `
  ).run(status, statusReason, traceId, new Date().toISOString(), orderId);
}

function resolveMatchedOrderStatus(callbackStatus) {
  if (callbackStatus === 'success') {
    return 'callback_sent';
  }

  if (callbackStatus === 'skipped') {
    return 'matched_no_callback';
  }

  return 'callback_failed';
}

function writeUnmatchedOrderStatus(db, orderId, statusReason, traceId = '') {
  writeOrderStatus(db, orderId, 'unmatched', statusReason, traceId);
}

function writeMatchedOrderStatus(
  db,
  orderId,
  callbackStatus,
  statusReason,
  traceId = ''
) {
  writeOrderStatus(
    db,
    orderId,
    resolveMatchedOrderStatus(callbackStatus),
    statusReason,
    traceId
  );
}

module.exports = {
  resolveMatchedOrderStatus,
  writeMatchedOrderStatus,
  writeOrderStatus,
  writeUnmatchedOrderStatus,
};
