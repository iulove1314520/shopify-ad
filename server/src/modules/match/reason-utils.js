function sanitizeReasonValue(value) {
  return String(value ?? '')
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

module.exports = {
  buildMatchedStatusReason,
  buildReasonString,
  buildUnmatchedStatusReason,
  sanitizeReasonValue,
};
