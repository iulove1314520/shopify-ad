const os = require('node:os');

const { env, getPlatformConfigChecks } = require('../../config/env');
const { db } = require('../../db/client');
const {
  getCleanupLimits,
  getDangerousActions,
  getRetentionPolicy,
} = require('./retention');

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

function countTable(dbClient, tableName) {
  assertTableName(tableName);
  return dbClient.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get().count;
}

function summarizeByStatus(dbClient, tableName) {
  assertTableName(tableName);
  return dbClient
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

function buildSystemDetail({
  dbClient = db,
  env: runtimeEnv = env,
  getPlatformConfigChecksFn = getPlatformConfigChecks,
  osModule = os,
  processRef = process,
} = {}) {
  const databasePing = dbClient.prepare('SELECT 1 AS ok').get();
  const platformChecks = getPlatformConfigChecksFn();

  return {
    ok: databasePing.ok === 1,
    service: 'shopee-cpas-backend',
    environment: runtimeEnv.nodeEnv,
    timestamp: new Date().toISOString(),
    uptime_seconds: Math.floor(processRef.uptime()),
    process: {
      pid: processRef.pid,
      hostname: osModule.hostname(),
    },
    database: {
      reachable: true,
      path: runtimeEnv.nodeEnv === 'production' ? '(hidden)' : runtimeEnv.sqlitePath,
      journal_mode: dbClient.pragma('journal_mode', { simple: true }),
    },
    retention_policy: getRetentionPolicy(runtimeEnv),
    cleanup_limits: getCleanupLimits(),
    dangerous_actions: getDangerousActions(),
    tiktok_purchase_mode: runtimeEnv.tiktokPurchaseMode,
    platforms: platformChecks,
    warnings: platformChecks
      .filter((item) => !item.configured)
      .map((item) => `${item.label} 配置不完整：${item.issues.join('、')}`),
  };
}

module.exports = {
  buildSystemDetail,
  countTable,
  summarizeByStatus,
};
