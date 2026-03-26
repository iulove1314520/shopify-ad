function write(level, message, details = {}) {
  const payload = {
    time: new Date().toISOString(),
    level,
    message,
  };

  if (Object.keys(details).length > 0) {
    payload.details = details;
  }

  const line = JSON.stringify(payload);

  if (level === 'error') {
    console.error(line);
    return;
  }

  console.log(line);
}

function logInfo(message, details) {
  write('info', message, details);
}

function logWarn(message, details) {
  write('warn', message, details);
}

function logError(message, details) {
  write('error', message, details);
}

function requestLogger(req, res, next) {
  const startedAt = Date.now();

  res.on('finish', () => {
    logInfo('request.completed', {
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt,
      ip: req.ip,
    });
  });

  next();
}

module.exports = {
  logInfo,
  logWarn,
  logError,
  requestLogger,
};

