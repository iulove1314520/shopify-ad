const test = require('node:test');
const assert = require('node:assert/strict');

const { createTestContext } = require('./helpers/test-context');

test('requestLogger 会记录真实访客 IP，而不是 Cloudflare 边缘 IP', () => {
  const context = createTestContext();
  const originalConsoleLog = console.log;
  const logLines = [];

  console.log = (line) => {
    logLines.push(String(line));
  };

  try {
    const { requestLogger } = context.requireServer('utils/logger');

    const response = {
      statusCode: 200,
      finishHandler: null,
      on(eventName, handler) {
        if (eventName === 'finish') {
          this.finishHandler = handler;
        }
      },
    };

    requestLogger(
      {
        method: 'POST',
        originalUrl: '/api/visitor',
        headers: {
          'cf-connecting-ip': '198.51.100.42',
        },
        ip: '172.70.1.20',
        context: {
          traceId: 'trace_demo_001',
        },
        get(name) {
          return this.headers[String(name).toLowerCase()] || '';
        },
      },
      response,
      () => {}
    );

    response.finishHandler();

    assert.equal(logLines.length, 1);
    const payload = JSON.parse(logLines[0]);
    assert.equal(payload.message, 'request.completed');
    assert.equal(payload.details.ip, '198.51.100.42');
  } finally {
    console.log = originalConsoleLog;
    context.cleanup();
  }
});
