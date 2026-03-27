const { env, validateEnv } = require('./config/env');
const { db } = require('./db/client');
const { initDatabase } = require('./db/init');
const { createApp } = require('./app');
const { logInfo, logError } = require('./utils/logger');

const configErrors = validateEnv();
if (configErrors.length > 0) {
  for (const message of configErrors) {
    logError('config.invalid', { message });
  }
  process.exit(1);
}

initDatabase();

const app = createApp();
const server = app.listen(env.port, () => {
  logInfo('server.started', {
    port: env.port,
    sqlitePath: env.sqlitePath,
  });
});

function shutdown(signal) {
  logInfo('server.stopping', { signal });
  server.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (error) => {
  logError('process.uncaught_exception', { message: error.message });
});
process.on('unhandledRejection', (reason) => {
  logError('process.unhandled_rejection', { reason: String(reason) });
});
