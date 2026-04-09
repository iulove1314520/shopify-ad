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
// 生产加固: NORMAL = WAL 模式下安全且比 FULL 快 ~2×
db.pragma('synchronous = NORMAL');
// 约 16MB 页面缓存（-4000 × 4KB页 ≈ 16MB），减少磁盘读
db.pragma('cache_size = -4000');
// 临时表和索引放内存，避免临时文件 I/O
db.pragma('temp_store = MEMORY');

module.exports = { db };

