const path = require('node:path');
const express = require('express');

const { env } = require('./config/env');
const apiRouter = require('./routes/api');
const webhookRouter = require('./routes/webhook');
const { getHealth } = require('./modules/system');
const {
  attachRequestContext,
  requestLogger,
  logError,
  getTraceId,
  withTraceId,
} = require('./utils/logger');

// index.html 始终不缓存，确保用户总是拿到最新入口
const HTML_CACHE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
  'Pragma': 'no-cache',
  'Expires': '0',
  'Surrogate-Control': 'no-store',
};
// JS/CSS 等静态资源带版本号 (?v=...)，启用 ETag + 短时缓存
const ASSET_STATIC_OPTIONS = {
  etag: true,
  lastModified: true,
  maxAge: '1h',
  immutable: false,
};

function getRequestOrigin(req) {
  return `${req.protocol}://${req.get('host')}`;
}

function isAllowedOrigin(req, origin) {
  if (!origin) {
    return true;
  }

  if (env.corsAllowOrigins.includes('*')) {
    return true;
  }

  return (
    origin === getRequestOrigin(req) || env.corsAllowOrigins.includes(origin)
  );
}

function applyCorsAndSecurityHeaders(req, res, next) {
  const origin = String(req.get('origin') || '').trim();

  res.header(
    'Access-Control-Allow-Headers',
    'Authorization, Content-Type, X-API-Token'
  );
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.header('Vary', 'Origin');

  if (origin) {
    if (!isAllowedOrigin(req, origin)) {
      res.status(403).json({ error: 'Origin not allowed' });
      return;
    }

    res.header('Access-Control-Allow-Origin', origin);
  }

  // 安全头：降低 XSS / 点击劫持 / MIME 嗅探攻击面
  res.header(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'"
  );
  res.header('X-Content-Type-Options', 'nosniff');
  res.header('X-Frame-Options', 'DENY');
  res.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }

  next();
}

function createUiHandler(publicDir) {
  return function handleUi(req, res) {
    for (const [key, value] of Object.entries(HTML_CACHE_HEADERS)) {
      res.setHeader(key, value);
    }

    res.sendFile(path.join(publicDir, 'index.html'));
  };
}

function handleNotFound(req, res) {
  res.status(404).json({ error: 'Not Found' });
}

function handleRequestFailure(error, req, res, next) {
  logError(
    'request.failed',
    withTraceId(getTraceId(req), {
      message: error.message,
      path: req.originalUrl,
    })
  );

  res.status(500).json({
    error: 'Internal Server Error',
    trace_id: getTraceId(req),
  });
}

function createApp() {
  const app = express();
  const publicDir = path.resolve(__dirname, '../public');

  app.disable('x-powered-by');
  // 只信任第一层代理（Nginx / Docker 内网），防止攻击者通过 X-Forwarded-For 伪造 IP
  app.set('trust proxy', 1);
  app.use(attachRequestContext);
  app.use(requestLogger);
  app.use(applyCorsAndSecurityHeaders);

  app.get('/health', getHealth);

  app.use('/webhook', webhookRouter);
  // Webhook 使用独立的 express.raw({ limit: '1mb' })，此处只影响 API 路由
  app.use(express.json({ limit: '100kb' }));
  app.use('/api', apiRouter);
  app.get('/', (req, res) => res.redirect(301, '/ui'));
  app.get('/ui', createUiHandler(publicDir));
  app.use('/ui', express.static(publicDir, ASSET_STATIC_OPTIONS));

  app.use(handleNotFound);
  app.use(handleRequestFailure);

  return app;
}

module.exports = { createApp };
