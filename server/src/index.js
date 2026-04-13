const { env, validateEnv, getPlatformConfigChecks } = require('./config/env');
const { installMaintenanceJobs } = require('./bootstrap/maintenance-jobs');
const {
  installShutdownHandlers,
  startHttpServer,
} = require('./bootstrap/server-lifecycle');
const { db } = require('./db/client');
const { initDatabase } = require('./db/init');
const { createApp } = require('./app');
const { pruneVisitors } = require('./modules/visitor');
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
const server = startHttpServer({
  app,
  port: env.port,
  db,
  sqlitePath: env.sqlitePath,
  logInfo,
  logError,
});
const cleanupMaintenanceJobs = installMaintenanceJobs({
  db,
  pruneVisitors,
  logError,
});

installShutdownHandlers({
  server,
  db,
  cleanup: cleanupMaintenanceJobs,
  logInfo,
  logWarn,
  logError,
});
