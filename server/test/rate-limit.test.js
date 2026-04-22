const test = require('node:test');
const assert = require('node:assert/strict');

const Database = require('better-sqlite3');

const { createRateLimiter } = require('../src/utils/rate-limit');

function createMockResponse() {
  return {
    statusCode: 200,
    payload: null,
    headers: {},
    setHeader(name, value) {
      this.headers[String(name)] = String(value);
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.payload = body;
      return this;
    },
  };
}

function createRequest(ip = '203.0.113.10') {
  return {
    method: 'POST',
    originalUrl: '/api/test',
    ip,
  };
}

test('SQLite 限流器在窗口内累计并在超过上限后返回 429', () => {
  const db = new Database(':memory:');
  try {
    let now = 1700000000000;
    const limiter = createRateLimiter({
      name: 'unit_limit',
      windowMs: 60000,
      max: 2,
      dbClient: db,
      nowFn: () => now,
      cleanupIntervalMs: 60000,
      logWarnFn: () => {},
    });

    const req = createRequest();
    const res1 = createMockResponse();
    let nextCount = 0;

    limiter(req, res1, () => {
      nextCount += 1;
    });
    assert.equal(nextCount, 1);
    assert.equal(res1.statusCode, 200);

    const res2 = createMockResponse();
    limiter(req, res2, () => {
      nextCount += 1;
    });
    assert.equal(nextCount, 2);
    assert.equal(res2.statusCode, 200);

    const res3 = createMockResponse();
    limiter(req, res3, () => {
      nextCount += 1;
    });
    assert.equal(nextCount, 2);
    assert.equal(res3.statusCode, 429);
    assert.equal(res3.payload.error, 'Too Many Requests');

    now += 61000;
    const res4 = createMockResponse();
    limiter(req, res4, () => {
      nextCount += 1;
    });
    assert.equal(nextCount, 3);
    assert.equal(res4.statusCode, 200);
  } finally {
    db.close();
  }
});

test('SQLite 限流器能跨实例共享计数（同一 DB）', () => {
  const db = new Database(':memory:');
  try {
    const now = 1700000000000;
    const options = {
      name: 'shared_limit',
      windowMs: 60000,
      max: 1,
      dbClient: db,
      nowFn: () => now,
      cleanupIntervalMs: 60000,
      logWarnFn: () => {},
    };

    const limiterA = createRateLimiter(options);
    const limiterB = createRateLimiter(options);
    const req = createRequest('203.0.113.11');

    const resA = createMockResponse();
    let nextA = 0;
    limiterA(req, resA, () => {
      nextA += 1;
    });
    assert.equal(nextA, 1);
    assert.equal(resA.statusCode, 200);

    const resB = createMockResponse();
    let nextB = 0;
    limiterB(req, resB, () => {
      nextB += 1;
    });
    assert.equal(nextB, 0);
    assert.equal(resB.statusCode, 429);
  } finally {
    db.close();
  }
});
