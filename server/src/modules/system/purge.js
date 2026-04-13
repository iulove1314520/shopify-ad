const { getDangerousActions } = require('./retention');
const { countTable } = require('./detail');

function purgeAllDataRecords({
  db,
  getDangerousActionsFn = getDangerousActions,
  countTableFn = countTable,
}) {
  const deleteWebhookEventsStmt = db.prepare('DELETE FROM webhook_events');
  const deleteOrdersStmt = db.prepare('DELETE FROM orders');
  const deleteVisitorsStmt = db.prepare('DELETE FROM visitors');

  const purgeTransaction = db.transaction(() => {
    const deleted = {
      visitors: countTableFn(db, 'visitors'),
      orders: countTableFn(db, 'orders'),
      matches: countTableFn(db, 'matches'),
      callbacks: countTableFn(db, 'callbacks'),
      webhook_events: countTableFn(db, 'webhook_events'),
    };

    deleteWebhookEventsStmt.run();
    deleteOrdersStmt.run();
    deleteVisitorsStmt.run();

    return deleted;
  });

  return {
    executed_at: new Date().toISOString(),
    mode: 'purge_all',
    dangerous_actions: getDangerousActionsFn(),
    deleted: purgeTransaction(),
  };
}

module.exports = {
  purgeAllDataRecords,
};
