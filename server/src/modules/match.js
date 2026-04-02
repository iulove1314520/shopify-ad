const { env } = require('../config/env');
const { db } = require('../db/client');
const { sleep } = require('../services/callback-utils');
const { sendToTikTok } = require('../services/tiktok');
const { sendToFacebook } = require('../services/facebook');
const {
  extractOrderSignals,
  rankVisitorCandidates,
  scoreVisitorCandidate,
} = require('../utils/match-scoring');
const { logInfo, logWarn, logError, withTraceId } = require('../utils/logger');
const { resolveLimit } = require('../utils/pagination');

const MIN_MATCH_SCORE = 25;
const AMBIGUOUS_SCORE_GAP = 8;

function sanitizeReasonValue(value) {
  return String(value || '')
    .replace(/[;\r\n]+/g, ', ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

function buildReasonString(entries) {
  return entries
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}=${sanitizeReasonValue(value)}`)
    .join(';');
}

function buildUnmatchedReason(summary) {
  if (summary.totalVisitorsInWindow === 0) {
    return 'no_visitors_in_window';
  }

  if (summary.eligibleVisitorCount === 0) {
    return 'visitors_missing_click_id';
  }

  if (summary.isAmbiguous) {
    return 'ambiguous_match_candidates';
  }

  if (
    summary.orderProductSignalCount > 0 &&
    summary.candidatesWithProductHint > 0 &&
    summary.productMatchCandidateCount === 0
  ) {
    return 'product_not_matched';
  }

  if (Number.isFinite(summary.bestTimeDiffMs) && summary.bestTimeDiffMs >= 48 * 60 * 60 * 1000) {
    return 'time_gap_too_large';
  }

  if (!Number.isFinite(summary.bestScore) || summary.bestScore < MIN_MATCH_SCORE) {
    return 'score_below_threshold';
  }

  return 'no_valid_match_candidate';
}

function buildUnmatchedStatusReason(result) {
  return buildReasonString([
    ['reason', result.reason],
    ['total_visitors', result.totalVisitorsInWindow],
    ['eligible_visitors', result.eligibleVisitorCount],
    ['product_match_candidates', result.productMatchCandidateCount],
    ['ip_match_candidates', result.ipMatchCandidateCount],
    ['best_score', result.bestScore],
    ['score_gap', result.scoreGap],
  ]);
}

function buildMatchedStatusReason(platform, confidence, callbackResult, matchMeta) {
  return buildReasonString([
    ['matched_platform', String(platform || '').toLowerCase()],
    ['confidence', confidence],
    ['score', matchMeta?.score],
    ['signals', Array.isArray(matchMeta?.signals) ? matchMeta.signals.join(',') : ''],
    ['callback', callbackResult.status],
    ['attempt', callbackResult.attemptNumber],
    ['failure_code', callbackResult.failureCode],
    ['http_status', callbackResult.httpStatus],
    ['retryable', callbackResult.retryable ? 'true' : ''],
    ['error', callbackResult.errorMessage],
  ]);
}

function findBestVisitor(order) {
  const orderTime = new Date(order.created_at).getTime();
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
    .get(windowStart, order.created_at).count;

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
    .all(windowStart, order.created_at);

  const orderSignals = extractOrderSignals(order);
  const rankedCandidates = rankVisitorCandidates(order, candidates);
  const bestCandidate = rankedCandidates[0] || null;
  const secondCandidate = rankedCandidates[1] || null;
  const summary = {
    totalVisitorsInWindow,
    eligibleVisitorCount: candidates.length,
    orderProductSignalCount: orderSignals.productKeys.length,
    productMatchCandidateCount: rankedCandidates.filter((item) => item.productMatched).length,
    ipMatchCandidateCount: rankedCandidates.filter(
      (item) => item.exactIpMatched || item.geoMatched
    ).length,
    candidatesWithProductHint: rankedCandidates.filter(
      (item) => item.visitorHasProductHint
    ).length,
    bestScore: bestCandidate ? bestCandidate.score : null,
    bestTimeDiffMs: bestCandidate ? bestCandidate.timeDiffMs : null,
    scoreGap:
      bestCandidate && secondCandidate
        ? bestCandidate.score - secondCandidate.score
        : null,
    isAmbiguous:
      Boolean(bestCandidate && secondCandidate) &&
      bestCandidate.score < 70 &&
      bestCandidate.score - secondCandidate.score < AMBIGUOUS_SCORE_GAP,
  };

  const unmatchedReason = buildUnmatchedReason(summary);
  if (
    !bestCandidate ||
    summary.isAmbiguous ||
    !Number.isFinite(bestCandidate.score) ||
    bestCandidate.score < MIN_MATCH_SCORE
  ) {
    return {
      matched: false,
      reason: unmatchedReason,
      ...summary,
    };
  }

  return {
    matched: true,
    visitor: bestCandidate.visitor,
    confidence: bestCandidate.confidence,
    score: bestCandidate.score,
    signals: bestCandidate.signals,
    timeDiffMs: bestCandidate.timeDiffMs,
    ...summary,
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
          match_score,
          match_signals,
          time_diff_seconds
        FROM matches
        WHERE order_id = ?
        LIMIT 1
      `
    )
    .get(orderId);
}

