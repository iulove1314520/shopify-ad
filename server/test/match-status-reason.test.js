const test = require('node:test');
const assert = require('node:assert/strict');

const { createTestContext } = require('./helpers/test-context');

test('buildUnmatchedStatusReason 会保留关键摘要字段', () => {
  const context = createTestContext();

  try {
    const { __internal } = context.requireServer('modules/match');
    const text = __internal.buildUnmatchedStatusReason({
      reason: 'fallback_gap_too_small',
      totalVisitorsInWindow: 3,
      eligibleVisitorCount: 2,
      candidateCount: 2,
      bestScore: 40,
      secondScore: 30,
      scoreGap: 10,
      bestTimeDiffMinutes: 25,
    });

    assert.match(text, /reason=fallback_gap_too_small/);
    assert.match(text, /total_visitors=3/);
    assert.match(text, /eligible_visitors=2/);
    assert.match(text, /candidates=2/);
    assert.match(text, /best_score=40/);
    assert.match(text, /second_score=30/);
    assert.match(text, /score_gap=10/);
    assert.match(text, /best_time_diff_minutes=25/);
  } finally {
    context.cleanup();
  }
});

test('buildUnmatchedStatusReason 会过滤空字段并清洗异常分隔符', () => {
  const context = createTestContext();

  try {
    const { __internal } = context.requireServer('modules/match');
    const text = __internal.buildUnmatchedStatusReason({
      reason: 'no_valid_match_candidate;\nsecondary',
      totalVisitorsInWindow: 1,
      eligibleVisitorCount: 0,
      candidateCount: '',
      bestScore: null,
      secondScore: undefined,
      scoreGap: '',
      bestTimeDiffMinutes: 5,
    });

    assert.match(text, /reason=no_valid_match_candidate, secondary/);
    assert.match(text, /total_visitors=1/);
    assert.match(text, /eligible_visitors=0/);
    assert.match(text, /best_time_diff_minutes=5/);
    assert.doesNotMatch(text, /candidates=/);
    assert.doesNotMatch(text, /best_score=/);
    assert.doesNotMatch(text, /second_score=/);
    assert.doesNotMatch(text, /score_gap=/);
  } finally {
    context.cleanup();
  }
});

test('reason utils 内部模块会生成稳定的 matched status 摘要', () => {
  const context = createTestContext();

  try {
    const { buildMatchedStatusReason } = context.requireServer('modules/match/reason-utils');
    const text = buildMatchedStatusReason(
      'TikTok',
      '高',
      {
        status: 'failed',
        attemptNumber: 2,
        failureCode: 'http_500',
        httpStatus: 500,
        retryable: true,
        errorMessage: 'temporary;\nissue',
      },
      {
        score: 88,
        signals: ['time_close', 'product_strong'],
      }
    );

    assert.match(text, /matched_platform=tiktok/);
    assert.match(text, /confidence=高/);
    assert.match(text, /score=88/);
    assert.match(text, /signals=time_close,product_strong/);
    assert.match(text, /callback=failed/);
    assert.match(text, /attempt=2/);
    assert.match(text, /failure_code=http_500/);
    assert.match(text, /http_status=500/);
    assert.match(text, /retryable=true/);
    assert.match(text, /error=temporary, issue/);
  } finally {
    context.cleanup();
  }
});
