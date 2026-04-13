const { extractOrderSignals } = require('../../utils/match-scoring');
const { classifyProductEvidence } = require('../../utils/product-fingerprint');
const { buildIpEvidence } = require('../../utils/geo-evidence');
const { decideMatch } = require('../../utils/match-decision');
const { buildReasonString } = require('./reason-utils');

const MATCH_WINDOW_HOURS = 24;

function getNewTimeScore(timeDiffMs) {
  const hours = timeDiffMs / (60 * 60 * 1000);
  if (hours <= 1) return 30;
  if (hours <= 6) return 20;
  if (hours <= 24) return 10;
  return 0;
}

function getOrderTitles(order) {
  let payload = order?.raw_payload;
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch (_) {
      return [];
    }
  }

  if (!payload || typeof payload !== 'object') {
    return [];
  }

  const items = Array.isArray(payload.line_items) ? payload.line_items : [];
  return items
    .map((item) => item?.title || item?.name || item?.product_title || '')
    .filter(Boolean);
}

function loadMatchCandidates({ db, order, matchWindowHours = MATCH_WINDOW_HOURS }) {
  const orderTime = new Date(order.created_at).getTime();
  const windowMs = matchWindowHours * 60 * 60 * 1000;
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

  return {
    candidates,
    orderTime,
    totalVisitorsInWindow,
  };
}

function findBestVisitor({
  db,
  order,
  matchWindowHours = MATCH_WINDOW_HOURS,
  extractOrderSignalsFn = extractOrderSignals,
  classifyProductEvidenceFn = classifyProductEvidence,
  buildIpEvidenceFn = buildIpEvidence,
  decideMatchFn = decideMatch,
}) {
  const {
    candidates,
    orderTime,
    totalVisitorsInWindow,
  } = loadMatchCandidates({
    db,
    order,
    matchWindowHours,
  });

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

  const orderSignals = extractOrderSignalsFn(order);
  const orderTitles = (orderSignals.productKeys || []).length > 0
    ? getOrderTitles(order)
    : [];

  const scored = candidates
    .map((visitor) => {
      const visitorTimestamp = new Date(visitor.timestamp).getTime();
      const timeDiffMs = orderTime - visitorTimestamp;

      if (timeDiffMs < 0 || !Number.isFinite(timeDiffMs)) {
        return null;
      }

      const timeScore = getNewTimeScore(timeDiffMs);
      if (timeScore === 0) {
        return null;
      }

      const productEvidence = classifyProductEvidenceFn(orderTitles, visitor.product_id);
      const productScore = productEvidence.level === 'strong'
        ? 40
        : productEvidence.level === 'weak'
          ? 15
          : 0;
      const ipEvidence = buildIpEvidenceFn(orderSignals, visitor.ip);
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
    })
    .filter(Boolean);

  if (scored.length === 0) {
    return {
      matched: false,
      reason: 'no_valid_match_candidate',
      totalVisitorsInWindow,
      eligibleVisitorCount: candidates.length,
    };
  }

  const decision = decideMatchFn({ candidates: scored });

  if (!decision.matched) {
    const sorted = [...scored].sort((left, right) => right.score - left.score);
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

  const winner = decision.winner;
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

module.exports = {
  MATCH_WINDOW_HOURS,
  findBestVisitor,
  loadMatchCandidates,
  __internal: {
    getNewTimeScore,
    getOrderTitles,
  },
};
