const crypto = require('node:crypto');

const { env } = require('../config/env');

function readProvidedToken(req) {
  const bearerToken = (req.get('authorization') || '')
    .replace(/^Bearer\s+/i, '')
    .trim();
  const headerToken = (req.get('x-api-token') || '').trim();

  return bearerToken || headerToken;
}

function safeEqual(expected, provided) {
  if (!expected || !provided) {
    return false;
  }

  const expectedBuffer = Buffer.from(String(expected));
  const providedBuffer = Buffer.from(String(provided));

  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
}

function requireApiAuth(req, res, next) {
  if (!env.apiAuthToken) {
    res.status(503).json({ error: 'API auth token is not configured' });
    return;
  }

  const providedToken = readProvidedToken(req);

  if (!safeEqual(env.apiAuthToken, providedToken)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  next();
}

function handleLogin(req, res) {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '').trim();

  if (!username || !password) {
    res.status(400).json({ error: '请输入用户名和密码' });
    return;
  }

  if (!env.adminUsername || !env.adminPassword) {
    res.status(503).json({ error: '登录未配置，请联系管理员' });
    return;
  }

  if (!env.apiAuthToken) {
    res.status(503).json({ error: 'API 令牌未配置，请联系管理员' });
    return;
  }

  const usernameMatch = safeEqual(env.adminUsername, username);
  const passwordMatch = safeEqual(env.adminPassword, password);

  if (!usernameMatch || !passwordMatch) {
    res.status(401).json({ error: '用户名或密码错误' });
    return;
  }

  res.json({ ok: true, token: env.apiAuthToken });
}

module.exports = { requireApiAuth, handleLogin };
