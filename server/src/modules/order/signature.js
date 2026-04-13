const crypto = require('node:crypto');

function verifyShopifySignature(rawBody, signature, secret) {
  if (!secret || !signature) {
    return false;
  }

  const digest = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('base64');

  const expected = Buffer.from(signature);
  const actual = Buffer.from(digest);

  if (expected.length !== actual.length) {
    return false;
  }

  return crypto.timingSafeEqual(expected, actual);
}

module.exports = {
  verifyShopifySignature,
};
