const net = require('node:net');

function normalizeIp(value) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }

  if (text.startsWith('::ffff:')) {
    return text.slice(7);
  }

  return text;
}

function isValidIp(value) {
  return net.isIP(normalizeIp(value)) !== 0;
}

function readHeader(req, name) {
  const normalizedName = String(name || '').toLowerCase();

  if (typeof req?.get === 'function') {
    const value = req.get(normalizedName);
    if (value) {
      return String(value).trim();
    }
  }

  return String(req?.headers?.[normalizedName] || '').trim();
}

function getRealIp(req) {
  const cloudflareIp = normalizeIp(readHeader(req, 'cf-connecting-ip'));
  if (isValidIp(cloudflareIp)) {
    return cloudflareIp;
  }

  const trustedIp = normalizeIp(req?.ip);
  if (isValidIp(trustedIp)) {
    return trustedIp;
  }

  const forwardedFor = readHeader(req, 'x-forwarded-for')
    .split(',')
    .map((part) => normalizeIp(part))
    .find((part) => isValidIp(part));
  if (forwardedFor) {
    return forwardedFor;
  }

  const socketIp = normalizeIp(req?.socket?.remoteAddress);
  if (isValidIp(socketIp)) {
    return socketIp;
  }

  return '';
}

module.exports = { getRealIp };
