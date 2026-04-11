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
          ttp: 'ttp_cookie_demo_001',
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
          , ttp
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
    assert.equal(saved.ttp, 'ttp_cookie_demo_001');
  } finally {
    context.cleanup();
  }
});

test('handleVisitor 在 Cloudflare 代理下优先记录 CF-Connecting-IP', () => {
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

    assert.equal(saved.ip, '198.51.100.88');
  } finally {
    context.cleanup();
  }
});

test('handleVisitor 没有 Cloudflare 头时优先使用 Express 已解析的真实 IP，而不是客户端伪造 X-Forwarded-For', () => {
  const context = createTestContext();

  try {
    const { handleVisitor } = context.requireServer('modules/visitor');
    const response = createMockResponse();

    handleVisitor(
      {
        body: {
          ttclid: 'ttclid_demo_req_ip',
          product_id: '/products/demo-shirt',
          timestamp: '2026-03-28T01:00:00.000Z',
        },
        headers: {
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

test('handleVisitor 遇到无效的 CF-Connecting-IP 时会回退到 Express 已解析的 IP', () => {
  const context = createTestContext();

  try {
    const { handleVisitor } = context.requireServer('modules/visitor');
    const response = createMockResponse();

    handleVisitor(
      {
        body: {
          ttclid: 'ttclid_demo_invalid_cf_ip',
          product_id: '/products/demo-shirt',
          timestamp: '2026-03-28T01:00:00.000Z',
        },
        headers: {
          'cf-connecting-ip': 'not-an-ip',
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

test('listVisitors 会把 __CLICKID__ 标记为测试流量，并返回可读的终端解析结果', () => {
  const context = createTestContext();

  try {
    const { handleVisitor, listVisitors } = context.requireServer('modules/visitor');
    const saveResponse = createMockResponse();
    const listResponse = createMockResponse();

    handleVisitor(
      {
        body: {
          ttclid: '__CLICKID__',
          ttp: 'ttp_cookie_demo_002',
          product_id: '/products/demo-shelf',
          timestamp: '2026-03-28T01:00:00.000Z',
        },
        headers: {},
        socket: {
          remoteAddress: '203.0.113.9',
        },
        get(name) {
          if (String(name).toLowerCase() === 'user-agent') {
            return 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 bytedancewebview Safari/604.1';
          }

          return '';
        },
      },
      saveResponse,
      (error) => {
        throw error;
      }
    );

    listVisitors(
      {
        query: {
          limit: '10',
        },
      },
      listResponse,
      (error) => {
        throw error;
      }
    );

    assert.equal(saveResponse.statusCode, 200);
    assert.equal(listResponse.statusCode, 200);
    assert.equal(Array.isArray(listResponse.payload), true);
    assert.equal(listResponse.payload.length, 1);
    assert.equal(listResponse.payload[0].is_test_traffic, true);
    assert.equal(listResponse.payload[0].traffic_label, '测试流量');
    assert.match(listResponse.payload[0].traffic_reason, /__CLICKID__/);
    assert.equal(listResponse.payload[0].ttp, 'ttp_cookie_demo_002');
    assert.equal(listResponse.payload[0].ua_device, 'iPhone');
    assert.equal(listResponse.payload[0].ua_os, 'iOS');
    assert.equal(listResponse.payload[0].ua_browser, 'TikTok 内置浏览器');
    assert.equal(
      listResponse.payload[0].ua_summary,
      'iPhone · iOS · TikTok 内置浏览器'
    );
  } finally {
    context.cleanup();
  }
});
