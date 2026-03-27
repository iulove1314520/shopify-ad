const path = require('node:path');
const express = require('express');

const { env } = require('./config/env');
const apiRouter = require('./routes/api');
const webhookRouter = require('./routes/webhook');
const { getHealth } = require('./modules/system');
const { requestLogger, logError } = require('./utils/logger');

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

  app.disable('x-powered-by');
  app.set('trust proxy', true);
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

    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }

    next();
  });

  app.get('/health', getHealth);

  app.use('/webhook', webhookRouter);
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', apiRouter);
  app.get('/ui', (req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });
  app.use('/ui', express.static(publicDir));

  app.use((req, res) => {
    res.status(404).json({ error: 'Not Found' });
  });

  app.use((error, req, res, next) => {
    logError('request.failed', {
      message: error.message,
      path: req.originalUrl,
    });

    res.status(500).json({ error: 'Internal Server Error' });
  });

  return app;
}

module.exports = { createApp };
