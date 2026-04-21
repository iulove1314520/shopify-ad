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

function hasColumnInDb(dbClient, tableName, columnName) {
  if (!VALID_TABLE_NAMES.has(tableName)) {
    throw new Error(`Invalid table name: ${tableName}`);
  }

  return dbClient
    .prepare(`PRAGMA table_info(${tableName})`)
    .all()
    .some((column) => column.name === columnName);
}

function ensureColumnInDb(dbClient, tableName, columnName, definition) {
  if (hasColumnInDb(dbClient, tableName, columnName)) {
    return;
  }

  dbClient.exec(
    `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`
  );
}

function createUniqueMatchIndexWithRecovery({
  dbClient,
  indexName,
  createIndexSql,
  recoverSql,
}) {
  try {
    dbClient.exec(createIndexSql);
    return;
  } catch (_error) {
    // Try one deterministic data recovery pass, then enforce fail-fast.
    try {
      dbClient.exec(recoverSql);
    } catch (recoveryError) {
      throw new Error(
        `${indexName} recovery failed: ${recoveryError.message}`
      );
    }
  }

  try {
    dbClient.exec(createIndexSql);
  } catch (createError) {
    throw new Error(
      `${indexName} creation failed after recovery: ${createError.message}`
    );
  }
}

function ensureMatchUniqueIndexes(dbClient) {
  createUniqueMatchIndexWithRecovery({
    dbClient,
    indexName: 'idx_matches_order_unique',
    createIndexSql:
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_matches_order_unique ON matches(order_id)',
    recoverSql: `
      DELETE FROM matches
      WHERE id NOT IN (
        SELECT MAX(id)
        FROM matches
        GROUP BY order_id
      )
    `,
  });

  createUniqueMatchIndexWithRecovery({
    dbClient,
    indexName: 'idx_matches_active_visitor_unique',
    createIndexSql:
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_matches_active_visitor_unique ON matches(visitor_id) WHERE active = 1',
    recoverSql: `
      UPDATE matches
      SET active = 0,
          released_reason = CASE
            WHEN TRIM(COALESCE(released_reason, '')) = '' THEN 'migration_dedup'
            ELSE released_reason
          END,
          released_at = COALESCE(released_at, CURRENT_TIMESTAMP)
      WHERE active = 1
        AND id NOT IN (
          SELECT MAX(id)
          FROM matches
          WHERE active = 1
          GROUP BY visitor_id
        )
    `,
  });
}

function initDatabase(dbClient = db) {
  const schemaPath = path.resolve(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  dbClient.exec(schema);
  ensureColumnInDb(dbClient, 'visitors', 'ttp', "TEXT NOT NULL DEFAULT ''");
  ensureColumnInDb(
    dbClient,
    'orders',
    'status_reason',
    "TEXT NOT NULL DEFAULT ''"
  );
  ensureColumnInDb(
    dbClient,
    'orders',
    'last_trace_id',
    "TEXT NOT NULL DEFAULT ''"
  );
  ensureColumnInDb(
    dbClient,
    'webhook_events',
    'trace_id',
    "TEXT NOT NULL DEFAULT ''"
  );
  ensureColumnInDb(
    dbClient,
    'matches',
    'match_score',
    'INTEGER NOT NULL DEFAULT 0'
  );
  ensureColumnInDb(
    dbClient,
    'matches',
    'match_signals',
    "TEXT NOT NULL DEFAULT ''"
  );
  ensureColumnInDb(
    dbClient,
    'callbacks',
    'trigger_source',
    "TEXT NOT NULL DEFAULT 'webhook'"
  );
  ensureColumnInDb(dbClient, 'callbacks', 'trace_id', "TEXT NOT NULL DEFAULT ''");
  ensureColumnInDb(
    dbClient,
    'callbacks',
    'attempt_number',
    'INTEGER NOT NULL DEFAULT 1'
  );
  ensureColumnInDb(
    dbClient,
    'callbacks',
    'retryable',
    'INTEGER NOT NULL DEFAULT 0'
  );
  ensureColumnInDb(dbClient, 'callbacks', 'http_status', 'INTEGER');
  ensureColumnInDb(
    dbClient,
    'callbacks',
    'request_summary',
    "TEXT NOT NULL DEFAULT ''"
  );
  ensureColumnInDb(dbClient, 'matches', 'active', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumnInDb(dbClient, 'matches', 'released_at', 'TEXT');
  ensureColumnInDb(
    dbClient,
    'matches',
    'released_reason',
    "TEXT NOT NULL DEFAULT ''"
  );
  ensureColumnInDb(dbClient, 'matches', 'match_mode', "TEXT NOT NULL DEFAULT ''");
  ensureColumnInDb(
    dbClient,
    'matches',
    'lead_score_gap',
    'INTEGER NOT NULL DEFAULT 0'
  );
  ensureColumnInDb(
    dbClient,
    'matches',
    'decision_summary',
    "TEXT NOT NULL DEFAULT ''"
  );

  try {
    ensureMatchUniqueIndexes(dbClient);
  } catch (error) {
    throw new Error(
      `[init] Failed to enforce matches unique indexes: ${error.message}`
    );
  }
}

module.exports = {
  initDatabase,
  __internal: {
    ensureColumnInDb,
    ensureMatchUniqueIndexes,
    hasColumnInDb,
  },
};
