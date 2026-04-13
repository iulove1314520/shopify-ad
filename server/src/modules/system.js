const os = require('node:os');

const { env, getPlatformConfigChecks } = require('../config/env');
const { db } = require('../db/client');

const CLEANUP_RETENTION_MIN_DAYS = 1;
const CLEANUP_RETENTION_MAX_DAYS = 3650;
const PURGE_ALL_CONFIRM_TEXT = '清空全部数据';

const VALID_TABLE_NAMES = new Set([
  'visitors',
  'orders',
  'matches',
  'callbacks',
  'webhook_events',
]);

function assertTableName(name) {
  if (!VALID_TABLE_NAMES.has(name)) {
    throw new Error(`Invalid table name: ${name}`);
  }
}

function countTable(tableName) {
  assertTableName(tableName);
  return db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get().count;
}

function summarizeByStatus(tableName) {
  assertTableName(tableName);
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

function toCutoffIso(days) {
  const normalizedDays = Math.max(0, Number(days) || 0);
  return new Date(Date.now() - normalizedDays * 24 * 60 * 60 * 1000).toISOString();
}

function getRetentionPolicy() {
  return {
    visitors_days: env.visitorRetentionDays,
    business_days: env.businessDataRetentionDays,
  };
}

function getCleanupLimits() {
  return {
    min_days: CLEANUP_RETENTION_MIN_DAYS,
    max_days: CLEANUP_RETENTION_MAX_DAYS,
  };
}

function getDangerousActions() {
  return {
    purge_all_confirm_text: PURGE_ALL_CONFIRM_TEXT,
  };
}

function createBadRequestError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function readRetentionDays(value, fallback, label) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const parsed = Number(value);
  if (
    !Number.isInteger(parsed) ||
    parsed < CLEANUP_RETENTION_MIN_DAYS ||
    parsed > CLEANUP_RETENTION_MAX_DAYS
  ) {
    throw createBadRequestError(
      `${label}需为 ${CLEANUP_RETENTION_MIN_DAYS}-${CLEANUP_RETENTION_MAX_DAYS} 之间的整数天数。`
    );
  }

  return parsed;
}

function resolveCleanupRetentionDays(options = {}) {
  return {
    visitorRetentionDays: readRetentionDays(
      options.visitorRetentionDays,
      env.visitorRetentionDays,
      '访客数据保留天数'
    ),
    businessRetentionDays: readRetentionDays(
      options.businessRetentionDays,
      env.businessDataRetentionDays,
      '业务数据保留天数'
    ),
  };
}

function buildSystemDetail() {
  const databasePing = db.prepare('SELECT 1 AS ok').get();
  const platformChecks = getPlatformConfigChecks();

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
      path: env.nodeEnv === 'production' ? '(hidden)' : env.sqlitePath,
      journal_mode: db.pragma('journal_mode', { simple: true }),
    },
    retention_policy: getRetentionPolicy(),
    cleanup_limits: getCleanupLimits(),
    dangerous_actions: getDangerousActions(),
    tiktok_purchase_mode: env.tiktokPurchaseMode,
    platforms: platformChecks,
    warnings: platformChecks
      .filter((item) => !item.configured)
      .map((item) => `${item.label} 配置不完整：${item.issues.join('、')}`),
  };
}

function cleanupOldDataRecords(options = {}) {
  const retention = resolveCleanupRetentionDays(options);
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
    cleanup_limits: getCleanupLimits(),
    cutoffs: {
      visitors_before: visitorCutoff,
      business_before: businessCutoff,
    },
    deleted: cleanupTransaction(),
  };
}

function assertPurgeAllConfirmation(body = {}) {
  if (body?.confirm !== true) {
    throw createBadRequestError(
      '请在请求体中传入 {"confirm": true}，确认后再清空全部数据。'
    );
  }

  if (String(body?.confirmText || '').trim() !== PURGE_ALL_CONFIRM_TEXT) {
    throw createBadRequestError(
      `清空全部数据前，请输入确认文本：${PURGE_ALL_CONFIRM_TEXT}`
    );
  }
}

function purgeAllDataRecords() {
  const deleteWebhookEventsStmt = db.prepare('DELETE FROM webhook_events');
  const deleteOrdersStmt = db.prepare('DELETE FROM orders');
  const deleteVisitorsStmt = db.prepare('DELETE FROM visitors');

  const purgeTransaction = db.transaction(() => {
    const deleted = {
      visitors: countTable('visitors'),
      orders: countTable('orders'),
      matches: countTable('matches'),
      callbacks: countTable('callbacks'),
      webhook_events: countTable('webhook_events'),
    };

    deleteWebhookEventsStmt.run();
    deleteOrdersStmt.run();
    deleteVisitorsStmt.run();

    return deleted;
  });

  return {
    executed_at: new Date().toISOString(),
    mode: 'purge_all',
    dangerous_actions: getDangerousActions(),
    deleted: purgeTransaction(),
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

function cleanupOldData(req, res, next) {
  try {
    if (req.body?.confirm !== true) {
      res.status(400).json({
        error: 'Bad Request',
        message: '请在请求体中传入 {"confirm": true}，确认后再清理旧数据。',
      });
      return;
    }

    const retention = resolveCleanupRetentionDays({
      visitorRetentionDays: req.body?.visitorRetentionDays,
      businessRetentionDays: req.body?.businessRetentionDays,
    });
    const result = cleanupOldDataRecords(retention);
    res.json({
      ok: true,
      message: '旧数据清理完成。',
      result,
    });
  } catch (error) {
    if (error.statusCode === 400) {
      res.status(400).json({
        error: 'Bad Request',
        message: error.message,
      });
      return;
    }

    next(error);
  }
}

function purgeAllData(req, res, next) {
  try {
    assertPurgeAllConfirmation(req.body);

    const result = purgeAllDataRecords();
    res.json({
      ok: true,
      message: '全部数据已清空。',
      result,
    });
  } catch (error) {
    if (error.statusCode === 400) {
      res.status(400).json({
        error: 'Bad Request',
        message: error.message,
      });
      return;
    }

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
  buildSystemDetail,
  getHealth,
  getSystemDetail,
  getStats,
  cleanupOldData,
  cleanupOldDataRecords,
  purgeAllData,
  purgeAllDataRecords,
  resolveCleanupRetentionDays,
  assertPurgeAllConfirmation,
};
