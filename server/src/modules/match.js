const { db } = require('../db/client');
const { logInfo, logError, withTraceId } = require('../utils/logger');
const { resolveLimit } = require('../utils/pagination');
const {
  buildMatchedStatusReason,
  buildUnmatchedStatusReason,
} = require('./match/reason-utils');
const { dispatchCallback } = require('./match/callback-dispatcher');
const { findBestVisitor } = require('./match/candidate-repository');
const {
  enrichExistingMatch,
  getExistingMatch,
  getVisitorById,
  upsertMatch,
} = require('./match/existing-match');
const {
  writeMatchedOrderStatus,
  writeUnmatchedOrderStatus,
} = require('./match/status-writer');

async function matchOrder(order, options = {}) {
  const triggerSource = options.triggerSource || 'webhook';
  const traceId = String(options.traceId || '').trim();
  let match = enrichExistingMatch({
    db,
    order,
    match: getExistingMatch(db, order.id),
  });
  let matchedVisitor = null;
  let platform;
  let clickId;
  let confidence;
  let matchMeta = {
    score: 0,
    signals: [],
  };

  if (!match) {
    const bestMatch = findBestVisitor({ db, order });

    if (!bestMatch.matched) {
      const reason = buildUnmatchedStatusReason(bestMatch);

      writeUnmatchedOrderStatus(db, order.id, reason, traceId);

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

    upsertMatch(db, {
      order,
      visitor: bestMatch.visitor,
      clickId,
      platform,
      confidence,
      timeDiffMs: bestMatch.timeDiffMs,
      matchScore: bestMatch.score,
      matchSignals: bestMatch.signals,
      matchMode: bestMatch.matchMode,
      leadScoreGap: bestMatch.leadScoreGap,
      decisionSummary: bestMatch.decisionSummary,
    });

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
    matchedVisitor = getVisitorById(db, match.visitor_id);
    matchMeta = {
      score: Number(match.match_score || 0),
      signals: String(match.match_signals || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    };
  }

  const callbackResult = await dispatchCallback({
    order,
    platform,
    clickId,
    triggerSource,
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

  const statusReason = buildMatchedStatusReason(
    platform,
    confidence,
    callbackResult,
    matchMeta
  );

  writeMatchedOrderStatus(
    db,
    order.id,
    callbackResult.status,
    statusReason,
    traceId
  );

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
            m.shopify_order_id AS order_id,
            m.click_id,
            m.platform,
            m.confidence,
            m.match_score,
            m.match_signals,
            m.match_time,
            m.time_diff_seconds,
            m.active,
            m.match_mode,
            m.lead_score_gap,
            m.decision_summary,
            v.ip AS visitor_ip
          FROM matches m
          LEFT JOIN visitors v ON v.id = m.visitor_id
          ORDER BY m.match_time DESC
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
            c.shopify_order_id AS order_id,
            c.platform,
            c.trigger_source,
            c.trace_id,
            c.attempt_number,
            c.status,
            c.retryable,
            c.http_status,
            c.request_summary,
            c.response_summary,
            c.error_message,
            c.callback_time,
            o.raw_payload AS order_raw_payload
          FROM callbacks c
          LEFT JOIN orders o ON o.shopify_order_id = c.shopify_order_id
          ORDER BY c.callback_time DESC
          LIMIT ?
        `
      )
      .all(resolveLimit(req.query.limit));

    // Extract Shopify order_name from the JSON payload for each row
    const enriched = rows.map((row) => {
      let shopify_order_name = '';
      if (row.order_raw_payload) {
        try {
          const payload = JSON.parse(row.order_raw_payload);
          shopify_order_name = payload.name || payload.order_number
            ? `${payload.name || '#' + payload.order_number}`
            : '';
        } catch (_) { /* ignore parse errors */ }
      }
      // Remove the heavy raw_payload before sending to frontend
      const { order_raw_payload, ...rest } = row;
      return { ...rest, shopify_order_name };
    });

    res.json(enriched);
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
