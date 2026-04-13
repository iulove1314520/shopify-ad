const crypto = require('node:crypto');

function hashBody(rawBody) {
  return crypto.createHash('sha256').update(rawBody).digest('hex');
}

function resolveWebhookId(headers = {}, rawBody = Buffer.from([])) {
  return String(headers['x-shopify-webhook-id'] || '').trim() || hashBody(rawBody);
}

module.exports = {
  hashBody,
  resolveWebhookId,
};
