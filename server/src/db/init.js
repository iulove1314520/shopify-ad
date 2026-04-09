const fs = require('node:fs');
const path = require('node:path');

const { db } = require('./client');

const VALID_TABLE_NAMES = new Set([
  'visitors',
  'orders',
  'matches',
  'callbacks',
  'webhook_events',
]);

function hasColumn(tableName, columnName) {
  if (!VALID_TABLE_NAMES.has(tableName)) {
    throw new Error(`Invalid table name: ${tableName}`);
  }
  return db
    .prepare(`PRAGMA table_info(${tableName})`)
    .all()
    .some((column) => column.name === columnName);
}

function ensureColumn(tableName, columnName, definition) {
  if (hasColumn(tableName, columnName)) {
    return;
  }

  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
}

function initDatabase() {
  const schemaPath = path.resolve(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  db.exec(schema);
  ensureColumn('orders', 'status_reason', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('orders', 'last_trace_id', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('webhook_events', 'trace_id', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('matches', 'match_score', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('matches', 'match_signals', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('callbacks', 'trigger_source', "TEXT NOT NULL DEFAULT 'webhook'");
  ensureColumn('callbacks', 'trace_id', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('callbacks', 'attempt_number', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn('callbacks', 'retryable', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('callbacks', 'http_status', 'INTEGER');
  ensureColumn('callbacks', 'request_summary', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('matches', 'active', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn('matches', 'released_at', 'TEXT');
  ensureColumn('matches', 'released_reason', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('matches', 'match_mode', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('matches', 'lead_score_gap', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('matches', 'decision_summary', "TEXT NOT NULL DEFAULT ''");
  try {
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_matches_order_unique ON matches(order_id)');
  } catch (_e) {
    // Index may conflict with existing duplicate order_id rows – not fatal
  }
  try {
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_matches_active_visitor_unique ON matches(visitor_id) WHERE active = 1');
  } catch (_e) {
    // Existing data has duplicate active visitor_ids – deduplicate by keeping the newest match per visitor
    try {
      db.exec(`
        UPDATE matches SET active = 0, released_reason = 'migration_dedup'
        WHERE active = 1 AND id NOT IN (
          SELECT MAX(id) FROM matches WHERE active = 1 GROUP BY visitor_id
        )
      `);
      db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_matches_active_visitor_unique ON matches(visitor_id) WHERE active = 1');
    } catch (e2) {
      console.warn('[init] Could not create idx_matches_active_visitor_unique after dedup:', e2.message);
    }
  }
}

module.exports = { initDatabase };
