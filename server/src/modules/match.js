const { env } = require('../config/env');
const { db } = require('../db/client');
const { sleep } = require('../services/callback-utils');
const { sendToTikTok } = require('../services/tiktok');
const { sendToFacebook } = require('../services/facebook');
const {
  extractOrderSignals,
  scoreVisitorCandidate,
} = require('../utils/match-scoring');
const { classifyProductEvidence } = require('../utils/product-fingerprint');
const { buildIpEvidence } = require('../utils/geo-evidence');
const { decideMatch } = require('../utils/match-decision');
const { logInfo, logWarn, logError, withTraceId } = require('../utils/logger');
const { resolveLimit } = require('../utils/pagination');

const MATCH_WINDOW_HOURS = 24;

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
    ['candidates', result.candidateCount],
    ['best_score', result.bestScore],
    ['second_score', result.secondScore],
    ['score_gap', result.scoreGap],
    ['best_time_diff_minutes', result.bestTimeDiffMinutes],
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

/**
 * Get the new-engine time score for a candidate.
 * <= 1h → 30, <= 6h → 20, <= 24h → 10, > 24h → eliminated.
 */
function getNewTimeScore(timeDiffMs) {
  const hours = timeDiffMs / (60 * 60 * 1000);
  if (hours <= 1) return 30;
  if (hours <= 6) return 20;
  if (hours <= 24) return 10;
  return 0;
}

function findBestVisitor(order) {
  const orderTime = new Date(order.created_at).getTime();
  const windowMs = MATCH_WINDOW_HOURS * 60 * 60 * 1000;
  const windowStart = new Date(orderTime - windowMs).toISOString();

  const totalVisitorsInWindow = db
    .prepare(
      `
        SELECT COUNT(*) AS count
        FROM visitors
        WHERE timestamp >= ? AND timestamp <= ?
      `
    )
    .get(windowStart, order.created_at).count;

  // 候选筛选层: 24h内、有点击ID、未被占用
  const candidates = db
    .prepare(
      `
        SELECT
          v.id,
          v.ttclid,
          v.fbclid,
          v.ttp,
          v.ip,
          v.timestamp,
          v.product_id,
          v.user_agent
        FROM visitors v
        WHERE
          (v.ttclid <> '' OR v.fbclid <> '')
          AND v.timestamp >= ?
          AND v.timestamp <= ?
          AND NOT EXISTS (
            SELECT 1 FROM matches m
            WHERE m.visitor_id = v.id AND m.active = 1
          )
        ORDER BY v.timestamp DESC
      `
    )
    .all(windowStart, order.created_at);

  if (candidates.length === 0) {
    const reason = totalVisitorsInWindow === 0
      ? 'no_visitors_in_window'
      : 'visitors_missing_click_id_or_occupied';
    return {
      matched: false,
      reason,
      totalVisitorsInWindow,
      eligibleVisitorCount: 0,
    };
  }

  // 证据提取层
  const orderSignals = extractOrderSignals(order);
  const orderTitles = (orderSignals.productKeys || []).length > 0
    ? getOrderTitles(order)
    : [];

  const scored = candidates.map((visitor) => {
    const visitorTimestamp = new Date(visitor.timestamp).getTime();
    const timeDiffMs = orderTime - visitorTimestamp;

    if (timeDiffMs < 0 || !Number.isFinite(timeDiffMs)) {
      return null;
    }

    const timeScore = getNewTimeScore(timeDiffMs);
    if (timeScore === 0) {
      return null; // Beyond 24h window
    }

    // 商品证据
    const productEvidence = classifyProductEvidence(
      orderTitles,
      visitor.product_id
    );
    const productScore = productEvidence.level === 'strong' ? 40
      : productEvidence.level === 'weak' ? 15
      : 0;

    // IP/Geo 证据
    const ipEvidence = buildIpEvidence(orderSignals, visitor.ip);

    const totalScore = timeScore + productScore + ipEvidence.score;

    const signals = [];
    if (timeScore >= 30) signals.push('time_close');
    else if (timeScore >= 20) signals.push('time_medium');
    else signals.push('time_far');

    if (productEvidence.level !== 'none') {
      signals.push(`product_${productEvidence.level}`);
    }
    signals.push(...ipEvidence.signals);

    return {
      visitorId: visitor.id,
      visitor,
      score: totalScore,
      productLevel: productEvidence.level,
      ipLevel: ipEvidence.level,
      timeDiffMs,
      timeDiffMinutes: Math.round(timeDiffMs / 60000),
      signals,
      ipSignals: ipEvidence.signals,
      productDetails: productEvidence.details,
    };
  }).filter(Boolean);

  if (scored.length === 0) {
    return {
      matched: false,
      reason: 'no_valid_match_candidate',
      totalVisitorsInWindow,
      eligibleVisitorCount: candidates.length,
    };
  }

  // 决策层
  const decision = decideMatch({ candidates: scored });

  if (!decision.matched) {
    const sorted = [...scored].sort((a, b) => b.score - a.score);
    const best = sorted[0];
    const second = sorted[1];
    return {
      matched: false,
      reason: decision.reasonCode,
      totalVisitorsInWindow,
      eligibleVisitorCount: candidates.length,
      bestScore: best?.score,
      secondScore: second?.score,
      scoreGap: second ? best.score - second.score : null,
      bestTimeDiffMinutes: best?.timeDiffMinutes,
      candidateCount: scored.length,
    };
  }

  // 匹配成功
  const winner = decision.winner;
  const clickId = winner.visitor.ttclid || winner.visitor.fbclid;
  const platform = winner.visitor.ttclid ? 'TikTok' : 'Facebook';
  const confidence = winner.score >= 80 ? '高' : winner.score >= 55 ? '中' : '低';

  const decisionSummary = buildReasonString([
    ['mode', decision.mode],
    ['product', winner.productLevel],
    ['time_diff_minutes', winner.timeDiffMinutes],
    ['ip', winner.ipSignals?.join(',')],
    ['lead_gap', decision.leadGap],
    ['click_source', platform.toLowerCase()],
  ]);

  return {
    matched: true,
    visitor: winner.visitor,
    confidence,
    score: winner.score,
    signals: winner.signals,
    timeDiffMs: winner.timeDiffMs,
    matchMode: decision.mode,
    leadScoreGap: decision.leadGap,
    decisionSummary,
    totalVisitorsInWindow,
    eligibleVisitorCount: candidates.length,
    candidateCount: scored.length,
  };
}

