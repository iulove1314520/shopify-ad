function getRealIp(req) {
  const trustedIp = String(req.ip || '').trim();
  if (trustedIp) {
    return trustedIp;
  }

  return req.socket?.remoteAddress || '';
}

module.exports = { getRealIp };
