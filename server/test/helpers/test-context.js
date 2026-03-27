const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const serverRoot = path.resolve(__dirname, '../..');
const srcRoot = path.join(serverRoot, 'src');

function clearServerModuleCache() {
  for (const cacheKey of Object.keys(require.cache)) {
    if (cacheKey.startsWith(srcRoot)) {
      delete require.cache[cacheKey];
    }
  }
}

function restoreEnv(snapshot) {
  for (const key of Object.keys(process.env)) {
    if (!(key in snapshot)) {
      delete process.env[key];
    }
  }

  for (const [key, value] of Object.entries(snapshot)) {
    process.env[key] = value;
  }
}

function createTestContext(envOverrides = {}) {
  const envSnapshot = { ...process.env };
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shopee-cpas-test-'));
  const sqlitePath = path.join(tempDir, 'app.db');

  process.env.NODE_ENV = 'test';
  process.env.SQLITE_PATH = sqlitePath;
  process.env.API_AUTH_TOKEN = process.env.API_AUTH_TOKEN || 'test-token';

  for (const [key, value] of Object.entries(envOverrides)) {
    process.env[key] = String(value);
  }

  clearServerModuleCache();

  const { db } = require(path.join(srcRoot, 'db/client'));
  const { initDatabase } = require(path.join(srcRoot, 'db/init'));
  initDatabase();

  return {
    db,
    sqlitePath,
    tempDir,
    requireServer(relativePath) {
      return require(path.join(srcRoot, relativePath));
    },
    cleanup() {
      try {
        db.close();
      } catch (error) {
        // Ignore close errors during test cleanup.
      }

      clearServerModuleCache();
      restoreEnv(envSnapshot);
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

module.exports = {
  createTestContext,
};
