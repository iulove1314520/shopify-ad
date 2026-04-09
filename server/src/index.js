const { env, validateEnv, getPlatformConfigChecks } = require('./config/env');
const { db } = require('./db/client');
const { initDatabase } = require('./db/init');
const { createApp } = require('./app');
const { logInfo, logWarn, logError } = require('./utils/logger');

const configErrors = validateEnv();
if (configErrors.length > 0) {
  for (const message of configErrors) {
    logError('config.invalid', { message });
  }
  process.exit(1);
}

initDatabase();

for (const platform of getPlatformConfigChecks()) {
  if (!platform.configured) {
    logWarn('config.platform_incomplete', {
      platform: platform.label,
      issues: platform.issues,
    });
  }
}

const app = createApp();
const server = app.listen(env.port, () => {
  logInfo('server.started', {
    port: env.port,
    sqlitePath: env.sqlitePath,
  });
});

// ── 定时清理过期访客（替代原先每次请求都清理的做法）─────────
const { pruneVisitors } = require('./modules/visitor');
const PRUNE_INTERVAL_MS = 60 * 60 * 1000; // 每小时

const pruneTimer = setInterval(() => {
  try {
    pruneVisitors();
  } catch (error) {
    logError('prune.visitors_failed', { message: error.message });
  }
}, PRUNE_INTERVAL_MS);
pruneTimer.unref();

// 启动时也执行一次
try {
  pruneVisitors();
} catch (error) {
  logError('prune.visitors_initial_failed', { message: error.message });
}
// ── End 定时清理 ────────────────────────────────────────────

// ── 定时 WAL checkpoint（防止 WAL 文件无限增长）───────────────
const WAL_CHECKPOINT_INTERVAL_MS = 5 * 60 * 1000; // 每 5 分钟
const walCheckpointTimer = setInterval(() => {
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
  } catch (error) {
    logError('wal.checkpoint_failed', { message: error.message });
  }
}, WAL_CHECKPOINT_INTERVAL_MS);
walCheckpointTimer.unref();
// ── End WAL checkpoint ────────────────────────────────────────

function shutdown(signal) {
  logInfo('server.stopping', { signal });

  // 5 秒后强制退出，防止 keep-alive 连接阻塞关闭
  const forceExitTimer = setTimeout(() => {
    logWarn('server.force_exit', { signal, reason: 'graceful_shutdown_timeout' });
    process.exit(1);
  }, 5000);
  forceExitTimer.unref();

  server.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (error) => {
  logError('process.uncaught_exception', { message: error.message });
  // Node.js 官方: uncaughtException 后进程处于不确定状态，必须退出
  // Docker restart: unless-stopped 会自动重新拉起容器
  setTimeout(() => process.exit(1), 1000);
});
process.on('unhandledRejection', (reason) => {
  logError('process.unhandled_rejection', { reason: String(reason) });
});
