const test = require('node:test');
const assert = require('node:assert/strict');

const { createTestContext } = require('./helpers/test-context');

function createMockResponse() {
  return {
    statusCode: 200,
    payload: null,
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

test('handleVisitor 会写入访客记录', () => {
  const context = createTestContext();

  try {
    const { handleVisitor } = context.requireServer('modules/visitor');
    const response = createMockResponse();

    handleVisitor(
      {
        body: {
          ttclid: 'ttclid_demo_001',
          product_id: '/products/demo-shirt',
          timestamp: '2026-03-28T01:00:00.000Z',
        },
        headers: {},
        socket: {
          remoteAddress: '203.0.113.9',
        },
        get(name) {
          if (String(name).toLowerCase() === 'user-agent') {
            return 'unit-test-agent';
          }

          return '';
        },
      },
      response,
      (error) => {
        throw error;
      }
    );

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.payload, { success: true });

    const saved = context.db
      .prepare(
        `
          SELECT ttclid, product_id, ip, user_agent
          FROM visitors
          ORDER BY id DESC
          LIMIT 1
        `
      )
      .get();

    assert.equal(saved.ttclid, 'ttclid_demo_001');
    assert.equal(saved.product_id, '/products/demo-shirt');
    assert.equal(saved.ip, '203.0.113.9');
    assert.equal(saved.user_agent, 'unit-test-agent');
  } finally {
    context.cleanup();
  }
});
