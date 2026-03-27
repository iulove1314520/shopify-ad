const geoip = require('geoip-lite');

const { env } = require('../config/env');
const { db } = require('../db/client');
const { sleep } = require('../services/callback-utils');
const { sendToTikTok } = require('../services/tiktok');
const { sendToFacebook } = require('../services/facebook');
const { logInfo, logWarn, logError } = require('../utils/logger');
const { resolveLimit } = require('../utils/pagination');

function sanitizeReasonValue(value) {
  return String(value || '')
    .replace(/[;\r\n]+/g, ', ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

function getConfidence(timeDiffMs, ip) {
  let confidence = '低';

  if (timeDiffMs < 24 * 60 * 60 * 1000) {
    confidence = '高';
  } else if (timeDiffMs < 48 * 60 * 60 * 1000) {
    confidence = '中';
  }

  const geo = ip ? geoip.lookup(ip) : null;
  if (!geo && confidence === '高') {
    confidence = '中';
  }

  return confidence;
}

function buildUnmatchedReason(totalVisitorsInWindow, eligibleVisitorCount) {
  if (totalVisitorsInWindow === 0) {
    return 'no_visitors_in_window';
  }

  if (eligibleVisitorCount === 0) {
    return 'visitors_missing_click_id';
  }

  return 'no_valid_match_candidate';
}

function buildMatchedStatusReason(platform, confidence, callbackResult) {
  const parts = [
    `matched_platform=${String(platform || '').toLowerCase()}`,
    `confidence=${confidence}`,
    `callback=${callbackResult.status}`,
    `attempt=${callbackResult.attemptNumber}`,
  ];

  if (callbackResult.failureCode) {
    parts.push(`failure_code=${callbackResult.failureCode}`);
  }

  if (Number.isFinite(callbackResult.httpStatus)) {
    parts.push(`http_status=${callbackResult.httpStatus}`);
  }

  if (callbackResult.retryable) {
    parts.push('retryable=true');
  }

  if (callbackResult.errorMessage) {
    parts.push(`error=${sanitizeReasonValue(callbackResult.errorMessage)}`);
  }

  return parts.join(';');
}

function findBestVisitor(orderCreatedAt) {
  const orderTime = new Date(orderCreatedAt).getTime();
  const windowStart = new Date(
    orderTime - env.matchWindowDays * 24 * 60 * 60 * 1000
  ).toISOString();

  const totalVisitorsInWindow = db
    .prepare(
      `
        SELECT COUNT(*) AS count
        FROM visitors
        WHERE timestamp >= ? AND timestamp <= ?
      `
    )
    .get(windowStart, orderCreatedAt).count;

  const candidates = db
    .prepare(
      `
        SELECT
          id,
          ttclid,
          fbclid,
          ip,
          timestamp,
          product_id
        FROM visitors
        WHERE
          (ttclid <> '' OR fbclid <> '')
          AND timestamp >= ?
          AND timestamp <= ?
        ORDER BY timestamp DESC
      `
    )
    .all(windowStart, orderCreatedAt);

  const eligibleVisitorCount = candidates.length;
  let bestVisitor = null;
  let bestTimeDiffMs = Number.POSITIVE_INFINITY;

  for (const visitor of candidates) {
    const timeDiffMs = orderTime - new Date(visitor.timestamp).getTime();
    if (timeDiffMs < 0 || timeDiffMs > bestTimeDiffMs) {
      continue;
    }

    bestVisitor = visitor;
    bestTimeDiffMs = timeDiffMs;
  }

  if (!bestVisitor) {
    return {
      matched: false,
      reason: buildUnmatchedReason(totalVisitorsInWindow, eligibleVisitorCount),
      totalVisitorsInWindow,
      eligibleVisitorCount,
    };
  }

  return {
    matched: true,
    visitor: bestVisitor,
    timeDiffMs: bestTimeDiffMs,
    totalVisitorsInWindow,
    eligibleVisitorCount,
  };
}

function getExistingMatch(orderId) {
  return db
    .prepare(
      `
        SELECT
          visitor_id,
          click_id,
          platform,
          confidence,
          time_diff_seconds
        FROM matches
        WHERE order_id = ?
        LIMIT 1
      `
    )
    .get(orderId);
}

function upsertMatch(order, bestVisitor, clickId, platform, confidence, timeDiffMs) {
  db.prepare(
    `
      INSERT INTO matches (
        order_id,
        visitor_id,
        shopify_order_id,
        click_id,
        platform,
        confidence,
        match_time,
        time_diff_seconds
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(order_id) DO UPDATE SET
        visitor_id = excluded.visitor_id,
        shopify_order_id = excluded.shopify_order_id,
        click_id = excluded.click_id,
        platform = excluded.platform,
        confidence = excluded.confidence,
        match_time = excluded.match_time,
        time_diff_seconds = excluded.time_diff_seconds
    `
  ).run(
    order.id,
    bestVisitor.id,
    order.shopify_order_id,
    clickId,
    platform,
    confidence,
    new Date().toISOString(),
    Math.round(timeDiffMs / 1000)
  );
}

function getNextAttemptNumber(orderId, platform) {
  const row = db
    .prepare(
      `
        SELECT COALESCE(MAX(attempt_number), 0) AS max_attempt
        FROM callbacks
        WHERE order_id = ? AND platform = ?
      `
    )
    .get(orderId, platform);

  return Number(row?.max_attempt || 0) + 1;
}

function saveCallback(order, callbackResult, triggerSource) {
  db.prepare(
    `
      INSERT INTO callbacks (
        order_id,
        shopify_order_id,
        platform,
        trigger_source,
        attempt_number,
        status,
        retryable,
        http_status,
        request_summary,
        response_summary,
        error_message,
        callback_time
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    order.id,
    order.shopify_order_id,
    callbackResult.platform,
    triggerSource,
    callbackResult.attemptNumber,
    callbackResult.status,
    callbackResult.retryable ? 1 : 0,
    callbackResult.httpStatus,
    callbackResult.requestSummary || '',
    callbackResult.responseSummary || '',
    callbackResult.errorMessage || '',
    new Date().toISOString()
  );
}

async function dispatchCallback(order, platform, clickId, triggerSource) {
  const sender = platform === 'TikTok' ? sendToTikTok : sendToFacebook;
  const maxAttempts = Math.max(1, env.callbackMaxAttempts);
  let finalResult = null;

  for (let index = 0; index < maxAttempts; index += 1) {
    const rawResult = await sender(order, clickId);
    const callbackResult = {
      ...rawResult,
      attemptNumber: getNextAttemptNumber(order.id, platform),
    };

    saveCallback(order, callbackResult, triggerSource);
    finalResult = callbackResult;

    const logDetails = {
      orderId: order.shopify_order_id,
      platform,
      triggerSource,
      attemptNumber: callbackResult.attemptNumber,
      status: callbackResult.status,
      retryable: callbackResult.retryable,
      httpStatus: callbackResult.httpStatus,
      failureCode: callbackResult.failureCode || '',
    };

    if (callbackResult.status === 'success') {
      logInfo('callback.sent', logDetails);
      break;
    }

    if (callbackResult.status === 'skipped') {
      logWarn('callback.skipped', {
        ...logDetails,
        reason: callbackResult.errorMessage,
      });
      break;
    }

    logWarn('callback.failed', {
      ...logDetails,
      errorMessage: callbackResult.errorMessage,
    });

    if (!callbackResult.retryable || index === maxAttempts - 1) {
      break;
    }

    await sleep(env.callbackRetryDelayMs);
  }

  return finalResult;
}

async function matchOrder(order, options = {}) {
  const triggerSource = options.triggerSource || 'webhook';
  let match = getExistingMatch(order.id);
  let platform;
  let clickId;
  let confidence;

  if (!match) {
    const bestMatch = findBestVisitor(order.created_at);

    if (!bestMatch.matched) {
      const reason = `${bestMatch.reason};total_visitors=${bestMatch.totalVisitorsInWindow};eligible_visitors=${bestMatch.eligibleVisitorCount}`;

      db.prepare(
        'UPDATE orders SET status = ?, status_reason = ?, processed_at = ? WHERE id = ?'
      ).run('unmatched', reason, new Date().toISOString(), order.id);

      logInfo('order.unmatched', {
        orderId: order.shopify_order_id,
        reason: bestMatch.reason,
        eligibleVisitors: bestMatch.eligibleVisitorCount,
        totalVisitors: bestMatch.totalVisitorsInWindow,
        triggerSource,
      });

      return { matched: false, reason };
    }

    platform = bestMatch.visitor.ttclid ? 'TikTok' : 'Facebook';
    clickId = bestMatch.visitor.ttclid || bestMatch.visitor.fbclid;
    confidence = getConfidence(bestMatch.timeDiffMs, bestMatch.visitor.ip);

    upsertMatch(
      order,
      bestMatch.visitor,
      clickId,
      platform,
      confidence,
      bestMatch.timeDiffMs
    );
  } else {
    platform = match.platform;
    clickId = match.click_id;
    confidence = match.confidence;
  }

  const callbackResult = await dispatchCallback(
    order,
    platform,
    clickId,
    triggerSource
  );

  if (!callbackResult) {
    const error = new Error('Callback result is empty');

    logError('callback.empty_result', {
      orderId: order.shopify_order_id,
      platform,
      triggerSource,
    });

    throw error;
  }

  let nextStatus = 'callback_failed';
  if (callbackResult.status === 'success') {
    nextStatus = 'callback_sent';
  } else if (callbackResult.status === 'skipped') {
    nextStatus = 'matched_no_callback';
  }

  const statusReason = buildMatchedStatusReason(
    platform,
    confidence,
    callbackResult
  );

  db.prepare(
    'UPDATE orders SET status = ?, status_reason = ?, processed_at = ? WHERE id = ?'
  ).run(nextStatus, statusReason, new Date().toISOString(), order.id);

  return {
    matched: true,
    platform,
    confidence,
    callbackStatus: callbackResult.status,
    failureCode: callbackResult.failureCode || '',
    attemptsUsed: callbackResult.attemptNumber,
  };
}

function listMatches(req, res, next) {
  try {
    const rows = db
      .prepare(
        `
          SELECT
            shopify_order_id AS order_id,
            click_id,
            platform,
            confidence,
            match_time,
            time_diff_seconds
          FROM matches
          ORDER BY match_time DESC
          LIMIT ?
        `
      )
      .all(resolveLimit(req.query.limit));

    res.json(rows);
  } catch (error) {
    next(error);
  }
}

function listCallbacks(req, res, next) {
  try {
    const rows = db
      .prepare(
        `
          SELECT
            shopify_order_id AS order_id,
            platform,
            trigger_source,
            attempt_number,
            status,
            retryable,
            http_status,
            request_summary,
            response_summary,
            error_message,
            callback_time
          FROM callbacks
          ORDER BY callback_time DESC
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
  matchOrder,
  listMatches,
  listCallbacks,
};
