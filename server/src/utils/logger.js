const crypto = require('node:crypto');

function normalizeTraceId(value) {
  const text = String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9:_-]/g, '')
    .slice(0, 64);

  return text;
}

function createTraceId() {
  return crypto.randomUUID().replace(/-/g, '');
}

function getTraceId(req) {
  return String(req?.context?.traceId || '').trim();
}

function withTraceId(traceId, details = {}) {
  if (!traceId) {
    return details;
  }

  return {
    traceId,
    ...details,
  };
}

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

function attachRequestContext(req, res, next) {
  const incomingTraceId = normalizeTraceId(
    req.get('x-request-id') || req.get('x-correlation-id')
  );
  const traceId = incomingTraceId || createTraceId();

  req.context = {
    ...(req.context || {}),
    traceId,
  };

  res.setHeader('X-Request-Id', traceId);
  next();
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
    logInfo(
      'request.completed',
      withTraceId(getTraceId(req), {
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt,
      ip: req.ip,
      })
    );
  });

  next();
}

module.exports = {
  attachRequestContext,
  createTraceId,
  getTraceId,
  logInfo,
  logWarn,
  logError,
  requestLogger,
  withTraceId,
};
