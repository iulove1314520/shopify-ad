const { db } = require('../db/client');
const { logWarn } = require('./logger');

function normalizeRateLimitKey(value) {
  const text = String(value || '').trim();
  if (!text) {
    return 'unknown';
  }

  return text.slice(0, 255);
}

function ensureRateLimitStore(dbClient) {
  dbClient.exec(`
    CREATE TABLE IF NOT EXISTS rate_limits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      limiter_name TEXT NOT NULL,
      key TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      reset_at INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(limiter_name, key)
    )
  `);
  dbClient.exec(
    'CREATE INDEX IF NOT EXISTS idx_rate_limits_reset_at ON rate_limits(reset_at)'
  );
}

function createRateLimiter({
  name,
  windowMs,
  max,
  keyResolver,
  dbClient = db,
  nowFn = Date.now,
  cleanupIntervalMs = 60000,
  logWarnFn = logWarn,
}) {
  ensureRateLimitStore(dbClient);
  const selectBucketStmt = dbClient.prepare(
    `
      SELECT count, reset_at
      FROM rate_limits
      WHERE limiter_name = ? AND key = ?
      LIMIT 1
    `
  );
  const insertBucketStmt = dbClient.prepare(
    `
      INSERT INTO rate_limits (
        limiter_name,
        key,
        count,
        reset_at,
        updated_at
      ) VALUES (?, ?, 1, ?, CURRENT_TIMESTAMP)
    `
  );
  const resetBucketStmt = dbClient.prepare(
    `
      UPDATE rate_limits
      SET count = 1,
          reset_at = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE limiter_name = ? AND key = ?
    `
  );
  const incrementBucketStmt = dbClient.prepare(
    `
      UPDATE rate_limits
      SET count = count + 1,
          updated_at = CURRENT_TIMESTAMP
      WHERE limiter_name = ? AND key = ?
    `
  );
  const deleteExpiredStmt = dbClient.prepare(
    `
      DELETE FROM rate_limits
      WHERE reset_at <= ?
    `
  );
  const advanceBucketTxn = dbClient.transaction(
    (limiterName, key, now, currentWindowMs) => {
      const current = selectBucketStmt.get(limiterName, key);
      const nextResetAt = now + currentWindowMs;

      if (!current) {
        insertBucketStmt.run(limiterName, key, nextResetAt);
        return {
          count: 1,
          resetAt: nextResetAt,
        };
      }

      if (Number(current.reset_at) <= now) {
        resetBucketStmt.run(nextResetAt, limiterName, key);
        return {
          count: 1,
          resetAt: nextResetAt,
        };
      }

      incrementBucketStmt.run(limiterName, key);
      return {
        count: Number(current.count || 0) + 1,
        resetAt: Number(current.reset_at),
      };
    }
  );
  let lastCleanupAt = 0;

  return (req, res, next) => {
    if (req.method === 'OPTIONS' || !Number.isFinite(max) || max <= 0) {
      next();
      return;
    }

    try {
      const now = nowFn();
      if (now - lastCleanupAt >= cleanupIntervalMs) {
        deleteExpiredStmt.run(now);
        lastCleanupAt = now;
      }

      const key = normalizeRateLimitKey(
        typeof keyResolver === 'function' ? keyResolver(req) : req.ip
      );
      const bucket = advanceBucketTxn(name, key, now, windowMs);
      const remaining = Math.max(0, max - bucket.count);

      res.setHeader('X-RateLimit-Limit', String(max));
      res.setHeader('X-RateLimit-Remaining', String(remaining));
      res.setHeader('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));

      if (bucket.count > max) {
        logWarnFn('rate_limit.exceeded', {
          name,
          key,
          path: req.originalUrl,
          method: req.method,
          ip: req.ip,
        });

        res.status(429).json({
          error: 'Too Many Requests',
          message: '请求过于频繁，请稍后再试。',
        });
        return;
      }
    } catch (error) {
      next(error);
      return;
    }

    next();
  };
}

module.exports = {
  createRateLimiter,
  __internal: {
    ensureRateLimitStore,
    normalizeRateLimitKey,
  },
};
