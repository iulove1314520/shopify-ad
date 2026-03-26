const { env } = require('../config/env');

function resolveLimit(value, fallback = env.defaultListLimit) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(parsed, env.maxListLimit);
}

module.exports = { resolveLimit };

