function safeUnref(timer) {
  if (timer && typeof timer.unref === 'function') {
    timer.unref();
  }
}

function startHttpServer({
  app,
  port,
  db,
  sqlitePath,
  logInfo,
  logError,
  exit = process.exit,
}) {
  const server = app.listen(port);

  server.on('listening', () => {
    logInfo('server.started', {
      port,
      sqlitePath,
    });
  });

  server.on('error', (error) => {
    logError('server.start_failed', {
      port,
      code: error.code || '',
      message: error.message,
    });

    try {
      db.close();
    } catch (closeError) {
      logError('server.start_failed_db_close', {
        message: closeError.message,
      });
    }

    exit(1);
  });

  return server;
}

function installShutdownHandlers({
  server,
  db,
  cleanup = () => {},
  logInfo,
  logWarn,
  logError,
  processRef = process,
  exit = process.exit,
  forceExitDelayMs = 5000,
  setTimeoutFn = setTimeout,
}) {
  function shutdown(signal) {
    logInfo('server.stopping', { signal });

    const forceExitTimer = setTimeoutFn(() => {
      logWarn('server.force_exit', {
        signal,
        reason: 'graceful_shutdown_timeout',
      });
      exit(1);
    }, forceExitDelayMs);
    safeUnref(forceExitTimer);

    server.close(() => {
      try {
        cleanup();
      } catch (cleanupError) {
        logError('server.cleanup_failed', {
          message: cleanupError.message,
        });
      }

      db.close();
      exit(0);
    });
  }

  const onSigInt = () => shutdown('SIGINT');
  const onSigTerm = () => shutdown('SIGTERM');
  const onUncaughtException = (error) => {
    logError('process.uncaught_exception', { message: error.message });
    safeUnref(setTimeoutFn(() => exit(1), 1000));
  };
  const onUnhandledRejection = (reason) => {
    logError('process.unhandled_rejection', { reason: String(reason) });
  };

  processRef.on('SIGINT', onSigInt);
  processRef.on('SIGTERM', onSigTerm);
  processRef.on('uncaughtException', onUncaughtException);
  processRef.on('unhandledRejection', onUnhandledRejection);

  return () => {
    if (typeof processRef.off === 'function') {
      processRef.off('SIGINT', onSigInt);
      processRef.off('SIGTERM', onSigTerm);
      processRef.off('uncaughtException', onUncaughtException);
      processRef.off('unhandledRejection', onUnhandledRejection);
    }
  };
}

module.exports = {
  installShutdownHandlers,
  startHttpServer,
};
