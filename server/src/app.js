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

function createApp() {
  const app = express();
  const publicDir = path.resolve(__dirname, '../public');
  const uiStaticOptions = {
    etag: false,
    lastModified: false,
    setHeaders(res) {
      res.setHeader(
        'Cache-Control',
        'no-store, no-cache, must-revalidate, proxy-revalidate'
      );
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.setHeader('Surrogate-Control', 'no-store');
    },
  };

  app.disable('x-powered-by');
  // 只信任第一层代理（Nginx / Docker 内网），防止攻击者通过 X-Forwarded-For 伪造 IP
  app.set('trust proxy', 1);
  app.use(attachRequestContext);
  app.use(requestLogger);

  app.use((req, res, next) => {
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

    // 安全头：限制资源加载来源，降低 XSS 攻击面
    res.header(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'"
    );

    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }

    next();
  });

  app.get('/health', getHealth);

  app.use('/webhook', webhookRouter);
  // Webhook 使用独立的 express.raw({ limit: '1mb' })，此处只影响 API 路由
  app.use(express.json({ limit: '100kb' }));
  app.use('/api', apiRouter);
  app.get('/', (req, res) => res.redirect(301, '/ui'));
  app.get('/ui', (req, res) => {
    uiStaticOptions.setHeaders(res);
    res.sendFile(path.join(publicDir, 'index.html'));
  });
  app.use('/ui', express.static(publicDir, uiStaticOptions));

  app.use((req, res) => {
    res.status(404).json({ error: 'Not Found' });
  });

  app.use((error, req, res, next) => {
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
  });

  return app;
}

module.exports = { createApp };
