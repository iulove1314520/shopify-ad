const os = require('node:os');

const { env } = require('../config/env');
const { db } = require('../db/client');

function countTable(tableName) {
  return db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get().count;
}

function summarizeByStatus(tableName) {
  return db
    .prepare(
      `
        SELECT status, COUNT(*) AS count
        FROM ${tableName}
        GROUP BY status
        ORDER BY count DESC, status ASC
      `
    )
    .all();
}

function buildSystemDetail() {
  const databasePing = db.prepare('SELECT 1 AS ok').get();

  return {
    ok: databasePing.ok === 1,
    service: 'shopee-cpas-backend',
    environment: env.nodeEnv,
    timestamp: new Date().toISOString(),
    uptime_seconds: Math.floor(process.uptime()),
    process: {
      pid: process.pid,
      hostname: os.hostname(),
    },
    database: {
      reachable: true,
      path: env.sqlitePath,
      journal_mode: db.pragma('journal_mode', { simple: true }),
    },
  };
}

function getHealth(req, res, next) {
  try {
    const detail = buildSystemDetail();

    res.json({
      ok: detail.ok,
      service: detail.service,
      environment: detail.environment,
      timestamp: detail.timestamp,
    });
  } catch (error) {
    next(error);
  }
}

function getSystemDetail(req, res, next) {
  try {
    res.json(buildSystemDetail());
  } catch (error) {
    next(error);
  }
}

function getStats(req, res, next) {
  try {
    res.json({
      generated_at: new Date().toISOString(),
      counts: {
        visitors: countTable('visitors'),
        orders: countTable('orders'),
        matches: countTable('matches'),
        callbacks: countTable('callbacks'),
        webhook_events: countTable('webhook_events'),
      },
      orders_by_status: summarizeByStatus('orders'),
      callbacks_by_status: summarizeByStatus('callbacks'),
      webhook_events_by_status: summarizeByStatus('webhook_events'),
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getHealth,
  getSystemDetail,
  getStats,
};
