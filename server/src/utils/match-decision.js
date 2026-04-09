/**
 * Match decision engine.
 *
 * Executes the conservative dual-path (main / fallback) decision logic:
 *
 * Main path:
 *   - Requires strong product evidence
 *   - Minimum total score: 55
 *   - Lead gap ≥ 10
 *
 * Fallback path:
 *   - No candidate has strong product evidence
 *   - Uses time + GeoIP + click source
 *   - Minimum total score: 35
 *   - Lead gap ≥ 15
 */

const MAIN_MIN_SCORE = 55;
const MAIN_MIN_LEAD_GAP = 10;
const FALLBACK_MIN_SCORE = 35;
const FALLBACK_MIN_LEAD_GAP = 15;

/**
 * Determine the mode for a single candidate based on product evidence level.
 *
 * @param {'strong' | 'weak' | 'none'} productLevel
 * @returns {'main' | 'fallback'}
 */
function resolveMode(productLevel) {
  return productLevel === 'strong' ? 'main' : 'fallback';
}

/**
 * Run the decision engine on a set of scored candidates.
 *
 * Each candidate should have:
 *   - visitorId: number
 *   - score: number (total score from time + product + ip)
 *   - productLevel: 'strong' | 'weak' | 'none'
 *   - (optional) any other metadata to pass through
 *
 * @param {{ candidates: Array<{ visitorId: number, score: number, productLevel: string, [key: string]: any }> }} params
 * @returns {{ matched: boolean, mode?: string, winner?: object, leadGap?: number, reasonCode?: string, summary?: string }}
 */
function decideMatch({ candidates }) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return { matched: false, reasonCode: 'no_candidate', summary: 'candidates=0' };
  }

  // Assign mode to each candidate based on product evidence
  const withMode = candidates.map((c) => ({
    ...c,
    mode: c.mode || resolveMode(c.productLevel),
  }));

  // Check if any candidate qualifies for main path
  const hasMainCandidate = withMode.some((c) => c.mode === 'main');

  // Sort by score descending
  const sorted = [...withMode].sort((a, b) => b.score - a.score);
  const first = sorted[0];
  const second = sorted[1] || null;
  const leadGap = second ? first.score - second.score : first.score;

  if (hasMainCandidate) {
    // Main path: only consider candidates with strong product evidence
    const mainCandidates = sorted.filter((c) => c.mode === 'main');
    const mainFirst = mainCandidates[0];
    const mainSecond = mainCandidates[1] || null;
    const mainLeadGap = mainSecond
      ? mainFirst.score - mainSecond.score
      : mainFirst.score;

    if (mainFirst.score < MAIN_MIN_SCORE) {
      return {
        matched: false,
        reasonCode: 'main_score_too_low',
        summary: `best_score=${mainFirst.score};min=${MAIN_MIN_SCORE};candidates=${mainCandidates.length}`,
      };
    }

    if (mainLeadGap < MAIN_MIN_LEAD_GAP) {
      return {
        matched: false,
        reasonCode: 'main_gap_too_small',
        summary: `lead_gap=${mainLeadGap};min=${MAIN_MIN_LEAD_GAP};best=${mainFirst.score};second=${mainSecond?.score}`,
      };
    }

    return {
      matched: true,
      mode: 'main',
      winner: mainFirst,
      leadGap: mainLeadGap,
    };
  }

  // Fallback path: no main candidates available
  if (first.score < FALLBACK_MIN_SCORE) {
    return {
      matched: false,
      reasonCode: 'fallback_score_too_low',
      summary: `best_score=${first.score};min=${FALLBACK_MIN_SCORE};candidates=${sorted.length}`,
    };
  }

  if (leadGap < FALLBACK_MIN_LEAD_GAP) {
    return {
      matched: false,
      reasonCode: 'fallback_gap_too_small',
      summary: `lead_gap=${leadGap};min=${FALLBACK_MIN_LEAD_GAP};best=${first.score};second=${second?.score}`,
    };
  }

  return {
    matched: true,
    mode: 'fallback',
    winner: first,
    leadGap,
  };
}

module.exports = {
  decideMatch,
  resolveMode,
  MAIN_MIN_SCORE,
  MAIN_MIN_LEAD_GAP,
  FALLBACK_MIN_SCORE,
  FALLBACK_MIN_LEAD_GAP,
};
