const { env } = require('../config/env');

function requireApiAuth(req, res, next) {
  if (!env.apiAuthToken) {
    next();
    return;
  }

  const bearerToken = (req.get('authorization') || '')
    .replace(/^Bearer\s+/i, '')
    .trim();
  const headerToken = (req.get('x-api-token') || '').trim();
  const providedToken = bearerToken || headerToken;

  if (providedToken !== env.apiAuthToken) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  next();
}

module.exports = { requireApiAuth };

