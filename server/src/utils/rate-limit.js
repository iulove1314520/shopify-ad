const { logWarn } = require('./logger');

function createRateLimiter({ name, windowMs, max, keyResolver }) {
  const buckets = new Map();

  function cleanup(now) {
    for (const [key, bucket] of buckets.entries()) {
      if (bucket.resetAt <= now) {
        buckets.delete(key);
      }
    }
  }

  return (req, res, next) => {
    if (req.method === 'OPTIONS' || !Number.isFinite(max) || max <= 0) {
      next();
      return;
    }

    const now = Date.now();
    if (buckets.size > 5000) {
      cleanup(now);
    }

    const key =
      (typeof keyResolver === 'function' ? keyResolver(req) : req.ip) ||
      'unknown';
    const current = buckets.get(key);
    const bucket =
      current && current.resetAt > now
        ? current
        : {
            count: 0,
            resetAt: now + windowMs,
          };

    bucket.count += 1;
    buckets.set(key, bucket);

    const remaining = Math.max(0, max - bucket.count);
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > max) {
      logWarn('rate_limit.exceeded', {
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

    next();
  };
}

module.exports = { createRateLimiter };
