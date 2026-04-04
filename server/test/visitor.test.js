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

test('handleVisitor 优先使用 Express 已解析的真实 IP，而不是客户端伪造请求头', () => {
  const context = createTestContext();

  try {
    const { handleVisitor } = context.requireServer('modules/visitor');
    const response = createMockResponse();

    handleVisitor(
      {
        body: {
          ttclid: 'ttclid_demo_real_ip',
          product_id: '/products/demo-shirt',
          timestamp: '2026-03-28T01:00:00.000Z',
        },
        headers: {
          'cf-connecting-ip': '198.51.100.88',
          'x-forwarded-for': '198.51.100.99, 10.0.0.1',
        },
        ip: '203.0.113.25',
        socket: {
          remoteAddress: '10.0.0.2',
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

    const saved = context.db
      .prepare(
        `
          SELECT ip
          FROM visitors
          ORDER BY id DESC
          LIMIT 1
        `
      )
      .get();

    assert.equal(saved.ip, '203.0.113.25');
  } finally {
    context.cleanup();
  }
});
