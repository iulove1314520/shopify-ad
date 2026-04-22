const { db } = require('../db/client');
const { env } = require('../config/env');
const { getRealIp } = require('../utils/ip');
const { resolveLimit } = require('../utils/pagination');
const { classifyVisitorTraffic, isPlaceholderClickId } = require('../utils/traffic-labels');
const { analyzeUserAgent } = require('../utils/user-agent');

const MAX_CLICK_ID_LENGTH = 512;
const MAX_TTP_LENGTH = 256;
const MAX_PRODUCT_ID_LENGTH = 1024;
const MAX_USER_AGENT_LENGTH = 1024;
const MAX_TIMESTAMP_FUTURE_DRIFT_MS = 10 * 60 * 1000;
const MAX_TIMESTAMP_PAST_DRIFT_MS = 30 * 24 * 60 * 60 * 1000;

function toIsoString(value, fallback) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return fallback;
  }

  return date.toISOString();
}

function validateVisitorPayload({
  ttclid,
  fbclid,
  ttp,
  productId,
  userAgent,
  timestamp,
  now = Date.now(),
}) {
  if (ttclid.length > MAX_CLICK_ID_LENGTH) {
    return {
      field: 'ttclid',
      error: `ttclid is too long (max ${MAX_CLICK_ID_LENGTH} chars)`,
    };
  }

  if (fbclid.length > MAX_CLICK_ID_LENGTH) {
    return {
      field: 'fbclid',
      error: `fbclid is too long (max ${MAX_CLICK_ID_LENGTH} chars)`,
    };
  }

  if (ttp.length > MAX_TTP_LENGTH) {
    return {
      field: 'ttp',
      error: `ttp is too long (max ${MAX_TTP_LENGTH} chars)`,
    };
  }

  if (productId.length > MAX_PRODUCT_ID_LENGTH) {
    return {
      field: 'product_id',
      error: `product_id is too long (max ${MAX_PRODUCT_ID_LENGTH} chars)`,
    };
  }

  if (userAgent.length > MAX_USER_AGENT_LENGTH) {
    return {
      field: 'user_agent',
      error: `user_agent is too long (max ${MAX_USER_AGENT_LENGTH} chars)`,
    };
  }

  const rawTimestamp = String(timestamp || '').trim();
  if (rawTimestamp) {
    const parsedMs = new Date(rawTimestamp).getTime();
    if (!Number.isFinite(parsedMs)) {
      return {
        field: 'timestamp',
        error: 'timestamp is invalid',
      };
    }

    if (parsedMs > now + MAX_TIMESTAMP_FUTURE_DRIFT_MS) {
      return {
        field: 'timestamp',
        error: 'timestamp is too far in the future',
      };
    }

    if (parsedMs < now - MAX_TIMESTAMP_PAST_DRIFT_MS) {
      return {
        field: 'timestamp',
        error: 'timestamp is too old',
      };
    }
  }

  return null;
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
    const ttp = String(req.body?.ttp || '').trim();
    const productId = String(req.body?.product_id || '').trim();
    const userAgent = String(
      req.body?.user_agent || req.get('user-agent') || ''
    ).trim();
    const rawTimestamp = req.body?.timestamp;

    const validationIssue = validateVisitorPayload({
      ttclid,
      fbclid,
      ttp,
      productId,
      userAgent,
      timestamp: rawTimestamp,
    });
    if (validationIssue) {
      res.status(400).json({
        success: false,
        error: validationIssue.error,
        field: validationIssue.field,
      });
      return;
    }

    if (!ttclid && !fbclid) {
      res.status(400).json({
        success: false,
        error: 'ttclid or fbclid is required',
      });
      return;
    }

    if (ttclid && isPlaceholderClickId(ttclid)) {
      res.status(400).json({
        success: false,
        error: 'ttclid placeholder is not allowed',
        field: 'ttclid',
      });
      return;
    }

    if (fbclid && isPlaceholderClickId(fbclid)) {
      res.status(400).json({
        success: false,
        error: 'fbclid placeholder is not allowed',
        field: 'fbclid',
      });
      return;
    }

    if (userAgent.includes('UptimeRobot')) {
      res.json({ success: true, filtered: true });
      return;
    }

    const timestamp = toIsoString(rawTimestamp, new Date().toISOString());

    db.prepare(
      `
        INSERT INTO visitors (
          ttclid,
          fbclid,
          ttp,
          ip,
          timestamp,
          product_id,
          user_agent
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `
    ).run(
      ttclid,
      fbclid,
      ttp,
      getRealIp(req),
      timestamp,
      productId,
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
            ttp,
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

    res.json(
      rows.map((row) => {
        const traffic = classifyVisitorTraffic(row);
        const userAgent = analyzeUserAgent(row.user_agent);

        return {
          ...row,
          has_ttp: Boolean(String(row.ttp || '').trim()),
          is_test_traffic: traffic.isTestTraffic,
          traffic_label: traffic.trafficLabel,
          traffic_reason: traffic.trafficReason,
          ua_device: userAgent.device,
          ua_os: userAgent.os,
          ua_browser: userAgent.browser,
          ua_app: userAgent.app,
          ua_summary: userAgent.summary,
          ua_risk: userAgent.risk,
          ua_confidence: userAgent.confidence,
        };
      })
    );
  } catch (error) {
    next(error);
  }
}

module.exports = {
  handleVisitor,
  listVisitors,
  pruneVisitors,
  validateVisitorPayload,
};
