const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const Database = require('better-sqlite3');

const { createTestContext } = require('./helpers/test-context');

function openMemoryDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  return db;
}

test('initDatabase 会为重复 order_id 的历史数据自动去重并建立唯一索引', () => {
  const context = createTestContext();
  const { initDatabase } = context.requireServer('db/init');
  const schemaPath = path.resolve(__dirname, '../src/db/schema.sql');
  const schema = require('node:fs').readFileSync(schemaPath, 'utf8');
  const db = openMemoryDb();

  try {
    db.exec(schema);
    db.exec('DROP INDEX IF EXISTS idx_matches_order_unique');
    db.exec('DROP INDEX IF EXISTS idx_matches_active_visitor_unique');

    db.prepare(
      `
        INSERT INTO visitors (id, ttclid, fbclid, ip, timestamp, product_id, user_agent)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `
    ).run(
      10,
      'ttclid_10',
      '',
      '198.51.100.10',
      '2026-04-01T00:40:00.000Z',
      '/products/demo',
      'ua'
    );
    db.prepare(
      `
        INSERT INTO visitors (id, ttclid, fbclid, ip, timestamp, product_id, user_agent)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `
    ).run(
      11,
      'ttclid_11',
      '',
      '198.51.100.11',
      '2026-04-01T00:45:00.000Z',
      '/products/demo',
      'ua'
    );

    db.prepare(
      `
        INSERT INTO orders (id, shopify_order_id, created_at, total_price, currency, zip, financial_status, raw_payload, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    ).run(
      1,
      'SO-INDEX-1',
      '2026-04-01T01:00:00.000Z',
      100,
      'USD',
      '',
      'paid',
      '{}',
      'received'
    );

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
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    ).run(
      1,
      10,
      'SO-INDEX-1',
      'ttclid_a',
      'TikTok',
      '高',
      95,
      'time_close',
      '2026-04-01T01:00:00.000Z',
      10,
      1,
      'main',
      20,
      'old'
    );

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
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    ).run(
      1,
      11,
      'SO-INDEX-1',
      'ttclid_b',
      'TikTok',
      '中',
      80,
      'time_medium',
      '2026-04-01T02:00:00.000Z',
      20,
      1,
      'main',
      10,
      'new'
    );

    initDatabase(db);

    const keptRows = db
      .prepare('SELECT id, visitor_id FROM matches WHERE order_id = 1 ORDER BY id')
      .all();
    assert.equal(keptRows.length, 1);
    assert.equal(keptRows[0].visitor_id, 11);

    assert.throws(
      () => {
        db.prepare(
          `
            INSERT INTO matches (
              order_id, visitor_id, shopify_order_id, click_id, platform, confidence,
              match_score, match_signals, match_time, time_diff_seconds,
              active, match_mode, lead_score_gap, decision_summary
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `
        ).run(
          1,
          12,
          'SO-INDEX-1',
          'ttclid_c',
          'TikTok',
          '中',
          70,
          'time_medium',
          '2026-04-01T03:00:00.000Z',
          30,
          1,
          'main',
          8,
          'dup'
        );
      },
      /UNIQUE constraint failed: matches\.order_id/
    );
  } finally {
    db.close();
    context.cleanup();
  }
});
