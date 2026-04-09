const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const { decideMatch, resolveMode } = require('../src/utils/match-decision');

describe('match-decision', () => {
  // ──────── resolveMode ────────

  test('strong 商品证据映射为 main 模式', () => {
    assert.equal(resolveMode('strong'), 'main');
  });

  test('weak 商品证据映射为 fallback 模式', () => {
    assert.equal(resolveMode('weak'), 'fallback');
  });

  test('none 商品证据映射为 fallback 模式', () => {
    assert.equal(resolveMode('none'), 'fallback');
  });

  // ──────── Main path ────────

  test('强商品证据走主路径，领先分差 >= 10 时自动通过', () => {
    const result = decideMatch({
      candidates: [
        { visitorId: 1, score: 72, productLevel: 'strong' },
        { visitorId: 2, score: 60, productLevel: 'strong' },
      ],
    });

    assert.equal(result.matched, true);
    assert.equal(result.mode, 'main');
    assert.equal(result.winner.visitorId, 1);
    assert.equal(result.leadGap, 12);
  });

  test('主路径领先分差不足 10 时拒绝', () => {
    const result = decideMatch({
      candidates: [
        { visitorId: 1, score: 65, productLevel: 'strong' },
        { visitorId: 2, score: 60, productLevel: 'strong' },
      ],
    });

    assert.equal(result.matched, false);
    assert.equal(result.reasonCode, 'main_gap_too_small');
  });

  test('主路径分数低于 55 时拒绝', () => {
    const result = decideMatch({
      candidates: [
        { visitorId: 1, score: 50, productLevel: 'strong' },
      ],
    });

    assert.equal(result.matched, false);
    assert.equal(result.reasonCode, 'main_score_too_low');
  });

  test('主路径唯一候选分数足够时通过（leadGap = score）', () => {
    const result = decideMatch({
      candidates: [
        { visitorId: 1, score: 70, productLevel: 'strong' },
      ],
    });

    assert.equal(result.matched, true);
    assert.equal(result.mode, 'main');
    assert.equal(result.leadGap, 70);
  });

  // ──────── Fallback path ────────

  test('降级路径领先 >= 15 时自动通过', () => {
    const result = decideMatch({
      candidates: [
        { visitorId: 1, score: 50, productLevel: 'weak' },
        { visitorId: 2, score: 30, productLevel: 'none' },
      ],
    });

    assert.equal(result.matched, true);
    assert.equal(result.mode, 'fallback');
    assert.equal(result.leadGap, 20);
  });

  test('降级路径只有领先 >= 15 时才自动通过（13 分差拒绝）', () => {
    const result = decideMatch({
      candidates: [
        { visitorId: 1, score: 44, productLevel: 'weak' },
        { visitorId: 2, score: 31, productLevel: 'weak' },
      ],
    });

    assert.equal(result.matched, false);
    assert.equal(result.reasonCode, 'fallback_gap_too_small');
  });

  test('降级路径分数低于 35 时拒绝', () => {
    const result = decideMatch({
      candidates: [
        { visitorId: 1, score: 30, productLevel: 'none' },
      ],
    });

    assert.equal(result.matched, false);
    assert.equal(result.reasonCode, 'fallback_score_too_low');
  });

  // ──────── Mixed candidates ────────

  test('有 strong 候选时优先走主路径，即使 fallback 候选分数更高', () => {
    const result = decideMatch({
      candidates: [
        { visitorId: 1, score: 80, productLevel: 'weak' },    // high score but fallback
        { visitorId: 2, score: 60, productLevel: 'strong' },   // lower score but main
      ],
    });

    // Should use main path because a strong candidate exists
    assert.equal(result.mode, 'main');
    assert.equal(result.winner.visitorId, 2);
  });

  // ──────── Edge cases ────────

  test('空候选列表返回 no_candidate', () => {
    const result = decideMatch({ candidates: [] });
    assert.equal(result.matched, false);
    assert.equal(result.reasonCode, 'no_candidate');
  });

  test('candidates 不是数组时返回 no_candidate', () => {
    const result = decideMatch({ candidates: null });
    assert.equal(result.matched, false);
    assert.equal(result.reasonCode, 'no_candidate');
  });
});
