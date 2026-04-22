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

test('requireApiAuth 在 API_AUTH_TOKEN 缺失时会 fail-closed 返回 503', () => {
  const context = createTestContext({
    API_AUTH_TOKEN: '',
  });

  try {
    const { requireApiAuth } = context.requireServer('utils/auth');
    const response = createMockResponse();
    let nextCalled = false;

    requireApiAuth(
      {
        get() {
          return '';
        },
      },
      response,
      () => {
        nextCalled = true;
      }
    );

    assert.equal(nextCalled, false);
    assert.equal(response.statusCode, 503);
    assert.equal(response.payload.error, 'API auth token is not configured');
  } finally {
    context.cleanup();
  }
});

test('requireApiAuth 配置了 token 且请求缺少 token 时返回 401', () => {
  const context = createTestContext({
    API_AUTH_TOKEN: 'secure-token-123',
  });

  try {
    const { requireApiAuth } = context.requireServer('utils/auth');
    const response = createMockResponse();
    let nextCalled = false;

    requireApiAuth(
      {
        get() {
          return '';
        },
      },
      response,
      () => {
        nextCalled = true;
      }
    );

    assert.equal(nextCalled, false);
    assert.equal(response.statusCode, 401);
    assert.equal(response.payload.error, 'Unauthorized');
  } finally {
    context.cleanup();
  }
});

test('requireApiAuth 配置了 token 且 Bearer token 匹配时放行', () => {
  const context = createTestContext({
    API_AUTH_TOKEN: 'secure-token-123',
  });

  try {
    const { requireApiAuth } = context.requireServer('utils/auth');
    const response = createMockResponse();
    let nextCalled = false;

    requireApiAuth(
      {
        get(name) {
          if (String(name).toLowerCase() === 'authorization') {
            return 'Bearer secure-token-123';
          }
          return '';
        },
      },
      response,
      () => {
        nextCalled = true;
      }
    );

    assert.equal(nextCalled, true);
    assert.equal(response.payload, null);
  } finally {
    context.cleanup();
  }
});

test('handleLogin 在 API_AUTH_TOKEN 缺失时返回 503，避免下发空 token', () => {
  const context = createTestContext({
    ADMIN_USERNAME: 'admin',
    ADMIN_PASSWORD: 'password-123',
    API_AUTH_TOKEN: '',
  });

  try {
    const { handleLogin } = context.requireServer('utils/auth');
    const response = createMockResponse();

    handleLogin(
      {
        body: {
          username: 'admin',
          password: 'password-123',
        },
      },
      response
    );

    assert.equal(response.statusCode, 503);
    assert.equal(response.payload.error, 'API 令牌未配置，请联系管理员');
  } finally {
    context.cleanup();
  }
});
