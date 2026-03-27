const crypto = require('node:crypto');

const { env } = require('../config/env');

function readProvidedToken(req) {
  const bearerToken = (req.get('authorization') || '')
    .replace(/^Bearer\s+/i, '')
    .trim();
  const headerToken = (req.get('x-api-token') || '').trim();

  return bearerToken || headerToken;
}

function tokensMatch(expected, provided) {
  if (!expected || !provided) {
    return false;
  }

  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);

  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
}

function requireApiAuth(req, res, next) {
  if (!env.apiAuthToken) {
    next();
    return;
  }

  const providedToken = readProvidedToken(req);

  if (!tokensMatch(env.apiAuthToken, providedToken)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  next();
}

module.exports = { requireApiAuth };
