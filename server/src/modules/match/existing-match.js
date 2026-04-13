const { scoreVisitorCandidate } = require('../../utils/match-scoring');

function getExistingMatch(db, orderId) {
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

function getVisitorById(db, visitorId) {
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

function enrichExistingMatch({
  db,
  order,
  match,
  scoreVisitorCandidateFn = scoreVisitorCandidate,
}) {
  if (
    Number(match?.match_score || 0) > 0
    && String(match?.match_signals || '').trim()
  ) {
    return match;
  }

  const visitor = getVisitorById(db, match?.visitor_id);
  if (!visitor) {
    return match;
  }

  const rescored = scoreVisitorCandidateFn(order, visitor);
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
  db,
  {
    order,
    visitor,
    clickId,
    platform,
    confidence,
    timeDiffMs,
    matchScore,
    matchSignals,
    matchMode,
    leadScoreGap,
    decisionSummary,
  }
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
    visitor.id,
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

module.exports = {
  enrichExistingMatch,
  getExistingMatch,
  getVisitorById,
  upsertMatch,
};