/**
 * Extract order line item titles for product evidence comparison.
 */
function getOrderTitles(order) {
  let payload = order?.raw_payload;
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload); } catch (_) { return []; }
  }
  if (!payload || typeof payload !== 'object') return [];
  const items = Array.isArray(payload.line_items) ? payload.line_items : [];
  return items
    .map((item) => item?.title || item?.name || item?.product_title || '')
    .filter(Boolean);
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
          time_diff_seconds,
          active,
          match_mode,
          lead_score_gap,
          decision_summary
        FROM matches
        WHERE order_id = ? AND active = 1
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
          ttp,
          ip,
          timestamp,
          product_id,
          user_agent
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
  matchSignals,
  matchMode,
  leadScoreGap,
  decisionSummary
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
        time_diff_seconds,
        active,
        match_mode,
        lead_score_gap,
        decision_summary
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
      ON CONFLICT(order_id) DO UPDATE SET
        visitor_id = excluded.visitor_id,
        shopify_order_id = excluded.shopify_order_id,
        click_id = excluded.click_id,
        platform = excluded.platform,
        confidence = excluded.confidence,
        match_score = excluded.match_score,
        match_signals = excluded.match_signals,
        match_time = excluded.match_time,
        time_diff_seconds = excluded.time_diff_seconds,
        active = 1,
        match_mode = excluded.match_mode,
        lead_score_gap = excluded.lead_score_gap,
        decision_summary = excluded.decision_summary
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
    Math.round(timeDiffMs / 1000),
    matchMode || '',
    leadScoreGap || 0,
    decisionSummary || ''
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
      bestMatch.signals,
      bestMatch.matchMode,
      bestMatch.leadScoreGap,
      bestMatch.decisionSummary
    );

    logInfo(
      'order.matched',
      withTraceId(traceId, {
        orderId: order.shopify_order_id,
        platform,
        confidence,
        score: bestMatch.score,
        signals: bestMatch.signals,
        matchMode: bestMatch.matchMode,
        leadScoreGap: bestMatch.leadScoreGap,
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
            time_diff_seconds,
            active,
            match_mode,
            lead_score_gap,
            decision_summary
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
