const PRUNE_INTERVAL_MS = 60 * 60 * 1000;
const WAL_CHECKPOINT_INTERVAL_MS = 5 * 60 * 1000;

function safeUnref(timer) {
  if (timer && typeof timer.unref === 'function') {
    timer.unref();
  }
}

function installMaintenanceJobs({
  db,
  pruneVisitors,
  logError,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
}) {
  const pruneTimer = setIntervalFn(() => {
    try {
      pruneVisitors();
    } catch (error) {
      logError('prune.visitors_failed', { message: error.message });
    }
  }, PRUNE_INTERVAL_MS);
  safeUnref(pruneTimer);

  try {
    pruneVisitors();
  } catch (error) {
    logError('prune.visitors_initial_failed', { message: error.message });
  }

  const walCheckpointTimer = setIntervalFn(() => {
    try {
      db.pragma('wal_checkpoint(TRUNCATE)');
    } catch (error) {
      logError('wal.checkpoint_failed', { message: error.message });
    }
  }, WAL_CHECKPOINT_INTERVAL_MS);
  safeUnref(walCheckpointTimer);

  return () => {
    clearIntervalFn(pruneTimer);
    clearIntervalFn(walCheckpointTimer);
  };
}

module.exports = {
  installMaintenanceJobs,
  __internal: {
    PRUNE_INTERVAL_MS,
    WAL_CHECKPOINT_INTERVAL_MS,
  },
};
