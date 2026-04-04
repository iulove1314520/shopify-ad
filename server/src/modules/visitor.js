const { db } = require('../db/client');
const { env } = require('../config/env');
const { getRealIp } = require('../utils/ip');
const { resolveLimit } = require('../utils/pagination');

function toIsoString(value, fallback) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return fallback;
  }

  return date.toISOString();
}

function pruneVisitors() {
  const cutoff = new Date(
    Date.now() - env.visitorRetentionDays * 24 * 60 * 60 * 1000
  ).toISOString();

  db.prepare('DELETE FROM visitors WHERE timestamp < ?').run(cutoff);
}

function handleVisitor(req, res, next) {
  try {
    const ttclid = String(req.body?.ttclid || '').trim();
    const fbclid = String(req.body?.fbclid || '').trim();
    const userAgent = String(
      req.body?.user_agent || req.get('user-agent') || ''
    ).trim();

    if (!ttclid && !fbclid) {
      res.status(400).json({
        success: false,
        error: 'ttclid or fbclid is required',
      });
      return;
    }

    if (userAgent.includes('UptimeRobot')) {
      res.json({ success: true, filtered: true });
      return;
    }

    const timestamp = toIsoString(req.body?.timestamp, new Date().toISOString());

    db.prepare(
      `
        INSERT INTO visitors (
          ttclid,
          fbclid,
          ip,
          timestamp,
          product_id,
          user_agent
        ) VALUES (?, ?, ?, ?, ?, ?)
      `
    ).run(
      ttclid,
      fbclid,
      getRealIp(req),
      timestamp,
      String(req.body?.product_id || '').trim(),
      userAgent
    );

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
}

function listVisitors(req, res, next) {
  try {
    const rows = db
      .prepare(
        `
          SELECT
            id,
            ttclid,
            fbclid,
            ip,
            timestamp,
            product_id,
            user_agent,
            created_at
          FROM visitors
          ORDER BY timestamp DESC
          LIMIT ?
        `
      )
      .all(resolveLimit(req.query.limit));

    res.json(rows);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  handleVisitor,
  listVisitors,
  pruneVisitors,
};
