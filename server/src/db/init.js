const fs = require('node:fs');
const path = require('node:path');

const { db } = require('./client');

function hasColumn(tableName, columnName) {
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
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_matches_order_unique ON matches(order_id)');
}

module.exports = { initDatabase };