function getVisitorById(visitorId) {
  return db
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
        WHERE id = ?
        LIMIT 1
      `
    )
    .get(visitorId);
}

function enrichExistingMatch(order, match) {
  if (
    Number(match?.match_score || 0) > 0 &&
    String(match?.match_signals || '').trim()
  ) {
    return match;
  }

  const visitor = getVisitorById(match?.visitor_id);
  if (!visitor) {
    return match;
  }

  const rescored = scoreVisitorCandidate(order, visitor);
  if (!rescored) {
    return match;
  }

  db.prepare(
    `
      UPDATE matches
      SET confidence = ?, match_score = ?, match_signals = ?, time_diff_seconds = ?
      WHERE order_id = ?
    `
  ).run(
    rescored.confidence,
    rescored.score,
    rescored.signals.join(','),
    Math.round(rescored.timeDiffMs / 1000),
    order.id
  );

  return {
    ...match,
    confidence: rescored.confidence,
    match_score: rescored.score,
    match_signals: rescored.signals.join(','),
    time_diff_seconds: Math.round(rescored.timeDiffMs / 1000),
  };
}

function upsertMatch(
  order,
  bestVisitor,
  clickId,
  platform,
  confidence,
  timeDiffMs,
  matchScore,
  matchSignals
) {
  db.prepare(
    `
      INSERT INTO matches (
        order_id,
        visitor_id,
        shopify_order_id,
        click_id,
        platform,
        confidence,
        match_score,
        match_signals,
        match_time,
        time_diff_seconds
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(order_id) DO UPDATE SET
        visitor_id = excluded.visitor_id,
        shopify_order_id = excluded.shopify_order_id,
        click_id = excluded.click_id,
        platform = excluded.platform,
        confidence = excluded.confidence,
        match_score = excluded.match_score,
        match_signals = excluded.match_signals,
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
    matchScore,
    Array.isArray(matchSignals) ? matchSignals.join(',') : '',
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

function saveCallback(order, callbackResult, triggerSource, traceId = '') {
  db.prepare(
    `
      INSERT INTO callbacks (
        order_id,
        shopify_order_id,
        platform,
        trigger_source,
        trace_id,
        attempt_number,
        status,
        retryable,
        http_status,
        request_summary,
        response_summary,
        error_message,
        callback_time
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    order.id,
    order.shopify_order_id,
    callbackResult.platform,
    triggerSource,
    traceId,
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

function resolveSender(platform, senders = {}) {
  if (typeof senders?.[platform] === 'function') {
    return senders[platform];
  }

  return platform === 'TikTok' ? sendToTikTok : sendToFacebook;
}

async function dispatchCallback(
  order,
  platform,
  clickId,
  triggerSource,
  options = {}
) {
  const sender = resolveSender(platform, options.senders);
  const traceId = String(options.traceId || '').trim();
  const maxAttempts = Math.max(1, env.callbackMaxAttempts);
  const callbackContext = options.callbackContext || {};
  let finalResult = null;

  for (let index = 0; index < maxAttempts; index += 1) {
    const rawResult = await sender(order, clickId, callbackContext);
    const callbackResult = {
      ...rawResult,
      attemptNumber: getNextAttemptNumber(order.id, platform),
    };

    saveCallback(order, callbackResult, triggerSource, traceId);
    finalResult = callbackResult;

    const logDetails = withTraceId(traceId, {
      orderId: order.shopify_order_id,
      platform,
      triggerSource,
      attemptNumber: callbackResult.attemptNumber,
      status: callbackResult.status,
      retryable: callbackResult.retryable,
      httpStatus: callbackResult.httpStatus,
      failureCode: callbackResult.failureCode || '',
    });

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
  const traceId = String(options.traceId || '').trim();
  let match = enrichExistingMatch(order, getExistingMatch(order.id));
  let matchedVisitor = null;
  let platform;
  let clickId;
  let confidence;
  let matchMeta = {
    score: 0,
    signals: [],
  };

  if (!match) {
    const bestMatch = findBestVisitor(order);

    if (!bestMatch.matched) {
      const reason = buildUnmatchedStatusReason(bestMatch);

      db.prepare(
        `
          UPDATE orders
          SET status = ?, status_reason = ?, last_trace_id = ?, processed_at = ?
          WHERE id = ?
        `
      ).run('unmatched', reason, traceId, new Date().toISOString(), order.id);

      logInfo(
        'order.unmatched',
        withTraceId(traceId, {
          orderId: order.shopify_order_id,
          reason: bestMatch.reason,
          bestScore: bestMatch.bestScore,
          scoreGap: bestMatch.scoreGap,
          eligibleVisitors: bestMatch.eligibleVisitorCount,
          totalVisitors: bestMatch.totalVisitorsInWindow,
          triggerSource,
        })
      );

      return {
        matched: false,
        reason,
        reasonCode: bestMatch.reason,
        traceId,
      };
    }

    platform = bestMatch.visitor.ttclid ? 'TikTok' : 'Facebook';
    clickId = bestMatch.visitor.ttclid || bestMatch.visitor.fbclid;
    confidence = bestMatch.confidence;
    matchedVisitor = bestMatch.visitor;
    matchMeta = {
      score: bestMatch.score,
      signals: bestMatch.signals,
    };

    upsertMatch(
      order,
      bestMatch.visitor,
      clickId,
      platform,
      confidence,
      bestMatch.timeDiffMs,
      bestMatch.score,
      bestMatch.signals
    );

    logInfo(
      'order.matched',
      withTraceId(traceId, {
        orderId: order.shopify_order_id,
        platform,
        confidence,
        score: bestMatch.score,
        signals: bestMatch.signals,
        triggerSource,
      })
    );
  } else {
    platform = match.platform;
    clickId = match.click_id;
    confidence = match.confidence;
    matchedVisitor = getVisitorById(match.visitor_id);
    matchMeta = {
      score: Number(match.match_score || 0),
      signals: String(match.match_signals || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    };
  }

  const callbackResult = await dispatchCallback(order, platform, clickId, triggerSource, {
    traceId,
    senders: options.senders,
    callbackContext: {
      visitor: matchedVisitor,
      matchMeta,
      traceId,
      triggerSource,
    },
  });

  if (!callbackResult) {
    const error = new Error('Callback result is empty');

    logError(
      'callback.empty_result',
      withTraceId(traceId, {
        orderId: order.shopify_order_id,
        platform,
        triggerSource,
      })
    );

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
    callbackResult,
    matchMeta
  );

  db.prepare(
    `
      UPDATE orders
      SET status = ?, status_reason = ?, last_trace_id = ?, processed_at = ?
      WHERE id = ?
    `
  ).run(nextStatus, statusReason, traceId, new Date().toISOString(), order.id);

  return {
    matched: true,
    platform,
    confidence,
    score: matchMeta.score,
    signals: matchMeta.signals,
    callbackStatus: callbackResult.status,
    failureCode: callbackResult.failureCode || '',
    attemptsUsed: callbackResult.attemptNumber,
    traceId,
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
            match_score,
            match_signals,
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
            trace_id,
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
  __internal: {
    buildMatchedStatusReason,
    buildUnmatchedStatusReason,
    dispatchCallback,
    findBestVisitor,
  },
};
