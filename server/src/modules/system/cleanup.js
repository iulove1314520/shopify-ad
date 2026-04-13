const { getCleanupLimits, resolveCleanupRetentionDays } = require('./retention');

function toCutoffIso(days) {
  const normalizedDays = Math.max(0, Number(days) || 0);
  return new Date(Date.now() - normalizedDays * 24 * 60 * 60 * 1000).toISOString();
}

function cleanupOldDataRecords({
  db,
  env,
  options = {},
  resolveCleanupRetentionDaysFn = resolveCleanupRetentionDays,
  getCleanupLimitsFn = getCleanupLimits,
}) {
  const retention = resolveCleanupRetentionDaysFn(options, env);
  const visitorCutoff = toCutoffIso(retention.visitorRetentionDays);
  const businessCutoff = toCutoffIso(retention.businessRetentionDays);

  const countVisitorsStmt = db.prepare(
    `
      SELECT COUNT(*) AS count
      FROM visitors
      WHERE datetime(timestamp) < datetime(?)
    `
  );
  const countOrdersStmt = db.prepare(
    `
      SELECT COUNT(*) AS count
      FROM orders
      WHERE datetime(created_at) < datetime(?)
    `
  );
  const countMatchesStmt = db.prepare(
    `
      SELECT COUNT(*) AS count
      FROM matches
      WHERE order_id IN (
        SELECT id
        FROM orders
        WHERE datetime(created_at) < datetime(?)
      )
    `
  );
  const countCallbacksStmt = db.prepare(
    `
      SELECT COUNT(*) AS count
      FROM callbacks
      WHERE order_id IN (
        SELECT id
        FROM orders
        WHERE datetime(created_at) < datetime(?)
      )
    `
  );
  const countWebhookEventsStmt = db.prepare(
    `
      SELECT COUNT(*) AS count
      FROM webhook_events
      WHERE datetime(COALESCE(processed_at, received_at)) < datetime(?)
    `
  );
  const deleteWebhookEventsStmt = db.prepare(
    `
      DELETE FROM webhook_events
      WHERE datetime(COALESCE(processed_at, received_at)) < datetime(?)
    `
  );
  const deleteOrdersStmt = db.prepare(
    `
      DELETE FROM orders
      WHERE datetime(created_at) < datetime(?)
    `
  );
  const deleteVisitorsStmt = db.prepare(
    `
      DELETE FROM visitors
      WHERE datetime(timestamp) < datetime(?)
    `
  );

  const cleanupTransaction = db.transaction(() => {
    const deleted = {
      visitors: countVisitorsStmt.get(visitorCutoff).count,
      orders: countOrdersStmt.get(businessCutoff).count,
      matches: countMatchesStmt.get(businessCutoff).count,
      callbacks: countCallbacksStmt.get(businessCutoff).count,
      webhook_events: countWebhookEventsStmt.get(businessCutoff).count,
    };

    deleteWebhookEventsStmt.run(businessCutoff);
    deleteOrdersStmt.run(businessCutoff);
    deleteVisitorsStmt.run(visitorCutoff);

    return deleted;
  });

  return {
    executed_at: new Date().toISOString(),
    retention_policy: {
      visitors_days: retention.visitorRetentionDays,
      business_days: retention.businessRetentionDays,
    },
    cleanup_limits: getCleanupLimitsFn(),
    cutoffs: {
      visitors_before: visitorCutoff,
      business_before: businessCutoff,
    },
    deleted: cleanupTransaction(),
  };
}

module.exports = {
  cleanupOldDataRecords,
};
