const fs = require('node:fs');
const path = require('node:path');

const Database = require('better-sqlite3');

const { env } = require('../config/env');

const databaseDir = path.dirname(env.sqlitePath);
fs.mkdirSync(databaseDir, { recursive: true });

const db = new Database(env.sqlitePath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma(`busy_timeout = ${env.sqliteBusyTimeoutMs}`);

module.exports = { db };

